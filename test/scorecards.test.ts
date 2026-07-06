import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SCORECARD_EVENT_KINDS,
  appendScorecardEvent,
  readScorecards,
  ScorecardValidationError,
  scorecardPath,
} from "../src/org/scorecards.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

describe("scorecards", () => {
  it("appends each scorecard kind with app role and timestamp", async () => {
    const home = makeOrgHome();
    try {
      for (const type of SCORECARD_EVENT_KINDS) {
        await appendScorecardEvent(
          home.root,
          { type, app: "alpha", role: "builder", turnId: `turn-${type}`, value: 1 },
          new Date("2026-07-06T12:00:00Z"),
        );
      }
      const rows = await readScorecards(home.root, "alpha", "builder");
      expect(rows.map((row) => row.type)).toEqual([...SCORECARD_EVENT_KINDS]);
      expect(rows[0]).toMatchObject({ app: "alpha", role: "builder", timestamp: "2026-07-06T12:00:00.000Z" });
      expect(existsSync(scorecardPath(home.root, "alpha", "builder"))).toBe(true);
    } finally {
      home.cleanup();
    }
  });

  it("rejects unknown event kind with a named error", async () => {
    const home = makeOrgHome();
    try {
      await expect(
        appendScorecardEvent(home.root, { type: "vibes", app: "alpha", role: "builder" }),
      ).rejects.toThrow(ScorecardValidationError);
    } finally {
      home.cleanup();
    }
  });

  it("filters by since and dedupes reruns by turn id", async () => {
    const home = makeOrgHome();
    try {
      await appendScorecardEvent(
        home.root,
        { type: "review_cycles", app: "alpha", role: "builder", turnId: "turn-1", ticketRef: "#1", value: 2 },
        new Date("2026-07-01T00:00:00Z"),
      );
      await appendScorecardEvent(
        home.root,
        { type: "review_cycles", app: "alpha", role: "builder", turnId: "turn-2", ticketRef: "#2", value: 1 },
        new Date("2026-07-06T00:00:00Z"),
      );
      await appendScorecardEvent(
        home.root,
        { type: "review_cycles", app: "alpha", role: "builder", turnId: "turn-2", ticketRef: "#2", value: 1 },
        new Date("2026-07-06T01:00:00Z"),
      );

      const all = await readScorecards(home.root, "alpha", "builder");
      expect(all).toHaveLength(2);
      const recent = await readScorecards(home.root, "alpha", "builder", new Date("2026-07-05T00:00:00Z"));
      expect(recent.map((row) => row.turnId)).toEqual(["turn-2"]);
    } finally {
      home.cleanup();
    }
  });
});
