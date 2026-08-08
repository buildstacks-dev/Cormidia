// campaign/acceptance/campaign-lifecycle.ts — CF-SM-ACC, the campaign state
// machine (CORMIDIA-INV-ACC-4; CORMIDIA-C-B27-001 §4).
//
// `authorized → provisioned → plan-arm → plan-gated → build-arm → graded →
// reported`, with two typed terminals: `stopped-at-gate` and `incomplete`.
//
// The load-bearing transition is build-arm entry. It is ILLEGAL without a
// durable gate resolution, and a resolution written after the first build turn
// is a violation rather than an ordering detail — the whole point of the gate
// is that it spends a fraction of the envelope before deciding. A campaign that
// stops at the gate is a SUCCESSFUL campaign: complete for the plan arm,
// incomplete for the build arm, never rendered as a failure.
//
// Config and scenario hashes are immutable once spend starts, so a resume binds
// the same config content and refuses drift rather than resuming into a
// different graph.

export type CampaignState =
  | "authorized"
  | "provisioned"
  | "plan-arm"
  | "plan-gated"
  | "build-arm"
  | "graded"
  | "reported"
  | "stopped-at-gate"
  | "incomplete";

export type LifecycleCode =
  | "illegal-transition"
  | "build-arm-without-gate"
  | "gate-resolution-after-build-spend"
  | "config-hash-drift"
  | "already-terminal";

export class CampaignLifecycleError extends Error {
  constructor(
    readonly code: LifecycleCode,
    message: string,
  ) {
    super(`campaign lifecycle refused (${code}): ${message}`);
    this.name = "CampaignLifecycleError";
  }
}

const LEGAL: Record<CampaignState, readonly CampaignState[]> = {
  authorized: ["provisioned", "incomplete"],
  provisioned: ["plan-arm", "incomplete"],
  "plan-arm": ["plan-gated", "incomplete"],
  "plan-gated": ["build-arm", "stopped-at-gate", "incomplete"],
  "build-arm": ["graded", "incomplete"],
  graded: ["reported", "incomplete"],
  reported: [],
  "stopped-at-gate": ["reported"],
  incomplete: ["reported"],
};

/** A durable record of how the gate resolved and what it acted on. */
export interface PlanGateResolution {
  scenarioId: string;
  resolvedBy: "human" | "declared-policy";
  decision: "continue" | "stop";
  /** The plan scores the resolution acted on — recorded, never re-derived. */
  scores: Record<string, number | "ungraded">;
  reason: string;
}

export interface CampaignLifecycleOptions {
  configHash: string;
  scenarioId: string;
}

/**
 * One scenario's lifecycle. Deliberately a small state object rather than a
 * flag soup: "did the gate resolve before the first build turn" must be
 * answerable from one place, or the ordering rule becomes a convention.
 */
export class CampaignLifecycle {
  private stateValue: CampaignState = "authorized";
  private gateResolution: PlanGateResolution | undefined;
  private buildArmTurns = 0;
  readonly history: CampaignState[] = ["authorized"];

  constructor(private readonly options: CampaignLifecycleOptions) {}

  state(): CampaignState {
    return this.stateValue;
  }

  resolution(): PlanGateResolution | undefined {
    return this.gateResolution === undefined ? undefined : structuredClone(this.gateResolution);
  }

  buildArmSpendCount(): number {
    return this.buildArmTurns;
  }

  transition(next: CampaignState): void {
    if (this.stateValue === "reported") {
      throw new CampaignLifecycleError("already-terminal", `${this.options.scenarioId} is already reported`);
    }
    if (!LEGAL[this.stateValue].includes(next)) {
      throw new CampaignLifecycleError(
        "illegal-transition",
        `${this.options.scenarioId}: ${this.stateValue} → ${next} is not a legal transition`,
      );
    }
    if (next === "build-arm" && this.gateResolution === undefined) {
      throw new CampaignLifecycleError(
        "build-arm-without-gate",
        `${this.options.scenarioId}: the build arm may not begin without a durable plan-gate resolution`,
      );
    }
    if (next === "build-arm" && this.gateResolution?.decision !== "continue") {
      throw new CampaignLifecycleError(
        "build-arm-without-gate",
        `${this.options.scenarioId}: the gate resolved to stop; the build arm is unreachable`,
      );
    }
    this.stateValue = next;
    this.history.push(next);
  }

  /** Write the gate resolution. Must precede any build-arm spend. */
  recordGateResolution(resolution: PlanGateResolution): void {
    if (this.buildArmTurns > 0) {
      throw new CampaignLifecycleError(
        "gate-resolution-after-build-spend",
        `${this.options.scenarioId}: ${this.buildArmTurns} build turn(s) already spent; a gate resolution written ` +
          `afterwards is a violation, not an ordering detail`,
      );
    }
    this.gateResolution = structuredClone(resolution);
  }

  /** Called for every build-arm provider turn, before it spends. */
  noteBuildArmSpend(): void {
    if (this.gateResolution === undefined || this.stateValue !== "build-arm") {
      throw new CampaignLifecycleError(
        "build-arm-without-gate",
        `${this.options.scenarioId}: build-arm spend attempted in state ${this.stateValue} with ` +
          `${this.gateResolution === undefined ? "no" : "a"} gate resolution`,
      );
    }
    this.buildArmTurns += 1;
  }

  /**
   * Resume binds the same config content hash. A config changed under a live
   * campaign refuses and NAMES the drift rather than resuming; and resume
   * re-enters at the gate, never past it.
   */
  resumeAt(configHash: string): CampaignState {
    if (configHash !== this.options.configHash) {
      throw new CampaignLifecycleError(
        "config-hash-drift",
        `${this.options.scenarioId}: campaign was authorized against config ${this.options.configHash.slice(0, 12)} ` +
          `but resumed against ${configHash.slice(0, 12)}`,
      );
    }
    if (this.stateValue === "build-arm" && this.gateResolution === undefined) {
      this.stateValue = "plan-gated";
      this.history.push("plan-gated");
    }
    return this.stateValue;
  }
}
