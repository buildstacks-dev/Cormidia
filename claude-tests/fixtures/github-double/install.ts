// GitHub double v1 — installer + test handle (HB-003, boundary B-01).
//
// PRIMARY SEAM (one seam, deliberately): the `gh` PROCESS seam. Product code
// reaches GitHub by spawning `gh` (src/loop/github.ts defaultGhExec, and
// src/observe/github-source.ts `gh pr checks`), resolving the executable via
// PATH. `installGithubDouble()` builds a temp home containing:
//
//   bin/gh        executable node shim (shebang), pinned to this home
//   gh-engine.cjs engine.ts transpiled to CommonJS at install time
//   state.json    the repo state machine (issues/PRs/reviews/labels/branches)
//   scenario.json scripted per-call failure steps, consumed FIFO
//
// `handle.activatePath()` prepends bin/ to process.env.PATH so every product
// call path — including the many `new GhCliOps(repo)` sites with no injection
// option — runs UNMODIFIED against the double. `handle.exec` spawns the shim
// by absolute path for fixture-side plumbing (same process seam, no global
// PATH mutation).
//
// The engine is transpiled (typescript's transpileModule, a devDependency the
// repo already carries) rather than committed as plain JS so there is exactly
// ONE typechecked source of truth for the state machine, usable both
// in-process (this module imports it directly) and under plain `node` in the
// shim subprocess.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import ts from "typescript";

import type { GhExec, GhExecResult } from "../../../src/loop/github.js";
import {
  appendScenarioSteps,
  nextOid,
  readDoubleState,
  undrainedScenarioSteps,
  withDoubleState,
  type CallLogEntry,
  type DoubleCheck,
  type DoubleLabel,
  type DoubleLies,
  type DoubleState,
  type ScenarioStep,
} from "./engine.js";

export type { ScenarioStep, DoubleState, DoubleLies, FailureKind } from "./engine.js";

export interface GithubDoubleOptions {
  /** owner/name slug; defaults to an obviously synthetic, nonexistent repo. */
  repo?: string;
  /** Configurable default branch (B-01: never assume `main`). */
  defaultBranch?: string;
  /** Repo labels present at install (product ensures its own via ensureLabel). */
  labels?: DoubleLabel[];
  /** Extra branches seeded at install (beyond the default branch). */
  branches?: string[];
  /** Reject own-PR approve/request-changes like the single-account pilot. */
  singleAccount?: boolean;
  viewerLogin?: string;
  /** Deliberate misbehaviors — ONLY for conformance negative controls. */
  lies?: DoubleLies;
  /** Initial scripted steps (more can be added later via handle.script). */
  scenario?: ScenarioStep[];
}

export interface GithubDoubleHandle {
  readonly home: string;
  readonly binDir: string;
  readonly repo: string;
  /** Spawn the shim by absolute path — the same process seam without PATH. */
  readonly exec: GhExec;
  /** Prepend bin/ to process.env.PATH; returns the restore function. */
  activatePath(): () => void;
  readState(): DoubleState;
  callLog(): CallLogEntry[];
  /** Append scripted failure steps (consumed FIFO by matching calls). */
  script(...steps: ScenarioStep[]): void;
  /** Throw if any scripted step never matched a call — a silent no-op script
   *  would otherwise be green by absence. */
  assertScenarioDrained(): void;
  /** Create a branch off the current default tip; returns its head oid. */
  seedBranch(name: string): string;
  /** Model a push: new head oid; open PRs on the branch follow. */
  advanceBranch(name: string): string;
  /** Model a human force-push/history rewrite: same observable effect as a
   *  push, logged separately, used for review-fence skew cases. */
  forcePush(name: string): string;
  /** Move the remote default branch (created if missing). */
  moveDefaultBranch(name: string): void;
  /** First-class push mirror (HB-023): set a branch tip to an EXACT oid.
   *  J04 walks push real git commits to a real file:// origin while the
   *  double models remote heads abstractly, so tests sync the modeled tip to
   *  the worktree's true HEAD (the Wave-0 skeleton patched state.json by
   *  hand for this). Same semantics as `setBranchHead(home, …)` below. */
  setBranchHead(branch: string, oid: string): void;
  setChecks(prNumber: number, checks: DoubleCheck[]): void;
  dispose(): Promise<void>;
}

/** Standalone form of the push mirror, usable from a subprocess that only
 *  holds the double's `home` path (kill-point scenarios cannot share the
 *  parent's handle closure). Mirrors a real `git push <branch>` into the
 *  double's remote model:
 *  - the branch tip becomes EXACTLY `oid` (never a synthetic one);
 *  - a missing branch is created (a push can create a branch);
 *  - open PRs whose head is the branch follow the push, with the pre-push
 *    shape kept in `staleShadow` — identical to `advanceBranch`'s semantics.
 *  Returns the oid for symmetry with the seed/advance helpers. */
export function setBranchHead(home: string, branch: string, oid: string): string {
  if (oid.trim() === "") throw new Error("github double: setBranchHead requires a non-empty oid");
  return withDoubleState(home, (current) => {
    const existing = current.branches[branch];
    if (existing === undefined) {
      current.branches[branch] = { oid };
    } else {
      existing.oid = oid;
    }
    for (const pr of Object.values(current.prs)) {
      if (pr.headRefName === branch && pr.state === "OPEN" && pr.headRefOid !== oid) {
        current.staleShadow.prs[String(pr.number)] = structuredClone(pr);
        pr.headRefOid = oid;
      }
    }
    return oid;
  });
}

let engineCjsCache: string | undefined;

function engineCjs(): string {
  if (engineCjsCache === undefined) {
    const enginePath = fileURLToPath(new URL("./engine.ts", import.meta.url));
    const source = fs.readFileSync(enginePath, "utf8");
    const out = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    });
    engineCjsCache = out.outputText;
  }
  return engineCjsCache;
}

function spawnShim(ghPath: string): GhExec {
  return (args: readonly string[], input?: string): Promise<GhExecResult> =>
    new Promise((resolve) => {
      const child = spawn(ghPath, [...args], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        resolve({ stdout, stderr: stderr + error.message, exitCode: 1 });
      });
      child.on("close", (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });
      if (input !== undefined) child.stdin.end(input);
      else child.stdin.end();
    });
}

let installSeq = 0;

export async function installGithubDouble(
  options: GithubDoubleOptions = {},
): Promise<GithubDoubleHandle> {
  installSeq += 1;
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cormidia-github-double-"));
  const binDir = path.join(home, "bin");
  await fs.promises.mkdir(binDir);

  const repo = options.repo ?? `cormidia-double/sandbox-${process.pid}-${installSeq}`;
  const defaultBranch = options.defaultBranch ?? "main";

  const enginePath = path.join(home, "gh-engine.cjs");
  await fs.promises.writeFile(enginePath, engineCjs());
  const ghPath = path.join(binDir, "gh");
  await fs.promises.writeFile(
    ghPath,
    `#!/usr/bin/env node\nrequire(${JSON.stringify(enginePath)}).shimMain(${JSON.stringify(home)});\n`,
    { mode: 0o755 },
  );

  const state: DoubleState = {
    config: {
      repo,
      singleAccount: options.singleAccount ?? false,
      viewerLogin: options.viewerLogin ?? "cormidia-double",
      epochIso: "2026-01-01T00:00:00.000Z",
      lies: options.lies ?? {},
    },
    defaultBranch,
    labels: {},
    branches: {},
    issues: {},
    prs: {},
    nextNumber: 1,
    oidSeq: 0,
    timeSeq: 0,
    staleShadow: { issues: {}, prs: {} },
    log: [],
  };
  for (const label of options.labels ?? []) {
    state.labels[label.name] = { ...label, color: label.color.toLowerCase() };
  }
  state.branches[defaultBranch] = { oid: nextOid(state, defaultBranch) };
  for (const branch of options.branches ?? []) {
    if (state.branches[branch] === undefined) {
      state.branches[branch] = { oid: nextOid(state, branch) };
    }
  }
  await fs.promises.writeFile(
    path.join(home, "state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
  );
  await fs.promises.writeFile(path.join(home, "scenario.json"), `${JSON.stringify({ steps: [] }, null, 2)}\n`);
  if (options.scenario !== undefined && options.scenario.length > 0) {
    appendScenarioSteps(home, options.scenario);
  }

  const exec = spawnShim(ghPath);

  const advance = (name: string, hint: string): string =>
    withDoubleState(home, (current) => {
      const branch = current.branches[name];
      if (branch === undefined) {
        throw new Error(`github double: branch "${name}" does not exist`);
      }
      const oid = nextOid(current, `${hint}:${name}`);
      branch.oid = oid;
      for (const pr of Object.values(current.prs)) {
        if (pr.headRefName === name && pr.state === "OPEN") {
          current.staleShadow.prs[String(pr.number)] = structuredClone(pr);
          pr.headRefOid = oid;
        }
      }
      return oid;
    });

  return {
    home,
    binDir,
    repo,
    exec,
    activatePath() {
      const previous = process.env.PATH ?? "";
      process.env.PATH = `${binDir}${path.delimiter}${previous}`;
      return () => {
        process.env.PATH = previous;
      };
    },
    readState() {
      return readDoubleState(home);
    },
    callLog() {
      return readDoubleState(home).log;
    },
    script(...steps: ScenarioStep[]) {
      appendScenarioSteps(home, steps);
    },
    assertScenarioDrained() {
      const undrained = undrainedScenarioSteps(home);
      if (undrained.length > 0) {
        throw new Error(
          `github double: ${undrained.length} scenario step(s) never matched a call: ${JSON.stringify(undrained)}`,
        );
      }
    },
    seedBranch(name: string) {
      return withDoubleState(home, (current) => {
        if (current.branches[name] !== undefined) {
          throw new Error(`github double: branch "${name}" already exists`);
        }
        const oid = nextOid(current, `seed:${name}`);
        current.branches[name] = { oid };
        return oid;
      });
    },
    advanceBranch(name: string) {
      return advance(name, "push");
    },
    forcePush(name: string) {
      return advance(name, "force-push");
    },
    moveDefaultBranch(name: string) {
      withDoubleState(home, (current) => {
        if (current.branches[name] === undefined) {
          current.branches[name] = { oid: nextOid(current, name) };
        }
        current.defaultBranch = name;
      });
    },
    setBranchHead(branch: string, oid: string) {
      setBranchHead(home, branch, oid);
    },
    setChecks(prNumber: number, checks: DoubleCheck[]) {
      withDoubleState(home, (current) => {
        const pr = current.prs[String(prNumber)];
        if (pr === undefined) throw new Error(`github double: no PR #${prNumber}`);
        pr.checks = checks.map((check) => ({ ...check }));
      });
    },
    async dispose() {
      await fs.promises.rm(home, { recursive: true, force: true });
    },
  };
}
