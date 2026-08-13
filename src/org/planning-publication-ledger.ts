// Planning publication ledger — the transactional half of the retired
// planning-coverage record (F-PT-039 / #386).
//
// The old `PlanningCoverageRecord` carried two unrelated things in one file:
// (a) source-section coverage, which existed only because Cormidia pre-read the
// operator's files, and (b) the publication transaction — which tickets were
// prepared, which reached GitHub, under which planning intent. F-PT-039 deleted
// (a) with the pre-read. (b) is what makes issue publication at-most-once across
// a crash, so it survives here, decoupled and much smaller.
//
// Nothing in this module knows what a source file contains. If a field here
// starts describing source CONTENT, the retired design is growing back.

import { stableHash } from "../loop/episode-plan.js";
import type { PlanningSourceTicketEvidence, PlanProvenance, TicketPlan } from "../loop/plan-tickets.js";

export type PlanningTicketState = "planned" | "published" | "delivered" | "superseded";

interface LedgerTicket {
  identity: string;
  plan_index: number;
  state: PlanningTicketState;
  issue_number: number | null;
  provenance: PlanProvenance;
}

interface PublicationBatch {
  batch_id: string;
  indexes: number[];
  admission_cap: number;
  status: "prepared" | "completed";
  provenance: PlanProvenance;
}

export interface PlanningPublicationLedger {
  schema_version: 1;
  kind: "planning-publication-ledger";
  app: string;
  scope_id: string;
  /** Binds operator INPUT (goal, stage, planning options, creator scope) — never
   * a stage inferred from mutable repository evidence, and never source bytes. */
  planning_intent_hash: string;
  plan: TicketPlan;
  provenance: PlanProvenance;
  /** Observed source consumption from the turn that AUTHORED this plan. Bound
   * here rather than supplied per publication, because a later batch is often
   * published by an invocation that read nothing — its evidence would otherwise
   * overwrite the evidence of the turn that actually looked at the sources. */
  source_evidence: PlanningSourceTicketEvidence | null;
  tickets: LedgerTicket[];
  publication_batches: PublicationBatch[];
  updated_at: string;
}

export type PreparedPlanningRecoveryDecision =
  | { action: "none" }
  | { action: "recover" }
  | { action: "refuse"; summary: string; nextAction: string };

/** Recovery identity binds operator input, never repository-derived evidence. */
export function planningRecoveryIntentHash(input: {
  goal: string;
  requestedStage: string | null;
  planning: unknown;
  creatorScope: unknown;
}): string {
  return stableHash(input);
}

/** A prepared publication is an outstanding external-effect transaction: issues
 * may already exist on GitHub. It must be recovered before any other planning
 * work, or a second run duplicates them (INV-011/INV-013, CF-REG-374's retained
 * crash-recovery legs). */
export function preparedPlanningRecoveryDecision(input: {
  ledger: PlanningPublicationLedger | undefined;
  currentIntentHash: string;
  resume: boolean;
  publish: boolean;
}): PreparedPlanningRecoveryDecision {
  if (!input.ledger?.publication_batches.some((batch) => batch.status === "prepared")) {
    return { action: "none" };
  }
  if (input.ledger.planning_intent_hash !== input.currentIntentHash) {
    return {
      action: "refuse",
      summary: "A prepared planning publication must be recovered before changing planning intent.",
      nextAction: "Rerun the preserved planning intent with --resume-publication to recover its prepared batch first.",
    };
  }
  if (!input.resume || !input.publish) {
    return {
      action: "refuse",
      summary: "A prepared planning publication remains incomplete and must be recovered before other planning work.",
      nextAction:
        "Rerun with --resume-publication and publication enabled to recover the prepared batch without duplicate issues.",
    };
  }
  return { action: "recover" };
}

export function isPlanningPublicationLedger(value: unknown): value is PlanningPublicationLedger {
  if (typeof value !== "object" || value === null) return false;
  const record: Partial<Record<keyof PlanningPublicationLedger, unknown>> = value;
  return (
    record.schema_version === 1 &&
    record.kind === "planning-publication-ledger" &&
    typeof record.app === "string" &&
    typeof record.scope_id === "string" &&
    typeof record.planning_intent_hash === "string" &&
    Array.isArray(record.tickets) &&
    Array.isArray(record.publication_batches)
  );
}
