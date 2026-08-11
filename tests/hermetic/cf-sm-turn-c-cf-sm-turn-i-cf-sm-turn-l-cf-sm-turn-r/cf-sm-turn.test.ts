// Traceability: CF-SM-TURN-L · HB-023; CF-SM-TURN-I · HB-023; CF-SM-TURN-R · HB-023; CF-SM-TURN-C · HB-023 · case-catalog.md §2 productive-turn journal machine; system-map.md §2.2.

// CF-SM-TURN-L/I/R/C — forward-only role-invocation journal and real
// SIGKILL sweep (L2, E2; B-07 §2/§3, INV-013; case-catalog CF-SM-TURN).

import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertJournalPhaseTransition,
  readJournal,
  writeJournalPatch,
  type JournalPhase,
} from "../../../src/org/journal.js";
import { makeTempStateHome } from "../../fixtures/state-home.js";
import { runKillPointScenario, type KillPointResult } from "../../fixtures/kill-point.js";

const PRODUCTIVE_PHASES = ["assembling", "running", "collecting", "done"] as const;
const RECOGNIZED_PHASES = new Set<JournalPhase>([
  ...PRODUCTIVE_PHASES,
  "blocked_on_gate",
  "failed",
  "cancelled",
  "timed_out",
]);

function killSweepSource(): string {
  return `
import { join } from "node:path";
const { writeJournalPatch } = await import(process.env.JOURNAL_MODULE);
const root = join(process.env.KP_SCRATCH, "org-state");
for (const phase of ["assembling", "running", "collecting", "done"]) {
  await writeJournalPatch(root, "turn-sweep", {
    app: "turn-app",
    role: "builder",
    phase,
    attempt: 0,
  }, new Date("2026-07-31T12:00:00.000Z"));
  await kp("phase-" + phase);
}
`;
}

describe("CF-SM-TURN — journal phases are forward-only, replayable, and kill-safe", () => {
  const results: KillPointResult[] = [];

  afterEach(async () => {
    for (const result of results.splice(0).reverse()) await result.cleanup();
  });

  it.each(PRODUCTIVE_PHASES)("SIGKILL after %s preserves that exact recognized phase", async (phase) => {
    const result = await runKillPointScenario({
      source: killSweepSource(),
      killAt: `phase-${phase}`,
      env: {
        JOURNAL_MODULE: pathToFileURL(resolve("src/org/journal.ts")).href,
      },
    });
    results.push(result);

    expect(result.timedOut).toBe(false);
    expect(result.killedAt).toBe(`phase-${phase}`);
    expect(result.markers).toEqual(
      PRODUCTIVE_PHASES.slice(0, PRODUCTIVE_PHASES.indexOf(phase) + 1).map((reached) => `phase-${reached}`),
    );

    const journal = await readJournal(join(result.stateDir, "org-state"), "turn-sweep");
    expect(RECOGNIZED_PHASES.has(journal.phase)).toBe(true);
    expect(journal.phase).toBe(phase);
    expect(journal.turnId).toBe("turn-sweep");
  });

  it("the no-kill control reaches every non-empty sweep point and terminates done", async () => {
    const result = await runKillPointScenario({
      source: killSweepSource(),
      env: {
        JOURNAL_MODULE: pathToFileURL(resolve("src/org/journal.ts")).href,
      },
    });
    results.push(result);

    expect(result.exitCode).toBe(0);
    expect(result.markers).toEqual(PRODUCTIVE_PHASES.map((phase) => `phase-${phase}`));
    expect((await readJournal(join(result.stateDir, "org-state"), "turn-sweep")).phase).toBe("done");
  });

  it("replaying the same durable phase is idempotent", async () => {
    const state = await makeTempStateHome({ name: "cf-sm-turn-replay" });
    try {
      await writeJournalPatch(state.stateHome, "turn-replay", {
        app: "turn-app",
        role: "builder",
        phase: "assembling",
        attempt: 0,
      });
      await writeJournalPatch(state.stateHome, "turn-replay", {
        app: "turn-app",
        role: "builder",
        phase: "running",
        attempt: 0,
      });
      const first = await writeJournalPatch(state.stateHome, "turn-replay", {
        app: "turn-app",
        role: "builder",
        phase: "collecting",
        attempt: 0,
      });
      const replay = await writeJournalPatch(state.stateHome, "turn-replay", {
        app: "turn-app",
        role: "builder",
        phase: "collecting",
        attempt: 0,
      });

      expect(replay).toMatchObject({
        turnId: first.turnId,
        phase: first.phase,
        attempt: first.attempt,
        startedAt: first.startedAt,
      });
    } finally {
      await state.cleanup();
    }
  });

  it("negative control: a skipped productive phase is rejected before persistence", async () => {
    expect(() => assertJournalPhaseTransition("assembling", "collecting")).toThrow(
      /error_illegal_journal_phase_transition: assembling -> collecting/,
    );

    const state = await makeTempStateHome({ name: "cf-sm-turn-negative" });
    try {
      await writeJournalPatch(state.stateHome, "turn-negative", {
        app: "turn-app",
        role: "builder",
        phase: "assembling",
      });
      await expect(
        writeJournalPatch(state.stateHome, "turn-negative", {
          app: "turn-app",
          role: "builder",
          phase: "done",
        }),
      ).rejects.toThrow(/error_illegal_journal_phase_transition/);
      expect((await readJournal(state.stateHome, "turn-negative")).phase).toBe("assembling");
    } finally {
      await state.cleanup();
    }
  });
});
