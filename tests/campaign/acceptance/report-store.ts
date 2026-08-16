// campaign/acceptance/report-store.ts — durable campaign reports and resume
// (CORMIDIA-C-B27-001 §3).
//
// This closes a real gap: the runner built its report in memory and returned it,
// so §3's four durability clauses were contract text with no implementation. A
// campaign that spends real tokens for hours and then loses its report to a
// crash has spent the money and kept nothing — and worse, a partially written
// report that a reader accepts is the "no green by absence" failure with the
// evidence itself as the subject.
//
// Four clauses, four mechanisms:
//   * **Atomic writes** — `writeLoopFileAtomic`, the same primitive the jobs
//     journal uses, so a crash leaves either the previous report or the next
//     one and never a torn one.
//   * **Torn/malformed reads are rejected**, never read as terminal truth.
//   * **Resume binds the config content hash.** A config changed under a live
//     campaign refuses and NAMES the drift rather than resuming into a
//     different scenario set.
//   * **Two campaigns cannot share a report identity.** The second refuses.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { writeLoopFileAtomic } from "../../../src/loop/durable.js";
import type { AcceptanceCampaignReport } from "./campaign-report.js";
import { assertReportWellFormed } from "./campaign-report.js";
import { assertSafeAcceptanceCampaignId, parseStoredCampaignReport } from "./report-store-validation.js";

type HistoricalAcceptanceCampaignReportV1 = Omit<AcceptanceCampaignReport, "schema_version" | "policy_binding"> & {
  schema_version: 1;
};
export type ReadableAcceptanceCampaignReport = HistoricalAcceptanceCampaignReportV1 | AcceptanceCampaignReport;

export type ReportStoreCode =
  | "report-torn"
  | "report-identity-conflict"
  | "config-hash-drift"
  | "report-absent"
  | "report-already-final";

export class ReportStoreError extends Error {
  constructor(
    readonly code: ReportStoreCode,
    message: string,
  ) {
    super(`campaign report store refused (${code}): ${message}`);
    this.name = "ReportStoreError";
  }
}

/** What is persisted: the report plus the binding facts a resume must match. */
export interface StoredCampaignReport {
  schema_version: 1;
  campaign_id: string;
  /** SHA-256 over the campaign config's canonical JSON. */
  config_sha256: string;
  /** `running` until the campaign terminates; then `final`. */
  status: "running" | "final";
  updated_at: string;
  report: ReadableAcceptanceCampaignReport;
}

export function campaignReportPath(root: string, campaignId: string): string {
  assertSafeAcceptanceCampaignId(campaignId);
  const base = resolve(root, "acceptance");
  const path = resolve(base, campaignId, "report.json");
  const remainder = relative(base, path);
  if (remainder === "" || remainder === ".." || remainder.startsWith(`..${sep}`) || isAbsolute(remainder)) {
    throw new ReportStoreError("report-identity-conflict", `${campaignId}: report path escapes the acceptance root`);
  }
  return path;
}

/** Canonical hash of a config value — key order cannot change the identity. */
export function configHash(config: unknown): string {
  return createHash("sha256").update(canonicalJson(config), "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(",")}}`;
}

/** Read a stored report, or `undefined` when this campaign has never run.
 *  A present-but-unparseable report is a REFUSAL, never an absence — treating a
 *  torn report as "not started" would silently authorize a second spend. */
export async function readStoredReport(root: string, campaignId: string): Promise<StoredCampaignReport | undefined> {
  const path = campaignReportPath(root, campaignId);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new ReportStoreError("report-torn", `${path}: report is not valid JSON`);
  }
  try {
    return parseStoredCampaignReport(parsed, campaignId);
  } catch (error) {
    if (error instanceof ReportStoreError) throw error;
    throw new ReportStoreError("report-torn", `${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface ClaimIdentityInput {
  root: string;
  campaignId: string;
  configSha256: string;
  clock?: () => Date;
}

export interface IdentityClaim {
  /** `fresh` when nothing was stored; `resume` when this exact campaign and
   *  config were already running. */
  kind: "fresh" | "resume";
  existing?: StoredCampaignReport;
}

/**
 * Claim the report identity before any spend. Refuses a second campaign under
 * the same id, refuses a resume whose config drifted, and refuses to reopen a
 * campaign that already reported.
 */
export async function claimCampaignIdentity(input: ClaimIdentityInput): Promise<IdentityClaim> {
  const existing = await readStoredReport(input.root, input.campaignId);
  if (existing === undefined) return { kind: "fresh" };
  if (existing.campaign_id !== input.campaignId) {
    throw new ReportStoreError(
      "report-identity-conflict",
      `${input.campaignId}: the stored report belongs to campaign ${existing.campaign_id}`,
    );
  }
  if (existing.config_sha256 !== input.configSha256) {
    throw new ReportStoreError(
      "config-hash-drift",
      `${input.campaignId}: authorized against config ${existing.config_sha256.slice(0, 12)} but resumed against ` +
        `${input.configSha256.slice(0, 12)}; a changed config is a different campaign, not a resume`,
    );
  }
  if (existing.status === "final") {
    throw new ReportStoreError(
      "report-already-final",
      `${input.campaignId}: already reported at ${existing.updated_at}; a second campaign may not share its identity`,
    );
  }
  return { kind: "resume", existing };
}

export interface PersistReportInput {
  root: string;
  configSha256: string;
  report: AcceptanceCampaignReport;
  status: "running" | "final";
  clock?: () => Date;
}

/** Atomic. Called after every material step so an interruption preserves
 *  partial evidence rather than losing the run (CORMIDIA-INV-ACC-6). */
export async function persistReport(input: PersistReportInput): Promise<StoredCampaignReport> {
  assertReportWellFormed(input.report);
  const now = (input.clock ?? (() => new Date()))().toISOString();
  const stored: StoredCampaignReport = {
    schema_version: 1,
    campaign_id: input.report.campaign_id,
    config_sha256: input.configSha256,
    status: input.status,
    updated_at: now,
    report: input.report,
  };
  const validated = parseStoredCampaignReport(stored, stored.campaign_id);
  await writeLoopFileAtomic(
    campaignReportPath(input.root, input.report.campaign_id),
    `${JSON.stringify(validated, null, 2)}\n`,
  );
  return validated;
}
