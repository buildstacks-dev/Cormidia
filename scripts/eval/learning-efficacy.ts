import { createHash } from "node:crypto";

export interface EfficacyDeclaration {
  schema_version: 1;
  experiment_id: string;
  declared_at: string;
  hypothesis: string;
  metric: string;
  baseline_fingerprint: string;
  treatment_fingerprint: string;
  hidden_guardrails_sha256: string;
}
export interface EfficacyObservation { arm: "control" | "treatment"; weakness_score: number; guardrail_score: number; actor_visible_bytes: string }
export interface EfficacyVerdict { verdict: "improved" | "inconclusive" | "regressed"; weakness_delta: number; guardrail_delta: number; promotable: boolean; reasons: string[] }

export function declareEfficacy(input: Omit<EfficacyDeclaration, "schema_version" | "experiment_id">): EfficacyDeclaration {
  if (!input.hypothesis.trim() || !input.metric.trim()) throw new Error("efficacy_declaration_incomplete");
  return { schema_version: 1, experiment_id: `exp_${digest(JSON.stringify(input)).slice(0, 20)}`, ...input };
}
export function evaluateEfficacy(declaration: EfficacyDeclaration, observations: EfficacyObservation[], resultAt: string): EfficacyVerdict {
  if (Date.parse(declaration.declared_at) >= Date.parse(resultAt)) throw new Error("experiment_not_declared_before_results");
  if (observations.some((row) => row.actor_visible_bytes.includes(declaration.treatment_fingerprint) || row.actor_visible_bytes.includes(declaration.hidden_guardrails_sha256))) throw new Error("actor_blindness_violated");
  const control = observations.filter((row) => row.arm === "control"); const treatment = observations.filter((row) => row.arm === "treatment");
  if (control.length === 0 || treatment.length === 0 || control.length !== treatment.length) throw new Error("paired_observations_incomplete");
  const weaknessDelta = average(treatment.map((row) => row.weakness_score)) - average(control.map((row) => row.weakness_score));
  const guardrailDelta = average(treatment.map((row) => row.guardrail_score)) - average(control.map((row) => row.guardrail_score));
  if (guardrailDelta < 0) return { verdict: "regressed", weakness_delta: weaknessDelta, guardrail_delta: guardrailDelta, promotable: false, reasons: ["hidden_guardrail_regressed"] };
  if (weaknessDelta > 0) return { verdict: "improved", weakness_delta: weaknessDelta, guardrail_delta: guardrailDelta, promotable: true, reasons: ["held_in_weakness_improved", "guardrails_preserved"] };
  return { verdict: "inconclusive", weakness_delta: weaknessDelta, guardrail_delta: guardrailDelta, promotable: false, reasons: ["no_measured_improvement"] };
}
export function stickyArm(episodeId: string, experimentId: string): "control" | "treatment" { return (Number.parseInt(digest(`${experimentId}\0${episodeId}`).slice(0, 2), 16) & 1) === 0 ? "control" : "treatment"; }
export function rollbackLineage(input: { active: string; stable: string; reason: string }): { active: string; previous: string; reason: string; rolled_back: true } { if (!input.reason.trim()) throw new Error("rollback_reason_required"); return { active: input.stable, previous: input.active, reason: input.reason, rolled_back: true }; }
function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
