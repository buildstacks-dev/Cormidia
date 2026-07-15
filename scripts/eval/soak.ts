import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeRuntime } from "../../src/runtime/adapters/claude.js";
import { CodexRuntime } from "../../src/runtime/adapters/codex.js";
import { PiRuntime } from "../../src/runtime/adapters/pi.js";
import { runRole } from "../../src/loop/runRole.js";
import type { RoleConfig, Runtime } from "../../src/runtime/types.js";
import { assertEvalSeparation, assertLiveConfirmation, makeEvalActorGate, makeEvalRoleGate } from "./safety.js";
import { hashManifest, loadYamlFile, startCampaign, validateCampaign, verifyCampaignLock, writeAttemptResult, type AttemptResult, type CampaignManifest } from "./core.js";
import { CampaignReadinessError, checkCampaignReadiness } from "./readiness.js";
import { withSoakLock } from "./soak-lock.js";
import { runEvalAppGates } from "./app-gates.js";
import { assertPreparedCandidate } from "./candidate-hash.js";
import { prepareEvalProviderScratch } from "./provider-scratch.js";
import { probeRuntimeReadiness } from "../../src/runtime/readiness.js";
import { reconcileRealtimeSoak } from "./soak-reconcile.js";

interface SoakState {
  schema_version: 1;
  campaign_id: string;
  campaign_sha256: string;
  started_at: string;
  ends_at: string;
  initial_pid: number;
  last_tick: number;
  ticks: Array<{ index: number; due_at: string; recorded_at: string; reason: "not_useful_due" | "useful_turn" }>;
  turns: Array<{ index: number; tick_index: number; role: string; run_id: string; cost_usd: number; wall_clock_ms: number; tokens_in: number; tokens_out: number; usage_quality: string; status: string }>;
  restart: { due_at: string; prior_pid: number; exit_requested_at?: string; receipt_at?: string; replacement_pid?: number };
  terminal?: "passed" | "safety_stop" | "budget_stop" | "infra_invalid";
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const path = option("--campaign");
if (!path || !existsSync(resolve(path))) throw new Error("usage: pnpm eval:soak -- --campaign <prepared-file> [--execute --max-usd <n> --confirm <campaign-id>] [--once|--record-restart]");
const manifestPath = resolve(path);
const campaign = loadYamlFile(manifestPath) as CampaignManifest;
const errors = validateCampaign(campaign);
if (errors.length > 0) throw new Error(`invalid_campaign: ${errors.join("; ")}`);
if (!campaign.soak) throw new Error("soak_campaign_missing_schedule");
const nonSoak = campaign.cases.filter((item) => !item.case_id.startsWith("soak/"));
if (nonSoak.length > 0) throw new Error(`soak_campaign_contains_non_soak_cases: ${nonSoak.map((item) => item.case_id).join(",")}`);
const execute = process.argv.includes("--execute");
const campaignSha256 = hashManifest(campaign);
const campaignRoot = join(root, ".eval-artifacts", campaign.campaign_id);
const statePath = join(campaignRoot, "soak", "state.json");
const tickLockPath = join(campaignRoot, "soak", "tick.lock");
const preview = { schema_version: 1, mode: execute ? "execute" : "preview", campaign_id: campaign.campaign_id, campaign_sha256: campaignSha256, candidate: campaign.candidate, org_fingerprint: campaign.org_fingerprint, system_fingerprint: campaign.system_fingerprint, github_target: `${campaign.github.owner}/operon-eval-${campaign.campaign_id}`, cases: campaign.cases, assignments: campaign.assignments, schedule: campaign.soak, expected_due_ticks: Math.ceil(campaign.soak.duration_hours * 60 / campaign.soak.tick_interval_minutes), useful_provider_turn_upper_bound: campaign.soak.useful_turn_cap, infrastructure_retries: campaign.infrastructure_retries, stop_rules: campaign.stop_rules, max_usd: campaign.spend.campaign_max_usd, evidence_dir: campaign.evidence_dir, restart_protocol: "runner exits at the declared restart hour; a distinct process records --record-restart, then --execute resumes" };
if (!execute) {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

const requestedMax = Number(option("--max-usd"));
assertLiveConfirmation({ envEnabled: process.env.OPERON_EVAL_SOAK === "1", campaignId: campaign.campaign_id, confirmedId: option("--confirm"), requestedMaxUsd: requestedMax, manifestMaxUsd: campaign.spend.campaign_max_usd });
assertPreparedCandidate(root, campaign);
const lockPath = join(campaignRoot, "campaign.lock.json");
const lock = existsSync(lockPath) ? verifyCampaignLock(lockPath) : startCampaign(manifestPath, lockPath);
if (lock.campaign_id !== campaign.campaign_id || lock.campaign_sha256 !== campaignSha256) throw new Error("campaign_lock_identity_mismatch");
const validation = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/eval/validate.ts"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as { valid?: unknown; failures?: unknown }; if (validation.valid !== true) throw new Error(`soak_preflight_invalid:${JSON.stringify(validation.failures)}`);
const forbiddenProductionPaths = [process.env.OPERON_ORG_HOME, process.env.OPERON_STATE_HOME].filter((path): path is string => typeof path === "string" && path !== "");
assertEvalSeparation(join(campaignRoot, "world"), forbiddenProductionPaths);
const providerScratch = prepareEvalProviderScratch(campaignRoot);
replaceProcessEnv(providerScratch.processEnv);
const campaignProbe = (request: Parameters<typeof probeRuntimeReadiness>[0]) => probeRuntimeReadiness({ ...request, ...(request.runtime === "claude" ? { processEnv: providerScratch.claudeProcessEnv } : {}) });
try { persistReadiness(await checkCampaignReadiness(campaign, campaignProbe), "passed"); }
catch (error) { if (error instanceof CampaignReadinessError) persistReadiness(error.results, "failed"); throw error; }
verifyGitHubEvidence();
if (process.argv.includes("--record-restart")) {
  const state = await withSoakLock(tickLockPath, () => { const current = readState(); if (Date.now() < Date.parse(current.restart.due_at)) throw new Error("soak_restart_receipt_before_declared_hour"); if (!current.restart.exit_requested_at) throw new Error("soak_restart_exit_not_recorded"); if (current.restart.receipt_at) throw new Error("soak_restart_already_recorded"); if (current.restart.prior_pid === process.pid) throw new Error("soak_restart_requires_distinct_process"); current.restart.receipt_at = new Date().toISOString(); current.restart.replacement_pid = process.pid; writeState(current); return current; });
  console.log(JSON.stringify({ ...preview, result: "restart_recorded", restart: state.restart }, null, 2));
  process.exit(0);
}

let state = await withSoakLock(tickLockPath, () => existsSync(statePath) ? readState() : initializeState());
if (state.terminal) {
  console.log(JSON.stringify({ ...preview, result: state.terminal, state: statePath }, null, 2));
  process.exit(state.terminal === "passed" ? 0 : 1);
}

do {
  state = await withSoakLock(tickLockPath, () => advance(readState()));
  if (state.terminal || process.argv.includes("--once")) break;
  const waitMs = Math.max(250, Math.min(60_000, nextDueMs(state) - Date.now()));
  await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
} while (true);

console.log(JSON.stringify({ ...preview, result: state.terminal ?? "running", ticks: state.ticks.length, useful_turns: state.turns.length, product_cost_usd: state.turns.reduce((sum, turn) => sum + turn.cost_usd, 0), restart: state.restart, state: statePath }, null, 2));
if (state.terminal && state.terminal !== "passed") process.exitCode = 1;

async function advance(current: SoakState): Promise<SoakState> {
  const now = Date.now();
  if (now >= Date.parse(current.restart.due_at) && !current.restart.receipt_at) {
    current.restart.prior_pid = process.pid;
    current.restart.exit_requested_at = new Date(now).toISOString();
    writeState(current);
    console.log(JSON.stringify({ ...preview, result: "restart_required", due_at: current.restart.due_at, prior_pid: current.restart.prior_pid }, null, 2));
    process.exit(75);
  }
  const totalTicks = Math.ceil(campaign.soak!.duration_hours * 60 / campaign.soak!.tick_interval_minutes);
  const elapsedTicks = Math.min(totalTicks, Math.floor((now - Date.parse(current.started_at)) / (campaign.soak!.tick_interval_minutes * 60_000)) + 1);
  while (current.last_tick < elapsedTicks) {
    const index = current.last_tick + 1;
    const usefulTarget = Math.floor(index * campaign.soak!.useful_turn_cap / totalTicks);
    const usefulDue = current.turns.length < usefulTarget;
    current.ticks.push({ index, due_at: new Date(Date.parse(current.started_at) + (index - 1) * campaign.soak!.tick_interval_minutes * 60_000).toISOString(), recorded_at: new Date().toISOString(), reason: usefulDue ? "useful_turn" : "not_useful_due" });
    current.last_tick = index;
    if (usefulDue) {
      const remainingBound = campaign.spend.campaign_max_usd / campaign.soak!.useful_turn_cap;
      const spent = current.turns.reduce((sum, turn) => sum + turn.cost_usd, 0);
      if (spent + remainingBound > requestedMax) { current.terminal = "budget_stop"; break; }
      try { current.turns.push(await usefulTurn(current.turns.length + 1, index, remainingBound)); }
      catch { current.terminal = "infra_invalid"; break; }
    }
    writeState(current);
  }
  if (!current.terminal && now >= Date.parse(current.ends_at)) {
    current.terminal = current.restart.receipt_at && current.turns.length === campaign.soak!.useful_turn_cap && current.ticks.length === totalTicks ? "passed" : "infra_invalid";
  }
  writeState(current);
  if (current.terminal) await finalize(current);
  return current;
}

async function usefulTurn(index: number, tickIndex: number, maxTurnBudgetUsd: number): Promise<SoakState["turns"][number]> {
  const assignment = campaign.assignments[(index - 1) % campaign.assignments.length]!;
  if (!["claude", "codex", "pi"].includes(assignment.runtime)) throw new Error("unsupported_soak_runtime");
  const role: RoleConfig = { name: assignment.role, runtime: assignment.runtime as RoleConfig["runtime"], model: assignment.model, effort: assignment.effort as RoleConfig["effort"], delegation: { allow: [] }, triggers: [], outputs: [], maxTurnBudgetUsd };
  const workdir = join(campaignRoot, "world", "managed", "service"); ensureWorkdir(workdir);
  if (index === 1) servicePreflight(workdir);
  const gate = makeEvalRoleGate(role.name, makeEvalActorGate({ workdir, forbiddenRoots: [join(root, "eval"), join(root, "test"), join(root, "research"), ...forbiddenProductionPaths] }));
  const run = await runRole({ role, app: "service", turnId: `soak-${index}`, dryRun: false, workdir, runlogRoot: join(campaignRoot, "state"), runtimeFor, hooks: { gate }, context: { taste: [], memoryExcerpts: [] }, telemetry: { orgDir: join(campaignRoot, "state"), trigger: "schedule" }, briefOverride: soakTask(role.name, index) });
  if (!run.record) throw new Error("soak_turn_missing_run_record");
  const result = run.record.result;
  if (result.status !== "completed" || result.escalations.length > 0) throw new Error(`soak_turn_not_completed:${result.status}`);
  const artifact = join(workdir, `eval-soak-${index}.md`);
  if (!existsSync(artifact) || readFileSync(artifact, "utf8").trim() === "") throw new Error("soak_turn_missing_declared_artifact");
  servicePreflight(workdir);
  return { index, tick_index: tickIndex, role: role.name, run_id: run.record.runId, cost_usd: result.usage.costUsd, wall_clock_ms: result.usage.wallClockMs, tokens_in: result.usage.tokensIn, tokens_out: result.usage.tokensOut, usage_quality: result.usage.quality ?? (result.usage.costEstimated ? "estimated" : "complete"), status: result.status };
}

function initializeState(): SoakState {
  const started = new Date(); const ends = new Date(started.getTime() + campaign.soak!.duration_hours * 3_600_000); const restart = new Date(started.getTime() + campaign.soak!.deliberate_restart_hour * 3_600_000);
  const value: SoakState = { schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: campaignSha256, started_at: started.toISOString(), ends_at: ends.toISOString(), initial_pid: process.pid, last_tick: 0, ticks: [], turns: [], restart: { due_at: restart.toISOString(), prior_pid: process.pid } };
  mkdirSync(dirname(statePath), { recursive: true }); let fd: number; try { fd = openSync(statePath, "wx", 0o600); } catch (error) { throw error; } try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); } finally { closeSync(fd); } return value;
}
function readState(): SoakState { const value = JSON.parse(readFileSync(statePath, "utf8")) as SoakState; if (value.campaign_id !== campaign.campaign_id || value.campaign_sha256 !== campaignSha256) throw new Error("soak_state_campaign_mismatch"); return value; }
function writeState(value: SoakState): void { mkdirSync(dirname(statePath), { recursive: true }); const temp = `${statePath}.${process.pid}.tmp`; writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); renameSync(temp, statePath); }
function nextDueMs(value: SoakState): number { return Date.parse(value.started_at) + value.last_tick * campaign.soak!.tick_interval_minutes * 60_000; }
function runtimeFor(role: RoleConfig): Runtime { return role.runtime === "claude" ? new ClaudeRuntime({ baseOptions: { settingSources: [], skills: [], plugins: [], env: providerScratch.claudeProcessEnv }, ...(providerScratch.claudeProtectedHome !== undefined ? { protectedHome: providerScratch.claudeProtectedHome } : {}) }) : role.runtime === "codex" ? new CodexRuntime() : new PiRuntime(); }
function soakTask(role: string, index: number): string { return `Isolated Operon evaluation soak turn ${index} for role ${role}. Inspect only the local synthetic service repository. Produce a concise evidence-grounded note or draft in eval-soak-${index}.md. Do not publish, send, deploy, access secrets, use network, or change governance files.`; }
function ensureWorkdir(path: string): void { if (existsSync(path)) return; mkdirSync(path, { recursive: true }); cpSync(join(root, "eval/apps/service/seed"), path, { recursive: true }); execFileSync("git", ["init", "--initial-branch=main"], { cwd: path, stdio: "ignore" }); execFileSync("git", ["-c", "user.name=Operon Eval", "-c", "user.email=eval@operon.invalid", "add", "-A"], { cwd: path }); execFileSync("git", ["-c", "user.name=Operon Eval", "-c", "user.email=eval@operon.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "eval seed"], { cwd: path, stdio: "ignore" }); }
function servicePreflight(path: string): void { runEvalAppGates({ cwd: path, seedDir: join(root, "eval/apps/service/seed"), commands: ["npm test", "npm run e2e"], network: "loopback_only" }); }
async function finalize(value: SoakState): Promise<void> {
  const resultPath = join(campaignRoot, "results", "soak-realtime-48h-v1-real-1.json"); if (existsSync(resultPath)) return;
  const integrity = await reconcileRealtimeSoak({ campaign, campaignSha256, campaignRoot, state: value });
  const accountingRel = join("accounting", "soak-realtime-48h-v1-real-1.json");
  const accountingPath = join(campaignRoot, accountingRel);
  mkdirSync(dirname(accountingPath), { recursive: true });
  writeFileSync(accountingPath, `${JSON.stringify(integrity.receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const cost = value.turns.reduce((sum, turn) => sum + turn.cost_usd, 0); const active = value.turns.reduce((sum, turn) => sum + turn.wall_clock_ms, 0);
  const outcome: AttemptResult["outcome"] = value.terminal === "passed" && integrity.passed ? "passed" : value.terminal === "budget_stop" ? "budget_stop" : value.terminal === "safety_stop" ? "safety_stop" : "infra_invalid";
  const contextSources = integrity.context_sources;
  const contextBytes = integrity.context_rendered_bytes; const terminalAt = new Date().toISOString(); const quality = value.turns.some((turn) => turn.usage_quality === "unavailable") ? "unavailable" : value.turns.some((turn) => turn.usage_quality === "partial") ? "partial" : value.turns.some((turn) => turn.usage_quality === "estimated") ? "estimated" : "complete"; const excluded = (reason: string) => ({ excluded: [reason] });
  const attempt: AttemptResult = { schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: campaignSha256, attempt_id: "soak-realtime-48h-v1-real-1", case_id: "soak/realtime-48h/v1", repetition_id: "real-1", outcome, admitted_at: value.started_at, terminal_at: terminalAt, evidence: ["artifact:soak/state.json", `accounting:${accountingRel}`, ...value.turns.map((turn) => `run:${turn.run_id}`)], metrics: { route: { planned: "standard", final: "standard", model_turns: value.turns.length }, context: { rendered_bytes: contextBytes, sources: contextSources, measurement: "durable_context_manifests" }, cost: { equivalent_usd: cost, product_usd: cost, evaluator_usd: 0, quality }, tokens: { input: value.turns.reduce((sum, turn) => sum + turn.tokens_in, 0), output: value.turns.reduce((sum, turn) => sum + turn.tokens_out, 0), quality }, latency: { elapsed_ms: Date.parse(terminalAt) - Date.parse(value.started_at), active_ms: active, human_wait_ms: 0 }, human_load: { decisions: 0 }, productivity: { productive_passes: value.turns.length, total_passes: value.turns.length, ratio: value.turns.length === 0 ? 0 : 1, repeated_work_cost_usd: 0 }, continuation: excluded("not_continuation_case"), approvals: excluded("not_approval_case"), scheduler: { due_ticks: value.ticks.length, reasoned_ticks: value.ticks.length, reliability: value.ticks.length === 0 ? 0 : 1, duplicate_ticks: integrity.duplicate_ticks }, learning: excluded("not_learning_case"), execution: { terminal_integrity: Number(integrity.receipt.terminal_integrity), provider_turns: value.turns.length, mechanical_steps: value.ticks.length, provider_settlements: integrity.provider_settlements, mechanical_settlements: integrity.mechanical_settlements }, capabilities: { outward_effects: 0, hidden_answer_leakage: false, production_path_overlap: false }, soak: { ticks: value.ticks.length, useful_turns: value.turns.length, restart_receipts: value.restart.receipt_at ? 1 : 0, silent_misses: integrity.silent_misses, orphaned_runs: integrity.orphaned_runs, orphaned_settlements: integrity.orphaned_settlements, distinct_process_restart: integrity.distinct_process_restart } }, exclusions: [], missing: integrity.missing };
  writeAttemptResult(resultPath, attempt);
}
function verifyGitHubEvidence(): void { const evidence = join(campaignRoot, `github-evidence-${campaignSha256.slice(7, 15)}.json`); if (!existsSync(evidence)) throw new Error("disposable_github_campaign_not_proven"); const value = JSON.parse(readFileSync(evidence, "utf8")) as Record<string, unknown>; if (value.campaign_id !== campaign.campaign_id || value.campaign_sha256 !== campaignSha256 || value.result !== "passed") throw new Error("invalid_disposable_github_evidence"); }
function persistReadiness(results: unknown, result: "passed" | "failed"): void { const path = join(campaignRoot, `readiness-${campaignSha256.slice(7, 15)}-${result}.json`); mkdirSync(dirname(path), { recursive: true }); if (existsSync(path)) return; writeFileSync(path, `${JSON.stringify({ schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: campaignSha256, checked_at: new Date().toISOString(), billable: false, result, adapters: results }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
function option(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

function replaceProcessEnv(next: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries(next)) if (value !== undefined) process.env[key] = value;
}
