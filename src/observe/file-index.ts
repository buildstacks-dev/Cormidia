import { existsSync } from "node:fs";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ApprovalGrant, ApprovalItem } from "../org/approvals.js";
import type { AppsFile } from "../org/apps.js";
import type { TurnLock } from "../org/locks.js";
import { isOverlayPaused, rollupBudgets } from "../org/budget.js";
import { readParentTask, type ParentTaskRecord } from "../org/parent-task.js";
import { readValidationCampaignReports } from "../org/validation-campaign.js";
import type { RunEnvelope } from "../runtime/runlog/envelope.js";
import { readEvents } from "../runtime/runlog/events.js";
import { runPaths } from "../runtime/runlog/paths.js";
import { readStatusRows } from "../runtime/runlog/status.js";
import type { InvocationRecord, TurnRecord } from "../runtime/telemetry.js";
import type {
  IndexedPass,
  ObserveFiltersV1,
  ObserveProjectionInput,
  SourceHealthView,
} from "./types.js";

export interface LocalIndexOptions {
  orgName: string;
  stateHome: string;
  appsFile: AppsFile;
  filters: ObserveFiltersV1;
  now?: Date;
}

export type LocalProjectionSources = Omit<
  ObserveProjectionInput,
  "cursor" | "github"
>;

export async function indexLocalSources(options: LocalIndexOptions): Promise<LocalProjectionSources> {
  const now = options.now ?? new Date();
  const observedAt = now.toISOString();
  const errors: string[] = [];
  const passes = await indexPasses(options.stateHome, options.filters.app, errors);
  const tasks = await indexParentTasks(options.stateHome);
  const approvals = await indexApprovals(options.stateHome);
  const ledger = await readJsonlDirectory<TurnRecord>(join(options.stateHome, "telemetry"));
  const budgetRows = await rollupBudgets(options.stateHome, options.appsFile, now);
  const budgetPausedApps = (await Promise.all(
    options.appsFile.apps.map(async (app) => ({
      app: app.name,
      paused: await isOverlayPaused(options.stateHome, app.name),
    })),
  )).filter((entry) => entry.paused).map((entry) => entry.app);
  const invocations = await readJsonlDirectory<InvocationRecord>(join(options.stateHome, "invocations"));
  const schedule = await readObjectFile(join(options.stateHome, "state", "schedule.json"));
  const locks = await indexLocks(join(options.stateHome, "locks"));
  const inbox = await indexInbox(join(options.stateHome, "state", "events", "inbox"));
  const validationCampaigns = await readValidationCampaignReports(options.stateHome);
  errors.push(...validationCampaigns.corrupt.map((item) => `validation campaign ${item.campaign_id}: ${item.detail}`));
  errors.push(...ledger.errors.map((error) => `ledger: ${error}`));
  errors.push(...invocations.errors.map((error) => `invocations: ${error}`));

  const localStatus = errors.some((error) => error.includes("envelope") || error.includes("events")) ? "degraded" : "healthy";
  const sourceHealth: SourceHealthView[] = [
    source("local_files", localStatus, observedAt, errors.filter((error) => error.includes("envelope") || error.includes("events")).join("; ") || "Run/task files readable"),
    source("approvals", approvals.errors.length > 0 ? "degraded" : "healthy", observedAt, approvals.errors.join("; ") || "Approval files readable"),
    source("ledger", ledger.errors.length > 0 ? "degraded" : "healthy", observedAt, ledger.errors.join("; ") || "Telemetry ledger readable"),
    source(
      "scheduler",
      schedule.error !== undefined || locks.errors.length > 0 || inbox.some((item) => item.error !== undefined)
        ? "degraded"
        : "unavailable",
      observedAt,
      schedule.error ?? (
        locks.errors.join("; ") ||
        "Scheduler operational health is not measured by local definition, lock, or inbox readability"
      ),
    ),
  ];

  return {
    now,
    filters: options.filters,
    org_name: options.orgName,
    state_home: options.stateHome,
    max_concurrent_turns: options.appsFile.org.maxConcurrentTurns,
    apps: options.appsFile.apps,
    passes: passes.passes,
    corrupt_runs: passes.corrupt,
    parent_tasks: tasks.records,
    parent_task_prompts: tasks.prompts,
    corrupt_tasks: tasks.corrupt,
    approvals: approvals.records,
    ledger: ledger.records,
    budget_rows: budgetRows,
    budget_paused_apps: budgetPausedApps,
    invocations: invocations.records,
    schedule: schedule.value,
    locks: locks.records,
    inbox,
    source_health: sourceHealth,
    validation_campaigns: validationCampaigns,
  };
}

async function indexLocks(dir: string): Promise<{ records: TurnLock[]; errors: string[] }> {
  if (!existsSync(dir)) return { records: [], errors: [] };
  const records: TurnLock[] = [];
  const errors: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".lock")) continue;
    try {
      records.push(JSON.parse(await readFile(join(dir, entry.name), "utf8")) as TurnLock);
    } catch (error) {
      errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { records, errors };
}

async function indexPasses(
  stateHome: string,
  app: string | undefined,
  errors: string[],
): Promise<{ passes: IndexedPass[]; corrupt: Array<{ app: string; run_id: string; detail: string }> }> {
  const rows = await readStatusRows(stateHome, app === undefined ? {} : { app });
  const passes: IndexedPass[] = [];
  const corrupt: Array<{ app: string; run_id: string; detail: string }> = [];
  for (const row of rows) {
    if (row.status === "corrupt(envelope)") {
      const detail = `runs/${row.app}/${row.runId}/envelope.json is unreadable`;
      corrupt.push({ app: row.app, run_id: row.runId, detail });
      errors.push(`envelope: ${detail}`);
      passes.push({ row, events: [], artifacts: await inspectArtifacts(stateHome, row.app, row.runId) });
      continue;
    }
    let events = [] as IndexedPass["events"];
    let eventsCorrupt: string | undefined;
    try {
      events = await readEvents(stateHome, row.app, row.runId);
    } catch (error) {
      if (!isNotFound(error)) {
        eventsCorrupt = error instanceof Error ? error.message : String(error);
        errors.push(`events: ${eventsCorrupt}`);
      }
    }
    let finishedAt: string | undefined;
    try {
      const envelope = JSON.parse(await readFile(runPaths(stateHome, row.app, row.runId).envelope, "utf8")) as RunEnvelope;
      finishedAt = envelope.finished_at;
    } catch {
      // readStatusRows already surfaced an unreadable envelope above.
    }
    passes.push({
      row,
      ...(finishedAt !== undefined ? { envelope_finished_at: finishedAt } : {}),
      events,
      ...(eventsCorrupt !== undefined ? { events_corrupt: eventsCorrupt } : {}),
      artifacts: await inspectArtifacts(stateHome, row.app, row.runId),
    });
  }
  return { passes, corrupt };
}

async function inspectArtifacts(stateHome: string, app: string, runId: string): Promise<IndexedPass["artifacts"]> {
  const paths = runPaths(stateHome, app, runId);
  const candidates = {
    envelope: paths.envelope,
    events: paths.events,
    brief: paths.brief,
    prompt: paths.prompt,
    output: paths.output,
    activity_log: paths.sessionLog,
  };
  const result: IndexedPass["artifacts"] = {};
  for (const [key, path] of Object.entries(candidates)) {
    try {
      const info = await stat(path);
      result[key] = { available: info.isFile(), size: info.size };
    } catch {
      result[key] = { available: false, size: 0 };
    }
  }
  return result;
}

async function indexParentTasks(stateHome: string): Promise<{
  records: ParentTaskRecord[];
  prompts: Record<string, boolean>;
  corrupt: Array<{ task_id: string; detail: string }>;
}> {
  const root = join(stateHome, "tasks");
  if (!existsSync(root)) return { records: [], prompts: {}, corrupt: [] };
  const records: ParentTaskRecord[] = [];
  const prompts: Record<string, boolean> = {};
  const corrupt: Array<{ task_id: string; detail: string }> = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      records.push(await readParentTask(stateHome, entry.name));
      prompts[entry.name] = existsSync(join(root, entry.name, "prompt.md"));
    } catch (error) {
      corrupt.push({ task_id: entry.name, detail: error instanceof Error ? error.message : String(error) });
    }
  }
  records.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return { records, prompts, corrupt };
}

async function indexApprovals(stateHome: string): Promise<{
  records: Array<{ item: ApprovalItem; grant?: ApprovalGrant }>;
  errors: string[];
}> {
  const approvalsRoot = join(stateHome, "approvals");
  const errors: string[] = [];
  const items: ApprovalItem[] = [];
  for (const state of ["pending", "decided"] as const) {
    const dir = join(approvalsRoot, state);
    if (!existsSync(dir)) continue;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        items.push(JSON.parse(await readFile(join(dir, entry.name), "utf8")) as ApprovalItem);
      } catch (error) {
        errors.push(`${state}/${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const records: Array<{ item: ApprovalItem; grant?: ApprovalGrant }> = [];
  for (const item of items) {
    let grant: ApprovalGrant | undefined;
    if (item.grantId !== undefined) {
      try {
        grant = JSON.parse(await readFile(join(approvalsRoot, "grants", `${item.grantId}.json`), "utf8")) as ApprovalGrant;
      } catch (error) {
        errors.push(`grants/${item.grantId}.json: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    records.push({ item, ...(grant !== undefined ? { grant } : {}) });
  }
  return { records, errors };
}

async function readJsonlDirectory<T>(dir: string): Promise<{ records: T[]; errors: string[] }> {
  if (!existsSync(dir)) return { records: [], errors: [] };
  const records: T[] = [];
  const errors: string[] = [];
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort()) {
    const lines = (await readFile(join(dir, file), "utf8")).split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      if (line.trim().length === 0) continue;
      try {
        records.push(JSON.parse(line) as T);
      } catch (error) {
        const hasLaterData = lines.slice(index + 1).some((candidate) => candidate.trim().length > 0);
        errors.push(
          `${file}:${index + 1}: ${hasLaterData ? "malformed mid-file" : "torn final append"}`,
        );
      }
    }
  }
  return { records, errors };
}

async function readObjectFile(path: string): Promise<{ value: Record<string, string>; error?: string }> {
  if (!existsSync(path)) return { value: {} };
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return { value: value as Record<string, string> };
  } catch (error) {
    return { value: {}, error: `${path}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function indexInbox(dir: string): Promise<LocalProjectionSources["inbox"]> {
  if (!existsSync(dir)) return [];
  const out: LocalProjectionSources["inbox"] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    // Captured before the parse so a corrupt file still has a received time.
    let discoveredAt: string | undefined;
    try {
      const file = join(dir, entry.name);
      const info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error("symlink inbox entries are not accepted");
      discoveredAt = info.mtime.toISOString();
      const value = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      const occurredAt = value["occurred_at"];
      const eventId = value["id"];
      const eventSource = value["source"];
      out.push({
        filename: entry.name,
        app: typeof value["app"] === "string" ? value["app"] : null,
        kind: typeof value["kind"] === "string" ? value["kind"] : null,
        // An unparseable payload instant is dropped rather than passed through,
        // and is never backfilled from the mtime: a received time is not an
        // event time (#94).
        ...(typeof occurredAt === "string" && !Number.isNaN(Date.parse(occurredAt))
          ? { occurred_at: occurredAt }
          : {}),
        ...(typeof eventId === "string" ? { event_id: eventId } : {}),
        ...(typeof eventSource === "string" ? { source: eventSource } : {}),
        ...(discoveredAt !== undefined ? { discovered_at: discoveredAt } : {}),
      });
    } catch (error) {
      out.push({
        filename: entry.name,
        app: null,
        kind: null,
        ...(discoveredAt !== undefined ? { discovered_at: discoveredAt } : {}),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out.sort((a, b) => a.filename.localeCompare(b.filename));
}

function source(id: SourceHealthView["id"], status: SourceHealthView["status"], observedAt: string, detail: string): SourceHealthView {
  return {
    id,
    status,
    observed_at: observedAt,
    detail,
    last_success_at: status === "unavailable" ? null : observedAt,
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}
