import { stableHash } from "../loop/episode-plan.js";
import { TICKET_BUDGETS, type ProjectStage } from "../loop/plan-tickets.js";
import type { PlanningCoverageRecord } from "./planning-coverage-model.js";
import { resolvePlanningStage, type PlanningStageResolution } from "./planning-stage.js";

export interface PlanningPublicationLimit {
  cap: number;
  requestedStage: ProjectStage;
  evidenceStage: ProjectStage;
  constrainedByEvidence: boolean;
}

export type PreparedPlanningRecoveryDecision =
  | { action: "none" }
  | { action: "recover" }
  | { action: "refuse"; summary: string; nextAction: string };

/** Recovery identity binds operator input, never a stage inferred from mutable repository evidence. */
export function planningRecoveryIntentHash(input: {
  goal: string;
  requestedStage: ProjectStage | null;
  planning: unknown;
  creatorScope: unknown;
}): string {
  return stableHash(input);
}

/** Render bounded prior-plan metadata for conflict-aware delta planning; source bytes never enter this brief. */
export function renderPriorPlanningCoverage(record: PlanningCoverageRecord | undefined, revise: boolean): string {
  if (record === undefined) return "";
  const active = record.tickets.filter((ticket) => ticket.state !== "superseded");
  const limit = 100;
  const ledger = active.slice(0, limit).map((ticket) => {
    const planned = record.plan.tickets[ticket.plan_index]!;
    return {
      index: ticket.plan_index,
      identity: ticket.identity,
      state: ticket.state,
      issueNumber: ticket.issue_number,
      title: planned.title.slice(0, 160),
      sourceCoverage: ticket.source_sections.slice(0, 20),
      dependsOn: [...planned.dependsOn],
      revisionDisposition: revise && ticket.state === "planned" ? "replaceable" : "retained",
    };
  });
  return [
    "## Preserved planning coverage ledger",
    "",
    `Decomposition: ${record.decomposition_id}; revision ${record.revision}. ` +
      `${active.length} active ticket(s); showing ${ledger.length}${active.length > limit ? ` of ${active.length}` : ""}.`,
    "Do not duplicate or conflict with published/in-progress work, and do not assume it was delivered. " +
      "Only state=delivered is completed context.",
    "Dependency indexes in this new TicketPlan are local to the new output. Preserved indexes are context only and " +
      "must not appear in dependsOn; cross-episode dependency edges are not supported.",
    "```json",
    JSON.stringify(ledger, null, 2),
    "```",
  ].join("\n");
}

/** A prepared publication is an outstanding external-effect transaction. */
export function preparedPlanningRecoveryDecision(input: {
  coverage: PlanningCoverageRecord | undefined;
  currentIntentHash: string;
  resume: boolean;
  revise: boolean;
  publish: boolean;
}): PreparedPlanningRecoveryDecision {
  if (!input.coverage?.publication_batches.some((batch) => batch.status === "prepared")) {
    return { action: "none" };
  }
  if (input.coverage.planning_intent_hash !== input.currentIntentHash) {
    return {
      action: "refuse",
      summary: "A prepared planning publication must be recovered before changing planning intent.",
      nextAction: "Rerun the preserved planning intent with --resume to recover its prepared publication batch first.",
    };
  }
  if (input.revise) {
    return {
      action: "refuse",
      summary: "A prepared planning publication must be recovered before revising preserved coverage.",
      nextAction: "Rerun with --resume (without --revise) to recover the prepared publication batch first.",
    };
  }
  if (!input.resume || !input.publish) {
    return {
      action: "refuse",
      summary: "A prepared planning publication remains incomplete and must be recovered before other planning work.",
      nextAction: "Rerun with --resume and publication enabled to recover the prepared batch without duplicate issues.",
    };
  }
  return { action: "recover" };
}

/** Keep publication bounded by both the requested stage and repository evidence. */
export function resolvePlanningPublicationLimit(input: {
  stageResolution: PlanningStageResolution;
  checkout: string;
  checkoutSource: PlanningStageResolution["evidence"]["checkoutSource"];
}): PlanningPublicationLimit {
  const evidenceStage = resolvePlanningStage({
    checkout: input.checkout,
    checkoutSource: input.checkoutSource,
  }).stage;
  const requestedStage = input.stageResolution.stage;
  return {
    cap: Math.min(TICKET_BUDGETS[requestedStage], TICKET_BUDGETS[evidenceStage]),
    requestedStage,
    evidenceStage,
    constrainedByEvidence: TICKET_BUDGETS[evidenceStage] < TICKET_BUDGETS[requestedStage],
  };
}
