// Stateless dispatch tick: compute what is due, spawn detached turns, exit.

import { spawn as spawnChild } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { GhCliOps } from "../loop/github.js";
import type { DurableClaimOwner, DurableClaimOwnerStatus } from "../runtime/durable-claim.js";
import { notifyObserver } from "../runtime/turn-observer.js";
import { processIdentityStatus } from "../runtime/process-identity.js";
import type { Trigger } from "../runtime/types.js";
import { loadApps, resolveTriggers, type AppEntry, type AppsFile } from "./apps.js";
import { enforceBudgetOverlay, isOverlayPaused } from "./budget.js";
import {
  EVENT_KINDS,
  EventStore,
  roleConsumedKey,
  type DueEvent,
  type EventKind,
  type GitHubEventSource,
} from "./events.js";
import { listJournals, readJournal, writeJournalPatch, type TurnEvent } from "./journal.js";
import { acquireLock, isStale, readLock, releaseLock, type TurnLock } from "./locks.js";
import {
  listPlannerPublications,
  resumePlannerPublication,
  type PlannerPublicationGit,
} from "./planner-publication.js";
import { recoverStaleTurn } from "./recovery.js";
import { runScheduledRetentionSweep, type StateSweepResult } from "./retention.js";
import { loadRoles, type RolesFile } from "./roles.js";
import { isDue, parseSchedule, ScheduleDefinitionError, scheduleDueWindow, ScheduleStore } from "./schedule.js";
import { scheduledRoleEligibility } from "./scheduled-role-eligibility.js";
import { ScheduleDueClaimStore, type ScheduleDueClaimPayload } from "./scheduler/due-window-claims.js";
import { assertScheduledRequiredExecutables } from "./scheduler/environment.js";
import { SchedulerEvidenceStore, type SchedulerInvocationRecord } from "./scheduler/evidence.js";
import {
  cadenceWindow,
  scheduledEpisodeId,
  schedulerDecisionId,
  schedulerIdentity,
  schedulerOrgId,
  type SchedulerReasonCode,
} from "./scheduler/model.js";
import { resolveTriggerRoute } from "./trigger-routing.js";
import { definedProps } from "../runtime/optional-properties.js";

interface DispatchTickOptions {
  orgRoot?: string;
  runtimeHome?: string;
  appsPath?: string;
  rolesPath?: string;
  now?: () => Date;
  eventSource?: GitHubEventSource;
  spawn?: DispatchSpawn;
  onSpawned?: (turn: DueTurn) => void;
  kill?: (pid: number, signal?: NodeJS.Signals) => Promise<void> | void;
  /** Injectable killed-pid liveness probe for deterministic recovery tests. */
  pidAlive?: (pid: number) => boolean;
  /** Liveness probe for an owned detached process group (positive pgid). */
  groupAlive?: (processGroupId: number) => boolean;
  /** Exact PID/start probe; unknown defers rather than signalling. */
  processIdentityStatus?: (pid: number, expectedStartIdentity: string) => "match" | "mismatch" | "unknown";
  /** SIGKILL escalation grace and polling interval. */
  killGraceMs?: number;
  killPollMs?: number;
  wallClockCapMs?: number;
  dryRun?: boolean;
  /** Repeatable settlement ids supplied by the explicit operator retry verb.
   * Ordinary scheduler ticks always omit this and therefore never retry a
   * settled due window. */
  explicitScheduleRetries?: readonly string[];
  /** Sealed host-restart seam for deterministic claim recovery tests. */
  dueClaimOwnerStatus?: (owner: DurableClaimOwner) => DurableClaimOwnerStatus;
  schedulerFault?: (
    boundary:
      | "after_scheduler_lock"
      | "after_tick_journal"
      | "after_child_spawn"
      | "post_spawn_bookkeeping"
      | "after_terminal_receipt",
  ) => void | Promise<void>;
  /** L2 seam for token-free Planner publication reconciliation. */
  plannerPublicationGh?: (
    app: AppEntry,
  ) => Pick<import("../loop/github.js").GhOps, "addLabel" | "removeLabel" | "readIssue" | "listIssues">;
  plannerPublicationGit?: PlannerPublicationGit;
}

export type DispatchSpawn = (input: {
  role: string;
  app: string;
  turnId: string;
  runtimeHome: string;
}) => Promise<void>;

export interface DispatchTickResult {
  spawned: DueTurn[];
  skipped: string[];
  errors: string[];
  scheduler?: { invocationId: string; cadenceWindow: string };
  /** Present only on the tick that won today's retention-sweep claim
   *  (review P1-14 / F-003; docs/scheduler/design.md → State retention). */
  retention?: StateSweepResult;
}

export interface DueTurn {
  app: string;
  role: string;
  turnId: string;
  triggerKind: keyof Trigger;
  trigger: string;
  eventKey?: string;
  /** Full triggering event, persisted into the turn journal at spawn so the
   *  turn's briefs can quote the original payload with provenance (issue #26). */
  event?: TurnEvent;
  decisionId: string;
  cadenceWindow: string;
  scheduleClaimId?: string;
  scheduleClaimAttempt?: number;
  explicitRetry?: boolean;
}

/** Reconcile prepared Planner effects before admitting any new provider work.
 * A pending transaction therefore cannot compete with a fresh grooming turn,
 * and a successful retry consumes zero provider turns. */
async function reconcilePendingPlannerPublications(input: {
  stateHome: string;
  apps: readonly AppEntry[];
  result: Pick<DispatchTickResult, "skipped" | "errors">;
  now: Date;
  ghFor?: (
    app: AppEntry,
  ) => Pick<import("../loop/github.js").GhOps, "addLabel" | "removeLabel" | "readIssue" | "listIssues">;
  git?: PlannerPublicationGit;
}): Promise<void> {
  const apps = new Map(input.apps.map((app) => [app.name, app]));
  for (const publication of (await listPlannerPublications(input.stateHome)).filter(
    (entry) => entry.state === "publication_pending",
  )) {
    const app = apps.get(publication.app);
    if (app === undefined) {
      input.result.errors.push(
        `planner publication ${publication.publication_id}: app ${publication.app} is no longer registered`,
      );
      continue;
    }
    try {
      const reconciled = await resumePlannerPublication({
        stateHome: input.stateHome,
        app,
        publicationId: publication.publication_id,
        gh: input.ghFor?.(app) ?? new GhCliOps(app.repo),
        now: input.now,
        ...(input.git === undefined ? {} : { git: input.git }),
      });
      if (reconciled.state === "published") {
        input.result.skipped.push(
          `${app.name}/planner: reconciled publication ${reconciled.publication_id} without provider work`,
        );
      } else if (reconciled.state === "refused") {
        input.result.errors.push(
          `${app.name}/planner: publication ${reconciled.publication_id} permanently refused: ` +
            `${reconciled.error?.message ?? "unknown refusal"}; ${reconciled.recovery.command}`,
        );
      } else {
        input.result.errors.push(
          `${app.name}/planner: publication ${reconciled.publication_id} remains pending: ` +
            `${reconciled.error?.message ?? "publication incomplete"}; ${reconciled.recovery.command}`,
        );
      }
    } catch (error) {
      input.result.errors.push(
        `${app.name}/planner: publication ${publication.publication_id} reconciliation failed: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

interface BlockedDecision {
  app: string;
  role: string;
  triggerKind: "schedule" | "event" | "mechanical";
  trigger: string;
  eventKey?: string;
  outcome: "blocked" | "skipped" | "failed";
  reason: SchedulerReasonCode;
  detail: string;
}

/** An event whose every current subscriber holds a per-role consumption mark;
 *  the tick retires it (issue #25). */
interface RetirableEvent {
  app: string;
  kind: string;
  key: string;
}

export async function dispatchTick(options: DispatchTickOptions = {}): Promise<DispatchTickResult> {
  // Fail before loading org state, constructing GitHub operations, or spawning
  // a provider turn when the scheduler-owned process environment has drifted.
  assertScheduledRequiredExecutables(process.env);
  const now = options.now ?? (() => new Date());
  const orgRoot = resolve(options.orgRoot ?? process.cwd());
  const appsPath = resolve(options.appsPath ?? join(orgRoot, "apps.yaml"));
  const rolesPath = resolve(options.rolesPath ?? join(orgRoot, "roles.yaml"));
  const appsFile = await loadApps(appsPath);
  const rolesFile = await loadRoles(rolesPath);
  const runtimeHome = resolve(
    options.runtimeHome ?? process.env.CORMIDIA_STATE_HOME ?? join(homedir(), ".cormidia", appsFile.org.name),
  );
  const spawn = options.spawn ?? ((input) => spawnDetached(input, orgRoot));
  const schedule = new ScheduleStore(runtimeHome);
  const eventStore = new EventStore(runtimeHome);
  const source = options.eventSource ?? new GhEventSource();
  const result: DispatchTickResult = { spawned: [], skipped: [], errors: [] };
  const tickAt = now();
  const schedulerId = schedulerIdentity(appsFile.org.name, orgRoot);
  const evidence = new SchedulerEvidenceStore({
    stateHome: runtimeHome,
    orgName: appsFile.org.name,
    orgHome: orgRoot,
    schedulerId,
  });
  const dueClaims = new ScheduleDueClaimStore(runtimeHome, {
    ...definedProps({ ownerStatus: options.dueClaimOwnerStatus }),
  });
  const invocation = options.dryRun === true ? undefined : await evidence.beginInvocation(tickAt);
  if (invocation !== undefined)
    result.scheduler = { invocationId: invocation.invocation_id, cadenceWindow: invocation.cadence_window };
  if (invocation !== undefined && invocation.missed_windows > 0 && invocation.decision_ids.length === 0) {
    const missed = await evidence.claimDecision({
      invocationId: invocation.invocation_id,
      cadenceWindow: invocation.cadence_window,
      app: "__org__",
      role: "scheduler",
      triggerKind: "mechanical",
      trigger: "host-cadence",
      now: tickAt,
    });
    await evidence.finishDecision(missed.record.decision_id, "reconciled", "missed_window_reconciled", tickAt, {
      detail: `${invocation.missed_windows} missed host window(s) collapsed by one-firing policy`,
      providerTurns: 0,
      providerSettlements: 0,
    });
  }
  if (options.dryRun !== true) {
    await reconcileCommittedScheduleClaims(dueClaims, evidence, runtimeHome, tickAt, result);
    await reconcilePendingPlannerPublications({
      stateHome: runtimeHome,
      apps: appsFile.apps,
      result,
      now: tickAt,
      ...(options.plannerPublicationGh === undefined ? {} : { ghFor: options.plannerPublicationGh }),
      ...(options.plannerPublicationGit === undefined ? {} : { git: options.plannerPublicationGit }),
    });
  }

  // Refresh the monthly budget auto-pause overlay every tick. Nothing else on
  // the automated (launchd) path writes it, so without this an app past 100%
  // of its monthly cap would be dispatched — and keep spending — indefinitely
  // (architecture.md §7). This is the sole writer of state/budget-overlay.json
  // under normal operation; computeDueTurns reads it below via isOverlayPaused.
  try {
    await enforceBudgetOverlay(runtimeHome, appsFile, tickAt);
  } catch (error) {
    result.errors.push(`budget overlay refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const killed = await killHungTurns(runtimeHome, tickAt, result, options.kill, spawn, options.wallClockCapMs, {
    pidAlive: options.pidAlive ?? defaultPidAlive,
    groupAlive: options.groupAlive ?? defaultGroupAlive,
    identityStatus: options.processIdentityStatus ?? processIdentityStatus,
    graceMs: options.killGraceMs ?? 5_000,
    pollMs: options.killPollMs ?? 250,
  });
  const staleSpawns = await recoverableStaleLocks(
    runtimeHome,
    tickAt,
    result,
    spawn,
    killed.recovered,
    dueClaims,
    options.processIdentityStatus ?? processIdentityStatus,
  );
  const freshLocks = await freshLockCount(runtimeHome, tickAt);
  // Recovery spawns consume capacity even before their heartbeat is visible.
  const recoverySpawns = killed.spawns + staleSpawns;
  const capacity = Math.max(0, appsFile.org.maxConcurrentTurns - freshLocks - recoverySpawns);
  const { due, blocked, retirable, recoveredEventMarks, matchedExplicitRetries } = await computeDueTurns({
    appsFile,
    rolesFile,
    orgRoot,
    runtimeHome,
    schedule,
    eventStore,
    source,
    now: tickAt,
    result,
    evidence,
    dueClaims,
    explicitScheduleRetries: new Set(options.explicitScheduleRetries ?? []),
    cadenceWindow: invocation?.cadence_window ?? cadenceWindow(tickAt),
    orgId: schedulerOrgId(appsFile.org.name, orgRoot),
    persistEventMigrations: options.dryRun !== true,
    plannerPublicationBlockedApps: new Set(
      (await listPlannerPublications(runtimeHome))
        .filter((entry) => entry.state !== "published")
        .map((entry) => entry.app),
    ),
  });

  for (const retryId of options.explicitScheduleRetries ?? []) {
    if (!matchedExplicitRetries.has(retryId)) {
      result.errors.push(`explicit schedule retry not found or not configured: ${retryId}`);
    }
  }

  if (capacity === 0) result.skipped.push("org WIP limit reached");
  if (invocation !== undefined) {
    for (const blocker of blocked) {
      try {
        await recordBlockedDecision(evidence, invocation, blocker, tickAt);
      } catch (error) {
        // Considered work must never vanish (INV-014): if the evidence
        // deposit itself fails, the tick surfaces it loudly instead of dying
        // mid-loop and dropping the remaining blockers' evidence.
        result.errors.push(
          `${blocker.app}/${blocker.role}: recording ${blocker.reason} evidence failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  // Retirement sweep: an event retires only when every CURRENT subscriber
  // holds a per-role consumption mark — evaluated fresh each tick against
  // roles.yaml, never snapshotted at spawn time, so a subscriber removed
  // mid-fan-out cannot strand an event live forever (issue #25). Dry-run
  // computes but never writes.
  if (options.dryRun !== true) {
    if (recoveredEventMarks.length > 0) {
      try {
        await eventStore.markConsumed(recoveredEventMarks);
      } catch (error) {
        result.errors.push(
          `event consumption reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    for (const event of retirable) {
      try {
        await eventStore.retireEvent(event.key);
        result.skipped.push(`${event.app}: event ${event.kind} (${event.key}) retired: all subscribers consumed`);
      } catch (error) {
        result.errors.push(
          `${event.app}: retiring event ${event.key} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  for (const [index, turn] of due.entries()) {
    if (options.dryRun === true) {
      if (index < capacity) result.spawned.push(turn);
      else result.skipped.push(`${turn.app}/${turn.role}: org WIP limit reached`);
      continue;
    }
    const claimed = await evidence.claimDecision({
      invocationId: invocation!.invocation_id,
      cadenceWindow: turn.cadenceWindow,
      app: turn.app,
      role: turn.role,
      triggerKind:
        turn.trigger === "blocked-retry" ? "recovery" : turn.triggerKind === "schedule" ? "schedule" : "event",
      trigger: turn.trigger,
      ...definedProps({ eventKey: turn.eventKey }),
      now: tickAt,
    });
    const decisionId = claimed.record.decision_id;
    let executingTurn =
      turn.triggerKind === "schedule"
        ? { ...turn, decisionId }
        : claimed.record.episode_id === null
          ? turn
          : { ...turn, turnId: claimed.record.episode_id, decisionId };
    if (
      claimed.record.stage === "terminal" ||
      claimed.record.stage === "spawned" ||
      claimed.record.stage === "spawn_committed"
    ) {
      if (turn.scheduleClaimId !== undefined) {
        const scheduleClaim = await dueClaims.read(turn.scheduleClaimId);
        const reason = scheduleClaim?.status === "settled" ? "already_settled" : "already_claimed";
        result.skipped.push(`${turn.app}/${turn.role}: ${reason} (${turn.scheduleClaimId})`);
      } else {
        result.skipped.push(`${turn.app}/${turn.role}: scheduler decision already ${claimed.record.stage}`);
      }
      continue;
    }
    if (index >= capacity) {
      await evidence.finishDecision(decisionId, "blocked", "wip_limit", tickAt, { detail: "org WIP limit reached" });
      result.skipped.push(`${turn.app}/${turn.role}: org WIP limit reached`);
      continue;
    }
    const lock = await acquireLock(runtimeHome, {
      app: turn.app,
      role: turn.role,
      turnId: executingTurn.turnId,
      now: tickAt,
    });
    if (!lock.acquired) {
      if (!isStale(lock.lock, tickAt)) {
        const sameDecision = lock.lock.turnId === executingTurn.turnId;
        result.skipped.push(
          sameDecision
            ? `${turn.app}/${turn.role}: concurrent tick lost scheduler claim`
            : `${turn.app}/${turn.role}: fresh lock`,
        );
        // Two simultaneous ticks claim the same deterministic decision. The
        // loser must not terminalize the shared record as blocked while the
        // winner is between lock acquisition and spawn; its matching turnId
        // proves this is contention on the SAME execution, not unrelated work.
        if (!sameDecision) {
          await evidence.finishDecision(decisionId, "blocked", "fresh_lock", tickAt, {
            detail: "existing role/app lock is fresh",
          });
        }
      }
      continue;
    }
    let scheduleClaim: Awaited<ReturnType<ScheduleDueClaimStore["claim"]>> | undefined;
    if (
      turn.triggerKind === "schedule" &&
      turn.scheduleClaimId !== undefined &&
      turn.scheduleClaimAttempt !== undefined
    ) {
      const payload = scheduleClaimPayload(
        schedulerOrgId(appsFile.org.name, orgRoot),
        turn.app,
        turn.role,
        turn.trigger,
        turn.cadenceWindow,
      );
      scheduleClaim = await dueClaims.claim(payload, tickAt, turn.explicitRetry === true);
      if (
        scheduleClaim.disposition === "already_claimed" ||
        scheduleClaim.disposition === "already_settled" ||
        scheduleClaim.disposition === "retry_exhausted"
      ) {
        await releaseLock(runtimeHome, turn.app, turn.role, lock.lock);
        const reason: SchedulerReasonCode = scheduleClaim.disposition;
        await evidence.finishDecision(decisionId, "skipped", reason, tickAt, {
          detail: `schedule settlement ${scheduleClaim.record.settlement_id} attempt ${scheduleClaim.record.attempt}`,
          providerTurns: 0,
          providerSettlements: 0,
        });
        result.skipped.push(`${turn.app}/${turn.role}: ${reason} (${scheduleClaim.record.settlement_id})`);
        continue;
      }
      const runId = dueClaims.turnId(scheduleClaim.record.settlement_id, scheduleClaim.record.attempt);
      if (runId !== executingTurn.turnId) {
        await releaseLock(runtimeHome, turn.app, turn.role, lock.lock);
        throw new Error(`schedule claim run identity changed after lock: ${executingTurn.turnId} != ${runId}`);
      }
      executingTurn = {
        ...executingTurn,
        scheduleClaimId: scheduleClaim.record.settlement_id,
        scheduleClaimAttempt: scheduleClaim.record.attempt,
      };
      await evidence.bindScheduleClaim(
        decisionId,
        {
          settlementId: scheduleClaim.record.settlement_id,
          attempt: scheduleClaim.record.attempt,
          episodeId: runId,
        },
        tickAt,
      );
      if (scheduleClaim.disposition === "explicit_retry") {
        result.skipped.push(
          `${turn.app}/${turn.role}: explicit_retry ${scheduleClaim.record.settlement_id} attempt ${scheduleClaim.record.attempt}`,
        );
      }
    }
    await evidence.advanceDecision(decisionId, "lock_acquired", tickAt);
    await options.schedulerFault?.("after_scheduler_lock");

    await writeJournalPatch(
      runtimeHome,
      executingTurn.turnId,
      {
        role: turn.role,
        app: turn.app,
        phase: "assembling",
        attempt: 0,
        triggerKind: turn.triggerKind,
        trigger: turn.trigger,
        ...definedProps({ event: turn.event }),
        pid: lock.lock.pid,
        ...definedProps({ processStartIdentity: lock.lock.processStartIdentity }),
        ...definedProps({ processNonce: lock.lock.nonce }),
      },
      tickAt,
    );
    await evidence.advanceDecision(decisionId, "journaled", tickAt);
    await options.schedulerFault?.("after_tick_journal");
    if (scheduleClaim?.token !== undefined) {
      await dueClaims.commit({
        settlementId: scheduleClaim.record.settlement_id,
        attempt: scheduleClaim.record.attempt,
        token: scheduleClaim.token,
        runId: executingTurn.turnId,
        now: tickAt,
      });
    }
    await evidence.advanceDecision(decisionId, "spawn_committed", tickAt);

    try {
      await spawn({
        role: turn.role,
        app: turn.app,
        turnId: executingTurn.turnId,
        runtimeHome,
      });
    } catch (error) {
      // Only a spawn failure releases the lock; the child never started.
      await releaseLock(runtimeHome, turn.app, turn.role, lock.lock);
      result.errors.push(error instanceof Error ? error.message : String(error));
      await evidence.finishDecision(decisionId, "failed", "spawn_failure", tickAt, {
        detail: error instanceof Error ? error.message : String(error),
      });
      if (scheduleClaim !== undefined) {
        await dueClaims.settle({
          settlementId: scheduleClaim.record.settlement_id,
          attempt: scheduleClaim.record.attempt,
          runId: executingTurn.turnId,
          outcome: "spawn_failure",
          now: tickAt,
        });
      }
      continue;
    }
    await options.schedulerFault?.("after_child_spawn");
    await evidence.advanceDecision(decisionId, "spawned", tickAt);
    notifyObserver(() => options.onSpawned?.(executingTurn));

    // The detached child is now running. A failure in post-spawn bookkeeping
    // (recordFired / markConsumed hitting a transient ENOSPC/EIO) must NOT
    // release the lock — doing so would leave the event unconsumed/schedule
    // un-recorded AND unlock the slot, so the next tick would dispatch a second
    // concurrent turn for the same (app, role) onto the shared managed clone.
    try {
      await options.schedulerFault?.("post_spawn_bookkeeping");
      if (turn.triggerKind === "schedule") {
        await schedule.recordFired(turn.app, turn.role, turn.trigger, new Date(turn.cadenceWindow));
      }
      if (turn.eventKey !== undefined) {
        // Per-role consumption mark: this spawn consumes the event for THIS
        // role only, so co-subscribers pushed to a later tick by the WIP
        // limit still see it. The bare key (which poll filters on) is written
        // by the retirement sweep above once every current subscriber holds a
        // mark — never here (issue #25).
        await eventStore.markConsumed([roleConsumedKey(turn.eventKey, turn.role)]);
      }
    } catch (error) {
      result.errors.push(
        `${turn.app}/${turn.role}: post-spawn bookkeeping failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await evidence.advanceDecision(
        decisionId,
        "spawned",
        tickAt,
        error instanceof Error ? error.message : String(error),
        "post_spawn_bookkeeping_failure",
      );
    }
    // Spawn is not provider completion. Keep the decision pending until the
    // child writes its terminal journal and recordTurnReceipt can measure both
    // provider turns and ledger settlements (#209).
    result.spawned.push(executingTurn);
  }
  if (invocation !== undefined) {
    const terminal = result.errors.length > 0 ? "failed" : "completed";
    const reason: SchedulerReasonCode =
      result.errors.length > 0
        ? "scheduler_state_failure"
        : due.length === 0 && blocked.length === 0
          ? "no_due_work"
          : "executed";
    await evidence.finishInvocation(invocation.invocation_id, terminal, reason, tickAt);
    await options.schedulerFault?.("after_terminal_receipt");
  }
  // Retention sweep (review P1-14 / F-003): the dispatch tick is the
  // scheduler's boundary, so it owns state-home retention — at most once per
  // UTC day via the sweep's exact-once claim, after the invocation receipt is
  // terminal so a sweep problem is reported but never fails the tick itself.
  if (options.dryRun !== true) {
    try {
      const sweep = await runScheduledRetentionSweep(runtimeHome, tickAt);
      if (sweep !== undefined) {
        result.retention = sweep;
        for (const error of sweep.errors) result.errors.push(`retention sweep: ${error}`);
      }
    } catch (error) {
      result.errors.push(`retention sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

async function computeDueTurns(input: {
  appsFile: AppsFile;
  rolesFile: RolesFile;
  orgRoot: string;
  runtimeHome: string;
  schedule: ScheduleStore;
  eventStore: EventStore;
  source: GitHubEventSource;
  now: Date;
  result: DispatchTickResult;
  evidence: SchedulerEvidenceStore;
  dueClaims: ScheduleDueClaimStore;
  explicitScheduleRetries: Set<string>;
  cadenceWindow: string;
  orgId: string;
  persistEventMigrations: boolean;
  plannerPublicationBlockedApps: Set<string>;
}): Promise<{
  due: DueTurn[];
  blocked: BlockedDecision[];
  retirable: RetirableEvent[];
  recoveredEventMarks: string[];
  matchedExplicitRetries: Set<string>;
}> {
  const due: DueTurn[] = [];
  const blocked: BlockedDecision[] = [];
  const retirable: RetirableEvent[] = [];
  const recoveredEventMarks = new Set<string>();
  const matchedExplicitRetries = new Set<string>();
  const existingScheduleClaims = await input.dueClaims.list();
  // Per-role marks filter roles that already ran for a live shared event.
  const consumed = new Set(await input.eventStore.readConsumed());
  for (const journal of await listJournals(input.runtimeHome)) {
    if (journal.phase === "blocked_on_gate") {
      due.push({
        ...withDecision(input, {
          app: journal.app,
          role: journal.role,
          triggerKind: journal.triggerKind ?? "event",
          trigger: journal.trigger ?? "blocked-retry",
        }),
        turnId: journal.turnId,
      });
    }
  }

  for (const app of input.appsFile.apps) {
    if (app.status !== "live") {
      // Non-live apps retain pending events and surface a named skip (L-002).
      input.result.skipped.push(`${app.name}: skipped, app not live (status: ${app.status})`);
      continue;
    }
    // B-08 §3 / F-PT-034: unreadable budget state → no admission for the app
    // (fail closed, INV-015), named and evidenced — never a thrown crash.
    let overlayPaused: boolean;
    try {
      overlayPaused = await isOverlayPaused(input.runtimeHome, app.name);
    } catch (error) {
      const detail = `budget overlay unreadable (failed closed to no admission): ${
        error instanceof Error ? error.message : String(error)
      }`;
      input.result.skipped.push(`${app.name}: scheduler_state_failure ${detail}`);
      blocked.push({
        app: app.name,
        role: "*",
        triggerKind: "mechanical",
        trigger: "budget-overlay",
        outcome: "failed",
        reason: "scheduler_state_failure",
        detail,
      });
      continue;
    }
    if (overlayPaused) {
      input.result.skipped.push(`${app.name}: budget overlay paused`);
      blocked.push({
        app: app.name,
        role: "*",
        triggerKind: "mechanical",
        trigger: "budget-overlay",
        outcome: "blocked",
        reason: "budget_paused",
        detail: "app budget overlay paused",
      });
      continue;
    }

    const polled = await input.eventStore.poll(app, input.source, input.persistEventMigrations);
    for (const key of polled.consumptionMigration.add) consumed.add(key);
    for (const error of polled.errors) {
      input.result.errors.push(`${error.app}/${error.kind}: ${error.code}: ${error.message}`);
    }
    // Duplicate deliveries fire once and remain operator-visible (B-13, INV-008).
    for (const duplicate of polled.collapsed) {
      input.result.skipped.push(
        `duplicate_delivery: ${duplicate.app} inbox file ${duplicate.file} carries the same event content as ` +
          `${duplicate.firstFile} (${duplicate.key}); collapsed to one firing`,
      );
    }

    let openIssues: Awaited<ReturnType<NonNullable<GitHubEventSource["openIssues"]>>> | undefined;
    let openIssuesAvailable = false;
    if (input.source.openIssues !== undefined) {
      try {
        openIssues = await input.source.openIssues(app);
        openIssuesAvailable = true;
      } catch (error) {
        input.result.errors.push(
          `${app.name}/open-issues: error_event_source: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const channels = app.channels ?? {};
    const subscribersByEvent = new Map<string, Set<string>>();
    for (const role of input.rolesFile.roles) {
      if (role.name === "planner" && input.plannerPublicationBlockedApps.has(app.name)) {
        const detail = "a prepared Planner publication must be reconciled before another Planner provider turn";
        input.result.skipped.push(`${app.name}/planner: publication_pending`);
        blocked.push({
          app: app.name,
          role: role.name,
          triggerKind: "mechanical",
          trigger: "planner-publication",
          outcome: "blocked",
          reason: "channel_gated",
          detail,
        });
        continue;
      }
      const triggers = resolveTriggers(role, app);
      for (const trigger of triggers) {
        if (trigger.manual === true) continue;
        if (trigger.event !== undefined) {
          const matches = polled.events.filter((event) => event.kind === trigger.event);
          for (const event of matches) {
            // Count the role as a subscriber even when it already consumed or
            // is gated below: a matching subscriber means the event is NOT
            // orphaned, and retirement needs the complete current subscriber
            // set (issue #25).
            const subscribers = subscribersByEvent.get(event.key) ?? new Set<string>();
            subscribers.add(role.name);
            subscribersByEvent.set(event.key, subscribers);
            const consumedKey = roleConsumedKey(event.key, role.name);
            if (consumed.has(consumedKey)) continue;
            let spawnEvidenced: boolean;
            try {
              spawnEvidenced = await input.evidence.hasSpawnedEvent(
                [event.key, ...(event.migrationAliases ?? [])],
                role.name,
              );
            } catch (error) {
              // F-PT-034: unreadable spawn evidence refuses THIS (event, role)
              // admission with the named reason instead of crashing the tick —
              // admitting without the dedupe witness could duplicate a spawn.
              const detail = error instanceof Error ? error.message : String(error);
              input.result.skipped.push(`${app.name}/${role.name}: scheduler_state_failure ${detail}`);
              blocked.push({
                app: app.name,
                role: role.name,
                triggerKind: "event",
                trigger: trigger.event,
                eventKey: event.key,
                outcome: "failed",
                reason: "scheduler_state_failure",
                detail,
              });
              continue;
            }
            if (spawnEvidenced) {
              // The durable scheduler decision reaches `spawned` before the
              // file-store mark. A crash in that narrow window must converge
              // without firing the provider turn again or stranding the event
              // forever. Treat the spawned decision as the recovery witness
              // and back-fill the ordinary per-role mark in the caller.
              consumed.add(consumedKey);
              recoveredEventMarks.add(consumedKey);
              continue;
            }
            const route = resolveTriggerRoute({ role: role.name, trigger, channels });
            if (route.kind === "skip") {
              input.result.skipped.push(`${app.name}/${role.name}: ${route.reason}`);
              blocked.push({
                app: app.name,
                role: role.name,
                triggerKind: "event",
                trigger: trigger.event,
                eventKey: event.key,
                outcome: "blocked",
                reason: "channel_gated",
                detail: route.reason,
              });
              continue;
            }
            due.push(eventTurn(input, app, role.name, trigger.event, event));
          }
        }
        if (trigger.schedule !== undefined) {
          // F-PT-034 (owner ruling 2026-08-12): a malformed schedule/trigger
          // definition terminates THIS (app, role, trigger) entry as the named
          // `scheduler_definition_failure` with durable evidence — never a
          // thrown crash, never a mislabeled route skip, and never a reason to
          // kill the rest of the tick (narrowest blast radius; the design doc
          // is silent on radius, noted in the landing PR).
          try {
            parseSchedule(trigger.schedule);
          } catch (error) {
            if (!(error instanceof ScheduleDefinitionError)) throw error;
            input.result.skipped.push(`${app.name}/${role.name}: scheduler_definition_failure ${error.message}`);
            blocked.push({
              app: app.name,
              role: role.name,
              triggerKind: "schedule",
              trigger: trigger.schedule,
              outcome: "failed",
              reason: "scheduler_definition_failure",
              detail: error.message,
            });
            continue;
          }
          const explicitRetry = existingScheduleClaims
            .filter((claim) => input.explicitScheduleRetries.has(claim.settlement_id))
            .find(
              (claim) =>
                claim.payload.app === app.name &&
                claim.payload.role === role.name &&
                claim.payload.trigger === trigger.schedule,
            );
          if (explicitRetry !== undefined) {
            matchedExplicitRetries.add(explicitRetry.settlement_id);
            due.push(
              scheduleTurn(input, app.name, role.name, trigger.schedule, {
                dueWindow: explicitRetry.payload.due_window,
                settlementId: explicitRetry.settlement_id,
                attempt: explicitRetry.attempt + 1,
                explicitRetry: true,
              }),
            );
            continue;
          }
          // F-PT-034: corrupt or unreadable scheduler state does less, never
          // more (INV-015, B-08 §3 "unreadable schedule → no spawn, durable
          // anomaly"): the affected scheduled entry terminates as the named
          // `scheduler_state_failure` with durable evidence, and admission
          // that never reads this state (event triggers) proceeds untouched.
          let stored: Date | undefined;
          let evidenced: Date | undefined;
          try {
            stored = await input.schedule.lastFired(app.name, role.name, trigger.schedule);
            evidenced = await input.evidence.lastSpawnedScheduleWindow(app.name, role.name, trigger.schedule);
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            input.result.skipped.push(`${app.name}/${role.name}: scheduler_state_failure ${detail}`);
            blocked.push({
              app: app.name,
              role: role.name,
              triggerKind: "schedule",
              trigger: trigger.schedule,
              outcome: "failed",
              reason: "scheduler_state_failure",
              detail,
            });
            continue;
          }
          const last = [stored, evidenced]
            .filter((value): value is Date => value !== undefined)
            .sort((a, b) => b.getTime() - a.getTime())[0];
          if (!isDue(trigger.schedule, last, input.now)) {
            input.result.skipped.push(`${app.name}/${role.name}: not_due (${trigger.schedule})`);
            blocked.push({
              app: app.name,
              role: role.name,
              triggerKind: "schedule",
              trigger: trigger.schedule,
              outcome: "skipped",
              reason: "not_due",
              detail: "scheduled trigger is outside its next due window",
            });
            continue;
          }
          const eligibility = await scheduledRoleEligibility({
            orgHome: input.orgRoot,
            stateHome: input.runtimeHome,
            appStages: Object.fromEntries(input.appsFile.apps.map((entry) => [entry.name, entry.status])),
            app,
            role: role.name,
            now: input.now,
            polledEvents: polled.events,
            openIssues,
            openIssuesAvailable,
          });
          if (!eligibility.eligible) {
            const detail = JSON.stringify({
              reason: eligibility.reason,
              configuration: eligibility.configuration,
              checked: eligibility.checked,
            });
            input.result.skipped.push(`${app.name}/${role.name}: no_actionable_input ${detail}`);
            blocked.push({
              app: app.name,
              role: role.name,
              triggerKind: "schedule",
              trigger: trigger.schedule,
              outcome: "skipped",
              reason: "no_actionable_input",
              detail,
            });
            continue;
          }
          const route = resolveTriggerRoute({ role: role.name, trigger, channels });
          if (route.kind === "skip") {
            input.result.skipped.push(`${app.name}/${role.name}: ${route.reason}`);
            blocked.push({
              app: app.name,
              role: role.name,
              triggerKind: "schedule",
              trigger: trigger.schedule,
              outcome: "blocked",
              reason: "channel_gated",
              detail: route.reason,
            });
            continue;
          }
          const dueWindow = scheduleDueWindow(trigger.schedule, input.now).toISOString();
          const payload = scheduleClaimPayload(input.orgId, app.name, role.name, trigger.schedule, dueWindow);
          const settlementId = input.dueClaims.settlementId(payload);
          const existing = existingScheduleClaims.find((claim) => claim.settlement_id === settlementId);
          due.push(
            scheduleTurn(input, app.name, role.name, trigger.schedule, {
              dueWindow,
              settlementId,
              attempt: existing?.attempt ?? 1,
            }),
          );
        }
      }
    }

    // An event kind that no role subscribes to is recorded, never lost: it
    // stays in the inbox (unconsumed) and surfaces on every tick so a missing
    // subscriber is observable rather than a silent drop. An event whose every
    // current subscriber already holds a per-role mark is ready to retire —
    // decided here, against TODAY'S roles.yaml, so subscriber-set drift after
    // a partial fan-out cannot strand the event live forever (issue #25).
    for (const event of polled.events) {
      const subscribers = subscribersByEvent.get(event.key);
      if (subscribers === undefined) {
        input.result.skipped.push(
          `no_subscriber: ${app.name} event ${event.kind} (${event.key}) has no current subscriber`,
        );
        blocked.push({
          app: app.name,
          role: "*",
          triggerKind: "event",
          trigger: event.kind,
          eventKey: event.key,
          outcome: "skipped",
          reason: "no_subscriber",
          detail: "event has no current subscriber",
        });
      } else if ([...subscribers].every((name) => consumed.has(roleConsumedKey(event.key, name)))) {
        retirable.push({ app: app.name, kind: event.kind, key: event.key });
      }
    }
  }

  return {
    due: due.sort(compareDue),
    blocked,
    retirable,
    recoveredEventMarks: [...recoveredEventMarks].sort(),
    matchedExplicitRetries,
  };
}

function eventTurn(
  input: { orgId: string; cadenceWindow: string },
  app: AppEntry,
  role: string,
  trigger: string,
  event: DueEvent,
): DueTurn {
  return withDecision(input, {
    app: app.name,
    role,
    triggerKind: "event",
    trigger,
    eventKey: event.key,
    event: {
      kind: event.kind,
      key: event.key,
      // GitHub events keep their transport kind; file-drop inbox events carry
      // the parsed company-lifecycle kind, which is never in EVENT_KINDS.
      source: EVENT_KINDS.includes(event.kind as EventKind) ? "github-poll" : "file-drop-inbox",
      payload: journalEventPayload(event),
    },
  });
}

/** Bound journal payloads; the full source remains in the inbox. */
const MAX_EVENT_PAYLOAD_BYTES = 16 * 1024;

function journalEventPayload(event: DueEvent): Record<string, unknown> {
  const raw = JSON.stringify(event.payload);
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes <= MAX_EVENT_PAYLOAD_BYTES) return event.payload;
  const id = event.payload["id"];
  const filename = event.payload["filename"];
  return {
    ...definedProps({
      id: typeof id === "string" ? id : undefined,
      filename: typeof filename === "string" ? filename : undefined,
    }),
    truncated: true,
    original_bytes: bytes,
    note: `payload exceeded ${MAX_EVENT_PAYLOAD_BYTES} bytes; full content remains at the event source (${event.key})`,
    preview: raw.slice(0, 2048),
  };
}

function scheduleTurn(
  input: { orgId: string; cadenceWindow: string },
  app: string,
  role: string,
  trigger: string,
  claim: { dueWindow: string; settlementId: string; attempt: number; explicitRetry?: boolean },
): DueTurn {
  const turn = withDecision(
    { ...input, cadenceWindow: claim.dueWindow },
    {
      app,
      role,
      triggerKind: "schedule",
      trigger,
    },
  );
  return {
    ...turn,
    turnId: scheduledEpisodeId(`${claim.settlementId}\0attempt:${claim.attempt}`),
    scheduleClaimId: claim.settlementId,
    scheduleClaimAttempt: claim.attempt,
    ...(claim.explicitRetry === true ? { explicitRetry: true } : {}),
  };
}

function scheduleClaimPayload(
  orgId: string,
  app: string,
  role: string,
  trigger: string,
  dueWindow: string,
): ScheduleDueClaimPayload {
  return { org_id: orgId, app, role, trigger, due_window: dueWindow };
}

function withDecision(
  input: { orgId: string; cadenceWindow: string },
  turn: Omit<DueTurn, "turnId" | "decisionId" | "cadenceWindow">,
): DueTurn {
  const decisionId = schedulerDecisionId({
    orgId: input.orgId,
    cadenceWindow: input.cadenceWindow,
    app: turn.app,
    role: turn.role,
    triggerKind: turn.trigger === "blocked-retry" ? "recovery" : turn.triggerKind,
    trigger: turn.trigger,
    ...definedProps({ eventKey: turn.eventKey }),
  });
  return { ...turn, decisionId, cadenceWindow: input.cadenceWindow, turnId: scheduledEpisodeId(decisionId) };
}

async function recordBlockedDecision(
  evidence: SchedulerEvidenceStore,
  invocation: SchedulerInvocationRecord,
  blocker: BlockedDecision,
  now: Date,
): Promise<void> {
  const claimed = await evidence.claimDecision({
    invocationId: invocation.invocation_id,
    cadenceWindow: invocation.cadence_window,
    app: blocker.app,
    role: blocker.role,
    triggerKind: blocker.triggerKind,
    trigger: blocker.trigger,
    ...definedProps({ eventKey: blocker.eventKey }),
    now,
  });
  // Terminalize only a decision this observation just prepared: a record
  // already progressing through lock/journal/spawn stages belongs to a live
  // execution, and rewriting it (e.g. a next-tick `not_due` flattening a
  // pending `post_spawn_bookkeeping_failure`) would falsify winner evidence —
  // "a spawned decision remains pending until the child journal is terminal"
  // (docs/scheduler/design.md → Health semantics; HB-142).
  if (claimed.record.stage === "prepared") {
    await evidence.finishDecision(claimed.record.decision_id, blocker.outcome, blocker.reason, now, {
      detail: blocker.detail,
    });
  }
}

function compareDue(a: DueTurn, b: DueTurn): number {
  const ap = a.trigger === "blocked-retry" ? 0 : a.triggerKind === "event" ? 1 : 2;
  const bp = b.trigger === "blocked-retry" ? 0 : b.triggerKind === "event" ? 1 : 2;
  return ap - bp || a.turnId.localeCompare(b.turnId);
}

async function reconcileCommittedScheduleClaims(
  claims: ScheduleDueClaimStore,
  evidence: SchedulerEvidenceStore,
  runtimeHome: string,
  now: Date,
  result: DispatchTickResult,
): Promise<void> {
  const terminalPhases = new Set(["done", "blocked_on_gate", "failed", "cancelled", "interrupted"]);
  for (const claim of await claims.list()) {
    if (claim.status !== "committed" || claim.run_id === null) continue;
    try {
      const journal = await readJournal(runtimeHome, claim.run_id);
      if (!terminalPhases.has(journal.phase)) continue;
      const receipt = await evidence.recordTurnReceipt(claim.run_id, now, journal.message);
      if (receipt === undefined) {
        result.errors.push(
          `${claim.payload.app}/${claim.payload.role}: committed schedule claim ${claim.settlement_id} has no scheduler decision`,
        );
      } else {
        result.skipped.push(
          `${claim.payload.app}/${claim.payload.role}: reconciled schedule settlement ${claim.settlement_id}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      result.errors.push(
        `${claim.payload.app}/${claim.payload.role}: schedule settlement reconciliation failed: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function recoverableStaleLocks(
  runtimeHome: string,
  now: Date,
  result: DispatchTickResult,
  spawn: DispatchSpawn,
  skipTurnIds: Set<string>,
  dueClaims: ScheduleDueClaimStore,
  identityStatus: (pid: number, expectedStartIdentity: string) => "match" | "mismatch" | "unknown",
): Promise<number> {
  let spawns = 0;
  const precommitScheduleTurns = new Set(
    (await dueClaims.list())
      .filter((claim) => claim.status === "claimed")
      .map((claim) => dueClaims.turnId(claim.settlement_id, claim.attempt)),
  );
  for (const lock of await listLocks(runtimeHome)) {
    if (skipTurnIds.has(lock.turnId)) continue;
    if (!isStale(lock, now)) continue;
    try {
      const journal = await readJournal(runtimeHome, lock.turnId);
      const deadOwner =
        lock.processStartIdentity !== undefined && identityStatus(lock.pid, lock.processStartIdentity) === "mismatch";
      if (journal.phase === "assembling" && precommitScheduleTurns.has(journal.turnId) && deadOwner) {
        // A scheduled turn journals before its durable claim commit. If the
        // host dies in that exact window, the journal proves no provider was
        // constructed yet. Release only the dead process lock: the next tick
        // reclaims the SAME due-window claim/attempt and idempotently rewrites
        // `assembling` before committing and spawning it.
        await releaseLock(runtimeHome, lock.app, lock.role, lock);
        result.skipped.push(`${lock.app}/${lock.role}: recovered stale pre-commit schedule journal`);
        continue;
      }
      const recovered = await recoverStaleTurn(runtimeHome, lock, journal, {
        now,
        spawn: async ({ journal: j }) => {
          await spawn({ role: j.role, app: j.app, turnId: j.turnId, runtimeHome });
        },
      });
      if (recovered.spawned === true) spawns += 1;
      result.skipped.push(`${lock.app}/${lock.role}: recovered ${recovered.decision.action}`);
    } catch (error) {
      const missingJournal = !existsSync(join(runtimeHome, "state", "turns", `${lock.turnId}.json`));
      const deadOwner =
        lock.processStartIdentity !== undefined && identityStatus(lock.pid, lock.processStartIdentity) === "mismatch";
      if (missingJournal && deadOwner) {
        await releaseLock(runtimeHome, lock.app, lock.role, lock);
        result.skipped.push(`${lock.app}/${lock.role}: recovered stale pre-journal claim`);
        continue;
      }
      result.errors.push(
        `${lock.app}/${lock.role}: recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return spawns;
}

async function killHungTurns(
  runtimeHome: string,
  now: Date,
  result: DispatchTickResult,
  kill: DispatchTickOptions["kill"],
  spawn: DispatchSpawn,
  wallClockCapMs = 60 * 60 * 1000,
  death: {
    pidAlive: (pid: number) => boolean;
    groupAlive: (processGroupId: number) => boolean;
    identityStatus: (pid: number, expectedStartIdentity: string) => "match" | "mismatch" | "unknown";
    graceMs: number;
    pollMs: number;
  } = {
    pidAlive: defaultPidAlive,
    groupAlive: defaultGroupAlive,
    identityStatus: processIdentityStatus,
    graceMs: 5_000,
    pollMs: 250,
  },
): Promise<{ recovered: Set<string>; spawns: number }> {
  const recovered = new Set<string>();
  let spawns = 0;
  for (const journal of await listJournals(runtimeHome)) {
    if (journal.phase !== "running" || journal.passStartedAt === undefined || journal.pid === undefined) {
      continue;
    }
    // Per-pass override wins when the running pass recorded one; otherwise the
    // org-wide default (60 min). Journals written before this field existed
    // simply fall through to the default — back-compatible.
    const capMs = journal.wallClockCapMs ?? wallClockCapMs;
    const age = now.getTime() - new Date(journal.passStartedAt).getTime();
    if (age <= capMs) continue;
    try {
      const ownedProcess = {
        pid: journal.pid,
        ...definedProps({ processGroupId: journal.processGroupId }),
      };
      const lockBeforeSignal = await readLock(runtimeHome, journal.app, journal.role).catch(() => undefined);
      const ownershipBound =
        lockBeforeSignal !== undefined &&
        lockBeforeSignal.turnId === journal.turnId &&
        lockBeforeSignal.pid === journal.pid &&
        journal.processStartIdentity !== undefined &&
        lockBeforeSignal.processStartIdentity === journal.processStartIdentity &&
        journal.processNonce !== undefined &&
        lockBeforeSignal.nonce === journal.processNonce;
      if (!ownershipBound) {
        result.skipped.push(
          `${journal.app}/${journal.role}: hung turn ${journal.turnId} ownership token mismatch; refusing to signal or recover`,
        );
        recovered.add(journal.turnId);
        continue;
      }
      const identity =
        journal.processStartIdentity === undefined
          ? "unknown"
          : death.identityStatus(journal.pid, journal.processStartIdentity);
      if (identity === "unknown") {
        result.skipped.push(
          `${journal.app}/${journal.role}: hung turn ${journal.turnId} process identity unverified; refusing to signal or recover`,
        );
        recovered.add(journal.turnId);
        continue;
      }
      if (identity === "match") await signalTurnProcess(ownedProcess, "SIGTERM", kill);
      await writeJournalPatch(
        runtimeHome,
        journal.turnId,
        {
          role: journal.role,
          app: journal.app,
          message: "wall-clock cap exceeded; process killed for recovery",
        },
        now,
      );
      // Do not enter recovery until the entire owned process tree is confirmed
      // dead. SIGTERM only requests termination; inspecting/resuming while the
      // old child (or a git/agent descendant) is still alive would let two
      // workers mutate one managed clone. Escalate to SIGKILL, and if any
      // owned process still refuses to die this tick, defer recovery.
      const dead = identity === "mismatch" ? true : await ensureProcessDead(ownedProcess, { kill, ...death });
      if (!dead) {
        result.skipped.push(
          `${journal.app}/${journal.role}: killed hung turn ${journal.turnId}; pid ${journal.pid} still alive, deferring recovery`,
        );
        recovered.add(journal.turnId);
        continue;
      }
      const lock = await readLock(runtimeHome, journal.app, journal.role);
      const refreshed = await readJournal(runtimeHome, journal.turnId);
      const recovery = await recoverStaleTurn(runtimeHome, lock, refreshed, {
        now,
        spawn: async ({ journal: j }) => {
          await spawn({ role: j.role, app: j.app, turnId: j.turnId, runtimeHome });
        },
      });
      if (recovery.spawned === true) spawns += 1;
      result.skipped.push(
        `${journal.app}/${journal.role}: killed hung turn ${journal.turnId}; recovered ${recovery.decision.action}`,
      );
      recovered.add(journal.turnId);
    } catch (error) {
      result.errors.push(
        `${journal.app}/${journal.role}: kill failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { recovered, spawns };
}

/** True while a pid is still running. `process.kill(pid, 0)` throws ESRCH once
 *  the process is gone; EPERM means it exists but we may not signal it. */
function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function defaultGroupAlive(processGroupId: number): boolean {
  if (process.platform === "win32") return false;
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function signalTurnProcess(
  journal: { pid: number; processGroupId?: number },
  signal: NodeJS.Signals,
  kill: DispatchTickOptions["kill"],
): Promise<void> {
  if (kill !== undefined) {
    await kill(journal.processGroupId ?? journal.pid, signal);
    return;
  }
  if (process.platform !== "win32" && journal.processGroupId !== undefined) {
    process.kill(-journal.processGroupId, signal);
  } else {
    process.kill(journal.pid, signal);
  }
}

/** Confirm a signalled pid has exited before its worktree is reused: wait out
 *  the grace window, escalate to SIGKILL, then wait again. Returns false if the
 *  pid is still alive at the end, so the caller can defer recovery. */
async function ensureProcessDead(
  journal: { pid: number; processGroupId?: number },
  opts: {
    kill: DispatchTickOptions["kill"];
    pidAlive: (pid: number) => boolean;
    groupAlive: (processGroupId: number) => boolean;
    graceMs: number;
    pollMs: number;
  },
): Promise<boolean> {
  const alive = (): boolean =>
    opts.pidAlive(journal.pid) || (journal.processGroupId !== undefined && opts.groupAlive(journal.processGroupId));
  if (!alive()) return true;
  const pollMs = Math.max(0, opts.pollMs);
  const attempts = Math.max(1, Math.ceil(opts.graceMs / Math.max(1, pollMs)));
  for (let i = 0; i < attempts; i++) {
    if (!alive()) return true;
    await delay(pollMs);
  }
  try {
    await signalTurnProcess(journal, "SIGKILL", opts.kill);
  } catch {
    // Already gone between the last probe and the escalation.
  }
  for (let i = 0; i < attempts; i++) {
    if (!alive()) return true;
    await delay(pollMs);
  }
  return !alive();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freshLockCount(runtimeHome: string, now: Date): Promise<number> {
  const locks = await listLocks(runtimeHome);
  return locks.filter((lock) => !isStale(lock, now)).length;
}

async function listLocks(runtimeHome: string): Promise<TurnLock[]> {
  const dir = join(runtimeHome, "locks");
  if (!existsSync(dir)) return [];
  const locks: TurnLock[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".lock")) continue;
    const [app, roleWithExt] = file.split("--");
    if (app === undefined || roleWithExt === undefined) continue;
    try {
      locks.push(await readLock(runtimeHome, app, roleWithExt.slice(0, -".lock".length)));
    } catch (error) {
      // A single torn lock (crash mid-heartbeat) must not throw the whole
      // tick; skip it and let the owning turn's next heartbeat repair it.
      console.warn(`locks: skipping unreadable ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return locks;
}

class GhEventSource implements GitHubEventSource {
  async ticketReady(app: AppEntry): Promise<{ issueNumber: number }[]> {
    return (await new GhCliOps(app.repo).listIssues({ labels: ["op:ready"], state: "open" })).map((issue) => ({
      issueNumber: issue.number,
    }));
  }

  async prOpened(): Promise<{ prNumber: number; headSha: string }[]> {
    return [];
  }

  async ciFailed(): Promise<{ sha: string; check: string }[]> {
    return [];
  }

  async releaseShipped(): Promise<{ tag: string }[]> {
    return [];
  }

  async openIssues(app: AppEntry): Promise<Array<{ number: number; title: string; labels: string[] }>> {
    return (await new GhCliOps(app.repo).listIssues({ state: "open", limit: 1_000 })).map((issue) => ({
      number: issue.number,
      title: issue.title,
      labels: issue.labels,
    }));
  }
}

async function spawnDetached(
  input: {
    role: string;
    app: string;
    turnId: string;
    runtimeHome: string;
  },
  orgRoot: string,
): Promise<void> {
  const args = [
    "run-role",
    input.role,
    "--app",
    input.app,
    "--turn",
    input.turnId,
    "--org-home",
    orgRoot,
    "--state-home",
    input.runtimeHome,
  ];
  const command =
    process.argv[1]?.endsWith(".ts") === true
      ? {
          bin: process.execPath,
          args: ["--import", createRequire(import.meta.url).resolve("tsx"), process.argv[1], ...args],
        }
      : { bin: process.execPath, args: [process.argv[1] ?? "dist/cli.js", ...args] };
  const child = spawnChild(command.bin, command.args, {
    cwd: orgRoot,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, CORMIDIA_OWNED_PROCESS_GROUP: "1" },
  });
  child.unref();
}
