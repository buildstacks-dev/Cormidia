// CF-SM-LEARN-L — the learning state machine's LEGAL chain, each state a
// separate recorded fact: candidate → published → authorized → active, with
// validated ORTHOGONAL (earned only by a completed experiment) — L2 state,
// risk E1, control point T-10 (case-catalog.md; INV-012;
// contracts/B-11-learning-publisher.md §2).
//
// Shares the world/builders of hermetic/cf-j12/learning-seams.ts — CF-B11-*
// is dup-pruned onto CF-J12-* + CF-SM-LEARN-* (case-catalog.md).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertCandidateCanProceed,
  claimAfterEval,
  validateCandidateArtifact,
} from "../../../src/org/learning/candidate.js";
import { openCandidateArtifact } from "../../../src/org/learning/candidate-store.js";
import type { EvalVerdict } from "../../../src/org/learning/eval-result.js";
import {
  interventionChainGaps,
  validateInterventionRecord,
} from "../../../src/org/learning/intervention.js";
import { publishCandidate } from "../../../src/org/learning/publisher.js";
import { writeReviewerVerdict } from "../../../src/org/learning/review.js";
import { sha256Ref } from "../../../src/org/learning/candidate-store.js";
import {
  candidateSpec,
  makeLearningWorld,
  raiseAndApprove,
  seedReviewedOkfCandidate,
  verdictSpec,
  type LearningWorld,
} from "../cf-j12/learning-seams.js";

describe("CF-SM-LEARN-L — legal chain: candidate→published→authorized→active, validated orthogonal (L2, E1, T-10)", () => {
  let world: LearningWorld;

  beforeAll(async () => {
    world = await makeLearningWorld("cf-sm-learn-l");
  });

  afterAll(async () => {
    await world.cleanup();
  });

  it("claimAfterEval is the ONE legal upgrade path: only `improved` yields validated; every other verdict stays authorized (design §9.1)", () => {
    const verdicts: EvalVerdict[] = ["improved", "regressed", "inconclusive", "not_evaluatable"];
    const claims = Object.fromEntries(verdicts.map((verdict) => [verdict, claimAfterEval(verdict)]));
    expect(claims).toEqual({
      improved: "validated",
      regressed: "authorized",
      inconclusive: "authorized",
      not_evaluatable: "authorized",
    });
  });

  it("the publish-time gate NEVER mints validated: every proceed path (unrequired, experiment-pending, human-waived) carries claim authorized with a distinct display", () => {
    const plain = assertCandidateCanProceed(
      validateCandidateArtifact(candidateSpec({ id: "cand_l_plain" })),
    );
    expect(plain.claim).toBe("authorized");
    expect(plain.reported_as).toBe("authorized (unproven)");

    const waived = assertCandidateCanProceed(
      validateCandidateArtifact(candidateSpec({ id: "cand_l_waived", tier: "T2" })),
      { humanWaiver: "operator accepts the T2 risk for one release cycle" },
    );
    expect(waived.claim).toBe("authorized");
    expect(waived.reported_as).toBe("waived (human)");
    expect(waived.waiver).toContain("operator accepts");

    // Three distinct displays for three distinct evidentiary situations —
    // reports can never blur them into one "approved".
    expect(new Set([plain.reported_as, waived.reported_as, "experiment pending"]).size).toBe(3);
  });

  it("routine publish records status `published` with activation null — published is NOT active, NOT authorized-into-context (INV-012)", async () => {
    await openCandidateArtifact(
      world.orgRoot,
      candidateSpec({ id: "cand_l_published", destination: "skill_draft" }),
    );
    await writeReviewerVerdict(
      world.org.orgHome,
      verdictSpec({ id: "cand_l_published", destination: "skill_draft" }),
    );
    const outcome = await publishCandidate(world.deps, "cand_l_published");
    expect(outcome.status).toBe("published");
    if (outcome.status === "published") {
      expect(outcome.intervention.status).toBe("published");
      expect(outcome.intervention.activation).toBeNull();
      expect(outcome.intervention.approval_ref).toBeNull();
    }
  });

  it("gated activation records status `active` with claim `authorized` — active is NOT validated (INV-012)", async () => {
    await seedReviewedOkfCandidate(world, {
      id: "cand_l_active",
      conceptId: "lrn_l_active",
      name: "l-active-lesson",
    });
    const approvalId = await raiseAndApprove(world, "cand_l_active");
    const outcome = await publishCandidate(world.deps, "cand_l_active");
    expect(outcome.status).toBe("published");
    if (outcome.status === "published") {
      expect(outcome.intervention.status).toBe("active");
      expect(outcome.intervention.activation?.claim).toBe("authorized");
      expect(outcome.intervention.approval_ref).toBe(approvalId);
      // Validated requires lineage this record does not have.
      expect(outcome.intervention.outcome_ref).toBeNull();
    }
  });

  it("a missing chain link is REPORTED as a gap, never silently filled: an active okf record without approval_ref names the hole", () => {
    const record = validateInterventionRecord({
      schema_version: 1,
      intervention_id: "int_l_gappy",
      candidate_ref: "cand_l_gappy",
      destination: "okf_concept",
      reviewed_content_hash: sha256Ref("gappy"),
      approval_ref: null,
      publish: {
        kind: "bundle_version",
        ref: "org@2026.07.30-9",
        commit: null,
        published_at: "2026-07-30T00:00:00.000Z",
      },
      activation: { activated_at: "2026-07-30T00:00:00.000Z", claim: "authorized" },
      affected_episodes: null,
      experiment_ref: null,
      outcome_ref: null,
      rollback: null,
      status: "active",
    });
    const gaps = interventionChainGaps(record);
    expect(gaps).toContain("approval_ref");
    expect(gaps).toContain("affected_episodes");
  });

  it("negative control: a validated claim without its experiment lineage is unrepresentable — the validator fires (the one legal upgrade path, seeded violation)", () => {
    expect(() =>
      validateInterventionRecord({
        schema_version: 1,
        intervention_id: "int_l_forged",
        candidate_ref: "cand_l_forged",
        destination: "okf_concept",
        reviewed_content_hash: sha256Ref("forged"),
        approval_ref: "appr-1",
        publish: {
          kind: "bundle_version",
          ref: "org@2026.07.30-9",
          commit: null,
          published_at: "2026-07-30T00:00:00.000Z",
        },
        activation: { activated_at: "2026-07-30T00:00:00.000Z", claim: "validated" },
        affected_episodes: { query: "q" },
        experiment_ref: null,
        outcome_ref: null,
        rollback: null,
        status: "active",
      }),
    ).toThrow(/validated.*without experiment_ref and.*outcome_ref/s);
  });
});
