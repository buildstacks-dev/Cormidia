import type { TicketPlan } from "../loop/plan-tickets.js";

export type PlanningDecompositionRequest =
  | { kind: "complete"; syntax: "complete" }
  | { kind: "range"; syntax: string; min: number; max: number | null };

export class PlanningDecompositionRefusal extends Error {
  readonly code = "plan_decomposition_syntax_invalid" as const;
  readonly publicMessage: string;
  readonly remediation: string;

  constructor(value: string | undefined) {
    const shown = value === undefined ? "(missing)" : JSON.stringify(value);
    const syntax = "Use an exact count (10), an inclusive range (1-10), an open range (7+), or complete.";
    super(
      `plan: --expected-tickets ${shown} is invalid. ${syntax} ` +
        "Publication remains capped per invocation at bootstrap=3, growth=5, mature=7; " +
        "no decomposition was created or discarded. Next action: correct the value and rerun the dry-run.",
    );
    this.name = "PlanningDecompositionRefusal";
    this.publicMessage = `invalid planning decomposition scope ${shown}; no decomposition was preserved`;
    this.remediation = `${syntax} Check the stage publication cap in --dry-run, then rerun planning.`;
  }
}

/** Parse the human-facing decomposition scope without coupling it to publication admission. */
export function parsePlanningDecompositionRequest(value: string | undefined): PlanningDecompositionRequest {
  if (value === undefined) throw new PlanningDecompositionRefusal(value);
  if (value === "complete") return { kind: "complete", syntax: "complete" };
  const exact = /^(\d+)$/.exec(value);
  const range = /^(\d+)-(\d+)$/.exec(value);
  const open = /^(\d+)\+$/.exec(value);
  if (exact !== null) return boundedRange(value, Number(exact[1]), Number(exact[1]));
  if (range !== null) return boundedRange(value, Number(range[1]), Number(range[2]));
  if (open !== null) return boundedRange(value, Number(open[1]), null);
  throw new PlanningDecompositionRefusal(value);
}

/** Validate the operator's count intent after structural TicketPlan validation.
 *
 * Source-section accounting used to live here: every ticket had to map to a
 * `coverage_id` derived from headings Cormidia parsed out of the operator's
 * files. F-PT-039 removed the pre-read that produced those sections, so the
 * count intent is what remains — the planner owns decomposition now, and its
 * RoadmapPlan is where that decomposition is durable. */
export function validatePlanningDecomposition(
  plan: TicketPlan,
  request: PlanningDecompositionRequest | undefined,
): string[] {
  if (request?.kind !== "range") return [];
  const count = plan.tickets.length;
  if (count >= request.min && (request.max === null || count <= request.max)) return [];
  return [
    `decomposition produced ${count} ticket(s), outside requested ${request.syntax}; ` +
      "the structurally valid decomposition is preserved and rerunning requests a replacement",
  ];
}

function boundedRange(syntax: string, min: number, max: number | null): PlanningDecompositionRequest {
  if (
    !Number.isSafeInteger(min) ||
    min < 1 ||
    min > 10_000 ||
    (max !== null && (!Number.isSafeInteger(max) || max < min || max > 10_000))
  ) {
    throw new PlanningDecompositionRefusal(syntax);
  }
  return { kind: "range", syntax, min, max };
}
