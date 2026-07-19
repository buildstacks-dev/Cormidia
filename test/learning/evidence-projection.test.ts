// Coverage at the capture→efficiency-projector seam (#142).
//
// The pre-existing efficiency tests call `projectEfficiencyEvidence` directly
// with hand-built inputs that omit `steps` entirely and use self-consistent
// episode ids — so neither guard the real call path trips (the step-matching
// filter, and `explicitlyMechanical`) was ever exercised, and CI stayed green
// over a completely dead Phase 4 evidence loop (#137).
//
// Every test here drives the REAL seam: an org-home fixture on disk →
// `projectCaptureEvents` → `learning/events/`. Assertions are on YIELD (what
// events came out), never on receipt bookkeeping alone — a receipt with no
// events is the exact failure mode that hid the bug.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectCaptureEvents } from "../../src/org/learning/capture.js";
import { prepareDistillation } from "../../src/org/learning/distillation.js";
import { readLearningEvents, type LearningEvent } from "../../src/org/learning/events.js";
import { buildTicketEpisodeId, turnEpisodeId } from "../../src/org/learning/episodes.js";
import { defaultLearningPolicy } from "../../src/org/learning/policy.js";
import type { RunEnvelope } from "../../src/runtime/runlog/envelope.js";
import type { TurnUsage } from "../../src/runtime/types.js";
import { makeOrgHome, type OrgHomeOptions } from "../fixtures/orgHome.js";

const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

const APP = "alpha";

/** A run envelope as the orchestrator writes it: `episode_id` is the
 *  EFFICIENCY-namespace id, the same one the execution steps carry. */
function envelope(over: Partial<RunEnvelope> & { run_id: string }): RunEnvelope {
  return {
    schema_version: 1,
    trace_id: "trace-1",
    app: APP,
    pipeline: "build",
    pass: "implement",
    role: "builder",
    runtime: "codex",
    model: "fixture",
    status: "completed",
    started_at: "2026-07-12T10:00:00.000Z",
    finished_at: "2026-07-12T10:05:00.000Z",
    refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
    ...over,
  } as RunEnvelope;
}

/** A deterministic orchestration pass: absent runtime/model is the shape the
 *  runtime actually writes, and `isMechanicalRun` reads it. Omission, not
 *  `undefined` — `exactOptionalPropertyTypes` distinguishes the two. */
function mechanicalEnvelope(over: Partial<RunEnvelope> & { run_id: string }): RunEnvelope {
  const { runtime: _runtime, model: _model, ...rest } = envelope({
    pipeline: "provision",
    pass: "setup",
    role: "orchestrator",
    ...over,
  });
  return rest as RunEnvelope;
}

function providerUsage(costUsd: number): TurnUsage {
  return { tokensIn: 100, tokensOut: 10, costUsd, subagentTurns: 0, wallClockMs: 1000, quality: "estimated" };
}

async function capture(options: OrgHomeOptions): Promise<{
  root: string;
  events: LearningEvent[];
  result: Awaited<ReturnType<typeof projectCaptureEvents>>;
}> {
  const state = makeOrgHome(options);
  cleanup.push(state.cleanup);
  const result = await projectCaptureEvents({
    stateHome: state.root,
    appStages: { [APP]: "live" },
  });
  return { root: state.root, events: await readLearningEvents(state.root), result };
}

/** Any learning-event file in the tree — the stream name is derived from the
 *  turn id, so tests should not hard-code it. */
function firstEventFile(root: string): string {
  const dates = join(root, "learning", "events");
  const date = readdirSync(dates)[0]!;
  return join(dates, date, readdirSync(join(dates, date))[0]!);
}

function classes(events: LearningEvent[]): string[] {
  return events.filter((e) => e.error_class !== undefined).map((e) => e.error_class!).sort();
}

/** N complete ticket episodes exactly as production writes them: envelope with
 *  `ticket`, a route record, a cap_stop journal, and provider steps keyed on
 *  the efficiency-namespace id. Modelled on the real `~/.operon/terra-org`
 *  state where two `implement` passes each died on `error_max_budget_usd`. */
function cappedTicketEpisodes(...tickets: Array<[ticket: string, runId: string]>): OrgHomeOptions {
  const records: Record<string, { envelope: RunEnvelope; events: unknown[] }> = {};
  const episodes: NonNullable<Exclude<OrgHomeOptions["efficiency"], boolean>>["episodes"] = {};

  for (const [ticket, runId] of tickets) {
    const episodeId = `ticket:${APP}:${ticket}`;
    records[runId] = {
      envelope: envelope({
        run_id: runId,
        trace_id: `trace-${ticket}`,
        episode_id: episodeId,
        ticket,
        status: "failed",
        error_code: "error_max_budget_usd",
        usage: { tokens_in: 100, tokens_out: 10, cost_usd: 14.25, quality: "estimated" },
      }),
      events: [],
    };
    episodes![episodeId] = {
      journal: {
        status: "stopped",
        stop: {
          kind: "cap_stop",
          at: "2026-07-12T10:05:00.000Z",
          reason: "Budget overrun: turn stopped at the per-turn cap",
          next_boundary: "implementation",
          durable_artifacts: [],
        },
      },
      steps: {
        [`step-${ticket}`]: {
          run_id: runId,
          status: "failed",
          error_code: "error_max_budget_usd",
          usage: providerUsage(14.25),
        },
      },
    };
  }
  return { runs: { records: { [APP]: records } }, efficiency: { episodes } };
}

function cappedTicketEpisode(ticket: string, runId: string): OrgHomeOptions {
  return cappedTicketEpisodes([ticket, runId]);
}

describe("capture → efficiency projector seam", () => {
  // #142 item 1 / #137 regression at the real seam. This is the case that
  // produced ZERO events in production for every run, in every org.
  it("projects execution.cap_stop from a complete ticket episode", async () => {
    const { events } = await capture(cappedTicketEpisode("#2", "20260712-100000-build-implement"));

    const capStop = events.find((e) => e.error_class === "execution.cap_stop");
    expect(capStop, "a ticket episode with a cap_stop journal must yield evidence").toBeDefined();
    expect(capStop!.payload?.["classification_version"]).toBe("efficiency-evidence/v1");
    expect(capStop!.payload?.["evidence_kind"]).toBe("provider");
    expect(capStop!.trust).toBe("trusted");
    expect(capStop!.agent_role).toBe("builder");
  });

  // #137: pin the exact id produced on BOTH sides, so a future rename of
  // either scheme fails loudly here rather than silently re-opening the bug.
  // These two strings disagreeing IS the defect.
  it("pins both episode-id namespaces: learning id on the event, efficiency id on the steps", async () => {
    const { events } = await capture(cappedTicketEpisode("#2", "20260712-100000-build-implement"));

    const capStop = events.find((e) => e.error_class === "execution.cap_stop")!;
    // Event identity is the LEARNING namespace...
    expect(capStop.episode_id).toBe("ep_alpha_ticket_0002");
    expect(buildTicketEpisodeId(APP, "#2")).toBe("ep_alpha_ticket_0002");
    // ...while the steps on disk are keyed on the EFFICIENCY namespace. The
    // projector must match steps on the latter and stamp the former.
    expect("ticket:alpha:#2").not.toBe(capStop.episode_id);
    // Every capture-derived event for the run agrees on the learning id.
    expect(new Set(events.map((e) => e.episode_id))).toEqual(new Set(["ep_alpha_ticket_0002"]));
  });

  // #142 item 2 — the turn-episode pairing (`trace:<app>:<trace>` vs
  // `ep_<app>_turn_<trace>`), so the second namespace is pinned too.
  it("projects route.budget_overrun from a turn episode", async () => {
    const trace = "t-9";
    const episodeId = `trace:${APP}:${trace}`;
    const runId = "20260712-110000-build-implement";
    const { events } = await capture({
      runs: {
        records: {
          [APP]: {
            [runId]: {
              envelope: envelope({ run_id: runId, trace_id: trace, episode_id: episodeId }),
              events: [],
            },
          },
        },
      },
      efficiency: {
        episodes: {
          [episodeId]: {
            route: { budget: {
              provider_turns: 5,
              input_tokens: 4_000_000,
              equivalent_cost_usd: 2,
              active_time_ms: 45 * 60_000,
              human_decisions: null,
            } },
            steps: {
              "step-turn": {
                run_id: runId,
                usage: providerUsage(9.5),
              },
            },
          },
        },
      },
    });

    const overrun = events.find((e) => e.error_class === "route.budget_overrun");
    expect(overrun, "a turn episode over its admitted budget must yield evidence").toBeDefined();
    expect(overrun!.episode_id).toBe(turnEpisodeId(APP, trace));
    expect(overrun!.episode_id).toBe("ep_alpha_turn_t-9");
    expect(overrun!.payload?.["observed_cost_usd"]).toBe(9.5);
    expect(overrun!.payload?.["budget_cost_usd"]).toBe(2);
  });

  // #142 item 4 — the negative case must stay honest.
  it("excludes a genuinely mechanical run and names the reason", async () => {
    const runId = "20260712-120000-provision-setup";
    const episodeId = `lifecycle:${APP}:abc`;
    const { events, result } = await capture({
      runs: {
        records: {
          [APP]: {
            [runId]: {
              envelope: mechanicalEnvelope({ run_id: runId, episode_id: episodeId }),
              events: [],
            },
          },
        },
      },
      efficiency: {
        episodes: {
          [episodeId]: { steps: { "step-mech": { run_id: runId, kind: "mechanical", role: null } } },
        },
      },
    });

    expect(result.ineligibleRuns).toContainEqual({ app: APP, runId, reason: "mechanical_execution" });
    expect(result.eligibleFinalizedRuns).toBe(0);
    expect(events).toEqual([]);
  });

  // #142 item 5 / #137 — the `explicitlyMechanical` guard must not
  // over-reject. A legacy provider envelope simply has no step records; that
  // is not evidence it was mechanical.
  it("still projects a legacy provider envelope that has no execution steps", async () => {
    const runId = "20260712-130000-build-implement";
    const { events, result } = await capture({
      runs: {
        records: {
          [APP]: {
            [runId]: {
              envelope: envelope({ run_id: runId, status: "cancelled" }),
              events: [],
            },
          },
        },
      },
    });

    expect(result.ineligibleRuns).toEqual([]);
    expect(result.eligibleFinalizedRuns).toBe(1);
    expect(classes(events)).toContain("execution.cancelled");
  });
});

// Every org captured under the #137 defect holds cursor receipts recording
// zero events for runs that now derive evidence. If those receipts suppress
// re-projection, fixing the projector fixes nothing for any existing org —
// which is exactly what the first real-state verification of this change
// showed (`eventsEmitted: 0`, `runsAlreadyProjected: 7`).
describe("stale receipts do not suppress back-fill", () => {
  it("appends newly-derivable evidence to a run whose receipt recorded fewer events", async () => {
    const runId = "20260712-100000-build-implement";
    const options = cappedTicketEpisode("#2", runId);
    const state = makeOrgHome(options);
    cleanup.push(state.cleanup);

    // Simulate a receipt written before the projector could derive the
    // cap_stop: zero events, and no bound ids (the legacy receipt shape).
    // Another event already occupies the target file, so a file-existence
    // check reads as "already projected".
    const first = await projectCaptureEvents({ stateHome: state.root, appStages: { [APP]: "live" } });
    expect(first.eventsEmitted).toBeGreaterThan(0);

    const cursorPath = join(state.root, "learning", "metrics", "capture-cursor.json");
    const cursor = JSON.parse(readFileSync(cursorPath, "utf8")) as {
      runs: Record<string, { projected_at: string; events: number }>;
    };
    cursor.runs[`${APP}/${runId}`] = { projected_at: "2026-07-12T10:30:00.000Z", events: 0 };
    writeFileSync(cursorPath, JSON.stringify(cursor, null, 2) + "\n");

    // Wipe the events so the run genuinely needs re-projection, while the
    // target FILE keeps existing — the exact shape the old heuristic misread.
    const eventsFile = join(state.root, "learning", "events", "2026-07-12", "trace-#2.jsonl");
    const target = existsSync(eventsFile) ? eventsFile : firstEventFile(state.root);
    writeFileSync(target, "");

    const second = await projectCaptureEvents({ stateHome: state.root, appStages: { [APP]: "live" } });
    expect(second.eventsEmitted).toBeGreaterThan(0);
    const events = await readLearningEvents(state.root);
    expect(events.some((e) => e.error_class === "execution.cap_stop")).toBe(true);
  });
});

describe("failed passes are first-class evidence (#138)", () => {
  // A failed pass previously produced NO learning event of any kind: the L2
  // `pass.failed` record is not in capture's allowlist, and `verdict.recorded`
  // is only written on the success path.
  it("yields evidence for a failed pass with no efficiency episode or journal", async () => {
    const runId = "20260712-140000-build-implement";
    const { events } = await capture({
      runs: {
        records: {
          [APP]: {
            [runId]: {
              envelope: envelope({
                run_id: runId,
                status: "failed",
                error_code: "error_turn_failed",
              }),
              events: [
                { ts: "2026-07-12T10:05:00.000Z", event: "pass.failed", severity: "error", error_code: "error_turn_failed" },
              ],
            },
          },
        },
      },
    });

    const failure = events.find((e) => e.error_class === "execution.pass_failed");
    expect(failure, "a failed pass must be evidence even with no journal").toBeDefined();
    expect(failure!.error_class).toBe("execution.pass_failed");
    expect(failure!.payload?.["error_code"]).toBe("error_turn_failed");
  });

  // A cap firing inside the quality-gate remediation loop never reaches
  // `stopExecutionJournal` (loop.ts `else` branch), so there is no journal
  // stop to read. The envelope's own error code must still classify it.
  it("classifies a cap with no journal stop as execution.cap_stop", async () => {
    const runId = "20260712-150000-build-implement";
    const { events } = await capture({
      runs: {
        records: {
          [APP]: {
            [runId]: {
              envelope: envelope({
                run_id: runId,
                status: "failed",
                error_code: "error_max_budget_usd",
              }),
              events: [],
            },
          },
        },
      },
    });

    expect(classes(events)).toContain("execution.cap_stop");
    expect(classes(events)).not.toContain("execution.pass_failed");
  });

  // Mirrors the "never read both, or every gate double-counts" discipline in
  // capture.ts: a capped run whose journal IS present must not count twice
  // toward `min_cluster_events`.
  it("does not double-count a capped run that has both a journal stop and an error code", async () => {
    const { events } = await capture(cappedTicketEpisode("#2", "20260712-100000-build-implement"));

    const capStops = events.filter((e) => e.error_class === "execution.cap_stop");
    expect(capStops).toHaveLength(1);
    expect(new Set(capStops.map((e) => e.event_id)).size).toBe(1);
  });

  // The quality-gate repair cap (src/loop/loop.ts:373) stops the journal after
  // the remediation allowance is exhausted — at which point EVERY pass in the
  // episode has completed cleanly and no envelope is `failed`. An earlier
  // version of this fix gated the journal cap on "did this run end badly",
  // which silently discarded the most common cap path in the product.
  it("still projects a cap whose episode contains no failed pass", async () => {
    const episodeId = `ticket:${APP}:#4`;
    const contract = "20260712-180000-build-contract";
    const fix = "20260712-181000-build-fix";
    const { events } = await capture({
      runs: { records: { [APP]: {
        [contract]: { envelope: envelope({ run_id: contract, episode_id: episodeId, ticket: "#4", pass: "contract" }), events: [] },
        [fix]: { envelope: envelope({ run_id: fix, episode_id: episodeId, ticket: "#4", pass: "fix" }), events: [] },
      } } },
      efficiency: { episodes: { [episodeId]: {
        journal: {
          status: "stopped",
          stop: {
            kind: "cap_stop", at: "2026-07-12T18:20:00.000Z",
            reason: "quality-gate repair cap exhausted at 3",
            next_boundary: "implementation", durable_artifacts: [],
          },
        },
        steps: {
          "step-contract": { run_id: contract, status: "completed", finished_at: "2026-07-12T18:05:00.000Z" },
          "step-fix": { run_id: fix, status: "completed", finished_at: "2026-07-12T18:15:00.000Z" },
        },
      } } },
    });

    const capStops = events.filter((e) => e.error_class === "execution.cap_stop");
    expect(capStops, "a gate-repair cap must still be evidence").toHaveLength(1);
    // The episode's LAST provider run owns the episode-scoped journal.
    expect(capStops[0]!.run_id).toBe(fix);
  });

  // The episode journal is shared by every run in the episode. A pass that
  // completed cleanly must not inherit the episode's cap.
  it("does not attribute an episode-level cap to a pass that completed cleanly", async () => {
    const episodeId = `ticket:${APP}:#3`;
    const failed = "20260712-160000-build-implement";
    const clean = "20260712-155000-build-contract";
    const { events } = await capture({
      runs: {
        records: {
          [APP]: {
            [clean]: {
              envelope: envelope({
                run_id: clean, episode_id: episodeId, ticket: "#3", pass: "contract", status: "completed",
              }),
              events: [],
            },
            [failed]: {
              envelope: envelope({
                run_id: failed, episode_id: episodeId, ticket: "#3",
                status: "failed", error_code: "error_max_budget_usd",
              }),
              events: [],
            },
          },
        },
      },
      efficiency: {
        episodes: {
          [episodeId]: {
            journal: {
              status: "stopped",
              stop: {
                kind: "cap_stop", at: "2026-07-12T10:05:00.000Z",
                reason: "cap", next_boundary: "implementation", durable_artifacts: [],
              },
            },
            steps: {
              "step-clean": { run_id: clean, status: "completed", finished_at: "2026-07-12T15:55:00.000Z" },
              "step-failed": { run_id: failed, status: "failed", error_code: "error_max_budget_usd", finished_at: "2026-07-12T16:05:00.000Z" },
            },
          },
        },
      },
    });

    const capStops = events.filter((e) => e.error_class === "execution.cap_stop");
    expect(capStops.map((e) => e.run_id)).toEqual([failed]);
  });

  // #138 asks for the decision to be asserted either way rather than left
  // accidental. Today these two L2 records are deliberately NOT projected:
  // `escalation.raised` is an approval-boundary signal with its own
  // `approval.false_positive` evidence path, and `ticket.transition` is
  // state-machine bookkeeping, not a per-cause failure signal. Changing that
  // is a deliberate schema decision that must change this test.
  it("deliberately does not project escalation.raised or ticket.transition", async () => {
    const runId = "20260712-170000-build-implement";
    const { events } = await capture({
      runs: {
        records: {
          [APP]: {
            [runId]: {
              envelope: envelope({ run_id: runId }),
              events: [
                { ts: "2026-07-12T10:01:00.000Z", event: "escalation.raised", severity: "warn", detail: { tool: "bash", reason: "x" } },
                { ts: "2026-07-12T10:02:00.000Z", event: "ticket.transition", severity: "info", detail: { from: "ready", to: "building" } },
              ],
            },
          },
        },
      },
    });

    expect(events).toEqual([]);
  });
});

// #142 item 6 — the test that turns "distiller found nothing" into a failing
// build. Capture and distillation each looked fine in isolation; only the full
// chain shows that no cluster ever formed.
describe("capture → prepareDistillation forms a real cluster", () => {
  it("clusters two same-class events from two ticket episodes", async () => {
    const state = makeOrgHome(cappedTicketEpisodes(
      ["#2", "20260712-100000-build-implement"],
      ["#5", "20260712-200000-build-implement"],
    ));
    cleanup.push(state.cleanup);
    const orgHome = makeOrgHome();
    cleanup.push(orgHome.cleanup);
    const appWorkdir = makeOrgHome();
    cleanup.push(appWorkdir.cleanup);

    const prep = await prepareDistillation({
      orgHome: orgHome.root,
      stateHome: state.root,
      app: APP,
      appWorkdir: appWorkdir.root,
      appStages: { [APP]: "live" },
      policy: defaultLearningPolicy(),
      now: new Date("2026-07-12T18:00:00.000Z"),
    });

    // Both passes died the same way, in the same app and role, with the same
    // constant cause — exactly `min_cluster_events`.
    expect(prep.evidenceEvents).toBe(2);
    expect(prep.actionableClusters).toBe(1);
    expect(prep.status).not.toBe("skipped");
    const cluster = prep.clusters[0]!;
    expect(cluster.error_class).toBe("execution.cap_stop");
    expect(cluster.event_ids).toHaveLength(2);
    expect(cluster.roles).toEqual(["builder"]);
    expect(new Set(cluster.episode_ids)).toEqual(
      new Set(["ep_alpha_ticket_0002", "ep_alpha_ticket_0005"]),
    );
  });
});
