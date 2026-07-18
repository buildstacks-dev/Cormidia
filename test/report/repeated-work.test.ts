// repeated_work_cost_usd derivation (#92).
//
// The campaign finding: buildstacks-site repeated the W1 build path after an
// interrupted operation, ~$14.62 of duplicated work was plainly visible in the
// run records with fully settled cost, and the metric still returned no valid
// result — because it was gated on EVERY provider row in the episode being
// exactly `complete`, and on the step's own usage snapshot rather than the
// settled ledger.
//
// The fixtures here write execution-step records directly, which is what the
// report reader consumes, so the origin status and settlement of each step can
// be controlled precisely.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executionStepPath,
  routeRecordPath,
  type ExecutionStatus,
  type ExecutionStepRecord,
  type RouteRecord,
} from "../../src/loop/efficiency.js";
import { buildReport } from "../../src/report/project.js";
import type { AppsFile } from "../../src/org/apps.js";
import type { TurnRecord } from "../../src/runtime/telemetry.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

const NOW = new Date("2026-07-18T12:00:00.000Z");
const DAY = "2026-07-18";
const EPISODE = "ticket:alpha:#41";

const APPS: AppsFile = {
  org: { name: "fixture-org", maxConcurrentTurns: 1 },
  defaults: { budgetUsdMonth: 400 },
  apps: [{ name: "alpha", repo: "owner/alpha", status: "live", budgetUsdMonth: 400, cadence: {}, channels: {} }],
};

describe("repeated work cost", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("attributes settled cost of an interrupted-then-repeated build (#92)", async () => {
    // The campaign shape: W1 build starts, is interrupted mid-flight, and the
    // identical input fingerprint is executed again to completion.
    home = scenario([
      step("step-1", { status: "interrupted", errorCode: "error_stale_missing_finalization", fingerprint: "fp-build" }),
      step("step-2", { status: "completed", fingerprint: "fp-build", repeatedFrom: "step-1" }),
      step("step-3", { status: "completed", fingerprint: "fp-review" }),
    ], [
      ledgerRow("step-1", 3.4),
      ledgerRow("step-2", 14.62),
      ledgerRow("step-3", 5.0),
    ]);

    const report = await build(home);
    const episode = report.efficiency.episodes[0]!;

    // Only the repeat is charged as duplicated work — not the interrupted
    // original, whose cost was spent once and is not itself a duplicate.
    expect(episode.repeated_work_cost_usd).toBeCloseTo(14.62, 6);
    expect(report.efficiency.repeated_work_cost_usd).toBeCloseTo(14.62, 6);

    // The calculation is auditable: fingerprint, references, and inputs (#92).
    expect(episode.repeated_work.fingerprint).toBe("execution_step_input_fingerprint/v1");
    expect(episode.repeated_work.considered_provider_steps).toBe(3);
    expect(episode.repeated_work.missing_inputs).toEqual([]);
    expect(episode.repeated_work.repeated_steps).toHaveLength(1);
    expect(episode.repeated_work.repeated_steps[0]).toMatchObject({
      execution_step_id: "step-2",
      repeated_from_step_id: "step-1",
      run_id: "run-step-2",
      origin_status: "interrupted",
      origin_error_code: "error_stale_missing_finalization",
      cause: "recovery_defect",
      cost_usd: 14.62,
    });
  });

  it("distinguishes an orchestration/recovery defect from a legitimate retry (#92)", async () => {
    home = scenario([
      // A pass that failed on its own terms, then was retried: legitimate.
      step("fail-1", { status: "failed", errorCode: "error_gate_failed", fingerprint: "fp-a" }),
      step("fail-2", { status: "completed", fingerprint: "fp-a", repeatedFrom: "fail-1" }),
      // A pass the orchestrator lost and had to redo: a defect.
      step("lost-1", { status: "interrupted", errorCode: "error_stale_missing_finalization", fingerprint: "fp-b" }),
      step("lost-2", { status: "completed", fingerprint: "fp-b", repeatedFrom: "lost-1" }),
    ], [
      ledgerRow("fail-1", 1), ledgerRow("fail-2", 2),
      ledgerRow("lost-1", 3), ledgerRow("lost-2", 4),
    ]);

    const episode = (await build(home)).efficiency.episodes[0]!;
    expect(episode.repeated_work_cost_usd).toBeCloseTo(6, 6);
    expect(episode.repeated_work.retry_cost_usd).toBeCloseTo(2, 6);
    expect(episode.repeated_work.recovery_defect_cost_usd).toBeCloseTo(4, 6);
    expect(
      episode.repeated_work.repeated_steps.map((s) => [s.execution_step_id, s.cause]).sort(),
    ).toEqual([["fail-2", "retry"], ["lost-2", "recovery_defect"]]);
  });

  it("returns a proven zero when no step is a repeat", async () => {
    home = scenario([
      step("a", { status: "completed", fingerprint: "fp-a" }),
      step("b", { status: "completed", fingerprint: "fp-b" }),
    ], [ledgerRow("a", 1), ledgerRow("b", 2)]);

    const episode = (await build(home)).efficiency.episodes[0]!;
    // Zero because the evidence proves no repeated work — not because the
    // measurement failed.
    expect(episode.repeated_work_cost_usd).toBe(0);
    expect(episode.repeated_work.repeated_steps).toEqual([]);
    expect(episode.repeated_work.missing_inputs).toEqual([]);
  });

  it("stays valid when an UNRELATED turn has nonqualifying usage (#92)", async () => {
    // The exact over-strict gate that produced the campaign finding: one
    // estimated turn elsewhere in the episode used to null the whole metric.
    home = scenario([
      step("orig", { status: "interrupted", fingerprint: "fp-x" }),
      step("redo", { status: "completed", fingerprint: "fp-x", repeatedFrom: "orig" }),
      step("other", { status: "completed", fingerprint: "fp-y" }),
    ], [
      ledgerRow("orig", 1),
      ledgerRow("redo", 9.5),
      // Unrelated to the duplication, and deliberately not exact.
      ledgerRow("other", 4, { usageQuality: "estimated", costEstimated: true }),
    ]);

    const episode = (await build(home)).efficiency.episodes[0]!;
    expect(episode.repeated_work_cost_usd).toBeCloseTo(9.5, 6);
    // The episode-wide exactness signal is still reported honestly...
    expect(episode.equivalent_cost_usd).toBeNull();
    expect(episode.issues).toContain("nonqualifying_usage_quality");
    // ...but it no longer invalidates a duplication measurement its own
    // settlements fully support.
    expect(episode.repeated_work.missing_inputs).toEqual([]);
  });

  it("NEAR MISS: unavailable settlement for the REPEAT itself yields unavailable, never zero (#92)", async () => {
    home = scenario([
      step("orig", { status: "interrupted", fingerprint: "fp-x" }),
      step("redo", { status: "completed", fingerprint: "fp-x", repeatedFrom: "orig" }),
    ], [
      ledgerRow("orig", 1),
      // The repeat ran, but its usage could never be observed.
      ledgerRow("redo", 0, { usageQuality: "unavailable" }),
    ]);

    const episode = (await build(home)).efficiency.episodes[0]!;
    expect(episode.repeated_work_cost_usd).toBeNull();
    expect(episode.repeated_work.recovery_defect_cost_usd).toBeNull();
    expect(episode.repeated_work.missing_inputs).toEqual([
      "settled cost missing for repeated execution step redo",
    ]);
    expect(episode.issues).toContain("repeated_work_settlement_missing");
    // And the org roll-up must not silently substitute zero.
    const report = await build(home);
    expect(report.efficiency.repeated_work_cost_usd).toBeNull();
  });

  it("NEAR MISS: a repeat with no ledger settlement at all is unavailable, not free", async () => {
    home = scenario([
      step("orig", { status: "interrupted", fingerprint: "fp-x" }),
      step("redo", { status: "completed", fingerprint: "fp-x", repeatedFrom: "orig" }),
    ], [ledgerRow("orig", 1)]); // no row for `redo`

    const episode = (await build(home)).efficiency.episodes[0]!;
    expect(episode.repeated_work_cost_usd).toBeNull();
    expect(episode.repeated_work.repeated_steps[0]!.cost_usd).toBeNull();
  });

  it("treats a repeat whose origin cannot be read as a recovery defect", async () => {
    // A repeat pointing at a step that no longer exists is the signature of
    // lost work; assuming "legitimate retry" would understate the defect.
    home = scenario([
      step("redo", { status: "completed", fingerprint: "fp-x", repeatedFrom: "vanished-step" }),
    ], [ledgerRow("redo", 7)]);

    const episode = (await build(home)).efficiency.episodes[0]!;
    expect(episode.repeated_work.repeated_steps[0]).toMatchObject({
      cause: "recovery_defect",
      origin_status: null,
      cost_usd: 7,
    });
    expect(episode.repeated_work.recovery_defect_cost_usd).toBeCloseTo(7, 6);
  });

  it("attributes cost from the settled ledger, not the step's own usage snapshot (#89)", async () => {
    // The step snapshot and the ledger deliberately disagree. The ledger is the
    // authority for recorded provider cost.
    home = scenario([
      step("orig", { status: "interrupted", fingerprint: "fp-x" }),
      step("redo", { status: "completed", fingerprint: "fp-x", repeatedFrom: "orig", snapshotCostUsd: 999 }),
    ], [ledgerRow("orig", 1), ledgerRow("redo", 12.25)]);

    const episode = (await build(home)).efficiency.episodes[0]!;
    expect(episode.repeated_work_cost_usd).toBeCloseTo(12.25, 6);
  });
});

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

async function build(home: OrgHomeFixture) {
  return buildReport({
    orgName: "fixture-org",
    stateHome: home.root,
    appsFile: APPS,
    now: NOW,
    query: { app: "alpha", period: "all" },
  });
}

interface StepSpec {
  status: ExecutionStatus;
  fingerprint: string;
  errorCode?: string;
  repeatedFrom?: string;
  snapshotCostUsd?: number;
}

function step(id: string, spec: StepSpec): ExecutionStepRecord {
  return {
    schema_version: 1,
    execution_step_id: id,
    episode_id: EPISODE,
    app: "alpha",
    run_id: `run-${id}`,
    kind: "provider",
    provider_turn_id: id,
    operation: "build/implement",
    role: "builder",
    runtime: "claude",
    model: "claude-test",
    effort: "high",
    started_at: `${DAY}T08:00:00.000Z`,
    finished_at: `${DAY}T08:05:00.000Z`,
    status: spec.status,
    error_code: spec.errorCode ?? null,
    reason: `${spec.status} step`,
    next_step: null,
    context_manifest_ref: null,
    input_fingerprint: spec.fingerprint,
    work_fingerprint_before: null,
    work_fingerprint_after: null,
    artifact_fingerprint: null,
    productive: spec.repeatedFrom === undefined,
    repeated_from_step_id: spec.repeatedFrom ?? null,
    tool_call_count: 0,
    usage: spec.snapshotCostUsd === undefined
      ? null
      : { tokensIn: 1, tokensOut: 1, costUsd: spec.snapshotCostUsd, subagentTurns: 0, wallClockMs: 1, quality: "complete" },
  };
}

function ledgerRow(providerTurnId: string, costUsd: number, patch: Partial<TurnRecord> = {}): TurnRecord {
  return {
    at: `${DAY}T09:00:00.000Z`,
    role: "builder", runtime: "claude", model: "claude-test", status: "completed",
    tokensIn: 100, tokensOut: 10, costUsd, usageQuality: "complete",
    subagentTurns: 0, wallClockMs: 1000, escalations: 0,
    app: "alpha", runId: `run-${providerTurnId}`, providerTurnId,
    episodeId: EPISODE, executionStepId: providerTurnId,
    pipeline: "build", pass: "implement",
    ...patch,
  };
}

function route(): RouteRecord {
  return {
    schema_version: 1,
    episode_id: EPISODE,
    app: "alpha",
    policy_version: "test/v1",
    admitted_at: `${DAY}T07:59:00.000Z`,
    planned_route: "standard",
    current_route: "standard",
    final_route: "standard",
    factors: [],
    authorized_passes: [],
    budget: { provider_turns: 10, input_tokens: 1_000_000, equivalent_cost_usd: 100, active_time_ms: 3_600_000, human_decisions: null },
    execution_bounds: null,
    reassessments: [],
    terminal: { status: "completed", at: `${DAY}T08:30:00.000Z`, reason: "done", final_route: "standard", next_step: null },
  };
}

function scenario(steps: ExecutionStepRecord[], rows: TurnRecord[]): OrgHomeFixture {
  const records: Record<string, { envelope: unknown; events: never[] }> = {};
  for (const record of steps) {
    records[record.run_id] = { envelope: envelopeFor(record), events: [] };
  }
  const home = makeOrgHome({ runs: { records: { alpha: records } } });

  writeJson(routeRecordPath(home.root, EPISODE), route());
  for (const record of steps) {
    writeJson(executionStepPath(home.root, EPISODE, record.execution_step_id), record);
  }
  const ledgerPath = join(home.root, "telemetry", `${DAY}.jsonl`);
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return home;
}

function envelopeFor(record: ExecutionStepRecord): unknown {
  return {
    schema_version: 1, run_id: record.run_id, trace_id: "trace-1", app: "alpha",
    episode_id: EPISODE, ticket: "#41",
    pipeline: "build", pass: "implement", role: "builder",
    runtime: "claude", model: "claude-test", effort: "high",
    status: record.status === "completed" ? "completed" : "failed",
    started_at: record.started_at, finished_at: record.finished_at, wall_clock_ms: 300_000,
    usage: { tokens_in: 100, tokens_out: 10, cost_usd: 1, quality: "complete" },
    execution_step_ids: [record.execution_step_id],
    provider_turn_ids: [record.provider_turn_id],
    refs: { events: "events.jsonl" },
  };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}
