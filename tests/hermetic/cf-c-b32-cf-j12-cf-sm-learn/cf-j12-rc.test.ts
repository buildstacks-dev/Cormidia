// Traceability: CF-J12-RC · HB-157; CF-C-B32 · HB-156 · contracts/journey-acceptance.md J-12 recovery criterion; contracts/B-32-learning-kernel-ports.md.

// CF-J12-RC — re-run/replay legs on the KERNEL path (L2 state, risk E1;
// Cormidia #467 phase B; kernel decision 0026 §4 no-op with reference):
//
//   - re-running a COMPLETED human-gated publish is a no-op with reference —
//     the kernel answers the same intervention from its journal, authority is
//     never re-consulted, and no durable state changes (the forked engine
//     refused with the consumed approval id; the kernel reports the same
//     publication — B-11 §4's "no-op with reference", kernel-shaped);
//   - the rejection ledger records once (append-only, idempotent per
//     candidate) and SUPPRESSES a same-lesson re-publish inside the policy
//     window; a candidate carrying the override evidence multiple passes.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publishCandidate } from "../../../src/org/learning-loop/publish.js";
import { openCandidateArtifact } from "../../../src/org/learning-loop/host/candidate-store.js";
import { readManifest } from "../../../src/org/learning-loop/host/concepts.js";
import { readRejections } from "../../../src/org/learning-loop/host/rejections.js";
import { writeReviewerVerdict } from "../../../src/org/learning-loop/host/review.js";
import { walkFiles } from "../../fixtures/walk.js";
import {
  assertExactlyOncePublish,
  candidateSpec,
  makeKernelWorld,
  raiseAndApprove,
  seedReviewedOkfCandidate,
  verdictSpec,
  type KernelWorld,
} from "./learning-kernel-seams.js";

const ERROR_CLASS = "tooling.j12rc-flaky-fixture";

describe("CF-J12-RC — completed publishes no-op with reference; the rejection ledger suppresses re-publish (L2, E1)", () => {
  let world: KernelWorld;

  beforeAll(async () => {
    world = await makeKernelWorld("cf-j12-rc-kernel");
  });

  afterAll(async () => {
    await world.cleanup();
  });

  it("re-running a completed human-gated publish reports the SAME kernel intervention and changes nothing durable", async () => {
    const CAND = "cand_j12rc_done";
    await seedReviewedOkfCandidate(world, { id: CAND, conceptId: "lrn_j12rc_done", name: "j12rc-done" });
    const approvalId = await raiseAndApprove(world, CAND);
    const published = await publishCandidate(world.deps, CAND);
    expect(published.status).toBe("published");
    if (published.status !== "published") return;

    // Snapshot every durable surface the transaction owns.
    const conceptPath = join(world.org.orgHome, "learning", "bundle", "org", "j12rc-done.md");
    const before = {
      concept: await readFile(conceptPath, "utf8"),
      manifest: JSON.stringify(await readManifest(world.orgRoot)),
      kernelFiles: (await walkFiles(world.learning.stateDir)).sort(),
      approvals: (await world.approvals.listDecidedReadOnly()).length,
    };

    world.clock.advance(60_000);
    const rerun = await publishCandidate(world.deps, CAND);
    expect(rerun.status).toBe("published");
    if (rerun.status === "published") {
      // No-op WITH REFERENCE: the same intervention, the same receipts.
      expect(rerun.intervention.id).toBe(published.intervention.id);
      expect(rerun.intervention.receiptIds).toEqual(published.intervention.receiptIds);
      expect(rerun.refs).toEqual(published.refs);
    }
    expect(await readFile(conceptPath, "utf8")).toBe(before.concept);
    expect(JSON.stringify(await readManifest(world.orgRoot))).toBe(before.manifest);
    expect((await walkFiles(world.learning.stateDir)).sort()).toEqual(before.kernelFiles);
    expect((await world.approvals.listDecidedReadOnly()).length).toBe(before.approvals);
    expect((await world.approvals.listPending()).length).toBe(0);
    const { item } = await world.approvals.show(approvalId);
    expect(item.decision).toBe("approved");
    await assertExactlyOncePublish({ world, candidateId: CAND, conceptId: "lrn_j12rc_done" });
  });

  it("a review-rejected candidate lands in the ledger exactly once — the re-run reports the existing entry, never appends a duplicate", async () => {
    const CAND = "cand_j12rc_rejected";
    await openCandidateArtifact(
      world.orgRoot,
      candidateSpec({ id: CAND, destination: "skill_draft", errorClass: ERROR_CLASS }),
    );
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
    // A rejection mints no kernel candidate: the ledger is the destination.
    expect(await world.learning.loop.getCandidateView({ candidateId: CAND })).toBeUndefined();
  });

  it("negative control: a same-error-class candidate re-published inside the window makes the suppression detector fire (policy §13)", async () => {
    const CAND = "cand_j12rc_reworded";
    await openCandidateArtifact(
      world.orgRoot,
      candidateSpec({ id: CAND, destination: "skill_draft", errorClass: ERROR_CLASS }),
    );
    await writeReviewerVerdict(world.org.orgHome, verdictSpec({ id: CAND, destination: "skill_draft" }));
    const outcome = await publishCandidate(world.deps, CAND);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") {
      expect(outcome.reason).toContain("suppression window");
      expect(outcome.reason).toContain(ERROR_CLASS);
    }
  });

  it("the override path is evidence, not time: a same-class candidate carrying override_if_evidence_x times the evidence publishes routinely through the kernel", async () => {
    const CAND = "cand_j12rc_evidence";
    await openCandidateArtifact(
      world.orgRoot,
      candidateSpec({
        id: CAND,
        destination: "skill_draft",
        errorClass: ERROR_CLASS,
        evidenceRefs: ["runs/a#1", "runs/b#2"],
      }),
    );
    await writeReviewerVerdict(world.org.orgHome, verdictSpec({ id: CAND, destination: "skill_draft" }));
    const outcome = await publishCandidate(world.deps, CAND);
    expect(outcome.status).toBe("published");
    if (outcome.status === "published") {
      // A proposal-class publish is published but INACTIVE and carries no claim.
      expect(outcome.intervention.state.activation).toBe("inactive");
      expect(outcome.intervention.claim).toBeNull();
      const record = await world.learning.loop.getIntervention({ interventionId: outcome.intervention.id });
      expect(record?.state.authorization).toBe("authorized"); // the routine lane, journaled
    }
  });
});
