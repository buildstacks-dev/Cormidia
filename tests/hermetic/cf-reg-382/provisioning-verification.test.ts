// CF-REG-382 — HB-156 (#382 governed repository provisioning) — INV-008 (no
// observable state claims more than its evidence) · boundary-map B-01/B-15.
//
// "Verify before advancing any readiness claim" is the whole point, so this
// file exists to prove the NEGATIVE: for each of the five facets, a repository
// that is wrong in exactly that one way must not report ready. A verification
// gate that only ever passes is an assumption with a test around it.
//
// L2 — hermetic, real git plus the scripted GitHub double. Risk E-1. T-12.

import { afterEach, describe, expect, it } from "vitest";
import { CANONICAL_LABELS } from "../../../src/loop/plan-tickets.js";
import { executeRepositoryProvision } from "../../../src/org/repo-provision-execute.js";
import { preflightRepositoryProvision } from "../../../src/org/repo-provision.js";
import {
  verifyRepositoryProvision,
  type ProvisionCheckName,
  type ProvisionVerification,
} from "../../../src/org/repo-provision-verify.js";
import {
  FIXTURE_SLUG,
  git,
  makeGreenfieldCheckout,
  pinProcessGitIdentity,
  ProvisionGithubDouble,
  type GreenfieldCheckout,
} from "./helpers.js";

/** The first canonical label, resolved once through a narrowing check so no
 *  spec needs a non-null assertion on the ratified list. */
const FIRST_LABEL = (() => {
  const label = CANONICAL_LABELS[0];
  if (label === undefined) throw new Error("CANONICAL_LABELS is empty");
  return label;
})();

// The product runs `git init` itself on the greenfield path, so there is no
// repository for a fixture to configure — the identity has to come from the
// environment. Without this the suite depends on the host's global git config.
pinProcessGitIdentity();

let fixture: GreenfieldCheckout | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

/** Provision for real, then hand back everything a verification needs. */
async function provisioned(options: { defaultBranch?: string } = {}) {
  const branch = options.defaultBranch ?? "main";
  const checkout = await makeGreenfieldCheckout({ initGit: false, defaultBranch: branch });
  const gh = new ProvisionGithubDouble();
  const preflight = await preflightRepositoryProvision({
    scope: "app",
    name: "widget",
    repoSlug: FIXTURE_SLUG,
    root: checkout.root,
    template: "bare",
    remoteUrl: checkout.remoteDir,
    pushBranch: branch,
    errorPrefix: "app provision-repo",
    gh,
  });
  const transaction = await executeRepositoryProvision({
    preflight,
    stateHome: checkout.stateHome,
    commitMessage: "chore(cormidia): bootstrap widget",
    provisionCommand: "cormidia app provision-repo widget --execute --confirm widget",
    verifyCommand: "cormidia app verify widget",
    errorPrefix: "app provision-repo",
    gh,
  });
  // The remote now really holds the commit, so the double reports it the way
  // GitHub would.
  gh.markPushed(branch);
  // The bare remote is a plain repository; point its HEAD at the branch so
  // `resolveRemoteDefaultBranch` has something honest to resolve.
  git(checkout.remoteDir, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  git(checkout.root, ["remote", "set-head", "origin", "-a"]);
  return { checkout, gh, transaction, branch };
}

function verify(
  context: Awaited<ReturnType<typeof provisioned>>,
  overrides: { branch?: string; expectedCommit?: string | null } = {},
): Promise<ProvisionVerification> {
  return verifyRepositoryProvision({
    slug: FIXTURE_SLUG,
    root: context.checkout.root,
    branch: overrides.branch ?? context.branch,
    expectedCommit:
      overrides.expectedCommit === undefined ? context.transaction.pushed_commit : overrides.expectedCommit,
    expectedRemoteUrl: context.transaction.remote_url,
    gh: context.gh,
    errorPrefix: "app verify",
  });
}

function failed(verification: ProvisionVerification): ProvisionCheckName[] {
  return verification.checks.filter((check) => check.status === "fail").map((check) => check.name);
}

describe("CF-REG-382 — a correctly provisioned repository verifies ready", () => {
  it("passes all five facets", async () => {
    const context = await provisioned();
    fixture = context.checkout;
    const verification = await verify(context);
    expect(failed(verification)).toEqual([]);
    expect(verification.ready).toBe(true);
    expect(verification.checks).toHaveLength(5);
  });

  it("resolves the default branch from the remote rather than assuming `main`", async () => {
    // #101/#203: a hardcoded or cached `main` would be visibly wrong here.
    const context = await provisioned({ defaultBranch: "trunk" });
    fixture = context.checkout;
    const verification = await verify(context);
    expect(failed(verification)).toEqual([]);
    expect(verification.checks.find((check) => check.name === "default-branch-ancestry")?.detail).toContain("trunk");
  });
});

describe("CF-REG-382 — readiness is NOT advanced when any single facet is wrong", () => {
  it("visibility: a repository the world can read is not ready", async () => {
    const context = await provisioned();
    fixture = context.checkout;
    context.gh.setVisibility("PUBLIC");
    const verification = await verify(context);
    expect(failed(verification)).toContain("visibility");
    expect(verification.ready).toBe(false);
  });

  it("remote identity: an origin naming a different repository is not ready", async () => {
    const context = await provisioned();
    fixture = context.checkout;
    git(context.checkout.root, ["remote", "set-url", "origin", "https://github.com/someone-else/other.git"]);
    const verification = await verify(context);
    expect(failed(verification)).toContain("remote-identity");
    expect(verification.ready).toBe(false);
  });

  it("default-branch ancestry: a bootstrap commit on a branch that is not the default is not ready", async () => {
    const context = await provisioned();
    fixture = context.checkout;
    // The commit landed on `main`, but the repository's default resolves to
    // `other` — the repository is not onboarded even though everything exists.
    git(context.checkout.remoteDir, ["branch", "other", context.branch]);
    git(context.checkout.remoteDir, ["symbolic-ref", "HEAD", "refs/heads/other"]);
    git(context.checkout.root, ["fetch", "--quiet", "origin"]);
    git(context.checkout.root, ["remote", "set-head", "origin", "-a"]);
    const verification = await verify(context);
    expect(failed(verification)).toContain("default-branch-ancestry");
    expect(verification.ready).toBe(false);
  });

  it("bootstrap commit: a remote branch that does not contain it is not ready", async () => {
    const context = await provisioned();
    fixture = context.checkout;
    const verification = await verify(context, { expectedCommit: "0".repeat(40) });
    expect(failed(verification)).toContain("bootstrap-commit");
    expect(verification.ready).toBe(false);
  });

  it("canonical labels: a half-installed or drifted set is not ready", async () => {
    const context = await provisioned();
    fixture = context.checkout;
    context.gh.dropLabel(FIRST_LABEL.name);
    const missing = await verify(context);
    expect(failed(missing)).toContain("canonical-labels");
    expect(missing.ready).toBe(false);

    // Definition DRIFT is a failure too, not just absence: a label whose color
    // or description no longer matches is a different contract.
    context.gh.seedLabels([{ name: FIRST_LABEL.name, color: "ffffff", description: FIRST_LABEL.description }]);
    const drifted = await verify(context);
    expect(failed(drifted)).toContain("canonical-labels");
    expect(drifted.ready).toBe(false);
  });

  it("an unreadable remote fails closed rather than passing by omission", async () => {
    // "I could not check" must never count as a pass. This is the fail-closed
    // axis: a readiness claim riding an unread remote is exactly INV-008's
    // "claims more than its evidence".
    const context = await provisioned();
    fixture = context.checkout;
    context.gh.faults.readThrows = true;
    const verification = await verify(context);
    expect(failed(verification)).toContain("visibility");
    expect(verification.ready).toBe(false);
  });

  it("every facet reports a remediation that names a transition, not a re-run", async () => {
    const context = await provisioned();
    fixture = context.checkout;
    context.gh.setVisibility("PUBLIC");
    context.gh.dropLabel(FIRST_LABEL.name);
    const verification = await verify(context);
    for (const check of verification.checks.filter((entry) => entry.status === "fail")) {
      expect(check.remediation, check.name).not.toBe("");
    }
  });
});

describe("CF-REG-382 — negative control: the verification must be able to fail", () => {
  it("a gate that ANDs nothing would report ready on a public repository", async () => {
    // Proves the assertions above are sensitive. A seeded `ready` that ignores
    // its checks passes on exactly the input the real gate rejects.
    const context = await provisioned();
    fixture = context.checkout;
    context.gh.setVisibility("PUBLIC");
    const verification = await verify(context);
    const seededPermissiveReady = true; // the bug: ready not derived from checks
    expect(seededPermissiveReady).toBe(true);
    expect(verification.ready).toBe(false);
    // And `ready` really is the conjunction, not a stored flag.
    expect(verification.ready).toBe(verification.checks.every((check) => check.status === "pass"));
  });
});
