// CF-J12-RC — re-run/replay legs (L2 state, risk E1; case-catalog.md;
// contracts/B-11-learning-publisher.md §3-§4):
//
//   - re-run of a COMPLETED human-gated transaction is a no-op with
//     reference — it refuses naming the already-consumed approval and
//     changes no durable state;
//   - the rejection ledger records once (append-only, idempotent per
//     candidate) and SUPPRESSES a same-lesson re-publish inside the policy
//     window; a candidate carrying the override evidence multiple passes.
//
// The routine-lane replay (journal done → identical published outcome) is
// CF-SM-LEARN-R, hermetic/cf-sm-learn/cf-sm-learn-r.test.ts.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openCandidateArtifact } from "../../../src/org/learning/candidate-store.js";
import { readManifest } from "../../../src/org/learning/concepts.js";
import { publishCandidate } from "../../../src/org/learning/publisher.js";
import { readRejections } from "../../../src/org/learning/rejections.js";
import { writeReviewerVerdict } from "../../../src/org/learning/review.js";
import {
  assertExactlyOncePublish,
  candidateSpec,
  makeLearningWorld,
  raiseAndApprove,
  seedReviewedOkfCandidate,
  verdictSpec,
  type LearningWorld,
} from "./learning-seams.js";

const ERROR_CLASS = "tooling.j12rc-flaky-fixture";

describe("CF-J12-RC — completed transactions no-op; the rejection ledger suppresses re-publish (L2, E1)", () => {
  let world: LearningWorld;

  beforeAll(async () => {
    world = await makeLearningWorld("cf-j12-rc");
  });

  afterAll(async () => {
    await world.cleanup();
  });

  it("re-running a completed human-gated publish refuses with the approval reference and changes nothing (B-11 §4)", async () => {
    const CAND = "cand_j12rc_done";
    await seedReviewedOkfCandidate(world, {
      id: CAND,
      conceptId: "lrn_j12rc_done",
      name: "j12rc-done",
    });
    const approvalId = await raiseAndApprove(world, CAND);
    const published = await publishCandidate(world.deps, CAND);
    expect(published.status).toBe("published");

    // Snapshot every durable surface the transaction owns.
    const conceptPath = join(world.org.orgHome, "learning", "bundle", "org", "j12rc-done.md");
    const before = {
      concept: await readFile(conceptPath, "utf8"),
      manifest: JSON.stringify(await readManifest(world.orgRoot)),
      intervention: await readFile(
        join(world.org.orgHome, "learning", "interventions", "int_j12rc_done.json"),
        "utf8",
      ),
    };

    world.clock.advance(60_000);
    const rerun = await publishCandidate(world.deps, CAND);
    expect(rerun.status).toBe("refused");
    if (rerun.status === "refused") {
      // No-op WITH REFERENCE: the refusal names the consumed approval.
      expect(rerun.reason).toContain(approvalId);
      expect(rerun.reason).toContain("already published");
    }

    expect(await readFile(conceptPath, "utf8")).toBe(before.concept);
    expect(JSON.stringify(await readManifest(world.orgRoot))).toBe(before.manifest);
    expect(
      await readFile(
        join(world.org.orgHome, "learning", "interventions", "int_j12rc_done.json"),
        "utf8",
      ),
    ).toBe(before.intervention);
    await assertExactlyOncePublish({ world, candidateId: CAND, conceptId: "lrn_j12rc_done" });
  });

  it("a review-rejected candidate lands in the ledger exactly once — the re-run reports the existing entry, never appends a duplicate", async () => {
    const CAND = "cand_j12rc_rejected";
    await openCandidateArtifact(
      world.orgRoot,
      candidateSpec({ id: CAND, destination: "skill_draft", errorClass: ERROR_CLASS }),
    );
    // Reviewer verdict: proceed, but route the content to the ledger.
    await writeReviewerVerdict(
      world.org.orgHome,
      verdictSpec({ id: CAND, destination: "reject", rationale: "recurring noise, not a lesson" }),
    );

    const first = await publishCandidate(world.deps, CAND);
    expect(first.status).toBe("rejected");
    world.clock.advance(60_000);
    const second = await publishCandidate(world.deps, CAND);
    expect(second.status).toBe("rejected");
    if (first.status === "rejected" && second.status === "rejected") {
      expect(second.entry).toEqual(first.entry);
      expect(first.entry.suppress_key).toBe(ERROR_CLASS);
    }
    const ledger = await readRejections(world.org.orgHome);
    expect(ledger.filter((entry) => entry.candidate_id === CAND)).toHaveLength(1);
  });

  it("negative control: a same-error-class candidate re-published inside the window makes the suppression detector fire (policy §13)", async () => {
    // Seed = the rejection recorded by the previous test (same suppress key).
    const CAND = "cand_j12rc_reworded";
    await openCandidateArtifact(
      world.orgRoot,
      candidateSpec({ id: CAND, destination: "skill_draft", errorClass: ERROR_CLASS }),
    );
    await writeReviewerVerdict(
      world.org.orgHome,
      verdictSpec({ id: CAND, destination: "skill_draft" }),
    );
    const outcome = await publishCandidate(world.deps, CAND);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") {
      expect(outcome.reason).toContain("suppression window");
      expect(outcome.reason).toContain(ERROR_CLASS);
    }
  });

  it("the override path is evidence, not time: a same-class candidate carrying override_if_evidence_x times the evidence publishes (policy §13)", async () => {
    const CAND = "cand_j12rc_evidence";
    await openCandidateArtifact(
      world.orgRoot,
      candidateSpec({
        id: CAND,
        destination: "skill_draft",
        errorClass: ERROR_CLASS,
        // The rejected entry carried 1 distinct evidence ref (its episode
        // id); override_if_evidence_x is 2 in the product's default policy,
        // so 3 distinct refs clears the bar with margin.
        evidenceRefs: ["runs/a#1", "runs/b#2"],
      }),
    );
    await writeReviewerVerdict(
      world.org.orgHome,
      verdictSpec({ id: CAND, destination: "skill_draft" }),
    );
    const outcome = await publishCandidate(world.deps, CAND);
    expect(outcome.status).toBe("published");
  });
});
