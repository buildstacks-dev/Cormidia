#!/usr/bin/env node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeRuntime } from "../../src/runtime/adapters/claude.js";
import { CodexRuntime } from "../../src/runtime/adapters/codex.js";
import { PiRuntime } from "../../src/runtime/adapters/pi.js";
import type { RoleConfig, Runtime, RuntimeKind } from "../../src/runtime/types.js";
import { DurableCampaignRunner } from "../campaign/campaign-runner.js";
import { assertCampaignRepositoryBinding } from "../campaign/repository-binding.js";
import {
  runEvalCampaign,
  selectRotatingShard,
  validateCases,
  type EvalCaseV1,
  type EvalExecutionResult,
  type EvalTuple,
} from "./eval-runner.js";
import { loadEvalConfig } from "./config.js";

async function main(): Promise<number> {
  const config = await loadEvalConfig();
  const binding = await assertCampaignRepositoryBinding({
    commit: config.commit,
    policyPath: config.policy_path,
    trackedInputPaths: config.golden_set_files,
  });
  const cases = (await Promise.all(binding.trackedInputPaths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as unknown[]))).flat() as EvalCaseV1[];
  validateCases(cases);
  const selected = config.shard === null ? cases : selectRotatingShard(cases, config.shard.date, config.shard.count);
  const required = config.tuples.flatMap((tuple) => selected.map((evalCase) => `${tuple.id}::${evalCase.id}`));
  const campaign = new DurableCampaignRunner({
    stateHome: config.state_home,
    campaignId: config.campaign_id,
    lane: "L4",
    campaignKind: "quality-eval-data-collection",
    trigger: `human:${config.human_authorization.authorized_by}:${config.human_authorization.purpose}`,
    policyPath: config.policy_path,
    commit: config.commit,
    apps: [config.app],
    scopes: [...new Set(selected.map((item) => item.site))],
    tuples: config.tuples.map((tuple) => tuple.id),
    requiredCaseIds: required,
    maxProviderTurns: config.max_provider_turns,
    maxEquivUsd: config.max_equiv_usd,
    decisionStatus: "proposed",
  });
  const workdir = await mkdtemp(join(tmpdir(), "operon-eval-"));
  await campaign.start();
  let executionFailed = false;
  try {
    await runEvalCampaign({
      campaign,
      campaignId: config.campaign_id,
      stateHome: config.state_home,
      cases,
      tuples: config.tuples,
      maxTokens: config.max_tokens,
      ...(config.shard === null ? {} : { shard: config.shard }),
      executor: {
        execute: async ({ tuple, evalCase }) => execute(runtime(tuple.runtime), tuple, evalCase, workdir),
      },
    });
  } catch {
    executionFailed = true;
    await campaign.noteIncomplete("eval_execution_aborted");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
  const report = await campaign.finish();
  console.log(JSON.stringify(report, null, 2));
  if (executionFailed) return 2;
  return report.outcome.verdict === "pass" ? 0 : report.outcome.verdict === "fail" ? 1 : 2;
}

async function execute(runtime: Runtime, tuple: EvalTuple, evalCase: EvalCaseV1, workdir: string): Promise<EvalExecutionResult> {
  const role: RoleConfig = {
    name: `eval-${evalCase.site}`,
    runtime: tuple.runtime,
    model: tuple.model,
    effort: tuple.effort,
    delegation: { allow: [] }, triggers: [], outputs: [], maxTurnBudgetUsd: tuple.maxCaseCostUsd,
  };
  const result = await runtime.runTurn({
    role,
    assignment: { harness: tuple.runtime, model: tuple.model, effort: tuple.effort },
    workdir,
    task: evalCase.prompt,
    context: { taste: [], memoryExcerpts: [] },
    maxTurns: 1,
    networkAccess: false,
  }, { gate: () => ({ allow: false, reason: "eval cases are prose-only", escalate: true }) });
  return {
    output: result.summary,
    tokensIn: result.usage.tokensIn,
    tokensOut: result.usage.tokensOut,
    equivUsd: result.usage.costUsd,
    sessionId: result.session.id,
  };
}

function runtime(kind: RuntimeKind): Runtime { return kind === "claude" ? new ClaudeRuntime() : kind === "codex" ? new CodexRuntime() : new PiRuntime(); }

main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; });
