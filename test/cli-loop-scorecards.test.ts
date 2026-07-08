// Tests loop scorecard persistence used by the manual loop CLI path.
// Covers writing builder review-cycle rows, replay dedupe by turn id, and
// no-op behavior when the loop returns no events.
// makeOrgHome is only a disposable scorecard filesystem; no network, auth,
// real org state, or wall-clock time is required.

import { describe, expect, it } from "vitest";
import { persistLoopScorecards } from "../src/cli/loop.js";
import { readScorecards } from "../src/org/scorecards.js";
import type { ScorecardEvent as LoopScorecardEvent } from "../src/loop/types.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

// Regression: `operon loop` used to drop every scorecard event the driver
// returned, so `operon retro` was blind to the real build loop. Persisting them
// (mirroring the autonomous dispatch path) is what makes retro see loop passes.
describe("persistLoopScorecards", () => {
  it("writes builder-attributed review_cycles rows readable by readScorecards", async () => {
    const home = makeOrgHome();
    try {
      const events: LoopScorecardEvent[] = [
        { type: "review_cycles", turnId: "loop-delta-1", ticketRef: "#7", value: 0 },
        { type: "review_cycles", turnId: "loop-delta-1", ticketRef: "#8", value: 1 },
      ];

      const appended = await persistLoopScorecards(
        home.root,
        "operon-sandbox-delta",
        events,
        new Date("2026-07-06T12:00:00Z"),
      );
      expect(appended).toBe(2);

      const rows = await readScorecards(home.root, "operon-sandbox-delta", "builder");
      expect(rows.map((row) => ({ type: row.type, ticketRef: row.ticketRef, value: row.value }))).toEqual([
        { type: "review_cycles", ticketRef: "#7", value: 0 },
        { type: "review_cycles", ticketRef: "#8", value: 1 },
      ]);
    } finally {
      home.cleanup();
    }
  });

  it("dedupes a replayed tick and returns zero new rows", async () => {
    const home = makeOrgHome();
    try {
      const events: LoopScorecardEvent[] = [
        { type: "review_cycles", turnId: "loop-delta-1", ticketRef: "#7", value: 0 },
      ];
      const first = await persistLoopScorecards(home.root, "operon-sandbox-delta", events);
      const second = await persistLoopScorecards(home.root, "operon-sandbox-delta", events);
      expect(first).toBe(1);
      expect(second).toBe(0);
      expect(await readScorecards(home.root, "operon-sandbox-delta", "builder")).toHaveLength(1);
    } finally {
      home.cleanup();
    }
  });

  it("no events is a no-op", async () => {
    const home = makeOrgHome();
    try {
      expect(await persistLoopScorecards(home.root, "operon-sandbox-delta", [])).toBe(0);
    } finally {
      home.cleanup();
    }
  });
});
