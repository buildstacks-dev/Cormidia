import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ParentTaskRecord } from "../org/parent-task.js";
import type { RunEnvelope } from "../runtime/runlog/envelope.js";
import { scrubSecrets, truncatePreview } from "../runtime/runlog/redact.js";
import { settlementKey } from "../runtime/telemetry.js";
import type { LedgerRowSource } from "./ledger-source.js";
import type { ReportRangeV1 } from "./types.js";

export interface ReportDetailFacts {
  envelopes: Map<string, { envelope: RunEnvelope; events: EventCounts | null }>;
  missingEnvelopes: string[];
  corruptEnvelopes: string[];
  tasks: Map<string, ParentTaskRecord>;
  corruptTasks: string[];
  unsettled: Array<{ envelope: RunEnvelope; events: EventCounts | null }>;
  scanLimited: boolean;
}

export interface EventCounts {
  toolCalls: number;
  subagents: number;
  escalations: number;
}

const MAX_UNSETTLED_SCAN = 20_000;

export async function readReportDetails(
  stateHome: string,
  rows: readonly LedgerRowSource[],
  range: ReportRangeV1,
  appScope?: string,
): Promise<ReportDetailFacts> {
  const envelopes = new Map<string, { envelope: RunEnvelope; events: EventCounts | null }>();
  const missingEnvelopes: string[] = [];
  const corruptEnvelopes: string[] = [];
  const taskIds = new Set<string>();
  for (const { record } of rows) {
    if (record.parentTaskId !== undefined) taskIds.add(record.parentTaskId);
    if (record.app === undefined || record.runId === undefined) continue;
    const key = settlementKey(record.app, record.runId);
    if (envelopes.has(key)) continue;
    const path = join(stateHome, "runs", record.app, record.runId, "envelope.json");
    if (!existsSync(path)) {
      missingEnvelopes.push(key);
      continue;
    }
    try {
      const envelope = JSON.parse(await readFile(path, "utf8")) as RunEnvelope;
      if (envelope.parent_task_id !== undefined) taskIds.add(envelope.parent_task_id);
      envelopes.set(key, { envelope, events: await readEventCounts(join(stateHome, "runs", record.app, record.runId, "events.jsonl")) });
    } catch {
      corruptEnvelopes.push(key);
    }
  }
  const tasks = new Map<string, ParentTaskRecord>();
  const corruptTasks: string[] = [];
  for (const id of taskIds) {
    try {
      const task = JSON.parse(await readFile(join(stateHome, "tasks", id, "task.json"), "utf8")) as ParentTaskRecord;
      task.objective = truncatePreview(scrubSecrets(task.objective), 320);
      if (task.resultSummary !== undefined) task.resultSummary = truncatePreview(scrubSecrets(task.resultSummary), 320);
      tasks.set(id, task);
    } catch {
      corruptTasks.push(id);
    }
  }
  const settled = new Set(rows.filter(({ record }) => record.app !== undefined && record.runId !== undefined).map(({ record }) => settlementKey(record.app, record.runId!)));
  const unsettled: ReportDetailFacts["unsettled"] = [];
  let scanned = 0;
  let scanLimited = false;
  const root = join(stateHome, "runs");
  if (existsSync(root)) {
    const apps = appScope === undefined ? await childDirectories(root) : [appScope];
    outer: for (const app of apps) {
      const appRoot = join(root, app);
      if (!existsSync(appRoot)) continue;
      for (const runId of await childDirectories(appRoot)) {
        scanned += 1;
        if (scanned > MAX_UNSETTLED_SCAN) { scanLimited = true; break outer; }
        const key = settlementKey(app, runId);
        if (settled.has(key)) continue;
        try {
          const envelope = JSON.parse(await readFile(join(appRoot, runId, "envelope.json"), "utf8")) as RunEnvelope;
          const started = new Date(envelope.started_at).getTime();
          if (started >= new Date(range.from_inclusive).getTime() && started < new Date(range.to_exclusive).getTime()) {
            unsettled.push({ envelope, events: await readEventCounts(join(appRoot, runId, "events.jsonl")) });
            if (envelope.parent_task_id !== undefined && !tasks.has(envelope.parent_task_id)) {
              try {
                const task = JSON.parse(await readFile(join(stateHome, "tasks", envelope.parent_task_id, "task.json"), "utf8")) as ParentTaskRecord;
                task.objective = truncatePreview(scrubSecrets(task.objective), 320);
                tasks.set(envelope.parent_task_id, task);
              } catch { corruptTasks.push(envelope.parent_task_id); }
            }
          }
        } catch { /* corrupt envelopes already surface through Live; bounded scan cannot correlate them */ }
      }
    }
  }
  return { envelopes, missingEnvelopes, corruptEnvelopes, tasks, corruptTasks, unsettled, scanLimited };
}

async function readEventCounts(path: string): Promise<EventCounts | null> {
  if (!existsSync(path)) return null;
  try {
    const counts: EventCounts = { toolCalls: 0, subagents: 0, escalations: 0 };
    for (const line of (await readFile(path, "utf8")).split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        const value = JSON.parse(line) as { event?: string; type?: string };
        const event = value.event ?? value.type;
        if (event === "tool.called") counts.toolCalls += 1;
        if (event === "subagent.started") counts.subagents += 1;
        if (event === "escalation.raised") counts.escalations += 1;
      } catch { /* torn/corrupt L2 never affects accounting */ }
    }
    return counts;
  } catch { return null; }
}

async function childDirectories(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}
