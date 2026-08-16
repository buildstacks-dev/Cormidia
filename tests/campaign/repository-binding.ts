// Fail-closed provenance binding for triggered validation campaigns. External
// authorization selects a commit; it cannot substitute an arbitrary policy or
// uncommitted golden set for the blobs reviewed at that commit.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parseQualificationHostPolicy, type QualificationHostPolicy } from "../../src/org/qualification-host-policy.js";
import type { ValidationCampaignReportV2 } from "../../src/org/validation-campaign-report.js";
import { assertNoDirtyCampaignProductPaths } from "./repository-cleanliness.js";
import {
  assertTrackedBlob,
  assertRepositoryRegularFile,
  createCampaignRepositoryRevalidator,
  readCommittedBlob,
  type CampaignRepositoryRevalidator,
} from "./repository-revalidation.js";
import {
  compileCheckedModel,
  GENERATED_VIEW_RELATIVE_PATHS,
  HOST_POLICY_RELATIVE_PATH,
  readExactCommittedGeneratedViews,
  resolveValidationProductRevision,
  selectValidationAuthority,
  type ValidationAuthoritySelection,
} from "../fixtures/validation-authority.js";

export interface CampaignRepositoryBinding {
  commit: string;
  policyPath: string;
  trackedInputPaths?: string[];
  cwd?: string;
}

export interface VerifiedCampaignRepositoryBinding {
  root: string;
  policyPath: string;
  hostPolicy: QualificationHostPolicy;
  policyBinding: ValidationCampaignReportV2["policy"];
  validationAuthority: ValidationAuthoritySelection["kind"];
  validationAuthorityPaths: string[];
  trackedInputPaths: string[];
  trackedInputBytes: Buffer[];
  revalidate: CampaignRepositoryRevalidator;
}

export async function assertCampaignRepositoryBinding(
  input: CampaignRepositoryBinding,
): Promise<VerifiedCampaignRepositoryBinding> {
  const cwd = input.cwd ?? process.cwd();
  const root = await realpath(git(cwd, ["rev-parse", "--show-toplevel"]));
  const head = git(root, ["rev-parse", "HEAD"]);
  if (head !== input.commit) {
    throw new Error(`campaign refused: authorized commit ${input.commit} does not equal checked-out HEAD ${head}`);
  }
  const validationAuthority = selectValidationAuthority(root);
  const lexicalPolicy = join(root, HOST_POLICY_RELATIVE_PATH);
  await assertRepositoryRegularFile(root, lexicalPolicy, "host policy");
  const canonicalPolicy = await realpath(lexicalPolicy);
  const policyPath = await realpath(input.policyPath);
  if (policyPath !== canonicalPolicy) {
    throw new Error(`campaign refused: policy_path must be the canonical ${HOST_POLICY_RELATIVE_PATH} at HEAD`);
  }
  await assertTrackedBlob(root, input.commit, lexicalPolicy, "host policy");
  const hostBytes = readCommittedBlob(root, input.commit, lexicalPolicy, "host policy");
  const hostPolicy = parseQualificationHostPolicy(hostBytes.toString("utf8"));
  if (hostPolicy.campaign_binding.host_policy_path !== HOST_POLICY_RELATIVE_PATH) {
    throw new Error("campaign refused: parsed host-policy binding path drifted");
  }

  const validationAuthorityPaths: string[] = [];
  const generatedViewPaths: string[] = [];
  const authoritySources: Array<{ path: string; sha256: string }> = [];
  for (const relativePath of validationAuthority.paths) {
    const lexical = join(root, relativePath);
    await assertRepositoryRegularFile(root, lexical, "validation authority");
    const path = await realpath(lexical);
    await assertTrackedBlob(root, input.commit, lexical, "validation authority");
    validationAuthorityPaths.push(path);
    authoritySources.push({
      path: relativePath,
      sha256: sha256(readCommittedBlob(root, input.commit, lexical, "validation authority")),
    });
  }
  if (validationAuthority.kind === "model") {
    for (const relativePath of GENERATED_VIEW_RELATIVE_PATHS) {
      const lexical = join(root, relativePath);
      await assertRepositoryRegularFile(root, lexical, "generated validation view");
      const path = await realpath(lexical);
      await assertTrackedBlob(root, input.commit, lexical, "generated validation view");
      generatedViewPaths.push(path);
    }
    const productRevision = resolveValidationProductRevision(root, input.commit);
    await compileCheckedModel(root, productRevision);
    readExactCommittedGeneratedViews(root, input.commit);
  }
  assertNoDirtyCampaignProductPaths(root);

  const trackedInputPaths: string[] = [];
  const trackedInputBytes: Buffer[] = [];
  const trackedInputs: Array<{ configured: string; canonical: string }> = [];
  for (const configured of input.trackedInputPaths ?? []) {
    if (!isAbsolute(configured)) throw new Error("campaign tracked input paths must be absolute");
    const path = await realpath(configured);
    await assertRepositoryRegularFile(root, path, "campaign input");
    await assertTrackedBlob(root, input.commit, path, "campaign input");
    trackedInputPaths.push(path);
    trackedInputBytes.push(readCommittedBlob(root, input.commit, path, "campaign input"));
    trackedInputs.push({ configured, canonical: path });
  }
  const revalidate = createCampaignRepositoryRevalidator({
    root,
    commit: input.commit,
    configuredPolicyPath: input.policyPath,
    policyPath,
    validationAuthority,
    validationAuthorityPaths,
    generatedViewPaths,
    trackedInputs,
  });
  return {
    root,
    policyPath,
    hostPolicy,
    policyBinding: {
      path: HOST_POLICY_RELATIVE_PATH,
      sha256: sha256(hostBytes),
      validation_authority: { kind: validationAuthority.kind, sources: authoritySources },
    },
    validationAuthority: validationAuthority.kind,
    validationAuthorityPaths,
    trackedInputPaths,
    trackedInputBytes,
    revalidate,
  };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
