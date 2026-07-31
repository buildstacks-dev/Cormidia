import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hashFile } from "./core.js";

export interface GitHubLifecycleVerification {
  issue_closed: boolean;
  pr_merged: boolean;
  review_count: number;
  comment_count: number;
  branch_deleted: boolean;
}

export interface GitHubIdempotenceEvidence extends GitHubLifecycleVerification {
  schema_version: 1;
  evidence_kind: "github-idempotence";
  campaign_id: string;
  campaign_sha256: string;
  repo: string;
  repository_id: string;
  source_evidence: string;
  source_evidence_sha256: string;
  reused_evidence: true;
  idempotent_rerun: true;
  result: "passed";
}

export function persistGitHubIdempotenceEvidence(options: {
  path: string;
  campaignId: string;
  campaignSha256: string;
  repo: string;
  repositoryId: string;
  sourceEvidencePath: string;
  sourceEvidenceName: string;
  verification: GitHubLifecycleVerification;
}): GitHubIdempotenceEvidence {
  const evidence: GitHubIdempotenceEvidence = {
    schema_version: 1,
    evidence_kind: "github-idempotence",
    campaign_id: options.campaignId,
    campaign_sha256: options.campaignSha256,
    repo: options.repo,
    repository_id: options.repositoryId,
    source_evidence: options.sourceEvidenceName,
    source_evidence_sha256: `sha256:${hashFile(options.sourceEvidencePath)}`,
    ...options.verification,
    reused_evidence: true,
    idempotent_rerun: true,
    result: "passed",
  };
  const payload = `${JSON.stringify(evidence, null, 2)}\n`;
  if (existsSync(options.path)) {
    if (readFileSync(options.path, "utf8") !== payload) {
      throw new Error("github_idempotence_evidence_conflict");
    }
    return evidence;
  }
  mkdirSync(dirname(options.path), { recursive: true });
  writeFileSync(options.path, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return evidence;
}
