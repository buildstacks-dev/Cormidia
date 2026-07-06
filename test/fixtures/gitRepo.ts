// Local git-repo test fixtures (build plan M4.1).
//
// Real-git, zero-network test substrate for the two places the build loop
// touches git directly:
//
// - `makeWorkingRepo()` — a single working repo with an initial commit and a
//   package.json whose test/lint scripts are caller-configured. The quality
//   gates run as subprocesses *against a real worktree* (docs/loop.md §5,
//   §10: qgates is pure subprocess + git), so their tests need a repo whose
//   `pnpm`/`node` scripts and `git diff` output are real, not mocked.
// - `makeBareWithClone()` — a bare "origin" plus a working clone, so
//   push / squash-merge / branch-delete semantics are the real thing
//   (docs/architecture.md §3 idempotency rule 1: durable side effects are
//   git/GitHub ops — the git half is proven here; M5.2 pairs this with
//   FakeGhOps for the GitHub half).
//
// Both constructors share one commit-helper core (`repoHandle`). Everything
// shells out to the system `git` via node:child_process — adding a git npm
// package would be a dependency decision (AGENTS.md), and the point is to
// test against real git anyway.
//
// Every git call runs with global/system config masked and a fixed fixture
// identity, so results don't depend on the developer's ~/.gitconfig
// (commit.gpgsign, init.defaultBranch, hooks templates, …).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// git runner — isolated env, loud failures
// ---------------------------------------------------------------------------

const fixtureGitEnv: NodeJS.ProcessEnv = {
  ...process.env,
  // Mask the developer's config entirely; the fixture sets everything it needs.
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "Operon Fixture",
  GIT_AUTHOR_EMAIL: "fixture@operon.invalid",
  GIT_COMMITTER_NAME: "Operon Fixture",
  GIT_COMMITTER_EMAIL: "fixture@operon.invalid",
  // Zero network is the contract — if anything ever prompts, fail instead.
  GIT_TERMINAL_PROMPT: "0",
};

/** Run `git <args>` in `cwd`; returns trimmed stdout. Non-zero exit throws
 * with the full command and stderr — never silent best-effort. */
function runGit(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      env: fixtureGitEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const detail = typeof stderr === "string" && stderr.trim() !== "" ? `\n${stderr.trim()}` : "";
    throw new Error(`gitRepo fixture: \`git ${args.join(" ")}\` failed in ${cwd}${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Shared commit-helper core
// ---------------------------------------------------------------------------

/** The commit helpers both constructors share. `root` is the working tree. */
export interface RepoHandle {
  /** Absolute path of the repo's working tree. */
  root: string;
  /** Run any git command in this repo; trimmed stdout, throws on failure. */
  git(...args: string[]): string;
  /** Write files (paths relative to root, parent dirs created) — no commit. */
  writeFiles(files: Record<string, string>): void;
  /** Optionally write `files`, then stage everything and commit.
   * Returns the new commit sha. Nothing to commit throws (real semantics —
   * a test that expected a commit should hear about it). */
  commit(message: string, files?: Record<string, string>): string;
  /** Current HEAD sha. */
  head(): string;
  /** Commit subjects reachable from `ref`, newest first. */
  log(ref?: string): string[];
  /** Paths changed between two refs (`git diff --name-only from to`);
   * `to` defaults to HEAD. */
  changedFiles(from: string, to?: string): string[];
}

function repoHandle(root: string): RepoHandle {
  const git = (...args: string[]) => runGit(root, args);
  return {
    root,
    git,
    writeFiles: (files) => writeFilesUnder(root, files),
    commit: (message, files) => {
      if (files) writeFilesUnder(root, files);
      git("add", "-A");
      git("commit", "-m", message);
      return git("rev-parse", "HEAD");
    },
    head: () => git("rev-parse", "HEAD"),
    log: (ref = "HEAD") => splitLines(git("log", "--format=%s", ref)),
    changedFiles: (from, to = "HEAD") => splitLines(git("diff", "--name-only", from, to)),
  };
}

// ---------------------------------------------------------------------------
// makeWorkingRepo — single repo for the quality gates (M4.3–M4.5)
// ---------------------------------------------------------------------------

export interface WorkingRepoOptions {
  /** package.json `scripts.test` — what the tests gate will run (loop.md §5
   * `test_command` row). Omitted → no test script. */
  testCommand?: string;
  /** package.json `scripts.lint` — the lint gate's command. */
  lintCommand?: string;
}

export interface WorkingRepoFixture extends RepoHandle {
  /** Removes the repo. Safe to call more than once. */
  cleanup(): void;
}

/** A real working repo on branch `main` with one initial commit containing a
 * package.json whose scripts are caller-configured. */
export function makeWorkingRepo(options: WorkingRepoOptions = {}): WorkingRepoFixture {
  const root = mkdtempSync(join(tmpdir(), "operon-gitrepo-"));
  runGit(root, ["init", "--initial-branch=main"]);
  const handle = repoHandle(root);

  const scripts: Record<string, string> = {};
  if (options.testCommand !== undefined) scripts.test = options.testCommand;
  if (options.lintCommand !== undefined) scripts.lint = options.lintCommand;
  handle.commit("chore: init fixture app", {
    "package.json": JSON.stringify({ name: "fixture-app", private: true, scripts }, null, 2) + "\n",
  });

  return { ...handle, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// makeBareWithClone — bare origin + working clone (M5 merge semantics)
// ---------------------------------------------------------------------------

/** The bare origin exposes only inspection — a bare repo has no working tree
 * to write or commit in. Its `log`/`git` are how tests observe what actually
 * arrived on origin (the point of the pair). */
export interface BareRepoHandle {
  /** Absolute path of the bare repo (the `origin.git` directory). */
  root: string;
  git(...args: string[]): string;
  log(ref?: string): string[];
}

export interface BareCloneFixture {
  /** Shared temp root containing both repos — cleanup removes everything. */
  root: string;
  /** The bare origin (`<root>/origin.git`). */
  bare: BareRepoHandle;
  /** The working clone (`<root>/clone`), origin already wired up and `main`
   * tracking `origin/main` with one pushed seed commit. */
  clone: RepoHandle;
  /** Removes both repos (one shared temp root). Safe to call more than once. */
  cleanup(): void;
}

/** A bare origin plus a working clone, seeded so `origin/main` exists: real
 * push, squash-merge, and branch-delete semantics with zero network. */
export function makeBareWithClone(): BareCloneFixture {
  const root = mkdtempSync(join(tmpdir(), "operon-gitpair-"));
  const bareRoot = join(root, "origin.git");
  runGit(root, ["init", "--bare", "--initial-branch=main", bareRoot]);

  const cloneRoot = join(root, "clone");
  runGit(root, ["clone", bareRoot, cloneRoot]);
  const clone = repoHandle(cloneRoot);
  // Seed main and push it so origin has a main branch to merge into.
  clone.commit("chore: init origin main", { "README.md": "# fixture origin\n" });
  clone.git("push", "-u", "origin", "main");

  const bareGit = (...args: string[]) => runGit(bareRoot, args);
  return {
    root,
    bare: {
      root: bareRoot,
      git: bareGit,
      log: (ref = "HEAD") => splitLines(bareGit("log", "--format=%s", ref)),
    },
    clone,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function writeFilesUnder(root: string, files: Record<string, string>): void {
  for (const [relPath, content] of Object.entries(files)) {
    const path = join(root, relPath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
}

function splitLines(output: string): string[] {
  return output === "" ? [] : output.split("\n");
}
