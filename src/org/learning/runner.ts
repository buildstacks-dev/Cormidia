// ExperimentRunner (spec §16; design §9.5): the §9.5 funnel in one place.
//
//   deterministic prechecks        — zero tokens: trusted fixtures only,
//                                    repetition cap, fingerprint drift,
//                                    learning-budget preflight
//   targeted role-level eval       — small spend: one paired builder pass on
//                                    the held-in fixture, gate-graded
//   full paired episode replay     — the metered resource: control/treatment
//                                    pipelines × repetitions
//
// Early stopping is declared on the experiment (`trials.early_stop`): a
// held-in failure or a guardrail trip aborts the remaining pairs, and the
// verdict is computed from the pairs that ran — an aborted funnel decides
// honestly (usually `inconclusive` or `regressed`), it does not vanish.
// Budget caps halt BETWEEN pairs: the completed pairs' spend is already in
// the ledger, and the halt reason lands in the run outcome and the report.
//
// The runner never chooses what to test: the experiment was declared before
// results (M3), the fixtures were independently validated (two-actor), and
// decideExperiment is the only path that writes a verdict — this module
// produces trials, nothing else has authority.

import { listCandidateArtifacts } from "./candidate-store.js";
import { orgLearningRoot } from "./concepts.js";
import type { EvalResult, EvalTrial } from "./eval-result.js";
import { computeEvalResult, decideExperiment, evaluateGuardrail } from "./eval-result.js";
import { listEvalFixtures, type EvalFixture } from "./eval-fixture.js";
import {
  markExperimentRunning,
  readExperimentRecord,
  type ExperimentRecord,
} from "./experiment.js";
import { claimAfterEval } from "./candidate.js";
import {
  interventionIdForCandidate,
  interventionPath,
  readInterventionRecord,
  writeInterventionRecord,
} from "./intervention.js";
import type { LearningPolicy } from "./policy.js";
import type { ReplayAttempt, ReplayExecutor } from "./replay.js";
import { existsSync } from "node:fs";

export interface LearningSpendSnapshot {
  monthUsd: number;
  candidateUsd: number;
  experimentsThisMonth: number;
  /** True when this experiment already has settled spend this month — a
   *  resumed run is not a new experiment against the monthly count. */
  experimentCounted: boolean;
}

export interface RunExperimentOptions {
  orgHome: string;
  policy: LearningPolicy;
  executor: ReplayExecutor;
  decidedBy: string;
  /** Learning-ledger snapshot at start (org/budget.ts rollupLearningSpend,
   *  narrowed to this experiment/candidate). Injectable for tests. */
  spend: LearningSpendSnapshot;
  /** Trusted fixtures override; defaults to the experiment's eligibility
   *  eval set. */
  fixtures?: EvalFixture[];
  /** Episode ids the candidate claims to fix — their fixtures are held-in.
   *  Defaults from the candidate artifact when resolvable. */
  heldInEpisodeIds?: string[];
  /** Current system fingerprint id; when given it must match the declared
   *  control arm — a drifted system would measure the drift, not the
   *  candidate. */
  currentFingerprintId?: string;
  clock?: () => Date;
}

export interface ExperimentRunOutcome {
  experiment: ExperimentRecord;
  result: EvalResult;
  attempts: ReplayAttempt[];
  /** Why the funnel stopped before its declared repetitions, when it did. */
  halted: string | null;
}

export async function runExperiment(
  experimentId: string,
  options: RunExperimentOptions,
): Promise<ExperimentRunOutcome> {
  const clock = options.clock ?? ((): Date => new Date());
  const experiment = await readExperimentRecord(options.orgHome, experimentId);

  // -- deterministic prechecks (zero tokens) --------------------------------
  if (experiment.status === "decided") {
    throw new Error(
      `learning: ${experimentId} is already decided (${experiment.result}) — ` +
        `one experiment, one verdict; declare a new experiment to re-test`,
    );
  }
  if (experiment.trials.layer !== "replay") {
    throw new Error(
      `learning: ${experimentId} declares layer "${experiment.trials.layer}" — the runner ` +
        `executes replay experiments; deterministic checks run in CI and canary trials run ` +
        `live through \`operon learn canary\``,
    );
  }
  const caps = options.policy.learning_budget;
  if (experiment.trials.repetitions > caps.max_repetitions_per_experiment) {
    throw new Error(
      `learning: ${experimentId} declares ${experiment.trials.repetitions} repetitions — ` +
        `policy caps experiments at ${caps.max_repetitions_per_experiment} ` +
        `(learning_budget.max_repetitions_per_experiment)`,
    );
  }
  if (
    options.currentFingerprintId !== undefined &&
    options.currentFingerprintId !== experiment.control.fingerprint_ref
  ) {
    throw new Error(
      `learning: the system has drifted since ${experimentId} was declared ` +
        `(control arm ${experiment.control.fingerprint_ref}, current ${options.currentFingerprintId}) — ` +
        `a replay now would measure the drift, not the candidate; declare a fresh experiment`,
    );
  }
  const spend = options.spend;
  let localCost = 0;
  // ONE spelling of the cap arithmetic: the start preflight is the same
  // check the between-pair halt runs, at localCost 0.
  const overBudget = (): string | null => {
    if (spend.monthUsd + localCost >= caps.monthly_usd) {
      return `monthly learning budget cap ($${caps.monthly_usd.toFixed(2)}) reached`;
    }
    if (spend.candidateUsd + localCost >= caps.per_candidate_replay_usd) {
      return `per-candidate replay cap ($${caps.per_candidate_replay_usd.toFixed(2)}) reached`;
    }
    return null;
  };
  const preflightHalt = overBudget();
  if (preflightHalt !== null) {
    throw new Error(
      `learning: ${preflightHalt} for ${experiment.candidate_ref ?? experimentId} — ` +
        `no replay starts (policy §13); the evidence so far is the evidence`,
    );
  }
  if (!spend.experimentCounted && spend.experimentsThisMonth >= caps.max_experiments_per_month) {
    throw new Error(
      `learning: ${spend.experimentsThisMonth} experiments already ran this month — ` +
        `policy caps the month at ${caps.max_experiments_per_month} ` +
        `(learning_budget.max_experiments_per_month)`,
    );
  }

  const fixtures = options.fixtures ?? (await eligibleFixtures(options.orgHome, experiment));
  if (fixtures.length === 0) {
    throw new Error(
      `learning: no trusted fixtures for ${experiment.eligibility.episodes} — ` +
        `convert and independently validate a capsule first (operon learn fixture)`,
    );
  }
  // The held-in case is the specific weakness the candidate claims to fix
  // (design §10). When the candidate names episodes and the eval set covers
  // NONE of them, running would early-stop the one-shot experiment on
  // evidence the candidate never claimed to affect — refuse instead.
  const heldInIds = new Set(
    options.heldInEpisodeIds ?? (await candidateEpisodeIds(options.orgHome, experiment)),
  );
  const heldInMatch = fixtures.find((fixture) => heldInIds.has(fixture.episode_ref));
  if (heldInIds.size > 0 && heldInMatch === undefined) {
    throw new Error(
      `learning: ${experiment.eligibility.episodes} has no trusted fixture for the candidate's ` +
        `claimed episodes (${[...heldInIds].join(", ")}) — convert one of THOSE episodes' ` +
        `capsules into the set, or the held-in eval would grade an unrelated case`,
    );
  }
  const heldIn = heldInMatch ?? fixtures[0]!;

  // -- run ------------------------------------------------------------------
  await markExperimentRunning(options.orgHome, experimentId);
  const attempts: ReplayAttempt[] = [];
  const trials: EvalTrial[] = [];
  let halted: string | null = null;

  const runPair = async (
    pair: number,
    mode: "targeted" | "full",
    fixture: EvalFixture,
  ): Promise<EvalTrial> => {
    const control = await options.executor.attempt({ fixture, arm: "control", pair, mode, experiment });
    attempts.push(control);
    localCost += control.costUsd;
    const treatment = await options.executor.attempt({ fixture, arm: "treatment", pair, mode, experiment });
    attempts.push(treatment);
    localCost += treatment.costUsd;
    const trial: EvalTrial = { pair, control: control.metrics, treatment: treatment.metrics };
    trials.push(trial);
    return trial;
  };

  // Targeted role-level eval: the cheap step before full replay (§9.5).
  // The pair lands in `trials` via runPair; the treatment attempt is the
  // last one pushed.
  await runPair(0, "targeted", heldIn);
  if (experiment.trials.early_stop.on_held_in_failure && !attempts.at(-1)!.heldInPass) {
    halted = "targeted held-in eval failed under the treatment arm — full replay skipped";
  }

  if (halted === null) {
    for (let pair = 1; pair <= experiment.trials.repetitions; pair++) {
      const budgetHalt = overBudget();
      if (budgetHalt !== null) {
        halted = `${budgetHalt} after ${pair - 1} of ${experiment.trials.repetitions} full pairs`;
        break;
      }
      const fixture = fixtures[(pair - 1) % fixtures.length]!;
      await runPair(pair, "full", fixture);
      const treatment = attempts.at(-1)!;
      if (experiment.trials.early_stop.on_held_in_failure && !treatment.heldInPass) {
        halted = `held-in failure on pair ${pair} — remaining pairs skipped`;
        break;
      }
      if (experiment.trials.early_stop.on_guardrail_trip && guardrailTripped(experiment, trials)) {
        halted = `guardrail tripped on pair ${pair} — remaining pairs skipped`;
        break;
      }
    }
  }

  // -- decide (declared-before-results is preserved: this is the only path
  // that writes a verdict, and it grades whatever pairs actually ran) -------
  const computed = computeEvalResult({
    experiment,
    trials,
    capsuleRefs: [...new Set(fixtures.map((fixture) => fixture.capsule_ref))],
    graderRef: heldIn.grader.ref,
    costUsd: round2(localCost),
    decidedBy: options.decidedBy,
    decidedAt: clock().toISOString(),
  });
  const { result, experiment: decided } = await decideExperiment(options.orgHome, computed);
  await linkIntervention(options.orgHome, decided, result);
  return { experiment: decided, result, attempts, halted };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Trusted, replayable fixtures for the experiment's eval-set ref
 *  (`evals/<scope>/<set>` per spec §10). Exported so the CLI can prepare
 *  seed clones for exactly the fixtures the runner will use. */
export async function eligibleFixtures(
  orgHome: string,
  experiment: ExperimentRecord,
): Promise<EvalFixture[]> {
  const ref = experiment.eligibility.episodes;
  const set = ref.startsWith("evals/") ? ref.slice("evals/".length) : ref;
  return (await listEvalFixtures(orgHome)).filter(
    (fixture) =>
      fixture.eval_set === set &&
      fixture.validated_by !== null &&
      fixture.input.brief !== null &&
      fixture.input.brief !== undefined &&
      fixture.seed.commit !== null,
  );
}

async function candidateEpisodeIds(
  orgHome: string,
  experiment: ExperimentRecord,
): Promise<string[]> {
  if (experiment.candidate_ref === null) return [];
  try {
    const candidates = await listCandidateArtifacts(orgLearningRoot(orgHome));
    return (
      candidates.find((candidate) => candidate.candidate_id === experiment.candidate_ref)
        ?.episode_ids ?? []
    );
  } catch {
    return [];
  }
}

/** Guardrail early-stop check over the FULL pairs run so far — the same
 *  evaluator the final verdict uses. Pair 0 is the targeted eval and
 *  measures fewer metrics; including it would trip the fail-closed "not
 *  measured" rule on every experiment. */
function guardrailTripped(experiment: ExperimentRecord, trials: EvalTrial[]): boolean {
  const fullTrials = trials.filter((trial) => trial.pair > 0);
  if (fullTrials.length === 0) return false;
  return experiment.guardrails.some(
    (guardrail) => !evaluateGuardrail(guardrail, fullTrials).pass,
  );
}

/** Post-verdict lineage: when the candidate was already activated (an
 *  authorized T0/T1 publish that replay is validating after the fact), the
 *  intervention gains the experiment/outcome refs — and an `improved`
 *  verdict upgrades the claim (`claimAfterEval`; `authorized` never upgrades
 *  silently, spec §17). Pre-activation experiments have no intervention yet;
 *  the publisher links them at publish time. */
async function linkIntervention(
  orgHome: string,
  experiment: ExperimentRecord,
  result: EvalResult,
): Promise<void> {
  if (experiment.candidate_ref === null) return;
  const interventionId = interventionIdForCandidate(experiment.candidate_ref);
  if (!existsSync(interventionPath(orgHome, interventionId))) return;
  const intervention = await readInterventionRecord(orgHome, interventionId);
  if (intervention.status === "rolled_back" || intervention.status === "retired") return;
  await writeInterventionRecord(orgHome, {
    ...intervention,
    experiment_ref: experiment.experiment_id,
    outcome_ref: result.eval_id,
    ...(intervention.activation !== null
      ? {
          activation: {
            ...intervention.activation,
            claim: claimAfterEval(result.verdict),
          },
        }
      : {}),
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
