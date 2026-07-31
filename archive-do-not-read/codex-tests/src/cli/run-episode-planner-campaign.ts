import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
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
import {
  EPISODE_PLANNER_CORPUS_ROOT,
  loadEpisodePlannerCorpus,
  scoreEpisodePlan,
  type EpisodePlannerGoldenCase,
  type EpisodePlannerQualityScore,
} from "../eval-runner/episode-planner-corpus.js";
import {
  qualifyEpisodePlannerCampaign,
  type EpisodePlannerCampaignAttempt,
} from "../eval-runner/qualification.js";
import {
  ARTIFACT_ROOT,
  HARNESS_ROOT,
  assertArtifactPath,
} from "../fixtures/controlled-world.js";
import { loadValidationPolicy } from "../policy/load.js";

const stage = argumentValue("--stage");
if (stage !== undefined && stage !== "qualification") {
  throw new Error(`unsupported campaign stage ${stage}`);
}
const QUALIFICATION_STAGE = stage === "qualification";
const qualificationCampaignArgument =
  argumentValue("--campaign") ?? "OPERON-L4-002";
if (
  QUALIFICATION_STAGE &&
  qualificationCampaignArgument !== "OPERON-L4-002" &&
  qualificationCampaignArgument !== "OPERON-L4-003" &&
  qualificationCampaignArgument !== "OPERON-L4-004" &&
  qualificationCampaignArgument !== "OPERON-L4-005"
) {
  throw new Error(`unsupported qualification campaign ${qualificationCampaignArgument}`);
}
const CAMPAIGN_ID = QUALIFICATION_STAGE
  ? qualificationCampaignArgument
  : "OPERON-L4-001";
const QUALIFICATION_CONFIG =
  CAMPAIGN_ID === "OPERON-L4-003"
    ? {
        authorizationStatus: "human_authorized_by_delegation" as const,
        diagnosticAuditStatus:
          "passed_with_attributable_original_verdict_defect" as const,
        diagnosticOriginalVerdictDefect: true,
      }
    : CAMPAIGN_ID === "OPERON-L4-004" || CAMPAIGN_ID === "OPERON-L4-005"
      ? {
          authorizationStatus: "human_authorized_by_delegation" as const,
          diagnosticAuditStatus: "passed" as const,
          diagnosticOriginalVerdictDefect: false,
        }
      : {
        authorizationStatus: "human_authorized" as const,
        diagnosticAuditStatus: "passed" as const,
        diagnosticOriginalVerdictDefect: false,
      };
const OUTPUT_ROOT = assertArtifactPath(
  QUALIFICATION_STAGE
    ? resolve(ARTIFACT_ROOT, "layer-4", CAMPAIGN_ID, "qualification")
    : resolve(ARTIFACT_ROOT, "layer-4", CAMPAIGN_ID),
);
const ATTEMPT_ROOT = resolve(OUTPUT_ROOT, "attempts");
const WORLD_ROOT = resolve(OUTPUT_ROOT, "worlds");
const POLICY_PATH = resolve(HARNESS_ROOT, "validation-policy.yaml");
const BASE_PROMPT_PATH = resolve(HARNESS_ROOT, "..", "prompts", "episode", "plan.md");
const OVERLAY_PATH = resolve(
  HARNESS_ROOT,
  "campaigns",
  CAMPAIGN_ID,
  "candidate-prompt-overlay.md",
);
const CAMPAIGN_PLAN_PATH = resolve(
  HARNESS_ROOT,
  "campaigns",
  CAMPAIGN_ID,
  "campaign-plan.yaml",
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
const LOCAL_MANIFEST_PATH = resolve(ARTIFACT_ROOT, "local-validation", "manifest.json");
const LEDGER_PATH = resolve(OUTPUT_ROOT, "spend-ledger.json");
const REPORT_PATH = resolve(OUTPUT_ROOT, "campaign-report.json");
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

interface QualificationInputs {
  overlay: Buffer;
  campaignPlanSource: Buffer;
  diagnosticReportSource: Buffer;
  diagnosticAuditSource: Buffer;
  diagnosticPassed: boolean;
}

interface CampaignAttemptReport extends EpisodePlannerCampaignAttempt {
  schema_version: 1;
  campaign_id: typeof CAMPAIGN_ID;
  corpus_sha256: string;
  attempt_id: string;
  title: string;
  critical: boolean;
  started_at: string;
  finished_at: string;
  plan: EpisodePlan | null;
  quality: EpisodePlannerQualityScore | null;
  planner_attempts: number;
  budget_turns: CampaignBudgetTurn[];
  error: { name: string; message: string; stack?: string } | null;
}

const execute = process.argv.includes("--execute");
const authorization = argumentValue("--authorization");
if (execute && authorization !== CAMPAIGN_ID) {
  throw new Error(
    `provider execution requires --authorization ${CAMPAIGN_ID}; no other authorization is accepted`,
  );
}
if (execute && QUALIFICATION_STAGE && existsSync(REPORT_PATH)) {
  throw new Error(
    `${CAMPAIGN_ID} full qualification already has terminal evidence; it cannot be silently rerun`,
  );
}

await mkdir(OUTPUT_ROOT, { recursive: true });
const [policy, corpus, policySource, basePrompt] = await Promise.all([
  loadValidationPolicy(POLICY_PATH),
  loadEpisodePlannerCorpus(EPISODE_PLANNER_CORPUS_ROOT),
  readFile(POLICY_PATH),
  readFile(BASE_PROMPT_PATH),
]);
const qualificationInputs = QUALIFICATION_STAGE
  ? await readQualificationInputs()
  : undefined;
const promptText = QUALIFICATION_STAGE
  ? Buffer.concat([
      basePrompt,
      Buffer.from("\n\n", "utf8"),
      qualificationInputs!.overlay,
    ]).toString("utf8")
  : basePrompt.toString("utf8");
const policyAuthorization = QUALIFICATION_STAGE
  ? CAMPAIGN_ID === "OPERON-L4-005"
    ? policy.authorizations.layer_4_episode_planner_l4_005_qualification
    : CAMPAIGN_ID === "OPERON-L4-004"
    ? policy.authorizations.layer_4_episode_planner_l4_004_qualification
    : CAMPAIGN_ID === "OPERON-L4-003"
      ? policy.authorizations.layer_4_episode_planner_l4_003_qualification
      : policy.authorizations.layer_4_episode_planner_qualification
  : policy.authorizations.layer_4_episode_planner;
if (QUALIFICATION_STAGE) {
  assertQualificationAuthorization(
    CAMPAIGN_ID === "OPERON-L4-005"
      ? policy.authorizations.layer_4_episode_planner_l4_005_qualification
      : CAMPAIGN_ID === "OPERON-L4-004"
      ? policy.authorizations.layer_4_episode_planner_l4_004_qualification
      : CAMPAIGN_ID === "OPERON-L4-003"
        ? policy.authorizations.layer_4_episode_planner_l4_003_qualification
        : policy.authorizations.layer_4_episode_planner_qualification,
    corpus.manifest,
    basePrompt,
    qualificationInputs!,
  );
} else {
  assertAuthorizationMatchesCorpus(
    policy.authorizations.layer_4_episode_planner,
    corpus.manifest,
  );
}
const caseConfiguration = validateCaseConfigurations(
  corpus.cases,
  corpus.corpusSha256,
);
const providerAuth = providerAuthStatus();
const blockingGateFailures = await localBlockingGateFailures();
const preflight = {
  schema_version: 1,
  campaign_id: CAMPAIGN_ID,
  generated_at: new Date().toISOString(),
  mode: execute ? "execute" : "preflight_only",
  authorization: {
    status: policyAuthorization.status,
    source: policyAuthorization.authorization_source,
    policy_sha256: sha256(policySource),
    campaign_plan_sha256:
      qualificationInputs === undefined
        ? null
        : sha256(qualificationInputs.campaignPlanSource),
  },
  assignment: corpus.manifest.assignment,
  corpus: {
    status: corpus.manifest.status,
    cases: corpus.cases.length,
    runs_per_case: corpus.manifest.threshold.runs_per_case,
    corpus_sha256: corpus.corpusSha256,
    authored_before_prompt_tuning: corpus.manifest.authored_before_prompt_tuning,
  },
  case_configuration: caseConfiguration,
  prompt: {
    composition: QUALIFICATION_STAGE
      ? "protected_base_plus_diagnostic_candidate_overlay"
      : "protected_base",
    base_path: "../../../prompts/episode/plan.md",
    base_sha256: sha256(basePrompt),
    sha256: sha256(promptText),
    overlay_sha256:
      qualificationInputs === undefined
        ? null
        : sha256(qualificationInputs.overlay),
    protected_prompt_modified: false,
  },
  diagnostic_evidence:
    qualificationInputs === undefined
      ? null
      : {
          report_sha256: sha256(qualificationInputs.diagnosticReportSource),
          audit_sha256: sha256(qualificationInputs.diagnosticAuditSource),
          passed: qualificationInputs.diagnosticPassed,
        },
  model_identity: {
    model: "claude-opus-5",
    effort: "xhigh",
    official_sources_verified_on: "2026-07-30",
    official_sources: [
      "https://platform.claude.com/docs/en/about-claude/models/whats-new-opus-5",
      "https://platform.claude.com/docs/en/build-with-claude/effort",
    ],
  },
  provider_auth: providerAuth,
  spend: policyAuthorization.spend,
  qualification_blockers_present_before_campaign: blockingGateFailures,
  external_effects_authorized: false,
  production_roles_modified: false,
  ready_to_execute:
    providerAuth.ready &&
    (!QUALIFICATION_STAGE || qualificationInputs?.diagnosticPassed === true),
};
await preservePreflight(preflight);

if (!execute) {
  console.log(JSON.stringify(preflight, null, 2));
  process.exitCode = providerAuth.ready ? 0 : 2;
} else if (!providerAuth.ready) {
  console.error(
    JSON.stringify(
      {
        status: "blocked_provider_auth_absent",
        campaign_id: CAMPAIGN_ID,
        provider_auth: providerAuth,
        spend_observed_usd: 0,
        next_step: "Authenticate the Claude CLI or supply ANTHROPIC_API_KEY, then rerun the exact authorized command.",
      },
      null,
      2,
    ),
  );
  process.exitCode = 2;
} else {
  const report = await executeCampaign(
    corpus,
    promptText,
    blockingGateFailures,
  );
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.qualification.qualified ? 0 : 1;
}

async function executeCampaign(
  corpus: Awaited<ReturnType<typeof loadEpisodePlannerCorpus>>,
  promptText: string,
  blockingGateFailures: string[],
) {
  await Promise.all([
    mkdir(ATTEMPT_ROOT, { recursive: true }),
    mkdir(WORLD_ROOT, { recursive: true }),
  ]);
  const budgetStore = new CampaignBudgetStore(
    LEDGER_PATH,
    corpus.corpusSha256,
    {
      campaignId: CAMPAIGN_ID,
      aggregateCeilingUsd: policyAuthorization.spend.aggregate_ceiling_usd,
      perTurnCeilingUsd: policyAuthorization.spend.per_turn_ceiling_usd,
    },
  );
  await budgetStore.initialize();
  const attempts: CampaignAttemptReport[] = [];
  let stoppedReason: string | null = null;

  campaignLoop:
  for (const goldenCase of corpus.cases) {
    for (
      let repetition = 1;
      repetition <= corpus.manifest.threshold.runs_per_case;
      repetition += 1
    ) {
      const attemptId = `${goldenCase.case_id}-r${repetition}`;
      const existing = await readAttemptReport(attemptId, corpus.corpusSha256);
      if (existing !== undefined) {
        attempts.push(existing);
        if (!existing.contractPassed) {
          stoppedReason = `${attemptId} has a deterministic contract failure`;
          break campaignLoop;
        }
        continue;
      }
      const spendBefore = await budgetStore.summary();
      if (spendBefore.remainingUsd <= 0 || spendBefore.unmeasuredTurnIds.length > 0) {
        stoppedReason = spendBefore.unmeasuredTurnIds.length > 0
          ? `unmeasured provider reservation(s): ${spendBefore.unmeasuredTurnIds.join(", ")}`
          : "aggregate spend ceiling exhausted";
        break campaignLoop;
      }
      const attempt = await runAttempt(
        goldenCase,
        repetition,
        promptText,
        corpus.corpusSha256,
        budgetStore,
      );
      attempts.push(attempt);
      await writeJsonAtomic(resolve(ATTEMPT_ROOT, `${attemptId}.json`), attempt);
      if (!attempt.contractPassed) {
        stoppedReason = `${attemptId} failed the deterministic EpisodePlan contract`;
        break campaignLoop;
      }
    }
  }

  const qualification = qualifyEpisodePlannerCampaign(
    attempts.map(({ caseId, repetition, contractPassed, acceptable }) => ({
      caseId,
      repetition,
      contractPassed,
      acceptable,
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
    blockingGateFailures,
  );
  const spend = await budgetStore.summary();
  const report = {
    schema_version: 1,
    campaign_id: CAMPAIGN_ID,
    stage: QUALIFICATION_STAGE ? "qualification" : "baseline",
    generated_at: new Date().toISOString(),
    assignment: corpus.manifest.assignment,
    corpus_sha256: corpus.corpusSha256,
    candidate_prompt_sha256: sha256(promptText),
    attempts_completed: attempts.length,
    attempts_required: corpus.manifest.threshold.total_attempts,
    stopped_reason: stoppedReason,
    spend: {
      ceiling_usd: corpus.manifest.spend.aggregate_ceiling_usd,
      observed_usd: spend.observedUsd,
      reserved_usd: spend.reservedUsd,
      remaining_usd: spend.remainingUsd,
      unmeasured_turn_ids: spend.unmeasuredTurnIds,
      ceiling_violations: spend.ceilingViolations,
    },
    qualification,
    production_assignment_preserved: true,
    production_roles_modified: false,
    protected_prompt_modified: false,
    candidate_overlay_applied: QUALIFICATION_STAGE,
    corpus_modified_during_campaign: false,
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
  goldenCase: EpisodePlannerGoldenCase,
  repetition: number,
  promptText: string,
  corpusSha256: string,
  budgetStore: CampaignBudgetStore,
): Promise<CampaignAttemptReport> {
  const attemptId = `${goldenCase.case_id}-r${repetition}`;
  const startedAt = new Date().toISOString();
  const world = await ensureAttemptWorld(attemptId);
  const roles = campaignRoles();
  const app = campaignApp();
  const intent = campaignIntent(goldenCase, repetition, corpusSha256, app, roles);
  const innerRuntime = new ClaudeRuntime({ protectedHome: homedir() });
  const budgetRuntime = new EnforcedCampaignBudgetRuntime(
    innerRuntime,
    budgetStore,
    attemptId,
  );
  let plan: EpisodePlan | null = null;
  let quality: EpisodePlannerQualityScore | null = null;
  let plannerAttempts = 0;
  let contractPassed = false;
  let error: CampaignAttemptReport["error"] = null;
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
      context: campaignContext(corpusSha256),
      workdir: world.workdir,
      hooks: {
        gate: () => ({
          allow: false,
          reason: "Layer-4 Episode Planner has no tool or external-effect authority",
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
            `campaign runtime refused unexpected assignment ` +
              `${assignment.harness}/${assignment.model}/${assignment.effort}`,
          );
        }
        return budgetRuntime;
      },
      policyVersion: `${CAMPAIGN_ID}/episode-planner-v1`,
      limits: campaignPlannerLimits(),
      traceId: attemptId,
      maxTurns: 3,
      networkAccess: false,
      contextBudgetBytes: 192 * 1024,
      telemetry: { orgDir: world.stateRoot, trigger: "manual" },
    });
    plan = prepared.plan;
    plannerAttempts = prepared.plannerAttempts;
    quality = scoreEpisodePlan(prepared.plan, goldenCase);
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
    attempt_id: attemptId,
    caseId: goldenCase.case_id,
    repetition,
    title: goldenCase.title,
    critical: goldenCase.critical,
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
      maxTurnBudgetUsd: 5,
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

function campaignIntent(
  goldenCase: EpisodePlannerGoldenCase,
  repetition: number,
  corpusSha256: string,
  app = campaignApp(),
  roles = campaignRoles(),
) {
  const unavailable = new Set(goldenCase.input.unavailable_roles);
  return buildEpisodeIntent({
    episodeId: `l4-${goldenCase.case_id.toLowerCase()}-r${repetition}`,
    app,
    roles,
    trigger: {
      kind: "validation_campaign",
      sourceRef: `${CAMPAIGN_ID}/${goldenCase.case_id}-r${repetition}`,
      payloadHash: stableHash({
        campaignId: CAMPAIGN_ID,
        corpusSha256,
        caseId: goldenCase.case_id,
        repetition,
      }),
    },
    goal: goldenCase.input.goal,
    lifecycle: goldenCase.input.lifecycle,
    appStage: goldenCase.input.app_stage,
    repositoryFacts: goldenCase.input.repository_facts,
    requestedConstraints: {
      ...goldenCase.input.requested_constraints,
      governedOperationCatalog: OPERATION_CATALOG.map((entry) => ({ ...entry })),
      workflowAuthority: "accepted_episode_plan_only",
      noExternalEffectsDuringPlanning: true,
    },
    hardBudget: goldenCase.input.hard_budget,
    requiredSafetyFacts: goldenCase.input.required_safety_facts,
    assignmentAvailable: ({ role }) => !unavailable.has(role.name),
    responsibilityByRole: {
      planner: "Analyze bounded evidence or clarify scope when the case requires it",
      builder: "Produce the smallest bounded implementation or documentation artifact",
      reviewer: "Independently verify the builder artifact",
      sre: "Own bounded incident investigation and configured release operations",
    },
  });
}

function validateCaseConfigurations(
  cases: EpisodePlannerGoldenCase[],
  corpusSha256: string,
): {
  status: "passed";
  cases_checked: number;
  fixed_planner_assignment: string;
  unavailable_assignment_cases: string[];
} {
  const roles = campaignRoles();
  const app = campaignApp();
  const unavailableAssignmentCases: string[] = [];
  for (const goldenCase of cases) {
    const intent = campaignIntent(goldenCase, 1, corpusSha256, app, roles);
    const planningPolicy = createEpisodePlanningPolicy(app, {
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
      throw new Error(`${goldenCase.case_id} resolves an unauthorized Planner boot assignment`);
    }
    for (const role of goldenCase.input.unavailable_roles) {
      const entries = intent.allowedAssignments.filter((entry) => entry.role === role);
      if (entries.length === 0 || entries.some((entry) => entry.available)) {
        throw new Error(`${goldenCase.case_id} did not freeze ${role} as unavailable`);
      }
      unavailableAssignmentCases.push(goldenCase.case_id);
    }
  }
  return {
    status: "passed",
    cases_checked: cases.length,
    fixed_planner_assignment: "claude/claude-opus-5/xhigh",
    unavailable_assignment_cases: [...new Set(unavailableAssignmentCases)].sort(),
  };
}

function campaignApp(): AppEntry {
  return {
    name: "operon-layer-4-eval",
    repo: "validation/episode-planner",
    status: "live",
    budgetUsdMonth: 60,
    cadence: {},
    channels: {},
    execution: {
      assignmentMode: "fixed",
      allowedAssignments: {},
    },
  };
}

function campaignPlannerLimits(): PlannerAdmissionLimits {
  return {
    maxAttempts: 2,
    perAttempt: {
      equivalentCostUsd: 5,
      activeTimeMs: 5 * 60_000,
    },
    aggregate: {
      providerTurns: 2,
      equivalentCostUsd: 10,
      activeTimeMs: 10 * 60_000,
    },
  };
}

function campaignContext(corpusSha256: string) {
  const text =
    `Evaluation authority ${CAMPAIGN_ID}: use only the bounded EpisodeIntent. ` +
    "No tool, network, filesystem, environment, or external-effect authority is granted.";
  return {
    authority: {
      profile: "operon-validation-layer-4",
      version: CAMPAIGN_ID,
      sha256: sha256(text),
      sources: [
        `codex-tests/validation-policy.yaml#${CAMPAIGN_ID}`,
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
        inclusionReason: "content-bound evaluation authority",
        requirement: "required" as const,
      },
    ],
  };
}

async function ensureAttemptWorld(attemptId: string): Promise<{
  stateRoot: string;
  workdir: string;
}> {
  if (!/^OPERON-EP-\d{3}-r[123]$/.test(attemptId)) {
    throw new Error(`unsafe attempt id ${attemptId}`);
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
    execFileSync("git", ["config", "user.name", "Operon Layer-4 Harness"], {
      cwd: workdir,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.email", "layer4@example.invalid"], {
      cwd: workdir,
      stdio: "ignore",
    });
    await writeFile(
      resolve(workdir, "README.md"),
      `# ${attemptId}\n\nIsolated Episode Planner evaluation worktree.\n`,
      "utf8",
    );
    execFileSync("git", ["add", "README.md"], { cwd: workdir, stdio: "ignore" });
    execFileSync("git", ["commit", "-q", "-m", "isolated evaluation baseline"], {
      cwd: workdir,
      stdio: "ignore",
    });
  }
  return { stateRoot, workdir };
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
    // Collapse unreadable provider details to a boolean preflight result; do
    // not copy raw auth output into campaign evidence.
  }
  return { ready: false, method: "none", detail: "Claude CLI reports no active authentication" };
}

async function localBlockingGateFailures(): Promise<string[]> {
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

async function readAttemptReport(
  attemptId: string,
  corpusSha256: string,
): Promise<CampaignAttemptReport | undefined> {
  const path = resolve(ATTEMPT_ROOT, `${attemptId}.json`);
  try {
    const report = JSON.parse(await readFile(path, "utf8")) as CampaignAttemptReport;
    if (
      report.schema_version !== 1 ||
      report.campaign_id !== CAMPAIGN_ID ||
      report.corpus_sha256 !== corpusSha256 ||
      report.attempt_id !== attemptId
    ) {
      throw new Error(`existing attempt evidence ${attemptId} has conflicting identity`);
    }
    return report;
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

function assertAuthorizationMatchesCorpus(
  authorization: Awaited<ReturnType<
    typeof loadValidationPolicy
  >>["authorizations"]["layer_4_episode_planner"],
  manifest: Awaited<ReturnType<typeof loadEpisodePlannerCorpus>>["manifest"],
): void {
  const identity = authorizationIdentity(authorization);
  if (
    identity.campaignId !== manifest.campaign_id ||
    identity.callSiteId !== manifest.call_site_id ||
    identity.assignment !==
      `${manifest.assignment.harness}/${manifest.assignment.model}/${manifest.assignment.effort}` ||
    identity.cases !== manifest.threshold.total_cases ||
    identity.runsPerCase !== manifest.threshold.runs_per_case ||
    identity.overallMin !== manifest.threshold.overall_min_acceptable ||
    identity.aggregateCeiling !== manifest.spend.aggregate_ceiling_usd ||
    identity.perTurnCeiling !== manifest.spend.per_turn_ceiling_usd
  ) {
    throw new Error("frozen corpus disagrees with the human-authorized Layer-4 policy");
  }
}

async function readQualificationInputs(): Promise<QualificationInputs> {
  const [
    overlay,
    campaignPlanSource,
    diagnosticReportSource,
    diagnosticAuditSource,
  ] = await Promise.all([
    readFile(OVERLAY_PATH),
    readFile(CAMPAIGN_PLAN_PATH),
    readFile(DIAGNOSTIC_REPORT_PATH),
    readFile(DIAGNOSTIC_AUDIT_PATH),
  ]);
  const report = JSON.parse(diagnosticReportSource.toString("utf8")) as {
    campaign_id?: string;
    attempts_completed?: number;
    diagnostic?: {
      campaignId?: string;
      status?: string;
      passed?: boolean;
      contractPasses?: number;
      acceptableAttempts?: number;
    };
    qualification?: { issued?: boolean };
  };
  const audit = JSON.parse(diagnosticAuditSource.toString("utf8")) as {
    campaign_id?: string;
    evidence_integrity?: string;
    diagnostic_result?: { status?: string; passed?: boolean; qualification_issued?: boolean };
  };
  const diagnosticPassed =
    report.campaign_id === CAMPAIGN_ID &&
    report.attempts_completed === 3 &&
    report.diagnostic?.contractPasses === 3 &&
    report.diagnostic.acceptableAttempts === 3 &&
    (QUALIFICATION_CONFIG.diagnosticOriginalVerdictDefect
      ? report.diagnostic.campaignId === "OPERON-L4-002" &&
        report.diagnostic.status === "invalid_evidence" &&
        report.diagnostic.passed === false
      : report.diagnostic.campaignId === CAMPAIGN_ID &&
        report.diagnostic.status === "passed" &&
        report.diagnostic.passed === true) &&
    report.qualification?.issued === false &&
    audit.campaign_id === CAMPAIGN_ID &&
    audit.evidence_integrity === QUALIFICATION_CONFIG.diagnosticAuditStatus &&
    audit.diagnostic_result?.status === "passed" &&
    audit.diagnostic_result.passed === true &&
    audit.diagnostic_result.qualification_issued === false;
  if (!diagnosticPassed) {
    throw new Error(
      `${CAMPAIGN_ID} qualification requires intact independently passed diagnostic evidence`,
    );
  }
  return {
    overlay,
    campaignPlanSource,
    diagnosticReportSource,
    diagnosticAuditSource,
    diagnosticPassed,
  };
}

function assertQualificationAuthorization(
  authorization: Awaited<ReturnType<
    typeof loadValidationPolicy
  >>["authorizations"][
    | "layer_4_episode_planner_qualification"
    | "layer_4_episode_planner_l4_003_qualification"
    | "layer_4_episode_planner_l4_004_qualification"
    | "layer_4_episode_planner_l4_005_qualification"
  ],
  manifest: Awaited<ReturnType<typeof loadEpisodePlannerCorpus>>["manifest"],
  basePrompt: Buffer,
  inputs: QualificationInputs,
): void {
  const assembledPrompt = Buffer.concat([
    basePrompt,
    Buffer.from("\n\n", "utf8"),
    inputs.overlay,
  ]);
  if (
    authorization.id !== CAMPAIGN_ID ||
    authorization.stage !== "qualification" ||
    authorization.status !== QUALIFICATION_CONFIG.authorizationStatus ||
    authorization.call_site_id !== manifest.call_site_id ||
    `${authorization.assignment.harness}/${authorization.assignment.model}/${authorization.assignment.effort}` !==
      `${manifest.assignment.harness}/${manifest.assignment.model}/${manifest.assignment.effort}` ||
    authorization.candidate_prompt.base_sha256 !== sha256(basePrompt) ||
    authorization.candidate_prompt.overlay_sha256 !== sha256(inputs.overlay) ||
    authorization.candidate_prompt.assembled_sha256 !== sha256(assembledPrompt) ||
    authorization.diagnostic_evidence.report_sha256 !==
      sha256(inputs.diagnosticReportSource) ||
    authorization.diagnostic_evidence.audit_sha256 !==
      sha256(inputs.diagnosticAuditSource) ||
    authorization.diagnostic_evidence.required_status !==
      QUALIFICATION_CONFIG.diagnosticAuditStatus ||
    inputs.diagnosticPassed !== true ||
    authorization.corpus.source_campaign_id !== manifest.campaign_id ||
    authorization.corpus.corpus_sha256 !== manifest.corpus_sha256 ||
    authorization.corpus.cases !== manifest.threshold.total_cases ||
    authorization.corpus.runs_per_case !== manifest.threshold.runs_per_case ||
    authorization.corpus.total_attempts !== manifest.threshold.total_attempts ||
    authorization.quality.rubric !== manifest.rubric ||
    authorization.quality.overall_min_acceptable !==
      manifest.threshold.overall_min_acceptable ||
    authorization.quality.min_acceptable_per_case !==
      manifest.threshold.min_acceptable_per_case ||
    authorization.quality.critical_min_acceptable_per_case !==
      manifest.threshold.critical_min_acceptable_per_case ||
    authorization.spend.aggregate_ceiling_usd !==
      manifest.spend.aggregate_ceiling_usd ||
    authorization.spend.per_turn_ceiling_usd !==
      manifest.spend.per_turn_ceiling_usd ||
    authorization.external_effects_authorized !== false ||
    authorization.production_assignment_change !== "not_authorized"
  ) {
    throw new Error(
      `${CAMPAIGN_ID} full qualification inputs disagree with exact human authorization`,
    );
  }
}

function authorizationIdentity(
  authorization: Awaited<ReturnType<typeof loadValidationPolicy>>["authorizations"]["layer_4_episode_planner"],
) {
  return {
    campaignId: authorization.id,
    callSiteId: authorization.call_site_id,
    assignment:
      `${authorization.assignment.harness}/${authorization.assignment.model}/` +
      `${authorization.assignment.effort}`,
    cases: authorization.corpus.cases,
    runsPerCase: authorization.corpus.runs_per_case,
    overallMin: authorization.quality.overall_min_acceptable,
    aggregateCeiling: authorization.spend.aggregate_ceiling_usd,
    perTurnCeiling: authorization.spend.per_turn_ceiling_usd,
  };
}

async function preservePreflight(preflight: object): Promise<void> {
  const generatedAt =
    "generated_at" in preflight && typeof preflight.generated_at === "string"
      ? preflight.generated_at.replaceAll(/[^0-9A-Za-z.-]/g, "_")
      : String(Date.now());
  await Promise.all([
    writeJsonAtomic(resolve(OUTPUT_ROOT, "preflight.json"), preflight),
    writeJsonAtomic(resolve(OUTPUT_ROOT, "preflights", `${generatedAt}.json`), preflight),
  ]);
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
