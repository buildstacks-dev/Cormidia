import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  canonicalJson,
  hashFile,
  hashManifest,
  qualify,
  validateCampaign,
  validateResult,
  type AttemptResult,
  type CampaignManifest,
  type Qualification,
} from "./core.js";
import { renderQualificationHtml } from "./report.js";
import { validateLearningPairEvidence, type LearningPairEvidence } from "./learning-evidence.js";
import { verifyLearningPairFiles } from "./learning-activation-core.js";
import { verifyReleaseAttestation } from "./release-attestation.js";

interface FileRef { path: string; sha256: string }

export interface ContractEvidenceProjection {
  schema_version: 1;
  contract_id: string;
  campaign_id: string;
  campaign_sha256: string;
  candidate: CampaignManifest["candidate"];
  org_fingerprint: string;
  system_fingerprint: string;
  case_id: string;
  repetition_ids: string[];
  prepared_manifest: FileRef;
  qualification: FileRef;
  report: FileRef;
  archive_receipt: FileRef;
  archive_manifest: FileRef;
  github_evidence: FileRef;
  github_idempotence: FileRef;
  release_attestation: FileRef;
}

export interface ContractEvidenceExpectation {
  contractId: string;
  caseId: string;
  repetitionIds: string[];
}

export function verifyContractEvidence(root: string, projectionPath: string, expected: ContractEvidenceExpectation): ContractEvidenceProjection {
  return verifyContractEvidenceInternal(root, projectionPath, expected).projection;
}

/** Verify a same-campaign projection set while computing the exact packed
 * release identity once. Every projection still recomputes qualification,
 * archive, grader, accounting, result, and mapping evidence independently. */
export function verifyContractEvidenceSet(root: string, entries: Array<{ projectionPath: string; expected: ContractEvidenceExpectation }>): ContractEvidenceProjection[] {
  if (entries.length === 0) throw new Error("contract_evidence_set_empty");
  let binding: VerifiedReleaseBinding | undefined;
  return entries.map((entry) => {
    const verified = verifyContractEvidenceInternal(root, entry.projectionPath, entry.expected, binding);
    binding = verified.binding;
    return verified.projection;
  });
}

interface VerifiedReleaseBinding {
  campaign_id: string;
  campaign_sha256: string;
  candidate: string;
  org_fingerprint: string;
  system_fingerprint: string;
  attestation_path: string;
  attestation_sha256: string;
}

function verifyContractEvidenceInternal(root: string, projectionPath: string, expected: ContractEvidenceExpectation, verifiedRelease?: VerifiedReleaseBinding): { projection: ContractEvidenceProjection; binding: VerifiedReleaseBinding } {
  const repositoryRoot = resolve(root);
  const projection = readJsonRef(repositoryRoot, { path: repositoryRelative(repositoryRoot, resolve(projectionPath)), sha256: digest(hashFile(resolve(projectionPath))) }) as ContractEvidenceProjection;
  const exactKeys = ["schema_version", "contract_id", "campaign_id", "campaign_sha256", "candidate", "org_fingerprint", "system_fingerprint", "case_id", "repetition_ids", "prepared_manifest", "qualification", "report", "archive_receipt", "archive_manifest", "github_evidence", "github_idempotence", "release_attestation"].sort();
  if (projection.schema_version !== 1 || Object.keys(projection).sort().join("\0") !== exactKeys.join("\0")) throw new Error("contract_evidence_invalid_root");
  if (projection.contract_id !== expected.contractId || projection.case_id !== expected.caseId) throw new Error("contract_evidence_mapping_mismatch");
  if (new Set(projection.repetition_ids).size !== projection.repetition_ids.length || canonicalJson(projection.repetition_ids) !== canonicalJson(expected.repetitionIds)) throw new Error("contract_evidence_repetition_mismatch");

  const campaignBytes = readFileRef(repositoryRoot, projection.prepared_manifest);
  const campaign = loadYamlBytes(campaignBytes);
  const campaignErrors = validateCampaign(campaign);
  if (campaignErrors.length > 0) throw new Error(`contract_evidence_invalid_campaign:${campaignErrors.join(";")}`);
  const manifest = campaign as CampaignManifest;
  const campaignSha256 = hashManifest(manifest);
  if (manifest.campaign_id !== projection.campaign_id || campaignSha256 !== projection.campaign_sha256 || canonicalJson(manifest.candidate) !== canonicalJson(projection.candidate) || manifest.org_fingerprint !== projection.org_fingerprint || manifest.system_fingerprint !== projection.system_fingerprint) throw new Error("contract_evidence_campaign_binding_mismatch");
  if (manifest.intent !== "qualification" || !manifest.candidate.release_package_sha256 || !manifest.candidate.executable_suite_sha256) throw new Error("contract_evidence_unqualified_candidate_identity");
  const declared = manifest.cases.find((item) => item.case_id === expected.caseId)?.repetition_ids ?? [];
  if (expected.repetitionIds.some((id) => !declared.includes(id))) throw new Error("contract_evidence_undeclared_repetition");

  const qualification = readJsonRef(repositoryRoot, projection.qualification) as Qualification;
  if (qualification.campaign_id !== manifest.campaign_id || qualification.campaign_sha256 !== campaignSha256 || qualification.outcome !== "qualified" || qualification.reasons.length !== 0) throw new Error("contract_evidence_qualifier_not_green");
  const bundleRoot = dirname(resolve(repositoryRoot, projection.prepared_manifest.path));
  const resultsRoot = join(bundleRoot, "results");
  const resultNames = existsSync(resultsRoot) ? readdirSync(resultsRoot).filter((name) => name.endsWith(".json")).sort() : [];
  const expectedNames = qualification.attempt_ids.map((id) => `${id}.json`).sort();
  if (canonicalJson(resultNames) !== canonicalJson(expectedNames)) throw new Error("contract_evidence_result_inventory_mismatch");
  const results = resultNames.map((name) => {
    const value = JSON.parse(readFileSync(join(resultsRoot, name), "utf8")) as AttemptResult;
    const errors = validateResult(value);
    if (errors.length > 0) throw new Error(`contract_evidence_malformed_result:${name}:${errors.join(";")}`);
    return value;
  });
  const pairPath = join(bundleRoot, "artifact", "learning-pairs.json");
  const governancePath = join(bundleRoot, "artifact", "learning-governance.json");
  if (existsSync(pairPath)) {
    const pair = JSON.parse(readFileSync(pairPath, "utf8")) as LearningPairEvidence;
    const errors = validateLearningPairEvidence(pair, manifest, campaignSha256);
    if (errors.length > 0) throw new Error(`contract_evidence_learning_pair_invalid:${errors.join(";")}`);
    verifyLearningPairFiles(bundleRoot, pair);
  }
  const recomputed = qualify(manifest, campaignSha256, results, {
    ...(existsSync(pairPath) ? { learning_pairs: { value: JSON.parse(readFileSync(pairPath, "utf8")) as Record<string, unknown>, sha256: digest(hashFile(pairPath)) } } : {}),
    ...(existsSync(governancePath) ? { learning_governance: { value: JSON.parse(readFileSync(governancePath, "utf8")) as Record<string, unknown>, sha256: digest(hashFile(governancePath)) } } : {}),
  });
  if (canonicalJson(recomputed) !== canonicalJson(qualification)) throw new Error("contract_evidence_qualification_mismatch");
  if (renderQualificationHtml(recomputed) !== readFileRef(repositoryRoot, projection.report).toString("utf8")) throw new Error("contract_evidence_report_mismatch");

  const archiveManifest = readJsonRef(repositoryRoot, projection.archive_manifest) as Record<string, unknown>;
  const archiveReceipt = readJsonRef(repositoryRoot, projection.archive_receipt) as Record<string, unknown>;
  if (archiveManifest.schema_version !== 2 || archiveManifest.archive_kind !== "sanitized-evidence" || archiveManifest.policy_version !== "sanitized-evidence/v3" || !Array.isArray(archiveManifest.excluded_roots) || !archiveManifest.excluded_roots.includes("provider-scratch/**") || !archiveManifest.excluded_roots.includes("state/runs/**") || archiveManifest.campaign_id !== manifest.campaign_id || archiveManifest.campaign_sha256 !== campaignSha256) throw new Error("contract_evidence_archive_manifest_mismatch");
  if (archiveReceipt.schema_version !== 2 || archiveReceipt.campaign_id !== manifest.campaign_id || archiveReceipt.campaign_sha256 !== campaignSha256 || archiveReceipt.archive_manifest_sha256 !== projection.archive_manifest.sha256) throw new Error("contract_evidence_archive_receipt_mismatch");
  const archivedFiles = archiveManifest.files;
  if (!archivedFiles || typeof archivedFiles !== "object" || Array.isArray(archivedFiles)) throw new Error("contract_evidence_archive_files_invalid");
  const archiveHashes = archivedFiles as Record<string, string>;
  for (const ref of [projection.prepared_manifest, projection.qualification, projection.report, projection.github_evidence, projection.github_idempotence]) verifyArchivedFile(repositoryRoot, bundleRoot, ref, archiveHashes);
  for (const supplementalPath of [pairPath, governancePath]) if (existsSync(supplementalPath)) verifyArchivedFile(repositoryRoot, bundleRoot, { path: repositoryRelative(repositoryRoot, supplementalPath), sha256: digest(hashFile(supplementalPath)) }, archiveHashes);
  for (const result of results) {
    const resultPath = join(resultsRoot, `${result.attempt_id}.json`);
    verifyArchivedFile(repositoryRoot, bundleRoot, { path: repositoryRelative(repositoryRoot, resultPath), sha256: digest(hashFile(resultPath)) }, archiveHashes);
    for (const evidenceRef of result.evidence) {
      const match = /^(artifact|grader|accounting):(.+)$/.exec(evidenceRef);
      if (!match) continue;
      const evidencePath = join(bundleRoot, match[2]!);
      verifyArchivedFile(repositoryRoot, bundleRoot, { path: repositoryRelative(repositoryRoot, evidencePath), sha256: digest(hashFile(evidencePath)) }, archiveHashes);
    }
  }

  const github = readJsonRef(repositoryRoot, projection.github_evidence) as Record<string, unknown>;
  const idempotence = readJsonRef(repositoryRoot, projection.github_idempotence) as Record<string, unknown>;
  if (github.campaign_id !== manifest.campaign_id || github.campaign_sha256 !== campaignSha256 || github.result !== "passed") throw new Error("contract_evidence_github_mismatch");
  if (idempotence.campaign_id !== manifest.campaign_id || idempotence.campaign_sha256 !== campaignSha256 || idempotence.result !== "passed" || idempotence.idempotent_rerun !== true || idempotence.reused_evidence !== true) throw new Error("contract_evidence_github_idempotence_mismatch");
  if (idempotence.source_evidence_sha256 !== projection.github_evidence.sha256) throw new Error("contract_evidence_github_source_mismatch");

  const selected = expected.repetitionIds.map((repetitionId) => {
    const matches = results.filter((result) => result.case_id === expected.caseId && result.repetition_id === repetitionId);
    if (matches.length !== 1) throw new Error(`contract_evidence_duplicate_or_missing_result:${repetitionId}`);
    const result = matches[0]!;
    if (result.outcome !== "passed" || result.missing.length > 0) throw new Error(`contract_evidence_result_not_passed:${repetitionId}`);
    verifyTerminalAccounting(result);
    verifyAccountingEvidence(repositoryRoot, bundleRoot, result, archiveHashes, campaignSha256);
    if (!result.case_id.startsWith("soak/")) verifyGraderEvidence(repositoryRoot, bundleRoot, result, archiveHashes, campaignSha256);
    return result;
  });
  if (new Set(selected.map((result) => result.attempt_id)).size !== selected.length) throw new Error("contract_evidence_duplicate_evidence");

  readFileRef(repositoryRoot, projection.release_attestation);
  const binding: VerifiedReleaseBinding = { campaign_id: manifest.campaign_id, campaign_sha256: campaignSha256, candidate: canonicalJson(manifest.candidate), org_fingerprint: manifest.org_fingerprint, system_fingerprint: manifest.system_fingerprint, attestation_path: projection.release_attestation.path, attestation_sha256: projection.release_attestation.sha256 };
  if (verifiedRelease === undefined) {
    verifyReleaseAttestation({ root: repositoryRoot, path: projection.release_attestation.path, campaign: manifest });
  } else if (canonicalJson(binding) !== canonicalJson(verifiedRelease)) {
    throw new Error("contract_evidence_set_release_binding_mismatch");
  }
  return { projection, binding };
}

function verifyGraderEvidence(root: string, bundleRoot: string, result: AttemptResult, archiveHashes: Record<string, string>, campaignSha256: string): void {
  const refs = result.evidence.filter((ref) => ref.startsWith("grader:"));
  if (refs.length !== 1) throw new Error(`contract_evidence_grader_reference_count:${result.attempt_id}`);
  const archiveRel = refs[0]!.slice("grader:".length);
  const path = join(bundleRoot, archiveRel);
  const ref = { path: repositoryRelative(root, path), sha256: digest(hashFile(path)) };
  verifyArchivedFile(root, bundleRoot, ref, archiveHashes);
  const grader = readJsonRef(root, ref) as Record<string, unknown>;
  if (grader.schema_version !== 2 || grader.campaign_sha256 !== campaignSha256 || grader.attempt_id !== result.attempt_id || grader.case_id !== result.case_id || grader.repetition_id !== result.repetition_id || grader.visible_gate_passed !== true || grader.hidden_grader_passed !== true || grader.result !== "passed" || !Array.isArray(grader.missing) || grader.missing.length !== 0) throw new Error(`contract_evidence_grader_failed:${result.attempt_id}`);
  if (/^(planning|context|continuation|approval|learning|roles)\//.test(result.case_id) && typeof grader.verifier_evidence !== "string") throw new Error(`contract_evidence_verifier_reference_missing:${result.attempt_id}`);
  if (typeof grader.verifier_evidence === "string") {
    if (!grader.verifier_evidence.startsWith("artifact:")) throw new Error(`contract_evidence_verifier_reference_invalid:${result.attempt_id}`);
    const verifierRel = grader.verifier_evidence.slice("artifact:".length);
    const verifierPath = join(bundleRoot, verifierRel);
    const verifierRef = { path: repositoryRelative(root, verifierPath), sha256: digest(hashFile(verifierPath)) };
    verifyArchivedFile(root, bundleRoot, verifierRef, archiveHashes);
    if (grader.verifier_evidence_sha256 !== verifierRef.sha256) throw new Error(`contract_evidence_verifier_hash_mismatch:${result.attempt_id}`);
  }
}

function verifyAccountingEvidence(root: string, bundleRoot: string, result: AttemptResult, archiveHashes: Record<string, string>, campaignSha256: string): void {
  const refs = result.evidence.filter((ref) => ref.startsWith("accounting:"));
  if (refs.length !== 1) throw new Error(`contract_evidence_accounting_reference_count:${result.attempt_id}`);
  const archiveRel = refs[0]!.slice("accounting:".length);
  const path = join(bundleRoot, archiveRel);
  const ref = { path: repositoryRelative(root, path), sha256: digest(hashFile(path)) };
  verifyArchivedFile(root, bundleRoot, ref, archiveHashes);
  const accounting = readJsonRef(root, ref) as Record<string, unknown>;
  const execution = result.metrics.execution as Record<string, unknown>;
  const route = result.metrics.route as Record<string, unknown>;
  if (accounting.schema_version !== 1 || !["attempt-accounting", "soak-accounting"].includes(String(accounting.evidence_kind)) || accounting.campaign_sha256 !== campaignSha256 || accounting.attempt_id !== result.attempt_id || accounting.case_id !== result.case_id || accounting.repetition_id !== result.repetition_id || accounting.passed !== true || !Array.isArray(accounting.missing) || accounting.missing.length !== 0 || accounting.provider_turns !== execution.provider_turns || accounting.provider_settlements !== execution.provider_settlements || accounting.mechanical_settlements !== 0 || accounting.terminal_integrity !== 1) throw new Error(`contract_evidence_accounting_failed:${result.attempt_id}`);
  if (!Array.isArray(accounting.provider_turn_ids ?? accounting.run_ids) || !Array.isArray(accounting.settlement_ids)) throw new Error(`contract_evidence_accounting_population_missing:${result.attempt_id}`);
  if (accounting.evidence_kind === "attempt-accounting") {
    const admitted = accounting.admitted_routes;
    if (!admitted || typeof admitted !== "object" || Array.isArray(admitted) || Object.keys(admitted as Record<string, unknown>).length !== execution.provider_turns || Object.values(admitted as Record<string, unknown>).some((value) => value !== route.planned || value !== route.final)) throw new Error(`contract_evidence_route_admission_mismatch:${result.attempt_id}`);
  }
}

function verifyTerminalAccounting(result: AttemptResult): void {
  const execution = result.metrics.execution as Record<string, unknown> | undefined;
  if (!execution || execution.terminal_integrity !== 1 || typeof execution.provider_turns !== "number" || execution.provider_turns <= 0 || execution.provider_turns !== execution.provider_settlements || execution.mechanical_settlements !== 0) throw new Error(`contract_evidence_settlement_mismatch:${result.attempt_id}`);
}

function verifyArchivedFile(root: string, bundleRoot: string, ref: FileRef, files: Record<string, string>): void {
  const path = resolve(root, ref.path);
  const archiveRel = relative(bundleRoot, path).replaceAll("\\", "/");
  if (archiveRel.startsWith("../") || isAbsolute(archiveRel) || files[archiveRel] !== ref.sha256) throw new Error(`contract_evidence_archive_file_mismatch:${ref.path}`);
  readFileRef(root, ref);
}

function readFileRef(root: string, ref: FileRef): Buffer {
  if (!ref || typeof ref.path !== "string" || typeof ref.sha256 !== "string") throw new Error("contract_evidence_invalid_file_ref");
  const path = resolve(root, ref.path);
  if (repositoryRelative(root, path) !== ref.path || !existsSync(path) || digest(hashFile(path)) !== ref.sha256) throw new Error(`contract_evidence_file_hash_mismatch:${ref.path}`);
  return readFileSync(path);
}

function readJsonRef(root: string, ref: FileRef): unknown {
  try { return JSON.parse(readFileRef(root, ref).toString("utf8")); }
  catch (error) { if (error instanceof SyntaxError) throw new Error(`contract_evidence_malformed_json:${ref.path}`); throw error; }
}

function loadYamlBytes(bytes: Buffer): unknown {
  return parseYaml(bytes.toString("utf8"));
}

function repositoryRelative(root: string, path: string): string {
  const rel = relative(resolve(root), resolve(path)).replaceAll("\\", "/");
  if (rel === "" || rel.startsWith("../") || isAbsolute(rel)) throw new Error("contract_evidence_path_escape");
  return rel;
}

function digest(value: string): string { return value.startsWith("sha256:") ? value : `sha256:${value}`; }
