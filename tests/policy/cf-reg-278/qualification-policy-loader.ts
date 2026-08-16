import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  QUALIFICATION_HOST_POLICY_PATH,
  parseQualificationHostPolicy,
  type QualificationHostPolicy,
} from "../../../src/org/qualification-host-policy.js";
import { selectValidationAuthority, type ValidationAuthoritySelection } from "../../fixtures/validation-authority.js";
import { PolicyLoadError } from "./policy-loader.js";

export const HOST_POLICY_RELATIVE_PATH = QUALIFICATION_HOST_POLICY_PATH;

export interface QualificationPolicy {
  readonly hostPolicy: QualificationHostPolicy;
  readonly validationAuthority: ValidationAuthoritySelection;
  readonly policyPath: string;
  readonly repoRoot: string;
}

export function loadQualificationPolicy(repoRoot: string): QualificationPolicy {
  const absRoot = resolve(repoRoot);
  const policyPath = join(absRoot, HOST_POLICY_RELATIVE_PATH);
  try {
    return {
      hostPolicy: parseQualificationHostPolicy(readFileSync(policyPath, "utf8")),
      validationAuthority: selectValidationAuthority(absRoot),
      policyPath,
      repoRoot: absRoot,
    };
  } catch (cause) {
    throw new PolicyLoadError(`cannot load closed qualification policy at ${policyPath}: ${String(cause)}`);
  }
}

export const HOST_POLICY_PINS = {
  required_l3_case_ids: ["CF-B02-L3", "CF-B03-L3", "CF-B04-L3", "CF-B01-L3", "CF-J18-A", "CF-J16-A"],
  allowed_test_skip_findings: [{ id: "F-PT-012", status: "open" }],
  pre_merge_adapter: { scope: "changed adapter only", max_provider_turns: 2, max_equiv_usd: 5 },
  github_smoke: { scope: "sandbox GitHub repo only", max_provider_turns: 2, max_equiv_usd: 5 },
  launchd_proof: { scope: "unique launchd definition only", max_provider_turns: 2, max_equiv_usd: 5 },
  release: {
    scope: "all adapters + GitHub + launchd + unattended profile",
    max_provider_turns: 24,
    max_equiv_usd: 100,
  },
  on_ceiling_exhaustion: "completeness=incomplete; verdict never pass",
  axis_values: [0, 1, 2, 3, "ungraded"],
  axis_rules: [
    "0/1/2/3 = absent / attempted / adequate / strong, per acceptance/rubric.md section 5",
    "every numeric score carries a mandatory one-sentence justification citing specific evidence; a score without its citation is discarded and the axis reports ungraded",
    "ungraded means the evidence for this axis is missing or unusable; it is not 0 and is never coerced to 0",
    "ungraded never enters an aggregate as a numeric value; every aggregate names its graded denominator explicitly",
    "an axis with no legal disjoint grader reports ungraded; it is never graded by a correlated provider",
    "any ungraded axis, killed scenario, ceiling exhaustion, or missing grader run makes that scenario incomplete",
    "while a threshold is unratified, every threshold-dependent axis verdict is inconclusive, never pass or fail",
  ],
  axis_thresholds: "none",
  revision_id: "roadmap-validation-delivery-batching-2026-08-03",
  registered_structure_ids: [
    "M17",
    "J-20",
    "CORMIDIA-INV-016",
    "B-20",
    "B-21",
    "B-22",
    "CORMIDIA-C-B20-001",
    "CORMIDIA-C-B21-001",
    "CORMIDIA-C-B22-001",
    "CORMIDIA-C-OPBATCH-001",
    "CORMIDIA-C-OPVALIDATION-001",
    "S-10",
  ],
  catalog_slice_content_sha256: "58b677769721a28840733bd9e7da8aa729194fa6d1b1ed533128f17e56aa4880",
} as const;

export function auditHostPolicyPins(policy: QualificationPolicy): string[] {
  const host = policy.hostPolicy;
  const violations: string[] = [];
  const equal = (label: string, actual: unknown, expected: unknown): void => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) violations.push(`${label} drifted from its ratified pin`);
  };
  equal("required_l3_case_ids", host.release_qualification.required_l3_case_ids, HOST_POLICY_PINS.required_l3_case_ids);
  equal("conditional_l3_case_ids", host.release_qualification.conditional_l3_case_ids, []);
  equal(
    "allowed_test_skip_findings",
    host.release_qualification.allowed_test_skip_findings,
    HOST_POLICY_PINS.allowed_test_skip_findings,
  );
  const spend = host.release_qualification.campaign_spend;
  equal("campaign_spend.pre_merge_adapter", spend.pre_merge_adapter, HOST_POLICY_PINS.pre_merge_adapter);
  equal("campaign_spend.github_smoke", spend.github_smoke, HOST_POLICY_PINS.github_smoke);
  equal("campaign_spend.launchd_proof", spend.launchd_proof, HOST_POLICY_PINS.launchd_proof);
  equal("campaign_spend.release", spend.release, HOST_POLICY_PINS.release);
  equal("campaign_spend.on_ceiling_exhaustion", spend.on_ceiling_exhaustion, HOST_POLICY_PINS.on_ceiling_exhaustion);
  const axis = host.outcome_acceptance.axis_score;
  equal("axis_score.values", axis.values, HOST_POLICY_PINS.axis_values);
  equal("axis_score.rules", axis.rules, HOST_POLICY_PINS.axis_rules);
  equal("axis_score.thresholds", axis.thresholds, HOST_POLICY_PINS.axis_thresholds);
  const revision = host.active_revision_catalog;
  equal("active_revision_catalog.revision_id", revision.revision_id, HOST_POLICY_PINS.revision_id);
  equal(
    "active_revision_catalog.registered_structure_ids",
    revision.registered_structure_ids,
    HOST_POLICY_PINS.registered_structure_ids,
  );
  equal(
    "active_revision_catalog.catalog_slice_content_sha256",
    revision.catalog_slice_content_sha256,
    HOST_POLICY_PINS.catalog_slice_content_sha256,
  );
  return violations;
}
