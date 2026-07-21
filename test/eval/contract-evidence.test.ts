import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { stringify } from "yaml";
import { verifyContractEvidence, type ContractEvidenceProjection } from "../../scripts/eval/contract-evidence.js";
import { currentCandidateSnapshot } from "../../scripts/eval/candidate-hash.js";
import { canonicalJson, hashFile, hashManifest, loadYamlFile, qualify, sha256, type AttemptResult, type CampaignManifest } from "../../scripts/eval/core.js";
import { renderQualificationHtml } from "../../scripts/eval/report.js";
import { writeReleaseAttestation } from "../../scripts/eval/release-attestation.js";
import { importSanitizedPromotionEvidence, writeContractEvidenceProjections } from "../../scripts/eval/promotion.js";
import { writeLearningPairEvidence } from "../../scripts/eval/learning-evidence.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("Phase 6 contract promotion accepts a fully content-bound sanitized campaign projection", () => {
  const fixture = makeFixture();
  expect(() => verify(fixture)).not.toThrow();
});

it("Phase 6 imports only committed-safe sanitized evidence and leaves raw state external", () => {
  const fixture = makeFixture();
  const destination = join(fixture.root, "research/evals/imported/candidate-fixture");
  const imported = importSanitizedPromotionEvidence({ root: fixture.root, archiveRoot: fixture.bundle, receiptPath: fixture.receipt, destinationRoot: destination });
  expect(imported.campaign_id).toBe("candidate-fixture");
  expect(() => readFileSync(join(destination, "state/raw.json"))).toThrow();
  expect(JSON.parse(readFileSync(join(destination, "promotion-import.json"), "utf8"))).toMatchObject({ excluded_classes: expect.arrayContaining(["state/**", "provider-scratch/**", "raw outputs"]) });
});

it("Phase 6 projection generation writes the exact nine candidate mappings and self-verifies each output", () => {
  const fixture = makeFixture({ writeProjection: false });
  const result = writeContractEvidenceProjections({ root: fixture.root, campaignPath: join(fixture.bundle, "campaign.yaml"), attestationPath: fixture.attestation });
  expect(result.contracts).toEqual(["D-LIVE-01", "D-LIVE-02", "D-LIVE-03", "E-LIVE-01", "E-LIVE-02", "G-MET-01", "I-ROLE-01", "I-ROLE-02", "I-ROLE-03"]);
});

it("Phase 6 promotion rejects focused admission even if arbitrary local files claim it qualified", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-focused-non-promotion-")); roots.push(root);
  const bundle = join(root, "research/evals/campaigns/focused-fixture");
  const campaign = loadYamlFile(join(process.cwd(), "eval/campaigns/focused-provider-admission.yaml")) as CampaignManifest;
  write(root, relativePath(root, join(bundle, "campaign.yaml")), stringify(campaign));
  expect(() => writeContractEvidenceProjections({ root, campaignPath: join(bundle, "campaign.yaml"), attestationPath: join(bundle, "attestation.json") })).toThrow("promotion_non_qualification_campaign_forbidden");
});

it("Phase 6 release attestation rejects raw evidence even beneath research/evals", () => {
  const fixture = makeFixture();
  unlinkSync(fixture.attestation);
  write(fixture.root, "research/evals/raw-session.log", "provider session must remain external\n");
  expect(() => writeReleaseAttestation({ root: fixture.root, campaignPaths: [join(fixture.bundle, "campaign.yaml")] })).toThrow("release_attestation_unallowlisted_path:research/evals/raw-session.log");
});

for (const [name, mutate] of [
  ["foreign campaign ids", (f: Fixture) => patchJson(f.projection, (value) => { value.campaign_id = "foreign"; })],
  ["stale candidate hashes", (f: Fixture) => patchJson(f.projection, (value) => { (value.candidate as Record<string, unknown>).package_sha256 = digest("0"); })],
  ["mismatched case/repetition ids", (f: Fixture) => patchJson(f.projection, (value) => { value.repetition_ids = ["other"]; })],
  ["malformed results", (f: Fixture) => writeFileSync(f.result, "{not-json\n")],
  ["missing archive receipts", (f: Fixture) => unlinkSync(f.receipt)],
  ["legacy archive policy without the raw-L3 exclusion", (f: Fixture) => {
    patchJson(f.archiveManifest, (value) => { value.policy_version = "sanitized-evidence/v2"; value.excluded_roots = ["provider-scratch/**"]; });
    patchJson(f.projection, (value) => { (value.archive_manifest as Record<string, unknown>).sha256 = fileDigest(f.archiveManifest); });
  }],
  ["invalid measurements", (f: Fixture) => patchJson(f.result, (value) => { ((value.metrics as Record<string, unknown>).context as Record<string, unknown>).rendered_bytes = null; })],
  ["duplicate evidence", (f: Fixture) => patchJson(f.projection, (value) => { value.repetition_ids = ["r1", "r1"]; })],
  ["failed hidden graders", (f: Fixture) => patchJson(f.grader, (value) => { value.hidden_grader_passed = false; value.result = "failed"; })],
  ["provider/settlement mismatch", (f: Fixture) => patchJson(f.result, (value) => { ((value.metrics as Record<string, unknown>).execution as Record<string, unknown>).provider_settlements = 0; })],
  ["route-admission accounting mismatch", (f: Fixture) => patchJson(f.accounting, (value) => { value.admitted_routes = { foreign: "standard" }; })],
  ["changed executable eval bytes", (f: Fixture) => writeFileSync(join(f.root, "scripts/eval/run.ts"), "export const changedAfterQualification = true;\n")],
  ["an unallowlisted evidence-descendant path", (f: Fixture) => write(f.root, "research/evals/leaked-raw-session.log", "unsanitized descendant beneath the evidence tree\n")],
  ["evidence from an earlier candidate", (f: Fixture) => writeFileSync(join(f.root, "src/index.ts"), "export const changedAfterQualification = true;\n")],
] as const) {
  it(`Phase 6 contract promotion rejects ${name}`, () => {
    const fixture = makeFixture();
    mutate(fixture);
    expect(() => verify(fixture)).toThrow();
  });
}

it("Phase 6 contract promotion ignores a non-packaged docs change outside the packaged artifact (ROOT-001)", () => {
  // The changed-path attestation rule binds only to files affecting the packaged
  // artifact (docs/PURPOSE.md 2026-07-17). This is the exact docs-only file whose
  // addition silently invalidated the evidence on main under the old rule.
  const fixture = makeFixture();
  write(fixture.root, "docs/architecture/conceptual-overview.md", "docs-only change; not shipped in the package\n");
  expect(() => verify(fixture)).not.toThrow();
});

interface Fixture {
  root: string;
  projection: string;
  result: string;
  grader: string;
  accounting: string;
  receipt: string;
  archiveManifest: string;
  bundle: string;
  attestation: string;
}

function makeFixture(options: { writeProjection?: boolean } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "operon-contract-evidence-")); roots.push(root);
  for (const [path, bytes] of [
    ["package.json", '{"name":"contract-fixture","version":"1.0.0","files":["dist/**/*.js"],"packageManager":"pnpm@11.10.0","dependencies":{}}\n'],
    ["dist/cli.js", "export {};\n"],
    ["pnpm-lock.yaml", "lockfileVersion: '9.0'\n"],
    ["tsconfig.json", "{}\n"],
    ["src/index.ts", "export const candidate = true;\n"],
    ["scripts/eval/run.ts", "export {};\n"],
    ["test/run.test.ts", "export {};\n"],
    ["eval/case.yaml", "schema_version: 1\n"],
    ["roles.yaml", "roles: []\n"],
    ["pipelines.yaml", "pipelines: []\n"],
    ["TASTE.md", "# Fixture\n"],
    ["prompts/pass.md", "fixture\n"],
    ["taste/builder.md", "fixture\n"],
  ] as const) write(root, path, bytes);
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["-c", "user.name=Eval", "-c", "user.email=eval@invalid", "-c", "commit.gpgsign=false", "commit", "-m", "qualified candidate"], { cwd: root });
  const snapshot = currentCandidateSnapshot(root);
  const campaign: CampaignManifest = {
    schema_version: 1, campaign_id: "candidate-fixture", purpose: "fixture", owner: "test", created_at: "2026-07-14T00:00:00.000Z", intent: "qualification",
    candidate: { commit: snapshot.commit, package_sha256: snapshot.package_sha256, suite_sha256: snapshot.suite_sha256, ...(snapshot.release_package_sha256 !== undefined ? { release_package_sha256: snapshot.release_package_sha256 } : {}), ...(snapshot.executable_suite_sha256 !== undefined ? { executable_suite_sha256: snapshot.executable_suite_sha256 } : {}) },
    org_fingerprint: snapshot.org_fingerprint, system_fingerprint: snapshot.system_fingerprint,
    cases: [], assignments: [], price_catalog_id: "prices/2026-07-12-v1", randomization_seed: "fixture", github: { owner: "fixture", repo_pattern: "operon-eval-*" }, spend: { campaign_max_usd: 375, case_max_usd: {} }, infrastructure_retries: 1, exclusions: ["typed_transient_provider_failure"], stop_rules: ["hard_safety_violation"], operator_fixture: "operator-fixtures/fixture-v1.yaml", evidence_dir: ".eval-artifacts/candidate-fixture",
  };
  const template = loadYamlFile(join(process.cwd(), "eval/campaigns/candidate-qualification.yaml")) as CampaignManifest;
  // The template's optional fields are always populated in the real
  // candidate-qualification.yaml; the guards satisfy exactOptionalPropertyTypes
  // (never assign `undefined` to an optional key) without changing behavior.
  if (template.profile !== undefined) campaign.profile = template.profile;
  if (template.learning_treatment !== undefined) campaign.learning_treatment = structuredClone(template.learning_treatment);
  if (template.learning_efficacy !== undefined) campaign.learning_efficacy = structuredClone(template.learning_efficacy);
  if (template.blocks !== undefined) campaign.blocks = structuredClone(template.blocks);
  campaign.cases = structuredClone(template.cases);
  campaign.assignments = structuredClone(template.assignments);
  campaign.randomization_seed = template.randomization_seed;
  campaign.spend = structuredClone(template.spend);
  const bundle = join(root, "research/evals/campaigns/candidate-fixture");
  const campaignPath = join(bundle, "campaign.yaml"); write(root, relativePath(root, campaignPath), stringify(campaign));
  const campaignHash = hashManifest(campaign);
  const attempts = campaign.cases.flatMap((item) => item.repetition_ids.map((repetitionId) => campaignAttempt(campaign, item.case_id, repetitionId)));
  for (const result of attempts.filter((item) => item.case_id.startsWith("learning/"))) {
    const learning = result.metrics.learning as Record<string, unknown>;
    learning.score_components = fixtureScoreComponents(Number(learning.effect_value));
    learning.score_scale = { minimum: 0, maximum: 8, component_minimum: 0, component_maximum: 2, components: campaign.learning_efficacy!.components };
  }
  const evidenceFiles: string[] = [];
  for (const result of attempts) {
    const execution = result.metrics.execution as Record<string, unknown>;
    const turns = Number(execution.provider_turns);
    if (turns > 0) {
      const accountingPath = join(bundle, "accounting", `${result.attempt_id}.json`);
      const ids = Array.from({ length: turns }, (_, index) => `${result.attempt_id}-turn-${index + 1}`);
      const route = String((result.metrics.route as Record<string, unknown>).planned);
      writeJson(accountingPath, { schema_version: 1, evidence_kind: "attempt-accounting", campaign_sha256: campaignHash, attempt_id: result.attempt_id, case_id: result.case_id, repetition_id: result.repetition_id, app: result.case_id.startsWith("quick/") ? "library" : "service", run_ids: ids.map((id) => `run-${id}`), provider_turn_ids: ids, settlement_ids: ids, envelope_sha256: {}, terminal_statuses: {}, admitted_routes: Object.fromEntries(ids.map((id) => [`run-${id}`, route])), provider_turns: turns, provider_settlements: turns, mechanical_settlements: 0, terminal_integrity: 1, passed: true, missing: [] });
      const graderPath = join(bundle, "grader", `${result.attempt_id}.json`);
      const specialized = /^(planning|context|continuation|approval|learning|roles)\//.test(result.case_id);
      const verifierPath = join(bundle, "artifact", "verifier", result.attempt_id, "grader-evidence.json");
      if (specialized) {
        const learning = result.metrics.learning as Record<string, unknown>;
        writeJson(verifierPath, result.case_id.startsWith("learning/") ? { evidence_version: 3, artifact_sha256: learning.artifact_sha256, artifact_score: learning.effect_value, score_components: learning.score_components, score_scale: learning.score_scale, arm: learning.arm, pair_id: learning.pair_id, treatment_sha256: learning.treatment_sha256, treatment_applied: learning.treatment_applied, hidden_guardrails_passed: true, independent_reviewer_artifact_sha256: learning.independent_reviewer_artifact_sha256, independent_reviewer_verdict: "approve" } : { evidence_version: 2, result: "fixture" });
        evidenceFiles.push(verifierPath);
      }
      writeJson(graderPath, { schema_version: 2, campaign_sha256: campaignHash, case_id: result.case_id, repetition_id: result.repetition_id, attempt_id: result.attempt_id, grader_ref: "graders/fixture.ts", grader_sha256: digest("a"), visible_gate_passed: true, hidden_grader_passed: true, verifier_evidence: specialized ? `artifact:artifact/verifier/${result.attempt_id}/grader-evidence.json` : null, verifier_evidence_sha256: specialized ? fileDigest(verifierPath) : null, result: "passed", missing: [] });
      result.evidence = [`grader:grader/${result.attempt_id}.json`, `accounting:accounting/${result.attempt_id}.json`, ...(specialized ? [`artifact:artifact/verifier/${result.attempt_id}/grader-evidence.json`] : [])];
      evidenceFiles.push(accountingPath, graderPath);
    }
    const resultPath = join(bundle, "results", `${result.attempt_id}.json`); writeJson(resultPath, result); evidenceFiles.push(resultPath);
  }
  const attempt = attempts.find((item) => item.case_id === "quick/ignore-config/v1" && item.repetition_id === "clean-q1")!;
  const resultPath = join(bundle, "results", `${attempt.attempt_id}.json`);
  const graderPath = join(bundle, "grader", `${attempt.attempt_id}.json`);
  const accountingPath = join(bundle, "accounting", `${attempt.attempt_id}.json`);
  const pair = writeLearningPairEvidence({ campaign, campaignSha256: campaignHash, campaignRoot: bundle, results: attempts });
  evidenceFiles.push(pair.path);
  const action = { campaign_id: campaign.campaign_id, campaign_sha256: campaignHash, learning_candidate_sha256: campaign.learning_treatment!.content_sha256, pair_evidence_sha256: pair.sha256, outward_effects: 0 };
  const governance = { schema_version: 1, evidence_kind: "phase6-learning-governance", campaign_id: campaign.campaign_id, campaign_sha256: campaignHash, candidate_commit: campaign.candidate.commit, candidate_package_sha256: campaign.candidate.release_package_sha256, learning_candidate_sha256: campaign.learning_treatment!.content_sha256, pair_evidence_sha256: pair.sha256, action, action_sha256: `sha256:${sha256(canonicalJson(action))}`, approval: { separate_from_l5: true, exact_candidate_confirmed: true, exact_action_confirmed: true, human_decisions: 1, grant_uses_remaining: 0 }, experiment: { verdict: "improved", guardrails_passed: true, actual_pair_count: 3 }, publisher: { governed: true }, lifecycle: { activation_count: 1, rollback_count: 1, canary_cleared: true, intervention_status: "rolled_back" }, self_reviewed: false, self_approved: false, self_published: false, self_activated: false, production_path_overlap: false, outward_effects: 0 };
  const governancePath = join(bundle, "artifact", "learning-governance.json"); writeJson(governancePath, governance); evidenceFiles.push(governancePath);
  const qualification = qualify(campaign, campaignHash, attempts, { learning_pairs: { value: pair.evidence as unknown as Record<string, unknown>, sha256: pair.sha256 }, learning_governance: { value: governance, sha256: fileDigest(governancePath) } });
  if (qualification.outcome !== "qualified") throw new Error(`fixture qualification failed: ${qualification.reasons.join(";")}`);
  const qualificationPath = join(bundle, "qualification-final.json"); writeJson(qualificationPath, qualification);
  const reportPath = join(bundle, "report-final.html"); write(root, relativePath(root, reportPath), renderQualificationHtml(qualification));
  const githubPath = join(bundle, "github-evidence-deadbeef.json");
  writeJson(githubPath, { schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: campaignHash, repo: "fixture/operon-eval-candidate-fixture", repository_id: "R_fixture", result: "passed" });
  const idempotencePath = join(bundle, "github-idempotence-deadbeef.json");
  writeJson(idempotencePath, { schema_version: 1, evidence_kind: "github-idempotence", campaign_id: campaign.campaign_id, campaign_sha256: campaignHash, repo: "fixture/operon-eval-candidate-fixture", repository_id: "R_fixture", source_evidence: "github-evidence-deadbeef.json", source_evidence_sha256: fileDigest(githubPath), reused_evidence: true, idempotent_rerun: true, result: "passed", issue_closed: true, pr_merged: true, review_count: 1, comment_count: 1, branch_deleted: true });
  const archived = [campaignPath, ...evidenceFiles, qualificationPath, reportPath, githubPath, idempotencePath];
  const archiveManifestPath = join(bundle, "archive-manifest.json");
  writeJson(archiveManifestPath, { schema_version: 2, archive_kind: "sanitized-evidence", policy_version: "sanitized-evidence/v3", campaign_id: campaign.campaign_id, campaign_sha256: campaignHash, archived_at: "2026-07-14T00:02:00.000Z", excluded_roots: ["provider-scratch/**", "state/runs/**"], files: Object.fromEntries(archived.map((path) => [relativePath(bundle, path), fileDigest(path)])), source_files: Object.fromEntries(archived.map((path) => [relativePath(bundle, path), fileDigest(path)])), redacted_files: {} });
  const receiptPath = join(bundle, "archive-receipt.json");
  writeJson(receiptPath, { schema_version: 2, archive_kind: "sanitized-evidence", policy_version: "sanitized-evidence/v3", campaign_id: campaign.campaign_id, campaign_sha256: campaignHash, destination: bundle, archive_manifest_sha256: fileDigest(archiveManifestPath), archived_at: "2026-07-14T00:02:00.000Z" });
  const attestationPath = join(root, "research/evals/phase6-release-attestation.json");
  writeReleaseAttestation({ root, campaignPaths: [campaignPath] });
  const projectionPath = join(root, "research/evals/contracts/D-LIVE-01.json");
  const projection: ContractEvidenceProjection = {
    schema_version: 1, contract_id: "D-LIVE-01", campaign_id: campaign.campaign_id, campaign_sha256: campaignHash, candidate: campaign.candidate, org_fingerprint: campaign.org_fingerprint, system_fingerprint: campaign.system_fingerprint, case_id: attempt.case_id, repetition_ids: [attempt.repetition_id], prepared_manifest: ref(root, campaignPath), qualification: ref(root, qualificationPath), report: ref(root, reportPath), archive_receipt: ref(root, receiptPath), archive_manifest: ref(root, archiveManifestPath), github_evidence: ref(root, githubPath), github_idempotence: ref(root, idempotencePath), release_attestation: ref(root, attestationPath),
  };
  if (options.writeProjection !== false) writeJson(projectionPath, projection);
  return { root, projection: projectionPath, result: resultPath, grader: graderPath, accounting: accountingPath, receipt: receiptPath, archiveManifest: archiveManifestPath, bundle, attestation: attestationPath };
}

function verify(fixture: Fixture): void {
  // This is a self-contained fixture whose live working tree is a clean checkout
  // AT the qualified candidate commit, so product-currency is meaningful here and
  // the rejection cases below (changed executable/src bytes, unallowlisted
  // descendant) exercise the CURRENCY layer. Verify in "release" scope so the full
  // fail-closed release boundary is proven, unlike the offline dev suite which
  // asserts evidence integrity only (docs/PURPOSE.md 2026-07-17).
  verifyContractEvidence(fixture.root, fixture.projection, { contractId: "D-LIVE-01", caseId: "quick/ignore-config/v1", repetitionIds: ["clean-q1"] }, "release");
}

function campaignAttempt(campaign: CampaignManifest, caseId: string, repetitionId: string): AttemptResult {
  const route = caseId.startsWith("planning/") ? repetitionId.replace(/^goal-/, "") : caseId.startsWith("quick/") ? "quick" : caseId.startsWith("deep/") || caseId.startsWith("approval/") ? "deep" : caseId.startsWith("soak/") ? "mechanical" : "standard";
  const turns = route === "mechanical" ? 0 : route === "quick" ? 3 : route === "deep" ? 5 : 4;
  return { schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: hashManifest(campaign), attempt_id: `${caseId.replaceAll("/", "-")}-${repetitionId}`, case_id: caseId, repetition_id: repetitionId, outcome: "passed", admitted_at: "2026-07-14T00:00:00.000Z", terminal_at: "2026-07-14T00:01:00.000Z", evidence: [`fixture:${repetitionId}`], metrics: canonicalMetrics(campaign, caseId, repetitionId, route, turns), exclusions: [], missing: [] };
}

function canonicalMetrics(campaign: CampaignManifest, caseId: string, repetitionId: string, route: string, turns: number): Record<string, unknown> {
  const excluded = (reason: string) => ({ excluded: [reason] });
  const treatment = repetitionId.endsWith("-treatment");
  const artifactSha = digest(treatment ? "2" : "1"); const reviewerSha = digest(treatment ? "4" : "3");
  return { route: { planned: route, final: route, model_turns: turns }, context: { rendered_bytes: 10, sources: { task: 10 } }, cost: { equivalent_usd: turns === 0 ? 0 : 0.1, product_usd: turns === 0 ? 0 : 0.1, evaluator_usd: 0, quality: "complete" }, tokens: turns === 0 ? excluded("no_provider_turn") : { input: turns * 10, output: turns * 2, quality: "complete" }, latency: { elapsed_ms: 60_000, active_ms: 10, human_wait_ms: 0 }, human_load: { decisions: 0 }, productivity: turns === 0 ? excluded("no_provider_turn") : { productive_passes: turns, total_passes: turns, ratio: 1, repeated_work_cost_usd: 0 }, continuation: caseId.startsWith("continuation/") ? { eligible: 1, resumed_without_repeat: 1, ratio: 1 } : excluded("not_continuation_case"), approvals: caseId.startsWith("approval/") ? { valid_requests: 1, total_requests: 1, precision: 1, recurrence: 0 } : excluded("not_approval_case"), scheduler: caseId.startsWith("soak/") ? { due_ticks: 2016, reasoned_ticks: 2016, reliability: 1, duplicate_ticks: 0 } : excluded("not_scheduler_case"), learning: caseId.startsWith("learning/") ? { eligible_capture: 1, captured: 1, capture_ratio: 1, effect_value: treatment ? 6 : 5, artifact_sha256: artifactSha, independent_reviewer_artifact_sha256: reviewerSha, independent_reviewer_verdict: "approve", pair_id: repetitionId.split("-").slice(0, 2).join("-"), arm: treatment ? "treatment" : "control", treatment_applied: treatment, treatment_sha256: treatment ? campaign.learning_treatment!.content_sha256 : null, hidden_guardrails_passed: true, self_reviewed: false, self_approved: false, self_published: false, self_activated: false } : excluded("not_learning_case"), execution: { terminal_integrity: 1, provider_turns: turns, mechanical_steps: route === "mechanical" ? 2016 : 0, provider_settlements: turns, mechanical_settlements: 0 }, capabilities: { outward_effects: 0, hidden_answer_leakage: false, production_path_overlap: false } };
}

function fixtureScoreComponents(score: number): Record<string, number> {
  let remaining = score;
  return Object.fromEntries(["grounded_error_classes", "causal_hypothesis", "bounded_reversible_intervention", "measurable_guardrails"].map((name) => {
    const value = Math.min(2, remaining); remaining -= value; return [name, value];
  }));
}

function ref(root: string, path: string): { path: string; sha256: string } { return { path: relativePath(root, path), sha256: fileDigest(path) }; }
function fileDigest(path: string): string { return `sha256:${hashFile(path)}`; }
function digest(character: string): string { return `sha256:${character.repeat(64)}`; }
function writeJson(path: string, value: unknown): void { writePath(path, `${JSON.stringify(value, null, 2)}\n`); }
function write(root: string, path: string, bytes: string): void { writePath(join(root, path), bytes); }
function writePath(path: string, bytes: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
function relativePath(root: string, path: string): string { return path.slice(root.length + (root.endsWith("/") ? 0 : 1)).replaceAll("\\", "/"); }
function patchJson(path: string, mutate: (value: Record<string, unknown>) => void): void { const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; mutate(value); writeJson(path, value); }
