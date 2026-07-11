// EpisodeRecord projection (docs/learning-loop/learning-loop-design.md §8;
// spec §5, §16 EpisodeProjector).
//
// The episode is the unit of treatment assignment and outcome measurement.
// This module PROJECTS episode records from sources that already own their
// state — run records (`runs/<app>/<runId>/`), the telemetry ledger, the
// approvals store, the loop's ticket claim state, and captured learning
// events — and never becomes a second writable store (design §8.3): while
// the sources survive, deleting `learning/episodes/` and re-projecting
// rebuilds byte-identical records. Once `operon prune-runs` retires a closed
// episode's run dirs, the projection stops re-folding it: the existing
// closed record is preserved as the durable archive (only its append-only
// fields keep refreshing) instead of being silently degraded to whatever
// runs survive. The one append-only exception is late-maturing outcomes:
// recordLateOutcome emits a durable `late_outcome` learning event (the same
// append-only store M1 capture writes), and projection folds those events
// back in — so late outcomes survive a projection-state wipe like
// everything else.
//
// Determinism rules:
//   - No wall-clock stamp ever lands in a record; every timestamp comes from
//     a source anchor (envelope times, ledger rows, event ts).
//   - The clock exists ONLY to classify a `running` envelope as live vs
//     stalled (heartbeat `last_seen_at`, preflight #28). Reconcile recovers a
//     stalled run's spend into the ledger but leaves its envelope `running`
//     forever, so liveness must be read from the heartbeat, not the status.
//   - project() is a full re-fold over the sources each call. Grouping runs
//     into episodes is inherently cross-run, so a per-run receipt cursor
//     (capture's shape) cannot finalize an episode; at current volumes the
//     re-fold costs milliseconds and buys zero drift. The expensive exactly-
//     once part — lifecycle event emission — reuses the deterministic-id
//     dedup-on-append layer every projector shares.
//
// Closure semantics (documented decision, PR #44):
//   - build_ticket with a numeric ref: closed only on durable merge
//     evidence — the claim outcome `ended merged (PR #n)` in the loop's
//     ticket claim state, the only local record of ticket end
//     (advanceShipping opens no phase run). Parked/returned tickets stay
//     open: a human can re-arm them.
//   - every other kind (and build tickets with non-numeric refs, which have
//     no claim state to consult): closed when the episode has runs, none is
//     live, and the last activity is older than the stall window — the
//     quiescence guard keeps a projection that lands in the seconds between
//     two passes from closing a pipeline mid-flight, while a killed pass
//     whose heartbeat went stale still cannot hold its episode open.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readEnvelope, type GateResultEntry, type RunEnvelope } from "../../runtime/runlog/envelope.js";
import { readEvents, type RunlogEvent } from "../../runtime/runlog/events.js";
import { readTurnRecords, type TurnRecord } from "../../runtime/telemetry.js";
import { readTicketClaimState } from "../../loop/rehydrate.js";
import { ApprovalStore, type ApprovalItem } from "../approvals.js";
import { writeFileAtomic } from "../atomic.js";
import { deriveEpisodeAnchor, listRuns } from "./capture.js";
import { ticketNumber, type EpisodeAnchor, type EpisodeKind, type EpisodeSource } from "./episodes.js";
import { resolvedContextDir } from "./resolver.js";
import {
  appendLearningEventsDeduped,
  readLearningEvents,
  type LearningEvent,
} from "./events.js";

// ---------------------------------------------------------------------------
// record shape (spec §5; deltas noted per field)
// ---------------------------------------------------------------------------

export type EpisodeStatus = "open" | "closed";

/** Terminal envelope statuses verbatim, plus the heartbeat reading of a
 *  `running` envelope: `running` means a live heartbeat, `stalled` means the
 *  pass died without finalizing (killed, crashed) — reconcile recovers its
 *  spend but the envelope stays `running` on disk forever. */
export type EpisodeTurnStatus = "completed" | "failed" | "blocked" | "running" | "stalled";

/** One (turn, pipeline, pass) with its run ids — retries append run ids;
 *  `status` reads the latest attempt. `status` is a spec §5 delta: without
 *  it an interrupted turn is indistinguishable from a completed one. */
export interface EpisodeTurnEntry {
  turn_id: string;
  role: string;
  pipeline: string;
  pass: string;
  run_ids: string[];
  status: EpisodeTurnStatus;
}

export interface EpisodeGateEntry {
  gate: string;
  status: "pass" | "fail" | "skip";
  /** Spec §5 delta: which run produced the outcome, so a gate line is
   *  traceable back to its run record. */
  run_id: string;
  detail?: string;
}

export interface EpisodeSideEffect {
  kind: string;
  ref: string;
  reversible: boolean;
}

export interface EpisodeOutcome {
  completed: boolean;
  /** build_ticket only. */
  merged?: boolean;
  /** Capture-truthful vocabulary: `merged` when no release mechanism was
   *  declared; `deploy-pending|approved|denied` reads the production-deploy
   *  approval raised at merge (src/org/release.ts). `shipped` arrives when
   *  release execution exists (issue #18). */
  release_disposition: string | null;
  /** Distinct review-pipeline executions (trace ids) inside the episode. */
  review_cycles: number;
  gate_failures: number;
  /** Human decisions on episode-scoped approvals (approved or denied). */
  human_interventions: number;
  /** Strictly from the telemetry ledger (the settled truth), never envelope
   *  usage — done-means 1 requires the record to match the ledger. */
  cost_usd: number;
  /** True when any settled row is an equivalent-cost estimate, mirroring the
   *  `~` marker in `operon status` (spec §5 delta). */
  cost_estimated: boolean;
  /** Terminal/stalled runs with measured usage but no ledger row — the
   *  reconcile target (`operon budget --reconcile`); spec §5 delta. */
  unsettled_runs: string[];
}

export interface LateOutcome {
  kind: string;
  ref: string;
  recorded: string;
  note?: string;
}

export interface EpisodeHumanObservation {
  event_id: string;
  /** Candidate/intervention linkage lands with M6 distillation. */
  disposition_ref: string | null;
}

export interface EpisodeRecord {
  schema_version: 1;
  episode_id: string;
  kind: EpisodeKind;
  app: string;
  source: EpisodeSource;
  stage: string | null;
  /** Risk tiers are assigned by classification (M6); projection stamps null. */
  risk_tier: string | null;
  opened: string;
  closed?: string;
  status: EpisodeStatus;
  /** Content-addressed SystemFingerprint ref (spec §6) — M2b wires it. */
  fingerprint_ref: string | null;
  /** Episode-sticky lineage folded from resolved-context records (M5,
   *  design §8.4): every governed resolve in the episode must agree —
   *  `mixed` is the loud inconsistency signal, never silently collapsed.
   *  Null when no turn in the episode resolved governed context. */
  bundle_lineage: "stable" | "canary" | "mixed" | null;
  turns: EpisodeTurnEntry[];
  gates: EpisodeGateEntry[];
  approvals: string[];
  artifacts: string[];
  side_effects: EpisodeSideEffect[];
  /** Present only once the episode is closed (outcome capture on close). */
  outcome?: EpisodeOutcome;
  late_outcomes: LateOutcome[];
  human_observations: EpisodeHumanObservation[];
}

// ---------------------------------------------------------------------------
// projector
// ---------------------------------------------------------------------------

/** A `running` envelope whose heartbeat (`last_seen_at`, stamped every ~30s
 *  by the pass executor) is older than this is read as stalled, not live.
 *  Deliberately far above the heartbeat period (20 missed beats) and far
 *  below reconcile's 24h spend-recovery window — misreading liveness here
 *  affects episode open/closed, not settlement. */
export const EPISODE_STALL_MS = 10 * 60 * 1000;

export interface LateOutcomeInput {
  kind: string;
  ref: string;
  note?: string;
}

export interface EpisodeProjector {
  /** Re-fold every episode from its sources; write records under
   *  `learning/episodes/`; emit `episode_opened`/`episode_closed` learning
   *  events exactly once. Returns the records sorted by episode id. */
  project(): Promise<EpisodeRecord[]>;
  get(episodeId: string): Promise<EpisodeRecord>;
  /** The one append-only write (design §8.3): emits a durable `late_outcome`
   *  learning event; the next project() folds it into the record. Idempotent
   *  per (episode, kind, ref). */
  recordLateOutcome(episodeId: string, outcome: LateOutcomeInput): Promise<LearningEvent>;
}

export interface EpisodeProjectorOptions {
  stateHome: string;
  /** App → lifecycle stage (apps.yaml `status`), stamped on records when known. */
  appStages?: Record<string, string>;
  /** Used ONLY for live-vs-stalled classification; never lands in a record. */
  clock?: () => Date;
}

export function episodesDir(stateHome: string): string {
  return join(stateHome, "learning", "episodes");
}

export function episodePath(stateHome: string, episodeId: string): string {
  return join(episodesDir(stateHome), `${episodeId}.json`);
}

export function createEpisodeProjector(options: EpisodeProjectorOptions): EpisodeProjector {
  const { stateHome } = options;
  const clock = options.clock ?? ((): Date => new Date());

  return {
    async project(): Promise<EpisodeRecord[]> {
      const learningEvents = await readLearningEvents(stateHome);
      const folded = await foldEpisodes(stateHome, options.appStages, clock(), learningEvents);
      const records: EpisodeRecord[] = [];
      const foldedIds = new Set<string>();
      for (const record of folded) {
        foldedIds.add(record.episode_id);
        records.push(await preserveOrWrite(stateHome, record, learningEvents));
      }
      // Episodes whose runs were all pruned: their record files ARE the
      // archive — never re-folded, but append-only fields keep flowing.
      for (const existing of await readEpisodeRecords(stateHome)) {
        if (foldedIds.has(existing.episode_id)) continue;
        const refreshed = withAppendOnlyFields(existing, learningEvents);
        await writeRecordIfChanged(stateHome, refreshed);
        records.push(refreshed);
      }
      records.sort((a, b) => a.episode_id.localeCompare(b.episode_id));
      // Exactly-once across date files too: lifecycle timestamps can move
      // (a re-closed episode, an opened anchor shifting), which would land
      // the same event_id in a different date file than the one the
      // per-file dedup checks — filter against every id already captured.
      await emitLifecycleEvents(
        stateHome,
        records,
        new Set(learningEvents.map((event) => event.event_id)),
      );
      return records;
    },

    async get(episodeId: string): Promise<EpisodeRecord> {
      return readEpisodeRecord(stateHome, episodeId);
    },

    async recordLateOutcome(
      episodeId: string,
      outcome: LateOutcomeInput,
    ): Promise<LearningEvent> {
      const record = await this.get(episodeId);
      const hash = createHash("sha256")
        .update(`${episodeId}\n${outcome.kind}\n${outcome.ref}`, "utf8")
        .digest("hex")
        .slice(0, 12);
      // Idempotent across days, not only within one date file: a repeat on a
      // later date would otherwise land in a fresh file and dodge the
      // per-file dedup.
      const existing = (await readLearningEvents(stateHome)).find(
        (candidate) => candidate.event_id === `evt_late_${hash}`,
      );
      if (existing !== undefined) return existing;
      const event: LearningEvent = {
        event_id: `evt_late_${hash}`,
        episode_id: episodeId,
        ts: clock().toISOString(),
        app: record.app,
        stage: record.stage,
        risk_tier: null,
        release_disposition: null,
        type: "late_outcome",
        emitter: "human",
        source_channel: "internal",
        trust: "trusted",
        payload: {
          kind: outcome.kind,
          ref: outcome.ref,
          ...(outcome.note !== undefined ? { note: outcome.note } : {}),
        },
      };
      await appendLearningEventsDeduped(stateHome, [event]);
      return event;
    },
  };
}

// ---------------------------------------------------------------------------
// the fold
// ---------------------------------------------------------------------------

interface RunView {
  envelope: RunEnvelope;
  anchor: EpisodeAnchor;
  status: EpisodeTurnStatus;
}

async function foldEpisodes(
  stateHome: string,
  appStages: Record<string, string> | undefined,
  now: Date,
  learningEvents: LearningEvent[],
): Promise<EpisodeRecord[]> {
  // Source 1: run records, grouped by episode anchor.
  const byEpisode = new Map<string, RunView[]>();
  for (const { app, runId } of await listRuns(stateHome)) {
    let envelope: RunEnvelope;
    try {
      envelope = await readEnvelope(stateHome, app, runId);
    } catch {
      // No/torn envelope: a startRun race measured in milliseconds, or a
      // crashed write. Unattributable without an envelope — the next
      // projection picks it up.
      continue;
    }
    const anchor = await deriveEpisodeAnchor(stateHome, envelope);
    const view: RunView = { envelope, anchor, status: classifyRun(envelope, now) };
    const bucket = byEpisode.get(anchor.episodeId);
    if (bucket === undefined) byEpisode.set(anchor.episodeId, [view]);
    else bucket.push(view);
  }

  // Source 2: the org ledger, joined on runId (first row wins — settlement
  // is exactly-once keyed on it).
  const ledgerByRun = new Map<string, TurnRecord>();
  for (const row of await readTurnRecords(stateHome)) {
    if (typeof row.runId === "string" && !ledgerByRun.has(row.runId)) {
      ledgerByRun.set(row.runId, row);
    }
  }

  // Source 3: the approvals store.
  const store = new ApprovalStore(stateHome);
  const approvals = [...(await store.listPending()), ...(await store.listDecided())].sort(
    (a, b) => a.raisedAt.localeCompare(b.raisedAt) || a.id.localeCompare(b.id),
  );

  // Source 4: resolved-context records — the per-turn pins whose lineage
  // agreement the record asserts (M5 done-means: "verified from
  // resolved-context records").
  const resolvedLineages = await readResolvedLineages(stateHome);

  const records: EpisodeRecord[] = [];
  for (const [episodeId, views] of [...byEpisode.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    records.push(
      await foldOne(stateHome, episodeId, views, {
        appStages,
        ledgerByRun,
        approvals,
        learningEvents,
        resolvedLineages,
        now,
      }),
    );
  }
  return records;
}

/** episode id → distinct lineages observed across its pinned resolves.
 *  Torn/foreign files skip silently — projection state, rebuildable. */
async function readResolvedLineages(stateHome: string): Promise<Map<string, Set<string>>> {
  const byEpisode = new Map<string, Set<string>>();
  const dir = resolvedContextDir(stateHome);
  if (!existsSync(dir)) return byEpisode;
  for (const name of (await readdir(dir)).filter((entry) => entry.endsWith(".json")).sort()) {
    let record: { episode_id?: unknown; bundle_lineage?: unknown };
    try {
      record = JSON.parse(await readFile(join(dir, name), "utf8")) as typeof record;
    } catch {
      continue;
    }
    if (typeof record.episode_id !== "string" || typeof record.bundle_lineage !== "string") {
      continue;
    }
    const set = byEpisode.get(record.episode_id) ?? new Set<string>();
    set.add(record.bundle_lineage);
    byEpisode.set(record.episode_id, set);
  }
  return byEpisode;
}

interface FoldContext {
  appStages: Record<string, string> | undefined;
  ledgerByRun: Map<string, TurnRecord>;
  approvals: ApprovalItem[];
  learningEvents: LearningEvent[];
  resolvedLineages: Map<string, Set<string>>;
  now: Date;
}

async function foldOne(
  stateHome: string,
  episodeId: string,
  views: RunView[],
  context: FoldContext,
): Promise<EpisodeRecord> {
  views.sort((a, b) => a.envelope.run_id.localeCompare(b.envelope.run_id));
  const anchor = views[0]!.anchor;
  const app = views[0]!.envelope.app;

  const opened = views
    .map((view) => view.envelope.started_at)
    .sort()[0]!;
  const lastActivity = views
    .map((view) => lastSeen(view.envelope))
    .sort()
    .at(-1)!;
  const liveWork = views.some((view) => view.status === "running");

  // Turn entries: one per (trace, pipeline, pass); retries append run ids and
  // the latest attempt's status wins.
  const turnEntries = new Map<string, EpisodeTurnEntry & { first_started: string }>();
  for (const view of views) {
    const { envelope } = view;
    const key = `${envelope.trace_id}\n${envelope.pipeline}\n${envelope.pass}`;
    const existing = turnEntries.get(key);
    if (existing === undefined) {
      turnEntries.set(key, {
        turn_id: envelope.trace_id,
        role: envelope.role,
        pipeline: envelope.pipeline,
        pass: envelope.pass,
        run_ids: [envelope.run_id],
        status: view.status,
        first_started: envelope.started_at,
      });
    } else {
      existing.run_ids.push(envelope.run_id);
      existing.status = view.status; // views are run_id-sorted: latest wins
      existing.role = envelope.role;
    }
  }
  const turns: EpisodeTurnEntry[] = [...turnEntries.values()]
    .sort(
      (a, b) =>
        a.first_started.localeCompare(b.first_started) ||
        a.turn_id.localeCompare(b.turn_id) ||
        a.pass.localeCompare(b.pass),
    )
    .map(({ first_started: _first, ...entry }) => entry);

  // Gate outcomes: L1 rollup preferred, L2 fallback, never both (the same
  // rule capture derives events under).
  const gates: EpisodeGateEntry[] = [];
  for (const view of views) {
    gates.push(...(await runGates(stateHome, view.envelope)));
  }

  // Ticket state machine: merge evidence + PR artifact (build episodes).
  const claim =
    anchor.kind === "build_ticket" ? readClaimEvidence(stateHome, app, views) : undefined;

  // Approvals joined by (app, ticket) or (app, turn).
  const traceIds = new Set(views.map((view) => view.envelope.trace_id));
  const ticketNo = buildTicketNumber(views);
  const joinedApprovals = context.approvals.filter(
    (item) =>
      item.app === app &&
      ((item.turnId !== undefined && traceIds.has(item.turnId)) ||
        (anchor.kind === "build_ticket" &&
          item.ticketRef !== undefined &&
          ticketNo !== undefined &&
          ticketNumber(stripRepoPrefix(item.ticketRef)) === ticketNo)),
  );

  const merged = claim?.merged === true;
  // Quiescence guard: a projection landing in the seconds between one pass
  // finalizing and the next pass's startRun must not close a pipeline
  // mid-flight — closure needs the last activity to predate the stall
  // window, not merely the absence of a live envelope.
  const quiescent =
    views.length > 0 &&
    !liveWork &&
    context.now.getTime() - new Date(lastActivity).getTime() >= EPISODE_STALL_MS;
  // Non-numeric ticket refs (bootstrap milestone keys) have no claim state
  // to consult, so merge evidence can never arrive — they close on
  // quiescence like every non-build kind instead of staying open forever.
  const ticketTracked = anchor.kind === "build_ticket" && ticketNo !== undefined;
  const closed = ticketTracked ? merged : quiescent;

  const { late_outcomes: lateOutcomes, human_observations: humanObservations } =
    appendOnlyFields(episodeId, context.learningEvents);

  const artifacts: string[] = [];
  const sideEffects: EpisodeSideEffect[] = [];
  if (claim?.prNumber !== undefined) {
    artifacts.push(`pull-request-${claim.prNumber}`);
    sideEffects.push({ kind: "github_pr", ref: `#${claim.prNumber}`, reversible: true });
    if (merged) {
      sideEffects.push({ kind: "github_merge", ref: `#${claim.prNumber}`, reversible: false });
    }
  }

  const record: EpisodeRecord = {
    schema_version: 1,
    episode_id: episodeId,
    kind: anchor.kind,
    app,
    source: anchor.source,
    stage: context.appStages?.[app] ?? null,
    risk_tier: null,
    opened,
    ...(closed ? { closed: lastActivity } : {}),
    status: closed ? "closed" : "open",
    fingerprint_ref: null,
    bundle_lineage: foldLineage(episodeId, context.resolvedLineages),
    turns,
    gates,
    approvals: joinedApprovals.map((item) => item.id),
    artifacts,
    side_effects: sideEffects,
    ...(closed
      ? {
          outcome: foldOutcome(views, {
            anchor,
            merged,
            ticketTracked,
            turns,
            gates,
            joinedApprovals,
            ledgerByRun: context.ledgerByRun,
          }),
        }
      : {}),
    late_outcomes: lateOutcomes,
    human_observations: humanObservations,
  };
  return record;
}

function foldOutcome(
  views: RunView[],
  input: {
    anchor: EpisodeAnchor;
    merged: boolean;
    ticketTracked: boolean;
    turns: EpisodeTurnEntry[];
    gates: EpisodeGateEntry[];
    joinedApprovals: ApprovalItem[];
    ledgerByRun: Map<string, TurnRecord>;
  },
): EpisodeOutcome {
  let costUsd = 0;
  let costEstimated = false;
  const unsettled: string[] = [];
  for (const view of views) {
    const row = input.ledgerByRun.get(view.envelope.run_id);
    if (row !== undefined) {
      costUsd += row.costUsd;
      if (row.costEstimated === true) costEstimated = true;
    } else if (view.envelope.usage !== undefined && view.status !== "running") {
      unsettled.push(view.envelope.run_id);
    }
  }

  const reviewCycles = new Set(
    views
      .filter((view) => view.envelope.pipeline === "review")
      .map((view) => view.envelope.trace_id),
  ).size;

  // Non-build completion reads the chronologically LAST turn entry: a failed
  // attempt re-dispatched under a fresh turn id leaves its failed entry in
  // the history, and requiring every entry to complete would report a
  // successfully retried episode as incomplete forever.
  const completed = input.ticketTracked
    ? input.merged
    : input.turns.length > 0 && input.turns.at(-1)!.status === "completed";

  return {
    completed,
    // merged is asserted only when claim tracking exists; a non-numeric
    // ticket ref may well have merged remotely — unknown, never false.
    ...(input.ticketTracked ? { merged: input.merged } : {}),
    release_disposition: releaseDisposition(input.anchor.kind, input.merged, input.joinedApprovals),
    review_cycles: reviewCycles,
    gate_failures: input.gates.filter((gate) => gate.status === "fail").length,
    human_interventions: input.joinedApprovals.filter((item) => item.status !== "pending").length,
    cost_usd: costUsd,
    cost_estimated: costEstimated,
    unsettled_runs: unsettled,
  };
}

function releaseDisposition(
  kind: EpisodeKind,
  merged: boolean,
  approvals: ApprovalItem[],
): string | null {
  if (kind !== "build_ticket" || !merged) return null;
  const deploy = approvals.filter((item) => item.rule === "production-deploy").at(-1);
  if (deploy === undefined) return "merged";
  if (deploy.status === "pending") return "deploy-pending";
  return deploy.status === "approved" ? "deploy-approved" : "deploy-denied";
}

// ---------------------------------------------------------------------------
// source readers
// ---------------------------------------------------------------------------

function classifyRun(envelope: RunEnvelope, now: Date): EpisodeTurnStatus {
  if (envelope.status !== "running") return envelope.status;
  const beat = new Date(lastSeen(envelope)).getTime();
  return now.getTime() - beat < EPISODE_STALL_MS ? "running" : "stalled";
}

function lastSeen(envelope: RunEnvelope): string {
  return envelope.finished_at ?? envelope.last_seen_at ?? envelope.started_at;
}

async function runGates(stateHome: string, envelope: RunEnvelope): Promise<EpisodeGateEntry[]> {
  const rollup = envelope.gate_results ?? [];
  if (rollup.length > 0) {
    return rollup.map((gate) => ({
      gate: gate.gate,
      status: gateStatus(gate),
      run_id: envelope.run_id,
      ...(gate.detail !== undefined ? { detail: gate.detail } : {}),
    }));
  }
  let l2: RunlogEvent[];
  try {
    l2 = await readEvents(stateHome, envelope.app, envelope.run_id);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    // Mid-file corruption: loud but ISOLATED — one damaged historical run
    // must not wedge every projection (and with it every `operon learn`
    // subcommand) forever. Recorded as a failing gate entry on the run, the
    // same shape status.ts uses for a corrupt envelope: shown, never
    // dropped, never fatal.
    return [
      {
        gate: "runlog",
        status: "fail",
        run_id: envelope.run_id,
        detail: `events.jsonl unreadable: ${(error as Error).message}`,
      },
    ];
  }
  return l2
    .filter((event) => event.event === "gate.passed" || event.event === "gate.failed")
    .map((event) => ({
      gate: String(event.detail?.["gate"] ?? "unknown"),
      status: (event.event === "gate.passed" ? "pass" : "fail") as "pass" | "fail",
      run_id: envelope.run_id,
      ...(typeof event.detail?.["detail"] === "string"
        ? { detail: event.detail["detail"] }
        : {}),
    }));
}

function gateStatus(gate: GateResultEntry): "pass" | "fail" | "skip" {
  return gate.status === "passed" ? "pass" : gate.status === "failed" ? "fail" : "skip";
}

interface ClaimEvidence {
  merged: boolean;
  prNumber?: number;
}

/** The loop's ticket claim state (`tickets/<app>/<n>.json`) is the only
 *  durable local record of a ticket ending: `advanceShipping` merges on
 *  GitHub but opens no phase run, while the driver appends
 *  `claim N: ended merged (PR #n)` at claim end (src/loop/driver.ts). */
function readClaimEvidence(
  stateHome: string,
  app: string,
  views: RunView[],
): ClaimEvidence | undefined {
  const issue = buildTicketNumber(views);
  if (issue === undefined) return undefined;
  const state = readTicketClaimState(stateHome, app, issue);
  let merged = false;
  let mergedPr: number | undefined;
  let lastPr: number | undefined;
  for (const outcome of state.outcomes) {
    const match = /^claim \d+: ended (\S+)(?: \(PR #(\d+)\))?$/.exec(outcome);
    if (match === null) continue;
    const pr = match[2] !== undefined ? Number(match[2]) : undefined;
    if (pr !== undefined) lastPr = pr;
    if (match[1] === "merged") {
      merged = true;
      if (pr !== undefined) mergedPr = pr;
    }
  }
  // The merge side effect must name the PR of the MERGED claim — a later
  // returned claim may carry a different PR number.
  const prNumber = mergedPr ?? lastPr;
  return { merged, ...(prNumber !== undefined ? { prNumber } : {}) };
}

function buildTicketNumber(views: RunView[]): number | undefined {
  for (const view of views) {
    const ticket = view.envelope.ticket;
    if (ticket === undefined) continue;
    const numeric = ticketNumber(ticket);
    if (numeric !== undefined) return numeric;
  }
  return undefined;
}

/** Approval ticketRefs sometimes carry a repo prefix (`owner/repo#2`);
 *  envelope tickets are issue-local (`#2`). Compare on the issue number. */
function stripRepoPrefix(ticketRef: string): string {
  const hash = ticketRef.lastIndexOf("#");
  return hash > 0 ? ticketRef.slice(hash) : ticketRef;
}

// ---------------------------------------------------------------------------
// record write + lifecycle events
// ---------------------------------------------------------------------------

/** The append-only slice of a record — always recomputed from the durable
 *  event store, even for episodes whose runs were pruned. Duplicate event
 *  ids (historical artifacts of pre-fix appends) collapse to one entry. */
function appendOnlyFields(
  episodeId: string,
  learningEvents: LearningEvent[],
): Pick<EpisodeRecord, "late_outcomes" | "human_observations"> {
  const episodeEvents = learningEvents.filter((event) => event.episode_id === episodeId);
  const seen = new Set<string>();
  const unique = episodeEvents.filter((event) => {
    if (seen.has(event.event_id)) return false;
    seen.add(event.event_id);
    return true;
  });
  return {
    late_outcomes: unique
      .filter((event) => event.type === "late_outcome")
      .map((event) => ({
        kind: String(event.payload?.["kind"] ?? "unknown"),
        ref: String(event.payload?.["ref"] ?? ""),
        recorded: event.ts,
        ...(typeof event.payload?.["note"] === "string"
          ? { note: event.payload["note"] }
          : {}),
      }))
      .sort((a, b) => a.recorded.localeCompare(b.recorded) || a.ref.localeCompare(b.ref)),
    human_observations: unique
      .filter((event) => event.type === "human_correction")
      .map((event) => ({ event_id: event.event_id, disposition_ref: null }))
      .sort((a, b) => a.event_id.localeCompare(b.event_id)),
  };
}

/** Sticky-lineage agreement across the episode's pinned resolves; `mixed`
 *  surfaces loudly in reports — a canaried episode whose turns disagreed is
 *  a stickiness bug, not a rendering choice. */
function foldLineage(
  episodeId: string,
  resolvedLineages: Map<string, Set<string>>,
): EpisodeRecord["bundle_lineage"] {
  const lineages = resolvedLineages.get(episodeId);
  if (lineages === undefined || lineages.size === 0) return null;
  if (lineages.size > 1) return "mixed";
  const [only] = lineages;
  return only === "canary" ? "canary" : "stable";
}

function withAppendOnlyFields(
  record: EpisodeRecord,
  learningEvents: LearningEvent[],
): EpisodeRecord {
  // bundle_lineage normalizes pre-M5 archives (absent key) to null.
  return {
    ...record,
    bundle_lineage: record.bundle_lineage ?? null,
    ...appendOnlyFields(record.episode_id, learningEvents),
  };
}

/** A closed record whose sources were pruned is the durable archive: keep it
 *  (append-only fields still refresh) instead of overwriting it with the
 *  degraded fold of whatever runs survive. A fold that still sees every
 *  recorded run — or new ones — writes normally. */
async function preserveOrWrite(
  stateHome: string,
  folded: EpisodeRecord,
  learningEvents: LearningEvent[],
): Promise<EpisodeRecord> {
  const path = episodePath(stateHome, folded.episode_id);
  if (existsSync(path)) {
    let existing: EpisodeRecord | undefined;
    try {
      existing = JSON.parse(await readFile(path, "utf8")) as EpisodeRecord;
    } catch {
      // A torn record file is projection state — rebuildable; the fresh
      // fold below replaces it.
    }
    if (existing !== undefined && existing.status === "closed" && anyRunPruned(existing, folded)) {
      const preserved = withAppendOnlyFields(existing, learningEvents);
      await writeRecordIfChanged(stateHome, preserved);
      return preserved;
    }
  }
  await writeRecordIfChanged(stateHome, folded);
  return folded;
}

function anyRunPruned(existing: EpisodeRecord, folded: EpisodeRecord): boolean {
  const foldedRuns = new Set(folded.turns.flatMap((turn) => turn.run_ids));
  return existing.turns.some((turn) => turn.run_ids.some((runId) => !foldedRuns.has(runId)));
}

async function writeRecordIfChanged(stateHome: string, record: EpisodeRecord): Promise<void> {
  const path = episodePath(stateHome, record.episode_id);
  const next = JSON.stringify(record, null, 2) + "\n";
  if (existsSync(path) && (await readFile(path, "utf8")) === next) return;
  await mkdir(episodesDir(stateHome), { recursive: true });
  await writeFileAtomic(path, next);
}

/** `episode_opened` once per episode, `episode_closed` once when first
 *  observed closed — deterministic ids, filtered against every id already
 *  captured (any date file) and then deduped on append, so replaying the
 *  projection never re-emits even when a moved timestamp would target a
 *  different date file (a re-armed ticket that re-closes does not emit a
 *  second close; the record itself is the truth, events are signals). */
async function emitLifecycleEvents(
  stateHome: string,
  records: EpisodeRecord[],
  knownEventIds: Set<string>,
): Promise<void> {
  const events: LearningEvent[] = [];
  for (const record of records) {
    const base = {
      episode_id: record.episode_id,
      app: record.app,
      stage: record.stage,
      risk_tier: null,
      release_disposition: record.outcome?.release_disposition ?? null,
      emitter: "orchestrator",
      source_channel: "internal",
      trust: "trusted",
    } as const;
    if (!knownEventIds.has(`evt_${record.episode_id}_opened`)) {
      events.push({
        ...base,
        event_id: `evt_${record.episode_id}_opened`,
        ts: record.opened,
        type: "episode_opened",
        payload: { kind: record.kind, source_ref: record.source.ref },
      });
    }
    if (
      record.status === "closed" &&
      record.closed !== undefined &&
      !knownEventIds.has(`evt_${record.episode_id}_closed`)
    ) {
      events.push({
        ...base,
        event_id: `evt_${record.episode_id}_closed`,
        ts: record.closed,
        type: "episode_closed",
        payload: {
          kind: record.kind,
          completed: record.outcome?.completed ?? false,
          ...(record.outcome?.merged !== undefined ? { merged: record.outcome.merged } : {}),
          cost_usd: record.outcome?.cost_usd ?? 0,
        },
      });
    }
  }
  await appendLearningEventsDeduped(stateHome, events);
}

/** One projected record by id; throws with a pointer when it was never
 *  projected. The capsule builder and CLI read through this. */
export async function readEpisodeRecord(
  stateHome: string,
  episodeId: string,
): Promise<EpisodeRecord> {
  const path = episodePath(stateHome, episodeId);
  if (!existsSync(path)) {
    throw new Error(
      `learning: no projected record for ${episodeId} — check the id ` +
        `(operon learn report lists known episodes); an episode gets a record ` +
        `once it has captured runs`,
    );
  }
  return JSON.parse(await readFile(path, "utf8")) as EpisodeRecord;
}

/** Every projected episode record, sorted by episode id — the read side for
 *  reports without forcing callers through project(). */
export async function readEpisodeRecords(stateHome: string): Promise<EpisodeRecord[]> {
  const dir = episodesDir(stateHome);
  if (!existsSync(dir)) return [];
  const records: EpisodeRecord[] = [];
  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".json")).sort()) {
    try {
      records.push(JSON.parse(await readFile(join(dir, name), "utf8")) as EpisodeRecord);
    } catch {
      // Torn projection state — the next project() rewrites it; a reader
      // must not wedge on it.
    }
  }
  return records;
}
