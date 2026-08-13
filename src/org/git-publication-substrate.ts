// Git substrate helpers shared by every committed-configuration publication
// (#388, #389) — boundary-map B-15.
//
// Two rules this file exists to keep:
//
//  1. **A failed git call is never "found nothing".** `publicationGit` throws.
//     Safety guards that ask "is anything foreign staged?" must not read a
//     corrupt index or a held `index.lock` as a clean answer and wave a
//     publication through. `publicationGitOptional` exists for the questions
//     where absence is a real answer (does this ref exist?), and is never used
//     for a refusal probe.
//  2. **Content, not commit ids, decides what is published.** Publication
//     happens in a throwaway worktree and deliberately leaves the operator's
//     files uncommitted, so "still pending locally" proves nothing. Every
//     comparison here is over raw bytes.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRepositoryIdentity, isRepositoryIdentity } from "../runtime/repo-identity.js";

/** Never prompt for credentials (a hung command is indistinguishable from a
 *  wedged org) and never let host system config change what git reports. */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
};

/** Wall-clock ceiling for any single git call, including the network ones.
 *  Matches `resolveRemoteDefaultBranch`: failing loudly beats wedging a tick. */
const GIT_TIMEOUT_MS = 30_000;

/** Run git, throwing with the failing command and stderr on any nonzero exit. */
export function publicationGit(cwd: string, args: readonly string[], errorPrefix: string): string {
  try {
    return execFileSync("git", [...args], {
      cwd,
      env: GIT_ENV,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
    }).trim();
  } catch (error) {
    const detail = gitStderr(error) === undefined ? "" : `: ${gitStderr(error)}`;
    throw new Error(`${errorPrefix}: \`git ${args.join(" ")}\` failed in ${cwd}${detail}`);
  }
}

/** Run git where "it failed" and "there is nothing there" are the same useful
 *  answer — ref existence probes, optional config reads. Never a refusal probe. */
export function publicationGitOptional(cwd: string, args: readonly string[]): string | undefined {
  try {
    const out = publicationGit(cwd, args, "git");
    return out === "" ? undefined : out;
  } catch {
    return undefined;
  }
}

/** Throwing line reader for guard probes: a git failure propagates instead of
 *  reading as an empty result. */
export function publicationGitLines(cwd: string, args: readonly string[], errorPrefix: string): string[] {
  const out = publicationGit(cwd, args, errorPrefix);
  return out === "" ? [] : out.split("\n").filter((line) => line !== "");
}

/** Raw bytes of a path at a revision, or undefined when it does not exist
 *  there. Deliberately not trimmed — a trailing-newline difference is a real
 *  content difference. */
export function showBlobAtRev(cwd: string, rev: string, relativePath: string): Buffer | undefined {
  try {
    return execFileSync("git", ["show", `${rev}:${relativePath}`], {
      cwd,
      env: GIT_ENV,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return undefined;
  }
}

/** The stderr a failed spawn carries, narrowed rather than asserted: the shape
 *  of a Node spawn error is a trust boundary like any other. */
function gitStderr(error: unknown): string | undefined {
  if (error === null || typeof error !== "object" || !("stderr" in error)) return undefined;
  const stderr = error.stderr;
  if (typeof stderr !== "string" || stderr.trim() === "") return undefined;
  return stderr.trim();
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Content hash of a working-tree path, or null when it is absent. Absence is
 *  a publishable state (a surface can be removed), so it is a value, not an
 *  error. */
export function worktreeSha256(root: string, relativePath: string): string | null {
  const path = join(root, relativePath);
  if (!existsSync(path)) return null;
  return sha256Hex(readFileSync(path));
}

/** Does the working tree hold this path exactly as the revision does?
 *
 *  Absent on both sides counts as a match (a removal that is already
 *  published); present on one side only does not. Raw blobs are compared, not
 *  commit ids: publication happens in a throwaway worktree and leaves the
 *  operator's copy uncommitted, so "still pending locally" proves nothing. */
export function revisionMatchesWorktree(root: string, rev: string, relativePath: string): boolean {
  const blob = showBlobAtRev(root, rev, relativePath);
  const atRev = blob === undefined ? null : sha256Hex(blob);
  return atRev === worktreeSha256(root, relativePath);
}

/** The GitHub slug for a repo's `origin`, or undefined when it is not one this
 *  publication may open a pull request against.
 *
 *  Two URL sources, because neither alone covers the real configurations:
 *  `remote get-url` applies `url.<base>.insteadOf` rewriting (expanding
 *  `gh:owner/repo`, but also rewriting a GitHub URL into a local mirror), and
 *  `config --get remote.origin.url` is the raw configured value. Whichever
 *  yields an identity is the answer.
 *
 *  Undefined is a normal answer with two causes that are deliberately NOT
 *  distinguished here, because the outcome is the same: the branch is pushed
 *  for review and no pull request is claimed. A self-hosted remote is one; the
 *  other is a URL whose slug is not an ACTIONABLE GitHub identity — an
 *  unresolved placeholder like `OWNER/YOUR_APP_REPOSITORY` parses as a URL but
 *  is not a repository anyone can review in (#385). */
export function githubSlugForOrigin(root: string): string | undefined {
  const configured = githubSlugFromRemoteUrl(publicationGitOptional(root, ["config", "--get", "remote.origin.url"]));
  if (configured !== undefined) return configured;
  return githubSlugFromRemoteUrl(publicationGitOptional(root, ["remote", "get-url", "origin"]));
}

/** The slug a remote URL denotes, validated through the ONE repository-identity
 *  rule (#385) rather than a second shape regex living here. */
export function githubSlugFromRemoteUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const match =
    /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  const classified = classifyRepositoryIdentity(`${match[1]}/${match[2]}`);
  return isRepositoryIdentity(classified) ? classified.slug : undefined;
}
