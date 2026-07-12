// Tests the pass executor in src/loop/pipeline.ts.
// Covers sequential and parallel pass execution, task/template assembly,
// per-pass overrides, gate propagation, runlog records, tool/subagent event
// bridging, anomaly inputs, and abort-on-failed-pass behavior.
// Uses FakeRuntime, FakeClock, local prompt fixtures, and temp runlogs; no
// network, auth, real org state, or live wall clock is required.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executePipeline, type ExecutePipelineOptions } from "../../src/loop/pipeline.js";
import { getPipeline, loadPipelines, type PipelineConfig, type PipelinesFile } from "../../src/loop/pipelines.js";
import { readEnvelope } from "../../src/runtime/runlog/envelope.js";
import { readEvents, reconstructSpanTree } from "../../src/runtime/runlog/events.js";
import { runPaths } from "../../src/runtime/runlog/paths.js";
import { detectRunAnomalies } from "../../src/runtime/runlog/anomalies.js";
import { FakeRuntime, type ScriptedTurn } from "../../src/runtime/testing/fakeRuntime.js";
import type { RoleConfig, Runtime, TurnEvent, TurnResult } from "../../src/runtime/types.js";
import { FakeClock } from "../fixtures/fakeClock.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/pipelines", import.meta.url));
const PROMPTS_DIR = `${FIXTURE_DIR}/prompts`;

function role(name: string, overrides: Partial<RoleConfig> = {}): RoleConfig {
  return {
    name,
    runtime: "claude",
    model: "base-model",
    effort: "medium",
    delegation: { allow: [] },
    triggers: [],
    outputs: [],
    maxTurnBudgetUsd: 5,
    ...overrides,
  };
}

const ROLES: Record<string, RoleConfig> = {
  planner: role("planner"),
  builder: role("builder"),
  reviewer: role("reviewer"),
};

function turnResult(
  summary: string,
  status: TurnResult["status"] = "completed",
  usage: Partial<TurnResult["usage"]> = {},
): TurnResult {
  return {
    status,
    summary,
    artifacts: [],
    session: { runtime: "claude", id: `session-${summary}` },
    usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.01, subagentTurns: 0, wallClockMs: 100, ...usage },
    escalations: [],
  };
}

function scripted(
  summary: string,
  status: TurnResult["status"] = "completed",
  usage: Partial<TurnResult["usage"]> = {},
): ScriptedTurn {
  return { result: turnResult(summary, status, usage) };
}

/** A Runtime that fires a scripted list of TurnEvents through hooks.onEvent
 *  (the way an adapter streams tool/subagent activity) before returning. */
function eventRuntime(events: TurnEvent[], summary = "done"): Runtime {
  return {
    kind: "claude",
    async runTurn(_req, hooks) {
      for (const e of events) hooks.onEvent?.(e);
      return turnResult(summary);
    },
  };
}

async function loadFixture(): Promise<PipelinesFile> {
  return loadPipelines(`${FIXTURE_DIR}/pipelines.yaml`, {
    roleNames: Object.keys(ROLES),
    promptsDir: PROMPTS_DIR,
  });
}

interface Harness {
  fake: FakeRuntime;
  options: ExecutePipelineOptions;
  cleanup(): void;
}

function makeHarness(
  pipeline: ExecutePipelineOptions["pipeline"],
  turns: ScriptedTurn[],
  overrides: Partial<ExecutePipelineOptions> = {},
): Harness {
  const home = makeOrgHome({ runs: { apps: ["civic"] } });
  const fake = new FakeRuntime(turns);
  const clock = new FakeClock(new Date(Date.UTC(2026, 6, 5, 9, 30, 15)));
  return {
    fake,
    options: {
      pipeline,
      selection: { tier: "standard" },
      roles: ROLES,
      runtimeFor: () => fake,
      briefFor: (pass) => `brief for ${pass.id}`,
      promptsDir: PROMPTS_DIR,
      context: { taste: ["org taste"], memoryExcerpts: [] },
      workdir: "/tmp/workdir",
      hooks: { gate: () => ({ allow: true }) },
      runlog: { root: home.root, app: "civic", ticket: "#42", traceId: "turn-1" },
      clock: () => clock.now(),
      ...overrides,
    },
    cleanup: () => home.cleanup(),
  };
}

describe("executePipeline", () => {
  it("cancels the active pass, starts no later stage, and finalizes the envelope", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const controller = new AbortController();
    let calls = 0;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const slow: Runtime = {
      kind: "claude",
      async runTurn() {
        calls += 1;
        releaseFirst();
        await new Promise((resolve) => setTimeout(resolve, 50));
        return turnResult("late success");
      },
    };
    const h = makeHarness(build, [], { runtimeFor: () => slow });
    const options = { ...h.options, signal: controller.signal } as ExecutePipelineOptions & {
      signal: AbortSignal;
    };
    try {
      const running = executePipeline(options);
      await firstStarted;
      controller.abort("operator SIGTERM");
      const result = await running;

      expect(result.aborted).toBe(true);
      expect(calls).toBe(1);
      expect(result.passes).toHaveLength(1);
      const envelope = await readEnvelope(
        h.options.runlog.root,
        "civic",
        result.passes[0]!.runId,
      );
      expect(envelope.status).toBe("cancelled");
      expect(envelope.error_code).toBe("error_cancelled");
      expect(envelope.finished_at).toBeDefined();
    } finally {
      h.cleanup();
    }
  });

  it("persists a partial usage checkpoint when the runtime fails before its terminal result", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const crashing: Runtime = {
      kind: "claude",
      async runTurn(_req, hooks) {
        const progressHooks = hooks as typeof hooks & {
          onProgress?: (event: {
            usage: TurnResult["usage"];
            quality: "partial";
            at: string;
          }) => void;
        };
        progressHooks.onProgress?.({
          usage: {
            tokensIn: 1234,
            tokensOut: 56,
            costUsd: 0.42,
            costEstimated: true,
            subagentTurns: 0,
            wallClockMs: 500,
          },
          quality: "partial",
          at: "2026-07-05T09:30:16.000Z",
        });
        throw new Error("provider connection lost after tool writes");
      },
    };
    const h = makeHarness(build, [], {
      selection: { tier: "quick" },
      runtimeFor: () => crashing,
    });
    try {
      const result = await executePipeline(h.options);
      expect(result.aborted).toBe(true);
      const envelope = await readEnvelope(
        h.options.runlog.root,
        "civic",
        result.passes[0]!.runId,
      );
      expect(envelope.status).toBe("failed");
      expect(envelope.usage).toMatchObject({
        tokens_in: 1234,
        tokens_out: 56,
        cost_usd: 0.42,
        quality: "partial",
      });
    } finally {
      h.cleanup();
    }
  });

  it("single-pass pipeline calls runTurn once with no session field", async () => {
    // build at quick tier selects exactly one pass (implement).
    const build = getPipeline(await loadFixture(), "build");
    const h = makeHarness(build, [scripted("done")], { selection: { tier: "quick" } });
    try {
      const result = await executePipeline(h.options);
      expect(h.fake.calls.length).toBe(1);
      expect(result.passes.map((p) => p.pass.id)).toEqual(["implement"]);
      expect(h.fake.calls[0]?.req.session).toBeUndefined();
      expect("session" in (h.fake.calls[0]?.req ?? {})).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  it("correlates the pass envelope and cost ledger to its broader parent task", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const h = makeHarness(build, [scripted("done")], {
      selection: { tier: "quick" },
      parentTaskId: "outer-task-1",
      telemetry: { orgDir: "placeholder", trigger: "manual" },
    });
    h.options.telemetry = { orgDir: h.options.runlog.root, trigger: "manual" };
    try {
      const result = await executePipeline(h.options);
      const envelope = await readEnvelope(h.options.runlog.root, "civic", result.passes[0]!.runId);
      expect(envelope.parent_task_id).toBe("outer-task-1");
      const row = JSON.parse(
        readFileSync(join(h.options.runlog.root, "telemetry", "2026-07-05.jsonl"), "utf8").trim(),
      ) as Record<string, unknown>;
      expect(row["parentTaskId"]).toBe("outer-task-1");
    } finally {
      h.cleanup();
    }
  });

  it("records the effective delegated authority version and hash on every pass envelope", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const authority = {
      profile: "delegated-operator",
      version: "delegated-operator/v1",
      sha256: "a".repeat(64),
      sources: ["/org/AUTHORITY.md", "/app/.operon/AUTHORITY.md"],
      text: "delegated authority",
    };
    const h = makeHarness(build, [scripted("done")], {
      selection: { tier: "quick" },
      context: { authority, taste: ["org taste"], memoryExcerpts: [] },
    });
    try {
      const result = await executePipeline(h.options);
      const envelope = await readEnvelope(h.options.runlog.root, "civic", result.passes[0]!.runId);
      expect(envelope.authority).toEqual({
        profile: authority.profile,
        version: authority.version,
        sha256: authority.sha256,
        sources: authority.sources,
      });
      expect(h.fake.calls[0]!.req.task).toContain("[authority]");
      expect(h.fake.calls[0]!.req.task).toContain(`sha256: ${authority.sha256}`);
      expect(
        readFileSync(runPaths(h.options.runlog.root, "civic", result.passes[0]!.runId).brief, "utf8"),
      ).toContain("The full effective charter is injected through the runtime's native instruction channel.");
    } finally {
      h.cleanup();
    }
  });

  it("sequential passes run in order; task = brief + template", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const h = makeHarness(build, [
      scripted("contract out", "completed", { cacheCreationTokens: 3, cacheReadTokens: 7 }),
      scripted("implement out"),
    ]);
    try {
      const result = await executePipeline(h.options);
      expect(result.passes.map((p) => p.pass.id)).toEqual(["contract", "implement"]);
      expect(result.aborted).toBe(false);

      const tasks = h.fake.calls.map((c) => c.req.task);
      expect(tasks[0]).toContain("brief for contract");
      expect(tasks[1]).toContain("brief for implement");
      // Template content follows the brief (fixture template body).
      const template = readFileSync(`${PROMPTS_DIR}/build/pass.md`, "utf8");
      expect(tasks[0]?.startsWith("brief for contract\n\n---\n\n")).toBe(true);
      expect(tasks[0]?.endsWith(template)).toBe(true);
    } finally {
      h.cleanup();
    }
  });

  it("parallel_group pair runs concurrently", async () => {
    const plan = getPipeline(await loadFixture(), "plan");
    const h = makeHarness(plan, [
      scripted("visionary"),
      scripted("pm-a"),
      scripted("pm-b"),
      scripted("arbitrator"),
    ]);
    const tracker = { active: 0, maxActive: 0 };
    const inner = h.options.runtimeFor(ROLES["planner"] as RoleConfig);
    const tracking: Runtime = {
      kind: "claude",
      async runTurn(req, hooks) {
        tracker.active += 1;
        tracker.maxActive = Math.max(tracker.maxActive, tracker.active);
        await new Promise((r) => setTimeout(r, 20));
        const result = await inner.runTurn(req, hooks);
        tracker.active -= 1;
        return result;
      },
    };
    try {
      const result = await executePipeline({ ...h.options, runtimeFor: () => tracking });
      expect(result.passes.map((p) => p.pass.id)).toEqual([
        "visionary",
        "pm-a",
        "pm-b",
        "arbitrator",
      ]);
      // pm-a and pm-b overlapped; the singleton stages never did.
      expect(tracker.maxActive).toBe(2);
    } finally {
      h.cleanup();
    }
  });

  it("skip_on_tier omits contract on quick", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const h = makeHarness(build, [scripted("implement out")], {
      selection: { tier: "quick" },
    });
    try {
      const result = await executePipeline(h.options);
      expect(result.passes.map((p) => p.pass.id)).toEqual(["implement"]);
      expect(h.fake.calls.length).toBe(1);
    } finally {
      h.cleanup();
    }
  });

  it("per-pass override copies the role — base config never mutates, runtime never changes", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const h = makeHarness(build, [scripted("contract"), scripted("implement")]);
    try {
      await executePipeline(h.options);

      // Fixture: implement has effort:high + model:gpt-5.5.
      const implementCall = h.fake.calls[1];
      expect(implementCall?.req.role.effort).toBe("high");
      expect(implementCall?.req.role.model).toBe("gpt-5.5");
      expect(implementCall?.req.role.runtime).toBe("claude"); // never overridable

      // The base config is untouched.
      expect(ROLES["builder"]).toMatchObject({ effort: "medium", model: "base-model" });
      // The contract call saw the un-overridden role.
      expect(h.fake.calls[0]?.req.role.effort).toBe("medium");
    } finally {
      h.cleanup();
    }
  });

  it("gate propagates unchanged (same function) to every call", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const gate = (): { allow: true } => ({ allow: true });
    const h = makeHarness(
      build,
      [
        { toolActions: [{ action: { tool: "bash", input: { command: "ls" } } }], result: turnResult("a") },
        { toolActions: [{ action: { tool: "read", input: { path: "x" } } }], result: turnResult("b") },
      ],
      { hooks: { gate } },
    );
    try {
      await executePipeline(h.options);
      for (const call of h.fake.calls) {
        expect(call.hooks.gate).toBe(gate); // identity, not a wrapper
        expect(call.gateCalls.length).toBe(1);
      }
    } finally {
      h.cleanup();
    }
  });

  it("selects a role-aware gate for every pass when a factory is provided", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const fallback = (): { allow: true } => ({ allow: true });
    const builderGate = (): { allow: true } => ({ allow: true });
    const selectedRoles: string[] = [];
    const h = makeHarness(
      build,
      [scripted("contract"), scripted("implement")],
      {
        hooks: { gate: fallback },
        gateForRole: (selectedRole) => {
          selectedRoles.push(selectedRole.name);
          return builderGate;
        },
      },
    );
    try {
      await executePipeline(h.options);
      expect(selectedRoles).toEqual(["builder", "builder"]);
      expect(h.fake.calls).toHaveLength(2);
      for (const call of h.fake.calls) {
        expect(call.hooks.gate).toBe(builderGate);
        expect(call.hooks.gate).not.toBe(fallback);
      }
    } finally {
      h.cleanup();
    }
  });

  it("settles one ledger row per pass, keyed on runId, when a telemetry target is set", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const h = makeHarness(build, [
      scripted("contract out"),
      scripted("implement out", "blocked_on_gate", { costUsd: 7.02, costEstimated: true }),
    ]);
    h.options.telemetry = { orgDir: h.options.runlog.root, trigger: "manual" };
    try {
      const run = await executePipeline(h.options);
      // The second pass ended blocked — it consumed budget too (Defect B).
      expect(run.aborted).toBe(true);

      const raw = readFileSync(
        `${h.options.runlog.root}/telemetry/2026-07-05.jsonl`,
        "utf8",
      );
      const rows = raw.trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row["runId"])).toEqual(run.passes.map((record) => record.runId));
      expect(rows[0]).toMatchObject({
        app: "civic",
        trigger: "manual",
        traceId: "turn-1",
        pipeline: "build",
        pass: "contract",
        status: "completed",
        costUsd: 0.01,
      });
      expect(rows[1]).toMatchObject({
        pass: "implement",
        status: "blocked_on_gate",
        costUsd: 7.02,
        costEstimated: true,
      });
    } finally {
      h.cleanup();
    }
  });

  it("wall-clock watchdog cancels a hung pass: timed-out envelope, distinct code, unmeasured row", async () => {
    const build = getPipeline(await loadFixture(), "build");
    // A pass whose runtime never resolves, capped at ~30ms.
    const hung: PipelineConfig = {
      ...build,
      passes: build.passes.map((p) => ({ ...p, wallClockMinutes: 0.0005 })),
    };
    const never: Runtime = { kind: "claude", runTurn: () => new Promise(() => {}) };
    const h = makeHarness(hung, [], { runtimeFor: () => never, selection: { tier: "quick" } });
    h.options.cancellationGraceMs = 5;
    h.options.telemetry = { orgDir: h.options.runlog.root, trigger: "manual" };
    try {
      const run = await executePipeline(h.options);
      expect(run.aborted).toBe(true);
      const record = run.passes[0]!;
      expect(record.result.status).toBe("timed_out");
      expect(record.result.errorCode).toBe("error_wall_clock_exceeded");

      const env = await readEnvelope(h.options.runlog.root, "civic", record.runId);
      expect(env.status).toBe("timed_out");
      expect(env.error_code).toBe("error_wall_clock_exceeded");

      // The abandoned turn's spend is unknown, not zero — the ledger says so.
      const raw = readFileSync(`${h.options.runlog.root}/telemetry/2026-07-05.jsonl`, "utf8");
      const row = JSON.parse(raw.trimEnd()) as Record<string, unknown>;
      expect(row).toMatchObject({ status: "timed_out", unmeasured: true, costUsd: 0 });
    } finally {
      h.cleanup();
    }
  });

  it("settles nothing when no telemetry target is given (library callers opt in)", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const h = makeHarness(build, [scripted("contract"), scripted("implement")]);
    try {
      await executePipeline(h.options);
      expect(existsSync(`${h.options.runlog.root}/telemetry`)).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  it("every executed pass leaves a complete run record with matching runIds", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const h = makeHarness(build, [
      scripted("contract out", "completed", { cacheCreationTokens: 3, cacheReadTokens: 7 }),
      scripted("implement out"),
    ]);
    try {
      const result = await executePipeline(h.options);
      expect(result.passes.length).toBe(2);

      for (const record of result.passes) {
        const paths = runPaths(h.options.runlog.root, "civic", record.runId);
        expect(existsSync(paths.envelope), record.runId).toBe(true);
        expect(existsSync(paths.events)).toBe(true);
        expect(existsSync(paths.brief)).toBe(true);
        expect(existsSync(paths.prompt)).toBe(true);
        expect(existsSync(paths.output)).toBe(true);

        const envelope = await readEnvelope(h.options.runlog.root, "civic", record.runId);
        expect(envelope.run_id).toBe(record.runId);
        expect(envelope.trace_id).toBe("turn-1");
        expect(envelope.status).toBe("completed");
        expect(envelope).toMatchObject({
          runtime: "claude",
          effort: record.pass.id === "implement" ? "high" : "medium",
          workdir: "/tmp/workdir",
          session: {
            runtime: "claude",
            id: `session-${record.result.summary}`,
            transcript: "unavailable",
          },
          trace_plan: {
            required_passes: ["contract", "implement"],
            skipped_passes: [],
          },
        });
        expect(envelope.usage?.cost_usd).toBe(0.01);
        if (record.pass.id === "contract") {
          expect(envelope.usage?.cache_write_tokens).toBe(3);
          expect(envelope.usage?.cache_read_tokens).toBe(7);
        }
        expect(envelope.previews?.output).toBe(record.result.summary);

        expect(readFileSync(paths.brief, "utf8")).toBe(`brief for ${record.pass.id}`);
        expect(readFileSync(paths.prompt, "utf8")).toContain(`brief for ${record.pass.id}\n\n---\n\n`);
        expect(readFileSync(paths.output, "utf8")).toBe(record.result.summary);

        const events = await readEvents(h.options.runlog.root, "civic", record.runId);
        expect(events.map((e) => e.event)).toEqual([
          "run.started",
          "pass.started",
          "pass.completed",
          "run.completed",
        ]);
        for (const event of events) expect(event.span_id).toBe(record.pass.id);
      }
    } finally {
      h.cleanup();
    }
  });

  it("stamps the workdir's git HEAD into the envelope as the replay seed; non-git workdirs stay absent", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const seeded = makeHarness(build, [scripted("done")], { selection: { tier: "quick" } });
    try {
      const workdir = `${seeded.options.runlog.root}/checkout`;
      mkdirSync(workdir, { recursive: true });
      writeFileSync(`${workdir}/README.md`, "seed\n");
      execSync(
        "git init -q && git -c user.email=t@t -c user.name=t add -A && " +
          "git -c user.email=t@t -c user.name=t commit -qm seed",
        { cwd: workdir },
      );
      const result = await executePipeline({ ...seeded.options, workdir });
      const envelope = await readEnvelope(
        seeded.options.runlog.root,
        "civic",
        result.passes[0]!.runId,
      );
      expect(envelope.git_head).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      seeded.cleanup();
    }

    const bare = makeHarness(build, [scripted("done")], { selection: { tier: "quick" } });
    try {
      const result = await executePipeline(bare.options); // workdir /tmp/workdir — not a repo
      const envelope = await readEnvelope(
        bare.options.runlog.root,
        "civic",
        result.passes[0]!.runId,
      );
      expect(envelope.git_head).toBeUndefined();
    } finally {
      bare.cleanup();
    }
  });

  it("bridges tool_use TurnEvents into L2 tool.called and tallies envelope tool_counts", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const events: TurnEvent[] = [
      { type: "tool_use", detail: "bash: ls", name: "bash", durationMs: 5, success: true, args: { cmd: "ls" } },
      { type: "tool_use", detail: "bash: cat", name: "bash", durationMs: 2, success: false, args: { cmd: "cat x" } },
      { type: "tool_use", detail: "read file", name: "read", durationMs: 1, success: true },
      { type: "text", detail: "thinking out loud" }, // not bridged
    ];
    const h = makeHarness(build, [], {
      selection: { tier: "quick" },
      runtimeFor: () => eventRuntime(events),
    });
    try {
      const result = await executePipeline(h.options);
      const runId = result.passes[0]!.runId;

      const recorded = await readEvents(h.options.runlog.root, "civic", runId);
      const toolCalls = recorded.filter((e) => e.event === "tool.called");
      expect(toolCalls.map((e) => e.detail?.tool)).toEqual(["bash", "bash", "read"]);
      // Raw args never reach L2 — only the hash.
      const raw = readFileSync(runPaths(h.options.runlog.root, "civic", runId).events, "utf8");
      expect(raw).not.toContain("cat x");
      expect(toolCalls[0]?.detail?.args_hash).toMatch(/^[0-9a-f]{16}$/);

      const envelope = await readEnvelope(h.options.runlog.root, "civic", runId);
      expect(envelope.tool_counts).toEqual({ bash: 2, read: 1 });
    } finally {
      h.cleanup();
    }
  });

  it("nests a FakeRuntime scripted subagent event as a span under the pass", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const h = makeHarness(
      build,
      [{ toolActions: [{ action: { tool: "bash", input: { command: "ls" } }, fromSubagent: true }], result: turnResult("done") }],
      { selection: { tier: "quick" } },
    );
    try {
      const result = await executePipeline(h.options);
      const runId = result.passes[0]!.runId;
      const tree = reconstructSpanTree(await readEvents(h.options.runlog.root, "civic", runId));
      expect(tree.length).toBe(1);
      expect(tree[0]?.spanId).toBe("implement");
      expect(tree[0]?.children.length).toBe(1);
      expect(tree[0]?.children[0]?.parentSpanId).toBe("implement");
      expect(tree[0]?.children[0]?.events.map((e) => e.event)).toEqual(["subagent.started"]);
    } finally {
      h.cleanup();
    }
  });

  it("nests structured subagent.started/completed with an inner tool.called", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const events: TurnEvent[] = [
      { type: "subagent", detail: "scout start", name: "scout", phase: "started", spanId: "implement/sub-1" },
      { type: "tool_use", detail: "grep", name: "grep", durationMs: 3, success: true, spanId: "implement/sub-1" },
      { type: "subagent", detail: "scout done", name: "scout", phase: "completed", spanId: "implement/sub-1" },
    ];
    const h = makeHarness(build, [], { selection: { tier: "quick" }, runtimeFor: () => eventRuntime(events) });
    try {
      const result = await executePipeline(h.options);
      const runId = result.passes[0]!.runId;
      const tree = reconstructSpanTree(await readEvents(h.options.runlog.root, "civic", runId));
      const child = tree[0]?.children[0];
      expect(child?.spanId).toBe("implement/sub-1");
      expect(child?.events.map((e) => e.event)).toEqual([
        "subagent.started",
        "tool.called",
        "subagent.completed",
      ]);
    } finally {
      h.cleanup();
    }
  });

  it("bash_heavy and environment_retry detectors fire on real executor output", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const events: TurnEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push({ type: "tool_use", detail: "bash", name: "bash", durationMs: 1, success: true });
    }
    for (let i = 0; i < 3; i++) {
      events.push({ type: "tool_use", detail: "docker retry", name: "bash", durationMs: 1, success: false, category: "environment_retry" });
    }
    const h = makeHarness(build, [], { selection: { tier: "quick" }, runtimeFor: () => eventRuntime(events) });
    try {
      const result = await executePipeline(h.options);
      const runId = result.passes[0]!.runId;
      const envelope = await readEnvelope(h.options.runlog.root, "civic", runId);
      const recorded = await readEvents(h.options.runlog.root, "civic", runId);
      const flags = detectRunAnomalies({ envelope, events: recorded }).map((a) => a.flag);
      expect(flags).toContain("bash_heavy");
      expect(flags).toContain("environment_retry");
      expect(envelope.tool_counts?.["bash"]).toBe(23);
    } finally {
      h.cleanup();
    }
  });

  it("a failed pass aborts later stages; its envelope is failed with an error code event", async () => {
    const build = getPipeline(await loadFixture(), "build");
    const h = makeHarness(build, [scripted("contract dies", "failed")]);
    try {
      const result = await executePipeline(h.options);
      expect(result.aborted).toBe(true);
      expect(result.passes.length).toBe(1);
      expect(h.fake.calls.length).toBe(1); // implement never ran

      const runId = result.passes[0]?.runId as string;
      const envelope = await readEnvelope(h.options.runlog.root, "civic", runId);
      expect(envelope.status).toBe("failed");
      const events = await readEvents(h.options.runlog.root, "civic", runId);
      expect(events.some((e) => e.event === "pass.failed" && e.error_code === "error_turn_failed")).toBe(
        true,
      );
    } finally {
      h.cleanup();
    }
  });
});
