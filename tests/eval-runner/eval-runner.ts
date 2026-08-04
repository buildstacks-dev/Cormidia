// Hand-rolled L4 data-collection runner. It aggregates per exact tuple, rotates
// committed shards, enforces a declared token ceiling before each case, and
// always delegates final completeness/verdict semantics to DurableCampaignRunner.

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../../src/org/atomic.js";
import type { Effort, RuntimeKind } from "../../src/runtime/types.js";
import { DurableCampaignRunner } from "../campaign/campaign-runner.js";

export type EvalSite = "reviewer" | "planner";
export interface EvalCaseV1 {
  schema_version: 1;
  id: string;
  site: EvalSite;
  sub_site: string;
  case_class: string;
  prompt: string;
  expected: { verdict?: "APPROVE" | "REJECT"; rubric_anchors: string[] };
  token_reservation: number;
  provenance: {
    author: string;
    authored_at: string;
    source_refs: string[];
    human_validation: "pending" | "validated";
    validated_by?: string;
  };
}

export interface EvalTuple {
  id: string;
  runtime: RuntimeKind;
  model: string;
  effort: Effort;
  maxCaseCostUsd: number;
}

export interface EvalExecutionResult {
  output: string;
  tokensIn: number;
  tokensOut: number;
  equivUsd: number;
  sessionId: string;
}

export interface EvalExecutor {
  execute(input: { tuple: EvalTuple; evalCase: EvalCaseV1; maxTokens: number }): Promise<EvalExecutionResult>;
}

export interface EvalCampaignOptions {
  campaign: DurableCampaignRunner;
  campaignId: string;
  stateHome: string;
  cases: EvalCaseV1[];
  tuples: EvalTuple[];
  maxTokens: number;
  shard?: { date: string; count: number };
  executor: EvalExecutor;
}

export interface EvalObservation {
  case_id: string;
  tuple_id: string;
  session_id: string;
  tokens_in: number;
  tokens_out: number;
  equiv_usd: number;
  output_sha256: string;
  observed_verdict: "APPROVE" | "REJECT" | "invalid" | "not_applicable";
  expected_verdict: "APPROVE" | "REJECT" | "not_applicable";
  matches_reference: boolean | null;
  human_reference_status: "pending" | "validated";
}

export interface EvalResultsV1 {
  schema_version: 1;
  campaign_id: string;
  token_ceiling: number;
  observed_tokens: number;
  selected_case_ids: string[];
  stopped_on_token_ceiling: boolean;
  observations: EvalObservation[];
  per_tuple: Array<{
    tuple_id: string;
    observations: number;
    valid_outputs: number;
    reference_matches: number;
    reference_mismatches: number;
    unscored: number;
    tokens: number;
    equiv_usd: number;
  }>;
}

export async function runEvalCampaign(options: EvalCampaignOptions): Promise<EvalResultsV1> {
  validateCases(options.cases);
  if (options.tuples.length === 0) throw new Error("eval runner requires at least one exact tuple");
  const selected = options.shard === undefined ? [...options.cases] : selectRotatingShard(options.cases, options.shard.date, options.shard.count);
  if (selected.length === 0) throw new Error("eval runner selected an empty shard");
  const results: EvalResultsV1 = {
    schema_version: 1,
    campaign_id: options.campaignId,
    token_ceiling: options.maxTokens,
    observed_tokens: 0,
    selected_case_ids: selected.map((item) => item.id),
    stopped_on_token_ceiling: false,
    observations: [],
    per_tuple: [],
  };
  await persist(options.stateHome, results);

  outer: for (const tuple of options.tuples) {
    for (const evalCase of selected) {
      if (results.observed_tokens + evalCase.token_reservation > options.maxTokens) {
        results.stopped_on_token_ceiling = true;
        await options.campaign.noteIncomplete("eval_token_ceiling_reservation_refused");
        break outer;
      }
      const caseKey = `${tuple.id}::${evalCase.id}`;
      await options.campaign.runCase(caseKey, { providerTurns: 1, maxEquivUsd: tuple.maxCaseCostUsd }, async () => {
        let execution: EvalExecutionResult;
        try {
          execution = await options.executor.execute({ tuple, evalCase, maxTokens: evalCase.token_reservation });
        } catch (error) {
          // The provider may have consumed tokens before failing to return
          // usage. Debit the full token reservation and persist before the
          // campaign aborts; unknown partial use must not vanish.
          results.observed_tokens += evalCase.token_reservation;
          results.stopped_on_token_ceiling = results.observed_tokens >= options.maxTokens;
          await persist(options.stateHome, results);
          throw error;
        }
        validateExecution(execution, caseKey);
        const tokens = execution.tokensIn + execution.tokensOut;
        results.observed_tokens += tokens;
        if (tokens > evalCase.token_reservation) {
          await persist(options.stateHome, results);
          throw new Error(`eval ${caseKey} exceeded its token reservation`);
        }
        const score = { ...scoreObservation(evalCase, execution), tuple_id: tuple.id };
        results.observations.push(score);
        results.per_tuple = aggregate(results.observations, options.tuples);
        await persist(options.stateHome, results);
        return {
          providerTurns: 1,
          equivUsd: execution.equivUsd,
          reasonCodes: [
            ...(score.matches_reference === false ? ["quality_observation_mismatch"] : []),
            ...(evalCase.provenance.human_validation === "pending" ? ["golden_reference_human_validation_pending"] : []),
          ],
          evidenceRefs: [`validation/campaigns/${options.campaignId}/eval-results.json#${caseKey}`],
        };
      });
    }
  }
  results.per_tuple = aggregate(results.observations, options.tuples);
  await persist(options.stateHome, results);
  return results;
}

export function selectRotatingShard(cases: EvalCaseV1[], date: string, count: number): EvalCaseV1[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("eval shard date must be YYYY-MM-DD");
  if (!Number.isInteger(count) || count < 1 || count > cases.length) throw new Error("eval shard count must be between 1 and case count");
  const day = Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86_400_000);
  const selectedIndex = ((day % count) + count) % count;
  return [...cases]
    .sort((left, right) => left.id.localeCompare(right.id))
    .filter((_, index) => index % count === selectedIndex);
}

export function validateCases(cases: EvalCaseV1[]): void {
  if (cases.length === 0) throw new Error("golden set is empty");
  if (new Set(cases.map((item) => item.id)).size !== cases.length) throw new Error("golden case ids must be unique");
  for (const item of cases) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new Error("golden case must be an object");
    exactKeys(item as unknown as Record<string, unknown>, ["schema_version", "id", "site", "sub_site", "case_class", "prompt", "expected", "token_reservation", "provenance"], "golden case");
    if (item.schema_version !== 1 || !nonEmpty(item.id) || !nonEmpty(item.prompt) || !nonEmpty(item.sub_site) || !nonEmpty(item.case_class)) throw new Error(`invalid golden case ${item.id || "(missing id)"}`);
    if (item.site !== "reviewer" && item.site !== "planner") throw new Error(`golden case ${item.id} has unsupported site`);
    if (!Number.isInteger(item.token_reservation) || item.token_reservation < 1) throw new Error(`golden case ${item.id} has invalid token_reservation`);
    if (item.expected === null || typeof item.expected !== "object" || Array.isArray(item.expected)) throw new Error(`golden case ${item.id} expected must be an object`);
    exactKeys(item.expected as unknown as Record<string, unknown>, ["verdict", "rubric_anchors"], `golden case ${item.id} expected`);
    if (!Array.isArray(item.expected.rubric_anchors) || item.expected.rubric_anchors.length === 0 || item.expected.rubric_anchors.some((value) => !nonEmpty(value))) throw new Error(`golden case ${item.id} requires rubric anchors`);
    if (item.expected.verdict !== undefined && item.expected.verdict !== "APPROVE" && item.expected.verdict !== "REJECT") throw new Error(`golden case ${item.id} has invalid expected verdict`);
    if (item.site === "reviewer" && item.expected.verdict === undefined) throw new Error(`reviewer case ${item.id} requires expected.verdict`);
    if (item.provenance === null || typeof item.provenance !== "object" || Array.isArray(item.provenance)) throw new Error(`golden case ${item.id} provenance must be an object`);
    exactKeys(item.provenance as unknown as Record<string, unknown>, ["author", "authored_at", "source_refs", "human_validation", "validated_by"], `golden case ${item.id} provenance`);
    if (!nonEmpty(item.provenance.author) || !/^\d{4}-\d{2}-\d{2}$/.test(item.provenance.authored_at)) throw new Error(`golden case ${item.id} has invalid provenance author/date`);
    if (!Array.isArray(item.provenance.source_refs) || item.provenance.source_refs.length === 0 || item.provenance.source_refs.some((value) => !nonEmpty(value))) throw new Error(`golden case ${item.id} requires source refs`);
    if (item.provenance.human_validation !== "pending" && item.provenance.human_validation !== "validated") throw new Error(`golden case ${item.id} has invalid human_validation`);
    if (item.provenance.human_validation === "validated" && !nonEmpty(item.provenance.validated_by)) throw new Error(`validated golden case ${item.id} requires validated_by`);
    if (item.provenance.human_validation === "pending" && item.provenance.validated_by !== undefined) throw new Error(`pending golden case ${item.id} cannot name validated_by`);
  }
}

function validateExecution(value: EvalExecutionResult, caseKey: string): void {
  if (typeof value.output !== "string" || !nonEmpty(value.sessionId)) throw new Error(`eval ${caseKey} returned invalid output/session identity`);
  if (!Number.isInteger(value.tokensIn) || value.tokensIn < 0 || !Number.isInteger(value.tokensOut) || value.tokensOut < 0) throw new Error(`eval ${caseKey} returned invalid token usage`);
  if (!Number.isFinite(value.equivUsd) || value.equivUsd < 0) throw new Error(`eval ${caseKey} returned invalid equivalent cost`);
}

function exactKeys(value: Record<string, unknown>, allowed: string[], name: string): void {
  const keys = new Set(allowed);
  const extra = Object.keys(value).filter((key) => !keys.has(key));
  if (extra.length > 0) throw new Error(`${name} contains unknown field(s): ${extra.join(", ")}`);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function scoreObservation(evalCase: EvalCaseV1, result: EvalExecutionResult): EvalObservation {
  const verdicts = [...result.output.matchAll(/(?:^|\n)VERDICT:\s*(APPROVE|REJECT)\s*(?:\n|$)/g)]
    .map((match) => match[1] as "APPROVE" | "REJECT");
  const observed: EvalObservation["observed_verdict"] = evalCase.site === "reviewer"
    ? (verdicts.length === 1 ? verdicts[0]! : "invalid")
    : "not_applicable";
  const expected = evalCase.expected.verdict ?? "not_applicable";
  return {
    case_id: evalCase.id,
    tuple_id: "", // populated by caller immediately below
    session_id: result.sessionId,
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
    equiv_usd: result.equivUsd,
    output_sha256: createHash("sha256").update(result.output).digest("hex"),
    observed_verdict: observed,
    expected_verdict: expected,
    matches_reference: evalCase.site === "reviewer" ? observed === expected : null,
    human_reference_status: evalCase.provenance.human_validation,
  };
}

function aggregate(observations: EvalObservation[], tuples: EvalTuple[]): EvalResultsV1["per_tuple"] {
  return tuples.map((tuple) => {
    const rows = observations.filter((item) => item.tuple_id === tuple.id);
    return {
      tuple_id: tuple.id,
      observations: rows.length,
      valid_outputs: rows.filter((item) => item.observed_verdict !== "invalid").length,
      reference_matches: rows.filter((item) => item.matches_reference === true).length,
      reference_mismatches: rows.filter((item) => item.matches_reference === false).length,
      unscored: rows.filter((item) => item.matches_reference === null).length,
      tokens: rows.reduce((sum, item) => sum + item.tokens_in + item.tokens_out, 0),
      equiv_usd: Math.round(rows.reduce((sum, item) => sum + item.equiv_usd, 0) * 1_000_000) / 1_000_000,
    };
  });
}

async function persist(stateHome: string, results: EvalResultsV1): Promise<void> {
  const path = join(stateHome, "validation", "campaigns", results.campaign_id, "eval-results.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, `${JSON.stringify(results, null, 2)}\n`);
}
