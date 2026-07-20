import { afterEach, describe, expect, it } from "vitest";
import {
  episodeIntentHash,
  type EpisodeIntent,
  type ProposedEpisodePlan,
  type ProposedEpisodeStep,
  type SafetyFact,
} from "../src/loop/episode-plan.js";
import { prepareEpisodePlan } from "../src/org/episode-planner/coordinator.js";
import { buildEpisodeIntent } from "../src/org/episode-planner/policy.js";
import type { AppEntry } from "../src/org/apps.js";
import type { RoleConfig, RuntimeKind } from "../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

interface Scenario {
  id: string;
  safety: SafetyFact[];
  steps: ProposedEpisodeStep[];
  presentRoles: string[];
  absentRoles: string[];
}

describe("EpisodePlanner proportional scenario contracts", () => {
  const homes: OrgHomeFixture[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) home.cleanup();
  });

  const scenarios: Scenario[] = [
    {
      id: "mechanical-docs",
      safety: [],
      steps: [provider("edit", "builder", [], "docs-change", "A bounded edit still needs one implementation turn")],
      presentRoles: ["builder"],
      absentRoles: ["planner", "reviewer", "sre", "support", "marketing"],
    },
    {
      id: "simple-localized-bug",
      safety: [],
      steps: [provider("build", "builder", [], "patch", "Localized reproduction and implementation fit one turn")],
      presentRoles: ["builder"],
      absentRoles: ["planner", "reviewer", "sre"],
    },
    {
      id: "complex-ambiguous-bug",
      safety: [{ kind: "independent_review", evidenceRefs: ["trigger:ambiguous"] }],
      steps: [
        provider("diagnose", "builder", [], "reproduction", "Ambiguity requires diagnosis before mutation"),
        provider("implement", "builder", ["diagnose"], "patch", "Reproduction evidence bounds implementation"),
        provider("review", "reviewer", ["implement"], "accepted", "Independent provider review is a typed safety fact"),
      ],
      presentRoles: ["builder", "reviewer"],
      absentRoles: ["sre", "support", "marketing"],
    },
    {
      id: "simple-prototype",
      safety: [],
      steps: [
        provider("shape", "planner", [], "prototype-scope", "Product scope is needed before a bounded prototype"),
        provider("prototype", "builder", ["shape"], "prototype", "Build only the bounded prototype"),
      ],
      presentRoles: ["planner", "builder"],
      absentRoles: ["reviewer", "sre", "marketing"],
    },
    {
      id: "full-product-decomposition",
      safety: [],
      steps: [
        provider("discover", "planner", [], "product-scope", "Product discovery precedes future delivery episodes"),
        gate("decompose", ["discover"], "child-episodes", "child-episode-decomposition"),
      ],
      presentRoles: ["planner"],
      absentRoles: ["builder", "reviewer", "sre"],
    },
    {
      id: "cloud-deployment",
      safety: [{ kind: "production_deployment", evidenceRefs: ["request:deploy"] }],
      steps: [
        provider("inspect", "sre", [], "deployment-plan", "Infrastructure inspection is SRE-owned"),
        gate("rollback", ["inspect"], "rollback-proof", "rollback"),
        approval("approve", ["rollback"], "approval", "critical-operation"),
        gate("rollout", ["approve"], "deployed", "rollout"),
      ],
      presentRoles: ["sre"],
      absentRoles: ["builder", "reviewer", "marketing"],
    },
    {
      id: "authentication-migration",
      safety: [
        { kind: "authentication", evidenceRefs: ["scope:auth"] },
        { kind: "data_migration", evidenceRefs: ["scope:migration"] },
        { kind: "independent_review", evidenceRefs: ["policy:sensitive"] },
      ],
      steps: [
        provider("implement", "builder", [], "migration", "Authentication and migration code is Builder-owned"),
        gate("security", ["implement"], "security-proof", "security"),
        gate("integrity", ["security"], "integrity-proof", "data-integrity"),
        gate("rollback", ["integrity"], "rollback-proof", "rollback"),
        provider("review", "reviewer", ["rollback"], "accepted", "Sensitive work requires independent review"),
      ],
      presentRoles: ["builder", "reviewer"],
      absentRoles: ["sre", "support", "marketing"],
    },
    {
      id: "incident_response",
      safety: [
        { kind: "incident_response", evidenceRefs: ["event:incident"] },
        { kind: "critical_operation", evidenceRefs: ["action:mitigate"] },
      ],
      steps: [
        provider("diagnose", "sre", [], "diagnosis", "SRE owns immediate diagnosis"),
        approval("approve", ["diagnose"], "mitigation-approval", "critical-operation"),
        provider("mitigate", "sre", ["approve"], "recovery", "Mitigation is separated from diagnosis by approval"),
        gate("follow-up", ["mitigate"], "follow-up-episode", "queue-follow-up"),
      ],
      presentRoles: ["sre"],
      absentRoles: ["builder", "reviewer", "marketing"],
    },
  ];

  for (const scenario of scenarios) {
    it(`${scenario.id} includes only proportionate roles and records why`, async () => {
      const home = makeOrgHome();
      homes.push(home);
      const intent = makeIntent(scenario);
      const prepared = await prepareEpisodePlan({
        root: home.root,
        app: app(),
        roles: roles(),
        intent,
        independentReview: scenario.safety.some((fact) => fact.kind === "independent_review")
          ? { subjectRoles: ["builder"], reviewerRoles: ["reviewer"] }
          : undefined,
        propose: async ({ proposalCreatedAt }) => proposal(scenario, intent, proposalCreatedAt),
      });
      const providerSteps = prepared.plan.steps.filter((step) => step.kind === "provider_turn");
      const plannedRoles = new Set(providerSteps.map((step) => step.role));
      for (const role of scenario.presentRoles) expect(plannedRoles, `${scenario.id}: ${role}`).toContain(role);
      for (const role of scenario.absentRoles) expect(plannedRoles, `${scenario.id}: ${role}`).not.toContain(role);
      expect(providerSteps.every((step) => step.selectionReason.trim().length > 0)).toBe(true);
      expect(prepared.plan.estimatedBudget.providerTurns).toBe(providerSteps.length);
    });
  }

  it("rejects an incident-response plan that omits SRE ownership", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const scenario = scenarios.find((candidate) => candidate.id === "incident_response");
    if (scenario === undefined) throw new Error("missing incident-response scenario");
    const intent = makeIntent(scenario);
    const builderOnly: Scenario = {
      ...scenario,
      steps: [
        provider(
          "respond",
          "builder",
          [],
          "recovery",
          "An implementation role must not replace SRE incident ownership",
        ),
      ],
    };

    await expect(prepareEpisodePlan({
      root: home.root,
      app: app(),
      roles: roles(),
      intent,
      propose: async ({ proposalCreatedAt }) => proposal(builderOnly, intent, proposalCreatedAt),
    })).rejects.toMatchObject({
      code: "error_episode_planner_failed",
      attempts: 2,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "plan_safety_provider_missing" }),
      ]),
    });
  });
});

function makeIntent(scenario: Scenario): EpisodeIntent {
  return buildEpisodeIntent({
    episodeId: `scenario:${scenario.id}`,
    app: app(),
    roles: roles(),
    trigger: { kind: "scenario", sourceRef: scenario.id },
    goal: `Execute ${scenario.id}`,
    lifecycle: scenario.id,
    appStage: "mature",
    repositoryFacts: { revision: "a".repeat(40), clean: true },
    requestedConstraints: { network: false },
    hardBudget: {
      maxProviderTurns: 8,
      maxEquivalentCostUsd: 20,
      maxMechanicalOverheadUsd: 1,
      maxHumanDecisions: 2,
    },
    requiredSafetyFacts: scenario.safety,
    requiredCapabilitiesByRole: Object.fromEntries(roles().map((role) => [role.name, ["tool_gate"]])),
  });
}

function proposal(
  scenario: Scenario,
  intent: EpisodeIntent,
  createdAt: string,
): ProposedEpisodePlan {
  const providerTurns = scenario.steps.filter((step) => step.kind === "provider_turn").length;
  const providerUsd = providerTurns * 2;
  return {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: `Smallest sufficient workflow for ${scenario.id}`,
    workflowClass: scenario.id,
    planningSource: "episode_planner",
    steps: scenario.steps,
    estimatedBudget: {
      providerTurns,
      providerTurnBudgetUsd: providerUsd,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: providerUsd,
    },
    derivedSafetyRoute: {
      label: "proposed",
      reasons: [scenario.id],
      gateStepIds: scenario.steps.filter((step) => step.kind === "mechanical_gate").map((step) => step.id),
      approvalStepIds: scenario.steps.filter((step) => step.kind === "approval").map((step) => step.id),
    },
    createdAt,
  };
}

function provider(
  id: string,
  role: string,
  dependsOn: string[],
  output: string,
  selectionReason: string,
): ProposedEpisodeStep {
  return {
    kind: "provider_turn",
    operation: `${role}/${id}`,
    id,
    role,
    objective: selectionReason,
    dependsOn,
    requiredCapabilities: ["tool_gate"],
    inputRefs: dependsOn.map((ref) => ({ ref, required: true })),
    expectedOutputs: [{ id: output, kind: "artifact", required: true }],
    maxTurnBudgetUsd: 2,
    selectionReason,
  };
}

function gate(
  id: string,
  dependsOn: string[],
  output: string,
  gateKind: string,
): ProposedEpisodeStep {
  return {
    kind: "mechanical_gate",
    id,
    gate: gateKind,
    objective: `Run ${gateKind}`,
    dependsOn,
    inputRefs: dependsOn.map((ref) => ({ ref, required: true })),
    expectedOutputs: [{ id: output, kind: "gate-evidence", required: true }],
  };
}

function approval(
  id: string,
  dependsOn: string[],
  output: string,
  approvalKind: string,
): ProposedEpisodeStep {
  return {
    kind: "approval",
    id,
    approvalKind,
    actionRef: `action:${id}`,
    objective: `Obtain ${approvalKind}`,
    dependsOn,
    inputRefs: dependsOn.map((ref) => ({ ref, required: true })),
    expectedOutputs: [{ id: output, kind: "approval", required: true }],
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
  return [
    role("planner", "claude", "claude-opus-4-8"),
    role("builder", "codex", "gpt-5.6-sol"),
    role("reviewer", "claude", "claude-opus-4-8"),
    role("sre", "codex", "gpt-5.6-sol"),
    role("support", "claude", "claude-sonnet-5"),
    role("marketing", "claude", "claude-sonnet-5"),
  ];
}

function role(name: string, runtime: RuntimeKind, model: string): RoleConfig {
  return {
    name,
    runtime,
    model,
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: [`${name}-output`],
    maxTurnBudgetUsd: 2,
  };
}
