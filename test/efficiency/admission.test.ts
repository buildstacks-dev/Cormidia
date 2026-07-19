import { existsSync, writeFileSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  admitEpisode,
  beginProviderStep,
  checkProviderBudget,
  deriveEpisodeCounters,
  efficiencyEpisodeDir,
  finalizeEpisode,
  finalizeProviderStep,
  ProviderBudgetRefusalError,
  recordMechanicalStep,
  readRouteRecord,
  reassessEpisode,
  routeRecordPath,
  type AdmissionFactor,
  type AuthorizedPass,
} from "../../src/loop/efficiency.js";
import { executePipeline } from "../../src/loop/pipeline.js";
import type { PipelineConfig } from "../../src/loop/pipelines.js";
import type { RoleConfig, Runtime, TurnResult } from "../../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

const ROLE: RoleConfig = {
  name: "builder",
  runtime: "codex",
  model: "gpt-test",
  effort: "medium",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 5,
};
const FACTOR: AdmissionFactor = {
  kind: "uncertainty",
  evidence: "operator classified the bounded fixture",
  policy_rule: "fixture_route",
};
const PASS: AuthorizedPass = {
  pipeline: "build",
  pass: "implement",
  role: ROLE.name,
  runtime: ROLE.runtime,
  model: ROLE.model,
  effort: ROLE.effort,
  factor_rules: [FACTOR.policy_rule],
};
const PIPELINE: PipelineConfig = {
  name: "build",
  mechanical: false,
  passes: [{ id: "implement", role: ROLE.name, template: "pass.md" }],
};

describe("efficiency route admission", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("B-ADM-01 commits the route before runtime construction", async () => {
    home = makeOrgHome();
    const prompts = join(home.root, "prompts");
    await mkdir(prompts, { recursive: true });
    writeFileSync(join(prompts, "pass.md"), "Implement.");
    const episodeId = "episode:admission-order";
    let constructed = false;
    const runtime: Runtime = { kind: "codex", runTurn: async () => result() };
    await executePipeline({
      pipeline: PIPELINE,
      selection: { tier: "quick" },
      roles: { builder: ROLE },
      runtimeFor: () => {
        expect(existsSync(routeRecordPath(home.root, episodeId))).toBe(true);
        constructed = true;
        return runtime;
      },
      briefFor: () => "bounded task",
      promptsDir: prompts,
      context: { taste: [], memoryExcerpts: [] },
      workdir: home.root,
      hooks: { gate: () => ({ allow: true }) },
      runlog: { root: home.root, app: "fixture", traceId: "trace-1" },
      episode: {
        id: episodeId,
        route: "quick",
        factors: [FACTOR],
        authorizedPasses: [PASS],
      },
      clock: () => new Date("2026-07-13T00:00:00.000Z"),
    });
    expect(constructed).toBe(true);
  });

  it("B-ADM-02 rejects an additional pass not mapped to a recorded factor rule", async () => {
    home = makeOrgHome();
    await expect(admitEpisode({
      root: home.root,
      episodeId: "episode:bad-factor",
      app: "fixture",
      route: "standard",
      policyVersion: "test/v1",
      factors: [FACTOR],
      passes: [{ ...PASS, factor_rules: ["role_available"] }],
      now: new Date("2026-07-13T00:00:00.000Z"),
    })).rejects.toThrow("must map only to recorded factor rules");
  });

  it("B-ADM-01 makes concurrent conflicting admission first-writer-wins", async () => {
    home = makeOrgHome();
    const episodeId = "episode:concurrent-admission";
    const attempts = await Promise.allSettled([
      admitEpisode({
        root: home.root,
        episodeId,
        app: "fixture",
        route: "quick",
        policyVersion: "test/v1",
        factors: [FACTOR],
        passes: [PASS],
        now: new Date("2026-07-13T00:00:00.000Z"),
      }),
      admitEpisode({
        root: home.root,
        episodeId,
        app: "fixture",
        route: "standard",
        policyVersion: "test/v1",
        factors: [FACTOR],
        passes: [PASS],
        now: new Date("2026-07-13T00:00:00.000Z"),
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect((await readRouteRecord(home.root, episodeId)).planned_route).toMatch(/quick|standard/);
  });

  it("F-SET-01 terminalizes a started pass when pre-provider evidence writing fails", async () => {
    home = makeOrgHome();
    const episodeId = "episode:pre-provider-failure";
    await admission(home.root, episodeId);
    writeFileSync(join(efficiencyEpisodeDir(home.root, episodeId), "context"), "blocks directory creation");
    const prompts = join(home.root, "prompts");
    await mkdir(prompts, { recursive: true });
    writeFileSync(join(prompts, "pass.md"), "Implement.");
    let constructed = false;
    await expect(executePipeline({
      pipeline: PIPELINE,
      selection: { tier: "quick" },
      roles: { builder: ROLE },
      runtimeFor: () => {
        constructed = true;
        return { kind: "codex", runTurn: async () => result() };
      },
      briefFor: () => "bounded task",
      promptsDir: prompts,
      context: { taste: [], memoryExcerpts: [] },
      workdir: home.root,
      hooks: { gate: () => ({ allow: true }) },
      runlog: { root: home.root, app: "fixture", traceId: "trace-pre-provider-failure" },
      episode: { id: episodeId, route: "quick", finalize: false },
      clock: () => new Date("2026-07-13T00:00:00.000Z"),
    })).rejects.toThrow();
    expect(constructed).toBe(false);
    const [runId] = await readdir(join(home.root, "runs", "fixture"));
    const envelope = JSON.parse(
      await readFile(join(home.root, "runs", "fixture", runId!, "envelope.json"), "utf8"),
    ) as { status: string; error_code?: string };
    expect(envelope).toMatchObject({ status: "failed", error_code: "error_pass_executor" });
  });

  it("B-ADM-04 gives deterministic episodes a zero-provider budget", async () => {
    home = makeOrgHome();
    const episodeId = "episode:deterministic";
    await admitEpisode({
      root: home.root,
      episodeId,
      app: "fixture",
      route: "deterministic",
      policyVersion: "test/v1",
      factors: [{
        kind: "evidence_quality",
        evidence: "the operation is fully mechanical",
        policy_rule: "mechanical_only",
      }],
      passes: [],
      now: new Date("2026-07-13T00:00:00.000Z"),
    });
    await expect(checkProviderBudget({ root: home.root, episodeId })).resolves.toMatchObject({
      allowed: false,
      remaining: { provider_turns: 0, input_tokens: 0, equivalent_cost_usd: 0 },
      reason: "provider-turn budget exhausted",
    });
  });

  it("B-ADM-03 derives monotonic counters after restart and ignores a torn foreign append", async () => {
    home = makeOrgHome();
    const episodeId = "episode:counters";
    await admission(home.root, episodeId);
    const started = await beginProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "run-1",
      ordinal: 1,
      operation: "build/implement",
      role: ROLE,
      inputFingerprint: "input-1",
      now: new Date("2026-07-13T00:00:00.000Z"),
    });
    await finalizeProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "run-1",
      started,
      operation: "build/implement",
      role: ROLE,
      result: result({ tokensIn: 12, tokensOut: 3, costUsd: 0.25 }),
      finishedAt: new Date("2026-07-13T00:00:01.000Z"),
      contextManifestRef: "context-manifest.json",
    });
    const steps = join(home.root, "efficiency", "episodes");
    const episodeDir = efficiencyEpisodeDir(home.root, episodeId);
    writeFileSync(join(episodeDir, "steps", "torn.json"), "{not-json");
    expect(existsSync(steps)).toBe(true);
    const first = await deriveEpisodeCounters(home.root, episodeId);
    const restarted = await deriveEpisodeCounters(home.root, episodeId);
    expect(first).toEqual(restarted);
    expect(first).toMatchObject({ provider_turns: 1, input_tokens: 12, output_tokens: 3, equivalent_cost_usd: 0.25 });
    await expect(checkProviderBudget({ root: home.root, episodeId })).resolves.toMatchObject({
      allowed: false,
      reason: "corrupt provider reservation prevents safe admission",
    });
  });

  it("B-ADM-04 refuses before another provider turn when remaining allowance is insufficient", async () => {
    home = makeOrgHome();
    const episodeId = "episode:budget";
    await admission(home.root, episodeId);
    for (let ordinal = 1; ordinal <= 3; ordinal++) {
      const started = await beginProviderStep({
        root: home.root,
        episodeId,
        app: "fixture",
        runId: `run-${ordinal}`,
        ordinal: 1,
        operation: "build/implement",
        role: ROLE,
        inputFingerprint: `input-${ordinal}`,
        now: new Date(`2026-07-13T00:00:0${ordinal}.000Z`),
      });
      await finalizeProviderStep({
        root: home.root,
        episodeId,
        app: "fixture",
        runId: `run-${ordinal}`,
        started,
        operation: "build/implement",
        role: ROLE,
        result: result(),
        finishedAt: new Date(`2026-07-13T00:00:0${ordinal}.500Z`),
        contextManifestRef: "context-manifest.json",
      });
    }
    await expect(checkProviderBudget({ root: home.root, episodeId })).resolves.toMatchObject({
      allowed: false,
      reason: "provider-turn budget exhausted",
    });
    const prompts = join(home.root, "prompts");
    await mkdir(prompts, { recursive: true });
    writeFileSync(join(prompts, "pass.md"), "Implement.");
    let constructed = false;
    const stopped = await executePipeline({
      pipeline: PIPELINE,
      selection: { tier: "quick" },
      roles: { builder: ROLE },
      runtimeFor: () => {
        constructed = true;
        throw new Error("provider factory must not be reached");
      },
      briefFor: () => "bounded task",
      promptsDir: prompts,
      context: { taste: [], memoryExcerpts: [] },
      workdir: home.root,
      hooks: { gate: () => ({ allow: true }) },
      runlog: { root: home.root, app: "fixture", traceId: "trace-budget" },
      episode: { id: episodeId, route: "quick", finalize: false },
      clock: () => new Date("2026-07-13T00:01:00.000Z"),
    });
    expect(constructed).toBe(false);
    expect(stopped.passes[0]?.result).toMatchObject({
      status: "blocked_on_gate",
      errorCode: "error_route_budget_exhausted",
    });
  });

  it("B-ADM-04 atomically reserves a concurrent provider-turn allowance", async () => {
    home = makeOrgHome();
    const episodeId = "episode:concurrent-budget";
    await admission(home.root, episodeId);
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) => beginProviderStep({
        root: home.root,
        episodeId,
        app: "fixture",
        runId: `concurrent-${index}`,
        ordinal: 1,
        operation: "build/implement",
        role: ROLE,
        inputFingerprint: `concurrent-input-${index}`,
        now: new Date("2026-07-13T00:00:00.000Z"),
      })),
    );
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(2);
    const refusals = attempts.filter(
      (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected",
    );
    expect(refusals).toHaveLength(6);
    expect(refusals.every((attempt) => attempt.reason instanceof ProviderBudgetRefusalError)).toBe(true);
    await expect(checkProviderBudget({ root: home.root, episodeId })).resolves.toMatchObject({
      allowed: false,
      counters: { provider_turns: 2, equivalent_cost_usd: 8 },
      reason: "equivalent-cost budget exhausted",
    });
  });

  it("B-ADM-04 reserves concurrent token, cost, and active-time estimates", async () => {
    home = makeOrgHome();
    const episodeId = "episode:concurrent-cost";
    await admission(home.root, episodeId);
    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, (_, index) => beginProviderStep({
        root: home.root,
        episodeId,
        app: "fixture",
        runId: `cost-${index}`,
        ordinal: 1,
        operation: "build/implement",
        role: ROLE,
        inputFingerprint: `cost-input-${index}`,
        next: { inputTokens: 750_000, costUsd: 3, activeTimeMs: 5 * 60_000 },
        now: new Date("2026-07-13T00:00:00.000Z"),
      })),
    );
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(2);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(2);
    await expect(checkProviderBudget({ root: home.root, episodeId })).resolves.toMatchObject({
      counters: {
        provider_turns: 2,
        input_tokens: 1_500_000,
        equivalent_cost_usd: 6,
        active_time_ms: 10 * 60_000,
      },
    });
  });

  it("B-ADM-06 admits just-under and exact-cap exposure but rejects a near-miss over the cap", async () => {
    home = makeOrgHome();
    const episodeId = "episode:cost-boundaries";
    await admission(home.root, episodeId);

    await expect(checkProviderBudget({
      root: home.root,
      episodeId,
      next: { costUsd: 7.9999 },
    })).resolves.toMatchObject({ allowed: true });
    await expect(checkProviderBudget({
      root: home.root,
      episodeId,
      next: { costUsd: 8 },
    })).resolves.toMatchObject({ allowed: true, remaining: { equivalent_cost_usd: 8 } });
    await expect(checkProviderBudget({
      root: home.root,
      episodeId,
      next: { costUsd: 8.0001 },
    })).resolves.toMatchObject({
      allowed: false,
      errorCode: "error_route_budget_exhausted",
      reason: "declared equivalent-cost allowance is insufficient",
      exposure: { capUsd: 8, settledUsd: 0, reservedUsd: 0, requestedUsd: 8.0001 },
    });
  });

  it("B-ADM-06 refuses a would-exceed turn with complete cost and denied-step evidence", async () => {
    home = makeOrgHome();
    const episodeId = "episode:would-exceed";
    await admission(home.root, episodeId);
    const spent = await beginProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "spent",
      ordinal: 1,
      operation: "build/contract",
      role: ROLE,
      inputFingerprint: "spent-input",
      next: { costUsd: 4.5 },
      now: new Date("2026-07-13T00:00:00.000Z"),
    });
    await finalizeProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "spent",
      started: spent,
      operation: "build/contract",
      role: ROLE,
      result: result({ costUsd: 4.5 }),
      finishedAt: new Date("2026-07-13T00:00:01.000Z"),
      contextManifestRef: "context-manifest.json",
    });

    const denied = beginProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "denied",
      ordinal: 1,
      operation: "build/implement",
      role: ROLE,
      inputFingerprint: "denied-input",
      next: { costUsd: 4 },
      now: new Date("2026-07-13T00:00:02.000Z"),
    });
    await expect(denied).rejects.toMatchObject({
      errorCode: "error_route_budget_exhausted",
      message: expect.stringMatching(
        /cap=\$8\.0000, settled=\$4\.5000, reserved=\$0\.0000, requested=\$4\.0000, denied_step=build\/implement/,
      ),
    });
  });

  it("B-ADM-06 replaces a reservation with settlement atomically and never double-reserves a retry", async () => {
    home = makeOrgHome();
    const episodeId = "episode:settlement-race";
    await admission(home.root, episodeId);
    const first = await beginProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "first",
      ordinal: 1,
      operation: "build/contract",
      role: ROLE,
      inputFingerprint: "first-input",
      now: new Date("2026-07-13T00:00:00.000Z"),
    });
    await beginProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "second",
      ordinal: 1,
      operation: "build/implement",
      role: ROLE,
      inputFingerprint: "second-input",
      now: new Date("2026-07-13T00:00:00.000Z"),
    });

    const racingRetry = beginProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "retry",
      ordinal: 1,
      operation: "build/retry",
      role: ROLE,
      inputFingerprint: "retry-input",
      now: new Date("2026-07-13T00:00:01.000Z"),
    });
    const settlement = finalizeProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "first",
      started: first,
      operation: "build/contract",
      role: ROLE,
      result: result({ costUsd: 1 }),
      finishedAt: new Date("2026-07-13T00:00:01.000Z"),
      contextManifestRef: "context-manifest.json",
    });
    const [retryOutcome] = await Promise.allSettled([racingRetry, settlement]);
    const retry = retryOutcome.status === "fulfilled"
      ? retryOutcome.value
      : await beginProviderStep({
          root: home.root,
          episodeId,
          app: "fixture",
          runId: "retry-after-settlement",
          ordinal: 1,
          operation: "build/retry",
          role: ROLE,
          inputFingerprint: "retry-after-settlement-input",
          now: new Date("2026-07-13T00:00:02.000Z"),
        });
    if (retryOutcome.status === "rejected") {
      expect(retryOutcome.reason).toBeInstanceOf(ProviderBudgetRefusalError);
    }
    expect(retry.reservation.equivalentCostUsd).toBe(4);
    const checked = await checkProviderBudget({ root: home.root, episodeId });
    expect(checked.counters.equivalent_cost_usd).toBe(8);
    expect(checked.counters.provider_turns).toBe(3);
    expect(checked.exposure.settledUsd + checked.exposure.reservedUsd).toBe(8);
  });

  it("B-ADM-06 fails closed when settled provider usage is unavailable", async () => {
    home = makeOrgHome();
    const episodeId = "episode:unknown-usage";
    await admission(home.root, episodeId);
    const started = await beginProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "unknown",
      ordinal: 1,
      operation: "build/implement",
      role: ROLE,
      inputFingerprint: "unknown-input",
      now: new Date("2026-07-13T00:00:00.000Z"),
    });
    await finalizeProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "unknown",
      started,
      operation: "build/implement",
      role: ROLE,
      result: result({ costUsd: 0, quality: "unavailable" }),
      finishedAt: new Date("2026-07-13T00:00:01.000Z"),
      contextManifestRef: "context-manifest.json",
    });

    await expect(checkProviderBudget({ root: home.root, episodeId })).resolves.toMatchObject({
      allowed: false,
      errorCode: "error_route_budget_unmeasured",
      reason: expect.stringContaining("partial or unavailable"),
    });
    await expect(beginProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "after-unknown",
      ordinal: 1,
      operation: "build/retry",
      role: ROLE,
      inputFingerprint: "after-unknown-input",
      now: new Date("2026-07-13T00:00:02.000Z"),
    })).rejects.toMatchObject({ errorCode: "error_route_budget_unmeasured" });
  });

  it("B-ADM-06 keeps mechanical steps outside provider-turn and equivalent-cost accounting", async () => {
    home = makeOrgHome();
    const episodeId = "episode:mechanical-zero-cost";
    await admission(home.root, episodeId);
    await recordMechanicalStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "mechanical",
      operation: "quality-gates",
      startedAt: new Date("2026-07-13T00:00:00.000Z"),
      finishedAt: new Date("2026-07-13T00:00:01.000Z"),
      status: "completed",
      reason: "offline checks passed",
      inputFingerprint: "mechanical-input",
    });
    await expect(checkProviderBudget({ root: home.root, episodeId })).resolves.toMatchObject({
      allowed: true,
      counters: { provider_turns: 0, equivalent_cost_usd: 0 },
      remaining: { provider_turns: 3, equivalent_cost_usd: 8 },
    });
  });

  it("B-ADM-06 clamps runtime construction to remaining route exposure and stops estimation overrun", async () => {
    home = makeOrgHome();
    const prompts = join(home.root, "prompts");
    await mkdir(prompts, { recursive: true });
    writeFileSync(join(prompts, "pass.md"), "Implement.");
    let admittedCap: number | undefined;
    const stopped = await executePipeline({
      pipeline: PIPELINE,
      selection: { tier: "quick" },
      roles: { builder: { ...ROLE, maxTurnBudgetUsd: 15 } },
      runtimeFor: (admittedRole) => {
        admittedCap = admittedRole.maxTurnBudgetUsd;
        return {
          kind: "codex",
          runTurn: async (request) => {
            expect(request.role.maxTurnBudgetUsd).toBe(8);
            return result({ costUsd: 8.01, costEstimated: true });
          },
        };
      },
      briefFor: () => "bounded task",
      promptsDir: prompts,
      context: { taste: [], memoryExcerpts: [] },
      workdir: home.root,
      hooks: { gate: () => ({ allow: true }) },
      runlog: { root: home.root, app: "fixture", traceId: "trace-cost-overrun" },
      episode: {
        id: "episode:cost-overrun",
        route: "quick",
        factors: [FACTOR],
        authorizedPasses: [PASS],
      },
      clock: () => new Date("2026-07-13T00:00:00.000Z"),
    });
    expect(admittedCap).toBe(8);
    expect(stopped.passes[0]?.result).toMatchObject({
      status: "blocked_on_gate",
      errorCode: "error_route_budget_exhausted",
      summary: expect.stringContaining("reserved exposure"),
    });
  });

  it("B-ADM-05 preserves planned route across explainable reassessment and terminalization", async () => {
    home = makeOrgHome();
    const episodeId = "episode:history";
    await admission(home.root, episodeId);
    await reassessEpisode({
      root: home.root,
      episodeId,
      toRoute: "standard",
      factor: { kind: "evidence_quality", evidence: "new independent finding", policy_rule: "finding_escalation" },
      now: new Date("2026-07-13T00:01:00.000Z"),
    });
    await finalizeEpisode({
      root: home.root,
      episodeId,
      status: "completed",
      reason: "validated outcome",
      now: new Date("2026-07-13T00:02:00.000Z"),
    });
    const record = await readRouteRecord(home.root, episodeId);
    expect(record).toMatchObject({
      planned_route: "quick",
      current_route: "standard",
      final_route: "standard",
      terminal: { status: "completed", reason: "validated outcome" },
    });
    expect(record.reassessments).toHaveLength(1);
    await expect(finalizeEpisode({
      root: home.root,
      episodeId,
      status: "failed",
      reason: "rewrite attempt",
      now: new Date("2026-07-13T00:03:00.000Z"),
    })).rejects.toThrow("different terminal record");
    expect(JSON.parse(await readFile(routeRecordPath(home.root, episodeId), "utf8"))).toEqual(record);
  });
});

async function admission(root: string, episodeId: string): Promise<void> {
  await admitEpisode({
    root,
    episodeId,
    app: "fixture",
    route: "quick",
    policyVersion: "test/v1",
    factors: [FACTOR],
    passes: [PASS],
    now: new Date("2026-07-13T00:00:00.000Z"),
  });
}

function result(usage: Partial<TurnResult["usage"]> = {}): TurnResult {
  return {
    status: "completed",
    summary: "done",
    artifacts: [],
    session: { runtime: "codex", id: "session" },
    usage: { tokensIn: 1, tokensOut: 1, costUsd: 0.01, subagentTurns: 0, wallClockMs: 100, quality: "complete", ...usage },
    escalations: [],
  };
}
