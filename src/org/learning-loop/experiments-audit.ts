// Host audit copies of kernel experiment declarations and evaluation results,
// under `<state home>/learning-loop/host/experiments/`. The kernel owns the
// experiment definition, every attempt, and the verdict (decision 0028); it
// exposes the verdict through the intervention's `validation` state and the
// evaluation through `runExperiment`'s return value, but publishes no read of
// a definition by id. Reporting and retention are host concerns (kernel
// contract §Cormidia), so the host keeps this audit copy — it grants nothing
// and the kernel intervention state remains the only governed fact the
// activation gate consults.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { EvaluationResult, ExperimentDefinition, InterventionState } from "@cormidia/learning-loop";
import { writeFileAtomic } from "../atomic.js";
import type { CormidiaLearningLoop } from "./loop.js";

export interface HostExperimentRecord {
  readonly schema_version: 1;
  readonly experiment_id: string;
  readonly artifact_id: string;
  readonly candidate_id: string;
  readonly intervention_id: string;
  readonly app: string;
  readonly eval_set: string;
  readonly hypothesis: string;
  readonly declared_at: string;
  readonly definition_digest: string;
  readonly control_fingerprint: string;
  readonly treatment_fingerprint: string;
  /** Host fingerprint store ids (`<state home>/learning/fingerprints/`) of
   *  the declared arms — what the drift check diffs against. */
  readonly control_fingerprint_id?: string;
  readonly treatment_fingerprint_id?: string;
  readonly evaluation?: {
    readonly id: string;
    readonly verdict: EvaluationResult["verdict"];
    readonly evaluated_at: string;
    readonly classifications: EvaluationResult["classifications"];
    readonly analysis: EvaluationResult["analysis"];
  };
}

function text(spec: object, key: string, path: string): string {
  const value: unknown = Reflect.get(spec, key);
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`learning-loop: ${path}: ${key} must be a non-empty string`);
  return value;
}

function parseRecord(raw: string, path: string): HostExperimentRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`learning-loop: ${path} is not JSON`);
  }
  if (parsed === null || typeof parsed !== "object") throw new Error(`learning-loop: ${path} must be an object`);
  if (Reflect.get(parsed, "schema_version") !== 1) throw new Error(`learning-loop: ${path}: schema_version must be 1`);
  const controlId: unknown = Reflect.get(parsed, "control_fingerprint_id");
  const treatmentId: unknown = Reflect.get(parsed, "treatment_fingerprint_id");
  const evaluationRaw: unknown = Reflect.get(parsed, "evaluation");
  let evaluation: HostExperimentRecord["evaluation"];
  if (evaluationRaw !== undefined && evaluationRaw !== null) {
    if (typeof evaluationRaw !== "object") throw new Error(`learning-loop: ${path}: evaluation must be an object`);
    const verdict = text(evaluationRaw, "verdict", path);
    if (verdict !== "improved" && verdict !== "inconclusive" && verdict !== "regressed" && verdict !== "invalid") {
      throw new Error(`learning-loop: ${path}: unknown verdict "${verdict}"`);
    }
    const classifications: unknown = Reflect.get(evaluationRaw, "classifications");
    const analysis: unknown = Reflect.get(evaluationRaw, "analysis");
    evaluation = {
      id: text(evaluationRaw, "id", path),
      verdict,
      evaluated_at: text(evaluationRaw, "evaluated_at", path),
      classifications: Array.isArray(classifications) ? classifications : [],
      analysis: analysis === null || typeof analysis !== "object" ? null : analysisOf(analysis),
    };
  }
  return {
    schema_version: 1,
    experiment_id: text(parsed, "experiment_id", path),
    artifact_id: text(parsed, "artifact_id", path),
    candidate_id: text(parsed, "candidate_id", path),
    intervention_id: text(parsed, "intervention_id", path),
    app: text(parsed, "app", path),
    eval_set: text(parsed, "eval_set", path),
    hypothesis: text(parsed, "hypothesis", path),
    declared_at: text(parsed, "declared_at", path),
    definition_digest: text(parsed, "definition_digest", path),
    control_fingerprint: text(parsed, "control_fingerprint", path),
    treatment_fingerprint: text(parsed, "treatment_fingerprint", path),
    ...(typeof controlId === "string" && controlId.length > 0 ? { control_fingerprint_id: controlId } : {}),
    ...(typeof treatmentId === "string" && treatmentId.length > 0 ? { treatment_fingerprint_id: treatmentId } : {}),
    ...(evaluation !== undefined ? { evaluation } : {}),
  };
}

function analysisOf(value: object): EvaluationResult["analysis"] {
  // The audit copy carries the kernel's analysis verbatim; it is display
  // data, never re-derived. Absent or malformed → null (display "n/a").
  const direction: unknown = Reflect.get(value, "direction");
  const pairs: unknown = Reflect.get(value, "pairs");
  if ((direction !== "higher" && direction !== "lower") || !Array.isArray(pairs)) return null;
  const minimumUsefulEffect: unknown = Reflect.get(value, "minimumUsefulEffect");
  const meanFavorableDelta: unknown = Reflect.get(value, "meanFavorableDelta");
  const favorablePairs: unknown = Reflect.get(value, "favorablePairs");
  const unfavorablePairs: unknown = Reflect.get(value, "unfavorablePairs");
  const guardrails: unknown = Reflect.get(value, "guardrails");
  if (
    typeof minimumUsefulEffect !== "number" ||
    typeof meanFavorableDelta !== "number" ||
    typeof favorablePairs !== "number" ||
    typeof unfavorablePairs !== "number" ||
    !Array.isArray(guardrails)
  ) {
    return null;
  }
  return { direction, minimumUsefulEffect, pairs, meanFavorableDelta, favorablePairs, unfavorablePairs, guardrails };
}

function experimentsDir(stateDir: string): string {
  return join(stateDir, "host", "experiments");
}

export function hostExperimentPath(stateDir: string, experimentId: string): string {
  return join(experimentsDir(stateDir), `${experimentId}.json`);
}

export async function readHostExperiment(
  stateDir: string,
  experimentId: string,
): Promise<HostExperimentRecord | undefined> {
  const path = hostExperimentPath(stateDir, experimentId);
  if (!existsSync(path)) return undefined;
  return parseRecord(await readFile(path, "utf8"), path);
}

export async function writeHostExperiment(stateDir: string, record: HostExperimentRecord): Promise<void> {
  await mkdir(experimentsDir(stateDir), { recursive: true });
  await writeFileAtomic(hostExperimentPath(stateDir, record.experiment_id), `${JSON.stringify(record, null, 2)}\n`);
}

export async function listHostExperiments(stateDir: string): Promise<HostExperimentRecord[]> {
  const dir = experimentsDir(stateDir);
  if (!existsSync(dir)) return [];
  const out: HostExperimentRecord[] = [];
  for (const name of (await readdir(dir)).filter((entry) => entry.endsWith(".json")).sort()) {
    out.push(parseRecord(await readFile(join(dir, name), "utf8"), join(dir, name)));
  }
  return out;
}

/** The audit record for a freshly declared kernel definition. */
export function hostExperimentOf(input: {
  readonly definition: ExperimentDefinition;
  readonly artifactId: string;
  readonly candidateId: string;
  readonly app: string;
  readonly evalSet: string;
  readonly controlFingerprintId?: string;
  readonly treatmentFingerprintId?: string;
}): HostExperimentRecord {
  return {
    schema_version: 1,
    experiment_id: input.definition.id,
    artifact_id: input.artifactId,
    candidate_id: input.candidateId,
    intervention_id: input.definition.interventionId,
    app: input.app,
    eval_set: input.evalSet,
    hypothesis: input.definition.hypothesis,
    declared_at: input.definition.declaredAt,
    definition_digest: input.definition.definitionDigest,
    control_fingerprint: input.definition.controlFingerprintDigest,
    treatment_fingerprint: input.definition.treatmentFingerprintDigest,
    ...(input.controlFingerprintId !== undefined ? { control_fingerprint_id: input.controlFingerprintId } : {}),
    ...(input.treatmentFingerprintId !== undefined ? { treatment_fingerprint_id: input.treatmentFingerprintId } : {}),
  };
}

/** The kernel's validation verdict for the intervention an experiment ref names. */
export async function experimentValidationFor(
  learning: CormidiaLearningLoop,
  experimentRef: string,
): Promise<{ readonly validation: InterventionState["validation"]; readonly interventionId: string } | undefined> {
  const record = await readHostExperiment(learning.stateDir, experimentRef);
  if (record === undefined) return undefined;
  const intervention = await learning.loop.getIntervention({ interventionId: record.intervention_id });
  if (intervention === undefined) return undefined;
  return { validation: intervention.state.validation, interventionId: intervention.id };
}
