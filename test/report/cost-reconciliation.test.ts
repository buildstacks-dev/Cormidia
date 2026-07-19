// Cross-surface cost reconciliation (#88, #89, #90).
//
// One state home, one scope, four surfaces: `operon report`, `operon telemetry`
// (terminal / --json / --html), and the Live Observer projection. They must
// agree on known cost, on the unknown component, and on settlement coverage.
//
// This is the regression test for the buildstacks-site campaign finding: for a
// single completed campaign, Reports said $104.66 with 70/70 settled while the
// Live Observer header said "unavailable" — because each surface re-derived the
// aggregate from a different source with a different collapse rule.
//
// The fixture deliberately contains all five activity classes at once:
//   - complete provider turns          (known cost)
//   - an estimated provider turn       (known, but marked)
//   - a partial provider turn          (known lower bound)
//   - an unavailable provider turn     (genuinely unknown — never zero)
//   - mechanical provision/setup and quality-gates passes (authoritative zero)

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppsFile } from "../../src/org/apps.js";
import { buildReport } from "../../src/report/project.js";
import { projectObserveSnapshot } from "../../src/observe/project.js";
import type { IndexedPass, ObserveProjectionInput } from "../../src/observe/types.js";
import { readStatusRows, type StatusRow } from "../../src/runtime/runlog/status.js";
import { readTurnRecords, type TurnRecord } from "../../src/runtime/telemetry.js";
import { aggregateCost } from "../../src/runtime/cost.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

const NOW = new Date("2026-07-18T12:00:00.000Z");
const DAY = "2026-07-18";

const APPS: AppsFile = {
  org: { name: "fixture-org", maxConcurrentTurns: 2 },
  defaults: { budgetUsdMonth: 1000 },
  apps: [{ name: "alpha", repo: "owner/alpha", status: "live", budgetUsdMonth: 400, cadence: {}, channels: {} }],
};

/** Known cost the fixture is built to produce: 60 + 20 + 2.14 = 82.14. */
const EXPECTED_KNOWN_COST = 82.14;
const EXPECTED_UNKNOWN_TURNS = 1;
const EXPECTED_MECHANICAL_PASSES = 2;

describe("cross-surface cost reconciliation", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("Reports, CLI telemetry, and Observer agree on known cost, unknown turns, and coverage (#89)", async () => {
    home = fixture();

    // --- Reports -----------------------------------------------------------
    const report = await buildReport({
      orgName: "fixture-org",
      stateHome: home.root,
      appsFile: APPS,
      now: NOW,
      query: { app: "alpha", period: "all" },
    });

    // --- Observer ----------------------------------------------------------
    const statusRows = await readStatusRows(home.root, { app: "alpha" });
    const ledger = await readTurnRecords(home.root);
    const snapshot = projectObserveSnapshot({
      ...baseObserveInput(home.root),
      passes: statusRows.map(indexed),
      ledger,
    });

    // --- CLI telemetry -----------------------------------------------------
    // Same primitive, same scoped rows: this is what `operon telemetry` renders
    // as its authoritative total.
    const cliCost = aggregateCost(
      ledger
        .filter((record) => record.app === "alpha")
        .map((record) => ({
          costUsd: record.unmeasured === true ? null : record.costUsd,
          quality: record.unmeasured === true ? "unavailable" : record.usageQuality,
          ref: record.providerTurnId ?? record.runId ?? "unattributed",
        })),
    );

    // --- The reconciliation ------------------------------------------------
    // Known cost survives the unavailable turn on every surface (#90).
    expect(report.headline.cost.known_cost_usd).toBeCloseTo(EXPECTED_KNOWN_COST, 6);
    expect(snapshot.totals.cost.known_cost_usd).toBeCloseTo(EXPECTED_KNOWN_COST, 6);
    expect(cliCost.known_cost_usd).toBeCloseTo(EXPECTED_KNOWN_COST, 6);
    expect(snapshot.apps[0]!.cost.known_cost_usd).toBeCloseTo(EXPECTED_KNOWN_COST, 6);

    // The unknown component is counted identically and never implied to be zero.
    for (const cost of [report.headline.cost, snapshot.totals.cost, cliCost]) {
      expect(cost.unknown_turns).toBe(EXPECTED_UNKNOWN_TURNS);
      expect(cost.coverage).toBe("partial");
      expect(cost.unknown_refs).toEqual(["run-unavailable"]);
    }

    // Mechanical passes are excluded from PROVIDER accounting everywhere (#88):
    // they contribute nothing to known cost, unknown turns, coverage, or
    // settlement — all asserted above and all still identical across surfaces.
    //
    // They are nonetheless REAL passes, and both surfaces must report the same
    // number of them. Neither can see them in the ledger (a mechanical pass
    // settles no row), so both count them from envelope evidence — the Observer
    // via `costForPasses`, Reports via the unsettled envelope scan. An earlier
    // revision of this test accepted 0 on one surface and 2 on the other; that
    // is the one-scope-two-answers shape #89 exists to forbid, so the counts are
    // now pinned equal to each other AND to the fixture's real pass count.
    expect(report.headline.cost.mechanical_passes).toBe(2);
    expect(snapshot.totals.cost.mechanical_passes).toBe(2);
    expect(snapshot.totals.cost.mechanical_passes).toBe(report.headline.cost.mechanical_passes);
    // The count must never leak into provider accounting on either surface —
    // this is what makes counting them safe rather than merely symmetrical.
    expect(snapshot.totals.cost.provider_turns).toBe(report.headline.cost.provider_turns);
    expect(report.headline.cost.known_cost_usd).toBeCloseTo(EXPECTED_KNOWN_COST, 6);
    expect(report.headline.cost.coverage).toBe("partial");
    // estimated + partial + unavailable. The pre-existing "not complete"
    // semantics is preserved; what changed is that the two mechanical passes
    // are no longer counted here (#88).
    expect(snapshot.totals.incomplete_usage_passes).toBe(3);

    // Settlement coverage is disclosed with the total (#89).
    expect(report.headline.cost_scope.settled_provider_turns).toBe(4);
    expect(snapshot.totals.cost_scope.settled_provider_turns).toBe(4);
    expect(snapshot.totals.cost_scope.unsettled_provider_turns).toBe(0);

    // The legacy headline field remains the known subtotal, so old consumers
    // read a floor rather than a collapsed zero.
    expect(report.headline.recorded_equivalent_cost_usd).toBeCloseTo(EXPECTED_KNOWN_COST, 6);
  });

  it("FAILS LOUDLY if two surfaces ever disagree on known cost or coverage (#89)", async () => {
    home = fixture();
    const report = await buildReport({
      orgName: "fixture-org", stateHome: home.root, appsFile: APPS, now: NOW,
      query: { app: "alpha", period: "all" },
    });
    const ledger = await readTurnRecords(home.root);
    const statusRows = await readStatusRows(home.root, { app: "alpha" });
    const snapshot = projectObserveSnapshot({
      ...baseObserveInput(home.root),
      passes: statusRows.map(indexed),
      ledger,
    });

    // Compare the full aggregate objects, not just the headline number — a
    // divergence in coverage, unknown count, or references is just as much a
    // cost-integrity defect as a divergence in the dollar figure.
    const comparable = (cost: { known_cost_usd: number; unknown_turns: number; coverage: string; usage_quality: string; provider_turns: number }) => ({
      known_cost_usd: Number(cost.known_cost_usd.toFixed(6)),
      unknown_turns: cost.unknown_turns,
      coverage: cost.coverage,
      usage_quality: cost.usage_quality,
      provider_turns: cost.provider_turns,
    });
    expect(comparable(snapshot.totals.cost)).toEqual(comparable(report.headline.cost));
  });

  // The case the parity assertion above could NOT exercise: the base fixture
  // pins `unsettled_provider_turns` to 0, so it can only compare two surfaces
  // over a scope where the settlement gap is empty.
  //
  // A provider pass with no settled ledger row used to be counted by the
  // Observer (as an unknown turn) and ignored by Reports (which aggregated
  // settled rows only). For one identical scope that produced coverage
  // "partial" / 1 unknown / N+1 provider turns against "complete" / 0 / N —
  // the divergence #89 exists to make impossible.
  it("an UNSETTLED provider pass is counted identically by both surfaces (#89)", async () => {
    home = fixtureWithUnsettledPass();
    const report = await buildReport({
      orgName: "fixture-org", stateHome: home.root, appsFile: APPS, now: NOW,
      query: { app: "alpha", period: "all" },
    });
    const ledger = await readTurnRecords(home.root);
    const statusRows = await readStatusRows(home.root, { app: "alpha" });
    const snapshot = projectObserveSnapshot({
      ...baseObserveInput(home.root),
      passes: statusRows.map(indexed),
      ledger,
    });

    // The fixture genuinely exercises the gap — without this the assertions
    // below would pass vacuously, exactly as the base fixture's did.
    expect(report.headline.cost_scope.unsettled_provider_turns).toBe(1);
    expect(snapshot.totals.cost_scope.unsettled_provider_turns).toBe(1);
    expect(report.headline.cost_scope.settled_provider_turns).toBe(1);
    expect(snapshot.totals.cost_scope.settled_provider_turns).toBe(1);

    // One settled complete turn plus one unobservable one: two provider turns,
    // one unknown, partial coverage — on BOTH surfaces.
    for (const cost of [report.headline.cost, snapshot.totals.cost]) {
      expect(cost.provider_turns).toBe(2);
      expect(cost.known_turns).toBe(1);
      expect(cost.unknown_turns).toBe(1);
      expect(cost.coverage).toBe("partial");
      expect(cost.known_cost_usd).toBeCloseTo(60, 6);
      // Named under the shared `providerPassRef` identity, so the two surfaces
      // cannot describe the same pass with different references. Sorted only
      // because contribution ORDER is not a claim either surface makes.
      expect([...cost.unknown_refs].sort()).toEqual(["pass:alpha:run-unsettled"]);
    }

    // A scope whose provider turns ALL failed to settle must report
    // "unavailable", never the authoritative zero `aggregateCost([])` returns
    // (invariant 4).
    home.cleanup();
    home = makeOrgHome({ runs: { records: { alpha: {
      "run-only": { envelope: envelope("run-only", { usage: usage(5) }), events: [] },
    } } } });
    const unsettledOnly = await buildReport({
      orgName: "fixture-org", stateHome: home.root, appsFile: APPS, now: NOW,
      query: { app: "alpha", period: "all" },
    });
    expect(unsettledOnly.headline.cost.coverage).toBe("unavailable");
    expect(unsettledOnly.headline.cost.coverage).not.toBe("none");
    expect(unsettledOnly.headline.cost.unknown_turns).toBe(1);
    expect(unsettledOnly.headline.cost.known_cost_usd).toBe(0);
  });

  it("mechanical passes raise no usage-incomplete Attention item (#88)", async () => {
    home = fixture();
    const statusRows = await readStatusRows(home.root, { app: "alpha" });
    const ledger = await readTurnRecords(home.root);
    const snapshot = projectObserveSnapshot({
      ...baseObserveInput(home.root),
      passes: statusRows.map(indexed),
      ledger,
    });

    const usageIncomplete = snapshot.attention.filter((item) => item.kind === "usage_incomplete");
    // Exactly two, and both are genuine provider turns: the unavailable one and
    // the partial one. The two mechanical passes raise nothing — before #88
    // every provision/setup and quality-gates pass produced an identical
    // "Unknown cost is not free" warning (26 of them in the campaign).
    expect(usageIncomplete.map((item) => item.entity_id).sort()).toEqual([
      "pass:alpha:run-partial",
      "pass:alpha:run-unavailable",
    ]);
    for (const item of usageIncomplete) {
      expect(item.entity_id).not.toContain("provision");
      expect(item.entity_id).not.toContain("gates");
    }

    // The mechanical passes are still visible as execution steps.
    const mechanical = snapshot.passes.filter((pass) => pass.usage.quality === "none");
    expect(mechanical.map((pass) => pass.run_id).sort()).toEqual(["run-gates", "run-provision"]);

    // ...and they do not suppress the aggregate.
    expect(snapshot.totals.cost.known_cost_usd).toBeCloseTo(EXPECTED_KNOWN_COST, 6);
    expect(snapshot.totals.usage_quality).not.toBe("none");
  });

  it("classifies mechanical passes as mechanical_pass activity in Reports (#88)", async () => {
    home = fixture();
    const report = await buildReport({
      orgName: "fixture-org", stateHome: home.root, appsFile: APPS, now: NOW,
      query: { app: "alpha", period: "all" },
    });
    const activities = report.session_details.flatMap((detail) => detail.activities);
    const mechanical = activities.filter((turn) => turn.activity_type === "mechanical_pass");
    expect(mechanical.map((turn) => turn.run_id).sort()).toEqual(["run-gates", "run-provision"]);
    // A known zero, not a null — an operator must not go hunting for this cost.
    for (const pass of mechanical) {
      expect(pass.cost_usd).toBe(0);
      expect(pass.usage_quality).toBe("none");
    }
    expect(mechanical).toHaveLength(EXPECTED_MECHANICAL_PASSES);
  });

  it("an entirely unavailable scope reports unavailable, not a false zero (#90)", async () => {
    home = makeOrgHome({ runs: { records: { alpha: {
      "run-a": { envelope: envelope("run-a", { usage: undefined }), events: [] },
    } } } });
    writeLedger(home.root, [
      row("run-a", { costUsd: 0, tokensIn: 0, tokensOut: 0, usageQuality: "unavailable" }),
    ]);
    const report = await buildReport({
      orgName: "fixture-org", stateHome: home.root, appsFile: APPS, now: NOW,
      query: { app: "alpha", period: "all" },
    });
    expect(report.headline.cost.coverage).toBe("unavailable");
    expect(report.headline.cost.known_cost_usd).toBe(0);
    expect(report.headline.cost.unknown_turns).toBe(1);
    // The distinction that matters: a $0 total with coverage "unavailable" is
    // not the same fact as a $0 total with coverage "complete".
    expect(report.headline.cost.coverage).not.toBe("complete");
  });
});

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

function fixture(): OrgHomeFixture {
  const home = makeOrgHome({ runs: { records: { alpha: {
    "run-complete": { envelope: envelope("run-complete", { usage: usage(60) }), events: [] },
    "run-estimated": { envelope: envelope("run-estimated", { role: "reviewer", usage: { ...usage(20), cost_estimated: true, quality: "estimated" } }), events: [] },
    "run-partial": { envelope: envelope("run-partial", { role: "planner", usage: { ...usage(2.14), quality: "partial" } }), events: [] },
    // A genuine provider turn whose usage could not be observed: runtime and
    // model ARE recorded, so it must stay a provider turn with unknown cost.
    "run-unavailable": { envelope: envelope("run-unavailable", { role: "builder", usage: undefined }), events: [] },
    // Two mechanical passes exactly as openPhaseRun writes them: no runtime,
    // no model, and an explicit zero-cost `none` usage record.
    "run-provision": { envelope: mechanicalEnvelope("run-provision", "provision", "setup"), events: [] },
    "run-gates": { envelope: mechanicalEnvelope("run-gates", "gates", "quality-gates"), events: [] },
  } } } });

  writeLedger(home.root, [
    row("run-complete", { costUsd: 60, tokensIn: 1000, tokensOut: 100 }),
    row("run-estimated", { role: "reviewer", costUsd: 20, tokensIn: 500, tokensOut: 50, costEstimated: true, usageQuality: "estimated" }),
    row("run-partial", { role: "planner", costUsd: 2.14, tokensIn: 100, tokensOut: 10, usageQuality: "partial" }),
    row("run-unavailable", { costUsd: 0, tokensIn: 0, tokensOut: 0, usageQuality: "unavailable" }),
    // Deliberately NO rows for run-provision / run-gates: mechanical work
    // creates no provider settlement (docs/PURPOSE.md, efficiency doctrine).
  ]);
  return home;
}

/** One settled provider turn plus one provider pass that never reached the
 *  ledger — the settlement gap the base fixture deliberately does not contain. */
function fixtureWithUnsettledPass(): OrgHomeFixture {
  const home = makeOrgHome({ runs: { records: { alpha: {
    "run-complete": { envelope: envelope("run-complete", { usage: usage(60) }), events: [] },
    // A genuine provider pass: runtime and model ARE recorded and its usage is
    // a real provider usage record. It simply never settled into the ledger.
    "run-unsettled": { envelope: envelope("run-unsettled", { role: "builder", usage: usage(7) }), events: [] },
  } } } });
  writeLedger(home.root, [row("run-complete", { costUsd: 60, tokensIn: 1000, tokensOut: 100 })]);
  return home;
}

function usage(costUsd: number): Record<string, unknown> {
  return { tokens_in: 100, tokens_out: 10, cost_usd: costUsd, quality: "complete" };
}

function envelope(runId: string, patch: Record<string, unknown> = {}): unknown {
  return {
    schema_version: 1, run_id: runId, trace_id: `trace-${runId}`, app: "alpha",
    pipeline: "build", pass: "implement", role: "builder",
    runtime: "codex", model: "model-x", effort: "high", status: "completed",
    started_at: `${DAY}T08:00:00.000Z`, finished_at: `${DAY}T08:01:00.000Z`, wall_clock_ms: 60_000,
    usage: usage(1),
    refs: { events: "events.jsonl", brief: "brief.md", prompt: "prompt.md", output: "output.md" },
    ...patch,
  };
}

/** Mirrors src/loop/loop-runlog.ts openPhaseRun: orchestrator role, no runtime,
 *  no model, explicit zero-cost `none` usage. */
function mechanicalEnvelope(runId: string, pipeline: string, pass: string): unknown {
  return {
    schema_version: 1, run_id: runId, trace_id: `trace-${runId}`, app: "alpha",
    pipeline, pass, role: "orchestrator", status: "completed",
    started_at: `${DAY}T08:02:00.000Z`, finished_at: `${DAY}T08:02:05.000Z`, wall_clock_ms: 5_000,
    usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0, quality: "none" },
    refs: { events: "events.jsonl" },
  };
}

function row(runId: string, patch: Partial<TurnRecord> = {}): TurnRecord {
  return {
    at: `${DAY}T09:00:00.000Z`, role: "builder", runtime: "codex", model: "model-x",
    status: "completed", tokensIn: 0, tokensOut: 0, costUsd: 0, usageQuality: "complete",
    subagentTurns: 0, wallClockMs: 1000, escalations: 0,
    app: "alpha", runId, providerTurnId: runId, pipeline: "build", pass: "implement",
    ...patch,
  };
}

function writeLedger(root: string, rows: TurnRecord[]): void {
  const path = join(root, "telemetry", `${DAY}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

function indexed(row: StatusRow): IndexedPass {
  return {
    row,
    events: [],
    artifacts: {
      envelope: { available: true, size: 100 },
      events: { available: true, size: 0 },
      brief: { available: false, size: 0 },
      prompt: { available: false, size: 0 },
      output: { available: false, size: 0 },
      activity_log: { available: false, size: 0 },
    },
  };
}

function baseObserveInput(stateHome: string): ObserveProjectionInput {
  return {
    now: NOW, cursor: "0", filters: {}, org_name: "fixture-org", state_home: stateHome,
    max_concurrent_turns: 2,
    apps: [{ name: "alpha", repo: "owner/alpha", status: "live", budgetUsdMonth: 400, cadence: {}, channels: {} }],
    passes: [], corrupt_runs: [], parent_tasks: [], parent_task_prompts: {}, corrupt_tasks: [],
    approvals: [], ledger: [], invocations: [], schedule: {}, locks: [], inbox: [], github: [],
    source_health: [],
  };
}
