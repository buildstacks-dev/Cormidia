import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  EpisodePlanValidationError,
  parseNormalizedProposedEpisodePlan,
  validateInitialPlanSupersessions,
  type EpisodePlan,
  type ProposedEpisodePlan,
} from "../../../src/loop/episode-plan.js";
import { HARNESS_ROOT } from "../../src/fixtures/controlled-world.js";

interface FailureDepositFixture {
  schema_version: "operon-episode-planner-failure-deposits/v1";
  source_campaign_ids: string[];
  source_case_ids: string[];
  deposits: Array<{
    id: string;
    stage: "episode_plan_schema" | "initial_plan_semantics" | "strict_json";
    mutation: {
      kind:
        | "set_optional_field_to_null"
        | "inject_javascript_undefined"
        | "omit_required_gate"
        | "set_initial_supersedes_to_self";
      step_index: number;
      field: "supersedes" | "assignment" | "gate";
    };
    expected: {
      outcome: "rejected";
      error_name: string;
      issue_code?: string;
      path?: string;
      constraint: string;
    };
    source: { artifact: string; sha256: string };
  }>;
}

describe("OPERON-L4-001 deterministic failure deposits", () => {
  it("accepts the strict proposal when inapplicable optional fields are omitted", () => {
    const proposal = validProposal();

    expect(parseNormalizedProposedEpisodePlan(proposal)).toEqual(proposal);
    expect(proposal.steps[0]).not.toHaveProperty("assignment");
    expect(proposal.steps[0]).not.toHaveProperty("supersedes");
  });

  it("rejects the observed null and JavaScript-undefined serialization classes", async () => {
    const fixture = await loadFixture();

    expect(fixture).toMatchObject({
      schema_version: "operon-episode-planner-failure-deposits/v1",
      source_campaign_ids: [
        "OPERON-L4-001",
        "OPERON-L4-003",
        "OPERON-L4-004",
      ],
      source_case_ids: ["OPERON-EP-003", "OPERON-EP-004"],
    });
    expect(fixture.deposits).toHaveLength(4);

    for (const deposit of fixture.deposits) {
      expect(deposit.source.sha256).toMatch(/^[a-f0-9]{64}$/);
      if (deposit.mutation.kind === "set_optional_field_to_null") {
        const proposal = structuredClone(validProposal()) as unknown as {
          steps: Array<Record<string, unknown>>;
        };
        proposal.steps[deposit.mutation.step_index]![deposit.mutation.field] = null;

        try {
          parseNormalizedProposedEpisodePlan(proposal);
          throw new Error(`${deposit.id} unexpectedly passed`);
        } catch (error) {
          expect(error).toBeInstanceOf(EpisodePlanValidationError);
          const validation = error as EpisodePlanValidationError;
          expect(validation.name).toBe(deposit.expected.error_name);
          expect(validation.issues).toContainEqual(
            expect.objectContaining({
              code: deposit.expected.issue_code,
              path: deposit.expected.path,
              constraint: deposit.expected.constraint,
            }),
          );
        }
        continue;
      }

      if (deposit.mutation.kind === "omit_required_gate") {
        const proposal = structuredClone(validGateProposal()) as unknown as {
          steps: Array<Record<string, unknown>>;
        };
        delete proposal.steps[deposit.mutation.step_index]![deposit.mutation.field];

        try {
          parseNormalizedProposedEpisodePlan(proposal);
          throw new Error(`${deposit.id} unexpectedly passed`);
        } catch (error) {
          expect(error).toBeInstanceOf(EpisodePlanValidationError);
          expect((error as EpisodePlanValidationError).issues).toContainEqual(
            expect.objectContaining({
              code: deposit.expected.issue_code,
              path: deposit.expected.path,
              constraint: deposit.expected.constraint,
            }),
          );
        }
        continue;
      }

      if (deposit.mutation.kind === "set_initial_supersedes_to_self") {
        const plan = validInitialPlan();
        const step = plan.steps[deposit.mutation.step_index]!;
        if (step.kind !== "provider_turn") {
          throw new Error(`${deposit.id} does not target a provider turn`);
        }
        step.supersedes = step.id;

        expect(validateInitialPlanSupersessions(plan)).toContainEqual(
          expect.objectContaining({
            code: deposit.expected.issue_code,
            stepId: step.id,
          }),
        );
        continue;
      }

      const marker = '"maxTurnBudgetUsd":5';
      const strictJson = JSON.stringify(validProposal());
      expect(strictJson).toContain(marker);
      const invalidJson = strictJson.replace(
        marker,
        `"${deposit.mutation.field}":undefined,${marker}`,
      );
      expect(() => JSON.parse(invalidJson)).toThrow(SyntaxError);
    }
  });
});

async function loadFixture(): Promise<FailureDepositFixture> {
  return parse(
    await readFile(
      resolve(HARNESS_ROOT, "fixtures", "eval", "episode-planner-failure-deposits.yaml"),
      "utf8",
    ),
  ) as FailureDepositFixture;
}

function validProposal(): ProposedEpisodePlan {
  return {
    schemaVersion: 1,
    episodeId: "l4-failure-deposit",
    version: 1,
    intentHash: "a".repeat(64),
    summary: "Minimal strict proposal with omitted optional fields",
    workflowClass: "bounded-security-change",
    planningSource: "episode_planner",
    steps: [
      {
        kind: "provider_turn",
        id: "implement-token-expiry",
        objective: "Implement the bounded token expiry change",
        dependsOn: [],
        inputRefs: [],
        expectedOutputs: [
          { id: "token-expiry-change", kind: "bounded-artifact", required: true },
        ],
        operation: "build/implement",
        role: "builder",
        requiredCapabilities: [],
        maxTurnBudgetUsd: 5,
        selectionReason: "The bounded change requires one builder turn",
      },
    ],
    estimatedBudget: {
      providerTurns: 1,
      providerTurnBudgetUsd: 5,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 5,
    },
    derivedSafetyRoute: {
      label: "bounded-security-change",
      reasons: ["schema-boundary regression fixture"],
      gateStepIds: [],
      approvalStepIds: [],
    },
    createdAt: "2026-07-30T00:00:00.000Z",
  };
}

function validGateProposal(): ProposedEpisodePlan {
  const proposal = validProposal();
  proposal.steps.push({
    kind: "mechanical_gate",
    id: "security-gate",
    objective: "Apply the required security gate",
    dependsOn: ["implement-token-expiry"],
    inputRefs: [
      { ref: "plan-output:token-expiry-change", required: true },
    ],
    expectedOutputs: [
      { id: "security-gate-result", kind: "gate-result", required: true },
    ],
    gate: "security",
  });
  proposal.derivedSafetyRoute.gateStepIds = ["security-gate"];
  return proposal;
}

function validInitialPlan(): EpisodePlan {
  const proposal = validProposal();
  const step = proposal.steps[0]!;
  if (step.kind !== "provider_turn") {
    throw new Error("failure-deposit plan requires a provider turn");
  }
  return {
    ...proposal,
    steps: [
      {
        ...step,
        assignment: {
          harness: "claude",
          model: "claude-opus-5",
          effort: "xhigh",
        },
        assignmentSource: "configured",
      },
    ],
  };
}
