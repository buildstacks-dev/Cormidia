import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import {
  QUALIFICATION_HOST_POLICY_PATH,
  parseQualificationHostPolicy,
  type QualificationHostPolicy,
} from "./qualification-host-policy.js";

export const VALIDATION_MODEL_PATHS = [
  "validation-design/model/project.yaml",
  "validation-design/model/owners.yaml",
  "validation-design/model/sources.yaml",
  "validation-design/model/structures.yaml",
  "validation-design/model/policy.yaml",
  "validation-design/model/controls.yaml",
  "validation-design/model/families.yaml",
  "validation-design/model/backlog.yaml",
] as const;
export const LEGACY_VALIDATION_POLICY_PATH = "validation-design/validation-policy.yaml";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const F_PT_012_FAMILY = "CF-J14-S";
const F_PT_012_TEST = "tests/hermetic/cf-inv-010-cf-j14-a-cf-j14-i-cf-j14-r-cf-j14-rc-cf-j14-s/cf-j14-s.test.ts";

export interface ReleasePolicyAuthority {
  kind: "legacy" | "model";
  bundle_digest: string;
  host_policy: QualificationHostPolicy;
  source_digests: Array<{ path: string; sha256: string }>;
  open_finding_ids: ReadonlySet<string>;
}
type AuthorityReader = (path: string) => Promise<Buffer | null>;
export async function loadReleasePolicyAuthority(input: {
  candidateCommit: string;
  productRevision: string;
  modelPaths: readonly string[];
  legacyPresent: boolean;
  validateModel: (productRevision: string) => Promise<void>;
  read: AuthorityReader;
}): Promise<ReleasePolicyAuthority> {
  const hostBytes = await requiredFile(input.read, QUALIFICATION_HOST_POLICY_PATH);
  const hostPolicy = parseQualificationHostPolicy(decode(hostBytes, QUALIFICATION_HOST_POLICY_PATH));
  const modelPathSet = new Set(input.modelPaths);
  const requiredModelPathSet: ReadonlySet<string> = new Set(VALIDATION_MODEL_PATHS);
  const unexpected = input.modelPaths.filter((path) => !requiredModelPathSet.has(path));
  const missing = VALIDATION_MODEL_PATHS.filter((path) => !modelPathSet.has(path));
  const exactSentinels = input.modelPaths.filter((path) => requiredModelPathSet.has(path));
  if (
    exactSentinels.length > 0 &&
    (modelPathSet.size !== input.modelPaths.length || unexpected.length > 0 || missing.length > 0)
  ) {
    const shape =
      unexpected.length === 0 && exactSentinels.length < VALIDATION_MODEL_PATHS.length
        ? `partial (${exactSentinels.length}/${VALIDATION_MODEL_PATHS.length})`
        : "not the exact eight-file set";
    throw new Error(
      `validation model is ${shape} (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}); legacy fallback is forbidden`,
    );
  }
  if (exactSentinels.length > 0 && input.legacyPresent)
    throw new Error("validation model and root legacy policy are both present; dual authority is forbidden");
  if (exactSentinels.length === 0 && !input.legacyPresent)
    throw new Error(`zero validation model files requires ${LEGACY_VALIDATION_POLICY_PATH}`);
  const modelBytes = await Promise.all(VALIDATION_MODEL_PATHS.map((path) => input.read(path)));
  const modelCount = modelBytes.filter((item) => item !== null).length;
  if (modelCount !== exactSentinels.length)
    throw new Error("validation model inventory changed while release policy authority was read");
  if (modelCount !== 0 && modelCount !== VALIDATION_MODEL_PATHS.length) {
    throw new Error(
      `validation model is partial (${modelCount}/${VALIDATION_MODEL_PATHS.length}); legacy fallback is forbidden`,
    );
  }

  let kind: ReleasePolicyAuthority["kind"];
  let authorityRows: Array<{ path: string; bytes: Buffer }>;
  let openFindingIds: Set<string>;
  if (modelCount === VALIDATION_MODEL_PATHS.length) {
    kind = "model";
    authorityRows = VALIDATION_MODEL_PATHS.map((path, index) => ({
      path,
      bytes: present(modelBytes[index], path),
    }));
    await input.validateModel(input.productRevision);
    openFindingIds = modelPolicyFacts(authorityRows, hostPolicy, input.productRevision);
  } else {
    kind = "legacy";
    const legacyPath = hostPolicy.campaign_binding.legacy_policy_path;
    const legacy = await requiredFile(input.read, legacyPath);
    authorityRows = [{ path: legacyPath, bytes: legacy }];
    openFindingIds = legacyPolicyFacts(legacy, hostPolicy);
  }

  const sourceDigests = [
    { path: QUALIFICATION_HOST_POLICY_PATH, sha256: hash(hostBytes) },
    ...authorityRows.map((item) => ({ path: item.path, sha256: hash(item.bytes) })),
  ];
  return {
    kind,
    bundle_digest: releasePolicyBundleDigest(input.candidateCommit, sourceDigests),
    host_policy: hostPolicy,
    source_digests: sourceDigests,
    open_finding_ids: openFindingIds,
  };
}
export function releasePolicyBundleDigest(
  candidateCommit: string,
  sourceDigests: ReadonlyArray<{ path: string; sha256: string }>,
): string {
  return hash(Buffer.from(JSON.stringify({ candidate_commit: candidateCommit, sources: sourceDigests })));
}
export function boundReleasePolicyBundleDigest(
  candidateCommit: string,
  binding: {
    path: string;
    sha256: string;
    validation_authority: {
      kind: "legacy" | "model";
      sources: ReadonlyArray<{ path: string; sha256: string }>;
    };
  },
): string {
  if (binding.path !== QUALIFICATION_HOST_POLICY_PATH)
    throw new Error(`campaign policy path is not ${QUALIFICATION_HOST_POLICY_PATH}`);
  const paths =
    binding.validation_authority.kind === "legacy" ? [LEGACY_VALIDATION_POLICY_PATH] : [...VALIDATION_MODEL_PATHS];
  const authorityRows = paths.map((path, index) => {
    const source = binding.validation_authority.sources[index];
    if (source === undefined || source.path !== path)
      throw new Error(`campaign policy authority source ${index} is not ${path}`);
    return { path, sha256: source.sha256 };
  });
  if (binding.validation_authority.sources.length !== paths.length)
    throw new Error("campaign policy authority source inventory differs from its selected authority kind");
  return releasePolicyBundleDigest(candidateCommit, [
    { path: QUALIFICATION_HOST_POLICY_PATH, sha256: binding.sha256 },
    ...authorityRows,
  ]);
}

function modelPolicyFacts(
  rows: Array<{ path: string; bytes: Buffer }>,
  host: QualificationHostPolicy,
  productRevision: string,
): Set<string> {
  const parsed = rows.map((row) => asRecord(parseYaml(decode(row.bytes, row.path)), row.path));
  const project = asRecord(parsed[0]?.["product"], "model project.product");
  if (project["revision"] !== productRevision)
    throw new Error("validation model product revision is stale for the release candidate");
  const policy = parsed[4];
  const familiesRoot = parsed[6];
  if (policy === undefined || familiesRoot === undefined)
    throw new Error("validation model release-policy inputs are missing");
  const lanes = indexedRows(policy["lanes"], "model policy lanes");
  const families = indexedRows(familiesRoot["families"], "model families");
  const expectedReleaseFamilies = new Set(releaseCaseIds(host));
  const releaseL3Lanes = new Set<string>();
  for (const id of expectedReleaseFamilies) {
    const family = families.get(id);
    if (family === undefined || family["status"] !== "implementable" || family["layer"] !== "L3")
      throw new Error(`validation model does not declare ${id} as an implementable L3 family`);
    const laneId = identifier(family["lane"], `validation family ${id}.lane`);
    const lane = lanes.get(laneId);
    const triggers = lane === undefined ? [] : strings(lane["triggers"], `validation lane ${laneId}.triggers`);
    if (
      lane === undefined ||
      lane["status"] !== "active" ||
      lane["requirement"] !== "blocking" ||
      !triggers.includes("release-qualification")
    )
      throw new Error(`validation model does not declare ${id} in an active release-qualification lane`);
    releaseL3Lanes.add(laneId);
  }
  if (releaseL3Lanes.size !== 1)
    throw new Error("validation model must declare one dedicated L3 release-qualification lane");
  for (const [id, family] of families) {
    if (
      family["status"] !== "pruned" &&
      family["layer"] === "L3" &&
      releaseL3Lanes.has(String(family["lane"])) &&
      !expectedReleaseFamilies.has(id)
    )
      throw new Error(`validation model release-qualification lane has non-denominator family ${id}`);
  }
  const findings = new Set(host.release_qualification.allowed_test_skip_findings.map((item) => item.id));
  for (const id of findings) {
    if (id !== "F-PT-012") throw new Error(`validation model has no supported blocker binding for ${id}`);
    const family = families.get(F_PT_012_FAMILY);
    const meaning = family?.["meaning"];
    const plannedTests =
      family === undefined ? [] : strings(family["planned_tests"], `${F_PT_012_FAMILY}.planned_tests`);
    const exclusions = family === undefined ? [] : strings(family["exclusions"], `${F_PT_012_FAMILY}.exclusions`);
    if (
      family?.["status"] !== "implementable" ||
      typeof meaning !== "string" ||
      !containsToken(meaning, `BLOCKED:${id}`) ||
      !plannedTests.includes(F_PT_012_TEST) ||
      !exclusions.some((value) => containsToken(value, id))
    )
      throw new Error(`validation model does not preserve ${id} on its exact ${F_PT_012_FAMILY} skipped-test family`);
  }
  return findings;
}

function legacyPolicyFacts(bytes: Buffer, host: QualificationHostPolicy): Set<string> {
  const legacyPath = host.campaign_binding.legacy_policy_path;
  const root = asRecord(parseYaml(decode(bytes, legacyPath)), "legacy validation policy");
  const layers = asRecord(root["layers"], "legacy validation policy layers");
  const l3 = asRecord(layers["L3_live_sandbox"], "legacy L3 policy");
  const obligations = indexedRows(l3["obligations"], "legacy L3 obligations");
  for (const id of releaseCaseIds(host)) {
    const row = obligations.get(id);
    const trigger = row?.["trigger"];
    if (
      row === undefined ||
      typeof trigger !== "string" ||
      !trigger.toLowerCase().includes("release") ||
      row["status"] !== "ACTIVE"
    )
      throw new Error(`legacy validation policy does not admit ${id} for RQ-1 release qualification`);
  }
  const findings = indexedRows(root["open_findings"], "legacy open findings");
  const admitted = new Set<string>();
  for (const expected of host.release_qualification.allowed_test_skip_findings) {
    const row = findings.get(expected.id);
    if (row === undefined || row["status"] !== expected.status)
      throw new Error(`legacy validation policy does not preserve ${expected.id} as ${expected.status}`);
    admitted.add(expected.id);
  }
  return admitted;
}

function releaseCaseIds(host: QualificationHostPolicy): string[] {
  return [...host.release_qualification.required_l3_case_ids, ...host.release_qualification.conditional_l3_case_ids];
}

function indexedRows(value: unknown, name: string): Map<string, Record<string, unknown>> {
  const indexed = new Map<string, Record<string, unknown>>();
  for (const [index, raw] of asArray(value, name).entries()) {
    const row = asRecord(raw, `${name}[${index}]`);
    const id = identifier(row["id"], `${name}[${index}].id`);
    if (indexed.has(id)) throw new Error(`${name} contains duplicate id ${id}`);
    indexed.set(id, row);
  }
  return indexed;
}

function containsToken(value: string, target: string): boolean {
  const literal = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9-])${literal}(?:$|[^A-Za-z0-9-])`).test(value);
}

function strings(value: unknown, name: string): string[] {
  const values = asArray(value, name);
  if (values.length === 0 || !values.every((item) => typeof item === "string" && item.trim().length > 0))
    throw new Error(`${name} must contain non-empty strings`);
  return values.filter((item) => typeof item === "string");
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new Error(`${name} must be an identifier`);
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

function decode(bytes: Buffer, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${path} is not valid UTF-8`, { cause: error });
  }
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function requiredFile(read: AuthorityReader, path: string): Promise<Buffer> {
  const value = await read(path);
  if (value === null) throw new Error(`release candidate is missing tracked input ${path}`);
  return value;
}

function present(value: Buffer | null | undefined, path: string): Buffer {
  if (value === null || value === undefined)
    throw new Error(`release candidate is missing tracked model input ${path}`);
  return value;
}
