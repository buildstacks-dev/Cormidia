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
  defaultCriterionTests,
  itemFromIssue,
  parseAcceptanceCriteria,
  runBuilderPipeline,
  runReviewPipeline,
  runShipCheckPipeline,
  type ReviewAuthorization,
} from "./loop.js";
import {
  parkedDigestComment,
  readTicketClaimState,
  rehydrateTicketState,
  writeTicketClaimState,
  type RehydratedState,
} from "./rehydrate.js";
import { runEnvPreflight } from "./preflight.js";
import type { LoopRunlog } from "./loop-runlog.js";
import type { PipelinesFile } from "./pipelines.js";
import type { Policy } from "./policy.js";
import { loadPolicy } from "./policy.js";
import type { GateCommands } from "./qgates.js";
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
  /** Immutable commit/ref captured from a supplied checkout. Ticket branches
   * start here instead of assuming `main`. */
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
}

export interface LoopDriverResult {
  lines: string[];
  items: LoopItem[];
  scorecardEvents: ScorecardEvent[];
  /** Set when budgetGuard refused the tick before any claim. */
  budgetRefusal?: string;
}

const DEFAULT_MAX_CLAIMS = 3;

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
  const maxClaims = options.maxClaims ?? DEFAULT_MAX_CLAIMS;
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
    if (options.engine === undefined) {
      item = await (options.afterClaim?.(item) ?? item);
    }

    const criteria = parseAcceptanceCriteria(item.body);
    const criterionTests = defaultCriterionTests(criteria, "loop-driver");
    let guard = 0;
    while (!["merged", "returned", "blocked"].includes(item.phase)) {
      if (guard++ > 12) {
        throw new Error(`loop driver exceeded phase guard for ${item.ticketRef}`);
      }

      if (item.phase === "building") {
        if (options.engine !== undefined) {
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
            ...enginePhaseOptions(options, item.worktree),
            pipelineName:
              item.cycles > 0 || item.findings.length > 0 || item.rebaseNote !== undefined
                ? "fix"
                : "build",
          });
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
                  runBuilderPipeline(current, {
                    ...enginePhaseOptions(options, current.worktree),
                    pipelineName: "fix",
                    gateResult: result,
                  }),
                runlog: gateRunlog(options, item),
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
                  runBuilderPipeline(current, {
                    ...enginePhaseOptions(options, current.worktree),
                    pipelineName: "fix",
                    gateResult: result,
                  }),
                runlog: gateRunlog(options, item),
              }
            : {}),
        });
        continue;
      }

      if (item.phase === "reviewing") {
        if (options.engine !== undefined) {
          item = await runReviewPipeline(item, enginePhaseOptions(options, item.worktree));
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
          item = await runShipCheckPipeline(item, enginePhaseOptions(options, item.worktree));
          if (item.phase !== "shipping") continue;
        }
        item = await advanceShipping(item, {
          gh: options.gh,
          localRepo: options.localRepo,
          policy: options.policy,
          commands: gateCommandsForWorktree(options.commands, item.worktree),
          criteria,
          criterionTests,
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
    if (options.engine !== undefined) {
      // Append this claim's outcome to the cross-claim record — it is the
      // evidence the park digest shows the human after the claim cap.
      const claimState = readTicketClaimState(options.engine.runlogRoot, options.app, item.issueNumber);
      claimState.outcomes = [
        ...claimState.outcomes.slice(-9),
        `claim ${claimState.claims}: ended ${item.phase}${item.prNumber !== undefined ? ` (PR #${item.prNumber})` : ""}`,
      ];
      writeTicketClaimState(options.engine.runlogRoot, options.app, item.issueNumber, claimState);
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
    ensureClone(repoSlug, repoDir);
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
    ...(engine.clock !== undefined ? { clock: engine.clock } : {}),
  };
}

function enginePhaseOptions(options: LoopDriverOptions, worktree?: string) {
  const engine = options.engine;
  if (engine === undefined) throw new Error("loop driver: engine options missing");
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
    ...(options.authorization !== undefined ? { authorization: options.authorization } : {}),
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
    const source = soleApp ?? raw;
    const commandMap = asRecord(source["commands"]);

    if (typeof source["setup_command"] === "string") {
      commands.setupCommand = source["setup_command"];
    } else if (typeof commandMap?.["install"] === "string") {
      commands.setupCommand = commandMap["install"];
    }
    if (typeof source["test_command"] === "string") {
      commands.testCommand = source["test_command"];
    } else if (typeof commandMap?.["test"] === "string") {
      commands.testCommand = commandMap["test"];
    }
    if (typeof source["lint_command"] === "string") {
      commands.lintCommand = source["lint_command"];
    } else if (typeof commandMap?.["lint"] === "string") {
      commands.lintCommand = commandMap["lint"];
    }
    if (typeof source["e2e_test_command"] === "string") {
      commands.e2eTestCommand = source["e2e_test_command"];
    } else if (typeof commandMap?.["e2e"] === "string") {
      commands.e2eTestCommand = commandMap["e2e"];
    }
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

function ensureClone(repoSlug: string, repoDir: string): void {
  if (existsSync(join(repoDir, ".git"))) {
    git(repoDir, "fetch", "origin", "main");
    git(repoDir, "checkout", "main");
    git(repoDir, "reset", "--hard", "origin/main");
    return;
  }
  mkdirSync(dirname(repoDir), { recursive: true });
  git(dirname(repoDir), "clone", `https://github.com/${repoSlug}.git`, repoDir);
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
