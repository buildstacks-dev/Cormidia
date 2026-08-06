// Orchestrator-owned scorecards (docs/architecture.md §6).
//
// Agents never write scorecards directly. Org-layer code appends evidence
// events to scorecards/<app>/<role>.jsonl and readers aggregate from there.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const SCORECARD_EVENT_KINDS = [
  "review_cycles",
  "escaped_bug",
  "rework",
  "edit_distance",
  "gate_denial_upheld",
  "turn_cost",
] as const;

export type ScorecardEventKind = (typeof SCORECARD_EVENT_KINDS)[number];

export interface ScorecardEvent {
  type: ScorecardEventKind;
  app: string;
  role: string;
  timestamp: string;
  turnId?: string;
  ticketRef?: string;
  value?: number;
  ref?: string;
  note?: string;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface ScorecardEventInput {
  type: ScorecardEventKind | string;
  app: string;
  role: string;
  turnId?: string;
  ticketRef?: string;
  value?: number;
  ref?: string;
  note?: string;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
}

export class ScorecardValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScorecardValidationError";
  }
}

export async function appendScorecardEvent(
  root: string,
  input: ScorecardEventInput,
  now: Date = new Date(),
): Promise<{ appended: boolean; event: ScorecardEvent }> {
  const event = validateEvent({ ...input, timestamp: now.toISOString() });
  const path = scorecardPath(root, event.app, event.role);
  const existing = await readScorecards(root, event.app, event.role).catch(() => []);
  if (existing.some((candidate) => dedupeKey(candidate) === dedupeKey(event))) {
    return { appended: false, event };
  }
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(event) + "\n", "utf8");
  return { appended: true, event };
}

export async function readScorecards(root: string, app: string, role: string, since?: Date): Promise<ScorecardEvent[]> {
  const path = scorecardPath(root, app, role);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const rows = raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => validateEvent(JSON.parse(line) as Record<string, unknown>, `${path}:${index + 1}`));
  return since === undefined ? rows : rows.filter((row) => new Date(row.timestamp) >= since);
}

export function scorecardPath(root: string, app: string, role: string): string {
  return join(root, "scorecards", app, `${role}.jsonl`);
}

function validateEvent(value: Record<string, unknown>, source = "scorecard"): ScorecardEvent {
  const type = value["type"];
  if (typeof type !== "string" || !SCORECARD_EVENT_KINDS.includes(type as ScorecardEventKind)) {
    throw new ScorecardValidationError(`${source}: unknown scorecard event kind ${String(type)}`);
  }
  const app = requireString(value, "app", source);
  const role = requireString(value, "role", source);
  const timestamp = requireString(value, "timestamp", source);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new ScorecardValidationError(`${source}: timestamp must be ISO-parseable`);
  }

  const event: ScorecardEvent = { type: type as ScorecardEventKind, app, role, timestamp };
  assignString(value, event, "turnId");
  assignString(value, event, "ticketRef");
  assignString(value, event, "ref");
  assignString(value, event, "note");
  assignNumber(value, event, "value");
  assignNumber(value, event, "costUsd");
  assignNumber(value, event, "tokensIn");
  assignNumber(value, event, "tokensOut");
  return event;
}

function requireString(value: Record<string, unknown>, key: string, source: string): string {
  const entry = value[key];
  if (typeof entry !== "string" || entry.trim() === "") {
    throw new ScorecardValidationError(`${source}: ${key} must be a non-empty string`);
  }
  return entry;
}

function assignString(
  source: Record<string, unknown>,
  target: ScorecardEvent,
  key: "turnId" | "ticketRef" | "ref" | "note",
): void {
  const value = source[key];
  if (value !== undefined) {
    if (typeof value !== "string") throw new ScorecardValidationError(`scorecard: ${key} must be a string`);
    target[key] = value;
  }
}

function assignNumber(
  source: Record<string, unknown>,
  target: ScorecardEvent,
  key: "value" | "costUsd" | "tokensIn" | "tokensOut",
): void {
  const value = source[key];
  if (value !== undefined) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ScorecardValidationError(`scorecard: ${key} must be a finite number`);
    }
    target[key] = value;
  }
}

function dedupeKey(event: ScorecardEvent): string {
  return [event.type, event.turnId ?? "", event.ticketRef ?? "", event.ref ?? "", event.role, event.app].join("|");
}
