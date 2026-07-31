import { describe, expect, it } from "vitest";
import { evaluateEpisodePlannerDiagnostic } from "../../src/eval-runner/diagnostic.js";

describe("OPERON-L4-002 diagnostic verdict", () => {
  it("requires three contract-valid and acceptable EP003 attempts without qualifying", () => {
    const verdict = evaluateEpisodePlannerDiagnostic(
      [1, 2, 3].map((repetition) => ({
        caseId: "OPERON-EP-003",
        repetition,
        contractPassed: true,
        acceptable: true,
      })),
      diagnosticSpecification(),
    );

    expect(verdict).toMatchObject({
      status: "passed",
      passed: true,
      qualificationIssued: false,
      qualificationProhibited: true,
      observedAttempts: 3,
      contractPasses: 3,
      acceptableAttempts: 3,
    });
  });

  it("does not average away a diagnostic contract or quality failure", () => {
    expect(
      evaluateEpisodePlannerDiagnostic([
        {
          caseId: "OPERON-EP-003",
          repetition: 1,
          contractPassed: false,
          acceptable: false,
        },
        {
          caseId: "OPERON-EP-003",
          repetition: 2,
          contractPassed: true,
          acceptable: true,
        },
        {
          caseId: "OPERON-EP-003",
          repetition: 3,
          contractPassed: true,
          acceptable: true,
        },
      ], diagnosticSpecification()),
    ).toMatchObject({
      status: "failed_contract",
      passed: false,
      qualificationIssued: false,
    });

    expect(
      evaluateEpisodePlannerDiagnostic([
        {
          caseId: "OPERON-EP-003",
          repetition: 1,
          contractPassed: true,
          acceptable: false,
        },
        {
          caseId: "OPERON-EP-003",
          repetition: 2,
          contractPassed: true,
          acceptable: true,
        },
        {
          caseId: "OPERON-EP-003",
          repetition: 3,
          contractPassed: true,
          acceptable: true,
        },
      ], diagnosticSpecification()),
    ).toMatchObject({
      status: "failed_quality",
      passed: false,
      qualificationIssued: false,
    });
  });

  it("rejects duplicate or contradictory evidence", () => {
    expect(
      evaluateEpisodePlannerDiagnostic([
        {
          caseId: "OPERON-EP-003",
          repetition: 1,
          contractPassed: false,
          acceptable: true,
        },
        {
          caseId: "OPERON-EP-003",
          repetition: 1,
          contractPassed: true,
          acceptable: true,
        },
      ], diagnosticSpecification()),
    ).toMatchObject({
      status: "invalid_evidence",
      passed: false,
      qualificationIssued: false,
    });
  });

  it("OPERON-L4-003-DET-002 binds EP004 to an explicit campaign identity", () => {
    expect(
      evaluateEpisodePlannerDiagnostic(
        [1, 2, 3].map((repetition) => ({
          caseId: "OPERON-EP-004",
          repetition,
          contractPassed: true,
          acceptable: true,
        })),
        {
          campaignId: "OPERON-L4-003",
          caseId: "OPERON-EP-004",
          requiredAttempts: 3,
        },
      ),
    ).toMatchObject({
      campaignId: "OPERON-L4-003",
      status: "passed",
      passed: true,
      contractPasses: 3,
      acceptableAttempts: 3,
    });
  });
});

function diagnosticSpecification() {
  return {
    campaignId: "OPERON-L4-002",
    caseId: "OPERON-EP-003",
    requiredAttempts: 3,
  };
}
