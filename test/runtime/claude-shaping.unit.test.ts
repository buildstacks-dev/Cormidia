// Tests ClaudeRuntime role toolset shaping (src/runtime/role-shaping.ts):
// builder/reviewer turns carry the role's permission deny rules in the SDK's
// inline settings so forbidden acts are refused by the CLI's own permission
// layer; unshaped roles and baseOptions settings are left intact.
// Uses mocked SDK messages only; no API key, network, real org state, or
// wall-clock time is required.

import { describe, expect, it } from "vitest";
import type { Options as SdkOptions, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeRuntime, type QueryFn } from "../../src/runtime/adapters/claude.js";
import { defaultGate } from "../../src/runtime/gate.js";
import { claudeDenyRulesForRole, FORBIDDEN_BY_ROLE } from "../../src/runtime/role-shaping.js";
import type { RoleConfig, TurnRequest } from "../../src/runtime/types.js";

function role(name: string): RoleConfig {
  return {
    name,
    runtime: "claude",
    model: "claude-opus-4-8",
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: [],
    maxTurnBudgetUsd: 5,
  };
}

const MESSAGES: SDKMessage[] = [
  { type: "system", subtype: "init", session_id: "s1" } as unknown as SDKMessage,
  {
    type: "result",
    subtype: "success",
    result: "done",
    total_cost_usd: 0.1,
    duration_ms: 100,
    num_turns: 1,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    session_id: "s1",
  } as unknown as SDKMessage,
];

function makeReq(roleName: string): TurnRequest {
  return {
    role: role(roleName),
    workdir: "/wd",
    task: "do the work",
    context: { taste: [], memoryExcerpts: [] },
  };
}

function scriptedQuery() {
  const captured: { options?: SdkOptions } = {};
  const queryFn: QueryFn = ({ options }) => {
    captured.options = options;
    return (async function* () {
      for (const m of MESSAGES) yield m;
    })();
  };
  return { captured, queryFn };
}

function denyOf(options: SdkOptions | undefined): string[] {
  const settings = options?.settings;
  if (settings === undefined || typeof settings === "string") return [];
  const permissions = (settings as Record<string, unknown>)["permissions"] as
    | Record<string, unknown>
    | undefined;
  return (permissions?.["deny"] as string[] | undefined) ?? [];
}

describe("ClaudeRuntime role toolset shaping", () => {
  it("builder and reviewer turns carry every forbidden act's deny rules", async () => {
    for (const shaped of Object.keys(FORBIDDEN_BY_ROLE)) {
      const { captured, queryFn } = scriptedQuery();
      const runtime = new ClaudeRuntime({ queryFn });
      await runtime.runTurn(makeReq(shaped), { gate: defaultGate });

      const deny = denyOf(captured.options);
      expect(deny).toEqual(claudeDenyRulesForRole(shaped));
      expect(deny).toContain("Bash(gh pr merge:*)");
      expect(deny).toContain("Bash(gh pr review:*)");
      expect(deny).toContain("Write(~/.claude/**)");
      expect(deny.length).toBeGreaterThan(0);
    }
  });

  it("unshaped roles get no injected settings", async () => {
    const { captured, queryFn } = scriptedQuery();
    const runtime = new ClaudeRuntime({ queryFn });
    await runtime.runTurn(makeReq("planner"), { gate: defaultGate });

    expect(claudeDenyRulesForRole("planner")).toEqual([]);
    expect(captured.options?.settings).toBeUndefined();
  });

  it("merges role deny rules into baseOptions object settings without dropping either", async () => {
    const { captured, queryFn } = scriptedQuery();
    const runtime = new ClaudeRuntime({
      queryFn,
      baseOptions: {
        settings: { permissions: { deny: ["WebFetch"] }, model: "claude-opus-4-8" } as never,
      },
    });
    await runtime.runTurn(makeReq("builder"), { gate: defaultGate });

    const deny = denyOf(captured.options);
    expect(deny[0]).toBe("WebFetch");
    for (const rule of claudeDenyRulesForRole("builder")) expect(deny).toContain(rule);
    const settings = captured.options?.settings as Record<string, unknown>;
    expect(settings["model"]).toBe("claude-opus-4-8");
  });

  it("refuses to shape over a settings file path — loud, not silent", async () => {
    const { queryFn } = scriptedQuery();
    const runtime = new ClaudeRuntime({
      queryFn,
      baseOptions: { settings: "/path/to/settings.json" },
    });
    await expect(runtime.runTurn(makeReq("builder"), { gate: defaultGate })).rejects.toThrow(
      /cannot merge deny rules into a settings file path/,
    );
  });
});
