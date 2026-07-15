import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { hashManifest, loadYamlFile, startCampaign, validateCampaign, verifyCampaignLock, type CampaignManifest } from "./core.js";
import { assertPreparedCandidate } from "./candidate-hash.js";
import { assertGitHubTarget } from "./safety.js";
import { persistGitHubIdempotenceEvidence } from "./github-evidence.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = option("--campaign");
const repoSlug = option("--repo");
const execute = process.argv.includes("--execute");
const confirm = option("--confirm");
if (!manifestPath || !repoSlug || !repoSlug.includes("/")) throw new Error("usage: pnpm eval:github -- --campaign <prepared-file> --repo <owner/operon-eval-name> [--execute --confirm <campaign-id>]");
const manifest = loadYamlFile(resolve(manifestPath)) as CampaignManifest;
const errors = validateCampaign(manifest);
if (errors.length > 0) throw new Error(`invalid_campaign: ${errors.join("; ")}`);
const [owner, repo] = repoSlug.split("/") as [string, string];
assertGitHubTarget({ owner, repo, isPrivate: true }, manifest.github);
const campaignSha256 = hashManifest(manifest);
const branch = `operon-eval/${campaignSha256.slice(7, 15)}`;
const labels = ["operon-eval", "operon-eval-ready", "operon-eval-complete"];
const preview = {
  schema_version: 1,
  mode: execute ? "execute" : "preview",
  campaign_id: manifest.campaign_id,
  campaign_sha256: campaignSha256,
  candidate: manifest.candidate,
  org_fingerprint: manifest.org_fingerprint,
  system_fingerprint: manifest.system_fingerprint,
  repo: repoSlug,
  branch,
  operations: [
    "create or verify exact private repository id/owner/name",
    "ensure campaign labels",
    "create or reuse campaign issue",
    "create branch and content-addressed commit",
    "push branch",
    "create pull request",
    "write issue and pull-request comments",
    "submit a non-approving review event",
    "squash merge",
    "close issue and delete branch",
    "verify cleanup and idempotent rerun",
    "retain evidence without deleting the repository",
  ],
  assignments: manifest.assignments,
  infrastructure_retries: manifest.infrastructure_retries,
  stop_rules: manifest.stop_rules,
};
if (!execute) { console.log(JSON.stringify(preview, null, 2)); process.exit(0); }
if (process.env.OPERON_EVAL_GITHUB !== "1") throw new Error("github_eval_env_not_enabled");
if (confirm !== manifest.campaign_id) throw new Error("github_eval_confirmation_mismatch");
assertPreparedCandidate(root, manifest);
const lockPath = join(root, ".eval-artifacts", manifest.campaign_id, "campaign.lock.json");
const lock = existsSync(lockPath) ? verifyCampaignLock(lockPath) : startCampaign(resolve(manifestPath), lockPath);
if (lock.campaign_id !== manifest.campaign_id || lock.campaign_sha256 !== campaignSha256) throw new Error("campaign_lock_identity_mismatch");

const meta = ensurePrivateRepository(repoSlug);
const [actualOwner, actualRepo] = meta.nameWithOwner.split("/") as [string, string];
assertGitHubTarget({ owner: actualOwner, repo: actualRepo, isPrivate: meta.isPrivate }, manifest.github);
if (!meta.defaultBranchRef?.name) throw new Error("github_default_branch_missing");
const evidenceName = `github-evidence-${campaignSha256.slice(7, 15)}.json`;
const evidencePath = join(root, ".eval-artifacts", manifest.campaign_id, evidenceName);
if (existsSync(evidencePath)) {
  const prior = JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
  if (prior.campaign_id !== manifest.campaign_id || prior.campaign_sha256 !== campaignSha256 || prior.repo !== repoSlug || prior.repository_id !== meta.id || prior.result !== "passed" || typeof prior.repository_id !== "string") throw new Error("github_evidence_conflict");
  const pr = Number(prior.pull_request);
  const issue = Number(prior.issue);
  const verified = verifyRemoteLifecycle(repoSlug, pr, issue, branch);
  const idempotenceName = `github-idempotence-${campaignSha256.slice(7, 15)}.json`;
  const idempotence = persistGitHubIdempotenceEvidence({
    path: join(root, ".eval-artifacts", manifest.campaign_id, idempotenceName),
    campaignId: manifest.campaign_id,
    campaignSha256,
    repo: repoSlug,
    repositoryId: prior.repository_id,
    sourceEvidencePath: evidencePath,
    sourceEvidenceName: evidenceName,
    verification: verified,
  });
  console.log(JSON.stringify({ ...prior, ...idempotence, idempotence_evidence: `artifact:${idempotenceName}` }, null, 2));
  process.exit(0);
}

for (const [name, color, description] of [
  [labels[0]!, "5319e7", "Operon disposable eval evidence"],
  [labels[1]!, "0e8a16", "Operon eval lifecycle ready"],
  [labels[2]!, "1d76db", "Operon eval lifecycle complete"],
] as const) gh(["label", "create", name, "--repo", repoSlug, "--color", color, "--description", description, "--force"]);

const issueTitle = `[operon-eval:${manifest.campaign_id}] full GitHub lifecycle`;
const existingIssues = JSON.parse(gh(["issue", "list", "--repo", repoSlug, "--state", "all", "--search", `\"${issueTitle}\" in:title`, "--json", "number,title,state,url"])) as Array<{ number: number; title: string; state: string; url: string }>;
const exactIssue = existingIssues.find((item) => item.title === issueTitle);
const issueUrl = exactIssue?.url ?? gh(["issue", "create", "--repo", repoSlug, "--title", issueTitle, "--body", `Campaign ${manifest.campaign_id}; full L4 mechanics only, no provider turn or product behavior.`, "--label", `${labels[0]},${labels[1]}`]);
const issueNumber = exactIssue?.number ?? Number(issueUrl.split("/").at(-1));
if (!Number.isInteger(issueNumber)) throw new Error("github_issue_number_missing");

const work = mkdtempSync(join(tmpdir(), "operon-eval-github-"));
let commitSha = "";
try {
  gh(["repo", "clone", repoSlug, work, "--", "--quiet"]);
  git(work, ["checkout", "-B", branch, `origin/${meta.defaultBranchRef.name}`]);
  const receipt = join(work, ".operon-eval", `${manifest.campaign_id}.json`);
  mkdirSync(dirname(receipt), { recursive: true });
  writeFileSync(receipt, `${JSON.stringify({ schema_version: 1, campaign_id: manifest.campaign_id, campaign_sha256: campaignSha256, repository_id: meta.id }, null, 2)}\n`, "utf8");
  git(work, ["add", receipt]);
  git(work, ["-c", "user.name=Operon Eval", "-c", "user.email=eval@operon.invalid", "-c", "commit.gpgsign=false", "commit", "-m", `test(eval): ${manifest.campaign_id} L4 lifecycle`]);
  commitSha = git(work, ["rev-parse", "HEAD"]);
  git(work, ["push", "--force-with-lease", "origin", `${branch}:${branch}`]);
} finally { rmSync(work, { recursive: true, force: true }); }

const prTitle = `[operon-eval:${manifest.campaign_id}] L4 lifecycle`;
const existingPrs = JSON.parse(gh(["pr", "list", "--repo", repoSlug, "--state", "all", "--head", branch, "--json", "number,title,state,url,mergedAt"])) as Array<{ number: number; title: string; state: string; url: string; mergedAt: string | null }>;
const exactPr = existingPrs.find((item) => item.title === prTitle);
const prUrl = exactPr?.url ?? gh(["pr", "create", "--repo", repoSlug, "--head", branch, "--base", meta.defaultBranchRef.name, "--title", prTitle, "--body", `Closes #${issueNumber}\n\nContent-addressed L4 mechanics for ${manifest.campaign_id}. No provider turn.`]);
const prNumber = exactPr?.number ?? Number(prUrl.split("/").at(-1));
if (!Number.isInteger(prNumber)) throw new Error("github_pr_number_missing");
gh(["issue", "comment", String(issueNumber), "--repo", repoSlug, "--body", `Branch \`${branch}\` pushed at \`${commitSha}\`; PR #${prNumber} opened.`]);
gh(["pr", "comment", String(prNumber), "--repo", repoSlug, "--body", `L4 comment evidence for campaign \`${manifest.campaign_id}\`.`]);
gh(["pr", "review", String(prNumber), "--repo", repoSlug, "--comment", "--body", "Scripted L4 review event: mechanics and containment verified; this is not product review approval."]);
gh(["pr", "merge", String(prNumber), "--repo", repoSlug, "--squash", "--delete-branch"]);
gh(["issue", "edit", String(issueNumber), "--repo", repoSlug, "--remove-label", labels[1]!, "--add-label", labels[2]!]);
const issueState = JSON.parse(gh(["issue", "view", String(issueNumber), "--repo", repoSlug, "--json", "state"])) as { state: string };
if (issueState.state === "OPEN") gh(["issue", "close", String(issueNumber), "--repo", repoSlug, "--reason", "completed"]);
const verified = verifyRemoteLifecycle(repoSlug, prNumber, issueNumber, branch);
const evidence = { ...preview, repository_id: meta.id, default_branch: meta.defaultBranchRef.name, labels, issue: issueNumber, issue_url: issueUrl, branch, commit: commitSha, push: true, pull_request: prNumber, pull_request_url: prUrl, issue_comment: true, pr_comment: true, review: true, squash_merge: true, cleanup: { issue_closed: verified.issue_closed, branch_deleted: verified.branch_deleted, repository_deleted: false }, idempotent_rerun: false, result: "passed" };
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
console.log(JSON.stringify(evidence, null, 2));

function verifyRemoteLifecycle(slug: string, pr: number, issue: number, head: string): { issue_closed: boolean; pr_merged: boolean; review_count: number; comment_count: number; branch_deleted: boolean } {
  const prState = JSON.parse(gh(["pr", "view", String(pr), "--repo", slug, "--json", "state,mergedAt,reviews,comments"])) as { state: string; mergedAt: string | null; reviews: unknown[]; comments: unknown[] };
  const issueState = JSON.parse(gh(["issue", "view", String(issue), "--repo", slug, "--json", "state"])) as { state: string };
  const branchRows = gh(["api", `repos/${slug}/git/matching-refs/heads/${encodeURIComponent(head)}`]);
  const branches = branchRows === "" ? [] : JSON.parse(branchRows) as unknown[];
  if (prState.mergedAt === null || prState.state !== "MERGED" || issueState.state !== "CLOSED" || prState.reviews.length < 1 || prState.comments.length < 1 || branches.length !== 0) throw new Error("github_lifecycle_verification_failed");
  return { issue_closed: true, pr_merged: true, review_count: prState.reviews.length, comment_count: prState.comments.length, branch_deleted: true };
}
function ensurePrivateRepository(slug: string): { id: string; nameWithOwner: string; isPrivate: boolean; defaultBranchRef: { name: string } } {
  type Meta = { id: string; nameWithOwner: string; isPrivate: boolean; defaultBranchRef: { name: string } | null };
  let meta: Meta | undefined;
  try { meta = JSON.parse(gh(["repo", "view", slug, "--json", "id,nameWithOwner,isPrivate,defaultBranchRef"])) as Meta; }
  catch (error) {
    const detail = error instanceof Error ? `${error.message}\n${String((error as Error & { stderr?: unknown }).stderr ?? "")}` : String(error);
    if (!/could not resolve to a repository|not found/i.test(detail)) throw error;
    gh(["repo", "create", slug, "--private", "--description", "Disposable retained Operon evaluation evidence; never a production repository"]);
    meta = JSON.parse(gh(["repo", "view", slug, "--json", "id,nameWithOwner,isPrivate,defaultBranchRef"])) as Meta;
  }
  const [actualOwner, actualRepo] = meta.nameWithOwner.split("/") as [string, string];
  assertGitHubTarget({ owner: actualOwner, repo: actualRepo, isPrivate: meta.isPrivate }, manifest.github);
  if (!meta.defaultBranchRef?.name) {
    const seed = mkdtempSync(join(tmpdir(), "operon-eval-github-seed-"));
    try {
      git(seed, ["init", "--initial-branch=main"]);
      const receipt = join(seed, ".operon-eval", "README.md"); mkdirSync(dirname(receipt), { recursive: true });
      writeFileSync(receipt, "# Operon evaluation repository\n\nRetained private evidence only. Never production.\n", "utf8");
      git(seed, ["add", receipt]);
      git(seed, ["-c", "user.name=Operon Eval", "-c", "user.email=eval@operon.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "chore: initialize eval repository"]);
      git(seed, ["remote", "add", "origin", `git@github.com:${slug}.git`]);
      git(seed, ["push", "-u", "origin", "main"]);
    } finally { rmSync(seed, { recursive: true, force: true }); }
    // GitHub can expose the pushed ref before defaultBranchRef catches up.
    // Make the intended default explicit, then re-read authoritative metadata
    // before any campaign labels/issues/PRs are created.
    gh(["repo", "edit", slug, "--default-branch", "main"]);
    meta = JSON.parse(gh(["repo", "view", slug, "--json", "id,nameWithOwner,isPrivate,defaultBranchRef"])) as Meta;
  }
  if (!meta.defaultBranchRef?.name) throw new Error("github_default_branch_missing");
  return { ...meta, defaultBranchRef: meta.defaultBranchRef };
}
function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function gh(args: string[]): string { return execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function git(cwd: string, args: string[]): string { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
