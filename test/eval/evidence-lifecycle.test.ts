import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { stringify } from "yaml";
import { archiveCampaignEvidence, cleanupCampaignPlan, executeCleanup } from "../../scripts/eval/evidence.js";
import type { CampaignManifest } from "../../scripts/eval/core.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("J-RPT-01 archives sanitized evidence with hashes and never copies provider credentials", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-evidence-")); roots.push(root); const campaignRoot = join(root, "campaign"); const archiveRoot = join(root, "archives");
  for (const dir of ["results", "grader", "state/runs/app/run-1", "world/node_modules", "world/.git", "provider-scratch/codex", "provider-scratch/claude", "provider-scratch/pi"]) mkdirSync(join(campaignRoot, dir), { recursive: true });
  writeFileSync(join(campaignRoot, "campaign.yaml"), stringify(campaign()));
  for (const file of ["campaign.lock.json", "github-idempotence-deadbeef.json", "results/a.json", "grader/a.json", "state/ledger.jsonl", "world/generated", "world/node_modules/cache", "world/.git/config"]) writeFileSync(join(campaignRoot, file), `${file}\n`);
  writeFileSync(join(campaignRoot, "world/secretish.js"), "const secret = process.env.AUTH_KEY;\n");
  for (const file of ["brief.md", "prompt.md", "output.md", "session.log", "events.jsonl", "envelope.json", "context-manifest.json"]) writeFileSync(join(campaignRoot, "state/runs/app/run-1", file), `raw-l3:${file}\n`);
  for (const file of ["provider-scratch/codex/auth.json", "provider-scratch/claude/.credentials.json", "provider-scratch/pi/auth.json"]) writeFileSync(join(campaignRoot, file), '{"token":"credential-canary-value"}\n');
  const archived = archiveCampaignEvidence({ campaign: campaign(), campaignRoot, outRoot: archiveRoot, now: new Date("2026-07-12T00:00:00Z") });
  expect(archived.manifest).toMatchObject({ schema_version: 2, archive_kind: "sanitized-evidence", policy_version: "sanitized-evidence/v3", excluded_roots: ["provider-scratch/**", "state/runs/**"], redacted_files: { "world/secretish.js": ["generic-assignment"] } });
  expect(Object.keys(archived.manifest.files)).toEqual(expect.arrayContaining(["github-idempotence-deadbeef.json", "results/a.json", "grader/a.json", "state/ledger.jsonl", "world/generated"]));
  expect(Object.keys(archived.manifest.files).some((path) => path.startsWith("provider-scratch/"))).toBe(false);
  expect(Object.keys(archived.manifest.files).some((path) => path.startsWith("state/runs/"))).toBe(false);
  expect(Object.keys(archived.manifest.files).some((path) => path.includes("node_modules") || path.includes(".git"))).toBe(false);
  expect(() => readFileSync(join(archived.destination, "provider-scratch/codex/auth.json"))).toThrow();
  expect(() => readFileSync(join(archived.destination, "state/runs/app/run-1/prompt.md"))).toThrow();
  expect(readFileSync(join(archived.destination, "world/secretish.js"), "utf8")).toBe("const [REDACTED:generic-assignment];\n");
  const manifest = JSON.parse(readFileSync(join(archived.destination, "archive-manifest.json"), "utf8"));
  expect(manifest.files["results/a.json"]).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(manifest.source_files["world/secretish.js"]).not.toBe(manifest.files["world/secretish.js"]);
  const plan = cleanupCampaignPlan(campaignRoot, campaign().campaign_id); expect(plan.removable).toEqual([join(campaignRoot, "world"), join(campaignRoot, "provider-scratch")]); expect(plan.archive_receipts).toHaveLength(1); executeCleanup(plan, campaignRoot);
  expect(readFileSync(join(campaignRoot, "results/a.json"), "utf8")).toContain("results/a.json"); expect(() => readFileSync(join(campaignRoot, "world/generated"))).toThrow();
});

it("J-RPT-01 rerun and failure cases refuse archive overwrite, symlink evidence, cleanup escape, and wrong confirmation at the CLI boundary", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-evidence-fail-")); roots.push(root); const campaignRoot = join(root, "campaign"); mkdirSync(campaignRoot); writeFileSync(join(campaignRoot, "campaign.yaml"), "x"); const out = join(root, "archive");
  archiveCampaignEvidence({ campaign: campaign(), campaignRoot, outRoot: out }); expect(() => archiveCampaignEvidence({ campaign: campaign(), campaignRoot, outRoot: out })).toThrow("archive_destination_exists");
  const unsafe = join(root, "unsafe"); mkdirSync(unsafe); symlinkSync(join(campaignRoot, "campaign.yaml"), join(unsafe, "link")); expect(() => archiveCampaignEvidence({ campaign: { ...campaign(), campaign_id: "unsafe" }, campaignRoot: unsafe, outRoot: out })).toThrow("archive_symlink_forbidden");
  expect(() => executeCleanup({ removable: [join(root, "outside")], archive_receipts: ["fixture"] }, campaignRoot)).toThrow("cleanup_path_escape");
  const unarchived = join(root, "unarchived"); mkdirSync(join(unarchived, "world"), { recursive: true }); const unarchivedPlan = cleanupCampaignPlan(unarchived, "unarchived"); expect(() => executeCleanup(unarchivedPlan, unarchived)).toThrow("cleanup_requires_verified_archive");
  const cli = spawnSync(process.execPath, ["--import", "tsx", "scripts/eval/cleanup.ts", "--campaign", "fixture-nonexistent", "--execute", "--confirm", "wrong"], { cwd: process.cwd(), encoding: "utf8" }); expect(cli.status).not.toBe(0); expect(`${cli.stdout}${cli.stderr}`).toContain("cleanup_confirmation_mismatch");
});

it("refuses secret-bearing retained evidence and rejects tampered or legacy archives for cleanup", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-evidence-security-")); roots.push(root);
  const secretRoot = join(root, "secret-campaign");
  mkdirSync(join(secretRoot, "results"), { recursive: true });
  writeFileSync(join(secretRoot, "campaign.yaml"), stringify(campaign()));
  writeFileSync(join(secretRoot, "campaign.lock.json"), "{}\n");
  writeFileSync(join(secretRoot, "results/a.json"), '{"api_key":"sk-abcdefghijklmnopqrstuvwxyz012345"}\n');
  expect(() => archiveCampaignEvidence({ campaign: campaign(), campaignRoot: secretRoot, outRoot: join(root, "archives") })).toThrow(/archive_secret_pattern_forbidden/);

  const campaignRoot = join(root, "campaign");
  mkdirSync(join(campaignRoot, "results"), { recursive: true });
  mkdirSync(join(campaignRoot, "world"), { recursive: true });
  writeFileSync(join(campaignRoot, "campaign.yaml"), stringify(campaign()));
  writeFileSync(join(campaignRoot, "campaign.lock.json"), "{}\n");
  writeFileSync(join(campaignRoot, "results/a.json"), "safe\n");
  writeFileSync(join(campaignRoot, "world/generated"), "safe\n");
  const archived = archiveCampaignEvidence({ campaign: campaign(), campaignRoot, outRoot: join(root, "archives") });
  writeFileSync(join(archived.destination, "results/a.json"), "tampered\n");
  expect(cleanupCampaignPlan(campaignRoot, campaign().campaign_id).archive_receipts).toHaveLength(0);
  expect(() => executeCleanup(cleanupCampaignPlan(campaignRoot, campaign().campaign_id), campaignRoot)).toThrow("cleanup_requires_verified_archive");

  writeFileSync(join(campaignRoot, "archive-receipt-deadbeef.json"), JSON.stringify({ schema_version: 1, campaign_id: campaign().campaign_id, destination: archived.destination }));
  expect(cleanupCampaignPlan(campaignRoot, campaign().campaign_id).archive_receipts).toHaveLength(0);
});

function campaign(): CampaignManifest { const digest = `sha256:${"a".repeat(64)}`; return { schema_version: 1, campaign_id: "fixture", purpose: "fixture", owner: "test", created_at: "2026-07-12T00:00:00Z", intent: "non_qualification", candidate: { commit: "x", package_sha256: digest, suite_sha256: digest }, org_fingerprint: digest, system_fingerprint: digest, cases: [{ case_id: "quick/x/v1", repetition_ids: ["r1"] }], assignments: [{ role: "builder", runtime: "codex", model: "gpt-5.5", effort: "low", capability_ref: "codex/v1" }], price_catalog_id: "prices/2026-07-12-v1", randomization_seed: "x", github: { owner: "x", repo_pattern: "operon-eval-*" }, spend: { campaign_max_usd: 1, case_max_usd: { "quick/x/v1": 1 } }, infrastructure_retries: 1, exclusions: [], stop_rules: ["hard_safety_violation", "campaign_cap_cannot_cover_remaining_case", "hidden_answer_leakage", "production_path_overlap"], operator_fixture: "x", evidence_dir: ".eval-artifacts/x" }; }
