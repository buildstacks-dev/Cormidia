// Traceability: CF-J08-RC · HB-020 · contracts/journey-acceptance.md J-08 recovery criterion.

// CF-J08-RC — `budget --reconcile` back-fills idempotently from surviving
// evidence; legacy (app, runId) rows stay readable (HB-020).
//
// Design: case-catalog §1 CF-J08-RC; system-map §2.2 cost-ledger row ("legacy
// (app, runId) rows readable") and §2.5 version-skew note; invariants.md
// CORMIDIA-INV-006. The product surface is reconcileLedger (src/org/budget.ts):
// new-schema execution steps settle keyed (app, providerTurnId); legacy run
// envelopes without provider_turn_ids fall back to (app, runId); every
// scanned envelope lands in exactly one result bucket.
//
// Legacy evidence is planted through the REAL runlog writers (startRun /
// finalizeRun produce exactly the pre-provider-turn-id envelope shape when no
// providerTurnIds are ever attached); only the corrupt envelope is raw bytes,
// because no living writer emits a torn file.

import { afterEach, describe, expect, it } from "vitest";
import { rollupBudgets } from "../../../src/org/budget.js";
import { reconcileLedger } from "../../../src/org/budget.js";
import type { AppsFile } from "../../../src/org/apps.js";
import { readLedgerRange } from "../../../src/report/ledger-source.js";
import {
  readSettledKeys,
  readTurnRecords,
  recordTurn,
  recordTurnOnce,
  settlementKey,
  type TurnRecord,
} from "../../../src/runtime/telemetry.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import {
  admitTestEpisode,
  detectDoubleSettlement,
  makeTurnResult,
  makeUsage,
  plantCorruptEnvelope,
  plantEnvelope,
  plantProviderStep,
} from "./settlement-fixtures.js";

const T0 = new Date("2026-07-30T00:00:00.000Z");
const T1 = new Date("2026-07-30T00:05:00.000Z");
/** > 24h after T0 (the reconcile in-flight window). */
const T_LATER = new Date("2026-07-31T02:00:00.000Z");
const APP = "legacy-app";

function legacyLedgerRow(overrides: Partial<TurnRecord> = {}): TurnRecord {
  // A pre-providerTurnId ledger row exactly as historical settles wrote it:
  // keyed (app, runId), no providerTurnId, no executionStepId.
  return {
    at: T0.toISOString(),
    role: "builder",
    runtime: "claude",
    model: "claude-scripted-model",
    status: "completed",
    tokensIn: 800,
    tokensOut: 150,
    costUsd: 0.2,
    usageQuality: "complete",
    subagentTurns: 0,
    wallClockMs: 900,
    escalations: 0,
    app: APP,
    runId: "20260730-000000-build-implement",
    ...overrides,
  };
}

describe("CF-J08-RC — budget --reconcile back-fills idempotently from surviving evidence; legacy (app, runId) rows readable (L2)", () => {
  let state: TempStateHome;

  afterEach(async () => {
    await state.cleanup();
  });

  it("back-fills a terminal legacy envelope keyed (app, runId), exactly once across repeated reconciles", async () => {
    state = await makeTempStateHome({ name: "cf-j08-rc" });
    const runId = "20260730-001000-build-implement";
    await plantEnvelope({
      stateHome: state.stateHome,
      app: APP,
      runId,
      status: "completed",
      usage: { tokens_in: 1000, tokens_out: 200, cost_usd: 0.8, quality: "complete" },
      startedAt: T0,
      finishedAt: T1,
    });

    const first = await reconcileLedger(state.stateHome, { builder: "claude" }, T_LATER);
    expect(first.scanned).toBe(1);
    expect(first.settled).toBe(1);
    expect(first.recoveredUsd).toBeCloseTo(0.8, 6);

    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.runId).toBe(runId);
    expect(rows[0]!.providerTurnId).toBeUndefined(); // legacy identity, no invented turn id
    expect(rows[0]!.runtime).toBe("claude"); // runtimeByRole threaded through
    expect(await readSettledKeys(state.stateHome)).toContain(settlementKey(APP, runId));

    // Idempotent: the same evidence never settles twice.
    const second = await reconcileLedger(state.stateHome, { builder: "claude" }, T_LATER);
    expect(second.settled).toBe(0);
    expect(second.alreadySettled).toBe(1);
    expect(await readTurnRecords(state.stateHome)).toHaveLength(1);
    detectDoubleSettlement(await readTurnRecords(state.stateHome));
  });

  it("a pre-existing legacy ledger row protects its envelope from re-settlement — the legacy key is the same key reconcile derives", async () => {
    state = await makeTempStateHome({ name: "cf-j08-rc-pre" });
    const row = legacyLedgerRow();
    expect(await recordTurnOnce(state.stateHome, row)).toBe(true);
    await plantEnvelope({
      stateHome: state.stateHome,
      app: APP,
      runId: row.runId!,
      status: "completed",
      usage: { tokens_in: 800, tokens_out: 150, cost_usd: 0.2, quality: "complete" },
      startedAt: T0,
      finishedAt: T1,
    });
    const result = await reconcileLedger(state.stateHome, {}, T_LATER);
    expect(result.settled).toBe(0);
    expect(result.alreadySettled).toBe(1);
    expect(await readTurnRecords(state.stateHome)).toHaveLength(1);
  });

  it("every scanned envelope lands in exactly one bucket: settled / alreadySettled / noUsage / inFlight / corrupt", async () => {
    state = await makeTempStateHome({ name: "cf-j08-rc-buckets" });
    // settled: terminal with usage, never seen.
    await plantEnvelope({
      stateHome: state.stateHome,
      app: APP,
      runId: "20260730-002000-build-implement",
      status: "failed",
      usage: { tokens_in: 500, tokens_out: 50, cost_usd: 0.3, quality: "complete" },
      startedAt: T0,
      finishedAt: T1,
    });
    // alreadySettled: terminal with usage, row already in the ledger.
    const settledRow = legacyLedgerRow({ runId: "20260730-003000-build-implement" });
    await recordTurnOnce(state.stateHome, settledRow);
    await plantEnvelope({
      stateHome: state.stateHome,
      app: APP,
      runId: settledRow.runId!,
      status: "completed",
      usage: { tokens_in: 800, tokens_out: 150, cost_usd: 0.2, quality: "complete" },
      startedAt: T0,
      finishedAt: T1,
    });
    // noUsage: legacy pre-turn work — running, no usage, no provider ids.
    await plantEnvelope({
      stateHome: state.stateHome,
      app: APP,
      runId: "20260730-004000-build-implement",
      status: "running",
      startedAt: T0,
    });
    // inFlight: running WITH usage, younger than the 24h window at `now`.
    await plantEnvelope({
      stateHome: state.stateHome,
      app: APP,
      runId: "20260730-005000-build-implement",
      status: "running",
      usage: { tokens_in: 100, tokens_out: 10, cost_usd: 0.05, quality: "partial" },
      startedAt: new Date(T_LATER.getTime() - 60 * 60 * 1000), // 1h old
    });
    // corrupt: unreadable bytes — counted, never settled, never deleted.
    await plantCorruptEnvelope(state.stateHome, APP, "20260730-006000-build-implement");

    const result = await reconcileLedger(state.stateHome, {}, T_LATER);
    expect(result.scanned).toBe(5);
    expect(result.settled).toBe(1);
    expect(result.alreadySettled).toBe(1);
    expect(result.noUsage).toBe(1);
    expect(result.inFlight).toBe(1);
    expect(result.corrupt).toBe(1);
    expect(result.settled + result.alreadySettled + result.noUsage + result.inFlight + result.corrupt).toBe(
      result.scanned,
    );
    expect(await readTurnRecords(state.stateHome)).toHaveLength(2);
  });

  it("a dead legacy running envelope (older than the in-flight window, spend durable) is finalized failed and its real spend settles exactly once", async () => {
    state = await makeTempStateHome({ name: "cf-j08-rc-dead" });
    const runId = "20260730-007000-build-implement";
    await plantEnvelope({
      stateHome: state.stateHome,
      app: APP,
      runId,
      status: "running",
      usage: { tokens_in: 700, tokens_out: 90, cost_usd: 0.42, quality: "partial" },
      startedAt: T0, // 26h before T_LATER — provably dead
    });
    const result = await reconcileLedger(state.stateHome, {}, T_LATER);
    expect(result.settled).toBe(1);
    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("failed"); // running-with-usage: the spend is real
    expect(rows[0]!.costUsd).toBe(0.42);
    // Idempotent: the envelope is now terminal and settled.
    const again = await reconcileLedger(state.stateHome, {}, T_LATER);
    expect(again.settled).toBe(0);
    expect(again.alreadySettled).toBe(1);
  });

  it("mixed corpus: new-schema step evidence and a legacy envelope back-fill in one reconcile without cross-talk, idempotently", async () => {
    state = await makeTempStateHome({ name: "cf-j08-rc-mixed" });
    const episodeId = `ticket:${APP}:#600`;
    await admitTestEpisode({ stateHome: state.stateHome, episodeId, app: APP, now: T0 });
    const stepTurn = await plantProviderStep({
      stateHome: state.stateHome,
      episodeId,
      app: APP,
      runId: "20260730-008000-build-implement",
      result: makeTurnResult("completed", makeUsage(0.6)),
      startedAt: T0,
      finishedAt: T1,
    });
    await plantEnvelope({
      stateHome: state.stateHome,
      app: APP,
      runId: "20260730-009000-build-implement",
      status: "completed",
      usage: { tokens_in: 400, tokens_out: 40, cost_usd: 0.15, quality: "complete" },
      startedAt: T0,
      finishedAt: T1,
    });

    const result = await reconcileLedger(state.stateHome, {}, T_LATER);
    expect(result.settled).toBe(2);
    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(2);
    const keys = await readSettledKeys(state.stateHome);
    expect(keys).toContain(settlementKey(APP, stepTurn.providerTurnId)); // new identity
    expect(keys).toContain(settlementKey(APP, "20260730-009000-build-implement")); // legacy identity
    detectDoubleSettlement(rows);

    const again = await reconcileLedger(state.stateHome, {}, T_LATER);
    expect(again.settled).toBe(0);
    expect(await readTurnRecords(state.stateHome)).toHaveLength(2);
  });

  it("legacy (app, runId) rows stay readable by every ledger consumer: readTurnRecords, the report range reader, budget rollup, and the settled-key index", async () => {
    state = await makeTempStateHome({ name: "cf-j08-rc-read" });
    const row = legacyLedgerRow();
    await recordTurnOnce(state.stateHome, row);
    await assertNonEmptyWalk(state.path("telemetry"), /\.jsonl$/);

    // Telemetry reader.
    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.runId).toBe(row.runId);

    // Report source: the legacy row validates cleanly — no invalid_row
    // diagnostic merely for lacking providerTurnId.
    const range = await readLedgerRange(
      state.stateHome,
      {
        preset: "custom",
        from_inclusive: "2026-07-01T00:00:00.000Z",
        to_exclusive: "2026-08-01T00:00:00.000Z",
        display_timezone: "UTC",
        bucket: "day",
        open_interval: false,
      },
      T_LATER,
    );
    expect(range.rows).toHaveLength(1);
    expect(range.diagnostics).toEqual([]);

    // Budget rollup counts the legacy spend.
    const apps: AppsFile = {
      org: { name: "cf-j08-rc", maxConcurrentTurns: 1 },
      defaults: { budgetUsdMonth: 100, objectiveBudgetUsd: 1000 },
      apps: [
        {
          name: APP,
          repo: "cormidia-double/unused",
          status: "live",
          budgetUsdMonth: 100,
          objectiveBudgetUsd: 1000,
          cadence: {},
        },
      ],
    };
    const budget = await rollupBudgets(state.stateHome, apps, T_LATER);
    expect(budget.find((entry) => entry.app === APP)?.spentUsd).toBeCloseTo(0.2, 6);

    // Settlement index derives the legacy fallback key.
    expect(await readSettledKeys(state.stateHome)).toContain(settlementKey(APP, row.runId!));
  });

  it("negative control: a duplicate of an already-reconciled legacy row seeded through the raw bypass makes the conservation detector FIRE — and reconcile still refuses a third", async () => {
    state = await makeTempStateHome({ name: "cf-j08-rc-neg" });
    const runId = "20260730-010000-build-implement";
    await plantEnvelope({
      stateHome: state.stateHome,
      app: APP,
      runId,
      status: "completed",
      usage: { tokens_in: 300, tokens_out: 30, cost_usd: 0.25, quality: "complete" },
      startedAt: T0,
      finishedAt: T1,
    });
    await reconcileLedger(state.stateHome, {}, T_LATER); // legitimate settle
    await recordTurn(state.stateHome, legacyLedgerRow({ runId, costUsd: 0.25 })); // the bypass

    const rows = await readTurnRecords(state.stateHome);
    expect(rows.filter((candidate) => candidate.runId === runId)).toHaveLength(2);
    expect(() => detectDoubleSettlement(rows)).toThrow(/x2/); // FIRES

    // The guarded paths never add a third.
    const again = await reconcileLedger(state.stateHome, {}, T_LATER);
    expect(again.settled).toBe(0);
    expect(await recordTurnOnce(state.stateHome, legacyLedgerRow({ runId }))).toBe(false);
  });
});
