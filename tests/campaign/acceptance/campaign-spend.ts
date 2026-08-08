// Campaign-level output-token and equivalent-USD admission. Product budgets
// remain independently active; this guard owns the exact outer authorization.

import { readTurnRecords } from "../../../src/runtime/telemetry.js";
import type { TurnRecord } from "../../../src/runtime/telemetry.js";
import { scenarioAppName, type AcceptanceCampaignConfig } from "./campaign-config.js";
import type { InvocationAdmission, InvocationRequest } from "./cli-admission.js";
import type { CampaignBinary, RecordedInvocation } from "./cli-driver.js";

export interface SpendReservation {
  outputTokens: number;
  equivUsd: number;
}

export interface CampaignSpendSnapshot {
  maxOutputTokens: number;
  maxEquivUsd: number;
  observedOutputTokens: number;
  observedEquivUsd: number;
  debitedUnknownOutputTokens: number;
  debitedUnknownEquivUsd: number;
  ceilingExhausted: boolean;
  reservationRefusals: string[];
}

export class CampaignSpendRefusal extends Error {
  constructor(message: string) {
    super(`campaign spend refused: ${message}`);
    this.name = "CampaignSpendRefusal";
  }
}

function candidateCost(config: AcceptanceCampaignConfig, assignment: unknown): number {
  const encoded = JSON.stringify(assignment);
  return (
    config.adaptiveAssignments.find((candidate) => JSON.stringify(candidate.assignment) === encoded)
      ?.conservativeEstimate ?? 50
  );
}

function fixedGraderAssignment(
  config: AcceptanceCampaignConfig,
  argv: readonly string[],
): AcceptanceCampaignConfig["graderPlan"][number]["grader"] {
  const turnFlag = argv.indexOf("--turn");
  const turnId = turnFlag === -1 ? undefined : argv[turnFlag + 1];
  if (turnId === undefined) return undefined;
  for (const scenario of config.scenarios) {
    const prefix = `grade-${scenario.id}-`;
    if (!turnId.startsWith(prefix)) continue;
    const axis = turnId.slice(prefix.length);
    return config.graderPlan.find(
      (entry) =>
        entry.axis === axis &&
        (entry.scenarioIds === undefined || entry.scenarioIds.includes(scenario.id)) &&
        (entry.scenarioKinds === undefined || entry.scenarioKinds.includes(scenario.kind)),
    )?.grader;
  }
  return undefined;
}

/** Conservative per-command reservation. Unused allowance is released after
 * settlement; an unobservable failed command is debited in full. */
export function campaignReservation(
  config: AcceptanceCampaignConfig,
  binary: CampaignBinary,
  argv: readonly string[],
): SpendReservation {
  if (binary === "cormidia-job" && argv[0] === "run") {
    const job = config.scenarios.find((scenario) => scenario.kind === "job");
    const turns = Object.values(job?.matrix ?? {}).filter((assignment) => assignment !== undefined);
    return {
      outputTokens: Math.max(1, turns.length) * 120_000,
      equivUsd: turns.reduce((sum, assignment) => sum + candidateCost(config, assignment), 0),
    };
  }
  if (binary === "cormidia" && argv[0] === "plan" && argv.includes("--auto")) {
    const appName = argv[1];
    const scenario = config.scenarios.find((candidate) => scenarioAppName(candidate) === appName);
    return { outputTokens: 120_000, equivUsd: candidateCost(config, scenario?.matrix["planner"]) };
  }
  if (binary === "cormidia" && argv[0] === "run-role") {
    return { outputTokens: 120_000, equivUsd: candidateCost(config, fixedGraderAssignment(config, argv)) };
  }
  if (binary === "cormidia" && argv[0] === "loop") {
    const appFlag = argv.indexOf("--app");
    const appName = appFlag === -1 ? undefined : argv[appFlag + 1];
    const scenario = config.scenarios.find((candidate) => scenarioAppName(candidate) === appName);
    const producer = candidateCost(config, scenario?.matrix["builder"]);
    const reviewer = candidateCost(config, scenario?.matrix["reviewer"]);
    return { outputTokens: 600_000, equivUsd: 2 * (producer + reviewer) };
  }
  return { outputTokens: 0, equivUsd: 0 };
}

export interface CampaignSpendGuardOptions {
  stateHome: string;
  config: AcceptanceCampaignConfig;
}

export class CampaignSpendGuard implements InvocationAdmission {
  private readonly pending = new Map<string, { reservation: SpendReservation; beforeRows: number }>();
  private debitedTokens = 0;
  private debitedUsd = 0;
  private readonly refusals: string[] = [];

  constructor(private readonly options: CampaignSpendGuardOptions) {}

  async before(request: InvocationRequest): Promise<void> {
    const reservation = campaignReservation(this.options.config, request.binary, request.argv);
    const rows = await readTurnRecords(this.options.stateHome);
    const accounted = this.accounted(rows);
    const envelope = this.options.config.envelope;
    if (envelope === undefined) throw new CampaignSpendRefusal("campaign envelope is absent");
    if (
      accounted.observed.outputTokens + accounted.unknown.outputTokens + this.debitedTokens + reservation.outputTokens >
        envelope.maxOutputTokens ||
      accounted.observed.equivUsd + accounted.unknown.equivUsd + this.debitedUsd + reservation.equivUsd >
        envelope.maxEquivUsd
    ) {
      const reason =
        `${request.binary} ${request.argv.join(" ")} reservation ` +
        `${reservation.outputTokens} output tokens / $${reservation.equivUsd} does not fit remaining envelope`;
      this.refusals.push(reason);
      throw new CampaignSpendRefusal(reason);
    }
    this.pending.set(request.id, { reservation, beforeRows: rows.length });
  }

  async after(request: InvocationRequest, invocation: RecordedInvocation): Promise<void> {
    const pending = this.pending.get(request.id);
    this.pending.delete(request.id);
    if (pending === undefined || invocation.exitCode === 0 || pending.reservation.outputTokens === 0) return;
    const rows = await readTurnRecords(this.options.stateHome);
    if (rows.length > pending.beforeRows) return;
    this.debitedTokens += pending.reservation.outputTokens;
    this.debitedUsd += pending.reservation.equivUsd;
  }

  async snapshot(): Promise<CampaignSpendSnapshot> {
    const rows = await readTurnRecords(this.options.stateHome);
    const accounted = this.accounted(rows);
    const debitedUnknownOutputTokens = this.debitedTokens + accounted.unknown.outputTokens;
    const debitedUnknownEquivUsd = this.debitedUsd + accounted.unknown.equivUsd;
    const envelope = this.options.config.envelope;
    if (envelope === undefined) throw new CampaignSpendRefusal("campaign envelope is absent");
    return {
      maxOutputTokens: envelope.maxOutputTokens,
      maxEquivUsd: envelope.maxEquivUsd,
      observedOutputTokens: accounted.observed.outputTokens,
      observedEquivUsd: accounted.observed.equivUsd,
      debitedUnknownOutputTokens,
      debitedUnknownEquivUsd,
      ceilingExhausted:
        accounted.observed.outputTokens + debitedUnknownOutputTokens >= envelope.maxOutputTokens ||
        accounted.observed.equivUsd + debitedUnknownEquivUsd >= envelope.maxEquivUsd,
      reservationRefusals: [...this.refusals],
    };
  }

  private accounted(rows: TurnRecord[]): {
    observed: { outputTokens: number; equivUsd: number };
    unknown: { outputTokens: number; equivUsd: number };
  } {
    const known = rows.filter((row) => row.usageQuality !== "unavailable");
    const unknown = rows.filter((row) => row.usageQuality === "unavailable");
    return {
      observed: {
        outputTokens: known.reduce((sum, row) => sum + row.tokensOut, 0),
        equivUsd: known.reduce((sum, row) => sum + (row.equivalentCostUsd ?? row.costUsd), 0),
      },
      unknown: {
        outputTokens: unknown.length * 120_000,
        equivUsd: unknown.reduce(
          (sum, row) =>
            sum +
            candidateCost(this.options.config, {
              harness: row.runtime,
              model: row.model,
              ...(row.effort === undefined ? {} : { effort: row.effort }),
            }),
          0,
        ),
      },
    };
  }
}
