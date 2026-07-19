// Adaptive non-interactive planning on the real runtime. The interactive
// co-planning mode (plan.ts) hands the terminal to
// the native CLI: usage is unobservable, output is prose, and publication in
// the 2026-07-10 episode was an agent-authored shell loop that wiped 19 issue
// bodies. This mode runs the Planner through the pass executor — real gate,
// real approval store, real per-pass ledger settlement — and the ORCHESTRATOR
// publishes the schema-validated plan (src/loop/plan-tickets.ts).

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { defaultGate } from "../runtime/gate.js";
import { getRuntime } from "../runtime/registry.js";
import type { RoleConfig, Runtime, TurnHooks } from "../runtime/types.js";
import { executePipeline } from "../loop/pipeline.js";
import { getPipeline, loadPipelines } from "../loop/pipelines.js";
import { readTurnRecords } from "../runtime/telemetry.js";
import { GhCliOps, type GhOps } from "../loop/github.js";
import {
  finalizePlanForPublication,
  PLAN_SCHEMA,
  publishPlanProjection,
  validatePlan,
  type FinalPlanProjection,
  type PlanProvenance,
  type PlanningSourceTicketEvidence,
  type ProjectStage,
  type PublishedTicket,
  type TicketPlan,
} from "../loop/plan-tickets.js";
import { writePublishedTicketsRecord } from "../loop/plan-publication-record.js";
import { ApprovalStore } from "./approvals.js";
import type { AppEntry } from "./apps.js";
import { rollupBudgets } from "./budget.js";
import type { AppsFile } from "./apps.js";
import { assembleContext } from "./context.js";
import { composeGate } from "./gate-compose.js";
import { loadRoles } from "./roles.js";
import { ensureManagedClone, withAppGitLock } from "./turn-runner.js";
import {
  decidePlanningDepth,
  estimatePlanningCost,
  routePlanningPasses,
  zeroPlanningCostEstimate,
  type PlanningCostEstimate,
  type PlanningDepthDecision,
  type PlanningDepthInput,
  type PlanningPassRoute,
} from "./planning-depth.js";
import {
  consumedPlanningSourceManifest,
  planningSourceBudget,
  planningSourceManifestJson,
  renderPlanningSourceBrief,
  resolvePlanningSources,
  type PlanningSourceManifest,
  type PlanningSourceRequest,
  type ResolvedPlanningSources,
} from "./planning-inputs.js";

export interface AutoPlanOptions {
  orgHome: string;
  stateHome: string;
  app: AppEntry;
  appsFile: AppsFile;
  /** The product goal the plan serves — required; planning without a goal is
   *  how a website becomes 19 tickets. */
  goal: string;
  /** Exact operator-supplied source checkout. It is never checked out/reset;
   * planning runs in a trace-scoped snapshot cloned from its current HEAD. */
  workdir?: string;
  stage?: ProjectStage;
  /** Publish the validated plan to GitHub (default). False = plan + validate
   *  only, print, publish nothing. */
  publish?: boolean;
  gh?: GhOps;
  runtimeFor?: (role: RoleConfig) => Runtime;
  now?: () => Date;
  /** Cooperative cancellation from the owning CLI/process. */
  signal?: AbortSignal;
  parentTaskId?: string;
  /** Explicit/derived routing factors. Omitted fields use stage-aware
   * conservative defaults; minimumDepth can raise but never lower a floor. */
  planning?: Omit<PlanningDepthInput, "goal" | "stage">;
  /** Repeatable, operator-declared product-truth inputs. Relative paths are
   * resolved against the exact source checkout; absolute external files are
   * allowed. Required sources fail closed before Runtime construction. */
  sources?: readonly PlanningSourceRequest[];
}

export interface AutoPlanResult {
  status: "completed" | "failed" | "cancelled" | "timed_out";
  summary: string;
  plan?: TicketPlan;
  problems?: string[];
  published?: PublishedTicket[];
  planningDecision?: PlanningDepthDecision;
  planningCostEstimate?: PlanningCostEstimate;
  planningRoute?: PlanningPassRoute;
  planProjection?: FinalPlanProjection;
  planningSources?: PlanningSourceManifest;
}

export async function runAutoPlan(options: AutoPlanOptions): Promise<AutoPlanResult> {
  const clock = options.now ?? ((): Date => new Date());
  const stage: ProjectStage =
    options.stage ?? (options.app.status === "onboarding" ? "bootstrap" : "mature");
  const planningDecision = decidePlanningDepth({
    goal: options.goal,
    stage,
    ...(options.planning ?? {}),
  });
  const history = (await readTurnRecords(options.stateHome)).filter(
    (row) => row.app === undefined || row.app === options.app.name,
  );
  if (planningDecision.disposition === "direct-execution") {
    if ((options.sources?.length ?? 0) > 0) {
      return {
        status: "failed",
        summary: "planning sources were supplied, but existing-ticket routing selects no planning pass; use bounded-goal/milestone/strategy or remove the sources",
        planningDecision,
        planningRoute: routePlanningPasses(planningDecision, stage, []),
        planningCostEstimate: zeroPlanningCostEstimate(history),
      };
    }
    const planningRoute = routePlanningPasses(planningDecision, stage, []);
    return {
      status: "completed",
      summary: `existing scoped ticket admitted directly to build/review; no planning provider turn ran — continue with operon loop --app ${options.app.name}`,
      planningDecision,
      planningRoute,
      planningCostEstimate: zeroPlanningCostEstimate(history),
    };
  }

  const rolesFile = await loadRoles(join(options.orgHome, "roles.yaml"));
  const planner = rolesFile.roles.find((role) => role.name === "planner");
  if (planner === undefined) return { status: "failed", summary: "roles.yaml has no planner role" };
  const roles = Object.fromEntries(rolesFile.roles.map((role) => [role.name, role]));
  const pipelines = await loadPipelines(join(options.orgHome, "pipelines.yaml"), {
    roleNames: rolesFile.roles.map((role) => role.name),
    promptsDir: join(options.orgHome, "prompts"),
  });
  const route = routePlanningPasses(
    planningDecision,
    stage,
    pipelines.pipelines.map((pipeline) => pipeline.name),
  );
  if (route.disposition === "direct-execution") {
    throw new Error("planning route changed to direct execution after provider setup");
  }
  const pipeline = getPipeline(pipelines, route.pipeline);
  const selectedPasses = pipeline.passes.filter((pass) => route.selectedPasses.includes(pass.id));
  const missingPasses = route.selectedPasses.filter(
    (pass) => !pipeline.passes.some((candidate) => candidate.id === pass),
  );
  if (missingPasses.length > 0) {
    return {
      status: "failed",
      summary: `adaptive planning route needs missing pass(es): ${missingPasses.join(", ")}`,
      planningDecision,
      planningRoute: route,
    };
  }
  const planningCostEstimate = estimatePlanningCost({
    selectedPasses,
    roles,
    history,
  });

  const turnId = `plan-${options.app.name}-${clock().getTime()}`;
  // Plan from an isolated, trace-scoped snapshot. A supplied checkout is an
  // immutable source: clone its current HEAD without checking out/resetting it.
  // The default source remains Operon's explicitly managed clone, which is
  // refreshed to its resolved default branch under the app git lock.
  const snapshot = await withAppGitLock(options.stateHome, options.app.name, async () => {
    const source =
      options.workdir !== undefined
        ? validateSourceCheckout(options.workdir)
        : (await ensureManagedClone(options.app, options.stateHome)).path;
    return createPlanningSnapshot(source, join(options.stateHome, "worktrees", options.app.name, turnId));
  });
  const localRepo = snapshot.path;
  const resolvedSources = resolveAutoPlanSources(options, snapshot, turnId, planningDecision.depth);
  const consumedSources = resolvedSources === undefined
    ? undefined
    : consumedPlanningSourceManifest(resolvedSources.manifest);
  const store = new ApprovalStore(options.stateHome);
  const hooks: TurnHooks = {
    gate: composeGate(defaultGate, store, {
      app: options.app.name,
      role: planner.name,
      turnId,
      now: clock,
    }),
  };
  const context = (
    await assembleContext({
      orgHome: options.orgHome,
      appWorkdir: localRepo,
      app: options.app.name,
      role: planner,
      taskText:
        `${stage} ${planningDecision.depth} plan for ${options.app.name}: ${options.goal}` +
        (resolvedSources === undefined ? "" : `; planning sources ${resolvedSources.manifest.manifest_sha256}`),
    })
  ).bundle;

  const baseBrief = await stageAwareBrief(options, snapshot, clock(), stage, planningDecision, route, planningCostEstimate);
  const sourceBrief = resolvedSources === undefined
    ? ""
    : renderPlanningSourceBrief(resolvedSources.manifest, resolvedSources.documents);
  const brief = sourceBrief === "" ? baseBrief : `${baseBrief}\n\n${sourceBrief}`;
  const priorOutputs = new Map<string, string>();
  const finalPassId = route.selectedPasses[route.selectedPasses.length - 1];
  const planningFactor = {
    kind: "uncertainty" as const,
    evidence: `planning depth ${planningDecision.depth}: ${planningDecision.decisionFactors.join(", ")}`,
    policy_rule: "planning_depth",
  };
  const authorizedPasses = selectedPasses.map((pass) => {
    const role = roles[pass.role];
    if (role === undefined) throw new Error(`adaptive planning pass ${pass.id} references missing role ${pass.role}`);
    return {
      pipeline: pipeline.name,
      pass: pass.id,
      role: role.name,
      runtime: role.runtime,
      model: pass.model ?? role.model,
      effort:
        planningDecision.depth === "quick"
          ? "low" as const
          : planningDecision.depth === "standard" && ["high", "xhigh", "max"].includes(pass.effort ?? role.effort)
            ? "medium" as const
            : pass.effort ?? role.effort,
      factor_rules: [planningFactor.policy_rule],
    };
  });
  const run = await executePipeline({
    pipeline,
    selection: { tier: planningDecision.depth, includePasses: route.selectedPasses },
    roles,
    runtimeFor: options.runtimeFor ?? ((role) => getRuntime(role.runtime)),
    briefFor: (pass) => planningBriefForPass(brief, pass.id, priorOutputs, route),
    promptsDir: join(options.orgHome, "prompts"),
    context,
    workdir: localRepo,
    hooks,
    runlog: { root: options.stateHome, app: options.app.name, traceId: turnId },
    clock,
    verdictSchemaFor: (pass) => (pass.id === finalPassId ? PLAN_SCHEMA : undefined),
    telemetry: { orgDir: options.stateHome, trigger: "manual" },
    episode: {
      id: `trace:${options.app.name}:${turnId}`,
      route: planningDecision.executionRoute,
      policyVersion: planningDecision.policyVersion,
      factors: [...planningDecision.executionFactors, planningFactor],
      authorizedPasses,
      ...(planningDecision.depth === "deep" ? { budgetOverrides: { input_tokens: 8_000_000 } } : {}),
    },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.parentTaskId !== undefined ? { parentTaskId: options.parentTaskId } : {}),
    planningRoute: {
      policy_version: planningDecision.policyVersion,
      depth: planningDecision.depth,
      episode_route: planningDecision.executionRoute,
      disposition: planningDecision.disposition,
      risk_tier: planningDecision.riskTier,
      factors: planningDecision.factors,
      decision_factors: planningDecision.decisionFactors,
      execution_admission_factors: planningDecision.executionFactors,
      execution_decision_factors: planningDecision.executionDecisionFactors,
      selected_passes: route.selectedPasses,
      skipped_passes: route.skippedPasses,
      pass_rationales: route.passRationales.map((rationale) => ({
        pass: rationale.pass,
        expected_risk_reduction: rationale.expectedRiskReduction,
        evidence: rationale.evidence,
      })),
      estimated_cost_usd: planningCostEstimate.estimatedCostUsd,
      estimated_cost_upper_bound_usd: planningCostEstimate.upperBoundUsd,
      estimate_basis: planningCostEstimate.basis,
      outcome_measurement: {
        status: planningCostEstimate.outcomeMeasurement.status,
        selected_pass_count: planningCostEstimate.outcomeMeasurement.selectedPassCount,
        comparable_episodes: planningCostEstimate.outcomeMeasurement.comparableEpisodes,
        lower_pass_episodes: planningCostEstimate.outcomeMeasurement.lowerPassEpisodes,
        comparable_downstream_failure_rate:
          planningCostEstimate.outcomeMeasurement.comparableDownstreamFailureRate,
        lower_pass_downstream_failure_rate:
          planningCostEstimate.outcomeMeasurement.lowerPassDownstreamFailureRate,
        observed_failure_rate_delta: planningCostEstimate.outcomeMeasurement.observedFailureRateDelta,
        basis: planningCostEstimate.outcomeMeasurement.basis,
      },
    },
    ...(resolvedSources !== undefined && consumedSources !== undefined
      ? {
          inputManifest: {
            fileName: "planning-sources.json",
            pendingContents: planningSourceManifestJson(resolvedSources.manifest),
            completedContents: planningSourceManifestJson(consumedSources),
          },
        }
      : {}),
    afterPass: (record) => {
      priorOutputs.set(record.pass.id, record.result.summary);
    },
  });

  const pass = run.passes[run.passes.length - 1];
  if (run.aborted || pass === undefined || pass.result.status !== "completed") {
    return {
      status:
        pass?.result.status === "cancelled" || pass?.result.status === "timed_out"
          ? pass.result.status
          : "failed",
      summary: `planning turn did not complete: ${pass?.result.summary ?? "no pass ran"}`,
      planningDecision,
      planningRoute: route,
      planningCostEstimate,
      ...(resolvedSources !== undefined ? { planningSources: resolvedSources.manifest } : {}),
    };
  }

  const plan = parsePlanJson(pass.result.summary);
  if (plan === undefined) {
    return {
      status: "failed",
      summary: "planner output is not a parseable TicketPlan JSON object",
      planningDecision,
      planningRoute: route,
      planningCostEstimate,
      ...(consumedSources !== undefined ? { planningSources: consumedSources } : {}),
    };
  }
  const validation = validatePlan(plan);
  if (plan.stage !== stage) {
    validation.problems.push(`planner returned stage "${plan.stage}" but the requested stage is "${stage}"`);
    validation.ok = false;
  }
  if (!validation.ok) {
    return {
      status: "failed",
      summary: `plan failed validation (${validation.problems.length} problem(s))`,
      plan,
      problems: validation.problems,
      planningDecision,
      planningRoute: route,
      planningCostEstimate,
      ...(consumedSources !== undefined ? { planningSources: consumedSources } : {}),
    };
  }

  const planProjection = finalizePlanForPublication(plan);

  if (options.publish === false) {
    return {
      status: "completed",
      summary: `${planningDecision.depth} plan validated; publication skipped (--no-publish)`,
      plan: planProjection.plan,
      planProjection,
      planningDecision,
      planningRoute: route,
      planningCostEstimate,
      ...(consumedSources !== undefined ? { planningSources: consumedSources } : {}),
    };
  }
  const gh = options.gh ?? new GhCliOps(options.app.repo);
  // Durable planner->ticket provenance (#128): the episode id is the one this
  // function passed to executePipeline (admission uses a supplied id verbatim),
  // and the run id is the final planning pass whose verdict became the plan.
  const provenance: PlanProvenance = {
    episodeId: `trace:${options.app.name}:${turnId}`,
    runId: pass.runId,
    traceId: turnId,
  };
  const { published } = await publishPlanProjection(
    gh,
    planProjection,
    consumedSources === undefined ? undefined : planningSourceTicketEvidence(consumedSources),
    provenance,
  );
  await writePublishedTicketsRecord(options.stateHome, options.app.name, provenance, published, clock());
  return {
    status: "completed",
    summary:
      `${planningDecision.depth} planning published ${published.length} ticket(s): ` +
      published.map((t) => `#${t.issueNumber}${t.ready ? " (ready)" : ""}`).join(", "),
    plan: planProjection.plan,
    planProjection,
    published,
    planningDecision,
    planningRoute: route,
    planningCostEstimate,
    ...(consumedSources !== undefined ? { planningSources: consumedSources } : {}),
  };
}

function resolveAutoPlanSources(
  options: AutoPlanOptions,
  snapshot: PlanningSnapshot,
  traceId: string,
  depth: PlanningDepthDecision["depth"],
): ResolvedPlanningSources | undefined {
  if ((options.sources?.length ?? 0) === 0) return undefined;
  return resolvePlanningSources({
    app: options.app.name,
    traceId,
    sourceCheckout: snapshot.sourcePath,
    sourceCheckoutHead: snapshot.sourceHead,
    requests: options.sources ?? [],
    budgetBytes: planningSourceBudget(depth),
  });
}

function planningSourceTicketEvidence(manifest: PlanningSourceManifest): PlanningSourceTicketEvidence {
  return {
    manifestSha256: manifest.manifest_sha256,
    sources: manifest.sources
      .filter((source) => source.selection === "selected" && source.consumption === "consumed")
      .map((source) => ({
        canonicalRef: source.canonical_ref,
        sourceSha256: source.source_sha256,
        sourceBytes: source.source_bytes,
        includedBytes: source.included_bytes,
        inclusion: source.inclusion === "truncated" ? "truncated" as const : "full" as const,
        trust: source.trust,
      })),
  };
}

/** P2: the plan sees what IS — goal, repo truth from the fresh clone, and the
 *  org's own cost history for this app. */
async function stageAwareBrief(
  options: AutoPlanOptions,
  snapshot: PlanningSnapshot,
  now: Date,
  stage: ProjectStage,
  decision: PlanningDepthDecision,
  route: PlanningPassRoute,
  estimate: PlanningCostEstimate,
): Promise<string> {
  const localRepo = snapshot.path;
  const entries = readdirSync(localRepo)
    .filter((name) => name !== ".git")
    .sort()
    .slice(0, 40);
  let recentCommits = "(no commits readable)";
  try {
    recentCommits = execFileSync("git", ["log", "--oneline", "-5"], {
      cwd: localRepo,
      encoding: "utf8",
    }).trim();
  } catch {
    // Empty repo — the listing above already says so.
  }
  const budget = (await rollupBudgets(options.stateHome, options.appsFile, now)).find(
    (row) => row.app === options.app.name,
  );
  return [
    `# ${stage} plan request: ${options.app.name}`,
    "",
    "## Product goal",
    options.goal,
    "",
    "## Adaptive planning route (decided before model execution)",
    `Policy: ${decision.policyVersion}`,
    `Selected depth: ${decision.depth}`,
    `Execution route: ${decision.executionRoute}`,
    `Work lifecycle: ${decision.workLifecycle}`,
    `Disposition: ${decision.disposition}`,
    `Risk tier: ${decision.riskTier}`,
    `Ambiguity: ${decision.factors.ambiguity}`,
    `Coupling: ${decision.factors.coupling}`,
    `Reversibility: ${decision.factors.reversibility}`,
    `External consequence: ${decision.factors.externalConsequence}`,
    `Expected tickets: ${decision.factors.expectedTickets}`,
    `Sensitive domains: ${decision.factors.sensitiveDomains.join(", ") || "none"}`,
    `Decision factors: ${decision.decisionFactors.join("; ")}`,
    `Execution route factors: ${decision.executionDecisionFactors.join("; ")}`,
    `Selected passes: ${route.selectedPasses.join(" -> ")}`,
    `Expected risk reduction: ${route.passRationales.map((entry) => `${entry.pass} (${entry.expectedRiskReduction})`).join("; ")}`,
    `Skipped passes: ${route.skippedPasses.map((entry) => `${entry.pass} (${entry.reason})`).join("; ") || "none"}`,
    `Estimated planning cost: ${estimate.estimatedCostUsd === null ? "unavailable" : `$${estimate.estimatedCostUsd.toFixed(4)}`}`,
    `Planning cost upper bound: $${estimate.upperBoundUsd.toFixed(2)} (role caps; not expected cost)`,
    `Estimate basis: ${estimate.basis}`,
    `Downstream outcome comparison: ${estimate.outcomeMeasurement.basis}`,
    "",
    "## Repository snapshot",
    `Source checkout: ${snapshot.sourcePath}`,
    `Source branch: ${snapshot.sourceBranch}`,
    `Source HEAD: ${snapshot.sourceHead}`,
    `Planning worktree: ${snapshot.path}`,
    `Top-level entries: ${entries.length === 0 ? "(empty repo)" : entries.join(", ")}`,
    `Docs present: ${["README.md", "docs"].filter((p) => existsSync(join(localRepo, p))).join(", ") || "none"}`,
    "Recent commits:",
    recentCommits,
    "",
    "## Org history for this app",
    budget !== undefined
      ? `Month-to-date spend $${budget.spentUsd.toFixed(2)} of $${budget.budgetUsd.toFixed(2)} (${budget.status}).`
      : "No spend recorded.",
    "",
    "Plan the smallest shippable milestone per the pass protocol.",
    `The final selected pass must emit exactly one TicketPlan JSON object with stage "${stage}" matching the provided schema; the orchestrator alone publishes it.`,
  ].join("\n");
}

function planningBriefForPass(
  base: string,
  passId: string,
  priorOutputs: ReadonlyMap<string, string>,
  route: PlanningPassRoute,
): string {
  const prior = priorOutputs.size === 0
    ? "None — this is the first selected planning pass."
    : [...priorOutputs.entries()].map(([id, output]) => `### ${id}\n\n${output}`).join("\n\n");
  const combined =
    route.selectedPasses.length === 1
      ? "This quick route intentionally combines product direction, PM judgment, and decomposition in this one pass. Do not wait for an upstream artifact."
      : `This is selected pass ${passId}; consume the prior selected outputs below and do not assume skipped passes ran.`;
  return [base, "", "## Pass-routing instruction", combined, "", "## Prior selected-pass outputs", prior].join("\n");
}

interface PlanningSnapshot {
  path: string;
  sourcePath: string;
  sourceHead: string;
  sourceBranch: string;
}

function validateSourceCheckout(input: string): string {
  const source = resolve(input);
  if (!existsSync(join(source, ".git"))) {
    throw new Error(`plan: --workdir is not a git checkout: ${source}`);
  }
  gitText(source, "rev-parse", "--verify", "HEAD");
  return source;
}

function createPlanningSnapshot(source: string, target: string): PlanningSnapshot {
  if (existsSync(target)) throw new Error(`plan: planning snapshot already exists: ${target}`);
  mkdirSync(dirname(target), { recursive: true });
  const sourceHead = gitText(source, "rev-parse", "HEAD");
  const sourceBranch = gitText(source, "branch", "--show-current") || "(detached)";
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", source, target], {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  gitText(target, "checkout", "--detach", sourceHead);
  return { path: target, sourcePath: source, sourceHead, sourceBranch };
}

function gitText(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Native structured output returns bare JSON; a non-native adapter may wrap
 *  it in prose or a code fence — take the first top-level object. */
export function parsePlanJson(text: string): TicketPlan | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  for (let end = text.length; end > start; end -= 1) {
    const candidate = text.slice(start, end).trim();
    if (!candidate.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(candidate) as TicketPlan;
      if (typeof parsed === "object" && parsed !== null && Array.isArray(parsed.tickets)) {
        return parsed;
      }
      return undefined;
    } catch {
      // Trailing prose after the JSON — shrink the window and retry.
    }
  }
  return undefined;
}
