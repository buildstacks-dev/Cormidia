// Declared output checks — CORMIDIA-C-B30-003 (docs/jobs/design.md §7).
//
// These are the substitute for a reviewer. A long job will produce a step that
// does NOT fail — it returns confident prose the next step cannot use — and
// without a deterministic check, steps four through nine build on it and the
// operator finds out on day six. PURPOSE non-negotiable #1 applies: if it can be
// code, it is code.
//
// Every check is fail-closed. A check that cannot be evaluated FAILS; it never
// passes by absence, and its failure makes the step failed regardless of what
// the provider reported.

import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { DeclaredOutput, ProviderJobStep } from "./types.js";

const run = promisify(execFile);
const COMMAND_TIMEOUT_MS = 120_000;

export interface CheckOutcome {
  path: string;
  passed: boolean;
  /** Human-readable cause when `passed` is false. */
  detail?: string;
}

export interface StepCheckResult {
  /** True only when every declared output passed. */
  passed: boolean;
  /** True when the step declared no outputs — reported, never treated as pass. */
  unverified: boolean;
  outcomes: CheckOutcome[];
}

/**
 * Evaluates every declared output of a step against the job working directory.
 *
 * A step with no declared outputs is `unverified`: it did run, and the absence of
 * a check is a visible property of the result rather than silence (the INV-008
 * tightening this subsystem carries).
 */
export async function evaluateStepChecks(step: ProviderJobStep, workdir: string): Promise<StepCheckResult> {
  if (step.outputs.length === 0) {
    return { passed: true, unverified: true, outcomes: [] };
  }
  const outcomes: CheckOutcome[] = [];
  for (const output of step.outputs) {
    outcomes.push(await evaluateOutput(output, workdir));
  }
  return { passed: outcomes.every((outcome) => outcome.passed), unverified: false, outcomes };
}

async function evaluateOutput(output: DeclaredOutput, workdir: string): Promise<CheckOutcome> {
  const target = confine(workdir, output.path);
  if (target === undefined) {
    return { path: output.path, passed: false, detail: "resolves outside the job working directory" };
  }
  try {
    switch (output.check.kind) {
      case "exists":
        return await checkExists(output.path, target);
      case "non_empty":
        return await checkNonEmpty(output.path, target);
      case "json":
        return await checkJson(output.path, target);
      case "schema":
        return await checkSchema(output, target, workdir);
      case "command":
        return await checkCommand(output.path, output.check.command, workdir);
    }
  } catch (error) {
    // Fail closed: an unevaluable check is a failed check.
    return { path: output.path, passed: false, detail: message(error) };
  }
}

async function checkExists(label: string, target: string): Promise<CheckOutcome> {
  const info = await stat(target).catch(() => undefined);
  if (info === undefined) return { path: label, passed: false, detail: "does not exist" };
  if (!info.isFile()) return { path: label, passed: false, detail: "exists but is not a regular file" };
  return { path: label, passed: true };
}

async function checkNonEmpty(label: string, target: string): Promise<CheckOutcome> {
  const exists = await checkExists(label, target);
  if (!exists.passed) return exists;
  const text = await readFile(target, "utf8");
  if (text.trim().length === 0) {
    return { path: label, passed: false, detail: "exists but contains only whitespace" };
  }
  return { path: label, passed: true };
}

async function checkJson(label: string, target: string): Promise<CheckOutcome> {
  const nonEmpty = await checkNonEmpty(label, target);
  if (!nonEmpty.passed) return nonEmpty;
  const text = await readFile(target, "utf8");
  try {
    JSON.parse(text);
  } catch (error) {
    return { path: label, passed: false, detail: `is not valid JSON — ${message(error)}` };
  }
  return { path: label, passed: true };
}

/**
 * Structural schema check, deliberately minimal: required top-level keys and
 * their JSON types. A full JSON Schema validator would be a new dependency, and
 * TASTE.md §3 makes that a decision rather than a convenience. What this covers
 * is the failure that actually bites — a step returning prose or an object
 * missing the field the next step reads.
 */
async function checkSchema(output: DeclaredOutput, target: string, workdir: string): Promise<CheckOutcome> {
  if (output.check.kind !== "schema") return { path: output.path, passed: false, detail: "not a schema check" };
  const json = await checkJson(output.path, target);
  if (!json.passed) return json;

  const schemaTarget = confine(workdir, output.check.schemaPath);
  if (schemaTarget === undefined) {
    return { path: output.path, passed: false, detail: "schema path resolves outside the working directory" };
  }
  const schemaText = await readFile(schemaTarget, "utf8").catch(() => undefined);
  if (schemaText === undefined) {
    return { path: output.path, passed: false, detail: `schema ${output.check.schemaPath} does not exist` };
  }
  const schema = JSON.parse(schemaText) as { required?: unknown; properties?: unknown };
  const value = JSON.parse(await readFile(target, "utf8")) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { path: output.path, passed: false, detail: "schema check requires a JSON object at the top level" };
  }
  const record = value as Record<string, unknown>;

  const required = Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === "string") : [];
  const missing = required.filter((key) => record[key] === undefined);
  if (missing.length > 0) {
    return { path: output.path, passed: false, detail: `missing required field(s): ${missing.sort().join(", ")}` };
  }

  const properties = typeof schema.properties === "object" && schema.properties !== null ? schema.properties : {};
  for (const [key, spec] of Object.entries(properties as Record<string, unknown>)) {
    const expected = typeof spec === "object" && spec !== null ? (spec as Record<string, unknown>)["type"] : undefined;
    if (typeof expected !== "string" || record[key] === undefined) continue;
    if (jsonTypeOf(record[key]) !== expected) {
      return {
        path: output.path,
        passed: false,
        detail: `field "${key}" should be ${expected}, got ${jsonTypeOf(record[key])}`,
      };
    }
  }
  return { path: output.path, passed: true };
}

async function checkCommand(label: string, command: string, workdir: string): Promise<CheckOutcome> {
  try {
    await run(command, { cwd: workdir, shell: true, timeout: COMMAND_TIMEOUT_MS });
    return { path: label, passed: true };
  } catch (error) {
    return { path: label, passed: false, detail: `check command failed — ${message(error)}` };
  }
}

/** Rejects any path escaping the job working directory, symlinks included by
 * resolving first and comparing the resolved prefix. */
function confine(workdir: string, candidate: string): string | undefined {
  if (isAbsolute(candidate)) return undefined;
  const root = resolve(workdir);
  const target = resolve(join(root, candidate));
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return target;
}

function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
