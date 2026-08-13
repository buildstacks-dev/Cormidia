// Verification for a provisioned repository (#382).
//
// The point of this module is the word BEFORE in "verify before advancing any
// readiness claim". Provisioning that reports success is not evidence: the
// repository could be public, the local remote could name a different
// repository, the default branch could be a different one from the branch the
// bootstrap commit landed on, the commit could be absent, or the canonical
// labels could be half-installed. Every one of those produces a repository that
// looks fine and an org that behaves wrongly later.
//
// So this asks the remote and the local checkout five separate questions and
// reports each independently. `ready` is the conjunction — it is never inferred
// from "the transaction completed", and a facet that could not be CHECKED is
// never counted as passing (a probe that throws is a failure, not a skip).

import { CANONICAL_LABELS } from "../loop/plan-tickets.js";
import { baseRevisionForBranch, resolveRemoteDefaultBranch } from "../loop/default-branch.js";
import { publicationGit, publicationGitOptional } from "./git-publication-substrate.js";
import type { ProvisionGhOps } from "./repo-provision-execute.js";

export type ProvisionCheckName =
  | "visibility"
  | "remote-identity"
  | "default-branch-ancestry"
  | "bootstrap-commit"
  | "canonical-labels";

export interface ProvisionCheck {
  name: ProvisionCheckName;
  status: "pass" | "fail";
  detail: string;
  /** What to do about it. Empty on a pass. */
  remediation: string;
}

export interface ProvisionVerification {
  schema_version: 1;
  kind: "repository-provision-verification";
  slug: string;
  root: string;
  checks: ProvisionCheck[];
  /** True only when EVERY check passed. No readiness claim may advance on
   *  anything less, and nothing derives this from a transaction's phase. */
  ready: boolean;
}

export interface VerifyRepositoryProvisionInput {
  slug: string;
  root: string;
  /** The branch the bootstrap commit was pushed to. */
  branch: string;
  /** The commit the transaction recorded as pushed, when one is known. */
  expectedCommit?: string | null;
  remoteName?: string;
  /** The URL provisioning actually wired, from the transaction. Compared
   *  EXACTLY first, so a legitimate non-github.com spelling (an enterprise
   *  host, a `url.<base>.insteadOf` rewrite) is not mistaken for a foreign
   *  remote. Omitted ⇒ only the owner/repo tail comparison applies. */
  expectedRemoteUrl?: string;
  gh: ProvisionGhOps;
  errorPrefix: string;
}

export async function verifyRepositoryProvision(input: VerifyRepositoryProvisionInput): Promise<ProvisionVerification> {
  const remoteName = input.remoteName ?? "origin";
  const checks: ProvisionCheck[] = [];

  // 1. Visibility — read from the remote, never assumed from what was asked for.
  let defaultBranch: string | null = null;
  try {
    const view = await input.gh.readRepository();
    if (view === undefined) {
      checks.push(
        fail("visibility", `${input.slug} does not exist on GitHub`, "provision it before claiming readiness"),
      );
    } else {
      defaultBranch = view.defaultBranch;
      checks.push(
        view.visibility === "PRIVATE"
          ? pass("visibility", `${input.slug} is private`)
          : fail(
              "visibility",
              `${input.slug} is ${view.visibility}, not private`,
              "make the repository private on GitHub; Cormidia never changes an existing repository's visibility",
            ),
      );
    }
  } catch (error) {
    // Could not look ≠ fine. A readiness claim must not ride an unread remote.
    checks.push(
      fail(
        "visibility",
        `could not read ${input.slug}: ${error instanceof Error ? error.message : String(error)}`,
        "restore GitHub access, then re-run verification",
      ),
    );
  }

  // 2. Remote identity — the local checkout must actually point at this repo.
  const originUrl = publicationGitOptional(input.root, ["remote", "get-url", remoteName]);
  checks.push(
    originUrl === undefined
      ? fail(
          "remote-identity",
          `${input.root} has no "${remoteName}" remote`,
          `add it: git -C ${input.root} remote add ${remoteName} https://github.com/${input.slug}.git`,
        )
      : originUrl === input.expectedRemoteUrl || remoteUrlNamesSlug(originUrl, input.slug)
        ? pass("remote-identity", `${remoteName} points at ${input.slug}`)
        : fail(
            "remote-identity",
            `${remoteName} points at ${originUrl}, not ${input.slug}`,
            "re-point the remote; a push from here would land in a repository nobody reviewed",
          ),
  );

  // 3. Default-branch ancestry — RESOLVED from the remote every time, never
  //    hardcoded and never cached across calls (#101/#203). The bootstrap
  //    commit must be an ancestor of the resolved default branch; a repository
  //    whose default branch is some other branch is not onboarded.
  checks.push(await defaultBranchAncestry(input, remoteName, defaultBranch));

  // 4. Bootstrap commit — present on the remote branch, and the exact one.
  checks.push(bootstrapCommit(input, remoteName));

  // 5. Canonical labels — the same set app-lifecycle verification pins.
  checks.push(await canonicalLabels(input));

  return {
    schema_version: 1,
    kind: "repository-provision-verification",
    slug: input.slug,
    root: input.root,
    checks,
    ready: checks.every((check) => check.status === "pass"),
  };
}

async function defaultBranchAncestry(
  input: VerifyRepositoryProvisionInput,
  remoteName: string,
  reportedDefault: string | null,
): Promise<ProvisionCheck> {
  let resolved: string;
  try {
    resolved = baseRevisionForBranch(
      resolveRemoteDefaultBranch(remoteName, { cwd: input.root, errorPrefix: input.errorPrefix }),
    ).defaultBranch;
  } catch (error) {
    return fail(
      "default-branch-ancestry",
      `could not resolve the remote default branch: ${error instanceof Error ? error.message : String(error)}`,
      "fetch the remote, then re-run verification; the default branch is never assumed to be `main`",
    );
  }
  if (resolved !== input.branch) {
    return fail(
      "default-branch-ancestry",
      `the bootstrap commit is on ${input.branch} but ${input.slug}'s default branch resolves to ${resolved}` +
        (reportedDefault !== null && reportedDefault !== resolved ? ` (GitHub reports ${reportedDefault})` : ""),
      `set ${input.slug}'s default branch to ${input.branch}, or re-provision onto ${resolved}`,
    );
  }
  const commit = input.expectedCommit ?? null;
  if (commit === null) return pass("default-branch-ancestry", `default branch resolves to ${resolved}`);
  const remoteRef = `refs/remotes/${remoteName}/${resolved}`;
  publicationGitOptional(input.root, ["fetch", "--quiet", remoteName, resolved]);
  return isAncestorOf(input, commit, remoteRef)
    ? pass("default-branch-ancestry", `the bootstrap commit is reachable from ${remoteName}/${resolved}`)
    : fail(
        "default-branch-ancestry",
        `the bootstrap commit ${commit.slice(0, 12)} is not reachable from ${remoteName}/${resolved}`,
        "push the bootstrap commit, or re-run provisioning to resume the transaction",
      );
}

function bootstrapCommit(input: VerifyRepositoryProvisionInput, remoteName: string): ProvisionCheck {
  const expected = input.expectedCommit ?? null;
  const remoteRef = `refs/remotes/${remoteName}/${input.branch}`;
  publicationGitOptional(input.root, ["fetch", "--quiet", remoteName, input.branch]);
  const tip = publicationGitOptional(input.root, ["rev-parse", "--verify", "--quiet", remoteRef]);
  if (tip === undefined) {
    return fail(
      "bootstrap-commit",
      `${remoteName}/${input.branch} does not exist`,
      "run provisioning to push the bootstrap commit; it resumes rather than recreating the repository",
    );
  }
  if (expected === null) return pass("bootstrap-commit", `${remoteName}/${input.branch} is at ${tip.slice(0, 12)}`);
  if (tip === expected) return pass("bootstrap-commit", `${remoteName}/${input.branch} carries the bootstrap commit`);
  // A later commit on top is fine — the branch moved forward legitimately. A
  // branch that does NOT contain the bootstrap commit is not this repository.
  return isAncestorOf(input, expected, remoteRef)
    ? pass("bootstrap-commit", `${remoteName}/${input.branch} contains the bootstrap commit`)
    : fail(
        "bootstrap-commit",
        `${remoteName}/${input.branch} is at ${tip.slice(0, 12)} and does not contain the bootstrap commit ` +
          `${expected.slice(0, 12)}`,
        "inspect the remote branch; provisioning never force-pushes over content it did not create",
      );
}

async function canonicalLabels(input: VerifyRepositoryProvisionInput): Promise<ProvisionCheck> {
  let present: Map<string, { name: string; color: string; description: string }>;
  try {
    present = new Map((await input.gh.listLabels()).map((label) => [label.name, label]));
  } catch (error) {
    return fail(
      "canonical-labels",
      `could not list labels on ${input.slug}: ${error instanceof Error ? error.message : String(error)}`,
      "restore GitHub access, then re-run verification",
    );
  }
  const missing = CANONICAL_LABELS.filter((expected) => !present.has(expected.name)).map((label) => label.name);
  const drifted = CANONICAL_LABELS.filter((expected) => {
    const found = present.get(expected.name);
    return (
      found !== undefined &&
      (found.color.toLowerCase() !== expected.color.toLowerCase() || found.description !== expected.description)
    );
  }).map((label) => label.name);
  if (missing.length === 0 && drifted.length === 0) {
    return pass("canonical-labels", `all ${CANONICAL_LABELS.length} canonical labels are installed`);
  }
  return fail(
    "canonical-labels",
    [
      ...(missing.length > 0 ? [`missing: ${missing.join(", ")}`] : []),
      ...(drifted.length > 0 ? [`definition drift: ${drifted.join(", ")}`] : []),
    ].join("; "),
    "re-run provisioning; label installation is idempotent and resumes a half-installed set",
  );
}

/** Is `commit` reachable from `ref`?
 *
 *  `git merge-base --is-ancestor` answers with its EXIT CODE and prints
 *  nothing, so `publicationGitOptional` cannot be used here — it maps both "yes"
 *  (empty stdout) and "no" (nonzero exit) to undefined. The throwing reader is
 *  the only one that can tell them apart, and a genuine git failure (a missing
 *  ref, an unreadable object) correctly reads as "not proven reachable", which
 *  is the fail-closed direction for a readiness claim. */
function isAncestorOf(input: VerifyRepositoryProvisionInput, commit: string, ref: string): boolean {
  try {
    publicationGit(input.root, ["merge-base", "--is-ancestor", commit, ref], input.errorPrefix);
    return true;
  } catch {
    return false;
  }
}

function remoteUrlNamesSlug(url: string, slug: string): boolean {
  const match = /([^/:]+\/[^/:]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match?.[1]?.toLowerCase() === slug.toLowerCase();
}

function pass(name: ProvisionCheckName, detail: string): ProvisionCheck {
  return { name, status: "pass", detail, remediation: "" };
}

function fail(name: ProvisionCheckName, detail: string, remediation: string): ProvisionCheck {
  return { name, status: "fail", detail, remediation };
}
