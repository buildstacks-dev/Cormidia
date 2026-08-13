import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CliProgressMode } from "./cli-progress-args.js";
import { renderProgress, type ProgressRow, type ProgressState } from "./cli-progress-render.js";
import { scrubSecrets } from "./runlog/redact.js";
import type { GovernedTurnProgressIdentity, GovernedTurnTerminal, TurnObserver } from "./turn-observer.js";
import type { TurnEvent, TurnProgress, TurnUsage } from "./types.js";

export { extractProgressArgs } from "./cli-progress-args.js";
export type { CliProgressMode, ExtractedProgressArgs } from "./cli-progress-args.js";

interface SafeUsage {
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  equivalent_cost_usd?: number;
  quality?: string;
}

export interface CliProgressReporter {
  readonly relativeLogRef: string;
  observer: TurnObserver;
  phase(phase: string, state?: Extract<ProgressState, "started" | "phase" | "still_active">): void;
  terminal(
    state: Extract<
      ProgressState,
      "completed" | "failed" | "cancelled" | "interrupted" | "suspended" | "awaiting_approval"
    >,
    options?: { nextAction?: string; artifactRef?: string },
  ): void;
  dispose(): void;
}

interface ReporterOptions {
  stateHome: string;
  command: string;
  scope: string;
  invocationId?: string;
  mode: CliProgressMode;
  now?: () => Date;
  heartbeatMs?: number;
  writeStderr?: (line: string) => void;
}

const DEFAULT_HEARTBEAT_MS = 30_000;
const ACTIVITY_THROTTLE_MS = 250;
const DUPLICATE_ACTIVITY_MS = 1_000;

export function createCliProgressReporter(options: ReporterOptions): CliProgressReporter {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const invocationId = options.invocationId ?? invocationIdentity(options.command, startedAt);
  const relativeLogRef = join("cli-progress", safeSegment(options.command), `${safeSegment(invocationId)}.jsonl`);
  const logPath = join(options.stateHome, relativeLogRef);
  const stderr =
    options.writeStderr ??
    ((line: string): void => {
      process.stderr.write(line);
    });
  let activeIdentity: GovernedTurnProgressIdentity | undefined;
  let terminal = false;
  let lastHeartbeatAt = 0;
  let lastActivityAt: number | undefined;
  let lastActivityKey = "";
  const startedTurns = new Set<string>();
  const terminalTurns = new Set<string>();

  const admitsActivity = (key: string): boolean => {
    const at = now().getTime();
    const elapsed = lastActivityAt === undefined ? Number.POSITIVE_INFINITY : at - lastActivityAt;
    if (elapsed < ACTIVITY_THROTTLE_MS || (key === lastActivityKey && elapsed < DUPLICATE_ACTIVITY_MS)) return false;
    lastActivityAt = at;
    lastActivityKey = key;
    return true;
  };

  const emit = (input: {
    phase: string;
    state: ProgressState;
    identity?: GovernedTurnProgressIdentity;
    usage?: TurnUsage;
    errorCode?: string;
    nextAction?: string;
    artifactRef?: string;
  }): void => {
    const at = now();
    const row: ProgressRow = {
      schema_version: 1,
      kind: "cli-progress",
      ts: at.toISOString(),
      command: controlled(options.command),
      scope: controlled(options.scope),
      invocation_id: controlled(invocationId),
      log_ref: relativeLogRef,
      phase: controlled(input.phase),
      state: input.state,
      elapsed_ms: Math.max(0, at.getTime() - startedAt.getTime()),
      ...(input.identity === undefined ? {} : { identity: safeIdentity(input.identity) }),
      ...(input.usage === undefined ? {} : { usage: safeUsage(input.usage) }),
      ...(input.errorCode === undefined ? {} : { error_code: controlled(input.errorCode) }),
      ...(input.nextAction === undefined ? {} : { next_action: controlled(input.nextAction) }),
      ...(input.artifactRef === undefined ? {} : { artifact_ref: controlled(input.artifactRef) }),
    };
    appendLog(logPath, row);
    renderProgress(options.mode, row, stderr);
  };

  const heartbeat = setInterval(() => {
    if (terminal) return;
    const at = now().getTime();
    if (at - lastHeartbeatAt < Math.floor((options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS) * 0.8)) return;
    lastHeartbeatAt = at;
    emit({ phase: activeIdentity?.pass ?? "command", state: "still_active", ...withIdentity(activeIdentity) });
  }, options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
  heartbeat.unref?.();

  const observer: TurnObserver = {
    onEvent: (event: TurnEvent): void => {
      if (!admitsActivity(`event:${event.type}`)) return;
      emit({ phase: `provider-${event.type}`, state: "phase", ...withIdentity(activeIdentity) });
    },
    onProgress: (progress: TurnProgress): void => {
      if (!admitsActivity("usage")) return;
      emit({
        phase: activeIdentity?.pass ?? "provider",
        state: "phase",
        ...withIdentity(activeIdentity),
        ...(progress.usage === undefined ? {} : { usage: progress.usage }),
      });
    },
    onTurnStarted: (identity): void => {
      const key = turnKey(identity);
      if (startedTurns.has(key)) return;
      startedTurns.add(key);
      activeIdentity = safeIdentity(identity);
      emit({ phase: identity.pass, state: "started", identity });
    },
    onHeartbeat: (identity): void => {
      activeIdentity = safeIdentity(identity);
      const at = now().getTime();
      if (at - lastHeartbeatAt < Math.floor((options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS) * 0.8)) return;
      lastHeartbeatAt = at;
      emit({ phase: identity.pass, state: "still_active", identity });
    },
    onTurnTerminal: (turn: GovernedTurnTerminal): void => {
      const key = turnKey(turn);
      if (terminalTurns.has(key)) return;
      terminalTurns.add(key);
      activeIdentity = undefined;
      emit({
        phase: turn.pass,
        state: terminalState(turn.status),
        identity: turn,
        usage: turn.usage,
        ...(turn.errorCode === undefined ? {} : { errorCode: turn.errorCode }),
      });
    },
  };

  return {
    relativeLogRef,
    observer,
    phase(phase, state = "phase"): void {
      emit({ phase, state, ...withIdentity(activeIdentity) });
    },
    terminal(state, terminalOptions = {}): void {
      if (terminal) return;
      terminal = true;
      clearInterval(heartbeat);
      emit({
        phase: "command",
        state,
        ...withIdentity(activeIdentity),
        ...(terminalOptions.nextAction === undefined ? {} : { nextAction: terminalOptions.nextAction }),
        ...(terminalOptions.artifactRef === undefined ? {} : { artifactRef: terminalOptions.artifactRef }),
      });
    },
    dispose(): void {
      clearInterval(heartbeat);
    },
  };
}

function appendLog(path: string, row: ProgressRow): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Durable run envelopes/journals remain execution authority.
  }
}

function safeIdentity(identity: GovernedTurnProgressIdentity): GovernedTurnProgressIdentity {
  return {
    at: controlled(identity.at),
    episodeId: controlled(identity.episodeId),
    runId: controlled(identity.runId),
    pipeline: controlled(identity.pipeline),
    pass: controlled(identity.pass),
    role: controlled(identity.role),
    assignment: {
      harness: identity.assignment.harness,
      model: controlled(identity.assignment.model),
      effort: identity.assignment.effort,
    },
    ordinal: identity.ordinal,
    total: identity.total,
    resumed: identity.resumed,
  };
}

function safeUsage(usage: TurnUsage): SafeUsage {
  return {
    tokens_in: usage.tokensIn,
    tokens_out: usage.tokensOut,
    cost_usd: usage.costUsd,
    ...(usage.equivalentCostUsd === undefined ? {} : { equivalent_cost_usd: usage.equivalentCostUsd }),
    ...(usage.quality === undefined ? {} : { quality: usage.quality }),
  };
}

function turnKey(identity: GovernedTurnProgressIdentity): string {
  return `${identity.episodeId}\u0000${identity.runId}\u0000${identity.pass}\u0000${identity.ordinal}`;
}

function terminalState(status: GovernedTurnTerminal["status"]): ProgressState {
  if (status === "blocked_on_gate") return "awaiting_approval";
  return status;
}

function controlled(value: string): string {
  return scrubSecrets(value.replace(/[\r\n\u001b]/g, " ").slice(0, 512));
}

function withIdentity(identity: GovernedTurnProgressIdentity | undefined): {
  identity?: GovernedTurnProgressIdentity;
} {
  return identity === undefined ? {} : { identity };
}

function invocationIdentity(command: string, now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 17);
  return `${safeSegment(command)}-${stamp}-${process.pid}`;
}

function safeSegment(value: string): string {
  const safe = value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return safe === "" ? "command" : safe;
}
