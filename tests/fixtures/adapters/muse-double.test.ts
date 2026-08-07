// CF-B26-* L1: the scripted `muse exec` transport speaks the vendor's real
// envelope shapes, and the REAL MuseRuntime honours CORMIDIA-C-CORE-001
// against it — including the fail-closed gate handshake that is the whole
// reason this harness ships with `tool_gate: unsupported`.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mapMuseEffort, museExecArgs } from "../../../src/runtime/adapters/muse-exec.js";
import { estimateMuseCostUsd, parseMuseSessionUsage } from "../../../src/runtime/adapters/muse-usage.js";
import {
  MuseAuthUnavailableError,
  MuseGateSeamUnavailableError,
  MuseSessionResumeMismatchError,
} from "../../../src/runtime/adapters/muse.js";
import type { TurnEvent, TurnRequest } from "../../../src/runtime/types.js";
import { doubleRole, doubleTurnRequest } from "./claude-double.js";
import { museDouble } from "./muse-double.js";
import { makeTempGitRepo, type TempGitRepo } from "../git-repo.js";
import {
  AdapterContractViolation,
  checkEveryExecutedToolConsulted,
  checkUsageAbsentRenderedUnknown,
  script,
} from "./scenario.js";

let repo: TempGitRepo | undefined;
let logRoot: string | undefined;

afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
  if (logRoot !== undefined) await rm(logRoot, { recursive: true, force: true });
  logRoot = undefined;
});

async function scratch(): Promise<{ workdir: string; sessionLogRoot: string }> {
  repo = await makeTempGitRepo();
  logRoot = await mkdtemp(join(tmpdir(), "cormidia-muse-log-"));
  return { workdir: repo.dir, sessionLogRoot: logRoot };
}

const role = () => doubleRole({ runtime: "muse", model: "muse-spark-1.2", maxTurnBudgetUsd: 5 });
const request = (workdir: string, overrides: Omit<Partial<TurnRequest>, "workdir"> = {}): TurnRequest =>
  doubleTurnRequest({ workdir, role: role(), ...overrides });
const allowAll = { gate: () => ({ allow: true }) as const };

describe("Muse adapter double — core conformance (B-26)", () => {
  it("maps durable session-log tokens to an honest ESTIMATED cost and preserves the muse session", async () => {
    const { workdir, sessionLogRoot } = await scratch();
    const dbl = museDouble(
      [
        script.turn({
          sessionId: "muse-session-1",
          outcome: script.success("done", { usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 400 } }),
        }),
      ],
      { sessionLogRoot },
    );
    const result = await dbl.runtime.runTurn(request(workdir), allowAll);
    expect(result).toMatchObject({ status: "completed", session: { runtime: "muse", id: "muse-session-1" } });
    expect(result.usage).toMatchObject({
      tokensIn: 1000,
      tokensInUncached: 600,
      cacheReadTokens: 400,
      tokensOut: 100,
      quality: "estimated",
      costEstimated: true,
    });
    // Documented list prices only — never an invented figure, never a zero.
    expect(result.usage.costUsd).toBeCloseTo(estimateMuseCostUsd(600, 400, 100), 10);
    expect(result.usage.costUsd).toBeGreaterThan(0);
  });

  it("the API key travels on stdin only — never argv, never the child environment", async () => {
    const { workdir, sessionLogRoot } = await scratch();
    const dbl = museDouble(
      [script.turn({ sessionId: "muse-key", outcome: script.success("ok", { usage: "absent" }) })],
      { sessionLogRoot, apiKey: "sk-scripted-secret" },
    );
    await dbl.runtime.runTurn(request(workdir), allowAll);
    for (const turn of dbl.recorder.turns) {
      expect(turn.argv.join(" ")).not.toContain("sk-scripted-secret");
      expect(JSON.stringify(turn.env)).not.toContain("sk-scripted-secret");
      for (const name of ["CORMIDIA_MUSE_API_KEY", "MUSE_API_KEY", "META_API_KEY"]) {
        expect(turn.env[name]).toBeUndefined();
      }
    }
    expect(dbl.recorder.turns.at(-1)?.apiKeyWritten).toBe(true);
    expect(
      museExecArgs({
        promptFile: "/tmp/p",
        workdir: "/tmp/w",
        model: "muse-spark-1.2",
        effort: "minimal",
        sessionId: "s",
      }),
    ).toContain("--api-key-stdin");
  });

  it("refuses before provider construction when no key is resolvable", async () => {
    const { workdir, sessionLogRoot } = await scratch();
    const dbl = museDouble([script.turn({ sessionId: "unused", outcome: script.success("x", { usage: "absent" }) })], {
      sessionLogRoot,
      apiKey: undefined,
    });
    await expect(dbl.runtime.runTurn(request(workdir), allowAll)).rejects.toBeInstanceOf(MuseAuthUnavailableError);
    expect(dbl.recorder.turns).toEqual([]);
  });

  it("usage absence is unavailable, never authoritative zero", async () => {
    const { workdir, sessionLogRoot } = await scratch();
    const scenario = script.turn({ sessionId: "muse-absent", outcome: script.success("done", { usage: "absent" }) });
    const honest = museDouble([scenario], { sessionLogRoot });
    const result = await honest.runtime.runTurn(request(workdir), allowAll);
    const observed = honest.recorder.turns.find((turn) => !turn.handshake)!;
    expect(() => checkUsageAbsentRenderedUnknown(observed, result)).not.toThrow();

    const liar = museDouble([scenario], {
      sessionLogRoot: `${sessionLogRoot}-liar`,
      violations: ["fabricate_zero_usage"],
    });
    const lied = await liar.runtime.runTurn(request(workdir), allowAll);
    const liedObserved = liar.recorder.turns.find((turn) => !turn.handshake)!;
    expect(() => checkUsageAbsentRenderedUnknown(liedObserved, lied)).toThrow(AdapterContractViolation);
  });

  it("resume binds the exact prior session or fails closed", async () => {
    const { workdir, sessionLogRoot } = await scratch();
    const dbl = museDouble(
      [script.turn({ sessionId: "muse-other", outcome: script.success("must not stand", { usage: "absent" }) })],
      { sessionLogRoot },
    );
    await expect(
      dbl.runtime.runTurn(request(workdir, { session: { runtime: "muse", id: "muse-requested" } }), allowAll),
    ).rejects.toBeInstanceOf(MuseSessionResumeMismatchError);
  });

  it("a gate-allowed tool is classified exactly once and its outcome is emitted", async () => {
    const { workdir, sessionLogRoot } = await scratch();
    const events: TurnEvent[] = [];
    const dbl = museDouble(
      [
        script.turn({
          sessionId: "muse-tool",
          steps: [script.tool("bash", { command: "pwd" }, { terminal: { success: true, durationMs: 3 } })],
          outcome: script.success("done", { usage: { inputTokens: 100, outputTokens: 10 } }),
        }),
      ],
      { sessionLogRoot },
    );
    await dbl.runtime.runTurn(request(workdir), { gate: () => ({ allow: true }), onEvent: (e) => events.push(e) });
    const observed = dbl.recorder.turns.find((turn) => !turn.handshake)!;
    expect(() => checkEveryExecutedToolConsulted(observed)).not.toThrow();
    expect(events.filter((event) => event.type === "tool_use").length).toBeGreaterThanOrEqual(1);
  });

  it("a denied critical op ends the turn blocked_on_gate with the escalation", async () => {
    const { workdir, sessionLogRoot } = await scratch();
    const dbl = museDouble(
      [
        script.turn({
          sessionId: "muse-deny",
          steps: [script.tool("bash", { command: "gh pr merge 42 --squash" })],
          outcome: script.success("recovered without the tool", { usage: { inputTokens: 10, outputTokens: 2 } }),
        }),
      ],
      { sessionLogRoot },
    );
    const result = await dbl.runtime.runTurn(request(workdir), {
      gate: (action) => ({ allow: false, reason: `critical op: ${action.tool}`, escalate: true }),
    });
    expect(result.status).toBe("blocked_on_gate");
    expect(result.escalations).toEqual([
      { action: { tool: "bash", input: { command: "gh pr merge 42 --squash" } }, reason: "critical op: bash" },
    ]);
    const observed = dbl.recorder.turns.find((turn) => !turn.handshake)!;
    expect(observed.sequence).not.toContain("execute:bash");
  });

  it("denies a nested `muse` invocation before the org gate ever sees it", async () => {
    const { workdir, sessionLogRoot } = await scratch();
    const seen: string[] = [];
    const dbl = museDouble(
      [
        script.turn({
          sessionId: "muse-nested",
          steps: [script.tool("bash", { command: "muse exec --yolo 'do it'" })],
          outcome: script.success("blocked", { usage: { inputTokens: 10, outputTokens: 2 } }),
        }),
      ],
      { sessionLogRoot },
    );
    const result = await dbl.runtime.runTurn(request(workdir), {
      gate: (action) => {
        seen.push(action.tool);
        return { allow: true };
      },
    });
    expect(seen).toEqual([]); // the org gate is never asked to allow a gate hole
    expect(result.status).toBe("blocked_on_gate");
    expect(result.escalations[0]?.reason).toContain("nested harness invocation");
  });

  it("effort maps 1:1 and `max` throws under the cross-adapter no-alias rule", () => {
    expect(mapMuseEffort("low")).toBe("low");
    expect(mapMuseEffort("xhigh")).toBe("xhigh");
    expect(() => mapMuseEffort("max")).toThrow(/effort max is unsupported/);
  });

  it("parses only real model_completed records; an unreadable line never becomes zero spend", () => {
    const usage = parseMuseSessionUsage(
      [
        "not json at all",
        JSON.stringify({
          payload: {
            event: { kind: "model_completed", usage: { input_tokens: 7, output_tokens: 2, cached_tokens: 1 } },
          },
        }),
      ].join("\n"),
      "s",
    );
    expect(usage).toMatchObject({ inputTokens: 7, outputTokens: 2, cachedTokens: 1 });
  });

  it("refuses the turn when the managed hook seam is dead — the observed 0.1.0 behaviour", async () => {
    const { workdir, sessionLogRoot } = await scratch();
    const dbl = museDouble(
      [script.turn({ sessionId: "never-runs", outcome: script.success("x", { usage: "absent" }) })],
      { sessionLogRoot, violations: ["dead_gate_seam"] },
    );
    await expect(dbl.runtime.runTurn(request(workdir), allowAll)).rejects.toBeInstanceOf(MuseGateSeamUnavailableError);
    // Only the token-free handshake ran; no paid turn was ever launched.
    expect(dbl.recorder.turns.map((turn) => turn.handshake)).toEqual([true]);
  });
});
