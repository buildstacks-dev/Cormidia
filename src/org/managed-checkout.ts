// Org-owned clone synchronization and its cross-role mutation lock.
//
// This module deliberately sits below turn-runner and plan-auto so every
// Planner entry point can share the same managed checkout without creating an
// import cycle through the dispatcher.

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { baseRevisionForBranch, resolveRemoteDefaultBranch, type BaseRevision } from "../loop/default-branch.js";
import {
  acquireFileLock,
  releaseFileLock,
  withFileLock,
  type FileLockClock,
  type FileLockOptions,
  type FileLockToken,
} from "../runtime/file-lock.js";
import { runGit as git } from "../runtime/git.js";
import type { AppEntry } from "./apps.js";
import { definedProps } from "../runtime/optional-properties.js";

const GIT_CLONE_LOCK_STALE_MS = 2 * 60 * 1000;
const GIT_CLONE_LOCK_MAX_WAIT_MS = GIT_CLONE_LOCK_STALE_MS + 60 * 1000;

export { FileLockBusyError as AppGitLockBusyError } from "../runtime/file-lock.js";
export type {
  FileLockClock as GitCloneLockClock,
  FileLockToken as GitCloneLockToken,
} from "../runtime/file-lock.js";

function gitCloneLockOptions(clock?: FileLockClock): FileLockOptions {
  return {
    staleMs: GIT_CLONE_LOCK_STALE_MS,
    maxWaitMs: GIT_CLONE_LOCK_MAX_WAIT_MS,
    ...definedProps({ clock }),
  };
}

/** Serialize every mutation of repos/<app>. A proven-live holder is never
 * broken; stale reclamation remains delegated to the shared lock primitive. */
export async function withAppGitLock<T>(
  runtimeHome: string,
  app: string,
  fn: () => Promise<T>,
  clock?: FileLockClock,
): Promise<T> {
  return withFileLock(gitCloneLockPath(runtimeHome, app), gitCloneLockOptions(clock), fn);
}

export async function acquireGitCloneLock(lockPath: string, clock?: FileLockClock): Promise<FileLockToken> {
  return acquireFileLock(lockPath, gitCloneLockOptions(clock));
}

export async function releaseGitCloneLock(lockPath: string, token: FileLockToken): Promise<void> {
  return releaseFileLock(lockPath, token);
}

function gitCloneLockPath(runtimeHome: string, app: string): string {
  return join(runtimeHome, "repos", `${app}.gitlock`);
}

/** The managed clone plus the exact remote-default base synchronized for this
 * operation. Callers thread this value rather than rediscovering or guessing. */
export interface ManagedClone {
  path: string;
  base: BaseRevision;
}

export async function ensureManagedClone(app: AppEntry, runtimeHome: string): Promise<ManagedClone> {
  const repoDir = join(runtimeHome, "repos", app.name);
  if (existsSync(join(repoDir, ".git"))) {
    const branch = resolveRemoteDefaultBranch("origin", {
      cwd: repoDir,
      errorPrefix: "turn",
    });
    git(repoDir, "fetch", "origin", branch);
    git(repoDir, "checkout", branch);
    git(repoDir, "reset", "--hard", `origin/${branch}`);
    return { path: repoDir, base: baseRevisionForBranch(branch) };
  }
  await mkdir(join(runtimeHome, "repos"), { recursive: true });
  git(join(runtimeHome, "repos"), "clone", repoUrl(app.repo), repoDir);
  return {
    path: repoDir,
    base: baseRevisionForBranch(git(repoDir, "symbolic-ref", "--short", "HEAD")),
  };
}

function repoUrl(repo: string): string {
  if (
    repo.includes("://") ||
    repo.startsWith("file:") ||
    repo.startsWith("git@") ||
    repo.startsWith("/") ||
    repo.startsWith(".")
  ) {
    return repo;
  }
  return `https://github.com/${repo}.git`;
}
