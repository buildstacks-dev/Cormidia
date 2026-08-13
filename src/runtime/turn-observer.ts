import type { TerminalTurnStatus, TurnAssignment, TurnEvent, TurnProgress, TurnUsage } from "./types.js";

/** Safe orchestration identity emitted only after durable turn admission. */
export interface GovernedTurnProgressIdentity {
  at: string;
  episodeId: string;
  runId: string;
  pipeline: string;
  pass: string;
  role: string;
  assignment: TurnAssignment;
  ordinal: number;
  total: number | null;
  resumed: boolean;
}

export interface GovernedTurnTerminal extends GovernedTurnProgressIdentity {
  status: TerminalTurnStatus;
  errorCode?: string;
  usage: TurnUsage;
}

export interface TurnObserver {
  onEvent?: (event: TurnEvent) => void;
  onProgress?: (progress: TurnProgress) => void;
  onTurnStarted?: (identity: GovernedTurnProgressIdentity) => void;
  onHeartbeat?: (identity: GovernedTurnProgressIdentity) => void;
  onTurnTerminal?: (terminal: GovernedTurnTerminal) => void;
}

/** Observability can never change governed execution or settlement. */
export function notifyObserver(callback: () => void): void {
  try {
    callback();
  } catch {}
}

export function recordObservedEvent(observer: TurnObserver | undefined, events: TurnEvent[], event: TurnEvent): void {
  events.push(event);
  notifyObserver(() => observer?.onEvent?.(event));
}
