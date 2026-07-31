import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupCampaignPlan, executeCleanup } from "./evidence.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."); const campaignId = option("--campaign"); if (!campaignId || !/^[a-zA-Z0-9_-]+$/.test(campaignId)) throw new Error("usage: pnpm eval:cleanup -- --campaign <id> [--execute --confirm <id>]");
const campaignRoot = join(root, ".eval-artifacts", campaignId); const plan = cleanupCampaignPlan(campaignRoot, campaignId); const execute = process.argv.includes("--execute"); const output = { schema_version: 1, mode: execute ? "execute" : "preview", campaign_id: campaignId, ...plan, github_repository_deleted: false };
if (!execute) console.log(JSON.stringify(output, null, 2));
else { if (option("--confirm") !== campaignId) throw new Error("cleanup_confirmation_mismatch"); console.log(JSON.stringify({ ...output, removed: executeCleanup(plan, campaignRoot) }, null, 2)); }
function option(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
