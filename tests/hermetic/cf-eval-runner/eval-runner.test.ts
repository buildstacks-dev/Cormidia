// HB-060 — L4 runner self-tests: per-tuple aggregation, rotating shards,
// output-token ceiling preservation, and inconclusive-only threshold semantics.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readValidationCampaignReports } from "../../../src/org/validation-campaign.js";
import { compositeGradeKey, digestJson } from "../../../src/org/release-evidence.js";
import { DurableCampaignRunner } from "../../campaign/campaign-runner.js";
import {
  runEvalCampaign,
  selectRotatingShard,
  validateCases,
  validateEffectiveTokenReservations,
  type EvalCaseTokenReservation,
  type EvalCaseV1,
  type EvalTuple,
} from "../../eval-runner/eval-runner.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

let state: TempStateHome | undefined;
afterEach(async () => state?.cleanup());

const cases: EvalCaseV1[] = [
  golden("REV-SEC-001", "REJECT"),
  golden("REV-CLEAN-001", "APPROVE"),
  golden("REV-CORR-001", "REJECT"),
];
const tuples: EvalTuple[] = [
  {
    id: "builder-a__reviewer-a",
    site: "reviewer",
    operation: "review",
    arm: "bootstrap",
    producerTuple: "fixture",
    evaluatorTuple: "reviewer/claude/m-a/medium",
    rubricVersion: "reviewer-v1",
    attemptId: "attempt-1",
    promptInputDigest: "a".repeat(64),
    rubricDigest: "b".repeat(64),
    graderDigest: "c".repeat(64),
    runtime: "claude",
    model: "m-a",
    effort: "medium",
    maxCaseCostUsd: 1,
  },
  {
    id: "builder-a__reviewer-b",
    site: "reviewer",
    operation: "review",
    arm: "bootstrap",
    producerTuple: "fixture",
    evaluatorTuple: "reviewer/codex/m-b/medium",
    rubricVersion: "reviewer-v1",
    attemptId: "attempt-1",
    promptInputDigest: "a".repeat(64),
    rubricDigest: "b".repeat(64),
    graderDigest: "d".repeat(64),
    runtime: "codex",
    model: "m-b",
    effort: "medium",
    maxCaseCostUsd: 1,
  },
];
const PRODUCER_DIGEST = "e".repeat(64);

function golden(id: string, verdict: "APPROVE" | "REJECT"): EvalCaseV1 {
  return {
    schema_version: 1,
    id,
    site: "reviewer",
    sub_site: "S-3a",
    case_class: "seeded",
    prompt: `Review ${id}`,
    expected: { verdict, rubric_anchors: ["ground truth"] },
    token_reservation: 100,
    provenance: {
      author: "build-agent",
      authored_at: "2026-07-31",
      source_refs: ["contract:test"],
      human_validation: "pending",
    },
  };
}

function reservationsFor(selected: EvalCaseV1[], overrides: Record<string, number> = {}): EvalCaseTokenReservation[] {
  return selected.map((evalCase) => ({
    case_id: evalCase.id,
    max_output_tokens: overrides[evalCase.id] ?? evalCase.token_reservation,
  }));
}

async function campaign(required: string[], maxTurns = required.length + 1) {
  state = await makeTempStateHome({ name: "eval-runner" });
  const policy = state.path("policy.yaml");
  await writeFile(policy, "schema_version: 1\n", "utf8");
  const runner = new DurableCampaignRunner({
    stateHome: state.stateHome,
    campaignId: "eval-test",
    lane: "L4",
    campaignKind: "reviewer-eval",
    trigger: "test",
    policyPath: policy,
    commit: "a".repeat(40),
    apps: ["sandbox-alpha"],
    scopes: ["S-3"],
    tuples: tuples.map((tuple) => tuple.id),
    requiredCaseIds: required,
    maxProviderTurns: maxTurns,
    maxEquivUsd: 100,
    decisionStatus: "proposed",
    clock: () => new Date("2026-07-31T18:00:00.000Z"),
  });
  await runner.start();
  return runner;
}

describe("eval runner", () => {
  it("CF-REG-300 binds every effective reservation above its golden baseline to the exact campaign sum", async () => {
    const corpusPaths = [
      join(process.cwd(), "validation-design", "golden-sets", "reviewer", "cases.json"),
      join(process.cwd(), "validation-design", "golden-sets", "planner", "cases.json"),
      join(process.cwd(), "validation-design", "golden-sets", "validation-designer", "cases.json"),
    ];
    const corpus = (
      await Promise.all(corpusPaths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as EvalCaseV1[]))
    ).flat();
    const effective = reservationsFor(corpus, {
      "GS-PLAN-S1A-DAG-001": 5_700,
      "GS-PLAN-S1B-REPAIR-001": 6_600,
      "GS-PLAN-S1A-BATCH-LURE-001": 8_700,
      "GS-PLAN-S1B-DIRECT-PROMOTION-001": 12_100,
      "GS-VAL-S10-ROUTINE-001": 8_000,
      "GS-VAL-S10-CROSS-TICKET-001": 9_500,
      "GS-VAL-S10-STRUCTURAL-001": 4_700,
    });
    const releaseTuples: EvalTuple[] = [
      { ...tuples[0]!, id: "release-reviewer", site: "reviewer", operation: "review" },
      { ...tuples[0]!, id: "release-planner", site: "planner", operation: "plan" },
      { ...tuples[0]!, id: "release-validation", site: "validation-designer", operation: "validation-design" },
    ];

    expect(() => validateEffectiveTokenReservations(corpus, releaseTuples, effective.slice(1), 88_100)).toThrow(
      /missing/,
    );
    expect(() =>
      validateEffectiveTokenReservations(
        corpus,
        releaseTuples,
        [...effective, { case_id: "EXTRA", max_output_tokens: 1 }],
        88_100,
      ),
    ).toThrow(/extra/);
    expect(() =>
      validateEffectiveTokenReservations(corpus, releaseTuples, [...effective, effective[0]!], 88_100),
    ).toThrow(/duplicate/);
    expect(() =>
      validateEffectiveTokenReservations(
        corpus,
        releaseTuples,
        [{ ...effective[0]!, max_output_tokens: corpus[0]!.token_reservation - 1 }, ...effective.slice(1)],
        88_100,
      ),
    ).toThrow(/below golden baseline/);
    expect(() => validateEffectiveTokenReservations(corpus, releaseTuples, effective, 88_101)).toThrow(
      /exact effective-reservation sum/,
    );
    expect(validateEffectiveTokenReservations(corpus, releaseTuples, effective, 88_100)).toEqual(
      new Map(effective.map((item) => [item.case_id, item.max_output_tokens])),
    );

    const selected = [cases[0]!];
    const runner = await campaign([`${tuples[0]!.id}::${selected[0]!.id}`], 2);
    const execute = vi.fn(async () => ({
      output: "VERDICT: REJECT\n",
      tokensIn: 100,
      tokensOut: 150,
      equivUsd: 0.2,
      sessionId: "effective-reservation-success",
    }));
    const result = await runEvalCampaign({
      campaign: runner,
      campaignId: "eval-test",
      stateHome: state!.stateHome,
      cases: selected,
      tuples: [tuples[0]!],
      producerDigest: PRODUCER_DIGEST,
      caseTokenReservations: reservationsFor(selected, { [selected[0]!.id]: 200 }),
      maxTokens: 200,
      executor: { execute },
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 200 }));
    expect(result.case_token_reservations).toEqual([{ case_id: selected[0]!.id, max_output_tokens: 200 }]);
    expect(result.attempts).toEqual([
      expect.objectContaining({
        case_id: selected[0]!.id,
        status: "collected",
        token_reservation: 200,
        tokens_out: 150,
      }),
    ]);
  });

  it("aggregates exact tuples separately and stays inconclusive under proposed thresholds", async () => {
    const required = tuples.flatMap((tuple) => cases.map((item) => `${tuple.id}::${item.id}`));
    const runner = await campaign(required);
    const results = await runEvalCampaign({
      campaign: runner,
      campaignId: "eval-test",
      stateHome: state!.stateHome,
      cases,
      tuples,
      producerDigest: PRODUCER_DIGEST,
      caseTokenReservations: reservationsFor(cases),
      maxTokens: 600,
      executor: {
        execute: async ({ tuple, evalCase }) => ({
          output: tuple.id.endsWith("a") ? `VERDICT: ${evalCase.expected.verdict}\n` : "VERDICT: APPROVE\n",
          tokensIn: 10,
          tokensOut: 5,
          equivUsd: 0.1,
          sessionId: `${tuple.id}-${evalCase.id}`,
        }),
      },
    });
    expect(results.per_tuple).toEqual([
      expect.objectContaining({ tuple_id: "builder-a__reviewer-a", observations: 3, reference_matches: 3 }),
      expect.objectContaining({ tuple_id: "builder-a__reviewer-b", observations: 3, reference_mismatches: 2 }),
    ]);
    expect(results.producer_digest).toBe(PRODUCER_DIGEST);
    expect(results.token_unit).toBe("output_tokens");
    expect(results.per_tuple).toEqual([
      expect.objectContaining({ tuple_id: "builder-a__reviewer-a", tokens: 15 }),
      expect.objectContaining({ tuple_id: "builder-a__reviewer-b", tokens: 15 }),
    ]);
    const first = results.observations[0]!;
    expect(first.grading_key).toBe(
      compositeGradeKey({
        output_sha256: first.output_sha256,
        case_digest: digestJson(cases[0]!),
        context_digest: digestJson({
          case_digest: digestJson(cases[0]!),
          prompt_input_digest: tuples[0]!.promptInputDigest,
        }),
        rubric_digest: tuples[0]!.rubricDigest,
        reference_digest: digestJson(cases[0]!.expected),
        grader_digest: tuples[0]!.graderDigest,
      }),
    );
    expect((await runner.finish()).outcome).toMatchObject({
      completeness: "complete",
      verdict: "inconclusive",
      decision_status: "proposed",
    });
  });

  it("negative control: stops before a token reservation that cannot fit and preserves incomplete evidence", async () => {
    const selected = [cases[0]!, cases[1]!];
    const required = selected.map((item) => `${tuples[0]!.id}::${item.id}`);
    const runner = await campaign(required);
    const execute = vi.fn(async ({ evalCase }: { evalCase: EvalCaseV1 }) => ({
      output: `VERDICT: ${evalCase.expected.verdict}\n`,
      tokensIn: 60,
      tokensOut: evalCase.id === selected[0]!.id ? 110 : 20,
      equivUsd: 0.1,
      sessionId: evalCase.id,
    }));
    const result = await runEvalCampaign({
      campaign: runner,
      campaignId: "eval-test",
      stateHome: state!.stateHome,
      cases: selected,
      tuples: [tuples[0]!],
      producerDigest: PRODUCER_DIGEST,
      caseTokenReservations: reservationsFor(selected),
      maxTokens: 200,
      executor: { execute },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.stopped_on_token_ceiling).toBe(true);
    await runner.finish();
    expect((await readValidationCampaignReports(state!.stateHome)).reports[0]?.outcome).toMatchObject({
      completeness: "incomplete",
      verdict: "inconclusive",
    });
  });

  it("negative control: high input usage does not consume the ratified output-token envelope", async () => {
    const selected = [{ ...cases[0]!, token_reservation: 1_200 }, cases[1]!];
    const required = selected.map((item) => `${tuples[0]!.id}::${item.id}`);
    const runner = await campaign(required, 3);
    const execute = vi.fn(async ({ evalCase }: { evalCase: EvalCaseV1 }) =>
      evalCase.id === selected[0]!.id
        ? {
            output: "VERDICT: REJECT\n",
            tokensIn: 21_650,
            tokensOut: 260,
            equivUsd: 0.2,
            sessionId: "high-input-small-output",
          }
        : {
            output: "VERDICT: APPROVE\n",
            tokensIn: 60,
            tokensOut: 20,
            equivUsd: 0.1,
            sessionId: "independent-success",
          },
    );
    const result = await runEvalCampaign({
      campaign: runner,
      campaignId: "eval-test",
      stateHome: state!.stateHome,
      cases: selected,
      tuples: [tuples[0]!],
      producerDigest: PRODUCER_DIGEST,
      caseTokenReservations: reservationsFor(selected),
      maxTokens: 1_300,
      executor: { execute },
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      token_unit: "output_tokens",
      observed_tokens: 280,
      stopped_on_token_ceiling: false,
    });
    expect(result.attempts).toEqual([
      expect.objectContaining({
        case_id: selected[0]!.id,
        status: "collected",
        token_reservation: 1_200,
        tokens_in: 21_650,
        tokens_out: 260,
      }),
      expect.objectContaining({
        case_id: selected[1]!.id,
        status: "collected",
        tokens_in: 60,
        tokens_out: 20,
      }),
    ]);
    expect((await runner.finish()).outcome).toMatchObject({
      completeness: "complete",
      verdict: "inconclusive",
    });
  });

  it("negative control: an execution error conservatively debits unknown token and cost reservations", async () => {
    const selected = [cases[0]!];
    const required = [`${tuples[0]!.id}::${selected[0]!.id}`];
    const runner = await campaign(required, 1);
    await expect(
      runEvalCampaign({
        campaign: runner,
        campaignId: "eval-test",
        stateHome: state!.stateHome,
        cases: selected,
        tuples: [tuples[0]!],
        producerDigest: "caller-invented",
        caseTokenReservations: reservationsFor(selected),
        maxTokens: 100,
        executor: {
          execute: async () => {
            throw new Error("must not execute");
          },
        },
      }),
    ).rejects.toThrow(/producerDigest must be lowercase sha256/);
    const result = await runEvalCampaign({
      campaign: runner,
      campaignId: "eval-test",
      stateHome: state!.stateHome,
      cases: selected,
      tuples: [tuples[0]!],
      producerDigest: PRODUCER_DIGEST,
      caseTokenReservations: reservationsFor(selected),
      maxTokens: 100,
      executor: {
        execute: async () => {
          throw new Error("provider response lost");
        },
      },
    });
    expect(result.attempts).toEqual([
      expect.objectContaining({
        case_id: selected[0]!.id,
        status: "execution_error",
        token_reservation: 100,
        session_id: null,
        tokens_in: null,
        tokens_out: null,
        equiv_usd: null,
        output_sha256: null,
        error_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    const results = JSON.parse(
      await readFile(state!.path("validation", "campaigns", "eval-test", "eval-results.json"), "utf8"),
    ) as { observed_tokens: number; stopped_on_token_ceiling: boolean };
    expect(results).toMatchObject({ observed_tokens: 100, stopped_on_token_ceiling: true });
    const report = await runner.finish();
    expect(report.spend).toMatchObject({
      observed_provider_turns: 1,
      observed_equiv_usd: 1,
      ceiling_exhausted: true,
    });
    expect(report.outcome.reason_codes).toContain("eval_token_ceiling_observed_exhausted");
  });

  it("negative control: preserves a known over-reservation result and continues to an independent case", async () => {
    const selected = [cases[0]!, cases[1]!, cases[2]!];
    const required = selected.map((item) => `${tuples[0]!.id}::${item.id}`);
    const runner = await campaign(required);
    const execute = vi.fn(async ({ evalCase }: { evalCase: EvalCaseV1 }) =>
      evalCase.id === selected[0]!.id
        ? {
            output: "VERDICT: REJECT\n",
            tokensIn: 110,
            tokensOut: 110,
            equivUsd: 0.2,
            sessionId: "known-overrun",
          }
        : {
            output: "VERDICT: APPROVE\n",
            tokensIn: 60,
            tokensOut: 20,
            equivUsd: 0.1,
            sessionId: "independent-success",
          },
    );
    const result = await runEvalCampaign({
      campaign: runner,
      campaignId: "eval-test",
      stateHome: state!.stateHome,
      cases: selected,
      tuples: [tuples[0]!],
      producerDigest: PRODUCER_DIGEST,
      caseTokenReservations: reservationsFor(selected),
      maxTokens: 300,
      executor: { execute },
    });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(result.observed_tokens).toBe(150);
    expect(result.attempts).toEqual([
      expect.objectContaining({
        case_id: selected[0]!.id,
        status: "token_reservation_exceeded",
        session_id: "known-overrun",
        tokens_in: 110,
        tokens_out: 110,
        equiv_usd: 0.2,
        output_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        error_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expect.objectContaining({
        case_id: selected[1]!.id,
        status: "collected",
        session_id: "independent-success",
        tokens_in: 60,
        tokens_out: 20,
        equiv_usd: 0.1,
        error_sha256: null,
      }),
      expect.objectContaining({
        case_id: selected[2]!.id,
        status: "collected",
        session_id: "independent-success",
        tokens_in: 60,
        tokens_out: 20,
        equiv_usd: 0.1,
        error_sha256: null,
      }),
    ]);
    expect(result.observations.map((item) => item.case_id)).toEqual([selected[1]!.id, selected[2]!.id]);
    expect(await runner.finish()).toMatchObject({
      coverage: {
        collected_case_ids: [`${tuples[0]!.id}::${selected[1]!.id}`, `${tuples[0]!.id}::${selected[2]!.id}`],
        missing_case_ids: [`${tuples[0]!.id}::${selected[0]!.id}`],
      },
      outcome: {
        completeness: "incomplete",
        verdict: "inconclusive",
        reason_codes: expect.arrayContaining([`case_execution_error:${tuples[0]!.id}::${selected[0]!.id}`]),
      },
    });
  });

  it("rotating shards are deterministic, non-empty, and cover every case across a bounded cycle", () => {
    const selections = Array.from({ length: 3 }, (_, offset) =>
      selectRotatingShard(cases, `2026-08-0${offset + 1}`, 3).map((item) => item.id),
    );
    expect(selections.every((selection) => selection.length > 0)).toBe(true);
    expect(new Set(selections.flat())).toEqual(new Set(cases.map((item) => item.id)));
  });

  it("negative control: malformed golden provenance and provider usage are rejected", async () => {
    expect(() => validateCases([{ ...cases[0]!, provenance: { ...cases[0]!.provenance, source_refs: [] } }])).toThrow(
      /source refs/,
    );
    const selected = [cases[0]!];
    const required = [`${tuples[0]!.id}::${selected[0]!.id}`];
    const runner = await campaign(required, 1);
    const result = await runEvalCampaign({
      campaign: runner,
      campaignId: "eval-test",
      stateHome: state!.stateHome,
      cases: selected,
      tuples: [tuples[0]!],
      producerDigest: PRODUCER_DIGEST,
      caseTokenReservations: reservationsFor(selected),
      maxTokens: 100,
      executor: {
        execute: async () => ({
          output: "VERDICT: REJECT\n",
          tokensIn: -1,
          tokensOut: 2,
          equivUsd: 0.1,
          sessionId: "invalid-usage",
        }),
      },
    });
    expect(result.observations).toEqual([]);
    expect(result.attempts).toEqual([
      expect.objectContaining({
        status: "invalid_result",
        session_id: "invalid-usage",
        tokens_in: null,
        tokens_out: 2,
        error_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect((await runner.finish()).outcome).toMatchObject({
      completeness: "incomplete",
      verdict: "inconclusive",
    });
  });

  it("negative control: refuses a tuple or selected site with zero execution coverage", async () => {
    const plannerTuple: EvalTuple = { ...tuples[0]!, site: "planner", operation: "plan" };
    const runner = await campaign([`${plannerTuple.id}::${cases[0]!.id}`], 1);
    await expect(
      runEvalCampaign({
        campaign: runner,
        campaignId: "eval-test",
        stateHome: state!.stateHome,
        cases: [cases[0]!],
        tuples: [plannerTuple],
        producerDigest: PRODUCER_DIGEST,
        caseTokenReservations: reservationsFor([cases[0]!]),
        maxTokens: 100,
        executor: {
          execute: async () => {
            throw new Error("must not execute");
          },
        },
      }),
    ).rejects.toThrow(/tuple site planner has no selected cases|selected reviewer cases but no exact tuple/);
  });

  it("integrates the human-validated Planner and Validation Designer corpora as unscored data collection", async () => {
    const corpusPaths = [
      join(process.cwd(), "validation-design", "golden-sets", "planner", "cases.json"),
      join(process.cwd(), "validation-design", "golden-sets", "validation-designer", "cases.json"),
    ];
    const corpora = (
      await Promise.all(corpusPaths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as EvalCaseV1[]))
    ).flat();
    validateCases(corpora);
    expect(new Set(corpora.map((item) => item.site))).toEqual(new Set(["planner", "validation-designer"]));
    expect(
      corpora.every(
        (item) => item.provenance.human_validation === "validated" && item.provenance.validated_by === "bikramgupta",
      ),
    ).toBe(true);

    const selected = [
      corpora.find((item) => item.id === "GS-PLAN-S1A-ROADMAP-100-001")!,
      corpora.find((item) => item.id === "GS-VAL-S10-CROSS-TICKET-001")!,
    ];
    const siteTuples: EvalTuple[] = [
      {
        ...tuples[0]!,
        site: "planner",
        operation: "plan",
        producerTuple: "planner/claude/m-a/medium",
        evaluatorTuple: "human:bikramgupta",
        rubricVersion: "planner-v1",
      },
      {
        ...tuples[1]!,
        site: "validation-designer",
        operation: "validation-design",
        producerTuple: "validation-designer/codex/m-b/medium",
        evaluatorTuple: "human:bikramgupta",
        rubricVersion: "validation-designer-v1",
      },
    ];
    const required = siteTuples.map((tuple) => `${tuple.id}::${selected.find((item) => item.site === tuple.site)!.id}`);
    const runner = await campaign(required, required.length + 1);
    const results = await runEvalCampaign({
      campaign: runner,
      campaignId: "eval-test",
      stateHome: state!.stateHome,
      cases: selected,
      tuples: siteTuples,
      producerDigest: PRODUCER_DIGEST,
      caseTokenReservations: reservationsFor(selected),
      maxTokens: 14_600,
      executor: {
        execute: async ({ evalCase }) => ({
          output: `Fixture response for ${evalCase.id}`,
          tokensIn: 20,
          tokensOut: 10,
          equivUsd: 0.1,
          sessionId: `pending-${evalCase.id}`,
        }),
      },
    });
    expect(results.observations).toHaveLength(2);
    expect(
      results.observations.every(
        (item) =>
          item.observed_verdict === "not_applicable" &&
          item.matches_reference === null &&
          item.human_reference_status === "validated",
      ),
    ).toBe(true);
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
