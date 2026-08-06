// Monthly budget rollup and auto-pause overlay (architecture.md §7), plus the
// runs/-to-ledger reconciliation (proportionality campaign Stage 1): the run
// envelopes are the source of truth for what a pass actually cost; the ledger
// is the rollup every budget/retro/scorecard reader consumes. Reconcile walks
// the envelopes and back-fills any pass the ledger missed, keyed on run_id.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  finalizeEpisode,
  readEfficiencyEvidence,
  readRouteRecord,
  reconcileStaleProviderSteps,
  routeRecordPath,
  type ExecutionStepRecord,
} from "../loop/efficiency.js";
import { withFileLock } from "../runtime/file-lock.js";
import { finalizeRun, readEnvelope, type RunEnvelope } from "../runtime/runlog/envelope.js";
import { scrubSecrets } from "../runtime/runlog/redact.js";
import { readSettledKeys, recordTurnOnce, settlementKey, type TurnRecord } from "../runtime/telemetry.js";
import type { TurnResult } from "../runtime/types.js";
import { ApprovalStore, type ApprovalItem } from "./approvals.js";
import type { AppsFile } from "./apps.js";

export interface BudgetRow {
  app: string;
  budgetUsd: number;
  spentUsd: number;
  percent: number;
  /** `unknown` = the month total could not be computed (a ledger row had a
   *  non-finite/absent `costUsd`). It is a distinct not-ok state that fails
   *  CLOSED: treated as OVER cap everywhere (`isBudgetBlocking`), never `ok`
   *  (A-004). Never let "I could not compute the spend" read as "the spend is
   *  fine". */
  status: "ok" | "warning" | "exceeded" | "unknown";
}

/** A budget row blocks spend (pause + raise, and it must never un-pause) when
 *  the app is over cap OR its total could not be verified. Both are fail-closed
 *  over-cap states; only these two block. */
export function isBudgetBlocking(status: BudgetRow["status"]): boolean {
  return status === "exceeded" || status === "unknown";
}

interface BudgetOverlay {
  pausedApps: string[];
}

export async function rollupBudgets(orgHome: string, apps: AppsFile, now: Date = new Date()): Promise<BudgetRow[]> {
  const month = now.toISOString().slice(0, 7);
  const { spent, unresolved } = await readMonthSpend(orgHome, month);
  return apps.apps.map((app) => {
    const spentUsd = spent.get(app.name) ?? 0;
    const percent = app.budgetUsdMonth === 0 ? 0 : (spentUsd / app.budgetUsdMonth) * 100;
    // A row with a non-finite/absent cost means the total is not trustworthy —
    // fail closed to `unknown` (over cap) rather than reporting a partial sum
    // as `ok`. `Number.isFinite(percent)` is belt-and-braces: with the ledger
    // boundary now skipping bad rows, `percent` is always finite here.
    const status: BudgetRow["status"] =
      unresolved.has(app.name) || !Number.isFinite(percent)
        ? "unknown"
        : percent >= 100
          ? "exceeded"
          : percent >= 80
            ? "warning"
            : "ok";
    return { app: app.name, budgetUsd: app.budgetUsdMonth, spentUsd, percent, status };
  });
}

/** Learning budget overlay (learning-loop M5, spec §13 `learning_budget`):
 *  replay and eval passes settle into the same ledger as every provider
 *  turn, attributed by `experimentRef`/`candidateRef` — the overlay is a
 *  rollup over those rows, not a second ledger. */
interface LearningSpendRollup {
  /** All learning-attributed spend this month (USD). */
  monthUsd: number;
  /** Spend per experiment id, this month. */
  byExperiment: Map<string, number>;
  /** ALL-TIME spend per candidate id: the per-candidate replay cap bounds a
   *  candidate's total evaluation cost, not a monthly allowance. */
  byCandidate: Map<string, number>;
  /** Distinct experiments with settled spend this month —
   *  max_experiments_per_month reads this. */
  experimentsThisMonth: number;
  /** Settled M6 provider turns in the rolling seven-day policy window. */
  distillationsThisWeek: number;
  reviewsThisWeek: number;
}

export async function rollupLearningSpend(orgHome: string, now: Date = new Date()): Promise<LearningSpendRollup> {
  const month = now.toISOString().slice(0, 7);
  const rollup: LearningSpendRollup = {
    monthUsd: 0,
    byExperiment: new Map(),
    byCandidate: new Map(),
    experimentsThisMonth: 0,
    distillationsThisWeek: 0,
    reviewsThisWeek: 0,
  };
  const dir = join(orgHome, "telemetry");
  if (!existsSync(dir)) return rollup;
  const monthExperiments = new Set<string>();
  const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  for (const file of (await readdir(dir)).sort()) {
    if (!file.endsWith(".jsonl")) continue;
    const inMonth = file.startsWith(month);
    const text = await readFile(join(dir, file), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      // The all-time byCandidate scan reads every ledger file ever written;
      // skip the JSON.parse for lines that cannot carry learning
      // attribution — the string probe keeps old months near-free.
      if (
        !line.includes('"experimentRef"') &&
        !line.includes('"candidateRef"') &&
        !line.includes('"learningActivity"') &&
        !line.includes('"learning-replay"')
      ) {
        continue;
      }
      let record: TurnRecord;
      try {
        record = JSON.parse(line) as TurnRecord;
      } catch {
        continue;
      }
      // Current crashed replay passes recover attribution from terminal
      // provider evidence. Legacy rows may still have only the reserved app,
      // so they continue to count against the monthly cap even when the old
      // artifact cannot recover finer attribution.
      const isReplayRow =
        record.experimentRef !== undefined ||
        record.candidateRef !== undefined ||
        record.learningActivity !== undefined ||
        record.app === "learning-replay";
      if (!isReplayRow) continue;
      const at = new Date(record.at).getTime();
      if (at >= weekStart && at <= now.getTime()) {
        if (record.learningActivity === "distillation") rollup.distillationsThisWeek += 1;
        if (record.learningActivity === "review") rollup.reviewsThisWeek += 1;
      }
      if (record.candidateRef !== undefined) {
        rollup.byCandidate.set(
          record.candidateRef,
          (rollup.byCandidate.get(record.candidateRef) ?? 0) + record.costUsd,
        );
      }
      if (!inMonth) continue;
      rollup.monthUsd += record.costUsd;
      if (record.experimentRef !== undefined) {
        monthExperiments.add(record.experimentRef);
        rollup.byExperiment.set(
          record.experimentRef,
          (rollup.byExperiment.get(record.experimentRef) ?? 0) + record.costUsd,
        );
      }
    }
  }
  rollup.experimentsThisMonth = monthExperiments.size;
  return rollup;
}

export async function enforceBudgetOverlay(
  orgHome: string,
  apps: AppsFile,
  now: Date = new Date(),
  hooks: BudgetOverlayHooks = {},
): Promise<BudgetRow[]> {
  return withFileLock(
    join(orgHome, "state", "budget-overlay.lock"),
    {
      staleMs: 10 * 60_000,
      maxWaitMs: 12 * 60_000,
    },
    () => enforceBudgetOverlayLocked(orgHome, apps, now, hooks),
  );
}

/** Deterministic crash seam for the replacement validation harness. Production
 * callers omit it. It sits at the ratified F-PT-003 boundary: the pause is
 * durable, while the human-visible budget item may not exist yet. */
interface BudgetOverlayHooks {
  afterOverlayWrite?: () => Promise<void> | void;
}

async function enforceBudgetOverlayLocked(
  orgHome: string,
  apps: AppsFile,
  now: Date,
  hooks: BudgetOverlayHooks,
): Promise<BudgetRow[]> {
  const rows = await rollupBudgets(orgHome, apps, now);
  const overlay = await readOverlay(orgHome);
  const store = new ApprovalStore(orgHome);

  const knownApps = new Set(apps.apps.map((app) => app.name));
  // `unknown` (unverifiable total) blocks exactly like `exceeded`: it keeps an
  // app paused and raises the approval item. A single malformed ledger row must
  // never drop a paused app back to running (A-004) — the old `=== "exceeded"`
  // filter treated a NaN total as "ok" and actively un-paused it.
  const blocked = new Set(rows.filter((r) => isBudgetBlocking(r.status)).map((r) => r.app));
  // Recompute the paused set from the current rollup rather than only ever
  // adding to it: an app drops out of the overlay once its month-to-date spend
  // is back under 100% (e.g. after a month reset), so a single month's overage
  // no longer pauses a healthy live app forever. Entries for apps no longer in
  // apps.yaml are preserved so an unrelated overlay is never silently dropped.
  overlay.pausedApps = overlay.pausedApps.filter((app) => !knownApps.has(app) || blocked.has(app));

  const blockedRows = rows.filter((r) => isBudgetBlocking(r.status));
  for (const row of blockedRows) {
    if (!overlay.pausedApps.includes(row.app)) overlay.pausedApps.push(row.app);
  }

  // F-PT-003 (ratified 2026-07-31): pause first. If the process dies after
  // this durable write, the next admission check still refuses spend and a
  // later enforcement pass converges the missing approval item.
  overlay.pausedApps.sort();
  await writeOverlay(orgHome, overlay);
  await hooks.afterOverlayWrite?.();

  for (const row of blockedRows) {
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
  return rows;
}

export async function isOverlayPaused(orgHome: string, app: string): Promise<boolean> {
  return (await readOverlay(orgHome)).pausedApps.includes(app);
}

// --- Per-turn budget escalation (epic #236 "Budget-exhaustion suspend") ------
//
// `budget-exceeded` above is APP-MONTHLY: one item per app per month, keyed on
// the calendar month, answering "this app is over its monthly cap". A soft-ring
// turn suspension asks a different question about a different subject — "this
// ticket's next provider turn needs authorizing, and here is what resuming
// costs before any new work happens" — so it is its own rule.
//
// It is NOT a second queue. "One inbox, never two" (docs/approvals/design.md)
// stands: this is a synthetic item in the same ApprovalStore, drained by the
// same `cormidia approvals review`, decided by the same verbs.

export const TURN_BUDGET_RULE = "turn-budget-exceeded";

/** An objective grant's cumulative spend ledger reached its ceiling (#296
 * Stage 3, proposal §7): one item per grant, keyed
 * `objective-budget:<grantId>`, raised by ObjectiveGrantStore.debit. The
 * ceiling itself is raisable only by a human editing the grant — approving
 * the item records the decision; it raises nothing mechanically. */
export const OBJECTIVE_BUDGET_RULE = "objective-budget-exceeded";

/** Rules whose approval is a SPEND decision rather than authorization of a
 * critical operation. They are excluded from #244's suppression record: a turn
 * that ran out of money suppressed nothing. */
export function isBudgetEscalationRule(rule: string): boolean {
  return rule === TURN_BUDGET_RULE || rule === "budget-exceeded" || rule === OBJECTIVE_BUDGET_RULE;
}

/** What resuming a suspended turn costs BEFORE it does any new work.
 *
 * All three adapter profiles declare `cache.observable: true`, so the parked
 * turn's cache-read and cache-creation token counts are real, not modelled.
 * A human approving "+$10" is entitled to know how much of it re-establishes
 * context that already existed. `usd` is null when the suspended turn reported
 * no cache split at all — an honest absence beats an invented estimate. */
export interface ResumeCostEstimate {
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Cost of the parked turn's context re-establishment, when derivable. */
  usd: number | null;
  basis: "observed_cache_tokens" | "unavailable";
}

export interface TurnBudgetEscalationInput {
  app: string;
  role: string;
  ticketRef: string;
  turnId?: string;
  episodeId: string;
  /** Run of the suspended turn — the join to its envelope and evidence. */
  runId: string;
  pipeline: string;
  pass: string;
  /** Sandbox cwd the suspended turn held, so the human sees which tree waits. */
  workdir?: string;
  stop: {
    dimension: string;
    cap: number;
    observed: number;
    costMeasurement: string;
    episodeRemaining: number | null;
  };
  spentUsd: number;
  resume: ResumeCostEstimate;
}

/** Stable identity of one suspended turn. Re-raising for the same parked turn
 * must find the existing item rather than mint a second: a crash between the
 * durable suspension and the queue write is expected, and convergence is the
 * whole point of raising after the pause is durable (the F-PT-003 ordering
 * `enforceBudgetOverlay` already uses above). */
function turnBudgetEscalationKey(input: {
  app: string;
  ticketRef: string;
  episodeId: string;
  runId: string;
  pass: string;
}): string {
  return `turn-budget:${input.app}:${input.ticketRef}:${input.episodeId}:${input.runId}:${input.pass}`;
}

/** Raise (or find) the one queue item whose decision releases this pause.
 * Returns the item either way, so the caller can bind its id to the durable
 * continuation and a replay resolves to the same decision. */
export async function raiseTurnBudgetEscalation(
  stateHome: string,
  input: TurnBudgetEscalationInput,
  now: Date = new Date(),
): Promise<ApprovalItem> {
  const store = new ApprovalStore(stateHome);
  const key = turnBudgetEscalationKey(input);
  const existing = [...(await store.listPending()), ...(await store.listDecided())].find(
    (item) => item.rule === TURN_BUDGET_RULE && item.justification === key,
  );
  if (existing !== undefined) return existing;
  return store.raise({
    app: input.app,
    role: input.role,
    rule: TURN_BUDGET_RULE,
    ticketRef: input.ticketRef,
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.workdir === undefined ? {} : { workdir: input.workdir }),
    action: {
      tool: "budget",
      description:
        `Authorize one more provider turn for ${input.ticketRef} ` +
        `(${input.pipeline}/${input.pass}); resume re-establishes context first`,
      input: {
        kind: "turn-budget-grant",
        app: input.app,
        ticketRef: input.ticketRef,
        episodeId: input.episodeId,
        runId: input.runId,
        pipeline: input.pipeline,
        pass: input.pass,
        stoppedDimension: input.stop.dimension,
        cap: input.stop.cap,
        observed: input.stop.observed,
        costMeasurement: input.stop.costMeasurement,
        episodeRemainingUsd: input.stop.episodeRemaining,
        spentUsd: input.spentUsd,
        resumeCostUsd: input.resume.usd,
        resumeCostBasis: input.resume.basis,
        resumeCacheReadTokens: input.resume.cacheReadTokens,
        resumeCacheCreationTokens: input.resume.cacheCreationTokens,
      },
    },
    justification: key,
    now,
  });
}

/** Derive the resume-cost estimate from the parked turn's own cache split and
 * the settled cost of the tokens it actually paid for. Deliberately arithmetic
 * over OBSERVED numbers, never a price table: an estimate the human cannot
 * check is worse than an honest `unavailable`. */
export function resumeCostEstimate(usage: {
  tokensIn: number;
  costUsd: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}): ResumeCostEstimate {
  const cacheCreationTokens = usage.cacheCreationTokens ?? 0;
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const contextTokens = cacheCreationTokens + cacheReadTokens;
  if (
    (usage.cacheCreationTokens === undefined && usage.cacheReadTokens === undefined) ||
    contextTokens === 0 ||
    !Number.isFinite(usage.costUsd) ||
    !Number.isFinite(usage.tokensIn) ||
    usage.tokensIn <= 0
  ) {
    return { cacheCreationTokens, cacheReadTokens, usd: null, basis: "unavailable" };
  }
  // Share of the parked turn's settled cost attributable to the context it had
  // to hold. Resuming re-establishes at most that much before new work starts.
  const share = Math.min(1, contextTokens / usage.tokensIn);
  return {
    cacheCreationTokens,
    cacheReadTokens,
    usd: Math.round(usage.costUsd * share * 10_000) / 10_000,
    basis: "observed_cache_tokens",
  };
}

interface ReconcileResult {
  /** Envelopes inspected across runs/<app>/<runId>/. */
  scanned: number;
  /** Rows appended to the ledger (envelopes the ledger had never seen). */
  settled: number;
  /** Envelopes skipped: already settled, no usage recorded, in flight, or
   *  unreadable. Every scanned envelope lands in exactly one bucket. */
  alreadySettled: number;
  noUsage: number;
  inFlight: number;
  corrupt: number;
  /** Total equivalent-cost recovered into the ledger by this run. */
  recoveredUsd: number;
}

/** An envelope still `running` younger than this is treated as in flight and
 *  left alone: its pass may be between turn-return and finalize, and settling
 *  it here would race the executor's own settle. Older than this,
 *  a `running` envelope is provably dead (no pass runs for a day) and its
 *  spend is recovered as failed. */
const IN_FLIGHT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Repair stale execution receipts, settle terminal provider steps, then
 *  back-fill legacy `runs/<app>/<run>/envelope.json` evidence. Current rows
 *  are idempotent by (app, providerTurnId); legacy rows fall back to
 *  (app, runId). `runtimeByRole` maps role name to runtime kind for legacy
 *  records; unknown roles record "unknown". */
export async function reconcileLedger(
  stateHome: string,
  runtimeByRole: Record<string, string> = {},
  now: Date = new Date(),
): Promise<ReconcileResult> {
  const runsDir = join(stateHome, "runs");
  const result: ReconcileResult = {
    scanned: 0,
    settled: 0,
    alreadySettled: 0,
    noUsage: 0,
    inFlight: 0,
    corrupt: 0,
    recoveredUsd: 0,
  };
  const settledKeys = await readSettledKeys(stateHome);

  // New-schema execution receipts are authoritative at provider-turn
  // granularity. Repair stale started receipts first, then settle every
  // terminal provider step. Legacy envelopes are handled below.
  const stale = await reconcileStaleProviderSteps(stateHome, now, IN_FLIGHT_WINDOW_MS, async (receipt) => {
    try {
      const envelope = await readEnvelope(stateHome, receipt.app, receipt.run_id);
      if (!envelope.provider_turn_ids?.includes(receipt.provider_turn_id) || envelope.usage === undefined)
        return undefined;
      const observedAt = envelope.last_seen_at ?? envelope.finished_at ?? now.toISOString();
      return {
        tokensIn: envelope.usage.tokens_in,
        tokensOut: envelope.usage.tokens_out,
        costUsd: envelope.usage.cost_usd,
        subagentTurns: envelope.usage.subagent_turns ?? 0,
        wallClockMs: Math.max(0, new Date(observedAt).getTime() - new Date(receipt.started_at).getTime()),
        quality: envelope.usage.quality ?? (envelope.usage.cost_estimated ? "estimated" : "partial"),
        ...(envelope.usage.cost_estimated === true ? { costEstimated: true } : {}),
        ...(envelope.usage.cache_read_tokens !== undefined
          ? { cacheReadTokens: envelope.usage.cache_read_tokens }
          : {}),
        ...(envelope.usage.cache_write_tokens !== undefined
          ? { cacheCreationTokens: envelope.usage.cache_write_tokens }
          : {}),
      };
    } catch {
      return undefined;
    }
  });
  result.inFlight += stale.inFlight.length;
  result.corrupt += stale.corrupt.length;
  for (const step of stale.finalized) {
    await terminalizeStaleRun(stateHome, step, now);
    await terminalizeEpisodeIfOpen(
      stateHome,
      step.episode_id,
      step.reason,
      step.next_step ?? "resume from the last valid artifact boundary",
      now,
    );
  }
  for (const episode of await readEfficiencyEvidence(stateHome)) {
    for (const step of episode.steps.filter((candidate) => candidate.kind === "provider")) {
      const providerTurnId = step.provider_turn_id;
      if (providerTurnId === null) {
        result.corrupt += 1;
        continue;
      }
      const key = settlementKey(step.app, providerTurnId);
      if (settledKeys.has(key)) continue;
      const record = turnRecordFromExecutionStep(step);
      if (await recordTurnOnce(stateHome, record)) {
        settledKeys.add(key);
        result.settled += 1;
        result.recoveredUsd += record.costUsd;
      }
    }
  }

  if (!existsSync(runsDir)) return result;

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
        result.corrupt += 1; // Unreadable spend cannot be reconciled — but count it.
        continue;
      }
      if (envelope.status === "running" && !Array.isArray(envelope.provider_turn_ids) && envelope.usage === undefined) {
        // Legacy pre-turn work has no provider identity or measurable spend.
        // Preserve the historical no-usage population rather than guessing
        // that it is an in-flight provider invocation.
        result.noUsage += 1;
        continue;
      }
      if (envelope.status === "running") {
        const ageMs = now.getTime() - new Date(envelope.started_at).getTime();
        if (ageMs < IN_FLIGHT_WINDOW_MS) {
          result.inFlight += 1;
          continue;
        }
        await finalizeRun(
          stateHome,
          envelope.app,
          envelope.run_id,
          {
            status: "failed",
            errorCode: "error_stale_missing_finalization",
            reason: "pass lost its owner heartbeat before parent finalization",
          },
          now,
        );
        if (envelope.episode_id !== undefined) {
          await terminalizeEpisodeIfOpen(
            stateHome,
            envelope.episode_id,
            "pass lost its owner heartbeat before parent finalization",
            "resume from the last valid artifact boundary",
            now,
          );
        }
        envelope = await readEnvelope(stateHome, envelope.app, envelope.run_id);
      }
      // New envelopes expose the exact provider-turn identities. Their steps
      // above own reconciliation; never synthesize a second pass-aggregate
      // settlement, including the empty array of a pre-turn budget refusal.
      if (Array.isArray(envelope.provider_turn_ids)) {
        const allSettled = envelope.provider_turn_ids.every((providerTurnId) =>
          settledKeys.has(settlementKey(envelope.app, providerTurnId)),
        );
        if (allSettled) result.alreadySettled += 1;
        else result.corrupt += 1;
        continue;
      }
      if (envelope.usage === undefined) {
        // No usage ever landed (hung before the turn returned, or crashed
        // pre-turn) — there is no measured spend to settle.
        result.noUsage += 1;
        continue;
      }
      if (settledKeys.has(settlementKey(envelope.app, envelope.run_id))) {
        result.alreadySettled += 1;
        continue;
      }
      const record = recordFromEnvelope(envelope, runtimeByRole);
      record.escalations = await countEscalations(join(appDir, runId, "events.jsonl"));
      if (await recordTurnOnce(stateHome, record)) {
        settledKeys.add(settlementKey(envelope.app, envelope.run_id));
        result.settled += 1;
        result.recoveredUsd += record.costUsd;
      } else {
        result.alreadySettled += 1;
      }
    }
  }
  return result;
}

async function terminalizeStaleRun(stateHome: string, step: ExecutionStepRecord, now: Date): Promise<void> {
  try {
    const envelope = await readEnvelope(stateHome, step.app, step.run_id);
    if (envelope.status !== "running") return;
    await finalizeRun(
      stateHome,
      step.app,
      step.run_id,
      {
        status: "failed",
        errorCode: "error_stale_missing_finalization",
        reason: step.reason,
      },
      now,
    );
  } catch {
    // The execution step remains the truthful terminal source even if its
    // legacy parent envelope was pruned or corrupt; reports name that join.
  }
}

async function terminalizeEpisodeIfOpen(
  stateHome: string,
  episodeId: string,
  reason: string,
  nextStep: string,
  now: Date,
): Promise<void> {
  if (!existsSync(routeRecordPath(stateHome, episodeId))) return;
  const route = await readRouteRecord(stateHome, episodeId);
  if (route.terminal !== null) return;
  await finalizeEpisode({
    root: stateHome,
    episodeId,
    status: "interrupted",
    reason,
    nextStep,
    now,
  });
}

/** Reconstruct the exactly-once ledger row owned by a terminal provider
 * execution record. This is shared by the ledger sweep and immediate
 * EpisodePlan resume repair, so both preserve the same assignment/plan audit
 * identity instead of producing a lower-fidelity recovery row. */
export function turnRecordFromExecutionStep(step: ExecutionStepRecord): TurnRecord {
  const usage = step.usage ?? {
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    subagentTurns: 0,
    wallClockMs: Math.max(0, new Date(step.finished_at).getTime() - new Date(step.started_at).getTime()),
    quality: "unavailable" as const,
  };
  const record: TurnRecord = {
    at: step.finished_at,
    role: step.role ?? "unknown",
    runtime: step.runtime ?? "unknown",
    model: step.model ?? "unknown",
    ...(step.effort === null ? {} : { effort: step.effort }),
    status:
      step.status === "completed"
        ? "completed"
        : step.status === "blocked"
          ? "blocked_on_gate"
          : step.status === "cancelled"
            ? "cancelled"
            : step.status === "timed_out"
              ? "timed_out"
              : "failed",
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    costUsd: usage.costUsd,
    usageQuality: usage.quality ?? (usage.costEstimated ? "estimated" : "complete"),
    subagentTurns: usage.subagentTurns,
    wallClockMs: usage.wallClockMs,
    escalations: 0,
    app: step.app,
    runId: step.run_id,
    ...(step.provider_turn_id !== null ? { providerTurnId: step.provider_turn_id } : {}),
    executionStepId: step.execution_step_id,
    episodeId: step.episode_id,
    ...(step.plan_version === undefined ? {} : { planVersion: step.plan_version }),
    ...(step.plan_step_id === undefined ? {} : { planStepId: step.plan_step_id }),
    ...(step.assignment_source === undefined ? {} : { assignmentSource: step.assignment_source }),
    ...(step.assignment_candidate_id === undefined ? {} : { assignmentCandidateId: step.assignment_candidate_id }),
    ...(step.selection_reason === undefined ? {} : { selectionReason: scrubSecrets(step.selection_reason) }),
    ...(step.resolved_capabilities === undefined ? {} : { resolvedCapabilities: [...step.resolved_capabilities] }),
    ...(step.experiment_ref === undefined ? {} : { experimentRef: step.experiment_ref }),
    ...(step.candidate_ref === undefined ? {} : { candidateRef: step.candidate_ref }),
    ...(step.learning_activity === undefined ? {} : { learningActivity: step.learning_activity }),
    pipeline: step.operation.split("/", 1)[0] ?? "unknown",
    pass: step.operation.includes("/") ? step.operation.slice(step.operation.indexOf("/") + 1) : step.operation,
  };
  if (usage.quality === "unavailable") record.unmeasured = true;
  if (usage.costEstimated === true) record.costEstimated = true;
  if (usage.tokensInUncached !== undefined) record.tokensInUncached = usage.tokensInUncached;
  if (usage.cacheCreationTokens !== undefined) record.cacheCreationTokens = usage.cacheCreationTokens;
  if (usage.cacheReadTokens !== undefined) record.cacheReadTokens = usage.cacheReadTokens;
  return record;
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
    if (line.trim().length === 0) continue;
    try {
      // Parse rather than substring-match: a free-text detail value that
      // happens to contain the literal must not inflate the count.
      const event = JSON.parse(line) as { type?: unknown };
      if (event.type === "escalation.raised") count += 1;
    } catch {
      // Torn trailing line — same tolerance as every other L2 reader.
    }
  }
  return count;
}

function recordFromEnvelope(envelope: RunEnvelope, runtimeByRole: Record<string, string>): TurnRecord {
  const usage = envelope.usage!;
  const status: TurnResult["status"] =
    envelope.status === "completed"
      ? "completed"
      : envelope.status === "blocked"
        ? "blocked_on_gate"
        : envelope.status === "cancelled"
          ? "cancelled"
          : envelope.status === "timed_out"
            ? "timed_out"
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
    usageQuality:
      usage.quality ??
      (envelope.status === "running" ? "partial" : usage.cost_estimated === true ? "estimated" : "complete"),
    subagentTurns: usage.subagent_turns ?? 0,
    wallClockMs: envelope.wall_clock_ms ?? 0,
    escalations: 0,
    app: envelope.app,
    runId: envelope.run_id,
    traceId: envelope.trace_id,
    ...(envelope.parent_task_id !== undefined ? { parentTaskId: envelope.parent_task_id } : {}),
    pipeline: envelope.pipeline,
    pass: envelope.pass,
  };
  if (usage.cost_estimated === true) record.costEstimated = true;
  if (usage.cache_read_tokens !== undefined) record.cacheReadTokens = usage.cache_read_tokens;
  if (usage.cache_write_tokens !== undefined) record.cacheCreationTokens = usage.cache_write_tokens;
  return record;
}

/** Sum this month's ledger spend per app. Rows whose `costUsd` is not a finite
 *  number (absent, a string, NaN) are NOT summed — they mark the app's total as
 *  `unresolved`, so the caller fails closed instead of letting `+ undefined`
 *  poison the sum into NaN and read as `ok` (A-004). A torn line that fails
 *  JSON.parse is still skipped (one bad append must not wedge enforcement),
 *  but a parseable-yet-malformed row can no longer silently disable the cap. */
async function readMonthSpend(
  orgHome: string,
  month: string,
): Promise<{ spent: Map<string, number>; unresolved: Set<string> }> {
  const dir = join(orgHome, "telemetry");
  const spent = new Map<string, number>();
  const unresolved = new Set<string>();
  if (!existsSync(dir)) return { spent, unresolved };
  for (const file of await readdir(dir)) {
    if (!file.startsWith(month) || !file.endsWith(".jsonl")) continue;
    const text = await readFile(join(dir, file), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      let record: TurnRecord;
      try {
        record = JSON.parse(line) as TurnRecord;
      } catch {
        // One torn append must not wedge budget enforcement (and with it
        // every loop tick's budgetGuard) org-wide.
        continue;
      }
      if (record.app === undefined) continue;
      const cost = record.costUsd;
      if (typeof cost !== "number" || !Number.isFinite(cost)) {
        // Cannot trust this app's total for the month — fail closed.
        unresolved.add(record.app);
        continue;
      }
      spent.set(record.app, (spent.get(record.app) ?? 0) + cost);
    }
  }
  return { spent, unresolved };
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
