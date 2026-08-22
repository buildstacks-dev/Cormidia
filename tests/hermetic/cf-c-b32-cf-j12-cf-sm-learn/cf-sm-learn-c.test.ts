// Traceability: CF-SM-LEARN-C · HB-157; CF-C-B32 · HB-156 · case-catalog.md §2 learning machine; system-map.md §2.2; contracts/B-32-learning-kernel-ports.md.

// CF-SM-LEARN-C — crash leg of the learning state machine on the KERNEL path
// (the earlier crash points live in cf-j12-i.test.ts): a crash AFTER the
// kernel consumed the authorization but BEFORE any destination effect applied.
// The kernel journal's first durable fact is the consumption (decision 0026),
// so the resume never re-consults authority, never raises a second approval,
// applies the effects exactly once, and completes — one cut, one event, one
// intervention, one journaled authorization.
//
// Crash method: the B-32 §4 destination-port seam armed to throw BEFORE the
// OKF destination does anything; the journal state after the crash is
// asserted as a precondition.
//
// F-PT-008 is resolved-ratified: expiry reopens the original item with append-only history.
// The assertions below cover consumption of a live authorization in the
// kernel journal only; the dedicated expiry-disposition cases live with
// CF-B09a.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicationDestination } from "@cormidia/learning-loop";
import { interventionIdForPlan } from "../../../src/org/learning-loop/interventions.js";
import { readHostCandidateIndex } from "../../../src/org/learning-loop/host-index.js";
import { publishCandidate } from "../../../src/org/learning-loop/publish.js";
import { cutManifestVersion, readManifest } from "../../../src/org/learning-loop/host/concepts.js";
import { readLearningEvents } from "../../../src/org/learning-loop/host/events.js";
import {
  assertExactlyOncePublish,
  makeKernelWorld,
  PublishConservationViolation,
  raiseAndApprove,
  seedReviewedOkfCandidate,
  type KernelWorld,
} from "./learning-kernel-seams.js";

const CAND = "cand_smc_tail";
const CONCEPT = "lrn_smc_tail";
const NAME = "smc-tail-lesson";

class ScriptedCrash extends Error {
  constructor() {
    super("scripted crash before any destination effect");
    this.name = "ScriptedCrash";
  }
}

describe("CF-SM-LEARN-C — crash after authorization consumption, before any effect: resume completes once (L2, E1, T-10)", () => {
  let world: KernelWorld;
  let approvalId: string;
  let armed = false;

  beforeAll(async () => {
    world = await makeKernelWorld("cf-sm-learn-c-kernel", {
      wrapDestination: (real) => {
        if (real.id !== "okf-concept:org") return real;
        const wrapped: PublicationDestination = {
          id: real.id,
          prepare: (input) => real.prepare(input),
          applyEffect: (input) => {
            if (armed) throw new ScriptedCrash();
            return real.applyEffect(input);
          },
        };
        return wrapped;
      },
    });
    await seedReviewedOkfCandidate(world, { id: CAND, conceptId: CONCEPT, name: NAME });
    approvalId = await raiseAndApprove(world, CAND);
  });

  afterAll(async () => {
    await world.cleanup();
  });

  it("the armed seam kills the publish with the authorization consumed and NO effect applied; the kernel journals `failed` on a born intervention", async () => {
    armed = true;
    const failed = await publishCandidate(world.deps, CAND);
    expect(failed.status).toBe("refused");
    if (failed.status === "refused") expect(failed.reason).toContain("kernel failed");
    expect(await readManifest(world.orgRoot)).toBeNull();
    const planId = (await readHostCandidateIndex(world.learning.stateDir, CAND))?.entries.at(-1)?.plan_id;
    if (planId === undefined) throw new Error("no plan recorded");
    const record = await world.learning.loop.getIntervention({ interventionId: interventionIdForPlan(planId) });
    expect(record?.state.publication).toBe("failed");
    expect(record?.state.authorization).toBe("authorized"); // consumed before the crash
    expect(record?.authorizationIds).toHaveLength(1);
    expect(record?.publicationReceiptIds).toHaveLength(0);
  });

  it("the resume applies the effects exactly once and completes — one cut, one event, one intervention, the same single authorization, and no second approval", async () => {
    armed = false;
    world.clock.advance(60_000);
    const resumed = await publishCandidate(world.deps, CAND);
    expect(resumed.status).toBe("published");
    if (resumed.status === "published") {
      expect(resumed.intervention.state.activation).toBe("active");
      expect(resumed.intervention.state.publication).toBe("published");
    }
    await assertExactlyOncePublish({ world, candidateId: CAND, conceptId: CONCEPT });
    const manifest = await readManifest(world.orgRoot);
    expect(manifest?.history).toHaveLength(1);
    const committed = (await readLearningEvents(world.state.stateHome)).filter(
      (event) => event.type === "publish_committed",
    );
    expect(committed).toHaveLength(1);
    const decided = await world.approvals.listDecidedReadOnly();
    expect(decided.filter((item) => item.action.tool === "learning_loop_publish")).toHaveLength(1);
    expect((await world.approvals.listPending()).length).toBe(0);
    const { item } = await world.approvals.show(approvalId);
    expect(item.decision).toBe("approved");
    if (resumed.status === "published") {
      const record = await world.learning.loop.getIntervention({ interventionId: resumed.intervention.id });
      expect(record?.authorizationIds).toHaveLength(1);
      expect(record?.state.validation).toBe("untested"); // still never validated
    }
  });

  it("negative control: a seeded second manifest cut touching the same concept makes the conservation detector fire", async () => {
    await cutManifestVersion(world.orgRoot, {
      approvalRef: "appr-smc-duplicate",
      concepts: [CONCEPT],
      note: "seeded duplicate cut (negative control)",
      now: world.clock.nowDate(),
    });
    await expect(assertExactlyOncePublish({ world, candidateId: CAND, conceptId: CONCEPT })).rejects.toThrow(
      PublishConservationViolation,
    );
  });
});
