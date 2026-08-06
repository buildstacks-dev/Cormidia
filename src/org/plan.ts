// Token-free manual planning preview (architecture.md §8): resolve one app,
// assemble the shared Planner context, and create a disposable worktree from
// the fetched remote default-branch tip. Live planning itself runs through the
// EpisodePlanner boundary; this module never constructs or spawns a provider.

import { mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadApps, type AppEntry } from "./apps.js";
import { baseRevisionForBranch, resolveRemoteDefaultBranch, type BaseRevision } from "../loop/default-branch.js";
import { resolveAppWorkdir } from "./app-workdir.js";
import { loadRoles } from "./roles.js";
import type { RoleConfig } from "../runtime/types.js";
import { assembleContext } from "./context.js";

const execFileAsync = promisify(execFile);

export interface PlanningContextRequest {
  /** Org home root (contains TASTE.md). */
  orgHome: string;
  /** App repo checkout/worktree (may contain .cormidia/TASTE.md). */
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

export async function assemblePlanningContext(request: PlanningContextRequest): Promise<PlanningContext> {
  const openingTask = request.topic ? `Co-planning topic: ${request.topic}` : `Co-planning session for ${request.app}`;
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

export interface PlanningWorktree {
  sourceRepo: string;
  path: string;
  branch: string;
  /** The resolved base the worktree was actually cut from — the fetched
   *  remote-tracking tip, so the caller can report what the session is
   *  planning against rather than assuming. */
  base: BaseRevision;
  /** Only set when createPlanningWorktree created the parent temp dir. */
  tempParent?: string;
}

export interface CreatePlanningWorktreeOptions {
  slug: string;
  parentDir?: string;
  /** Skip the network fetch and cut from whatever the local clone already has.
   *  Only for callers with no reachable remote (offline tests). Production
   *  planning never sets this: the whole point is to not plan against a stale
   *  tree (#60). */
  skipFetch?: boolean;
}

/** Create a planning branch/worktree from the *fetched* remote default-branch
 * tip. The caller decides whether and when to clean it up; tests and dry-runs
 * use cleanupPlanningWorktree.
 *
 * Two things used to go wrong here, and both produced a session that looked
 * healthy while planning against the wrong tree (#60). The base branch was
 * hardcoded `main`, so a `master` repo failed outright; and nothing fetched
 * first, so even a `main` repo cut from whatever the managed clone last saw —
 * a co-planning session could therefore reason about product truth that was
 * days stale, with nothing in the transcript saying so.
 *
 * Both failure modes now stop the session instead of degrading it: an
 * unreachable remote or an unresolvable default branch throws before any
 * worktree exists, so there is never a stale worktree to launch into. */
export async function createPlanningWorktree(
  sourceRepoIn: string,
  options: CreatePlanningWorktreeOptions,
): Promise<PlanningWorktree> {
  const sourceRepo = resolve(sourceRepoIn);
  const branch = `op/plan-${slugify(options.slug)}`;

  // Resolve and fetch BEFORE creating anything: a failure here must leave no
  // worktree behind for an operator to accidentally plan in.
  const defaultBranch = resolveRemoteDefaultBranch("origin", {
    cwd: sourceRepo,
    errorPrefix: "plan",
  });
  if (options.skipFetch !== true) {
    await git(sourceRepo, ["fetch", "--quiet", "origin", defaultBranch]);
  }
  const base = baseRevisionForBranch(defaultBranch);
  // Prove the fetched tip actually exists before cutting from it, so the
  // failure names the missing ref instead of surfacing as a worktree error.
  await git(sourceRepo, ["rev-parse", "--verify", "--quiet", `${base.ref}^{commit}`]);

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
  await git(sourceRepo, ["worktree", "add", "-b", branch, path, base.ref]);
  return {
    sourceRepo,
    path,
    branch,
    base,
    ...(tempParent ? { tempParent } : {}),
  };
}

async function mkPlanTempDir(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), "cormidia-plan-"));
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
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${err.stderr ?? err.stdout ?? err.message ?? String(e)}`);
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
  /** High-churn runtime state root; defaults to ~/.cormidia/<org>. */
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
}

export async function preparePlanSession(options: PreparePlanSessionOptions): Promise<PlanSession> {
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

  const appWorkdir = resolveAppWorkdir(app, {
    orgRoot: orgHome,
    runtimeHome: options.runtimeHome ?? join(homedir(), ".cormidia", appsFile.org.name),
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

  return { app, plannerRole, context, worktree };
}
