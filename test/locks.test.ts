import { describe, expect, it } from "vitest";
import { acquireLock, heartbeatLock, isStale, releaseLock } from "../src/org/locks.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

describe("turn locks", () => {
  it("acquires with O_EXCL semantics, heartbeats, stales, and releases", async () => {
    const home = makeOrgHome({ state: true });
    try {
      const first = await acquireLock(home.root, {
        app: "alpha",
        role: "builder",
        turnId: "t1",
        now: new Date("2026-07-06T00:00:00Z"),
        pid: 123,
      });
      expect(first.acquired).toBe(true);

      const second = await acquireLock(home.root, {
        app: "alpha",
        role: "builder",
        turnId: "t2",
      });
      expect(second.acquired).toBe(false);
      expect(second.lock.turnId).toBe("t1");

      const beat = await heartbeatLock(
        home.root,
        "alpha",
        "builder",
        new Date("2026-07-06T00:01:00Z"),
      );
      expect(beat.heartbeatAt).toBe("2026-07-06T00:01:00.000Z");
      expect(isStale(beat, new Date("2026-07-06T00:03:00Z"))).toBe(false);
      expect(isStale(beat, new Date("2026-07-06T00:03:01Z"))).toBe(true);

      await releaseLock(home.root, "alpha", "builder");
      const third = await acquireLock(home.root, { app: "alpha", role: "builder", turnId: "t3" });
      expect(third.acquired).toBe(true);
    } finally {
      home.cleanup();
    }
  });
});
