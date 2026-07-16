import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, expect, it } from "vitest";
import {
  assertDevelopmentAuthorization,
  assertDevelopmentAdmission,
  bindDevelopmentAuthorization,
  lineageEquivalentCost,
  loadDevelopmentAuthorization,
  validateDevelopmentAuthorization,
  type DevelopmentAuthorizationGrant,
} from "../../scripts/eval/development-authorization.js";
import { hashFile, hashManifest, loadYamlFile, validateCampaign, type AttemptResult, type CampaignManifest } from "../../scripts/eval/core.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("J-MAN-02 pins the ratified Phase 6 objective, subscription mode, historical cost, and cumulative ceiling", () => {
  expect(loadDevelopmentAuthorization("eval/development-authorizations/phase6-efficiency-qualification-20260716.yaml")).toMatchObject({
    objective: "phase-6-efficiency-qualification",
    billing_mode: "subscription",
    cumulative_equivalent_cost_usd: 1000,
    historical_equivalent_cost_usd: 577.89418925,
    allowed_campaign_types: ["adapter-harness-calibration-v1", "focused-provider-admission-v1", "candidate-qualification-v1"],
    learning_activation: "separately_authorized",
    future_realtime_soak: "separately_authorized",
  });
});

it("J-MAN-02 standing development authorization binds objective, subscription billing, lineage, campaign type, and zero-effect scope", () => {
  const grant = fixtureGrant();
  expect(validateDevelopmentAuthorization(grant)).toEqual([]);
  const binding = bindDevelopmentAuthorization(grant, "focused-provider-admission-v1");
  const campaign = fixtureCampaign(binding);
  expect(assertDevelopmentAuthorization(campaign, grant)).toEqual(binding);
  expect(() => assertDevelopmentAuthorization({ ...campaign, github: { ...campaign.github, owner: "other" } }, grant)).toThrow("github_mismatch");
  expect(() => bindDevelopmentAuthorization(grant, "realtime-soak-v1")).toThrow("campaign_not_allowed");
});

it("J-MAN-02 development authorization fails closed for metered billing, outward effects, malformed scope, and exhausted history", () => {
  const grant = fixtureGrant();
  expect(validateDevelopmentAuthorization({ ...grant, billing_mode: "metered" })).toContain("billing_mode must be subscription");
  expect(validateDevelopmentAuthorization({ ...grant, effects: { ...grant.effects, outward_effects: true } })).toContain("effects must forbid production mutation, outward effects, deployment, and publication");
  expect(validateDevelopmentAuthorization({ ...grant, allowed_campaign_types: ["candidate-qualification-v1", "candidate-qualification-v1"] })).toContain("allowed_campaign_types must be a unique non-empty versioned campaign array");
  expect(validateDevelopmentAuthorization({ ...grant, stop_conditions: ["cumulative_equivalent_cost_ceiling"] })).toContain("stop_conditions must contain every standing-grant circuit breaker exactly once");
  expect(validateDevelopmentAuthorization({ ...grant, historical_equivalent_cost_usd: 1000 })).toContain("historical equivalent cost must leave positive lineage capacity");
});

it("J-MAN-02 cumulative equivalent cost counts immutable descendant attempts once and excludes the active campaign", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-development-authorization-")); roots.push(root);
  const grant = fixtureGrant();
  const binding = bindDevelopmentAuthorization(grant, "focused-provider-admission-v1");
  for (const [campaignId, costs] of [["focused-a", [3, 4]], ["active", [9]]] as const) {
    const dir = join(root, ".eval-artifacts", campaignId); mkdirSync(join(dir, "results"), { recursive: true });
    writeFileSync(join(dir, "campaign.yaml"), stringify(fixtureCampaign(binding, campaignId)));
    for (const [index, cost] of costs.entries()) writeFileSync(join(dir, "results", `${index}.json`), `${JSON.stringify({ metrics: { cost: { equivalent_usd: cost } } })}\n`);
  }
  const usage = lineageEquivalentCost(root, grant, "active");
  expect(usage).toMatchObject({ historical_equivalent_cost_usd: 100, descendant_equivalent_cost_usd: 7, used_equivalent_cost_usd: 107, remaining_equivalent_cost_usd: 893, campaigns: ["focused-a"] });
});

it("J-MAN-02 final qualification requires same-candidate adapter and focused admission and binds the durable GitHub rerun", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-development-admission-")); roots.push(root);
  const grant = fixtureGrant();
  const target = preparedCampaign("candidate-qualification-v1", "candidate-qualification-v1-20260716-fixture", grant);
  expect(() => assertDevelopmentAdmission(root, target, grant)).toThrow("adapter_admission_missing");

  const adapter = preparedCampaign("adapter-harness-calibration-v1", "adapter-harness-calibration-v1-20260716-fixture", grant);
  writePassedCampaign(root, adapter, true);
  expect(() => assertDevelopmentAdmission(root, target, grant)).toThrow("focused_admission_missing");

  const focused = preparedCampaign("focused-provider-admission-v1", "focused-provider-admission-v1-20260716-fixture", grant);
  writePassedCampaign(root, focused, false);
  expect(assertDevelopmentAdmission(root, target, grant)).toEqual({
    adapter_campaign_id: adapter.campaign_id,
    focused_campaign_id: focused.campaign_id,
    prior_failed_qualification_campaigns: [],
  });

  const evidence = join(root, ".eval-artifacts", adapter.campaign_id, `github-evidence-${hashManifest(adapter).slice(7, 15)}.json`);
  const tampered = JSON.parse(readFileSync(evidence, "utf8")) as Record<string, unknown>; tampered.result = "failed"; writeFileSync(evidence, `${JSON.stringify(tampered)}\n`);
  expect(() => assertDevelopmentAdmission(root, target, grant)).toThrow("adapter_admission_missing");
});

it("J-MAN-02 Phase 6 objective rejects a campaign-type/profile mismatch and a third full-qualification loop", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-development-loop-stop-")); roots.push(root);
  const grant = fixtureGrant();
  const target = preparedCampaign("candidate-qualification-v1", "candidate-qualification-v1-20260716-fixture", grant);
  expect(() => assertDevelopmentAuthorization({ ...target, profile: "focused-admission", intent: "non_qualification" }, grant)).toThrow("campaign_type_mismatch");
  for (const suffix of ["failed-a", "failed-b"]) {
    const failed = preparedCampaign("candidate-qualification-v1", `candidate-qualification-v1-20260716-${suffix}`, grant);
    const dir = join(root, ".eval-artifacts", failed.campaign_id); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "campaign.yaml"), stringify(failed)); writeFileSync(join(dir, "campaign-stop.json"), "{}\n");
  }
  expect(() => assertDevelopmentAdmission(root, target, grant)).toThrow("repeated_full_qualification_failure");
});

it("J-MAN-02 focused admission cannot shrink its cases, assignments, thresholds, or retry boundary", () => {
  const grant = fixtureGrant();
  const focused = preparedCampaign("focused-provider-admission-v1", "focused-provider-admission-v1-20260716-fixture", grant);
  expect(validateCampaign(focused)).toEqual([]);
  expect(validateCampaign({ ...focused, cases: [{ case_id: "deep/auth-migration/v1", repetition_ids: ["mixed-d1"] }] })).toContain("focused-admission profile must contain exactly deep mixed-d1 and approval mixed-da in order");
  expect(validateCampaign({ ...focused, assignments: focused.assignments.slice(0, 1) })).toContain("focused-admission profile must use the exact Phase 6 builder and reviewer assignments");
  expect(validateCampaign({ ...focused, spend: { ...focused.spend, campaign_max_usd: 81 } })).toContain("focused-admission profile must retain the $80 campaign and both $40 case ceilings");
  expect(validateCampaign({ ...focused, infrastructure_retries: 0 })).toContain("focused-admission profile must retain one typed infrastructure retry");
});

function fixtureGrant(): DevelopmentAuthorizationGrant {
  return {
    schema_version: 1,
    authorization_id: "phase6-fixture",
    policy_id: "autonomous-isolated-development-v1",
    objective: "phase-6-efficiency-qualification",
    repair_lineage: "phase6-fixture",
    authorized_at: "2026-07-16T00:00:00.000Z",
    billing_mode: "subscription",
    cumulative_equivalent_cost_usd: 1000,
    historical_equivalent_cost_usd: 100,
    allowed_campaign_types: ["adapter-harness-calibration-v1", "focused-provider-admission-v1", "candidate-qualification-v1"],
    github: { owner: "buildstacks-dev", repo_pattern: "operon-eval-*" },
    effects: { production_mutation: false, outward_effects: false, deployment: false, publication: false },
    learning_activation: "separately_authorized",
    future_realtime_soak: "separately_authorized",
    stop_conditions: ["cumulative_equivalent_cost_ceiling", "metered_or_unknown_billing", "scope_or_effect_expansion", "repeated_full_qualification_failure"],
  };
}

function fixtureCampaign(developmentAuthorization: NonNullable<CampaignManifest["development_authorization"]>, campaignId = "focused-provider-admission-v1-20260716-fixture"): CampaignManifest {
  return {
    schema_version: 1,
    campaign_id: campaignId,
    purpose: "fixture",
    owner: "test",
    created_at: "2026-07-16T00:00:00.000Z",
    intent: "non_qualification",
    profile: "focused-admission",
    development_authorization: developmentAuthorization,
    candidate: { commit: "fixture", package_sha256: `sha256:${"a".repeat(64)}`, suite_sha256: `sha256:${"b".repeat(64)}` },
    org_fingerprint: `sha256:${"c".repeat(64)}`,
    system_fingerprint: `sha256:${"d".repeat(64)}`,
    cases: [{ case_id: "deep/auth-migration/v1", repetition_ids: ["mixed-d1"] }],
    assignments: [{ role: "builder", runtime: "codex", model: "fixture", effort: "high", capability_ref: "codex/v1" }],
    price_catalog_id: "prices/2026-07-15-v1",
    randomization_seed: "fixture",
    github: { owner: "buildstacks-dev", repo_pattern: "operon-eval-*" },
    route_budget_overrides: { deep: { input_tokens: 4_000_000 } },
    spend: { campaign_max_usd: 40, case_max_usd: { "deep/auth-migration/v1": 40 } },
    infrastructure_retries: 0,
    exclusions: [],
    stop_rules: ["hard_safety_violation", "qualification_impossible_stops_campaign"],
    operator_fixture: "operator-fixtures/eval-only-content-bound-approvals-v1.yaml",
    evidence_dir: `.eval-artifacts/${campaignId}`,
  };
}

function preparedCampaign(type: "adapter-harness-calibration-v1" | "focused-provider-admission-v1" | "candidate-qualification-v1", id: string, grant: DevelopmentAuthorizationGrant): CampaignManifest {
  const template = structuredClone(loadYamlFile(join(process.cwd(), "eval/campaigns", `${type.replace(/-v1$/, "")}.yaml`)) as CampaignManifest);
  return {
    ...template,
    campaign_id: id,
    created_at: "2026-07-16T00:00:00.000Z",
    candidate: { commit: "fixture", package_sha256: `sha256:${"a".repeat(64)}`, suite_sha256: `sha256:${"b".repeat(64)}`, release_package_sha256: `sha256:${"e".repeat(64)}`, executable_suite_sha256: `sha256:${"f".repeat(64)}` },
    org_fingerprint: `sha256:${"c".repeat(64)}`,
    system_fingerprint: `sha256:${"d".repeat(64)}`,
    github: { owner: grant.github.owner, repo_pattern: grant.github.repo_pattern },
    development_authorization: bindDevelopmentAuthorization(grant, type),
    evidence_dir: `.eval-artifacts/${id}`,
  };
}

function writePassedCampaign(root: string, campaign: CampaignManifest, github: boolean): void {
  const dir = join(root, ".eval-artifacts", campaign.campaign_id); mkdirSync(join(dir, "results"), { recursive: true });
  writeFileSync(join(dir, "campaign.yaml"), stringify(campaign));
  const hash = hashManifest(campaign);
  for (const item of campaign.cases) for (const repetition of item.repetition_ids) {
    const result = passingAttempt(campaign, hash, item.case_id, repetition);
    writeFileSync(join(dir, "results", `${result.attempt_id}.json`), `${JSON.stringify(result)}\n`);
  }
  if (!github) return;
  const short = hash.slice(7, 15); const evidenceName = `github-evidence-${short}.json`; const evidencePath = join(dir, evidenceName);
  writeFileSync(evidencePath, `${JSON.stringify({ schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: hash, result: "passed" })}\n`);
  writeFileSync(join(dir, `github-idempotence-${short}.json`), `${JSON.stringify({ schema_version: 1, evidence_kind: "github-idempotence", campaign_id: campaign.campaign_id, campaign_sha256: hash, source_evidence: evidenceName, source_evidence_sha256: `sha256:${hashFile(evidencePath)}`, reused_evidence: true, idempotent_rerun: true, result: "passed" })}\n`);
}

function passingAttempt(campaign: CampaignManifest, campaignSha256: string, caseId: string, repetitionId: string): AttemptResult {
  const adapter = caseId.startsWith("adapter/"); const attemptId = `${caseId.replaceAll("/", "-")}-${repetitionId}`;
  return {
    schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: campaignSha256, attempt_id: attemptId, case_id: caseId, repetition_id: repetitionId, outcome: "passed",
    admitted_at: "2026-07-16T00:00:00.000Z", terminal_at: "2026-07-16T00:00:01.000Z", evidence: [`fixture:${attemptId}`],
    metrics: {
      route: { planned: adapter ? "standard" : "deep", final: adapter ? "standard" : "deep", model_turns: 1 },
      context: { rendered_bytes: 10, sources: { task: 10 } }, cost: { equivalent_usd: 0.1, product_usd: 0.1, evaluator_usd: 0, quality: "complete" },
      tokens: { input: 10, output: 2, quality: "complete" }, latency: { elapsed_ms: 1_000, active_ms: 1_000, human_wait_ms: 0 }, human_load: { decisions: 0 },
      productivity: adapter ? { excluded: ["adapter_calibration_not_product_work"] } : { productive_passes: 1, total_passes: 1, ratio: 1, repeated_work_cost_usd: 0 },
      continuation: { excluded: ["not_continuation_case"] }, approvals: caseId.startsWith("approval/") ? { valid_requests: 1, total_requests: 1, precision: 1, recurrence: 0 } : { excluded: ["not_approval_case"] }, scheduler: { excluded: ["not_scheduler_case"] }, learning: { excluded: ["not_learning_case"] },
      execution: { terminal_integrity: 1, provider_turns: 1, mechanical_steps: 0, provider_settlements: 1, mechanical_settlements: 0 }, capabilities: { outward_effects: 0, hidden_answer_leakage: false, production_path_overlap: false },
    }, exclusions: [], missing: [],
  };
}
