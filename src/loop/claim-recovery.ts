// Durable claim/recovery saga for the build loop (#100, #104, #105).
//
// A label transition is not a transaction, and a provider turn is not a
// claim. This module records intent before GitHub mutation, commits the claim
// only when the first provider turn starts, and preserves an exact native
// session at approval boundaries. The ticket JSON remains the single source
// of truth; labels are a recoverable projection of it.

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { withFileLock } from "../runtime/file-lock.js";
import { currentProcessStartIdentity, processIdentityStatus } from "../runtime/process-identity.js";
import { episodeIdFor, readRouteRecord, routeRecordPath, type EpisodeTerminal } from "./efficiency.js";
import type { GhIssue, GhOps } from "./github.js";
import {
  readTicketClaimState,
  ticketStatePath,
  writeTicketClaimState,
  type TicketClaimEvent,
  type TicketClaimState,
  type TicketRearmRecord,
} from "./rehydrate.js";
import type { LoopContinuation, LoopContinuationDecision, LoopItem, SuppressedOperation } from "./types.js";

const LOCK_STALE_MS = 10 * 60_000;
const LOCK_WAIT_MS = 12 * 60_000;
const EVENT_LIMIT = 100;

export interface ClaimLease {
  claimId: string;
  claimNumber: number;
  resume: boolean;
  continuation?: LoopContinuation;
}

export interface BeginClaimResult {
  allowed: boolean;
  allowance: number;
  state: TicketClaimState;
  lease?: ClaimLease;
}

export interface RearmTicketInput {
  root: string;
  app: string;
  issueNumber: number;
  reason: string;
  actor: string;
  priorAllowance: number;
  intendedAllowance: number;
  gh: GhOps;
  now?: Date;
}

export interface RearmPlan {
  rearmId: string;
  app: string;
  issueNumber: number;
  reason: string;
  actor: string;
  priorAllowance: number;
  intendedAllowance: number;
  priorLabel: "op:blocked" | "op:returned";
  replay: boolean;
}

export interface TerminalTicketEpisode {
  episodeId: string;
  terminal: EpisodeTerminal;
}

/** A ticket may retain a parked GitHub label after its efficiency episode has
 * already finalized. Claim allowance cannot reopen that route: a new episode
 * identity is required, and treating label/allowance mutation as recovery
 * would make op:ready lie about executable work. */
export async function readTerminalTicketEpisode(input: {
  root: string;
  app: string;
  issueNumber: number;
}): Promise<TerminalTicketEpisode | undefined> {
  const episodeId = episodeIdFor({
    app: input.app,
    ticket: `#${input.issueNumber}`,
    traceId: `#${input.issueNumber}`,
  });
  if (!existsSync(routeRecordPath(input.root, episodeId))) return undefined;
  const route = await readRouteRecord(input.root, episodeId);
  return route.terminal === null ? undefined : { episodeId, terminal: route.terminal };
}

export function effectiveClaimAllowance(state: TicketClaimState, defaultAllowance: number): number {
  return state.claimAllowance ?? defaultAllowance;
}

/** Prepare a claim without consuming it. A continued approval pause keeps the
 * original claim number and exact session; a new claim gets the next number. */
export async function beginTicketClaim(input: {
  root: string;
  app: string;
  issueNumber: number;
  defaultAllowance: number;
  now?: Date;
}): Promise<BeginClaimResult> {
  const now = input.now ?? new Date();
  return withClaimState<BeginClaimResult>(input.root, input.app, input.issueNumber, async (state) => {
    const allowance = effectiveClaimAllowance(state, input.defaultAllowance);
    const continuation = state.continuation?.status === "ready" ? state.continuation : undefined;
    if (continuation === undefined && state.claims >= allowance) {
      const capped = state.claimAllowance === undefined ? { ...state, claimAllowance: allowance } : state;
      return { value: { allowed: false, allowance, state: capped }, state: capped };
    }
    if (state.active !== undefined) {
      throw new Error(
        `claim recovery: ticket ${input.app}#${input.issueNumber} already has active claim ${state.active.claimId}`,
      );
    }
    const claimNumber = continuation?.claimNumber ?? state.claims + 1;
    const claimId = stableId({
      app: input.app,
      issueNumber: input.issueNumber,
      claimNumber,
      continuation: continuation?.runId ?? null,
      acquiredAt: now.toISOString(),
    });
    const next: TicketClaimState = {
      ...state,
      claimAllowance: allowance,
      lastClaimAt: now.toISOString(),
      active: {
        claimId,
        claimNumber,
        ownerPid: process.pid,
        ownerProcessStartIdentity: currentProcessStartIdentity(),
        ownerNonce: randomUUID(),
        acquiredAt: now.toISOString(),
        phase: "acquiring",
        resume: continuation !== undefined,
      },
      events: appendEvent(state, {
        at: now.toISOString(),
        kind: continuation === undefined ? "claim_acquired" : "approval_resumed",
        claimNumber,
        detail:
          continuation === undefined
            ? `provisional claim ${claimId}; no provider turn started`
            : `continuing ${continuation.pipeline}/${continuation.pass} session ${continuation.session.id}`,
      }),
    };
    const lease: ClaimLease = {
      claimId,
      claimNumber,
      resume: continuation !== undefined,
      ...(continuation !== undefined ? { continuation: stripContinuationState(continuation) } : {}),
    };
    return { value: { allowed: true, allowance, state: next, lease }, state: next };
  });
}

export async function markTicketClaimed(input: ClaimMutation): Promise<void> {
  await mutateLease(input, (state, active) => ({
    ...state,
    active: { ...active, phase: "claimed" },
  }));
}

/** The accounting commit point. A pause-resume is already part of the
 * original claim and therefore never increments the counter again. */
export async function markTicketProviderStarted(input: ClaimMutation & { now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  await mutateLease(input, (state, active) => {
    if (active.phase === "provider_started") return state;
    const claims = active.resume ? state.claims : Math.max(state.claims, active.claimNumber);
    return {
      ...state,
      claims,
      active: { ...active, phase: "provider_started", providerStartedAt: now.toISOString() },
      events: appendEvent(state, {
        at: now.toISOString(),
        kind: "provider_started",
        claimNumber: active.claimNumber,
        detail: active.resume ? "approval continuation provider turn started" : "first provider turn started",
      }),
    };
  });
}

/** Complete a controlled loop outcome. Approval waits retain the exact session
 * and do not consume another claim when the decision is resumed. */
export async function finishTicketClaim(
  input: ClaimMutation & {
    item: LoopItem;
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  await mutateLease(input, (state, active) => {
    const outcome =
      `claim ${active.claimNumber}: ended ${input.item.phase}` +
      (input.item.prNumber !== undefined ? ` (PR #${input.item.prNumber})` : "");
    if (input.item.phase === "blocked" && input.item.continuation !== undefined) {
      const prior = state.continuation;
      const pauseCostUsd = input.item.continuation.pauseCostUsd ?? 0;
      const pauseNumber = (prior?.pauseCount ?? 0) + 1;
      // Both triggers land here, and the accounting rule is the same for both:
      // a pause is not a merit failure, so it never consumes a claim (#104's
      // $14.62 duplicated spend is the cost of getting this wrong). The kind
      // only changes what the operator reads.
      const pauseKind = input.item.continuation.pauseKind ?? "approval";
      const pauseOutcome =
        `claim ${active.claimNumber}: ${pauseKind} pause ${pauseNumber} at ` +
        `${input.item.continuation.pipeline}/${input.item.continuation.pass} ` +
        `(cost $${pauseCostUsd.toFixed(2)}, repeated $0.00; session ${input.item.continuation.session.id})`;
      const { active: _active, ...withoutActive } = state;
      return {
        ...withoutActive,
        continuation: {
          ...input.item.continuation,
          status: "waiting_approval",
          claimNumber: active.claimNumber,
          pauseCount: pauseNumber,
          pauseCostUsd: (prior?.pauseCostUsd ?? 0) + pauseCostUsd,
        },
        outcomes: [...state.outcomes.slice(-9), pauseOutcome],
        events: appendEvent(state, {
          at: now.toISOString(),
          kind: "approval_paused",
          claimNumber: active.claimNumber,
          detail:
            `${input.item.continuation.pipeline}/${input.item.continuation.pass} paused ` +
            `(${pauseKind}); session=${input.item.continuation.session.id}`,
          costUsd: pauseCostUsd,
          repeatedCostUsd: 0,
        }),
      };
    }
    const { active: _active, continuation: _continuation, ...withoutClaim } = state;
    return {
      ...withoutClaim,
      outcomes: [...state.outcomes.slice(-9), outcome],
      events: appendEvent(state, {
        at: now.toISOString(),
        kind: "claim_terminal",
        claimNumber: active.claimNumber,
        detail: outcome,
      }),
    };
  });
}

/** Record a human approval decision before changing the label. If the process
 * dies between those writes, recoverInterruptedClaims repairs the projection.
 *
 * Three outcomes, decided by the pause's trigger:
 *  - approved (either trigger)     -> the exact session resumes; op:ready.
 *  - denied, `approval` pause      -> the exact session resumes WITHOUT the
 *                                     operation (PURPOSE v2.15 (1)), and the
 *                                     suppression is recorded for #244.
 *  - denied, `budget` pause        -> there is nothing to resume with. Resuming
 *                                     would start a paid turn that re-suspends
 *                                     on the same cap, so the ticket
 *                                     terminalizes at op:returned instead.
 * In every case the claim count is untouched: a pause is not a merit failure. */
export async function continueAfterApproval(input: {
  root: string;
  app: string;
  issueNumber: number;
  approvalId: string;
  decision: "approved" | "denied";
  reason?: string;
  decidedAt?: string;
  /** Present only for CRITICAL-OPERATION items. A budget escalation is a spend
   * refusal, not a suppressed critical op, and must never manufacture a #244
   * record; the caller decides by rule and simply omits this. */
  suppression?: Pick<SuppressedOperation, "rule" | "actionSha256" | "tool">;
  gh: GhOps;
}): Promise<ContinueAfterApprovalResult> {
  const at = input.decidedAt ?? new Date().toISOString();
  const outcome = await withClaimState<ContinueAfterApprovalResult>(
    input.root,
    input.app,
    input.issueNumber,
    async (state) => {
      const suppressed = recordedSuppression(state, input, at);
      if (state.continuation === undefined) {
        // The raising turn is already gone — reconciled, expired, or decided
        // after it ended. There is nothing to resume, but the SUPPRESSION still
        // has to land: an approval outliving its requester is precisely the
        // orphan case #244 was filed for, and "no record" is the failure mode,
        // not an acceptable outcome. Report it distinctly so the caller does
        // not describe an unparked ticket as resumed.
        if (suppressed.suppressed === undefined) return { value: "unparked", state };
        return { value: "unparked", state: { ...state, ...suppressed } };
      }
      if (state.continuation.decisions.some((decision) => decision.approvalId === input.approvalId)) {
        // Replay: the decision is already durable. Report what it resolved to
        // so the caller repairs the same label projection it would have made.
        return {
          value: state.continuation.status === "ready" ? "resumed" : "terminalized",
          state,
        };
      }
      const decisions: LoopContinuationDecision[] = [
        ...state.continuation.decisions,
        {
          approvalId: input.approvalId,
          decision: input.decision,
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          decidedAt: at,
        },
      ];
      const terminalizes = input.decision === "denied" && (state.continuation.pauseKind ?? "approval") === "budget";
      if (terminalizes) {
        const detail =
          `claim ${state.continuation.claimNumber}: budget grant ${input.approvalId} denied; ` +
          `${state.continuation.pipeline}/${state.continuation.pass} returned with artifacts ` +
          "preserved and no failure-claim consumption";
        const { continuation: _continuation, ...withoutContinuation } = state;
        return {
          value: "terminalized",
          state: {
            ...withoutContinuation,
            ...suppressed,
            outcomes: [...state.outcomes.slice(-9), detail],
            events: appendEvent(state, {
              at,
              kind: "claim_terminal",
              claimNumber: state.continuation.claimNumber,
              detail,
              repeatedCostUsd: 0,
            }),
          },
        };
      }
      return {
        value: "resumed",
        state: {
          ...state,
          ...suppressed,
          continuation: { ...state.continuation, status: "ready", decisions },
          events: appendEvent(state, {
            at,
            kind: "approval_resumed",
            claimNumber: state.continuation.claimNumber,
            detail: `${input.decision} ${input.approvalId}; exact session ready`,
          }),
        },
      };
    },
  );
  if (outcome === "unparked") return outcome;
  if (outcome === "terminalized") {
    await projectReturnedLabel(input.gh, input.issueNumber);
    return outcome;
  }
  await projectReadyLabel(input.gh, input.issueNumber, "op:blocked");
  return outcome;
}

/** `unparked` = the decision was durable but no turn was waiting on it; the
 * #244 record still landed. */
export type ContinueAfterApprovalResult = "resumed" | "terminalized" | "unparked";

/** The #244 deposit, idempotent by (approvalId, disposition) so a replayed
 * decision cannot inflate the record. */
function recordedSuppression(
  state: TicketClaimState,
  input: {
    approvalId: string;
    decision: "approved" | "denied";
    reason?: string;
    suppression?: Pick<SuppressedOperation, "rule" | "actionSha256" | "tool">;
  },
  at: string,
): Pick<TicketClaimState, "suppressed"> | Record<string, never> {
  if (input.decision !== "denied" || input.suppression === undefined) return {};
  const existing = state.suppressed ?? [];
  if (existing.some((record) => record.approvalId === input.approvalId && record.disposition === "denied")) {
    return {};
  }
  return {
    suppressed: [
      ...existing,
      {
        approvalId: input.approvalId,
        rule: input.suppression.rule,
        actionSha256: input.suppression.actionSha256,
        tool: input.suppression.tool,
        disposition: "denied",
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        at,
      },
    ],
  };
}

/** Recover exceptions at the label/selection/lock/pipeline-start boundaries.
 * Once a provider started, ambiguity is never blindly retried: the ticket is
 * returned with the exact re-arm command and preserved evidence. */
export async function recoverClaimException(
  input: ClaimMutation & {
    gh: GhOps;
    error: unknown;
    now?: Date;
  },
): Promise<string> {
  const now = input.now ?? new Date();
  let providerStarted = false;
  let claimNumber = 0;
  await withClaimState(input.root, input.app, input.issueNumber, async (state) => {
    const active = requireLease(state, input.claimId);
    providerStarted = active.phase === "provider_started";
    claimNumber = active.claimNumber;
    const { active: _active, ...withoutActive } = state;
    const next: TicketClaimState = {
      ...withoutActive,
      events: appendEvent(state, {
        at: now.toISOString(),
        kind: "automatic_recovery",
        claimNumber,
        detail:
          `${providerStarted ? "post-provider ambiguity; human re-arm required" : "pre-provider failure; auto re-armed"}: ` +
          errorMessage(input.error),
        repeatedCostUsd: 0,
      }),
    };
    return { value: undefined, state: next };
  });
  const issue = await input.gh.readIssue(input.issueNumber);
  if (providerStarted) {
    const workingLabel = activeClaimLabel(issue);
    if (workingLabel !== undefined) {
      await input.gh.swapLabel(input.issueNumber, workingLabel, "op:returned");
    }
    return `#${input.issueNumber}: post-provider claim ${claimNumber} returned; explicit re-arm required (${errorMessage(input.error)})`;
  }
  const workingLabel = activeClaimLabel(issue);
  if (workingLabel !== undefined) {
    await input.gh.swapLabel(input.issueNumber, workingLabel, "op:ready");
  }
  return `#${input.issueNumber}: pre-provider claim ${claimNumber} recovered without consuming allowance (${errorMessage(input.error)})`;
}

/** Startup reconciliation for a previous process that died mid-saga. */
export async function recoverInterruptedClaims(input: {
  root: string;
  app: string;
  gh: GhOps;
  entries: readonly { issueNumber: number; state: TicketClaimState }[];
  now?: Date;
}): Promise<string[]> {
  const now = input.now ?? new Date();
  const lines: string[] = [];
  for (const entry of input.entries) {
    const active = entry.state.active;
    if (active !== undefined && !processIsAlive(active.ownerPid, active.ownerProcessStartIdentity)) {
      const issue = await input.gh.readIssue(entry.issueNumber);
      if (active.phase === "provider_started") {
        const workingLabel = activeClaimLabel(issue);
        if (workingLabel !== undefined) {
          await input.gh.swapLabel(entry.issueNumber, workingLabel, "op:returned");
        }
        await clearOrphan(input.root, input.app, entry.issueNumber, active.claimId, now, true);
        lines.push(`#${entry.issueNumber}: orphaned paid claim returned; explicit re-arm required`);
      } else {
        const workingLabel = activeClaimLabel(issue);
        if (workingLabel !== undefined) {
          await input.gh.swapLabel(entry.issueNumber, workingLabel, "op:ready");
        }
        await clearOrphan(input.root, input.app, entry.issueNumber, active.claimId, now, false);
        lines.push(`#${entry.issueNumber}: orphaned pre-provider claim auto-rearmed`);
      }
    }
    if (entry.state.continuation?.status === "ready") {
      const issue = await input.gh.readIssue(entry.issueNumber);
      if (issue.labels.includes("op:blocked")) {
        await input.gh.swapLabel(entry.issueNumber, "op:blocked", "op:ready");
        lines.push(`#${entry.issueNumber}: repaired approval decision projection -> op:ready`);
      }
    }
  }
  return lines;
}

export async function planTicketRearm(input: RearmTicketInput): Promise<RearmPlan> {
  validateRearmInput(input);
  const terminalEpisode = await readTerminalTicketEpisode(input);
  if (terminalEpisode !== undefined) {
    throw new Error(
      `loop rearm: cannot rearm ${input.app}#${input.issueNumber}: episode ` +
        `${terminalEpisode.episodeId} is terminal (${terminalEpisode.terminal.status}: ` +
        `${terminalEpisode.terminal.reason}); rearm cannot resume terminal episodes. ` +
        "Leave the ticket parked at op:returned and create a new ticket for further work.",
    );
  }
  const state = readTicketClaimState(input.root, input.app, input.issueNumber);
  const issue = await input.gh.readIssue(input.issueNumber);
  const priorLabel = issue.labels.includes("op:blocked")
    ? "op:blocked"
    : issue.labels.includes("op:returned")
      ? "op:returned"
      : undefined;
  const rearmId = stableId({
    app: input.app,
    issueNumber: input.issueNumber,
    reason: input.reason.trim(),
    actor: input.actor.trim(),
    priorAllowance: input.priorAllowance,
    intendedAllowance: input.intendedAllowance,
  });
  const existing = state.rearms?.find((record) => record.rearmId === rearmId);
  if (existing !== undefined) {
    return {
      ...existing,
      priorLabel: existing.priorLabel as RearmPlan["priorLabel"],
      replay: existing.status === "completed",
    };
  }
  if (priorLabel === "op:blocked" && state.continuation?.status === "waiting_approval") {
    throw new Error(
      `loop rearm: ${input.app}#${input.issueNumber} is waiting on an approval; ` +
        "decide it with `cormidia approvals review` instead of bypassing the content-bound continuation",
    );
  }
  if (effectiveClaimAllowance(state, input.priorAllowance) !== input.priorAllowance) {
    throw new Error(
      `loop rearm: stale --from-allowance ${input.priorAllowance}; durable allowance is ` +
        `${effectiveClaimAllowance(state, input.priorAllowance)}`,
    );
  }
  if (priorLabel === undefined) {
    throw new Error(
      `loop rearm: ${input.app}#${input.issueNumber} is not parked (expected op:blocked or op:returned); ` +
        "a label-only op:ready change cannot raise the durable allowance",
    );
  }
  return {
    rearmId,
    app: input.app,
    issueNumber: input.issueNumber,
    reason: input.reason.trim(),
    actor: input.actor.trim(),
    priorAllowance: input.priorAllowance,
    intendedAllowance: input.intendedAllowance,
    priorLabel,
    replay: false,
  };
}

export async function executeTicketRearm(input: RearmTicketInput): Promise<RearmPlan> {
  const plan = await planTicketRearm(input);
  if (plan.replay) return plan;
  const now = input.now ?? new Date();
  await withClaimState(input.root, input.app, input.issueNumber, async (state) => {
    const existing = state.rearms?.find((record) => record.rearmId === plan.rearmId);
    if (existing?.status === "completed") return { value: undefined, state };
    if (existing === undefined && effectiveClaimAllowance(state, plan.priorAllowance) !== plan.priorAllowance) {
      throw new Error(
        `loop rearm: concurrent allowance change; expected ${plan.priorAllowance}, durable allowance is ` +
          `${effectiveClaimAllowance(state, plan.priorAllowance)}`,
      );
    }
    const record: TicketRearmRecord = existing ?? {
      rearmId: plan.rearmId,
      app: plan.app,
      issueNumber: plan.issueNumber,
      reason: plan.reason,
      actor: plan.actor,
      priorAllowance: plan.priorAllowance,
      intendedAllowance: plan.intendedAllowance,
      priorLabel: plan.priorLabel,
      status: "prepared",
      preparedAt: now.toISOString(),
    };
    return {
      value: undefined,
      state: {
        ...state,
        claimAllowance: plan.intendedAllowance,
        rearms: [...(state.rearms ?? []).filter((candidate) => candidate.rearmId !== plan.rearmId), record],
      },
    };
  });
  await projectReadyLabel(input.gh, input.issueNumber, plan.priorLabel);
  await withClaimState(input.root, input.app, input.issueNumber, async (state) => {
    const records = state.rearms ?? [];
    const record = records.find((candidate) => candidate.rearmId === plan.rearmId);
    if (record === undefined) throw new Error(`loop rearm: prepared record ${plan.rearmId} vanished`);
    if (record.status === "completed") return { value: undefined, state };
    return {
      value: undefined,
      state: {
        ...state,
        rearms: records.map((candidate) =>
          candidate.rearmId === plan.rearmId
            ? { ...candidate, status: "completed" as const, completedAt: now.toISOString() }
            : candidate,
        ),
        events: appendEvent(state, {
          at: now.toISOString(),
          kind: "manual_rearm",
          claimNumber: state.claims,
          detail:
            `${plan.actor}: ${plan.reason}; allowance ${plan.priorAllowance}->${plan.intendedAllowance}; ` +
            `${plan.priorLabel}->op:ready`,
        }),
      },
    };
  });
  return plan;
}

interface ClaimMutation {
  root: string;
  app: string;
  issueNumber: number;
  claimId: string;
}

async function mutateLease(
  input: ClaimMutation,
  mutate: (state: TicketClaimState, active: NonNullable<TicketClaimState["active"]>) => TicketClaimState,
): Promise<void> {
  await withClaimState(input.root, input.app, input.issueNumber, async (state) => ({
    value: undefined,
    state: mutate(state, requireLease(state, input.claimId)),
  }));
}

function requireLease(state: TicketClaimState, claimId: string): NonNullable<TicketClaimState["active"]> {
  if (state.active?.claimId !== claimId) {
    throw new Error(`claim recovery: active claim does not match lease ${claimId}`);
  }
  return state.active;
}

async function clearOrphan(
  root: string,
  app: string,
  issueNumber: number,
  claimId: string,
  now: Date,
  providerStarted: boolean,
): Promise<void> {
  await withClaimState(root, app, issueNumber, async (state) => {
    if (state.active?.claimId !== claimId) return { value: undefined, state };
    const { active: _active, ...withoutActive } = state;
    return {
      value: undefined,
      state: {
        ...withoutActive,
        events: appendEvent(state, {
          at: now.toISOString(),
          kind: "automatic_recovery",
          claimNumber: state.active.claimNumber,
          detail: providerStarted
            ? "orphaned post-provider claim returned for explicit recovery"
            : "orphaned pre-provider claim auto-rearmed without consuming allowance",
          repeatedCostUsd: 0,
        }),
      },
    };
  });
}

/** Park a denied budget pause. Idempotent, and deliberately tolerant of any
 * surviving claim label: the durable decision is already committed, so the
 * label is a projection to repair rather than a precondition to enforce. */
async function projectReturnedLabel(gh: GhOps, issueNumber: number): Promise<void> {
  const issue = await gh.readIssue(issueNumber);
  if (issue.labels.includes("op:returned")) return;
  const from = issue.labels.find((label) => ["op:blocked", "op:building", "op:in-review", "op:ready"].includes(label));
  if (from === undefined) await gh.addLabel(issueNumber, "op:returned");
  else await gh.swapLabel(issueNumber, from, "op:returned");
}

async function projectReadyLabel(gh: GhOps, issueNumber: number, priorLabel: string): Promise<void> {
  const issue = await gh.readIssue(issueNumber);
  if (issue.labels.includes("op:ready")) return;
  if (!issue.labels.includes(priorLabel)) {
    throw new Error(`claim recovery: #${issueNumber} label projection is neither ${priorLabel} nor op:ready`);
  }
  await gh.swapLabel(issueNumber, priorLabel, "op:ready");
}

async function withClaimState<T>(
  root: string,
  app: string,
  issueNumber: number,
  fn: (state: TicketClaimState) => Promise<{ value: T; state: TicketClaimState }>,
): Promise<T> {
  const path = ticketStatePath(root, app, issueNumber);
  return withFileLock(`${path}.lock`, { staleMs: LOCK_STALE_MS, maxWaitMs: LOCK_WAIT_MS }, async () => {
    const current = readTicketClaimState(root, app, issueNumber);
    const result = await fn(current);
    writeTicketClaimState(root, app, issueNumber, result.state);
    return result.value;
  });
}

function appendEvent(state: TicketClaimState, event: TicketClaimEvent): TicketClaimEvent[] {
  return [...(state.events ?? []).slice(-(EVENT_LIMIT - 1)), event];
}

function stripContinuationState(continuation: NonNullable<TicketClaimState["continuation"]>): LoopContinuation {
  const {
    status: _status,
    claimNumber: _claimNumber,
    pauseCount: _pauseCount,
    pauseCostUsd: _pauseCostUsd,
    ...exact
  } = continuation;
  return exact;
}

function processIsAlive(pid: number, startIdentity?: string): boolean {
  if (startIdentity !== undefined) {
    const identity = processIdentityStatus(pid, startIdentity);
    if (identity === "match") return true;
    if (identity === "mismatch") return false;
  }
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function activeClaimLabel(issue: Pick<GhIssue, "labels">): "op:building" | "op:in-review" | undefined {
  if (issue.labels.includes("op:building")) return "op:building";
  if (issue.labels.includes("op:in-review")) return "op:in-review";
  return undefined;
}

function stableId(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex").slice(0, 24);
}

function validateRearmInput(input: RearmTicketInput): void {
  if (input.reason.trim() === "") throw new Error("loop rearm: --reason is required");
  if (input.actor.trim() === "") throw new Error("loop rearm: --actor is required");
  if (!Number.isInteger(input.priorAllowance) || input.priorAllowance < 0) {
    throw new Error("loop rearm: --from-allowance must be a non-negative integer");
  }
  if (!Number.isInteger(input.intendedAllowance) || input.intendedAllowance <= input.priorAllowance) {
    throw new Error("loop rearm: --to-allowance must be an integer greater than --from-allowance");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Exact operator command embedded in parked comments and status output. */
export function rearmCommand(input: { app: string; issueNumber: number; allowance: number }): string {
  return (
    `cormidia loop rearm --app ${shellWord(input.app)} --ticket ${input.issueNumber} ` +
    `--reason <reason> --actor <actor> --from-allowance ${input.allowance} ` +
    `--to-allowance ${input.allowance + 1} --execute --confirm ${shellWord(`${input.app}#${input.issueNumber}`)}`
  );
}

function shellWord(value: string): string {
  return /^[A-Za-z0-9._#/-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

export function parkedStateEntries(
  entries: readonly { issueNumber: number; state: TicketClaimState }[],
): { issueNumber: number; state: TicketClaimState }[] {
  return entries.filter((entry) => entry.state.active !== undefined || entry.state.continuation !== undefined);
}

export function issueHasClaimLabel(issue: Pick<GhIssue, "labels">): boolean {
  return issue.labels.some((label) => ["op:ready", "op:building", "op:blocked", "op:returned"].includes(label));
}
