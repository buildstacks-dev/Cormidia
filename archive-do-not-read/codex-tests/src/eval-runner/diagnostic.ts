export interface EpisodePlannerDiagnosticAttempt {
  caseId: string;
  repetition: number;
  contractPassed: boolean;
  acceptable: boolean;
}

export interface EpisodePlannerDiagnosticVerdict {
  campaignId: string;
  status:
    | "passed"
    | "failed_contract"
    | "failed_quality"
    | "incomplete"
    | "invalid_evidence";
  passed: boolean;
  qualificationIssued: false;
  qualificationProhibited: true;
  requiredAttempts: number;
  observedAttempts: number;
  contractPasses: number;
  acceptableAttempts: number;
  failures: string[];
}

export interface EpisodePlannerDiagnosticSpecification {
  campaignId: string;
  caseId: string;
  requiredAttempts: number;
}

export function evaluateEpisodePlannerDiagnostic(
  attempts: readonly EpisodePlannerDiagnosticAttempt[],
  specification: EpisodePlannerDiagnosticSpecification,
): EpisodePlannerDiagnosticVerdict {
  if (
    specification.campaignId.length === 0 ||
    specification.caseId.length === 0 ||
    !Number.isInteger(specification.requiredAttempts) ||
    specification.requiredAttempts < 1
  ) {
    throw new TypeError("diagnostic specification must be explicit and valid");
  }
  const failures: string[] = [];
  const identities = new Set<string>();
  for (const attempt of attempts) {
    if (
      attempt.caseId !== specification.caseId ||
      !Number.isInteger(attempt.repetition) ||
      attempt.repetition < 1 ||
      attempt.repetition > specification.requiredAttempts
    ) {
      failures.push(
        `invalid attempt identity ${attempt.caseId}/r${String(attempt.repetition)}`,
      );
      continue;
    }
    const identity = `${attempt.caseId}/r${attempt.repetition}`;
    if (identities.has(identity)) failures.push(`duplicate attempt identity ${identity}`);
    identities.add(identity);
    if (attempt.acceptable && !attempt.contractPassed) {
      failures.push(`${identity} cannot be acceptable after a contract failure`);
    }
  }

  const contractPasses = attempts.filter((attempt) => attempt.contractPassed).length;
  const acceptableAttempts = attempts.filter((attempt) => attempt.acceptable).length;
  let status: EpisodePlannerDiagnosticVerdict["status"];
  if (failures.length > 0) status = "invalid_evidence";
  else if (attempts.length < specification.requiredAttempts) status = "incomplete";
  else if (contractPasses < specification.requiredAttempts) status = "failed_contract";
  else if (acceptableAttempts < specification.requiredAttempts) status = "failed_quality";
  else status = "passed";

  return {
    campaignId: specification.campaignId,
    status,
    passed: status === "passed",
    qualificationIssued: false,
    qualificationProhibited: true,
    requiredAttempts: specification.requiredAttempts,
    observedAttempts: attempts.length,
    contractPasses,
    acceptableAttempts,
    failures,
  };
}
