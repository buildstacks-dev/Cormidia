// CF-SM-APPR — the approval-item execution transition relation and its
// detector (HB-011).
//
// The relation is derived from the PRODUCT's own transition writers in
// src/org/approvals.ts (each edge cites the method that produces it), so the
// detector can never drift from what the store can actually write. It encodes
// the ratified machine from case-catalog §2:
//   pending → approved|denied → executing → executed|failed|ambiguous
// where `pending`/`denied` live on `ApprovalItem.status` and the execution
// states on `ApprovalItem.execution.state` (INV-003: an approved item and an
// executed operation are distinct durable facts).
//
// On "approved → executed without executing" (the catalog's named illegal
// jump): the AUTOMATED path refuses it — `finishExecution` throws unless the
// state is `executing` (or reconciles `ambiguous`); that refusal is asserted
// at the store seam in hermetic/cf-sm-appr. The ONLY writer of a direct
// approved→executed edge is `dispositionExecution` — an explicit HUMAN
// reconciliation that requires a non-empty reason and records the actor
// (approvals.ts "Exact confirmed executed/failed dispositions may also
// terminalize a legacy `approved` … record"). The log-level relation therefore
// admits that edge; the seam-level refusal is what keeps automation from
// taking it.

import type {
  ApprovalExecutionState,
  ApprovalLogEvent,
} from "../../../src/org/approvals.js";

/** Every execution state, pinned exhaustively: the `Record` below fails to
 *  compile if the product union gains or loses a member. */
export const LEGAL_EXECUTION_TRANSITIONS: Record<
  ApprovalExecutionState,
  readonly ApprovalExecutionState[]
> = {
  // decide(approved) initializes `approved` (initialExecution); from there:
  approved: [
    "executing", // beginExecution / claimActorRetryGrantSync
    "executed", // dispositionExecution: human-confirmed terminal from a legacy approved record
    "failed", // revokeGrantSync pre-execution; dispositionExecution; reconcileLegacyActorRetryStates
    "ambiguous", // reconcileLegacyActorRetryStates (consumed grant, no acknowledged outcome)
  ],
  executing: [
    "executed", // finishExecution
    "failed", // finishExecution; dispositionExecution (crash-stuck executing)
    "ambiguous", // finishExecution (no unambiguous provider outcome)
  ],
  ambiguous: [
    "executed", // finishExecution reconcilesAmbiguous / dispositionExecution
    "failed", // finishExecution reconcilesAmbiguous / dispositionExecution
    "approved", // dispositionExecution retry (explicit content-bound re-arm)
  ],
  failed: [
    "executed", // dispositionExecution (human confirms the effect did land)
    "approved", // dispositionExecution retry
  ],
  // Terminal: NO writer leaves `executed`. A transition out of it means an
  // acknowledged irreversible effect was re-opened — INV-003's "ambiguity is
  // terminal-until-reconciled and is never resolved by re-performing the
  // effect" has no re-perform edge at all once acknowledged.
  executed: [],
};

export class ApprovalTransitionViolation extends Error {
  constructor(
    readonly approvalId: string,
    readonly detail: string,
  ) {
    super(`CF-SM-APPR: illegal execution transition on approval ${approvalId}: ${detail}`);
    this.name = "ApprovalTransitionViolation";
  }
}

type TransitionEvent = Extract<ApprovalLogEvent, { type: "execution-transition" }>;

/** The CF-SM-APPR detector: throws `ApprovalTransitionViolation` when the
 *  append-only log carries an execution-transition sequence the product's own
 *  writers could not have produced —
 *  - a (from → to) edge outside `LEGAL_EXECUTION_TRANSITIONS` (e.g. the
 *    executed → executing re-perform, INV-003's forbidden resolution);
 *  - a per-item chain discontinuity (an event's `from` differing from the
 *    previous event's `to` — e.g. approved→executing recorded twice, the
 *    double-begin a replayed claim would leave);
 *  - a chain that does not start at `approved` (execution records are born
 *    `approved` by initialExecution; nothing precedes that). */
export function detectIllegalExecutionTransitions(
  events: readonly ApprovalLogEvent[],
): void {
  const byItem = new Map<string, TransitionEvent[]>();
  for (const event of events) {
    if (event.type !== "execution-transition") continue;
    const chain = byItem.get(event.id) ?? [];
    chain.push(event);
    byItem.set(event.id, chain);
  }
  for (const [id, chain] of byItem) {
    let previous: TransitionEvent | undefined;
    for (const event of chain) {
      const legalTargets: readonly ApprovalExecutionState[] | undefined =
        LEGAL_EXECUTION_TRANSITIONS[event.from];
      if (legalTargets === undefined) {
        throw new ApprovalTransitionViolation(id, `unknown source state ${JSON.stringify(event.from)}`);
      }
      if (!legalTargets.includes(event.to)) {
        throw new ApprovalTransitionViolation(id, `${event.from} → ${event.to} has no product writer`);
      }
      if (previous === undefined) {
        if (event.from !== "approved") {
          throw new ApprovalTransitionViolation(
            id,
            `chain starts at ${event.from}; execution records are born approved`,
          );
        }
      } else if (previous.to !== event.from) {
        throw new ApprovalTransitionViolation(
          id,
          `chain discontinuity: ${previous.from} → ${previous.to} followed by ${event.from} → ${event.to}`,
        );
      }
      previous = event;
    }
  }
}
