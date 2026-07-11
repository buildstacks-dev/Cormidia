// Shared M3 record factories for the learning test suites: one spec-shaped
// ExperimentRecord / CandidateArtifact / InterventionRecord literal each,
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
