import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashManifest, loadYamlFile, validateCampaign, type CampaignManifest } from "./core.js";
import { executeLearningActivation, learningActivationPreview } from "./learning-activation-core.js";
import { assertPreparedCandidate } from "./candidate-hash.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = option("--campaign");
if (!manifestPath) throw new Error("usage: pnpm eval:learning-activation -- --campaign <prepared-file> [--execute --confirm-campaign <id> --confirm-candidate <sha256> --confirm-action <sha256>]");
const campaign = loadYamlFile(resolve(manifestPath)) as CampaignManifest;
const errors = validateCampaign(campaign);
if (errors.length > 0) throw new Error(`invalid_campaign:${errors.join(";")}`);
const campaignSha256 = hashManifest(campaign);
const campaignRoot = join(root, ".eval-artifacts", campaign.campaign_id);
const preview = learningActivationPreview({ repositoryRoot: root, campaign, campaignSha256, campaignRoot });
const execute = process.argv.includes("--execute");
const output = { schema_version: 1, mode: execute ? "execute" : "preview", campaign_id: campaign.campaign_id, campaign_sha256: campaignSha256, candidate_commit: campaign.candidate.commit, candidate_package_sha256: campaign.candidate.release_package_sha256 ?? campaign.candidate.package_sha256, learning_candidate_sha256: preview.candidate_sha256, pair_evidence_sha256: preview.pair_evidence_sha256, pair_outcome: preview.pair_evidence.outcome, action: preview.action, action_sha256: preview.action_sha256, authorization_boundary: "separate from GitHub mutation and L5 provider spend; exact campaign, candidate, and action hashes are all required", effects: { provider_turns: 0, github_mutations: 0, production_mutations: 0, outward_effects: 0, isolated_activation_count: 1, isolated_rollback_count: 1 } };
if (!execute) { console.log(JSON.stringify(output, null, 2)); process.exit(0); }
if (process.env.OPERON_EVAL_LEARNING_ACTIVATION !== "1") throw new Error("learning_activation_environment_confirmation_required");
assertPreparedCandidate(root, campaign);
if (option("--confirm-campaign") !== campaign.campaign_id) throw new Error("learning_activation_campaign_confirmation_mismatch");
if (option("--confirm-candidate") !== preview.candidate_sha256) throw new Error("learning_activation_candidate_confirmation_mismatch");
if (option("--confirm-action") !== preview.action_sha256) throw new Error("learning_activation_action_confirmation_mismatch");
const receipt = await executeLearningActivation({ repositoryRoot: root, campaign, campaignSha256, campaignRoot, actionSha256: preview.action_sha256, candidateSha256: preview.candidate_sha256 });
const path = join(campaignRoot, "artifact", "learning-governance.json");
mkdirSync(dirname(path), { recursive: true });
const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
if (existsSync(path)) {
  if (readFileSync(path, "utf8") !== bytes) throw new Error("learning_activation_receipt_conflict");
} else writeFileSync(path, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ ...output, receipt, receipt_path: path }, null, 2));

function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
