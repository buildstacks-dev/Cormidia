import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EPISODE_PLAN_PROPOSAL_SCHEMA,
  EpisodePlanValidationError,
  episodePlanProposalSchemaForOperations,
  episodeIntentHash,
  readCurrentEpisodePlan,
  type CreatorEpisodeScope,
  type EpisodeIntent,
  type ProposedEpisodePlan,
  type ProposedProviderTurnStep,
} from "../src/loop/episode-plan.js";
import { readExecutionSteps, routeRecordPath } from "../src/loop/efficiency.js";
import {
  plannerAdmissionPath,
  plannerPlanAcceptancePath,
  type PlannerAdmissionLimits,
} from "../src/loop/planner-admission.js";
import { buildEpisodeIntent } from "../src/org/episode-planner/policy.js";
import {
  EPISODE_PLANNER_ACCEPTANCE_INTERNAL_ERROR,
  prepareEpisodePlanWithRuntime,
} from "../src/org/episode-planner/runtime.js";
import { cmdTelemetry } from "../src/cli/telemetry.js";
import { renderStoryMarkdown } from "../src/narrative/render.js";
import { foldAppStories } from "../src/narrative/story.js";
import type { AppEntry } from "../src/org/apps.js";
import { FakeRuntime } from "../src/runtime/testing/fakeRuntime.js";
import { readEnvelope } from "../src/runtime/runlog/envelope.js";
import { readEvents } from "../src/runtime/runlog/events.js";
import { runPaths } from "../src/runtime/runlog/paths.js";
import { formatStatusRows, readStatusRows } from "../src/runtime/runlog/status.js";
import { readTurnRecords } from "../src/runtime/telemetry.js";
import type {
  ContextBundle,
  RoleConfig,
  Runtime,
  TurnAssignment,
  TurnResult,
} from "../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

const NOW = new Date("2026-07-19T19:00:00.000Z");
const PLANNER_ASSIGNMENT: TurnAssignment = {
  harness: "codex",
  model: "gpt-planner-test",
  effort: "high",
};
const BUILDER_ASSIGNMENT: TurnAssignment = {
  harness: "claude",
  model: "claude-builder-test",
  effort: "medium",
};
const LIMITS: PlannerAdmissionLimits = {
  maxAttempts: 2,
  perAttempt: {
    equivalentCostUsd: 0.5,
    activeTimeMs: 1_000,
  },
  aggregate: {
    providerTurns: 2,
    equivalentCostUsd: 1,
    activeTimeMs: 2_000,
  },
};
const CONTEXT: ContextBundle = { taste: [], memoryExcerpts: [] };

/** Shaped exactly like `TicketEpisodePlanValidationError`: a domain rejection
 * carrying reason code, message, step id, and the violated rule's stable id. */
function ticketRejection(rule: string): Error & { issues: unknown[] } {
  const error = new Error(`ticket_topology_invalid: violated ${rule}`) as Error & {
    issues: unknown[];
  };
  error.issues = [{
    code: "ticket_topology_invalid",
    message: `violated ${rule}`,
    stepId: "build",
    rule,
  }];
  return error;
}

describe("provider-backed EpisodePlanner", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("admits the fixed boot tuple before construction and records exact ordinary evidence", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const result = completed(JSON.stringify(proposal(intent)));
    const runtime = new FakeRuntime([{ result }], "codex");
    const factory = vi.fn((assignment: TurnAssignment, role: RoleConfig) => {
      expect(existsSync(plannerAdmissionPath(home.root, intent.episodeId))).toBe(true);
      expect(existsSync(routeRecordPath(home.root, intent.episodeId))).toBe(false);
      expect(assignment).toEqual(PLANNER_ASSIGNMENT);
      expect(role).toEqual(roles()[0]);
      return runtime;
    });

    const prepared = await prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      runtimeForAssignment: factory,
    });

    expect(prepared).toMatchObject({
      planningTurnSkipped: false,
      plannerAttempts: 1,
      plan: { planningSource: "episode_planner" },
    });
    expect(factory).toHaveBeenCalledOnce();
    expect(runtime.calls).toHaveLength(1);
    expect(runtime.calls[0]!.req).toMatchObject({
      role: { name: "planner", delegation: { allow: ["research-fanout"] } },
      assignment: PLANNER_ASSIGNMENT,
      verdictSchema: EPISODE_PLAN_PROPOSAL_SCHEMA,
      context: {
        execution: {
          role: "planner",
          assignment: PLANNER_ASSIGNMENT,
          requiredCapabilities: [
            "cancellation",
            "session_resume",
            "structured_verdict",
            "tool_gate",
          ],
          roleDelegation: { allow: ["research-fanout"] },
        },
      },
    });

    const [step] = await readExecutionSteps(home.root, intent.episodeId);
    expect(step).toMatchObject({
      operation: "episode-planner/plan",
      runtime: PLANNER_ASSIGNMENT.harness,
      model: PLANNER_ASSIGNMENT.model,
      effort: PLANNER_ASSIGNMENT.effort,
      assignment_source: "configured",
      assignment_candidate_id: "configured",
      selection_reason: "Fixed EpisodePlanner boot assignment",
      status: "completed",
    });
    const envelope = await readEnvelope(home.root, "fixture", step!.run_id);
    expect(envelope).toMatchObject({
      episode_id: intent.episodeId,
      runtime: PLANNER_ASSIGNMENT.harness,
      model: PLANNER_ASSIGNMENT.model,
      effort: PLANNER_ASSIGNMENT.effort,
      assignment_source: "configured",
      provider_turn_ids: [step!.provider_turn_id],
      execution_step_ids: [step!.execution_step_id],
      status: "completed",
    });
    expect(await readFile(runPaths(home.root, "fixture", step!.run_id).brief, "utf8"))
      .toContain("[episode_planner_input]");
    expect(await readFile(runPaths(home.root, "fixture", step!.run_id).prompt, "utf8"))
      .toContain("Return exactly one EpisodePlan JSON object.");
    expect(existsSync(plannerPlanAcceptancePath(home.root, intent.episodeId))).toBe(true);

    const ledger = await readTurnRecords(home.root);
    expect(ledger).toEqual([
      expect.objectContaining({
        role: "planner",
        runtime: PLANNER_ASSIGNMENT.harness,
        model: PLANNER_ASSIGNMENT.model,
        effort: PLANNER_ASSIGNMENT.effort,
        providerTurnId: step!.provider_turn_id,
        executionStepId: step!.execution_step_id,
        episodeId: intent.episodeId,
        assignmentSource: "configured",
        assignmentCandidateId: "configured",
      }),
    ]);
  });

  it("uses one bounded structural repair with deterministic diagnostics", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const invalidRawOutput = JSON.stringify({ schemaVersion: 99 });
    const runtime = new FakeRuntime([
      { result: completed(invalidRawOutput) },
      { result: completed(JSON.stringify(proposal(intent))) },
    ], "codex");

    const prepared = await prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      providerOperations: ["build/implement", "build/contract"],
      runtimeForAssignment: () => runtime,
    });

    expect(prepared.plannerAttempts).toBe(2);
    expect(runtime.calls).toHaveLength(2);
    expect(runtime.calls[1]!.req.task).toContain("plan_structure_invalid");
    expect(runtime.calls[1]!.req.task).toContain('"path": "$.schemaVersion"');
    expect(runtime.calls[1]!.req.task).toContain('"constraint": "const"');
    expect(runtime.calls[1]!.req.task).toContain('"attempt": 2');
    const operationSchema = episodePlanProposalSchemaForOperations([
      "build/implement",
      "build/contract",
    ]);
    expect(runtime.calls.map((call) => call.req.verdictSchema)).toEqual([
      operationSchema,
      operationSchema,
    ]);
    const steps = await readExecutionSteps(home.root, intent.episodeId);
    expect(steps.map((step) => ({
      operation: step.operation,
      status: step.status,
      errorCode: step.error_code,
    }))).toEqual([
      {
        operation: "episode-planner/plan",
        status: "failed",
        errorCode: "plan_structure_invalid",
      },
      {
        operation: "episode-planner/repair",
        status: "completed",
        errorCode: null,
      },
    ]);
    expect(steps[0]!.reason).toContain("$.schemaVersion");
    const rejectedEnvelope = await readEnvelope(home.root, "fixture", steps[0]!.run_id);
    expect(rejectedEnvelope).toMatchObject({
      status: "failed",
      error_code: "plan_structure_invalid",
      terminal_reason: expect.stringContaining("$.schemaVersion"),
    });
    expect(await readFile(runPaths(home.root, "fixture", steps[0]!.run_id).output, "utf8"))
      .toBe(invalidRawOutput);
    expect(await readEvents(home.root, "fixture", steps[0]!.run_id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "pass.failed",
          severity: "error",
          error_code: "plan_structure_invalid",
          detail: { reason: expect.stringContaining("$.schemaVersion") },
        }),
      ]),
    );
    expect((await readTurnRecords(home.root)).map((record) => record.status))
      .toEqual(["failed", "completed"]);

    const statusRows = await readStatusRows(home.root, { app: "fixture" });
    expect(statusRows.find((row) => row.runId === steps[0]!.run_id)?.status)
      .toBe("failed(plan_structure_invalid)");
    expect(formatStatusRows(statusRows)).toContain("failed(plan_structure_invalid)");
  });

  it("rejects a genuinely unknown operation with the valid registry before acceptance", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const invalid = proposal(intent);
    const step = invalid.steps[0];
    if (step?.kind !== "provider_turn") throw new Error("fixture provider step disappeared");
    step.operation = "build/implement-typo";
    const runtime = new FakeRuntime([
      { result: completed(JSON.stringify(invalid)) },
      { result: completed(JSON.stringify(invalid)) },
    ], "codex");

    await expect(prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      providerOperations: ["build/contract", "build/implement"],
      runtimeForAssignment: () => runtime,
    })).rejects.toMatchObject({
      code: "error_episode_planner_failed",
      issues: [expect.objectContaining({
        code: "plan_operation_unknown",
        stepId: "build",
        message:
          'unknown provider operation "build/implement-typo"; valid operations are: ' +
          "build/contract, build/implement",
      })],
    });

    expect(runtime.calls).toHaveLength(2);
    expect((await readExecutionSteps(home.root, intent.episodeId)).map((record) =>
      [record.status, record.error_code]
    )).toEqual([
      ["failed", "plan_operation_unknown"],
      ["failed", "plan_operation_unknown"],
    ]);
  });

  it("reports a terminally rejected plan as failed across status, narrative, and telemetry", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const runtime = new FakeRuntime([
      { result: completed(JSON.stringify({ schemaVersion: 99 })) },
      { result: completed(JSON.stringify({ schemaVersion: 98 })) },
    ], "codex");

    await expect(prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      runtimeForAssignment: () => runtime,
    })).rejects.toMatchObject({
      code: "error_episode_planner_failed",
      attempts: 2,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "plan_structure_invalid" }),
      ]),
    });

    const steps = await readExecutionSteps(home.root, intent.episodeId);
    expect(steps).toHaveLength(2);
    expect(steps.every((step) =>
      step.status === "failed" && step.error_code === "plan_structure_invalid"
    )).toBe(true);
    const statusRows = await readStatusRows(home.root, { app: "fixture" });
    expect(statusRows).toHaveLength(2);
    expect(statusRows.every((row) => row.status === "failed(plan_structure_invalid)"))
      .toBe(true);
    expect(formatStatusRows(statusRows)).toContain("failed(plan_structure_invalid)");

    const narrative = await foldAppStories(home.root, "fixture");
    expect(narrative.problems).toEqual([]);
    expect(narrative.stories).toHaveLength(1);
    expect(narrative.stories[0]).toMatchObject({
      status: "failed",
      moments: expect.arrayContaining([
        expect.objectContaining({ run_id: steps[0]!.run_id, status: "failed" }),
        expect.objectContaining({ run_id: steps[1]!.run_id, status: "failed" }),
      ]),
    });
    expect(renderStoryMarkdown(narrative.stories[0]!)).toContain("Status: **failed**");

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await cmdTelemetry(["--home", home.root, "--app", "fixture"])).toBe(0);
      const telemetry = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(telemetry).toContain("failed(plan_structure_invalid)");
      expect(telemetry).toContain("productive provider turns: valid; 0/2 (0.0%)");
    } finally {
      log.mockRestore();
    }
  });

  it("does not buy a repair turn when validation supplies no actionable defect", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const runtime = new FakeRuntime([
      { result: completed(JSON.stringify(proposal(intent))) },
      { result: completed(JSON.stringify(proposal(intent))) },
    ], "codex");

    await expect(prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      runtimeForAssignment: () => runtime,
      validateAcceptedPlan: () => {
        throw new EpisodePlanValidationError([{
          code: "plan_structure_invalid",
          message: "proposed EpisodePlan is not a strict schema-v1 plan",
        }]);
      },
    })).rejects.toMatchObject({
      code: "error_episode_planner_failed",
      attempts: 1,
      issues: [{
        code: "plan_structure_invalid",
        message: "proposed EpisodePlan is not a strict schema-v1 plan",
      }],
    });

    expect(runtime.calls).toHaveLength(1);
    expect((await readExecutionSteps(home.root, intent.episodeId)).map((step) => step.operation))
      .toEqual(["episode-planner/plan"]);
    expect(await readTurnRecords(home.root)).toHaveLength(1);
  });

  // ISSUE-023: a domain topology rejection names a step and a rule, so it is
  // actionable and must buy the bounded repair turn — and when that repair
  // breaks an invariant its input satisfied, the failure must say so rather
  // than read as an unrelated fresh defect.
  it("buys a repair for a domain topology rejection and names a regressive repair", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const runtime = new FakeRuntime([
      { result: completed(JSON.stringify(proposal(intent))) },
      { result: completed(JSON.stringify(proposal(intent))) },
    ], "codex");
    let attempt = 0;

    await expect(prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      runtimeForAssignment: () => runtime,
      validateAcceptedPlan: () => {
        attempt += 1;
        throw ticketRejection(attempt === 1
          ? "ship_follows_every_ship_check"
          : "review_authorization_joins_review_lenses");
      },
    })).rejects.toMatchObject({
      code: "error_episode_planner_failed",
      attempts: 2,
      issues: [
        expect.objectContaining({
          code: "plan_repair_regressive",
          constraint: "non_regressive_repair",
        }),
        expect.objectContaining({
          code: "plan_structure_invalid",
          constraint: "ticket_topology_invalid",
          rule: "review_authorization_joins_review_lenses",
        }),
      ],
    });

    // The repair turn was genuinely bought, and the repair brief was told which
    // invariants the rejected proposal already satisfied.
    expect(runtime.calls).toHaveLength(2);
    expect(runtime.calls[1]!.req.task).toContain('"rule": "ship_follows_every_ship_check"');
  });

  it("confines planner attempts to the bounded manifest and denies every tool without network access", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const runtime = new FakeRuntime([{
      toolActions: [{
        action: { tool: "read", input: { path: "package.json" } },
        fromSubagent: true,
      }],
      result: completed(JSON.stringify(proposal(intent))),
    }], "codex");
    const outerGate = vi.fn(() => ({ allow: true as const }));

    const prepared = await prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      hooks: { gate: outerGate },
      networkAccess: true,
      runtimeForAssignment: () => runtime,
    });

    expect(prepared.plan.planningSource).toBe("episode_planner");
    expect(outerGate).not.toHaveBeenCalled();
    expect(runtime.calls[0]!.req.networkAccess).toBeUndefined();
    expect(runtime.calls[0]!.gateCalls).toEqual([{
      action: { tool: "read", input: { path: "package.json" } },
      decision: {
        allow: false,
        reason: expect.stringContaining("bounded intent"),
        escalate: false,
      },
    }]);
  });

  it("resumes a terminal attempt after a crash, settles once, and never calls the provider again", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const runtime = new FakeRuntime([
      { result: completed(JSON.stringify(proposal(intent))) },
    ], "codex");
    let crash = true;
    const options = {
      ...baseOptions(home.root, intent),
      runtimeForAssignment: () => runtime,
      afterAttemptFinalized: () => {
        if (crash) {
          crash = false;
          throw new Error("simulated crash after terminal write");
        }
      },
    };

    await expect(prepareEpisodePlanWithRuntime(options))
      .rejects.toThrow("simulated crash after terminal write");
    expect(runtime.calls).toHaveLength(1);
    expect(await readTurnRecords(home.root)).toHaveLength(0);
    expect(await readCurrentEpisodePlan(home.root, intent.episodeId)).toBeUndefined();
    const [terminal] = await readExecutionSteps(home.root, intent.episodeId);
    expect((await readEnvelope(home.root, "fixture", terminal!.run_id)).status).toBe("running");

    const resumed = await prepareEpisodePlanWithRuntime(options);
    expect(resumed.plan.planningSource).toBe("episode_planner");
    expect(runtime.calls).toHaveLength(1);
    expect(await readTurnRecords(home.root)).toHaveLength(1);
    expect((await readEnvelope(home.root, "fixture", terminal!.run_id)).status).toBe("completed");

    const idempotent = await prepareEpisodePlanWithRuntime(options);
    expect(idempotent.plan).toEqual(resumed.plan);
    expect(runtime.calls).toHaveLength(1);
    expect(await readTurnRecords(home.root)).toHaveLength(1);
  });

  it("reclassifies a recovered legacy completed receipt before finalizing its running envelope", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const invalidRawOutput = JSON.stringify({ schemaVersion: 99 });
    const runtime = new FakeRuntime([
      { result: completed(invalidRawOutput) },
      { result: completed(JSON.stringify(proposal(intent))) },
    ], "codex");
    let crash = true;
    const options = {
      ...baseOptions(home.root, intent),
      runtimeForAssignment: () => runtime,
      afterAttemptFinalized: () => {
        if (crash) {
          crash = false;
          throw new Error("simulated old crash before plan validation");
        }
      },
    };

    await expect(prepareEpisodePlanWithRuntime(options))
      .rejects.toThrow("simulated old crash before plan validation");
    const [first] = await readExecutionSteps(home.root, intent.episodeId);
    expect(first?.status).toBe("failed");
    await rewriteAsLegacyCompletedReceipt(home, intent, first!, invalidRawOutput, false);

    const resumed = await prepareEpisodePlanWithRuntime(options);
    expect(resumed.plannerAttempts).toBe(2);
    expect(runtime.calls).toHaveLength(2);
    // The old receipt is immutable, but the still-running envelope and its
    // settlement consume the deterministic validation result before either
    // can repeat the false completed state.
    expect((await readExecutionSteps(home.root, intent.episodeId))[0]?.status).toBe("completed");
    expect(await readEnvelope(home.root, "fixture", first!.run_id)).toMatchObject({
      status: "failed",
      error_code: "plan_structure_invalid",
      terminal_reason: expect.stringContaining("$.schemaVersion"),
    });
    expect((await readTurnRecords(home.root)).map((record) => record.status))
      .toEqual(["failed", "completed"]);
  });

  it("does not rewrite an already-terminal legacy completed envelope while requiring its repair", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const invalidRawOutput = JSON.stringify({ schemaVersion: 99 });
    const runtime = new FakeRuntime([
      { result: completed(invalidRawOutput) },
      { result: completed(JSON.stringify(proposal(intent))) },
    ], "codex");
    let crash = true;
    const options = {
      ...baseOptions(home.root, intent),
      runtimeForAssignment: () => runtime,
      afterAttemptFinalized: () => {
        if (crash) {
          crash = false;
          throw new Error("simulated old terminalization gap");
        }
      },
    };

    await expect(prepareEpisodePlanWithRuntime(options))
      .rejects.toThrow("simulated old terminalization gap");
    const [first] = await readExecutionSteps(home.root, intent.episodeId);
    await rewriteAsLegacyCompletedReceipt(home, intent, first!, invalidRawOutput, true);

    const resumed = await prepareEpisodePlanWithRuntime(options);
    expect(resumed.plannerAttempts).toBe(2);
    expect(runtime.calls).toHaveLength(2);
    expect((await readExecutionSteps(home.root, intent.episodeId))[0]?.status).toBe("completed");
    expect((await readEnvelope(home.root, "fixture", first!.run_id)).status).toBe("completed");
    expect((await readTurnRecords(home.root)).map((record) => record.status))
      .toEqual(["completed", "completed"]);
  });

  it("fails closed when returned session evidence names a different harness", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const mismatched: TurnResult = {
      ...completed(JSON.stringify(proposal(intent))),
      session: { runtime: "claude", id: "wrong-provider-session" },
    };
    const runtime = new FakeRuntime([{ result: mismatched }], "codex");

    await expect(prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      runtimeForAssignment: () => runtime,
    })).rejects.toMatchObject({ code: "error_episode_planner_assignment_mismatch" });

    expect(await readCurrentEpisodePlan(home.root, intent.episodeId)).toBeUndefined();
    expect(await readExecutionSteps(home.root, intent.episodeId)).toEqual([
      expect.objectContaining({
        runtime: "codex",
        status: "failed",
        error_code: "error_episode_planner_assignment_mismatch",
      }),
    ]);
  });

  it("records acceptance exceptions as internal failures with stack evidence and does not repair them", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const runtime = new FakeRuntime([{
      result: completed(JSON.stringify(proposal(intent))),
    }], "codex");

    await expect(prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      runtimeForAssignment: () => runtime,
      validateAcceptedPlan: () => {
        throw new TypeError("simulated acceptance invariant failure");
      },
    })).rejects.toMatchObject({
      code: EPISODE_PLANNER_ACCEPTANCE_INTERNAL_ERROR,
      detail: "simulated acceptance invariant failure",
    });

    expect(runtime.calls).toHaveLength(1);
    const [step] = await readExecutionSteps(home.root, intent.episodeId);
    expect(step).toMatchObject({
      status: "failed",
      error_code: EPISODE_PLANNER_ACCEPTANCE_INTERNAL_ERROR,
    });
    expect(await readEnvelope(home.root, intent.app, step!.run_id)).toMatchObject({
      status: "failed",
      error_code: EPISODE_PLANNER_ACCEPTANCE_INTERNAL_ERROR,
      terminal_reason: expect.stringContaining("simulated acceptance invariant failure"),
    });
    expect(await readEvents(home.root, intent.app, step!.run_id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: "pass.failed",
        error_code: EPISODE_PLANNER_ACCEPTANCE_INTERNAL_ERROR,
        detail: expect.objectContaining({
          detail: "simulated acceptance invariant failure",
          stack: expect.stringContaining("TypeError: simulated acceptance invariant failure"),
        }),
      }),
    ]));
  });

  it("aborts at the admitted per-attempt active-time ceiling", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    let observedAbort = false;
    const runtime: Runtime = {
      kind: "codex",
      runTurn: async (request) => new Promise<TurnResult>((resolve) => {
        request.signal!.addEventListener("abort", () => {
          observedAbort = true;
          resolve({
            ...completed(JSON.stringify(proposal(intent))),
            usage: {
              ...completed("unused").usage,
              wallClockMs: 10,
            },
          });
        }, { once: true });
      }),
    };
    const tightLimits: PlannerAdmissionLimits = {
      maxAttempts: 1,
      perAttempt: { ...LIMITS.perAttempt, activeTimeMs: 10 },
      aggregate: {
        providerTurns: 1,
        equivalentCostUsd: LIMITS.perAttempt.equivalentCostUsd,
        activeTimeMs: 10,
      },
    };

    await expect(prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      limits: tightLimits,
      cancellationGraceMs: 20,
      runtimeForAssignment: () => runtime,
    })).rejects.toMatchObject({ code: "error_episode_planner_budget_unmeasured" });

    expect(observedAbort).toBe(true);
    expect(await readExecutionSteps(home.root, intent.episodeId)).toEqual([
      expect.objectContaining({
        status: "timed_out",
        error_code: "error_episode_planner_active_time_exceeded",
      }),
    ]);
  });

  it("keeps an execution-ready creator scope on the zero-provider path", async () => {
    home = makeOrgHome();
    const intent = makeIntent(creatorScope());
    const factory = vi.fn(() => new FakeRuntime([], "codex"));

    const prepared = await prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      // A normalized creator scope never consumes the provider protocol.
      // Its bypass must remain valid even when no planner prompt bytes are
      // available to this invocation.
      promptText: "",
      runtimeForAssignment: factory,
    });

    expect(prepared).toMatchObject({
      planningTurnSkipped: true,
      plannerAttempts: 0,
      plan: { planningSource: "creator_scope" },
    });
    expect(factory).not.toHaveBeenCalled();
    expect(existsSync(plannerAdmissionPath(home.root, intent.episodeId))).toBe(false);
    expect(await readExecutionSteps(home.root, intent.episodeId)).toEqual([]);
    expect(await readTurnRecords(home.root)).toEqual([]);
  });
});

function baseOptions(root: string, intent: EpisodeIntent) {
  return {
    root,
    app: app(),
    roles: roles(),
    intent,
    promptText: "Return exactly one EpisodePlan JSON object.",
    context: CONTEXT,
    workdir: root,
    hooks: { gate: () => ({ allow: true as const }) },
    policyVersion: "episode-planner/test-v1",
    limits: LIMITS,
    now: () => NOW,
  };
}

function app(): AppEntry {
  return {
    name: "fixture",
    repo: "example/fixture",
    status: "live",
    budgetUsdMonth: 100,
    cadence: {},
  };
}

function roles(): RoleConfig[] {
  return [{
    name: "planner",
    runtime: PLANNER_ASSIGNMENT.harness,
    model: PLANNER_ASSIGNMENT.model,
    effort: PLANNER_ASSIGNMENT.effort,
    delegation: { allow: ["research-fanout"] },
    triggers: [],
    outputs: ["episode-plan"],
    maxTurnBudgetUsd: 2,
  }, {
    name: "builder",
    runtime: BUILDER_ASSIGNMENT.harness,
    model: BUILDER_ASSIGNMENT.model,
    effort: BUILDER_ASSIGNMENT.effort,
    delegation: { allow: [] },
    triggers: [],
    outputs: ["patch"],
    maxTurnBudgetUsd: 3,
  }];
}

function makeIntent(creator?: CreatorEpisodeScope): EpisodeIntent {
  return buildEpisodeIntent({
    episodeId: "ticket:fixture:runtime-planner",
    app: app(),
    roles: roles(),
    trigger: { kind: "ticket", sourceRef: "github:#42" },
    goal: "Fix a bounded parser bug",
    lifecycle: "existing-ticket",
    appStage: "growth",
    repositoryFacts: { revision: "abc123", clean: true },
    requestedConstraints: { network: false },
    hardBudget: { maxProviderTurns: 2, maxEquivalentCostUsd: 5 },
    requiredSafetyFacts: [],
    requiredCapabilitiesByRole: { builder: ["tool_gate"] },
    ...(creator === undefined ? {} : { creatorScope: creator }),
  });
}

function proposal(intent: EpisodeIntent): ProposedEpisodePlan {
  const step = providerStep();
  return {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: "Implement the bounded parser fix",
    workflowClass: "localized-bug",
    planningSource: "episode_planner",
    steps: [step],
    estimatedBudget: {
      providerTurns: 1,
      providerTurnBudgetUsd: step.maxTurnBudgetUsd,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: step.maxTurnBudgetUsd,
    },
    derivedSafetyRoute: {
      label: "quick",
      reasons: ["provider-value-is-recomputed"],
      gateStepIds: [],
      approvalStepIds: [],
    },
    createdAt: NOW.toISOString(),
  };
}

function providerStep(): ProposedProviderTurnStep {
  return {
    kind: "provider_turn",
    operation: "build/implement",
    id: "build",
    role: "builder",
    objective: "Implement the bounded parser fix",
    dependsOn: [],
    requiredCapabilities: ["tool_gate"],
    inputRefs: [{ ref: "ticket", required: true }],
    expectedOutputs: [{ id: "patch", kind: "patch", required: true }],
    maxTurnBudgetUsd: 3,
    selectionReason: "One localized implementation turn is sufficient",
  };
}

function creatorScope(): CreatorEpisodeScope {
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "agent",
      creatorId: "parent-plan:1",
      createdAt: "2026-07-19T18:00:00.000Z",
      evidenceRefs: ["task:parent-plan-1"],
    },
    objective: "Fix the bounded parser bug",
    inScope: ["parser fix"],
    outOfScope: ["unrelated refactor"],
    acceptanceCriteria: ["focused parser test passes"],
    expectedArtifacts: [{ id: "patch", kind: "patch", required: true }],
    declaredConstraints: { network: false },
    safetyFacts: [],
    steps: [providerStep()],
  };
}

async function rewriteAsLegacyCompletedReceipt(
  home: OrgHomeFixture,
  intent: EpisodeIntent,
  step: { execution_step_id: string; run_id: string },
  rawOutput: string,
  terminalEnvelope: boolean,
): Promise<void> {
  const stepPath = home.paths.executionStep(intent.episodeId, step.execution_step_id);
  const durableStep = JSON.parse(await readFile(stepPath, "utf8")) as Record<string, unknown>;
  durableStep["status"] = "completed";
  durableStep["error_code"] = null;
  durableStep["reason"] = rawOutput;
  durableStep["productive"] = false;
  await writeFile(stepPath, `${JSON.stringify(durableStep, null, 2)}\n`, "utf8");

  if (!terminalEnvelope) return;
  const envelopePath = runPaths(home.root, "fixture", step.run_id).envelope;
  const envelope = JSON.parse(await readFile(envelopePath, "utf8")) as Record<string, unknown>;
  envelope["status"] = "completed";
  envelope["finished_at"] = NOW.toISOString();
  envelope["verdict_summary"] = rawOutput;
  delete envelope["error_code"];
  delete envelope["terminal_reason"];
  await writeFile(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}

function completed(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime: "codex", id: "thread-planner-test" },
    usage: {
      tokensIn: 25,
      tokensOut: 20,
      costUsd: 0.1,
      subagentTurns: 0,
      wallClockMs: 100,
      quality: "complete",
    },
    escalations: [],
  };
}
