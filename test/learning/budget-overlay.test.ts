// The learning budget overlay's ledger rollup (learning-loop M5, spec §13
// learning_budget; milestone Done #4 — replay spend is visible in
// `operon budget`). Replay passes settle into the ordinary org ledger with
// experiment/candidate attribution; the rollup is a filter over those rows,
// never a second ledger.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rollupLearningSpend } from "../../src/org/budget.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function tempState(): OrgHomeFixture {
  const fixture = makeOrgHome();
  cleanups.push(fixture.cleanup);
  return fixture;
}

function row(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    at: "2026-07-11T10:00:00.000Z",
    role: "builder",
    runtime: "claude",
    model: "m",
    status: "completed",
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 1,
    subagentTurns: 0,
    wallClockMs: 100,
    escalations: 0,
    app: "learning-replay",
    runId: `run-${Math.abs(JSON.stringify(overrides).length)}-${String(overrides["runId"] ?? "")}`,
    ...overrides,
  });
}

describe("rollupLearningSpend", () => {
  it("rolls month spend per experiment, all-time spend per candidate, and counts distinct experiments", async () => {
    const state = tempState();
    const dir = join(state.root, "telemetry");
    mkdirSync(dir, { recursive: true });
    // Last month: counts toward the candidate's ALL-TIME replay cap, not
    // toward this month's budget or experiment count.
    writeFileSync(
      join(dir, "2026-06-20.jsonl"),
      row({ runId: "a", costUsd: 30, experimentRef: "exp_old_01", candidateRef: "cand_x" }) + "\n",
    );
    writeFileSync(
      join(dir, "2026-07-11.jsonl"),
      [
        row({ runId: "b", costUsd: 5, experimentRef: "exp_new_01", candidateRef: "cand_x" }),
        row({ runId: "c", costUsd: 7, experimentRef: "exp_new_01", candidateRef: "cand_x" }),
        row({ runId: "d", costUsd: 2, experimentRef: "exp_new_02", candidateRef: "cand_y" }),
        // An ordinary app turn — no learning attribution, never counted.
        row({ runId: "e", costUsd: 100, app: "alpha" }),
      ].join("\n") + "\n",
    );

    const rollup = await rollupLearningSpend(state.root, new Date("2026-07-11T12:00:00Z"));
    expect(rollup.monthUsd).toBe(14);
    expect(rollup.experimentsThisMonth).toBe(2);
    expect(rollup.byExperiment.get("exp_new_01")).toBe(12);
    expect(rollup.byExperiment.get("exp_new_02")).toBe(2);
    expect(rollup.byExperiment.has("exp_old_01")).toBe(false);
    // Per-candidate is all-time: the cap bounds a candidate's total
    // evaluation cost across months.
    expect(rollup.byCandidate.get("cand_x")).toBe(42);
    expect(rollup.byCandidate.get("cand_y")).toBe(2);
  });

  it("is empty with no ledger and tolerates torn lines", async () => {
    const state = tempState();
    const empty = await rollupLearningSpend(state.root, new Date("2026-07-11T12:00:00Z"));
    expect(empty.monthUsd).toBe(0);
    expect(empty.experimentsThisMonth).toBe(0);

    const dir = join(state.root, "telemetry");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "2026-07-11.jsonl"),
      row({ runId: "a", costUsd: 3, experimentRef: "exp_x_01" }) + "\n{torn",
    );
    const rollup = await rollupLearningSpend(state.root, new Date("2026-07-11T12:00:00Z"));
    expect(rollup.monthUsd).toBe(3);
  });
});
