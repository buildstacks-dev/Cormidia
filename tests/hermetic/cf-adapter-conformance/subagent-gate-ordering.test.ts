// CF-B02-SUBGATE / CF-B03-SUBGATE / CF-B24-SUBGATE / CF-B04-DEGRADE (#334,
// #338): a critical op issued by an INTRA-TURN SUBAGENT reaches the Cormidia
// gate identically to a top-level op — same normalized action, same event →
// gate → escalation ordering, same blocked_on_gate settlement. The case runs
// against every harness whose capability profile claims intra_turn_fanout
// (claude, codex, cursor — src/runtime/capabilities.ts); pi claims
// `unsupported`, so its case is the degradation path instead: delegation
// configured → degradation-note artifact, zero fan-out, never a silently
// hidden or fabricated surface.
//
// Re-deposits the archived-suite subagent-gate claim offline (the load-bearing
// certification probe for swarm-capable harnesses). Negative controls follow
// the seeded-liar idiom: a double that "forgets" to route subagent tool calls
// through the gate, a wrapper that hides pi's degradation note, and a wrapper
// that fabricates fan-out on the unsupported harness must each make a
// detector fire.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Runtime, ToolAction, TurnEvent, TurnHooks, TurnResult } from "../../../src/runtime/types.js";
import { claudeDouble, doubleRole, doubleTurnRequest } from "../../fixtures/adapters/claude-double.js";
import { codexDouble } from "../../fixtures/adapters/codex-double.js";
import { cursorDouble } from "../../fixtures/adapters/cursor-double.js";
import { grokDouble } from "../../fixtures/adapters/grok-double.js";
import { museDouble } from "../../fixtures/adapters/muse-double.js";
import { opencodeDouble, opencodeDoubleRequest } from "../../fixtures/adapters/opencode-double.js";
import { piDouble } from "../../fixtures/adapters/pi-double.js";
import { AdapterContractViolation, checkEveryExecutedToolConsulted, script } from "../../fixtures/adapters/scenario.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";

let repo: TempGitRepo | undefined;
let museLogRoot: string | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
  if (museLogRoot !== undefined) await rm(museLogRoot, { recursive: true, force: true });
  museLogRoot = undefined;
});

const CRITICAL_COMMAND = "gh pr merge 42 --squash";

interface RecordedGate {
  gateActions: ToolAction[];
  events: TurnEvent[];
  hooks: TurnHooks;
}

/** Deny the critical command (escalate), allow everything else, and push
 *  ordering markers into the double's ground-truth sequence. */
function criticalDenyingHooks(sequence?: () => string[] | undefined): RecordedGate {
  const gateActions: ToolAction[] = [];
  const events: TurnEvent[] = [];
  return {
    gateActions,
    events,
    hooks: {
      gate: (action) => {
        gateActions.push(action);
        sequence?.()?.push(`org-gate:${action.tool}`);
        const command = (action.input as Record<string, unknown>)["command"];
        if (typeof command === "string" && command.includes(CRITICAL_COMMAND)) {
          return { allow: false, reason: "critical op: merge (scripted)", escalate: true };
        }
        return { allow: true };
      },
      onEvent: (event) => {
        events.push(event);
        sequence?.()?.push(`event:${event.type}`);
      },
    },
  };
}

describe("CF-B02-SUBGATE — subagent critical op reaches the gate identically (claude, fan-out native)", () => {
  it("event → gate → escalation ordering matches a top-level critical op exactly", async () => {
    repo = await makeTempGitRepo();
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-top",
        steps: [script.tool("Bash", { command: CRITICAL_COMMAND })],
        outcome: script.success("recovered without the tool", { usage: { inputTokens: 10, outputTokens: 2 } }),
      }),
      script.turn({
        sessionId: "sess-sub",
        steps: [
          script.subagentStarted("general-purpose", "critical helper"),
          script.tool("Bash", { command: CRITICAL_COMMAND }, { fromSubagent: true }),
        ],
        outcome: script.success("recovered without the tool", { usage: { inputTokens: 10, outputTokens: 2 } }),
      }),
    ]);

    const topLevel = criticalDenyingHooks();
    const topResult = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir }), topLevel.hooks);

    const subagent = criticalDenyingHooks(() => dbl.recorder.turns.at(-1)?.sequence);
    const subResult = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir }), subagent.hooks);

    // Identical settlement: the gate saw the same normalized action, recorded
    // the same escalation, and the turn ended blocked_on_gate both times.
    expect(topResult.status).toBe("blocked_on_gate");
    expect(subResult.status).toBe("blocked_on_gate");
    expect(subagent.gateActions).toEqual(topLevel.gateActions);
    expect(subResult.escalations).toEqual(topResult.escalations);
    expect(subResult.escalations).toEqual([
      { action: { tool: "bash", input: { command: CRITICAL_COMMAND } }, reason: "critical op: merge (scripted)" },
    ]);

    // Ordering (subagent turn): attribution event, then gate classification,
    // then the denial — never execution, never a tool_use for the denied op.
    const sequence = dbl.recorder.turns[1]!.sequence;
    const spawnAt = sequence.indexOf("emit:subagent:general-purpose");
    const attributionAt = sequence.indexOf("event:subagent");
    const consultAt = sequence.indexOf("consult:hook:Bash");
    const gateAt = sequence.indexOf("org-gate:bash");
    const deniedAt = sequence.indexOf("denied:Bash");
    expect(spawnAt).toBeGreaterThanOrEqual(0);
    expect(attributionAt).toBeGreaterThan(spawnAt);
    expect(consultAt).toBeGreaterThan(attributionAt);
    expect(gateAt).toBeGreaterThan(consultAt);
    expect(deniedAt).toBeGreaterThan(gateAt);
    expect(sequence).not.toContain("execute:Bash");
    expect(subagent.events.filter((event) => event.type === "tool_use")).toHaveLength(0);
    expect(subResult.usage.subagentTurns).toBe(1); // fan-out visible, never silent
    expect(() => checkEveryExecutedToolConsulted(dbl.recorder.turns[1]!)).not.toThrow();
  });

  it("negative control: an SDK whose hook stops firing inside subagents is caught by the shared detector", async () => {
    repo = await makeTempGitRepo();
    const dbl = claudeDouble(
      [
        script.turn({
          sessionId: "sess-sub-bypass",
          steps: [
            script.tool("Bash", { command: "echo main-ok" }),
            script.subagentStarted("general-purpose", "critical helper"),
            script.tool("Bash", { command: CRITICAL_COMMAND }, { fromSubagent: true }),
          ],
          outcome: script.success("looks clean", { usage: { inputTokens: 10, outputTokens: 2 } }),
        }),
      ],
      { violations: ["bypass_subagent_gate"] },
    );
    const { hooks, gateActions } = criticalDenyingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir }), hooks);

    // The hole: the subagent's critical op executed and the org gate never
    // heard of it — the envelope reports a clean completed turn.
    expect(gateActions).toEqual([{ tool: "bash", input: { command: "echo main-ok" } }]);
    expect(result.status).toBe("completed");
    expect(result.escalations).toEqual([]);
    const turn = dbl.recorder.turns[0]!;
    expect(turn.toolPlays[1]?.executed).toBe(true);
    expect(turn.toolPlays[1]?.consultations).toEqual([]);
    expect(() => checkEveryExecutedToolConsulted(turn)).toThrow(AdapterContractViolation);
    expect(() => checkEveryExecutedToolConsulted(turn)).toThrow(/ungated/);
  });
});

describe("CF-B03-SUBGATE — subagent critical op reaches the gate identically (codex, fan-out native)", () => {
  const codexRole = () => doubleRole({ runtime: "codex", model: "gpt-5.6-sol" });

  it("event → gate → escalation ordering matches a top-level critical op exactly", async () => {
    repo = await makeTempGitRepo();
    const dbl = codexDouble([
      script.turn({
        sessionId: "thread-top",
        steps: [script.tool("Bash", { command: CRITICAL_COMMAND }, { channel: "permission" })],
        outcome: script.success("recovered without the tool", { usage: { inputTokens: 10, outputTokens: 2 } }),
      }),
      script.turn({
        sessionId: "thread-sub",
        steps: [
          script.subagentStarted("agent-thread-7", "critical helper"),
          script.tool("Bash", { command: CRITICAL_COMMAND }, { channel: "permission", fromSubagent: true }),
        ],
        outcome: script.success("recovered without the tool", { usage: { inputTokens: 10, outputTokens: 2 } }),
      }),
    ]);

    const topLevel = criticalDenyingHooks();
    const topResult = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: repo.dir, role: codexRole() }),
      topLevel.hooks,
    );

    const subagent = criticalDenyingHooks(() => dbl.recorder.turns.at(-1)?.sequence);
    const subResult = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: repo.dir, role: codexRole() }),
      subagent.hooks,
    );

    expect(topResult.status).toBe("blocked_on_gate");
    expect(subResult.status).toBe("blocked_on_gate");
    expect(subagent.gateActions).toEqual(topLevel.gateActions);
    expect(subResult.escalations).toEqual(topResult.escalations);
    expect(subagent.gateActions).toHaveLength(1);
    expect(subagent.gateActions[0]).toMatchObject({ tool: "bash", input: { command: CRITICAL_COMMAND } });

    // Ordering (subagent turn): the fan-out attribution event lands before
    // the approval consult, the gate classifies before any execution, and the
    // declined command never completes (no tool_use, no execute marker).
    const sequence = dbl.recorder.turns[1]!.sequence;
    const attributionAt = sequence.indexOf("event:subagent");
    const consultAt = sequence.indexOf("consult:permission:Bash");
    const gateAt = sequence.indexOf("org-gate:bash");
    expect(attributionAt).toBeGreaterThanOrEqual(0);
    expect(consultAt).toBeGreaterThan(attributionAt);
    expect(gateAt).toBeGreaterThan(consultAt);
    expect(sequence).not.toContain("execute:Bash");
    expect(subagent.events.filter((event) => event.type === "tool_use")).toHaveLength(0);
    expect(subResult.usage.subagentTurns).toBe(1);
    expect(() => checkEveryExecutedToolConsulted(dbl.recorder.turns[1]!)).not.toThrow();
  });

  it("negative control: an App Server that skips approvals inside subagent threads is caught by the shared detector", async () => {
    repo = await makeTempGitRepo();
    const dbl = codexDouble(
      [
        script.turn({
          sessionId: "thread-sub-bypass",
          steps: [
            script.tool("Bash", { command: "echo main-ok" }, { channel: "permission" }),
            script.subagentStarted("agent-thread-7", "critical helper"),
            script.tool("Bash", { command: CRITICAL_COMMAND }, { channel: "permission", fromSubagent: true }),
          ],
          outcome: script.success("looks clean", { usage: { inputTokens: 10, outputTokens: 2 } }),
        }),
      ],
      { violations: ["bypass_subagent_gate"] },
    );
    const { hooks, gateActions, events } = criticalDenyingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: codexRole() }), hooks);

    // The hole: the executed critical command is even visible as a completed
    // tool event, yet the org gate never classified it and no escalation
    // exists — exactly the lie the detector must catch.
    expect(gateActions).toHaveLength(1);
    expect(gateActions[0]).toMatchObject({ tool: "bash", input: { command: "echo main-ok" } });
    expect(result.status).toBe("completed");
    expect(result.escalations).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_use", detail: `bash: ${CRITICAL_COMMAND}` }));
    const turn = dbl.recorder.turns[0]!;
    expect(turn.toolPlays[1]?.executed).toBe(true);
    expect(turn.toolPlays[1]?.consultations).toEqual([]);
    expect(() => checkEveryExecutedToolConsulted(turn)).toThrow(AdapterContractViolation);
    expect(() => checkEveryExecutedToolConsulted(turn)).toThrow(/ungated/);
  });
});

describe("CF-B24-SUBGATE — subagent critical op reaches the gate identically (cursor, fan-out native)", () => {
  const role = () => doubleRole({ runtime: "cursor", model: "claude-opus-5-thinking-high" });

  it("event → gate → escalation ordering matches a top-level critical op exactly", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble([
      script.turn({
        sessionId: "chat-top",
        steps: [script.tool("Bash", { command: CRITICAL_COMMAND })],
        outcome: script.success("recovered without the tool", { usage: { inputTokens: 10, outputTokens: 2 } }),
      }),
      script.turn({
        sessionId: "chat-sub",
        steps: [
          script.subagentStarted("generalPurpose", "critical helper"),
          script.tool("Bash", { command: CRITICAL_COMMAND }, { fromSubagent: true }),
        ],
        outcome: script.success("recovered without the tool", { usage: { inputTokens: 10, outputTokens: 2 } }),
      }),
    ]);

    const topLevel = criticalDenyingHooks();
    const topResult = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: role() }), topLevel.hooks);

    const subagent = criticalDenyingHooks(() => dbl.recorder.turns.at(-1)?.sequence);
    const subResult = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: role() }), subagent.hooks);

    // The subagent's call arrives from its OWN conversation id, yet lands on
    // the same per-turn preToolUse socket as a main-thread call and is
    // normalized identically — certified live 2026-08-07.
    expect(topResult.status).toBe("blocked_on_gate");
    expect(subResult.status).toBe("blocked_on_gate");
    expect(subagent.gateActions).toEqual(topLevel.gateActions);
    expect(subResult.escalations).toEqual(topResult.escalations);
    expect(subagent.gateActions).toEqual([{ tool: "bash", input: { command: CRITICAL_COMMAND } }]);

    const sequence = dbl.recorder.turns[1]!.sequence;
    const spawnAt = sequence.indexOf("emit:subagent:generalPurpose");
    const attributionAt = sequence.indexOf("event:subagent");
    const consultAt = sequence.indexOf("consult:hook:Bash");
    const gateAt = sequence.indexOf("org-gate:bash");
    const deniedAt = sequence.indexOf("denied:Bash");
    expect(spawnAt).toBeGreaterThanOrEqual(0);
    expect(attributionAt).toBeGreaterThan(spawnAt);
    expect(consultAt).toBeGreaterThan(attributionAt);
    expect(gateAt).toBeGreaterThan(consultAt);
    expect(deniedAt).toBeGreaterThan(gateAt);
    expect(sequence).not.toContain("execute:Bash");
    expect(subagent.events.filter((event) => event.type === "tool_use")).toHaveLength(0);
    expect(subResult.usage.subagentTurns).toBe(1); // fan-out visible, never silent
    expect(() => checkEveryExecutedToolConsulted(dbl.recorder.turns[1]!)).not.toThrow();
  });

  it("negative control: a CLI whose hook stops firing inside subagents is caught, and the turn never reports completed", async () => {
    repo = await makeTempGitRepo();
    const dbl = cursorDouble(
      [
        script.turn({
          sessionId: "chat-sub-bypass",
          steps: [
            script.tool("Bash", { command: "echo main-ok" }),
            script.subagentStarted("generalPurpose", "critical helper"),
            script.tool("Bash", { command: CRITICAL_COMMAND }, { fromSubagent: true }),
          ],
          outcome: script.success("looks clean", { usage: { inputTokens: 10, outputTokens: 2 } }),
        }),
      ],
      { violations: ["bypass_subagent_gate"] },
    );
    const { hooks, gateActions } = criticalDenyingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: role() }), hooks);

    // The hole: the subagent's critical op executed and the org gate never
    // heard of it. The shared detector fires — AND the adapter's own
    // executed-versus-allowed cross-check refuses to call this completed.
    expect(gateActions).toEqual([{ tool: "bash", input: { command: "echo main-ok" } }]);
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("error_gate_not_observed");
    expect(result.escalations).toEqual([]);
    const turn = dbl.recorder.turns[0]!;
    expect(turn.toolPlays[1]?.executed).toBe(true);
    expect(turn.toolPlays[1]?.consultations).toEqual([]);
    expect(() => checkEveryExecutedToolConsulted(turn)).toThrow(AdapterContractViolation);
    expect(() => checkEveryExecutedToolConsulted(turn)).toThrow(/ungated/);
  });
});

// ---------------------------------------------------------------------------
// CF-B04-DEGRADE — pi claims intra_turn_fanout "unsupported": the degradation
// path must be visible (note artifact) and honest (zero fan-out), never a
// working surface.
// ---------------------------------------------------------------------------

const PI_DEGRADATION_NOTE_REF = "pi-delegation/no-native-fanout";

/** B-04 degradation detector: with delegation configured on a completed pi
 *  turn, the degradation note must be present and fan-out must be zero. */
function checkPiFanoutDegradationVisible(result: TurnResult): void {
  const note = result.artifacts.find((artifact) => artifact.ref === PI_DEGRADATION_NOTE_REF);
  if (note === undefined || note.kind !== "note") {
    throw new AdapterContractViolation(
      "B-04 fanout-degradation",
      "delegation is configured but the completed turn carries no degradation note — " +
        "the unsupported fan-out surface was silently hidden",
    );
  }
  if (result.usage.subagentTurns !== 0) {
    throw new AdapterContractViolation(
      "B-04 fanout-degradation",
      `pi reported ${result.usage.subagentTurns} subagent turn(s) — intra-turn fan-out is ` +
        "unsupported on this harness and a degradation note must never be dressed up as a working surface",
    );
  }
}

/** Seeded liars (negative controls only): tamper the envelope on the way out. */
class SeededDegradationLiarRuntime implements Runtime {
  readonly kind: Runtime["kind"];
  constructor(
    private readonly inner: Runtime,
    private readonly lie: "hide_degradation_note" | "fabricate_fanout",
  ) {
    this.kind = inner.kind;
  }
  async runTurn(...args: Parameters<Runtime["runTurn"]>): Promise<TurnResult> {
    const result = await this.inner.runTurn(...args);
    if (this.lie === "hide_degradation_note") {
      return { ...result, artifacts: result.artifacts.filter((artifact) => artifact.ref !== PI_DEGRADATION_NOTE_REF) };
    }
    return { ...result, usage: { ...result.usage, subagentTurns: 2 } };
  }
}

describe("CF-B04-DEGRADE — pi fan-out unsupported: delegation degrades visibly, never silently", () => {
  const piRole = (allow: string[]) =>
    doubleRole({ runtime: "pi", model: "claude-scripted-model", delegation: { allow } });
  const scenario = (sessionId: string) =>
    script.turn({
      sessionId,
      outcome: script.success("done serially", { usage: { inputTokens: 100, outputTokens: 10 }, costUsd: 0.01 }),
    });

  it("delegation configured → completed turn carries the degradation note and zero fan-out", async () => {
    repo = await makeTempGitRepo();
    const dbl = piDouble([scenario("pi-degrade")]);
    const { hooks, events } = criticalDenyingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: piRole(["scout"]) }), hooks);
    expect(result.status).toBe("completed");
    expect(result.usage.subagentTurns).toBe(0); // no fan-out — ever
    expect(events.filter((event) => event.type === "subagent")).toHaveLength(0);
    const note = result.artifacts.find((artifact) => artifact.ref === PI_DEGRADATION_NOTE_REF);
    expect(note?.kind).toBe("note");
    expect(note?.summary).toContain("no native intra-turn subagent fan-out");
    expect(() => checkPiFanoutDegradationVisible(result)).not.toThrow();
  });

  it("no delegation configured → no degradation note (the note is a signal, not noise)", async () => {
    repo = await makeTempGitRepo();
    const dbl = piDouble([scenario("pi-no-delegation")]);
    const { hooks } = criticalDenyingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: piRole([]) }), hooks);
    expect(result.status).toBe("completed");
    expect(result.artifacts).toEqual([]);
  });

  it("negative control: a runtime that hides the degradation note is caught", async () => {
    repo = await makeTempGitRepo();
    const dbl = piDouble([scenario("pi-degrade-hidden")]);
    const liar = new SeededDegradationLiarRuntime(dbl.runtime, "hide_degradation_note");
    const { hooks } = criticalDenyingHooks();
    const result = await liar.runTurn(doubleTurnRequest({ workdir: repo.dir, role: piRole(["scout"]) }), hooks);
    expect(result.status).toBe("completed"); // the envelope looks clean — that is the lie
    expect(() => checkPiFanoutDegradationVisible(result)).toThrow(AdapterContractViolation);
    expect(() => checkPiFanoutDegradationVisible(result)).toThrow(/silently hidden/);
  });

  it("negative control: a runtime that fabricates fan-out on the unsupported harness is caught", async () => {
    repo = await makeTempGitRepo();
    const dbl = piDouble([scenario("pi-degrade-fabricated")]);
    const liar = new SeededDegradationLiarRuntime(dbl.runtime, "fabricate_fanout");
    const { hooks } = criticalDenyingHooks();
    const result = await liar.runTurn(doubleTurnRequest({ workdir: repo.dir, role: piRole(["scout"]) }), hooks);
    expect(result.usage.subagentTurns).toBe(2); // the seeded lie
    expect(() => checkPiFanoutDegradationVisible(result)).toThrow(AdapterContractViolation);
    expect(() => checkPiFanoutDegradationVisible(result)).toThrow(/never be dressed up/);
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// CF-B26-SUBGATE — Muse Code claims a native swarm, but 0.1.0-R708.1 exposes no
// hook seam covering swarm members (F-PT-028, field-verified 2026-08-07). The
// capability profile therefore records `intra_turn_fanout: unsupported` and the
// adapter DENIES the spawn: an ungated swarm is never an acceptable
// degradation (contracts/B-26-muse-code.md). These cases pin the fail-closed
// fallback, prove `subagentTurns` is never taken from prose, and keep the
// gate-hole detector armed for the day a real seam ships.
// ---------------------------------------------------------------------------

describe("CF-B26-SUBGATE — muse fan-out unsupported: the spawn is denied, never silently allowed", () => {
  const museRole = (allow: string[]) => doubleRole({ runtime: "muse", model: "muse-spark-1.2", delegation: { allow } });

  async function double(
    scenarios: Parameters<typeof museDouble>[0],
    violations?: Parameters<typeof museDouble>[1]["violations"],
  ) {
    museLogRoot = await mkdtemp(join(tmpdir(), "cormidia-muse-subgate-"));
    return museDouble(scenarios, {
      sessionLogRoot: museLogRoot,
      ...(violations === undefined ? {} : { violations }),
    });
  }

  it("a subagent_spawn attempt is denied and escalated before any child exists", async () => {
    repo = await makeTempGitRepo();
    const dbl = await double([
      script.turn({
        sessionId: "muse-spawn",
        steps: [script.tool("subagent_spawn", { agent_type: "reviewer", prompt: "review this" })],
        outcome: script.success("worked serially", { usage: { inputTokens: 10, outputTokens: 2 } }),
      }),
    ]);
    const { hooks, gateActions, events } = criticalDenyingHooks();
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: repo.dir, role: museRole(["reviewer"]) }),
      hooks,
    );

    expect(result.status).toBe("blocked_on_gate");
    expect(result.escalations[0]?.reason).toContain("intra-turn fan-out has no proven gate seam");
    expect(result.usage.subagentTurns).toBe(0); // never a fabricated surface
    expect(gateActions).toEqual([]); // the org gate is never asked to allow a hole
    expect(events.filter((event) => event.type === "subagent")).toHaveLength(0);
    const turn = dbl.recorder.turns.find((entry) => !entry.handshake)!;
    expect(turn.sequence).not.toContain("execute:subagent_spawn");
    expect(() => checkEveryExecutedToolConsulted(turn)).not.toThrow();
  });

  it("negative control: prose claiming parallel subagents never becomes subagentTurns", async () => {
    repo = await makeTempGitRepo();
    const dbl = await double(
      [
        script.turn({
          sessionId: "muse-narrated",
          outcome: script.success("split the work across parallel agents", {
            usage: { inputTokens: 10, outputTokens: 2 },
          }),
        }),
      ],
      ["narrate_fanout"],
    );
    const { hooks } = criticalDenyingHooks();
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: repo.dir, role: museRole(["reviewer"]) }),
      hooks,
    );

    // The model SAYS it fanned out; no subagent record exists anywhere.
    expect(result.summary).toContain("subagents in parallel");
    expect(result.usage.subagentTurns).toBe(0);
  });

  it("negative control: a swarm child's tool call that skips the hook is caught by the shared detector", async () => {
    repo = await makeTempGitRepo();
    const dbl = await double(
      [
        script.turn({
          sessionId: "muse-child-bypass",
          steps: [
            script.tool("bash", { command: "echo main-ok" }),
            script.subagentStarted("reviewer", "critical helper"),
            script.tool("bash", { command: CRITICAL_COMMAND }, { fromSubagent: true }),
          ],
          outcome: script.success("looks clean", { usage: { inputTokens: 10, outputTokens: 2 } }),
        }),
      ],
      ["bypass_subagent_gate"],
    );
    const { hooks, gateActions } = criticalDenyingHooks();
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: repo.dir, role: museRole(["reviewer"]) }),
      hooks,
    );

    expect(gateActions).toEqual([{ tool: "bash", input: { command: "echo main-ok" } }]);
    expect(result.escalations).toEqual([]);
    const turn = dbl.recorder.turns.find((entry) => !entry.handshake)!;
    expect(turn.toolPlays[1]?.executed).toBe(true);
    expect(turn.toolPlays[1]?.consultations).toEqual([]);
    expect(() => checkEveryExecutedToolConsulted(turn)).toThrow(AdapterContractViolation);
    expect(() => checkEveryExecutedToolConsulted(turn)).toThrow(/ungated/);
  });

  it("mechanism evidence: with a live seam a child's critical op reaches the gate identically", async () => {
    repo = await makeTempGitRepo();
    const dbl = await double([
      script.turn({
        sessionId: "muse-child-gated",
        steps: [
          script.subagentStarted("reviewer", "critical helper"),
          script.tool("bash", { command: CRITICAL_COMMAND }, { fromSubagent: true }),
        ],
        outcome: script.success("recovered without the tool", { usage: { inputTokens: 10, outputTokens: 2 } }),
      }),
    ]);
    const { hooks, gateActions, events } = criticalDenyingHooks();
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: repo.dir, role: museRole(["reviewer"]) }),
      hooks,
    );

    // The child's action is normalized and classified exactly like a top-level
    // one, and the paired subagent lifecycle event carries the join spanId.
    expect(gateActions).toEqual([{ tool: "bash", input: { command: CRITICAL_COMMAND } }]);
    expect(result.status).toBe("blocked_on_gate");
    expect(events).toContainEqual(expect.objectContaining({ type: "subagent", phase: "started", spanId: "reviewer" }));
    const turn = dbl.recorder.turns.find((entry) => !entry.handshake)!;
    expect(turn.sequence).not.toContain("execute:bash");
    expect(() => checkEveryExecutedToolConsulted(turn)).not.toThrow();
    // Scripted evidence only. The live binary fired no hook at all, so this
    // mechanism remains UNPROVEN against the real product and the profile
    // keeps `intra_turn_fanout: unsupported`.
  });
});

// ---------------------------------------------------------------------------
// CF-B25-DEGRADE — grok claims intra_turn_fanout "unsupported", and unlike pi
// it has a fan-out tool it could otherwise reach. Declaring the surface absent
// is therefore not enough: the gate bridge must DENY spawn_subagent, so the
// tool never runs, the degradation note is visible, and fan-out stays zero.
// ---------------------------------------------------------------------------

const GROK_DEGRADATION_NOTE_REF = "grok-delegation/no-certified-fanout";

function checkGrokFanoutDegradationVisible(result: TurnResult): void {
  const note = result.artifacts.find((artifact) => artifact.ref === GROK_DEGRADATION_NOTE_REF);
  if (note === undefined || note.kind !== "note") {
    throw new AdapterContractViolation(
      "B-25 fanout-degradation",
      "delegation is configured but the completed turn carries no degradation note — " +
        "the uncertified fan-out surface was silently hidden",
    );
  }
  if (result.usage.subagentTurns !== 0) {
    throw new AdapterContractViolation(
      "B-25 fanout-degradation",
      `grok reported ${result.usage.subagentTurns} subagent turn(s) — intra-turn fan-out is ` +
        "uncertified on this harness and the adapter denies the spawn tool outright",
    );
  }
}

class SeededGrokDegradationLiar implements Runtime {
  readonly kind: Runtime["kind"];
  constructor(
    private readonly inner: Runtime,
    private readonly lie: "hide_degradation_note" | "fabricate_fanout",
  ) {
    this.kind = inner.kind;
  }
  async runTurn(...args: Parameters<Runtime["runTurn"]>): Promise<TurnResult> {
    const result = await this.inner.runTurn(...args);
    if (this.lie === "hide_degradation_note") {
      return { ...result, artifacts: result.artifacts.filter((a) => a.ref !== GROK_DEGRADATION_NOTE_REF) };
    }
    return { ...result, usage: { ...result.usage, subagentTurns: 3 } };
  }
}

describe("CF-B25-DEGRADE — grok fan-out uncertified: the spawn tool is denied, not merely undeclared", () => {
  const grokRole = (allow: string[]) =>
    doubleRole({ runtime: "grok", model: "grok-4.5", effort: "medium", delegation: { allow } });
  const scenario = (sessionId: string, steps?: ReturnType<typeof script.tool>[]) =>
    script.turn({
      sessionId,
      ...(steps === undefined ? {} : { steps }),
      outcome: script.success("done serially", { usage: { inputTokens: 100, outputTokens: 10 }, costUsd: 0.01 }),
    });

  it("delegation configured → degradation note, zero fan-out, no subagent events", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([scenario("grok-degrade")]);
    const { hooks, events } = criticalDenyingHooks();
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: repo.dir, role: grokRole(["scout"]) }),
      hooks,
    );
    expect(result.status).toBe("completed");
    expect(result.usage.subagentTurns).toBe(0);
    expect(events.filter((event) => event.type === "subagent")).toHaveLength(0);
    expect(() => checkGrokFanoutDegradationVisible(result)).not.toThrow();
  });

  it("an attempted spawn_subagent is denied at the gate bridge and never executes", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([
      scenario("grok-spawn-denied", [script.tool("spawn_subagent", { agent_type: "scout", task: "look" })]),
    ]);
    const { hooks, gateActions } = criticalDenyingHooks();
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: repo.dir, role: grokRole(["scout"]) }),
      hooks,
    );
    // The bridge refuses to classify an ungateable fan-out route, so the org
    // gate is never even asked to bless it — and grok is told "deny".
    expect(gateActions).toEqual([]);
    expect(dbl.recorder.turns[0]!.toolPlays[0]!.executed).toBe(false);
    expect(result.usage.subagentTurns).toBe(0);
    checkEveryExecutedToolConsulted(dbl.recorder.turns[0]!);
  });

  it("no delegation configured → no degradation note (the note is a signal, not noise)", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([scenario("grok-no-delegation")]);
    const { hooks } = criticalDenyingHooks();
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: grokRole([]) }), hooks);
    expect(result.status).toBe("completed");
    expect(result.artifacts).toEqual([]);
  });

  it("negative control: a runtime that hides the degradation note is caught", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([scenario("grok-degrade-hidden")]);
    const liar = new SeededGrokDegradationLiar(dbl.runtime, "hide_degradation_note");
    const { hooks } = criticalDenyingHooks();
    const result = await liar.runTurn(doubleTurnRequest({ workdir: repo.dir, role: grokRole(["scout"]) }), hooks);
    expect(result.status).toBe("completed");
    expect(() => checkGrokFanoutDegradationVisible(result)).toThrow(/silently hidden/);
  });

  it("negative control: a runtime that fabricates fan-out on the uncertified harness is caught", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([scenario("grok-degrade-fabricated")]);
    const liar = new SeededGrokDegradationLiar(dbl.runtime, "fabricate_fanout");
    const { hooks } = criticalDenyingHooks();
    const result = await liar.runTurn(doubleTurnRequest({ workdir: repo.dir, role: grokRole(["scout"]) }), hooks);
    expect(result.usage.subagentTurns).toBe(3);
    expect(() => checkGrokFanoutDegradationVisible(result)).toThrow(/denies the spawn tool outright/);
  });

  it("negative control: a transport that runs a subagent's shell call ungated is caught", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble(
      [
        script.turn({
          sessionId: "grok-subagent-bypass",
          steps: [script.tool("run_terminal_command", { command: CRITICAL_COMMAND }, { fromSubagent: true })],
          outcome: script.success("merged behind the gate", { usage: { inputTokens: 10, outputTokens: 2 } }),
        }),
      ],
      { violations: ["bypass_subagent_gate"] },
    );
    const { hooks, gateActions } = criticalDenyingHooks();
    await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, role: grokRole(["scout"]) }), hooks);
    expect(gateActions).toEqual([]);
    expect(() => checkEveryExecutedToolConsulted(dbl.recorder.turns[0]!)).toThrow(/INV-002 gate-before-execution/);
  });
});

describe("CF-B23-SUBGATE — subagent critical op reaches the gate identically (opencode, fan-out native)", () => {
  it("event → gate → escalation ordering matches a top-level critical op exactly", async () => {
    repo = await makeTempGitRepo();
    const topDouble = opencodeDouble([
      script.turn({
        sessionId: "ses_top",
        steps: [script.tool("bash", { command: CRITICAL_COMMAND })],
        outcome: script.success("recovered without the tool", {
          usage: { inputTokens: 10, outputTokens: 2 },
          costUsd: 0.01,
        }),
      }),
    ]);
    const subDouble = opencodeDouble([
      script.turn({
        sessionId: "ses_sub",
        steps: [
          script.tool("task", { description: "critical helper", subagent_type: "general", prompt: "go" }),
          script.tool("bash", { command: CRITICAL_COMMAND }, { fromSubagent: true }),
        ],
        outcome: script.success("recovered without the tool", {
          usage: { inputTokens: 10, outputTokens: 2 },
          costUsd: 0.01,
        }),
      }),
    ]);

    const topLevel = criticalDenyingHooks();
    const topResult = await topDouble.runtime.runTurn(opencodeDoubleRequest({ workdir: repo.dir }), topLevel.hooks);

    const subagent = criticalDenyingHooks(() => subDouble.recorder.turns.at(-1)?.sequence);
    const subResult = await subDouble.runtime.runTurn(opencodeDoubleRequest({ workdir: repo.dir }), subagent.hooks);

    // Identical settlement: the child session's call normalizes to the same
    // action, escalates identically, and never executes.
    expect(topResult.status).toBe("blocked_on_gate");
    expect(subResult.status).toBe("blocked_on_gate");
    expect(subagent.gateActions).toEqual(topLevel.gateActions);
    expect(subResult.escalations).toEqual(topResult.escalations);
    expect(subResult.escalations).toEqual([
      { action: { tool: "bash", input: { command: CRITICAL_COMMAND } }, reason: "critical op: merge (scripted)" },
    ]);

    const sequence = subDouble.recorder.turns[0]!.sequence;
    const spawnAt = sequence.indexOf("consult:hook:task");
    const consultAt = sequence.indexOf("consult:hook:bash");
    const gateAt = sequence.indexOf("org-gate:bash");
    const deniedAt = sequence.indexOf("denied:bash");
    expect(spawnAt).toBeGreaterThanOrEqual(0);
    expect(consultAt).toBeGreaterThan(spawnAt);
    expect(gateAt).toBeGreaterThan(consultAt);
    expect(deniedAt).toBeGreaterThan(gateAt);
    expect(sequence).not.toContain("execute:bash");
    expect(subagent.events.filter((event) => event.type === "tool_use")).toHaveLength(0);
    expect(subagent.events.filter((event) => event.type === "subagent")).toHaveLength(1);
    // Fan-out is never silent: the spawn is allowed at the bridge, so the
    // bridge is the only place it can be counted (INV-006).
    expect(subResult.usage.subagentTurns).toBe(1);
    expect(topResult.usage.subagentTurns).toBe(0);
    expect(() => checkEveryExecutedToolConsulted(subDouble.recorder.turns[0]!)).not.toThrow();
  });

  it("negative control: a plugin hook that stops firing inside child sessions is caught by the shared detector", async () => {
    repo = await makeTempGitRepo();
    const dbl = opencodeDouble(
      [
        script.turn({
          sessionId: "ses_sub_bypass",
          steps: [
            script.tool("bash", { command: "echo main-ok" }),
            script.tool("task", { description: "critical helper", subagent_type: "general", prompt: "go" }),
            script.tool("bash", { command: CRITICAL_COMMAND }, { fromSubagent: true }),
          ],
          outcome: script.success("looks clean", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
        }),
      ],
      { violations: ["bypass_subagent_gate"] },
    );
    const { hooks, gateActions } = criticalDenyingHooks();
    const result = await dbl.runtime.runTurn(opencodeDoubleRequest({ workdir: repo.dir }), hooks);

    expect(gateActions).toEqual([{ tool: "bash", input: { command: "echo main-ok" } }]);
    expect(result.status).toBe("completed");
    expect(result.escalations).toEqual([]);
    const turn = dbl.recorder.turns[0]!;
    expect(turn.toolPlays[2]?.executed).toBe(true);
    expect(turn.toolPlays[2]?.consultations).toEqual([]);
    expect(() => checkEveryExecutedToolConsulted(turn)).toThrow(AdapterContractViolation);
    expect(() => checkEveryExecutedToolConsulted(turn)).toThrow(/ungated/);
  });
});
