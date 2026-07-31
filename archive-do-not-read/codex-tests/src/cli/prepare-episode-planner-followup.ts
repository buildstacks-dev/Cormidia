import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { parseDocument } from "yaml";
import { MAX_EPISODE_PLANNER_PROMPT_BYTES } from "../../../src/org/episode-planner/runtime.js";
import { CampaignBudgetStore } from "../eval-runner/campaign-budget.js";
import { loadEpisodePlannerCorpus } from "../eval-runner/episode-planner-corpus.js";
import {
  ARTIFACT_ROOT,
  HARNESS_ROOT,
  assertArtifactPath,
} from "../fixtures/controlled-world.js";
import { loadValidationPolicy } from "../policy/load.js";

const CAMPAIGN_ID = "OPERON-L4-002" as const;
const CAMPAIGN_ROOT = resolve(HARNESS_ROOT, "campaigns", CAMPAIGN_ID);
const PLAN_PATH = resolve(CAMPAIGN_ROOT, "campaign-plan.yaml");
const OVERLAY_PATH = resolve(CAMPAIGN_ROOT, "candidate-prompt-overlay.md");
const BASE_PROMPT_PATH = resolve(HARNESS_ROOT, "..", "prompts", "episode", "plan.md");
const OUTPUT_ROOT = assertArtifactPath(resolve(ARTIFACT_ROOT, "layer-4", CAMPAIGN_ID));
const OUTPUT_PATH = resolve(OUTPUT_ROOT, "preflight.json");
const LEDGER_PATH = resolve(OUTPUT_ROOT, "spend-ledger.json");
const DIAGNOSTIC_REPORT_PATH = resolve(OUTPUT_ROOT, "diagnostic-report.json");
const QUALIFICATION_REPORT_PATH = resolve(
  OUTPUT_ROOT,
  "qualification",
  "campaign-report.json",
);
const PARENT_ROOT = resolve(ARTIFACT_ROOT, "layer-4", "OPERON-L4-001");

if (process.argv.includes("--execute")) {
  throw new Error(
    `${CAMPAIGN_ID} preparation has no execution path; use the separately guarded diagnostic runner`,
  );
}

const planSource = await readFile(PLAN_PATH);
const planDocument = parseDocument(planSource.toString("utf8"), { uniqueKeys: true });
if (planDocument.errors.length > 0) {
  throw new Error(
    `follow-up campaign plan is invalid YAML: ${planDocument.errors
      .map((error) => error.message)
      .join("; ")}`,
  );
}
const plan = record(planDocument.toJS(), "campaign plan");
const authorization = record(plan["authorization"], "campaign plan authorization");
const candidatePrompt = record(plan["candidate_prompt"], "campaign plan candidate_prompt");
const corpusPlan = record(plan["corpus"], "campaign plan corpus");
const sourceEvidence = record(plan["source_evidence"], "campaign plan source_evidence");

const [basePrompt, overlay, corpus, parentAuditSource, policy] = await Promise.all([
  readFile(BASE_PROMPT_PATH),
  readFile(OVERLAY_PATH),
  loadEpisodePlannerCorpus(),
  readFile(resolve(PARENT_ROOT, "campaign-evidence-audit.json")),
  loadValidationPolicy(resolve(HARNESS_ROOT, "validation-policy.yaml")),
]);
const policyAuthorization = policy.authorizations.layer_4_episode_planner_diagnostic;
const qualificationAuthorization =
  policy.authorizations.layer_4_episode_planner_qualification;
const parentAudit = JSON.parse(parentAuditSource.toString("utf8")) as {
  campaign_id?: string;
  status?: string;
  campaign_result?: { qualified?: boolean; qualification_status?: string };
};

const evidenceChecks = await Promise.all(
  Object.entries(sourceEvidence).map(async ([id, value]) => {
    const entry = record(value, `source_evidence.${id}`);
    const relativePath = string(entry["path"], `source_evidence.${id}.path`);
    const expectedSha256 = string(
      entry["sha256"],
      `source_evidence.${id}.sha256`,
    );
    const absolutePath = assertParentEvidencePath(
      resolve(CAMPAIGN_ROOT, relativePath),
    );
    const actualSha256 = sha256(await readFile(absolutePath));
    return {
      id: `source_evidence:${id}`,
      passed: actualSha256 === expectedSha256,
      expected_sha256: expectedSha256,
      actual_sha256: actualSha256,
      path: relativePath,
    };
  }),
);

const basePromptSha256 = sha256(basePrompt);
const overlaySha256 = sha256(overlay);
const assembledCandidatePrompt = Buffer.concat([
  basePrompt,
  Buffer.from("\n\n", "utf8"),
  overlay,
]);
const assembledCandidatePromptSha256 = sha256(assembledCandidatePrompt);
const budgetStore = new CampaignBudgetStore(
  LEDGER_PATH,
  corpus.corpusSha256,
  {
    campaignId: CAMPAIGN_ID,
    aggregateCeilingUsd: 10,
    perTurnCeilingUsd: 5,
  },
);
const budgetState = existsSync(LEDGER_PATH)
  ? await budgetStore.summary()
  : {
      observedUsd: 0,
      reservedUsd: 0,
      remainingUsd: 10,
      unmeasuredTurnIds: [],
      ceilingViolations: [],
    };
const diagnosticEvidencePresent = existsSync(DIAGNOSTIC_REPORT_PATH);
const qualificationEvidencePresent = existsSync(QUALIFICATION_REPORT_PATH);
const checks = [
  {
    id: "campaign_identity",
    passed:
      plan["campaign_id"] === CAMPAIGN_ID &&
      plan["parent_campaign_id"] === "OPERON-L4-001" &&
      plan["status"] === "full_qualification_completed_blocked_quality_no_qualification",
  },
  {
    id: "execution_authorizations_content_bound",
    passed:
      authorization["provider_execution"] ===
        "human_authorized_diagnostic_and_qualification" &&
      authorization["provider_spend"] ===
        "human_authorized_diagnostic_and_qualification" &&
      policyAuthorization.id === CAMPAIGN_ID &&
      policyAuthorization.status === "human_authorized" &&
      policyAuthorization.corpus.case_id === "OPERON-EP-003" &&
      policyAuthorization.corpus.runs_per_case === 3 &&
      policyAuthorization.quality.qualification_claim === "prohibited" &&
      policyAuthorization.spend.aggregate_ceiling_usd === 10 &&
      policyAuthorization.spend.per_turn_ceiling_usd === 5 &&
      policyAuthorization.external_effects_authorized === false &&
      qualificationAuthorization.id === CAMPAIGN_ID &&
      qualificationAuthorization.stage === "qualification" &&
      qualificationAuthorization.status === "human_authorized" &&
      qualificationAuthorization.corpus.cases === 10 &&
      qualificationAuthorization.corpus.runs_per_case === 3 &&
      qualificationAuthorization.corpus.total_attempts === 30 &&
      qualificationAuthorization.spend.aggregate_ceiling_usd === 60 &&
      qualificationAuthorization.spend.per_turn_ceiling_usd === 5 &&
      qualificationAuthorization.external_effects_authorized === false,
  },
  {
    id: "protected_prompt_unchanged",
    passed:
      basePromptSha256 === candidatePrompt["base_expected_sha256"] &&
      planPath(candidatePrompt["base_path"], "candidate_prompt.base_path") ===
        BASE_PROMPT_PATH,
  },
  {
    id: "candidate_overlay_integrity",
    passed:
      overlaySha256 === candidatePrompt["overlay_expected_sha256"] &&
      overlaySha256 === policyAuthorization.candidate_prompt.overlay_sha256 &&
      planPath(candidatePrompt["overlay_path"], "candidate_prompt.overlay_path") ===
        OVERLAY_PATH,
  },
  {
    id: "assembled_candidate_prompt_within_production_limit",
    passed:
      assembledCandidatePrompt.byteLength > 0 &&
      assembledCandidatePrompt.byteLength <= MAX_EPISODE_PLANNER_PROMPT_BYTES &&
      basePromptSha256 === policyAuthorization.candidate_prompt.base_sha256 &&
      assembledCandidatePromptSha256 ===
        policyAuthorization.candidate_prompt.assembled_sha256,
  },
  {
    id: "frozen_parent_corpus_unchanged",
    passed:
      corpus.manifest.campaign_id === "OPERON-L4-001" &&
      corpus.manifest.status === "frozen" &&
      corpus.corpusSha256 === corpusPlan["corpus_sha256"] &&
      corpus.cases.length === corpusPlan["cases"],
  },
  {
    id: "parent_failure_audit_passed",
    passed:
      parentAudit.campaign_id === "OPERON-L4-001" &&
      parentAudit.status === "passed_with_attributable_original_count_defect" &&
      parentAudit.campaign_result?.qualified === false &&
      parentAudit.campaign_result.qualification_status === "blocked_contract",
  },
  {
    id: "diagnostic_budget_evidence_safe",
    passed:
      budgetState.reservedUsd === 0 &&
      budgetState.unmeasuredTurnIds.length === 0 &&
      budgetState.ceilingViolations.length === 0 &&
      budgetState.observedUsd <= 10 &&
      budgetState.remainingUsd >= 0,
  },
  ...evidenceChecks,
];
const allChecksPassed = checks.every((check) => check.passed);
const preflight = {
  schema_version: 1,
  campaign_id: CAMPAIGN_ID,
  generated_at: new Date().toISOString(),
  mode: "preparation_only",
  campaign_plan_sha256: sha256(planSource),
  protected_base_prompt_sha256: basePromptSha256,
  candidate_overlay_sha256: overlaySha256,
  assembled_candidate_prompt_sha256: assembledCandidatePromptSha256,
  assembled_candidate_prompt_bytes: assembledCandidatePrompt.byteLength,
  production_prompt_limit_bytes: MAX_EPISODE_PLANNER_PROMPT_BYTES,
  frozen_corpus_sha256: corpus.corpusSha256,
  checks,
  authorization_verified: allChecksPassed,
  execution_authorized:
    !diagnosticEvidencePresent && !qualificationEvidencePresent,
  diagnostic_evidence_present: diagnosticEvidencePresent,
  qualification_evidence_present: qualificationEvidencePresent,
  ready_to_execute:
    allChecksPassed && !diagnosticEvidencePresent && !qualificationEvidencePresent,
  provider_contacted_by_preflight: false,
  spend_incurred_by_preflight_usd: 0,
  campaign_spend: {
    observed_usd: budgetState.observedUsd,
    reserved_usd: budgetState.reservedUsd,
    remaining_usd: budgetState.remainingUsd,
  },
  production_prompt_modified: false,
  production_assignment_modified: false,
  next_decision:
    qualificationEvidencePresent
      ? "The OPERON-L4-002 authorization is consumed; decide whether to prepare a new versioned candidate or a separately bounded lane."
      : diagnosticEvidencePresent
        ? "Run only the separately authorized guarded OPERON-L4-002 qualification."
        : "Run only the guarded OPERON-L4-002 EP003 x3 diagnostic.",
};

await writeJsonAtomic(OUTPUT_PATH, preflight);
console.log(JSON.stringify(preflight, null, 2));
if (!allChecksPassed) process.exitCode = 1;

function planPath(value: unknown, label: string): string {
  return resolve(CAMPAIGN_ROOT, string(value, label));
}

function assertParentEvidencePath(path: string): string {
  const parentRelative = relative(PARENT_ROOT, path);
  if (
    parentRelative === "" ||
    parentRelative === ".." ||
    parentRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(parentRelative)
  ) {
    throw new Error(`source evidence must be a strict descendant of ${PARENT_ROOT}`);
  }
  return path;
}

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

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}
