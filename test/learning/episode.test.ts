// Tests the EpisodeRecord projector in src/org/learning/episode.ts.
// Covers the merged-build-ticket fold against every source (runs, ledger,
// claim state, approvals), byte-identical rebuild after projection-state
// loss (design §8.3), truthful closure of interrupted episodes via the
// heartbeat reading (preflight #28), event-anchored boundaries, exactly-once
// lifecycle events, and the append-only late-outcome exception. Temp dirs
// and a FakeClock only; no network, GitHub, or live clock.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApprovalStore } from "../../src/org/approvals.js";
import {
  createEpisodeProjector,
  episodePath,
  episodesDir,
  readEpisodeRecords,
  type EpisodeRecord,
} from "../../src/org/learning/episode.js";
import { readLearningEvents } from "../../src/org/learning/events.js";
import type { RunEnvelope } from "../../src/runtime/runlog/envelope.js";
import { FakeClock } from "../fixtures/fakeClock.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

const EPISODE = "ep_alpha_ticket_0007";

function envelope(runId: string, overrides: Partial<RunEnvelope> = {}): RunEnvelope {
  return {
    schema_version: 1,
    run_id: runId,
    trace_id: "t-build-1",
    app: "alpha",
    ticket: "#7",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    status: "completed",
    started_at: "2026-07-11T10:00:00.000Z",
    finished_at: "2026-07-11T10:05:00.000Z",
    refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
    ...overrides,
  };
}

function ledgerRow(runId: string, costUsd: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    at: "2026-07-11T10:05:00.000Z",
    role: "builder",
    runtime: "codex",
    model: "gpt-5.5",
    status: "completed",
    tokensIn: 1000,
    tokensOut: 100,
    costUsd,
    subagentTurns: 0,
    wallClockMs: 60000,
    escalations: 0,
    app: "alpha",
    runId,
    ...extra,
  });
}

function writeLedger(root: string, rows: string[]): void {
  mkdirSync(join(root, "telemetry"), { recursive: true });
  writeFileSync(join(root, "telemetry", "2026-07-11.jsonl"), rows.join("\n") + "\n");
}

function writeClaimState(root: string, issue: number, outcomes: string[]): void {
  mkdirSync(join(root, "tickets", "alpha"), { recursive: true });
  writeFileSync(
    join(root, "tickets", "alpha", `${issue}.json`),
    JSON.stringify({ claims: outcomes.length, outcomes }, null, 2) + "\n",
  );
}

/** A full merged ticket: contract + implement + gate phase + review pass. */
function mergedTicketHome(): OrgHomeFixture {
  const home = makeOrgHome({
    runs: {
      records: {
        alpha: {
          "20260711-100000-build-contract": {
            envelope: envelope("20260711-100000-build-contract", {
              pass: "contract",
              usage: { tokens_in: 1000, tokens_out: 100, cost_usd: 0.9, subagent_turns: 0 },
            }),
            events: [],
          },
          "20260711-100600-build-implement": {
            envelope: envelope("20260711-100600-build-implement", {
              trace_id: "t-build-2",
              started_at: "2026-07-11T10:06:00.000Z",
              finished_at: "2026-07-11T10:11:00.000Z",
              usage: { tokens_in: 5000, tokens_out: 800, cost_usd: 2.0, subagent_turns: 0 },
            }),
            events: [],
          },
          "20260711-101200-gates-quality-gates": {
            envelope: envelope("20260711-101200-gates-quality-gates", {
              trace_id: "loop-alpha-1",
              pipeline: "gates",
              pass: "quality-gates",
              role: "orchestrator",
              started_at: "2026-07-11T10:12:00.000Z",
              finished_at: "2026-07-11T10:12:30.000Z",
              gate_results: [
                { gate: "tests", status: "passed", detail: "212 passing" },
                { gate: "lint", status: "failed", detail: "2 errors" },
              ],
            }),
            events: [],
          },
          "20260711-101300-review-verify": {
            envelope: envelope("20260711-101300-review-verify", {
              trace_id: "loop-alpha-1",
              pipeline: "review",
              pass: "verify",
              role: "reviewer",
              started_at: "2026-07-11T10:13:00.000Z",
              finished_at: "2026-07-11T10:20:00.000Z",
              usage: { tokens_in: 8000, tokens_out: 900, cost_usd: 1.1, subagent_turns: 0 },
            }),
            events: [],
          },
        },
      },
    },
  });
  writeLedger(home.root, [
    ledgerRow("20260711-100000-build-contract", 0.9),
    ledgerRow("20260711-100600-build-implement", 2.0),
    ledgerRow("20260711-101300-review-verify", 1.1, { role: "reviewer" }),
  ]);
  writeClaimState(home.root, 7, ["claim 1: ended merged (PR #12)"]);
  return home;
}

function projector(root: string, at = "2026-07-11T11:00:00.000Z"): ReturnType<typeof createEpisodeProjector> {
  const clock = new FakeClock(at);
  return createEpisodeProjector({
    stateHome: root,
    appStages: { alpha: "live" },
    clock: () => clock.now(),
  });
}

describe("createEpisodeProjector().project()", () => {
  it("folds a merged build ticket from runs, ledger, claim state, and approvals", async () => {
    const home = mergedTicketHome();
    try {
      const store = new ApprovalStore(home.root);
      const raised = await store.raise({
        app: "alpha",
        role: "sre",
        rule: "production-deploy",
        action: { tool: "release", input: { kind: "deploy" }, description: "deploy for #7" },
        ticketRef: "#7",
        now: new Date("2026-07-11T10:21:00.000Z"),
      });
      await store.decide(raised.id, {
        decision: "approved",
        now: new Date("2026-07-11T10:22:00.000Z"),
      });

      const records = await projector(home.root).project();
      expect(records).toHaveLength(1);
      const record = records[0]!;

      expect(record).toMatchObject({
        episode_id: EPISODE,
        kind: "build_ticket",
        app: "alpha",
        source: { kind: "github_issue", ref: "alpha#7" },
        stage: "live",
        risk_tier: null,
        opened: "2026-07-11T10:00:00.000Z",
        closed: "2026-07-11T10:20:00.000Z",
        status: "closed",
        fingerprint_ref: null,
        approvals: [raised.id],
        artifacts: ["pull-request-12"],
      });
      expect(record.turns.map((turn) => [turn.pipeline, turn.pass, turn.status])).toEqual([
        ["build", "contract", "completed"],
        ["build", "implement", "completed"],
        ["gates", "quality-gates", "completed"],
        ["review", "verify", "completed"],
      ]);
      expect(record.gates.map((gate) => [gate.gate, gate.status])).toEqual([
        ["tests", "pass"],
        ["lint", "fail"],
      ]);
      expect(record.side_effects).toEqual([
        { kind: "github_pr", ref: "#12", reversible: true },
        { kind: "github_merge", ref: "#12", reversible: false },
      ]);
      expect(record.outcome).toEqual({
        completed: true,
        merged: true,
        release_disposition: "deploy-approved",
        review_cycles: 1,
        gate_failures: 1,
        human_interventions: 1,
        cost_usd: 4.0,
        cost_estimated: false,
        unsettled_runs: [],
      });
    } finally {
      home.cleanup();
    }
  });

  it("rebuilds byte-identical records after the projection state is deleted", async () => {
    const home = mergedTicketHome();
    try {
      await projector(home.root).project();
      const first = recordBytes(home.root);
      expect(Object.keys(first)).toEqual([`${EPISODE}.json`]);

      rmSync(episodesDir(home.root), { recursive: true });
      await projector(home.root).project();
      expect(recordBytes(home.root)).toEqual(first);
    } finally {
      home.cleanup();
    }
  });

  it("emits episode_opened/episode_closed exactly once across replays", async () => {
    const home = mergedTicketHome();
    try {
      await projector(home.root).project();
      await projector(home.root).project();
      rmSync(episodesDir(home.root), { recursive: true });
      await projector(home.root).project();

      const events = await readLearningEvents(home.root);
      const opened = events.filter((event) => event.type === "episode_opened");
      const closed = events.filter((event) => event.type === "episode_closed");
      expect(opened).toHaveLength(1);
      expect(closed).toHaveLength(1);
      expect(opened[0]).toMatchObject({
        event_id: `evt_${EPISODE}_opened`,
        ts: "2026-07-11T10:00:00.000Z",
        emitter: "orchestrator",
        payload: { kind: "build_ticket", source_ref: "alpha#7" },
      });
      expect(closed[0]).toMatchObject({
        event_id: `evt_${EPISODE}_closed`,
        ts: "2026-07-11T10:20:00.000Z",
        payload: { completed: true, merged: true, cost_usd: 4.0 },
      });
    } finally {
      home.cleanup();
    }
  });

  it("keeps an unmerged ticket open with no outcome — parked awaits the human", async () => {
    const home = mergedTicketHome();
    try {
      writeClaimState(home.root, 7, ["claim 1: ended ready", "claim 2: ended returned (PR #12)"]);
      const [record] = await projector(home.root).project();
      expect(record).toMatchObject({ status: "open", artifacts: ["pull-request-12"] });
      expect(record?.closed).toBeUndefined();
      expect(record?.outcome).toBeUndefined();
    } finally {
      home.cleanup();
    }
  });

  it("closes a build ticket truthfully around a killed pass via the heartbeat reading", async () => {
    const home = makeOrgHome({
      runs: {
        records: {
          alpha: {
            "20260711-100000-build-implement": {
              envelope: envelope("20260711-100000-build-implement", {
                status: "running",
                last_seen_at: "2026-07-11T10:02:00.000Z",
                usage: { tokens_in: 4000, tokens_out: 200, cost_usd: 1.5, subagent_turns: 0 },
              }),
              events: [],
            },
            "20260711-110000-build-implement": {
              envelope: envelope("20260711-110000-build-implement", {
                trace_id: "t-build-2",
                started_at: "2026-07-11T11:00:00.000Z",
                finished_at: "2026-07-11T11:08:00.000Z",
                usage: { tokens_in: 5000, tokens_out: 700, cost_usd: 2.0, subagent_turns: 0 },
              }),
              events: [],
            },
          },
        },
      },
    });
    try {
      // The stalled run's spend was recovered by reconcile (status failed in
      // the ledger); the retry settled normally.
      writeLedger(home.root, [
        ledgerRow("20260711-100000-build-implement", 1.5, { status: "failed" }),
        ledgerRow("20260711-110000-build-implement", 2.0),
      ]);
      writeClaimState(home.root, 7, ["claim 1: ended building", "claim 2: ended merged (PR #3)"]);

      const [record] = await projector(home.root, "2026-07-11T12:00:00.000Z").project();
      expect(record).toMatchObject({ status: "closed" });
      expect(record?.turns.map((turn) => turn.status)).toEqual(["stalled", "completed"]);
      expect(record?.outcome).toMatchObject({
        completed: true,
        merged: true,
        cost_usd: 3.5,
        unsettled_runs: [],
      });
    } finally {
      home.cleanup();
    }
  });

  it("closes a turn-anchored episode once its killed pass goes stale, listing unsettled spend", async () => {
    const noTicket = envelope("20260711-060000-build-implement", {
      status: "running",
      started_at: "2026-07-11T06:00:00.000Z",
      last_seen_at: "2026-07-11T06:00:30.000Z",
      usage: { tokens_in: 2000, tokens_out: 50, cost_usd: 0.4, subagent_turns: 0 },
    });
    delete (noTicket as Partial<RunEnvelope>).ticket;
    delete (noTicket as Partial<RunEnvelope>).finished_at;
    const home = makeOrgHome({
      runs: {
        records: { alpha: { "20260711-060000-build-implement": { envelope: noTicket, events: [] } } },
      },
    });
    try {
      // Within the stall window the run is live and holds the episode open.
      const [live] = await projector(home.root, "2026-07-11T06:05:00.000Z").project();
      expect(live).toMatchObject({ status: "open" });
      expect(live?.turns[0]?.status).toBe("running");

      // Past the stall window the heartbeat is dead: the episode closes
      // truthfully — incomplete, spend not yet settled (reconcile's target).
      const [dead] = await projector(home.root, "2026-07-11T07:00:00.000Z").project();
      expect(dead).toMatchObject({ status: "closed", closed: "2026-07-11T06:00:30.000Z" });
      expect(dead?.turns[0]?.status).toBe("stalled");
      expect(dead?.outcome).toMatchObject({
        completed: false,
        cost_usd: 0,
        unsettled_runs: ["20260711-060000-build-implement"],
      });
    } finally {
      home.cleanup();
    }
  });

  it("anchors dispatched turns on the journal's TurnEvent as a feedback_thread episode", async () => {
    const noTicket = envelope("20260711-050000-support-triage", {
      trace_id: "turn-alpha-9",
      pipeline: "support",
      pass: "triage",
      role: "support",
      started_at: "2026-07-11T05:00:00.000Z",
      finished_at: "2026-07-11T05:10:00.000Z",
    });
    delete (noTicket as Partial<RunEnvelope>).ticket;
    const home = makeOrgHome({
      runs: {
        records: { alpha: { "20260711-050000-support-triage": { envelope: noTicket, events: [] } } },
      },
      state: {
        turns: {
          "turn-alpha-9": {
            turnId: "turn-alpha-9",
            role: "support",
            app: "alpha",
            phase: "done",
            attempt: 1,
            startedAt: "2026-07-11T04:59:00.000Z",
            updatedAt: "2026-07-11T05:10:00.000Z",
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
      const [record] = await projector(home.root).project();
      expect(record).toMatchObject({
        episode_id: "ep_alpha_feedback_fb-0142",
        kind: "feedback_thread",
        source: { kind: "company_event", ref: "support-feedback:fb-0142" },
        status: "closed",
      });
      expect(record?.outcome).toMatchObject({ completed: true, release_disposition: null });
      expect(record?.outcome?.merged).toBeUndefined();
    } finally {
      home.cleanup();
    }
  });
});

describe("recordLateOutcome", () => {
  it("appends a durable late outcome that survives a projection-state wipe", async () => {
    const home = mergedTicketHome();
    try {
      const p = projector(home.root);
      await p.project();
      const event = await p.recordLateOutcome(EPISODE, {
        kind: "escaped_defect",
        ref: "alpha#9",
        note: "regression reported a week later",
      });
      expect(event.event_id).toMatch(/^evt_late_[0-9a-f]{12}$/);

      const [reprojected] = await p.project();
      expect(reprojected?.late_outcomes).toEqual([
        {
          kind: "escaped_defect",
          ref: "alpha#9",
          recorded: "2026-07-11T11:00:00.000Z",
          note: "regression reported a week later",
        },
      ]);

      // The record is a projection; the outcome's durability lives in the
      // append-only event store, not in learning/episodes/.
      rmSync(episodesDir(home.root), { recursive: true });
      const [rebuilt] = await p.project();
      expect(rebuilt?.late_outcomes).toHaveLength(1);

      // Idempotent per (episode, kind, ref): a repeat emit dedups.
      await p.recordLateOutcome(EPISODE, { kind: "escaped_defect", ref: "alpha#9" });
      const lateEvents = (await readLearningEvents(home.root)).filter(
        (candidate) => candidate.type === "late_outcome",
      );
      expect(lateEvents).toHaveLength(1);
    } finally {
      home.cleanup();
    }
  });

  it("refuses an episode that was never projected", async () => {
    const home = makeOrgHome({});
    try {
      await expect(
        projector(home.root).recordLateOutcome("ep_alpha_ticket_9999", {
          kind: "escaped_defect",
          ref: "alpha#1",
        }),
      ).rejects.toThrow(/no projected record/);
    } finally {
      home.cleanup();
    }
  });
});

describe("readEpisodeRecords / get", () => {
  it("reads back what project() wrote", async () => {
    const home = mergedTicketHome();
    try {
      const p = projector(home.root);
      const projected = await p.project();
      expect(await readEpisodeRecords(home.root)).toEqual(projected);
      expect(await p.get(EPISODE)).toEqual(projected[0]);
      expect(existsSync(episodePath(home.root, EPISODE))).toBe(true);
    } finally {
      home.cleanup();
    }
  });
});

function recordBytes(root: string): Record<string, string> {
  const dir = episodesDir(root);
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    out[name] = readFileSync(join(dir, name), "utf8");
  }
  return out;
}

function existsSync(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}
