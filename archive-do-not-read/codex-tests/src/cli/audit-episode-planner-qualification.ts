import { createHash } from "node:crypto";
import { readdir, readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { CampaignBudgetLedger } from "../eval-runner/campaign-budget.js";
import { evidenceBackedPlannerAttemptCount } from "../eval-runner/campaign-budget.js";
import { loadEpisodePlannerCorpus } from "../eval-runner/episode-planner-corpus.js";
import { qualifyEpisodePlannerCampaign } from "../eval-runner/qualification.js";
import {
  ARTIFACT_ROOT,
  HARNESS_ROOT,
  assertArtifactPath,
} from "../fixtures/controlled-world.js";
import { loadValidationPolicy } from "../policy/load.js";

const campaignArgument = argumentValue("--campaign") ?? "OPERON-L4-002";
if (
  campaignArgument !== "OPERON-L4-002" &&
  campaignArgument !== "OPERON-L4-003" &&
  campaignArgument !== "OPERON-L4-004" &&
  campaignArgument !== "OPERON-L4-005"
) {
  throw new Error(`unsupported qualification audit campaign ${campaignArgument}`);
}
const CAMPAIGN_ID = campaignArgument;
const ROOT = assertArtifactPath(
  resolve(ARTIFACT_ROOT, "layer-4", CAMPAIGN_ID, "qualification"),
);
const ATTEMPT_ROOT = resolve(ROOT, "attempts");
const WORLD_ROOT = resolve(ROOT, "worlds");
const REPORT_PATH = resolve(ROOT, "campaign-report.json");
const LEDGER_PATH = resolve(ROOT, "spend-ledger.json");
const PREFLIGHT_PATH = resolve(ROOT, "preflight.json");
const AUDIT_PATH = resolve(ROOT, "qualification-evidence-audit.json");
const POLICY_PATH = resolve(HARNESS_ROOT, "validation-policy.yaml");
const BASE_PROMPT_PATH = resolve(HARNESS_ROOT, "..", "prompts", "episode", "plan.md");
const OVERLAY_PATH = resolve(
  HARNESS_ROOT,
  "campaigns",
  CAMPAIGN_ID,
  "candidate-prompt-overlay.md",
);
const DIAGNOSTIC_REPORT_PATH = resolve(
  ARTIFACT_ROOT,
  "layer-4",
  CAMPAIGN_ID,
  "diagnostic-report.json",
);
const DIAGNOSTIC_AUDIT_PATH = resolve(
  ARTIFACT_ROOT,
  "layer-4",
  CAMPAIGN_ID,
  "diagnostic-evidence-audit.json",
);

interface AttemptEvidence {
  schema_version: 1;
  campaign_id: string;
  corpus_sha256: string;
  attempt_id: string;
  caseId: string;
  repetition: number;
  critical: boolean;
  contractPassed: boolean;
  acceptable: boolean;
  planner_attempts: number;
  budget_turns: CampaignBudgetLedger["turns"];
  quality: {
    acceptable: boolean;
    score: number;
    checks: Array<{ id: string; passed: boolean; detail: string }>;
  } | null;
  error: { name: string; message: string } | null;
}

interface QualificationReport {
  schema_version: 1;
  campaign_id: string;
  stage: string;
  assignment: { harness: string; model: string; effort: string };
  corpus_sha256: string;
  candidate_prompt_sha256: string;
  attempts_completed: number;
  attempts_required: number;
  stopped_reason: string | null;
  spend: {
    ceiling_usd: number;
    observed_usd: number;
    reserved_usd: number;
    remaining_usd: number;
    unmeasured_turn_ids: string[];
    ceiling_violations: string[];
  };
  qualification: {
    qualified: boolean;
    status: string;
    statisticalThresholdMet: boolean;
    overallAcceptable: number;
    perCaseAcceptable: Record<string, number>;
    reasons: string[];
  };
  production_assignment_preserved: boolean;
  production_roles_modified: boolean;
  protected_prompt_modified: boolean;
  candidate_overlay_applied: boolean;
  corpus_modified_during_campaign: boolean;
  external_effects_executed: boolean;
  attempts: Array<{
    attempt_id: string;
    contract_passed: boolean;
    acceptable: boolean;
    evidence: string;
  }>;
}

interface QualificationPreflight {
  schema_version: 1;
  campaign_id: string;
  mode: string;
  qualification_blockers_present_before_campaign: string[];
  external_effects_authorized: boolean;
  ready_to_execute: boolean;
}

const [
  reportSource,
  ledgerSource,
  preflightSource,
  policy,
  corpus,
  basePrompt,
  overlay,
  diagnosticReportSource,
  diagnosticAuditSource,
  attemptNames,
  worldFiles,
] = await Promise.all([
  readFile(REPORT_PATH),
  readFile(LEDGER_PATH),
  readFile(PREFLIGHT_PATH),
  loadValidationPolicy(POLICY_PATH),
  loadEpisodePlannerCorpus(),
  readFile(BASE_PROMPT_PATH),
  readFile(OVERLAY_PATH),
  readFile(DIAGNOSTIC_REPORT_PATH),
  readFile(DIAGNOSTIC_AUDIT_PATH),
  readdir(ATTEMPT_ROOT),
  walkFiles(WORLD_ROOT),
]);

const report = JSON.parse(reportSource.toString("utf8")) as QualificationReport;
const ledger = JSON.parse(ledgerSource.toString("utf8")) as CampaignBudgetLedger;
const preflight = JSON.parse(
  preflightSource.toString("utf8"),
) as QualificationPreflight;
const authorization =
  CAMPAIGN_ID === "OPERON-L4-005"
    ? policy.authorizations.layer_4_episode_planner_l4_005_qualification
    : CAMPAIGN_ID === "OPERON-L4-004"
    ? policy.authorizations.layer_4_episode_planner_l4_004_qualification
    : CAMPAIGN_ID === "OPERON-L4-003"
      ? policy.authorizations.layer_4_episode_planner_l4_003_qualification
      : policy.authorizations.layer_4_episode_planner_qualification;
const expectedAttemptIds = corpus.manifest.cases.flatMap((caseId) =>
  Array.from(
    { length: corpus.manifest.threshold.runs_per_case },
    (_, index) => `${caseId}-r${index + 1}`,
  ),
);
const actualAttemptNames = attemptNames
  .filter((name) => name.endsWith(".json"))
  .sort();
const attempts = await Promise.all(
  actualAttemptNames.map(async (name) => ({
    name,
    source: await readFile(resolve(ATTEMPT_ROOT, name)),
  })),
);
const parsedAttempts = attempts.map(({ source }) =>
  JSON.parse(source.toString("utf8")) as AttemptEvidence,
);
const assembledPrompt = Buffer.concat([
  basePrompt,
  Buffer.from("\n\n", "utf8"),
  overlay,
]);
const observedUsd = ledger.turns.reduce(
  (sum, turn) => sum + (turn.observed_usd ?? 0),
  0,
);
const reservedUsd = ledger.turns
  .filter((turn) => turn.status === "in_flight")
  .reduce((sum, turn) => sum + turn.reserved_usd, 0);
const unmeasuredTurnIds = ledger.turns
  .filter((turn) => turn.status !== "settled" || turn.observed_usd === null)
  .map((turn) => turn.id);
const ceilingViolations = ledger.turns.flatMap((turn) =>
  turn.ceiling_violation === null
    ? []
    : [`${turn.id}: ${turn.ceiling_violation}`],
);
const recomputed = qualifyEpisodePlannerCampaign(
  parsedAttempts.map((attempt) => ({
    caseId: attempt.caseId,
    repetition: attempt.repetition,
    contractPassed: attempt.contractPassed,
    acceptable: attempt.acceptable,
  })),
  {
    caseIds: corpus.manifest.cases,
    criticalCaseIds: corpus.manifest.critical_cases,
    runsPerCase: corpus.manifest.threshold.runs_per_case,
    totalAttempts: corpus.manifest.threshold.total_attempts,
    overallMinAcceptable: corpus.manifest.threshold.overall_min_acceptable,
    minAcceptablePerCase: corpus.manifest.threshold.min_acceptable_per_case,
      criticalMinAcceptablePerCase:
        corpus.manifest.threshold.critical_min_acceptable_per_case,
  },
  preflight.qualification_blockers_present_before_campaign,
);
const expectedAttemptNames = expectedAttemptIds.map((id) => `${id}.json`).sort();
const reportAttemptNames = report.attempts
  .map((attempt) => `${attempt.attempt_id}.json`)
  .sort();
const attemptIdentityPassed =
  actualAttemptNames.length === report.attempts_completed &&
  actualAttemptNames.length === reportAttemptNames.length &&
  actualAttemptNames.every((name, index) => name === reportAttemptNames[index]) &&
  actualAttemptNames.every((name) => expectedAttemptNames.includes(name)) &&
  parsedAttempts.every((attempt) => {
    const expectedId = `${attempt.caseId}-r${attempt.repetition}`;
    return (
      attempt.schema_version === 1 &&
      attempt.campaign_id === CAMPAIGN_ID &&
      attempt.corpus_sha256 === corpus.corpusSha256 &&
      attempt.attempt_id === expectedId &&
      expectedAttemptIds.includes(expectedId)
    );
  });
const attemptSemanticsPassed = parsedAttempts.every(
  (attempt) =>
    attempt.acceptable ===
      (attempt.contractPassed && attempt.quality?.acceptable === true) &&
    (attempt.contractPassed
      ? attempt.error === null && attempt.quality !== null
      : attempt.error !== null && attempt.quality === null) &&
    attempt.planner_attempts ===
      evidenceBackedPlannerAttemptCount(
        attempt.planner_attempts,
        attempt.budget_turns,
      ),
);
const ledgerBindingPassed = parsedAttempts.every((attempt) => {
  const ledgerTurns = ledger.turns.filter(
    (turn) => turn.attempt_id === attempt.attempt_id,
  );
  return (
    JSON.stringify(ledgerTurns) === JSON.stringify(attempt.budget_turns) &&
    ledgerTurns.length === attempt.planner_attempts
  );
});
const turnIds = ledger.turns.map((turn) => turn.id);
const rawOutputs = worldFiles
  .filter((path) => basename(path) === "output.md")
  .sort();
const eventFiles = worldFiles
  .filter((path) => basename(path) === "events.jsonl")
  .sort();
const eventSources = await Promise.all(eventFiles.map((path) => readFile(path, "utf8")));
const forbiddenEventLines = eventSources.flatMap((source, fileIndex) =>
  source
    .split("\n")
    .filter(
      (line) =>
        line.includes('"event":"tool.') ||
        line.includes('"event":"external_effect.') ||
        line.includes('"event":"effect.'),
    )
    .map((line) => ({ file: eventFiles[fileIndex], line })),
);
const miss = parsedAttempts.find(
  (attempt) => attempt.attempt_id === "OPERON-EP-004-r1",
);
const failedQualityChecks =
  miss?.quality?.checks.filter((check) => !check.passed) ?? [];
const contractFailure = parsedAttempts.find((attempt) => !attempt.contractPassed);
const contractFailureAttribution =
  CAMPAIGN_ID === "OPERON-L4-005"
    ? {
        passed:
          contractFailure?.attempt_id === "OPERON-EP-003-r1" &&
          contractFailure.error?.name === "EpisodePlannerFailedError" &&
          contractFailure.error.message.includes("plan_supersession_invalid") &&
          contractFailure.error.message.includes(
            "initial plan step implement-token-expiry cannot supersede prior work",
          ),
        detail:
          "EP003-r1 repair changed an invalid JavaScript-undefined optional member into illegal initial-plan self-supersession; both classes already have deterministic deposits",
      }
    : CAMPAIGN_ID === "OPERON-L4-004"
    ? {
        passed:
          contractFailure?.attempt_id === "OPERON-EP-004-r1" &&
          contractFailure.error?.name === "EpisodePlannerFailedError" &&
          contractFailure.error.message.includes("plan_supersession_invalid") &&
          contractFailure.error.message.includes(
            "initial plan step implement-fix cannot supersede prior work",
          ),
        detail:
          "EP004-r1 repair changed an invalid optional supersedes value into an illegal initial-plan self-supersession",
      }
    : {
        passed:
          contractFailure?.attempt_id === "OPERON-EP-003-r3" &&
          contractFailure.error?.name === "EpisodePlannerFailedError" &&
          contractFailure.error.message.includes("$.steps[1].gate") &&
          contractFailure.error.message.includes("received missing (required)"),
        detail: "EP003-r3 repair omitted the required gate discriminator",
      };

const checks = [
  {
    id: "report_and_authorization_identity",
    passed:
      report.schema_version === 1 &&
      report.campaign_id === CAMPAIGN_ID &&
      report.stage === "qualification" &&
      preflight.schema_version === 1 &&
      preflight.campaign_id === CAMPAIGN_ID &&
      preflight.mode === "execute" &&
      preflight.external_effects_authorized === false &&
      preflight.ready_to_execute === true &&
      authorization.id === CAMPAIGN_ID &&
      authorization.stage === "qualification" &&
      authorization.status ===
        (CAMPAIGN_ID === "OPERON-L4-002"
          ? "human_authorized"
          : "human_authorized_by_delegation"),
    detail: `report and exact human authorization identify the full ${CAMPAIGN_ID} stage`,
  },
  {
    id: "candidate_prompt_and_diagnostic_identity",
    passed:
      sha256(basePrompt) === authorization.candidate_prompt.base_sha256 &&
      sha256(overlay) === authorization.candidate_prompt.overlay_sha256 &&
      sha256(assembledPrompt) === authorization.candidate_prompt.assembled_sha256 &&
      report.candidate_prompt_sha256 === sha256(assembledPrompt) &&
      sha256(diagnosticReportSource) ===
        authorization.diagnostic_evidence.report_sha256 &&
      sha256(diagnosticAuditSource) ===
        authorization.diagnostic_evidence.audit_sha256,
    detail: "base, overlay, assembled prompt, and passed diagnostic evidence remain hash-bound",
  },
  {
    id: "frozen_corpus_and_threshold_identity",
    passed:
      report.corpus_sha256 === corpus.corpusSha256 &&
      authorization.corpus.corpus_sha256 === corpus.corpusSha256 &&
      authorization.corpus.cases === corpus.manifest.threshold.total_cases &&
      authorization.corpus.total_attempts ===
        corpus.manifest.threshold.total_attempts,
    detail: "the 10 x 3 frozen corpus and ratified floors are unchanged",
  },
  {
    id: "terminal_attempt_set_complete_and_well_formed",
    passed: attemptIdentityPassed && attemptSemanticsPassed,
    detail:
      `${parsedAttempts.length} attempt files match the terminal report; ` +
      `${expectedAttemptNames.length} were required for a completed statistical campaign`,
  },
  {
    id: "qualification_recomputes",
    passed:
      JSON.stringify(recomputed) === JSON.stringify(report.qualification) &&
      (report.qualification.qualified === false ||
        (report.attempts_completed === report.attempts_required &&
          report.qualification.status === "qualified" &&
          report.qualification.statisticalThresholdMet === true)),
    detail:
      `${report.qualification.status} recomputed from ${parsedAttempts.length} retained attempts`,
  },
  {
    id: "terminal_failure_is_attributable",
    passed:
      report.qualification.status === "qualified"
        ? contractFailure === undefined &&
          parsedAttempts.length === report.attempts_required
        : report.qualification.status === "blocked_deterministic_gate"
          ? contractFailure === undefined &&
            parsedAttempts.length === report.attempts_required &&
            report.qualification.statisticalThresholdMet === true &&
            preflight.qualification_blockers_present_before_campaign.length > 0 &&
            JSON.stringify(report.qualification.reasons) ===
              JSON.stringify(
                preflight.qualification_blockers_present_before_campaign,
              )
        : report.qualification.status === "blocked_contract"
        ? contractFailureAttribution.passed
        : report.qualification.status === "blocked_quality" &&
          miss?.contractPassed === true &&
          miss.acceptable === false &&
          failedQualityChecks.some((check) => check.id === "total_step_ceiling") &&
          failedQualityChecks.some((check) => check.id === "exact_safety_gates"),
    detail:
      report.qualification.status === "qualified"
        ? "all required attempts completed without a deterministic contract failure and the statistical floors recompute"
        : report.qualification.status === "blocked_deterministic_gate"
          ? "the statistical floors passed, but the immutable execution preflight retained unresolved deterministic product blockers"
        : report.qualification.status === "blocked_contract"
        ? contractFailureAttribution.detail
        : "EP004-r1 added a speculative release gate and exceeded the step ceiling",
  },
  {
    id: "ledger_attempt_binding",
    passed:
      ledgerBindingPassed &&
      new Set(turnIds).size === turnIds.length &&
      ledger.turns.every(
        (turn) =>
          turn.status === "settled" &&
          turn.observed_usd !== null &&
          turn.usage_quality === "complete",
      ),
    detail: `${ledger.turns.length} provider turns bind exactly to retained attempts`,
  },
  {
    id: "ledger_campaign_identity",
    passed: ledger.campaign_id === CAMPAIGN_ID,
    detail:
      `embedded ledger campaign_id is ${ledger.campaign_id}; expected ${CAMPAIGN_ID}. ` +
      (ledger.campaign_id === CAMPAIGN_ID
        ? "Explicit campaign identity is intact."
        : "The pre-fix runner silently inherited the OPERON-L4-001 default."),
  },
  {
    id: "spend_ceiling_and_report_identity",
    passed:
      ledger.aggregate_ceiling_usd ===
        authorization.spend.aggregate_ceiling_usd &&
      ledger.per_turn_ceiling_usd === authorization.spend.per_turn_ceiling_usd &&
      Math.abs(observedUsd - report.spend.observed_usd) <= 0.000001 &&
      Math.abs(reservedUsd - report.spend.reserved_usd) <= 0.000001 &&
      observedUsd <= authorization.spend.aggregate_ceiling_usd &&
      unmeasuredTurnIds.length === 0 &&
      ceilingViolations.length === 0 &&
      report.spend.unmeasured_turn_ids.length === 0 &&
      report.spend.ceiling_violations.length === 0,
    detail: `$${observedUsd.toFixed(6)} observed under the $${authorization.spend.aggregate_ceiling_usd} ceiling`,
  },
  {
    id: "no_tool_or_external_effect_events",
    passed:
      forbiddenEventLines.length === 0 &&
      report.external_effects_executed === false,
    detail: `${eventFiles.length} event logs scanned`,
  },
  {
    id: "protected_surfaces_preserved",
    passed:
      report.production_assignment_preserved === true &&
      report.production_roles_modified === false &&
      report.protected_prompt_modified === false &&
      report.corpus_modified_during_campaign === false &&
      report.candidate_overlay_applied === true,
    detail: "production prompt, roles, assignment, and frozen corpus were not modified",
  },
  {
    id: "raw_outputs_retained",
    passed: rawOutputs.length === ledger.turns.length,
    detail: `${rawOutputs.length} raw provider outputs retained for ${ledger.turns.length} turns`,
  },
];
const failedChecks = checks.filter((check) => !check.passed);
const audit = {
  schema_version: 1,
  campaign_id: CAMPAIGN_ID,
  stage: "qualification",
  generated_at: new Date().toISOString(),
  independence: {
    level: "I1",
    description:
      "Role-separated same-agent recomputation of persisted evidence; not fresh-context or organizational independence.",
    c3_limitation:
      "A separate human/team review remains required before any C3 production adoption claim.",
  },
  evidence_integrity:
    failedChecks.length === 0
      ? "passed"
      : "failed_campaign_identity_attribution",
  qualification_result: {
    qualified: report.qualification.qualified,
    status: report.qualification.status,
    statistical_threshold_met: report.qualification.statisticalThresholdMet,
    overall_acceptable: report.qualification.overallAcceptable,
    failed_case: contractFailure?.caseId ?? (
      report.qualification.perCaseAcceptable["OPERON-EP-004"] === 2
        ? "OPERON-EP-004"
        : null
    ),
    qualification_issued: report.qualification.qualified,
  },
  spend: {
    observed_usd: observedUsd,
    reserved_usd: reservedUsd,
    ceiling_usd: authorization.spend.aggregate_ceiling_usd,
    settled_turns: ledger.turns.length,
    unmeasured_turn_ids: unmeasuredTurnIds,
    ceiling_violations: ceilingViolations,
    enforcement_passed: checks.find(
      (check) => check.id === "spend_ceiling_and_report_identity",
    )?.passed === true,
  },
  attribution_defect: {
    detected: ledger.campaign_id !== CAMPAIGN_ID,
    embedded_campaign_id: ledger.campaign_id,
    expected_campaign_id: CAMPAIGN_ID,
    consequence:
      ledger.campaign_id === CAMPAIGN_ID
        ? "No campaign-attribution defect detected."
        : "The spend limits were enforced correctly, but the ledger cannot claim clean campaign identity.",
    evidence_rewritten: false,
    detector_deposit:
      "CampaignBudgetStore now requires explicit campaign authorization; no silent default remains.",
  },
  immutable_evidence: {
    report_sha256: sha256(reportSource),
    ledger_sha256: sha256(ledgerSource),
    diagnostic_report_sha256: sha256(diagnosticReportSource),
    diagnostic_audit_sha256: sha256(diagnosticAuditSource),
    execution_preflight_sha256: sha256(preflightSource),
    attempts: attempts.map(({ name, source }) => ({
      path: `./attempts/${name}`,
      sha256: sha256(source),
    })),
    raw_outputs: await Promise.all(
      rawOutputs.map(async (path) => ({
        path: `./${path.slice(ROOT.length + 1)}`,
        sha256: sha256(await readFile(path)),
      })),
    ),
  },
  checks,
};

await writeJsonAtomic(AUDIT_PATH, audit);
console.log(JSON.stringify(audit, null, 2));
if (failedChecks.length > 0) process.exitCode = 1;

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(root, entry.name);
      return entry.isDirectory() ? walkFiles(path) : [path];
    }),
  );
  return files.flat();
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
