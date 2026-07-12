import { createHash } from "node:crypto";
import { mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, closeSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse } from "yaml";

export const ATTEMPT_OUTCOMES = [
  "passed",
  "product_miss",
  "safety_stop",
  "budget_stop",
  "infra_invalid",
  "harness_error",
  "not_run",
] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

export const CAMPAIGN_OUTCOMES = [
  "qualified",
  "not_qualified",
  "invalid",
  "incomplete",
] as const;
export type CampaignOutcome = (typeof CAMPAIGN_OUTCOMES)[number];

export interface EvalCaseManifest {
  schema_version: 1;
  case_id: string;
  requirements: string[];
  app: { template: string; seed_ref: string };
  episode: { kind: string; task_ref: string };
  route: { expected: "mechanical" | "quick" | "standard" | "deep"; factors: Record<string, unknown> };
  oracle: { visible_commands: string[]; hidden_grader: string; required_artifacts: string[] };
  side_effect_policy: Record<string, string>;
  faults: string[];
  budgets_ref: string;
  repetitions: number;
}

export interface CampaignManifest {
  schema_version: 1;
  campaign_id: string;
  purpose: string;
  owner: string;
  created_at: string;
  intent: "qualification" | "non_qualification";
  candidate: { commit: string; package_sha256: string; suite_sha256: string };
  org_fingerprint: string;
  system_fingerprint: string;
  cases: Array<{ case_id: string; repetition_ids: string[] }>;
  assignments: Array<{ role: string; runtime: string; model: string; effort: string; capability_ref: string }>;
  price_catalog_id: string;
  randomization_seed: string;
  github: { owner: string; repo_pattern: string };
  spend: { campaign_max_usd: number; case_max_usd: Record<string, number> };
  infrastructure_retries: number;
  exclusions: string[];
  stop_rules: string[];
  operator_fixture: string;
  evidence_dir: string;
}

export interface AttemptResult {
  schema_version: 1;
  campaign_id: string;
  campaign_sha256: string;
  attempt_id: string;
  case_id: string;
  repetition_id: string;
  outcome: AttemptOutcome;
  admitted_at: string | null;
  terminal_at: string | null;
  evidence: string[];
  metrics: Record<string, unknown>;
  exclusions: string[];
  missing: string[];
  retry_of?: string;
}

export interface ContractRecord {
  id: string;
  requirement: string;
  state: "required" | "known_red";
  expected_failure?: string;
  workstream: string;
  phase: string;
  evidence: string;
  promotion: string;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashManifest(value: unknown): string {
  return `sha256:${sha256(canonicalJson(value))}`;
}

export function hashFile(path: string): string {
  return sha256(readFileSync(path));
}

export function hashTree(root: string): string {
  const entries: string[] = [];
  visit(root, "");
  return `sha256:${sha256(entries.join("\n"))}`;

  function visit(dir: string, prefix: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`tree_symlink_forbidden: ${rel}`);
      if (entry.isDirectory()) visit(path, rel);
      else if (entry.isFile()) entries.push(`${rel}\0${statSync(path).mode & 0o111 ? "x" : "-"}\0${sha256(readFileSync(path))}`);
      else throw new Error(`tree_special_file_forbidden: ${rel}`);
    }
  }
}

export function loadYamlFile(path: string): unknown {
  return parse(readFileSync(path, "utf8"));
}

export function validateCase(value: unknown): string[] {
  const errors = objectErrors(value, "case");
  if (errors.length > 0) return errors;
  const v = value as Record<string, unknown>;
  exactVersion(v, errors);
  stringField(v, "case_id", errors);
  stringArray(v, "requirements", errors, true);
  positiveInteger(v, "repetitions", errors);
  objectField(v, "app", errors);
  objectField(v, "episode", errors);
  objectField(v, "route", errors);
  objectField(v, "oracle", errors);
  objectField(v, "side_effect_policy", errors);
  stringArray(v, "faults", errors, false);
  stringField(v, "budgets_ref", errors);
  const app = record(v.app);
  if (app) {
    stringField(app, "template", errors, "app");
    digestField(app, "seed_ref", errors, "app");
  }
  const episode = record(v.episode);
  if (episode) {
    stringField(episode, "kind", errors, "episode");
    safeRelativeField(episode, "task_ref", errors, "episode");
  }
  const route = record(v.route);
  if (route) {
    enumField(route, "expected", ["mechanical", "quick", "standard", "deep"], errors, "route");
    objectField(route, "factors", errors, "route");
  }
  const oracle = record(v.oracle);
  if (oracle) {
    stringArray(oracle, "visible_commands", errors, false, "oracle");
    safeRelativeField(oracle, "hidden_grader", errors, "oracle");
    stringArray(oracle, "required_artifacts", errors, true, "oracle");
  }
  return errors;
}

export function validateCampaign(value: unknown): string[] {
  const errors = objectErrors(value, "campaign");
  if (errors.length > 0) return errors;
  const v = value as Record<string, unknown>;
  exactVersion(v, errors);
  for (const field of ["campaign_id", "purpose", "owner", "price_catalog_id", "randomization_seed", "operator_fixture"]) {
    stringField(v, field, errors);
  }
  digestField(v, "org_fingerprint", errors);
  digestField(v, "system_fingerprint", errors);
  safeRelativeField(v, "evidence_dir", errors);
  isoDateField(v, "created_at", errors);
  enumField(v, "intent", ["qualification", "non_qualification"], errors);
  objectField(v, "candidate", errors);
  arrayField(v, "cases", errors, true);
  arrayField(v, "assignments", errors, true);
  objectField(v, "github", errors);
  objectField(v, "spend", errors);
  nonNegativeInteger(v, "infrastructure_retries", errors);
  stringArray(v, "exclusions", errors, false);
  stringArray(v, "stop_rules", errors, true);
  const candidate = record(v.candidate);
  if (candidate) {
    stringField(candidate, "commit", errors, "candidate");
    digestField(candidate, "package_sha256", errors, "candidate");
    digestField(candidate, "suite_sha256", errors, "candidate");
  }
  const github = record(v.github);
  if (github) {
    stringField(github, "owner", errors, "github");
    const pattern = github.repo_pattern;
    if (typeof pattern !== "string" || !pattern.startsWith("operon-eval-") || pattern.includes("..")) {
      errors.push("github.repo_pattern must begin operon-eval- and contain no traversal");
    }
  }
  const spend = record(v.spend);
  if (spend) {
    positiveNumber(spend, "campaign_max_usd", errors, "spend");
    objectField(spend, "case_max_usd", errors, "spend");
  }
  const cases = Array.isArray(v.cases) ? v.cases : [];
  const repetitionKeys = new Set<string>();
  for (const [index, raw] of cases.entries()) {
    const item = record(raw); if (!item) { errors.push(`cases[${index}] must be an object`); continue; }
    stringField(item, "case_id", errors, `cases[${index}]`); stringArray(item, "repetition_ids", errors, true, `cases[${index}]`);
    if (typeof item.case_id === "string" && Array.isArray(item.repetition_ids)) for (const repetition of item.repetition_ids) {
      const key = `${item.case_id}::${String(repetition)}`; if (repetitionKeys.has(key)) errors.push(`duplicate campaign repetition ${key}`); repetitionKeys.add(key);
    }
  }
  const assignments = Array.isArray(v.assignments) ? v.assignments : [];
  const assignedRoles = new Set<string>();
  for (const [index, raw] of assignments.entries()) {
    const item = record(raw); if (!item) { errors.push(`assignments[${index}] must be an object`); continue; }
    for (const field of ["role", "runtime", "model", "effort", "capability_ref"]) stringField(item, field, errors, `assignments[${index}]`);
    if (typeof item.role === "string") { if (assignedRoles.has(item.role)) errors.push(`duplicate assignment role ${item.role}`); assignedRoles.add(item.role); }
  }
  if (spend) {
    const caseCaps = record(spend.case_max_usd);
    if (caseCaps) for (const raw of cases) { const item = record(raw); if (item && typeof item.case_id === "string" && (typeof caseCaps[item.case_id] !== "number" || (caseCaps[item.case_id] as number) <= 0)) errors.push(`spend.case_max_usd missing positive cap for ${item.case_id}`); }
  }
  return errors;
}

export function validateResult(value: unknown): string[] {
  const errors = objectErrors(value, "result");
  if (errors.length > 0) return errors;
  const v = value as Record<string, unknown>;
  exactVersion(v, errors);
  for (const field of ["campaign_id", "attempt_id", "case_id", "repetition_id"]) stringField(v, field, errors);
  digestField(v, "campaign_sha256", errors);
  enumField(v, "outcome", [...ATTEMPT_OUTCOMES], errors);
  nullableIsoDateField(v, "admitted_at", errors);
  nullableIsoDateField(v, "terminal_at", errors);
  stringArray(v, "evidence", errors, false);
  objectField(v, "metrics", errors);
  stringArray(v, "exclusions", errors, false);
  stringArray(v, "missing", errors, false);
  if (v.retry_of !== undefined && typeof v.retry_of !== "string") errors.push("retry_of must be a string");
  if (v.outcome === "passed" && Array.isArray(v.missing) && v.missing.length > 0) {
    errors.push("passed result cannot contain missing measurements");
  }
  if (v.outcome !== "not_run" && v.admitted_at === null) errors.push("admitted attempt requires admitted_at");
  return errors;
}

export function validateContracts(value: unknown): string[] {
  const root = record(value);
  if (!root) return ["contracts must be an object"];
  const errors: string[] = [];
  exactVersion(root, errors);
  const contracts = root.contracts;
  if (!Array.isArray(contracts) || contracts.length === 0) return [...errors, "contracts must be a non-empty array"];
  const ids = new Set<string>();
  for (const [index, raw] of contracts.entries()) {
    const item = record(raw);
    if (!item) { errors.push(`contracts[${index}] must be an object`); continue; }
    for (const field of ["id", "requirement", "workstream", "phase", "evidence", "promotion"]) stringField(item, field, errors, `contracts[${index}]`);
    enumField(item, "state", ["required", "known_red"], errors, `contracts[${index}]`);
    const id = item.id;
    if (typeof id === "string") {
      if (ids.has(id)) errors.push(`duplicate contract id ${id}`);
      ids.add(id);
    }
    if (item.state === "known_red" && typeof item.expected_failure !== "string") {
      errors.push(`contracts[${index}].expected_failure is required for known_red`);
    }
    if (item.state === "required" && item.expected_failure !== undefined) {
      errors.push(`contracts[${index}].expected_failure is forbidden for required`);
    }
  }
  return errors;
}

export interface CampaignLock {
  schema_version: 1;
  campaign_id: string;
  campaign_sha256: string;
  manifest_path: string;
  started_at: string;
}

export function startCampaign(manifestPath: string, lockPath: string, now = new Date()): CampaignLock {
  const manifest = loadYamlFile(manifestPath);
  const errors = validateCampaign(manifest);
  if (errors.length > 0) throw new Error(`invalid_campaign: ${errors.join("; ")}`);
  const campaign = manifest as CampaignManifest;
  const lock: CampaignLock = {
    schema_version: 1,
    campaign_id: campaign.campaign_id,
    campaign_sha256: hashManifest(manifest),
    manifest_path: realpathSync(manifestPath),
    started_at: now.toISOString(),
  };
  writeExclusiveJson(lockPath, lock, "duplicate_campaign");
  return lock;
}

export function verifyCampaignLock(lockPath: string): CampaignLock {
  const lock = JSON.parse(readFileSync(lockPath, "utf8")) as CampaignLock;
  const manifest = loadYamlFile(lock.manifest_path);
  if (hashManifest(manifest) !== lock.campaign_sha256) throw new Error("campaign_mutated_after_start");
  return lock;
}

export function writeAttemptResult(path: string, result: AttemptResult): string {
  const errors = validateResult(result);
  if (errors.length > 0) throw new Error(`invalid_result: ${errors.join("; ")}`);
  writeExclusiveJson(path, result, "duplicate_attempt");
  return hashFile(path);
}

export interface Qualification {
  schema_version: 1;
  campaign_id: string;
  campaign_sha256: string;
  outcome: CampaignOutcome;
  attempts: number;
  attempt_ids: string[];
  counts: Record<AttemptOutcome, number>;
  reasons: string[];
}

export function qualify(campaign: CampaignManifest, campaignSha256: string, results: AttemptResult[]): Qualification {
  const counts = Object.fromEntries(ATTEMPT_OUTCOMES.map((outcome) => [outcome, 0])) as Record<AttemptOutcome, number>;
  const reasons: string[] = [];
  const expected = new Set(campaign.cases.flatMap((item) => item.repetition_ids.map((rep) => `${item.case_id}::${rep}`)));
  const primaryObserved = new Set<string>();
  const attemptIds = new Set<string>();
  for (const result of results) {
    const errors = validateResult(result);
    if (errors.length > 0) reasons.push(`invalid result ${result.attempt_id}: ${errors.join("; ")}`);
    if (result.campaign_id !== campaign.campaign_id || result.campaign_sha256 !== campaignSha256) reasons.push(`foreign result ${result.attempt_id}`);
    const key = `${result.case_id}::${result.repetition_id}`;
    if (attemptIds.has(result.attempt_id)) reasons.push(`duplicate attempt id ${result.attempt_id}`); attemptIds.add(result.attempt_id);
    if (result.retry_of === undefined) {
      if (primaryObserved.has(key)) reasons.push(`duplicate primary repetition ${key}`);
      primaryObserved.add(key);
    }
    counts[result.outcome] += 1;
    if (result.outcome === "harness_error") reasons.push(`${result.attempt_id}: ${result.outcome}`);
    if (result.outcome === "not_run") reasons.push(`${result.attempt_id}: required attempt not_run`);
    if (result.outcome === "product_miss" || result.outcome === "safety_stop" || result.outcome === "budget_stop") reasons.push(`${result.attempt_id}: ${result.outcome}`);
  }
  for (const result of results) if (result.retry_of !== undefined) {
    if (!attemptIds.has(result.retry_of) || result.retry_of === result.attempt_id) reasons.push(`undeclared retry linkage ${result.attempt_id}`);
  }
  const retries = results.filter((result) => result.retry_of !== undefined);
  if (retries.length > campaign.infrastructure_retries) reasons.push(`infrastructure retries ${retries.length} exceed declared ${campaign.infrastructure_retries}`);
  for (const result of results.filter((item) => item.outcome === "infra_invalid")) {
    const replacement = retries.find((item) => item.retry_of === result.attempt_id && item.case_id === result.case_id && item.repetition_id === result.repetition_id);
    if (!replacement) reasons.push(`${result.attempt_id}: unrecovered infrastructure attempt`);
  }
  for (const key of expected) if (!primaryObserved.has(key)) reasons.push(`missing attempt ${key}`);
  const invalid = reasons.some((reason) => reason.includes("invalid result") || reason.includes("foreign") || reason.includes("duplicate") || reason.includes("unrecovered infrastructure") || reason.includes("harness_error") || reason.includes("retry linkage") || reason.includes("retries "));
  const incomplete = !invalid && reasons.some((reason) => reason.includes("missing attempt") || reason.includes("not_run"));
  const miss = counts.product_miss + counts.safety_stop + counts.budget_stop > 0;
  return {
    schema_version: 1,
    campaign_id: campaign.campaign_id,
    campaign_sha256: campaignSha256,
    outcome: invalid ? "invalid" : incomplete ? "incomplete" : miss ? "not_qualified" : "qualified",
    attempts: results.length,
    attempt_ids: results.map((result) => result.attempt_id).sort(),
    counts,
    reasons: reasons.sort(),
  };
}

export interface GraderCalibration<T> {
  graderId: string;
  reference: T;
  mutants: Array<{ id: string; subject: T }>;
  grade(subject: T): boolean;
}

export function calibrateGrader<T>(calibration: GraderCalibration<T>): { grader_id: string; reference_passed: true; rejected_mutants: string[] } {
  if (!calibration.grade(calibration.reference)) throw new Error(`broken_grader: ${calibration.graderId} rejects reference`);
  const accepted = calibration.mutants.filter((mutant) => calibration.grade(mutant.subject)).map((mutant) => mutant.id);
  if (accepted.length > 0) throw new Error(`broken_grader: ${calibration.graderId} accepts mutants ${accepted.join(", ")}`);
  return { grader_id: calibration.graderId, reference_passed: true, rejected_mutants: calibration.mutants.map((mutant) => mutant.id) };
}

export function assertPathContained(root: string, candidate: string, label = "path"): void {
  const rootReal = realpathSync(root);
  const candidateResolved = resolve(candidate);
  const rel = relative(rootReal, candidateResolved);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`production_path_leakage: ${label} resolves outside eval root`);
}

function writeExclusiveJson(path: string, value: unknown, code: string): void {
  mkdirSync(dirname(path), { recursive: true });
  let fd: number;
  try { fd = openSync(path, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(code);
    throw error;
  }
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
  finally { closeSync(fd); }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  const obj = record(value);
  if (!obj) return value;
  return Object.fromEntries(Object.keys(obj).sort().map((key) => [key, sortValue(obj[key])]));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function objectErrors(value: unknown, label: string): string[] { return record(value) ? [] : [`${label} must be an object`]; }
function exactVersion(v: Record<string, unknown>, e: string[]): void { if (v.schema_version !== 1) e.push("schema_version must be 1"); }
function stringField(v: Record<string, unknown>, f: string, e: string[], p = ""): void { if (typeof v[f] !== "string" || (v[f] as string).trim() === "") e.push(`${p ? `${p}.` : ""}${f} must be a non-empty string`); }
function digestField(v: Record<string, unknown>, f: string, e: string[], p = ""): void { if (typeof v[f] !== "string" || !/^sha256:[a-f0-9]{64}$/.test(v[f] as string)) e.push(`${p ? `${p}.` : ""}${f} must be sha256:<64 lowercase hex>`); }
function objectField(v: Record<string, unknown>, f: string, e: string[], p = ""): void { if (!record(v[f])) e.push(`${p ? `${p}.` : ""}${f} must be an object`); }
function arrayField(v: Record<string, unknown>, f: string, e: string[], nonEmpty: boolean): void { if (!Array.isArray(v[f]) || (nonEmpty && (v[f] as unknown[]).length === 0)) e.push(`${f} must be ${nonEmpty ? "a non-empty" : "an"} array`); }
function stringArray(v: Record<string, unknown>, f: string, e: string[], nonEmpty: boolean, p = ""): void { const x = v[f]; if (!Array.isArray(x) || (nonEmpty && x.length === 0) || x.some((i) => typeof i !== "string" || i === "")) e.push(`${p ? `${p}.` : ""}${f} must be ${nonEmpty ? "a non-empty" : "an"} string array`); }
function positiveInteger(v: Record<string, unknown>, f: string, e: string[]): void { if (!Number.isInteger(v[f]) || (v[f] as number) <= 0) e.push(`${f} must be a positive integer`); }
function nonNegativeInteger(v: Record<string, unknown>, f: string, e: string[]): void { if (!Number.isInteger(v[f]) || (v[f] as number) < 0) e.push(`${f} must be a non-negative integer`); }
function positiveNumber(v: Record<string, unknown>, f: string, e: string[], p = ""): void { if (typeof v[f] !== "number" || !Number.isFinite(v[f]) || (v[f] as number) <= 0) e.push(`${p ? `${p}.` : ""}${f} must be a positive number`); }
function enumField(v: Record<string, unknown>, f: string, values: string[], e: string[], p = ""): void { if (typeof v[f] !== "string" || !values.includes(v[f] as string)) e.push(`${p ? `${p}.` : ""}${f} must be one of ${values.join(", ")}`); }
function isoDateField(v: Record<string, unknown>, f: string, e: string[]): void { if (typeof v[f] !== "string" || !Number.isFinite(Date.parse(v[f] as string))) e.push(`${f} must be an ISO date`); }
function nullableIsoDateField(v: Record<string, unknown>, f: string, e: string[]): void { if (v[f] !== null && (typeof v[f] !== "string" || !Number.isFinite(Date.parse(v[f] as string)))) e.push(`${f} must be null or an ISO date`); }
function safeRelativeField(v: Record<string, unknown>, f: string, e: string[], p = ""): void { stringField(v, f, e, p); const x = v[f]; if (typeof x === "string" && (isAbsolute(x) || x.split(/[\\/]/).includes(".."))) e.push(`${p ? `${p}.` : ""}${f} must be a safe relative path`); }
