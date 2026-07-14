import { resolve } from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadYamlFile, validateCampaign, type CampaignManifest } from "./core.js";
import { archiveCampaignEvidence } from "./evidence.js";

const input = option("--campaign"); const outRoot = option("--out");
if (!input || !outRoot) throw new Error("usage: pnpm eval:archive -- --campaign <prepared-file> --out <archive-root>");
const manifestPath = resolve(input); const campaign = loadYamlFile(manifestPath) as CampaignManifest; const errors = validateCampaign(campaign); if (errors.length > 0) throw new Error(`invalid_campaign: ${errors.join("; ")}`);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."); const result = archiveCampaignEvidence({ campaign, campaignRoot: join(root, ".eval-artifacts", campaign.campaign_id), outRoot: resolve(outRoot) });
console.log(JSON.stringify({ schema_version: 2, archive_kind: result.manifest.archive_kind, policy_version: result.manifest.policy_version, campaign_id: campaign.campaign_id, destination: result.destination, files: Object.keys(result.manifest.files).length, excluded_roots: result.manifest.excluded_roots, campaign_sha256: result.manifest.campaign_sha256 }, null, 2));
function option(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
