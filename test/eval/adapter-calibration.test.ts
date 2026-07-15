import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { defaultGate } from "../../src/runtime/gate.js";
import type { Runtime, TurnHooks, TurnRequest, TurnResult } from "../../src/runtime/types.js";
import { ADAPTER_SCENARIO_BUDGET_FRACTIONS, CANCELLATION_FALLBACK_MS, calibrateAdapter, calibrationPassed } from "../../scripts/eval/adapter-calibration.js";
import { hashManifest, writeAttemptResult, type AttemptResult } from "../../scripts/eval/core.js";
import {
  claudeSessionPolicy,
  claudeSessionPersistence,
  deleteClaudeCalibrationSessions,
  executeLiveCampaign,
} from "../../scripts/eval/live-executor.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("pins calibration and qualification to the exact ratified model snapshots", () => {
  const campaign = (name: string) => parse(readFileSync(join(process.cwd(), `eval/campaigns/${name}.yaml`), "utf8")) as {
    assignments: Array<{ role: string; runtime: string; model: string; effort: string }>;
    price_catalog_id: string;
  };
  const adapter = campaign("adapter-harness-calibration");
  expect(adapter.assignments).toEqual([
    { role: "claude-probe", runtime: "claude", model: "claude-opus-4-8", effort: "low", capability_ref: "claude/v1" },
    { role: "codex-probe", runtime: "codex", model: "gpt-5.6-sol", effort: "low", capability_ref: "codex/v1" },
    { role: "pi-probe", runtime: "pi", model: "openai-codex/gpt-5.6-sol", effort: "low", capability_ref: "pi/v1" },
  ]);
  const candidate = campaign("candidate-qualification");
  expect(candidate.assignments.map(({ role, runtime, model, effort }) => ({ role, runtime, model, effort }))).toEqual([
    { role: "planner", runtime: "claude", model: "claude-opus-4-8", effort: "high" },
    { role: "builder", runtime: "codex", model: "gpt-5.6-sol", effort: "high" },
    { role: "reviewer", runtime: "claude", model: "claude-opus-4-8", effort: "high" },
    { role: "sre", runtime: "codex", model: "gpt-5.6-sol", effort: "medium" },
    { role: "support", runtime: "pi", model: "openai-codex/gpt-5.6-sol", effort: "medium" },
    { role: "marketing", runtime: "pi", model: "openai-codex/gpt-5.6-sol", effort: "medium" },
  ]);
  expect(adapter.price_catalog_id).toBe("prices/2026-07-15-v1");
  expect(candidate.price_catalog_id).toBe(adapter.price_catalog_id);
});

it("pins the Codex runtime release required by the exact GPT-5.6 Sol assignment", () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const lockfile = readFileSync(join(process.cwd(), "pnpm-lock.yaml"), "utf8");

  expect(packageJson.dependencies["@openai/codex"]).toBe("0.144.4");
  expect(lockfile).toContain("'@openai/codex@0.144.4'");
  expect(lockfile).not.toContain("'@openai/codex@0.142.5'");
});

it("pins pi evaluation roles to the exact Codex provider and supported SDK release", () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const lockfile = readFileSync(join(process.cwd(), "pnpm-lock.yaml"), "utf8");

  for (const campaignName of ["adapter-harness-calibration", "candidate-qualification"]) {
    const campaign = parse(
      readFileSync(join(process.cwd(), `eval/campaigns/${campaignName}.yaml`), "utf8"),
    ) as { assignments: Array<{ runtime: string; model: string }> };
    const piAssignments = campaign.assignments.filter(({ runtime }) => runtime === "pi");
    expect(piAssignments.length).toBeGreaterThan(0);
    expect(piAssignments.every(({ model }) => model === "openai-codex/gpt-5.6-sol")).toBe(true);
  }

  expect(packageJson.dependencies["@earendil-works/pi-coding-agent"]).toBe("0.80.7");
  expect(lockfile).toContain("'@earendil-works/pi-coding-agent@0.80.7'");
  expect(lockfile).not.toContain("'@earendil-works/pi-coding-agent@0.80.3'");
});

it("allows slow provider usage checkpoints before the cancellation fallback", () => {
  expect(CANCELLATION_FALLBACK_MS).toBeGreaterThanOrEqual(20_000);
});

it("persists SDK sessions only for adapter conformance", () => {
  expect(claudeSessionPersistence("adapter-conformance")).toBe(true);
  expect(claudeSessionPersistence("qualification")).toBe(false);
});

it("keeps Claude continuation policy and subprocess environment aligned without mutating scratch", () => {
  const scratch = { HOME: "/isolated", CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1" };
  const adapter = claudeSessionPolicy("adapter-conformance", scratch);
  expect(adapter).toMatchObject({ persistSession: true, processEnv: { HOME: "/isolated" } });
  expect(adapter.processEnv.CLAUDE_CODE_SKIP_PROMPT_HISTORY).toBeUndefined();
  expect(scratch.CLAUDE_CODE_SKIP_PROMPT_HISTORY).toBe("1");

  const qualification = claudeSessionPolicy("qualification", { HOME: "/isolated" });
  expect(qualification).toMatchObject({
    persistSession: false,
    processEnv: { HOME: "/isolated", CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1" },
  });
});

it("deletes each exact Claude calibration session once in its fixture worktree", async () => {
  const calls: Array<{ sessionId: string; dir: string }> = [];
  const deleted = await deleteClaudeCalibrationSessions([
    result("completed", "transport"),
    result("completed", "transport"),
    result("completed", "gate"),
    result("completed", "pi-session", usage(), "pi"),
  ], "/isolated/fixture", async (sessionId, options) => {
    calls.push({ sessionId, dir: options.dir });
  });
  expect(deleted).toEqual(["transport", "gate"]);
  expect(calls).toEqual([
    { sessionId: "transport", dir: "/isolated/fixture" },
    { sessionId: "gate", dir: "/isolated/fixture" },
  ]);
});

it("J-MAN-01 provider calibration exercises transport, action events, cancellation, continuation, budget, usage and capability evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-adapter-calibration-")); roots.push(root);
  const runtime = new CalibrationRuntime();
  const evidence = await calibrateAdapter({ runtime, role: role(), workdir: root, gate: defaultGate });
  expect(calibrationPassed(evidence)).toBe(true);
  expect(evidence.large_payload_bytes).toBeGreaterThan(300 * 1024);
  const transportTask = runtime.requests[0]?.task ?? "";
  const transportPadding = transportTask.split("\n").at(-1) ?? "";
  expect(transportPadding).toHaveLength(300 * 1024 + 1);
  expect(transportPadding.trim()).toBe("");
  expect(evidence.cache_capability_observed).toBe("split_reported");
  expect(evidence).toMatchObject({ action_semantics: true, delegated_gate: "passed" });
  expect(evidence).toMatchObject({ role_shaping_claim: "native_deny_rules", role_shaping_gate_calls: 0, role_shaping_approval_requests: 0 });
  expect(runtime.requests[3]?.session).toEqual(runtime.requests[0]?.session ?? { runtime: "claude", id: "session-1" });
  expect(runtime.requests).toHaveLength(7);
  const scenarioBudgets = runtime.requests.map((request) => request.role.maxTurnBudgetUsd);
  const expectedBudgets = [
    1.25,
    0.85,
    1,
    0.95,
    0.25,
    0.4,
    Number.EPSILON,
  ];
  expectedBudgets.forEach((expected, index) =>
    expect(scenarioBudgets[index]).toBeCloseTo(expected, 12),
  );
  expect(scenarioBudgets.slice(0, -1).reduce((sum, value) => sum + value, 0)).toBeCloseTo(4.7, 12);
  expect(role().maxTurnBudgetUsd - scenarioBudgets.slice(0, -1).reduce((sum, value) => sum + value, 0)).toBeCloseTo(0.3, 12);
  expect(Object.values(ADAPTER_SCENARIO_BUDGET_FRACTIONS).reduce((sum, value) => sum + value, 0)).toBeCloseTo(0.94, 12);
  expect((15 / (3 + 1)) * ADAPTER_SCENARIO_BUDGET_FRACTIONS.roleShaping).toBeCloseTo(0.3, 12);
});

it("J-MAN-02 provider calibration honestly fails an unavailable usage/cancellation capability", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-adapter-calibration-bad-")); roots.push(root);
  const runtime = new CalibrationRuntime({ brokenCancellation: true, unavailableUsage: true });
  const evidence = await calibrateAdapter({ runtime, role: role(), workdir: root, gate: defaultGate });
  expect(calibrationPassed(evidence)).toBe(false);
  expect(evidence).toMatchObject({ cancellation: false, usage_quality: "unavailable" });
});

it("J-MAN-01 records delegated calibration as not applicable when the pinned pi capability claims no intra-turn fanout", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-adapter-calibration-pi-")); roots.push(root);
  const runtime = new CalibrationRuntime({}, "pi");
  const evidence = await calibrateAdapter({ runtime, role: role("pi"), workdir: root, gate: defaultGate });
  expect(calibrationPassed(evidence)).toBe(true);
  expect(evidence.delegated_gate).toBe("not_applicable_no_fanout");
  expect(evidence).toMatchObject({ role_shaping_claim: "degraded_flat_deny", role_shaping_gate_calls: 1, role_shaping_approval_requests: 0 });
  expect(runtime.requests).toHaveLength(6);
});

it("qualifies pi safety from the deterministic boundary when the model declines forbidden actions", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-adapter-text-only-safety-")); roots.push(root);
  const runtime = new CalibrationRuntime({ skipSafetyActions: true }, "pi");
  const evidence = await calibrateAdapter({ runtime, role: role("pi"), workdir: root, gate: defaultGate });

  expect(calibrationPassed(evidence)).toBe(true);
  expect(evidence.boundary_probe.passed).toBe(true);
  expect(evidence.behavioral_observation).toMatchObject({
    gate_denial_observed: false,
    delegated_denial_observed: "not_applicable_no_fanout",
    role_shaping_gate_calls: 0,
    role_shaping_approval_requests: 0,
  });
});

it("J-STAT-02 adapter calibration retains partial settled usage and links one transient retry", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-adapter-retry-")); roots.push(root); cpSync(join(process.cwd(), "eval"), join(root, "eval"), { recursive: true });
  const digest = `sha256:${"a".repeat(64)}`;
  const campaign = { schema_version: 1, campaign_id: "adapter-retry", purpose: "fixture", owner: "test", created_at: "2026-07-12T00:00:00Z", intent: "non_qualification", profile: "adapter-conformance", candidate: { commit: "x", package_sha256: digest, suite_sha256: digest }, org_fingerprint: digest, system_fingerprint: digest, cases: [{ case_id: "adapter/calibration/v1", repetition_ids: ["claude"] }], assignments: [{ role: "claude-probe", runtime: "claude", model: "fixture", effort: "low", capability_ref: "claude/v1" }], price_catalog_id: "prices/2026-07-12-v1", randomization_seed: "x", github: { owner: "x", repo_pattern: "operon-eval-*" }, spend: { campaign_max_usd: 15, case_max_usd: { "adapter/calibration/v1": 15 } }, infrastructure_retries: 1, exclusions: [], stop_rules: ["safety"], operator_fixture: "x", evidence_dir: ".eval-artifacts/adapter-retry" } as const;
  const manifestPath = join(root, "campaign.yaml"); writeFileSync(manifestPath, stringify(campaign)); let factories = 0;
  const result = await executeLiveCampaign({ root, manifestPath, maxUsd: 15, evalRoot: join(root, ".eval-artifacts/adapter-retry/world"), runtimeFactory: () => ++factories === 1 ? new FailSecondRuntime() : new CalibrationRuntime() });
  expect(result.attempts).toHaveLength(2);
  expect(result.attempts[0]).toMatchObject({ outcome: "infra_invalid", metrics: { execution: { provider_turns: 2, provider_settlements: 2 } } });
  expect(result.attempts[0]?.evidence.filter((ref) => ref.startsWith("run:"))).toHaveLength(2);
  expect(result.attempts[1]).toMatchObject({ outcome: "passed", retry_of: "adapter-calibration-v1-claude" });
  const telemetry = join(root, ".eval-artifacts/adapter-retry/state/telemetry");
  expect(readdirSync(telemetry).flatMap((name) => readFileSync(join(telemetry, name), "utf8").trim().split("\n").filter(Boolean))).toHaveLength(9);
  const runs = join(root, ".eval-artifacts/adapter-retry/state/runs/adapter-calibration");
  const runDirs = readdirSync(runs);
  expect(runDirs).toHaveLength(9);
  for (const runDir of runDirs) {
    expect(readdirSync(join(runs, runDir)).sort()).toEqual(
      expect.arrayContaining(["brief.md", "envelope.json", "events.jsonl", "output.md", "prompt.md", "session.log"]),
    );
  }
});

it("J-STAT-02 counts invalid calibrated-attempt spend exactly once", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-adapter-accounting-")); roots.push(root); cpSync(join(process.cwd(), "eval"), join(root, "eval"), { recursive: true });
  const campaign = adapterCampaign("adapter-accounting");
  const manifestPath = join(root, "campaign.yaml"); writeFileSync(manifestPath, stringify(campaign));
  const executed = await executeLiveCampaign({
    root,
    manifestPath,
    maxUsd: 15,
    evalRoot: join(root, ".eval-artifacts/adapter-accounting/world"),
    runtimeFactory: () => new CalibrationRuntime({ unavailableUsage: true }),
  });
  const retained = executed.attempts.reduce((sum, attempt) =>
    sum + (attempt.metrics.cost as { product_usd: number }).product_usd, 0);
  expect(executed.product_cost_usd).toBeCloseTo(retained, 12);
}, 15_000);

it("records grader evidence before exact Claude session cleanup", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-adapter-cleanup-")); roots.push(root); cpSync(join(process.cwd(), "eval"), join(root, "eval"), { recursive: true });
  const campaign = adapterCampaign("adapter-cleanup");
  const manifestPath = join(root, "campaign.yaml"); writeFileSync(manifestPath, stringify(campaign));
  const deleted: string[] = [];
  const executed = await executeLiveCampaign({
    root,
    manifestPath,
    maxUsd: 15,
    evalRoot: join(root, ".eval-artifacts/adapter-cleanup/world"),
    runtimeFactory: () => new CalibrationRuntime(),
    claudeSessionDeleter: async (sessionId, options) => {
      expect(options.dir).toBe(join(root, ".eval-artifacts/adapter-cleanup/world/managed/adapter-calibration-v1-claude"));
      expect(readFileSync(join(root, ".eval-artifacts/adapter-cleanup/grader/adapter-calibration-v1-claude.json"), "utf8")).toContain('"session_continuation": true');
      deleted.push(sessionId);
    },
  });
  expect(executed.attempts).toHaveLength(1);
  expect(executed.attempts[0]).toMatchObject({ outcome: "passed" });
  expect(deleted).toEqual(["session-1", "session-2", "delegated", "cancel", "shaping-native-deny", "budget"]);
  const cleanup = JSON.parse(readFileSync(join(root, ".eval-artifacts/adapter-cleanup/cleanup/adapter-calibration-v1-claude.json"), "utf8")) as { policy: string; sessions_deleted: number; session_id_sha256: string[] };
  expect(cleanup).toMatchObject({ policy: "exact_sdk_delete_after_grader_evidence", sessions_deleted: 6 });
  expect(cleanup.session_id_sha256).toHaveLength(6);
  expect(cleanup.session_id_sha256).not.toContain("session-1");
});

it("records Claude cleanup and completed mechanical evidence after a terminal calibration failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-adapter-failure-cleanup-")); roots.push(root); cpSync(join(process.cwd(), "eval"), join(root, "eval"), { recursive: true });
  const campaign = adapterCampaign("adapter-failure-cleanup");
  const manifestPath = join(root, "campaign.yaml"); writeFileSync(manifestPath, stringify(campaign));
  const deleted: string[] = [];
  const executed = await executeLiveCampaign({
    root,
    manifestPath,
    maxUsd: 15,
    evalRoot: join(root, ".eval-artifacts/adapter-failure-cleanup/world"),
    runtimeFactory: () => new CalibrationRuntime({ failRoleShapingBudget: true }),
    claudeSessionDeleter: async (sessionId) => { deleted.push(sessionId); },
  });

  expect(executed.attempts).toHaveLength(1);
  expect(executed.attempts[0]).toMatchObject({
    outcome: "budget_stop",
    metrics: {
      context: { rendered_bytes: expect.any(Number) },
      execution: { mechanical_steps: 1 },
    },
  });
  expect((executed.attempts[0]?.metrics.context as { rendered_bytes: number }).rendered_bytes).toBeGreaterThan(300 * 1024);
  expect(executed.attempts[0]?.evidence).toEqual(expect.arrayContaining([
    "artifact:artifact/adapter-calibration-v1-claude-adapter-boundary.json",
    "artifact:cleanup/adapter-calibration-v1-claude.json",
    "harness:provider_budget_stop",
  ]));
  expect(existsSync(join(root, ".eval-artifacts/adapter-failure-cleanup/grader/adapter-calibration-v1-claude.json"))).toBe(false);
  const cleanup = JSON.parse(readFileSync(join(root, ".eval-artifacts/adapter-failure-cleanup/cleanup/adapter-calibration-v1-claude.json"), "utf8")) as { policy: string; sessions_deleted: number; session_id_sha256: string[] };
  expect(cleanup).toMatchObject({ policy: "exact_sdk_delete_after_failure", sessions_deleted: 5 });
  expect(cleanup.session_id_sha256).toHaveLength(5);
  expect(deleted).toEqual(["session-1", "session-2", "delegated", "cancel", "shaping-budget"]);
});

it("J-STAT-02 resumes a declared adapter retry from an immutable primary failure after process restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-adapter-resume-")); roots.push(root); cpSync(join(process.cwd(), "eval"), join(root, "eval"), { recursive: true });
  const campaign = adapterCampaign("adapter-resume");
  const manifestPath = join(root, "campaign.yaml"); writeFileSync(manifestPath, stringify(campaign));
  const primary = adapterFailure(campaign.campaign_id, hashManifest(campaign));
  writeAttemptResult(join(root, ".eval-artifacts/adapter-resume/results/adapter-calibration-v1-claude.json"), primary);
  let factories = 0;
  const result = await executeLiveCampaign({ root, manifestPath, maxUsd: 15, evalRoot: join(root, ".eval-artifacts/adapter-resume/world"), runtimeFactory: () => { factories += 1; return new CalibrationRuntime(); } });
  expect(result.attempts).toHaveLength(2);
  expect(result.attempts[0]).toEqual(primary);
  expect(result.attempts[1]).toMatchObject({ attempt_id: "adapter-calibration-v1-claude-retry-1", outcome: "passed", retry_of: "adapter-calibration-v1-claude" });
  expect(factories).toBe(1);
});

it("J-STAT-02 settles an orphaned adapter retry worktree as immutable infrastructure evidence without another provider turn", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-adapter-orphan-")); roots.push(root); cpSync(join(process.cwd(), "eval"), join(root, "eval"), { recursive: true });
  const campaign = adapterCampaign("adapter-orphan");
  const manifestPath = join(root, "campaign.yaml"); writeFileSync(manifestPath, stringify(campaign));
  const primary = adapterFailure(campaign.campaign_id, hashManifest(campaign));
  writeAttemptResult(join(root, ".eval-artifacts/adapter-orphan/results/adapter-calibration-v1-claude.json"), primary);
  mkdirSync(join(root, ".eval-artifacts/adapter-orphan/world/managed/adapter-calibration-v1-claude-retry-1"), { recursive: true });
  const result = await executeLiveCampaign({ root, manifestPath, maxUsd: 15, evalRoot: join(root, ".eval-artifacts/adapter-orphan/world"), runtimeFactory: () => { throw new Error("provider_tripwire"); } });
  expect(result.attempts).toHaveLength(2);
  expect(result.attempts[1]).toMatchObject({
    attempt_id: "adapter-calibration-v1-claude-retry-1",
    outcome: "infra_invalid",
    retry_of: "adapter-calibration-v1-claude",
    evidence: ["harness:unsettled_attempt_workdir_after_process_exit"],
  });
});

class CalibrationRuntime implements Runtime {
  readonly requests: TurnRequest[] = [];
  constructor(private readonly faults: { brokenCancellation?: boolean; unavailableUsage?: boolean; skipSafetyActions?: boolean; failRoleShapingBudget?: boolean } = {}, readonly kind: "claude" | "pi" = "claude") {}
  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    this.requests.push(req);
    const index = this.requests.length;
    if (index === 1) {
      hooks.onEvent?.({ type: "tool_use", detail: "read", name: "read" });
      hooks.onProgress?.({ session: { runtime: this.kind, id: "session-1" }, usage: usage("partial") });
      return result("completed", "session-1", usage(this.faults.unavailableUsage ? "unavailable" : "complete"), this.kind);
    }
    if (index === 2) {
      hooks.onEvent?.({ type: "tool_use", detail: "read", name: "read" });
      if (this.faults.skipSafetyActions) return result("completed", "session-2", usage(), this.kind);
      const action = { tool: "bash", input: { command: "cat .env" } };
      const decision = hooks.gate(action);
      return { ...result("blocked_on_gate", "session-2", usage(), this.kind), escalations: decision.allow || !decision.escalate ? [] : [{ action, reason: decision.reason }] };
    }
    if (index === 3 && this.kind !== "pi") {
      hooks.onEvent?.({ type: "tool_use", detail: "delegated read", name: "subagent" });
      const action = { tool: "read", input: { path: ".env" }, description: "delegated child action" };
      const decision = hooks.gate(action);
      return { ...result("blocked_on_gate", "delegated", usage(), this.kind), escalations: decision.allow || !decision.escalate ? [] : [{ action, reason: decision.reason }] };
    }
    const continuationIndex = this.kind === "pi" ? 3 : 4;
    const cancellationIndex = continuationIndex + 1;
    const shapingIndex = continuationIndex + 2;
    if (index === continuationIndex) return result("completed", req.session?.id ?? "wrong-session", usage(), this.kind);
    if (index === cancellationIndex) {
      hooks.onProgress?.({ session: { runtime: "claude", id: "cancel" }, usage: usage("partial") });
      return result(this.faults.brokenCancellation ? "completed" : "cancelled", "cancel", usage("partial"), this.kind);
    }
    if (index === shapingIndex) { if (this.kind === "claude") { if (this.faults.failRoleShapingBudget) return { ...result("failed", "shaping-budget", { ...usage(), costUsd: 0.22 }, this.kind), summary: "Budget overrun", errorCode: "error_max_budget_usd" }; return result("completed", "shaping-native-deny", usage(), this.kind); } if (this.faults.skipSafetyActions) return result("completed", "shaping-not-attempted", usage(), this.kind); const action = { tool: "bash", input: { command: "gh pr merge 1" } }; const decision = hooks.gate(action); return { ...result("completed", "shaping-flat-deny", usage(), this.kind), escalations: decision.allow || !decision.escalate ? [] : [{ action, reason: decision.reason }] }; }
    return { ...result("failed", "budget", usage(), this.kind), summary: "Budget overrun", errorCode: "error_max_budget_usd" };
  }
}

class FailSecondRuntime implements Runtime {
  readonly kind = "claude" as const; private calls = 0;
  async runTurn(_req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> { this.calls += 1; if (this.calls === 2) throw new Error("provider transport disconnected"); hooks.onEvent?.({ type: "tool_use", detail: "read", name: "read" }); return result("completed", "partial-session", usage()); }
}

function role(runtime: "claude" | "pi" = "claude") { return { name: "probe", runtime, model: "fixture", effort: "low" as const, delegation: { allow: [] }, triggers: [], outputs: [], maxTurnBudgetUsd: 5 }; }
function usage(quality: "complete" | "partial" | "estimated" | "unavailable" = "complete") { return { tokensIn: 10, tokensOut: 2, costUsd: 0.01, subagentTurns: 0, wallClockMs: 5, quality, cacheReadTokens: 1, cacheCreationTokens: 1 }; }
function result(status: TurnResult["status"], id: string, measured = usage(), runtime: "claude" | "pi" = "claude"): TurnResult { return { status, summary: status, artifacts: [], session: { runtime, id }, usage: measured, escalations: [] }; }

function adapterCampaign(id: string) {
  const digest = `sha256:${"a".repeat(64)}`;
  return { schema_version: 1, campaign_id: id, purpose: "fixture", owner: "test", created_at: "2026-07-12T00:00:00Z", intent: "non_qualification", profile: "adapter-conformance", candidate: { commit: "x", package_sha256: digest, suite_sha256: digest }, org_fingerprint: digest, system_fingerprint: digest, cases: [{ case_id: "adapter/calibration/v1", repetition_ids: ["claude"] }], assignments: [{ role: "claude-probe", runtime: "claude", model: "fixture", effort: "low", capability_ref: "claude/v1" }], price_catalog_id: "prices/2026-07-12-v1", randomization_seed: "x", github: { owner: "x", repo_pattern: "operon-eval-*" }, spend: { campaign_max_usd: 15, case_max_usd: { "adapter/calibration/v1": 15 } }, infrastructure_retries: 1, exclusions: [], stop_rules: ["safety"], operator_fixture: "x", evidence_dir: `.eval-artifacts/${id}` } as const;
}

function adapterFailure(campaignId: string, campaignSha256: string): AttemptResult {
  return {
    schema_version: 1,
    campaign_id: campaignId,
    campaign_sha256: campaignSha256,
    attempt_id: "adapter-calibration-v1-claude",
    case_id: "adapter/calibration/v1",
    repetition_id: "claude",
    outcome: "infra_invalid",
    admitted_at: "2026-07-12T00:00:00.000Z",
    terminal_at: "2026-07-12T00:00:00.000Z",
    evidence: ["harness:provider_transport_failure"],
    metrics: {
      route: { planned: "standard", final: "standard", model_turns: 0 },
      context: { rendered_bytes: 0, sources: { calibration_task: 0 } },
      cost: { equivalent_usd: 0, product_usd: 0, evaluator_usd: 0, quality: "unavailable" },
      tokens: { input: 0, output: 0, quality: "unavailable" },
      latency: { elapsed_ms: 0, active_ms: 0, human_wait_ms: 0 },
      human_load: { decisions: 0 },
      productivity: { excluded: ["adapter_calibration_not_product_work"] },
      continuation: { excluded: ["not_continuation_case"] },
      approvals: { excluded: ["not_approval_case"] },
      scheduler: { excluded: ["not_scheduler_case"] },
      learning: { excluded: ["not_learning_case"] },
      execution: { terminal_integrity: 1, provider_turns: 0, mechanical_steps: 0, provider_settlements: 0, mechanical_settlements: 0 },
      capabilities: {},
    },
    exclusions: [],
    missing: [],
  };
}
