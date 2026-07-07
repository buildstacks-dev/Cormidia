// `operon loop --app <app> [--once|--follow] [--dry-run]` — manual driver
// for the build-loop state machine (M5.9).

import { homedir } from "node:os";
import { join } from "node:path";
import { defaultGate } from "../runtime/gate.js";
import { getRuntime } from "../runtime/registry.js";
import { defaultLoopInputs, runLoopOnce } from "../loop/driver.js";
import { loadPipelines } from "../loop/pipelines.js";
import type { ScorecardEvent as LoopScorecardEvent } from "../loop/types.js";
import { loadApps } from "../org/apps.js";
import { assembleContext } from "../org/context.js";
import { loadRoles } from "../org/roles.js";
import { appendScorecardEvent } from "../org/scorecards.js";

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

export async function cmdLoop(args: string[]): Promise<number> {
  let appName: string | undefined;
  let once = false;
  let follow = false;
  let dryRun = false;
  let repoDir: string | undefined;
  let worktreeRoot: string | undefined;

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
    } else {
      throw new Error(`loop: unknown flag "${arg}"`);
    }
  }

  if (appName === undefined) throw new Error("loop: --app <app> is required");
  if (!once && !follow) once = true;
  if (once && follow) throw new Error("loop: choose either --once or --follow, not both");

  const appsFile = await loadApps("apps.yaml");
  const app = appsFile.apps.find((entry) => entry.name === appName);
  if (app === undefined) throw new Error(`loop: unknown app "${appName}" in apps.yaml`);
  const selectedApp = app;

  const orgHome = join(homedir(), ".operon", appsFile.org.name);
  const localRepo = repoDir ?? join(orgHome, "repos", selectedApp.name);
  const worktrees = worktreeRoot ?? join(orgHome, "worktrees", selectedApp.name);
  const inputs = await defaultLoopInputs(selectedApp.repo, localRepo);
  const rolesFile = await loadRoles("roles.yaml");
  const roles = Object.fromEntries(rolesFile.roles.map((role) => [role.name, role]));
  const maybeBuilderRole = roles["builder"];
  if (maybeBuilderRole === undefined) throw new Error("loop: roles.yaml has no builder role");
  const builderRole = maybeBuilderRole;
  const promptsDir = "prompts";
  const pipelines = await loadPipelines("pipelines.yaml", {
    roleNames: rolesFile.roles.map((role) => role.name),
    promptsDir,
  });

  async function tick(): Promise<void> {
    // Stamp a turn id on this tick so claimed items carry one — the loop only
    // emits scorecard events for items with a turnId (loop.ts), and this is the
    // attribution/dedupe key the org scorecard ledger records under.
    const turnId = `loop-${selectedApp.name}-${Date.now()}`;
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
            runlogRoot: orgHome,
            hooks: { gate: defaultGate },
            context: (await assembleContext({
              orgHome: process.cwd(),
              appWorkdir: localRepo,
              app: selectedApp.name,
              role: builderRole,
              taskText: `build loop for ${selectedApp.name}`,
            })).bundle,
            },
          }
        : {}),
    });
    await persistLoopScorecards(orgHome, selectedApp.name, result.scorecardEvents);
    for (const line of result.lines) console.log(line);
    for (const item of result.items) {
      console.log(`${item.ticketRef}: ${item.phase}`);
    }
    if (result.lines.length === 0 && result.items.length === 0) {
      console.log(`loop: no ready tickets for ${selectedApp.name}`);
    }
  }

  await tick();
  while (follow) {
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    await tick();
  }
  return 0;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`loop: ${flag} requires a value`);
  return value;
}
