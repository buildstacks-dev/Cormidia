// Org-wide state-home retention (review P1-14 / F-003; docs/scheduler/design.md →
// State retention).
//
// Before this module, `runs/` was the only state subtree with retention, and
// pruning it was a manual CLI step nothing prompted — every other growth axis
// (`telemetry/`, `efficiency/episodes/`, `invocations/`, `tasks/`,
// `learning/events/`, `scheduler/evidence/`) grew forever under an autonomous
// scheduler with no operator in the loop. This module gives each subtree a
// documented retention window and one `sweepStateRetention` owner, run at
// most once per UTC day from the ordinary dispatch tick (the scheduler's
// boundary) via `runScheduledRetentionSweep`.
//
// Fail-safe rules, in the spirit of pruneRuns (never delete what cannot be
// proven terminal):
// - The ledger (`telemetry/`) respects the reconciliation window twice over:
//   day-files must be older than every evidence window `cormidia budget
//   --reconcile` can back-fill from (runs/ envelopes and efficiency provider
//   steps, clamped with a margin), AND no row in the file may still be
//   re-settleable from surviving evidence on disk. Files from the current UTC
//   month are never deleted (monthly budget caps read them), deletions happen
//   under the settlement lock, and a file with an unparseable line is kept.
// - `efficiency/episodes/` are deleted only when the route is proven
//   terminal, no started provider receipt is pending, nothing is corrupt, and
//   every provider step is already settled in the ledger.
// - `tasks/` records are deleted only when the task record proves a terminal
//   status and end time.
// - `planning/<app>/refused-decompositions/` ages by the record's own
//   `refused_at`, with the same identity binding as narrative/tasks. The
//   human decision it feeds (`lifecycle/apps/<app>/ticket-budget-ratifications/`)
//   is never swept and embeds the accepted plan, so nothing a human decided
//   can age out. `lifecycle/` as a whole remains outside every sweep.
// - `learning/` is NEVER swept except the date-keyed capture projection
//   `learning/events/<date>/` (whose own header anticipates retention). The
//   durable learning archives (`episodes/`, `capsules/`, `fingerprints/`,
//   `resolved/`, `canary/`, `publish-journal/`, `metrics/`) and the committed
//   org-home `learning/**` governance substrate are structurally out of
//   scope: the sweep only ever touches the named `events` child.
// - `scheduler/evidence/` is pruned without ever falsifying health
//   (docs/scheduler/design.md → Health semantics): only terminal decisions whose
//   episode is no longer referenced by any surviving lock, turn journal, run
//   envelope, or ledger row (the exact sources of the orphan cross-check) and
//   whose provider turn/settlement counts agree; only terminal invocations
//   whose decisions are all gone, always keeping the newest invocation and
//   the newest completed one so an idle org keeps its tick evidence; alerts
//   by age.
// Anything ambiguous is kept and retried on a later sweep.

import { existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { readEfficiencyEvidence } from "../loop/efficiency.js";
import { hashedFileStem } from "../runtime/runlog/paths.js";
import { pruneRuns } from "../runtime/runlog/retention.js";
import { acquireSettlementLock, readSettledKeys, settlementKey } from "../runtime/telemetry.js";
import { writeFileAtomic } from "./atomic.js";

const DAY_MS = 86_400_000;

/** Reconciliation margin: how many extra days a ledger day-file (and every
 *  projection of evidence) must outlive the evidence that can regenerate it,
 *  covering reconcile's own 24h in-flight window plus clock skew. */
const RECONCILE_MARGIN_DAYS = 2;

/** Per-subtree retention windows, in days. All windows are minimums — the
 *  clamps in `effectiveRetentionWindows` can only lengthen them. */
export interface StateRetentionPolicy {
  /** `runs/<app>/<runId>/` via the existing fail-safe pruneRuns. */
  runsDays: number;
  /** `telemetry/<date>.jsonl` — the org ledger. */
  telemetryDays: number;
  /** `efficiency/episodes/<hash>/`. */
  efficiencyEpisodeDays: number;
  /** `invocations/<date>.jsonl` — orchestrator invocation log. */
  invocationsDays: number;
  /** `tasks/<taskId>/` — delegated parent-task records. */
  tasksDays: number;
  /** `learning/events/<date>/` — the capture projection (only). */
  learningEventsDays: number;
  /** `scheduler/evidence/{invocations,decisions,alerts}/`. */
  schedulerEvidenceDays: number;
  /** `state/retention/sweeps/<date>.json` — the sweep's own records. */
  sweepRecordDays: number;
  /** `narrative/<app>/` — captured stories + rendered markdown (#129). The
   *  longest window in the table: narrative is the institutional record the
   *  other subtrees feed, and its captures preserve quotes whose sources
   *  are swept in 30 days. */
  narrativeDays: number;
  /** `planning/<app>/refused-decompositions/` — decompositions preserved for
   *  a possible human ticket-budget ratification (ENH-011). Provider-derived
   *  evidence awaiting a decision, not the decision itself: the ratification
   *  record it feeds lives under `lifecycle/` and is never swept, and it
   *  embeds the accepted plan, so ageing a stale refusal loses nothing a
   *  human decided. */
  refusedDecompositionDays: number;
}

export const DEFAULT_STATE_RETENTION: StateRetentionPolicy = {
  runsDays: 30,
  telemetryDays: 365,
  efficiencyEpisodeDays: 180,
  invocationsDays: 90,
  tasksDays: 180,
  learningEventsDays: 180,
  schedulerEvidenceDays: 365,
  sweepRecordDays: 90,
  narrativeDays: 1825,
  refusedDecompositionDays: 90,
};

/** Resolve the windows actually applied: the ledger and every projection must
 *  outlive the evidence that can regenerate rows into them, and scheduler
 *  evidence must outlive every artifact that references its episodes, so the
 *  orphan cross-check in scheduler health stays truthful. */
export function effectiveRetentionWindows(policy: StateRetentionPolicy): StateRetentionPolicy {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`retention: ${name} must be a positive integer of days, got ${value}`);
    }
  }
  const evidenceFloor = Math.max(policy.runsDays, policy.efficiencyEpisodeDays) + RECONCILE_MARGIN_DAYS;
  const telemetryDays = Math.max(policy.telemetryDays, evidenceFloor);
  return {
    ...policy,
    telemetryDays,
    learningEventsDays: Math.max(policy.learningEventsDays, evidenceFloor),
    schedulerEvidenceDays: Math.max(policy.schedulerEvidenceDays, telemetryDays + RECONCILE_MARGIN_DAYS),
  };
}

interface SubtreeSweep {
  pruned: number;
  kept: number;
}

export interface StateSweepResult {
  swept_at: string;
  /** The post-clamp windows this sweep applied. */
  windows: StateRetentionPolicy;
  runs: SubtreeSweep;
  telemetry: SubtreeSweep;
  efficiency_episodes: SubtreeSweep;
  invocations: SubtreeSweep;
  tasks: SubtreeSweep;
  learning_events: SubtreeSweep;
  scheduler_evidence: SubtreeSweep;
  sweep_records: SubtreeSweep;
  narrative: SubtreeSweep;
  refused_decompositions: SubtreeSweep;
  /** Per-subtree failures. A failed subtree keeps its files and is retried by
   *  a later sweep; it never aborts the others. */
  errors: string[];
}

/** Sweep every state subtree once, immediately, with no daily claim. The
 *  scheduler path goes through `runScheduledRetentionSweep`; this is the
 *  manual surface (`cormidia prune-runs --sweep`) and the test seam. */
export async function sweepStateRetention(
  stateHome: string,
  now: Date,
  policy: StateRetentionPolicy = DEFAULT_STATE_RETENTION,
): Promise<StateSweepResult> {
  const root = resolve(stateHome);
  const windows = effectiveRetentionWindows(policy);
  const cutoff = (days: number): number => now.getTime() - days * DAY_MS;
  const result: StateSweepResult = {
    swept_at: now.toISOString(),
    windows,
    runs: { pruned: 0, kept: 0 },
    telemetry: { pruned: 0, kept: 0 },
    efficiency_episodes: { pruned: 0, kept: 0 },
    invocations: { pruned: 0, kept: 0 },
    tasks: { pruned: 0, kept: 0 },
    learning_events: { pruned: 0, kept: 0 },
    scheduler_evidence: { pruned: 0, kept: 0 },
    sweep_records: { pruned: 0, kept: 0 },
    narrative: { pruned: 0, kept: 0 },
    refused_decompositions: { pruned: 0, kept: 0 },
    errors: [],
  };
  const subtree = async (name: keyof StateSweepResult & string, run: () => Promise<SubtreeSweep>): Promise<void> => {
    try {
      (result as unknown as Record<string, SubtreeSweep>)[name] = await run();
    } catch (error) {
      result.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Evidence subtrees first, ledger last: a ledger day-file is only deletable
  // once the evidence that could re-settle its rows is gone, so pruning the
  // evidence in the same sweep lets the ledger converge one sweep later.
  await subtree("runs", async () => {
    const pruned = await pruneRuns(root, windows.runsDays, now);
    return { pruned: pruned.deleted.length, kept: pruned.kept };
  });
  await subtree("efficiency_episodes", () => sweepEfficiencyEpisodes(root, cutoff(windows.efficiencyEpisodeDays)));
  await subtree("invocations", () => sweepDateFiles(join(root, "invocations"), cutoff(windows.invocationsDays)));
  await subtree("tasks", () => sweepTasks(root, cutoff(windows.tasksDays)));
  await subtree("learning_events", () => sweepLearningEvents(root, cutoff(windows.learningEventsDays)));
  await subtree("scheduler_evidence", () => sweepSchedulerEvidence(root, cutoff(windows.schedulerEvidenceDays)));
  await subtree("telemetry", () => sweepTelemetry(root, cutoff(windows.telemetryDays), now));
  await subtree("sweep_records", () => sweepDateFiles(sweepRecordDir(root), cutoff(windows.sweepRecordDays), ".json"));
  await subtree("narrative", () => sweepNarrative(root, cutoff(windows.narrativeDays)));
  await subtree("refused_decompositions", () =>
    sweepRefusedDecompositions(root, cutoff(windows.refusedDecompositionDays)),
  );
  return result;
}

/** `planning/<app>/refused-decompositions/<id>.json` ages by the record's own
 *  `refused_at`, with the same identity binding sweepNarrative and sweepTasks
 *  use: only a v1 record whose app and decomposition id actually map to the
 *  file it sits in is deletable. A torn or foreign file is kept, fail safe.
 *  A refusal that a human has already ratified is deletable on the same
 *  window: the ratification record under `lifecycle/` (never swept) embeds
 *  the accepted plan verbatim, so no decided evidence is lost. */
async function sweepRefusedDecompositions(stateHome: string, cutoffMs: number): Promise<SubtreeSweep> {
  const out: SubtreeSweep = { pruned: 0, kept: 0 };
  const root = join(stateHome, "planning");
  for (const app of await listDirNames(root)) {
    const dir = join(root, app, "refused-decompositions");
    if (!existsSync(dir)) continue;
    for (const name of (await readdir(dir)).filter((file) => file.endsWith(".json")).sort()) {
      let record: {
        schema_version?: unknown;
        kind?: unknown;
        app?: unknown;
        decomposition_id?: unknown;
        refused_at?: unknown;
      };
      try {
        record = JSON.parse(await readFile(join(dir, name), "utf8")) as typeof record;
      } catch {
        out.kept += 1;
        continue;
      }
      const aged =
        record.schema_version === 1 &&
        record.kind === "refused-ticket-decomposition" &&
        record.app === app &&
        typeof record.decomposition_id === "string" &&
        `${record.decomposition_id}.json` === name &&
        typeof record.refused_at === "string" &&
        !Number.isNaN(Date.parse(record.refused_at)) &&
        Date.parse(record.refused_at) < cutoffMs;
      if (aged) {
        await rm(join(dir, name), { force: true });
        out.pruned += 1;
      } else {
        out.kept += 1;
      }
    }
  }
  return out;
}

/** `narrative/<app>/<slug>.{json,md}` story pairs age by the capture's OWN
 *  `captured_at` (the newest source timestamp folded in), read like
 *  sweepTasks reads task.json with the same identity binding: only a record
 *  whose story_id/app actually map to the file it sits in is deletable — a
 *  torn or foreign .json is kept, fail safe. Deletion is .md FIRST so a
 *  crash between the two rm's leaves the .json, which the next sweep
 *  re-ages (the reverse order would orphan an unageable .md forever).
 *  Orphaned .md files (capture gone) and quarantined `.json.corrupt` files
 *  age by fs mtime — no readable captured_at exists for either. INDEX.md is
 *  regenerated on the next render and never swept here. */
async function sweepNarrative(stateHome: string, cutoffMs: number): Promise<SubtreeSweep> {
  const out: SubtreeSweep = { pruned: 0, kept: 0 };
  const root = join(stateHome, "narrative");
  for (const app of await listDirNames(root)) {
    const dir = join(root, app);
    const names = await readdir(dir);
    const jsonNames = new Set(names.filter((f) => f.endsWith(".json")));
    for (const name of jsonNames) {
      let record: { schema_version?: unknown; captured_at?: unknown; story_id?: unknown; app?: unknown };
      try {
        record = JSON.parse(await readFile(join(dir, name), "utf8")) as typeof record;
      } catch {
        out.kept += 1;
        continue;
      }
      const aged =
        record.schema_version === 1 &&
        record.app === app &&
        typeof record.story_id === "string" &&
        `${hashedFileStem(record.story_id)}.json` === name &&
        typeof record.captured_at === "string" &&
        !Number.isNaN(Date.parse(record.captured_at)) &&
        Date.parse(record.captured_at) < cutoffMs;
      if (aged) {
        await rm(join(dir, name.replace(/\.json$/, ".md")), { force: true });
        await rm(join(dir, name), { force: true });
        out.pruned += 1;
      } else {
        out.kept += 1;
      }
    }
    // Files with no readable capture to age by: orphaned .md (its .json is
    // gone) and quarantined .corrupt bytes — mtime is the only honest clock.
    for (const name of names) {
      const orphanMd = name.endsWith(".md") && name !== "INDEX.md" && !jsonNames.has(name.replace(/\.md$/, ".json"));
      const corrupt = name.endsWith(".json.corrupt");
      if (!orphanMd && !corrupt) continue;
      try {
        const info = await stat(join(dir, name));
        if (info.mtimeMs < cutoffMs) {
          await rm(join(dir, name), { force: true });
          out.pruned += 1;
        } else {
          out.kept += 1;
        }
      } catch {
        out.kept += 1;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Daily scheduled sweep — exact-once per UTC day via an O_EXCL marker claim.
// ---------------------------------------------------------------------------

function sweepRecordDir(stateHome: string): string {
  return join(resolve(stateHome), "state", "retention", "sweeps");
}

function sweepMarkerPath(stateHome: string, now: Date): string {
  return join(sweepRecordDir(stateHome), `${now.toISOString().slice(0, 10)}.json`);
}

/** Claim today's sweep. O_EXCL create is the acquisition signal: exactly one
 *  concurrent caller per (state home, UTC day) wins; everyone else sees an
 *  ordinary `false`. A crash after a claim skips that day's sweep — the next
 *  day retries. */
async function claimDailySweep(stateHome: string, now: Date): Promise<{ claimed: boolean; path: string }> {
  const path = sweepMarkerPath(stateHome, now);
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(
        `${JSON.stringify({ status: "claimed", claimed_at: now.toISOString(), pid: process.pid }, null, 2)}\n`,
        "utf8",
      );
    } finally {
      await handle.close();
    }
    return { claimed: true, path };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { claimed: false, path };
    throw error;
  }
}

/** Overwrite the day's marker with the completed sweep record. */
export async function recordSweepMarker(
  stateHome: string,
  now: Date,
  mode: "scheduled" | "manual",
  result: StateSweepResult,
): Promise<void> {
  await mkdir(sweepRecordDir(stateHome), { recursive: true });
  await writeFileAtomic(
    sweepMarkerPath(stateHome, now),
    `${JSON.stringify({ status: result.errors.length === 0 ? "completed" : "completed_with_errors", mode, ...result }, null, 2)}\n`,
  );
}

/** The dispatch-tick entry point: run the retention sweep at most once per
 *  UTC day. Returns undefined when today's sweep is already claimed (by this
 *  or any other process). */
export async function runScheduledRetentionSweep(
  stateHome: string,
  now: Date,
  policy: StateRetentionPolicy = DEFAULT_STATE_RETENTION,
): Promise<StateSweepResult | undefined> {
  const claim = await claimDailySweep(stateHome, now);
  if (!claim.claimed) return undefined;
  const result = await sweepStateRetention(stateHome, now, policy);
  await recordSweepMarker(stateHome, now, "scheduled", result);
  return result;
}

// ---------------------------------------------------------------------------
// telemetry/ — the org ledger.
// ---------------------------------------------------------------------------

async function sweepTelemetry(stateHome: string, cutoffMs: number, now: Date): Promise<SubtreeSweep> {
  const dir = join(stateHome, "telemetry");
  const out: SubtreeSweep = { pruned: 0, kept: 0 };
  if (!existsSync(dir)) return out;
  const currentMonth = now.toISOString().slice(0, 7);
  const dayFiles = (await readdir(dir)).filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
  const aged: string[] = [];
  for (const file of dayFiles) {
    const day = file.slice(0, 10);
    const wholeDayOutsideWindow = Date.parse(`${day}T00:00:00.000Z`) + DAY_MS <= cutoffMs;
    if (!wholeDayOutsideWindow || day.slice(0, 7) === currentMonth) {
      out.kept += 1;
      continue;
    }
    aged.push(file);
  }
  if (aged.length === 0) return out;

  // Reconciliation-window check, exact: a day-file survives while ANY of its
  // rows could still be re-settled by `budget --reconcile` from surviving
  // evidence — otherwise a later reconcile would re-append pruned spend as a
  // duplicate, re-dated row.
  const sources = await reconcilableSourceKeys(stateHome);
  const deletable: string[] = [];
  for (const file of aged) {
    let prunable = true;
    const text = await readFile(join(dir, file), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      let row: { app?: unknown; runId?: unknown; providerTurnId?: unknown };
      try {
        row = JSON.parse(line) as typeof row;
      } catch {
        prunable = false; // Unreadable spend cannot be proven safe — keep.
        break;
      }
      const app = typeof row.app === "string" ? row.app : undefined;
      for (const identity of [row.providerTurnId, row.runId]) {
        if (typeof identity === "string" && sources.has(settlementKey(app, identity))) {
          prunable = false;
          break;
        }
      }
      if (!prunable) break;
    }
    if (prunable) deletable.push(file);
    else out.kept += 1;
  }
  if (deletable.length === 0) return out;

  // Never yank files out from under another process's read+append settlement
  // transaction; the deletions themselves are fast, so holding the lock stays
  // well inside its 5s acquisition budget.
  const release = await acquireSettlementLock(stateHome);
  try {
    for (const file of deletable) {
      await rm(join(dir, file), { force: true });
      out.pruned += 1;
    }
  } finally {
    await release();
  }
  return out;
}

/** Every settlement identity that surviving on-disk evidence could still
 *  back-fill into the ledger: provider steps and pending receipts under
 *  `efficiency/episodes/`, and run envelopes (provider-turn ids plus the
 *  legacy (app, runId) fallback identity). */
async function reconcilableSourceKeys(stateHome: string): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const episode of await readEfficiencyEvidence(stateHome)) {
    for (const step of episode.steps) {
      if (step.kind !== "provider" || step.provider_turn_id === null) continue;
      keys.add(settlementKey(step.app, step.provider_turn_id));
    }
    for (const receipt of episode.pending_started) {
      keys.add(settlementKey(receipt.app, receipt.provider_turn_id));
    }
  }
  const runsDir = join(stateHome, "runs");
  for (const app of await listDirNames(runsDir)) {
    for (const runId of await listDirNames(join(runsDir, app))) {
      let envelope: { app?: unknown; run_id?: unknown; provider_turn_ids?: unknown };
      try {
        envelope = JSON.parse(await readFile(join(runsDir, app, runId, "envelope.json"), "utf8")) as typeof envelope;
      } catch {
        continue; // Reconcile cannot settle from an unreadable envelope either.
      }
      const apps = typeof envelope.app === "string" && envelope.app !== app ? [envelope.app, app] : [app];
      for (const name of apps) {
        keys.add(settlementKey(name, typeof envelope.run_id === "string" ? envelope.run_id : runId));
        keys.add(settlementKey(name, runId));
        if (Array.isArray(envelope.provider_turn_ids)) {
          for (const id of envelope.provider_turn_ids) {
            if (typeof id === "string") keys.add(settlementKey(name, id));
          }
        }
      }
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// efficiency/episodes/<hash>/
// ---------------------------------------------------------------------------

async function sweepEfficiencyEpisodes(stateHome: string, cutoffMs: number): Promise<SubtreeSweep> {
  const out: SubtreeSweep = { pruned: 0, kept: 0 };
  const episodes = await readEfficiencyEvidence(stateHome);
  if (episodes.length === 0) return out;
  const settled = await readSettledKeys(stateHome);
  for (const episode of episodes) {
    if (episodePrunable(episode, cutoffMs, settled)) {
      await rm(join(stateHome, "efficiency", "episodes", episode.directory), { recursive: true, force: true });
      out.pruned += 1;
    } else {
      out.kept += 1;
    }
  }
  return out;
}

function episodePrunable(
  episode: Awaited<ReturnType<typeof readEfficiencyEvidence>>[number],
  cutoffMs: number,
  settled: Set<string>,
): boolean {
  if (episode.corrupt_files.length > 0) return false; // unprovable — keep
  if (episode.pending_started.length > 0) return false; // provider work in flight or unreconciled
  if (episode.route === null || episode.route.terminal === null) return false; // not proven terminal
  const stamps = [
    Date.parse(episode.route.admitted_at),
    Date.parse(episode.route.terminal.at),
    ...episode.steps.flatMap((step) => [Date.parse(step.started_at), Date.parse(step.finished_at)]),
  ];
  if (stamps.some((value) => Number.isNaN(value))) return false; // can't prove age
  if (Math.max(...stamps) >= cutoffMs) return false; // still inside the window
  for (const step of episode.steps) {
    if (step.kind !== "provider") continue;
    if (step.provider_turn_id === null) return false; // unprovable identity
    if (!settled.has(settlementKey(step.app, step.provider_turn_id))) return false; // spend not in the ledger yet
  }
  return true;
}

// ---------------------------------------------------------------------------
// tasks/<taskId>/
// ---------------------------------------------------------------------------

async function sweepTasks(stateHome: string, cutoffMs: number): Promise<SubtreeSweep> {
  const out: SubtreeSweep = { pruned: 0, kept: 0 };
  const root = join(stateHome, "tasks");
  for (const taskId of await listDirNames(root)) {
    let record: { schemaVersion?: unknown; taskId?: unknown; status?: unknown; endedAt?: unknown };
    try {
      record = JSON.parse(await readFile(join(root, taskId, "task.json"), "utf8")) as typeof record;
    } catch {
      out.kept += 1; // torn/absent record — keep, fail safe
      continue;
    }
    const terminal =
      record.schemaVersion === 1 &&
      record.taskId === taskId &&
      typeof record.status === "string" &&
      record.status !== "running" &&
      typeof record.endedAt === "string" &&
      !Number.isNaN(Date.parse(record.endedAt));
    if (terminal && Date.parse(record.endedAt as string) < cutoffMs) {
      await rm(join(root, taskId), { recursive: true, force: true });
      out.pruned += 1;
    } else {
      out.kept += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// learning/events/<date>/ — the ONLY learning subtree the sweep touches.
// ---------------------------------------------------------------------------

async function sweepLearningEvents(stateHome: string, cutoffMs: number): Promise<SubtreeSweep> {
  const out: SubtreeSweep = { pruned: 0, kept: 0 };
  const root = join(stateHome, "learning", "events");
  for (const day of await listDirNames(root)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      out.kept += 1; // not a date bucket — keep, fail safe
      continue;
    }
    if (Date.parse(`${day}T00:00:00.000Z`) + DAY_MS <= cutoffMs) {
      await rm(join(root, day), { recursive: true, force: true });
      out.pruned += 1;
    } else {
      out.kept += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// scheduler/evidence/{decisions,invocations,alerts}/
// ---------------------------------------------------------------------------

async function sweepSchedulerEvidence(stateHome: string, cutoffMs: number): Promise<SubtreeSweep> {
  const out: SubtreeSweep = { pruned: 0, kept: 0 };
  const root = join(stateHome, "scheduler", "evidence");
  if (!existsSync(root)) return out;
  const referenced = await referencedTurnIds(stateHome);

  // Decisions first: an invocation only becomes prunable once every decision
  // it fathered is gone.
  const decisionsDir = join(root, "decisions");
  for (const file of await listJsonFiles(decisionsDir)) {
    const record = await readRecord(join(decisionsDir, file));
    if (record !== undefined && decisionPrunable(record, cutoffMs, referenced)) {
      await rm(join(decisionsDir, file), { force: true });
      out.pruned += 1;
    } else {
      out.kept += 1;
    }
  }
  const survivingDecisions = new Set((await listJsonFiles(decisionsDir)).map((file) => file.slice(0, -".json".length)));

  const invocationsDir = join(root, "invocations");
  const invocations: Array<{ file: string; record: Record<string, unknown> | undefined }> = [];
  for (const file of await listJsonFiles(invocationsDir)) {
    invocations.push({ file, record: await readRecord(join(invocationsDir, file)) });
  }
  // An idle org must keep proof of its last tick: the newest invocation and
  // the newest completed one survive regardless of age.
  const byWindow = invocations
    .filter((item) => item.record !== undefined)
    .sort((a, b) => String(a.record!["cadence_window"] ?? "").localeCompare(String(b.record!["cadence_window"] ?? "")));
  const protectedFiles = new Set<string>();
  const newest = byWindow.at(-1);
  if (newest !== undefined) protectedFiles.add(newest.file);
  const newestCompleted = [...byWindow].reverse().find((item) => item.record!["terminal"] === "completed");
  if (newestCompleted !== undefined) protectedFiles.add(newestCompleted.file);
  for (const { file, record } of invocations) {
    const prunable =
      record !== undefined &&
      !protectedFiles.has(file) &&
      record["terminal"] !== null &&
      record["terminal"] !== undefined &&
      typeof record["invoked_at"] === "string" &&
      !Number.isNaN(Date.parse(record["invoked_at"])) &&
      Date.parse(record["invoked_at"]) < cutoffMs &&
      Array.isArray(record["decision_ids"]) &&
      record["decision_ids"].every((id) => typeof id === "string" && !survivingDecisions.has(id));
    if (prunable) {
      await rm(join(invocationsDir, file), { force: true });
      out.pruned += 1;
    } else {
      out.kept += 1;
    }
  }

  const alertsDir = join(root, "alerts");
  for (const file of await listJsonFiles(alertsDir)) {
    const record = await readRecord(join(alertsDir, file));
    const prunable =
      record !== undefined &&
      typeof record["occurred_at"] === "string" &&
      !Number.isNaN(Date.parse(record["occurred_at"])) &&
      Date.parse(record["occurred_at"]) < cutoffMs;
    if (prunable) {
      await rm(join(alertsDir, file), { force: true });
      out.pruned += 1;
    } else {
      out.kept += 1;
    }
  }
  return out;
}

function decisionPrunable(record: Record<string, unknown>, cutoffMs: number, referenced: Set<string>): boolean {
  if (record["stage"] !== "terminal") return false;
  const terminalAt = record["terminal_at"];
  if (typeof terminalAt !== "string" || Number.isNaN(Date.parse(terminalAt))) return false;
  if (Date.parse(terminalAt) >= cutoffMs) return false;
  const episodeId = record["episode_id"];
  // Health's orphan cross-check counts surviving locks/journals/runs/ledger
  // rows whose scheduled episode has no decision — a decision must outlive
  // every such reference.
  if (typeof episodeId === "string" && referenced.has(episodeId)) return false;
  const turns = record["provider_turns"];
  const settlements = record["provider_settlements"];
  // An executed decision with missing denominators, or any turn/settlement
  // disagreement, is a health signal — never delete the evidence of it.
  if (record["outcome"] === "executed" && (typeof turns !== "number" || typeof settlements !== "number")) return false;
  if ((turns ?? null) !== (settlements ?? null)) return false;
  return true;
}

/** Turn/trace ids still present in the artifacts scheduler health cross-checks
 *  decisions against: lock files, turn journals, run envelopes, ledger rows. */
async function referencedTurnIds(stateHome: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const lockDir = join(stateHome, "locks");
  if (existsSync(lockDir)) {
    for (const file of (await readdir(lockDir)).filter((name) => name.endsWith(".lock"))) {
      try {
        const value = JSON.parse(await readFile(join(lockDir, file), "utf8")) as { turnId?: unknown };
        if (typeof value.turnId === "string") ids.add(value.turnId);
      } catch {
        /* corrupt lock carries no reclaimable id */
      }
    }
  }
  const journalDir = join(stateHome, "state", "turns");
  if (existsSync(journalDir)) {
    for (const file of (await readdir(journalDir)).filter((name) => name.endsWith(".json"))) {
      ids.add(file.slice(0, -".json".length));
    }
  }
  const runsDir = join(stateHome, "runs");
  for (const app of await listDirNames(runsDir)) {
    for (const runId of await listDirNames(join(runsDir, app))) {
      try {
        const envelope = JSON.parse(await readFile(join(runsDir, app, runId, "envelope.json"), "utf8")) as {
          trace_id?: unknown;
        };
        if (typeof envelope.trace_id === "string") ids.add(envelope.trace_id);
      } catch {
        /* unreadable envelope carries no reclaimable id */
      }
    }
  }
  const telemetryDir = join(stateHome, "telemetry");
  if (existsSync(telemetryDir)) {
    for (const file of (await readdir(telemetryDir)).filter((name) => name.endsWith(".jsonl"))) {
      for (const line of (await readFile(join(telemetryDir, file), "utf8")).split("\n")) {
        if (line.trim().length === 0) continue;
        try {
          const row = JSON.parse(line) as { traceId?: unknown };
          if (typeof row.traceId === "string") ids.add(row.traceId);
        } catch {
          /* torn append — no id to protect */
        }
      }
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

/** Delete `<date>.jsonl` (or `<date><ext>`) files whose whole UTC day is
 *  outside the window. Non-date names are kept untouched. */
async function sweepDateFiles(dir: string, cutoffMs: number, ext = ".jsonl"): Promise<SubtreeSweep> {
  const out: SubtreeSweep = { pruned: 0, kept: 0 };
  if (!existsSync(dir)) return out;
  const pattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}${ext.replace(".", "\\.")}$`);
  for (const file of (await readdir(dir)).sort()) {
    if (!pattern.test(file)) continue;
    if (Date.parse(`${file.slice(0, 10)}T00:00:00.000Z`) + DAY_MS <= cutoffMs) {
      await rm(join(dir, file), { force: true });
      out.pruned += 1;
    } else {
      out.kept += 1;
    }
  }
  return out;
}

async function listDirNames(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function listJsonFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
}

async function readRecord(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined; // corrupt evidence stays visible to health — keep
  }
}
