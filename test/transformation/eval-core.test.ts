import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { calibrateGrader, canonicalJson, hashManifest, qualify, startCampaign, validateCampaign, verifyCampaignLock, writeAttemptResult, type AttemptResult, type CampaignManifest } from "../../scripts/eval/core.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function campaign(): CampaignManifest {
  const digest = `sha256:${"a".repeat(64)}`;
  return {
    schema_version: 1, campaign_id: "baseline-v1", purpose: "self test", owner: "fixture", created_at: "2026-07-12T00:00:00.000Z", intent: "non_qualification",
    candidate: { commit: "abc", package_sha256: digest, suite_sha256: digest }, org_fingerprint: digest, system_fingerprint: digest,
    cases: [{ case_id: "quick/example/v1", repetition_ids: ["r1"] }], assignments: [{ role: "builder", runtime: "codex", model: "fake-v1", effort: "medium", capability_ref: "codex/v1" }],
    price_catalog_id: "prices/2026-07-12-v1", randomization_seed: "seed", github: { owner: "fixture", repo_pattern: "operon-eval-*" },
    spend: { campaign_max_usd: 1, case_max_usd: { "quick/example/v1": 1 } }, infrastructure_retries: 0, exclusions: [], stop_rules: ["safety"], operator_fixture: "operator-fixtures/fixture-v1.yaml", evidence_dir: "artifacts/baseline-v1",
  };
}
function result(c: CampaignManifest, outcome: AttemptResult["outcome"] = "passed"): AttemptResult {
  return { schema_version: 1, campaign_id: c.campaign_id, campaign_sha256: hashManifest(c), attempt_id: "a1", case_id: "quick/example/v1", repetition_id: "r1", outcome, admitted_at: "2026-07-12T00:00:00Z", terminal_at: "2026-07-12T00:01:00Z", evidence: ["episode:a1"], metrics: { route: { planned: "quick", final: "quick", model_turns: 1 }, context: { rendered_bytes: 10, sources: { task: 10 } }, cost: { equivalent_usd: 0.1, product_usd: 0.1, evaluator_usd: 0, quality: "complete" }, tokens: { input: 10, output: 2, quality: "complete" }, latency: { elapsed_ms: 60_000, active_ms: 1, human_wait_ms: 0 }, human_load: { decisions: 0 }, productivity: { productive_passes: 1, total_passes: 1, ratio: 1, repeated_work_cost_usd: 0 }, continuation: { excluded: ["not_continuation_case"] }, approvals: { excluded: ["not_approval_case"] }, scheduler: { excluded: ["not_scheduler_case"] }, learning: { excluded: ["not_learning_case"] }, execution: { terminal_integrity: 1, provider_turns: 1, provider_settlements: 1, mechanical_steps: 0, mechanical_settlements: 0 } }, exclusions: [], missing: [] };
}

describe("eval campaign and evidence core", () => {
  it("J-MAN-01 positive: canonicalizes object order before hashing a valid manifest", () => { expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}'); });
  it("J-MAN-02 positive: locks campaign identity and detects post-start mutation", () => {
    const dir = mkdtempSync(join(tmpdir(), "operon-eval-core-")); dirs.push(dir);
    const manifest = join(dir, "campaign.yaml"); const lock = join(dir, "campaign.lock.json");
    writeFileSync(manifest, stringify(campaign())); startCampaign(manifest, lock, new Date("2026-07-12T00:00:00Z"));
    expect(verifyCampaignLock(lock).campaign_id).toBe("baseline-v1");
    writeFileSync(manifest, stringify({ ...campaign(), purpose: "mutated" }));
    expect(() => verifyCampaignLock(lock)).toThrow("campaign_mutated_after_start");
  });
  it("J-MAN-02 near-miss: writes a distinct attempt exactly once", () => {
    const dir = mkdtempSync(join(tmpdir(), "operon-eval-core-")); dirs.push(dir); const path = join(dir, "a1.json"); const c = campaign();
    writeAttemptResult(path, result(c)); expect(JSON.parse(readFileSync(path, "utf8")).outcome).toBe("passed");
    expect(() => writeAttemptResult(path, result(c))).toThrow("duplicate_attempt");
  });
  it("J-MAN-01 near-miss: qualification is read-only arithmetic and missing required attempts are incomplete", () => {
    const c = campaign(); expect(qualify(c, hashManifest(c), []).outcome).toBe("incomplete");
    expect(qualify(c, hashManifest(c), [result(c)]).outcome).toBe("qualified");
    expect(qualify(c, hashManifest(c), [result(c, "product_miss")]).outcome).toBe("not_qualified");
  });
  it("J-MAN-01 honest failure: invalidates missing model identity and undeclared retry structure", () => {
    const c = campaign();
    expect(validateCampaign({ ...c, assignments: [{ ...c.assignments[0], model: "" }] })).toContain("assignments[0].model must be a non-empty string");
    const retry = { ...result(c, "infra_invalid"), attempt_id: "retry", retry_of: "missing" };
    expect(qualify(c, hashManifest(c), [result(c), retry]).outcome).toBe("invalid");
  });
  it("J-GRADE-01 positive: passes a calibrated reference and rejects its mutant", () => {
    expect(() => calibrateGrader({ graderId: "broken", reference: "good", mutants: [{ id: "bad", subject: "bad" }], grade: () => true })).toThrow("broken_grader");
    expect(calibrateGrader({ graderId: "exact", reference: "good", mutants: [{ id: "bad", subject: "bad" }], grade: (value) => value === "good" }).rejected_mutants).toEqual(["bad"]);
  });
  it("J-GRADE-01 near-miss: permits different subject bytes when the oracle still proves the contract", () => {
    expect(calibrateGrader({ graderId: "semantic", reference: { ok: true, note: "reference" }, mutants: [{ id: "bad", subject: { ok: false, note: "different" } }], grade: (value) => value.ok }).reference_passed).toBe(true);
  });
  it("J-GRADE-01 honest failure: rejects a grader that rejects its own reference", () => {
    expect(() => calibrateGrader({ graderId: "rejects-reference", reference: "good", mutants: [{ id: "bad", subject: "bad" }], grade: () => false })).toThrow("rejects reference");
  });
  it("J-MAN-02 honest failure: a foreign campaign result invalidates qualification", () => {
    const c = campaign();
    expect(qualify(c, hashManifest(c), [{ ...result(c), campaign_id: "foreign" }]).outcome).toBe("invalid");
  });
  it("J-MAN-02 honest failure: terminal evidence cannot predate admission or duplicate a reference", () => {
    const dir = mkdtempSync(join(tmpdir(), "operon-eval-invalid-result-")); dirs.push(dir); const c = campaign(); const invalid = { ...result(c), terminal_at: "2026-07-11T23:59:00Z", evidence: ["episode:a1", "episode:a1"] };
    expect(() => writeAttemptResult(join(dir, "result.json"), invalid)).toThrow(/terminal_at must not precede admitted_at.*evidence references must be unique/);
  });
});
