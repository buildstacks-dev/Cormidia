// `operon plan <app>` — manual Planner co-planning launcher, plus the
// non-interactive `--auto` mode (Stage 4): one runtime-backed planning turn
// producing a schema-validated, orchestrator-published bootstrap plan.

import { cleanupPlanningWorktree, preparePlanSession, recordPlanTelemetry, spawnClaude } from "../org/plan.js";
import { runAutoPlan } from "../org/plan-auto.js";
import { loadApps } from "../org/apps.js";
import { resolveOperonHomes } from "../org/home.js";
import { join, resolve } from "node:path";
import { extractHomeFlags } from "./home-flags.js";
import { installProcessCancellation } from "./process-signal.js";
import { resolveParentTaskId } from "../org/parent-task.js";
import {
  decidePlanningDepth,
  type ExpectedTicketBand,
  type ExternalConsequence,
  type PlanningDepth,
  type PlanningLevel,
  type PlanningReversibility,
} from "../org/planning-depth.js";

export async function cmdPlan(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "plan");
  const parsed = parseArgs(common.rest);
  const homes = await resolveOperonHomes(common);
  const parentTaskId = await resolveParentTaskId(homes.stateHome, parsed.parentTaskId);

  if (parsed.explainRoute) {
    // --explain-route is the token-free route preview (a standalone usage form
    // in the CLI help). Combined with --auto it used to win silently: exit 0,
    // route JSON, and the requested planning run dropped without a word — the
    // live campaign followed exactly that combination and believed planning
    // had happened (review L-008). Contradictory instructions are rejected
    // loudly instead of one being silently discarded.
    if (parsed.auto) {
      throw new Error(
        "plan: --explain-route (token-free route preview) cannot be combined with --auto (a real planning run) — " +
          "drop --explain-route to plan (the plan output includes its routing decision), " +
          "or drop --auto to preview the route without planning",
      );
    }
    const appsFile = await loadApps(join(homes.orgHome, "apps.yaml"));
    const app = appsFile.apps.find((entry) => entry.name === parsed.app);
    if (app === undefined) throw new Error(`plan: unknown app "${parsed.app}" in apps.yaml`);
    const stage = parsed.stage ?? (app.status === "onboarding" ? "bootstrap" : "mature");
    const decision = decidePlanningDepth({ goal: parsed.goal ?? "", stage, ...planningOptions(parsed) });
    console.log(JSON.stringify({ schema_version: 1, kind: "route-explanation", app: app.name, stage, ...decision }, null, 2));
    return 0;
  }

  if (parsed.auto) {
    if (parsed.goal === undefined) {
      throw new Error("plan: --auto requires --goal <text> — planning without a goal is how a website becomes 19 tickets");
    }
    const appsFile = await loadApps(join(homes.orgHome, "apps.yaml"));
    const app = appsFile.apps.find((entry) => entry.name === parsed.app);
    if (app === undefined) throw new Error(`plan: unknown app "${parsed.app}" in apps.yaml`);
    if (parsed.dryRun) {
      const stage = parsed.stage ?? (app.status === "onboarding" ? "bootstrap" : "mature");
      const decision = decidePlanningDepth({ goal: parsed.goal, stage, ...planningOptions(parsed) });
      console.log(`plan dry-run: ${app.name}`);
      console.log(`goal: ${parsed.goal}`);
      console.log(`stage: ${stage}`);
      console.log(`planning depth: ${decision.depth}`);
      console.log(`routing factors: ${decision.decisionFactors.join("; ")}`);
      console.log(`source checkout: ${resolve(parsed.workdir ?? join(homes.stateHome, "repos", app.name))}`);
      if (parentTaskId !== undefined) console.log(`parent task: ${parentTaskId}`);
      console.log("(dry-run: no runtime, run envelope, telemetry, learning projection, or GitHub write)");
      return 0;
    }
    const cancellation = installProcessCancellation();
    const result = await runAutoPlan({
      orgHome: homes.orgHome,
      stateHome: homes.stateHome,
      app,
      appsFile,
      goal: parsed.goal,
      ...(parsed.workdir !== undefined ? { workdir: parsed.workdir } : {}),
      ...(parsed.stage !== undefined ? { stage: parsed.stage } : {}),
      ...(parsed.noPublish ? { publish: false } : {}),
      signal: cancellation.signal,
      ...(parentTaskId !== undefined ? { parentTaskId } : {}),
      planning: planningOptions(parsed),
    }).finally(() => cancellation.dispose());
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
    if (result.planningDecision !== undefined) {
      console.log(`planning depth: ${result.planningDecision.depth}`);
      console.log(`routing factors: ${result.planningDecision.decisionFactors.join("; ")}`);
    }
    if (result.planningCostEstimate !== undefined) {
      console.log(
        `estimated planning cost: ${result.planningCostEstimate.estimatedCostUsd === null
          ? "unavailable"
          : `$${result.planningCostEstimate.estimatedCostUsd.toFixed(4)}`} ` +
          `(upper bound $${result.planningCostEstimate.upperBoundUsd.toFixed(2)})`,
      );
    }
    // A plan that produced no durable output must not exit 0 (the episode's
    // stalled planner exited 0 after doing nothing).
    return cancellation.exitCode ?? (result.status === "completed" ? 0 : 1);
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
  const cancellation = installProcessCancellation();
  const code = await spawnClaude(session.invocation, cancellation.signal).finally(() => cancellation.dispose());
  const endedAt = new Date();
  await recordPlanTelemetry({
    orgDir: homes.stateHome,
    role: session.plannerRole,
    app: session.app.name,
    status: cancellation.signal.aborted ? "cancelled" : code === 0 ? "completed" : "failed",
    startedAt,
    endedAt,
    ...(parentTaskId !== undefined ? { parentTaskId } : {}),
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
  parentTaskId?: string;
  depth?: PlanningDepth;
  risk?: PlanningLevel;
  ambiguity?: PlanningLevel;
  coupling?: PlanningLevel;
  reversibility?: PlanningReversibility;
  externalConsequence?: ExternalConsequence;
  expectedTickets?: ExpectedTicketBand;
  sensitiveDomains?: string[];
  explainRoute: boolean;
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
  let parentTaskId: string | undefined;
  let depth: PlanningDepth | undefined;
  let risk: PlanningLevel | undefined;
  let ambiguity: PlanningLevel | undefined;
  let coupling: PlanningLevel | undefined;
  let reversibility: PlanningReversibility | undefined;
  let externalConsequence: ExternalConsequence | undefined;
  let expectedTickets: ExpectedTicketBand | undefined;
  let sensitiveDomains: string[] | undefined;
  let explainRoute = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--explain-route") {
      explainRoute = true;
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
    } else if (arg === "--parent-task") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) throw new Error("plan: --parent-task requires an id");
      parentTaskId = next;
      i++;
    } else if (arg === "--depth") {
      depth = enumFlag(args, ++i, "--depth", ["quick", "standard", "deep"]);
    } else if (arg === "--risk") {
      risk = enumFlag(args, ++i, "--risk", ["low", "medium", "high"]);
    } else if (arg === "--ambiguity") {
      ambiguity = enumFlag(args, ++i, "--ambiguity", ["low", "medium", "high"]);
    } else if (arg === "--coupling") {
      coupling = enumFlag(args, ++i, "--coupling", ["low", "medium", "high"]);
    } else if (arg === "--reversibility") {
      reversibility = enumFlag(args, ++i, "--reversibility", ["reversible", "costly-to-reverse", "irreversible"]);
    } else if (arg === "--external-consequence") {
      externalConsequence = enumFlag(args, ++i, "--external-consequence", ["none", "internal", "customer-public-production"]);
    } else if (arg === "--expected-tickets") {
      expectedTickets = enumFlag(args, ++i, "--expected-tickets", ["1-2", "3-6", "7+"]);
    } else if (arg === "--sensitive-domains") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) throw new Error("plan: --sensitive-domains requires a comma-separated value");
      sensitiveDomains = [...new Set(next.split(",").map((value) => value.trim()).filter(Boolean))];
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
    explainRoute,
    ...(goal !== undefined ? { goal } : {}),
    ...(stage !== undefined ? { stage } : {}),
    ...(topic !== undefined ? { topic } : {}),
    ...(workdir ? { workdir } : {}),
    ...(parentTaskId !== undefined ? { parentTaskId } : {}),
    ...(depth !== undefined ? { depth } : {}),
    ...(risk !== undefined ? { risk } : {}),
    ...(ambiguity !== undefined ? { ambiguity } : {}),
    ...(coupling !== undefined ? { coupling } : {}),
    ...(reversibility !== undefined ? { reversibility } : {}),
    ...(externalConsequence !== undefined ? { externalConsequence } : {}),
    ...(expectedTickets !== undefined ? { expectedTickets } : {}),
    ...(sensitiveDomains !== undefined ? { sensitiveDomains } : {}),
  };
}

function planningOptions(parsed: ParsedPlanArgs) {
  return {
    ...(parsed.depth !== undefined ? { minimumDepth: parsed.depth } : {}),
    ...(parsed.risk !== undefined ? { riskTier: parsed.risk } : {}),
    ...(parsed.ambiguity !== undefined ? { ambiguity: parsed.ambiguity } : {}),
    ...(parsed.coupling !== undefined ? { coupling: parsed.coupling } : {}),
    ...(parsed.reversibility !== undefined ? { reversibility: parsed.reversibility } : {}),
    ...(parsed.externalConsequence !== undefined ? { externalConsequence: parsed.externalConsequence } : {}),
    ...(parsed.expectedTickets !== undefined ? { expectedTickets: parsed.expectedTickets } : {}),
    ...(parsed.sensitiveDomains !== undefined ? { sensitiveDomains: parsed.sensitiveDomains } : {}),
  };
}

function enumFlag<const T extends string>(args: string[], index: number, flag: string, allowed: readonly T[]): T {
  const value = args[index];
  if (value === undefined || !allowed.includes(value as T)) {
    throw new Error(`plan: ${flag} must be ${allowed.join(" | ")}`);
  }
  return value as T;
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
