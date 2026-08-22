// Traceability: CF-SM-LEARN-R · HB-157; CF-C-B32 · HB-156 · case-catalog.md §2 learning machine; system-map.md §2.2; contracts/B-32-learning-kernel-ports.md.

// CF-SM-LEARN-R — publish REPLAY is a no-op on the KERNEL path (L2 state,
// risk E1, T-10; kernel decision 0026: a complete journal returns no_op;
// B-11 §4's "re-run of a completed transaction is a no-op with reference").
//
// Routine-lane leg (the human-gated re-run is CF-J12-RC): a completed
// routine transaction replayed end-to-end reports the SAME publication —
// same kernel intervention, same receipts, same proposal bytes, exactly one
// publish_committed event — and creates no manifest (proposals never cut
// versions).
//
// F-PT-006 is resolved-ratified: company-event identity is content-derived and
// producers owe no atomic rename. Nothing here asserts that B-13 seam. The dedup
// asserted below is the distinct learning-events JSONL seam, whose
// deterministic-id contract is in-repo product truth
// (src/org/learning-loop/host/events.ts).

import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publishCandidate, type PublishOutcome } from "../../../src/org/learning-loop/publish.js";
import { openCandidateArtifact } from "../../../src/org/learning-loop/host/candidate-store.js";
import { readManifest } from "../../../src/org/learning-loop/host/concepts.js";
import { readLearningEvents } from "../../../src/org/learning-loop/host/events.js";
import { writeReviewerVerdict } from "../../../src/org/learning-loop/host/review.js";
import {
  assertExactlyOncePublish,
  candidateSpec,
  makeKernelWorld,
  PublishConservationViolation,
  verdictSpec,
  type KernelWorld,
} from "./learning-kernel-seams.js";

const CAND = "cand_smr_replay";

describe("CF-SM-LEARN-R — completed routine publish replays as a no-op with reference (L2, E1, T-10)", () => {
  let world: KernelWorld;
  let first: PublishOutcome;
  let replay: PublishOutcome;
  let proposalPath: string;

  beforeAll(async () => {
    world = await makeKernelWorld("cf-sm-learn-r-kernel");
    await openCandidateArtifact(world.orgRoot, candidateSpec({ id: CAND, destination: "skill_draft" }));
    await writeReviewerVerdict(world.org.orgHome, verdictSpec({ id: CAND, destination: "skill_draft" }));
    first = await publishCandidate(world.deps, CAND);
    if (first.status !== "published") throw new Error(`routine publish failed: ${JSON.stringify(first)}`);
    proposalPath = join(world.org.orgHome, "learning", "proposals", "skills", `${CAND}.md`);
    world.clock.advance(60_000);
    replay = await publishCandidate(world.deps, CAND);
  });

  afterAll(async () => {
    await world.cleanup();
  });

  it("the replay reports the SAME publication — identical kernel intervention id, receipts, and refs (no-op with reference)", () => {
    expect(replay.status).toBe("published");
    if (first.status === "published" && replay.status === "published") {
      expect(replay.intervention.id).toBe(first.intervention.id);
      expect(replay.intervention.receiptIds).toEqual(first.intervention.receiptIds);
      expect(replay.refs).toEqual(first.refs);
      expect(replay.intervention.state.activation).toBe("inactive");
    }
  });

  it("the proposal draft bytes are unchanged and no manifest was ever cut (proposals do not advance bundle state)", async () => {
    const bytes = await readFile(proposalPath, "utf8");
    expect(bytes).toContain(CAND);
    expect(await readManifest(world.orgRoot)).toBeNull();
  });

  it("exactly one publish_committed event exists after the replay — the deterministic event id (keyed by the kernel plan) deduplicates the second append", async () => {
    await assertExactlyOncePublish({ world, candidateId: CAND });
    const committed = (await readLearningEvents(world.state.stateHome)).filter(
      (event) => event.type === "publish_committed",
    );
    expect(committed).toHaveLength(1);
    expect(committed[0]?.event_id).toMatch(/^evt_publish_plan-[0-9a-f]{64}$/);
    expect(committed[0]?.payload?.["approval_ref"]).toBe("routine");
  });

  it("negative control: a raw duplicate publish_committed row (below the dedup layer) makes the exactly-once detector fire", async () => {
    const committed = (await readLearningEvents(world.state.stateHome)).find(
      (event) => event.type === "publish_committed",
    );
    if (committed === undefined) throw new Error("no publish_committed event");
    const path = join(world.state.stateHome, "learning", "events", committed.ts.slice(0, 10), "publisher.jsonl");
    await appendFile(path, `${JSON.stringify(committed)}\n`, "utf8");
    await expect(assertExactlyOncePublish({ world, candidateId: CAND })).rejects.toThrow(PublishConservationViolation);
  });
});
