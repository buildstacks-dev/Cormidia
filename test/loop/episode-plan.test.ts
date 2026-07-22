import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { TurnAssignment } from "../../src/runtime/types.js";
import {
  EPISODE_PLAN_PROPOSAL_SCHEMA,
  EpisodePlanPersistenceError,
  EpisodePlanValidationError,
  assessCreatorScope,
  currentEpisodePlanPointerPath,
  deriveEpisodeSafetyRoute,
  episodeIntentHash,
  episodePlanHash,
  episodePlanVersionPath,
  estimateEpisodePlanBudget,
  materializeEpisodePlanAssignments,
  parseCreatorEpisodeScope,
  parseEpisodeIntent,
  persistEpisodePlan,
  parseNormalizedProposedEpisodePlan,
  parseProposedEpisodePlan,
  readCurrentEpisodePlan,
  selectReadyEpisodeSteps,
  stableHash,
  validateEpisodePlan,
  validateForwardOnlyRevision,
  type AssignmentMode,
  type CreatorEpisodeScope,
  type CreatorScopePolicy,
  type EpisodeIntent,
  type EpisodePlan,
  type EpisodePlanReasonCode,
  type EpisodePlanValidationPolicy,
  type EpisodeStep,
  type ProposedEpisodePlan,
  type ProposedEpisodeStep,
} from "../../src/loop/episode-plan.js";
import { turnAssignmentKey } from "../../src/runtime/assignment.js";
import { executeEpisodePlan } from "../../src/loop/episode-plan-executor.js";
import {
  publishEpisodePlanRevision,
  requestEpisodeReplan,
  type EpisodeReplanTrigger,
} from "../../src/loop/episode-replan.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

const BUILDER: TurnAssignment = { harness: "codex", model: "gpt-5.6-sol", effort: "high" };
const REVIEWER: TurnAssignment = { harness: "claude", model: "claude-opus-4-6", effort: "high" };
const ECONOMICAL: TurnAssignment = { harness: "codex", model: "gpt-5.6-sol", effort: "medium" };

const PROVENANCE = {
  source: "agent" as const,
  creatorId: "parent-planner/run-7",
  createdAt: "2026-07-19T16:00:00.000Z",
  evidenceRefs: ["task:parent-7"],
};

describe("EpisodePlan core", () => {
  const homes: OrgHomeFixture[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) home.cleanup();
  });

  it.each([
    { mode: "fixed" as const, scoped: false, source: "configured", planner: true },
    { mode: "adaptive" as const, scoped: false, source: "episode_planner", planner: true },
    { mode: "fixed" as const, scoped: true, source: "configured", planner: false },
    { mode: "adaptive" as const, scoped: true, source: "creator", planner: false },
  ])("handles $mode mode with creator-scoped=$scoped", ({ mode, scoped, source, planner }) => {
    const creatorScope = scoped ? scope(mode) : undefined;
    const intent = makeIntent(creatorScope, mode);
    const policy = makePolicy(mode);
    const assessment = assessCreatorScope(creatorScope, creatorPolicy(mode));
    expect(assessment.runEpisodePlanner).toBe(planner);

    const proposal = makeProposal(intent, scoped ? "creator_scope" : "episode_planner", mode);
    const plan = materializeEpisodePlanAssignments(proposal, policy);
    expect(plan.steps.filter(isProvider).map((step) => step.assignmentSource)).toEqual([source, source]);
    expect(validateEpisodePlan(plan, intent, policy)).toMatchObject({ ok: true, issues: [] });
  });

  it("never infers a creator bypass from completeness, simplicity, or a planner-input scope", () => {
    const completeButNotDeclared = { ...scope("adaptive"), planningDisposition: "planner_input" as const };
    expect(assessCreatorScope(completeButNotDeclared, creatorPolicy("adaptive"))).toMatchObject({
      executionReady: false,
      runEpisodePlanner: true,
      issues: [{ code: "creator_scope_bypass_not_requested" }],
    });
    expect(assessCreatorScope(undefined, creatorPolicy("fixed"))).toMatchObject({
      executionReady: false,
      runEpisodePlanner: true,
      issues: [{ code: "creator_scope_absent" }],
    });
    const incomplete = { ...scope("fixed"), acceptanceCriteria: [] };
    expect(issueCodes(assessCreatorScope(incomplete, creatorPolicy("fixed")).issues)).toContain(
      "creator_scope_acceptance_required",
    );
  });

  it("parses an explicit creator envelope strictly while preserving incomplete planner input", () => {
    const partial = {
      ...scope("fixed"),
      planningDisposition: "planner_input" as const,
      objective: "",
      acceptanceCriteria: [],
    };
    expect(parseCreatorEpisodeScope(partial)).toEqual(partial);
    expect(() => parseCreatorEpisodeScope({ ...partial, inferredSimple: true })).toThrowError(
      EpisodePlanValidationError,
    );
  });

  it("rejects misspelled or malformed bounded intent facts", () => {
    const intent = makeIntent();
    expect(parseEpisodeIntent(intent)).toEqual(intent);
    expect(() => parseEpisodeIntent({ ...intent, assignment_mode: "adaptive" })).toThrowError(
      EpisodePlanValidationError,
    );
    expect(() => parseEpisodeIntent({
      ...intent,
      requiredSafetyFacts: [{ kind: "looks-dangerous", evidenceRefs: ["title"] }],
    })).toThrowError(EpisodePlanValidationError);
  });

  it("requires creator provenance, one unambiguous workflow, and valid adaptive assignments", () => {
    const bad = {
      ...scope("adaptive"),
      provenance: { ...PROVENANCE, creatorId: "" },
      workflowTemplate: { id: "standard-fix", version: "1" },
      steps: proposalSteps("adaptive").map((step) =>
        step.kind === "provider_turn" && step.id === "build" ? { ...step, assignment: ECONOMICAL } : step),
    };
    expect(issueCodes(assessCreatorScope(bad, creatorPolicy("adaptive")).issues)).toEqual(
      expect.arrayContaining([
        "creator_scope_provenance_invalid",
        "creator_scope_workflow_ambiguous",
      ]),
    );
    const unapproved = {
      ...scope("adaptive"),
      steps: proposalSteps("adaptive").map((step) =>
        step.kind === "provider_turn" && step.id === "build" ? { ...step, assignment: ECONOMICAL } : step),
    };
    expect(issueCodes(assessCreatorScope(unapproved, creatorPolicy("adaptive")).issues)).toContain(
      "creator_scope_assignment_not_allowed",
    );
  });

  it("requires auditable evidence and at least one required creator artifact before bypass", () => {
    const noEvidence = {
      ...scope("fixed"),
      provenance: { ...PROVENANCE, evidenceRefs: [] },
    };
    expect(issueCodes(assessCreatorScope(noEvidence, creatorPolicy("fixed")).issues)).toContain(
      "creator_scope_provenance_invalid",
    );

    const optionalOnly = {
      ...scope("fixed"),
      expectedArtifacts: [{ id: "accepted", kind: "verdict", required: false }],
    };
    expect(issueCodes(assessCreatorScope(optionalOnly, creatorPolicy("fixed")).issues)).toContain(
      "creator_scope_artifacts_required",
    );

    const invalidScope = {
      ...optionalOnly,
      provenance: { ...PROVENANCE, evidenceRefs: [] },
    };
    const intent = makeIntent(invalidScope);
    const proposal = makeProposal(intent, "creator_scope", "fixed");
    proposal.creatorProvenance = invalidScope.provenance;
    const plan = materializeEpisodePlanAssignments(proposal, makePolicy("fixed"));
    expect(issueCodes(validateEpisodePlan(plan, intent, makePolicy("fixed")).issues)).toEqual(
      expect.arrayContaining([
        "creator_scope_provenance_invalid",
        "creator_scope_artifacts_required",
      ]),
    );
  });

  it("fixed materialization replaces proposal tuples atomically; adaptive mode never fills a missing tuple", () => {
    const intent = makeIntent();
    const fixedProposal = makeProposal(intent, "episode_planner", "adaptive");
    const fixed = materializeEpisodePlanAssignments(fixedProposal, makePolicy("fixed"));
    expect(fixed.steps.filter(isProvider).map((step) => step.assignment)).toEqual([BUILDER, REVIEWER]);

    const missing: ProposedEpisodePlan = {
      ...makeProposal(intent, "episode_planner", "adaptive"),
      steps: proposalSteps("adaptive").map((step) => step.kind === "provider_turn" && step.id === "build"
        ? omitAssignment(step)
        : step),
    };
    expect(() => materializeEpisodePlanAssignments(missing, makePolicy("adaptive"))).toThrowError(
      EpisodePlanValidationError,
    );
    try {
      materializeEpisodePlanAssignments(missing, makePolicy("adaptive"));
    } catch (error) {
      expect(error).toMatchObject({ issues: [{ code: "plan_adaptive_assignment_missing", stepId: "build" }] });
    }
  });

  it("reports stable operation, assignment, capability, role, source, and review reason codes", () => {
    const intent = makeIntent();
    const base = makePlan(intent, "fixed");
    const cases: Array<{ mutate(plan: EpisodePlan): void; code: EpisodePlanReasonCode }> = [
      { mutate: (plan) => { provider(plan, "build").operation = "Free form plan"; }, code: "plan_operation_invalid" },
      { mutate: (plan) => { provider(plan, "build").role = "Inventor"; }, code: "plan_role_unknown" },
      { mutate: (plan) => { provider(plan, "build").assignment = ECONOMICAL; }, code: "plan_assignment_not_allowed" },
      { mutate: (plan) => { provider(plan, "build").requiredCapabilities.push("quantum"); }, code: "plan_capability_missing" },
      { mutate: (plan) => { provider(plan, "build").assignmentSource = "creator"; }, code: "plan_assignment_source_invalid" },
      { mutate: (plan) => { provider(plan, "review").assignment = BUILDER; }, code: "plan_independent_review_invalid" },
      { mutate: (plan) => { plan.steps = plan.steps.filter((step) => step.id !== "review"); plan.estimatedBudget = estimateEpisodePlanBudget(plan.steps, 0); }, code: "plan_independent_review_missing" },
    ];
    for (const row of cases) {
      const candidate = structuredClone(base);
      row.mutate(candidate);
      expect(issueCodes(validateEpisodePlan(candidate, intent, makePolicy("fixed")).issues), row.code).toContain(row.code);
    }
  });

  it("validates ids, dependencies, cycles, terminal reachability, and terminal outputs", () => {
    const intent = makeIntent();
    const base = makePlan(intent, "fixed");
    const cases: Array<{ mutate(plan: EpisodePlan): void; code: EpisodePlanReasonCode }> = [
      { mutate: (plan) => { plan.steps[0]!.id = "Bad id"; }, code: "plan_step_id_invalid" },
      { mutate: (plan) => { plan.steps[1]!.id = "build"; }, code: "plan_step_id_duplicate" },
      { mutate: (plan) => { plan.steps[1]!.dependsOn = ["missing"]; }, code: "plan_step_dependency_missing" },
      { mutate: (plan) => { plan.steps[0]!.dependsOn = ["review"]; }, code: "plan_step_dependency_cycle" },
      { mutate: (plan) => { plan.steps.push(mechanical("orphan", [], "diagnostic")); }, code: "plan_step_unreachable" },
      { mutate: (plan) => { plan.steps[1]!.expectedOutputs = []; }, code: "plan_terminal_output_missing" },
      { mutate: (plan) => { plan.steps.push(mechanical("after-review", ["review"], "after")); }, code: "plan_terminal_output_not_terminal" },
    ];
    for (const row of cases) {
      const candidate = structuredClone(base);
      row.mutate(candidate);
      expect(issueCodes(validateEpisodePlan(candidate, intent, makePolicy("fixed")).issues), row.code).toContain(row.code);
    }
  });

  it("requires a required terminal outcome and rejects dead-end work without explicit output ids", () => {
    const intent = makeIntent();
    const policy = { ...makePolicy("fixed"), requiredTerminalOutputIds: [] };

    const noOutcome = makePlan(intent, "fixed");
    provider(noOutcome, "review").expectedOutputs = [
      { id: "accepted", kind: "verdict", required: false },
    ];
    expect(issueCodes(validateEpisodePlan(noOutcome, intent, policy).issues)).toEqual(
      expect.arrayContaining(["plan_terminal_output_missing", "plan_step_unreachable"]),
    );

    const deadEnd = makePlan(intent, "fixed");
    deadEnd.steps.push({
      ...mechanical("dead-end", [], "diagnostic"),
      expectedOutputs: [{ id: "diagnostic", kind: "gate", required: false }],
    });
    deadEnd.estimatedBudget = estimateEpisodePlanBudget(deadEnd.steps, 0);
    deadEnd.derivedSafetyRoute = deriveEpisodeSafetyRoute(deadEnd.steps, intent.requiredSafetyFacts);
    expect(validateEpisodePlan(deadEnd, intent, policy).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "plan_step_unreachable", stepId: "dead-end" }),
      ]),
    );
  });

  it("checks exact budget arithmetic and hard ceilings", () => {
    const intent = makeIntent();
    const base = makePlan(intent, "fixed");
    const arithmetic = structuredClone(base);
    arithmetic.estimatedBudget.totalBudgetUsd += 0.01;
    expect(issueCodes(validateEpisodePlan(arithmetic, intent, makePolicy("fixed")).issues)).toContain(
      "plan_budget_arithmetic_invalid",
    );
    const inventedMechanicalSpend = structuredClone(base);
    inventedMechanicalSpend.estimatedBudget.mechanicalOverheadUsd = 0.25;
    inventedMechanicalSpend.estimatedBudget.totalBudgetUsd += 0.25;
    expect(issueCodes(
      validateEpisodePlan(inventedMechanicalSpend, intent, makePolicy("fixed")).issues,
    )).toContain("plan_budget_arithmetic_invalid");

    const cappedIntent = { ...intent, hardBudget: { maxProviderTurns: 1, maxEquivalentCostUsd: 3 } };
    const capped = { ...base, intentHash: episodeIntentHash(cappedIntent) };
    expect(issueCodes(validateEpisodePlan(capped, cappedIntent, makePolicy("fixed")).issues)).toEqual(
      expect.arrayContaining(["plan_budget_provider_turns_exceeded", "plan_budget_cost_exceeded"]),
    );
  });

  it("normalizes only code-owned overhead and exact qualified output aliases", () => {
    const intent = makeIntent();
    const observedShape = makeProposal(intent, "episode_planner", "fixed");
    observedShape.estimatedBudget = {
      providerTurns: 2,
      providerTurnBudgetUsd: 4,
      mechanicalOverheadUsd: 2,
      totalBudgetUsd: 6,
    };
    observedShape.steps[1]!.inputRefs = [
      { ref: "plan-output:build.patch", required: true },
    ];

    const normalized = parseNormalizedProposedEpisodePlan(observedShape);
    expect(normalized.estimatedBudget).toEqual({
      providerTurns: 2,
      providerTurnBudgetUsd: 4,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 4,
    });
    expect(normalized.steps[1]!.inputRefs).toEqual([
      { ref: "plan-output:patch", required: true },
    ]);
    const plan = materializeEpisodePlanAssignments(normalized, makePolicy("fixed"));
    expect(validateEpisodePlan(plan, intent, makePolicy("fixed"))).toMatchObject({
      ok: true,
      issues: [],
    });
  });

  it("strips an unreferenced undeclared scalar and records code-owned plan provenance", () => {
    const intent = makeIntent();
    const observed = makeProposal(intent, "episode_planner", "fixed") as unknown as {
      steps: Array<Record<string, unknown>>;
    };
    observed.steps[0]!["kind_note_ignore"] = null;

    const normalized = parseNormalizedProposedEpisodePlan(observed);
    expect(normalized.steps[0]).not.toHaveProperty("kind_note_ignore");
    expect(normalized.normalizationProvenance).toEqual({
      schemaVersion: 1,
      repairs: [{
        kind: "undeclared_scalar_property_removed",
        path: "$.steps[0].kind_note_ignore",
        property: "kind_note_ignore",
        value: null,
      }],
    });

    const plan = materializeEpisodePlanAssignments(normalized, makePolicy("fixed"));
    expect(validateEpisodePlan(plan, intent, makePolicy("fixed"))).toMatchObject({
      ok: true,
      issues: [],
    });
  });

  it("keeps rejecting an undeclared non-scalar instead of discarding structure", () => {
    const intent = makeIntent();
    const observed = makeProposal(intent, "episode_planner", "fixed") as unknown as {
      steps: Array<Record<string, unknown>>;
    };
    observed.steps[0]!["kind_note"] = { rationale: "not mechanically discardable" };

    expect(() => parseNormalizedProposedEpisodePlan(observed)).toThrowError(
      EpisodePlanValidationError,
    );
    try {
      parseNormalizedProposedEpisodePlan(observed);
    } catch (error) {
      expect(error).toMatchObject({
        issues: [expect.objectContaining({
          code: "plan_structure_invalid",
          path: "$.steps[0].kind_note",
          constraint: "additionalProperties",
          received: "object(1 keys)",
        })],
      });
    }
  });

  it("keeps rejecting an undeclared scalar that another field references", () => {
    const intent = makeIntent();
    const observed = makeProposal(intent, "episode_planner", "fixed") as unknown as {
      steps: Array<Record<string, unknown>>;
    };
    observed.steps[0]!["kind_note"] = "patch";

    expect(() => parseNormalizedProposedEpisodePlan(observed)).toThrowError(
      EpisodePlanValidationError,
    );
  });

  it("still rejects inconsistent turn arithmetic and misqualified output aliases", () => {
    const intent = makeIntent();
    const inconsistent = makeProposal(intent, "episode_planner", "fixed");
    inconsistent.estimatedBudget = {
      providerTurns: 2,
      providerTurnBudgetUsd: 3,
      mechanicalOverheadUsd: 2,
      totalBudgetUsd: 5,
    };
    const inconsistentPlan = materializeEpisodePlanAssignments(
      parseNormalizedProposedEpisodePlan(inconsistent),
      makePolicy("fixed"),
    );
    expect(issueCodes(
      validateEpisodePlan(inconsistentPlan, intent, makePolicy("fixed")).issues,
    )).toContain("plan_budget_arithmetic_invalid");

    const futureProducer = makeProposal(intent, "episode_planner", "fixed");
    futureProducer.steps[0]!.inputRefs = [
      { ref: "plan-output:review.accepted", required: true },
    ];
    const futureProducerPlan = materializeEpisodePlanAssignments(
      parseNormalizedProposedEpisodePlan(futureProducer),
      makePolicy("fixed"),
    );
    expect(validateEpisodePlan(
      futureProducerPlan,
      intent,
      makePolicy("fixed"),
    ).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "plan_output_ref_invalid", stepId: "build" }),
    ]));
  });

  it("enforces typed deterministic safety gates and approvals without adding provider turns", () => {
    const intent = makeIntent();
    const plan = makePlan(intent, "fixed");
    const validation = validateEpisodePlan(plan, intent, {
      ...makePolicy("fixed"),
      requiredGateKinds: ["security"],
      requiredApprovalKinds: ["critical-operation"],
    });
    expect(issueCodes(validation.issues)).toEqual(expect.arrayContaining([
      "plan_safety_gate_missing",
      "plan_safety_approval_missing",
    ]));
    expect(plan.steps.filter(isProvider)).toHaveLength(2);
  });

  it("rejects a safety-required provider owner without inserting a turn", () => {
    const intent = makeIntent();
    const plan = makePlan(intent, "fixed");
    const validation = validateEpisodePlan(plan, intent, {
      ...makePolicy("fixed"),
      requiredProviderRoles: ["SRE"],
    });

    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "plan_safety_provider_missing",
        message: expect.stringContaining("SRE-owned provider work"),
      }),
    ]));
    expect(plan.steps.filter(isProvider)).toHaveLength(2);
    expect(plan.steps.filter(isProvider).map((step) => step.role)).not.toContain("SRE");
  });

  it("rejects required gates and approvals that a terminal branch can bypass", () => {
    const intent = makeIntent();
    const plan = makePlan(intent, "fixed");
    const security = mechanical("security", ["build"], "security-proof");
    if (security.kind !== "mechanical_gate") throw new Error("expected mechanical gate");
    security.gate = "security";
    const approval: EpisodeStep = {
      kind: "approval",
      id: "approve",
      objective: "Approve the critical operation",
      dependsOn: ["security"],
      inputRefs: [{ ref: "security-proof", required: true }],
      expectedOutputs: [{ id: "approved", kind: "approval", required: true }],
      approvalKind: "critical-operation",
      actionRef: "action:test",
    };
    plan.steps.push(security, approval);
    plan.estimatedBudget = estimateEpisodePlanBudget(plan.steps, 0);
    plan.derivedSafetyRoute = deriveEpisodeSafetyRoute(plan.steps, intent.requiredSafetyFacts);

    const result = validateEpisodePlan(plan, intent, {
      ...makePolicy("fixed"),
      requiredTerminalOutputIds: [],
      requiredGateKinds: ["security"],
      requiredApprovalKinds: ["critical-operation"],
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "plan_safety_gate_missing", stepId: "review" }),
      expect.objectContaining({ code: "plan_safety_approval_missing", stepId: "review" }),
    ]));
  });

  it("hashes object keys canonically while preserving meaningful array order", () => {
    expect(stableHash({ b: 2, a: { d: 4, c: 3 } })).toBe(stableHash({ a: { c: 3, d: 4 }, b: 2 }));
    expect(stableHash({ a: [1, 2] })).not.toBe(stableHash({ a: [2, 1] }));
    const intent = makeIntent();
    const plan = makePlan(intent, "fixed");
    expect(episodePlanHash(plan)).toMatch(/^[a-f0-9]{64}$/);
    expect(episodePlanHash(plan)).not.toBe(episodePlanHash({
      ...plan,
      steps: plan.steps.map((step) => step.kind === "provider_turn" && step.id === "build"
        ? { ...step, operation: "fix/fix" }
        : step),
    }));
    expect(plan.intentHash).toBe(episodeIntentHash(intent));
    expect(episodeIntentHash(intent)).not.toBe(episodeIntentHash({ ...intent, assignmentMode: "adaptive" }));
  });

  it("rejects an unknown registered-domain operation before producing a plan hash", () => {
    const intent = makeIntent();
    const plan = makePlan(intent, "fixed");
    provider(plan, "build").operation = "build/implement-typo";

    const result = validateEpisodePlan(plan, intent, {
      ...makePolicy("fixed"),
      knownProviderOperations: ["build/contract", "build/implement", "review/verify"],
    });

    expect(result.planHash).toBeUndefined();
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "plan_operation_unknown",
        stepId: "build",
        message:
          'unknown provider operation "build/implement-typo"; valid operations are: ' +
          "build/contract, build/implement, review/verify",
      }),
    ]));
  });

  it("strictly parses proposals, permits only the pre-materialization assignment omission, and rejects unknown fields", () => {
    const intent = makeIntent();
    const fixed = makeProposal(intent, "episode_planner", "fixed");
    const parsedFixed = parseProposedEpisodePlan(fixed);
    expect(parsedFixed).toEqual(fixed);
    fixed.steps[0]!.objective = "mutated after parse";
    expect(parsedFixed.steps[0]!.objective).not.toBe(fixed.steps[0]!.objective);
    expect(EPISODE_PLAN_PROPOSAL_SCHEMA).toMatchObject({
      additionalProperties: false,
      properties: {
        estimatedBudget: {
          properties: { mechanicalOverheadUsd: { const: 0 } },
        },
        steps: {
          minItems: 1,
          items: {
            oneOf: expect.arrayContaining([
              expect.objectContaining({ required: expect.arrayContaining(["operation"]) }),
            ]),
          },
        },
      },
    });
    const adaptive = makeProposal({ ...intent, assignmentMode: "adaptive" }, "episode_planner", "adaptive");
    expect(parseProposedEpisodePlan(adaptive)).toEqual(adaptive);

    const revisionContract = structuredClone(fixed);
    const revisionStep = revisionContract.steps[0];
    if (revisionStep?.kind !== "provider_turn") throw new Error("fixture provider step disappeared");
    revisionStep.operation = "build/contract";
    revisionStep.supersedes = "completed-contract";
    expect(parseProposedEpisodePlan(revisionContract).steps[0]).toHaveProperty(
      "supersedes",
      "completed-contract",
    );

    const unknown = { ...structuredClone(fixed), runtime: "codex" };
    expect(() => parseProposedEpisodePlan(unknown)).toThrowError(EpisodePlanValidationError);
    try {
      parseProposedEpisodePlan(unknown);
    } catch (error) {
      expect(error).toMatchObject({
        issues: [{
          code: "plan_structure_invalid",
          path: "$.runtime",
          constraint: "additionalProperties",
          expected: "no undeclared property",
          received: '"codex"',
        }],
      });
    }
    const legacyTuple = structuredClone(adaptive) as unknown as { steps: Array<Record<string, unknown>> };
    legacyTuple.steps[0]!["assignment"] = { runtime: "codex", model: "gpt-5.6-sol", effort: "high" };
    expect(() => parseProposedEpisodePlan(legacyTuple)).toThrowError(EpisodePlanValidationError);
    const missingOperation = structuredClone(fixed) as unknown as { steps: Array<Record<string, unknown>> };
    delete missingOperation.steps[0]!["operation"];
    expect(() => parseProposedEpisodePlan(missingOperation)).toThrowError(EpisodePlanValidationError);
    try {
      parseProposedEpisodePlan(missingOperation);
    } catch (error) {
      expect(error).toMatchObject({
        issues: expect.arrayContaining([expect.objectContaining({
          code: "plan_structure_invalid",
          stepId: "build",
          path: "$.steps[0].operation",
          constraint: "required",
          expected: "string",
          received: "missing",
        })]),
      });
    }
    const malformedOperation = structuredClone(fixed) as unknown as { steps: Array<Record<string, unknown>> };
    malformedOperation.steps[0]!["operation"] = "free form operation";
    expect(() => parseProposedEpisodePlan(malformedOperation)).toThrowError(EpisodePlanValidationError);
    try {
      parseProposedEpisodePlan(malformedOperation);
    } catch (error) {
      expect(error).toMatchObject({
        issues: [expect.objectContaining({
          stepId: "build",
          path: "$.steps[0].operation",
          constraint: "pattern",
          received: '"free form operation"',
        })],
      });
    }
    const unknownStepField = structuredClone(fixed) as unknown as { steps: Array<Record<string, unknown>> };
    unknownStepField.steps[0]!["runtime"] = "codex";
    expect(() => parseProposedEpisodePlan(unknownStepField)).toThrowError(EpisodePlanValidationError);
  });

  it("binds every provider budget to one unique approved assignment price", () => {
    const intent = makeIntent();
    const plan = makePlan(intent, "fixed");
    provider(plan, "build").maxTurnBudgetUsd = 2.01;
    plan.estimatedBudget = estimateEpisodePlanBudget(plan.steps, 0);
    expect(issueCodes(validateEpisodePlan(plan, intent, makePolicy("fixed")).issues)).toContain(
      "plan_turn_budget_exceeds_assignment",
    );

    const duplicateIntent = {
      ...intent,
      allowedAssignments: [...intent.allowedAssignments, { ...intent.allowedAssignments[0]!, candidateId: "duplicate" }],
    };
    const duplicatePlan = { ...makePlan(intent, "fixed"), intentHash: episodeIntentHash(duplicateIntent) };
    expect(issueCodes(validateEpisodePlan(duplicatePlan, duplicateIntent, makePolicy("fixed")).issues)).toContain(
      "plan_assignment_catalog_duplicate",
    );

    const unavailableIntent = {
      ...intent,
      allowedAssignments: intent.allowedAssignments.map((candidate) =>
        candidate.role === "Builder" ? { ...candidate, available: false } : candidate),
    };
    const unavailablePlan = { ...makePlan(intent, "fixed"), intentHash: episodeIntentHash(unavailableIntent) };
    expect(issueCodes(validateEpisodePlan(unavailablePlan, unavailableIntent, makePolicy("fixed")).issues)).toContain(
      "plan_assignment_unavailable",
    );

    const unpricedIntent = {
      ...intent,
      allowedAssignments: intent.allowedAssignments.map((candidate) =>
        candidate.role === "Builder" ? { ...candidate, maxTurnCostUsd: 0 } : candidate),
    };
    const unpricedPlan = { ...makePlan(intent, "fixed"), intentHash: episodeIntentHash(unpricedIntent) };
    expect(issueCodes(validateEpisodePlan(unpricedPlan, unpricedIntent, makePolicy("fixed")).issues)).toContain(
      "plan_assignment_price_invalid",
    );

    const forgedFamilyIntent = {
      ...intent,
      allowedAssignments: intent.allowedAssignments.map((candidate) =>
        candidate.role === "Builder" ? { ...candidate, providerFamily: "anthropic" } : candidate),
    };
    const forgedFamilyPlan = {
      ...makePlan(intent, "fixed"),
      intentHash: episodeIntentHash(forgedFamilyIntent),
    };
    expect(issueCodes(
      validateEpisodePlan(forgedFamilyPlan, forgedFamilyIntent, makePolicy("fixed")).issues,
    )).toContain("plan_assignment_candidate_invalid");
  });

  it("selects the same sorted ready set for every proposal ordering", () => {
    const intent = makeIntent();
    const root = mechanical("root", [], "root-output");
    const alpha = mechanical("alpha", ["root"], "alpha-output");
    const beta = mechanical("beta", ["root"], "beta-output");
    const terminal = mechanical("terminal", ["alpha", "beta"], "accepted");
    const permutations: EpisodeStep[][] = [
      [root, alpha, beta, terminal],
      [terminal, beta, root, alpha],
      [beta, root, terminal, alpha],
    ];
    for (const steps of permutations) {
      const plan = makeMechanicalPlan(intent, steps);
      expect(selectReadyEpisodeSteps(plan, []).map((step) => step.id)).toEqual(["root"]);
      expect(selectReadyEpisodeSteps(plan, ["root"]).map((step) => step.id)).toEqual(["alpha", "beta"]);
      expect(selectReadyEpisodeSteps(plan, ["root", "alpha"], ["beta"])).toEqual([]);
      expect(selectReadyEpisodeSteps(plan, ["root", "alpha", "beta"]).map((step) => step.id)).toEqual(["terminal"]);
    }
  });

  it("persists immutable plan versions and an atomically verified current pointer", async () => {
    const home = track(homes, makeOrgHome());
    const intent = makeIntent();
    const policy = makePolicy("fixed");
    const v1 = makePlan(intent, "fixed");
    const pointer = await persistEpisodePlan({ root: home.root, plan: v1, intent, policy });
    expect(pointer).toMatchObject({ version: 1, planHash: episodePlanHash(v1), file: "plan-v1.json" });
    expect(await readCurrentEpisodePlan(home.root, intent.episodeId)).toEqual(v1);
    expect(JSON.parse(await readFile(episodePlanVersionPath(home.root, intent.episodeId, 1), "utf8"))).toEqual(v1);
    expect(JSON.parse(await readFile(currentEpisodePlanPointerPath(home.root, intent.episodeId), "utf8"))).toEqual(pointer);
    await expect(persistEpisodePlan({ root: home.root, plan: v1, intent, policy })).resolves.toEqual(pointer);
  });

  it("rejects supersession claims on an initial plan with no completed history", async () => {
    const home = track(homes, makeOrgHome());
    const intent = makeIntent();
    const policy = makePolicy("fixed");
    const plan = makePlan(intent, "fixed");
    provider(plan, "build").supersedes = "prior-contract";

    await expect(persistEpisodePlan({ root: home.root, plan, intent, policy }))
      .rejects.toMatchObject({
        code: "error_episode_plan_invalid",
        issues: [{ code: "plan_supersession_invalid", stepId: "build" }],
      });
  });

  it("requires typed replan authority for forward revisions and preserves completed steps byte-for-byte", async () => {
    const home = track(homes, makeOrgHome());
    const intent = makeIntent();
    const policy = makePolicy("fixed");
    const v1 = makePlan(intent, "fixed");
    await persistEpisodePlan({ root: home.root, plan: v1, intent, policy });
    await executeEpisodePlan({
      root: home.root,
      plan: v1,
      maxSteps: 1,
      handlers: {
        provider: async (step) => ({ status: "completed", artifact: { providerStepId: step.id } }),
        mechanical: async (step) => ({ status: "completed", artifact: { gate: step.gate } }),
        approval: async (step) => ({ status: "completed", artifact: { approval: step.actionRef } }),
      },
    });

    const v2 = structuredClone(v1);
    v2.version = 2;
    v2.createdAt = "2026-07-19T16:02:00.000Z";
    v2.summary = "Build, then run a revised focused review";
    provider(v2, "review").objective = "Review the discovered edge case";
    expect(validateForwardOnlyRevision(v1, v2, ["build"])).toEqual([]);
    await expect(persistEpisodePlan({ root: home.root, plan: v2, intent, policy }))
      .rejects.toMatchObject({ code: "error_episode_plan_revision_authority_required" });
    await requestEpisodeReplan({
      root: home.root,
      episodeId: intent.episodeId,
      trigger: replanTrigger("review-update", 1, ["review"]),
    });
    await expect(publishEpisodePlanRevision({
      root: home.root,
      requestId: "review-update",
      plan: v2,
      intent,
      policy,
    })).resolves.toMatchObject({ status: "accepted", revisionVersion: 2 });

    const v3 = structuredClone(v2);
    v3.version = 3;
    v3.createdAt = "2026-07-19T16:03:00.000Z";
    provider(v3, "build").objective = "Rewrite already completed work";
    expect(issueCodes(validateForwardOnlyRevision(v2, v3, ["build"]))).toContain(
      "plan_revision_completed_step_changed",
    );
    await requestEpisodeReplan({
      root: home.root,
      episodeId: intent.episodeId,
      trigger: replanTrigger("illegal-build-rewrite", 2, ["build"]),
    });
    await expect(publishEpisodePlanRevision({
      root: home.root,
      requestId: "illegal-build-rewrite",
      plan: v3,
      intent,
      policy,
    }))
      .rejects.toMatchObject({ code: "error_episode_plan_invalid" });
    await expect(publishEpisodePlanRevision({
      root: home.root,
      requestId: "illegal-build-rewrite",
      plan: v3,
      intent,
      policy,
      // A JavaScript caller can still attach an unknown field, but it cannot
      // replace the completed set derived under the execution lock.
      completedStepIds: [],
    } as unknown as Parameters<typeof publishEpisodePlanRevision>[0]))
      .rejects.toMatchObject({
        code: "error_episode_plan_invalid",
        issues: [{ code: "plan_revision_completed_step_changed", stepId: "build" }],
      });
    expect((await readCurrentEpisodePlan(home.root, intent.episodeId))?.version).toBe(2);
  });

  it("supersedes a completed contract with a new contract while preserving immutable evidence", async () => {
    const home = track(homes, makeOrgHome());
    const intent = makeIntent();
    const policy = makePolicy("fixed");
    const v1 = makePlan(intent, "fixed");
    const build = provider(v1, "build");
    const contract = {
      ...structuredClone(build),
      id: "contract",
      operation: "build/contract",
      objective: "Establish the original build contract",
      dependsOn: [],
      inputRefs: [{ ref: "ticket", required: true }],
      expectedOutputs: [
        { id: "contract-v1", kind: "contract", required: true },
        { id: "criterion-map-v1", kind: "criterion_test_contract_mapping", required: true },
      ],
      selectionReason: "Bind acceptance criteria before implementation",
    };
    build.dependsOn = [contract.id];
    build.inputRefs = [{ ref: "plan-output:contract-v1", required: true }];
    v1.steps.unshift(contract);
    v1.estimatedBudget = estimateEpisodePlanBudget(v1.steps, 0);
    v1.derivedSafetyRoute = deriveEpisodeSafetyRoute(v1.steps, intent.requiredSafetyFacts);
    expect(validateEpisodePlan(v1, intent, policy)).toMatchObject({ ok: true, issues: [] });
    await persistEpisodePlan({ root: home.root, plan: v1, intent, policy });
    await executeEpisodePlan({
      root: home.root,
      plan: v1,
      maxSteps: 1,
      handlers: {
        provider: async (step) => ({ status: "completed", artifact: { providerStepId: step.id } }),
        mechanical: async (step) => ({ status: "completed", artifact: { gate: step.gate } }),
        approval: async (step) => ({ status: "completed", artifact: { approval: step.actionRef } }),
      },
    });

    const v2 = structuredClone(v1);
    v2.version = 2;
    v2.createdAt = "2026-07-19T16:02:00.000Z";
    v2.summary = "Replace the disproven contract, then re-authorize dependent work";
    const replacement = {
      ...structuredClone(contract),
      id: "contract-v2",
      objective: "Establish a corrected build contract",
      dependsOn: [contract.id],
      inputRefs: [{ ref: "plan-output:contract-v1", required: true }],
      expectedOutputs: [
        { id: "contract-v2", kind: "contract", required: true },
        { id: "criterion-map-v2", kind: "criterion_test_contract_mapping", required: true },
      ],
      supersedes: contract.id,
    };
    v2.steps.splice(1, 0, replacement);
    provider(v2, "build").dependsOn = [replacement.id];
    provider(v2, "build").inputRefs = [{ ref: "plan-output:contract-v2", required: true }];
    v2.estimatedBudget = estimateEpisodePlanBudget(v2.steps, 0);
    v2.derivedSafetyRoute = deriveEpisodeSafetyRoute(v2.steps, intent.requiredSafetyFacts);

    expect(validateEpisodePlan(v2, intent, policy)).toMatchObject({ ok: true, issues: [] });
    expect(validateForwardOnlyRevision(v1, v2, [contract.id])).toEqual([]);

    const inPlaceMutation = structuredClone(v2);
    provider(inPlaceMutation, contract.id).objective = "Rewrite the completed contract in place";
    expect(validateForwardOnlyRevision(v1, inPlaceMutation, [contract.id])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "plan_revision_completed_step_changed",
          stepId: contract.id,
        }),
      ]),
    );

    await requestEpisodeReplan({
      root: home.root,
      episodeId: intent.episodeId,
      trigger: replanTrigger("contract-supersession", 1, [contract.id, build.id]),
    });
    await publishEpisodePlanRevision({
      root: home.root,
      requestId: "contract-supersession",
      plan: v2,
      intent,
      policy,
    });

    const calls: string[] = [];
    const completed = await executeEpisodePlan({
      root: home.root,
      plan: v2,
      handlers: {
        provider: async (step) => {
          calls.push(step.id);
          return { status: "completed", artifact: { providerStepId: step.id } };
        },
        mechanical: async (step) => ({ status: "completed", artifact: { gate: step.gate } }),
        approval: async (step) => ({ status: "completed", artifact: { approval: step.actionRef } }),
      },
    });
    expect(completed.status).toBe("completed");
    expect(calls).toEqual(["contract-v2", "build", "review"]);
    expect(calls).not.toContain(contract.id);
    expect(provider(v2, contract.id)).toEqual(contract);
  });

  it("lets exactly one divergent concurrent first writer win", async () => {
    const home = track(homes, makeOrgHome());
    const intent = makeIntent();
    const policy = makePolicy("fixed");
    const first = makePlan(intent, "fixed");
    const second = { ...makePlan(intent, "fixed"), summary: "Divergent concurrent plan" };
    const settled = await Promise.allSettled([
      persistEpisodePlan({ root: home.root, plan: first, intent, policy }),
      persistEpisodePlan({ root: home.root, plan: second, intent, policy }),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(EpisodePlanPersistenceError);
    expect(rejected?.reason).toMatchObject({ code: "error_episode_plan_version_conflict" });
    const persisted = await readCurrentEpisodePlan(home.root, intent.episodeId);
    expect([episodePlanHash(first), episodePlanHash(second)]).toContain(episodePlanHash(persisted!));
  });

  it("serializes revision authority with an executing step", async () => {
    const home = track(homes, makeOrgHome());
    const intent = makeIntent();
    const policy = makePolicy("fixed");
    const v1 = makePlan(intent, "fixed");
    await persistEpisodePlan({ root: home.root, plan: v1, intent, policy });
    await requestEpisodeReplan({
      root: home.root,
      episodeId: intent.episodeId,
      trigger: replanTrigger("active-build-change", 1, ["build"]),
    });

    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    let releaseHandler!: () => void;
    const released = new Promise<void>((resolve) => { releaseHandler = resolve; });
    const execution = executeEpisodePlan({
      root: home.root,
      plan: v1,
      maxSteps: 1,
      handlers: {
        provider: async () => {
          signalStarted();
          await released;
          return { status: "completed", artifact: { provider: "complete" } };
        },
        mechanical: async (step) => ({ status: "completed", artifact: { gate: step.gate } }),
        approval: async (step) => ({ status: "completed", artifact: { approval: step.actionRef } }),
      },
    });
    await started;

    const v2 = structuredClone(v1);
    v2.version = 2;
    v2.createdAt = "2026-07-19T16:04:00.000Z";
    provider(v2, "build").objective = "Illegally replace the executing step";
    let revisionSettled = false;
    const revision = publishEpisodePlanRevision({
      root: home.root,
      requestId: "active-build-change",
      plan: v2,
      intent,
      policy,
    })
      .then(
        (pointer) => ({ status: "fulfilled" as const, pointer }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      )
      .finally(() => { revisionSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(revisionSettled).toBe(false);

    releaseHandler();
    await execution;
    const revisionResult = await revision;
    expect(revisionResult).toMatchObject({
      status: "rejected",
      error: {
        code: "error_episode_plan_invalid",
        issues: [{ code: "plan_revision_completed_step_changed", stepId: "build" }],
      },
    });
    expect((await readCurrentEpisodePlan(home.root, intent.episodeId))?.version).toBe(1);
  });
});

function makeIntent(creatorScope?: CreatorEpisodeScope, assignmentMode: AssignmentMode = "fixed"): EpisodeIntent {
  const intent: EpisodeIntent = {
    episodeId: "ticket:alpha:#42",
    app: "alpha",
    assignmentMode,
    trigger: { kind: "ticket", sourceRef: "github:#42" },
    goal: "Fix the localized parser bug",
    lifecycle: "existing-ticket",
    appStage: "growth",
    repositoryFacts: { revision: "abc123", clean: true },
    requestedConstraints: { network: false },
    hardBudget: { maxProviderTurns: 4, maxEquivalentCostUsd: 10, maxMechanicalOverheadUsd: 1 },
    availableRoles: [
      { role: "Builder", responsibility: "Implement", requiredCapabilities: ["workspace_write"], expectedOutputs: ["patch"], configuredAssignment: BUILDER },
      { role: "Reviewer", responsibility: "Review", requiredCapabilities: ["workspace_read"], expectedOutputs: ["accepted"], configuredAssignment: REVIEWER },
    ],
    allowedAssignments: [
      { candidateId: "builder-primary", role: "Builder", assignment: BUILDER, providerFamily: "openai", capabilities: ["workspace_write"], qualificationRef: "qualification:builder", priceRef: "price:builder", maxTurnCostUsd: 2, available: true },
      { candidateId: "reviewer-primary", role: "Reviewer", assignment: REVIEWER, providerFamily: "anthropic", capabilities: ["workspace_read"], qualificationRef: "qualification:reviewer", priceRef: "price:reviewer", maxTurnCostUsd: 2, available: true },
    ],
    requiredSafetyFacts: [{ kind: "independent_review", evidenceRefs: ["policy:test"] }],
  };
  if (creatorScope !== undefined) intent.creatorScope = creatorScope;
  return intent;
}

function proposalSteps(mode: AssignmentMode): ProposedEpisodeStep[] {
  const build = {
    kind: "provider_turn" as const,
    operation: "build/implement",
    id: "build",
    role: "Builder",
    objective: "Implement the bounded fix",
    dependsOn: [],
    requiredCapabilities: ["workspace_write"],
    inputRefs: [{ ref: "ticket", required: true }],
    expectedOutputs: [{ id: "patch", kind: "artifact", required: true }],
    maxTurnBudgetUsd: 2,
    selectionReason: "Localized implementation work",
  };
  const review = {
    kind: "provider_turn" as const,
    operation: "review/verify",
    id: "review",
    role: "Reviewer",
    objective: "Independently review the fix",
    dependsOn: ["build"],
    requiredCapabilities: ["workspace_read"],
    inputRefs: [{ ref: "patch", required: true }],
    expectedOutputs: [{ id: "accepted", kind: "verdict", required: true }],
    maxTurnBudgetUsd: 2,
    selectionReason: "Independent policy review",
  };
  return mode === "adaptive"
    ? [{ ...build, assignment: BUILDER }, { ...review, assignment: REVIEWER }]
    : [build, review];
}

function makeProposal(
  intent: EpisodeIntent,
  planningSource: EpisodePlan["planningSource"],
  mode: AssignmentMode,
): ProposedEpisodePlan {
  const steps = proposalSteps(mode);
  const proposal: ProposedEpisodePlan = {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: "Build and independently review the localized fix",
    workflowClass: "localized-bug",
    planningSource,
    steps,
    estimatedBudget: { providerTurns: 2, providerTurnBudgetUsd: 4, mechanicalOverheadUsd: 0, totalBudgetUsd: 4 },
    derivedSafetyRoute: deriveEpisodeSafetyRoute(steps, intent.requiredSafetyFacts),
    createdAt: "2026-07-19T16:01:00.000Z",
  };
  if (planningSource === "creator_scope") proposal.creatorProvenance = PROVENANCE;
  return proposal;
}

function makePlan(intent: EpisodeIntent, mode: AssignmentMode): EpisodePlan {
  return materializeEpisodePlanAssignments(makeProposal(intent, "episode_planner", mode), makePolicy(mode));
}

function scope(mode: AssignmentMode): CreatorEpisodeScope {
  return {
    planningDisposition: "execution_ready",
    provenance: PROVENANCE,
    objective: "Fix the localized parser bug",
    inScope: ["parser.ts"],
    outOfScope: ["parser redesign"],
    acceptanceCriteria: ["regression test passes"],
    expectedArtifacts: [{ id: "accepted", kind: "verdict", required: true }],
    declaredConstraints: { network: false },
    safetyFacts: [{ kind: "independent_review", evidenceRefs: ["policy:test"] }],
    steps: proposalSteps(mode),
  };
}

function makePolicy(mode: AssignmentMode): EpisodePlanValidationPolicy {
  const configured = new Map<string, TurnAssignment>([["Builder", BUILDER], ["Reviewer", REVIEWER]]);
  const allowed = new Set([`${"Builder"}:${turnAssignmentKey(BUILDER)}`, `${"Reviewer"}:${turnAssignmentKey(REVIEWER)}`]);
  return {
    mode,
    configuredAssignmentFor: (role) => configured.get(role),
    isKnownRole: (role) => configured.has(role),
    isAssignmentAllowed: (role, assignment) => allowed.has(`${role}:${turnAssignmentKey(assignment)}`),
    capabilitiesFor: (role) => role === "Builder" ? ["workspace_write"] : ["workspace_read"],
    requiredTerminalOutputIds: ["accepted"],
    independentReview: {
      subjectRoles: ["Builder"],
      reviewerRoles: ["Reviewer"],
      isIndependent: (subject, reviewer) => subject.assignment.harness !== reviewer.assignment.harness,
    },
  };
}

function creatorPolicy(mode: AssignmentMode): CreatorScopePolicy {
  const policy = makePolicy(mode);
  return {
    mode,
    configuredAssignmentFor: policy.configuredAssignmentFor,
    isAssignmentAllowed: policy.isAssignmentAllowed,
    isKnownRole: policy.isKnownRole,
    maxTurnCostUsdFor: (role, assignment) =>
      policy.isAssignmentAllowed(role, assignment) ? 2 : undefined,
    resolveWorkflowTemplate: (ref) => ref.id === "standard-fix" && ref.version === "1" ? proposalSteps(mode) : undefined,
  };
}

function mechanical(id: string, dependsOn: string[], output: string): EpisodeStep {
  return {
    kind: "mechanical_gate",
    id,
    objective: `Run ${id}`,
    dependsOn,
    inputRefs: [],
    expectedOutputs: [{ id: output, kind: "gate", required: true }],
    gate: id,
  };
}

function replanTrigger(
  id: string,
  planVersion: number,
  affectedStepIds: string[],
): EpisodeReplanTrigger {
  return {
    id,
    kind: "new_scope",
    planVersion,
    detectedAt: "2026-07-19T16:01:30.000Z",
    summary: `Typed test replan ${id}`,
    evidenceRefs: [`test:${id}`],
    affectedStepIds,
  };
}

function makeMechanicalPlan(intent: EpisodeIntent, steps: EpisodeStep[]): EpisodePlan {
  return {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: "Deterministic gate graph",
    workflowClass: "mechanical",
    planningSource: "episode_planner",
    steps,
    estimatedBudget: estimateEpisodePlanBudget(steps, 0),
    derivedSafetyRoute: deriveEpisodeSafetyRoute(steps, intent.requiredSafetyFacts),
    createdAt: "2026-07-19T16:01:00.000Z",
  };
}

function provider(plan: EpisodePlan, id: string) {
  const step = plan.steps.find((candidate) => candidate.id === id);
  if (step?.kind !== "provider_turn") throw new Error(`missing provider step ${id}`);
  return step;
}

function isProvider(step: EpisodeStep): step is Extract<EpisodeStep, { kind: "provider_turn" }> {
  return step.kind === "provider_turn";
}

function omitAssignment(step: Extract<ProposedEpisodeStep, { kind: "provider_turn" }>): Extract<ProposedEpisodeStep, { kind: "provider_turn" }> {
  const { assignment: _assignment, ...rest } = step;
  return rest;
}

function issueCodes(issues: readonly { code: EpisodePlanReasonCode }[]): EpisodePlanReasonCode[] {
  return issues.map((entry) => entry.code);
}

function track(homes: OrgHomeFixture[], home: OrgHomeFixture): OrgHomeFixture {
  homes.push(home);
  return home;
}
