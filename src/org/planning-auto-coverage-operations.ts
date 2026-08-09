import type { FinalPlanProjection, PlanProvenance, PublishedTicket, TicketPlan } from "../loop/plan-tickets.js";
import { recordPlanningDecomposition, type PlanningCoverageRecord } from "./planning-coverage.js";
import { publishPlanningCoverage, publishedFromCoverage } from "./planning-coverage-publication.js";
import {
  coverageResult,
  coverageWriteMode,
  decompositionSyntax,
  planningSourceTicketEvidence,
  type PlanningCoverageResult,
  type PlanningRefusal,
} from "./planning-coverage-request.js";
import type { PlanningDepthInput } from "./planning-depth.js";
import type { PlanningSourceManifest } from "./planning-inputs.js";
import type { PlanningStageResolution } from "./planning-stage.js";
import type { AutoCoverageContext, AutoCoverageOptions } from "./planning-auto-coverage.js";

export interface AutoCoverageResult {
  status: "completed" | "failed";
  summary: string;
  plan?: TicketPlan;
  planProjection?: FinalPlanProjection;
  published?: PublishedTicket[];
  problems?: string[];
  coverage?: PlanningCoverageResult;
  refusal?: PlanningRefusal;
  stageResolution: PlanningStageResolution;
}

export type PlanningCoverageRoadmapPersistence = Parameters<typeof publishPlanningCoverage>[0]["persistRoadmap"];
export type PlanningCoveragePublicationGuard = Parameters<typeof publishPlanningCoverage>[0]["beforePublish"];

export async function recordAutoPlanningDecomposition(input: {
  options: AutoCoverageOptions;
  context: AutoCoverageContext;
  disposition: "accepted" | "refused";
  refusalProblems: readonly string[];
  plan: TicketPlan;
  provenance: PlanProvenance;
  consumedSources: PlanningSourceManifest | undefined;
  now: Date;
}) {
  const { options, context } = input;
  return recordPlanningDecomposition({
    root: options.stateHome,
    app: options.app.name,
    scopeId: context.coverageScopeId,
    requestHash: context.coverageRequestHash,
    planningIntentHash: context.planningIntentHash,
    sourceManifestSha256: context.sourceCoverageHash,
    request: context.decompositionRequest,
    disposition: input.disposition,
    refusalProblems: input.refusalProblems,
    publicationCap: context.publicationLimit.cap,
    plan: input.plan,
    sections: context.sourceSections,
    provenance: input.provenance,
    ...(input.consumedSources === undefined
      ? {}
      : { sourceEvidence: planningSourceTicketEvidence(input.consumedSources) }),
    mode: coverageWriteMode(context.priorCoverage, options.revise === true),
    now: input.now,
  });
}

export function decompositionRequestForBrief(
  request: PlanningDepthInput["expectedTickets"],
  priorTicketCount: number,
): string {
  if (request === undefined) return "planner-selected exact scope";
  if (priorTicketCount === 0 || request.kind === "complete") return request.syntax;
  return `${request.syntax} total across the durable plan; ${priorTicketCount} ticket(s) are already preserved`;
}

export function publishAutoPlanningCoverage(input: {
  options: AutoCoverageOptions;
  coverage: PlanningCoverageRecord;
  resume: boolean;
  clock: () => Date;
  persistRoadmap: PlanningCoverageRoadmapPersistence;
  beforePublish?: PlanningCoveragePublicationGuard;
}) {
  return publishPlanningCoverage({
    stateHome: input.options.stateHome,
    app: input.options.app,
    ...(input.options.gh === undefined ? {} : { gh: input.options.gh }),
    coverage: input.coverage,
    resume: input.resume,
    clock: input.clock,
    persistRoadmap: input.persistRoadmap,
    ...(input.beforePublish === undefined ? {} : { beforePublish: input.beforePublish }),
  });
}

export async function reuseAutoPlanningCoverage(
  options: AutoCoverageOptions,
  coverage: PlanningCoverageRecord,
  stageResolution: PlanningStageResolution,
  clock: () => Date,
  persistRoadmap: PlanningCoverageRoadmapPersistence,
  beforePublish?: PlanningCoveragePublicationGuard,
): Promise<AutoCoverageResult | undefined> {
  if (coverage.disposition === "refused") {
    return coverageRefusalResult(
      coverage,
      stageResolution,
      "plan_decomposition_invalid",
      `The identical refused decomposition remains preserved (${coverage.refusal_problems.join("; ")}).`,
      "Correct the stated problems and rerun with --revise; no provider turn is spent by this repeat.",
    );
  }
  if (options.resume === true && options.publish !== false) {
    const publication = await publishAutoPlanningCoverage({
      options,
      coverage,
      resume: true,
      clock,
      persistRoadmap,
      ...(beforePublish === undefined ? {} : { beforePublish }),
    });
    if (publication.published.length > 0 || publication.coverage.tickets.some((ticket) => ticket.state === "planned")) {
      return autoCoveragePublicationResult(publication, stageResolution);
    }
    coverage = publication.coverage;
  }
  const hasRemaining = coverage.sections.some((section) => section.state === "remaining");
  if (options.resume === true && hasRemaining) return undefined;
  return {
    status: "completed",
    summary:
      `Identical planning request reused preserved decomposition ${coverage.decomposition_id}; ` +
      (hasRemaining ? "use --resume for remaining source coverage." : "coverage is complete."),
    plan: structuredClone(coverage.plan),
    published: publishedFromCoverage(coverage),
    coverage: coverageResult(coverage),
    stageResolution,
  };
}

export function autoCoveragePublicationResult(
  publication: Awaited<ReturnType<typeof publishAutoPlanningCoverage>>,
  stageResolution: PlanningStageResolution,
): AutoCoverageResult {
  return {
    status: "completed",
    summary: publication.summary,
    plan: publication.projection.plan,
    planProjection: publication.projection,
    published: publication.published,
    coverage: coverageResult(publication.coverage),
    stageResolution,
  };
}

export function coverageRefusalResult(
  coverage: PlanningCoverageRecord,
  stageResolution: PlanningStageResolution,
  code: PlanningRefusal["code"],
  summary: string,
  nextAction: string,
): AutoCoverageResult {
  return {
    status: "failed",
    summary,
    plan: structuredClone(coverage.plan),
    problems: [...coverage.refusal_problems],
    coverage: coverageResult(coverage),
    stageResolution,
    refusal: {
      code,
      syntax: decompositionSyntax(),
      publicationCap: coverage.publication_cap,
      preservedDecomposition: coverage.decomposition_id,
      nextAction,
    },
  };
}
