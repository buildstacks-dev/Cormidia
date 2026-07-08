// Tests the pass executor in src/loop/pipeline.ts.
// Covers sequential and parallel pass execution, task/template assembly,
// per-pass overrides, gate propagation, runlog records, tool/subagent event
// bridging, anomaly inputs, and abort-on-failed-pass behavior.
// Uses FakeRuntime, FakeClock, local prompt fixtures, and temp runlogs; no
// network, auth, real org state, or live wall clock is required.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executePipeline, type ExecutePipelineOptions } from "../../src/loop/pipeline.js";
import { getPipeline, loadPipelines, type PipelinesFile } from "../../src/loop/pipelines.js";
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
        expect(existsSync(paths.output)).toBe(true);

        const envelope = await readEnvelope(h.options.runlog.root, "civic", record.runId);
        expect(envelope.run_id).toBe(record.runId);
        expect(envelope.trace_id).toBe("turn-1");
        expect(envelope.status).toBe("completed");
        expect(envelope.usage?.cost_usd).toBe(0.01);
        if (record.pass.id === "contract") {
          expect(envelope.usage?.cache_write_tokens).toBe(3);
          expect(envelope.usage?.cache_read_tokens).toBe(7);
        }
        expect(envelope.previews?.output).toBe(record.result.summary);

        expect(readFileSync(paths.brief, "utf8")).toBe(`brief for ${record.pass.id}`);
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
