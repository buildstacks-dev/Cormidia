// `cormidia loop --app <app> [--once|--follow] [--dry-run] [--allow-network]`
// for the build-loop state machine (M5.9).

import { join } from "node:path";
import { defaultGate } from "../runtime/gate.js";
import type { GateFn, RoleConfig, TurnAssignment } from "../runtime/types.js";
import { getRuntime } from "../runtime/registry.js";
import { defaultLoopInputs, runLoopOnce, type LoopDriverResult } from "../loop/driver.js";
import { EPISODE_PLAN_EXECUTION_PIPELINE } from "../loop/episode-route.js";
import { loadPipelines } from "../loop/pipelines.js";
import { finalizeEpisode } from "../loop/efficiency.js";
import type { ScorecardEvent as LoopScorecardEvent } from "../loop/types.js";
import { loadApps, runtimePolicyForApp } from "../org/apps.js";
import { resolveAppRoles } from "../org/app-execution-policy.js";
import { assembleContext, createEpisodeContextResolver } from "../org/context.js";
import { loadRoles } from "../org/roles.js";
import { appendScorecardEvent } from "../org/scorecards.js";
import { ApprovalStore } from "../org/approvals.js";
import { enforceBudgetOverlay, isBudgetBlocking, raiseTurnBudgetEscalation, rollupBudgets } from "../org/budget.js";
import { createTicketEpisodeRuntime, inspectTicketEpisodeInvocation } from "../org/ticket-episode-runtime.js";
import { createExistingTicketApprovalHandler } from "../org/ticket-episode-approval.js";
import { createRoadmapLoopRuntime } from "../org/roadmap-loop-runtime.js";
import { queueReleaseApprovals } from "../org/release.js";
import { composeGate } from "../org/gate-compose.js";
import { resolveCormidiaHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";
import { installProcessCancellation, waitForDelay } from "./process-signal.js";
import { resolveParentTaskId } from "../org/parent-task.js";
import { explainContext } from "../loop/context-manifest.js";
import { resumeExecutionJournal } from "../loop/execution-journal.js";
import { cmdClaimRearm } from "./claim-rearm.js";
import { resolveReviewAuthorizationSecret } from "../org/review-authorization-secret.js";
import { reportCliInvocation } from "./invocation-audit.js";

export function loopInvocationOutcome(result: LoopDriverResult, dryRun = false): string {
  if (result.budgetRefusal !== undefined) return `budget-refused: ${result.budgetRefusal}`;
  if (dryRun) {
    const previewed = result.itemsPreviewed ?? 0;
    return previewed > 0 ? `would-claim: ${previewed}` : "no-ready-tickets";
  }
  return (
    [
      ...(result.terminalEpisodeRefusals ?? []).map(
        (refusal) =>
          `terminal-episode-refused: #${refusal.issueNumber}=${refusal.episodeId} ` +
          `(${refusal.status}: ${refusal.reason}); repaired to op:returned`,
      ),
      ...result.items.map((item) => `${item.ticketRef}=${item.phase}${episodeReplanOutcome(item)}`),
    ].join(", ") || "no-ready-tickets"
  );
}

export function loopDriverExitCode(result: LoopDriverResult): 0 | 1 {
  return result.budgetRefusal !== undefined || (result.terminalEpisodeRefusals?.length ?? 0) > 0 ? 1 : 0;
}

/**
 * Persist the scorecard events one loop tick produced into the org scorecard
 * ledger, mirroring the autonomous dispatch path (org/turn-runner.ts). Without
 * this the manual `cormidia loop` driver dropped every scorecard event, so
 * `cormidia retro` was blind to the real build loop — it only ever saw the
 * dispatched-turn path. review_cycles is attributed to the builder (it counts
 * the rework cycles the builder needed before the ticket merged). Returns the
 * number of newly-appended rows (dedupe drops replays).
 */
export async function persistLoopScorecards(
  orgHome: string,
  app: string,
  events: readonly LoopScorecardEvent[],
  now: Date = new Date(),
): Promise<number> {
  let appended = 0;
  for (const event of events) {
    const result = await appendScorecardEvent(
      orgHome,
      {
        type: event.type,
        app,
        role: "builder",
        turnId: event.turnId,
        ticketRef: event.ticketRef,
        value: event.value,
      },
      now,
    );
    if (result.appended) appended += 1;
  }
  return appended;
}

/** Manual `cormidia loop` must use the same durable approval boundary as the
 * autonomous dispatcher. The previous raw defaultGate wiring denied critical
 * actions but never created an approval item, leaving tickets stranded with
 * no possible `cormidia approvals review` recovery path. */
export function createLoopGateForRole(
  stateHome: string,
  app: string,
  turnId: string,
  orgHome?: string,
  store: ApprovalStore = new ApprovalStore(stateHome),
  workdir?: string,
  /** §5.3/§5.4 (#296): the app's configured repo and egress allowlist. Without
   *  them collaboration actions fail closed to repo-collaboration-foreign and
   *  the egress allowlist falls back to the ratified default. */
  appConfig?: { repo: string; networkAllowlist?: readonly string[] },
): (role: RoleConfig, passWorkdir?: string) => GateFn {
  return (role, passWorkdir) => {
    // The executor running the pass knows its sandbox cwd; this call site only
    // knows the managed clone. A builder ticket pass runs in the per-ticket
    // worktree, so preferring the caller's cwd is what makes the recorded
    // approval workdir the tree the action was actually raised from.
    const cwd = passWorkdir ?? workdir;
    return composeGate(defaultGate, store, {
      app,
      role: role.name,
      turnId,
      ...(orgHome !== undefined ? { orgHome } : {}),
      ...(cwd !== undefined ? { workdir: cwd } : {}),
      ...(appConfig !== undefined ? { appRepo: appConfig.repo } : {}),
      ...(appConfig?.networkAllowlist !== undefined ? { networkAllowlist: appConfig.networkAllowlist } : {}),
    });
  };
}

export interface ParsedLoopRunArgs {
  appName?: string;
  once: boolean;
  follow: boolean;
  dryRun: boolean;
  repoDir?: string;
  worktreeRoot?: string;
  allowNetwork: boolean;
  parentTaskInput?: string;
  explainEpisode?: string;
  resumeEpisode?: string;
}

/** Pure parser shared by the executable loop and generated-guidance
 * conformance tests. It performs no GitHub read and constructs no runtime. */
export function parseLoopRunArgs(args: string[]): ParsedLoopRunArgs {
  let appName: string | undefined;
  let once = false;
  let follow = false;
  let dryRun = false;
  let repoDir: string | undefined;
  let worktreeRoot: string | undefined;
  let allowNetwork = false;
  let parentTaskInput: string | undefined;
  let explainEpisode: string | undefined;
  let resumeEpisode: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--app") {
      appName = needValue(args, ++i, "--app");
    } else if (arg === "--once") {
      once = true;
    } else if (arg === "--follow") {
      follow = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--repo-dir") {
      repoDir = needValue(args, ++i, "--repo-dir");
    } else if (arg === "--worktree-root") {
      worktreeRoot = needValue(args, ++i, "--worktree-root");
    } else if (arg === "--allow-network") {
      allowNetwork = true;
    } else if (arg === "--parent-task") {
      parentTaskInput = needValue(args, ++i, "--parent-task");
    } else if (arg === "--explain-context") {
      explainEpisode = needValue(args, ++i, "--explain-context");
    } else if (arg === "--resume-episode") {
      resumeEpisode = needValue(args, ++i, "--resume-episode");
    } else {
      throw new Error(`loop: unknown flag "${arg}"`);
    }
  }

  return {
    once,
    follow,
    dryRun,
    allowNetwork,
    ...(appName !== undefined ? { appName } : {}),
    ...(repoDir !== undefined ? { repoDir } : {}),
    ...(worktreeRoot !== undefined ? { worktreeRoot } : {}),
    ...(parentTaskInput !== undefined ? { parentTaskInput } : {}),
    ...(explainEpisode !== undefined ? { explainEpisode } : {}),
    ...(resumeEpisode !== undefined ? { resumeEpisode } : {}),
  };
}

export async function cmdLoop(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "loop");
  args = common.rest;
  if (args[0] === "rearm") {
    return cmdClaimRearm(args.slice(1), await resolveCormidiaHomes(common));
  }
  const parsed = parseLoopRunArgs(args);
  const { appName, dryRun, repoDir, worktreeRoot, allowNetwork, parentTaskInput, explainEpisode, resumeEpisode } =
    parsed;
  let { once, follow } = parsed;

  const homes = await resolveCormidiaHomes(common);
  if (explainEpisode !== undefined) {
    if (
      resumeEpisode !== undefined ||
      appName !== undefined ||
      once ||
      follow ||
      dryRun ||
      repoDir !== undefined ||
      worktreeRoot !== undefined ||
      allowNetwork
    ) {
      throw new Error("loop: --explain-context is a token-free standalone read");
    }
    console.log(JSON.stringify(await explainContext(homes.stateHome, explainEpisode), null, 2));
    return 0;
  }
  if (resumeEpisode !== undefined) {
    if (
      appName !== undefined ||
      once ||
      follow ||
      dryRun ||
      repoDir !== undefined ||
      worktreeRoot !== undefined ||
      allowNetwork
    ) {
      throw new Error("loop: --resume-episode is a standalone durable-boundary read");
    }
    // L-005: this flag is a read-only PREVIEW of the durable resume plan — it
    // does not execute the resume. Say so plainly so an operator does not
    // believe work happened. Actual continuation is `cormidia loop --app <app>`,
    // which claims the ticket and resumes from these durable artifacts. The
    // JSON carries an explicit `preview: true` for machine readers, and the
    // human-facing note goes to stderr so stdout stays parseable.
    const decision = await resumeExecutionJournal({
      root: homes.stateHome,
      episodeId: resumeEpisode,
      now: new Date(),
    });
    console.error(
      "loop: --resume-episode is a read-only preview of the durable resume plan; it does not execute. " +
        "Continue the ticket with `cormidia loop --app <app>`, which resumes from these artifacts.",
    );
    console.log(JSON.stringify({ preview: true, resume: decision }, null, 2));
    return 0;
  }
  if (appName === undefined) throw new Error("loop: --app <app> is required");
  if (!once && !follow) once = true;
  if (once && follow) throw new Error("loop: choose either --once or --follow, not both");

  const parentTaskId = await resolveParentTaskId(homes.stateHome, parentTaskInput);
  const appsPath = join(homes.orgHome, "apps.yaml");
  const rolesPath = join(homes.orgHome, "roles.yaml");
  const pipelinesPath = join(homes.orgHome, "pipelines.yaml");
  const appsFile = await loadApps(appsPath);
  const app = appsFile.apps.find((entry) => entry.name === appName);
  if (app === undefined) throw new Error(`loop: unknown app "${appName}" in apps.yaml`);
  const selectedApp = app;

  const localRepo = repoDir ?? join(homes.stateHome, "repos", selectedApp.name);
  const worktrees = worktreeRoot ?? join(homes.stateHome, "worktrees", selectedApp.name);
  const selfApprovalSecret = await resolveReviewAuthorizationSecret(homes.stateHome, {
    ...(process.env["CORMIDIA_SELF_APPROVAL_SECRET"] === undefined
      ? {}
      : { environmentSecret: process.env["CORMIDIA_SELF_APPROVAL_SECRET"] }),
    dryRun,
  });
  const inputs = await defaultLoopInputs(selectedApp.repo, localRepo, {
    ...(repoDir !== undefined
      ? {
          supplied: true,
          snapshotDir: join(homes.stateHome, "repos", "snapshots", selectedApp.name, `${Date.now()}-${process.pid}`),
        }
      : {}),
    ...(selfApprovalSecret === undefined ? {} : { selfApprovalSecret }),
  });
  const rolesFile = await loadRoles(rolesPath);
  const configuredRoles = resolveAppRoles(rolesFile.roles, runtimePolicyForApp(selectedApp));
  const roles = Object.fromEntries(configuredRoles.map((role) => [role.name, role]));
  const maybeBuilderRole = roles["builder"];
  if (maybeBuilderRole === undefined) throw new Error("loop: roles.yaml has no builder role");
  const builderRole = maybeBuilderRole;
  const promptsDir = join(homes.orgHome, "prompts");
  const pipelines = await loadPipelines(pipelinesPath, {
    roleNames: rolesFile.roles.map((role) => role.name),
    promptsDir,
  });

  let sawBudgetRefusal = false;
  let sawTerminalEpisodeRefusal = false;
  let accumulatedLoopExitCode: 0 | 1 = 0;
  let itemsClaimed = 0;
  let itemsPreviewed = 0;
  const invocationOutcomes: string[] = [];
  const cancellation = dryRun ? undefined : installProcessCancellation();

  async function tick(): Promise<void> {
    // Stamp a turn id on this tick so claimed items carry one — the loop only
    // emits scorecard events for items with a turnId (loop.ts), and this is the
    // attribution/dedupe key the org scorecard ledger records under.
    const turnId = `loop-${selectedApp.name}-${Date.now()}`;
    let liveEngine: NonNullable<Parameters<typeof runLoopOnce>[0]["engine"]> | undefined;
    let ticketInspection: NonNullable<Parameters<typeof runLoopOnce>[0]["ticketInspection"]> | undefined;
    let deliveryUnits: NonNullable<Parameters<typeof runLoopOnce>[0]["deliveryUnits"]> | undefined;
    if (dryRun) {
      // Preview must not call the mutating budget overlay. The read-only
      // rollup yields the same current remainder used to build live ticket
      // facts, while persisted episodes retain their original hard ceiling.
      const budgetRows = await rollupBudgets(homes.stateHome, appsFile);
      const budgetRow = budgetRows.find((row) => row.app === selectedApp.name);
      if (budgetRow === undefined) {
        throw new Error(`loop: could not resolve the app budget for ${selectedApp.name}`);
      }
      const remainingBudgetUsd = Math.max(0, budgetRow.budgetUsd - budgetRow.spentUsd);
      ticketInspection = {
        root: homes.stateHome,
        inspect: async (request) => {
          await inspectTicketEpisodeInvocation(
            {
              root: homes.stateHome,
              app: selectedApp,
              roles: configuredRoles,
              remainingBudgetUsd,
            },
            request,
          );
        },
      };
      deliveryUnits = createRoadmapLoopRuntime({
        root: homes.stateHome,
        app: selectedApp,
        gh: inputs.gh,
      });
    }
    if (!dryRun) {
      const plannerRole = roles["planner"];
      if (plannerRole === undefined) {
        throw new Error("loop: roles.yaml has no planner role for ticket EpisodePlanner boot");
      }
      const approvalStore = new ApprovalStore(homes.stateHome);
      const gateForRole = createLoopGateForRole(
        homes.stateHome,
        selectedApp.name,
        turnId,
        homes.orgHome,
        approvalStore,
        localRepo,
        {
          repo: selectedApp.repo,
          ...(selectedApp.networkAllowlist !== undefined ? { networkAllowlist: selectedApp.networkAllowlist } : {}),
        },
      );
      const budgetRows = await enforceBudgetOverlay(homes.stateHome, appsFile);
      const budgetRow = budgetRows.find((row) => row.app === selectedApp.name);
      if (budgetRow === undefined) {
        throw new Error(`loop: could not resolve the app budget for ${selectedApp.name}`);
      }
      const remainingBudgetUsd = Math.max(0, budgetRow.budgetUsd - budgetRow.spentUsd);
      const fallbackContext = (
        await assembleContext({
          orgHome: homes.orgHome,
          appWorkdir: localRepo,
          app: selectedApp.name,
          role: builderRole,
          taskText: `build loop for ${selectedApp.name}`,
        })
      ).bundle;
      const plannerContext = (
        await assembleContext({
          orgHome: homes.orgHome,
          appWorkdir: localRepo,
          app: selectedApp.name,
          role: plannerRole,
          taskText: `plan bounded ticket delivery for ${selectedApp.name}`,
        })
      ).bundle;
      const resolveEpisodeContext = createEpisodeContextResolver({
        orgHome: homes.orgHome,
        appWorkdir: localRepo,
        app: selectedApp.name,
        roles,
        stateHome: homes.stateHome,
        turnId,
      });
      const runtimeForAssignment = (assignment: TurnAssignment) => getRuntime(assignment.harness);
      const ticketEpisode = createTicketEpisodeRuntime({
        root: homes.stateHome,
        orgRoot: homes.orgHome,
        app: selectedApp,
        roles: configuredRoles,
        gh: inputs.gh,
        policy: inputs.policy,
        commands: inputs.commands,
        hooks: { gate: defaultGate },
        runtimeForAssignment,
        plannerContext,
        contextForProviderStep: async ({ item, role }) =>
          (await resolveEpisodeContext(item, EPISODE_PLAN_EXECUTION_PIPELINE, role.name)) ?? fallbackContext,
        remainingBudgetUsd,
        gateForRole,
        approval: createExistingTicketApprovalHandler({
          store: approvalStore,
          app: selectedApp.name,
          roleNames: configuredRoles.map((role) => role.name),
        }),
        raiseTurnBudgetEscalation: (escalation) => raiseTurnBudgetEscalation(approvalStore.root, escalation),
        ...(selfApprovalSecret === undefined
          ? {}
          : {
              authorization: {
                selfApprovalSecret,
              },
            }),
        ...(selectedApp.release === undefined ? {} : { release: selectedApp.release }),
        telemetry: { orgDir: homes.stateHome, trigger: "manual" },
        ...(parentTaskId === undefined ? {} : { parentTaskId }),
        ...(allowNetwork ? { networkAccess: true } : {}),
        ...(cancellation === undefined ? {} : { signal: cancellation.signal }),
      });
      deliveryUnits = ticketEpisode.deliveryUnits;
      liveEngine = {
        pipelines,
        roles,
        runtimeFor: (role) => getRuntime(role.runtime),
        promptsDir,
        runlogRoot: homes.stateHome,
        hooks: { gate: defaultGate },
        gateForRole,
        context: fallbackContext,
        // One governed resolve per (ticket episode, plan role), pinned for
        // the tick. The accepted plan, rather than a static pipeline name,
        // now owns the execution sequence.
        contextFor: resolveEpisodeContext,
        planTicket: ticketEpisode.planTicket,
        executeTicketPlan: ticketEpisode.executeTicketPlan,
        ...(allowNetwork ? { networkAccess: true } : {}),
        telemetry: { orgDir: homes.stateHome, trigger: "manual" },
        onEpisodeTerminal: async (terminal) => {
          await finalizeEpisode({
            root: homes.stateHome,
            episodeId: terminal.episodeId,
            status: terminal.status,
            reason: terminal.reason,
            ...(terminal.nextStep !== undefined ? { nextStep: terminal.nextStep } : {}),
            now: terminal.now,
          });
        },
        ...(cancellation !== undefined ? { signal: cancellation.signal } : {}),
        ...(parentTaskId !== undefined ? { parentTaskId } : {}),
        budgetGuard: async () => {
          if (isBudgetBlocking(budgetRow.status)) {
            return {
              allowed: false,
              reason:
                budgetRow.status === "unknown"
                  ? `${budgetRow.app} budget total could not be computed this month ` +
                    `(malformed ledger row) — refusing to spend; run ` +
                    `\`cormidia budget --reconcile\` to repair the ledger`
                  : `${budgetRow.app} spent $${budgetRow.spentUsd.toFixed(2)} of its ` +
                    `$${budgetRow.budgetUsd.toFixed(2)} monthly cap — raise the cap in apps.yaml ` +
                    `or wait for the month to reset`,
            };
          }
          return { allowed: true };
        },
      };
    }
    const result = await runLoopOnce({
      app: selectedApp.name,
      repo: selectedApp.repo,
      gh: inputs.gh,
      localRepo: inputs.localRepo,
      worktreeRoot: worktrees,
      policy: inputs.policy,
      commands: inputs.commands,
      maxConcurrent: appsFile.org.maxConcurrentTurns,
      turnId,
      base: inputs.base,
      // `inputs` is built once per invocation, but `--follow` ticks for hours
      // and merges land in the default branch while it runs. Forwarding the
      // refresher makes the driver re-resolve per claim instead of reusing
      // this startup snapshot (#203). Absent for `--repo-dir`, whose base is
      // an immutable commit.
      ...(inputs.refreshBase === undefined ? {} : { refreshBase: inputs.refreshBase }),
      planOnly: dryRun,
      ...(ticketInspection === undefined ? {} : { ticketInspection }),
      ...(selectedApp.release !== undefined ? { release: selectedApp.release } : {}),
      // Merge authorization: the self-approval fallback must carry an HMAC tag
      // signed with this operator secret (never repo-visible). Without it, the
      // single-account fallback is not trusted — the loop fails closed rather
      // than accepting a forgeable static marker.
      ...(selfApprovalSecret !== undefined ? { authorization: { selfApprovalSecret } } : {}),
      ...(liveEngine === undefined ? {} : { engine: liveEngine }),
      ...(deliveryUnits === undefined ? {} : { deliveryUnits }),
    });
    await persistLoopScorecards(homes.stateHome, selectedApp.name, result.scorecardEvents);
    // A4: a merged deploy/package milestone queues its release as a critical
    // op on the approval queue — the trigger, never the execution.
    if (!dryRun) {
      const queuedReleases = await queueReleaseApprovals(homes.stateHome, selectedApp.name, result.items, undefined, {
        localRepo: inputs.localRepo,
      });
      for (const queued of queuedReleases) {
        console.log(
          `release: ${queued.kind} for ${queued.ticketRef} queued as critical op ` +
            `${queued.approvalId} (owner: ${queued.owner}) — decide with \`cormidia approvals\``,
        );
      }
    }
    for (const line of result.lines) console.log(line);
    for (const item of result.items) {
      console.log(`${item.ticketRef}: ${item.phase}${episodeReplanOutcome(item)}`);
    }
    if (result.budgetRefusal !== undefined) sawBudgetRefusal = true;
    if ((result.terminalEpisodeRefusals?.length ?? 0) > 0) sawTerminalEpisodeRefusal = true;
    if (loopDriverExitCode(result) !== 0) accumulatedLoopExitCode = 1;
    itemsClaimed += result.items.length;
    itemsPreviewed += result.itemsPreviewed ?? 0;
    invocationOutcomes.push(loopInvocationOutcome(result, dryRun));
    if (result.lines.length === 0 && result.items.length === 0) {
      console.log(`loop: no ready tickets for ${selectedApp.name}`);
    }
  }

  try {
    await tick();
    // A refused tick ends follow mode too. An exhausted monthly cap will not
    // clear on a 30-second cadence; a terminal ticket was repaired to a parked
    // state and requires a new ticket. Continuing would hide either stop
    // behind a later idle tick.
    while (follow && !sawBudgetRefusal && !sawTerminalEpisodeRefusal && cancellation?.signal.aborted !== true) {
      await waitForDelay(30_000, cancellation?.signal);
      if (cancellation?.exitCode !== undefined) break;
      await tick();
    }
  } finally {
    cancellation?.dispose();
  }
  const exitCode = cancellation?.exitCode ?? accumulatedLoopExitCode;
  reportCliInvocation({
    app: selectedApp.name,
    dryRun,
    itemsClaimed,
    itemsPreviewed,
    outcome: invocationOutcomes.join("; ") || (exitCode === 0 ? "completed" : `failed: exit ${exitCode}`),
    ...(parentTaskId === undefined ? {} : { parentTaskId }),
  });
  return exitCode;
}

function episodeReplanOutcome(item: LoopDriverResult["items"][number]): string {
  const replan = item.episodeReplan;
  if (replan === undefined) return "";
  const revision = replan.revisionVersion === null ? "" : ` v${replan.revisionVersion}`;
  const reason = replan.reason === null ? "" : ` — ${replan.reason}`;
  return ` [replan ${replan.status}${revision}: ${replan.kind}${reason}]`;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`loop: ${flag} requires a value`);
  return value;
}
