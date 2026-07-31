import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseDocument } from "yaml";
import { MAX_EPISODE_PLANNER_PROMPT_BYTES } from "../../../src/org/episode-planner/runtime.js";
import { loadEpisodePlannerCorpus } from "../eval-runner/episode-planner-corpus.js";
import {
  ARTIFACT_ROOT,
  HARNESS_ROOT,
  assertArtifactPath,
} from "../fixtures/controlled-world.js";
import { loadValidationPolicy } from "../policy/load.js";

const campaignArgument = argumentValue("--campaign") ?? "OPERON-L4-003";
if (
  campaignArgument !== "OPERON-L4-003" &&
  campaignArgument !== "OPERON-L4-004" &&
  campaignArgument !== "OPERON-L4-005"
) {
  throw new Error(`unsupported follow-up preparation ${campaignArgument}`);
}
const CAMPAIGN_ID = campaignArgument;
const PREPARATION_CONFIG =
  CAMPAIGN_ID === "OPERON-L4-005"
    ? {
        parentCampaignId: "OPERON-L4-004" as const,
        caseId: "OPERON-EP-004" as const,
        planStatus: "full_qualification_completed_blocked_contract_no_qualification" as const,
        parentQualificationStatus: "blocked_contract" as const,
        parentEvidenceIntegrity: "passed" as const,
        parentFailedCase: "OPERON-EP-004" as const,
      }
    : CAMPAIGN_ID === "OPERON-L4-004"
    ? {
        parentCampaignId: "OPERON-L4-003" as const,
        caseId: "OPERON-EP-003" as const,
        planStatus: "full_qualification_completed_blocked_contract_no_qualification" as const,
        parentQualificationStatus: "blocked_contract" as const,
        parentEvidenceIntegrity: "passed" as const,
        parentFailedCase: "OPERON-EP-003" as const,
      }
    : {
        parentCampaignId: "OPERON-L4-002" as const,
        caseId: "OPERON-EP-004" as const,
        planStatus: "full_qualification_completed_blocked_contract_no_qualification" as const,
        parentQualificationStatus: "blocked_quality" as const,
        parentEvidenceIntegrity: "failed_campaign_identity_attribution" as const,
        parentFailedCase: "OPERON-EP-004" as const,
      };
const CAMPAIGN_ROOT = resolve(HARNESS_ROOT, "campaigns", CAMPAIGN_ID);
const PLAN_PATH = resolve(CAMPAIGN_ROOT, "campaign-plan.yaml");
const OVERLAY_PATH = resolve(CAMPAIGN_ROOT, "candidate-prompt-overlay.md");
const BASE_PROMPT_PATH = resolve(HARNESS_ROOT, "..", "prompts", "episode", "plan.md");
const OUTPUT_ROOT = assertArtifactPath(resolve(ARTIFACT_ROOT, "layer-4", CAMPAIGN_ID));
const OUTPUT_PATH = resolve(OUTPUT_ROOT, "preflight.json");
const DIAGNOSTIC_REPORT_PATH = resolve(OUTPUT_ROOT, "diagnostic-report.json");

if (process.argv.includes("--execute")) {
  throw new Error(
    `${CAMPAIGN_ID} preparation has no execution path; use the guarded diagnostic runner`,
  );
}

const [
  planSource,
  basePrompt,
  overlay,
  corpus,
  policySource,
  policy,
] = await Promise.all([
  readFile(PLAN_PATH),
  readFile(BASE_PROMPT_PATH),
  readFile(OVERLAY_PATH),
  loadEpisodePlannerCorpus(),
  readFile(resolve(HARNESS_ROOT, "validation-policy.yaml")),
  loadValidationPolicy(resolve(HARNESS_ROOT, "validation-policy.yaml")),
]);
const document = parseDocument(planSource.toString("utf8"), { uniqueKeys: true });
if (document.errors.length > 0) {
  throw new Error(
    `campaign plan is invalid YAML: ${document.errors.map((error) => error.message).join("; ")}`,
  );
}
const plan = record(document.toJS(), "campaign plan");
const authorization = record(plan["authorization"], "campaign plan authorization");
const candidate = record(plan["candidate_prompt"], "campaign plan candidate_prompt");
const corpusPlan = record(plan["corpus"], "campaign plan corpus");
const stages = record(plan["stages"], "campaign plan stages");
const diagnostic = record(stages["diagnostic"], "campaign plan diagnostic");
const spend = record(diagnostic["spend"], "campaign plan diagnostic spend");
const sourceEvidence = record(plan["source_evidence"], "campaign plan source_evidence");
const policyAuthorization =
  CAMPAIGN_ID === "OPERON-L4-005"
    ? policy.authorizations.layer_4_episode_planner_l4_005_diagnostic
    : CAMPAIGN_ID === "OPERON-L4-004"
    ? policy.authorizations.layer_4_episode_planner_l4_004_diagnostic
    : policy.authorizations.layer_4_episode_planner_l4_003_diagnostic;

const assembled = Buffer.concat([basePrompt, Buffer.from("\n\n", "utf8"), overlay]);
const evidenceChecks = await Promise.all(
  Object.entries(sourceEvidence).map(async ([id, value]) => {
    const entry = record(value, `source_evidence.${id}`);
    const relativePath = string(entry["path"], `source_evidence.${id}.path`);
    const expected = digest(entry["sha256"], `source_evidence.${id}.sha256`);
    const absolutePath = assertArtifactPath(resolve(CAMPAIGN_ROOT, relativePath));
    const actual = sha256(await readFile(absolutePath));
    return {
      id: `source_evidence:${id}`,
      passed: actual === expected,
      path: relativePath,
      expected_sha256: expected,
      actual_sha256: actual,
    };
  }),
);

const parentReport = JSON.parse(
  await readFile(
    assertArtifactPath(
      resolve(
        CAMPAIGN_ROOT,
        string(
          record(
            sourceEvidence["parent_campaign_report"],
            "source_evidence.parent_campaign_report",
          )["path"],
          "source_evidence.parent_campaign_report.path",
        ),
      ),
    ),
    "utf8",
  ),
) as {
  campaign_id?: string;
  stage?: string;
  qualification?: {
    status?: string;
    qualified?: boolean;
    perCaseAcceptable?: Record<string, number>;
  };
  attempts_completed?: number;
  stopped_reason?: string | null;
};
const parentAudit = JSON.parse(
  await readFile(
    assertArtifactPath(
      resolve(
        CAMPAIGN_ROOT,
        string(
          record(
            sourceEvidence["parent_campaign_audit"],
            "source_evidence.parent_campaign_audit",
          )["path"],
          "source_evidence.parent_campaign_audit.path",
        ),
      ),
    ),
    "utf8",
  ),
) as {
  campaign_id?: string;
  evidence_integrity?: string;
  qualification_result?: {
    status?: string;
    qualified?: boolean;
    failed_case?: string;
  };
};

const checks = [
  {
    id: "campaign_identity",
    passed:
      plan["campaign_id"] === CAMPAIGN_ID &&
      plan["parent_campaign_id"] === PREPARATION_CONFIG.parentCampaignId &&
      plan["status"] === PREPARATION_CONFIG.planStatus,
  },
  {
    id: "delegated_authorization_content_bound",
    passed:
      authorization["budget_decision_owner"] === "codex_delegated_by_human" &&
      authorization["provider_execution"] === "human_authorized_diagnostic_only" &&
      authorization["provider_spend"] === "human_authorized_diagnostic_only" &&
      policyAuthorization.id === CAMPAIGN_ID &&
      policyAuthorization.status === "human_authorized_by_delegation" &&
      policyAuthorization.corpus.case_id === PREPARATION_CONFIG.caseId &&
      policyAuthorization.corpus.runs_per_case === 3 &&
      policyAuthorization.spend.aggregate_ceiling_usd === 10 &&
      policyAuthorization.spend.per_turn_ceiling_usd === 5 &&
      policyAuthorization.external_effects_authorized === false,
  },
  {
    id: "candidate_prompt_identity",
    passed:
      sha256(basePrompt) === candidate["base_expected_sha256"] &&
      sha256(overlay) === candidate["overlay_expected_sha256"] &&
      sha256(assembled) === candidate["assembled_expected_sha256"] &&
      sha256(basePrompt) === policyAuthorization.candidate_prompt.base_sha256 &&
      sha256(overlay) === policyAuthorization.candidate_prompt.overlay_sha256 &&
      sha256(assembled) === policyAuthorization.candidate_prompt.assembled_sha256 &&
      assembled.byteLength <= MAX_EPISODE_PLANNER_PROMPT_BYTES,
  },
  {
    id: "frozen_corpus_identity",
    passed:
      corpus.manifest.campaign_id === "OPERON-L4-001" &&
      corpus.manifest.status === "frozen" &&
      corpus.corpusSha256 === corpusPlan["corpus_sha256"] &&
      corpus.cases.length === corpusPlan["cases"],
  },
  {
    id: "diagnostic_stage_identity",
    passed:
      Array.isArray(diagnostic["case_ids"]) &&
      diagnostic["case_ids"].length === 1 &&
      diagnostic["case_ids"][0] === PREPARATION_CONFIG.caseId &&
      diagnostic["runs_per_case"] === 3 &&
      diagnostic["qualification_claim"] === "prohibited" &&
      spend["status"] === "human_authorized_by_delegation" &&
      spend["aggregate_ceiling_usd"] === 10 &&
      spend["per_turn_ceiling_usd"] === 5 &&
      spend["stop_before_exceeding"] === true,
  },
  {
    id: "parent_failure_attributable",
    passed:
      parentReport.campaign_id === PREPARATION_CONFIG.parentCampaignId &&
      parentReport.stage === "qualification" &&
      parentReport.qualification?.status ===
        PREPARATION_CONFIG.parentQualificationStatus &&
      parentReport.qualification.qualified === false &&
      (CAMPAIGN_ID === "OPERON-L4-005"
        ? parentReport.attempts_completed === 10 &&
          parentReport.stopped_reason?.includes("OPERON-EP-004-r1") === true
        : CAMPAIGN_ID === "OPERON-L4-004"
        ? parentReport.attempts_completed === 9 &&
          parentReport.stopped_reason?.includes("OPERON-EP-003-r3") === true
        : parentReport.qualification.perCaseAcceptable?.["OPERON-EP-004"] === 2) &&
      parentAudit.campaign_id === PREPARATION_CONFIG.parentCampaignId &&
      parentAudit.evidence_integrity ===
        PREPARATION_CONFIG.parentEvidenceIntegrity &&
      parentAudit.qualification_result?.status ===
        PREPARATION_CONFIG.parentQualificationStatus &&
      parentAudit.qualification_result.qualified === false &&
      parentAudit.qualification_result.failed_case ===
        PREPARATION_CONFIG.parentFailedCase,
  },
  ...evidenceChecks,
];
const allChecksPassed = checks.every((check) => check.passed);
const diagnosticEvidencePresent = existsSync(DIAGNOSTIC_REPORT_PATH);
const preflight = {
  schema_version: 1,
  campaign_id: CAMPAIGN_ID,
  generated_at: new Date().toISOString(),
  mode: "preparation_only",
  policy_sha256: sha256(policySource),
  campaign_plan_sha256: sha256(planSource),
  protected_base_prompt_sha256: sha256(basePrompt),
  candidate_overlay_sha256: sha256(overlay),
  assembled_candidate_prompt_sha256: sha256(assembled),
  assembled_candidate_prompt_bytes: assembled.byteLength,
  production_prompt_limit_bytes: MAX_EPISODE_PLANNER_PROMPT_BYTES,
  frozen_corpus_sha256: corpus.corpusSha256,
  checks,
  authorization_verified: allChecksPassed,
  execution_authorized: allChecksPassed && !diagnosticEvidencePresent,
  diagnostic_evidence_present: diagnosticEvidencePresent,
  ready_to_execute: allChecksPassed && !diagnosticEvidencePresent,
  provider_contacted_by_preflight: false,
  spend_incurred_by_preflight_usd: 0,
  production_prompt_modified: false,
  production_assignment_modified: false,
  external_effects_executed: false,
  next_decision: diagnosticEvidencePresent
    ? "The diagnostic authorization is consumed; audit retained evidence before any full stage."
    : `Run only the guarded ${CAMPAIGN_ID} ${PREPARATION_CONFIG.caseId} x3 diagnostic.`,
};

await writeJsonAtomic(OUTPUT_PATH, preflight);
console.log(JSON.stringify(preflight, null, 2));
if (!allChecksPassed) process.exitCode = 1;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  const candidate = string(value, label);
  if (!/^[a-f0-9]{64}$/.test(candidate)) {
    throw new TypeError(`${label} must be a SHA-256 digest`);
  }
  return candidate;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
