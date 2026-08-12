// Traceability: CF-J09-R · HB-142 · contracts/B-08-tick-turn.md §2 (closed
// vocabulary, F-PT-034 owner ruling 2026-08-12) · docs/scheduler/design.md →
// "Outcomes and reason codes" (canonical table) · contracts/journey-acceptance.md J-09.
//
// CF-J09-R — every named non-admission reason is produced on its trigger: one
// leg per member of the CLOSED 20-member execution/admission vocabulary, plus
// the closure assertions (nothing outside the set; nothing in the set left
// unexercised). The two scheduler_* legs are F-PT-034's product change: before
// it, a malformed definition and corrupt schedule state each CRASHED the tick
// (captured red 2026-08-12); now they terminate as named, evidenced
// non-admission and the tick continues.

import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { acquireLock, readLock, releaseLock } from "../../../src/org/locks.js";
import { writeJournalPatch } from "../../../src/org/journal.js";
import { scheduleDueWindow } from "../../../src/org/schedule.js";
import { recordTurn } from "../../../src/runtime/telemetry.js";
import {
  B08_CLOSED_VOCABULARY,
  FIXED_NOW,
  assertVocabularyExercised,
  assertWithinClosedVocabulary,
  decisionProjections,
  makeSchedulerWorld,
  mustFind,
  tickWithoutCrash,
  VocabularyViolation,
  type SchedulerWorld,
} from "./support.js";

/** Reasons the matrix produced, shared across the legs of this file and
 * checked for exact closure at the end. */
const observed = new Set<string>();

function note(...reasons: readonly string[]): void {
  for (const reason of reasons) observed.add(reason);
}

const SRE_HOURLY = {
  apps: [{ name: "app-a" }],
  roles: [{ name: "sre", triggers: [{ schedule: "hourly" }] }],
} as const;

describe("CF-J09-R — the full named non-admission vocabulary (L2, HB-142)", () => {
  const worlds: SchedulerWorld[] = [];

  async function world(spec: Parameters<typeof makeSchedulerWorld>[0]): Promise<SchedulerWorld> {
    const made = await makeSchedulerWorld(spec);
    worlds.push(made);
    return made;
  }

  afterEach(async () => {
    await Promise.all(worlds.splice(0).map((entry) => entry.cleanup()));
  });

  it("executed: a completed child receipt terminates the decision as executed", async () => {
    const w = await world(SRE_HOURLY);
    const first = await w.tick();
    expect(first.spawned).toHaveLength(1);
    const turnId = mustFind(w.spawns, () => true, "the spawned turn").turnId;
    for (const phase of ["running", "collecting", "done"] as const) {
      await writeJournalPatch(w.home.stateHome, turnId, { app: "app-a", role: "sre", phase }, FIXED_NOW);
    }
    await w.tick({ at: new Date(FIXED_NOW.getTime() + 5 * 60_000) });
    const rows = await decisionProjections(w);
    const executed = mustFind(rows, (row) => row.reason_code === "executed", "an executed decision");
    expect(executed).toMatchObject({ stage: "terminal", outcome: "executed", classification: "executed" });
    const notDue = mustFind(rows, (row) => row.reason_code === "not_due", "the follow-up not_due decision");
    expect(notDue).toMatchObject({ outcome: "skipped" });
    note("executed", "not_due");
  });

  it("no_due_work: a tick with nothing due names the invocation itself", async () => {
    const w = await world({
      apps: [{ name: "app-a" }],
      roles: [{ name: "sre", triggers: [{ manual: true }] }],
    });
    await w.tick();
    const invocations = await w.evidence.listInvocations();
    const invocation = mustFind(invocations, (row) => row.reason_code === "no_due_work", "a no_due_work invocation");
    expect(invocation.terminal).toBe("completed");
    note("no_due_work");
  });

  it("no_actionable_input: a due window without actionable input refuses before construction", async () => {
    const w = await world({
      apps: [{ name: "app-a", release: false }],
      roles: [{ name: "sre", triggers: [{ schedule: "hourly" }] }],
    });
    const tick = await w.tick();
    expect(tick.spawned).toEqual([]);
    const row = mustFind(
      await decisionProjections(w),
      (item) => item.reason_code === "no_actionable_input",
      "a no_actionable_input decision",
    );
    expect(row).toMatchObject({ stage: "terminal", outcome: "skipped" });
    note("no_actionable_input");
  });

  it("already_claimed: a live foreign claim on the due window is named, never raced", async () => {
    const w = await world(SRE_HOURLY);
    const payload = {
      org_id: w.orgId,
      app: "app-a",
      role: "sre",
      trigger: "hourly",
      due_window: scheduleDueWindow("hourly", FIXED_NOW).toISOString(),
    };
    const held = await w.dueClaims.claim(payload, FIXED_NOW);
    expect(held.disposition).toBe("claimed");
    const tick = await w.tick();
    expect(tick.spawned).toEqual([]);
    const row = mustFind(
      await decisionProjections(w),
      (item) => item.reason_code === "already_claimed",
      "an already_claimed decision",
    );
    expect(row).toMatchObject({ stage: "terminal", outcome: "skipped" });
    note("already_claimed");
  });

  it("already_settled: a settled due window is observed, never retried by an ordinary tick", async () => {
    const w = await world(SRE_HOURLY);
    const payload = {
      org_id: w.orgId,
      app: "app-a",
      role: "sre",
      trigger: "hourly",
      due_window: scheduleDueWindow("hourly", FIXED_NOW).toISOString(),
    };
    const settlementId = w.dueClaims.settlementId(payload);
    const claim = await w.dueClaims.claim(payload, FIXED_NOW);
    if (claim.token === undefined) throw new Error("expected a fresh claim token");
    const runId = w.dueClaims.turnId(settlementId, claim.record.attempt);
    await w.dueClaims.commit({
      settlementId,
      attempt: claim.record.attempt,
      token: claim.token,
      runId,
      now: FIXED_NOW,
    });
    await w.dueClaims.settle({
      settlementId,
      attempt: claim.record.attempt,
      runId,
      outcome: "executed",
      now: FIXED_NOW,
    });
    const tick = await w.tick();
    expect(tick.spawned).toEqual([]);
    const row = mustFind(
      await decisionProjections(w),
      (item) => item.reason_code === "already_settled",
      "an already_settled decision",
    );
    expect(row).toMatchObject({ stage: "terminal", outcome: "skipped" });
    note("already_settled");

    // explicit_retry: the single operator-requested retry reuses the SAME
    // settlement identity (attempt 2), spawns, and is named in the tick output.
    const retryTick = await w.tick({ explicitScheduleRetries: [settlementId] });
    expect(retryTick.spawned).toHaveLength(1);
    expect(retryTick.skipped.some((line) => line.includes(`explicit_retry ${settlementId} attempt 2`))).toBe(true);
    const retried = await w.dueClaims.read(settlementId);
    expect(retried).toMatchObject({ attempt: 2, status: "committed" });
    note("explicit_retry");

    // retry_exhausted: the bounded retry budget (2 attempts) refuses a second
    // explicit retry with its own named reason. The attempt-2 child's lock is
    // released the way a finished child would release it.
    await releaseLock(w.home.stateHome, "app-a", "sre", await readLock(w.home.stateHome, "app-a", "sre"));
    await w.dueClaims.settle({
      settlementId,
      attempt: 2,
      runId: w.dueClaims.turnId(settlementId, 2),
      outcome: "executed",
      now: FIXED_NOW,
    });
    const exhaustedTick = await w.tick({ explicitScheduleRetries: [settlementId] });
    expect(exhaustedTick.spawned).toEqual([]);
    const exhausted = mustFind(
      await decisionProjections(w),
      (item) => item.reason_code === "retry_exhausted",
      "a retry_exhausted decision",
    );
    expect(exhausted).toMatchObject({ stage: "terminal", outcome: "skipped" });
    note("retry_exhausted");
  });

  it("fresh_lock: a live foreign lock skips with its named reason", async () => {
    const w = await world(SRE_HOURLY);
    await acquireLock(w.home.stateHome, { app: "app-a", role: "sre", turnId: "foreign-turn", now: FIXED_NOW });
    const tick = await w.tick();
    expect(tick.spawned).toEqual([]);
    const row = mustFind(
      await decisionProjections(w),
      (item) => item.reason_code === "fresh_lock",
      "a fresh_lock decision",
    );
    expect(row).toMatchObject({ stage: "terminal", outcome: "blocked", classification: "blocked_backpressure" });
    note("fresh_lock");
  });

  it("wip_limit: the org concurrency cap is named backpressure", async () => {
    const w = await world({
      maxConcurrentTurns: 1,
      apps: [{ name: "app-a" }, { name: "app-b" }],
      roles: [{ name: "sre", triggers: [{ schedule: "hourly" }] }],
    });
    const tick = await w.tick();
    expect(tick.spawned).toHaveLength(1);
    const row = mustFind(
      await decisionProjections(w),
      (item) => item.reason_code === "wip_limit",
      "a wip_limit decision",
    );
    expect(row).toMatchObject({ outcome: "blocked", classification: "blocked_backpressure" });
    note("wip_limit");
  });

  it("budget_paused: an over-budget app is named, not silently skipped", async () => {
    const w = await world({
      apps: [{ name: "app-a", budgetUsdMonth: 5 }],
      roles: [{ name: "sre", triggers: [{ schedule: "hourly" }] }],
    });
    await recordTurn(w.home.stateHome, {
      at: FIXED_NOW.toISOString(),
      role: "sre",
      runtime: "claude",
      model: "claude-scripted-model",
      status: "completed",
      tokensIn: 1000,
      tokensOut: 100,
      costUsd: 10,
      usageQuality: "complete",
      subagentTurns: 0,
      wallClockMs: 900,
      escalations: 0,
      app: "app-a",
      runId: "seed-overspend",
    });
    const tick = await w.tick();
    expect(tick.spawned).toEqual([]);
    const row = mustFind(
      await decisionProjections(w),
      (item) => item.reason_code === "budget_paused",
      "a budget_paused decision",
    );
    expect(row).toMatchObject({ outcome: "blocked", classification: "blocked_backpressure" });
    note("budget_paused");
  });

  it("approval_blocked: a gate-parked child receipt is named", async () => {
    const w = await world(SRE_HOURLY);
    await w.tick();
    const turnId = mustFind(w.spawns, () => true, "the spawned turn").turnId;
    await writeJournalPatch(
      w.home.stateHome,
      turnId,
      { app: "app-a", role: "sre", phase: "blocked_on_gate", message: "awaiting human approval" },
      FIXED_NOW,
    );
    await w.tick({ at: new Date(FIXED_NOW.getTime() + 5 * 60_000) });
    const row = mustFind(
      await decisionProjections(w),
      (item) => item.reason_code === "approval_blocked",
      "an approval_blocked decision",
    );
    expect(row).toMatchObject({ stage: "terminal", outcome: "blocked" });
    note("approval_blocked");
  });

  it("channel_gated: an audience subscriber without its declared channel is gated, not run", async () => {
    const w = await world({
      apps: [{ name: "app-a" }],
      roles: [{ name: "support", triggers: [{ event: "support-feedback" }] }],
    });
    await w.seedInboxEvent({ kind: "support-feedback", id: "feedback-142", app: "app-a" });
    const tick = await w.tick();
    expect(tick.spawned).toEqual([]);
    const row = mustFind(
      await decisionProjections(w),
      (item) => item.reason_code === "channel_gated",
      "a channel_gated decision",
    );
    expect(row).toMatchObject({ outcome: "blocked", trigger_kind: "event" });
    note("channel_gated");
  });

  it("no_subscriber: an event nobody subscribes to stays visible under its named reason", async () => {
    const w = await world({
      apps: [{ name: "app-a" }],
      roles: [{ name: "sre", triggers: [{ manual: true }] }],
    });
    await w.seedInboxEvent({ kind: "adoption-signal", id: "adoption-142", app: "app-a" });
    const tick = await w.tick();
    expect(tick.spawned).toEqual([]);
    const row = mustFind(
      await decisionProjections(w),
      (item) => item.reason_code === "no_subscriber",
      "a no_subscriber decision",
    );
    expect(row).toMatchObject({ outcome: "skipped", role: "*" });
    note("no_subscriber");
  });

  it("empty_learning_window: a mechanical empty window is skipped, never counted as work", async () => {
    const w = await world(SRE_HOURLY);
    await w.tick();
    const turnId = mustFind(w.spawns, () => true, "the spawned turn").turnId;
    for (const phase of ["running", "collecting", "done"] as const) {
      await writeJournalPatch(
        w.home.stateHome,
        turnId,
        { app: "app-a", role: "sre", phase, message: "learning distillation skipped: window empty" },
        FIXED_NOW,
      );
    }
    await w.tick({ at: new Date(FIXED_NOW.getTime() + 5 * 60_000) });
    const row = mustFind(
      await decisionProjections(w),
      (item) => item.reason_code === "empty_learning_window",
      "an empty_learning_window decision",
    );
    expect(row).toMatchObject({ stage: "terminal", outcome: "skipped" });
    note("empty_learning_window");
  });

  it("missed_window_reconciled: missed host windows collapse to one counted firing", async () => {
    const w = await world({
      apps: [{ name: "app-a" }],
      roles: [{ name: "sre", triggers: [{ manual: true }] }],
    });
    await w.tick();
    await w.tick({ at: new Date(FIXED_NOW.getTime() + 15 * 60_000) });
    const row = mustFind(
      await decisionProjections(w),
      (item) => item.reason_code === "missed_window_reconciled",
      "a missed_window_reconciled decision",
    );
    expect(row).toMatchObject({ outcome: "reconciled", trigger_kind: "mechanical" });
    const invocation = mustFind(
      await w.evidence.listInvocations(),
      (item) => item.missed_windows > 0,
      "the reconciling invocation",
    );
    expect(invocation.missed_windows).toBe(2);
    note("missed_window_reconciled");
  });

  it("spawn_failure and post_spawn_bookkeeping_failure: the two asymmetric failures stay named", async () => {
    const spawnWorld = await world(SRE_HOURLY);
    await spawnWorld.tick({
      spawn: async () => {
        throw new Error("seeded spawn ENOENT");
      },
    });
    mustFind(
      await decisionProjections(spawnWorld),
      (item) => item.reason_code === "spawn_failure",
      "a spawn_failure decision",
    );

    const bookkeepingWorld = await world(SRE_HOURLY);
    await bookkeepingWorld.tick({
      schedulerFault: async (boundary) => {
        if (boundary === "post_spawn_bookkeeping") throw new Error("seeded schedule-state EIO");
      },
    });
    mustFind(
      await decisionProjections(bookkeepingWorld),
      (item) => item.reason_code === "post_spawn_bookkeeping_failure",
      "a post_spawn_bookkeeping_failure decision",
    );
    note("spawn_failure", "post_spawn_bookkeeping_failure");
  });

  it("scheduler_definition_failure: a malformed schedule spec is a named, evidenced non-admission — and the tick continues", async () => {
    const w = await world({
      apps: [{ name: "app-a" }],
      roles: [{ name: "sre", triggers: [{ schedule: "every 3 fortnights" }, { schedule: "hourly" }] }],
    });
    const tick = await tickWithoutCrash(w.tick());
    // Blast radius: only the malformed (app, role, trigger) entry fails; the
    // healthy hourly trigger on the SAME role still spawns in the SAME tick.
    expect(tick.spawned).toHaveLength(1);
    const row = mustFind(
      await decisionProjections(w),
      (item) => item.reason_code === "scheduler_definition_failure",
      "a scheduler_definition_failure decision",
    );
    expect(row).toMatchObject({
      stage: "terminal",
      outcome: "failed",
      classification: "blocked_error",
      trigger: "every 3 fortnights",
    });
    expect(row.episode_id).not.toBeNull();
    const alert = mustFind(
      await w.evidence.listAlerts(),
      (item) => item.reason_code === "scheduler_definition_failure",
      "the durable definition-failure alert",
    );
    expect(alert.resolved).toBe(false);
    const invocation = mustFind(await w.evidence.listInvocations(), () => true, "the tick invocation");
    expect(invocation.terminal).toBe("completed");
    note("scheduler_definition_failure");
  });

  it("scheduler_state_failure: corrupt schedule state is a named, evidenced non-admission — event admission is untouched", async () => {
    const w = await world({
      apps: [{ name: "app-a", channels: { support: ["email"] } }],
      roles: [
        { name: "sre", triggers: [{ schedule: "hourly" }] },
        { name: "support", triggers: [{ event: "support-feedback" }] },
      ],
    });
    await w.seedInboxEvent({ kind: "support-feedback", id: "feedback-143", app: "app-a" });
    await w.corruptScheduleState();
    const tick = await tickWithoutCrash(w.tick());
    // Blast radius: schedule-triggered admission fails closed (it reads the
    // corrupt state); event-triggered admission never reads it and proceeds.
    const rows = await decisionProjections(w);
    const failed = mustFind(
      rows,
      (item) => item.reason_code === "scheduler_state_failure" && item.role === "sre",
      "a scheduler_state_failure decision for the scheduled entry",
    );
    expect(failed).toMatchObject({ stage: "terminal", outcome: "failed", classification: "blocked_error" });
    expect(failed.episode_id).not.toBeNull();
    expect(tick.spawned).toHaveLength(1);
    expect(mustFind(tick.spawned, () => true, "the event spawn")).toMatchObject({ role: "support" });
    const alert = mustFind(
      await w.evidence.listAlerts(),
      (item) => item.reason_code === "scheduler_state_failure",
      "the durable state-failure alert",
    );
    expect(alert.resolved).toBe(false);
    note("scheduler_state_failure");

    // The named failure is not terminal wedging: honest bytes restore admission.
    await rm(join(w.home.stateHome, "state", "schedule.json"), { force: true });
    const recovered = await w.tick({ at: new Date(FIXED_NOW.getTime() + 5 * 60_000) });
    expect(recovered.spawned.some((turn) => turn.role === "sre")).toBe(true);
  });

  it("closure: everything observed is ratified, and every ratified member fired", () => {
    expect(() => assertWithinClosedVocabulary(observed)).not.toThrow();
    expect(() => assertVocabularyExercised(observed)).not.toThrow();
    expect(B08_CLOSED_VOCABULARY).toHaveLength(20);
  });

  it("negative control: a reason outside the closed set makes the vocabulary detector FIRE", () => {
    expect(() => assertWithinClosedVocabulary(new Set([...observed, "quietly_dropped"]))).toThrow(VocabularyViolation);
  });

  it("negative control: an unexercised member makes the completeness detector FIRE", () => {
    const partial = new Set(observed);
    partial.delete("scheduler_definition_failure");
    expect(() => assertVocabularyExercised(partial)).toThrow(VocabularyViolation);
  });
});
