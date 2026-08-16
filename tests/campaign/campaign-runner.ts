// Shared durable runner for opt-in L3/L4/L5 campaigns. It persists partial
// evidence around every explicitly authorized injected case callback.

import { createHash } from "node:crypto";
import { toErrorMessage as errorMessage } from "../../src/runtime/error-message.js";
import { writeValidationCampaignReport } from "../../src/org/validation-campaign.js";
import { createValidationCampaignReport } from "../../src/org/validation-campaign-claim.js";
import type {
  ValidationCampaignReportV2,
  ValidationDecisionStatus,
  ValidationLane,
} from "../../src/org/validation-campaign-report.js";
import type { CampaignRepositoryRevalidator } from "./repository-revalidation.js";

export interface CampaignRunnerOptions {
  stateHome: string;
  campaignId: string;
  lane: ValidationLane;
  campaignKind: string;
  trigger: string;
  policyBinding: ValidationCampaignReportV2["policy"];
  revalidateAdmission: CampaignRepositoryRevalidator;
  commit: string;
  apps: string[];
  scopes: string[];
  tuples: string[];
  requiredCaseIds: string[];
  maxProviderTurns: number;
  maxEquivUsd: number;
  decisionStatus: ValidationDecisionStatus;
  clock?: () => Date;
  profile?: ValidationCampaignReportV2["profile"];
}

export interface CampaignCaseResult {
  /** False means the callback returned trustworthy partial evidence but did
   * not complete this required case. Exact usage/evidence is retained, the
   * case remains missing, and independent cases may continue. */
  caseComplete?: boolean;
  providerTurns: number;
  equivUsd: number;
  violationIds?: string[];
  reasonCodes?: string[];
  evidenceRefs: string[];
}

export class DurableCampaignRunner {
  private readonly clock: () => Date;
  private readonly options: CampaignRunnerOptions;
  private reportValue: ValidationCampaignReportV2 | undefined;
  private reservationRefused = false;

  constructor(options: CampaignRunnerOptions) {
    if (
      new Set(options.requiredCaseIds).size !== options.requiredCaseIds.length ||
      options.requiredCaseIds.length === 0
    ) {
      throw new Error("campaign runner requires a non-empty unique case walk");
    }
    this.options = options;
    this.clock = options.clock ?? (() => new Date());
  }

  report(): ValidationCampaignReportV2 {
    if (this.reportValue === undefined) throw new Error("campaign runner has not started");
    return structuredClone(this.reportValue);
  }

  async start(): Promise<ValidationCampaignReportV2> {
    if (this.reportValue !== undefined) throw new Error("campaign runner already started");
    const started = this.clock().toISOString();
    this.reportValue = {
      schema_version: 2,
      campaign_id: this.options.campaignId,
      lane: this.options.lane,
      campaign_kind: this.options.campaignKind,
      trigger: this.options.trigger,
      status: "running",
      started_at: started,
      finished_at: null,
      policy: structuredClone(this.options.policyBinding),
      target: {
        commit: this.options.commit,
        apps: [...this.options.apps],
        scopes: [...this.options.scopes],
        tuples: [...this.options.tuples],
      },
      spend: {
        max_provider_turns: this.options.maxProviderTurns,
        max_equiv_usd: this.options.maxEquivUsd,
        observed_provider_turns: 0,
        observed_equiv_usd: 0,
        ceiling_exhausted: this.options.maxProviderTurns === 0 || this.options.maxEquivUsd === 0,
      },
      coverage: {
        required_case_ids: [...this.options.requiredCaseIds],
        collected_case_ids: [],
        missing_case_ids: [...this.options.requiredCaseIds],
      },
      outcome: {
        completeness: "incomplete",
        verdict: "inconclusive",
        decision_status: this.options.decisionStatus,
        violation_ids: [],
        reason_codes: ["campaign_running"],
      },
      evidence_refs: [],
      ...(this.options.profile === undefined ? {} : { profile: structuredClone(this.options.profile) }),
    };
    await this.options.revalidateAdmission();
    await createValidationCampaignReport(this.options.stateHome, this.reportValue);
    return this.report();
  }

  /** Execute one case only when its worst-case reservation fits the remaining
   * campaign envelope. The reservation is intentionally conservative; unused
   * allowance is released when the result is recorded. */
  async runCase(
    caseId: string,
    reservation: { providerTurns: number; maxEquivUsd: number },
    execute: () => Promise<CampaignCaseResult>,
  ): Promise<CampaignCaseResult | undefined> {
    const report = this.mutableReport();
    if (!report.coverage.required_case_ids.includes(caseId))
      throw new Error(`campaign case ${caseId} is not in the required walk`);
    if (report.coverage.collected_case_ids.includes(caseId))
      throw new Error(`campaign case ${caseId} was already collected`);
    assertSpend(reservation.providerTurns, reservation.maxEquivUsd, `case ${caseId} reservation`);
    if (
      report.spend.observed_provider_turns + reservation.providerTurns > report.spend.max_provider_turns ||
      report.spend.observed_equiv_usd + reservation.maxEquivUsd > report.spend.max_equiv_usd
    ) {
      this.reservationRefused = true;
      report.outcome.reason_codes = unique([...report.outcome.reason_codes, "spend_reservation_refused"]);
      await this.persist();
      return undefined;
    }
    await this.options.revalidateAdmission();
    let result: CampaignCaseResult;
    try {
      result = await execute();
      assertSpend(result.providerTurns, result.equivUsd, `case ${caseId} result`);
      if (result.providerTurns > reservation.providerTurns || result.equivUsd > reservation.maxEquivUsd) {
        throw new Error(`case ${caseId} exceeded its reserved spend envelope`);
      }
    } catch (error) {
      // The callback may have spent before throwing. With no trustworthy
      // result, debit the full pre-authorized reservation. This deliberately
      // sacrifices unused allowance rather than let an unknown partial call
      // disappear and make the hard human-ratified ceiling exceedable.
      report.spend.observed_provider_turns += reservation.providerTurns;
      report.spend.observed_equiv_usd = money(report.spend.observed_equiv_usd + reservation.maxEquivUsd);
      this.recomputeCeiling();
      report.outcome.reason_codes = unique([
        ...report.outcome.reason_codes.filter((code) => code !== "campaign_running"),
        `case_execution_error:${caseId}`,
        `spend_reservation_debited_on_error:${caseId}`,
      ]);
      const fingerprint = createHash("sha256").update(errorMessage(error)).digest("hex");
      report.evidence_refs = unique([...report.evidence_refs, `error:${caseId}:sha256:${fingerprint}`]);
      this.recomputeOutcome(false);
      await this.persist();
      throw error;
    }
    report.spend.observed_provider_turns += result.providerTurns;
    report.spend.observed_equiv_usd = money(report.spend.observed_equiv_usd + result.equivUsd);
    this.recomputeCeiling();
    if (result.caseComplete !== false) report.coverage.collected_case_ids.push(caseId);
    report.coverage.missing_case_ids = report.coverage.required_case_ids.filter(
      (required) => !report.coverage.collected_case_ids.includes(required),
    );
    report.outcome.violation_ids = unique([...report.outcome.violation_ids, ...(result.violationIds ?? [])]);
    report.outcome.reason_codes = unique([
      ...report.outcome.reason_codes.filter((code) => code !== "campaign_running"),
      ...(result.caseComplete === false ? [`case_incomplete:${caseId}`] : []),
      ...(result.reasonCodes ?? []),
    ]);
    report.evidence_refs = unique([...report.evidence_refs, ...result.evidenceRefs]);
    this.recomputeOutcome(false);
    await this.persist();
    return result;
  }

  async finish(): Promise<ValidationCampaignReportV2> {
    const report = this.mutableReport();
    report.outcome.reason_codes = report.outcome.reason_codes.filter((code) => code !== "campaign_running");
    if (this.reservationRefused)
      report.outcome.reason_codes = unique([...report.outcome.reason_codes, "spend_reservation_refused"]);
    this.recomputeOutcome(true);
    report.status = "completed";
    report.finished_at = this.clock().toISOString();
    await this.persist();
    return this.report();
  }

  async noteIncomplete(reasonCode: string): Promise<void> {
    const report = this.mutableReport();
    report.outcome.reason_codes = unique([
      ...report.outcome.reason_codes.filter((code) => code !== "campaign_running"),
      reasonCode,
    ]);
    this.recomputeOutcome(false);
    await this.persist();
  }

  private recomputeOutcome(terminal: boolean): void {
    const report = this.mutableReport();
    const fullCoverage = report.coverage.missing_case_ids.length === 0;
    if (report.spend.ceiling_exhausted) {
      report.outcome.reason_codes = unique([...report.outcome.reason_codes, "spend_ceiling_exhausted"]);
    }
    report.outcome.completeness =
      terminal && fullCoverage && !this.reservationRefused && !report.spend.ceiling_exhausted
        ? "complete"
        : "incomplete";
    if (report.outcome.violation_ids.length > 0) report.outcome.verdict = "fail";
    else if (report.outcome.completeness === "incomplete" || report.outcome.decision_status === "proposed") {
      report.outcome.verdict = "inconclusive";
    } else report.outcome.verdict = "pass";
  }

  private recomputeCeiling(): void {
    const report = this.mutableReport();
    report.spend.ceiling_exhausted =
      report.spend.observed_provider_turns >= report.spend.max_provider_turns ||
      report.spend.observed_equiv_usd >= report.spend.max_equiv_usd;
  }

  private mutableReport(): ValidationCampaignReportV2 {
    if (this.reportValue === undefined) throw new Error("campaign runner has not started");
    if (this.reportValue.status === "completed") throw new Error("campaign runner already completed");
    return this.reportValue;
  }

  private async persist(): Promise<void> {
    if (this.reportValue === undefined) throw new Error("campaign runner has not started");
    await this.options.revalidateAdmission();
    await writeValidationCampaignReport(this.options.stateHome, this.reportValue);
  }
}

/** Turn a durable campaign verdict into the process-level gate result. The
 * report is persisted first by `finish()`; this assertion then prevents a
 * green test process from masking a complete-but-failing or incomplete run. */
export function assertCompletedCampaignPass(
  report: Pick<ValidationCampaignReportV2, "campaign_id" | "status" | "outcome">,
): void {
  if (report.status === "completed" && report.outcome.completeness === "complete" && report.outcome.verdict === "pass")
    return;
  throw new Error(
    `validation campaign ${report.campaign_id} did not pass: ` +
      `status=${report.status} completeness=${report.outcome.completeness} ` +
      `verdict=${report.outcome.verdict} violations=${report.outcome.violation_ids.join(",") || "none"} ` +
      `reasons=${report.outcome.reason_codes.join(",") || "none"}`,
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
function assertSpend(providerTurns: number, equivUsd: number, name: string): void {
  if (!Number.isInteger(providerTurns) || providerTurns < 0)
    throw new Error(`${name} providerTurns must be a non-negative integer`);
  if (!Number.isFinite(equivUsd) || equivUsd < 0)
    throw new Error(`${name} equivUsd must be a non-negative finite number`);
}
