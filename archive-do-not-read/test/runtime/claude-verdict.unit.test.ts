// Tests ClaudeRuntime structured-output option mapping.
// Covers translating TurnRequest.verdictSchema to SDK outputFormat, omitting it
// when absent, and preserving baseOptions outputFormat when no schema is given.
// Uses mocked SDK messages only; no API key, network, real org state, or
// wall-clock time is required.

import { describe, expect, it, vi } from "vitest";
import type { Options as SdkOptions, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeRuntime, type QueryFn } from "../../src/runtime/adapters/claude.js";
import { defaultGate } from "../../src/runtime/gate.js";
import type { RoleConfig, TurnEvent, TurnRequest } from "../../src/runtime/types.js";

const ROLE: RoleConfig = {
  name: "reviewer",
  runtime: "claude",
  model: "claude-opus-4-8",
  effort: "xhigh",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 5,
};

const MESSAGES: SDKMessage[] = [
  { type: "system", subtype: "init", session_id: "s1" } as unknown as SDKMessage,
  {
    type: "result",
    subtype: "success",
    result: '{"verdict":"approve"}',
    total_cost_usd: 0.1,
    duration_ms: 100,
    num_turns: 1,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    session_id: "s1",
  } as unknown as SDKMessage,
];

const VERDICT_SCHEMA = {
  type: "object",
  properties: { verdict: { type: "string", enum: ["approve", "request_changes"] } },
  required: ["verdict"],
  additionalProperties: false,
};

function makeReq(over: Partial<TurnRequest> = {}): TurnRequest {
  return {
    role: ROLE,
    workdir: "/wd",
    task: "review the PR",
    context: { taste: [], memoryExcerpts: [] },
    ...over,
  };
}

function scriptedQuery() {
  const captured: { options?: SdkOptions | undefined } = {};
  const queryFn: QueryFn = ({ options }) => {
    captured.options = options;
    return (async function* () {
      for (const m of MESSAGES) yield m;
    })();
  };
  return { captured, queryFn };
}

describe("TurnRequest.verdictSchema (SDK mocked)", () => {
  it("with a schema set, the SDK receives native structured-output options", async () => {
    const { captured, queryFn } = scriptedQuery();

    await new ClaudeRuntime({ queryFn }).runTurn(makeReq({ verdictSchema: VERDICT_SCHEMA }), {
      gate: defaultGate,
    });

    expect(captured.options?.outputFormat).toEqual({
      type: "json_schema",
      schema: VERDICT_SCHEMA,
    });
  });

  it("lets the schema-bound StructuredOutput channel cross a deny-all gate and preserves the validated object", async () => {
    const gate = vi.fn(() => ({
      allow: false as const,
      reason: "planner tools are denied",
      escalate: false,
    }));
    const events: TurnEvent[] = [];
    const queryFn: QueryFn = ({ options }) =>
      (async function* () {
        yield MESSAGES[0]!;
        const hook = options!.hooks!.PreToolUse![0]!.hooks[0]!;
        const input = { verdict: "approve" };
        const hookResult = await hook(
          {
            hook_event_name: "PreToolUse",
            tool_name: "StructuredOutput",
            tool_input: input,
            tool_use_id: "structured-1",
            session_id: "s1",
            transcript_path: "",
            cwd: "/wd",
          } as Parameters<typeof hook>[0],
          "structured-1",
          { signal: new AbortController().signal },
        );
        expect(hookResult).toMatchObject({
          hookSpecificOutput: { permissionDecision: "allow" },
        });
        await expect(options!.canUseTool!(
          "StructuredOutput",
          input,
          {
            signal: new AbortController().signal,
            toolUseID: "structured-1",
            requestId: "request-1",
          },
        )).resolves.toMatchObject({ behavior: "allow", updatedInput: input });
        yield {
          ...MESSAGES[1]!,
          result: "unconstrained fallback text",
          structured_output: input,
        } as SDKMessage;
      })();

    const result = await new ClaudeRuntime({ queryFn }).runTurn(
      makeReq({ verdictSchema: VERDICT_SCHEMA }),
      { gate, onEvent: (event) => events.push(event) },
    );

    expect(result.summary).toBe('{"verdict":"approve"}');
    expect(gate).not.toHaveBeenCalled();
    expect(events.filter((event) => event.type === "tool_use")).toEqual([]);
  });

  it("routes a StructuredOutput-named tool through the ordinary gate when no schema is bound", async () => {
    const gate = vi.fn(() => ({
      allow: false as const,
      reason: "ordinary tool denied",
      escalate: false,
    }));
    const queryFn: QueryFn = ({ options }) =>
      (async function* () {
        yield MESSAGES[0]!;
        const hook = options!.hooks!.PreToolUse![0]!.hooks[0]!;
        const hookResult = await hook(
          {
            hook_event_name: "PreToolUse",
            tool_name: "StructuredOutput",
            tool_input: { verdict: "approve" },
            tool_use_id: "ordinary-1",
            session_id: "s1",
            transcript_path: "",
            cwd: "/wd",
          } as Parameters<typeof hook>[0],
          "ordinary-1",
          { signal: new AbortController().signal },
        );
        expect(hookResult).toMatchObject({
          hookSpecificOutput: { permissionDecision: "deny" },
        });
        yield MESSAGES[1]!;
      })();

    await new ClaudeRuntime({ queryFn }).runTurn(makeReq(), { gate });
    expect(gate).toHaveBeenCalledWith({
      tool: "structuredoutput",
      input: { verdict: "approve" },
    });
  });

  it("falls back to result text when an older SDK success omits structured_output", async () => {
    const { queryFn } = scriptedQuery();

    const result = await new ClaudeRuntime({ queryFn }).runTurn(
      makeReq({ verdictSchema: VERDICT_SCHEMA }),
      { gate: defaultGate },
    );

    expect(result.summary).toBe('{"verdict":"approve"}');
  });

  it("without a schema, options carry no outputFormat at all", async () => {
    const { captured, queryFn } = scriptedQuery();

    await new ClaudeRuntime({ queryFn }).runTurn(makeReq(), { gate: defaultGate });

    expect(captured.options !== undefined && "outputFormat" in captured.options).toBe(false);
  });

  it("without a schema, a baseOptions outputFormat survives untouched", async () => {
    const { captured, queryFn } = scriptedQuery();
    const base = { type: "json_schema" as const, schema: { type: "object" } };

    await new ClaudeRuntime({ queryFn, baseOptions: { outputFormat: base } }).runTurn(makeReq(), {
      gate: defaultGate,
    });

    expect(captured.options?.outputFormat).toEqual(base);
  });
});
