// CF-OPS-CONT — owner-ratified contention shape over the real dispatcher,
// lock/journal stores, run envelopes, settlement ledger, and scheduler evidence.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchTick, type DueTurn } from "../../src/org/dispatch.js";
import type { GitHubEventSource } from "../../src/org/events.js";
import { writeJournalPatch } from "../../src/org/journal.js";
import { readLock, releaseLock } from "../../src/org/locks.js";
import { SchedulerEvidenceStore } from "../../src/org/scheduler/evidence.js";
import { schedulerIdentity } from "../../src/org/scheduler/model.js";
import { finalizeRun, startRun } from "../../src/runtime/runlog/envelope.js";
import { recordTurnOnce, toRecord } from "../../src/runtime/telemetry.js";
import type { RoleConfig, TurnResult } from "../../src/runtime/types.js";
import type { GhIssue, GhOps } from "../../src/loop/github.js";
import { stableHash } from "../../src/loop/episode-plan.js";
import { issueContentHash } from "../../src/loop/issue-snapshot.js";
import { claimDeliveryUnitIssues } from "../../src/loop/loop.js";
import type { LoopDeliveryUnit } from "../../src/loop/types.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  RoadmapDeliveryError,
  acceptBacklogSnapshot,
  acceptDirectExecutionUnit,
  acceptRoadmapPlan,
  admitExecutionBatch,
  executionBatchDispositionPath,
  readExecutionUnitJournal,
  transitionExecutionUnitJournal,
  type AuthorityRef,
  type DirectExecutionUnitAuthority,
  type RoadmapPlan,
} from "../../src/org/roadmap-delivery.js";
import { makeTempGitRepo } from "../fixtures/git-repo.js";
import { makeTempOrgHome } from "../fixtures/org-home.js";

export interface ContentionRigResult {
  due_candidates: number;
  apps: number;
  wip_limit: number;
  first_admitted: string[];
  max_live_observed: number;
  duplicate_pair_admissions: number;
  priority_preserved: boolean;
  typed_non_admissions: number;
  reconsidered_after_capacity: number;
  provider_turns: number | null;
  provider_settlements: number | null;
  duplicate_decisions: number;
  duplicate_episodes: number;
  orphaned_locks: number;
  orphaned_journals: number;
  orphaned_runs: number;
  orphaned_settlements: number;
  settlement_idempotence_refusals: number;
  terminal_integrity: boolean;
  overlapping_batch_refusals: number;
  duplicate_unit_stimulus_refusals: number;
  multi_ticket_claim_atomic: boolean;
  per_unit_settlements: number;
  batch_complete: boolean;
  every_unit_success: boolean;
  sibling_isolation: boolean;
  stale_frontier_refusals: number;
}

export function evaluateContentionRig(result: ContentionRigResult): string[] {
  return [
    ...(result.due_candidates < 10 ? ["CF-OPS-CONT:insufficient_due_candidates"] : []),
    ...(result.apps < 3 ? ["CF-OPS-CONT:insufficient_apps"] : []),
    ...(result.max_live_observed > result.wip_limit ? ["CF-OPS-CONT:wip_exceeded"] : []),
    ...(result.duplicate_pair_admissions > 0 ? ["CF-OPS-CONT:duplicate_pair_admission"] : []),
    ...(!result.priority_preserved ? ["CF-OPS-CONT:priority_drift"] : []),
    ...(result.typed_non_admissions !== result.due_candidates - result.first_admitted.length
      ? ["CF-OPS-CONT:untyped_non_admission"]
      : []),
    ...(result.reconsidered_after_capacity < 1 ? ["CF-OPS-CONT:eligible_work_not_reconsidered"] : []),
    ...(result.provider_turns === null || result.provider_turns !== result.provider_settlements
      ? ["CF-OPS-CONT:settlement_disagreement"]
      : []),
    ...(result.duplicate_decisions > 0 || result.duplicate_episodes > 0 ? ["CF-OPS-CONT:duplicate_evidence"] : []),
    ...(result.orphaned_locks + result.orphaned_journals + result.orphaned_runs + result.orphaned_settlements > 0
      ? ["CF-OPS-CONT:orphaned_state"]
      : []),
    ...(result.settlement_idempotence_refusals < 2 ? ["CF-OPS-CONT:settlement_idempotence_unproven"] : []),
    ...(!result.terminal_integrity ? ["CF-OPS-CONT:terminal_integrity_failed"] : []),
    ...(result.overlapping_batch_refusals < 1 ? ["CF-OPS-CONT:overlapping_batch_admitted"] : []),
    ...(result.duplicate_unit_stimulus_refusals < 1 ? ["CF-OPS-CONT:duplicate_unit_stimulus_admitted"] : []),
    ...(!result.multi_ticket_claim_atomic ? ["CF-OPS-CONT:multi_ticket_claim_partial"] : []),
    ...(result.per_unit_settlements !== 2 ? ["CF-OPS-CONT:per_unit_settlement_incomplete"] : []),
    ...(!result.batch_complete ? ["CF-OPS-CONT:batch_not_complete"] : []),
    ...(result.every_unit_success ? ["CF-OPS-CONT:mixed_outcome_lost"] : []),
    ...(!result.sibling_isolation ? ["CF-OPS-CONT:sibling_contamination"] : []),
    ...(result.stale_frontier_refusals < 1 ? ["CF-OPS-CONT:stale_frontier_admitted"] : []),
  ];
}

const APPS = ["contend-a", "contend-b", "contend-c"] as const;
const ROLES = ["builder", "planner", "sre", "support"] as const;
const AT = new Date("2026-07-31T18:00:00.000Z");
const SOURCE: GitHubEventSource = {
  ticketReady: async (app) => [{ issueNumber: APPS.indexOf(app.name as (typeof APPS)[number]) + 101 }],
  prOpened: async () => [],
  ciFailed: async () => [],
  releaseShipped: async () => [],
};

export async function runContentionRig(): Promise<ContentionRigResult> {
  const home = await makeTempOrgHome({ name: "contention-rig" });
  try {
    await writeFile(join(home.orgHome, "apps.yaml"), appsYaml(), "utf8");
    await writeFile(join(home.orgHome, "roles.yaml"), rolesYaml(), "utf8");
    const common = { orgRoot: home.orgHome, runtimeHome: home.stateHome, eventSource: SOURCE };
    const preview = await dispatchTick({ ...common, now: () => AT, dryRun: true, spawn: async () => undefined });
    const first = await dispatchTick({ ...common, now: () => AT, spawn: async () => undefined });
    const schedulerId = schedulerIdentity("contention-rig", home.orgHome);
    const store = new SchedulerEvidenceStore({
      stateHome: home.stateHome,
      orgName: "contention-rig",
      orgHome: home.orgHome,
      schedulerId,
    });
    const firstDecisions = await store.listDecisions();
    const firstPairs = first.spawned.map((turn) => `${turn.app}\0${turn.role}`);
    const duplicateAdmissions = firstPairs.length - new Set(firstPairs).size;
    const refused = await settleTogether(home.stateHome, first.spawned, store, new Date(AT.getTime() + 1_000));

    const laterAt = new Date(AT.getTime() + 5 * 60_000);
    const second = await dispatchTick({ ...common, now: () => laterAt, spawn: async () => undefined });
    const blockedPairs = new Set(
      firstDecisions
        .filter((row) => row.reason_code === "wip_limit")
        .map((row) => `${row.app}\0${row.role}\0${row.trigger}`),
    );
    const reconsidered = second.spawned.filter((turn) =>
      blockedPairs.has(`${turn.app}\0${turn.role}\0${turn.trigger}`),
    ).length;
    const refusedSecond = await settleTogether(
      home.stateHome,
      second.spawned,
      store,
      new Date(laterAt.getTime() + 1_000),
    );
    const summary = await store.summarize(new Date(laterAt.getTime() + 2_000));
    const all = await store.listDecisions();
    const terminal = all.every((row) => row.stage === "terminal" && row.outcome !== null && row.reason_code !== null);
    const batching = await exerciseBatchContention(home.stateHome);
    return {
      due_candidates: firstDecisions.length,
      apps: APPS.length,
      wip_limit: 2,
      first_admitted: first.spawned.map((turn) => `${turn.app}/${turn.role}/${turn.triggerKind}:${turn.trigger}`),
      max_live_observed: Math.max(first.spawned.length, second.spawned.length),
      duplicate_pair_admissions: duplicateAdmissions,
      priority_preserved: JSON.stringify(first.spawned.map(identity)) === JSON.stringify(preview.spawned.map(identity)),
      typed_non_admissions: firstDecisions.filter(
        (row) =>
          !first.spawned.some((turn) => turn.decisionId === row.decision_id) &&
          row.outcome !== null &&
          row.reason_code !== null,
      ).length,
      reconsidered_after_capacity: reconsidered,
      provider_turns: summary.provider_turns,
      provider_settlements: summary.provider_settlements,
      duplicate_decisions: summary.duplicate_decisions,
      duplicate_episodes: summary.duplicate_episodes,
      orphaned_locks: summary.orphaned_locks,
      orphaned_journals: summary.orphaned_journals,
      orphaned_runs: summary.orphaned_runs,
      orphaned_settlements: summary.orphaned_settlements,
      settlement_idempotence_refusals: refused + refusedSecond,
      terminal_integrity: terminal && summary.provider_settlement_agreement === true,
      ...batching,
    };
  } finally {
    await home.cleanup();
  }
}

async function exerciseBatchContention(
  stateHome: string,
): Promise<
  Pick<
    ContentionRigResult,
    | "overlapping_batch_refusals"
    | "duplicate_unit_stimulus_refusals"
    | "multi_ticket_claim_atomic"
    | "per_unit_settlements"
    | "batch_complete"
    | "every_unit_success"
    | "sibling_isolation"
    | "stale_frontier_refusals"
  >
> {
  const first = await acceptDirectExecutionUnit({ root: stateHome, authority: directUnit("contention-direct-a") });
  const second = await acceptDirectExecutionUnit({ root: stateHome, authority: directUnit("contention-direct-b") });
  const batch = await admitExecutionBatch({
    root: stateHome,
    app: "contend-a",
    batchId: "contention-direct-batch",
    directUnitRefs: [first.ref, second.ref],
    routing: [],
    admittedAt: AT.toISOString(),
  });
  const overlappingBatchRefusals = await refusalCount(
    () =>
      admitExecutionBatch({
        root: stateHome,
        app: "contend-a",
        batchId: "contention-overlap",
        directUnitRefs: [first.ref],
        routing: [],
        admittedAt: AT.toISOString(),
      }),
    "batch_membership_active",
  );
  const duplicateUnitStimulusRefusals = await refusalCount(
    () =>
      admitExecutionBatch({
        root: stateHome,
        app: "contend-a",
        batchId: "contention-duplicate-stimulus",
        directUnitRefs: [first.ref, first.ref],
        routing: [],
        admittedAt: AT.toISOString(),
      }),
    "batch_unit_duplicate",
  );

  await transitionExecutionUnitJournal({
    root: stateHome,
    app: "contend-a",
    batchRef: batch.ref,
    unitId: "contention-direct-a",
    expectedStates: ["admitted"],
    nextState: "completed",
    outcome: "completed",
    now: AT,
  });
  const siblingBefore = await readExecutionUnitJournal(stateHome, "contend-a", batch.ref.id, "contention-direct-b");
  await transitionExecutionUnitJournal({
    root: stateHome,
    app: "contend-a",
    batchRef: batch.ref,
    unitId: "contention-direct-b",
    expectedStates: ["admitted"],
    nextState: "failed",
    outcome: "failed",
    now: new Date(AT.getTime() + 1_000),
  });
  const firstAfter = await readExecutionUnitJournal(stateHome, "contend-a", batch.ref.id, "contention-direct-a");
  const disposition = JSON.parse(
    await readFile(executionBatchDispositionPath(stateHome, "contend-a", batch.ref.id), "utf8"),
  ) as { units: Array<{ unitId: string; outcome: string }> };

  return {
    overlapping_batch_refusals: overlappingBatchRefusals,
    duplicate_unit_stimulus_refusals: duplicateUnitStimulusRefusals,
    multi_ticket_claim_atomic: await exerciseAtomicMultiTicketClaim(),
    per_unit_settlements: disposition.units.length,
    batch_complete: disposition.units.length === batch.value.units.length,
    every_unit_success: disposition.units.every((unit) => unit.outcome === "completed"),
    sibling_isolation:
      siblingBefore?.state === "admitted" &&
      siblingBefore.usage.providerTurns === 0 &&
      firstAfter?.state === "completed" &&
      firstAfter.outcome === "completed",
    stale_frontier_refusals: await exerciseStaleFrontier(stateHome),
  };
}

async function exerciseAtomicMultiTicketClaim(): Promise<boolean> {
  const repo = await makeTempGitRepo({ defaultBranch: "trunk" });
  const worktreeRoot = await mkdtemp(join(tmpdir(), "cormidia-contention-claims-"));
  try {
    const issues = [contentionIssue(801), contentionIssue(802)];
    const gh = new ContentionClaimGh(issues, 802);
    const unit: LoopDeliveryUnit = {
      unitId: "contention-multi-ticket",
      membershipHash: stableHash(issues.map((issue) => issue.number)),
      members: issues.map((issue) => ({
        issueNumber: issue.number,
        ticketRef: `#${issue.number}`,
        contentHash: issueContentHash(issue),
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
      })),
    };
    try {
      await claimDeliveryUnitIssues(issues, {
        gh: gh as unknown as GhOps,
        targetRepo: "fixture/contention",
        localRepo: repo.dir,
        worktreeRoot,
        base: { ref: "HEAD", defaultBranch: repo.defaultBranch },
        unit,
      });
      return false;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("seeded contention claim failure")) throw error;
      return (
        issues.every((issue) => gh.labels(issue.number).includes("op:ready")) &&
        issues.every((issue) => !gh.labels(issue.number).includes("op:building"))
      );
    }
  } finally {
    await Promise.all([repo.cleanup(), rm(worktreeRoot, { recursive: true, force: true })]);
  }
}

async function exerciseStaleFrontier(stateHome: string): Promise<number> {
  const app = "contend-b";
  const snapshot = await acceptBacklogSnapshot({
    root: stateHome,
    snapshot: {
      schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
      snapshotId: "contention-backlog",
      version: 1,
      app,
      source: "fixture:contention",
      capturedAt: AT.toISOString(),
      completeness: "complete",
      pagination: { pagesObserved: 1, hasNextPage: false, unavailablePages: [] },
      issues: [901, 902].map((issueNumber) => ({
        issueNumber,
        contentHash: stableHash({ issueNumber }),
        lifecycle: "open" as const,
        routing: "automated" as const,
        observedLabels: [],
        dependencyIssues: [],
      })),
    },
  });
  const firstPlan = await acceptRoadmapPlan({
    root: stateHome,
    plan: contentionRoadmap(app, snapshot.ref, 1, null),
  });
  await acceptRoadmapPlan({
    root: stateHome,
    plan: contentionRoadmap(app, snapshot.ref, 2, firstPlan.ref),
  });
  return refusalCount(
    () =>
      admitExecutionBatch({
        root: stateHome,
        app,
        batchId: "contention-stale-frontier",
        roadmapRef: firstPlan.ref,
        expectedFrontierHash: firstPlan.frontierHash,
        orderedUnitIds: ["contention-code-901"],
        readinessRefs: [],
        routing: [],
        admittedAt: AT.toISOString(),
      }),
    "frontier_stale",
  );
}

function contentionRoadmap(
  app: string,
  snapshotRef: AuthorityRef,
  version: number,
  predecessor: AuthorityRef | null,
): RoadmapPlan {
  const units = [901, 902].map((issueNumber) => ({
    unitId: `contention-code-${issueNumber}`,
    workstreamId: "contention-code",
    issueNumbers: [issueNumber],
    dependsOn: [],
    priority: issueNumber,
    objective: `Deliver ${issueNumber}`,
  }));
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    planId: "contention-roadmap",
    version,
    app,
    backlogSnapshotRef: snapshotRef,
    predecessor,
    workstreams: [{ workstreamId: "contention-code", outcome: "Exercise stale frontiers", priority: 1 }],
    deliveryUnits: units,
    completedUnitIds: [],
    readyFrontier: units.map((unit) => unit.unitId),
    wipLimit: 2,
    moves: [],
    acceptedAt: new Date(AT.getTime() + version * 1_000).toISOString(),
  };
}

async function refusalCount(operation: () => Promise<unknown>, code: RoadmapDeliveryError["code"]): Promise<number> {
  try {
    await operation();
    return 0;
  } catch (error) {
    if (!(error instanceof RoadmapDeliveryError) || error.code !== code) throw error;
    return 1;
  }
}

function directUnit(unitId: string): DirectExecutionUnitAuthority {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    kind: "direct_operation",
    unitId,
    app: "contend-a",
    objective: `Deliver ${unitId}`,
    inScope: [unitId],
    outOfScope: ["external effects"],
    acceptanceCriteria: ["artifact exists"],
    expectedArtifacts: [{ id: "artifact", kind: "content", required: true }],
    declaredConstraints: { externalEffects: false, governedTemplate: true },
    safetyFacts: [{ kind: "independent_review", evidenceRefs: ["fixture:contention"] }],
    workflowTemplate: { id: "contention/direct", version: "v1" },
    provenance: {
      source: "human",
      creatorId: "fixture-owner",
      createdAt: AT.toISOString(),
      evidenceRefs: [`fixture:${unitId}`],
    },
    dedupeKey: `contention-dedupe:${unitId}`,
    admittedBudget: {
      maxProviderTurns: 2,
      maxEquivalentCostUsd: 2,
      maxMechanicalOverheadUsd: 0,
      maxActiveTimeMs: 60_000,
      maxHumanDecisions: 0,
    },
    createdAt: AT.toISOString(),
  };
}

function contentionIssue(number: number): GhIssue {
  return {
    number,
    title: `Contention member ${number}`,
    body: `## Goal\nDeliver contention member ${number}.\n\n## Acceptance criteria\n- [ ] complete`,
    labels: ["op:ready", "op:tier-standard"],
    state: "OPEN",
  };
}

class ContentionClaimGh {
  private readonly issues = new Map<number, GhIssue>();
  private failFor: number | undefined;

  constructor(issues: GhIssue[], failFor: number) {
    for (const issue of issues) this.issues.set(issue.number, structuredClone(issue));
    this.failFor = failFor;
  }

  async readIssue(number: number): Promise<GhIssue> {
    const issue = this.issues.get(number);
    if (issue === undefined) throw new Error(`missing contention issue ${number}`);
    return structuredClone(issue);
  }

  async swapLabel(number: number, from: string, to: string): Promise<void> {
    if (this.failFor === number) {
      this.failFor = undefined;
      throw new Error("seeded contention claim failure");
    }
    const issue = this.issues.get(number)!;
    if (!issue.labels.includes(from)) throw new Error(`${number} lacks ${from}`);
    issue.labels = issue.labels.map((label) => (label === from ? to : label));
  }

  labels(number: number): string[] {
    return [...this.issues.get(number)!.labels];
  }
}

async function settleTogether(
  stateHome: string,
  turns: DueTurn[],
  store: SchedulerEvidenceStore,
  at: Date,
): Promise<number> {
  const results = await Promise.all(
    turns.map(async (turn, index) => {
      const runId = `contention-${at.getTime()}-${index}`;
      const providerTurnId = `provider-${turn.turnId}`;
      const role = roleConfig(turn.role);
      const result = turnResult(turn.role);
      await startRun(
        stateHome,
        {
          runId,
          traceId: turn.turnId,
          app: turn.app,
          pipeline: "contention",
          pass: "settle",
          role: turn.role,
          runtime: "claude",
          model: role.model,
          providerTurnIds: [providerTurnId],
        },
        new Date(at.getTime() - 500),
      );
      await finalizeRun(
        stateHome,
        turn.app,
        runId,
        { status: "completed", verdictSummary: "contention fixture settled" },
        at,
      );
      await writeJournalPatch(
        stateHome,
        turn.turnId,
        { app: turn.app, role: turn.role, phase: "running" },
        new Date(at.getTime() - 400),
      );
      await writeJournalPatch(
        stateHome,
        turn.turnId,
        { app: turn.app, role: turn.role, phase: "collecting" },
        new Date(at.getTime() - 200),
      );
      await writeJournalPatch(stateHome, turn.turnId, { app: turn.app, role: turn.role, phase: "done" }, at);
      const record = toRecord(role, result, at, {
        app: turn.app,
        trigger: turn.triggerKind,
        runId,
        providerTurnId,
        traceId: turn.turnId,
        pipeline: "contention",
        pass: "settle",
      });
      const first = await recordTurnOnce(stateHome, record);
      const duplicate = await recordTurnOnce(stateHome, record);
      await store.recordTurnReceipt(turn.turnId, at, result.summary);
      const lock = await readLock(stateHome, turn.app, turn.role);
      await releaseLock(stateHome, turn.app, turn.role, lock);
      return first && !duplicate ? 1 : 0;
    }),
  );
  return results.reduce<number>((sum, item) => sum + item, 0);
}

function identity(turn: DueTurn): string {
  return `${turn.app}/${turn.role}/${turn.triggerKind}:${turn.trigger}`;
}
function roleConfig(name: string): RoleConfig {
  return {
    name,
    runtime: "claude",
    model: "claude-scripted-model",
    effort: "medium",
    delegation: { allow: [] },
    triggers: [],
    outputs: [],
    maxTurnBudgetUsd: 1,
  };
}
function turnResult(role: string): TurnResult {
  return {
    status: "completed",
    summary: `${role} settled`,
    artifacts: [],
    session: { runtime: "claude", id: `session-${role}` },
    usage: { tokensIn: 10, tokensOut: 2, costUsd: 0.01, subagentTurns: 0, wallClockMs: 100, quality: "complete" },
    escalations: [],
  };
}

function appsYaml(): string {
  return [
    "schema_version: 1",
    "org:",
    "  name: contention-rig",
    "  max_concurrent_turns: 2",
    "defaults:",
    "  budget_usd_month: 1000",
    "apps:",
    ...APPS.flatMap((app) => [
      `  ${app}:`,
      `    repo: fixture/${app}`,
      "    status: live",
      "    budget_usd_month: 1000",
      "    cadence: {}",
      "    channels:",
      "      support: [fixture]",
    ]),
    "",
  ].join("\n");
}
function rolesYaml(): string {
  return [
    "defaults:",
    "  max_turn_budget_usd: 1",
    "roles:",
    ...ROLES.flatMap((role) => [
      `  ${role}:`,
      "    runtime: claude",
      "    model: claude-scripted-model",
      "    effort: medium",
      "    delegation: {allow: []}",
      "    triggers:",
      ...(role === "builder" ? ["      - event: ticket-ready"] : []),
      '      - schedule: "* * * * *"',
      "    outputs: [notes]",
    ]),
    "",
  ].join("\n");
}
