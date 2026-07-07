// Manual build-loop tick driver (M5.9). The autonomous dispatcher later
// calls the same phase functions; this file is the thin "advance ready
// tickets once" wrapper for CLI and sandbox e2e use.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import type { ContextBundle, RoleConfig, Runtime, TurnHooks } from "../runtime/types.js";
import type { GhIssue, GhOps } from "./github.js";
import { GhCliOps } from "./github.js";
import {
  advanceGates,
  advanceReviewing,
  advanceShipping,
  claimTicket,
  defaultCriterionTests,
  itemFromIssue,
  parseAcceptanceCriteria,
  runBuilderPipeline,
  runReviewPipeline,
  runShipCheckPipeline,
  type ReviewAuthorization,
} from "./loop.js";
import type { LoopRunlog } from "./loop-runlog.js";
import type { PipelinesFile } from "./pipelines.js";
import type { Policy } from "./policy.js";
import { loadPolicy } from "./policy.js";
import type { GateCommands } from "./qgates.js";
import { parseDependsOn, parseScope, selectReadyTickets } from "./scheduling.js";
import type { LoopItem, ScorecardEvent } from "./types.js";

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
  /** Merge-authorization policy for the reviewing phase (self-approval secret,
   *  builder/reviewer identities). Passed through to advanceReviewing so a
   *  forged/self-authored approval cannot merge. */
  authorization?: ReviewAuthorization;
}

export interface LoopEngineOptions {
  pipelines: PipelinesFile;
  roles: Record<string, RoleConfig>;
  runtimeFor: (role: RoleConfig) => Runtime;
  promptsDir: string;
  runlogRoot: string;
  hooks: TurnHooks;
  context?: ContextBundle;
  clock?: () => Date;
}

export interface LoopDriverResult {
  lines: string[];
  items: LoopItem[];
  scorecardEvents: ScorecardEvent[];
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
    let item = await claimTicket(issue, {
      gh: options.gh,
      targetRepo: options.repo,
      localRepo: options.localRepo,
      worktreeRoot: options.worktreeRoot,
    });
    if (options.turnId !== undefined) item = { ...item, turnId: options.turnId };
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
          item = await runBuilderPipeline(item, {
            ...enginePhaseOptions(options),
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
          commands: options.commands,
          criteria,
          criterionTests,
          ...(options.engine !== undefined
            ? {
                remediate: (current, result) =>
                  runBuilderPipeline(current, {
                    ...enginePhaseOptions(options),
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
          commands: options.commands,
          criteria,
          criterionTests,
          ...(options.engine !== undefined
            ? {
                remediate: (current, result) =>
                  runBuilderPipeline(current, {
                    ...enginePhaseOptions(options),
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
          item = await runReviewPipeline(item, enginePhaseOptions(options));
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
          item = await runShipCheckPipeline(item, enginePhaseOptions(options));
          if (item.phase !== "shipping") continue;
        }
        item = await advanceShipping(item, {
          gh: options.gh,
          localRepo: options.localRepo,
          policy: options.policy,
          commands: options.commands,
          criteria,
          criterionTests,
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
        commands: options.commands,
        criteria,
        criterionTests,
      });
    }
    items.push(item);
  }
  return { lines, items, scorecardEvents: items.flatMap((item) => item.scorecardEvents ?? []) };
}

export async function defaultLoopInputs(repoSlug: string, repoDir: string): Promise<{
  gh: GhOps;
  localRepo: string;
  policy: Policy;
  commands: GateCommands;
}> {
  ensureClone(repoSlug, repoDir);
  return {
    gh: new GhCliOps(repoSlug, undefined, process.env["OPERON_SELF_APPROVAL_SECRET"]),
    localRepo: repoDir,
    policy: await loadRequiredPolicy(join(repoDir, ".operon", "policy.yaml")),
    commands: loadGateCommands(repoDir),
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

function enginePhaseOptions(options: LoopDriverOptions) {
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
    commands: options.commands,
    hooks: engine.hooks,
    ...(engine.context !== undefined ? { context: engine.context } : {}),
    ...(engine.clock !== undefined ? { clock: engine.clock } : {}),
    ...(options.authorization !== undefined ? { authorization: options.authorization } : {}),
  };
}

export function loadGateCommands(repoDir: string): GateCommands {
  const commands: GateCommands = {};
  const configPath = join(repoDir, ".operon", "config.yaml");
  if (existsSync(configPath)) {
    const raw = parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    if (typeof raw["test_command"] === "string") commands.testCommand = raw["test_command"];
    if (typeof raw["lint_command"] === "string") commands.lintCommand = raw["lint_command"];
    if (typeof raw["e2e_test_command"] === "string") {
      commands.e2eTestCommand = raw["e2e_test_command"];
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
