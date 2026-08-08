// campaign/acceptance/campaign-cli.ts — the thing a human actually invokes.
//
//   pnpm test:acceptance -- --config <absolute-path> [--dry-run]
//
// It refuses loudly and early rather than helpfully. An L-ACC campaign spends
// real tokens against real GitHub through the packaged binaries, and there is
// NO global ceiling — `risk-allocation.md` §5a is explicit that the bound comes
// from an exact human authorization for that exact campaign. So the entry point
// treats a missing or unconfirmed authorization as a refusal, not a prompt.
//
// `--dry-run` runs every preflight decidable from the config and report
// identity, provisions nothing, spawns no binary, and prints what a real run
// would do. Runtime-only install/world dependencies are checked by
// `runCampaign` before mutation; this entry point deliberately cannot invent
// them.

import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { AcceptanceCampaignConfig } from "./campaign-config.js";
import { validateCampaignConfig } from "./campaign-config.js";
import { claimCampaignIdentity, configHash } from "./report-store.js";

export class CampaignAuthorizationError extends Error {
  constructor(message: string) {
    super(`campaign refused: ${message}`);
    this.name = "CampaignAuthorizationError";
  }
}

/** The human authorization block a config must carry before anything spends. */
export interface SpendAuthorization {
  /** Who authorized it. An identity, not a role. */
  authorized_by: string;
  /** ISO date the authorization was given. */
  authorized_on: string;
  /** The exact statement the human made. Recorded verbatim, never paraphrased. */
  statement: string;
  max_output_tokens: number;
  max_equiv_usd: number;
}

export interface AcceptanceCampaignFile {
  schema_version: 1;
  campaign: AcceptanceCampaignConfig;
  authorization?: SpendAuthorization;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate the authorization envelope. Every clause exists because its absence
 * has a specific failure mode:
 *   * no block at all — the campaign would run on a ceiling nobody set;
 *   * a placeholder identity — "the operator" is not attributable;
 *   * ceilings that disagree with the campaign envelope — two numbers, and the
 *     campaign would enforce the wrong one.
 */
export function assertSpendAuthorization(file: AcceptanceCampaignFile): SpendAuthorization {
  const authorization = file.authorization;
  if (authorization === undefined) {
    throw new CampaignAuthorizationError(
      "the config carries no `authorization:` block. An L-ACC campaign spends real tokens and there is NO global " +
        "ceiling (risk-allocation.md §5a) — it runs only under an exact human authorization naming this campaign's " +
        "output-token and equivalent-USD ceilings.",
    );
  }
  for (const field of ["authorized_by", "authorized_on", "statement"] as const) {
    const value = authorization[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new CampaignAuthorizationError(`authorization.${field} is required and must not be blank`);
    }
  }
  if (/^(the )?(operator|human|owner|me)$/i.test(authorization.authorized_by.trim())) {
    throw new CampaignAuthorizationError(
      `authorization.authorized_by ${JSON.stringify(authorization.authorized_by)} is a role, not an attributable identity`,
    );
  }
  if (!ISO_DATE.test(authorization.authorized_on)) {
    throw new CampaignAuthorizationError("authorization.authorized_on must be an ISO date (YYYY-MM-DD)");
  }
  for (const field of ["max_output_tokens", "max_equiv_usd"] as const) {
    const value = authorization[field];
    if (!Number.isFinite(value) || value <= 0) {
      throw new CampaignAuthorizationError(`authorization.${field} must be a positive number`);
    }
  }
  const envelope = file.campaign.envelope;
  if (
    envelope !== undefined &&
    (envelope.maxOutputTokens !== authorization.max_output_tokens ||
      envelope.maxEquivUsd !== authorization.max_equiv_usd)
  ) {
    throw new CampaignAuthorizationError(
      `the campaign envelope (${envelope.maxOutputTokens} tokens / $${envelope.maxEquivUsd}) disagrees with the ` +
        `authorization (${authorization.max_output_tokens} tokens / $${authorization.max_equiv_usd}); two ceilings ` +
        `means the campaign would enforce the wrong one`,
    );
  }
  return authorization;
}

export async function readCampaignFile(path: string): Promise<AcceptanceCampaignFile> {
  const text = await readFile(path, "utf8");
  const parsed = parse(text) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CampaignAuthorizationError(`${path}: campaign config is not a YAML mapping`);
  }
  const record = parsed as Record<string, unknown>;
  if (record["schema_version"] !== 1 || typeof record["campaign"] !== "object" || record["campaign"] === null) {
    throw new CampaignAuthorizationError(`${path}: expected schema_version: 1 and a \`campaign:\` block`);
  }
  return parsed as AcceptanceCampaignFile;
}

export interface PreflightSummary {
  campaignId: string;
  campaignOrg: string;
  scenarioIds: string[];
  configSha256: string;
  authorization: SpendAuthorization;
  uncertifiedCandidateIds: string[];
  identity: "fresh" | "resume";
}

/**
 * Everything decidable before a binary is spawned or a repository is touched.
 * `--dry-run` stops here, and that is the whole point: a config defect should
 * cost nothing.
 */
export async function preflightCampaign(file: AcceptanceCampaignFile, reportRoot: string): Promise<PreflightSummary> {
  const authorization = assertSpendAuthorization(file);
  const validated = validateCampaignConfig(file.campaign);
  const sha = configHash(file.campaign);
  const claim = await claimCampaignIdentity({
    root: reportRoot,
    campaignId: validated.campaignId,
    configSha256: sha,
  });
  return {
    campaignId: validated.campaignId,
    campaignOrg: validated.campaignOrg,
    scenarioIds: validated.scenarioIds,
    configSha256: sha,
    authorization,
    uncertifiedCandidateIds: validated.uncertifiedCandidateIds,
    identity: claim.kind,
  };
}

/** Human-readable rehearsal. Prints what would happen and what it would cost
 *  against, without doing any of it. */
export function renderDryRun(summary: PreflightSummary): string {
  return [
    `campaign:      ${summary.campaignId} (${summary.identity})`,
    `org:           ${summary.campaignOrg}`,
    `scenarios:     ${summary.scenarioIds.join(", ")}`,
    `config sha256: ${summary.configSha256}`,
    `authorized by: ${summary.authorization.authorized_by} on ${summary.authorization.authorized_on}`,
    `statement:     ${JSON.stringify(summary.authorization.statement)}`,
    `ceilings:      ${summary.authorization.max_output_tokens} output tokens / $${summary.authorization.max_equiv_usd}`,
    summary.uncertifiedCandidateIds.length === 0
      ? "uncertified:   none"
      : `uncertified:   ${summary.uncertifiedCandidateIds.join(", ")} (disclosed in the report)`,
    "",
    "DRY RUN — nothing was provisioned, no binary was spawned, no token was spent.",
    "L-ACC gates nothing: this campaign emits a report and never a release signal (F-PT-029).",
  ].join("\n");
}
