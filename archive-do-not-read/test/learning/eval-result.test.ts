// Tests the deterministic verdict computation and the decide transition
// (src/org/learning/eval-result.ts). M3 done-criterion 1 (second half): a
// scripted pair of fixture outcomes produces the correct verdict for each of
// the four verdict classes — improved, regressed, inconclusive,
// not_evaluatable — plus the fail-closed guardrail rules and the
// declared-before-results decide path.

import { afterEach, describe, expect, it } from "vitest";
import { makeOrgHome } from "../fixtures/orgHome.js";
import {
  computeEvalResult,
  decideExperiment,
  listEvalResults,
  readEvalResult,
  validateEvalResult,
  type EvalTrial,
} from "../../src/org/learning/eval-result.js";
import {
  declareExperiment,
  readExperimentRecord,
  validateExperimentRecord,
} from "../../src/org/learning/experiment.js";
import { makeExperiment } from "./helpers.js";

const CLEANUPS: Array<() => void> = [];
afterEach(() => {
  while (CLEANUPS.length > 0) CLEANUPS.pop()!();
});

/** Org-home stand-in via the packaged fixture (AGENTS.md: reuse
 *  test/fixtures/orgHome.ts instead of ad-hoc mkdtemp scaffolds). */
function tempDir(_prefix?: string): string {
  const home = makeOrgHome({});
  CLEANUPS.push(home.cleanup);
  return home.root;
}

// Experiment: review_cycles must DECREASE by >= 20%; merge_success must not
// decrease; cost_usd may increase at most 10%.
const EXPERIMENT = validateExperimentRecord(makeExperiment());

function compute(trials: EvalTrial[]) {
  return computeEvalResult({
    experiment: EXPERIMENT,
    trials,
    graderRef: "evals/roles/builder/standard-tickets/grader",
    costUsd: 0,
    decidedBy: "test",
    decidedAt: "2026-07-11T09:00:00.000Z",
  });
}

function pair(
  n: number,
  control: Record<string, number>,
  treatment: Record<string, number>,
): EvalTrial {
  return { pair: n, control, treatment };
}

describe("computeEvalResult — the four verdict classes", () => {
  it("improved: primary metric clears the minimum useful effect and guardrails hold", () => {
    const result = compute([
      pair(1, { review_cycles: 3, merge_success: 1, cost_usd: 11.2 }, { review_cycles: 1, merge_success: 1, cost_usd: 12.0 }),
      pair(2, { review_cycles: 2, merge_success: 1, cost_usd: 9.8 }, { review_cycles: 2, merge_success: 1, cost_usd: 10.1 }),
    ]);
    // control mean 2.5 -> treatment mean 1.5: a 40% decrease, min useful 20%.
    expect(result.primary_metric).toMatchObject({
      name: "review_cycles",
      control: 2.5,
      treatment: 1.5,
      direction_ok: true,
      min_useful_met: true,
    });
    expect(result.guardrails.every((g) => g.pass)).toBe(true);
    expect(result.verdict).toBe("improved");
    expect(result.grader).toEqual({
      kind: "deterministic",
      ref: "evals/roles/builder/standard-tickets/grader",
    });
  });

  it("regressed: the primary metric moved against the expected direction", () => {
    const result = compute([
      pair(1, { review_cycles: 2, merge_success: 1, cost_usd: 10 }, { review_cycles: 4, merge_success: 1, cost_usd: 10 }),
    ]);
    expect(result.primary_metric.direction_ok).toBe(false);
    expect(result.verdict).toBe("regressed");
  });

  it("regressed: a guardrail failure outranks a winning primary metric", () => {
    const result = compute([
      // review_cycles halves (a win) but cost_usd jumps 50% > the 10% bound.
      pair(1, { review_cycles: 4, merge_success: 1, cost_usd: 10 }, { review_cycles: 2, merge_success: 1, cost_usd: 15 }),
    ]);
    expect(result.primary_metric.min_useful_met).toBe(true);
    expect(result.guardrails.find((g) => g.metric === "cost_usd")).toMatchObject({
      pass: false,
    });
    expect(result.verdict).toBe("regressed");
  });

  it("inconclusive: movement in the right direction under the minimum useful effect", () => {
    const result = compute([
      // 10% decrease < the declared 20% minimum useful improvement.
      pair(1, { review_cycles: 10, merge_success: 1, cost_usd: 10 }, { review_cycles: 9, merge_success: 1, cost_usd: 10 }),
    ]);
    expect(result.primary_metric.direction_ok).toBe(true);
    expect(result.primary_metric.min_useful_met).toBe(false);
    expect(result.verdict).toBe("inconclusive");
  });

  it("inconclusive: no movement at all", () => {
    const result = compute([
      pair(1, { review_cycles: 2, merge_success: 1, cost_usd: 10 }, { review_cycles: 2, merge_success: 1, cost_usd: 10 }),
    ]);
    expect(result.verdict).toBe("inconclusive");
  });

  it("not_evaluatable: no trial measured the primary metric on both arms", () => {
    expect(compute([]).verdict).toBe("not_evaluatable");
    const missingMetric = compute([pair(1, { merge_success: 1 }, { merge_success: 1 })]);
    expect(missingMetric.verdict).toBe("not_evaluatable");
    expect(missingMetric.primary_metric.control).toBeNull();
  });

  it("fail closed: an unmeasured guardrail fails and regresses the verdict", () => {
    const result = compute([
      // Primary metric wins but nothing measured merge_success or cost_usd.
      pair(1, { review_cycles: 4 }, { review_cycles: 1 }),
    ]);
    expect(result.guardrails).toEqual([
      { metric: "merge_success", pass: false, detail: "not measured in any trial pair" },
      { metric: "cost_usd", pass: false, detail: "not measured in any trial pair" },
    ]);
    expect(result.verdict).toBe("regressed");
  });

  it("eval ids are deterministic over (experiment, trials)", () => {
    const trials = [pair(1, { review_cycles: 2 }, { review_cycles: 1 })];
    expect(compute(trials).eval_id).toBe(compute(trials).eval_id);
    expect(compute(trials).eval_id).toMatch(/^eval_[0-9a-f]{12}$/);
    expect(compute([pair(1, { review_cycles: 3 }, { review_cycles: 1 })]).eval_id).not.toBe(
      compute(trials).eval_id,
    );
  });

  it("eval ids see content, not key insertion order (canonicalized hash)", () => {
    // Two structurally identical trial sets built in different key order must
    // dedup to ONE decision, or a re-run would refuse as a rival verdict.
    const ordered = [pair(1, { a: 1, review_cycles: 2 }, { a: 1, review_cycles: 1 })];
    const reversed = [
      { pair: 1, control: { review_cycles: 2, a: 1 }, treatment: { review_cycles: 1, a: 1 } },
    ];
    expect(compute(ordered).eval_id).toBe(compute(reversed).eval_id);
  });
});

describe("decideExperiment", () => {
  it("persists the result, flips the experiment to decided, and is idempotent", async () => {
    const orgHome = tempDir("operon-eval-org-");
    await declareExperiment(makeExperiment(), { orgHome });
    const result = compute([
      pair(1, { review_cycles: 3, merge_success: 1, cost_usd: 11 }, { review_cycles: 1, merge_success: 1, cost_usd: 11 }),
    ]);

    const decided = await decideExperiment(orgHome, result);
    expect(decided.experiment.status).toBe("decided");
    expect(decided.experiment.result).toBe(result.eval_id);
    expect(await readEvalResult(orgHome, result.eval_id)).toEqual(result);
    expect(await listEvalResults(orgHome)).toEqual([result]);

    // Same result again: no-op. The experiment file survives validation
    // (decided + result present).
    await decideExperiment(orgHome, result);
    expect((await readExperimentRecord(orgHome, EXPERIMENT.experiment_id)).status).toBe("decided");
  });

  it("refuses a second, different verdict for an already-decided experiment", async () => {
    const orgHome = tempDir("operon-eval-org-");
    await declareExperiment(makeExperiment(), { orgHome });
    await decideExperiment(
      orgHome,
      compute([pair(1, { review_cycles: 3, merge_success: 1, cost_usd: 11 }, { review_cycles: 1, merge_success: 1, cost_usd: 11 })]),
    );
    await expect(
      decideExperiment(
        orgHome,
        compute([pair(1, { review_cycles: 3, merge_success: 1, cost_usd: 11 }, { review_cycles: 3, merge_success: 1, cost_usd: 11 })]),
      ),
    ).rejects.toThrow(/already decided/);
  });

  it("refuses a result for an experiment that was never declared", async () => {
    const orgHome = tempDir("operon-eval-org-");
    await expect(decideExperiment(orgHome, compute([]))).rejects.toThrow(/no experiment/);
  });

  it("an orphaned result file (crash between the two writes) blocks a rival verdict", async () => {
    const orgHome = tempDir("operon-eval-org-");
    await declareExperiment(makeExperiment(), { orgHome });
    const first = compute([
      pair(1, { review_cycles: 3, merge_success: 1, cost_usd: 11 }, { review_cycles: 1, merge_success: 1, cost_usd: 11 }),
    ]);
    // Simulate the crash window: the result file landed, the experiment flip
    // did not — the experiment still reads "declared".
    const { writeFileAtomic } = await import("../../src/org/learning/../atomic.js");
    const { evalResultPath } = await import("../../src/org/learning/eval-result.js");
    await writeFileAtomic(
      evalResultPath(orgHome, first.eval_id),
      JSON.stringify(first, null, 2) + "\n",
    );

    const rival = compute([
      pair(1, { review_cycles: 3, merge_success: 1, cost_usd: 11 }, { review_cycles: 3, merge_success: 1, cost_usd: 11 }),
    ]);
    await expect(decideExperiment(orgHome, rival)).rejects.toThrow(/one experiment, one verdict/);
    // Resuming with the SAME result completes the interrupted decide.
    const resumed = await decideExperiment(orgHome, first);
    expect(resumed.experiment.status).toBe("decided");
    expect(resumed.experiment.result).toBe(first.eval_id);
  });
});

describe("validateEvalResult", () => {
  it("round-trips a computed result", () => {
    const result = compute([pair(1, { review_cycles: 2, merge_success: 1, cost_usd: 10 }, { review_cycles: 1, merge_success: 1, cost_usd: 10 })]);
    expect(validateEvalResult(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });

  it("rejects a verdict outside the four classes", () => {
    const result = JSON.parse(
      JSON.stringify(compute([pair(1, { review_cycles: 2 }, { review_cycles: 1 })])),
    ) as Record<string, unknown>;
    result["verdict"] = "sort_of_better";
    expect(() => validateEvalResult(result)).toThrow(
      /verdict must be one of improved \| regressed \| inconclusive \| not_evaluatable/,
    );
  });
});
