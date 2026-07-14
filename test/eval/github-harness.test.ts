import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import type { CampaignManifest } from "../../scripts/eval/core.js";
import { persistGitHubIdempotenceEvidence } from "../../scripts/eval/github-evidence.js";

const root = resolve(import.meta.dirname, "../..");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("L4 full disposable GitHub lifecycle harness", () => {
  it("positive preview declares labels issue branch commit push PR comments review merge cleanup and rerun evidence", () => {
    const manifest = writeCampaign("acme");
    const result = run(manifest, "acme/operon-eval-l4-test");
    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout) as { mode: string; operations: string[] };
    expect(value.mode).toBe("preview");
    for (const token of ["labels", "issue", "branch", "commit", "push", "pull request", "comments", "review", "merge", "cleanup", "idempotent rerun"]) expect(value.operations.join(" ")).toContain(token);
  });
  it("near-miss preview is read-only and needs neither GitHub enablement nor confirmation", () => {
    const result = run(writeCampaign("acme"), "acme/operon-eval-preview-only");
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).mode).toBe("preview");
  });
  it("honest failure rejects a non-allowlisted owner before any GitHub command", () => {
    const result = run(writeCampaign("acme"), "other/operon-eval-l4-test");
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("github_owner_not_allowlisted");
  });
  it("J-MAN-02 refuses candidate drift before the first authorized GitHub command", () => {
    const result = run(writeCampaign("acme"), "acme/operon-eval-l4-test", true);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("prepared_candidate_drift");
    expect(`${result.stdout}${result.stderr}`).not.toContain("gh repo");
  });

  it("persists an immutable receipt for the verified idempotent rerun", () => {
    const dir = mkdtempSync(join(tmpdir(), "operon-github-idempotence-")); dirs.push(dir);
    const sourceEvidencePath = join(dir, "github-evidence-deadbeef.json");
    const path = join(dir, "github-idempotence-deadbeef.json");
    writeFileSync(sourceEvidencePath, '{"result":"passed"}\n');
    const options = {
      path,
      campaignId: "campaign",
      campaignSha256: `sha256:${"a".repeat(64)}`,
      repo: "acme/operon-eval-l4-test",
      repositoryId: "R_fixture",
      sourceEvidencePath,
      sourceEvidenceName: "github-evidence-deadbeef.json",
      verification: {
        issue_closed: true,
        pr_merged: true,
        review_count: 1,
        comment_count: 1,
        branch_deleted: true,
      },
    } as const;

    const first = persistGitHubIdempotenceEvidence(options);
    expect(first).toMatchObject({ idempotent_rerun: true, reused_evidence: true, result: "passed" });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(first);
    expect(persistGitHubIdempotenceEvidence(options)).toEqual(first);

    writeFileSync(sourceEvidencePath, '{"result":"changed"}\n');
    expect(() => persistGitHubIdempotenceEvidence(options)).toThrow("github_idempotence_evidence_conflict");
  });
});

function writeCampaign(owner: string): string {
  const dir = mkdtempSync(join(tmpdir(), "operon-github-preview-")); dirs.push(dir);
  const digest = `sha256:${"a".repeat(64)}`;
  const campaign: CampaignManifest = { schema_version: 1, campaign_id: "l4-preview", purpose: "fixture", owner: "fixture", created_at: "2026-07-12T00:00:00.000Z", intent: "non_qualification", candidate: { commit: "fixture", package_sha256: digest, suite_sha256: digest }, org_fingerprint: digest, system_fingerprint: digest, cases: [{ case_id: "quick/ignore-config/v1", repetition_ids: ["r1"] }], assignments: [{ role: "builder", runtime: "codex", model: "fixture", effort: "low", capability_ref: "codex/v1" }], price_catalog_id: "prices/2026-07-12-v1", randomization_seed: "fixed", github: { owner, repo_pattern: "operon-eval-*" }, spend: { campaign_max_usd: 1, case_max_usd: { "quick/ignore-config/v1": 1 } }, infrastructure_retries: 0, exclusions: [], stop_rules: ["safety"], operator_fixture: "operator-fixtures/fixture-v1.yaml", evidence_dir: "artifacts/l4-preview" };
  const path = join(dir, "campaign.yaml"); writeFileSync(path, stringify(campaign)); return path;
}
function run(campaign: string, repo: string, execute = false) {
  return spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts/eval/github.ts"), "--campaign", campaign, "--repo", repo, ...(execute ? ["--execute", "--confirm", "l4-preview"] : [])], { cwd: root, env: { ...process.env, ...(execute ? { OPERON_EVAL_GITHUB: "1" } : {}) }, encoding: "utf8" });
}
