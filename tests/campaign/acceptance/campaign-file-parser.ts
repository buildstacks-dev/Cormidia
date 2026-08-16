import { validateTurnAssignment } from "../../../src/runtime/assignment.js";
import type { AcceptanceCampaignFile } from "./campaign-cli.js";

export function assertAcceptanceCampaignFile(value: unknown): asserts value is AcceptanceCampaignFile {
  const root = object(value, "campaign file");
  closed(root, ["schema_version", "campaign"], ["authorization"], "campaign file");
  if (root["schema_version"] !== 1) throw new Error("campaign file schema_version must be 1");
  validateCampaign(root["campaign"]);
  if (root["authorization"] !== undefined) validateAuthorization(root["authorization"]);
}

function validateCampaign(value: unknown): void {
  const row = object(value, "campaign");
  closed(
    row,
    ["campaignId", "commit", "policyPath", "campaignOrg", "scenarios", "adaptiveAssignments", "graderPlan"],
    ["envelope", "planGate"],
    "campaign",
  );
  for (const field of ["campaignId", "commit", "policyPath", "campaignOrg"]) string(row[field], `campaign.${field}`);
  array(row["scenarios"], "campaign.scenarios").forEach(validateScenario);
  array(row["adaptiveAssignments"], "campaign.adaptiveAssignments").forEach(validateCandidate);
  array(row["graderPlan"], "campaign.graderPlan").forEach(validateGraderPlan);
  if (row["envelope"] !== undefined) validateEnvelope(row["envelope"]);
  if (row["planGate"] !== undefined) validatePlanGate(row["planGate"]);
}

function validateScenario(value: unknown, index: number): void {
  const name = `campaign.scenarios[${index}]`;
  const row = object(value, name);
  closed(row, ["id", "kind", "appSlug", "worktree", "matrix"], ["jobWorkdir", "setup", "previewCommand"], name);
  for (const field of ["id", "appSlug", "worktree"]) string(row[field], `${name}.${field}`);
  oneOf(row["kind"], ["app", "job"], `${name}.kind`);
  if (row["setup"] !== undefined) oneOf(row["setup"], ["new-app", "bootstrap", "job"], `${name}.setup`);
  for (const field of ["jobWorkdir", "previewCommand"])
    if (row[field] !== undefined) string(row[field], `${name}.${field}`);
  for (const [role, assignment] of Object.entries(object(row["matrix"], `${name}.matrix`)))
    validateTurnAssignment(assignment, `${name}.matrix.${role}`);
}

function validateCandidate(value: unknown, index: number): void {
  const name = `campaign.adaptiveAssignments[${index}]`;
  const row = object(value, name);
  closed(
    row,
    ["id", "assignment", "providerFamily", "capabilityRef", "conservativeEstimate"],
    ["qualificationRef", "uncertified"],
    name,
  );
  for (const field of ["id", "providerFamily", "capabilityRef"]) string(row[field], `${name}.${field}`);
  validateTurnAssignment(row["assignment"], `${name}.assignment`);
  finite(row["conservativeEstimate"], `${name}.conservativeEstimate`);
  for (const field of ["qualificationRef", "uncertified"])
    if (row[field] !== undefined) string(row[field], `${name}.${field}`);
}

function validateGraderPlan(value: unknown, index: number): void {
  const name = `campaign.graderPlan[${index}]`;
  const row = object(value, name);
  closed(row, ["axis"], ["scenarioKinds", "scenarioIds", "mechanical", "grader", "readTurnIds"], name);
  string(row["axis"], `${name}.axis`);
  if (row["scenarioKinds"] !== undefined) {
    for (const kind of array(row["scenarioKinds"], `${name}.scenarioKinds`))
      oneOf(kind, ["app", "job"], `${name}.scenarioKinds`);
  }
  for (const field of ["scenarioIds", "readTurnIds"])
    if (row[field] !== undefined) stringArray(row[field], `${name}.${field}`);
  if (row["mechanical"] !== undefined) boolean(row["mechanical"], `${name}.mechanical`);
  if (row["grader"] !== undefined) validateTurnAssignment(row["grader"], `${name}.grader`);
}

function validateEnvelope(value: unknown): void {
  const row = object(value, "campaign.envelope");
  exact(row, ["maxOutputTokens", "maxEquivUsd", "authorization"], "campaign.envelope");
  finite(row["maxOutputTokens"], "campaign.envelope.maxOutputTokens");
  finite(row["maxEquivUsd"], "campaign.envelope.maxEquivUsd");
  string(row["authorization"], "campaign.envelope.authorization");
}

function validatePlanGate(value: unknown): void {
  const row = object(value, "campaign.planGate");
  if (row["kind"] === "human") {
    exact(row, ["kind"], "campaign.planGate");
    return;
  }
  if (row["kind"] === "auto-continue") {
    exact(row, ["kind", "criteria"], "campaign.planGate");
    if (row["criteria"] !== "rubric-6-attempted-on-P-1-and-P-5")
      throw new Error("campaign.planGate.criteria is invalid");
    return;
  }
  throw new Error("campaign.planGate.kind must be human or auto-continue");
}

function validateAuthorization(value: unknown): void {
  const row = object(value, "authorization");
  exact(row, ["authorized_by", "authorized_on", "statement", "max_output_tokens", "max_equiv_usd"], "authorization");
  for (const field of ["authorized_by", "authorized_on", "statement"]) string(row[field], `authorization.${field}`);
  finite(row["max_output_tokens"], "authorization.max_output_tokens");
  finite(row["max_equiv_usd"], "authorization.max_equiv_usd");
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be a mapping`);
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}
function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}
function stringArray(value: unknown, name: string): void {
  for (const item of array(value, name)) string(item, name);
}
function boolean(value: unknown, name: string): void {
  if (typeof value !== "boolean") throw new Error(`${name} must be boolean`);
}
function finite(value: unknown, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be finite`);
}
function oneOf(value: unknown, allowed: readonly string[], name: string): void {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${name} is invalid`);
}
function exact(value: Record<string, unknown>, keys: string[], name: string): void {
  closed(value, keys, [], name);
}
function closed(value: Record<string, unknown>, required: string[], optional: string[], name: string): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !(key in value));
  if (unknown.length > 0 || missing.length > 0)
    throw new Error(`${name} has missing or unknown fields: ${[...missing, ...unknown].sort().join(", ")}`);
}
