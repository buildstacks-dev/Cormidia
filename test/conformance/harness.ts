// Adapter-generic conformance suite (build plan M0.4). AGENTS.md: "Every
// adapter must pass these cases end-to-end (including subagent tool calls)
// before a role goes live on it." This module is the executable form of
// that rule — Claude/Codex/pi (and anything standing in for them in a test)
// all get judged by the same `runConformanceSuite`.
//
// The suite is driven by ScriptedTurn (src/runtime/testing/fakeRuntime.ts):
// a provider-neutral "attempt these tool actions, in order, then return this
// TurnResult" scenario. `makeRuntime` turns a ScriptedTurn[] script into a
// concrete Runtime instance — trivial for FakeRuntime (test/conformance/
// conformance.test.ts does exactly that); a future live-adapter conformance
// test supplies its own `makeRuntime` that drives the real adapter through
// an equivalent scripted scenario (e.g. a mocked SDK), reusing every case
// and assertion here so a failure isolates to that adapter, never to the
// contract itself.

import { expect, it } from "vitest";
import { defaultGate } from "../../src/runtime/gate.js";
import type { ScriptedTurn } from "../../src/runtime/testing/fakeRuntime.js";
import type {
  GateFn,
  RoleConfig,
  Runtime,
  ToolAction,
  TurnEvent,
  TurnHooks,
  TurnRequest,
  TurnResult,
} from "../../src/runtime/types.js";
import { CRITICAL_CASES, LARGE_PAYLOAD_SIZE_BYTES, ROUTINE_CASES, SUBAGENT_CRITICAL_CASE } from "./cases.js";

export interface ConformanceOpts {
  /** Gate function every case is routed through. Defaults to the org's
   *  deny-and-escalate default policy (src/runtime/gate.ts) — override only
   *  to prove the suite against a deliberately different policy. */
  gate?: GateFn;
  /** Role/workdir stand-ins for TurnRequest construction. Defaults are
   *  self-descriptive placeholders; override if a subject Runtime needs a
   *  particular role shape (e.g. a real model id) to construct. */
  role?: RoleConfig;
  workdir?: string;
}

const DEFAULT_ROLE: RoleConfig = {
  name: "conformance-subject",
  runtime: "claude",
  model: "conformance-test-model",
  effort: "medium",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 5,
};

const DEFAULT_WORKDIR = "/tmp/conformance-workdir";

function baseResult(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime: "claude", id: "conformance-session" },
    usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns: 0, wallClockMs: 0 },
    escalations: [],
  };
}

function makeRequest(role: RoleConfig, workdir: string, task: string): TurnRequest {
  return { role, workdir, task, context: { taste: [], memoryExcerpts: [] } };
}

/**
 * Runs the adapter-generic conformance suite against a Runtime built from a
 * scripted scenario by `makeRuntime`. `name` labels the subject in every
 * test title (e.g. "fake", "claude") so a failure is attributable at a
 * glance and `grep`-able across adapters.
 */
export function runConformanceSuite(
  name: string,
  makeRuntime: (turns: ScriptedTurn[]) => Runtime,
  opts: ConformanceOpts = {},
): void {
  const gate = opts.gate ?? defaultGate;
  const role = opts.role ?? DEFAULT_ROLE;
  const workdir = opts.workdir ?? DEFAULT_WORKDIR;

  it(`Conformance: ${name} — critical ops escalate`, async () => {
    for (const { name: caseName, action, rule } of CRITICAL_CASES) {
      const turns: ScriptedTurn[] = [
        { toolActions: [{ action }], result: baseResult(`attempted ${caseName}`) },
      ];
      const runtime = makeRuntime(turns);
      const gateCalls: ToolAction[] = [];
      const hooks: TurnHooks = {
        gate: (a) => {
          gateCalls.push(a);
          return gate(a);
        },
      };

      const result = await runtime.runTurn(makeRequest(role, workdir, `attempt: ${caseName}`), hooks);

      expect(gateCalls, `${caseName}: hooks.gate must see the attempted action`).toEqual([action]);
      expect(result.escalations, `${caseName} (${rule}) must be denied + escalated`).toHaveLength(1);
      expect(result.escalations[0]?.action).toEqual(action);
      expect(
        result.escalations[0]?.reason,
        `${caseName}: escalation reason should name the tripped rule (${rule})`,
      ).toContain(rule);
    }

    // Goal: "routine ops allowed" — proven through the same runtime
    // construction path as the critical cases above, not asserted separately
    // against the bare gate function.
    for (const action of ROUTINE_CASES) {
      const turns: ScriptedTurn[] = [{ toolActions: [{ action }], result: baseResult("routine op ran") }];
      const runtime = makeRuntime(turns);
      const hooks: TurnHooks = { gate };

      const result = await runtime.runTurn(makeRequest(role, workdir, "routine op"), hooks);

      expect(result.escalations, `routine op must not escalate: ${JSON.stringify(action)}`).toHaveLength(0);
      expect(result.status).toBe("completed");
    }
  });

  it(`Conformance: ${name} — subagent critical op escalates`, async () => {
    const events: TurnEvent[] = [];
    const gateCallOrder: string[] = [];
    const turns: ScriptedTurn[] = [
      {
        toolActions: [{ action: SUBAGENT_CRITICAL_CASE.action, fromSubagent: true }],
        result: baseResult("subagent attempted critical op"),
      },
    ];
    const runtime = makeRuntime(turns);
    const hooks: TurnHooks = {
      gate: (a) => {
        gateCallOrder.push(`gate:${a.tool}`);
        return gate(a);
      },
      onEvent: (e) => {
        events.push(e);
        gateCallOrder.push(`event:${e.type}`);
      },
    };

    const result = await runtime.runTurn(
      makeRequest(role, workdir, "spawn subagent to attempt a critical op"),
      hooks,
    );

    // A subagent-issued critical op must be caught identically to a
    // top-level one (docs/loop.md §2; TurnHooks.gate's doc comment in
    // src/runtime/types.ts): the subagent event fires, then the gate sees
    // the action, then it is denied + escalated exactly like the top-level
    // cases above.
    expect(events.some((e) => e.type === "subagent"), "a subagent event must have fired").toBe(true);
    expect(gateCallOrder).toEqual([`event:subagent`, `gate:${SUBAGENT_CRITICAL_CASE.action.tool}`]);
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0]?.action).toEqual(SUBAGENT_CRITICAL_CASE.action);
    expect(result.escalations[0]?.reason).toContain(SUBAGENT_CRITICAL_CASE.rule);
  });

  it(`Conformance: ${name} — large payload (300KB) transports`, async () => {
    const bigTask = "x".repeat(LARGE_PAYLOAD_SIZE_BYTES);
    const turns: ScriptedTurn[] = [{ result: baseResult("large payload accepted") }];
    const runtime = makeRuntime(turns);
    const hooks: TurnHooks = { gate };

    const req = makeRequest(role, workdir, bigTask);
    const result = await runtime.runTurn(req, hooks);

    // docs/loop.md §2's ARG_MAX lesson: the brief must transport intact, not
    // truncated or corrupted by an argv-sized channel.
    expect(req.task.length).toBe(LARGE_PAYLOAD_SIZE_BYTES);
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("large payload accepted");
  });
}
