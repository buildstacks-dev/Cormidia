// HB-060 — L4 runner self-tests: per-tuple aggregation, rotating shards,
// token ceiling preservation, and inconclusive-only threshold semantics.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readValidationCampaignReports } from "../../../src/org/validation-campaign.js";
import { compositeGradeKey, digestJson } from "../../../src/org/release-evidence.js";
import { DurableCampaignRunner } from "../../campaign/campaign-runner.js";
import { runEvalCampaign, selectRotatingShard, validateCases, type EvalCaseV1, type EvalTuple } from "../../eval-runner/eval-runner.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

let state: TempStateHome | undefined;
afterEach(async () => state?.cleanup());

const cases: EvalCaseV1[] = [
  golden("REV-SEC-001", "REJECT"),
  golden("REV-CLEAN-001", "APPROVE"),
  golden("REV-CORR-001", "REJECT"),
];
const tuples: EvalTuple[] = [
  { id: "builder-a__reviewer-a", site: "reviewer", operation: "review", arm: "bootstrap", producerTuple: "fixture", evaluatorTuple: "reviewer/claude/m-a/medium", rubricVersion: "reviewer-v1", attemptId: "attempt-1", promptInputDigest: "a".repeat(64), rubricDigest: "b".repeat(64), graderDigest: "c".repeat(64), runtime: "claude", model: "m-a", effort: "medium", maxCaseCostUsd: 1 },
  { id: "builder-a__reviewer-b", site: "reviewer", operation: "review", arm: "bootstrap", producerTuple: "fixture", evaluatorTuple: "reviewer/codex/m-b/medium", rubricVersion: "reviewer-v1", attemptId: "attempt-1", promptInputDigest: "a".repeat(64), rubricDigest: "b".repeat(64), graderDigest: "d".repeat(64), runtime: "codex", model: "m-b", effort: "medium", maxCaseCostUsd: 1 },
];

function golden(id: string, verdict: "APPROVE" | "REJECT"): EvalCaseV1 {
  return {
    schema_version: 1, id, site: "reviewer", sub_site: "S-3a", case_class: "seeded",
    prompt: `Review ${id}`, expected: { verdict, rubric_anchors: ["ground truth"] }, token_reservation: 100,
    provenance: { author: "build-agent", authored_at: "2026-07-31", source_refs: ["contract:test"], human_validation: "pending" },
  };
}

async function campaign(required: string[], maxTurns = required.length + 1) {
  state = await makeTempStateHome({ name: "eval-runner" });
  const policy = state.path("policy.yaml");
  await writeFile(policy, "schema_version: 1\n", "utf8");
  const runner = new DurableCampaignRunner({
    stateHome: state.stateHome, campaignId: "eval-test", lane: "L4", campaignKind: "reviewer-eval",
    trigger: "test", policyPath: policy, commit: "a".repeat(40), apps: ["sandbox-alpha"], scopes: ["S-3"],
    tuples: tuples.map((tuple) => tuple.id), requiredCaseIds: required,
    maxProviderTurns: maxTurns, maxEquivUsd: 100, decisionStatus: "proposed",
    clock: () => new Date("2026-07-31T18:00:00.000Z"),
  });
  await runner.start();
  return runner;
}

describe("eval runner", () => {
  it("aggregates exact tuples separately and stays inconclusive under proposed thresholds", async () => {
    const required = tuples.flatMap((tuple) => cases.map((item) => `${tuple.id}::${item.id}`));
    const runner = await campaign(required);
    const results = await runEvalCampaign({
      campaign: runner, campaignId: "eval-test", stateHome: state!.stateHome, cases, tuples, maxTokens: 1_000,
      executor: { execute: async ({ tuple, evalCase }) => ({
        output: tuple.id.endsWith("a") ? `VERDICT: ${evalCase.expected.verdict}\n` : "VERDICT: APPROVE\n",
        tokensIn: 10, tokensOut: 5, equivUsd: 0.1, sessionId: `${tuple.id}-${evalCase.id}`,
      }) },
    });
    expect(results.per_tuple).toEqual([
      expect.objectContaining({ tuple_id: "builder-a__reviewer-a", observations: 3, reference_matches: 3 }),
      expect.objectContaining({ tuple_id: "builder-a__reviewer-b", observations: 3, reference_mismatches: 2 }),
    ]);
    const first = results.observations[0]!;
    expect(first.grading_key).toBe(compositeGradeKey({
      output_sha256: first.output_sha256,
      case_digest: digestJson(cases[0]!),
      context_digest: digestJson({ case_digest: digestJson(cases[0]!), prompt_input_digest: tuples[0]!.promptInputDigest }),
      rubric_digest: tuples[0]!.rubricDigest,
      reference_digest: digestJson(cases[0]!.expected),
      grader_digest: tuples[0]!.graderDigest,
    }));
    expect((await runner.finish()).outcome).toMatchObject({ completeness: "complete", verdict: "inconclusive", decision_status: "proposed" });
  });

  it("negative control: stops before a token reservation that cannot fit and preserves incomplete evidence", async () => {
    const selected = [cases[0]!, cases[1]!];
    const required = selected.map((item) => `${tuples[0]!.id}::${item.id}`);
    const runner = await campaign(required);
    const execute = vi.fn(async ({ evalCase }: { evalCase: EvalCaseV1 }) => ({
      output: `VERDICT: ${evalCase.expected.verdict}\n`, tokensIn: 60, tokensOut: 20, equivUsd: 0.1, sessionId: evalCase.id,
    }));
    const result = await runEvalCampaign({
      campaign: runner, campaignId: "eval-test", stateHome: state!.stateHome,
      cases: selected, tuples: [tuples[0]!], maxTokens: 150, executor: { execute },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.stopped_on_token_ceiling).toBe(true);
    await runner.finish();
    expect((await readValidationCampaignReports(state!.stateHome)).reports[0]?.outcome).toMatchObject({
      completeness: "incomplete", verdict: "inconclusive",
    });
  });

  it("negative control: an execution error conservatively debits unknown token and cost reservations", async () => {
    const selected = [cases[0]!];
    const required = [`${tuples[0]!.id}::${selected[0]!.id}`];
    const runner = await campaign(required, 1);
    await expect(runEvalCampaign({
      campaign: runner, campaignId: "eval-test", stateHome: state!.stateHome,
      cases: selected, tuples: [tuples[0]!], maxTokens: 100,
      executor: { execute: async () => { throw new Error("provider response lost"); } },
    })).rejects.toThrow(/provider response lost/);
    const results = JSON.parse(await readFile(
      state!.path("validation", "campaigns", "eval-test", "eval-results.json"), "utf8",
    )) as { observed_tokens: number; stopped_on_token_ceiling: boolean };
    expect(results).toMatchObject({ observed_tokens: 100, stopped_on_token_ceiling: true });
    expect((await runner.finish()).spend).toMatchObject({
      observed_provider_turns: 1,
      observed_equiv_usd: 1,
      ceiling_exhausted: true,
    });
  });

  it("rotating shards are deterministic, non-empty, and cover every case across a bounded cycle", () => {
    const selections = Array.from({ length: 3 }, (_, offset) =>
      selectRotatingShard(cases, `2026-08-0${offset + 1}`, 3).map((item) => item.id));
    expect(selections.every((selection) => selection.length > 0)).toBe(true);
    expect(new Set(selections.flat())).toEqual(new Set(cases.map((item) => item.id)));
  });

  it("negative control: malformed golden provenance and provider usage are rejected", async () => {
    expect(() => validateCases([{ ...cases[0]!, provenance: { ...cases[0]!.provenance, source_refs: [] } }])).toThrow(/source refs/);
    const selected = [cases[0]!];
    const required = [`${tuples[0]!.id}::${selected[0]!.id}`];
    const runner = await campaign(required, 1);
    await expect(runEvalCampaign({
      campaign: runner, campaignId: "eval-test", stateHome: state!.stateHome,
      cases: selected, tuples: [tuples[0]!], maxTokens: 100,
      executor: { execute: async () => ({
        output: "VERDICT: REJECT\n", tokensIn: -1, tokensOut: 2,
        equivUsd: 0.1, sessionId: "invalid-usage",
      }) },
    })).rejects.toThrow(/invalid token usage/);
  });

  it("negative control: refuses a tuple or selected site with zero execution coverage", async () => {
    const plannerTuple: EvalTuple = { ...tuples[0]!, site: "planner", operation: "plan" };
    const runner = await campaign([`${plannerTuple.id}::${cases[0]!.id}`], 1);
    await expect(runEvalCampaign({
      campaign: runner, campaignId: "eval-test", stateHome: state!.stateHome,
      cases: [cases[0]!], tuples: [plannerTuple], maxTokens: 100,
      executor: { execute: async () => { throw new Error("must not execute"); } },
    })).rejects.toThrow(/tuple site planner has no selected cases|selected reviewer cases but no exact tuple/);
  });

  it("integrates the human-validated Planner and Validation Designer corpora as unscored data collection", async () => {
    const corpusPaths = [
      join(process.cwd(), "validation-design", "golden-sets", "planner", "cases.json"),
      join(process.cwd(), "validation-design", "golden-sets", "validation-designer", "cases.json"),
    ];
    const corpora = (await Promise.all(corpusPaths.map(async (path) =>
      JSON.parse(await readFile(path, "utf8")) as EvalCaseV1[]))).flat();
    validateCases(corpora);
    expect(new Set(corpora.map((item) => item.site))).toEqual(new Set(["planner", "validation-designer"]));
    expect(corpora.every((item) => item.provenance.human_validation === "validated" && item.provenance.validated_by === "bikramgupta")).toBe(true);

    const selected = [
      corpora.find((item) => item.id === "GS-PLAN-S1A-ROADMAP-100-001")!,
      corpora.find((item) => item.id === "GS-VAL-S10-CROSS-TICKET-001")!,
    ];
    const siteTuples: EvalTuple[] = [
      { ...tuples[0]!, site: "planner", operation: "plan", producerTuple: "planner/claude/m-a/medium", evaluatorTuple: "human:bikramgupta", rubricVersion: "planner-v1" },
      { ...tuples[1]!, site: "validation-designer", operation: "validation-design", producerTuple: "validation-designer/codex/m-b/medium", evaluatorTuple: "human:bikramgupta", rubricVersion: "validation-designer-v1" },
    ];
    const required = siteTuples.map((tuple) => `${tuple.id}::${selected.find((item) => item.site === tuple.site)!.id}`);
    const runner = await campaign(required, required.length + 1);
    const results = await runEvalCampaign({
      campaign: runner,
      campaignId: "eval-test",
      stateHome: state!.stateHome,
      cases: selected,
      tuples: siteTuples,
      maxTokens: 20_000,
      executor: { execute: async ({ evalCase }) => ({
        output: `Fixture response for ${evalCase.id}`,
        tokensIn: 20,
        tokensOut: 10,
        equivUsd: 0.1,
        sessionId: `pending-${evalCase.id}`,
      }) },
    });
    expect(results.observations).toHaveLength(2);
    expect(results.observations.every((item) =>
      item.observed_verdict === "not_applicable"
      && item.matches_reference === null
      && item.human_reference_status === "validated")).toBe(true);
    expect((await runner.finish()).outcome).toMatchObject({
      completeness: "complete",
      verdict: "inconclusive",
      decision_status: "proposed",
    });
  });

  it("negative control: a Validation Designer corpus row without its S-10 sub-site is rejected", async () => {
    const path = join(process.cwd(), "validation-design", "golden-sets", "validation-designer", "cases.json");
    const corpus = JSON.parse(await readFile(path, "utf8")) as EvalCaseV1[];
    expect(() => validateCases([{ ...corpus[0]!, sub_site: "" }])).toThrow(/invalid golden case/);
  });
});
