// Org-layer turn runner for dispatched turns (architecture.md §3).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defaultGate } from "../runtime/gate.js";
import { getRuntime } from "../runtime/registry.js";
import { recordTurn, toRecord } from "../runtime/telemetry.js";
import type { ContextBundle, RoleConfig, Runtime, TurnResult } from "../runtime/types.js";
import { defaultLoopInputs, loadGateCommands, runLoopOnce } from "../loop/driver.js";
import { GhCliOps, type GhOps } from "../loop/github.js";
import { loadPipelines } from "../loop/pipelines.js";
import { loadPolicy } from "../loop/policy.js";
import { runRole } from "../loop/runRole.js";
import { ApprovalStore } from "./approvals.js";
import type { AppEntry, AppsFile } from "./apps.js";
import { composeGate } from "./gate-compose.js";
import { acquireLock, heartbeatLock, lockExists, readLock, releaseLock } from "./locks.js";
import { readJournal, writeJournalPatch } from "./journal.js";

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
    options.runtimeHome ?? process.env.OPERON_HOME ?? join(homedir(), ".operon", options.appsFile.org.name),
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

    const localRepo = await ensureManagedClone(options.app, runtimeHome);
    const context = buildContext(orgRoot, localRepo);
    const store = new ApprovalStore(runtimeHome);
    const hooks = {
      gate: composeGate(defaultGate, store, {
        app: options.app.name,
        role: options.role.name,
        turnId: options.turnId,
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

    let result: TurnResult;
    if (options.role.name === "builder" && journal.triggerKind === "event" && journal.trigger === "ticket-ready") {
      result = await runBuilderTicketTurn({
        ...options,
        runtimeHome,
        orgRoot,
        localRepo,
        context,
        hooks,
      });
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
        clock,
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
    await recordTurn(
      runtimeHome,
      toRecord(options.role, result, clock(), {
        app: options.app.name,
        ...(journal.triggerKind !== undefined ? { trigger: journal.triggerKind } : {}),
      }),
    );
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

async function runBuilderTicketTurn(options: RunDispatchedTurnOptions & {
  runtimeHome: string;
  orgRoot: string;
  localRepo: string;
  context: ContextBundle;
  hooks: { gate: (action: Parameters<typeof defaultGate>[0]) => ReturnType<typeof defaultGate> };
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
    engine: {
      pipelines,
      roles,
      runtimeFor: options.runtimeFor ?? ((role) => getRuntime(role.runtime)),
      promptsDir: join(options.orgRoot, "prompts"),
      runlogRoot: options.runtimeHome,
      hooks: options.hooks,
      context: options.context,
      ...(options.now !== undefined ? { clock: options.now } : {}),
    },
  });
  const phase = result.items[0]?.phase;
  if (phase === "merged") return zeroResult("completed", "builder ticket turn merged one ticket", options.role);
  if (phase === "blocked") return zeroResult("blocked_on_gate", "builder ticket turn blocked on gate", options.role);
  return zeroResult("completed", `builder ticket turn completed with phase ${phase ?? "no-ready-ticket"}`, options.role);
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

function buildContext(orgRoot: string, localRepo: string): ContextBundle {
  return {
    taste: readExisting([join(orgRoot, "TASTE.md"), join(localRepo, ".operon", "TASTE.md")]),
    memoryExcerpts: [],
  };
}

function readExisting(paths: string[]): string[] {
  return paths.filter((path) => existsSync(path)).map((path) => readFileSync(path, "utf8"));
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
