import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashManifest, loadYamlFile, validateCampaign, type CampaignManifest } from "./core.js";
import { assertGitHubTarget } from "./safety.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = option("--campaign"); const repoSlug = option("--repo"); const execute = process.argv.includes("--execute"); const confirm = option("--confirm");
if (!manifestPath || !repoSlug || !repoSlug.includes("/")) throw new Error("usage: pnpm eval:github -- --campaign <prepared-file> --repo <owner/operon-eval-name> [--execute --confirm <campaign-id>]");
const manifest = loadYamlFile(resolve(manifestPath)) as CampaignManifest; const errors = validateCampaign(manifest); if (errors.length > 0) throw new Error(`invalid_campaign: ${errors.join("; ")}`);
const [owner, repo] = repoSlug.split("/") as [string, string]; assertGitHubTarget({ owner, repo, isPrivate: true }, manifest.github);
const preview = { schema_version: 1, mode: execute ? "execute" : "preview", campaign_id: manifest.campaign_id, repo: repoSlug, operations: ["verify private repo identity", "ensure operon-eval label", "create or reuse one campaign-owned probe issue", "close probe issue", "retain evidence"] };
if (!execute) { console.log(JSON.stringify(preview, null, 2)); process.exit(0); }
if (process.env.OPERON_EVAL_GITHUB !== "1") throw new Error("github_eval_env_not_enabled");
if (confirm !== manifest.campaign_id) throw new Error("github_eval_confirmation_mismatch");
const meta = gh(["repo", "view", repoSlug, "--json", "nameWithOwner,isPrivate"]); const parsed = JSON.parse(meta) as { nameWithOwner: string; isPrivate: boolean }; const [actualOwner, actualRepo] = parsed.nameWithOwner.split("/") as [string, string]; assertGitHubTarget({ owner: actualOwner, repo: actualRepo, isPrivate: parsed.isPrivate }, manifest.github);
gh(["label", "create", "operon-eval", "--repo", repoSlug, "--color", "5319e7", "--description", "Operon disposable eval evidence", "--force"]);
const title = `[operon-eval:${manifest.campaign_id}] substrate probe`;
const existing = JSON.parse(gh(["issue", "list", "--repo", repoSlug, "--state", "all", "--search", `\"${title}\" in:title`, "--json", "number,title,state"])) as Array<{ number: number; title: string; state: string }>;
const exact = existing.find((item) => item.title === title); const created = exact ? undefined : gh(["issue", "create", "--repo", repoSlug, "--title", title, "--body", `Campaign ${manifest.campaign_id}; no product behavior or provider turn.`, "--label", "operon-eval"]); const number = exact?.number ?? Number(created!.split("/").at(-1));
if (!exact || exact.state === "OPEN") gh(["issue", "close", String(number), "--repo", repoSlug, "--reason", "completed"]);
const campaignSha256 = hashManifest(manifest);
const evidence = { ...preview, campaign_sha256: campaignSha256, issue: number, result: "passed" }; const evidencePath = join(root, ".eval-artifacts", manifest.campaign_id, `github-evidence-${campaignSha256.slice(7, 15)}.json`); mkdirSync(dirname(evidencePath), { recursive: true });
if (existsSync(evidencePath)) {
  const prior = JSON.parse(readFileSync(evidencePath, "utf8")) as typeof evidence;
  if (prior.campaign_id !== evidence.campaign_id || prior.campaign_sha256 !== evidence.campaign_sha256 || prior.repo !== evidence.repo || prior.issue !== evidence.issue || prior.result !== "passed") throw new Error("github_evidence_conflict");
  console.log(JSON.stringify({ ...prior, reused_evidence: true }, null, 2));
} else {
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(evidence, null, 2));
}

function option(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
function gh(args: string[]): string { return execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
