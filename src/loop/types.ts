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
}
