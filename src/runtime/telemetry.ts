// Per-turn cost telemetry (PURPOSE.md: silent fan-out must show up in budget
// reports). Appends one JSONL record per turn under .org/telemetry/.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Trigger, TurnResult, RoleConfig } from "./types.js";

/** Which trigger kind fired a turn — derived from `Trigger` so the two can
 *  never drift apart. Manual turns record `"manual"` (architecture.md §8). */
export type TriggerKind = keyof Trigger;

export interface TurnRecord {
  at: string; // ISO timestamp
  role: string;
  runtime: string;
  model: string;
  status: TurnResult["status"];
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  subagentTurns: number;
  wallClockMs: number;
  escalations: number;
  /** apps.yaml key of the target app, so cost rolls up per app
   *  (architecture.md §7). Omitted — not null — when unknown, so pre-M3.2
   *  JSONL lines and new unattributed ones stay byte-shape identical. */
  app?: string;
  /** Trigger kind that fired the turn. Omitted when unknown (back-compat). */
  trigger?: TriggerKind;
}

/** Optional per-turn attribution (build plan M3.2): which app the turn ran
 *  against and which trigger kind fired it. */
export interface TurnAttribution {
  app?: string;
  trigger?: TriggerKind;
}

export function toRecord(
  role: RoleConfig,
  result: TurnResult,
  at: Date,
  attribution: TurnAttribution = {},
): TurnRecord {
  const record: TurnRecord = {
    at: at.toISOString(),
    role: role.name,
    runtime: role.runtime,
    model: role.model,
    status: result.status,
    tokensIn: result.usage.tokensIn,
    tokensOut: result.usage.tokensOut,
    costUsd: result.usage.costUsd,
    subagentTurns: result.usage.subagentTurns,
    wallClockMs: result.usage.wallClockMs,
    escalations: result.escalations.length,
  };
  // Assign conditionally so absent attribution leaves the keys off the
  // record entirely — JSON.stringify then omits them from the JSONL line.
  if (attribution.app !== undefined) record.app = attribution.app;
  if (attribution.trigger !== undefined) record.trigger = attribution.trigger;
  return record;
}

export async function recordTurn(orgDir: string, record: TurnRecord): Promise<void> {
  const day = record.at.slice(0, 10);
  const path = join(orgDir, "telemetry", `${day}.jsonl`);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(record) + "\n", "utf8");
}
