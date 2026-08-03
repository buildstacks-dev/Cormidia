// Paired-replay execution (M5; design §9.3-§9.5): recreate a build episode's
// starting conditions from a trusted eval fixture and ask an arm — control
// (the stable system) or treatment (stable plus the candidate under test) —
// to attempt the task again in an isolated worktree.
//
// Replay is where the learning loop finally spends model tokens, so its
// side-effect surface is structurally empty rather than policy-checked: the
// executor never constructs GhOps, never grants network, and its runs land
// under the reserved `learning-replay` runlog namespace, which the capture
// and episode projectors skip — a replay must not become evidence in the
// store it is being judged against.
//
// Offline outcome semantics (spec deltas, recorded in the M5 PR):
//   - `merged` grades MERGE-EQUIVALENCE: final quality gates pass AND the
//     final review pass approves. No PR exists to merge, publishing is
//     forbidden by the capsule's side-effect policy.
//   - `review_cycles` counts review rounds that returned findings (0 = the
//     first review approved), mirroring the loop's bounce semantics with a
//     single typed, forward-only findings revision in V1.
//   - The held-out contract (design §9.3): expected outcomes and graders
//     never enter brief or context bytes — the acting agent sees the
//     original brief and the arm's context, nothing else.

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fingerprint,
  efficiencyEpisodeDir,
  readExecutionSteps,
  readRouteRecord,
  type AuthorizedPass,
  type ExecutionStepRecord,
} from "../../loop/efficiency.js";
import { writeLoopFileOnce } from "../../loop/durable.js";
import {
  deriveEpisodeSafetyRoute,
  estimateEpisodePlanBudget,
  materializeEpisodePlanAssignments,
  readCurrentEpisodePlan,
  stableHash,
  type CreatorEpisodeScope,
  type EpisodeIntent,
  type EpisodePlan,
  type MechanicalGateStep,
  type PlannedOutput,
  type ProposedEpisodeStep,
  type ProposedProviderTurnStep,
  type ProviderTurnStep,
} from "../../loop/episode-plan.js";
import {
  readEpisodePlanExecutionJournal,
  type EpisodePlanExecutionJournal,
  type EpisodePlanExecutionResult,
  type EpisodeStepCompletedOutcome,
  type EpisodeStepExecutionContext,
  type EpisodeStepFailedOutcome,
} from "../../loop/episode-plan-executor.js";
import {
  publishEpisodePlanRevision,
  requestEpisodeReplan,
} from "../../loop/episode-replan.js";
import {
  EPISODE_PLAN_EXECUTION_PIPELINE,
  planRouteLabel,
} from "../../loop/episode-route.js";
import { loadGateCommands, DEFAULT_LOOP_POLICY } from "../../loop/driver.js";
import { criterionTestMapFromContractText, parseAcceptanceCriteria } from "../../loop/loop.js";
import { executePipeline } from "../../loop/pipeline.js";
import { loadPolicy, resolveTier } from "../../loop/policy.js";
import { runGates, type GateRunResult } from "../../loop/qgates.js";
import {
  parseVerdictEither,
  validateVerdict,
  VERDICT_SCHEMAS,
  type ReviewVerdict,
} from "../../loop/verdicts.js";
import {
  fixedAssignmentFromRole,
  turnAssignmentsEqual,
} from "../../runtime/assignment.js";
import {
  isRuntimeCapability,
  type RuntimeCapability,
} from "../../runtime/capabilities.js";
import { defaultGate } from "../../runtime/gate.js";
import { readEnvelope } from "../../runtime/runlog/envelope.js";
import {
  probeRuntimeReadiness,
  type RuntimeReadinessProbe,
} from "../../runtime/readiness.js";
import { mintRunId, runPaths } from "../../runtime/runlog/paths.js";
import type {
  ContextBundle,
  RoleConfig,
  Runtime,
  TurnAssignment,
  TurnHooks,
} from "../../runtime/types.js";
import type { AppEntry } from "../apps.js";
import { assembleContext } from "../context.js";
import { resolveAppAssignments } from "../execution-assignments.js";
import {
  readPersistedEpisodeIntent,
  prepareEpisodePlan,
} from "../episode-planner/coordinator.js";
import {
  executeAcceptedEpisodePlan,
} from "../episode-planner/execution.js";
import {
  buildEpisodeIntent,
  createEpisodePlanningPolicy,
} from "../episode-planner/policy.js";
import { orgLearningRoot, appLearningRoot, renderActivatedConcept } from "./concepts.js";
import { conceptDraftPath, findCandidateArtifact } from "./candidate-store.js";
import type { CandidateArtifact } from "./candidate.js";
import { gradeBuildOutcome, type EvalFixture } from "./eval-fixture.js";
import type { ExperimentRecord } from "./experiment.js";
import { sanitizeIdSegment } from "./events.js";
import type { LearningPolicy } from "./policy.js";
import { renderConcept } from "./resolver.js";
import { parseOkfDocument } from "../memory.js";

// Replay runs land under the reserved REPLAY_RUNLOG_APP namespace declared
// in capture.ts — the projectors skip it so replays never contaminate the
// evidence store; reconcile deliberately still walks it (spend recovery is
// about money, not evidence).
import { REPLAY_RUNLOG_APP } from "./capture.js";
export { REPLAY_RUNLOG_APP };

export type ReplayArm = "control" | "treatment";
export type ReplayMode = "targeted" | "full";

export interface ReplayAttemptRequest {
  fixture: EvalFixture;
  arm: ReplayArm;
  /** 0 for the targeted pre-check, 1..N for full paired trials. */
  pair: number;
  mode: ReplayMode;
  experiment: ExperimentRecord;
}

export interface ReplayAttempt {
  arm: ReplayArm;
  pair: number;
  mode: ReplayMode;
  /** Metric name → value, EvalTrial-shaped. Only what the mode measured:
   *  targeted attempts carry no merged/review_cycles. */
  metrics: Record<string, number>;
  /** The held-in grade: did this attempt do at least as well as the
   *  original episode (full), or build cleanly through gates (targeted)? */
  heldInPass: boolean;
  costUsd: number;
  runIds: string[];
  detail: string;
}

export interface ReplayExecutor {
  attempt(request: ReplayAttemptRequest): Promise<ReplayAttempt>;
}

export interface LoopReplayExecutorOptions {
  orgHome: string;
  stateHome: string;
  /** Local clone containing the fixture's seed commit (fetched by the CLI
   *  before the runner starts). */
  localRepo: string;
  worktreeRoot: string;
  /** The source app supplies only assignment authority. Replay execution and
   * ledger rows always use the reserved learning-replay namespace. */
  app: AppEntry;
  roles: Record<string, RoleConfig>;
  runtimeForAssignment: (assignment: TurnAssignment, role: RoleConfig) => Runtime;
  assignmentReadinessProbe?: RuntimeReadinessProbe;
  policy: LearningPolicy;
  /** Rendered treatment overlay — the candidate's concept exactly as the
   *  resolver would render it active (renderCandidateOverlay). Required
   *  when any treatment attempt runs. */
  treatmentOverlay?: string;
  /** Candidate the experiment tests; stamps per-candidate ledger rows. */
  candidateRef?: string;
  hooks?: TurnHooks;
  clock?: () => Date;
  /** Fault-boundary hook: terminal provider evidence is already durable when
   * this runs. A throw leaves the plan step resumable without a second turn. */
  afterProviderEvidence?: (input: {
    episodeId: string;
    planVersion: number;
    stepId: string;
    runId: string;
    recovered: boolean;
  }) => void | Promise<void>;
}

export const REPLAY_OPERATION_CATALOG = {
  build: "learning-replay/build",
  review: "learning-replay/review",
  fix: "learning-replay/fix",
  qualityGates: "learning-replay/quality-gates",
  reviewDecision: "learning-replay/review-decision",
} as const;

const REPLAY_STEP_IDS = {
  build: "replay-build",
  gates: "replay-gates",
  review: "replay-review",
  fix: "replay-fix",
  regate: "replay-regate",
  rereview: "replay-rereview",
  decision: "replay-review-decision",
} as const;

const REPLAY_FINAL_OUTPUT = "replay-final";
const BASELINE_PROVIDER_CAPABILITIES = [
  "tool_gate",
  "cancellation",
  "session_resume",
] as const satisfies readonly RuntimeCapability[];

/** The real executor: one explicit creator-scoped EpisodePlan per attempt.
 * Provider steps still use the ordinary pass transport (envelopes, briefs,
 * safety gate, ledger settlement), while deterministic gates are first-class
 * DAG steps and findings publish one bounded forward-only revision. */
export function createLoopReplayExecutor(options: LoopReplayExecutorOptions): ReplayExecutor {
  const clock = options.clock ?? ((): Date => new Date());
  const hooks: TurnHooks = options.hooks ?? { gate: defaultGate };

  return {
    async attempt(request: ReplayAttemptRequest): Promise<ReplayAttempt> {
      validateReplayRequest(options, request);
      const fixture = request.fixture;
      const brief = fixture.input.brief!;
      const seedCommit = fixture.seed.commit!;
      const roles = Object.values(options.roles)
        .sort((left, right) => left.name.localeCompare(right.name));
      const builder = requireRole(options.roles, "builder");
      const reviewer = requireRole(options.roles, "reviewer");
      const app = replayApp(options.app, request);
      const episodeId = replayEpisodeIdForAttempt(request);
      const attemptSlug = replayAttemptSlug(request);
      const worktree = join(options.worktreeRoot, attemptSlug);
      const definition = buildReplayDefinition({
        request,
        app,
        roles,
        builder,
        reviewer,
        learningPolicy: options.policy,
      });
      const intent = replayIntent(request, app, roles, definition);
      const independentReview = request.mode === "full"
        ? { subjectRoles: [builder.name], reviewerRoles: [reviewer.name] }
        : undefined;
      const planningPolicy = createEpisodePlanningPolicy(app, {
        intent,
        roles,
        ...(independentReview === undefined ? {} : { independentReview }),
      });

      let plan = await readCurrentEpisodePlan(options.stateHome, episodeId);
      if (plan !== undefined) {
        const persistedIntent = await readPersistedEpisodeIntent(options.stateHome, episodeId);
        if (persistedIntent === undefined || stableHash(persistedIntent) !== stableHash(intent)) {
          throw new Error(
            `learning: durable replay episode ${episodeId} belongs to different immutable inputs`,
          );
        }
        assertReplayPlan(plan, definition);
        if (!existsSync(worktree)) {
          const journal = await readEpisodePlanExecutionJournal(options.stateHome, episodeId);
          const pendingFindingsRevision =
            request.mode === "full" &&
            plan.version === 1 &&
            journal?.status === "failed" &&
            journalFailureCode(journal) === "error_learning_replay_review_findings";
          if (
            !pendingFindingsRevision &&
            (journal?.status === "completed" || journal?.status === "failed")
          ) {
            return deriveReplayAttempt(options.stateHome, request, plan, journal);
          }
          throw new Error(
            `learning: replay episode ${episodeId} has durable active state but its worktree is missing; ` +
              `refusing to recreate over an interrupted attempt`,
          );
        }
      }

      ensureSeedWorktree(
        options.localRepo,
        worktree,
        `replay/${attemptSlug}`,
        seedCommit,
      );
      let terminalAttempt = false;
      try {
        if (plan === undefined) {
          plan = (await prepareEpisodePlan({
            root: options.stateHome,
            app,
            roles,
            intent,
            now: clock,
            ...(independentReview === undefined ? {} : { independentReview }),
            validateAcceptedPlan: (accepted) => assertReplayPlan(accepted, definition),
          })).plan;
        }

        let execution = await executeReplayPlan({
          options,
          request,
          app,
          roles,
          worktree,
          intent,
          plan,
          hooks,
          clock,
        });
        if (
          request.mode === "full" &&
          plan.version === 1 &&
          execution.reasonCode === "error_learning_replay_review_findings"
        ) {
          plan = await publishFindingsRevision({
            root: options.stateHome,
            intent,
            previous: plan,
            definition,
            policy: planningPolicy.validation,
          });
          execution = await executeReplayPlan({
            options,
            request,
            app,
            roles,
            worktree,
            intent,
            plan,
            hooks,
            clock,
          });
        }
        const journal = await readEpisodePlanExecutionJournal(options.stateHome, episodeId);
        if (journal === undefined || (journal.status !== "completed" && journal.status !== "failed")) {
          throw new Error(
            `learning: replay episode ${episodeId} stopped without a terminal execution journal ` +
              `(executor status ${execution.status})`,
          );
        }
        const attempt = await deriveReplayAttempt(options.stateHome, request, plan, journal);
        terminalAttempt = true;
        return attempt;
      } finally {
        if (terminalAttempt) removeSeedWorktree(options.localRepo, worktree);
      }
    },
  };
}

function finish(detail: string, attempt: Omit<ReplayAttempt, "detail">): ReplayAttempt {
  return { ...attempt, detail };
}

interface ReplayPlanDefinition {
  episodeId: string;
  scope: CreatorEpisodeScope;
  v1Steps: ProposedEpisodeStep[];
  v2Steps: ProposedEpisodeStep[] | null;
  assignments: Map<string, TurnAssignment>;
  hardBudget: {
    maxProviderTurns: number;
    maxEquivalentCostUsd: number;
    maxMechanicalOverheadUsd: number;
    maxActiveTimeMs: number;
    maxHumanDecisions: number;
  };
}

interface ReplayProviderEvidence {
  record: ExecutionStepRecord;
  output: string;
  envelopeStatus: Awaited<ReturnType<typeof readEnvelope>>["status"];
  envelopeErrorCode?: string;
  envelopeSummary?: string;
}

interface ReplayVerdictEvidence {
  schemaVersion: 1;
  episodeId: string;
  planVersion: number;
  stepId: string;
  runId: string;
  outputSha256: string;
  verdict: ReviewVerdict;
}

function validateReplayRequest(
  options: LoopReplayExecutorOptions,
  request: ReplayAttemptRequest,
): void {
  const { fixture, arm } = request;
  if (fixture.validated_by === null) {
    throw new Error(
      `learning: fixture ${fixture.fixture_id} is not independently validated — ` +
        `replay spends tokens only on trusted evals (spec §7)`,
    );
  }
  if (fixture.input.brief === null || fixture.input.brief === undefined) {
    throw new Error(
      `learning: fixture ${fixture.fixture_id} carries no verbatim brief — ` +
        `re-assemble its capsule while the run's brief.md survives, then re-draft`,
    );
  }
  if (fixture.seed.commit === null) {
    throw new Error(`learning: fixture ${fixture.fixture_id} has no seed commit`);
  }
  if (arm === "treatment" && options.treatmentOverlay === undefined) {
    throw new Error("learning: treatment attempts need the candidate overlay");
  }
  if (options.app.name !== request.experiment.eligibility.app) {
    throw new Error(
      `learning: replay app ${options.app.name} does not match experiment app ` +
        request.experiment.eligibility.app,
    );
  }
}

export function replayEpisodeIdForAttempt(request: ReplayAttemptRequest): string {
  return `learning-replay:${stableHash({
    experiment: request.experiment.experiment_id,
    fixture: request.fixture.fixture_id,
    seed: request.fixture.seed.commit,
    arm: request.arm,
    pair: request.pair,
    mode: request.mode,
  }).slice(0, 32)}`;
}

function replayAttemptSlug(request: ReplayAttemptRequest): string {
  return [
    sanitizeIdSegment(request.experiment.experiment_id),
    `p${request.pair}`,
    request.arm,
    request.mode,
    stableHash(request.fixture.fixture_id).slice(0, 10),
  ].join("-");
}

function replayApp(app: AppEntry, request: ReplayAttemptRequest): AppEntry {
  return {
    ...structuredClone(app),
    name: REPLAY_RUNLOG_APP,
    repo: request.fixture.seed.repo ?? app.repo,
    status: "paused",
  };
}

function buildReplayDefinition(input: {
  request: ReplayAttemptRequest;
  app: AppEntry;
  roles: readonly RoleConfig[];
  builder: RoleConfig;
  reviewer: RoleConfig;
  learningPolicy: LearningPolicy;
}): ReplayPlanDefinition {
  const resolved = resolveAppAssignments(input.app, input.roles);
  const builderChoice = selectReplayAssignment(resolved, input.builder.name);
  const reviewerChoice = input.request.mode === "full"
    ? selectReplayAssignment(resolved, input.reviewer.name, builderChoice.providerFamily)
    : undefined;
  const experimentCap = input.request.experiment.efficacy_protocol?.budget.max_usd ??
    input.learningPolicy.learning_budget.per_candidate_replay_usd;
  const maxEquivalentCostUsd = Math.min(
    input.learningPolicy.learning_budget.per_candidate_replay_usd,
    experimentCap,
  );
  if (!Number.isFinite(maxEquivalentCostUsd) || maxEquivalentCostUsd <= 0) {
    throw new Error("learning: replay has no positive bounded learning budget");
  }
  const maxProviderTurns = input.request.mode === "full" ? 4 : 1;
  const perTurnShare = maxEquivalentCostUsd / maxProviderTurns;
  const budgetFor = (choice: ReturnType<typeof selectReplayAssignment>): number =>
    Math.min(choice.maxTurnCostUsd, perTurnShare);
  const assignments = new Map<string, TurnAssignment>();
  const provider = (spec: {
    id: string;
    operation: string;
    role: RoleConfig;
    choice: ReturnType<typeof selectReplayAssignment>;
    objective: string;
    dependsOn: string[];
    outputId: string;
    outputKind: string;
  }): ProposedProviderTurnStep => {
    assignments.set(spec.id, { ...spec.choice.assignment });
    return {
      kind: "provider_turn",
      id: spec.id,
      operation: spec.operation,
      role: spec.role.name,
      objective: spec.objective,
      dependsOn: [...spec.dependsOn],
      requiredCapabilities: [],
      inputRefs: spec.dependsOn.length === 0
        ? [{ ref: `fixture:${input.request.fixture.fixture_id}`, required: true }]
        : spec.dependsOn.map((id) => ({ ref: `plan-step:${id}`, required: true })),
      expectedOutputs: [{ id: spec.outputId, kind: spec.outputKind, required: true }],
      maxTurnBudgetUsd: budgetFor(spec.choice),
      selectionReason:
        resolved.mode === "fixed"
          ? `Replay ${spec.operation}; assignment resolves from fixed role configuration`
          : `Replay ${spec.operation}; creator selected an exact app-narrowed approved assignment`,
      ...(resolved.mode === "adaptive" ? { assignment: { ...spec.choice.assignment } } : {}),
    };
  };
  const gate = (spec: {
    id: string;
    gate: string;
    objective: string;
    dependsOn: string[];
    outputId: string;
    outputKind: string;
  }): MechanicalGateStep => ({
    kind: "mechanical_gate",
    id: spec.id,
    gate: spec.gate,
    objective: spec.objective,
    dependsOn: [...spec.dependsOn],
    inputRefs: spec.dependsOn.map((id) => ({ ref: `plan-step:${id}`, required: true })),
    expectedOutputs: [{ id: spec.outputId, kind: spec.outputKind, required: true }],
  });

  const build = provider({
    id: REPLAY_STEP_IDS.build,
    operation: REPLAY_OPERATION_CATALOG.build,
    role: input.builder,
    choice: builderChoice,
    objective: "Implement the independently validated replay fixture brief",
    dependsOn: [],
    outputId: "replay-implementation",
    outputKind: "implementation-attempt",
  });
  const gates = gate({
    id: REPLAY_STEP_IDS.gates,
    gate: REPLAY_OPERATION_CATALOG.qualityGates,
    objective: "Run the fixture repository's deterministic quality gates",
    dependsOn: [REPLAY_STEP_IDS.build],
    outputId: input.request.mode === "targeted" ? REPLAY_FINAL_OUTPUT : "replay-gate-evidence",
    outputKind: input.request.mode === "targeted" ? "targeted-replay-outcome" : "quality-gate-evidence",
  });
  let v1Steps: ProposedEpisodeStep[] = [build, gates];
  let v2Steps: ProposedEpisodeStep[] | null = null;
  if (input.request.mode === "full") {
    const review = provider({
      id: REPLAY_STEP_IDS.review,
      operation: REPLAY_OPERATION_CATALOG.review,
      role: input.reviewer,
      choice: reviewerChoice!,
      objective: "Independently review the replayed implementation diff",
      dependsOn: [REPLAY_STEP_IDS.gates],
      outputId: "replay-review-verdict",
      outputKind: "review-verdict",
    });
    const decision = gate({
      id: REPLAY_STEP_IDS.decision,
      gate: REPLAY_OPERATION_CATALOG.reviewDecision,
      objective: "Accept an approving structured review or emit a typed findings event",
      dependsOn: [REPLAY_STEP_IDS.review],
      outputId: REPLAY_FINAL_OUTPUT,
      outputKind: "full-replay-outcome",
    });
    v1Steps = [build, gates, review, decision];
    const fix = provider({
      id: REPLAY_STEP_IDS.fix,
      operation: REPLAY_OPERATION_CATALOG.fix,
      role: input.builder,
      choice: builderChoice,
      objective: "Address the durable independent-review findings",
      dependsOn: [REPLAY_STEP_IDS.review],
      outputId: "replay-fixed-implementation",
      outputKind: "implementation-attempt",
    });
    const regate = gate({
      id: REPLAY_STEP_IDS.regate,
      gate: REPLAY_OPERATION_CATALOG.qualityGates,
      objective: "Re-run deterministic quality gates after the bounded fix",
      dependsOn: [REPLAY_STEP_IDS.fix],
      outputId: "replay-regate-evidence",
      outputKind: "quality-gate-evidence",
    });
    const rereview = provider({
      id: REPLAY_STEP_IDS.rereview,
      operation: REPLAY_OPERATION_CATALOG.review,
      role: input.reviewer,
      choice: reviewerChoice!,
      objective: "Independently re-review the corrected replay diff",
      dependsOn: [REPLAY_STEP_IDS.regate],
      outputId: "replay-rereview-verdict",
      outputKind: "review-verdict",
    });
    v2Steps = [
      build,
      gates,
      review,
      fix,
      regate,
      rereview,
      { ...decision, dependsOn: [REPLAY_STEP_IDS.rereview] },
    ];
  }

  const finalOutput: PlannedOutput = {
    id: REPLAY_FINAL_OUTPUT,
    kind: input.request.mode === "targeted" ? "targeted-replay-outcome" : "full-replay-outcome",
    required: true,
  };
  const declaredAt = input.request.experiment.efficacy_protocol?.declared_at ??
    input.request.fixture.drafted_at;
  const scope: CreatorEpisodeScope = {
    planningDisposition: "execution_ready",
    provenance: {
      source: "agent",
      creatorId: "learning-experiment-runner",
      createdAt: declaredAt,
      evidenceRefs: [
        `experiment:${input.request.experiment.experiment_id}`,
        `fixture:${input.request.fixture.fixture_id}`,
        `seed:${input.request.fixture.seed.commit}`,
      ],
    },
    workKind: `learning-replay:${input.request.mode}`,
    objective: input.request.mode === "targeted"
      ? "Run one bounded Builder replay and deterministic quality gates"
      : "Run a bounded Builder replay, deterministic gates, and independent review",
    inScope: [
      "the independently validated fixture brief",
      "the fixture seed worktree",
      input.request.mode === "full" ? "one bounded findings correction" : "targeted gate evidence",
    ],
    outOfScope: [
      "network access",
      "publishing or pull requests",
      "deployment",
      "expected outcomes and grader targets in provider-visible context",
    ],
    acceptanceCriteria: input.request.mode === "targeted"
      ? ["the build provider turn completes and deterministic quality gates pass"]
      : ["deterministic quality gates pass and an independent reviewer approves"],
    expectedArtifacts: [finalOutput],
    declaredConstraints: {
      operationCatalog: { ...REPLAY_OPERATION_CATALOG },
      network: "forbidden",
      publishing: "forbidden",
      deployment: "forbidden",
      maximumFindingsRevisionCount: input.request.mode === "full" ? 1 : 0,
    },
    safetyFacts: input.request.mode === "full"
      ? [{ kind: "independent_review", evidenceRefs: ["learning-replay:full-mode"] }]
      : [],
    steps: structuredClone(v1Steps),
  };
  return {
    episodeId: replayEpisodeIdForAttempt(input.request),
    scope,
    v1Steps,
    v2Steps,
    assignments,
    hardBudget: {
      maxProviderTurns,
      maxEquivalentCostUsd,
      maxMechanicalOverheadUsd: 0,
      maxActiveTimeMs: 45 * 60_000,
      maxHumanDecisions: 0,
    },
  };
}

function selectReplayAssignment(
  resolved: ReturnType<typeof resolveAppAssignments>,
  roleName: string,
  independentFromProviderFamily?: string,
) {
  const candidates = resolved.roles.find((entry) => entry.role === roleName)?.assignments ?? [];
  const selected = candidates.find((candidate) =>
    independentFromProviderFamily === undefined ||
    candidate.providerFamily !== independentFromProviderFamily,
  );
  if (selected === undefined) {
    throw new Error(
      `learning: replay role ${roleName} has no exact approved assignment` +
        (independentFromProviderFamily === undefined
          ? ""
          : ` independent from provider family ${independentFromProviderFamily}`),
    );
  }
  return selected;
}

function replayIntent(
  request: ReplayAttemptRequest,
  app: AppEntry,
  roles: readonly RoleConfig[],
  definition: ReplayPlanDefinition,
): EpisodeIntent {
  return buildEpisodeIntent({
    episodeId: definition.episodeId,
    app,
    roles,
    trigger: {
      kind: "learning_replay",
      sourceRef: `experiment:${request.experiment.experiment_id}`,
      payloadHash: stableHash({
        fixture: request.fixture.fixture_id,
        seed: request.fixture.seed.commit,
        arm: request.arm,
        pair: request.pair,
        mode: request.mode,
      }),
    },
    goal: definition.scope.objective,
    lifecycle: "learning-replay",
    appStage: request.experiment.eligibility.stage[0] ?? "unknown",
    repositoryFacts: {
      repo: request.fixture.seed.repo ?? app.repo,
      revision: request.fixture.seed.commit!,
      fixtureId: request.fixture.fixture_id,
    },
    requestedConstraints: structuredClone(definition.scope.declaredConstraints),
    hardBudget: definition.hardBudget,
    requiredSafetyFacts: structuredClone(definition.scope.safetyFacts),
    creatorScope: structuredClone(definition.scope),
  });
}

function assertReplayPlan(plan: EpisodePlan, definition: ReplayPlanDefinition): void {
  const expected = plan.version === 1
    ? definition.v1Steps
    : plan.version === 2 && definition.v2Steps !== null
      ? definition.v2Steps
      : undefined;
  if (
    expected === undefined ||
    plan.episodeId !== definition.episodeId ||
    plan.planningSource !== "creator_scope" ||
    plan.steps.length !== expected.length
  ) {
    throw new Error(`learning: replay EpisodePlan v${plan.version} is outside the code-owned workflow`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    const proposed = expected[index]!;
    const accepted = plan.steps[index]!;
    const baseMatches =
      accepted.id === proposed.id &&
      accepted.kind === proposed.kind &&
      accepted.objective === proposed.objective &&
      stableHash(accepted.dependsOn) === stableHash(proposed.dependsOn) &&
      stableHash(accepted.inputRefs) === stableHash(proposed.inputRefs) &&
      stableHash(accepted.expectedOutputs) === stableHash(proposed.expectedOutputs);
    if (!baseMatches) {
      throw new Error(`learning: replay plan step ${accepted.id} differs from its code-owned contract`);
    }
    if (accepted.kind === "provider_turn" && proposed.kind === "provider_turn") {
      const assignment = definition.assignments.get(accepted.id);
      if (
        accepted.operation !== proposed.operation ||
        accepted.role !== proposed.role ||
        stableHash(accepted.requiredCapabilities) !== stableHash(proposed.requiredCapabilities) ||
        accepted.maxTurnBudgetUsd !== proposed.maxTurnBudgetUsd ||
        accepted.selectionReason !== proposed.selectionReason ||
        accepted.assignmentSource !== (proposed.assignment === undefined ? "configured" : "creator") ||
        assignment === undefined ||
        !turnAssignmentsEqual(accepted.assignment, assignment)
      ) {
        throw new Error(`learning: replay provider step ${accepted.id} is not exactly authorized`);
      }
    } else if (accepted.kind === "mechanical_gate" && proposed.kind === "mechanical_gate") {
      if (accepted.gate !== proposed.gate) {
        throw new Error(`learning: replay mechanical step ${accepted.id} is not exactly authorized`);
      }
    }
  }
}

async function publishFindingsRevision(input: {
  root: string;
  intent: EpisodeIntent;
  previous: EpisodePlan;
  definition: ReplayPlanDefinition;
  policy: ReturnType<typeof createEpisodePlanningPolicy>["validation"];
}): Promise<EpisodePlan> {
  if (input.definition.v2Steps === null) {
    throw new Error("learning: targeted replay cannot publish a findings revision");
  }
  // Bind the trigger and revision timestamp to immutable v1 evidence. A
  // crash after the pending request but before publication must replay the
  // byte-identical request even when wall time has advanced.
  const detectedAt = new Date(Date.parse(input.previous.createdAt) + 1).toISOString();
  const requestId = `replay-findings-${stableHash(input.intent.episodeId).slice(0, 20)}`;
  await requestEpisodeReplan({
    root: input.root,
    episodeId: input.intent.episodeId,
    maxRevisions: 1,
    trigger: {
      id: requestId,
      kind: "failed_gate",
      planVersion: input.previous.version,
      detectedAt,
      summary: "Independent replay review returned actionable findings",
      evidenceRefs: [`plan-step:${REPLAY_STEP_IDS.review}`],
      affectedStepIds: [REPLAY_STEP_IDS.decision],
    },
    now: new Date(detectedAt),
  });
  const materialized = materializeEpisodePlanAssignments({
    ...structuredClone(input.previous),
    version: 2,
    summary: "Address review findings, re-run gates, and independently re-review",
    steps: structuredClone(input.definition.v2Steps),
    // Assignment materialization does not consume this field; exact
    // arithmetic is recomputed immediately from the materialized steps.
    estimatedBudget: {
      providerTurns: 0,
      providerTurnBudgetUsd: 0,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 0,
    },
    createdAt: detectedAt,
  }, input.policy);
  const plan: EpisodePlan = {
    ...materialized,
    estimatedBudget: estimateEpisodePlanBudget(materialized.steps, 0),
    derivedSafetyRoute: deriveEpisodeSafetyRoute(
      materialized.steps,
      input.intent.requiredSafetyFacts,
    ),
  };
  assertReplayPlan(plan, input.definition);
  await publishEpisodePlanRevision({
    root: input.root,
    requestId,
    intent: input.intent,
    plan,
    policy: input.policy,
    now: new Date(detectedAt),
  });
  return plan;
}

async function executeReplayPlan(input: {
  options: LoopReplayExecutorOptions;
  request: ReplayAttemptRequest;
  app: AppEntry;
  roles: readonly RoleConfig[];
  worktree: string;
  intent: EpisodeIntent;
  plan: EpisodePlan;
  hooks: TurnHooks;
  clock: () => Date;
}): Promise<EpisodePlanExecutionResult> {
  return executeAcceptedEpisodePlan({
    root: input.options.stateHome,
    intent: input.intent,
    plan: input.plan,
    roles: input.roles,
    workdir: input.worktree,
    hooks: input.hooks,
    runtimeForAssignment: input.options.runtimeForAssignment,
    assignmentReadinessProbe: input.options.assignmentReadinessProbe ?? probeRuntimeReadiness,
    contextForProviderStep: () => ({ taste: [], memoryExcerpts: [] }),
    provider: (step, execution) => executeReplayProviderStep(input, step, execution),
    mechanical: (step, execution) => executeReplayMechanicalStep(input, step, execution),
    approval: async () => ({
      status: "failed",
      reasonCode: "error_learning_replay_approval_forbidden",
      summary: "learning replay plans cannot contain approval steps",
    }),
    // Replay findings already own the typed request plus deterministic v2
    // publication transaction below; the common executor must not create a
    // competing pending request or choose a different revision allowance.
    replanAuthority: "caller",
    now: input.clock,
  });
}

async function executeReplayProviderStep(
  input: Parameters<typeof executeReplayPlan>[0],
  step: ProviderTurnStep,
  execution: EpisodeStepExecutionContext,
): Promise<EpisodeStepCompletedOutcome | EpisodeStepFailedOutcome> {
  assertReplayProviderOperation(step);
  const prior = await replayProviderEvidence(
    input.options.stateHome,
    input.app.name,
    input.plan,
    step,
  );
  if (prior !== undefined) {
    await input.options.afterProviderEvidence?.({
      episodeId: input.plan.episodeId,
      planVersion: input.plan.version,
      stepId: step.id,
      runId: prior.record.run_id,
      recovered: true,
    });
    return replayEvidenceOutcome(prior);
  }

  const role = input.roles.find((candidate) => candidate.name === step.role);
  if (role === undefined) throw new Error(`learning: replay step ${step.id} has unknown role ${step.role}`);
  const authorization = await replayAuthorization(input.options.stateHome, step, execution);
  const task = await replayTaskForStep(input, step);
  const context = await armContext(input.options, input.worktree, input.request, role, step.id);
  const withReviewVerdict = step.operation === REPLAY_OPERATION_CATALOG.review;
  let transportError: unknown;
  try {
    await executePipeline({
      pipeline: {
        name: EPISODE_PLAN_EXECUTION_PIPELINE,
        mechanical: false,
        passes: [{ id: step.id, role: step.role, template: "" }],
      },
      selection: { tier: planRouteLabel(input.plan) },
      roles: { [role.name]: role },
      runtimeFor: (selected) =>
        input.options.runtimeForAssignment(fixedAssignmentFromRole(selected), role),
      runtimeForAssignment: input.options.runtimeForAssignment,
      briefFor: () => task,
      promptsDir: input.options.orgHome,
      context,
      // Fixture inputs are independently validated and remain byte-exact;
      // authority is transported through native context and the envelope.
      authorityBrief: "context-only",
      workdir: input.worktree,
      hooks: input.hooks,
      runlog: {
        root: input.options.stateHome,
        app: input.app.name,
        ticket: input.request.fixture.input.ticket_ref,
        traceId: execution.executionId,
      },
      runIdForPass: () => replayProviderRunId(input.plan, step, execution),
      episode: {
        id: input.plan.episodeId,
        route: planRouteLabel(input.plan),
        authorizedPasses: [authorization],
        finalize: false,
        nextTurnEstimate: { costUsd: step.maxTurnBudgetUsd },
        budgetOverrides: {
          provider_turns: input.intent.hardBudget.maxProviderTurns,
          equivalent_cost_usd: input.intent.hardBudget.maxEquivalentCostUsd,
          active_time_ms: input.intent.hardBudget.maxActiveTimeMs!,
          human_decisions: input.intent.hardBudget.maxHumanDecisions!,
        },
      },
      requiredCapabilities: providerRuntimeCapabilities(step),
      ...(withReviewVerdict
        ? {
            verdictSchemaFor: () => VERDICT_SCHEMAS.review,
            recordVerdict: async (ctx: Parameters<NonNullable<
              Parameters<typeof executePipeline>[0]["recordVerdict"]
            >>[0]) => {
              const parsed = parseVerdictEither("review", ctx.result.summary);
              if (!parsed.ok) {
                return {
                  ok: false as const,
                  errorCode: "error_verdict_unparseable",
                  error: new Error(`review verdict unparseable: ${parsed.reason}`),
                };
              }
              await persistReplayVerdict({
                root: input.options.stateHome,
                episodeId: input.plan.episodeId,
                planVersion: input.plan.version,
                stepId: step.id,
                runId: ctx.runId,
                output: ctx.result.summary,
                verdict: parsed.verdict,
              });
              await ctx.events.append({
                type: "verdict.recorded",
                detail: { kind: "review", verdict: parsed.verdict.verdict },
              });
              return { ok: true as const };
            },
          }
        : {}),
      clock: input.clock,
      telemetry: {
        orgDir: input.options.stateHome,
        trigger: "manual",
        experimentRef: input.request.experiment.experiment_id,
        ...(input.options.candidateRef === undefined
          ? {}
          : { candidateRef: input.options.candidateRef }),
      },
    });
  } catch (error) {
    transportError = error;
  }
  const evidence = await replayProviderEvidence(
    input.options.stateHome,
    input.app.name,
    input.plan,
    step,
  );
  if (evidence === undefined) {
    throw new Error(
      `learning: replay provider step ${step.id} ended without terminal evidence` +
        (transportError instanceof Error ? `: ${transportError.message}` : ""),
    );
  }
  await input.options.afterProviderEvidence?.({
    episodeId: input.plan.episodeId,
    planVersion: input.plan.version,
    stepId: step.id,
    runId: evidence.record.run_id,
    recovered: false,
  });
  if (
    transportError !== undefined &&
    evidence.record.status === "completed" &&
    evidence.envelopeStatus === "completed"
  ) {
    throw transportError;
  }
  return replayEvidenceOutcome(evidence);
}

async function executeReplayMechanicalStep(
  input: Parameters<typeof executeReplayPlan>[0],
  step: MechanicalGateStep,
  _execution: EpisodeStepExecutionContext,
): Promise<EpisodeStepCompletedOutcome | EpisodeStepFailedOutcome> {
  if (step.gate === REPLAY_OPERATION_CATALOG.qualityGates) {
    const result = await runReplayGates(
      input.worktree,
      input.request.fixture.seed.commit!,
      input.request.fixture.input.brief!,
    );
    return result.status === "pass"
      ? { status: "completed", artifact: replayGateArtifact(result) }
      : {
          status: "failed",
          reasonCode: `error_learning_replay_quality_gates_${result.status}`,
          summary: `replay quality gates ${result.status}`,
          artifact: replayGateArtifact(result),
        };
  }
  if (step.gate === REPLAY_OPERATION_CATALOG.reviewDecision) {
    const reviewStepId = input.plan.version === 1
      ? REPLAY_STEP_IDS.review
      : REPLAY_STEP_IDS.rereview;
    const reviewStep = input.plan.steps.find((candidate): candidate is ProviderTurnStep =>
      candidate.kind === "provider_turn" && candidate.id === reviewStepId);
    if (reviewStep === undefined) {
      throw new Error(`learning: replay decision has no ${reviewStepId} provider step`);
    }
    const evidence = await replayProviderEvidence(
      input.options.stateHome,
      input.app.name,
      input.plan,
      reviewStep,
    );
    if (evidence === undefined || evidence.record.status !== "completed") {
      return {
        status: "failed",
        reasonCode: "error_learning_replay_review_evidence_missing",
        summary: `replay decision lacks completed evidence for ${reviewStepId}`,
      };
    }
    const verdict = await replayVerdictForEvidence(
      input.options.stateHome,
      input.plan.episodeId,
      evidence,
    );
    if (verdict === undefined) {
      return {
        status: "failed",
        reasonCode: "error_learning_replay_review_evidence_missing",
        summary: `review step ${reviewStepId} has no durable parsed verdict evidence`,
      };
    }
    return verdict.verdict === "approve"
      ? {
          status: "completed",
          artifact: { reviewStepId, verdict: "approve", runId: evidence.record.run_id },
        }
      : {
          status: "failed",
          reasonCode: "error_learning_replay_review_findings",
          summary: `independent review returned ${verdict.findings.length} finding(s)`,
          artifact: {
            reviewStepId,
            verdict: "findings",
            findingsSha256: fingerprint(verdict.findings),
            runId: evidence.record.run_id,
          },
        };
  }
  return {
    status: "failed",
    reasonCode: "error_learning_replay_operation_unknown",
    summary: `unknown replay mechanical operation ${step.gate}`,
  };
}

async function replayTaskForStep(
  input: Parameters<typeof executeReplayPlan>[0],
  step: ProviderTurnStep,
): Promise<string> {
  const brief = input.request.fixture.input.brief!;
  if (step.operation === REPLAY_OPERATION_CATALOG.build) return brief;
  if (step.operation === REPLAY_OPERATION_CATALOG.review) {
    return reviewBrief(brief, input.worktree, input.request.fixture.seed.commit!);
  }
  if (step.operation === REPLAY_OPERATION_CATALOG.fix) {
    const review = input.plan.steps.find((candidate): candidate is ProviderTurnStep =>
      candidate.kind === "provider_turn" && candidate.id === REPLAY_STEP_IDS.review);
    if (review === undefined) throw new Error("learning: replay fix lacks the initial review step");
    const evidence = await replayProviderEvidence(
      input.options.stateHome,
      input.app.name,
      input.plan,
      review,
      true,
    );
    if (evidence === undefined) throw new Error("learning: replay fix lacks durable review evidence");
    const verdict = await replayVerdictForEvidence(
      input.options.stateHome,
      input.plan.episodeId,
      evidence,
    );
    if (verdict?.verdict !== "findings") {
      throw new Error("learning: replay fix requires one durable findings verdict");
    }
    return fixBrief(brief, verdict.findings);
  }
  throw new Error(`learning: unknown replay provider operation ${step.operation}`);
}

function assertReplayProviderOperation(step: ProviderTurnStep): void {
  const expected = step.id === REPLAY_STEP_IDS.build
    ? REPLAY_OPERATION_CATALOG.build
    : step.id === REPLAY_STEP_IDS.fix
      ? REPLAY_OPERATION_CATALOG.fix
      : step.id === REPLAY_STEP_IDS.review || step.id === REPLAY_STEP_IDS.rereview
        ? REPLAY_OPERATION_CATALOG.review
        : undefined;
  if (expected === undefined || step.operation !== expected) {
    throw new Error(`learning: replay provider operation ${step.operation}/${step.id} is not catalogued`);
  }
}

async function replayProviderEvidence(
  root: string,
  app: string,
  plan: EpisodePlan,
  step: ProviderTurnStep,
  includePriorVersions = false,
): Promise<ReplayProviderEvidence | undefined> {
  const matches = (await readExecutionSteps(root, plan.episodeId)).filter((record) =>
    record.kind === "provider" &&
    (record.plan_version === plan.version ||
      (includePriorVersions && record.plan_version !== undefined && record.plan_version < plan.version)) &&
    record.plan_step_id === step.id,
  );
  if (matches.length > 1) {
    throw new Error(`learning: replay step ${step.id} has ${matches.length} terminal provider records`);
  }
  const record = matches[0];
  if (record === undefined) return undefined;
  assertReplayEvidenceMatches(record.plan_version ?? plan.version, step, record);
  const output = await readFile(runPaths(root, app, record.run_id).output, "utf8");
  const envelope = await readEnvelope(root, app, record.run_id);
  if (envelope.status === "running") {
    throw new Error(`learning: replay step ${step.id} has a non-terminal run envelope`);
  }
  return {
    record,
    output,
    envelopeStatus: envelope.status,
    ...(envelope.error_code === undefined ? {} : { envelopeErrorCode: envelope.error_code }),
    ...(envelope.terminal_reason === undefined && envelope.verdict_summary === undefined
      ? {}
      : { envelopeSummary: envelope.terminal_reason ?? envelope.verdict_summary }),
  };
}

function replayVerdictPath(
  root: string,
  episodeId: string,
  planVersion: number,
  stepId: string,
): string {
  return join(
    efficiencyEpisodeDir(root, episodeId),
    `replay-verdict-v${planVersion}-${stepId}.json`,
  );
}

async function persistReplayVerdict(input: {
  root: string;
  episodeId: string;
  planVersion: number;
  stepId: string;
  runId: string;
  output: string;
  verdict: ReviewVerdict;
}): Promise<void> {
  const evidence: ReplayVerdictEvidence = {
    schemaVersion: 1,
    episodeId: input.episodeId,
    planVersion: input.planVersion,
    stepId: input.stepId,
    runId: input.runId,
    outputSha256: fingerprint(input.output),
    verdict: structuredClone(input.verdict),
  };
  const path = replayVerdictPath(
    input.root,
    input.episodeId,
    input.planVersion,
    input.stepId,
  );
  const won = await writeLoopFileOnce(path, `${JSON.stringify(evidence, null, 2)}\n`);
  if (won) return;
  const prior = await readReplayVerdictFile(path);
  if (stableHash(prior) !== stableHash(evidence)) {
    throw new Error(
      `learning: replay verdict evidence for ${input.stepId} already contains different bytes`,
    );
  }
}

async function replayVerdictForEvidence(
  root: string,
  episodeId: string,
  provider: ReplayProviderEvidence,
): Promise<ReviewVerdict | undefined> {
  const planVersion = provider.record.plan_version;
  const stepId = provider.record.plan_step_id;
  if (planVersion === undefined || stepId === undefined) return undefined;
  const path = replayVerdictPath(root, episodeId, planVersion, stepId);
  if (!existsSync(path)) return undefined;
  const evidence = await readReplayVerdictFile(path);
  if (
    evidence.episodeId !== episodeId ||
    evidence.planVersion !== planVersion ||
    evidence.stepId !== stepId ||
    evidence.runId !== provider.record.run_id ||
    evidence.outputSha256 !== fingerprint(provider.output)
  ) {
    throw new Error(
      `learning: replay verdict evidence for ${stepId} does not match its provider output`,
    );
  }
  return structuredClone(evidence.verdict);
}

async function readReplayVerdictFile(path: string): Promise<ReplayVerdictEvidence> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `learning: replay verdict evidence ${path} is not valid JSON`,
      { cause: error },
    );
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`learning: replay verdict evidence ${path} is not a strict object`);
  }
  const spec = raw as Record<string, unknown>;
  const keys = Object.keys(spec).sort();
  const expectedKeys = [
    "episodeId",
    "outputSha256",
    "planVersion",
    "runId",
    "schemaVersion",
    "stepId",
    "verdict",
  ];
  const parsed = validateVerdict("review", spec["verdict"]);
  if (
    stableHash(keys) !== stableHash(expectedKeys) ||
    spec["schemaVersion"] !== 1 ||
    typeof spec["episodeId"] !== "string" ||
    !Number.isSafeInteger(spec["planVersion"]) ||
    typeof spec["stepId"] !== "string" ||
    typeof spec["runId"] !== "string" ||
    typeof spec["outputSha256"] !== "string" ||
    !parsed.ok
  ) {
    throw new Error(`learning: replay verdict evidence ${path} is invalid`);
  }
  return {
    schemaVersion: 1,
    episodeId: spec["episodeId"],
    planVersion: spec["planVersion"] as number,
    stepId: spec["stepId"],
    runId: spec["runId"],
    outputSha256: spec["outputSha256"],
    verdict: parsed.verdict,
  };
}

function assertReplayEvidenceMatches(
  planVersion: number,
  step: ProviderTurnStep,
  record: ExecutionStepRecord,
): void {
  if (
    record.operation !== `${EPISODE_PLAN_EXECUTION_PIPELINE}/${step.id}` ||
    record.role !== step.role ||
    record.runtime === null ||
    record.model === null ||
    record.effort === null ||
    !turnAssignmentsEqual(
      { harness: record.runtime, model: record.model, effort: record.effort },
      step.assignment,
    ) ||
    record.assignment_source !== step.assignmentSource ||
    record.plan_version !== planVersion ||
    record.plan_step_id !== step.id
  ) {
    throw new Error(`learning: replay provider evidence for ${step.id} differs from its plan`);
  }
}

function replayEvidenceOutcome(
  evidence: ReplayProviderEvidence,
): EpisodeStepCompletedOutcome | EpisodeStepFailedOutcome {
  const artifact = {
    runId: evidence.record.run_id,
    executionStepId: evidence.record.execution_step_id,
    outputSha256: fingerprint(evidence.output),
    artifactSha256: evidence.record.artifact_fingerprint,
  };
  return evidence.record.status === "completed" && evidence.envelopeStatus === "completed"
    ? { status: "completed", artifact }
    : {
        status: "failed",
        reasonCode: evidence.envelopeErrorCode ?? evidence.record.error_code ??
          `error_learning_replay_provider_${evidence.envelopeStatus}`,
        summary: evidence.envelopeSummary ?? evidence.record.reason,
        artifact,
      };
}

async function replayAuthorization(
  root: string,
  step: ProviderTurnStep,
  execution: EpisodeStepExecutionContext,
): Promise<AuthorizedPass> {
  const route = await readRouteRecord(root, execution.episodeId);
  const matches = route.authorized_passes.filter((pass) =>
    pass.pipeline === EPISODE_PLAN_EXECUTION_PIPELINE &&
    pass.pass === step.id &&
    pass.role === step.role &&
    pass.plan_version === execution.planVersion &&
    pass.plan_step_id === step.id &&
    pass.runtime === step.assignment.harness &&
    pass.model === step.assignment.model &&
    pass.effort === step.assignment.effort &&
    pass.assignment_source === step.assignmentSource,
  );
  if (matches.length !== 1) {
    throw new Error(`learning: replay step ${step.id} requires one exact route authorization`);
  }
  return matches[0]!;
}

function replayProviderRunId(
  plan: EpisodePlan,
  step: ProviderTurnStep,
  execution: EpisodeStepExecutionContext,
): string {
  return mintRunId(
    new Date(plan.createdAt),
    EPISODE_PLAN_EXECUTION_PIPELINE,
    `${step.id}-${fingerprint(plan.episodeId).slice(0, 12)}-v${execution.planVersion}-a${execution.attempt}`,
  );
}

function providerRuntimeCapabilities(step: ProviderTurnStep): RuntimeCapability[] {
  return [...new Set([
    ...BASELINE_PROVIDER_CAPABILITIES,
    ...step.requiredCapabilities.filter(isRuntimeCapability),
  ])].sort();
}

function replayGateArtifact(result: GateRunResult): Record<string, unknown> {
  return {
    status: result.status,
    resultsSha256: fingerprint(result.results),
  };
}

async function deriveReplayAttempt(
  root: string,
  request: ReplayAttemptRequest,
  plan: EpisodePlan,
  journal: EpisodePlanExecutionJournal,
): Promise<ReplayAttempt> {
  if (
    journal.episode_id !== plan.episodeId ||
    journal.current_plan_version !== plan.version
  ) {
    throw new Error("learning: replay outcome journal does not match the current plan");
  }
  const providerRecords = (await readExecutionSteps(root, plan.episodeId))
    .filter((record) => record.kind === "provider");
  const uniqueRecords = [...new Map(
    providerRecords.map((record) => [record.execution_step_id, record]),
  ).values()];
  const costUsd = uniqueRecords.reduce((sum, record) => sum + (record.usage?.costUsd ?? 0), 0);
  const runIds = [...new Set(uniqueRecords.map((record) => record.run_id))];
  const gateIds = new Set<string>([REPLAY_STEP_IDS.gates, REPLAY_STEP_IDS.regate]);
  const gateFailures = journal.events.filter((event) =>
    event.kind === "step_failed" && gateIds.has(event.step_id),
  ).length;

  if (request.mode === "targeted") {
    const pass = journal.status === "completed" && gateFailures === 0;
    return finish(pass ? "build + gates pass" : journalFailureDetail(journal), {
      arm: request.arm,
      pair: request.pair,
      mode: request.mode,
      metrics: {
        held_in_pass: pass ? 1 : 0,
        gate_failures: gateFailures,
        cost_usd: costUsd,
      },
      heldInPass: pass,
      costUsd,
      runIds,
    });
  }

  const reviews: ReviewVerdict[] = [];
  for (const stepId of [REPLAY_STEP_IDS.review, REPLAY_STEP_IDS.rereview]) {
    const record = uniqueRecords.find((candidate) =>
      candidate.plan_step_id === stepId && candidate.status === "completed");
    if (record === undefined) continue;
    const output = await readFile(runPaths(root, REPLAY_RUNLOG_APP, record.run_id).output, "utf8");
    const verdict = await replayVerdictForEvidence(root, plan.episodeId, {
      record,
      output,
      envelopeStatus: "completed",
    });
    if (verdict !== undefined) reviews.push(verdict);
  }
  const reviewCycles = reviews.filter((verdict) => verdict.verdict === "findings").length;
  const approved = reviews.at(-1)?.verdict === "approve";
  const merged = journal.status === "completed" && gateFailures === 0 && approved;
  const grade = gradeBuildOutcome(request.fixture.expected_outcome, {
    merged,
    review_cycles: reviewCycles,
  });
  return finish(
    grade.pass
      ? "merge-equivalent within expected review cycles"
      : grade.reasons.length > 0 ? grade.reasons.join("; ") : journalFailureDetail(journal),
    {
      arm: request.arm,
      pair: request.pair,
      mode: request.mode,
      metrics: {
        merged: merged ? 1 : 0,
        review_cycles: reviewCycles,
        gate_failures: gateFailures,
        held_in_pass: grade.pass ? 1 : 0,
        cost_usd: costUsd,
      },
      heldInPass: grade.pass,
      costUsd,
      runIds,
    },
  );
}

function journalFailureDetail(journal: EpisodePlanExecutionJournal): string {
  const failure = [...journal.events].reverse().find((event) => event.kind === "step_failed");
  return failure?.kind === "step_failed" ? failure.summary : `replay ${journal.status}`;
}

function journalFailureCode(journal: EpisodePlanExecutionJournal): string | undefined {
  const failure = [...journal.events].reverse().find((event) => event.kind === "step_failed");
  return failure?.kind === "step_failed" ? failure.reason_code : undefined;
}

// ---------------------------------------------------------------------------
// arm context
// ---------------------------------------------------------------------------

/** Both arms resolve the STABLE lineage record-free (a running live trial
 *  must not leak into an offline experiment); the treatment arm prepends the
 *  candidate overlay as the first governed section — exactly where the
 *  resolver would place it once active. */
async function armContext(
  options: LoopReplayExecutorOptions,
  worktree: string,
  request: ReplayAttemptRequest,
  role: RoleConfig,
  stepId: string,
): Promise<ContextBundle> {
  const assembled = await assembleContext({
    orgHome: options.orgHome,
    appWorkdir: worktree,
    app: request.experiment.eligibility.app,
    role,
    taskText: request.fixture.input.brief ?? "",
    learning: {
      turnId:
        `replay-${sanitizeIdSegment(request.experiment.experiment_id)}-p${request.pair}-` +
        `${request.arm}-${role.name}-${stepId}`,
      episodeId: request.fixture.episode_ref,
      lineageOverride: "stable",
    },
  });
  if (request.arm === "treatment" && options.treatmentOverlay !== undefined) {
    return {
      ...assembled.bundle,
      memoryExcerpts: [options.treatmentOverlay, ...assembled.bundle.memoryExcerpts],
      components: [
        {
          category: "memory",
          source: `learning:treatment:${request.experiment.experiment_id}`,
          rendered: options.treatmentOverlay,
          inclusionReason: "declared candidate treatment overlay",
          requirement: "optional",
        },
        ...(assembled.bundle.components ?? []),
      ],
    };
  }
  return assembled.bundle;
}

/** Render the candidate's draft concept for the treatment arm — the same
 *  activated bytes the publisher would write, through the same renderer the
 *  resolver uses. */
export async function renderCandidateOverlay(input: {
  orgHome: string;
  appWorkdir?: string;
  candidateId: string;
  policy: LearningPolicy;
}): Promise<{ overlay: string; candidate: CandidateArtifact }> {
  const roots = [
    orgLearningRoot(input.orgHome),
    ...(input.appWorkdir !== undefined ? [appLearningRoot(input.appWorkdir)] : []),
  ];
  const found = await findCandidateArtifact(roots, input.candidateId);
  if (found === undefined) {
    throw new Error(`learning: no candidate ${input.candidateId} in the searched roots`);
  }
  if (found.candidate.destination !== "okf_concept") {
    throw new Error(
      `learning: ${input.candidateId} routes to ${found.candidate.destination} — ` +
        `only okf_concept candidates replay as context overlays`,
    );
  }
  const draft = [found.root, ...roots]
    .map((root) => conceptDraftPath(root, input.candidateId))
    .find((path) => existsSync(path));
  if (draft === undefined) {
    throw new Error(
      `learning: ${input.candidateId} has no concept draft (.md beside the candidate JSON)`,
    );
  }
  const activated = await renderActivatedConcept(draft);
  const doc = parseOkfDocument(activated.bytes, draft);
  return {
    overlay: renderConcept(doc, activated.scope, false, input.policy),
    candidate: found.candidate,
  };
}

// ---------------------------------------------------------------------------
// briefs and gates
// ---------------------------------------------------------------------------

const DIFF_CAP_BYTES = 24 * 1024;

function reviewBrief(brief: string, worktree: string, seedCommit: string): string {
  let diff: string;
  try {
    diff = gitIn(worktree, "diff", seedCommit, "HEAD");
  } catch (error) {
    diff = `(diff unavailable: ${error instanceof Error ? error.message : String(error)})`;
  }
  if (Buffer.byteLength(diff, "utf8") > DIFF_CAP_BYTES) {
    // Truncate in BYTES (the cap's unit); toString drops a split multibyte
    // sequence into a replacement char rather than a lone surrogate.
    const capped = Buffer.from(diff, "utf8").subarray(0, DIFF_CAP_BYTES).toString("utf8");
    diff = `${capped}\n… (diff truncated at ${DIFF_CAP_BYTES} bytes)`;
  }
  return [
    "You are reviewing a replayed implementation attempt. The original task brief follows, then the diff.",
    "Respond with a structured review verdict: `approve`, or `findings` with the finding list.",
    "",
    "## Original task brief",
    "",
    brief,
    "",
    "## Diff under review",
    "",
    "```diff",
    diff,
    "```",
  ].join("\n");
}

function fixBrief(brief: string, findings: ReviewVerdict["findings"]): string {
  return [
    "Address the review findings on your implementation of the task below. Fix them in the worktree.",
    "",
    "## Review findings",
    "",
    ...findings.map(
      (finding) =>
        `- ${finding.category}/${finding.severity} ${finding.location} — ${finding.description} -> ${finding.action}`,
    ),
    "",
    "## Original task brief",
    "",
    brief,
  ].join("\n");
}

/** Quality gates against the seed diff, with the app's own policy and
 *  commands when the worktree carries them (the setup gate installs deps
 *  first, exactly like a loop tick). Acceptance criteria parse from the
 *  original brief — it embeds the ticket body — and the typed contract map
 *  is recovered from those same immutable brief bytes. */
async function runReplayGates(
  worktree: string,
  seedCommit: string,
  brief: string,
): Promise<GateRunResult> {
  const policyPath = join(worktree, ".cormidia", "policy.yaml");
  const policy = existsSync(policyPath) ? await loadPolicy(policyPath) : DEFAULT_LOOP_POLICY;
  const changed = gitIn(worktree, "diff", "--name-only", seedCommit, "HEAD")
    .split("\n")
    .filter((line) => line.trim() !== "");
  const head = gitIn(worktree, "rev-parse", "HEAD");
  const criteria = parseAcceptanceCriteria(brief);
  return runGates(
    resolveTier(policy, changed),
    worktree,
    criteria,
    [],
    // Review freshness is a loop-PR concern; replay grades review approval
    // through the verdict itself.
    { approvedCommitId: head, headCommitId: head },
    {
      policy,
      commands: loadGateCommands(worktree),
      criterionTests: criterionTestMapFromContractText(brief),
    },
  );
}

// ---------------------------------------------------------------------------
// seed worktrees
// ---------------------------------------------------------------------------

function ensureSeedWorktree(
  localRepo: string,
  path: string,
  branch: string,
  seedCommit: string,
): void {
  if (existsSync(path)) {
    const actualBranch = gitIn(path, "branch", "--show-current");
    if (actualBranch !== branch) {
      throw new Error(
        `learning: replay worktree ${path} is on ${actualBranch || "detached HEAD"}, expected ${branch}`,
      );
    }
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", seedCommit, "HEAD"], {
        cwd: path,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
    } catch {
      throw new Error(
        `learning: replay worktree ${path} no longer descends from seed ${seedCommit}`,
      );
    }
    return;
  }
  const branchExists = execFileSync(
    "git",
    ["branch", "--list", branch],
    { cwd: localRepo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim() !== "";
  if (branchExists) {
    throw new Error(
      `learning: replay branch ${branch} exists without its durable worktree; refusing to reset it`,
    );
  }
  execFileSync("git", ["worktree", "add", "-b", branch, path, seedCommit], {
    cwd: localRepo,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

function removeSeedWorktree(localRepo: string, worktree: string): void {
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktree], {
      cwd: localRepo,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    rmSync(worktree, { recursive: true, force: true });
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: localRepo, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      // best effort after a terminal replay only. Interrupted worktrees are
      // never removed by the executor.
    }
  }
}

/** Shared by the executor and the experiment CLI: one git wrapper whose
 *  errors carry stderr — an opaque "Command failed: git …" hides whether a
 *  fetch failed on auth or a missing ref. */
export function gitIn(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const detail = typeof stderr === "string" && stderr.trim() !== "" ? `\n${stderr.trim()}` : "";
    throw new Error(`git ${args.join(" ")} failed in ${cwd}${detail}`);
  }
}

function requireRole(roles: Record<string, RoleConfig>, name: string): RoleConfig {
  const role = roles[name];
  if (role === undefined) {
    throw new Error(`learning: replay needs a "${name}" role in roles.yaml`);
  }
  return role;
}
