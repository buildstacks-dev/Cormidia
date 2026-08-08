// campaign/acceptance/mechanical-scoring.ts — the axes that are set
// comparisons, not judgments (rubric §4, §7 rule 3; llm-eval-plan S-11).
//
// "Guardrails enforce; evals measure" (standing rule 2). Whether `merged.json`
// contains the single-source tool and preserves the seeded conflict is a set
// comparison against the sealed key. Asking a model to score it would be
// strictly worse AND would leave S-ACC-3 ungradeable, because its fan-out spans
// both provider families and a whole-scenario disjointness rule would admit no
// legal grader.
//
// The key is applied HERE, outside any model, after every grader turn has
// terminated (CORMIDIA-C-B28-001 §4).
//
// A deliberate limit, stated rather than hidden: coverage is matched on the
// planted token, not on meaning. A ticket set that addresses a planted
// requirement in different words scores as a miss. That is the conservative
// direction — it under-credits rather than over-credits — and rubric §5's
// `ungraded` is not available here because the evidence IS present. Where the
// human wants credit for a paraphrase, the plant should carry a distinctive
// term the answer key can match on.

import type { AxisScoreValue } from "./verdict-algebra.js";

export interface MechanicalAxisResult {
  axis: string;
  score: AxisScoreValue;
  justification: string;
  citations: string[];
}

/** Normalized containment — whitespace and case are never the finding. */
function mentions(haystack: string, needle: string): boolean {
  const flat = haystack.toLowerCase().replace(/\s+/g, " ");
  return flat.includes(needle.toLowerCase().replace(/\s+/g, " "));
}

function band(hit: number, total: number): 0 | 1 | 2 | 3 {
  if (total === 0 || hit === 0) return 0;
  if (hit === total) return 3;
  return hit * 2 >= total ? 2 : 1;
}

export interface KeyCoverageInput {
  axis: string;
  /** Distinctive terms from the sealed key this axis expects to find. */
  expected: readonly { id: string; term: string }[];
  /** The artifact the axis reads — the ticket set, the plan, the merged file. */
  evidence: string;
  evidenceRef: string;
  /** When true, a match is a MISS: P-4 scores tangents that must be ABSENT. */
  expectAbsent?: boolean;
}

/**
 * Score one key-coverage axis (P-1/P-2/P-3 present; P-4 absent). Every result
 * carries its citation, so it satisfies the same mandatory-citation rule a
 * model-graded axis does — a mechanical score with no evidence reference would
 * be exactly as unauditable.
 */
export function scoreKeyCoverage(input: KeyCoverageInput): MechanicalAxisResult {
  const wanted = input.expectAbsent !== true;
  const hits = input.expected.filter((item) => mentions(input.evidence, item.term) === wanted);
  const missed = input.expected.filter((item) => !hits.includes(item));
  return {
    axis: input.axis,
    score: band(hits.length, input.expected.length),
    justification:
      `${hits.length}/${input.expected.length} sealed-key items ${wanted ? "covered" : "correctly absent"} in ` +
      `${input.evidenceRef}` +
      (missed.length === 0 ? "" : `; missed: ${missed.map((item) => item.id).join(", ")}`),
    citations: [input.evidenceRef],
  };
}

export interface DeclaredOutputCheck {
  path: string;
  exists: boolean;
  /** Result of the step's own declared check, as the job journal recorded it. */
  checkPassed: boolean;
}

/** J-1 — every declared output exists and passes its declared check. Reads the
 *  journal's verdict rather than re-deriving it: the journal is the sole
 *  completion authority (CORMIDIA-C-B30-002). */
export function scoreArtifactCompleteness(
  outputs: readonly DeclaredOutputCheck[],
  evidenceRef: string,
): MechanicalAxisResult {
  const passing = outputs.filter((output) => output.exists && output.checkPassed);
  const failing = outputs.filter((output) => !passing.includes(output));
  return {
    axis: "J-1",
    score: band(passing.length, outputs.length),
    justification:
      `${passing.length}/${outputs.length} declared outputs exist and passed their declared check` +
      (failing.length === 0 ? "" : `; failed: ${failing.map((output) => output.path).join(", ")}`),
    citations: [evidenceRef],
  };
}

export interface HandoffFidelityInput {
  /** The fan-in artifact under test, e.g. `merged.json`. */
  merged: string;
  mergedRef: string;
  /** From the seed manifest's sealed block. */
  singleSourceTool: string;
  conflictingTool: string;
  /** The two incompatible claims the merged artifact must both preserve. */
  conflictingClaims: readonly string[];
}

/**
 * J-2 — handoff fidelity, the highest-value job axis.
 *
 * Two independent failures, and they are different failures:
 *   * the single-source tool is ABSENT ⇒ the fan-in step did not read all three
 *     inputs, however good the rest is;
 *   * the seeded conflict was RESOLVED into one claim rather than recorded ⇒
 *     the step invented agreement, which is what a job has no reviewer to catch.
 */
export function scoreHandoffFidelity(input: HandoffFidelityInput): MechanicalAxisResult {
  const readAllInputs = mentions(input.merged, input.singleSourceTool);
  const preservedClaims = input.conflictingClaims.filter((claim) => mentions(input.merged, claim));
  const preservedConflict = preservedClaims.length === input.conflictingClaims.length;

  const failures: string[] = [];
  if (!readAllInputs) failures.push(`${input.singleSourceTool} is absent — the fan-in did not read all three inputs`);
  if (!preservedConflict) {
    failures.push(
      `the ${input.conflictingTool} disagreement was not preserved (${preservedClaims.length}/` +
        `${input.conflictingClaims.length} claims present) — it was resolved rather than recorded`,
    );
  }
  const score: 0 | 1 | 2 | 3 = readAllInputs && preservedConflict ? 3 : readAllInputs || preservedConflict ? 1 : 0;
  return {
    axis: "J-2",
    score,
    justification:
      failures.length === 0
        ? `${input.mergedRef} contains every upstream artifact verbatim, including the preserved disagreement`
        : failures.join("; "),
    citations: [input.mergedRef],
  };
}
