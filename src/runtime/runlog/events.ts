// L2 structured events (build plan M2.6; docs/loop.md §9).
//
// Append-only events.jsonl, one JSON object per line. Correlation ids on
// every event: trace_id = turnId (one per pipeline execution), span_id per
// pass, parent_span_id linking subagent fan-out — trees reconstruct without
// opening transcripts. Every string field passes through the canonical
// secret scrubber; `tool.called` records name/duration/success and a HASH
// of the args, never the args themselves.
//
// The clock is injected (FakeClock-compatible); nothing calls Date.now().

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runPaths } from "./paths.js";
import { hashArgs, scrubSecrets } from "./redact.js";

export type RunlogEventType =
  | "run.started"
  | "run.completed"
  | "pass.started"
  | "pass.completed"
  | "pass.failed"
  | "gate.started"
  | "gate.passed"
  | "gate.failed"
  | "tool.called"
  | "subagent.started"
  | "subagent.completed"
  | "ticket.transition"
  | "verdict.recorded"
  | "escalation.raised";

export type EventSeverity = "info" | "warn" | "error";

/** Constant identity attached to every event this writer emits (§9: "plus
 *  app, ticket, pipeline, pass, role, model on everything"). */
export interface EventContext {
  trace_id: string;
  span_id: string;
  app: string;
  ticket?: string;
  pipeline: string;
  pass: string;
  role: string;
  model?: string;
}

export type EventDetail = Record<string, string | number | boolean>;

export interface RunlogEvent extends EventContext {
  ts: string;
  event: RunlogEventType;
  severity: EventSeverity;
  /** Set on subagent spans — links the fan-out back to its parent pass. */
  parent_span_id?: string;
  /** Machine code on infra failures; merit outcomes never carry one (§9). */
  error_code?: string;
  detail?: EventDetail;
}

export interface AppendOptions {
  type: RunlogEventType;
  severity?: EventSeverity;
  /** Override for subagent spans; defaults to the writer's span (the pass). */
  spanId?: string;
  parentSpanId?: string;
  errorCode?: string;
  detail?: EventDetail;
}

export interface ToolCalledOptions {
  tool: string;
  durationMs: number;
  success: boolean;
  /** Hashed before writing — raw args never reach L2 (§9). */
  args?: unknown;
  /** Optional classification tag (e.g. `environment_retry`) that rides on the
   *  event's detail — the anomaly detectors read `detail.category` (§9). A
   *  label, never args: it carries no secret material. */
  category?: string;
  spanId?: string;
  parentSpanId?: string;
}

export interface EventWriter {
  append(options: AppendOptions): Promise<RunlogEvent>;
  /** The one shape `tool.called` may take: name, duration, success,
   *  args hash. There is deliberately no way to pass raw args through. */
  toolCalled(options: ToolCalledOptions): Promise<RunlogEvent>;
}

export function createEventWriter(
  root: string,
  ctx: EventContext & { runId: string },
  clock: () => Date,
): EventWriter {
  const { runId, ...identity } = ctx;
  const path = runPaths(root, identity.app, runId).events;

  async function write(event: RunlogEvent): Promise<RunlogEvent> {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(event) + "\n", "utf8");
    return event;
  }

  return {
    append(options: AppendOptions): Promise<RunlogEvent> {
      const event: RunlogEvent = {
        ...identity,
        ts: clock().toISOString(),
        event: options.type,
        severity: options.severity ?? "info",
        ...(options.spanId !== undefined ? { span_id: options.spanId } : {}),
        ...(options.parentSpanId !== undefined ? { parent_span_id: options.parentSpanId } : {}),
        ...(options.errorCode !== undefined ? { error_code: options.errorCode } : {}),
        ...(options.detail !== undefined ? { detail: scrubDetail(options.detail) } : {}),
      };
      return write(event);
    },
    toolCalled(options: ToolCalledOptions): Promise<RunlogEvent> {
      const detail: EventDetail = {
        tool: options.tool,
        duration_ms: options.durationMs,
        success: options.success,
        ...(options.args !== undefined ? { args_hash: hashArgs(options.args) } : {}),
        ...(options.category !== undefined ? { category: options.category } : {}),
      };
      return this.append({
        type: "tool.called",
        ...(options.spanId !== undefined ? { spanId: options.spanId } : {}),
        ...(options.parentSpanId !== undefined ? { parentSpanId: options.parentSpanId } : {}),
        detail,
      });
    },
  };
}

function scrubDetail(detail: EventDetail): EventDetail {
  const out: EventDetail = {};
  for (const [key, value] of Object.entries(detail)) {
    out[key] = typeof value === "string" ? scrubSecrets(value) : value;
  }
  return out;
}

/** Stream the run's typed events. Partial-write resilience (§9 append-only
 *  reality): a malformed TRAILING line — the one a crash mid-append leaves
 *  behind — is dropped; a malformed line anywhere else is corruption and
 *  throws loudly. */
export async function readEvents(
  root: string,
  app: string,
  runId: string,
): Promise<RunlogEvent[]> {
  const path = runPaths(root, app, runId).events;
  const lines = (await readFile(path, "utf8")).split("\n").filter((l) => l !== "");
  const events: RunlogEvent[] = [];
  lines.forEach((line, i) => {
    try {
      events.push(JSON.parse(line) as RunlogEvent);
    } catch {
      if (i !== lines.length - 1) {
        throw new Error(`runlog: ${path}:${i + 1} is malformed mid-file — corruption, not a torn append`);
      }
    }
  });
  return events;
}

export interface SpanNode {
  spanId: string;
  parentSpanId?: string;
  events: RunlogEvent[];
  children: SpanNode[];
}

/** Nest subagent spans under their parent pass via parent_span_id. Spans
 *  appear in first-event order; a span whose parent is unknown is a root. */
export function reconstructSpanTree(events: RunlogEvent[]): SpanNode[] {
  const nodes = new Map<string, SpanNode>();
  for (const event of events) {
    let node = nodes.get(event.span_id);
    if (node === undefined) {
      node = { spanId: event.span_id, events: [], children: [] };
      if (event.parent_span_id !== undefined) node.parentSpanId = event.parent_span_id;
      nodes.set(event.span_id, node);
    }
    node.events.push(event);
  }

  const roots: SpanNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentSpanId !== undefined ? nodes.get(node.parentSpanId) : undefined;
    if (parent !== undefined && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
