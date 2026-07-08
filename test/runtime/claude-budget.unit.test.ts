// Tests ClaudeRuntime budget and usage telemetry behavior with the SDK mocked.
// Covers passing the role budget cap to the SDK, over-budget failure and incident
// note creation, under-budget completion, real cost attribution, and telemetry
// record conversion.
// Uses injectable SDK messages only; no API key, network, real org state, or
// wall-clock time is required.

import { describe, expect, it } from "vitest";
import type { Options as SdkOptions, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeRuntime, type QueryFn } from "../../src/runtime/adapters/claude.js";
import { defaultGate } from "../../src/runtime/gate.js";
import { toRecord } from "../../src/runtime/telemetry.js";
import type { RoleConfig, TurnRequest } from "../../src/runtime/types.js";

const ROLE: RoleConfig = {
  name: "builder",
  runtime: "claude",
  model: "claude-sonnet-5",
  effort: "high",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 5,
};

const USAGE = {
  input_tokens: 2000,
  output_tokens: 900,
  cache_creation_input_tokens: 300,
  cache_read_input_tokens: 700,
};

const initMsg: SDKMessage = {
  type: "system",
  subtype: "init",
  session_id: "budget-sess",
} as unknown as SDKMessage;

const underBudgetResult: SDKMessage = {
  type: "result",
  subtype: "success",
  result: "shipped the fix",
  total_cost_usd: 0.87,
  duration_ms: 42_000,
  num_turns: 3,
  usage: USAGE,
  session_id: "budget-sess",
} as unknown as SDKMessage;

const overBudgetResult: SDKMessage = {
  type: "result",
  subtype: "error_max_budget_usd",
  errors: ["Query exceeded maximum budget of $5"],
  total_cost_usd: 5.1234,
  duration_ms: 180_000,
  num_turns: 9,
  usage: USAGE,
  session_id: "budget-sess",
} as unknown as SDKMessage;

function makeReq(): TurnRequest {
  return {
    role: ROLE,
    workdir: "/wd",
    task: "implement the ticket",
    context: { taste: [], memoryExcerpts: [] },
  };
}

function scriptedQuery(messages: SDKMessage[]) {
  const captured: { options?: SdkOptions } = {};
  const queryFn: QueryFn = ({ options }) => {
    captured.options = options;
    return (async function* () {
      for (const m of messages) yield m;
    })();
  };
  return { captured, queryFn };
}

describe("ClaudeRuntime per-turn budget (SDK mocked)", () => {
  it("passes role.maxTurnBudgetUsd to the SDK as the running budget guard", async () => {
    const { captured, queryFn } = scriptedQuery([initMsg, underBudgetResult]);
    // baseOptions must not be able to loosen the role's cap
    const rt = new ClaudeRuntime({ queryFn, baseOptions: { maxBudgetUsd: 999 } });

    await rt.runTurn(makeReq(), { gate: defaultGate });

    expect(captured.options?.maxBudgetUsd).toBe(5);
  });

  it("over-budget turn → status failed + exactly one incident note mentioning the overrun", async () => {
    const { queryFn } = scriptedQuery([initMsg, overBudgetResult]);
    const result = await new ClaudeRuntime({ queryFn }).runTurn(makeReq(), {
      gate: defaultGate,
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("error_max_budget_usd");

    expect(result.artifacts).toHaveLength(1);
    const note = result.artifacts[0]!;
    expect(note.kind).toBe("note");
    expect(note.summary).toMatch(/overrun/i);
    expect(note.summary).toContain("$5.1234"); // actual spend
    expect(note.summary).toContain("maxTurnBudgetUsd $5"); // the cap it crossed
    expect(note.summary).toContain("builder"); // whose budget

    // Cost is the real mocked total even on the failure path — the spend
    // happened and must be attributed, not zeroed.
    expect(result.usage.costUsd).toBe(5.1234);
  });

  it("under-budget turn → completed, costUsd is the mocked total, no incident note", async () => {
    const { queryFn } = scriptedQuery([initMsg, underBudgetResult]);
    const result = await new ClaudeRuntime({ queryFn }).runTurn(makeReq(), {
      gate: defaultGate,
    });

    expect(result.status).toBe("completed");
    expect(result.usage.costUsd).toBe(0.87); // not a placeholder
    expect(result.artifacts).toEqual([]);
  });

  it("real usage flows into telemetry's toRecord unchanged", async () => {
    const { queryFn } = scriptedQuery([initMsg, underBudgetResult]);
    const result = await new ClaudeRuntime({ queryFn }).runTurn(makeReq(), {
      gate: defaultGate,
    });

    const record = toRecord(ROLE, result, new Date("2026-07-05T12:00:00Z"));

    expect(record).toMatchObject({
      role: "builder",
      runtime: "claude",
      model: "claude-sonnet-5",
      status: "completed",
      tokensIn: 3000, // input + cache_creation + cache_read
      tokensInUncached: 2000,
      cacheCreationTokens: 300,
      cacheReadTokens: 700,
      tokensOut: 900,
      costUsd: 0.87,
      subagentTurns: 0,
      wallClockMs: 42_000,
      escalations: 0,
    });
  });
});
