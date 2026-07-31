// ISSUE-023: the plan topology was validated but never taught, and the bounded
// repair pass received only the error list — so it optimized for the reported
// errors and broke an invariant its input had satisfied. These tests pin the
// two halves of the fix: the contract now travels in the planner's bounded
// input (and its structured-output schema), and a repair that introduces a new
// violation is named as regressive instead of reported as a fresh failure.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  annotateRepairRegression,
  assessRepairRegression,
  episodeIntentHash,
  episodePlanProposalSchemaForOperations,
  type EpisodeIntent,
  type EpisodePlanIssue,
  type ProposedEpisodePlan,
} from "../src/loop/episode-plan.js";
import {
  TICKET_EPISODE_TOPOLOGY_CONTRACT,
  TICKET_MECHANICAL_GATE_KINDS,
  TICKET_PROVIDER_OPERATIONS,
} from "../src/loop/ticket-episode-plan.js";
import { renderEpisodePlannerBrief } from "../src/org/episode-planner/brief.js";
import { prepareEpisodePlan } from "../src/org/episode-planner/coordinator.js";
import { buildEpisodeIntent } from "../src/org/episode-planner/policy.js";
import type { AppEntry } from "../src/org/apps.js";
import type { RoleConfig, TurnAssignment } from "../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

const FIXED: TurnAssignment = { harness: "codex", model: "gpt-5.6-sol", effort: "high" };
const NOW = new Date("2026-07-19T18:00:00.000Z");

describe("the planner is taught the topology contract it is validated against", () => {
  it("ships the mechanical-gate registry, the rules, and a canonical reference topology", () => {
    const payload = brief(1, []);

    expect(payload["mechanicalGateRegistry"]).toEqual([...TICKET_MECHANICAL_GATE_KINDS].sort());
    const contract = payload["topologyContract"] as Record<string, unknown>;
    expect(contract["kind"]).toBe("ticket-episode-topology-contract");

    // Every gate the executor can run is described, with the durable inputs it
    // consumes but does not produce.
    const registry = contract["mechanicalGateRegistry"] as Array<Record<string, unknown>>;
    expect(registry.map((entry) => entry["gate"]).sort())
      .toEqual([...TICKET_MECHANICAL_GATE_KINDS].sort());
    expect(registry.find((entry) => entry["gate"] === "ticket/gates-and-pr"))
      .toMatchObject({
        requiredPlanInputs: [{
          input: "criterion_test_contract_mapping",
          producedBy: "build/contract",
        }],
      });

    // The rules are enumerated, including the ones run 3 broke.
    const rules = contract["topologyRules"] as Array<{ id: string; statement: string }>;
    expect(rules.map((rule) => rule.id)).toEqual(expect.arrayContaining([
      "gate_inputs_produced_by_ancestor",
      "review_authorization_joins_review_lenses",
      "review_lens_feeds_review_authorization",
      "ship_follows_every_ship_check",
    ]));
    expect(rules.every((rule) => rule.statement.length > 0)).toBe(true);
    const structure = contract["planStructureRules"] as Array<{ id: string }>;
    expect(structure.map((rule) => rule.id)).toContain("terminal_step_with_required_output");

    // The known-good worked example: ticket #9's accepted plan-v1, the one
    // plan in this project's history that shipped itself end to end.
    const reference = contract["canonicalReferenceTopology"] as {
      steps: Array<{ id: string; operation?: string; gate?: string }>;
    };
    expect(reference.steps.map((step) => step.operation ?? step.gate)).toEqual([
      "ticket/provision",
      "build/contract",
      "build/implement",
      "ticket/gates-and-pr",
      "review/verify",
      "ticket/review-authorization",
      "ticket/ship",
    ]);
  });

  it("closes the mechanical-gate vocabulary in the structured-output schema", () => {
    const schema = episodePlanProposalSchemaForOperations(TICKET_PROVIDER_OPERATIONS, {
      mechanicalGates: TICKET_MECHANICAL_GATE_KINDS,
    });

    expect(gateEnum(schema)).toEqual([...TICKET_MECHANICAL_GATE_KINDS].sort());
    // Same schema object reaches the planner through the brief.
    expect(gateEnum(brief(1, [])["proposalSchema"])).toEqual(
      [...TICKET_MECHANICAL_GATE_KINDS].sort(),
    );
  });

  it("leaves the gate vocabulary open when no registry is supplied", () => {
    const schema = episodePlanProposalSchemaForOperations(TICKET_PROVIDER_OPERATIONS);
    expect(gateEnum(schema)).toBeUndefined();
    expect(() => episodePlanProposalSchemaForOperations(TICKET_PROVIDER_OPERATIONS, {
      mechanicalGates: [],
    })).toThrow(/mechanical gate registry must not be empty/);
  });

  it("tells the repair pass which invariants its input already satisfied", () => {
    const payload = brief(2, [{
      code: "plan_structure_invalid",
      message: "ticket_topology_invalid: ticket/ship must follow ship-check ship_check",
      stepId: "ship",
      constraint: "ticket_topology_invalid",
      rule: "ship_follows_every_ship_check",
    }]);
    const repair = payload["repairContract"] as {
      mustBeNonRegressive: boolean;
      violatedInvariants: string[];
      invariantsAlreadySatisfied: string[];
    };

    expect(repair.mustBeNonRegressive).toBe(true);
    expect(repair.violatedInvariants).toEqual(["ship_follows_every_ship_check"]);
    // The invariant run 3's repair inverted is explicitly listed as one it must
    // keep, not silently omitted along with everything else.
    expect(repair.invariantsAlreadySatisfied).toContain("review_authorization_joins_review_lenses");
    expect(repair.invariantsAlreadySatisfied).toContain("review_lens_feeds_review_authorization");
    expect(repair.invariantsAlreadySatisfied).not.toContain("ship_follows_every_ship_check");
  });

  it("emits no repair contract on the first attempt", () => {
    expect(brief(1, [])["repairContract"]).toBeUndefined();
  });
});

describe("repair regression assessment", () => {
  const shipCheck: EpisodePlanIssue = {
    code: "plan_structure_invalid",
    message: "ticket/ship must follow ship-check",
    rule: "ship_follows_every_ship_check",
  };
  const invertedReview: EpisodePlanIssue = {
    code: "plan_structure_invalid",
    message: "ticket/review-authorization must follow every review lens",
    rule: "review_authorization_joins_review_lenses",
  };

  it("calls a repair regressive when it introduces a violation its input lacked", () => {
    // Exactly run 3: attempt 1 had one defect; the repair kept it and inverted
    // the review ordering attempt 1 had right.
    const assessment = assessRepairRegression([shipCheck], [shipCheck, invertedReview]);

    expect(assessment.progress).toBe("regressive");
    expect(assessment.introduced.map((issue) => issue.rule))
      .toEqual(["review_authorization_joins_review_lenses"]);
    expect(assessment.resolved).toEqual([]);
  });

  it("accepts a strict subset as progress and reports an identical set as unchanged", () => {
    expect(assessRepairRegression([shipCheck, invertedReview], [shipCheck]))
      .toMatchObject({ progress: "reduced", introduced: [] });
    expect(assessRepairRegression([shipCheck], [shipCheck]))
      .toMatchObject({ progress: "unchanged", introduced: [], resolved: [] });
    expect(assessRepairRegression([shipCheck], [])).toMatchObject({ progress: "reduced" });
  });

  // Adversarial near-miss: renaming the step does not resolve the rule.
  it("keys violations on the rule, not on the step id the planner chose", () => {
    const renamed: EpisodePlanIssue = { ...shipCheck, stepId: "renamed-ship" };
    expect(assessRepairRegression([{ ...shipCheck, stepId: "ship" }], [renamed]))
      .toMatchObject({ progress: "unchanged", introduced: [] });
  });

  it("annotates only regressive outcomes and never drops the original evidence", () => {
    const regressive = annotateRepairRegression([shipCheck], [shipCheck, invertedReview]);
    expect(regressive[0]).toMatchObject({
      code: "plan_repair_regressive",
      constraint: "non_regressive_repair",
    });
    expect(regressive[0]!.message).toContain("review-authorization must follow every review lens");
    expect(regressive.slice(1)).toEqual([shipCheck, invertedReview]);

    expect(annotateRepairRegression([shipCheck, invertedReview], [shipCheck]))
      .toEqual([shipCheck]);
  });
});

describe("EpisodePlanner repair acceptance", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("rejects a repair that fixes one violation while introducing another", async () => {
    home = makeOrgHome();
    const app = fixedApp();
    const intent = makeIntent(app);
    const propose = vi.fn(async () => proposal(intent));
    let attempt = 0;
    const validateAcceptedPlan = (): void => {
      attempt += 1;
      throw attempt === 1
        ? domainRejection("ship_follows_every_ship_check")
        : domainRejection("review_authorization_joins_review_lenses");
    };

    await expect(prepareEpisodePlan({
      root: home.root,
      app,
      roles: roles(),
      intent,
      propose,
      validateAcceptedPlan,
      now: () => NOW,
    })).rejects.toMatchObject({
      code: "error_episode_planner_failed",
      attempts: 2,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "plan_repair_regressive",
          constraint: "non_regressive_repair",
        }),
      ]),
    });
    expect(propose).toHaveBeenCalledTimes(2);
  });

  it("accepts a repair that strictly reduces the violation set", async () => {
    home = makeOrgHome();
    const app = fixedApp();
    const intent = makeIntent(app);
    const propose = vi.fn(async () => proposal(intent));
    let attempt = 0;
    const validateAcceptedPlan = (): void => {
      attempt += 1;
      if (attempt === 1) throw domainRejection("ship_follows_every_ship_check");
    };

    const prepared = await prepareEpisodePlan({
      root: home.root,
      app,
      roles: roles(),
      intent,
      propose,
      validateAcceptedPlan,
      now: () => NOW,
    });

    expect(prepared).toMatchObject({ planningTurnSkipped: false, plannerAttempts: 2 });
    expect(propose).toHaveBeenCalledTimes(2);
  });

  it("hands the repair attempt the prior attempt's machine-readable rule ids", async () => {
    home = makeOrgHome();
    const app = fixedApp();
    const intent = makeIntent(app);
    const requests: Array<Record<string, unknown>> = [];
    const propose = vi.fn(async (request: Record<string, unknown>) => {
      requests.push(request);
      return proposal(intent);
    });
    let attempt = 0;
    const validateAcceptedPlan = (): void => {
      attempt += 1;
      if (attempt === 1) throw domainRejection("ship_follows_every_ship_check");
    };

    await prepareEpisodePlan({
      root: home.root,
      app,
      roles: roles(),
      intent,
      propose: propose as never,
      validateAcceptedPlan,
      topologyContract: TICKET_EPISODE_TOPOLOGY_CONTRACT,
      mechanicalGates: TICKET_MECHANICAL_GATE_KINDS,
      providerOperations: TICKET_PROVIDER_OPERATIONS,
      now: () => NOW,
    });

    const repairRequest = requests[1]!;
    const diagnostics = repairRequest["validationDiagnostics"] as EpisodePlanIssue[];
    expect(diagnostics[0]).toMatchObject({
      constraint: "ticket_topology_invalid",
      rule: "ship_follows_every_ship_check",
    });
    // And the brief built from that request lists the preserved invariants.
    const payload = JSON.parse(
      renderEpisodePlannerBrief(repairRequest as never).split("\n").slice(1).join("\n"),
    ) as Record<string, unknown>;
    expect((payload["repairContract"] as { invariantsAlreadySatisfied: string[] })
      .invariantsAlreadySatisfied)
      .toContain("review_authorization_joins_review_lenses");
  });
});

function domainRejection(rule: string): Error & { issues: unknown[] } {
  const error = new Error("ticket plan rejected") as Error & { issues: unknown[] };
  error.issues = [{
    code: "ticket_topology_invalid",
    message: `violated ${rule}`,
    stepId: "build",
    rule,
  }];
  return error;
}

function brief(
  attempt: 1 | 2,
  validationDiagnostics: EpisodePlanIssue[],
): Record<string, unknown> {
  const rendered = renderEpisodePlannerBrief({
    intent: makeIntent(fixedApp()),
    attempt,
    providerOperations: TICKET_PROVIDER_OPERATIONS,
    mechanicalGates: TICKET_MECHANICAL_GATE_KINDS,
    topologyContract: TICKET_EPISODE_TOPOLOGY_CONTRACT,
    proposalCreatedAt: NOW.toISOString(),
    validationDiagnostics,
  });
  return JSON.parse(rendered.slice(rendered.indexOf("\n") + 1)) as Record<string, unknown>;
}

function gateEnum(schemaValue: unknown): unknown {
  const schema = schemaValue as {
    properties: {
      steps: {
        items: {
          oneOf: Array<{ properties: { kind: { const?: string }; gate?: { enum?: unknown } } }>;
        };
      };
    };
  };
  return schema.properties.steps.items.oneOf
    .find((entry) => entry.properties.kind.const === "mechanical_gate")
    ?.properties.gate?.enum;
}

function makeIntent(app: AppEntry): EpisodeIntent {
  return buildEpisodeIntent({
    episodeId: "ticket:fixture:23",
    app,
    roles: roles(),
    trigger: { kind: "ticket", sourceRef: "github:#23" },
    goal: "Fix a bounded parser bug",
    lifecycle: "existing-ticket",
    appStage: "growth",
    repositoryFacts: { revision: "abc123", clean: true },
    requestedConstraints: { network: false },
    hardBudget: { maxProviderTurns: 3, maxEquivalentCostUsd: 8 },
    requiredSafetyFacts: [],
    requiredCapabilitiesByRole: { builder: ["tool_gate"] },
  });
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

function roles(): RoleConfig[] {
  return [
    {
      name: "planner",
      runtime: "claude",
      model: "claude-opus-4-6",
      effort: "high",
      delegation: { allow: [] },
      triggers: [],
      outputs: ["episode-plan"],
      maxTurnBudgetUsd: 4,
    },
    {
      name: "builder",
      runtime: FIXED.harness,
      model: FIXED.model,
      effort: FIXED.effort,
      delegation: { allow: [] },
      triggers: [],
      outputs: ["patch"],
      maxTurnBudgetUsd: 3,
    },
  ];
}

function proposal(intent: EpisodeIntent): ProposedEpisodePlan {
  return {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: "Deliver the bounded parser fix",
    workflowClass: "ticket-delivery",
    planningSource: "episode_planner",
    steps: [{
      kind: "provider_turn",
      operation: "build/implement",
      id: "build",
      role: "builder",
      objective: "Implement the bounded fix",
      dependsOn: [],
      requiredCapabilities: ["tool_gate"],
      inputRefs: [{ ref: "ticket", required: true }],
      expectedOutputs: [{ id: "patch", kind: "patch", required: true }],
      maxTurnBudgetUsd: 3,
      selectionReason: "One bounded builder turn delivers this fix",
    }],
    estimatedBudget: {
      providerTurns: 1,
      providerTurnBudgetUsd: 3,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 3,
    },
    derivedSafetyRoute: { label: "quick", reasons: [], gateStepIds: [], approvalStepIds: [] },
    createdAt: NOW.toISOString(),
  };
}
