// #231 — one scheduled due window is one durable settlement, even when the
// first turn fails and derived schedule bookkeeping is lost.

import { afterEach, describe, expect, it } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dispatchTick, type DispatchTickResult } from "../../../src/org/dispatch.js";
import { writeJournalPatch } from "../../../src/org/journal.js";
import { readLock, releaseLock } from "../../../src/org/locks.js";
import { SchedulerEvidenceStore } from "../../../src/org/scheduler/evidence.js";
import { ScheduleDueClaimStore } from "../../../src/org/scheduler/due-window-claims.js";
import { schedulerIdentity } from "../../../src/org/scheduler/model.js";
import { scheduleDueWindow } from "../../../src/org/schedule.js";
import type { GitHubEventSource } from "../../../src/org/events.js";
import { makeTestClock } from "../../fixtures/clock.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

const APP = "daily-app";
const ROLE = "planner";
const TRIGGER = "daily 07:00";

const NO_EVENTS: GitHubEventSource = {
  ticketReady: async () => [],
  prOpened: async () => [],
  ciFailed: async () => [],
  releaseShipped: async () => [],
  // This family is about due-window settlement, not eligibility. Keep the
  // Planner window explicitly actionable so #228 cannot turn it into a no-op.
  openIssues: async () => [{ number: 231, title: "fixture planning work", labels: [] }],
};

class DuplicateDueWindowViolation extends Error {
  constructor(count: number) {
    super(`one daily due window spawned ${count} independent runs`);
    this.name = "DuplicateDueWindowViolation";
  }
}

function assertSingleDueWindowSpawn(ticks: readonly DispatchTickResult[]): void {
  const count = ticks.flatMap((tick) => tick.spawned)
    .filter((turn) => turn.app === APP && turn.role === ROLE && turn.trigger === TRIGGER).length;
  if (count > 1) throw new DuplicateDueWindowViolation(count);
}

describe("CF-REG-231 — scheduled due-window settlement", () => {
  let org: TempOrgHome | undefined;

  afterEach(async () => {
    await org?.cleanup();
    org = undefined;
  });

  async function makeOrg(): Promise<TempOrgHome> {
    const next = await makeTempOrgHome({ name: "daily-org" });
    await writeFile(join(next.orgHome, "apps.yaml"), [
      "schema_version: 1",
      "org:",
      "  name: daily-org",
      "  max_concurrent_turns: 1",
      "defaults:",
      "  budget_usd_month: 1000",
      "apps:",
      `  ${APP}:`,
      "    repo: fixture/daily-app",
      "    status: live",
      "    cadence: {}",
      "    release:",
      "      kind: deploy",
      "      owner: sre",
      "      trigger: command",
      "      command: ./deploy.sh",
      "",
    ].join("\n"), "utf8");
    await writeFile(join(next.orgHome, "roles.yaml"), [
      "defaults:",
      "  max_turn_budget_usd: 5",
      "roles:",
      `  ${ROLE}:`,
      "    runtime: claude",
      "    model: claude-scripted-model",
      "    effort: medium",
      "    delegation: {allow: []}",
      "    triggers:",
      `      - schedule: \"${TRIGGER}\"`,
      "    outputs: [notes]",
      "",
    ].join("\n"), "utf8");
    return next;
  }

  it("normalizes every host tick in one daily slot to the same due window", () => {
    const first = scheduleDueWindow(TRIGGER, new Date("2026-08-03T07:41:00.000Z"));
    const later = scheduleDueWindow(TRIGGER, new Date("2026-08-03T07:56:00.000Z"));
    expect(first.toISOString()).toBe(later.toISOString());
  });

  it("does not manufacture an implicit retry after terminal failure and lost schedule bookkeeping", async () => {
    org = await makeOrg();
    const clock = makeTestClock("2026-08-03T07:41:00.000Z");
    const spawned: string[] = [];
    const run = () => dispatchTick({
      orgRoot: org!.orgHome,
      runtimeHome: org!.stateHome,
      now: clock.nowDate,
      eventSource: NO_EVENTS,
      spawn: async ({ turnId }) => { spawned.push(turnId); },
    });

    const first = await run();
    expect(first.errors).toEqual([]);
    expect(first.spawned).toHaveLength(1);
    const turnId = first.spawned[0]!.turnId;
    await writeJournalPatch(org.stateHome, turnId, {
      app: APP,
      role: ROLE,
      phase: "failed",
      message: "scripted provider failure",
    }, clock.nowDate());
    const evidence = new SchedulerEvidenceStore({
      stateHome: org.stateHome,
      orgName: "daily-org",
      orgHome: org.orgHome,
      schedulerId: schedulerIdentity("daily-org", org.orgHome),
    });
    await evidence.recordTurnReceipt(turnId, clock.nowDate(), "scripted provider failure");
    await releaseLock(org.stateHome, APP, ROLE, await readLock(org.stateHome, APP, ROLE));

    // Seed the observed crash seam: the durable provider outcome survived but
    // the derived schedule cursor did not. The due-window claim remains the
    // authority and must prevent an ordinary later tick from retrying.
    await rm(join(org.stateHome, "state", "schedule.json"), { force: true });
    clock.advance(5 * 60_000);
    const second = await run();

    expect(spawned).toHaveLength(1);
    expect(() => assertSingleDueWindowSpawn([first, second])).not.toThrow();
    expect(second.skipped.some((line) => line.includes("already_settled"))).toBe(true);
  });

  it("recovers a crash after the due claim but before the turn journal without minting a new run", async () => {
    org = await makeOrg();
    const clock = makeTestClock("2026-08-03T07:41:00.000Z");
    const spawned: string[] = [];
    await expect(dispatchTick({
      orgRoot: org.orgHome,
      runtimeHome: org.stateHome,
      now: clock.nowDate,
      eventSource: NO_EVENTS,
      spawn: async ({ turnId }) => { spawned.push(turnId); },
      schedulerFault: async (boundary) => {
        if (boundary === "after_scheduler_lock") throw new Error("seeded crash after due claim");
      },
    })).rejects.toThrow("seeded crash after due claim");

    clock.advance(3 * 60_000);
    const restarted = await dispatchTick({
      orgRoot: org.orgHome,
      runtimeHome: org.stateHome,
      now: clock.nowDate,
      eventSource: NO_EVENTS,
      spawn: async ({ turnId }) => { spawned.push(turnId); },
      processIdentityStatus: () => "mismatch",
      dueClaimOwnerStatus: () => "dead",
    });

    expect(restarted.errors).toEqual([]);
    expect(spawned).toHaveLength(1);
    expect((await new ScheduleDueClaimStore(org.stateHome).list())[0]).toMatchObject({
      status: "committed",
      recovery_count: 1,
      run_id: spawned[0],
    });
  });

  it("recovers a crash after the turn journal but before claim commit under the same attempt", async () => {
    org = await makeOrg();
    const clock = makeTestClock("2026-08-03T07:41:00.000Z");
    const spawned: string[] = [];
    await expect(dispatchTick({
      orgRoot: org.orgHome,
      runtimeHome: org.stateHome,
      now: clock.nowDate,
      eventSource: NO_EVENTS,
      spawn: async ({ turnId }) => { spawned.push(turnId); },
      schedulerFault: async (boundary) => {
        if (boundary === "after_tick_journal") throw new Error("seeded crash before claim commit");
      },
    })).rejects.toThrow("seeded crash before claim commit");

    clock.advance(3 * 60_000);
    const restarted = await dispatchTick({
      orgRoot: org.orgHome,
      runtimeHome: org.stateHome,
      now: clock.nowDate,
      eventSource: NO_EVENTS,
      spawn: async ({ turnId }) => { spawned.push(turnId); },
      processIdentityStatus: () => "mismatch",
      dueClaimOwnerStatus: () => "dead",
    });

    expect(restarted.errors).toEqual([]);
    expect(restarted.skipped).toContain(`${APP}/${ROLE}: recovered stale pre-commit schedule journal`);
    expect(spawned).toHaveLength(1);
    expect((await new ScheduleDueClaimStore(org.stateHome).list())[0]).toMatchObject({
      status: "committed",
      attempt: 1,
      recovery_count: 1,
      run_id: spawned[0],
    });
  });

  it("reconciles provider completion before settlement on host restart", async () => {
    org = await makeOrg();
    const clock = makeTestClock("2026-08-03T07:41:00.000Z");
    let providerConstructions = 0;
    const first = await dispatchTick({
      orgRoot: org.orgHome,
      runtimeHome: org.stateHome,
      now: clock.nowDate,
      eventSource: NO_EVENTS,
      spawn: async () => { providerConstructions += 1; },
    });
    const turn = first.spawned[0]!;
    await writeJournalPatch(org.stateHome, turn.turnId, {
      app: APP,
      role: ROLE,
      phase: "running",
    }, clock.nowDate());
    await writeJournalPatch(org.stateHome, turn.turnId, {
      app: APP,
      role: ROLE,
      phase: "collecting",
    }, clock.nowDate());
    await writeJournalPatch(org.stateHome, turn.turnId, {
      app: APP,
      role: ROLE,
      phase: "done",
      message: "provider finished; settlement process crashed",
    }, clock.nowDate());
    await releaseLock(org.stateHome, APP, ROLE, await readLock(org.stateHome, APP, ROLE));

    clock.advance(5 * 60_000);
    const restarted = await dispatchTick({
      orgRoot: org.orgHome,
      runtimeHome: org.stateHome,
      now: clock.nowDate,
      eventSource: NO_EVENTS,
      spawn: async () => { providerConstructions += 1; },
    });

    expect(restarted.errors).toEqual([]);
    expect(providerConstructions).toBe(1);
    expect((await new ScheduleDueClaimStore(org.stateHome).list())[0]).toMatchObject({
      status: "settled",
      run_id: turn.turnId,
      outcome: "executed",
    });
  });

  it("serializes concurrent host ticks to one provider construction", async () => {
    org = await makeOrg();
    const clock = makeTestClock("2026-08-03T07:41:00.000Z");
    const spawned: string[] = [];
    const run = () => dispatchTick({
      orgRoot: org!.orgHome,
      runtimeHome: org!.stateHome,
      now: clock.nowDate,
      eventSource: NO_EVENTS,
      spawn: async ({ turnId }) => {
        await Promise.resolve();
        spawned.push(turnId);
      },
    });

    const ticks = await Promise.all([run(), run()]);
    expect(ticks.flatMap((tick) => tick.errors)).toEqual([]);
    expect(spawned).toHaveLength(1);
    expect(() => assertSingleDueWindowSpawn(ticks)).not.toThrow();
  });

  it("allows one explicit bounded retry under the same settlement identity", async () => {
    org = await makeOrg();
    const clock = makeTestClock("2026-08-03T07:41:00.000Z");
    const spawned: string[] = [];
    const spawn = async ({ turnId }: { turnId: string }) => { spawned.push(turnId); };
    const first = await dispatchTick({
      orgRoot: org.orgHome,
      runtimeHome: org.stateHome,
      now: clock.nowDate,
      eventSource: NO_EVENTS,
      spawn,
    });
    const initial = first.spawned[0]!;
    await writeJournalPatch(org.stateHome, initial.turnId, {
      app: APP, role: ROLE, phase: "failed", message: "retryable fixture failure",
    }, clock.nowDate());
    const evidence = new SchedulerEvidenceStore({
      stateHome: org.stateHome,
      orgName: "daily-org",
      orgHome: org.orgHome,
      schedulerId: schedulerIdentity("daily-org", org.orgHome),
    });
    await evidence.recordTurnReceipt(initial.turnId, clock.nowDate(), "retryable fixture failure");
    await releaseLock(org.stateHome, APP, ROLE, await readLock(org.stateHome, APP, ROLE));

    clock.advance(5 * 60_000);
    const retried = await dispatchTick({
      orgRoot: org.orgHome,
      runtimeHome: org.stateHome,
      now: clock.nowDate,
      eventSource: NO_EVENTS,
      spawn,
      explicitScheduleRetries: [initial.scheduleClaimId!],
    });
    expect(retried.errors).toEqual([]);
    expect(retried.spawned).toHaveLength(1);
    expect(retried.spawned[0]).toMatchObject({
      scheduleClaimId: initial.scheduleClaimId,
      scheduleClaimAttempt: 2,
      explicitRetry: true,
    });
    expect(retried.spawned[0]!.turnId).not.toBe(initial.turnId);

    const retryTurn = retried.spawned[0]!;
    await writeJournalPatch(org.stateHome, retryTurn.turnId, {
      app: APP, role: ROLE, phase: "failed", message: "second fixture failure",
    }, clock.nowDate());
    await evidence.recordTurnReceipt(retryTurn.turnId, clock.nowDate(), "second fixture failure");
    await releaseLock(org.stateHome, APP, ROLE, await readLock(org.stateHome, APP, ROLE));
    clock.advance(5 * 60_000);
    const exhausted = await dispatchTick({
      orgRoot: org.orgHome,
      runtimeHome: org.stateHome,
      now: clock.nowDate,
      eventSource: NO_EVENTS,
      spawn,
      explicitScheduleRetries: [initial.scheduleClaimId!],
    });
    expect(exhausted.spawned).toEqual([]);
    expect(exhausted.skipped.some((line) => line.includes("retry_exhausted"))).toBe(true);
    expect(spawned).toHaveLength(2);
  });

  it("negative control: two forged runs for one due window make the detector fire", () => {
    const turn = {
      app: APP,
      role: ROLE,
      turnId: "run-1",
      triggerKind: "schedule" as const,
      trigger: TRIGGER,
      decisionId: "decision-1",
      cadenceWindow: "2026-08-03T07:00:00.000Z",
    };
    const forged = [
      { spawned: [turn], skipped: [], errors: [] },
      { spawned: [{ ...turn, turnId: "run-2" }], skipped: [], errors: [] },
    ] satisfies DispatchTickResult[];
    expect(() => assertSingleDueWindowSpawn(forged)).toThrow(DuplicateDueWindowViolation);
  });
});
