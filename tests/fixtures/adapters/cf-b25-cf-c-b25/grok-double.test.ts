// CF-B25 + CF-C-B25 — HB-137; case-catalog.md §§4–5, boundary-map.md B-25,
// and contracts/B-25-grok-build.md: scripted Grok boundary/contract tests.
//
// The double is only evidence if it speaks the shapes the adapter actually
// consumes. These cases pin those shapes against the traffic captured from
// grok 1.0.0 on 2026-08-07 and prove the adapter's own contract behavior:
// hook-gated denial, the fail-closed handshake, provider-reported cost in
// ticks, honest unknown usage, exact resume identity, and the isolation
// sentinel. Every detector family lands with a seeded violation.

import { afterEach, describe, expect, it } from "vitest";
import { grokDouble } from "../grok-double.js";
import { doubleRole, doubleTurnRequest } from "../claude-double.js";
import { checkEveryExecutedToolConsulted, checkUsageAbsentRenderedUnknown, script } from "../scenario.js";
import { makeTempGitRepo, type TempGitRepo } from "../../git-repo.js";
import type { GateDecision, ToolAction, TurnHooks } from "../../../../src/runtime/types.js";

let repo: TempGitRepo | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
});

const MODEL = "grok-4.5";

function denyingHooks(): { hooks: TurnHooks; actions: ToolAction[] } {
  const actions: ToolAction[] = [];
  return {
    actions,
    hooks: {
      gate: (action): GateDecision => {
        actions.push(action);
        return { allow: false, reason: "scripted denial", escalate: true };
      },
    },
  };
}

function allowingHooks(): { hooks: TurnHooks; actions: ToolAction[] } {
  const actions: ToolAction[] = [];
  return {
    actions,
    hooks: {
      gate: (action): GateDecision => {
        actions.push(action);
        return { allow: true };
      },
    },
  };
}

function request(repoDir: string, task = "do the thing", session?: { runtime: "grok"; id: string }) {
  return doubleTurnRequest({
    role: doubleRole({ runtime: "grok", model: MODEL, effort: "medium" }),
    workdir: repoDir,
    task,
    ...(session === undefined ? {} : { session }),
  });
}

describe("grok double — ACP wire shapes the adapter consumes", () => {
  it("negotiates protocolVersion 1, opens a session, and transports the task in the JSON-RPC body", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([
      script.turn({
        sessionId: "grok-sess-1",
        outcome: script.success("done", { usage: { inputTokens: 100, outputTokens: 10 }, costUsd: 0.02 }),
      }),
    ]);
    const { hooks } = allowingHooks();
    const result = await dbl.runtime.runTurn(request(repo.dir, "explain the repo"), hooks);

    const turn = dbl.recorder.turns[0]!;
    expect(turn.requests.map((row) => row.method)).toEqual(["initialize", "session/new", "session/prompt"]);
    expect(turn.promptText).toBe("explain the repo");
    expect(turn.args).toEqual(["agent", "--model", MODEL, "stdio"]);
    expect(result.session).toEqual({ runtime: "grok", id: "grok-sess-1" });
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("done");
  });

  it("renders provider-reported ticks as dollars and marks the usage complete", async () => {
    repo = await makeTempGitRepo();
    // 137_236_000 ticks is the exact figure grok reported for the certification
    // probe turn; 1 USD = 10^10 ticks.
    const dbl = grokDouble([
      {
        ...script.turn({
          sessionId: "grok-sess-usage",
          outcome: script.success("ok", {
            usage: { inputTokens: 31_413, outputTokens: 484, cacheReadTokens: 30_592 },
            costUsd: 0,
          }),
        }),
        costUsdTicks: 137_236_000,
      },
    ]);
    const result = await dbl.runtime.runTurn(request(repo.dir), allowingHooks().hooks);

    expect(result.usage.costUsd).toBeCloseTo(0.0137236, 9);
    expect(result.usage.quality).toBe("complete");
    expect(result.usage.costEstimated).toBeUndefined();
    expect(result.usage.tokensIn).toBe(31_413);
    expect(result.usage.cacheReadTokens).toBe(30_592);
    expect(result.usage.tokensInUncached).toBe(821);
    expect(result.usage.subagentTurns).toBe(0);
  });

  it("keeps a partial cost unknown instead of inventing a dollar figure", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([
      {
        ...script.turn({
          sessionId: "grok-sess-partial",
          outcome: script.success("ok", { usage: { inputTokens: 500, outputTokens: 20 }, costUsd: 1 }),
        }),
        costIsPartial: true,
      },
    ]);
    const result = await dbl.runtime.runTurn(request(repo.dir), allowingHooks().hooks);

    expect(result.usage.quality).toBe("partial");
    expect(result.usage.costUsd).toBe(0);
    expect(result.usage.tokensIn).toBe(500);
  });

  it("surfaces a usage-absent turn as unknown, never an authoritative zero", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([
      script.turn({
        sessionId: "grok-sess-nousage",
        outcome: script.success("ok", { usage: "absent" }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(request(repo.dir), allowingHooks().hooks);

    checkUsageAbsentRenderedUnknown(dbl.recorder.turns[0]!, result);
    expect(result.usage.quality).toBe("unavailable");
  });

  it("negative control: a fabricated zero-usage envelope makes the INV-006 detector fire", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble(
      [script.turn({ sessionId: "grok-sess-lie", outcome: script.success("ok", { usage: "absent" }) })],
      { violations: ["fabricate_zero_usage"] },
    );
    const result = await dbl.runtime.runTurn(request(repo.dir), allowingHooks().hooks);

    expect(() => checkUsageAbsentRenderedUnknown(dbl.recorder.turns[0]!, result)).toThrow(/INV-006 usage-unknown/);
  });
});

describe("grok double — the PreToolUse hook is the gate", () => {
  it("routes every tool class through the gate and makes denial terminal", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([
      script.turn({
        sessionId: "grok-sess-gate",
        steps: [
          script.tool("run_terminal_command", { command: "echo hi" }),
          // Read-only tools NEVER reach ACP's permission request; the hook is
          // the only surface that sees them (F-PT-027).
          script.tool("read_file", { target_file: "README.md" }),
          script.tool("list_dir", { target_directory: "." }),
        ],
        outcome: script.success("blocked", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
      }),
    ]);
    const { hooks, actions } = denyingHooks();
    const result = await dbl.runtime.runTurn(request(repo.dir), hooks);

    expect(actions.map((action) => action.tool)).toEqual(["bash", "read", "list_dir"]);
    expect(result.status).toBe("blocked_on_gate");
    expect(result.escalations).toHaveLength(3);
    checkEveryExecutedToolConsulted(dbl.recorder.turns[0]!);
    for (const play of dbl.recorder.turns[0]!.toolPlays) expect(play.executed).toBe(false);
  });

  it("negative control: an internally resolved shell call makes the gate detector fire", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble(
      [
        script.turn({
          sessionId: "grok-sess-bypass",
          steps: [script.tool("run_terminal_command", { command: "rm -rf /" })],
          outcome: script.success("silently ran", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
        }),
      ],
      { violations: ["internally_resolved_shell"] },
    );
    const { hooks, actions } = denyingHooks();
    await dbl.runtime.runTurn(request(repo.dir), hooks);

    expect(actions).toEqual([]);
    expect(() => checkEveryExecutedToolConsulted(dbl.recorder.turns[0]!)).toThrow(/INV-002 gate-before-execution/);
  });

  it("denies the fan-out tool outright because B-25 declares fan-out unsupported", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([
      script.turn({
        sessionId: "grok-sess-fanout",
        steps: [script.tool("spawn_subagent", { agent_type: "explore", task: "look around" })],
        outcome: script.success("no fan-out", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
      }),
    ]);
    const { hooks, actions } = allowingHooks();
    await dbl.runtime.runTurn(request(repo.dir), hooks);

    // The bridge throws before consulting the gate, and grok sees a deny.
    expect(actions).toEqual([]);
    expect(dbl.recorder.turns[0]!.toolPlays[0]!.executed).toBe(false);
  });

  it("routes the ACP permission backstop through the same gate", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([
      script.turn({
        sessionId: "grok-sess-backstop",
        steps: [script.tool("run_terminal_command", { command: "git push" }, { channel: "permission" })],
        outcome: script.success("backstopped", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
      }),
    ]);
    const { hooks, actions } = denyingHooks();
    const result = await dbl.runtime.runTurn(request(repo.dir), hooks);

    expect(actions.map((action) => action.tool)).toEqual(["run_terminal_command"]);
    expect(result.status).toBe("blocked_on_gate");
    expect(dbl.recorder.turns[0]!.toolPlays[0]!.executed).toBe(false);
    checkEveryExecutedToolConsulted(dbl.recorder.turns[0]!);
  });
});

describe("grok double — fail-closed refusals", () => {
  it("refuses the turn when the hook handshake never fired, before any prompt", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble(
      [
        script.turn({
          sessionId: "grok-sess-nohook",
          outcome: script.success("never reached", { usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.01 }),
        }),
      ],
      { violations: ["suppress_hook_handshake"] },
    );

    await expect(dbl.runtime.runTurn(request(repo.dir), allowingHooks().hooks)).rejects.toMatchObject({
      code: "error_gate_unproven",
    });
    // The decisive claim: no prompt was sent, so no tokens were spent.
    expect(dbl.recorder.turns[0]!.requests.map((row) => row.method)).toEqual(["initialize", "session/new"]);
    expect(dbl.recorder.turns[0]!.promptText).toBeUndefined();
  });

  it("refuses when operator configuration leaks a bypass permission mode into the turn", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble(
      [
        script.turn({
          sessionId: "grok-sess-leak",
          outcome: script.success("never reached", { usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.01 }),
        }),
      ],
      { violations: ["leak_operator_permission_mode"] },
    );

    await expect(dbl.runtime.runTurn(request(repo.dir), allowingHooks().hooks)).rejects.toThrow(
      /bypassPermissions.*operator configuration reached an isolated turn/s,
    );
    expect(dbl.recorder.turns[0]!.promptText).toBeUndefined();
  });

  it("refuses an unmappable effort rather than aliasing it down", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([script.turn({ sessionId: "unused", outcome: script.success("x", { usage: "absent" }) })]);
    const req = doubleTurnRequest({
      role: doubleRole({ runtime: "grok", model: MODEL, effort: "xhigh" }),
      workdir: repo.dir,
      task: "t",
    });

    await expect(dbl.runtime.runTurn(req, allowingHooks().hooks)).rejects.toThrow(/effort xhigh is unsupported/);
  });
});

describe("grok double — session identity", () => {
  it("resumes the exact session and reports the identity grok itself witnessed", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([
      script.turn({
        sessionId: "grok-sess-resume",
        outcome: script.success("first", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
      }),
      script.turn({
        sessionId: "grok-sess-resume",
        outcome: script.success("second", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
      }),
    ]);
    const first = await dbl.runtime.runTurn(request(repo.dir), allowingHooks().hooks);
    const second = await dbl.runtime.runTurn(
      request(repo.dir, "again", { runtime: "grok", id: first.session.id }),
      allowingHooks().hooks,
    );

    expect(second.session.id).toBe("grok-sess-resume");
    expect(dbl.recorder.turns[1]!.requests.map((row) => row.method)).toEqual([
      "initialize",
      "session/load",
      "session/prompt",
    ]);
  });

  it("refuses a resume whose hook witness names a different session", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([
      script.turn({
        sessionId: "grok-sess-other",
        outcome: script.success("restored the wrong thread", { usage: "absent" }),
      }),
    ]);

    await expect(
      dbl.runtime.runTurn(
        request(repo.dir, "again", { runtime: "grok", id: "grok-sess-requested" }),
        allowingHooks().hooks,
      ),
    ).rejects.toMatchObject({ code: "error_resume_session_mismatch" });
  });
});
