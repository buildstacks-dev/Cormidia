import type { Finding } from "./verdicts.js";
import type { GateRunResult } from "./qgates.js";

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
  branch?: string;
  worktree?: string;
  prNumber?: number;
  approvedCommitId?: string;
  turnId?: string;
  rebaseNote?: string;
  scorecardEvents?: ScorecardEvent[];
  /** Set by advanceShipping on a merged item whose milestone declared a
   *  deploy/package disposition: the org layer queues it as a critical op. */
  releaseTrigger?: ReleaseTrigger;
}
