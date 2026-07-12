// Tests the idempotent capture projector in src/org/learning/capture.ts.
// Covers gate/verdict derivation from real run-record layouts (L1 rollup
// preferred, L2 fallback, never both), episode-id derivation (ticket →
// journal TurnEvent → turn fallback), exactly-once replay through both the
// cursor and line-level dedup after cursor loss, terminal-only projection,
// and the torn-tail tolerance inherited from readEvents. Temp dirs and a
// FakeClock only; no network, GitHub, or live clock.

import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  captureCursorPath,
  projectCaptureEvents,
} from "../../src/org/learning/capture.js";
import { readLearningEvents } from "../../src/org/learning/events.js";
import type { RunEnvelope } from "../../src/runtime/runlog/envelope.js";
import { runPaths } from "../../src/runtime/runlog/paths.js";
import { FakeClock } from "../fixtures/fakeClock.js";
import { makeOrgHome, type OrgHomeOptions } from "../fixtures/orgHome.js";

const RUN_ID = "20260711-060000-build-implement";
const TRACE = "turn-alpha-42";

function envelope(overrides: Partial<RunEnvelope> = {}): RunEnvelope {
  return {
    schema_version: 1,
    run_id: RUN_ID,
    trace_id: TRACE,
    app: "alpha",
    ticket: "#7",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    status: "completed",
    started_at: "2026-07-11T06:00:00.000Z",
    finished_at: "2026-07-11T06:10:00.000Z",
    refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
    ...overrides,
  };
}

function l2(event: string, ts: string, detail: Record<string, string | number | boolean>): unknown {
  return {
    trace_id: TRACE,
    span_id: "implement",
    app: "alpha",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    ts,
    event,
    severity: "info",
    detail,
  };
}

const VERDICT_TS = "2026-07-11T06:09:00.000Z";

function buildRunHome(options: OrgHomeOptions = {}): ReturnType<typeof makeOrgHome> {
  return makeOrgHome({
    runs: {
      records: {
        alpha: {
          [RUN_ID]: {
            envelope: envelope({
              gate_results: [
                { gate: "test", status: "passed", detail: "212 passing" },
                { gate: "lint", status: "failed", detail: "2 errors" },
                { gate: "e2e", status: "skipped" },
              ],
            }),
            events: [l2("verdict.recorded", VERDICT_TS, { kind: "build", complexity: "M" })],
          },
        },
      },
    },
    ...options,
  });
}

describe("projectCaptureEvents", () => {
  it("projects gate outcomes and the pass verdict from a terminal build run", async () => {
    const home = buildRunHome();
    try {
      const clock = new FakeClock("2026-07-11T07:00:00.000Z");
      const result = await projectCaptureEvents({
        stateHome: home.root,
        appStages: { alpha: "live" },
        clock: () => clock.now(),
      });
      expect(result).toMatchObject({ runsProjected: 1, eventsEmitted: 4, eventsDeduped: 0 });

      const events = await readLearningEvents(home.root);
      expect(events).toHaveLength(4);
      for (const event of events) {
        expect(event.episode_id).toBe("ep_alpha_ticket_0007");
        expect(event.turn_id).toBe(TRACE);
        expect(event.run_id).toBe(RUN_ID);
        expect(event.app).toBe("alpha");
        expect(event.agent_role).toBe("builder");
        expect(event.pipeline).toBe("build");
        expect(event.pass).toBe("implement");
        expect(event.stage).toBe("live");
        expect(event.trust).toBe("trusted");
      }

      const gates = events.filter((event) => event.type === "gate_verdict");
      expect(gates.map((event) => event.payload?.["status"])).toEqual(["pass", "fail", "skip"]);
      expect(gates.map((event) => event.emitter)).toEqual(["verifier", "verifier", "verifier"]);
      expect(gates[0]?.ts).toBe("2026-07-11T06:10:00.000Z");
      expect(gates[0]?.error_class).toBeUndefined();
      expect(gates[1]?.error_class).toBe("gate.lint");

      const verdicts = events.filter((event) => event.type === "pass_verdict");
      expect(verdicts).toHaveLength(1);
      expect(verdicts[0]).toMatchObject({
        ts: VERDICT_TS,
        emitter: "orchestrator",
        payload: { kind: "build", complexity: "M" },
      });
    } finally {
      home.cleanup();
    }
  });

  it("is idempotent on replay via the cursor", async () => {
    const home = buildRunHome();
    try {
      await projectCaptureEvents({ stateHome: home.root });
      const firstBytes = eventFileBytes(home.root);

      const replay = await projectCaptureEvents({ stateHome: home.root });
      expect(replay).toMatchObject({
        runsProjected: 0,
        runsAlreadyProjected: 1,
        eventsEmitted: 0,
        eventsDeduped: 0,
      });
      expect(eventFileBytes(home.root)).toBe(firstBytes);
    } finally {
      home.cleanup();
    }
  });

  it("repairs a cursor receipt whose projected event file is missing", async () => {
    const home = buildRunHome();
    try {
      await projectCaptureEvents({ stateHome: home.root });
      rmSync(`${home.root}/learning/events/2026-07-11/${TRACE}.jsonl`);

      const replay = await projectCaptureEvents({ stateHome: home.root });
      expect(replay).toMatchObject({
        runsProjected: 0,
        runsRepaired: 1,
        eventFilesRecovered: 1,
      });
      expect(await readLearningEvents(home.root)).toHaveLength(4);
    } finally {
      home.cleanup();
    }
  });

  it("is idempotent on replay even after the cursor is lost", async () => {
    const home = buildRunHome();
    try {
      await projectCaptureEvents({ stateHome: home.root });
      const firstBytes = eventFileBytes(home.root);

      rmSync(captureCursorPath(home.root));
      const replay = await projectCaptureEvents({ stateHome: home.root });
      expect(replay).toMatchObject({ runsProjected: 1, eventsEmitted: 0, eventsDeduped: 4 });
      expect(eventFileBytes(home.root)).toBe(firstBytes);
    } finally {
      home.cleanup();
    }
  });

  it("leaves a still-running run pending, then projects it once terminal", async () => {
    const home = makeOrgHome({
      runs: {
        records: {
          alpha: { [RUN_ID]: { envelope: envelope({ status: "running" }), events: [] } },
        },
      },
    });
    try {
      const pending = await projectCaptureEvents({ stateHome: home.root });
      expect(pending).toMatchObject({ runsProjected: 0, runsPending: 1, eventsEmitted: 0 });
      expect(await readLearningEvents(home.root)).toEqual([]);

      const path = runPaths(home.root, "alpha", RUN_ID).envelope;
      writeFileSync(
        path,
        JSON.stringify(
          envelope({ gate_results: [{ gate: "test", status: "passed" }] }),
          null,
          2,
        ) + "\n",
      );
      const done = await projectCaptureEvents({ stateHome: home.root });
      expect(done).toMatchObject({ runsProjected: 1, eventsEmitted: 1 });
    } finally {
      home.cleanup();
    }
  });

  it("falls back to L2 gate.* events only when the envelope has no rollup", async () => {
    const home = makeOrgHome({
      runs: {
        records: {
          alpha: {
            [RUN_ID]: {
              envelope: envelope(),
              events: [
                l2("gate.passed", "2026-07-11T06:08:00.000Z", { gate: "test", detail: "ok" }),
                l2("gate.failed", "2026-07-11T06:08:30.000Z", { gate: "lint", detail: "2 errors" }),
              ],
            },
          },
        },
      },
    });
    try {
      await projectCaptureEvents({ stateHome: home.root });
      const gates = (await readLearningEvents(home.root)).filter(
        (event) => event.type === "gate_verdict",
      );
      expect(gates.map((event) => [event.payload?.["gate"], event.payload?.["status"]])).toEqual([
        ["test", "pass"],
        ["lint", "fail"],
      ]);
      expect(gates[1]?.error_class).toBe("gate.lint");
      expect(gates[0]?.ts).toBe("2026-07-11T06:08:00.000Z");
      expect(gates[0]?.payload?.["detail"]).toBe("ok");
    } finally {
      home.cleanup();
    }
  });

  it("never double-counts a gate present in both the L1 rollup and L2 events", async () => {
    const home = makeOrgHome({
      runs: {
        records: {
          alpha: {
            [RUN_ID]: {
              envelope: envelope({ gate_results: [{ gate: "test", status: "passed" }] }),
              events: [l2("gate.passed", "2026-07-11T06:08:00.000Z", { gate: "test" })],
            },
          },
        },
      },
    });
    try {
      const result = await projectCaptureEvents({ stateHome: home.root });
      expect(result.eventsEmitted).toBe(1);
      const events = await readLearningEvents(home.root);
      expect(events.filter((event) => event.type === "gate_verdict")).toHaveLength(1);
    } finally {
      home.cleanup();
    }
  });

  it("anchors dispatched turns on the journal's TurnEvent", async () => {
    const noTicket = envelope({ gate_results: [{ gate: "presence", status: "passed" }] });
    delete (noTicket as Partial<RunEnvelope>).ticket;
    const home = makeOrgHome({
      runs: { records: { alpha: { [RUN_ID]: { envelope: noTicket, events: [] } } } },
      state: {
        turns: {
          [TRACE]: {
            turnId: TRACE,
            role: "support",
            app: "alpha",
            phase: "done",
            attempt: 1,
            startedAt: "2026-07-11T05:00:00.000Z",
            updatedAt: "2026-07-11T05:30:00.000Z",
            event: {
              kind: "support-feedback",
              key: "fb-0142",
              source: "file-drop-inbox",
              payload: { summary: "checkout button unresponsive" },
            },
          },
        },
      },
    });
    try {
      await projectCaptureEvents({ stateHome: home.root });
      const events = await readLearningEvents(home.root);
      expect(events).toHaveLength(1);
      expect(events[0]?.episode_id).toBe("ep_alpha_feedback_fb-0142");
    } finally {
      home.cleanup();
    }
  });

  it("anchors schedule-triggered turns on the turn itself when nothing else exists", async () => {
    const noTicket = envelope({ gate_results: [{ gate: "presence", status: "passed" }] });
    delete (noTicket as Partial<RunEnvelope>).ticket;
    const home = makeOrgHome({
      runs: { records: { alpha: { [RUN_ID]: { envelope: noTicket, events: [] } } } },
    });
    try {
      await projectCaptureEvents({ stateHome: home.root });
      const events = await readLearningEvents(home.root);
      expect(events[0]?.episode_id).toBe(`ep_alpha_turn_${TRACE}`);
    } finally {
      home.cleanup();
    }
  });

  it("tolerates a torn tail line in the run's events.jsonl", async () => {
    const home = buildRunHome();
    try {
      appendFileSync(runPaths(home.root, "alpha", RUN_ID).events, '{"trace_id":"tor');
      const result = await projectCaptureEvents({ stateHome: home.root });
      expect(result).toMatchObject({ runsProjected: 1, eventsEmitted: 4 });
    } finally {
      home.cleanup();
    }
  });
});

function eventFileBytes(stateHome: string): string {
  const dir = `${stateHome}/learning/events/2026-07-11`;
  return readFileSync(`${dir}/${TRACE}.jsonl`, "utf8");
}
