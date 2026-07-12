import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."); const campaignId = option("--campaign"); if (!campaignId || !/^[a-zA-Z0-9_-]+$/.test(campaignId)) throw new Error("usage: pnpm eval:cleanup -- --campaign <id> [--execute --confirm <id>]");
const campaignRoot = join(root, ".eval-artifacts", campaignId); const removable = [join(campaignRoot, "world"), join(campaignRoot, "provider-scratch")].filter(existsSync);
const preserved = ["campaign.yaml", "campaign.lock.json", "github-evidence-*.json", "results/", "report*.html"];
const execute = process.argv.includes("--execute"); const plan = { schema_version: 1, mode: execute ? "execute" : "preview", campaign_id: campaignId, removable, preserved, github_repository_deleted: false };
if (!execute) console.log(JSON.stringify(plan, null, 2));
else {
  if (option("--confirm") !== campaignId) throw new Error("cleanup_confirmation_mismatch");
  for (const path of removable) { if (!path.startsWith(`${campaignRoot}/`)) throw new Error("cleanup_path_escape"); rmSync(path, { recursive: true, force: false }); }
  console.log(JSON.stringify({ ...plan, removed: removable }, null, 2));
}
function option(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
