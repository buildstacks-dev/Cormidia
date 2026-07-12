import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
const results = existsSync(resultDir) ? readdirSync(resultDir).filter((name) => name.endsWith(".json")).sort().map((name) => JSON.parse(readFileSync(join(resultDir, name), "utf8")) as AttemptResult) : [];
const qualification = qualify(campaign, campaignSha256, results);
const html = option("--html");
if (html) writeFileSync(resolve(html), renderQualificationHtml(qualification), { encoding: "utf8", flag: "wx", mode: 0o600 });
console.log(JSON.stringify(qualification, null, 2));

function option(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
