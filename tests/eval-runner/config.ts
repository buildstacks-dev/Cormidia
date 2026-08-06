// Strict authorization envelope for L4 provider-spending data collection.

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { EvalCaseTokenReservation, EvalTuple } from "./eval-runner.js";

export interface EvalCliConfigV1 {
  schema_version: 1;
  campaign_id: string;
  human_authorization: { human_initiated: true; authorized_by: string; authorized_at: string; purpose: string };
  state_home: string;
  policy_path: string;
  commit: string;
  app: string;
  golden_set_files: string[];
  tuples: EvalTuple[];
  case_token_reservations: EvalCaseTokenReservation[];
  max_tokens: number;
  max_provider_turns: number;
  max_equiv_usd: number;
  shard: { date: string; count: number } | null;
}

export async function loadEvalConfig(env: NodeJS.ProcessEnv = process.env): Promise<EvalCliConfigV1> {
  if (env["CORMIDIA_EVAL"] !== "1")
    throw new Error("eval refused: CORMIDIA_EVAL=1 is required; an absent campaign is incomplete, never pass");
  const configured = env["CORMIDIA_EVAL_CONFIG"];
  if (configured === undefined || !isAbsolute(configured))
    throw new Error("eval refused: CORMIDIA_EVAL_CONFIG must be an absolute reviewed config path");
  const value: unknown = JSON.parse(await readFile(resolve(configured), "utf8"));
  validate(value);
  return value;
}

function validate(value: unknown): asserts value is EvalCliConfigV1 {
  const root = object(value, "eval config");
  exact(root, [
    "schema_version",
    "campaign_id",
    "human_authorization",
    "state_home",
    "policy_path",
    "commit",
    "app",
    "golden_set_files",
    "tuples",
    "case_token_reservations",
    "max_tokens",
    "max_provider_turns",
    "max_equiv_usd",
    "shard",
  ]);
  if (root["schema_version"] !== 1) throw new Error("eval config schema_version must be 1");
  required(root["campaign_id"], "campaign_id");
  required(root["app"], "app");
  for (const name of ["state_home", "policy_path"] as const)
    if (!isAbsolute(required(root[name], name))) throw new Error(`${name} must be absolute`);
  if (!/^[a-f0-9]{40}$/.test(required(root["commit"], "commit"))) throw new Error("eval commit must be an exact oid");
  const auth = object(root["human_authorization"], "human_authorization");
  exact(auth, ["human_initiated", "authorized_by", "authorized_at", "purpose"]);
  if (auth["human_initiated"] !== true) throw new Error("eval config requires explicit human initiation");
  required(auth["authorized_by"], "human_authorization.authorized_by");
  required(auth["purpose"], "human_authorization.purpose");
  instant(auth["authorized_at"], "human_authorization.authorized_at");
  const sets = uniqueStrings(root["golden_set_files"], "golden_set_files");
  if (sets.length === 0 || sets.some((path) => !isAbsolute(path)))
    throw new Error("golden_set_files must be non-empty absolute paths");
  if (!Array.isArray(root["tuples"]) || root["tuples"].length === 0) throw new Error("tuples must be non-empty");
  const ids: string[] = [];
  for (const [index, raw] of root["tuples"].entries()) {
    const tuple = object(raw, `tuples[${index}]`);
    exact(tuple, [
      "id",
      "site",
      "operation",
      "arm",
      "producerTuple",
      "evaluatorTuple",
      "rubricVersion",
      "attemptId",
      "promptInputDigest",
      "rubricDigest",
      "graderDigest",
      "runtime",
      "model",
      "effort",
      "maxCaseCostUsd",
    ]);
    ids.push(required(tuple["id"], `tuples[${index}].id`));
    required(tuple["model"], `tuples[${index}].model`);
    const site = oneOf(tuple["site"], ["reviewer", "planner", "validation-designer"], `tuples[${index}].site`);
    const operation = oneOf(tuple["operation"], ["review", "plan", "validation-design"], `tuples[${index}].operation`);
    const expectedOperation = site === "reviewer" ? "review" : site === "planner" ? "plan" : "validation-design";
    if (operation !== expectedOperation) throw new Error(`tuples[${index}].operation does not match site`);
    oneOf(tuple["arm"], ["bootstrap", "candidate", "baseline"], `tuples[${index}].arm`);
    required(tuple["producerTuple"], `tuples[${index}].producerTuple`);
    required(tuple["evaluatorTuple"], `tuples[${index}].evaluatorTuple`);
    required(tuple["rubricVersion"], `tuples[${index}].rubricVersion`);
    required(tuple["attemptId"], `tuples[${index}].attemptId`);
    for (const field of ["promptInputDigest", "rubricDigest", "graderDigest"] as const)
      if (!/^[a-f0-9]{64}$/.test(required(tuple[field], `tuples[${index}].${field}`)))
        throw new Error(`tuples[${index}].${field} must be lowercase sha256`);
    oneOf(tuple["runtime"], ["claude", "codex", "pi"], `tuples[${index}].runtime`);
    oneOf(tuple["effort"], ["low", "medium", "high", "xhigh", "max"], `tuples[${index}].effort`);
    positive(tuple["maxCaseCostUsd"], `tuples[${index}].maxCaseCostUsd`);
  }
  if (new Set(ids).size !== ids.length) throw new Error("tuple ids must be unique");
  if (!Array.isArray(root["case_token_reservations"]) || root["case_token_reservations"].length === 0)
    throw new Error("case_token_reservations must be non-empty");
  const reservationIds: string[] = [];
  for (const [index, raw] of root["case_token_reservations"].entries()) {
    const reservation = object(raw, `case_token_reservations[${index}]`);
    exact(reservation, ["case_id", "max_output_tokens"]);
    reservationIds.push(required(reservation["case_id"], `case_token_reservations[${index}].case_id`));
    positiveInteger(reservation["max_output_tokens"], `case_token_reservations[${index}].max_output_tokens`);
  }
  if (new Set(reservationIds).size !== reservationIds.length)
    throw new Error("case_token_reservations case_id rows must be unique");
  positiveInteger(root["max_tokens"], "max_tokens");
  positiveInteger(root["max_provider_turns"], "max_provider_turns");
  positive(root["max_equiv_usd"], "max_equiv_usd");
  if (root["shard"] !== null) {
    const shard = object(root["shard"], "shard");
    exact(shard, ["date", "count"]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(required(shard["date"], "shard.date")))
      throw new Error("shard.date must be YYYY-MM-DD");
    positiveInteger(shard["count"], "shard.count");
  }
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]): void {
  const allowed = new Set(keys);
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length > 0) throw new Error(`unknown eval config field(s): ${extra.join(", ")}`);
}
function required(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be non-empty`);
  return value;
}
function instant(value: unknown, name: string): string {
  const out = required(value, name);
  if (!Number.isFinite(Date.parse(out))) throw new Error(`${name} must be an instant`);
  return out;
}
function positive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}
function positiveInteger(value: unknown, name: string): number {
  const out = positive(value, name);
  if (!Number.isInteger(out)) throw new Error(`${name} must be an integer`);
  return out;
}
function uniqueStrings(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item === "") ||
    new Set(value).size !== value.length
  )
    throw new Error(`${name} must be a unique string array`);
  return value as string[];
}
function oneOf<const T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new Error(`${name} must be one of ${allowed.join(", ")}`);
  return value as T;
}
