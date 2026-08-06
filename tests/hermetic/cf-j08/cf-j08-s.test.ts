// CF-J08-S — every terminal outcome class settles exactly once, keyed
// (app, providerTurnId); estimates flagged (HB-020).
//
// Design: validation-design/invariants.md CORMIDIA-INV-006 ("succeeded, failed,
// cancelled, malformed, or gate-stopped alike"); case-catalog §1 CF-J08-S;
// system-map §2.2 cost-ledger row (telemetry/<date>.jsonl, exactly once per
// provider turn). Layer 2 composition on the REAL chain: admitEpisode →
// beginProviderStep → finalizeProviderStep (src/loop/efficiency.ts), then the
// executor-shaped toRecord + recordTurnOnce settle (src/loop/pipeline.ts's
// exact ordering), asserted against the durable ledger and the product's own
// settlementCoverage detector.
//
// Outcome-class mapping (product truth, src/runtime/types.ts TurnResult):
// succeeded=completed · failed=failed · cancelled=cancelled ·
// gate-stopped=blocked_on_gate · timed_out=timed_out. "Malformed" has no
// dedicated status — a malformed provider output surfaces as status "failed"
// with a typed errorCode, so that class is asserted as the failed+errorCode
// variant.

import { afterEach, describe, expect, it } from "vitest";
import { settlementCoverage } from "../../../src/loop/efficiency.js";
import { reconcileLedger } from "../../../src/org/budget.js";
import {
  readSettledKeys,
  readTurnRecords,
  recordTurn,
  recordTurnOnce,
  settlementKey,
} from "../../../src/runtime/telemetry.js";
import type { TurnResult } from "../../../src/runtime/types.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import {
  admitTestEpisode,
  detectDoubleSettlement,
  executorSettlement,
  makeTurnResult,
  makeUsage,
  plantProviderStep,
  type PlantedProviderTurn,
} from "./settlement-fixtures.js";

const T0 = new Date("2026-07-31T10:00:00.000Z");
const T1 = new Date("2026-07-31T10:05:00.000Z");
const APP = "settle-app";

interface OutcomeCase {
  label: string;
  result: TurnResult;
  /** The ledger row status the settle must record. */
  ledgerStatus: TurnResult["status"];
}

const OUTCOME_CLASSES: OutcomeCase[] = [
  {
    label: "succeeded",
    result: makeTurnResult("completed", makeUsage(0.4)),
    ledgerStatus: "completed",
  },
  {
    label: "failed",
    result: makeTurnResult("failed", makeUsage(0.3), { errorCode: "error_provider_failure" }),
    ledgerStatus: "failed",
  },
  {
    label: "cancelled",
    result: makeTurnResult("cancelled", makeUsage(0.2)),
    ledgerStatus: "cancelled",
  },
  {
    label: "malformed (failed + typed errorCode — no dedicated status exists)",
    result: makeTurnResult("failed", makeUsage(0.25), { errorCode: "error_malformed_verdict" }),
    ledgerStatus: "failed",
  },
  {
    label: "gate-stopped",
    result: makeTurnResult("blocked_on_gate", makeUsage(0.15), {
      errorCode: "error_max_budget_usd",
    }),
    ledgerStatus: "blocked_on_gate",
  },
  {
    label: "timed_out",
    result: makeTurnResult("timed_out", makeUsage(0.1)),
    ledgerStatus: "timed_out",
  },
];

describe("CF-J08-S — every terminal outcome class settles exactly once, keyed (app, providerTurnId) (L2)", () => {
  let state: TempStateHome;

  afterEach(async () => {
    await state.cleanup();
  });

  async function plantAndSettle(
    outcome: OutcomeCase,
    index: number,
  ): Promise<{ planted: PlantedProviderTurn; appended: boolean }> {
    // One episode per class: a terminal partial/unavailable step blocks later
    // admission in the same episode (checkProviderBudget unmeasured refusal),
    // and independent episodes keep each class's evidence isolated.
    const episodeId = `ticket:${APP}:#${100 + index}`;
    const runId = `20260731-10000${index}-build-implement`;
    await admitTestEpisode({ stateHome: state.stateHome, episodeId, app: APP, now: T0 });
    const planted = await plantProviderStep({
      stateHome: state.stateHome,
      episodeId,
      app: APP,
      runId,
      result: outcome.result,
      startedAt: T0,
      finishedAt: T1,
    });
    const appended = await recordTurnOnce(
      state.stateHome,
      executorSettlement({
        result: outcome.result,
        at: T1,
        app: APP,
        runId,
        providerTurnId: planted.providerTurnId,
        executionStepId: planted.executionStepId,
        episodeId,
      }),
    );
    return { planted, appended };
  }

  it("settles all six outcome-class variants exactly once each, with status fidelity and duplicate refusal", async () => {
    state = await makeTempStateHome({ name: "cf-j08-s" });
    const planted: PlantedProviderTurn[] = [];
    for (const [index, outcome] of OUTCOME_CLASSES.entries()) {
      const { planted: turn, appended } = await plantAndSettle(outcome, index);
      expect(appended, `${outcome.label} must settle`).toBe(true);
      planted.push(turn);
    }

    // No green by absence: the ledger walk found the day file.
    await assertNonEmptyWalk(state.path("telemetry"), /\.jsonl$/);
    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(OUTCOME_CLASSES.length);
    detectDoubleSettlement(rows);

    // Status fidelity per class, and every row keyed (app, providerTurnId).
    const settled = await readSettledKeys(state.stateHome);
    for (const [index, outcome] of OUTCOME_CLASSES.entries()) {
      const turn = planted[index]!;
      const row = rows.find((candidate) => candidate.providerTurnId === turn.providerTurnId);
      expect(row, `${outcome.label} row present`).toBeDefined();
      expect(row!.status).toBe(outcome.ledgerStatus);
      expect(row!.app).toBe(APP);
      expect(settled).toContain(settlementKey(APP, turn.providerTurnId));
    }

    // The product's own coverage detector agrees: complete, no missing, no
    // duplicates, across the terminal execution records of all six episodes.
    const coverage = settlementCoverage(
      planted.map((turn) => turn.step),
      rows,
    );
    expect(coverage.denominator).toBe(OUTCOME_CLASSES.length);
    expect(coverage.numerator).toBe(OUTCOME_CLASSES.length);
    expect(coverage.missing).toEqual([]);
    expect(coverage.duplicate).toEqual([]);

    // A duplicate settle attempt for every class — even with drifted figures —
    // refuses; the ledger still holds exactly one row per turn.
    for (const [index, outcome] of OUTCOME_CLASSES.entries()) {
      const turn = planted[index]!;
      const drifted = executorSettlement({
        result: makeTurnResult(outcome.result.status, makeUsage(99.99)),
        at: T1,
        app: APP,
        runId: turn.runId,
        providerTurnId: turn.providerTurnId,
        executionStepId: turn.executionStepId,
        episodeId: turn.episodeId,
      });
      expect(await recordTurnOnce(state.stateHome, drifted)).toBe(false);
    }
    expect(await readTurnRecords(state.stateHome)).toHaveLength(OUTCOME_CLASSES.length);
  });

  it("flags estimated cost on the settled row (costEstimated + usageQuality estimated), never as a provider-invoiced charge", async () => {
    state = await makeTempStateHome({ name: "cf-j08-s-est" });
    const episodeId = `ticket:${APP}:#200`;
    const runId = "20260731-110000-build-implement";
    // A codex-style result: costUsd computed from token counts, not invoiced.
    // quality is deliberately omitted so the toRecord derivation path
    // (costEstimated === true → "estimated") is the surface under test.
    const result = makeTurnResult("completed", {
      tokensIn: 900,
      tokensOut: 200,
      costUsd: 0.37,
      costEstimated: true,
      subagentTurns: 0,
      wallClockMs: 1200,
    });
    await admitTestEpisode({ stateHome: state.stateHome, episodeId, app: APP, now: T0 });
    const planted = await plantProviderStep({
      stateHome: state.stateHome,
      episodeId,
      app: APP,
      runId,
      result,
      startedAt: T0,
      finishedAt: T1,
    });
    expect(
      await recordTurnOnce(
        state.stateHome,
        executorSettlement({
          result,
          at: T1,
          app: APP,
          runId,
          providerTurnId: planted.providerTurnId,
          executionStepId: planted.executionStepId,
          episodeId,
        }),
      ),
    ).toBe(true);

    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.costEstimated).toBe(true);
    expect(rows[0]!.usageQuality).toBe("estimated");
    expect(rows[0]!.costUsd).toBe(0.37); // the estimate itself is retained, never zeroed
  });

  it("settles an unavailable-usage turn as unknown — flagged unmeasured, never rendered as a known $0", async () => {
    state = await makeTempStateHome({ name: "cf-j08-s-unav" });
    const episodeId = `ticket:${APP}:#201`;
    const runId = "20260731-113000-build-implement";
    const result = makeTurnResult("failed", makeUsage(0, { quality: "unavailable" }), {
      errorCode: "error_provider_failure",
    });
    await admitTestEpisode({ stateHome: state.stateHome, episodeId, app: APP, now: T0 });
    const planted = await plantProviderStep({
      stateHome: state.stateHome,
      episodeId,
      app: APP,
      runId,
      result,
      startedAt: T0,
      finishedAt: T1,
    });
    expect(
      await recordTurnOnce(
        state.stateHome,
        executorSettlement({
          result,
          at: T1,
          app: APP,
          runId,
          providerTurnId: planted.providerTurnId,
          executionStepId: planted.executionStepId,
          episodeId,
        }),
      ),
    ).toBe(true);

    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.usageQuality).toBe("unavailable");
    expect(rows[0]!.unmeasured).toBe(true); // the honest reading is "unknown", never "free"
  });

  it("negative control: a dropped settle (turn finalized, ledger never appended) makes settlementCoverage FIRE as missing — and reconcile back-fills it red-then-green", async () => {
    state = await makeTempStateHome({ name: "cf-j08-s-neg" });
    const episodeId = `ticket:${APP}:#300`;
    const runId = "20260731-120000-build-implement";
    const result = makeTurnResult("completed", makeUsage(0.5));
    await admitTestEpisode({ stateHome: state.stateHome, episodeId, app: APP, now: T0 });
    const planted = await plantProviderStep({
      stateHome: state.stateHome,
      episodeId,
      app: APP,
      runId,
      result,
      startedAt: T0,
      finishedAt: T1,
    });
    // Seeded violation: the executor died before recordTurnOnce — no settle.
    const before = settlementCoverage([planted.step], await readTurnRecords(state.stateHome));
    expect(before.missing).toEqual([planted.executionStepId]); // detector FIRES
    expect(before.numerator).toBe(0);

    // Green: reconcile deposits the exactly-once row from surviving evidence.
    const repaired = await reconcileLedger(state.stateHome, {}, T1);
    expect(repaired.settled).toBe(1);
    const after = settlementCoverage([planted.step], await readTurnRecords(state.stateHome));
    expect(after.missing).toEqual([]);
    expect(after.numerator).toBe(1);
  });

  it("negative control: a double-settle seeded through the raw recordTurn bypass makes both detectors FIRE (duplicate + conservation)", async () => {
    state = await makeTempStateHome({ name: "cf-j08-s-neg2" });
    const episodeId = `ticket:${APP}:#301`;
    const runId = "20260731-123000-build-implement";
    const result = makeTurnResult("completed", makeUsage(0.5));
    await admitTestEpisode({ stateHome: state.stateHome, episodeId, app: APP, now: T0 });
    const planted = await plantProviderStep({
      stateHome: state.stateHome,
      episodeId,
      app: APP,
      runId,
      result,
      startedAt: T0,
      finishedAt: T1,
    });
    const record = executorSettlement({
      result,
      at: T1,
      app: APP,
      runId,
      providerTurnId: planted.providerTurnId,
      executionStepId: planted.executionStepId,
      episodeId,
    });
    // The bypass: recordTurn is the raw append recordTurnOnce itself uses.
    await recordTurn(state.stateHome, record);
    await recordTurn(state.stateHome, record);

    const rows = await readTurnRecords(state.stateHome);
    expect(() => detectDoubleSettlement(rows)).toThrow(/x2/);
    const coverage = settlementCoverage([planted.step], rows);
    expect(coverage.duplicate).toEqual([planted.executionStepId]);
    // The guard itself would have refused this corpus: only the bypass
    // reaches it.
    expect(await recordTurnOnce(state.stateHome, record)).toBe(false);
  });
});
