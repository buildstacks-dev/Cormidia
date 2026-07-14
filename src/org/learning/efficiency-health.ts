// Truthful Phase 4 learning-efficiency health projection.
// Read-only unless the caller explicitly asks to persist the deterministic
// projection (the CLI exposes that only through `learn report --refresh`).

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import type { CaptureProjectionResult } from "./capture.js";
import { listCandidateArtifacts } from "./candidate-store.js";
import type { CandidateArtifact } from "./candidate.js";
import { listCanaryAssignments, type CanaryAssignmentRecord } from "./canary.js";
import type { LearningRoot } from "./concepts.js";
import {
  clusterEfficiencyEvidence,
  isEfficiencyEvidenceEvent,
  type CandidateDisposition,
  type CandidateDispositionKind,
} from "./efficiency-evidence.js";
import { recommendationForEval, type EfficacyRecommendation } from "./efficacy.js";
import { listEvalResults, type EvalResult } from "./eval-result.js";
import { readEpisodeRecords } from "./episode.js";
import { readLearningEvents } from "./events.js";
import { listExperimentRecords, type ExperimentRecord } from "./experiment.js";
import { interventionChainGaps, listInterventionRecords, type InterventionRecord } from "./intervention.js";
import type { LearningPolicy } from "./policy.js";
import { readRejections } from "./rejections.js";
import { listReviewerVerdicts } from "./review.js";
import { listM6RunRecords } from "./distillation.js";

export type HealthStatus = "healthy" | "degraded" | "invalid_measurement";

export interface LearningEfficiencyHealth {
  schema_version: 1;
  projection_version: "learning-efficiency-health/v1";
  capture: {
    status: HealthStatus;
    eligible_finalized_runs: number | null;
    projected_exactly_once: number;
    duplicate_projections: number;
    blocked_runs: CaptureProjectionResult["blockedRuns"];
    stale_receipts: number;
    repairs: number;
    reset_abandoned_episodes: string[];
    ineligible_runs: CaptureProjectionResult["ineligibleRuns"];
  };
  governance: {
    status: HealthStatus;
    actionable_clusters: number;
    non_actionable_clusters: number;
    candidate_dispositions: Record<CandidateDispositionKind, number>;
    dispositions: CandidateDisposition[];
    pending_independent_review: string[];
    overdue_independent_review: string[];
    lineage_gaps: string[];
    activation_state: Record<string, number>;
    suppression_and_cap_reasons: Record<string, number>;
  };
  efficacy: {
    status: HealthStatus;
    declared_experiments: number;
    valid_control_treatment_comparisons: number;
    outcomes: Record<"improved" | "inconclusive" | "regressed" | "invalid" | "missing", number>;
    recommendations: Array<{
      experiment_ref: string;
      eval_ref: string | null;
      recommendation: EfficacyRecommendation;
      evidence_refs: string[];
    }>;
    guardrail_failures: string[];
    comparable_post_activation_coverage: number;
    invalid_reasons: string[];
  };
}

export interface LearningEfficiencyHealthOptions {
  orgHome: string;
  stateHome: string;
  capture: CaptureProjectionResult;
  policy: LearningPolicy;
  roots: LearningRoot[];
  /** Writes only the rebuildable projection; never governance/protected state. */
  persist?: boolean;
}

export function learningEfficiencyHealthPath(stateHome: string): string {
  return join(stateHome, "learning", "metrics", "efficiency-health.json");
}

export async function projectLearningEfficiencyHealth(
  options: LearningEfficiencyHealthOptions,
): Promise<LearningEfficiencyHealth> {
  const [events, episodes, experiments, results, interventions, reviews, rejections, m6, candidates, assignments] =
    await Promise.all([
      readLearningEvents(options.stateHome),
      readEpisodeRecords(options.stateHome),
      listExperimentRecords(options.orgHome),
      listEvalResults(options.orgHome),
      listInterventionRecords(options.orgHome),
      listReviewerVerdicts(options.orgHome),
      readRejections(options.orgHome),
      listM6RunRecords(options.stateHome),
      readCandidates(options.roots),
      listCanaryAssignments(options.stateHome),
    ]);
  const clustered = clusterEfficiencyEvidence(
    events.filter(isEfficiencyEvidenceEvent),
    options.policy.distiller.min_cluster_events,
  );
  const reviewed = new Map(reviews.map((review) => [review.candidate_id, review]));
  const rejected = new Set(rejections.map((entry) => entry.candidate_id));
  const byCluster = new Map<string, CandidateArtifact>();
  for (const cluster of clustered.clusters) {
    const candidate = candidates.find((item) =>
      item.draft?.["cluster_fingerprint"] === cluster.fingerprint ||
      cluster.event_ids.some((id) => item.event_ids.includes(id)),
    );
    if (candidate !== undefined) byCluster.set(cluster.fingerprint, candidate);
  }

  const dispositions = clustered.dispositions.map((item): CandidateDisposition => {
    if (item.cluster_ref === null || item.disposition !== "actionable") return item;
    const candidate = byCluster.get(item.cluster_ref);
    const capReason = latestCapReason(m6, item.app);
    if (candidate === undefined && capReason !== null) {
      return {
        ...item,
        disposition: capDisposition(capReason),
        reason_code: capReason,
      };
    }
    if (candidate === undefined) return item;
    if (rejected.has(candidate.candidate_id)) {
      return { ...item, disposition: "rejected", reason_code: "independent_review_rejected", candidate_ref: candidate.candidate_id };
    }
    if (!reviewed.has(candidate.candidate_id)) {
      return { ...item, disposition: "awaiting_review", reason_code: "independent_review_pending", candidate_ref: candidate.candidate_id };
    }
    return { ...item, disposition: "deduplicated", reason_code: "governed_candidate_exists", candidate_ref: candidate.candidate_id };
  });

  const pending = candidates.filter((candidate) => !reviewed.has(candidate.candidate_id));
  const pendingIds = pending.map((candidate) => candidate.candidate_id).sort();
  // Candidate records intentionally carry no wall clock. Pending is overdue
  // only when an M6 review run explicitly records the SLA cap; absence is not
  // guessed from filesystem metadata in this deterministic projection.
  const overdue = m6
    .filter((run) => run.kind === "learning_review" && run.reason === "reviewer_sla_overdue")
    .flatMap((run) => run.candidate_ids ?? [])
    .filter((id) => pendingIds.includes(id))
    .sort();
  const lineageGaps = lineageGapsFor({ candidates, reviews, experiments, results, interventions, clustered });
  const dispositionsCount = dispositionCounts(dispositions);
  const activationState = count(interventions.map((item) => item.status));
  const capReasons = count([
    ...rejections.map(() => "suppressed_or_rejected"),
    ...m6.map((run) => run.reason).filter((reason): reason is string => reason !== null),
  ]);

  const resultById = new Map(results.map((result) => [result.eval_id, result]));
  const interventionByExperiment = new Map(
    interventions
      .filter((item) => item.experiment_ref !== null)
      .map((item) => [item.experiment_ref!, item]),
  );
  const outcomeCounts = { improved: 0, inconclusive: 0, regressed: 0, invalid: 0, missing: 0 };
  let validComparisons = 0;
  let comparablePostActivation = 0;
  const guardrailFailures: string[] = [];
  const invalidReasons: string[] = [];
  let postActivationConcern = false;
  const recommendations: LearningEfficiencyHealth["efficacy"]["recommendations"] = [];
  for (const experiment of experiments) {
    const result = experiment.result === null ? undefined : resultById.get(experiment.result);
    const intervention = interventionByExperiment.get(experiment.experiment_id);
    if (experiment.efficacy_protocol === null) invalidReasons.push(`${experiment.experiment_id}:missing_efficacy_protocol`);
    if (result === undefined) {
      outcomeCounts.missing += 1;
      recommendations.push({
        experiment_ref: experiment.experiment_id,
        eval_ref: null,
        recommendation: "revise",
        evidence_refs: [],
      });
      continue;
    }
    const validity = resultValidity(result, experiment.efficacy_protocol !== null);
    if (validity === "invalid") {
      outcomeCounts.invalid += 1;
      invalidReasons.push(`${result.eval_id}:invalid_measurement`);
    } else if (validity === "missing") {
      outcomeCounts.missing += 1;
      invalidReasons.push(`${result.eval_id}:missing_measurement`);
    } else {
      validComparisons += result.trials.length;
      outcomeCounts[result.verdict === "not_evaluatable" ? "missing" : result.verdict] += 1;
    }
    for (const guardrail of result.guardrails.filter((item) => !item.pass)) {
      guardrailFailures.push(`${result.eval_id}:${guardrail.metric}`);
    }
    const post =
      intervention?.activation !== null && intervention?.activation !== undefined
        ? postActivationComparison(experiment, intervention, episodes, assignments)
        : null;
    if (post !== null) {
      comparablePostActivation += post.comparisons;
      postActivationConcern ||= post.recommendation !== "retain";
      invalidReasons.push(...post.invalid_reasons.map((reason) => `${experiment.experiment_id}:${reason}`));
      guardrailFailures.push(...post.guardrail_failures.map((metric) => `${experiment.experiment_id}:post_activation:${metric}`));
    }
    recommendations.push({
      experiment_ref: experiment.experiment_id,
      eval_ref: result.eval_id,
      recommendation:
        post === null
          ? recommendationForEval(result, false)
          : post.recommendation,
      evidence_refs: [
        ...result.capsule_refs.map((ref) => `learning:capsule:${ref}`),
        `learning:eval:${result.eval_id}`,
      ].sort(),
    });
  }

  const captureEligible = options.capture.eligibleFinalizedRuns;
  const captureStatus: HealthStatus =
    captureEligible === 0
      ? "invalid_measurement"
      : options.capture.blockedRuns.length === 0 &&
          options.capture.projectedExactlyOnce === captureEligible &&
          options.capture.duplicateProjections === 0
        ? "healthy"
        : "degraded";
  const governanceStatus: HealthStatus =
    lineageGaps.length > 0 || overdue.length > 0 ? "degraded" : "healthy";
  const efficacyStatus: HealthStatus =
    experiments.length === 0 || validComparisons === 0
      ? "invalid_measurement"
      : invalidReasons.length > 0 || guardrailFailures.length > 0 || comparablePostActivation === 0 || postActivationConcern
        ? "degraded"
        : "healthy";

  const health: LearningEfficiencyHealth = {
    schema_version: 1,
    projection_version: "learning-efficiency-health/v1",
    capture: {
      status: captureStatus,
      eligible_finalized_runs: captureEligible === 0 ? null : captureEligible,
      projected_exactly_once: options.capture.projectedExactlyOnce,
      duplicate_projections: options.capture.duplicateProjections,
      blocked_runs: [...options.capture.blockedRuns].sort(byRun),
      stale_receipts: options.capture.receiptsNeedingUpgrade,
      repairs: options.capture.runsRepaired,
      reset_abandoned_episodes: episodes
        .filter((episode) => episode.outcome?.terminal_reason === "reset_abandoned")
        .map((episode) => episode.episode_id)
        .sort(),
      ineligible_runs: [...options.capture.ineligibleRuns].sort(byRun),
    },
    governance: {
      status: governanceStatus,
      actionable_clusters: dispositions.filter((item) => item.disposition === "actionable").length,
      non_actionable_clusters: dispositions.filter((item) => item.disposition !== "actionable").length,
      candidate_dispositions: dispositionsCount,
      dispositions: dispositions.sort((a, b) => a.disposition_id.localeCompare(b.disposition_id)),
      pending_independent_review: pendingIds,
      overdue_independent_review: overdue,
      lineage_gaps: lineageGaps,
      activation_state: activationState,
      suppression_and_cap_reasons: capReasons,
    },
    efficacy: {
      status: efficacyStatus,
      declared_experiments: experiments.length,
      valid_control_treatment_comparisons: validComparisons,
      outcomes: outcomeCounts,
      recommendations: recommendations.sort((a, b) => a.experiment_ref.localeCompare(b.experiment_ref)),
      guardrail_failures: [...new Set(guardrailFailures)].sort(),
      comparable_post_activation_coverage: comparablePostActivation,
      invalid_reasons: [...new Set(invalidReasons)].sort(),
    },
  };
  if (options.persist === true) {
    const path = learningEfficiencyHealthPath(options.stateHome);
    await mkdir(dirname(path), { recursive: true });
    const bytes = `${JSON.stringify(health, null, 2)}\n`;
    if (!existsSync(path) || (await readFile(path, "utf8")) !== bytes) await writeFileAtomic(path, bytes);
  }
  return health;
}

function postActivationComparison(
  experiment: ExperimentRecord,
  intervention: InterventionRecord,
  episodes: Awaited<ReturnType<typeof readEpisodeRecords>>,
  assignments: CanaryAssignmentRecord[],
): {
  comparisons: number;
  recommendation: EfficacyRecommendation;
  guardrail_failures: string[];
  invalid_reasons: string[];
} {
  const version = intervention.publish?.ref;
  const activatedAt = Date.parse(intervention.activation!.activated_at);
  if (version === undefined || !Number.isFinite(activatedAt)) {
    return { comparisons: 0, recommendation: "revise", guardrail_failures: [], invalid_reasons: ["invalid_activation_lineage"] };
  }
  const byEpisode = new Map(episodes.map((episode) => [episode.episode_id, episode]));
  const arms = { control: [] as NonNullable<(typeof episodes)[number]["outcome"]>[], treatment: [] as NonNullable<(typeof episodes)[number]["outcome"]>[] };
  const invalidReasons: string[] = [];
  for (const assignment of assignments) {
    const root = Object.values(assignment.roots).find((entry) => entry?.version === version);
    if (root === undefined) continue;
    const episode = byEpisode.get(assignment.episode_id);
    if (episode?.outcome === undefined || Date.parse(episode.closed ?? "") < activatedAt) continue;
    if (episode.bundle_lineage === "mixed") {
      invalidReasons.push(`mixed_lineage:${episode.episode_id}`);
      continue;
    }
    arms[root.lineage === "canary" ? "treatment" : "control"].push(episode.outcome);
  }
  const comparisons = Math.min(arms.control.length, arms.treatment.length);
  if (comparisons === 0) {
    return { comparisons: 0, recommendation: "revise", guardrail_failures: [], invalid_reasons: [...invalidReasons, "missing_comparable_post_activation_arms"].sort() };
  }
  const primaryControl = metricMean(arms.control, experiment.primary_metric.name);
  const primaryTreatment = metricMean(arms.treatment, experiment.primary_metric.name);
  if (primaryControl === null || primaryTreatment === null) {
    return { comparisons, recommendation: "revise", guardrail_failures: [], invalid_reasons: [...invalidReasons, `missing_primary_metric:${experiment.primary_metric.name}`].sort() };
  }
  const guardrailFailures = experiment.guardrails
    .filter((guardrail) => {
      const control = metricMean(arms.control, guardrail.metric);
      const treatment = metricMean(arms.treatment, guardrail.metric);
      return control === null || treatment === null || guardrailRegressed(guardrail, control, treatment);
    })
    .map((guardrail) => guardrail.metric)
    .sort();
  if (guardrailFailures.length > 0) {
    return { comparisons, recommendation: "roll_back", guardrail_failures: guardrailFailures, invalid_reasons: invalidReasons.sort() };
  }
  const delta = experiment.primary_metric.expected_direction === "increase"
    ? primaryTreatment - primaryControl
    : primaryControl - primaryTreatment;
  return {
    comparisons,
    recommendation: delta > 0 ? "retain" : delta < 0 ? "roll_back" : "revise",
    guardrail_failures: [],
    invalid_reasons: invalidReasons.sort(),
  };
}

function metricMean(
  outcomes: Array<NonNullable<Awaited<ReturnType<typeof readEpisodeRecords>>[number]["outcome"]>>,
  metric: string,
): number | null {
  const values = outcomes.map((outcome) => episodeMetric(outcome, metric));
  if (values.some((value) => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value as number), 0) / values.length;
}

function episodeMetric(
  outcome: NonNullable<Awaited<ReturnType<typeof readEpisodeRecords>>[number]["outcome"]>,
  metric: string,
): number | null {
  switch (metric) {
    case "held_in_pass":
    case "completed": return outcome.completed ? 1 : 0;
    case "merged":
    case "merge_success_rate": return outcome.merged === undefined ? null : outcome.merged ? 1 : 0;
    case "gate_pass_rate": return outcome.gate_failures === 0 ? 1 : 0;
    case "review_cycles":
    case "average_review_cycles": return outcome.review_cycles;
    case "gate_failures": return outcome.gate_failures;
    case "cost_usd":
    case "average_cost_usd": return outcome.cost_usd;
    case "human_interventions": return outcome.human_interventions;
    default: return null;
  }
}

function guardrailRegressed(
  guardrail: ExperimentRecord["guardrails"][number],
  control: number,
  treatment: number,
): boolean {
  switch (guardrail.rule) {
    case "must_not_decrease": return treatment < control;
    case "must_not_increase": return treatment > control;
    case "max_increase_pct": return control <= 0 ? treatment > control : ((treatment - control) / control) * 100 > guardrail.pct!;
    case "max_decrease_pct": return control <= 0 ? treatment < control : ((control - treatment) / control) * 100 > guardrail.pct!;
  }
}

async function readCandidates(roots: LearningRoot[]): Promise<CandidateArtifact[]> {
  const byId = new Map<string, CandidateArtifact>();
  for (const root of roots) {
    for (const candidate of await listCandidateArtifacts(root)) byId.set(candidate.candidate_id, candidate);
  }
  return [...byId.values()].sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));
}

function lineageGapsFor(input: {
  candidates: CandidateArtifact[];
  reviews: Awaited<ReturnType<typeof listReviewerVerdicts>>;
  experiments: Awaited<ReturnType<typeof listExperimentRecords>>;
  results: EvalResult[];
  interventions: Awaited<ReturnType<typeof listInterventionRecords>>;
  clustered: ReturnType<typeof clusterEfficiencyEvidence>;
}): string[] {
  const gaps: string[] = [];
  const candidateIds = new Set(input.candidates.map((item) => item.candidate_id));
  const eventIds = new Set(input.clustered.clusters.flatMap((cluster) => cluster.event_ids));
  for (const candidate of input.candidates) {
    if (candidate.event_ids.length === 0 || !candidate.event_ids.some((id) => eventIds.has(id))) {
      gaps.push(`${candidate.candidate_id}:missing_evidence_cluster`);
    }
  }
  for (const review of input.reviews) {
    if (!candidateIds.has(review.candidate_id)) gaps.push(`${review.candidate_id}:review_without_candidate`);
    const candidate = input.candidates.find((item) => item.candidate_id === review.candidate_id);
    const author = candidate?.draft?.["generated_by"];
    if (typeof author === "string" && author === review.reviewed_by) {
      gaps.push(`${review.candidate_id}:author_is_reviewer`);
    }
  }
  for (const experiment of input.experiments) {
    if (experiment.candidate_ref !== null && !candidateIds.has(experiment.candidate_ref)) {
      gaps.push(`${experiment.experiment_id}:missing_candidate`);
    }
    if (experiment.efficacy_protocol === null) gaps.push(`${experiment.experiment_id}:missing_efficacy_protocol`);
  }
  const evalIds = new Set(input.results.map((item) => item.eval_id));
  for (const intervention of input.interventions) {
    for (const gap of interventionChainGaps(intervention)) gaps.push(`${intervention.intervention_id}:${gap}`);
    if (intervention.outcome_ref !== null && !evalIds.has(intervention.outcome_ref)) {
      gaps.push(`${intervention.intervention_id}:missing_outcome`);
    }
  }
  return [...new Set(gaps)].sort();
}

function resultValidity(result: EvalResult, protocolPresent: boolean): "valid" | "invalid" | "missing" {
  if (!protocolPresent) return "invalid";
  if (result.execution?.validity === "invalid_measurement") return "invalid";
  if (result.execution?.validity === "missing_measurement") return "missing";
  if ((result.execution?.invalid_reasons.length ?? 0) > 0) return "invalid";
  if (result.trials.length === 0 || result.primary_metric.control === null || result.primary_metric.treatment === null) return "missing";
  if (result.guardrails.length === 0 || result.guardrails.some((guardrail) => guardrail.detail?.includes("not measured"))) return "invalid";
  return "valid";
}

function latestCapReason(
  runs: Awaited<ReturnType<typeof listM6RunRecords>>,
  app: string,
): string | null {
  return [...runs]
    .filter((run) => run.app === app)
    .sort((a, b) => a.finished_at.localeCompare(b.finished_at) || a.run_id.localeCompare(b.run_id))
    .reverse()
    .find((run) => run.status === "capped" || run.reason?.includes("cap") === true)?.reason ?? null;
}

function capDisposition(reason: string): CandidateDispositionKind {
  if (reason.includes("monthly") || reason.includes("budget")) return "budget_capped";
  if (reason.includes("week") || reason.includes("distillation")) return "frequency_capped";
  return "volume_capped";
}

function dispositionCounts(items: CandidateDisposition[]): Record<CandidateDispositionKind, number> {
  const initial: Record<CandidateDispositionKind, number> = {
    actionable: 0,
    deduplicated: 0,
    suppressed: 0,
    rejected: 0,
    frequency_capped: 0,
    volume_capped: 0,
    budget_capped: 0,
    awaiting_evidence: 0,
    awaiting_review: 0,
    non_comparable: 0,
  };
  for (const item of items) initial[item.disposition] += 1;
  return initial;
}

function count(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function byRun(a: { app: string; runId: string }, b: { app: string; runId: string }): number {
  return a.app.localeCompare(b.app) || a.runId.localeCompare(b.runId);
}
