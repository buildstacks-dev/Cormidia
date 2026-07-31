// Tests turn journal persistence and recovery decisions in src/org/journal.ts.
// Covers atomic patch-merge writes, listing with torn-file tolerance, and
// resume/restart/recollect/fail decisions around attempts and sessions.
// Uses temp org-home state only; no network, auth, real org state, or live
// clock is required.

import { readdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideRecovery, listJournals, readJournal, writeJournalPatch } from "../src/org/journal.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

describe("turn journal and recovery decisions", () => {
  it("journal writes patch-merge and round-trips", async () => {
    const home = makeOrgHome({ state: true });
    try {
      await writeJournalPatch(
        home.root,
        "t1",
        { role: "builder", app: "alpha", phase: "assembling", attempt: 0, triggerKind: "event", trigger: "ticket-ready" },
        new Date("2026-07-06T00:00:00Z"),
      );
      await writeJournalPatch(
        home.root,
        "t1",
        { role: "builder", app: "alpha", phase: "running", session: { runtime: "claude", id: "s1" } },
        new Date("2026-07-06T00:01:00Z"),
      );
      expect(await readJournal(home.root, "t1")).toMatchObject({
        turnId: "t1",
        role: "builder",
        app: "alpha",
        phase: "running",
        trigger: "ticket-ready",
        session: { runtime: "claude", id: "s1" },
      });
    } finally {
      home.cleanup();
    }
  });

  it("writes journals atomically (no leftover temp files)", async () => {
    const home = makeOrgHome({ state: true });
    try {
      await writeJournalPatch(
        home.root,
        "t-atomic",
        { role: "builder", app: "alpha", phase: "running" },
        new Date("2026-07-06T00:00:00Z"),
      );
      const files = readdirSync(`${home.root}/state/turns`);
      expect(files).toEqual(["t-atomic.json"]);
      expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
    } finally {
      home.cleanup();
    }
  });

  it("listJournals skips a torn journal instead of throwing (no dispatcher wedge)", async () => {
    const home = makeOrgHome({ state: true });
    try {
      await writeJournalPatch(
        home.root,
        "good",
        { role: "builder", app: "alpha", phase: "running" },
        new Date("2026-07-06T00:00:00Z"),
      );
      // Simulate a write interrupted by a crash/SIGKILL: an empty/partial file.
      writeFileSync(`${home.root}/state/turns/torn.json`, '{"turnId":"torn"', "utf8");
      const journals = await listJournals(home.root);
      expect(journals.map((j) => j.turnId)).toEqual(["good"]);
    } finally {
      home.cleanup();
    }
  });

  it("decides resume for running sessions under the resume attempt cap", () => {
    expect(
      decideRecovery({
        turnId: "t1",
        role: "builder",
        app: "alpha",
        phase: "running",
        attempt: 1,
        startedAt: "2026-07-06T00:00:00Z",
        updatedAt: "2026-07-06T00:01:00Z",
        session: { runtime: "claude", id: "s1" },
      }).action,
    ).toBe("resume");
  });

  it("decides restart when no session exists or resume is unusable", () => {
    expect(baseDecision({ session: undefined }).action).toBe("restart_clean");
    expect(baseDecision({ resumeFailed: true }).action).toBe("restart_clean");
  });

  it("decides recollect for collecting phase and fail at attempt cap", () => {
    expect(baseDecision({ phase: "collecting" }).action).toBe("recollect");
    expect(baseDecision({ attempt: 3 }).action).toBe("fail_incident");
  });
});

function baseDecision(overrides: {
  phase?: "running" | "collecting";
  attempt?: number;
  session?: { runtime: "claude"; id: string } | undefined;
  resumeFailed?: boolean;
}) {
  return decideRecovery(
    {
      turnId: "t",
      role: "builder",
      app: "alpha",
      phase: overrides.phase ?? "running",
      attempt: overrides.attempt ?? 0,
      startedAt: "2026-07-06T00:00:00Z",
      updatedAt: "2026-07-06T00:01:00Z",
      ...(overrides.session !== undefined
        ? { session: overrides.session }
        : overrides.session === undefined && "session" in overrides
          ? {}
          : { session: { runtime: "claude", id: "s" } }),
    },
    { ...(overrides.resumeFailed !== undefined ? { resumeFailed: overrides.resumeFailed } : {}) },
  );
}
