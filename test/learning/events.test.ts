// Tests the learning event sink + reader in src/org/learning/events.ts.
// Covers JSONL layout under <stateHome>/learning/events/<date>/<stream>.jsonl,
// cross-date read order, the torn-tail-line contract (drop a malformed final
// line, throw on mid-file corruption), and stream-name fallback/sanitization.
// Temp dirs only; no network or live clock.

import { appendFileSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  appendLearningEventsDeduped,
  createLearningEventSink,
  learningEventPath,
  readLearningEvents,
  type LearningEvent,
} from "../../src/org/learning/events.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

function event(overrides: Partial<LearningEvent>): LearningEvent {
  return {
    event_id: "evt_test_1",
    episode_id: "ep_alpha_ticket_0001",
    turn_id: "turn-alpha-1",
    ts: "2026-07-11T06:00:00.000Z",
    app: "alpha",
    type: "gate_verdict",
    emitter: "verifier",
    source_channel: "internal",
    trust: "trusted",
    ...overrides,
  };
}

describe("createLearningEventSink", () => {
  it("appends one JSON line per event under events/<date>/<turn>.jsonl", async () => {
    const home = makeOrgHome();
    try {
      const sink = createLearningEventSink(home.root);
      const first = event({ event_id: "evt_a" });
      await sink.emit(first);
      await sink.emit(event({ event_id: "evt_b" }));

      const path = learningEventPath(home.root, first);
      expect(path).toContain("learning/events/2026-07-11/turn-alpha-1.jsonl");
      const lines = readFileSync(path, "utf8").trimEnd().split("\n");
      expect(lines).toHaveLength(2);
      expect((JSON.parse(lines[0]!) as LearningEvent).event_id).toBe("evt_a");
    } finally {
      home.cleanup();
    }
  });

  it("streams fall back to the emitter and sanitize unsafe characters", async () => {
    const home = makeOrgHome();
    try {
      const sink = createLearningEventSink(home.root);
      const noTurn = event({ event_id: "evt_h" });
      delete (noTurn as Partial<LearningEvent>).turn_id;
      noTurn.emitter = "human";
      await sink.emit(noTurn);
      expect(learningEventPath(home.root, noTurn)).toContain("/human.jsonl");

      const weird = event({ event_id: "evt_w", turn_id: "../../etc passwd" });
      await sink.emit(weird);
      expect(learningEventPath(home.root, weird)).toContain("/etc-passwd.jsonl");
    } finally {
      home.cleanup();
    }
  });
});

describe("readLearningEvents", () => {
  it("returns all events across dates in (date, stream, line) order", async () => {
    const home = makeOrgHome();
    try {
      const sink = createLearningEventSink(home.root);
      await sink.emit(event({ event_id: "evt_2", ts: "2026-07-12T01:00:00.000Z" }));
      await sink.emit(event({ event_id: "evt_1", ts: "2026-07-11T23:00:00.000Z" }));
      await sink.emit(event({ event_id: "evt_3", ts: "2026-07-12T02:00:00.000Z" }));

      const ids = (await readLearningEvents(home.root)).map((entry) => entry.event_id);
      expect(ids).toEqual(["evt_1", "evt_2", "evt_3"]);
    } finally {
      home.cleanup();
    }
  });

  it("returns [] when nothing was ever captured", async () => {
    const home = makeOrgHome();
    try {
      expect(await readLearningEvents(home.root)).toEqual([]);
    } finally {
      home.cleanup();
    }
  });

  it("appendLearningEventsDeduped dedups within one batch, not only against the file", async () => {
    const home = makeOrgHome();
    try {
      const duplicate = event({ event_id: "evt_twice" });
      const result = await appendLearningEventsDeduped(home.root, [duplicate, { ...duplicate }]);
      expect(result).toEqual({ emitted: 1, deduped: 1 });
      expect((await readLearningEvents(home.root)).map((entry) => entry.event_id)).toEqual([
        "evt_twice",
      ]);
    } finally {
      home.cleanup();
    }
  });

  it("drops a torn final line but throws on mid-file corruption", async () => {
    const home = makeOrgHome();
    try {
      const sink = createLearningEventSink(home.root);
      const first = event({ event_id: "evt_ok" });
      await sink.emit(first);
      const path = learningEventPath(home.root, first);

      appendFileSync(path, '{"event_id":"evt_torn","epis');
      expect((await readLearningEvents(home.root)).map((entry) => entry.event_id)).toEqual([
        "evt_ok",
      ]);

      appendFileSync(path, "\n" + JSON.stringify(event({ event_id: "evt_after" })) + "\n");
      await expect(readLearningEvents(home.root)).rejects.toThrow(/malformed mid-file/);
    } finally {
      home.cleanup();
    }
  });
});
