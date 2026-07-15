import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { actionHash, ApprovalStore } from "../../src/org/approvals.js";
import { startCanary, stopCanary } from "../../src/org/learning/canary.js";
import { openCandidateArtifact } from "../../src/org/learning/candidate-store.js";
import { cutManifestVersion, orgLearningRoot, readManifest } from "../../src/org/learning/concepts.js";
import { computeEvalResult, decideExperiment } from "../../src/org/learning/eval-result.js";
import { declareExperiment } from "../../src/org/learning/experiment.js";
import { readInterventionRecord } from "../../src/org/learning/intervention.js";
import { defaultLearningPolicy } from "../../src/org/learning/policy.js";
import { publishCandidate } from "../../src/org/learning/publisher.js";
import { writeReviewerVerdict } from "../../src/org/learning/review.js";
import { canonicalJson, hashFile, sha256, type CampaignManifest } from "./core.js";
import { validateLearningPairEvidence, type LearningPairEvidence } from "./learning-evidence.js";

export interface LearningActivationAction {
  kind: "phase6_learning_activation_and_rollback";
  campaign_id: string;
  campaign_sha256: string;
  candidate_commit: string;
  candidate_package_sha256: string;
  learning_candidate_sha256: string;
  pair_evidence_sha256: string;
  reviewer_artifact_sha256: string[];
  operation: "publish_predeclared_t1_start_isolated_canary_and_rollback_once";
  target: "isolated_eval_learning_roots";
  outward_effects: 0;
}

export interface LearningActivationReceipt {
  schema_version: 1;
  evidence_kind: "phase6-learning-governance";
  campaign_id: string;
  campaign_sha256: string;
  candidate_commit: string;
  candidate_package_sha256: string;
  learning_candidate_sha256: string;
  pair_evidence_sha256: string;
  action: LearningActivationAction;
  action_sha256: string;
  approval: { separate_from_l5: true; exact_candidate_confirmed: true; exact_action_confirmed: true; human_decisions: 1; publisher_approval_id: string; publisher_action_hash: string; grant_uses_remaining: 0 };
  experiment: { id: string; actual_pair_count: 3; verdict: "improved"; guardrails_passed: true; result_ref: string };
  publisher: { governed: true; candidate_id: string; intervention_id: string; published_version: string | null };
  lifecycle: { activation_count: 1; rollback_count: 1; canary_cleared: true; intervention_status: "rolled_back" };
  self_reviewed: false;
  self_approved: false;
  self_published: false;
  self_activated: false;
  production_path_overlap: false;
  outward_effects: 0;
}

export function learningActivationPreview(input: { repositoryRoot: string; campaign: CampaignManifest; campaignSha256: string; campaignRoot: string }): { action: LearningActivationAction; action_sha256: string; candidate_sha256: string; pair_evidence: LearningPairEvidence; pair_evidence_sha256: string } {
  const treatment = input.campaign.learning_treatment;
  if (!treatment) throw new Error("learning_activation_treatment_missing");
  const pairPath = join(input.campaignRoot, "artifact", "learning-pairs.json");
  if (!existsSync(pairPath)) throw new Error("learning_activation_pair_evidence_missing");
  const pairEvidence = JSON.parse(readFileSync(pairPath, "utf8")) as LearningPairEvidence;
  const errors = validateLearningPairEvidence(pairEvidence, input.campaign, input.campaignSha256);
  if (errors.length > 0) throw new Error(`learning_activation_pair_evidence_invalid:${errors.join(";")}`);
  const treatmentPath = join(input.repositoryRoot, "eval", treatment.source);
  if (!existsSync(treatmentPath) || `sha256:${hashFile(treatmentPath)}` !== treatment.content_sha256) throw new Error("learning_activation_treatment_hash_mismatch");
  verifyLearningPairFiles(input.campaignRoot, pairEvidence);
  const pairEvidenceSha256 = `sha256:${hashFile(pairPath)}`;
  const reviewerHashes = pairEvidence.pairs.flatMap((pair) => [pair.control!.independent_reviewer_artifact_sha256, pair.treatment!.independent_reviewer_artifact_sha256]).sort();
  const action: LearningActivationAction = {
    kind: "phase6_learning_activation_and_rollback",
    campaign_id: input.campaign.campaign_id,
    campaign_sha256: input.campaignSha256,
    candidate_commit: input.campaign.candidate.commit,
    candidate_package_sha256: input.campaign.candidate.release_package_sha256 ?? input.campaign.candidate.package_sha256,
    learning_candidate_sha256: treatment.content_sha256,
    pair_evidence_sha256: pairEvidenceSha256,
    reviewer_artifact_sha256: reviewerHashes,
    operation: "publish_predeclared_t1_start_isolated_canary_and_rollback_once",
    target: "isolated_eval_learning_roots",
    outward_effects: 0,
  };
  return { action, action_sha256: `sha256:${sha256(canonicalJson(action))}`, candidate_sha256: treatment.content_sha256, pair_evidence: pairEvidence, pair_evidence_sha256: pairEvidenceSha256 };
}

export async function executeLearningActivation(input: { repositoryRoot: string; campaign: CampaignManifest; campaignSha256: string; campaignRoot: string; actionSha256: string; candidateSha256: string }): Promise<LearningActivationReceipt> {
  const preview = learningActivationPreview(input);
  if (input.actionSha256 !== preview.action_sha256) throw new Error("learning_activation_action_confirmation_mismatch");
  if (input.candidateSha256 !== preview.candidate_sha256) throw new Error("learning_activation_candidate_confirmation_mismatch");
  const evidenceRoot = join(input.campaignRoot, "learning-governance");
  const orgHome = join(evidenceRoot, "org");
  const stateHome = join(evidenceRoot, "state");
  if (existsSync(join(input.campaignRoot, "artifact", "learning-governance.json"))) throw new Error("learning_activation_already_recorded");
  mkdirSync(stateHome, { recursive: true });
  const learningRoot = orgLearningRoot(orgHome);
  const suffix = sha256(input.campaignSha256).slice(0, 16);
  const candidateId = `cand_phase6_${suffix}`;
  const experimentId = `exp_phase6_${suffix}`;
  const evalId = `eval_phase6_${suffix}`;
  const conceptId = `lrn_phase6_${suffix}`;
  const base = new Date(input.campaign.created_at).getTime();
  const at = (minutes: number) => new Date(base + minutes * 60_000);
  await cutManifestVersion(learningRoot, { concepts: ["lrn_phase6_base"], now: at(1) });
  await openCandidateArtifact(learningRoot, {
    candidate_id: candidateId,
    destination: "okf_concept",
    title: "Phase 6 predeclared T1 causal review procedure",
    proposed_scope: "roles/builder",
    proposed_tier: "T1",
    claims_efficacy: true,
    experiment_ref: experimentId,
    error_class: "phase6.paired_learning",
    cause_hypothesis: "The predeclared T1 procedure improves independently graded provider artifacts across all retained pairs.",
    episode_ids: preview.pair_evidence.pairs.flatMap((pair) => [pair.control!.attempt_id, pair.treatment!.attempt_id]),
    event_ids: preview.pair_evidence.pairs.map((pair) => pair.pair_id),
    evidence_refs: [`artifact:learning-pairs.json#${preview.pair_evidence_sha256}`],
    content_hash: preview.candidate_sha256,
    draft: { generated_by: "builder", activation_requested: false, action_sha256: preview.action_sha256 },
  }, readFileSync(join(input.repositoryRoot, "eval", input.campaign.learning_treatment!.source), "utf8"));
  const declared = await declareExperiment({
    schema_version: 1,
    experiment_id: experimentId,
    candidate_ref: candidateId,
    unit: "build_ticket",
    hypothesis: "The predeclared T1 treatment increases hidden-grader artifact quality without guardrail regressions.",
    control: { fingerprint_ref: input.campaign.system_fingerprint },
    treatment: { fingerprint_ref: preview.candidate_sha256 },
    eligibility: { episodes: "evals/roles/builder/phase6", app: "service", stage: ["grow"] },
    primary_metric: { name: "artifact_score", expected_direction: "increase", min_useful_improvement_pct: 0 },
    guardrails: [{ metric: "hidden_guardrail_pass", rule: "must_not_decrease" }, { metric: "outward_effects", rule: "must_not_increase" }],
    trials: { layer: "replay", repetitions: 3, early_stop: { on_held_in_failure: true, on_guardrail_trip: true } },
    observation: { outcome_maturity_days: 0 },
    stop_thresholds: { rollback_immediately_if: { metric: "hidden_guardrail_pass", below_control_pct: 100 } },
    decision: { promote_if: input.campaign.learning_efficacy!.improved_rule, otherwise: "reject_or_revise" },
    efficacy_protocol: { declared_at: input.campaign.created_at, baseline: { metric: "artifact_score", value: preview.pair_evidence.pairs.reduce((sum, pair) => sum + pair.control!.score, 0) / 3, source_ref: `artifact:learning-pairs.json#${preview.pair_evidence_sha256}` }, hidden_guardrail_commitment: { sha256: `sha256:${sha256(canonicalJson(preview.pair_evidence.pairs.map((pair) => [pair.control!.verifier_evidence_sha256, pair.treatment!.verifier_evidence_sha256])))}`, fixture_refs: ["evals/roles/builder/phase6"] }, eligibility_sha256: `sha256:${sha256(canonicalJson(preview.pair_evidence.pairs.map((pair) => pair.pair_id)))}`, actor_blinding: { treatment_identity_hidden: true }, pairing: { seed: input.campaign.randomization_seed, order: "alternating_control_treatment" }, budget: { max_usd: 0 }, stop_rules: { retain_attempted_pairs: true, early_stop_reasons: ["held_in_failure", "guardrail_trip", "budget_stop"] }, side_effect_replacement: { network: "fixture_only", publishing: "forbidden", deployment: "sandbox_only" }, missingness: { missing: "invalid_measurement", invalid: "fail_closed" } },
    status: "declared",
    result: null,
  }, { orgHome });
  const trials = preview.pair_evidence.pairs.map((pair, index) => ({ pair: index + 1, control: { artifact_score: pair.control!.score, hidden_guardrail_pass: 1, outward_effects: 0 }, treatment: { artifact_score: pair.treatment!.score, hidden_guardrail_pass: 1, outward_effects: 0 } }));
  const evalResult = computeEvalResult({ experiment: declared.record, trials, graderRef: `phase6:hidden-graders:${preview.pair_evidence_sha256}`, costUsd: 0, decidedBy: "phase6-deterministic-pair-reconciler", decidedAt: at(2).toISOString(), evalId, execution: { validity: "valid", attempted_pairs: [1, 2, 3], completed_pairs: [1, 2, 3], pair_order: preview.pair_evidence.declared_pair_order.map((order, index) => ({ pair: index + 1, order: order === "AB" ? ["control", "treatment"] : ["treatment", "control"] })), halted_reason: null, invalid_reasons: [] } });
  if (evalResult.verdict !== "improved" || !evalResult.guardrails.every((guardrail) => guardrail.pass)) throw new Error("learning_activation_eval_not_improved");
  await decideExperiment(orgHome, evalResult);
  await writeReviewerVerdict(orgHome, {
    schema_version: 1, candidate_id: candidateId, verdict: "approve", proposed_destination: "okf_concept", proposed_tier: "T1", proposed_scope: "roles/builder", experiment_required: true,
    rubric: { correctness: 5, generality: 5, scope_fit: 5, destination_fit: 5, provenance_trust: 5, injection_screen: "clean" }, conflicts_with: [], duplicates: [], eval_required: true, eval_present: true,
    rationale: `Six independent provider reviewer artifacts and three retained positive pairs are bound by ${preview.pair_evidence_sha256}.`, reviewed_by: `provider-review-aggregate:${sha256(canonicalJson(preview.action.reviewer_artifact_sha256)).slice(0, 16)}`, reviewed_at: at(3).toISOString(),
  });
  const approvals = new ApprovalStore(stateHome, { idSource: () => `appr_phase6_${suffix}` });
  const publisher = { orgHome, stateHome, policy: defaultLearningPolicy(), approvals, clock: () => at(4) };
  const raised = await publishCandidate(publisher, candidateId);
  if (raised.status !== "raised") throw new Error(`learning_activation_publish_not_raised:${raised.status}`);
  const pending = await approvals.show(raised.approvalId);
  const publisherActionHash = `sha256:${actionHash(pending.item.action)}`;
  await approvals.decide(raised.approvalId, { decision: "approved", reason: `separate Phase 6 authorization ${preview.action_sha256}`, now: at(5) });
  const published = await publishCandidate(publisher, candidateId);
  if (published.status !== "published") throw new Error(`learning_activation_publish_failed:${published.status}`);
  const interventionId = published.intervention.intervention_id;
  const started = await startCanary({ orgHome, stateHome, interventionId, policy: defaultLearningPolicy(), now: at(6) });
  const stopped = await stopCanary({ orgHome, stateHome, root: "org", reason: `Phase 6 isolated rollback required by ${preview.action_sha256}`, now: at(7) });
  const intervention = await readInterventionRecord(orgHome, interventionId);
  const manifest = await readManifest(learningRoot);
  const approval = await approvals.show(raised.approvalId);
  if (approval.grant?.uses !== 0 || intervention.status !== "rolled_back" || manifest?.canary !== null || manifest?.canary_meta !== null || stopped.meta.intervention_ref !== interventionId || started.meta.intervention_ref !== interventionId) throw new Error("learning_activation_terminal_integrity_failed");
  return {
    schema_version: 1, evidence_kind: "phase6-learning-governance", campaign_id: input.campaign.campaign_id, campaign_sha256: input.campaignSha256, candidate_commit: input.campaign.candidate.commit, candidate_package_sha256: preview.action.candidate_package_sha256, learning_candidate_sha256: preview.candidate_sha256, pair_evidence_sha256: preview.pair_evidence_sha256, action: preview.action, action_sha256: preview.action_sha256,
    approval: { separate_from_l5: true, exact_candidate_confirmed: true, exact_action_confirmed: true, human_decisions: 1, publisher_approval_id: raised.approvalId, publisher_action_hash: publisherActionHash, grant_uses_remaining: 0 },
    experiment: { id: experimentId, actual_pair_count: 3, verdict: "improved", guardrails_passed: true, result_ref: evalResult.eval_id },
    publisher: { governed: true, candidate_id: candidateId, intervention_id: interventionId, published_version: published.intervention.publish?.ref ?? null },
    lifecycle: { activation_count: 1, rollback_count: 1, canary_cleared: true, intervention_status: "rolled_back" },
    self_reviewed: false, self_approved: false, self_published: false, self_activated: false, production_path_overlap: false, outward_effects: 0,
  };
}

export function verifyLearningPairFiles(campaignRoot: string, evidence: LearningPairEvidence): void {
  for (const pair of evidence.pairs) for (const arm of [pair.control, pair.treatment]) {
    if (!arm) throw new Error("learning_activation_pair_arm_missing");
    const resultPath = join(campaignRoot, "results", `${arm.attempt_id}.json`);
    const verifierPath = join(campaignRoot, "artifact", "verifier", arm.attempt_id, "grader-evidence.json");
    const graderPath = join(campaignRoot, "grader", `${arm.attempt_id}.json`);
    if (!existsSync(resultPath) || `sha256:${hashFile(resultPath)}` !== arm.result_sha256) throw new Error(`learning_activation_result_hash_mismatch:${arm.attempt_id}`);
    if (!existsSync(verifierPath) || `sha256:${hashFile(verifierPath)}` !== arm.verifier_evidence_sha256) throw new Error(`learning_activation_verifier_hash_mismatch:${arm.attempt_id}`);
    if (!existsSync(graderPath) || `sha256:${hashFile(graderPath)}` !== arm.grader_evidence_sha256) throw new Error(`learning_activation_grader_hash_mismatch:${arm.attempt_id}`);
    const result = JSON.parse(readFileSync(resultPath, "utf8")) as Record<string, unknown>;
    const verifier = JSON.parse(readFileSync(verifierPath, "utf8")) as Record<string, unknown>;
    const grader = JSON.parse(readFileSync(graderPath, "utf8")) as Record<string, unknown>;
    const metrics = result.metrics as Record<string, unknown> | undefined;
    const learning = metrics?.learning as Record<string, unknown> | undefined;
    if (result.repetition_id !== arm.repetition_id || result.outcome !== arm.attempt_outcome || learning?.artifact_sha256 !== arm.provider_artifact_sha256 || learning?.independent_reviewer_artifact_sha256 !== arm.independent_reviewer_artifact_sha256 || learning?.independent_reviewer_verdict !== "approve" || learning?.effect_value !== arm.score || learning?.hidden_guardrails_passed !== true || verifier.artifact_sha256 !== arm.provider_artifact_sha256 || verifier.independent_reviewer_artifact_sha256 !== arm.independent_reviewer_artifact_sha256 || verifier.independent_reviewer_verdict !== "approve" || verifier.artifact_score !== arm.score || verifier.hidden_guardrails_passed !== true || grader.campaign_sha256 !== evidence.campaign_sha256 || grader.case_id !== "learning/closure/v1" || grader.repetition_id !== arm.repetition_id || grader.attempt_id !== arm.attempt_id || grader.hidden_grader_passed !== true || grader.result !== "passed" || grader.verifier_evidence_sha256 !== arm.verifier_evidence_sha256 || !Array.isArray(grader.missing) || grader.missing.length !== 0) throw new Error(`learning_activation_result_binding_mismatch:${arm.attempt_id}`);
  }
}
