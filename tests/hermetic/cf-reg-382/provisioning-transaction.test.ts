// CF-REG-382 — HB-156 (#382 governed repository provisioning) — boundary-map
// B-01 (GitHub substrate) + B-15 (git substrate) · INV-008 (no observable state
// claims more than its evidence) · INV-013 (readers never expose garbage).
//
// The transaction and its reconciliation. Every case here is a partial outcome
// that provisioning must resolve FORWARD, because creating a repository is the
// one onboarding effect a retry cannot simply repeat: a second attempt does not
// overwrite the first, it either fails or makes a second repository.
//
// L2 — hermetic composition against real git and a scripted GitHub double.
// Risk E-1. Control point T-12.

import { afterEach, describe, expect, it } from "vitest";
import { executeRepositoryProvision } from "../../../src/org/repo-provision-execute.js";
import { readProvisionTransaction, provisionJournalPath } from "../../../src/org/repo-provision-journal.js";
import { preflightRepositoryProvision } from "../../../src/org/repo-provision.js";
import { CANONICAL_LABELS } from "../../../src/loop/plan-tickets.js";
import {
  allowPush,
  denyPush,
  FIXTURE_SLUG,
  git,
  makeGreenfieldCheckout,
  pinIdentity,
  ProvisionGithubDouble,
  type GreenfieldCheckout,
} from "./helpers.js";

/** A recorded commit oid, narrowed rather than asserted: a null here means the
 *  transaction did not get where the test claims, which should fail loudly. */
function requireCommit(value: string | null): string {
  if (value === null) throw new Error("expected the transaction to have recorded a commit");
  return value;
}

let fixture: GreenfieldCheckout | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

async function planFor(
  checkout: GreenfieldCheckout,
  gh: ProvisionGithubDouble,
  overrides: { pushBranch?: string } = {},
) {
  return preflightRepositoryProvision({
    scope: "app",
    name: "widget",
    repoSlug: FIXTURE_SLUG,
    root: checkout.root,
    template: "bare",
    remoteUrl: checkout.remoteDir,
    errorPrefix: "app provision-repo",
    gh,
    ...overrides,
  });
}

function executeInput(
  checkout: GreenfieldCheckout,
  preflight: Awaited<ReturnType<typeof planFor>>,
  gh: ProvisionGithubDouble,
) {
  return {
    preflight,
    stateHome: checkout.stateHome,
    commitMessage: "chore(cormidia): bootstrap widget",
    provisionCommand: "cormidia app provision-repo widget --execute --confirm widget",
    verifyCommand: "cormidia app verify widget",
    errorPrefix: "app provision-repo",
    gh,
  };
}

describe("CF-REG-382 — the happy path is one transaction with real effects", () => {
  it("creates privately, commits only the declared paths, pushes, and installs every canonical label", async () => {
    fixture = await makeGreenfieldCheckout({ initGit: false });
    const gh = new ProvisionGithubDouble();
    const preflight = await planFor(fixture, gh);
    expect(preflight.blockers).toEqual([]);
    expect(preflight.remote.state).toBe("absent");

    const transaction = await executeRepositoryProvision(executeInput(fixture, preflight, gh));

    expect(transaction.phase).toBe("complete");
    expect(transaction.durability).toBe("reachable_at_remote");
    expect(transaction.repository_origin).toBe("created");
    expect(gh.createCalls).toBe(1);
    expect(gh.state.repository?.visibility).toBe("PRIVATE");
    expect(gh.state.labelNames).toEqual(CANONICAL_LABELS.map((label) => label.name).sort());

    // The commit really reached the bare remote, and carries exactly the
    // declared owned set — not "everything in the directory".
    const pushed = git(fixture.remoteDir, ["rev-parse", `refs/heads/${transaction.branch}`]);
    expect(pushed).toBe(transaction.pushed_commit);
    const tracked = git(fixture.remoteDir, ["ls-tree", "-r", "--name-only", pushed]).split("\n").sort();
    expect(tracked).toEqual([...transaction.owned_paths].sort());
  });

  it("stages a file the declaration does not own, even when it sits in the target directory", async () => {
    // The bootstrap-publish rule generalized: a file Cormidia did not declare
    // is not Cormidia's to commit. `secrets.env` and a stray build output are
    // both present on disk and must not reach the initial commit.
    fixture = await makeGreenfieldCheckout({
      initGit: false,
      extraFiles: [
        ["secrets.env", "TOKEN=hunter2\n"],
        ["dist/bundle.js", "// build output\n"],
        ["notes-to-self.txt", "remember to rename this\n"],
      ],
    });
    const gh = new ProvisionGithubDouble();
    const preflight = await planFor(fixture, gh);

    expect(preflight.owned_paths.map((entry) => entry.path)).not.toContain("secrets.env");
    expect(preflight.owned_paths.map((entry) => entry.path)).not.toContain("dist/bundle.js");
    expect(preflight.owned_paths.map((entry) => entry.path)).not.toContain("notes-to-self.txt");

    const transaction = await executeRepositoryProvision(executeInput(fixture, preflight, gh));
    const tracked = git(fixture.remoteDir, ["ls-tree", "-r", "--name-only", requireCommit(transaction.pushed_commit)]);
    expect(tracked).not.toContain("secrets.env");
    expect(tracked).not.toContain("dist/bundle.js");
  });

  it("leaves a GENESIS checkout clean rather than reporting every provisioned file as deleted", async () => {
    // The trap this pins: the commit is built against a temporary index, so
    // without the genesis sync HEAD would resolve to a commit containing the
    // bootstrap tree while the operator's index stayed empty — and `git status`
    // would report every provisioned file as DELETED. An operator who committed
    // that would wipe the bootstrap commit on their first interaction.
    fixture = await makeGreenfieldCheckout({ initGit: true });
    const gh = new ProvisionGithubDouble();
    const transaction = await executeRepositoryProvision(executeInput(fixture, await planFor(fixture, gh), gh));

    expect(git(fixture.root, ["rev-parse", "HEAD"])).toBe(transaction.commit);
    expect(git(fixture.root, ["diff", "--cached", "--name-only"])).toBe("");
    expect(git(fixture.root, ["status", "--porcelain"])).not.toMatch(/^ ?D /m);
  });

  it("never orphans existing history — the org-home case", async () => {
    // The data-loss trap. An org home ALWAYS has commits. A parentless
    // bootstrap commit plus `update-ref` would move the operator's branch to a
    // root commit and make every previous commit unreachable. The bootstrap
    // commit must descend from their HEAD, and must not record files outside
    // the declaration as deleted.
    fixture = await makeGreenfieldCheckout({ initGit: true });
    pinIdentity(fixture.root);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${fixture.root}/operator-owned.txt`, "not Cormidia's to touch\n", "utf8");
    git(fixture.root, ["add", "operator-owned.txt"]);
    git(fixture.root, ["commit", "--quiet", "-m", "pre-existing history"]);
    const headBefore = git(fixture.root, ["rev-parse", "HEAD"]);

    const gh = new ProvisionGithubDouble();
    const transaction = await executeRepositoryProvision(executeInput(fixture, await planFor(fixture, gh), gh));

    // History preserved: the bootstrap commit descends from their HEAD.
    expect(git(fixture.root, ["rev-parse", `${transaction.commit}^`])).toBe(headBefore);
    expect(git(fixture.root, ["rev-list", "--count", requireCommit(transaction.commit)])).toBe("2");
    // And the pre-existing tracked file is still in the tree, not deleted.
    const tracked = git(fixture.remoteDir, [
      "ls-tree",
      "-r",
      "--name-only",
      requireCommit(transaction.pushed_commit),
    ]).split("\n");
    expect(tracked).toContain("operator-owned.txt");
    expect(tracked).toContain(".cormidia/config.yaml");
  });
});

describe("CF-REG-382 — seeded failures reconcile forward, never restart", () => {
  it("a lost create response adopts the repository it really made — one create, never two", async () => {
    fixture = await makeGreenfieldCheckout({ initGit: false });
    // Attempt 1: the repository IS created, the response is lost.
    const gh = new ProvisionGithubDouble({ loseCreateResponse: true });
    const first = await planFor(fixture, gh);
    const transaction = await executeRepositoryProvision(executeInput(fixture, first, gh));

    // It converged in the SAME run: the marker in the description proved this
    // transaction made the repository.
    expect(gh.createCalls).toBe(1);
    expect(transaction.repository_origin).toBe("adopted_marker");
    expect(transaction.phase).toBe("complete");

    // And a re-run still does not create a second repository.
    const second = await planFor(fixture, gh);
    await executeRepositoryProvision(executeInput(fixture, second, gh));
    expect(gh.createCalls).toBe(1);
  });

  it("a push that fails after create resumes from the journal rather than recreating", async () => {
    fixture = await makeGreenfieldCheckout({ initGit: false });
    denyPush(fixture.remoteDir);
    const gh = new ProvisionGithubDouble();
    const first = await planFor(fixture, gh);

    await expect(executeRepositoryProvision(executeInput(fixture, first, gh))).rejects.toThrow(/push/i);

    // The journal records exactly how far it got: repository made, commit
    // built, nothing pushed. Durability is NOT terminal.
    const journal = await readProvisionTransaction(
      provisionJournalPath(fixture.stateHome, first.journal_scope, first.content_id),
    );
    expect(journal?.repository_origin).toBe("created");
    expect(journal?.commit).not.toBeNull();
    expect(journal?.pushed_commit).toBeNull();
    expect(journal?.durability).toBe("pending_publication");
    expect(journal?.next_action).toMatch(/re-run/i);

    // Resume: the push now succeeds and no second repository is created.
    allowPush(fixture.remoteDir);
    const resumed = await executeRepositoryProvision(executeInput(fixture, await planFor(fixture, gh), gh));
    expect(gh.createCalls).toBe(1);
    expect(resumed.durability).toBe("reachable_at_remote");
    expect(git(fixture.remoteDir, ["rev-parse", `refs/heads/${resumed.branch}`])).toBe(resumed.pushed_commit);
  });

  it("half-installed labels refuse honestly, then complete on resume", async () => {
    fixture = await makeGreenfieldCheckout({ initGit: false });
    const half = Math.floor(CANONICAL_LABELS.length / 2);
    const gh = new ProvisionGithubDouble({ labelsInstalledBeforeFailure: half });
    const preflight = await planFor(fixture, gh);

    await expect(executeRepositoryProvision(executeInput(fixture, preflight, gh))).rejects.toThrow(/canonical label/i);
    expect(gh.state.labelNames).toHaveLength(half);

    // The repository and the push already landed — a resume must not undo or
    // repeat them, only finish the labels that are still missing.
    gh.liftLabelFault();
    const resumed = await executeRepositoryProvision(executeInput(fixture, await planFor(fixture, gh), gh));
    expect(resumed.labels_installed).toHaveLength(CANONICAL_LABELS.length);
    expect(resumed.durability).toBe("reachable_at_remote");
    expect(gh.createCalls).toBe(1);
  });

  it("a create that genuinely fails leaves no repository and says so", async () => {
    fixture = await makeGreenfieldCheckout({ initGit: false });
    const gh = new ProvisionGithubDouble({ createFailsCleanly: true });
    const preflight = await planFor(fixture, gh);
    await expect(executeRepositoryProvision(executeInput(fixture, preflight, gh))).rejects.toMatchObject({
      code: "provision_create_failed",
    });
    expect(gh.state.repository).toBeUndefined();
  });
});

describe("CF-REG-382 — negative controls: the detectors must be able to fire", () => {
  it("duplicate-create: with a FRESH journal, the remote read is what stops the second create", async () => {
    // The one-create assertions above could pass for the wrong reason — the
    // journal alone might be doing all the work. This isolates the other guard:
    // a completely fresh state home (no journal to consult) against a remote
    // that already holds the repository. If `ensureRepository` ever stopped
    // reading the remote first, `createCalls` would rise to 2 here.
    fixture = await makeGreenfieldCheckout({ initGit: false });
    const gh = new ProvisionGithubDouble();
    await executeRepositoryProvision(executeInput(fixture, await planFor(fixture, gh), gh));
    expect(gh.createCalls).toBe(1);

    const secondCheckout = await makeGreenfieldCheckout({ initGit: false });
    try {
      const again = await executeRepositoryProvision(
        executeInput(secondCheckout, await planFor(secondCheckout, gh), gh),
      );
      expect(gh.createCalls).toBe(1);
      // Adopted on the MARKER: the description the first run wrote proves this
      // transaction made it, which is stronger evidence than "it looks empty".
      expect(again.repository_origin).toBe("adopted_marker");
    } finally {
      await secondCheckout.cleanup();
    }
  });

  it("duplicate-create: a remote that forgets the repository really does create twice", async () => {
    // The seeded control proving the assertion above is sensitive rather than
    // vacuous. This double drops the repository between runs — the exact
    // amnesia marker reconciliation defends against — and the count rises to 2.
    fixture = await makeGreenfieldCheckout({ initGit: false });
    const amnesiac = new ProvisionGithubDouble();
    await executeRepositoryProvision(executeInput(fixture, await planFor(fixture, amnesiac), amnesiac));
    expect(amnesiac.createCalls).toBe(1);

    amnesiac.forgetRepository();
    const secondCheckout = await makeGreenfieldCheckout({ initGit: false });
    try {
      await executeRepositoryProvision(executeInput(secondCheckout, await planFor(secondCheckout, amnesiac), amnesiac));
      expect(amnesiac.createCalls).toBe(2);
    } finally {
      await secondCheckout.cleanup();
    }
  });

  it("partial-success: a transaction is never recorded terminal before its labels are confirmed", async () => {
    fixture = await makeGreenfieldCheckout({ initGit: false });
    const gh = new ProvisionGithubDouble({ labelsInstalledBeforeFailure: 0 });
    const preflight = await planFor(fixture, gh);
    await expect(executeRepositoryProvision(executeInput(fixture, preflight, gh))).rejects.toThrow();

    const journal = await readProvisionTransaction(
      provisionJournalPath(fixture.stateHome, preflight.journal_scope, preflight.content_id),
    );
    // Pushed, but NOT complete and NOT reachable_at_remote. INV-008: no
    // observable state claims more than its evidence.
    expect(journal?.pushed_commit).not.toBeNull();
    expect(journal?.phase).not.toBe("complete");
    expect(journal?.durability).not.toBe("reachable_at_remote");
  });
});

describe("CF-REG-382 — refusals that must fire before anything outward happens", () => {
  it("an unresolved placeholder identity refuses before the first network call", async () => {
    fixture = await makeGreenfieldCheckout({ initGit: false });
    const gh = new ProvisionGithubDouble();
    const preflight = await preflightRepositoryProvision({
      scope: "app",
      name: "widget",
      repoSlug: "OWNER/YOUR_APP_REPOSITORY",
      root: fixture.root,
      template: "bare",
      remoteUrl: fixture.remoteDir,
      errorPrefix: "app provision-repo",
      gh,
    });

    expect(preflight.target).toBeNull();
    expect(preflight.identity_rejection?.code).toBe("placeholder-owner");
    expect(preflight.blockers.join("\n")).toMatch(/No repository was created and no GitHub call was made/);
    // The load-bearing assertion: the network was never touched.
    expect(gh.readCalls).toBe(0);
    expect(gh.createCalls).toBe(0);

    await expect(executeRepositoryProvision(executeInput(fixture, preflight, gh))).rejects.toThrow();
    expect(gh.createCalls).toBe(0);
  });

  it("an existing repository with the wrong visibility is refused, never adopted", async () => {
    fixture = await makeGreenfieldCheckout({ initGit: false });
    const gh = new ProvisionGithubDouble({}, { visibility: "PUBLIC", isEmpty: true });
    const preflight = await planFor(fixture, gh);

    expect(preflight.remote.state).toBe("present");
    expect(preflight.remote.visibility).toBe("PUBLIC");
    expect(preflight.blockers.join("\n")).toMatch(/is PUBLIC, not private/);
    await expect(executeRepositoryProvision(executeInput(fixture, preflight, gh))).rejects.toThrow(
      /refusing to execute|PUBLIC|blocked/i,
    );
    expect(gh.createCalls).toBe(0);
  });

  it("an existing repository with content this provisioning did not create is refused", async () => {
    fixture = await makeGreenfieldCheckout({ initGit: false });
    const gh = new ProvisionGithubDouble({}, { isEmpty: false, defaultBranch: "main", description: "someone's repo" });
    const preflight = await planFor(fixture, gh);
    expect(preflight.blockers).toEqual([]); // private and present is not itself a blocker

    await expect(executeRepositoryProvision(executeInput(fixture, preflight, gh))).rejects.toMatchObject({
      code: "provision_target_not_empty",
    });
    expect(gh.createCalls).toBe(0);
  });

  it("an unreadable remote blocks rather than reporting absent", async () => {
    fixture = await makeGreenfieldCheckout({ initGit: false });
    const gh = new ProvisionGithubDouble({ readThrows: true });
    const preflight = await planFor(fixture, gh);
    expect(preflight.remote.state).toBe("unknown");
    expect(preflight.blockers.join("\n")).toMatch(/unknown and provisioning must not guess/);
    expect(gh.createCalls).toBe(0);
  });

  it("a local remote naming a different repository blocks before any push", async () => {
    fixture = await makeGreenfieldCheckout({ initGit: true });
    git(fixture.root, ["remote", "add", "origin", "https://github.com/someone-else/other.git"]);
    const gh = new ProvisionGithubDouble();
    const preflight = await planFor(fixture, gh);
    expect(preflight.blockers.join("\n")).toMatch(/is not cormidia-fixture\/widget/);
  });

  it("a preview whose content moved is refused at execution", async () => {
    fixture = await makeGreenfieldCheckout({ initGit: false });
    const gh = new ProvisionGithubDouble();
    const reviewed = await planFor(fixture, gh);

    // The operator reviewed one set of bytes; the tree changed underneath.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${fixture.root}/docs/VISION.md`, "# Vision (rewritten)\n", "utf8");
    const now = await planFor(fixture, gh);
    expect(now.content_id).not.toBe(reviewed.content_id);

    await expect(
      executeRepositoryProvision({ ...executeInput(fixture, now, gh), expectedContentId: reviewed.content_id }),
    ).rejects.toMatchObject({ code: "provision_stale_preview" });
    expect(gh.createCalls).toBe(0);
  });
});
