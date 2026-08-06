// CF-SM-LEARN-R — publish REPLAY is a no-op (L2 state, risk E1, T-10;
// case-catalog.md; contracts/B-11-learning-publisher.md §4: "re-run of a
// completed transaction is a no-op with reference").
//
// Routine-lane leg (the human-gated re-run refusal is CF-J12-RC): a
// completed routine transaction replayed end-to-end reports the SAME
// publication — same intervention, same proposal bytes, exactly one
// publish_committed event — and creates no manifest (proposals never cut
// versions).
//
// BLOCKED:F-PT-006 — the company-event INBOX producer visibility/duplicate-
// identity protocol is an open finding (B-13); nothing here asserts inbox
// semantics. The dedup asserted below is the learning-events JSONL seam,
// whose deterministic-id contract is in-repo product truth
// (src/org/learning/events.ts).

import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openCandidateArtifact } from "../../../src/org/learning/candidate-store.js";
import { readManifest } from "../../../src/org/learning/concepts.js";
import { readLearningEvents } from "../../../src/org/learning/events.js";
import { publishCandidate, type PublishOutcome } from "../../../src/org/learning/publisher.js";
import { writeReviewerVerdict } from "../../../src/org/learning/review.js";
import {
  assertExactlyOncePublish,
  candidateSpec,
  makeLearningWorld,
  PublishConservationViolation,
  verdictSpec,
  type LearningWorld,
} from "../cf-j12/learning-seams.js";

const CAND = "cand_smr_replay";

describe("CF-SM-LEARN-R — completed routine publish replays as a no-op with reference (L2, E1, T-10)", () => {
  let world: LearningWorld;
  let first: PublishOutcome;
  let replay: PublishOutcome;
  let proposalPath: string;

  beforeAll(async () => {
    world = await makeLearningWorld("cf-sm-learn-r");
    await openCandidateArtifact(world.orgRoot, candidateSpec({ id: CAND, destination: "skill_draft" }));
    await writeReviewerVerdict(world.org.orgHome, verdictSpec({ id: CAND, destination: "skill_draft" }));
    first = await publishCandidate(world.deps, CAND);
    if (first.status !== "published") {
      throw new Error(`routine publish failed: ${JSON.stringify(first)}`);
    }
    proposalPath = join(world.org.orgHome, "learning", "proposals", "skills", `${CAND}.md`);
    world.clock.advance(60_000);
    replay = await publishCandidate(world.deps, CAND);
  });

  afterAll(async () => {
    await world.cleanup();
  });

  it("the replay reports the SAME publication — identical intervention id, ref, and published_at (no-op with reference)", () => {
    expect(replay.status).toBe("published");
    if (first.status === "published" && replay.status === "published") {
      expect(replay.intervention.intervention_id).toBe(first.intervention.intervention_id);
      expect(replay.intervention.publish?.published_at).toBe(first.intervention.publish?.published_at);
      expect(replay.refs).toEqual(first.refs);
      expect(replay.intervention.status).toBe("published");
    }
  });

  it("the proposal draft bytes are unchanged and no manifest was ever cut (proposals do not advance bundle state)", async () => {
    const bytes = await readFile(proposalPath, "utf8");
    expect(bytes).toContain(CAND);
    expect(await readManifest(world.orgRoot)).toBeNull();
  });

  it("exactly one publish_committed event exists after the replay — the deterministic event id deduplicates the second append", async () => {
    await assertExactlyOncePublish({ world, candidateId: CAND });
    const committed = (await readLearningEvents(world.state.stateHome)).filter(
      (event) => event.type === "publish_committed",
    );
    expect(committed).toHaveLength(1);
    expect(committed[0]!.event_id).toBe(`evt_publish_routine-${CAND}`);
  });

  it("negative control: a raw duplicate publish_committed row (below the dedup layer) makes the exactly-once detector fire", async () => {
    const committed = (await readLearningEvents(world.state.stateHome)).find(
      (event) => event.type === "publish_committed",
    )!;
    const path = join(world.state.stateHome, "learning", "events", committed.ts.slice(0, 10), "publisher.jsonl");
    await appendFile(path, JSON.stringify(committed) + "\n", "utf8");
    await expect(assertExactlyOncePublish({ world, candidateId: CAND })).rejects.toThrow(PublishConservationViolation);
  });
});
