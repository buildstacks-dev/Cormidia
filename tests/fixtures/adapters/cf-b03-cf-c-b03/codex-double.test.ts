// CF-B03 (HB-051) + CF-C-B03 (HB-024) — boundary-map.md B-03 and
// contracts/B-03-codex.md: scripted Codex adapter/contract conformance.

import { afterEach, describe, expect, it } from "vitest";
import { CodexSessionResumeMismatchError } from "../../../../src/runtime/adapters/codex.js";
import { EPISODE_PLAN_PROPOSAL_SCHEMA } from "../../../../src/loop/episode-plan.js";
import type { TurnEvent, TurnRequest } from "../../../../src/runtime/types.js";
import { doubleRole, doubleTurnRequest } from "../claude-double.js";
import { codexDouble } from "../codex-double.js";
import {
  AdapterContractViolation,
  checkEveryExecutedToolConsulted,
  checkUsageAbsentRenderedUnknown,
  script,
} from "../scenario.js";
import { makeTempStateHome, type TempStateHome } from "../../state-home.js";

const role = () => doubleRole({ runtime: "codex", model: "gpt-5.6-sol", maxTurnBudgetUsd: 5 });

describe("Codex adapter double — core/T-11 conformance (HB-024)", () => {
  let state: TempStateHome | undefined;
  afterEach(async () => {
    await state?.cleanup();
    state = undefined;
  });

  async function request(overrides: Omit<Partial<TurnRequest>, "workdir"> = {}) {
    state ??= await makeTempStateHome({ name: "codex-double" });
    return doubleTurnRequest({ workdir: state.stateHome, role: role(), ...overrides });
  }

  it("maps token notifications to estimated usage and preserves the provider thread", async () => {
    const dbl = codexDouble([
      script.turn({
        sessionId: "thread-codex-1",
        outcome: script.success("done", { usage: { inputTokens: 1000, outputTokens: 100 }, costUsd: 0 }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    expect(result).toMatchObject({ status: "completed", session: { runtime: "codex", id: "thread-codex-1" } });
    expect(result.usage).toMatchObject({ tokensIn: 1000, tokensOut: 100, quality: "estimated", costEstimated: true });
  });

  it("translates the canonical episode-plan schema into Codex's strict dialect at the provider boundary", async () => {
    const dbl = codexDouble([
      script.turn({
        sessionId: "thread-codex-schema",
        outcome: script.success("{}", { usage: { inputTokens: 10, outputTokens: 1 } }),
      }),
    ]);
    await dbl.runtime.runTurn(
      await request({ verdictSchema: EPISODE_PLAN_PROPOSAL_SCHEMA as unknown as Record<string, unknown> }),
      { gate: () => ({ allow: true }) },
    );

    const turnStart = dbl.recorder.turns[0]!.requests.find((entry) => entry.method === "turn/start");
    expect(turnStart).toBeDefined();
    const schema = (turnStart!.params as { outputSchema: Record<string, unknown> }).outputSchema;
    const properties = schema["properties"] as Record<string, Record<string, unknown>>;
    expect(schema["$schema"]).toBeUndefined();
    expect(properties["schemaVersion"]).toEqual({ enum: [1], type: "integer" });
    expect(properties["planningSource"]).toMatchObject({ type: "string" });
    expect(properties["creatorProvenance"]?.["type"]).toEqual(["object", "null"]);

    const stepItems = properties["steps"]?.["items"] as Record<string, unknown>;
    expect(stepItems["oneOf"]).toBeUndefined();
    const alternatives = stepItems["anyOf"] as Array<Record<string, unknown>>;
    expect(alternatives.length).toBeGreaterThan(1);
    for (const alternative of alternatives) {
      const stepProperties = alternative["properties"] as Record<string, Record<string, unknown>>;
      expect(alternative["required"]).toEqual(Object.keys(stepProperties));
      expect(stepProperties["kind"]?.["type"]).toBe("string");
    }
  });

  it("usage absence is unavailable, never authoritative zero; its seeded envelope lie is detected", async () => {
    const scenario = script.turn({
      sessionId: "thread-codex-absent",
      outcome: script.success("done", { usage: "absent" }),
    });
    const honest = codexDouble([scenario]);
    const result = await honest.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    expect(() => checkUsageAbsentRenderedUnknown(honest.recorder.turns[0]!, result)).not.toThrow();

    const liar = codexDouble([scenario], { violations: ["fabricate_zero_usage"] });
    const lied = await liar.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    expect(() => checkUsageAbsentRenderedUnknown(liar.recorder.turns[0]!, lied)).toThrow(AdapterContractViolation);
  });

  it("resume must restore the exact requested thread before turn/start", async () => {
    const dbl = codexDouble([
      script.turn({
        sessionId: "thread-different",
        outcome: script.success("must not run", { usage: "absent" }),
      }),
    ]);
    await expect(
      dbl.runtime.runTurn(await request({ session: { runtime: "codex", id: "thread-requested" } }), {
        gate: () => ({ allow: true }),
      }),
    ).rejects.toBeInstanceOf(CodexSessionResumeMismatchError);
    expect(dbl.recorder.turns[0]!.requests.map((entry) => entry.method)).not.toContain("turn/start");
  });

  it("rotation auth loss preserves the checkpoint, and an exact-session retry resumes rather than restarts", async () => {
    const recovery = script.turn({
      sessionId: "thread-rotation",
      outcome: script.success("recovered", { usage: { inputTokens: 300, outputTokens: 20 } }),
    });
    const dbl = codexDouble([{ ...recovery, rotation: "auth_loss" }, recovery]);
    const failed = await dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    expect(failed).toMatchObject({ status: "failed", errorCode: "error_auth", session: { id: "thread-rotation" } });
    const resumed = await dbl.runtime.runTurn(await request({ session: failed.session }), {
      gate: () => ({ allow: true }),
    });
    expect(resumed.status).toBe("completed");
    expect(dbl.recorder.turns[1]!.requests.map((entry) => entry.method)).toContain("thread/resume");
  });

  it("protocol-valid stale capabilities are a distinguished terminal failure", async () => {
    const dbl = codexDouble([
      {
        ...script.turn({ sessionId: "thread-stale", outcome: script.success("unused", { usage: "absent" }) }),
        rotation: "stale_capabilities",
      },
    ]);
    const result = await dbl.runtime.runTurn(await request(), { gate: () => ({ allow: true }) });
    expect(result).toMatchObject({ status: "failed", errorCode: "error_protocol_stale_capabilities" });
  });

  it("permission-backed command execution is gate-classified once and emits Codex outcome fields", async () => {
    const events: TurnEvent[] = [];
    const dbl = codexDouble([
      script.turn({
        sessionId: "thread-tool",
        steps: [
          script.tool(
            "Bash",
            { command: "pwd" },
            { channel: "permission", terminal: { success: true, durationMs: 17 } },
          ),
        ],
        outcome: script.success("done", { usage: { inputTokens: 100, outputTokens: 10 } }),
      }),
    ]);
    await dbl.runtime.runTurn(await request(), {
      gate: () => ({ allow: true }),
      onEvent: (event) => events.push(event),
    });
    expect(() => checkEveryExecutedToolConsulted(dbl.recorder.turns[0]!)).not.toThrow();
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_use", success: true, durationMs: 17 }));
  });
});
