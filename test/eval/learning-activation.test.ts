import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { hashFile, hashManifest, hashTree, loadYamlFile, type AttemptResult, type CampaignManifest } from "../../scripts/eval/core.js";
import { executeLearningActivation, learningActivationPreview } from "../../scripts/eval/learning-activation-core.js";
import { validateLearningPairEvidence, writeLearningPairEvidence } from "../../scripts/eval/learning-evidence.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("H-EVAL-01 derives AB/BA/AB outcomes from exact retained provider artifacts instead of a fixed verdict", () => {
  const rig = makeRig([5, 6, 5, 6, 5, 6]);
  const written = writeLearningPairEvidence(rig);
  expect(written.evidence).toMatchObject({ declared_pair_order: ["AB", "BA", "AB"], complete_pairs: 3, terminal_attempts: 6, outcome: "improved", hidden_guardrails_passed: true });
  expect(written.evidence.pairs.map((pair) => pair.delta)).toEqual([1, 1, 1]);
  expect(validateLearningPairEvidence(written.evidence, rig.campaign, rig.campaignSha256)).toEqual([]);

  const equal = makeRig([5, 5, 5, 5, 5, 5]);
  const inconclusive = writeLearningPairEvidence(equal);
  expect(inconclusive.evidence.outcome).toBe("inconclusive");
  expect(() => learningActivationPreview({ repositoryRoot: equal.repositoryRoot, campaign: equal.campaign, campaignSha256: equal.campaignSha256, campaignRoot: equal.campaignRoot })).toThrow(/pair_evidence_invalid:learning pair outcome inconclusive/);

  const rejected = makeRig([5, 6, 5, 6, 5, 6], "pair-2-treatment");
  const regressed = writeLearningPairEvidence(rejected);
  expect(regressed.evidence).toMatchObject({ complete_pairs: 3, terminal_attempts: 6, outcome: "regressed", hidden_guardrails_passed: false, missing: [] });
  expect(regressed.evidence.pairs[1]?.treatment).toMatchObject({ independent_reviewer_verdict: "reject", hidden_guardrails_passed: false, attempt_outcome: "product_miss" });
  expect(() => learningActivationPreview({ repositoryRoot: rejected.repositoryRoot, campaign: rejected.campaign, campaignSha256: rejected.campaignSha256, campaignRoot: rejected.campaignRoot })).toThrow(/pair_evidence_invalid:learning pair hidden guardrails failed/);
});

it("H-EVAL-02 previews one content-bound activation/rollback without mutation and rejects stale result bytes", () => {
  const rig = makeRig([5, 6, 5, 6, 5, 6]);
  writeLearningPairEvidence(rig);
  const before = hashTree(rig.campaignRoot);
  const preview = learningActivationPreview(rig);
  expect(hashTree(rig.campaignRoot)).toBe(before);
  expect(preview).toMatchObject({ candidate_sha256: rig.campaign.learning_treatment!.content_sha256, pair_evidence: { outcome: "improved" }, action: { operation: "publish_predeclared_t1_start_isolated_canary_and_rollback_once", outward_effects: 0 } });
  expect(preview.action_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);

  const attempt = rig.results[0]!;
  const path = join(rig.campaignRoot, "results", `${attempt.attempt_id}.json`);
  writeFileSync(path, `${JSON.stringify({ ...attempt, outcome: "product_miss" }, null, 2)}\n`);
  expect(() => learningActivationPreview(rig)).toThrow(/result_hash_mismatch/);
});

it("H-EVAL-02 requires exact candidate/action confirmation and performs one isolated governed activation plus rollback", async () => {
  const rig = makeRig([5, 6, 5, 6, 5, 6]);
  writeLearningPairEvidence(rig);
  const preview = learningActivationPreview(rig);
  await expect(executeLearningActivation({ ...rig, actionSha256: `sha256:${"0".repeat(64)}`, candidateSha256: preview.candidate_sha256 })).rejects.toThrow(/action_confirmation_mismatch/);
  await expect(executeLearningActivation({ ...rig, actionSha256: preview.action_sha256, candidateSha256: `sha256:${"0".repeat(64)}` })).rejects.toThrow(/candidate_confirmation_mismatch/);
  const receipt = await executeLearningActivation({ ...rig, actionSha256: preview.action_sha256, candidateSha256: preview.candidate_sha256 });
  expect(receipt).toMatchObject({ approval: { separate_from_l5: true, exact_candidate_confirmed: true, exact_action_confirmed: true, human_decisions: 1, grant_uses_remaining: 0 }, experiment: { actual_pair_count: 3, verdict: "improved", guardrails_passed: true }, publisher: { governed: true }, lifecycle: { activation_count: 1, rollback_count: 1, canary_cleared: true, intervention_status: "rolled_back" }, self_reviewed: false, self_approved: false, self_published: false, self_activated: false, production_path_overlap: false, outward_effects: 0 });
});

function makeRig(scores: [number, number, number, number, number, number], rejectedRepetition?: string) {
  const root = mkdtempSync(join(tmpdir(), "operon-learning-activation-")); roots.push(root);
  const template = loadYamlFile(join(process.cwd(), "eval/campaigns/candidate-qualification.yaml")) as CampaignManifest;
  const campaign: CampaignManifest = { ...template, campaign_id: `learning-fixture-${roots.length}`, created_at: "2026-07-14T00:00:00.000Z", candidate: { commit: "candidate", package_sha256: `sha256:${"a".repeat(64)}`, suite_sha256: `sha256:${"b".repeat(64)}`, release_package_sha256: `sha256:${"c".repeat(64)}`, executable_suite_sha256: `sha256:${"d".repeat(64)}` }, org_fingerprint: `sha256:${"e".repeat(64)}`, system_fingerprint: `sha256:${"f".repeat(64)}`, evidence_dir: `.eval-artifacts/learning-fixture-${roots.length}` };
  const campaignSha256 = hashManifest(campaign);
  const campaignRoot = join(root, "campaign");
  mkdirSync(join(campaignRoot, "results"), { recursive: true });
  const repetitions = ["pair-1-control", "pair-1-treatment", "pair-2-treatment", "pair-2-control", "pair-3-control", "pair-3-treatment"];
  const scoreByRepetition = new Map([["pair-1-control", scores[0]], ["pair-1-treatment", scores[1]], ["pair-2-control", scores[2]], ["pair-2-treatment", scores[3]], ["pair-3-control", scores[4]], ["pair-3-treatment", scores[5]]]);
  const results = repetitions.map((repetition) => {
    const attemptId = `learning-closure-v1-${repetition}`;
    const treatment = repetition.endsWith("-treatment");
    const score = scoreByRepetition.get(repetition)!;
    const rejected = repetition === rejectedRepetition;
    const scoreComponents = distributeScore(score);
    const scoreScale = { minimum: 0, maximum: 8, component_minimum: 0, component_maximum: 2, components: campaign.learning_efficacy!.components };
    const artifactSha = `sha256:${(treatment ? "2" : "1").repeat(64)}`;
    const reviewerSha = `sha256:${(treatment ? "4" : "3").repeat(64)}`;
    const verifierDir = join(campaignRoot, "artifact", "verifier", attemptId); mkdirSync(verifierDir, { recursive: true });
    const verifier = { evidence_version: 3, artifact_sha256: artifactSha, artifact_score: score, score_components: scoreComponents, score_scale: scoreScale, arm: treatment ? "treatment" : "control", pair_id: repetition.split("-").slice(0, 2).join("-"), treatment_sha256: treatment ? campaign.learning_treatment!.content_sha256 : null, treatment_applied: treatment, hidden_guardrails_passed: !rejected, independent_reviewer_artifact_sha256: reviewerSha, independent_reviewer_verdict: rejected ? "reject" : "approve" };
    const verifierPath = join(verifierDir, "grader-evidence.json"); writeFileSync(verifierPath, `${JSON.stringify(verifier, null, 2)}\n`);
    const graderDir = join(campaignRoot, "grader"); mkdirSync(graderDir, { recursive: true });
    const verifierRef = `artifact:artifact/verifier/${attemptId}/grader-evidence.json`;
    const graderRef = `grader:grader/${attemptId}.json`;
    writeFileSync(join(graderDir, `${attemptId}.json`), `${JSON.stringify({ schema_version: 2, campaign_sha256: campaignSha256, case_id: "learning/closure/v1", repetition_id: repetition, attempt_id: attemptId, grader_ref: "graders/learning-closure.ts", grader_sha256: `sha256:${"9".repeat(64)}`, visible_gate_passed: true, hidden_grader_passed: !rejected, verifier_evidence: verifierRef, verifier_evidence_sha256: `sha256:${hashFile(verifierPath)}`, result: rejected ? "failed" : "passed", missing: [] }, null, 2)}\n`);
    const result: AttemptResult = { schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: campaignSha256, attempt_id: attemptId, case_id: "learning/closure/v1", repetition_id: repetition, outcome: rejected ? "product_miss" : "passed", admitted_at: "2026-07-14T00:00:00.000Z", terminal_at: "2026-07-14T00:01:00.000Z", evidence: [verifierRef, graderRef], metrics: { learning: { effect_value: score, score_components: scoreComponents, score_scale: scoreScale, artifact_sha256: artifactSha, independent_reviewer_artifact_sha256: reviewerSha, independent_reviewer_verdict: rejected ? "reject" : "approve", arm: treatment ? "treatment" : "control", pair_id: repetition.split("-").slice(0, 2).join("-"), treatment_sha256: treatment ? campaign.learning_treatment!.content_sha256 : null, treatment_applied: treatment, hidden_guardrails_passed: !rejected } }, exclusions: [], missing: rejected ? ["learning_hidden_guardrail_failed"] : [] };
    writeFileSync(join(campaignRoot, "results", `${attemptId}.json`), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  });
  return { repositoryRoot: process.cwd(), campaign, campaignSha256, campaignRoot, results };
}

function distributeScore(score: number): Record<string, number> {
  let remaining = score;
  return Object.fromEntries(["grounded_error_classes", "causal_hypothesis", "bounded_reversible_intervention", "measurable_guardrails"].map((name) => {
    const value = Math.min(2, remaining); remaining -= value; return [name, value];
  }));
}
