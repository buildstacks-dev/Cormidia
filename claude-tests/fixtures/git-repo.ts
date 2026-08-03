// fixtures/git-repo.ts — real temp git repos, clones, file:// remotes, and
// worktrees (boundary-map B-15 git substrate; the #101 default-branch rule).
//
// Everything here is real git run hermetically: GIT_CONFIG_NOSYSTEM +
// GIT_CONFIG_GLOBAL=/dev/null keep the host's git config out, identity is
// pinned per-repo, and prompts are disabled. The default branch NAME is
// configurable (never assume `main` — a guessed base silently diffs against
// the wrong tree, #101), so suites can prove product code asks git instead of
// guessing. Corruption knobs stage B-15 failure modes (corrupt refs, held
// index.lock) on the real substrate; the detector is always product code.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, devNull } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Hermetic git environment: host/system/global config can never leak in. */
const GIT_FIXTURE_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: devNull,
};

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: GIT_FIXTURE_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  }).trim();
}

export interface SeedFile {
  path: string;
  contents: string;
  message?: string;
}

export interface TempGitRepoCorruption {
  /** B-15 "corrupt refs": remove .git/HEAD so ref resolution fails. */
  removeHead(): Promise<void>;
  /** B-15 "index.lock held": plant a stale index.lock; mutating git commands
   *  fail until it is released. Returns the lock path. */
  holdIndexLock(): Promise<string>;
}

export interface TempGitRepo {
  dir: string;
  defaultBranch: string;
  /** Run git inside this repo (hermetic env), returning trimmed stdout. */
  git(args: string[]): string;
  head(): string;
  /** Write a file (creating parents), commit it, return the new HEAD sha. */
  commitFile(relPath: string, contents: string, message?: string): Promise<string>;
  /** Create a sibling bare mirror of this repo's current state, register it
   *  as a file:// remote, and fetch. The bare repo's HEAD advertises this
   *  repo's default branch, so `resolveRemoteDefaultBranch` has a real remote
   *  to interrogate. */
  addFileRemote(name?: string): Promise<{ name: string; url: string; dir: string }>;
  corrupt: TempGitRepoCorruption;
  cleanup(): Promise<void>;
}

export interface MakeTempGitRepoOptions {
  /** Default branch NAME — deliberately configurable; never assume `main`. */
  defaultBranch?: string;
  /** Files for the seed history, one commit each. Pass `[]` for a repo with
   *  an unborn default branch (no commits). Default: one README commit. */
  seedFiles?: SeedFile[];
}

function makeRepoHandle(dir: string, defaultBranch: string, roots: string[]): TempGitRepo {
  const git = (args: string[]): string => runGit(dir, args);
  return {
    dir,
    defaultBranch,
    git,
    head: () => git(["rev-parse", "HEAD"]),
    async commitFile(relPath, contents, message) {
      const absolute = join(dir, relPath);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, contents, "utf8");
      git(["add", "--", relPath]);
      git(["commit", "--no-gpg-sign", "-m", message ?? `fixture: ${relPath}`]);
      return git(["rev-parse", "HEAD"]);
    },
    async addFileRemote(name = "origin") {
      const bareRoot = await mkdtemp(join(tmpdir(), "cormidia-fixture-git-remote-"));
      roots.push(bareRoot);
      const bareDir = join(bareRoot, "remote.git");
      // A bare clone preserves refs and points HEAD at the source's current
      // branch — the remote advertises the configured default branch.
      runGit(bareRoot, ["clone", "--bare", dir, bareDir]);
      const url = pathToFileURL(bareDir).href;
      git(["remote", "add", name, url]);
      git(["fetch", name]);
      return { name, url, dir: bareDir };
    },
    corrupt: {
      async removeHead() {
        await rm(join(dir, ".git", "HEAD"), { force: true });
      },
      async holdIndexLock() {
        const lockPath = join(dir, ".git", "index.lock");
        await writeFile(lockPath, "", { flag: "wx" });
        return lockPath;
      },
    },
    cleanup: async () => {
      for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
    },
  };
}

export async function makeTempGitRepo(options: MakeTempGitRepoOptions = {}): Promise<TempGitRepo> {
  const defaultBranch = options.defaultBranch ?? "main";
  const root = await mkdtemp(join(tmpdir(), "cormidia-fixture-git-"));
  const roots = [root];
  const dir = join(root, "repo");
  await mkdir(dir);
  runGit(root, ["init", "-b", defaultBranch, dir]);
  runGit(dir, ["config", "user.name", "Cormidia Fixture"]);
  runGit(dir, ["config", "user.email", "fixture@cormidia.invalid"]);
  runGit(dir, ["config", "commit.gpgsign", "false"]);
  const repo = makeRepoHandle(dir, defaultBranch, roots);
  const seeds = options.seedFiles ?? [
    { path: "README.md", contents: "# fixture repo\n", message: "fixture: seed" },
  ];
  for (const seed of seeds) {
    await repo.commitFile(seed.path, seed.contents, seed.message);
  }
  return repo;
}

/** Clone `source` (a TempGitRepo, path, or file:// URL) into a fresh temp
 *  directory. The clone keeps the source's default branch checked out and its
 *  `origin` remote pointing back at the source. */
export async function makeTempClone(
  source: TempGitRepo | string,
  options: { defaultBranch?: string } = {},
): Promise<TempGitRepo> {
  const sourcePath = typeof source === "string" ? source : source.dir;
  const root = await mkdtemp(join(tmpdir(), "cormidia-fixture-git-clone-"));
  const roots = [root];
  const dir = join(root, "clone");
  runGit(root, ["clone", sourcePath, dir]);
  runGit(dir, ["config", "user.name", "Cormidia Fixture Clone"]);
  runGit(dir, ["config", "user.email", "fixture-clone@cormidia.invalid"]);
  runGit(dir, ["config", "commit.gpgsign", "false"]);
  const defaultBranch =
    options.defaultBranch ??
    (typeof source === "string"
      ? runGit(dir, ["rev-parse", "--abbrev-ref", "HEAD"])
      : source.defaultBranch);
  return makeRepoHandle(dir, defaultBranch, roots);
}

export interface TempWorktree {
  dir: string;
  branch: string;
  cleanup(): Promise<void>;
}

/** Add a real linked worktree on a new branch (default: cut from HEAD). */
export async function makeTempWorktree(
  repo: TempGitRepo,
  options: { branch: string; startPoint?: string },
): Promise<TempWorktree> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-fixture-worktree-"));
  const dir = join(root, options.branch.replace(/[^A-Za-z0-9._-]+/g, "-"));
  repo.git([
    "worktree",
    "add",
    "-b",
    options.branch,
    dir,
    ...(options.startPoint !== undefined ? [options.startPoint] : []),
  ]);
  return {
    dir,
    branch: options.branch,
    cleanup: async () => {
      try {
        repo.git(["worktree", "remove", "--force", dir]);
      } catch {
        // The main repo may already be gone; removing our root is enough.
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}
