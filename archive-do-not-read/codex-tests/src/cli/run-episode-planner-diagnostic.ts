import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseDocument } from "yaml";
import type { EpisodePlan, JsonValue } from "../../../src/loop/episode-plan.js";
import { stableHash } from "../../../src/loop/episode-plan.js";
import type { PlannerAdmissionLimits } from "../../../src/loop/planner-admission.js";
import type { AppEntry } from "../../../src/org/apps.js";
import {
  buildEpisodeIntent,
  createEpisodePlanningPolicy,
} from "../../../src/org/episode-planner/policy.js";
import { prepareEpisodePlanWithRuntime } from "../../../src/org/episode-planner/runtime.js";
import { ClaudeRuntime } from "../../../src/runtime/adapters/claude.js";
import type { RoleConfig } from "../../../src/runtime/types.js";
import {
  CampaignBudgetStore,
  EnforcedCampaignBudgetRuntime,
  evidenceBackedPlannerAttemptCount,
  type CampaignBudgetTurn,
} from "../eval-runner/campaign-budget.js";
import { evaluateEpisodePlannerDiagnostic } from "../eval-runner/diagnostic.js";
import {
  loadEpisodePlannerCorpus,
  scoreEpisodePlan,
  type EpisodePlannerGoldenCase,
  type EpisodePlannerQualityScore,
} from "../eval-runner/episode-planner-corpus.js";
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
  throw new Error(`unsupported diagnostic campaign ${campaignArgument}`);
}
const CAMPAIGN_ID = campaignArgument;
const DIAGNOSTIC_CONFIG =
  CAMPAIGN_ID === "OPERON-L4-005"
    ? {
        caseId: "OPERON-EP-004" as const,
        parentCampaignId: "OPERON-L4-004" as const,
        authorizationStatus: "human_authorized_by_delegation" as const,
        planStatus: "diagnostic_delegated_authorized" as const,
        planSpendStatus: "human_authorized_by_delegation" as const,
      }
    : CAMPAIGN_ID === "OPERON-L4-004"
    ? {
        caseId: "OPERON-EP-003" as const,
        parentCampaignId: "OPERON-L4-003" as const,
        authorizationStatus: "human_authorized_by_delegation" as const,
        planStatus: "diagnostic_delegated_authorized" as const,
        planSpendStatus: "human_authorized_by_delegation" as const,
      }
    : CAMPAIGN_ID === "OPERON-L4-003"
    ? {
        caseId: "OPERON-EP-004" as const,
        parentCampaignId: "OPERON-L4-002" as const,
        authorizationStatus: "human_authorized_by_delegation" as const,
        planStatus: "diagnostic_delegated_authorized" as const,
        planSpendStatus: "human_authorized_by_delegation" as const,
      }
    : {
        caseId: "OPERON-EP-003" as const,
        parentCampaignId: "OPERON-L4-001" as const,
        authorizationStatus: "human_authorized" as const,
        planStatus: "full_qualification_completed_blocked_quality_no_qualification" as const,
        planSpendStatus: "human_authorized" as const,
      };
const CASE_ID = DIAGNOSTIC_CONFIG.caseId;
const RUNS = 3 as const;
const AGGREGATE_CEILING_USD = 10 as const;
const PER_TURN_CEILING_USD = 5 as const;
const OUTPUT_ROOT = assertArtifactPath(resolve(ARTIFACT_ROOT, "layer-4", CAMPAIGN_ID));
const ATTEMPT_ROOT = resolve(OUTPUT_ROOT, "attempts");
const WORLD_ROOT = resolve(OUTPUT_ROOT, "worlds");
const LEDGER_PATH = resolve(OUTPUT_ROOT, "spend-ledger.json");
const REPORT_PATH = resolve(OUTPUT_ROOT, "diagnostic-report.json");
const EXECUTION_PREFLIGHT_PATH = resolve(OUTPUT_ROOT, "execution-preflight.json");
const POLICY_PATH = resolve(HARNESS_ROOT, "validation-policy.yaml");
const CAMPAIGN_PLAN_PATH = resolve(
  HARNESS_ROOT,
  "campaigns",
  CAMPAIGN_ID,
  "campaign-plan.yaml",
);
const BASE_PROMPT_PATH = resolve(HARNESS_ROOT, "..", "prompts", "episode", "plan.md");
const OVERLAY_PATH = resolve(
  HARNESS_ROOT,
  "campaigns",
  CAMPAIGN_ID,
  "candidate-prompt-overlay.md",
);
const PREPARATION_PREFLIGHT_PATH = resolve(OUTPUT_ROOT, "preflight.json");
const LOCAL_MANIFEST_PATH = resolve(ARTIFACT_ROOT, "local-validation", "manifest.json");
const PROVIDER_OPERATIONS = [
  "build/implement",
  "data/migrate",
  "deploy/release",
  "docs/update",
  "ops/investigate",
  "plan/analyze",
  "plan/clarify",
  "review/security",
  "review/verify",
] as const;
const MECHANICAL_GATES = [
  "data-integrity",
  "performance",
  "release",
  "rollback",
  "rollout",
  "security",
] as const;
const OPERATION_CATALOG = [
  { operation: "build/implement", role: "builder", purpose: "produce the bounded implementation artifact" },
  { operation: "data/migrate", role: "builder", purpose: "implement the bounded reversible data migration" },
  { operation: "deploy/release", role: "sre", purpose: "execute the already-gated configured release" },
  { operation: "docs/update", role: "builder", purpose: "make the bounded documentation-only update" },
  { operation: "ops/investigate", role: "sre", purpose: "perform read-only incident investigation and report" },
  { operation: "plan/analyze", role: "planner", purpose: "produce bounded analysis needed by downstream implementation" },
  { operation: "plan/clarify", role: "planner", purpose: "produce a clarification artifact without implementation" },
  { operation: "review/security", role: "reviewer", purpose: "independently review the security-sensitive artifact" },
  { operation: "review/verify", role: "reviewer", purpose: "independently verify the implementation artifact" },
] as const satisfies readonly Record<string, JsonValue>[];

interface ProviderAuthStatus {
  ready: boolean;
  method: "api_key_env" | "claude_cli" | "none";
  detail: string;
}

interface DiagnosticAttemptReport {
  schema_version: 1;
  campaign_id: typeof CAMPAIGN_ID;
  corpus_sha256: string;
  candidate_prompt_sha256: string;
  attempt_id: string;
  caseId: typeof CASE_ID;
  repetition: number;
  title: string;
  critical: true;
  started_at: string;
  finished_at: string;
  contractPassed: boolean;
  acceptable: boolean;
  plan: EpisodePlan | null;
  quality: EpisodePlannerQualityScore | null;
  planner_attempts: number;
  budget_turns: CampaignBudgetTurn[];
  error: { name: string; message: string; stack?: string } | null;
}

const execute = process.argv.includes("--execute");
const authorization = argumentValue("--authorization");
if (!execute || authorization !== CAMPAIGN_ID) {
  throw new Error(
    `provider execution requires --execute --authorization ${CAMPAIGN_ID}; no other mode or authorization is accepted`,
  );
}
if (existsSync(REPORT_PATH)) {
  throw new Error(
    `${CAMPAIGN_ID} already has terminal diagnostic evidence; it cannot be silently rerun`,
  );
}

const [
  policy,
  corpus,
  policySource,
  campaignPlanSource,
  basePrompt,
  overlay,
  preparationPreflightSource,
] = await Promise.all([
  loadValidationPolicy(POLICY_PATH),
  loadEpisodePlannerCorpus(),
  readFile(POLICY_PATH),
  readFile(CAMPAIGN_PLAN_PATH),
  readFile(BASE_PROMPT_PATH),
  readFile(OVERLAY_PATH),
  readFile(PREPARATION_PREFLIGHT_PATH),
]);
const policyAuthorization =
  CAMPAIGN_ID === "OPERON-L4-005"
    ? policy.authorizations.layer_4_episode_planner_l4_005_diagnostic
    : CAMPAIGN_ID === "OPERON-L4-004"
    ? policy.authorizations.layer_4_episode_planner_l4_004_diagnostic
    : CAMPAIGN_ID === "OPERON-L4-003"
    ? policy.authorizations.layer_4_episode_planner_l4_003_diagnostic
    : policy.authorizations.layer_4_episode_planner_diagnostic;
const goldenCase = corpus.cases.find((entry) => entry.case_id === CASE_ID);
if (goldenCase === undefined || !goldenCase.critical) {
  throw new Error(`frozen corpus does not contain critical case ${CASE_ID}`);
}
const candidatePrompt = Buffer.concat([
  basePrompt,
  Buffer.from("\n\n", "utf8"),
  overlay,
]);
const candidatePromptSha256 = sha256(candidatePrompt);
assertPolicyAuthorization(
  policyAuthorization,
  corpus.corpusSha256,
  sha256(basePrompt),
  sha256(overlay),
  candidatePromptSha256,
);
assertCampaignPlan(campaignPlanSource);
validateCaseConfiguration(goldenCase, corpus.corpusSha256);
const preparationPreflight = JSON.parse(preparationPreflightSource.toString("utf8")) as {
  authorization_verified?: boolean;
  execution_authorized?: boolean;
  ready_to_execute?: boolean;
  protected_base_prompt_sha256?: string;
  candidate_overlay_sha256?: string;
  assembled_candidate_prompt_sha256?: string;
  frozen_corpus_sha256?: string;
};
if (
  preparationPreflight.authorization_verified !== true ||
  preparationPreflight.execution_authorized !== true ||
  preparationPreflight.ready_to_execute !== true ||
  preparationPreflight.protected_base_prompt_sha256 !== sha256(basePrompt) ||
  preparationPreflight.candidate_overlay_sha256 !== sha256(overlay) ||
  preparationPreflight.assembled_candidate_prompt_sha256 !== candidatePromptSha256 ||
  preparationPreflight.frozen_corpus_sha256 !== corpus.corpusSha256
) {
  throw new Error("preparation preflight is absent, stale, or not ready for exact execution");
}

const providerAuth = providerAuthStatus();
const localBlockingGateFailures = await readLocalBlockingGateFailures();
const executionPreflight = {
  schema_version: 1,
  campaign_id: CAMPAIGN_ID,
  generated_at: new Date().toISOString(),
  repository: {
    head: repositoryHead(),
    dirty: repositoryDirty(),
  },
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
  },
  authorization: {
    status: policyAuthorization.status,
    source: policyAuthorization.authorization_source,
    policy_sha256: sha256(policySource),
    campaign_plan_sha256: sha256(campaignPlanSource),
  },
  assignment: policyAuthorization.assignment,
  candidate_prompt: {
    base_sha256: sha256(basePrompt),
    overlay_sha256: sha256(overlay),
    assembled_sha256: candidatePromptSha256,
    protected_prompt_modified: false,
  },
  corpus: {
    source_campaign_id: "OPERON-L4-001",
    corpus_sha256: corpus.corpusSha256,
    case_id: CASE_ID,
    runs: RUNS,
    frozen_read_only: true,
  },
  diagnostic: {
    contract_passes_required: RUNS,
    acceptable_attempts_required: RUNS,
    qualification_claim: "prohibited",
  },
  spend: {
    aggregate_ceiling_usd: AGGREGATE_CEILING_USD,
    per_turn_ceiling_usd: PER_TURN_CEILING_USD,
    stop_before_exceeding: true,
  },
  provider_auth: providerAuth,
  known_local_blockers_outside_diagnostic_claim: localBlockingGateFailures,
  external_effects_authorized: false,
  production_prompt_modified: false,
  production_assignment_modified: false,
  ready_to_execute: providerAuth.ready,
};
await writeJsonAtomic(EXECUTION_PREFLIGHT_PATH, executionPreflight);
if (!providerAuth.ready) {
  console.error(
    JSON.stringify(
      {
        status: "blocked_provider_auth_absent",
        campaign_id: CAMPAIGN_ID,
        spend_observed_usd: 0,
      },
      null,
      2,
    ),
  );
  process.exitCode = 2;
} else {
  const report = await executeDiagnostic(
    goldenCase,
    corpus.corpusSha256,
    candidatePrompt.toString("utf8"),
    candidatePromptSha256,
    localBlockingGateFailures,
    executionPreflight,
  );
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.diagnostic.passed ? 0 : 1;
}

async function executeDiagnostic(
  caseUnderTest: EpisodePlannerGoldenCase,
  corpusSha256: string,
  promptText: string,
  promptSha256: string,
  knownLocalBlockers: string[],
  preflight: object,
) {
  await Promise.all([
    mkdir(ATTEMPT_ROOT, { recursive: true }),
    mkdir(WORLD_ROOT, { recursive: true }),
  ]);
  const budgetStore = new CampaignBudgetStore(
    LEDGER_PATH,
    corpusSha256,
    {
      campaignId: CAMPAIGN_ID,
      aggregateCeilingUsd: AGGREGATE_CEILING_USD,
      perTurnCeilingUsd: PER_TURN_CEILING_USD,
    },
  );
  await budgetStore.initialize();
  const attempts: DiagnosticAttemptReport[] = [];
  let stoppedReason: string | null = null;

  for (let repetition = 1; repetition <= RUNS; repetition += 1) {
    const attemptId = `${CASE_ID}-r${repetition}`;
    const existing = await readAttemptReport(attemptId, corpusSha256, promptSha256);
    if (existing !== undefined) {
      attempts.push(existing);
      continue;
    }
    const before = await budgetStore.summary();
    if (before.unmeasuredTurnIds.length > 0 || before.remainingUsd <= 0) {
      stoppedReason =
        before.unmeasuredTurnIds.length > 0
          ? `unmeasured provider reservation(s): ${before.unmeasuredTurnIds.join(", ")}`
          : "diagnostic aggregate spend ceiling exhausted";
      break;
    }
    const attempt = await runAttempt(
      caseUnderTest,
      repetition,
      promptText,
      promptSha256,
      corpusSha256,
      budgetStore,
    );
    attempts.push(attempt);
    await writeJsonAtomic(resolve(ATTEMPT_ROOT, `${attemptId}.json`), attempt);
    const after = await budgetStore.summary();
    if (after.unmeasuredTurnIds.length > 0 || after.ceilingViolations.length > 0) {
      stoppedReason =
        after.unmeasuredTurnIds.length > 0
          ? `unmeasured provider reservation(s): ${after.unmeasuredTurnIds.join(", ")}`
          : `spend ceiling violation(s): ${after.ceilingViolations.join(", ")}`;
      break;
    }
  }

  const diagnostic = evaluateEpisodePlannerDiagnostic(
    attempts.map((attempt) => ({
      caseId: attempt.caseId,
      repetition: attempt.repetition,
      contractPassed: attempt.contractPassed,
      acceptable: attempt.acceptable,
    })),
    {
      campaignId: CAMPAIGN_ID,
      caseId: CASE_ID,
      requiredAttempts: RUNS,
    },
  );
  const spend = await budgetStore.summary();
  const budgetIntegrityPassed =
    spend.reservedUsd === 0 &&
    spend.unmeasuredTurnIds.length === 0 &&
    spend.ceilingViolations.length === 0 &&
    spend.observedUsd <= AGGREGATE_CEILING_USD;
  const report = {
    schema_version: 1,
    campaign_id: CAMPAIGN_ID,
    generated_at: new Date().toISOString(),
    execution_preflight: preflight,
    assignment: policyAuthorization.assignment,
    candidate_prompt: {
      base_sha256: sha256(basePrompt),
      overlay_sha256: sha256(overlay),
      assembled_sha256: promptSha256,
      production_prompt_modified: false,
    },
    corpus: {
      source_campaign_id: "OPERON-L4-001",
      corpus_sha256: corpusSha256,
      case_id: CASE_ID,
      attempts_required: RUNS,
      frozen_read_only: true,
    },
    attempts_completed: attempts.length,
    stopped_reason: stoppedReason,
    spend: {
      ceiling_usd: AGGREGATE_CEILING_USD,
      per_turn_ceiling_usd: PER_TURN_CEILING_USD,
      observed_usd: spend.observedUsd,
      reserved_usd: spend.reservedUsd,
      remaining_usd: spend.remainingUsd,
      unmeasured_turn_ids: spend.unmeasuredTurnIds,
      ceiling_violations: spend.ceilingViolations,
      integrity_passed: budgetIntegrityPassed,
    },
    diagnostic: {
      ...diagnostic,
      passed: diagnostic.passed && budgetIntegrityPassed,
    },
    qualification: {
      issued: false,
      authorized: false,
      reason: `${CAMPAIGN_ID} is diagnostic-only under the exact human authorization`,
    },
    known_local_blockers_outside_diagnostic_claim: knownLocalBlockers,
    production_assignment_preserved: true,
    production_roles_modified: false,
    production_prompt_modified: false,
    frozen_corpus_modified: false,
    external_effects_executed: false,
    attempts: attempts.map((attempt) => ({
      attempt_id: attempt.attempt_id,
      contract_passed: attempt.contractPassed,
      acceptable: attempt.acceptable,
      evidence: `./attempts/${attempt.attempt_id}.json`,
    })),
  };
  await writeJsonAtomic(REPORT_PATH, report);
  return report;
}

async function runAttempt(
  caseUnderTest: EpisodePlannerGoldenCase,
  repetition: number,
  promptText: string,
  promptSha256: string,
  corpusSha256: string,
  budgetStore: CampaignBudgetStore,
): Promise<DiagnosticAttemptReport> {
  const attemptId = `${CASE_ID}-r${repetition}`;
  const startedAt = new Date().toISOString();
  const world = await ensureAttemptWorld(attemptId);
  const roles = campaignRoles();
  const app = campaignApp();
  const intent = campaignIntent(caseUnderTest, repetition, corpusSha256, app, roles);
  const budgetRuntime = new EnforcedCampaignBudgetRuntime(
    new ClaudeRuntime({ protectedHome: homedir() }),
    budgetStore,
    attemptId,
  );
  let plan: EpisodePlan | null = null;
  let quality: EpisodePlannerQualityScore | null = null;
  let plannerAttempts = 0;
  let contractPassed = false;
  let error: DiagnosticAttemptReport["error"] = null;
  try {
    const prepared = await prepareEpisodePlanWithRuntime({
      root: world.stateRoot,
      app,
      roles,
      intent,
      providerOperations: PROVIDER_OPERATIONS,
      mechanicalGates: MECHANICAL_GATES,
      topologyContract: {
        providerOperationRoles: Object.fromEntries(
          OPERATION_CATALOG.map((entry) => [entry.operation, entry.role]),
        ),
        independentReview: {
          subjectRole: "builder",
          reviewerRole: "reviewer",
          reviewerMustDependOnSubject: true,
        },
        externalEffectsDuringPlanning: false,
      },
      promptText,
      context: campaignContext(corpusSha256, promptSha256),
      workdir: world.workdir,
      hooks: {
        gate: () => ({
          allow: false,
          reason: "Layer-4 Episode Planner diagnostic has no tool or external-effect authority",
          escalate: false,
        }),
      },
      runtimeForAssignment: (assignment, role) => {
        if (
          role.name !== "planner" ||
          assignment.harness !== "claude" ||
          assignment.model !== "claude-opus-5" ||
          assignment.effort !== "xhigh"
        ) {
          throw new Error(
            `diagnostic runtime refused unexpected assignment ` +
              `${assignment.harness}/${assignment.model}/${assignment.effort}`,
          );
        }
        return budgetRuntime;
      },
      policyVersion: `${CAMPAIGN_ID}/episode-planner-diagnostic-v1`,
      limits: campaignPlannerLimits(),
      traceId: attemptId,
      maxTurns: 3,
      networkAccess: false,
      contextBudgetBytes: 192 * 1024,
      telemetry: { orgDir: world.stateRoot, trigger: "manual" },
    });
    plan = prepared.plan;
    plannerAttempts = prepared.plannerAttempts;
    quality = scoreEpisodePlan(prepared.plan, caseUnderTest);
    contractPassed = true;
  } catch (caught) {
    const normalized = caught instanceof Error ? caught : new Error(String(caught));
    error = {
      name: normalized.name,
      message: normalized.message,
      ...(normalized.stack === undefined ? {} : { stack: normalized.stack }),
    };
  }
  const ledger = await budgetStore.read();
  const budgetTurns = ledger.turns.filter((turn) => turn.attempt_id === attemptId);
  return {
    schema_version: 1,
    campaign_id: CAMPAIGN_ID,
    corpus_sha256: corpusSha256,
    candidate_prompt_sha256: promptSha256,
    attempt_id: attemptId,
    caseId: CASE_ID,
    repetition,
    title: caseUnderTest.title,
    critical: true,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    contractPassed,
    acceptable: contractPassed && quality?.acceptable === true,
    plan,
    quality,
    planner_attempts: evidenceBackedPlannerAttemptCount(plannerAttempts, budgetTurns),
    budget_turns: budgetTurns,
    error,
  };
}

function campaignRoles(): RoleConfig[] {
  return [
    {
      name: "planner",
      runtime: "claude",
      model: "claude-opus-5",
      effort: "xhigh",
      delegation: { allow: [] },
      triggers: [{ manual: true }],
      outputs: ["episode-plan"],
      maxTurnBudgetUsd: PER_TURN_CEILING_USD,
    },
    {
      name: "builder",
      runtime: "claude",
      model: "claude-sonnet-4-6",
      effort: "high",
      delegation: { allow: [] },
      triggers: [],
      outputs: ["bounded-artifact"],
      maxTurnBudgetUsd: 5,
    },
    {
      name: "reviewer",
      runtime: "codex",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      delegation: { allow: [] },
      triggers: [],
      outputs: ["independent-review"],
      maxTurnBudgetUsd: 5,
    },
    {
      name: "sre",
      runtime: "claude",
      model: "claude-sonnet-4-6",
      effort: "high",
      delegation: { allow: [] },
      triggers: [],
      outputs: ["incident-or-release-artifact"],
      maxTurnBudgetUsd: 5,
    },
  ];
}

function campaignApp(): AppEntry {
  return {
    name: "operon-layer-4-diagnostic",
    repo: "validation/episode-planner",
    status: "live",
    budgetUsdMonth: AGGREGATE_CEILING_USD,
    cadence: {},
    channels: {},
    execution: {
      assignmentMode: "fixed",
      allowedAssignments: {},
    },
  };
}

function campaignIntent(
  caseUnderTest: EpisodePlannerGoldenCase,
  repetition: number,
  corpusSha256: string,
  app = campaignApp(),
  roles = campaignRoles(),
) {
  return buildEpisodeIntent({
    episodeId: `l4-diagnostic-${CASE_ID.toLowerCase()}-r${repetition}`,
    app,
    roles,
    trigger: {
      kind: "validation_campaign",
      sourceRef: `${CAMPAIGN_ID}/${CASE_ID}-r${repetition}`,
      payloadHash: stableHash({
        campaignId: CAMPAIGN_ID,
        corpusSha256,
        caseId: CASE_ID,
        repetition,
      }),
    },
    goal: caseUnderTest.input.goal,
    lifecycle: caseUnderTest.input.lifecycle,
    appStage: caseUnderTest.input.app_stage,
    repositoryFacts: caseUnderTest.input.repository_facts,
    requestedConstraints: {
      ...caseUnderTest.input.requested_constraints,
      governedOperationCatalog: OPERATION_CATALOG.map((entry) => ({ ...entry })),
      workflowAuthority: "accepted_episode_plan_only",
      noExternalEffectsDuringPlanning: true,
    },
    hardBudget: caseUnderTest.input.hard_budget,
    requiredSafetyFacts: caseUnderTest.input.required_safety_facts,
    assignmentAvailable: () => true,
    responsibilityByRole: {
      planner: "Analyze bounded evidence or clarify scope when the case requires it",
      builder: "Produce the smallest bounded implementation artifact",
      reviewer: "Independently verify the builder artifact with the case-specific review operation",
      sre: "Own bounded incident investigation and configured release operations",
    },
  });
}

function campaignPlannerLimits(): PlannerAdmissionLimits {
  return {
    maxAttempts: 2,
    perAttempt: {
      equivalentCostUsd: PER_TURN_CEILING_USD,
      activeTimeMs: 5 * 60_000,
    },
    aggregate: {
      providerTurns: 2,
      equivalentCostUsd: 10,
      activeTimeMs: 10 * 60_000,
    },
  };
}

function validateCaseConfiguration(
  caseUnderTest: EpisodePlannerGoldenCase,
  corpusSha256: string,
): void {
  const roles = campaignRoles();
  const intent = campaignIntent(caseUnderTest, 1, corpusSha256, campaignApp(), roles);
  const planningPolicy = createEpisodePlanningPolicy(campaignApp(), {
    intent,
    roles,
    providerOperations: PROVIDER_OPERATIONS,
  });
  const assignment = planningPolicy.plannerBootAssignment;
  if (
    assignment.harness !== "claude" ||
    assignment.model !== "claude-opus-5" ||
    assignment.effort !== "xhigh"
  ) {
    throw new Error(`${CASE_ID} resolves an unauthorized Planner boot assignment`);
  }
}

function campaignContext(corpusSha256: string, promptSha256: string) {
  const text =
    `Diagnostic authority ${CAMPAIGN_ID}: use only ${CASE_ID} and the bounded EpisodeIntent. ` +
    "No tool, network, filesystem, environment, external-effect, qualification, or production-change authority is granted.";
  return {
    authority: {
      profile: "operon-validation-layer-4-diagnostic",
      version: CAMPAIGN_ID,
      sha256: sha256(text),
      sources: [
        `codex-tests/validation-policy.yaml#${CAMPAIGN_ID}`,
        `codex-tests/campaigns/${CAMPAIGN_ID}/campaign-plan.yaml#${promptSha256}`,
        `codex-tests/golden-sets/episode-planner/manifest.yaml#${corpusSha256}`,
      ],
      text,
    },
    taste: [],
    memoryExcerpts: [],
    components: [
      {
        category: "authority" as const,
        source: `codex-tests/validation-policy.yaml#${CAMPAIGN_ID}`,
        rendered: text,
        inclusionReason: "content-bound diagnostic authority",
        requirement: "required" as const,
      },
    ],
  };
}

async function ensureAttemptWorld(attemptId: string): Promise<{
  stateRoot: string;
  workdir: string;
}> {
  if (!new RegExp(`^${CASE_ID}-r[123]$`).test(attemptId)) {
    throw new Error(`unsafe diagnostic attempt id ${attemptId}`);
  }
  const root = resolve(WORLD_ROOT, attemptId);
  const stateRoot = resolve(root, "state-home");
  const workdir = resolve(root, "worktree");
  await Promise.all([
    mkdir(stateRoot, { recursive: true }),
    mkdir(workdir, { recursive: true }),
  ]);
  if (!existsSync(resolve(workdir, ".git"))) {
    execFileSync("git", ["init", "-q"], { cwd: workdir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Operon Layer-4 Diagnostic"], {
      cwd: workdir,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.email", "layer4-diagnostic@example.invalid"], {
      cwd: workdir,
      stdio: "ignore",
    });
    await writeFile(
      resolve(workdir, "README.md"),
      `# ${attemptId}\n\nIsolated Episode Planner diagnostic worktree.\n`,
      "utf8",
    );
    execFileSync("git", ["add", "README.md"], { cwd: workdir, stdio: "ignore" });
    execFileSync("git", ["commit", "-q", "-m", "isolated diagnostic baseline"], {
      cwd: workdir,
      stdio: "ignore",
    });
  }
  return { stateRoot, workdir };
}

async function readAttemptReport(
  attemptId: string,
  corpusSha256: string,
  promptSha256: string,
): Promise<DiagnosticAttemptReport | undefined> {
  try {
    const report = JSON.parse(
      await readFile(resolve(ATTEMPT_ROOT, `${attemptId}.json`), "utf8"),
    ) as DiagnosticAttemptReport;
    if (
      report.schema_version !== 1 ||
      report.campaign_id !== CAMPAIGN_ID ||
      report.corpus_sha256 !== corpusSha256 ||
      report.candidate_prompt_sha256 !== promptSha256 ||
      report.attempt_id !== attemptId
    ) {
      throw new Error(`existing diagnostic evidence ${attemptId} has conflicting identity`);
    }
    return report;
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

function assertPolicyAuthorization(
  authorization: Awaited<ReturnType<
    typeof loadValidationPolicy
  >>["authorizations"][
    | "layer_4_episode_planner_diagnostic"
    | "layer_4_episode_planner_l4_003_diagnostic"
    | "layer_4_episode_planner_l4_004_diagnostic"
    | "layer_4_episode_planner_l4_005_diagnostic"
  ],
  corpusSha256: string,
  basePromptSha256: string,
  overlaySha256: string,
  assembledPromptSha256: string,
): void {
  if (
    authorization.id !== CAMPAIGN_ID ||
    authorization.status !== DIAGNOSTIC_CONFIG.authorizationStatus ||
    authorization.parent_campaign_id !== DIAGNOSTIC_CONFIG.parentCampaignId ||
    authorization.call_site_id !== "OPERON-LLM-001" ||
    authorization.assignment.harness !== "claude" ||
    authorization.assignment.model !== "claude-opus-5" ||
    authorization.assignment.effort !== "xhigh" ||
    authorization.candidate_prompt.base_sha256 !== basePromptSha256 ||
    authorization.candidate_prompt.overlay_sha256 !== overlaySha256 ||
    authorization.candidate_prompt.assembled_sha256 !== assembledPromptSha256 ||
    authorization.candidate_prompt.protected_prompt_adoption !== "not_authorized" ||
    authorization.corpus.corpus_sha256 !== corpusSha256 ||
    authorization.corpus.case_id !== CASE_ID ||
    authorization.corpus.runs_per_case !== RUNS ||
    authorization.corpus.total_attempts !== RUNS ||
    authorization.quality.diagnostic_only !== true ||
    authorization.quality.qualification_claim !== "prohibited" ||
    authorization.quality.deterministic_contracts !== "3_of_3" ||
    authorization.quality.acceptable_attempts !== "3_of_3" ||
    authorization.spend.aggregate_ceiling_usd !== AGGREGATE_CEILING_USD ||
    authorization.spend.per_turn_ceiling_usd !== PER_TURN_CEILING_USD ||
    authorization.spend.stop_before_exceeding !== true ||
    authorization.failure_handling.qualification_on_failure !== "none" ||
    authorization.failure_handling.qualification_on_pass !== "none" ||
    authorization.failure_handling.preserve_evidence !== true ||
    authorization.external_effects_authorized !== false
  ) {
    throw new Error("diagnostic runner configuration disagrees with exact human authorization");
  }
}

function assertCampaignPlan(source: Buffer): void {
  const document = parseDocument(source.toString("utf8"), { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(
      `diagnostic campaign plan is invalid YAML: ${document.errors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }
  const plan = document.toJS() as Record<string, unknown>;
  const authorization = plan["authorization"] as Record<string, unknown> | undefined;
  const stages = plan["stages"] as Record<string, unknown> | undefined;
  const diagnostic = stages?.["diagnostic"] as Record<string, unknown> | undefined;
  const spend = diagnostic?.["spend"] as Record<string, unknown> | undefined;
  if (
    plan["campaign_id"] !== CAMPAIGN_ID ||
    plan["status"] !== DIAGNOSTIC_CONFIG.planStatus ||
    authorization?.["provider_execution"] !== "human_authorized_diagnostic_only" ||
    authorization?.["provider_spend"] !== "human_authorized_diagnostic_only" ||
    diagnostic?.["runs_per_case"] !== RUNS ||
    !Array.isArray(diagnostic["case_ids"]) ||
    diagnostic["case_ids"].length !== 1 ||
    diagnostic["case_ids"][0] !== CASE_ID ||
    diagnostic["qualification_claim"] !== "prohibited" ||
    spend?.["status"] !== DIAGNOSTIC_CONFIG.planSpendStatus ||
    spend["aggregate_ceiling_usd"] !== AGGREGATE_CEILING_USD ||
    spend["per_turn_ceiling_usd"] !== PER_TURN_CEILING_USD
  ) {
    throw new Error("diagnostic campaign plan disagrees with exact human authorization");
  }
}

function providerAuthStatus(): ProviderAuthStatus {
  if ((process.env["ANTHROPIC_API_KEY"] ?? "").trim().length > 0) {
    return { ready: true, method: "api_key_env", detail: "ANTHROPIC_API_KEY is present" };
  }
  const status = spawnSync("claude", ["auth", "status", "--json"], {
    encoding: "utf8",
    env: process.env,
  });
  try {
    const parsed = JSON.parse(status.stdout ?? "") as Record<string, unknown>;
    const loggedIn = parsed["loggedIn"] ?? parsed["logged_in"] ?? parsed["authenticated"];
    if (loggedIn === true) {
      return { ready: true, method: "claude_cli", detail: "Claude CLI reports authenticated" };
    }
  } catch {
    // Authentication details are reduced to a boolean and method. Raw output
    // is never copied into diagnostic evidence.
  }
  return { ready: false, method: "none", detail: "Claude CLI reports no active authentication" };
}

async function readLocalBlockingGateFailures(): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(LOCAL_MANIFEST_PATH, "utf8")) as {
      blocking_failures?: Array<{ file?: string; title?: string }>;
      known_blocking_defects?: Array<{ id?: string; case_id?: string; summary?: string }>;
    };
    const defects = (parsed.known_blocking_defects ?? []).map(
      (defect) =>
        `${defect.id ?? "unknown"} / ${defect.case_id ?? "unknown"}: ` +
        `${defect.summary ?? "blocking deterministic defect"}`,
    );
    const failures = (parsed.blocking_failures ?? []).map(
      (failure) =>
        `${failure.file ?? "unknown"}: ${failure.title ?? "blocking deterministic assertion"}`,
    );
    return [...new Set([...defects, ...failures])];
  } catch {
    return ["local deterministic validation manifest is absent or unreadable"];
  }
}

function repositoryHead(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: resolve(HARNESS_ROOT, ".."),
    encoding: "utf8",
  }).trim();
}

function repositoryDirty(): boolean {
  return (
    execFileSync("git", ["status", "--porcelain"], {
      cwd: resolve(HARNESS_ROOT, ".."),
      encoding: "utf8",
    }).trim().length > 0
  );
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

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isMissingFile(error: unknown): boolean {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT";
}
