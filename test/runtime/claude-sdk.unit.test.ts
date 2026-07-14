// Tests the Claude runtime adapter with the Claude SDK mocked.
// Covers SDK option mapping, hermetic settings, gate hooks/canUseTool, subagent
// event ordering, system context assembly, resume handling, result/usage mapping,
// large task transport, normalization helpers, and base-option precedence.
// Uses injectable QueryFn messages only; no API key, CLI, network, real org
// state, or wall-clock time is required.

import { describe, expect, it } from "vitest";
import type { Options as SdkOptions, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  buildSystemPromptAppend,
  ClaudeRuntime,
  normalizeToolAction,
  type QueryFn,
} from "../../src/runtime/adapters/claude.js";
import { defaultGate } from "../../src/runtime/gate.js";
import type { RoleConfig, ToolAction, TurnEvent, TurnRequest } from "../../src/runtime/types.js";

const USAGE = {
  input_tokens: 100,
  output_tokens: 40,
  cache_creation_input_tokens: 10,
  cache_read_input_tokens: 5,
};

const initMsg = (sid: string): SDKMessage =>
  ({ type: "system", subtype: "init", session_id: sid }) as unknown as SDKMessage;

const successMsg = (sid: string, text = "done"): SDKMessage =>
  ({
    type: "result",
    subtype: "success",
    result: text,
    total_cost_usd: 0.12,
    duration_ms: 1234,
    num_turns: 1,
    usage: USAGE,
    session_id: sid,
  }) as unknown as SDKMessage;

const errorMsg = (sid: string): SDKMessage =>
  ({
    type: "result",
    subtype: "error_max_turns",
    errors: ["hit max turns"],
    total_cost_usd: 0.05,
    duration_ms: 50,
    num_turns: 9,
    usage: USAGE,
    session_id: sid,
  }) as unknown as SDKMessage;

const taskStartedMsg = (): SDKMessage =>
  ({
    type: "system",
    subtype: "task_started",
    task_id: "t1",
    description: "gate probe",
    subagent_type: "gate-probe",
  }) as unknown as SDKMessage;

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

function makeReq(over: Partial<TurnRequest> = {}): TurnRequest {
  return {
    role: ROLE,
    workdir: "/wd",
    task: "do the thing",
    context: {
      taste: ["ORG-TASTE-LAYER", "ROLE-ADDENDUM-LAYER", "APP-OVERRIDE-LAYER"],
      memoryExcerpts: ["MEMORY-EXCERPT-1"],
    },
    ...over,
  };
}

const CAN_USE_CTX = { signal: new AbortController().signal };

/** QueryFn that captures {prompt, options} and yields the given messages. */
function scriptedQuery(messages: SDKMessage[]) {
  const captured: { prompt?: string; options?: SdkOptions } = {};
  const queryFn: QueryFn = ({ prompt, options }) => {
    captured.prompt = prompt;
    captured.options = options;
    return (async function* () {
      for (const m of messages) yield m;
    })();
  };
  return { captured, queryFn };
}

describe("ClaudeRuntime (SDK mocked)", () => {
  it("maps TurnRequest onto SDK options: model, effort, cwd, hermetic settings", async () => {
    const { captured, queryFn } = scriptedQuery([initMsg("s1"), successMsg("s1")]);
    const rt = new ClaudeRuntime({ queryFn });

    await rt.runTurn(makeReq(), { gate: defaultGate });

    expect(captured.options?.model).toBe("claude-opus-4-8");
    expect(captured.options?.effort).toBe("xhigh");
    expect(captured.options?.cwd).toBe("/wd");
    // Hermetic turn: no operator settings, no filesystem permission rules
    // that could pre-approve a tool around the gate.
    expect(captured.options?.settingSources).toEqual([]);
    expect(captured.options?.canUseTool).toBeTypeOf("function");
    expect(captured.options?.hooks?.PreToolUse?.[0]?.hooks?.[0]).toBeTypeOf("function");
  });

  it("maps TurnRequest.maxTurns to the SDK option", async () => {
    const { captured, queryFn } = scriptedQuery([initMsg("s1"), successMsg("s1")]);
    await new ClaudeRuntime({ queryFn }).runTurn(makeReq({ maxTurns: 7 }), {
      gate: defaultGate,
    });
    expect(captured.options?.maxTurns).toBe(7);
  });

  it("protects a macOS auth HOME from model tools while re-allowing the worktree", async () => {
    const { captured, queryFn } = scriptedQuery([initMsg("s1"), successMsg("s1")]);
    const rt = new ClaudeRuntime({
      queryFn,
      protectedHome: "/Users/example",
      baseOptions: {
        env: { HOME: "/Users/example", PATH: "/usr/bin" },
        persistSession: false,
        skills: [],
        plugins: [],
      },
    });

    await rt.runTurn(makeReq(), { gate: defaultGate });

    expect(captured.options?.env?.HOME).toBe("/Users/example");
    expect(captured.options?.persistSession).toBe(false);
    expect(captured.options?.skills).toEqual([]);
    expect(captured.options?.plugins).toEqual([]);
    expect(captured.options?.settings).toMatchObject({
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
        filesystem: {
          denyRead: ["/Users/example"],
          allowRead: ["/wd"],
          allowWrite: ["/wd"],
        },
      },
    });
    expect(
      (captured.options?.settings as { sandbox?: { filesystem?: { denyWrite?: string[] } } })
        .sandbox?.filesystem?.denyWrite,
    ).toBeUndefined();
  });

  it("PreToolUse hook is the primary gate channel: deny carries the rule, escalation recorded", async () => {
    const gateCalls: ToolAction[] = [];
    const queryFn: QueryFn = ({ options }) =>
      (async function* () {
        yield initMsg("s1");
        const hook = options!.hooks!.PreToolUse![0]!.hooks[0]!;
        const out = await hook(
          {
            hook_event_name: "PreToolUse",
            tool_name: "Bash",
            tool_input: { command: "cat .env", description: "read env" },
            tool_use_id: "tu-1",
            session_id: "s1",
            transcript_path: "",
            cwd: "/wd",
          } as Parameters<typeof hook>[0],
          "tu-1",
          { signal: CAN_USE_CTX.signal },
        );
        expect(out.hookSpecificOutput).toMatchObject({
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        });
        expect(
          (out.hookSpecificOutput as { permissionDecisionReason?: string })
            .permissionDecisionReason,
        ).toContain("secrets-or-auth");
        yield successMsg("s1");
      })();

    const result = await new ClaudeRuntime({ queryFn }).runTurn(makeReq(), {
      gate: (a) => {
        gateCalls.push(a);
        return defaultGate(a);
      },
    });

    expect(gateCalls).toEqual([{ tool: "bash", input: { command: "cat .env" } }]);
    expect(result.escalations).toHaveLength(1);
  });

  it("emits tool_use for a gate-allowed action, none for a denied one (issue #27)", async () => {
    const events: TurnEvent[] = [];
    const queryFn: QueryFn = ({ options }) =>
      (async function* () {
        yield initMsg("s1");
        const hook = options!.hooks!.PreToolUse![0]!.hooks[0]!;
        const invoke = (id: string, command: string) =>
          hook(
            {
              hook_event_name: "PreToolUse",
              tool_name: "Bash",
              tool_input: { command },
              tool_use_id: id,
              session_id: "s1",
              transcript_path: "",
              cwd: "/wd",
            } as Parameters<typeof hook>[0],
            id,
            { signal: CAN_USE_CTX.signal },
          );
        await invoke("tu-1", "pnpm install");
        await invoke("tu-2", "cat .env"); // denied: secrets-or-auth
        yield successMsg("s1");
      })();

    await new ClaudeRuntime({ queryFn }).runTurn(makeReq(), {
      gate: defaultGate,
      onEvent: (event) => events.push(event),
    });

    const toolUses = events.filter((event) => event.type === "tool_use");
    expect(toolUses).toEqual([
      expect.objectContaining({
        name: "bash",
        detail: "bash: pnpm install",
        category: "environment_retry",
        args: { command: "pnpm install" },
      }),
    ]);
  });

  it("PreToolUse hook allows subagent spawns without consulting the gate", async () => {
    const gateCalls: ToolAction[] = [];
    const queryFn: QueryFn = ({ options }) =>
      (async function* () {
        yield initMsg("s1");
        const hook = options!.hooks!.PreToolUse![0]!.hooks[0]!;
        const out = await hook(
          {
            hook_event_name: "PreToolUse",
            tool_name: "Agent",
            tool_input: { description: "probe", prompt: "..." },
            tool_use_id: "tu-2",
            session_id: "s1",
            transcript_path: "",
            cwd: "/wd",
          } as Parameters<typeof hook>[0],
          "tu-2",
          { signal: CAN_USE_CTX.signal },
        );
        expect(out.hookSpecificOutput).toMatchObject({ permissionDecision: "allow" });
        yield successMsg("s1");
      })();

    await new ClaudeRuntime({ queryFn }).runTurn(makeReq(), {
      gate: (a) => {
        gateCalls.push(a);
        return defaultGate(a);
      },
    });

    expect(gateCalls).toEqual([]);
  });

  it("system prompt contains taste layers in order, memory excerpts after", async () => {
    const { captured, queryFn } = scriptedQuery([initMsg("s1"), successMsg("s1")]);
    const rt = new ClaudeRuntime({ queryFn });

    await rt.runTurn(makeReq(), { gate: defaultGate });

    const sp = captured.options?.systemPrompt;
    expect(sp).toMatchObject({ type: "preset", preset: "claude_code" });
    const append = (sp as { append?: string }).append ?? "";
    const positions = [
      "ORG-TASTE-LAYER",
      "ROLE-ADDENDUM-LAYER",
      "APP-OVERRIDE-LAYER",
      "MEMORY-EXCERPT-1",
    ].map((layer) => append.indexOf(layer));
    expect(positions.every((p) => p >= 0), `all layers present in: ${append}`).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("resume option set from session.id; absent for a fresh session", async () => {
    const resumed = scriptedQuery([initMsg("sess-42"), successMsg("sess-42")]);
    await new ClaudeRuntime({ queryFn: resumed.queryFn }).runTurn(
      makeReq({ session: { runtime: "claude", id: "sess-42" } }),
      { gate: defaultGate },
    );
    expect(resumed.captured.options?.resume).toBe("sess-42");

    const fresh = scriptedQuery([initMsg("s-new"), successMsg("s-new")]);
    const result = await new ClaudeRuntime({ queryFn: fresh.queryFn }).runTurn(makeReq(), {
      gate: defaultGate,
    });
    expect(fresh.captured.options?.resume).toBeUndefined();
    expect(result.session).toEqual({ runtime: "claude", id: "s-new" });
  });

  it("throws on a cross-runtime session handle", async () => {
    const { queryFn } = scriptedQuery([]);
    const rt = new ClaudeRuntime({ queryFn });
    await expect(
      rt.runTurn(makeReq({ session: { runtime: "codex", id: "thread-1" } }), {
        gate: defaultGate,
      }),
    ).rejects.toThrow(/cross-runtime resume/);
  });

  it("canUseTool routes through hooks.gate: denial escalates and denies the SDK call", async () => {
    const gateCalls: ToolAction[] = [];
    const queryFn: QueryFn = ({ options }) =>
      (async function* () {
        yield initMsg("s1");
        const decision = await options!.canUseTool!("Bash", { command: "cat .env" }, CAN_USE_CTX);
        expect(decision.behavior).toBe("deny");
        expect((decision as { message: string }).message).toContain("secrets-or-auth");
        yield successMsg("s1");
      })();

    const result = await new ClaudeRuntime({ queryFn }).runTurn(makeReq(), {
      gate: (a) => {
        gateCalls.push(a);
        return defaultGate(a);
      },
    });

    expect(gateCalls).toEqual([{ tool: "bash", input: { command: "cat .env" } }]);
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0]?.action).toEqual({
      tool: "bash",
      input: { command: "cat .env" },
    });
  });

  it("canUseTool allow path echoes updatedInput and records no escalation", async () => {
    const queryFn: QueryFn = ({ options }) =>
      (async function* () {
        yield initMsg("s1");
        const decision = await options!.canUseTool!("Bash", { command: "pnpm test" }, CAN_USE_CTX);
        expect(decision).toMatchObject({
          behavior: "allow",
          updatedInput: { command: "pnpm test" },
        });
        yield successMsg("s1");
      })();

    const result = await new ClaudeRuntime({ queryFn }).runTurn(makeReq(), { gate: defaultGate });
    expect(result.escalations).toHaveLength(0);
    expect(result.status).toBe("completed");
  });

  it("subagent spawn bypasses the gate; the subagent event precedes its gated action", async () => {
    const order: string[] = [];
    const queryFn: QueryFn = ({ options }) =>
      (async function* () {
        yield initMsg("s1");
        const hook = options!.hooks!.PreToolUse![0]!.hooks[0]!;
        const mkInput = (tool_name: string, tool_input: unknown) =>
          ({
            hook_event_name: "PreToolUse",
            tool_name,
            tool_input,
            tool_use_id: "tu",
            session_id: "s1",
            transcript_path: "",
            cwd: "/wd",
          }) as Parameters<typeof hook>[0];
        // Live-observed SDK order: the spawn hits the hook (allowed, ungated),
        // task_started lands on the stream, then the subagent's own tool call
        // hits the same hook — now with agent_id set.
        await hook(mkInput("Agent", { description: "gate probe" }), "tu", CAN_USE_CTX);
        yield taskStartedMsg();
        await hook(
          mkInput("Bash", { command: "rm -rf /workspace/data" }),
          "tu",
          CAN_USE_CTX,
        );
        yield successMsg("s1");
      })();

    const result = await new ClaudeRuntime({ queryFn }).runTurn(makeReq(), {
      gate: (a) => {
        order.push(`gate:${a.tool}`);
        return defaultGate(a);
      },
      onEvent: (e) => {
        order.push(`event:${e.type}`);
      },
    });

    // The spawn itself never reaches the gate; the subagent's action does,
    // after the subagent event — exactly FakeRuntime's model.
    expect(order).toEqual(["event:subagent", "gate:bash"]);
    expect(result.usage.subagentTurns).toBe(1);
    expect(result.escalations).toHaveLength(1);
  });

  it("accepts a 300KB task without truncation", async () => {
    const bigTask = "x".repeat(300 * 1024 + 1);
    const { captured, queryFn } = scriptedQuery([initMsg("s1"), successMsg("s1")]);

    await new ClaudeRuntime({ queryFn }).runTurn(makeReq({ task: bigTask }), {
      gate: defaultGate,
    });

    expect(captured.prompt?.length).toBe(300 * 1024 + 1);
  });

  it("maps the result message onto TurnUsage and the session handle", async () => {
    const { queryFn } = scriptedQuery([initMsg("s1"), successMsg("s1", "all green")]);
    const result = await new ClaudeRuntime({ queryFn }).runTurn(makeReq(), { gate: defaultGate });

    expect(result.status).toBe("completed");
    expect(result.summary).toBe("all green");
    expect(result.session).toEqual({ runtime: "claude", id: "s1" });
    expect(result.usage).toEqual({
      tokensIn: 115, // input + cache_creation + cache_read
      tokensInUncached: 100,
      cacheCreationTokens: 10,
      cacheReadTokens: 5,
      tokensOut: 40,
      costUsd: 0.12,
      subagentTurns: 0,
      wallClockMs: 1234,
      quality: "complete",
    });
  });

  it("aborts the SDK query and preserves checkpointed partial usage", async () => {
    const controller = new AbortController();
    const progress: Array<{ usage?: { tokensIn: number; quality?: string } }> = [];
    const queryFn: QueryFn = () =>
      (async function* () {
        yield initMsg("s-cancelled");
        yield {
          type: "assistant",
          session_id: "s-cancelled",
          message: { usage: USAGE, content: [] },
        } as unknown as SDKMessage;
        controller.abort({
          status: "cancelled",
          errorCode: "error_cancelled",
          reason: "operator SIGTERM",
        });
        throw new Error("SDK aborted");
      })();

    const result = await new ClaudeRuntime({ queryFn }).runTurn(
      makeReq({ signal: controller.signal }),
      { gate: defaultGate, onProgress: (event) => progress.push(event) },
    );

    expect(result).toMatchObject({
      status: "cancelled",
      errorCode: "error_cancelled",
      summary: "operator SIGTERM",
      session: { runtime: "claude", id: "s-cancelled" },
      usage: { tokensIn: 115, tokensOut: 40, quality: "partial" },
    });
    expect(progress.some((event) => event.usage?.quality === "partial")).toBe(true);
  });

  it("error results map to failed status with the subtype in the summary", async () => {
    const { queryFn } = scriptedQuery([initMsg("s1"), errorMsg("s1")]);
    const result = await new ClaudeRuntime({ queryFn }).runTurn(makeReq(), { gate: defaultGate });

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("error_max_turns");
    expect(result.summary).toContain("hit max turns");
  });

  it("baseOptions merge under adapter-computed options", async () => {
    const { captured, queryFn } = scriptedQuery([initMsg("s1"), successMsg("s1")]);
    const rt = new ClaudeRuntime({
      queryFn,
      baseOptions: { maxTurns: 6, model: "must-not-win", settingSources: ["user"] },
    });

    await rt.runTurn(makeReq(), { gate: defaultGate });

    expect(captured.options?.maxTurns).toBe(6); // pass-through knob survives
    expect(captured.options?.model).toBe("claude-opus-4-8"); // adapter wins
    expect(captured.options?.settingSources).toEqual([]); // hermeticity wins
  });
});

describe("normalizeToolAction", () => {
  it("drops Bash advisory fields and keeps only the command", () => {
    expect(
      normalizeToolAction("Bash", { command: "pnpm test", description: "Run tests" }, "/wd"),
    ).toEqual({ tool: "bash", input: { command: "pnpm test" } });
  });

  it("relativizes absolute paths under the workdir; keeps others as-is", () => {
    expect(
      normalizeToolAction("Write", { file_path: "/wd/roles.yaml", content: "..." }, "/wd"),
    ).toEqual({ tool: "write", input: { path: "roles.yaml", content: "..." } });
    expect(normalizeToolAction("Read", { file_path: "/etc/hosts" }, "/wd")).toEqual({
      tool: "read",
      input: { path: "/etc/hosts" },
    });
  });
});

describe("buildSystemPromptAppend", () => {
  it("omits the memory section when there are no excerpts", () => {
    const append = buildSystemPromptAppend(
      makeReq({ context: { taste: ["ONLY-TASTE"], memoryExcerpts: [] } }),
    );
    expect(append).toContain("ONLY-TASTE");
    expect(append).not.toContain("Memory excerpts");
  });
});
