import { expect, it } from "vitest";
import { hashManifest, loadYamlFile, qualify, type AttemptResult, type CampaignManifest } from "../../scripts/eval/core.js";

it("J-RPT-01 qualification exposes every denominator, distribution, route and product/evaluator accounting population", () => {
  const campaign = fixtureCampaign("qualification");
  const results = [attempt(campaign, "q1", 10, 1, 2), attempt(campaign, "q2", 20, 3, 4)];
  const result = qualify(campaign, hashManifest(campaign), results);
  expect(result.outcome).toBe("qualified");
  expect(result.metrics.populations.context).toMatchObject({ numerator: 2, denominator: 2, missing: [], values: [10, 20], median: 15, p90: 19, quality: "valid" });
  expect(Object.keys(result.metrics.populations).sort()).toEqual(["active", "approval_precision", "approval_recurrence", "continuation", "context", "cost", "elapsed", "human_load", "human_wait", "input_tokens", "learning_capture", "learning_effect", "output_tokens", "productive_ratio", "repeated_work_cost", "route", "scheduler_reliability", "settlement"].sort());
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
  expect(qualify(campaign, hashManifest(campaign), results).outcome).toBe("qualified");
  const clean = results.find((result) => result.repetition_id === "clean-q1")!; (clean.metrics.route as Record<string, unknown>).final = "standard";
  const failed = qualify(campaign, hashManifest(campaign), results); expect(failed.outcome).toBe("not_qualified"); expect(failed.reasons).toContain("qualification clean route bound miss quick/ignore-config/v1::clean-q1");
});

function fixtureCampaign(intent: CampaignManifest["intent"]): CampaignManifest {
  return { schema_version: 1, campaign_id: "fixture", purpose: "fixture", owner: "test", created_at: "2026-07-12T00:00:00.000Z", intent, candidate: { commit: "fixture", package_sha256: `sha256:${"a".repeat(64)}`, suite_sha256: `sha256:${"b".repeat(64)}` }, org_fingerprint: `sha256:${"c".repeat(64)}`, system_fingerprint: `sha256:${"d".repeat(64)}`, cases: [{ case_id: "quick/ignore-config/v1", repetition_ids: ["q1", "q2"] }], assignments: [{ role: "builder", runtime: "codex", model: "fixture", effort: "low", capability_ref: "codex/v1" }], price_catalog_id: "prices/2026-07-12-v1", randomization_seed: "fixture", github: { owner: "fixture", repo_pattern: "operon-eval-*" }, spend: { campaign_max_usd: 10, case_max_usd: { "quick/ignore-config/v1": 5 } }, infrastructure_retries: 1, exclusions: [], stop_rules: ["hard_safety_violation"], operator_fixture: "operator-fixtures/fixture-v1.yaml", evidence_dir: ".eval-artifacts/fixture" };
}
function attempt(campaign: CampaignManifest, repetition: string, contextBytes: number, product: number, evaluator: number): AttemptResult {
  return canonicalMetrics({ schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: hashManifest(campaign), attempt_id: `attempt-${repetition}`, case_id: "quick/ignore-config/v1", repetition_id: repetition, outcome: "passed", admitted_at: "2026-07-12T00:00:00.000Z", terminal_at: "2026-07-12T00:01:00.000Z", evidence: [`provider:${repetition}`], metrics: { route: { planned: "quick", final: "quick", model_turns: 2 }, context: { rendered_bytes: contextBytes }, cost: { equivalent_usd: product + evaluator, product_usd: product, evaluator_usd: evaluator, quality: "complete" }, latency: { active_ms: 100 }, human_load: { decisions: 0 }, learning: { excluded: ["not_learning_case"] }, execution: { terminal_integrity: 1, provider_turns: 2, mechanical_steps: 0, provider_settlements: 2, mechanical_settlements: 0 } }, exclusions: [], missing: [] });
}
function campaignAttempt(campaign: CampaignManifest, caseId: string, repetition: string): AttemptResult {
  const route = caseId.startsWith("quick/") ? "quick" : caseId.startsWith("deep/") || caseId.startsWith("approval/") ? "deep" : caseId.startsWith("soak/") ? "mechanical" : "standard"; const learning = caseId.startsWith("learning/"); const turns = route === "mechanical" ? 0 : route === "quick" ? 3 : route === "deep" ? 5 : 4;
  return canonicalMetrics({ schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: hashManifest(campaign), attempt_id: `${caseId.replaceAll("/", "-")}-${repetition}`, case_id: caseId, repetition_id: repetition, outcome: "passed", admitted_at: "2026-07-12T00:00:00Z", terminal_at: "2026-07-12T00:01:00Z", evidence: [`provider:${repetition}`], metrics: { route: { planned: route, final: route, model_turns: turns }, context: { rendered_bytes: 100 }, cost: { equivalent_usd: route === "mechanical" ? 0 : 1, product_usd: route === "mechanical" ? 0 : 1, evaluator_usd: 0, quality: "complete" }, latency: { active_ms: 100 }, human_load: { decisions: 0 }, learning: learning ? { effect_delta: 1 } : { excluded: ["not_learning_case"] }, execution: { terminal_integrity: 1, provider_turns: turns, mechanical_steps: route === "mechanical" ? 2016 : 0, provider_settlements: turns, mechanical_settlements: 0 } }, exclusions: [], missing: [] });
}
function canonicalMetrics(result: AttemptResult): AttemptResult { const metrics = result.metrics; const execution = metrics.execution as Record<string, unknown>; const turns = Number(execution.provider_turns); const excluded = (reason: string) => ({ excluded: [reason] }); const context = metrics.context as Record<string, unknown>; context.sources = { task: context.rendered_bytes }; const latency = metrics.latency as Record<string, unknown>; latency.elapsed_ms = 60_000; latency.human_wait_ms = 0; metrics.tokens = turns > 0 ? { input: turns * 10, output: turns * 2, quality: "complete" } : excluded("no_provider_turn"); metrics.productivity = turns > 0 ? { productive_passes: turns, total_passes: turns, ratio: 1, repeated_work_cost_usd: 0 } : excluded("no_provider_turn"); metrics.continuation = result.case_id.startsWith("continuation/") ? { eligible: 1, resumed_without_repeat: 1, ratio: 1 } : excluded("not_continuation_case"); metrics.approvals = result.case_id.startsWith("approval/") ? { valid_requests: 1, total_requests: 1, precision: 1, recurrence: 0 } : excluded("not_approval_case"); metrics.scheduler = result.case_id.startsWith("soak/") ? { due_ticks: 2016, reasoned_ticks: 2016, reliability: 1, duplicate_ticks: 0 } : excluded("not_scheduler_case"); if (result.case_id.startsWith("learning/")) metrics.learning = { eligible_capture: 1, captured: 1, capture_ratio: 1, effect_delta: 1 }; return result; }
