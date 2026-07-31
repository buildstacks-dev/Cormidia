import { mkdirSync, openSync, closeSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { hashManifest, loadYamlFile, validateCampaign, type CampaignManifest } from "./core.js";
import { candidateIdentity, currentCandidateSnapshot } from "./candidate-hash.js";
import { bindDevelopmentAuthorization, loadDevelopmentAuthorization } from "./development-authorization.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const templateId = option("--campaign"); const githubOwner = option("--github-owner"); const authorizationPath = option("--authorization");
if (!templateId || !githubOwner) throw new Error("usage: pnpm eval:prepare -- --campaign <template-id> --github-owner <owner> [--authorization <grant-file>]");
const template = loadYamlFile(join(root, "eval/campaigns", `${templateId}.yaml`)) as CampaignManifest;
const authorization = authorizationPath === undefined ? undefined : loadDevelopmentAuthorization(resolve(authorizationPath));
if (authorization && authorization.github.owner !== githubOwner) throw new Error("development_authorization_github_owner_mismatch");
const snapshot = currentCandidateSnapshot(root);
const preparedId = `${template.campaign_id}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${candidateIdentity(snapshot)}`;
const campaign: CampaignManifest = {
  ...template,
  campaign_id: preparedId,
  created_at: new Date().toISOString(),
  candidate: {
    commit: snapshot.commit,
    package_sha256: snapshot.package_sha256,
    suite_sha256: snapshot.suite_sha256,
    ...(snapshot.release_package_sha256 !== undefined ? { release_package_sha256: snapshot.release_package_sha256 } : {}),
    ...(snapshot.executable_suite_sha256 !== undefined ? { executable_suite_sha256: snapshot.executable_suite_sha256 } : {}),
  },
  org_fingerprint: snapshot.org_fingerprint,
  system_fingerprint: snapshot.system_fingerprint,
  github: { ...template.github, owner: githubOwner },
  ...(authorization === undefined ? {} : { development_authorization: bindDevelopmentAuthorization(authorization, template.campaign_id) }),
  evidence_dir: `.eval-artifacts/${preparedId}`,
};
const errors = validateCampaign(campaign); if (errors.length > 0) throw new Error(`invalid_prepared_campaign: ${errors.join("; ")}`);
const out = join(root, ".eval-artifacts", campaign.campaign_id, "campaign.yaml"); mkdirSync(dirname(out), { recursive: true });
let fd: number; try { fd = openSync(out, "wx", 0o600); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("prepared_campaign_already_exists"); throw error; }
try { writeFileSync(fd, stringify(campaign), "utf8"); } finally { closeSync(fd); }
console.log(JSON.stringify({ schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: hashManifest(campaign), manifest: out, candidate: campaign.candidate, org_fingerprint: campaign.org_fingerprint, system_fingerprint: campaign.system_fingerprint, development_authorization: campaign.development_authorization ?? null, github: campaign.github, github_target: `${campaign.github.owner}/operon-eval-${campaign.campaign_id}`, assignments: campaign.assignments, learning_treatment: campaign.learning_treatment ?? null, learning_efficacy: campaign.learning_efficacy ?? null, max_usd: campaign.spend.campaign_max_usd, campaign_equivalent_cost_ceiling_usd: campaign.spend.campaign_max_usd, infrastructure_retries: campaign.infrastructure_retries, stop_rules: campaign.stop_rules, ordered_cases: campaign.cases }, null, 2));

function option(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
