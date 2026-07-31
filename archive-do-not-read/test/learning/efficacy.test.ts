import { describe, expect, it } from "vitest";
import {
  evaluateEfficacy,
  stickyEfficacyArm,
  type EfficacyObservation,
} from "../../src/org/learning/efficacy.js";
import { validateExperimentRecord } from "../../src/org/learning/experiment.js";
import { makeExperiment } from "./helpers.js";

const experiment = validateExperimentRecord(makeExperiment({
  experiment_id: "exp_closed_loop_01",
  primary_metric: {
    name: "held_in_pass",
    expected_direction: "increase",
    min_useful_improvement_pct: 0,
  },
  efficacy_protocol: {
    ...(makeExperiment()["efficacy_protocol"] as object),
    declared_at: "2026-07-12T00:00:00.000Z",
    baseline: { metric: "held_in_pass", value: 0, source_ref: "fixture:weakness-v1" },
  },
}));

function observations(
  treatment: { weakness: number | null; guardrail: number | null },
): EfficacyObservation[] {
  return [1, 2, 3].flatMap((pair): EfficacyObservation[] => [
    {
      pair,
      arm: "control",
      observed_at: `2026-07-12T01:0${pair}:00.000Z`,
      weakness_score: 0,
      guardrail_score: 1,
      fingerprint_ref: experiment.control.fingerprint_ref,
      actor_visible_bytes: `task-${pair}`,
    },
    {
      pair,
      arm: "treatment",
      observed_at: `2026-07-12T01:0${pair}:30.000Z`,
      weakness_score: treatment.weakness,
      guardrail_score: treatment.guardrail,
      fingerprint_ref: experiment.treatment.fingerprint_ref,
      actor_visible_bytes: `task-${pair}`,
    },
  ]);
}

describe("LEARNING-CLOSURE-001 production efficacy and rollback recommendation", () => {
  it("a genuine intervention improves the held-in weakness without regressing hidden guardrails", () => {
    expect(evaluateEfficacy(experiment, observations({ weakness: 1, guardrail: 1 }), "2026-07-12T02:00:00.000Z"))
      .toMatchObject({ verdict: "improved", weakness_delta: 1, guardrail_delta: 0, promotable: true, recommendation: "retain" });
  });

  it("a sham is inconclusive and episode assignment is sticky across every turn", () => {
    expect(evaluateEfficacy(experiment, observations({ weakness: 0, guardrail: 1 }), "2026-07-12T02:00:00.000Z"))
      .toMatchObject({ verdict: "inconclusive", promotable: false, recommendation: "revise" });
    const first = stickyEfficacyArm("episode-7", experiment.experiment_id);
    for (let turn = 0; turn < 10; turn++) {
      expect(stickyEfficacyArm("episode-7", experiment.experiment_id)).toBe(first);
    }
  });

  it("a harmful intervention regresses, cannot promote, and recommends rollback when active", () => {
    expect(evaluateEfficacy(
      experiment,
      observations({ weakness: 1, guardrail: 0 }),
      "2026-07-12T02:00:00.000Z",
      { activated: true },
    )).toMatchObject({ verdict: "regressed", promotable: false, guardrail_delta: -1, recommendation: "roll_back" });
  });

  it("fails closed for result-before-declaration, identity leakage, drift, and missing measurements", () => {
    expect(() => evaluateEfficacy(experiment, observations({ weakness: 0, guardrail: 1 }), "2026-07-11T23:59:00.000Z"))
      .toThrow("experiment_not_declared_before_results");
    const earlyObservation = observations({ weakness: 1, guardrail: 1 });
    earlyObservation[0]!.observed_at = "2026-07-11T23:59:00.000Z";
    expect(() => evaluateEfficacy(experiment, earlyObservation, "2026-07-12T02:00:00.000Z"))
      .toThrow("observation_outside_declared_result_window");
    const leaked = observations({ weakness: 1, guardrail: 1 });
    leaked[1]!.actor_visible_bytes = experiment.treatment.fingerprint_ref;
    expect(() => evaluateEfficacy(experiment, leaked, "2026-07-12T02:00:00.000Z"))
      .toThrow("actor_blindness_violated");
    const drifted = observations({ weakness: 1, guardrail: 1 });
    drifted[1]!.fingerprint_ref = "sys_drifted";
    expect(() => evaluateEfficacy(experiment, drifted, "2026-07-12T02:00:00.000Z"))
      .toThrow("system_fingerprint_drift");
    expect(evaluateEfficacy(experiment, observations({ weakness: null, guardrail: 1 }), "2026-07-12T02:00:00.000Z"))
      .toMatchObject({ verdict: "missing", promotable: false, recommendation: "revise" });
  });
});
// Phase 4 production efficacy contracts: H-EVAL-01, H-EVAL-02.
