import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calibrateCommittedGraders } from "../../eval/graders/index.js";
import { hashTree, loadYamlFile, validateCampaign, validateCase, validateContracts } from "./core.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const failures: string[] = [];
for (const name of readdirSync(join(root, "eval/schemas")).sort()) {
  if (extname(name) !== ".json") continue;
  try { JSON.parse(readFileSync(join(root, "eval/schemas", name), "utf8")); }
  catch (error) { failures.push(`schema ${name}: ${(error as Error).message}`); }
}
const contractsPath = join(root, "eval/contracts.yaml");
const contractsRaw = loadYamlFile(contractsPath);
for (const error of validateContracts(contractsRaw)) failures.push(`contracts.yaml: ${error}`);
const requirementIds = new Set(((contractsRaw as { contracts?: Array<{ id?: string }> }).contracts ?? []).flatMap((item) => typeof item.id === "string" ? [item.id] : []));
const casesByRequirement = new Map<string, string[]>();
scanYaml(join(root, "eval/cases"), (path, value) => {
  for (const error of validateCase(value)) failures.push(`${path}: ${error}`);
  const requirements = (value as { requirements?: unknown }).requirements;
  if (Array.isArray(requirements)) for (const id of requirements) if (typeof id === "string") {
    if (!requirementIds.has(id)) failures.push(`${path}: unknown requirement ${id}`);
    else casesByRequirement.set(id, [...(casesByRequirement.get(id) ?? []), String((value as { case_id?: unknown }).case_id ?? path)]);
  }
  const manifest = value as { episode?: { task_ref?: unknown }; oracle?: { hidden_grader?: unknown } };
  if (typeof manifest.episode?.task_ref === "string" && !existsSync(join(root, "eval", manifest.episode.task_ref))) failures.push(`${path}: missing task_ref ${manifest.episode.task_ref}`);
  if (typeof manifest.oracle?.hidden_grader === "string" && !existsSync(join(root, "eval", manifest.oracle.hidden_grader))) failures.push(`${path}: missing hidden_grader ${manifest.oracle.hidden_grader}`);
});
scanYaml(join(root, "eval/campaigns"), (path, value) => { for (const error of validateCampaign(value)) failures.push(`${path}: ${error}`); });
for (const app of ["sparse", "library", "service"]) {
  const manifestPath = join(root, "eval/apps", app, "manifest.yaml");
  const manifest = loadYamlFile(manifestPath) as { seed_tree_sha256?: unknown };
  const observed = hashTree(join(root, "eval/apps", app, "seed"));
  if (manifest.seed_tree_sha256 !== observed) failures.push(`${manifestPath}: seed_tree_sha256 expected ${observed}, got ${String(manifest.seed_tree_sha256)}`);
}
try { await calibrateCommittedGraders(join(root, "eval")); }
catch (error) { failures.push(`grader calibration: ${(error as Error).message}`); }
validateCorpora();
const contracts = (contractsRaw as { contracts?: Array<{ id: string; evidence: string }> }).contracts ?? [];
const traceability = contracts.map((contract) => ({ requirement: contract.id, cases: (casesByRequirement.get(contract.id) ?? []).sort(), evidence: contract.evidence }));
const orphaned = traceability.filter((item) => item.cases.length === 0 && item.evidence.trim() === "").map((item) => item.requirement);
for (const id of orphaned) failures.push(`orphaned requirement ${id}`);
console.log(JSON.stringify({ schema_version: 1, valid: failures.length === 0, traceability: { requirements: traceability.length, case_links: traceability.reduce((sum, item) => sum + item.cases.length, 0), orphaned }, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;

function scanYaml(dir: string, visit: (path: string, value: unknown) => void): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scanYaml(path, visit);
    else if (entry.isFile() && [".yaml", ".yml"].includes(extname(entry.name))) visit(path, loadYamlFile(path));
  }
}

function validateCorpora(): void {
  const routing = loadYamlFile(join(root, "eval/corpora/routing.yaml")) as { cases?: Array<{ id?: unknown; expected?: unknown }> };
  if (!Array.isArray(routing.cases) || routing.cases.length < 30) failures.push("routing corpus must contain at least 30 cases");
  const routeIds = new Set<string>();
  for (const item of routing.cases ?? []) {
    if (typeof item.id !== "string" || routeIds.has(item.id)) failures.push(`routing corpus duplicate/invalid id ${String(item.id)}`);
    else routeIds.add(item.id);
    if (!["quick", "standard", "deep"].includes(String(item.expected))) failures.push(`routing corpus ${String(item.id)} has invalid expected route`);
  }
  const actions = loadYamlFile(join(root, "eval/corpora/actions.yaml")) as { cases?: Array<{ id?: unknown; class?: unknown; near_miss?: unknown }> };
  const actionIds = new Set((actions.cases ?? []).flatMap((item) => typeof item.id === "string" ? [item.id] : []));
  for (const item of actions.cases ?? []) {
    if (!['critical', 'routine'].includes(String(item.class))) failures.push(`action corpus ${String(item.id)} has invalid class`);
    if (item.class === "critical" && (typeof item.near_miss !== "string" || !actionIds.has(item.near_miss))) failures.push(`action corpus ${String(item.id)} lacks a valid routine near_miss`);
  }
}
