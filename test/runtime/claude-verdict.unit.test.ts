// Tests ClaudeRuntime structured-output option mapping.
// Covers translating TurnRequest.verdictSchema to SDK outputFormat, omitting it
// when absent, and preserving baseOptions outputFormat when no schema is given.
// Uses mocked SDK messages only; no API key, network, real org state, or
// wall-clock time is required.

import { describe, expect, it } from "vitest";
import type { Options as SdkOptions, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeRuntime, type QueryFn } from "../../src/runtime/adapters/claude.js";
import { defaultGate } from "../../src/runtime/gate.js";
import type { RoleConfig, TurnRequest } from "../../src/runtime/types.js";

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
