// Per-turn cost telemetry (docs/PURPOSE.md: silent fan-out must show up in budget
// reports). Appends one JSONL record per turn under .org/telemetry/.
//
// Settlement model (proportionality-review Stage 1 / telemetry doc Defect B):
// the unit of cost settlement is one provider turn — one Runtime.runTurn call,
// which for pipeline work means one pass. The pass executor settles each pass
// into this ledger keyed on run_id; turn-level records written by the org
// dispatcher are lifecycle records and must carry zero usage for
// executor-routed turns, or the ledger would double-count.

import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
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
  tokensInUncached?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
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
  /** Run-log correlation (telemetry doc §6): joins this ledger row to
   *  `runs/<app>/<runId>/` and makes settlement idempotent. Present on every
   *  pass-settled row; absent on legacy and turn-lifecycle rows. */
  runId?: string;
  traceId?: string;
  pipeline?: string;
  pass?: string;
  /** True when costUsd is an Operon-computed equivalent-cost estimate for a
   *  subscription-backed provider, not a provider-invoiced charge. */
  costEstimated?: boolean;
  /** True when the session's usage was unobservable (interactive co-planning
   *  through the native CLI). costUsd stays 0 — the honest reading is
   *  "unknown", never "free"; readers surface the count separately. */
  unmeasured?: boolean;
}

/** Optional per-turn attribution (build plan M3.2): which app the turn ran
 *  against and which trigger kind fired it, plus run-log correlation for
 *  pass-settled rows (Stage 1). */
export interface TurnAttribution {
  app?: string;
  trigger?: TriggerKind;
  runId?: string;
  traceId?: string;
  pipeline?: string;
  pass?: string;
  unmeasured?: boolean;
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
  if (attribution.runId !== undefined) record.runId = attribution.runId;
  if (attribution.traceId !== undefined) record.traceId = attribution.traceId;
  if (attribution.pipeline !== undefined) record.pipeline = attribution.pipeline;
  if (attribution.pass !== undefined) record.pass = attribution.pass;
  if (attribution.unmeasured === true) record.unmeasured = true;
  if (result.usage.costEstimated === true) record.costEstimated = true;
  if (result.usage.tokensInUncached !== undefined) {
    record.tokensInUncached = result.usage.tokensInUncached;
  }
  if (result.usage.cacheCreationTokens !== undefined) {
    record.cacheCreationTokens = result.usage.cacheCreationTokens;
  }
  if (result.usage.cacheReadTokens !== undefined) {
    record.cacheReadTokens = result.usage.cacheReadTokens;
  }
  return record;
}

export async function recordTurn(orgDir: string, record: TurnRecord): Promise<void> {
  const day = record.at.slice(0, 10);
  const path = join(orgDir, "telemetry", `${day}.jsonl`);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(record) + "\n", "utf8");
}

/** Append `record` unless a row with the same runId already exists anywhere in
 *  the ledger. This is what makes settlement idempotent: a resumed pass, a
 *  crashed-then-retried settle, or a `--reconcile` walk over run envelopes can
 *  never count the same provider turn twice. Returns true when appended. */
export async function recordTurnOnce(orgDir: string, record: TurnRecord): Promise<boolean> {
  if (record.runId === undefined) {
    throw new Error("recordTurnOnce: record.runId is required — idempotency is keyed on it");
  }
  if ((await readLedgerRunIds(orgDir)).has(record.runId)) return false;
  await recordTurn(orgDir, record);
  return true;
}

/** Every runId already settled into the ledger. Tolerates torn/corrupt lines
 *  (a crashed append must not wedge every later settlement). */
export async function readLedgerRunIds(orgDir: string): Promise<Set<string>> {
  const dir = join(orgDir, "telemetry");
  const ids = new Set<string>();
  if (!existsSync(dir)) return ids;
  for (const file of await readdir(dir)) {
    if (!file.endsWith(".jsonl")) continue;
    const text = await readFile(join(dir, file), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        const row = JSON.parse(line) as TurnRecord;
        if (typeof row.runId === "string") ids.add(row.runId);
      } catch {
        // Torn trailing append — skip the line, never the settlement.
      }
    }
  }
  return ids;
}

/** One row per orchestrator invocation (`operon loop`, dispatch ticks), so
 *  orchestrator activity is reconstructable, not only agent activity
 *  (telemetry doc §6). Lives in its own sibling directory: every existing
 *  reader of telemetry/*.jsonl assumes TurnRecord rows. */
export interface InvocationRecord {
  at: string; // ISO timestamp
  kind: "loop" | "dispatch";
  app?: string;
  dryRun?: boolean;
  itemsClaimed?: number;
  outcome: string;
  wallClockMs: number;
}

export async function recordInvocation(orgDir: string, record: InvocationRecord): Promise<void> {
  const day = record.at.slice(0, 10);
  const path = join(orgDir, "invocations", `${day}.jsonl`);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(record) + "\n", "utf8");
}
