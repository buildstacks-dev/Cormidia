export interface QualificationAttempt {
  caseId: string;
  attempt: number;
  contractPassed: boolean;
  qualityScore?: number;
}

export interface QualificationThreshold {
  minScore: number;
  minAttemptsPerCase: number;
}

export type QualificationVerdict =
  | {
      qualified: true;
      status: "qualified";
      caseScores: Record<string, number>;
    }
  | {
      qualified: false;
      status:
        | "blocking_absent"
        | "blocked_invalid_evidence"
        | "blocked_contract"
        | "blocked_insufficient_attempts"
        | "blocked_quality";
      reasons: string[];
    };

export function qualifyAttempts(
  attempts: QualificationAttempt[],
  threshold?: QualificationThreshold,
): QualificationVerdict {
  if (threshold === undefined) {
    return {
      qualified: false,
      status: "blocking_absent",
      reasons: ["quality threshold is unresolved"],
    };
  }
  if (
    !Number.isFinite(threshold.minScore) ||
    threshold.minScore < 0 ||
    threshold.minScore > 1 ||
    !Number.isInteger(threshold.minAttemptsPerCase) ||
    threshold.minAttemptsPerCase < 3
  ) {
    return {
      qualified: false,
      status: "blocking_absent",
      reasons: ["threshold must define a score in [0,1] and at least three attempts per case"],
    };
  }
  if (attempts.length === 0) {
    return {
      qualified: false,
      status: "blocked_insufficient_attempts",
      reasons: ["no qualification attempts were supplied"],
    };
  }
  const invalidEvidence: string[] = [];
  const seenAttempts = new Set<string>();
  for (const attempt of attempts) {
    if (attempt.caseId.trim() === "") {
      invalidEvidence.push("an attempt has an empty case id");
    }
    if (!Number.isInteger(attempt.attempt) || attempt.attempt < 1) {
      invalidEvidence.push(`${attempt.caseId || "<empty>"} has an invalid attempt number`);
    }
    const identity = `${attempt.caseId}\u0000${attempt.attempt}`;
    if (seenAttempts.has(identity)) {
      invalidEvidence.push(`${attempt.caseId} attempt ${attempt.attempt} is duplicated`);
    }
    seenAttempts.add(identity);
    if (
      attempt.qualityScore !== undefined &&
      (!Number.isFinite(attempt.qualityScore) ||
        attempt.qualityScore < 0 ||
        attempt.qualityScore > 1)
    ) {
      invalidEvidence.push(
        `${attempt.caseId} attempt ${attempt.attempt} has a quality score outside [0,1]`,
      );
    }
  }
  if (invalidEvidence.length > 0) {
    return {
      qualified: false,
      status: "blocked_invalid_evidence",
      reasons: invalidEvidence,
    };
  }
  const contractFailures = attempts.filter((attempt) => !attempt.contractPassed);
  if (contractFailures.length > 0) {
    return {
      qualified: false,
      status: "blocked_contract",
      reasons: contractFailures.map(
        (attempt) => `${attempt.caseId} attempt ${attempt.attempt} failed the deterministic contract`,
      ),
    };
  }

  const byCase = new Map<string, QualificationAttempt[]>();
  for (const attempt of attempts) {
    const existing = byCase.get(attempt.caseId) ?? [];
    existing.push(attempt);
    byCase.set(attempt.caseId, existing);
  }
  const insufficient = [...byCase.entries()]
    .filter(([, values]) => values.length < threshold.minAttemptsPerCase)
    .map(([caseId, values]) => `${caseId} has ${values.length}/${threshold.minAttemptsPerCase} attempts`);
  if (insufficient.length > 0) {
    return { qualified: false, status: "blocked_insufficient_attempts", reasons: insufficient };
  }

  const caseScores: Record<string, number> = {};
  const below: string[] = [];
  for (const [caseId, values] of byCase) {
    if (values.some((attempt) => attempt.qualityScore === undefined)) {
      below.push(`${caseId} has an unscored attempt`);
      continue;
    }
    const score =
      values.reduce((sum, attempt) => sum + (attempt.qualityScore ?? 0), 0) / values.length;
    caseScores[caseId] = score;
    if (score < threshold.minScore) {
      below.push(`${caseId} scored ${score.toFixed(3)} below ${threshold.minScore.toFixed(3)}`);
    }
  }
  if (below.length > 0) return { qualified: false, status: "blocked_quality", reasons: below };
  return { qualified: true, status: "qualified", caseScores };
}

export interface EpisodePlannerCampaignAttempt {
  caseId: string;
  repetition: number;
  contractPassed: boolean;
  acceptable: boolean;
}

export interface EpisodePlannerCampaignThreshold {
  caseIds: string[];
  criticalCaseIds: string[];
  runsPerCase: number;
  totalAttempts: number;
  overallMinAcceptable: number;
  minAcceptablePerCase: number;
  criticalMinAcceptablePerCase: number;
}

export interface EpisodePlannerCampaignVerdict {
  qualified: boolean;
  status:
    | "qualified"
    | "blocked_invalid_evidence"
    | "blocked_incomplete"
    | "blocked_contract"
    | "blocked_quality"
    | "blocked_deterministic_gate";
  statisticalThresholdMet: boolean;
  overallAcceptable: number;
  perCaseAcceptable: Record<string, number>;
  reasons: string[];
}

export function qualifyEpisodePlannerCampaign(
  attempts: EpisodePlannerCampaignAttempt[],
  threshold: EpisodePlannerCampaignThreshold,
  blockingGateFailures: string[] = [],
): EpisodePlannerCampaignVerdict {
  const invalid: string[] = [];
  const expectedCaseIds = new Set(threshold.caseIds);
  const criticalCaseIds = new Set(threshold.criticalCaseIds);
  if (
    expectedCaseIds.size !== threshold.caseIds.length ||
    threshold.caseIds.length === 0 ||
    threshold.criticalCaseIds.some((caseId) => !expectedCaseIds.has(caseId)) ||
    criticalCaseIds.size !== threshold.criticalCaseIds.length ||
    !Number.isInteger(threshold.runsPerCase) ||
    threshold.runsPerCase < 3 ||
    threshold.totalAttempts !== threshold.caseIds.length * threshold.runsPerCase ||
    !Number.isInteger(threshold.overallMinAcceptable) ||
    threshold.overallMinAcceptable < 0 ||
    threshold.overallMinAcceptable > threshold.totalAttempts ||
    !Number.isInteger(threshold.minAcceptablePerCase) ||
    threshold.minAcceptablePerCase < 0 ||
    threshold.minAcceptablePerCase > threshold.runsPerCase ||
    !Number.isInteger(threshold.criticalMinAcceptablePerCase) ||
    threshold.criticalMinAcceptablePerCase < threshold.minAcceptablePerCase ||
    threshold.criticalMinAcceptablePerCase > threshold.runsPerCase
  ) {
    invalid.push("campaign threshold is internally inconsistent");
  }

  const seen = new Set<string>();
  for (const attempt of attempts) {
    if (!expectedCaseIds.has(attempt.caseId)) {
      invalid.push(`unexpected case ${attempt.caseId}`);
    }
    if (
      !Number.isInteger(attempt.repetition) ||
      attempt.repetition < 1 ||
      attempt.repetition > threshold.runsPerCase
    ) {
      invalid.push(`${attempt.caseId} has invalid repetition ${attempt.repetition}`);
    }
    const identity = `${attempt.caseId}\0${attempt.repetition}`;
    if (seen.has(identity)) invalid.push(`${attempt.caseId} repetition ${attempt.repetition} is duplicated`);
    seen.add(identity);
  }
  if (invalid.length > 0) {
    return campaignVerdict("blocked_invalid_evidence", false, 0, {}, invalid);
  }

  const perCaseAttempts = new Map<string, EpisodePlannerCampaignAttempt[]>();
  for (const caseId of threshold.caseIds) perCaseAttempts.set(caseId, []);
  for (const attempt of attempts) perCaseAttempts.get(attempt.caseId)?.push(attempt);
  const contractFailures = attempts
    .filter((attempt) => !attempt.contractPassed)
    .map((attempt) => `${attempt.caseId} repetition ${attempt.repetition} failed the contract`);
  if (contractFailures.length > 0) {
    return campaignVerdict("blocked_contract", false, 0, {}, contractFailures);
  }
  const incomplete = [...perCaseAttempts.entries()]
    .filter(([, entries]) => entries.length !== threshold.runsPerCase)
    .map(([caseId, entries]) => `${caseId} has ${entries.length}/${threshold.runsPerCase} attempts`);
  if (attempts.length !== threshold.totalAttempts) {
    incomplete.unshift(`campaign has ${attempts.length}/${threshold.totalAttempts} attempts`);
  }
  if (incomplete.length > 0) {
    return campaignVerdict("blocked_incomplete", false, 0, {}, incomplete);
  }

  const perCaseAcceptable = Object.fromEntries(
    [...perCaseAttempts.entries()].map(([caseId, entries]) => [
      caseId,
      entries.filter((attempt) => attempt.acceptable).length,
    ]),
  );
  const overallAcceptable = Object.values(perCaseAcceptable)
    .reduce((sum, count) => sum + count, 0);
  const qualityFailures: string[] = [];
  if (overallAcceptable < threshold.overallMinAcceptable) {
    qualityFailures.push(
      `overall acceptable ${overallAcceptable}/${threshold.totalAttempts} is below ` +
        `${threshold.overallMinAcceptable}`,
    );
  }
  for (const caseId of threshold.caseIds) {
    const expected = criticalCaseIds.has(caseId)
      ? threshold.criticalMinAcceptablePerCase
      : threshold.minAcceptablePerCase;
    const actual = perCaseAcceptable[caseId] ?? 0;
    if (actual < expected) {
      qualityFailures.push(`${caseId} acceptable ${actual}/${threshold.runsPerCase} is below ${expected}`);
    }
  }
  if (qualityFailures.length > 0) {
    return campaignVerdict(
      "blocked_quality",
      false,
      overallAcceptable,
      perCaseAcceptable,
      qualityFailures,
    );
  }
  if (blockingGateFailures.length > 0) {
    return campaignVerdict(
      "blocked_deterministic_gate",
      true,
      overallAcceptable,
      perCaseAcceptable,
      blockingGateFailures,
    );
  }
  return campaignVerdict(
    "qualified",
    true,
    overallAcceptable,
    perCaseAcceptable,
    [],
    true,
  );
}

function campaignVerdict(
  status: EpisodePlannerCampaignVerdict["status"],
  statisticalThresholdMet: boolean,
  overallAcceptable: number,
  perCaseAcceptable: Record<string, number>,
  reasons: string[],
  qualified = false,
): EpisodePlannerCampaignVerdict {
  return {
    qualified,
    status,
    statisticalThresholdMet,
    overallAcceptable,
    perCaseAcceptable,
    reasons,
  };
}
