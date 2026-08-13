import type { CliProgressMode } from "./cli-progress-args.js";
import type { GovernedTurnProgressIdentity } from "./turn-observer.js";

export type ProgressState =
  | "started"
  | "phase"
  | "still_active"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "suspended"
  | "awaiting_approval";

export interface ProgressRow {
  schema_version: 1;
  kind: "cli-progress";
  ts: string;
  command: string;
  scope: string;
  invocation_id: string;
  log_ref: string;
  phase: string;
  state: ProgressState;
  elapsed_ms: number;
  identity?: GovernedTurnProgressIdentity;
  usage?: {
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    equivalent_cost_usd?: number;
    quality?: string;
  };
  error_code?: string;
  next_action?: string;
  artifact_ref?: string;
}

export function renderProgress(mode: CliProgressMode, row: ProgressRow, write: (line: string) => void): void {
  if (mode === "off") return;
  try {
    if (mode === "jsonl") {
      write(`${JSON.stringify(row)}\n`);
      return;
    }
    const identity = row.identity;
    const assignment = identity?.assignment;
    const ordinal = identity === undefined ? "" : ` ${identity.ordinal}/${identity.total ?? "?"}`;
    const role = identity === undefined ? "" : ` ${identity.role}`;
    const resume = identity === undefined ? "" : ` resume=${identity.resumed ? "resumed" : "fresh"}`;
    const tuple = assignment === undefined ? "" : ` ${assignment.harness}/${assignment.model}@${assignment.effort}`;
    const ids = identity === undefined ? "" : ` episode=${identity.episodeId} run=${identity.runId}`;
    const usage =
      row.usage === undefined
        ? ""
        : ` tokens=${row.usage.tokens_in}/${row.usage.tokens_out} cost=$${row.usage.cost_usd.toFixed(4)}`;
    const error = row.error_code === undefined ? "" : ` [${row.error_code}]`;
    const next = row.next_action === undefined ? "" : ` next=${row.next_action}`;
    const artifact = row.artifact_ref === undefined ? "" : ` artifact=${row.artifact_ref}`;
    write(
      `[${row.ts}] ${row.command} ${row.state}: ${row.phase} scope=${row.scope} invocation=${row.invocation_id}` +
        `${ordinal}${role}${tuple}${resume}${ids} +${(row.elapsed_ms / 1_000).toFixed(1)}s${usage}${error}` +
        `${artifact}${next} log=${row.log_ref}\n`,
    );
  } catch {}
}
