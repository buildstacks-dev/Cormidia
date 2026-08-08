// Campaign-level output-token and equivalent-USD admission. Product budgets
// remain independently active; this guard owns the exact outer authorization.

import { readTurnRecords } from "../../../src/runtime/telemetry.js";
import type { AcceptanceCampaignConfig } from "./campaign-config.js";
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
    const scenario = config.scenarios.find((candidate) => candidate.appSlug.endsWith(`/${appName}`));
    return { outputTokens: 120_000, equivUsd: candidateCost(config, scenario?.matrix["planner"]) };
  }
  if (binary === "cormidia" && argv[0] === "run-role") {
    const assignmentFlag = argv.indexOf("--assignment");
    const candidateId = assignmentFlag === -1 ? undefined : argv[assignmentFlag + 1]?.split("@")[0];
    const candidate = config.adaptiveAssignments.find((item) => item.id === candidateId);
    return { outputTokens: 120_000, equivUsd: candidate?.conservativeEstimate ?? 50 };
  }
  if (binary === "cormidia" && argv[0] === "loop") {
    const appFlag = argv.indexOf("--app");
    const appName = appFlag === -1 ? undefined : argv[appFlag + 1];
    const scenario = config.scenarios.find((candidate) => candidate.appSlug.endsWith(`/${appName}`));
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
    const observed = this.totals(rows);
    const envelope = this.options.config.envelope;
    if (envelope === undefined) throw new CampaignSpendRefusal("campaign envelope is absent");
    if (
      observed.outputTokens + this.debitedTokens + reservation.outputTokens > envelope.maxOutputTokens ||
      observed.equivUsd + this.debitedUsd + reservation.equivUsd > envelope.maxEquivUsd
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
    const totals = this.totals(rows);
    const envelope = this.options.config.envelope;
    if (envelope === undefined) throw new CampaignSpendRefusal("campaign envelope is absent");
    return {
      maxOutputTokens: envelope.maxOutputTokens,
      maxEquivUsd: envelope.maxEquivUsd,
      observedOutputTokens: totals.outputTokens,
      observedEquivUsd: totals.equivUsd,
      debitedUnknownOutputTokens: this.debitedTokens,
      debitedUnknownEquivUsd: this.debitedUsd,
      ceilingExhausted:
        totals.outputTokens + this.debitedTokens >= envelope.maxOutputTokens ||
        totals.equivUsd + this.debitedUsd >= envelope.maxEquivUsd,
      reservationRefusals: [...this.refusals],
    };
  }

  private totals(rows: Awaited<ReturnType<typeof readTurnRecords>>): { outputTokens: number; equivUsd: number } {
    return {
      outputTokens: rows.reduce((sum, row) => sum + row.tokensOut, 0),
      equivUsd: rows.reduce((sum, row) => sum + (row.equivalentCostUsd ?? row.costUsd), 0),
    };
  }
}
