// Tests event polling and dedupe in src/org/events.ts.
// Covers GitHub-style event keys, company-event inbox parsing/routing, consumed
// key filtering, torn consumed files, malformed payload errors, and atomic writes.
// Uses temp org-home state plus fake event sources; no network, auth, real
// GitHub/org state, or live clock is required.

import { readdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dedupKey, EventStore, roleConsumedKey, type GitHubEventSource } from "../src/org/events.js";
import type { AppEntry } from "../src/org/apps.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

const APP: AppEntry = {
  name: "alpha",
  repo: "owner/repo",
  status: "live",
  budgetUsdMonth: 1000,
  cadence: {},
};

const BETA_APP: AppEntry = {
  ...APP,
  name: "beta",
};

const HEALTH_ALERT = {
  kind: "health-alert",
  id: "health-001",
  app: "alpha",
  occurred_at: "2026-07-06T12:00:00Z",
  source: "fixture",
  severity: "critical",
  service: "web",
  status: "down",
  summary: "/health returned 500 for three consecutive checks.",
};

describe("event polling", () => {
  it("uses the architecture's stable dedup keys", () => {
    expect(dedupKey("ticket-ready", { issueNumber: 4 })).toBe("ticket-ready:4");
    expect(dedupKey("pr-opened", { prNumber: 5, headSha: "abc" })).toBe("pr-opened:5@abc");
    expect(dedupKey("ci-failed", { sha: "abc", check: "test" })).toBe("ci-failed:abc:test");
    expect(dedupKey("release-shipped", { tag: "v1" })).toBe("release:v1");
    expect(dedupKey("alert-webhook", { filename: "event.json" })).toBe("event.json");
  });

  it("filters consumed keys and returns inbox files once after marking consumed", async () => {
    // Inbox payloads now carry a typed company-lifecycle kind (docs/event-schemas.md,
    // GAP B): the file-drop is a valid company event, not arbitrary JSON.
    const home = makeOrgHome({ state: { eventsInbox: { "alert.json": HEALTH_ALERT } } });
    const source = fakeSource({ tickets: [{ issueNumber: 1 }] });
    try {
      const store = new EventStore(home.root);
      const first = await store.poll(APP, source);
      expect(first.events.map((event) => event.key).sort()).toEqual(["alert.json", "ticket-ready:1"]);
      await store.markConsumed(first.events.map((event) => event.key));
      const second = await store.poll(APP, source);
      expect(second.events).toEqual([]);
    } finally {
      home.cleanup();
    }
  });

  it("retires the bare key only after every subscriber consumed (issue #25)", async () => {
    const home = makeOrgHome({ state: { eventsInbox: { "alert.json": HEALTH_ALERT } } });
    try {
      const store = new EventStore(home.root);
      await store.markRoleConsumed("alert.json", "planner", ["planner", "support"]);
      let consumed = await store.readConsumed();
      expect(consumed).toContain(roleConsumedKey("alert.json", "planner"));
      expect(consumed).not.toContain("alert.json");
      // Still polls: the bare key is what poll filters on.
      expect((await store.poll(APP, fakeSource({}))).events.map((e) => e.key)).toEqual(["alert.json"]);

      await store.markRoleConsumed("alert.json", "support", ["planner", "support"]);
      consumed = await store.readConsumed();
      expect(consumed).toContain("alert.json");
      expect((await store.poll(APP, fakeSource({}))).events).toEqual([]);
    } finally {
      home.cleanup();
    }
  });

  it("routes inbox files under their parsed company-lifecycle kind", async () => {
    const home = makeOrgHome({ state: { eventsInbox: { "alert.json": HEALTH_ALERT } } });
    try {
      const store = new EventStore(home.root);
      const result = await store.poll(APP, fakeSource({}));
      expect(result.events).toEqual([
        {
          kind: "health-alert",
          key: "alert.json",
          app: "alpha",
          payload: { ...HEALTH_ALERT, filename: "alert.json" },
        },
      ]);
      expect(result.errors).toEqual([]);
    } finally {
      home.cleanup();
    }
  });

  it("only returns inbox files to the app named in the company event payload", async () => {
    const betaAlert = { ...HEALTH_ALERT, id: "health-beta-001", app: "beta" };
    const home = makeOrgHome({ state: { eventsInbox: { "beta-alert.json": betaAlert } } });
    try {
      const store = new EventStore(home.root);
      const alphaResult = await store.poll(APP, fakeSource({}));
      expect(alphaResult.events).toEqual([]);
      expect(alphaResult.errors).toEqual([]);

      const betaResult = await store.poll(BETA_APP, fakeSource({}));
      expect(betaResult.events).toEqual([
        {
          kind: "health-alert",
          key: "beta-alert.json",
          app: "beta",
          payload: { ...betaAlert, filename: "beta-alert.json" },
        },
      ]);
      expect(betaResult.errors).toEqual([]);
    } finally {
      home.cleanup();
    }
  });

  it("tolerates a torn consumed.json instead of throwing (no dispatcher wedge)", async () => {
    const home = makeOrgHome({ state: { consumedEventKeys: [] } });
    try {
      // Simulate a write interrupted by a crash/SIGKILL: a truncated JSON file.
      writeFileSync(home.paths.consumedEvents, '["ticket-ready:1', "utf8");
      const store = new EventStore(home.root);
      await expect(store.readConsumed()).resolves.toEqual([]);
      // poll must not throw even with a corrupt dedup file.
      const result = await store.poll(APP, fakeSource({ tickets: [{ issueNumber: 1 }] }));
      expect(result.events.map((event) => event.key)).toContain("ticket-ready:1");
    } finally {
      home.cleanup();
    }
  });

  it("surfaces a malformed inbox payload loudly and keeps sibling files flowing", async () => {
    const home = makeOrgHome({
      state: { eventsInbox: { "bad.json": { kind: "health-alert" }, "good.json": HEALTH_ALERT } },
    });
    try {
      const store = new EventStore(home.root);
      const result = await store.poll(APP, fakeSource({}));
      // The malformed drop is reported, never silently skipped...
      expect(result.errors).toEqual([
        {
          code: "error_event_source",
          app: "alpha",
          kind: "alert-webhook",
          message: expect.stringContaining("inbox bad.json:"),
        },
      ]);
      // ...and the valid sibling still routes.
      expect(result.events.map((event) => event.key)).toEqual(["good.json"]);
    } finally {
      home.cleanup();
    }
  });

  it("writes consumed.json atomically (no leftover temp files)", async () => {
    const home = makeOrgHome({ state: true });
    try {
      const store = new EventStore(home.root);
      await store.markConsumed(["ticket-ready:1"]);
      const files = readdirSync(`${home.root}/state/events`);
      expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
    } finally {
      home.cleanup();
    }
  });

  it("turns injected API errors into loud machine-coded errors and keeps polling", async () => {
    const home = makeOrgHome({ state: true });
    try {
      const store = new EventStore(home.root);
      const result = await store.poll(APP, {
        ...fakeSource({}),
        ticketReady: async () => {
          throw new Error("rate limited");
        },
      });
      expect(result.errors).toEqual([
        {
          code: "error_event_source",
          app: "alpha",
          kind: "ticket-ready",
          message: "rate limited",
        },
      ]);
      writeFileSync(home.paths.eventsInboxFile("later"), JSON.stringify(HEALTH_ALERT), "utf8");
      expect((await store.poll(APP, fakeSource({}))).events[0]?.key).toBe("later.json");
    } finally {
      home.cleanup();
    }
  });
});

function fakeSource(options: { tickets?: { issueNumber: number }[] }): GitHubEventSource {
  return {
    ticketReady: async () => options.tickets ?? [],
    prOpened: async () => [],
    ciFailed: async () => [],
    releaseShipped: async () => [],
  };
}
