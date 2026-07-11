// ExperimentRecord (docs/learning-loop/learning-loop-spec.md §10; design
// §9.1): the machine-readable, declared-BEFORE-results answer to "what change
// is being tested, on which episodes, against what baseline, how are success
// and harm measured, and which result causes promotion, extension, rejection,
// or rollback".
//
// Declared-before-results is enforced structurally, not by convention: a
// record whose status is not `decided` cannot carry a result ref, and the
// only way a result lands (decideExperiment) also flips the status — there
// is no state where results informed the declaration.
//
// Control and treatment arms are two SystemFingerprints that must differ; the
// spec's stronger phrase "differ only in the intervention under test" is a
// human judgment, so declareExperiment reports the exact field-level delta
// for the reviewer instead of pretending software can verify intent.
//
// Records live in the COMMITTED org home under `learning/experiments/`
// (spec §1) — a gate-protected path (`learning-surface-tamper`,
// src/runtime/gate.ts): agents cannot write here; humans and orchestrator
// code (this module, invoked by CLI/tests today, the M5 runner later) can.
//
// Capture-truthful deltas from the spec sketch, recorded like M1/M2's:
//   - `schema_version` added (EpisodeRecord precedent).
//   - The guardrail sketch line `rule: max_increase_pct: 10` is not valid
//     YAML; normalized to `{ metric, rule, pct? }` with `pct` required
//     exactly when the rule is percentage-bounded.
//   - `unit` accepts the M1 spec-delta kind `turn` alongside the four spec
//     kinds — experiments over schedule-triggered work must be declarable.

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import type { EpisodeKind } from "./episodes.js";
import { fingerprintDelta, readFingerprint } from "./fingerprint.js";
import { listJsonRecords, readJsonRecord } from "./records.js";
import {
  optionalString,
  requireBoolean,
  requireEnum,
  requireNonNegativeNumber,
  requirePositiveInt,
  requirePrefixedId,
  requireRecord,
  requireString,
  requireStringArray,
} from "./validate.js";

export const EXPERIMENT_LAYERS = ["deterministic", "replay", "canary"] as const;
export type ExperimentLayer = (typeof EXPERIMENT_LAYERS)[number];
export type ExperimentStatus = "declared" | "running" | "decided";
export type MetricDirection = "increase" | "decrease";

export type GuardrailRule =
  | "must_not_decrease"
  | "must_not_increase"
  | "max_increase_pct"
  | "max_decrease_pct";

export interface ExperimentGuardrail {
  metric: string;
  rule: GuardrailRule;
  /** Required exactly when `rule` is percentage-bounded. */
  pct?: number;
}

export interface ExperimentRecord {
  schema_version: 1;
  experiment_id: string;
  /** Null for experiments declared directly by a human (no candidate yet). */
  candidate_ref: string | null;
  /** EpisodeRecord kind — the unit of treatment assignment (design §8). */
  unit: EpisodeKind;
  hypothesis: string;
  control: { fingerprint_ref: string };
  treatment: { fingerprint_ref: string };
  eligibility: {
    /** Eval set ref (`evals/roles/<role>/<set>`) or live population filter. */
    episodes: string;
    app: string;
    stage: string[];
  };
  primary_metric: {
    name: string;
    expected_direction: MetricDirection;
    min_useful_improvement_pct: number;
  };
  guardrails: ExperimentGuardrail[];
  trials: {
    layer: ExperimentLayer;
    /** Paired control/treatment runs. */
    repetitions: number;
    early_stop: { on_held_in_failure: boolean; on_guardrail_trip: boolean };
  };
  observation: {
    /** Wait for late outcomes before the final verdict. */
    outcome_maturity_days: number;
  };
  stop_thresholds: {
    rollback_immediately_if: { metric: string; below_control_pct: number };
  } | null;
  decision: { promote_if: string; otherwise: string };
  status: ExperimentStatus;
  /** EvalResult ref — present exactly when status is `decided`. */
  result: string | null;
}

const EPISODE_KINDS = ["build_ticket", "incident", "feedback_thread", "campaign", "turn"] as const;

export function validateExperimentRecord(value: unknown): ExperimentRecord {
  const spec = requireRecord(value, "experiment");
  const experimentId = requirePrefixedId(spec, "experiment_id", "exp_", "experiment");
  const source = experimentId;

  if (spec["schema_version"] !== 1) {
    throw new Error(`learning: ${source}.schema_version must be 1`);
  }
  const unit = requireEnum(spec, "unit", EPISODE_KINDS, source);
  const hypothesis = requireString(spec, "hypothesis", source);
  const candidateRef = optionalString(spec, "candidate_ref", source);

  const control = requireRecord(spec["control"], `${source}.control`);
  const treatment = requireRecord(spec["treatment"], `${source}.treatment`);
  const controlRef = requireString(control, "fingerprint_ref", `${source}.control`);
  const treatmentRef = requireString(treatment, "fingerprint_ref", `${source}.treatment`);
  if (controlRef === treatmentRef) {
    throw new Error(
      `learning: ${source}: control and treatment reference the same fingerprint ` +
        `(${controlRef}) — two arms that cannot differ measure nothing`,
    );
  }

  const eligibility = requireRecord(spec["eligibility"], `${source}.eligibility`);
  const episodes = requireString(eligibility, "episodes", `${source}.eligibility`);
  const app = requireString(eligibility, "app", `${source}.eligibility`);
  const stage = requireStringArray(eligibility, "stage", `${source}.eligibility`);

  const primary = requireRecord(spec["primary_metric"], `${source}.primary_metric`);
  const primaryMetric = {
    name: requireString(primary, "name", `${source}.primary_metric`),
    expected_direction: requireEnum(
      primary,
      "expected_direction",
      ["increase", "decrease"] as const,
      `${source}.primary_metric`,
    ),
    min_useful_improvement_pct: requireNonNegativeNumber(
      primary,
      "min_useful_improvement_pct",
      `${source}.primary_metric`,
    ),
  };

  if (!Array.isArray(spec["guardrails"])) {
    throw new Error(`learning: ${source}.guardrails must be an array`);
  }
  const guardrails = (spec["guardrails"] as unknown[]).map((entry, i) =>
    validateGuardrail(entry, `${source}.guardrails[${i}]`),
  );

  const trialsSpec = requireRecord(spec["trials"], `${source}.trials`);
  const earlyStop = requireRecord(trialsSpec["early_stop"], `${source}.trials.early_stop`);
  const trials = {
    layer: requireEnum(trialsSpec, "layer", EXPERIMENT_LAYERS, `${source}.trials`),
    repetitions: requirePositiveInt(trialsSpec, "repetitions", `${source}.trials`),
    early_stop: {
      on_held_in_failure: requireBoolean(
        earlyStop,
        "on_held_in_failure",
        `${source}.trials.early_stop`,
      ),
      on_guardrail_trip: requireBoolean(
        earlyStop,
        "on_guardrail_trip",
        `${source}.trials.early_stop`,
      ),
    },
  };

  const observationSpec = requireRecord(spec["observation"], `${source}.observation`);
  const observation = {
    outcome_maturity_days: requireNonNegativeNumber(
      observationSpec,
      "outcome_maturity_days",
      `${source}.observation`,
    ),
  };

  let stopThresholds: ExperimentRecord["stop_thresholds"] = null;
  if (spec["stop_thresholds"] !== undefined && spec["stop_thresholds"] !== null) {
    const stops = requireRecord(spec["stop_thresholds"], `${source}.stop_thresholds`);
    const rollback = requireRecord(
      stops["rollback_immediately_if"],
      `${source}.stop_thresholds.rollback_immediately_if`,
    );
    stopThresholds = {
      rollback_immediately_if: {
        metric: requireString(
          rollback,
          "metric",
          `${source}.stop_thresholds.rollback_immediately_if`,
        ),
        below_control_pct: requireNonNegativeNumber(
          rollback,
          "below_control_pct",
          `${source}.stop_thresholds.rollback_immediately_if`,
        ),
      },
    };
  }

  const decisionSpec = requireRecord(spec["decision"], `${source}.decision`);
  const decision = {
    promote_if: requireString(decisionSpec, "promote_if", `${source}.decision`),
    otherwise: requireString(decisionSpec, "otherwise", `${source}.decision`),
  };

  const status = requireEnum(spec, "status", ["declared", "running", "decided"] as const, source);
  const result = optionalString(spec, "result", source);
  // Declared-before-results (spec §10): only a decided experiment carries a
  // result, and a decided experiment must carry one — no third state.
  if (status !== "decided" && result !== null) {
    throw new Error(
      `learning: ${source}: status "${status}" cannot carry a result — ` +
        `results are declared-before-observed (design §9.1); decide it via decideExperiment`,
    );
  }
  if (status === "decided" && result === null) {
    throw new Error(`learning: ${source}: status "decided" requires a result ref`);
  }

  return {
    schema_version: 1,
    experiment_id: experimentId,
    candidate_ref: candidateRef,
    unit,
    hypothesis,
    control: { fingerprint_ref: controlRef },
    treatment: { fingerprint_ref: treatmentRef },
    eligibility: { episodes, app, stage },
    primary_metric: primaryMetric,
    guardrails,
    trials,
    observation,
    stop_thresholds: stopThresholds,
    decision,
    status,
    result,
  };
}

function validateGuardrail(value: unknown, source: string): ExperimentGuardrail {
  const spec = requireRecord(value, source);
  const metric = requireString(spec, "metric", source);
  const rule = requireEnum(
    spec,
    "rule",
    ["must_not_decrease", "must_not_increase", "max_increase_pct", "max_decrease_pct"] as const,
    source,
  );
  const boundedRule = rule === "max_increase_pct" || rule === "max_decrease_pct";
  const pct = spec["pct"];
  if (boundedRule) {
    if (typeof pct !== "number" || !Number.isFinite(pct) || pct <= 0) {
      throw new Error(`learning: ${source}.pct must be a positive number for rule "${rule}"`);
    }
    return { metric, rule, pct };
  }
  if (pct !== undefined) {
    throw new Error(`learning: ${source}.pct only applies to percentage-bounded rules`);
  }
  return { metric, rule };
}

// ---------------------------------------------------------------------------
// storage (committed org home, spec §1)
// ---------------------------------------------------------------------------

export function experimentsDir(orgHome: string): string {
  return join(orgHome, "learning", "experiments");
}

export function experimentPath(orgHome: string, experimentId: string): string {
  return join(experimentsDir(orgHome), `${experimentId}.json`);
}

export interface DeclareExperimentOptions {
  orgHome: string;
  /** When given, both arm fingerprints must exist in the state-home store —
   *  an experiment declared against unstored arms could never replay. */
  stateHome?: string;
}

export interface DeclaredExperiment {
  record: ExperimentRecord;
  path: string;
  /** Field-level control→treatment delta when both fingerprints were
   *  resolvable — the reviewer's evidence that the arms differ only in the
   *  intervention under test (spec §6). Null when not checked. */
  arm_delta: string[] | null;
}

/** Validate and persist a new experiment declaration. Refuses to overwrite an
 *  existing record with different content — declarations are immutable once
 *  made (re-declaring the identical record is an idempotent no-op). */
export async function declareExperiment(
  value: unknown,
  options: DeclareExperimentOptions,
): Promise<DeclaredExperiment> {
  const record = validateExperimentRecord(value);
  if (record.status !== "declared") {
    throw new Error(
      `learning: ${record.experiment_id}: a new experiment must be declared with status ` +
        `"declared", got "${record.status}"`,
    );
  }

  let armDelta: string[] | null = null;
  if (options.stateHome !== undefined) {
    const [control, treatment] = await Promise.all([
      readFingerprint(options.stateHome, record.control.fingerprint_ref),
      readFingerprint(options.stateHome, record.treatment.fingerprint_ref),
    ]);
    const missing = [
      ...(control === undefined ? [record.control.fingerprint_ref] : []),
      ...(treatment === undefined ? [record.treatment.fingerprint_ref] : []),
    ];
    if (missing.length > 0) {
      throw new Error(
        `learning: ${record.experiment_id}: fingerprint(s) not in the store: ` +
          `${missing.join(", ")} — store both arms (storeFingerprint) before declaring`,
      );
    }
    armDelta = fingerprintDelta(control!, treatment!);
  }

  const path = experimentPath(options.orgHome, record.experiment_id);
  const next = JSON.stringify(record, null, 2) + "\n";
  if (existsSync(path)) {
    const existing = await readFile(path, "utf8");
    if (existing !== next) {
      throw new Error(
        `learning: ${record.experiment_id} already declared with different content — ` +
          `declarations are immutable; declare a new experiment id instead`,
      );
    }
    return { record, path, arm_delta: armDelta };
  }
  await mkdir(experimentsDir(options.orgHome), { recursive: true });
  await writeFileAtomic(path, next);
  return { record, path, arm_delta: armDelta };
}

/** declared → running: the M5 runner's entry point; recorded now so the
 *  status enum is exercised end-to-end before model tokens exist. */
export async function markExperimentRunning(
  orgHome: string,
  experimentId: string,
): Promise<ExperimentRecord> {
  const record = await readExperimentRecord(orgHome, experimentId);
  if (record.status === "decided") {
    throw new Error(`learning: ${experimentId} is already decided — it cannot re-run`);
  }
  if (record.status === "running") return record;
  const next: ExperimentRecord = { ...record, status: "running" };
  await writeFileAtomic(
    experimentPath(orgHome, experimentId),
    JSON.stringify(next, null, 2) + "\n",
  );
  return next;
}

export async function readExperimentRecord(
  orgHome: string,
  experimentId: string,
): Promise<ExperimentRecord> {
  return readJsonRecord(
    experimentPath(orgHome, experimentId),
    validateExperimentRecord,
    `learning: no experiment ${experimentId} under ${experimentsDir(orgHome)} — ` +
      `operon learn report lists declared experiments`,
  );
}

/** Every experiment record, sorted by id. EvalResults share the directory
 *  (spec §1) — files are routed by their id prefix, so a mixed directory
 *  never misparses. */
export async function listExperimentRecords(orgHome: string): Promise<ExperimentRecord[]> {
  return listJsonRecords(experimentsDir(orgHome), "exp_", validateExperimentRecord);
}
