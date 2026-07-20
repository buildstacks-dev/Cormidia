import type { Finding } from "./verdicts.js";
import type { CriterionTestMap, GateRunResult } from "./qgates.js";
import type { SessionHandle, TurnAssignment } from "../runtime/types.js";

export type LoopPhase =
  | "ready"
  | "building"
  | "gates"
  | "reviewing"
  | "shipping"
  | "merged"
  | "returned"
  | "blocked";

export type TicketTier = "quick" | "standard" | "deep";

// --- Release handoff (docs/approval-and-release-amendment.md A4) ----------
// Defined in the loop layer so both sides of the one-way import boundary can
// share them: the plan publisher renders the milestone's release kind into
// ticket bodies, advanceShipping enforces P7 against the app's declared
// mechanism, and the org layer (apps.ts `release:` block, approval queue)
// imports these types downward.

export const RELEASE_KINDS = ["deploy", "package", "merge-only"] as const;
export type ReleaseKind = (typeof RELEASE_KINDS)[number];

export const RELEASE_OWNERS = ["orchestrator", "sre"] as const;
export type ReleaseOwner = (typeof RELEASE_OWNERS)[number];

/** An app's declared release mechanism (`release:` in `.operon/config.yaml`
 *  / apps.yaml). `command` is required unless kind is `merge-only`. */
export interface ReleaseConfig {
  kind: ReleaseKind;
  command?: string;
  owner: ReleaseOwner;
}

/** Data the loop returns when a merged milestone requires a release action.
 *  The loop never raises approvals itself (one-way imports): the org layer
 *  turns this into a critical-op item on the approval queue. */
export interface ReleaseTrigger {
  kind: ReleaseKind;
  command: string;
  owner: ReleaseOwner;
}

export interface ScorecardEvent {
  type: "review_cycles";
  turnId: string;
  ticketRef: string;
  value: number;
}

export interface LoopContinuationDecision {
  approvalId: string;
  decision: "approved" | "denied";
  reason?: string;
  decidedAt: string;
}

/** Exact provider continuation parked at an approval boundary. The native
 * session alone is insufficient: resuming under changed authority/context or
 * a changed worktree would let an old conversation act on new facts. The
 * fingerprints therefore fail closed before runtime construction. */
export interface LoopContinuation {
  pipeline: string;
  pass: string;
  role: string;
  /** Exact tuple used by the paused turn. Optional only for historical
   * continuations written before assignment-aware execution. */
  assignment?: TurnAssignment;
  /** Accepted plan identity. Both fields are present together on plan-backed
   * continuations; omission remains readable for historical static routes. */
  planVersion?: number;
  planStepId?: string;
  session: SessionHandle;
  completedPasses: string[];
  contextFingerprint: string;
  workFingerprint: string | null;
  runId: string;
  pausedAt: string;
  decisions: LoopContinuationDecision[];
  /** Spend already settled for the turn that reached the pause. Claim
   * lifecycle telemetry reports it separately from repeated cost (zero for an
   * exact continuation). */
  pauseCostUsd?: number;
}

export interface LoopItem {
  issueNumber: number;
  ticketRef: string;
  title: string;
  body: string;
  targetRepo: string;
  labels: string[];
  phase: LoopPhase;
  tier: TicketTier;
  cycles: number;
  remediationAttempts: number;
  gateResults: GateRunResult[];
  findings: Finding[];
  contract?: string;
  /** Parsed, typed contract mapping consumed by the completeness gate. */
  criterionTests?: CriterionTestMap;
  branch?: string;
  worktree?: string;
  prNumber?: number;
  approvedCommitId?: string;
  turnId?: string;
  rebaseNote?: string;
  scorecardEvents?: ScorecardEvent[];
  /** Same-pass native-session continuation after a granted/denied approval.
   * It is persisted in ticket claim state by the driver and is consumed only
   * after the approval CLI records the exact decision. */
  continuation?: LoopContinuation;
  /** Set by advanceShipping on a merged item whose milestone declared a
   *  deploy/package disposition: the org layer queues it as a critical op. */
  releaseTrigger?: ReleaseTrigger;
}
