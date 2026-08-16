import { parse as parseYaml } from "yaml";

export const QUALIFICATION_HOST_POLICY_PATH = "docs/qualification/host-policy.yaml";
const LEGACY_POLICY_PATH = "validation-design/validation-policy.yaml";
const MODEL_ROOT = "validation-design/model";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PRE_MERGE_SCOPE = "changed adapter only";
const GITHUB_SCOPE = "sandbox GitHub repo only";
const LAUNCHD_SCOPE = "unique launchd definition only";
const RELEASE_SCOPE = "all adapters + GitHub + launchd + unattended profile";
const CEILING_OUTCOME = "completeness=incomplete; verdict never pass";
const AXIS_RULES = [
  "0/1/2/3 = absent / attempted / adequate / strong, per acceptance/rubric.md section 5",
  "every numeric score carries a mandatory one-sentence justification citing specific evidence; a score without its citation is discarded and the axis reports ungraded",
  "ungraded means the evidence for this axis is missing or unusable; it is not 0 and is never coerced to 0",
  "ungraded never enters an aggregate as a numeric value; every aggregate names its graded denominator explicitly",
  "an axis with no legal disjoint grader reports ungraded; it is never graded by a correlated provider",
  "any ungraded axis, killed scenario, ceiling exhaustion, or missing grader run makes that scenario incomplete",
  "while a threshold is unratified, every threshold-dependent axis verdict is inconclusive, never pass or fail",
] as const;

export interface QualificationHostPolicy {
  schema: "cormidia/qualification-host-policy/v1";
  product: "cormidia";
  release_qualification: {
    contract_id: "RQ-1";
    required_l3_case_ids: string[];
    conditional_l3_case_ids: string[];
    allowed_test_skip_findings: Array<{ id: string; status: "open" }>;
    campaign_spend: {
      pre_merge_adapter: { scope: typeof PRE_MERGE_SCOPE; max_provider_turns: number; max_equiv_usd: number };
      github_smoke: { scope: typeof GITHUB_SCOPE; max_provider_turns: number; max_equiv_usd: number };
      launchd_proof: { scope: typeof LAUNCHD_SCOPE; max_provider_turns: number; max_equiv_usd: number };
      release: { scope: typeof RELEASE_SCOPE; max_provider_turns: number; max_equiv_usd: number };
      on_ceiling_exhaustion: typeof CEILING_OUTCOME;
    };
  };
  outcome_acceptance: {
    release_relationship: "disclosed-assurance-outside-rq1";
    axis_score: { values: Array<number | "ungraded">; rules: string[]; thresholds: "none" };
  };
  active_revision_catalog: {
    revision_id: string;
    registered_structure_ids: string[];
    catalog_slice_content_sha256: string;
  };
  campaign_binding: {
    legacy_policy_path: typeof LEGACY_POLICY_PATH;
    model_root: typeof MODEL_ROOT;
    host_policy_path: typeof QUALIFICATION_HOST_POLICY_PATH;
  };
}

export function parseQualificationHostPolicy(content: string): QualificationHostPolicy {
  const root = asRecord(parseYaml(content), "qualification host policy");
  exact(
    root,
    ["schema", "product", "release_qualification", "outcome_acceptance", "active_revision_catalog", "campaign_binding"],
    "qualification host policy",
  );
  if (root["schema"] !== "cormidia/qualification-host-policy/v1")
    throw new Error("unsupported qualification host-policy schema");
  if (root["product"] !== "cormidia") throw new Error("qualification host policy must bind product cormidia");

  const release = asRecord(root["release_qualification"], "release_qualification");
  exact(
    release,
    ["contract_id", "required_l3_case_ids", "conditional_l3_case_ids", "allowed_test_skip_findings", "campaign_spend"],
    "release_qualification",
  );
  if (release["contract_id"] !== "RQ-1") throw new Error("qualification host policy must declare contract_id RQ-1");
  const required = identifiers(release["required_l3_case_ids"], "required_l3_case_ids", true);
  const conditional = identifiers(release["conditional_l3_case_ids"], "conditional_l3_case_ids", false);
  if (required.some((item) => conditional.includes(item)))
    throw new Error("required and conditional L3 cases must be disjoint");
  const findings = asArray(release["allowed_test_skip_findings"], "allowed_test_skip_findings").map((raw, index) => {
    const row = asRecord(raw, `allowed_test_skip_findings[${index}]`);
    exact(row, ["id", "status"], `allowed_test_skip_findings[${index}]`);
    const id = identifier(row["id"], `allowed_test_skip_findings[${index}].id`);
    if (row["status"] !== "open") throw new Error(`allowed test-skip finding ${id} must have status open`);
    return { id, status: "open" } as const;
  });
  unique(
    findings.map((item) => item.id),
    "allowed test-skip finding",
  );

  const spend = asRecord(release["campaign_spend"], "release_qualification.campaign_spend");
  exact(
    spend,
    ["pre_merge_adapter", "github_smoke", "launchd_proof", "release", "on_ceiling_exhaustion"],
    "release_qualification.campaign_spend",
  );
  const preMergeSpend = campaignSpend(spend["pre_merge_adapter"], "campaign_spend.pre_merge_adapter", PRE_MERGE_SCOPE);
  const githubSpend = campaignSpend(spend["github_smoke"], "campaign_spend.github_smoke", GITHUB_SCOPE);
  const launchdSpend = campaignSpend(spend["launchd_proof"], "campaign_spend.launchd_proof", LAUNCHD_SCOPE);
  const releaseSpend = campaignSpend(spend["release"], "campaign_spend.release", RELEASE_SCOPE);
  const ceilingOutcome = string(spend["on_ceiling_exhaustion"], "campaign_spend.on_ceiling_exhaustion");
  if (ceilingOutcome !== CEILING_OUTCOME)
    throw new Error("campaign_spend.on_ceiling_exhaustion differs from the supported v1 refusal behavior");

  const outcome = asRecord(root["outcome_acceptance"], "outcome_acceptance");
  exact(outcome, ["release_relationship", "axis_score"], "outcome_acceptance");
  if (outcome["release_relationship"] !== "disclosed-assurance-outside-rq1")
    throw new Error("outcome_acceptance.release_relationship differs from the ratified RQ-1 boundary");
  const axis = asRecord(outcome["axis_score"], "outcome_acceptance.axis_score");
  exact(axis, ["values", "rules", "thresholds"], "outcome_acceptance.axis_score");
  if (
    JSON.stringify(asArray(axis["values"], "outcome_acceptance.axis_score.values")) !==
    JSON.stringify([0, 1, 2, 3, "ungraded"])
  )
    throw new Error("outcome_acceptance.axis_score.values must be exactly [0, 1, 2, 3, ungraded]");
  const rules = strings(axis["rules"], "outcome_acceptance.axis_score.rules", true);
  if (JSON.stringify(rules) !== JSON.stringify(AXIS_RULES))
    throw new Error("outcome_acceptance.axis_score.rules must contain the exact seven ratified rules");
  if (axis["thresholds"] !== "none") throw new Error("outcome_acceptance.axis_score.thresholds must be none");

  const revision = asRecord(root["active_revision_catalog"], "active_revision_catalog");
  exact(
    revision,
    ["revision_id", "registered_structure_ids", "catalog_slice_content_sha256"],
    "active_revision_catalog",
  );
  const revisionId = identifier(revision["revision_id"], "active_revision_catalog.revision_id");
  const structureIds = identifiers(
    revision["registered_structure_ids"],
    "active_revision_catalog.registered_structure_ids",
    true,
  );
  const catalogHash = string(
    revision["catalog_slice_content_sha256"],
    "active_revision_catalog.catalog_slice_content_sha256",
  );
  if (!SHA256.test(catalogHash))
    throw new Error("active_revision_catalog.catalog_slice_content_sha256 must be SHA-256");

  const binding = asRecord(root["campaign_binding"], "campaign_binding");
  exact(binding, ["legacy_policy_path", "model_root", "host_policy_path"], "campaign_binding");
  if (
    binding["legacy_policy_path"] !== LEGACY_POLICY_PATH ||
    binding["model_root"] !== MODEL_ROOT ||
    binding["host_policy_path"] !== QUALIFICATION_HOST_POLICY_PATH
  ) {
    throw new Error("qualification campaign binding paths differ from the closed repository contract");
  }

  return {
    schema: "cormidia/qualification-host-policy/v1",
    product: "cormidia",
    release_qualification: {
      contract_id: "RQ-1",
      required_l3_case_ids: required,
      conditional_l3_case_ids: conditional,
      allowed_test_skip_findings: findings,
      campaign_spend: {
        pre_merge_adapter: preMergeSpend,
        github_smoke: githubSpend,
        launchd_proof: launchdSpend,
        release: releaseSpend,
        on_ceiling_exhaustion: CEILING_OUTCOME,
      },
    },
    outcome_acceptance: {
      release_relationship: "disclosed-assurance-outside-rq1",
      axis_score: { values: [0, 1, 2, 3, "ungraded"], rules, thresholds: "none" },
    },
    active_revision_catalog: {
      revision_id: revisionId,
      registered_structure_ids: structureIds,
      catalog_slice_content_sha256: catalogHash,
    },
    campaign_binding: {
      legacy_policy_path: LEGACY_POLICY_PATH,
      model_root: MODEL_ROOT,
      host_policy_path: QUALIFICATION_HOST_POLICY_PATH,
    },
  };
}

function campaignSpend<Scope extends string>(
  value: unknown,
  name: string,
  expectedScope: Scope,
): { scope: Scope; max_provider_turns: number; max_equiv_usd: number } {
  const row = asRecord(value, name);
  exact(row, ["scope", "max_provider_turns", "max_equiv_usd"], name);
  if (row["scope"] !== expectedScope) throw new Error(`${name}.scope differs from the supported v1 scope`);
  return {
    scope: expectedScope,
    max_provider_turns: positiveInteger(row["max_provider_turns"], `${name}.max_provider_turns`),
    max_equiv_usd: positiveNumber(row["max_equiv_usd"], `${name}.max_equiv_usd`),
  };
}

function exact(value: Record<string, unknown>, fields: string[], name: string): void {
  const expected = new Set(fields);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = fields.filter((key) => !(key in value));
  if (unknown.length > 0 || missing.length > 0)
    throw new Error(
      `${name} fields differ from its closed schema (unknown: ${unknown.join(", ") || "none"}; missing: ${missing.join(", ") || "none"})`,
    );
}

function identifiers(value: unknown, name: string, nonempty: boolean): string[] {
  const values = strings(value, name, nonempty);
  for (const item of values) identifier(item, name);
  unique(values, name);
  return values;
}

function strings(value: unknown, name: string, nonempty: boolean): string[] {
  const values = asArray(value, name);
  if (nonempty && values.length === 0) throw new Error(`${name} must be non-empty`);
  if (!values.every((item) => typeof item === "string" && item.trim().length > 0))
    throw new Error(`${name} must contain non-empty strings`);
  return values.filter((item) => typeof item === "string");
}

function unique(values: string[], name: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${name} values must be unique`);
}

function identifier(value: unknown, name: string): string {
  const parsed = string(value, name);
  if (!IDENTIFIER.test(parsed)) throw new Error(`${name} must be an identifier`);
  return parsed;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

function positiveNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be a positive number`);
  return value;
}

function asArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}
