// Traceability: CF-J08-R · HB-020 · contracts/journey-acceptance.md J-08 refusal criterion.

// CF-J08-R — mechanical steps never settle as provider turns; a duplicate
// settle attempt no-ops (HB-020).
//
// Design: validation-design/invariants.md CORMIDIA-INV-006 ("Mechanical steps
// never settle as provider turns"); case-catalog §1 CF-J08-R; system-map J-08.
// The structural guard is twofold in product code:
//   1. mechanical execution records carry kind:"mechanical" and
//      provider_turn_id:null (src/loop/efficiency.ts recordMechanicalStep),
//      and reconcileLedger's settle loop filters kind === "provider"
//      (src/org/budget.ts) — a mechanical step can never become a ledger row;
//   2. a pass that invoked no provider carries usage quality "none", the
//      authoritative zero that aggregateCost counts as mechanical_passes,
//      never as a provider turn (src/runtime/cost.ts).
// The detector is the product's own settlementCoverage
// (mechanical_with_settlement + duplicate); negative controls seed both
// violations through the raw recordTurn bypass and prove it fires.

import { afterEach, describe, expect, it } from "vitest";
import { readExecutionSteps, recordMechanicalStep, settlementCoverage } from "../../../src/loop/efficiency.js";
import { reconcileLedger } from "../../../src/org/budget.js";
import { aggregateCost } from "../../../src/runtime/cost.js";
import {
  readSettledKeys,
  readTurnRecords,
  recordTurn,
  recordTurnOnce,
  settlementKey,
} from "../../../src/runtime/telemetry.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import {
  admitTestEpisode,
  detectDoubleSettlement,
  executorSettlement,
  makeTurnResult,
  makeUsage,
  plantProviderStep,
} from "./settlement-fixtures.js";

const T0 = new Date("2026-07-31T10:00:00.000Z");
const T1 = new Date("2026-07-31T10:05:00.000Z");
const APP = "mech-app";
const EPISODE = `ticket:${APP}:#400`;

describe("CF-J08-R — mechanical steps never settle as provider turns; duplicate settle no-ops (L1/L2)", () => {
  let state: TempStateHome;

  afterEach(async () => {
    await state.cleanup();
  });

  it("reconcile settles the provider step and only the provider step — the mechanical sibling yields no ledger row, and is not counted corrupt", async () => {
    state = await makeTempStateHome({ name: "cf-j08-r" });
    await admitTestEpisode({ stateHome: state.stateHome, episodeId: EPISODE, app: APP, now: T0 });
    // One mechanical step (provision/gate-style deterministic work) and one
    // provider step in the same episode, via the real writers.
    const mechanical = await recordMechanicalStep({
      root: state.stateHome,
      episodeId: EPISODE,
      app: APP,
      runId: "20260731-100000-build-provision",
      operation: "build/provision",
      startedAt: T0,
      finishedAt: T0,
      status: "completed",
      reason: "deterministic provision step",
      inputFingerprint: "fp-provision",
    });
    expect(mechanical.kind).toBe("mechanical");
    expect(mechanical.provider_turn_id).toBeNull();
    expect(mechanical.usage).toBeNull();

    const result = makeTurnResult("completed", makeUsage(0.6));
    const provider = await plantProviderStep({
      stateHome: state.stateHome,
      episodeId: EPISODE,
      app: APP,
      runId: "20260731-100100-build-implement",
      result,
      startedAt: T0,
      finishedAt: T1,
    });

    const reconciled = await reconcileLedger(state.stateHome, {}, T1);
    expect(reconciled.settled).toBe(1); // the provider turn, nothing else
    expect(reconciled.corrupt).toBe(0); // a mechanical step is not corruption

    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.providerTurnId).toBe(provider.providerTurnId);
    // No row claims the mechanical step's identity on any key axis.
    expect(rows.some((row) => row.executionStepId === mechanical.execution_step_id)).toBe(false);
    const settled = await readSettledKeys(state.stateHome);
    expect(settled.has(settlementKey(APP, mechanical.run_id))).toBe(false);

    const steps = await readExecutionSteps(state.stateHome, EPISODE);
    const coverage = settlementCoverage(steps, rows);
    expect(coverage.denominator).toBe(1); // mechanical excluded from both sides
    expect(coverage.numerator).toBe(1);
    expect(coverage.mechanical_with_settlement).toEqual([]);
  });

  it("a mechanical pass contributes an authoritative zero (quality none) to aggregates — a mechanical pass is never a provider turn", async () => {
    state = await makeTempStateHome({ name: "cf-j08-r-agg" });
    // The cross-surface aggregation rule: mechanical work enters cost
    // projection with quality "none" (src/runtime/cost.ts header rule 3) and
    // must neither count as a provider turn nor drag quality down.
    const aggregate = aggregateCost([
      { costUsd: 0, quality: "none", ref: "pass:mech-app:provision" },
      { costUsd: 0.6, quality: "complete", ref: "ptid-real" },
    ]);
    expect(aggregate.mechanical_passes).toBe(1);
    expect(aggregate.provider_turns).toBe(1);
    expect(aggregate.known_cost_usd).toBe(0.6);
    expect(aggregate.coverage).toBe("complete");
    expect(aggregate.usage_quality).toBe("complete");
  });

  it("duplicate settle attempts no-op at every entry: direct recordTurnOnce retry and a reconcile over an already-settled turn both leave one row", async () => {
    state = await makeTempStateHome({ name: "cf-j08-r-dup" });
    await admitTestEpisode({ stateHome: state.stateHome, episodeId: EPISODE, app: APP, now: T0 });
    const result = makeTurnResult("completed", makeUsage(0.45));
    const provider = await plantProviderStep({
      stateHome: state.stateHome,
      episodeId: EPISODE,
      app: APP,
      runId: "20260731-101000-build-implement",
      result,
      startedAt: T0,
      finishedAt: T1,
    });
    const settlement = executorSettlement({
      result,
      at: T1,
      app: APP,
      runId: provider.runId,
      providerTurnId: provider.providerTurnId,
      executionStepId: provider.executionStepId,
      episodeId: EPISODE,
    });
    expect(await recordTurnOnce(state.stateHome, settlement)).toBe(true);
    // Entry 1: the executor retry (even with drifted figures) refuses.
    expect(await recordTurnOnce(state.stateHome, { ...settlement, costUsd: 99.99 })).toBe(false);
    // Entry 2: reconcile sees the settled key and deposits nothing.
    const reconciled = await reconcileLedger(state.stateHome, {}, T1);
    expect(reconciled.settled).toBe(0);
    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.costUsd).toBe(0.45); // first settle's figures are durable truth
    detectDoubleSettlement(rows);
  });

  it("negative control: a forged ledger row claiming a mechanical step makes settlementCoverage FIRE (mechanical_with_settlement)", async () => {
    state = await makeTempStateHome({ name: "cf-j08-r-neg" });
    await admitTestEpisode({ stateHome: state.stateHome, episodeId: EPISODE, app: APP, now: T0 });
    const mechanical = await recordMechanicalStep({
      root: state.stateHome,
      episodeId: EPISODE,
      app: APP,
      runId: "20260731-102000-build-provision",
      operation: "build/provision",
      startedAt: T0,
      finishedAt: T0,
      status: "completed",
      reason: "deterministic provision step",
      inputFingerprint: "fp-provision-neg",
    });
    // Seeded violation via the raw bypass: a lying writer settles the
    // mechanical step as if it were a provider turn.
    await recordTurn(state.stateHome, {
      ...executorSettlement({
        result: makeTurnResult("completed", makeUsage(0.2)),
        at: T0,
        app: APP,
        runId: mechanical.run_id,
        providerTurnId: "forged-mechanical-ptid",
        executionStepId: mechanical.execution_step_id,
        episodeId: EPISODE,
      }),
    });
    const steps = await readExecutionSteps(state.stateHome, EPISODE);
    const coverage = settlementCoverage(steps, await readTurnRecords(state.stateHome));
    expect(coverage.mechanical_with_settlement).toEqual([mechanical.execution_step_id]); // FIRES
  });

  it("negative control: a duplicate seeded through the raw bypass makes the conservation detector FIRE on the duplicate-no-op guard's corpus", async () => {
    state = await makeTempStateHome({ name: "cf-j08-r-neg2" });
    const record = executorSettlement({
      result: makeTurnResult("completed", makeUsage(0.2)),
      at: T0,
      app: APP,
      runId: "20260731-103000-build-implement",
      providerTurnId: "ptid-cf-j08-r-neg2",
    });
    await recordTurn(state.stateHome, record); // the raw append bypass, twice
    await recordTurn(state.stateHome, record);
    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(2);
    expect(() => detectDoubleSettlement(rows)).toThrow(/x2/); // FIRES
    // The guarded entry refuses the same corpus.
    expect(await recordTurnOnce(state.stateHome, record)).toBe(false);
  });
});
