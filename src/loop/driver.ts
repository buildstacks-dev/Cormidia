// Manual build-loop tick driver (M5.9). The autonomous dispatcher later
// calls the same phase functions; this file is the thin "advance ready
// tickets once" wrapper for CLI and sandbox e2e use.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import type { ContextBundle, RoleConfig, Runtime, TurnHooks } from "../runtime/types.js";
import type { TriggerKind } from "../runtime/telemetry.js";
import type { GhIssue, GhOps } from "./github.js";
import { GhCliOps } from "./github.js";
import {
  advanceGates,
  advanceProvisionSetup,
  advanceReviewing,
  advanceShipping,
  branchNameForIssue,
  claimTicket,
  criterionTestMapFromContractText,
  itemFromIssue,
  parseAcceptanceCriteria,
  dependencyRelevantPackageJson,
  rearmDependents,
  runBuilderPipeline,
  runReviewPipeline,
  runShipCheckPipeline,
  type ExecutionJournalTarget,
  type ReviewAuthorization,
} from "./loop.js";
import {
  parkedDigestComment,
  hashTicketBody,
  readTicketClaimState,
  rehydrateTicketState,
  writeTicketClaimState,
  type RehydratedState,
} from "./rehydrate.js";
import { runEnvPreflight } from "./preflight.js";
import type { LoopRunlog } from "./loop-runlog.js";
import type { PipelinesFile } from "./pipelines.js";
import type { Policy } from "./policy.js";
import { loadPolicy, matchedDimensions, resolveTier } from "./policy.js";
import type { GateCommands } from "./qgates.js";
import {
  admitEpisode,
  episodeIdFor,
  readRouteRecord,
  reassessEpisode,
  type EpisodeTerminal,
} from "./efficiency.js";
import {
  authorizeRoutePasses,
  decideExecutionRoute,
  executionBoundsFor,
  nextRouteAfterUnexpectedFinding,
  type RouteDecision,
} from "./route-policy.js";
import {
  initializeExecutionJournal,
  invalidateExecutionFrom,
  readExecutionJournal,
  recordExecutionBoundary,
  resumeExecutionJournal,
} from "./execution-journal.js";
import { parseDependsOn, parseScope, selectReadyTickets } from "./scheduling.js";
import type { LoopItem, ReleaseConfig, ScorecardEvent } from "./types.js";

export interface LoopPlanItem {
  issueNumber: number;
  title: string;
  phase: LoopItem["phase"];
  tier: LoopItem["tier"];
}

export interface LoopDriverOptions {
  app: string;
  repo: string;
  gh: GhOps;
  localRepo: string;
  worktreeRoot: string;
  policy: Policy;
  commands: GateCommands;
  maxConcurrent?: number;
  planOnly?: boolean;
  /** Active dispatch turn id; stamped onto claimed items so merge-time
   *  scorecard events dedupe and attribute correctly. */
  turnId?: string;
  afterClaim?: (item: LoopItem) => Promise<LoopItem> | LoopItem;
  injectReview?: (item: LoopItem) => Promise<void> | void;
  engine?: LoopEngineOptions;
  /** Cross-claim attempt cap (Stage 2): after this many claims without a
   *  merge, the ticket parks as op:returned with an evidence digest instead
   *  of being claimed again. Default 3. */
  maxClaims?: number;
  /** Merge-authorization policy for the reviewing phase (self-approval secret,
   *  builder/reviewer identities). Passed through to advanceReviewing so a
   *  forged/self-authored approval cannot merge. */
  authorization?: ReviewAuthorization;
  /** The app's declared release mechanism (A4). Passed to advanceShipping:
   *  P7 fails the ship when the milestone requires a mechanism the app does
   *  not declare, and a merged deploy/package milestone returns a
   *  releaseTrigger for the org layer to queue as a critical op. */
  release?: ReleaseConfig;
  /** Base rev ticket branches start from instead of an assumed `main`: the
   * immutable commit captured from a supplied checkout, or the managed
   * clone's resolved default branch (L-010). */
  baseRef?: string;
}

export interface LoopEngineOptions {
  pipelines: PipelinesFile;
  roles: Record<string, RoleConfig>;
  runtimeFor: (role: RoleConfig) => Runtime;
  promptsDir: string;
  runlogRoot: string;
  hooks: TurnHooks;
  /** Role-aware critical-op gate for durable approval composition. */
  gateForRole?: (role: RoleConfig) => TurnHooks["gate"];
  context?: ContextBundle;
  /** Per-episode governed context (learning-loop M5): see
   *  LoopPipelineOptions.contextFor. */
  contextFor?: (item: LoopItem, pipeline: string, role: string) => Promise<ContextBundle | undefined>;
  clock?: () => Date;
  /** Explicit network grant for runtime turns in this loop tick. */
  networkAccess?: boolean;
  /** Per-pass ledger settlement target — see ExecutePipelineOptions.telemetry. */
  telemetry?: { orgDir: string; trigger?: TriggerKind };
  /** Budget preflight (telemetry doc Defect B item 3). Consulted before any
   *  ticket is claimed; a refusal means the tick claims nothing and no pass
   *  starts — tickets stay op:ready instead of stranding in op:building. The
   *  org layer supplies the answer (loop code never reads org budget state —
   *  one-way imports). */
  budgetGuard?: () => Promise<{ allowed: boolean; reason?: string }>;
  /** Cooperative cancellation for all provider stages in this tick. */
  signal?: AbortSignal;
  parentTaskId?: string;
  /** Organizational owner records the final ticket disposition. The loop
   * supplies the admitted episode id and terminal item, but does not invent
   * an org outcome. */
  onEpisodeTerminal?: (input: {
    episodeId: string;
    item: LoopItem;
    status: EpisodeTerminal["status"];
    reason: string;
    nextStep?: string;
    now: Date;
  }) => Promise<void>;
}

export interface LoopDriverResult {
  lines: string[];
  items: LoopItem[];
  scorecardEvents: ScorecardEvent[];
  /** Set when budgetGuard refused the tick before any claim. */
  budgetRefusal?: string;
}

export function planLoopTick(
  issues: readonly GhIssue[],
  repo: string,
  maxConcurrent: number,
): LoopPlanItem[] {
  const items = issues.map((issue) => itemFromIssue(issue, repo));
  const selected = selectReadyTickets(
    items.map((item) => ({
      id: item.issueNumber,
      phase: item.phase,
      dependsOn: parseDependsOn(item.body),
      scope: parseScope(item.body),
      priority: priority(item.labels),
    })),
    maxConcurrent,
  );
  const selectedIds = new Set(selected.map((ticket) => ticket.id));
  return items
    .filter((item) => selectedIds.has(item.issueNumber))
    .map((item) => ({
      issueNumber: item.issueNumber,
      title: item.title,
      phase: item.phase,
      tier: item.tier,
    }));
}

export async function runLoopOnce(options: LoopDriverOptions): Promise<LoopDriverResult> {
  const maxConcurrent = options.maxConcurrent ?? 1;
  // Budget preflight before ANY claim: an exhausted app cap must stop work
  // before a ticket leaves op:ready, not mid-turn (Stage 1 exit criterion —
  // "a pass that would exceed the app cap does not start").
  if (options.engine?.budgetGuard !== undefined && options.planOnly !== true) {
    const verdict = await options.engine.budgetGuard();
    if (!verdict.allowed) {
      const reason = verdict.reason ?? "app budget exhausted";
      return {
        lines: [`budget preflight refused the tick: ${reason}`],
        items: [],
        scorecardEvents: [],
        budgetRefusal: reason,
      };
    }
  }
  const readyIssues = await options.gh.listIssues({
    labels: ["op:ready"],
    state: "open",
    limit: maxConcurrent * 3,
  });
  const plan = planLoopTick(readyIssues, options.repo, maxConcurrent);
  const lines = plan.map((item) => `#${item.issueNumber} ${item.title}: ready -> claim`);
  if (options.planOnly) return { lines, items: [], scorecardEvents: [] };

  const items: LoopItem[] = [];
  for (const planned of plan) {
    const issue = readyIssues.find((candidate) => candidate.number === planned.issueNumber);
    if (issue === undefined) continue;

    // Cross-claim accounting + rehydration (Stage 2) — engine path only; the
    // injector path is the simulated M5 state machine and stays blank-slate.
    let rehydrated: RehydratedState | undefined;
    if (options.engine !== undefined) {
      const branch = branchNameForIssue(issue);
      rehydrated = await rehydrateTicketState(
        { issueNumber: issue.number, body: issue.body },
        { gh: options.gh, branch },
      );
      const claimState = readTicketClaimState(options.engine.runlogRoot, options.app, issue.number);
      const maxClaims = options.maxClaims ?? executionBoundsFor(planned.tier).claimAttempts;
      if (claimState.claims >= maxClaims) {
        // Nothing in the episode ever said "this ticket has bounced N times;
        // stop and summon the human" — this is that stop. Bounded attempts,
        // then park with the assembled evidence (never a bare label flip).
        await options.gh.commentIssue(
          issue.number,
          parkedDigestComment({
            claims: claimState.claims,
            maxClaims,
            outcomes: claimState.outcomes,
            ...(rehydrated.prNumber !== undefined ? { prNumber: rehydrated.prNumber } : {}),
            openFindings: rehydrated.findings,
            hasContract: rehydrated.contract !== undefined,
          }),
        );
        await options.gh.swapLabel(issue.number, "op:ready", "op:returned");
        lines.push(
          `#${issue.number} ${issue.title}: parked after ${claimState.claims} claims (cap ${maxClaims})`,
        );
        continue;
      }
      writeTicketClaimState(options.engine.runlogRoot, options.app, issue.number, {
        claims: claimState.claims + 1,
        lastClaimAt: (options.engine.clock?.() ?? new Date()).toISOString(),
        outcomes: claimState.outcomes,
      });
    }

    let item = await claimTicket(issue, {
      gh: options.gh,
      targetRepo: options.repo,
      localRepo: options.localRepo,
      worktreeRoot: options.worktreeRoot,
      ...(options.baseRef !== undefined ? { baseBranch: options.baseRef } : {}),
    });
    if (options.turnId !== undefined) item = { ...item, turnId: options.turnId };
    if (rehydrated !== undefined) {
      item = {
        ...item,
        ...(rehydrated.contract !== undefined ? { contract: rehydrated.contract } : {}),
        findings: rehydrated.findings,
        cycles: rehydrated.cycles,
        ...(rehydrated.prNumber !== undefined ? { prNumber: rehydrated.prNumber } : {}),
      };
      // An open PR with no open findings means build+gates already succeeded
      // once: re-validate gates and go to review — never a full rebuild. Open
      // findings keep phase "building", where the nonzero findings/cycles
      // select the fix pipeline instead of a blank-slate "build".
      if (rehydrated.prNumber !== undefined && rehydrated.findings.length === 0) {
        item = { ...item, phase: "gates" };
      }
    }
    if (options.engine !== undefined) {
      item = await admitTicketEpisode(options, item);
      // Provision the worktree's dependencies BEFORE the first implement pass.
      // createWorktree provisions an empty tree, and the builder's mandatory
      // "baseline before changes" check runs at the start of the implement
      // pass — without deps it fails every greenfield ticket regardless of
      // ticket quality (L1-02 / L-003). runGates keeps its own post-implement
      // setup re-run; this is the earlier run a fresh worktree needs. A setup
      // failure returns the ticket loudly here, so no doomed build turn runs.
      item = await advanceProvisionSetup(item, {
        gh: options.gh,
        commands: gateCommandsForWorktree(options.commands, item.worktree),
        runlog: gateRunlog(options, item),
      });
    }
    if (options.engine === undefined) {
      item = await (options.afterClaim?.(item) ?? item);
    }

    const criteria = parseAcceptanceCriteria(item.body);
    let criterionTests = item.criterionTests ?? criterionTestMapFromContractText(item.contract);
    let guard = 0;
    while (!["merged", "returned", "blocked"].includes(item.phase)) {
      if (guard++ > 12) {
        throw new Error(`loop driver exceeded phase guard for ${item.ticketRef}`);
      }

      if (item.phase === "building") {
        if (options.engine !== undefined) {
          if (item.findings.length > 0) {
            item = await reassessTicketEpisode(options, item, "unexpected review finding");
          } else if (item.rebaseNote !== undefined) {
            item = await reassessTicketEpisode(options, item, "merge conflict invalidated the implementation");
          }
          // Token-free environment preflight before the first provider turn
          // (Stage 3, P6): a $0 probe must catch what previously took a $7
          // model turn to discover. Failure returns the ticket with the probe
          // evidence — no pass starts.
          const preflight = await runEnvPreflight(
            item.worktree ?? options.localRepo,
            gateCommandsForWorktree(options.commands, item.worktree),
            { ...(options.engine.networkAccess === true ? { networkAccess: true } : {}) },
          );
          if (!preflight.ok) {
            await options.gh.commentIssue(
              item.issueNumber,
              [
                "## Environment preflight failed",
                "",
                "No model turn was started. Probes found:",
                ...preflight.problems.map((p) => `- ${p}`),
              ].join("\n"),
            );
            await options.gh.swapLabel(item.issueNumber, "op:building", "op:returned");
            item = {
              ...item,
              labels: item.labels.map((l) => (l === "op:building" ? "op:returned" : l)),
              phase: "returned",
            };
            continue;
          }
          item = await runBuilderPipeline(item, {
            ...enginePhaseOptions(options, item.worktree, item),
            pipelineName:
              item.cycles > 0 || item.findings.length > 0 || item.rebaseNote !== undefined
                ? "fix"
                : "build",
          });
          criterionTests = item.criterionTests ?? criterionTests;
          if (item.phase !== "gates") continue;
        }

        item = await advanceGates(item, {
          gh: options.gh,
          policy: options.policy,
          commands: gateCommandsForWorktree(options.commands, item.worktree),
          criteria,
          criterionTests,
          ...(options.engine !== undefined
            ? {
                remediate: (current, result) =>
                  reassessTicketEpisode(options, current, "unexpected quality-gate finding").then((reassessed) =>
                    runBuilderPipeline(reassessed, {
                      ...enginePhaseOptions(options, reassessed.worktree, reassessed),
                      pipelineName: "fix",
                      gateResult: result,
                    }),
                  ),
                maxRemediationAttempts: executionBoundsFor(item.tier).repairAttempts,
                runlog: gateRunlog(options, item),
                journal: journalTarget(options, item),
              }
            : {}),
        });
        continue;
      }

      if (item.phase === "gates") {
        item = await advanceGates(item, {
          gh: options.gh,
          policy: options.policy,
          commands: gateCommandsForWorktree(options.commands, item.worktree),
          criteria,
          criterionTests,
          ...(options.engine !== undefined
            ? {
                remediate: (current, result) =>
                  reassessTicketEpisode(options, current, "unexpected quality-gate finding").then((reassessed) =>
                    runBuilderPipeline(reassessed, {
                      ...enginePhaseOptions(options, reassessed.worktree, reassessed),
                      pipelineName: "fix",
                      gateResult: result,
                    }),
                  ),
                maxRemediationAttempts: executionBoundsFor(item.tier).repairAttempts,
                runlog: gateRunlog(options, item),
                journal: journalTarget(options, item),
              }
            : {}),
        });
        continue;
      }

      if (item.phase === "reviewing") {
        if (options.engine !== undefined) {
          item = await reassessForObservedWorktreeRisk(options, item);
          const journal = await readExecutionJournal(
            journalTarget(options, item).root,
            journalTarget(options, item).episodeId,
          );
          if (journal?.next_boundary === "approvals") {
            item = await advanceReviewing(item, {
              gh: options.gh,
              ...(options.authorization !== undefined ? { authorization: options.authorization } : {}),
              journal: journalTarget(options, item),
            });
          } else {
            item = await runReviewPipeline(item, enginePhaseOptions(options, item.worktree, item));
          }
        } else {
          await options.injectReview?.(item);
          item = await advanceReviewing(item, {
            gh: options.gh,
            ...(options.authorization !== undefined ? { authorization: options.authorization } : {}),
          });
        }
        continue;
      }

      if (item.phase === "shipping") {
        if (options.engine !== undefined) {
          item = await runShipCheckPipeline(item, enginePhaseOptions(options, item.worktree, item));
          if (item.phase !== "shipping") continue;
        }
        item = await advanceShipping(item, {
          gh: options.gh,
          localRepo: options.localRepo,
          policy: options.policy,
          commands: gateCommandsForWorktree(options.commands, item.worktree),
          criteria,
          criterionTests,
          ...(options.engine !== undefined ? { journal: journalTarget(options, item) } : {}),
          ...(options.release !== undefined ? { release: options.release } : {}),
        });
        continue;
      }

      break;
    }
    if (options.engine === undefined && item.phase === "reviewing") {
      await options.injectReview?.(item);
      item = await advanceReviewing(item, {
        gh: options.gh,
        ...(options.authorization !== undefined ? { authorization: options.authorization } : {}),
      });
    }
    if (options.engine === undefined && item.phase === "shipping") {
      item = await advanceShipping(item, {
        gh: options.gh,
        localRepo: options.localRepo,
        policy: options.policy,
        commands: gateCommandsForWorktree(options.commands, item.worktree),
        criteria,
        criterionTests,
        ...(options.release !== undefined ? { release: options.release } : {}),
      });
    }
    items.push(item);
    // L-007: when a ticket merges, the merge transition owns promoting any
    // now-unblocked dependents to op:ready. Best-effort — the merge is already
    // durable, so a re-arm failure logs a line but never fails the tick.
    if (item.phase === "merged") {
      try {
        for (const dependent of await rearmDependents(options.gh, item.issueNumber)) {
          lines.push(`#${dependent}: dependencies satisfied by #${item.issueNumber} merge -> op:ready`);
        }
      } catch (error) {
        lines.push(
          `#${item.issueNumber}: merged, but re-arming dependents failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (options.engine !== undefined) {
      // Append this claim's outcome to the cross-claim record — it is the
      // evidence the park digest shows the human after the claim cap.
      const claimState = readTicketClaimState(options.engine.runlogRoot, options.app, item.issueNumber);
      claimState.outcomes = [
        ...claimState.outcomes.slice(-9),
        `claim ${claimState.claims}: ended ${item.phase}${item.prNumber !== undefined ? ` (PR #${item.prNumber})` : ""}`,
      ];
      writeTicketClaimState(options.engine.runlogRoot, options.app, item.issueNumber, claimState);
      const terminal = terminalDisposition(item);
      await options.engine.onEpisodeTerminal?.({
        episodeId: episodeIdFor({
          app: options.app,
          ticket: item.ticketRef,
          traceId: item.turnId ?? item.ticketRef,
        }),
        item,
        ...terminal,
        now: options.engine.clock?.() ?? new Date(),
      });
    }
  }
  return { lines, items, scorecardEvents: items.flatMap((item) => item.scorecardEvents ?? []) };
}

export interface DefaultLoopInputOptions {
  /** True only when the operator supplied --repo-dir. Such a checkout is an
   * immutable source and must never be fetched/checked-out/reset. */
  supplied?: boolean;
  /** Required for supplied input: Operon-owned clone used for ticket branches. */
  snapshotDir?: string;
}

export async function defaultLoopInputs(
  repoSlug: string,
  repoDir: string,
  options: DefaultLoopInputOptions = {},
): Promise<{
  gh: GhOps;
  localRepo: string;
  baseRef?: string;
  policy: Policy;
  commands: GateCommands;
}> {
  let localRepo = repoDir;
  let baseRef: string | undefined;
  if (options.supplied === true) {
    if (options.snapshotDir === undefined) {
      throw new Error("loop: supplied repo input requires an Operon-owned snapshot directory");
    }
    const prepared = snapshotSuppliedCheckout(repoDir, options.snapshotDir);
    localRepo = prepared.path;
    baseRef = prepared.head;
  } else {
    // The managed clone's resolved default branch (not an assumed `main`)
    // becomes the base every ticket branch and gate diff starts from.
    baseRef = ensureClone(repoSlug, repoDir);
  }
  return {
    gh: new GhCliOps(repoSlug, undefined, process.env["OPERON_SELF_APPROVAL_SECRET"]),
    localRepo,
    ...(baseRef !== undefined ? { baseRef } : {}),
    policy: await loadRequiredPolicy(join(localRepo, ".operon", "policy.yaml")),
    commands: loadGateCommands(localRepo),
  };
}

export const DEFAULT_LOOP_POLICY: Policy = {
  riskTiers: { high: ["auth/**", "crypto/**", "infra/**"], medium: ["src/**"], low: ["*.md"] },
  gates: {
    high: ["tests", "lint", "security", "completeness"],
    medium: ["tests", "lint", "completeness"],
    low: ["tests", "completeness"],
  },
  dimensionGlobs: {},
  remediation: { maxAttempts: 3 },
};

async function loadRequiredPolicy(path: string): Promise<Policy> {
  if (!existsSync(path)) {
    throw new Error(
      `loop: missing app-owned policy file ${path}; run operon bootstrap for this app first`,
    );
  }
  return loadPolicy(path);
}

/** Gate-phase run record target (docs/loop.md §9): the state machine's gate
 *  events land under the engine's runlog home, correlated on the item's turn
 *  id. Only available in engine mode — the pure state-machine path has no
 *  runlog home. */
function gateRunlog(options: LoopDriverOptions, item: LoopItem): LoopRunlog {
  const engine = options.engine;
  if (engine === undefined) throw new Error("loop driver: engine options missing");
  return {
    root: engine.runlogRoot,
    app: options.app,
    ticket: item.ticketRef,
    traceId: item.turnId ?? `${item.ticketRef}-gates`,
    episodeId: episodeIdFor({
      app: options.app,
      ticket: item.ticketRef,
      traceId: item.turnId ?? `${item.ticketRef}-gates`,
    }),
    ...(engine.context?.authority !== undefined
      ? {
          authority: {
            profile: engine.context.authority.profile,
            version: engine.context.authority.version,
            sha256: engine.context.authority.sha256,
            sources: [...engine.context.authority.sources],
          },
        }
      : {}),
    ...(engine.clock !== undefined ? { clock: engine.clock } : {}),
  };
}

function enginePhaseOptions(options: LoopDriverOptions, worktree?: string, item?: LoopItem) {
  const engine = options.engine;
  if (engine === undefined) throw new Error("loop driver: engine options missing");
  const decision = item === undefined ? undefined : routeDecisionForItem(item);
  return {
    gh: options.gh,
    pipelines: engine.pipelines,
    roles: engine.roles,
    runtimeFor: engine.runtimeFor,
    promptsDir: engine.promptsDir,
    runlogRoot: engine.runlogRoot,
    app: options.app,
    policy: options.policy,
    commands: gateCommandsForWorktree(options.commands, worktree),
    hooks: engine.hooks,
    ...(engine.gateForRole !== undefined ? { gateForRole: engine.gateForRole } : {}),
    ...(engine.context !== undefined ? { context: engine.context } : {}),
    ...(engine.contextFor !== undefined ? { contextFor: engine.contextFor } : {}),
    ...(engine.clock !== undefined ? { clock: engine.clock } : {}),
    ...(engine.networkAccess === true ? { networkAccess: true } : {}),
    ...(engine.telemetry !== undefined ? { telemetry: engine.telemetry } : {}),
    ...(engine.signal !== undefined ? { signal: engine.signal } : {}),
    ...(engine.parentTaskId !== undefined ? { parentTaskId: engine.parentTaskId } : {}),
    ...(item !== undefined ? { maxReviewCycles: executionBoundsFor(item.tier).reviewCycles } : {}),
    episode: {
      id: episodeIdFor({
        app: options.app,
        ...(item !== undefined ? { ticket: item.ticketRef } : {}),
        traceId: item?.turnId ?? item?.ticketRef ?? "unknown",
      }),
      ...(item !== undefined ? { route: item.tier } : {}),
      ...(decision !== undefined
        ? {
            policyVersion: decision.policyVersion,
            factors: decision.factors,
            authorizedPasses: authorizeRoutePasses({
              decision,
              pipelines: engine.pipelines.pipelines,
              roles: engine.roles,
            }),
          }
        : {}),
      ...(item?.tier === "deep" ? { budgetOverrides: { input_tokens: 8_000_000 } } : {}),
      finalize: false,
    },
    ...(options.authorization !== undefined ? { authorization: options.authorization } : {}),
  };
}

async function admitTicketEpisode(options: LoopDriverOptions, item: LoopItem): Promise<LoopItem> {
  const engine = options.engine;
  if (engine === undefined) return item;
  const episodeId = episodeIdFor({
    app: options.app,
    ticket: item.ticketRef,
    traceId: item.turnId ?? item.ticketRef,
  });
  let effective = item;
  try {
    const existing = await readRouteRecord(engine.runlogRoot, episodeId);
    if (existing.current_route !== "deterministic") effective = { ...item, tier: existing.current_route };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const decision = routeDecisionForItem(effective);
  const passes = authorizeRoutePasses({
    decision,
    pipelines: engine.pipelines.pipelines,
    roles: engine.roles,
  });
  await admitEpisode({
    root: engine.runlogRoot,
    episodeId,
    app: options.app,
    route: decision.route,
    policyVersion: decision.policyVersion,
    factors: decision.factors,
    passes,
    now: engine.clock?.() ?? new Date(),
    ...(effective.tier === "deep" ? { budgetOverrides: { input_tokens: 8_000_000 } } : {}),
  });
  await initializeExecutionJournal({
    root: engine.runlogRoot,
    episodeId,
    app: options.app,
    ticketRef: item.ticketRef,
    now: engine.clock?.() ?? new Date(),
  });
  const journal = await readExecutionJournal(engine.runlogRoot, episodeId);
  if (!journal?.stages.some((stage) => stage.boundary === "route" && stage.status === "completed")) {
    await recordExecutionBoundary({
      root: engine.runlogRoot,
      episodeId,
      boundary: "route",
      artifact: decision,
      now: engine.clock?.() ?? new Date(),
    });
  }
  const resume = await resumeExecutionJournal({
    root: engine.runlogRoot,
    episodeId,
    artifacts: {
      ...(effective.contract !== undefined
        ? {
            contract: {
              ticketBodyHash: hashTicketBody(effective.body),
              contract: effective.contract,
            },
          }
        : {}),
      ...(effective.worktree !== undefined
        ? { implementation: { head: git(effective.worktree, "rev-parse", "HEAD") } }
        : {}),
    },
    now: engine.clock?.() ?? new Date(),
  });
  if (["ready", "building", "gates", "reviewing", "shipping"].includes(effective.phase)) {
    if (["push", "gates", "pr"].includes(resume.nextBoundary ?? "")) {
      effective = { ...effective, phase: "gates" };
    } else if (["findings", "approvals"].includes(resume.nextBoundary ?? "") && effective.prNumber !== undefined) {
      effective = { ...effective, phase: "reviewing" };
    } else if (["merge", "release"].includes(resume.nextBoundary ?? "") && effective.prNumber !== undefined) {
      effective = { ...effective, phase: "shipping" };
    }
  }
  return effective;
}

async function reassessTicketEpisode(
  options: LoopDriverOptions,
  item: LoopItem,
  reason: string,
): Promise<LoopItem> {
  const engine = options.engine;
  if (engine === undefined) return item;
  const target = journalTarget(options, item);
  const record = await readRouteRecord(target.root, target.episodeId);
  if (record === undefined) throw new Error(`loop reassessment: missing route record ${target.episodeId}`);
  const current = record.current_route === "deterministic" ? "quick" : record.current_route;
  const next = nextRouteAfterUnexpectedFinding(current);
  const journal = await readExecutionJournal(target.root, target.episodeId);
  if (journal?.stages.some((stage) => stage.boundary === "implementation" && stage.status === "completed")) {
    await invalidateExecutionFrom({
      root: target.root,
      episodeId: target.episodeId,
      boundary: "implementation",
      reason,
      now: engine.clock?.() ?? new Date(),
    });
  }
  if (next === current) return { ...item, tier: next };
  const reassessed = { ...item, tier: next };
  const decision = routeDecisionForItem(reassessed);
  await reassessEpisode({
    root: target.root,
    episodeId: target.episodeId,
    toRoute: next,
    factor: {
      kind: "uncertainty",
      evidence: reason,
      policy_rule: "unexpected_finding",
    },
    authorizedPasses: authorizeRoutePasses({
      decision,
      pipelines: engine.pipelines.pipelines,
      roles: engine.roles,
    }),
    now: engine.clock?.() ?? new Date(),
    ...(next === "deep" ? { budgetOverrides: { input_tokens: 8_000_000 } } : {}),
  });
  return reassessed;
}

async function reassessForObservedWorktreeRisk(
  options: LoopDriverOptions,
  item: LoopItem,
): Promise<LoopItem> {
  const engine = options.engine;
  if (engine === undefined || item.worktree === undefined) return item;
  const baseRef = options.baseRef ?? "origin/main";
  const changedFiles = git(item.worktree, "diff", "--name-only", baseRef, "HEAD")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  const risk = resolveTier(options.policy, changedFiles);
  // Content-gate package.json for the security dimension: a bare
  // metadata/test-glob edit must not escalate standard → deep; a
  // dependency/run-script change must (L1-05).
  const dimensions = matchedDimensions(options.policy, changedFiles, {
    dependencyRelevantPackageJson: dependencyRelevantPackageJson(item.worktree, baseRef, "HEAD", changedFiles),
  });
  if (risk !== "high" && !dimensions.includes("security")) return item;
  const target = journalTarget(options, item);
  const record = await readRouteRecord(target.root, target.episodeId);
  if (record.current_route === "deep") return { ...item, tier: "deep" };
  const reassessed = { ...item, tier: "deep" as const };
  const decision = routeDecisionForItem(reassessed);
  await reassessEpisode({
    root: target.root,
    episodeId: target.episodeId,
    toRoute: "deep",
    factor: {
      kind: "sensitive_domain",
      evidence: `observed changed paths resolved risk=${risk}; dimensions=${dimensions.join(",") || "none"}`,
      policy_rule: "observed_worktree_risk",
    },
    authorizedPasses: authorizeRoutePasses({
      decision,
      pipelines: engine.pipelines.pipelines,
      roles: engine.roles,
    }),
    budgetOverrides: { input_tokens: 8_000_000 },
    now: engine.clock?.() ?? new Date(),
  });
  return reassessed;
}

/** Reconstruct the structured route decision for a claimed ticket. The
 *  `sensitiveDomains` are read back from the ticket's labels (the orchestrator
 *  attaches `domain:<d>` labels at plan publication — see
 *  `applySensitiveDomainFloor`), which is what lets the route policy's
 *  sensitive-domain deep floor fire. Throws if the tier label and the
 *  structured decision disagree — a domain label therefore requires the
 *  ticket to already be `op:tier-deep`. */
export function routeDecisionForItem(item: LoopItem): RouteDecision {
  const sensitiveDomains = item.labels
    .filter((label) => /auth|security|secret|privacy|payment|data/.test(label))
    .sort();
  const profile =
    item.tier === "quick"
      ? {
          blastRadius: "low" as const,
          reversibility: "reversible" as const,
          sensitiveDomains: [],
          uncertainty: "low" as const,
          componentCount: 1,
          externalSystemCount: 0,
          releaseConsequence: "none" as const,
          novelty: "familiar" as const,
          evidenceQuality: "high" as const,
        }
      : item.tier === "standard"
        ? {
            blastRadius: "medium" as const,
            reversibility: "reversible" as const,
            sensitiveDomains,
            uncertainty: "medium" as const,
            componentCount: 2,
            externalSystemCount: 0,
            releaseConsequence: "none" as const,
            novelty: "familiar" as const,
            evidenceQuality: "high" as const,
          }
        : {
            blastRadius: "high" as const,
            reversibility: "difficult" as const,
            sensitiveDomains,
            uncertainty: "high" as const,
            componentCount: 3,
            externalSystemCount: 1,
            releaseConsequence: "internal" as const,
            novelty: "new" as const,
            evidenceQuality: "partial" as const,
          };
  const decision = decideExecutionRoute(profile);
  if (decision.route !== item.tier) {
    throw new Error(
      `ticket ${item.ticketRef} route label ${item.tier} conflicts with structured decision ${decision.route}`,
    );
  }
  return decision;
}

function journalTarget(options: LoopDriverOptions, item: LoopItem): ExecutionJournalTarget {
  const engine = options.engine;
  if (engine === undefined) throw new Error("loop driver: engine options missing");
  return {
    root: engine.runlogRoot,
    episodeId: episodeIdFor({
      app: options.app,
      ticket: item.ticketRef,
      traceId: item.turnId ?? item.ticketRef,
    }),
    ...(engine.clock !== undefined ? { clock: engine.clock } : {}),
  };
}

function terminalDisposition(item: LoopItem): {
  status: EpisodeTerminal["status"];
  reason: string;
  nextStep?: string;
} {
  if (item.phase === "merged") return { status: "completed", reason: `${item.ticketRef} merged` };
  if (item.phase === "blocked") {
    return {
      status: "blocked",
      reason: `${item.ticketRef} blocked`,
      nextStep: "resolve the named blocker and re-arm the ticket",
    };
  }
  return {
    status: "interrupted",
    reason: `${item.ticketRef} returned for human triage`,
    nextStep: "review the durable evidence digest and re-arm or close the ticket",
  };
}


export function loadGateCommands(repoDir: string): GateCommands {
  const commands: GateCommands = {};
  const configPath = join(repoDir, ".operon", "config.yaml");
  if (existsSync(configPath)) {
    const raw = parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const nestedApps = asRecord(raw["apps"]);
    const appEntries = nestedApps === undefined ? [] : Object.values(nestedApps);
    const soleApp = appEntries.length === 1 ? asRecord(appEntries[0]) : undefined;
    // A gate command may sit inside the sole app entry OR at the top level of
    // `.operon/config.yaml`. `new-app`'s appendGateCommands writes TOP-LEVEL
    // `setup_command`/`test_command`/`lint_command`, while a hand-written config
    // may nest them under the single app; read the app entry first, then fall
    // back to the top level, so neither placement is silently dead config
    // (W0-ADJ-04). With no app entry (or several), only the top level is read —
    // unchanged from before. Within a source, an explicit `*_command` still
    // wins over the `commands.<x>` map, preserving the prior precedence.
    const sources = soleApp !== undefined ? [soleApp, raw] : [raw];
    const resolveCommand = (explicitKey: string, mapKey: string): string | undefined => {
      for (const source of sources) {
        const explicit = source[explicitKey];
        if (typeof explicit === "string") return explicit;
        const nested = asRecord(source["commands"])?.[mapKey];
        if (typeof nested === "string") return nested;
      }
      return undefined;
    };

    const setup = resolveCommand("setup_command", "install");
    if (setup !== undefined) commands.setupCommand = setup;
    const test = resolveCommand("test_command", "test");
    if (test !== undefined) commands.testCommand = test;
    const lint = resolveCommand("lint_command", "lint");
    if (lint !== undefined) commands.lintCommand = lint;
    const e2e = resolveCommand("e2e_test_command", "e2e");
    if (e2e !== undefined) commands.e2eTestCommand = e2e;
  }
  const pkgPath = join(repoDir, "package.json");
  if (!existsSync(pkgPath)) return commands;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, unknown> };
  return {
    ...commands,
    ...(commands.testCommand === undefined && typeof pkg.scripts?.["test"] === "string"
      ? { testCommand: "npm test" }
      : {}),
    ...(commands.lintCommand === undefined && typeof pkg.scripts?.["lint"] === "string"
      ? { lintCommand: "npm run lint" }
      : {}),
  };
}

/** Resolve commands immediately before a worktree gate runs. A ticket may
 * introduce the app's first test/lint commands, so the pre-claim main clone is
 * not authoritative after Builder has changed `.operon/config.yaml` or
 * `package.json`. Worktree-owned values intentionally override the initial
 * registry snapshot. */
export function gateCommandsForWorktree(
  initial: GateCommands,
  worktree: string | undefined,
): GateCommands {
  if (worktree === undefined) return initial;
  return { ...initial, ...loadGateCommands(worktree) };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Prepare the Operon-managed clone and report the branch ticket work starts
 * from. The remote's advertised default branch is resolved instead of being
 * assumed to be `main`: a stock `git init` repo (no init.defaultBranch) is
 * `master`, and the first tick used to die inside `git fetch origin main`
 * with a raw git error (review L-010). */
function ensureClone(repoSlug: string, repoDir: string): string {
  if (existsSync(join(repoDir, ".git"))) {
    const branch = remoteDefaultBranch(repoDir);
    git(repoDir, "fetch", "origin", branch);
    git(repoDir, "checkout", branch);
    git(repoDir, "reset", "--hard", `origin/${branch}`);
    return branch;
  }
  mkdirSync(dirname(repoDir), { recursive: true });
  git(dirname(repoDir), "clone", `https://github.com/${repoSlug}.git`, repoDir);
  // A fresh clone already sits on the remote's default branch — git resolved
  // the remote HEAD itself; read the answer instead of assuming one.
  return git(repoDir, "symbolic-ref", "--short", "HEAD");
}

/** The default branch origin advertises (`git ls-remote --symref origin
 * HEAD`) — the same resolution bootstrap uses in src/org/app-lifecycle.ts.
 * "Could not ask" and "the remote advertises nothing" (an empty repository)
 * are both loud, actionable errors: guessing `main` here is how a
 * master-default repo crashed the first tick with a raw git stack trace. */
function remoteDefaultBranch(repoDir: string): string {
  let output: string;
  try {
    output = git(repoDir, "ls-remote", "--symref", "origin", "HEAD");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `loop: cannot resolve the default branch of origin for ${repoDir} — ${detail.trim()}`,
    );
  }
  const match = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m.exec(output);
  if (!match?.[1]) {
    throw new Error(
      `loop: origin of ${repoDir} advertises no default branch (empty repository?) — ` +
        "push an initial commit or set the remote HEAD before running the loop",
    );
  }
  return match[1];
}

function snapshotSuppliedCheckout(sourceDir: string, snapshotDir: string): { path: string; head: string } {
  if (!existsSync(join(sourceDir, ".git"))) {
    throw new Error(`loop: --repo-dir is not a git checkout: ${sourceDir}`);
  }
  if (existsSync(snapshotDir)) {
    throw new Error(`loop: supplied-checkout snapshot already exists: ${snapshotDir}`);
  }
  const head = git(sourceDir, "rev-parse", "HEAD");
  let upstream: string | undefined;
  try {
    upstream = git(sourceDir, "remote", "get-url", "origin");
  } catch {
    // A local-only repo can still run; its snapshot origin remains the source.
  }
  mkdirSync(dirname(snapshotDir), { recursive: true });
  git(dirname(snapshotDir), "clone", "--quiet", "--no-hardlinks", sourceDir, snapshotDir);
  git(snapshotDir, "checkout", "--detach", head);
  if (upstream !== undefined) git(snapshotDir, "remote", "set-url", "origin", upstream);
  return { path: snapshotDir, head };
}

function priority(labels: readonly string[]): number {
  if (labels.includes("p1")) return 1;
  if (labels.includes("p2")) return 2;
  if (labels.includes("p3")) return 3;
  return 999;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
