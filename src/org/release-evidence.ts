// RQ-1 release qualification. This module is deliberately deterministic and
// provider-free: it binds existing L1/L2/L3/L4/L5 evidence to exact package
// bytes, preserves each lane's truth, and refuses stale or incomplete release
// claims. It does not authorize a campaign, tag, or publication.

import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { platform, arch } from "node:process";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import {
  validateValidationCampaignReport,
  type ValidationCampaignReportV1,
  type ValidationDecisionStatus,
} from "./validation-campaign.js";

const execFile = promisify(execFileCallback);

export const RELEASE_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const RELEASE_QUALIFICATION_CONTRACT = "RQ-1" as const;
export const RELEASE_EVIDENCE_INPUT_KINDS = [
  "policy", "dependency_lock", "prompts", "roles", "pipelines", "taste",
  "golden_sets", "assignments", "tools",
] as const;
export const RELEASE_DETERMINISTIC_CHECKS = [
  "pnpm-test", "pnpm-typecheck", "pnpm-build", "git-diff-check", "gitleaks",
  "smoke-onboarding", "package-dry-run", "package-install-smoke", "core-checks",
] as const;
export const RELEASE_L4_SITES = ["reviewer", "planner", "validation-designer"] as const;

const SHA256 = /^[a-f0-9]{64}$/;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export type ReleaseInputKind = typeof RELEASE_EVIDENCE_INPUT_KINDS[number];
export type DeterministicCheckId = typeof RELEASE_DETERMINISTIC_CHECKS[number];
export type ReleaseL4Site = typeof RELEASE_L4_SITES[number];
export type ReleaseLane = "deterministic" | "L3" | "L4" | "L5";
export type EvidenceCompleteness = "complete" | "incomplete";
export type EvidenceVerdict = "pass" | "fail" | "inconclusive";
export type ReleaseQualification = "qualified" | "not_qualified" | "needs_human_disposition";

export interface ReleasePackageFileV1 {
  path: string;
  size: number;
  sha256: string;
}

export interface ReleasePackageManifestV1 {
  name: string;
  version: string;
  filename: string;
  tarball_sha256: string;
  tarball_integrity: string;
  files: ReleasePackageFileV1[];
}

export interface ReleaseGoldenReferenceV1 {
  case_id: string;
  site: ReleaseL4Site;
  path: string;
  case_digest: string;
  reference_digest: string;
  human_validation: "validated";
  validated_by: string;
  validated_on: string;
  source_commit: string;
}

export interface ReleaseAssignmentV1 {
  assignment_id: string;
  role: string;
  source: "fixed" | "adaptive";
  runtime: string;
  model: string;
  efforts: string[];
}

export interface ReleaseToolchainV1 {
  node: string;
  pnpm: string;
  typescript: string;
  vitest: string;
  claude_agent_sdk: string;
  pi_coding_agent: string;
  openai_codex: string;
  platform: string;
  architecture: string;
}

export interface ReleaseL4PairingV1 {
  id: string;
  site: ReleaseL4Site;
  operation: string;
  arm: "bootstrap" | "candidate" | "baseline";
  producer_tuple: string;
  evaluator_tuple: string;
  rubric_version: string;
  rubric_digest: string;
  grader_digest: string;
  evaluator_status: "human_review" | "advisory_judge" | "admitted_judge";
  decision_rule_digest: string | null;
  case_ids: string[];
  attempt_ids: string[];
}

export interface ReleaseObligationV1 {
  id: string;
  lane: ReleaseLane;
  required: true;
  claim_class: "product" | "safety" | "accounting" | "learning" | "build" | "ci" | "budget" | "evaluator_evidence";
  debt_eligible: boolean;
  subject_digest: string;
  producer_digest: string;
}

export interface ReleaseTriggeredCampaignV1 {
  obligation_id: string;
  campaign_id: string;
  lane: "L3" | "L5";
  campaign_kind: string;
  trigger: string;
  apps: string[];
  scopes: string[];
  tuples: string[];
  required_case_ids: string[];
  max_provider_turns: number;
  max_equiv_usd: number;
  decision_status: ValidationDecisionStatus;
}

export interface ReleaseManifestBodyV1 {
  schema_version: typeof RELEASE_EVIDENCE_SCHEMA_VERSION;
  contract_id: typeof RELEASE_QUALIFICATION_CONTRACT;
  prepared_at: string;
  repository: string;
  candidate_commit: string;
  clean_tracked_tree: true;
  package: ReleasePackageManifestV1;
  inputs: Record<ReleaseInputKind, string>;
  assignments: ReleaseAssignmentV1[];
  toolchain: ReleaseToolchainV1;
  human_authorization: {
    authorized_by: string;
    authorized_at: string;
    purpose: string;
    approval_ref: string;
  };
  threat_model: {
    artifact_sha256: string;
    status_sha256: string;
    human_authored: true;
    human_reviewed: true;
    covered_surfaces: string[];
    abuse_case_ids: string[];
  };
  deterministic: {
    required_checks: DeterministicCheckId[];
    allowed_test_skips: string[];
    producer_digest: string;
  };
  l4: {
    mode: "bootstrap" | "comparison";
    sites: ReleaseL4Site[];
    references: ReleaseGoldenReferenceV1[];
    pairings: ReleaseL4PairingV1[];
  };
  triggered_campaigns: ReleaseTriggeredCampaignV1[];
  ceilings: {
    l3_premerge: { max_provider_turns: 2; max_equiv_usd: 5 };
    l3_release: { max_provider_turns: 24; max_equiv_usd: 100 };
    l4: { max_provider_turns: number; max_equiv_usd: number; max_tokens: number; authorization_ref: string };
    l5: { max_provider_turns: 24; max_equiv_usd: 15 };
  };
  retry_policy: {
    merit_failures: "never";
    github_total_attempts: 3;
    ambiguous_writes: "single_shot_then_reconcile";
    provider_retry: "predeclared_typed_infrastructure_only";
    unknown_partial_usage: "debit_full_reservation";
  };
  obligations: ReleaseObligationV1[];
}

export interface ReleaseManifestV1 extends ReleaseManifestBodyV1 {
  qualification_id: string;
}

export interface DeterministicCheckResultV1 {
  id: DeterministicCheckId;
  status: "pass" | "fail" | "missing" | "cancelled" | "neutral";
  candidate_commit: string;
  subject_digest: string;
  producer_digest: string;
  evidence_ref: string;
  skipped_case_ids: string[];
}

export interface DeterministicEvidenceV1 {
  schema_version: 1;
  qualification_id: string;
  checks: DeterministicCheckResultV1[];
}

export interface L4ReleaseObservationV1 {
  pairing_id: string;
  case_id: string;
  attempt_id: string;
  output_sha256: string;
  grading_key: string;
  grade_reused_from: string | null;
  automatic_score_used: boolean;
  outcome: "match" | "mismatch" | "unscored" | "invalid";
  evidence_ref: string;
}

export interface L4ReleaseEvidenceV1 {
  schema_version: 1;
  qualification_id: string;
  subject_digest: string;
  producer_digest: string;
  observations: L4ReleaseObservationV1[];
}

export interface ReleaseCampaignEvidenceV1 {
  schema_version: 1;
  qualification_id: string;
  campaigns: Array<{
    obligation_id: string;
    producer_digest: string;
    report: ValidationCampaignReportV1;
  }>;
}

export interface ReleaseLaneResultV1 {
  obligation_id: string;
  lane: ReleaseLane;
  claim_class: ReleaseObligationV1["claim_class"];
  debt_eligible: boolean;
  completeness: EvidenceCompleteness;
  verdict: EvidenceVerdict;
  decision_status: "ratified" | "proposed" | "not_applicable";
  subject_digest: string;
  producer_digest: string;
  evidence_ref: string;
  evidence_sha256: string;
  violation_ids: string[];
  reason_codes: string[];
}

export interface EvaluatorDebtDispositionV1 {
  debt_id: string;
  obligation_id: string;
  evidence_sha256: string;
  candidate_commit: string;
  consequence: string;
  owner: string;
  invalidation_trigger: string;
  accepted_by: string;
  accepted_at: string;
  decision: "accepted";
}

export interface EvidenceChangeDispositionV1 {
  disposition_id: string;
  obligation_id: string;
  candidate_commit: string;
  prior_producer_digest: string;
  current_producer_digest: string;
  decision: "unaffected" | "invalidated";
  defect_id: string;
  changed_files: Array<{ path: string; prior_sha256: string; current_sha256: string }>;
  detector_case_ids: string[];
  decided_by: string;
  decided_at: string;
}

export interface ReleaseQualificationReportV1 {
  schema_version: 1;
  contract_id: typeof RELEASE_QUALIFICATION_CONTRACT;
  qualification_id: string;
  candidate_commit: string;
  generated_at: string;
  lane_results: ReleaseLaneResultV1[];
  debt_dispositions: EvaluatorDebtDispositionV1[];
  evidence_change_dispositions: EvidenceChangeDispositionV1[];
  outcome: {
    completeness: EvidenceCompleteness;
    verdict: EvidenceVerdict;
    qualification: ReleaseQualification;
    blocker_ids: string[];
  };
}

export interface ReleaseActionV1 {
  kind: "npm_publish";
  package_name: string;
  version: string;
  tag: string;
  dist_tag: string;
  registry: string;
}

export interface ReleaseAttestationV1 {
  schema_version: 1;
  contract_id: typeof RELEASE_QUALIFICATION_CONTRACT;
  qualification_id: string;
  prepared_commit: string;
  release_commit: string;
  tag: string;
  package_name: string;
  package_version: string;
  tarball_sha256: string;
  tarball_integrity: string;
  qualification_report_sha256: string;
  qualification_dispositions_sha256: string;
  packet_files: Array<{ path: string; size: number; sha256: string }>;
  release_action: ReleaseActionV1;
  release_action_sha256: string;
  created_at: string;
}

export interface ReleaseApprovalV1 {
  schema_version: 1;
  contract_id: typeof RELEASE_QUALIFICATION_CONTRACT;
  decision: "approved";
  approved_by: string;
  approved_at: string;
  attestation_sha256: string;
  release_action_sha256: string;
}

export interface ReleaseTagEnvelopeV1 {
  schema_version: 1;
  contract_id: typeof RELEASE_QUALIFICATION_CONTRACT;
  attestation: ReleaseAttestationV1;
  approval: ReleaseApprovalV1;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function digestJson(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function createReleaseManifest(body: ReleaseManifestBodyV1): ReleaseManifestV1 {
  validateReleaseManifestBody(body);
  const qualificationId = digestJson(body);
  const manifest: ReleaseManifestV1 = { ...body, qualification_id: qualificationId };
  validateReleaseManifest(manifest);
  return manifest;
}

export function validateReleaseManifest(value: unknown): asserts value is ReleaseManifestV1 {
  const root = object(value, "release manifest");
  exact(root, [...MANIFEST_BODY_KEYS, "qualification_id"], "release manifest");
  const id = hash(root["qualification_id"], "qualification_id");
  const body = { ...root };
  delete body["qualification_id"];
  validateReleaseManifestBody(body);
  if (digestJson(body) !== id) throw new Error("release manifest qualification_id does not match canonical manifest bytes");
}

export function parseReleaseManifest(raw: string): ReleaseManifestV1 {
  const value: unknown = JSON.parse(raw);
  validateReleaseManifest(value);
  return value;
}

export async function packageManifestFromTarball(path: string): Promise<ReleasePackageManifestV1> {
  const compressed = await readFile(path);
  const bytes = gunzipSync(compressed);
  const files: ReleasePackageFileV1[] = [];
  let packageJson: { name?: unknown; version?: unknown } | undefined;
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const fullName = prefix.length > 0 ? `${prefix}/${name}` : name;
    const sizeText = tarString(header, 124, 12).replace(/\0.*$/, "").trim();
    const size = sizeText.length === 0 ? 0 : Number.parseInt(sizeText, 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`release tarball has invalid size for ${fullName}`);
    const type = String.fromCharCode(header[156] ?? 0);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > bytes.length) throw new Error(`release tarball truncates ${fullName}`);
    if (type === "2" || type === "1") throw new Error(`release tarball contains unsupported link entry ${fullName}`);
    if (type === "\0" || type === "0") {
      if (!fullName.startsWith("package/")) throw new Error(`release tarball entry escapes package/: ${fullName}`);
      const relativePath = safeRelativePath(fullName.slice("package/".length), "package file");
      const contents = bytes.subarray(contentStart, contentEnd);
      files.push({ path: relativePath, size, sha256: sha256(contents) });
      if (relativePath === "package.json") packageJson = JSON.parse(contents.toString("utf8")) as { name?: unknown; version?: unknown };
    }
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  if (files.length === 0 || new Set(files.map((item) => item.path)).size !== files.length) throw new Error("release tarball file manifest is empty or contains duplicate paths");
  const name = nonEmpty(packageJson?.name, "package.json name");
  const version = nonEmpty(packageJson?.version, "package.json version");
  const manifest: ReleasePackageManifestV1 = {
    name,
    version,
    filename: basename(path),
    tarball_sha256: sha256(compressed),
    tarball_integrity: `sha512-${createHash("sha512").update(compressed).digest("base64")}`,
    files,
  };
  validatePackage(manifest);
  return manifest;
}

export interface ReleaseRepositorySnapshotV1 {
  candidate_commit: string;
  inputs: Record<ReleaseInputKind, string>;
  assignments: ReleaseAssignmentV1[];
  toolchain: ReleaseToolchainV1;
  threat_model: ReleaseManifestBodyV1["threat_model"];
  golden_references: ReleaseGoldenReferenceV1[];
}

/** Recompute every repository-owned RQ-1 input from an exact commit. The path
 * set is deliberately closed and never traverses the archived corpus. Runtime
 * tool versions are validated separately because they describe the campaign
 * producer rather than candidate-source currency. */
export async function releaseRepositorySnapshot(repo: string, revision: string): Promise<ReleaseRepositorySnapshotV1> {
  commit(revision, "repository snapshot revision");
  const [policy, lock, prompts, rolesBytes, pipelines, taste, goldenSets, threatStatusBytes, validationRecordBytes] = await Promise.all([
    gitFile(repo, revision, "validation-design/validation-policy.yaml"),
    gitFile(repo, revision, "pnpm-lock.yaml"),
    gitTreeDigest(repo, revision, "prompts"),
    gitFile(repo, revision, "roles.yaml"),
    gitFile(repo, revision, "pipelines.yaml"),
    gitFile(repo, revision, "TASTE.md"),
    gitTreeDigest(repo, revision, "validation-design/golden-sets"),
    gitFile(repo, revision, "validation-design/threat-model-status.yaml"),
    gitFile(repo, revision, "validation-design/golden-sets/human-validation.json"),
  ]);
  const assignments = assignmentProjection(parseYaml(rolesBytes.toString("utf8")));
  const toolchain = await currentReleaseToolchain(repo);
  const threatModel = await threatModelProjection(repo, revision, threatStatusBytes);
  const goldenReferences = await goldenReferenceProjection(repo, revision, validationRecordBytes);
  return {
    candidate_commit: revision,
    inputs: {
      policy: sha256(policy),
      dependency_lock: sha256(lock),
      prompts,
      roles: sha256(rolesBytes),
      pipelines: sha256(pipelines),
      taste: sha256(taste),
      golden_sets: goldenSets,
      assignments: digestJson(assignments),
      tools: digestJson(toolchain),
    },
    assignments,
    toolchain,
    threat_model: threatModel,
    golden_references: goldenReferences,
  };
}

export async function validateReleaseRepositoryState(
  repo: string,
  manifest: ReleaseManifestBodyV1 | ReleaseManifestV1,
): Promise<void> {
  const snapshot = await releaseRepositorySnapshot(repo, manifest.candidate_commit);
  for (const kind of RELEASE_EVIDENCE_INPUT_KINDS) {
    if (kind !== "tools" && snapshot.inputs[kind] !== manifest.inputs[kind]) throw new Error(`release manifest repository input ${kind} is stale or caller-supplied`);
  }
  if (canonicalJson(snapshot.assignments) !== canonicalJson(manifest.assignments)) throw new Error("release manifest assignments differ from roles.yaml");
  if (canonicalJson(snapshot.threat_model) !== canonicalJson(manifest.threat_model)) throw new Error("release manifest threat-model status differs from the candidate commit");
  if (canonicalJson(snapshot.golden_references) !== canonicalJson(manifest.l4.references)) throw new Error("release manifest golden references are incomplete, stale, or not human validated");
}

export async function currentReleaseToolchain(repo: string): Promise<ReleaseToolchainV1> {
  const packageVersion = async (path: string): Promise<string> => {
    const value: unknown = JSON.parse(await readFile(join(repo, "node_modules", ...path.split("/"), "package.json"), "utf8"));
    return nonEmpty(object(value, `${path} package.json`)["version"], `${path} version`);
  };
  const pnpmResult = await execFile("pnpm", ["--version"], { cwd: repo, encoding: "utf8", maxBuffer: 1024 * 1024 });
  return {
    node: process.versions.node,
    pnpm: pnpmResult.stdout.trim(),
    typescript: await packageVersion("typescript"),
    vitest: await packageVersion("vitest"),
    claude_agent_sdk: await packageVersion("@anthropic-ai/claude-agent-sdk"),
    pi_coding_agent: await packageVersion("@earendil-works/pi-coding-agent"),
    openai_codex: await packageVersion("@openai/codex"),
    platform,
    architecture: arch,
  };
}

export async function validateReleaseToolchain(repo: string, manifest: ReleaseManifestBodyV1 | ReleaseManifestV1): Promise<void> {
  const current = await currentReleaseToolchain(repo);
  if (canonicalJson(current) !== canonicalJson(manifest.toolchain)) throw new Error("release manifest toolchain differs from the preparation environment");
}

export function evaluateDeterministicAdmission(
  manifest: ReleaseManifestV1,
  evidence: DeterministicEvidenceV1,
): ReleaseLaneResultV1 {
  validateReleaseManifest(manifest);
  validateDeterministicEvidence(evidence);
  const qualificationChanged = evidence.qualification_id !== manifest.qualification_id;
  const byId = new Map(evidence.checks.map((item) => [item.id, item]));
  const reasonCodes: string[] = [];
  const violationIds: string[] = [];
  let incomplete = false;
  const observedSubjects = new Set<string>();
  const observedProducers = new Set<string>();
  for (const id of manifest.deterministic.required_checks) {
    const check = byId.get(id);
    if (check === undefined) {
      incomplete = true;
      reasonCodes.push(`missing:${id}`);
      continue;
    }
    observedSubjects.add(check.subject_digest);
    observedProducers.add(check.producer_digest);
    if (check.candidate_commit !== manifest.candidate_commit || check.subject_digest !== releaseSubjectDigest(manifest)) {
      incomplete = true;
      reasonCodes.push(`stale_subject:${id}`);
    }
    if (check.producer_digest !== manifest.deterministic.producer_digest) reasonCodes.push(`prior_producer:${id}`);
    if (check.status === "fail") violationIds.push(`failed:${id}`);
    if (check.status === "missing" || check.status === "cancelled" || check.status === "neutral") {
      incomplete = true;
      reasonCodes.push(`${check.status}:${id}`);
    }
    const unlisted = check.skipped_case_ids.filter((skip) => !manifest.deterministic.allowed_test_skips.includes(skip));
    if (unlisted.length > 0) violationIds.push(...unlisted.map((skip) => `unlisted_skip:${skip}`));
    if (id !== "pnpm-test" && check.skipped_case_ids.length > 0) violationIds.push(`unexpected_skip_surface:${id}`);
  }
  const obligation = manifest.obligations.find((item) => item.lane === "deterministic");
  if (obligation === undefined) throw new Error("release manifest lacks deterministic obligation");
  if (qualificationChanged) reasonCodes.push("prior_qualification_id");
  if (observedSubjects.size > 1) {
    incomplete = true;
    reasonCodes.push("mixed_subject_digests");
  }
  if (observedProducers.size > 1) {
    incomplete = true;
    reasonCodes.push("mixed_producer_digests");
  }
  const resultVerdict: EvidenceVerdict = violationIds.length > 0 ? "fail" : incomplete ? "inconclusive" : "pass";
  return {
    obligation_id: obligation.id,
    lane: "deterministic",
    claim_class: obligation.claim_class,
    debt_eligible: obligation.debt_eligible,
    completeness: incomplete ? "incomplete" : "complete",
    verdict: resultVerdict,
    decision_status: "ratified",
    subject_digest: observedSubjects.size === 1 ? [...observedSubjects][0]! : digestJson([...observedSubjects].sort()),
    producer_digest: observedProducers.size === 1 ? [...observedProducers][0]! : digestJson([...observedProducers].sort()),
    evidence_ref: "deterministic-results.json",
    evidence_sha256: digestJson(evidence),
    violation_ids: uniqueSorted(violationIds),
    reason_codes: uniqueSorted(reasonCodes),
  };
}

export function compositeGradeKey(input: {
  output_sha256: string;
  case_digest: string;
  context_digest: string;
  rubric_digest: string;
  reference_digest: string;
  grader_digest: string;
}): string {
  for (const [name, value] of Object.entries(input)) hash(value, name);
  return digestJson(input);
}

export function evaluateL4Evidence(manifest: ReleaseManifestV1, evidence: L4ReleaseEvidenceV1): ReleaseLaneResultV1 {
  validateReleaseManifest(manifest);
  validateL4EvidenceShape(evidence);
  const qualificationChanged = evidence.qualification_id !== manifest.qualification_id;
  const references = new Map(manifest.l4.references.map((item) => [item.case_id, item]));
  const pairings = new Map(manifest.l4.pairings.map((item) => [item.id, item]));
  const expected: string[] = [];
  for (const pairing of manifest.l4.pairings) {
    for (const caseId of pairing.case_ids) for (const attemptId of pairing.attempt_ids) expected.push(observationId(pairing.id, caseId, attemptId));
  }
  const rows = new Map<string, L4ReleaseObservationV1>();
  const violations: string[] = [];
  const reasons: string[] = [];
  for (const row of evidence.observations) {
    const id = observationId(row.pairing_id, row.case_id, row.attempt_id);
    if (rows.has(id)) throw new Error(`duplicate L4 observation ${id}`);
    rows.set(id, row);
    const pairing = pairings.get(row.pairing_id);
    const reference = references.get(row.case_id);
    if (pairing === undefined || reference === undefined || !pairing.case_ids.includes(row.case_id) || !pairing.attempt_ids.includes(row.attempt_id)) {
      throw new Error(`undeclared L4 observation ${id}`);
    }
    const expectedKey = compositeGradeKey({
      output_sha256: row.output_sha256,
      case_digest: reference.case_digest,
      context_digest: digestJson({ case_digest: reference.case_digest, prompt_input_digest: manifest.inputs.prompts }),
      rubric_digest: pairing.rubric_digest,
      reference_digest: reference.reference_digest,
      grader_digest: pairing.grader_digest,
    });
    if (row.grading_key !== expectedKey) violations.push(`invalid_grading_key:${id}`);
    if (row.automatic_score_used && pairing.evaluator_status !== "admitted_judge") violations.push(`uncalibrated_judge_score:${id}`);
    if (pairing.evaluator_status === "admitted_judge" && pairing.decision_rule_digest === null) violations.push(`missing_judge_decision_rule:${pairing.id}`);
    if (row.outcome === "mismatch" || row.outcome === "unscored" || row.outcome === "invalid") reasons.push(`${row.outcome}:${id}`);
  }
  const missing = expected.filter((id) => !rows.has(id));
  reasons.push(...missing.map((id) => `missing:${id}`));
  const grouped = new Map<string, L4ReleaseObservationV1[]>();
  for (const row of evidence.observations) grouped.set(row.grading_key, [...(grouped.get(row.grading_key) ?? []), row]);
  for (const group of grouped.values()) {
    if (group.length < 2) {
      if (group[0]?.grade_reused_from !== null) violations.push(`orphan_grade_reuse:${observationKey(group[0]!)}`);
      continue;
    }
    const primary = group.filter((item) => item.grade_reused_from === null);
    if (primary.length !== 1) violations.push(`duplicate_grade_execution:${group[0]!.grading_key}`);
    const primaryId = primary.length === 1 ? observationKey(primary[0]!) : null;
    for (const row of group) if (row !== primary[0] && row.grade_reused_from !== primaryId) violations.push(`invalid_grade_reuse:${observationKey(row)}`);
  }
  const obligation = manifest.obligations.find((item) => item.lane === "L4");
  if (obligation === undefined) throw new Error("release manifest lacks L4 obligation");
  const incomplete = missing.length > 0;
  if (qualificationChanged) reasons.push("prior_qualification_id");
  return {
    obligation_id: obligation.id,
    lane: "L4",
    claim_class: obligation.claim_class,
    debt_eligible: obligation.debt_eligible,
    completeness: incomplete ? "incomplete" : "complete",
    verdict: violations.length > 0 ? "fail" : "inconclusive",
    decision_status: "proposed",
    subject_digest: evidence.subject_digest,
    producer_digest: evidence.producer_digest,
    evidence_ref: "l4-results.json",
    evidence_sha256: digestJson(evidence),
    violation_ids: uniqueSorted(violations),
    reason_codes: uniqueSorted(reasons.length > 0 ? reasons : ["no_ratified_l4_decision_rule"]),
  };
}

export function evaluateTriggeredCampaignEvidence(
  manifest: ReleaseManifestV1,
  evidence: ReleaseCampaignEvidenceV1,
): ReleaseLaneResultV1[] {
  validateReleaseManifest(manifest);
  const root = object(evidence, "release campaign evidence");
  exact(root, ["schema_version", "qualification_id", "campaigns"], "release campaign evidence");
  if (root["schema_version"] !== 1) throw new Error("unsupported release campaign evidence schema");
  const qualificationChanged = hash(root["qualification_id"], "campaign qualification_id") !== manifest.qualification_id;
  if (!Array.isArray(root["campaigns"])) throw new Error("release campaign evidence campaigns must be an array");
  const supplied = new Map<string, { obligation_id: string; producer_digest: string; report: ValidationCampaignReportV1 }>();
  for (const raw of root["campaigns"]) {
    const entry = object(raw, "release campaign evidence entry");
    exact(entry, ["obligation_id", "producer_digest", "report"], "release campaign evidence entry");
    const obligationId = identifier(entry["obligation_id"], "campaign evidence obligation_id");
    if (supplied.has(obligationId)) throw new Error(`duplicate triggered campaign evidence for ${obligationId}`);
    const producerDigest = hash(entry["producer_digest"], "campaign evidence producer_digest");
    validateValidationCampaignReport(entry["report"]);
    supplied.set(obligationId, { obligation_id: obligationId, producer_digest: producerDigest, report: entry["report"] });
  }
  const expectedIds = new Set(manifest.triggered_campaigns.map((item) => item.obligation_id));
  for (const id of supplied.keys()) if (!expectedIds.has(id)) throw new Error(`triggered campaign evidence names undeclared obligation ${id}`);
  return manifest.triggered_campaigns.map((declared) => {
    const obligation = manifest.obligations.find((item) => item.id === declared.obligation_id)!;
    const row = supplied.get(declared.obligation_id);
    if (row === undefined) {
      return {
        obligation_id: obligation.id,
        lane: obligation.lane,
        claim_class: obligation.claim_class,
        debt_eligible: obligation.debt_eligible,
        completeness: "incomplete",
        verdict: "inconclusive",
        decision_status: declared.decision_status,
        subject_digest: obligation.subject_digest,
        producer_digest: obligation.producer_digest,
        evidence_ref: `campaign:${declared.campaign_id}:missing`,
        evidence_sha256: digestJson({ qualification_id: manifest.qualification_id, campaign_id: declared.campaign_id, status: "missing" }),
        violation_ids: [],
        reason_codes: [`missing_campaign:${declared.campaign_id}`],
      } satisfies ReleaseLaneResultV1;
    }
    const report = row.report;
    const subjectMismatches: string[] = [];
    if (report.campaign_id !== declared.campaign_id) subjectMismatches.push("campaign_id");
    if (report.lane !== declared.lane) subjectMismatches.push("lane");
    if (report.campaign_kind !== declared.campaign_kind) subjectMismatches.push("campaign_kind");
    if (report.trigger !== declared.trigger) subjectMismatches.push("trigger");
    if (report.target.commit !== manifest.candidate_commit) subjectMismatches.push("candidate_commit");
    if (canonicalJson(report.target.apps) !== canonicalJson(declared.apps)) subjectMismatches.push("apps");
    if (canonicalJson(report.target.scopes) !== canonicalJson(declared.scopes)) subjectMismatches.push("scopes");
    if (canonicalJson(report.target.tuples) !== canonicalJson(declared.tuples)) subjectMismatches.push("tuples");
    if (canonicalJson(report.coverage.required_case_ids) !== canonicalJson(declared.required_case_ids)) subjectMismatches.push("required_case_ids");
    if (report.spend.max_provider_turns !== declared.max_provider_turns || report.spend.max_equiv_usd !== declared.max_equiv_usd) subjectMismatches.push("ceilings");
    if (report.outcome.decision_status !== declared.decision_status) subjectMismatches.push("decision_status");
    if (report.policy.sha256 !== manifest.inputs.policy) subjectMismatches.push("policy");
    const subjectCurrent = subjectMismatches.length === 0;
    const producerCurrent = row.producer_digest === obligation.producer_digest;
    return {
      obligation_id: obligation.id,
      lane: obligation.lane,
      claim_class: obligation.claim_class,
      debt_eligible: obligation.debt_eligible,
      completeness: subjectCurrent ? report.outcome.completeness : "incomplete",
      verdict: subjectCurrent ? report.outcome.verdict : "inconclusive",
      decision_status: report.outcome.decision_status,
      subject_digest: subjectCurrent ? obligation.subject_digest : digestJson({ stale_campaign: report.campaign_id, subjectMismatches }),
      producer_digest: row.producer_digest,
      evidence_ref: `campaign:${report.campaign_id}`,
      evidence_sha256: digestJson(report),
      violation_ids: subjectCurrent ? [...report.outcome.violation_ids] : [],
      reason_codes: subjectCurrent
        ? [
          ...report.outcome.reason_codes,
          ...(producerCurrent ? [] : ["prior_producer"]),
          ...(qualificationChanged ? ["prior_qualification_id"] : []),
        ]
        : subjectMismatches.map((field) => `campaign_identity_mismatch:${field}`),
    } satisfies ReleaseLaneResultV1;
  }).sort((left, right) => left.obligation_id.localeCompare(right.obligation_id));
}

export function assessReleaseQualification(input: {
  manifest: ReleaseManifestV1;
  laneResults: ReleaseLaneResultV1[];
  debtDispositions: EvaluatorDebtDispositionV1[];
  evidenceChangeDispositions?: EvidenceChangeDispositionV1[];
  generatedAt: string;
}): ReleaseQualificationReportV1 {
  validateReleaseManifest(input.manifest);
  instant(input.generatedAt, "generatedAt");
  for (const row of input.laneResults) validateLaneResult(row);
  for (const row of input.debtDispositions) validateDebt(row);
  const evidenceChanges = input.evidenceChangeDispositions ?? [];
  for (const row of evidenceChanges) validateEvidenceChangeDisposition(row);
  const obligationIds = new Set(input.manifest.obligations.map((item) => item.id));
  if (new Set(input.laneResults.map((item) => item.obligation_id)).size !== input.laneResults.length) throw new Error("release lane results contain duplicate obligation ids");
  if (input.laneResults.some((item) => !obligationIds.has(item.obligation_id))) throw new Error("release lane result names an undeclared obligation");
  const resultById = new Map(input.laneResults.map((item) => [item.obligation_id, item]));
  const debtByObligation = new Map(input.debtDispositions.map((item) => [item.obligation_id, item]));
  if (debtByObligation.size !== input.debtDispositions.length) throw new Error("multiple evaluator-debt dispositions target one obligation");
  const changeByObligation = new Map(evidenceChanges.map((item) => [item.obligation_id, item]));
  if (changeByObligation.size !== evidenceChanges.length) throw new Error("multiple evidence-change dispositions target one obligation");
  const blockers: string[] = [];
  let provenFailure = false;
  for (const obligation of input.manifest.obligations) {
    const result = resultById.get(obligation.id);
    if (result === undefined) {
      blockers.push(`missing_obligation:${obligation.id}`);
      continue;
    }
    if (result.lane !== obligation.lane || result.claim_class !== obligation.claim_class || result.debt_eligible !== obligation.debt_eligible) throw new Error(`release result metadata disagrees with obligation ${obligation.id}`);
    if (result.subject_digest !== obligation.subject_digest) blockers.push(`stale_subject:${obligation.id}`);
    const producerCurrent = result.producer_digest === obligation.producer_digest;
    const changeDisposition = changeByObligation.get(obligation.id);
    const producerUnaffected = !producerCurrent && eligibleEvidenceChange(
      obligation,
      result,
      changeDisposition,
      input.manifest.candidate_commit,
    );
    if (!producerCurrent && !producerUnaffected) {
      blockers.push(changeDisposition?.decision === "invalidated"
        ? `invalidated_evidence:${obligation.id}`
        : `stale_producer:${obligation.id}`);
    }
    if (result.verdict === "fail" || result.violation_ids.length > 0) {
      provenFailure = true;
      blockers.push(`failed:${obligation.id}`);
      continue;
    }
    if (result.completeness === "complete" && result.verdict === "pass") continue;
    const debt = debtByObligation.get(obligation.id);
    if (!eligibleDebt(obligation, result, debt, input.manifest.candidate_commit)) blockers.push(`undispositioned:${obligation.id}`);
  }
  for (const debt of input.debtDispositions) if (!obligationIds.has(debt.obligation_id)) throw new Error(`debt ${debt.debt_id} targets an undeclared obligation`);
  for (const disposition of evidenceChanges) {
    if (!obligationIds.has(disposition.obligation_id)) throw new Error(`evidence change ${disposition.disposition_id} targets an undeclared obligation`);
    const result = resultById.get(disposition.obligation_id);
    if (result === undefined || result.producer_digest === input.manifest.obligations.find((item) => item.id === disposition.obligation_id)!.producer_digest) {
      throw new Error(`evidence change ${disposition.disposition_id} does not target producer drift`);
    }
  }
  const qualification: ReleaseQualification = provenFailure ? "not_qualified" : blockers.length > 0 ? "needs_human_disposition" : "qualified";
  const complete = input.manifest.obligations.every((obligation) => {
    const result = resultById.get(obligation.id);
    return result !== undefined
      && result.completeness === "complete"
      && result.subject_digest === obligation.subject_digest
      && (result.producer_digest === obligation.producer_digest || eligibleEvidenceChange(
        obligation,
        result,
        changeByObligation.get(obligation.id),
        input.manifest.candidate_commit,
      ));
  });
  const report: ReleaseQualificationReportV1 = {
    schema_version: 1,
    contract_id: RELEASE_QUALIFICATION_CONTRACT,
    qualification_id: input.manifest.qualification_id,
    candidate_commit: input.manifest.candidate_commit,
    generated_at: input.generatedAt,
    lane_results: [...input.laneResults].sort((left, right) => left.obligation_id.localeCompare(right.obligation_id)),
    debt_dispositions: [...input.debtDispositions].sort((left, right) => left.debt_id.localeCompare(right.debt_id)),
    evidence_change_dispositions: [...evidenceChanges].sort((left, right) => left.disposition_id.localeCompare(right.disposition_id)),
    outcome: {
      completeness: complete ? "complete" : "incomplete",
      verdict: qualification === "qualified" ? "pass" : qualification === "not_qualified" ? "fail" : "inconclusive",
      qualification,
      blocker_ids: uniqueSorted(blockers),
    },
  };
  validateReleaseQualificationReport(report);
  return report;
}

/** Re-derive every lane result from the exact packet evidence. Reports are
 * summaries, never authorities: attestation and verification both call this
 * function before they accept a qualification claim. */
export function validateQualificationEvidenceBundle(input: {
  manifest: ReleaseManifestV1;
  report: ReleaseQualificationReportV1;
  deterministic: DeterministicEvidenceV1;
  l4: L4ReleaseEvidenceV1;
  campaigns: ReleaseCampaignEvidenceV1;
}): void {
  validateReleaseManifest(input.manifest);
  validateReleaseQualificationReport(input.report, input.manifest);
  const derived = [
    evaluateDeterministicAdmission(input.manifest, input.deterministic),
    ...evaluateTriggeredCampaignEvidence(input.manifest, input.campaigns),
    evaluateL4Evidence(input.manifest, input.l4),
  ].sort((left, right) => left.obligation_id.localeCompare(right.obligation_id));
  const reported = [...input.report.lane_results]
    .sort((left, right) => left.obligation_id.localeCompare(right.obligation_id));
  if (canonicalJson(derived) !== canonicalJson(reported)) {
    throw new Error("qualification report lane results do not derive from the packet evidence");
  }
}

export function validateReleaseQualificationReport(value: unknown, manifest?: ReleaseManifestV1): asserts value is ReleaseQualificationReportV1 {
  const root = object(value, "qualification report");
  exact(root, ["schema_version", "contract_id", "qualification_id", "candidate_commit", "generated_at", "lane_results", "debt_dispositions", "evidence_change_dispositions", "outcome"], "qualification report");
  if (root["schema_version"] !== 1 || root["contract_id"] !== RELEASE_QUALIFICATION_CONTRACT) throw new Error("unsupported qualification report contract");
  hash(root["qualification_id"], "qualification_id");
  commit(root["candidate_commit"], "candidate_commit");
  instant(root["generated_at"], "generated_at");
  if (!Array.isArray(root["lane_results"])) throw new Error("lane_results must be an array");
  for (const row of root["lane_results"]) validateLaneResult(row);
  if (!Array.isArray(root["debt_dispositions"])) throw new Error("debt_dispositions must be an array");
  for (const row of root["debt_dispositions"]) validateDebt(row);
  if (!Array.isArray(root["evidence_change_dispositions"])) throw new Error("evidence_change_dispositions must be an array");
  for (const row of root["evidence_change_dispositions"]) validateEvidenceChangeDisposition(row);
  const outcome = object(root["outcome"], "qualification outcome");
  exact(outcome, ["completeness", "verdict", "qualification", "blocker_ids"], "qualification outcome");
  const completeness = oneOf(outcome["completeness"], ["complete", "incomplete"], "outcome.completeness");
  const verdict = oneOf(outcome["verdict"], ["pass", "fail", "inconclusive"], "outcome.verdict");
  const qualification = oneOf(outcome["qualification"], ["qualified", "not_qualified", "needs_human_disposition"], "outcome.qualification");
  uniqueStrings(outcome["blocker_ids"], "outcome.blocker_ids");
  if (qualification === "qualified" && (verdict !== "pass" || completeness !== "complete" || (outcome["blocker_ids"] as unknown[]).length > 0)) throw new Error("qualified report must be complete/pass with no blockers");
  if (qualification === "not_qualified" && verdict !== "fail") throw new Error("not_qualified report must fail");
  if (qualification === "needs_human_disposition" && verdict !== "inconclusive") throw new Error("needs_human_disposition report must be inconclusive");
  if (manifest !== undefined) {
    validateReleaseManifest(manifest);
    if (root["qualification_id"] !== manifest.qualification_id || root["candidate_commit"] !== manifest.candidate_commit) throw new Error("qualification report is not bound to the manifest candidate");
    const recomputed = assessReleaseQualification({
      manifest,
      laneResults: root["lane_results"] as ReleaseLaneResultV1[],
      debtDispositions: root["debt_dispositions"] as EvaluatorDebtDispositionV1[],
      evidenceChangeDispositions: root["evidence_change_dispositions"] as EvidenceChangeDispositionV1[],
      generatedAt: root["generated_at"] as string,
    });
    if (canonicalJson(recomputed.outcome) !== canonicalJson(outcome)) throw new Error("qualification report outcome does not match its lane evidence");
  }
}

export function releaseSubjectDigest(manifest: ReleaseManifestBodyV1 | ReleaseManifestV1): string {
  const subjectInputs = Object.fromEntries(
    Object.entries(manifest.inputs).filter(([kind]) => kind !== "tools"),
  );
  const subjectL4 = {
    mode: manifest.l4.mode,
    sites: manifest.l4.sites,
    references: manifest.l4.references,
    pairings: manifest.l4.pairings.map((pairing) => ({
      id: pairing.id,
      site: pairing.site,
      operation: pairing.operation,
      arm: pairing.arm,
      producer_tuple: pairing.producer_tuple,
      rubric_version: pairing.rubric_version,
      rubric_digest: pairing.rubric_digest,
      evaluator_status: pairing.evaluator_status,
      decision_rule_digest: pairing.decision_rule_digest,
      case_ids: pairing.case_ids,
      attempt_ids: pairing.attempt_ids,
    })),
  };
  return digestJson({
    candidate_commit: manifest.candidate_commit,
    clean_tracked_tree: manifest.clean_tracked_tree,
    package: manifest.package,
    inputs: subjectInputs,
    assignments: manifest.assignments,
    threat_model: manifest.threat_model,
    l4: subjectL4,
    triggered_campaigns: manifest.triggered_campaigns,
  });
}

export function validateEvidenceOnlyChangedPaths(version: string, qualificationId: string, changedPaths: string[]): void {
  nonEmpty(version, "version");
  hash(qualificationId, "qualificationId");
  const prefix = `release-evidence/${version}/${qualificationId}/`;
  for (const raw of changedPaths) {
    const path = safeRelativePath(raw, "changed path");
    if (!path.startsWith(prefix) || path === prefix.slice(0, -1)) throw new Error(`release candidate changed path outside evidence namespace: ${path}`);
  }
}

export function validateReleaseCommitLineage(
  manifest: ReleaseManifestV1,
  attestation: ReleaseAttestationV1,
  changedPaths: string[],
): void {
  validateReleaseManifest(manifest);
  validateReleaseAttestation(attestation);
  validateEvidenceOnlyChangedPaths(manifest.package.version, manifest.qualification_id, changedPaths);
  const prefix = `release-evidence/${manifest.package.version}/${manifest.qualification_id}/`;
  const expected = attestation.packet_files.map((file) => `${prefix}${file.path}`).sort();
  if (canonicalJson([...changedPaths].sort()) !== canonicalJson(expected)) throw new Error("release descendant diff does not exactly equal the attested packet files");
}

export function createReleaseAttestation(input: {
  manifest: ReleaseManifestV1;
  report: ReleaseQualificationReportV1;
  releaseCommit: string;
  tag: string;
  changedPaths: string[];
  packetFiles: Array<{ path: string; size: number; sha256: string }>;
  releaseAction: ReleaseActionV1;
  createdAt: string;
}): ReleaseAttestationV1 {
  validateReleaseManifest(input.manifest);
  validateReleaseQualificationReport(input.report, input.manifest);
  if (input.report.outcome.qualification !== "qualified") throw new Error("release attestation requires a qualified report");
  commit(input.releaseCommit, "releaseCommit");
  nonEmpty(input.tag, "tag");
  instant(input.createdAt, "createdAt");
  validateReleaseAction(input.releaseAction);
  if (input.releaseAction.package_name !== input.manifest.package.name || input.releaseAction.version !== input.manifest.package.version || input.releaseAction.tag !== input.tag) throw new Error("release action does not match manifest package/tag");
  validateEvidenceOnlyChangedPaths(input.manifest.package.version, input.manifest.qualification_id, input.changedPaths);
  validatePacketFiles(input.packetFiles);
  const prefix = `release-evidence/${input.manifest.package.version}/${input.manifest.qualification_id}/`;
  const expectedChangedPaths = input.packetFiles.map((item) => `${prefix}${item.path}`).sort();
  if (canonicalJson([...input.changedPaths].sort()) !== canonicalJson(expectedChangedPaths)) throw new Error("release changed paths must exactly equal the attested packet files");
  const paths = new Set(input.packetFiles.map((item) => item.path));
  for (const required of [
    "release-manifest.json",
    "qualification-report.json",
    "deterministic-results.json",
    "l4-results.json",
    "campaign-index.json",
  ]) {
    if (!paths.has(required)) throw new Error(`attestation packet must include ${required}`);
  }
  const attestation: ReleaseAttestationV1 = {
    schema_version: 1,
    contract_id: RELEASE_QUALIFICATION_CONTRACT,
    qualification_id: input.manifest.qualification_id,
    prepared_commit: input.manifest.candidate_commit,
    release_commit: input.releaseCommit,
    tag: input.tag,
    package_name: input.manifest.package.name,
    package_version: input.manifest.package.version,
    tarball_sha256: input.manifest.package.tarball_sha256,
    tarball_integrity: input.manifest.package.tarball_integrity,
    qualification_report_sha256: digestJson(input.report),
    qualification_dispositions_sha256: digestJson({
      evaluator_debt: input.report.debt_dispositions,
      evidence_changes: input.report.evidence_change_dispositions,
    }),
    packet_files: [...input.packetFiles].sort((left, right) => left.path.localeCompare(right.path)),
    release_action: input.releaseAction,
    release_action_sha256: digestJson(input.releaseAction),
    created_at: input.createdAt,
  };
  validateReleaseAttestation(attestation);
  return attestation;
}

/** Build the exact post-merge attestation that the durable B-17 approval
 * queue will bind. The evidence packet is read from the immutable release
 * commit through git objects; its creation instant is the immutable merge
 * commit time so crash replay derives byte-identical approval identity. The attestation itself remains outside that
 * commit because including a document that names its own commit hash would
 * create an impossible self-reference. The later annotated tag carries this
 * attestation together with the separate human approval. */
export async function createReleaseAttestationFromCommit(input: {
  repo: string;
  releaseCommit: string;
  tag: string;
}): Promise<{ attestation: ReleaseAttestationV1; packetPath: string }> {
  commit(input.releaseCommit, "releaseCommit");
  const commitTimestamp = await git(input.repo, ["show", "-s", "--format=%cI", input.releaseCommit]);
  const createdAt = new Date(instant(commitTimestamp, "release commit timestamp")).toISOString();
  const version = input.tag.startsWith("v") ? input.tag.slice(1) : "";
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("RQ-1 handoff tag must be an exact v-prefixed package version");
  }
  const versionRoot = `release-evidence/${version}`;
  const rawPaths = await git(
    input.repo,
    ["ls-tree", "-r", "-z", "--name-only", input.releaseCommit, "--", versionRoot],
    false,
  );
  const trackedPaths = rawPaths.split("\0").filter(Boolean).sort();
  const manifestPaths = trackedPaths.filter((path) => path.endsWith("/release-manifest.json"));
  if (manifestPaths.length !== 1) {
    throw new Error(`RQ-1 release commit must contain exactly one ${versionRoot}/<qualification>/release-manifest.json`);
  }
  const packetPath = manifestPaths[0]!.slice(0, -"/release-manifest.json".length);
  const packetPaths = trackedPaths.filter((path) => path.startsWith(`${packetPath}/`));
  if (packetPaths.length !== trackedPaths.length) {
    throw new Error("RQ-1 release commit contains more than one evidence namespace for the package version");
  }
  const manifestValue: unknown = JSON.parse(
    (await gitFile(input.repo, input.releaseCommit, `${packetPath}/release-manifest.json`)).toString("utf8"),
  );
  validateReleaseManifest(manifestValue);
  const manifest = manifestValue;
  if (manifest.package.version !== version || packetPath !== `${versionRoot}/${manifest.qualification_id}`) {
    throw new Error("RQ-1 evidence namespace does not match the manifest version/qualification identity");
  }
  const reportValue: unknown = JSON.parse(
    (await gitFile(input.repo, input.releaseCommit, `${packetPath}/qualification-report.json`)).toString("utf8"),
  );
  validateReleaseQualificationReport(reportValue, manifest);
  const deterministicValue: unknown = JSON.parse(
    (await gitFile(input.repo, input.releaseCommit, `${packetPath}/deterministic-results.json`)).toString("utf8"),
  );
  const l4Value: unknown = JSON.parse(
    (await gitFile(input.repo, input.releaseCommit, `${packetPath}/l4-results.json`)).toString("utf8"),
  );
  const campaignsValue: unknown = JSON.parse(
    (await gitFile(input.repo, input.releaseCommit, `${packetPath}/campaign-index.json`)).toString("utf8"),
  );
  validateQualificationEvidenceBundle({
    manifest,
    report: reportValue,
    deterministic: deterministicValue as DeterministicEvidenceV1,
    l4: l4Value as L4ReleaseEvidenceV1,
    campaigns: campaignsValue as ReleaseCampaignEvidenceV1,
  });
  if (reportValue.outcome.qualification !== "qualified") {
    throw new Error("RQ-1 B-17 handoff requires a qualified evidence packet");
  }
  await validateReleaseRepositoryState(input.repo, manifest);
  await git(input.repo, ["merge-base", "--is-ancestor", manifest.candidate_commit, input.releaseCommit]);
  const changedPaths = (await git(
    input.repo,
    ["diff", "--name-only", "-z", `${manifest.candidate_commit}..${input.releaseCommit}`],
    false,
  )).split("\0").filter(Boolean);
  const packetFiles = await Promise.all(packetPaths.map(async (trackedPath) => {
    const path = trackedPath.slice(packetPath.length + 1);
    const bytes = await gitFile(input.repo, input.releaseCommit, trackedPath);
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    assertSanitizedEvidence(value, path);
    return { path, size: bytes.length, sha256: sha256(bytes) };
  }));
  packetFiles.sort((left, right) => left.path.localeCompare(right.path));
  const releaseAction: ReleaseActionV1 = {
    kind: "npm_publish",
    package_name: manifest.package.name,
    version,
    tag: input.tag,
    dist_tag: "latest",
    registry: "https://registry.npmjs.org",
  };
  const attestation = createReleaseAttestation({
    manifest,
    report: reportValue,
    releaseCommit: input.releaseCommit,
    tag: input.tag,
    changedPaths,
    packetFiles,
    releaseAction,
    createdAt,
  });
  validateReleaseCommitLineage(manifest, attestation, changedPaths);
  return { attestation, packetPath };
}

export function validateReleaseAttestation(value: unknown): asserts value is ReleaseAttestationV1 {
  const root = object(value, "release attestation");
  exact(root, ["schema_version", "contract_id", "qualification_id", "prepared_commit", "release_commit", "tag", "package_name", "package_version", "tarball_sha256", "tarball_integrity", "qualification_report_sha256", "qualification_dispositions_sha256", "packet_files", "release_action", "release_action_sha256", "created_at"], "release attestation");
  if (root["schema_version"] !== 1 || root["contract_id"] !== RELEASE_QUALIFICATION_CONTRACT) throw new Error("unsupported release attestation contract");
  hash(root["qualification_id"], "qualification_id");
  commit(root["prepared_commit"], "prepared_commit"); commit(root["release_commit"], "release_commit");
  nonEmpty(root["tag"], "tag"); nonEmpty(root["package_name"], "package_name"); nonEmpty(root["package_version"], "package_version");
  hash(root["tarball_sha256"], "tarball_sha256");
  if (typeof root["tarball_integrity"] !== "string" || !SHA512_INTEGRITY.test(root["tarball_integrity"])) throw new Error("tarball_integrity must be sha512 integrity");
  hash(root["qualification_report_sha256"], "qualification_report_sha256"); hash(root["qualification_dispositions_sha256"], "qualification_dispositions_sha256");
  if (!Array.isArray(root["packet_files"])) throw new Error("packet_files must be an array");
  validatePacketFiles(root["packet_files"] as Array<{ path: string; size: number; sha256: string }>);
  validateReleaseAction(root["release_action"]);
  if (root["release_action_sha256"] !== digestJson(root["release_action"])) throw new Error("release_action_sha256 mismatch");
  instant(root["created_at"], "created_at");
}

export function validateReleaseApproval(value: unknown): asserts value is ReleaseApprovalV1 {
  const root = object(value, "release approval");
  exact(root, ["schema_version", "contract_id", "decision", "approved_by", "approved_at", "attestation_sha256", "release_action_sha256"], "release approval");
  if (root["schema_version"] !== 1 || root["contract_id"] !== RELEASE_QUALIFICATION_CONTRACT || root["decision"] !== "approved") throw new Error("release approval is not an approved RQ-1 decision");
  nonEmpty(root["approved_by"], "approved_by"); instant(root["approved_at"], "approved_at");
  hash(root["attestation_sha256"], "attestation_sha256"); hash(root["release_action_sha256"], "release_action_sha256");
}

export function createReleaseTagMessage(attestation: ReleaseAttestationV1, approval: ReleaseApprovalV1): string {
  validateReleaseAttestation(attestation);
  validateReleaseApproval(approval);
  if (approval.attestation_sha256 !== digestJson(attestation) || approval.release_action_sha256 !== attestation.release_action_sha256) throw new Error("release approval is not bound to this attestation/action");
  const envelope: ReleaseTagEnvelopeV1 = {
    schema_version: 1,
    contract_id: RELEASE_QUALIFICATION_CONTRACT,
    attestation,
    approval,
  };
  return `release ${attestation.tag}\n\n-----BEGIN CORMIDIA RQ1-----\n${Buffer.from(canonicalJson(envelope)).toString("base64")}\n-----END CORMIDIA RQ1-----\n`;
}

export function parseReleaseTagMessage(message: string): ReleaseTagEnvelopeV1 {
  const match = message.match(/-----BEGIN CORMIDIA RQ1-----\n([A-Za-z0-9+/=]+)\n-----END CORMIDIA RQ1-----/);
  if (match === null) throw new Error("annotated release tag lacks one RQ-1 envelope");
  if (message.match(/-----BEGIN CORMIDIA RQ1-----/g)?.length !== 1) throw new Error("annotated release tag contains multiple RQ-1 envelopes");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(match[1]!, "base64").toString("utf8"));
  } catch {
    throw new Error("annotated release tag contains an invalid RQ-1 envelope");
  }
  const root = object(value, "release tag envelope");
  exact(root, ["schema_version", "contract_id", "attestation", "approval"], "release tag envelope");
  if (root["schema_version"] !== 1 || root["contract_id"] !== RELEASE_QUALIFICATION_CONTRACT) throw new Error("unsupported release tag envelope");
  validateReleaseAttestation(root["attestation"]);
  validateReleaseApproval(root["approval"]);
  if ((root["approval"] as ReleaseApprovalV1).attestation_sha256 !== digestJson(root["attestation"]) || (root["approval"] as ReleaseApprovalV1).release_action_sha256 !== (root["attestation"] as ReleaseAttestationV1).release_action_sha256) throw new Error("release tag approval is not bound to its attestation/action");
  return root as unknown as ReleaseTagEnvelopeV1;
}

export async function verifyReleasePacket(input: {
  packetDir: string;
  currentCommit: string;
  currentTag: string;
  currentPackage: ReleasePackageManifestV1;
  attestation?: ReleaseAttestationV1;
  approval?: ReleaseApprovalV1;
}): Promise<{ manifest: ReleaseManifestV1; report: ReleaseQualificationReportV1; attestation: ReleaseAttestationV1; approval: ReleaseApprovalV1 }> {
  commit(input.currentCommit, "currentCommit");
  nonEmpty(input.currentTag, "currentTag");
  validatePackage(input.currentPackage);
  const packetDir = resolve(input.packetDir);
  if ((input.attestation === undefined) !== (input.approval === undefined)) throw new Error("release packet requires both external attestation and approval or neither");
  const values = await Promise.all([
    readJson(join(packetDir, "release-manifest.json")),
    readJson(join(packetDir, "qualification-report.json")),
    input.attestation === undefined ? readJson(join(packetDir, "release-attestation.json")) : Promise.resolve(input.attestation),
    input.approval === undefined ? readJson(join(packetDir, "release-approval.json")) : Promise.resolve(input.approval),
  ]);
  const [manifestValue, reportValue, attestationValue, approvalValue] = values;
  validateReleaseManifest(manifestValue);
  validateReleaseQualificationReport(reportValue, manifestValue);
  validateReleaseAttestation(attestationValue);
  validateReleaseApproval(approvalValue);
  const manifest = manifestValue;
  const report = reportValue;
  const attestation = attestationValue;
  const approval = approvalValue;
  const [deterministicValue, l4Value, campaignsValue] = await Promise.all([
    readJson(join(packetDir, "deterministic-results.json")),
    readJson(join(packetDir, "l4-results.json")),
    readJson(join(packetDir, "campaign-index.json")),
  ]);
  validateQualificationEvidenceBundle({
    manifest,
    report,
    deterministic: deterministicValue as DeterministicEvidenceV1,
    l4: l4Value as L4ReleaseEvidenceV1,
    campaigns: campaignsValue as ReleaseCampaignEvidenceV1,
  });
  const expectedSuffix = join("release-evidence", manifest.package.version, manifest.qualification_id);
  if (!packetDir.endsWith(`${sep}${expectedSuffix}`) && packetDir !== resolve(expectedSuffix)) throw new Error("release packet path does not match version/qualification identity");
  if (attestation.qualification_id !== manifest.qualification_id || attestation.prepared_commit !== manifest.candidate_commit) throw new Error("release attestation is not bound to manifest");
  if (attestation.release_commit !== input.currentCommit || attestation.tag !== input.currentTag) throw new Error("release attestation is stale for current commit/tag");
  if (
    attestation.qualification_report_sha256 !== digestJson(report)
    || attestation.qualification_dispositions_sha256 !== digestJson({
      evaluator_debt: report.debt_dispositions,
      evidence_changes: report.evidence_change_dispositions,
    })
  ) throw new Error("release attestation qualification report hash mismatch");
  if (canonicalJson(input.currentPackage) !== canonicalJson(manifest.package)) throw new Error("release package bytes differ from qualified package");
  if (approval.attestation_sha256 !== digestJson(attestation) || approval.release_action_sha256 !== attestation.release_action_sha256) throw new Error("release approval is not bound to this attestation/action");
  const allowed = new Set([
    ...attestation.packet_files.map((item) => item.path),
    ...(input.attestation === undefined ? ["release-attestation.json", "release-approval.json"] : []),
  ]);
  const entries = await readdir(packetDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`release packet contains non-file entry ${entry.name}`);
    if (!allowed.has(entry.name)) throw new Error(`release packet contains unlisted file ${entry.name}`);
  }
  for (const file of attestation.packet_files) {
    const path = joinContained(packetDir, file.path);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`release packet file is not a regular file: ${file.path}`);
    const bytes = await readFile(path);
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new Error(`release packet hash mismatch: ${file.path}`);
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    assertSanitizedEvidence(parsed, file.path);
  }
  return { manifest, report, attestation, approval };
}

export function assertSanitizedEvidence(value: unknown, path = "evidence"): void {
  if (typeof value === "string") {
    if (value.length > 16_384) throw new Error(`${path} contains an oversized raw string`);
    return;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSanitizedEvidence(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") throw new Error(`${path} contains unsupported evidence value`);
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/^(raw_prompt|raw_output|secret|credential|provider_session|session_log|transcript)$/i.test(key)) throw new Error(`${path} contains prohibited raw evidence field ${key}`);
    assertSanitizedEvidence(item, `${path}.${key}`);
  }
}

const MANIFEST_BODY_KEYS = ["schema_version", "contract_id", "prepared_at", "repository", "candidate_commit", "clean_tracked_tree", "package", "inputs", "assignments", "toolchain", "human_authorization", "threat_model", "deterministic", "l4", "triggered_campaigns", "ceilings", "retry_policy", "obligations"] as const;

function validateReleaseManifestBody(value: unknown): asserts value is ReleaseManifestBodyV1 {
  const root = object(value, "release manifest body");
  exact(root, MANIFEST_BODY_KEYS, "release manifest body");
  if (root["schema_version"] !== 1 || root["contract_id"] !== RELEASE_QUALIFICATION_CONTRACT) throw new Error("unsupported release manifest contract");
  instant(root["prepared_at"], "prepared_at"); nonEmpty(root["repository"], "repository"); commit(root["candidate_commit"], "candidate_commit");
  if (root["clean_tracked_tree"] !== true) throw new Error("release manifest requires a clean tracked-tree assertion");
  validatePackage(root["package"]);
  const inputs = object(root["inputs"], "inputs");
  exact(inputs, RELEASE_EVIDENCE_INPUT_KINDS, "inputs");
  for (const kind of RELEASE_EVIDENCE_INPUT_KINDS) hash(inputs[kind], `inputs.${kind}`);
  validateAssignments(root["assignments"]);
  validateToolchain(root["toolchain"]);
  if (inputs["assignments"] !== digestJson(root["assignments"])) throw new Error("inputs.assignments does not bind the assignment inventory");
  if (inputs["tools"] !== digestJson(root["toolchain"])) throw new Error("inputs.tools does not bind the exact preparation toolchain");
  const authorization = object(root["human_authorization"], "human_authorization");
  exact(authorization, ["authorized_by", "authorized_at", "purpose", "approval_ref"], "human_authorization");
  nonEmpty(authorization["authorized_by"], "human_authorization.authorized_by"); instant(authorization["authorized_at"], "human_authorization.authorized_at"); nonEmpty(authorization["purpose"], "human_authorization.purpose"); nonEmpty(authorization["approval_ref"], "human_authorization.approval_ref");
  const threat = object(root["threat_model"], "threat_model");
  exact(threat, ["artifact_sha256", "status_sha256", "human_authored", "human_reviewed", "covered_surfaces", "abuse_case_ids"], "threat_model");
  hash(threat["artifact_sha256"], "threat_model.artifact_sha256"); hash(threat["status_sha256"], "threat_model.status_sha256");
  if (threat["human_authored"] !== true || threat["human_reviewed"] !== true) throw new Error("release manifest requires human-authored and human-reviewed threat model");
  const surfaces = uniqueStrings(threat["covered_surfaces"], "threat_model.covered_surfaces");
  if (canonicalJson([...surfaces].sort()) !== canonicalJson(Array.from({ length: 10 }, (_, index) => `TM-${String(index + 1).padStart(2, "0")}`))) throw new Error("threat model must cover TM-01 through TM-10");
  if (uniqueStrings(threat["abuse_case_ids"], "threat_model.abuse_case_ids").length === 0) throw new Error("release manifest requires HB-073 abuse case ids");
  const deterministic = object(root["deterministic"], "deterministic");
  exact(deterministic, ["required_checks", "allowed_test_skips", "producer_digest"], "deterministic");
  const checks = uniqueStrings(deterministic["required_checks"], "deterministic.required_checks");
  if (canonicalJson(checks) !== canonicalJson(RELEASE_DETERMINISTIC_CHECKS)) throw new Error("deterministic requirements must use the complete ordered RQ-1 set");
  uniqueStrings(deterministic["allowed_test_skips"], "deterministic.allowed_test_skips"); hash(deterministic["producer_digest"], "deterministic.producer_digest");
  validateL4(root["l4"]);
  validateTriggeredCampaigns(root["triggered_campaigns"]);
  validateCeilings(root["ceilings"]);
  const retry = object(root["retry_policy"], "retry_policy");
  exact(retry, ["merit_failures", "github_total_attempts", "ambiguous_writes", "provider_retry", "unknown_partial_usage"], "retry_policy");
  if (retry["merit_failures"] !== "never" || retry["github_total_attempts"] !== 3 || retry["ambiguous_writes"] !== "single_shot_then_reconcile" || retry["provider_retry"] !== "predeclared_typed_infrastructure_only" || retry["unknown_partial_usage"] !== "debit_full_reservation") throw new Error("release retry policy differs from RQ-1");
  if (!Array.isArray(root["obligations"]) || root["obligations"].length === 0) throw new Error("release manifest requires obligations");
  const obligations = root["obligations"] as unknown[];
  for (const item of obligations) validateObligation(item);
  if (new Set((obligations as ReleaseObligationV1[]).map((item) => item.id)).size !== obligations.length) throw new Error("release obligation ids must be unique");
  const subjectDigest = releaseSubjectDigest(root as unknown as ReleaseManifestBodyV1);
  if ((obligations as ReleaseObligationV1[]).some((item) => item.subject_digest !== subjectDigest)) throw new Error("every release obligation must bind the exact release subject digest");
  for (const lane of ["deterministic", "L3", "L4", "L5"] as const) if (!(obligations as ReleaseObligationV1[]).some((item) => item.lane === lane)) throw new Error(`release manifest requires a ${lane} obligation`);
  const triggered = root["triggered_campaigns"] as ReleaseTriggeredCampaignV1[];
  for (const obligation of obligations as ReleaseObligationV1[]) {
    const matching = triggered.filter((item) => item.obligation_id === obligation.id);
    if (obligation.lane === "L3" || obligation.lane === "L5") {
      if (matching.length !== 1 || matching[0]!.lane !== obligation.lane) {
        throw new Error(`release ${obligation.lane} obligation ${obligation.id} requires one exact triggered campaign`);
      }
    } else if (matching.length > 0) {
      throw new Error(`triggered campaign cannot target ${obligation.lane} obligation ${obligation.id}`);
    }
  }
}

function validateTriggeredCampaigns(value: unknown): asserts value is ReleaseTriggeredCampaignV1[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("release manifest requires triggered L3/L5 campaigns");
  const obligationIds: string[] = [];
  const campaignIds: string[] = [];
  for (const raw of value) {
    const item = object(raw, "release triggered campaign");
    exact(item, ["obligation_id", "campaign_id", "lane", "campaign_kind", "trigger", "apps", "scopes", "tuples", "required_case_ids", "max_provider_turns", "max_equiv_usd", "decision_status"], "release triggered campaign");
    obligationIds.push(identifier(item["obligation_id"], "triggered obligation_id"));
    campaignIds.push(identifier(item["campaign_id"], "triggered campaign_id"));
    const lane = oneOf(item["lane"], ["L3", "L5"], "triggered lane");
    const kind = nonEmpty(item["campaign_kind"], "triggered campaign_kind");
    nonEmpty(item["trigger"], "triggered trigger");
    if (uniqueStrings(item["apps"], "triggered apps").length === 0) throw new Error("triggered campaign requires at least one app");
    if (uniqueStrings(item["scopes"], "triggered scopes").length === 0) throw new Error("triggered campaign requires at least one scope");
    uniqueStrings(item["tuples"], "triggered tuples");
    if (uniqueStrings(item["required_case_ids"], "triggered required_case_ids").length === 0) throw new Error("triggered campaign requires a non-empty case inventory");
    const maxTurns = positiveInteger(item["max_provider_turns"], "triggered max_provider_turns");
    const maxUsd = positive(item["max_equiv_usd"], "triggered max_equiv_usd");
    oneOf(item["decision_status"], ["ratified", "proposed", "not_applicable"], "triggered decision_status");
    if (lane === "L3") {
      const ceiling = kind === "pre_merge_adapter" ? { turns: 2, usd: 5 } : { turns: 24, usd: 100 };
      if (maxTurns > ceiling.turns || maxUsd > ceiling.usd) throw new Error(`L3 ${kind} campaign exceeds its RQ-1 ceiling`);
    } else if (maxTurns > 24 || maxUsd > 15) {
      throw new Error("L5 campaign exceeds its RQ-1 ceiling");
    }
  }
  if (new Set(obligationIds).size !== obligationIds.length) throw new Error("triggered campaigns must target unique obligations");
  if (new Set(campaignIds).size !== campaignIds.length) throw new Error("triggered campaign ids must be unique");
}

function validatePackage(value: unknown): asserts value is ReleasePackageManifestV1 {
  const root = object(value, "package manifest");
  exact(root, ["name", "version", "filename", "tarball_sha256", "tarball_integrity", "files"], "package manifest");
  nonEmpty(root["name"], "package.name"); nonEmpty(root["version"], "package.version"); safeRelativePath(nonEmpty(root["filename"], "package.filename"), "package.filename");
  hash(root["tarball_sha256"], "package.tarball_sha256");
  if (typeof root["tarball_integrity"] !== "string" || !SHA512_INTEGRITY.test(root["tarball_integrity"])) throw new Error("package.tarball_integrity must be sha512 integrity");
  if (!Array.isArray(root["files"]) || root["files"].length === 0) throw new Error("package.files must be non-empty");
  const paths: string[] = [];
  for (const raw of root["files"]) {
    const file = object(raw, "package file"); exact(file, ["path", "size", "sha256"], "package file");
    paths.push(safeRelativePath(file["path"], "package file path")); nonNegativeInteger(file["size"], "package file size"); hash(file["sha256"], "package file sha256");
  }
  if (new Set(paths).size !== paths.length || canonicalJson(paths) !== canonicalJson([...paths].sort())) throw new Error("package files must be unique and sorted");
  if (!paths.includes("package.json")) throw new Error("package files must include package.json");
}

function validateAssignments(value: unknown): asserts value is ReleaseAssignmentV1[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("release assignments must be non-empty");
  const ids: string[] = [];
  for (const raw of value) {
    const item = object(raw, "release assignment");
    exact(item, ["assignment_id", "role", "source", "runtime", "model", "efforts"], "release assignment");
    ids.push(identifier(item["assignment_id"], "assignment_id"));
    identifier(item["role"], "assignment role");
    oneOf(item["source"], ["fixed", "adaptive"], "assignment source");
    nonEmpty(item["runtime"], "assignment runtime"); nonEmpty(item["model"], "assignment model");
    const efforts = uniqueStrings(item["efforts"], "assignment efforts");
    if (efforts.length === 0) throw new Error("assignment efforts must be non-empty");
  }
  if (new Set(ids).size !== ids.length || canonicalJson(ids) !== canonicalJson([...ids].sort())) throw new Error("release assignments must have unique sorted ids");
}

function validateToolchain(value: unknown): asserts value is ReleaseToolchainV1 {
  const root = object(value, "release toolchain");
  exact(root, ["node", "pnpm", "typescript", "vitest", "claude_agent_sdk", "pi_coding_agent", "openai_codex", "platform", "architecture"], "release toolchain");
  for (const key of ["node", "pnpm", "typescript", "vitest", "claude_agent_sdk", "pi_coding_agent", "openai_codex", "platform", "architecture"] as const) nonEmpty(root[key], `toolchain.${key}`);
}

function validateL4(value: unknown): void {
  const root = object(value, "l4"); exact(root, ["mode", "sites", "references", "pairings"], "l4");
  const mode = oneOf(root["mode"], ["bootstrap", "comparison"], "l4.mode");
  const sites = uniqueStrings(root["sites"], "l4.sites");
  if (canonicalJson(sites) !== canonicalJson(RELEASE_L4_SITES)) throw new Error("L4 sites must use the complete ordered current release scope");
  if (!Array.isArray(root["references"]) || root["references"].length === 0) throw new Error("L4 references must be non-empty");
  const referenceIds: string[] = [];
  for (const raw of root["references"]) {
    const item = object(raw, "L4 reference"); exact(item, ["case_id", "site", "path", "case_digest", "reference_digest", "human_validation", "validated_by", "validated_on", "source_commit"], "L4 reference");
    referenceIds.push(identifier(item["case_id"], "L4 case_id")); oneOf(item["site"], RELEASE_L4_SITES, "L4 reference site"); safeRelativePath(item["path"], "L4 reference path"); hash(item["case_digest"], "L4 case_digest"); hash(item["reference_digest"], "L4 reference_digest");
    if (item["human_validation"] !== "validated") throw new Error(`L4 reference ${item["case_id"] as string} is not human validated`);
    nonEmpty(item["validated_by"], "L4 validated_by"); date(item["validated_on"], "L4 validated_on"); commit(item["source_commit"], "L4 source_commit");
  }
  if (new Set(referenceIds).size !== referenceIds.length) throw new Error("L4 reference case ids must be unique");
  if (!Array.isArray(root["pairings"]) || root["pairings"].length === 0) throw new Error("L4 pairings must be non-empty");
  const pairingIds: string[] = [];
  for (const raw of root["pairings"]) {
    const item = object(raw, "L4 pairing"); exact(item, ["id", "site", "operation", "arm", "producer_tuple", "evaluator_tuple", "rubric_version", "rubric_digest", "grader_digest", "evaluator_status", "decision_rule_digest", "case_ids", "attempt_ids"], "L4 pairing");
    pairingIds.push(identifier(item["id"], "L4 pairing id")); const site = oneOf(item["site"], RELEASE_L4_SITES, "L4 pairing site"); nonEmpty(item["operation"], "L4 operation");
    const arm = oneOf(item["arm"], ["bootstrap", "candidate", "baseline"], "L4 arm");
    if (mode === "bootstrap" && arm !== "bootstrap") throw new Error("bootstrap L4 manifest may contain only bootstrap arms");
    if (mode === "comparison" && arm === "bootstrap") throw new Error("comparison L4 manifest cannot contain bootstrap arms");
    nonEmpty(item["producer_tuple"], "L4 producer_tuple"); nonEmpty(item["evaluator_tuple"], "L4 evaluator_tuple"); nonEmpty(item["rubric_version"], "L4 rubric_version"); hash(item["rubric_digest"], "L4 rubric_digest"); hash(item["grader_digest"], "L4 grader_digest");
    const evaluator = oneOf(item["evaluator_status"], ["human_review", "advisory_judge", "admitted_judge"], "L4 evaluator_status");
    if (evaluator === "admitted_judge") hash(item["decision_rule_digest"], "L4 decision_rule_digest");
    else if (item["decision_rule_digest"] !== null) throw new Error("non-admitted L4 evaluator cannot carry a decision rule");
    const cases = uniqueStrings(item["case_ids"], "L4 pairing case_ids");
    if (cases.length === 0 || cases.some((id) => !referenceIds.includes(id))) throw new Error("L4 pairing case_ids must reference admitted cases");
    const attempts = uniqueStrings(item["attempt_ids"], "L4 pairing attempt_ids"); if (attempts.length === 0) throw new Error("L4 pairing attempt_ids must be non-empty");
    const referenceSites = new Map((root["references"] as ReleaseGoldenReferenceV1[]).map((reference) => [reference.case_id, reference.site]));
    if (cases.some((id) => referenceSites.get(id) !== site)) throw new Error("L4 pairing cannot cross sites");
  }
  if (new Set(pairingIds).size !== pairingIds.length) throw new Error("L4 pairing ids must be unique");
  const coveredCases = new Set((root["pairings"] as ReleaseL4PairingV1[]).flatMap((item) => item.case_ids));
  if (coveredCases.size !== referenceIds.length || referenceIds.some((id) => !coveredCases.has(id))) throw new Error("L4 pairings must cover every admitted reference case");
  for (const site of RELEASE_L4_SITES) if (!(root["pairings"] as ReleaseL4PairingV1[]).some((item) => item.site === site)) throw new Error(`L4 manifest lacks ${site} pairing`);
  if (mode === "comparison") for (const site of RELEASE_L4_SITES) {
    const arms = new Set((root["pairings"] as ReleaseL4PairingV1[]).filter((item) => item.site === site).map((item) => item.arm));
    if (!arms.has("candidate") || !arms.has("baseline")) throw new Error(`comparison L4 site ${site} requires candidate and baseline arms`);
  }
}

function validateCeilings(value: unknown): void {
  const root = object(value, "ceilings"); exact(root, ["l3_premerge", "l3_release", "l4", "l5"], "ceilings");
  fixedCeiling(root["l3_premerge"], "l3_premerge", 2, 5); fixedCeiling(root["l3_release"], "l3_release", 24, 100); fixedCeiling(root["l5"], "l5", 24, 15);
  const l4 = object(root["l4"], "l4 ceiling"); exact(l4, ["max_provider_turns", "max_equiv_usd", "max_tokens", "authorization_ref"], "l4 ceiling");
  positiveInteger(l4["max_provider_turns"], "l4.max_provider_turns"); positive(l4["max_equiv_usd"], "l4.max_equiv_usd"); positiveInteger(l4["max_tokens"], "l4.max_tokens"); nonEmpty(l4["authorization_ref"], "l4.authorization_ref");
}

function fixedCeiling(value: unknown, name: string, turns: number, usd: number): void {
  const root = object(value, name); exact(root, ["max_provider_turns", "max_equiv_usd"], name);
  if (root["max_provider_turns"] !== turns || root["max_equiv_usd"] !== usd) throw new Error(`${name} ceiling differs from RQ-1`);
}

function validateObligation(value: unknown): asserts value is ReleaseObligationV1 {
  const root = object(value, "release obligation"); exact(root, ["id", "lane", "required", "claim_class", "debt_eligible", "subject_digest", "producer_digest"], "release obligation");
  identifier(root["id"], "obligation.id"); oneOf(root["lane"], ["deterministic", "L3", "L4", "L5"], "obligation.lane");
  if (root["required"] !== true) throw new Error("release obligations must be required");
  const claim = oneOf(root["claim_class"], ["product", "safety", "accounting", "learning", "build", "ci", "budget", "evaluator_evidence"], "obligation.claim_class");
  if (typeof root["debt_eligible"] !== "boolean") throw new Error("obligation.debt_eligible must be boolean");
  if (root["debt_eligible"] === true && claim !== "evaluator_evidence") throw new Error("only evaluator_evidence obligations may be debt eligible");
  hash(root["subject_digest"], "obligation.subject_digest"); hash(root["producer_digest"], "obligation.producer_digest");
}

function validateDeterministicEvidence(value: unknown): asserts value is DeterministicEvidenceV1 {
  const root = object(value, "deterministic evidence"); exact(root, ["schema_version", "qualification_id", "checks"], "deterministic evidence");
  if (root["schema_version"] !== 1) throw new Error("unsupported deterministic evidence schema"); hash(root["qualification_id"], "deterministic qualification_id");
  if (!Array.isArray(root["checks"])) throw new Error("deterministic checks must be an array");
  const ids: string[] = [];
  for (const raw of root["checks"]) {
    const item = object(raw, "deterministic check"); exact(item, ["id", "status", "candidate_commit", "subject_digest", "producer_digest", "evidence_ref", "skipped_case_ids"], "deterministic check");
    ids.push(oneOf(item["id"], RELEASE_DETERMINISTIC_CHECKS, "deterministic check id")); oneOf(item["status"], ["pass", "fail", "missing", "cancelled", "neutral"], "deterministic status"); commit(item["candidate_commit"], "deterministic candidate_commit"); hash(item["subject_digest"], "deterministic subject_digest"); hash(item["producer_digest"], "deterministic producer_digest"); nonEmpty(item["evidence_ref"], "deterministic evidence_ref"); uniqueStrings(item["skipped_case_ids"], "deterministic skipped_case_ids");
  }
  if (new Set(ids).size !== ids.length) throw new Error("deterministic check ids must be unique");
}

function validateL4EvidenceShape(value: unknown): asserts value is L4ReleaseEvidenceV1 {
  const root = object(value, "L4 release evidence"); exact(root, ["schema_version", "qualification_id", "subject_digest", "producer_digest", "observations"], "L4 release evidence");
  if (root["schema_version"] !== 1) throw new Error("unsupported L4 release evidence schema");
  hash(root["qualification_id"], "L4 qualification_id");
  hash(root["subject_digest"], "L4 subject_digest");
  hash(root["producer_digest"], "L4 producer_digest");
  if (!Array.isArray(root["observations"])) throw new Error("L4 observations must be an array");
  for (const raw of root["observations"]) {
    const item = object(raw, "L4 observation"); exact(item, ["pairing_id", "case_id", "attempt_id", "output_sha256", "grading_key", "grade_reused_from", "automatic_score_used", "outcome", "evidence_ref"], "L4 observation");
    identifier(item["pairing_id"], "L4 pairing_id"); identifier(item["case_id"], "L4 case_id"); identifier(item["attempt_id"], "L4 attempt_id"); hash(item["output_sha256"], "L4 output_sha256"); hash(item["grading_key"], "L4 grading_key");
    if (item["grade_reused_from"] !== null) nonEmpty(item["grade_reused_from"], "L4 grade_reused_from");
    if (typeof item["automatic_score_used"] !== "boolean") throw new Error("L4 automatic_score_used must be boolean");
    oneOf(item["outcome"], ["match", "mismatch", "unscored", "invalid"], "L4 outcome"); nonEmpty(item["evidence_ref"], "L4 evidence_ref");
  }
}

function validateLaneResult(value: unknown): asserts value is ReleaseLaneResultV1 {
  const root = object(value, "release lane result"); exact(root, ["obligation_id", "lane", "claim_class", "debt_eligible", "completeness", "verdict", "decision_status", "subject_digest", "producer_digest", "evidence_ref", "evidence_sha256", "violation_ids", "reason_codes"], "release lane result");
  identifier(root["obligation_id"], "lane obligation_id"); oneOf(root["lane"], ["deterministic", "L3", "L4", "L5"], "lane");
  oneOf(root["claim_class"], ["product", "safety", "accounting", "learning", "build", "ci", "budget", "evaluator_evidence"], "lane claim_class"); if (typeof root["debt_eligible"] !== "boolean") throw new Error("lane debt_eligible must be boolean");
  const completeness = oneOf(root["completeness"], ["complete", "incomplete"], "lane completeness"); const verdict = oneOf(root["verdict"], ["pass", "fail", "inconclusive"], "lane verdict"); const decision = oneOf(root["decision_status"], ["ratified", "proposed", "not_applicable"], "lane decision_status");
  hash(root["subject_digest"], "lane subject_digest"); hash(root["producer_digest"], "lane producer_digest"); nonEmpty(root["evidence_ref"], "lane evidence_ref"); hash(root["evidence_sha256"], "lane evidence_sha256"); const violations = uniqueStrings(root["violation_ids"], "lane violation_ids"); uniqueStrings(root["reason_codes"], "lane reason_codes");
  if (violations.length > 0 && verdict !== "fail") throw new Error("lane violations require fail verdict");
  if (completeness === "incomplete" && violations.length === 0 && verdict !== "inconclusive") throw new Error("incomplete lane without violation must be inconclusive");
  if (decision === "proposed" && violations.length === 0 && verdict !== "inconclusive") throw new Error("proposed lane rule cannot pass");
  if (verdict === "pass" && completeness !== "complete") throw new Error("lane pass requires complete evidence");
}

function validateDebt(value: unknown): asserts value is EvaluatorDebtDispositionV1 {
  const root = object(value, "evaluator debt"); exact(root, ["debt_id", "obligation_id", "evidence_sha256", "candidate_commit", "consequence", "owner", "invalidation_trigger", "accepted_by", "accepted_at", "decision"], "evaluator debt");
  identifier(root["debt_id"], "debt_id"); identifier(root["obligation_id"], "debt obligation_id"); hash(root["evidence_sha256"], "debt evidence_sha256"); commit(root["candidate_commit"], "debt candidate_commit"); nonEmpty(root["consequence"], "debt consequence"); nonEmpty(root["owner"], "debt owner"); nonEmpty(root["invalidation_trigger"], "debt invalidation_trigger"); nonEmpty(root["accepted_by"], "debt accepted_by"); instant(root["accepted_at"], "debt accepted_at"); if (root["decision"] !== "accepted") throw new Error("evaluator debt decision must be accepted");
}

function validateEvidenceChangeDisposition(value: unknown): asserts value is EvidenceChangeDispositionV1 {
  const root = object(value, "evidence change disposition");
  exact(root, ["disposition_id", "obligation_id", "candidate_commit", "prior_producer_digest", "current_producer_digest", "decision", "defect_id", "changed_files", "detector_case_ids", "decided_by", "decided_at"], "evidence change disposition");
  identifier(root["disposition_id"], "evidence change disposition_id");
  identifier(root["obligation_id"], "evidence change obligation_id");
  commit(root["candidate_commit"], "evidence change candidate_commit");
  const prior = hash(root["prior_producer_digest"], "prior_producer_digest");
  const current = hash(root["current_producer_digest"], "current_producer_digest");
  if (prior === current) throw new Error("evidence change disposition requires actual producer drift");
  oneOf(root["decision"], ["unaffected", "invalidated"], "evidence change decision");
  nonEmpty(root["defect_id"], "evidence change defect_id");
  if (!Array.isArray(root["changed_files"]) || root["changed_files"].length === 0) throw new Error("evidence change disposition requires an exact changed-file inventory");
  const paths: string[] = [];
  for (const raw of root["changed_files"]) {
    const item = object(raw, "evidence change file");
    exact(item, ["path", "prior_sha256", "current_sha256"], "evidence change file");
    const path = safeRelativePath(item["path"], "evidence change path");
    if (path === "archive-do-not-read" || path.startsWith("archive-do-not-read/")) throw new Error("evidence change disposition cannot reference the forbidden archive");
    paths.push(path);
    const before = hash(item["prior_sha256"], "evidence change prior_sha256");
    const after = hash(item["current_sha256"], "evidence change current_sha256");
    if (before === after) throw new Error("evidence change file must contain different hashes");
  }
  if (new Set(paths).size !== paths.length || canonicalJson(paths) !== canonicalJson([...paths].sort())) throw new Error("evidence change files must be unique and sorted");
  if (uniqueStrings(root["detector_case_ids"], "evidence change detector_case_ids").length === 0) throw new Error("evidence change disposition requires detector evidence");
  nonEmpty(root["decided_by"], "evidence change decided_by");
  instant(root["decided_at"], "evidence change decided_at");
}

function eligibleDebt(obligation: ReleaseObligationV1, result: ReleaseLaneResultV1, debt: EvaluatorDebtDispositionV1 | undefined, candidateCommit: string): boolean {
  return obligation.debt_eligible && obligation.claim_class === "evaluator_evidence" && result.completeness === "complete" && result.verdict === "inconclusive" && debt !== undefined && debt.evidence_sha256 === result.evidence_sha256 && debt.candidate_commit === candidateCommit;
}

function eligibleEvidenceChange(
  obligation: ReleaseObligationV1,
  result: ReleaseLaneResultV1,
  disposition: EvidenceChangeDispositionV1 | undefined,
  candidateCommit: string,
): boolean {
  return obligation.claim_class === "evaluator_evidence"
    && disposition !== undefined
    && disposition.decision === "unaffected"
    && disposition.obligation_id === obligation.id
    && disposition.candidate_commit === candidateCommit
    && disposition.prior_producer_digest === result.producer_digest
    && disposition.current_producer_digest === obligation.producer_digest;
}

function validateReleaseAction(value: unknown): asserts value is ReleaseActionV1 {
  const root = object(value, "release action"); exact(root, ["kind", "package_name", "version", "tag", "dist_tag", "registry"], "release action");
  if (root["kind"] !== "npm_publish") throw new Error("release action kind must be npm_publish");
  nonEmpty(root["package_name"], "release package_name");
  const version = nonEmpty(root["version"], "release version");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("release version must be an exact semver without v prefix");
  if (root["tag"] !== `v${version}`) throw new Error("release tag must exactly match the package version");
  if (root["dist_tag"] !== "latest" || root["registry"] !== "https://registry.npmjs.org") throw new Error("release action must match the supported latest/npmjs publication path");
}

function validatePacketFiles(files: Array<{ path: string; size: number; sha256: string }>): void {
  const paths: string[] = [];
  for (const raw of files) {
    const file = object(raw, "packet file"); exact(file, ["path", "size", "sha256"], "packet file");
    const path = safeRelativePath(file["path"], "packet file path");
    if (!/^(release-manifest|qualification-report|deterministic-results|l4-results|campaign-index|human-review|package-manifest)\.json$/.test(path)) throw new Error(`release packet path is not allowlisted: ${path}`);
    paths.push(path); nonNegativeInteger(file["size"], "packet file size"); hash(file["sha256"], "packet file sha256");
  }
  if (new Set(paths).size !== paths.length || canonicalJson(paths) !== canonicalJson([...paths].sort())) throw new Error("packet files must be unique and sorted");
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON rejects non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object") throw new Error("canonical JSON rejects unsupported values");
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item === undefined) throw new Error(`canonical JSON rejects undefined field ${key}`);
    out[key] = canonicalValue(item);
  }
  return out;
}

function assignmentProjection(value: unknown): ReleaseAssignmentV1[] {
  const root = object(value, "roles.yaml");
  const roles = object(root["roles"], "roles.yaml roles");
  const assignments: ReleaseAssignmentV1[] = [];
  for (const [role, raw] of Object.entries(roles)) {
    const config = object(raw, `role ${role}`);
    assignments.push({
      assignment_id: `${role}:fixed`,
      role,
      source: "fixed",
      runtime: nonEmpty(config["runtime"], `${role}.runtime`),
      model: nonEmpty(config["model"], `${role}.model`),
      efforts: [nonEmpty(config["effort"], `${role}.effort`)],
    });
    const adaptive = config["adaptive_assignments"];
    if (adaptive === undefined) continue;
    if (!Array.isArray(adaptive)) throw new Error(`${role}.adaptive_assignments must be an array`);
    for (const rawAssignment of adaptive) {
      const item = object(rawAssignment, `${role} adaptive assignment`);
      assignments.push({
        assignment_id: `${role}:adaptive:${identifier(item["id"], `${role} adaptive id`)}`,
        role,
        source: "adaptive",
        runtime: nonEmpty(item["harness"], `${role} adaptive harness`),
        model: nonEmpty(item["model"], `${role} adaptive model`),
        efforts: uniqueStrings(item["efforts"], `${role} adaptive efforts`),
      });
    }
  }
  assignments.sort((left, right) => left.assignment_id.localeCompare(right.assignment_id));
  validateAssignments(assignments);
  return assignments;
}

async function threatModelProjection(
  repo: string,
  revision: string,
  statusBytes: Buffer,
): Promise<ReleaseManifestBodyV1["threat_model"]> {
  const status = object(parseYaml(statusBytes.toString("utf8")), "threat-model status");
  if (status["status"] !== "ratified" || status["human_authored"] !== true || status["human_reviewed"] !== true || status["release_gating_acknowledged"] !== true) {
    throw new Error("release preparation blocked: threat model is not human-authored, human-reviewed, ratified, and acknowledged for release gating");
  }
  nonEmpty(status["author"], "threat-model author"); nonEmpty(status["reviewer"], "threat-model reviewer");
  if (status["author"] === status["reviewer"]) throw new Error("release preparation blocked: threat-model author and reviewer must be distinct");
  instant(status["authored_at"], "threat-model authored_at"); instant(status["reviewed_at"], "threat-model reviewed_at");
  const artifact = safeRelativePath(status["artifact"], "threat-model artifact");
  const artifactBytes = await gitFile(repo, revision, `validation-design/${artifact}`);
  const artifactSha = sha256(artifactBytes);
  if (status["artifact_sha256"] !== artifactSha) throw new Error("release preparation blocked: threat-model artifact digest is stale");
  const covered = uniqueStrings(status["covered_surfaces"], "threat-model covered surfaces");
  const abuseCases = uniqueStrings(status["abuse_case_ids"], "threat-model abuse cases");
  return {
    artifact_sha256: artifactSha,
    status_sha256: sha256(statusBytes),
    human_authored: true,
    human_reviewed: true,
    covered_surfaces: covered,
    abuse_case_ids: abuseCases,
  };
}

async function goldenReferenceProjection(
  repo: string,
  revision: string,
  recordBytes: Buffer,
): Promise<ReleaseGoldenReferenceV1[]> {
  const record = object(JSON.parse(recordBytes.toString("utf8")) as unknown, "golden human-validation record");
  exact(record, ["schema_version", "validation_kind", "validated_by", "validated_on", "source_commit", "human_statement", "recorded_by", "records"], "golden human-validation record");
  if (record["schema_version"] !== 1 || record["validation_kind"] !== "RQ-1-golden-reference-review") throw new Error("unsupported golden human-validation record");
  const validatedBy = nonEmpty(record["validated_by"], "golden validated_by");
  const validatedOn = date(record["validated_on"], "golden validated_on");
  const sourceCommit = commit(record["source_commit"], "golden source_commit");
  nonEmpty(record["human_statement"], "golden human_statement"); nonEmpty(record["recorded_by"], "golden recorded_by");
  if (!Array.isArray(record["records"]) || record["records"].length === 0) throw new Error("golden human-validation records must be non-empty");
  const ledger = new Map<string, { path: string; source_case_digest: string }>();
  for (const raw of record["records"]) {
    const item = object(raw, "golden human-validation row");
    exact(item, ["case_id", "path", "source_case_digest", "result"], "golden human-validation row");
    const caseId = identifier(item["case_id"], "golden validation case_id");
    const path = safeRelativePath(item["path"], "golden validation path");
    if (!/^validation-design\/golden-sets\/(reviewer|planner|validation-designer)\/cases\.json$/.test(path)) throw new Error(`golden validation path is outside current RQ-1 sites: ${path}`);
    if (item["result"] !== "confirm") throw new Error(`golden validation row ${caseId} is not confirmed`);
    if (ledger.has(caseId)) throw new Error(`duplicate golden validation row ${caseId}`);
    ledger.set(caseId, { path, source_case_digest: hash(item["source_case_digest"], "golden source_case_digest") });
  }
  const paths = [...new Set([...ledger.values()].map((item) => item.path))].sort();
  const references: ReleaseGoldenReferenceV1[] = [];
  for (const path of paths) {
    const [currentRows, sourceRows] = await Promise.all([
      gitJsonArray(repo, revision, path),
      gitJsonArray(repo, sourceCommit, path),
    ]);
    for (const current of currentRows) {
      const currentRoot = object(current, `golden case in ${path}`);
      const caseId = identifier(currentRoot["id"], "golden case id");
      const entry = ledger.get(caseId);
      if (entry === undefined || entry.path !== path) throw new Error(`golden case ${caseId} lacks an exact human-validation row`);
      const source = sourceRows.find((item) => object(item, "source golden case")["id"] === caseId);
      if (source === undefined || digestJson(source) !== entry.source_case_digest) throw new Error(`golden case ${caseId} source digest is stale`);
      const provenance = object(currentRoot["provenance"], `golden case ${caseId} provenance`);
      if (provenance["human_validation"] !== "validated" || provenance["validated_by"] !== validatedBy) throw new Error(`golden case ${caseId} is not attributed to the validating human`);
      const expected = object(currentRoot["expected"], `golden case ${caseId} expected`);
      const site = oneOf(currentRoot["site"], RELEASE_L4_SITES, `golden case ${caseId} site`);
      references.push({
        case_id: caseId,
        site,
        path,
        case_digest: digestJson(current),
        reference_digest: digestJson(expected),
        human_validation: "validated",
        validated_by: validatedBy,
        validated_on: validatedOn,
        source_commit: sourceCommit,
      });
      ledger.delete(caseId);
    }
  }
  if (ledger.size > 0) throw new Error(`golden validation record names missing cases: ${[...ledger.keys()].sort().join(", ")}`);
  return references.sort((left, right) => left.case_id.localeCompare(right.case_id));
}

async function gitJsonArray(repo: string, revision: string, path: string): Promise<unknown[]> {
  const value: unknown = JSON.parse((await gitFile(repo, revision, path)).toString("utf8"));
  if (!Array.isArray(value)) throw new Error(`${path} must contain a JSON array`);
  return value;
}

async function gitTreeDigest(repo: string, revision: string, prefix: string): Promise<string> {
  const result = await git(repo, ["ls-tree", "-r", "-z", "--name-only", revision, "--", prefix], false);
  const paths = result.split("\0").filter(Boolean).sort();
  if (paths.length === 0) throw new Error(`release input tree is empty: ${prefix}`);
  if (paths.some((path) => path === "archive-do-not-read" || path.startsWith("archive-do-not-read/"))) throw new Error("release input tree attempted to enter the forbidden archive");
  const rows = await Promise.all(paths.map(async (path) => ({ path, sha256: sha256(await gitFile(repo, revision, path)) })));
  return digestJson(rows);
}

async function gitFile(repo: string, revision: string, path: string): Promise<Buffer> {
  const safe = safeRelativePath(path, "release git path");
  if (safe === "archive-do-not-read" || safe.startsWith("archive-do-not-read/")) throw new Error("release input attempted to read the forbidden archive");
  try {
    const result = await execFile("git", ["-C", repo, "show", `${revision}:${safe}`], { encoding: "buffer", maxBuffer: 50 * 1024 * 1024 });
    return result.stdout;
  } catch (error) {
    throw new Error(`release candidate is missing tracked input ${safe}`, { cause: error });
  }
}

async function git(repo: string, args: string[], trim = true): Promise<string> {
  try {
    const result = await execFile("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    return trim ? result.stdout.trim() : result.stdout;
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String((error as { stderr?: unknown }).stderr) : "";
    throw new Error(`release git ${args[0] ?? "command"} failed${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
  }
}

function tarString(header: Uint8Array, start: number, length: number): string {
  return Buffer.from(header.subarray(start, start + length)).toString("utf8").replace(/\0.*$/, "");
}

function observationId(pairingId: string, caseId: string, attemptId: string): string { return `${pairingId}::${caseId}::${attemptId}`; }
function observationKey(row: L4ReleaseObservationV1): string { return observationId(row.pairing_id, row.case_id, row.attempt_id); }

async function readJson(path: string): Promise<unknown> { return JSON.parse(await readFile(path, "utf8")); }

function joinContained(root: string, path: string): string {
  const safe = safeRelativePath(path, "contained path");
  const target = resolve(root, safe);
  const rel = relative(resolve(root), target);
  if (rel.startsWith("..") || rel === "" || rel.includes(`${sep}..${sep}`)) throw new Error(`path escapes release packet: ${path}`);
  return target;
}

function safeRelativePath(value: unknown, name: string): string {
  const out = nonEmpty(value, name).replaceAll("\\", "/");
  if (out.startsWith("/") || out.split("/").some((part) => part === "" || part === "." || part === "..")) throw new Error(`${name} must be a contained relative path`);
  return out;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  const set = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !set.has(key));
  const missing = allowed.filter((key) => !(key in value));
  if (unknown.length > 0 || missing.length > 0) throw new Error(`${name} fields differ from closed schema (unknown: ${unknown.join(", ") || "none"}; missing: ${missing.join(", ") || "none"})`);
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be non-empty`);
  return value;
}

function identifier(value: unknown, name: string): string {
  const out = nonEmpty(value, name);
  if (!ID.test(out)) throw new Error(`${name} is not a valid stable identifier`);
  return out;
}

function hash(value: unknown, name: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${name} must be lowercase sha256`);
  return value;
}

function commit(value: unknown, name: string): string {
  if (typeof value !== "string" || !COMMIT.test(value)) throw new Error(`${name} must be an exact lowercase git oid`);
  return value;
}

function instant(value: unknown, name: string): string {
  const out = nonEmpty(value, name);
  if (!Number.isFinite(Date.parse(out))) throw new Error(`${name} must be an ISO-8601 instant`);
  return out;
}

function date(value: unknown, name: string): string {
  const out = nonEmpty(value, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out) || !Number.isFinite(Date.parse(`${out}T00:00:00.000Z`))) throw new Error(`${name} must be an ISO-8601 calendar date`);
  return out;
}

function oneOf<const T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${name} must be one of ${allowed.join(", ")}`);
  return value as T;
}

function uniqueStrings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) throw new Error(`${name} must be an array of non-empty strings`);
  if (new Set(value).size !== value.length) throw new Error(`${name} must not contain duplicates`);
  return value as string[];
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function positive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  const out = positive(value, name);
  if (!Number.isInteger(out)) throw new Error(`${name} must be an integer`);
  return out;
}

function uniqueSorted(values: string[]): string[] { return [...new Set(values)].sort(); }
