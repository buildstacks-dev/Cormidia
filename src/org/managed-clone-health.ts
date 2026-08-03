// Read-only health of the org-managed app clones under `<state-home>/repos/`.
//
// ISSUE-010: a turn that stopped at its per-turn budget cap left a complete,
// uncommitted migration in the managed clone, and nothing in the product said
// so. `cormidia status` reports runs, `cormidia analyze` reports anomalies, and
// neither looks at the working tree the next turn will inherit. The condition
// is knowable from local git alone, so `doctor` — which already proves state
// health before work starts — is where it belongs.
//
// Every call here is a local read. No fetch, no network, no writes, no
// index refresh that could change on-disk state.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Bounded number of porcelain entries carried into a report line. */
const STATUS_SAMPLE_LIMIT = 5;

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_OPTIONAL_LOCKS: "0",
};

export interface ManagedCloneHealth {
  app: string;
  path: string;
  /** False when Cormidia has not cloned this app yet — not a problem. */
  present: boolean;
  branch?: string;
  head?: string;
  /** True when tracked or untracked changes exist in the working tree. */
  dirty: boolean;
  statusEntries: number;
  /** First few porcelain entries, so the report names actual paths. */
  sample: string[];
  /** Set when the clone exists but cannot be inspected (corrupt, not a repo). */
  error?: string;
}

/** Inspect one managed clone without mutating it. */
export function inspectManagedClone(stateHome: string, app: string): ManagedCloneHealth {
  const path = managedClonePath(stateHome, app);
  if (!existsSync(join(path, ".git"))) {
    return { app, path, present: false, dirty: false, statusEntries: 0, sample: [] };
  }
  try {
    const status = git(path, "status", "--porcelain=v1", "--untracked-files=all");
    const entries = status === "" ? [] : status.split("\n");
    return {
      app,
      path,
      present: true,
      branch: gitOrEmpty(path, "branch", "--show-current"),
      head: gitOrEmpty(path, "rev-parse", "HEAD"),
      dirty: entries.length > 0,
      statusEntries: entries.length,
      sample: entries.slice(0, STATUS_SAMPLE_LIMIT).map((entry) => entry.trim()),
    };
  } catch (error) {
    return {
      app,
      path,
      present: true,
      dirty: false,
      statusEntries: 0,
      sample: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function inspectManagedClones(
  stateHome: string,
  apps: readonly string[],
): ManagedCloneHealth[] {
  return apps.map((app) => inspectManagedClone(stateHome, app));
}

export function managedClonePath(stateHome: string, app: string): string {
  return join(stateHome, "repos", app);
}

/**
 * One operator-facing line per clone. A dirty managed clone is a WARN, not a
 * FAIL: the work in it may be exactly what someone wants to keep, and doctor
 * must never imply that discarding it is the remedy.
 */
export function describeManagedClone(health: ManagedCloneHealth): {
  status: "OK" | "WARN";
  detail: string;
} {
  if (health.error !== undefined) {
    return { status: "WARN", detail: `${health.path} cannot be inspected: ${health.error}` };
  }
  if (!health.present) {
    return { status: "OK", detail: "not cloned yet; created on first managed turn" };
  }
  if (!health.dirty) {
    return { status: "OK", detail: `clean on ${health.branch || "detached HEAD"}` };
  }
  const more = health.statusEntries - health.sample.length;
  return {
    status: "WARN",
    detail:
      `uncommitted work on ${health.branch || "detached HEAD"}: ${health.statusEntries} ` +
      `entr${health.statusEntries === 1 ? "y" : "ies"} (${health.sample.join(", ")}` +
      `${more > 0 ? `, +${more} more` : ""}). ` +
      "The next managed turn inherits this tree. Nothing was changed; inspect with: " +
      `git -C ${health.path} status --short`,
  };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitOrEmpty(cwd: string, ...args: string[]): string {
  try {
    return git(cwd, ...args);
  } catch {
    return "";
  }
}
