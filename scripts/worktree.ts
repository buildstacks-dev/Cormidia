#!/usr/bin/env -S pnpm exec tsx

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { remoteTrackingRef, resolveRemoteDefaultBranch } from "../src/loop/default-branch.js";

const SCHEMA_VERSION = "worktree-reconcile/v1";

export interface WorktreeRecord {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly detached: boolean;
}

export interface RemoteBranchRecord {
  readonly name: string;
  readonly oid: string;
}

export interface BranchReport {
  readonly name: string;
  readonly oid: string;
  readonly worktree: string | null;
  readonly dirty: boolean | null;
  readonly remote: boolean;
  readonly merged: boolean | null;
  readonly upstream: string | null;
  readonly tracking: string | null;
}

export interface ReconcileReport {
  readonly schema_version: string;
  readonly repository: string;
  readonly remote: string;
  readonly default_branch: string;
  readonly default_ref: string;
  readonly current_branch: string | null;
  readonly worktrees: readonly (WorktreeRecord & { readonly dirty: boolean | null })[];
  readonly local_branches: readonly BranchReport[];
  readonly remote_branches: readonly BranchReport[];
}

interface CliOptions {
  readonly apply: boolean;
  readonly force: boolean;
  readonly json: boolean;
  readonly remote: string;
  readonly remoteDelete: boolean;
  readonly refresh: boolean;
  readonly keep: readonly string[];
  readonly path: string | undefined;
  readonly base: string | undefined;
  readonly setupCommand: string | undefined;
}

interface ParsedCli {
  readonly command: string;
  readonly positionals: readonly string[];
  readonly options: CliOptions;
}

export interface CleanCandidate {
  readonly branch: string;
  readonly path: string | null;
  readonly dirty: boolean | null;
  readonly remote: boolean;
  readonly local: boolean;
  readonly reason: "merged" | "gone";
}

export function parseWorktreePorcelain(input: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let currentPath: string | null = null;
  let currentHead: string | null = null;
  let currentBranch: string | null = null;

  const flush = (): void => {
    if (currentPath !== null) {
      records.push({
        path: currentPath,
        head: currentHead,
        branch: currentBranch,
        detached: currentBranch === null,
      });
    }
    currentPath = null;
    currentHead = null;
    currentBranch = null;
  };

  for (const line of input.split("\n")) {
    if (line === "") {
      flush();
    } else if (line.startsWith("worktree ")) {
      flush();
      currentPath = line.slice("worktree ".length);
    } else if (line.startsWith("HEAD ")) {
      currentHead = line.slice("HEAD ".length);
    } else if (line.startsWith("branch refs/heads/")) {
      currentBranch = line.slice("branch refs/heads/".length);
    }
  }
  flush();
  return records;
}

export function parseRemoteHeads(input: string): RemoteBranchRecord[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const [oid, ref] = line.split(/\s+/u);
      if (oid === undefined || ref === undefined || !ref.startsWith("refs/heads/")) {
        throw new Error(`cannot parse remote branch line: ${line}`);
      }
      return { name: ref.slice("refs/heads/".length), oid };
    });
}

export function sanitizeBranchForPath(branch: string): string {
  const safe = branch.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (safe === "") throw new Error(`branch cannot produce a worktree directory name: ${branch}`);
  return safe;
}

export function defaultWorktreePath(
  repoRoot: string,
  branch: string,
  configuredRoot = process.env.CORMIDIA_WORKTREE_ROOT ?? join(dirname(repoRoot), `${basename(repoRoot)}-worktrees`),
): string {
  return resolve(configuredRoot, sanitizeBranchForPath(branch));
}

function git(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    }).trim();
  } catch (error) {
    const detail = errorDetail(error);
    throw new Error(`git ${args[0] ?? "command"} failed${detail === "" ? "" : `: ${detail}`}`);
  }
}

function gitCheck(cwd: string, args: readonly string[]): boolean {
  try {
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

function errorDetail(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim() !== "") return stderr.trim();
  return error instanceof Error ? error.message.trim() : String(error).trim();
}

function repositoryRoot(cwd: string): string {
  return resolve(git(cwd, ["rev-parse", "--show-toplevel"]));
}

function currentBranch(repoRoot: string): string | null {
  const branch = git(repoRoot, ["branch", "--show-current"]);
  return branch === "" ? null : branch;
}

function worktrees(repoRoot: string): WorktreeRecord[] {
  return parseWorktreePorcelain(git(repoRoot, ["worktree", "list", "--porcelain"]));
}

function worktreeStatus(path: string): boolean | null {
  if (!existsSync(path)) return null;
  return git(path, ["status", "--porcelain=v1"]) !== "";
}

function localBranches(repoRoot: string): Array<{
  name: string;
  oid: string;
  upstream: string | null;
  tracking: string | null;
}> {
  const raw = git(repoRoot, [
    "for-each-ref",
    "--format=%(refname:short)%09%(objectname)%09%(upstream:short)%09%(upstream:track)",
    "refs/heads",
  ]);
  if (raw === "") return [];
  return raw.split("\n").map((line) => {
    const [name, oid, upstream = "", tracking = ""] = line.split("\t");
    if (name === undefined || oid === undefined) throw new Error(`cannot parse local branch line: ${line}`);
    return {
      name,
      oid,
      upstream: upstream === "" ? null : upstream,
      tracking: tracking === "" ? null : tracking,
    };
  });
}

function remoteBranches(repoRoot: string, remote: string): RemoteBranchRecord[] {
  return parseRemoteHeads(git(repoRoot, ["ls-remote", "--heads", remote]));
}

function refExists(repoRoot: string, ref: string): boolean {
  return gitCheck(repoRoot, ["rev-parse", "--verify", "--quiet", ref]);
}

function mergedInto(repoRoot: string, candidate: string, base: string): boolean | null {
  if (!refExists(repoRoot, base)) return null;
  return gitCheck(repoRoot, ["merge-base", "--is-ancestor", candidate, base]);
}

function buildReport(repoRoot: string, remote: string): ReconcileReport {
  const defaultBranch = resolveRemoteDefaultBranch(remote, {
    cwd: repoRoot,
    errorPrefix: "worktree reconcile",
  });
  const defaultRef = remoteTrackingRef(defaultBranch);
  const registeredWorktrees = worktrees(repoRoot);
  const worktreeByBranch = new Map(
    registeredWorktrees
      .filter((item): item is WorktreeRecord & { readonly branch: string } => item.branch !== null)
      .map((item) => [item.branch, item]),
  );
  const local = localBranches(repoRoot);
  const remoteItems = remoteBranches(repoRoot, remote);
  const remoteNames = new Set(remoteItems.map((item) => item.name));
  const branchReport = (item: {
    name: string;
    oid: string;
    upstream?: string | null;
    tracking?: string | null;
  }): BranchReport => {
    const worktree = worktreeByBranch.get(item.name);
    return {
      name: item.name,
      oid: item.oid,
      worktree: worktree?.path ?? null,
      dirty: worktree === undefined ? null : worktreeStatus(worktree.path),
      remote: remoteNames.has(item.name),
      merged: mergedInto(repoRoot, `refs/heads/${item.name}`, defaultRef),
      upstream: item.upstream ?? null,
      tracking: item.tracking ?? null,
    };
  };

  return {
    schema_version: SCHEMA_VERSION,
    repository: repoRoot,
    remote,
    default_branch: defaultBranch,
    default_ref: defaultRef,
    current_branch: currentBranch(repoRoot),
    worktrees: registeredWorktrees.map((item) => ({ ...item, dirty: worktreeStatus(item.path) })),
    local_branches: local.map(branchReport),
    remote_branches: remoteItems.map((item) => ({
      ...branchReport({ name: item.name, oid: item.oid }),
      merged: mergedInto(repoRoot, `refs/remotes/${remote}/${item.name}`, defaultRef),
    })),
  };
}

function parseOptions(args: readonly string[]): ParsedCli {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const positionals: string[] = [];
  const keep: string[] = [];
  let command = "help";
  let apply = false;
  let force = false;
  let json = false;
  let remote = "origin";
  let remoteDelete = false;
  let refresh = false;
  let path: string | undefined;
  let base: string | undefined;
  let setupCommand: string | undefined;

  if (normalizedArgs[0] !== undefined && !normalizedArgs[0].startsWith("-")) command = normalizedArgs[0];
  let index = command === "help" ? 0 : 1;
  while (index < normalizedArgs.length) {
    const arg = normalizedArgs[index];
    if (arg === undefined) break;
    switch (arg) {
      case "--apply":
        apply = true;
        break;
      case "--force":
        force = true;
        break;
      case "--json":
        json = true;
        break;
      case "--merged":
      case "--gone":
        positionals.push(arg.slice(2));
        break;
      case "--remote":
        remoteDelete = true;
        if (normalizedArgs[index + 1] !== undefined && !normalizedArgs[index + 1]!.startsWith("-"))
          remote = normalizedArgs[++index]!;
        break;
      case "--refresh":
        refresh = true;
        break;
      case "--keep":
        keep.push(requiredOption(normalizedArgs[++index], "--keep"));
        break;
      case "--path":
        path = requiredOption(normalizedArgs[++index], "--path");
        break;
      case "--base":
        base = requiredOption(normalizedArgs[++index], "--base");
        break;
      case "--setup-command":
        setupCommand = requiredOption(normalizedArgs[++index], "--setup-command");
        break;
      case "--help":
      case "-h":
        command = "help";
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
        positionals.push(arg);
        break;
    }
    index += 1;
  }
  return {
    command,
    positionals,
    options: {
      apply,
      force,
      json,
      remote,
      remoteDelete,
      refresh,
      keep,
      path,
      base,
      setupCommand,
    },
  };
}

function requiredOption(value: string | undefined, option: string): string {
  if (value === undefined || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return value;
}

function usage(): string {
  return `Worktree lifecycle helper

Usage:
  pnpm worktree -- reconcile [--json] [--remote <name>]
  pnpm worktree -- create <branch> [--path <dir>] [--base <ref>] [--setup-command <cmd>]
  pnpm worktree -- remove <branch> [--force] [--remote <name>]
  pnpm worktree -- clean --merged [--apply] [--remote <name>] [--refresh] [--force] [--keep <branch>]
  pnpm worktree -- clean --gone [--apply] [--force] [--keep <branch>]

Safety:
  reconcile is read-only.
  clean is a dry-run unless --apply is present.
  Remote deletion requires --remote and --apply.
  Dirty worktrees require --force; the default branch and current checkout are protected.

--merged uses Git ancestry against the remote's advertised default branch.
Squash-merged or closed PR branches remain candidates for explicit review.\n`;
}

function printReport(report: ReconcileReport): void {
  console.log(`repository: ${report.repository}`);
  console.log(`remote: ${report.remote}`);
  console.log(`default: ${report.default_branch} (${report.default_ref})`);
  console.log(`current: ${report.current_branch ?? "detached"}`);
  console.log("worktrees:");
  for (const item of report.worktrees) {
    console.log(
      `  ${item.path}\t${item.branch ?? "(detached)"}\t${item.dirty === null ? "missing" : item.dirty ? "dirty" : "clean"}`,
    );
  }
  console.log("local branches:");
  for (const item of report.local_branches) {
    console.log(
      `  ${item.name}\t${item.merged === null ? "unknown" : item.merged ? "merged" : "unmerged"}\t${item.remote ? "remote" : "local-only"}\t${item.dirty === null ? "no-worktree" : item.dirty ? "dirty" : "clean"}`,
    );
  }
  console.log("remote branches:");
  for (const item of report.remote_branches) {
    console.log(
      `  ${item.name}\t${item.merged === null ? "unknown" : item.merged ? "merged" : "unmerged"}\t${item.worktree === null ? "no-local-branch" : item.dirty ? "dirty" : "local"}`,
    );
  }
}

function assertNotProtected(branch: string, report: ReconcileReport, keep: readonly string[]): void {
  const protectedBranches = new Set([report.default_branch, report.current_branch ?? "", ...keep]);
  if (protectedBranches.has(branch)) throw new Error(`refusing to mutate protected branch: ${branch}`);
}

function refreshRemote(repoRoot: string, remote: string): void {
  console.log(`refreshing ${remote} remote-tracking refs`);
  git(repoRoot, ["fetch", remote, "--prune"]);
}

export function cleanCandidates(
  report: ReconcileReport,
  mode: "merged" | "gone",
  keep: readonly string[],
  force: boolean,
): CleanCandidate[] {
  const candidates: CleanCandidate[] = [];
  for (const branch of report.local_branches) {
    if (branch.name === report.default_branch || branch.name === report.current_branch || keep.includes(branch.name))
      continue;
    const matches = mode === "merged" ? branch.merged === true : branch.tracking === "[gone]";
    if (!matches) continue;
    if (mode === "gone" && !force) {
      console.log(`SKIP gone upstream (use --force): ${branch.name}`);
      continue;
    }
    if (branch.dirty === true && !force) {
      console.log(`SKIP dirty worktree (use --force): ${branch.name}`);
      continue;
    }
    candidates.push({
      branch: branch.name,
      path: branch.worktree,
      dirty: branch.dirty,
      remote: branch.remote,
      local: true,
      reason: mode,
    });
  }
  if (mode === "merged") {
    const localNames = new Set(report.local_branches.map((branch) => branch.name));
    for (const branch of report.remote_branches) {
      if (localNames.has(branch.name)) continue;
      if (branch.name === report.default_branch || keep.includes(branch.name)) continue;
      if (branch.merged !== true) continue;
      candidates.push({
        branch: branch.name,
        path: null,
        dirty: null,
        remote: true,
        local: false,
        reason: mode,
      });
    }
  }
  return candidates;
}

function executeClean(repoRoot: string, candidates: readonly CleanCandidate[], options: CliOptions): void {
  for (const candidate of candidates) {
    console.log(
      `${options.apply ? "DELETE" : "PLAN"} ${candidate.reason}: ${candidate.branch}${candidate.path === null ? "" : ` (${candidate.path})`}`,
    );
    if (!options.apply) continue;
    if (candidate.local) {
      if (candidate.path !== null)
        git(repoRoot, ["worktree", "remove", ...(candidate.dirty === true ? ["--force"] : []), candidate.path]);
      git(repoRoot, ["branch", options.force ? "-D" : "-d", candidate.branch]);
    }
    if (options.remoteDelete && candidate.remote) git(repoRoot, ["push", options.remote, "--delete", candidate.branch]);
  }
}

function createWorktree(repoRoot: string, branch: string, options: CliOptions): void {
  if (branch === "") throw new Error("create requires a branch name");
  const defaultBranch = resolveRemoteDefaultBranch(options.remote, {
    cwd: repoRoot,
    errorPrefix: "worktree create",
  });
  const base = options.base ?? remoteTrackingRef(defaultBranch);
  const path = resolve(options.path ?? defaultWorktreePath(repoRoot, branch));
  const repoRelativePath = relative(repoRoot, path);
  if (repoRelativePath === "" || (!repoRelativePath.startsWith("..") && !isAbsolute(repoRelativePath))) {
    throw new Error(`worktree path must be outside the current checkout: ${path}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  const existingBranch = refExists(repoRoot, `refs/heads/${branch}`);
  git(repoRoot, [
    "worktree",
    "add",
    ...(existingBranch ? [] : ["-b", branch]),
    path,
    ...(existingBranch ? [branch] : [base]),
  ]);
  console.log(`created ${branch}: ${path}`);
  if (options.setupCommand !== undefined) {
    const result = spawnSync("sh", ["-lc", options.setupCommand], { cwd: path, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`setup command failed in ${path}`);
  }
}

function removeWorktree(repoRoot: string, branch: string, options: CliOptions): void {
  const report = buildReport(repoRoot, options.remote);
  assertNotProtected(branch, report, []);
  const local = report.local_branches.find((item) => item.name === branch);
  if (local === undefined) throw new Error(`local branch does not exist: ${branch}`);
  if (local.dirty === true && !options.force) throw new Error(`worktree is dirty; rerun with --force: ${branch}`);
  if (local.worktree !== null)
    git(repoRoot, ["worktree", "remove", ...(options.force ? ["--force"] : []), local.worktree]);
  git(repoRoot, ["branch", options.force ? "-D" : "-d", branch]);
  if (options.remoteDelete && local.remote) git(repoRoot, ["push", options.remote, "--delete", branch]);
}

async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseOptions(argv);
  const repoRoot = repositoryRoot(process.cwd());
  const options = parsed.options;
  switch (parsed.command) {
    case "help":
      process.stdout.write(usage());
      return;
    case "reconcile": {
      const report = buildReport(repoRoot, options.remote);
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else printReport(report);
      return;
    }
    case "create":
      createWorktree(repoRoot, parsed.positionals[0] ?? "", options);
      return;
    case "remove":
      removeWorktree(repoRoot, parsed.positionals[0] ?? "", options);
      return;
    case "clean": {
      const mode = parsed.positionals.find((item): item is "merged" | "gone" => item === "merged" || item === "gone");
      if (mode === undefined) throw new Error("clean requires --merged or --gone");
      if (options.refresh) refreshRemote(repoRoot, options.remote);
      const report = buildReport(repoRoot, options.remote);
      const candidates = cleanCandidates(report, mode, options.keep, options.force);
      if (candidates.length === 0) console.log("no cleanup candidates");
      executeClean(repoRoot, candidates, options);
      if (options.remoteDelete && !options.apply)
        console.log("remote deletion is planned only; add --apply to execute it");
      return;
    }
    default:
      throw new Error(`unknown command: ${parsed.command}`);
  }
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
