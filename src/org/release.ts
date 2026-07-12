// Release handoff (docs/approval-and-release-amendment.md A4): queue the exact
// declared command as a critical op, then execute it only on a later dispatch
// after the human-approved single-use grant exists. Execution is crash-safe
// and idempotent: an in-flight/terminal record prevents a deploy from being
// guessed-and-retried after an ambiguous process death.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoopItem } from "../loop/types.js";
import { GhCliOps, type GhOps } from "../loop/github.js";
import { runRole } from "../loop/runRole.js";
import { defaultGate } from "../runtime/gate.js";
import { getRuntime } from "../runtime/registry.js";
import { recordInvocation } from "../runtime/telemetry.js";
import type { GateFn, RoleConfig, Runtime, ToolAction } from "../runtime/types.js";
import { ApprovalStore, actionHash, type ApprovalItem } from "./approvals.js";
import type { AppEntry, AppsFile } from "./apps.js";
import { writeFileAtomic } from "./atomic.js";
import { assembleContext } from "./context.js";
import { composeGate } from "./gate-compose.js";
import { loadRoles } from "./roles.js";

export interface QueuedRelease {
  approvalId: string;
  ticketRef: string;
  kind: string;
  owner: string;
}

/** Raise one `production-deploy` approval item per merged loop item that
 *  carries a releaseTrigger. Attributed to the declared owner (orchestrator
 *  or sre) so the audit trail names who is accountable for the action. */
export async function queueReleaseApprovals(
  stateHome: string,
  app: string,
  items: readonly LoopItem[],
  now?: () => Date,
): Promise<QueuedRelease[]> {
  const queued: QueuedRelease[] = [];
  const store = new ApprovalStore(stateHome);
  for (const item of items) {
    if (item.phase !== "merged" || item.releaseTrigger === undefined) continue;
    const trigger = item.releaseTrigger;
    const raised = await store.raise({
      app,
      role: trigger.owner,
      rule: "production-deploy",
      action: {
        // Make the approval bind the executable action itself. A synthetic
        // `release` tool would mint a hash no bash action could consume.
        tool: "bash",
        input: { command: trigger.command },
      },
      ticketRef: item.ticketRef,
      justification:
        `milestone ${item.ticketRef} merged with a declared ${trigger.kind} disposition; ` +
        `the app's release mechanism is owned by ${trigger.owner}`,
      ...(now !== undefined ? { now: now() } : {}),
    });
    queued.push({
      approvalId: raised.id,
      ticketRef: item.ticketRef,
      kind: trigger.kind,
      owner: trigger.owner,
    });
  }
  return queued;
}

export interface ReleaseCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ReleaseExecutionRecord {
  schemaVersion: 1;
  approvalId: string;
  app: string;
  ticketRef: string;
  owner: "orchestrator" | "sre";
  command: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  summary?: string;
  commentedAt?: string;
  commentError?: string;
}

export interface ExecuteApprovedReleasesOptions {
  stateHome: string;
  orgHome: string;
  appsFile: AppsFile;
  now?: () => Date;
  commandRunner?: (command: string, cwd: string, env: NodeJS.ProcessEnv) => Promise<ReleaseCommandResult>;
  ghFor?: (app: AppEntry) => GhOps;
  runtimeFor?: (role: RoleConfig) => Runtime;
}

export interface ReleaseExecutionOutcome {
  approvalId: string;
  app: string;
  status: "completed" | "failed" | "skipped";
  summary: string;
}

/** Execute every approved, unconsumed production release exactly once. This
 * is called by a later dispatch tick, never by the approval decision path. */
export async function executeApprovedReleases(
  options: ExecuteApprovedReleasesOptions,
): Promise<ReleaseExecutionOutcome[]> {
  const clock = options.now ?? (() => new Date());
  const store = new ApprovalStore(options.stateHome);
  const outcomes: ReleaseExecutionOutcome[] = [];
  for (const item of (await store.listDecided()).filter(isApprovedRelease)) {
    const existing = await readExecution(options.stateHome, item.id);
    if (existing !== undefined) {
      if (existing.status !== "running" && existing.commentedAt === undefined) {
        await commentOutcome(options, existing, clock);
      }
      // A running record is intentionally loud: the prior process may have
      // deployed and died before finalization, so automatic retry is unsafe.
      // Completed/failed history is quiet after any pending comment retry.
      if (existing.status === "running") {
        outcomes.push({
          approvalId: item.id,
          app: item.app,
          status: "skipped",
          summary: `release ${item.id} has an ambiguous running record; inspect before retrying`,
        });
      }
      continue;
    }

    const shown = await store.show(item.id);
    if (shown.grant === undefined || shown.grant.uses <= 0 || shown.grant.revokedAt !== undefined) {
      continue;
    }
    if (new Date(shown.grant.expiresAt).getTime() <= clock().getTime()) continue;

    const app = options.appsFile.apps.find((entry) => entry.name === item.app);
    const command = releaseCommand(item);
    const ticketRef = item.ticketRef;
    const owner = item.role;
    if (app === undefined || command === undefined || ticketRef === undefined || !isReleaseOwner(owner)) {
      outcomes.push({
        approvalId: item.id,
        app: item.app,
        status: "failed",
        summary: `approved release ${item.id} has invalid app/owner/command/ticket metadata`,
      });
      continue;
    }

    const started = clock();
    let record: ReleaseExecutionRecord = {
      schemaVersion: 1,
      approvalId: item.id,
      app: item.app,
      ticketRef,
      owner,
      command,
      status: "running",
      startedAt: started.toISOString(),
    };
    await writeExecution(options.stateHome, record);

    try {
      const result = owner === "orchestrator"
        ? await executeOrchestratorRelease(options, store, item, app, command)
        : await executeSreRelease(options, store, item, app, command);
      record = {
        ...record,
        status: result.exitCode === 0 ? "completed" : "failed",
        finishedAt: clock().toISOString(),
        exitCode: result.exitCode,
        summary: releaseSummary(result),
      };
    } catch (error) {
      record = {
        ...record,
        status: "failed",
        finishedAt: clock().toISOString(),
        summary: error instanceof Error ? error.message : String(error),
      };
    }
    await writeExecution(options.stateHome, record);
    await recordInvocation(options.stateHome, {
      at: record.finishedAt ?? clock().toISOString(),
      kind: "release",
      app: record.app,
      outcome: `${record.approvalId} ${record.status}: ${record.summary ?? "no summary"}`,
      wallClockMs: Math.max(0, clock().getTime() - started.getTime()),
    });
    await commentOutcome(options, record, clock);
    const persisted = (await readExecution(options.stateHome, item.id)) ?? record;
    outcomes.push({
      approvalId: item.id,
      app: item.app,
      status: record.status === "completed" ? "completed" : "failed",
      summary:
        persisted.commentError === undefined
          ? record.summary ?? record.status
          : `${record.summary ?? record.status}; ticket comment failed: ${persisted.commentError}`,
    });
  }
  return outcomes;
}

async function executeOrchestratorRelease(
  options: ExecuteApprovedReleasesOptions,
  store: ApprovalStore,
  item: ApprovalItem,
  app: AppEntry,
  command: string,
): Promise<ReleaseCommandResult> {
  const grant = store.findMatchingGrantSync({
    app: item.app,
    role: item.role,
    actionHash: actionHash(item.action),
    rule: item.rule,
    actionText: `${item.action.tool} ${JSON.stringify(item.action.input)}`,
    ...(item.ticketRef !== undefined ? { ticketRef: item.ticketRef } : {}),
    now: options.now?.() ?? new Date(),
  });
  if (grant === undefined) throw new Error(`release ${item.id}: approved grant does not match the command`);
  store.consumeGrantSync(grant.grantId, options.now?.() ?? new Date());
  const cwd = managedClone(options.stateHome, app);
  return (options.commandRunner ?? runReleaseCommand)(command, cwd, { ...process.env, CI: "1" });
}

async function executeSreRelease(
  options: ExecuteApprovedReleasesOptions,
  store: ApprovalStore,
  item: ApprovalItem,
  app: AppEntry,
  command: string,
): Promise<ReleaseCommandResult> {
  const roles = await loadRoles(join(options.orgHome, "roles.yaml"));
  const role = roles.roles.find((entry) => entry.name === "sre");
  if (role === undefined) throw new Error("release: owner sre requires an sre role in roles.yaml");
  const cwd = managedClone(options.stateHome, app);
  const context = (
    await assembleContext({
      orgHome: options.orgHome,
      appWorkdir: cwd,
      app: app.name,
      role,
      taskText: `execute approved release ${item.id} for ${item.ticketRef ?? "unknown ticket"}`,
    })
  ).bundle;
  let attempted = false;
  const baseGate = composeGate(defaultGate, store, {
    app: item.app,
    role: item.role,
    ...(item.ticketRef !== undefined ? { ticketRef: item.ticketRef } : {}),
    orgHome: options.orgHome,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  const gate: GateFn = (action) => {
    if (!attempted && sameReleaseCommand(action, command)) {
      const shown = store.findMatchingGrantSync({
        app: item.app,
        role: item.role,
        actionHash: actionHash(item.action),
        now: options.now?.() ?? new Date(),
      });
      if (shown === undefined) return { allow: false, reason: "approved release grant is unavailable", escalate: false };
      store.consumeGrantSync(shown.grantId, options.now?.() ?? new Date());
      attempted = true;
      return { allow: true };
    }
    return baseGate(action);
  };
  const turn = await runRole({
    role,
    app: app.name,
    turnId: `release-${item.id}`,
    dryRun: false,
    workdir: cwd,
    runlogRoot: options.stateHome,
    runtimeFor: options.runtimeFor ?? ((selected) => getRuntime(selected.runtime)),
    hooks: { gate },
    context,
    telemetry: { orgDir: options.stateHome, trigger: "manual" },
    briefOverride: [
      "# Approved production release",
      "",
      `Approval: ${item.id}`,
      `App: ${app.name}`,
      `Ticket: ${item.ticketRef ?? "(none)"}`,
      "",
      "Run exactly this already-approved command once, without prefixes, suffixes, or substitutions:",
      "",
      "```sh",
      command,
      "```",
      "",
      "Report the command outcome. Do not perform smoke checks or rollback in this turn.",
    ].join("\n"),
  });
  const result = turn.record?.result;
  if (!attempted) throw new Error("SRE release turn completed without attempting the approved command");
  if (result === undefined) throw new Error("SRE release turn produced no pass result");
  return {
    exitCode: result.status === "completed" ? 0 : 1,
    stdout: result.summary,
    stderr: result.status === "completed" ? "" : result.summary,
  };
}

function managedClone(stateHome: string, app: AppEntry): string {
  const path = join(stateHome, "repos", app.name);
  if (!existsSync(path)) {
    throw new Error(`release: managed clone missing for ${app.name}: ${path}`);
  }
  return path;
}

function isApprovedRelease(item: ApprovalItem): boolean {
  return item.rule === "production-deploy" && item.status === "approved" && item.decision === "approved";
}

function isReleaseOwner(value: string): value is "orchestrator" | "sre" {
  return value === "orchestrator" || value === "sre";
}

function releaseCommand(item: ApprovalItem): string | undefined {
  if (item.action.tool === "bash" && isRecord(item.action.input) && typeof item.action.input.command === "string") {
    return item.action.input.command;
  }
  // Backward compatibility for approvals queued before issue #18 landed.
  if (item.action.tool === "release" && isRecord(item.action.input) && typeof item.action.input.command === "string") {
    return item.action.input.command;
  }
  return undefined;
}

function sameReleaseCommand(action: ToolAction, expected: string): boolean {
  if (action.tool !== "bash" || !isRecord(action.input) || typeof action.input.command !== "string") return false;
  const actual = action.input.command.trim();
  if (actual === expected.trim()) return true;
  const wrapped = /^(?:\/bin\/)?(?:zsh|bash|sh)\s+-lc\s+(.+)$/.exec(actual)?.[1];
  return wrapped !== undefined && decodeShellWord(wrapped) === expected.trim();
}

function decodeShellWord(value: string): string {
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/'\\''/g, "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value;
    }
  }
  return value;
}

async function commentOutcome(
  options: ExecuteApprovedReleasesOptions,
  record: ReleaseExecutionRecord,
  clock: () => Date,
): Promise<void> {
  const issueNumber = Number(/^#(\d+)$/.exec(record.ticketRef)?.[1]);
  const app = options.appsFile.apps.find((entry) => entry.name === record.app);
  if (!Number.isInteger(issueNumber) || app === undefined) return;
  try {
    await (options.ghFor?.(app) ?? new GhCliOps(app.repo)).commentIssue(
      issueNumber,
      [
        "## Operon release outcome",
        "",
        `- Approval: \`${record.approvalId}\``,
        `- Owner: \`${record.owner}\``,
        `- Status: **${record.status}**`,
        `- Command: \`${record.command.replace(/`/g, "\\`")}\``,
        ...(record.exitCode !== undefined ? [`- Exit code: \`${record.exitCode}\``] : []),
        "",
        record.summary ?? "No command summary was captured.",
      ].join("\n"),
    );
    const { commentError: _commentError, ...withoutCommentError } = record;
    await writeExecution(options.stateHome, { ...withoutCommentError, commentedAt: clock().toISOString() });
  } catch (error) {
    await writeExecution(options.stateHome, {
      ...record,
      commentError: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readExecution(stateHome: string, approvalId: string): Promise<ReleaseExecutionRecord | undefined> {
  const path = executionPath(stateHome, approvalId);
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8")) as ReleaseExecutionRecord;
}

async function writeExecution(stateHome: string, record: ReleaseExecutionRecord): Promise<void> {
  const path = executionPath(stateHome, record.approvalId);
  await mkdir(join(stateHome, "releases"), { recursive: true });
  await writeFileAtomic(path, `${JSON.stringify(record, null, 2)}\n`);
}

function executionPath(stateHome: string, approvalId: string): string {
  return join(stateHome, "releases", `${approvalId}.json`);
}

function releaseSummary(result: ReleaseCommandResult): string {
  const detail = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  return `command exited ${result.exitCode}${detail.length > 0 ? `\n${tail(detail, 4000)}` : ""}`;
}

function tail(value: string, max: number): string {
  return value.length <= max ? value : value.slice(value.length - max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function runReleaseCommand(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<ReleaseCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, env, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout = tail(stdout + chunk.toString("utf8"), 16_000); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = tail(stderr + chunk.toString("utf8"), 16_000); });
    child.once("error", reject);
    child.once("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}
