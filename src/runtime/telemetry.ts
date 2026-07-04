// Per-turn cost telemetry (PURPOSE.md: silent fan-out must show up in budget
// reports). Appends one JSONL record per turn under .org/telemetry/.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TurnResult, RoleConfig } from "./types.js";

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
}

export function toRecord(role: RoleConfig, result: TurnResult, at: Date): TurnRecord {
  return {
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
}

export async function recordTurn(orgDir: string, record: TurnRecord): Promise<void> {
  const day = record.at.slice(0, 10);
  const path = join(orgDir, "telemetry", `${day}.jsonl`);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(record) + "\n", "utf8");
}
