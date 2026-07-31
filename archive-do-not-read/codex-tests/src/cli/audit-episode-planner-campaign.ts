import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CampaignBudgetLedger } from "../eval-runner/campaign-budget.js";
import { evidenceBackedPlannerAttemptCount } from "../eval-runner/campaign-budget.js";
import { ARTIFACT_ROOT, assertArtifactPath } from "../fixtures/controlled-world.js";

const root = assertArtifactPath(resolve(ARTIFACT_ROOT, "layer-4", "OPERON-L4-001"));
const campaignReportPath = resolve(root, "campaign-report.json");
const ledgerPath = resolve(root, "spend-ledger.json");
const failedAttemptPath = resolve(root, "attempts", "OPERON-EP-003-r3.json");
const qualityAttemptPath = resolve(root, "attempts", "OPERON-EP-003-r1.json");
const outputPath = resolve(root, "campaign-evidence-audit.json");

const [
  campaignReportSource,
  ledgerSource,
  failedAttemptSource,
  qualityAttemptSource,
] = await Promise.all([
  readFile(campaignReportPath),
  readFile(ledgerPath),
  readFile(failedAttemptPath),
  readFile(qualityAttemptPath),
]);
const report = JSON.parse(campaignReportSource.toString("utf8")) as {
  qualification: { status: string; qualified: boolean };
  attempts_completed: number;
  spend: {
    observed_usd: number;
    reserved_usd: number;
    ceiling_violations: string[];
  };
};
const ledger = JSON.parse(ledgerSource.toString("utf8")) as CampaignBudgetLedger;
const failedAttempt = JSON.parse(failedAttemptSource.toString("utf8")) as {
  planner_attempts: number;
  budget_turns: CampaignBudgetLedger["turns"];
  error: { name: string; message: string } | null;
};
const qualityAttempt = JSON.parse(qualityAttemptSource.toString("utf8")) as {
  quality: {
    acceptable: boolean;
    checks: Array<{ id: string; passed: boolean; detail: string }>;
  } | null;
};

const observedUsd = ledger.turns.reduce(
  (sum, turn) => sum + (turn.observed_usd ?? 0),
  0,
);
const inFlight = ledger.turns.filter((turn) => turn.status === "in_flight");
const violations = ledger.turns.flatMap((turn) =>
  turn.ceiling_violation === null ? [] : [`${turn.id}: ${turn.ceiling_violation}`],
);
const correctedPlannerAttempts = evidenceBackedPlannerAttemptCount(
  failedAttempt.planner_attempts,
  failedAttempt.budget_turns,
);
const failedQualityChecks = qualityAttempt.quality?.checks.filter((check) => !check.passed) ?? [];
const checks = [
  {
    id: "campaign_stopped_on_contract_failure",
    passed:
      report.qualification.status === "blocked_contract" &&
      report.qualification.qualified === false &&
      report.attempts_completed === 9,
  },
  {
    id: "ledger_fully_settled",
    passed: inFlight.length === 0,
  },
  {
    id: "spend_matches_report",
    passed: Math.abs(observedUsd - report.spend.observed_usd) <= 0.000001,
  },
  {
    id: "no_spend_ceiling_violation",
    passed:
      violations.length === 0 &&
      report.spend.ceiling_violations.length === 0 &&
      observedUsd <= ledger.aggregate_ceiling_usd,
  },
  {
    id: "failed_attempt_budget_evidence_complete",
    passed:
      failedAttempt.budget_turns.length === 2 &&
      failedAttempt.budget_turns.every(
        (turn) =>
          turn.status === "settled" &&
          turn.observed_usd !== null &&
          turn.usage_quality === "complete",
      ),
  },
  {
    id: "quality_failure_is_oracle_attributable",
    passed:
      qualityAttempt.quality?.acceptable === false &&
      failedQualityChecks.some(
        (check) =>
          check.id === "required_provider:reviewer:review/security" &&
          check.passed === false,
      ),
  },
];
const audit = {
  schema_version: 1,
  campaign_id: "OPERON-L4-001",
  generated_at: new Date().toISOString(),
  status: checks.every((check) => check.passed)
    ? "passed_with_attributable_original_count_defect"
    : "failed_evidence_integrity",
  original_evidence: {
    campaign_report_sha256: sha256(campaignReportSource),
    spend_ledger_sha256: sha256(ledgerSource),
    failed_attempt_sha256: sha256(failedAttemptSource),
    quality_attempt_sha256: sha256(qualityAttemptSource),
    rewritten: false,
  },
  correction: {
    field: "attempts/OPERON-EP-003-r3.json#planner_attempts",
    original: failedAttempt.planner_attempts,
    corrected: correctedPlannerAttempts,
    authoritative_evidence: failedAttempt.budget_turns.map((turn) => turn.id),
    reason:
      "The original runner assigned PreparedEpisodePlan.plannerAttempts only on success. " +
      "Two settled provider-turn records are authoritative for the failed bounded attempt.",
  },
  campaign_result: {
    qualification_status: report.qualification.status,
    qualified: report.qualification.qualified,
    attempts_completed: report.attempts_completed,
    observed_usd: observedUsd,
    aggregate_ceiling_usd: ledger.aggregate_ceiling_usd,
  },
  failure_classification: {
    quality_failure: {
      attempt_id: "OPERON-EP-003-r1",
      failed_checks: failedQualityChecks,
    },
    contract_failure: {
      attempt_id: "OPERON-EP-003-r3",
      error: failedAttempt.error,
      provider_turns: failedAttempt.budget_turns.map((turn) => ({
        id: turn.id,
        observed_usd: turn.observed_usd,
        terminal_status: turn.terminal_status,
        usage_quality: turn.usage_quality,
      })),
    },
  },
  checks,
};

await writeJsonAtomic(outputPath, audit);
console.log(JSON.stringify(audit, null, 2));
if (!checks.every((check) => check.passed)) process.exitCode = 1;

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
