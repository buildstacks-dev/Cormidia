import { afterEach, describe, expect, it } from "vitest";
import {
  ProviderBudgetRefusalError,
  admitEpisode,
  beginProviderStep,
  checkProviderBudget,
  finalizeProviderStep,
} from "../../../src/loop/efficiency.js";
import type { RoleConfig, TurnResult } from "../../../src/runtime/types.js";
import {
  createControlledWorld,
  FakeClock,
  type ControlledWorld,
} from "../../src/fixtures/controlled-world.js";

let world: ControlledWorld | undefined;

afterEach(async () => {
  await world?.cleanup();
  world = undefined;
});

const role: RoleConfig = {
  name: "builder",
  runtime: "pi",
  model: "controlled-model",
  effort: "low",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 0.8,
};

describe("C3 provider runaway and reservation conservation", () => {
  it("serializes concurrent reservations so in-flight exposure cannot exceed the cap", async () => {
    world = await createControlledWorld("layer-2-concurrent-reservations");
    const clock = new FakeClock();
    const episodeId = "controlled-concurrent-budget";
    await admitControlledEpisode(world.stateRoot, episodeId, clock.now());

    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        beginProviderStep({
          root: world!.stateRoot,
          episodeId,
          app: "sample-app",
          runId: `run-${index}`,
          ordinal: 1,
          operation: "controlled-build",
          role,
          inputFingerprint: `input-${index}`,
          now: clock.now(),
          next: { costUsd: 0.6, activeTimeMs: 100 },
        }),
      ),
    );

    const accepted = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof beginProviderStep>>> =>
        attempt.status === "fulfilled",
    );
    const refused = attempts.filter(
      (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected",
    );
    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(7);
    expect(
      refused.every((attempt) => attempt.reason instanceof ProviderBudgetRefusalError),
    ).toBe(true);

    const budget = await checkProviderBudget({
      root: world.stateRoot,
      episodeId,
      next: { costUsd: 0.5 },
    });
    expect(budget).toMatchObject({
      allowed: false,
      errorCode: "error_route_budget_exhausted",
      exposure: {
        capUsd: 1,
        settledUsd: 0,
        reservedUsd: 0.6,
        requestedUsd: 0.5,
      },
    });
  });

  it("blocks the next turn after a billion-unit usage/cost overrun is recorded truthfully", async () => {
    world = await createControlledWorld("layer-2-billion-usage");
    const clock = new FakeClock();
    const episodeId = "controlled-billion-usage";
    await admitControlledEpisode(world.stateRoot, episodeId, clock.now());
    const started = await beginProviderStep({
      root: world.stateRoot,
      episodeId,
      app: "sample-app",
      runId: "run-billion",
      ordinal: 1,
      operation: "controlled-build",
      role,
      inputFingerprint: "billion-input",
      now: clock.now(),
      next: { costUsd: 0.5, activeTimeMs: 100 },
    });
    const result: TurnResult = {
      status: "completed",
      summary: "provider reported an extreme overrun",
      artifacts: [],
      session: { runtime: "pi", id: "controlled-session" },
      usage: {
        tokensIn: 1_000_000_000,
        tokensOut: 1_000_000_000,
        costUsd: 1_000_000_000,
        subagentTurns: 0,
        wallClockMs: 100,
        quality: "complete",
      },
      escalations: [],
    };
    await finalizeProviderStep({
      root: world.stateRoot,
      episodeId,
      app: "sample-app",
      runId: "run-billion",
      started,
      operation: "controlled-build",
      role,
      result,
      finishedAt: clock.advanceMs(100),
      contextManifestRef: "controlled-context.json",
      artifactFingerprint: "extreme-overrun-evidence",
    });

    const budget = await checkProviderBudget({ root: world.stateRoot, episodeId });
    expect(budget).toMatchObject({
      allowed: false,
      errorCode: "error_route_budget_exhausted",
      counters: {
        provider_turns: 1,
        input_tokens: 1_000_000_000,
        output_tokens: 1_000_000_000,
        equivalent_cost_usd: 1_000_000_000,
      },
    });
    await expect(
      beginProviderStep({
        root: world.stateRoot,
        episodeId,
        app: "sample-app",
        runId: "run-after-overrun",
        ordinal: 1,
        operation: "must-not-start",
        role,
        inputFingerprint: "after-overrun",
        now: clock.now(),
        next: { costUsd: 0.01, activeTimeMs: 1 },
      }),
    ).rejects.toMatchObject({
      name: "ProviderBudgetRefusalError",
      errorCode: "error_route_budget_exhausted",
    });
  });

  it("treats partial usage as unmeasured and refuses another provider turn", async () => {
    world = await createControlledWorld("layer-2-partial-usage");
    const clock = new FakeClock();
    const episodeId = "controlled-partial-usage";
    await admitControlledEpisode(world.stateRoot, episodeId, clock.now());
    const started = await beginProviderStep({
      root: world.stateRoot,
      episodeId,
      app: "sample-app",
      runId: "run-partial",
      ordinal: 1,
      operation: "controlled-build",
      role,
      inputFingerprint: "partial-input",
      now: clock.now(),
      next: { costUsd: 0.25, activeTimeMs: 100 },
    });
    await finalizeProviderStep({
      root: world.stateRoot,
      episodeId,
      app: "sample-app",
      runId: "run-partial",
      started,
      operation: "controlled-build",
      role,
      result: {
        status: "timed_out",
        summary: "usage observation was partial",
        artifacts: [],
        session: { runtime: "pi", id: "controlled-session" },
        usage: {
          tokensIn: 10,
          tokensOut: 1,
          costUsd: 0.1,
          subagentTurns: 0,
          wallClockMs: 100,
          quality: "partial",
        },
        escalations: [],
        errorCode: "error_usage_partial",
      },
      finishedAt: clock.advanceMs(100),
      contextManifestRef: "controlled-context.json",
    });

    expect(await checkProviderBudget({ root: world.stateRoot, episodeId })).toMatchObject({
      allowed: false,
      errorCode: "error_route_budget_unmeasured",
    });
  });
});

async function admitControlledEpisode(
  root: string,
  episodeId: string,
  now: Date,
): Promise<void> {
  await admitEpisode({
    root,
    episodeId,
    app: "sample-app",
    route: "quick",
    policyVersion: "controlled-c3",
    factors: [
      {
        kind: "blast_radius",
        evidence: "isolated controlled world",
        policy_rule: "controlled-c3",
      },
    ],
    passes: [
      {
        pipeline: "controlled",
        pass: "build",
        role: role.name,
        runtime: role.runtime,
        model: role.model,
        effort: role.effort,
        factor_rules: ["controlled-c3"],
      },
    ],
    now,
    budgetOverrides: {
      provider_turns: 3,
      equivalent_cost_usd: 1,
      active_time_ms: 1_000,
      human_decisions: 0,
    },
  });
}
