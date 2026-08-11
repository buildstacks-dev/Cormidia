// Traceability: CF-S2-traj · HB-046 · llm-eval-plan.md §2 S-2 trajectory envelope.

// HB-046 — deterministic S-2 trajectory assertions. These are detector
// checks over ratified grounds only. The PROPOSED repeat-loop N=3 threshold
// remains observation-only and is intentionally not encoded as a verdict.

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzeRunlogs, detectRunAnomalies, type RunEvidence } from "../../../src/runtime/runlog/anomalies.js";
import type { RunlogEvent } from "../../../src/runtime/runlog/events.js";
import type { RunEnvelope } from "../../../src/runtime/runlog/envelope.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const homes: TempStateHome[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(homes.splice(0).map((home) => home.cleanup()));
});

function envelope(overrides: Partial<RunEnvelope> = {}): RunEnvelope {
  return {
    schema_version: 1,
    run_id: "run-1",
    trace_id: "trace-1",
    app: "app",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    model: "model",
    status: "completed",
    started_at: "2026-07-31T12:00:00.000Z",
    finished_at: "2026-07-31T12:06:00.000Z",
    wall_clock_ms: 360_000,
    usage: { tokens_in: 400, tokens_out: 200, cost_usd: 1, quality: "complete" },
    tool_counts: { bash: 20 },
    refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
    ...overrides,
  };
}

function toolEvent(index: number, category?: string): RunlogEvent {
  return {
    trace_id: "trace-1",
    span_id: "span-1",
    app: "app",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    ts: new Date(Date.parse("2026-07-31T12:00:00.000Z") + index).toISOString(),
    event: "tool.called",
    severity: "info",
    detail: { tool: "bash", args_hash: "same", ...(category === undefined ? {} : { category }) },
  };
}

async function persist(home: TempStateHome, value: RunEnvelope): Promise<void> {
  const dir = join(home.stateHome, "runs", value.app, value.run_id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "envelope.json"), JSON.stringify(value) + "\n", "utf8");
}

describe("HB-046 builder trajectory detectors", () => {
  it("fires all four per-run documented anomaly detectors and reports their observed metrics", () => {
    const run: RunEvidence = {
      envelope: envelope(),
      events: [toolEvent(1, "environment_retry"), toolEvent(2, "environment_retry"), toolEvent(3, "environment_retry")],
    };
    const anomalies = detectRunAnomalies(run);
    expect(anomalies.map((row) => row.flag).sort()).toEqual([
      "bash_heavy",
      "environment_retry",
      "low_tokens_high_time",
      "single_turn_long_run",
    ]);
    expect(anomalies.map((row) => row.detail)).toEqual(
      expect.arrayContaining([
        "360s with 600 tokens",
        "360s single pass",
        "20 bash calls",
        "3 environment retry events",
      ]),
    );
  });

  it("fires the fifth documented detector for a same-model cold-cache miss inside the TTL", async () => {
    const home = await makeTempStateHome({ name: "trajectory" });
    homes.push(home);
    await persist(
      home,
      envelope({
        run_id: "pass-1",
        pass: "contract",
        started_at: "2026-07-31T12:00:00.000Z",
        wall_clock_ms: 1_000,
        tool_counts: {},
        usage: { tokens_in: 10, tokens_out: 10, cost_usd: 0.1, cache_read_tokens: 5 },
      }),
    );
    await persist(
      home,
      envelope({
        run_id: "pass-2",
        pass: "implement",
        started_at: "2026-07-31T12:04:59.000Z",
        wall_clock_ms: 1_000,
        tool_counts: {},
        usage: { tokens_in: 10, tokens_out: 10, cost_usd: 0.1, cache_read_tokens: 0 },
      }),
    );
    const anomalies = await analyzeRunlogs(home.stateHome);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({ flag: "cold_cache", runId: "pass-2" });
  });

  it("keeps exact non-trigger boundaries green and does not promote the provisional repeat-loop N=3 hypothesis", () => {
    const repeated = [toolEvent(1), toolEvent(2), toolEvent(3)];
    const anomalies = detectRunAnomalies({
      envelope: envelope({
        wall_clock_ms: 300_000,
        usage: { tokens_in: 500, tokens_out: 500, cost_usd: 1 },
        tool_counts: { bash: 19 },
      }),
      events: repeated,
    });
    expect(anomalies).toEqual([]);
  });

  it("separates stale-running/missing-finalization escalation from merit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:10:00.000Z"));
    const running = envelope({
      status: "running",
      started_at: "2026-07-31T12:00:00.000Z",
      last_seen_at: "2026-07-31T12:05:00.000Z",
      wall_clock_ms: 0,
      tool_counts: {},
    });
    delete running.finished_at;
    delete running.usage;
    const anomalies = detectRunAnomalies({
      envelope: running,
      events: [],
    });
    expect(anomalies.map((row) => row.flag).sort()).toEqual(["missing_finalization", "stale_running"]);
    expect(anomalies.every((row) => row.recommendation.length > 0)).toBe(true);
  });
});
