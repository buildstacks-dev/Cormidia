// Tests the Claude runtime adapter with the Claude Agent SDK's query() mocked.
// Covers the shared runtime conformance suite (critical-op escalation, routine
// allow, subagent gating, large-payload transport) driven through the REAL
// ClaudeRuntime by a scripted queryFn stand-in — no CLI spawn, no network, no
// auth, no tokens.
//
// P1-07 / D-001: Invariant #12 ("every Runtime must pass the conformance suite
// before its role goes live") had NO offline coverage for Claude — the primary
// provider running 5 of 8 roles including reviewer. Its only conformance lived
// in a *.live.test.ts that vitest.config.ts excludes from `pnpm test` and that
// failed open when auth was absent. This file closes that gap by pinning the
// exact same runConformanceSuite cases in the offline suite, mirroring how
// codex-mocked (test/adapters/codex.test.ts) and pi-mocked (test/adapters/
// pi.test.ts) drive their real adapters through a mocked transport.
//
// The mock feeds the adapter's PreToolUse hook channel — the same channel the
// gate rides live (src/runtime/adapters/claude.ts header) — and yields
// SDK-shaped system/result messages, so a failure here isolates to the Claude
// adapter, never to the shared contract.

import { describe, expect, it } from "vitest";
import type {
  HookInput,
  HookJSONOutput,
  Options as SdkOptions,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { ClaudeRuntime, type QueryFn } from "../../src/runtime/adapters/claude.js";
import { defaultGate } from "../../src/runtime/gate.js";
import type { ScriptedTurn } from "../../src/runtime/testing/fakeRuntime.js";
import type { RoleConfig, ToolAction, TurnEvent } from "../../src/runtime/types.js";
import { runConformanceSuite } from "../conformance/harness.js";

const CLAUDE_ROLE: RoleConfig = {
  name: "conformance-mocked",
  runtime: "claude",
  model: "claude-mocked-model",
  effort: "low",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 5,
};

const SESSION_ID = "claude-mocked-session";

/** Translate a gate-neutral ScriptedTurn ToolAction into the SDK tool-call
 *  shape the CLI would emit (Bash/Write/Read/Edit with `file_path`), so the
 *  adapter's normalizeToolAction maps it back to the exact neutral action the
 *  conformance suite asserts on. */
function toSdkToolCall(action: ToolAction): { toolName: string; toolInput: Record<string, unknown> } {
  const input = action.input as Record<string, unknown>;
  switch (action.tool) {
    case "bash":
      return { toolName: "Bash", toolInput: { command: input.command } };
    case "write":
      return { toolName: "Write", toolInput: { file_path: input.path, content: input.content } };
    case "read":
      return { toolName: "Read", toolInput: { file_path: input.path } };
    case "edit":
      return {
        toolName: "Edit",
        toolInput: { file_path: input.path, old_string: input.old_string, new_string: input.new_string },
      };
    default:
      return { toolName: action.tool, toolInput: input };
  }
}

function initMessage(cwd: string): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    apiKeySource: "none",
    cwd,
    tools: [],
    mcp_servers: [],
    model: CLAUDE_ROLE.model,
    session_id: SESSION_ID,
  } as unknown as SDKMessage;
}

/** A Task-tool subagent spawn as the CLI reports it: the adapter fires its
 *  "subagent" event off this before the subagent's own tool call hits the
 *  gate. */
function taskStartedMessage(): SDKMessage {
  return {
    type: "system",
    subtype: "task_started",
    task_id: "task-1",
    description: "conformance gate probe subagent",
    subagent_type: "gate-probe",
    session_id: SESSION_ID,
  } as unknown as SDKMessage;
}

function successResultMessage(summary: string): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    result: summary,
    stop_reason: "end_turn",
    total_cost_usd: 0.001,
    duration_ms: 5,
    duration_api_ms: 5,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 2,
    },
    modelUsage: {},
    permission_denials: [],
    session_id: SESSION_ID,
  } as unknown as SDKMessage;
}

/** A scripted queryFn stand-in for the SDK's query(): drives the adapter's
 *  PreToolUse hook for each scripted tool action (the sole gate channel; the
 *  dormant canUseTool backstop is intentionally not invoked, matching live
 *  behavior and the suite's exact one-gate-call-per-action assertion) and
 *  yields SDK-shaped init/task_started/result messages. */
function makeClaudeQueryFn(turns: ScriptedTurn[]): QueryFn {
  return ({ options }: { prompt: string; options?: SdkOptions }) => {
    const turn = turns[0];
    if (turn === undefined || turns.length !== 1) {
      throw new Error("mocked Claude conformance drives exactly one scripted turn per runtime");
    }
    const cwd = (options?.cwd as string | undefined) ?? "";
    const preToolUseMatchers = options?.hooks?.PreToolUse ?? [];

    const invokePreToolUse = async (
      toolName: string,
      toolInput: unknown,
      fromSubagent: boolean,
    ): Promise<void> => {
      const input = {
        hook_event_name: "PreToolUse",
        tool_name: toolName,
        tool_input: toolInput,
        tool_use_id: "tool-use-1",
        session_id: SESSION_ID,
        transcript_path: "",
        cwd,
        ...(fromSubagent ? { agent_id: "subagent-1", agent_type: "gate-probe" } : {}),
      } as unknown as HookInput;
      for (const matcher of preToolUseMatchers) {
        for (const hook of matcher.hooks) {
          const out = (await hook(input, "tool-use-1", {
            signal: new AbortController().signal,
          })) as HookJSONOutput;
          void out; // decision drives the live CLI; the mock does not execute tools
        }
      }
    };

    return (async function* () {
      yield initMessage(cwd);
      for (const scripted of turn.toolActions ?? []) {
        // Yield the spawn notification first so the adapter's "subagent" event
        // fires BEFORE the subagent's tool call reaches the gate — the exact
        // [event:subagent, gate:<tool>] order the suite asserts.
        if (scripted.fromSubagent) yield taskStartedMessage();
        const { toolName, toolInput } = toSdkToolCall(scripted.action);
        await invokePreToolUse(toolName, toolInput, scripted.fromSubagent === true);
      }
      yield successResultMessage(turn.result.summary);
    })();
  };
}

function makeClaudeRuntime(turns: ScriptedTurn[]): ClaudeRuntime {
  return new ClaudeRuntime({ queryFn: makeClaudeQueryFn(turns) });
}

describe("ClaudeRuntime (Agent SDK mocked)", () => {
  it("routes a gate-allowed tool call once and passes usage/session through", async () => {
    const events: TurnEvent[] = [];
    const gateCalls: ToolAction[] = [];
    const result = await makeClaudeRuntime([
      { toolActions: [{ action: { tool: "bash", input: { command: "pnpm test" } } }], result: doneResult() },
    ]).runTurn(
      { role: CLAUDE_ROLE, workdir: "/tmp/operon-claude-mock", task: "run tests", context: { taste: [], memoryExcerpts: [] } },
      {
        gate: (a) => {
          gateCalls.push(a);
          return defaultGate(a);
        },
        onEvent: (e) => events.push(e),
      },
    );

    // Exactly one gate call (the PreToolUse hook answers; canUseTool stays
    // dormant), a matching pre-execution tool_use event, no escalation.
    expect(gateCalls).toEqual([{ tool: "bash", input: { command: "pnpm test" } }]);
    expect(events.filter((e) => e.type === "tool_use")).toHaveLength(1);
    expect(result.status).toBe("completed");
    expect(result.escalations).toHaveLength(0);
    expect(result.session).toEqual({ runtime: "claude", id: SESSION_ID });
    // Result usage flows from the terminal result message (10 + 0 + 2 in).
    expect(result.usage).toMatchObject({ tokensIn: 12, cacheReadTokens: 2, tokensOut: 5 });
  });

  it("escalates a critical op and does not emit it as tool activity", async () => {
    const events: TurnEvent[] = [];
    const result = await makeClaudeRuntime([
      { toolActions: [{ action: { tool: "bash", input: { command: "cat .env" } } }], result: doneResult() },
    ]).runTurn(
      { role: CLAUDE_ROLE, workdir: "/tmp/operon-claude-mock", task: "read secrets", context: { taste: [], memoryExcerpts: [] } },
      { gate: defaultGate, onEvent: (e) => events.push(e) },
    );

    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0]?.reason).toContain("secrets-or-auth");
    // A denied attempt is an escalation, not tool activity (issue #27).
    expect(events.filter((e) => e.type === "tool_use")).toHaveLength(0);
  });
});

function doneResult() {
  return {
    status: "completed" as const,
    summary: "done",
    artifacts: [],
    session: { runtime: "claude" as const, id: SESSION_ID },
    usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns: 0, wallClockMs: 0 },
    escalations: [],
  };
}

const CLAUDE_CONFORMANCE_WORKDIR = "/tmp/operon-claude-conformance";
runConformanceSuite("claude-mocked", makeClaudeRuntime, {
  role: CLAUDE_ROLE,
  workdir: CLAUDE_CONFORMANCE_WORKDIR,
});
