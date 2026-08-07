// Per-turn cost telemetry (docs/PURPOSE.md: silent fan-out must show up in budget
// reports). Appends one JSONL record per turn under .org/telemetry/.
//
// Settlement model (proportionality campaign Stage 1 / telemetry doc Defect B):
// the unit of cost settlement is one provider turn — one Runtime.runTurn call,
// which for pipeline work means one pass. The pass executor settles each pass
// into this ledger keyed on run_id; turn-level records written by the org
// dispatcher are lifecycle records and must carry zero usage for
// executor-routed turns, or the ledger would double-count.

import { existsSync } from "node:fs";
import { appendFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AuthMode } from "./auth-mode.js";
import { scrubSecrets } from "./runlog/redact.js";
import { settleBilling } from "./turn-usage.js";
import type { Effort, RoleConfig, Trigger, TurnAssignmentSource, TurnResult, UsageQuality } from "./types.js";
export {
  recordInvocation,
  type InvocationRecord,
} from "./invocation-ledger.js";

/** Which trigger kind fired a turn — derived from `Trigger` so the two can
 *  never drift apart. Manual turns record `"manual"` (architecture.md §8). */
export type TriggerKind = keyof Trigger;

export interface TurnRecord {
  at: string; // ISO timestamp
  role: string;
  runtime: string;
  model: string;
  /** Exact effort used by this provider turn. Optional for historical rows
   *  and callers that have not yet adopted assignment-aware execution. */
  effort?: Effort;
  status: TurnResult["status"];
  tokensIn: number;
  tokensInUncached?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  tokensOut: number;
  costUsd: number;
  /** Complete, partial, estimated, or unavailable provider usage. */
  usageQuality: UsageQuality;
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
  /** Stable identity for one Runtime.runTurn invocation. A pass may invoke
   * the provider more than once (for example, a structured-output repair),
   * so new settlements key on this value rather than the parent runId. */
  providerTurnId?: string;
  /** Durable provider/mechanical execution record that produced this row. */
  executionStepId?: string;
  /** Organizational episode that admitted this provider turn. */
  episodeId?: string;
  /** Durable plan version and provider-step identity that authorized the turn. */
  planVersion?: number;
  planStepId?: string;
  /** Audit evidence for the atomic harness/model/effort assignment. */
  assignmentSource?: TurnAssignmentSource;
  assignmentCandidateId?: string;
  selectionReason?: string;
  resolvedCapabilities?: string[];
  traceId?: string;
  parentTaskId?: string;
  pipeline?: string;
  pass?: string;
  /** True when costUsd is a Cormidia-computed equivalent-cost estimate for a
   *  subscription-backed provider, not a provider-invoiced charge. */
  costEstimated?: boolean;
  /** Billing of the (harness × provider-family) connection that ran this turn
   *  (#333). `subscription` rows carry an authoritative `costUsd: 0` and are
   *  rolled up by VOLUME, never summed into API spend; `api_key` rows are
   *  metered spend. Absent on undeclared connections and every legacy row. */
  billing?: AuthMode;
  /** Legacy/historical marker for sessions whose usage was unobservable (the
   *  retired native interactive planner produced these). costUsd stays 0 —
   *  the honest reading is "unknown", never "free"; readers surface the count
   *  separately. New provider turns settle through the ordinary runtime. */
  unmeasured?: boolean;
  /** Learning-loop attribution (M5): replay/eval passes settle like every
   *  provider turn, and these refs are what the learning budget overlay
   *  rolls up — monthly learning spend and per-candidate replay spend
   *  (spec §13 learning_budget). Omitted on non-learning rows. */
  experimentRef?: string;
  candidateRef?: string;
  /** M6 scheduled learning roles are ordinary provider turns even when they
   * are not attributable to one candidate. This marker lets the existing
   * ledger-based learning overlay include their spend. */
  learningActivity?: "distillation" | "review";
}

/** Optional per-turn attribution (build plan M3.2): which app the turn ran
 *  against and which trigger kind fired it, plus run-log correlation for
 *  pass-settled rows (Stage 1) and learning-loop refs (M5). */
interface TurnAttribution {
  app?: string;
  trigger?: TriggerKind;
  runId?: string;
  providerTurnId?: string;
  executionStepId?: string;
  episodeId?: string;
  effort?: Effort;
  planVersion?: number;
  planStepId?: string;
  assignmentSource?: TurnAssignmentSource;
  assignmentCandidateId?: string;
  selectionReason?: string;
  resolvedCapabilities?: string[];
  traceId?: string;
  parentTaskId?: string;
  pipeline?: string;
  pass?: string;
  unmeasured?: boolean;
  experimentRef?: string;
  candidateRef?: string;
  learningActivity?: "distillation" | "review";
  /** Declared billing for the connection this turn ran on (#333). Supplied by
   *  the settlement site from org config, because the adapter layer cannot see
   *  org configuration. An adapter that observed its own billing wins. */
  billing?: AuthMode;
}

export function toRecord(
  role: RoleConfig,
  result: TurnResult,
  at: Date,
  attribution: TurnAttribution = {},
): TurnRecord {
  // #333: the adapter reports what the provider said; the org declares which
  // connection paid. `settleBilling` reconciles the two ONCE, here, so every
  // settlement site inherits the same authoritative-zero rule rather than each
  // one reimplementing it (and so the label can never disagree with the cost
  // in the row it settles). An adapter-supplied label wins over attribution:
  // it observed the turn.
  const usage = settleBilling(result.usage, result.usage.billing ?? attribution.billing);
  const record: TurnRecord = {
    at: at.toISOString(),
    role: role.name,
    runtime: role.runtime,
    model: role.model,
    status: result.status,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    costUsd: usage.costUsd,
    usageQuality:
      usage.quality ??
      (attribution.unmeasured === true ? "unavailable" : usage.costEstimated === true ? "estimated" : "complete"),
    subagentTurns: usage.subagentTurns,
    wallClockMs: usage.wallClockMs,
    escalations: result.escalations.length,
  };
  if (usage.billing !== undefined) record.billing = usage.billing;
  // Assign conditionally so absent attribution leaves the keys off the
  // record entirely — JSON.stringify then omits them from the JSONL line.
  if (attribution.app !== undefined) record.app = attribution.app;
  if (attribution.trigger !== undefined) record.trigger = attribution.trigger;
  if (attribution.runId !== undefined) record.runId = attribution.runId;
  if (attribution.providerTurnId !== undefined) record.providerTurnId = attribution.providerTurnId;
  if (attribution.executionStepId !== undefined) record.executionStepId = attribution.executionStepId;
  if (attribution.episodeId !== undefined) record.episodeId = attribution.episodeId;
  if (attribution.effort !== undefined) record.effort = attribution.effort;
  if (attribution.planVersion !== undefined) record.planVersion = attribution.planVersion;
  if (attribution.planStepId !== undefined) record.planStepId = attribution.planStepId;
  if (attribution.assignmentSource !== undefined) record.assignmentSource = attribution.assignmentSource;
  if (attribution.assignmentCandidateId !== undefined) {
    record.assignmentCandidateId = attribution.assignmentCandidateId;
  }
  if (attribution.selectionReason !== undefined) {
    record.selectionReason = scrubSecrets(attribution.selectionReason);
  }
  if (attribution.resolvedCapabilities !== undefined) {
    record.resolvedCapabilities = [...attribution.resolvedCapabilities];
  }
  if (attribution.traceId !== undefined) record.traceId = attribution.traceId;
  if (attribution.parentTaskId !== undefined) record.parentTaskId = attribution.parentTaskId;
  if (attribution.pipeline !== undefined) record.pipeline = attribution.pipeline;
  if (attribution.pass !== undefined) record.pass = attribution.pass;
  if (attribution.unmeasured === true) record.unmeasured = true;
  if (attribution.experimentRef !== undefined) record.experimentRef = attribution.experimentRef;
  if (attribution.candidateRef !== undefined) record.candidateRef = attribution.candidateRef;
  if (attribution.learningActivity !== undefined) record.learningActivity = attribution.learningActivity;
  if (usage.costEstimated === true) record.costEstimated = true;
  if (usage.tokensInUncached !== undefined) {
    record.tokensInUncached = usage.tokensInUncached;
  }
  if (usage.cacheCreationTokens !== undefined) {
    record.cacheCreationTokens = usage.cacheCreationTokens;
  }
  if (usage.cacheReadTokens !== undefined) {
    record.cacheReadTokens = usage.cacheReadTokens;
  }
  return record;
}

export async function recordTurn(orgDir: string, record: TurnRecord): Promise<void> {
  const day = record.at.slice(0, 10);
  const path = join(orgDir, "telemetry", `${day}.jsonl`);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(record) + "\n", "utf8");
}

/** Settlement identity. runId alone is NOT globally unique — mintRunId is
 *  second-granular `YYYYMMDD-HHMMSS-<pipeline>-<pass>` and two apps sharing
 *  the packaged pipelines collide when their passes start in the same UTC
 *  second; the disk layout disambiguates by `runs/<app>/`, so the ledger key
 *  must too. */
export function settlementKey(app: string | undefined, settlementId: string): string {
  return `${app ?? ""}\u0000${settlementId}`;
}

/** New rows settle one provider invocation; legacy rows settle one pass. */
export function settlementIdentity(record: Pick<TurnRecord, "providerTurnId" | "runId">): string | undefined {
  return record.providerTurnId ?? record.runId;
}

/** Append `record` unless a row with the same provider-turn identity already
 *  exists in the ledger. New rows key on (app, providerTurnId); legacy rows
 *  fall back to (app, runId). The cross-process lock makes the read+append
 *  transaction race-free. Returns true when appended. */
export async function recordTurnOnce(orgDir: string, record: TurnRecord): Promise<boolean> {
  const identity = settlementIdentity(record);
  if (identity === undefined) {
    throw new Error("recordTurnOnce: providerTurnId or legacy runId is required for idempotent settlement");
  }
  const key = settlementKey(record.app, identity);
  const release = await acquireSettlementLock(orgDir);
  try {
    // A prior writer may have reached the authoritative ledger append but
    // crashed before advancing the derived sidecar. Repair that one bounded
    // transaction before consulting the index; otherwise the sidecar miss
    // would permit a duplicate row for an already-paid provider turn.
    await repairPendingSettlement(orgDir);
    // Consult the compact settled-key sidecar index instead of re-parsing the
    // entire ledger history on every write (F-002: that made settling N turns
    // over a system's life O(N²)). The cross-process lock still serializes the
    // read+append transaction, so exactly-once holds. The index is written
    // ledger-FIRST below, so it can only ever LAG the ledger — a lag cannot
    // lose a settlement (see loadSettledIndex).
    if ((await loadSettledIndex(orgDir)).has(key)) return false;
    await writePendingSettlement(orgDir, {
      schema_version: 1,
      key,
      ledger_day: record.at.slice(0, 10),
    });
    await recordTurn(orgDir, record); // ledger row first — the durable spend
    await appendSettledKey(orgDir, key); // then the derived index
    await rm(pendingSettlementPath(orgDir), { force: true });
    return true;
  } finally {
    await release();
  }
}

/** Compact keys-only sidecar accelerating recordTurnOnce's exactly-once check
 *  (F-002). One settlement key per line, appended ledger-FIRST under the
 *  settlement lock. Kept in a sibling `telemetry-index/` directory, NOT inside
 *  `telemetry/` next to the day-keyed `<date>.jsonl` ledger files: bare
 *  `readdir(telemetry/)` enumerators (the ledger-directory convention) would
 *  otherwise `JSON.parse` the settlement keys or double-count ledger rows.
 *  Consequences of the ledger-first ordering, which the safety argument
 *  rests on:
 *   - The index can only ever LAG the ledger. A crash strictly between the
 *     ledger append and the index append leaves a key in the ledger but not the
 *     index; it can never leave a key in the index that is absent from the
 *     ledger. So `index-hit ⟹ ledger-hit` always holds — the check never
 *     false-positives, hence never SKIPS (loses) a genuinely-new paid turn.
 *   - The under-lock pending-settlement journal closes the ledger/index crash
 *     window. A retry checks that transaction's exact ledger day, repairs a
 *     lagging key, and removes the journal before it can append another row.
 *     Budget accounting also reads the ledger, not this index, so repair never
 *     changes the source of truth (invariant #6).
 *  The full ledger scan is retained only as the rebuild path. */
function settledIndexPath(orgDir: string): string {
  return join(orgDir, "telemetry-index", "settled.keys");
}

function settledIndexRecoveryMarkerPath(orgDir: string): string {
  return join(orgDir, "telemetry-index", "ledger-first-recovery-v1");
}

interface PendingSettlement {
  schema_version: 1;
  key: string;
  ledger_day: string;
}

function pendingSettlementPath(orgDir: string): string {
  return join(orgDir, "telemetry-index", "pending-settlement.json");
}

/** Persist intent before the ledger append. The global settlement lock means
 * one fixed journal path is sufficient and makes an interrupted transaction
 * discoverable by any later settlement/resume process. */
async function writePendingSettlement(orgDir: string, pending: PendingSettlement): Promise<void> {
  const path = pendingSettlementPath(orgDir);
  await writeTelemetryIndexFileAtomic(path, `${JSON.stringify(pending)}\n`);
}

/** Repair the only ambiguous ordering window: pending intent exists and the
 * ledger may or may not contain its row. Absence means the prior writer died
 * before append and the intent can be discarded. Presence means spend is
 * durable, so the sidecar must catch up before another write is considered. */
async function repairPendingSettlement(orgDir: string): Promise<void> {
  const path = pendingSettlementPath(orgDir);
  if (!existsSync(path)) return;
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(
      `telemetry pending settlement is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isPendingSettlement(value)) {
    throw new Error("telemetry pending settlement has an invalid schema");
  }
  if (await ledgerDayContainsSettlement(orgDir, value.ledger_day, value.key)) {
    const settled = await loadSettledIndex(orgDir);
    if (!settled.has(value.key)) await appendSettledKey(orgDir, value.key);
  }
  await rm(path, { force: true });
}

function isPendingSettlement(value: unknown): value is PendingSettlement {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    item["schema_version"] === 1 &&
    typeof item["key"] === "string" &&
    item["key"].length > 0 &&
    typeof item["ledger_day"] === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(item["ledger_day"])
  );
}

async function ledgerDayContainsSettlement(orgDir: string, day: string, key: string): Promise<boolean> {
  const path = join(orgDir, "telemetry", `${day}.jsonl`);
  if (!existsSync(path)) return false;
  const text = await readFile(path, "utf8");
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const row = JSON.parse(line) as TurnRecord;
      const identity = settlementIdentity(row);
      if (identity !== undefined && settlementKey(row.app, identity) === key) return true;
    } catch {
      // Torn/corrupt rows are not durable settlement evidence.
    }
  }
  return false;
}

/** Every settled key according to the sidecar. Rebuilt from the authoritative
 *  ledger (and persisted atomically) the first time it is needed, or if an
 *  operator deletes it. Tolerates torn lines the same way readSettledKeys does:
 *  a truncated trailing key is an entry that simply never matches a real query.
 *  Must be called under the settlement lock. */
async function loadSettledIndex(orgDir: string): Promise<Set<string>> {
  const path = settledIndexPath(orgDir);
  const ids = new Set<string>();
  if (existsSync(path)) {
    const text = await readFile(path, "utf8");
    for (const line of text.split("\n")) {
      if (line.length === 0) continue;
      ids.add(line);
    }
  }
  const recoveryMarker = settledIndexRecoveryMarkerPath(orgDir);
  if (!existsSync(path) || !existsSync(recoveryMarker)) {
    // One-time migration for indexes written before the pending journal
    // existed: union (never replace) retained sidecar keys with authoritative
    // ledger keys so a historical ledger-first crash cannot duplicate on the
    // first post-upgrade retry. Afterwards the transaction journal keeps this
    // fast path O(1) without repeated ledger scans.
    for (const key of await readSettledKeys(orgDir)) ids.add(key);
    await writeTelemetryIndexFileAtomic(
      path,
      [...ids]
        .sort()
        .map((id) => `${id}\n`)
        .join(""),
    );
    await writeTelemetryIndexFileAtomic(recoveryMarker, "1\n");
  }
  return ids;
}

async function writeTelemetryIndexFileAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, path);
}

/** Append one settled key to the sidecar. Called under the settlement lock,
 *  AFTER the ledger row is durable, so the index never leads the ledger. */
async function appendSettledKey(orgDir: string, key: string): Promise<void> {
  const path = settledIndexPath(orgDir);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${key}\n`, "utf8");
}

/** Every settlement key already in the ledger. Tolerates torn/corrupt lines
 *  (a crashed append must not wedge every later settlement). */
export async function readSettledKeys(orgDir: string): Promise<Set<string>> {
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
        const identity = settlementIdentity(row);
        if (identity !== undefined) ids.add(settlementKey(row.app, identity));
      } catch {
        // Torn trailing append — skip the line, never the settlement.
      }
    }
  }
  return ids;
}

const SETTLEMENT_LOCK_TIMEOUT_MS = 5_000;
const SETTLEMENT_LOCK_STALE_MS = 30_000;

/** Serialize the read+append settlement transaction across Cormidia processes.
 * O_EXCL makes acquisition atomic; a dead/stale owner is reclaimable.
 * Exported for the retention sweep (src/org/retention.ts), which must not
 * delete ledger day-files in the middle of another process's read+append
 * settlement transaction. */
export async function acquireSettlementLock(orgDir: string): Promise<() => Promise<void>> {
  const path = join(orgDir, "telemetry", ".settlement.lock");
  await mkdir(dirname(path), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, "utf8");
        await handle.close();
      } catch (error) {
        await handle.close().catch(() => {});
        await rm(path, { force: true }).catch(() => {});
        throw error;
      }
      return async () => rm(path, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await settlementLockIsStale(path)) {
        await rm(path, { force: true }).catch(() => {});
        continue;
      }
      if (Date.now() - started >= SETTLEMENT_LOCK_TIMEOUT_MS) {
        throw new Error(`telemetry settlement lock timed out: ${path}`);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
}

async function settlementLockIsStale(path: string): Promise<boolean> {
  try {
    const [metadata, contents] = await Promise.all([stat(path), readFile(path, "utf8")]);
    const old = Date.now() - metadata.mtimeMs > SETTLEMENT_LOCK_STALE_MS;
    const pid = Number(contents.split("\n", 1)[0]);
    if (!Number.isInteger(pid) || pid <= 0) return old;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ESRCH" || (code !== "EPERM" && old);
    }
  } catch {
    // The owner may have released between our EEXIST and this read. Treat a
    // vanished/unreadable path as "retry acquisition", never as authority to
    // unlink a lock another process may have just created at the same path.
    return false;
  }
}

/** Every ledger row, in (date-file, line) order. Same torn-line tolerance as
 *  readSettledKeys: a crashed append must not wedge every later reader. */
export async function readTurnRecords(orgDir: string): Promise<TurnRecord[]> {
  const dir = join(orgDir, "telemetry");
  const rows: TurnRecord[] = [];
  if (!existsSync(dir)) return rows;
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort()) {
    const text = await readFile(join(dir, file), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        rows.push(JSON.parse(line) as TurnRecord);
      } catch {
        // Torn trailing append — skip the line, never the read.
      }
    }
  }
  return rows;
}
