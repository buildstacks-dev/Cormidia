// Monthly budget rollup and auto-pause overlay (architecture.md §7), plus the
// runs/-to-ledger reconciliation (proportionality-review Stage 1): the run
// envelopes are the source of truth for what a pass actually cost; the ledger
// is the rollup every budget/retro/scorecard reader consumes. Reconcile walks
// the envelopes and back-fills any pass the ledger missed, keyed on run_id.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppsFile } from "./apps.js";
import { ApprovalStore } from "./approvals.js";
import {
  readLedgerRunIds,
  recordTurnOnce,
  type TurnRecord,
} from "../runtime/telemetry.js";
import type { RunEnvelope } from "../runtime/runlog/envelope.js";
import type { TurnResult } from "../runtime/types.js";

export interface BudgetRow {
  app: string;
  budgetUsd: number;
  spentUsd: number;
  percent: number;
  status: "ok" | "warning" | "exceeded";
}

export interface BudgetOverlay {
  pausedApps: string[];
}

export async function rollupBudgets(
  orgHome: string,
  apps: AppsFile,
  now: Date = new Date(),
): Promise<BudgetRow[]> {
  const month = now.toISOString().slice(0, 7);
  const spent = await readMonthSpend(orgHome, month);
  return apps.apps.map((app) => {
    const spentUsd = spent.get(app.name) ?? 0;
    const percent = app.budgetUsdMonth === 0 ? 0 : (spentUsd / app.budgetUsdMonth) * 100;
    return {
      app: app.name,
      budgetUsd: app.budgetUsdMonth,
      spentUsd,
      percent,
      status: percent >= 100 ? "exceeded" : percent >= 80 ? "warning" : "ok",
    };
  });
}

export async function enforceBudgetOverlay(
  orgHome: string,
  apps: AppsFile,
  now: Date = new Date(),
): Promise<BudgetRow[]> {
  const rows = await rollupBudgets(orgHome, apps, now);
  const overlay = await readOverlay(orgHome);
  const store = new ApprovalStore(orgHome);

  const knownApps = new Set(apps.apps.map((app) => app.name));
  const exceeded = new Set(rows.filter((r) => r.status === "exceeded").map((r) => r.app));
  // Recompute the paused set from the current rollup rather than only ever
  // adding to it: an app drops out of the overlay once its month-to-date spend
  // is back under 100% (e.g. after a month reset), so a single month's overage
  // no longer pauses a healthy live app forever. Entries for apps no longer in
  // apps.yaml are preserved so an unrelated overlay is never silently dropped.
  overlay.pausedApps = overlay.pausedApps.filter((app) => !knownApps.has(app) || exceeded.has(app));

  for (const row of rows.filter((r) => r.status === "exceeded")) {
    if (!overlay.pausedApps.includes(row.app)) overlay.pausedApps.push(row.app);
    const hashKey = `budget-exceeded:${row.app}:${now.toISOString().slice(0, 7)}`;
    const existing = (await store.listPending()).some(
      (item) => item.rule === "budget-exceeded" && item.app === row.app && item.justification === hashKey,
    );
    const decidedExisting = (await store.listDecided()).some(
      (item) => item.rule === "budget-exceeded" && item.app === row.app && item.justification === hashKey,
    );
    if (!existing && !decidedExisting) {
      await store.raise({
        app: row.app,
        role: "orchestrator",
        rule: "budget-exceeded",
        action: {
          tool: "budget",
          input: { app: row.app, spentUsd: row.spentUsd, budgetUsd: row.budgetUsd },
        },
        justification: hashKey,
        now,
      });
    }
  }

  overlay.pausedApps.sort();
  await writeOverlay(orgHome, overlay);
  return rows;
}

export async function isOverlayPaused(orgHome: string, app: string): Promise<boolean> {
  return (await readOverlay(orgHome)).pausedApps.includes(app);
}

export interface ReconcileResult {
  /** Envelopes inspected across runs/<app>/<runId>/. */
  scanned: number;
  /** Rows appended to the ledger (envelopes the ledger had never seen). */
  settled: number;
  /** Envelopes skipped: already settled, or no usage recorded. */
  alreadySettled: number;
  noUsage: number;
  /** Total equivalent-cost recovered into the ledger by this run. */
  recoveredUsd: number;
}

/** Rebuild the ledger from `runs/<app>/<run>/envelope.json` (telemetry doc
 *  Defect B item 4). Idempotent: settlement is keyed on run_id, so re-running
 *  settles nothing new, and orgs whose loop passes predate per-pass settlement
 *  recover their real history instead of starting from zero. `runtimeByRole`
 *  maps role name → runtime kind for the record (roles.yaml is the caller's to
 *  load); unknown roles record "unknown". */
export async function reconcileLedger(
  stateHome: string,
  runtimeByRole: Record<string, string> = {},
): Promise<ReconcileResult> {
  const runsDir = join(stateHome, "runs");
  const result: ReconcileResult = { scanned: 0, settled: 0, alreadySettled: 0, noUsage: 0, recoveredUsd: 0 };
  if (!existsSync(runsDir)) return result;
  const settledIds = await readLedgerRunIds(stateHome);

  for (const app of await readdir(runsDir)) {
    const appDir = join(runsDir, app);
    let runIds: string[];
    try {
      runIds = await readdir(appDir);
    } catch {
      continue; // A stray file under runs/ — never a run directory.
    }
    for (const runId of runIds) {
      const envelopePath = join(appDir, runId, "envelope.json");
      if (!existsSync(envelopePath)) continue;
      result.scanned += 1;
      let envelope: RunEnvelope;
      try {
        envelope = JSON.parse(await readFile(envelopePath, "utf8")) as RunEnvelope;
      } catch {
        continue; // Torn envelope: unreadable spend cannot be reconciled.
      }
      if (envelope.usage === undefined) {
        // No usage ever landed (hung before the turn returned, or crashed
        // pre-turn) — there is no measured spend to settle.
        result.noUsage += 1;
        continue;
      }
      if (settledIds.has(envelope.run_id)) {
        result.alreadySettled += 1;
        continue;
      }
      const record = recordFromEnvelope(envelope, runtimeByRole);
      record.escalations = await countEscalations(join(appDir, runId, "events.jsonl"));
      if (await recordTurnOnce(stateHome, record)) {
        settledIds.add(envelope.run_id);
        result.settled += 1;
        result.recoveredUsd += record.costUsd;
      } else {
        result.alreadySettled += 1;
      }
    }
  }
  return result;
}

/** Count of this month's `unmeasured` ledger rows per app (interactive
 *  sessions whose cost is unknown, not zero — Defect A). */
export async function countUnmeasured(orgHome: string, month: string): Promise<Map<string, number>> {
  const dir = join(orgHome, "telemetry");
  const counts = new Map<string, number>();
  if (!existsSync(dir)) return counts;
  for (const file of await readdir(dir)) {
    if (!file.startsWith(month) || !file.endsWith(".jsonl")) continue;
    const text = await readFile(join(dir, file), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        const record = JSON.parse(line) as TurnRecord;
        if (record.unmeasured === true) {
          const app = record.app ?? "(unattributed)";
          counts.set(app, (counts.get(app) ?? 0) + 1);
        }
      } catch {
        // Torn line — rollups tolerate it, so the count does too.
      }
    }
  }
  return counts;
}

async function countEscalations(eventsPath: string): Promise<number> {
  if (!existsSync(eventsPath)) return 0;
  const text = await readFile(eventsPath, "utf8");
  let count = 0;
  for (const line of text.split("\n")) {
    if (line.includes('"escalation.raised"')) count += 1;
  }
  return count;
}

function recordFromEnvelope(
  envelope: RunEnvelope,
  runtimeByRole: Record<string, string>,
): TurnRecord {
  const usage = envelope.usage!;
  const status: TurnResult["status"] =
    envelope.status === "completed"
      ? "completed"
      : envelope.status === "blocked"
        ? "blocked_on_gate"
        : "failed"; // running-with-usage means the turn returned but the pass never terminated; the spend is real.
  const record: TurnRecord = {
    at: envelope.started_at,
    role: envelope.role,
    runtime: runtimeByRole[envelope.role] ?? "unknown",
    model: envelope.model ?? "unknown",
    status,
    tokensIn: usage.tokens_in,
    tokensOut: usage.tokens_out,
    costUsd: usage.cost_usd,
    subagentTurns: usage.subagent_turns ?? 0,
    wallClockMs: envelope.wall_clock_ms ?? 0,
    escalations: 0,
    app: envelope.app,
    runId: envelope.run_id,
    traceId: envelope.trace_id,
    pipeline: envelope.pipeline,
    pass: envelope.pass,
  };
  if (usage.cost_estimated === true) record.costEstimated = true;
  if (usage.cache_read_tokens !== undefined) record.cacheReadTokens = usage.cache_read_tokens;
  if (usage.cache_write_tokens !== undefined) record.cacheCreationTokens = usage.cache_write_tokens;
  return record;
}

async function readMonthSpend(orgHome: string, month: string): Promise<Map<string, number>> {
  const dir = join(orgHome, "telemetry");
  const spent = new Map<string, number>();
  if (!existsSync(dir)) return spent;
  for (const file of await readdir(dir)) {
    if (!file.startsWith(month) || !file.endsWith(".jsonl")) continue;
    const text = await readFile(join(dir, file), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      const record = JSON.parse(line) as TurnRecord;
      if (record.app === undefined) continue;
      spent.set(record.app, (spent.get(record.app) ?? 0) + record.costUsd);
    }
  }
  return spent;
}

async function readOverlay(orgHome: string): Promise<BudgetOverlay> {
  const path = overlayPath(orgHome);
  if (!existsSync(path)) return { pausedApps: [] };
  const raw = JSON.parse(await readFile(path, "utf8")) as Partial<BudgetOverlay>;
  return { pausedApps: Array.isArray(raw.pausedApps) ? raw.pausedApps.map(String) : [] };
}

async function writeOverlay(orgHome: string, overlay: BudgetOverlay): Promise<void> {
  const path = overlayPath(orgHome);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(overlay, null, 2)}\n`, "utf8");
}

function overlayPath(orgHome: string): string {
  return join(orgHome, "state", "budget-overlay.json");
}
