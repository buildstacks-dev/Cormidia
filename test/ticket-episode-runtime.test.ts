import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultGate } from "../src/runtime/gate.js";
import type {
  ContextBundle,
  RoleConfig,
  Runtime,
  TurnAssignment,
  TurnRequest,
  TurnResult,
} from "../src/runtime/types.js";
import { baseRevisionForBranch } from "../src/loop/default-branch.js";
import type {
  AcceptedTicketEpisodePlan,
  TicketEpisodePlanningRequest,
} from "../src/loop/driver.js";
import {
  deriveEpisodeSafetyRoute,
  episodeIntentHash,
  persistEpisodePlan,
  type CreatorEpisodeScope,
  type EpisodeIntent,
  type EpisodePlan,
  type EpisodePlanValidationPolicy,
  type ProviderTurnStep,
} from "../src/loop/episode-plan.js";
import { routeAdmissionForEpisodePlan } from "../src/loop/episode-route.js";
import { admitPlannedEpisodeRoute } from "../src/loop/planner-admission.js";
import type { Policy } from "../src/loop/policy.js";
import type { LoopItem } from "../src/loop/types.js";
import { resolvedRuntimeCapabilities } from "../src/runtime/capabilities.js";
import { hashedFileStem } from "../src/runtime/runlog/paths.js";
import { readEpisodePlanExecutionJournal } from "../src/loop/episode-plan-executor.js";
import { efficiencyEpisodeDir } from "../src/loop/efficiency.js";
import {
  createTicketEpisodeRuntime,
  type TicketEpisodeRuntime,
} from "../src/org/ticket-episode-runtime.js";
import type { AppEntry } from "../src/org/apps.js";
import { makeBareWithClone } from "./fixtures/gitRepo.js";
import { makeOrgHome } from "./fixtures/orgHome.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

const NOW = new Date("2026-07-19T22:30:00.000Z");
const ASSIGNMENT: TurnAssignment = {
  harness: "codex",
  model: "builder-model-test",
  effort: "high",
};
const PLANNER_ASSIGNMENT: TurnAssignment = {
  harness: "claude",
  model: "planner-model-test",
  effort: "medium",
};
const BUILDER: RoleConfig = role("builder", ASSIGNMENT, 2);
const PLANNER: RoleConfig = role("planner", PLANNER_ASSIGNMENT, 1);
const REVIEWER: RoleConfig = role("reviewer", {
  harness: "claude",
  model: "reviewer-model-test",
  effort: "high",
}, 2);
const ROLES = [PLANNER, BUILDER, REVIEWER] as const;
const CONTEXT: ContextBundle = { taste: ["test authority"], memoryExcerpts: [] };
const POLICY: Policy = {
  riskTiers: { high: [], medium: [], low: [] },
  gates: { high: [], medium: [], low: [] },
  dimensionGlobs: {},
  remediation: { maxAttempts: 3 },
};

describe("ticket EpisodePlanner execution adapter", () => {
  it("executes one provider call with the exact accepted assignment and role authority", async () => {
    const fixture = await setup("diagnose", "ticket/diagnose");
    try {
      const calls: ObservedCall[] = [];
      const runtime = makeTicketRuntime(fixture, calls, "bounded diagnostic evidence");
      const beforeProviderTurn = vi.fn(async () => undefined);

      const item = await runtime.executeTicketPlan({
        request: fixture.request,
        accepted: fixture.accepted,
        item: fixture.item,
        beforeProviderTurn,
      });
      expect(item.phase).toBe("building");
      expect(beforeProviderTurn).toHaveBeenCalledOnce();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        assignment: ASSIGNMENT,
        factoryRole: BUILDER,
        requestAssignment: ASSIGNMENT,
        requestRole: BUILDER,
      });
      expect(calls[0]?.request.context.execution).toMatchObject({
        role: "builder",
        assignment: ASSIGNMENT,
        roleDelegation: BUILDER.delegation,
      });
      expect(await readEpisodePlanExecutionJournal(fixture.state.root, fixture.accepted.plan.episodeId))
        .toMatchObject({ status: "completed" });

      const outputDir = join(
        efficiencyEpisodeDir(fixture.state.root, fixture.accepted.plan.episodeId),
        "ticket-step-outputs",
        "v1",
      );
      const output = JSON.parse(readFileSync(join(outputDir, `${hashedFileStem("diagnose")}.json`), "utf8")) as {
        status: string;
        payloadSha256: string;
        payload: { providerOutput: string };
      };
      expect(output).toMatchObject({
        status: "completed",
        payload: { providerOutput: "bounded diagnostic evidence" },
      });
      expect(output.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      fixture.cleanup();
    }
  });

  it("recovers terminal provider evidence after an outer comment crash without rerunning the model", async () => {
    const fixture = await setup("contract", "build/contract", true);
    try {
      const gh = new FailFirstCommentGh({
        cloneRoot: fixture.repo.clone.root,
        issues: [ticketSeed()],
      });
      fixture.replaceGh(gh);
      const calls: ObservedCall[] = [];
      const runtime = makeTicketRuntime(
        fixture,
        calls,
        JSON.stringify({
          files: ["src/parser.ts"],
          approach: "Make the bounded parser correction.",
          tests: [{ criterionId: "AC1", tests: ["pnpm test parser"] }],
          risks: "Localized parser behavior only.",
          complexity: "low",
        }),
      );

      await expect(runtime.executeTicketPlan({
        request: fixture.request,
        accepted: fixture.accepted,
        item: fixture.item,
        beforeProviderTurn: async () => undefined,
      })).rejects.toMatchObject({ code: "error_episode_plan_step_interrupted" });
      expect(calls).toHaveLength(1);
      expect(gh.issueComments.get(7)).toBeUndefined();

      const recovered = await runtime.executeTicketPlan({
        request: fixture.request,
        accepted: fixture.accepted,
        item: fixture.item,
        beforeProviderTurn: async () => {
          throw new Error("provider must not restart during evidence replay");
        },
      });

      expect(calls).toHaveLength(1);
      expect(recovered.contract).toContain("## Implementation contract");
      expect(gh.issueComments.get(7)).toHaveLength(1);
      expect(gh.issueComments.get(7)?.[0]).toContain("execution-id=");
      expect(await readEpisodePlanExecutionJournal(fixture.state.root, fixture.accepted.plan.episodeId))
        .toMatchObject({ status: "completed" });
    } finally {
      fixture.cleanup();
    }
  });

  it("fails an invalid typed verdict after one provider turn and never launches a hidden reformat", async () => {
    const fixture = await setup("invalid-contract", "build/contract", true);
    try {
      const calls: ObservedCall[] = [];
      const runtime = makeTicketRuntime(fixture, calls, "not a contract verdict");

      const item = await runtime.executeTicketPlan({
        request: fixture.request,
        accepted: fixture.accepted,
        item: fixture.item,
        beforeProviderTurn: async () => undefined,
      });

      expect(calls).toHaveLength(1);
      expect(item.phase).toBe("returned");
      expect(await readEpisodePlanExecutionJournal(fixture.state.root, fixture.accepted.plan.episodeId))
        .toMatchObject({
          status: "failed",
          events: expect.arrayContaining([
            expect.objectContaining({
              kind: "step_failed",
              reason_code: "error_verdict_unparseable",
            }),
          ]),
        });
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a planner allowance that leaves no delivery budget before runtime construction", async () => {
    const fixture = await setup("budget", "ticket/diagnose", false, false);
    try {
      const runtimeForAssignment = vi.fn((): Runtime => ({
        kind: "codex",
        async runTurn(): Promise<TurnResult> {
          throw new Error("no provider should be constructed");
        },
      }));
      const runtime = createTicketEpisodeRuntime({
        ...fixture.runtimeOptions,
        remainingBudgetUsd: 0.5,
        plannerPromptText: "Return one EpisodePlan JSON object.",
        plannerLimits: {
          maxAttempts: 1,
          perAttempt: {
            inputTokens: 1_000,
            equivalentCostUsd: 0.5,
            activeTimeMs: 1_000,
          },
          aggregate: {
            providerTurns: 1,
            inputTokens: 1_000,
            equivalentCostUsd: 0.5,
            activeTimeMs: 1_000,
          },
        },
        runtimeForAssignment,
      });

      await expect(runtime.planTicket(fixture.request)).rejects.toThrow(
        /must be positive and leave delivery budget/,
      );
      expect(runtimeForAssignment).not.toHaveBeenCalled();
    } finally {
      fixture.cleanup();
    }
  });
});

interface ObservedCall {
  assignment: TurnAssignment;
  factoryRole: RoleConfig;
  requestAssignment?: TurnAssignment;
  requestRole: RoleConfig;
  request: TurnRequest;
}

interface Fixture {
  state: ReturnType<typeof makeOrgHome>;
  org: ReturnType<typeof makeOrgHome>;
  repo: ReturnType<typeof makeBareWithClone>;
  gh: FakeGhOps;
  request: TicketEpisodePlanningRequest;
  accepted: AcceptedTicketEpisodePlan;
  item: LoopItem;
  runtimeOptions: Parameters<typeof createTicketEpisodeRuntime>[0];
  replaceGh(gh: FakeGhOps): void;
  cleanup(): void;
}

async function setup(
  stepId: string,
  operation: string,
  needsPrompt = false,
  persist = true,
): Promise<Fixture> {
  const state = makeOrgHome();
  const org = makeOrgHome();
  const repo = makeBareWithClone();
  if (needsPrompt) {
    mkdirSync(join(org.root, "prompts", "build"), { recursive: true });
    writeFileSync(join(org.root, "prompts", "build", "contract.md"), "Return the contract verdict.");
  }
  let gh = new FakeGhOps({
    cloneRoot: repo.clone.root,
    issues: [ticketSeed()],
  });
  const app: AppEntry = {
    name: "fixture",
    repo: "fixture/repo",
    status: "live",
    budgetUsdMonth: 100,
    cadence: {},
    execution: { assignmentMode: "fixed", allowedAssignments: {} },
  };
  const step = providerStep(stepId, operation);
  const accepted = authority(step);
  if (persist) {
    await persistEpisodePlan({
      root: state.root,
      intent: accepted.intent,
      plan: accepted.plan,
      policy: validationPolicy(),
    });
    await admitPlannedEpisodeRoute(routeAdmissionForEpisodePlan({
      root: state.root,
      intent: accepted.intent,
      plan: accepted.plan,
      now: NOW,
    }));
  }
  const request: TicketEpisodePlanningRequest = {
    root: state.root,
    episodeId: accepted.plan.episodeId,
    app: app.name,
    targetRepo: app.repo,
    localRepo: repo.clone.root,
    base: baseRevisionForBranch("main"),
    ticket: {
      issueNumber: 7,
      ticketRef: "#7",
      title: "Fix a bounded parser bug",
      body: ticketSeed().body!,
      labels: ["op:building"],
    },
  };
  const item: LoopItem = {
    issueNumber: 7,
    ticketRef: "#7",
    title: request.ticket.title,
    body: request.ticket.body,
    targetRepo: app.repo,
    labels: ["op:building"],
    phase: "building",
    tier: "standard",
    cycles: 0,
    remediationAttempts: 0,
    gateResults: [],
    findings: [],
    branch: "op/7-parser",
    worktree: repo.clone.root,
  };
  const runtimeOptions: Fixture["runtimeOptions"] = {
    root: state.root,
    orgRoot: org.root,
    app,
    roles: ROLES,
    gh,
    policy: POLICY,
    commands: {},
    hooks: { gate: defaultGate },
    runtimeForAssignment: () => {
      throw new Error("test must supply a runtime factory");
    },
    plannerContext: CONTEXT,
    remainingBudgetUsd: 50,
    now: () => NOW,
  };
  const fixture: Fixture = {
    state,
    org,
    repo,
    gh,
    request,
    accepted,
    item,
    runtimeOptions,
    replaceGh(nextGh) {
      gh = nextGh;
      fixture.gh = nextGh;
      fixture.runtimeOptions = { ...fixture.runtimeOptions, gh: nextGh };
    },
    cleanup() {
      state.cleanup();
      org.cleanup();
      repo.cleanup();
    },
  };
  return fixture;
}

function makeTicketRuntime(
  fixture: Fixture,
  calls: ObservedCall[],
  summary: string,
): TicketEpisodeRuntime {
  return createTicketEpisodeRuntime({
    ...fixture.runtimeOptions,
    runtimeForAssignment: (assignment, roleConfig): Runtime => ({
      kind: assignment.harness,
      async runTurn(request): Promise<TurnResult> {
        calls.push({
          assignment: structuredClone(assignment),
          factoryRole: structuredClone(roleConfig),
          ...(request.assignment === undefined
            ? {}
            : { requestAssignment: structuredClone(request.assignment) }),
          requestRole: structuredClone(request.role),
          request,
        });
        return {
          status: "completed",
          summary,
          artifacts: [],
          session: { runtime: assignment.harness, id: `session-${calls.length}` },
          usage: {
            tokensIn: 10,
            tokensOut: 5,
            costUsd: 0.01,
            subagentTurns: 0,
            wallClockMs: 5,
          },
          escalations: [],
        };
      },
    }),
  });
}

function providerStep(stepId: string, operation: string): ProviderTurnStep {
  return {
    kind: "provider_turn",
    operation,
    id: stepId,
    role: "builder",
    objective: `Execute ${operation}`,
    dependsOn: [],
    requiredCapabilities: ["tool_gate"],
    assignment: ASSIGNMENT,
    assignmentSource: "configured",
    inputRefs: [{ ref: "github:#7", required: true }],
    expectedOutputs: [{ id: `${stepId}-evidence`, kind: "evidence", required: true }],
    maxTurnBudgetUsd: 2,
    selectionReason: "One bounded provider turn is sufficient for this test ticket",
  };
}

function authority(step: ProviderTurnStep): AcceptedTicketEpisodePlan {
  const creatorStep = Object.fromEntries(
    Object.entries(step).filter(([key]) => key !== "assignmentSource"),
  ) as NonNullable<CreatorEpisodeScope["steps"]>[number];
  const provenance = {
    source: "agent" as const,
    creatorId: "parent-episode-planner",
    createdAt: NOW.toISOString(),
    evidenceRefs: ["parent-plan:v1"],
  };
  const creatorScope: CreatorEpisodeScope = {
    planningDisposition: "execution_ready",
    provenance,
    objective: "Fix a bounded parser bug",
    inScope: ["bounded ticket evidence"],
    outOfScope: ["unrelated product work"],
    acceptanceCriteria: ["the planned step produces its required evidence"],
    expectedArtifacts: step.expectedOutputs.map((output) => ({ ...output })),
    declaredConstraints: { network: false },
    safetyFacts: [],
    steps: [{ ...creatorStep }],
  };
  const intent: EpisodeIntent = {
    episodeId: "ticket:fixture:#7",
    app: "fixture",
    assignmentMode: "fixed",
    trigger: { kind: "github_issue", sourceRef: "fixture/repo#7" },
    goal: "Fix a bounded parser bug",
    lifecycle: "existing-ticket",
    appStage: "growth",
    repositoryFacts: { baseRef: "refs/remotes/origin/main" },
    requestedConstraints: { network: false },
    hardBudget: {
      maxProviderTurns: 1,
      maxEquivalentCostUsd: 2,
      maxMechanicalOverheadUsd: 0,
    },
    availableRoles: [{
      role: "builder",
      responsibility: "Implement or diagnose the bounded ticket",
      requiredCapabilities: ["tool_gate"],
      expectedOutputs: ["patch"],
      configuredAssignment: ASSIGNMENT,
    }],
    allowedAssignments: [{
      candidateId: "configured",
      role: "builder",
      assignment: ASSIGNMENT,
      providerFamily: "openai",
      capabilities: resolvedRuntimeCapabilities("codex"),
      qualificationRef: "configured-role-assignment:builder",
      priceRef: "role.max_turn_budget_usd",
      maxTurnCostUsd: 2,
      available: true,
    }],
    requiredSafetyFacts: [],
    creatorScope,
  };
  const plan: EpisodePlan = {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: intent.goal,
    workflowClass: "bounded-ticket-test",
    planningSource: "creator_scope",
    creatorProvenance: provenance,
    steps: [step],
    estimatedBudget: {
      providerTurns: 1,
      providerTurnBudgetUsd: 2,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 2,
    },
    derivedSafetyRoute: deriveEpisodeSafetyRoute([step], []),
    createdAt: NOW.toISOString(),
  };
  return { intent, plan };
}

function validationPolicy(): EpisodePlanValidationPolicy {
  return {
    mode: "fixed",
    configuredAssignmentFor: (name) => name === "builder" ? ASSIGNMENT : undefined,
    isAssignmentAllowed: (name, assignment) =>
      name === "builder" && JSON.stringify(assignment) === JSON.stringify(ASSIGNMENT),
    isKnownRole: (name) => name === "builder",
    capabilitiesFor: () => resolvedRuntimeCapabilities("codex"),
    requiredTerminalOutputIds: [],
  };
}

function role(name: string, assignment: TurnAssignment, maxTurnBudgetUsd: number): RoleConfig {
  return {
    name,
    runtime: assignment.harness,
    model: assignment.model,
    effort: assignment.effort,
    delegation: { allow: [] },
    triggers: [],
    outputs: ["evidence"],
    maxTurnBudgetUsd,
  };
}

function ticketSeed(): { number: number; title: string; body: string; labels: string[] } {
  return {
    number: 7,
    title: "Fix a bounded parser bug",
    body: [
      "## Goal",
      "Fix a bounded parser bug.",
      "",
      "## Acceptance criteria",
      "- [ ] parser regression is covered",
      "",
    ].join("\n"),
    labels: ["op:building"],
  };
}

class FailFirstCommentGh extends FakeGhOps {
  private fail = true;

  override async commentIssue(issueNumber: number, body: string): Promise<void> {
    if (this.fail) {
      this.fail = false;
      throw new Error("injected crash after provider terminal evidence");
    }
    await super.commentIssue(issueNumber, body);
  }
}
