import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sha256 } from "./core.js";

export const CONTINUATION_STAGES = ["route", "contract", "commit", "push", "gates", "pr", "review_finding", "approval", "release"] as const;
export type ContinuationStage = typeof CONTINUATION_STAGES[number];
export type StopKind = "cap_stop" | "cancelled" | "crash" | "provider_timeout";
interface StageRecord { stage: ContinuationStage; artifact_sha256: string; productive: boolean; invalidated_reason?: string; terminal_records: 1; provider_settlements: 0 | 1 }
interface Journal { schema_version: 1; status: "running" | "interrupted" | "completed" | StopKind; stages: StageRecord[]; next_stage: ContinuationStage | null; stop_evidence?: { kind: StopKind; next_step: string } }
export interface ContinuationRun { journal: Journal; executed: ContinuationStage[]; reused: ContinuationStage[]; repeated_valid_productive_passes: number }

export function runContinuation(root: string, options: { interruptAfter?: ContinuationStage; stop?: StopKind; invalidate?: { stage: ContinuationStage; reason: string } } = {}): ContinuationRun {
  const journalPath = join(root, "execution-journal.json");
  const journal = readJournal(journalPath);
  if (options.invalidate) invalidateFrom(root, journal, options.invalidate.stage, options.invalidate.reason);
  const executed: ContinuationStage[] = [];
  const reused = journal.stages.map((record) => record.stage);
  const completed = new Set(journal.stages.map((record) => record.stage));
  for (const stage of CONTINUATION_STAGES) {
    if (completed.has(stage)) continue;
    const artifact = join(root, "artifacts", `${stage}.json`);
    writeAtomic(artifact, { stage, value: deterministicValue(stage), created_by: "continuation-harness" });
    const provider = ["route", "contract", "commit", "review_finding"].includes(stage);
    const record: StageRecord = { stage, artifact_sha256: `sha256:${sha256(readFileSync(artifact))}`, productive: true, terminal_records: 1, provider_settlements: provider ? 1 : 0 };
    journal.stages.push(record); executed.push(stage); completed.add(stage);
    journal.status = "running";
    journal.next_stage = nextStage(stage);
    writeAtomic(journalPath, journal);
    if (options.interruptAfter === stage) {
      journal.status = "interrupted"; writeAtomic(journalPath, journal);
      return result(journal, executed, reused);
    }
    if (options.stop && executed.length === 1) {
      journal.status = options.stop;
      journal.stop_evidence = { kind: options.stop, next_step: journal.next_stage ? `resume:${journal.next_stage}` : "settle" };
      writeAtomic(journalPath, journal);
      return result(journal, executed, reused);
    }
  }
  journal.status = "completed"; journal.next_stage = null; delete journal.stop_evidence; writeAtomic(journalPath, journal);
  return result(journal, executed, reused);
}

export function reconcileContinuation(root: string): Journal {
  const path = join(root, "execution-journal.json");
  const journal = readJournal(path);
  const unique = new Map<ContinuationStage, StageRecord>();
  for (const record of journal.stages) {
    const prior = unique.get(record.stage);
    if (prior && prior.artifact_sha256 !== record.artifact_sha256) throw new Error(`conflicting_stage_settlement:${record.stage}`);
    unique.set(record.stage, record);
  }
  journal.stages = CONTINUATION_STAGES.flatMap((stage) => unique.get(stage) ? [unique.get(stage)!] : []);
  if (journal.stages.some((record) => record.terminal_records !== 1 || ![0, 1].includes(record.provider_settlements))) throw new Error("invalid_terminal_or_settlement_count");
  writeAtomic(path, journal);
  return journal;
}

function invalidateFrom(root: string, journal: Journal, stage: ContinuationStage, reason: string): void {
  if (reason.trim() === "") throw new Error("invalidation_reason_required");
  const index = CONTINUATION_STAGES.indexOf(stage);
  const removed = journal.stages.filter((record) => CONTINUATION_STAGES.indexOf(record.stage) >= index);
  if (removed.length === 0) throw new Error("invalidation_stage_not_completed");
  journal.stages = journal.stages.filter((record) => CONTINUATION_STAGES.indexOf(record.stage) < index);
  const marker = join(root, "invalidations", `${stage}.json`); writeAtomic(marker, { stage, reason, removed: removed.map((record) => record.stage) });
  journal.status = "interrupted"; journal.next_stage = stage;
}
function readJournal(path: string): Journal {
  if (!existsSync(path)) return { schema_version: 1, status: "running", stages: [], next_stage: "route" };
  return JSON.parse(readFileSync(path, "utf8")) as Journal;
}
function result(journal: Journal, executed: ContinuationStage[], reused: ContinuationStage[]): ContinuationRun { return { journal, executed, reused, repeated_valid_productive_passes: executed.filter((stage) => reused.includes(stage)).length }; }
function nextStage(stage: ContinuationStage): ContinuationStage | null { const index = CONTINUATION_STAGES.indexOf(stage); return CONTINUATION_STAGES[index + 1] ?? null; }
function deterministicValue(stage: ContinuationStage): string { return sha256(`operon-continuation\0${stage}`); }
function writeAtomic(path: string, value: unknown): void { mkdirSync(dirname(path), { recursive: true }); const temp = `${path}.tmp`; writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); renameSync(temp, path); }
