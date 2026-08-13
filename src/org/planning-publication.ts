import { TICKET_BUDGETS, type ProjectStage } from "../loop/plan-tickets.js";
import { resolvePlanningStage, type PlanningStageResolution } from "./planning-stage.js";

export interface PlanningPublicationLimit {
  cap: number;
  requestedStage: ProjectStage;
  evidenceStage: ProjectStage;
  constrainedByEvidence: boolean;
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
