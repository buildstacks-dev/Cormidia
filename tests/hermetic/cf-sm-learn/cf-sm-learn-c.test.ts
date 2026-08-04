// CF-SM-LEARN-C — crash leg of the learning state machine, "per CF-J12-I"
// (case-catalog.md): the earlier crash points (before the artifact step;
// between artifact and manifest cut) and the mid-transaction reader tripwire
// live in hermetic/cf-j12/cf-j12-i.test.ts. This file owns the TAIL of the
// transaction: a crash after the grant is consumed but before the done mark
// — the resume must NO-OP every already-receipted step by approval ID and
// only mark done (contracts/B-11-learning-publisher.md §3/§4; the publisher's
// own documented crash window, src/org/learning/publisher.ts).
//
// Crash method: interrupted sequence via the injected B-06 clock (clockFuse);
// the journal state after the crash is asserted as a precondition so a
// refactor that moves clock reads cannot silently change which window this
// tests.
//
// BLOCKED:F-PT-008 — grant-EXPIRY item disposition is an open finding; the
// grant assertions below cover consumption of a live grant only.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cutManifestVersion, readManifest } from "../../../src/org/learning/concepts.js";
import {
  readLearningEvents,
  sanitizeIdSegment,
} from "../../../src/org/learning/events.js";
import { readInterventionRecord } from "../../../src/org/learning/intervention.js";
import { publishCandidate } from "../../../src/org/learning/publisher.js";
import {
  assertExactlyOncePublish,
  clockFuse,
  ClockFuseError,
  makeLearningWorld,
  PublishConservationViolation,
  raiseAndApprove,
  seedReviewedOkfCandidate,
  type LearningWorld,
} from "../cf-j12/learning-seams.js";

const CAND = "cand_smc_tail";
const CONCEPT = "lrn_smc_tail";
const NAME = "smc-tail-lesson";
const TRAILING_HYPHEN_APPROVAL_ID = "20260731T120000Z-smc-";

interface JournalOnDisk {
  artifact_ref?: string;
  manifest_version?: string;
  intervention_id?: string;
  done_at?: string;
}

describe("CF-SM-LEARN-C — crash after grant consumption, before the done mark: resume no-ops by approval ID (L2, E1, T-10)", () => {
  let world: LearningWorld;
  let approvalId: string;

  beforeAll(async () => {
    world = await makeLearningWorld("cf-sm-learn-c", {
      approvalId: TRAILING_HYPHEN_APPROVAL_ID,
    });
    await seedReviewedOkfCandidate(world, { id: CAND, conceptId: CONCEPT, name: NAME });
    approvalId = await raiseAndApprove(world, CAND);
    expect(approvalId).toBe(TRAILING_HYPHEN_APPROVAL_ID);
  });

  afterAll(async () => {
    await world.cleanup();
  });

  const readJournal = async (): Promise<JournalOnDisk> =>
    JSON.parse(
      await readFile(
        join(
          world.state.stateHome,
          "learning",
          "publish-journal",
          `${sanitizeIdSegment(approvalId)}.json`,
        ),
        "utf8",
      ),
    ) as JournalOnDisk;

  it("the fused clock kills the transaction with every step receipted, the grant consumed, and the journal NOT done", async () => {
    // Clock reads on this path: (1) suppression check, (2) manifest cut,
    // (3) lineage published_at, (4) event ts, (5) grant consumption — the
    // fuse serves five and blows on the done-mark's read.
    await expect(
      publishCandidate({ ...world.deps, clock: clockFuse(world.clock, 5) }, CAND),
    ).rejects.toThrow(ClockFuseError);

    const journal = await readJournal();
    expect(journal.artifact_ref).toBeDefined();
    expect(journal.manifest_version).toBeDefined();
    expect(journal.intervention_id).toBeDefined();
    expect(journal.done_at).toBeUndefined();
    const { grant } = await world.approvals.show(approvalId);
    expect(grant?.uses).toBe(0); // consumed before the crash
  });

  it("the resume no-ops every completed step and only marks done — exactly one cut, one event, one intervention, and the consumed grant blocks nothing", async () => {
    world.clock.advance(60_000);
    const resumed = await publishCandidate(world.deps, CAND);
    expect(resumed.status).toBe("published");
    if (resumed.status === "published") {
      expect(resumed.intervention.status).toBe("active");
      expect(resumed.intervention.approval_ref).toBe(approvalId);
    }

    expect((await readJournal()).done_at).toBeDefined();
    await assertExactlyOncePublish({ world, candidateId: CAND, conceptId: CONCEPT });
    const manifest = await readManifest(world.orgRoot);
    expect(manifest?.history).toHaveLength(1);
    const committed = (await readLearningEvents(world.state.stateHome)).filter(
      (event) => event.type === "publish_committed",
    );
    expect(committed).toHaveLength(1);
    const record = await readInterventionRecord(world.org.orgHome, "int_smc_tail");
    expect(record.activation?.claim).toBe("authorized"); // still never validated
  });

  it("negative control: a seeded second manifest cut touching the same concept makes the conservation detector fire", async () => {
    // Seed the violation a double-resume bug would produce: another cut for
    // the same concept under a different approval ref.
    await cutManifestVersion(world.orgRoot, {
      approvalRef: "appr-smc-duplicate",
      concepts: [CONCEPT],
      note: "seeded duplicate cut (negative control)",
      now: world.clock.nowDate(),
    });
    await expect(
      assertExactlyOncePublish({ world, candidateId: CAND, conceptId: CONCEPT }),
    ).rejects.toThrow(PublishConservationViolation);
  });
});
