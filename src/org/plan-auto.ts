// Non-interactive planning on the real runtime (proportionality-review
// Stage 4). The interactive co-planning mode (plan.ts) hands the terminal to
// the native CLI: usage is unobservable, output is prose, and publication in
// the 2026-07-10 episode was an agent-authored shell loop that wiped 19 issue
// bodies. This mode runs the Planner through the pass executor — real gate,
// real approval store, real per-pass ledger settlement — and the ORCHESTRATOR
// publishes the schema-validated plan (src/loop/plan-tickets.ts).

import { existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { defaultGate } from "../runtime/gate.js";
import { getRuntime } from "../runtime/registry.js";
import type { RoleConfig, Runtime, TurnHooks } from "../runtime/types.js";
import { executePipeline } from "../loop/pipeline.js";
import { getPipeline, loadPipelines } from "../loop/pipelines.js";
import { GhCliOps, type GhOps } from "../loop/github.js";
import {
  PLAN_SCHEMA,
  publishTickets,
  validatePlan,
  type ProjectStage,
  type PublishedTicket,
  type TicketPlan,
} from "../loop/plan-tickets.js";
import { ApprovalStore } from "./approvals.js";
import type { AppEntry } from "./apps.js";
import { rollupBudgets } from "./budget.js";
import type { AppsFile } from "./apps.js";
import { assembleContext } from "./context.js";
import { composeGate } from "./gate-compose.js";
import { loadRoles } from "./roles.js";
import { ensureManagedClone, withAppGitLock } from "./turn-runner.js";

export interface AutoPlanOptions {
  orgHome: string;
  stateHome: string;
  app: AppEntry;
  appsFile: AppsFile;
  /** The product goal the plan serves — required; planning without a goal is
   *  how a website becomes 19 tickets. */
  goal: string;
  stage?: ProjectStage;
  /** Publish the validated plan to GitHub (default). False = plan + validate
   *  only, print, publish nothing. */
  publish?: boolean;
  gh?: GhOps;
  runtimeFor?: (role: RoleConfig) => Runtime;
  now?: () => Date;
}

export interface AutoPlanResult {
  status: "completed" | "failed";
  summary: string;
  plan?: TicketPlan;
  problems?: string[];
  published?: PublishedTicket[];
}

export async function runAutoPlan(options: AutoPlanOptions): Promise<AutoPlanResult> {
  const clock = options.now ?? ((): Date => new Date());
  const stage: ProjectStage =
    options.stage ?? (options.app.status === "onboarding" ? "bootstrap" : "mature");
  if (stage !== "bootstrap") {
    // The five-pass mature path stays interactive until its passes emit
    // structured plans too — refusing loudly beats a prose plan that cannot
    // be validated or published.
    return {
      status: "failed",
      summary:
        `non-interactive planning currently supports the bootstrap stage only; ` +
        `stage "${stage}" plans through the interactive co-planning mode`,
    };
  }

  const rolesFile = await loadRoles(join(options.orgHome, "roles.yaml"));
  const planner = rolesFile.roles.find((role) => role.name === "planner");
  if (planner === undefined) return { status: "failed", summary: "roles.yaml has no planner role" };
  const roles = Object.fromEntries(rolesFile.roles.map((role) => [role.name, role]));
  const pipelines = await loadPipelines(join(options.orgHome, "pipelines.yaml"), {
    roleNames: rolesFile.roles.map((role) => role.name),
    promptsDir: join(options.orgHome, "prompts"),
  });
  const pipeline = getPipeline(pipelines, "plan-bootstrap");

  // Plan from current repo truth: the managed clone is fetched and reset to
  // origin/main (the episode planned from a stale bootstrap commit and
  // concluded the ratified docs did not exist).
  const localRepo = await withAppGitLock(options.stateHome, options.app.name, () =>
    ensureManagedClone(options.app, options.stateHome),
  );

  const turnId = `plan-${options.app.name}-${clock().getTime()}`;
  const store = new ApprovalStore(options.stateHome);
  const hooks: TurnHooks = {
    gate: composeGate(defaultGate, store, {
      app: options.app.name,
      role: planner.name,
      turnId,
      now: clock,
    }),
  };
  const context = (
    await assembleContext({
      orgHome: options.orgHome,
      appWorkdir: localRepo,
      app: options.app.name,
      role: planner,
      taskText: `bootstrap plan for ${options.app.name}: ${options.goal}`,
    })
  ).bundle;

  const brief = await stageAwareBrief(options, localRepo, clock());
  const run = await executePipeline({
    pipeline,
    selection: { tier: "standard" },
    roles,
    runtimeFor: options.runtimeFor ?? ((role) => getRuntime(role.runtime)),
    briefFor: () => brief,
    promptsDir: join(options.orgHome, "prompts"),
    context,
    workdir: localRepo,
    hooks,
    runlog: { root: options.stateHome, app: options.app.name, traceId: turnId },
    clock,
    verdictSchemaFor: () => PLAN_SCHEMA,
    telemetry: { orgDir: options.stateHome, trigger: "manual" },
  });

  const pass = run.passes[run.passes.length - 1];
  if (run.aborted || pass === undefined || pass.result.status !== "completed") {
    return {
      status: "failed",
      summary: `planning turn did not complete: ${pass?.result.summary ?? "no pass ran"}`,
    };
  }

  const plan = parsePlanJson(pass.result.summary);
  if (plan === undefined) {
    return {
      status: "failed",
      summary: "planner output is not a parseable TicketPlan JSON object",
    };
  }
  const validation = validatePlan(plan);
  if (!validation.ok) {
    return {
      status: "failed",
      summary: `plan failed validation (${validation.problems.length} problem(s))`,
      plan,
      problems: validation.problems,
    };
  }

  if (options.publish === false) {
    return { status: "completed", summary: "plan validated; publication skipped (--no-publish)", plan };
  }
  const gh = options.gh ?? new GhCliOps(options.app.repo);
  const { published } = await publishTickets(gh, plan);
  return {
    status: "completed",
    summary:
      `published ${published.length} ticket(s): ` +
      published.map((t) => `#${t.issueNumber}${t.ready ? " (ready)" : ""}`).join(", "),
    plan,
    published,
  };
}

/** P2: the plan sees what IS — goal, repo truth from the fresh clone, and the
 *  org's own cost history for this app. */
async function stageAwareBrief(options: AutoPlanOptions, localRepo: string, now: Date): Promise<string> {
  const entries = readdirSync(localRepo)
    .filter((name) => name !== ".git")
    .sort()
    .slice(0, 40);
  let recentCommits = "(no commits readable)";
  try {
    recentCommits = execFileSync("git", ["log", "--oneline", "-5"], {
      cwd: localRepo,
      encoding: "utf8",
    }).trim();
  } catch {
    // Empty repo — the listing above already says so.
  }
  const budget = (await rollupBudgets(options.stateHome, options.appsFile, now)).find(
    (row) => row.app === options.app.name,
  );
  return [
    `# Bootstrap plan request: ${options.app.name}`,
    "",
    "## Product goal",
    options.goal,
    "",
    "## Repo truth (fresh clone of origin/main)",
    `Top-level entries: ${entries.length === 0 ? "(empty repo)" : entries.join(", ")}`,
    `Docs present: ${["README.md", "docs"].filter((p) => existsSync(join(localRepo, p))).join(", ") || "none"}`,
    "Recent commits:",
    recentCommits,
    "",
    "## Org history for this app",
    budget !== undefined
      ? `Month-to-date spend $${budget.spentUsd.toFixed(2)} of $${budget.budgetUsd.toFixed(2)} (${budget.status}).`
      : "No spend recorded.",
    "",
    "Plan the smallest shippable first milestone per the pass protocol.",
  ].join("\n");
}

/** Native structured output returns bare JSON; a non-native adapter may wrap
 *  it in prose or a code fence — take the first top-level object. */
export function parsePlanJson(text: string): TicketPlan | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  for (let end = text.length; end > start; end -= 1) {
    const candidate = text.slice(start, end).trim();
    if (!candidate.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(candidate) as TicketPlan;
      if (typeof parsed === "object" && parsed !== null && Array.isArray(parsed.tickets)) {
        return parsed;
      }
      return undefined;
    } catch {
      // Trailing prose after the JSON — shrink the window and retry.
    }
  }
  return undefined;
}
