import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { verifyReleaseAttestation } from "../../scripts/eval/release-attestation.js";
import { executableSuiteHash, hashWorkingFiles, releasePackageHash } from "../../scripts/eval/candidate-hash.js";
import { canonicalJson, hashManifest, sha256, type CampaignManifest } from "../../scripts/eval/core.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

// ROOT-001. The changed-path check — the strongest integrity check in the
// release attestation — was guarded by `if (commitExists(root, candidate.commit))`
// and silently skipped whenever the candidate commit was absent, which is always
// true in a shallow CI checkout. Deleting git history therefore made the check
// pass. These are self-contained fixtures: a temp git repo, a hand-cut
// self-consistent attestation, and orphaning the commit to reproduce the shallow
// clone. Every git operation is confined to a temp dir.

interface Fixture {
  root: string;
  campaign: CampaignManifest;
  attestationPath: string;
  candidateCommit: string;
}

it("fails closed when the candidate commit is unavailable (ROOT-001 fail-open reproduction)", () => {
  const fixture = buildFixture();
  // Sanity: with the candidate commit present the attestation verifies.
  expect(() => verify(fixture)).not.toThrow();

  // Orphan the candidate commit exactly as a shallow CI checkout leaves it:
  // amend HEAD onto a new object, expire the reflog, and garbage-collect the
  // now-unreferenced original. commitExists then returns false.
  git(fixture.root, ["commit", "--amend", "--allow-empty", "-m", "orphan the qualified candidate"], {
    GIT_COMMITTER_DATE: "2020-01-01T00:00:00 +0000",
    GIT_AUTHOR_DATE: "2020-01-01T00:00:00 +0000",
  });
  git(fixture.root, ["reflog", "expire", "--expire=now", "--all"]);
  git(fixture.root, ["gc", "--prune=now"]);
  expect(commitPresent(fixture.root, fixture.candidateCommit)).toBe(false);

  // Pre-fix this SUCCEEDED (the guard skipped the check). Post-fix it must throw.
  expect(() => verify(fixture)).toThrow("release_attestation_candidate_commit_unavailable");
});

it("rejects an unallowlisted packaged-artifact change with the candidate commit present", () => {
  const fixture = buildFixture();
  // src/** is a source of the packaged artifact — changing it invalidates.
  writeFileSync(join(fixture.root, "src/index.ts"), "export const candidate = false;\n");
  expect(() => verify(fixture)).toThrow("release_attestation_changed_path_mismatch");
});

it("does not invalidate qualification on a non-packaged docs change", () => {
  const fixture = buildFixture();
  // The exact file whose docs-only addition broke main under the old rule.
  write(fixture.root, "docs/architecture/conceptual-overview.md", "docs-only change; not shipped in the package\n");
  expect(() => verify(fixture)).not.toThrow();
});

it("does not invalidate qualification on an untracked non-packaged file (review/**)", () => {
  const fixture = buildFixture();
  write(fixture.root, "review/notes.md", "reviewer scratch; never shipped\n");
  expect(() => verify(fixture)).not.toThrow();
});

it("governs a test-runner config change through the executable suite (ROOT-001 config-governance gap)", () => {
  const fixture = buildFixture();
  // vitest.config.ts ships in no package, so release_package_sha256 never sees
  // it. It selects and grades which tests run (its include/exclude), so if it
  // were also outside the executable suite an adversary could exclude the red
  // contract tests, the suite would report green, and this attestation would
  // still verify. Pre-fix it was outside both planes and this change was
  // SILENTLY IGNORED (verify SUCCEEDED). It is now part of the executable suite,
  // so any change to it fails closed against the qualified executable_suite_sha256.
  writeFileSync(join(fixture.root, "vitest.config.ts"), 'export default { test: { include: ["test/**/*.test.ts"], exclude: ["**/transformation/contracts/**"] } };\n');
  expect(() => verify(fixture)).toThrow("release_attestation_suite_mismatch");
});

function verify(fixture: Fixture): void {
  verifyReleaseAttestation({ root: fixture.root, path: fixture.attestationPath, campaign: fixture.campaign });
}

function buildFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "operon-release-attestation-")); roots.push(root);
  for (const [path, bytes] of [
    ["package.json", '{"name":"attestation-fixture","version":"1.0.0","files":["dist/**/*.js"],"packageManager":"pnpm@11.10.0","dependencies":{}}\n'],
    ["dist/cli.js", "export {};\n"],
    ["src/index.ts", "export const candidate = true;\n"],
    ["roles.yaml", "roles: []\n"],
    ["pipelines.yaml", "pipelines: []\n"],
    ["TASTE.md", "# Fixture\n"],
    ["prompts/pass.md", "fixture\n"],
    ["taste/builder.md", "fixture\n"],
    // A test-runner config: shipped in no package, but part of the executable
    // suite because it selects/grades which tests run (ROOT-001 follow-up).
    ["vitest.config.ts", 'export default { test: { include: ["test/**/*.test.ts"] } };\n'],
  ] as const) write(root, path, bytes);
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "qualified candidate"]);
  const candidateCommit = git(root, ["rev-parse", "HEAD"]).trim();

  const releaseHash = `sha256:${releasePackageHash(root)}`;
  const suiteHash = `sha256:${executableSuiteHash(root)}`;
  const orgFingerprint = `sha256:${hashWorkingFiles(root, ["roles.yaml", "pipelines.yaml", "prompts/", "TASTE.md", "taste/"])}`;
  const systemFingerprint = `sha256:${sha256("fixture-system")}`;
  const candidate: CampaignManifest["candidate"] = {
    commit: candidateCommit,
    package_sha256: `sha256:${hashWorkingFiles(root)}`,
    suite_sha256: `sha256:${sha256("fixture-suite")}`,
    release_package_sha256: releaseHash,
    executable_suite_sha256: suiteHash,
  };
  // verifyReleaseAttestation reads only campaign_id, candidate, org_fingerprint,
  // system_fingerprint (and hashManifest over the whole object). It does not call
  // validateCampaign, so a minimal but fully typed manifest is sufficient.
  const campaign: CampaignManifest = {
    schema_version: 1, campaign_id: "attestation-fixture", purpose: "fixture", owner: "test", created_at: "2026-07-17T00:00:00.000Z", intent: "qualification",
    candidate, org_fingerprint: orgFingerprint, system_fingerprint: systemFingerprint,
    cases: [], assignments: [], price_catalog_id: "prices/2026-07-12-v1", randomization_seed: "fixture", github: { owner: "fixture", repo_pattern: "operon-eval-*" }, spend: { campaign_max_usd: 375, case_max_usd: {} }, infrastructure_retries: 1, exclusions: [], stop_rules: [], operator_fixture: "operator-fixtures/fixture-v1.yaml", evidence_dir: ".eval-artifacts/attestation-fixture",
  };

  // A clean checkout at the candidate commit has nothing changed since it, so
  // promotion_files is empty. Every check before the changed-path check is made
  // self-consistent with the live working tree via the exported helpers.
  const promotionFiles: Record<string, string> = {};
  const attestation = {
    schema_version: 1 as const,
    evidence_kind: "phase6-evidence-only-release-equivalence" as const,
    candidate,
    org_fingerprint: orgFingerprint,
    system_fingerprint: systemFingerprint,
    campaigns: [{ campaign_id: campaign.campaign_id, campaign_sha256: hashManifest(campaign) }],
    release_package_sha256: releaseHash,
    executable_suite_sha256: suiteHash,
    promotion_files: promotionFiles,
    promotion_paths_sha256: `sha256:${sha256(canonicalJson(promotionFiles))}`,
  };
  const attestationPath = join(root, "research/evals/phase6-release-attestation.json");
  write(root, "research/evals/phase6-release-attestation.json", `${JSON.stringify(attestation, null, 2)}\n`);
  return { root, campaign, attestationPath, candidateCommit };
}

function commitPresent(root: string, commit: string): boolean {
  try { execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: root, stdio: "ignore" }); return true; }
  catch { return false; }
}

function git(cwd: string, args: string[], extraEnv: Record<string, string> = {}): string {
  return execFileSync("git", ["-c", "user.name=Eval", "-c", "user.email=eval@invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd, encoding: "utf8", env: { ...process.env, ...extraEnv },
  });
}

function write(root: string, relative: string, contents: string): void {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}
