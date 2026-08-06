// CF-J08-I — kill between provider return and ledger append; ENOSPC variant
// via B-15, asserted at this family's seam only (HB-020).
//
// Design: validation-design/invariants.md CORMIDIA-INV-006 adversarial seed (a)
// "kill between provider return and ledger append, then budget --reconcile";
// case-catalog §1 CF-J08-I; boundary-map B-15 (resource-exhaustion modifier).
// The product settle ordering (src/loop/pipeline.ts) is: provider returns →
// updateEnvelope(usage) → finalizeProviderStep (durable) → recordTurnOnce.
// Each test reproduces the exact durable state one kill window leaves —
// produced by the REAL writers stopping at the window, since a killed process
// by definition writes nothing further — and asserts reconcile back-fills
// exactly once, idempotently.
//
// ENOSPC coordination note (CF-B15): full filesystem fault injection across
// every write path belongs to the B-15 family. This suite asserts ONLY the
// settlement seam's contract under an injected append failure: fail closed
// (loud error, no false settled claim), and the post-fault retry settles
// exactly once, never twice.

import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readExecutionSteps, settlementCoverage } from "../../../src/loop/efficiency.js";
import { reconcileLedger } from "../../../src/org/budget.js";
import { readEnvelope } from "../../../src/runtime/runlog/envelope.js";
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
  plantEnvelope,
  plantProviderStep,
} from "./settlement-fixtures.js";
import { beginProviderStep } from "../../../src/loop/efficiency.js";
import { makeRole } from "./settlement-fixtures.js";

const T0 = new Date("2026-07-30T00:00:00.000Z");
const T1 = new Date("2026-07-30T00:05:00.000Z");
/** > IN_FLIGHT_WINDOW_MS (24h, src/org/budget.ts) after T0. */
const T_LATER = new Date("2026-07-31T02:00:00.000Z");
/** < 24h after T0 — inside the in-flight window. */
const T_SOON = new Date("2026-07-30T03:00:00.000Z");
const APP = "kill-app";

describe("CF-J08-I — kill between provider return and ledger append; ENOSPC variant at the settlement seam (L2)", () => {
  let state: TempStateHome;

  afterEach(async () => {
    await state.cleanup();
  });

  it("kill after finalizeProviderStep, before recordTurnOnce: reconcile back-fills exactly one full-fidelity row; a second reconcile deposits nothing", async () => {
    state = await makeTempStateHome({ name: "cf-j08-i-step" });
    const episodeId = `ticket:${APP}:#500`;
    const runId = "20260730-000000-build-implement";
    const result = makeTurnResult("completed", makeUsage(0.7));
    await admitTestEpisode({ stateHome: state.stateHome, episodeId, app: APP, now: T0 });
    // The kill window: terminal execution record durable, NO settle — exactly
    // what pipeline.ts's write ordering guarantees survives this crash.
    const planted = await plantProviderStep({
      stateHome: state.stateHome,
      episodeId,
      app: APP,
      runId,
      result,
      startedAt: T0,
      finishedAt: T1,
    });
    expect(await readTurnRecords(state.stateHome)).toHaveLength(0);

    const first = await reconcileLedger(state.stateHome, {}, T1);
    expect(first.settled).toBe(1);
    expect(first.recoveredUsd).toBeCloseTo(0.7, 6);

    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // Full attribution fidelity — turnRecordFromExecutionStep preserves the
    // execution identity instead of a lower-fidelity recovery row.
    expect(row.providerTurnId).toBe(planted.providerTurnId);
    expect(row.executionStepId).toBe(planted.executionStepId);
    expect(row.episodeId).toBe(episodeId);
    expect(row.app).toBe(APP);
    expect(row.runId).toBe(runId);
    expect(row.status).toBe("completed");
    expect(row.costUsd).toBe(0.7);

    // Idempotent: the second reconcile finds the key settled.
    const second = await reconcileLedger(state.stateHome, {}, T1);
    expect(second.settled).toBe(0);
    expect(await readTurnRecords(state.stateHome)).toHaveLength(1);
    detectDoubleSettlement(await readTurnRecords(state.stateHome));
  });

  it("kill after provider return (usage durable in envelope), before finalizeProviderStep: the stale receipt is recovered with the envelope's usage and settles exactly once", async () => {
    state = await makeTempStateHome({ name: "cf-j08-i-receipt" });
    const episodeId = `ticket:${APP}:#501`;
    const runId = "20260730-001000-build-implement";
    await admitTestEpisode({ stateHome: state.stateHome, episodeId, app: APP, now: T0 });
    // Real writers up to the kill: begin (durable started receipt), then the
    // envelope checkpoint the executor writes after the provider returned.
    const started = await beginProviderStep({
      root: state.stateHome,
      episodeId,
      app: APP,
      runId,
      ordinal: 1,
      operation: "build/implement",
      role: makeRole(),
      inputFingerprint: `fp-${runId}-1`,
      now: T0,
    });
    await plantEnvelope({
      stateHome: state.stateHome,
      app: APP,
      runId,
      status: "running", // the process died before any finalization
      usage: { tokens_in: 900, tokens_out: 120, cost_usd: 0.55, quality: "complete" },
      providerTurnIds: [started.providerTurnId],
      startedAt: T0,
    });

    // Inside the 24h in-flight window nothing is touched — the pass may be
    // between turn-return and finalize, and settling would race the executor.
    const early = await reconcileLedger(state.stateHome, {}, T_SOON);
    expect(early.inFlight).toBeGreaterThanOrEqual(1);
    expect(early.settled).toBe(0);
    expect(await readTurnRecords(state.stateHome)).toHaveLength(0);

    // Past the window the receipt is provably dead: recovered usage from the
    // envelope, typed interrupted terminal step, exactly one ledger row.
    const repaired = await reconcileLedger(state.stateHome, {}, T_LATER);
    expect(repaired.settled).toBe(1);
    expect(repaired.recoveredUsd).toBeCloseTo(0.55, 6);
    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.providerTurnId).toBe(started.providerTurnId);
    expect(rows[0]!.status).toBe("failed"); // interrupted maps to failed in the ledger
    expect(rows[0]!.costUsd).toBe(0.55); // the paid-for spend, not zero

    // The run envelope was terminalized (never left dangling "running"), and
    // the step evidence agrees with the ledger.
    const envelope = await readEnvelope(state.stateHome, APP, runId);
    expect(envelope.status).toBe("failed");
    const coverage = settlementCoverage(await readExecutionSteps(state.stateHome, episodeId), rows);
    expect(coverage.missing).toEqual([]);
    expect(coverage.duplicate).toEqual([]);

    // Idempotent under repetition.
    const again = await reconcileLedger(state.stateHome, {}, T_LATER);
    expect(again.settled).toBe(0);
    expect(await readTurnRecords(state.stateHome)).toHaveLength(1);
  });

  it("ENOSPC variant (B-15 seam): a failed ledger append fails CLOSED — no settled claim anywhere — and the post-fault retry settles exactly once", async () => {
    state = await makeTempStateHome({ name: "cf-j08-i-enospc" });
    // Prime the sidecar index + recovery marker with a clean settlement so the
    // injected fault is the only anomaly.
    await recordTurnOnce(
      state.stateHome,
      executorSettlement({
        result: makeTurnResult("completed", makeUsage(0.1)),
        at: T0,
        app: APP,
        runId: "20260730-002000-build-implement",
        providerTurnId: "ptid-clean",
      }),
    );

    // The blocked settle lands on a DIFFERENT UTC day than the priming one so
    // its day file does not exist yet and the injected fault owns that path.
    const record = executorSettlement({
      result: makeTurnResult("completed", makeUsage(0.9)),
      at: T_LATER,
      app: APP,
      runId: "20260731-003000-build-implement",
      providerTurnId: "ptid-blocked-append",
    });
    const key = settlementKey(APP, "ptid-blocked-append");
    const day = record.at.slice(0, 10);
    const dayPath = state.path("telemetry", `${day}.jsonl`);
    // Inject the append failure at the seam: the day file path is unwritable
    // (a directory), so appendFile fails exactly where ENOSPC would. Real
    // disk-full injection across all writers is CF-B15's cell, not this one.
    await mkdir(dayPath, { recursive: true });

    await expect(recordTurnOnce(state.stateHome, record)).rejects.toThrow();

    // Fail-closed evidence: the sidecar never claims a row the ledger does not
    // hold (index can only LAG the ledger), and the pending intent journal
    // survives for the retry to repair.
    const sidecar = await readFile(state.path("telemetry-index", "settled.keys"), "utf8");
    expect(sidecar.split("\n")).not.toContain(key);
    expect(existsSync(state.path("telemetry-index", "pending-settlement.json"))).toBe(true);

    // Fault clears (space freed) — the retry repairs the pending intent
    // (ledger day holds no such row → intent discarded) and settles ONCE.
    await rm(dayPath, { recursive: true, force: true });
    expect(await recordTurnOnce(state.stateHome, record)).toBe(true);
    expect(existsSync(state.path("telemetry-index", "pending-settlement.json"))).toBe(false);
    expect(await recordTurnOnce(state.stateHome, record)).toBe(false); // duplicate refuses

    const rows = await readTurnRecords(state.stateHome);
    expect(rows.filter((row) => row.providerTurnId === "ptid-blocked-append")).toHaveLength(1);
    detectDoubleSettlement(rows);
    expect(await readSettledKeys(state.stateHome)).toContain(key);
  });

  it("crash between ledger append and sidecar append: the pending journal repairs the lag and the retry refuses a duplicate", async () => {
    state = await makeTempStateHome({ name: "cf-j08-i-lag" });
    await recordTurnOnce(
      state.stateHome,
      executorSettlement({
        result: makeTurnResult("completed", makeUsage(0.1)),
        at: T0,
        app: APP,
        runId: "20260730-004000-build-implement",
        providerTurnId: "ptid-clean",
      }),
    );
    // The exact crash state: row durable in the ledger, key NOT in the
    // sidecar, pending intent on disk. Only raw bytes can reproduce a dead
    // writer's half-finished transaction.
    const crashed = executorSettlement({
      result: makeTurnResult("completed", makeUsage(0.33)),
      at: T0,
      app: APP,
      runId: "20260730-005000-build-implement",
      providerTurnId: "ptid-crashed",
    });
    const key = settlementKey(APP, "ptid-crashed");
    await recordTurn(state.stateHome, crashed); // the append the dead writer completed
    await writeFile(
      state.path("telemetry-index", "pending-settlement.json"),
      `${JSON.stringify({ schema_version: 1, key, ledger_day: crashed.at.slice(0, 10) })}\n`,
      "utf8",
    );

    expect(await recordTurnOnce(state.stateHome, crashed)).toBe(false); // repaired + refused
    const rows = await readTurnRecords(state.stateHome);
    expect(rows.filter((row) => row.providerTurnId === "ptid-crashed")).toHaveLength(1);
    detectDoubleSettlement(rows);
    const sidecar = await readFile(state.path("telemetry-index", "settled.keys"), "utf8");
    expect(sidecar.split("\n")).toContain(key); // the lagging key caught up
  });

  it("negative control: destroying the pending journal after a ledger-first crash makes the retry double-pay — the conservation detector FIRES, proving the journal is load-bearing", async () => {
    state = await makeTempStateHome({ name: "cf-j08-i-neg" });
    await recordTurnOnce(
      state.stateHome,
      executorSettlement({
        result: makeTurnResult("completed", makeUsage(0.1)),
        at: T0,
        app: APP,
        runId: "20260730-006000-build-implement",
        providerTurnId: "ptid-clean",
      }),
    );
    const crashed = executorSettlement({
      result: makeTurnResult("completed", makeUsage(0.5)),
      at: T0,
      app: APP,
      runId: "20260730-007000-build-implement",
      providerTurnId: "ptid-journal-lost",
    });
    await recordTurn(state.stateHome, crashed); // ledger row durable
    // Seeded violation: the crash-repair evidence is destroyed (no pending
    // journal), so the sidecar lag is undiscoverable and the retry re-pays.
    expect(existsSync(state.path("telemetry-index", "pending-settlement.json"))).toBe(false);

    expect(await recordTurnOnce(state.stateHome, crashed)).toBe(true); // the double-pay
    const rows = await readTurnRecords(state.stateHome);
    expect(rows.filter((row) => row.providerTurnId === "ptid-journal-lost")).toHaveLength(2);
    expect(() => detectDoubleSettlement(rows)).toThrow(/x2/); // detector FIRES
  });
});
