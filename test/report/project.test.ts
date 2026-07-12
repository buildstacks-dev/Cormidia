import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppsFile } from "../../src/org/apps.js";
import { rollupBudgets } from "../../src/org/budget.js";
import { buildReport } from "../../src/report/project.js";
import type { TurnRecord } from "../../src/runtime/telemetry.js";
import { FakeClock } from "../fixtures/fakeClock.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

const APPS: AppsFile = {
  org: { name: "fixture-org", maxConcurrentTurns: 2 }, defaults: { budgetUsdMonth: 1000 },
  apps: [
    { name: "alpha", repo: "owner/alpha", status: "live", budgetUsdMonth: 100, cadence: {}, channels: {} },
    { name: "beta", repo: "owner/beta", status: "paused", budgetUsdMonth: 200, cadence: {}, channels: {} },
  ],
};

describe("ledger-first report projection", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("groups sessions deterministically and preserves every accounting/quality distinction", async () => {
    home = fixture();
    const clock = new FakeClock("2026-07-12T12:00:00.000Z");
    const report = await buildReport({ orgName: "fixture-org", stateHome: home.root, appsFile: APPS, now: clock.now(), query: { period: "7d" } });

    expect(report.scope).toEqual({ kind: "org", app: null });
    expect(report.sessions.items.map((item) => item.kind)).toEqual(expect.arrayContaining(["parent_task", "standalone_trace", "orphan_run"]));
    expect(report.sessions.items.find((item) => item.id === "task:task-cross")?.apps).toEqual(["alpha", "beta"]);
    expect(report.unattributed_turns).toHaveLength(1);
    expect(report.unattributed_turns[0]).toMatchObject({ app: null, run_id: null, tokens_in: 7 });

    // Observable totals include partial lower bounds, but unavailable and
    // unmeasured zero placeholders are never treated as measured zeros.
    expect(report.headline).toMatchObject({
      known_input_tokens: 557,
      known_output_tokens: 61,
      known_total_tokens: 618,
      cache_read_tokens: 180,
      cache_creation_tokens: 10,
      provider_reported_cost_usd: 2.7,
      operon_estimated_cost_usd: 2,
      partial_recorded_cost_usd: 0.4,
      unknown_usage_turns: 2,
    });
    expect(report.headline.known_total_tokens).toBe(report.headline.known_input_tokens + report.headline.known_output_tokens);
    expect(report.quality).toMatchObject({ duplicate_rows: 1, duplicate_known_tokens: 110, duplicate_recorded_cost_usd: 1, unmeasured_turns: 1, unsettled_passes: 2, terminal_unsettled_usage_passes: 1, missing_envelopes: 4 });
    expect(report.quality.duplicate_keys).toEqual(["alpha/run-complete"]);
    const task = report.session_details.find((item) => item.summary.id === "task:task-cross")!;
    expect(task.summary).toMatchObject({ outcome: "completed", completion_integrity: "complete" });
    expect(task.activities.some((turn) => turn.activity_type === "mechanical_pass" && turn.run_id === "gate-1")).toBe(true);
    expect(task.activities.some((turn) => turn.run_id === "terminal-unsettled" && turn.warnings.some((warning) => warning.includes("--reconcile")))).toBe(true);
    expect(task.activities.filter((turn) => turn.run_id === "retry-failed")).toHaveLength(1);
    expect(report.health.interrupted_turns).toBeGreaterThan(0);
  });

  it("slices cross-app parent tasks and agrees with current-month budget rollup", async () => {
    home = fixture();
    const now = new Date("2026-07-12T12:00:00.000Z");
    const report = await buildReport({ orgName: "fixture-org", stateHome: home.root, appsFile: APPS, now, query: { app: "alpha", period: "90d" } });
    expect(report.sessions.items.find((item) => item.id === "task:task-cross")?.scope_partial).toBe(true);
    expect(report.sessions.items.every((item) => item.apps.every((app) => app === "alpha"))).toBe(true);
    expect(report.unattributed_turns).toEqual([]);
    const budget = await rollupBudgets(home.root, APPS, now);
    expect(report.apps[0]?.current_month_spend_usd).toBe(budget.find((row) => row.app === "alpha")?.spentUsd);
    expect(report.apps[0]?.recorded_equivalent_cost_usd).not.toBe(report.apps[0]?.monthly_budget_usd);
  });

  it("surfaces mid-file corruption, torn tails, invalid/future rows, and pruned detail without failing", async () => {
    home = fixture();
    const file = join(home.root, "telemetry", "2026-07-12.jsonl");
    const existing = readFileSync(file, "utf8");
    const invalidNumeric = JSON.stringify({ ...row("invalid", { tokensIn: -1 }), at: "2026-07-12T08:00:00.000Z" });
    const invalidAt = JSON.stringify({ ...row("invalid-at"), at: "not-a-date" });
    const future = JSON.stringify({ ...row("future"), at: "2026-07-12T23:00:00.000Z" });
    writeFileSync(file, `not-json\n${existing}${invalidNumeric}\n${invalidAt}\n${future}\n{"at":`, "utf8");
    const report = await buildReport({ orgName: "fixture-org", stateHome: home.root, appsFile: APPS, now: new Date("2026-07-12T12:00:00Z"), query: { period: "7d" } });
    expect(report.quality.corrupt_lines).toBeGreaterThanOrEqual(3);
    expect(report.quality.torn_tails).toBe(1);
    expect(report.quality.future_timestamp_rows).toBe(1);
    expect(report.headline.provider_turns).toBeGreaterThan(0);
  });

  it("summary-only removes exhaustive activity deliberately", async () => {
    home = fixture();
    const report = await buildReport({ orgName: "fixture-org", stateHome: home.root, appsFile: APPS, now: new Date("2026-07-12T12:00:00Z"), query: { period: "7d", summaryOnly: true } });
    expect(report.summary_only).toBe(true);
    expect(report.sessions.items.length).toBeGreaterThan(0);
    expect(report.session_details).toEqual([]);
    expect(report.unattributed_turns).toEqual([]);
  });
});

function fixture(): OrgHomeFixture {
  const home = makeOrgHome({ runs: { records: {
    alpha: {
      "run-complete": { envelope: envelope("run-complete", { parent_task_id: "task-cross", trace_id: "trace-a", role: "builder", pass: "implement", usage: { tokens_in: 100, tokens_out: 10, cost_usd: 1, cache_read_tokens: 90, cache_write_tokens: 5, quality: "complete" } }), events: [{ event: "tool.called" }] },
      "retry-failed": { envelope: envelope("retry-failed", { parent_task_id: "task-cross", trace_id: "trace-a", role: "builder", pass: "retry", status: "failed" }), events: [] },
      "trace-only": { envelope: envelope("trace-only", { trace_id: "standalone", role: "reviewer", pass: "review" }), events: [] },
      "gate-1": { envelope: envelope("gate-1", { parent_task_id: "task-cross", trace_id: "trace-a", pipeline: "gates", pass: "quality-gates", role: "quality-gates", usage: undefined }), events: [] },
      "terminal-unsettled": { envelope: envelope("terminal-unsettled", { parent_task_id: "task-cross", trace_id: "trace-a", pass: "contract", usage: { tokens_in: 3, tokens_out: 1, cost_usd: 0.03, quality: "complete" } }), events: [] },
    },
    beta: { "beta-turn": { envelope: envelope("beta-turn", { app: "beta", parent_task_id: "task-cross", trace_id: "trace-b", role: "planner", pipeline: "plan", pass: "plan" }), events: [] } },
  } } });
  write(home.root, "tasks/task-cross/task.json", JSON.stringify({
    schemaVersion: 1, taskId: "task-cross", app: "alpha", objective: "Cross-app objective <script>x</script>", promptRef: "prompt.md", promptSha256: "a".repeat(64), requiredStages: ["builder"], executionMode: "operon", fallbackEvents: [{ at: "2026-07-11T01:00:00Z", reason: "manual retry" }], status: "completed", startedAt: "2026-07-10T00:00:00Z", endedAt: "2026-07-12T10:00:00Z", completionState: { implementation: "complete", ci: "green", operonReview: "approved", humanReview: "not_required", pr: "merged", issuesCloseOnMerge: ["#1"] }, refs: { tickets: ["#1"], traces: ["trace-a", "trace-b"], branches: ["op/1"], prs: ["#2"], reviews: ["review-1"], deployments: [] },
  }));
  const rows: unknown[] = [
    row("run-complete", { parentTaskId: "task-cross", traceId: "trace-a", tokensIn: 100, tokensOut: 10, costUsd: 1, cacheReadTokens: 90, cacheCreationTokens: 5 }),
    row("run-complete", { parentTaskId: "task-cross", traceId: "trace-a", tokensIn: 100, tokensOut: 10, costUsd: 1, cacheReadTokens: 90, cacheCreationTokens: 5 }),
    row("retry-failed", { parentTaskId: "task-cross", traceId: "trace-a", status: "failed", tokensIn: 50, tokensOut: 5, costUsd: 0.5 }),
    row("beta-turn", { app: "beta", parentTaskId: "task-cross", traceId: "trace-b", role: "planner", tokensIn: 200, tokensOut: 20, costUsd: 2, costEstimated: true, usageQuality: "estimated" }),
    row("trace-only", { traceId: "standalone", role: "reviewer", tokensIn: 75, tokensOut: 10, costUsd: 0.2 }),
    row("orphan", { traceId: undefined, tokensIn: 20, tokensOut: 5, costUsd: 0.4, usageQuality: "partial" }),
    row("unavailable", { traceId: "unavailable", tokensIn: 0, tokensOut: 0, costUsd: 0, usageQuality: "unavailable" }),
    row("unmeasured", { traceId: "unmeasured", tokensIn: 0, tokensOut: 0, costUsd: 0, usageQuality: "unavailable", unmeasured: true }),
    { ...row("legacy", { tokensIn: 7, tokensOut: 1, costUsd: 0 }), app: undefined, runId: undefined, traceId: undefined },
    row("pruned", { tokensIn: 5, tokensOut: 0, costUsd: 0 }),
  ];
  write(home.root, "telemetry/2026-07-12.jsonl", rows.map(JSON.stringify).join("\n") + "\n");
  return home;
}

function row(runId: string, patch: Partial<TurnRecord> = {}): TurnRecord {
  return { at: "2026-07-12T09:00:00.000Z", role: "builder", runtime: "codex", model: "model-x", status: "completed", tokensIn: 0, tokensOut: 0, costUsd: 0, usageQuality: "complete", subagentTurns: 0, wallClockMs: 1000, escalations: 0, app: "alpha", runId, pipeline: "build", pass: "implement", ...patch };
}

function envelope(runId: string, patch: Record<string, unknown> = {}): unknown {
  return { schema_version: 1, run_id: runId, trace_id: "trace-default", app: "alpha", pipeline: "build", pass: "implement", role: "builder", runtime: "codex", model: "model-x", effort: "high", status: "completed", started_at: "2026-07-12T08:00:00.000Z", finished_at: "2026-07-12T08:01:00.000Z", wall_clock_ms: 60_000, usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0.01, quality: "complete" }, refs: { events: "events.jsonl", brief: "brief.md", prompt: "prompt.md", output: "output.md", session_log: "session.log" }, ...patch };
}

function write(root: string, relative: string, content: string): void { const path = join(root, relative); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content, "utf8"); }
