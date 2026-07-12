// Tests the dispatcher tick in src/org/dispatch.ts.
// Covers scheduled and event-triggered spawning, WIP limits, lock/recovery
// accounting, budget pauses, cadence overrides, post-spawn failure handling,
// and torn lock tolerance.
// Uses temp org homes, synthetic roles/apps YAML, and fake event sources only;
// no network, auth, real org state, or live clock is required.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dispatchTick, type DispatchSpawn } from "../src/org/dispatch.js";
import { ScheduleStore } from "../src/org/schedule.js";
import { acquireLock, lockExists } from "../src/org/locks.js";
import type { GitHubEventSource } from "../src/org/events.js";
import type { AppEntry } from "../src/org/apps.js";
import { makeOrgHome } from "./fixtures/orgHome.js";
import { FakeClock } from "./fixtures/fakeClock.js";

describe("dispatcher tick", () => {
  it("spawns a due schedule with the fixed run-role identity", async () => {
    const h = fixture({
      roles: `roles:
  planner:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - schedule: "daily 07:00"
    outputs: []
`,
    });
    const calls: Parameters<DispatchSpawn>[0][] = [];
    try {
      const result = await dispatchTick({
        runtimeHome: h.home.root,
        appsPath: h.appsPath,
        rolesPath: h.rolesPath,
        now: () => new Date("2026-07-06T10:00:00Z"),
        eventSource: emptySource(),
        spawn: async (input) => void calls.push(input),
      });

      expect(result.spawned).toHaveLength(1);
      expect(calls[0]).toMatchObject({ role: "planner", app: "alpha", runtimeHome: h.home.root });
      expect(await new ScheduleStore(h.home.root).lastFired("alpha", "planner", "daily 07:00")).toEqual(
        new Date("2026-07-06T10:00:00Z"),
      );
    } finally {
      h.cleanup();
    }
  });

  it("routes M6 daily distillation and Monday review through the existing dispatch tick", async () => {
    const h = fixture({
      maxConcurrent: 2,
      roles: `roles:
  distiller:
    runtime: claude
    model: m
    effort: medium
    delegation: {allow: []}
    triggers:
      - schedule: "daily 06:00"
    outputs: [learning-candidates]
  learning-reviewer:
    runtime: codex
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - schedule: "weekly mon 07:00"
    outputs: [learning-review-verdicts]
`,
    });
    const clock = new FakeClock("2026-07-13T07:00:00.000Z");
    try {
      const result = await dispatchTick({
        runtimeHome: h.home.root,
        appsPath: h.appsPath,
        rolesPath: h.rolesPath,
        now: () => clock.now(),
        eventSource: emptySource(),
        spawn: async () => {},
      });
      expect(result.spawned.map((turn) => `${turn.role}:${turn.trigger}`).sort()).toEqual([
        "distiller:daily 06:00",
        "learning-reviewer:weekly mon 07:00",
      ]);
    } finally {
      h.cleanup();
    }
  });

  it("event beats schedule under the WIP limit", async () => {
    const h = fixture({
      maxConcurrent: 1,
      roles: `roles:
  planner:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - schedule: "daily 07:00"
    outputs: []
  builder:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - schedule: "hourly"
      - event: ticket-ready
    outputs: []
`,
    });
    try {
      const result = await dispatchTick({
        runtimeHome: h.home.root,
        appsPath: h.appsPath,
        rolesPath: h.rolesPath,
        now: () => new Date("2026-07-06T10:00:00Z"),
        eventSource: source({ tickets: [{ issueNumber: 1 }] }),
        spawn: async () => {},
      });
      expect(result.spawned).toHaveLength(1);
      expect(result.spawned[0]?.triggerKind).toBe("event");
      expect(result.spawned[0]?.trigger).toBe("ticket-ready");
    } finally {
      h.cleanup();
    }
  });

  it("fresh locks skip and manual triggers never fire", async () => {
    const h = fixture({
      maxConcurrent: 1,
      roles: `roles:
  planner:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - manual: true
      - schedule: "hourly"
    outputs: []
`,
    });
    try {
      await acquireLock(h.home.root, {
        app: "alpha",
        role: "planner",
        turnId: "busy",
        now: new Date("2026-07-06T09:59:00Z"),
      });
      const result = await dispatchTick({
        runtimeHome: h.home.root,
        appsPath: h.appsPath,
        rolesPath: h.rolesPath,
        now: () => new Date("2026-07-06T10:00:00Z"),
        eventSource: emptySource(),
        spawn: async () => {
          throw new Error("should not spawn");
        },
      });
      expect(result.spawned).toEqual([]);
      expect(result.skipped).toContain("org WIP limit reached");
    } finally {
      h.cleanup();
    }
  });

  it("records schedule fired only after spawn succeeds", async () => {
    const h = fixture({
      roles: `roles:
  planner:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - schedule: "daily 07:00"
    outputs: []
`,
    });
    try {
      const result = await dispatchTick({
        runtimeHome: h.home.root,
        appsPath: h.appsPath,
        rolesPath: h.rolesPath,
        now: () => new Date("2026-07-06T10:00:00Z"),
        eventSource: emptySource(),
        spawn: async () => {
          throw new Error("spawn failed");
        },
      });
      expect(result.errors[0]).toContain("spawn failed");
      expect(await new ScheduleStore(h.home.root).lastFired("alpha", "planner", "daily 07:00")).toBeUndefined();
    } finally {
      h.cleanup();
    }
  });

  it("keeps the lock when post-spawn bookkeeping fails after a real spawn", async () => {
    const h = fixture({
      roles: `roles:
  builder:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - event: ticket-ready
    outputs: []
`,
    });
    try {
      // Make markConsumed fail AFTER the spawn by turning consumed.json into a
      // directory, so its atomic rename throws (readConsumed tolerates it).
      mkdirSync(join(h.home.root, "state", "events", "consumed.json"), { recursive: true });
      const spawned: string[] = [];
      const result = await dispatchTick({
        runtimeHome: h.home.root,
        appsPath: h.appsPath,
        rolesPath: h.rolesPath,
        now: () => new Date("2026-07-06T10:00:00Z"),
        eventSource: source({ tickets: [{ issueNumber: 1 }] }),
        spawn: async (input) => void spawned.push(input.turnId),
      });
      expect(spawned).toHaveLength(1);
      expect(result.errors.join("\n")).toContain("post-spawn bookkeeping failed");
      // The lock for the already-running turn must survive so the next tick
      // cannot dispatch a second concurrent turn for the same (app, role).
      expect(lockExists(h.home.root, "alpha", "builder")).toBe(true);
    } finally {
      h.cleanup();
    }
  });

  it("skips due roles with no configured execution path", async () => {
    const h = fixture({
      roles: `roles:
  reviewer:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - schedule: "hourly"
    outputs: []
`,
    });
    try {
      const result = await dispatchTick({
        runtimeHome: h.home.root,
        appsPath: h.appsPath,
        rolesPath: h.rolesPath,
        now: () => new Date("2026-07-06T10:00:00Z"),
        eventSource: emptySource(),
        spawn: async () => {
          throw new Error("should not spawn");
        },
      });
      expect(result.spawned).toEqual([]);
      expect(result.skipped[0]).toContain("no route");
    } finally {
      h.cleanup();
    }
  });

  it("counts recovery re-spawns against the org WIP limit", async () => {
    // Two stale locks whose turns resume (spawn) this tick. With
    // max_concurrent_turns=2 they consume the whole WIP budget, so a
    // freshly-due turn must NOT also spawn on top of them.
    const home = makeOrgHome({
      state: {
        locks: {
          "alpha--builder": {
            app: "alpha",
            role: "builder",
            pid: 4001,
            turnId: "stale-builder",
            startedAt: "2026-07-06T09:00:00.000Z",
            heartbeatAt: "2026-07-06T09:00:00.000Z",
          },
          "alpha--reviewer": {
            app: "alpha",
            role: "reviewer",
            pid: 4002,
            turnId: "stale-reviewer",
            startedAt: "2026-07-06T09:00:00.000Z",
            heartbeatAt: "2026-07-06T09:00:00.000Z",
          },
        },
        turns: {
          "stale-builder": {
            turnId: "stale-builder",
            role: "builder",
            app: "alpha",
            phase: "running",
            attempt: 0,
            startedAt: "2026-07-06T09:00:00.000Z",
            updatedAt: "2026-07-06T09:00:00.000Z",
            session: { runtime: "claude", id: "sb" },
          },
          "stale-reviewer": {
            turnId: "stale-reviewer",
            role: "reviewer",
            app: "alpha",
            phase: "running",
            attempt: 0,
            startedAt: "2026-07-06T09:00:00.000Z",
            updatedAt: "2026-07-06T09:00:00.000Z",
            session: { runtime: "claude", id: "sr" },
          },
        },
      },
      approvals: true,
    });
    const appsPath = join(home.root, "apps.yaml");
    const rolesPath = join(home.root, "roles.yaml");
    writeFileSync(
      appsPath,
      `org:
  name: test
  max_concurrent_turns: 2
defaults:
  budget_usd_month: 1000
apps:
  alpha:
    repo: owner/repo
    status: live
    cadence: {}
`,
      "utf8",
    );
    writeFileSync(
      rolesPath,
      `roles:
  planner:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - schedule: "daily 07:00"
    outputs: []
`,
      "utf8",
    );
    const calls: string[] = [];
    try {
      const result = await dispatchTick({
        runtimeHome: home.root,
        appsPath,
        rolesPath,
        now: () => new Date("2026-07-06T10:00:00Z"),
        eventSource: emptySource(),
        spawn: async (input) => void calls.push(input.turnId),
      });
      // Only the two recovery re-spawns run; no fresh planner turn.
      expect(calls.sort()).toEqual(["stale-builder", "stale-reviewer"]);
      expect(calls.some((id) => id.includes("planner"))).toBe(false);
      expect(result.skipped).toContain("org WIP limit reached");
    } finally {
      home.cleanup();
    }
  });

  it("auto-pauses and skips an app over its monthly budget cap on the tick", async () => {
    const h = fixture({
      roles: `roles:
  planner:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - schedule: "daily 07:00"
    outputs: []
`,
    });
    try {
      // alpha (budget 1000) has already spent 1200 this month.
      mkdirSync(join(h.home.root, "telemetry"), { recursive: true });
      writeFileSync(
        join(h.home.root, "telemetry", "2026-07-01.jsonl"),
        `${JSON.stringify({ app: "alpha", costUsd: 1200 })}\n`,
        "utf8",
      );
      const result = await dispatchTick({
        runtimeHome: h.home.root,
        appsPath: h.appsPath,
        rolesPath: h.rolesPath,
        now: () => new Date("2026-07-06T10:00:00Z"),
        eventSource: emptySource(),
        spawn: async () => {
          throw new Error("should not spawn a budget-paused app");
        },
      });
      expect(result.spawned).toEqual([]);
      expect(result.skipped.join("\n")).toContain("alpha: budget overlay paused");
      const { isOverlayPaused } = await import("../src/org/budget.js");
      expect(await isOverlayPaused(h.home.root, "alpha")).toBe(true);
    } finally {
      h.cleanup();
    }
  });

  it("tolerates a torn lock file instead of wedging the whole tick", async () => {
    const h = fixture({
      roles: `roles:
  planner:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - schedule: "daily 07:00"
    outputs: []
`,
    });
    try {
      // A lock write interrupted by a crash/SIGKILL leaves a truncated file;
      // listLocks/freshLockCount must skip it, not throw out of dispatchTick.
      mkdirSync(join(h.home.root, "locks"), { recursive: true });
      writeFileSync(join(h.home.root, "locks", "other--builder.lock"), '{"app":"other"', "utf8");
      const result = await dispatchTick({
        runtimeHome: h.home.root,
        appsPath: h.appsPath,
        rolesPath: h.rolesPath,
        now: () => new Date("2026-07-06T10:00:00Z"),
        eventSource: emptySource(),
        spawn: async () => {},
      });
      expect(result.spawned).toHaveLength(1);
      expect(result.errors).toEqual([]);
    } finally {
      h.cleanup();
    }
  });

  it("routes cadence overrides by the effective trigger", async () => {
    const h = fixture({
      cadence: `      planner:
        - schedule: "daily 08:00"
`,
      roles: `roles:
  planner:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - schedule: "weekly mon"
    outputs: []
`,
    });
    try {
      const result = await dispatchTick({
        runtimeHome: h.home.root,
        appsPath: h.appsPath,
        rolesPath: h.rolesPath,
        now: () => new Date("2026-07-06T10:00:00Z"),
        eventSource: emptySource(),
        spawn: async () => {},
      });
      expect(result.spawned).toHaveLength(1);
      expect(result.spawned[0]).toMatchObject({
        role: "planner",
        triggerKind: "schedule",
        trigger: "daily 08:00",
      });
    } finally {
      h.cleanup();
    }
  });
});

function fixture(options: { roles: string; maxConcurrent?: number; cadence?: string }) {
  const home = makeOrgHome({ state: true, approvals: true });
  const appsPath = join(home.root, "apps.yaml");
  const rolesPath = join(home.root, "roles.yaml");
  writeFileSync(
    appsPath,
    `org:
  name: test
  max_concurrent_turns: ${options.maxConcurrent ?? 2}
defaults:
  budget_usd_month: 1000
apps:
  alpha:
    repo: owner/repo
    status: live
    cadence:
${options.cadence ?? ""}
`,
    "utf8",
  );
  writeFileSync(rolesPath, options.roles, "utf8");
  return { home, appsPath, rolesPath, cleanup: () => home.cleanup() };
}

function source(options: { tickets?: { issueNumber: number }[] }): GitHubEventSource {
  return {
    ticketReady: async (_app: AppEntry) => options.tickets ?? [],
    prOpened: async () => [],
    ciFailed: async () => [],
    releaseShipped: async () => [],
  };
}

function emptySource(): GitHubEventSource {
  return source({});
}
