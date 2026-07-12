import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, openSync, readFileSync, closeSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { hashTree, loadYamlFile, sha256, validateCampaign, type CampaignManifest } from "./core.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const templateId = option("--campaign"); const githubOwner = option("--github-owner");
if (!templateId || !githubOwner) throw new Error("usage: pnpm eval:prepare -- --campaign <template-id> --github-owner <owner>");
const template = loadYamlFile(join(root, "eval/campaigns", `${templateId}.yaml`)) as CampaignManifest;
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
const packageSha256 = `sha256:${hashWorkingFiles(root)}`;
const suiteSha256 = `sha256:${sha256([hashTree(join(root, "eval")), hashTree(join(root, "scripts/eval")), hashTree(join(root, "test/eval")), hashTree(join(root, "test/transformation")), hashTree(join(root, "test/efficiency"))].join("\n"))}`;
const preparedId = `${template.campaign_id}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${suiteSha256.slice(7, 15)}`;
const campaign: CampaignManifest = {
  ...template,
  campaign_id: preparedId,
  created_at: new Date().toISOString(),
  candidate: {
    commit: dirty === "" ? commit : `${commit}+dirty`,
    package_sha256: packageSha256,
    suite_sha256: suiteSha256,
  },
  org_fingerprint: `sha256:${hashWorkingFiles(root, ["roles.yaml", "pipelines.yaml", "prompts/", "TASTE.md", "taste/"])}`,
  system_fingerprint: `sha256:${sha256(`${process.version}\0${process.platform}\0${process.arch}`)}`,
  github: { ...template.github, owner: githubOwner },
  evidence_dir: `.eval-artifacts/${preparedId}`,
};
const errors = validateCampaign(campaign); if (errors.length > 0) throw new Error(`invalid_prepared_campaign: ${errors.join("; ")}`);
const out = join(root, ".eval-artifacts", campaign.campaign_id, "campaign.yaml"); mkdirSync(dirname(out), { recursive: true });
let fd: number; try { fd = openSync(out, "wx", 0o600); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("prepared_campaign_already_exists"); throw error; }
try { writeFileSync(fd, stringify(campaign), "utf8"); } finally { closeSync(fd); }
console.log(JSON.stringify({ schema_version: 1, campaign_id: campaign.campaign_id, manifest: out, candidate: campaign.candidate, github: campaign.github, max_usd: campaign.spend.campaign_max_usd, ordered_cases: campaign.cases }, null, 2));

function option(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
function hashWorkingFiles(cwd: string, prefixes: string[] = []): string {
  const names = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd, encoding: "buffer", maxBuffer: 20 * 1024 * 1024 }).toString("utf8").split("\0").filter(Boolean).filter((name) => prefixes.length === 0 || prefixes.some((prefix) => prefix.endsWith("/") ? name.startsWith(prefix) : name === prefix)).sort();
  const chunks = names.map((name) => { const stat = lstatSync(join(cwd, name)); if (!stat.isFile()) throw new Error(`candidate_special_file_forbidden: ${name}`); return `${name}\0${stat.mode & 0o111 ? "x" : "-"}\0${sha256(readFileSync(join(cwd, name)))}`; });
  return sha256(chunks.join("\n"));
}
