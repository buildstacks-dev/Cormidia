import { QUALIFICATION_HOST_POLICY_PATH } from "./qualification-host-policy.js";
import { VALIDATION_MODEL_PATHS } from "./release-policy-authority.js";

const LEGACY_POLICY_PATH = "validation-design/validation-policy.yaml";
const SHA256 = /^[a-f0-9]{64}$/;

export interface ValidationCampaignPolicyBinding {
  path: string;
  sha256: string;
  validation_authority: {
    kind: "legacy" | "model";
    sources: Array<{ path: string; sha256: string }>;
  };
}

export function parseValidationCampaignPolicyBinding(value: unknown): ValidationCampaignPolicyBinding {
  const root = record(value, "policy");
  exact(root, ["path", "sha256", "validation_authority"], "policy");
  const path = nonempty(root["path"], "policy.path");
  const digest = sha256(root["sha256"], "policy.sha256");
  if (path !== QUALIFICATION_HOST_POLICY_PATH)
    throw new Error(`policy.path must be the canonical ${QUALIFICATION_HOST_POLICY_PATH}`);

  const authority = record(root["validation_authority"], "policy.validation_authority");
  exact(authority, ["kind", "sources"], "policy.validation_authority");
  const kind = authority["kind"];
  if (kind !== "legacy" && kind !== "model") throw new Error("policy.validation_authority.kind is invalid");
  if (!Array.isArray(authority["sources"])) throw new Error("policy.validation_authority.sources must be an array");
  const expectedPaths = kind === "legacy" ? [LEGACY_POLICY_PATH] : [...VALIDATION_MODEL_PATHS];
  if (authority["sources"].length !== expectedPaths.length)
    throw new Error(`policy.validation_authority.sources must contain exactly ${expectedPaths.length} entries`);
  const sources = authority["sources"].map((value, index) => {
    const source = record(value, `policy.validation_authority.sources[${index}]`);
    exact(source, ["path", "sha256"], `policy.validation_authority.sources[${index}]`);
    const sourcePath = nonempty(source["path"], `policy.validation_authority.sources[${index}].path`);
    if (sourcePath !== expectedPaths[index])
      throw new Error(`policy.validation_authority.sources[${index}].path is not ${expectedPaths[index]}`);
    return {
      path: sourcePath,
      sha256: sha256(source["sha256"], `policy.validation_authority.sources[${index}].sha256`),
    };
  });
  return { path, sha256: digest, validation_authority: { kind, sources } };
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, fields: string[], name: string): void {
  const expected = new Set(fields);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = fields.filter((key) => !(key in value));
  if (unknown.length > 0 || missing.length > 0)
    throw new Error(
      `${name} fields differ (unknown: ${unknown.join(", ") || "none"}; missing: ${missing.join(", ") || "none"})`,
    );
}

function nonempty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string`);
  return value;
}

function sha256(value: unknown, name: string): string {
  const digest = nonempty(value, name);
  if (!SHA256.test(digest)) throw new Error(`${name} must be lowercase sha256`);
  return digest;
}
