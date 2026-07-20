// Phase 4 closed-loop efficiency evidence.
//
// This is a pure projection over orchestrator-owned records. It deliberately
// has no runtime/provider import: capture, recurrence, disposition, and health
// reporting must remain token-free. The output is the ordinary LearningEvent
// schema, so Phase 4 extends the existing governed learning chain rather than
// introducing a second evidence model.

import { createHash } from "node:crypto";
import type { RunlogEvent } from "../../runtime/runlog/events.js";
import type { RunEnvelope } from "../../runtime/runlog/envelope.js";
import type { TurnAssignmentSource } from "../../runtime/types.js";
import type { ExecutionJournal } from "../../loop/execution-journal.js";
import type { ExecutionStepRecord, RouteRecord } from "../../loop/efficiency.js";
import { METRIC_EMITTERS, type LearningEvent } from "./events.js";

export const EFFICIENCY_EVIDENCE_VERSION = "efficiency-evidence/v1" as const;
export const EFFICIENCY_CLUSTER_VERSION = "efficiency-cluster/v1" as const;

export const EFFICIENCY_ERROR_CLASSES = [
  "execution.cancelled",
  "execution.cap_stop",
  "execution.pass_failed",
  "environment.retry_cluster",
  "route.budget_variance",
  "route.budget_overrun",
  "execution.stale_finalization",
  "execution.missing_finalization",
  "approval.false_positive",
  "execution.repeated_work",
  "review.long_duration",
  "tooling.bash_heavy",
  "tooling.shell_heavy_repetition",
  "scheduler.missed_tick",
] as const;

export type EfficiencyErrorClass = (typeof EFFICIENCY_ERROR_CLASSES)[number];
const EFFICIENCY_CLASS_SET = new Set<string>(EFFICIENCY_ERROR_CLASSES);

/**
 * ONE canonical cause per class. Recurrence keys on (app, role, class, cause),
 * so any two code paths that can emit the same class must pass the identical
 * string — otherwise ten genuinely identical failures split across two
 * sub-threshold clusters and the distiller produces no candidate for a failure
 * mode that is plainly recurring.
 *
 * `execution.pass_failed` is deliberately absent: it is the unmapped-code
 * fallback, and its cause embeds the `error_code` so two passes failing for
 * unrelated reasons cannot cluster into one false recurrence.
 */
const CLASS_CAUSES = {
  "execution.cap_stop": "the admitted execution route reached a deterministic cap",
  "execution.cancelled": "provider execution ended cancelled",
  "execution.missing_finalization": "provider execution is missing finalization",
} as const satisfies Partial<Record<EfficiencyErrorClass, string>>;

/**
 * Terminal `error_code` → typed class, so a failed pass is evidence even when
 * the journal, route record, or efficiency episode is absent (#138). Before
 * this, a run finalized `failed` with a precise `error_code` produced nothing
 * at all unless an execution journal happened to exist alongside it.
 *
 * Substring predicates, not an enumerated table, deliberately: this mirrors
 * `journalStopKind` in src/loop/loop.ts, so a newly-introduced budget/cap code
 * classifies correctly without a second table having to be remembered. A code
 * that maps to the class another branch also emits reuses that branch's
 * canonical cause via `CLASS_CAUSES`, and `add` admits one event per
 * (run, class) — together that keeps a capped run with a journal from
 * double-counting toward `min_cluster_events`.
 */
function terminalErrorClass(errorCode: string): EfficiencyErrorClass {
  if (errorCode === "error_cancelled") return "execution.cancelled";
  if (errorCode === "error_stale_missing_finalization") return "execution.missing_finalization";
  // Same predicate as `journalStopKind` in src/loop/loop.ts. Keep them
  // identical: a code the loop treats as a cap must classify as one here.
  if (errorCode.includes("budget") || errorCode.includes("cap")) return "execution.cap_stop";
  return "execution.pass_failed";
}

function causeFor(errorClass: EfficiencyErrorClass, errorCode: string): string {
  return errorClass in CLASS_CAUSES
    ? CLASS_CAUSES[errorClass as keyof typeof CLASS_CAUSES]
    : `provider pass terminated with ${errorCode}`;
}

export interface EfficiencyActionSummary {
  run_id: string;
  shell_commands: number;
  unique_shell_commands: number;
  repeated_shell_commands: number;
  environment_retries: number;
  tool_calls: number;
}

export interface EfficiencyApprovalEvidence {
  id: string;
  app: string;
  episode_id: string;
  role: string;
  ts: string;
  /** Verifier-owned semantic classification, never inferred from prose. */
  classification: "valid" | "false_positive";
}

export interface SchedulerMissEvidence {
  id: string;
  app: string;
  episode_id: string;
  role: string;
  due_at: string;
  observed_at: string;
  schedule_ref: string;
}

export interface EfficiencyRunEvidence {
  envelope: RunEnvelope;
  /**
   * Learning-namespace episode id to stamp on the events this run produces
   * (`ep_<app>_ticket_0002`), when it differs from the efficiency-namespace id
   * the envelope and its execution steps are keyed on (`ticket:<app>:#2`).
   *
   * The two ids are threaded separately on purpose (#137). `envelope.episode_id`
   * stays the STEP-MATCHING key — the filter below is a correctness guard
   * against cross-episode step bleed and must keep comparing like with like —
   * while this field carries event identity. Overwriting one with the other
   * made the filter match nothing, classified every provider run as mechanical,
   * and silently dropped 100% of efficiency evidence.
   */
  learning_episode_id?: string;
  /** Explicit verifier-owned execution kind when importing an evidence
   * snapshot. Live projection derives this from execution steps. */
  kind?: "provider" | "mechanical";
  events?: RunlogEvent[];
  action?: EfficiencyActionSummary;
  /** Analyzer-owned projections used by sanitized archives that omit the
   * full execution-step bodies. */
  artifact_fingerprint?: string;
  admitted_budget_usd?: number;
  planned_cost_usd?: number;
  route?: RouteRecord | null;
  journal?: ExecutionJournal | null;
  steps?: ExecutionStepRecord[];
}

export interface EfficiencyEvidenceInput {
  runs: EfficiencyRunEvidence[];
  approvals?: EfficiencyApprovalEvidence[];
  schedulerMisses?: SchedulerMissEvidence[];
  appStages?: Record<string, string>;
}

/** Stable, source-derived evidence. Filesystem order cannot affect ids or bytes. */
export function projectEfficiencyEvidence(input: EfficiencyEvidenceInput): LearningEvent[] {
  const runs = [...input.runs].sort((a, b) =>
    a.envelope.app.localeCompare(b.envelope.app) ||
    a.envelope.run_id.localeCompare(b.envelope.run_id),
  );
  const repeatedArtifacts = repeatedArtifactRuns(runs);
  const out: LearningEvent[] = [];

  for (const run of runs) {
    const envelope = run.envelope;
    const providerSteps = (run.steps ?? []).filter(
      (step) =>
        step.kind === "provider" &&
        step.app === envelope.app &&
        step.run_id === envelope.run_id &&
        (envelope.episode_id === undefined || step.episode_id === envelope.episode_id),
    );
    // An explicitly mechanical run/step can never become provider learning
    // evidence. Legacy provider envelopes may have no execution-step records.
    const explicitlyMechanical =
      run.kind === "mechanical" || ((run.steps?.length ?? 0) > 0 && providerSteps.length === 0);
    if (explicitlyMechanical || envelope.app === "learning-replay") continue;

    const action = run.action ?? summarizeActions(envelope.run_id, run.events ?? []);
    const base = baseEvent(run, input.appStages);
    const planProvenance = projectPlanProvenance(envelope, providerSteps);
    const timestamp = envelope.finished_at ?? envelope.last_seen_at ?? envelope.started_at;
    // One event per (run, class). `source_identity` already collapses to the
    // same id, but making the guard explicit is what lets the journal-derived
    // and error-code-derived cap paths coexist without either double-counting
    // toward `min_cluster_events` or depending on emission order (#138).
    //
    // A repeat call MERGES its detail rather than being dropped: the journal
    // path carries `stop_reason`, the error-code path carries `error_code`,
    // and a capped run should keep both. First cause wins — the causes for a
    // shared class are identical by construction (`CLASS_CAUSES`), so this
    // only ever affects payload richness, never cluster identity.
    const emitted = new Map<EfficiencyErrorClass, LearningEvent>();
    const add = (errorClass: EfficiencyErrorClass, cause: string, detail: Record<string, unknown>): void => {
      const existing = emitted.get(errorClass);
      if (existing !== undefined) {
        existing.payload = { ...detail, ...existing.payload };
        return;
      }
      const sourceIdentity = `${envelope.app}\0${envelope.run_id}\0${errorClass}`;
      const event: LearningEvent = {
        ...base,
        event_id: `evt_eff_${digest(`${EFFICIENCY_EVIDENCE_VERSION}\0${sourceIdentity}`).slice(0, 24)}`,
        ts: timestamp,
        type: "error",
        error_class: errorClass,
        cause_hypothesis: cause,
        emitter: "orchestrator",
        source_channel: "efficiency_projection",
        trust: "trusted",
        payload: {
          classification_version: EFFICIENCY_EVIDENCE_VERSION,
          evidence_kind: "provider",
          source_identity: sourceIdentity,
          ...detail,
          ...planProvenance,
        },
      };
      emitted.set(errorClass, event);
      out.push(event);
    };

    const statuses = new Set([envelope.status, ...providerSteps.map((step) => step.status)]);
    if (statuses.has("cancelled")) {
      add("execution.cancelled", CLASS_CAUSES["execution.cancelled"], {
        terminal_reason: envelope.terminal_reason ?? terminalReason(providerSteps),
      });
    }
    // The execution journal is EPISODE-scoped: every run in the episode reads
    // the same `stop`, so attributing it to all of them blames passes that
    // never hit the cap and multiplies the recurrence count for the class.
    // The CALLER decides which single run owns it — capture passes the
    // journal only for the episode's terminal provider run. Do NOT re-derive
    // that here from the run's own status: the quality-gate repair cap
    // (src/loop/loop.ts:373) stops the journal after every pass has completed
    // cleanly, so a "did this run end badly" test silently discards the most
    // common cap path in the product.
    if (run.journal?.stop?.kind === "cap_stop") {
      add("execution.cap_stop", CLASS_CAUSES["execution.cap_stop"], {
        stop_reason: run.journal.stop.reason,
        next_boundary: run.journal.stop.next_boundary,
      });
    }
    // A terminally failed provider pass is evidence on its own, with no
    // dependency on the journal, route record, or efficiency episode existing
    // (#138). Before this, the single clearest failure signal the system
    // produces — `pass.failed` with a precise `error_code` — became nothing.
    // `finalizeRun` records `error_code` only when the caller supplied one, so
    // a failed pass can carry none at all. It must still be evidence: without
    // the fallback such a run yields nothing, and `hasFailureSignal` in
    // capture.ts would raise an evidence gap that no projector fix can ever
    // clear. The sentinel keeps the (failed -> always classified) invariant
    // total, and clusters separately from any real code.
    if (statuses.has("failed")) {
      const failureCode =
        envelope.error_code ??
        providerSteps.find((step) => step.error_code !== null)?.error_code ??
        "error_unspecified";
      const errorClass = terminalErrorClass(failureCode);
      add(errorClass, causeFor(errorClass, failureCode), {
        error_code: failureCode,
        envelope_status: envelope.status,
        terminal_reason: envelope.terminal_reason ?? null,
      });
    }
    if (
      envelope.status === "running" ||
      providerSteps.some((step) => step.error_code === "error_stale_missing_finalization")
    ) {
      add("execution.stale_finalization", "provider execution has no truthful timely terminal record", {
        last_seen_at: envelope.last_seen_at ?? null,
      });
      add("execution.missing_finalization", CLASS_CAUSES["execution.missing_finalization"], {
        envelope_status: envelope.status,
      });
    } else if (envelope.finished_at === undefined) {
      add("execution.missing_finalization", CLASS_CAUSES["execution.missing_finalization"], {
        envelope_status: envelope.status,
      });
    }
    if (action.environment_retries >= 2) {
      add("environment.retry_cluster", "multiple verifier-classified environment recovery attempts occurred", {
        environment_retries: action.environment_retries,
      });
    }
    if (action.shell_commands >= 20) {
      add("tooling.bash_heavy", "shell execution dominated the provider tool trace", {
        shell_commands: action.shell_commands,
        tool_calls: action.tool_calls,
      });
    }
    if (action.repeated_shell_commands >= 10) {
      add("tooling.shell_heavy_repetition", "repeated hashed shell exploration dominated the tool trace", {
        shell_commands: action.shell_commands,
        unique_shell_commands: action.unique_shell_commands,
        repeated_shell_commands: action.repeated_shell_commands,
      });
    }
    if (envelope.role === "reviewer" && durationMs(envelope) >= 10 * 60_000) {
      add("review.long_duration", "review active duration exceeded the calibrated ten-minute boundary", {
        duration_ms: durationMs(envelope),
      });
    }
    if (
      repeatedArtifacts.has(envelope.run_id) ||
      providerSteps.some((step) => step.productive === true && step.repeated_from_step_id !== null)
    ) {
      add("execution.repeated_work", "a still-valid productive artifact fingerprint was produced again", {
        artifact_fingerprints: unique(
          providerSteps
            .map((step) => step.artifact_fingerprint)
            .filter((value): value is string => value !== null),
        ),
      });
    }

    const providerCost = providerSteps.reduce((sum, step) => sum + (step.usage?.costUsd ?? 0), 0);
    const observedCost = providerSteps.length > 0 ? providerCost : (envelope.usage?.cost_usd ?? 0);
    const budget = run.admitted_budget_usd ?? run.route?.budget.equivalent_cost_usd;
    if (budget !== undefined && observedCost > budget) {
      add("route.budget_overrun", "provider execution exceeded the admitted equivalent-cost route budget", {
        observed_cost_usd: observedCost,
        budget_cost_usd: budget,
        planned_route: run.route?.planned_route,
        final_route: run.route?.final_route,
      });
    }
    if (
      (run.planned_cost_usd ?? envelope.planning_route?.estimated_cost_usd) !== undefined &&
      (run.planned_cost_usd ?? envelope.planning_route?.estimated_cost_usd) !== null &&
      observedCost > (run.planned_cost_usd ?? envelope.planning_route!.estimated_cost_usd!)
    ) {
      add("route.budget_variance", "observed provider cost exceeded the declared route estimate", {
        observed_cost_usd: observedCost,
        estimated_cost_usd: run.planned_cost_usd ?? envelope.planning_route?.estimated_cost_usd,
      });
    }
  }

  for (const approval of [...(input.approvals ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    if (approval.classification !== "false_positive") continue;
    out.push(supplementalEvent({
      identity: approval.id,
      app: approval.app,
      episodeId: approval.episode_id,
      role: approval.role,
      ts: approval.ts,
      errorClass: "approval.false_positive",
      cause: "a verifier-classified routine action was escalated for approval",
      detail: { approval_id: approval.id },
    }));
  }
  for (const miss of [...(input.schedulerMisses ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    out.push(supplementalEvent({
      identity: miss.id,
      app: miss.app,
      episodeId: miss.episode_id,
      role: miss.role,
      ts: miss.observed_at,
      errorClass: "scheduler.missed_tick",
      cause: "a due schedule tick had no reasoned terminal invocation record",
      evidenceKind: "mechanical",
      detail: {
        due_at: miss.due_at,
        observed_at: miss.observed_at,
        schedule_ref: miss.schedule_ref,
      },
    }));
  }
  return dedupeEvents(out).sort((a, b) => a.event_id.localeCompare(b.event_id));
}

export interface EvidenceCluster {
  schema_version: 1;
  classification_version: typeof EFFICIENCY_CLUSTER_VERSION;
  fingerprint: string;
  app: string;
  role: string;
  error_class: EfficiencyErrorClass;
  cause_hypothesis: string;
  event_ids: string[];
  episode_ids: string[];
  run_ids: string[];
  evidence_refs: string[];
}

export type CandidateDispositionKind =
  | "actionable"
  | "deduplicated"
  | "suppressed"
  | "rejected"
  | "frequency_capped"
  | "volume_capped"
  | "budget_capped"
  | "awaiting_evidence"
  | "awaiting_review"
  | "non_comparable";

export interface CandidateDisposition {
  schema_version: 1;
  disposition_id: string;
  cluster_ref: string | null;
  event_ids: string[];
  app: string;
  role: string | null;
  error_class: string | null;
  disposition: CandidateDispositionKind;
  reason_code: string;
  candidate_ref: string | null;
}

export interface ClusterProjection {
  clusters: EvidenceCluster[];
  dispositions: CandidateDisposition[];
}

/**
 * Recurrence requires distinct source events and comparable app+role+class+
 * cause. Untrusted/agent/replay/cross-boundary events remain visible as
 * non-actionable dispositions; they never manufacture a cluster.
 */
export function clusterEfficiencyEvidence(
  source: readonly LearningEvent[],
  threshold: number,
): ClusterProjection {
  if (!Number.isInteger(threshold) || threshold < 2) {
    throw new Error("learning: efficiency recurrence threshold must be an integer >= 2");
  }
  const byId = new Map(source.map((event) => [event.event_id, event]));
  const events = [...byId.values()].sort((a, b) => a.event_id.localeCompare(b.event_id));
  const groups = new Map<string, LearningEvent[]>();
  const dispositions: CandidateDisposition[] = [];
  for (const event of events) {
    const comparable = comparabilityFailure(event);
    if (comparable !== null) {
      dispositions.push(dispositionFor([event], null, "non_comparable", comparable));
      continue;
    }
    const role = event.agent_role!;
    const errorClass = event.error_class as EfficiencyErrorClass;
    const cause = normalizeCause(event.cause_hypothesis ?? "unresolved");
    const key = `${EFFICIENCY_CLUSTER_VERSION}\0${event.app}\0${role}\0${errorClass}\0${cause}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  const clusters: EvidenceCluster[] = [];
  for (const [key, bucket] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const distinctSources = new Map<string, LearningEvent>();
    for (const event of bucket) {
      const identity = stringPayload(event, "source_identity") ?? event.event_id;
      if (!distinctSources.has(identity)) distinctSources.set(identity, event);
    }
    const lineage = [...distinctSources.values()].sort((a, b) => a.event_id.localeCompare(b.event_id));
    if (lineage.length < threshold) {
      dispositions.push(dispositionFor(lineage, null, "awaiting_evidence", "recurrence_threshold_not_met"));
      continue;
    }
    const event0 = lineage[0]!;
    const fingerprint = digest(key);
    const cluster: EvidenceCluster = {
      schema_version: 1,
      classification_version: EFFICIENCY_CLUSTER_VERSION,
      fingerprint,
      app: event0.app,
      role: event0.agent_role!,
      error_class: event0.error_class as EfficiencyErrorClass,
      cause_hypothesis: normalizeCause(event0.cause_hypothesis ?? "unresolved"),
      event_ids: lineage.map((event) => event.event_id),
      episode_ids: unique(lineage.map((event) => event.episode_id)),
      run_ids: unique(lineage.map((event) => event.run_id).filter((v): v is string => v !== undefined)),
      evidence_refs: lineage.map((event) => `learning:event:${event.event_id}`),
    };
    clusters.push(cluster);
    dispositions.push(dispositionFor(lineage, fingerprint, "actionable", "recurrence_threshold_met"));
  }
  return {
    clusters: clusters.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
    dispositions: dispositions.sort((a, b) => a.disposition_id.localeCompare(b.disposition_id)),
  };
}

export function isEfficiencyEvidenceEvent(event: LearningEvent): boolean {
  return event.error_class !== undefined && EFFICIENCY_CLASS_SET.has(event.error_class);
}

function comparabilityFailure(event: LearningEvent): string | null {
  if (!isEfficiencyEvidenceEvent(event)) return "not_efficiency_evidence";
  if (event.app === "learning-replay" || event.payload?.["replay_reserved"] === true) {
    return "replay_reserved";
  }
  if (event.trust !== "trusted") return "untrusted_evidence";
  if (!METRIC_EMITTERS.includes(event.emitter)) return "untrusted_emitter";
  if (event.agent_role === undefined || event.agent_role.trim() === "") return "missing_role";
  if (event.episode_id.trim() === "") return "missing_episode";
  if (event.payload?.["evidence_kind"] === "mechanical") return "mechanical_execution";
  return null;
}

function dispositionFor(
  events: LearningEvent[],
  clusterRef: string | null,
  disposition: CandidateDispositionKind,
  reasonCode: string,
): CandidateDisposition {
  const eventIds = unique(events.map((event) => event.event_id));
  const first = events[0];
  const identity = stableJson({ clusterRef, eventIds, disposition, reasonCode });
  return {
    schema_version: 1,
    disposition_id: `disp_${digest(identity).slice(0, 24)}`,
    cluster_ref: clusterRef,
    event_ids: eventIds,
    app: first?.app ?? "unknown",
    role: first?.agent_role ?? null,
    error_class: first?.error_class ?? null,
    disposition,
    reason_code: reasonCode,
    candidate_ref: null,
  };
}

function supplementalEvent(input: {
  identity: string;
  app: string;
  episodeId: string;
  role: string;
  ts: string;
  errorClass: EfficiencyErrorClass;
  cause: string;
  detail: Record<string, unknown>;
  evidenceKind?: "provider" | "mechanical";
}): LearningEvent {
  const sourceIdentity = `${input.app}\0${input.identity}\0${input.errorClass}`;
  return {
    event_id: `evt_eff_${digest(`${EFFICIENCY_EVIDENCE_VERSION}\0${sourceIdentity}`).slice(0, 24)}`,
    episode_id: input.episodeId,
    ts: input.ts,
    app: input.app,
    agent_role: input.role,
    type: "error",
    error_class: input.errorClass,
    cause_hypothesis: input.cause,
    emitter: "verifier",
    source_channel: "efficiency_projection",
    trust: "trusted",
    payload: {
      classification_version: EFFICIENCY_EVIDENCE_VERSION,
      evidence_kind: input.evidenceKind ?? "provider",
      source_identity: sourceIdentity,
      ...input.detail,
    },
  };
}

/** Event identity uses the learning-namespace id when the caller threaded one;
 *  step matching (above) keeps using `envelope.episode_id`. See
 *  `EfficiencyRunEvidence.learning_episode_id` (#137). */
function baseEvent(run: EfficiencyRunEvidence, appStages: Record<string, string> | undefined) {
  const envelope = run.envelope;
  return {
    episode_id:
      run.learning_episode_id ??
      envelope.episode_id ??
      `ep_${safe(envelope.app)}_turn_${safe(envelope.trace_id)}`,
    turn_id: envelope.trace_id,
    run_id: envelope.run_id,
    app: envelope.app,
    agent_role: envelope.role,
    pipeline: envelope.pipeline,
    pass: envelope.pass,
    stage: appStages?.[envelope.app] ?? null,
    risk_tier: null,
    release_disposition: null,
  } as const;
}

interface EfficiencyPlanProvenance {
  plan_version?: number;
  plan_step_id?: string;
  assignment_source?: TurnAssignmentSource;
  provider_family?: string;
}

/** Project only unambiguous durable provenance. Modern runs carry plan and
 * assignment identity on both their envelope and execution step; provider
 * family currently lives on the step. Historical evidence simply omits these
 * additive keys, and contradictory sources do not get papered over. */
function projectPlanProvenance(
  envelope: RunEnvelope,
  providerSteps: readonly ExecutionStepRecord[],
): EfficiencyPlanProvenance {
  const planVersion = singleValue([
    envelope.plan_version,
    ...providerSteps.map((step) => step.plan_version),
  ]);
  const planStepId = singleValue([
    envelope.plan_step_id,
    ...providerSteps.map((step) => step.plan_step_id),
  ]);
  const assignmentSource = singleValue([
    envelope.assignment_source,
    ...providerSteps.map((step) => step.assignment_source),
  ]);
  const providerFamily = singleValue(providerSteps.map((step) => step.provider_family));
  return {
    ...(planVersion !== undefined ? { plan_version: planVersion } : {}),
    ...(planStepId !== undefined ? { plan_step_id: planStepId } : {}),
    ...(assignmentSource !== undefined ? { assignment_source: assignmentSource } : {}),
    ...(providerFamily !== undefined ? { provider_family: providerFamily } : {}),
  };
}

function singleValue<T extends string | number>(values: readonly (T | undefined)[]): T | undefined {
  const uniqueValues = [...new Set(values.filter((value): value is T => value !== undefined))];
  return uniqueValues.length === 1 ? uniqueValues[0] : undefined;
}

function summarizeActions(runId: string, events: RunlogEvent[]): EfficiencyActionSummary {
  const tools = events.filter((event) => event.event === "tool.called");
  const shell = tools.filter((event) => ["bash", "shell", "exec_command"].includes(String(event.detail?.["tool"] ?? "")));
  const hashes = shell
    .map((event) => event.detail?.["args_hash"])
    .filter((value): value is string => typeof value === "string");
  return {
    run_id: runId,
    shell_commands: shell.length,
    unique_shell_commands: new Set(hashes).size,
    repeated_shell_commands: hashes.length - new Set(hashes).size,
    environment_retries: tools.filter(
      (event) => event.detail?.["category"] === "environment_retry" || event.detail?.["environment_retry"] === true,
    ).length,
    tool_calls: tools.length,
  };
}

function repeatedArtifactRuns(runs: EfficiencyRunEvidence[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const run of runs) {
    const fingerprints = unique([
      ...(run.steps ?? [])
        .filter((step) => step.kind === "provider" && step.productive === true)
        .map((step) => step.artifact_fingerprint)
        .filter((value): value is string => value !== null),
      ...((run.envelope.artifacts ?? [])
        .map((artifact) => (typeof artifact === "object" && artifact !== null && "sha256" in artifact ? String(artifact.sha256) : undefined))
        .filter((value): value is string => value !== undefined)),
      ...(run.artifact_fingerprint !== undefined ? [run.artifact_fingerprint] : []),
    ]);
    for (const fp of fingerprints) groups.set(fp, [...(groups.get(fp) ?? []), run.envelope.run_id]);
  }
  return new Set([...groups.values()].filter((ids) => new Set(ids).size > 1).flat());
}

function terminalReason(steps: ExecutionStepRecord[]): string | null {
  return steps.find((step) => step.status === "cancelled")?.reason ?? null;
}

function durationMs(envelope: RunEnvelope): number {
  if (envelope.wall_clock_ms !== undefined) return envelope.wall_clock_ms;
  if (envelope.finished_at === undefined) return 0;
  return Math.max(0, Date.parse(envelope.finished_at) - Date.parse(envelope.started_at));
}

function dedupeEvents(events: LearningEvent[]): LearningEvent[] {
  return [...new Map(events.map((event) => [event.event_id, event])).values()];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
}

function normalizeCause(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 240) || "unresolved";
}

function stringPayload(event: LearningEvent, key: string): string | undefined {
  const value = event.payload?.[key];
  return typeof value === "string" ? value : undefined;
}

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "unknown";
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
