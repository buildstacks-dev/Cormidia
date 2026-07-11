// Shared M3/M4 record factories for the learning test suites: one
// spec-shaped ExperimentRecord / CandidateArtifact / InterventionRecord /
// ReviewerVerdict literal each plus an OKF concept-markdown builder,
// override-composable. Kept out of the .test.ts files so suites can share
// them without re-registering each other's tests.

export function makeExperiment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    experiment_id: "exp_builder-test-mapping_01",
    candidate_ref: "cand_20260711_01JGHI",
    unit: "build_ticket",
    hypothesis: "The test-mapping skill reduces review rework without materially increasing cost.",
    control: { fingerprint_ref: "sys_control00001" },
    treatment: { fingerprint_ref: "sys_treatment001" },
    eligibility: { episodes: "evals/roles/builder/standard-tickets", app: "any", stage: ["grow"] },
    primary_metric: {
      name: "review_cycles",
      expected_direction: "decrease",
      min_useful_improvement_pct: 20,
    },
    guardrails: [
      { metric: "merge_success", rule: "must_not_decrease" },
      { metric: "cost_usd", rule: "max_increase_pct", pct: 10 },
    ],
    trials: {
      layer: "replay",
      repetitions: 3,
      early_stop: { on_held_in_failure: true, on_guardrail_trip: true },
    },
    observation: { outcome_maturity_days: 7 },
    stop_thresholds: {
      rollback_immediately_if: { metric: "merge_success", below_control_pct: 20 },
    },
    decision: {
      promote_if: "primary_metric_improves_and_all_guardrails_pass",
      otherwise: "reject_extend_or_revise",
    },
    status: "declared",
    result: null,
    ...overrides,
  };
}

export function makeCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidate_id: "cand_20260711_01JGHI",
    destination: "okf_concept",
    title: "Builder should map acceptance criteria to test files before implementing",
    proposed_scope: "roles/builder",
    proposed_tier: "T1",
    claims_efficacy: false,
    experiment_ref: null,
    error_class: "review.rework_from_missing_tests",
    episode_ids: ["ep_alpha_ticket_0007"],
    event_ids: ["evt_01JABC"],
    evidence_refs: ["research/2026-07-11_example.md"],
    content_hash: `sha256:${"ab".repeat(32)}`,
    ...overrides,
  };
}

export function makeReviewerVerdict(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    candidate_id: "cand_20260711_01JGHI",
    verdict: "approve",
    proposed_destination: "okf_concept",
    proposed_tier: "T1",
    proposed_scope: "roles/builder",
    experiment_required: false,
    rubric: {
      correctness: 5,
      generality: 4,
      scope_fit: 5,
      destination_fit: 5,
      provenance_trust: 5,
      injection_screen: "clean",
    },
    conflicts_with: [],
    duplicates: [],
    eval_required: false,
    eval_present: false,
    rationale: "Grounded in two episodes; narrow scope; no injection markers.",
    reviewed_by: "human-operator",
    reviewed_at: "2026-07-11T08:00:00.000Z",
    ...overrides,
  };
}

export interface ConceptMarkdownOptions {
  name: string;
  id: string;
  scope: string;
  status: "candidate" | "provisional" | "active" | "deprecated" | "archived";
  description?: string;
  tier?: string;
  keywords?: string[];
  created?: string;
  topicKey?: string;
  ttlDays?: number;
  author?: string;
  body?: string;
}

/** A minimal valid governed OKF concept file (spec §3). Top-level status
 *  follows the placement table automatically. */
export function conceptMarkdown(options: ConceptMarkdownOptions): string {
  const topStatus =
    options.status === "deprecated" || options.status === "archived" ? "deprecated" : "active";
  const created = options.created ?? "2026-07-01";
  const lines = [
    "---",
    `name: ${options.name}`,
    `description: ${options.description ?? `Concept ${options.name}`}`,
    "type: procedure",
    `keywords: [${(options.keywords ?? ["learning"]).join(", ")}]`,
    "evidence: []",
    `status: ${topStatus}`,
    `created: ${created}`,
    `updated: ${created}`,
    "loop:",
    `  id: ${options.id}`,
    `  tier: ${options.tier ?? "T1"}`,
    `  status: ${options.status}`,
    `  scope: ${options.scope}`,
    "  version: 1",
    "  claim: authorized",
    ...(options.topicKey !== undefined ? [`  topic_key: ${options.topicKey}`] : []),
    ...(options.ttlDays !== undefined ? [`  ttl_days: ${options.ttlDays}`] : []),
    ...(options.author !== undefined ? [`  author: ${options.author}`] : []),
    "---",
    options.body ?? `Body of ${options.name}.`,
    "",
  ];
  return lines.join("\n");
}

export function makeIntervention(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    intervention_id: "int_20260711_01JKLM",
    candidate_ref: "cand_20260711_01JGHI",
    destination: "ticket",
    reviewed_content_hash: `sha256:${"cd".repeat(32)}`,
    approval_ref: null,
    publish: {
      kind: "issue",
      ref: "owner/alpha#42",
      commit: null,
      published_at: "2026-07-11T08:00:00.000Z",
    },
    activation: null,
    affected_episodes: null,
    experiment_ref: null,
    outcome_ref: null,
    rollback: null,
    status: "published",
    ...overrides,
  };
}
