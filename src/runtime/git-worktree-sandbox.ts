import { execFileSync } from "node:child_process";
import { closeSync, openSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export interface GitIndexPreflightResult {
  status: "pass" | "fail";
  gitDir?: string;
  indexPath?: string;
  errorCode?: "error_git_worktree_invalid" | "error_git_index_unwritable";
  detail: string;
}

/** Writable roots required for Git mutations in a checkout.
 *
 * A linked worktree's `.git` is a pointer file. Its index/HEAD/log live in the
 * per-worktree administrative directory and commits also write objects and
 * branch refs in the shared common directory. Confine source writes to the
 * requested worktree while explicitly admitting only those Git-owned paths.
 * Non-Git workdirs retain the ordinary single-root sandbox.
 */
export function gitWorktreeWritableRoots(workdir: string): string[] {
  const root = resolve(workdir);
  try {
    const layout = gitWorktreeLayout(root);
    const candidates = [
      root,
      layout.gitDir,
      layout.objectsDir,
      dirname(layout.branchRefPath),
      dirname(layout.branchReflogPath),
    ];
    // For a normal checkout every Git path is already beneath the workdir.
    // For a linked worktree retain only the exact external mutation roots.
    return candidates.filter((candidate, index) =>
      index === 0 ||
      (!isWithin(candidate, root) &&
        candidates.findIndex((other) => other === candidate) === index)
    );
  } catch {
    return [root];
  }
}

/** Cheap provision-time probe of the exact lock Git must create for staging.
 * The probe neither stages nor changes source files. A failure leaves the
 * worktree intact for operator recovery and is specific enough to stop before
 * a paid builder turn. */
export function preflightGitWorktreeIndex(workdir: string): GitIndexPreflightResult {
  const root = resolve(workdir);
  let layout: ReturnType<typeof gitWorktreeLayout>;
  try {
    layout = gitWorktreeLayout(root);
  } catch (error) {
    return {
      status: "fail",
      errorCode: "error_git_worktree_invalid",
      detail: `Git index preflight could not resolve the checkout: ${errorMessage(error)}`,
    };
  }
  const lockPath = `${layout.indexPath}.lock`;
  let descriptor: number | undefined;
  let created = false;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
    created = true;
    closeSync(descriptor);
    descriptor = undefined;
    unlinkSync(lockPath);
    created = false;
    return {
      status: "pass",
      gitDir: layout.gitDir,
      indexPath: layout.indexPath,
      detail: `Git index lock is writable at ${lockPath}`,
    };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (created) {
      try {
        unlinkSync(lockPath);
      } catch {
        // Preserve the original failure; an unremovable lock is itself
        // evidence the builder cannot stage safely.
      }
    }
    return {
      status: "fail",
      gitDir: layout.gitDir,
      indexPath: layout.indexPath,
      errorCode: "error_git_index_unwritable",
      detail:
        `Git index preflight cannot create ${lockPath}: ${errorMessage(error)}. ` +
        `The worktree is preserved at ${root}.`,
    };
  }
}

function gitWorktreeLayout(workdir: string): {
  gitDir: string;
  indexPath: string;
  objectsDir: string;
  branchRefPath: string;
  branchReflogPath: string;
} {
  const gitDir = gitPath(workdir, ["rev-parse", "--absolute-git-dir"]);
  const branchRef = execFileSync("git", ["symbolic-ref", "-q", "HEAD"], {
    cwd: workdir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!branchRef.startsWith("refs/heads/")) {
    throw new Error("checkout HEAD is not attached to a local branch");
  }
  return {
    gitDir,
    indexPath: gitPath(workdir, ["rev-parse", "--git-path", "index"]),
    objectsDir: gitPath(workdir, ["rev-parse", "--git-path", "objects"]),
    branchRefPath: gitPath(workdir, ["rev-parse", "--git-path", branchRef]),
    branchReflogPath: gitPath(workdir, ["rev-parse", "--git-path", `logs/${branchRef}`]),
  };
}

function gitPath(workdir: string, args: string[]): string {
  const output = execFileSync("git", args, {
    cwd: workdir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (output === "") throw new Error(`git returned an empty path for ${args.join(" ")}`);
  return resolve(isAbsolute(output) ? output : resolve(workdir, output));
}

function isWithin(candidate: string, parent: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === "" ||
    (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
