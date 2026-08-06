// Narrative V1 capture schema (#129; docs/narrative/design.md).
//
// A story is the durable, human-readable projection of ONE episode: the
// causal arc from originating input through planning, build passes, review,
// and merge. The capture (story.json) is the source of truth the markdown is
// rendered from — quotes are inlined AT CAPTURE TIME because the verbatim
// sources (runs/) are retention-swept at 30 days while the ids live 180–365;
// a pure-hyperlink narrative would decay into dead links within a month.

import type { TurnAssignmentSource } from "../runtime/types.js";

export const NARRATIVE_SCHEMA_VERSION = 1 as const;

export type StoryKind = "planning" | "ticket" | "trace";
export type StoryStatus = "in_progress" | "completed" | "failed" | "unknown";

/** A bounded, redacted excerpt captured while its source still existed.
 *  `source` names where the text came from (relative to the state home) so a
 *  reader can reach the full artifact while retention permits. */
export interface NarrativeQuote {
  source: string;
  text: string;
  truncated: boolean;
}

/** One hop in the story's timeline — a pass execution, in start order. */
export interface NarrativeMoment {
  at: string;
  run_id: string;
  pipeline: string;
  pass: string;
  role: string;
  model?: string;
  /** Accepted EpisodePlan provenance. Optional so retained pre-plan captures
   *  remain valid and render without invented attribution. */
  plan_version?: number;
  plan_step_id?: string;
  assignment_source?: TurnAssignmentSource;
  status: string;
  headline: string;
  quote?: NarrativeQuote;
  /** Relative evidence path (`runs/<app>/<runId>/`) — degrades to a name
   *  once retention sweeps the directory; the quote above is what survives. */
  evidence: string;
}

interface NarrativeDeliveryStage {
  boundary: string;
  status: "completed" | "invalidated";
  at: string;
  attempt: number;
}

export interface NarrativeStory {
  schema_version: typeof NARRATIVE_SCHEMA_VERSION;
  /** Episode id — the story's identity. */
  story_id: string;
  app: string;
  kind: StoryKind;
  title: string;
  opened: string;
  closed?: string;
  status: StoryStatus;
  /** Where this work came from, when durably known. */
  origin?: {
    kind: "parent_task" | "planning_brief";
    ref?: string;
    quote?: NarrativeQuote;
  };
  /** Planning stories: the tickets this plan published (#128 local record). */
  planned_tickets?: Array<{ issue_number: number; title: string; ready: boolean }>;
  /** Ticket stories: the planning execution that authored the ticket,
   *  joined locally from published-tickets records — never guessed. */
  planned_by?: { episode_id: string; run_id: string; trace_id: string };
  /** Deterministic Planner egress after provider completion. Pending/refused
   * state keeps the planning story visibly non-complete. */
  publication?: {
    id: string;
    state: "publication_pending" | "published" | "refused";
    branch: string;
    commit: string;
    branch_created: boolean;
    error: string | null;
    recovery_command: string;
  };
  ticket_ref?: string;
  moments: NarrativeMoment[];
  /** Build→review→merge boundaries from the execution journal. */
  delivery?: {
    stages: NarrativeDeliveryStage[];
    status: string;
    outcome?: string;
  };
  /** Settled ledger truth only — never envelope estimates. */
  cost?: { usd: number; provider_turns: number; unmeasured_turns: number };
  /** Newest source timestamp folded in — the deterministic "as of". */
  captured_at: string;
}
