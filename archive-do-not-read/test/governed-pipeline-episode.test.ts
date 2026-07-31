import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readEpisodePlanExecutionJournal } from "../src/loop/episode-plan-executor.js";
import { readCurrentEpisodePlan } from "../src/loop/episode-plan.js";
import type { VerdictRecordContext } from "../src/loop/pipeline.js";
import type { PipelineConfig } from "../src/loop/pipelines.js";
import {
  assertGovernedPipelineEpisodePlan,
  buildGovernedPipelineEpisodeDefinition,
  governedPipelineOperation,
  orchestrateGovernedPipelineEpisode,
  readGovernedPipelineProviderEvidence,
} from "../src/org/governed-pipeline-episode.js";
import type { AppEntry } from "../src/org/apps.js";
import { FakeRuntime } from "../src/runtime/testing/fakeRuntime.js";
import { readEvents } from "../src/runtime/runlog/events.js";
import { runPaths } from "../src/runtime/runlog/paths.js";
import type {
  ContextBundle,
  RoleConfig,
  TurnAssignment,
  TurnResult,
} from "../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

const NOW = "2026-07-19T20:00:00.000Z";
const FIXED: TurnAssignment = {
  harness: "codex",
  model: "gpt-builder-fixed",
  effort: "high",
};
const ADAPTIVE: TurnAssignment = {
  harness: "claude",
  model: "claude-builder-approved",
  effort: "medium",
};
const CONTEXT: ContextBundle = { taste: ["role authority"], memoryExcerpts: [] };

describe("governed pipeline EpisodePlan adapter", () => {
  const homes: OrgHomeFixture[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) home.cleanup();
  });

  it("normalizes fixed pipelines as explicit templates and leaves assignment to materialization", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const pipeline = fixturePipeline();
    writePrompts(home.root);
    const definition = buildGovernedPipelineEpisodeDefinition({
      ...scopeInput(fixedApp(), roles(), pipeline),
    });

    expect(definition.scope).toMatchObject({
      planningDisposition: "execution_ready",
      workKind: "governed-pipeline:protocol",
      workflowTemplate: {
        id: "pipeline/protocol",
        version: expect.stringMatching(/^sha256-[a-f0-9]{64}$/),
      },
      declaredConstraints: {
        governedPipeline: {
          name: "protocol",
          selectedPassIds: ["inspect", "publish"],
          operationIds: [
            "pipeline/protocol/inspect",
            "pipeline/protocol/publish",
          ],
        },
      },
    });
    expect(definition.steps).toEqual([
      expect.objectContaining({
        id: "gp-protocol-inspect",
        operation: "pipeline/protocol/inspect",
        dependsOn: [],
      }),
      expect.objectContaining({
        id: "gp-protocol-publish",
        operation: "pipeline/protocol/publish",
        dependsOn: ["gp-protocol-inspect"],
      }),
    ]);
    expect(definition.steps.every((step) =>
      step.kind !== "provider_turn" || !("assignment" in step)
    )).toBe(true);

    const runtimeFactory = vi.fn(() => {
      throw new Error("planner must not run for a complete governed template");
    });
    const planned = await orchestrateGovernedPipelineEpisode({
      ...orchestrationInput(home, fixedApp(), roles(), pipeline),
      mode: "plan_only",
      runtimeForAssignment: runtimeFactory,
    });

    expect(runtimeFactory).not.toHaveBeenCalled();
    expect(planned.prepared).toMatchObject({
      planningTurnSkipped: true,
      plannerAttempts: 0,
      plan: {
        planningSource: "creator_scope",
        steps: [
          expect.objectContaining({ assignment: FIXED, assignmentSource: "configured" }),
          expect.objectContaining({ assignment: FIXED, assignmentSource: "configured" }),
        ],
      },
    });
  });

  it("selects one exact app-narrowed approved tuple for adaptive creator scope", () => {
    const pipeline = fixturePipeline();
    const definition = buildGovernedPipelineEpisodeDefinition({
      ...scopeInput(adaptiveApp(), roles(), pipeline),
    });

    expect(definition.steps).toEqual([
      expect.objectContaining({ assignment: ADAPTIVE }),
      expect.objectContaining({ assignment: ADAPTIVE }),
    ]);
    expect(definition.bindings.map((binding) => binding.assignment)).toEqual([
      ADAPTIVE,
      ADAPTIVE,
    ]);
  });

  it("executes exactly one governed template/provider call per planned step", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const pipeline = fixturePipeline();
    writePrompts(home.root);
    const runtime = new FakeRuntime([
      { result: completed("inspection result", "codex") },
      { result: completed("publication result", "codex") },
    ], "codex");
    const recordedVerdicts: string[] = [];
    const result = await orchestrateGovernedPipelineEpisode({
      ...orchestrationInput(home, fixedApp(), roles(), pipeline),
      mode: "execute",
      runtimeForAssignment: (assignment) => {
        expect(assignment).toEqual(FIXED);
        return runtime;
      },
      delivery: {
        contextForStep: () => CONTEXT,
        briefForStep: ({ pass }) => `caller brief for ${pass.id}`,
        verdictSchemaForStep: ({ pass }) => ({ type: "object", title: pass.id }),
        recordVerdictForStep: ({ pass }) => async (context) => {
          recordedVerdicts.push(`${pass.id}:${context.result.summary}`);
          await context.events.append({
            type: "verdict.recorded",
            detail: { kind: "test", pass: pass.id },
          });
          return { ok: true };
        },
        inputManifestForStep: ({ pass }) => ({
          fileName: `input-${pass.id}.json`,
          pendingContents: JSON.stringify({ pass: pass.id, state: "pending" }),
          completedContents: JSON.stringify({ pass: pass.id, state: "completed" }),
        }),
      },
    });

    expect(result.execution).toMatchObject({
      status: "completed",
      completedStepIds: ["gp-protocol-inspect", "gp-protocol-publish"],
    });
    expect(runtime.calls).toHaveLength(2);
    expect(runtime.calls.map((call) => call.req.assignment)).toEqual([FIXED, FIXED]);
    expect(runtime.calls[0]!.req.task).toContain("caller brief for inspect");
    expect(runtime.calls[0]!.req.task).toContain("INSPECT TEMPLATE");
    expect(runtime.calls[1]!.req.task).toContain("caller brief for publish");
    expect(runtime.calls[1]!.req.task).toContain("PUBLISH TEMPLATE");
    expect(recordedVerdicts).toEqual([
      "inspect:inspection result",
      "publish:publication result",
    ]);
    assertGovernedPipelineEpisodePlan(result.prepared.plan, result.definition);
  });

  it("rejects an invented operation before execution", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const pipeline = fixturePipeline();
    writePrompts(home.root);
    const planned = await orchestrateGovernedPipelineEpisode({
      ...orchestrationInput(home, fixedApp(), roles(), pipeline),
      mode: "plan_only",
    });
    const altered = structuredClone(planned.prepared.plan);
    const first = altered.steps[0]!;
    if (first.kind !== "provider_turn") throw new Error("fixture plan must be provider-only");
    first.operation = "pipeline/protocol/invented";

    expect(() => assertGovernedPipelineEpisodePlan(altered, planned.definition)).toThrowError(
      /does not match governed operation pipeline\/protocol\/inspect/,
    );
    expect(() => governedPipelineOperation("protocol", "../escape")).toThrowError(
      /stable machine-readable identifier/,
    );
  });

  it("refuses a verdict-repair provider call that is absent from the plan", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const pipeline: PipelineConfig = {
      name: "protocol",
      mechanical: false,
      passes: [fixturePipeline().passes[0]!],
    };
    writePrompts(home.root);
    const runtime = new FakeRuntime([
      { result: completed("not valid enough for the recorder", "codex") },
      { result: completed("this hidden repair must never run", "codex") },
    ], "codex");

    const result = await orchestrateGovernedPipelineEpisode({
      ...orchestrationInput(home, fixedApp(), roles(), pipeline),
      mode: "execute",
      runtimeForAssignment: () => runtime,
      delivery: {
        contextForStep: () => CONTEXT,
        briefForStep: () => "one governed turn",
        recordVerdictForStep: () => async (context) => {
          await context.runProviderTurn({
            operation: "hidden/reformat",
            task: "repair the verdict outside the accepted plan",
          });
          return { ok: true };
        },
      },
    });

    expect(result.execution).toMatchObject({
      status: "failed",
      reasonCode: "error_verdict_persist",
    });
    expect(runtime.calls).toHaveLength(1);
  });

  it("recovers terminal output after interruption without another provider turn", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const pipeline: PipelineConfig = {
      name: "protocol",
      mechanical: false,
      passes: [fixturePipeline().passes[0]!],
    };
    writePrompts(home.root);
    const runtime = new FakeRuntime([
      { result: completed("durable recovered result", "codex") },
    ], "codex");
    let evidenceCalls = 0;
    const recovered: boolean[] = [];
    const input = {
      ...orchestrationInput(home, fixedApp(), roles(), pipeline),
      facts: {
        ...orchestrationInput(home, fixedApp(), roles(), pipeline).facts,
        // The terminal provider receipt is charged before the outer plan
        // journal closes the active step; route re-admission remains bounded
        // while that crash window is reconciled.
        hardBudget: {
          maxProviderTurns: 2,
          maxEquivalentCostUsd: 4,
          maxMechanicalOverheadUsd: 0,
        },
      },
      mode: "execute" as const,
      runtimeForAssignment: () => runtime,
      delivery: {
        contextForStep: () => CONTEXT,
        briefForStep: () => "one governed turn",
        afterProviderEvidence: ({ evidence }: { evidence: { recovered: boolean } }) => {
          evidenceCalls += 1;
          recovered.push(evidence.recovered);
          if (evidenceCalls === 1) throw new Error("fault after terminal provider evidence");
        },
      },
    };

    await expect(orchestrateGovernedPipelineEpisode(input)).rejects.toThrowError(
      /step gp-protocol-inspect was interrupted after durable start/,
    );
    expect(runtime.calls).toHaveLength(1);
    expect((await readEpisodePlanExecutionJournal(
      home.root,
      "episode:governed-protocol",
    ))?.status).toBe("running");

    const resumed = await orchestrateGovernedPipelineEpisode(input);
    expect(resumed.execution).toMatchObject({
      status: "completed",
      completedStepIds: ["gp-protocol-inspect"],
    });
    expect(runtime.calls).toHaveLength(1);
    expect(recovered).toEqual([false, true]);
  });

  it("replays missing governed verdict persistence before completing recovered provider evidence", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const pipeline: PipelineConfig = {
      name: "protocol",
      mechanical: false,
      passes: [fixturePipeline().passes[0]!],
    };
    writePrompts(home.root);
    const runtime = new FakeRuntime([
      { result: completed("durable verdict output", "codex") },
    ], "codex");
    const recorder = vi.fn(async (context: VerdictRecordContext) => {
      await context.events.append({
        type: "verdict.recorded",
        detail: { kind: "test", verdict: "approve" },
      });
      return { ok: true as const };
    });
    let interruptAfterEvidence = true;
    const input = {
      ...orchestrationInput(home, fixedApp(), roles(), pipeline),
      facts: {
        ...orchestrationInput(home, fixedApp(), roles(), pipeline).facts,
        hardBudget: {
          maxProviderTurns: 2,
          maxEquivalentCostUsd: 4,
          maxMechanicalOverheadUsd: 0,
        },
      },
      mode: "execute" as const,
      runtimeForAssignment: () => runtime,
      delivery: {
        contextForStep: () => CONTEXT,
        briefForStep: () => "one governed verdict turn",
        recordVerdictForStep: () => recorder,
        afterProviderEvidence: () => {
          if (interruptAfterEvidence) {
            interruptAfterEvidence = false;
            throw new Error("fault after terminal provider evidence");
          }
        },
      },
    };

    await expect(orchestrateGovernedPipelineEpisode(input)).rejects.toMatchObject({
      code: "error_episode_plan_step_interrupted",
    });
    expect(runtime.calls).toHaveLength(1);
    expect(recorder).toHaveBeenCalledTimes(1);

    const definition = buildGovernedPipelineEpisodeDefinition({
      ...scopeInput(fixedApp(), roles(), pipeline),
    });
    const plan = await readCurrentEpisodePlan(home.root, "episode:governed-protocol");
    if (plan === undefined) throw new Error("expected persisted governed plan");
    const evidence = await readGovernedPipelineProviderEvidence({
      root: home.root,
      app: fixedApp().name,
      plan,
      definition,
    });
    const runId = evidence[0]!.record.run_id;
    const eventsPath = runPaths(home.root, fixedApp().name, runId).events;
    const crashBoundary = readFileSync(eventsPath, "utf8")
      .split("\n")
      .filter((line) => {
        if (line.length === 0) return false;
        const event = JSON.parse(line) as { event?: string };
        return event.event !== "verdict.recorded" &&
          event.event !== "verdict.persistence_completed";
      })
      .join("\n");
    // Recreate the exact on-disk crash boundary: the provider execution and
    // output are terminal, while no verdict parse/persistence commit exists.
    writeFileSync(eventsPath, `${crashBoundary}\n`);
    recorder.mockClear();

    const resumed = await orchestrateGovernedPipelineEpisode(input);
    expect(resumed.execution).toMatchObject({
      status: "completed",
      completedStepIds: ["gp-protocol-inspect"],
    });
    expect(runtime.calls).toHaveLength(1);
    expect(recorder).toHaveBeenCalledTimes(1);
    expect((await readEvents(home.root, fixedApp().name, runId)).map((event) => event.event))
      .toEqual(expect.arrayContaining([
        "verdict.recorded",
        "verdict.persistence_completed",
      ]));
  });

  it("rebuilds predecessor inputs and final output projection from durable evidence after a crash", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const pipeline = fixturePipeline();
    writePrompts(home.root);
    const runtime = new FakeRuntime([
      { result: completed("durable inspect output", "codex") },
      { result: completed("durable publish output", "codex") },
    ], "codex");
    let interrupt = true;
    const publishDependencies: string[][] = [];
    const base = orchestrationInput(home, fixedApp(), roles(), pipeline);
    const input = {
      ...base,
      facts: {
        ...base.facts,
        // One bounded reconciliation slot covers the terminal-provider / plan-
        // journal crash window without authorizing an extra workflow step.
        hardBudget: {
          maxProviderTurns: 3,
          maxEquivalentCostUsd: 6,
          maxMechanicalOverheadUsd: 0,
        },
      },
      mode: "execute" as const,
      runtimeForAssignment: () => runtime,
      delivery: {
        contextForStep: ({ pass, dependencyOutputs }: {
          pass: { id: string };
          dependencyOutputs: Array<{ passId: string; output: string }>;
        }) => {
          if (pass.id === "publish") {
            publishDependencies.push(
              dependencyOutputs.map((entry) => `${entry.passId}:${entry.output}`),
            );
          }
          return CONTEXT;
        },
        briefForStep: ({ pass, dependencyOutputs }: {
          pass: { id: string };
          dependencyOutputs: Array<{ output: string }>;
        }) => [
          `execute ${pass.id}`,
          ...dependencyOutputs.map((entry) => entry.output),
        ].join("\n"),
        afterProviderEvidence: ({ step }: { step: { id: string } }) => {
          if (step.id === "gp-protocol-inspect" && interrupt) {
            interrupt = false;
            throw new Error("crash after predecessor output became durable");
          }
        },
      },
    };

    await expect(orchestrateGovernedPipelineEpisode(input)).rejects.toThrowError(
      /step gp-protocol-inspect was interrupted after durable start/,
    );
    expect(runtime.calls).toHaveLength(1);

    const resumed = await orchestrateGovernedPipelineEpisode(input);
    expect(runtime.calls).toHaveLength(2);
    expect(publishDependencies).toEqual([["inspect:durable inspect output"]]);
    expect(runtime.calls[1]!.req.task).toContain("durable inspect output");
    expect(resumed.providerEvidence.map((entry) => ({
      pass: entry.passId,
      output: entry.output,
      recovered: entry.recovered,
    }))).toEqual([
      { pass: "inspect", output: "durable inspect output", recovered: true },
      { pass: "publish", output: "durable publish output", recovered: true },
    ]);

    const reread = await readGovernedPipelineProviderEvidence({
      root: home.root,
      app: fixedApp().name,
      plan: resumed.prepared.plan,
      definition: resumed.definition,
    });
    expect(reread.map((entry) => `${entry.passId}:${entry.output}`)).toEqual([
      "inspect:durable inspect output",
      "publish:durable publish output",
    ]);
  });

  it("keeps same-stage parallel passes out of one another's dependency inputs", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const pipeline: PipelineConfig = {
      name: "protocol",
      mechanical: false,
      passes: [{
        id: "analyze-a",
        role: "builder",
        template: "protocol/inspect.md",
        parallelGroup: "competing",
      }, {
        id: "analyze-b",
        role: "builder",
        template: "protocol/inspect.md",
        parallelGroup: "competing",
      }, {
        id: "combine",
        role: "builder",
        template: "protocol/publish.md",
      }],
    };
    writePrompts(home.root);
    const runtime = new FakeRuntime([
      { result: completed("analysis a", "codex") },
      { result: completed("analysis b", "codex") },
      { result: completed("combined", "codex") },
    ], "codex");
    const dependencies = new Map<string, string[]>();

    await orchestrateGovernedPipelineEpisode({
      ...orchestrationInput(home, fixedApp(), roles(), pipeline),
      mode: "execute",
      runtimeForAssignment: () => runtime,
      delivery: {
        contextForStep: ({ pass, dependencyOutputs }) => {
          dependencies.set(pass.id, dependencyOutputs.map((entry) => entry.passId));
          return CONTEXT;
        },
        briefForStep: ({ pass }) => `execute ${pass.id}`,
      },
    });

    expect(runtime.calls).toHaveLength(3);
    expect(Object.fromEntries(dependencies)).toEqual({
      "analyze-a": [],
      "analyze-b": [],
      combine: ["analyze-a", "analyze-b"],
    });
  });
});

function fixturePipeline(): PipelineConfig {
  return {
    name: "protocol",
    mechanical: false,
    passes: [{
      id: "inspect",
      role: "builder",
      template: "protocol/inspect.md",
      maxTurns: 1,
    }, {
      id: "publish",
      role: "builder",
      template: "protocol/publish.md",
      wallClockMinutes: 2,
    }],
  };
}

function writePrompts(root: string): void {
  mkdirSync(join(root, "prompts", "protocol"), { recursive: true });
  writeFileSync(join(root, "prompts", "protocol", "inspect.md"), "INSPECT TEMPLATE\n");
  writeFileSync(join(root, "prompts", "protocol", "publish.md"), "PUBLISH TEMPLATE\n");
}

function fixedApp(): AppEntry {
  return {
    name: "fixture",
    repo: "example/fixture",
    status: "live",
    budgetUsdMonth: 100,
    cadence: {},
  };
}

function adaptiveApp(): AppEntry {
  return {
    ...fixedApp(),
    execution: {
      assignmentMode: "adaptive",
      allowedAssignments: { builder: ["approved-claude"] },
    },
  };
}

function roles(): RoleConfig[] {
  return [{
    name: "planner",
    runtime: "codex",
    model: "gpt-planner-fixed",
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: ["episode-plan"],
    maxTurnBudgetUsd: 2,
  }, {
    name: "builder",
    runtime: FIXED.harness,
    model: FIXED.model,
    effort: FIXED.effort,
    adaptiveAssignments: [{
      id: "approved-claude",
      harness: ADAPTIVE.harness,
      model: ADAPTIVE.model,
      efforts: [ADAPTIVE.effort],
      providerFamily: "anthropic",
      capabilityRef: "claude/v1",
      qualificationRef: "qualification:test:governed-pipeline",
      pricing: {
        kind: "conservative_estimate",
        maxTurnCostUsd: 1,
        sourceRef: "qualification:test:governed-pipeline-price",
      },
    }],
    delegation: { allow: [] },
    triggers: [],
    outputs: ["protocol-result"],
    maxTurnBudgetUsd: 2,
  }];
}

function scopeInput(
  app: AppEntry,
  configuredRoles: RoleConfig[],
  pipeline: PipelineConfig,
) {
  return {
    app,
    roles: configuredRoles,
    pipeline,
    selectedPasses: pipeline.passes,
    provenance: {
      source: "agent" as const,
      creatorId: "governed-protocol-test",
      createdAt: NOW,
      evidenceRefs: ["pipeline-config:test"],
    },
    objective: "Run the exact governed protocol",
    inScope: ["the selected protocol passes"],
    outOfScope: ["unselected provider work"],
    acceptanceCriteria: ["every selected pass produces durable output"],
    declaredConstraints: { network: false as const },
    inputRefs: [{ ref: "event:test", required: true }],
    requiredCapabilitiesByRole: { builder: ["tool_gate"] },
  };
}

function orchestrationInput(
  home: OrgHomeFixture,
  app: AppEntry,
  configuredRoles: RoleConfig[],
  pipeline: PipelineConfig,
) {
  return {
    root: home.root,
    ...scopeInput(app, configuredRoles, pipeline),
    facts: {
      episodeId: "episode:governed-protocol",
      trigger: { kind: "company_event", sourceRef: "event:test" },
      lifecycle: "bounded-goal",
      appStage: "live",
      repositoryFacts: { revision: "abc123" },
    },
    workdir: home.root,
    promptsDir: join(home.root, "prompts"),
    hooks: { gate: () => ({ allow: true as const }) },
    telemetry: { orgDir: home.root, trigger: "manual" as const },
    now: monotonicClock(NOW),
  };
}

function completed(summary: string, runtime: TurnResult["session"]["runtime"]): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime, id: `session-${runtime}-${summary.replaceAll(" ", "-")}` },
    usage: {
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.1,
      subagentTurns: 0,
      wallClockMs: 10,
      quality: "complete",
    },
    escalations: [],
  };
}

function monotonicClock(iso: string): () => Date {
  let now = new Date(iso).getTime();
  return () => {
    const current = new Date(now);
    now += 1_000;
    return current;
  };
}
