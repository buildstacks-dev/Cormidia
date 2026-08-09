import { isTicketBudgetOnlyRefusal, type ProjectStage, type TicketPlan, validatePlan } from "../loop/plan-tickets.js";
import { productDocPlanProblems, type ProductDocPlanningState } from "./product-doc-planning.js";

export function parseAndValidateProductDocTicketPlan(
  output: string,
  stage: ProjectStage,
  productDocs: ProductDocPlanningState,
): { plan?: TicketPlan; problems: string[] } {
  const plan = parsePlanJson(output);
  if (plan === undefined) {
    return { problems: ["planner output is not a parseable TicketPlan JSON object"] };
  }
  const validation = validatePlan(plan);
  validation.problems.push(...productDocPlanProblems(plan, productDocs));
  validation.ok = validation.problems.length === 0;
  if (plan.stage !== stage) {
    validation.problems.push(`planner returned stage "${plan.stage}" but the requested stage is "${stage}"`);
    validation.ok = false;
  }
  return validation.ok ? { plan, problems: [] } : { plan, problems: validation.problems };
}

export function isProductDocTicketBudgetOnlyRefusal(plan: TicketPlan, productDocs: ProductDocPlanningState): boolean {
  return productDocPlanProblems(plan, productDocs).length === 0 && isTicketBudgetOnlyRefusal(plan);
}

/** Native structured output returns bare JSON; a degraded adapter may wrap it
 * in prose or a code fence. Extract the first complete top-level object. */
function parsePlanJson(text: string): TicketPlan | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  for (let end = text.length; end > start; end -= 1) {
    const candidate = text.slice(start, end).trim();
    if (!candidate.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(candidate) as TicketPlan;
      if (typeof parsed === "object" && parsed !== null && Array.isArray(parsed.tickets)) return parsed;
      return undefined;
    } catch {
      // Trailing prose after the JSON; shrink and retry.
    }
  }
  return undefined;
}
