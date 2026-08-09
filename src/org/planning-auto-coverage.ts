import { stableHash } from "../loop/episode-plan.js";
import type { GhOps } from "../loop/github.js";
import type { ProjectStage } from "../loop/plan-tickets.js";
import type { CreatorEpisodeScope } from "../loop/episode-plan.js";
import type { AppEntry } from "./apps.js";
import type { PlanningDepthInput } from "./planning-depth.js";
import {
  invalidatePlanningCoverage,
  planningCoverageScopeId,
  readPlanningCoverage,
  type PlanningCoverageRecord,
} from "./planning-coverage.js";
import {
  decompositionSyntax,
  planningSourceCoverageHash,
  retainedPlanningTicketCount,
  sectionsForPlanningTurn,
} from "./planning-coverage-request.js";
import {
  planningResumeCapacityProblem,
  planningSourceSections,
  type PlanningSourceSection,
} from "./planning-decomposition.js";
import type { PlanningSourceRequest, ResolvedPlanningSources } from "./planning-inputs.js";
import {
  preparedPlanningRecoveryDecision,
  planningRecoveryIntentHash,
  resolvePlanningPublicationLimit,
  type PlanningPublicationLimit,
} from "./planning-publication.js";
import type { PlanningStageResolution } from "./planning-stage.js";
import {
  autoCoveragePublicationResult,
  coverageRefusalResult,
  publishAutoPlanningCoverage,
  reuseAutoPlanningCoverage,
  type AutoCoverageResult,
  type PlanningCoveragePublicationGuard,
  type PlanningCoverageRoadmapPersistence,
} from "./planning-auto-coverage-operations.js";

export interface AutoCoverageOptions {
  stateHome: string;
  app: AppEntry;
  goal: string;
  stage?: ProjectStage;
  planning?: Omit<PlanningDepthInput, "goal" | "stage">;
  sources?: readonly PlanningSourceRequest[];
  creatorScope?: CreatorEpisodeScope;
  resume?: boolean;
  revise?: boolean;
  publish?: boolean;
  gh?: GhOps;
}

export interface AutoCoverageContext {
  publicationLimit: PlanningPublicationLimit;
  sourceSections: PlanningSourceSection[];
  sourceCoverageHash: string | null;
  coverageScopeId: string;
  decompositionRequest: PlanningDepthInput["expectedTickets"];
  planningIntentHash: string;
  coverageRequestHash: string;
  priorCoverage: PlanningCoverageRecord | undefined;
  planningSections: PlanningSourceSection[];
  priorTicketCount: number;
}

/** Recover/refuse an outstanding publication before consulting current source bytes or snapshots. */
export async function recoverPreparedAutoPlanningCoverage(input: {
  options: AutoCoverageOptions;
  stageResolution: PlanningStageResolution;
  stageEvidenceCheckout: string;
  stageEvidenceSource: PlanningStageResolution["evidence"]["checkoutSource"];
  clock: () => Date;
  persistRoadmap: PlanningCoverageRoadmapPersistence;
}): Promise<AutoCoverageResult | undefined> {
  const publicationLimit = resolvePlanningPublicationLimit({
    stageResolution: input.stageResolution,
    checkout: input.stageEvidenceCheckout,
    checkoutSource: input.stageEvidenceSource,
  });
  const coverageScopeId = planningCoverageScopeId({
    app: input.options.app.name,
    goal: input.options.goal,
    sourceRequests: input.options.sources ?? [],
    creatorScope: input.options.creatorScope ?? null,
  });
  const planningIntentHash = planningRecoveryIntentHash({
    goal: input.options.goal,
    requestedStage: input.options.stage ?? null,
    planning: input.options.planning ?? {},
    creatorScope: input.options.creatorScope ?? null,
  });
  const coverage = await readPlanningCoverage(
    input.options.stateHome,
    input.options.app.name,
    coverageScopeId,
    publicationLimit.cap,
    input.clock(),
  );
  const prepared = preparedPlanningRecoveryDecision({
    coverage,
    currentIntentHash: planningIntentHash,
    resume: input.options.resume === true,
    revise: input.options.revise === true,
    publish: input.options.publish !== false,
  });
  if (prepared.action === "none") return undefined;
  if (prepared.action === "refuse") {
    return coverageRefusalResult(
      coverage!,
      input.stageResolution,
      "plan_publication_recovery_required",
      prepared.summary,
      prepared.nextAction,
    );
  }
  const publication = await publishAutoPlanningCoverage({
    options: input.options,
    coverage: coverage!,
    resume: true,
    clock: input.clock,
    persistRoadmap: input.persistRoadmap,
  });
  return autoCoveragePublicationResult(publication, input.stageResolution);
}

export async function prepareAutoPlanningCoverage(input: {
  options: AutoCoverageOptions;
  stage: ProjectStage;
  stageResolution: PlanningStageResolution;
  stageEvidenceCheckout: string;
  stageEvidenceSource: PlanningStageResolution["evidence"]["checkoutSource"];
  resolvedSources: ResolvedPlanningSources | undefined;
  clock: () => Date;
  persistRoadmap: PlanningCoverageRoadmapPersistence;
  beforePublish?: PlanningCoveragePublicationGuard;
}): Promise<{ context: AutoCoverageContext } | { result: AutoCoverageResult }> {
  const { options, stageResolution } = input;
  const publicationLimit = resolvePlanningPublicationLimit({
    stageResolution,
    checkout: input.stageEvidenceCheckout,
    checkoutSource: input.stageEvidenceSource,
  });
  const sourceSections = planningSourceSections(input.resolvedSources);
  const sourceCoverageHash = planningSourceCoverageHash(input.resolvedSources, sourceSections);
  const coverageScopeId = planningCoverageScopeId({
    app: options.app.name,
    goal: options.goal,
    sourceRequests: options.sources ?? [],
    creatorScope: options.creatorScope ?? null,
  });
  const decompositionRequest = options.planning?.expectedTickets;
  const planningIntentHash = planningRecoveryIntentHash({
    goal: options.goal,
    requestedStage: options.stage ?? null,
    planning: options.planning ?? {},
    creatorScope: options.creatorScope ?? null,
  });
  const coverageRequestHash = stableHash({
    planningIntentHash,
    resolvedStage: input.stage,
    sourceManifestSha256: sourceCoverageHash,
  });
  let priorCoverage = await readPlanningCoverage(
    options.stateHome,
    options.app.name,
    coverageScopeId,
    publicationLimit.cap,
    input.clock(),
  );
  const prepared = preparedPlanningRecoveryDecision({
    coverage: priorCoverage,
    currentIntentHash: planningIntentHash,
    resume: options.resume === true,
    revise: options.revise === true,
    publish: options.publish !== false,
  });
  if (prepared.action === "refuse") {
    return {
      result: coverageRefusalResult(
        priorCoverage!,
        stageResolution,
        "plan_publication_recovery_required",
        prepared.summary,
        prepared.nextAction,
      ),
    };
  }
  if (prepared.action === "recover") {
    const publication = await publishAutoPlanningCoverage({
      options,
      coverage: priorCoverage!,
      resume: true,
      clock: input.clock,
      persistRoadmap: input.persistRoadmap,
      ...(input.beforePublish === undefined ? {} : { beforePublish: input.beforePublish }),
    });
    return { result: autoCoveragePublicationResult(publication, stageResolution) };
  }
  if (priorCoverage !== undefined && priorCoverage.source_manifest_sha256 !== sourceCoverageHash) {
    priorCoverage = await invalidatePlanningCoverage({
      root: options.stateHome,
      app: options.app.name,
      scopeId: coverageScopeId,
      sourceManifestSha256: sourceCoverageHash,
      sections: sourceSections,
      now: input.clock(),
    });
    if (options.revise !== true) {
      return {
        result: coverageRefusalResult(
          priorCoverage,
          stageResolution,
          "plan_source_changed",
          "Source content changed; affected prior section versions were superseded and replacements are remaining.",
          "Rerun with --revise to create a new decomposition for affected remaining coverage.",
        ),
      };
    }
  }
  if (priorCoverage === undefined && (options.resume === true || options.revise === true)) {
    const revise = options.revise === true;
    return {
      result: {
        status: "failed",
        summary: revise
          ? "No preserved decomposition exists to revise for this planning scope."
          : "No preserved decomposition exists for this planning scope.",
        stageResolution,
        refusal: {
          code: revise ? "plan_revision_missing" : "plan_resume_missing",
          syntax: decompositionSyntax(),
          publicationCap: publicationLimit.cap,
          preservedDecomposition: null,
          nextAction: revise
            ? "Run once without --revise to create and preserve the initial decomposition."
            : "Run once without --resume to create and preserve the decomposition.",
        },
      },
    };
  }
  if (priorCoverage !== undefined && options.revise !== true) {
    if (priorCoverage.request_hash !== coverageRequestHash) {
      return {
        result: coverageRefusalResult(
          priorCoverage,
          stageResolution,
          "plan_decomposition_invalid",
          "Planning intent differs from the preserved decomposition; implicit replacement is refused.",
          "Rerun with --revise to create an explicit replacement revision.",
        ),
      };
    }
    const reused = await reuseAutoPlanningCoverage(
      options,
      priorCoverage,
      stageResolution,
      input.clock,
      input.persistRoadmap,
      input.beforePublish,
    );
    if (reused !== undefined) return { result: reused };
    priorCoverage = (await readPlanningCoverage(options.stateHome, options.app.name, coverageScopeId)) ?? priorCoverage;
  }
  const planningSections = sectionsForPlanningTurn(sourceSections, priorCoverage, options.revise === true);
  const priorTicketCount = retainedPlanningTicketCount(priorCoverage, options.revise === true);
  const capacity = planningResumeCapacityProblem(decompositionRequest, priorTicketCount, planningSections.length);
  if (capacity !== undefined && priorCoverage !== undefined) {
    return {
      result: coverageRefusalResult(
        priorCoverage,
        stageResolution,
        "plan_decomposition_invalid",
        capacity,
        "Rerun with --revise to replace remaining unpublished coverage within a new explicit decomposition.",
      ),
    };
  }
  return {
    context: {
      publicationLimit,
      sourceSections,
      sourceCoverageHash,
      coverageScopeId,
      decompositionRequest,
      planningIntentHash,
      coverageRequestHash,
      priorCoverage,
      planningSections,
      priorTicketCount,
    },
  };
}
