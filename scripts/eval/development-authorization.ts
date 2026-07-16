import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  canonicalJson,
  hashFile,
  hashManifest,
  loadYamlFile,
  qualify,
  validateCampaign,
  validateResult,
  type AttemptResult,
  type CampaignManifest,
} from "./core.js";

export const DEVELOPMENT_POLICY_ID = "autonomous-isolated-development-v1" as const;

interface RetainedAdmissionReference {
  campaign_id: string;
  campaign_sha256: string;
}

interface ProportionateReleasePolicy {
  policy: "proportionate-release-v1";
  base_candidate_commit: string;
  bounded_changed_paths: string[];
  max_fresh_full_campaigns: 1;
  adapter: RetainedAdmissionReference;
  focused: RetainedAdmissionReference;
}

export interface DevelopmentAuthorizationGrant {
  schema_version: 1;
  authorization_id: string;
  policy_id: typeof DEVELOPMENT_POLICY_ID;
  objective: string;
  repair_lineage: string;
  authorized_at: string;
  billing_mode: "subscription";
  cumulative_equivalent_cost_usd: number;
  historical_equivalent_cost_usd: number;
  usage_reservations?: Array<{
    campaign_id: string;
    reason: "usage_unavailable_case_ceiling";
    equivalent_cost_usd: number;
  }>;
  proportionate_release?: ProportionateReleasePolicy;
  allowed_campaign_types: string[];
  github: { owner: string; repo_pattern: "operon-eval-*" };
  effects: {
    production_mutation: false;
    outward_effects: false;
    deployment: false;
    publication: false;
  };
  learning_activation: "separately_authorized";
  future_realtime_soak: "separately_authorized";
  stop_conditions: Array<
    | "cumulative_equivalent_cost_ceiling"
    | "metered_or_unknown_billing"
    | "scope_or_effect_expansion"
    | "repeated_full_qualification_failure"
  >;
}

export type CampaignDevelopmentAuthorization = NonNullable<CampaignManifest["development_authorization"]>;

export function validateDevelopmentAuthorization(value: unknown): string[] {
  if (!isRecord(value)) return ["development authorization must be an object"];
  const errors: string[] = [];
  const required = [
    "schema_version", "authorization_id", "policy_id", "objective", "repair_lineage",
    "authorized_at", "billing_mode", "cumulative_equivalent_cost_usd",
    "historical_equivalent_cost_usd", "allowed_campaign_types", "github", "effects",
    "learning_activation", "future_realtime_soak", "stop_conditions",
  ];
  const optional = ["usage_reservations", "proportionate_release"];
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) errors.push(`unknown development authorization key ${key}`);
  for (const key of required) if (!(key in value)) errors.push(`development authorization missing ${key}`);
  if (value.schema_version !== 1) errors.push("schema_version must be 1");
  for (const key of ["authorization_id", "objective", "repair_lineage"] as const) if (typeof value[key] !== "string" || value[key].trim() === "") errors.push(`${key} must be a non-empty string`);
  if (value.policy_id !== DEVELOPMENT_POLICY_ID) errors.push(`policy_id must be ${DEVELOPMENT_POLICY_ID}`);
  if (typeof value.authorized_at !== "string" || !Number.isFinite(Date.parse(value.authorized_at))) errors.push("authorized_at must be an ISO date");
  if (value.billing_mode !== "subscription") errors.push("billing_mode must be subscription");
  if (!positive(value.cumulative_equivalent_cost_usd)) errors.push("cumulative_equivalent_cost_usd must be positive");
  if (!nonNegative(value.historical_equivalent_cost_usd)) errors.push("historical_equivalent_cost_usd must be non-negative");
  const reservations = value.usage_reservations;
  if (reservations !== undefined) {
    if (!Array.isArray(reservations) || reservations.length === 0) {
      errors.push("usage_reservations must be a non-empty array when present");
    } else {
      const campaignIds = new Set<string>();
      for (const reservation of reservations) {
        if (!isRecord(reservation) || Object.keys(reservation).sort().join("\0") !== ["campaign_id", "equivalent_cost_usd", "reason"].join("\0")) {
          errors.push("each usage reservation must contain exactly campaign_id, reason, and equivalent_cost_usd");
          continue;
        }
        if (typeof reservation.campaign_id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(reservation.campaign_id)) errors.push("usage reservation campaign_id must be a canonical campaign id");
        else if (campaignIds.has(reservation.campaign_id)) errors.push("usage reservation campaign ids must be unique");
        else campaignIds.add(reservation.campaign_id);
        if (reservation.reason !== "usage_unavailable_case_ceiling") errors.push("usage reservation reason must be usage_unavailable_case_ceiling");
        if (!positive(reservation.equivalent_cost_usd)) errors.push("usage reservation equivalent cost must be positive");
      }
    }
  }
  validateProportionateRelease(value.proportionate_release, value.allowed_campaign_types, errors);
  if (!Array.isArray(value.allowed_campaign_types) || value.allowed_campaign_types.length === 0 || value.allowed_campaign_types.some((item) => typeof item !== "string" || !/^[a-z0-9][a-z0-9-]*-v\d+$/.test(item)) || new Set(value.allowed_campaign_types).size !== value.allowed_campaign_types.length) errors.push("allowed_campaign_types must be a unique non-empty versioned campaign array");
  const github = isRecord(value.github) ? value.github : undefined;
  if (!github || github.owner === undefined || typeof github.owner !== "string" || github.owner === "" || github.repo_pattern !== "operon-eval-*" || Object.keys(github).some((key) => !["owner", "repo_pattern"].includes(key))) errors.push("github must bind one owner and operon-eval-*");
  const effects = isRecord(value.effects) ? value.effects : undefined;
  if (!effects || effects.production_mutation !== false || effects.outward_effects !== false || effects.deployment !== false || effects.publication !== false || Object.keys(effects).sort().join("\0") !== ["deployment", "outward_effects", "production_mutation", "publication"].join("\0")) errors.push("effects must forbid production mutation, outward effects, deployment, and publication");
  if (value.learning_activation !== "separately_authorized") errors.push("learning_activation must be separately_authorized");
  if (value.future_realtime_soak !== "separately_authorized") errors.push("future_realtime_soak must be separately_authorized");
  const stops = ["cumulative_equivalent_cost_ceiling", "metered_or_unknown_billing", "scope_or_effect_expansion", "repeated_full_qualification_failure"];
  if (!Array.isArray(value.stop_conditions) || canonicalJson([...value.stop_conditions].sort()) !== canonicalJson([...stops].sort())) errors.push("stop_conditions must contain every standing-grant circuit breaker exactly once");
  const reserved = usageReservationTotal(reservations);
  if (positive(value.cumulative_equivalent_cost_usd) && nonNegative(value.historical_equivalent_cost_usd) && value.historical_equivalent_cost_usd + reserved >= value.cumulative_equivalent_cost_usd) errors.push("historical plus reserved equivalent cost must leave positive lineage capacity");
  return errors;
}

export function loadDevelopmentAuthorization(path: string): DevelopmentAuthorizationGrant {
  const value = loadYamlFile(resolve(path));
  const errors = validateDevelopmentAuthorization(value);
  if (errors.length > 0) throw new Error(`invalid_development_authorization:${errors.join(";")}`);
  return value as DevelopmentAuthorizationGrant;
}

export function bindDevelopmentAuthorization(grant: DevelopmentAuthorizationGrant, campaignType: string): CampaignDevelopmentAuthorization {
  if (!grant.allowed_campaign_types.includes(campaignType)) throw new Error(`development_authorization_campaign_not_allowed:${campaignType}`);
  return {
    authorization_id: grant.authorization_id,
    policy_id: grant.policy_id,
    objective: grant.objective,
    repair_lineage: grant.repair_lineage,
    campaign_type: campaignType,
    grant_sha256: hashManifest(grant),
    billing_mode: grant.billing_mode,
    cumulative_equivalent_cost_usd: grant.cumulative_equivalent_cost_usd,
  };
}

export function assertDevelopmentAuthorization(campaign: CampaignManifest, grant: DevelopmentAuthorizationGrant): CampaignDevelopmentAuthorization {
  const binding = campaign.development_authorization;
  if (!binding) throw new Error("campaign_development_authorization_missing");
  const expected = bindDevelopmentAuthorization(grant, binding.campaign_type);
  if (JSON.stringify(binding) !== JSON.stringify(expected)) throw new Error("campaign_development_authorization_mismatch");
  if (campaign.github.owner !== grant.github.owner || campaign.github.repo_pattern !== grant.github.repo_pattern) throw new Error("development_authorization_github_mismatch");
  if (campaign.campaign_id !== binding.campaign_type && !campaign.campaign_id.startsWith(`${binding.campaign_type}-`)) throw new Error("development_authorization_campaign_identity_mismatch");
  assertPhase6CampaignType(campaign, binding.campaign_type, grant.objective);
  return binding;
}

/** Final Phase 6 provider qualification normally follows exact-candidate
 * adapter and focused admission. A content-bound, human-ratified
 * proportionate-release grant may instead retain already-qualified admission
 * evidence across one explicitly bounded repair. Admission evidence remains
 * non-qualification evidence and cannot promote a release contract. */
export function assertDevelopmentAdmission(root: string, campaign: CampaignManifest, grant: DevelopmentAuthorizationGrant): {
  admission_basis: "exact-candidate" | "retained-proportionate";
  adapter_campaign_id: string;
  focused_campaign_id: string;
  prior_failed_qualification_campaigns: string[];
  bounded_changed_paths?: string[];
} | null {
  const binding = assertDevelopmentAuthorization(campaign, grant);
  if (binding.campaign_type !== "candidate-qualification-v1") return null;
  if (grant.proportionate_release !== undefined) {
    const priorCampaigns = priorStartedQualifications(root, campaign.campaign_id, grant);
    if (priorCampaigns.length >= grant.proportionate_release.max_fresh_full_campaigns) {
      throw new Error(`development_authorization_one_decisive_full_campaign:${priorCampaigns.join(",")}`);
    }
    const changedPaths = assertBoundedCandidateRepair(root, campaign, grant.proportionate_release);
    const adapter = retainedAdmissionCampaign(root, grant.proportionate_release.adapter, grant.proportionate_release.base_candidate_commit, "adapter-harness-calibration-v1", true);
    const focused = retainedAdmissionCampaign(root, grant.proportionate_release.focused, grant.proportionate_release.base_candidate_commit, "focused-provider-admission-v1", false);
    if (!sameExactCandidate(adapter, focused)) throw new Error("development_authorization_retained_admission_candidate_mismatch");
    return {
      admission_basis: "retained-proportionate",
      adapter_campaign_id: adapter.campaign_id,
      focused_campaign_id: focused.campaign_id,
      prior_failed_qualification_campaigns: [],
      bounded_changed_paths: changedPaths,
    };
  }
  const priorFailed = priorFailedQualifications(root, campaign.campaign_id, grant);
  if (priorFailed.length >= 2) throw new Error(`development_authorization_repeated_full_qualification_failure:${priorFailed.join(",")}`);
  const adapter = passedAdmissionCampaign(root, campaign, grant, "adapter-harness-calibration-v1", true);
  const focused = passedAdmissionCampaign(root, campaign, grant, "focused-provider-admission-v1", false);
  if (!adapter) throw new Error("development_authorization_adapter_admission_missing");
  if (!focused) throw new Error("development_authorization_focused_admission_missing");
  return {
    admission_basis: "exact-candidate",
    adapter_campaign_id: adapter.campaign_id,
    focused_campaign_id: focused.campaign_id,
    prior_failed_qualification_campaigns: priorFailed,
  };
}

export function lineageEquivalentCost(root: string, grant: DevelopmentAuthorizationGrant, excludingCampaignId?: string): {
  historical_equivalent_cost_usd: number;
  reserved_equivalent_cost_usd: number;
  usage_reservations: NonNullable<DevelopmentAuthorizationGrant["usage_reservations"]>;
  descendant_equivalent_cost_usd: number;
  used_equivalent_cost_usd: number;
  remaining_equivalent_cost_usd: number;
  campaigns: string[];
} {
  const grantSha = hashManifest(grant);
  const artifacts = join(root, ".eval-artifacts");
  let descendant = 0;
  const campaigns: string[] = [];
  if (existsSync(artifacts)) for (const name of readdirSync(artifacts).sort()) {
    if (name === excludingCampaignId) continue;
    const manifestPath = join(artifacts, name, "campaign.yaml");
    if (!existsSync(manifestPath)) continue;
    let campaign: CampaignManifest;
    try { campaign = loadYamlFile(manifestPath) as CampaignManifest; } catch { continue; }
    if (campaign.development_authorization?.grant_sha256 !== grantSha) continue;
    const resultsDir = join(artifacts, name, "results");
    if (!existsSync(resultsDir)) continue;
    let campaignCost = 0;
    for (const resultName of readdirSync(resultsDir).filter((entry) => entry.endsWith(".json")).sort()) {
      const result = JSON.parse(readFileSync(join(resultsDir, resultName), "utf8")) as { metrics?: { cost?: { equivalent_usd?: unknown } } };
      const cost = result.metrics?.cost?.equivalent_usd;
      if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) throw new Error(`development_authorization_invalid_cost:${name}/${resultName}`);
      campaignCost += cost;
    }
    descendant += campaignCost;
    campaigns.push(name);
  }
  const usageReservations = grant.usage_reservations ?? [];
  const reserved = usageReservationTotal(usageReservations);
  const used = grant.historical_equivalent_cost_usd + reserved + descendant;
  return {
    historical_equivalent_cost_usd: grant.historical_equivalent_cost_usd,
    reserved_equivalent_cost_usd: reserved,
    usage_reservations: usageReservations.map((reservation) => ({ ...reservation })),
    descendant_equivalent_cost_usd: descendant,
    used_equivalent_cost_usd: used,
    remaining_equivalent_cost_usd: Math.max(0, grant.cumulative_equivalent_cost_usd - used),
    campaigns,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function positive(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value > 0; }
function nonNegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function usageReservationTotal(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce((total, reservation) => total + (isRecord(reservation) && positive(reservation.equivalent_cost_usd) ? reservation.equivalent_cost_usd : 0), 0);
}

function validateProportionateRelease(value: unknown, campaignTypes: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push("proportionate_release must be an object");
    return;
  }
  const keys = ["adapter", "base_candidate_commit", "bounded_changed_paths", "focused", "max_fresh_full_campaigns", "policy"];
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(keys)) errors.push("proportionate_release must contain exactly the bounded release-policy fields");
  if (value.policy !== "proportionate-release-v1") errors.push("proportionate_release policy must be proportionate-release-v1");
  if (typeof value.base_candidate_commit !== "string" || !/^[a-f0-9]{40}$/.test(value.base_candidate_commit)) errors.push("proportionate_release base candidate must be a full commit sha");
  if (value.max_fresh_full_campaigns !== 1) errors.push("proportionate_release permits exactly one fresh full campaign");
  if (!Array.isArray(value.bounded_changed_paths) || value.bounded_changed_paths.length === 0 ||
      value.bounded_changed_paths.some((path) => typeof path !== "string" || !isCanonicalRepoPath(path)) ||
      canonicalJson(value.bounded_changed_paths) !== canonicalJson([...new Set(value.bounded_changed_paths)].sort())) {
    errors.push("proportionate_release bounded paths must be a sorted unique canonical repo-path array");
  }
  validateRetainedAdmissionReference(value.adapter, "adapter-harness-calibration-v1", "adapter", errors);
  validateRetainedAdmissionReference(value.focused, "focused-provider-admission-v1", "focused", errors);
  if (canonicalJson(campaignTypes) !== canonicalJson(["candidate-qualification-v1"])) errors.push("proportionate_release may authorize only candidate-qualification-v1");
}

function validateRetainedAdmissionReference(value: unknown, prefix: string, label: string, errors: string[]): void {
  if (!isRecord(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson(["campaign_id", "campaign_sha256"])) {
    errors.push(`proportionate_release ${label} reference must contain exactly campaign_id and campaign_sha256`);
    return;
  }
  if (typeof value.campaign_id !== "string" || !value.campaign_id.startsWith(`${prefix}-`)) errors.push(`proportionate_release ${label} campaign id mismatch`);
  if (typeof value.campaign_sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.campaign_sha256)) errors.push(`proportionate_release ${label} campaign sha256 is invalid`);
}

function isCanonicalRepoPath(value: string): boolean {
  return value !== "" && value !== "." && value !== ".." && !value.startsWith("/") && !value.startsWith("../") && !value.endsWith("/..") && !value.includes("/../") && !value.includes("\\") && !value.includes("\0");
}

function assertPhase6CampaignType(campaign: CampaignManifest, campaignType: string, objective: string): void {
  if (objective !== "phase-6-efficiency-qualification") return;
  const expected = {
    "adapter-harness-calibration-v1": { intent: "non_qualification", profile: "adapter-conformance" },
    "focused-provider-admission-v1": { intent: "non_qualification", profile: "focused-admission" },
    "candidate-qualification-v1": { intent: "qualification", profile: "production-parity" },
  }[campaignType];
  if (!expected || campaign.intent !== expected.intent || campaign.profile !== expected.profile) throw new Error("development_authorization_campaign_type_mismatch");
}

function passedAdmissionCampaign(
  root: string,
  target: CampaignManifest,
  grant: DevelopmentAuthorizationGrant,
  campaignType: "adapter-harness-calibration-v1" | "focused-provider-admission-v1",
  githubRequired: boolean,
): CampaignManifest | undefined {
  const artifacts = join(root, ".eval-artifacts");
  if (!existsSync(artifacts)) return undefined;
  const matches: CampaignManifest[] = [];
  for (const name of readdirSync(artifacts).sort()) {
    const manifestPath = join(artifacts, name, "campaign.yaml");
    if (!existsSync(manifestPath)) continue;
    let candidate: CampaignManifest;
    try { candidate = loadYamlFile(manifestPath) as CampaignManifest; } catch { continue; }
    if (candidate.development_authorization?.grant_sha256 !== hashManifest(grant) || candidate.development_authorization.campaign_type !== campaignType) continue;
    if (validateCampaign(candidate).length > 0) continue;
    try { assertDevelopmentAuthorization(candidate, grant); } catch { continue; }
    if (!sameExactCandidate(candidate, target)) continue;
    if (!admissionResultsPassed(join(artifacts, name), candidate)) continue;
    if (githubRequired && !githubAdmissionPassed(join(artifacts, name), candidate)) continue;
    matches.push(candidate);
  }
  return matches.at(-1);
}

function retainedAdmissionCampaign(
  root: string,
  reference: RetainedAdmissionReference,
  baseCandidateCommit: string,
  campaignType: "adapter-harness-calibration-v1" | "focused-provider-admission-v1",
  githubRequired: boolean,
): CampaignManifest {
  const campaignRoot = join(root, ".eval-artifacts", reference.campaign_id);
  const manifestPath = join(campaignRoot, "campaign.yaml");
  if (!existsSync(manifestPath)) throw new Error(`development_authorization_retained_${campaignType}_missing`);
  let campaign: CampaignManifest;
  try { campaign = loadYamlFile(manifestPath) as CampaignManifest; }
  catch { throw new Error(`development_authorization_retained_${campaignType}_invalid`); }
  if (hashManifest(campaign) !== reference.campaign_sha256 || campaign.campaign_id !== reference.campaign_id) throw new Error(`development_authorization_retained_${campaignType}_identity_mismatch`);
  if (campaign.development_authorization?.campaign_type !== campaignType || campaign.candidate.commit !== baseCandidateCommit) throw new Error(`development_authorization_retained_${campaignType}_candidate_mismatch`);
  if (validateCampaign(campaign).length > 0 || !admissionResultsPassed(campaignRoot, campaign)) throw new Error(`development_authorization_retained_${campaignType}_not_qualified`);
  if (githubRequired && !githubAdmissionPassed(campaignRoot, campaign)) throw new Error(`development_authorization_retained_${campaignType}_github_missing`);
  return campaign;
}

function assertBoundedCandidateRepair(root: string, campaign: CampaignManifest, policy: ProportionateReleasePolicy): string[] {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", policy.base_candidate_commit, campaign.candidate.commit], { cwd: root, stdio: "ignore" });
  } catch {
    throw new Error("development_authorization_proportionate_candidate_not_descendant");
  }
  let changedPaths: string[];
  try {
    changedPaths = execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", `${policy.base_candidate_commit}..${campaign.candidate.commit}`],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).split("\n").map((path) => path.trim()).filter(Boolean).sort();
  } catch {
    throw new Error("development_authorization_proportionate_candidate_diff_failed");
  }
  if (canonicalJson(changedPaths) !== canonicalJson(policy.bounded_changed_paths)) throw new Error(`development_authorization_proportionate_candidate_scope_mismatch:${changedPaths.join(",")}`);
  return changedPaths;
}

function admissionResultsPassed(campaignRoot: string, campaign: CampaignManifest): boolean {
  const resultDir = join(campaignRoot, "results");
  if (!existsSync(resultDir)) return false;
  const campaignSha256 = hashManifest(campaign);
  let results: AttemptResult[];
  try {
    results = readdirSync(resultDir).filter((name) => name.endsWith(".json")).sort().map((name) => JSON.parse(readFileSync(join(resultDir, name), "utf8")) as AttemptResult);
  } catch { return false; }
  if (results.some((result) => validateResult(result).length > 0 || result.campaign_id !== campaign.campaign_id || result.campaign_sha256 !== campaignSha256)) return false;
  for (const item of campaign.cases) for (const repetitionId of item.repetition_ids) {
    const attempts = results.filter((result) => result.case_id === item.case_id && result.repetition_id === repetitionId);
    const primary = attempts.filter((result) => result.retry_of === undefined);
    if (primary.length !== 1) return false;
    const retries = attempts.filter((result) => result.retry_of !== undefined);
    if (retries.length > campaign.infrastructure_retries || retries.some((result) => result.retry_of !== primary[0]!.attempt_id)) return false;
    if ((retries.at(-1) ?? primary[0])!.outcome !== "passed") return false;
  }
  return qualify(campaign, campaignSha256, results).outcome === "qualified";
}

function githubAdmissionPassed(campaignRoot: string, campaign: CampaignManifest): boolean {
  const campaignSha256 = hashManifest(campaign);
  const evidenceNames = readdirSync(campaignRoot).filter((name) => /^github-evidence-[a-f0-9]{8}\.json$/.test(name));
  const idempotenceNames = readdirSync(campaignRoot).filter((name) => /^github-idempotence-[a-f0-9]{8}\.json$/.test(name));
  if (evidenceNames.length !== 1 || idempotenceNames.length !== 1) return false;
  try {
    const evidencePath = join(campaignRoot, evidenceNames[0]!);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
    const idempotence = JSON.parse(readFileSync(join(campaignRoot, idempotenceNames[0]!), "utf8")) as Record<string, unknown>;
    return evidence.campaign_id === campaign.campaign_id && evidence.campaign_sha256 === campaignSha256 && evidence.result === "passed" &&
      idempotence.campaign_id === campaign.campaign_id && idempotence.campaign_sha256 === campaignSha256 && idempotence.result === "passed" &&
      idempotence.idempotent_rerun === true && idempotence.reused_evidence === true && idempotence.source_evidence === evidenceNames[0] &&
      idempotence.source_evidence_sha256 === `sha256:${hashFile(evidencePath)}`;
  } catch { return false; }
}

function priorFailedQualifications(root: string, excludingCampaignId: string, grant: DevelopmentAuthorizationGrant): string[] {
  const artifacts = join(root, ".eval-artifacts");
  if (!existsSync(artifacts)) return [];
  const grantSha256 = hashManifest(grant);
  return readdirSync(artifacts).sort().filter((name) => {
    if (name === excludingCampaignId) return false;
    const manifestPath = join(artifacts, name, "campaign.yaml");
    if (!existsSync(manifestPath)) return false;
    try {
      const candidate = loadYamlFile(manifestPath) as CampaignManifest;
      if (candidate.development_authorization?.grant_sha256 !== grantSha256 || candidate.development_authorization.campaign_type !== "candidate-qualification-v1") return false;
      if (existsSync(join(artifacts, name, "campaign-stop.json"))) return true;
      const qualifications = readdirSync(join(artifacts, name)).filter((entry) => /^qualification[^/]*\.json$/.test(entry));
      return qualifications.some((entry) => {
        const outcome = (JSON.parse(readFileSync(join(artifacts, name, entry), "utf8")) as { outcome?: unknown }).outcome;
        return outcome === "not_qualified" || outcome === "invalid";
      });
    } catch { return false; }
  });
}

function priorStartedQualifications(root: string, excludingCampaignId: string, grant: DevelopmentAuthorizationGrant): string[] {
  const artifacts = join(root, ".eval-artifacts");
  if (!existsSync(artifacts)) return [];
  const grantSha256 = hashManifest(grant);
  return readdirSync(artifacts).sort().filter((name) => {
    if (name === excludingCampaignId) return false;
    const campaignRoot = join(artifacts, name);
    const manifestPath = join(campaignRoot, "campaign.yaml");
    if (!existsSync(manifestPath)) return false;
    try {
      const candidate = loadYamlFile(manifestPath) as CampaignManifest;
      if (candidate.development_authorization?.grant_sha256 !== grantSha256 || candidate.development_authorization.campaign_type !== "candidate-qualification-v1") return false;
      return readdirSync(campaignRoot).some((entry) => entry === "campaign.lock.json" || entry === "campaign-stop.json" || entry.startsWith("github-evidence-") || entry.startsWith("readiness-") || entry.startsWith("qualification")) ||
        (existsSync(join(campaignRoot, "results")) && readdirSync(join(campaignRoot, "results")).some((entry) => entry.endsWith(".json")));
    } catch { return false; }
  });
}

function sameExactCandidate(left: CampaignManifest, right: CampaignManifest): boolean {
  return canonicalJson({ candidate: left.candidate, org_fingerprint: left.org_fingerprint, system_fingerprint: left.system_fingerprint }) ===
    canonicalJson({ candidate: right.candidate, org_fingerprint: right.org_fingerprint, system_fingerprint: right.system_fingerprint });
}
