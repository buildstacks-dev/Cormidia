// HB-047 — S-9 format-repair contract: one bounded retry, same native
// session, and one durable execution/settlement per provider turn.

import { afterEach, describe, expect, it } from "vitest";
import { readEfficiencyEvidence } from "../../../src/loop/efficiency.js";
import { executePipeline } from "../../../src/loop/pipeline.js";
import { parseVerdictEither, parseWithRetry, VerdictParseError } from "../../../src/loop/verdicts.js";
import { readEnvelope } from "../../../src/runtime/runlog/envelope.js";
import { readEvents } from "../../../src/runtime/runlog/events.js";
import { readTurnRecords, settlementIdentity } from "../../../src/runtime/telemetry.js";
import { claudeDouble, doubleRole } from "../../fixtures/adapters/claude-double.js";
import { script } from "../../fixtures/adapters/scenario.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const homes: TempStateHome[] = [];
afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

describe("HB-047 format repair", () => {
  it("repairs exactly one structure in the same session and settles both turns exactly once", async () => {
    const home = await makeTempStateHome({ name: "format-repair" });
    homes.push(home);
    const scripted = claudeDouble([
      script.turn({
        sessionId: "session-format-1",
        outcome: script.success("I finished the work but omitted the required marker.", {
          usage: { inputTokens: 100, outputTokens: 20 },
          costUsd: 0.01,
          durationMs: 100,
        }),
      }),
      script.turn({
        sessionId: "session-format-1",
        outcome: script.success("Status: done", {
          usage: { inputTokens: 40, outputTokens: 5 },
          costUsd: 0.005,
          durationMs: 50,
        }),
      }),
    ]);
    const role = doubleRole({ name: "builder", maxTurnBudgetUsd: 5 });

    const result = await executePipeline({
      pipeline: {
        name: "format-contract",
        mechanical: false,
        passes: [{ id: "implement", role: "builder", template: "" }],
      },
      selection: { tier: "quick" },
      roles: { builder: role },
      runtimeFor: () => scripted.runtime,
      briefFor: () => "Perform deterministic fixture work and emit the required build verdict.",
      promptsDir: home.stateHome,
      context: { taste: [], memoryExcerpts: [] },
      workdir: home.stateHome,
      hooks: { gate: () => ({ allow: true }) as const },
      runlog: { root: home.stateHome, app: "app", traceId: "trace-format" },
      recordVerdict: async (ctx) => {
        try {
          const verdict = await parseWithRetry(
            "build",
            ctx.result.summary,
            async (reason) =>
              (
                await ctx.runProviderTurn({
                  operation: "build-verdict-reformat",
                  task: `Reformat only: ${reason}`,
                  session: ctx.result.session,
                })
              ).summary,
            (text) => parseVerdictEither("build", text),
          );
          await ctx.events.append({ type: "verdict.recorded", detail: { kind: "build", status: verdict.status } });
          return { ok: true } as const;
        } catch (error) {
          return { ok: false, errorCode: "error_verdict_unparseable", error: error as Error } as const;
        }
      },
    });

    expect(result).toMatchObject({ aborted: false });
    expect(result.passes).toHaveLength(1);
    expect(scripted.recorder.turns).toHaveLength(2);
    expect(scripted.recorder.turns[1]!.options.resume).toBe("session-format-1");

    const rows = await readTurnRecords(home.stateHome);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => settlementIdentity(row))).size).toBe(2);
    const evidence = await readEfficiencyEvidence(home.stateHome);
    const providerSteps = evidence.flatMap((episode) => episode.steps).filter((step) => step.kind === "provider");
    expect(providerSteps).toHaveLength(2);
    expect(providerSteps.map((step) => step.operation).sort()).toEqual([
      "build-verdict-reformat",
      "format-contract/implement",
    ]);

    const runId = result.passes[0]!.runId;
    const durable = await readEnvelope(home.stateHome, "app", runId);
    expect(durable.usage).toMatchObject({ tokens_in: 140, tokens_out: 25, cost_usd: 0.015 });
    const verdictEvents = (await readEvents(home.stateHome, "app", runId)).filter(
      (event) => event.event === "verdict.recorded",
    );
    expect(verdictEvents).toHaveLength(1);
  });

  it("caps an unrepaired structure at one retry and retains both rejected attempts", async () => {
    let calls = 0;
    const failure = await parseWithRetry(
      "build",
      "missing",
      async () => {
        calls += 1;
        return "still missing";
      },
      (text) => parseVerdictEither("build", text),
    ).catch((error: unknown) => error);
    expect(calls).toBe(1);
    expect(failure).toBeInstanceOf(VerdictParseError);
    expect((failure as VerdictParseError).attempts.map((attempt) => attempt.text)).toEqual([
      "missing",
      "still missing",
    ]);
  });
});
