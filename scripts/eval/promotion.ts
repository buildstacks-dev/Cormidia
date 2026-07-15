import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { COPYFILE_EXCL } from "node:constants";
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
import { verifyContractEvidenceSet, type ContractEvidenceProjection } from "./contract-evidence.js";

interface FileRef { path: string; sha256: string }

interface ArchiveManifest {
  schema_version: 2;
  archive_kind: "sanitized-evidence";
  policy_version: "sanitized-evidence/v3";
  campaign_id: string;
  campaign_sha256: string;
  files: Record<string, string>;
  source_files: Record<string, string>;
  excluded_roots: string[];
}

interface ArchiveReceipt {
  schema_version: 2;
  archive_kind: "sanitized-evidence";
  policy_version: "sanitized-evidence/v3";
  campaign_id: string;
  campaign_sha256: string;
  destination: string;
  archive_manifest_sha256: string;
}

export const PHASE6_CONTRACT_MAPPINGS = [
  { contractId: "D-LIVE-01", caseId: "quick/ignore-config/v1", repetitionIds: ["clean-q1", "clean-q2", "clean-q3", "clean-q4", "clean-q5", "mixed-q1", "mixed-q2"] },
  { contractId: "D-LIVE-02", caseId: "standard/slug-options/v1", repetitionIds: ["mixed-s3", "mixed-s2", "mixed-s1"] },
  { contractId: "D-LIVE-03", caseId: "deep/auth-migration/v1", repetitionIds: ["mixed-d2", "mixed-d1"] },
  { contractId: "E-LIVE-01", caseId: "context/delta/v1", repetitionIds: ["claude-context-1", "claude-context-2", "codex-context-1", "codex-context-2", "pi-context-1", "pi-context-2"] },
  { contractId: "E-LIVE-02", caseId: "context/delta/v1", repetitionIds: ["claude-context-1", "claude-context-2", "codex-context-1", "codex-context-2", "pi-context-1", "pi-context-2"] },
  { contractId: "G-MET-01", caseId: "approval/semantics/v1", repetitionIds: ["mixed-da"] },
  { contractId: "I-ROLE-01", caseId: "roles/standing/v1", repetitionIds: ["sre-1"] },
  { contractId: "I-ROLE-02", caseId: "roles/standing/v1", repetitionIds: ["support-1"] },
  { contractId: "I-ROLE-03", caseId: "roles/standing/v1", repetitionIds: ["marketing-1"] },
  { contractId: "I-LIVE-01", caseId: "soak/realtime-48h/v1", repetitionIds: ["real-1"] },
] as const;

/** Import only the committed-safe projection slice from a verified external
 * schema-v2 archive. Raw worlds, state, provider scratch, prompts, outputs,
 * and session logs remain external. */
export function importSanitizedPromotionEvidence(options: {
  root: string;
  archiveRoot: string;
  receiptPath: string;
  destinationRoot?: string;
}): { destination: string; campaign_id: string; campaign_sha256: string; files: string[] } {
  const root = resolve(options.root);
  const archiveRoot = resolve(options.archiveRoot);
  const archiveManifestPath = join(archiveRoot, "archive-manifest.json");
  const archive = readJson(archiveManifestPath) as ArchiveManifest;
  const receipt = readJson(resolve(options.receiptPath)) as ArchiveReceipt;
  validateArchiveBinding(archiveRoot, archiveManifestPath, archive, receipt);
  const campaignPath = join(archiveRoot, "campaign.yaml");
  const campaign = parseYaml(readFileSync(campaignPath, "utf8")) as CampaignManifest;
  const campaignErrors = validateCampaign(campaign);
  if (campaignErrors.length > 0 || campaign.campaign_id !== archive.campaign_id || hashManifest(campaign) !== archive.campaign_sha256) throw new Error(`promotion_invalid_campaign:${campaignErrors.join(";")}`);
  const destination = resolve(options.destinationRoot ?? join(root, "research/evals/campaigns", campaign.campaign_id));
  if (existsSync(destination)) throw new Error("promotion_destination_exists");
  assertInside(root, destination);

  const selected = Object.keys(archive.files).filter(selectedPromotionFile).sort();
  for (const required of ["campaign.yaml"]) if (!selected.includes(required)) throw new Error(`promotion_archive_missing:${required}`);
  const qualificationRel = exactlyOne(selected.filter((path) => /^qualification[^/]*\.json$/.test(path)), "qualification");
  const reportRel = exactlyOne(selected.filter((path) => /^report[^/]*\.html$/.test(path)), "report");
  exactlyOne(selected.filter((path) => /^github-evidence-[a-f0-9]{8}\.json$/.test(path)), "github_evidence");
  exactlyOne(selected.filter((path) => /^github-idempotence-[a-f0-9]{8}\.json$/.test(path)), "github_idempotence");
  verifyQualificationArchive(archiveRoot, campaign, archive.campaign_sha256, qualificationRel, reportRel, selected, archive.files);

  mkdirSync(destination, { recursive: true, mode: 0o700 });
  try {
    for (const rel of selected) {
      const source = resolve(archiveRoot, rel);
      if (relative(archiveRoot, source).replaceAll("\\", "/") !== rel || isAbsolute(rel) || rel.startsWith("../")) throw new Error(`promotion_path_escape:${rel}`);
      const stat = lstatSync(source);
      if (!stat.isFile() || stat.isSymbolicLink() || digest(hashFile(source)) !== archive.files[rel]) throw new Error(`promotion_archive_file_mismatch:${rel}`);
      const target = join(destination, rel);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      copyFileSync(source, target, COPYFILE_EXCL);
    }
    copyFileSync(archiveManifestPath, join(destination, "archive-manifest.json"), COPYFILE_EXCL);
    copyFileSync(resolve(options.receiptPath), join(destination, "archive-receipt.json"), COPYFILE_EXCL);
    const importReceipt = {
      schema_version: 1,
      evidence_kind: "phase6-sanitized-promotion-import",
      campaign_id: campaign.campaign_id,
      campaign_sha256: archive.campaign_sha256,
      external_archive_destination: archiveRoot,
      archive_manifest_sha256: digest(hashFile(archiveManifestPath)),
      selected_files: Object.fromEntries(selected.map((rel) => [rel, archive.files[rel]])),
      excluded_classes: ["world/**", "state/**", "provider-scratch/**", "raw prompts", "raw outputs", "session logs"],
    };
    writeFileSync(join(destination, "promotion-import.json"), `${JSON.stringify(importReceipt, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    // An incomplete import is never accepted on rerun. Preserve it for
    // diagnosis; the caller must choose a fresh destination.
    throw error;
  }
  return { destination, campaign_id: campaign.campaign_id, campaign_sha256: archive.campaign_sha256, files: selected };
}

export function writeContractEvidenceProjections(options: {
  root: string;
  campaignPath: string;
  attestationPath: string;
}): { campaign_id: string; contracts: string[] } {
  const root = resolve(options.root);
  const campaignPath = resolve(options.campaignPath);
  const bundleRoot = dirname(campaignPath);
  const campaign = parseYaml(readFileSync(campaignPath, "utf8")) as CampaignManifest;
  const errors = validateCampaign(campaign);
  if (errors.length > 0) throw new Error(`promotion_invalid_campaign:${errors.join(";")}`);
  const campaignSha256 = hashManifest(campaign);
  const qualificationPath = exactlyOnePath(bundleRoot, /^qualification[^/]*\.json$/, "qualification");
  const reportPath = exactlyOnePath(bundleRoot, /^report[^/]*\.html$/, "report");
  const archiveReceiptPath = join(bundleRoot, "archive-receipt.json");
  const archiveManifestPath = join(bundleRoot, "archive-manifest.json");
  const githubPath = exactlyOnePath(bundleRoot, /^github-evidence-[a-f0-9]{8}\.json$/, "github_evidence");
  const idempotencePath = exactlyOnePath(bundleRoot, /^github-idempotence-[a-f0-9]{8}\.json$/, "github_idempotence");
  const qualification = readJson(qualificationPath) as Qualification;
  if (qualification.outcome !== "qualified" || qualification.campaign_sha256 !== campaignSha256) throw new Error("promotion_qualification_not_green");
  const mappings = PHASE6_CONTRACT_MAPPINGS.filter((mapping) => campaign.cases.some((item) => item.case_id === mapping.caseId));
  if (mappings.length === 0) throw new Error("promotion_campaign_has_no_phase6_contract_mapping");

  const written: string[] = [];
  const projectionEntries: Array<{ projectionPath: string; expected: { contractId: string; caseId: string; repetitionIds: string[] } }> = [];
  for (const mapping of mappings) {
    const projection: ContractEvidenceProjection = {
      schema_version: 1,
      contract_id: mapping.contractId,
      campaign_id: campaign.campaign_id,
      campaign_sha256: campaignSha256,
      candidate: campaign.candidate,
      org_fingerprint: campaign.org_fingerprint,
      system_fingerprint: campaign.system_fingerprint,
      case_id: mapping.caseId,
      repetition_ids: [...mapping.repetitionIds],
      prepared_manifest: ref(root, campaignPath),
      qualification: ref(root, qualificationPath),
      report: ref(root, reportPath),
      archive_receipt: ref(root, archiveReceiptPath),
      archive_manifest: ref(root, archiveManifestPath),
      github_evidence: ref(root, githubPath),
      github_idempotence: ref(root, idempotencePath),
      release_attestation: ref(root, resolve(options.attestationPath)),
    };
    const out = join(root, "research/evals/contracts", `${mapping.contractId}.json`);
    mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
    writeFileSync(out, `${JSON.stringify(projection, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    projectionEntries.push({ projectionPath: out, expected: { contractId: mapping.contractId, caseId: mapping.caseId, repetitionIds: [...mapping.repetitionIds] } });
    written.push(mapping.contractId);
  }
  verifyContractEvidenceSet(root, projectionEntries);
  return { campaign_id: campaign.campaign_id, contracts: written };
}

function verifyQualificationArchive(archiveRoot: string, campaign: CampaignManifest, campaignSha256: string, qualificationRel: string, reportRel: string, selected: string[], hashes: Record<string, string>): void {
  const resultRels = selected.filter((path) => path.startsWith("results/") && path.endsWith(".json"));
  const results = resultRels.map((rel) => {
    const path = join(archiveRoot, rel);
    if (digest(hashFile(path)) !== hashes[rel]) throw new Error(`promotion_archive_file_mismatch:${rel}`);
    const result = readJson(path) as AttemptResult;
    const errors = validateResult(result);
    if (errors.length > 0) throw new Error(`promotion_invalid_result:${rel}:${errors.join(";")}`);
    verifyArchivedResultEvidence(archiveRoot, result, hashes);
    return result;
  });
  const qualification = readJson(join(archiveRoot, qualificationRel)) as Qualification;
  const pairPath = join(archiveRoot, "artifact", "learning-pairs.json");
  const governancePath = join(archiveRoot, "artifact", "learning-governance.json");
  if (existsSync(pairPath)) {
    const pair = readJson(pairPath) as LearningPairEvidence;
    const errors = validateLearningPairEvidence(pair, campaign, campaignSha256);
    if (errors.length > 0) throw new Error(`promotion_learning_pair_invalid:${errors.join(";")}`);
    verifyLearningPairFiles(archiveRoot, pair);
  }
  const recomputed = qualify(campaign, campaignSha256, results, {
    ...(existsSync(pairPath) ? { learning_pairs: { value: readJson(pairPath) as Record<string, unknown>, sha256: digest(hashFile(pairPath)) } } : {}),
    ...(existsSync(governancePath) ? { learning_governance: { value: readJson(governancePath) as Record<string, unknown>, sha256: digest(hashFile(governancePath)) } } : {}),
  });
  if (qualification.outcome !== "qualified" || canonicalJson(qualification) !== canonicalJson(recomputed)) throw new Error("promotion_qualification_mismatch");
  if (readFileSync(join(archiveRoot, reportRel), "utf8") !== renderQualificationHtml(recomputed)) throw new Error("promotion_report_mismatch");
}

function validateArchiveBinding(archiveRoot: string, manifestPath: string, manifest: ArchiveManifest, receipt: ArchiveReceipt): void {
  if (manifest.schema_version !== 2 || manifest.archive_kind !== "sanitized-evidence" || manifest.policy_version !== "sanitized-evidence/v3" || !manifest.files || !manifest.source_files || !Array.isArray(manifest.excluded_roots) || !manifest.excluded_roots.includes("provider-scratch/**") || !manifest.excluded_roots.includes("state/runs/**")) throw new Error("promotion_invalid_archive_manifest");
  if (receipt.schema_version !== 2 || receipt.archive_kind !== "sanitized-evidence" || receipt.policy_version !== "sanitized-evidence/v3" || receipt.campaign_id !== manifest.campaign_id || receipt.campaign_sha256 !== manifest.campaign_sha256 || resolve(receipt.destination) !== archiveRoot || receipt.archive_manifest_sha256 !== digest(hashFile(manifestPath))) throw new Error("promotion_archive_receipt_mismatch");
}

function selectedPromotionFile(path: string): boolean {
  if (path === "campaign.yaml" || /^qualification[^/]*\.json$/.test(path) || /^report[^/]*\.html$/.test(path) || /^github-(?:evidence|idempotence)-[a-f0-9]{8}\.json$/.test(path)) return true;
  if (/^(results|grader|accounting)\/[a-zA-Z0-9._/-]+\.json$/.test(path)) return true;
  if (/^artifact\/[a-zA-Z0-9._/-]+\.json$/.test(path)) return true;
  if (/^soak\/state\.json$/.test(path)) return true;
  return false;
}

function verifyArchivedResultEvidence(archiveRoot: string, result: AttemptResult, hashes: Record<string, string>): void {
  const fileRefs = result.evidence.flatMap((ref) => {
    const match = /^(artifact|grader|accounting):(.+)$/.exec(ref);
    return match ? [{ kind: match[1]!, rel: match[2]! }] : [];
  });
  for (const { rel } of fileRefs) {
    if (!selectedPromotionFile(rel) || hashes[rel] === undefined) throw new Error(`promotion_result_evidence_not_archived:${result.attempt_id}:${rel}`);
    const path = join(archiveRoot, rel);
    if (!existsSync(path) || digest(hashFile(path)) !== hashes[rel]) throw new Error(`promotion_result_evidence_hash_mismatch:${result.attempt_id}:${rel}`);
  }
  const execution = result.metrics.execution as Record<string, unknown> | undefined;
  const providerTurns = typeof execution?.provider_turns === "number" ? execution.provider_turns : 0;
  if (providerTurns > 0 || result.case_id === "soak/realtime-48h/v1") {
    const accountingRef = fileRefs.filter((ref) => ref.kind === "accounting");
    if (accountingRef.length !== 1) throw new Error(`promotion_accounting_reference_count:${result.attempt_id}`);
    const accounting = readJson(join(archiveRoot, accountingRef[0]!.rel)) as Record<string, unknown>;
    if (accounting.campaign_sha256 !== result.campaign_sha256 || accounting.attempt_id !== result.attempt_id || accounting.case_id !== result.case_id || accounting.repetition_id !== result.repetition_id || accounting.provider_turns !== execution?.provider_turns || accounting.provider_settlements !== execution?.provider_settlements || accounting.mechanical_settlements !== 0 || accounting.terminal_integrity !== 1 || accounting.passed !== true || !Array.isArray(accounting.missing) || accounting.missing.length !== 0) throw new Error(`promotion_accounting_mismatch:${result.attempt_id}`);
    const route = result.metrics.route as Record<string, unknown>;
    if (accounting.evidence_kind === "attempt-accounting" && (!accounting.admitted_routes || typeof accounting.admitted_routes !== "object" || Array.isArray(accounting.admitted_routes) || Object.keys(accounting.admitted_routes as Record<string, unknown>).length !== execution?.provider_turns || Object.values(accounting.admitted_routes as Record<string, unknown>).some((value) => value !== route.planned || value !== route.final))) throw new Error(`promotion_route_admission_mismatch:${result.attempt_id}`);
  }
  if (providerTurns > 0 && !result.case_id.startsWith("adapter/") && !result.case_id.startsWith("soak/realtime-")) {
    const graderRef = fileRefs.filter((ref) => ref.kind === "grader");
    if (graderRef.length !== 1) throw new Error(`promotion_grader_reference_count:${result.attempt_id}`);
    const grader = readJson(join(archiveRoot, graderRef[0]!.rel)) as Record<string, unknown>;
    if (result.outcome === "passed" && (grader.schema_version !== 2 || grader.campaign_sha256 !== result.campaign_sha256 || grader.attempt_id !== result.attempt_id || grader.case_id !== result.case_id || grader.repetition_id !== result.repetition_id || grader.visible_gate_passed !== true || grader.hidden_grader_passed !== true || grader.result !== "passed" || !Array.isArray(grader.missing) || grader.missing.length !== 0)) throw new Error(`promotion_grader_mismatch:${result.attempt_id}`);
    if (/^(planning|context|continuation|approval|learning|roles)\//.test(result.case_id) && typeof grader.verifier_evidence !== "string") throw new Error(`promotion_verifier_evidence_missing:${result.attempt_id}`);
    if (typeof grader.verifier_evidence === "string") {
      const verifierRef = grader.verifier_evidence.replace(/^artifact:/, "");
      if (!fileRefs.some((ref) => ref.kind === "artifact" && ref.rel === verifierRef) || grader.verifier_evidence_sha256 !== hashes[verifierRef]) throw new Error(`promotion_verifier_evidence_mismatch:${result.attempt_id}`);
    }
  }
}

function exactlyOne(values: string[], label: string): string {
  if (values.length !== 1) throw new Error(`promotion_requires_exactly_one_${label}:${values.length}`);
  return values[0]!;
}

function exactlyOnePath(root: string, pattern: RegExp, label: string): string {
  return join(root, exactlyOne(readdirSync(root).filter((name) => pattern.test(name)).sort(), label));
}

function ref(root: string, path: string): FileRef { return { path: repositoryRelative(root, path), sha256: digest(hashFile(path)) }; }
function readJson(path: string): unknown { return JSON.parse(readFileSync(path, "utf8")); }
function digest(value: string): string { return value.startsWith("sha256:") ? value : `sha256:${value}`; }
function assertInside(root: string, path: string): void { repositoryRelative(root, path); }
function repositoryRelative(root: string, path: string): string { const rel = relative(resolve(root), resolve(path)).replaceAll("\\", "/"); if (rel === "" || rel.startsWith("../") || isAbsolute(rel)) throw new Error("promotion_path_escape"); return rel; }
