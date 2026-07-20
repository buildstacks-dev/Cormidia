// `operon loop --app <app> [--once|--follow] [--dry-run] [--allow-network]`
// for the build-loop state machine (M5.9).

import { join } from "node:path";
import { defaultGate } from "../runtime/gate.js";
import type { GateFn, RoleConfig, TurnAssignment } from "../runtime/types.js";
import { getRuntime } from "../runtime/registry.js";
import { defaultLoopInputs, runLoopOnce } from "../loop/driver.js";
import { EPISODE_PLAN_EXECUTION_PIPELINE } from "../loop/episode-route.js";
import { loadPipelines } from "../loop/pipelines.js";
import { finalizeEpisode } from "../loop/efficiency.js";
import type { ScorecardEvent as LoopScorecardEvent } from "../loop/types.js";
import { loadApps } from "../org/apps.js";
import { assembleContext, createEpisodeContextResolver } from "../org/context.js";
import { loadRoles } from "../org/roles.js";
import { appendScorecardEvent } from "../org/scorecards.js";
import { ApprovalStore } from "../org/approvals.js";
import { enforceBudgetOverlay, isBudgetBlocking } from "../org/budget.js";
import { createTicketEpisodeRuntime } from "../org/ticket-episode-runtime.js";
import { createExistingTicketApprovalHandler } from "../org/ticket-episode-approval.js";
import { queueReleaseApprovals } from "../org/release.js";
import { composeGate } from "../org/gate-compose.js";
import { recordInvocation } from "../runtime/telemetry.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";
import { installProcessCancellation, waitForDelay } from "./process-signal.js";
import { resolveParentTaskId } from "../org/parent-task.js";
import { explainContext } from "../loop/context-manifest.js";
import { resumeExecutionJournal } from "../loop/execution-journal.js";
import { cmdClaimRearm } from "./claim-rearm.js";

/**
 * Persist the scorecard events one loop tick produced into the org scorecard
 * ledger, mirroring the autonomous dispatch path (org/turn-runner.ts). Without
 * this the manual `operon loop` driver dropped every scorecard event, so
 * `operon retro` was blind to the real build loop — it only ever saw the
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

/** Manual `operon loop` must use the same durable approval boundary as the
 * autonomous dispatcher. The previous raw defaultGate wiring denied critical
 * actions but never created an approval item, leaving tickets stranded with
 * no possible `operon approvals review` recovery path. */
export function createLoopGateForRole(
  stateHome: string,
  app: string,
  turnId: string,
  orgHome?: string,
  store: ApprovalStore = new ApprovalStore(stateHome),
): (role: RoleConfig) => GateFn {
  return (role) =>
    composeGate(defaultGate, store, {
      app,
      role: role.name,
      turnId,
      ...(orgHome !== undefined ? { orgHome } : {}),
    });
}

export async function cmdLoop(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "loop");
  args = common.rest;
  if (args[0] === "rearm") {
    return cmdClaimRearm(args.slice(1), await resolveOperonHomes(common));
  }
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

  const homes = await resolveOperonHomes(common);
  if (explainEpisode !== undefined) {
    if (resumeEpisode !== undefined || appName !== undefined || once || follow || dryRun || repoDir !== undefined || worktreeRoot !== undefined || allowNetwork) {
      throw new Error("loop: --explain-context is a token-free standalone read");
    }
    console.log(JSON.stringify(await explainContext(homes.stateHome, explainEpisode), null, 2));
    return 0;
  }
  if (resumeEpisode !== undefined) {
    if (appName !== undefined || once || follow || dryRun || repoDir !== undefined || worktreeRoot !== undefined || allowNetwork) {
      throw new Error("loop: --resume-episode is a standalone durable-boundary read");
    }
    // L-005: this flag is a read-only PREVIEW of the durable resume plan — it
    // does not execute the resume. Say so plainly so an operator does not
    // believe work happened. Actual continuation is `operon loop --app <app>`,
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
        "Continue the ticket with `operon loop --app <app>`, which resumes from these artifacts.",
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
  const inputs = await defaultLoopInputs(selectedApp.repo, localRepo, {
    ...(repoDir !== undefined
      ? {
          supplied: true,
          snapshotDir: join(
            homes.stateHome,
            "repos",
            "snapshots",
            selectedApp.name,
            `${Date.now()}-${process.pid}`,
          ),
        }
      : {}),
  });
  const rolesFile = await loadRoles(rolesPath);
  const roles = Object.fromEntries(rolesFile.roles.map((role) => [role.name, role]));
  const maybeBuilderRole = roles["builder"];
  if (maybeBuilderRole === undefined) throw new Error("loop: roles.yaml has no builder role");
  const builderRole = maybeBuilderRole;
  const promptsDir = join(homes.orgHome, "prompts");
  const pipelines = await loadPipelines(pipelinesPath, {
    roleNames: rolesFile.roles.map((role) => role.name),
    promptsDir,
  });

  let sawBudgetRefusal = false;
  const cancellation = dryRun ? undefined : installProcessCancellation();

  async function tick(): Promise<void> {
    // Stamp a turn id on this tick so claimed items carry one — the loop only
    // emits scorecard events for items with a turnId (loop.ts), and this is the
    // attribution/dedupe key the org scorecard ledger records under.
    const turnId = `loop-${selectedApp.name}-${Date.now()}`;
    const tickStarted = Date.now();
    let liveEngine: NonNullable<Parameters<typeof runLoopOnce>[0]["engine"]> | undefined;
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
      );
      const budgetRows = await enforceBudgetOverlay(homes.stateHome, appsFile);
      const budgetRow = budgetRows.find((row) => row.app === selectedApp.name);
      if (budgetRow === undefined) {
        throw new Error(`loop: could not resolve the app budget for ${selectedApp.name}`);
      }
      const remainingBudgetUsd = Math.max(0, budgetRow.budgetUsd - budgetRow.spentUsd);
      const fallbackContext = (await assembleContext({
        orgHome: homes.orgHome,
        appWorkdir: localRepo,
        app: selectedApp.name,
        role: builderRole,
        taskText: `build loop for ${selectedApp.name}`,
      })).bundle;
      const plannerContext = (await assembleContext({
        orgHome: homes.orgHome,
        appWorkdir: localRepo,
        app: selectedApp.name,
        role: plannerRole,
        taskText: `plan bounded ticket delivery for ${selectedApp.name}`,
      })).bundle;
      const resolveEpisodeContext = createEpisodeContextResolver({
        orgHome: homes.orgHome,
        appWorkdir: localRepo,
        app: selectedApp.name,
        roles,
        stateHome: homes.stateHome,
        turnId,
      });
      const runtimeForAssignment = (assignment: TurnAssignment) =>
        getRuntime(assignment.harness);
      const ticketEpisode = createTicketEpisodeRuntime({
        root: homes.stateHome,
        orgRoot: homes.orgHome,
        app: selectedApp,
        roles: rolesFile.roles,
        gh: inputs.gh,
        policy: inputs.policy,
        commands: inputs.commands,
        hooks: { gate: defaultGate },
        runtimeForAssignment,
        plannerContext,
        contextForProviderStep: async ({ item, role }) =>
          (await resolveEpisodeContext(
            item,
            EPISODE_PLAN_EXECUTION_PIPELINE,
            role.name,
          )) ?? fallbackContext,
        remainingBudgetUsd,
        gateForRole,
        approval: createExistingTicketApprovalHandler({
          store: approvalStore,
          app: selectedApp.name,
          roleNames: rolesFile.roles.map((role) => role.name),
        }),
        ...(process.env["OPERON_SELF_APPROVAL_SECRET"] === undefined
          ? {}
          : {
              authorization: {
                selfApprovalSecret: process.env["OPERON_SELF_APPROVAL_SECRET"],
              },
            }),
        ...(selectedApp.release === undefined ? {} : { release: selectedApp.release }),
        telemetry: { orgDir: homes.stateHome, trigger: "manual" },
        ...(parentTaskId === undefined ? {} : { parentTaskId }),
        ...(allowNetwork ? { networkAccess: true } : {}),
        ...(cancellation === undefined ? {} : { signal: cancellation.signal }),
      });
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
                    `\`operon budget --reconcile\` to repair the ledger`
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
      planOnly: dryRun,
      ...(selectedApp.release !== undefined ? { release: selectedApp.release } : {}),
      // Merge authorization: the self-approval fallback must carry an HMAC tag
      // signed with this operator secret (never repo-visible). Without it, the
      // single-account fallback is not trusted — the loop fails closed rather
      // than accepting a forgeable static marker.
      ...(process.env["OPERON_SELF_APPROVAL_SECRET"] !== undefined
        ? { authorization: { selfApprovalSecret: process.env["OPERON_SELF_APPROVAL_SECRET"] } }
        : {}),
      ...(liveEngine === undefined ? {} : { engine: liveEngine }),
    });
    await persistLoopScorecards(homes.stateHome, selectedApp.name, result.scorecardEvents);
    // A4: a merged deploy/package milestone queues its release as a critical
    // op on the approval queue — the trigger, never the execution.
    if (!dryRun) {
      const queuedReleases = await queueReleaseApprovals(homes.stateHome, selectedApp.name, result.items);
      for (const queued of queuedReleases) {
        console.log(
          `release: ${queued.kind} for ${queued.ticketRef} queued as critical op ` +
            `${queued.approvalId} (owner: ${queued.owner}) — decide with \`operon approvals\``,
        );
      }
    }
    for (const line of result.lines) console.log(line);
    for (const item of result.items) {
      console.log(`${item.ticketRef}: ${item.phase}`);
    }
    if (result.budgetRefusal !== undefined) sawBudgetRefusal = true;
    if (result.lines.length === 0 && result.items.length === 0) {
      console.log(`loop: no ready tickets for ${selectedApp.name}`);
    }
    // One durable row per orchestrator invocation (telemetry doc §6): the
    // 2026-07-10 review could not even recover how many times the loop ran.
    await recordInvocation(homes.stateHome, {
      at: new Date().toISOString(),
      kind: "loop",
      app: selectedApp.name,
      ...(dryRun ? { dryRun: true } : {}),
      itemsClaimed: result.items.length,
      outcome:
        result.budgetRefusal !== undefined
          ? `budget-refused: ${result.budgetRefusal}`
          : result.items.map((item) => `${item.ticketRef}=${item.phase}`).join(", ") || "no-ready-tickets",
      wallClockMs: Date.now() - tickStarted,
      ...(parentTaskId !== undefined ? { parentTaskId } : {}),
    });
  }

  try {
    await tick();
    // A refused tick ends follow mode too: an exhausted monthly cap will not
    // clear on a 30-second cadence, and spinning would append a refusal row
    // every tick until the month reset.
    while (follow && !sawBudgetRefusal && cancellation?.signal.aborted !== true) {
      await waitForDelay(30_000, cancellation?.signal);
      if (cancellation?.exitCode !== undefined) break;
      await tick();
    }
  } finally {
    cancellation?.dispose();
  }
  return cancellation?.exitCode ?? (sawBudgetRefusal ? 1 : 0);
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`loop: ${flag} requires a value`);
  return value;
}
