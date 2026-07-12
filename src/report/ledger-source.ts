import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { TurnRecord } from "../runtime/telemetry.js";
import type { ReportRangeV1, ReportSourceDiagnosticV1 } from "./types.js";

export interface LedgerRowSource {
  day: string;
  line: number;
  record: TurnRecord;
}

export interface LedgerRangeRead {
  rows: LedgerRowSource[];
  diagnostics: ReportSourceDiagnosticV1[];
  readableDays: string[];
  selectedDays: string[];
  retainedFrom: string | null;
  retainedTo: string | null;
  fingerprint: string;
}

export async function earliestLedgerDay(stateHome: string): Promise<string | undefined> {
  const directory = join(stateHome, "telemetry");
  if (!existsSync(directory)) return undefined;
  let earliest: string | undefined;
  for (const file of (await readdir(directory)).filter(isDayFile).sort()) {
    let text: string;
    try { text = await readFile(join(directory, file), "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        const value = JSON.parse(line) as unknown;
        if (validateTurnRecord(value) !== undefined) continue;
        const at = new Date((value as TurnRecord).at);
        if (!Number.isFinite(at.getTime())) continue;
        const day = at.toISOString().slice(0, 10);
        if (earliest === undefined || day < earliest) earliest = day;
      } catch { /* unreadable row is not an all-history boundary */ }
    }
  }
  return earliest;
}

export async function readLedgerRange(
  stateHome: string,
  range: ReportRangeV1,
  now: Date = new Date(),
  hooks: { afterRead?: (path: string, attempt: number) => void | Promise<void> } = {},
): Promise<LedgerRangeRead> {
  const directory = join(stateHome, "telemetry");
  if (!existsSync(directory)) return emptyRead();
  const files = (await readdir(directory)).filter(isDayFile).sort();
  const retainedFrom = files[0]?.slice(0, 10) ?? null;
  const retainedTo = files.at(-1)?.slice(0, 10) ?? null;
  const fromDay = range.from_inclusive.slice(0, 10);
  const toDay = new Date(new Date(range.to_exclusive).getTime() - 1).toISOString().slice(0, 10);
  const selected = files.filter((file) => file.slice(0, 10) >= fromDay && file.slice(0, 10) <= toDay);
  const rows: LedgerRowSource[] = [];
  const diagnostics: ReportSourceDiagnosticV1[] = [];
  const readableDays: string[] = [];
  const fingerprint = createHash("sha256");
  for (const file of selected) {
    const path = join(directory, file);
    const day = file.slice(0, 10);
    let result: Awaited<ReturnType<typeof readStableFile>>;
    try {
      result = await readStableFile(path, hooks);
    } catch (error) {
      diagnostics.push({ kind: "unreadable_day", day, line: null, detail: safeMessage(error) });
      continue;
    }
    readableDays.push(day);
    fingerprint.update(`${file}\0${result.signature}\0`);
    if (result.concurrent) diagnostics.push({ kind: "concurrent_write", day, line: null, detail: "file changed during both read attempts; last complete read used" });
    const lines = result.text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      if (line.trim().length === 0) continue;
      const lineNumber = index + 1;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        const hasLater = lines.slice(index + 1).some((candidate) => candidate.trim().length > 0);
        diagnostics.push({ kind: hasLater ? "corrupt_line" : "torn_tail", day, line: lineNumber, detail: hasLater ? "malformed mid-file JSON" : "malformed final non-empty line" });
        continue;
      }
      const validation = validateTurnRecord(value);
      if (validation !== undefined) {
        diagnostics.push({ kind: "invalid_row", day, line: lineNumber, detail: validation });
        continue;
      }
      const record = value as TurnRecord;
      const at = new Date(record.at).getTime();
      if (!Number.isFinite(at)) {
        diagnostics.push({ kind: "invalid_timestamp", day, line: lineNumber, detail: "TurnRecord.at is not a valid ISO timestamp" });
        continue;
      }
      if (at > now.getTime() + 30_000) diagnostics.push({ kind: "future_timestamp", day, line: lineNumber, detail: "TurnRecord.at is in the future" });
      if (at >= new Date(range.from_inclusive).getTime() && at < new Date(range.to_exclusive).getTime()) {
        rows.push({ day, line: lineNumber, record });
      }
    }
  }
  return {
    rows,
    diagnostics,
    readableDays,
    selectedDays: selected.map((file) => file.slice(0, 10)),
    retainedFrom,
    retainedTo,
    fingerprint: fingerprint.digest("hex"),
  };
}

async function readStableFile(path: string, hooks: { afterRead?: (path: string, attempt: number) => void | Promise<void> }): Promise<{ text: string; signature: string; concurrent: boolean }> {
  let lastText = "";
  let lastSignature = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await stat(path);
    const text = await readFile(path, "utf8");
    await hooks.afterRead?.(path, attempt);
    const after = await stat(path);
    const beforeSignature = signature(before);
    const afterSignature = signature(after);
    lastText = text;
    lastSignature = afterSignature;
    if (beforeSignature === afterSignature) return { text, signature: afterSignature, concurrent: false };
  }
  return { text: lastText, signature: lastSignature, concurrent: true };
}

function validateTurnRecord(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "row is not an object";
  const row = value as Record<string, unknown>;
  for (const key of ["at", "role", "runtime", "model", "status"] as const) {
    if (typeof row[key] !== "string") return `${key} must be a string`;
  }
  for (const key of ["tokensIn", "tokensOut", "costUsd", "subagentTurns", "wallClockMs", "escalations"] as const) {
    if (typeof row[key] !== "number" || !Number.isFinite(row[key]) || row[key] < 0) return `${key} must be a finite non-negative number`;
  }
  for (const key of ["tokensInUncached", "cacheCreationTokens", "cacheReadTokens"] as const) {
    if (row[key] !== undefined && (typeof row[key] !== "number" || !Number.isFinite(row[key]) || row[key] < 0)) return `${key} must be a finite non-negative number`;
  }
  return undefined;
}

function signature(value: { size: number; mtimeMs: number; ino: number | bigint }): string {
  return `${String(value.ino)}:${value.size}:${value.mtimeMs}`;
}

function isDayFile(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(value);
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyRead(): LedgerRangeRead {
  return { rows: [], diagnostics: [], readableDays: [], selectedDays: [], retainedFrom: null, retainedTo: null, fingerprint: createHash("sha256").digest("hex") };
}
