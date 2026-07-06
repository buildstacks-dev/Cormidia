import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dispatchTick, type DispatchSpawn } from "../src/org/dispatch.js";
import { ScheduleStore } from "../src/org/schedule.js";
import { acquireLock } from "../src/org/locks.js";
import type { GitHubEventSource } from "../src/org/events.js";
import type { AppEntry } from "../src/org/apps.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

describe("dispatcher tick", () => {
  it("spawns a due schedule with the fixed run-role identity", async () => {
    const h = fixture({
      roles: `roles:
  builder:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - schedule: "hourly"
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
      expect(calls[0]).toMatchObject({ role: "builder", app: "alpha", runtimeHome: h.home.root });
      expect(await new ScheduleStore(h.home.root).lastFired("alpha", "builder", "hourly")).toEqual(
        new Date("2026-07-06T10:00:00Z"),
      );
    } finally {
      h.cleanup();
    }
  });

  it("event beats schedule under the WIP limit", async () => {
    const h = fixture({
      maxConcurrent: 1,
      roles: `roles:
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
  builder:
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
        role: "builder",
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
  builder:
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
          throw new Error("spawn failed");
        },
      });
      expect(result.errors[0]).toContain("spawn failed");
      expect(await new ScheduleStore(h.home.root).lastFired("alpha", "builder", "hourly")).toBeUndefined();
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
      expect(result.skipped[0]).toContain("no configured path");
    } finally {
      h.cleanup();
    }
  });
});

function fixture(options: { roles: string; maxConcurrent?: number }) {
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
    cadence: {}
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
