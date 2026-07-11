// Tests the runs/-to-ledger reconciliation in src/org/budget.ts (Stage 1 of
// docs/proportionality-review.md; telemetry doc Defect B item 4).
// Covers envelope back-fill, run_id idempotency, no-usage skips, escalation
// recovery from L2 events, unmeasured counting, and the rollup matching the
// envelope sum to the cent.
// Uses the orgHome fixture's runs builder (real runlog paths); no network,
// auth, real org state, or wall-clock time is required.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { countUnmeasured, reconcileLedger, rollupBudgets } from "../src/org/budget.js";
import type { AppsFile } from "../src/org/apps.js";
import { recordTurn } from "../src/runtime/telemetry.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

const APP = "buildstacks.dev";

function envelope(runId: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    schema_version: 1,
    run_id: runId,
    trace_id: "20260710T150717-build-2",
    app: APP,
    ticket: "#2",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    model: "gpt-5.5",
    status: "completed",
    started_at: "2026-07-10T15:09:59.000Z",
    finished_at: "2026-07-10T15:13:23.000Z",
    wall_clock_ms: 203_984,
    usage: {
      tokens_in: 1_346_048,
      tokens_out: 9_726,
      cost_usd: 7.02,
      cost_estimated: true,
      cache_read_tokens: 650_240,
      subagent_turns: 0,
    },
    refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
    ...overrides,
  };
}

const APPS: AppsFile = {
  schemaVersion: 1,
  org: { name: "fixture-org", maxConcurrentTurns: 2 },
  defaults: { budgetUsdMonth: 1000 },
  apps: [{ name: APP, repo: "o/r", status: "onboarding", budgetUsdMonth: 300, cadence: {} }],
};

describe("reconcileLedger", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("back-fills the ledger from envelopes and the rollup matches to the cent", async () => {
    home = makeOrgHome({
      runs: {
        records: {
          [APP]: {
            "20260710-150959-build-implement": {
              envelope: envelope("20260710-150959-build-implement"),
              events: [
                { type: "run.started" },
                { type: "escalation.raised", detail: { rule: "secrets-or-auth" } },
                { type: "run.completed" },
              ],
            },
            "20260710-151400-gates-quality-gates": {
              envelope: envelope("20260710-151400-gates-quality-gates", {
                pass: "quality-gates",
                role: "quality-gates", // not in roles.yaml — runtime records "unknown"
                status: "blocked",
                usage: { tokens_in: 1000, tokens_out: 50, cost_usd: 0.98, subagent_turns: 0 },
              }),
            },
            "20260710-151500-build-contract": {
              // Hung before the turn returned: no usage — nothing to settle.
              envelope: envelope("20260710-151500-build-contract", {
                pass: "contract",
                status: "running",
                usage: undefined,
              }),
            },
            "20260710-151600-fix-fix": {
              // running WITH usage, still inside the in-flight window: a live
              // pass between turn-return and finalize. Reconcile must leave it
              // for the executor's own settle rather than racing it.
              envelope: envelope("20260710-151600-fix-fix", {
                pass: "fix",
                status: "running",
                usage: { tokens_in: 500, tokens_out: 20, cost_usd: 0.5, subagent_turns: 0 },
              }),
            },
          },
        },
      },
    });

    const outcome = await reconcileLedger(
      home.root,
      { builder: "codex" },
      new Date("2026-07-10T16:00:00Z"), // 45 min after the in-flight pass started
    );
    expect(outcome).toMatchObject({
      scanned: 4,
      settled: 2,
      noUsage: 1,
      inFlight: 1,
      alreadySettled: 0,
      corrupt: 0,
    });
    expect(outcome.recoveredUsd).toBeCloseTo(8.0, 10);

    const raw = await readFile(join(home.root, "telemetry", "2026-07-10.jsonl"), "utf8");
    const rows = raw.trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows).toHaveLength(2);
    const implement = rows.find((row) => row["pass"] === "implement")!;
    expect(implement).toMatchObject({
      role: "builder",
      runtime: "codex",
      model: "gpt-5.5",
      status: "completed",
      costUsd: 7.02,
      costEstimated: true,
      cacheReadTokens: 650_240,
      app: APP,
      runId: "20260710-150959-build-implement",
      escalations: 1,
    });
    const gates = rows.find((row) => row["pass"] === "quality-gates")!;
    expect(gates).toMatchObject({ status: "blocked_on_gate", costUsd: 0.98, runtime: "unknown" });

    // Exit criterion (telemetry doc Stage 1): the budget rollup reports the
    // envelope sum to the cent.
    const budget = await rollupBudgets(home.root, APPS, new Date("2026-07-15T00:00:00Z"));
    expect(budget[0]!.spentUsd).toBeCloseTo(8.0, 10);
  });

  it("recovers a provably dead running-with-usage envelope as failed", async () => {
    home = makeOrgHome({
      runs: {
        records: {
          [APP]: {
            "20260710-151600-fix-fix": {
              envelope: envelope("20260710-151600-fix-fix", {
                pass: "fix",
                status: "running",
                usage: { tokens_in: 500, tokens_out: 20, cost_usd: 0.5, subagent_turns: 0 },
              }),
            },
          },
        },
      },
    });

    // Two days later the run is past the in-flight window: dead, not live.
    const outcome = await reconcileLedger(home.root, {}, new Date("2026-07-12T16:00:00Z"));
    expect(outcome).toMatchObject({ settled: 1, inFlight: 0 });

    const raw = await readFile(join(home.root, "telemetry", "2026-07-10.jsonl"), "utf8");
    const row = JSON.parse(raw.trimEnd()) as Record<string, unknown>;
    expect(row).toMatchObject({ pass: "fix", status: "failed", costUsd: 0.5 });
  });

  it("is idempotent: a second run settles nothing", async () => {
    home = makeOrgHome({
      runs: {
        records: {
          [APP]: {
            "20260710-150959-build-implement": {
              envelope: envelope("20260710-150959-build-implement"),
            },
          },
        },
      },
    });

    expect((await reconcileLedger(home.root)).settled).toBe(1);
    const second = await reconcileLedger(home.root);
    expect(second).toMatchObject({ settled: 0, alreadySettled: 1 });
    expect(second.recoveredUsd).toBe(0);
  });
});

describe("countUnmeasured (Defect A)", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("counts this month's unmeasured rows per app and ignores measured ones", async () => {
    home = makeOrgHome();
    await recordTurn(home.root, {
      at: "2026-07-10T08:00:00.000Z",
      role: "planner",
      runtime: "claude",
      model: "claude-opus-4-8",
      status: "completed",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      subagentTurns: 0,
      wallClockMs: 1_121_757,
      escalations: 0,
      app: APP,
      trigger: "manual",
      unmeasured: true,
    });
    await recordTurn(home.root, {
      at: "2026-07-10T09:00:00.000Z",
      role: "builder",
      runtime: "codex",
      model: "gpt-5.5",
      status: "completed",
      tokensIn: 100,
      tokensOut: 10,
      costUsd: 1.5,
      subagentTurns: 0,
      wallClockMs: 60_000,
      escalations: 0,
      app: APP,
    });

    const counts = await countUnmeasured(home.root, "2026-07");
    expect(counts.get(APP)).toBe(1);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(1);
  });
});
