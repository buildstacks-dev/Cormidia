// CF-INV-006 — HB-020 — invariants.md CORMIDIA-INV-006 settlement conservation.

// Settlement conservation, L1 invariant guardrail.
//
// CORMIDIA-INV-006 (validation-design/invariants.md): every provider turn
// settles exactly once, keyed on (app, providerTurnId) — the app is part of
// the identity because runId alone collides across apps (telemetry.ts header).
// The guard under test is the REAL product function `recordTurnOnce`
// (src/runtime/telemetry.ts) plus its crash-window repair path; the raw
// `recordTurn` append is the one exported bypass, and the negative controls
// below seed a double-settle through it to prove the detector fires.
//
// Layer: 1 (unit). Zero network, zero tokens; all writes land in a temp state
// home from the fixture kit.

import { afterEach, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  readSettledKeys,
  readTurnRecords,
  recordTurn,
  recordTurnOnce,
  settlementIdentity,
  settlementKey,
  type TurnRecord,
} from "../../../src/runtime/telemetry.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";

// ---------------------------------------------------------------------------
// The detector (negative-control rule: it must FIRE on a seeded violation)
// ---------------------------------------------------------------------------

class SettlementConservationViolation extends Error {
  constructor(readonly duplicates: ReadonlyMap<string, number>) {
    super(
      "INV-006 violated: settlement key(s) settled more than once — " +
        [...duplicates.entries()].map(([key, count]) => `${JSON.stringify(key)} x${count}`).join(", "),
    );
    this.name = "SettlementConservationViolation";
  }
}

/** Throws when any (app, providerTurnId|runId) settlement identity appears in
 *  the ledger corpus more than once. Uses the product's own key derivation so
 *  the detector can never drift from what the guard enforces. */
function detectDoubleSettlement(rows: readonly TurnRecord[]): void {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const identity = settlementIdentity(row);
    if (identity === undefined) continue;
    const key = settlementKey(row.app, identity);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicates = new Map([...counts.entries()].filter(([, count]) => count > 1));
  if (duplicates.size > 0) throw new SettlementConservationViolation(duplicates);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AT = "2026-07-31T12:00:00.000Z";
const DAY = AT.slice(0, 10);

function makeRecord(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    at: AT,
    role: "builder",
    runtime: "claude",
    model: "claude-scripted-model",
    status: "completed",
    tokensIn: 1200,
    tokensOut: 300,
    costUsd: 0.42,
    usageQuality: "complete",
    subagentTurns: 0,
    wallClockMs: 1500,
    escalations: 0,
    app: "skeleton-app",
    runId: "20260731-120000-build-implement",
    providerTurnId: "ptid-hb005-0001",
    ...overrides,
  };
}

function pendingSettlementPath(stateHome: string): string {
  return join(stateHome, "telemetry-index", "pending-settlement.json");
}

describe("CF-INV-006 — exactly-once settlement keyed (app, providerTurnId) (L1 guardrail, HB-005a)", () => {
  let state: TempStateHome;

  afterEach(async () => {
    await state.cleanup();
  });

  it("settles one provider turn exactly once: the duplicate settle attempt refuses (no-op) and the ledger keeps one row", async () => {
    state = await makeTempStateHome({ name: "inv006" });
    const record = makeRecord();

    expect(await recordTurnOnce(state.stateHome, record)).toBe(true);
    // A retried settle for the same identity — even with drifted figures —
    // must refuse, not append and not overwrite.
    expect(await recordTurnOnce(state.stateHome, makeRecord({ costUsd: 99.99 }))).toBe(false);

    // The ledger walk is non-empty (no green by absence) and holds ONE row.
    await assertNonEmptyWalk(state.path("telemetry"), /\.jsonl$/);
    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.costUsd).toBe(0.42); // the first settle's figures are the durable truth
    detectDoubleSettlement(rows); // does not fire on a conserving corpus

    const key = settlementKey(record.app, settlementIdentity(record)!);
    expect(await readSettledKeys(state.stateHome)).toContain(key);
  });

  it("settlement identity includes the app: the same providerTurnId under two apps is two distinct settlements", async () => {
    state = await makeTempStateHome({ name: "inv006-apps" });
    // mintRunId is second-granular, so two apps sharing packaged pipelines can
    // collide on the bare id — the ledger key disambiguates by app
    // (telemetry.ts settlementKey doc).
    expect(await recordTurnOnce(state.stateHome, makeRecord({ app: "app-alpha" }))).toBe(true);
    expect(await recordTurnOnce(state.stateHome, makeRecord({ app: "app-beta" }))).toBe(true);

    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(2);
    detectDoubleSettlement(rows); // distinct keys — conservation holds
  });

  it("crash-window repair: ledger row durable, sidecar index lagging, pending journal left behind — the retry repairs and refuses a duplicate", async () => {
    state = await makeTempStateHome({ name: "inv006-repair" });
    // A first, clean settlement creates the sidecar index + recovery marker.
    await recordTurnOnce(state.stateHome, makeRecord({ providerTurnId: "ptid-clean" }));

    // Reproduce the exact state a writer leaves when it dies strictly between
    // the authoritative ledger append and the derived sidecar append: row in
    // the ledger, key NOT in the sidecar, pending-settlement intent on disk.
    const crashed = makeRecord({ providerTurnId: "ptid-crashed" });
    const key = settlementKey(crashed.app, settlementIdentity(crashed)!);
    await recordTurn(state.stateHome, crashed); // the ledger append the dead writer completed
    await writeFile(
      pendingSettlementPath(state.stateHome),
      `${JSON.stringify({ schema_version: 1, key, ledger_day: DAY })}\n`,
      "utf8",
    );

    // The retry of the same settlement must repair the sidecar and refuse —
    // an already-paid provider turn can never be paid twice.
    expect(await recordTurnOnce(state.stateHome, crashed)).toBe(false);
    expect(existsSync(pendingSettlementPath(state.stateHome))).toBe(false);

    const rows = await readTurnRecords(state.stateHome);
    expect(rows.filter((row) => settlementIdentity(row) === "ptid-crashed")).toHaveLength(1);
    detectDoubleSettlement(rows);

    // The repaired sidecar now carries the key, byte-for-byte.
    const sidecar = await readFile(join(state.stateHome, "telemetry-index", "settled.keys"), "utf8");
    expect(sidecar.split("\n")).toContain(key);
  });

  it("refuses a record with no settlement identity at all (providerTurnId or legacy runId required)", async () => {
    state = await makeTempStateHome({ name: "inv006-noid" });
    const record = makeRecord();
    delete record.providerTurnId;
    delete record.runId;
    await expect(recordTurnOnce(state.stateHome, record)).rejects.toThrow(/providerTurnId or legacy runId is required/);
    expect(await readTurnRecords(state.stateHome)).toHaveLength(0);
  });

  it("negative control: a double-settle seeded through the raw recordTurn bypass makes the conservation detector FIRE", async () => {
    state = await makeTempStateHome({ name: "inv006-neg" });
    const record = makeRecord();

    // The bypass: recordTurn is the raw append recordTurnOnce itself uses.
    // Writing the same settlement through it twice is the seeded violation.
    await recordTurn(state.stateHome, record);
    await recordTurn(state.stateHome, record);

    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(2);
    expect(() => detectDoubleSettlement(rows)).toThrow(SettlementConservationViolation);
    expect(() => detectDoubleSettlement(rows)).toThrow(/x2/);

    // Red-then-green evidence that the guard itself would have refused this:
    // the corpus above is only reachable by bypassing recordTurnOnce.
    expect(await recordTurnOnce(state.stateHome, record)).toBe(false);
  });

  it("negative control: an unreadable pending-settlement journal fails the next settlement CLOSED (loud), never open", async () => {
    state = await makeTempStateHome({ name: "inv006-torn" });
    // Establish the sidecar + marker so the torn journal is the only anomaly.
    await recordTurnOnce(state.stateHome, makeRecord({ providerTurnId: "ptid-clean" }));
    await writeFile(pendingSettlementPath(state.stateHome), "{torn mid-write", "utf8");

    await expect(recordTurnOnce(state.stateHome, makeRecord({ providerTurnId: "ptid-blocked" }))).rejects.toThrow(
      /pending settlement is unreadable/,
    );

    // Fail-closed means NO new row was appended while the ambiguity stands.
    const rows = await readTurnRecords(state.stateHome);
    expect(rows.filter((row) => settlementIdentity(row) === "ptid-blocked")).toHaveLength(0);
  });
});
