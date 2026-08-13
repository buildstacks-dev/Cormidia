// `cormidia plan <app>` — token-free manual context/worktree preview plus the
// EpisodePlanner-backed `--auto` mode. The former native interactive child
// process is intentionally unavailable because it bypassed durable plan,
// assignment, gate, envelope, and settlement authority.

import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { toErrorMessage as errorText } from "../runtime/error-message.js";
import {
  parseCreatorEpisodeScope,
  stableHash,
  type CreatorEpisodeScope,
  type JsonValue,
} from "../loop/episode-plan.js";
import type { FinalTicketProjection, PlanTicket } from "../loop/plan-tickets.js";
import type { ProjectStage } from "../loop/plan-tickets.js";
import { assertPlanningEpisodePlanValid, PLANNING_PROVIDER_OPERATION_CATALOG } from "../loop/planning-episode-plan.js";
import { loadApps } from "../org/apps.js";
import { isBudgetBlocking, rollupBudgets } from "../org/budget.js";
import { previewEpisode, type EpisodePlanningPreview } from "../org/episode-planner/orchestrator.js";
import { safetyFactsFromPlanningRequest } from "../org/episode-safety-facts.js";
import { resolveCormidiaHomes } from "../org/home.js";
import { resolveParentTaskId } from "../org/parent-task.js";
import { runAutoPlan } from "../org/plan-auto.js";
import { cleanupPlanningWorktree, preparePlanSession } from "../org/plan.js";
import {
  type ExternalConsequence,
  type PlanningDepth,
  type PlanningLevel,
  type PlanningReversibility,
  type PlanningWorkLifecycle,
} from "../org/planning-depth.js";
import { parsePlanningDecompositionRequest, type PlanningDecompositionRequest } from "../org/planning-decomposition.js";
import type { PlanningSourceRequest } from "../org/planning-inputs.js";
import { resolvePlanningPublicationLimit, type PlanningPublicationLimit } from "../org/planning-publication.js";
import {
  discoverPlanningStageCheckout,
  formatPlanningStage,
  formatPlanningStageEvidence,
  resolvePlanningStage,
  type PlanningStageResolution,
} from "../org/planning-stage.js";
import { loadRoles } from "../org/roles.js";
import { extractHomeFlags } from "./home-flags.js";
import { cmdPlanRatifyTicketBudget } from "./plan-ratify.js";
import { installProcessCancellation } from "./process-signal.js";
import { createCliProgressReporter, extractProgressArgs } from "../runtime/cli-progress.js";
import { definedProps } from "../runtime/optional-properties.js";

interface PlanCommandDependencies {
  runAutoPlan?: typeof runAutoPlan;
  progressHeartbeatMs?: number;
  progressWriter?: (line: string) => void;
}

export async function cmdPlan(args: string[], dependencies: PlanCommandDependencies = {}): Promise<number> {
  const common = extractHomeFlags(args, "plan");
  // `ratify-ticket-budget` is a subcommand rather than a flag for the same
  // reason `bootstrap publish` is: it is a different, human-gated operation
  // with outward-facing effects, not a modifier on a planning run (ENH-011).
  if (common.rest[0] === "ratify-ticket-budget") {
    return cmdPlanRatifyTicketBudget(common.rest.slice(1), await resolveCormidiaHomes(common));
  }
  const progressArgs = extractProgressArgs(common.rest, "plan");
  const parsed = parsePlanArgs(progressArgs.rest);
  const creatorScope =
    parsed.creatorScopePath === undefined ? undefined : await loadCreatorEpisodeScopeFile(parsed.creatorScopePath);
  if (creatorScope !== undefined && creatorScope.planningDisposition !== "execution_ready") {
    throw new Error(
      "plan: --execution-ready requires the creator-scope file to declare " +
        `planningDisposition: execution_ready; received ${creatorScope.planningDisposition}`,
    );
  }
  if (creatorScope !== undefined && parsed.goal !== undefined && parsed.goal !== creatorScope.objective) {
    throw new Error(
      "plan: --goal must exactly match the authoritative --creator-scope objective when both are supplied; " +
        "omit --goal to use the creator-scope objective",
    );
  }
  const automated = parsed.auto || creatorScope !== undefined;
  const goal = creatorScope?.objective ?? parsed.goal;
  const homes = await resolveCormidiaHomes(common);
  const parentTaskId = await resolveParentTaskId(homes.stateHome, parsed.parentTaskId);

  if (parsed.explainRoute) {
    // --explain-route is the token-free route preview (a standalone usage form
    // in the CLI help). Combined with --auto it used to win silently: exit 0,
    // route JSON, and the requested planning run dropped without a word — the
    // live campaign followed exactly that combination and believed planning
    // had happened (review L-008). Contradictory instructions are rejected
    // loudly instead of one being silently discarded.
    if (automated) {
      throw new Error(
        "plan: --explain-route (token-free route preview) cannot be combined with --auto or " +
          "--creator-scope (a planning run) — " +
          "drop --explain-route to plan (the plan output includes its routing decision), " +
          "or drop the planning-run flags to preview the route without planning",
      );
    }
    if (parsed.sources.length > 0) {
      throw new Error(
        "plan: --source/--optional-source cannot be combined with --explain-route because a route preview consumes no source bytes",
      );
    }
    const appsFile = await loadApps(join(homes.orgHome, "apps.yaml"));
    const app = appsFile.apps.find((entry) => entry.name === parsed.app);
    if (app === undefined) throw new Error(`plan: unknown app "${parsed.app}" in apps.yaml`);
    const preview = await previewAutoPlanningRequest({
      orgHome: homes.orgHome,
      stateHome: homes.stateHome,
      appsFile,
      app,
      parsed,
      goal: goal ?? "",
      parentTaskId,
    });
    console.log(
      JSON.stringify(
        {
          schema_version: 1,
          kind: "episode-planning-preview",
          request: "explain-route",
          ...preview,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (automated) {
    if (goal === undefined) {
      throw new Error(
        "plan: --auto requires --goal <text> — planning without a goal is how a website becomes 19 tickets",
      );
    }
    const appsFile = await loadApps(join(homes.orgHome, "apps.yaml"));
    const app = appsFile.apps.find((entry) => entry.name === parsed.app);
    if (app === undefined) throw new Error(`plan: unknown app "${parsed.app}" in apps.yaml`);
    if (parsed.dryRun) {
      const preview = await previewAutoPlanningRequest({
        orgHome: homes.orgHome,
        stateHome: homes.stateHome,
        appsFile,
        app,
        parsed,
        goal,
        ...(creatorScope === undefined ? {} : { creatorScope }),
        parentTaskId,
      });
      assertExplicitCreatorScopeReady(creatorScope, preview, parsed.creatorScopePath);
      if (parsed.json) {
        console.log(
          JSON.stringify(
            {
              schema_version: 1,
              kind: "episode-planning-preview",
              request: creatorScope === undefined ? "auto-dry-run" : "creator-scope-dry-run",
              ...preview,
            },
            null,
            2,
          ),
        );
        return 0;
      }
      console.log(`plan dry-run: ${app.name}`);
      console.log(`goal: ${goal}`);
      console.log(`stage: ${formatPlanningStage(preview.stageResolution)}`);
      console.log(`stage basis: ${formatPlanningStageEvidence(preview.stageResolution)}`);
      console.log(`assignment mode: ${preview.episode.assignmentMode}`);
      console.log(`planning path: ${preview.episode.planningPath}`);
      if (creatorScope !== undefined) {
        console.log(`creator scope: ${resolve(parsed.creatorScopePath!)}`);
        console.log(`creator provenance: ${creatorScope.provenance.source}/${creatorScope.provenance.creatorId}`);
        console.log("dedicated EpisodePlanner turn: skipped (explicit execution-ready creator scope)");
      }
      if (preview.episode.plannerBoot.providerTurnRequired) {
        console.log(
          `planner boot assignment: ${preview.episode.plannerBoot.assignment.harness}/` +
            `${preview.episode.plannerBoot.assignment.model}/${preview.episode.plannerBoot.assignment.effort}`,
        );
      }
      console.log(`approved assignment candidates: ${preview.episode.allowedAssignments.length}`);
      console.log(
        `budget: $${preview.budget.remainingUsd.toFixed(2)} remaining of ` +
          `$${preview.budget.monthlyUsd.toFixed(2)} (${preview.budget.status})`,
      );
      for (const line of formatTicketBudgetPreview(preview.ticketBudget)) console.log(line);
      console.log(
        `required safety facts: ${preview.episode.requiredSafetyFacts.map((fact) => fact.kind).join(", ") || "none"}`,
      );
      console.log(`source checkout: ${preview.sourceCheckout}`);
      if (preview.stageEvidenceCheckout !== preview.sourceCheckout) {
        console.log(`stage evidence checkout: ${preview.stageEvidenceCheckout}`);
      }
      for (const source of parsed.sources) {
        console.log(`planning source (${source.requirement ?? "required"}): ${source.path}`);
      }
      if (parentTaskId !== undefined) console.log(`parent task: ${parentTaskId}`);
      console.log(preview.episode.disclaimer);
      console.log("(dry-run: no runtime, run envelope, telemetry, learning projection, or GitHub write)");
      return 0;
    }
    const reporter = createCliProgressReporter({
      stateHome: homes.stateHome,
      command: "plan",
      scope: app.name,
      mode: progressArgs.mode,
      ...(dependencies.progressHeartbeatMs === undefined ? {} : { heartbeatMs: dependencies.progressHeartbeatMs }),
      ...(dependencies.progressWriter === undefined ? {} : { writeStderr: dependencies.progressWriter }),
    });
    reporter.phase("preflight", "started");
    const cancellation = installProcessCancellation();
    let result: Awaited<ReturnType<typeof runAutoPlan>>;
    try {
      reporter.phase("checkout-and-episode-planning");
      result = await (dependencies.runAutoPlan ?? runAutoPlan)({
        orgHome: homes.orgHome,
        stateHome: homes.stateHome,
        app,
        appsFile,
        goal,
        ...definedProps({ workdir: parsed.workdir }),
        ...definedProps({ stage: parsed.stage }),
        ...(parsed.noPublish ? { publish: false } : {}),
        signal: cancellation.signal,
        observer: reporter.observer,
        ...definedProps({ parentTaskId }),
        planning: planningOptions(parsed),
        resumePublication: parsed.resumePublication,
        ...(parsed.sources.length > 0 ? { sources: parsed.sources } : {}),
        ...(creatorScope === undefined ? {} : { creatorScope, requireExecutionReadyCreatorScope: true }),
      });
      reporter.terminal(planProgressState(result.status), {
        ...(result.episodeId === undefined ? {} : { artifactRef: `episode:${result.episodeId}` }),
        ...(result.status === "completed"
          ? {}
          : { nextAction: "inspect the episode and CLI progress logs, then resume the exact command" }),
      });
    } catch (error) {
      reporter.terminal(cancellation.signal.aborted ? "cancelled" : "failed", {
        nextAction: `inspect ${reporter.relativeLogRef}`,
      });
      throw error;
    } finally {
      cancellation.dispose();
      reporter.dispose();
    }
    if (parsed.json) {
      console.log(JSON.stringify({ schema_version: 1, kind: "plan-result", app: app.name, ...result }, null, 2));
      return cancellation.exitCode ?? (result.status === "completed" ? 0 : 1);
    }
    console.log(`plan (${result.status}): ${result.summary}`);
    if (result.plan !== undefined) {
      console.log(
        `stage: ${
          result.stageResolution === undefined ? result.plan.stage : formatPlanningStage(result.stageResolution)
        }`,
      );
      if (result.stageResolution !== undefined) {
        console.log(`stage basis: ${formatPlanningStageEvidence(result.stageResolution)}`);
      }
      console.log(`why this many tickets: ${result.plan.ticketCountRationale}`);
      console.log(`release disposition: ${result.plan.releaseDisposition}`);
      console.log(`release kind: ${result.plan.releaseKind}`);
      const projected = new Map(result.planProjection?.tickets.map((ticket) => [ticket.index, ticket]));
      result.plan.tickets.forEach((ticket, index) => {
        console.log(formatPlanTicketSummary(index, ticket, projected.get(index)));
      });
    }
    for (const problem of result.problems ?? []) console.log(`problem: ${problem}`);
    if (result.planningSources !== undefined) {
      console.log(`planning-source scope: ${result.planningSources.scope_sha256}`);
      for (const root of result.planningSources.roots) {
        console.log(
          `planning source root (${root.requirement}): ${root.requested_path} ${root.availability}` +
            (root.entry_count === null ? "" : ` (${root.entry_count} file(s))`) +
            (root.reason === null ? "" : ` — ${root.reason}`),
        );
      }
      if (result.planningSources.requires_media_read) {
        console.log("planning source scope contains image/document files; the planner must be able to read them");
      }
    }
    if (result.planningSourceConsumption !== undefined) {
      const consumption = result.planningSourceConsumption;
      console.log(
        `planning sources read: ${consumption.consumed_count}/${consumption.declared_count}` +
          ` (media ${consumption.media_consumed_count}/${consumption.media_declared_count}); ` +
          `evidence ${consumption.evidence}`,
      );
      for (const entry of consumption.entries.filter((candidate) => candidate.consumption !== "consumed")) {
        console.log(`planning source NOT consumed: ${entry.canonical_ref} — ${entry.consumption}`);
      }
    }
    // A failed/incomplete planning turn must not exit 0. The explicit
    // direct-execution disposition is a completed token-free admission
    // decision and intentionally has no plan artifact.
    return cancellation.exitCode ?? (result.status === "completed" ? 0 : 1);
  }

  if (parsed.json || parsed.workLifecycle !== undefined || parsed.sources.length > 0) {
    throw new Error(
      "plan: --json and --work-lifecycle apply only to --auto or --explain-route; planning-source flags apply only to --auto",
    );
  }

  if (!parsed.dryRun) {
    throw new Error(
      "plan: live interactive co-planning is disabled because the native CLI path cannot preserve " +
        "durable EpisodePlan, exact assignment, gate, envelope, and settlement evidence; " +
        "use --auto --goal <text> for plan-aware execution, or add --dry-run for the token-free context/worktree preview",
    );
  }

  const session = await preparePlanSession({
    appName: parsed.app,
    orgHome: homes.orgHome,
    runtimeHome: homes.stateHome,
    ...definedProps({ topic: parsed.topic }),
    ...definedProps({ workdir: parsed.workdir }),
  });

  try {
    printSummary(session);
    return 0;
  } finally {
    await cleanupPlanningWorktree(session.worktree);
  }
}

function planProgressState(
  status: Awaited<ReturnType<typeof runAutoPlan>>["status"],
): "completed" | "failed" | "cancelled" | "interrupted" {
  return status;
}

/** Text rendering of the token-free ticket-budget preview. */
function formatTicketBudgetPreview(preview: TicketBudgetPreview): string[] {
  return [
    `decomposition intent: ${preview.decompositionRequest?.syntax ?? "planner-selected exact scope"}`,
    `publication admission: at most ${preview.publication.cap} ticket(s) this invocation ` +
      `(requested stage ${preview.publication.requestedStage}; evidence stage ${preview.publication.evidenceStage})`,
    preview.detail,
  ];
}

function formatPlanTicketSummary(index: number, ticket: PlanTicket, projection?: FinalTicketProjection): string {
  return (
    `  ${index}: [${ticket.tier}/${ticket.priority}] ${ticket.title}` +
    (projection?.escalationReason !== undefined
      ? ` (requested ${projection.requestedTier}; escalated: ${projection.escalationReason})`
      : "")
  );
}

interface ParsedPlanArgs {
  app: string;
  topic?: string;
  dryRun: boolean;
  workdir?: string;
  auto: boolean;
  goal?: string;
  stage?: "bootstrap" | "growth" | "mature";
  noPublish: boolean;
  parentTaskId?: string;
  depth?: PlanningDepth;
  risk?: PlanningLevel;
  ambiguity?: PlanningLevel;
  coupling?: PlanningLevel;
  reversibility?: PlanningReversibility;
  externalConsequence?: ExternalConsequence;
  expectedTickets?: PlanningDecompositionRequest;
  resumePublication: boolean;
  sensitiveDomains?: string[];
  workLifecycle?: PlanningWorkLifecycle;
  explainRoute: boolean;
  json: boolean;
  sources: PlanningSourceRequest[];
  creatorScopePath?: string;
}

/** Pure parser shared by the executable command and generated-guidance
 * conformance tests. It resolves no homes and constructs no runtime. */
function parsePlanArgs(args: string[]): ParsedPlanArgs {
  const app = args[0];
  if (!app || app.startsWith("--")) {
    throw new Error(
      "plan: usage: cormidia plan <app> --dry-run [--topic <string>] [--workdir <path>] " +
        "| cormidia plan <app> --auto --goal <text> [--stage bootstrap] [--no-publish] " +
        "[--source <file-or-dir>] [--optional-source <file-or-dir>] [--resume-publication] " +
        "| cormidia plan <app> --creator-scope <scope.json|scope.yaml> --execution-ready [--no-publish]",
    );
  }

  let topic: string | undefined;
  let dryRun = false;
  let workdir: string | undefined;
  let auto = false;
  let goal: string | undefined;
  let stage: ParsedPlanArgs["stage"];
  let noPublish = false;
  let parentTaskId: string | undefined;
  let depth: PlanningDepth | undefined;
  let risk: PlanningLevel | undefined;
  let ambiguity: PlanningLevel | undefined;
  let coupling: PlanningLevel | undefined;
  let reversibility: PlanningReversibility | undefined;
  let externalConsequence: ExternalConsequence | undefined;
  let expectedTickets: PlanningDecompositionRequest | undefined;
  let resumePublication = false;
  let sensitiveDomains: string[] | undefined;
  let workLifecycle: PlanningWorkLifecycle | undefined;
  let explainRoute = false;
  let json = false;
  let creatorScopePath: string | undefined;
  let executionReady = false;
  const sources: PlanningSourceRequest[] = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--explain-route") {
      explainRoute = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--auto") {
      auto = true;
    } else if (arg === "--no-publish") {
      noPublish = true;
    } else if (arg === "--resume-publication") {
      resumePublication = true;
    } else if (arg === "--creator-scope") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("plan: --creator-scope requires a .json, .yaml, or .yml file path");
      }
      if (creatorScopePath !== undefined) throw new Error("plan: --creator-scope may be supplied only once");
      creatorScopePath = next;
      i++;
    } else if (arg === "--execution-ready") {
      executionReady = true;
    } else if (arg === "--source" || arg === "--optional-source") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) throw new Error(`plan: ${arg} requires a file or directory path`);
      sources.push({ path: next, requirement: arg === "--source" ? "required" : "optional" });
      i++;
    } else if (arg === "--goal") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) throw new Error("plan: --goal requires a string");
      goal = next;
      i++;
    } else if (arg === "--stage") {
      const next = args[i + 1];
      if (next !== "bootstrap" && next !== "growth" && next !== "mature") {
        throw new Error("plan: --stage must be bootstrap | growth | mature");
      }
      stage = next;
      i++;
    } else if (arg === "--topic") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) throw new Error("plan: --topic requires a string");
      topic = next;
      i++;
    } else if (arg === "--workdir") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) throw new Error("plan: --workdir requires a path");
      workdir = next;
      i++;
    } else if (arg === "--parent-task") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) throw new Error("plan: --parent-task requires an id");
      parentTaskId = next;
      i++;
    } else if (arg === "--depth") {
      depth = enumFlag(args, ++i, "--depth", ["quick", "standard", "deep"]);
    } else if (arg === "--risk") {
      risk = enumFlag(args, ++i, "--risk", ["low", "medium", "high"]);
    } else if (arg === "--ambiguity") {
      ambiguity = enumFlag(args, ++i, "--ambiguity", ["low", "medium", "high"]);
    } else if (arg === "--coupling") {
      coupling = enumFlag(args, ++i, "--coupling", ["low", "medium", "high"]);
    } else if (arg === "--reversibility") {
      reversibility = enumFlag(args, ++i, "--reversibility", ["reversible", "costly-to-reverse", "irreversible"]);
    } else if (arg === "--external-consequence") {
      externalConsequence = enumFlag(args, ++i, "--external-consequence", [
        "none",
        "internal",
        "customer-public-production",
      ]);
    } else if (arg === "--expected-tickets") {
      expectedTickets = parsePlanningDecompositionRequest(args[++i]);
    } else if (arg === "--sensitive-domains") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) throw new Error("plan: --sensitive-domains requires a comma-separated value");
      sensitiveDomains = [
        ...new Set(
          next
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ];
      i++;
    } else if (arg === "--work-lifecycle") {
      workLifecycle = enumFlag(args, ++i, "--work-lifecycle", [
        "existing-ticket",
        "bounded-goal",
        "milestone",
        "strategy",
      ]);
    } else {
      throw new Error(`plan: unknown flag "${arg}"`);
    }
  }

  if (creatorScopePath !== undefined && !executionReady) {
    throw new Error(
      "plan: --creator-scope requires --execution-ready; creator readiness is never inferred from file contents",
    );
  }
  if (executionReady && creatorScopePath === undefined) {
    throw new Error("plan: --execution-ready requires --creator-scope <scope.json|scope.yaml>");
  }
  if (creatorScopePath !== undefined && explainRoute) {
    throw new Error(
      "plan: --creator-scope/--execution-ready cannot be combined with --explain-route; use --dry-run for a token-free creator-scope preview",
    );
  }
  if (creatorScopePath !== undefined && topic !== undefined) {
    throw new Error("plan: --topic applies only to the manual context preview, not --creator-scope");
  }
  if (resumePublication && !auto && creatorScopePath === undefined) {
    throw new Error("plan: --resume-publication applies only to automated planning");
  }

  return {
    app,
    dryRun,
    auto,
    noPublish,
    explainRoute,
    json,
    sources,
    resumePublication,
    ...definedProps({ goal }),
    ...definedProps({ stage }),
    ...definedProps({ topic }),
    ...(workdir ? { workdir } : {}),
    ...definedProps({ parentTaskId }),
    ...definedProps({ depth }),
    ...definedProps({ risk }),
    ...definedProps({ ambiguity }),
    ...definedProps({ coupling }),
    ...definedProps({ reversibility }),
    ...definedProps({ externalConsequence }),
    ...definedProps({ expectedTickets }),
    ...definedProps({ sensitiveDomains }),
    ...definedProps({ workLifecycle }),
    ...definedProps({ creatorScopePath }),
  };
}

function planningOptions(parsed: ParsedPlanArgs) {
  return {
    ...definedProps({ minimumDepth: parsed.depth }),
    ...definedProps({ riskTier: parsed.risk }),
    ...definedProps({ ambiguity: parsed.ambiguity }),
    ...definedProps({ coupling: parsed.coupling }),
    ...definedProps({ reversibility: parsed.reversibility }),
    ...definedProps({ externalConsequence: parsed.externalConsequence }),
    ...definedProps({ expectedTickets: parsed.expectedTickets }),
    ...definedProps({ sensitiveDomains: parsed.sensitiveDomains }),
    ...definedProps({ workLifecycle: parsed.workLifecycle }),
  };
}

/** The stage ticket budget, projected into the token-free preview.
 *
 * Before this, the ceiling was invisible until a provider turn had already
 * been bought and refused: `--dry-run` happily reported the money budget and
 * said nothing about a ticket-count ceiling (ENH-011). Everything here is read
 * from local files and pure constants — no provider is constructed. */
interface TicketBudgetPreview {
  stage: ProjectStage;
  publication: PlanningPublicationLimit;
  decompositionRequest: PlanningDecompositionRequest | null;
  detail: string;
}

interface AutoPlanningPreviewResult {
  app: string;
  goal: string;
  stage: "bootstrap" | "growth" | "mature";
  stageResolution: PlanningStageResolution;
  sourceCheckout: string;
  stageEvidenceCheckout: string;
  planningSources: PlanningSourceRequest[];
  parentTaskId: string | null;
  budget: {
    monthlyUsd: number;
    spentUsd: number;
    remainingUsd: number;
    status: "ok" | "warning";
  };
  ticketBudget: TicketBudgetPreview;
  effects: [];
  episode: EpisodePlanningPreview;
}

/** Pure projection that keeps corpus decomposition separate from publication admission. */
function projectTicketBudget(input: {
  stage: ProjectStage;
  request: PlanningDecompositionRequest | undefined;
  publication: PlanningPublicationLimit;
}): TicketBudgetPreview {
  return {
    stage: input.stage,
    publication: input.publication,
    decompositionRequest: input.request ?? null,
    detail:
      "The planner owns decomposition and its RoadmapPlan is where that decomposition is durable. " +
      "Publication is bounded per invocation; --resume-publication recovers an interrupted publication batch.",
  };
}

/** Token-free preview of deterministic planning inputs and authority. It does
 * not guess the provider-authored workflow or persist an episode. */
async function previewAutoPlanningRequest(input: {
  orgHome: string;
  stateHome: string;
  appsFile: Awaited<ReturnType<typeof loadApps>>;
  app: Awaited<ReturnType<typeof loadApps>>["apps"][number];
  parsed: ParsedPlanArgs;
  goal: string;
  creatorScope?: CreatorEpisodeScope;
  parentTaskId: string | undefined;
}): Promise<AutoPlanningPreviewResult> {
  const goal = input.goal;
  const sourceCheckout = resolve(input.parsed.workdir ?? join(input.stateHome, "repos", input.app.name));
  const stageCheckout = discoverPlanningStageCheckout({
    app: input.app,
    orgHome: input.orgHome,
    stateHome: input.stateHome,
    ...(input.parsed.workdir === undefined ? {} : { explicitWorkdir: input.parsed.workdir }),
  });
  const stageResolution = resolvePlanningStage({
    ...(input.parsed.stage === undefined ? {} : { requestedStage: input.parsed.stage }),
    checkout: stageCheckout.checkout,
    checkoutSource: stageCheckout.source,
  });
  const stage = stageResolution.stage;
  const publication = resolvePlanningPublicationLimit({
    stageResolution,
    checkout: stageCheckout.checkout,
    checkoutSource: stageCheckout.source,
  });
  const roles = (await loadRoles(join(input.orgHome, "roles.yaml"))).roles;
  const planner = roles.find((role) => role.name === "planner");
  if (planner === undefined) throw new Error("plan: roles.yaml has no planner role");
  const budget = (await rollupBudgets(input.stateHome, input.appsFile)).find((row) => row.app === input.app.name);
  if (budget === undefined) throw new Error(`plan: no app budget exists for ${input.app.name}`);
  if (isBudgetBlocking(budget.status)) {
    throw new Error(
      budget.status === "unknown"
        ? `plan: ${input.app.name} budget total is unverifiable; run \`cormidia budget --reconcile\``
        : `plan: ${input.app.name} has exhausted its monthly budget`,
    );
  }
  const remainingBudgetUsd = Math.max(0, budget.budgetUsd - budget.spentUsd);
  const perAttemptCost = Math.min(planner.maxTurnBudgetUsd, remainingBudgetUsd / 3);
  if (!Number.isFinite(perAttemptCost) || perAttemptCost <= 0) {
    throw new Error("plan: EpisodePlanner has no positive admitted budget");
  }
  const plannerReserveUsd = perAttemptCost * 2;
  const explicitExecutionReadyCreatorPath = input.creatorScope?.planningDisposition === "execution_ready";
  const deliveryBudgetUsd = Math.max(
    0,
    remainingBudgetUsd - (explicitExecutionReadyCreatorPath ? 0 : plannerReserveUsd),
  );
  if (deliveryBudgetUsd <= 0) {
    throw new Error(
      explicitExecutionReadyCreatorPath
        ? "plan: app budget cannot cover the creator-scoped planning workflow"
        : "plan: app budget cannot cover EpisodePlanner admission and delivery planning",
    );
  }
  const requestedPlanningFacts = jsonPreviewValue(planningOptions(input.parsed));
  const planningSources = input.parsed.sources.map((source) => ({ ...source }));
  const ticketBudget = projectTicketBudget({
    stage,
    request: input.parsed.expectedTickets,
    publication,
  });
  const requestIdentity = {
    app: input.app.name,
    goal,
    stage,
    stageResolution,
    requestedPlanningFacts,
    planningSources,
    creatorScope: input.creatorScope ?? null,
    sourceCheckout,
    stageEvidenceCheckout: stageCheckout.checkout,
    parentTaskId: input.parentTaskId ?? null,
    budget: {
      monthlyUsd: budget.budgetUsd,
      spentUsd: budget.spentUsd,
      remainingUsd: remainingBudgetUsd,
      status: budget.status === "warning" ? "warning" : "ok",
    },
  };
  const requestHash = stableHash(requestIdentity);
  const episode = previewEpisode({
    app: input.app,
    roles,
    facts: {
      episodeId: `preview:${input.app.name}:${requestHash.slice(0, 24)}`,
      trigger: {
        kind: "manual_product_planning_preview",
        sourceRef: input.parentTaskId ?? `cli:plan:${input.app.name}`,
        payloadHash: requestHash,
      },
      goal,
      lifecycle: input.parsed.workLifecycle ?? "bounded-goal",
      appStage: stage,
      repositoryFacts: {
        sourceCheckout,
        stageEvidenceCheckout: stageCheckout.checkout,
        inspection: "deferred_until_provider_backed_plan",
        planningStageResolution: jsonPreviewValue(stageResolution),
      },
      requestedConstraints: {
        workflowAuthority: "accepted_episode_plan_only",
        previewOnly: true,
        requestedPlanningFacts,
        planningSources: jsonPreviewValue(planningSources),
        planningOperationCatalog: Object.values(PLANNING_PROVIDER_OPERATION_CATALOG)
          .map((entry) => ({ ...entry }))
          .sort((left, right) => left.operation.localeCompare(right.operation)),
      },
      hardBudget: {
        maxProviderTurns: Object.keys(PLANNING_PROVIDER_OPERATION_CATALOG).length,
        maxEquivalentCostUsd: deliveryBudgetUsd,
        maxMechanicalOverheadUsd: 0,
        maxActiveTimeMs: 30 * 60_000,
        maxHumanDecisions: 0,
      },
      requiredSafetyFacts: safetyFactsFromPlanningRequest(planningOptions(input.parsed)),
      responsibilityByRole: Object.fromEntries(
        roles.map((role) => [
          role.name,
          role.name === "planner"
            ? "Select the smallest sufficient governed product-planning workflow"
            : `Configured ${role.name} responsibility; unavailable to product-planning operations`,
        ]),
      ),
      ...(input.creatorScope === undefined ? {} : { creatorScope: input.creatorScope }),
    },
    planner: {
      limits: {
        maxAttempts: 2,
        perAttempt: {
          equivalentCostUsd: perAttemptCost,
          activeTimeMs: 5 * 60_000,
        },
        aggregate: {
          providerTurns: 2,
          equivalentCostUsd: plannerReserveUsd,
          activeTimeMs: 10 * 60_000,
        },
      },
      requiredCapabilities: ["cancellation", "session_resume", "tool_gate"],
    },
  });
  return {
    app: input.app.name,
    goal,
    stage,
    stageResolution,
    sourceCheckout,
    stageEvidenceCheckout: stageCheckout.checkout,
    planningSources,
    parentTaskId: input.parentTaskId ?? null,
    budget: {
      monthlyUsd: budget.budgetUsd,
      spentUsd: budget.spentUsd,
      remainingUsd: remainingBudgetUsd,
      status: budget.status === "warning" ? "warning" : "ok",
    },
    ticketBudget,
    effects: [],
    episode,
  };
}

/** Read a creator scope at the CLI boundary, then hand the decoded value to
 * the one canonical strict parser. JSON and YAML are transport formats only;
 * they do not define competing scope schemas. */
async function loadCreatorEpisodeScopeFile(path: string): Promise<CreatorEpisodeScope> {
  const absolute = resolve(path);
  const extension = extname(absolute).toLowerCase();
  if (extension !== ".json" && extension !== ".yaml" && extension !== ".yml") {
    throw new Error(`plan: --creator-scope must be a .json, .yaml, or .yml file; received ${absolute}`);
  }

  let bytes: string;
  try {
    bytes = await readFile(absolute, "utf8");
  } catch (error) {
    throw new Error(`plan: cannot read --creator-scope file ${absolute}: ${errorText(error)}`, { cause: error });
  }

  let decoded: unknown;
  try {
    decoded = extension === ".json" ? JSON.parse(bytes) : parseYaml(bytes);
  } catch (error) {
    throw new Error(
      `plan: cannot parse --creator-scope file ${absolute} as ${extension === ".json" ? "JSON" : "YAML"}: ${errorText(error)}`,
      { cause: error },
    );
  }

  try {
    return parseCreatorEpisodeScope(decoded);
  } catch (error) {
    throw new Error(
      `plan: --creator-scope file ${absolute} is not a strict CreatorEpisodeScope: ${errorText(error)}. ` +
        "Required fields are planningDisposition, provenance, objective, inScope, outOfScope, " +
        "acceptanceCriteria, expectedArtifacts, declaredConstraints, and safetyFacts; provide exactly one of steps or workflowTemplate for execution-ready scope.",
      { cause: error },
    );
  }
}

function assertExplicitCreatorScopeReady(
  scope: CreatorEpisodeScope | undefined,
  preview: AutoPlanningPreviewResult,
  path: string | undefined,
): void {
  if (scope === undefined) return;
  if (!preview.episode.creatorScope.executionReady) {
    const problems = preview.episode.creatorScope.issues.map((entry) => `${entry.code}: ${entry.message}`).join("; ");
    throw new Error(
      `plan: --execution-ready creator scope ${resolve(path!)} is incomplete or invalid: ${problems}. ` +
        "Correct the declared scope; Cormidia will not infer readiness or silently invoke EpisodePlanner.",
    );
  }
  try {
    assertPlanningEpisodePlanValid({ steps: preview.episode.creatorScope.resolvedSteps! }, preview.stage);
  } catch (error) {
    throw new Error(
      `plan: --execution-ready creator scope ${resolve(path!)} is not a valid product-planning workflow: ` +
        `${errorText(error)}. Correct its governed operation and terminal TicketPlan contract; no provider was constructed.`,
      { cause: error },
    );
  }
}

function jsonPreviewValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function enumFlag<const T extends string>(args: string[], index: number, flag: string, allowed: readonly T[]): T {
  const value = args[index];
  if (value === undefined || !allowed.includes(value as T)) {
    throw new Error(`plan: ${flag} must be ${allowed.join(" | ")}`);
  }
  return value as T;
}

function printSummary(session: Awaited<ReturnType<typeof preparePlanSession>>): void {
  console.log(`plan app: ${session.app.name}`);
  console.log(`repo: ${session.app.repo}`);
  console.log(`branch: ${session.worktree.branch}`);
  console.log(`worktree: ${session.worktree.path}`);
  console.log(`topic: ${session.context.openingTask.replace(/^Co-planning topic: /, "")}`);
  console.log(`context bytes: ${session.context.byteSize}`);
  console.log("(dry-run: no provider constructed; worktree cleaned up)");
}
