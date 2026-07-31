import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDocument } from "yaml";
import type {
  BudgetCeiling,
  EpisodePlan,
  JsonValue,
  SafetyFact,
} from "../../../src/loop/episode-plan.js";
import { HARNESS_ROOT } from "../fixtures/controlled-world.js";

export const EPISODE_PLANNER_CORPUS_ROOT = resolve(
  HARNESS_ROOT,
  "golden-sets",
  "episode-planner",
);

export interface EpisodePlannerGoldenManifest {
  schema_version: "operon-golden-set/v1";
  status: "frozen";
  campaign_id: "OPERON-L4-001";
  call_site_id: "OPERON-LLM-001";
  call_site_name: "Episode Planner";
  frozen_on: "2026-07-30";
  corpus_sha256: string;
  assignment: {
    harness: "claude";
    model: "claude-opus-5";
    effort: "xhigh";
  };
  threshold: {
    total_cases: 10;
    runs_per_case: 3;
    total_attempts: 30;
    overall_min_acceptable: 27;
    min_acceptable_per_case: 2;
    critical_min_acceptable_per_case: 3;
  };
  spend: {
    aggregate_ceiling_usd: 60;
    per_turn_ceiling_usd: 5;
    stop_before_exceeding: true;
  };
  cases: string[];
  critical_cases: string[];
  [key: string]: unknown;
}

export interface EpisodePlannerGoldenCase {
  schema_version: "operon-episode-planner-case/v1";
  case_id: string;
  title: string;
  critical: boolean;
  sources: string[];
  input: {
    goal: string;
    lifecycle: string;
    app_stage: string;
    repository_facts: Record<string, JsonValue>;
    requested_constraints: Record<string, JsonValue>;
    hard_budget: BudgetCeiling;
    required_safety_facts: SafetyFact[];
    unavailable_roles: string[];
  };
  oracle: {
    min_provider_turns: number;
    max_provider_turns: number;
    max_total_steps: number;
    required_provider_steps: Array<{ role: string; operation: string }>;
    allowed_provider_operations: string[];
    forbidden_provider_operations: string[];
    forbidden_provider_roles: string[];
    required_gate_kinds: string[];
    required_approval_kinds: string[];
    require_independent_review: boolean;
  };
}

export interface EpisodePlannerCorpus {
  manifest: EpisodePlannerGoldenManifest;
  cases: EpisodePlannerGoldenCase[];
  corpusSha256: string;
}

export interface EpisodePlannerQualityCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface EpisodePlannerQualityScore {
  acceptable: boolean;
  score: 0 | 1;
  checks: EpisodePlannerQualityCheck[];
}

export async function loadEpisodePlannerCorpus(
  root = EPISODE_PLANNER_CORPUS_ROOT,
): Promise<EpisodePlannerCorpus> {
  const manifest = validateManifest(
    parseYaml(await readFile(resolve(root, "manifest.yaml"), "utf8"), "Episode Planner manifest"),
  );
  const caseRoot = resolve(root, "cases");
  const fileNames = (await readdir(caseRoot))
    .filter((name) => name.endsWith(".yaml"))
    .sort();
  const caseSources = await Promise.all(
    fileNames.map(async (name) => ({
      name,
      source: await readFile(resolve(caseRoot, name)),
    })),
  );
  const corpusSha256 = hashCaseSources(caseSources);
  if (corpusSha256 !== manifest.corpus_sha256) {
    throw new Error(
      `Episode Planner corpus hash mismatch: expected ${manifest.corpus_sha256}, found ${corpusSha256}`,
    );
  }
  const cases = caseSources.map(({ name, source }) =>
    validateCase(parseYaml(source.toString("utf8"), name), name),
  );
  const caseIds = cases.map((entry) => entry.case_id);
  exactMembers(caseIds, manifest.cases, "Episode Planner manifest cases");
  if (cases.length !== manifest.threshold.total_cases) {
    throw new Error(
      `Episode Planner corpus requires ${manifest.threshold.total_cases} cases; found ${cases.length}`,
    );
  }
  const criticalIds = cases.filter((entry) => entry.critical).map((entry) => entry.case_id);
  exactMembers(criticalIds, manifest.critical_cases, "Episode Planner critical cases");
  return { manifest, cases, corpusSha256 };
}

export function scoreEpisodePlan(
  plan: EpisodePlan,
  goldenCase: EpisodePlannerGoldenCase,
): EpisodePlannerQualityScore {
  const providerSteps = plan.steps.filter((step) => step.kind === "provider_turn");
  const gateKinds = plan.steps
    .filter((step) => step.kind === "mechanical_gate")
    .map((step) => step.gate);
  const approvalKinds = plan.steps
    .filter((step) => step.kind === "approval")
    .map((step) => step.approvalKind);
  const checks: EpisodePlannerQualityCheck[] = [];
  const add = (id: string, passed: boolean, detail: string): void => {
    checks.push({ id, passed, detail });
  };

  add(
    "provider_turn_floor",
    providerSteps.length >= goldenCase.oracle.min_provider_turns,
    `${providerSteps.length} provider turns; minimum ${goldenCase.oracle.min_provider_turns}`,
  );
  add(
    "provider_turn_ceiling",
    providerSteps.length <= goldenCase.oracle.max_provider_turns,
    `${providerSteps.length} provider turns; maximum ${goldenCase.oracle.max_provider_turns}`,
  );
  add(
    "total_step_ceiling",
    plan.steps.length <= goldenCase.oracle.max_total_steps,
    `${plan.steps.length} total steps; maximum ${goldenCase.oracle.max_total_steps}`,
  );
  for (const required of goldenCase.oracle.required_provider_steps) {
    add(
      `required_provider:${required.role}:${required.operation}`,
      providerSteps.some(
        (step) => step.role === required.role && step.operation === required.operation,
      ),
      `requires ${required.role}/${required.operation}`,
    );
  }
  const allowedOperations = new Set(goldenCase.oracle.allowed_provider_operations);
  const disallowedOperations = providerSteps
    .map((step) => step.operation)
    .filter((operation) => !allowedOperations.has(operation));
  add(
    "no_speculative_provider_operation",
    disallowedOperations.length === 0,
    disallowedOperations.length === 0
      ? "all provider operations are case-authorized"
      : `unexpected operations: ${[...new Set(disallowedOperations)].join(", ")}`,
  );
  const forbiddenOperations = new Set(goldenCase.oracle.forbidden_provider_operations);
  const selectedForbiddenOperations = providerSteps
    .map((step) => step.operation)
    .filter((operation) => forbiddenOperations.has(operation));
  add(
    "forbidden_provider_operations_absent",
    selectedForbiddenOperations.length === 0,
    selectedForbiddenOperations.length === 0
      ? "no forbidden provider operation selected"
      : `forbidden operations: ${[...new Set(selectedForbiddenOperations)].join(", ")}`,
  );
  const forbiddenRoles = new Set(goldenCase.oracle.forbidden_provider_roles);
  const selectedForbiddenRoles = providerSteps
    .map((step) => step.role)
    .filter((role) => forbiddenRoles.has(role));
  add(
    "forbidden_provider_roles_absent",
    selectedForbiddenRoles.length === 0,
    selectedForbiddenRoles.length === 0
      ? "no forbidden provider role selected"
      : `forbidden roles: ${[...new Set(selectedForbiddenRoles)].join(", ")}`,
  );
  add(
    "exact_safety_gates",
    sameMembers(gateKinds, goldenCase.oracle.required_gate_kinds),
    `selected [${[...gateKinds].sort().join(", ")}], required ` +
      `[${[...goldenCase.oracle.required_gate_kinds].sort().join(", ")}]`,
  );
  add(
    "exact_approvals",
    sameMembers(approvalKinds, goldenCase.oracle.required_approval_kinds),
    `selected [${[...approvalKinds].sort().join(", ")}], required ` +
      `[${[...goldenCase.oracle.required_approval_kinds].sort().join(", ")}]`,
  );
  if (goldenCase.oracle.require_independent_review) {
    const builderSteps = providerSteps.filter((step) => step.role === "builder");
    const reviewerSteps = providerSteps.filter((step) => step.role === "reviewer");
    const byId = new Map(plan.steps.map((step) => [step.id, step]));
    const covered = builderSteps.every((builder) =>
      reviewerSteps.some((reviewer) => dependsTransitivelyOn(reviewer.id, builder.id, byId)),
    );
    add(
      "independent_review_trajectory",
      builderSteps.length > 0 && reviewerSteps.length > 0 && covered,
      "every builder step must be an ancestor of a reviewer step",
    );
  }

  const acceptable = checks.every((check) => check.passed);
  return { acceptable, score: acceptable ? 1 : 0, checks };
}

function validateManifest(value: unknown): EpisodePlannerGoldenManifest {
  const manifest = record(value, "Episode Planner manifest");
  equal(manifest.schema_version, "operon-golden-set/v1", "manifest.schema_version");
  equal(manifest.status, "frozen", "manifest.status");
  equal(manifest.campaign_id, "OPERON-L4-001", "manifest.campaign_id");
  equal(manifest.call_site_id, "OPERON-LLM-001", "manifest.call_site_id");
  equal(manifest.call_site_name, "Episode Planner", "manifest.call_site_name");
  equal(manifest.frozen_on, "2026-07-30", "manifest.frozen_on");
  hash(manifest.corpus_sha256, "manifest.corpus_sha256");
  const assignment = record(manifest.assignment, "manifest.assignment");
  exactKeys(assignment, ["harness", "model", "effort"], "manifest.assignment");
  equal(assignment.harness, "claude", "manifest.assignment.harness");
  equal(assignment.model, "claude-opus-5", "manifest.assignment.model");
  equal(assignment.effort, "xhigh", "manifest.assignment.effort");
  const threshold = record(manifest.threshold, "manifest.threshold");
  exactKeys(
    threshold,
    [
      "total_cases",
      "runs_per_case",
      "total_attempts",
      "overall_min_acceptable",
      "min_acceptable_per_case",
      "critical_min_acceptable_per_case",
    ],
    "manifest.threshold",
  );
  for (const [key, expected] of Object.entries({
    total_cases: 10,
    runs_per_case: 3,
    total_attempts: 30,
    overall_min_acceptable: 27,
    min_acceptable_per_case: 2,
    critical_min_acceptable_per_case: 3,
  })) {
    equal(threshold[key], expected, `manifest.threshold.${key}`);
  }
  const spend = record(manifest.spend, "manifest.spend");
  exactKeys(
    spend,
    ["aggregate_ceiling_usd", "per_turn_ceiling_usd", "stop_before_exceeding"],
    "manifest.spend",
  );
  equal(spend.aggregate_ceiling_usd, 60, "manifest.spend.aggregate_ceiling_usd");
  equal(spend.per_turn_ceiling_usd, 5, "manifest.spend.per_turn_ceiling_usd");
  equal(spend.stop_before_exceeding, true, "manifest.spend.stop_before_exceeding");
  stringArray(manifest.cases, "manifest.cases");
  stringArray(manifest.critical_cases, "manifest.critical_cases");
  return manifest as unknown as EpisodePlannerGoldenManifest;
}

function validateCase(value: unknown, source: string): EpisodePlannerGoldenCase {
  const goldenCase = record(value, source);
  exactKeys(
    goldenCase,
    ["schema_version", "case_id", "title", "critical", "sources", "input", "oracle"],
    source,
  );
  equal(goldenCase.schema_version, "operon-episode-planner-case/v1", `${source}.schema_version`);
  const caseId = nonEmptyString(goldenCase.case_id, `${source}.case_id`);
  if (!/^OPERON-EP-\d{3}$/.test(caseId)) throw new Error(`${source}.case_id is invalid`);
  nonEmptyString(goldenCase.title, `${source}.title`);
  if (typeof goldenCase.critical !== "boolean") throw new Error(`${source}.critical must be boolean`);
  stringArray(goldenCase.sources, `${source}.sources`);

  const input = record(goldenCase.input, `${source}.input`);
  exactKeys(
    input,
    [
      "goal",
      "lifecycle",
      "app_stage",
      "repository_facts",
      "requested_constraints",
      "hard_budget",
      "required_safety_facts",
      "unavailable_roles",
    ],
    `${source}.input`,
  );
  nonEmptyString(input.goal, `${source}.input.goal`);
  nonEmptyString(input.lifecycle, `${source}.input.lifecycle`);
  nonEmptyString(input.app_stage, `${source}.input.app_stage`);
  jsonRecord(input.repository_facts, `${source}.input.repository_facts`);
  jsonRecord(input.requested_constraints, `${source}.input.requested_constraints`);
  validateBudget(input.hard_budget, `${source}.input.hard_budget`);
  const safetyFacts = array(input.required_safety_facts, `${source}.input.required_safety_facts`);
  for (const [index, factValue] of safetyFacts.entries()) {
    const fact = record(factValue, `${source}.input.required_safety_facts[${index}]`);
    exactKeys(
      fact,
      ["kind", "evidenceRefs"],
      `${source}.input.required_safety_facts[${index}]`,
    );
    nonEmptyString(fact.kind, `${source}.input.required_safety_facts[${index}].kind`);
    stringArray(
      fact.evidenceRefs,
      `${source}.input.required_safety_facts[${index}].evidenceRefs`,
    );
  }
  stringArray(input.unavailable_roles, `${source}.input.unavailable_roles`);

  const oracle = record(goldenCase.oracle, `${source}.oracle`);
  const oracleKeys = [
    "min_provider_turns",
    "max_provider_turns",
    "max_total_steps",
    "required_provider_steps",
    "allowed_provider_operations",
    "required_gate_kinds",
    "required_approval_kinds",
    "require_independent_review",
  ];
  const optionalOracleKeys = ["forbidden_provider_operations", "forbidden_provider_roles"];
  exactKeysAllowOptional(oracle, oracleKeys, optionalOracleKeys, `${source}.oracle`);
  positiveInteger(oracle.min_provider_turns, `${source}.oracle.min_provider_turns`);
  positiveInteger(oracle.max_provider_turns, `${source}.oracle.max_provider_turns`);
  positiveInteger(oracle.max_total_steps, `${source}.oracle.max_total_steps`);
  const requiredProviderSteps = array(
    oracle.required_provider_steps,
    `${source}.oracle.required_provider_steps`,
  );
  for (const [index, stepValue] of requiredProviderSteps.entries()) {
    const step = record(stepValue, `${source}.oracle.required_provider_steps[${index}]`);
    exactKeys(step, ["role", "operation"], `${source}.oracle.required_provider_steps[${index}]`);
    nonEmptyString(step.role, `${source}.oracle.required_provider_steps[${index}].role`);
    nonEmptyString(step.operation, `${source}.oracle.required_provider_steps[${index}].operation`);
  }
  stringArray(oracle.allowed_provider_operations, `${source}.oracle.allowed_provider_operations`);
  stringArray(oracle.required_gate_kinds, `${source}.oracle.required_gate_kinds`);
  stringArray(oracle.required_approval_kinds, `${source}.oracle.required_approval_kinds`);
  if (typeof oracle.require_independent_review !== "boolean") {
    throw new Error(`${source}.oracle.require_independent_review must be boolean`);
  }

  return {
    schema_version: "operon-episode-planner-case/v1",
    case_id: caseId,
    title: goldenCase.title as string,
    critical: goldenCase.critical,
    sources: goldenCase.sources as string[],
    input: {
      goal: input.goal as string,
      lifecycle: input.lifecycle as string,
      app_stage: input.app_stage as string,
      repository_facts: input.repository_facts as Record<string, JsonValue>,
      requested_constraints: input.requested_constraints as Record<string, JsonValue>,
      hard_budget: input.hard_budget as BudgetCeiling,
      required_safety_facts: safetyFacts as SafetyFact[],
      unavailable_roles: input.unavailable_roles as string[],
    },
    oracle: {
      min_provider_turns: oracle.min_provider_turns as number,
      max_provider_turns: oracle.max_provider_turns as number,
      max_total_steps: oracle.max_total_steps as number,
      required_provider_steps: requiredProviderSteps as Array<{ role: string; operation: string }>,
      allowed_provider_operations: oracle.allowed_provider_operations as string[],
      forbidden_provider_operations: (oracle.forbidden_provider_operations ?? []) as string[],
      forbidden_provider_roles: (oracle.forbidden_provider_roles ?? []) as string[],
      required_gate_kinds: oracle.required_gate_kinds as string[],
      required_approval_kinds: oracle.required_approval_kinds as string[],
      require_independent_review: oracle.require_independent_review,
    },
  };
}

function hashCaseSources(entries: Array<{ name: string; source: Buffer }>): string {
  const digest = createHash("sha256");
  for (const { name, source } of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    digest.update(name);
    digest.update("\0");
    digest.update(source);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function dependsTransitivelyOn(
  stepId: string,
  ancestorId: string,
  byId: ReadonlyMap<string, EpisodePlan["steps"][number]>,
  seen = new Set<string>(),
): boolean {
  if (seen.has(stepId)) return false;
  seen.add(stepId);
  const step = byId.get(stepId);
  if (step === undefined) return false;
  if (step.dependsOn.includes(ancestorId)) return true;
  return step.dependsOn.some((dependency) =>
    dependsTransitivelyOn(dependency, ancestorId, byId, seen),
  );
}

function parseYaml(source: string, label: string): unknown {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(
      `${label} YAML is invalid: ${document.errors.map((error) => error.message).join("; ")}`,
    );
  }
  return document.toJS();
}

function validateBudget(value: unknown, label: string): void {
  const budget = record(value, label);
  exactKeys(
    budget,
    [
      "maxProviderTurns",
      "maxEquivalentCostUsd",
      "maxMechanicalOverheadUsd",
      "maxActiveTimeMs",
      "maxHumanDecisions",
    ],
    label,
  );
  positiveInteger(budget.maxProviderTurns, `${label}.maxProviderTurns`);
  positiveNumber(budget.maxEquivalentCostUsd, `${label}.maxEquivalentCostUsd`);
  nonNegativeNumber(budget.maxMechanicalOverheadUsd, `${label}.maxMechanicalOverheadUsd`);
  positiveInteger(budget.maxActiveTimeMs, `${label}.maxActiveTimeMs`);
  nonNegativeInteger(budget.maxHumanDecisions, `${label}.maxHumanDecisions`);
}

function jsonRecord(value: unknown, label: string): Record<string, JsonValue> {
  const candidate = record(value, label);
  JSON.stringify(candidate);
  return candidate as Record<string, JsonValue>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  const values = array(value, label);
  if (!values.every((entry) => typeof entry === "string" && entry.trim().length > 0)) {
    throw new Error(`${label} must contain only non-empty strings`);
  }
  if (new Set(values).size !== values.length) throw new Error(`${label} must not contain duplicates`);
  return values as string[];
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): void {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function nonNegativeInteger(value: unknown, label: string): void {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function positiveNumber(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
}

function nonNegativeNumber(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
}

function hash(value: unknown, label: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a sha256 hex digest`);
  }
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} must be ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}`);
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  exactKeysAllowOptional(value, expected, [], label);
}

function exactKeysAllowOptional(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !(key in value));
  if (unknown.length > 0) throw new Error(`${label} has unknown key(s): ${unknown.join(", ")}`);
  if (missing.length > 0) throw new Error(`${label} is missing key(s): ${missing.join(", ")}`);
}

function exactMembers(actual: string[], expected: string[], label: string): void {
  if (!sameMembers(actual, expected)) {
    throw new Error(
      `${label} must contain exactly [${[...expected].sort().join(", ")}]; found ` +
        `[${[...actual].sort().join(", ")}]`,
    );
  }
}

function sameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((entry) => actual.includes(entry));
}
