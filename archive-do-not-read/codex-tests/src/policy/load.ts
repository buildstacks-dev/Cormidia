import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";

const ROOT_KEYS = [
  "schema_version",
  "status",
  "scope",
  "product",
  "default_tier",
  "last_updated",
  "provenance",
  "artifacts",
  "authorizations",
  "coexistence",
  "criticality_tiers",
  "invariants",
  "risk_model",
  "coverage_profiles",
  "journey_risk",
  "module_risk",
  "llm_quality_risk",
  "phase_6_invariant_backflow",
  "layers",
  "gates",
  "incident_containment",
  "human_attention_assurance",
  "independent_quality_oracle",
  "github_identity_assurance",
  "ops_hardening",
  "resource_runaway_assurance",
  "tooling",
  "case_sourcing",
  "migration",
  "implementation",
  "modules",
  "waivers",
  "open_findings",
] as const;

const LAYER_KEYS = [
  "invariant_contract",
  "hermetic_system",
  "live_sandbox",
  "eval_qualification",
  "ops_hardening",
] as const;

const GATE_KEYS = [
  "invariant_contract",
  "hermetic_system",
  "live_sandbox",
  "llm_contract",
  "llm_quality",
  "judge_meta_eval",
  "ops_hardening",
] as const;

const LAYER_FIELD_KEYS = {
  invariant_contract: ["status", "requirement", "cadence", "location"],
  hermetic_system: [
    "status",
    "requirement",
    "cadence",
    "primary_strategy",
    "required_controls",
  ],
  live_sandbox: ["status", "requirement", "cadence", "authorization", "targets"],
  eval_qualification: ["status", "requirement", "cadence", "plan", "golden_sets"],
  ops_hardening: ["status", "requirement", "cadence", "obligations"],
} as const satisfies Record<(typeof LAYER_KEYS)[number], readonly string[]>;

const LAYER_REQUIREMENTS = {
  invariant_contract: "blocking",
  hermetic_system: "blocking",
  live_sandbox: "blocking_when_applicable",
  eval_qualification: "blocking_on_prompt_model_harness_or_rubric_change",
  ops_hardening: "blocking",
} as const satisfies Record<(typeof LAYER_KEYS)[number], string>;

const GATE_FIELD_KEYS = {
  invariant_contract: ["requirement", "frequency"],
  hermetic_system: ["requirement", "frequency"],
  live_sandbox: ["requirement", "frequency"],
  llm_contract: ["requirement", "frequency"],
  llm_quality: ["requirement", "frequency", "threshold", "on_failure"],
  judge_meta_eval: ["requirement", "frequency", "thresholds", "on_failure"],
  ops_hardening: ["requirement", "frequency"],
} as const satisfies Record<(typeof GATE_KEYS)[number], readonly string[]>;

const GATE_REQUIREMENTS = {
  invariant_contract: "blocking",
  hermetic_system: "blocking",
  live_sandbox: "blocking_when_applicable",
  llm_contract: "blocking",
  llm_quality: "blocking",
  judge_meta_eval: "blocking",
  ops_hardening: "blocking",
} as const satisfies Record<(typeof GATE_KEYS)[number], string>;

export interface ValidationPolicy {
  schema_version: 1;
  status: string;
  scope: "product";
  product: "operon";
  default_tier: "C3";
  authorizations: {
    layer_4_episode_planner: {
      id: "OPERON-L4-001";
      status: "human_authorized";
      authorized_on: "2026-07-30";
      call_site_id: "OPERON-LLM-001";
      call_site_name: "Episode Planner";
      assignment: {
        harness: "claude";
        model: "claude-opus-5";
        effort: "xhigh";
      };
      corpus: {
        cases: 10;
        runs_per_case: 3;
        total_attempts: 30;
        authored_before_prompt_tuning: false;
        frozen_before_campaign: true;
      };
      quality: {
        rubric: "smallest_sufficient_safe_executable_episode_plan";
        deterministic_contracts: "blocking";
        overall_min_acceptable: 27;
        min_acceptable_per_case: 2;
        critical_min_acceptable_per_case: 3;
      };
      spend: {
        aggregate_ceiling_usd: 60;
        per_turn_ceiling_usd: 5;
        stop_before_exceeding: true;
      };
      failure_handling: {
        qualification_on_failure: "none";
        preserve_current_assignment: true;
        preserve_evidence: true;
        prompt_or_corpus_edit_to_green: "prohibited";
      };
      authorization_source: string;
    };
    layer_4_episode_planner_diagnostic: {
      id: "OPERON-L4-002";
      status: "human_authorized";
      authorized_on: "2026-07-30";
      parent_campaign_id: "OPERON-L4-001";
      call_site_id: "OPERON-LLM-001";
      call_site_name: "Episode Planner";
      assignment: {
        harness: "claude";
        model: "claude-opus-5";
        effort: "xhigh";
      };
      candidate_prompt: {
        base_sha256: string;
        overlay_sha256: string;
        assembled_sha256: string;
        protected_prompt_adoption: "not_authorized";
      };
      corpus: {
        source_campaign_id: "OPERON-L4-001";
        corpus_sha256: string;
        case_id: "OPERON-EP-003";
        runs_per_case: 3;
        total_attempts: 3;
        frozen_read_only: true;
      };
      quality: {
        diagnostic_only: true;
        qualification_claim: "prohibited";
        deterministic_contracts: "3_of_3";
        acceptable_attempts: "3_of_3";
      };
      spend: {
        aggregate_ceiling_usd: 10;
        per_turn_ceiling_usd: 5;
        stop_before_exceeding: true;
      };
      failure_handling: {
        qualification_on_failure: "none";
        qualification_on_pass: "none";
        preserve_current_assignment: true;
        preserve_evidence: true;
        prompt_or_corpus_edit_to_green: "prohibited";
      };
      external_effects_authorized: false;
      authorization_source: string;
    };
    layer_4_episode_planner_qualification: {
      id: "OPERON-L4-002";
      stage: "qualification";
      status: "human_authorized";
      authorized_on: "2026-07-30";
      parent_campaign_id: "OPERON-L4-001";
      call_site_id: "OPERON-LLM-001";
      call_site_name: "Episode Planner";
      assignment: {
        harness: "claude";
        model: "claude-opus-5";
        effort: "xhigh";
      };
      candidate_prompt: {
        base_sha256: string;
        overlay_sha256: string;
        assembled_sha256: string;
        protected_prompt_adoption: "not_authorized";
      };
      diagnostic_evidence: {
        report_sha256: string;
        audit_sha256: string;
        required_status: "passed";
      };
      corpus: {
        source_campaign_id: "OPERON-L4-001";
        corpus_sha256: string;
        cases: 10;
        runs_per_case: 3;
        total_attempts: 30;
        frozen_read_only: true;
      };
      quality: {
        rubric: "smallest_sufficient_safe_executable_episode_plan";
        deterministic_contracts: "blocking";
        overall_min_acceptable: 27;
        min_acceptable_per_case: 2;
        critical_min_acceptable_per_case: 3;
      };
      spend: {
        aggregate_ceiling_usd: 60;
        per_turn_ceiling_usd: 5;
        stop_before_exceeding: true;
      };
      failure_handling: {
        qualification_on_failure: "none";
        preserve_current_assignment: true;
        preserve_evidence: true;
        prompt_or_corpus_edit_to_green: "prohibited";
      };
      external_effects_authorized: false;
      production_assignment_change: "not_authorized";
      authorization_source: string;
    };
    layer_4_episode_planner_l4_003_diagnostic: {
      id: "OPERON-L4-003";
      status: "human_authorized_by_delegation";
      authorized_on: "2026-07-30";
      parent_campaign_id: "OPERON-L4-002";
      call_site_id: "OPERON-LLM-001";
      call_site_name: "Episode Planner";
      assignment: {
        harness: "claude";
        model: "claude-opus-5";
        effort: "xhigh";
      };
      candidate_prompt: {
        base_sha256: string;
        overlay_sha256: string;
        assembled_sha256: string;
        protected_prompt_adoption: "not_authorized";
      };
      corpus: {
        source_campaign_id: "OPERON-L4-001";
        corpus_sha256: string;
        case_id: "OPERON-EP-004";
        runs_per_case: 3;
        total_attempts: 3;
        frozen_read_only: true;
      };
      quality: {
        diagnostic_only: true;
        qualification_claim: "prohibited";
        deterministic_contracts: "3_of_3";
        acceptable_attempts: "3_of_3";
      };
      spend: {
        aggregate_ceiling_usd: 10;
        per_turn_ceiling_usd: 5;
        stop_before_exceeding: true;
      };
      failure_handling: {
        qualification_on_failure: "none";
        qualification_on_pass: "none";
        preserve_current_assignment: true;
        preserve_evidence: true;
        prompt_or_corpus_edit_to_green: "prohibited";
      };
      external_effects_authorized: false;
      authorization_source: string;
    };
    layer_4_episode_planner_l4_004_diagnostic: {
      id: "OPERON-L4-004";
      status: "human_authorized_by_delegation";
      authorized_on: "2026-07-30";
      parent_campaign_id: "OPERON-L4-003";
      call_site_id: "OPERON-LLM-001";
      call_site_name: "Episode Planner";
      assignment: {
        harness: "claude";
        model: "claude-opus-5";
        effort: "xhigh";
      };
      candidate_prompt: {
        base_sha256: string;
        overlay_sha256: string;
        assembled_sha256: string;
        protected_prompt_adoption: "not_authorized";
      };
      corpus: {
        source_campaign_id: "OPERON-L4-001";
        corpus_sha256: string;
        case_id: "OPERON-EP-003";
        runs_per_case: 3;
        total_attempts: 3;
        frozen_read_only: true;
      };
      quality: {
        diagnostic_only: true;
        qualification_claim: "prohibited";
        deterministic_contracts: "3_of_3";
        acceptable_attempts: "3_of_3";
      };
      spend: {
        aggregate_ceiling_usd: 10;
        per_turn_ceiling_usd: 5;
        stop_before_exceeding: true;
      };
      failure_handling: {
        qualification_on_failure: "none";
        qualification_on_pass: "none";
        preserve_current_assignment: true;
        preserve_evidence: true;
        prompt_or_corpus_edit_to_green: "prohibited";
      };
      external_effects_authorized: false;
      authorization_source: string;
    };
    layer_4_episode_planner_l4_005_diagnostic: {
      id: "OPERON-L4-005";
      status: "human_authorized_by_delegation";
      authorized_on: "2026-07-30";
      parent_campaign_id: "OPERON-L4-004";
      call_site_id: "OPERON-LLM-001";
      call_site_name: "Episode Planner";
      assignment: {
        harness: "claude";
        model: "claude-opus-5";
        effort: "xhigh";
      };
      candidate_prompt: {
        base_sha256: string;
        overlay_sha256: string;
        assembled_sha256: string;
        protected_prompt_adoption: "not_authorized";
      };
      corpus: {
        source_campaign_id: "OPERON-L4-001";
        corpus_sha256: string;
        case_id: "OPERON-EP-004";
        runs_per_case: 3;
        total_attempts: 3;
        frozen_read_only: true;
      };
      quality: {
        diagnostic_only: true;
        qualification_claim: "prohibited";
        deterministic_contracts: "3_of_3";
        acceptable_attempts: "3_of_3";
      };
      spend: {
        aggregate_ceiling_usd: 10;
        per_turn_ceiling_usd: 5;
        stop_before_exceeding: true;
      };
      failure_handling: {
        qualification_on_failure: "none";
        qualification_on_pass: "none";
        preserve_current_assignment: true;
        preserve_evidence: true;
        prompt_or_corpus_edit_to_green: "prohibited";
      };
      external_effects_authorized: false;
      authorization_source: string;
    };
    layer_4_episode_planner_l4_004_qualification: {
      id: "OPERON-L4-004";
      stage: "qualification";
      status: "human_authorized_by_delegation";
      authorized_on: "2026-07-30";
      parent_campaign_id: "OPERON-L4-003";
      call_site_id: "OPERON-LLM-001";
      call_site_name: "Episode Planner";
      assignment: {
        harness: "claude";
        model: "claude-opus-5";
        effort: "xhigh";
      };
      candidate_prompt: {
        base_sha256: string;
        overlay_sha256: string;
        assembled_sha256: string;
        protected_prompt_adoption: "not_authorized";
      };
      diagnostic_evidence: {
        report_sha256: string;
        audit_sha256: string;
        required_status: "passed";
      };
      corpus: {
        source_campaign_id: "OPERON-L4-001";
        corpus_sha256: string;
        cases: 10;
        runs_per_case: 3;
        total_attempts: 30;
        frozen_read_only: true;
      };
      quality: {
        rubric: "smallest_sufficient_safe_executable_episode_plan";
        deterministic_contracts: "blocking";
        overall_min_acceptable: 27;
        min_acceptable_per_case: 2;
        critical_min_acceptable_per_case: 3;
      };
      spend: {
        aggregate_ceiling_usd: 60;
        per_turn_ceiling_usd: 5;
        stop_before_exceeding: true;
      };
      failure_handling: {
        qualification_on_failure: "none";
        preserve_current_assignment: true;
        preserve_evidence: true;
        prompt_or_corpus_edit_to_green: "prohibited";
      };
      external_effects_authorized: false;
      production_assignment_change: "not_authorized";
      authorization_source: string;
    };
    layer_4_episode_planner_l4_005_qualification: {
      id: "OPERON-L4-005";
      stage: "qualification";
      status: "human_authorized_by_delegation";
      authorized_on: "2026-07-30";
      parent_campaign_id: "OPERON-L4-004";
      call_site_id: "OPERON-LLM-001";
      call_site_name: "Episode Planner";
      assignment: {
        harness: "claude";
        model: "claude-opus-5";
        effort: "xhigh";
      };
      candidate_prompt: {
        base_sha256: string;
        overlay_sha256: string;
        assembled_sha256: string;
        protected_prompt_adoption: "not_authorized";
      };
      diagnostic_evidence: {
        report_sha256: string;
        audit_sha256: string;
        required_status: "passed";
      };
      corpus: {
        source_campaign_id: "OPERON-L4-001";
        corpus_sha256: string;
        cases: 10;
        runs_per_case: 3;
        total_attempts: 30;
        frozen_read_only: true;
      };
      quality: {
        rubric: "smallest_sufficient_safe_executable_episode_plan";
        deterministic_contracts: "blocking";
        overall_min_acceptable: 27;
        min_acceptable_per_case: 2;
        critical_min_acceptable_per_case: 3;
      };
      spend: {
        aggregate_ceiling_usd: 60;
        per_turn_ceiling_usd: 5;
        stop_before_exceeding: true;
      };
      failure_handling: {
        qualification_on_failure: "none";
        preserve_current_assignment: true;
        preserve_evidence: true;
        prompt_or_corpus_edit_to_green: "prohibited";
      };
      external_effects_authorized: false;
      production_assignment_change: "not_authorized";
      authorization_source: string;
    };
    layer_4_episode_planner_l4_003_qualification: {
      id: "OPERON-L4-003";
      stage: "qualification";
      status: "human_authorized_by_delegation";
      authorized_on: "2026-07-30";
      parent_campaign_id: "OPERON-L4-002";
      call_site_id: "OPERON-LLM-001";
      call_site_name: "Episode Planner";
      assignment: {
        harness: "claude";
        model: "claude-opus-5";
        effort: "xhigh";
      };
      candidate_prompt: {
        base_sha256: string;
        overlay_sha256: string;
        assembled_sha256: string;
        protected_prompt_adoption: "not_authorized";
      };
      diagnostic_evidence: {
        report_sha256: string;
        audit_sha256: string;
        required_status: "passed_with_attributable_original_verdict_defect";
      };
      corpus: {
        source_campaign_id: "OPERON-L4-001";
        corpus_sha256: string;
        cases: 10;
        runs_per_case: 3;
        total_attempts: 30;
        frozen_read_only: true;
      };
      quality: {
        rubric: "smallest_sufficient_safe_executable_episode_plan";
        deterministic_contracts: "blocking";
        overall_min_acceptable: 27;
        min_acceptable_per_case: 2;
        critical_min_acceptable_per_case: 3;
      };
      spend: {
        aggregate_ceiling_usd: 60;
        per_turn_ceiling_usd: 5;
        stop_before_exceeding: true;
      };
      failure_handling: {
        qualification_on_failure: "none";
        preserve_current_assignment: true;
        preserve_evidence: true;
        prompt_or_corpus_edit_to_green: "prohibited";
      };
      external_effects_authorized: false;
      production_assignment_change: "not_authorized";
      authorization_source: string;
    };
    layer_3_external_operations: "not_authorized";
    additive_ci: "not_authorized";
    production_shaped_soak: "not_authorized";
  };
  coexistence: {
    posture: "parallel-greenfield";
    isolated_root: "./";
    protected_paths: string[];
    incumbent_gates: "read_only";
    ci_integration: "additive_opt_in";
    cutover_requires: string[];
  };
  invariants: Array<{ id: string; enforcement: string[] }>;
  layers: Record<(typeof LAYER_KEYS)[number], Record<string, unknown>>;
  gates: Record<(typeof GATE_KEYS)[number], Record<string, unknown>>;
  tooling: {
    status: "ratified";
    isolation: {
      harness_root: "./";
      package_manifest: "./package.json";
      lockfile: "./pnpm-lock.yaml";
      dependency_policy: "independent_from_product_package";
      generated_output_root: "./.artifacts/";
      product_package_scripts_changed: false;
      incumbent_runner_configuration_changed: false;
    };
    commands: Record<string, string>;
    ci_host: {
      selected: "github_actions";
      integration_status: "not_authorized";
      activation: "future_additive_opt_in_only";
      reason: string;
    };
  };
  implementation: {
    status: string;
    next_step: string;
    walking_skeleton_before_catalog_expansion: true;
    external_operations_authorized: false;
    ci_changes_authorized: false;
  };
  [key: string]: unknown;
}

export async function loadValidationPolicy(path: string): Promise<ValidationPolicy> {
  const source = await readFile(path, "utf8");
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(
      `validation policy YAML is invalid: ${document.errors.map((error) => error.message).join("; ")}`,
    );
  }
  return validateValidationPolicy(document.toJS());
}

export function validateValidationPolicy(value: unknown): ValidationPolicy {
  const root = record(value, "validation policy");
  exactKeys(root, ROOT_KEYS, "validation policy");

  equal(root.schema_version, 1, "schema_version");
  equal(root.scope, "product", "scope");
  equal(root.product, "operon", "product");
  equal(root.default_tier, "C3", "default_tier");
  nonEmptyString(root.status, "status");

  const authorizations = record(root.authorizations, "authorizations");
  exactKeys(
    authorizations,
    [
      "layer_4_episode_planner",
      "layer_4_episode_planner_diagnostic",
      "layer_4_episode_planner_qualification",
      "layer_4_episode_planner_l4_003_diagnostic",
      "layer_4_episode_planner_l4_003_qualification",
      "layer_4_episode_planner_l4_004_diagnostic",
      "layer_4_episode_planner_l4_004_qualification",
      "layer_4_episode_planner_l4_005_diagnostic",
      "layer_4_episode_planner_l4_005_qualification",
      "layer_3_external_operations",
      "additive_ci",
      "production_shaped_soak",
    ],
    "authorizations",
  );
  equal(
    authorizations.layer_3_external_operations,
    "not_authorized",
    "authorizations.layer_3_external_operations",
  );
  equal(authorizations.additive_ci, "not_authorized", "authorizations.additive_ci");
  equal(
    authorizations.production_shaped_soak,
    "not_authorized",
    "authorizations.production_shaped_soak",
  );
  const layer4Authorization = record(
    authorizations.layer_4_episode_planner,
    "authorizations.layer_4_episode_planner",
  );
  exactKeys(
    layer4Authorization,
    [
      "id",
      "status",
      "authorized_on",
      "call_site_id",
      "call_site_name",
      "assignment",
      "corpus",
      "quality",
      "spend",
      "failure_handling",
      "authorization_source",
    ],
    "authorizations.layer_4_episode_planner",
  );
  equal(layer4Authorization.id, "OPERON-L4-001", "authorizations.layer_4_episode_planner.id");
  equal(
    layer4Authorization.status,
    "human_authorized",
    "authorizations.layer_4_episode_planner.status",
  );
  equal(
    layer4Authorization.authorized_on,
    "2026-07-30",
    "authorizations.layer_4_episode_planner.authorized_on",
  );
  equal(
    layer4Authorization.call_site_id,
    "OPERON-LLM-001",
    "authorizations.layer_4_episode_planner.call_site_id",
  );
  equal(
    layer4Authorization.call_site_name,
    "Episode Planner",
    "authorizations.layer_4_episode_planner.call_site_name",
  );
  const assignment = record(
    layer4Authorization.assignment,
    "authorizations.layer_4_episode_planner.assignment",
  );
  exactKeys(
    assignment,
    ["harness", "model", "effort"],
    "authorizations.layer_4_episode_planner.assignment",
  );
  equal(assignment.harness, "claude", "authorizations.layer_4_episode_planner.assignment.harness");
  equal(
    assignment.model,
    "claude-opus-5",
    "authorizations.layer_4_episode_planner.assignment.model",
  );
  equal(assignment.effort, "xhigh", "authorizations.layer_4_episode_planner.assignment.effort");
  const corpus = record(
    layer4Authorization.corpus,
    "authorizations.layer_4_episode_planner.corpus",
  );
  exactKeys(
    corpus,
    [
      "cases",
      "runs_per_case",
      "total_attempts",
      "authored_before_prompt_tuning",
      "frozen_before_campaign",
    ],
    "authorizations.layer_4_episode_planner.corpus",
  );
  equal(corpus.cases, 10, "authorizations.layer_4_episode_planner.corpus.cases");
  equal(corpus.runs_per_case, 3, "authorizations.layer_4_episode_planner.corpus.runs_per_case");
  equal(corpus.total_attempts, 30, "authorizations.layer_4_episode_planner.corpus.total_attempts");
  equal(
    corpus.authored_before_prompt_tuning,
    false,
    "authorizations.layer_4_episode_planner.corpus.authored_before_prompt_tuning",
  );
  equal(
    corpus.frozen_before_campaign,
    true,
    "authorizations.layer_4_episode_planner.corpus.frozen_before_campaign",
  );
  const quality = record(
    layer4Authorization.quality,
    "authorizations.layer_4_episode_planner.quality",
  );
  exactKeys(
    quality,
    [
      "rubric",
      "deterministic_contracts",
      "overall_min_acceptable",
      "min_acceptable_per_case",
      "critical_min_acceptable_per_case",
    ],
    "authorizations.layer_4_episode_planner.quality",
  );
  equal(
    quality.rubric,
    "smallest_sufficient_safe_executable_episode_plan",
    "authorizations.layer_4_episode_planner.quality.rubric",
  );
  equal(
    quality.deterministic_contracts,
    "blocking",
    "authorizations.layer_4_episode_planner.quality.deterministic_contracts",
  );
  equal(
    quality.overall_min_acceptable,
    27,
    "authorizations.layer_4_episode_planner.quality.overall_min_acceptable",
  );
  equal(
    quality.min_acceptable_per_case,
    2,
    "authorizations.layer_4_episode_planner.quality.min_acceptable_per_case",
  );
  equal(
    quality.critical_min_acceptable_per_case,
    3,
    "authorizations.layer_4_episode_planner.quality.critical_min_acceptable_per_case",
  );
  const spend = record(
    layer4Authorization.spend,
    "authorizations.layer_4_episode_planner.spend",
  );
  exactKeys(
    spend,
    ["aggregate_ceiling_usd", "per_turn_ceiling_usd", "stop_before_exceeding"],
    "authorizations.layer_4_episode_planner.spend",
  );
  equal(
    spend.aggregate_ceiling_usd,
    60,
    "authorizations.layer_4_episode_planner.spend.aggregate_ceiling_usd",
  );
  equal(
    spend.per_turn_ceiling_usd,
    5,
    "authorizations.layer_4_episode_planner.spend.per_turn_ceiling_usd",
  );
  equal(
    spend.stop_before_exceeding,
    true,
    "authorizations.layer_4_episode_planner.spend.stop_before_exceeding",
  );
  const failureHandling = record(
    layer4Authorization.failure_handling,
    "authorizations.layer_4_episode_planner.failure_handling",
  );
  exactKeys(
    failureHandling,
    [
      "qualification_on_failure",
      "preserve_current_assignment",
      "preserve_evidence",
      "prompt_or_corpus_edit_to_green",
    ],
    "authorizations.layer_4_episode_planner.failure_handling",
  );
  equal(
    failureHandling.qualification_on_failure,
    "none",
    "authorizations.layer_4_episode_planner.failure_handling.qualification_on_failure",
  );
  equal(
    failureHandling.preserve_current_assignment,
    true,
    "authorizations.layer_4_episode_planner.failure_handling.preserve_current_assignment",
  );
  equal(
    failureHandling.preserve_evidence,
    true,
    "authorizations.layer_4_episode_planner.failure_handling.preserve_evidence",
  );
  equal(
    failureHandling.prompt_or_corpus_edit_to_green,
    "prohibited",
    "authorizations.layer_4_episode_planner.failure_handling.prompt_or_corpus_edit_to_green",
  );
  nonEmptyString(
    layer4Authorization.authorization_source,
    "authorizations.layer_4_episode_planner.authorization_source",
  );

  const diagnosticAuthorization = record(
    authorizations.layer_4_episode_planner_diagnostic,
    "authorizations.layer_4_episode_planner_diagnostic",
  );
  exactKeys(
    diagnosticAuthorization,
    [
      "id",
      "status",
      "authorized_on",
      "parent_campaign_id",
      "call_site_id",
      "call_site_name",
      "assignment",
      "candidate_prompt",
      "corpus",
      "quality",
      "spend",
      "failure_handling",
      "external_effects_authorized",
      "authorization_source",
    ],
    "authorizations.layer_4_episode_planner_diagnostic",
  );
  equal(
    diagnosticAuthorization.id,
    "OPERON-L4-002",
    "authorizations.layer_4_episode_planner_diagnostic.id",
  );
  equal(
    diagnosticAuthorization.status,
    "human_authorized",
    "authorizations.layer_4_episode_planner_diagnostic.status",
  );
  equal(
    diagnosticAuthorization.authorized_on,
    "2026-07-30",
    "authorizations.layer_4_episode_planner_diagnostic.authorized_on",
  );
  equal(
    diagnosticAuthorization.parent_campaign_id,
    "OPERON-L4-001",
    "authorizations.layer_4_episode_planner_diagnostic.parent_campaign_id",
  );
  equal(
    diagnosticAuthorization.call_site_id,
    "OPERON-LLM-001",
    "authorizations.layer_4_episode_planner_diagnostic.call_site_id",
  );
  equal(
    diagnosticAuthorization.call_site_name,
    "Episode Planner",
    "authorizations.layer_4_episode_planner_diagnostic.call_site_name",
  );
  const diagnosticAssignment = record(
    diagnosticAuthorization.assignment,
    "authorizations.layer_4_episode_planner_diagnostic.assignment",
  );
  exactKeys(
    diagnosticAssignment,
    ["harness", "model", "effort"],
    "authorizations.layer_4_episode_planner_diagnostic.assignment",
  );
  equal(
    diagnosticAssignment.harness,
    "claude",
    "authorizations.layer_4_episode_planner_diagnostic.assignment.harness",
  );
  equal(
    diagnosticAssignment.model,
    "claude-opus-5",
    "authorizations.layer_4_episode_planner_diagnostic.assignment.model",
  );
  equal(
    diagnosticAssignment.effort,
    "xhigh",
    "authorizations.layer_4_episode_planner_diagnostic.assignment.effort",
  );
  const diagnosticPrompt = record(
    diagnosticAuthorization.candidate_prompt,
    "authorizations.layer_4_episode_planner_diagnostic.candidate_prompt",
  );
  exactKeys(
    diagnosticPrompt,
    [
      "base_sha256",
      "overlay_sha256",
      "assembled_sha256",
      "protected_prompt_adoption",
    ],
    "authorizations.layer_4_episode_planner_diagnostic.candidate_prompt",
  );
  for (const field of ["base_sha256", "overlay_sha256", "assembled_sha256"] as const) {
    const digest = nonEmptyString(
      diagnosticPrompt[field],
      `authorizations.layer_4_episode_planner_diagnostic.candidate_prompt.${field}`,
    );
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error(
        `authorizations.layer_4_episode_planner_diagnostic.candidate_prompt.${field} ` +
          "must be a SHA-256 digest",
      );
    }
  }
  equal(
    diagnosticPrompt.protected_prompt_adoption,
    "not_authorized",
    "authorizations.layer_4_episode_planner_diagnostic.candidate_prompt.protected_prompt_adoption",
  );
  const diagnosticCorpus = record(
    diagnosticAuthorization.corpus,
    "authorizations.layer_4_episode_planner_diagnostic.corpus",
  );
  exactKeys(
    diagnosticCorpus,
    [
      "source_campaign_id",
      "corpus_sha256",
      "case_id",
      "runs_per_case",
      "total_attempts",
      "frozen_read_only",
    ],
    "authorizations.layer_4_episode_planner_diagnostic.corpus",
  );
  equal(
    diagnosticCorpus.source_campaign_id,
    "OPERON-L4-001",
    "authorizations.layer_4_episode_planner_diagnostic.corpus.source_campaign_id",
  );
  equal(
    diagnosticCorpus.corpus_sha256,
    "4756fe437be194892b4c9f8a5efaff30d77d3ba3974c1d66c338666c4b52b3a0",
    "authorizations.layer_4_episode_planner_diagnostic.corpus.corpus_sha256",
  );
  equal(
    diagnosticCorpus.case_id,
    "OPERON-EP-003",
    "authorizations.layer_4_episode_planner_diagnostic.corpus.case_id",
  );
  equal(
    diagnosticCorpus.runs_per_case,
    3,
    "authorizations.layer_4_episode_planner_diagnostic.corpus.runs_per_case",
  );
  equal(
    diagnosticCorpus.total_attempts,
    3,
    "authorizations.layer_4_episode_planner_diagnostic.corpus.total_attempts",
  );
  equal(
    diagnosticCorpus.frozen_read_only,
    true,
    "authorizations.layer_4_episode_planner_diagnostic.corpus.frozen_read_only",
  );
  const diagnosticQuality = record(
    diagnosticAuthorization.quality,
    "authorizations.layer_4_episode_planner_diagnostic.quality",
  );
  exactKeys(
    diagnosticQuality,
    [
      "diagnostic_only",
      "qualification_claim",
      "deterministic_contracts",
      "acceptable_attempts",
    ],
    "authorizations.layer_4_episode_planner_diagnostic.quality",
  );
  equal(
    diagnosticQuality.diagnostic_only,
    true,
    "authorizations.layer_4_episode_planner_diagnostic.quality.diagnostic_only",
  );
  equal(
    diagnosticQuality.qualification_claim,
    "prohibited",
    "authorizations.layer_4_episode_planner_diagnostic.quality.qualification_claim",
  );
  equal(
    diagnosticQuality.deterministic_contracts,
    "3_of_3",
    "authorizations.layer_4_episode_planner_diagnostic.quality.deterministic_contracts",
  );
  equal(
    diagnosticQuality.acceptable_attempts,
    "3_of_3",
    "authorizations.layer_4_episode_planner_diagnostic.quality.acceptable_attempts",
  );
  const diagnosticSpend = record(
    diagnosticAuthorization.spend,
    "authorizations.layer_4_episode_planner_diagnostic.spend",
  );
  exactKeys(
    diagnosticSpend,
    ["aggregate_ceiling_usd", "per_turn_ceiling_usd", "stop_before_exceeding"],
    "authorizations.layer_4_episode_planner_diagnostic.spend",
  );
  equal(
    diagnosticSpend.aggregate_ceiling_usd,
    10,
    "authorizations.layer_4_episode_planner_diagnostic.spend.aggregate_ceiling_usd",
  );
  equal(
    diagnosticSpend.per_turn_ceiling_usd,
    5,
    "authorizations.layer_4_episode_planner_diagnostic.spend.per_turn_ceiling_usd",
  );
  equal(
    diagnosticSpend.stop_before_exceeding,
    true,
    "authorizations.layer_4_episode_planner_diagnostic.spend.stop_before_exceeding",
  );
  const diagnosticFailure = record(
    diagnosticAuthorization.failure_handling,
    "authorizations.layer_4_episode_planner_diagnostic.failure_handling",
  );
  exactKeys(
    diagnosticFailure,
    [
      "qualification_on_failure",
      "qualification_on_pass",
      "preserve_current_assignment",
      "preserve_evidence",
      "prompt_or_corpus_edit_to_green",
    ],
    "authorizations.layer_4_episode_planner_diagnostic.failure_handling",
  );
  equal(
    diagnosticFailure.qualification_on_failure,
    "none",
    "authorizations.layer_4_episode_planner_diagnostic.failure_handling.qualification_on_failure",
  );
  equal(
    diagnosticFailure.qualification_on_pass,
    "none",
    "authorizations.layer_4_episode_planner_diagnostic.failure_handling.qualification_on_pass",
  );
  equal(
    diagnosticFailure.preserve_current_assignment,
    true,
    "authorizations.layer_4_episode_planner_diagnostic.failure_handling.preserve_current_assignment",
  );
  equal(
    diagnosticFailure.preserve_evidence,
    true,
    "authorizations.layer_4_episode_planner_diagnostic.failure_handling.preserve_evidence",
  );
  equal(
    diagnosticFailure.prompt_or_corpus_edit_to_green,
    "prohibited",
    "authorizations.layer_4_episode_planner_diagnostic.failure_handling.prompt_or_corpus_edit_to_green",
  );
  equal(
    diagnosticAuthorization.external_effects_authorized,
    false,
    "authorizations.layer_4_episode_planner_diagnostic.external_effects_authorized",
  );
  nonEmptyString(
    diagnosticAuthorization.authorization_source,
    "authorizations.layer_4_episode_planner_diagnostic.authorization_source",
  );
  validateLayer4QualificationAuthorization(
    authorizations.layer_4_episode_planner_qualification,
  );
  validateLayer4FollowupDiagnosticAuthorization(
    authorizations.layer_4_episode_planner_l4_003_diagnostic,
    {
      label: "authorizations.layer_4_episode_planner_l4_003_diagnostic",
      campaignId: "OPERON-L4-003",
      parentCampaignId: "OPERON-L4-002",
      caseId: "OPERON-EP-004",
      overlaySha256: "b3d8ad00ef6109ba31f03aa274f46d329aea9b6dc71120fb7fe3fb6652f17fdf",
      assembledSha256: "162a1c60469d98601ce54a45079b1398d5561b9e77889d2be302e25e35c42427",
    },
  );
  validateLayer4FollowupDiagnosticAuthorization(
    authorizations.layer_4_episode_planner_l4_004_diagnostic,
    {
      label: "authorizations.layer_4_episode_planner_l4_004_diagnostic",
      campaignId: "OPERON-L4-004",
      parentCampaignId: "OPERON-L4-003",
      caseId: "OPERON-EP-003",
      overlaySha256: "4f095bd4e85a267ff8c473ac837f457228a2aade86b4337bf7dac9a33002d26f",
      assembledSha256: "bb2be9cc42a3a10deef8220a236518ccab32199138f0b7a9c2c38521e6459c03",
    },
  );
  validateLayer4FollowupDiagnosticAuthorization(
    authorizations.layer_4_episode_planner_l4_005_diagnostic,
    {
      label: "authorizations.layer_4_episode_planner_l4_005_diagnostic",
      campaignId: "OPERON-L4-005",
      parentCampaignId: "OPERON-L4-004",
      caseId: "OPERON-EP-004",
      overlaySha256: "a8128527d74b2667c3f9535d481a01c1c033956d7764041c24032eb0c757bf2d",
      assembledSha256: "df9ae0a175721a725db17d0039a9a4b8c3b89324937e96715a139208d6c6cd79",
    },
  );
  validateLayer4FollowupQualificationAuthorization(
    authorizations.layer_4_episode_planner_l4_003_qualification,
    {
      label: "authorizations.layer_4_episode_planner_l4_003_qualification",
      campaignId: "OPERON-L4-003",
      parentCampaignId: "OPERON-L4-002",
      overlaySha256: "b3d8ad00ef6109ba31f03aa274f46d329aea9b6dc71120fb7fe3fb6652f17fdf",
      assembledSha256: "162a1c60469d98601ce54a45079b1398d5561b9e77889d2be302e25e35c42427",
      diagnosticReportSha256: "4e1d7ba962e5369d14edb0c9578cd08597c323c8fc75c8acd37fbabd56e155d8",
      diagnosticAuditSha256: "bd81455376655ce4655fce8d5bc721451d3f3082f70a2f461dd70a0f84006018",
      diagnosticStatus: "passed_with_attributable_original_verdict_defect",
    },
  );
  validateLayer4FollowupQualificationAuthorization(
    authorizations.layer_4_episode_planner_l4_004_qualification,
    {
      label: "authorizations.layer_4_episode_planner_l4_004_qualification",
      campaignId: "OPERON-L4-004",
      parentCampaignId: "OPERON-L4-003",
      overlaySha256: "4f095bd4e85a267ff8c473ac837f457228a2aade86b4337bf7dac9a33002d26f",
      assembledSha256: "bb2be9cc42a3a10deef8220a236518ccab32199138f0b7a9c2c38521e6459c03",
      diagnosticReportSha256: "29856b9ccf47443eeaca3973323dacd9844eb31a46673b98c96f9157b28ba292",
      diagnosticAuditSha256: "76864ec2d3f74284762cfd51cd85068ae3424f4241347cd1bed2c6c5d613abc4",
      diagnosticStatus: "passed",
    },
  );
  validateLayer4FollowupQualificationAuthorization(
    authorizations.layer_4_episode_planner_l4_005_qualification,
    {
      label: "authorizations.layer_4_episode_planner_l4_005_qualification",
      campaignId: "OPERON-L4-005",
      parentCampaignId: "OPERON-L4-004",
      overlaySha256: "a8128527d74b2667c3f9535d481a01c1c033956d7764041c24032eb0c757bf2d",
      assembledSha256: "df9ae0a175721a725db17d0039a9a4b8c3b89324937e96715a139208d6c6cd79",
      diagnosticReportSha256: "5c30143e4e6525ff272be5e14efd2068643643f35e264cdad1eab2f8ca299584",
      diagnosticAuditSha256: "70c7f468c5714183fd1e0b4f15bee811b58ecad1a9710b6f414a9642252985d0",
      diagnosticStatus: "passed",
    },
  );

  const coexistence = record(root.coexistence, "coexistence");
  exactKeys(
    coexistence,
    [
      "posture",
      "isolated_root",
      "protected_paths",
      "incumbent_gates",
      "ci_integration",
      "cutover_requires",
    ],
    "coexistence",
  );
  equal(coexistence.posture, "parallel-greenfield", "coexistence.posture");
  equal(coexistence.isolated_root, "./", "coexistence.isolated_root");
  equal(coexistence.incumbent_gates, "read_only", "coexistence.incumbent_gates");
  equal(coexistence.ci_integration, "additive_opt_in", "coexistence.ci_integration");
  const protectedPaths = stringArray(coexistence.protected_paths, "coexistence.protected_paths");
  for (const required of ["../test/", "../eval/"]) {
    if (!protectedPaths.includes(required)) {
      throw new Error(`coexistence.protected_paths must include ${required}`);
    }
  }
  stringArray(coexistence.cutover_requires, "coexistence.cutover_requires");

  const invariants = array(root.invariants, "invariants");
  if (invariants.length !== 12) {
    throw new Error(`invariants must contain the 12 ratified invariants; found ${invariants.length}`);
  }
  const invariantIds = invariants.map((entry, index) => {
    const invariant = record(entry, `invariants[${index}]`);
    exactKeys(
      invariant,
      ["id", "name", "statement", "enforcement", "source"],
      `invariants[${index}]`,
    );
    const id = nonEmptyString(invariant.id, `invariants[${index}].id`);
    nonEmptyString(invariant.name, `invariants[${index}].name`);
    nonEmptyString(invariant.statement, `invariants[${index}].statement`);
    equal(invariant.source, "./invariants.md", `invariants[${index}].source`);
    const enforcement = stringArray(
      invariant.enforcement,
      `invariants[${index}].enforcement`,
    );
    exactMembers(
      enforcement,
      ["runtime_guardrail", "test"],
      `invariants[${index}].enforcement`,
    );
    return id;
  });
  if (new Set(invariantIds).size !== invariantIds.length) {
    throw new Error("invariant ids must be unique");
  }

  const layers = record(root.layers, "layers");
  exactKeys(layers, LAYER_KEYS, "layers");
  for (const name of LAYER_KEYS) {
    const layer = record(layers[name], `layers.${name}`);
    exactKeys(layer, LAYER_FIELD_KEYS[name], `layers.${name}`);
    equal(layer.status, "active", `layers.${name}.status`);
    equal(layer.requirement, LAYER_REQUIREMENTS[name], `layers.${name}.requirement`);
  }
  const liveTargets = array(
    record(layers.live_sandbox, "layers.live_sandbox").targets,
    "layers.live_sandbox.targets",
  );
  for (const [index, targetValue] of liveTargets.entries()) {
    const target = record(targetValue, `layers.live_sandbox.targets[${index}]`);
    exactKeys(
      target,
      ["id", "target", "status"],
      `layers.live_sandbox.targets[${index}]`,
    );
    nonEmptyString(target.id, `layers.live_sandbox.targets[${index}].id`);
    nonEmptyString(target.target, `layers.live_sandbox.targets[${index}].target`);
    equal(
      target.status,
      "required_target_not_yet_named",
      `layers.live_sandbox.targets[${index}].status`,
    );
  }

  const gates = record(root.gates, "gates");
  exactKeys(gates, GATE_KEYS, "gates");
  for (const name of GATE_KEYS) {
    const gate = record(gates[name], `gates.${name}`);
    exactKeys(gate, GATE_FIELD_KEYS[name], `gates.${name}`);
    equal(gate.requirement, GATE_REQUIREMENTS[name], `gates.${name}.requirement`);
  }
  const llmQualityThreshold = record(
    record(gates.llm_quality, "gates.llm_quality").threshold,
    "gates.llm_quality.threshold",
  );
  exactKeys(
    llmQualityThreshold,
    ["default", "ratified_slices"],
    "gates.llm_quality.threshold",
  );
  equal(
    llmQualityThreshold.default,
    "unresolved_blocking_absent",
    "gates.llm_quality.threshold.default",
  );
  exactMembers(
    stringArray(llmQualityThreshold.ratified_slices, "gates.llm_quality.threshold.ratified_slices"),
    ["OPERON-L4-001"],
    "gates.llm_quality.threshold.ratified_slices",
  );
  equal(
    record(gates.judge_meta_eval, "gates.judge_meta_eval").thresholds,
    "unresolved_blocking_absent",
    "gates.judge_meta_eval.thresholds",
  );

  const tooling = record(root.tooling, "tooling");
  exactKeys(
    tooling,
    [
      "status",
      "selected_on",
      "selection",
      "isolation",
      "runtime",
      "invariant_contract",
      "hermetic_system",
      "live_sandbox",
      "eval_qualification",
      "ops_hardening",
      "reporting",
      "commands",
      "ci_host",
      "rejected",
    ],
    "tooling",
  );
  equal(tooling.status, "ratified", "tooling.status");
  const isolation = record(tooling.isolation, "tooling.isolation");
  exactKeys(
    isolation,
    [
      "harness_root",
      "package_manifest",
      "lockfile",
      "dependency_policy",
      "generated_output_root",
      "product_package_scripts_changed",
      "incumbent_runner_configuration_changed",
    ],
    "tooling.isolation",
  );
  equal(isolation.harness_root, "./", "tooling.isolation.harness_root");
  equal(isolation.package_manifest, "./package.json", "tooling.isolation.package_manifest");
  equal(isolation.lockfile, "./pnpm-lock.yaml", "tooling.isolation.lockfile");
  equal(
    isolation.dependency_policy,
    "independent_from_product_package",
    "tooling.isolation.dependency_policy",
  );
  equal(isolation.generated_output_root, "./.artifacts/", "tooling.isolation.generated_output_root");
  equal(
    isolation.product_package_scripts_changed,
    false,
    "tooling.isolation.product_package_scripts_changed",
  );
  equal(
    isolation.incumbent_runner_configuration_changed,
    false,
    "tooling.isolation.incumbent_runner_configuration_changed",
  );
  const commands = record(tooling.commands, "tooling.commands");
  exactKeys(
    commands,
    ["install", "deterministic", "sandbox", "qualification", "ops", "all_local_non_spending"],
    "tooling.commands",
  );
  for (const [name, command] of Object.entries(commands)) {
    const text = nonEmptyString(command, `tooling.commands.${name}`);
    if (!text.startsWith("pnpm -C codex-tests ")) {
      throw new Error(`tooling.commands.${name} must remain isolated beneath codex-tests`);
    }
  }
  const ciHost = record(tooling.ci_host, "tooling.ci_host");
  exactKeys(ciHost, ["selected", "integration_status", "activation", "reason"], "tooling.ci_host");
  equal(ciHost.selected, "github_actions", "tooling.ci_host.selected");
  equal(ciHost.integration_status, "not_authorized", "tooling.ci_host.integration_status");
  equal(ciHost.activation, "future_additive_opt_in_only", "tooling.ci_host.activation");

  const implementation = record(root.implementation, "implementation");
  exactKeys(
    implementation,
    [
      "status",
      "next_step",
      "walking_skeleton_before_catalog_expansion",
      "external_operations_authorized",
      "ci_changes_authorized",
    ],
    "implementation",
  );
  nonEmptyString(implementation.status, "implementation.status");
  nonEmptyString(implementation.next_step, "implementation.next_step");
  equal(
    implementation.walking_skeleton_before_catalog_expansion,
    true,
    "implementation.walking_skeleton_before_catalog_expansion",
  );
  equal(
    implementation.external_operations_authorized,
    false,
    "implementation.external_operations_authorized",
  );
  equal(implementation.ci_changes_authorized, false, "implementation.ci_changes_authorized");

  return root as ValidationPolicy;
}

function validateLayer4QualificationAuthorization(value: unknown): void {
  const label = "authorizations.layer_4_episode_planner_qualification";
  const authorization = record(value, label);
  exactKeys(
    authorization,
    [
      "id",
      "stage",
      "status",
      "authorized_on",
      "parent_campaign_id",
      "call_site_id",
      "call_site_name",
      "assignment",
      "candidate_prompt",
      "diagnostic_evidence",
      "corpus",
      "quality",
      "spend",
      "failure_handling",
      "external_effects_authorized",
      "production_assignment_change",
      "authorization_source",
    ],
    label,
  );
  equal(authorization.id, "OPERON-L4-002", `${label}.id`);
  equal(authorization.stage, "qualification", `${label}.stage`);
  equal(authorization.status, "human_authorized", `${label}.status`);
  equal(authorization.authorized_on, "2026-07-30", `${label}.authorized_on`);
  equal(authorization.parent_campaign_id, "OPERON-L4-001", `${label}.parent_campaign_id`);
  equal(authorization.call_site_id, "OPERON-LLM-001", `${label}.call_site_id`);
  equal(authorization.call_site_name, "Episode Planner", `${label}.call_site_name`);

  const assignment = record(authorization.assignment, `${label}.assignment`);
  exactKeys(assignment, ["harness", "model", "effort"], `${label}.assignment`);
  equal(assignment.harness, "claude", `${label}.assignment.harness`);
  equal(assignment.model, "claude-opus-5", `${label}.assignment.model`);
  equal(assignment.effort, "xhigh", `${label}.assignment.effort`);

  const prompt = record(authorization.candidate_prompt, `${label}.candidate_prompt`);
  exactKeys(
    prompt,
    ["base_sha256", "overlay_sha256", "assembled_sha256", "protected_prompt_adoption"],
    `${label}.candidate_prompt`,
  );
  for (const field of ["base_sha256", "overlay_sha256", "assembled_sha256"] as const) {
    sha256Digest(prompt[field], `${label}.candidate_prompt.${field}`);
  }
  equal(
    prompt.protected_prompt_adoption,
    "not_authorized",
    `${label}.candidate_prompt.protected_prompt_adoption`,
  );

  const diagnostic = record(
    authorization.diagnostic_evidence,
    `${label}.diagnostic_evidence`,
  );
  exactKeys(
    diagnostic,
    ["report_sha256", "audit_sha256", "required_status"],
    `${label}.diagnostic_evidence`,
  );
  sha256Digest(diagnostic.report_sha256, `${label}.diagnostic_evidence.report_sha256`);
  sha256Digest(diagnostic.audit_sha256, `${label}.diagnostic_evidence.audit_sha256`);
  equal(diagnostic.required_status, "passed", `${label}.diagnostic_evidence.required_status`);

  const corpus = record(authorization.corpus, `${label}.corpus`);
  exactKeys(
    corpus,
    [
      "source_campaign_id",
      "corpus_sha256",
      "cases",
      "runs_per_case",
      "total_attempts",
      "frozen_read_only",
    ],
    `${label}.corpus`,
  );
  equal(corpus.source_campaign_id, "OPERON-L4-001", `${label}.corpus.source_campaign_id`);
  equal(
    corpus.corpus_sha256,
    "4756fe437be194892b4c9f8a5efaff30d77d3ba3974c1d66c338666c4b52b3a0",
    `${label}.corpus.corpus_sha256`,
  );
  equal(corpus.cases, 10, `${label}.corpus.cases`);
  equal(corpus.runs_per_case, 3, `${label}.corpus.runs_per_case`);
  equal(corpus.total_attempts, 30, `${label}.corpus.total_attempts`);
  equal(corpus.frozen_read_only, true, `${label}.corpus.frozen_read_only`);

  const quality = record(authorization.quality, `${label}.quality`);
  exactKeys(
    quality,
    [
      "rubric",
      "deterministic_contracts",
      "overall_min_acceptable",
      "min_acceptable_per_case",
      "critical_min_acceptable_per_case",
    ],
    `${label}.quality`,
  );
  equal(
    quality.rubric,
    "smallest_sufficient_safe_executable_episode_plan",
    `${label}.quality.rubric`,
  );
  equal(quality.deterministic_contracts, "blocking", `${label}.quality.deterministic_contracts`);
  equal(quality.overall_min_acceptable, 27, `${label}.quality.overall_min_acceptable`);
  equal(quality.min_acceptable_per_case, 2, `${label}.quality.min_acceptable_per_case`);
  equal(
    quality.critical_min_acceptable_per_case,
    3,
    `${label}.quality.critical_min_acceptable_per_case`,
  );

  const spend = record(authorization.spend, `${label}.spend`);
  exactKeys(
    spend,
    ["aggregate_ceiling_usd", "per_turn_ceiling_usd", "stop_before_exceeding"],
    `${label}.spend`,
  );
  equal(spend.aggregate_ceiling_usd, 60, `${label}.spend.aggregate_ceiling_usd`);
  equal(spend.per_turn_ceiling_usd, 5, `${label}.spend.per_turn_ceiling_usd`);
  equal(spend.stop_before_exceeding, true, `${label}.spend.stop_before_exceeding`);

  const failure = record(authorization.failure_handling, `${label}.failure_handling`);
  exactKeys(
    failure,
    [
      "qualification_on_failure",
      "preserve_current_assignment",
      "preserve_evidence",
      "prompt_or_corpus_edit_to_green",
    ],
    `${label}.failure_handling`,
  );
  equal(failure.qualification_on_failure, "none", `${label}.failure_handling.qualification_on_failure`);
  equal(
    failure.preserve_current_assignment,
    true,
    `${label}.failure_handling.preserve_current_assignment`,
  );
  equal(failure.preserve_evidence, true, `${label}.failure_handling.preserve_evidence`);
  equal(
    failure.prompt_or_corpus_edit_to_green,
    "prohibited",
    `${label}.failure_handling.prompt_or_corpus_edit_to_green`,
  );
  equal(authorization.external_effects_authorized, false, `${label}.external_effects_authorized`);
  equal(
    authorization.production_assignment_change,
    "not_authorized",
    `${label}.production_assignment_change`,
  );
  nonEmptyString(authorization.authorization_source, `${label}.authorization_source`);
}

function validateLayer4FollowupDiagnosticAuthorization(
  value: unknown,
  specification: {
    label: string;
    campaignId: string;
    parentCampaignId: string;
    caseId: string;
    overlaySha256: string;
    assembledSha256: string;
  },
): void {
  const { label } = specification;
  const authorization = record(value, label);
  exactKeys(
    authorization,
    [
      "id",
      "status",
      "authorized_on",
      "parent_campaign_id",
      "call_site_id",
      "call_site_name",
      "assignment",
      "candidate_prompt",
      "corpus",
      "quality",
      "spend",
      "failure_handling",
      "external_effects_authorized",
      "authorization_source",
    ],
    label,
  );
  for (const [field, expected] of Object.entries({
    id: specification.campaignId,
    status: "human_authorized_by_delegation",
    authorized_on: "2026-07-30",
    parent_campaign_id: specification.parentCampaignId,
    call_site_id: "OPERON-LLM-001",
    call_site_name: "Episode Planner",
    external_effects_authorized: false,
  })) {
    equal(authorization[field], expected, `${label}.${field}`);
  }

  const assignment = record(authorization.assignment, `${label}.assignment`);
  exactKeys(assignment, ["harness", "model", "effort"], `${label}.assignment`);
  equal(assignment.harness, "claude", `${label}.assignment.harness`);
  equal(assignment.model, "claude-opus-5", `${label}.assignment.model`);
  equal(assignment.effort, "xhigh", `${label}.assignment.effort`);

  const prompt = record(authorization.candidate_prompt, `${label}.candidate_prompt`);
  exactKeys(
    prompt,
    ["base_sha256", "overlay_sha256", "assembled_sha256", "protected_prompt_adoption"],
    `${label}.candidate_prompt`,
  );
  equal(
    sha256Digest(prompt.base_sha256, `${label}.candidate_prompt.base_sha256`),
    "232b8d16952d7ba9cf9fb5e09ca381e61d3cc8f56a968263c21c6cfddf091870",
    `${label}.candidate_prompt.base_sha256`,
  );
  equal(
    sha256Digest(prompt.overlay_sha256, `${label}.candidate_prompt.overlay_sha256`),
    specification.overlaySha256,
    `${label}.candidate_prompt.overlay_sha256`,
  );
  equal(
    sha256Digest(prompt.assembled_sha256, `${label}.candidate_prompt.assembled_sha256`),
    specification.assembledSha256,
    `${label}.candidate_prompt.assembled_sha256`,
  );
  equal(
    prompt.protected_prompt_adoption,
    "not_authorized",
    `${label}.candidate_prompt.protected_prompt_adoption`,
  );

  const corpus = record(authorization.corpus, `${label}.corpus`);
  exactKeys(
    corpus,
    [
      "source_campaign_id",
      "corpus_sha256",
      "case_id",
      "runs_per_case",
      "total_attempts",
      "frozen_read_only",
    ],
    `${label}.corpus`,
  );
  for (const [field, expected] of Object.entries({
    source_campaign_id: "OPERON-L4-001",
    corpus_sha256: "4756fe437be194892b4c9f8a5efaff30d77d3ba3974c1d66c338666c4b52b3a0",
    case_id: specification.caseId,
    runs_per_case: 3,
    total_attempts: 3,
    frozen_read_only: true,
  })) {
    equal(corpus[field], expected, `${label}.corpus.${field}`);
  }

  const quality = record(authorization.quality, `${label}.quality`);
  exactKeys(
    quality,
    [
      "diagnostic_only",
      "qualification_claim",
      "deterministic_contracts",
      "acceptable_attempts",
    ],
    `${label}.quality`,
  );
  for (const [field, expected] of Object.entries({
    diagnostic_only: true,
    qualification_claim: "prohibited",
    deterministic_contracts: "3_of_3",
    acceptable_attempts: "3_of_3",
  })) {
    equal(quality[field], expected, `${label}.quality.${field}`);
  }

  const spend = record(authorization.spend, `${label}.spend`);
  exactKeys(
    spend,
    ["aggregate_ceiling_usd", "per_turn_ceiling_usd", "stop_before_exceeding"],
    `${label}.spend`,
  );
  equal(spend.aggregate_ceiling_usd, 10, `${label}.spend.aggregate_ceiling_usd`);
  equal(spend.per_turn_ceiling_usd, 5, `${label}.spend.per_turn_ceiling_usd`);
  equal(spend.stop_before_exceeding, true, `${label}.spend.stop_before_exceeding`);

  const failure = record(authorization.failure_handling, `${label}.failure_handling`);
  exactKeys(
    failure,
    [
      "qualification_on_failure",
      "qualification_on_pass",
      "preserve_current_assignment",
      "preserve_evidence",
      "prompt_or_corpus_edit_to_green",
    ],
    `${label}.failure_handling`,
  );
  for (const [field, expected] of Object.entries({
    qualification_on_failure: "none",
    qualification_on_pass: "none",
    preserve_current_assignment: true,
    preserve_evidence: true,
    prompt_or_corpus_edit_to_green: "prohibited",
  })) {
    equal(failure[field], expected, `${label}.failure_handling.${field}`);
  }
  nonEmptyString(authorization.authorization_source, `${label}.authorization_source`);
}

function validateLayer4FollowupQualificationAuthorization(
  value: unknown,
  specification: {
    label: string;
    campaignId: string;
    parentCampaignId: string;
    overlaySha256: string;
    assembledSha256: string;
    diagnosticReportSha256: string;
    diagnosticAuditSha256: string;
    diagnosticStatus: string;
  },
): void {
  const { label } = specification;
  const authorization = record(value, label);
  exactKeys(
    authorization,
    [
      "id",
      "stage",
      "status",
      "authorized_on",
      "parent_campaign_id",
      "call_site_id",
      "call_site_name",
      "assignment",
      "candidate_prompt",
      "diagnostic_evidence",
      "corpus",
      "quality",
      "spend",
      "failure_handling",
      "external_effects_authorized",
      "production_assignment_change",
      "authorization_source",
    ],
    label,
  );
  for (const [field, expected] of Object.entries({
    id: specification.campaignId,
    stage: "qualification",
    status: "human_authorized_by_delegation",
    authorized_on: "2026-07-30",
    parent_campaign_id: specification.parentCampaignId,
    call_site_id: "OPERON-LLM-001",
    call_site_name: "Episode Planner",
    external_effects_authorized: false,
    production_assignment_change: "not_authorized",
  })) {
    equal(authorization[field], expected, `${label}.${field}`);
  }

  const assignment = record(authorization.assignment, `${label}.assignment`);
  exactKeys(assignment, ["harness", "model", "effort"], `${label}.assignment`);
  equal(assignment.harness, "claude", `${label}.assignment.harness`);
  equal(assignment.model, "claude-opus-5", `${label}.assignment.model`);
  equal(assignment.effort, "xhigh", `${label}.assignment.effort`);

  const prompt = record(authorization.candidate_prompt, `${label}.candidate_prompt`);
  exactKeys(
    prompt,
    ["base_sha256", "overlay_sha256", "assembled_sha256", "protected_prompt_adoption"],
    `${label}.candidate_prompt`,
  );
  for (const [field, expected] of Object.entries({
    base_sha256: "232b8d16952d7ba9cf9fb5e09ca381e61d3cc8f56a968263c21c6cfddf091870",
    overlay_sha256: specification.overlaySha256,
    assembled_sha256: specification.assembledSha256,
  })) {
    equal(
      sha256Digest(prompt[field], `${label}.candidate_prompt.${field}`),
      expected,
      `${label}.candidate_prompt.${field}`,
    );
  }
  equal(
    prompt.protected_prompt_adoption,
    "not_authorized",
    `${label}.candidate_prompt.protected_prompt_adoption`,
  );

  const diagnostic = record(
    authorization.diagnostic_evidence,
    `${label}.diagnostic_evidence`,
  );
  exactKeys(
    diagnostic,
    ["report_sha256", "audit_sha256", "required_status"],
    `${label}.diagnostic_evidence`,
  );
  equal(
    sha256Digest(diagnostic.report_sha256, `${label}.diagnostic_evidence.report_sha256`),
    specification.diagnosticReportSha256,
    `${label}.diagnostic_evidence.report_sha256`,
  );
  equal(
    sha256Digest(diagnostic.audit_sha256, `${label}.diagnostic_evidence.audit_sha256`),
    specification.diagnosticAuditSha256,
    `${label}.diagnostic_evidence.audit_sha256`,
  );
  equal(
    diagnostic.required_status,
    specification.diagnosticStatus,
    `${label}.diagnostic_evidence.required_status`,
  );

  const corpus = record(authorization.corpus, `${label}.corpus`);
  exactKeys(
    corpus,
    [
      "source_campaign_id",
      "corpus_sha256",
      "cases",
      "runs_per_case",
      "total_attempts",
      "frozen_read_only",
    ],
    `${label}.corpus`,
  );
  for (const [field, expected] of Object.entries({
    source_campaign_id: "OPERON-L4-001",
    corpus_sha256: "4756fe437be194892b4c9f8a5efaff30d77d3ba3974c1d66c338666c4b52b3a0",
    cases: 10,
    runs_per_case: 3,
    total_attempts: 30,
    frozen_read_only: true,
  })) {
    equal(corpus[field], expected, `${label}.corpus.${field}`);
  }

  const quality = record(authorization.quality, `${label}.quality`);
  exactKeys(
    quality,
    [
      "rubric",
      "deterministic_contracts",
      "overall_min_acceptable",
      "min_acceptable_per_case",
      "critical_min_acceptable_per_case",
    ],
    `${label}.quality`,
  );
  for (const [field, expected] of Object.entries({
    rubric: "smallest_sufficient_safe_executable_episode_plan",
    deterministic_contracts: "blocking",
    overall_min_acceptable: 27,
    min_acceptable_per_case: 2,
    critical_min_acceptable_per_case: 3,
  })) {
    equal(quality[field], expected, `${label}.quality.${field}`);
  }

  const spend = record(authorization.spend, `${label}.spend`);
  exactKeys(
    spend,
    ["aggregate_ceiling_usd", "per_turn_ceiling_usd", "stop_before_exceeding"],
    `${label}.spend`,
  );
  equal(spend.aggregate_ceiling_usd, 60, `${label}.spend.aggregate_ceiling_usd`);
  equal(spend.per_turn_ceiling_usd, 5, `${label}.spend.per_turn_ceiling_usd`);
  equal(spend.stop_before_exceeding, true, `${label}.spend.stop_before_exceeding`);

  const failure = record(authorization.failure_handling, `${label}.failure_handling`);
  exactKeys(
    failure,
    [
      "qualification_on_failure",
      "preserve_current_assignment",
      "preserve_evidence",
      "prompt_or_corpus_edit_to_green",
    ],
    `${label}.failure_handling`,
  );
  for (const [field, expected] of Object.entries({
    qualification_on_failure: "none",
    preserve_current_assignment: true,
    preserve_evidence: true,
    prompt_or_corpus_edit_to_green: "prohibited",
  })) {
    equal(failure[field], expected, `${label}.failure_handling.${field}`);
  }
  nonEmptyString(authorization.authorization_source, `${label}.authorization_source`);
}

function sha256Digest(value: unknown, label: string): string {
  const digest = nonEmptyString(value, label);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
  return digest;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  const values = array(value, label);
  if (!values.every((entry) => typeof entry === "string" && entry.length > 0)) {
    throw new Error(`${label} must contain only non-empty strings`);
  }
  return values as string[];
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} must be ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}`);
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const expectedSet = new Set(expected);
  const unknown = Object.keys(value).filter((key) => !expectedSet.has(key));
  const missing = expected.filter((key) => !(key in value));
  if (unknown.length > 0) throw new Error(`${label} has unknown key(s): ${unknown.join(", ")}`);
  if (missing.length > 0) throw new Error(`${label} is missing key(s): ${missing.join(", ")}`);
}

function exactMembers(actual: string[], expected: readonly string[], label: string): void {
  if (
    actual.length !== expected.length ||
    expected.some((member) => !actual.includes(member))
  ) {
    throw new Error(`${label} must contain exactly ${expected.join(", ")}`);
  }
}
