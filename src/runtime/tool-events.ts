// The ONE tool_use TurnEvent builder every adapter emits through (issue #27),
// mirroring secret-patterns.ts: a single environment-command list so the
// `environment_retry` classification can never drift between adapters.
//
// The L2 bridge (src/loop/pipeline.ts flushBridgedEvents) turns these into
// runlog `tool.called` events and envelope `tool_counts`; the anomaly
// detectors (src/runtime/runlog/anomalies.ts) read both: `bash_heavy` fires
// on tool_counts["bash"] >= 20, `environment_retry` on >= 3 events tagged
// with the category below. Adapters emit only for tool calls that will
// actually execute (gate-allowed) — denied attempts are escalations, not
// tool activity.

import type { ToolAction, TurnEvent } from "./types.js";

/** Environment-setup and wait commands — the docker/install/wait-loop
 *  signal. Matching is per command; the >= 3 threshold lives in the
 *  detector, so one legitimate `pnpm install` never flags a run. */
const ENVIRONMENT_COMMAND =
  /(?:^|[;&|]\s*)(?:sudo\s+)?(?:docker(?:-compose)?(?:\s+compose)?|podman|apt(?:-get)?|yum|dnf|brew|pip3?|npm|pnpm|yarn|corepack)\s+(?:install|ci|add|enable|restart|start|stop|up|pull|build)\b|(?:^|[;&|]\s*)(?:sleep\s+\d|wait-for)/;

export function environmentCategory(action: ToolAction): "environment_retry" | undefined {
  const command = commandOf(action);
  if (command === undefined) return undefined;
  return ENVIRONMENT_COMMAND.test(command) ? "environment_retry" : undefined;
}

function commandOf(action: ToolAction): string | undefined {
  if (typeof action.input !== "object" || action.input === null) return undefined;
  const command = (action.input as Record<string, unknown>)["command"];
  return typeof command === "string" ? command : undefined;
}

/** Build the L2-bridgeable tool_use event for a gate-allowed tool action.
 *  `detail` feeds the live session.log only; the bridge reads
 *  name/args/category/success/durationMs, and args are hashed at the L2
 *  boundary — never persisted raw. Outcome fields are set only when the
 *  adapter's native stream reports them (e.g. Codex item exit codes);
 *  pre-execution emission (Claude's PreToolUse) omits them. */
export function toolUseEvent(action: ToolAction, outcome: { success?: boolean; durationMs?: number } = {}): TurnEvent {
  const category = environmentCategory(action);
  const command = commandOf(action);
  return {
    type: "tool_use",
    name: action.tool,
    detail: command !== undefined && command.length > 0 ? `${action.tool}: ${command}` : action.tool,
    args: action.input,
    ...(category !== undefined ? { category } : {}),
    ...(outcome.success !== undefined ? { success: outcome.success } : {}),
    ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {}),
  };
}
