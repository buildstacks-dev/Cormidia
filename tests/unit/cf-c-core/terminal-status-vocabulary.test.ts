// Traceability: CF-C-CORE · HB-P6 · contracts/provider-adapter-core.md §2 (CORMIDIA-C-CORE-001); case-catalog.md §5 contract matrix.

// HB-P6 — F-PT-017 (owner ruling 2026-08-12): the terminal status is
// `interrupted`, and it is REQUIRED to carry a machine-readable reason
// (`time_limit` | `operator_kill` | `provider_crash`) so the specificity the
// retired `timed_out` carried in its NAME is not lost when the name widens.
//
// No case here derives truth from current code (HB-P6's acceptance): the
// vocabulary is written out literally from the ratified contract, and the
// migration cases assert the meaning the owner ruled — `timed_out` reads as
// `interrupted` + `time_limit` — rather than whatever a reader happens to do.
//
// Seeded controls:
//   - an `interrupted` result with NO reason must be unconstructable (type) and
//     refused at runtime (terminalStopFields) — a permissive projection fails.
//   - a legacy `timed_out` record read as "unknown" (dropped, or left as its own
//     status) fails the migration oracle.

import { describe, expect, it } from "vitest";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizeLegacyEnvelopeStatus,
  finalizeRun,
  readEnvelope,
  startRun,
  type EnvelopeStatus,
} from "../../../src/runtime/runlog/envelope.js";
import { runPaths } from "../../../src/runtime/runlog/paths.js";
import { normalizeLegacyExecutionStatus } from "../../../src/loop/efficiency.js";
import { normalizeLegacyJournalPhase } from "../../../src/org/journal.js";
import {
  normalizeLegacyTerminalStatus,
  parseInterruptedReason,
  terminalStopFields,
  type InterruptedReason,
  type TerminalTurnStatus,
} from "../../../src/runtime/types.js";
import { makeTempStateHome } from "../../fixtures/state-home.js";

/** The ratified vocabularies, written out from contracts/provider-adapter-core.md
 *  §2 — deliberately NOT imported from a product constant, so the test would
 *  still fail if the product renamed a member. */
const RATIFIED_TERMINAL_STATUSES: readonly TerminalTurnStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "blocked_on_gate",
  "interrupted",
];
const RATIFIED_REASONS: readonly InterruptedReason[] = ["time_limit", "operator_kill", "provider_crash"];

describe("CF-C-CORE — terminal-status vocabulary (HB-P6, F-PT-017 ratified 2026-08-12)", () => {
  it("the ratified enum is exactly the contract's five members, and `timed_out` is not one of them", () => {
    for (const status of RATIFIED_TERMINAL_STATUSES) {
      expect(
        terminalStopFields({ status, ...(status === "interrupted" ? { interruptedReason: "time_limit" } : {}) }).status,
      ).toBe(status);
    }
    // The retired name is not a terminal status any more; reading it yields the
    // ratified one instead of passing through.
    expect(normalizeLegacyTerminalStatus("timed_out").status).toBe("interrupted");
    expect(RATIFIED_TERMINAL_STATUSES).not.toContain("timed_out");
  });

  it("`interrupted` cannot be produced without a reason — the requirement is enforced, not documented", () => {
    // SEEDED VIOLATION: a stop site that reached `interrupted` and forgot its
    // reason. A permissive projection would invent `time_limit` and quietly
    // report a provider crash as a timeout; this refuses instead.
    expect(() => terminalStopFields({ status: "interrupted" })).toThrow(/machine-readable reason/);
    // Every ratified reason is accepted and travels through unchanged.
    for (const interruptedReason of RATIFIED_REASONS) {
      expect(terminalStopFields({ status: "interrupted", interruptedReason })).toEqual({
        status: "interrupted",
        interruptedReason,
      });
    }
    // A non-ratified reason is not admitted at the trust boundary.
    expect(parseInterruptedReason("timed_out")).toBeUndefined();
    expect(parseInterruptedReason("")).toBeUndefined();
    expect(parseInterruptedReason(undefined)).toBeUndefined();
    for (const reason of RATIFIED_REASONS) expect(parseInterruptedReason(reason)).toBe(reason);
  });

  it("MIGRATION: a durable execution record written as `timed_out` reads as interrupted + time_limit", () => {
    expect(normalizeLegacyExecutionStatus({ status: "timed_out" })).toEqual({
      status: "interrupted",
      interruptedReason: "time_limit",
    });
    // And a LEGACY `interrupted` — which meant owner-heartbeat loss before the
    // rename — keeps its distinct meaning as `provider_crash`. This is the case
    // the required reason exists for: both old names survive, distinguishably.
    expect(normalizeLegacyExecutionStatus({ status: "interrupted" })).toEqual({
      status: "interrupted",
      interruptedReason: "provider_crash",
    });
    // A record that already carries a reason is never overwritten.
    expect(normalizeLegacyExecutionStatus({ status: "interrupted", interrupted_reason: "operator_kill" })).toEqual({
      status: "interrupted",
      interruptedReason: "operator_kill",
    });
    // Unrelated statuses pass through untouched.
    expect(normalizeLegacyExecutionStatus({ status: "completed" })).toEqual({ status: "completed" });
  });

  it("MIGRATION: a durable journal phase written as `timed_out` reads as interrupted + time_limit", () => {
    const legacy = {
      turnId: "turn-legacy",
      app: "app-a",
      role: "builder",
      phase: "timed_out",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    // The phase literal is outside the live JournalPhase union — that is what a
    // pre-migration journal on disk looks like, so it is fed in as parsed JSON.
    const normalized = normalizeLegacyJournalPhase(JSON.parse(JSON.stringify(legacy)));
    expect(normalized.phase).toBe("interrupted");
    expect(normalized.interruptedReason).toBe("time_limit");
    // SEEDED VIOLATION: reading it as "unknown" (leaving the retired literal in
    // place) would make the phase-transition guard refuse a legitimate resume.
    expect(normalized.phase).not.toBe("timed_out");
  });

  it("MIGRATION: a run envelope finalized before the rename still reads, and a fresh one carries its reason", async () => {
    const state = await makeTempStateHome();
    try {
      const app = "app-a";
      const runId = "run-legacy";
      await startRun(
        state.stateHome,
        { runId, traceId: `trace-${runId}`, app, pipeline: "delivery", pass: "build", role: "builder" },
        new Date("2026-08-01T00:00:00.000Z"),
      );
      await finalizeRun(
        state.stateHome,
        app,
        runId,
        { status: "interrupted", interruptedReason: "time_limit" },
        new Date("2026-08-01T00:05:00.000Z"),
      );
      // A freshly written envelope records the reason durably.
      const fresh = await readEnvelope(state.stateHome, app, runId);
      expect(fresh.status).toBe("interrupted");
      expect(fresh.interrupted_reason).toBe("time_limit");

      // Rewrite the bytes to their pre-migration shape and read them back.
      const path = runPaths(state.stateHome, app, runId).envelope;
      const bytes: Record<string, unknown> = JSON.parse(await readFile(path, "utf8"));
      bytes["status"] = "timed_out";
      delete bytes["interrupted_reason"];
      await writeFile(path, `${JSON.stringify(bytes, null, 2)}\n`, "utf8");

      const legacy = await readEnvelope(state.stateHome, app, runId);
      expect(normalizeLegacyEnvelopeStatus({ status: legacy.status })).toEqual({
        status: "interrupted",
        interruptedReason: "time_limit",
      });
    } finally {
      await state.cleanup();
    }
  });

  it("every ratified EnvelopeStatus terminal member round-trips, and the retired name is not among them", () => {
    const terminal: readonly EnvelopeStatus[] = ["completed", "failed", "blocked", "cancelled", "interrupted"];
    for (const status of terminal) {
      const normalized = normalizeLegacyEnvelopeStatus({
        status,
        ...(status === "interrupted" ? { interrupted_reason: "operator_kill" as const } : {}),
      });
      expect(normalized.status).toBe(status);
    }
    expect(normalizeLegacyEnvelopeStatus({ status: "timed_out" })).toEqual({
      status: "interrupted",
      interruptedReason: "time_limit",
    });
  });

  it("ACROSS EVERY ADAPTER: no adapter emits the retired vocabulary, and the sweep is non-empty", async () => {
    const dir = join(process.cwd(), "src", "runtime", "adapters");
    const modules = (await readdir(dir)).filter((file) => file.endsWith(".ts"));
    // Harness self-test rule: a sweep that walks nothing must fail, not pass.
    expect(modules.length).toBeGreaterThanOrEqual(7);
    const offenders: string[] = [];
    for (const file of modules) {
      if ((await readFile(join(dir, file), "utf8")).includes("timed_out")) offenders.push(file);
    }
    expect(offenders).toEqual([]);

    // And the seeded control proves the sweep can actually fire: the ONE module
    // that legitimately still says `timed_out` is the readiness probe, whose
    // outcome vocabulary F-PT-017 deliberately did not touch (a probe that
    // misses its deadline never ran a turn). If that file ever stopped
    // containing it, this sweep would be passing vacuously.
    const readiness = await readFile(join(process.cwd(), "src", "runtime", "readiness.ts"), "utf8");
    expect(readiness).toContain("timed_out");
  });
});
