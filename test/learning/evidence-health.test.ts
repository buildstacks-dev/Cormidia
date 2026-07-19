// Self-describing episode closes (#139) and truthful evidence-yield health
// (#141).
//
// `capture.status: "healthy"` was reported over a projector discarding 100% of
// provider evidence, because health counted RUNS PROJECTED rather than
// EVIDENCE PRODUCED. Meanwhile `episode_closed` carried no `terminal_reason`,
// so nothing in the event stream distinguished a budget kill from an ordinary
// unmerged close.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { previewCaptureEvents, projectCaptureEvents } from "../../src/org/learning/capture.js";
import { prepareDistillation } from "../../src/org/learning/distillation.js";
import { projectLearningEfficiencyHealth } from "../../src/org/learning/efficiency-health.js";
import { createEpisodeProjector } from "../../src/org/learning/episode.js";
import { readLearningEvents } from "../../src/org/learning/events.js";
import { defaultLearningPolicy } from "../../src/org/learning/policy.js";
import { orgLearningRoot } from "../../src/org/learning/concepts.js";
import type { RunEnvelope } from "../../src/runtime/runlog/envelope.js";
import { FakeClock } from "../fixtures/fakeClock.js";
import { makeOrgHome, type OrgHomeOptions } from "../fixtures/orgHome.js";

const APP = "alpha";
const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

function envelope(over: Partial<RunEnvelope> & { run_id: string }): RunEnvelope {
  return {
    schema_version: 1,
    trace_id: "t-1",
    app: APP,
    ticket: "#7",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    runtime: "codex",
    model: "fixture",
    status: "completed",
    started_at: "2026-07-11T10:00:00.000Z",
    finished_at: "2026-07-11T10:05:00.000Z",
    refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
    ...over,
  } as RunEnvelope;
}

/** A deterministic orchestration pass: absent runtime/model is the shape the
 *  runtime actually writes, and `isMechanicalRun` reads it. */
function mechanicalEnvelope(over: Partial<RunEnvelope> & { run_id: string }): RunEnvelope {
  const { runtime: _runtime, model: _model, ...rest } = envelope({
    role: "orchestrator",
    pipeline: "gates",
    pass: "quality-gates",
    ...over,
  });
  return rest as RunEnvelope;
}

function ledgerRow(runId: string, costUsd: number): string {
  return JSON.stringify({
    at: "2026-07-11T10:05:00.000Z", role: "builder", runtime: "codex", model: "fixture",
    status: "completed", tokensIn: 1000, tokensOut: 100, costUsd,
    subagentTurns: 0, wallClockMs: 60000, escalations: 0, app: APP, runId,
  });
}

function writeLedger(root: string, rows: string[]): void {
  mkdirSync(join(root, "telemetry"), { recursive: true });
  writeFileSync(join(root, "telemetry", "2026-07-11.jsonl"), rows.join("\n") + "\n");
}

function writeClaimState(root: string, issue: number, outcomes: string[]): void {
  mkdirSync(join(root, "tickets", APP), { recursive: true });
  writeFileSync(
    join(root, "tickets", APP, `${issue}.json`),
    JSON.stringify({ claims: outcomes.length, outcomes }, null, 2) + "\n",
  );
}

// ---------------------------------------------------------------------------
// #139 — episode_closed must be self-describing
// ---------------------------------------------------------------------------

/** Close an episode whose last run ended the given way, and return the
 *  emitted `episode_closed` payload. */
async function closedPayload(
  over: Partial<RunEnvelope>,
  outcome: string,
): Promise<Record<string, unknown>> {
  const runId = "20260711-100600-build-implement";
  const home = makeOrgHome({
    runs: { records: { [APP]: { [runId]: { envelope: envelope({ run_id: runId, ...over }), events: [] } } } },
  });
  cleanup.push(home.cleanup);
  writeLedger(home.root, [ledgerRow(runId, 2)]);
  writeClaimState(home.root, 7, [outcome]);

  const clock = new FakeClock("2026-07-11T11:00:00.000Z");
  await createEpisodeProjector({
    stateHome: home.root,
    appStages: { [APP]: "live" },
    clock: () => clock.now(),
  }).project();

  const closed = (await readLearningEvents(home.root)).find((e) => e.type === "episode_closed");
  expect(closed, "episode should have closed").toBeDefined();
  return closed!.payload!;
}

describe("episode_closed carries terminal_reason (#139)", () => {
  it("reports cap_stop rather than an indistinguishable unmerged close", async () => {
    const payload = await closedPayload(
      { status: "failed", error_code: "error_max_budget_usd" },
      "claim 1: ended returned",
    );
    // Before the fix this payload was {kind, completed, merged, cost_usd} —
    // identical for a budget kill and an ordinary unmerged close.
    expect(payload["terminal_reason"]).toBe("cap_stop");
    expect(payload["completed"]).toBe(false);
  });

  it("reports the other terminal reasons episode.ts can derive", async () => {
    expect((await closedPayload({ status: "cancelled" }, "claim 1: ended cancelled"))["terminal_reason"])
      .toBe("cancelled");
    expect((await closedPayload({ status: "timed_out" }, "claim 1: ended timeout"))["terminal_reason"])
      .toBe("timeout");
    expect((await closedPayload({ status: "failed" }, "claim 1: ended failed"))["terminal_reason"])
      .toBe("crash");
    expect((await closedPayload({}, "claim 1: ended merged (PR #12)"))["terminal_reason"])
      .toBe("completed");
  });

  it("round-trips through readLearningEvents without schema-version churn", async () => {
    const payload = await closedPayload(
      { status: "failed", error_code: "error_max_budget_usd" },
      "claim 1: ended returned",
    );
    expect(JSON.parse(JSON.stringify(payload))["terminal_reason"]).toBe("cap_stop");
  });

  // The regression this change could plausibly cause: adding a reason must NOT
  // turn every unmerged ticket into distiller evidence. `episode_closed` has
  // no `error_class` and is not an `error`, so `isEvidenceEvent` still rejects
  // it — asserted here through the real distillation path.
  it("still does not satisfy the distiller's evidence filter", async () => {
    const runId = "20260711-100600-build-implement";
    const home = makeOrgHome({
      runs: { records: { [APP]: { [runId]: {
        envelope: mechanicalEnvelope({ run_id: runId, status: "cancelled" }),
        events: [],
      } } } },
    });
    cleanup.push(home.cleanup);
    writeLedger(home.root, [ledgerRow(runId, 2)]);
    writeClaimState(home.root, 7, ["claim 1: ended returned"]);
    const clock = new FakeClock("2026-07-11T11:00:00.000Z");
    await createEpisodeProjector({
      stateHome: home.root, appStages: { [APP]: "live" }, clock: () => clock.now(),
    }).project();

    const closed = (await readLearningEvents(home.root)).filter((e) => e.type === "episode_closed");
    expect(closed.length).toBeGreaterThan(0);
    expect(closed.every((e) => e.error_class === undefined)).toBe(true);

    const orgHome = makeOrgHome();
    cleanup.push(orgHome.cleanup);
    const appWorkdir = makeOrgHome();
    cleanup.push(appWorkdir.cleanup);
    const prep = await prepareDistillation({
      orgHome: orgHome.root,
      stateHome: home.root,
      app: APP,
      appWorkdir: appWorkdir.root,
      appStages: { [APP]: "live" },
      policy: defaultLearningPolicy(),
      now: new Date("2026-07-11T12:00:00.000Z"),
    });
    // The mechanical gate run is ineligible, so the ONLY events present are
    // lifecycle ones. None may count as evidence.
    expect(prep.evidenceEvents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #141 — health must be able to say "capture ran and produced nothing"
// ---------------------------------------------------------------------------

async function health(stateHome: string): Promise<Awaited<ReturnType<typeof projectLearningEfficiencyHealth>>> {
  const orgHome = makeOrgHome();
  cleanup.push(orgHome.cleanup);
  return projectLearningEfficiencyHealth({
    orgHome: orgHome.root,
    stateHome,
    capture: await previewCaptureEvents({ stateHome, appStages: { [APP]: "live" } }),
    policy: defaultLearningPolicy(),
    roots: [orgLearningRoot(orgHome.root)],
  });
}

/** A run that demonstrably failed. Whether it yields evidence is what the
 *  health check is about. */
function failedRun(runId: string, episodeId: string | undefined): OrgHomeOptions {
  return {
    runs: { records: { [APP]: { [runId]: {
      envelope: envelope({
        run_id: runId,
        ...(episodeId !== undefined ? { episode_id: episodeId } : {}),
        status: "failed",
        error_code: "error_max_budget_usd",
      }),
      events: [],
    } } } },
  };
}

describe("efficiency health reports evidence yield, not just receipts (#141)", () => {
  // The test that gives the fix its meaning: reproduce #137's namespace
  // mismatch by pointing the envelope at an episode whose steps are filed
  // under a DIFFERENT id, so the projector's step filter matches nothing.
  it("does not report capture healthy when the projector yields nothing for a failed run", async () => {
    const runId = "20260711-100600-build-implement";
    const state = makeOrgHome({
      ...failedRun(runId, "ep_alpha_ticket_0007"), // learning-namespace id...
      efficiency: { episodes: {
        // ...while the steps live under the efficiency-namespace id.
        [`ticket:${APP}:#7`]: { steps: { "step-1": { run_id: runId, status: "failed", error_code: "error_max_budget_usd" } } },
      } },
    });
    cleanup.push(state.cleanup);

    const result = await previewCaptureEvents({ stateHome: state.root, appStages: { [APP]: "live" } });
    expect(result.eligibleFinalizedRuns).toBe(1);
    expect(result.evidenceGaps).toContainEqual({
      app: APP, runId, reason: "terminal_failure_without_evidence",
    });

    const projected = await health(state.root);
    expect(projected.capture.status).not.toBe("healthy");
    expect(projected.capture.status).toBe("degraded");
    expect(projected.capture.evidence_gaps).toHaveLength(1);
    expect(projected.capture.runs_without_efficiency_evidence).toBe(1);
  });

  // Zero eligible runs is a missing denominator; zero-yield runs are a
  // projector fault. They must not read the same.
  it("distinguishes no eligible runs from eligible runs that yielded nothing", async () => {
    const empty = makeOrgHome({ runs: { apps: [APP] } });
    cleanup.push(empty.cleanup);
    const emptyHealth = await health(empty.root);
    expect(emptyHealth.capture.status).toBe("invalid_measurement");
    expect(emptyHealth.capture.eligible_finalized_runs).toBeNull();
    expect(emptyHealth.capture.evidence_gaps).toEqual([]);

    const runId = "20260711-100600-build-implement";
    const gap = makeOrgHome({
      ...failedRun(runId, "ep_alpha_ticket_0007"),
      efficiency: { episodes: {
        [`ticket:${APP}:#7`]: { steps: { "step-1": { run_id: runId, status: "failed" } } },
      } },
    });
    cleanup.push(gap.cleanup);
    const gapHealth = await health(gap.root);
    expect(gapHealth.capture.status).toBe("degraded");
    expect(gapHealth.capture.eligible_finalized_runs).toBe(1);
    expect(gapHealth.capture.evidence_gaps.length).toBeGreaterThan(0);
  });

  it("does not report governance healthy on an empty evidence set", async () => {
    const empty = makeOrgHome({ runs: { apps: [APP] } });
    cleanup.push(empty.cleanup);
    const projected = await health(empty.root);
    expect(projected.governance.evidence_events).toBe(0);
    expect(projected.governance.status).not.toBe("healthy");
    expect(projected.governance.status).toBe("invalid_measurement");
  });

  // The new check must not cry wolf: an org where the projector WORKS reads
  // healthy, both when the failed run yields evidence and when a clean run
  // legitimately has nothing to classify.
  it("still reports healthy when evidence is produced and nothing is actionable", async () => {
    const runId = "20260711-100600-build-implement";
    const state = makeOrgHome({
      ...failedRun(runId, `ticket:${APP}:#7`), // correctly-namespaced
      efficiency: { episodes: {
        [`ticket:${APP}:#7`]: { steps: { "step-1": { run_id: runId, status: "failed", error_code: "error_max_budget_usd" } } },
      } },
    });
    cleanup.push(state.cleanup);
    await projectCaptureEvents({ stateHome: state.root, appStages: { [APP]: "live" } });

    const projected = await health(state.root);
    expect(projected.capture.evidence_gaps).toEqual([]);
    expect(projected.capture.status).toBe("healthy");
    // One event is below `min_cluster_events`, so nothing is actionable — but
    // evidence EXISTS, which is the difference between "clean" and "no input".
    expect(projected.governance.evidence_events).toBe(1);
    expect(projected.governance.status).toBe("healthy");
    expect(projected.governance.actionable_clusters).toBe(0);
  });

  it("a clean org with no failures reports no evidence gaps", async () => {
    const runId = "20260711-100600-build-implement";
    const state = makeOrgHome({
      runs: { records: { [APP]: { [runId]: {
        envelope: envelope({ run_id: runId, episode_id: `ticket:${APP}:#7` }),
        events: [],
      } } } },
      efficiency: { episodes: {
        [`ticket:${APP}:#7`]: { steps: { "step-1": { run_id: runId, status: "completed" } } },
      } },
    });
    cleanup.push(state.cleanup);

    const result = await previewCaptureEvents({ stateHome: state.root, appStages: { [APP]: "live" } });
    // A healthy run has nothing to classify; that is not a gap.
    expect(result.runsWithoutEfficiencyEvidence).toBe(1);
    expect(result.evidenceGaps).toEqual([]);
  });
});
