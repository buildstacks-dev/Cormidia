import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashManifest, loadYamlFile, startCampaign, validateCampaign, verifyCampaignLock, type CampaignManifest } from "./core.js";
import { assertLiveConfirmation } from "./safety.js";
import { executeLiveCampaign } from "./live-executor.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = option("--campaign"); if (!manifestPath) throw new Error("usage: pnpm eval:live -- --campaign <prepared-file> --max-usd <n> --confirm <campaign-id> [--execute]");
const manifest = loadYamlFile(resolve(manifestPath)) as CampaignManifest; const errors = validateCampaign(manifest); if (errors.length > 0) throw new Error(`invalid_campaign: ${errors.join("; ")}`);
const maxUsdRaw = option("--max-usd"); const maxUsd = maxUsdRaw === undefined ? undefined : Number(maxUsdRaw); const execute = process.argv.includes("--execute");
const preview = { schema_version: 1, mode: execute ? "execute" : "preview", campaign_id: manifest.campaign_id, campaign_sha256: hashManifest(manifest), max_usd: manifest.spend.campaign_max_usd, github: manifest.github, assignments: manifest.assignments, ordered_cases: manifest.cases, expected_product_turn_upper_bound: manifest.cases.reduce((sum, item) => sum + item.repetition_ids.length * routeTurns(item.case_id), 0), evaluator_turns_reported_separately: true };
if (!execute) { console.log(JSON.stringify(preview, null, 2)); process.exit(0); }
assertLiveConfirmation({ envEnabled: process.env.OPERON_EVAL_LIVE === "1", campaignId: manifest.campaign_id, confirmedId: option("--confirm"), ...(maxUsd !== undefined ? { requestedMaxUsd: maxUsd } : {}), manifestMaxUsd: manifest.spend.campaign_max_usd });
if (maxUsd === undefined) throw new Error("live_eval_max_usd_required");
const campaignSha256 = hashManifest(manifest);
const githubEvidencePath = join(root, ".eval-artifacts", manifest.campaign_id, `github-evidence-${campaignSha256.slice(7, 15)}.json`);
if (!existsSync(githubEvidencePath)) throw new Error("disposable_github_campaign_not_proven");
const githubEvidence = JSON.parse(readFileSync(githubEvidencePath, "utf8")) as { campaign_id?: unknown; campaign_sha256?: unknown; result?: unknown };
if (githubEvidence.campaign_id !== manifest.campaign_id || githubEvidence.campaign_sha256 !== campaignSha256 || githubEvidence.result !== "passed") throw new Error("invalid_disposable_github_evidence");
const lockPath = join(root, ".eval-artifacts", manifest.campaign_id, "campaign.lock.json");
if (existsSync(lockPath)) verifyCampaignLock(lockPath); else startCampaign(resolve(manifestPath), lockPath);
const evalRoot = resolve(root, ".eval-artifacts", manifest.campaign_id, "world");
const summary = await executeLiveCampaign({ root, manifestPath: resolve(manifestPath), maxUsd, evalRoot });
console.log(JSON.stringify({ ...preview, result: summary }, null, 2));

function option(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
function routeTurns(caseId: string): number { if (caseId.startsWith("quick/")) return 3; if (caseId.startsWith("standard/")) return 5; if (caseId.startsWith("deep/")) return 8; return 0; }
