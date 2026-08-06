// Durable parent delegated-task ledger. Pass runlogs answer "what did this
// agent turn do?"; this store answers "what outcome did the human delegate,
// and did execution remain inside Cormidia?". It is intentionally state-home
// data: exact operator prompts and native task identifiers are forensic
// evidence, not committed org policy.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { gitSnapshotOf } from "../runtime/git.js";
import type { AuthorityEvidence } from "../runtime/types.js";
import { writeFileAtomic } from "./atomic.js";
import { definedProps } from "../runtime/optional-properties.js";

export type ParentTaskStatus = "running" | "completed" | "failed" | "cancelled" | "timed_out";
type ParentTaskExecutionMode = "cormidia" | "mixed" | "external_manual";

export interface ParentTaskRecord {
  schemaVersion: 1;
  taskId: string;
  app?: string;
  objective: string;
  completionCriteria?: string;
  promptRef: "prompt.md";
  promptSha256: string;
  source?: {
    harness?: string;
    nativeTaskId?: string;
    nativeRef?: string;
  };
  repository?: {
    workdir: string;
    remote?: string;
    branch?: string;
    head?: string;
  };
  requiredStages: string[];
  executionMode: ParentTaskExecutionMode;
  fallbackEvents: Array<{ at: string; reason: string; actor?: string }>;
  status: ParentTaskStatus;
  startedAt: string;
  endedAt?: string;
  resultSummary?: string;
  completionState?: ParentTaskCompletionState;
  refs: {
    tickets: string[];
    traces: string[];
    branches: string[];
    prs: string[];
    reviews: string[];
    deployments: string[];
  };
  /** Filled by the delegated-authority slice; optional for legacy tasks. */
  charter?: AuthorityEvidence;
}

export interface ParentTaskCompletionState {
  implementation: "complete" | "incomplete" | "unknown";
  ci: "green" | "red" | "pending" | "unknown";
  cormidiaReview: "approved" | "changes_requested" | "awaiting" | "bypassed" | "not_required" | "unknown";
  humanReview: "approved" | "awaiting" | "not_required" | "unknown";
  pr: "open" | "merged" | "closed" | "abandoned" | "none" | "unknown";
  issuesCloseOnMerge: string[];
}

interface BeginParentTaskOptions {
  stateHome: string;
  taskId: string;
  originalPrompt: string;
  objective?: string;
  completionCriteria?: string;
  app?: string;
  workdir?: string;
  harness?: string;
  nativeTaskId?: string;
  nativeRef?: string;
  requiredStages?: string[];
  charter?: AuthorityEvidence;
  now?: Date;
}

export async function beginParentTask(options: BeginParentTaskOptions): Promise<ParentTaskRecord> {
  const taskId = validateTaskId(options.taskId);
  const dir = parentTaskDir(options.stateHome, taskId);
  if (existsSync(join(dir, "task.json"))) {
    throw new Error(`task begin: parent task already exists: ${taskId}`);
  }
  if (options.originalPrompt.trim().length === 0) {
    throw new Error("task begin: original prompt must not be empty");
  }
  const now = options.now ?? new Date();
  const prompt = options.originalPrompt;
  const repository = options.workdir !== undefined ? repositoryEvidence(options.workdir) : undefined;
  const source = compactSource(options);
  const record: ParentTaskRecord = {
    schemaVersion: 1,
    taskId,
    ...definedProps({ app: options.app }),
    objective: options.objective?.trim() || firstNonemptyLine(prompt),
    ...definedProps({ completionCriteria: options.completionCriteria }),
    promptRef: "prompt.md",
    promptSha256: sha256(prompt),
    ...definedProps({ source }),
    ...definedProps({ repository }),
    requiredStages: options.requiredStages ?? ["planner", "builder", "reviewer"],
    ...definedProps({ charter: options.charter }),
    executionMode: "cormidia",
    fallbackEvents: [],
    status: "running",
    startedAt: now.toISOString(),
    refs: { tickets: [], traces: [], branches: [], prs: [], reviews: [], deployments: [] },
  };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "prompt.md"), prompt, "utf8");
  await writeTask(options.stateHome, record);
  return record;
}

export async function markParentTaskFallback(options: {
  stateHome: string;
  taskId: string;
  reason: string;
  actor?: string;
  externalOnly?: boolean;
  now?: Date;
}): Promise<ParentTaskRecord> {
  const record = await readParentTask(options.stateHome, options.taskId);
  if (record.status !== "running") throw new Error(`task fallback: ${record.taskId} is already ${record.status}`);
  const reason = options.reason.trim();
  if (reason.length === 0) throw new Error("task fallback: reason must not be empty");
  record.executionMode = options.externalOnly === true ? "external_manual" : "mixed";
  record.fallbackEvents.push({
    at: (options.now ?? new Date()).toISOString(),
    reason,
    ...definedProps({ actor: options.actor }),
  });
  await writeTask(options.stateHome, record);
  return record;
}

export async function finishParentTask(options: {
  stateHome: string;
  taskId: string;
  status: Exclude<ParentTaskStatus, "running">;
  resultSummary?: string;
  refs?: Partial<ParentTaskRecord["refs"]>;
  completionState?: ParentTaskCompletionState;
  now?: Date;
}): Promise<ParentTaskRecord> {
  const record = await readParentTask(options.stateHome, options.taskId);
  if (record.status !== "running") throw new Error(`task finish: ${record.taskId} is already ${record.status}`);
  record.status = options.status;
  record.endedAt = (options.now ?? new Date()).toISOString();
  if (options.resultSummary !== undefined) record.resultSummary = options.resultSummary;
  if (options.completionState !== undefined) record.completionState = options.completionState;
  for (const key of Object.keys(record.refs) as Array<keyof ParentTaskRecord["refs"]>) {
    record.refs[key] = unique([...record.refs[key], ...(options.refs?.[key] ?? [])]);
  }
  await writeTask(options.stateHome, record);
  return record;
}

export async function readParentTask(stateHome: string, taskId: string): Promise<ParentTaskRecord> {
  const id = validateTaskId(taskId);
  const path = join(parentTaskDir(stateHome, id), "task.json");
  const record = JSON.parse(await readFile(path, "utf8")) as ParentTaskRecord;
  if (record.schemaVersion !== 1 || record.taskId !== id) {
    throw new Error(`task: invalid parent task record: ${path}`);
  }
  return record;
}

export async function readParentTaskPrompt(stateHome: string, taskId: string): Promise<string> {
  return readFile(join(parentTaskDir(stateHome, validateTaskId(taskId)), "prompt.md"), "utf8");
}

export async function listParentTasks(stateHome: string): Promise<ParentTaskRecord[]> {
  const root = join(stateHome, "tasks");
  if (!existsSync(root)) return [];
  const records: ParentTaskRecord[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      records.push(await readParentTask(stateHome, entry.name));
    } catch {
      // A torn task remains inspectable on disk but must not wedge telemetry.
    }
  }
  return records.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function parentTaskIdFrom(explicit?: string): string | undefined {
  const value = explicit ?? process.env["CORMIDIA_PARENT_TASK_ID"];
  return value !== undefined ? validateTaskId(value) : undefined;
}

export async function resolveParentTaskId(stateHome: string, explicit?: string): Promise<string | undefined> {
  const id = parentTaskIdFrom(explicit);
  if (id !== undefined) await readParentTask(stateHome, id);
  return id;
}

function parentTaskDir(stateHome: string, taskId: string): string {
  return join(resolve(stateHome), "tasks", taskId);
}

async function writeTask(stateHome: string, record: ParentTaskRecord): Promise<void> {
  const path = join(parentTaskDir(stateHome, record.taskId), "task.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, `${JSON.stringify(record, null, 2)}\n`);
}

function validateTaskId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value)) {
    throw new Error(`task: invalid task id "${value}" (use letters, digits, dot, underscore, or dash)`);
  }
  return value;
}

function repositoryEvidence(workdirInput: string): ParentTaskRecord["repository"] {
  const workdir = resolve(workdirInput);
  const git = gitSnapshotOf(workdir);
  let remote: string | undefined;
  try {
    remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: workdir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }).trim();
  } catch {
    // Non-git/local-only workdir: path remains useful evidence.
  }
  return {
    workdir,
    ...(remote !== undefined && remote.length > 0 ? { remote } : {}),
    ...(git !== undefined ? { branch: git.branch, head: git.head } : {}),
  };
}

function compactSource(options: BeginParentTaskOptions): ParentTaskRecord["source"] | undefined {
  const source = {
    ...definedProps({ harness: options.harness }),
    ...definedProps({ nativeTaskId: options.nativeTaskId }),
    ...definedProps({ nativeRef: options.nativeRef }),
  };
  return Object.keys(source).length > 0 ? source : undefined;
}

function firstNonemptyLine(prompt: string): string {
  return (
    prompt
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "delegated task"
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
