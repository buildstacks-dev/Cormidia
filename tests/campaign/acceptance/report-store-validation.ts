import { validateTurnAssignment } from "../../../src/runtime/assignment.js";
import { parseValidationCampaignPolicyBinding } from "../../../src/org/validation-campaign-policy.js";
import { assertReportWellFormed } from "./campaign-report.js";
import type { ReadableAcceptanceCampaignReport, StoredCampaignReport } from "./report-store.js";

const CAMPAIGN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const UNGRADED_REASONS = [
  "citation-missing",
  "evidence-missing",
  "no-legal-grader",
  "malformed-result",
  "artifact-not-in-read-set",
  "key-leaked",
  "arm-command-failed",
  "reconciliation-open",
  "threshold-unratified",
] as const;

export function assertSafeAcceptanceCampaignId(value: string): void {
  if (!CAMPAIGN_ID.test(value)) throw new Error(`invalid acceptance campaign id: ${value}`);
}

export function parseStoredCampaignReport(value: unknown, expectedCampaignId: string): StoredCampaignReport {
  const root = object(value, "stored campaign report");
  exact(root, ["schema_version", "campaign_id", "config_sha256", "status", "updated_at", "report"]);
  if (root["schema_version"] !== 1) throw new Error("stored campaign report schema_version must be 1");
  const campaignId = string(root["campaign_id"], "campaign_id");
  assertSafeAcceptanceCampaignId(campaignId);
  if (campaignId !== expectedCampaignId) throw new Error("envelope campaign_id does not match requested campaign");
  const configSha256 = string(root["config_sha256"], "config_sha256");
  if (!SHA256.test(configSha256)) throw new Error("config_sha256 must be an exact lowercase sha256");
  const status = oneOf(root["status"], ["running", "final"], "status");
  const updatedAt = instant(root["updated_at"], "updated_at");
  assertReadableReport(root["report"]);
  const report = root["report"];
  if (report.campaign_id !== campaignId) throw new Error("nested report campaign_id does not match its envelope");
  if (report.schema_version === 2) assertReportWellFormed(report);
  return {
    schema_version: 1,
    campaign_id: campaignId,
    config_sha256: configSha256,
    status,
    updated_at: updatedAt,
    report,
  };
}

function assertReadableReport(value: unknown): asserts value is ReadableAcceptanceCampaignReport {
  const report = object(value, "campaign report");
  const schema = report["schema_version"];
  if (schema !== 1 && schema !== 2) throw new Error("unsupported campaign report schema_version");
  exact(report, [
    "schema_version",
    "campaign_id",
    "lane",
    "commit",
    ...(schema === 2 ? ["policy_binding"] : []),
    "provenance",
    "scenarios",
    "verdict",
    "release_signal",
    "rq1_relationship",
    "authorized_scenario_ids",
    "spend",
    "gaps",
  ]);
  assertSafeAcceptanceCampaignId(string(report["campaign_id"], "report.campaign_id"));
  equal(report["lane"], "L-ACC", "report.lane");
  if (!COMMIT.test(string(report["commit"], "report.commit"))) throw new Error("report.commit must be a git oid");
  if (schema === 2) parseValidationCampaignPolicyBinding(report["policy_binding"]);
  validateProvenance(report["provenance"]);
  const scenarioIds = array(report["scenarios"], "report.scenarios").map(validateScenario);
  unique(scenarioIds, "report scenario ids");
  equal(report["verdict"], "inconclusive", "report.verdict");
  equal(report["release_signal"], null, "report.release_signal");
  nonEmpty(report["rq1_relationship"], "report.rq1_relationship");
  const authorizedIds = uniqueStringArray(report["authorized_scenario_ids"], "report.authorized_scenario_ids");
  if (JSON.stringify([...scenarioIds].sort()) !== JSON.stringify([...authorizedIds].sort()))
    throw new Error("attempted scenario ids must exactly equal authorized_scenario_ids");
  validateSpend(report["spend"]);
  array(report["gaps"], "report.gaps").forEach(validateGap);
}

function validateProvenance(value: unknown): void {
  const row = object(value, "report.provenance");
  exact(row, [
    "installedVersion",
    "tarballName",
    "tarballSha256",
    "preflightRanAt",
    "preflightArgv",
    "displacedSourceLinks",
    "restoreCommand",
  ]);
  nonEmpty(row["installedVersion"], "provenance.installedVersion");
  nonEmpty(row["tarballName"], "provenance.tarballName");
  if (!SHA256.test(string(row["tarballSha256"], "provenance.tarballSha256")))
    throw new Error("provenance.tarballSha256 must be a sha256");
  instant(row["preflightRanAt"], "provenance.preflightRanAt");
  stringArray(row["preflightArgv"], "provenance.preflightArgv");
  equal(row["displacedSourceLinks"], true, "provenance.displacedSourceLinks");
  equal(row["restoreCommand"], "pnpm link:local", "provenance.restoreCommand");
}

function validateScenario(value: unknown, index: number): string {
  const name = `report.scenarios[${index}]`;
  const row = object(value, name);
  exact(row, [
    "scenarioId",
    "scenarioKind",
    "matrix",
    "axes",
    "completeness",
    "completenessReasons",
    "planGate",
    "supervisorReconciliationClosed",
    "previewCommand",
  ]);
  const scenarioId = nonEmpty(row["scenarioId"], `${name}.scenarioId`);
  oneOf(row["scenarioKind"], ["app", "job"], `${name}.scenarioKind`);
  for (const [role, assignment] of Object.entries(object(row["matrix"], `${name}.matrix`)))
    validateTurnAssignment(assignment, `${name}.matrix.${role}`);
  const axes = array(row["axes"], `${name}.axes`).map((axis, axisIndex) =>
    validateAxis(axis, `${name}.axes[${axisIndex}]`),
  );
  unique(axes, `${name} axis ids`);
  oneOf(row["completeness"], ["complete", "incomplete"], `${name}.completeness`);
  stringArray(row["completenessReasons"], `${name}.completenessReasons`);
  validatePlanGate(row["planGate"], `${name}.planGate`);
  boolean(row["supervisorReconciliationClosed"], `${name}.supervisorReconciliationClosed`);
  nullableString(row["previewCommand"], `${name}.previewCommand`);
  return scenarioId;
}

function validateAxis(value: unknown, name: string): string {
  const row = object(value, name);
  exact(row, [
    "axis",
    "verdict",
    "score",
    "justification",
    "citations",
    "ungradedReason",
    "grader",
    "mechanical",
    "appliedDisjointnessFamilies",
    "appliedReadTurnIds",
  ]);
  const axis = nonEmpty(row["axis"], `${name}.axis`);
  equal(row["verdict"], "inconclusive", `${name}.verdict`);
  const score = row["score"];
  if (score !== 0 && score !== 1 && score !== 2 && score !== 3 && score !== "ungraded")
    throw new Error(`${name}.score is invalid`);
  nullableString(row["justification"], `${name}.justification`);
  stringArray(row["citations"], `${name}.citations`);
  if (row["ungradedReason"] !== null) oneOf(row["ungradedReason"], UNGRADED_REASONS, `${name}.ungradedReason`);
  if (row["grader"] !== null) validateTurnAssignment(row["grader"], `${name}.grader`);
  boolean(row["mechanical"], `${name}.mechanical`);
  stringArray(row["appliedDisjointnessFamilies"], `${name}.appliedDisjointnessFamilies`);
  stringArray(row["appliedReadTurnIds"], `${name}.appliedReadTurnIds`);
  return axis;
}

function validatePlanGate(value: unknown, name: string): void {
  if (value === null) return;
  const row = object(value, name);
  exact(row, ["scenarioId", "applicable", "resolvedBy", "decision", "scores", "reason"]);
  nonEmpty(row["scenarioId"], `${name}.scenarioId`);
  boolean(row["applicable"], `${name}.applicable`);
  oneOf(row["resolvedBy"], ["human", "declared-policy"], `${name}.resolvedBy`);
  oneOf(row["decision"], ["continue", "stop"], `${name}.decision`);
  for (const score of Object.values(object(row["scores"], `${name}.scores`)))
    if (score !== "ungraded" && (typeof score !== "number" || !Number.isFinite(score)))
      throw new Error(`${name}.scores must contain finite numbers or ungraded`);
  string(row["reason"], `${name}.reason`);
}

function validateSpend(value: unknown): void {
  const row = object(value, "report.spend");
  exact(row, [
    "maxOutputTokens",
    "maxEquivUsd",
    "observedOutputTokens",
    "observedEquivUsd",
    "debitedUnknownOutputTokens",
    "debitedUnknownEquivUsd",
    "ceilingExhausted",
    "reservationRefusals",
  ]);
  const values = [
    "maxOutputTokens",
    "maxEquivUsd",
    "observedOutputTokens",
    "observedEquivUsd",
    "debitedUnknownOutputTokens",
    "debitedUnknownEquivUsd",
  ].map((field) => nonnegative(row[field], `report.spend.${field}`));
  const [maxTokens, maxUsd, observedTokens, observedUsd, unknownTokens, unknownUsd] = values;
  if (
    maxTokens === undefined ||
    maxUsd === undefined ||
    observedTokens === undefined ||
    observedUsd === undefined ||
    unknownTokens === undefined ||
    unknownUsd === undefined
  )
    throw new Error("report.spend is incomplete");
  const expectedExhausted = observedTokens + unknownTokens >= maxTokens || observedUsd + unknownUsd >= maxUsd;
  if (boolean(row["ceilingExhausted"], "report.spend.ceilingExhausted") !== expectedExhausted)
    throw new Error("report.spend.ceilingExhausted does not match recorded exposure");
  stringArray(row["reservationRefusals"], "report.spend.reservationRefusals");
}

function validateGap(value: unknown, index: number): void {
  const row = object(value, `report.gaps[${index}]`);
  exact(row, ["scenarioId", "axis", "reason"]);
  nonEmpty(row["scenarioId"], `report.gaps[${index}].scenarioId`);
  nonEmpty(row["axis"], `report.gaps[${index}].axis`);
  nonEmpty(row["reason"], `report.gaps[${index}].reason`);
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error("stored report has missing or unknown fields");
}
function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}
function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}
function nonEmpty(value: unknown, name: string): string {
  const parsed = string(value, name);
  if (parsed.trim() === "") throw new Error(`${name} must not be blank`);
  return parsed;
}
function stringArray(value: unknown, name: string): string[] {
  const parsed = array(value, name);
  if (!parsed.every((item) => typeof item === "string")) throw new Error(`${name} must contain strings`);
  return parsed;
}
function uniqueStringArray(value: unknown, name: string): string[] {
  const parsed = stringArray(value, name);
  for (const item of parsed) if (item.trim() === "") throw new Error(`${name} must contain nonempty ids`);
  unique(parsed, name);
  return parsed;
}
function unique(values: string[], name: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${name} must be unique`);
}
function oneOf<const T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (typeof value !== "string") throw new Error(`${name} is invalid`);
  const matched = values.find((candidate) => candidate === value);
  if (matched === undefined) throw new Error(`${name} is invalid`);
  return matched;
}
function equal(value: unknown, expected: unknown, name: string): void {
  if (value !== expected) throw new Error(`${name} is invalid`);
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be boolean`);
  return value;
}
function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}
function nonnegative(value: unknown, name: string): number {
  const parsed = finite(value, name);
  if (parsed < 0) throw new Error(`${name} must be nonnegative`);
  return parsed;
}
function nullableString(value: unknown, name: string): void {
  if (value !== null) string(value, name);
}
function instant(value: unknown, name: string): string {
  const parsed = string(value, name);
  if (Number.isNaN(Date.parse(parsed)) || new Date(parsed).toISOString() !== parsed)
    throw new Error(`${name} is invalid`);
  return parsed;
}
