import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  qualifyEpisodePlannerCampaign,
  qualifyAttempts,
  type QualificationAttempt,
} from "../../src/eval-runner/qualification.js";
import {
  loadEpisodePlannerCorpus,
  scoreEpisodePlan,
} from "../../src/eval-runner/episode-planner-corpus.js";
import type { EpisodePlan } from "../../../src/loop/episode-plan.js";
import { HARNESS_ROOT } from "../../src/fixtures/controlled-world.js";

interface Fixture {
  threshold: { min_score: number; min_attempts_per_case: number };
  attempts: Array<{
    case_id: string;
    attempt: number;
    contract_passed: boolean;
    quality_score: number;
  }>;
}

describe("LLM qualification aggregation", () => {
  it("blocks while the human-ratified threshold is absent", () => {
    const verdict = qualifyAttempts([
      { caseId: "one", attempt: 1, contractPassed: true, qualityScore: 1 },
    ]);
    expect(verdict).toMatchObject({ qualified: false, status: "blocking_absent" });
  });

  it("does not let quality averages rescue a deterministic contract failure", () => {
    const attempts: QualificationAttempt[] = [
      { caseId: "one", attempt: 1, contractPassed: true, qualityScore: 1 },
      { caseId: "one", attempt: 2, contractPassed: false, qualityScore: 1 },
      { caseId: "one", attempt: 3, contractPassed: true, qualityScore: 1 },
    ];
    expect(
      qualifyAttempts(attempts, { minScore: 0.8, minAttemptsPerCase: 3 }),
    ).toMatchObject({ qualified: false, status: "blocked_contract" });
  });

  it("rejects duplicated repetitions and impossible scores before aggregation", () => {
    expect(
      qualifyAttempts(
        [
          { caseId: "one", attempt: 1, contractPassed: true, qualityScore: 1 },
          { caseId: "one", attempt: 1, contractPassed: true, qualityScore: 1 },
          { caseId: "one", attempt: 2, contractPassed: true, qualityScore: 2 },
        ],
        { minScore: 0.8, minAttemptsPerCase: 3 },
      ),
    ).toMatchObject({ qualified: false, status: "blocked_invalid_evidence" });
  });

  it("does not count invalid attempt identities toward repetition", () => {
    expect(
      qualifyAttempts(
        [
          { caseId: "one", attempt: 0, contractPassed: true, qualityScore: 1 },
          { caseId: "one", attempt: 1, contractPassed: true, qualityScore: 1 },
          { caseId: "one", attempt: 2, contractPassed: true, qualityScore: 1 },
        ],
        { minScore: 0.8, minAttemptsPerCase: 3 },
      ),
    ).toMatchObject({ qualified: false, status: "blocked_invalid_evidence" });
  });

  it("can aggregate a static non-spending fixture once a threshold is supplied", async () => {
    const fixture = parse(
      await readFile(resolve(HARNESS_ROOT, "fixtures", "eval", "runner-attempts.yaml"), "utf8"),
    ) as Fixture;
    const attempts = fixture.attempts.map((attempt) => ({
      caseId: attempt.case_id,
      attempt: attempt.attempt,
      contractPassed: attempt.contract_passed,
      qualityScore: attempt.quality_score,
    }));
    const verdict = qualifyAttempts(attempts, {
      minScore: fixture.threshold.min_score,
      minAttemptsPerCase: fixture.threshold.min_attempts_per_case,
    });
    expect(verdict).toMatchObject({ qualified: true, status: "qualified" });
  });

  it("loads the frozen Episode Planner corpus and verifies its content hash", async () => {
    const corpus = await loadEpisodePlannerCorpus();

    expect(corpus.cases).toHaveLength(10);
    expect(corpus.manifest.assignment).toEqual({
      harness: "claude",
      model: "claude-opus-5",
      effort: "xhigh",
    });
    expect(corpus.manifest.critical_cases).toHaveLength(6);
  });

  it("scores the pre-provider case oracle without exposing it to the candidate", async () => {
    const corpus = await loadEpisodePlannerCorpus();
    const goldenCase = corpus.cases.find((entry) => entry.case_id === "OPERON-EP-001")!;
    const accepted = scoreEpisodePlan(boundedDefectPlan(), goldenCase);
    const overPlanned = scoreEpisodePlan(
      {
        ...boundedDefectPlan(),
        steps: [
          providerStep("analyze", "planner", "plan/analyze", []),
          providerStep("build", "builder", "build/implement", ["analyze"]),
          providerStep("review", "reviewer", "review/verify", ["build"]),
        ],
      },
      goldenCase,
    );

    expect(accepted).toMatchObject({ acceptable: true, score: 1 });
    expect(overPlanned).toMatchObject({ acceptable: false, score: 0 });
    expect(
      overPlanned.checks.find((check) => check.id === "no_speculative_provider_operation"),
    ).toMatchObject({ passed: false });
  });

  it("deposits the observed security-specific operation-selection failure", async () => {
    const corpus = await loadEpisodePlannerCorpus();
    const goldenCase = corpus.cases.find((entry) => entry.case_id === "OPERON-EP-003")!;
    const genericReview = scoreEpisodePlan(
      authenticationSecurityPlan("review/verify"),
      goldenCase,
    );
    const securityReview = scoreEpisodePlan(
      authenticationSecurityPlan("review/security"),
      goldenCase,
    );

    expect(genericReview).toMatchObject({ acceptable: false, score: 0 });
    expect(
      genericReview.checks.find(
        (check) => check.id === "required_provider:reviewer:review/security",
      ),
    ).toMatchObject({ passed: false });
    expect(
      genericReview.checks.find(
        (check) => check.id === "no_speculative_provider_operation",
      ),
    ).toMatchObject({ passed: false });
    expect(securityReview).toMatchObject({ acceptable: true, score: 1 });
  });

  it("enforces the ratified overall, per-case, and critical-case floors", () => {
    const caseIds = Array.from({ length: 10 }, (_, index) => `case-${index + 1}`);
    const criticalCaseIds = caseIds.slice(0, 2);
    const attempts = caseIds.flatMap((caseId) =>
      [1, 2, 3].map((repetition) => ({
        caseId,
        repetition,
        contractPassed: true,
        acceptable: !(caseId === "case-10" && repetition === 3),
      })),
    );
    const threshold = {
      caseIds,
      criticalCaseIds,
      runsPerCase: 3,
      totalAttempts: 30,
      overallMinAcceptable: 27,
      minAcceptablePerCase: 2,
      criticalMinAcceptablePerCase: 3,
    };

    expect(qualifyEpisodePlannerCampaign(attempts, threshold)).toMatchObject({
      qualified: true,
      status: "qualified",
      overallAcceptable: 29,
    });

    attempts.find((attempt) => attempt.caseId === "case-1" && attempt.repetition === 3)!.acceptable =
      false;
    expect(qualifyEpisodePlannerCampaign(attempts, threshold)).toMatchObject({
      qualified: false,
      status: "blocked_quality",
      statisticalThresholdMet: false,
    });
  });

  it("never issues qualification while a deterministic product gate is red", () => {
    const caseIds = ["one"];
    const attempts = [1, 2, 3].map((repetition) => ({
      caseId: "one",
      repetition,
      contractPassed: true,
      acceptable: true,
    }));

    expect(
      qualifyEpisodePlannerCampaign(
        attempts,
        {
          caseIds,
          criticalCaseIds: ["one"],
          runsPerCase: 3,
          totalAttempts: 3,
          overallMinAcceptable: 3,
          minAcceptablePerCase: 2,
          criticalMinAcceptablePerCase: 3,
        },
        ["TM-002 remains unresolved"],
      ),
    ).toMatchObject({
      qualified: false,
      status: "blocked_deterministic_gate",
      statisticalThresholdMet: true,
    });
  });

  it("reports an observed contract failure even when the campaign stopped early", () => {
    expect(
      qualifyEpisodePlannerCampaign(
        [
          {
            caseId: "one",
            repetition: 1,
            contractPassed: false,
            acceptable: false,
          },
        ],
        {
          caseIds: ["one"],
          criticalCaseIds: ["one"],
          runsPerCase: 3,
          totalAttempts: 3,
          overallMinAcceptable: 3,
          minAcceptablePerCase: 2,
          criticalMinAcceptablePerCase: 3,
        },
      ),
    ).toMatchObject({
      qualified: false,
      status: "blocked_contract",
    });
  });
});

function boundedDefectPlan(): EpisodePlan {
  return {
    schemaVersion: 1,
    episodeId: "example",
    version: 1,
    intentHash: "a".repeat(64),
    summary: "bounded defect",
    workflowClass: "bounded-defect",
    planningSource: "episode_planner",
    steps: [
      providerStep("build", "builder", "build/implement", []),
      providerStep("review", "reviewer", "review/verify", ["build"]),
    ],
    estimatedBudget: {
      providerTurns: 2,
      providerTurnBudgetUsd: 10,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 10,
    },
    derivedSafetyRoute: {
      label: "standard",
      reasons: ["derived-from-2-provider-turns"],
      gateStepIds: [],
      approvalStepIds: [],
    },
    createdAt: "2026-07-30T00:00:00.000Z",
  };
}

function authenticationSecurityPlan(reviewOperation: string): EpisodePlan {
  const base = boundedDefectPlan();
  return {
    ...base,
    episodeId: "authentication-security",
    summary: "bounded authentication change with security review",
    workflowClass: "bounded-security-change",
    steps: [
      providerStep("build", "builder", "build/implement", []),
      providerStep("review", "reviewer", reviewOperation, ["build"]),
      {
        id: "security-gate",
        kind: "mechanical_gate",
        objective: "Apply the deterministic security gate",
        dependsOn: ["review"],
        inputRefs: [],
        expectedOutputs: [
          { id: "security-gate-result", kind: "gate-result", required: true },
        ],
        gate: "security",
      },
    ],
    derivedSafetyRoute: {
      label: "authentication-security",
      reasons: ["authentication changes require a security gate"],
      gateStepIds: ["security-gate"],
      approvalStepIds: [],
    },
  };
}

function providerStep(
  id: string,
  role: string,
  operation: string,
  dependsOn: string[],
): EpisodePlan["steps"][number] {
  return {
    id,
    kind: "provider_turn",
    objective: `${operation} objective`,
    dependsOn,
    inputRefs: [],
    expectedOutputs: [{ id: `${id}-output`, kind: "artifact", required: id === "review" }],
    operation,
    role,
    requiredCapabilities: [],
    assignment:
      role === "reviewer"
        ? { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" }
        : { harness: "claude", model: "claude-sonnet-4-6", effort: "high" },
    assignmentSource: "configured",
    maxTurnBudgetUsd: 5,
    selectionReason: "frozen case fixture",
  };
}
