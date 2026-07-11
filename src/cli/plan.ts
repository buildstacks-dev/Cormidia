// `operon plan <app>` — manual Planner co-planning launcher, plus the
// non-interactive `--auto` mode (Stage 4): one runtime-backed planning turn
// producing a schema-validated, orchestrator-published bootstrap plan.

import { cleanupPlanningWorktree, preparePlanSession, recordPlanTelemetry, spawnClaude } from "../org/plan.js";
import { runAutoPlan } from "../org/plan-auto.js";
import { loadApps } from "../org/apps.js";
import { resolveOperonHomes } from "../org/home.js";
import { join } from "node:path";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdPlan(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "plan");
  const parsed = parseArgs(common.rest);
  const homes = await resolveOperonHomes(common);

  if (parsed.auto) {
    if (parsed.goal === undefined) {
      throw new Error("plan: --auto requires --goal <text> — planning without a goal is how a website becomes 19 tickets");
    }
    const appsFile = await loadApps(join(homes.orgHome, "apps.yaml"));
    const app = appsFile.apps.find((entry) => entry.name === parsed.app);
    if (app === undefined) throw new Error(`plan: unknown app "${parsed.app}" in apps.yaml`);
    const result = await runAutoPlan({
      orgHome: homes.orgHome,
      stateHome: homes.stateHome,
      app,
      appsFile,
      goal: parsed.goal,
      ...(parsed.stage !== undefined ? { stage: parsed.stage } : {}),
      ...(parsed.noPublish ? { publish: false } : {}),
    });
    console.log(`plan (${result.status}): ${result.summary}`);
    if (result.plan !== undefined) {
      console.log(`stage: ${result.plan.stage}`);
      console.log(`why this many tickets: ${result.plan.ticketCountRationale}`);
      console.log(`release disposition: ${result.plan.releaseDisposition}`);
      console.log(`release kind: ${result.plan.releaseKind}`);
      result.plan.tickets.forEach((ticket, index) => {
        console.log(`  ${index}: [${ticket.tier}/${ticket.priority}] ${ticket.title}`);
      });
    }
    for (const problem of result.problems ?? []) console.log(`problem: ${problem}`);
    // A plan that produced no durable output must not exit 0 (the episode's
    // stalled planner exited 0 after doing nothing).
    return result.status === "completed" ? 0 : 1;
  }

  const session = await preparePlanSession({
    appName: parsed.app,
    orgHome: homes.orgHome,
    runtimeHome: homes.stateHome,
    ...(parsed.topic !== undefined ? { topic: parsed.topic } : {}),
    ...(parsed.workdir !== undefined ? { workdir: parsed.workdir } : {}),
  });

  if (parsed.dryRun) {
    try {
      printSummary(session, true);
      return 0;
    } finally {
      await cleanupPlanningWorktree(session.worktree);
    }
  }

  printSummary(session, false);
  const startedAt = new Date();
  const code = await spawnClaude(session.invocation);
  const endedAt = new Date();
  await recordPlanTelemetry({
    orgDir: homes.stateHome,
    role: session.plannerRole,
    app: session.app.name,
    status: code === 0 ? "completed" : "failed",
    startedAt,
    endedAt,
  });
  console.log(
    `planner session exited ${code}; worktree left at ${session.worktree.path} ` +
      `on ${session.worktree.branch}`,
  );
  return code;
}

interface ParsedPlanArgs {
  app: string;
  topic?: string;
  dryRun: boolean;
  workdir?: string;
  auto: boolean;
  goal?: string;
  stage?: "bootstrap" | "growth" | "mature";
  noPublish: boolean;
}

function parseArgs(args: string[]): ParsedPlanArgs {
  const app = args[0];
  if (!app || app.startsWith("--")) {
    throw new Error(
      "plan: usage: operon plan <app> [--topic <string>] [--dry-run] [--workdir <path>] " +
        "| operon plan <app> --auto --goal <text> [--stage bootstrap] [--no-publish]",
    );
  }

  let topic: string | undefined;
  let dryRun = false;
  let workdir: string | undefined;
  let auto = false;
  let goal: string | undefined;
  let stage: ParsedPlanArgs["stage"];
  let noPublish = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--auto") {
      auto = true;
    } else if (arg === "--no-publish") {
      noPublish = true;
    } else if (arg === "--goal") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) throw new Error("plan: --goal requires a string");
      goal = next;
      i++;
    } else if (arg === "--stage") {
      const next = args[i + 1];
      if (next !== "bootstrap" && next !== "growth" && next !== "mature") {
        throw new Error("plan: --stage must be bootstrap | growth | mature");
      }
      stage = next;
      i++;
    } else if (arg === "--topic") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) throw new Error("plan: --topic requires a string");
      topic = next;
      i++;
    } else if (arg === "--workdir") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) throw new Error("plan: --workdir requires a path");
      workdir = next;
      i++;
    } else {
      throw new Error(`plan: unknown flag "${arg}"`);
    }
  }

  return {
    app,
    dryRun,
    auto,
    noPublish,
    ...(goal !== undefined ? { goal } : {}),
    ...(stage !== undefined ? { stage } : {}),
    ...(topic !== undefined ? { topic } : {}),
    ...(workdir ? { workdir } : {}),
  };
}

function printSummary(
  session: Awaited<ReturnType<typeof preparePlanSession>>,
  dryRun: boolean,
): void {
  console.log(`plan app: ${session.app.name}`);
  console.log(`repo: ${session.app.repo}`);
  console.log(`branch: ${session.worktree.branch}`);
  console.log(`worktree: ${session.worktree.path}`);
  console.log(`topic: ${session.context.openingTask.replace(/^Co-planning topic: /, "")}`);
  console.log(`context bytes: ${session.context.byteSize}`);
  if (dryRun) console.log("(dry-run: Claude not spawned; worktree cleaned up)");
}
