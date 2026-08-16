// Durable validation-campaign evidence shared by the opt-in L3/L4/L5 runners
// and Cormidia's read-only presentation leaves. The product owns this schema so
// status, Reports, and Observe cannot independently reinterpret an incomplete
// or threshold-inconclusive campaign as green.

import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { toErrorMessage as errorMessage } from "../runtime/error-message.js";
import { writeFileAtomic } from "./atomic.js";
import { parseValidationCampaignPolicyBinding } from "./validation-campaign-policy.js";
import type {
  ValidationCampaignReadResult,
  ValidationCampaignReport,
  ValidationCampaignReportV2,
} from "./validation-campaign-report.js";
import { parseValidationCampaignProfile } from "./validation-campaign-profile.js";
export type { ValidationCampaignReadResult } from "./validation-campaign-report.js";

const CAMPAIGN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function validationCampaignReportPath(stateHome: string, campaignId: string): string {
  assertCampaignId(campaignId);
  return join(resolve(stateHome), "validation", "campaigns", campaignId, "report.json");
}

export async function writeValidationCampaignReport(
  stateHome: string,
  report: ValidationCampaignReportV2,
): Promise<string> {
  validateValidationCampaignReport(report);
  if (report.schema_version !== 2) throw new Error("new campaign reports require bound schema_version 2");
  const path = validationCampaignReportPath(stateHome, report.campaign_id);
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

export async function readValidationCampaignReports(stateHome: string): Promise<ValidationCampaignReadResult> {
  const root = join(resolve(stateHome), "validation", "campaigns");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return { reports: [], corrupt: [] };
    return { reports: [], corrupt: [{ campaign_id: "(directory)", path: root, detail: errorMessage(error) }] };
  }
  const reports: ValidationCampaignReport[] = [];
  const corrupt: ValidationCampaignReadResult["corrupt"] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name, "report.json");
    try {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      validateValidationCampaignReport(value);
      if (value.campaign_id !== entry.name) {
        throw new Error(`campaign_id ${value.campaign_id} does not match directory ${entry.name}`);
      }
      reports.push(value);
    } catch (error) {
      corrupt.push({ campaign_id: entry.name, path, detail: errorMessage(error) });
    }
  }
  reports.sort(
    (left, right) =>
      right.started_at.localeCompare(left.started_at) || left.campaign_id.localeCompare(right.campaign_id),
  );
  return { reports, corrupt };
}

/** Enforce the ratified completeness/verdict truth table at both write and read. */
export function validateValidationCampaignReport(value: unknown): asserts value is ValidationCampaignReport {
  const root = object(value, "campaign report");
  exactKeys(root, [
    "schema_version",
    "campaign_id",
    "lane",
    "campaign_kind",
    "trigger",
    "status",
    "started_at",
    "finished_at",
    "policy",
    "target",
    "spend",
    "coverage",
    "outcome",
    "evidence_refs",
    "profile",
  ]);
  if (root["schema_version"] !== 1 && root["schema_version"] !== 2)
    throw new Error("unsupported campaign schema_version");
  const campaignId = string(root["campaign_id"], "campaign_id");
  assertCampaignId(campaignId);
  oneOf(root["lane"], ["L3", "L4", "L5"], "lane");
  nonEmpty(root["campaign_kind"], "campaign_kind");
  nonEmpty(root["trigger"], "trigger");
  const status = oneOf(root["status"], ["planned", "running", "completed"], "status");
  const startedAt = instant(root["started_at"], "started_at");
  const finishedAt = root["finished_at"] === null ? null : instant(root["finished_at"], "finished_at");
  if (status === "completed" && root["finished_at"] === null)
    throw new Error("completed campaign requires finished_at");
  if (status !== "completed" && root["finished_at"] !== null)
    throw new Error("non-completed campaign cannot have finished_at");
  if (finishedAt !== null && Date.parse(finishedAt) < Date.parse(startedAt))
    throw new Error("finished_at cannot precede started_at");

  if (root["schema_version"] === 2) parseValidationCampaignPolicyBinding(root["policy"]);
  else validateHistoricalPolicy(root["policy"]);

  const target = object(root["target"], "target");
  exactKeys(target, ["commit", "apps", "scopes", "tuples"]);
  if (!/^[a-f0-9]{40}$/.test(nonEmpty(target["commit"], "target.commit")))
    throw new Error("target.commit must be an exact lowercase git oid");
  uniqueStringList(target["apps"], "target.apps");
  stringList(target["scopes"], "target.scopes");
  stringList(target["tuples"], "target.tuples");

  const spend = object(root["spend"], "spend");
  exactKeys(spend, [
    "max_provider_turns",
    "max_equiv_usd",
    "observed_provider_turns",
    "observed_equiv_usd",
    "ceiling_exhausted",
  ]);
  const maxTurns = nonNegativeInteger(spend["max_provider_turns"], "spend.max_provider_turns");
  const maxUsd = nonNegativeNumber(spend["max_equiv_usd"], "spend.max_equiv_usd");
  const observedTurns = nonNegativeInteger(spend["observed_provider_turns"], "spend.observed_provider_turns");
  const observedUsd = nonNegativeNumber(spend["observed_equiv_usd"], "spend.observed_equiv_usd");
  const exhausted = boolean(spend["ceiling_exhausted"], "spend.ceiling_exhausted");
  if (observedTurns > maxTurns || observedUsd > maxUsd)
    throw new Error("observed spend exceeds the hard campaign ceiling");
  if (exhausted !== (observedTurns >= maxTurns || observedUsd >= maxUsd)) {
    throw new Error("spend.ceiling_exhausted does not match observed spend");
  }

  const coverage = object(root["coverage"], "coverage");
  exactKeys(coverage, ["required_case_ids", "collected_case_ids", "missing_case_ids"]);
  const required = uniqueStringList(coverage["required_case_ids"], "coverage.required_case_ids");
  const collected = uniqueStringList(coverage["collected_case_ids"], "coverage.collected_case_ids");
  const missing = uniqueStringList(coverage["missing_case_ids"], "coverage.missing_case_ids");
  const expectedMissing = required.filter((id) => !collected.includes(id)).sort();
  if (JSON.stringify([...missing].sort()) !== JSON.stringify(expectedMissing)) {
    throw new Error("coverage.missing_case_ids must equal required minus collected");
  }
  if (collected.some((id) => !required.includes(id)))
    throw new Error("collected case is not required by this campaign");

  const outcome = object(root["outcome"], "outcome");
  exactKeys(outcome, ["completeness", "verdict", "decision_status", "violation_ids", "reason_codes"]);
  const completeness = oneOf(outcome["completeness"], ["complete", "incomplete"], "outcome.completeness");
  const verdict = oneOf(outcome["verdict"], ["pass", "fail", "inconclusive"], "outcome.verdict");
  const decision = oneOf(
    outcome["decision_status"],
    ["ratified", "proposed", "not_applicable"],
    "outcome.decision_status",
  );
  const violations = uniqueStringList(outcome["violation_ids"], "outcome.violation_ids");
  uniqueStringList(outcome["reason_codes"], "outcome.reason_codes");
  if (missing.length > 0 && completeness !== "incomplete")
    throw new Error("missing cases require incomplete completeness");
  if (missing.length === 0 && status === "completed" && !exhausted && completeness !== "complete")
    throw new Error("completed full coverage below the ceiling must be complete");
  if (status !== "completed" && completeness !== "incomplete")
    throw new Error("unfinished campaign must be incomplete");
  if (exhausted && completeness !== "incomplete")
    throw new Error("ceiling exhaustion requires incomplete completeness");
  if (violations.length > 0 && verdict !== "fail") throw new Error("proven violations require fail verdict");
  if (violations.length === 0 && completeness === "incomplete" && verdict !== "inconclusive") {
    throw new Error("incomplete campaign without a proven violation must be inconclusive");
  }
  if (violations.length === 0 && decision === "proposed" && verdict !== "inconclusive") {
    throw new Error("proposed threshold cannot produce pass or fail");
  }
  if (verdict === "pass" && (completeness !== "complete" || decision === "proposed")) {
    throw new Error("pass requires complete evidence and a non-proposed decision status");
  }

  uniqueStringList(root["evidence_refs"], "evidence_refs");
  if (root["profile"] !== undefined) parseValidationCampaignProfile(root["profile"]);
}

function validateHistoricalPolicy(value: unknown): void {
  const policy = object(value, "policy");
  exactKeys(policy, ["path", "sha256"]);
  nonEmpty(policy["path"], "policy.path");
  if (!/^[a-f0-9]{64}$/.test(string(policy["sha256"], "policy.sha256")))
    throw new Error("policy.sha256 must be lowercase sha256");
}

function assertCampaignId(value: string): void {
  if (!CAMPAIGN_ID.test(value)) throw new Error(`invalid validation campaign id: ${value}`);
}
function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, allowed: string[]): void {
  const set = new Set(allowed);
  const extra = Object.keys(value).filter((key) => !set.has(key));
  if (extra.length > 0) throw new Error(`unknown campaign field(s): ${extra.join(", ")}`);
}
function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}
function nonEmpty(value: unknown, name: string): string {
  const out = string(value, name);
  if (out.trim().length === 0) throw new Error(`${name} must not be empty`);
  return out;
}
function oneOf<const T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new Error(`${name} must be one of ${allowed.join(", ")}`);
  return value as T;
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be boolean`);
  return value;
}
function nonNegativeNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error(`${name} must be a non-negative finite number`);
  return value;
}
function nonNegativeInteger(value: unknown, name: string): number {
  const out = nonNegativeNumber(value, name);
  if (!Number.isInteger(out)) throw new Error(`${name} must be an integer`);
  return out;
}
function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new Error(`${name} must be an array of non-empty strings`);
  }
  return value as string[];
}
function uniqueStringList(value: unknown, name: string): string[] {
  const out = stringList(value, name);
  if (new Set(out).size !== out.length) throw new Error(`${name} must not contain duplicates`);
  return out;
}
function instant(value: unknown, name: string): string {
  const out = string(value, name);
  if (!Number.isFinite(Date.parse(out))) throw new Error(`${name} must be an ISO-8601 instant`);
  return out;
}
function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT"
  );
}
