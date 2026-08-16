// CF-INV-ACC-5 / CF-INV-ACC-6 — HB-124 — invariants.md INV-ACC-5/6; validation-policy.yaml verdict_semantics.axis_score.

// The axis_score truth table (L1).
//
// Every rule asserted here is READ FROM POLICY, not restated: the test loads
// `verdict_semantics.axis_score` from the ratified file and then proves the
// module obeys it. That ordering is the point of HB-124 — the truth table is
// policy data, so tightening it is a human policy edit rather than a runner
// change nobody reviews.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  aggregateAxisScores,
  assertNoThresholdRatified,
  campaignVerdict,
  loadAxisScorePolicy,
  normalizeAxisResult,
  scenarioCompleteness,
  UNGRADED,
  VerdictAlgebraError,
  type AxisResult,
  type AxisScorePolicy,
} from "../../../campaign/acceptance/verdict-algebra.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const policy: AxisScorePolicy = loadAxisScorePolicy(repoRoot);

function graded(axis: string, score: 0 | 1 | 2 | 3): AxisResult {
  return normalizeAxisResult({ axis, score, justification: `${axis} is supported`, citations: ["diff"] }, policy);
}

describe("CF-INV-ACC-5 (L1) the truth table comes from policy", () => {
  it("loads the ratified value set and rules", () => {
    expect(policy.values).toEqual([0, 1, 2, 3, "ungraded"]);
    expect(policy.rules.length).toBeGreaterThan(0);
    expect(policy.rules.join(" ")).toContain("never coerced to 0");
  });

  it("declares NO threshold in v0, and refuses to run if that ever changes silently", () => {
    expect(policy.thresholds).toBe("none");
    expect(() => assertNoThresholdRatified(policy)).not.toThrow();
    expect(() => assertNoThresholdRatified({ ...policy, thresholds: "mean >= 2.0 passes" })).toThrow(
      VerdictAlgebraError,
    );
  });

  it("every threshold-dependent verdict is inconclusive, never pass or fail", () => {
    expect(campaignVerdict(policy)).toBe("inconclusive");
    expect(graded("O-1", 3).verdict).toBe("inconclusive");
  });

  it("refuses a score outside the policy value set rather than coercing it", () => {
    expect(() =>
      normalizeAxisResult({ axis: "O-1", score: 5 as unknown as 3, justification: "x", citations: ["diff"] }, policy),
    ).toThrow(VerdictAlgebraError);
  });
});

describe("CF-INV-ACC-5 (L1) a citation-less score is discarded, not retained as a number", () => {
  it("negative control: a seeded citation-less score becomes ungraded", () => {
    const result = normalizeAxisResult({ axis: "O-3", score: 3, justification: "looks fine" }, policy);
    expect(result.score).toBe(UNGRADED);
    expect(result.ungradedReason).toBe("citation-missing");
    expect(result.justification).toBeNull();
  });

  it("negative control: an empty justification with citations is also discarded", () => {
    const result = normalizeAxisResult({ axis: "O-3", score: 2, justification: "   ", citations: ["diff"] }, policy);
    expect(result.score).toBe(UNGRADED);
    expect(result.ungradedReason).toBe("citation-missing");
  });

  it("keeps a score that carries both a justification and at least one citation", () => {
    const result = graded("O-3", 2);
    expect(result.score).toBe(2);
    expect(result.citations).toEqual(["diff"]);
  });

  it("carries the ungraded reason through when the grader itself reported ungraded", () => {
    const result = normalizeAxisResult({ axis: "O-2", score: UNGRADED, ungradedReason: "no-legal-grader" }, policy);
    expect(result.ungradedReason).toBe("no-legal-grader");
  });
});

describe("CF-INV-ACC-5 (L1) ungraded is never 0 and never a numeric aggregate term", () => {
  it("names the graded denominator and excludes ungraded axes from it", () => {
    const results = [
      graded("O-1", 3),
      graded("O-2", 1),
      normalizeAxisResult({ axis: "O-3", score: 2, justification: "no citation" }, policy),
    ];
    const aggregate = aggregateAxisScores(results);
    expect(aggregate.gradedAxisIds).toEqual(["O-1", "O-2"]);
    expect(aggregate.gradedDenominator).toBe(2);
    expect(aggregate.ungradedAxisIds).toEqual(["O-3"]);
    expect(aggregate.total).toBe(4);
    expect(aggregate.mean).toBe(2);
    expect(aggregate.display).toContain("2 graded axes");
  });

  it("negative control: a fully-ungraded scenario never renders as a 0 score", () => {
    const results = [
      normalizeAxisResult({ axis: "O-1", score: UNGRADED }, policy),
      normalizeAxisResult({ axis: "O-2", score: UNGRADED }, policy),
    ];
    const aggregate = aggregateAxisScores(results);
    expect(aggregate.total).toBeNull();
    expect(aggregate.mean).toBeNull();
    expect(aggregate.gradedDenominator).toBe(0);
    expect(aggregate.display.startsWith("ungraded")).toBe(true);
    // Never renders as a score: no leading numeral, no `0/N` score fraction,
    // and nothing a reader could parse as "the org scored zero here".
    expect(aggregate.display).not.toMatch(/^\s*0/);
    expect(aggregate.display).not.toMatch(/\b0\s*\/\s*\d/);
    expect(Number.parseFloat(aggregate.display)).toBeNaN();
  });

  it("a one-ungraded, one-3 scenario means 3, not 1.5 — ungraded is not a zero term", () => {
    const aggregate = aggregateAxisScores([
      graded("O-1", 3),
      normalizeAxisResult({ axis: "O-2", score: UNGRADED }, policy),
    ]);
    expect(aggregate.mean).toBe(3);
    expect(aggregate.gradedDenominator).toBe(1);
  });
});

describe("CF-INV-ACC-6 (L1) an unfinished scenario is never complete", () => {
  it("is complete only when every axis graded and nothing stopped it", () => {
    expect(scenarioCompleteness({ results: [graded("O-1", 3), graded("O-2", 2)] })).toEqual({
      completeness: "complete",
      reasons: [],
    });
  });

  it("negative control: ceiling exhaustion makes the scenario incomplete", () => {
    const outcome = scenarioCompleteness({ results: [graded("O-1", 3)], ceilingExhausted: true });
    expect(outcome.completeness).toBe("incomplete");
    expect(outcome.reasons).toContain("ceiling_exhausted");
  });

  it("negative control: a killed scenario is incomplete", () => {
    expect(scenarioCompleteness({ results: [graded("O-1", 3)], killed: true }).reasons).toContain("scenario_killed");
  });

  it("negative control: a missing grader run is incomplete and names the axis", () => {
    const outcome = scenarioCompleteness({ results: [graded("O-1", 3)], missingGraderRuns: ["O-5"] });
    expect(outcome.reasons).toContain("missing_grader_run:O-5");
  });

  it("negative control: any ungraded axis makes the scenario incomplete", () => {
    const outcome = scenarioCompleteness({
      results: [
        graded("O-1", 3),
        normalizeAxisResult({ axis: "O-5", score: UNGRADED, ungradedReason: "key-leaked" }, policy),
      ],
    });
    expect(outcome.completeness).toBe("incomplete");
    expect(outcome.reasons).toContain("ungraded:O-5:key-leaked");
  });

  it("negative control: a scenario with no axis results at all is incomplete, never green by absence", () => {
    expect(scenarioCompleteness({ results: [] })).toEqual({
      completeness: "incomplete",
      reasons: ["no_axis_results"],
    });
  });
});
