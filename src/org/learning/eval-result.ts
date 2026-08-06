// EvalResult (docs/learning-loop/learning-loop-spec.md §12) and the
// deterministic verdict computation over paired control/treatment trials —
// the M3 "decision half" of the evaluation system (design §9.3 layer 1).
//
// The verdict rules are deliberately mechanical, and fail toward caution:
//
//   not_evaluatable  no trial measured the primary metric on both arms —
//                    nothing was compared, so nothing is claimed (this is
//                    the recorded verdict for T0 facts that skip trials,
//                    design §9.1).
//   regressed        the primary metric moved AGAINST the declared expected
//                    direction, or any guardrail failed — harm outranks any
//                    apparent primary-metric win.
//   improved         the primary metric moved in the expected direction by
//                    at least the declared minimum useful effect AND every
//                    guardrail passed.
//   inconclusive     everything else: no movement, or movement in the right
//                    direction that stays under the declared minimum useful
//                    effect. Insufficient volume resolves here plus human
//                    judgment, never permanent limbo (policy §13).
//
// A guardrail whose metric no trial measured FAILS (fail closed): "we did
// not measure harm" must never read as "no harm". This module spends no
// model tokens and stamps no wall clock — the decision timestamp comes from
// the caller (M5 runner or human), so results are replayable byte-for-byte.
//
// EvalResults share `learning/experiments/` with the ExperimentRecords they
// decide (spec §1); files route by id prefix (`exp_` / `eval_`).

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { hashArgs } from "../../runtime/runlog/redact.js";
import { writeFileAtomic } from "../atomic.js";
import {
  EXPERIMENT_LAYERS,
  experimentPath,
  experimentsDir,
  readExperimentRecord,
  type ExperimentGuardrail,
  type ExperimentLayer,
  type ExperimentRecord,
} from "./experiment.js";
import { listJsonRecords, readJsonRecord } from "./records.js";
import {
  optionalString,
  requireBoolean,
  requireEnum,
  requireFiniteNumber,
  requireNonNegativeNumber,
  requirePrefixedId,
  requireRecord,
  requireString,
  requireStringArray,
} from "./validate.js";
import { definedProps } from "../../runtime/optional-properties.js";

export type EvalVerdict = "improved" | "regressed" | "inconclusive" | "not_evaluatable";
/** Model graders are deferred until a qualitative guardrail needs one
 *  (milestones M3); the enum member exists so the contract doesn't churn. */
export type GraderKind = "deterministic" | "model" | "human";

export interface EvalTrial {
  pair: number;
  control: Record<string, number>;
  treatment: Record<string, number>;
}

interface EvalGuardrailOutcome {
  metric: string;
  pass: boolean;
  /** Why a guardrail failed — including "not measured" (fail closed). */
  detail?: string;
}

export interface EvalResult {
  schema_version: 1;
  eval_id: string;
  experiment_ref: string;
  layer: ExperimentLayer;
  capsule_refs: string[];
  trials: EvalTrial[];
  primary_metric: {
    name: string;
    /** Means over the pairs that measured the metric on both arms. Null when
     *  no pair did (verdict not_evaluatable). */
    control: number | null;
    treatment: number | null;
    direction_ok: boolean;
    min_useful_met: boolean;
  };
  guardrails: EvalGuardrailOutcome[];
  verdict: EvalVerdict;
  /** Phase 4 keeps every attempted pair/order and terminal reason. Missing or
   * invalid measurements never disappear behind the aggregate verdict. */
  execution?: {
    validity: "valid" | "invalid_measurement" | "missing_measurement";
    attempted_pairs: number[];
    completed_pairs: number[];
    pair_order: Array<{ pair: number; order: ["control", "treatment"] | ["treatment", "control"] }>;
    halted_reason: string | null;
    invalid_reasons: string[];
  };
  grader: { kind: GraderKind; ref: string };
  cost_usd: number;
  decided_by: string;
  decided_at: string;
}

// ---------------------------------------------------------------------------
// deterministic verdict computation
// ---------------------------------------------------------------------------

interface ComputeEvalResultOptions {
  experiment: ExperimentRecord;
  trials: EvalTrial[];
  capsuleRefs?: string[];
  /** Defaults to the experiment's declared trial layer. */
  layer?: ExperimentLayer;
  /** What produced the trial numbers, e.g. an eval-set grader ref. The kind
   *  is stamped `deterministic` — this function IS the deterministic grader;
   *  human/model-graded results are authored as records, not computed here. */
  graderRef: string;
  costUsd: number;
  decidedBy: string;
  /** Caller-supplied ISO timestamp — no wall clock in the computation. */
  decidedAt: string;
  /** Defaults to a deterministic id derived from (experiment, trials). */
  evalId?: string;
  execution?: EvalResult["execution"];
}

export function computeEvalResult(options: ComputeEvalResultOptions): EvalResult {
  const { experiment, trials } = options;
  const metric = experiment.primary_metric;

  const scored = pairsMeasuring(trials, metric.name);
  const control = scored.length > 0 ? mean(scored.map((t) => t.control[metric.name]!)) : null;
  const treatment = scored.length > 0 ? mean(scored.map((t) => t.treatment[metric.name]!)) : null;

  // Improvement is signed toward the declared direction: positive means the
  // treatment moved the metric the way the hypothesis wanted.
  const improvement =
    control !== null && treatment !== null
      ? metric.expected_direction === "decrease"
        ? control - treatment
        : treatment - control
      : null;
  const directionOk = improvement !== null && improvement > 0;
  // Relative effect needs a nonzero baseline; a zero-baseline improvement
  // only clears a declared threshold of zero.
  const minUsefulMet =
    directionOk &&
    (control !== 0
      ? (improvement! / Math.abs(control!)) * 100 >= metric.min_useful_improvement_pct
      : metric.min_useful_improvement_pct === 0);

  const guardrails = experiment.guardrails.map((guardrail) => evaluateGuardrail(guardrail, trials));

  // Each branch tests exactly one new fact: measured at all; harmed
  // (wrong-direction movement or any guardrail failure); cleared the useful
  // threshold (minUsefulMet already implies the right direction); else the
  // in-between — no movement or a sub-threshold win.
  let verdict: EvalVerdict;
  if (improvement === null) verdict = "not_evaluatable";
  else if (improvement < 0 || guardrails.some((g) => !g.pass)) verdict = "regressed";
  else if (minUsefulMet) verdict = "improved";
  else verdict = "inconclusive";

  return {
    schema_version: 1,
    eval_id: options.evalId ?? deterministicEvalId(experiment.experiment_id, trials),
    experiment_ref: experiment.experiment_id,
    layer: options.layer ?? experiment.trials.layer,
    capsule_refs: options.capsuleRefs ?? [],
    trials,
    primary_metric: {
      name: metric.name,
      control,
      treatment,
      direction_ok: directionOk,
      min_useful_met: minUsefulMet,
    },
    guardrails,
    verdict,
    ...definedProps({ execution: options.execution }),
    grader: { kind: "deterministic", ref: options.graderRef },
    cost_usd: options.costUsd,
    decided_by: options.decidedBy,
    decided_at: options.decidedAt,
  };
}

/** Exported for the M5 runner's between-pair early-stop check (design §9.5)
 *  — one guardrail evaluator, never a throwaway EvalResult. */
export function evaluateGuardrail(guardrail: ExperimentGuardrail, trials: EvalTrial[]): EvalGuardrailOutcome {
  const scored = pairsMeasuring(trials, guardrail.metric);
  if (scored.length === 0) {
    // Fail closed: an unmeasured guardrail is a failed guardrail, never a
    // silently passed one.
    return { metric: guardrail.metric, pass: false, detail: "not measured in any trial pair" };
  }
  const control = mean(scored.map((t) => t.control[guardrail.metric]!));
  const treatment = mean(scored.map((t) => t.treatment[guardrail.metric]!));

  switch (guardrail.rule) {
    case "must_not_decrease":
      return treatment >= control
        ? { metric: guardrail.metric, pass: true }
        : failed(guardrail.metric, control, treatment);
    case "must_not_increase":
      return treatment <= control
        ? { metric: guardrail.metric, pass: true }
        : failed(guardrail.metric, control, treatment);
    case "max_increase_pct": {
      // A zero/negative-crossing baseline has no meaningful relative bound —
      // hold the absolute line instead (fail closed).
      if (control <= 0) {
        return treatment <= control
          ? { metric: guardrail.metric, pass: true }
          : failed(guardrail.metric, control, treatment, "baseline <= 0: absolute bound applied");
      }
      const pct = ((treatment - control) / control) * 100;
      return pct <= guardrail.pct!
        ? { metric: guardrail.metric, pass: true }
        : failed(guardrail.metric, control, treatment, `+${pct.toFixed(1)}% > ${guardrail.pct}%`);
    }
    case "max_decrease_pct": {
      if (control <= 0) {
        return treatment >= control
          ? { metric: guardrail.metric, pass: true }
          : failed(guardrail.metric, control, treatment, "baseline <= 0: absolute bound applied");
      }
      const pct = ((control - treatment) / control) * 100;
      return pct <= guardrail.pct!
        ? { metric: guardrail.metric, pass: true }
        : failed(guardrail.metric, control, treatment, `-${pct.toFixed(1)}% > ${guardrail.pct}%`);
    }
  }
}

function failed(metric: string, control: number, treatment: number, extra?: string): EvalGuardrailOutcome {
  return {
    metric,
    pass: false,
    detail: `control ${control} -> treatment ${treatment}${extra !== undefined ? ` (${extra})` : ""}`,
  };
}

function pairsMeasuring(trials: EvalTrial[], metric: string): EvalTrial[] {
  return trials.filter(
    (trial) =>
      typeof trial.control[metric] === "number" &&
      Number.isFinite(trial.control[metric]) &&
      typeof trial.treatment[metric] === "number" &&
      Number.isFinite(trial.treatment[metric]),
  );
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Same result bytes for the same (experiment, trials) — a re-run of the
 *  computation is a dedup, not a second decision. hashArgs canonicalizes key
 *  order, so structurally equal trials hash identically no matter how a
 *  caller built its metric maps (redact.ts — the existing deterministic
 *  digest; a plain JSON.stringify would split one decision into two ids). */
function deterministicEvalId(experimentId: string, trials: EvalTrial[]): string {
  return `eval_${hashArgs({ experimentId, trials }).slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// record validation
// ---------------------------------------------------------------------------

function validateEvalResult(value: unknown): EvalResult {
  const spec = requireRecord(value, "eval");
  const evalId = requirePrefixedId(spec, "eval_id", "eval_", "eval");
  const source = evalId;
  if (spec["schema_version"] !== 1) {
    throw new Error(`learning: ${source}.schema_version must be 1`);
  }
  const experimentRef = requirePrefixedId(spec, "experiment_ref", "exp_", source);
  const layer = requireEnum(spec, "layer", EXPERIMENT_LAYERS, source);
  const capsuleRefs = requireStringArray(spec, "capsule_refs", source);

  if (!Array.isArray(spec["trials"])) {
    throw new Error(`learning: ${source}.trials must be an array`);
  }
  const trials = (spec["trials"] as unknown[]).map((entry, i) => {
    const trial = requireRecord(entry, `${source}.trials[${i}]`);
    return {
      pair: requireFiniteNumber(trial, "pair", `${source}.trials[${i}]`),
      control: metricMap(trial["control"], `${source}.trials[${i}].control`),
      treatment: metricMap(trial["treatment"], `${source}.trials[${i}].treatment`),
    };
  });

  const primarySpec = requireRecord(spec["primary_metric"], `${source}.primary_metric`);
  const primary = {
    name: requireString(primarySpec, "name", `${source}.primary_metric`),
    control: nullableNumber(primarySpec, "control", `${source}.primary_metric`),
    treatment: nullableNumber(primarySpec, "treatment", `${source}.primary_metric`),
    direction_ok: requireBoolean(primarySpec, "direction_ok", `${source}.primary_metric`),
    min_useful_met: requireBoolean(primarySpec, "min_useful_met", `${source}.primary_metric`),
  };

  if (!Array.isArray(spec["guardrails"])) {
    throw new Error(`learning: ${source}.guardrails must be an array`);
  }
  const guardrails = (spec["guardrails"] as unknown[]).map((entry, i) => {
    const g = requireRecord(entry, `${source}.guardrails[${i}]`);
    const detail = optionalString(g, "detail", `${source}.guardrails[${i}]`);
    return {
      metric: requireString(g, "metric", `${source}.guardrails[${i}]`),
      pass: requireBoolean(g, "pass", `${source}.guardrails[${i}]`),
      ...(detail !== null ? { detail } : {}),
    };
  });

  const verdict = requireEnum(
    spec,
    "verdict",
    ["improved", "regressed", "inconclusive", "not_evaluatable"] as const,
    source,
  );
  const graderSpec = requireRecord(spec["grader"], `${source}.grader`);
  const grader = {
    kind: requireEnum(graderSpec, "kind", ["deterministic", "model", "human"] as const, `${source}.grader`),
    ref: requireString(graderSpec, "ref", `${source}.grader`),
  };

  let execution: EvalResult["execution"];
  if (spec["execution"] !== undefined) {
    const value = requireRecord(spec["execution"], `${source}.execution`);
    const pairOrder = value["pair_order"];
    if (!Array.isArray(pairOrder)) throw new Error(`learning: ${source}.execution.pair_order must be an array`);
    execution = {
      validity: requireEnum(
        value,
        "validity",
        ["valid", "invalid_measurement", "missing_measurement"] as const,
        `${source}.execution`,
      ),
      attempted_pairs: numberArray(value["attempted_pairs"], `${source}.execution.attempted_pairs`),
      completed_pairs: numberArray(value["completed_pairs"], `${source}.execution.completed_pairs`),
      pair_order: pairOrder.map((entry, index) => {
        const row = requireRecord(entry, `${source}.execution.pair_order[${index}]`);
        const order = row["order"];
        if (
          !Array.isArray(order) ||
          order.length !== 2 ||
          !(
            (order[0] === "control" && order[1] === "treatment") ||
            (order[0] === "treatment" && order[1] === "control")
          )
        ) {
          throw new Error(`learning: ${source}.execution.pair_order[${index}].order is invalid`);
        }
        return {
          pair: requireFiniteNumber(row, "pair", `${source}.execution.pair_order[${index}]`),
          order: order as ["control", "treatment"] | ["treatment", "control"],
        };
      }),
      halted_reason: optionalString(value, "halted_reason", `${source}.execution`),
      invalid_reasons: requireStringArray(value, "invalid_reasons", `${source}.execution`),
    };
  }

  return {
    schema_version: 1,
    eval_id: evalId,
    experiment_ref: experimentRef,
    layer,
    capsule_refs: capsuleRefs,
    trials,
    primary_metric: primary,
    guardrails,
    verdict,
    ...definedProps({ execution }),
    grader,
    cost_usd: requireNonNegativeNumber(spec, "cost_usd", source),
    decided_by: requireString(spec, "decided_by", source),
    decided_at: requireString(spec, "decided_at", source),
  };
}

function numberArray(value: unknown, source: string): number[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
    throw new Error(`learning: ${source} must be an array of finite numbers`);
  }
  return value as number[];
}

function metricMap(value: unknown, source: string): Record<string, number> {
  const spec = requireRecord(value, source);
  for (const [key, entry] of Object.entries(spec)) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      throw new Error(`learning: ${source}.${key} must be a finite number`);
    }
  }
  return spec as Record<string, number>;
}

function nullableNumber(spec: Record<string, unknown>, key: string, source: string): number | null {
  const value = spec[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`learning: ${source}.${key} must be a finite number or null`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// storage + the decide transition
// ---------------------------------------------------------------------------

function evalResultPath(orgHome: string, evalId: string): string {
  return join(experimentsDir(orgHome), `${evalId}.json`);
}

/** Persist an EvalResult and flip its experiment to `decided` in one place —
 *  the only path that ever writes a result ref, which is what keeps
 *  "declared before results" structural. Idempotent: re-deciding with the
 *  identical result is a no-op; a DIFFERENT result for an already-decided
 *  experiment refuses. */
export async function decideExperiment(
  orgHome: string,
  value: unknown,
): Promise<{ result: EvalResult; experiment: ExperimentRecord }> {
  const result = validateEvalResult(value);
  const experiment = await readExperimentRecord(orgHome, result.experiment_ref);
  if (experiment.status === "decided" && experiment.result !== result.eval_id) {
    throw new Error(
      `learning: ${experiment.experiment_id} is already decided by ${experiment.result} — ` +
        `a second verdict (${result.eval_id}) needs a new experiment declaration`,
    );
  }
  // One experiment, one verdict — also across the crash window between the
  // two writes below: an orphaned result file (result written, experiment
  // flip lost) must resume with the SAME result, never quietly gain a rival.
  const siblings = (await listEvalResults(orgHome)).filter(
    (existing) => existing.experiment_ref === result.experiment_ref && existing.eval_id !== result.eval_id,
  );
  if (siblings.length > 0) {
    throw new Error(
      `learning: ${experiment.experiment_id} already has recorded result ` +
        `${siblings.map((s) => s.eval_id).join(", ")} — one experiment, one verdict; ` +
        `re-decide with that result or declare a new experiment`,
    );
  }

  const resultPath = evalResultPath(orgHome, result.eval_id);
  const resultBytes = JSON.stringify(result, null, 2) + "\n";
  if (existsSync(resultPath) && (await readFile(resultPath, "utf8")) !== resultBytes) {
    throw new Error(
      `learning: ${result.eval_id} already exists with different content — ` +
        `eval results are immutable once decided`,
    );
  }
  await mkdir(experimentsDir(orgHome), { recursive: true });
  await writeFileAtomic(resultPath, resultBytes);

  const decided: ExperimentRecord = { ...experiment, status: "decided", result: result.eval_id };
  await writeFileAtomic(experimentPath(orgHome, experiment.experiment_id), JSON.stringify(decided, null, 2) + "\n");
  return { result, experiment: decided };
}

export async function readEvalResult(orgHome: string, evalId: string): Promise<EvalResult> {
  return readJsonRecord(
    evalResultPath(orgHome, evalId),
    validateEvalResult,
    `learning: no eval result ${evalId} under ${experimentsDir(orgHome)}`,
  );
}

export async function listEvalResults(orgHome: string): Promise<EvalResult[]> {
  return listJsonRecords(experimentsDir(orgHome), "eval_", validateEvalResult);
}
