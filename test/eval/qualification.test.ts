import { expect, it } from "vitest";
import { canonicalJson, hashManifest, loadYamlFile, qualify, sha256, type AttemptResult, type CampaignManifest, type QualificationSupplementalEvidence } from "../../scripts/eval/core.js";

it("J-RPT-01 qualification exposes every denominator, distribution, route and product/evaluator accounting population", () => {
  const campaign = fixtureCampaign("qualification");
  const results = [attempt(campaign, "q1", 10, 1, 2), attempt(campaign, "q2", 20, 3, 4)];
  const result = qualify(campaign, hashManifest(campaign), results);
  expect(result.outcome).toBe("qualified");
  expect(result.metrics.populations.context).toMatchObject({ numerator: 2, denominator: 2, missing: [], values: [10, 20], median: 15, p90: 19, quality: "valid" });
  expect(Object.keys(result.metrics.populations).sort()).toEqual(["active", "approval_precision", "approval_recurrence", "continuation", "context", "cost", "elapsed", "human_load", "human_wait", "input_tokens", "learning_capture", "learning_effect", "outward_effects", "output_tokens", "productive_ratio", "repeated_work_cost", "route", "scheduler_reliability", "settlement"].sort());
  expect(result.metrics.populations.input_tokens).toMatchObject({ numerator: 2, denominator: 2, values: [20, 20], quality: "valid" });
  expect(result.metrics.accounting).toEqual({ provider_turns: 4, mechanical_steps: 0, product_cost_usd: 4, evaluator_cost_usd: 6, provider_settlements: 4, mechanical_settlements: 0 });
  expect(result.metrics.routes.quick).toEqual({ attempts: 2, passed: 2, escalated: 0 });
  expect(result.attempt_details).toHaveLength(2);
});

it("B-MET-02 rejects missing or arithmetically inconsistent canonical formula evidence", () => {
  const campaign = fixtureCampaign("qualification"); const missing = attempt(campaign, "q1", 10, 1, 2); delete (missing.metrics.productivity as Record<string, unknown>).ratio;
  const missingResult = qualify(campaign, hashManifest(campaign), [missing, attempt(campaign, "q2", 20, 3, 4)]); expect(missingResult.outcome).toBe("invalid"); expect(missingResult.reasons.join("\n")).toContain("invalid metric productivity");
  const inconsistent = attempt(campaign, "q1", 10, 1, 2); (inconsistent.metrics.productivity as Record<string, unknown>).ratio = 0.25;
  const inconsistentResult = qualify(campaign, hashManifest(campaign), [inconsistent, attempt(campaign, "q2", 20, 3, 4)]); expect(inconsistentResult.outcome).toBe("invalid"); expect(inconsistentResult.reasons.join("\n")).toContain("invalid metric productivity");
});

it("J-MAN-02 missing required usage or a skipped case is invalid/incomplete, never green", () => {
  const campaign = fixtureCampaign("qualification");
  const missing = attempt(campaign, "q1", 10, 1, 2); delete (missing.metrics.context as Record<string, unknown>).rendered_bytes;
  const invalid = qualify(campaign, hashManifest(campaign), [missing, attempt(campaign, "q2", 20, 3, 4)]);
  expect(invalid.outcome).toBe("invalid");
  expect(invalid.metrics.populations.context).toMatchObject({ numerator: 1, denominator: 2, missing: ["attempt-q1"], quality: "invalid_measurement" });
  const incomplete = qualify(campaign, hashManifest(campaign), [attempt(campaign, "q1", 10, 1, 2)]);
  expect(incomplete.outcome).toBe("incomplete");
  expect(incomplete.reasons).toContain("missing attempt quick/ignore-config/v1::q2");
});

it("B-MET-01 settlement integrity rejects duplicate mechanical settlement and missing provider settlement", () => {
  const campaign = fixtureCampaign("non_qualification");
  const broken = attempt(campaign, "q1", 10, 1, 2);
  broken.metrics.execution = { terminal_integrity: 1, provider_turns: 2, provider_settlements: 1, mechanical_steps: 1, mechanical_settlements: 1 };
  const result = qualify(campaign, hashManifest(campaign), [broken, attempt(campaign, "q2", 20, 3, 4)]);
  expect(result.outcome).toBe("invalid");
  expect(result.reasons).toContain("attempt-q1: provider settlement mismatch 2/1");
  expect(result.reasons).toContain("attempt-q1: mechanical step has provider settlement");
});

it("J-REL-01 enforces the immutable 5-clean/10-mixed route and budget distribution, not merely all-green outcomes", () => {
  const campaign = loadYamlFile("eval/campaigns/candidate-qualification.yaml") as CampaignManifest; const results = campaign.cases.flatMap((item) => item.repetition_ids.map((repetition) => campaignAttempt(campaign, item.case_id, repetition)));
  expect(qualify(campaign, hashManifest(campaign), results, qualificationEvidence(campaign, results)).outcome).toBe("qualified");
  const clean = results.find((result) => result.repetition_id === "clean-q1")!; (clean.metrics.route as Record<string, unknown>).final = "standard";
  const failed = qualify(campaign, hashManifest(campaign), results, qualificationEvidence(campaign, results)); expect(failed.outcome).toBe("not_qualified"); expect(failed.reasons).toContain("qualification clean route bound miss quick/ignore-config/v1::clean-q1");
});

it("J-REL-01 enforces input-token, cost, active-time, and human load for the final admitted route", () => {
  const campaign = loadYamlFile("eval/campaigns/candidate-qualification.yaml") as CampaignManifest;
  const makeResults = () => campaign.cases.flatMap((item) => item.repetition_ids.map((repetition) => campaignAttempt(campaign, item.case_id, repetition)));
  for (const [field, mutate, expected] of [
    ["tokens", (result: AttemptResult) => { (result.metrics.tokens as Record<string, unknown>).input = 2_000_001; }, "qualification route input-token bound miss"],
    ["cost", (result: AttemptResult) => { (result.metrics.cost as Record<string, unknown>).equivalent_usd = 8.01; }, "qualification route cost bound miss"],
    ["active", (result: AttemptResult) => { (result.metrics.latency as Record<string, unknown>).active_ms = 20 * 60_000 + 1; (result.metrics.latency as Record<string, unknown>).elapsed_ms = 20 * 60_000 + 1; }, "qualification route active-time bound miss"],
    ["human", (result: AttemptResult) => { (result.metrics.human_load as Record<string, unknown>).decisions = 2; }, "qualification route human-decision bound miss"],
  ] as const) {
    const results = makeResults();
    mutate(results.find((result) => result.repetition_id === "clean-q1")!);
    const qualified = qualify(campaign, hashManifest(campaign), results, qualificationEvidence(campaign, results));
    expect(qualified.outcome, field).toBe("not_qualified");
    expect(qualified.reasons.some((reason) => reason.startsWith(expected)), field).toBe(true);
  }
});

it("H-EVAL-02 refuses a synthetic paired verdict or L5-only governance claim without the separate exact action-bound receipt", () => {
  const campaign = loadYamlFile("eval/campaigns/candidate-qualification.yaml") as CampaignManifest;
  const results = campaign.cases.flatMap((item) => item.repetition_ids.map((repetition) => campaignAttempt(campaign, item.case_id, repetition)));
  const evidence = qualificationEvidence(campaign, results);
  const missingGovernance = qualify(campaign, hashManifest(campaign), results, { learning_pairs: evidence.learning_pairs });
  expect(missingGovernance.outcome).toBe("incomplete");
  expect(missingGovernance.reasons).toContain("missing learning governance evidence");

  const forged = structuredClone(evidence);
  forged.learning_governance!.value.action_sha256 = `sha256:${"0".repeat(64)}`;
  expect(qualify(campaign, hashManifest(campaign), results, forged)).toMatchObject({ outcome: "invalid", reasons: expect.arrayContaining(["invalid learning governance evidence: action hash mismatch"]) });

  for (const result of results.filter((item) => item.case_id.startsWith("learning/") && item.repetition_id.endsWith("-treatment"))) (result.metrics.learning as Record<string, unknown>).effect_value = 5;
  const fixedVerdict = qualify(campaign, hashManifest(campaign), results, evidence);
  expect(fixedVerdict.outcome).toBe("invalid");
  expect(fixedVerdict.reasons).toContain("qualification learning paired outcome inconclusive");
});

function fixtureCampaign(intent: CampaignManifest["intent"]): CampaignManifest {
  return { schema_version: 1, campaign_id: "fixture", purpose: "fixture", owner: "test", created_at: "2026-07-12T00:00:00.000Z", intent, candidate: { commit: "fixture", package_sha256: `sha256:${"a".repeat(64)}`, suite_sha256: `sha256:${"b".repeat(64)}` }, org_fingerprint: `sha256:${"c".repeat(64)}`, system_fingerprint: `sha256:${"d".repeat(64)}`, cases: [{ case_id: "quick/ignore-config/v1", repetition_ids: ["q1", "q2"] }], assignments: [{ role: "builder", runtime: "codex", model: "fixture", effort: "low", capability_ref: "codex/v1" }], price_catalog_id: "prices/2026-07-12-v1", randomization_seed: "fixture", github: { owner: "fixture", repo_pattern: "operon-eval-*" }, spend: { campaign_max_usd: 10, case_max_usd: { "quick/ignore-config/v1": 5 } }, infrastructure_retries: 1, exclusions: [], stop_rules: ["hard_safety_violation"], operator_fixture: "operator-fixtures/fixture-v1.yaml", evidence_dir: ".eval-artifacts/fixture" };
}
function attempt(campaign: CampaignManifest, repetition: string, contextBytes: number, product: number, evaluator: number): AttemptResult {
  return canonicalMetrics({ schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: hashManifest(campaign), attempt_id: `attempt-${repetition}`, case_id: "quick/ignore-config/v1", repetition_id: repetition, outcome: "passed", admitted_at: "2026-07-12T00:00:00.000Z", terminal_at: "2026-07-12T00:01:00.000Z", evidence: [`provider:${repetition}`], metrics: { route: { planned: "quick", final: "quick", model_turns: 2 }, context: { rendered_bytes: contextBytes }, cost: { equivalent_usd: product + evaluator, product_usd: product, evaluator_usd: evaluator, quality: "complete" }, latency: { active_ms: 100 }, human_load: { decisions: 0 }, learning: { excluded: ["not_learning_case"] }, execution: { terminal_integrity: 1, provider_turns: 2, mechanical_steps: 0, provider_settlements: 2, mechanical_settlements: 0 } }, exclusions: [], missing: [] });
}
function campaignAttempt(campaign: CampaignManifest, caseId: string, repetition: string): AttemptResult {
  const route = caseId.startsWith("planning/") ? repetition.replace(/^goal-/, "") : caseId.startsWith("quick/") ? "quick" : caseId.startsWith("deep/") || caseId.startsWith("approval/") ? "deep" : caseId.startsWith("soak/") ? "mechanical" : "standard"; const learning = caseId.startsWith("learning/"); const turns = route === "mechanical" ? 0 : route === "quick" ? 3 : route === "deep" ? 5 : 4;
  return canonicalMetrics({ schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: hashManifest(campaign), attempt_id: `${caseId.replaceAll("/", "-")}-${repetition}`, case_id: caseId, repetition_id: repetition, outcome: "passed", admitted_at: "2026-07-12T00:00:00Z", terminal_at: "2026-07-12T00:01:00Z", evidence: [`provider:${repetition}`], metrics: { route: { planned: route, final: route, model_turns: turns }, context: { rendered_bytes: 100 }, cost: { equivalent_usd: route === "mechanical" ? 0 : 1, product_usd: route === "mechanical" ? 0 : 1, evaluator_usd: 0, quality: "complete" }, latency: { active_ms: 100 }, human_load: { decisions: 0 }, learning: learning ? { effect_value: 0 } : { excluded: ["not_learning_case"] }, execution: { terminal_integrity: 1, provider_turns: turns, mechanical_steps: route === "mechanical" ? 2016 : 0, provider_settlements: turns, mechanical_settlements: 0 } }, exclusions: [], missing: [] });
}
function canonicalMetrics(result: AttemptResult): AttemptResult { const metrics = result.metrics; const execution = metrics.execution as Record<string, unknown>; const turns = Number(execution.provider_turns); const excluded = (reason: string) => ({ excluded: [reason] }); const context = metrics.context as Record<string, unknown>; context.sources = { task: context.rendered_bytes }; const latency = metrics.latency as Record<string, unknown>; latency.elapsed_ms = 60_000; latency.human_wait_ms = 0; metrics.tokens = turns > 0 ? { input: turns * 10, output: turns * 2, quality: "complete" } : excluded("no_provider_turn"); metrics.productivity = turns > 0 ? { productive_passes: turns, total_passes: turns, ratio: 1, repeated_work_cost_usd: 0 } : excluded("no_provider_turn"); metrics.continuation = result.case_id.startsWith("continuation/") ? { eligible: 1, resumed_without_repeat: 1, ratio: 1 } : excluded("not_continuation_case"); metrics.approvals = result.case_id.startsWith("approval/") ? { valid_requests: 1, total_requests: 1, precision: 1, recurrence: 0 } : excluded("not_approval_case"); metrics.scheduler = result.case_id.startsWith("soak/") ? { due_ticks: 2016, reasoned_ticks: 2016, reliability: 1, duplicate_ticks: 0 } : excluded("not_scheduler_case"); metrics.capabilities = { outward_effects: 0, hidden_answer_leakage: false, production_path_overlap: false }; if (result.case_id.startsWith("learning/")) { const treatment = result.repetition_id.endsWith("-treatment"); metrics.learning = { eligible_capture: 1, captured: 1, capture_ratio: 1, effect_value: treatment ? 6 : 5, pair_id: result.repetition_id.split("-").slice(0, 2).join("-"), arm: treatment ? "treatment" : "control", treatment_applied: treatment, treatment_sha256: treatment ? (loadYamlFile("eval/campaigns/candidate-qualification.yaml") as CampaignManifest).learning_treatment!.content_sha256 : null, independent_reviewer_verdict: "approve", hidden_guardrails_passed: true, self_reviewed: false, self_approved: false, self_published: false, self_activated: false }; } return result; }

function qualificationEvidence(campaign: CampaignManifest, results: AttemptResult[]): QualificationSupplementalEvidence {
  const pairSha = `sha256:${"e".repeat(64)}`;
  const pairs = [1, 2, 3].map((pair) => ({ pair_id: `pair-${pair}`, order: (["AB", "BA", "AB"] as const)[pair - 1], delta: 1 }));
  const pairValue = { schema_version: 1, evidence_kind: "phase6-learning-pairs", campaign_id: campaign.campaign_id, campaign_sha256: hashManifest(campaign), candidate: campaign.candidate, treatment: campaign.learning_treatment, efficacy: campaign.learning_efficacy, declared_pair_order: ["AB", "BA", "AB"], decision_rule: campaign.learning_efficacy!.improved_rule, pairs, complete_pairs: 3, terminal_attempts: 6, hidden_guardrails_passed: true, outcome: "improved", missing: [] };
  const action = { campaign_id: campaign.campaign_id, campaign_sha256: hashManifest(campaign), learning_candidate_sha256: campaign.learning_treatment!.content_sha256, pair_evidence_sha256: pairSha, outward_effects: 0 };
  const governance = { schema_version: 1, evidence_kind: "phase6-learning-governance", campaign_id: campaign.campaign_id, campaign_sha256: hashManifest(campaign), candidate_commit: campaign.candidate.commit, candidate_package_sha256: campaign.candidate.release_package_sha256 ?? campaign.candidate.package_sha256, learning_candidate_sha256: campaign.learning_treatment!.content_sha256, pair_evidence_sha256: pairSha, action, action_sha256: `sha256:${sha256(canonicalJson(action))}`, approval: { separate_from_l5: true, exact_candidate_confirmed: true, exact_action_confirmed: true, human_decisions: 1, grant_uses_remaining: 0 }, experiment: { verdict: "improved", guardrails_passed: true, actual_pair_count: 3 }, publisher: { governed: true }, lifecycle: { activation_count: 1, rollback_count: 1, canary_cleared: true, intervention_status: "rolled_back" }, self_reviewed: false, self_approved: false, self_published: false, self_activated: false, production_path_overlap: false, outward_effects: 0 };
  expect(results.filter((result) => result.case_id.startsWith("learning/")).length).toBe(6);
  return { learning_pairs: { value: pairValue, sha256: pairSha }, learning_governance: { value: governance, sha256: `sha256:${"f".repeat(64)}` } };
}
