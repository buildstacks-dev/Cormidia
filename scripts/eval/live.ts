import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashManifest, loadYamlFile, startCampaign, validateCampaign, verifyCampaignLock, type CampaignManifest } from "./core.js";
import { assertEvalSeparation, assertLiveConfirmation } from "./safety.js";
import { executeLiveCampaign } from "./live-executor.js";
import { CampaignReadinessError, checkCampaignReadiness } from "./readiness.js";
import { assertPreparedCandidate } from "./candidate-hash.js";
import { probeRuntimeReadiness } from "../../src/runtime/readiness.js";
import {
  prepareEvalProviderScratch,
  withEvalProviderEnvironment,
} from "./provider-scratch.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = option("--campaign"); if (!manifestPath) throw new Error("usage: pnpm eval:live -- --campaign <prepared-file> --max-usd <n> --confirm <campaign-id> [--execute]");
const manifest = loadYamlFile(resolve(manifestPath)) as CampaignManifest; const errors = validateCampaign(manifest); if (errors.length > 0) throw new Error(`invalid_campaign: ${errors.join("; ")}`);
const maxUsdRaw = option("--max-usd"); const maxUsd = maxUsdRaw === undefined ? undefined : Number(maxUsdRaw); const execute = process.argv.includes("--execute");
const baseTurns = manifest.cases.reduce((sum, item) => sum + item.repetition_ids.length * routeTurns(item.case_id), 0);
const retryTurns = manifest.infrastructure_retries * Math.max(...manifest.cases.map((item) => routeTurns(item.case_id)), 0);
const preview = { schema_version: 1, mode: execute ? "execute" : "preview", campaign_id: manifest.campaign_id, campaign_sha256: hashManifest(manifest), max_usd: manifest.spend.campaign_max_usd, github: manifest.github, assignments: manifest.assignments, readiness_required: [...new Set(manifest.assignments.map((assignment) => assignment.runtime))].sort(), ordered_cases: manifest.cases, base_product_turn_upper_bound: baseTurns, infrastructure_retry_turn_upper_bound: retryTurns, expected_product_turn_upper_bound: baseTurns + retryTurns, evaluator_turns_reported_separately: true };
if (!execute) { console.log(JSON.stringify(preview, null, 2)); process.exit(0); }
assertLiveConfirmation({ envEnabled: process.env.OPERON_EVAL_LIVE === "1", campaignId: manifest.campaign_id, confirmedId: option("--confirm"), ...(maxUsd !== undefined ? { requestedMaxUsd: maxUsd } : {}), manifestMaxUsd: manifest.spend.campaign_max_usd });
if (maxUsd === undefined) throw new Error("live_eval_max_usd_required");
assertPreparedCandidate(root, manifest);
const campaignSha256 = hashManifest(manifest);
const campaignRoot = join(root, ".eval-artifacts", manifest.campaign_id);
const lockPath = join(campaignRoot, "campaign.lock.json");
const lock = existsSync(lockPath) ? verifyCampaignLock(lockPath) : startCampaign(resolve(manifestPath), lockPath);
if (lock.campaign_id !== manifest.campaign_id || lock.campaign_sha256 !== campaignSha256) throw new Error("campaign_lock_identity_mismatch");
const validation = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/eval/validate.ts"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as { valid?: unknown; failures?: unknown };
if (validation.valid !== true) throw new Error(`live_eval_preflight_invalid:${JSON.stringify(validation.failures)}`);
const evalRoot = resolve(campaignRoot, "world");
const forbiddenProductionPaths = [process.env.OPERON_ORG_HOME, process.env.OPERON_STATE_HOME].filter((path): path is string => typeof path === "string" && path !== "");
assertEvalSeparation(evalRoot, forbiddenProductionPaths);
// Pi OAuth refresh tokens rotate. Resolve them once in the source file-backed
// store before copying a fresh access credential into isolated scratch; doing
// the first refresh only in a copied store would invalidate the source token
// while leaving the user's real pi auth.json stale.
const piModels = [...new Set(manifest.assignments.filter((assignment) => assignment.runtime === "pi").map((assignment) => assignment.model))].sort();
if (piModels.length > 0) {
  const sourcePiReadiness = await probeRuntimeReadiness({ runtime: "pi", models: piModels });
  if (sourcePiReadiness.status !== "ready") {
    persistReadiness([sourcePiReadiness], "failed");
    throw new CampaignReadinessError([sourcePiReadiness]);
  }
}
const providerScratch = prepareEvalProviderScratch(campaignRoot);
const summary = await withEvalProviderEnvironment(providerScratch.processEnv, async () => {
  let readiness;
  const campaignProbe = (request: Parameters<typeof probeRuntimeReadiness>[0]) =>
    probeRuntimeReadiness({
      ...request,
      ...(request.runtime === "claude"
        ? { processEnv: providerScratch.claudeProcessEnv }
        : {}),
    });
  try { readiness = await checkCampaignReadiness(manifest, campaignProbe); }
  catch (error) {
    if (error instanceof CampaignReadinessError) {
      persistReadiness(error.results, "failed");
    }
    throw error;
  }
  persistReadiness(readiness, "passed");
  const githubEvidencePath = join(campaignRoot, `github-evidence-${campaignSha256.slice(7, 15)}.json`);
  if (!existsSync(githubEvidencePath)) throw new Error("disposable_github_campaign_not_proven");
  const githubEvidence = JSON.parse(readFileSync(githubEvidencePath, "utf8")) as { campaign_id?: unknown; campaign_sha256?: unknown; result?: unknown };
  if (githubEvidence.campaign_id !== manifest.campaign_id || githubEvidence.campaign_sha256 !== campaignSha256 || githubEvidence.result !== "passed") throw new Error("invalid_disposable_github_evidence");
  return executeLiveCampaign({
    root,
    manifestPath: resolve(manifestPath),
    maxUsd,
    evalRoot,
    forbiddenProductionPaths,
    expectedCampaignSha256: campaignSha256,
    claudeProcessEnv: providerScratch.claudeProcessEnv,
    ...(providerScratch.claudeProtectedHome !== undefined
      ? { claudeProtectedHome: providerScratch.claudeProtectedHome }
      : {}),
  });
});
console.log(JSON.stringify({ ...preview, result: summary }, null, 2));

function option(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
function routeTurns(caseId: string): number { if (caseId.startsWith("adapter/calibration/")) return 7; if (caseId.startsWith("quick/")) return 3; if (caseId.startsWith("deep/") || caseId.startsWith("approval/")) return 8; if (caseId.startsWith("standard/") || caseId.startsWith("planning/") || caseId.startsWith("context/") || caseId.startsWith("continuation/") || caseId.startsWith("roles/")) return 5; if (caseId.startsWith("learning/")) return 3; return 0; }
function persistReadiness(results: unknown, result: "passed" | "failed"): void { mkdirSync(campaignRoot, { recursive: true }); const path = join(campaignRoot, `readiness-${campaignSha256.slice(7, 15)}-${result}.json`); const value = { schema_version: 1, campaign_id: manifest.campaign_id, campaign_sha256: campaignSha256, checked_at: new Date().toISOString(), billable: false, result, adapters: results }; if (existsSync(path)) { const prior = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; if (prior.campaign_id !== manifest.campaign_id || prior.campaign_sha256 !== campaignSha256 || prior.result !== result) throw new Error("readiness_evidence_conflict"); return; } writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
