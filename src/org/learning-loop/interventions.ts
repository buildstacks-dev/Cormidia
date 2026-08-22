// Kernel interventions as Cormidia sees them: the kernel's four-dimensional
// InterventionState (publication / authorization / activation / validation,
// decisions 0026–0028) folded into the vocabulary the CLI and reports have
// always rendered — `authorized (unproven)` for an active intervention whose
// validation is not `improved`, `validated` only for one whose bound
// evaluation improved (design §9.1: authorized and validated are distinct,
// permanent markings; nothing but a completed experiment produces validated).
// Host lineage (artifact id, reviewed routing) comes from the host index.

import type { InterventionRecord, InterventionState } from "@cormidia/learning-loop";
import { artifactIdOf, listHostCandidateIndexes, type CandidateRouting } from "./host-index.js";
import type { CormidiaLearningLoop } from "./loop.js";

export type ClaimLabel = "authorized (unproven)" | "validated";

export interface KernelInterventionView {
  readonly id: string;
  readonly candidateId: string;
  readonly artifactId: string;
  readonly planId: string;
  readonly state: InterventionState;
  readonly routing: CandidateRouting | undefined;
  /** `authorized` while active and unvalidated, `validated` after an improved
   *  evaluation, null when the intervention is not active (published-inactive
   *  proposals, disabled, rolled back). */
  readonly claim: "authorized" | "validated" | null;
  readonly claimLabel: ClaimLabel | undefined;
  readonly receiptIds: readonly string[];
  readonly evaluationIds: readonly string[];
}

/** `plan-<digest>` ↔ `intervention-<digest>` (kernel publication journal). */
export function interventionIdForPlan(planId: string): string {
  if (!planId.startsWith("plan-")) throw new Error(`learning-loop: "${planId}" is not a plan id`);
  return `intervention-${planId.slice("plan-".length)}`;
}

export function planIdForIntervention(interventionId: string): string {
  if (!interventionId.startsWith("intervention-")) {
    throw new Error(`learning-loop: "${interventionId}" is not an intervention id`);
  }
  return `plan-${interventionId.slice("intervention-".length)}`;
}

export function claimOf(state: InterventionState): "authorized" | "validated" | null {
  if (state.activation !== "active") return null;
  return state.validation === "improved" ? "validated" : "authorized";
}

/** `validated` is earned; `authorized` renders as unproven everywhere
 *  (design §9.1) so an unevaluated activation can never read as a win. */
export function claimLabelOf(claim: "authorized" | "validated" | null): ClaimLabel | undefined {
  if (claim === null) return undefined;
  return claim === "validated" ? "validated" : "authorized (unproven)";
}

export function viewOfRecord(
  record: InterventionRecord,
  routing: CandidateRouting | undefined,
): KernelInterventionView {
  const claim = claimOf(record.state);
  return {
    id: record.id,
    candidateId: record.candidateId,
    artifactId: artifactIdOf(record.candidateId),
    planId: record.planId,
    state: record.state,
    routing,
    claim,
    claimLabel: claimLabelOf(claim),
    receiptIds: record.publicationReceiptIds,
    evaluationIds: record.evaluationIds,
  };
}

async function routingFor(learning: CormidiaLearningLoop, candidateId: string): Promise<CandidateRouting | undefined> {
  for (const index of await listHostCandidateIndexes(learning.stateDir)) {
    const entry = index.entries.find((candidate) => candidate.id === candidateId);
    if (entry !== undefined) return entry.routing;
  }
  return undefined;
}

/** One intervention as the CLI renders it, or undefined for an unknown id. */
export async function interventionViewOf(
  learning: CormidiaLearningLoop,
  interventionId: string,
): Promise<KernelInterventionView | undefined> {
  const record = await learning.loop.getIntervention({ interventionId });
  if (record === undefined) return undefined;
  return viewOfRecord(record, await routingFor(learning, record.candidateId));
}

/** Every intervention the host index knows, each re-read from the kernel
 *  (the kernel's `report` does not yet fold the activation tier — its own
 *  `report.tier_not_implemented` diagnostic; the index is the lookup, the
 *  kernel record the fact). Sorted by artifact id, then proposal order. */
export async function listKernelInterventions(learning: CormidiaLearningLoop): Promise<KernelInterventionView[]> {
  const views: KernelInterventionView[] = [];
  for (const index of await listHostCandidateIndexes(learning.stateDir)) {
    for (const entry of index.entries) {
      if (entry.intervention_id === undefined) continue;
      const record = await learning.loop.getIntervention({ interventionId: entry.intervention_id });
      if (record !== undefined) views.push(viewOfRecord(record, entry.routing));
    }
  }
  return views;
}
