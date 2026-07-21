import { execFileSync } from "node:child_process";
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

it("J-MAN-02 retains the prior Phase 6 objective grant", () => {
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

it("J-MAN-02 pins the scorer-repair ceiling, verified history, and unavailable-usage reservation", () => {
  expect(loadDevelopmentAuthorization("eval/development-authorizations/phase6-efficiency-qualification-20260716-scorer-repair.yaml")).toMatchObject({
    authorization_id: "phase6-efficiency-qualification-20260716-scorer-repair",
    objective: "phase-6-efficiency-qualification",
    repair_lineage: "phase6-efficiency-qualification-20260716",
    billing_mode: "subscription",
    cumulative_equivalent_cost_usd: 2000,
    historical_equivalent_cost_usd: 875.017976,
    usage_reservations: [{
      campaign_id: "candidate-qualification-v1-20260716-7c99f3314b2c",
      reason: "usage_unavailable_case_ceiling",
      equivalent_cost_usd: 40,
    }],
    allowed_campaign_types: ["adapter-harness-calibration-v1", "focused-provider-admission-v1", "candidate-qualification-v1"],
    learning_activation: "separately_authorized",
    future_realtime_soak: "separately_authorized",
  });
});

it("J-MAN-02 pins the proportionate-release history, retained admissions, bounded repair, and one-campaign stop", () => {
  expect(loadDevelopmentAuthorization("eval/development-authorizations/phase6-efficiency-qualification-20260716-proportionate-release.yaml")).toMatchObject({
    authorization_id: "phase6-efficiency-qualification-20260716-proportionate-release",
    objective: "phase-6-efficiency-qualification",
    billing_mode: "subscription",
    cumulative_equivalent_cost_usd: 2000,
    historical_equivalent_cost_usd: 1017.54113775,
    usage_reservations: [
      { campaign_id: "candidate-qualification-v1-20260716-7c99f3314b2c", equivalent_cost_usd: 40 },
      { campaign_id: "focused-provider-admission-v1-20260716-4dc0b227b3a6", equivalent_cost_usd: 39.550785 },
    ],
    allowed_campaign_types: ["candidate-qualification-v1"],
    proportionate_release: {
      policy: "proportionate-release-v1",
      base_candidate_commit: "523bb9984a6a3a066743fdc92f74b47799dd50c4",
      max_fresh_full_campaigns: 1,
      adapter: { campaign_id: "adapter-harness-calibration-v1-20260716-7ff53bd8273c" },
      focused: { campaign_id: "focused-provider-admission-v1-20260716-7ff53bd8273c" },
    },
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
  expect(validateDevelopmentAuthorization({ ...grant, historical_equivalent_cost_usd: 1000 })).toContain("historical plus reserved equivalent cost must leave positive lineage capacity");
  expect(validateDevelopmentAuthorization({ ...grant, usage_reservations: [{ campaign_id: "usage-gap", reason: "usage_unavailable_case_ceiling", equivalent_cost_usd: 900 }] })).toContain("historical plus reserved equivalent cost must leave positive lineage capacity");
  expect(validateDevelopmentAuthorization({ ...grant, usage_reservations: [{ campaign_id: "usage-gap", reason: "usage_unavailable_case_ceiling", equivalent_cost_usd: 0 }] })).toContain("usage reservation equivalent cost must be positive");
});

it("J-MAN-02 cumulative equivalent cost counts immutable descendant attempts once and excludes the active campaign", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-development-authorization-")); roots.push(root);
  const grant = { ...fixtureGrant(), usage_reservations: [{ campaign_id: "interrupted", reason: "usage_unavailable_case_ceiling" as const, equivalent_cost_usd: 40 }] };
  const binding = bindDevelopmentAuthorization(grant, "focused-provider-admission-v1");
  for (const [campaignId, costs] of [["focused-a", [3, 4]], ["active", [9]]] as const) {
    const dir = join(root, ".eval-artifacts", campaignId); mkdirSync(join(dir, "results"), { recursive: true });
    writeFileSync(join(dir, "campaign.yaml"), stringify(fixtureCampaign(binding, campaignId)));
    for (const [index, cost] of costs.entries()) writeFileSync(join(dir, "results", `${index}.json`), `${JSON.stringify({ metrics: { cost: { equivalent_usd: cost } } })}\n`);
  }
  const usage = lineageEquivalentCost(root, grant, "active");
  expect(usage).toMatchObject({ historical_equivalent_cost_usd: 100, reserved_equivalent_cost_usd: 40, usage_reservations: grant.usage_reservations, descendant_equivalent_cost_usd: 7, used_equivalent_cost_usd: 147, remaining_equivalent_cost_usd: 853, campaigns: ["focused-a"] });
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
    admission_basis: "exact-candidate",
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

it("J-MAN-02 proportionate release content-binds retained admissions and the exact repaired path set", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-proportionate-release-")); roots.push(root);
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.name", "Operon Eval Test"]);
  git(root, ["config", "user.email", "eval-test@operon.invalid"]);
  mkdirSync(join(root, "src/runtime"), { recursive: true });
  writeFileSync(join(root, "src/runtime/gate.ts"), "export const gate = 'before';\n");
  git(root, ["add", "src/runtime/gate.ts"]); git(root, ["commit", "-m", "base"]);
  const base = git(root, ["rev-parse", "HEAD"]);

  const admissionGrant = fixtureGrant();
  const adapter = preparedCampaign("adapter-harness-calibration-v1", "adapter-harness-calibration-v1-20260716-retained", admissionGrant);
  const focused = preparedCampaign("focused-provider-admission-v1", "focused-provider-admission-v1-20260716-retained", admissionGrant);
  adapter.candidate.commit = base; focused.candidate.commit = base;
  writePassedCampaign(root, adapter, true); writePassedCampaign(root, focused, false);

  writeFileSync(join(root, "src/runtime/gate.ts"), "export const gate = 'after';\n");
  git(root, ["add", "src/runtime/gate.ts"]); git(root, ["commit", "-m", "repair"]);
  const repaired = git(root, ["rev-parse", "HEAD"]);
  const grant: DevelopmentAuthorizationGrant = {
    ...fixtureGrant(),
    authorization_id: "phase6-proportionate-fixture",
    allowed_campaign_types: ["candidate-qualification-v1"],
    proportionate_release: {
      policy: "proportionate-release-v1",
      base_candidate_commit: base,
      bounded_changed_paths: ["src/runtime/gate.ts"],
      max_fresh_full_campaigns: 1,
      adapter: { campaign_id: adapter.campaign_id, campaign_sha256: hashManifest(adapter) },
      focused: { campaign_id: focused.campaign_id, campaign_sha256: hashManifest(focused) },
    },
  };
  expect(validateDevelopmentAuthorization(grant)).toEqual([]);
  const target = preparedCampaign("candidate-qualification-v1", "candidate-qualification-v1-20260716-proportionate", grant);
  target.candidate.commit = repaired;
  expect(assertDevelopmentAdmission(root, target, grant)).toEqual({
    admission_basis: "retained-proportionate",
    adapter_campaign_id: adapter.campaign_id,
    focused_campaign_id: focused.campaign_id,
    prior_failed_qualification_campaigns: [],
    bounded_changed_paths: ["src/runtime/gate.ts"],
  });

  const tamperedGrant: DevelopmentAuthorizationGrant = {
    ...grant,
    authorization_id: "phase6-proportionate-tampered",
    proportionate_release: {
      ...grant.proportionate_release!,
      adapter: { ...grant.proportionate_release!.adapter, campaign_sha256: `sha256:${"0".repeat(64)}` },
    },
  };
  const tamperedTarget = preparedCampaign("candidate-qualification-v1", "candidate-qualification-v1-20260716-tampered", tamperedGrant);
  tamperedTarget.candidate.commit = repaired;
  expect(() => assertDevelopmentAdmission(root, tamperedTarget, tamperedGrant)).toThrow("identity_mismatch");

  writeFileSync(join(root, "unbounded.txt"), "not authorized\n");
  git(root, ["add", "unbounded.txt"]); git(root, ["commit", "-m", "unbounded"]);
  const unbounded = structuredClone(target); unbounded.candidate.commit = git(root, ["rev-parse", "HEAD"]);
  expect(() => assertDevelopmentAdmission(root, unbounded, grant)).toThrow("proportionate_candidate_scope_mismatch");

  const prior = preparedCampaign("candidate-qualification-v1", "candidate-qualification-v1-20260716-prior", grant);
  prior.candidate.commit = repaired;
  const priorRoot = join(root, ".eval-artifacts", prior.campaign_id); mkdirSync(priorRoot, { recursive: true });
  writeFileSync(join(priorRoot, "campaign.yaml"), stringify(prior));
  writeFileSync(join(priorRoot, "github-evidence-started.json"), "{}\n");
  expect(() => assertDevelopmentAdmission(root, target, grant)).toThrow("one_decisive_full_campaign");
});

it("J-MAN-02 focused admission cannot shrink its repaired or downstream cases, assignments, thresholds, or retry boundary", () => {
  const grant = fixtureGrant();
  const focused = preparedCampaign("focused-provider-admission-v1", "focused-provider-admission-v1-20260716-fixture", grant);
  expect(validateCampaign(focused)).toEqual([]);
  expect(validateCampaign({ ...focused, cases: focused.cases.slice(0, 3) })).toContain("focused-admission profile must contain exactly quick mixed-q1, deep mixed-d1, approval mixed-da, and the three standing-role repetitions in order");
  expect(validateCampaign({ ...focused, assignments: focused.assignments.slice(0, 2) })).toContain("focused-admission profile must use the exact Phase 6 builder, reviewer, SRE, Support, and Marketing assignments");
  expect(validateCampaign({ ...focused, spend: { ...focused.spend, campaign_max_usd: 119 } })).toContain("focused-admission profile must retain the $118 campaign and exact $8/$40/$40/$30 case ceilings");
  expect(validateCampaign({ ...focused, infrastructure_retries: 0 })).toContain("focused-admission profile must retain one typed infrastructure retry");
});

// P1-06 / C-001 (Theme 1): a spend guard that cannot read a prior campaign's
// evidence must REFUSE, never fold "could not check" into "no prior campaign"
// and admit another real-money campaign. A corrupt/torn qualification*.json or
// campaign.yaml — exactly what a long campaign leaves behind — is "cannot
// determine", distinct from a genuinely-absent directory.
it("J-MAN-02 P1-06 repeated-failure guard refuses on a corrupt qualification*.json instead of admitting", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-p1-06-failed-")); roots.push(root);
  const grant = fixtureGrant();
  const target = preparedCampaign("candidate-qualification-v1", "candidate-qualification-v1-20260716-fixture", grant);

  // Genuine ABSENCE: no prior campaigns at all. The guard passes and admission
  // proceeds past it, failing later on the missing admissions — i.e. ADMIT.
  expect(() => assertDevelopmentAdmission(root, target, grant)).toThrow("adapter_admission_missing");

  // A prior candidate-qualification campaign (valid manifest, so it matches the
  // grant) whose qualification.json is a TORN write that JSON.parse cannot read.
  const torn = preparedCampaign("candidate-qualification-v1", "candidate-qualification-v1-20260716-torn", grant);
  const dir = join(root, ".eval-artifacts", torn.campaign_id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "campaign.yaml"), stringify(torn));
  writeFileSync(join(dir, "qualification.json"), "{ torn write");

  // Before P1-06 this was silently counted as "not failed" and the guard ADMITTED
  // (fell through to adapter_admission_missing). It must now REFUSE.
  expect(() => assertDevelopmentAdmission(root, target, grant)).toThrow("prior_qualification_undeterminable");

  // A readable qualification.json whose outcome is NOT a failure is genuine
  // information, not "cannot determine": it must not trip the refuse path.
  writeFileSync(join(dir, "qualification.json"), `${JSON.stringify({ outcome: "qualified" })}\n`);
  expect(() => assertDevelopmentAdmission(root, target, grant)).toThrow("adapter_admission_missing");
});

it("J-MAN-02 P1-06 one-decisive-campaign guard refuses on a corrupt started campaign.yaml instead of admitting", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-p1-06-started-")); roots.push(root);
  const grant: DevelopmentAuthorizationGrant = {
    ...fixtureGrant(),
    authorization_id: "phase6-proportionate-p1-06",
    allowed_campaign_types: ["candidate-qualification-v1"],
    proportionate_release: {
      policy: "proportionate-release-v1",
      base_candidate_commit: "0".repeat(40),
      bounded_changed_paths: ["src/runtime/gate.ts"],
      max_fresh_full_campaigns: 1,
      adapter: { campaign_id: "adapter-harness-calibration-v1-20260716-x", campaign_sha256: `sha256:${"1".repeat(64)}` },
      focused: { campaign_id: "focused-provider-admission-v1-20260716-x", campaign_sha256: `sha256:${"2".repeat(64)}` },
    },
  };
  const target = preparedCampaign("candidate-qualification-v1", "candidate-qualification-v1-20260716-fixture", grant);

  // Genuine ABSENCE: no prior started campaign. The guard passes and admission
  // proceeds to the bounded-repair check, which fails on the non-git root — i.e.
  // ADMIT past the started-guard.
  expect(() => assertDevelopmentAdmission(root, target, grant)).toThrow("proportionate_candidate_not_descendant");

  // A started prior candidate-qualification campaign whose campaign.yaml is TORN
  // (an unterminated YAML flow that the parser rejects).
  const dir = join(root, ".eval-artifacts", "candidate-qualification-v1-20260716-started-torn"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "campaign.yaml"), "campaign: [unterminated\n  : : :");
  writeFileSync(join(dir, "github-evidence-started.json"), "{}\n");

  // Before P1-06 the torn campaign.yaml was silently "not started" and the guard
  // ADMITTED (fell through to the descendant check). It must now REFUSE.
  expect(() => assertDevelopmentAdmission(root, target, grant)).toThrow("prior_qualification_undeterminable");
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

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
