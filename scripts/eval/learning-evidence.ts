import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalJson,
  hashFile,
  type AttemptResult,
  type CampaignManifest,
} from "./core.js";

export type LearningPairOutcome = "improved" | "inconclusive" | "regressed" | "invalid";

export interface LearningArmEvidence {
  repetition_id: string;
  attempt_id: string;
  result_sha256: string;
  provider_artifact_sha256: string;
  verifier_evidence_sha256: string;
  grader_evidence_sha256: string;
  independent_reviewer_artifact_sha256: string;
  independent_reviewer_verdict: "approve" | "reject";
  score: number;
  hidden_guardrails_passed: boolean;
  attempt_outcome: AttemptResult["outcome"];
}

export interface LearningPairEvidence {
  schema_version: 1;
  evidence_kind: "phase6-learning-pairs";
  campaign_id: string;
  campaign_sha256: string;
  candidate: CampaignManifest["candidate"];
  treatment: NonNullable<CampaignManifest["learning_treatment"]>;
  efficacy: NonNullable<CampaignManifest["learning_efficacy"]>;
  declared_pair_order: Array<"AB" | "BA">;
  decision_rule: "all_three_treatment_scores_strictly_exceed_paired_controls_and_all_hidden_guardrails_pass";
  pairs: Array<{
    pair_id: string;
    order: "AB" | "BA";
    control: LearningArmEvidence | null;
    treatment: LearningArmEvidence | null;
    delta: number | null;
  }>;
  complete_pairs: number;
  terminal_attempts: number;
  hidden_guardrails_passed: boolean;
  outcome: LearningPairOutcome;
  missing: string[];
}

export function writeLearningPairEvidence(input: {
  campaign: CampaignManifest;
  campaignSha256: string;
  campaignRoot: string;
  results: AttemptResult[];
}): { path: string; sha256: string; evidence: LearningPairEvidence } {
  const treatment = input.campaign.learning_treatment;
  const efficacy = input.campaign.learning_efficacy;
  const learningBlock = input.campaign.blocks?.find((block) => block.name === "learning");
  if (!treatment || !efficacy || !learningBlock?.paired_order) throw new Error("learning_pair_declaration_missing");
  const repetitions = learningBlock.cases.flatMap((item) => item.repetition_ids);
  const missing: string[] = [];
  const arms = new Map<string, LearningArmEvidence>();
  for (const repetitionId of repetitions) {
    const result = input.results.filter((item) => item.case_id === "learning/closure/v1" && item.repetition_id === repetitionId).at(-1);
    if (!result) { missing.push(`missing_attempt:${repetitionId}`); continue; }
    const resultPath = join(input.campaignRoot, "results", `${result.attempt_id}.json`);
    const verifierRef = result.evidence.find((ref) => ref.startsWith("artifact:artifact/verifier/") && ref.endsWith("/grader-evidence.json"));
    const graderRef = result.evidence.find((ref) => ref.startsWith("grader:"));
    if (!existsSync(resultPath) || !verifierRef || !graderRef) { missing.push(`missing_learning_evidence:${repetitionId}`); continue; }
    const verifierPath = join(input.campaignRoot, verifierRef.slice("artifact:".length));
    const graderPath = join(input.campaignRoot, graderRef.slice("grader:".length));
    if (!existsSync(verifierPath) || !existsSync(graderPath)) { missing.push(`missing_learning_verifier:${repetitionId}`); continue; }
    const verifier = JSON.parse(readFileSync(verifierPath, "utf8")) as Record<string, unknown>;
    const grader = JSON.parse(readFileSync(graderPath, "utf8")) as Record<string, unknown>;
    const learning = record(result.metrics.learning);
    const expectedArm = repetitionId.endsWith("-treatment") ? "treatment" : "control";
    const score = learning && finite(learning.effect_value);
    const artifactSha = learning?.artifact_sha256;
    const reviewerSha = learning?.independent_reviewer_artifact_sha256;
    const reviewerVerdict = learning?.independent_reviewer_verdict;
    const hiddenGuardrailsPassed = learning?.hidden_guardrails_passed === true && verifier.hidden_guardrails_passed === true;
    const graderOutcomeMatches = hiddenGuardrailsPassed
      ? grader.hidden_grader_passed === true && grader.result === "passed" && result.outcome === "passed"
      : grader.hidden_grader_passed === false && grader.result === "failed" && result.outcome === "product_miss";
    const verifierSha = `sha256:${hashFile(verifierPath)}`;
    if (learning?.arm !== expectedArm || score === null || !Number.isInteger(score) || score < efficacy.score_range[0] || score > efficacy.score_range[1] || !validScoreEvidence(learning, verifier, efficacy) || !["approve", "reject"].includes(String(reviewerVerdict)) || verifier.independent_reviewer_verdict !== reviewerVerdict || typeof artifactSha !== "string" || !/^sha256:[a-f0-9]{64}$/.test(artifactSha) || verifier.artifact_sha256 !== artifactSha || typeof reviewerSha !== "string" || !/^sha256:[a-f0-9]{64}$/.test(reviewerSha) || verifier.independent_reviewer_artifact_sha256 !== reviewerSha || grader.campaign_sha256 !== input.campaignSha256 || grader.case_id !== result.case_id || grader.repetition_id !== repetitionId || grader.attempt_id !== result.attempt_id || !graderOutcomeMatches || grader.verifier_evidence !== verifierRef || grader.verifier_evidence_sha256 !== verifierSha || !Array.isArray(grader.missing) || grader.missing.length !== 0) {
      missing.push(`invalid_learning_measurement:${repetitionId}`);
      continue;
    }
    if (expectedArm === "treatment" && (learning.treatment_sha256 !== treatment.content_sha256 || learning.treatment_applied !== true)) missing.push(`treatment_binding_mismatch:${repetitionId}`);
    if (expectedArm === "control" && (learning.treatment_sha256 !== null || learning.treatment_applied !== false)) missing.push(`control_treatment_leakage:${repetitionId}`);
    arms.set(repetitionId, {
      repetition_id: repetitionId,
      attempt_id: result.attempt_id,
      result_sha256: `sha256:${hashFile(resultPath)}`,
      provider_artifact_sha256: artifactSha,
      verifier_evidence_sha256: verifierSha,
      grader_evidence_sha256: `sha256:${hashFile(graderPath)}`,
      independent_reviewer_artifact_sha256: reviewerSha,
      independent_reviewer_verdict: reviewerVerdict as "approve" | "reject",
      score,
      hidden_guardrails_passed: hiddenGuardrailsPassed,
      attempt_outcome: result.outcome,
    });
  }
  const pairs = learningBlock.paired_order.map((order, index) => {
    const pairId = `pair-${index + 1}`;
    const control = arms.get(`${pairId}-control`) ?? null;
    const treatmentArm = arms.get(`${pairId}-treatment`) ?? null;
    return { pair_id: pairId, order, control, treatment: treatmentArm, delta: control && treatmentArm ? treatmentArm.score - control.score : null };
  });
  const completePairs = pairs.filter((pair) => pair.control && pair.treatment && pair.delta !== null).length;
  const allArms = pairs.flatMap((pair) => [pair.control, pair.treatment]).filter((arm): arm is LearningArmEvidence => arm !== null);
  const terminalAttempts = allArms.filter((arm) => !["not_run", "infra_invalid", "harness_error"].includes(arm.attempt_outcome)).length;
  const hiddenGuardrailsPassed = allArms.length === 6 && allArms.every((arm) => arm.hidden_guardrails_passed);
  const infrastructureInvalid = allArms.some((arm) => ["not_run", "infra_invalid", "harness_error"].includes(arm.attempt_outcome));
  const meritMiss = allArms.some((arm) => ["product_miss", "safety_stop", "budget_stop"].includes(arm.attempt_outcome)) || !hiddenGuardrailsPassed;
  const deltas = pairs.map((pair) => pair.delta).filter((delta): delta is number => delta !== null);
  const outcome: LearningPairOutcome = missing.length > 0 || completePairs !== 3 || infrastructureInvalid
    ? "invalid"
    : meritMiss || deltas.some((delta) => delta < 0)
      ? "regressed"
      : deltas.every((delta) => delta > 0)
        ? "improved"
        : "inconclusive";
  const evidence: LearningPairEvidence = {
    schema_version: 1,
    evidence_kind: "phase6-learning-pairs",
    campaign_id: input.campaign.campaign_id,
    campaign_sha256: input.campaignSha256,
    candidate: input.campaign.candidate,
    treatment,
    efficacy,
    declared_pair_order: [...learningBlock.paired_order],
    decision_rule: efficacy.improved_rule,
    pairs,
    complete_pairs: completePairs,
    terminal_attempts: terminalAttempts,
    hidden_guardrails_passed: hiddenGuardrailsPassed,
    outcome,
    missing: [...new Set(missing)].sort(),
  };
  const path = join(input.campaignRoot, "artifact", "learning-pairs.json");
  mkdirSync(join(input.campaignRoot, "artifact"), { recursive: true });
  const bytes = `${JSON.stringify(evidence, null, 2)}\n`;
  if (existsSync(path)) {
    if (canonicalJson(JSON.parse(readFileSync(path, "utf8"))) !== canonicalJson(evidence)) throw new Error("learning_pair_evidence_conflict");
  } else writeFileSync(path, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { path, sha256: `sha256:${hashFile(path)}`, evidence };
}

export function validateLearningPairEvidence(value: unknown, campaign: CampaignManifest, campaignSha256: string): string[] {
  const errors: string[] = [];
  const v = record(value);
  if (!v) return ["learning pair evidence must be an object"];
  if (v.schema_version !== 1 || v.evidence_kind !== "phase6-learning-pairs") errors.push("learning pair evidence schema mismatch");
  if (v.campaign_id !== campaign.campaign_id || v.campaign_sha256 !== campaignSha256) errors.push("learning pair evidence campaign mismatch");
  if (canonicalJson(v.candidate) !== canonicalJson(campaign.candidate)) errors.push("learning pair evidence candidate mismatch");
  if (canonicalJson(v.treatment) !== canonicalJson(campaign.learning_treatment)) errors.push("learning pair evidence treatment mismatch");
  if (canonicalJson(v.efficacy) !== canonicalJson(campaign.learning_efficacy)) errors.push("learning pair evidence efficacy declaration mismatch");
  if (canonicalJson(v.declared_pair_order) !== canonicalJson(["AB", "BA", "AB"])) errors.push("learning pair order mismatch");
  if (v.decision_rule !== campaign.learning_efficacy?.improved_rule) errors.push("learning pair decision rule mismatch");
  if (!Array.isArray(v.pairs) || v.pairs.length !== 3) errors.push("learning pair denominator must be three");
  if (v.complete_pairs !== 3 || v.terminal_attempts !== 6) errors.push("learning pair terminal denominator incomplete");
  if (v.hidden_guardrails_passed !== true) errors.push("learning pair hidden guardrails failed");
  if (v.outcome !== "improved") errors.push(`learning pair outcome ${String(v.outcome)}`);
  if (!Array.isArray(v.missing) || v.missing.length !== 0) errors.push("learning pair measurements missing");
  if (Array.isArray(v.pairs)) for (const [index, rawPair] of v.pairs.entries()) {
    const pair = record(rawPair);
    const expectedId = `pair-${index + 1}`;
    const expectedOrder = ["AB", "BA", "AB"][index];
    if (!pair || pair.pair_id !== expectedId || pair.order !== expectedOrder) { errors.push(`learning pair ${index + 1} identity mismatch`); continue; }
    const control = record(pair.control); const treatment = record(pair.treatment); const delta = finite(pair.delta);
    if (!control || !treatment || delta === null || delta <= 0 || delta !== finite(treatment?.score)! - finite(control?.score)!) errors.push(`learning pair ${index + 1} is not a positive measured pair`);
    for (const [armName, arm] of [["control", control], ["treatment", treatment]] as const) {
      if (!arm || arm.repetition_id !== `${expectedId}-${armName}` || typeof arm.attempt_id !== "string" || !digest(arm.result_sha256) || !digest(arm.provider_artifact_sha256) || !digest(arm.verifier_evidence_sha256) || !digest(arm.grader_evidence_sha256) || !digest(arm.independent_reviewer_artifact_sha256) || arm.independent_reviewer_verdict !== "approve" || !Number.isInteger(arm.score) || finite(arm.score) === null || (arm.score as number) < 0 || (arm.score as number) > 8 || arm.hidden_guardrails_passed !== true || arm.attempt_outcome !== "passed") errors.push(`learning pair ${index + 1} ${armName} evidence invalid`);
    }
  }
  return errors;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function finite(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function digest(value: unknown): boolean { return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value); }

function validScoreEvidence(learning: Record<string, unknown>, verifier: Record<string, unknown>, efficacy: NonNullable<CampaignManifest["learning_efficacy"]>): boolean {
  const components = record(verifier.score_components);
  const scale = record(verifier.score_scale);
  if (!components || !scale || canonicalJson(learning.score_components) !== canonicalJson(components) || canonicalJson(learning.score_scale) !== canonicalJson(scale)) return false;
  const values = efficacy.components.map((name) => components[name]);
  return Object.keys(components).sort().join(",") === [...efficacy.components].sort().join(",") &&
    values.every((value) => Number.isInteger(value) && (value as number) >= efficacy.component_range[0] && (value as number) <= efficacy.component_range[1]) &&
    values.reduce((sum, value) => sum + Number(value), 0) === verifier.artifact_score &&
    scale.minimum === efficacy.score_range[0] && scale.maximum === efficacy.score_range[1] &&
    scale.component_minimum === efficacy.component_range[0] && scale.component_maximum === efficacy.component_range[1] &&
    canonicalJson(scale.components) === canonicalJson(efficacy.components);
}
