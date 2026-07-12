// Planner co-planning mode (architecture.md §8): resolve one app, assemble
// the shared five-layer Planner context, create a planning worktree on main,
// then hand the terminal to the native Claude CLI with --append-system-prompt.

import { mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { loadApps, type AppEntry } from "./apps.js";
import { resolveAppWorkdir } from "./app-workdir.js";
import { loadRoles } from "./roles.js";
import { recordTurn, toRecord } from "../runtime/telemetry.js";
import type { RoleConfig, TurnResult } from "../runtime/types.js";
import { assembleContext } from "./context.js";

const execFileAsync = promisify(execFile);

export interface PlanningContextRequest {
  /** Org home root (contains TASTE.md). */
  orgHome: string;
  /** App repo checkout/worktree (may contain .operon/TASTE.md). */
  appWorkdir: string;
  app: string;
  role: RoleConfig;
  topic?: string;
}

export interface PlanningContext {
  systemPrompt: string;
  openingTask: string;
  byteSize: number;
  sources: string[];
}

export async function assemblePlanningContext(
  request: PlanningContextRequest,
): Promise<PlanningContext> {
  const openingTask = request.topic
    ? `Co-planning topic: ${request.topic}`
    : `Co-planning session for ${request.app}`;
  const assembled = await assembleContext({
    orgHome: request.orgHome,
    appWorkdir: request.appWorkdir,
    app: request.app,
    role: request.role,
    taskText: openingTask,
  });
  return {
    systemPrompt: assembled.systemPrompt,
    openingTask,
    byteSize: assembled.byteSize,
    sources: assembled.sources,
  };
}

export interface ClaudeInvocation {
  command: string;
  args: string[];
  cwd: string;
}

export function buildClaudeInvocation(context: PlanningContext, cwd: string): ClaudeInvocation {
  return {
    command: "claude",
    args: ["--append-system-prompt", context.systemPrompt, context.openingTask],
    cwd,
  };
}

export interface PlanningWorktree {
  sourceRepo: string;
  path: string;
  branch: string;
  /** Only set when createPlanningWorktree created the parent temp dir. */
  tempParent?: string;
}

export interface CreatePlanningWorktreeOptions {
  slug: string;
  parentDir?: string;
}

/** Create a planning branch/worktree from main. The caller decides whether
 * and when to clean it up; tests and dry-runs use cleanupPlanningWorktree. */
export async function createPlanningWorktree(
  sourceRepoIn: string,
  options: CreatePlanningWorktreeOptions,
): Promise<PlanningWorktree> {
  const sourceRepo = resolve(sourceRepoIn);
  const branch = `op/plan-${slugify(options.slug)}`;
  let parentDir: string;
  let tempParent: string | undefined;
  if (options.parentDir) {
    parentDir = resolve(options.parentDir);
    await mkdir(parentDir, { recursive: true });
  } else {
    tempParent = await mkPlanTempDir();
    parentDir = tempParent;
  }

  const path = join(parentDir, branch.replace(/\//g, "-"));
  await git(sourceRepo, ["worktree", "add", "-b", branch, path, "main"]);
  return {
    sourceRepo,
    path,
    branch,
    ...(tempParent ? { tempParent } : {}),
  };
}

async function mkPlanTempDir(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), "operon-plan-"));
}

export async function cleanupPlanningWorktree(worktree: PlanningWorktree): Promise<void> {
  await git(worktree.sourceRepo, ["worktree", "remove", "--force", worktree.path]).catch(() => {});
  await git(worktree.sourceRepo, ["branch", "-D", worktree.branch]).catch(() => {});
  if (worktree.tempParent) await rm(worktree.tempParent, { recursive: true, force: true });
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}: ${err.stderr ?? err.stdout ?? err.message ?? String(e)}`,
    );
  }
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "session";
}

export interface PreparePlanSessionOptions {
  appName: string;
  topic?: string;
  /** App registry path; defaults to `${orgHome}/apps.yaml`. */
  appsPath?: string;
  /** Org home root; defaults to cwd. */
  orgHome?: string;
  /** High-churn runtime state root; defaults to ~/.operon/<org>. */
  runtimeHome?: string;
  /** roles.yaml path; defaults to `${orgHome}/roles.yaml`. */
  rolesPath?: string;
  /** App repo checkout/worktree; defaults to the local app checkout resolver. */
  workdir?: string;
  /** Parent dir for the planning worktree; test hook. */
  worktreeParent?: string;
}

export interface PlanSession {
  app: AppEntry;
  plannerRole: RoleConfig;
  context: PlanningContext;
  worktree: PlanningWorktree;
  invocation: ClaudeInvocation;
}

export async function preparePlanSession(
  options: PreparePlanSessionOptions,
): Promise<PlanSession> {
  const orgHome = resolve(options.orgHome ?? process.cwd());
  const appsPath = resolve(options.appsPath ?? join(orgHome, "apps.yaml"));
  const rolesPath = resolve(options.rolesPath ?? join(orgHome, "roles.yaml"));
  const appsFile = await loadApps(appsPath);
  const app = appsFile.apps.find((a) => a.name === options.appName);
  if (!app) {
    throw new Error(
      `plan: app "${options.appName}" not found in ${appsPath} ` +
        `(available: ${appsFile.apps.map((a) => a.name).join(", ")})`,
    );
  }

  const rolesFile = await loadRoles(rolesPath);
  const plannerRole = rolesFile.roles.find((r) => r.name === "planner");
  if (!plannerRole) throw new Error(`plan: roles.yaml has no planner role (${rolesPath})`);
  if (plannerRole.runtime !== "claude") {
    throw new Error(`plan: co-planning v1 requires planner.runtime=claude (got ${plannerRole.runtime})`);
  }

  const appWorkdir = resolveAppWorkdir(app, {
    orgRoot: orgHome,
    runtimeHome: options.runtimeHome ?? join(homedir(), ".operon", appsFile.org.name),
    ...(options.workdir !== undefined ? { explicitWorkdir: options.workdir } : {}),
  });

  const contextOptions: PlanningContextRequest = {
    orgHome,
    appWorkdir,
    app: app.name,
    role: plannerRole,
  };
  if (options.topic !== undefined) contextOptions.topic = options.topic;
  const context = await assemblePlanningContext(contextOptions);
  const worktree = await createPlanningWorktree(appWorkdir, {
    slug: options.topic ?? app.name,
    ...(options.worktreeParent ? { parentDir: options.worktreeParent } : {}),
  });
  const invocation = buildClaudeInvocation(context, worktree.path);

  return { app, plannerRole, context, worktree, invocation };
}

export async function spawnClaude(invocation: ClaudeInvocation, signal?: AbortSignal): Promise<number> {
  const child = spawn(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    stdio: "inherit",
    // The native CLI may create adapter/tool descendants. Give it a process
    // group that Operon owns so cancellation reaches the whole tree.
    detached: process.platform !== "win32",
  });
  return new Promise((resolveCode, reject) => {
    let forceTimer: NodeJS.Timeout | undefined;
    const stop = (): void => {
      terminateOwnedProcess(child.pid, "SIGTERM");
      forceTimer = setTimeout(() => terminateOwnedProcess(child.pid, "SIGKILL"), 1_000);
      forceTimer.unref?.();
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", stop);
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      reject(error);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", stop);
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      resolveCode(signal?.aborted ? abortExitCode(signal.reason) : code ?? 1);
    });
  });
}

function terminateOwnedProcess(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    if (process.platform !== "win32") process.kill(-pid, signal);
    else process.kill(pid, signal);
  } catch {
    // The whole group has already exited.
  }
}

function abortExitCode(reason: unknown): number {
  if (reason !== null && typeof reason === "object") {
    const text = (reason as Record<string, unknown>)["reason"];
    if (typeof text === "string" && text.includes("SIGTERM")) return 143;
  }
  return 130;
}

export async function recordPlanTelemetry(options: {
  orgDir: string;
  role: RoleConfig;
  app: string;
  status: TurnResult["status"];
  startedAt: Date;
  endedAt: Date;
}): Promise<void> {
  const wallClockMs = Math.max(0, options.endedAt.getTime() - options.startedAt.getTime());
  // The interactive session runs through the native CLI with inherited stdio:
  // its tokens flow to the operator's terminal and never through Operon, so
  // there is no usage to record. Zeros alone would silently sum into budget
  // totals as if the session were free — mark the row `unmeasured` so readers
  // report "cost unknown" instead of "cost zero" (telemetry doc Defect A; the
  // real fix is the non-interactive runtime-backed planning mode, Stage 4).
  const result: TurnResult = {
    status: options.status,
    summary: "manual planner co-planning session",
    artifacts: [],
    session: { runtime: "claude", id: `plan-${options.startedAt.toISOString()}` },
    usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns: 0, wallClockMs },
    escalations: [],
  };
  await recordTurn(
    options.orgDir,
    toRecord(options.role, result, options.endedAt, {
      app: options.app,
      trigger: "manual",
      unmeasured: true,
    }),
  );
}
