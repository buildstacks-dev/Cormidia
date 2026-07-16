import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  canonicalJson,
  hashFile,
  hashManifest,
  loadYamlFile,
  sha256,
  validateCampaign,
  type CampaignManifest,
} from "./core.js";
import {
  executableSuiteHash,
  hashWorkingFiles,
  releasePackageHash,
} from "./candidate-hash.js";

const ATTESTATION_PATH = "research/evals/phase6-release-attestation.json";
const EVALUATOR_REPAIR_AUTHORIZATION_PATH = "research/evals/phase6-evaluator-repair-authorization.json";
const ALLOWED_PROPORTIONATE_REPAIR_PATHS = new Set([
  ".github/workflows/efficiency-qualification.yml",
  "scripts/eval/release-attestation.ts",
  "test/transformation/release-gate.test.ts",
  "test/transformation/qualification-scope.test.ts",
]);
const ALLOWED_PROMOTION_PATHS = new Set([
  "AGENTS.md",
  "eval/contracts.yaml",
  "docs/efficiency.md",
  "docs/benchmark-runbook.md",
  "docs/testing-journey.md",
  "docs/capability-matrix.md",
  "docs/efficiency-transformation/highly-efficient-organization-transformation.md",
  "docs/efficiency-transformation/highly-efficient-organization-test-eval-transformation.md",
  EVALUATOR_REPAIR_AUTHORIZATION_PATH,
]);
const PHASE6_CONTRACT_IDS = new Set([
  "D-LIVE-01",
  "D-LIVE-02",
  "D-LIVE-03",
  "E-LIVE-01",
  "E-LIVE-02",
  "G-MET-01",
  "I-ROLE-01",
  "I-ROLE-02",
  "I-ROLE-03",
  "I-LIVE-01",
]);

export interface ReleaseAttestation {
  schema_version: 1;
  evidence_kind: "phase6-evidence-only-release-equivalence";
  candidate: CampaignManifest["candidate"];
  org_fingerprint: string;
  system_fingerprint: string;
  campaigns: Array<{ campaign_id: string; campaign_sha256: string }>;
  release_package_sha256: string;
  executable_suite_sha256: string;
  proportionate_evaluator_repairs?: ProportionateEvaluatorRepairs;
  promotion_files: Record<string, string>;
  promotion_paths_sha256: string;
}

interface EvaluatorRepairAuthorization {
  schema_version: 1;
  evidence_kind: "phase6-proportionate-evaluator-repair-authorization";
  authorization_id: string;
  campaign_id: string;
  campaign_sha256: string;
  candidate_commit: string;
  qualified_executable_suite_sha256: string;
  release_executable_suite_sha256: string;
  release_package_sha256: string;
  material_impact: "evaluator_only";
  repair_files: Record<string, string>;
  rationale: string;
}

interface ProportionateEvaluatorRepairs {
  authorization: { path: string; sha256: string };
  qualified_executable_suite_sha256: string;
  release_executable_suite_sha256: string;
  files: Record<string, string>;
}

/** Build a content-bound receipt while evidence promotion files are present in
 * the working tree. Product/package bytes stay exact. A post-qualification
 * evaluator-only repair is accepted only through the separately hashed,
 * exact-path authorization and is represented explicitly in the receipt. */
export function createReleaseAttestation(options: {
  root: string;
  campaignPaths: string[];
  outPath?: string;
}): ReleaseAttestation {
  const root = resolve(options.root);
  const outPath = resolve(root, options.outPath ?? ATTESTATION_PATH);
  const campaigns = options.campaignPaths.map((path) => loadCampaign(resolve(path)));
  if (campaigns.length === 0) throw new Error("release_attestation_requires_campaigns");
  const first = campaigns[0]!;
  for (const campaign of campaigns.slice(1)) {
    if (canonicalJson(campaign.candidate) !== canonicalJson(first.candidate) || campaign.org_fingerprint !== first.org_fingerprint || campaign.system_fingerprint !== first.system_fingerprint) {
      throw new Error("release_attestation_candidate_mismatch");
    }
  }
  const releaseHash = digest(releasePackageHash(root));
  const suiteHash = digest(executableSuiteHash(root));
  if (first.candidate.release_package_sha256 !== releaseHash) throw new Error("release_package_bytes_changed_after_qualification");
  const evaluatorRepairs = resolveEvaluatorRepairs(root, first, releaseHash, suiteHash);
  if (first.org_fingerprint !== digest(hashWorkingFiles(root, ["roles.yaml", "pipelines.yaml", "prompts/", "TASTE.md", "taste/"]))) throw new Error("org_bytes_changed_after_qualification");

  const outRel = repositoryRelative(root, outPath);
  const changed = changedPaths(root, first.candidate.commit).filter((path) => path !== outRel && !contractProjectionPath(path));
  const evaluatorRepairPaths = new Set(Object.keys(evaluatorRepairs?.files ?? {}));
  for (const path of changed) if (!allowedPromotionPath(path) && !evaluatorRepairPaths.has(path)) throw new Error(`release_attestation_unallowlisted_path:${path}`);
  const promotionFiles = Object.fromEntries(changed.map((path) => {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) throw new Error(`release_attestation_deletion_forbidden:${path}`);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`release_attestation_special_file_forbidden:${path}`);
    return [path, digest(hashFile(absolute))];
  }));
  return {
    schema_version: 1,
    evidence_kind: "phase6-evidence-only-release-equivalence",
    candidate: first.candidate,
    org_fingerprint: first.org_fingerprint,
    system_fingerprint: first.system_fingerprint,
    campaigns: campaigns.map((campaign) => ({ campaign_id: campaign.campaign_id, campaign_sha256: hashManifest(campaign) })).sort((a, b) => a.campaign_id.localeCompare(b.campaign_id)),
    release_package_sha256: releaseHash,
    executable_suite_sha256: first.candidate.executable_suite_sha256!,
    ...(evaluatorRepairs ? { proportionate_evaluator_repairs: evaluatorRepairs } : {}),
    promotion_files: promotionFiles,
    promotion_paths_sha256: digest(sha256(canonicalJson(promotionFiles))),
  };
}

export function writeReleaseAttestation(options: { root: string; campaignPaths: string[]; outPath?: string }): ReleaseAttestation {
  const out = resolve(options.root, options.outPath ?? ATTESTATION_PATH);
  const attestation = createReleaseAttestation(options);
  const payload = `${JSON.stringify(attestation, null, 2)}\n`;
  if (existsSync(out)) {
    if (readFileSync(out, "utf8") !== payload) throw new Error("release_attestation_conflict");
  } else {
    mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
    writeFileSync(out, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }
  return attestation;
}

export function verifyReleaseAttestation(options: {
  root: string;
  path: string;
  campaign: CampaignManifest;
}): ReleaseAttestation {
  const root = resolve(options.root);
  const path = resolve(root, options.path);
  const value = JSON.parse(readFileSync(path, "utf8")) as ReleaseAttestation;
  const exactKeys = ["schema_version", "evidence_kind", "candidate", "org_fingerprint", "system_fingerprint", "campaigns", "release_package_sha256", "executable_suite_sha256", ...(value.proportionate_evaluator_repairs ? ["proportionate_evaluator_repairs"] : []), "promotion_files", "promotion_paths_sha256"].sort();
  if (Object.keys(value).sort().join("\0") !== exactKeys.join("\0")) throw new Error("release_attestation_invalid_keys");
  if (value.schema_version !== 1 || value.evidence_kind !== "phase6-evidence-only-release-equivalence") throw new Error("release_attestation_invalid_root");
  if (!Array.isArray(value.campaigns) || value.campaigns.length === 0 || new Set(value.campaigns.map((item) => item.campaign_id)).size !== value.campaigns.length) throw new Error("release_attestation_invalid_campaigns");
  if (canonicalJson(value.candidate) !== canonicalJson(options.campaign.candidate) || value.org_fingerprint !== options.campaign.org_fingerprint || value.system_fingerprint !== options.campaign.system_fingerprint) throw new Error("release_attestation_candidate_mismatch");
  if (!value.campaigns.some((item) => item.campaign_id === options.campaign.campaign_id && item.campaign_sha256 === hashManifest(options.campaign))) throw new Error("release_attestation_campaign_missing");
  if (value.release_package_sha256 !== digest(releasePackageHash(root)) || value.release_package_sha256 !== options.campaign.candidate.release_package_sha256) throw new Error("release_attestation_package_mismatch");
  if (value.executable_suite_sha256 !== options.campaign.candidate.executable_suite_sha256) throw new Error("release_attestation_suite_mismatch");
  const releaseSuiteHash = digest(executableSuiteHash(root));
  const evaluatorRepairs = verifyEvaluatorRepairs(root, options.campaign, value, releaseSuiteHash);
  if (value.org_fingerprint !== digest(hashWorkingFiles(root, ["roles.yaml", "pipelines.yaml", "prompts/", "TASTE.md", "taste/"]))) throw new Error("release_attestation_org_mismatch");
  if (value.promotion_paths_sha256 !== digest(sha256(canonicalJson(value.promotion_files)))) throw new Error("release_attestation_promotion_hash_mismatch");
  const evaluatorRepairPaths = new Set(Object.keys(evaluatorRepairs?.files ?? {}));
  for (const [rel, expected] of Object.entries(value.promotion_files)) {
    if (!allowedPromotionPath(rel) && !evaluatorRepairPaths.has(rel)) throw new Error(`release_attestation_unallowlisted_path:${rel}`);
    const absolute = resolve(root, rel);
    if (!existsSync(absolute) || repositoryRelative(root, absolute) !== rel || digest(hashFile(absolute)) !== expected) throw new Error(`release_attestation_promotion_file_mismatch:${rel}`);
  }

  if (commitExists(root, value.candidate.commit)) {
    const attestationRel = repositoryRelative(root, path);
    const actual = changedPaths(root, value.candidate.commit).filter((rel) => rel !== attestationRel && !contractProjectionPath(rel));
    if (canonicalJson(actual) !== canonicalJson(Object.keys(value.promotion_files).sort())) throw new Error("release_attestation_changed_path_mismatch");
  }
  return value;
}

function resolveEvaluatorRepairs(
  root: string,
  campaign: CampaignManifest,
  releasePackageSha256: string,
  releaseSuiteSha256: string,
): ProportionateEvaluatorRepairs | undefined {
  if (campaign.candidate.executable_suite_sha256 === releaseSuiteSha256) return undefined;
  const authorizationPath = resolve(root, EVALUATOR_REPAIR_AUTHORIZATION_PATH);
  if (!existsSync(authorizationPath)) throw new Error("executable_suite_bytes_changed_after_qualification");
  const authorization = JSON.parse(readFileSync(authorizationPath, "utf8")) as EvaluatorRepairAuthorization;
  validateEvaluatorRepairAuthorization(root, campaign, authorization, releasePackageSha256, releaseSuiteSha256);
  return {
    authorization: {
      path: EVALUATOR_REPAIR_AUTHORIZATION_PATH,
      sha256: digest(hashFile(authorizationPath)),
    },
    qualified_executable_suite_sha256: campaign.candidate.executable_suite_sha256!,
    release_executable_suite_sha256: releaseSuiteSha256,
    files: authorization.repair_files,
  };
}

function verifyEvaluatorRepairs(
  root: string,
  campaign: CampaignManifest,
  attestation: ReleaseAttestation,
  releaseSuiteSha256: string,
): ProportionateEvaluatorRepairs | undefined {
  if (campaign.candidate.executable_suite_sha256 === releaseSuiteSha256) {
    if (attestation.proportionate_evaluator_repairs !== undefined) throw new Error("release_attestation_unnecessary_evaluator_repairs");
    return undefined;
  }
  const repairs = attestation.proportionate_evaluator_repairs;
  if (!repairs) throw new Error("release_attestation_suite_mismatch");
  const authorizationPath = resolve(root, repairs.authorization.path);
  if (repairs.authorization.path !== EVALUATOR_REPAIR_AUTHORIZATION_PATH || !existsSync(authorizationPath) || repositoryRelative(root, authorizationPath) !== repairs.authorization.path || digest(hashFile(authorizationPath)) !== repairs.authorization.sha256) throw new Error("release_attestation_evaluator_authorization_mismatch");
  const authorization = JSON.parse(readFileSync(authorizationPath, "utf8")) as EvaluatorRepairAuthorization;
  validateEvaluatorRepairAuthorization(
    root,
    campaign,
    authorization,
    attestation.release_package_sha256,
    releaseSuiteSha256,
    Object.keys(attestation.promotion_files).filter(executableSuitePath),
  );
  const expected: ProportionateEvaluatorRepairs = {
    authorization: repairs.authorization,
    qualified_executable_suite_sha256: campaign.candidate.executable_suite_sha256!,
    release_executable_suite_sha256: releaseSuiteSha256,
    files: authorization.repair_files,
  };
  if (canonicalJson(repairs) !== canonicalJson(expected) || attestation.promotion_files[repairs.authorization.path] !== repairs.authorization.sha256) throw new Error("release_attestation_evaluator_repairs_mismatch");
  return repairs;
}

function validateEvaluatorRepairAuthorization(
  root: string,
  campaign: CampaignManifest,
  value: EvaluatorRepairAuthorization,
  releasePackageSha256: string,
  releaseSuiteSha256: string,
  observedSuitePaths?: string[],
): void {
  const exactKeys = ["schema_version", "evidence_kind", "authorization_id", "campaign_id", "campaign_sha256", "candidate_commit", "qualified_executable_suite_sha256", "release_executable_suite_sha256", "release_package_sha256", "material_impact", "repair_files", "rationale"].sort();
  if (!value || typeof value !== "object" || Object.keys(value).sort().join("\0") !== exactKeys.join("\0") || value.schema_version !== 1 || value.evidence_kind !== "phase6-proportionate-evaluator-repair-authorization" || value.material_impact !== "evaluator_only") throw new Error("release_attestation_evaluator_authorization_invalid");
  if (campaign.development_authorization?.authorization_id !== "phase6-efficiency-qualification-20260716-proportionate-release" || value.authorization_id !== campaign.development_authorization.authorization_id) throw new Error("release_attestation_evaluator_authorization_scope_mismatch");
  if (value.campaign_id !== campaign.campaign_id || value.campaign_sha256 !== hashManifest(campaign) || value.candidate_commit !== campaign.candidate.commit || value.qualified_executable_suite_sha256 !== campaign.candidate.executable_suite_sha256 || value.release_executable_suite_sha256 !== releaseSuiteSha256 || value.release_package_sha256 !== releasePackageSha256 || value.release_package_sha256 !== campaign.candidate.release_package_sha256 || typeof value.rationale !== "string" || value.rationale.trim() === "") throw new Error("release_attestation_evaluator_authorization_binding_mismatch");
  const repairPaths = Object.keys(value.repair_files ?? {}).sort();
  // Creation has the candidate commit and derives this set from git. A shallow
  // CI verifier may not have that ancestor; its attestation promotion_files
  // are already content-bound, so use their executable-suite subset while the
  // complete release-suite hash and every repair-file hash remain mandatory.
  const changedSuitePaths = (observedSuitePaths ?? changedPaths(root, campaign.candidate.commit).filter(executableSuitePath)).sort();
  if (repairPaths.length === 0 || canonicalJson(repairPaths) !== canonicalJson(changedSuitePaths) || repairPaths.some((path) => !ALLOWED_PROPORTIONATE_REPAIR_PATHS.has(path))) throw new Error("release_attestation_evaluator_repair_paths_mismatch");
  for (const [path, expected] of Object.entries(value.repair_files)) {
    const absolute = resolve(root, path);
    if (!existsSync(absolute) || repositoryRelative(root, absolute) !== path || digest(hashFile(absolute)) !== expected) throw new Error(`release_attestation_evaluator_repair_file_mismatch:${path}`);
  }
}

function executableSuitePath(path: string): boolean {
  return path === ".github/workflows/efficiency-qualification.yml" ||
    path.startsWith("scripts/eval/") ||
    path.startsWith("test/") ||
    (path.startsWith("eval/") && path !== "eval/contracts.yaml");
}

function loadCampaign(path: string): CampaignManifest {
  const value = loadYamlFile(path);
  const errors = validateCampaign(value);
  if (errors.length > 0) throw new Error(`release_attestation_invalid_campaign:${errors.join(";")}`);
  const campaign = value as CampaignManifest;
  if (!campaign.candidate.release_package_sha256 || !campaign.candidate.executable_suite_sha256) throw new Error("release_attestation_campaign_lacks_content_hashes");
  return campaign;
}

function changedPaths(root: string, commit: string): string[] {
  if (!commitExists(root, commit)) throw new Error("release_attestation_candidate_commit_unavailable");
  const status = execFileSync("git", ["diff", "--name-status", "--no-renames", commit, "--"], { cwd: root, encoding: "utf8" }).trim();
  const changed: string[] = [];
  for (const row of status === "" ? [] : status.split("\n")) {
    const [kind, path] = row.split("\t");
    if (!path || kind === "D") throw new Error(`release_attestation_deletion_forbidden:${path ?? row}`);
    changed.push(path);
  }
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "buffer" }).toString("utf8").split("\0").filter(Boolean);
  return [...new Set([...changed, ...untracked])].sort();
}

function allowedPromotionPath(path: string): boolean {
  if (path === "docs/PURPOSE.md" || path.startsWith("prompts/") || path === "roles.yaml" || path === "pipelines.yaml" || path === "TASTE.md") return false;
  return ALLOWED_PROMOTION_PATHS.has(path) || phase6SummaryPath(path) || sanitizedCampaignPath(path);
}

function contractProjectionPath(path: string): boolean {
  const match = /^research\/evals\/contracts\/([A-Z][A-Z0-9-]+)\.json$/.exec(path);
  return match !== null && PHASE6_CONTRACT_IDS.has(match[1]!);
}

function phase6SummaryPath(path: string): boolean {
  return /^research\/evals\/\d{4}-\d{2}-\d{2}-phase6-[a-z0-9-]+\.md$/.test(path);
}

function sanitizedCampaignPath(path: string): boolean {
  const match = /^research\/evals\/campaigns\/([a-z0-9][a-z0-9-]*)\/(.+)$/.exec(path);
  if (!match) return false;
  const rel = match[2]!;
  if (rel.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  if (rel === "campaign.yaml" || /^qualification[^/]*\.json$/.test(rel) || /^report[^/]*\.html$/.test(rel) || /^github-(?:evidence|idempotence)-[a-f0-9]{8}\.json$/.test(rel)) return true;
  if (["archive-manifest.json", "archive-receipt.json", "promotion-import.json", "soak/state.json"].includes(rel)) return true;
  return /^(?:results|grader|accounting)\/[a-zA-Z0-9._/-]+\.json$/.test(rel) || /^artifact\/[a-zA-Z0-9._/-]+\.json$/.test(rel);
}

function commitExists(root: string, commit: string): boolean {
  if (!/^[a-f0-9]{40}$/.test(commit)) return false;
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function repositoryRelative(root: string, path: string): string {
  const rel = relative(resolve(root), resolve(path)).replaceAll("\\", "/");
  if (rel === "" || rel.startsWith("../") || isAbsolute(rel)) throw new Error("release_attestation_path_escape");
  return rel;
}

function digest(value: string): string { return value.startsWith("sha256:") ? value : `sha256:${value}`; }
