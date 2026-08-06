import { createHash } from "node:crypto";

import type { CampaignCaseResult } from "../campaign/campaign-runner.js";
import type { GithubConformanceReport } from "../fixtures/github-double/conformance/suite.js";

/** Project the real-boundary report into durable campaign semantics. A true
 * contract mismatch is a violation. Exhausting a finite observation window
 * for a backend projection whose contract has no staleness maximum is missing
 * evidence: incomplete/inconclusive, never pass and never product fail. */
export function githubConformanceCaseResult(repo: string, report: GithubConformanceReport): CampaignCaseResult {
  const violations = report.failures.filter((failure) => failure.classification === "violation");
  const inconclusive = report.failures.filter((failure) => failure.classification === "observation_inconclusive");
  return {
    caseComplete: inconclusive.length === 0,
    providerTurns: 0,
    equivUsd: 0,
    violationIds: violations.map((failure) => `CORMIDIA-C-B01-001:${failure.id}`),
    reasonCodes: [
      ...violations.map((failure) => `github_clause_failed:${failure.id}:${failure.code}`),
      ...inconclusive.map((failure) => `github_clause_inconclusive:${failure.id}:${failure.code}`),
    ],
    evidenceRefs: [
      `github:${repo}:clauses:${report.passed.length}/${report.total}`,
      ...report.failures.map(
        (failure) =>
          `github:${repo}:clause:${failure.id}:${failure.classification}:${failure.code}:error-sha256:${sha256(failure.error)}`,
      ),
    ],
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
