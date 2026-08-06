import type { Finding } from "./verdicts.js";
import type { CriterionTestMap, GateRunResult } from "./qgates.js";
import type { SessionHandle, TurnAssignment } from "../runtime/types.js";
import type { EpisodeReplanEventKind } from "./episode-replan.js";

export type LoopPhase = "ready" | "building" | "gates" | "reviewing" | "shipping" | "merged" | "returned" | "blocked";

export type TicketTier = "quick" | "standard" | "deep";

// --- Release handoff (docs/approvals/design.md A4) ----------
// Defined in the loop layer so both sides of the one-way import boundary can
// share them: the plan publisher renders the milestone's release kind into
// ticket bodies, advanceShipping enforces P7 against the app's declared
// mechanism, and the org layer (apps.ts `release:` block, approval queue)
// imports these types downward.

export const RELEASE_KINDS = ["deploy", "package", "merge-only"] as const;
export type ReleaseKind = (typeof RELEASE_KINDS)[number];

export const RELEASE_OWNERS = ["orchestrator", "sre"] as const;
export type ReleaseOwner = (typeof RELEASE_OWNERS)[number];

/** How a release is fired (deploy/package only; absent for `merge-only`):
 *  - `tag`: Cormidia pushes a version tag `vX.Y.Z` (the milestone's declared
 *    `Release-version`) — the app's deploy workflow listens on `push: tags`.
 *    The default for a mechanism that declares no `command`.
 *  - `command`: Cormidia runs the app's declared `command` after merge (the
 *    pre-tag mechanism, retained as an escape hatch and inferred when a
 *    `command` is present without an explicit `trigger`).
 *  - `branch`: planned; rejected at parse until implemented. */
export const RELEASE_TRIGGERS = ["tag", "branch", "command"] as const;
export type ReleaseTriggerMode = (typeof RELEASE_TRIGGERS)[number];

/** An app's declared release mechanism (`release:` in `.cormidia/config.yaml`
 *  / apps.yaml). For `trigger: command` a `command` is required; for
 *  `trigger: tag` no command is declared (Cormidia derives the tag push); a
 *  `merge-only` mechanism has neither a command nor a trigger. */
export interface ReleaseConfig {
  kind: ReleaseKind;
  command?: string;
  owner: ReleaseOwner;
  trigger?: ReleaseTriggerMode;
  /** GitHub identities allowed to authorize a tag-triggered release. The
   *  exact tag-push actor and RQ-1 approval identity must match one entry. */
  approvers?: string[];
}

/** Data the loop returns when a merged milestone requires a release action.
 *  The loop never raises approvals itself (one-way imports): the org layer
 *  turns this into a critical-op item on the approval queue. */
export interface ReleaseTrigger {
  kind: ReleaseKind;
  command: string;
  owner: ReleaseOwner;
  /** Exact tag/merge identity retained for package-evidence handoff. Older
   * command-triggered records omit both fields and remain readable. */
  tag?: string;
  releaseCommit?: string;
}

export interface ScorecardEvent {
  type: "review_cycles";
  turnId: string;
  ticketRef: string;
  value: number;
}

export interface LoopEpisodeReplan {
  kind: EpisodeReplanEventKind;
  status: "pending" | "accepted" | "rejected";
  revisionVersion: number | null;
  reason: string | null;
}

export interface LoopContinuationDecision {
  approvalId: string;
  decision: "approved" | "denied";
  reason?: string;
  decidedAt: string;
}

/** Why a turn parked. One pause mechanism, two triggers (PURPOSE v2.15 (1)):
 *  - `approval` — the safety gate raised a critical-operation request;
 *  - `budget`   — the per-turn (soft-ring) cap fired and the org asked the
 *                 human to authorize the next turn's spend.
 *  Absent on continuations written before budget suspension existed; readers
 *  must treat absence as `approval`. The two differ on ONE rule: a denied
 *  approval resumes the turn without the operation, while a denied budget
 *  grant has nothing left to resume with and terminalizes the ticket. */
export type LoopPauseKind = "approval" | "budget";

/** A critical operation that was requested during a turn and did not happen.
 *
 *  #244: a verdict can otherwise pass while the evidence it depended on was
 *  silently removed — a Reviewer's negative control is denied, the turn carries
 *  on, and nothing says the proof is missing. This is the record that makes the
 *  absence visible. It is a RECORD, never a gate: refusing to pass on it is
 *  #234's decision, not this type's.
 *
 *  Since PURPOSE v2.15 (1) a gate denial suspends the turn rather than shipping
 *  past it, so exactly two dispositions remain reachable:
 *  - `denied`  — a human decided against it; the turn resumed without it.
 *  - `expired` — nobody decided within the TTL; the turn resolved blocked with
 *                its artifacts preserved (v2.15 (2)). */
export type SuppressionDisposition = "denied" | "expired";

export interface SuppressedOperation {
  approvalId: string;
  rule: string;
  /** The action's canonical AUTHORIZATION identity — the same
   *  `actionHash(item.action)` the approval store and its grants key on, so a
   *  reader can join this record to the decision that produced it. */
  actionSha256: string;
  tool: string;
  disposition: SuppressionDisposition;
  reason?: string;
  at: string;
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
  /** Absent means `approval` (every continuation written before #236). */
  pauseKind?: LoopPauseKind;
  /** The exact queue item whose decision releases this pause. Recorded on
   * budget pauses, where the orchestrator raises the item itself and must be
   * able to tell its own grant from an unrelated approval on the ticket. */
  pauseApprovalId?: string;
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
  /**
   * Immutable execution authority for this loop item. The org layer owns the
   * content-bound RoadmapPlan/validation/batch artifacts; the loop receives
   * only the member projection it needs to apply one branch/PR/HEAD/outcome
   * to every issue. A one-member value is the compatibility form.
   */
  deliveryUnit?: LoopDeliveryUnit;
  contract?: string;
  /** Parsed, typed contract mapping consumed by the completeness gate. */
  criterionTests?: CriterionTestMap;
  branch?: string;
  worktree?: string;
  prNumber?: number;
  approvedCommitId?: string;
  turnId?: string;
  rebaseNote?: string;
  /** Latest typed plan-revision disposition from this loop invocation. A
   * rejection keeps its durable refusal reason on the ordinary loop surface. */
  episodeReplan?: LoopEpisodeReplan;
  scorecardEvents?: ScorecardEvent[];
  /** Same-pass native-session continuation after a granted/denied approval.
   * It is persisted in ticket claim state by the driver and is consumed only
   * after the approval CLI records the exact decision. */
  continuation?: LoopContinuation;
  /** Set by advanceShipping on a merged item whose milestone declared a
   *  deploy/package disposition: the org layer queues it as a critical op. */
  releaseTrigger?: ReleaseTrigger;
}

export interface LoopDeliveryUnitMember {
  issueNumber: number;
  ticketRef: string;
  contentHash: string;
  title: string;
  body: string;
  labels: string[];
}

export interface LoopDeliveryUnit {
  unitId: string;
  membershipHash: string;
  members: LoopDeliveryUnitMember[];
}
