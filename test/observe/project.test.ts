import { describe, expect, it } from "vitest";
import type { AppEntry } from "../../src/org/apps.js";
import type { StatusRow } from "../../src/runtime/runlog/status.js";
import { PASS_STALE_AFTER_MS, passLiveness, projectObserveSnapshot } from "../../src/observe/project.js";
import type { RunlogEvent } from "../../src/runtime/runlog/events.js";
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
    // `intake` was split: the undated onboarding row is pending intake, the
    // dated planning trace is recorded activity. Same evidence, two collections.
    expect(snapshot.pending_intake.rows.map((value) => value.source)).toContain("app_lifecycle");
    expect(snapshot.pending_intake.rows.find((value) => value.app === "alpha")?.state).toBe("awaiting_promotion");
    expect(snapshot.activity_history.rows.find((value) => value.trace_id === "plan-trace")?.kind).toBe("planning");
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

    // "Latest review" must be an INSTANT compare: a non-UTC offset that is
    // genuinely later sorts below a raw-string compare of the same values.
    input.github[0]!.pull_requests[0]!.reviews = [
      { state: "APPROVED", body: "", commitId: "abc", submittedAt: "2026-07-12T09:00:00Z", author: "reviewer" },
      { state: "CHANGES_REQUESTED", body: "", commitId: "abc", submittedAt: "2026-07-12T13:00:00+02:00", author: "other" },
    ];
    expect(projectObserveSnapshot(input).delivery[0]?.pull_requests[0]?.review_integrity).toBe("changes_requested");
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


describe("attention grouping (#91)", () => {
  it("groups equivalent conditions by typed cause and scope, keeping the flat list whole", () => {
    const snapshot = projectObserveSnapshot(campaignAttentionInput());
    const usage = snapshot.attention_groups.filter((group) => group.kind === "usage_incomplete");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      cause: "unavailable",
      scope: { app: "alpha" },
      occurrence_count: 26,
      groupable: true,
    });

    // The flat/grouped consistency invariant, over the whole snapshot.
    const byId = new Map(snapshot.attention_groups.map((group) => [group.id, group]));
    for (const item of snapshot.attention) expect(byId.has(item.group_id)).toBe(true);
    for (const group of snapshot.attention_groups) {
      expect(snapshot.attention.filter((item) => item.group_id === group.id)).toHaveLength(group.occurrence_count);
    }
  });

  it("never merges a different app or a different typed cause into one group", () => {
    const input = campaignAttentionInput();
    for (let index = 0; index < 3; index += 1) {
      input.passes.push(indexed(row({ app: "beta", runId: `beta-run-${index}`, traceId: "beta-trace", usageQuality: "unavailable" })));
    }
    input.passes.push(indexed(row({ app: "alpha", runId: "partial-run", traceId: "trace-partial", usageQuality: "partial" })));
    input.apps = [...input.apps, app("beta", "live")];

    const groups = projectObserveSnapshot(input).attention_groups.filter((group) => group.kind === "usage_incomplete");
    expect(groups.map((group) => group.occurrence_count)).toEqual([26, 3, 1]);
    expect(new Set(groups.map((group) => group.scope.app)).size).toBe(2);
    // Keying on `kind` alone (29) or on kind+title text (27) merges these.
    expect(groups.some((group) => group.occurrence_count === 29)).toBe(false);
    expect(groups.some((group) => group.occurrence_count === 27)).toBe(false);
  });

  it("keys only on typed identity fields — never on text, never on a bare runId", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live"), app("beta", "live")];
    // Same runId under two apps: runId alone is NOT globally unique.
    input.passes = [
      indexed(row({ app: "alpha", runId: "run-x", traceId: "trace-a", role: "planner", pass: "contract", usageQuality: "unavailable" })),
      indexed(row({ app: "beta", runId: "run-x", traceId: "trace-b", role: "builder", pass: "implement", usageQuality: "unavailable" })),
    ];
    const groups = projectObserveSnapshot(input).attention_groups.filter((group) => group.kind === "usage_incomplete");
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.occurrences.map((occurrence) => occurrence.id)))
      .toEqual([["pass:alpha:run-x"], ["pass:beta:run-x"]]);
    for (const group of groups) {
      expect(group.id).not.toContain(group.occurrences[0]!.summary);
      expect(group.id).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(group.cause_key).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("summarizes the affected passes/traces/labels without deduping occurrences by label", () => {
    const snapshot = projectObserveSnapshot(campaignAttentionInput());
    const group = snapshot.attention_groups.find((candidate) => candidate.kind === "usage_incomplete")!;
    // All 26 share one role/pass label but are 26 distinct runs. The field is
    // `labels`, not `roles`: `builder/implement` is a role/pass label, not a role.
    expect(group.affected.labels).toEqual(["builder/implement"]);
    expect(group.affected.passes).toHaveLength(26);
    expect(group.occurrence_count).toBe(26);
    expect(group.affected.passes).toEqual([...group.affected.passes].sort(codeUnitCompare));
    expect(new Set(group.affected.passes).size).toBe(26);
    expect(group.affected.traces).toEqual([...group.affected.traces].sort(codeUnitCompare));
  });

  it("carries evidence references without fabricating a path for a sourceless condition", () => {
    const snapshot = projectObserveSnapshot(campaignAttentionInput());
    const usage = snapshot.attention_groups.find((group) => group.kind === "usage_incomplete")!;
    expect(usage.occurrences[0]!.evidence_refs).toContainEqual({ source: "runs", ref: "runs/alpha/campaign-0/" });

    const health = snapshot.attention_groups.find((group) => group.kind === "source_health")!;
    expect(health.occurrences[0]!.evidence_refs).toEqual([]);
    expect(health.occurrences[0]!.entity_id).toBe("source:github");
    expect(JSON.stringify(snapshot.attention_groups)).not.toContain("Exact prompt body for the campaign fixture");
  });

  it("keeps independently actionable returned tickets separate", () => {
    const snapshot = projectObserveSnapshot(campaignAttentionInput());
    const returned = snapshot.attention_groups.filter((group) => group.kind === "returned_ticket");
    expect(returned).toHaveLength(2);
    expect(new Set(returned.map((group) => group.id)).size).toBe(2);
    for (const group of returned) expect(group).toMatchObject({ groupable: false, occurrence_count: 1 });
    expect(snapshot.attention_groups).toHaveLength(4);
  });

  it("is permutation-stable and ordered by the declared rule, not by Map insertion", () => {
    const first = projectObserveSnapshot({ ...campaignAttentionInput(), now: new Date("2026-07-12T12:00:00.000Z") });
    const reversedInput = campaignAttentionInput();
    reversedInput.now = new Date("2026-07-12T12:05:00.000Z");
    reversedInput.passes = [...reversedInput.passes].reverse();
    reversedInput.approvals = [...reversedInput.approvals].reverse();
    reversedInput.corrupt_runs = [...reversedInput.corrupt_runs].reverse();
    if (reversedInput.github[0] !== undefined) {
      reversedInput.github[0].issues = [...reversedInput.github[0].issues].reverse();
    }
    const second = projectObserveSnapshot(reversedInput);

    expect(first.attention_groups.map((group) => group.id)).toEqual(second.attention_groups.map((group) => group.id));
    expect(first.attention_groups.map((group) => group.occurrence_count)).toEqual(second.attention_groups.map((group) => group.occurrence_count));
    first.attention_groups.forEach((group, index) => {
      expect(group.occurrences.map((occurrence) => occurrence.id))
        .toEqual(second.attention_groups[index]!.occurrences.map((occurrence) => occurrence.id));
    });
    const severities = first.attention_groups.map((group) => (group.severity === "error" ? 0 : 1));
    expect(severities).toEqual([...severities].sort((a, b) => a - b));
  });

  it("orders equal-severity, equal-count groups deterministically under input permutation", () => {
    const build = (reverse: boolean): ReturnType<typeof projectObserveSnapshot> => {
      const input = baseInput();
      input.apps = [app("alpha", "live")];
      const stalled = [0, 1].map((index) => indexed(row({
        app: "alpha", runId: `stale-${index}`, traceId: `stale-trace-${index}`, status: "running",
        lastSeenAt: new Date(NOW.getTime() - PASS_STALE_AFTER_MS - 60_000).toISOString(),
      })));
      const failed = [0, 1].map((index) => indexed(row({
        app: "alpha", runId: `failed-${index}`, traceId: `failed-trace-${index}`, status: "failed",
      })));
      input.passes = reverse ? [...failed, ...stalled].reverse() : [...stalled, ...failed];
      return projectObserveSnapshot(input);
    };
    const forward = build(false).attention_groups.map((group) => group.cause_key);
    const backward = build(true).attention_groups.map((group) => group.cause_key);
    expect(forward).toEqual(backward);
    // Declared rule: severity, then count desc, then cause_key ascending by
    // CODE UNIT. `failed_pass ...` sorts before `stale_pass ...`.
    expect(forward.filter((key) => key.startsWith("failed_pass") || key.startsWith("stale_pass")))
      .toEqual(["failed_pass\u0000failed\u0000alpha", "stale_pass\u0000stalled\u0000alpha"]);
  });

  it("never sweeps an authoritative-zero `none` pass into a usage group", () => {
    const snapshot = projectObserveSnapshot(campaignAttentionInput());
    // 26 usage + 2 returned + 1 degraded source = 29 items in 4 groups. The
    // `none` pass contributes nothing at all.
    expect(snapshot.attention).toHaveLength(29);
    expect(snapshot.attention_groups).toHaveLength(4);
    expect(snapshot.attention_groups.every((group) => group.cause !== "none")).toBe(true);
    expect(snapshot.attention_groups.find((group) => group.kind === "usage_incomplete")!.occurrence_count).toBe(26);
    expect(new Set(snapshot.attention_groups.map((group) => group.id)).size).toBe(4);
    // All four are warnings, so the declared order is count descending, then
    // cause_key ascending by code unit.
    expect(snapshot.attention_groups.map((group) => [group.kind, group.occurrence_count])).toEqual([
      ["usage_incomplete", 26],
      ["returned_ticket", 1],
      ["returned_ticket", 1],
      ["source_health", 1],
    ]);
  });
});

describe("timestamp policy (#93)", () => {
  it("declares the time contract and canonicalizes every emitted instant", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    input.passes = [indexed(row({ app: "alpha", runId: "run-1", traceId: "trace-1", startedAt: "2026-07-12T03:00:00-07:00" }))];
    input.approvals = [{ item: {
      id: "approval-1", app: "alpha", role: "builder", rule: "protocol-self-edit",
      action: { tool: "write", input: {} }, raisedAt: "2026-07-12T10:00:00Z", status: "pending",
    } }];
    const snapshot = projectObserveSnapshot(input);
    // Sources are canonical UTC; the DISPLAY zone the client applies by default
    // is viewer-local, which is what the bundle actually does. Declaring "UTC"
    // here made the field disagree with the client and read by nothing.
    expect(snapshot.time_policy).toMatchObject({
      source_timezone: "UTC", display_timezone: "viewer_local", instant_format: "iso8601-utc-ms", skew: null,
    });
    // A non-UTC offset is CONVERTED, not string-patched.
    expect(snapshot.passes[0]?.started_at).toBe("2026-07-12T10:00:00.000Z");
    expect(snapshot.approvals[0]?.raised_at).toBe("2026-07-12T10:00:00.000Z");
    for (const value of collectInstantStrings(snapshot)) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it("nulls an unreadable instant and discloses it instead of emitting Invalid Date", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    input.passes = [indexed(row({ app: "alpha", runId: "run-1", traceId: "trace-1", startedAt: "not-a-date" }))];
    const pass = projectObserveSnapshot(input).passes[0]!;
    expect(pass.started_at).toBeNull();
    expect(pass.quality_reason).toContain("unreadable");
    expect(JSON.stringify(pass)).not.toContain("Invalid Date");
    expect(JSON.stringify(pass)).not.toContain("1970-01-01");
  });

  it("reports clock skew as a warning with no negative duration, and raises no attention item", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    input.passes = [indexed(row({ app: "alpha", runId: "run-1", traceId: "trace-1", startedAt: "2026-07-12T13:00:00.000Z" }))];
    const snapshot = projectObserveSnapshot(input);
    expect(snapshot.time_policy.skew).toMatchObject({ future_instants: 1, max_future_ms: 3_600_000 });
    expect(snapshot.time_policy.skew?.sources).toContain("pass:alpha:run-1.started_at");
    for (const value of collectNumericMs(snapshot)) expect(value).toBeGreaterThanOrEqual(0);
    // The attention surface belongs to #91; skew is a header fact.
    expect(snapshot.attention.some((item) => item.kind === "clock_skew")).toBe(false);
  });

  it("tolerates ordinary NTP jitter inside the liveness tolerance", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    input.passes = [indexed(row({
      app: "alpha", runId: "run-1", traceId: "trace-1",
      startedAt: new Date(NOW.getTime() + 5_000).toISOString(),
    }))];
    expect(projectObserveSnapshot(input).time_policy.skew).toBeNull();
  });

  it("performs no timezone arithmetic of its own", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    input.passes = [indexed(row({ app: "alpha", runId: "run-1", traceId: "trace-1", startedAt: "2026-11-01T08:00:00.000Z" }))];
    expect(projectObserveSnapshot(input).passes[0]?.started_at).toBe("2026-11-01T08:00:00.000Z");
  });

  it("leaves usage-quality semantics and the totals shape untouched", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    input.passes = [
      indexed(row({ app: "alpha", runId: "mech", traceId: "trace-mech", usageQuality: "none" })),
      indexed(row({ app: "alpha", runId: "real", traceId: "trace-real", usageQuality: "complete" })),
    ];
    const snapshot = projectObserveSnapshot(input);
    expect(snapshot.attention.filter((item) => item.kind === "usage_incomplete")).toHaveLength(0);
    expect(snapshot.totals.usage_quality).toBe("complete");
    expect(snapshot.totals.incomplete_usage_passes).toBe(0);
    expect(snapshot.totals.cost_scope).toEqual({ settled_provider_turns: 0, unsettled_provider_turns: 1 });
    expect(Object.keys(snapshot.totals).sort()).toEqual([
      "active_passes", "cost", "cost_scope", "delivery_ready", "incomplete_usage_passes",
      "pending_approvals", "recorded_cost_usd", "usage_quality",
    ]);
  });

  it("never conflates an all-mechanical scope ('none') with an unobservable one ('unavailable')", () => {
    const mechanical = baseInput();
    mechanical.apps = [app("alpha", "live")];
    mechanical.passes = [
      indexed(row({ app: "alpha", runId: "mech-1", traceId: "trace-a", usageQuality: "none" })),
      indexed(row({ app: "alpha", runId: "mech-2", traceId: "trace-b", usageQuality: "none" })),
    ];
    const zero = projectObserveSnapshot(mechanical);
    // An authoritative zero: every pass invoked no provider. This must render as
    // $0.00, raise no attention item, and be excluded from provider-turn counts.
    expect(zero.totals.usage_quality).toBe("none");
    expect(zero.totals.cost.provider_turns).toBe(0);
    // Mechanical passes belong to neither side of settlement coverage (#88).
    expect(zero.totals.cost_scope).toEqual({ settled_provider_turns: 0, unsettled_provider_turns: 0 });
    expect(zero.totals.incomplete_usage_passes).toBe(0);
    expect(zero.attention.filter((item) => item.kind === "usage_incomplete")).toHaveLength(0);

    // No pass evidence at all is genuinely unknown, and stays `unavailable`.
    const nothing = baseInput();
    nothing.apps = [app("alpha", "live")];
    nothing.passes = [];
    expect(projectObserveSnapshot(nothing).totals.usage_quality).toBe("unavailable");
  });
});

describe("recorded activity vs pending intake (#94)", () => {
  it("splits recorded execution from pending intake and never routes on datedness alone", () => {
    const input = baseInput();
    input.apps = [app("alpha", "onboarding")];
    input.passes = [indexed(row({ app: "alpha", runId: "plan-1", traceId: "plan-trace", role: "planner", pipeline: "plan" }))];
    input.inbox = [
      // A perfectly sortable inbox timestamp EARLIER than the dated trace. It
      // must still be pending: routing is on "is a recorded execution", never
      // on "has a parseable timestamp".
      { filename: "a.json", app: "alpha", kind: "health-alert", occurred_at: "2026-07-12T09:00:00Z", discovered_at: "2026-07-12T09:05:00.000Z" },
      { filename: "b.json", app: "alpha", kind: "support-feedback", discovered_at: "2026-07-12T09:06:00.000Z" },
      { filename: "c.json", app: null, kind: null, discovered_at: "2026-07-12T09:07:00.000Z", error: "unexpected token" },
    ];
    const snapshot = projectObserveSnapshot(input);
    expect("intake" in snapshot).toBe(false);
    expect(snapshot.activity_history.rows).toHaveLength(1);
    expect(snapshot.activity_history.rows[0]?.trace_id).toBe("plan-trace");
    expect(snapshot.pending_intake.rows).toHaveLength(4);
    expect(snapshot.pending_intake.counts).toEqual({ pending: 2, corrupt: 1, awaiting_promotion: 1 });
    expect(snapshot.pending_intake.scope.total).toBe(4);

    const pendingIds = new Set(snapshot.pending_intake.rows.map((entry) => entry.id));
    for (const recorded of snapshot.activity_history.rows) {
      expect(pendingIds.has(recorded.id)).toBe(false);
      expect(typeof recorded.occurred_at).toBe("string");
      expect(recorded.occurred_at.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(recorded.occurred_at))).toBe(false);
    }
    expect(snapshot.pending_intake.rows.find((entry) => entry.id === "intake:event:a.json")).toMatchObject({
      state: "pending", occurred_at: "2026-07-12T09:00:00.000Z", timestamp_basis: "occurred",
    });
    expect(snapshot.pending_intake.rows.find((entry) => entry.id === "intake:event:b.json")).toMatchObject({
      occurred_at: null, timestamp_basis: "discovered", discovered_at: "2026-07-12T09:06:00.000Z",
    });
    expect(snapshot.pending_intake.rows.find((entry) => entry.id === "intake:event:c.json")).toMatchObject({
      state: "corrupt", timestamp_basis: "discovered", quality_reason: expect.any(String),
    });
  });

  it("declares its ordering and tie-breaks by id ascending in BOTH directions", () => {
    const make = (order?: "chronological"): ReturnType<typeof projectObserveSnapshot> => {
      const input = baseInput();
      if (order !== undefined) input.filters = { order };
      input.apps = [app("alpha", "live")];
      input.passes = [
        indexed(row({ app: "alpha", runId: "aaa", traceId: "aaa", role: "planner", pipeline: "plan", startedAt: "2026-07-12T11:00:00.000Z" })),
        indexed(row({ app: "alpha", runId: "zzz", traceId: "zzz", role: "planner", pipeline: "plan", startedAt: "2026-07-12T11:00:00.000Z" })),
        indexed(row({ app: "alpha", runId: "mid", traceId: "mid", role: "planner", pipeline: "plan", startedAt: "2026-07-12T09:00:00.000Z" })),
      ];
      return projectObserveSnapshot(input);
    };
    const newest = make();
    expect(newest.activity_history.scope.ordering).toEqual({
      sort_key: "occurred_at", direction: "newest_first", label: "Newest first", tie_breaker: "id_asc",
    });
    // Tie-break is id ASCENDING and is never reversed — a `.reverse()`
    // implementation gets the primary order right and this wrong.
    expect(newest.activity_history.rows.map((entry) => entry.trace_id)).toEqual(["aaa", "zzz", "mid"]);
    const oldest = make("chronological");
    expect(oldest.activity_history.scope.ordering?.label).toBe("Oldest first");
    expect(oldest.activity_history.rows.map((entry) => entry.trace_id)).toEqual(["mid", "aaa", "zzz"]);
  });

  it("makes it structurally impossible for undated pending work to enter the chronology", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    input.passes = ["09:00", "11:00", "13:00"].map((time, index) => indexed(row({
      app: "alpha", runId: `run-${index}`, traceId: `trace-${index}`, role: "planner", pipeline: "plan",
      startedAt: `2026-07-12T${time}:00.000Z`,
    })));
    input.inbox = [
      { filename: "none.json", app: "alpha", kind: "health-alert" },
      { filename: "early.json", app: "alpha", kind: "health-alert", occurred_at: "2026-07-12T08:00:00Z" },
      { filename: "late.json", app: "alpha", kind: "health-alert", occurred_at: "2026-07-12T14:00:00Z" },
    ];
    for (const direction of ["newest_first", "chronological"] as const) {
      const snapshot = projectObserveSnapshot({ ...input, filters: { order: direction } });
      const history = snapshot.activity_history.rows;
      expect(history).toHaveLength(3);
      expect(snapshot.pending_intake.rows).toHaveLength(3);
      const pendingIds = new Set(snapshot.pending_intake.rows.map((entry) => entry.id));
      expect(history.some((entry) => pendingIds.has(entry.id))).toBe(false);
      const stamps = history.map((entry) => entry.occurred_at);
      expect(stamps.every((value) => value !== "")).toBe(true);
      const sorted = [...stamps].sort(codeUnitCompare);
      expect(stamps).toEqual(direction === "chronological" ? sorted : sorted.reverse());
    }
  });

  it("keeps an empty-string timestamp out of the chronology", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    input.inbox = [{ filename: "blank.json", app: "alpha", kind: "health-alert", occurred_at: "" }];
    const snapshot = projectObserveSnapshot(input);
    expect(snapshot.activity_history.rows).toHaveLength(0);
    expect(snapshot.pending_intake.rows[0]).toMatchObject({ occurred_at: null, timestamp_basis: "none" });
  });

  it("explains source and trigger in plain language and survives an unmapped hostile kind", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    input.passes = [indexed(row({ app: "alpha", runId: "plan-1", traceId: "plan-trace", role: "planner", pipeline: "plan" }))];
    input.ledger = [{
      at: NOW.toISOString(), role: "planner", runtime: "codex", model: "gpt-5.5", status: "completed",
      tokensIn: 1, tokensOut: 1, costUsd: 0.1, usageQuality: "complete", subagentTurns: 0, wallClockMs: 1,
      escalations: 0, app: "alpha", runId: "plan-1", traceId: "plan-trace", pipeline: "plan", pass: "implement",
      trigger: "schedule",
    }];
    input.inbox = [{ filename: "x.json", app: "alpha", kind: "<img src=x onerror=alert(1)>" }];
    const snapshot = projectObserveSnapshot(input);
    const recorded = snapshot.activity_history.rows[0]!;
    expect(recorded.trigger_label).toBe("Ran on a schedule");
    expect(recorded.source_label).toBe("Org schedule");
    expect(recorded.summary).toBe("Planning activity by planner");
    expect(recorded.pipeline).toBe("plan");
    const hostile = snapshot.pending_intake.rows.find((entry) => entry.id === "intake:event:x.json")!;
    expect(hostile.trigger_label).toBe("Company event: <img src=x onerror=alert(1)>");
    expect(hostile.source_label).toBe("Company event file drop");
  });

  it("navigates to a session using real identity only, never a bare trace id", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live"), app("beta", "live")];
    input.passes = [
      indexed(row({ app: "alpha", runId: "a", traceId: "plan-trace", role: "planner", pipeline: "plan" })),
      indexed(row({ app: "beta", runId: "b", traceId: "plan-trace", role: "planner", pipeline: "plan" })),
      indexed(row({ app: "alpha", runId: "c", traceId: "task-trace", parentTaskId: "task-1", role: "planner", pipeline: "plan" })),
    ];
    const snapshot = projectObserveSnapshot(input);
    const refs = new Map(snapshot.activity_history.rows.map((entry) => [entry.id, entry.session_ref]));
    expect(refs.get("intake:trace:alpha:plan-trace")).toEqual({ id: "trace:alpha:plan-trace", kind: "trace" });
    expect(refs.get("intake:trace:beta:plan-trace")).toEqual({ id: "trace:beta:plan-trace", kind: "trace" });
    expect(refs.get("intake:trace:alpha:task-trace")).toEqual({ id: "task:task-1", kind: "task" });
    // Byte-identical to the trace id projectTraces emits.
    const traceIds = new Set(snapshot.traces.map((trace) => trace.id));
    expect(traceIds.has("trace:alpha:plan-trace")).toBe(true);
    expect(traceIds.has("trace:beta:plan-trace")).toBe(true);
  });

  it("discloses the pre-cap total rather than the delivered count", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    input.inbox = Array.from({ length: 205 }, (_unused, index) => ({
      filename: `event-${String(index).padStart(3, "0")}.json`,
      app: "alpha",
      kind: "health-alert",
    }));
    const snapshot = projectObserveSnapshot(input);
    expect(snapshot.pending_intake.scope).toMatchObject({ total: 205, returned: 200, truncated: true, cap: 200 });
    expect(snapshot.pending_intake.rows).toHaveLength(200);
  });

  it("adds no attention item for the ordinary pending state", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    input.inbox = [{ filename: "ok.json", app: "alpha", kind: "health-alert" }];
    const snapshot = projectObserveSnapshot(input);
    expect(snapshot.attention.some((item) => item.kind === "corrupt_intake")).toBe(false);
    expect(snapshot.attention).toHaveLength(0);
  });
});

describe("activity ordering and classification (#97)", () => {
  it("builds a total, clock-independent, permutation-stable order", () => {
    const build = (reverse: boolean, now: Date): ReturnType<typeof projectObserveSnapshot> => {
      const input = baseInput();
      input.now = now;
      input.apps = [app("alpha", "live"), app("beta", "live")];
      const alpha = indexed(row({ app: "alpha", runId: "run-1", traceId: "trace-a" }));
      alpha.events = [
        event("2026-07-12T11:00:00.000Z", "pass.started"),
        event("2026-07-12T11:30:00.000Z", "gate.passed"),
        event("2026-07-12T11:59:59.000Z", "tool.called", { tool: "bash", success: true }),
        event("2026-07-12T11:59:59.000Z", "pass.completed"),
      ];
      const beta = indexed(row({ app: "beta", runId: "run-1", traceId: "trace-b" }));
      beta.events = [
        event("2026-07-12T11:59:59.000Z", "pass.started"),
        event("2026-07-12T10:00:00.000Z", "run.started"),
      ];
      input.passes = reverse ? [beta, alpha] : [alpha, beta];
      return projectObserveSnapshot(input);
    };
    const snapshot = build(false, NOW);
    const events = snapshot.passes.flatMap((pass) => pass.events);
    expect(new Set(events.map((entry) => entry.order_key)).size).toBe(events.length);
    const ordered = [...events].sort((a, b) => (a.order_key < b.order_key ? 1 : a.order_key > b.order_key ? -1 : 0));
    expect(ordered.map((entry) => entry.id)).toEqual([
      // Same instant: one descending sort covers the whole composite key, so
      // app and run id read in reverse too, and append order reverses (seq 3
      // before seq 2) — which is exactly newest-first within a pass.
      "beta:run-1:event:0",
      "alpha:run-1:event:3",
      "alpha:run-1:event:2",
      "alpha:run-1:event:1",
      "alpha:run-1:event:0",
      "beta:run-1:event:1",
    ]);

    const reversed = build(true, NOW).passes.flatMap((pass) => pass.events);
    const reorderedIds = [...reversed]
      .sort((a, b) => (a.order_key < b.order_key ? 1 : a.order_key > b.order_key ? -1 : 0))
      .map((entry) => entry.id);
    expect(reorderedIds).toEqual(ordered.map((entry) => entry.id));

    // The order never reads the clock.
    const later = build(false, new Date("2026-07-12T18:00:00.000Z")).passes.flatMap((pass) => pass.events);
    expect(later.map((entry) => entry.order_key)).toEqual(events.map((entry) => entry.order_key));
  });

  it("sorts a non-UTC offset by its real instant, not by its raw string", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    const pass = indexed(row({ app: "alpha", runId: "run-1", traceId: "trace-1" }));
    pass.events = [
      event("2026-07-12T13:59:59.000+02:00", "pass.started"),
      event("2026-07-12T12:00:00.000Z", "pass.completed"),
    ];
    input.passes = [pass];
    const events = projectObserveSnapshot(input).passes[0]!.events;
    expect(events[0]?.ts_utc).toBe("2026-07-12T11:59:59.000Z");
    const ordered = [...events].sort((a, b) => (a.order_key < b.order_key ? 1 : a.order_key > b.order_key ? -1 : 0));
    // 12:00:00Z is the later instant even though '13...' > '12...' as strings.
    expect(ordered.map((entry) => entry.event)).toEqual(["pass.completed", "pass.started"]);
  });

  it("classifies every event kind and outcome from typed fields, never from severity", () => {
    const cases: Array<[string, string, string]> = [
      ["run.started", "run", "pending"], ["run.completed", "run", "success"],
      ["pass.started", "pass", "pending"], ["pass.completed", "pass", "success"],
      ["pass.failed", "pass", "failure"], ["pass.cancelled", "pass", "failure"],
      ["pass.timed_out", "pass", "failure"], ["pass.heartbeat", "heartbeat", "not_applicable"],
      ["gate.started", "gate", "pending"], ["gate.passed", "gate", "success"], ["gate.failed", "gate", "failure"],
      ["subagent.started", "subagent", "pending"], ["subagent.completed", "subagent", "success"],
      ["ticket.transition", "ticket", "not_applicable"], ["verdict.recorded", "verdict", "not_applicable"],
      ["plan.ticket_finalized", "plan", "not_applicable"], ["escalation.raised", "escalation", "not_applicable"],
      // A benign exactly-once skip is carried at severity `warn` and must NOT
      // be reported as a failure.
      ["telemetry.settle_skipped", "telemetry", "not_applicable"],
      ["telemetry.settle_failed", "telemetry", "failure"],
      ["some.legacy.event", "other", "unknown"],
    ];
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    const pass = indexed(row({ app: "alpha", runId: "run-1", traceId: "trace-1" }));
    pass.events = [
      ...cases.map(([name]) => event("2026-07-12T11:00:00.000Z", name, {}, name === "telemetry.settle_skipped" ? "warn" : "info")),
      event("2026-07-12T11:00:00.000Z", "tool.called", { tool: "bash", success: true }),
      event("2026-07-12T11:00:00.000Z", "tool.called", { tool: "bash", success: false }, "info"),
      event("2026-07-12T11:00:00.000Z", "tool.called", { tool: "bash" }),
    ];
    input.passes = [pass];
    const events = projectObserveSnapshot(input).passes[0]!.events;
    cases.forEach(([name, kind, outcome], index) => {
      expect([events[index]!.kind, events[index]!.outcome], name).toEqual([kind, outcome]);
    });
    const tools = events.slice(cases.length);
    expect(tools.map((entry) => entry.outcome)).toEqual(["success", "failure", "unknown"]);
    expect(tools.map((entry) => entry.tool_name)).toEqual(["bash", "bash", "bash"]);
    expect(events.filter((entry) => entry.coalesce_key !== null).map((entry) => entry.coalesce_key))
      .toEqual(["heartbeat:pass:alpha:run-1"]);
  });

  it("declares stream metadata and puts undated events in their own bucket", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    const pass = indexed(row({ app: "alpha", runId: "run-1", traceId: "trace-1" }));
    pass.events = [
      event("2026-07-12T12:00:00.000Z", "pass.started"),
      event("garbage", "pass.heartbeat"),
      event("2026-07-12T11:00:00.000Z", "pass.completed"),
      event("2026-07-12T13:00:00.000Z", "gate.passed"),
    ];
    input.passes = [pass];
    const snapshot = projectObserveSnapshot(input);
    const events = snapshot.passes[0]!.events;
    expect(events[1]?.ts_utc).toBeNull();
    expect(events[1]?.order_key.startsWith("0")).toBe(true);
    expect(snapshot.activity).toMatchObject({
      order: "newest_first",
      order_key_fields: ["ts_utc", "app", "run_id", "seq"],
      total_events: 4,
      undated_events: 1,
      completeness: "complete",
      latest_event_at: "2026-07-12T13:00:00.000Z",
      latest_heartbeat_at: null,
    });
    expect(snapshot.activity.clock_skew_event_ids).toEqual(["alpha:run-1:event:3"]);
    // An undated event sorts to the tail, never between two dated ones.
    const ordered = [...events].sort((a, b) => (a.order_key < b.order_key ? 1 : a.order_key > b.order_key ? -1 : 0));
    expect(ordered.map((entry) => entry.id).at(-1)).toBe("alpha:run-1:event:1");
  });

  it("keeps `latest_event` on the delivery card agreeing with the stream order", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    const pass = indexed(row({ app: "alpha", runId: "run-1", traceId: "trace-1", ticket: "#1" }));
    pass.events = [
      event("2026-07-12T13:59:59.000+02:00", "pass.started"),
      event("2026-07-12T12:00:00.000Z", "pass.completed"),
    ];
    input.passes = [pass];
    input.github = [{ app: "alpha", repo: "owner/alpha", observed_at: NOW.toISOString(), issues: [issue(1, ["op:ready"])], pull_requests: [] }];
    expect(projectObserveSnapshot(input).delivery[0]?.latest_event).toContain("pass.completed");
  });

  it("reports partial completeness when structured events are corrupt", () => {
    const input = baseInput();
    input.apps = [app("alpha", "live")];
    const pass = indexed(row({ app: "alpha", runId: "run-1", traceId: "trace-1" }));
    pass.events_corrupt = "events.jsonl:2: malformed mid-file";
    input.passes = [pass];
    const snapshot = projectObserveSnapshot(input);
    expect(snapshot.activity.completeness).toBe("partial");
    expect(snapshot.activity.incomplete_reasons[0]).toContain("malformed mid-file");
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

/**
 * The #91 regression fixture: many identical usage conditions plus unrelated,
 * independently actionable Attention items.
 *
 * 26 passes on `alpha` with `usage.quality: 'unavailable'`, 2 `op:returned`
 * tickets, 1 `github` source at `degraded`, and 1 `usage.quality: 'none'` pass
 * that must raise nothing at all.
 */
function campaignAttentionInput(): ObserveProjectionInput {
  const input = baseInput();
  input.apps = [app("alpha", "live")];
  input.passes = Array.from({ length: 26 }, (_unused, index) => indexed(row({
    app: "alpha",
    runId: `campaign-${index}`,
    traceId: `campaign-trace-${index}`,
    // Deliberately divergent scrubbed text within one cause: role/pass labels
    // and quality reasons differ, and must NOT split the group.
    role: "builder",
    pass: "implement",
    usageQuality: "unavailable",
    previews: { output: `Exact prompt body for the campaign fixture ${index}` },
  })));
  // An authoritative zero: a mechanical pass that invoked no provider.
  input.passes.push(indexed(row({ app: "alpha", runId: "mechanical", traceId: "mechanical-trace", usageQuality: "none" })));
  input.github = [{
    app: "alpha",
    repo: "owner/alpha",
    observed_at: NOW.toISOString(),
    issues: [issue(12, ["op:returned"]), issue(13, ["op:returned"])],
    pull_requests: [],
  }];
  input.source_health = [health("local_files", "healthy", "ok"), health("github", "degraded", "rate limited")];
  return input;
}

function event(
  ts: string,
  name: string,
  detail: Record<string, string | number | boolean> = {},
  severity = "info",
): RunlogEvent {
  return {
    trace_id: "trace-1", span_id: "span-1", app: "alpha", pipeline: "build", pass: "implement", role: "builder",
    ts, event: name as RunlogEvent["event"], severity: severity as RunlogEvent["severity"], detail,
  };
}

/** Code-unit comparison — the same comparator the projection uses. */
function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function collectInstantStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectInstantStrings(entry, out);
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) collectInstantStrings(entry, out);
  }
  return out;
}

function collectNumericMs(value: unknown, key = "", out: number[] = []): number[] {
  if (typeof value === "number") {
    if (key.endsWith("_ms")) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectNumericMs(entry, key, out);
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const [entryKey, entry] of Object.entries(value)) collectNumericMs(entry, entryKey, out);
  }
  return out;
}
