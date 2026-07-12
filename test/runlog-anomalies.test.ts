// Tests runlog anomaly detection and the analyze CLI.
// Covers explicit threshold boundaries, clean runs, adjacent-pass cold-cache
// detection, and formatted CLI recommendations.
// Uses seeded temp runlog records and mocked console output; no network, auth,
// real org state, or live wall clock is required.

import { describe, expect, it, vi } from "vitest";
import { cmdAnalyze } from "../src/cli/analyze.js";
import { analyzeRunlogs, detectRunAnomalies } from "../src/runtime/runlog/anomalies.js";
import type { RunEnvelope } from "../src/runtime/runlog/envelope.js";
import type { RunlogEvent } from "../src/runtime/runlog/events.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

function envelope(overrides: Partial<RunEnvelope>): RunEnvelope {
  return {
    schema_version: 1,
    run_id: "run",
    trace_id: "turn",
    app: "alpha",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    model: "m",
    status: "completed",
    started_at: "2026-07-04T10:00:00Z",
    finished_at: "2026-07-04T10:00:00Z",
    wall_clock_ms: 0,
    refs: { events: "events.jsonl", brief: "brief.md", output: "output.md", session_log: "session.log" },
    ...overrides,
  };
}

function event(category?: string): RunlogEvent {
  return {
    ts: "2026-07-04T10:00:00Z",
    trace_id: "turn",
    span_id: "implement",
    app: "alpha",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    event: "tool.called",
    severity: "info",
    detail: category === undefined ? { tool: "bash" } : { tool: "bash", category },
  };
}

describe("runlog anomaly detectors", () => {
  it("flags a running envelope whose heartbeat is stale even without final wall-clock usage", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T20:00:00Z"));
    try {
      const flags = detectRunAnomalies({
        envelope: envelope({
          status: "running",
          started_at: "2026-07-11T19:00:00Z",
          last_seen_at: "2026-07-11T19:05:00Z",
          finished_at: undefined,
          wall_clock_ms: undefined,
          usage: undefined,
        }),
        events: [],
      }).map((flag) => flag.flag);

      expect(flags).toContain("stale_running");
      expect(flags).toContain("missing_finalization");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fires explicit thresholds at the documented boundary and not before", () => {
    expect(
      detectRunAnomalies({
        envelope: envelope({ wall_clock_ms: 300_000, usage: { tokens_in: 999, tokens_out: 0, cost_usd: 0 }, tool_counts: { bash: 19 } }),
        events: [event("environment_retry"), event("environment_retry")],
      }).map((flag) => flag.flag),
    ).toEqual([]);

    const flags = detectRunAnomalies({
      envelope: envelope({ wall_clock_ms: 300_001, usage: { tokens_in: 999, tokens_out: 0, cost_usd: 0 }, tool_counts: { bash: 20 } }),
      events: [event("environment_retry"), event("environment_retry"), event("environment_retry")],
    }).map((flag) => flag.flag);
    expect(flags).toEqual(["low_tokens_high_time", "single_turn_long_run", "bash_heavy", "environment_retry"]);
  });

  it("clean run has zero flags", () => {
    expect(
      detectRunAnomalies({
        envelope: envelope({ wall_clock_ms: 10_000, usage: { tokens_in: 1000, tokens_out: 500, cost_usd: 0.1 }, tool_counts: { bash: 2 } }),
        events: [],
      }),
    ).toEqual([]);
  });

  it("cold_cache fires only for adjacent same-pipeline pass inside TTL with cache counters", async () => {
    const home = makeOrgHome({
      runs: {
        records: {
          alpha: {
            first: {
              envelope: envelope({
                run_id: "first",
                pass: "contract",
                started_at: "2026-07-04T10:00:00Z",
                usage: { tokens_in: 100, tokens_out: 10, cost_usd: 0.1, cache_read_tokens: 50 },
              }),
              events: [],
            },
            second: {
              envelope: envelope({
                run_id: "second",
                pass: "implement",
                started_at: "2026-07-04T10:04:59Z",
                usage: { tokens_in: 100, tokens_out: 10, cost_usd: 0.1, cache_read_tokens: 0 },
              }),
              events: [],
            },
          },
        },
      },
    });
    try {
      const flags = await analyzeRunlogs(home.root);
      expect(flags.map((flag) => flag.flag)).toContain("cold_cache");
    } finally {
      home.cleanup();
    }
  });

  it("CLI prints one flag and recommendation", async () => {
    const home = makeOrgHome({
      runs: {
        records: {
          alpha: {
            stuck: {
              envelope: envelope({
                run_id: "stuck",
                wall_clock_ms: 10_000,
                usage: { tokens_in: 10, tokens_out: 5, cost_usd: 0.01 },
                tool_counts: { bash: 20 },
              }),
              events: [],
            },
          },
        },
      },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await cmdAnalyze(["--home", home.root, "--app", "alpha"]);
      expect(code).toBe(0);
      const out = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(out).toContain("bash_heavy");
      expect(out).toContain("Review shell-heavy behavior");
    } finally {
      log.mockRestore();
      home.cleanup();
    }
  });
});
