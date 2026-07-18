// Archive-backed app reset. This is an explicit human lifecycle operation:
// preserve the selected app's Operon-owned state, close only identifiable
// Operon GitHub work, then remove the app registration and managed state.
// It never touches a human checkout, a repository's default branch, or the
// GitHub repository itself.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { AppEntry, AppsFile } from "./apps.js";
import { loadApps, removeExistingApp } from "./apps.js";
import { acquireLock, releaseLock } from "./locks.js";
import { listJournals, type TurnJournal } from "./journal.js";
import { loadRoles } from "./roles.js";
import { readStatusRows } from "../runtime/runlog/status.js";
import type { GhIssue, GhOps, GhPullRequest } from "../loop/github.js";
import { onboardingAnswersPath } from "./onboarding-answers.js";
import { markAppEpisodesResetAbandoned } from "./learning/episode.js";
import { readLifecycleRecord } from "./app-lifecycle.js";
import {
  LIFECYCLE_SCHEMA_VERSION,
  type LifecycleBlocker,
  type LifecycleFaultHook,
  assertDirectoryNoSymlink,
  assertRegularFile,
  assertSafeRelativePath,
  emitLifecycleStep,
  processIsAlive,
  sha256,
  stableJson,
  writeLifecycleFileAtomic,
} from "./lifecycle.js";

const RESET_SCHEMA_VERSION = LIFECYCLE_SCHEMA_VERSION;
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
  /** In-memory test injection only; never exposed by the CLI. */
  fault?: LifecycleFaultHook;
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
  blockers: LifecycleBlocker[];
  /** Durable normalized answer record copied to archive-root/answers.json. */
  answersPath: string | null;
}

export interface AppResetResult {
  plan: AppResetPlan;
  archivePath: string;
}

interface ResetIntent {
  schema_version: typeof LIFECYCLE_SCHEMA_VERSION;
  kind: "app-reset-intent";
  app: string;
  org_home: string;
  state_home: string;
  archive_root: string;
  archive_id: string;
  github: ResetGitHubPlan;
}

interface ResetRoleLock {
  path: string;
  role: string;
  turnId: string;
  pid: number;
}

function resetIntentPath(stateHome: string, app: string): string {
  assertSafeAppSegment(app);
  return join(resolve(stateHome), "lifecycle", "transactions", `reset-${app}.json`);
}

async function readResetIntent(stateHome: string, app: string): Promise<ResetIntent | undefined> {
  const path = resetIntentPath(stateHome, app);
  if (!existsSync(path)) return undefined;
  await assertRegularFile(path, "app reset intent");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`app reset: corrupt recovery intent ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`app reset: corrupt recovery intent ${path}`);
  const intent = value as Partial<ResetIntent>;
  if (
    intent.schema_version !== LIFECYCLE_SCHEMA_VERSION ||
    intent.kind !== "app-reset-intent" ||
    intent.app !== app ||
    typeof intent.org_home !== "string" ||
    typeof intent.state_home !== "string" ||
    typeof intent.archive_root !== "string" ||
    typeof intent.archive_id !== "string" ||
    !intent.github || typeof intent.github !== "object"
  ) throw new Error(`app reset: corrupt recovery intent ${path}`);
  return intent as ResetIntent;
}

function validateResetIntent(
  intent: ResetIntent | undefined,
  expected: { app: string; orgHome: string; stateHome: string; archiveRoot: string },
): ResetIntent | undefined {
  if (intent === undefined) return undefined;
  if (
    intent.app !== expected.app ||
    resolve(intent.org_home) !== expected.orgHome ||
    resolve(intent.state_home) !== expected.stateHome ||
    resolve(intent.archive_root) !== expected.archiveRoot ||
    !intent.archive_id.startsWith(`${safeSegment(expected.app)}-reset-`)
  ) throw new Error("app reset: an interrupted reset intent conflicts with the selected app or homes");
  return intent;
}

async function writeResetIntent(plan: AppResetPlan): Promise<void> {
  const path = resetIntentPath(plan.stateHome, plan.app.name);
  const intent: ResetIntent = {
    schema_version: LIFECYCLE_SCHEMA_VERSION,
    kind: "app-reset-intent",
    app: plan.app.name,
    org_home: plan.orgHome,
    state_home: plan.stateHome,
    archive_root: plan.archiveRoot,
    archive_id: plan.archiveId,
    github: plan.github,
  };
  if (existsSync(path)) {
    const existing = await readResetIntent(plan.stateHome, plan.app.name);
    if (stableJson(existing) !== stableJson(intent)) throw new Error("app reset: reviewed plan conflicts with interrupted reset intent");
    return;
  }
  await writeLifecycleFileAtomic(path, stableJson(intent));
}

/** Completes the terminal evidence/intent cleanup when a process died after
 * the atomic registry removal. At that point remote and local cleanup already
 * precede the registry boundary, so this is an idempotent finalization. */
export async function finalizeInterruptedAppReset(
  stateHome: string,
  app: string,
  archivePath: string,
): Promise<void> {
  const manifest = await verifyResetArchive(archivePath, app);
  const archiveId = String(manifest["archive_id"]);
  await markAppEpisodesResetAbandoned(stateHome, app, new Date());
  await emitLifecycleStep({
    stateHome,
    app,
    operation: "app reset",
    inputFingerprint: archiveId,
    status: "completed",
    reason: `reset archived at ${resolve(archivePath)}`,
  });
  await rm(resetIntentPath(stateHome, app), { force: true });
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
  const [status, journals, locks, approvals, issues, pullRequests, existingIntent] = await Promise.all([
    readStatusRows(stateHome, { app: app.name }),
    listJournals(stateHome),
    listAppLocks(stateHome, app.name),
    listAppApprovalFiles(stateHome, app.name),
    options.gh.listIssues({ state: "open", limit: 100 }),
    options.gh.listPullRequests({ state: "open", limit: 100 }),
    readResetIntent(stateHome, app.name),
  ]);

  const managedIssues = issues.filter((issue) => isOperonManagedIssue(issue));
  const managedIssueNumbers = new Set(managedIssues.map((issue) => issue.number));
  const managedPullRequests = pullRequests.filter(
    (pr) => pr.headRefName.startsWith("op/") || linkedIssueNumbers(pr.body).some((n) => managedIssueNumbers.has(n)),
  );
  // Never propose deleting a branch that something is merging INTO. The old
  // guard excluded the literal `main`, which protects nothing in a repo whose
  // default branch is `master` or `trunk` — reset could propose deleting the
  // default branch itself (#101).
  //
  // Two independent protections, because neither alone is sufficient:
  //
  //  - Every open pull request's own base. Authoritative, needs no extra
  //    network call, and correct under any default-branch name.
  //  - The app's recorded default branch. The PR-derived set only protects a
  //    branch that some open PR happens to target, so a default branch that
  //    appears as a managed PR's HEAD (a human opening `main` → `production`
  //    on a PR that links a managed issue) would otherwise slip through. The
  //    old `!== "main"` guard was unconditional; this keeps that property
  //    while being correct for every branch name.
  const mergeTargets = new Set(pullRequests.map((pr) => pr.baseRefName).filter(Boolean));
  const recordedDefault = await safeRecordedDefaultBranch(stateHome, app.name);
  if (recordedDefault !== undefined) mergeTargets.add(recordedDefault);
  const branches = [...new Set(managedPullRequests.map((pr) => pr.headRefName))]
    .filter((branch) => branch.length > 0 && !mergeTargets.has(branch))
    .sort();
  const now = options.now ?? new Date();
  const runningRows = status.filter((row) => row.status === "running");
  const staleRuns = runningRows.filter((row) => isStaleRun(row, now)).map((row) => row.runId);
  const activeRuns = runningRows.filter((row) => !isStaleRun(row, now)).map((row) => row.runId);
  const activeJournals = journals
    .filter((journal) => journal.app === app.name && ACTIVE_JOURNAL_PHASES.has(journal.phase))
    .map(({ turnId, role, phase }) => ({ turnId, role, phase }));
  const pendingApprovalIds = approvals.filter((item) => item.kind === "pending").map((item) => item.id);

  const currentGithub: ResetGitHubPlan = {
    issues: managedIssues.map(({ number, title, url }) => ({ number, title, ...(url ? { url } : {}) })),
    pullRequests: managedPullRequests.map(({ number, title, headRefName, url }) => ({
      number,
      title,
      headRefName,
      ...(url ? { url } : {}),
    })),
    branches,
  };
  const archiveIdentity = sha256(stableJson({
    app: { name: app.name, repo: app.repo },
    activeRuns,
    staleRuns,
    activeJournals,
    approvals: approvals.map((item) => `${item.kind}:${item.id}`),
    github: {
      issues: currentGithub.issues.map((issue) => issue.number),
      pullRequests: currentGithub.pullRequests.map((pr) => pr.number),
      branches: currentGithub.branches,
    },
  }));
  const predictedArchiveId = `${safeSegment(app.name)}-reset-${archiveIdentity.slice(0, 16)}`;
  const intent = validateResetIntent(existingIntent, { app: app.name, orgHome, stateHome, archiveRoot });
  const archiveId = intent?.archive_id ?? predictedArchiveId;
  const github = intent?.github ?? currentGithub;
  const resetTurnId = `reset-${archiveId}`;
  const activeLocks = locks.filter((lock) => !(lock.turnId === resetTurnId && !processIsAlive(lock.pid)));

  const blockers: LifecycleBlocker[] = [
    ...(activeRuns.length > 0
      ? [{ code: "active_run" as const, ids: activeRuns, forceEligible: false, remediation: "wait for the run to terminate or cancel it through its owning workflow" }]
      : []),
    ...(!options.force && staleRuns.length > 0
      ? [{ code: "stale_run" as const, ids: staleRuns, forceEligible: true, remediation: `rerun with --force after confirming the heartbeat is abandoned; --force crosses only these stale runs` }]
      : []),
    ...(activeJournals.length > 0
      ? [{ code: "active_journal" as const, ids: activeJournals.map((journal) => journal.turnId), forceEligible: false, remediation: "resume or terminalize each journal before reset" }]
      : []),
    ...(activeLocks.length > 0
      ? [{ code: "active_lock" as const, ids: activeLocks.map((lock) => basename(lock.path)), forceEligible: false, remediation: "allow the lock holder to finish; --force never crosses locks" }]
      : []),
    ...(pendingApprovalIds.length > 0
      ? [{ code: "pending_approval" as const, ids: pendingApprovalIds, forceEligible: false, remediation: "decide or withdraw each pending approval through the operator boundary" }]
      : []),
  ];

  const answersPath = onboardingAnswersPath(stateHome, app.name);
  return {
    app,
    orgHome,
    stateHome,
    archiveRoot,
    archiveId,
    managedPaths,
    approvalFiles: approvals.map((item) => item.path),
    activeRuns,
    staleRuns,
    activeJournals,
    activeLocks: activeLocks.map((lock) => lock.path),
    pendingApprovalIds,
    github,
    blockers,
    answersPath: existsSync(answersPath) ? answersPath : null,
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
    throw new Error(
      `app reset: cannot reset "${plan.app.name}" while ` +
        plan.blockers.map((blocker) => `${blocker.code}: ${blocker.ids.join(", ")}`).join("; "),
    );
  }

  const roles = (await loadRoles(join(plan.orgHome, "roles.yaml"))).roles.map((role) => role.name);
  const lockTurnId = `reset-${plan.archiveId}`;
  const acquired: string[] = [];
  try {
    for (const role of roles) {
      let result = await acquireLock(plan.stateHome, {
        app: plan.app.name,
        role,
        turnId: lockTurnId,
      });
      if (!result.acquired && result.lock.turnId === lockTurnId && !processIsAlive(result.lock.pid)) {
        await releaseLock(plan.stateHome, plan.app.name, role);
        result = await acquireLock(plan.stateHome, {
          app: plan.app.name,
          role,
          turnId: lockTurnId,
        });
      }
      if (!result.acquired) {
        throw new Error(
          `app reset: cannot reserve ${plan.app.name}/${role}; active turn ${result.lock.turnId} holds the lock`,
        );
      }
      acquired.push(role);
    }

    const startedAt = options.now ?? new Date();
    await writeResetIntent(plan);
    const archivePath = await createArchive(plan, options.fault);
    try {
      await closeManagedGitHubWork(options.gh, plan.github, options.fault);
      await removeLocalAppState(plan);
      await options.fault?.("before_registry_write");
      const current = await loadApps(join(plan.orgHome, "apps.yaml"));
      if (current.apps.some((app) => app.name === plan.app.name)) {
        await removeExistingApp(plan.orgHome, plan.app.name);
      }
      await options.fault?.("after_registry_write");
    } catch (error) {
      await restoreResetArchive(plan, archivePath);
      throw error;
    }
    await markAppEpisodesResetAbandoned(plan.stateHome, plan.app.name, options.now ?? new Date());
    await emitLifecycleStep({
      stateHome: plan.stateHome,
      app: plan.app.name,
      operation: "app reset",
      inputFingerprint: plan.archiveId,
      status: "completed",
      reason: `reset archived at ${archivePath}`,
      startedAt,
      finishedAt: options.now ?? new Date(),
    });
    await rm(resetIntentPath(plan.stateHome, plan.app.name), { force: true });
    return { plan, archivePath };
  } finally {
    await Promise.all(acquired.map((role) => releaseLock(plan.stateHome, plan.app.name, role)));
  }
}

async function closeManagedGitHubWork(
  gh: GhOps,
  github: ResetGitHubPlan,
  fault?: LifecycleFaultHook,
): Promise<void> {
  // A PR must close before its head branch is removed. GitHub preserves the
  // historical PR/issue record; reset promises a clean *open* work surface,
  // not impossible history deletion.
  const openPrs = new Set((await gh.listPullRequests({ state: "open", limit: 100 })).map((pr) => pr.number));
  for (const pr of github.pullRequests) {
    if (!openPrs.has(pr.number)) continue;
    await fault?.("before_pull_request_update");
    await gh.closePullRequest(pr.number);
    await fault?.("after_pull_request_update");
  }
  const openIssues = new Set((await gh.listIssues({ state: "open", limit: 100 })).map((issue) => issue.number));
  for (const issue of github.issues) {
    if (!openIssues.has(issue.number)) continue;
    await fault?.("before_issue_update");
    await gh.closeIssue(issue.number);
    await fault?.("after_issue_update");
  }
  for (const branch of github.branches) {
    await fault?.("before_branch_update");
    try {
      await gh.deleteBranch(branch);
    } catch (error) {
      if (!isMissingBranchError(error)) throw error;
    }
    await fault?.("after_branch_update");
  }
}

async function removeLocalAppState(plan: AppResetPlan): Promise<void> {
  for (const target of plan.managedPaths) await rm(target, { recursive: true, force: true });
  for (const path of plan.approvalFiles) await rm(path, { force: true });
  if (plan.answersPath !== null) await rm(plan.answersPath, { force: true });
  await filterSharedJsonl(join(plan.stateHome, "telemetry"), plan.app.name);
  await filterSharedJsonl(join(plan.stateHome, "invocations"), plan.app.name);
  await clearAppSchedule(plan.stateHome, plan.app.name);
  await clearAppBudgetOverlay(plan.stateHome, plan.app.name);
}

async function createArchive(plan: AppResetPlan, fault?: LifecycleFaultHook): Promise<string> {
  const target = join(plan.archiveRoot, plan.archiveId);
  const staged = `${target}.partial`;
  if (existsSync(target)) {
    await verifyExistingArchive(target, plan);
    await writeArchivePointer(plan, target);
    return target;
  }
  await fault?.("before_archive_creation");
  await mkdir(plan.archiveRoot, { recursive: true });
  await rm(staged, { recursive: true, force: true });
  await mkdir(staged, { recursive: true });
  try {
    await copyIfPresent(join(plan.orgHome, "apps.yaml"), join(staged, "org", "apps.yaml"));
    if (plan.answersPath !== null) await copyIfPresent(plan.answersPath, join(staged, "answers.json"));
    for (const source of plan.managedPaths) {
      await copyIfPresent(source, join(staged, "state", relative(plan.stateHome, source)));
    }
    for (const source of plan.approvalFiles) {
      await copyIfPresent(source, join(staged, "state", relative(plan.stateHome, source)));
    }
    for (const rel of ["telemetry", "invocations", "state/schedule.json", "state/budget-overlay.json"]) {
      await copyIfPresent(join(plan.stateHome, rel), join(staged, "state", rel));
    }
    await fault?.("after_archive_creation");
    await fault?.("before_archive_checksum");
    await writeFile(join(staged, "github.json"), stableJson(plan.github), "utf8");
    const files = await archiveFiles(staged);
    await writeFile(
      join(staged, "manifest.json"),
      stableJson({
        schema_version: RESET_SCHEMA_VERSION,
        kind: "app-reset",
        archive_id: plan.archiveId,
        app: { name: plan.app.name, repo: plan.app.repo },
        org_home: plan.orgHome,
        state_home: plan.stateHome,
        managed_paths: plan.managedPaths,
        github: plan.github,
        files,
      }),
      "utf8",
    );
    await fault?.("after_archive_checksum");
    await fault?.("before_archive_rename");
    await rename(staged, target);
    await fault?.("after_archive_rename");
    await writeArchivePointer(plan, target);
    return target;
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
}

async function writeArchivePointer(plan: AppResetPlan, archivePath: string): Promise<void> {
  const manifest = await readFile(join(archivePath, "manifest.json"));
  await writeLifecycleFileAtomic(
    join(plan.archiveRoot, `${safeSegment(plan.app.name)}-latest.json`),
    stableJson({
      schema_version: RESET_SCHEMA_VERSION,
      kind: "app-reset-latest",
      app: plan.app.name,
      archive_id: plan.archiveId,
      manifest_sha256: sha256(manifest),
    }),
  );
}

async function restoreResetArchive(plan: AppResetPlan, archivePath: string): Promise<void> {
  const registry = join(archivePath, "org", "apps.yaml");
  if (existsSync(registry)) {
    await writeLifecycleFileAtomic(join(plan.orgHome, "apps.yaml"), await readFile(registry, "utf8"));
  }
  const state = join(archivePath, "state");
  if (existsSync(state)) await cp(state, plan.stateHome, { recursive: true, force: true });
  const answers = join(archivePath, "answers.json");
  if (plan.answersPath !== null && existsSync(answers)) {
    await mkdir(dirname(plan.answersPath), { recursive: true });
    await cp(answers, plan.answersPath, { force: true });
  }
}

async function verifyExistingArchive(target: string, plan: AppResetPlan): Promise<void> {
  const manifest = await verifyResetArchive(target, plan.app.name);
  if (manifest["kind"] !== "app-reset" || manifest["archive_id"] !== plan.archiveId) {
    throw new Error(`app reset: conflicting archive already exists at ${target}`);
  }
  const app = manifest["app"] as Record<string, unknown> | undefined;
  if (app?.["name"] !== plan.app.name || app?.["repo"] !== plan.app.repo) {
    throw new Error(`app reset: archive identity mismatch at ${target}`);
  }
}

async function verifyResetArchive(targetIn: string, appName: string): Promise<Record<string, unknown>> {
  const target = await assertDirectoryNoSymlink(resolve(targetIn), "app reset archive");
  const manifestPath = join(target, "manifest.json");
  await assertRegularFile(manifestPath, "app reset archive manifest");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const app = manifest["app"] as Record<string, unknown> | undefined;
  if (
    manifest["schema_version"] !== RESET_SCHEMA_VERSION ||
    manifest["kind"] !== "app-reset" ||
    typeof manifest["archive_id"] !== "string" ||
    app?.["name"] !== appName
  ) throw new Error(`app reset: invalid archive identity at ${target}`);
  const files = manifest["files"];
  if (!Array.isArray(files)) throw new Error(`app reset: archive manifest has no files list at ${target}`);
  const declaredPaths: string[] = [];
  for (const item of files) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`app reset: invalid archive file record`);
    const spec = item as Record<string, unknown>;
    if (typeof spec["path"] !== "string" || typeof spec["sha256"] !== "string" || typeof spec["bytes"] !== "number") {
      throw new Error(`app reset: invalid archive file record`);
    }
    assertSafeRelativePath(spec["path"], "app reset archive");
    declaredPaths.push(spec["path"]);
    const file = join(target, spec["path"]);
    await assertRegularFile(file, "app reset archive file");
    const content = await readFile(file);
    if (content.byteLength !== spec["bytes"] || createHash("sha256").update(content).digest("hex") !== spec["sha256"]) {
      throw new Error(`app reset: archive checksum mismatch for ${spec["path"]}`);
    }
  }
  const actualPaths = (await archiveFiles(target))
    .map((entry) => entry.path)
    .filter((path) => path !== "manifest.json")
    .sort();
  if (stableJson(actualPaths) !== stableJson([...declaredPaths].sort())) {
    throw new Error(`app reset: archive contains unchecksummed or missing paths at ${target}`);
  }
  return manifest;
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
      if (entry.isSymbolicLink()) throw new Error(`app reset: symlink archive entry forbidden: ${path}`);
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
    join(stateHome, "standing-roles", app),
    join(stateHome, "lifecycle", "apps", app),
    join(stateHome, "lifecycle", "readiness", `${app}.json`),
  ];
}

function isOperonManagedIssue(issue: GhIssue): boolean {
  return issue.labels.some((label) => label.startsWith(OPERATIONAL_LABEL_PREFIX));
}

function linkedIssueNumbers(body: string): number[] {
  return [...body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)].map((match) => Number(match[1]));
}

function isMissingBranchError(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return /(?:404|422|not found|does not exist|remote ref does not exist|reference does not exist)/i.test(detail);
}

function isStaleRun(
  row: { startedAt: string; lastSeenAt?: string },
  now: Date,
): boolean {
  const heartbeat = new Date(row.lastSeenAt ?? row.startedAt).getTime();
  return Number.isFinite(heartbeat) && now.getTime() - heartbeat > RESET_STALE_RUN_MS;
}

async function listAppLocks(stateHome: string, app: string): Promise<ResetRoleLock[]> {
  const dir = join(stateHome, "locks");
  if (!existsSync(dir)) return [];
  const paths = (await readdir(dir))
    .filter((name) => name.startsWith(`${app}--`) && name.endsWith(".lock"))
    .sort()
    .map((name) => join(dir, name));
  const locks: ResetRoleLock[] = [];
  for (const path of paths) {
    await assertRegularFile(path, "app reset role lock");
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    if (typeof value["role"] !== "string" || typeof value["turnId"] !== "string" || typeof value["pid"] !== "number") {
      throw new Error(`app reset: corrupt role lock ${path}`);
    }
    locks.push({ path, role: value["role"], turnId: value["turnId"], pid: value["pid"] });
  }
  return locks;
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
    if (removed) await writeLifecycleFileAtomic(path, keep.join("\n"));
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
  if (changed) await writeLifecycleFileAtomic(path, stableJson(schedule));
}

async function clearAppBudgetOverlay(stateHome: string, app: string): Promise<void> {
  const path = join(stateHome, "state", "budget-overlay.json");
  if (!existsSync(path)) return;
  const overlay = JSON.parse(await readFile(path, "utf8")) as { pausedApps?: unknown };
  if (!Array.isArray(overlay.pausedApps)) return;
  const next = overlay.pausedApps.filter((name) => name !== app);
  if (next.length === overlay.pausedApps.length) return;
  await writeLifecycleFileAtomic(path, stableJson({ ...overlay, pausedApps: next }));
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

/** The default branch recorded for this app at bootstrap, when one exists.
 *
 *  Read from the durable lifecycle record rather than the network: reset is a
 *  planning operation and must not fail because a remote is unreachable. A
 *  missing or unreadable record simply contributes no extra protection — the
 *  pull-request-derived merge targets still apply (#101). */
async function safeRecordedDefaultBranch(
  stateHome: string,
  app: string,
): Promise<string | undefined> {
  try {
    const record = await readLifecycleRecord(stateHome, app);
    const branch = record.default_branch;
    return typeof branch === "string" && branch.length > 0 ? branch : undefined;
  } catch {
    return undefined;
  }
}
