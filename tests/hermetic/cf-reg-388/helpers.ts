// CF-REG-388 shared fixtures — a real git-backed org home with a real file://
// remote, plus the two-call GitHub double a publication needs.
//
// Everything is real git run hermetically (fixtures/git-repo.ts conventions):
// system/global config cannot leak in, identity is pinned per repo, and the
// default branch NAME is deliberately not `main` so a guessed base (#101) is
// visibly wrong rather than accidentally right.

import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import type { GhPullRequest } from "../../../src/loop/github.js";
import type { PublicationGhOps } from "../../../src/org/git-publication-execute.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: devNull,
};

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20_000,
  }).trim();
}

export interface GitOrgHome {
  org: TempOrgHome;
  orgHome: string;
  stateHome: string;
  /** The bare repository `origin` points at — the org's authoritative remote. */
  remoteDir: string;
  defaultBranch: string;
  /** Reject every push at the remote, leaving fetch/ls-remote healthy: the
   *  partial-publication seam (commit built, remote never hears about it). */
  denyPush(): void;
  allowPush(): void;
  cleanup(): Promise<void>;
}

/** The org's remote is addressed as a GitHub URL and rewritten to the local
 *  bare repo by `url.<local>.insteadOf`. This is exactly the configuration the
 *  product's two-source slug lookup exists for: the configured URL names the
 *  repository, the rewritten one is what git actually talks to. */
const GITHUB_URL = "https://github.com/fixture/cf-reg-388-org.git";

/** An org home that is a real git checkout with a real file:// origin, with the
 *  initial committed configuration already on the remote default branch. */
export async function makeGitOrgHome(defaultBranch = "trunk"): Promise<GitOrgHome> {
  const org = await makeTempOrgHome({ name: "cf-reg-388-org" });
  const remoteRoot = await mkdtemp(join(tmpdir(), "cormidia-cf-reg-388-remote-"));
  const remoteDir = join(remoteRoot, "org.git");
  git(remoteRoot, ["init", "--bare", "-b", defaultBranch, remoteDir]);

  git(org.orgHome, ["init", "-b", defaultBranch]);
  git(org.orgHome, ["config", "user.name", "Cormidia Fixture"]);
  git(org.orgHome, ["config", "user.email", "fixture@cormidia.invalid"]);
  git(org.orgHome, ["config", "commit.gpgsign", "false"]);
  git(org.orgHome, ["add", "--all"]);
  git(org.orgHome, ["commit", "--quiet", "-m", "fixture: initial org configuration"]);
  git(org.orgHome, ["remote", "add", "origin", GITHUB_URL]);
  git(org.orgHome, ["config", `url.${remoteDir}.insteadOf`, GITHUB_URL]);
  git(org.orgHome, ["push", "--quiet", "origin", `${defaultBranch}:${defaultBranch}`]);
  git(org.orgHome, ["fetch", "--quiet", "origin"]);
  git(org.orgHome, ["remote", "set-head", "origin", "-a"]);

  const hookPath = join(remoteDir, "hooks", "pre-receive");
  return {
    org,
    orgHome: org.orgHome,
    stateHome: org.stateHome,
    remoteDir,
    defaultBranch,
    denyPush: () => {
      writeFileSync(hookPath, "#!/bin/sh\necho 'cf-reg-388: seeded push failure' >&2\nexit 1\n", {
        encoding: "utf8",
        mode: 0o755,
      });
    },
    allowPush: () => {
      rmSync(hookPath, { force: true });
    },
    cleanup: async () => {
      await org.cleanup();
      await rm(remoteRoot, { recursive: true, force: true });
    },
  };
}

/** Read a path's bytes at a ref directly from the bare remote. The cheap oracle:
 *  a full clone is reserved for the cases whose CLAIM is "a fresh clone at the
 *  reported revision carries this", not for every content assertion. */
export function remoteBlob(remoteDir: string, ref: string, path: string): string | undefined {
  try {
    return execFileSync("git", ["--git-dir", remoteDir, "show", `${ref}:${path}`], {
      env: GIT_ENV,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000,
    });
  } catch {
    return undefined;
  }
}

/** The commit a ref points at inside the bare remote, or undefined when the ref
 *  does not exist there. */
export function remoteTip(remoteDir: string, ref: string): string | undefined {
  const out = git(remoteDir, ["rev-parse", "--verify", "--quiet", ref]);
  return out === "" ? undefined : out;
}

/** A throwaway clone of the org's remote — the "fresh clone at the reported
 *  durable revision" oracle. Nothing about the operator's checkout is reused. */
export async function cloneRemote(remoteDir: string, ref?: string): Promise<{ dir: string; cleanup(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-cf-reg-388-clone-"));
  const dir = join(root, "clone");
  git(root, ["clone", "--quiet", remoteDir, dir]);
  if (ref !== undefined) git(dir, ["checkout", "--quiet", ref]);
  return { dir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export interface PublicationGhDouble extends PublicationGhOps {
  createdCount(): number;
  listedCount(): number;
}

export interface PublicationGhDoubleOptions {
  /** Record the pull request, then throw — the lost-success response: the
   *  effect happened and the caller never learned about it. */
  loseCreateResponse?: boolean;
}

export function makePublicationGhDouble(options: PublicationGhDoubleOptions = {}): PublicationGhDouble {
  const pullRequests: GhPullRequest[] = [];
  let created = 0;
  let listed = 0;
  return {
    createdCount: () => created,
    listedCount: () => listed,
    listPRsForBranch: async (branch) => {
      listed += 1;
      return pullRequests.filter((pr) => pr.headRefName === branch);
    },
    createPR: async (input) => {
      created += 1;
      const pr: GhPullRequest = {
        number: pullRequests.length + 1,
        title: input.title,
        body: input.body,
        url: `https://github.test/fixture/org/pull/${pullRequests.length + 1}`,
        state: "open",
        headRefName: input.head,
        baseRefName: input.base,
        isDraft: input.draft === true,
      };
      pullRequests.push(pr);
      if (options.loseCreateResponse === true) {
        throw new Error("cf-reg-388: seeded lost success response from createPR");
      }
      return pr;
    },
  };
}
