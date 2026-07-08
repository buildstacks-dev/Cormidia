// Tests schedule grammar and the file-backed ScheduleStore.
// Covers hourly/daily/weekly/every-N-minute due calculations, missed-window
// collapse, inclusive boundaries, and explicit last-fired persistence.
// Uses FakeClock and a temp org-home state tree; no network, auth, real org
// state, or live wall clock is required.

import { describe, expect, it } from "vitest";
import { isDue, nextFireAfter, ScheduleStore } from "../src/org/schedule.js";
import { FakeClock } from "./fixtures/fakeClock.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

describe("schedule trigger grammar", () => {
  it("hourly is due at 61 minutes but not at 10", () => {
    const last = new Date("2026-07-06T08:00:00");
    expect(isDue("hourly", last, new Date("2026-07-06T08:10:00"))).toBe(false);
    expect(isDue("hourly", last, new Date("2026-07-06T09:01:00"))).toBe(true);
  });

  it("daily missed windows collapse to one firing", () => {
    const last = new Date("2026-07-03T08:00:00");
    expect(nextFireAfter("daily 08:00", last)).toEqual(new Date("2026-07-04T08:00:00"));
    expect(isDue("daily 08:00", last, new Date("2026-07-06T09:00:00"))).toBe(true);
  });

  it("weekly defaults to 09:00 local time", () => {
    const next = nextFireAfter("weekly mon", new Date("2026-07-06T08:00:00"));
    expect(next).toEqual(new Date("2026-07-06T09:00:00"));
  });

  it("every-30m boundary is inclusive", () => {
    expect(isDue("every 30m", new Date("2026-07-06T08:00:00"), new Date("2026-07-06T08:30:00"))).toBe(true);
    expect(isDue("every 30m", new Date("2026-07-06T08:00:00"), new Date("2026-07-06T08:29:59"))).toBe(false);
  });

  it("schedule store records only explicit fires", async () => {
    const home = makeOrgHome({ state: true });
    const clock = new FakeClock("2026-07-06T08:00:00Z");
    try {
      const store = new ScheduleStore(home.root);
      expect(await store.lastFired("alpha", "builder", "hourly")).toBeUndefined();
      await store.recordFired("alpha", "builder", "hourly", clock.now());
      expect(await store.lastFired("alpha", "builder", "hourly")).toEqual(clock.now());
    } finally {
      home.cleanup();
    }
  });
});
