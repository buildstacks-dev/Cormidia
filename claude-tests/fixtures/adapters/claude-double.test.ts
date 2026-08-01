// CF-C-CORE + CF-B02 — contract-clause tests for the scripted Anthropic
// adapter double (HB-004; validation-design/contracts/provider-adapter-core.md,
// contracts/B-02-anthropic.md, boundary-map.md B-02, case-catalog.md §4/§5).
//
// The double plays scripted provider behavior through the REAL ClaudeRuntime
// (queryFn seam), so every clause asserted here is asserted against product
// code, and the same suite shape is the drift-guard base for the CF-B02-L3
// live conformance run (HB-051). Zero network, zero tokens, zero FS writes.

import { describe, expect, it } from "vitest";
import { ClaudeSessionResumeMismatchError } from "../../../src/runtime/adapters/claude.js";
import type {
  GateFn,
  ToolAction,
  TurnEvent,
  TurnHooks,
  TurnProgress,
} from "../../../src/runtime/types.js";
import {
  claudeDouble,
  doubleRole,
  doubleTurnRequest,
  type ClaudeDouble,
  type ClaudeRecordedTurn,
} from "./claude-double.js";
import {
  AdapterContractViolation,
  RESUME_MISMATCH_ERROR_CODE,
  checkEveryExecutedToolConsulted,
  checkSessionIdentityHonest,
  checkUsageAbsentRenderedUnknown,
  isTypedResumeMismatchError,
  script,
} from "./scenario.js";

const WORKDIR = "/scripted/workdir";

interface RecordedHooks {
  hooks: TurnHooks;
  gateActions: ToolAction[];
  events: TurnEvent[];
  progress: TurnProgress[];
}

function recordingHooks(gateImpl?: GateFn): RecordedHooks {
  const gateActions: ToolAction[] = [];
  const events: TurnEvent[] = [];
  const progress: TurnProgress[] = [];
  const gate: GateFn = (action) => {
    gateActions.push(action);
    return gateImpl !== undefined ? gateImpl(action) : { allow: true };
  };
  return {
    hooks: {
      gate,
      onEvent: (event) => events.push(event),
      onProgress: (snapshot) => progress.push(snapshot),
    },
    gateActions,
    events,
    progress,
  };
}

function onlyTurn(dbl: ClaudeDouble): ClaudeRecordedTurn {
  expect(dbl.recorder.turns).toHaveLength(1);
  const turn = dbl.recorder.turns[0];
  if (turn === undefined) throw new Error("unreachable: length asserted above");
  return turn;
}

describe("claude-double fixture self-test", () => {
  it("over-calling the scripted double throws instead of reusing a script", async () => {
    const dbl = claudeDouble([]);
    const { hooks } = recordingHooks();
    await expect(
      dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks),
    ).rejects.toThrow(/over-called/);
  });

  it("scenario builder refuses an empty session id", () => {
    expect(() =>
      script.turn({ sessionId: "", outcome: script.success("x", { usage: "absent" }) }),
    ).toThrow(/non-empty/);
  });

  it("scripted latencies play and the scripted provider wall-clock lands in the envelope", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-lat",
        steps: [script.tool("Bash", { command: "echo slow" }, { delayMs: 5 })],
        outcome: script.success("ok", {
          usage: { inputTokens: 5, outputTokens: 1 },
          durationMs: 4321,
        }),
      }),
    ]);
    const { hooks } = recordingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks);
    expect(result.status).toBe("completed");
    expect(result.usage.wallClockMs).toBe(4321);
  });
});

describe("CF-C-CORE — OPERON-C-CORE-001 clauses against the scripted Anthropic adapter", () => {
  it("§1 threads the atomic tuple, workdir, budget cap, resume, maxTurns, and a multi-hundred-KB brief into provider construction unchanged (hermetic settingSources)", async () => {
    const bigBrief = "B".repeat(300_000); // briefs transport intact — no ARG_MAX-style loss
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-1",
        outcome: script.success("done", { usage: { inputTokens: 10, outputTokens: 2 } }),
      }),
    ]);
    const { hooks } = recordingHooks();
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({
        workdir: WORKDIR,
        task: bigBrief,
        session: { runtime: "claude", id: "sess-1" },
        maxTurns: 7,
        context: { taste: ["## ORG TASTE MARKER"], memoryExcerpts: [] },
      }),
      hooks,
    );
    const turn = onlyTurn(dbl);
    expect(turn.prompt).toBe(bigBrief);
    expect(turn.prompt.length).toBe(300_000);
    expect(turn.options.model).toBe("claude-scripted-model");
    expect(turn.options.effort).toBe("high");
    expect(turn.options.cwd).toBe(WORKDIR);
    expect(turn.options.maxBudgetUsd).toBe(5);
    expect(turn.options.resume).toBe("sess-1");
    expect(turn.options.maxTurns).toBe(7);
    expect(turn.options.settingSources).toEqual([]); // operator settings never leak in
    expect(turn.options.systemPromptAppend).toContain("ORG TASTE MARKER");
    expect(turn.options.permissionDenyRules).toEqual([]); // planner: no shaping
    expect(result.session).toEqual({ runtime: "claude", id: "sess-1" });
  });

  it("§1 typed refusal before provider construction: harness mismatch (fail closed pre-spend)", async () => {
    const dbl = claudeDouble([
      script.turn({ sessionId: "s", outcome: script.success("x", { usage: "absent" }) }),
    ]);
    const { hooks } = recordingHooks();
    await expect(
      dbl.runtime.runTurn(
        doubleTurnRequest({
          workdir: WORKDIR,
          assignment: { harness: "codex", model: "some-model", effort: "high" },
        }),
        hooks,
      ),
    ).rejects.toThrow(/does not match/);
    expect(dbl.recorder.turns).toHaveLength(0); // never constructed the provider
  });

  it("§1 typed refusal before provider construction: malformed model id", async () => {
    const dbl = claudeDouble([
      script.turn({ sessionId: "s", outcome: script.success("x", { usage: "absent" }) }),
    ]);
    const { hooks } = recordingHooks();
    await expect(
      dbl.runtime.runTurn(
        doubleTurnRequest({
          workdir: WORKDIR,
          assignment: { harness: "claude", model: " padded ", effort: "high" },
        }),
        hooks,
      ),
    ).rejects.toThrow(/model/);
    expect(dbl.recorder.turns).toHaveLength(0);
  });

  it("§1 typed refusal before provider construction: cross-runtime session resume", async () => {
    const dbl = claudeDouble([
      script.turn({ sessionId: "s", outcome: script.success("x", { usage: "absent" }) }),
    ]);
    const { hooks } = recordingHooks();
    await expect(
      dbl.runtime.runTurn(
        doubleTurnRequest({
          workdir: WORKDIR,
          session: { runtime: "codex", id: "thread-9" },
        }),
        hooks,
      ),
    ).rejects.toThrow(/cross-runtime/);
    expect(dbl.recorder.turns).toHaveLength(0);
  });

  it("§2 success envelope: terminal status, ids, timings, complete usage mapping", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-ok",
        outcome: script.success("done", {
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            cacheCreationTokens: 30,
            cacheReadTokens: 400,
          },
          costUsd: 0.42,
          durationMs: 5000,
        }),
      }),
    ]);
    const { hooks } = recordingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks);
    expect(result.status).toBe("completed");
    expect(result.errorCode).toBeUndefined();
    expect(result.summary).toBe("done");
    expect(result.session).toEqual({ runtime: "claude", id: "sess-ok" });
    expect(result.escalations).toEqual([]);
    expect(result.usage).toEqual({
      tokensIn: 530, // uncached + cache creation + cache read
      tokensInUncached: 100,
      cacheCreationTokens: 30,
      cacheReadTokens: 400,
      tokensOut: 20,
      costUsd: 0.42,
      subagentTurns: 0,
      wallClockMs: 5000,
      quality: "complete",
    });
  });

  it("§2 zero-token terminal usage with positive cost renders quality partial, never complete", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-p",
        outcome: script.success("ok", {
          usage: { inputTokens: 0, outputTokens: 0 },
          costUsd: 0.05,
        }),
      }),
    ]);
    const { hooks } = recordingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks);
    expect(result.usage.quality).toBe("partial");
    expect(result.usage.costUsd).toBe(0.05);
  });

  it("§2 INV-006 seed: a turn whose provider never reported usage surfaces UNKNOWN (quality unavailable), never zero", async () => {
    const controller = new AbortController();
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-c",
        steps: [script.tool("Bash", { command: "echo pre-usage" })],
        outcome: script.success("never delivered", {
          usage: { inputTokens: 999, outputTokens: 99 },
        }),
      }),
    ]);
    // The orchestrator cancels at the first gate consultation — before the
    // provider ever streamed a usage checkpoint.
    const { hooks } = recordingHooks(() => {
      controller.abort();
      return { allow: true };
    });
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: WORKDIR, signal: controller.signal }),
      hooks,
    );
    const turn = onlyTurn(dbl);
    expect(result.status).toBe("cancelled");
    expect(turn.usageReported).toBe(false);
    expect(result.usage.quality).toBe("unavailable"); // unknown ≠ zero
    expect(result.usage.tokensIn).toBe(0);
    expect(result.usage.costUsd).toBe(0);
    expect(() => checkUsageAbsentRenderedUnknown(turn, result)).not.toThrow();
  });

  it("negative control: a zero-rendering adapter variant is caught by the INV-006 usage detector", async () => {
    const controller = new AbortController();
    const dbl = claudeDouble(
      [
        script.turn({
          sessionId: "sess-c",
          steps: [script.tool("Bash", { command: "echo pre-usage" })],
          outcome: script.success("never delivered", {
            usage: { inputTokens: 999, outputTokens: 99 },
          }),
        }),
      ],
      { violations: ["fabricate_zero_usage"] },
    );
    const { hooks } = recordingHooks(() => {
      controller.abort();
      return { allow: true };
    });
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: WORKDIR, signal: controller.signal }),
      hooks,
    );
    const turn = onlyTurn(dbl);
    expect(result.usage.quality).toBe("complete"); // the seeded lie
    expect(() => checkUsageAbsentRenderedUnknown(turn, result)).toThrow(AdapterContractViolation);
    expect(() => checkUsageAbsentRenderedUnknown(turn, result)).toThrow(/unavailable/);
  });

  it("§2/§3 usage-block-absent terminal result yields the typed unknown-usage outcome — never a TypeError, never fabricated numbers (promoted, HB-024)", async () => {
    // A terminal result with NO usage block at all. The adapter settles the
    // turn with the typed unknown-usage snapshot (INV-006 unknown ≠ zero):
    // quality "unavailable", zero figures as the unknown marker, terminal
    // status still honest per the provider subtype.
    const dbl = claudeDouble([
      script.turn({ sessionId: "sess-na", outcome: script.success("done", { usage: "absent" }) }),
    ]);
    const { hooks } = recordingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks);
    const turn = onlyTurn(dbl);
    expect(turn.resultDelivered).toBe(true); // the provider DID answer — without usage
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("done");
    expect(result.usage.quality).toBe("unavailable");
    expect(result.usage.tokensIn).toBe(0);
    expect(result.usage.tokensOut).toBe(0);
    expect(result.usage.costUsd).toBe(0);
    expect(() => checkUsageAbsentRenderedUnknown(turn, result)).not.toThrow();
  });

  it("§2/§3 usage-block-absent terminal result after a mid-turn checkpoint retains the checkpoint as partial — evidence is never zeroed", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-nap",
        steps: [script.usageUpdate({ inputTokens: 120, outputTokens: 8 })],
        outcome: script.failure("error_during_execution", ["boom"], { usage: "absent" }),
      }),
    ]);
    const { hooks } = recordingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks);
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("error_during_execution");
    expect(result.usage.tokensIn).toBe(120); // whatever usage is known…
    expect(result.usage.tokensOut).toBe(8);
    expect(result.usage.quality).toBe("partial"); // …marked incomplete, never complete, never zeroed
  });

  it("§2 agent prose passes through verbatim (trimmed); malformed verdict text is never interpreted", async () => {
    const malformed = "  VERDICT {not-json  \n";
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-v",
        outcome: script.success(malformed, { usage: { inputTokens: 10, outputTokens: 2 } }),
      }),
    ]);
    const { hooks } = recordingHooks();
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: WORKDIR, verdictSchema: { type: "object" } }),
      hooks,
    );
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("VERDICT {not-json"); // trimmed, unparsed, unsynthesized
  });

  it("§2 structured output requested and delivered: the summary is the JSON value itself", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-so",
        outcome: script.success("prose the CLI would also emit", {
          usage: { inputTokens: 10, outputTokens: 2 },
          structuredOutput: { verdict: "approve", confidence: 0.9 },
        }),
      }),
    ]);
    const { hooks } = recordingHooks();
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: WORKDIR, verdictSchema: { type: "object" } }),
      hooks,
    );
    expect(onlyTurn(dbl).options.hasOutputFormatSchema).toBe(true);
    expect(result.summary).toBe('{"verdict":"approve","confidence":0.9}');
  });

  it("§3 typed provider failure: status failed, stable errorCode, usage still settled", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-f",
        outcome: script.failure("error_during_execution", ["boom", "bang"], {
          usage: { inputTokens: 40, outputTokens: 4 },
          costUsd: 0.2,
        }),
      }),
    ]);
    const { hooks } = recordingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks);
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("error_during_execution");
    expect(result.summary).toBe("error_during_execution: boom; bang");
    expect(result.usage.tokensIn).toBe(40);
    expect(result.usage.costUsd).toBe(0.2);
  });

  it("§3 budget overrun at the native guard: cap threaded, overshoot retained and settled, incident note deposited", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-bo",
        outcome: script.failure("error_max_budget_usd", ["max budget exceeded"], {
          usage: { inputTokens: 50_000, outputTokens: 9000 },
          costUsd: 6.5, // over the $5 role cap — Claude observes in jumps
          durationMs: 60_000,
        }),
      }),
    ]);
    const { hooks } = recordingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks);
    const turn = onlyTurn(dbl);
    expect(turn.options.maxBudgetUsd).toBe(5); // cap enforced at the finest truthful point: the CLI's running guard
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("error_max_budget_usd");
    expect(result.usage.costUsd).toBe(6.5); // overshoot retained and settled, never hidden
    expect(result.artifacts).toHaveLength(1);
    const note = result.artifacts[0];
    expect(note?.kind).toBe("note");
    expect(note?.ref).toBe("budget-overrun/sess-bo");
    expect(note?.summary).toContain("$6.5000");
    expect(note?.summary).toContain("$5");
  });

  it("§3 a gate denial is not an adapter error: the turn settles honestly with the escalation recorded", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-d",
        steps: [
          script.tool("Bash", {
            command: "rm -rf /",
            description: "cleanup", // volatile advisory field — must be normalized away
            timeout: 99,
          }),
        ],
        outcome: script.success("recovered without the tool", {
          usage: { inputTokens: 12, outputTokens: 3 },
        }),
      }),
    ]);
    const { hooks, events } = recordingHooks((action) =>
      action.tool === "bash"
        ? { allow: false, reason: "critical op", escalate: true }
        : { allow: true },
    );
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks);
    const turn = onlyTurn(dbl);
    expect(result.status).toBe("completed"); // denial never throws
    expect(result.escalations).toEqual([
      {
        action: { tool: "bash", input: { command: "rm -rf /" } }, // normalized
        reason: "critical op",
      },
    ]);
    expect(events.filter((event) => event.type === "tool_use")).toHaveLength(0); // denied ≠ tool activity
    expect(turn.toolPlays[0]?.executed).toBe(false);
  });

  it("§4 a dropped stream is never auto-retried: one provider construction, error surfaces, checkpointed usage survives via onProgress", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-t",
        steps: [script.usageUpdate({ inputTokens: 120, outputTokens: 8 })],
        outcome: script.streamDrop("scripted stream drop: TLS reset"),
      }),
    ]);
    const { hooks, progress } = recordingHooks();
    await expect(
      dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks),
    ).rejects.toThrow(/TLS reset/);
    expect(dbl.recorder.turns).toHaveLength(1); // exactly one construction — retry belongs to the orchestrator
    expect(onlyTurn(dbl).endedBy).toBe("stream_drop");
    const lastUsage = [...progress].reverse().find((entry) => entry.usage !== undefined)?.usage;
    expect(lastUsage?.tokensIn).toBe(120);
    expect(lastUsage?.tokensOut).toBe(8);
    expect(lastUsage?.quality).toBe("partial"); // whatever usage is known — never zeroed, never faked complete
  });

  it("§4 resume binds the session handle into provider construction and round-trips identity", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-r",
        outcome: script.success("resumed", { usage: { inputTokens: 5, outputTokens: 1 } }),
      }),
    ]);
    const { hooks } = recordingHooks();
    const req = doubleTurnRequest({
      workdir: WORKDIR,
      session: { runtime: "claude", id: "sess-r" },
    });
    const result = await dbl.runtime.runTurn(req, hooks);
    const turn = onlyTurn(dbl);
    expect(turn.options.resume).toBe("sess-r");
    expect(result.session).toEqual({ runtime: "claude", id: "sess-r" });
    expect(() => checkSessionIdentityHonest(turn, req.session, result)).not.toThrow();
  });

  it("§5 gate classification precedes execution; tool_use emission is pre-execution", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-ord",
        steps: [script.tool("Bash", { command: "echo hi" })],
        outcome: script.success("ok", { usage: { inputTokens: 5, outputTokens: 1 } }),
      }),
    ]);
    const events: TurnEvent[] = [];
    const hooks: TurnHooks = {
      gate: (action) => {
        dbl.recorder.turns.at(-1)?.sequence.push(`org-gate:${action.tool}`);
        return { allow: true };
      },
      onEvent: (event) => {
        events.push(event);
        dbl.recorder.turns.at(-1)?.sequence.push(`event:${event.type}`);
      },
    };
    await dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks);
    const sequence = onlyTurn(dbl).sequence;
    const consultAt = sequence.indexOf("consult:hook:Bash");
    const gateAt = sequence.indexOf("org-gate:bash");
    const eventAt = sequence.indexOf("event:tool_use");
    const executeAt = sequence.indexOf("execute:Bash");
    expect(consultAt).toBeGreaterThanOrEqual(0);
    expect(gateAt).toBeGreaterThan(consultAt); // classification first…
    expect(eventAt).toBeGreaterThan(gateAt); // …emission on allow…
    expect(executeAt).toBeGreaterThan(eventAt); // …execution last — never post-hoc
    expect(events.filter((event) => event.type === "tool_use")).toHaveLength(1);
  });

  it("§5 exactly one gate consultation per executed action, subagent calls included, with workdir-relative normalization", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-sub",
        steps: [
          script.tool("Bash", { command: "echo main" }),
          script.tool(
            "Read",
            { file_path: `${WORKDIR}/README.md` },
            { fromSubagent: true },
          ),
        ],
        outcome: script.success("ok", { usage: { inputTokens: 9, outputTokens: 2 } }),
      }),
    ]);
    const { hooks, gateActions } = recordingHooks();
    await dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks);
    const turn = onlyTurn(dbl);
    expect(gateActions.map((action) => action.tool)).toEqual(["bash", "read"]);
    expect(gateActions[1]?.input).toEqual({ path: "README.md" }); // workdir-relative
    expect(() => checkEveryExecutedToolConsulted(turn)).not.toThrow();
    for (const play of turn.toolPlays) {
      expect(play.consultations).toHaveLength(1);
      expect(play.executed).toBe(true);
    }
  });

  it("negative control: a provider that executes a tool without consulting any gate channel is caught", async () => {
    const dbl = claudeDouble(
      [
        script.turn({
          sessionId: "sess-by",
          steps: [script.tool("Bash", { command: "echo sneaky" })],
          outcome: script.success("ok", { usage: { inputTokens: 5, outputTokens: 1 } }),
        }),
      ],
      { violations: ["bypass_gate"] },
    );
    const { hooks, gateActions } = recordingHooks();
    await dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks);
    const turn = onlyTurn(dbl);
    expect(gateActions).toHaveLength(0); // the org gate never saw it — that is the hole
    expect(turn.toolPlays[0]?.executed).toBe(true);
    expect(() => checkEveryExecutedToolConsulted(turn)).toThrow(AdapterContractViolation);
    expect(() => checkEveryExecutedToolConsulted(turn)).toThrow(/ungated/);
  });

  it("negative control: an SDK firing both gate channels for one action is caught (one-gate-call tripwire)", async () => {
    const dbl = claudeDouble(
      [
        script.turn({
          sessionId: "sess-2ch",
          steps: [script.tool("Bash", { command: "echo twice" })],
          outcome: script.success("ok", { usage: { inputTokens: 5, outputTokens: 1 } }),
        }),
      ],
      { violations: ["consult_both_channels"] },
    );
    const { hooks, gateActions, events } = recordingHooks();
    await dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks);
    const turn = onlyTurn(dbl);
    // The failure shape the tripwire exists for: duplicate gate calls and
    // duplicate tool_use emission for a single action.
    expect(gateActions).toHaveLength(2);
    expect(events.filter((event) => event.type === "tool_use")).toHaveLength(2);
    expect(() => checkEveryExecutedToolConsulted(turn)).toThrow(/consulted 2 times/);
  });
});

describe("CF-B02 — OPERON-C-B02-001 deltas and scripted B-02 failure modes", () => {
  it("tool events carry no outcome fields even when the script carries terminal outcomes (pre-execution surface)", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-pre",
        steps: [
          script.tool(
            "Bash",
            { command: "echo hi" },
            { terminal: { success: true, durationMs: 50 } }, // Codex would render this; Claude must not
          ),
        ],
        outcome: script.success("ok", { usage: { inputTokens: 5, outputTokens: 1 } }),
      }),
    ]);
    const { hooks, events } = recordingHooks();
    await dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks);
    const toolEvents = events.filter((event) => event.type === "tool_use");
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]?.success).toBeUndefined(); // absence documented, never synthesized
    expect(toolEvents[0]?.durationMs).toBeUndefined();
    expect(toolEvents[0]?.name).toBe("bash");
  });

  it("spawn tools are adapter-allowed, never org-gated; the subagent's own actions are gated like main thread", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-spawn",
        steps: [
          script.tool("Task", { description: "helper", prompt: "do the thing" }),
          script.subagentStarted("general-purpose", "helper"),
          script.tool("Read", { file_path: `${WORKDIR}/README.md` }, { fromSubagent: true }),
        ],
        outcome: script.success("ok", { usage: { inputTokens: 9, outputTokens: 2 } }),
      }),
    ]);
    const { hooks, gateActions, events } = recordingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks);
    const turn = onlyTurn(dbl);
    expect(gateActions.map((action) => action.tool)).toEqual(["read"]); // spawn itself is fan-out, not an effect
    expect(events.some((event) => event.type === "subagent")).toBe(true);
    expect(result.usage.subagentTurns).toBe(1); // fan-out is visible, never silent
    expect(() => checkEveryExecutedToolConsulted(turn)).not.toThrow(); // spawn WAS hook-consulted (adapter-level allow)
  });

  it("structured-output tool bypasses the gate only when this turn carries a verdict schema", async () => {
    const scenario = (): ReturnType<typeof script.turn> =>
      script.turn({
        sessionId: "sess-sot",
        steps: [script.tool("StructuredOutput", { output: { verdict: "approve" } })],
        outcome: script.success("ok", { usage: { inputTokens: 5, outputTokens: 1 } }),
      });

    const withSchema = claudeDouble([scenario()]);
    const first = recordingHooks();
    await withSchema.runtime.runTurn(
      doubleTurnRequest({ workdir: WORKDIR, verdictSchema: { type: "object" } }),
      first.hooks,
    );
    expect(first.gateActions).toHaveLength(0); // schema-bound output tool: harness-owned, not an agent capability
    expect(onlyTurn(withSchema).toolPlays[0]?.executed).toBe(true);

    const withoutSchema = claudeDouble([scenario()]);
    const second = recordingHooks();
    await withoutSchema.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), second.hooks);
    expect(second.gateActions.map((action) => action.tool)).toEqual(["structuredoutput"]); // ordinary tool: gated
  });

  it("the canUseTool backstop routes through the same gate when the hook channel is silent", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-bs",
        steps: [
          script.tool("Bash", { command: "ls" }, { channel: "permission" }),
          script.tool(
            "Write",
            { file_path: `${WORKDIR}/x.txt`, content: "x" },
            { channel: "permission" },
          ),
        ],
        outcome: script.success("ok", { usage: { inputTokens: 5, outputTokens: 1 } }),
      }),
    ]);
    const { hooks, gateActions } = recordingHooks((action) =>
      action.tool === "write"
        ? { allow: false, reason: "no writes", escalate: false }
        : { allow: true },
    );
    await dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks);
    const turn = onlyTurn(dbl);
    expect(turn.sequence.some((entry) => entry.startsWith("consult:hook:"))).toBe(false);
    expect(gateActions.map((action) => action.tool)).toEqual(["bash", "write"]); // same gate, other channel
    expect(turn.toolPlays[0]?.executed).toBe(true);
    expect(turn.toolPlays[1]?.executed).toBe(false);
    expect(turn.toolPlays[1]?.consultations[0]?.channel).toBe("permission");
    expect(turn.toolPlays[1]?.consultations[0]?.reason).toBe("no writes");
  });

  it("role toolset shaping lands as CLI permission deny rules for shaped roles", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-shape",
        outcome: script.success("ok", { usage: { inputTokens: 5, outputTokens: 1 } }),
      }),
    ]);
    const { hooks } = recordingHooks();
    await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: WORKDIR, role: doubleRole({ name: "builder" }) }),
      hooks,
    );
    const denyRules = onlyTurn(dbl).options.permissionDenyRules;
    expect(denyRules).toContain("Bash(gh pr merge:*)");
    expect(denyRules).toContain("Write(~/.claude/**)");
  });

  it("stream ends with no result: the adapter refuses to fabricate an envelope", async () => {
    const dbl = claudeDouble([
      script.turn({ sessionId: "sess-nr", outcome: script.noResult() }),
    ]);
    const { hooks } = recordingHooks();
    await expect(
      dbl.runtime.runTurn(doubleTurnRequest({ workdir: WORKDIR }), hooks),
    ).rejects.toThrow(/without a result/);
  });

  it("cancellation mid-turn preserves checkpointed usage as partial, never fabricated-complete", async () => {
    const controller = new AbortController();
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-cx",
        steps: [
          script.usageUpdate({ inputTokens: 120, outputTokens: 8 }),
          script.tool("Bash", { command: "echo next" }),
        ],
        outcome: script.success("never delivered", {
          usage: { inputTokens: 999, outputTokens: 99 },
        }),
      }),
    ]);
    const { hooks } = recordingHooks(() => {
      controller.abort();
      return { allow: true };
    });
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: WORKDIR, signal: controller.signal }),
      hooks,
    );
    expect(result.status).toBe("cancelled");
    expect(result.errorCode).toBe("error_cancelled");
    expect(result.session).toEqual({ runtime: "claude", id: "sess-cx" });
    expect(result.usage.tokensIn).toBe(120); // whatever usage is known…
    expect(result.usage.tokensOut).toBe(8);
    expect(result.usage.quality).toBe("partial"); // …marked incomplete, dollar cost never invented
    expect(result.usage.costUsd).toBe(0);
  });

  // PROMOTED 2026-07-31 (HB-024, was the Wave-0 `it.fails` KNOWN-GAP deposit):
  // core §4 + B-02 resume delta ("resume validates it restored the *exact*
  // session") is now enforced by the adapter — a provider-restored different
  // session is a typed refusal BEFORE any tool action or usage accrues.
  it("core §4: a resume the provider restores to a different session is a typed failure pre-spend (promoted, HB-024)", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-B", // the provider restored a DIFFERENT session
        steps: [script.tool("Bash", { command: "echo spend happens" })],
        outcome: script.success("ran anyway", { usage: { inputTokens: 9, outputTokens: 1 } }),
      }),
    ]);
    const { hooks, gateActions, progress } = recordingHooks();
    const run = dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: WORKDIR, session: { runtime: "claude", id: "sess-A" } }),
      hooks,
    );
    await expect(run).rejects.toThrow(ClaudeSessionResumeMismatchError);
    await expect(run).rejects.toThrow(/sess-A/);
    await expect(run).rejects.toThrow(/sess-B/);
    const turn = dbl.recorder.turns[0];
    expect(turn?.toolPlays).toHaveLength(0); // pre-spend: no scripted tool ever played
    expect(gateActions).toHaveLength(0); // the org gate never saw an action
    expect(turn?.usageReported).toBe(false); // no usage accrued before the refusal
    expect(progress.filter((entry) => entry.usage !== undefined)).toHaveLength(0);
  });

  it("core §4: the typed resume-mismatch refusal carries the stable machine code and both session ids", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-B",
        outcome: script.success("never", { usage: { inputTokens: 1, outputTokens: 1 } }),
      }),
    ]);
    const { hooks } = recordingHooks();
    try {
      await dbl.runtime.runTurn(
        doubleTurnRequest({ workdir: WORKDIR, session: { runtime: "claude", id: "sess-A" } }),
        hooks,
      );
      expect.unreachable("the mismatch must be refused");
    } catch (error) {
      expect(isTypedResumeMismatchError(error)).toBe(true);
      const typed = error as ClaudeSessionResumeMismatchError;
      expect(typed.code).toBe(RESUME_MISMATCH_ERROR_CODE);
      expect(typed.requestedSessionId).toBe("sess-A");
      expect(typed.restoredSessionId).toBe("sess-B");
    }
  });

  it("negative control: a masking variant that swallows the typed refusal and echoes the requested resume id is caught", async () => {
    const dbl = claudeDouble(
      [
        script.turn({
          sessionId: "sess-B",
          outcome: script.success("resumed elsewhere", {
            usage: { inputTokens: 5, outputTokens: 1 },
          }),
        }),
      ],
      { violations: ["mask_resume_identity"] },
    );
    const { hooks } = recordingHooks();
    const req = doubleTurnRequest({
      workdir: WORKDIR,
      session: { runtime: "claude", id: "sess-A" },
    });
    // The seeded lie resolves where the real adapter would refuse…
    const result = await dbl.runtime.runTurn(req, hooks);
    expect(result.session.id).toBe("sess-A");
    // …and the identity detector fires on the echoed id.
    expect(() =>
      checkSessionIdentityHonest(onlyTurn(dbl), req.session, result),
    ).toThrow(AdapterContractViolation);
  });
});
