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
import {
  assertDevelopmentAdmission,
  assertDevelopmentAuthorization,
  lineageEquivalentCost,
  loadDevelopmentAuthorization,
  type DevelopmentAuthorizationGrant,
} from "./development-authorization.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = option("--campaign"); if (!manifestPath) throw new Error("usage: pnpm eval:live -- --campaign <prepared-file> --max-usd <n> --confirm <campaign-id> [--authorization <grant-file>] [--execute]");
const manifest = loadYamlFile(resolve(manifestPath)) as CampaignManifest; const errors = validateCampaign(manifest); if (errors.length > 0) throw new Error(`invalid_campaign: ${errors.join("; ")}`);
const maxUsdRaw = option("--max-usd"); const maxUsd = maxUsdRaw === undefined ? undefined : Number(maxUsdRaw); const execute = process.argv.includes("--execute");
const authorizationPath = option("--authorization");
let authorization: DevelopmentAuthorizationGrant | undefined;
if (authorizationPath !== undefined) authorization = loadDevelopmentAuthorization(resolve(authorizationPath));
if (authorization !== undefined) assertDevelopmentAuthorization(manifest, authorization);
if (manifest.development_authorization !== undefined && authorization === undefined && execute) throw new Error("development_authorization_file_required");
if (manifest.development_authorization === undefined && authorization !== undefined) throw new Error("campaign_development_authorization_missing");
const developmentAdmission = authorization === undefined ? null : assertDevelopmentAdmission(root, manifest, authorization);
const lineage = authorization === undefined ? undefined : lineageEquivalentCost(root, authorization, manifest.campaign_id);
const declaredRepetitions = manifest.cases.flatMap((item) => item.repetition_ids.map((repetitionId) => ({ caseId: item.case_id, repetitionId })));
const baseTurns = declaredRepetitions.reduce((sum, item) => sum + routeTurns(item.caseId, item.repetitionId), 0);
const retryTurns = manifest.infrastructure_retries * Math.max(...declaredRepetitions.map((item) => routeTurns(item.caseId, item.repetitionId)), 0);
const githubExerciseRequired = manifest.profile !== "focused-admission";
const preview = { schema_version: 1, mode: execute ? "execute" : "preview", campaign_id: manifest.campaign_id, campaign_sha256: hashManifest(manifest), candidate: manifest.candidate, org_fingerprint: manifest.org_fingerprint, system_fingerprint: manifest.system_fingerprint, development_authorization: manifest.development_authorization ?? null, development_admission: developmentAdmission, authorization_mode: manifest.development_authorization ? "standing-objective" : "exact-campaign", billing_mode: manifest.development_authorization?.billing_mode ?? "unknown", lineage_equivalent_cost: lineage ?? null, max_usd: manifest.spend.campaign_max_usd, campaign_equivalent_cost_ceiling_usd: manifest.spend.campaign_max_usd, github: manifest.github, github_target: githubExerciseRequired ? `${manifest.github.owner}/operon-eval-${manifest.campaign_id}` : null, github_exercise_required: githubExerciseRequired, assignments: manifest.assignments, learning_treatment: manifest.learning_treatment ?? null, learning_efficacy: manifest.learning_efficacy ?? null, route_budget_overrides: manifest.route_budget_overrides ?? null, readiness_required: [...new Set(manifest.assignments.map((assignment) => assignment.runtime))].sort(), ordered_cases: manifest.cases, base_product_turn_upper_bound: baseTurns, infrastructure_retry_turn_upper_bound: retryTurns, expected_product_turn_upper_bound: baseTurns + retryTurns, infrastructure_retries: manifest.infrastructure_retries, retry_rule: "at most one typed transient provider/GitHub infrastructure retry; merit failures are never retried and the original remains counted", stop_rules: manifest.stop_rules, evaluator_turns_reported_separately: true, post_campaign_learning_activation: manifest.learning_treatment ? "separate exact candidate/action-hash authorization required after all three pairs" : null };
if (!execute) { console.log(JSON.stringify(preview, null, 2)); process.exit(0); }
assertLiveConfirmation({ envEnabled: process.env.OPERON_EVAL_LIVE === "1", campaignId: manifest.campaign_id, confirmedId: option("--confirm"), ...(maxUsd !== undefined ? { requestedMaxUsd: maxUsd } : {}), manifestMaxUsd: manifest.spend.campaign_max_usd });
if (maxUsd === undefined) throw new Error("live_eval_max_usd_required");
if (lineage !== undefined && lineage.remaining_equivalent_cost_usd <= 0) throw new Error("development_authorization_equivalent_cost_exhausted");
const effectiveMaxUsd = Math.min(maxUsd, lineage?.remaining_equivalent_cost_usd ?? maxUsd);
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
  if (githubExerciseRequired) {
    const githubEvidencePath = join(campaignRoot, `github-evidence-${campaignSha256.slice(7, 15)}.json`);
    if (!existsSync(githubEvidencePath)) throw new Error("disposable_github_campaign_not_proven");
    const githubEvidence = JSON.parse(readFileSync(githubEvidencePath, "utf8")) as { campaign_id?: unknown; campaign_sha256?: unknown; result?: unknown };
    if (githubEvidence.campaign_id !== manifest.campaign_id || githubEvidence.campaign_sha256 !== campaignSha256 || githubEvidence.result !== "passed") throw new Error("invalid_disposable_github_evidence");
  }
  return executeLiveCampaign({
    root,
    manifestPath: resolve(manifestPath),
    maxUsd: effectiveMaxUsd,
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
function routeTurns(caseId: string, repetitionId: string): number { if (caseId.startsWith("adapter/calibration/")) return 7; if (caseId.startsWith("quick/") || (caseId.startsWith("planning/") && repetitionId === "goal-quick")) return 3; if (caseId.startsWith("deep/") || caseId.startsWith("approval/") || (caseId.startsWith("planning/") && repetitionId === "goal-deep")) return 8; if (caseId.startsWith("standard/") || caseId.startsWith("planning/") || caseId.startsWith("context/") || caseId.startsWith("continuation/") || caseId.startsWith("roles/")) return 5; if (caseId.startsWith("learning/")) return 3; return 0; }
function persistReadiness(results: unknown, result: "passed" | "failed"): void { mkdirSync(campaignRoot, { recursive: true }); const path = join(campaignRoot, `readiness-${campaignSha256.slice(7, 15)}-${result}.json`); const value = { schema_version: 1, campaign_id: manifest.campaign_id, campaign_sha256: campaignSha256, checked_at: new Date().toISOString(), billable: false, result, adapters: results }; if (existsSync(path)) { const prior = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; if (prior.campaign_id !== manifest.campaign_id || prior.campaign_sha256 !== campaignSha256 || prior.result !== result) throw new Error("readiness_evidence_conflict"); return; } writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
