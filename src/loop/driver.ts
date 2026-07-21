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
  advanceReviewing,
  advanceShipping,
  branchNameForIssue,
  claimTicket,
  criterionTestMapFromContractText,
  itemFromIssue,
  parseAcceptanceCriteria,
  rearmDependents,
  type ReviewAuthorization,
} from "./loop.js";
import {
  parkedDigestComment,
  listTicketClaimStates,
  readTicketClaimState,
  rehydrateTicketState,
  type RehydratedState,
} from "./rehydrate.js";
import {
  beginTicketClaim,
  finishTicketClaim,
  markTicketClaimed,
  markTicketProviderStarted,
  rearmCommand,
  recoverClaimException,
  recoverInterruptedClaims,
  type ClaimLease,
} from "./claim-recovery.js";
import {
  baseRevisionForBranch,
  resolveRemoteDefaultBranch,
  type BaseRevision,
} from "./default-branch.js";
import type { PipelinesFile } from "./pipelines.js";
import type { Policy } from "./policy.js";
import { loadPolicy } from "./policy.js";
import type { GateCommands } from "./qgates.js";
import {
  episodeIdFor,
  readRouteRecord,
  type EpisodeTerminal,
} from "./efficiency.js";
import {
  episodeIntentHash,
  episodePlanHash,
  readCurrentEpisodePlan,
  stableHash,
  type CreatorEpisodeScope,
  type EpisodeIntent,
  type EpisodePlan,
} from "./episode-plan.js";
import {
  EPISODE_PLAN_ROUTE_POLICY_VERSION,
  routeAdmissionForEpisodePlan,
} from "./episode-route.js";
import {
  decideExecutionRoute,
  type RouteDecision,
} from "./route-policy.js";
import { parseDependsOn, parseScope, selectReadyTickets, type SchedulableTicket } from "./scheduling.js";
import type { LoopItem, ReleaseConfig, ScorecardEvent } from "./types.js";

export interface LoopPlanItem {
  issueNumber: number;
  title: string;
  phase: LoopItem["phase"];
  tier: LoopItem["tier"];
}

/** Cross-claim recovery is a lifecycle/circuit-breaker bound, not workflow
 * selection. Keep it constant so a legacy `op:tier-*` label cannot grant or
 * remove retries after the accepted EpisodePlan becomes authoritative. */
const DEFAULT_TICKET_CLAIM_ATTEMPTS = 3;

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
  /** Org-owned read-only parity boundary for plan-only ticks. It validates
   * any durable EpisodeIntent against the exact ticket/repository facts the
   * live planner will receive, without constructing an execution engine. */
  ticketInspection?: {
    root: string;
    inspect: TicketEpisodeInspector;
  };
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
  /** The resolved base every phase of this tick works against, instead of an
   *  assumed `main`: the immutable commit captured from a supplied checkout,
   *  or the managed clone's resolved default branch (L-010, #101). Required —
   *  `defaultLoopInputs` produces it, and the driver forwards it into claim,
   *  build, gates, review, ship, and route reassessment. */
  base: BaseRevision;
  /** Integration-test seam for claim saga crash boundaries. Production never
   * sets it; thrown faults must still leave a recoverable ticket. */
  claimFault?: (boundary: ClaimFaultBoundary, issueNumber: number) => void | Promise<void>;
}

export type ClaimFaultBoundary =
  | "after_selection"
  | "after_label_transition"
  | "after_pass_selection"
  | "after_episode_lock"
  | "before_pipeline_start";

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
  /** Org-owned planning boundary. Required on every provider-backed ticket
   * tick; it must persist and route-admit the accepted EpisodePlan before the
   * loop mutates GitHub or creates a worktree. */
  planTicket?: TicketEpisodePlanner;
  /** Org-owned adapter from typed ticket operations to the trustworthy loop
   * mechanics. The loop never falls back to the legacy static pass graph when
   * an execution engine is present. */
  executeTicketPlan?: TicketEpisodeExecutor;
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

/** Immutable ticket facts handed upward to the org-owned EpisodePlanner.
 * The loop deliberately supplies facts rather than a guessed workflow or a
 * quick/standard/deep answer. The callback must durably persist and route-
 * admit the accepted plan before returning. */
export interface TicketEpisodePlanningRequest {
  root: string;
  episodeId: string;
  app: string;
  targetRepo: string;
  localRepo: string;
  base: BaseRevision;
  ticket: {
    issueNumber: number;
    ticketRef: string;
    title: string;
    body: string;
    labels: string[];
  };
  /** Explicit envelope supplied by the human/agent that created this episode.
   * Ordinary GitHub title/body/labels never populate it implicitly. */
  creatorScope?: CreatorEpisodeScope;
}

export interface AcceptedTicketEpisodePlan {
  intent: EpisodeIntent;
  plan: EpisodePlan;
}

export type TicketEpisodePlanner = (
  request: TicketEpisodePlanningRequest,
) => Promise<AcceptedTicketEpisodePlan>;

export type TicketEpisodeInspector = (
  request: TicketEpisodePlanningRequest,
) => Promise<void>;

export interface TicketEpisodeExecutionRequest {
  request: TicketEpisodePlanningRequest;
  accepted: AcceptedTicketEpisodePlan;
  item: LoopItem;
  /** Claim saga boundary invoked immediately before each provider step. */
  beforeProviderTurn: () => Promise<void>;
}

export type TicketEpisodeExecutor = (
  request: TicketEpisodeExecutionRequest,
) => Promise<LoopItem>;

export type TicketEpisodePlanningBoundaryErrorCode =
  | "error_ticket_episode_planner_missing"
  | "error_ticket_episode_executor_missing"
  | "error_ticket_episode_identity_mismatch"
  | "error_ticket_episode_plan_not_persisted"
  | "error_ticket_episode_plan_mismatch"
  | "error_ticket_episode_route_not_admitted"
  | "error_ticket_episode_route_mismatch";

export class TicketEpisodePlanningBoundaryError extends Error {
  constructor(
    readonly code: TicketEpisodePlanningBoundaryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TicketEpisodePlanningBoundaryError";
  }
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
  /** Dependency issue numbers already resolved as MERGED (see
   *  resolveMergedDependencyIds). The live loop fetches only OPEN op:ready
   *  issues, so a merged dependency — CLOSED and unlabeled — is never in
   *  `issues`; without it, selectReadyTickets keeps a dependent whose deps have
   *  all merged permanently blocked (B-LIVE-03 / L-007). Each id not already in
   *  the fetched set is injected as a synthetic `phase: "merged"` ticket so the
   *  pure selection function can clear the dependent's Depends-on. */
  mergedDependencyIds: ReadonlySet<number> = new Set(),
): LoopPlanItem[] {
  const items = issues.map((issue) => itemFromIssue(issue, repo));
  const fetchedIds = new Set(items.map((item) => item.issueNumber));
  const tickets: SchedulableTicket[] = items.map((item) => ({
    id: item.issueNumber,
    phase: item.phase,
    dependsOn: parseDependsOn(item.body),
    scope: parseScope(item.body),
    priority: priority(item.labels),
  }));
  for (const id of mergedDependencyIds) {
    if (!fetchedIds.has(id)) tickets.push({ id, phase: "merged" });
  }
  const selected = selectReadyTickets(tickets, maxConcurrent);
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

/**
 * Org/loop seam for ticket migration to EpisodePlan execution.
 *
 * This function performs no runtime construction and no GitHub mutation. The
 * injected org-layer planner must return only after it has persisted the exact
 * accepted intent/plan and admitted the plan-derived route. A caller can
 * therefore place this boundary before `claimTicket`; missing, forged, or
 * merely in-memory plans fail before the delivery runtime factory is reached.
 *
 * The current ticket state machine still needs a separate adapter that binds
 * typed plan steps to its contract/build/gate/review/ship semantics. Keeping
 * that adapter out of this boundary is intentional: accepting a plan must not
 * quietly authorize the pre-existing static pass graph.
 */
export async function requireAcceptedTicketEpisodePlan(input: {
  request: TicketEpisodePlanningRequest;
  planner?: TicketEpisodePlanner;
}): Promise<AcceptedTicketEpisodePlan> {
  if (input.planner === undefined) {
    throw new TicketEpisodePlanningBoundaryError(
      "error_ticket_episode_planner_missing",
      `ticket episode ${input.request.episodeId} requires an injected EpisodePlanner or explicit creator scope`,
    );
  }
  const expectedEpisodeId = episodeIdFor({
    app: input.request.app,
    ticket: input.request.ticket.ticketRef,
    traceId: input.request.ticket.ticketRef,
  });
  if (
    input.request.episodeId !== expectedEpisodeId ||
    input.request.ticket.ticketRef !== `#${input.request.ticket.issueNumber}`
  ) {
    throw new TicketEpisodePlanningBoundaryError(
      "error_ticket_episode_identity_mismatch",
      `ticket planning request identity does not resolve to ${expectedEpisodeId}`,
    );
  }

  const accepted = await input.planner(structuredClone(input.request));
  if (
    accepted.intent.episodeId !== expectedEpisodeId ||
    accepted.plan.episodeId !== expectedEpisodeId ||
    accepted.intent.app !== input.request.app ||
    accepted.plan.intentHash !== episodeIntentHash(accepted.intent)
  ) {
    throw new TicketEpisodePlanningBoundaryError(
      "error_ticket_episode_identity_mismatch",
      `EpisodePlanner returned authority for a different ticket episode`,
    );
  }

  const persisted = await readCurrentEpisodePlan(
    input.request.root,
    expectedEpisodeId,
  );
  if (persisted === undefined) {
    throw new TicketEpisodePlanningBoundaryError(
      "error_ticket_episode_plan_not_persisted",
      `EpisodePlanner returned before persisting ${expectedEpisodeId}`,
    );
  }
  if (
    episodePlanHash(persisted) !== episodePlanHash(accepted.plan) ||
    persisted.version !== accepted.plan.version
  ) {
    throw new TicketEpisodePlanningBoundaryError(
      "error_ticket_episode_plan_mismatch",
      `current durable plan for ${expectedEpisodeId} differs from the accepted plan`,
    );
  }

  let route: Awaited<ReturnType<typeof readRouteRecord>>;
  try {
    route = await readRouteRecord(input.request.root, expectedEpisodeId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new TicketEpisodePlanningBoundaryError(
        "error_ticket_episode_route_not_admitted",
        `accepted plan for ${expectedEpisodeId} has no durable derived route`,
        { cause: error },
      );
    }
    throw error;
  }
  const expectedRoute = routeAdmissionForEpisodePlan({
    root: input.request.root,
    intent: accepted.intent,
    plan: persisted,
    now: new Date(route.admitted_at),
  });
  const authorizationKey = (pass: (typeof route.authorized_passes)[number]): string =>
    `${pass.pipeline}\0${pass.pass}\0${pass.role}\0${pass.runtime}\0${pass.model}\0${pass.effort}`;
  const actualAuthorizations = [...route.authorized_passes].sort((left, right) =>
    authorizationKey(left).localeCompare(authorizationKey(right)),
  );
  const expectedAuthorizations = [...expectedRoute.passes].sort((left, right) =>
    authorizationKey(left).localeCompare(authorizationKey(right)),
  );
  if (
    route.app !== input.request.app ||
    route.policy_version !== EPISODE_PLAN_ROUTE_POLICY_VERSION ||
    route.planned_route !== persisted.derivedSafetyRoute.label ||
    route.current_route !== persisted.derivedSafetyRoute.label ||
    route.execution_bounds !== null ||
    stableHash(route.factors) !== stableHash(expectedRoute.factors) ||
    stableHash(actualAuthorizations) !== stableHash(expectedAuthorizations)
  ) {
    throw new TicketEpisodePlanningBoundaryError(
      "error_ticket_episode_route_mismatch",
      `durable route for ${expectedEpisodeId} is not the exact projection of EpisodePlan v${persisted.version}`,
    );
  }
  return {
    intent: structuredClone(accepted.intent),
    plan: structuredClone(persisted),
  };
}

/** Resolve which of the given dependency issue numbers are MERGED — not merely
 *  closed. The live loop feeds selection only OPEN op:ready issues, so a merged
 *  dependency (CLOSED, no op:ready label) is never in that set and
 *  selectReadyTickets would keep the dependent blocked forever (B-LIVE-03 /
 *  L-007). Only the specific dependency ids referenced by the fetched
 *  candidates are looked up here — the resolution stays bounded.
 *
 *  Merged, not merely closed (W4-ADJ-05): a dependency closed WITHOUT a merge
 *  must not satisfy a dependent. `rearmDependents` promotes a dependent on the
 *  looser "no longer open" signal; selection is the stricter, authoritative
 *  gate and requires an actual MERGED pull request on the dependency's branch.
 *  The two never contradict — selection only ever admits a subset of what
 *  re-arm would promote — so a closed-without-merge dependency may be re-armed
 *  to op:ready yet is deliberately never run here. */
async function resolveMergedDependencyIds(
  gh: GhOps,
  depIds: Iterable<number>,
): Promise<Set<number>> {
  const merged = new Set<number>();
  for (const id of depIds) {
    let issue: GhIssue;
    try {
      issue = await gh.readIssue(id);
    } catch {
      // Unknown dependency id — fail safe and leave the dependent blocked.
      continue;
    }
    // Still open ⇒ it cannot have merged; a merge closes the issue.
    if (issue.state.toUpperCase() !== "CLOSED") continue;
    // Closed — but only a MERGED PR on its branch proves it merged rather than
    // closed-without-merge. This is the same branch the loop opened the PR on
    // (branchNameForIssue), and the exact signal that distinguishes a delivered
    // dependency from a manually-abandoned one.
    const prs = await gh.listPRsForBranch(branchNameForIssue(issue), { state: "merged" });
    if (prs.some((pr) => pr.state.toUpperCase() === "MERGED")) merged.add(id);
  }
  return merged;
}

function ticketEpisodePlanningRequest(
  options: Pick<LoopDriverOptions, "app" | "repo" | "localRepo" | "base">,
  issue: GhIssue,
  root: string,
): TicketEpisodePlanningRequest {
  return {
    root,
    episodeId: episodeIdFor({
      app: options.app,
      ticket: `#${issue.number}`,
      traceId: `#${issue.number}`,
    }),
    app: options.app,
    targetRepo: options.repo,
    localRepo: options.localRepo,
    base: options.base,
    ticket: {
      issueNumber: issue.number,
      ticketRef: `#${issue.number}`,
      title: issue.title,
      body: issue.body,
      labels: [...issue.labels],
    },
  };
}

export async function runLoopOnce(options: LoopDriverOptions): Promise<LoopDriverResult> {
  const maxConcurrent = options.maxConcurrent ?? 1;
  const lines: string[] = [];
  if (options.engine !== undefined && options.planOnly !== true) {
    const entries = listTicketClaimStates(options.engine.runlogRoot, options.app).map((entry) => ({
      issueNumber: entry.issueNumber,
      state: entry.state,
    }));
    lines.push(
      ...(await recoverInterruptedClaims({
        root: options.engine.runlogRoot,
        app: options.app,
        gh: options.gh,
        entries,
        now: options.engine.clock?.() ?? new Date(),
      })),
    );
  }
  // Budget preflight before ANY claim: an exhausted app cap must stop work
  // before a ticket leaves op:ready, not mid-turn (Stage 1 exit criterion —
  // "a pass that would exceed the app cap does not start").
  if (options.engine?.budgetGuard !== undefined && options.planOnly !== true) {
    const verdict = await options.engine.budgetGuard();
    if (!verdict.allowed) {
      const reason = verdict.reason ?? "app budget exhausted";
      return {
        lines: [...lines, `budget preflight refused the tick: ${reason}`],
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
  // A merged dependency lives OUTSIDE this open op:ready set: a merge CLOSES the
  // issue and strips its op:ready label, so it is never fetched here. Resolve
  // the exact dependency ids the fetched candidates reference but that are
  // absent from the set, so selection can see their merged truth — otherwise a
  // dependent whose dependencies have all merged is permanently unschedulable
  // (B-LIVE-03 / L-007).
  const fetchedIds = new Set(readyIssues.map((issue) => issue.number));
  const unresolvedDepIds = new Set<number>();
  for (const issue of readyIssues) {
    for (const dep of parseDependsOn(issue.body)) {
      if (!fetchedIds.has(dep)) unresolvedDepIds.add(dep);
    }
  }
  const mergedDependencyIds = await resolveMergedDependencyIds(options.gh, unresolvedDepIds);
  const plan = planLoopTick(readyIssues, options.repo, maxConcurrent, mergedDependencyIds);
  lines.push(...plan.map((item) => `#${item.issueNumber} ${item.title}: ready -> claim`));
  if (options.planOnly) {
    if (options.ticketInspection !== undefined) {
      for (const planned of plan) {
        const issue = readyIssues.find((candidate) => candidate.number === planned.issueNumber);
        if (issue === undefined) continue;
        await options.ticketInspection.inspect(ticketEpisodePlanningRequest(
          options,
          issue,
          options.ticketInspection.root,
        ));
      }
    }
    return { lines, items: [], scorecardEvents: [] };
  }

  const items: LoopItem[] = [];
  for (const planned of plan) {
    const issue = readyIssues.find((candidate) => candidate.number === planned.issueNumber);
    if (issue === undefined) continue;

    // Workflow authority is established before the first ticket mutation.
    // Apparent simplicity, tier, title, and labels never imply a bypass; the
    // org-owned planner may skip its provider turn only for an explicit,
    // validated creator scope.
    const ticketEpisodeId = episodeIdFor({
      app: options.app,
      ticket: `#${issue.number}`,
      traceId: `#${issue.number}`,
    });
    const planningRequest: TicketEpisodePlanningRequest | undefined =
      options.engine === undefined
        ? undefined
        : ticketEpisodePlanningRequest(options, issue, options.engine.runlogRoot);
    const acceptedTicketPlan = planningRequest === undefined
      ? undefined
      : await requireAcceptedTicketEpisodePlan({
          request: planningRequest,
          ...(options.engine?.planTicket === undefined
            ? {}
            : { planner: options.engine.planTicket }),
        });

    // Cross-claim accounting + rehydration (Stage 2) — engine path only; the
    // injector path is the simulated M5 state machine and stays blank-slate.
    let rehydrated: RehydratedState | undefined;
    let lease: ClaimLease | undefined;
    if (options.engine !== undefined) {
      const branch = branchNameForIssue(issue);
      rehydrated = await rehydrateTicketState(
        { issueNumber: issue.number, body: issue.body },
        { gh: options.gh, branch },
      );
      const defaultAllowance = options.maxClaims ?? DEFAULT_TICKET_CLAIM_ATTEMPTS;
      const begun = await beginTicketClaim({
        root: options.engine.runlogRoot,
        app: options.app,
        issueNumber: issue.number,
        defaultAllowance,
        now: options.engine.clock?.() ?? new Date(),
      });
      if (!begun.allowed || begun.lease === undefined) {
        // Nothing in the episode ever said "this ticket has bounced N times;
        // stop and summon the human" — this is that stop. Bounded attempts,
        // then park with the assembled evidence (never a bare label flip).
        await options.gh.commentIssue(
          issue.number,
          parkedDigestComment({
            app: options.app,
            issueNumber: issue.number,
            claims: begun.state.claims,
            maxClaims: begun.allowance,
            outcomes: begun.state.outcomes,
            ...(rehydrated.prNumber !== undefined ? { prNumber: rehydrated.prNumber } : {}),
            openFindings: rehydrated.findings,
            hasContract: rehydrated.contract !== undefined,
          }),
        );
        await options.gh.swapLabel(issue.number, "op:ready", "op:returned");
        lines.push(
          `#${issue.number} ${issue.title}: parked after ${begun.state.claims} claims (cap ${begun.allowance}); ` +
            rearmCommand({ app: options.app, issueNumber: issue.number, allowance: begun.allowance }),
        );
        continue;
      }
      lease = begun.lease;
    }

    let item: LoopItem;
    try {
    await options.claimFault?.("after_selection", issue.number);
    item = await claimTicket(issue, {
      gh: options.gh,
      targetRepo: options.repo,
      localRepo: options.localRepo,
      worktreeRoot: options.worktreeRoot,
      base: options.base,
      afterLabelTransition: () => options.claimFault?.("after_label_transition", issue.number),
    });
    if (options.engine !== undefined && lease !== undefined) {
      await markTicketClaimed({
        root: options.engine.runlogRoot,
        app: options.app,
        issueNumber: issue.number,
        claimId: lease.claimId,
      });
    }
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
    if (lease?.continuation !== undefined) {
      const pipeline = lease.continuation.pipeline;
      const resumedPhase: LoopItem["phase"] =
        pipeline === "review" ? "reviewing" : pipeline === "ship" ? "shipping" : "building";
      if (resumedPhase === "reviewing" || resumedPhase === "shipping") {
        await options.gh.swapLabel(item.issueNumber, "op:building", "op:in-review");
        item = {
          ...item,
          labels: item.labels.map((label) => (label === "op:building" ? "op:in-review" : label)),
        };
      }
      item = { ...item, phase: resumedPhase, continuation: lease.continuation };
    }
    await options.claimFault?.("after_pass_selection", issue.number);
    if (options.engine !== undefined) {
      await options.claimFault?.("after_episode_lock", issue.number);
      if (planningRequest === undefined || acceptedTicketPlan === undefined) {
        throw new TicketEpisodePlanningBoundaryError(
          "error_ticket_episode_plan_not_persisted",
          `ticket episode ${ticketEpisodeId} has no accepted execution authority`,
        );
      }
      if (options.engine.executeTicketPlan === undefined) {
        throw new TicketEpisodePlanningBoundaryError(
          "error_ticket_episode_executor_missing",
          `ticket episode ${ticketEpisodeId} requires an injected plan-DAG executor`,
        );
      }
      item = await options.engine.executeTicketPlan({
        request: planningRequest,
        accepted: acceptedTicketPlan,
        item,
        beforeProviderTurn: async () => {
          if (lease === undefined) return;
          await markTicketProviderStarted({
            root: options.engine!.runlogRoot,
            app: options.app,
            issueNumber: issue.number,
            claimId: lease.claimId,
          });
        },
      });
    }
    if (options.engine === undefined) item = await (options.afterClaim?.(item) ?? item);
    await options.claimFault?.("before_pipeline_start", issue.number);
    // Provider-backed execution is exclusively plan-DAG-driven above. This
    // phase loop remains only as the provider-free state-machine harness used
    // by deterministic tests and mechanical simulations.
    if (options.engine === undefined) {
      const criteria = parseAcceptanceCriteria(item.body);
      const criterionTests = item.criterionTests ?? criterionTestMapFromContractText(item.contract);
      let guard = 0;
      while (!["merged", "returned", "blocked"].includes(item.phase)) {
        if (guard++ > 12) {
          throw new Error(`loop driver exceeded phase guard for ${item.ticketRef}`);
        }

        if (item.phase === "building" || item.phase === "gates") {
          item = await advanceGates(item, {
            gh: options.gh,
            policy: options.policy,
            commands: gateCommandsForWorktree(options.commands, item.worktree),
            base: options.base,
            criteria,
            criterionTests,
          });
          continue;
        }

        if (item.phase === "reviewing") {
          await options.injectReview?.(item);
          item = await advanceReviewing(item, {
            gh: options.gh,
            ...(options.authorization !== undefined ? { authorization: options.authorization } : {}),
          });
          continue;
        }

        if (item.phase === "shipping") {
          item = await advanceShipping(item, {
            gh: options.gh,
            localRepo: options.localRepo,
            policy: options.policy,
            commands: gateCommandsForWorktree(options.commands, item.worktree),
            base: options.base,
            criteria,
            criterionTests,
            ...(options.release !== undefined ? { release: options.release } : {}),
          });
          continue;
        }

        break;
      }
    }
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
    if (options.engine !== undefined && lease !== undefined) {
      await finishTicketClaim({
        root: options.engine.runlogRoot,
        app: options.app,
        issueNumber: item.issueNumber,
        claimId: lease.claimId,
        item,
        now: options.engine.clock?.() ?? new Date(),
      });
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
    items.push(item);
    } catch (error) {
      if (options.engine === undefined || lease === undefined) throw error;
      const state = readTicketClaimState(options.engine.runlogRoot, options.app, issue.number);
      if (state.active?.claimId !== lease.claimId) throw error;
      const recovery = await recoverClaimException({
        root: options.engine.runlogRoot,
        app: options.app,
        issueNumber: issue.number,
        claimId: lease.claimId,
        gh: options.gh,
        error,
        now: options.engine.clock?.() ?? new Date(),
      });
      await options.gh.commentIssue(
        issue.number,
        [
          "## Claim recovery",
          "",
          recovery,
          "",
          state.active.phase === "provider_started"
            ? `Review the preserved run/worktree, then use: \`${rearmCommand({
                app: options.app,
                issueNumber: issue.number,
                allowance: state.claimAllowance ?? (options.maxClaims ?? DEFAULT_TICKET_CLAIM_ATTEMPTS),
              })}\``
            : "The next loop tick can claim this ticket normally; no claim allowance was consumed.",
        ].join("\n"),
      );
      lines.push(recovery);
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
  base: BaseRevision;
  policy: Policy;
  commands: GateCommands;
}> {
  let localRepo = repoDir;
  let base: BaseRevision;
  if (options.supplied === true) {
    if (options.snapshotDir === undefined) {
      throw new Error("loop: supplied repo input requires an Operon-owned snapshot directory");
    }
    const prepared = snapshotSuppliedCheckout(repoDir, options.snapshotDir);
    localRepo = prepared.path;
    // A supplied checkout is pinned at an immutable commit, so that SHA is
    // what ticket branches cut from and gates diff against. It has no branch
    // identity of its own, but a pull request still needs a merge target, so
    // the default branch is resolved from the *supplied checkout's own*
    // origin. Deliberately not from a synthesized github.com URL: that would
    // put a network call on a path that has none, and the operator's checkout
    // already points at the app repo. Either way the answer comes from git.
    base = {
      ref: prepared.head,
      defaultBranch: suppliedCheckoutDefaultBranch(repoDir),
    };
  } else {
    // The managed clone's resolved default branch (not an assumed `main`)
    // becomes the base every ticket branch and gate diff starts from.
    base = ensureClone(repoSlug, repoDir);
  }
  return {
    gh: new GhCliOps(repoSlug, undefined, process.env["OPERON_SELF_APPROVAL_SECRET"]),
    localRepo,
    base,
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

/** Historical, non-authoritative compatibility projection for legacy ticket
 *  artifacts and their tests. EpisodePlan validation is the sole workflow and
 *  safety authority for live ticket execution; this helper must not be used to
 *  admit, mutate, or execute a route. */
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

export function githubRemoteUrl(repoSlug: string): string {
  return `https://github.com/${repoSlug}.git`;
}

/** The merge target for work built on an operator-supplied checkout.
 *
 *  Normally the default branch the checkout's own `origin` advertises. The
 *  ONLY accepted substitute is for a checkout with no `origin` configured at
 *  all — which `snapshotSuppliedCheckout` explicitly supports — where the
 *  branch that checkout is on is the best available answer and there is no
 *  remote to disagree with it.
 *
 *  The "no origin configured" test is deliberately separate from "resolution
 *  failed". Falling back on ANY `ls-remote` error would mean a DNS blip or an
 *  expired credential silently retargets pull requests at whatever branch the
 *  operator happens to have checked out — a wrong merge target that looks
 *  like success. A reachable-but-unresolvable remote is a loud failure, per
 *  the doctrine in src/loop/default-branch.ts. */
function suppliedCheckoutDefaultBranch(sourceDir: string): string {
  let hasOrigin: boolean;
  try {
    git(sourceDir, "remote", "get-url", "origin");
    hasOrigin = true;
  } catch {
    hasOrigin = false;
  }

  if (hasOrigin) {
    // A configured remote is authoritative. If it cannot be resolved, that is
    // an error to surface, never a reason to guess.
    return resolveRemoteDefaultBranch("origin", { cwd: sourceDir, errorPrefix: "loop" });
  }

  try {
    return git(sourceDir, "symbolic-ref", "--short", "HEAD");
  } catch (error) {
    // Detached HEAD with no remote: there is genuinely no branch to name, and
    // inventing one is the defect this workstream removed.
    throw new Error(
      `loop: --repo-dir checkout ${sourceDir} has no origin remote and is not on a branch, ` +
        `so there is no merge target to resolve — ` +
        `${error instanceof Error ? error.message.trim() : String(error)}`,
    );
  }
}

/** Prepare the Operon-managed clone and report the base ticket work starts
 * from. The remote's advertised default branch is resolved instead of being
 * assumed to be `main`: a stock `git init` repo (no init.defaultBranch) is
 * `master`, and the first tick used to die inside `git fetch origin main`
 * with a raw git error (review L-010, #101). */
function ensureClone(repoSlug: string, repoDir: string): BaseRevision {
  if (existsSync(join(repoDir, ".git"))) {
    const branch = resolveRemoteDefaultBranch("origin", { cwd: repoDir, errorPrefix: "loop" });
    git(repoDir, "fetch", "origin", branch);
    git(repoDir, "checkout", branch);
    git(repoDir, "reset", "--hard", `origin/${branch}`);
    return baseRevisionForBranch(branch);
  }
  mkdirSync(dirname(repoDir), { recursive: true });
  git(dirname(repoDir), "clone", githubRemoteUrl(repoSlug), repoDir);
  // A fresh clone already sits on the remote's default branch — git resolved
  // the remote HEAD itself; read the answer instead of assuming one.
  return baseRevisionForBranch(git(repoDir, "symbolic-ref", "--short", "HEAD"));
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
