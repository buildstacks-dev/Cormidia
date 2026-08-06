// CF-J12-I — publisher crash mid-transaction → forward-complete or no-op by
// approval ID (L2 state, risk E1; case-catalog.md; contracts/
// B-11-learning-publisher.md §3; INV-013).
//
// Crash method: interrupted-sequence at the store seam, not SIGKILL — two
// REAL faults injected at ratified seams, with the resulting journal state
// asserted as a precondition so the test can never silently exercise the
// wrong crash point:
//   leg 1: the filesystem substrate refuses the artifact write (bundle path
//          blocked) → transaction dies after the journal intent, before any
//          receipt;
//   leg 2: the injected B-06 clock throws on its next read (`clockFuse`) →
//          transaction dies after the artifact write, before the manifest
//          cut.
// (The no-op-resume tail — crash after grant consumption, before the done
// mark — is CF-SM-LEARN-C, hermetic/cf-sm-learn/cf-sm-learn-c.test.ts.)
//
// The last test guards B-11 §3 "readers never resolve a partially committed
// publication as active (INV-013)" — deposited as an it.fails tripwire while
// the defect existed (HB-017), promoted to a plain test with the fix: the
// resolver now requires a manifest cut naming the concept id (the commit
// receipt) before a bundle concept resolves.

import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256Ref } from "../../../src/org/learning/candidate-store.js";
import { bindingOf, findLearningPublishItem } from "../../../src/org/learning/binding.js";
import { readManifest } from "../../../src/org/learning/concepts.js";
import { sanitizeIdSegment } from "../../../src/org/learning/events.js";
import { readInterventionRecord } from "../../../src/org/learning/intervention.js";
import { publishCandidate } from "../../../src/org/learning/publisher.js";
import { resolveLearningContext } from "../../../src/org/learning/resolver.js";
import {
  assertExactlyOncePublish,
  clockFuse,
  ClockFuseError,
  makeLearningWorld,
  seedReviewedOkfCandidate,
  raiseAndApprove,
  type LearningWorld,
} from "./learning-seams.js";

const CAND = "cand_j12i_lesson";
const CONCEPT = "lrn_j12i_lesson";
const NAME = "j12i-crash-lesson";
const TRAILING_HYPHEN_APPROVAL_ID = "20260731T120000Z-ooh-";

interface JournalOnDisk {
  journal_id: string;
  artifact_ref?: string;
  manifest_version?: string;
  intervention_id?: string;
  done_at?: string;
  artifact: { bytes: string };
}

describe("CF-J12-I — publisher crash mid-transaction forward-completes or no-ops by approval ID (L2, E1)", () => {
  let world: LearningWorld;

  afterEach(async () => {
    await world.cleanup();
  });

  // Mirror the publisher's own path construction (publisher.ts → journalPath):
  // approval IDs carry a base64url random suffix that can end in `-`, which
  // sanitizeIdSegment strips. Building this path from the raw id reads a file
  // the product never wrote — a ~1-in-64 flake (#251).
  const journalPath = (approvalId: string): string =>
    join(world.state.stateHome, "learning", "publish-journal", `${sanitizeIdSegment(approvalId)}.json`);
  const readJournal = async (approvalId: string): Promise<JournalOnDisk> =>
    JSON.parse(await readFile(journalPath(approvalId), "utf8")) as JournalOnDisk;

  it("CF-REG-251: a seeded trailing-hyphen approval id round-trips through the publisher journal path", async () => {
    world = await makeLearningWorld("cf-reg-251-trailing-hyphen", {
      approvalId: TRAILING_HYPHEN_APPROVAL_ID,
    });
    await seedReviewedOkfCandidate(world, { id: CAND, conceptId: CONCEPT, name: NAME });
    const approvalId = await raiseAndApprove(world, CAND);
    expect(approvalId).toBe(TRAILING_HYPHEN_APPROVAL_ID);

    const published = await publishCandidate(world.deps, CAND);
    expect(published.status).toBe("published");

    const rawPath = join(world.state.stateHome, "learning", "publish-journal", `${approvalId}.json`);
    expect(rawPath).not.toBe(journalPath(approvalId));
    await expect(readFile(rawPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const journal = await readJournal(approvalId);
    expect(journal.journal_id).toBe(TRAILING_HYPHEN_APPROVAL_ID);
    expect(journal.done_at).toBeDefined();
  });

  it("crash BEFORE the artifact step: resume forward-completes the exact approved bytes from the journal — a post-approval draft tamper publishes nothing", async () => {
    world = await makeLearningWorld("cf-j12-i-leg1");
    await seedReviewedOkfCandidate(world, { id: CAND, conceptId: CONCEPT, name: NAME });
    const approvalId = await raiseAndApprove(world, CAND);

    // Fault at the fs substrate: learning/bundle exists as a regular FILE, so
    // the artifact step's mkdir dies. The journal intent has already landed.
    const bundleBlock = join(world.org.orgHome, "learning", "bundle");
    await writeFile(bundleBlock, "not a directory", "utf8");
    await expect(publishCandidate(world.deps, CAND)).rejects.toThrow(/ENOTDIR|EEXIST/);

    // Precondition pin: crashed after intent, before any step receipt.
    const journal = await readJournal(approvalId);
    expect(journal.artifact_ref).toBeUndefined();
    expect(journal.done_at).toBeUndefined();
    const approvedBytes = journal.artifact.bytes;

    // Between crash and resume, the draft is tampered with. The journal —
    // keyed by the approval — carries the approved bytes; the resume must
    // publish those, never re-render the tampered draft (B-11 §3).
    await writeFile(
      join(world.org.orgHome, "learning", "candidates", `${CAND}.md`),
      "TAMPERED after approval\n",
      "utf8",
    );
    await rm(bundleBlock);

    const resumed = await publishCandidate(world.deps, CAND);
    expect(resumed.status).toBe("published");
    const conceptBytes = await readFile(join(world.org.orgHome, "learning", "bundle", "org", `${NAME}.md`), "utf8");
    expect(conceptBytes).toBe(approvedBytes);
    expect(conceptBytes).not.toContain("TAMPERED");

    // Keyed by approval ID: the same journal completed; no fresh approval
    // was raised, no second decided item exists.
    expect(await findLearningPublishItem(world.approvals, CAND, "pending")).toBeUndefined();
    const decided = await world.approvals.listDecided();
    expect(decided.filter((item) => bindingOf(item) !== undefined)).toHaveLength(1);
    expect((await readJournal(approvalId)).done_at).toBeDefined();
    await assertExactlyOncePublish({ world, candidateId: CAND, conceptId: CONCEPT });
  });

  it("crash BETWEEN artifact write and manifest cut: resume forward-completes every remaining step exactly once", async () => {
    world = await makeLearningWorld("cf-j12-i-leg2");
    await seedReviewedOkfCandidate(world, { id: CAND, conceptId: CONCEPT, name: NAME });
    const approvalId = await raiseAndApprove(world, CAND);

    // Fault at the injected clock seam: one read is served (the suppression
    // check), the next (the manifest cut's timestamp) throws.
    await expect(publishCandidate({ ...world.deps, clock: clockFuse(world.clock, 1) }, CAND)).rejects.toThrow(
      ClockFuseError,
    );

    // Precondition pin: artifact receipt exists, manifest cut does not —
    // this is exactly the between-two-durable-writes window.
    const journal = await readJournal(approvalId);
    expect(journal.artifact_ref).toBeDefined();
    expect(journal.manifest_version).toBeUndefined();
    expect(journal.done_at).toBeUndefined();
    expect(await readManifest(world.orgRoot)).toBeNull();

    // Resume with a healthy clock: forward-completes from the journal.
    const resumed = await publishCandidate(world.deps, CAND);
    expect(resumed.status).toBe("published");

    const done = await readJournal(approvalId);
    expect(done.done_at).toBeDefined();
    const manifest = await readManifest(world.orgRoot);
    expect(manifest?.history).toHaveLength(1);
    expect(manifest?.history[0]?.approval_ref).toBe(approvalId);
    const record = await readInterventionRecord(world.org.orgHome, "int_j12i_lesson");
    expect(record.status).toBe("active");
    expect(record.activation?.claim).toBe("authorized");
    await assertExactlyOncePublish({ world, candidateId: CAND, conceptId: CONCEPT });

    // The activated bytes are still the approved bytes (content binding
    // survived the crash/resume pair).
    const conceptBytes = await readFile(join(world.org.orgHome, "learning", "bundle", "org", `${NAME}.md`), "utf8");
    expect(sha256Ref(conceptBytes)).toBe(sha256Ref(journal.artifact.bytes));
  });

  it("negative control: a crash BEFORE the journal intent leaves zero durable state — the no-partial-state detector fires and a fresh run still publishes exactly once", async () => {
    world = await makeLearningWorld("cf-j12-i-leg0");
    await seedReviewedOkfCandidate(world, { id: CAND, conceptId: CONCEPT, name: NAME });
    const approvalId = await raiseAndApprove(world, CAND);

    // Seed the violation at the earliest point: the fuse serves NO reads, so
    // the transaction dies on its very first clock read (the suppression
    // check), before the journal intent could land.
    await expect(publishCandidate({ ...world.deps, clock: clockFuse(world.clock, 0) }, CAND)).rejects.toThrow(
      ClockFuseError,
    );

    // Detector: no journal exists — nothing durable happened at all.
    const { existsSync } = await import("node:fs");
    expect(existsSync(journalPath(approvalId))).toBe(false);
    expect(await readManifest(world.orgRoot)).toBeNull();

    // Recovery is a plain fresh run, and conservation still holds.
    const published = await publishCandidate(world.deps, CAND);
    expect(published.status).toBe("published");
    await assertExactlyOncePublish({ world, candidateId: CAND, conceptId: CONCEPT });
  });

  // FIXED (HB-017) — this was the product-defect tripwire (it.fails while the
  // defect existed). Ratified clause (contracts/B-11-learning-publisher.md
  // §3): "readers never resolve a partially committed publication as active
  // (INV-013)". The defect: the artifact step writes the activated concept
  // into bundle/<scope> BEFORE the manifest cut, and the resolver loaded any
  // active file in a bundle dir with no membership check — between the two
  // durable writes a resolve saw the concept as active while bundle_versions
  // still reported the pre-cut version. The fix is reader-side (INV-013's
  // guardrail note): the resolver's gather now requires a manifest cut naming
  // the concept id — the transaction's commit receipt, co-located with the
  // bundle so even a dry resolve (no state home) enforces it. The completion
  // leg proves forward-completion still works: re-running publish finishes
  // the crashed journal, cuts the manifest, and only then does the concept
  // resolve — at the post-cut version.
  it("B-11 §3 / INV-013: a mid-transaction concept does NOT resolve; after forward-completion it resolves at the post-cut version", async () => {
    world = await makeLearningWorld("cf-j12-i-tripwire");
    await seedReviewedOkfCandidate(world, { id: CAND, conceptId: CONCEPT, name: NAME });
    const approvalId = await raiseAndApprove(world, CAND);
    await expect(publishCandidate({ ...world.deps, clock: clockFuse(world.clock, 1) }, CAND)).rejects.toThrow(
      ClockFuseError,
    );
    // The transaction is provably mid-flight: artifact written, no manifest.
    const journal = await readJournal(approvalId);
    expect(journal.artifact_ref).toBeDefined();
    expect(journal.done_at).toBeUndefined();

    const resolveOnce = (turn: string) =>
      resolveLearningContext({
        orgHome: world.org.orgHome,
        app: "fixture-app",
        role: "builder",
        turnId: turn,
        episodeId: `ep_${turn}`,
        taskText: "any task",
        policy: world.policy,
        // dry resolve: pins nothing, emits nothing.
      });

    // The ratified clause: a partially committed publication never resolves.
    const midFlight = await resolveOnce("turn_j12i_mid");
    expect(midFlight.concept_ids).not.toContain(CONCEPT);

    // Completion leg: the existing recovery path (re-run publish) forward-
    // completes the crashed journal — the manifest cut lands and the SAME
    // approval finishes the transaction.
    world.clock.advance(60_000);
    const resumed = await publishCandidate(world.deps, CAND);
    expect(resumed.status).toBe("published");
    const manifest = await readManifest(world.orgRoot);
    expect(manifest?.history).toHaveLength(1);
    expect(manifest?.history[0]?.concepts).toContain(CONCEPT);

    // AFTER the cut the concept resolves, and bundle_versions reports the
    // post-cut version — commit is the reader-visible state change.
    const committed = await resolveOnce("turn_j12i_post");
    expect(committed.concept_ids).toContain(CONCEPT);
    expect(committed.bundle_versions["org"]).toBe(manifest?.bundle_version);
  });
});
