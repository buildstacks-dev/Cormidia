import { stableHash } from "../loop/episode-plan.js";
import type { TicketPlan } from "../loop/plan-tickets.js";
import type { ResolvedPlanningSources } from "./planning-inputs.js";

export type PlanningDecompositionRequest =
  | { kind: "complete"; syntax: "complete" }
  | { kind: "range"; syntax: string; min: number; max: number | null };

export interface PlanningSourceSection {
  logical_id: string;
  coverage_id: string;
  source_id: string;
  canonical_path: string;
  source_sha256: string;
  section_sha256: string;
  heading: string;
  ordinal: number;
  bytes: number;
}

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

/** Derive stable logical section IDs and content-versioned coverage IDs from bounded source bytes. */
export function planningSourceSections(sources: ResolvedPlanningSources | undefined): PlanningSourceSection[] {
  if (sources === undefined) return [];
  const records = new Map(sources.manifest.sources.map((source) => [source.source_id, source]));
  return sources.documents.flatMap((document) => {
    const source = records.get(document.source_id);
    if (source === undefined) throw new Error(`planning source ${document.source_id} has no manifest record`);
    const headingOccurrences = new Map<string, number>();
    return splitSections(document.content).map((section, ordinal) => {
      const normalizedHeading = section.heading.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
      const occurrence = (headingOccurrences.get(normalizedHeading) ?? 0) + 1;
      headingOccurrences.set(normalizedHeading, occurrence);
      const location = planningSourceLocationIdentity(source);
      const logicalId = `section_${stableHash(`${location}\0${normalizedHeading}\0${occurrence}`).slice(0, 24)}`;
      const sectionHash = stableHash(section.content);
      return {
        logical_id: logicalId,
        coverage_id: `${logicalId}_${sectionHash.slice(0, 16)}`,
        source_id: source.source_id,
        canonical_path: source.canonical_path,
        source_sha256: source.source_sha256,
        section_sha256: sectionHash,
        heading: section.heading,
        ordinal,
        bytes: Buffer.byteLength(section.content),
      };
    });
  });
}

/** Strip per-episode snapshot/head metadata from repository source identity. */
export function planningSourceLocationIdentity(
  source: Pick<ResolvedPlanningSources["manifest"]["sources"][number], "canonical_path" | "canonical_ref">,
): string {
  const repository = /^git:[^:]+:(.*)$/.exec(source.canonical_ref);
  return repository === null ? `external:${source.canonical_path}` : `git:${repository[1]}`;
}

/** Validate count intent and exact source-section accounting after structural TicketPlan validation. */
export function validatePlanningDecomposition(
  plan: TicketPlan,
  request: PlanningDecompositionRequest | undefined,
  sections: readonly PlanningSourceSection[],
  priorTicketCount = 0,
): string[] {
  const problems: string[] = [];
  const cumulativeTicketCount = priorTicketCount + plan.tickets.length;
  if (
    request?.kind === "range" &&
    (cumulativeTicketCount < request.min || (request.max !== null && cumulativeTicketCount > request.max))
  ) {
    problems.push(
      `decomposition cumulative total is ${cumulativeTicketCount} ticket(s) ` +
        `(${priorTicketCount} preserved + ${plan.tickets.length} new), outside requested ${request.syntax}; ` +
        "the structurally valid decomposition is preserved and --revise requests a replacement",
    );
  }
  const known = new Set(sections.map((section) => section.coverage_id));
  const mapped = new Set<string>();
  plan.tickets.forEach((ticket, index) => {
    for (const id of ticket.sourceSections ?? []) {
      if (!known.has(id)) problems.push(`ticket ${index} names unknown source section ${id}`);
      mapped.add(id);
    }
  });
  const deferred = new Set<string>();
  for (const entry of plan.deferredSourceSections ?? []) {
    if (!known.has(entry.sectionId)) problems.push(`deferred coverage names unknown source section ${entry.sectionId}`);
    if (entry.reason.trim() === "") problems.push(`deferred source section ${entry.sectionId} has no reason`);
    if (mapped.has(entry.sectionId)) problems.push(`source section ${entry.sectionId} is both planned and deferred`);
    deferred.add(entry.sectionId);
  }
  if (request?.kind === "complete") {
    const remaining = sections.filter(
      (section) => !mapped.has(section.coverage_id) && !deferred.has(section.coverage_id),
    );
    if (remaining.length > 0) {
      problems.push(
        `complete decomposition left ${remaining.length} source section(s) unaccounted: ` +
          remaining
            .slice(0, 8)
            .map((section) => section.coverage_id)
            .join(", "),
      );
    }
  }
  return problems;
}

/** Refuse a resume before spending a provider turn when no additional ticket
 * can fit beneath the declared whole-decomposition maximum. */
export function planningResumeCapacityProblem(
  request: PlanningDecompositionRequest | undefined,
  priorTicketCount: number,
  remainingSectionCount: number,
): string | undefined {
  if (request?.kind !== "range" || request.max === null) return undefined;
  if (priorTicketCount > request.max) {
    return `preserved decomposition already has ${priorTicketCount} tickets, above requested total maximum ${request.max}`;
  }
  if (remainingSectionCount > 0 && priorTicketCount === request.max) {
    return (
      `preserved decomposition already reaches requested total maximum ${request.max}, ` +
      `but ${remainingSectionCount} source section(s) remain; no provider turn was started`
    );
  }
  return undefined;
}

export function renderPlanningSectionCatalog(sections: readonly PlanningSourceSection[]): string {
  if (sections.length === 0) return "";
  return [
    "## Durable source-section coverage contract",
    "",
    "Map each planned ticket with sourceSections: [coverage_id, ...]. Account explicitly deferred sections in " +
      "TicketPlan.deferredSourceSections. Unmapped sections remain durable `remaining` coverage.",
    "```json",
    JSON.stringify(sections, null, 2),
    "```",
  ].join("\n");
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

function splitSections(content: string): Array<{ heading: string; content: string }> {
  const lines = content.split(/(?<=\n)/);
  const sections: Array<{ heading: string; content: string }> = [];
  let heading = "(document)";
  let body = "";
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line.trimEnd());
    if (match !== null && body !== "") {
      sections.push({ heading, content: body });
      heading = match[2]!;
      body = line;
    } else {
      if (match !== null) heading = match[2]!;
      body += line;
    }
  }
  if (body !== "" || sections.length === 0) sections.push({ heading, content: body });
  return sections;
}
