// `operon plan <app>` — manual Planner co-planning launcher.

import { cleanupPlanningWorktree, preparePlanSession, recordPlanTelemetry, spawnClaude } from "../org/plan.js";

export async function cmdPlan(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  const session = await preparePlanSession({
    appName: parsed.app,
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
    orgDir: ".org",
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
}

function parseArgs(args: string[]): ParsedPlanArgs {
  const app = args[0];
  if (!app || app.startsWith("--")) {
    throw new Error("plan: usage: operon plan <app> [--topic <string>] [--dry-run] [--workdir <path>]");
  }

  let topic: string | undefined;
  let dryRun = false;
  let workdir: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
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

  return { app, dryRun, ...(topic !== undefined ? { topic } : {}), ...(workdir ? { workdir } : {}) };
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
