// The one place Operon answers "what branch does this remote call default?",
// and the value the execution paths carry instead of re-deriving an answer.
//
// Before #101 three layers each had their own idea of the base branch: the
// loop driver resolved the real one and dropped it, the pipelines defaulted to
// the literal `origin/main`, and the turn runner and manual planning preview
// hardcoded `main` outright. A fresh repository whose default branch is
// `master` (a stock `git init` with no `init.defaultBranch`) reached its first
// ticket tick and died inside git with `fatal: ambiguous argument
// 'origin/main': unknown revision`.
//
// The rule this module exists to enforce: resolve once from authoritative git
// metadata, carry the resolved value, and never substitute a guess. Callers
// that cannot obtain a `BaseRevision` must fail loudly rather than fall back —
// a wrong base branch silently diffs a ticket against the wrong tree, which is
// worse than not running.
//
// This lives in `src/loop` rather than `src/org` because both layers need it
// and the import direction is one-way (`src/org` → `src/loop` → `src/runtime`).

import { execFileSync } from "node:child_process";

/** Git invocation environment shared by every resolver call: never prompt for
 *  credentials (a hung tick is indistinguishable from a wedged org) and never
 *  let system config change what the remote is understood to advertise. */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
};

/** Wall-clock ceiling for the one network call this module makes.
 *
 *  `GIT_TERMINAL_PROMPT=0` stops a credential prompt from hanging, but not a
 *  stuck TCP connect. This resolver now runs on the per-turn path
 *  (`ensureManagedClone`), on planning, and on `bootstrap publish` — and it is
 *  synchronous, so a hung connection would wedge a dispatch tick indefinitely
 *  with no error to act on. Failing loudly after 30s is strictly better: the
 *  next tick retries, and the operator gets a message naming the remote. */
const RESOLVE_TIMEOUT_MS = 30_000;

/** The base a ticket's work is measured against, resolved once per loop tick
 *  and threaded through claim, build, gates, review, ship, and turn execution.
 *
 *  The two fields are deliberately separate because they are not always the
 *  same kind of thing. `ref` answers "what do I diff and branch from", which
 *  for an operator-supplied checkout is an immutable commit with no branch
 *  identity at all. `defaultBranch` answers "what do I merge into", which is
 *  always a real branch name on the app remote. Collapsing them is what let
 *  `origin/main` leak into paths that only ever needed a branch name. */
export interface BaseRevision {
  /** The rev ticket branches are cut from and every gate, brief, and route
   *  reassessment diff compares against. Either `origin/<defaultBranch>` for a
   *  managed clone, or an immutable commit SHA snapshotted from a supplied
   *  checkout. Never an assumed value. */
  readonly ref: string;
  /** The remote's advertised default branch — the pull-request base and merge
   *  target. Always resolved from git, never assumed to be `main`. */
  readonly defaultBranch: string;
}

/** The remote-tracking ref for a resolved default branch. Diffs compare
 *  against the remote's view rather than the local branch: the local branch
 *  can drift mid-tick, the fetched remote-tracking ref cannot. */
export function remoteTrackingRef(defaultBranch: string): string {
  return `origin/${defaultBranch}`;
}

/** A `BaseRevision` for a managed clone whose default branch has been
 *  resolved: diff against the remote-tracking ref, merge into the branch. */
export function baseRevisionForBranch(defaultBranch: string): BaseRevision {
  return { ref: remoteTrackingRef(defaultBranch), defaultBranch };
}

export interface ResolveRemoteDefaultBranchOptions {
  /** Directory to run git in. Required when `target` is a remote *name*
   *  (`origin`); optional when it is a URL or path. */
  cwd?: string;
  /** Prefix for thrown errors, so the failure names the layer that hit it
   *  (`loop`, `bootstrap`, `plan`) rather than this module. */
  errorPrefix?: string;
}

/** Resolve the default branch a remote advertises, via `git ls-remote --symref
 *  <target> HEAD`. `target` is either a remote name (with `cwd` inside the
 *  repo) or a URL/path.
 *
 *  Both failure modes are loud and actionable, and neither degrades to a
 *  guess. "Could not ask the remote" is usually auth or network. "The remote
 *  advertises nothing" means an empty repository — there is no default branch
 *  to discover yet, and inventing `main` is exactly how a `master` repo
 *  crashed its first tick with a raw git stack trace. */
export function resolveRemoteDefaultBranch(
  target: string,
  options: ResolveRemoteDefaultBranchOptions = {},
): string {
  const prefix = options.errorPrefix ?? "git";
  let output: string;
  try {
    output = execFileSync("git", ["ls-remote", "--symref", target, "HEAD"], {
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      env: GIT_ENV,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: RESOLVE_TIMEOUT_MS,
    });
  } catch (error) {
    // A timeout kill reads as a generic spawn failure otherwise, which sends
    // an operator looking for an auth problem that is not there.
    if ((error as { signal?: unknown }).signal === "SIGTERM") {
      throw new Error(
        `${prefix}: timed out after ${RESOLVE_TIMEOUT_MS / 1000}s resolving the default branch ` +
          `advertised by ${target} — the remote did not respond`,
      );
    }
    const detail = detailOf(error);
    throw new Error(
      `${prefix}: cannot resolve the default branch advertised by ${target}` +
        `${detail === "" ? "" : ` — ${detail}`}`,
    );
  }
  const branch = parseSymrefHead(output);
  if (branch === undefined) {
    throw new Error(
      `${prefix}: ${target} advertises no default branch (empty repository?) — ` +
        "push an initial commit or set the remote HEAD before continuing",
    );
  }
  return branch;
}

/** Pull the branch name out of `git ls-remote --symref` output. Exported for
 *  the parser's own tests: the shape (`ref: refs/heads/<name>\tHEAD`) is a git
 *  output contract, and a silent parse miss here degrades into the exact
 *  guessed-`main` behavior this module exists to prevent. */
export function parseSymrefHead(output: string): string | undefined {
  const match = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m.exec(output);
  return match?.[1];
}

function detailOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim() !== "") return stderr.trim();
  return error instanceof Error ? error.message.trim() : String(error).trim();
}
