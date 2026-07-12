// Runlog context for the loop's ticket state machine (docs/loop.md §7, §9).
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
  const ticketPart = runlog.ticket !== undefined ? { ticket: runlog.ticket } : {};

  await startRun(
    runlog.root,
    {
      runId,
      traceId: runlog.traceId,
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
      await finalizeRun(runlog.root, runlog.app, runId, { status }, clock());
    },
  };
}
