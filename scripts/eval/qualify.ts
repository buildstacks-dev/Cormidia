import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashManifest, loadYamlFile, qualify, validateCampaign, type AttemptResult, type CampaignManifest } from "./core.js";
import { renderQualificationHtml } from "./report.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const input = option("--campaign");
if (!input) throw new Error("usage: pnpm eval:qualify -- --campaign <id-or-prepared-file>");
const candidatePath = resolve(input);
const campaignPath = existsSync(candidatePath) ? candidatePath : join(root, "eval/campaigns", `${input}.yaml`);
if (!existsSync(campaignPath)) throw new Error(`campaign_not_found: ${input}`);
const raw = loadYamlFile(campaignPath);
const errors = validateCampaign(raw);
if (errors.length > 0) throw new Error(`invalid_campaign: ${errors.join("; ")}`);
const campaign = raw as CampaignManifest;
const id = campaign.campaign_id;
const campaignSha256 = hashManifest(campaign);
const resultDir = join(root, ".eval-artifacts", id, "results");
const campaignRoot = join(root, ".eval-artifacts", id);
const results = existsSync(resultDir) ? readdirSync(resultDir).filter((name) => name.endsWith(".json")).sort().map((name) => validateEvidenceFiles(JSON.parse(readFileSync(join(resultDir, name), "utf8")) as AttemptResult, campaignRoot)) : [];
const qualification = qualify(campaign, campaignSha256, results);
const html = option("--html");
if (html) writeFileSync(resolve(html), renderQualificationHtml(qualification), { encoding: "utf8", flag: "wx", mode: 0o600 });
console.log(JSON.stringify(qualification, null, 2));

function option(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
function validateEvidenceFiles(result: AttemptResult, campaignRoot: string): AttemptResult {
  const missing = [...result.missing];
  for (const ref of result.evidence) {
    const match = /^(artifact|grader):(.+)$/.exec(ref);
    if (!match) continue;
    const path = resolve(campaignRoot, match[2]!);
    const rel = relative(campaignRoot, path);
    if (isAbsolute(match[2]!) || rel.startsWith("..") || !existsSync(path)) missing.push(`missing_evidence:${ref}`);
  }
  for (const ref of result.evidence) if (ref.startsWith("run:") && !findNamedDirectory(join(campaignRoot, "state", "runs"), ref.slice(4))) missing.push(`missing_evidence:${ref}`);
  return { ...result, missing: [...new Set(missing)].sort() };
}
function findNamedDirectory(root: string, name: string): boolean { if (!existsSync(root)) return false; const visit = (dir: string): boolean => readdirSync(dir, { withFileTypes: true }).some((entry) => entry.isDirectory() && (entry.name === name || visit(join(dir, entry.name)))); return visit(root); }
