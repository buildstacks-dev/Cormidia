import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  EFFICIENCY_ERROR_CLASSES,
  clusterEfficiencyEvidence,
  projectEfficiencyEvidence,
  type EfficiencyActionSummary,
  type EfficiencyRunEvidence,
} from "../../src/org/learning/efficiency-evidence.js";
import { projectCaptureEvents } from "../../src/org/learning/capture.js";
import { readLearningEvents } from "../../src/org/learning/events.js";
import type { RunEnvelope } from "../../src/runtime/runlog/envelope.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

const fixture = fileURLToPath(new URL("../fixtures/historical/2026-07-12-buildstacks-class", import.meta.url));
const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

interface HistoricalRun {
  run_id: string;
  status: RunEnvelope["status"];
  role: string;
  runtime: RunEnvelope["runtime"] | null;
  model: string | null;
  started_at: string;
  finished_at: string | null;
  pipeline: string;
  pass: string;
  usage: { tokens_in: number; tokens_out: number; cost_usd: number | null; quality: "complete" | "partial" | "estimated" } | null;
  artifact_fingerprint?: string;
}
interface HistoricalApproval { id: string; classification: "false_positive" | "valid" }

function historicalProjection() {
  const rows = JSON.parse(readFileSync(`${fixture}/runs.json`, "utf8")) as HistoricalRun[];
  const actions = new Map(
    (JSON.parse(readFileSync(`${fixture}/actions.json`, "utf8")) as EfficiencyActionSummary[])
      .map((row) => [row.run_id, row]),
  );
  const runs: EfficiencyRunEvidence[] = rows.map((row) => ({
    kind: row.runtime === null ? "mechanical" : "provider",
    envelope: {
      schema_version: 1,
      run_id: row.run_id,
      trace_id: `trace-${row.run_id}`,
      episode_id: `ep-alpha-${row.run_id}`,
      app: "alpha",
      pipeline: row.pipeline,
      pass: row.pass,
      role: row.role,
      ...(row.runtime !== null ? { runtime: row.runtime! } : {}),
      ...(row.model !== null ? { model: row.model } : {}),
      status: row.status,
      started_at: row.started_at,
      ...(row.finished_at !== null ? { finished_at: row.finished_at } : {}),
      ...(row.usage !== null && row.usage.cost_usd !== null
        ? { usage: {
            tokens_in: row.usage.tokens_in,
            tokens_out: row.usage.tokens_out,
            cost_usd: row.usage.cost_usd,
            quality: row.usage.quality,
          } }
        : {}),
      refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
    },
    ...(actions.has(row.run_id) ? { action: actions.get(row.run_id)! } : {}),
    ...(row.artifact_fingerprint !== undefined ? { artifact_fingerprint: row.artifact_fingerprint } : {}),
    admitted_budget_usd: 8,
  }));
  // The checksummed archive's stale row is mechanical and must not masquerade
  // as provider evidence. A copied in-memory provider receipt exercises the
  // same stale class without mutating the fixture.
  const stale = rows.find((row) => row.status === "running")!;
  runs.push({
    kind: "provider",
    envelope: {
      schema_version: 1,
      run_id: "provider-stale-copy",
      trace_id: "trace-provider-stale-copy",
      episode_id: "ep-alpha-provider-stale-copy",
      app: "alpha",
      pipeline: "build",
      pass: "implement",
      role: "builder",
      runtime: "codex",
      model: "fixture",
      status: "running",
      started_at: stale.started_at,
      refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
    },
  });
  const approvals = (JSON.parse(readFileSync(`${fixture}/approvals.json`, "utf8")) as HistoricalApproval[])
    .map((row, index) => ({
      id: row.id,
      app: "alpha",
      episode_id: `ep-alpha-approval-${index}`,
      role: "builder",
      ts: "2026-07-11T12:00:00.000Z",
      classification: row.classification,
    }));
  return projectEfficiencyEvidence({ runs, approvals });
}

function makeComparable(events: ReturnType<typeof historicalProjection>) {
  const count = new Map<string, number>();
  for (const event of events) count.set(event.error_class!, (count.get(event.error_class!) ?? 0) + 1);
  return [...events, ...events
    .filter((event) => count.get(event.error_class!) === 1)
    .map((event) => ({
      ...event,
      event_id: `${event.event_id}_pair2`,
      episode_id: `${event.episode_id}_pair2`,
      run_id: event.run_id === undefined ? undefined : `${event.run_id}_pair2`,
      payload: {
        ...event.payload,
        source_identity: `${String(event.payload?.["source_identity"])}:pair2`,
      },
    }))];
}

describe("LEARNING-CLOSURE-001 production efficiency capture and recurrence", () => {
  it("maps authoritative historical records to stable typed classes and excludes mechanical execution", () => {
    const events = historicalProjection();
    const classes = new Set(events.map((event) => event.error_class));
    for (const errorClass of [
      "execution.cancelled",
      "execution.stale_finalization",
      "execution.missing_finalization",
      "review.long_duration",
      "route.budget_overrun",
      "execution.repeated_work",
      "environment.retry_cluster",
      "tooling.shell_heavy_repetition",
      "approval.false_positive",
    ]) expect(classes.has(errorClass), errorClass).toBe(true);
    expect(events.some((event) => event.run_id === "run-gate-stale")).toBe(false);
    expect(new Set(EFFICIENCY_ERROR_CLASSES).has("scheduler.missed_tick")).toBe(true);
  });

  it("forms stable role/app-scoped recurrence and retains honest singletons", () => {
    const events = makeComparable(historicalProjection());
    const first = clusterEfficiencyEvidence(events, 2);
    const second = clusterEfficiencyEvidence([...events].reverse(), 2);
    expect(second).toEqual(first);
    expect(first.clusters.length).toBeGreaterThanOrEqual(9);
    expect(first.clusters.every((cluster) => cluster.event_ids.length >= 2)).toBe(true);

    const crossRole = events.slice(0, 2).map((event, index) => ({
      ...event,
      event_id: `evt-cross-role-${index}`,
      agent_role: index === 0 ? "builder" : "reviewer",
      payload: { ...event.payload, source_identity: `cross-role-${index}` },
    }));
    const nearMiss = clusterEfficiencyEvidence(crossRole, 2);
    expect(nearMiss.clusters).toEqual([]);
    expect(nearMiss.dispositions.every((item) => item.disposition === "awaiting_evidence")).toBe(true);
  });

  it("projects each finalized provider run exactly once and names stale/corrupt blockers", async () => {
    const state = makeOrgHome({
      runs: {
        records: {
          alpha: {
            "20260712-100000-build-implement": {
              envelope: {
                schema_version: 1,
                run_id: "20260712-100000-build-implement",
                trace_id: "trace-1",
                app: "alpha",
                pipeline: "build",
                pass: "implement",
                role: "builder",
                runtime: "codex",
                model: "fixture",
                status: "cancelled",
                started_at: "2026-07-12T10:00:00.000Z",
                finished_at: "2026-07-12T10:01:00.000Z",
                refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
              },
              events: [],
            },
          },
        },
      },
    });
    cleanup.push(state.cleanup);
    const first = await projectCaptureEvents({ stateHome: state.root });
    const bytes = JSON.stringify(await readLearningEvents(state.root));
    const second = await projectCaptureEvents({ stateHome: state.root });
    expect(first).toMatchObject({ eligibleFinalizedRuns: 1, projectedExactlyOnce: 1, duplicateProjections: 0 });
    expect(second).toMatchObject({ eligibleFinalizedRuns: 1, projectedExactlyOnce: 1, runsAlreadyProjected: 1 });
    expect(JSON.stringify(await readLearningEvents(state.root))).toBe(bytes);
  });
});
// Phase 4 production evidence contracts: H-CAP-01, H-CAP-02, H-CLU-01.
