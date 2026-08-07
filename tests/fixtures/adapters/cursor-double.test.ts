// L1 — CF-B24-*: the scripted cursor-agent transport speaks the provider's
// real wire shapes, and the REAL CursorRuntime honors CORMIDIA-C-B24-001 /
// CORMIDIA-C-CORE-001 against it.
//
// Every shape asserted here is a projection of bytes captured live from
// cursor-agent 2026.08.04-aaa8809 on 2026-08-07
// (research/2026-08-07_cursor-adapter-certification.md). If the CLI's
// stream-json drifts, this file is re-derived from a fresh capture — never
// loosened to keep a suite green.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cursorAgentArgs } from "../../../src/runtime/adapters/cursor.js";
import {
  CURSOR_CLI_CONFIG_RELATIVE_PATH,
  CURSOR_HOOKS_RELATIVE_PATH,
} from "../../../src/runtime/adapters/cursor-config.js";
import { normalizeCursorHookAction } from "../../../src/runtime/adapters/cursor-gate-bridge.js";
import { cursorModelPrice, estimateCursorCostUsd } from "../../../src/runtime/adapters/cursor-pricing.js";
import type { GateDecision, ToolAction, TurnEvent, TurnHooks } from "../../../src/runtime/types.js";
import { makeTempGitRepo, type TempGitRepo } from "../git-repo.js";
import { doubleRole, doubleTurnRequest } from "./claude-double.js";
import { cursorDouble } from "./cursor-double.js";
import {
  AdapterContractViolation,
  checkEveryExecutedToolConsulted,
  checkSessionIdentityHonest,
  checkUsageAbsentRenderedUnknown,
  script,
} from "./scenario.js";

let repo: TempGitRepo | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
});

const OK_USAGE = { inputTokens: 7826, outputTokens: 183, cacheReadTokens: 25504, cacheCreationTokens: 0 };
const ALLOW: GateDecision = { allow: true };

const cursorRole = (overrides: Parameters<typeof doubleRole>[0] = {}) =>
  doubleRole({ runtime: "cursor", model: "claude-opus-5-thinking-high", effort: "high", ...overrides });

function recordingHooks(decide: (action: ToolAction) => GateDecision = () => ALLOW): {
  hooks: TurnHooks;
  gateActions: ToolAction[];
  events: TurnEvent[];
  seen: { hooksJson: string; cliJson: string };
} {
  const gateActions: ToolAction[] = [];
  const events: TurnEvent[] = [];
  const seen = { hooksJson: "", cliJson: "" };
  return {
    gateActions,
    events,
    seen,
    hooks: {
      gate: (action) => {
        gateActions.push(action);
        return decide(action);
      },
      onEvent: (event) => events.push(event),
    },
  };
}

describe("CF-B24 — scripted cursor-agent transport, real CursorRuntime", () => {
  it("launches with the deliberate trust+force pair and no broader bypass spelling", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble([
      script.turn({ sessionId: "chat-1", outcome: script.success("done", { usage: OK_USAGE }) }),
    ]);
    const { hooks } = recordingHooks();
    await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: cursorRole() }), hooks);
    expect(dbl.recorder.turns[0]!.args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--trust",
      "--force",
      "--model",
      "claude-opus-5-thinking-high",
    ]);
    expect(dbl.recorder.turns[0]!.args).not.toContain("--yolo");
    expect(dbl.recorder.turns[0]!.args).not.toContain("--auto-review");
  });

  it("transports the brief on stdin, never argv", async () => {
    repo = await makeTempGitRepo();
    const brief = `head::${"x".repeat(4096)}::tail`;
    const dbl = cursorDouble([
      script.turn({ sessionId: "chat-payload", outcome: script.success("done", { usage: OK_USAGE }) }),
    ]);
    const { hooks } = recordingHooks();
    await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: cursorRole(), task: brief }), hooks);
    expect(dbl.recorder.turns[0]!.stdinTask).toBe(brief);
    expect(dbl.recorder.turns[0]!.args.join(" ")).not.toContain("head::");
  });

  it("installs a preToolUse-only fail-closed hook config and a deny-only cli config", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble([
      script.turn({
        sessionId: "chat-cfg",
        steps: [script.tool("Bash", { command: "echo hi" })],
        outcome: script.success("done", { usage: OK_USAGE }),
      }),
    ]);
    const recorded = recordingHooks((action) => {
      // The per-turn config exists only while the turn is live — the bridge
      // removes both files at close so a later non-Cormidia run in the same
      // worktree never inherits a dead socket.
      recorded.seen.hooksJson = readIfPresent(repo!.dir, CURSOR_HOOKS_RELATIVE_PATH);
      recorded.seen.cliJson = readIfPresent(repo!.dir, CURSOR_CLI_CONFIG_RELATIVE_PATH);
      void action;
      return ALLOW;
    });
    await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: repo.dir, role: cursorRole({ name: "builder" }) }),
      recorded.hooks,
    );

    const parsedHooks = JSON.parse(recorded.seen.hooksJson) as {
      version: number;
      hooks: Record<string, Array<Record<string, unknown>>>;
    };
    expect(parsedHooks.version).toBe(1);
    // Exactly one gate channel. Registering beforeShellExecution/beforeReadFile
    // as well would consult the in-process gate twice for one action.
    expect(Object.keys(parsedHooks.hooks)).toEqual(["preToolUse"]);
    // Cursor's documented default is fail-OPEN; a crashed bridge must not
    // silently ungate a turn.
    expect(parsedHooks.hooks["preToolUse"]![0]!["failClosed"]).toBe(true);

    const parsedCli = JSON.parse(recorded.seen.cliJson) as { permissions: Record<string, unknown> };
    // cursor-agent's config schema REQUIRES `allow`; omitting it exits 1 before
    // any turn. Empty is the only value that cannot widen.
    expect(Object.keys(parsedCli.permissions)).toEqual(["allow", "deny"]);
    expect(parsedCli.permissions["allow"]).toEqual([]);
    expect(parsedCli.permissions["deny"]).toContain("Shell(gh pr merge:*)");
    expect(parsedCli.permissions["deny"]).toContain("Write(~/.cursor/**)");

    // Both files are gone once the turn settles.
    expect(readIfPresent(repo.dir, CURSOR_HOOKS_RELATIVE_PATH)).toBe("");
    expect(readIfPresent(repo.dir, CURSOR_CLI_CONFIG_RELATIVE_PATH)).toBe("");
  });

  it("an unshaped role gets an empty native deny list — shaping never widens", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble([
      script.turn({
        sessionId: "chat-planner",
        steps: [script.tool("Bash", { command: "echo hi" })],
        outcome: script.success("done", { usage: OK_USAGE }),
      }),
    ]);
    const recorded = recordingHooks(() => {
      recorded.seen.cliJson = readIfPresent(repo!.dir, CURSOR_CLI_CONFIG_RELATIVE_PATH);
      return ALLOW;
    });
    await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: cursorRole() }), recorded.hooks);
    expect(JSON.parse(recorded.seen.cliJson)).toEqual({ permissions: { allow: [], deny: [] } });
  });

  it("gate denial is terminal: the tool never executes and no tool_use is emitted", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble([
      script.turn({
        sessionId: "chat-deny",
        steps: [script.tool("Bash", { command: "gh pr merge 42 --squash" })],
        outcome: script.success("recovered without the tool", { usage: OK_USAGE }),
      }),
    ]);
    const { hooks, gateActions, events } = recordingHooks(() => ({
      allow: false,
      reason: "critical op: merge (scripted)",
      escalate: true,
    }));
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: cursorRole() }), hooks);

    expect(gateActions).toEqual([{ tool: "bash", input: { command: "gh pr merge 42 --squash" } }]);
    expect(result.status).toBe("blocked_on_gate");
    expect(result.escalations).toEqual([
      {
        action: { tool: "bash", input: { command: "gh pr merge 42 --squash" } },
        reason: "critical op: merge (scripted)",
      },
    ]);
    expect(events.filter((event) => event.type === "tool_use")).toHaveLength(0);
    const turn = dbl.recorder.turns[0]!;
    expect(turn.toolPlays[0]!.executed).toBe(false);
    expect(() => checkEveryExecutedToolConsulted(turn)).not.toThrow();
    expect(() => checkSessionIdentityHonest(turn, undefined, result)).not.toThrow();
  });

  it("an allowed tool emits exactly one post-execution tool_use carrying the provider's outcome", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble([
      script.turn({
        sessionId: "chat-allow",
        steps: [script.tool("Bash", { command: "ls -1" }, { terminal: { success: true, durationMs: 660 } })],
        outcome: script.success("listed", { usage: OK_USAGE }),
      }),
    ]);
    const { hooks, events } = recordingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: cursorRole() }), hooks);
    expect(result.status).toBe("completed");
    const toolEvents = events.filter((event) => event.type === "tool_use");
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]).toMatchObject({ name: "bash", success: true, durationMs: 660 });
  });

  it("usage maps the cache split and estimates cost from the published rate table", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble([
      script.turn({
        sessionId: "chat-usage",
        outcome: script.success("done", {
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cacheReadTokens: 1_000_000,
            cacheCreationTokens: 1_000_000,
          },
        }),
      }),
    ]);
    const { hooks } = recordingHooks();
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: repo.dir, role: cursorRole({ maxTurnBudgetUsd: 1000 }) }),
      hooks,
    );
    // Claude Opus 5: $5 in / $6.25 cache write / $0.50 cache read / $25 out.
    expect(result.usage.tokensInUncached).toBe(1_000_000);
    expect(result.usage.cacheReadTokens).toBe(1_000_000);
    expect(result.usage.cacheCreationTokens).toBe(1_000_000);
    expect(result.usage.tokensIn).toBe(3_000_000);
    expect(result.usage.costUsd).toBeCloseTo(5 + 6.25 + 0.5 + 25, 6);
    expect(result.usage.costEstimated).toBe(true);
    expect(result.usage.quality).toBe("estimated");
  });

  it("absent usage surfaces as unknown, never as an authoritative zero", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble([
      script.turn({ sessionId: "chat-nousage", outcome: script.success("done", { usage: "absent" }) }),
    ]);
    const { hooks } = recordingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: cursorRole() }), hooks);
    expect(result.usage.quality).toBe("unavailable");
    expect(() => checkUsageAbsentRenderedUnknown(dbl.recorder.turns[0]!, result)).not.toThrow();
  });

  it("fan-out is visible: a Task call pairs subagent events and counts the turn", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble([
      script.turn({
        sessionId: "chat-fanout",
        steps: [script.subagentStarted("generalPurpose", "helper")],
        outcome: script.success("delegated", { usage: OK_USAGE }),
      }),
    ]);
    const { hooks, events } = recordingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: cursorRole() }), hooks);
    const subagentEvents = events.filter((event) => event.type === "subagent");
    expect(subagentEvents.map((event) => event.phase)).toEqual(["started", "completed"]);
    expect(subagentEvents[0]!.name).toBe("generalPurpose");
    expect(subagentEvents[0]!.spanId).toBe(subagentEvents[1]!.spanId);
    expect(result.usage.subagentTurns).toBe(1); // fan-out is never silent
  });

  it("resume binds the exact chat id and refuses a mismatch", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble([
      script.turn({ sessionId: "chat-other", outcome: script.success("done", { usage: OK_USAGE }) }),
    ]);
    const { hooks } = recordingHooks();
    await expect(
      dbl.runtime.runTurn(
        doubleTurnRequest({
          workdir: repo.dir,
          role: cursorRole(),
          session: { runtime: "cursor", id: "chat-requested" },
        }),
        hooks,
      ),
    ).rejects.toThrow(/resume requested chat/);
    expect(dbl.recorder.turns[0]!.args).toEqual(expect.arrayContaining(["--resume", "chat-requested"]));
  });

  it("a stream-json line that is not JSON is a typed failure, never a silent skip", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble([script.turn({ sessionId: "chat-drop", outcome: script.streamDrop("bad line") })]);
    const { hooks } = recordingHooks();
    await expect(
      dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: cursorRole() }), hooks),
    ).rejects.toThrow(/bad line/);
  });

  it("effort that contradicts the model id's baked-in effort is a typed refusal before any spend", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble([
      script.turn({ sessionId: "chat-effort", outcome: script.success("done", { usage: OK_USAGE }) }),
    ]);
    const { hooks } = recordingHooks();
    await expect(
      dbl.runtime.runTurn(
        doubleTurnRequest({ workdir: repo.dir, role: cursorRole({ model: "gpt-5.6-sol-high", effort: "low" }) }),
        hooks,
      ),
    ).rejects.toThrow(/no effort knob/);
    expect(dbl.recorder.turns).toHaveLength(0);
  });

  it("the per-turn budget cap is a terminal check that still attributes the spend", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble([
      script.turn({
        sessionId: "chat-budget",
        outcome: script.success("expensive", {
          usage: { inputTokens: 2_000_000, outputTokens: 200_000, cacheReadTokens: 0, cacheCreationTokens: 0 },
        }),
      }),
    ]);
    const { hooks } = recordingHooks();
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: repo.dir, role: cursorRole({ maxTurnBudgetUsd: 1 }) }),
      hooks,
    );
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("error_max_budget_usd");
    expect(result.artifacts).toHaveLength(1); // exactly one incident note
    expect(result.artifacts[0]!.kind).toBe("note");
    expect(result.usage.costUsd).toBeGreaterThan(1); // spend still attributed
    expect(result.summary).toMatch(/terminal check, not a mid-run stop/);
  });

  it("an under-budget turn produces no incident note", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble([
      script.turn({ sessionId: "chat-underbudget", outcome: script.success("cheap", { usage: OK_USAGE }) }),
    ]);
    const { hooks } = recordingHooks();
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: repo.dir, role: cursorRole({ maxTurnBudgetUsd: 5 }) }),
      hooks,
    );
    expect(result.status).toBe("completed");
    expect(result.artifacts).toEqual([]);
    expect(result.errorCode).toBeUndefined();
  });
});

describe("CF-B24 — normalization and pricing units", () => {
  it("maps Cursor's tool vocabulary onto the shared gate vocabulary", () => {
    expect(normalizeCursorHookAction({ tool_name: "Shell", tool_input: { command: "ls" } }, "/w")).toEqual({
      tool: "bash",
      input: { command: "ls" },
    });
    expect(
      normalizeCursorHookAction({ tool_name: "Write", tool_input: { file_path: "/w/a.txt", content: "x" } }, "/w"),
    ).toEqual({ tool: "write", input: { path: "a.txt", content: "x" } });
    expect(normalizeCursorHookAction({ tool_name: "MCP:datadog:search", tool_input: {} }, "/w").tool).toBe(
      "mcp__datadog__search",
    );
    expect(() => normalizeCursorHookAction({ tool_input: {} }, "/w")).toThrow(/no tool_name/);
    expect(() => normalizeCursorHookAction("not-an-object", "/w")).toThrow(/not an object/);
  });

  it("prices an unlisted model at a documented upper bound, never at zero", () => {
    expect(cursorModelPrice("composer-2.5").outputPerMTok).toBe(50);
    expect(cursorModelPrice("cursor-grok-4.5-high-fast").outputPerMTok).toBe(150);
    expect(cursorModelPrice("gpt-5.6-sol-xhigh").outputPerMTok).toBe(30);
    expect(estimateCursorCostUsd({ uncached: 0, cacheRead: 0, cacheWrite: 0, tokensOut: 0 }, "auto")).toBe(0);
    expect(estimateCursorCostUsd({ uncached: 1_000_000, cacheRead: 0, cacheWrite: 0, tokensOut: 0 }, "auto")).toBe(10);
  });

  it("argv carries the resume handle only when resuming", () => {
    const assignment = { harness: "cursor" as const, model: "auto", effort: "high" as const };
    expect(cursorAgentArgs(assignment)).not.toContain("--resume");
    expect(cursorAgentArgs(assignment, "chat-7")).toEqual(expect.arrayContaining(["--resume", "chat-7"]));
  });
});

describe("CF-B24 — negative controls (seeded liars must make a detector fire)", () => {
  it("a CLI that stopped loading hooks executes ungated: the adapter refuses to call the turn completed", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble(
      [
        script.turn({
          sessionId: "chat-bypass",
          steps: [script.tool("Bash", { command: "gh pr merge 42 --squash" })],
          outcome: script.success("looks clean", { usage: OK_USAGE }),
        }),
      ],
      { violations: ["bypass_gate"] },
    );
    const { hooks, gateActions } = recordingHooks(() => ({ allow: false, reason: "critical", escalate: true }));
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: cursorRole() }), hooks);

    expect(gateActions).toEqual([]); // the hole: the gate never heard of it
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("error_gate_not_observed");
    expect(result.summary).toMatch(/Gate coverage failure/);
    const turn = dbl.recorder.turns[0]!;
    expect(turn.toolPlays[0]!.executed).toBe(true);
    expect(() => checkEveryExecutedToolConsulted(turn)).toThrow(AdapterContractViolation);
    expect(() => checkEveryExecutedToolConsulted(turn)).toThrow(/ungated/);
  });

  it("a bridge that cannot answer its own handshake refuses BEFORE --force reaches a provider", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble(
      [script.turn({ sessionId: "chat-handshake", outcome: script.success("never runs", { usage: OK_USAGE }) })],
      { violations: ["broken_gate_handshake"] },
    );
    const { hooks } = recordingHooks();
    await expect(
      dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: cursorRole() }), hooks),
    ).rejects.toThrow(/pre-spend handshake/);
    // The decisive assertion: no provider process was ever constructed, so no
    // turn ran with --force behind an unproven gate.
    expect(dbl.recorder.turns).toHaveLength(0);
  });

  it("an app-authored .cursor/hooks.json is a typed refusal, never an overwrite or a merge", async () => {
    repo = await makeTempGitRepo();
    mkdirSync(join(repo.dir, ".cursor"), { recursive: true });
    writeFileSync(join(repo.dir, CURSOR_HOOKS_RELATIVE_PATH), '{"version":1,"hooks":{}}', "utf8");
    const dbl = cursorDouble([
      script.turn({ sessionId: "chat-conflict", outcome: script.success("never runs", { usage: OK_USAGE }) }),
    ]);
    const { hooks } = recordingHooks();
    await expect(
      dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: cursorRole() }), hooks),
    ).rejects.toThrow(/already exists in the workdir/);
    expect(dbl.recorder.turns).toHaveLength(0);
    // The app's own bytes are untouched.
    expect(readIfPresent(repo.dir, CURSOR_HOOKS_RELATIVE_PATH)).toBe('{"version":1,"hooks":{}}');
  });
});

function readIfPresent(dir: string, relative: string): string {
  try {
    return readFileSync(join(dir, relative), "utf8");
  } catch {
    return "";
  }
}
