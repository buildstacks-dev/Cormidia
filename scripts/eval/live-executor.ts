import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ClaudeRuntime } from "../../src/runtime/adapters/claude.js";
import { CodexRuntime } from "../../src/runtime/adapters/codex.js";
import { defaultGate } from "../../src/runtime/gate.js";
import type { RoleConfig, Runtime, TurnResult } from "../../src/runtime/types.js";
import { gradeLibrary } from "../../eval/graders/index.js";
import { grade as gradeStandard } from "../../eval/graders/standard-slug-options.js";
import { gradeService } from "../../eval/graders/index.js";
import { hashManifest, loadYamlFile, writeAttemptResult, type AttemptResult, type CampaignManifest, type EvalCaseManifest } from "./core.js";

export interface LiveExecutionOptions { root: string; manifestPath: string; maxUsd: number; evalRoot: string }
export async function executeLiveCampaign(options: LiveExecutionOptions): Promise<{ attempts: AttemptResult[]; product_cost_usd: number; evaluator_cost_usd: number }> {
  const campaign = loadYamlFile(options.manifestPath) as CampaignManifest; const campaignSha256 = hashManifest(campaign);
  const attempts: AttemptResult[] = []; let productCost = 0; let evaluatorCost = 0;
  for (const item of campaign.cases) {
    const caseManifest = findCase(options.root, item.case_id);
    for (const repetitionId of item.repetition_ids) {
      const attemptId = `${safe(item.case_id)}-${safe(repetitionId)}`; const admittedAt = new Date().toISOString(); const upper = campaign.spend.case_max_usd[item.case_id];
      if (upper === undefined || productCost + evaluatorCost + upper > options.maxUsd) {
        const stopped = result(campaign, campaignSha256, attemptId, item.case_id, repetitionId, "budget_stop", admittedAt, ["campaign_cap_cannot_cover_remaining_upper_bound"]); persist(stopped); attempts.push(stopped); continue;
      }
      if (item.case_id.startsWith("learning/")) {
        const miss = result(campaign, campaignSha256, attemptId, item.case_id, repetitionId, "product_miss", admittedAt, ["efficiency_learning_signal_absent"]); persist(miss); attempts.push(miss); continue;
      }
      const workdir = join(options.evalRoot, "managed", attemptId); mkdirSync(workdir, { recursive: true });
      const template = caseManifest.app.template.replace("operon-eval-", ""); cpSync(join(options.root, "eval/apps", template, "seed"), workdir, { recursive: true }); initializeGit(workdir);
      const task = readFileSync(join(options.root, "eval", caseManifest.episode.task_ref), "utf8");
      let builder: TurnResult | undefined; let reviewer: TurnResult | undefined; let outcome: AttemptResult["outcome"] = "product_miss"; const evidence: string[] = [];
      try {
        builder = await runtimeFor("builder", campaign).runTurn({ role: roleFor("builder", campaign, upper), workdir, task: `${task}\n\nOperate only inside this eval worktree. Implement the requested change and run the visible checks. Do not publish, deploy, or access sibling paths.`, context: { taste: [], memoryExcerpts: [] }, maxTurns: 20, networkAccess: false }, { gate: defaultGate });
        productCost += builder.usage.costUsd; evidence.push(`builder:${builder.status}`);
        const visible = builder.status === "completed" && visibleCommands(caseManifest, workdir);
        const hidden = visible && await hiddenGrade(item.case_id, workdir);
        if (hidden) {
          reviewer = await runtimeFor("reviewer", campaign).runTurn({ role: roleFor("reviewer", campaign, upper), workdir, task: `Independently review this eval-only change against the task below. Inspect the worktree and run bounded checks. Do not modify files or perform outward actions. Return a concise verdict.\n\n${task}`, context: { taste: [], memoryExcerpts: [] }, maxTurns: 8, networkAccess: false }, { gate: defaultGate });
          evaluatorCost += reviewer.usage.costUsd; evidence.push(`reviewer:${reviewer.status}`);
          outcome = reviewer.status === "completed" && reviewer.escalations.length === 0 ? "passed" : reviewer.status === "blocked_on_gate" ? "safety_stop" : "product_miss";
        } else if (builder.status === "blocked_on_gate") outcome = "safety_stop";
      } catch (error) {
        evidence.push(`infrastructure:${typedError(error)}`); outcome = "infra_invalid";
      }
      const attempt = result(campaign, campaignSha256, attemptId, item.case_id, repetitionId, outcome, admittedAt, evidence, { builder_usage: builder?.usage ?? null, reviewer_usage: reviewer?.usage ?? null });
      persist(attempt); attempts.push(attempt);
    }
  }
  return { attempts, product_cost_usd: productCost, evaluator_cost_usd: evaluatorCost };

  function persist(value: AttemptResult): void { writeAttemptResult(join(options.root, ".eval-artifacts", campaign.campaign_id, "results", `${value.attempt_id}.json`), value); }
}

function runtimeFor(role: "builder" | "reviewer", campaign: CampaignManifest): Runtime { const assignment = campaign.assignments.find((item) => item.role === role); if (!assignment) throw new Error(`missing_assignment: ${role}`); return assignment.runtime === "codex" ? new CodexRuntime() : assignment.runtime === "claude" ? new ClaudeRuntime({ baseOptions: { settingSources: [] } }) : (() => { throw new Error(`unsupported_live_runtime: ${assignment.runtime}`); })(); }
function roleFor(name: "builder" | "reviewer", campaign: CampaignManifest, maxTurnBudgetUsd: number): RoleConfig { const assignment = campaign.assignments.find((item) => item.role === name); if (!assignment || (assignment.runtime !== "codex" && assignment.runtime !== "claude")) throw new Error(`missing_assignment: ${name}`); return { name, runtime: assignment.runtime, model: assignment.model, effort: assignment.effort as RoleConfig["effort"], delegation: { allow: [] }, triggers: [], outputs: [], maxTurnBudgetUsd }; }
function initializeGit(cwd: string): void { execFileSync("git", ["init", "--initial-branch=main"], { cwd, stdio: "ignore" }); execFileSync("git", ["-c", "user.name=Operon Eval", "-c", "user.email=eval@operon.invalid", "-c", "commit.gpgsign=false", "add", "-A"], { cwd }); execFileSync("git", ["-c", "user.name=Operon Eval", "-c", "user.email=eval@operon.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "eval seed"], { cwd, stdio: "ignore" }); }
function visibleCommands(manifest: EvalCaseManifest, cwd: string): boolean { try { for (const command of manifest.oracle.visible_commands) execFileSync("/bin/sh", ["-lc", command], { cwd, env: { ...process.env, CI: "1", npm_config_audit: "false", npm_config_fund: "false" }, stdio: "ignore", timeout: 120_000 }); return true; } catch { return false; } }
async function hiddenGrade(caseId: string, root: string): Promise<boolean> { if (caseId.startsWith("quick/")) return gradeLibrary(root); if (caseId.startsWith("standard/")) return gradeStandard(root); if (caseId.startsWith("deep/")) return gradeService(root); return false; }
function result(campaign: CampaignManifest, hash: string, attemptId: string, caseId: string, repetitionId: string, outcome: AttemptResult["outcome"], admittedAt: string, evidence: string[], metrics: Record<string, unknown> = {}): AttemptResult { return { schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: hash, attempt_id: attemptId, case_id: caseId, repetition_id: repetitionId, outcome, admitted_at: admittedAt, terminal_at: new Date().toISOString(), evidence, metrics, exclusions: [], missing: outcome === "infra_invalid" ? ["valid_behavioral_sample"] : [] }; }
function safe(value: string): string { return value.replaceAll(/[^a-zA-Z0-9_-]+/g, "-"); }
function typedError(error: unknown): string { const message = error instanceof Error ? error.message.toLowerCase() : String(error); if (message.includes("auth") || message.includes("login")) return "provider_unauthenticated"; if (message.includes("timeout")) return "provider_timeout"; return "provider_transport_failure"; }
function findCase(root: string, caseId: string): EvalCaseManifest {
  let found: EvalCaseManifest | undefined; visit(join(root, "eval/cases")); if (!found) throw new Error(`case_not_found: ${caseId}`); return found;
  function visit(dir: string): void { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) visit(path); else if (entry.isFile() && entry.name.endsWith(".yaml")) { const value = loadYamlFile(path) as EvalCaseManifest; if (value.case_id === caseId) found = value; } } }
}
