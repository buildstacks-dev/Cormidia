// Job config loader and validator — CORMIDIA-C-B30-001 (docs/jobs/design.md §5).
//
// The whole point of this module is that every structural defect is caught HERE,
// before any runtime is constructed and before a single token is spent. A config
// error must never cost a provider turn, so validation is total and the loader
// returns a typed refusal rather than a partially-usable plan.
//
// Parsing mirrors src/org/roles.ts and src/loop/pipelines.ts: yaml.parse plus
// explicit field checks with descriptive errors carrying the job and step id.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { Effort, RuntimeKind } from "../runtime/types.js";
import type { DeclaredOutput, JobConfig, JobStep, JobStepAssignment, OutputCheck } from "./types.js";

const RUNTIME_KINDS = new Set<RuntimeKind>(["claude", "codex", "pi"]);
const EFFORTS = new Set<Effort>(["low", "medium", "high", "xhigh", "max"]);

export class JobConfigError extends Error {
  constructor(
    readonly code: JobConfigErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "JobConfigError";
  }
}

export type JobConfigErrorCode =
  | "job_config_unreadable"
  | "job_config_shape_invalid"
  | "job_step_id_invalid"
  | "job_step_id_duplicate"
  | "job_step_kind_ambiguous"
  | "job_dependency_unknown"
  | "job_dependency_cycle"
  | "job_assignment_invalid"
  | "job_output_invalid";

export async function loadJobConfig(path: string): Promise<JobConfig> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new JobConfigError(
      "job_config_unreadable",
      `${path}: cannot read job config — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseJobConfig(text, path);
}

export function parseJobConfig(text: string, path: string): JobConfig {
  let raw: unknown;
  try {
    raw = parse(text) as unknown;
  } catch (error) {
    throw new JobConfigError(
      "job_config_shape_invalid",
      `${path}: not valid YAML — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(raw)) throw new JobConfigError("job_config_shape_invalid", `${path}: not a YAML mapping`);

  const job = requireIdentifier(raw["job"], `${path}: job`, "job_config_shape_invalid");
  const app = parseApp(raw["app"], path);
  const description = typeof raw["description"] === "string" ? raw["description"].trim() : "";

  const stepsRaw = raw["steps"];
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    throw new JobConfigError("job_config_shape_invalid", `${path}: steps must be a non-empty list`);
  }

  const steps: JobStep[] = [];
  const seen = new Set<string>();
  for (const [index, valueStep] of stepsRaw.entries()) {
    const step = parseStep(valueStep, index, path);
    if (seen.has(step.id)) {
      throw new JobConfigError("job_step_id_duplicate", `${path}: duplicate step id "${step.id}"`);
    }
    seen.add(step.id);
    steps.push(step);
  }

  assertDependenciesResolve(steps, path);
  assertAcyclic(steps, path);

  const normalized = { job, app, steps };
  return { job, app, description, steps, configHash: sha256(stableJson(normalized)) };
}

function parseApp(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new JobConfigError("job_config_shape_invalid", `${path}: app must be a non-empty string or null`);
  }
  return requireIdentifier(value, `${path}: app`, "job_config_shape_invalid");
}

function parseStep(value: unknown, index: number, path: string): JobStep {
  const context = `${path}: steps[${index}]`;
  if (!isRecord(value)) throw new JobConfigError("job_config_shape_invalid", `${context} must be a mapping`);

  const id = requireIdentifier(value["id"], `${context}.id`, "job_step_id_invalid");
  const dependsOn = parseDependsOn(value["dependsOn"], `${context}.dependsOn`);

  const hasCheckpoint = value["checkpoint"] !== undefined;
  const hasObjective = value["objective"] !== undefined;
  if (hasCheckpoint && hasObjective) {
    throw new JobConfigError(
      "job_step_kind_ambiguous",
      `${context} declares both objective and checkpoint; a step is one or the other`,
    );
  }
  if (!hasCheckpoint && !hasObjective) {
    throw new JobConfigError(
      "job_step_kind_ambiguous",
      `${context} declares neither objective nor checkpoint; one is required`,
    );
  }

  if (hasCheckpoint) {
    const checkpoint = value["checkpoint"];
    if (!isRecord(checkpoint)) {
      throw new JobConfigError("job_config_shape_invalid", `${context}.checkpoint must be a mapping`);
    }
    const prompt = requireText(checkpoint["prompt"], `${context}.checkpoint.prompt`);
    for (const forbidden of ["assignment", "outputs"]) {
      if (value[forbidden] !== undefined) {
        throw new JobConfigError(
          "job_step_kind_ambiguous",
          `${context} is a checkpoint and may not declare ${forbidden}`,
        );
      }
    }
    return { kind: "checkpoint", id, dependsOn, prompt };
  }

  const objective = requireText(value["objective"], `${context}.objective`);
  const outputs = parseOutputs(value["outputs"], `${context}.outputs`);
  const assignment = parseAssignment(value["assignment"], `${context}.assignment`);
  return {
    kind: "provider",
    id,
    objective,
    dependsOn,
    outputs,
    ...(assignment === undefined ? {} : { assignment }),
  };
}

function parseDependsOn(value: unknown, context: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new JobConfigError("job_config_shape_invalid", `${context} must be a list`);
  return value.map((entry, i) => requireIdentifier(entry, `${context}[${i}]`, "job_dependency_unknown"));
}

function parseOutputs(value: unknown, context: string): DeclaredOutput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new JobConfigError("job_output_invalid", `${context} must be a list`);
  return value.map((entry, i) => {
    const entryContext = `${context}[${i}]`;
    if (!isRecord(entry)) throw new JobConfigError("job_output_invalid", `${entryContext} must be a mapping`);
    const outputPath = requireRelativePath(entry["path"], `${entryContext}.path`);
    return { path: outputPath, check: parseCheck(entry["check"], `${entryContext}.check`) };
  });
}

function parseCheck(value: unknown, context: string): OutputCheck {
  if (value === undefined) return { kind: "exists" };
  if (typeof value === "string") {
    if (value === "exists" || value === "non_empty" || value === "json") return { kind: value };
    throw new JobConfigError(
      "job_output_invalid",
      `${context} "${value}" is not a known check; use exists, non_empty, json, or a schema/command mapping`,
    );
  }
  if (!isRecord(value)) throw new JobConfigError("job_output_invalid", `${context} must be a string or mapping`);
  if (typeof value["schema"] === "string") {
    return { kind: "schema", schemaPath: requireRelativePath(value["schema"], `${context}.schema`) };
  }
  if (typeof value["command"] === "string") {
    return { kind: "command", command: requireText(value["command"], `${context}.command`) };
  }
  throw new JobConfigError("job_output_invalid", `${context} mapping must declare schema or command`);
}

function parseAssignment(value: unknown, context: string): JobStepAssignment | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new JobConfigError("job_assignment_invalid", `${context} must be a mapping`);
  const harness = value["harness"];
  if (typeof harness !== "string" || !RUNTIME_KINDS.has(harness as RuntimeKind)) {
    throw new JobConfigError(
      "job_assignment_invalid",
      `${context}.harness must be one of ${[...RUNTIME_KINDS].join(", ")}`,
    );
  }
  const effort = value["effort"];
  if (typeof effort !== "string" || !EFFORTS.has(effort as Effort)) {
    throw new JobConfigError("job_assignment_invalid", `${context}.effort must be one of ${[...EFFORTS].join(", ")}`);
  }
  return {
    harness: harness as RuntimeKind,
    model: requireText(value["model"], `${context}.model`),
    effort: effort as Effort,
  };
}

function assertDependenciesResolve(steps: JobStep[], path: string): void {
  const ids = new Set(steps.map((step) => step.id));
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) {
        throw new JobConfigError(
          "job_dependency_unknown",
          `${path}: step "${step.id}" depends on unknown step "${dependency}"`,
        );
      }
      if (dependency === step.id) {
        throw new JobConfigError("job_dependency_cycle", `${path}: step "${step.id}" depends on itself`);
      }
    }
  }
}

/** Kahn's algorithm. A cycle is a load error, never a runtime failure (§5). */
function assertAcyclic(steps: JobStep[], path: string): void {
  const remaining = new Map(steps.map((step) => [step.id, new Set(step.dependsOn)]));
  for (;;) {
    const ready = [...remaining].filter(([, deps]) => deps.size === 0).map(([id]) => id);
    if (ready.length === 0) break;
    for (const id of ready) {
      remaining.delete(id);
      for (const deps of remaining.values()) deps.delete(id);
    }
  }
  if (remaining.size > 0) {
    const involved = [...remaining.keys()].sort().join(", ");
    throw new JobConfigError("job_dependency_cycle", `${path}: dependency cycle among steps: ${involved}`);
  }
}

function requireIdentifier(value: unknown, context: string, code: JobConfigErrorCode): string {
  const text = requireText(value, context);
  if (text.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(text)) {
    throw new JobConfigError(
      code,
      `${context} must be a path-safe identifier (letters, digits, dot, dash, underscore); got "${text}"`,
    );
  }
  return text;
}

function requireRelativePath(value: unknown, context: string): string {
  const text = requireText(value, context);
  if (text.startsWith("/") || text.split("/").includes("..")) {
    throw new JobConfigError(
      "job_output_invalid",
      `${context} must be a relative path inside the job working directory; got "${text}"`,
    );
  }
  return text;
}

function requireText(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new JobConfigError("job_config_shape_invalid", `${context} must be a non-empty string`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Key-sorted JSON so the config hash is stable across formatting changes. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
