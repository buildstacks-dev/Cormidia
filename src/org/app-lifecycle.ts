// Deterministic application lifecycle: recovered-answer onboarding into an
// Operon-owned clone, remote/default-branch verification, clone convergence,
// and journaled promotion. A human checkout is an immutable input.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parse, parseDocument } from "yaml";
import { loadGateCommands } from "../loop/driver.js";
import type { GhOps } from "../loop/github.js";
import { CANONICAL_LABELS } from "../loop/plan-tickets.js";
import type { RuntimeKind } from "../runtime/types.js";
import {
  probeRuntimeReadiness,
  type RuntimeReadinessProbe,
  type RuntimeReadinessRequest,
} from "../runtime/readiness.js";
import {
  joinExistingOrg,
  loadApps,
  normalizeAppExecution,
  removeExistingApp,
  updateAppStatus,
  type AppEntry,
} from "./apps.js";
import {
  appArtifactFiles,
  buildOnboardingGapReport,
  emitAppArtifacts,
  parseAnswers,
  scanRepo,
  type BootstrapAnswers,
  type BootstrapRunResult,
} from "./bootstrap.js";
import { resolveAuthority } from "./authority.js";
import { resolveAppAssignments } from "./execution-assignments.js";
import { loadRoles } from "./roles.js";
import { resolveRemoteDefaultBranch } from "../loop/default-branch.js";
import {
  LIFECYCLE_SCHEMA_VERSION,
  type LifecycleCheck,
  type LifecycleFaultHook,
  assertDirectoryNoSymlink,
  assertRegularFile,
  assertSafeSegment,
  acquireLifecycleOperationLock,
  emitLifecycleStep,
  sha256,
  stableJson,
  writeLifecycleFileAtomic,
} from "./lifecycle.js";
import {
  assertNonSecretOnboardingAnswers,
  readOnboardingSource,
  readStoredOnboardingAnswers,
  storeOnboardingAnswers,
} from "./onboarding-answers.js";

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
};

export interface AppLifecycleRecord {
  schema_version: typeof LIFECYCLE_SCHEMA_VERSION;
  kind: "app-lifecycle";
  app: string;
  repo: string;
  remote_url: string;
  default_branch: string;
  default_base: string;
  source: {
    path: string;
    branch: string;
    head: string;
    status_sha256: string;
  };
  onboarding_commit: string;
  managed_clone: string;
  authority_sha256: string;
  config_sha256: string;
  answers_sha256: string;
}

export interface RecoveredBootstrapResult extends BootstrapRunResult {
  immutableSource: true;
  appName: string;
  onboardingCommit: string;
  defaultBranch: string;
  managedClone: string;
}

export type RuntimeReadinessInspector = (
  runtimes: Array<{ runtime: RuntimeKind; models: string[] }>,
) => Promise<Array<LifecycleCheck>>;

export interface VerifyAppOptions {
  orgHome: string;
  stateHome: string;
  appName: string;
  /** Public verify converges a reachable managed clone. Promotion preview uses
   * false so its dry-run is non-mutating. */
  synchronize?: boolean;
  writeReadiness?: boolean;
  runChecks?: boolean;
  recordEvidence?: boolean;
  /** Full override of the runtime-readiness check list. Tests that want no
   * runtime checks at all inject `async () => []`. */
  runtimeReadiness?: RuntimeReadinessInspector;
  /** Non-billable readiness probe seam. When `runtimeReadiness` is not
   * supplied, verify's `runtime-<provider>` checks come from this probe — the
   * SAME `probeRuntimeReadiness` mechanism `operon doctor` uses, so the two
   * always agree (B-LIVE-04). Tests inject a fake so they never touch a real
   * adapter; the CLI leaves it unset to run the real non-billable probe. */
  readinessProbe?: RuntimeReadinessProbe;
  /** Validate configuration without running a readiness probe, mirroring
   * `operon doctor --config-only`. A config-only runtime check never claims
   * readiness (it is `blocked`, not `pass`): configuration validity is not
   * runtime readiness. Intended for isolated packaging/offline fixtures. */
  configOnly?: boolean;
  /** Forwarded to the readiness probe (per-runtime deadline). */
  readinessTimeoutMs?: number;
  /** Optional bounded GitHub read used by the public CLI to verify the
   * canonical label contract. Offline lifecycle callers may omit it. */
  github?: Pick<GhOps, "listLabels">;
  /** Lazy production seam. It is invoked only when the lifecycle record's
   * actual remote is GitHub, so local/file remotes remain supported. */
  githubFactory?: (repo: string) => Pick<GhOps, "listLabels">;
  fault?: LifecycleFaultHook;
}

export interface AppVerification {
  schema_version: typeof LIFECYCLE_SCHEMA_VERSION;
  kind: "app-verification";
  app: string;
  status: "ready" | "blocked" | "invalid";
  evidence_state: "registered" | "runtime-ready" | "live";
  registry_status: AppEntry["status"];
  default_branch: string;
  remote_head: string | null;
  onboarding_commit: string;
  managed_head: string | null;
  authority_sha256: string;
  config_sha256: string | null;
  checks: LifecycleCheck[];
  provider: { factories: 0; processes: 0; turns: 0; settlements: 0 };
  readiness_path: string;
}

export interface PromoteAppOptions extends VerifyAppOptions {
  to: "live";
  execute?: boolean;
}

export interface AppPromotionPlan {
  schema_version: typeof LIFECYCLE_SCHEMA_VERSION;
  kind: "app-promotion-plan";
  app: string;
  from: AppEntry["status"];
  to: "live";
  executable: boolean;
  idempotent: boolean;
  verification: AppVerification;
  changes: string[];
  transaction_id: string;
}

export interface AppPromotionResult {
  schema_version: typeof LIFECYCLE_SCHEMA_VERSION;
  kind: "app-promotion-result";
  status: "promoted" | "already_live";
  plan: AppPromotionPlan;
  verification: AppVerification;
}

interface PromotionJournal {
  schema_version: typeof LIFECYCLE_SCHEMA_VERSION;
  kind: "app-promotion";
  transaction_id: string;
  app: string;
  target: "live";
  phase: "intent" | "config_committed" | "pushed" | "registry_updated" | "complete";
  promotion_commit: string | null;
}

export function lifecycleRecordPath(stateHome: string, app: string): string {
  assertSafeSegment(app, "app lifecycle");
  return join(resolve(stateHome), "lifecycle", "apps", app, "record.json");
}

export async function bootstrapFromRecoveredAnswers(
  sourceIn: string,
  answersRaw: unknown,
  options: { orgHome: string; stateHome: string; templateRoot?: string; appName?: string; fault?: LifecycleFaultHook },
): Promise<RecoveredBootstrapResult> {
  const lockApp = sanitizeAppName(options.appName ?? basename(resolve(sourceIn)));
  const release = await acquireLifecycleOperationLock(resolve(options.stateHome), lockApp, "bootstrap recovered answers");
  try {
    return await bootstrapFromRecoveredAnswersLocked(sourceIn, answersRaw, options);
  } finally {
    await release();
  }
}

async function bootstrapFromRecoveredAnswersLocked(
  sourceIn: string,
  answersRaw: unknown,
  options: { orgHome: string; stateHome: string; templateRoot?: string; appName?: string; fault?: LifecycleFaultHook },
): Promise<RecoveredBootstrapResult> {
  const source = await assertDirectoryNoSymlink(resolve(sourceIn), "bootstrap source checkout");
  if (!existsSync(join(source, ".git"))) throw new Error(`bootstrap: recovered-answer source is not a git checkout: ${source}`);
  const appName = sanitizeAppName(options.appName ?? basename(source));
  assertSafeSegment(appName, "bootstrap app");
  const orgHome = resolve(options.orgHome);
  const stateHome = resolve(options.stateHome);
  const recordPath = lifecycleRecordPath(stateHome, appName);
  const roles = await loadRoles(join(orgHome, "roles.yaml"));
  const allRoles = roles.roles.map((role) => role.name);
  const answers = parseAnswers(answersRaw, allRoles);
  assertNonSecretOnboardingAnswers(answers);
  const answersHash = `sha256:${sha256(stableJson(answers))}`;
  const sourceSnapshot = gitSnapshot(source);

  if (existsSync(recordPath)) {
    const record = await readLifecycleRecord(stateHome, appName);
    const registry = (await loadApps(join(orgHome, "apps.yaml"))).apps.find((app) => app.name === appName);
    if (
      registry !== undefined &&
      record.source.path === source &&
      record.source.head === sourceSnapshot.head &&
      record.answers_sha256 === answersHash
    ) {
      const scan = await scanRepo(source);
      await emitLifecycleStep({
        stateHome,
        app: appName,
        operation: "bootstrap recovered answers",
        inputFingerprint: sha256(stableJson({ source: sourceSnapshot, answersHash, repoSlug: record.repo })),
        status: "completed",
        reason: `onboarding commit ${record.onboarding_commit} created in managed clone; source checkout unchanged`,
      });
      return {
        scan,
        answers,
        created: appArtifactFiles(answers, allRoles),
        updated: [],
        joinedOrgHome: orgHome,
        immutableSource: true,
        appName,
        onboardingCommit: record.onboarding_commit,
        defaultBranch: record.default_branch,
        managedClone: record.managed_clone,
      };
    }
    throw new Error(`bootstrap: existing lifecycle state for ${appName} conflicts with this recovered-answer input`);
  }
  const lifecycleAppDir = dirname(recordPath);
  if (existsSync(lifecycleAppDir) && (await readdir(lifecycleAppDir)).length > 0) {
    throw new Error(`bootstrap: partial lifecycle state exists without a valid record for ${appName}`);
  }

  const remoteUrl = git(source, "remote", "get-url", "origin");
  const defaultBranch = remoteDefaultBranch(remoteUrl);
  const defaultBase = remoteBranchHead(remoteUrl, defaultBranch);
  const scan = await scanRepo(source);
  const repoSlug = scan.repoSlug ?? localRepoIdentity(remoteUrl, appName);
  const managedClone = join(stateHome, "repos", appName);
  if (existsSync(managedClone)) throw new Error(`bootstrap: managed clone already exists without lifecycle record: ${managedClone}`);
  const stagingRoot = join(stateHome, "lifecycle", "staging");
  await mkdir(stagingRoot, { recursive: true });
  const stage = join(stagingRoot, `${appName}.partial`);
  await rm(stage, { recursive: true, force: true });
  let registered = false;
  let moved = false;
  try {
    await options.fault?.("before_worktree_creation");
    git(dirname(stage), "clone", "--quiet", "--no-hardlinks", source, stage);
    git(stage, "remote", "set-url", "origin", remoteUrl);
    await options.fault?.("after_worktree_creation");

    const orgAuthority = await resolveAuthority({ orgHome });
    const emit = await emitAppArtifacts(stage, {
      appName,
      repoSlug,
      answers,
      scan,
      allRoles,
      orgAuthority,
      ...(options.templateRoot !== undefined ? { templateRoot: options.templateRoot } : {}),
    });
    await validateGeneratedArtifacts(stage, appName, repoSlug, emit.created, emit.updated);
    git(stage, "add", "--all");
    git(stage, "diff", "--cached", "--check");
    const commitDate = nextCommitDate(stage);
    await options.fault?.("before_commit");
    gitWithCommitIdentity(stage, commitDate, "commit", "--quiet", "-m", "chore: onboard app with Operon");
    await options.fault?.("after_commit");
    const onboardingCommit = git(stage, "rev-parse", "HEAD");
    const authority = await resolveAuthority({ orgHome, appWorkdir: stage });
    const configBytes = await readFile(join(stage, ".operon", "config.yaml"));

    await options.fault?.("before_registry_write");
    await joinExistingOrg(orgHome, {
      name: appName,
      repo: repoSlug,
      status: "onboarding",
      budgetUsdMonth: answers.budgetUsdMonth,
      cadence: cadenceForAnswers(answers, allRoles),
      execution: normalizeAppExecution(undefined),
      ...(Object.keys(answers.channels).length > 0 ? { channels: answers.channels } : {}),
    });
    registered = true;
    await options.fault?.("after_registry_write");
    await mkdir(dirname(managedClone), { recursive: true });
    await rename(stage, managedClone);
    moved = true;
    await storeOnboardingAnswers(stateHome, appName, answers);
    const record: AppLifecycleRecord = {
      schema_version: LIFECYCLE_SCHEMA_VERSION,
      kind: "app-lifecycle",
      app: appName,
      repo: repoSlug,
      remote_url: remoteUrl,
      default_branch: defaultBranch,
      default_base: defaultBase,
      source: {
        path: source,
        branch: sourceSnapshot.branch,
        head: sourceSnapshot.head,
        status_sha256: `sha256:${sha256(sourceSnapshot.status)}`,
      },
      onboarding_commit: onboardingCommit,
      managed_clone: managedClone,
      authority_sha256: `sha256:${authority.sha256}`,
      config_sha256: `sha256:${sha256(configBytes)}`,
      answers_sha256: answersHash,
    };
    await writeLifecycleFileAtomic(recordPath, stableJson(record));
    await emitLifecycleStep({
      stateHome,
      app: appName,
      operation: "bootstrap recovered answers",
      inputFingerprint: sha256(stableJson({ source: sourceSnapshot, answersHash, repoSlug })),
      status: "completed",
      reason: `onboarding commit ${onboardingCommit} created in managed clone; source checkout unchanged`,
    });
    return {
      scan,
      answers,
      created: emit.created,
      updated: emit.updated,
      joinedOrgHome: orgHome,
      immutableSource: true,
      appName,
      onboardingCommit,
      defaultBranch,
      managedClone,
    };
  } catch (error) {
    if (registered) await removeExistingApp(orgHome, appName).catch(() => undefined);
    await rm(moved ? managedClone : stage, { recursive: true, force: true });
    await rm(join(stateHome, "lifecycle", "apps", appName), { recursive: true, force: true });
    throw error;
  }
}

export async function verifyApp(options: VerifyAppOptions): Promise<AppVerification> {
  const orgHome = resolve(options.orgHome);
  const stateHome = resolve(options.stateHome);
  const apps = await loadApps(join(orgHome, "apps.yaml"));
  const app = apps.apps.find((entry) => entry.name === options.appName);
  if (app === undefined) throw new Error(`app verify: unknown app "${options.appName}"`);
  // A missing or unreadable lifecycle record must be a typed verification
  // result, never a raw ENOENT (L0-01). A real `app verify` (synchronize !==
  // false) synthesizes the record for a greenfield/`new-app` app from its
  // pushed remote; a promotion preview (synchronize === false) does not mutate,
  // so it reports "run app verify first" instead.
  const resolved = await resolveLifecycleRecordForVerify(orgHome, stateHome, app, options.synchronize !== false);
  if (!resolved.ok) return unverifiableReport(stateHome, app, resolved.check, options);
  const record = resolved.record;
  const checks: LifecycleCheck[] = [];
  let remoteHead: string | null = null;
  let managedHead: string | null = null;
  let configHash: string | null = null;

  checks.push(record.repo === app.repo
    ? pass("registry-record", "registry and lifecycle record identify the same repository")
    : fail("registry-record", `registry repo ${app.repo} differs from lifecycle record ${record.repo}`));

  const github = options.github ?? (
    isGithubRemoteForSlug(record.remote_url, app.repo)
      ? options.githubFactory?.(app.repo)
      : undefined
  );
  if (github !== undefined) {
    try {
      checks.push(canonicalLabelsCheck(await github.listLabels()));
    } catch (error) {
      checks.push(blocked(
        "canonical-labels",
        message(error),
        "restore GitHub access, then run the idempotent label commands in .operon/bootstrap/next-commands.md",
      ));
    }
  } else if (isGithubRemoteForSlug(record.remote_url, app.repo)) {
    checks.push(blocked(
      "canonical-labels",
      "GitHub label inspection was not configured for this verification caller",
      "rerun through operon app verify, which supplies the bounded GitHub label reader",
    ));
  } else {
    checks.push(pass(
      "canonical-labels",
      `not applicable: ${record.remote_url} is a non-GitHub remote, so no GitHub labels are required`,
    ));
  }

  try {
    await options.fault?.("before_git_fetch");
    const advertised = remoteBranchHead(record.remote_url, record.default_branch);
    remoteHead = advertised;
    await options.fault?.("after_git_fetch");
    checks.push(pass("remote-reachable", `${record.default_branch} is reachable at ${advertised}`));
  } catch (error) {
    checks.push(blocked("remote-reachable", message(error), "restore remote access and rerun app verify"));
  }

  const cloneState = await inspectManagedClone(record.managed_clone);
  if (cloneState === "symlink") {
    checks.push(fail("managed-clone", `managed clone path is a symlink: ${record.managed_clone}`));
  } else if (remoteHead !== null) {
    try {
      if (cloneState !== "git") {
        if (options.synchronize === false) throw new Error("managed clone missing or corrupt");
        await recreateManagedClone(record, stateHome);
      }
      if (options.synchronize !== false) {
        await options.fault?.("before_git_fetch");
        git(record.managed_clone, "fetch", "--quiet", "origin", record.default_branch);
        await options.fault?.("after_git_fetch");
      }
      await options.fault?.("before_ref_validation");
      const remoteRef = `origin/${record.default_branch}`;
      const fetchedHead = git(record.managed_clone, "rev-parse", remoteRef);
      if (fetchedHead !== remoteHead) throw new Error(`fetched ${fetchedHead}, advertised ${remoteHead}`);
      const defaultIsBase = gitIsAncestor(record.managed_clone, record.default_base, record.onboarding_commit);
      const onboardingReachable = gitIsAncestor(record.managed_clone, record.onboarding_commit, fetchedHead);
      const currentDefaultIsBase = gitIsAncestor(record.managed_clone, fetchedHead, record.onboarding_commit);
      if (!defaultIsBase || (!onboardingReachable && !currentDefaultIsBase)) {
        checks.push(blocked("branch-ancestry", "onboarding commit does not descend from the current default branch", "rebase/recreate onboarding from the current default branch"));
      } else checks.push(pass("branch-ancestry", "onboarding commit descends from the remote default branch"));
      if (!onboardingReachable) {
        checks.push(blocked("onboarding-reachable", `onboarding commit ${record.onboarding_commit} is not reachable from ${remoteRef}`, `push the onboarding commit to ${record.default_branch} without rewriting unrelated history`));
      } else {
        checks.push(pass("onboarding-reachable", `onboarding commit is reachable from ${remoteRef}`));
        if (options.synchronize !== false) synchronizeClone(record.managed_clone, record.default_branch);
      }
      await options.fault?.("after_ref_validation");
    } catch (error) {
      if (!checks.some((check) => check.id === "managed-clone")) {
        checks.push(blocked("managed-clone", message(error), "repair remote/ref state and rerun app verify; a reachable corrupt clone is recreated automatically"));
      }
    }
  } else {
    checks.push(blocked("managed-clone", "remote head unavailable; clone was not changed", "restore remote reachability"));
  }

  if (existsSync(join(record.managed_clone, ".git"))) {
    managedHead = safeGit(record.managed_clone, "rev-parse", "HEAD");
    if (remoteHead !== null && managedHead === remoteHead) checks.push(pass("managed-head", `managed HEAD equals ${record.default_branch} at ${managedHead}`));
    else checks.push(blocked("managed-head", `managed HEAD ${managedHead ?? "missing"} does not equal remote ${remoteHead ?? "unavailable"}`, "make onboarding reachable and rerun app verify to synchronize"));

    const configPath = join(record.managed_clone, ".operon", "config.yaml");
    try {
      await assertRegularFile(configPath, "app config");
      const configBytes = await readFile(configPath);
      configHash = `sha256:${sha256(configBytes)}`;
      if (configHash !== record.config_sha256) {
        throw new Error(`config hash ${configHash} differs from lifecycle record ${record.config_sha256}`);
      }
      const config = await loadApps(configPath);
      const configApp = config.apps.find((entry) => entry.name === app.name);
      if (configApp === undefined) throw new Error(`config has no app ${app.name}`);
      if (stableJson(comparableApp(configApp)) !== stableJson(comparableApp(app))) {
        throw new Error("registry and app config differ");
      }
      checks.push(pass("registry-config", "registry and app-owned config agree"));
      const authority = await resolveAuthority({ orgHome, appWorkdir: record.managed_clone });
      const effectiveHash = `sha256:${authority.sha256}`;
      if (effectiveHash !== record.authority_sha256) throw new Error(`authority hash ${effectiveHash} differs from onboarding ${record.authority_sha256}`);
      checks.push(pass("authority-hash", `effective authority ${effectiveHash}`));
      await validateFormatting(record.managed_clone);
      checks.push(pass("artifact-format", "generated YAML/Markdown parse and formatting checks pass"));
    } catch (error) {
      checks.push(fail("registry-config", message(error)));
    }
  }

  const activity = await appActivityChecks(stateHome, app.name);
  checks.push(...activity);
  if (options.runChecks !== false && existsSync(join(record.managed_clone, ".git")) && remoteHead === managedHead) {
    checks.push(...runDeclaredChecks(record.managed_clone));
  } else if (options.runChecks !== false) {
    checks.push(blocked("app-checks", "app checks require a synchronized managed clone", "resolve ref/clone blockers and rerun"));
  } else {
    const priorPath = join(stateHome, "lifecycle", "readiness", `${app.name}.json`);
    try {
      const prior = JSON.parse(await readFile(priorPath, "utf8")) as AppVerification;
      const priorChecksPassed = prior.status === "ready" && prior.checks
        .filter((check) => check.id.startsWith("app-check-"))
        .every((check) => check.status === "pass");
      checks.push(priorChecksPassed
        ? pass("app-checks-evidence", "prior synchronized verification contains passing app checks")
        : blocked("app-checks-evidence", "no passing prior app verification", "run operon app verify before promotion"));
    } catch {
      checks.push(blocked("app-checks-evidence", "no prior app verification", "run operon app verify before promotion"));
    }
  }
  const runtimeInspector = options.runtimeReadiness ?? ((runtimes) =>
    probeRuntimeReadinessChecks(runtimes, {
      ...(options.readinessProbe !== undefined ? { probe: options.readinessProbe } : {}),
      configOnly: options.configOnly === true,
      ...(options.readinessTimeoutMs !== undefined ? { timeoutMs: options.readinessTimeoutMs } : {}),
    }));
  checks.push(...await runtimeInspector(runtimeCandidatesForApp(
    await loadRoles(join(orgHome, "roles.yaml")),
    app,
  )));

  const invalid = checks.some((check) => check.status === "fail");
  const ready = !invalid && checks.every((check) => check.status === "pass");
  const status: AppVerification["status"] = invalid ? "invalid" : ready ? "ready" : "blocked";
  const readinessPath = join(stateHome, "lifecycle", "readiness", `${app.name}.json`);
  const report: AppVerification = {
    schema_version: LIFECYCLE_SCHEMA_VERSION,
    kind: "app-verification",
    app: app.name,
    status,
    evidence_state: ready ? (app.status === "live" ? "live" : "runtime-ready") : "registered",
    registry_status: app.status,
    default_branch: record.default_branch,
    remote_head: remoteHead,
    onboarding_commit: record.onboarding_commit,
    managed_head: managedHead,
    authority_sha256: record.authority_sha256,
    config_sha256: configHash,
    checks,
    provider: { factories: 0, processes: 0, turns: 0, settlements: 0 },
    readiness_path: readinessPath,
  };
  if (options.writeReadiness !== false) await writeLifecycleFileAtomic(readinessPath, stableJson(report));
  if (options.recordEvidence !== false) {
    await emitLifecycleStep({
      stateHome,
      app: app.name,
      operation: "app verify",
      inputFingerprint: sha256(stableJson({ record, remoteHead, managedHead, checks })),
      status: status === "ready" ? "completed" : status === "blocked" ? "blocked" : "failed",
      reason: status === "ready" ? "all lifecycle readiness checks passed" : `${status}: ${checks.filter((check) => check.status !== "pass").map((check) => check.id).join(", ")}`,
      ...(status === "ready" ? {} : { nextStep: "apply the typed remediation and rerun app verify" }),
    });
  }
  return report;
}

export async function planAppPromotion(options: PromoteAppOptions): Promise<AppPromotionPlan> {
  if (options.to !== "live") throw new Error("app promote: only --to live is supported");
  const verification = await verifyApp({ ...options, synchronize: false, writeReadiness: false, runChecks: false, recordEvidence: false });
  const app = (await loadApps(join(resolve(options.orgHome), "apps.yaml"))).apps.find((entry) => entry.name === options.appName)!;
  const journalPath = join(resolve(options.stateHome), "lifecycle", "apps", options.appName, "promotion.json");
  if (existsSync(journalPath)) {
    const journal = parsePromotionJournal(await readFile(journalPath, "utf8"), app.name);
    if (journal.phase !== "complete") {
      return {
        schema_version: LIFECYCLE_SCHEMA_VERSION,
        kind: "app-promotion-plan",
        app: app.name,
        from: app.status,
        to: "live",
        executable: true,
        idempotent: false,
        verification,
        changes: ["resume the durable promotion transaction", "converge app config, remote default, registry, and managed clone"],
        transaction_id: journal.transaction_id,
      };
    }
  }
  const completeJournal = existsSync(journalPath)
    ? parsePromotionJournal(await readFile(journalPath, "utf8"), app.name)
    : undefined;
  const idempotent = app.status === "live" && verification.status === "ready";
  const changes = idempotent ? [] : ["app .operon/config.yaml status -> live", "org apps.yaml status -> live", "managed clone -> remote default HEAD"];
  return {
    schema_version: LIFECYCLE_SCHEMA_VERSION,
    kind: "app-promotion-plan",
    app: app.name,
    from: app.status,
    to: "live",
    executable: verification.status === "ready" && (app.status === "onboarding" || idempotent),
    idempotent,
    verification,
    changes,
    transaction_id: completeJournal?.phase === "complete"
      ? completeJournal.transaction_id
      : `promote-${app.name}-${sha256(stableJson({ app: comparableApp(app), head: verification.remote_head, config: verification.config_sha256 })).slice(0, 16)}`,
  };
}

export async function executeAppPromotion(
  options: PromoteAppOptions,
  reviewedPlan?: AppPromotionPlan,
): Promise<AppPromotionResult> {
  const stateHome = resolve(options.stateHome);
  const release = await acquireLifecycleOperationLock(stateHome, options.appName, "app promote");
  try {
    const plan = reviewedPlan ?? (await planAppPromotion(options));
    const fresh = await planAppPromotion(options);
    if (fresh.transaction_id !== plan.transaction_id && !plan.idempotent) throw new Error("app promote: reviewed plan is stale; preview again");
    if (!fresh.executable) throw new Error(`app promote: verification is ${fresh.verification.status}; promotion refused`);
    if (fresh.idempotent) {
      await emitLifecycleStep({
        stateHome,
        app: options.appName,
        operation: "app promote",
        inputFingerprint: fresh.transaction_id,
        status: "completed",
        reason: `app promoted transactionally to live at ${fresh.verification.remote_head}`,
      });
      return { schema_version: LIFECYCLE_SCHEMA_VERSION, kind: "app-promotion-result", status: "already_live", plan: fresh, verification: fresh.verification };
    }
    const record = await readLifecycleRecord(stateHome, options.appName);
    const journalPath = join(stateHome, "lifecycle", "apps", options.appName, "promotion.json");
    let journal = await readOrCreatePromotionJournal(journalPath, fresh);

    const configPath = join(record.managed_clone, ".operon", "config.yaml");
    const headConfigStatus = appConfigStatusText(
      git(record.managed_clone, "show", `HEAD:.operon/config.yaml`),
      options.appName,
      "committed app config",
    );
    if (headConfigStatus === "live") {
      if (git(record.managed_clone, "status", "--porcelain", "--", ".operon/config.yaml") !== "") {
        throw new Error("app promote: committed live config has uncommitted changes");
      }
      journal = await patchPromotionJournal(journalPath, journal, {
        phase: journal.phase === "intent" ? "config_committed" : journal.phase,
        promotion_commit: git(record.managed_clone, "rev-parse", "HEAD"),
      });
    } else {
      if (await appConfigStatus(configPath, options.appName) !== "live") {
        await options.fault?.("before_config_write");
        const before = await readFile(configPath, "utf8");
        const document = parseDocument(before);
        if (document.errors.length > 0 || !document.hasIn(["apps", options.appName])) throw new Error("app promote: invalid app config");
        document.setIn(["apps", options.appName, "status"], "live");
        await writeLifecycleFileAtomic(configPath, document.toString());
        await options.fault?.("after_config_write");
      }
      await validateFormatting(record.managed_clone);
      git(record.managed_clone, "add", ".operon/config.yaml");
      git(record.managed_clone, "diff", "--cached", "--check");
      const commitDate = nextCommitDate(record.managed_clone);
      await options.fault?.("before_commit");
      gitWithCommitIdentity(record.managed_clone, commitDate, "commit", "--quiet", "-m", "chore: promote app to live");
      await options.fault?.("after_commit");
      journal = await patchPromotionJournal(journalPath, journal, { phase: "config_committed", promotion_commit: git(record.managed_clone, "rev-parse", "HEAD") });
    }

    const remote = remoteBranchHead(record.remote_url, record.default_branch);
    if (journal.promotion_commit === null) throw new Error("app promote: missing promotion commit");
    if (remote !== journal.promotion_commit) {
      if (!gitIsAncestor(record.managed_clone, remote, journal.promotion_commit)) throw new Error("app promote: remote default diverged during promotion");
      await options.fault?.("before_push");
      git(record.managed_clone, "push", "--quiet", "origin", `HEAD:${record.default_branch}`);
      await options.fault?.("after_push");
    }
    journal = await patchPromotionJournal(journalPath, journal, { phase: "pushed" });

    const registry = (await loadApps(join(resolve(options.orgHome), "apps.yaml"))).apps.find((entry) => entry.name === options.appName)!;
    if (registry.status !== "live") {
      await options.fault?.("before_registry_write");
      await updateAppStatus(options.orgHome, options.appName, "live");
      await options.fault?.("after_registry_write");
      journal = await patchPromotionJournal(journalPath, journal, { phase: "registry_updated" });
    }
    const configBytes = await readFile(configPath);
    await writeLifecycleFileAtomic(lifecycleRecordPath(stateHome, options.appName), stableJson({
      ...record,
      config_sha256: `sha256:${sha256(configBytes)}`,
    } satisfies AppLifecycleRecord));
    const finalVerification = await verifyApp({ ...options, synchronize: true, writeReadiness: true });
    if (finalVerification.status !== "ready" || finalVerification.registry_status !== "live") {
      throw new Error(
        `app promote: post-transaction verification ${finalVerification.status}: ` +
          finalVerification.checks.filter((check) => check.status !== "pass").map((check) => `${check.id}=${check.detail}`).join("; "),
      );
    }
    await patchPromotionJournal(journalPath, journal, { phase: "complete" });
    await emitLifecycleStep({
      stateHome,
      app: options.appName,
      operation: "app promote",
      inputFingerprint: fresh.transaction_id,
      status: "completed",
      reason: `app promoted transactionally to live at ${finalVerification.remote_head}`,
    });
    return { schema_version: LIFECYCLE_SCHEMA_VERSION, kind: "app-promotion-result", status: "promoted", plan: fresh, verification: finalVerification };
  } finally {
    await release();
  }
}

export async function readLifecycleRecord(stateHome: string, app: string): Promise<AppLifecycleRecord> {
  const path = lifecycleRecordPath(stateHome, app);
  await assertRegularFile(path, "app lifecycle record");
  const value = JSON.parse(await readFile(path, "utf8")) as Partial<AppLifecycleRecord>;
  if (
    value.schema_version !== LIFECYCLE_SCHEMA_VERSION ||
    value.kind !== "app-lifecycle" ||
    value.app !== app ||
    typeof value.remote_url !== "string" ||
    typeof value.default_branch !== "string" ||
    typeof value.default_base !== "string" ||
    typeof value.onboarding_commit !== "string" ||
    typeof value.managed_clone !== "string"
  ) throw new Error(`app verify: invalid lifecycle record ${path}`);
  if (resolve(value.managed_clone) !== join(resolve(stateHome), "repos", app)) throw new Error("app verify: managed clone path escapes app state");
  return value as AppLifecycleRecord;
}

type RecordResolution = { ok: true; record: AppLifecycleRecord } | { ok: false; check: LifecycleCheck };

/** Read the lifecycle record, or (for a real verify) synthesize one for a
 * registered app that has none. A `operon new-app` app is left in exactly this
 * state until its scaffold is pushed: the record writer only ran on the
 * recovered-answer bootstrap path, so `verify` used to surface a raw ENOENT
 * (L0-01). Verify now owns record synthesis/repair; every miss is typed. */
async function resolveLifecycleRecordForVerify(
  orgHome: string,
  stateHome: string,
  app: AppEntry,
  synthesize: boolean,
): Promise<RecordResolution> {
  const path = lifecycleRecordPath(stateHome, app.name);
  if (existsSync(path)) {
    try {
      return { ok: true, record: await readLifecycleRecord(stateHome, app.name) };
    } catch (error) {
      return { ok: false, check: fail("lifecycle-record", message(error)) };
    }
  }
  if (!synthesize) {
    return {
      ok: false,
      check: blocked(
        "lifecycle-record",
        `no lifecycle record for ${app.name}`,
        "run `operon app verify` to synthesize the lifecycle record, then retry promotion",
      ),
    };
  }
  return synthesizeLifecycleRecord(orgHome, stateHome, app);
}

/** Build a lifecycle record for a registered app that has none. The remote is
 * learned from the recorded onboarding checkout's `origin`, falling back to the
 * registered GitHub slug for an app onboarded before this path existed. Every
 * failure mode returns a typed blocked/invalid check, never a raw exception. */
async function synthesizeLifecycleRecord(
  orgHome: string,
  stateHome: string,
  app: AppEntry,
): Promise<RecordResolution> {
  const remote = await resolveOnboardingRemote(stateHome, app);
  if ("check" in remote) return { ok: false, check: remote.check };
  const remoteUrl = remote.url;

  let defaultBranch: string;
  try {
    defaultBranch = remoteDefaultBranch(remoteUrl);
    remoteBranchHead(remoteUrl, defaultBranch);
  } catch (error) {
    return {
      ok: false,
      check: blocked(
        "lifecycle-record",
        `app remote is unreachable or has no default branch: ${message(error)}`,
        "push the app repo to its remote default branch, then rerun `operon app verify`",
      ),
    };
  }

  const managedClone = join(resolve(stateHome), "repos", app.name);
  try {
    await cloneRemoteInto(remoteUrl, managedClone);
  } catch (error) {
    return {
      ok: false,
      check: blocked(
        "lifecycle-record",
        `could not clone the app remote into a managed clone: ${message(error)}`,
        "ensure the app repo is reachable, then rerun `operon app verify`",
      ),
    };
  }

  const configPath = join(managedClone, ".operon", "config.yaml");
  if (!existsSync(configPath)) {
    return {
      ok: false,
      check: blocked(
        "lifecycle-record",
        `the onboarding artifacts (.operon/config.yaml) are not on ${defaultBranch} of the app remote`,
        "commit and push the generated .operon scaffold to the default branch, then rerun `operon app verify`",
      ),
    };
  }

  const onboardingCommit = firstCommitAdding(managedClone, ".operon/config.yaml") ?? git(managedClone, "rev-parse", "HEAD");
  const configBytes = await readFile(configPath);
  const authority = await resolveAuthority({ orgHome, appWorkdir: managedClone });
  const record: AppLifecycleRecord = {
    schema_version: LIFECYCLE_SCHEMA_VERSION,
    kind: "app-lifecycle",
    app: app.name,
    repo: app.repo,
    remote_url: remoteUrl,
    default_branch: defaultBranch,
    // A greenfield app's first pushed onboarding commit is both its default
    // base and its onboarding commit; the ancestry checks then hold against any
    // later default-branch head.
    default_base: onboardingCommit,
    source: onboardingSourceSnapshot(remote.checkout),
    onboarding_commit: onboardingCommit,
    managed_clone: managedClone,
    authority_sha256: `sha256:${authority.sha256}`,
    config_sha256: `sha256:${sha256(configBytes)}`,
    answers_sha256: await onboardingAnswersHash(stateHome, app.name),
  };
  await writeLifecycleFileAtomic(lifecycleRecordPath(stateHome, app.name), stableJson(record));
  await emitLifecycleStep({
    stateHome,
    app: app.name,
    operation: "app verify",
    inputFingerprint: sha256(stableJson({ synthesized: true, remoteUrl, onboardingCommit })),
    status: "completed",
    reason: `synthesized lifecycle record for ${app.name} at ${onboardingCommit}`,
  });
  return { ok: true, record };
}

async function resolveOnboardingRemote(
  stateHome: string,
  app: AppEntry,
): Promise<{ url: string; checkout: string | null } | { check: LifecycleCheck }> {
  const source = await readOnboardingSource(stateHome, app.name);
  if (source !== undefined) {
    const checkout = source.checkout_path;
    if (existsSync(checkout) && existsSync(join(checkout, ".git"))) {
      const url = safeGit(checkout, "remote", "get-url", "origin");
      if (url !== null && url !== "") return { url, checkout };
      return {
        check: blocked(
          "lifecycle-record",
          `onboarding checkout for ${app.name} has no pushed 'origin' remote yet: ${checkout}`,
          "add and push the remote (create/push the app repo), then rerun `operon app verify`",
        ),
      };
    }
    // The pointer exists but the scaffold has not been initialized/pushed yet —
    // the expected state right after `operon new-app`. Report it precisely
    // rather than blindly probing the network.
    return {
      check: blocked(
        "lifecycle-record",
        `onboarding checkout for ${app.name} is not an initialized git repository yet: ${checkout}`,
        "initialize and push the app repo (git init && commit && create/push the remote), then rerun `operon app verify`",
      ),
    };
  }
  // No onboarding pointer: an app onboarded before this path existed (e.g. the
  // live-campaign state). Recover it from the registered GitHub slug.
  if (isGithubSlug(app.repo)) return { url: githubRemoteForSlug(app.repo), checkout: null };
  return {
    check: blocked(
      "lifecycle-record",
      `no lifecycle record, no onboarding checkout, and ${app.repo} is not a resolvable GitHub slug`,
      "clone the app repo to a local path and re-onboard, or restore the managed state before verifying",
    ),
  };
}

function onboardingSourceSnapshot(checkout: string | null): AppLifecycleRecord["source"] {
  if (checkout === null) return { path: "", branch: "", head: "", status_sha256: `sha256:${sha256("")}` };
  const snap = gitSnapshot(checkout);
  return { path: checkout, branch: snap.branch, head: snap.head, status_sha256: `sha256:${sha256(snap.status)}` };
}

async function onboardingAnswersHash(stateHome: string, app: string): Promise<string> {
  try {
    const answers = await readStoredOnboardingAnswers(stateHome, app);
    return `sha256:${sha256(stableJson(answers))}`;
  } catch {
    return `sha256:${sha256("")}`;
  }
}

function firstCommitAdding(root: string, relPath: string): string | null {
  const out = safeGit(root, "log", "--diff-filter=A", "--format=%H", "--", relPath);
  if (out === null || out === "") return null;
  const commits = out.split("\n").filter((line) => line.length > 0);
  return commits.at(-1) ?? null;
}

async function cloneRemoteInto(remoteUrl: string, managedClone: string): Promise<void> {
  const parent = dirname(resolve(managedClone));
  await mkdir(parent, { recursive: true });
  const staged = join(parent, `.${basename(managedClone)}-synth.partial`);
  await rm(staged, { recursive: true, force: true });
  try {
    git(dirname(staged), "clone", "--quiet", remoteUrl, staged);
    await rm(managedClone, { recursive: true, force: true });
    await rename(staged, managedClone);
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
}

function isGithubSlug(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

function isGithubRemoteForSlug(remoteUrl: string, slug: string): boolean {
  const match = /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i
    .exec(remoteUrl);
  return match !== null && `${match[1]}/${match[2]}`.toLowerCase() === slug.toLowerCase();
}

function githubRemoteForSlug(slug: string): string {
  return `https://github.com/${slug}.git`;
}

async function unverifiableReport(
  stateHome: string,
  app: AppEntry,
  check: LifecycleCheck,
  options: VerifyAppOptions,
): Promise<AppVerification> {
  const status: AppVerification["status"] = check.status === "fail" ? "invalid" : "blocked";
  const readinessPath = join(resolve(stateHome), "lifecycle", "readiness", `${app.name}.json`);
  const report: AppVerification = {
    schema_version: LIFECYCLE_SCHEMA_VERSION,
    kind: "app-verification",
    app: app.name,
    status,
    evidence_state: "registered",
    registry_status: app.status,
    default_branch: "",
    remote_head: null,
    onboarding_commit: "",
    managed_head: null,
    authority_sha256: "",
    config_sha256: null,
    checks: [check],
    provider: { factories: 0, processes: 0, turns: 0, settlements: 0 },
    readiness_path: readinessPath,
  };
  if (options.writeReadiness !== false) await writeLifecycleFileAtomic(readinessPath, stableJson(report));
  if (options.recordEvidence !== false) {
    await emitLifecycleStep({
      stateHome,
      app: app.name,
      operation: "app verify",
      inputFingerprint: sha256(stableJson({ app: app.name, check })),
      status: status === "blocked" ? "blocked" : "failed",
      reason: `${status}: ${check.id}`,
      nextStep: check.remediation ?? "apply the typed remediation and rerun app verify",
    });
  }
  return report;
}

async function validateGeneratedArtifacts(root: string, app: string, repo: string, created: string[], updated: string[]): Promise<void> {
  const config = await loadApps(join(root, ".operon", "config.yaml"));
  const entry = config.apps.find((candidate) => candidate.name === app);
  if (config.schemaVersion !== LIFECYCLE_SCHEMA_VERSION || entry?.repo !== repo || entry.status !== "onboarding") {
    throw new Error("bootstrap: generated app config failed schema validation");
  }
  parse(await readFile(join(root, ".operon", "policy.yaml"), "utf8"));
  await assertRegularFile(join(root, ".operon", "AUTHORITY.md"), "generated authority");
  for (const rel of [...created, ...updated]) {
    const path = join(root, rel);
    await assertRegularFile(path, "generated artifact");
    const text = await readFile(path, "utf8");
    if (!text.endsWith("\n")) throw new Error(`bootstrap: generated artifact lacks final newline: ${rel}`);
    if (text.split("\n").some((line) => /[ \t]+$/.test(line))) throw new Error(`bootstrap: generated artifact has trailing whitespace: ${rel}`);
  }
}

async function validateFormatting(root: string): Promise<void> {
  const configPath = join(root, ".operon", "config.yaml");
  await loadApps(configPath);
  parse(await readFile(join(root, ".operon", "policy.yaml"), "utf8"));
  git(root, "diff", "--check");
}

function gitSnapshot(root: string): { branch: string; head: string; status: string } {
  return {
    branch: git(root, "branch", "--show-current"),
    head: git(root, "rev-parse", "HEAD"),
    status: execFileSync("git", ["status", "--porcelain=v2", "--untracked-files=all"], { cwd: root, env: GIT_ENV, encoding: "utf8" }),
  };
}

/** Bootstrap's view of the shared resolver. One implementation across the
 *  whole product (src/loop/default-branch.ts): two resolvers that could drift
 *  is how the loop ended up disagreeing with bootstrap about the base (#101). */
function remoteDefaultBranch(remoteUrl: string): string {
  return resolveRemoteDefaultBranch(remoteUrl, { errorPrefix: "bootstrap" });
}

function remoteBranchHead(remoteUrl: string, branch: string): string {
  const output = execFileSync("git", ["ls-remote", remoteUrl, `refs/heads/${branch}`], { env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const oid = output.split(/\s+/)[0];
  if (!oid || !/^[0-9a-f]{40,64}$/.test(oid)) throw new Error(`remote default branch not reachable: ${branch}`);
  return oid;
}

async function inspectManagedClone(path: string): Promise<"missing" | "symlink" | "corrupt" | "git"> {
  if (!existsSync(path)) return "missing";
  const info = await lstat(path);
  if (info.isSymbolicLink()) return "symlink";
  if (!info.isDirectory() || !existsSync(join(path, ".git"))) return "corrupt";
  return safeGit(path, "rev-parse", "--is-inside-work-tree") === "true" ? "git" : "corrupt";
}

async function recreateManagedClone(record: AppLifecycleRecord, stateHome: string): Promise<void> {
  const parent = join(resolve(stateHome), "repos");
  await mkdir(parent, { recursive: true });
  const staged = join(parent, `.${record.app}-recreate.partial`);
  await rm(staged, { recursive: true, force: true });
  try {
    git(dirname(staged), "clone", "--quiet", record.remote_url, staged);
    await rm(record.managed_clone, { recursive: true, force: true });
    await rename(staged, record.managed_clone);
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
}

function synchronizeClone(root: string, defaultBranch: string): void {
  git(root, "checkout", "--quiet", "-B", defaultBranch, `origin/${defaultBranch}`);
  git(root, "reset", "--hard", `origin/${defaultBranch}`);
  git(root, "clean", "-fd");
}

async function appActivityChecks(stateHome: string, app: string): Promise<LifecycleCheck[]> {
  const checks: LifecycleCheck[] = [];
  const locksDir = join(stateHome, "locks");
  const locks = existsSync(locksDir)
    ? (await readdir(locksDir)).filter((name) => name.startsWith(`${app}--`) && name.endsWith(".lock")).sort()
    : [];
  checks.push(locks.length === 0 ? pass("locks", "no active app role locks") : blocked("locks", `active locks: ${locks.join(", ")}`, "allow active turns to finish"));
  const pendingDir = join(stateHome, "approvals", "pending");
  const pending: string[] = [];
  if (existsSync(pendingDir)) {
    for (const file of (await readdir(pendingDir)).filter((name) => name.endsWith(".json")).sort()) {
      try {
        const record = JSON.parse(await readFile(join(pendingDir, file), "utf8")) as { app?: unknown };
        if (record.app === app) pending.push(file.slice(0, -5));
      } catch {
        checks.push(fail("approvals", `corrupt pending approval file: ${file}`));
      }
    }
  }
  if (!checks.some((check) => check.id === "approvals")) {
    checks.push(pending.length === 0 ? pass("approvals", "no pending app approvals") : blocked("approvals", `pending approvals: ${pending.join(", ")}`, "decide or withdraw approvals before promotion"));
  }
  return checks;
}

function runDeclaredChecks(root: string): LifecycleCheck[] {
  const commands = loadGateCommands(root);
  const checks: LifecycleCheck[] = [];
  // Install/setup the app's dependencies in the managed clone BEFORE the
  // test/lint gates. A freshly cloned app has no `node_modules`, so a real
  // npm scaffold's test command (`npm run build && node --test …`, needing
  // `tsc` from devDependencies) fails purely for lack of dependencies — the
  // app-check gates could never reach `ready` for an npm app (E2E-01 /
  // W0-ADJ-05). This mirrors the build loop's provision-time setup gate
  // (advanceProvisionSetup) one layer up. An unconfigured setup command is a
  // clean absence (no `app-check-setup` check, unchanged behavior). A setup
  // FAILURE is a typed `app-check-setup` blocked check with remediation, and
  // it stops before the dependent gates run so their would-be failures never
  // masquerade as the real cause.
  if (commands.setupCommand !== undefined && commands.setupCommand !== "") {
    const setup = spawnSync("/bin/sh", ["-lc", commands.setupCommand], {
      cwd: root,
      env: { ...process.env, CI: "1", GIT_TERMINAL_PROMPT: "0" },
      encoding: "utf8",
      timeout: 300_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (setup.status !== 0) {
      return [
        blocked(
          "app-check-setup",
          `${commands.setupCommand} failed with exit ${String(setup.status)}`,
          "fix `setup_command` in .operon/config.yaml (or the environment it needs) and rerun operon app verify",
        ),
      ];
    }
    checks.push(pass("app-check-setup", `${commands.setupCommand} passed`));
  }
  const declared = [
    ["tests", commands.testCommand],
    ["lint", commands.lintCommand],
  ] as const;
  let ran = 0;
  for (const [id, command] of declared) {
    if (command === undefined) continue;
    ran += 1;
    const result = spawnSync("/bin/sh", ["-lc", command], {
      cwd: root,
      env: { ...process.env, CI: "1", GIT_TERMINAL_PROMPT: "0" },
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    checks.push(result.status === 0
      ? pass(`app-check-${id}`, `${command} passed`)
      : fail(`app-check-${id}`, `${command} failed with exit ${String(result.status)}`));
  }
  if (ran === 0) checks.push(fail("app-checks", "no test or lint command declared"));
  return checks;
}

interface RuntimeReadinessProbeConfig {
  probe?: RuntimeReadinessProbe;
  configOnly?: boolean;
  timeoutMs?: number;
}

// Verify's `runtime-<provider>` checks must AGREE with `operon doctor`, so they
// run the SAME non-billable `probeRuntimeReadiness` mechanism (readiness.ts) —
// never `require.resolve` of the adapter package. Codex ships bin-only (no
// resolvable main/exports under pnpm) and pi exports no main either, so
// module-resolution false-fails a runtime that doctor's live probe reports
// `ready` (B-LIVE-04). The probe follows each adapter's real launch path up to
// (but not including) a model turn, so a genuinely unconfigured/unauthenticated
// adapter still fails — the readiness bar is unchanged, only the mechanism.
async function probeRuntimeReadinessChecks(
  runtimes: Array<{ runtime: RuntimeKind; models: string[] }>,
  config: RuntimeReadinessProbeConfig = {},
): Promise<LifecycleCheck[]> {
  const probe = config.probe ?? probeRuntimeReadiness;
  return Promise.all(
    runtimes.map(async ({ runtime, models }): Promise<LifecycleCheck> => {
      if (models.length === 0) {
        return fail(`runtime-${runtime}`, `no model configured for ${runtime}`);
      }
      if (config.configOnly === true) {
        // Config-only mirrors `doctor --config-only`: a live non-billable probe
        // is the only readiness evidence, so without it the runtime is NOT
        // proven ready. Report `blocked` (not `pass`) — configuration validity
        // is not runtime readiness, and verify must not claim a runtime is
        // ready that it never probed.
        return blocked(
          `runtime-${runtime}`,
          `configured for ${models.join(", ")}; readiness probe skipped (config-only); ` +
            "configuration validity is not runtime readiness",
          "rerun operon app verify with the adapter available to prove runtime readiness",
        );
      }
      try {
        const request: RuntimeReadinessRequest = {
          runtime,
          models,
          ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
        };
        const result = await probe(request);
        return result.status === "ready"
          ? pass(`runtime-${runtime}`, `${result.detail} [${result.durationMs}ms, non-billable]`)
          : fail(
              `runtime-${runtime}`,
              `${result.status}` +
                (result.errorCode !== undefined ? ` (${result.errorCode})` : "") +
                ` — ${result.detail}`,
            );
      } catch (error) {
        return fail(`runtime-${runtime}`, `readiness probe crashed: ${message(error)}`);
      }
    }),
  );
}

function rolesForApp(roles: Awaited<ReturnType<typeof loadRoles>>, app: AppEntry) {
  return roles.roles.filter((role) => !(role.name in app.cadence) || app.cadence[role.name]!.length > 0);
}

/** Readiness covers every tuple the effective app policy could select. Fixed
 * apps probe only configured tuples; adaptive apps probe every app-narrowed,
 * org-approved harness/model pair. The fixed Planner boot tuple is already in
 * the Planner catalog and therefore cannot escape the same check. */
function runtimeCandidatesForApp(
  roles: Awaited<ReturnType<typeof loadRoles>>,
  app: AppEntry,
): Array<{ runtime: RuntimeKind; models: string[] }> {
  const enabled = new Set(rolesForApp(roles, app).map((role) => role.name));
  const resolved = resolveAppAssignments(app, roles.roles);
  return groupRuntimes(
    resolved.roles
      .filter((role) => enabled.has(role.role))
      .flatMap((role) => role.assignments.map(({ assignment }) => ({
        runtime: assignment.harness,
        model: assignment.model,
      }))),
  );
}

function groupRuntimes(roles: Array<{ runtime: RuntimeKind; model: string }>): Array<{ runtime: RuntimeKind; models: string[] }> {
  const grouped = new Map<RuntimeKind, Set<string>>();
  for (const role of roles) {
    const models = grouped.get(role.runtime) ?? new Set<string>();
    models.add(role.model);
    grouped.set(role.runtime, models);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([runtime, models]) => ({ runtime, models: [...models].sort() }));
}

// The app-vs-registry agreement check is tamper detection over the fields that
// must be identical in both the org registry (apps.yaml) and the app-owned
// `.operon/config.yaml`: identity (name/repo), lifecycle state (status),
// operating cadence, event channels, assignment policy, and release wiring.
//
// `budgetUsdMonth` is DELIBERATELY excluded (B-LIVE-05). Budget is
// operationally owned by the org registry and enforced there: every budget
// reader/guard loads the REGISTRY apps.yaml and caps spend against
// `app.budgetUsdMonth` from it — rollupBudgets/enforceBudgetOverlay
// (src/org/budget.ts), the manual loop guard (src/cli/loop.ts budgetGuard →
// enforceBudgetOverlay(stateHome, appsFile) over the registry), and the
// dispatch tick (src/org/dispatch.ts → enforceBudgetOverlay(runtimeHome,
// appsFile) over the registry). The managed clone's `.operon/config.yaml`
// budget is never read for enforcement, so an app declaring a larger budget in
// its own config cannot thereby spend more than the registry cap. That makes an
// operator capping an app's budget in apps.yaml (registry 50 vs the config's
// bootstrap-default 1000) a normal, safe divergence — it must not fail
// verify/promote. Every other field here still has to agree, so tamper of
// identity/state/behavior is still detected.
function comparableApp(app: AppEntry): unknown {
  return {
    name: app.name,
    repo: app.repo,
    status: app.status,
    cadence: app.cadence,
    channels: app.channels ?? {},
    execution: normalizeAppExecution(app.execution),
    release: app.release ?? null,
  };
}

function canonicalLabelsCheck(
  actual: readonly { name: string; color: string; description: string }[],
): LifecycleCheck {
  const byName = new Map(actual.map((label) => [label.name, label]));
  const missing = CANONICAL_LABELS
    .filter((expected) => !byName.has(expected.name))
    .map((expected) => expected.name);
  const drifted = CANONICAL_LABELS.flatMap((expected) => {
    const found = byName.get(expected.name);
    if (found === undefined) return [];
    return found.color.toLowerCase() === expected.color.toLowerCase() &&
      found.description === expected.description
      ? []
      : [expected.name];
  });
  if (missing.length === 0 && drifted.length === 0) {
    return pass(
      "canonical-labels",
      `all ${CANONICAL_LABELS.length} canonical GitHub label definitions are installed`,
    );
  }
  const problems = [
    ...(missing.length > 0 ? [`missing: ${missing.join(", ")}`] : []),
    ...(drifted.length > 0 ? [`definition drift: ${drifted.join(", ")}`] : []),
  ];
  return blocked(
    "canonical-labels",
    problems.join("; "),
    "run the idempotent gh label create --force commands in .operon/bootstrap/next-commands.md",
  );
}

function cadenceForAnswers(answers: BootstrapAnswers, allRoles: string[]) {
  return Object.fromEntries(allRoles.flatMap((role) => {
    if (!answers.roles.includes(role)) return [[role, []]];
    return answers.cadence[role] !== undefined ? [[role, answers.cadence[role]]] : [];
  }));
}

function sanitizeAppName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) throw new Error("bootstrap: app name must contain a safe character");
  return cleaned;
}

function localRepoIdentity(remoteUrl: string, app: string): string {
  const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remoteUrl);
  return match?.[1] && match[2] ? `${match[1]}/${match[2]}` : `local/${app}`;
}

function nextCommitDate(root: string): string {
  const epoch = Number(git(root, "show", "-s", "--format=%ct", "HEAD"));
  return new Date((Number.isFinite(epoch) ? epoch + 1 : 1) * 1000).toISOString();
}

function gitWithCommitIdentity(root: string, date: string, ...args: string[]): string {
  return execFileSync("git", [
    "-c", "user.name=Operon Lifecycle",
    "-c", "user.email=lifecycle@operon.invalid",
    "-c", "commit.gpgsign=false",
    "-c", "core.hooksPath=/dev/null",
    ...args,
  ], { cwd: root, env: { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function safeGit(root: string, ...args: string[]): string | null {
  try { return git(root, ...args); } catch { return null; }
}

function gitIsAncestor(root: string, ancestor: string, descendant: string): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: root, env: GIT_ENV, stdio: "ignore" });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`git ancestry check failed for ${ancestor}..${descendant}`);
}

function pass(id: string, detail: string): LifecycleCheck { return { id, status: "pass", detail }; }
function fail(id: string, detail: string): LifecycleCheck { return { id, status: "fail", detail }; }
function blocked(id: string, detail: string, remediation: string): LifecycleCheck { return { id, status: "blocked", detail, remediation }; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

async function appConfigStatus(path: string, app: string): Promise<AppEntry["status"]> {
  const file = await loadApps(path);
  const entry = file.apps.find((candidate) => candidate.name === app);
  if (entry === undefined) throw new Error(`app promote: app config has no ${app}`);
  return entry.status;
}

function appConfigStatusText(text: string, app: string, label: string): AppEntry["status"] {
  const raw = parse(text) as Record<string, unknown>;
  const apps = raw?.["apps"];
  const spec = apps && typeof apps === "object" && !Array.isArray(apps)
    ? (apps as Record<string, unknown>)[app]
    : undefined;
  const status = spec && typeof spec === "object" && !Array.isArray(spec)
    ? (spec as Record<string, unknown>)["status"]
    : undefined;
  if (status !== "onboarding" && status !== "live" && status !== "paused") {
    throw new Error(`app promote: ${label} has no valid ${app} status`);
  }
  return status;
}

function parsePromotionJournal(text: string, app: string): PromotionJournal {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`app promote: corrupt promotion journal: ${message(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("app promote: corrupt promotion journal");
  const journal = value as Partial<PromotionJournal>;
  const validPhases = new Set<PromotionJournal["phase"]>(["intent", "config_committed", "pushed", "registry_updated", "complete"]);
  if (
    journal.schema_version !== LIFECYCLE_SCHEMA_VERSION ||
    journal.kind !== "app-promotion" ||
    journal.app !== app ||
    journal.target !== "live" ||
    typeof journal.transaction_id !== "string" ||
    !journal.transaction_id.startsWith(`promote-${app}-`) ||
    journal.phase === undefined ||
    !validPhases.has(journal.phase) ||
    (journal.promotion_commit !== null && (typeof journal.promotion_commit !== "string" || !/^[0-9a-f]{40,64}$/.test(journal.promotion_commit)))
  ) throw new Error("app promote: corrupt promotion journal");
  return journal as PromotionJournal;
}

async function readOrCreatePromotionJournal(path: string, plan: AppPromotionPlan): Promise<PromotionJournal> {
  if (existsSync(path)) {
    return parsePromotionJournal(await readFile(path, "utf8"), plan.app);
  }
  const journal: PromotionJournal = {
    schema_version: LIFECYCLE_SCHEMA_VERSION,
    kind: "app-promotion",
    transaction_id: plan.transaction_id,
    app: plan.app,
    target: "live",
    phase: "intent",
    promotion_commit: null,
  };
  await writeLifecycleFileAtomic(path, stableJson(journal));
  return journal;
}

async function patchPromotionJournal(path: string, journal: PromotionJournal, patch: Partial<PromotionJournal>): Promise<PromotionJournal> {
  const next = { ...journal, ...patch };
  await writeLifecycleFileAtomic(path, stableJson(next));
  return next;
}
