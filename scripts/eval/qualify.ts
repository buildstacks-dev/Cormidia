import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashFile, hashManifest, loadYamlFile, qualify, validateCampaign, type AttemptResult, type CampaignManifest, type QualificationSupplementalEvidence } from "./core.js";
import { renderQualificationHtml } from "./report.js";
import { validateLearningPairEvidence, type LearningPairEvidence } from "./learning-evidence.js";
import { verifyLearningPairFiles } from "./learning-activation-core.js";

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
const campaignRoot = join(root, ".eval-artifacts", id);
const results = existsSync(resultDir) ? readdirSync(resultDir).filter((name) => name.endsWith(".json")).sort().map((name) => validateEvidenceFiles(JSON.parse(readFileSync(join(resultDir, name), "utf8")) as AttemptResult, campaignRoot)) : [];
const supplemental: QualificationSupplementalEvidence = {};
const pairPath = join(campaignRoot, "artifact", "learning-pairs.json");
const governancePath = join(campaignRoot, "artifact", "learning-governance.json");
if (existsSync(pairPath)) {
  const value = JSON.parse(readFileSync(pairPath, "utf8")) as Record<string, unknown>;
  supplemental.learning_pairs = { value, sha256: `sha256:${hashFile(pairPath)}` };
  const pairErrors = validateLearningPairEvidence(value, campaign, campaignSha256);
  try { verifyLearningPairFiles(campaignRoot, value as unknown as LearningPairEvidence); }
  catch (error) { pairErrors.push(error instanceof Error ? error.message : String(error)); }
  if (pairErrors.length > 0) supplemental.validation_errors = pairErrors;
}
if (existsSync(governancePath)) supplemental.learning_governance = { value: JSON.parse(readFileSync(governancePath, "utf8")) as Record<string, unknown>, sha256: `sha256:${hashFile(governancePath)}` };
const qualification = qualify(campaign, campaignSha256, results, supplemental);
const html = option("--html");
if (html) writeStable(resolve(html), renderQualificationHtml(qualification));
const jsonOut = option("--json-out");
if (jsonOut) writeStable(resolve(jsonOut), `${JSON.stringify(qualification, null, 2)}\n`);
console.log(JSON.stringify(qualification, null, 2));

function option(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
function validateEvidenceFiles(result: AttemptResult, campaignRoot: string): AttemptResult {
  const missing = [...result.missing];
  for (const ref of result.evidence) {
    const match = /^(artifact|grader|accounting):(.+)$/.exec(ref);
    if (!match) continue;
    const path = resolve(campaignRoot, match[2]!);
    const rel = relative(campaignRoot, path);
    if (isAbsolute(match[2]!) || rel.startsWith("..") || !existsSync(path)) missing.push(`missing_evidence:${ref}`);
  }
  for (const ref of result.evidence) if (ref.startsWith("run:") && !findNamedDirectory(join(campaignRoot, "state", "runs"), ref.slice(4))) missing.push(`missing_evidence:${ref}`);
  return { ...result, missing: [...new Set(missing)].sort() };
}
function findNamedDirectory(root: string, name: string): boolean { if (!existsSync(root)) return false; const visit = (dir: string): boolean => readdirSync(dir, { withFileTypes: true }).some((entry) => entry.isDirectory() && (entry.name === name || visit(join(dir, entry.name)))); return visit(root); }
function writeStable(path: string, bytes: string): void {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== bytes) throw new Error(`qualification_output_conflict:${path}`);
    return;
  }
  writeFileSync(path, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
}
