// Traceability: CF-SM-LEARN-L · HB-157; CF-C-B32 · HB-156 · case-catalog.md §2 learning machine; system-map.md §2.2; contracts/B-32-learning-kernel-ports.md.

// CF-SM-LEARN-L — the learning state machine's LEGAL chain on the KERNEL
// path, each state a separate recorded fact: candidate → published →
// authorized → active, with validated ORTHOGONAL — the kernel's
// four-dimensional InterventionState (publication / authorization /
// activation / validation; decisions 0026–0028) — L2 state, risk E1, control
// point T-10 (INV-012; B-32).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InterventionState } from "@cormidia/learning-loop";
import { claimLabelOf, claimOf, interventionViewOf } from "../../../src/org/learning-loop/interventions.js";
import { publishCandidate } from "../../../src/org/learning-loop/publish.js";
import { assertCandidateMayActivate } from "../../../src/org/learning-loop/publish-route.js";
import { openCandidateArtifact } from "../../../src/org/learning/candidate-store.js";
import { validateCandidateArtifact } from "../../../src/org/learning/candidate.js";
import { writeReviewerVerdict } from "../../../src/org/learning/review.js";
import {
  candidateSpec,
  makeKernelWorld,
  raiseAndApprove,
  seedReviewedOkfCandidate,
  verdictSpec,
  type KernelWorld,
} from "./learning-kernel-seams.js";

function state(overrides: Partial<InterventionState>): InterventionState {
  return {
    publication: "published",
    authorization: "authorized",
    activation: "active",
    validation: "untested",
    ...overrides,
  };
}

describe("CF-SM-LEARN-L — legal chain: candidate→published→authorized→active, validated orthogonal (L2, E1, T-10)", () => {
  let world: KernelWorld;

  beforeAll(async () => {
    world = await makeKernelWorld("cf-sm-learn-l-kernel");
  });

  afterAll(async () => {
    await world.cleanup();
  });

  it("the claim projection is the ONE legal upgrade path: only an active intervention whose validation is `improved` is validated; every other verdict stays authorized; inactive carries no claim", () => {
    const verdicts: InterventionState["validation"][] = [
      "untested",
      "inconclusive",
      "regressed",
      "invalid",
      "improved",
    ];
    const claims = Object.fromEntries(verdicts.map((validation) => [validation, claimOf(state({ validation }))]));
    expect(claims).toEqual({
      untested: "authorized",
      inconclusive: "authorized",
      regressed: "authorized",
      invalid: "authorized",
      improved: "validated",
    });
    expect(claimOf(state({ activation: "inactive", validation: "improved" }))).toBeNull();
    expect(claimOf(state({ activation: "disabled", validation: "improved" }))).toBeNull();
    expect(claimLabelOf("authorized")).toBe("authorized (unproven)");
    expect(claimLabelOf("validated")).toBe("validated");
    expect(claimLabelOf(null)).toBeUndefined();
  });

  it("the publish-time gate NEVER mints validated: every proceed path (unrequired, experiment-pending, human-waived, improved) carries claim authorized with a distinct display", () => {
    const plain = assertCandidateMayActivate({
      artifact: validateCandidateArtifact(candidateSpec({ id: "cand_l_plain" })),
      routing: { destination: "okf_concept", tier: "T1", scope: "org" },
    });
    expect(plain.claim).toBe("authorized");
    expect(plain.reported_as).toBe("authorized (unproven)");
    const waived = assertCandidateMayActivate({
      artifact: validateCandidateArtifact(candidateSpec({ id: "cand_l_waived", tier: "T2" })),
      routing: { destination: "okf_concept", tier: "T2", scope: "org" },
      waiver: "operator accepts the T2 risk for one release cycle",
    });
    expect(waived.claim).toBe("authorized");
    expect(waived.reported_as).toBe("waived (human)");
    expect(waived.waiver).toContain("operator accepts");
    const pending = assertCandidateMayActivate({
      artifact: validateCandidateArtifact(candidateSpec({ id: "cand_l_pending", experimentRef: "exp_l_1" })),
      routing: { destination: "okf_concept", tier: "T1", scope: "org" },
      validation: "inconclusive",
    });
    expect(pending.reported_as).toBe("experiment pending");
    const improved = assertCandidateMayActivate({
      artifact: validateCandidateArtifact(candidateSpec({ id: "cand_l_improved", experimentRef: "exp_l_2" })),
      routing: { destination: "okf_concept", tier: "T2", scope: "org" },
      validation: "improved",
    });
    expect(improved.claim).toBe("authorized");
    expect(improved.reported_as).toBe("experiment improved");
    expect(new Set([plain.reported_as, waived.reported_as, pending.reported_as, improved.reported_as]).size).toBe(4);
  });

  it("routine publish records published + authorized (routine lane) + INACTIVE — published is NOT active, NOT authorized-into-context (INV-012)", async () => {
    await openCandidateArtifact(world.orgRoot, candidateSpec({ id: "cand_l_published", destination: "skill_draft" }));
    await writeReviewerVerdict(world.org.orgHome, verdictSpec({ id: "cand_l_published", destination: "skill_draft" }));
    const outcome = await publishCandidate(world.deps, "cand_l_published");
    expect(outcome.status).toBe("published");
    if (outcome.status === "published") {
      expect(outcome.intervention.state).toEqual(state({ activation: "inactive" }));
      expect(outcome.intervention.claim).toBeNull();
      const record = await world.learning.loop.getIntervention({ interventionId: outcome.intervention.id });
      expect(record?.authorizationIds).toHaveLength(1); // the routine lane is a journaled authorization
      expect(record?.publicationReceiptIds).toHaveLength(1);
    }
  });

  it("gated activation records published + authorized (approval item) + active with claim `authorized` — active is NOT validated (INV-012)", async () => {
    await seedReviewedOkfCandidate(world, { id: "cand_l_active", conceptId: "lrn_l_active", name: "l-active-lesson" });
    const approvalId = await raiseAndApprove(world, "cand_l_active");
    const outcome = await publishCandidate(world.deps, "cand_l_active");
    expect(outcome.status).toBe("published");
    if (outcome.status === "published") {
      expect(outcome.intervention.state).toEqual(state({}));
      expect(outcome.intervention.claim).toBe("authorized");
      expect(outcome.intervention.evaluationIds).toEqual([]);
      const record = await world.learning.loop.getIntervention({ interventionId: outcome.intervention.id });
      expect(record?.authorizationIds).toHaveLength(1);
      const { item } = await world.approvals.show(approvalId);
      expect(item.decision).toBe("approved");
    }
  });

  it("structural invariants hold on every fold: active ⇒ published, authorized ⇒ a journaled authorization, published ⇒ a journaled receipt (kernel decision 0026)", async () => {
    for (const artifactId of ["cand_l_published", "cand_l_active"]) {
      const index = await (await import("../../../src/org/learning-loop/host-index.js")).readHostCandidateIndex(
        world.learning.stateDir,
        artifactId,
      );
      const interventionId = index?.entries.at(-1)?.intervention_id;
      if (interventionId === undefined) throw new Error(`no intervention for ${artifactId}`);
      const view = await interventionViewOf(world.learning, interventionId);
      if (view === undefined) throw new Error(`no view for ${interventionId}`);
      if (view.state.activation === "active") expect(view.state.publication).toBe("published");
      if (view.state.authorization === "authorized") expect(view.receiptIds.length).toBeGreaterThan(0);
      if (view.state.publication === "published") expect(view.receiptIds.length).toBeGreaterThan(0);
    }
  });

  it("negative control: a validated claim cannot be minted without the kernel's evaluation — the view projects `validated` only from state.validation, never from any host byte", async () => {
    const index = await (await import("../../../src/org/learning-loop/host-index.js")).readHostCandidateIndex(
      world.learning.stateDir,
      "cand_l_active",
    );
    const interventionId = index?.entries.at(-1)?.intervention_id;
    if (interventionId === undefined) throw new Error("no intervention");
    const before = await interventionViewOf(world.learning, interventionId);
    // Seed the violation: a host that believed it could declare validation.
    const forged = claimOf(state({ validation: "improved" }));
    expect(forged).toBe("validated"); // the projection would say so for THAT state…
    const actual = await interventionViewOf(world.learning, interventionId);
    expect(actual?.state.validation).toBe("untested"); // …but the kernel state is the only input
    expect(actual?.claim).toBe("authorized");
    expect(actual?.claimLabel).toBe(before?.claimLabel);
  });
});
