// Org-layer turn runner for dispatched turns (architecture.md §3).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defaultGate } from "../runtime/gate.js";
import { getRuntime } from "../runtime/registry.js";
import { recordTurn, toRecord, type TriggerKind } from "../runtime/telemetry.js";
import type { ContextBundle, RoleConfig, Runtime, Trigger, TurnHooks, TurnResult, TurnUsage } from "../runtime/types.js";
import { loadGateCommands, runLoopOnce } from "../loop/driver.js";
import { queueReleaseApprovals } from "./release.js";
import { GhCliOps, type GhOps } from "../loop/github.js";
import { executePipeline, type PipelineRunResult } from "../loop/pipeline.js";
import { getPipeline, loadPipelines, type PassConfig } from "../loop/pipelines.js";
import { loadPolicy } from "../loop/policy.js";
import { runRole } from "../loop/runRole.js";
import { ApprovalStore } from "./approvals.js";
import type { AppEntry, AppsFile } from "./apps.js";
import { rollupBudgets } from "./budget.js";
import { assembleContext } from "./context.js";
import { composeGate } from "./gate-compose.js";
import { acquireLock, heartbeatLock, lockExists, readLock, releaseLock } from "./locks.js";
import { readJournal, writeJournalPatch, type TurnJournal } from "./journal.js";
import { appendScorecardEvent } from "./scorecards.js";
import { resolveTriggerRoute } from "./trigger-routing.js";

export interface RunDispatchedTurnOptions {
  role: RoleConfig;
  app: AppEntry;
  appsFile: AppsFile;
  turnId: string;
  runtimeHome?: string;
  orgRoot?: string;
  gh?: GhOps;
  runtimeFor?: (role: RoleConfig) => Runtime;
  now?: () => Date;
}

export interface RunDispatchedTurnResult {
  status: TurnResult["status"];
  summary: string;
}

export async function runDispatchedTurn(
  options: RunDispatchedTurnOptions,
): Promise<RunDispatchedTurnResult> {
  const clock = options.now ?? (() => new Date());
  const orgRoot = resolve(options.orgRoot ?? process.cwd());
  const runtimeHome = resolve(
    options.runtimeHome ??
      process.env.OPERON_STATE_HOME ??
      join(homedir(), ".operon", options.appsFile.org.name),
  );
  await ensureTurnLock(runtimeHome, options.app.name, options.role.name, options.turnId, clock());
  const heartbeat = setInterval(() => {
    void heartbeatLock(runtimeHome, options.app.name, options.role.name).catch(() => {});
  }, 30_000);
  heartbeat.unref?.();

  try {
    const journal = existsSync(join(runtimeHome, "state", "turns", `${options.turnId}.json`))
      ? await readJournal(runtimeHome, options.turnId)
      : await writeJournalPatch(runtimeHome, options.turnId, {
          role: options.role.name,
          app: options.app.name,
          phase: "assembling",
          attempt: 0,
          triggerKind: "manual",
          trigger: "manual",
          pid: process.pid,
        });

    await writeJournalPatch(runtimeHome, options.turnId, {
      role: options.role.name,
      app: options.app.name,
      phase: "assembling",
      pid: process.pid,
    });

    const localRepo = await withAppGitLock(runtimeHome, options.app.name, () =>
      ensureManagedClone(options.app, runtimeHome),
    );
    const context = await buildContext(orgRoot, localRepo, options.app.name, options.role, journal);
    const store = new ApprovalStore(runtimeHome);
    const hooks = {
      gate: composeGate(defaultGate, store, {
        app: options.app.name,
        role: options.role.name,
        turnId: options.turnId,
        orgHome: orgRoot,
        now: clock,
      }),
    };

    await writeJournalPatch(runtimeHome, options.turnId, {
      role: options.role.name,
      app: options.app.name,
      phase: "running",
      passStartedAt: clock().toISOString(),
      worktree: localRepo,
    });

    const route = resolveTriggerRoute({ role: options.role.name, trigger: triggerFromJournal(journal) });

    // Every executor-routed provider turn settles its own ledger row per pass
    // (Defect B); the dispatcher's turn row below is a lifecycle record only.
    const telemetry = {
      orgDir: runtimeHome,
      ...(journal.triggerKind !== undefined ? { trigger: journal.triggerKind as TriggerKind } : {}),
    };

    let result: TurnResult;
    if (route.kind === "build-loop") {
      result = await runBuilderTicketTurn({
        ...options,
        runtimeHome,
        orgRoot,
        localRepo,
        context,
        hooks,
        telemetry,
      });
    } else if (route.kind === "pipeline") {
      result = await runProtocolPipelineTurn({
        ...options,
        runtimeHome,
        orgRoot,
        localRepo,
        context,
        hooks,
        journal,
        pipelineName: route.pipeline,
        telemetry,
      });
    } else if (route.kind === "review-loop") {
      result = zeroResult(
        "completed",
        "review loop route resolved; review advancement remains owned by the ticket state machine",
        options.role,
      );
    } else {
      const generic = await runRole({
        role: options.role,
        app: options.app.name,
        turnId: options.turnId,
        dryRun: false,
        workdir: localRepo,
        runlogRoot: runtimeHome,
        runtimeFor: options.runtimeFor ?? ((role) => getRuntime(role.runtime)),
        hooks,
        context,
        clock,
        telemetry,
      });
      result = generic.record?.result ?? zeroResult("completed", "role turn completed", options.role);
    }

    await writeJournalPatch(runtimeHome, options.turnId, {
      role: options.role.name,
      app: options.app.name,
      phase: "collecting",
      session: result.session,
      escalationIds: (await store.listPending())
        .filter((item) => item.turnId === options.turnId)
        .map((item) => item.id),
    });
    // Executor-routed turns settled per pass already; a second turn-level row
    // would double-count cost and escalations and inflate retro/scorecard turn
    // counts (each pass IS a provider turn). Only the review-loop route runs
    // no passes, so only it still records its (zero-usage) turn row here.
    if (route.kind === "review-loop") {
      await recordTurn(
        runtimeHome,
        toRecord(options.role, result, clock(), {
          app: options.app.name,
          ...(journal.triggerKind !== undefined ? { trigger: journal.triggerKind } : {}),
        }),
      );
    }
    await writeJournalPatch(runtimeHome, options.turnId, {
      role: options.role.name,
      app: options.app.name,
      phase: result.status === "blocked_on_gate" ? "blocked_on_gate" : result.status === "failed" ? "failed" : "done",
      session: result.session,
    });
    return { status: result.status, summary: result.summary };
  } catch (error) {
    const pending = await new ApprovalStore(runtimeHome).listPending();
    const blocked = pending.some((item) => item.turnId === options.turnId);
    await writeJournalPatch(runtimeHome, options.turnId, {
      role: options.role.name,
      app: options.app.name,
      phase: blocked ? "blocked_on_gate" : "failed",
      message: error instanceof Error ? error.message : String(error),
    });
    const status = blocked ? "blocked_on_gate" : "failed";
    const result = zeroResult(status, error instanceof Error ? error.message : String(error), options.role);
    const failedJournal = await readJournal(runtimeHome, options.turnId);
    await recordTurn(
      runtimeHome,
      toRecord(options.role, result, clock(), {
        app: options.app.name,
        ...(failedJournal.triggerKind !== undefined ? { trigger: failedJournal.triggerKind } : {}),
      }),
    );
    return { status, summary: result.summary };
  } finally {
    clearInterval(heartbeat);
    await releaseLock(runtimeHome, options.app.name, options.role.name);
  }
}

async function runProtocolPipelineTurn(options: RunDispatchedTurnOptions & {
  runtimeHome: string;
  orgRoot: string;
  localRepo: string;
  context: ContextBundle;
  hooks: TurnHooks;
  journal: TurnJournal;
  pipelineName: string;
  telemetry: { orgDir: string; trigger?: TriggerKind };
}): Promise<TurnResult> {
  const rolesFile = await import("./roles.js").then((m) => m.loadRoles(join(options.orgRoot, "roles.yaml")));
  const roles = Object.fromEntries(rolesFile.roles.map((role) => [role.name, role]));
  const pipelines = await loadPipelines(join(options.orgRoot, "pipelines.yaml"), {
    roleNames: rolesFile.roles.map((role) => role.name),
    promptsDir: join(options.orgRoot, "prompts"),
  });
  const pipeline = getPipeline(pipelines, options.pipelineName);

  // Record the wall-clock kill cap for this running pipeline turn so the
  // dispatcher's killHungTurns honors per-pass `wall_clock_minutes` instead of
  // the 60-min default. The org journal carries one whole-turn timer
  // (passStartedAt), so we cap against the LONGEST configured pass — a hung
  // turn is still killed, but no legitimately long pass is killed early. No
  // pass declares one → field stays absent → default applies.
  const capMinutes = pipeline.passes.reduce(
    (max, pass) => (pass.wallClockMinutes !== undefined ? Math.max(max, pass.wallClockMinutes) : max),
    0,
  );
  if (capMinutes > 0) {
    await writeJournalPatch(options.runtimeHome, options.turnId, {
      role: options.role.name,
      app: options.app.name,
      wallClockCapMs: capMinutes * 60_000,
    });
  }

  const priorOutputs = new Map<string, string>();
  const now = options.now?.() ?? new Date();
  const approvalRows = await new ApprovalStore(options.runtimeHome).listPending();
  const budgetRows = (await rollupBudgets(options.runtimeHome, options.appsFile, now)).filter(
    (row) => row.status !== "ok",
  );

  const result = await executePipeline({
    pipeline,
    selection: { tier: "standard" },
    roles,
    runtimeFor: options.runtimeFor ?? ((role) => getRuntime(role.runtime)),
    briefFor: (pass) =>
      protocolBrief({
        app: options.app.name,
        role: options.role.name,
        pipelineName: options.pipelineName,
        pass,
        journal: options.journal,
        priorOutputs,
        approvalRows: approvalRows.map((item) => ({
          id: item.id,
          app: item.app,
          role: item.role,
          rule: item.rule,
          ageMs: now.getTime() - new Date(item.raisedAt).getTime(),
        })),
        budgetRows,
      }),
    promptsDir: join(options.orgRoot, "prompts"),
    context: options.context,
    workdir: options.localRepo,
    hooks: options.hooks,
    runlog: {
      root: options.runtimeHome,
      app: options.app.name,
      traceId: options.turnId,
    },
    ...(options.now !== undefined ? { clock: options.now } : {}),
    telemetry: options.telemetry,
    afterPass: (record) => {
      priorOutputs.set(record.pass.id, record.result.summary);
    },
  });

  return resultFromPipeline(options.role, options.pipelineName, result);
}

async function runBuilderTicketTurn(options: RunDispatchedTurnOptions & {
  runtimeHome: string;
  orgRoot: string;
  localRepo: string;
  context: ContextBundle;
  hooks: TurnHooks;
  telemetry: { orgDir: string; trigger?: TriggerKind };
}): Promise<TurnResult> {
  const rolesFile = await import("./roles.js").then((m) => m.loadRoles(join(options.orgRoot, "roles.yaml")));
  const roles = Object.fromEntries(rolesFile.roles.map((role) => [role.name, role]));
  const pipelines = await loadPipelines(join(options.orgRoot, "pipelines.yaml"), {
    roleNames: rolesFile.roles.map((role) => role.name),
    promptsDir: join(options.orgRoot, "prompts"),
  });
  const policy = await loadPolicy(join(options.localRepo, ".operon", "policy.yaml"));
  const gh = options.gh ?? new GhCliOps(options.app.repo);
  const result = await runLoopOnce({
    app: options.app.name,
    repo: options.app.repo,
    gh,
    localRepo: options.localRepo,
    worktreeRoot: join(options.runtimeHome, "worktrees", options.app.name),
    policy,
    commands: loadGateCommands(options.localRepo),
    maxConcurrent: 1,
    turnId: options.turnId,
    ...(options.app.release !== undefined ? { release: options.app.release } : {}),
    engine: {
      pipelines,
      roles,
      runtimeFor: options.runtimeFor ?? ((role) => getRuntime(role.runtime)),
      promptsDir: join(options.orgRoot, "prompts"),
      runlogRoot: options.runtimeHome,
      hooks: options.hooks,
      context: options.context,
      telemetry: options.telemetry,
      budgetGuard: async () => {
        const rows = await rollupBudgets(options.runtimeHome, options.appsFile, options.now?.() ?? new Date());
        const row = rows.find((r) => r.app === options.app.name);
        if (row !== undefined && row.status === "exceeded") {
          return {
            allowed: false,
            reason: `${row.app} spent $${row.spentUsd.toFixed(2)} of $${row.budgetUsd.toFixed(2)} this month`,
          };
        }
        return { allowed: true };
      },
      ...(options.now !== undefined ? { clock: options.now } : {}),
    },
  });
  // A4: a merged deploy/package milestone queues its release as a critical
  // op — dispatch-driven merges must not bypass the approval boundary.
  await queueReleaseApprovals(options.runtimeHome, options.app.name, result.items, options.now);
  for (const event of result.scorecardEvents) {
    await appendScorecardEvent(
      options.runtimeHome,
      {
        type: event.type,
        app: options.app.name,
        role: event.type === "review_cycles" ? "builder" : options.role.name,
        turnId: event.turnId,
        ticketRef: event.ticketRef,
        value: event.value,
      },
      options.now?.() ?? new Date(),
    );
  }
  if (result.budgetRefusal !== undefined) {
    // The tick never claimed — say so. "completed / no-ready-ticket" would
    // hide an exhausted cap behind an idle-looking turn.
    return zeroResult(
      "blocked_on_gate",
      `builder ticket turn refused by budget preflight: ${result.budgetRefusal}`,
      options.role,
    );
  }
  const phase = result.items[0]?.phase;
  if (phase === "merged") return zeroResult("completed", "builder ticket turn merged one ticket", options.role);
  if (phase === "blocked") return zeroResult("blocked_on_gate", "builder ticket turn blocked on gate", options.role);
  return zeroResult("completed", `builder ticket turn completed with phase ${phase ?? "no-ready-ticket"}`, options.role);
}

function protocolBrief(input: {
  app: string;
  role: string;
  pipelineName: string;
  pass: PassConfig;
  journal: TurnJournal;
  priorOutputs: Map<string, string>;
  approvalRows: { id: string; app: string; role: string; rule: string; ageMs: number }[];
  budgetRows: { app: string; spentUsd: number; budgetUsd: number; percent: number; status: string }[];
}): string {
  const prior =
    input.priorOutputs.size === 0
      ? "None yet."
      : [...input.priorOutputs.entries()]
          .map(([pass, output]) => `### ${pass}\n\n${output}`)
          .join("\n\n");
  const approvals =
    input.approvalRows.length === 0
      ? "No pending approvals."
      : input.approvalRows
          .map((item) => `- ${item.id}: ${item.app}/${item.role} ${item.rule}, age ${formatAge(item.ageMs)}`)
          .join("\n");
  const budgets =
    input.budgetRows.length === 0
      ? "No budget warnings."
      : input.budgetRows
          .map(
            (row) =>
              `- ${row.app}: ${row.status} ${row.spentUsd.toFixed(2)} / ${row.budgetUsd.toFixed(2)} (${row.percent.toFixed(1)}%)`,
          )
          .join("\n");

  return [
    `# Routed ${input.role} turn`,
    "",
    `App: ${input.app}`,
    `Role: ${input.role}`,
    `Pipeline: ${input.pipelineName}`,
    `Pass: ${input.pass.id}`,
    `Trigger: ${input.journal.triggerKind ?? "unknown"} ${input.journal.trigger ?? ""}`.trimEnd(),
    `Turn: ${input.journal.turnId}`,
    "",
    "## Operator digest",
    "",
    "### Pending approvals",
    approvals,
    "",
    "### Budget warnings",
    budgets,
    "",
    "## Prior pass outputs",
    "",
    prior,
  ].join("\n");
}

function resultFromPipeline(role: RoleConfig, pipelineName: string, result: PipelineRunResult): TurnResult {
  const statuses = result.passes.map((record) => record.result.status);
  const status = statuses.includes("blocked_on_gate")
    ? "blocked_on_gate"
    : statuses.includes("failed") || result.aborted
      ? "failed"
      : "completed";
  const usage = sumUsage(result.passes.map((record) => record.result.usage));
  const last = result.passes[result.passes.length - 1]?.result;
  return {
    status,
    summary:
      `pipeline ${pipelineName} ${status}; passes: ` +
      (result.passes.length === 0
        ? "none"
        : result.passes.map((record) => `${record.pass.id}=${record.result.status}`).join(", ")),
    artifacts: result.passes.flatMap((record) => record.result.artifacts),
    session: last?.session ?? { runtime: role.runtime, id: `pipeline-${pipelineName}-${Date.now()}` },
    usage,
    escalations: result.passes.flatMap((record) => record.result.escalations),
  };
}

function sumUsage(usages: TurnUsage[]): TurnUsage {
  return usages.reduce<TurnUsage>((acc, usage) => {
    const next: TurnUsage = {
      tokensIn: acc.tokensIn + usage.tokensIn,
      tokensOut: acc.tokensOut + usage.tokensOut,
      costUsd: acc.costUsd + usage.costUsd,
      subagentTurns: acc.subagentTurns + usage.subagentTurns,
      wallClockMs: acc.wallClockMs + usage.wallClockMs,
    };
    const tokensInUncached = (acc.tokensInUncached ?? 0) + (usage.tokensInUncached ?? 0);
    const cacheCreationTokens = (acc.cacheCreationTokens ?? 0) + (usage.cacheCreationTokens ?? 0);
    const cacheReadTokens = (acc.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0);
    if (tokensInUncached > 0) next.tokensInUncached = tokensInUncached;
    if (cacheCreationTokens > 0) next.cacheCreationTokens = cacheCreationTokens;
    if (cacheReadTokens > 0) next.cacheReadTokens = cacheReadTokens;
    return next;
  }, { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns: 0, wallClockMs: 0 });
}

function triggerFromJournal(journal: TurnJournal): Trigger {
  if (journal.triggerKind === "event" && journal.trigger !== undefined) return { event: journal.trigger };
  if (journal.triggerKind === "schedule" && journal.trigger !== undefined) return { schedule: journal.trigger };
  if (journal.triggerKind === "manual") return { manual: true };
  return { manual: true };
}

function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

async function ensureTurnLock(
  runtimeHome: string,
  app: string,
  role: string,
  turnId: string,
  now: Date,
): Promise<void> {
  if (lockExists(runtimeHome, app, role)) {
    const lock = await readLock(runtimeHome, app, role);
    if (lock.turnId === turnId) return;
  }
  const acquired = await acquireLock(runtimeHome, { app, role, turnId, now });
  if (!acquired.acquired) throw new Error(`turn lock busy for ${app}/${role}`);
}

interface GitCloneLock {
  pid: number;
  at: string;
}

const GIT_CLONE_LOCK_STALE_MS = 2 * 60 * 1000;
const GIT_CLONE_LOCK_MAX_WAIT_MS = 60 * 1000;

/** Serialize mutating git operations on the shared managed clone repos/<app>.
 *  Two roles on one app can be due in the same tick (locks are per (app, role)),
 *  and each turn runs `git fetch/checkout/reset --hard` on the SAME checkout —
 *  concurrent runs contend on .git/index.lock and fail the turn (or corrupt the
 *  tree). An app-scoped advisory lock makes those operations mutually exclusive.
 *  A crashed holder cannot wedge the app forever: the lock is broken once its
 *  holder pid is dead or it has aged past the stale window. */
export async function withAppGitLock<T>(
  runtimeHome: string,
  app: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = join(runtimeHome, "repos", `${app}.gitlock`);
  await mkdir(dirname(lockPath), { recursive: true });
  await acquireGitCloneLock(lockPath);
  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}

async function acquireGitCloneLock(lockPath: string): Promise<void> {
  const deadline = Date.now() + GIT_CLONE_LOCK_MAX_WAIT_MS;
  for (;;) {
    try {
      const fh = await open(lockPath, "wx");
      try {
        await fh.writeFile(
          `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() } satisfies GitCloneLock)}\n`,
          "utf8",
        );
      } finally {
        await fh.close();
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await breakStaleGitCloneLock(lockPath)) continue;
      if (Date.now() > deadline) {
        // A live holder has exceeded the max wait — force-break so a single
        // pathological turn can never block an app's clone indefinitely.
        await rm(lockPath, { force: true });
        continue;
      }
      await gitLockDelay(40 + Math.floor(Math.random() * 60));
    }
  }
}

async function breakStaleGitCloneLock(lockPath: string): Promise<boolean> {
  try {
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as GitCloneLock;
    const ageMs = Date.now() - new Date(lock.at).getTime();
    const holderDead = typeof lock.pid === "number" && !gitLockHolderAlive(lock.pid);
    if (holderDead || !Number.isFinite(ageMs) || ageMs > GIT_CLONE_LOCK_STALE_MS) {
      await rm(lockPath, { force: true });
      return true;
    }
    return false;
  } catch {
    // Torn lock, or the holder released between EEXIST and this read — treat as
    // breakable and retry the exclusive create.
    await rm(lockPath, { force: true });
    return true;
  }
}

function gitLockHolderAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function gitLockDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureManagedClone(app: AppEntry, runtimeHome: string): Promise<string> {
  const repoDir = join(runtimeHome, "repos", app.name);
  if (existsSync(join(repoDir, ".git"))) {
    git(repoDir, "fetch", "origin", "main");
    git(repoDir, "checkout", "main");
    git(repoDir, "reset", "--hard", "origin/main");
    return repoDir;
  }
  await mkdir(join(runtimeHome, "repos"), { recursive: true });
  git(join(runtimeHome, "repos"), "clone", repoUrl(app.repo), repoDir);
  return repoDir;
}

export function createTurnWorktree(localRepo: string, runtimeHome: string, app: string, turnId: string): string {
  const root = join(runtimeHome, "worktrees", app);
  mkdirSync(root, { recursive: true });
  const branch = `op/turn-${turnId}`;
  const path = join(root, branch.replace(/[^A-Za-z0-9._-]+/g, "-"));
  if (!existsSync(path)) git(localRepo, "worktree", "add", "-b", branch, path, "main");
  return path;
}

async function buildContext(
  orgRoot: string,
  localRepo: string,
  app: string,
  role: RoleConfig,
  journal: TurnJournal,
): Promise<ContextBundle> {
  const trigger = [journal.triggerKind, journal.trigger].filter(Boolean).join(" ");
  return (
    await assembleContext({
      orgHome: orgRoot,
      appWorkdir: localRepo,
      app,
      role,
      taskText: trigger === "" ? `${role.name} turn for ${app}` : `${role.name} ${trigger}`,
    })
  ).bundle;
}

function zeroResult(status: TurnResult["status"], summary: string, role: RoleConfig): TurnResult {
  return {
    status,
    summary,
    artifacts: [],
    session: { runtime: role.runtime, id: `turn-${Date.now()}` },
    usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns: 0, wallClockMs: 0 },
    escalations: [],
  };
}

function repoUrl(repo: string): string {
  if (repo.startsWith("/") || repo.startsWith(".") || repo.startsWith("file:")) return repo;
  return `https://github.com/${repo}.git`;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: resolve(cwd),
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Operon",
      GIT_AUTHOR_EMAIL: "operon@localhost",
      GIT_COMMITTER_NAME: "Operon",
      GIT_COMMITTER_EMAIL: "operon@localhost",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
