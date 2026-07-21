import { describe, expect, it } from "vitest";
import type { ProposedEpisodeStep } from "../../src/loop/episode-plan.js";
import {
  TICKET_EPISODE_TOPOLOGY_CONTRACT,
  TICKET_MECHANICAL_GATE_CATALOG,
  TICKET_PROVIDER_OPERATION_CATALOG,
  assertTicketEpisodePlanValid,
  ticketProviderOperation,
  validateTicketEpisodePlan,
} from "../../src/loop/ticket-episode-plan.js";

describe("ticket EpisodePlan operation catalog", () => {
  it("binds each provider operation to fixed code-owned pass semantics", () => {
    expect(TICKET_PROVIDER_OPERATION_CATALOG).toMatchObject({
      "ticket/diagnose": {
        role: "builder",
        execution: "diagnostic_brief",
        pipeline: null,
        pass: null,
        template: null,
        verdictKind: null,
        worktreeAccess: "read",
      },
      "build/contract": {
        role: "builder",
        pipeline: "build",
        pass: "contract",
        template: "build/contract.md",
        verdictKind: "contract",
      },
      "build/implement": {
        role: "builder",
        pipeline: "build",
        pass: "implement",
        template: "build/implement.md",
        verdictKind: "build",
        worktreeAccess: "write",
      },
      "fix/fix": {
        role: "builder",
        pipeline: "fix",
        pass: "fix",
        template: "build/fix.md",
        verdictKind: "build",
        worktreeAccess: "write",
      },
      "review/verify": {
        role: "reviewer",
        pipeline: "review",
        pass: "verify",
        template: "review/verify.md",
        verdictKind: "review",
      },
      "review/security-deep": {
        role: "reviewer",
        pipeline: "review",
        pass: "security-deep",
        template: "review/security.md",
        verdictKind: "review",
      },
      "review/perf-scale": {
        role: "reviewer",
        pipeline: "review",
        pass: "perf-scale",
        template: "review/perf.md",
        verdictKind: "review",
      },
      "ship/ship-check": {
        role: "reviewer",
        pipeline: "ship",
        pass: "ship-check",
        template: "ship/check.md",
        verdictKind: "review",
      },
    });
    expect(ticketProviderOperation("planner/invented")).toBeUndefined();
    expect(TICKET_PROVIDER_OPERATION_CATALOG["fix/fix"]).toEqual({
      operation: "fix/fix",
      role: "builder",
      execution: "pipeline_pass",
      pipeline: "fix",
      pass: "fix",
      template: "build/fix.md",
      verdictKind: "build",
      worktreeAccess: "write",
    });
    expect(Object.keys(TICKET_MECHANICAL_GATE_CATALOG)).toEqual([
      "ticket/provision",
      "ticket/gates-and-pr",
      "ticket/security",
      "ticket/data-integrity",
      "ticket/rollback",
      "ticket/performance",
      "ticket/review-authorization",
      "ticket/ship",
      "release/handoff",
    ]);
  });

  it("accepts the governed ticket topology and transitive plan-output inputs", () => {
    const result = validateTicketEpisodePlan({ steps: validSteps() });
    expect(result).toEqual({ ok: true, issues: [] });
    expect(() => assertTicketEpisodePlanValid({ steps: validSteps() })).not.toThrow();
  });

  it("rejects invented operations, wrong role ownership, and unsupported gates", () => {
    const steps = validSteps();
    provider(steps, "implement").operation = "builder/invented";
    provider(steps, "verify").role = "builder";
    gate(steps, "ship").gate = "ticket/magic";

    expect(validateTicketEpisodePlan({ steps }).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ticket_provider_operation_unknown", stepId: "implement" }),
      expect.objectContaining({ code: "ticket_provider_operation_role_mismatch", stepId: "verify" }),
      expect.objectContaining({ code: "ticket_mechanical_gate_unknown", stepId: "ship" }),
    ]));
  });

  it("requires provision, gates-and-pr, joined review authorization, and ordered ship checks", () => {
    const steps = validSteps();
    provider(steps, "implement").dependsOn = ["contract"];
    provider(steps, "diagnose").dependsOn = [];
    gate(steps, "authorize").dependsOn = ["verify"];
    gate(steps, "ship").dependsOn = ["authorize"];

    const issues = validateTicketEpisodePlan({ steps }).issues;
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "ticket_topology_invalid",
        stepId: "implement",
        message: expect.stringContaining("ticket/provision"),
      }),
      expect.objectContaining({
        code: "ticket_topology_invalid",
        stepId: "authorize",
        message: expect.stringContaining("every review lens"),
      }),
      expect.objectContaining({
        code: "ticket_topology_invalid",
        stepId: "ship",
        message: expect.stringContaining("ship-check"),
      }),
    ]));
  });

  it("allows plan-output refs only from transitive dependency ancestors", () => {
    const valid = validSteps();
    provider(valid, "verify").inputRefs.push({ ref: "plan-output:patch", required: true });
    expect(validateTicketEpisodePlan({ steps: valid }).issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ticket_plan_output_ref_invalid", stepId: "verify" }),
    ]));

    const sibling = validSteps();
    provider(sibling, "contract").expectedOutputs.push({
      id: "contract-note",
      kind: "diagnostic",
      required: true,
    });
    provider(sibling, "verify").inputRefs.push({ ref: "plan-output:contract-note", required: true });
    provider(sibling, "verify").dependsOn = ["gates"];
    // Contract happens to be an ancestor through implement/gates, so use the
    // parallel security output to prove a sibling cannot be read.
    provider(sibling, "security").expectedOutputs.push({
      id: "security-note",
      kind: "review",
      required: true,
    });
    provider(sibling, "verify").inputRefs.push({ ref: "plan-output:security-note", required: true });
    provider(sibling, "verify").inputRefs.push({ ref: "plan-output:missing", required: true });

    expect(validateTicketEpisodePlan({ steps: sibling }).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "ticket_plan_output_ref_invalid",
        stepId: "verify",
        inputRef: "plan-output:security-note",
      }),
      expect.objectContaining({
        code: "ticket_plan_output_ref_invalid",
        stepId: "verify",
        inputRef: "plan-output:missing",
      }),
    ]));
  });

  it("binds semantic safety gates to typed durable ticket evidence", () => {
    const valid = validSteps();
    provider(valid, "implement").expectedOutputs.push({
      id: "rollback-plan",
      kind: "rollback_plan",
      required: true,
    });
    valid.splice(valid.findIndex((step) => step.id === "authorize"), 0,
      mechanical("security-floor", "ticket/security", ["security"]),
      mechanical("integrity-floor", "ticket/data-integrity", ["gates"]),
      mechanical("rollback-floor", "ticket/rollback", ["implement"]),
    );
    gate(valid, "authorize").dependsOn = [
      "verify",
      "security-floor",
      "integrity-floor",
      "rollback-floor",
    ];
    expect(validateTicketEpisodePlan({ steps: valid })).toEqual({ ok: true, issues: [] });

    const invalid = validSteps();
    invalid.splice(invalid.findIndex((step) => step.id === "authorize"), 0,
      mechanical("security-floor", "ticket/security", ["verify"]),
      mechanical("integrity-floor", "ticket/data-integrity", ["implement"]),
      mechanical("rollback-floor", "ticket/rollback", ["implement"]),
      mechanical("performance-floor", "ticket/performance", ["verify"]),
    );
    const issues = validateTicketEpisodePlan({ steps: invalid }).issues;
    for (const id of ["security-floor", "integrity-floor", "rollback-floor", "performance-floor"]) {
      expect(issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "ticket_topology_invalid", stepId: id }),
      ]));
    }
  });

  // ISSUE-024: the gate handler reads durable evidence it does not produce.
  // This is the check that costs nothing at acceptance and $18.61 of stranded
  // builder work when it is missing.
  describe("mechanical gate input availability", () => {
    it("rejects every declared gate input that no ancestor step produces", () => {
      for (const [gateKind, definition] of Object.entries(TICKET_MECHANICAL_GATE_CATALOG)) {
        for (const requirement of definition.requiredPlanInputs) {
          const steps = validSteps();
          // Break the requirement without breaking anything else: the producing
          // operation stays a builder turn on the same edge, with the same id.
          const producer = steps.find((step) =>
            step.kind === "provider_turn" && step.operation === requirement.producedBy
          );
          if (producer?.kind !== "provider_turn") {
            throw new Error(`validSteps() has no ${requirement.producedBy} step`);
          }
          producer.operation = "ticket/diagnose";
          const consumers = steps.filter((step) =>
            step.kind === "mechanical_gate" && step.gate === gateKind
          );
          expect(consumers.length).toBeGreaterThan(0);

          const issues = validateTicketEpisodePlan({ steps }).issues;
          for (const consumer of consumers) {
            expect(issues).toEqual(expect.arrayContaining([
              expect.objectContaining({
                code: "ticket_gate_input_unavailable",
                rule: "gate_inputs_produced_by_ancestor",
                stepId: consumer.id,
                message: expect.stringContaining(requirement.producedBy),
              }),
            ]));
          }
        }
      }
    });

    it("names build/contract for both gates that score the completeness mapping", () => {
      const steps = validSteps().filter((step) => step.id !== "contract");
      provider(steps, "implement").dependsOn = ["provision"];
      provider(steps, "implement").inputRefs = [];

      const missing = validateTicketEpisodePlan({ steps }).issues
        .filter((issue) => issue.code === "ticket_gate_input_unavailable");
      expect(missing.map((issue) => issue.stepId)).toEqual(["gates", "ship"]);
      expect(missing[0]!.message).toContain(
        "add a build/contract provider step before it",
      );
    });

    // Adversarial near-miss: a plan whose only defect is that its contract step
    // sits downstream of the gate that consumes the mapping.
    it("rejects a contract step scheduled after the gate that reads its mapping", () => {
      const steps = validSteps();
      provider(steps, "contract").dependsOn = ["gates"];
      provider(steps, "implement").dependsOn = ["provision"];
      provider(steps, "implement").inputRefs = [];

      expect(validateTicketEpisodePlan({ steps }).issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "ticket_gate_input_unavailable",
          stepId: "gates",
        }),
      ]));
    });

    // Anti-drift: a requirement the planner is never told about is the exact
    // failure mode ISSUE-023 describes. Every enforced requirement must be in
    // the contract the brief ships.
    it("teaches every enforced gate requirement in the rendered topology contract", () => {
      const taught = new Map(
        TICKET_EPISODE_TOPOLOGY_CONTRACT.mechanicalGateRegistry.map((entry) =>
          [entry.gate, entry.requiredPlanInputs.map((input) => input.producedBy)]),
      );
      for (const [gateKind, definition] of Object.entries(TICKET_MECHANICAL_GATE_CATALOG)) {
        expect(taught.get(gateKind))
          .toEqual(definition.requiredPlanInputs.map((input) => input.producedBy));
        for (const requirement of definition.requiredPlanInputs) {
          expect(ticketProviderOperation(requirement.producedBy)).toBeDefined();
        }
      }
      expect(TICKET_EPISODE_TOPOLOGY_CONTRACT.providerOperationRegistry.map((entry) =>
        entry.operation)).toEqual(Object.keys(TICKET_PROVIDER_OPERATION_CATALOG).sort());
    });
  });
});

function validSteps(): ProposedEpisodeStep[] {
  return [
    mechanical("provision", "ticket/provision", []),
    turn("diagnose", "ticket/diagnose", "builder", ["provision"], "reproduction"),
    turn("contract", "build/contract", "builder", ["diagnose"], "contract"),
    turn("implement", "build/implement", "builder", ["provision", "contract"], "patch", [
      "plan-output:contract",
    ]),
    mechanical("gates", "ticket/gates-and-pr", ["implement"], "pull-request"),
    turn("verify", "review/verify", "reviewer", ["gates"], "functional-review", [
      "plan-output:pull-request",
    ]),
    turn("security", "review/security-deep", "reviewer", ["gates"], "security-review", [
      "plan-output:pull-request",
    ]),
    mechanical("authorize", "ticket/review-authorization", ["verify", "security"], "authorization"),
    turn("ship-check", "ship/ship-check", "reviewer", ["authorize"], "ship-verdict", [
      "plan-output:authorization",
    ]),
    mechanical("ship", "ticket/ship", ["ship-check"], "merge"),
    mechanical("release", "release/handoff", ["ship"], "release-disposition"),
  ];
}

function turn(
  id: string,
  operation: string,
  role: string,
  dependsOn: string[],
  outputId: string,
  inputRefs: string[] = [],
): Extract<ProposedEpisodeStep, { kind: "provider_turn" }> {
  return {
    kind: "provider_turn",
    operation,
    id,
    role,
    objective: `Execute ${operation}`,
    dependsOn,
    requiredCapabilities: ["tool_gate"],
    inputRefs: inputRefs.map((ref) => ({ ref, required: true })),
    expectedOutputs: [{ id: outputId, kind: "artifact", required: true }],
    maxTurnBudgetUsd: 2,
    selectionReason: `${operation} is required by the bounded ticket plan`,
  };
}

function mechanical(
  id: string,
  kind: string,
  dependsOn: string[],
  outputId = `${id}-evidence`,
): Extract<ProposedEpisodeStep, { kind: "mechanical_gate" }> {
  return {
    kind: "mechanical_gate",
    id,
    gate: kind,
    objective: `Execute ${kind}`,
    dependsOn,
    inputRefs: [],
    expectedOutputs: [{ id: outputId, kind: "mechanical-evidence", required: true }],
  };
}

function provider(
  steps: ProposedEpisodeStep[],
  id: string,
): Extract<ProposedEpisodeStep, { kind: "provider_turn" }> {
  const step = steps.find((candidate) => candidate.id === id);
  if (step?.kind !== "provider_turn") throw new Error(`missing provider step ${id}`);
  return step;
}

function gate(
  steps: ProposedEpisodeStep[],
  id: string,
): Extract<ProposedEpisodeStep, { kind: "mechanical_gate" }> {
  const step = steps.find((candidate) => candidate.id === id);
  if (step?.kind !== "mechanical_gate") throw new Error(`missing mechanical step ${id}`);
  return step;
}
