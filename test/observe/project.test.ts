import { describe, expect, it } from "vitest";
import type { AppEntry } from "../../src/org/apps.js";
import type { StatusRow } from "../../src/runtime/runlog/status.js";
import { PASS_STALE_AFTER_MS, passLiveness, projectObserveSnapshot } from "../../src/observe/project.js";
import type { IndexedPass, ObserveProjectionInput, SourceHealthView } from "../../src/observe/types.js";

const NOW = new Date("2026-07-12T12:00:00.000Z");

describe("observe projection", () => {
  it("keeps onboarding, non-ticket activity, the ready queue, and approvals distinct", () => {
    const input = baseInput();
    input.apps = [app("alpha", "onboarding"), app("beta", "live"), app("gamma", "paused")];
    input.passes = [indexed(row({ app: "alpha", runId: "same", traceId: "plan-trace", role: "planner", pipeline: "plan" }))];
    input.github = [{
      app: "beta",
      repo: "owner/beta",
      observed_at: NOW.toISOString(),
      issues: [
        issue(1, ["op:ready", "p2", "op:tier-quick"], "## Context\n\n## Scope\n- `src/a.ts`"),
        issue(2, ["op:ready", "p1"], "Depends-on: #1"),
        issue(3, ["op:building"]),
        issue(4, ["op:ready", "op:returned"]),
      ],
      pull_requests: [],
    }];
    input.approvals = [{ item: {
      id: "approval-1", app: "beta", role: "builder", rule: "protocol-self-edit",
      action: { tool: "write", input: {} }, raisedAt: NOW.toISOString(), status: "pending", ticketRef: "#3",
    } }];

    const snapshot = projectObserveSnapshot(input);
    expect(snapshot.apps.map((value) => [value.name, value.lifecycle])).toEqual([
      ["alpha", "onboarding"], ["beta", "live"], ["gamma", "paused"],
    ]);
    expect(snapshot.intake.map((value) => value.kind)).toContain("onboarding");
    expect(snapshot.intake.find((value) => value.trace_id === "plan-trace")?.kind).toBe("planning");
    expect(snapshot.delivery.find((value) => value.issue_number === 1)).toMatchObject({ state: "ready", scheduler_rank: 1, tier: "quick" });
    expect(snapshot.delivery.find((value) => value.issue_number === 2)).toMatchObject({ state: "ready", dependency_blocked: true, scheduler_rank: null });
    expect(snapshot.delivery.find((value) => value.issue_number === 3)?.state).toBe("building");
    expect(snapshot.delivery.find((value) => value.issue_number === 4)).toMatchObject({
      state: "closed_unknown",
      quality_reason: expect.stringContaining("Conflicting"),
    });
    expect(snapshot.approvals[0]).toMatchObject({ approval_id: "approval-1", status: "pending", ticket_ref: "#3" });
  });

  it("projects approval delivery acknowledgement and ambiguous next-action evidence", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    input.approvals = [{ item: {
      id: "approval-delivery-1",
      app: "alpha",
      role: "sre",
      rule: "external-publishing",
      action: { tool: "operon.github.issue.create", input: {} },
      raisedAt: "2026-07-12T10:00:00Z",
      status: "approved",
      decision: "approved",
      decidedAt: "2026-07-12T10:01:00Z",
      execution: {
        state: "ambiguous",
        executor: "durable-github",
        idempotencyKey: "incident:fixture:event",
        attempts: 1,
        actor: "orchestrator/dispatch-reconcile",
        attemptedAt: "2026-07-12T10:02:00Z",
        finishedAt: "2026-07-12T10:03:00Z",
        result: "prior executor stopped before acknowledgement",
        failureCause: "ambiguous_remote_response",
        nextAction: "reconcile",
      },
    } }];
    const snapshot = projectObserveSnapshot(input);
    expect(snapshot.approvals[0]).toMatchObject({
      execution_state: "ambiguous",
      execution_attempts: 1,
      execution_actor: "orchestrator/dispatch-reconcile",
      execution_result: "prior executor stopped before acknowledgement",
      execution_failure_cause: "ambiguous_remote_response",
      execution_next_action: "reconcile",
    });
    expect(snapshot.attention).toContainEqual(expect.objectContaining({
      kind: "approval_delivery",
      detail: expect.stringContaining("actor orchestrator/dispatch-reconcile"),
    }));
  });

  it("uses (app, runId) identity and explicit parent/trace evidence only", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live"), app("beta", "live")];
    input.parent_tasks = [{
      schemaVersion: 1,
      taskId: "outer-1",
      app: "alpha",
      objective: "Ship safely",
      promptRef: "prompt.md",
      promptSha256: "a".repeat(64),
      requiredStages: ["planner", "builder", "reviewer"],
      executionMode: "operon",
      fallbackEvents: [],
      status: "running",
      startedAt: "2026-07-12T11:00:00.000Z",
      refs: { tickets: [], traces: [], branches: [], prs: [], reviews: [], deployments: [] },
    }];
    input.passes = [
      indexed(row({ app: "alpha", runId: "collision", traceId: "trace-a", parentTaskId: "outer-1", role: "planner", pipeline: "plan" })),
      indexed(row({ app: "beta", runId: "collision", traceId: "trace-b", role: "builder", pipeline: "build", ticket: "#9" })),
    ];
    const snapshot = projectObserveSnapshot(input);
    expect(snapshot.passes.map((pass) => pass.id)).toEqual(["pass:alpha:collision", "pass:beta:collision"]);
    expect(snapshot.parent_tasks[0]).toMatchObject({
      trace_ids: ["trace-a"],
      observed_stages: ["planner"],
      missing_required_stages: ["builder", "reviewer"],
      completion_integrity: { operon_end_to_end_complete: false },
    });
    expect(snapshot.traces.find((trace) => trace.trace_id === "trace-b")?.parent_task_id).toBeNull();
  });

  it("pins selected/skipped manifests, liveness boundaries, usage settlement, and honest unknowns", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    const running = row({
      app: "alpha", runId: "run-1", traceId: "trace-1", status: "running",
      lastSeenAt: new Date(NOW.getTime() - PASS_STALE_AFTER_MS).toISOString(),
      tracePlan: { required_passes: ["contract", "implement"], skipped_passes: [{ pass: "security", reason: "quick tier" }] },
      usageQuality: "partial",
    });
    input.passes = [indexed(running)];
    input.ledger = [
      {
        at: NOW.toISOString(), role: "builder", runtime: "codex", model: "gpt-5.5", status: "completed",
        tokensIn: 20, tokensOut: 10, costUsd: 0.2, usageQuality: "estimated", subagentTurns: 0,
        wallClockMs: 1000, escalations: 0, app: "alpha", runId: "run-1", providerTurnId: "turn-1",
        traceId: "trace-1", pipeline: "build", pass: "implement", costEstimated: true,
      },
      {
        at: NOW.toISOString(), role: "builder", runtime: "codex", model: "gpt-5.5", status: "completed",
        tokensIn: 3, tokensOut: 2, costUsd: 0.1, usageQuality: "partial", subagentTurns: 0,
        wallClockMs: 100, escalations: 0, app: "alpha", runId: "run-1", providerTurnId: "turn-2",
        traceId: "trace-1", pipeline: "build", pass: "implement",
      },
    ];
    const snapshot = projectObserveSnapshot(input);
    expect(snapshot.passes[0]).toMatchObject({
      liveness: "live",
      usage: { tokens_in: 23, tokens_out: 12, quality: "partial", settled: true, cost_estimated: true },
    });
    expect(snapshot.passes[0]?.usage.cost_usd).toBeCloseTo(0.3, 10);
    expect(snapshot.traces[0]).toMatchObject({
      required_passes: ["contract", "implement"],
      observed_passes: ["implement"],
      missing_passes: ["contract"],
      skipped_passes: [{ pass: "security", reason: "quick tier" }],
      completion_integrity: { required_stages: "incomplete" },
    });
    expect(passLiveness({ ...running, lastSeenAt: new Date(NOW.getTime() - PASS_STALE_AFTER_MS - 1).toISOString() }, NOW).state).toBe("stalled");
    // Drop lastSeenAt entirely (absent === "no heartbeat") to exercise the unknown state.
    const { lastSeenAt: _omitLastSeenAt, ...runningWithoutLastSeen } = running;
    expect(passLiveness(runningWithoutLastSeen, NOW).state).toBe("unknown");
  });

  it("surfaces corrupt/degraded sources and scrubs previews without loading L3", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    input.corrupt_runs = [{ app: "alpha", run_id: "bad-run", detail: "invalid JSON" }];
    input.corrupt_tasks = [{ task_id: "bad-task", detail: "torn task" }];
    input.source_health = [health("local_files", "degraded", "mid-file corruption"), health("github", "unavailable", "offline")];
    input.passes = [indexed(row({
      app: "alpha", runId: "run-x", traceId: "trace-x",
      previews: { output: `<script>alert(1)</script> ghp_${"A".repeat(36)}` },
      usageQuality: "unavailable",
    }))];
    const snapshot = projectObserveSnapshot(input);
    expect(snapshot.attention.map((item) => item.kind)).toEqual(expect.arrayContaining(["corrupt_run", "corrupt_task", "source_health", "usage_incomplete"]));
    expect(snapshot.passes[0]?.previews.output).toContain("<script>alert(1)</script>");
    expect(snapshot.passes[0]?.previews.output).toContain("[REDACTED:github-token]");
    expect(JSON.stringify(snapshot)).not.toContain("exact raw prompt body");
    expect(snapshot.passes[0]?.artifacts.find((artifact) => artifact.kind === "prompt")?.available).toBe(false);
  });

  it("accepts merge/review/check completion only from explicitly correlated durable GitHub evidence", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    input.passes = [indexed(row({
      app: "alpha", runId: "ship-1", traceId: "trace-ship", ticket: "#5",
      artifacts: [{ kind: "pr", ref: "#7", summary: "durable PR reference" }],
    }))];
    input.github = [{
      app: "alpha",
      repo: "owner/alpha",
      observed_at: NOW.toISOString(),
      issues: [{ ...issue(5, []), state: "CLOSED" }],
      pull_requests: [{
        pull_request: {
          number: 7, title: "build", body: "", state: "MERGED", headRefName: "op/5-build", baseRefName: "main",
          headRefOid: "abc", mergeCommitOid: "merge-abc",
        },
        reviews: [{ state: "APPROVED", body: "", commitId: "abc", submittedAt: NOW.toISOString(), author: "reviewer" }],
        checks: [{ name: "test", state: "SUCCESS" }],
      }],
    }];
    const snapshot = projectObserveSnapshot(input);
    expect(snapshot.delivery[0]).toMatchObject({
      state: "merged",
      pull_requests: [{
        number: 7,
        review_integrity: "fresh_approved",
        check_integrity: "green",
        merge_commit: "merge-abc",
      }],
    });

    input.github[0]!.pull_requests[0]!.reviews[0]!.commitId = "stale";
    expect(projectObserveSnapshot(input).delivery[0]?.pull_requests[0]?.review_integrity).toBe("stale_approval");
  });

  it("uses GitHub closing-issue IDs without inventing a branch-name correlation", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    input.github = [{
      app: "alpha",
      repo: "owner/alpha",
      observed_at: NOW.toISOString(),
      issues: [issue(32, [])],
      pull_requests: [{
        pull_request: {
          number: 33,
          title: "explicit relation",
          body: "",
          state: "MERGED",
          headRefName: "not-derived-from-the-issue",
          baseRefName: "integration",
          headRefOid: "abc",
          mergeCommitOid: "merge-abc",
          closingIssueNumbers: [32],
        },
        reviews: [],
        checks: [],
      }],
    }];

    const ticket = projectObserveSnapshot(input).delivery[0];
    expect(ticket).toMatchObject({
      state: "merged",
      quality_reason: expect.stringContaining("issue remains open"),
      pull_requests: [{ number: 33, merge_commit: "merge-abc" }],
    });
  });
});

function baseInput(): ObserveProjectionInput {
  return {
    now: NOW,
    cursor: "0",
    filters: {},
    org_name: "fixture-org",
    state_home: "/tmp/fixture-org",
    max_concurrent_turns: 2,
    apps: [],
    passes: [],
    corrupt_runs: [],
    parent_tasks: [],
    parent_task_prompts: {},
    corrupt_tasks: [],
    approvals: [],
    ledger: [],
    invocations: [],
    schedule: {},
    locks: [],
    inbox: [],
    github: [],
    source_health: [health("local_files", "healthy", "ok"), health("github", "healthy", "ok")],
  };
}

function app(name: string, status: AppEntry["status"]): AppEntry {
  return { name, repo: `owner/${name}`, status, budgetUsdMonth: 1000, cadence: {}, channels: {} };
}

function row(overrides: Partial<StatusRow> & { app: string; runId: string; traceId: string }): StatusRow {
  return {
    pipeline: overrides.pipeline ?? "build",
    pass: overrides.pass ?? "implement",
    role: overrides.role ?? "builder",
    status: overrides.status ?? "completed",
    durationMs: 1_000,
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.1,
    costEstimated: false,
    usageQuality: overrides.usageQuality ?? "complete",
    escalations: 0,
    toolCalls: 0,
    startedAt: "2026-07-12T11:30:00.000Z",
    refs: { events: "events.jsonl", brief: "brief.md", prompt: "prompt.md", output: "output.md", session_log: "session.log" },
    runtime: "codex",
    model: "gpt-5.5",
    effort: "high",
    ...overrides,
  };
}

function indexed(value: StatusRow): IndexedPass {
  return {
    row: value,
    events: [],
    artifacts: {
      envelope: { available: true, size: 100 },
      events: { available: true, size: 0 },
      brief: { available: false, size: 0 },
      prompt: { available: false, size: 0 },
      output: { available: false, size: 0 },
      activity_log: { available: false, size: 0 },
    },
  };
}

function issue(number: number, labels: string[], body = ""): { number: number; title: string; body: string; labels: string[]; state: "OPEN" } {
  return { number, title: `Issue ${number}`, body, labels, state: "OPEN" };
}

function health(id: SourceHealthView["id"], status: SourceHealthView["status"], detail: string): SourceHealthView {
  return { id, status, detail, observed_at: NOW.toISOString(), last_success_at: status === "unavailable" ? null : NOW.toISOString() };
}
