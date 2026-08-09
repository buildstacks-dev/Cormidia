import { stableHash } from "../loop/episode-plan.js";
import type { PlanningSourceTicketEvidence } from "../loop/plan-tickets.js";
import type { PlanningSourceManifest, ResolvedPlanningSources } from "./planning-inputs.js";
import type { PlanningCoverageRecord } from "./planning-coverage.js";
import { planningCoverageSummary } from "./planning-coverage.js";
import { planningSourceLocationIdentity, type PlanningSourceSection } from "./planning-decomposition.js";

export interface PlanningCoverageResult {
  scopeId: string;
  revision: number;
  decompositionId: string;
  publicationCap: number;
  disposition: "accepted" | "refused";
  states: ReturnType<typeof planningCoverageSummary>;
}

export interface PlanningRefusal {
  code:
    | "plan_decomposition_invalid"
    | "plan_source_changed"
    | "plan_resume_missing"
    | "plan_revision_missing"
    | "plan_publication_recovery_required";
  syntax: string;
  publicationCap: number;
  preservedDecomposition: string | null;
  nextAction: string;
}

export function coverageResult(record: PlanningCoverageRecord): PlanningCoverageResult {
  return {
    scopeId: record.scope_id,
    revision: record.revision,
    decompositionId: record.decomposition_id,
    publicationCap: record.publication_cap,
    disposition: record.disposition,
    states: planningCoverageSummary(record),
  };
}

export function decompositionRefusal(record: PlanningCoverageRecord, cap: number): PlanningRefusal {
  return {
    code: "plan_decomposition_invalid",
    syntax: decompositionSyntax(),
    publicationCap: cap,
    preservedDecomposition: record.decomposition_id,
    nextAction: "Fix the reported decomposition problems and rerun with --revise; preserved output is not published.",
  };
}

export function decompositionSyntax(): string {
  return "--expected-tickets accepts an exact count (10), inclusive range (1-10), open range (7+), or complete";
}

export function sectionsForPlanningTurn(
  sections: readonly PlanningSourceSection[],
  prior: PlanningCoverageRecord | undefined,
  revise: boolean,
): PlanningSourceSection[] {
  if (prior === undefined) return [...sections];
  const state = new Map(prior.sections.map((section) => [section.coverage_id, section.state]));
  return sections.filter((section) => {
    const current = state.get(section.coverage_id);
    return current === undefined || current === "remaining" || (revise && current === "planned");
  });
}

export function retainedPlanningTicketCount(prior: PlanningCoverageRecord | undefined, revise: boolean): number {
  if (prior === undefined) return 0;
  return prior.tickets.filter((ticket) => ticket.state !== "superseded" && (!revise || ticket.state !== "planned"))
    .length;
}

export function planningSourceTicketEvidence(manifest: PlanningSourceManifest): PlanningSourceTicketEvidence {
  return {
    manifestSha256: manifest.manifest_sha256,
    sources: manifest.sources
      .filter((source) => source.selection === "selected" && source.consumption === "consumed")
      .map((source) => ({
        canonicalRef: source.canonical_ref,
        sourceSha256: source.source_sha256,
        sourceBytes: source.source_bytes,
        includedBytes: source.included_bytes,
        inclusion: source.inclusion === "truncated" ? ("truncated" as const) : ("full" as const),
        trust: source.trust,
      })),
  };
}

export function planningSourceCoverageHash(
  resolved: ResolvedPlanningSources | undefined,
  sections: readonly PlanningSourceSection[],
): string | null {
  if (resolved === undefined) return null;
  return stableHash({
    roots: resolved.manifest.roots.map(({ requested_path, requirement, availability, reason }) => ({
      requested_path,
      requirement,
      availability,
      reason,
    })),
    sources: resolved.manifest.sources.map((source) => {
      const { source_sha256, selection, inclusion, included_bytes, reason } = source;
      return {
        location: planningSourceLocationIdentity(source),
        source_sha256,
        selection,
        inclusion,
        included_bytes,
        reason,
      };
    }),
    sections: sections.map(({ logical_id, coverage_id }) => ({ logical_id, coverage_id })),
  });
}

export function coverageWriteMode(
  prior: PlanningCoverageRecord | undefined,
  revise: boolean,
): "initial" | "delta" | "revise" {
  if (prior === undefined) return "initial";
  return revise ? "revise" : "delta";
}
