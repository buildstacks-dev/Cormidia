import { describe, expect, it } from "vitest";
import { dispatchTick } from "../src/org/dispatch.js";
import { executePipeline } from "../src/loop/pipeline.js";
import { FakeRuntime } from "../src/runtime/testing/fakeRuntime.js";
import type { RoleConfig, TurnResult } from "../src/runtime/types.js";
import { acquireLock } from "../src/org/locks.js";
import { writeJournalPatch } from "../src/org/journal.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

const ROLE: RoleConfig = {
  name: "builder",
  runtime: "claude",
  model: "m",
  effort: "high",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 5,
};

const RESULT: TurnResult = {
  status: "completed",
  summary: "done",
  artifacts: [],
  session: { runtime: "claude", id: "s" },
  usage: { tokensIn: 1, tokensOut: 1, costUsd: 0, subagentTurns: 0, wallClockMs: 1 },
  escalations: [],
};

describe("wall-clock and turn caps", () => {
  it("passes per-pass max_turns into TurnRequest", async () => {
    const home = makeOrgHome({ runs: { apps: ["alpha"] } });
    const runtime = new FakeRuntime([{ result: RESULT }]);
    try {
      await executePipeline({
        pipeline: {
          name: "cap",
          mechanical: false,
          passes: [{ id: "implement", role: "builder", template: "", maxTurns: 7 }],
        },
        selection: { tier: "standard" },
        roles: { builder: ROLE },
        runtimeFor: () => runtime,
        briefFor: () => "brief",
        promptsDir: ".",
        context: { taste: [], memoryExcerpts: [] },
        workdir: home.root,
        hooks: { gate: () => ({ allow: true }) },
        runlog: { root: home.root, app: "alpha", traceId: "trace" },
      });
      expect(runtime.calls[0]?.req.maxTurns).toBe(7);
    } finally {
      home.cleanup();
    }
  });

  it("kills a running pass past the wall-clock cap and enters recovery", async () => {
    const home = makeOrgHome({ state: true, approvals: true });
    const killed: number[] = [];
    const spawned: string[] = [];
    try {
      await acquireLock(home.root, {
        app: "alpha",
        role: "builder",
        turnId: "hung",
        now: new Date("2026-07-06T00:00:00Z"),
        pid: 12345,
      });
      await writeJournalPatch(
        home.root,
        "hung",
        {
          role: "builder",
          app: "alpha",
          phase: "running",
          attempt: 0,
          passStartedAt: "2026-07-06T00:00:00.000Z",
          pid: 12345,
          session: { runtime: "claude", id: "s1" },
        },
        new Date("2026-07-06T00:00:00Z"),
      );

      const result = await dispatchTick({
        runtimeHome: home.root,
        appsPath: "apps.yaml",
        rolesPath: "roles.yaml",
        now: () => new Date("2026-07-06T01:01:00Z"),
        eventSource: {
          ticketReady: async () => [],
          prOpened: async () => [],
          ciFailed: async () => [],
          releaseShipped: async () => [],
        },
        kill: (pid) => void killed.push(pid),
        spawn: async (input) => void spawned.push(input.turnId),
      });

      expect(killed).toEqual([12345]);
      expect(spawned).toContain("hung");
      expect(result.skipped.join("\n")).toContain("recovered resume");
    } finally {
      home.cleanup();
    }
  });

  it("honors a per-pass wall-clock cap tighter than the 60-min default", async () => {
    // A pass that recorded wall_clock_minutes: 5 (300_000 ms) is killed once it
    // runs past 5 minutes, even though the lock is still heartbeating (alive).
    const home = makeOrgHome({ state: true, approvals: true });
    const killed: number[] = [];
    const spawned: string[] = [];
    const now = new Date("2026-07-06T00:06:00Z");
    try {
      await acquireLock(home.root, { app: "alpha", role: "builder", turnId: "hung", now, pid: 4242 });
      await writeJournalPatch(
        home.root,
        "hung",
        {
          role: "builder",
          app: "alpha",
          phase: "running",
          attempt: 0,
          passStartedAt: "2026-07-06T00:00:00.000Z",
          wallClockCapMs: 5 * 60_000,
          pid: 4242,
          session: { runtime: "claude", id: "s1" },
        },
        new Date("2026-07-06T00:00:00Z"),
      );

      const result = await dispatchTick({
        runtimeHome: home.root,
        appsPath: "apps.yaml",
        rolesPath: "roles.yaml",
        now: () => now,
        eventSource: {
          ticketReady: async () => [],
          prOpened: async () => [],
          ciFailed: async () => [],
          releaseShipped: async () => [],
        },
        kill: (pid) => void killed.push(pid),
        spawn: async (input) => void spawned.push(input.turnId),
      });

      expect(killed).toEqual([4242]);
      expect(spawned).toContain("hung");
      expect(result.skipped.join("\n")).toContain("killed hung turn");
    } finally {
      home.cleanup();
    }
  });

  it("does not kill a per-pass-capped turn still within its cap", async () => {
    // Same 5-minute cap, only 4 minutes elapsed, lock fresh: no kill.
    const home = makeOrgHome({ state: true, approvals: true });
    const killed: number[] = [];
    const spawned: string[] = [];
    const now = new Date("2026-07-06T00:04:00Z");
    try {
      await acquireLock(home.root, { app: "alpha", role: "builder", turnId: "hung", now, pid: 4242 });
      await writeJournalPatch(
        home.root,
        "hung",
        {
          role: "builder",
          app: "alpha",
          phase: "running",
          attempt: 0,
          passStartedAt: "2026-07-06T00:00:00.000Z",
          wallClockCapMs: 5 * 60_000,
          pid: 4242,
          session: { runtime: "claude", id: "s1" },
        },
        new Date("2026-07-06T00:00:00Z"),
      );

      const result = await dispatchTick({
        runtimeHome: home.root,
        appsPath: "apps.yaml",
        rolesPath: "roles.yaml",
        now: () => now,
        eventSource: {
          ticketReady: async () => [],
          prOpened: async () => [],
          ciFailed: async () => [],
          releaseShipped: async () => [],
        },
        kill: (pid) => void killed.push(pid),
        spawn: async (input) => void spawned.push(input.turnId),
      });

      expect(killed).toEqual([]);
      expect(spawned).not.toContain("hung");
      expect(result.skipped.join("\n")).not.toContain("killed hung turn");
    } finally {
      home.cleanup();
    }
  });

  it("back-compat: a journal without the cap field is not killed before the 60-min default", async () => {
    // No wallClockCapMs recorded (pre-field journal); 59 minutes elapsed, lock
    // fresh -> the default 60-min cap has not been reached.
    const home = makeOrgHome({ state: true, approvals: true });
    const killed: number[] = [];
    const spawned: string[] = [];
    const now = new Date("2026-07-06T00:59:00Z");
    try {
      await acquireLock(home.root, { app: "alpha", role: "builder", turnId: "hung", now, pid: 4242 });
      await writeJournalPatch(
        home.root,
        "hung",
        {
          role: "builder",
          app: "alpha",
          phase: "running",
          attempt: 0,
          passStartedAt: "2026-07-06T00:00:00.000Z",
          pid: 4242,
          session: { runtime: "claude", id: "s1" },
        },
        new Date("2026-07-06T00:00:00Z"),
      );

      const result = await dispatchTick({
        runtimeHome: home.root,
        appsPath: "apps.yaml",
        rolesPath: "roles.yaml",
        now: () => now,
        eventSource: {
          ticketReady: async () => [],
          prOpened: async () => [],
          ciFailed: async () => [],
          releaseShipped: async () => [],
        },
        kill: (pid) => void killed.push(pid),
        spawn: async (input) => void spawned.push(input.turnId),
      });

      expect(killed).toEqual([]);
      expect(spawned).not.toContain("hung");
    } finally {
      home.cleanup();
    }
  });
});
