import { afterEach, describe, expect, it } from "vitest";
import { PiGateExtensionInactiveError, PiSessionResumeMismatchError } from "../../../src/runtime/adapters/pi.js";
import type { TurnEvent, TurnRequest } from "../../../src/runtime/types.js";
import { makeTempGitRepo, type TempGitRepo } from "../git-repo.js";
import { doubleRole, doubleTurnRequest } from "./claude-double.js";
import { piDouble } from "./pi-double.js";
import { checkEveryExecutedToolConsulted, script } from "./scenario.js";

const role = () => doubleRole({ runtime: "pi", model: "claude-scripted-model", maxTurnBudgetUsd: 5 });

describe("pi adapter double — core/T-11 conformance (HB-024)", () => {
  let repo: TempGitRepo | undefined;
  afterEach(async () => {
    await repo?.cleanup();
    repo = undefined;
  });

  async function request(overrides: Omit<Partial<TurnRequest>, "workdir"> = {}) {
    repo ??= await makeTempGitRepo();
    return doubleTurnRequest({ workdir: repo.dir, role: role(), ...overrides });
  }

  it("activates the exact gate extension before prompt; an allowed tool is classified once and emitted pre-execution", async () => {
    const events: TurnEvent[] = [];
    const dbl = piDouble([
      script.turn({
        sessionId: "pi-session-1",
        steps: [script.tool("bash", { command: "pwd" }, { channel: "hook" })],
        outcome: script.success("done", { usage: { inputTokens: 500, outputTokens: 50 }, costUsd: 0.2 }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(await request(), {
      gate: () => ({ allow: true }),
      onEvent: (event) => events.push(event),
    });
    expect(result).toMatchObject({ status: "completed", session: { runtime: "pi", id: "pi-session-1" } });
    expect(() => checkEveryExecutedToolConsulted(dbl.recorder.turns[0]!)).not.toThrow();
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_use" }));
    expect(events.find((event) => event.type === "tool_use")).not.toHaveProperty("success");
  });

  it("extension absence is a typed terminal refusal before session creation or any tool-capable prompt", async () => {
    const dbl = piDouble(
      [
        script.turn({
          sessionId: "pi-must-not-start",
          steps: [script.tool("bash", { command: "touch forbidden" })],
          outcome: script.success("must not run", { usage: "absent" }),
        }),
      ],
      { omitGateExtension: true },
    );
    await expect(dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) })).rejects.toBeInstanceOf(
      PiGateExtensionInactiveError,
    );
    expect(dbl.recorder.turns[0]).toMatchObject({ sessionReported: false, promptCalled: false });
  });

  it("resume must restore the exact requested session before prompt", async () => {
    const dbl = piDouble([
      script.turn({
        sessionId: "pi-different",
        outcome: script.success("must not run", { usage: "absent" }),
      }),
    ]);
    await expect(
      dbl.runtime.runTurn(await request({ session: { runtime: "pi", id: "pi-requested" } }), {
        gate: () => ({ allow: true }),
      }),
    ).rejects.toBeInstanceOf(PiSessionResumeMismatchError);
    expect(dbl.recorder.turns[0]).toMatchObject({ sessionReported: true, promptCalled: false, disposed: true });
  });

  it("provider-cost polling retains a single-jump overshoot and emits one incident note", async () => {
    const dbl = piDouble([
      script.turn({
        sessionId: "pi-budget",
        outcome: script.success("too expensive", {
          usage: { inputTokens: 20_000, outputTokens: 4_000 },
          costUsd: 5.4,
        }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    expect(result).toMatchObject({ status: "failed", errorCode: "error_max_budget_usd" });
    expect(result.usage.costUsd).toBe(5.4);
    expect(result.artifacts.filter((artifact) => artifact.ref.startsWith("budget-overrun/"))).toHaveLength(1);
  });

  it("auth rotation failure preserves the session and an exact retry resumes it", async () => {
    const failedScenario = script.turn({
      sessionId: "pi-rotation",
      outcome: script.failure("error_during_execution", ["401 authentication token rotated"], {
        usage: { inputTokens: 100, outputTokens: 5 },
        costUsd: 0.02,
      }),
    });
    const recoveredScenario = script.turn({
      sessionId: "pi-rotation",
      outcome: script.success("recovered", { usage: { inputTokens: 200, outputTokens: 10 }, costUsd: 0.03 }),
    });
    const dbl = piDouble([failedScenario, recoveredScenario]);
    const failed = await dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    expect(failed).toMatchObject({ status: "failed", errorCode: "error_auth", session: { id: "pi-rotation" } });
    const resumed = await dbl.runtime.runTurn(await request({ session: failed.session }), {
      gate: () => ({ allow: true }),
    });
    expect(resumed).toMatchObject({ status: "completed", session: { id: "pi-rotation" } });
  });

  it("negative control: an executed tool with its consultation erased makes the shared detector FIRE", async () => {
    const dbl = piDouble([
      script.turn({
        sessionId: "pi-neg",
        steps: [script.tool("bash", { command: "pwd" })],
        outcome: script.success("done", { usage: { inputTokens: 100, outputTokens: 10 }, costUsd: 0.01 }),
      }),
    ]);
    await dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    dbl.recorder.turns[0]!.toolPlays[0]!.consultations = [];
    expect(() => checkEveryExecutedToolConsulted(dbl.recorder.turns[0]!)).toThrow(/gate-before-execution/);
  });
});
