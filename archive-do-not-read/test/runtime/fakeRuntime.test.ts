// Tests the scriptable FakeRuntime double in src/runtime/testing/fakeRuntime.ts.
// Covers scripted result ordering, gate escalation, subagent event/gate order,
// large task transport, call recording, and clear over-call errors.
// Uses in-memory scripts only; no SDK, network, auth, filesystem fixture, real
// org state, or wall-clock time is required.

import { describe, expect, it } from "vitest";
import { FakeRuntime, type ScriptedTurn } from "../../src/runtime/testing/fakeRuntime.js";
import { defaultGate } from "../../src/runtime/gate.js";
import type {
  GateDecision,
  RoleConfig,
  ToolAction,
  TurnEvent,
  TurnHooks,
  TurnRequest,
  TurnResult,
} from "../../src/runtime/types.js";

const role: RoleConfig = {
  name: "builder",
  runtime: "claude",
  model: "claude-sonnet-4-6",
  effort: "medium",
  delegation: { allow: [] },
  triggers: [{ event: "ticket.claimed" }],
  outputs: ["pr"],
  maxTurnBudgetUsd: 5,
};

function makeRequest(task = "do the thing"): TurnRequest {
  return {
    role,
    workdir: "/tmp/fake-workdir",
    task,
    context: { taste: [], memoryExcerpts: [] },
  };
}

function makeResult(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime: "claude", id: "sess-1" },
    usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns: 0, wallClockMs: 0 },
    escalations: [],
  };
}

/** Hooks recorder shared by tests that need to observe gate/onEvent order. */
function makeHooks(gate = defaultGate) {
  const events: TurnEvent[] = [];
  const gateArgs: ToolAction[] = [];
  const wrappedGate = (action: ToolAction): GateDecision => {
    gateArgs.push(action);
    return gate(action);
  };
  const hooks: TurnHooks = {
    gate: wrappedGate,
    onEvent: (e) => events.push(e),
  };
  return { hooks, events, gateArgs };
}

describe("FakeRuntime", () => {
  it("returns scripted TurnResults in call order", async () => {
    const turns: ScriptedTurn[] = [
      { result: makeResult("first") },
      { result: makeResult("second") },
    ];
    const fake = new FakeRuntime(turns);
    const { hooks } = makeHooks();

    const first = await fake.runTurn(makeRequest("task 1"), hooks);
    const second = await fake.runTurn(makeRequest("task 2"), hooks);

    expect(first.summary).toBe("first");
    expect(second.summary).toBe("second");
    expect(fake.calls.map((c) => c.req.task)).toEqual(["task 1", "task 2"]);
  });

  it("invokes hooks.gate and surfaces escalate:true on denial", async () => {
    const criticalAction: ToolAction = { tool: "bash", input: { command: "rm -rf /workspace/data" } };
    const turns: ScriptedTurn[] = [
      { toolActions: [{ action: criticalAction }], result: makeResult("blocked attempt") },
    ];
    const fake = new FakeRuntime(turns);
    const { hooks, gateArgs } = makeHooks();

    const result = await fake.runTurn(makeRequest(), hooks);

    expect(gateArgs).toEqual([criticalAction]);
    expect(fake.calls[0]?.gateCalls[0]?.decision.allow).toBe(false);
    const decision = fake.calls[0]?.gateCalls[0]?.decision;
    expect(decision).toMatchObject({ allow: false, escalate: true });
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0]).toMatchObject({ action: criticalAction });
  });

  it("emits subagent event then routes its action through the gate", async () => {
    const subagentAction: ToolAction = { tool: "bash", input: { command: "npm publish --access public" } };
    const turns: ScriptedTurn[] = [
      {
        toolActions: [{ action: subagentAction, fromSubagent: true }],
        result: makeResult("subagent ran"),
      },
    ];
    const fake = new FakeRuntime(turns);

    const order: string[] = [];
    const hooks: TurnHooks = {
      gate: (action) => {
        order.push(`gate:${action.tool}`);
        return defaultGate(action);
      },
      onEvent: (e) => order.push(`event:${e.type}`),
    };

    const result = await fake.runTurn(makeRequest(), hooks);

    // The gate must see the subagent's action after the subagent event fires
    // — proving a subagent-issued critical op is caught identically to a
    // top-level one (docs/loop/design.md §2).
    expect(order).toEqual(["event:subagent", "gate:bash"]);
    expect(fake.calls[0]?.events).toEqual([
      { type: "subagent", detail: expect.stringContaining("bash") },
    ]);
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0]?.action).toEqual(subagentAction);
  });

  it("accepts a 300KB task without truncation", async () => {
    const bigTask = "x".repeat(300 * 1024 + 1);
    const turns: ScriptedTurn[] = [{ result: makeResult("ok") }];
    const fake = new FakeRuntime(turns);
    const { hooks } = makeHooks();

    await fake.runTurn(makeRequest(bigTask), hooks);

    expect(fake.calls[0]?.req.task.length).toBe(bigTask.length);
    expect(fake.calls[0]?.req.task).toBe(bigTask);
  });

  it("throws clearly when over-called", async () => {
    const turns: ScriptedTurn[] = [{ result: makeResult("only one") }];
    const fake = new FakeRuntime(turns);
    const { hooks } = makeHooks();

    await fake.runTurn(makeRequest(), hooks);

    await expect(fake.runTurn(makeRequest(), hooks)).rejects.toThrow(
      /over-called.*only 1 scripted turn/i,
    );
  });
});
