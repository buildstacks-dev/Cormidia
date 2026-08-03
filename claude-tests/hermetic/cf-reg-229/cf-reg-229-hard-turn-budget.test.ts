// #229 — hard execution admission. Budget exhaustion terminates the current
// turn and refuses the next tool action; it never creates an approval item.

import { afterEach, describe, expect, it } from "vitest";
import type {
  GateDecision,
  RoleConfig,
  Runtime,
  TurnHooks,
  TurnRequest,
  TurnResult,
  TurnUsage,
} from "../../../src/runtime/types.js";
import { executePipeline } from "../../../src/loop/pipeline.js";
import type { RouteBudget } from "../../../src/loop/efficiency.js";
import { readEnvelope } from "../../../src/runtime/runlog/envelope.js";
import { readTurnRecords } from "../../../src/runtime/telemetry.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const ROLE: RoleConfig = {
  name: "builder",
  runtime: "claude",
  model: "claude-scripted-model",
  effort: "medium",
  delegation: { allow: [] },
  triggers: [],
  outputs: ["pr"],
  maxTurnBudgetUsd: 5,
};

function usage(costUsd: number): TurnUsage {
  return {
    tokensIn: 1_000_000,
    tokensOut: 100,
    costUsd,
    subagentTurns: 0,
    wallClockMs: 100,
    quality: "partial",
  };
}

function stopped(req: TurnRequest, finalUsage: TurnUsage, reason: string): TurnResult {
  return {
    status: "failed",
    errorCode: "scripted_runtime_stopped",
    summary: reason,
    artifacts: [],
    session: { runtime: "claude", id: "scripted-budget-session" },
    usage: finalUsage,
    escalations: [],
  };
}

class ControlledBudgetRuntime implements Runtime {
  readonly kind = "claude" as const;
  readonly mode: "cost" | "tools" | "terminal";
  executedActions = 0;
  decisions: GateDecision[] = [];

  constructor(mode: "cost" | "tools" | "terminal") {
    this.mode = mode;
  }

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    if (this.mode === "terminal") {
      hooks.onProgress?.({
        session: { runtime: "claude", id: "scripted-budget-session" },
        usage: usage(0),
      });
      return {
        status: "failed",
        errorCode: "error_max_budget_usd",
        summary: "native provider cap stopped the turn",
        artifacts: [{ kind: "note", ref: "budget-overrun/scripted", summary: "native cap" }],
        session: { runtime: "claude", id: "scripted-budget-session" },
        usage: usage(5.4),
        escalations: [],
      };
    }
    hooks.onProgress?.({
      session: { runtime: "claude", id: "scripted-budget-session" },
      usage: usage(this.mode === "cost" ? 4.75 : 0.25),
    });
    const attempts = this.mode === "cost" ? 2 : 41;
    let currentUsage = usage(this.mode === "cost" ? 4.75 : 0.25);
    for (let index = 1; index <= attempts; index += 1) {
      if (this.mode === "cost" && index === 2) {
        currentUsage = usage(5);
        hooks.onProgress?.({ usage: currentUsage });
      }
      const decision = hooks.gate({ tool: "read", input: { index } });
      this.decisions.push(decision);
      if (!decision.allow) return stopped(req, currentUsage, decision.reason);
      this.executedActions += 1;
      hooks.onEvent?.({ type: "tool_use", name: "read", args: { index }, detail: `read ${index}` });
      if (req.signal?.aborted) return stopped(req, currentUsage, "runtime observed cancellation");
    }
    return {
      status: "completed",
      summary: "scripted actions completed",
      artifacts: [],
      session: { runtime: "claude", id: "scripted-budget-session" },
      usage: { ...currentUsage, quality: "complete" },
      escalations: [],
    };
  }
}

class HardBoundViolation extends Error {
  constructor(observed: number, cap: number) {
    super(`executed ${observed} actions against hard cap ${cap}`);
    this.name = "HardBoundViolation";
  }
}

function assertAtMost(observed: number, cap: number): void {
  if (observed > cap) throw new HardBoundViolation(observed, cap);
}

describe("CF-REG-229 — hard per-turn execution budget", () => {
  const homes: TempStateHome[] = [];
  afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

  async function run(
    runtime: ControlledBudgetRuntime,
    episode: string,
    budgetOverrides: Partial<RouteBudget> = { equivalent_cost_usd: 5 },
    onRuntimeFactory?: () => void,
  ) {
    const home = await makeTempStateHome({ name: episode });
    homes.push(home);
    const result = await executePipeline({
      pipeline: {
        name: "budget-fixture",
        mechanical: false,
        passes: [{ id: "implement", role: "builder", template: "" }],
      },
      selection: { tier: "quick" },
      roles: { builder: ROLE },
      runtimeFor: () => {
        onRuntimeFactory?.();
        return runtime;
      },
      briefFor: () => "Exercise the controlled budget boundary.",
      promptsDir: home.stateHome,
      context: { taste: [], memoryExcerpts: [] },
      workdir: home.stateHome,
      hooks: { gate: () => ({ allow: true }) },
      runlog: { root: home.stateHome, app: "app", traceId: `trace-${episode}` },
      episode: {
        id: episode,
        route: "quick",
        budgetOverrides,
      },
      telemetry: { orgDir: home.stateHome },
    });
    const pass = result.passes[0]!;
    return {
      home,
      result,
      pass,
      envelope: await readEnvelope(home.stateHome, "app", pass.runId),
      settlements: await readTurnRecords(home.stateHome),
    };
  }

  it("retains the final safe cost chunk and refuses the next action at the $5 ceiling", async () => {
    const runtime = new ControlledBudgetRuntime("cost");
    const observed = await run(runtime, "episode-cost-bound");

    expect(runtime.executedActions).toBe(1);
    expect(runtime.decisions.at(-1)).toMatchObject({ allow: false, escalate: false });
    expect(observed.pass.result).toMatchObject({
      status: "failed",
      errorCode: "error_turn_budget_exhausted",
      usage: { costUsd: 5, tokensIn: 1_000_000 },
    });
    expect(observed.settlements).toHaveLength(1);
    expect(observed.settlements[0]).toMatchObject({ costUsd: 5, tokensIn: 1_000_000 });
    expect(observed.envelope).toMatchObject({
      effective_bounds: {
        equivalent_cost_usd: 5,
        tool_calls: 40,
        provider_turns: 3,
      },
      budget_stop: {
        dimension: "equivalent_cost_usd",
        cap: 5,
        observed: 5,
        prevented_next_action: "provider_continuation",
        cost_measurement: "measured",
      },
    });
  });

  it("refuses tool action 41 before execution and settles non-zero partial usage", async () => {
    const runtime = new ControlledBudgetRuntime("tools");
    const observed = await run(runtime, "episode-tool-bound");

    expect(runtime.executedActions).toBe(40);
    assertAtMost(runtime.executedActions, 40);
    expect(observed.pass.result).toMatchObject({
      status: "failed",
      errorCode: "error_turn_budget_exhausted",
      usage: { costUsd: 0.25 },
    });
    expect(observed.envelope.budget_stop).toMatchObject({
      dimension: "tool_calls",
      cap: 40,
      observed: 40,
      prevented_next_action: "read",
    });
    expect(observed.settlements).toHaveLength(1);
    expect(observed.settlements[0]!.costUsd).toBeGreaterThan(0);
  });

  it("refuses provider construction when no active-time allowance remains", async () => {
    const runtime = new ControlledBudgetRuntime("tools");
    let runtimeFactoryCalls = 0;
    const observed = await run(
      runtime,
      "episode-active-time-bound",
      { equivalent_cost_usd: 5, active_time_ms: 0 },
      () => { runtimeFactoryCalls += 1; },
    );

    expect(runtimeFactoryCalls).toBe(0);
    expect(runtime.executedActions).toBe(0);
    expect(observed.pass.result).toMatchObject({
      status: "failed",
      errorCode: "error_turn_budget_exhausted",
    });
    expect(observed.envelope).toMatchObject({
      effective_bounds: { active_time_ms: 0 },
      budget_stop: {
        dimension: "active_time_ms",
        cap: 0,
        observed: 0,
        prevented_next_action: "provider_continuation",
      },
    });
    expect(observed.settlements).toEqual([]);
  });

  it("normalizes a native terminal cap into central budget-stop evidence without losing overshoot", async () => {
    const runtime = new ControlledBudgetRuntime("terminal");
    const observed = await run(runtime, "episode-terminal-native-cap");

    expect(observed.pass.result).toMatchObject({
      status: "failed",
      errorCode: "error_turn_budget_exhausted",
      usage: { costUsd: 5.4 },
    });
    expect(observed.envelope.budget_stop).toMatchObject({
      dimension: "equivalent_cost_usd",
      cap: 5,
      observed: 5.4,
      cost_measurement: "measured",
    });
    expect(observed.settlements).toHaveLength(1);
    expect(observed.settlements[0]!.costUsd).toBe(5.4);
  });

  it("negative control: the detector fires for the old post-hoc 41st action", () => {
    expect(() => assertAtMost(41, 40)).toThrow(HardBoundViolation);
  });
});
