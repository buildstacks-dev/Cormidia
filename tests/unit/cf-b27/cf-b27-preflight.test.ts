// CF-J21-R / CF-C-B27 (L1) — every B-27 §1 preflight refusal class, each
// decidable before any repository is touched or any token is spent.
//
// The clauses that need the world (commit pin, packaged-install proof, scenario
// repository binding) are owned by CF-INV-ACC-3 and CF-INV-ACC-7b and are
// composed by the runner; this file is the structural half, which is where a
// campaign config is cheapest to refuse.

import { describe, expect, it } from "vitest";
import type { TurnAssignment } from "../../../src/runtime/types.js";
import {
  CampaignConfigError,
  validateCampaignConfig,
  type AcceptanceCampaignConfig,
  type CampaignConfigCode,
} from "../../campaign/acceptance/campaign-config.js";

const claudeOpus: TurnAssignment = { harness: "claude", model: "claude-opus-4-8", effort: "xhigh" };
const claudeSonnet: TurnAssignment = { harness: "claude", model: "claude-sonnet-5", effort: "xhigh" };
const codexSol: TurnAssignment = { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" };

function config(overrides: Partial<AcceptanceCampaignConfig> = {}): AcceptanceCampaignConfig {
  return {
    campaignId: "l-acc-run-1",
    commit: "0".repeat(40),
    policyPath: "/repo/validation-design/validation-policy.yaml",
    campaignOrg: "cormidia-sandbox",
    scenarios: [
      {
        id: "S-ACC-1",
        kind: "app",
        appSlug: "cormidia-sandbox/acc-1-timetracker",
        worktree: "/sandbox/acc-1",
        matrix: { planner: claudeOpus, builder: claudeSonnet, reviewer: codexSol },
      },
    ],
    adaptiveAssignments: [
      {
        id: "claude-sonnet-5-xhigh",
        assignment: claudeSonnet,
        providerFamily: "anthropic",
        capabilityRef: "docs/harness/capability-matrix.md#claude",
        conservativeEstimate: 12,
        qualificationRef: "research/2026-07-15_model-assignment-refresh.md",
      },
      {
        id: "gpt-5.6-sol-xhigh",
        assignment: codexSol,
        providerFamily: "openai",
        capabilityRef: "docs/harness/capability-matrix.md#codex",
        conservativeEstimate: 20,
        qualificationRef: "campaign:fixture",
      },
    ],
    envelope: { maxOutputTokens: 400_000, maxEquivUsd: 120, authorization: "bikramgupta 2026-08-08, exact" },
    planGate: { kind: "human" },
    graderPlan: [
      { axis: "P-2", mechanical: true },
      { axis: "O-1", grader: codexSol, readTurnIds: ["build"] },
    ],
    ...overrides,
  };
}

/** `exactOptionalPropertyTypes` is on, so "the config omits this field" is
 *  expressed by DELETING the key — assigning `undefined` is a different thing
 *  and would not exercise the omission the contract refuses. */
function omitting(key: "envelope" | "planGate"): AcceptanceCampaignConfig {
  const built = config();
  delete built[key];
  return built;
}

function refusalFor(built: AcceptanceCampaignConfig): CampaignConfigCode {
  try {
    validateCampaignConfig(built);
  } catch (error) {
    if (error instanceof CampaignConfigError) return error.code;
    throw error;
  }
  throw new Error("expected a CampaignConfigError, but the config validated");
}

function refusal(overrides: Partial<AcceptanceCampaignConfig>): CampaignConfigCode {
  try {
    validateCampaignConfig(config(overrides));
  } catch (error) {
    if (error instanceof CampaignConfigError) return error.code;
    throw error;
  }
  throw new Error("expected a CampaignConfigError, but the config validated");
}

describe("CF-J21-R (L1) the valid envelope", () => {
  it("accepts a complete config and records the exact matrix for the report", () => {
    const validated = validateCampaignConfig(config());
    expect(validated.scenarioIds).toEqual(["S-ACC-1"]);
    expect(validated.campaignOrg).toBe("cormidia-sandbox");
    expect(validated.matrices["S-ACC-1"]).toEqual({
      planner: claudeOpus,
      builder: claudeSonnet,
      reviewer: codexSol,
    });
    expect(validated.uncertifiedCandidateIds).toEqual([]);
  });

  it("accepts an uncertified candidate that DISCLOSES it, and names it", () => {
    const validated = validateCampaignConfig(
      config({
        adaptiveAssignments: [
          {
            id: "gpt-5.6-sol-xhigh",
            assignment: codexSol,
            providerFamily: "openai",
            capabilityRef: "docs/harness/capability-matrix.md#codex",
            conservativeEstimate: 15,
            uncertified: "no ratified qualification reference exists for this tuple yet",
          },
        ],
      }),
    );
    expect(validated.uncertifiedCandidateIds).toEqual(["gpt-5.6-sol-xhigh"]);
  });
});

describe("CF-J21-R (L1) each refusal class, pre-mutation and pre-spend", () => {
  it("negative control: no declared campaign org", () => {
    expect(refusal({ campaignOrg: "  " })).toBe("campaign-org-undeclared");
  });

  it("negative control: no scenarios", () => {
    expect(refusal({ scenarios: [] })).toBe("no-scenarios");
  });

  it("negative control: a duplicated scenario id", () => {
    const scenario = config().scenarios[0];
    expect(refusal({ scenarios: [scenario as never, scenario as never] })).toBe("duplicate-scenario");
  });

  it("negative control: an app arm missing a role", () => {
    expect(
      refusal({
        scenarios: [
          {
            id: "S-ACC-1",
            kind: "app",
            appSlug: "cormidia-sandbox/acc-1",
            worktree: "/sandbox/acc-1",
            matrix: { planner: claudeOpus, builder: claudeSonnet },
          },
        ],
      }),
    ).toBe("matrix-incomplete");
  });

  it("negative control: a job with no step matrix cannot identify which models ran", () => {
    expect(
      refusal({
        scenarios: [
          {
            id: "S-ACC-3",
            kind: "job",
            appSlug: "cormidia-sandbox/acc-3",
            worktree: "/sandbox/acc-3",
            matrix: {},
          },
        ],
      }),
    ).toBe("job-matrix-empty");
  });

  it("records a job's exact provider-step matrix", () => {
    const validated = validateCampaignConfig(
      config({
        scenarios: [
          {
            id: "S-ACC-3",
            kind: "job",
            appSlug: "cormidia-sandbox/acc-3",
            worktree: "/sandbox/acc-3",
            matrix: { "research-a": claudeSonnet, synthesize: claudeOpus },
          },
        ],
      }),
    );
    expect(validated.matrices["S-ACC-3"]).toEqual({ "research-a": claudeSonnet, synthesize: claudeOpus });
  });

  it("negative control: planner, builder and reviewer on one provider family", () => {
    expect(
      refusal({
        scenarios: [
          {
            id: "S-ACC-1",
            kind: "app",
            appSlug: "cormidia-sandbox/acc-1",
            worktree: "/sandbox/acc-1",
            matrix: { planner: claudeOpus, builder: claudeSonnet, reviewer: claudeOpus },
          },
        ],
      }),
    ).toBe("matrix-single-family");
  });

  it("negative control: `effort: max` on a harness that does not admit it", () => {
    expect(
      refusal({
        scenarios: [
          {
            id: "S-ACC-2",
            kind: "app",
            appSlug: "cormidia-sandbox/acc-2",
            worktree: "/sandbox/acc-2",
            matrix: {
              planner: { harness: "codex", model: "gpt-5.6-sol", effort: "max" },
              builder: { harness: "codex", model: "gpt-5.6-luna", effort: "xhigh" },
              reviewer: claudeOpus,
            },
          },
        ],
      }),
    ).toBe("illegal-effort");
  });

  it("accepts `effort: max` where the runtime admits it, rather than banning it outright", () => {
    expect(() =>
      validateCampaignConfig(
        config({
          scenarios: [
            {
              id: "S-ACC-1",
              kind: "app",
              appSlug: "cormidia-sandbox/acc-1",
              worktree: "/sandbox/acc-1",
              matrix: {
                planner: { harness: "claude", model: "claude-opus-4-8", effort: "max" },
                builder: claudeSonnet,
                reviewer: codexSol,
              },
            },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it("negative control: a candidate with neither a qualification_ref nor an uncertified disclosure", () => {
    expect(
      refusal({
        adaptiveAssignments: [
          {
            id: "mystery-tuple",
            assignment: codexSol,
            providerFamily: "openai",
            capabilityRef: "docs/harness/capability-matrix.md#codex",
            conservativeEstimate: 15,
          },
        ],
      }),
    ).toBe("candidate-provenance");
  });

  it("negative control: candidate ids and provider families cannot lie", () => {
    const candidates = config().adaptiveAssignments;
    expect(refusal({ adaptiveAssignments: [candidates[0]!, candidates[0]!] })).toBe("candidate-duplicate");
    expect(refusal({ adaptiveAssignments: [{ ...candidates[0]!, providerFamily: "openai" }, candidates[1]!] })).toBe(
      "candidate-family-mismatch",
    );
  });

  it("negative control: a grader tuple must be one of the sealed candidates", () => {
    expect(refusal({ adaptiveAssignments: [config().adaptiveAssignments[0]!] })).toBe("grader-candidate-missing");
  });

  it("negative control: a missing envelope, and each half of a partial one", () => {
    expect(refusalFor(omitting("envelope"))).toBe("envelope-missing");
    expect(refusal({ envelope: { maxOutputTokens: 0, maxEquivUsd: 120, authorization: "human" } })).toBe(
      "envelope-missing",
    );
    expect(refusal({ envelope: { maxOutputTokens: 400_000, maxEquivUsd: 0, authorization: "human" } })).toBe(
      "envelope-missing",
    );
    expect(refusal({ envelope: { maxOutputTokens: 400_000, maxEquivUsd: 120, authorization: "  " } })).toBe(
      "envelope-missing",
    );
  });

  it("negative control: no declared plan-gate policy — silence is not consent", () => {
    expect(refusalFor(omitting("planGate"))).toBe("plan-gate-undeclared");
  });

  it("accepts a declared auto-continue policy — legal since F-PT-030 resolved", () => {
    const validated = validateCampaignConfig(
      config({ planGate: { kind: "auto-continue", criteria: "rubric-6-attempted-on-P-1-and-P-5" } }),
    );
    expect(validated.planGate).toEqual({ kind: "auto-continue", criteria: "rubric-6-attempted-on-P-1-and-P-5" });
  });

  it("negative control: a model-graded axis that declares no grader or no read set", () => {
    expect(refusal({ graderPlan: [{ axis: "O-1", readTurnIds: ["build"] }] })).toBe("grader-plan-missing");
    expect(refusal({ graderPlan: [{ axis: "O-1", grader: codexSol }] })).toBe("grader-plan-missing");
  });

  it("negative control: a scenario-scoped grader row cannot name an unknown scenario", () => {
    expect(
      refusal({
        graderPlan: [{ axis: "O-1", scenarioIds: ["S-ACC-404"], grader: codexSol, readTurnIds: ["build"] }],
      }),
    ).toBe("grader-plan-missing");
  });

  it("lets a mechanical axis declare no grader at all", () => {
    expect(() => validateCampaignConfig(config({ graderPlan: [{ axis: "J-1", mechanical: true }] }))).not.toThrow();
  });
});
