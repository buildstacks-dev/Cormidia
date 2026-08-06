// CF-REG-291 — a finite sample of GitHub's eventually consistent search
// projection cannot falsify a contract that promises no staleness maximum.
// The gate must remain red as incomplete/inconclusive, while real artifact
// mismatches remain product violations and retain sanitized diagnostic proof.

import { describe, expect, it } from "vitest";

import type { GithubConformanceReport } from "../../fixtures/github-double/conformance/suite.js";
import { githubConformanceCaseResult } from "../../live/github-conformance-result.js";

function report(classification: "violation" | "observation_inconclusive", code: string): GithubConformanceReport {
  return {
    target: "github:sandbox/example",
    total: 15,
    passed: Array.from({ length: 15 }, (_, index) => `B01-CF-${String(index + 1).padStart(2, "0")}`).filter(
      (id) => id !== "B01-CF-02",
    ),
    failures: [
      {
        id: "B01-CF-02",
        name: "createIssue returns the created artifact identity and round-trips",
        classification,
        code,
        error: "seeded diagnostic detail",
      },
    ],
  };
}

describe("CF-REG-291 — GitHub observation gaps are never product violations or green", () => {
  it("preserves bounded search exhaustion as an incomplete case with diagnostic identity", () => {
    const result = githubConformanceCaseResult(
      "sandbox/example",
      report("observation_inconclusive", "label_filtered_issue_search_not_observed"),
    );

    expect(result).toMatchObject({
      caseComplete: false,
      providerTurns: 0,
      equivUsd: 0,
      violationIds: [],
      reasonCodes: ["github_clause_inconclusive:B01-CF-02:label_filtered_issue_search_not_observed"],
    });
    expect(result.evidenceRefs).toEqual([
      "github:sandbox/example:clauses:14/15",
      expect.stringMatching(
        /^github:sandbox\/example:clause:B01-CF-02:observation_inconclusive:label_filtered_issue_search_not_observed:error-sha256:[a-f0-9]{64}$/,
      ),
    ]);
  });

  it("seeded negative control: a true direct-artifact mismatch remains a product violation", () => {
    const result = githubConformanceCaseResult("sandbox/example", report("violation", "assertion_failed"));

    expect(result).toMatchObject({
      caseComplete: true,
      violationIds: ["CORMIDIA-C-B01-001:B01-CF-02"],
      reasonCodes: ["github_clause_failed:B01-CF-02:assertion_failed"],
    });
    expect(result.evidenceRefs[1]).toContain(":clause:B01-CF-02:violation:assertion_failed:error-sha256:");
  });
});
