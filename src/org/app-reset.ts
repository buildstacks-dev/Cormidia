// Archive-backed app reset. This is an explicit human lifecycle operation:
// preserve the selected app's Operon-owned state, close only identifiable
// Operon GitHub work, then remove the app registration and managed state.
// It never touches a human checkout, a repository's default branch, or the
// GitHub repository itself.

import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { AppEntry, AppsFile } from "./apps.js";
import { removeExistingApp } from "./apps.js";
import { acquireLock, releaseLock } from "./locks.js";
import { listJournals, type TurnJournal } from "./journal.js";
import { loadRoles } from "./roles.js";
import { readStatusRows } from "../runtime/runlog/status.js";
import type { GhIssue, GhOps, GhPullRequest } from "../loop/github.js";

const RESET_SCHEMA_VERSION = 1;
const OPERATIONAL_LABEL_PREFIX = "op:";
const ACTIVE_JOURNAL_PHASES = new Set(["assembling", "running", "collecting", "blocked_on_gate"]);
/** A pass executor beats its envelope about every 30 seconds. Ten minutes is
 * deliberately generous: a reset may force only an abandoned record, never a
 * briefly delayed live pass. Kept aligned with episode stalled-run semantics. */
export const RESET_STALE_RUN_MS = 10 * 60 * 1000;

export interface AppResetOptions {
  orgHome: string;
  stateHome: string;
  appsFile: AppsFile;
  appName: string;
  gh: GhOps;
  /** Archive parent. Defaults to a sibling of the state home so reset can
   * never remove its own backup. */
  archiveRoot?: string;
  /** Permit reset past a `running` envelope whose heartbeat is older than
   * RESET_STALE_RUN_MS. This never bypasses an actual lock, journal, pending
   * approval, or a fresh heartbeat. */
  force?: boolean;
  now?: Date;
}

export interface ResetGitHubPlan {
  issues: Array<Pick<GhIssue, "number" | "title" | "url">>;
  pullRequests: Array<Pick<GhPullRequest, "number" | "title" | "headRefName" | "url">>;
  branches: string[];
}

export interface AppResetPlan {
  app: AppEntry;
  orgHome: string;
  stateHome: string;
  archiveRoot: string;
  archiveId: string;
  managedPaths: string[];
  approvalFiles: string[];
  activeRuns: string[];
  staleRuns: string[];
  activeJournals: Array<Pick<TurnJournal, "turnId" | "role" | "phase">>;
  activeLocks: string[];
  pendingApprovalIds: string[];
  github: ResetGitHubPlan;
  blockers: string[];
}

export interface AppResetResult {
  plan: AppResetPlan;
  archivePath: string;
}

/** Build the complete, non-mutating reset plan. It intentionally performs
 * GitHub reads: the result is the exact operator-reviewable remote inventory
 * an execution would close. */
export async function planAppReset(options: AppResetOptions): Promise<AppResetPlan> {
  const orgHome = resolve(options.orgHome);
  const stateHome = resolve(options.stateHome);
  const app = options.appsFile.apps.find((entry) => entry.name === options.appName);
  if (app === undefined) throw new Error(`app reset: unknown app "${options.appName}" in apps.yaml`);
  assertSafeAppSegment(app.name);

  const archiveRoot = resolve(
    options.archiveRoot ?? join(dirname(stateHome), "archives", safeSegment(options.appsFile.org.name)),
  );
  if (isInside(archiveRoot, stateHome)) {
    throw new Error("app reset: --archive-root must be outside the active state home");
  }

  const managedPaths = managedStatePaths(stateHome, app.name);
  const [status, journals, locks, approvals, issues, pullRequests] = await Promise.all([
    readStatusRows(stateHome, { app: app.name }),
    listJournals(stateHome),
    listAppLockPaths(stateHome, app.name),
    listAppApprovalFiles(stateHome, app.name),
    options.gh.listIssues({ state: "open", limit: 100 }),
    options.gh.listPullRequests({ state: "open", limit: 100 }),
  ]);

  const managedIssues = issues.filter((issue) => isOperonManagedIssue(issue));
  const managedIssueNumbers = new Set(managedIssues.map((issue) => issue.number));
  const managedPullRequests = pullRequests.filter(
    (pr) => pr.headRefName.startsWith("op/") || linkedIssueNumbers(pr.body).some((n) => managedIssueNumbers.has(n)),
  );
  const branches = [...new Set(managedPullRequests.map((pr) => pr.headRefName))]
    .filter((branch) => branch.length > 0 && branch !== "main")
    .sort();
  const now = options.now ?? new Date();
  const runningRows = status.filter((row) => row.status === "running");
  const staleRuns = runningRows.filter((row) => isStaleRun(row, now)).map((row) => row.runId);
  const activeRuns = runningRows.filter((row) => !isStaleRun(row, now)).map((row) => row.runId);
  const activeJournals = journals
    .filter((journal) => journal.app === app.name && ACTIVE_JOURNAL_PHASES.has(journal.phase))
    .map(({ turnId, role, phase }) => ({ turnId, role, phase }));
  const pendingApprovalIds = approvals.filter((item) => item.kind === "pending").map((item) => item.id);

  const blockers = [
    ...(activeRuns.length > 0 ? [`active run(s): ${activeRuns.join(", ")}`] : []),
    ...(!options.force && staleRuns.length > 0
      ? [`stale run(s): ${staleRuns.join(", ")} (use --force to override)`]
      : []),
    ...(activeJournals.length > 0
      ? [`active journal(s): ${activeJournals.map((journal) => journal.turnId).join(", ")}`]
      : []),
    ...(locks.length > 0 ? [`active lock(s): ${locks.map((path) => basename(path)).join(", ")}`] : []),
    ...(pendingApprovalIds.length > 0 ? [`pending approval(s): ${pendingApprovalIds.join(", ")}`] : []),
  ];

  return {
    app,
    orgHome,
    stateHome,
    archiveRoot,
    archiveId: archiveId(app.name, options.now ?? new Date()),
    managedPaths,
    approvalFiles: approvals.map((item) => item.path),
    activeRuns,
    staleRuns,
    activeJournals,
    activeLocks: locks,
    pendingApprovalIds,
    github: {
      issues: managedIssues.map(({ number, title, url }) => ({ number, title, ...(url ? { url } : {}) })),
      pullRequests: managedPullRequests.map(({ number, title, headRefName, url }) => ({
        number,
        title,
        headRefName,
        ...(url ? { url } : {}),
      })),
      branches,
    },
    blockers,
  };
}

/** Execute a reviewed plan. The caller must obtain an explicit user
 * confirmation before reaching here. It reserves every configured role lock
 * first, so a new app turn cannot race the archive and deletion. */
export async function executeAppReset(
  options: AppResetOptions,
  reviewedPlan?: AppResetPlan,
): Promise<AppResetResult> {
  const plan = reviewedPlan ?? (await planAppReset(options));
  if (
    plan.app.name !== options.appName ||
    plan.orgHome !== resolve(options.orgHome) ||
    plan.stateHome !== resolve(options.stateHome)
  ) {
    throw new Error("app reset: reviewed plan does not match the requested app and homes");
  }
  if (plan.blockers.length > 0) {
    throw new Error(`app reset: cannot reset "${plan.app.name}" while ${plan.blockers.join("; ")}`);
  }

  const roles = (await loadRoles(join(plan.orgHome, "roles.yaml"))).roles.map((role) => role.name);
  const lockTurnId = `reset-${plan.archiveId}`;
  const acquired: string[] = [];
  try {
    for (const role of roles) {
      const result = await acquireLock(plan.stateHome, {
        app: plan.app.name,
        role,
        turnId: lockTurnId,
      });
      if (!result.acquired) {
        throw new Error(
          `app reset: cannot reserve ${plan.app.name}/${role}; active turn ${result.lock.turnId} holds the lock`,
        );
      }
      acquired.push(role);
    }

    const archivePath = await createArchive(plan);
    await closeManagedGitHubWork(options.gh, plan.github);
    await removeLocalAppState(plan);
    await removeExistingApp(plan.orgHome, plan.app.name);
    return { plan, archivePath };
  } finally {
    await Promise.all(acquired.map((role) => releaseLock(plan.stateHome, plan.app.name, role)));
  }
}

async function closeManagedGitHubWork(gh: GhOps, github: ResetGitHubPlan): Promise<void> {
  // A PR must close before its head branch is removed. GitHub preserves the
  // historical PR/issue record; reset promises a clean *open* work surface,
  // not impossible history deletion.
  for (const pr of github.pullRequests) await gh.closePullRequest(pr.number);
  for (const issue of github.issues) await gh.closeIssue(issue.number);
  for (const branch of github.branches) await gh.deleteBranch(branch);
}

async function removeLocalAppState(plan: AppResetPlan): Promise<void> {
  for (const target of plan.managedPaths) await rm(target, { recursive: true, force: true });
  for (const path of plan.approvalFiles) await rm(path, { force: true });
  await filterSharedJsonl(join(plan.stateHome, "telemetry"), plan.app.name);
  await filterSharedJsonl(join(plan.stateHome, "invocations"), plan.app.name);
  await clearAppSchedule(plan.stateHome, plan.app.name);
  await clearAppBudgetOverlay(plan.stateHome, plan.app.name);
}

async function createArchive(plan: AppResetPlan): Promise<string> {
  const target = join(plan.archiveRoot, plan.archiveId);
  const staged = `${target}.partial`;
  if (existsSync(target)) throw new Error(`app reset: archive already exists at ${target}`);
  await mkdir(plan.archiveRoot, { recursive: true });
  await rm(staged, { recursive: true, force: true });
  await mkdir(staged, { recursive: true });
  try {
    await copyIfPresent(join(plan.orgHome, "apps.yaml"), join(staged, "org", "apps.yaml"));
    for (const source of plan.managedPaths) {
      await copyIfPresent(source, join(staged, "state", relative(plan.stateHome, source)));
    }
    for (const source of plan.approvalFiles) {
      await copyIfPresent(source, join(staged, "state", relative(plan.stateHome, source)));
    }
    for (const rel of ["telemetry", "invocations", "state/schedule.json", "state/budget-overlay.json"]) {
      await copyIfPresent(join(plan.stateHome, rel), join(staged, "state", rel));
    }
    await writeFile(join(staged, "github.json"), `${JSON.stringify(plan.github, null, 2)}\n`, "utf8");
    const files = await archiveFiles(staged);
    await writeFile(
      join(staged, "manifest.json"),
      `${JSON.stringify(
        {
          schema_version: RESET_SCHEMA_VERSION,
          kind: "app-reset",
          created_at: new Date().toISOString(),
          app: { name: plan.app.name, repo: plan.app.repo },
          org_home: plan.orgHome,
          state_home: plan.stateHome,
          managed_paths: plan.managedPaths,
          github: plan.github,
          files,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await rename(staged, target);
    return target;
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
}

async function copyIfPresent(source: string, target: string): Promise<void> {
  if (!existsSync(source)) return;
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true });
}

async function archiveFiles(root: string): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
  const entries: Array<{ path: string; bytes: number; sha256: string }> = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const content = await readFile(path);
        entries.push({
          path: relative(root, path),
          bytes: content.byteLength,
          sha256: createHash("sha256").update(content).digest("hex"),
        });
      }
    }
  }
  await visit(root);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function managedStatePaths(stateHome: string, app: string): string[] {
  return [
    join(stateHome, "repos", app),
    join(stateHome, "worktrees", app),
    join(stateHome, "runs", app),
    join(stateHome, "tickets", app),
  ];
}

function isOperonManagedIssue(issue: GhIssue): boolean {
  return issue.labels.some((label) => label.startsWith(OPERATIONAL_LABEL_PREFIX));
}

function linkedIssueNumbers(body: string): number[] {
  return [...body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)].map((match) => Number(match[1]));
}

function isStaleRun(
  row: { startedAt: string; lastSeenAt?: string },
  now: Date,
): boolean {
  const heartbeat = new Date(row.lastSeenAt ?? row.startedAt).getTime();
  return Number.isFinite(heartbeat) && now.getTime() - heartbeat > RESET_STALE_RUN_MS;
}

async function listAppLockPaths(stateHome: string, app: string): Promise<string[]> {
  const dir = join(stateHome, "locks");
  if (!existsSync(dir)) return [];
  return (await readdir(dir))
    .filter((name) => name.startsWith(`${app}--`) && name.endsWith(".lock"))
    .sort()
    .map((name) => join(dir, name));
}

interface ApprovalArtifact {
  kind: "pending" | "decided" | "grant";
  id: string;
  path: string;
}

async function listAppApprovalFiles(stateHome: string, app: string): Promise<ApprovalArtifact[]> {
  const root = join(stateHome, "approvals");
  const found: ApprovalArtifact[] = [];
  for (const [kind, dir] of [
    ["pending", "pending"],
    ["decided", "decided"],
    ["grant", "grants"],
  ] as const) {
    const path = join(root, dir);
    if (!existsSync(path)) continue;
    for (const file of (await readdir(path)).filter((name) => name.endsWith(".json")).sort()) {
      const candidate = join(path, file);
      try {
        const record = JSON.parse(await readFile(candidate, "utf8")) as { app?: unknown };
        if (record.app === app) found.push({ kind, id: file.slice(0, -5), path: candidate });
      } catch {
        // An unreadable approval is not attributable enough to delete. The
        // reset leaves it in place, exactly as other approval readers do.
      }
    }
  }
  return found;
}

async function filterSharedJsonl(dir: string, app: string): Promise<void> {
  if (!existsSync(dir)) return;
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort()) {
    const path = join(dir, file);
    const before = await readFile(path, "utf8");
    const lines = before.split("\n");
    const keep: string[] = [];
    let removed = false;
    for (const line of lines) {
      if (line.trim().length === 0) {
        keep.push(line);
        continue;
      }
      try {
        const record = JSON.parse(line) as { app?: unknown };
        if (record.app === app) {
          removed = true;
          continue;
        }
      } catch {
        // Retain malformed lines; rollup readers deliberately tolerate them.
      }
      keep.push(line);
    }
    if (removed) await writeFile(path, keep.join("\n"), "utf8");
  }
}

async function clearAppSchedule(stateHome: string, app: string): Promise<void> {
  const path = join(stateHome, "state", "schedule.json");
  if (!existsSync(path)) return;
  const schedule = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  let changed = false;
  for (const key of Object.keys(schedule)) {
    if (key.startsWith(`${app}|`)) {
      delete schedule[key];
      changed = true;
    }
  }
  if (changed) await writeFile(path, `${JSON.stringify(schedule, null, 2)}\n`, "utf8");
}

async function clearAppBudgetOverlay(stateHome: string, app: string): Promise<void> {
  const path = join(stateHome, "state", "budget-overlay.json");
  if (!existsSync(path)) return;
  const overlay = JSON.parse(await readFile(path, "utf8")) as { pausedApps?: unknown };
  if (!Array.isArray(overlay.pausedApps)) return;
  const next = overlay.pausedApps.filter((name) => name !== app);
  if (next.length === overlay.pausedApps.length) return;
  await writeFile(path, `${JSON.stringify({ ...overlay, pausedApps: next }, null, 2)}\n`, "utf8");
}

function archiveId(app: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${safeSegment(app)}-${randomBytes(4).toString("hex")}`;
}

function safeSegment(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "org";
}

function assertSafeAppSegment(app: string): void {
  if (app === "." || app === ".." || app.includes("/") || app.includes("\\")) {
    throw new Error(`app reset: app name "${app}" cannot be used as a managed path segment`);
  }
}

function isInside(candidate: string, ancestor: string): boolean {
  const rel = relative(ancestor, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(sep));
}
