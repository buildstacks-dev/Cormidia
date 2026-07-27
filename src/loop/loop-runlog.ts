// Runlog context for the loop's ticket state machine (docs/loop/design.md §7, §9).
//
// The pass executor (pipeline.ts) owns a run record per pass. But quality
// gates and ticket transitions happen in the state machine BETWEEN passes
// (loop.ts advanceGates), so §9's "if something executes, its logs exist"
// applies to them too. This module gives a state-machine step its own run
// record so it can emit `gate.started/passed/failed`, `ticket.transition`,
// and populate `envelope.gate_results` — the anomaly detectors and dashboards
// read L1+L2 only, never transcripts, so these must land as structured
// events, not prose.
//
// loop -> runtime is a legal import direction; nothing here reaches upward.

import { existsSync } from "node:fs";
import {
  finalizeRun,
  startRun,
  updateEnvelope,
  type EnvelopeStatus,
  type GateResultEntry,
} from "../runtime/runlog/envelope.js";
import { createEventWriter, type EventWriter } from "../runtime/runlog/events.js";
import { mintRunId } from "../runtime/runlog/paths.js";
import type { AuthorityEvidence } from "../runtime/types.js";
import {
  admitEpisode,
  episodeIdFor,
  fingerprint,
  recordMechanicalStep,
  readRouteRecord,
  routeRecordPath,
  type ExecutionStatus,
} from "./efficiency.js";

/** Where a loop step's run record lives, plus the correlation id every event
 *  shares. Optional on the phase-option interfaces — absent means the step
 *  runs exactly as before with no run record (back-compat for callers and
 *  tests that don't wire observability). */
export interface LoopRunlog {
  root: string;
  app: string;
  ticket?: string;
  /** turnId — one per pipeline execution; ties gate events back to the run. */
  traceId: string;
  episodeId?: string;
  authority?: AuthorityEvidence;
  clock?: () => Date;
}

/** A one-shot run record for a non-pass state-machine step (e.g. the gate
 *  phase). Open it, emit events / set gate results, then finalize exactly
 *  once. `span_id` is the step name so events group cleanly. */
export interface PhaseRun {
  runId: string;
  events: EventWriter;
  setGateResults(entries: GateResultEntry[]): Promise<void>;
  transition(from: string, to: string): Promise<void>;
  finalize(status: Exclude<EnvelopeStatus, "running">): Promise<void>;
}

const ORCHESTRATOR_ROLE = "orchestrator";

export async function openPhaseRun(
  runlog: LoopRunlog,
  pipeline: string,
  pass: string,
): Promise<PhaseRun> {
  const clock = runlog.clock ?? ((): Date => new Date());
  const runId = mintRunId(clock(), pipeline, pass);
  const startedAt = clock();
  const episodeId =
    runlog.episodeId ??
    episodeIdFor({ app: runlog.app, ...(runlog.ticket !== undefined ? { ticket: runlog.ticket } : {}), traceId: runlog.traceId });
  const ticketPart = runlog.ticket !== undefined ? { ticket: runlog.ticket } : {};

  if (existsSync(routeRecordPath(runlog.root, episodeId))) {
    await readRouteRecord(runlog.root, episodeId);
  } else {
    await admitEpisode({
      root: runlog.root,
      episodeId,
      app: runlog.app,
      route: "deterministic",
      policyVersion: "efficiency/v1-mechanical",
      factors: [{
        kind: "evidence_quality",
        evidence: `${pipeline}/${pass} is a deterministic state-machine operation`,
        policy_rule: "mechanical_state_machine",
      }],
      passes: [],
      now: startedAt,
    });
  }

  await startRun(
    runlog.root,
    {
      runId,
      traceId: runlog.traceId,
      episodeId,
      app: runlog.app,
      ...ticketPart,
      pipeline,
      pass,
      role: ORCHESTRATOR_ROLE,
      ...(runlog.authority !== undefined ? { authority: runlog.authority } : {}),
    },
    clock(),
  );
  const events = createEventWriter(
    runlog.root,
    {
      runId,
      trace_id: runlog.traceId,
      span_id: pass,
      app: runlog.app,
      ...ticketPart,
      pipeline,
      pass,
      role: ORCHESTRATOR_ROLE,
    },
    clock,
  );

  return {
    runId,
    events,
    async setGateResults(entries: GateResultEntry[]): Promise<void> {
      await updateEnvelope(runlog.root, runlog.app, runId, { gate_results: entries });
    },
    async transition(from: string, to: string): Promise<void> {
      await events.append({ type: "ticket.transition", detail: { from, to } });
    },
    async finalize(status: Exclude<EnvelopeStatus, "running">): Promise<void> {
      const step = await recordMechanicalStep({
        root: runlog.root,
        episodeId,
        app: runlog.app,
        runId,
        operation: `${pipeline}/${pass}`,
        startedAt,
        finishedAt: clock(),
        status: mechanicalStatus(status),
        reason: `${pipeline}/${pass} ${status}`,
        ...(status === "completed" ? {} : { nextStep: "resume the ticket from its last durable phase" }),
        inputFingerprint: fingerprint({ pipeline, pass, ticket: runlog.ticket ?? null }),
      });
      await updateEnvelope(runlog.root, runlog.app, runId, {
        executionStepIds: [step.execution_step_id],
      });
      // A mechanical phase invokes no provider, so its cost is an authoritative
      // zero rather than missing evidence. Recording that explicitly keeps the
      // pass visible as an execution step without counting it as unknown-cost
      // provider activity (#88). Envelopes written before this recover the same
      // fact through classifyEnvelopeUsage().
      await finalizeRun(
        runlog.root,
        runlog.app,
        runId,
        { status, usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0, quality: "none" } },
        clock(),
      );
    },
  };
}

function mechanicalStatus(status: Exclude<EnvelopeStatus, "running">): ExecutionStatus {
  return status === "blocked" ? "blocked" : status;
}
