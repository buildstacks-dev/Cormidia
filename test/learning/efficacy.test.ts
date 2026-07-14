import { describe, expect, it } from "vitest";
import { declareEfficacy, evaluateEfficacy, rollbackLineage, stickyArm, type EfficacyObservation } from "../../scripts/eval/learning-efficacy.js";

const declaration = declareEfficacy({ declared_at: "2026-07-12T00:00:00.000Z", hypothesis: "A scoped retry lesson reduces environment recovery recurrence", metric: "successful_clean_setup", baseline_fingerprint: `sha256:${"a".repeat(64)}`, treatment_fingerprint: `sha256:${"b".repeat(64)}`, hidden_guardrails_sha256: `sha256:${"c".repeat(64)}` });
const controls: EfficacyObservation[] = [1, 2, 3].map((n) => ({ arm: "control", weakness_score: 0, guardrail_score: 1, actor_visible_bytes: `task-${n}` }));

describe("LEARNING-CLOSURE-001 paired efficacy and rollback harness", () => {
  it("positive genuine intervention improves the held-in weakness and preserves hidden guardrails", () => {
    const treatment: EfficacyObservation[] = [1, 2, 3].map((n) => ({ arm: "treatment", weakness_score: 1, guardrail_score: 1, actor_visible_bytes: `task-${n}` }));
    expect(evaluateEfficacy(declaration, [...controls, ...treatment], "2026-07-12T01:00:00.000Z")).toEqual({ verdict: "improved", weakness_delta: 1, guardrail_delta: 0, promotable: true, reasons: ["held_in_weakness_improved", "guardrails_preserved"] });
  });
  it("near-miss sham is inconclusive and episode assignment remains sticky", () => {
    const sham = controls.map((row) => ({ ...row, arm: "treatment" as const }));
    expect(evaluateEfficacy(declaration, [...controls, ...sham], "2026-07-12T01:00:00.000Z").verdict).toBe("inconclusive");
    expect(stickyArm("episode-7", declaration.experiment_id)).toBe(stickyArm("episode-7", declaration.experiment_id));
  });
  it("honest harmful intervention is regressed, cannot promote, and rollback restores stable lineage", () => {
    const harmful: EfficacyObservation[] = controls.map((row) => ({ ...row, arm: "treatment", weakness_score: 1, guardrail_score: 0 }));
    expect(evaluateEfficacy(declaration, [...controls, ...harmful], "2026-07-12T01:00:00.000Z")).toMatchObject({ verdict: "regressed", promotable: false, guardrail_delta: -1 });
    expect(rollbackLineage({ active: "treatment-v2", stable: "stable-v1", reason: "hidden guardrail regressed" })).toMatchObject({ active: "stable-v1", previous: "treatment-v2", rolled_back: true });
  });
  it("honest failure rejects result-before-declaration and treatment identity leakage", () => {
    expect(() => evaluateEfficacy(declaration, [...controls, ...controls.map((row) => ({ ...row, arm: "treatment" as const }))], "2026-07-11T23:59:00.000Z")).toThrow("not_declared_before_results");
    const leaked = [...controls, { arm: "treatment" as const, weakness_score: 1, guardrail_score: 1, actor_visible_bytes: declaration.treatment_fingerprint }, { arm: "treatment" as const, weakness_score: 1, guardrail_score: 1, actor_visible_bytes: "x" }, { arm: "treatment" as const, weakness_score: 1, guardrail_score: 1, actor_visible_bytes: "y" }];
    expect(() => evaluateEfficacy(declaration, leaked, "2026-07-12T01:00:00.000Z")).toThrow("actor_blindness_violated");
  });
});
