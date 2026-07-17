// Concurrent acquire/release race for the turn lock in src/org/locks.ts (F-007).
//
// acquireLock uses open(path,"wx") (O_EXCL) atomically, but its EEXIST branch
// re-read the holder with a bare readFile. A concurrent release between the
// EEXIST and the read threw an unhandled ENOENT out of acquireLock — and, at
// the dispatch call site, out of the whole tick, dropping every remaining due
// turn. Two roles on one app due in the same tick is the documented EXPECTED
// case, so this window is the normal steady state of a busy org.
//
// Modeled on the repo's one genuine race test (test/settlement/property.test.ts,
// F-SET-01): Promise.all over many concurrent acquirers/releasers. Promise.all
// resolving (no rejection) is the "tick survives" assertion; maxActive === 1 is
// mutual exclusion. No network, auth, real org state, or live clock required.

import { afterEach, describe, expect, it } from "vitest";
import { acquireLock, releaseLock } from "../src/org/locks.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

describe("turn lock under concurrent release (F-007)", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("tolerates a concurrent release during acquire — no unhandled ENOENT, exactly one holder", async () => {
    home = makeOrgHome({ state: true });
    const app = "alpha";
    const role = "builder";

    let active = 0;
    let maxActive = 0;
    let acquisitions = 0;

    // Many workers hammer acquire/release on ONE (app, role). The acquirer holds
    // across an event-loop turn, then releases — maximizing the
    // EEXIST -> read -> ENOENT window that aborted the tick pre-fix.
    const workers = Array.from({ length: 32 }, () =>
      (async () => {
        for (let i = 0; i < 40; i += 1) {
          const result = await acquireLock(home.root, { app, role, turnId: `t-${i}` });
          // Every contention result is a well-formed holder snapshot, never a throw.
          expect(result.lock.app).toBe(app);
          if (result.acquired) {
            active += 1;
            maxActive = Math.max(maxActive, active);
            acquisitions += 1;
            await new Promise((resolve) => setTimeout(resolve, 0));
            active -= 1;
            await releaseLock(home.root, app, role);
          }
        }
      })(),
    );

    // The whole batch settles without any unhandled ENOENT rejection.
    await expect(Promise.all(workers)).resolves.toBeDefined();
    // Mutual exclusion held throughout — never two holders in the critical section.
    expect(maxActive).toBe(1);
    // Progress was made: the race did not livelock every worker.
    expect(acquisitions).toBeGreaterThan(0);
  });
});
