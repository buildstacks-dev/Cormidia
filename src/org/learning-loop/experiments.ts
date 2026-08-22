// Kernel experiments (decision 0028) from Cormidia's eval fixtures: the host
// declares a frozen ExperimentDefinition over the kernel's durable episode
// records that its trusted fixtures replay, names the kernel's reference
// rules, and binds the configured replay executor; the kernel journals every
// attempt, attests the executor, and mints the verdict into the
// intervention's `validation` state. Metric definitions live here ONCE so the
// declaration and the runner's measurements are byte-equal by construction.

import { eligibilitySetDigest, referenceExperimentRules, sha256HexOfCanonicalJson } from "@cormidia/learning-loop";
import type { EvaluationResult, ExperimentDefinition, MetricDefinition } from "@cormidia/learning-loop";
import { listEvalFixtures, type EvalFixture } from "../learning/eval-fixture.js";
import type { SystemFingerprint } from "../learning/fingerprint.js";
import { EPISODE_SOURCE_ID } from "./evidence-source.js";
import {
  hostExperimentOf,
  readHostExperiment,
  writeHostExperiment,
  type HostExperimentRecord,
} from "./experiments-audit.js";
import { kernelFingerprint } from "./fingerprint.js";
import type { CormidiaLearningLoop } from "./loop.js";

/** The measurements the worktree replay grades (replay.ts `finish`):
 *  held-in pass and merge-equivalence as booleans, counts and cost as numbers. */
export const REPLAY_METRICS = {
  held_in_pass: { name: "held_in_pass", valueType: "boolean", unit: "pass", aggregation: "all" },
  merged: { name: "merged", valueType: "boolean", unit: "pass", aggregation: "all" },
  review_cycles: { name: "review_cycles", valueType: "number", unit: "count", aggregation: "mean" },
  gate_failures: { name: "gate_failures", valueType: "number", unit: "count", aggregation: "sum" },
  cost_usd: { name: "cost_usd", valueType: "number", unit: "usd", aggregation: "sum" },
} as const satisfies Record<string, MetricDefinition>;

export function replayMetricDefinition(name: string): MetricDefinition {
  const known = Object.values(REPLAY_METRICS).find((metric) => metric.name === name);
  return known ?? { name, valueType: "number", unit: "value", aggregation: "mean" };
}

export interface KernelGuardrailSpec {
  readonly metric: string;
  readonly rule: "must_pass" | "must_not_regress" | "maximum";
  readonly threshold?: number;
}

/** `metric=rule[:threshold]`; the forked spelling `must_not_decrease` maps to
 *  `must_not_regress` on a boolean metric, everything else needs a kernel rule. */
export function parseGuardrailSpec(text: string): KernelGuardrailSpec {
  const [metric, ruleText] = text.split("=");
  if (metric === undefined || ruleText === undefined || metric === "") {
    throw new Error(`learn experiment: --guardrail must be metric=rule[:threshold], got "${text}"`);
  }
  const [rule, thresholdText] = ruleText.split(":");
  const definition = replayMetricDefinition(metric);
  if (rule === "must_not_decrease" || rule === "must_not_regress") {
    if (definition.valueType !== "boolean") {
      throw new Error(`learn experiment: ${metric} is numeric — use ${metric}=maximum:<threshold>`);
    }
    return { metric, rule: "must_not_regress" };
  }
  if (rule === "must_pass") {
    if (definition.valueType !== "boolean") throw new Error(`learn experiment: ${metric} is numeric — use maximum`);
    return { metric, rule: "must_pass" };
  }
  if (rule === "maximum" || rule === "must_not_increase" || rule === "max_increase_pct") {
    const threshold = Number(thresholdText);
    if (thresholdText === undefined || !Number.isFinite(threshold)) {
      throw new Error(`learn experiment: ${metric}=${rule} needs an absolute threshold (${metric}=maximum:<n>)`);
    }
    if (definition.valueType !== "number") throw new Error(`learn experiment: ${metric} is boolean — use must_pass`);
    return { metric, rule: "maximum", threshold };
  }
  throw new Error(`learn experiment: unknown guardrail rule "${rule}" (must_pass | must_not_regress | maximum:<n>)`);
}

/** Trusted, replayable fixtures for an eval-set ref (`evals/<scope>/<set>`). */
export async function eligibleFixtures(orgHome: string, evalSetRef: string): Promise<EvalFixture[]> {
  const set = evalSetRef.startsWith("evals/") ? evalSetRef.slice("evals/".length) : evalSetRef;
  return (await listEvalFixtures(orgHome)).filter(
    (fixture) =>
      fixture.eval_set === set &&
      fixture.validated_by !== null &&
      fixture.input.brief !== null &&
      fixture.input.brief !== undefined &&
      fixture.seed.commit !== null,
  );
}

/** The kernel's durable episode record id for a fixture's episode (primary projection). */
export function durableEpisodeIdFor(episodeRef: string): string {
  return `${EPISODE_SOURCE_ID}/episode:${episodeRef}`;
}

export interface DeclareKernelExperimentInput {
  readonly learning: CormidiaLearningLoop;
  readonly experimentId: string;
  readonly artifactId: string;
  readonly candidateId: string;
  readonly interventionId: string;
  readonly app: string;
  readonly stage: readonly string[];
  readonly evalSet: string;
  readonly fixtures: readonly EvalFixture[];
  readonly hypothesis: string;
  readonly metric: string;
  readonly direction: "higher" | "lower";
  readonly minimumUsefulEffect: number;
  readonly guardrails: readonly KernelGuardrailSpec[];
  readonly repetitions: number;
  readonly control: SystemFingerprint;
  readonly treatment: SystemFingerprint;
  readonly controlFingerprintId?: string;
  readonly treatmentFingerprintId?: string;
  readonly costCeilingUsd?: number;
}

function aggregationFor(definition: MetricDefinition): string {
  const prefix = definition.valueType === "boolean" ? "all-" : "mean-";
  const aggregation = referenceExperimentRules().perEpisodeAggregations.find((name) => name.startsWith(prefix));
  if (aggregation === undefined) throw new Error(`learning-loop: no ${prefix} per-episode aggregation in the kernel`);
  return aggregation;
}

export async function declareKernelExperiment(
  input: DeclareKernelExperimentInput,
): Promise<{ readonly definition: ExperimentDefinition; readonly record: HostExperimentRecord }> {
  const { learning } = input;
  if (learning.replayExecutorDigest === undefined) {
    throw new Error("learning-loop: the loop was composed without a replay runner; no experiment can be declared");
  }
  if (input.fixtures.length === 0) throw new Error(`learning-loop: no trusted fixtures under ${input.evalSet}`);
  const rules = referenceExperimentRules();
  const eligibleEpisodeIds = [...new Set(input.fixtures.map((fixture) => durableEpisodeIdFor(fixture.episode_ref)))];
  const primary = replayMetricDefinition(input.metric);
  const firstFixture = input.fixtures[0];
  const definition = await learning.loop.declareExperiment({
    id: input.experimentId,
    hypothesis: input.hypothesis,
    interventionId: input.interventionId,
    eligibilityPolicyDigest: sha256HexOfCanonicalJson({
      evalSet: input.evalSet,
      app: input.app,
      stage: [...input.stage],
    }),
    eligibilitySetDigest: eligibilitySetDigest(eligibleEpisodeIds),
    eligibleEpisodeIds,
    baselineSnapshotDigest: sha256HexOfCanonicalJson({
      seeds: input.fixtures.map((fixture) => ({ fixture: fixture.fixture_id, commit: fixture.seed.commit })),
    }),
    controlFingerprintDigest: kernelFingerprint(input.control).digest,
    treatmentFingerprintDigest: kernelFingerprint(input.treatment).digest,
    primaryMetric: {
      definition: primary,
      direction: input.direction,
      minimumUsefulEffect: input.minimumUsefulEffect,
      perEpisodeAggregation: aggregationFor(primary),
      missingnessRuleDigest: rules.missingnessRule.digest,
    },
    guardrails: input.guardrails.map((guardrail) =>
      guardrail.rule === "maximum"
        ? { metric: replayMetricDefinition(guardrail.metric), rule: "maximum", threshold: guardrail.threshold ?? 0 }
        : { metric: replayMetricDefinition(guardrail.metric), rule: guardrail.rule },
    ),
    fixtureSetDigest: sha256HexOfCanonicalJson({
      fixtures: input.fixtures.map((fixture) => ({
        id: fixture.fixture_id,
        capsule: fixture.capsule_ref,
        episode: fixture.episode_ref,
        seed: fixture.seed.commit,
      })),
    }),
    graderDigest: sha256HexOfCanonicalJson({ graders: input.fixtures.map((fixture) => fixture.grader) }),
    decisionRuleDigest: rules.decisionRule.digest,
    pairCount: eligibleEpisodeIds.length,
    repetitionsPerPair: input.repetitions,
    ...(input.costCeilingUsd !== undefined ? { costCeiling: { amount: input.costCeilingUsd, currency: "USD" } } : {}),
    stoppingRuleDigest: rules.stoppingRule.digest,
    replayExecutorDigest: learning.replayExecutorDigest,
    sideEffectPolicyDigest: sha256HexOfCanonicalJson({ policy: firstFixture?.side_effect_policy ?? null }),
    assignmentAndBlindingDigest: sha256HexOfCanonicalJson({
      pairing: "alternating_control_treatment",
      blinding: "treatment_identity_hidden",
    }),
  });
  const record = hostExperimentOf({
    definition,
    artifactId: input.artifactId,
    candidateId: input.candidateId,
    app: input.app,
    evalSet: input.evalSet,
    ...(input.controlFingerprintId !== undefined ? { controlFingerprintId: input.controlFingerprintId } : {}),
    ...(input.treatmentFingerprintId !== undefined ? { treatmentFingerprintId: input.treatmentFingerprintId } : {}),
  });
  await writeHostExperiment(learning.stateDir, record);
  return { definition, record };
}

export async function runKernelExperiment(
  learning: CormidiaLearningLoop,
  experimentId: string,
): Promise<{ readonly evaluation: EvaluationResult; readonly record: HostExperimentRecord }> {
  const record = await readHostExperiment(learning.stateDir, experimentId);
  if (record === undefined) throw new Error(`learning-loop: no kernel experiment ${experimentId} in the host audit`);
  const evaluation = await learning.loop.runExperiment({ experimentId });
  const next: HostExperimentRecord = {
    ...record,
    evaluation: {
      id: evaluation.id,
      verdict: evaluation.verdict,
      evaluated_at: evaluation.evaluatedAt,
      classifications: evaluation.classifications,
      analysis: evaluation.analysis,
    },
  };
  await writeHostExperiment(learning.stateDir, next);
  return { evaluation, record: next };
}
