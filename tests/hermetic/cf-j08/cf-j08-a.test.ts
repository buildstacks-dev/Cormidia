// CF-J08-A — telemetry/report/budget readers agree over one ledger corpus;
// day-files are never swept while re-settlement is possible (HB-020).
//
// Design: case-catalog §1 CF-J08-A (oracle: evid, risk E3); invariants.md
// CORMIDIA-INV-006 ("the ledger is the sole durable spend fact; overlays and
// reports derive from it and never replace it"; "unknown usage never rendered
// as zero"); system-map §2.2 cost-ledger row. Readers under test, all real:
//   - readTurnRecords (src/runtime/telemetry.ts) — the telemetry CLI's ledger
//     authority (src/cli/telemetry.ts);
//   - readLedgerRange (src/report/ledger-source.ts) — the Reports source;
//   - rollupBudgets (src/org/budget.ts) — budget enforcement's month rollup;
//   - aggregateCost (src/runtime/cost.ts) — the ONE aggregation primitive all
//     presentation surfaces project through, fed with the exact contribution
//     mapping src/cli/telemetry.ts uses.
// Sweep leg: sweepStateRetention (src/org/retention.ts) must keep an aged
// ledger day-file while ANY of its rows is still re-settleable from surviving
// evidence, and converge (prune) one sweep after the evidence is gone.

import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { appendFile } from "node:fs/promises";
import type { AppsFile } from "../../../src/org/apps.js";
import { isBudgetBlocking, reconcileLedger, rollupBudgets } from "../../../src/org/budget.js";
import { DEFAULT_STATE_RETENTION, sweepStateRetention, type StateRetentionPolicy } from "../../../src/org/retention.js";
import { finalizeEpisode } from "../../../src/loop/efficiency.js";
import { readLedgerRange } from "../../../src/report/ledger-source.js";
import { aggregateCost, formatCostAggregate } from "../../../src/runtime/cost.js";
import { readTurnRecords, recordTurnOnce, settlementIdentity, settlementKey } from "../../../src/runtime/telemetry.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import {
  admitTestEpisode,
  executorSettlement,
  makeRole,
  makeTurnResult,
  makeUsage,
  plantProviderStep,
} from "./settlement-fixtures.js";
import { beginProviderStep } from "../../../src/loop/efficiency.js";

const AT = new Date("2026-07-20T12:00:00.000Z");
const APP_A = "reader-app-a";
const APP_B = "reader-app-b";

const APPS: AppsFile = {
  org: { name: "cf-j08-a", maxConcurrentTurns: 1 },
  defaults: { budgetUsdMonth: 100, objectiveBudgetUsd: 1000 },
  apps: [
    {
      name: APP_A,
      repo: "cormidia-double/unused",
      status: "live",
      budgetUsdMonth: 100,
      objectiveBudgetUsd: 1000,
      cadence: {},
    },
    {
      name: APP_B,
      repo: "cormidia-double/unused",
      status: "live",
      budgetUsdMonth: 100,
      objectiveBudgetUsd: 1000,
      cadence: {},
    },
  ],
};

/** Small all-minimum policy: effectiveRetentionWindows clamps the telemetry
 *  window to max(runs, efficiency) + RECONCILE_MARGIN_DAYS = 3 days, so a
 *  July day-file is well outside the window at an August `now`. */
const TIGHT_POLICY: StateRetentionPolicy = {
  ...DEFAULT_STATE_RETENTION,
  runsDays: 1,
  telemetryDays: 1,
  efficiencyEpisodeDays: 1,
};

const SWEEP_NOW = new Date("2026-08-15T12:00:00.000Z");

describe("CF-J08-A — telemetry/report/budget readers agree; day-files never swept while re-settlement possible (L2, evid)", () => {
  let state: TempStateHome;

  afterEach(async () => {
    await state.cleanup();
  });

  it("one settled corpus, four readers, one answer — and the unknown component is counted, named, and never rendered as zero", async () => {
    state = await makeTempStateHome({ name: "cf-j08-a-readers" });
    // Corpus: complete + estimated on app A; unavailable + complete on app B.
    const settles = [
      {
        app: APP_A,
        runId: "20260720-000001-build-implement",
        ptid: "ptid-a1",
        result: makeTurnResult("completed", makeUsage(0.4)),
      },
      {
        app: APP_A,
        runId: "20260720-000002-build-implement",
        ptid: "ptid-a2",
        result: makeTurnResult("completed", {
          tokensIn: 500,
          tokensOut: 50,
          costUsd: 0.25,
          costEstimated: true,
          subagentTurns: 0,
          wallClockMs: 800,
        }),
      },
      {
        app: APP_B,
        runId: "20260720-000003-build-implement",
        ptid: "ptid-b1",
        result: makeTurnResult("failed", makeUsage(0, { quality: "unavailable" }), {
          errorCode: "error_provider_failure",
        }),
      },
      {
        app: APP_B,
        runId: "20260720-000004-build-implement",
        ptid: "ptid-b2",
        result: makeTurnResult("completed", makeUsage(1.0)),
      },
    ];
    for (const settle of settles) {
      expect(
        await recordTurnOnce(
          state.stateHome,
          executorSettlement({
            result: settle.result,
            at: AT,
            app: settle.app,
            runId: settle.runId,
            providerTurnId: settle.ptid,
          }),
        ),
      ).toBe(true);
    }
    await assertNonEmptyWalk(state.path("telemetry"), /\.jsonl$/);

    // Reader 1: the telemetry ledger authority.
    const ledger = await readTurnRecords(state.stateHome);
    expect(ledger).toHaveLength(4);

    // Reader 2: the report range source reads the SAME rows with zero
    // diagnostics — same corpus, same count, same identities.
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
      AT,
    );
    expect(range.diagnostics).toEqual([]);
    expect(range.rows.map((row) => settlementIdentity(row.record)).sort()).toEqual(
      ledger.map((row) => settlementIdentity(row)).sort(),
    );

    // Reader 3: budget's month rollup — estimated spend counts (an estimate
    // beats a silent $0); the unavailable turn's honest costUsd 0 adds none.
    const budget = await rollupBudgets(state.stateHome, APPS, AT);
    expect(budget.find((row) => row.app === APP_A)?.spentUsd).toBeCloseTo(0.65, 6);
    expect(budget.find((row) => row.app === APP_B)?.spentUsd).toBeCloseTo(1.0, 6);

    // Reader 4: the one aggregation primitive, fed exactly the contribution
    // mapping src/cli/telemetry.ts uses over these rows.
    const aggregate = aggregateCost(
      ledger.map((record) => ({
        costUsd: record.unmeasured === true ? null : record.costUsd,
        quality: record.unmeasured === true ? "unavailable" : record.usageQuality,
        ref: settlementIdentity(record) ?? "unattributed",
      })),
    );
    expect(aggregate.provider_turns).toBe(4);
    expect(aggregate.known_turns).toBe(3);
    expect(aggregate.known_cost_usd).toBeCloseTo(1.65, 6); // == budget's 0.65 + 1.00
    expect(aggregate.unknown_turns).toBe(1);
    expect(aggregate.unknown_refs).toEqual(["ptid-b1"]); // named for drill-down
    expect(aggregate.coverage).toBe("partial");
    // The rendered form discloses the unknown component — never a bare $0.
    expect(formatCostAggregate(aggregate)).toContain("recorded + 1 unknown");
  });

  it("negative control: a malformed costUsd row seeded through the raw ledger bypass drives budget to fail CLOSED (unknown = blocking), never to 'ok'", async () => {
    state = await makeTempStateHome({ name: "cf-j08-a-neg-row" });
    await recordTurnOnce(
      state.stateHome,
      executorSettlement({
        result: makeTurnResult("completed", makeUsage(0.4)),
        at: AT,
        app: APP_A,
        runId: "20260720-001000-build-implement",
        providerTurnId: "ptid-good",
      }),
    );
    // Seeded violation: a parseable row whose costUsd is not a finite number.
    // No product writer emits this — the raw append is the only way in.
    await appendFile(
      state.path("telemetry", "2026-07-20.jsonl"),
      `${JSON.stringify({ at: AT.toISOString(), role: "builder", runtime: "claude", model: "m", status: "completed", tokensIn: 1, tokensOut: 1, costUsd: "not-a-number", usageQuality: "complete", subagentTurns: 0, wallClockMs: 1, escalations: 0, app: APP_A, runId: "20260720-001001-build-implement" })}\n`,
      "utf8",
    );
    const budget = await rollupBudgets(state.stateHome, APPS, AT);
    const rowA = budget.find((row) => row.app === APP_A)!;
    expect(rowA.status).toBe("unknown"); // the detector FIRES: fail closed
    expect(isBudgetBlocking(rowA.status)).toBe(true); // blocks like exceeded, never ok
  });

  it("an aged day-file whose row is still re-settleable from a surviving provider receipt is KEPT by the sweep", async () => {
    state = await makeTempStateHome({ name: "cf-j08-a-keep" });
    const episodeId = `ticket:${APP_A}:#700`;
    const runId = "20260720-002000-build-implement";
    await admitTestEpisode({ stateHome: state.stateHome, episodeId, app: APP_A, now: AT });
    // A pending started receipt — provider work whose settlement evidence is
    // still live — whose key is already in the aged day-file (the durable
    // state a crash inside the finalize/settle transaction leaves behind).
    const started = await beginProviderStep({
      root: state.stateHome,
      episodeId,
      app: APP_A,
      runId,
      ordinal: 1,
      operation: "build/implement",
      role: makeRole(),
      inputFingerprint: `fp-${runId}-1`,
      now: AT,
    });
    await recordTurnOnce(
      state.stateHome,
      executorSettlement({
        result: makeTurnResult("completed", makeUsage(0.5)),
        at: AT,
        app: APP_A,
        runId,
        providerTurnId: started.providerTurnId,
        episodeId,
      }),
    );
    const dayFile = state.path("telemetry", "2026-07-20.jsonl");
    expect(existsSync(dayFile)).toBe(true);

    const sweep = await sweepStateRetention(state.stateHome, SWEEP_NOW, TIGHT_POLICY);
    expect(sweep.errors).toEqual([]);
    // The day-file is far outside the (clamped 3-day) window and in a past
    // month — age alone would prune it. Reconcilability keeps it.
    expect(existsSync(dayFile)).toBe(true);
    expect(sweep.telemetry.pruned).toBe(0);
    expect(sweep.telemetry.kept).toBeGreaterThanOrEqual(1);
    // The episode holding the receipt is kept too (in flight / unreconciled).
    expect(sweep.efficiency_episodes.pruned).toBe(0);
  });

  it("negative control: deleting that day-file behind the sweep's back makes reconcile re-pay the already-settled turn — the re-settlement detector FIRES, proving the keep-rule is load-bearing", async () => {
    state = await makeTempStateHome({ name: "cf-j08-a-neg-sweep" });
    const episodeId = `ticket:${APP_A}:#701`;
    const runId = "20260720-003000-build-implement";
    await admitTestEpisode({ stateHome: state.stateHome, episodeId, app: APP_A, now: AT });
    const started = await beginProviderStep({
      root: state.stateHome,
      episodeId,
      app: APP_A,
      runId,
      ordinal: 1,
      operation: "build/implement",
      role: makeRole(),
      inputFingerprint: `fp-${runId}-1`,
      now: AT,
    });
    await recordTurnOnce(
      state.stateHome,
      executorSettlement({
        result: makeTurnResult("completed", makeUsage(0.5)),
        at: AT,
        app: APP_A,
        runId,
        providerTurnId: started.providerTurnId,
        episodeId,
      }),
    );
    const paidKey = settlementKey(APP_A, started.providerTurnId);

    // Seeded violation: the day-file vanishes while the receipt survives —
    // exactly what the sweep's reconcilable-source check forbids. The sidecar
    // index must go with it (an operator wipe/restore takes the whole store);
    // leaving it would mask the violation this control exists to surface.
    await rm(state.path("telemetry", "2026-07-20.jsonl"), { force: true });
    await rm(state.path("telemetry-index"), { recursive: true, force: true });

    const reconciled = await reconcileLedger(state.stateHome, {}, SWEEP_NOW);
    // The detector: an already-paid key settles AGAIN, re-dated to today —
    // the double-pay the keep-rule exists to prevent.
    expect(reconciled.settled).toBe(1);
    const rows = await readTurnRecords(state.stateHome);
    expect(rows.filter((row) => settlementKey(row.app, settlementIdentity(row)!) === paidKey)).toHaveLength(1);
    expect(rows[0]!.at.slice(0, 10)).toBe("2026-08-15"); // re-dated: July spend now counts against August
  });

  it("convergence: once the evidence is terminal, settled, and aged out, the same sweep prunes evidence first and the day-file after it — never before", async () => {
    state = await makeTempStateHome({ name: "cf-j08-a-converge" });
    const episodeId = `ticket:${APP_A}:#702`;
    const runId = "20260720-004000-build-implement";
    const result = makeTurnResult("completed", makeUsage(0.5));
    await admitTestEpisode({ stateHome: state.stateHome, episodeId, app: APP_A, now: AT });
    const planted = await plantProviderStep({
      stateHome: state.stateHome,
      episodeId,
      app: APP_A,
      runId,
      result,
      startedAt: AT,
      finishedAt: AT,
    });
    await recordTurnOnce(
      state.stateHome,
      executorSettlement({
        result,
        at: AT,
        app: APP_A,
        runId,
        providerTurnId: planted.providerTurnId,
        executionStepId: planted.executionStepId,
        episodeId,
      }),
    );
    await finalizeEpisode({
      root: state.stateHome,
      episodeId,
      status: "completed",
      reason: "cf-j08-a convergence fixture complete",
      now: AT,
    });
    const dayFile = state.path("telemetry", "2026-07-20.jsonl");
    const episodeWalk = state.path("efficiency", "episodes");
    await assertNonEmptyWalk(episodeWalk); // evidence exists before the sweep

    const sweep = await sweepStateRetention(state.stateHome, SWEEP_NOW, TIGHT_POLICY);
    expect(sweep.errors).toEqual([]);
    // Evidence subtrees are swept before the ledger in the same pass: the
    // proven-terminal, fully settled, aged episode goes, and with no
    // surviving re-settlement source the aged day-file follows.
    expect(sweep.efficiency_episodes.pruned).toBe(1);
    expect(sweep.telemetry.pruned).toBe(1);
    expect(existsSync(dayFile)).toBe(false);
  });
});
