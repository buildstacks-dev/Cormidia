import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dedupKey, EventStore, type GitHubEventSource } from "../src/org/events.js";
import type { AppEntry } from "../src/org/apps.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

const APP: AppEntry = {
  name: "alpha",
  repo: "owner/repo",
  status: "live",
  budgetUsdMonth: 1000,
  cadence: {},
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
    const home = makeOrgHome({ state: { eventsInbox: { "alert.json": { severity: "high" } } } });
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
      writeFileSync(home.paths.eventsInboxFile("later"), JSON.stringify({ ok: true }), "utf8");
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
