import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EpisodePlanValidationError,
  episodeIntentHash,
  type EpisodeIntent,
  type EpisodePlan,
} from "../src/loop/episode-plan.js";
import {
  readExecutionSteps,
  type AdmissionFactor,
  type AuthorizedPass,
} from "../src/loop/efficiency.js";
import { admitPlannedEpisodeRoute } from "../src/loop/planner-admission.js";
import {
  assertTicketEpisodePlanValid,
  validateTicketEpisodePlan,
  type TicketEpisodePlanIssue,
} from "../src/loop/ticket-episode-plan.js";
import {
  prepareEpisodePlanWithRuntime,
  type ProviderEpisodePlannerOptions,
} from "../src/org/episode-planner/runtime.js";
import type { AppEntry } from "../src/org/apps.js";
import { FakeRuntime } from "../src/runtime/testing/fakeRuntime.js";
import { readEnvelope } from "../src/runtime/runlog/envelope.js";
import { runPaths } from "../src/runtime/runlog/paths.js";
import { readTurnRecords } from "../src/runtime/telemetry.js";
import type {
  RoleConfig,
  TurnAssignment,
  TurnResult,
} from "../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

const FIXTURE_DIR = join(import.meta.dirname, "fixtures", "episode-planner");
const INITIAL_OUTPUT_SHA256 = "a7bb5ef21237e47e714f2847985efb4e75ba4b4446891c23203674b66eb28dd7";
const REPAIR_OUTPUT_SHA256 = "ea6cb9e7310dd611daa4911c54535056cb42199289da5bec7f091f7cb96f61e3";
const INTENT_SHA256 = "8230a2bb403303fca55594e3a72153fd143e473e2164a2e92af7908723301d36";
const NOW = new Date("2026-07-21T00:06:53.053Z");

describe("Buildstacks onboarding EpisodePlanner regression", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("keeps exact retained output payloads and their immutable intent identity", async () => {
    const { intent, initialOutput, repairOutput } = await observedFixture();
    expect(sha256(initialOutput)).toBe(INITIAL_OUTPUT_SHA256);
    expect(sha256(repairOutput)).toBe(REPAIR_OUTPUT_SHA256);
    expect(episodeIntentHash(intent)).toBe(INTENT_SHA256);
  });

  it("recovers the exact failed repair output token-free without rewriting failed accounting evidence", async () => {
    home = makeOrgHome();
    const { intent, initialOutput, repairOutput } = await observedFixture();
    const runtime = new FakeRuntime([
      { result: completed(initialOutput) },
      { result: completed(repairOutput) },
    ], "claude");
    const factory = vi.fn(() => runtime);
    const oldValidator = (plan: EpisodePlan): void => {
      // Recreate the two retained terminal classifications after asserting
      // that the new normalization has already corrected only code-owned
      // values. Provider output files themselves remain byte-for-byte exact.
      if (plan.workflowClass === "build-review-ship") {
        expect(plan.estimatedBudget).toEqual({
          providerTurns: 3,
          providerTurnBudgetUsd: 45,
          mechanicalOverheadUsd: 0,
          totalBudgetUsd: 45,
        });
        expect(provider(plan, "implement").inputRefs).toContainEqual({
          ref: "plan-output:build_contract",
          required: true,
        });
        throw new EpisodePlanValidationError([{
          code: "plan_budget_arithmetic_invalid",
          message: "estimated budget does not equal the plan's exact turn budgets plus overhead",
        }]);
      }
      expect(provider(plan, "implement").inputRefs).toContainEqual({
        ref: "plan-output:contract",
        required: true,
      });
      throw new EpisodePlanValidationError([{
        code: "plan_structure_invalid",
        message: "ticket_plan_output_ref_invalid: retained dot-form output references",
        path: "$.steps",
        constraint: "ticket_plan_output_ref_invalid",
        expected: "canonical plan-output references",
        received: "qualified dot-form aliases",
      }]);
    };
    const originalOptions = onboardingOptions(
      home.root,
      intent,
      factory,
      oldValidator,
    );

    await expect(prepareEpisodePlanWithRuntime(originalOptions)).rejects.toMatchObject({
      code: "error_episode_planner_failed",
      attempts: 2,
    });
    expect(runtime.calls).toHaveLength(2);
    expect(runtime.calls[0]!.req.task).toContain('"format": "plan-output:<output-id>"');
    expect(runtime.calls[0]!.req.task).toContain('"mechanicalOverheadUsd": 0');
    const terminalBefore = await readExecutionSteps(home.root, intent.episodeId);
    expect(terminalBefore.map((step) => [step.status, step.error_code])).toEqual([
      ["failed", "plan_budget_arithmetic_invalid"],
      ["failed", "plan_structure_invalid"],
    ]);
    const envelopeBytesBefore = await Promise.all(terminalBefore.map((step) =>
      readFile(runPaths(home.root, intent.app, step.run_id).envelope, "utf8")
    ));
    const ledgerPath = join(home.root, "telemetry", "2026-07-21.jsonl");
    const ledgerBytesBefore = await readFile(ledgerPath, "utf8");

    const ticketDiagnostics: TicketEpisodePlanIssue[][] = [];
    const currentValidator = vi.fn((plan: EpisodePlan) => {
      ticketDiagnostics.push(validateTicketEpisodePlan(plan).issues);
      assertTicketEpisodePlanValid(plan);
    });
    const resumed = await prepareEpisodePlanWithRuntime(onboardingOptions(
      home.root,
      intent,
      factory,
      currentValidator,
    ));

    expect(runtime.calls).toHaveLength(2);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(currentValidator.mock.calls.map(([plan]) => plan.workflowClass)).toEqual([
      "build-review-ship",
      "greenfield_slice_delivery",
    ]);
    expect(ticketDiagnostics).toEqual([
      expect.arrayContaining([
        expect.objectContaining({
          code: "ticket_topology_invalid",
          message: "ticket/review-authorization must follow every review lens for its gated revision",
        }),
      ]),
      [],
    ]);
    expect(resumed.plannerAttempts).toBe(2);
    expect(resumed.plan.workflowClass).toBe("greenfield_slice_delivery");
    expect(resumed.plan.estimatedBudget).toEqual({
      providerTurns: 3,
      providerTurnBudgetUsd: 45,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 45,
    });
    expect(resumed.plan.steps.flatMap((step) => step.inputRefs)
      .filter((input) => input.ref.startsWith("plan-output:"))
      .map((input) => input.ref)).toEqual([
        "plan-output:contract",
        "plan-output:implementation",
        "plan-output:pr",
        "plan-output:merge-verdict",
        "plan-output:pr",
      ]);
    expect(await readExecutionSteps(home.root, intent.episodeId)).toEqual(terminalBefore);
    expect(await Promise.all(terminalBefore.map((step) =>
      readFile(runPaths(home.root, intent.app, step.run_id).envelope, "utf8")
    ))).toEqual(envelopeBytesBefore);
    expect(await readFile(ledgerPath, "utf8")).toBe(ledgerBytesBefore);
    expect((await readTurnRecords(home.root)).map((record) => record.status))
      .toEqual(["failed", "failed"]);
    expect(await readEnvelope(home.root, intent.app, terminalBefore[1]!.run_id))
      .toMatchObject({ status: "failed", error_code: "plan_structure_invalid" });

    const factor: AdmissionFactor = {
      kind: "uncertainty",
      evidence: "accepted onboarding plan",
      policy_rule: "accepted_episode_plan",
    };
    expect(resumed.plan.derivedSafetyRoute.label).toBe("standard");
    const admitted = await admitPlannedEpisodeRoute({
      root: home.root,
      episodeId: intent.episodeId,
      app: intent.app,
      route: "standard",
      policyVersion: "episode-planner/onboarding-regression-v1",
      factors: [factor],
      passes: authorizedPasses(resumed.plan, intent, factor),
      budgetOverrides: {
        provider_turns: intent.hardBudget.maxProviderTurns,
        equivalent_cost_usd: intent.hardBudget.maxEquivalentCostUsd,
        active_time_ms: intent.hardBudget.maxActiveTimeMs!,
        human_decisions: intent.hardBudget.maxHumanDecisions!,
      },
      executionBounds: null,
      now: NOW,
    });
    expect(admitted.consumedBeforeRoute).toEqual({
      providerTurns: 2,
      equivalentCostUsd: 0.2,
      activeTimeMs: 0,
    });
  });
});

async function observedFixture(): Promise<{
  intent: EpisodeIntent;
  initialOutput: string;
  repairOutput: string;
}> {
  const [intentRaw, initialRaw, repairRaw] = await Promise.all([
    readFile(join(FIXTURE_DIR, "onboarding-intent.json"), "utf8"),
    readFile(join(FIXTURE_DIR, "onboarding-initial-output.md"), "utf8"),
    readFile(join(FIXTURE_DIR, "onboarding-repair-output.md"), "utf8"),
  ]);
  return {
    intent: JSON.parse(intentRaw) as EpisodeIntent,
    initialOutput: initialRaw.trimEnd(),
    repairOutput: repairRaw.trimEnd(),
  };
}

function onboardingOptions(
  root: string,
  intent: EpisodeIntent,
  runtimeForAssignment: (assignment: TurnAssignment, role: RoleConfig) => FakeRuntime,
  validateAcceptedPlan: (plan: EpisodePlan) => void,
): ProviderEpisodePlannerOptions {
  return {
    root,
    app: onboardingApp(intent),
    roles: onboardingRoles(intent),
    intent,
    promptText: "Return exactly one EpisodePlan JSON object.",
    context: { taste: [], memoryExcerpts: [] },
    workdir: root,
    hooks: { gate: () => ({ allow: true as const }) },
    runtimeForAssignment,
    policyVersion: "episode-planner/onboarding-regression-v1",
    limits: {
      maxAttempts: 2,
      perAttempt: {
        equivalentCostUsd: 1,
        activeTimeMs: 60_000,
      },
      aggregate: {
        providerTurns: 2,
        equivalentCostUsd: 2,
        activeTimeMs: 120_000,
      },
    },
    now: () => NOW,
    validateAcceptedPlan,
  };
}

function onboardingApp(intent: EpisodeIntent): AppEntry {
  return {
    name: intent.app,
    repo: "buildstacks-dev/sonnet2-buildstack-dev",
    status: "onboarding",
    budgetUsdMonth: 1_000,
    cadence: {},
    execution: { assignmentMode: "fixed", allowedAssignments: {} },
  };
}

function onboardingRoles(intent: EpisodeIntent): RoleConfig[] {
  const ceilingByRole = new Map(intent.allowedAssignments.map((candidate) => [
    candidate.role,
    candidate.maxTurnCostUsd,
  ]));
  return intent.availableRoles.map((role): RoleConfig => {
    const assignment = role.configuredAssignment;
    if (assignment === undefined) {
      throw new Error(`fixture role ${role.role} has no configured assignment`);
    }
    return {
      name: role.role,
      runtime: assignment.harness,
      model: assignment.model,
      effort: assignment.effort,
      delegation: { allow: [] },
      triggers: [],
      outputs: [...role.expectedOutputs],
      maxTurnBudgetUsd: ceilingByRole.get(role.role)!,
    };
  });
}

function provider(plan: EpisodePlan, id: string) {
  const step = plan.steps.find((candidate) => candidate.id === id);
  if (step?.kind !== "provider_turn") throw new Error(`missing provider step ${id}`);
  return step;
}

function authorizedPasses(
  plan: EpisodePlan,
  intent: EpisodeIntent,
  factor: AdmissionFactor,
): AuthorizedPass[] {
  return plan.steps.flatMap((step): AuthorizedPass[] => {
    if (step.kind !== "provider_turn") return [];
    const metadata = intent.allowedAssignments.find((candidate) =>
      candidate.role === step.role &&
      candidate.assignment.harness === step.assignment.harness &&
      candidate.assignment.model === step.assignment.model &&
      candidate.assignment.effort === step.assignment.effort
    );
    if (metadata === undefined) throw new Error(`missing fixture assignment for ${step.id}`);
    return [{
      pipeline: "episode-plan-dag",
      pass: step.id,
      role: step.role,
      runtime: step.assignment.harness,
      model: step.assignment.model,
      effort: step.assignment.effort,
      factor_rules: [factor.policy_rule],
      assignment_source: step.assignmentSource,
      assignment_candidate_id: metadata.candidateId,
      plan_version: plan.version,
      plan_step_id: step.id,
      selection_reason: step.selectionReason,
      provider_family: metadata.providerFamily,
      resolved_capabilities: [...metadata.capabilities],
    }];
  });
}

function completed(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime: "claude", id: "onboarding-regression-session" },
    usage: {
      tokensIn: 100,
      tokensOut: 100,
      costUsd: 0.1,
      subagentTurns: 0,
      wallClockMs: 100,
      quality: "complete",
    },
    escalations: [],
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
