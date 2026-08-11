// CF-B23 + CF-C-B23 — HB-137; case-catalog.md §§4–5, boundary-map.md B-23,
// and contracts/B-23-opencode.md: scripted OpenCode boundary/contract tests.

import { afterEach, describe, expect, it } from "vitest";
import { OpencodeGatePluginInactiveError } from "../../../../src/runtime/adapters/opencode-gate-bridge.js";
import { OpencodeEffortUnsupportedError } from "../../../../src/runtime/adapters/opencode-config.js";
import {
  OpencodeModelUnavailableError,
  OpencodeSessionResumeMismatchError,
} from "../../../../src/runtime/adapters/opencode-session.js";
import { OpencodeServerIdentityError } from "../../../../src/runtime/adapters/opencode-server.js";
import { runtimeCapabilityProfile } from "../../../../src/runtime/capabilities.js";
import type { TurnEvent, TurnRequest } from "../../../../src/runtime/types.js";
import { makeTempGitRepo, type TempGitRepo } from "../../git-repo.js";
import { opencodeDouble, opencodeDoubleRequest } from "../opencode-double.js";
import { checkEveryExecutedToolConsulted, checkUsageAbsentRenderedUnknown, script } from "../scenario.js";

let repo: TempGitRepo | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
});

async function request(overrides: Omit<Partial<TurnRequest>, "workdir"> = {}): Promise<TurnRequest> {
  repo ??= await makeTempGitRepo();
  return opencodeDoubleRequest({ workdir: repo.dir, ...overrides });
}

describe("opencode adapter double — core conformance (B-23)", () => {
  it("proves the gate plugin active before prompting, classifies once, and emits pre-execution", async () => {
    const events: TurnEvent[] = [];
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_scripted_1",
        steps: [script.tool("bash", { command: "pwd" })],
        outcome: script.success("done", { usage: { inputTokens: 500, outputTokens: 50 }, costUsd: 0.2 }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(await request(), {
      gate: () => ({ allow: true }),
      onEvent: (event) => events.push(event),
    });
    expect(result).toMatchObject({ status: "completed", session: { runtime: "opencode", id: "ses_scripted_1" } });
    expect(result.summary).toBe("done");
    expect(() => checkEveryExecutedToolConsulted(dbl.recorder.turns[0]!)).not.toThrow();
    // Handshake precedes the first tool consultation: the fail-closed order.
    const sequence = dbl.recorder.turns[0]!.sequence;
    expect(sequence.indexOf("emit:session")).toBeLessThan(sequence.indexOf("consult:hook:bash"));
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_use", name: "bash" }));
    expect(events.find((event) => event.type === "tool_use")).not.toHaveProperty("success");
  });

  it("gate absence is a typed terminal refusal, and no prompt is ever sent", async () => {
    const dbl = opencodeDouble(
      [
        script.turn({
          sessionId: "ses_must_not_start",
          steps: [script.tool("bash", { command: "touch forbidden" })],
          outcome: script.success("must not run", { usage: "absent" }),
        }),
      ],
      { omitGatePlugin: true },
    );
    await expect(dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) })).rejects.toBeInstanceOf(
      OpencodeGatePluginInactiveError,
    );
    expect(dbl.recorder.turns[0]?.promptText).toBeUndefined();
    expect(dbl.recorder.turns[0]?.toolPlays).toEqual([]);
  });

  it("a plugin whose factory ran but whose hooks were never wired is refused", async () => {
    // The exact 1.18.15 loader failure certification caught: the module loads
    // and announces, the server drops its hooks, and every tool runs ungated.
    const dbl = opencodeDouble(
      [
        script.turn({
          sessionId: "ses_unwired",
          steps: [script.tool("bash", { command: "touch forbidden" })],
          outcome: script.success("must not run", { usage: "absent" }),
        }),
      ],
      { violations: ["unwired_gate_plugin"] },
    );
    const failure = await dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) }).catch((e) => e);
    expect(failure).toBeInstanceOf(OpencodeGatePluginInactiveError);
    expect(String(failure)).toMatch(/loaded but the server never invoked its hooks/);
    expect(dbl.recorder.turns[0]?.promptText).toBeUndefined();
    expect(dbl.recorder.turns[0]?.toolPlays).toEqual([]);
  });

  it("the plugin announces wiring from a server-invoked hook, not from its own factory", async () => {
    // The activation precondition is only as good as the hook that reports it.
    // `config` is the earliest callback OpenCode makes into a registered
    // plugin; `event` is the second source. Losing both would turn the
    // fail-closed precondition into a permanent false alarm — or, if someone
    // "fixed" that by trusting the factory again, into a silent fail-open.
    const { CormidiaGatePlugin } = await import("../../../../src/runtime/adapters/opencode-gate-plugin.js");
    const { startOpencodeGateBridge } = await import("../../../../src/runtime/adapters/opencode-gate-bridge.js");
    repo ??= await makeTempGitRepo();
    const bridge = await startOpencodeGateBridge(repo.dir, { gate: () => ({ allow: true }) }, []);
    const previous = process.env["CORMIDIA_OPENCODE_GATE_SOCKET"];
    process.env["CORMIDIA_OPENCODE_GATE_SOCKET"] = bridge.socketPath;
    try {
      const hooks = await CormidiaGatePlugin({ directory: repo.dir, worktree: repo.dir, serverUrl: "http://x" });
      expect(Object.keys(hooks).sort()).toEqual([
        "config",
        "event",
        "experimental.chat.system.transform",
        "tool.execute.before",
      ]);
      // The factory's own hello must NOT satisfy the precondition on its own.
      await expect(bridge.whenActive(200)).rejects.toThrow(/never invoked its hooks/);
      await (hooks["config"] as () => Promise<void>)();
      await expect(bridge.whenActive(2_000)).resolves.toMatchObject({ directory: repo.dir });
    } finally {
      if (previous === undefined) delete process.env["CORMIDIA_OPENCODE_GATE_SOCKET"];
      else process.env["CORMIDIA_OPENCODE_GATE_SOCKET"] = previous;
      await bridge.close();
    }
  });

  it("the plugin module exports only callable factories", async () => {
    // OpenCode invokes every export of a plugin module as a plugin factory. A
    // non-callable export makes the module fail to load outright; an exported
    // helper FUNCTION gets called with the plugin input and, on 1.18.15, took
    // the module's real hooks down with it. Both were observed on 2026-08-07,
    // so the module's export surface is pinned here.
    const module: Record<string, unknown> = await import("../../../../src/runtime/adapters/opencode-gate-plugin.js");
    expect(Object.keys(module).sort()).toEqual(["CormidiaGatePlugin", "default"]);
    for (const value of Object.values(module)) expect(typeof value).toBe("function");
  });

  it("a plugin announcing from a foreign pid is an identity failure, not 'some server answered'", async () => {
    const dbl = opencodeDouble(
      [
        script.turn({
          sessionId: "ses_foreign",
          steps: [script.tool("bash", { command: "touch forbidden" })],
          outcome: script.success("must not run", { usage: "absent" }),
        }),
      ],
      { violations: ["foreign_server_pid"] },
    );
    await expect(dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) })).rejects.toBeInstanceOf(
      OpencodeServerIdentityError,
    );
    expect(dbl.recorder.turns[0]?.promptText).toBeUndefined();
    expect(dbl.recorder.turns[0]?.toolPlays).toEqual([]);
  });

  it("denied tool actions never execute, escalate, and settle the turn blocked_on_gate", async () => {
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_denied",
        steps: [script.tool("bash", { command: "gh pr merge 42 --squash" })],
        outcome: script.success("recovered without the tool", {
          usage: { inputTokens: 100, outputTokens: 10 },
          costUsd: 0.01,
        }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(await request(), {
      gate: () => ({ allow: false, reason: "critical op: merge", escalate: true }),
    });
    expect(result.status).toBe("blocked_on_gate");
    expect(result.escalations).toEqual([
      { action: { tool: "bash", input: { command: "gh pr merge 42 --squash" } }, reason: "critical op: merge" },
    ]);
    expect(dbl.recorder.turns[0]!.sequence).not.toContain("execute:bash");
  });

  it("normalizes every effectful tool the 1.18.15 roster exposes, not just bash", async () => {
    const seen: string[] = [];
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_roster",
        steps: [
          script.tool("read", { filePath: "/etc/hosts" }),
          script.tool("write", { filePath: "notes.md", content: "x" }),
          script.tool("edit", { filePath: "notes.md", oldString: "x", newString: "y" }),
          script.tool("webfetch", { url: "https://example.test" }),
          script.tool("glob", { pattern: "**/*.ts" }),
          script.tool("grep", { pattern: "secret" }),
          script.tool("skill", { name: "customize-opencode" }),
          script.tool("apply_patch", { patchText: "*** Add File: added.txt\n+hello\n" }),
        ],
        outcome: script.success("ok", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
      }),
    ]);
    await dbl.runtime.runTurn(await request(), {
      gate: (action) => {
        seen.push(action.tool);
        return { allow: true };
      },
    });
    expect(seen).toEqual(["read", "write", "edit", "webfetch", "glob", "grep", "skill", "write"]);
  });

  it("a subagent's tool call reaches the gate identically and fan-out stays visible", async () => {
    const events: TurnEvent[] = [];
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_fanout",
        steps: [
          script.tool("task", { description: "helper", subagent_type: "general", prompt: "go" }),
          script.tool("bash", { command: "gh pr merge 42 --squash" }, { fromSubagent: true }),
        ],
        outcome: script.success("recovered", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(await request(), {
      gate: (action) =>
        String((action.input as Record<string, unknown>)["command"] ?? "").includes("gh pr merge")
          ? { allow: false, reason: "critical op: merge", escalate: true }
          : { allow: true },
      onEvent: (event) => events.push(event),
    });
    expect(result.status).toBe("blocked_on_gate");
    expect(result.escalations).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ type: "subagent", phase: "started", name: "general" }));
    expect(dbl.recorder.turns[0]!.sequence).not.toContain("execute:bash");
  });

  it("a resume that does not bind the exact prior session fails closed pre-spend", async () => {
    const dbl = opencodeDouble([
      script.turn({ sessionId: "ses_other", outcome: script.success("must not run", { usage: "absent" }) }),
    ]);
    await expect(
      dbl.runtime.runTurn(await request({ session: { runtime: "opencode", id: "ses_requested" } }), {
        gate: () => ({ allow: true }),
      }),
    ).rejects.toBeInstanceOf(OpencodeSessionResumeMismatchError);
    expect(dbl.recorder.turns[0]?.promptText).toBeUndefined();
  });

  it("an unpublished effort variant is refused before the provider is constructed", async () => {
    const dbl = opencodeDouble(
      [script.turn({ sessionId: "ses_effort", outcome: script.success("must not run", { usage: "absent" }) })],
      { variants: ["low", "medium"] },
    );
    await expect(dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) })).rejects.toBeInstanceOf(
      OpencodeEffortUnsupportedError,
    );
    expect(dbl.recorder.turns[0]?.promptText).toBeUndefined();
  });

  it("an id absent from the roster is a typed refusal, never a substitution", async () => {
    const dbl = opencodeDouble(
      [script.turn({ sessionId: "ses_model", outcome: script.success("must not run", { usage: "absent" }) })],
      { unknownModel: true },
    );
    await expect(dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) })).rejects.toBeInstanceOf(
      OpencodeModelUnavailableError,
    );
  });

  it("absent provider usage renders as unknown, never as an authoritative zero", async () => {
    const dbl = opencodeDouble([
      script.turn({ sessionId: "ses_unknown", outcome: script.success("no usage", { usage: "absent" }) }),
    ]);
    const result = await dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    expect(() => checkUsageAbsentRenderedUnknown(dbl.recorder.turns[0]!, result)).not.toThrow();
    expect(result.usage.quality).toBe("unavailable");
  });

  it("catalog-derived dollars are flagged, and the cache split is reported as the server sends it", async () => {
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_usage",
        outcome: script.success("ok", {
          usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheCreationTokens: 10 },
          costUsd: 0.12,
        }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    expect(result.usage).toMatchObject({
      tokensIn: 150,
      tokensInUncached: 100,
      cacheReadTokens: 40,
      cacheCreationTokens: 10,
      tokensOut: 20,
      costUsd: 0.12,
      costEstimated: true,
      quality: "complete",
    });
  });

  it("tokens without dollars is an incomplete snapshot, never an authoritative complete one", async () => {
    // The OAuth/subscription tier prices this model at zero in the models.dev
    // catalog, so a real turn returns real tokens and $0. Calling that
    // `complete` would read as "measured, and it cost nothing".
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_free",
        outcome: script.success("ok", { usage: { inputTokens: 400, outputTokens: 20 }, costUsd: 0 }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    expect(result.status).toBe("completed");
    expect(result.usage).toMatchObject({ tokensIn: 400, tokensOut: 20, costUsd: 0, quality: "partial" });
  });

  it("a terminal provider failure is preserved as evidence with its usage, never a completion", async () => {
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_fail",
        outcome: script.failure("error_during_execution", ["ProviderAuthError: token expired"], {
          usage: { inputTokens: 40, outputTokens: 2 },
          costUsd: 0.004,
        }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    expect(result).toMatchObject({ status: "failed", errorCode: "error_auth" });
    expect(result.usage.tokensIn).toBe(40);
    expect(result.usage.quality).toBe("partial");
  });

  it("a dropped response is execution ambiguity with the usage already observed", async () => {
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_drop",
        steps: [script.usageUpdate({ inputTokens: 300, outputTokens: 20 })],
        outcome: script.streamDrop("socket hang up"),
      }),
    ]);
    const result = await dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    expect(result).toMatchObject({ status: "failed", errorCode: "error_transport" });
    expect(result.usage.tokensIn).toBe(300);
    expect(result.usage.quality).toBe("partial");
  });

  it("a stream that ends with no assistant message is malformed output, not a completion", async () => {
    const dbl = opencodeDouble([script.turn({ sessionId: "ses_noresult", outcome: script.noResult() })]);
    const result = await dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    expect(result).toMatchObject({ status: "failed", errorCode: "error_malformed_output" });
  });

  it("never requests the native json_schema format, and passes prose through instead", async () => {
    // `structured_verdict: fallback` is a certified tier, not an oversight:
    // requesting the server's native format put a real turn into a retry loop
    // that ran past five minutes and returned no assistant message
    // (research/2026-08-07_opencode-adapter-certification.md). If someone
    // re-enables it, this case fails and the capability profile must move too.
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_schema",
        outcome: script.success("verdict prose the loop parses leniently", {
          usage: { inputTokens: 10, outputTokens: 2 },
          costUsd: 0.01,
        }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(
      await request({ verdictSchema: { type: "object", properties: { verdict: { type: "string" } } } }),
      { gate: () => ({ allow: true }) },
    );
    expect(dbl.recorder.turns[0]!.requestedFormat).toBeUndefined();
    expect(result.summary).toBe("verdict prose the loop parses leniently");
    expect(runtimeCapabilityProfile("opencode").capabilities.structured_verdict).toBe("fallback");
  });

  it("renders a structured value the server volunteers, without ever asking for one", async () => {
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_volunteered",
        outcome: script.success("prose that must not win", {
          usage: { inputTokens: 10, outputTokens: 2 },
          costUsd: 0.01,
          structuredOutput: { verdict: "approve", reasons: ["clean"] },
        }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    expect(result.summary).toBe(JSON.stringify({ verdict: "approve", reasons: ["clean"] }));
  });

  it("shaping config is deny-by-default and never uses ask", async () => {
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_shape",
        outcome: script.success("ok", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
      }),
    ]);
    await dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    const config = dbl.recorder.turns[0]!.inlineConfig!;
    const permission = config["permission"] as Record<string, unknown>;
    expect(permission["*"]).toBe("deny");
    expect(permission["webfetch"]).toBe("deny");
    expect(permission["external_directory"]).toBe("deny");
    expect(JSON.stringify(permission)).not.toContain('"ask"');
    expect(config["share"]).toBe("disabled");
    expect(config["mcp"]).toEqual({});
    expect((config["plugin"] as string[])[0]).toMatch(/opencode-gate-plugin\.(ts|js)$/);
  });

  it("negative control: a transport that bypasses the gate makes the shared detector FIRE", async () => {
    const dbl = opencodeDouble(
      [
        script.turn({
          sessionId: "ses_bypass",
          steps: [script.tool("bash", { command: "gh pr merge 42 --squash" })],
          outcome: script.success("looks clean", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
        }),
      ],
      { violations: ["bypass_gate"] },
    );
    const seen: string[] = [];
    const result = await dbl.runtime.runTurn(await request(), {
      gate: (action) => {
        seen.push(action.tool);
        return { allow: false, reason: "critical op: merge", escalate: true };
      },
    });
    expect(seen).toEqual([]);
    expect(result.status).toBe("completed");
    expect(() => checkEveryExecutedToolConsulted(dbl.recorder.turns[0]!)).toThrow(/ungated/);
  });

  it("negative control: a transport whose hook dies inside subagents makes the detector FIRE", async () => {
    const dbl = opencodeDouble(
      [
        script.turn({
          sessionId: "ses_subbypass",
          steps: [
            script.tool("bash", { command: "echo main-ok" }),
            script.tool("bash", { command: "gh pr merge 42 --squash" }, { fromSubagent: true }),
          ],
          outcome: script.success("looks clean", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
        }),
      ],
      { violations: ["bypass_subagent_gate"] },
    );
    const seen: string[] = [];
    const result = await dbl.runtime.runTurn(await request(), {
      gate: (action) => {
        seen.push(String((action.input as Record<string, unknown>)["command"]));
        return { allow: true };
      },
    });
    expect(seen).toEqual(["echo main-ok"]);
    expect(result.escalations).toEqual([]);
    expect(() => checkEveryExecutedToolConsulted(dbl.recorder.turns[0]!)).toThrow(/ungated/);
  });
});

describe("opencode server identity", () => {
  it("refuses a gate plugin announcing from a pid this turn never spawned", async () => {
    // The identity error is raised by the adapter itself; construct it directly
    // so the message contract stays pinned even when no transport is involved.
    const error = new OpencodeServerIdentityError(111, 222, "http://127.0.0.1:1");
    expect(error.code).toBe("error_adapter_server_identity");
    expect(error.message).toContain("refusing to drive a foreign or stale opencode server");
  });
});
