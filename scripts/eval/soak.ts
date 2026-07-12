import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { hashManifest, loadYamlFile, validateCampaign, type CampaignManifest } from "./core.js";

const path = option("--campaign"); if (!path || !existsSync(resolve(path))) throw new Error("usage: pnpm eval:soak -- --campaign <prepared-file> [--execute --confirm <campaign-id>]");
const campaign = loadYamlFile(resolve(path)) as CampaignManifest; const errors = validateCampaign(campaign); if (errors.length > 0) throw new Error(`invalid_campaign: ${errors.join("; ")}`);
const nonSoak = campaign.cases.filter((item) => !item.case_id.startsWith("soak/")); if (nonSoak.length > 0) throw new Error(`soak_campaign_contains_non_soak_cases: ${nonSoak.map((item) => item.case_id).join(",")}`);
const execute = process.argv.includes("--execute");
const preview = { schema_version: 1, mode: execute ? "execute" : "preview", campaign_id: campaign.campaign_id, campaign_sha256: hashManifest(campaign), cases: campaign.cases, stop_rules: campaign.stop_rules, evidence_dir: campaign.evidence_dir };
if (!execute) console.log(JSON.stringify(preview, null, 2));
else {
  if (process.env.OPERON_EVAL_SOAK !== "1" || option("--confirm") !== campaign.campaign_id) throw new Error("soak_execution_not_confirmed");
  throw new Error("real_time_soak_requires_ratified_schedule_and_host_restart_plan");
}
function option(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
