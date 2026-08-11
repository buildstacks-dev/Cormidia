// CF-SM-ACC-L / CF-SM-ACC-I / CF-SM-ACC-R / CF-SM-ACC-C — HB-127 — case-catalog.md §2 campaign lifecycle.

// The campaign lifecycle (L1).
//
// One transition carries the family: build-arm entry is illegal without a
// durable gate resolution, and a resolution written after the first build turn
// is a violation rather than an ordering detail. Everything else — the legal
// walk, the two typed terminals, resume binding the config hash — exists to
// make that one rule unavoidable rather than remembered.

import { describe, expect, it } from "vitest";
import {
  CampaignLifecycle,
  CampaignLifecycleError,
  type CampaignState,
  type PlanGateResolution,
} from "../../../campaign/acceptance/campaign-lifecycle.js";

const CONFIG_HASH = "f".repeat(64);

function lifecycle(): CampaignLifecycle {
  return new CampaignLifecycle({ configHash: CONFIG_HASH, scenarioId: "S-ACC-1" });
}

function resolution(overrides: Partial<PlanGateResolution> = {}): PlanGateResolution {
  return {
    scenarioId: "S-ACC-1",
    applicable: true,
    resolvedBy: "declared-policy",
    decision: "continue",
    scores: { "P-1": 2, "P-5": 2 },
    reason: "rubric §6: every scenario reached at least attempted on P-1 and P-5",
    ...overrides,
  };
}

function refusal(run: () => unknown): CampaignLifecycleError {
  try {
    run();
  } catch (error) {
    if (error instanceof CampaignLifecycleError) return error;
    throw error;
  }
  throw new Error("expected a CampaignLifecycleError, but the transition was accepted");
}

describe("CF-SM-ACC-L legal transitions", () => {
  it("walks authorized → provisioned → plan-arm → plan-gated → build-arm → graded → reported", () => {
    const machine = lifecycle();
    const walk: CampaignState[] = ["provisioned", "plan-arm", "plan-gated"];
    for (const next of walk) machine.transition(next);
    machine.recordGateResolution(resolution());
    machine.transition("build-arm");
    machine.noteBuildArmSpend();
    machine.transition("graded");
    machine.transition("reported");
    expect(machine.state()).toBe("reported");
    expect(machine.history).toEqual([
      "authorized",
      "provisioned",
      "plan-arm",
      "plan-gated",
      "build-arm",
      "graded",
      "reported",
    ]);
  });

  it("stopping at the gate is a terminal that still reports — never a failure", () => {
    const machine = lifecycle();
    for (const next of ["provisioned", "plan-arm", "plan-gated"] as CampaignState[]) machine.transition(next);
    machine.recordGateResolution(resolution({ decision: "stop", reason: "P-1 was absent on S-ACC-2" }));
    machine.transition("stopped-at-gate");
    machine.transition("reported");
    expect(machine.history).toContain("stopped-at-gate");
    expect(machine.buildArmSpendCount()).toBe(0);
  });

  it("records the resolution WITH the scores it acted on", () => {
    const machine = lifecycle();
    for (const next of ["provisioned", "plan-arm", "plan-gated"] as CampaignState[]) machine.transition(next);
    machine.recordGateResolution(resolution({ scores: { "P-1": 1, "P-5": 3, "P-3": "ungraded" } }));
    expect(machine.resolution()?.scores).toEqual({ "P-1": 1, "P-5": 3, "P-3": "ungraded" });
    expect(machine.resolution()?.resolvedBy).toBe("declared-policy");
  });
});

describe("CF-SM-ACC-I illegal transitions", () => {
  it("negative control: build-arm entry without a gate resolution", () => {
    const machine = lifecycle();
    for (const next of ["provisioned", "plan-arm", "plan-gated"] as CampaignState[]) machine.transition(next);
    expect(refusal(() => machine.transition("build-arm")).code).toBe("build-arm-without-gate");
    expect(machine.state()).toBe("plan-gated");
  });

  it("negative control: build-arm entry after the gate resolved to stop", () => {
    const machine = lifecycle();
    for (const next of ["provisioned", "plan-arm", "plan-gated"] as CampaignState[]) machine.transition(next);
    machine.recordGateResolution(resolution({ decision: "stop" }));
    expect(refusal(() => machine.transition("build-arm")).code).toBe("build-arm-without-gate");
  });

  it("negative control: build-arm spend recorded outside the build arm", () => {
    const machine = lifecycle();
    expect(refusal(() => machine.noteBuildArmSpend()).code).toBe("build-arm-without-gate");
    expect(machine.buildArmSpendCount()).toBe(0);
  });

  it("negative control: skipping the plan arm entirely", () => {
    const machine = lifecycle();
    machine.transition("provisioned");
    expect(refusal(() => machine.transition("build-arm")).code).toBe("illegal-transition");
  });

  it("negative control: a reported campaign cannot transition again", () => {
    const machine = lifecycle();
    for (const next of ["provisioned", "plan-arm", "plan-gated"] as CampaignState[]) machine.transition(next);
    machine.transition("stopped-at-gate");
    machine.transition("reported");
    expect(refusal(() => machine.transition("incomplete")).code).toBe("already-terminal");
  });
});

describe("CF-SM-ACC-R/C replay, resume and crash points", () => {
  it("negative control: a gate resolution written after the first build turn", () => {
    const machine = lifecycle();
    for (const next of ["provisioned", "plan-arm", "plan-gated"] as CampaignState[]) machine.transition(next);
    machine.recordGateResolution(resolution());
    machine.transition("build-arm");
    machine.noteBuildArmSpend();
    expect(refusal(() => machine.recordGateResolution(resolution({ reason: "backfilled" }))).code).toBe(
      "gate-resolution-after-build-spend",
    );
  });

  it("negative control: resume against a drifted config hash refuses and names the drift", () => {
    const machine = lifecycle();
    machine.transition("provisioned");
    const error = refusal(() => machine.resumeAt("0".repeat(64)));
    expect(error.code).toBe("config-hash-drift");
    expect(error.message).toContain(CONFIG_HASH.slice(0, 12));
  });

  it("resume with an unchanged hash returns the predecessor state unchanged", () => {
    const machine = lifecycle();
    for (const next of ["provisioned", "plan-arm"] as CampaignState[]) machine.transition(next);
    expect(machine.resumeAt(CONFIG_HASH)).toBe("plan-arm");
    expect(machine.history).toEqual(["authorized", "provisioned", "plan-arm"]);
  });

  it("every reachable state can reach `incomplete` rather than being dropped", () => {
    for (const stopAt of ["authorized", "provisioned", "plan-arm", "plan-gated"] as CampaignState[]) {
      const machine = lifecycle();
      for (const next of ["provisioned", "plan-arm", "plan-gated"] as CampaignState[]) {
        if (machine.state() === stopAt) break;
        machine.transition(next);
      }
      machine.transition("incomplete");
      machine.transition("reported");
      expect(machine.history).toContain("incomplete");
    }
  });

  it("the resolution handed back is a copy — a caller cannot mutate the record after the fact", () => {
    const machine = lifecycle();
    for (const next of ["provisioned", "plan-arm", "plan-gated"] as CampaignState[]) machine.transition(next);
    machine.recordGateResolution(resolution());
    const copy = machine.resolution();
    if (copy !== undefined) copy.decision = "stop";
    expect(machine.resolution()?.decision).toBe("continue");
  });
});
