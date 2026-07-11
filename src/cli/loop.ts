// `operon loop --app <app> [--once|--follow] [--dry-run] [--allow-network]`
// for the build-loop state machine (M5.9).

import { join } from "node:path";
import { defaultGate } from "../runtime/gate.js";
import type { GateFn, RoleConfig } from "../runtime/types.js";
import { getRuntime } from "../runtime/registry.js";
import { defaultLoopInputs, runLoopOnce } from "../loop/driver.js";
import { loadPipelines } from "../loop/pipelines.js";
import type { ScorecardEvent as LoopScorecardEvent } from "../loop/types.js";
import { loadApps } from "../org/apps.js";
import { assembleContext } from "../org/context.js";
import { loadRoles } from "../org/roles.js";
import { appendScorecardEvent } from "../org/scorecards.js";
import { ApprovalStore } from "../org/approvals.js";
import { isOverlayPaused, rollupBudgets } from "../org/budget.js";
import { composeGate } from "../org/gate-compose.js";
import { recordInvocation } from "../runtime/telemetry.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";

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
): (role: RoleConfig) => GateFn {
  const store = new ApprovalStore(stateHome);
  return (role) =>
    composeGate(defaultGate, store, {
      app,
      role: role.name,
      turnId,
    });
}

export async function cmdLoop(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "loop");
  args = common.rest;
  let appName: string | undefined;
  let once = false;
  let follow = false;
  let dryRun = false;
  let repoDir: string | undefined;
  let worktreeRoot: string | undefined;
  let allowNetwork = false;

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
    } else {
      throw new Error(`loop: unknown flag "${arg}"`);
    }
  }

  if (appName === undefined) throw new Error("loop: --app <app> is required");
  if (!once && !follow) once = true;
  if (once && follow) throw new Error("loop: choose either --once or --follow, not both");

  const homes = await resolveOperonHomes(common);
  const appsPath = join(homes.orgHome, "apps.yaml");
  const rolesPath = join(homes.orgHome, "roles.yaml");
  const pipelinesPath = join(homes.orgHome, "pipelines.yaml");
  const appsFile = await loadApps(appsPath);
  const app = appsFile.apps.find((entry) => entry.name === appName);
  if (app === undefined) throw new Error(`loop: unknown app "${appName}" in apps.yaml`);
  const selectedApp = app;

  const localRepo = repoDir ?? join(homes.stateHome, "repos", selectedApp.name);
  const worktrees = worktreeRoot ?? join(homes.stateHome, "worktrees", selectedApp.name);
  const inputs = await defaultLoopInputs(selectedApp.repo, localRepo);
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

  async function tick(): Promise<void> {
    // Stamp a turn id on this tick so claimed items carry one — the loop only
    // emits scorecard events for items with a turnId (loop.ts), and this is the
    // attribution/dedupe key the org scorecard ledger records under.
    const turnId = `loop-${selectedApp.name}-${Date.now()}`;
    const tickStarted = Date.now();
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
      planOnly: dryRun,
      // Merge authorization: the self-approval fallback must carry an HMAC tag
      // signed with this operator secret (never repo-visible). Without it, the
      // single-account fallback is not trusted — the loop fails closed rather
      // than accepting a forgeable static marker.
      ...(process.env["OPERON_SELF_APPROVAL_SECRET"] !== undefined
        ? { authorization: { selfApprovalSecret: process.env["OPERON_SELF_APPROVAL_SECRET"] } }
        : {}),
      ...(!dryRun
        ? {
            engine: {
            pipelines,
            roles,
            runtimeFor: (role) => getRuntime(role.runtime),
            promptsDir,
            runlogRoot: homes.stateHome,
            hooks: { gate: defaultGate },
            gateForRole: createLoopGateForRole(
              homes.stateHome,
              selectedApp.name,
              turnId,
            ),
            context: (await assembleContext({
              orgHome: homes.orgHome,
              appWorkdir: localRepo,
              app: selectedApp.name,
              role: builderRole,
              taskText: `build loop for ${selectedApp.name}`,
            })).bundle,
            ...(allowNetwork ? { networkAccess: true } : {}),
            // Every provider turn this tick runs settles into the org ledger
            // per pass, keyed on runId (telemetry doc Defect B). Manual loop
            // spend was previously invisible to `operon budget`.
            telemetry: { orgDir: homes.stateHome, trigger: "manual" },
            budgetGuard: async () => {
              const rows = await rollupBudgets(homes.stateHome, appsFile);
              const row = rows.find((r) => r.app === selectedApp.name);
              if (row !== undefined && row.status === "exceeded") {
                return {
                  allowed: false,
                  reason:
                    `${row.app} spent $${row.spentUsd.toFixed(2)} of its ` +
                    `$${row.budgetUsd.toFixed(2)} monthly cap — raise the cap in apps.yaml ` +
                    `or wait for the month to reset`,
                };
              }
              if (await isOverlayPaused(homes.stateHome, selectedApp.name)) {
                return {
                  allowed: false,
                  reason: `${selectedApp.name} is paused by the budget overlay (operon approvals has the item)`,
                };
              }
              return { allowed: true };
            },
            },
          }
        : {}),
    });
    await persistLoopScorecards(homes.stateHome, selectedApp.name, result.scorecardEvents);
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
    });
  }

  await tick();
  while (follow) {
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    await tick();
  }
  return sawBudgetRefusal ? 1 : 0;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`loop: ${flag} requires a value`);
  return value;
}
