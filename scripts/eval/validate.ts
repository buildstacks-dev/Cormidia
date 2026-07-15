import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calibrateCommittedGraders } from "../../eval/graders/index.js";
import { hashFile, hashTree, loadYamlFile, sha256, validateCampaign, validateCase, validateContracts } from "./core.js";

const root = resolve(option("--root") ?? resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const failures: string[] = [];
const REQUIRED_BENCHMARKS = [
  "LIFE-LEGACY-001", "ROUTE-CORPUS-001", "PLAN-QUALITY-001", "CTX-DELTA-001",
  "QUICK-CONFIG-001", "STANDARD-FEATURE-001", "DEEP-AUTH-MIGRATION-001",
  "CONTINUATION-MATRIX-001", "APPROVAL-SEMANTICS-001", "LEARNING-CLOSURE-001",
  "STANDING-ROLES-001", "SCHEDULER-SOAK-001",
] as const;
for (const name of readdirSync(join(root, "eval/schemas")).sort()) {
  if (extname(name) !== ".json") continue;
  try { JSON.parse(readFileSync(join(root, "eval/schemas", name), "utf8")); }
  catch (error) { failures.push(`schema ${name}: ${(error as Error).message}`); }
}
const contractsPath = join(root, "eval/contracts.yaml");
const contractsRaw = loadYamlFile(contractsPath);
for (const error of validateContracts(contractsRaw)) failures.push(`contracts.yaml: ${error}`);
const contracts = (contractsRaw as { contracts?: Array<{ id: string; evidence: string }> }).contracts ?? [];
const requirementIds = new Set(contracts.map((item) => item.id));
const sourceContract = readFileSync(join(root, "docs/efficiency-transformation/highly-efficient-organization-test-eval-transformation.md"), "utf8");
const sourceRequirementIds = new Set([...sourceContract.matchAll(/`([A-J]-(?:[A-Z]+-)*\d{2})`/g)].map((match) => match[1]!));
for (const id of sourceRequirementIds) if (!requirementIds.has(id)) failures.push(`contracts.yaml: source requirement missing from inventory ${id}`);
for (const id of requirementIds) if (!sourceRequirementIds.has(id)) failures.push(`contracts.yaml: inventory requirement absent from source document ${id}`);
const casesByRequirement = new Map<string, string[]>();
const casesById = new Map<string, { path: string; value: Record<string, unknown> }>();
const caseGraderPaths = new Set<string>();
const templateSeedHashes = new Map<string, string>();
for (const app of ["sparse", "library", "service"]) { const manifestPath = join(root, "eval/apps", app, "manifest.yaml"); const manifest = loadYamlFile(manifestPath) as { template_id?: unknown; seed_tree_sha256?: unknown }; const observed = hashTree(join(root, "eval/apps", app, "seed")); if (manifest.seed_tree_sha256 !== observed) failures.push(`${manifestPath}: seed_tree_sha256 expected ${observed}, got ${String(manifest.seed_tree_sha256)}`); if (typeof manifest.template_id === "string") templateSeedHashes.set(manifest.template_id, observed); }
scanYaml(join(root, "eval/cases"), (path, value) => {
  for (const error of validateCase(value)) failures.push(`${path}: ${error}`);
  const record = value as Record<string, unknown>;
  const caseId = record.case_id;
  if (typeof caseId === "string") {
    if (casesById.has(caseId)) failures.push(`${path}: duplicate case_id ${caseId}`);
    else casesById.set(caseId, { path, value: record });
  }
  const requirements = record.requirements;
  if (Array.isArray(requirements)) for (const id of requirements) if (typeof id === "string") {
    if (!requirementIds.has(id)) failures.push(`${path}: unknown requirement ${id}`);
    else casesByRequirement.set(id, [...(casesByRequirement.get(id) ?? []), String(caseId ?? path)]);
  }
  const manifest = value as { episode?: { task_ref?: unknown }; oracle?: { hidden_grader?: unknown } };
  if (typeof manifest.episode?.task_ref === "string" && !existsSync(join(root, "eval", manifest.episode.task_ref))) failures.push(`${path}: missing task_ref ${manifest.episode.task_ref}`);
  if (typeof manifest.oracle?.hidden_grader === "string") { caseGraderPaths.add(manifest.oracle.hidden_grader); if (!existsSync(join(root, "eval", manifest.oracle.hidden_grader))) failures.push(`${path}: missing hidden_grader ${manifest.oracle.hidden_grader}`); }
  const app = record.app as { template?: unknown; seed_ref?: unknown } | undefined; if (app && app.template !== "metadata-only") { const expected = typeof app.template === "string" ? templateSeedHashes.get(app.template) : undefined; if (!expected) failures.push(`${path}: unknown app template ${String(app.template)}`); else if (app.seed_ref !== expected) failures.push(`${path}: seed_ref expected ${expected}, got ${String(app.seed_ref)}`); }
});
const capabilities = validateCapabilities();
scanYaml(join(root, "eval/campaigns"), (path, value) => {
  for (const error of validateCampaign(value)) failures.push(`${path}: ${error}`);
  const campaign = value as { price_catalog_id?: unknown; cases?: Array<{ case_id?: unknown; repetition_ids?: unknown }>; assignments?: Array<{ runtime?: unknown; model?: unknown; capability_ref?: unknown }>; stop_rules?: unknown; operator_fixture?: unknown; learning_treatment?: { source?: unknown; content_sha256?: unknown } };
  validateOperatorFixture(path, campaign.operator_fixture);
  if (campaign.learning_treatment !== undefined) {
    const source = campaign.learning_treatment.source;
    const expected = campaign.learning_treatment.content_sha256;
    const treatmentPath = typeof source === "string" ? join(root, "eval", source) : "";
    if (treatmentPath === "" || !existsSync(treatmentPath)) failures.push(`${path}: missing learning treatment ${String(source)}`);
    else {
      const observed = `sha256:${hashFile(treatmentPath)}`;
      if (expected !== observed) failures.push(`${path}: learning treatment content_sha256 expected ${observed}, got ${String(expected)}`);
    }
  }
  if (typeof campaign.price_catalog_id === "string") {
    const catalogId = campaign.price_catalog_id.replace(/^prices\//, "");
    const catalogPath = join(root, "eval/price-catalogs", `${catalogId}.yaml`);
    if (!existsSync(catalogPath)) failures.push(`${path}: missing price catalog ${campaign.price_catalog_id}`);
    else {
      const catalog = loadYamlFile(catalogPath) as { schema_version?: unknown; catalog_id?: unknown; effective_at?: unknown; policy?: unknown; models?: Record<string, unknown> };
      if (catalog.schema_version !== 1 || catalog.catalog_id !== campaign.price_catalog_id || typeof catalog.effective_at !== "string" || !Number.isFinite(Date.parse(catalog.effective_at)) || typeof catalog.policy !== "string" || !catalog.models || typeof catalog.models !== "object") failures.push(`${path}: invalid price catalog ${campaign.price_catalog_id}`);
      else {
        for (const [model, rawPrice] of Object.entries(catalog.models)) { const price = rawPrice as Record<string, unknown>; for (const field of ["input_usd_per_million", "output_usd_per_million"]) if (price[field] !== null && (typeof price[field] !== "number" || !Number.isFinite(price[field]) || (price[field] as number) < 0)) failures.push(`${catalogPath}: ${model}.${field} must be non-negative or null`); if (typeof price.source !== "string" || price.source === "") failures.push(`${catalogPath}: ${model}.source is required`); }
        for (const assignment of campaign.assignments ?? []) if (typeof assignment.model === "string" && !(assignment.model in catalog.models)) failures.push(`${path}: price catalog ${campaign.price_catalog_id} omits model ${assignment.model}`);
      }
    }
  }
  for (const [index, assignment] of (campaign.assignments ?? []).entries()) { const declared = typeof assignment.capability_ref === "string" ? capabilities.get(assignment.capability_ref) : undefined; if (!declared) failures.push(`${path}: assignments[${index}] references unknown capability ${String(assignment.capability_ref)}`); else if (declared.runtime !== assignment.runtime) failures.push(`${path}: assignments[${index}] capability runtime mismatch`); }
  for (const rule of ["hard_safety_violation", "campaign_cap_cannot_cover_remaining_case", "hidden_answer_leakage", "production_path_overlap"]) if (!Array.isArray(campaign.stop_rules) || !campaign.stop_rules.includes(rule)) failures.push(`${path}: missing mandatory stop rule ${rule}`);
  const counts = new Map<string, number>();
  for (const item of campaign.cases ?? []) {
    if (typeof item.case_id !== "string") continue;
    const defined = casesById.get(item.case_id);
    if (!defined) { failures.push(`${path}: unknown case_id ${item.case_id}`); continue; }
    const repetitions = Array.isArray(item.repetition_ids) ? item.repetition_ids.length : 0;
    counts.set(item.case_id, (counts.get(item.case_id) ?? 0) + repetitions);
    const maximum = defined.value.repetitions;
    if (typeof maximum === "number" && (counts.get(item.case_id) ?? 0) > maximum) failures.push(`${path}: ${item.case_id} declares ${(counts.get(item.case_id) ?? 0)} repetitions above case maximum ${maximum}`);
  }
});
const graderCount = validateGraderManifest();
try { await calibrateCommittedGraders(join(root, "eval")); }
catch (error) { failures.push(`grader calibration: ${(error as Error).message}`); }
validateCorpora();
const evidenceValid = new Set<string>();
for (const contract of contracts) {
  const path = resolve(root, contract.evidence);
  const rel = relative(root, path);
  if (contract.evidence.trim() === "" || isAbsolute(contract.evidence) || rel.startsWith("..")) { failures.push(`${contract.id}: evidence must be a safe non-empty repository-relative path`); continue; }
  if (!existsSync(path) || !statSync(path).isFile()) { failures.push(`${contract.id}: missing evidence file ${contract.evidence}`); continue; }
  if (!contract.evidence.endsWith(".test.ts")) { failures.push(`${contract.id}: evidence is not an executable .test.ts file ${contract.evidence}`); continue; }
  if (!readFileSync(path, "utf8").includes(contract.id)) { failures.push(`${contract.id}: evidence file does not declare the requirement id ${contract.evidence}`); continue; }
  evidenceValid.add(contract.id);
}
validateBenchmarks();
validateFaultInventory();
const traceability = contracts.map((contract) => ({ requirement: contract.id, cases: (casesByRequirement.get(contract.id) ?? []).sort(), evidence: contract.evidence, executable: evidenceValid.has(contract.id) }));
const orphaned = traceability.filter((item) => !item.executable).map((item) => item.requirement);
for (const id of orphaned) failures.push(`orphaned requirement ${id}`);
console.log(JSON.stringify({ schema_version: 1, valid: failures.length === 0, traceability: { requirements: traceability.length, executable_evidence: evidenceValid.size, case_links: traceability.reduce((sum, item) => sum + item.cases.length, 0), cases: casesById.size, benchmark_families: REQUIRED_BENCHMARKS.length, fault_boundaries: 60, graders: graderCount, capabilities: capabilities.size, orphaned, records: traceability }, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;

function scanYaml(dir: string, visit: (path: string, value: unknown) => void): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scanYaml(path, visit);
    else if (entry.isFile() && [".yaml", ".yml"].includes(extname(entry.name))) visit(path, loadYamlFile(path));
  }
}

function validateBenchmarks(): void {
  const path = join(root, "eval/benchmarks.yaml");
  if (!existsSync(path)) { failures.push("missing eval/benchmarks.yaml"); return; }
  const value = loadYamlFile(path) as { schema_version?: unknown; families?: Array<{ id?: unknown; case_id?: unknown; case_ids?: unknown; layers?: unknown; real_model_repetitions?: unknown; oracle?: unknown }> };
  if (value.schema_version !== 1 || !Array.isArray(value.families)) { failures.push("eval/benchmarks.yaml: invalid root"); return; }
  const ids = new Set<string>();
  const referencedByFamily = new Map<string, Set<string>>();
  for (const family of value.families) {
    if (typeof family.id !== "string" || ids.has(family.id)) { failures.push(`eval/benchmarks.yaml: duplicate/invalid family ${String(family.id)}`); continue; }
    ids.add(family.id);
    if (!REQUIRED_BENCHMARKS.includes(family.id as typeof REQUIRED_BENCHMARKS[number])) failures.push(`eval/benchmarks.yaml: unknown benchmark family ${family.id}`);
    const referencedCases = Array.isArray(family.case_ids) ? family.case_ids : typeof family.case_id === "string" ? [family.case_id] : [];
    if (typeof family.id === "string") referencedByFamily.set(family.id, new Set(referencedCases.filter((caseId): caseId is string => typeof caseId === "string")));
    if (referencedCases.length === 0 || referencedCases.some((caseId) => typeof caseId !== "string")) failures.push(`eval/benchmarks.yaml: ${family.id} must reference at least one case`);
    for (const caseId of referencedCases) {
      if (typeof caseId !== "string" || !casesById.has(caseId)) failures.push(`eval/benchmarks.yaml: ${family.id} references unknown case ${String(caseId)}`);
      else if (casesById.get(caseId)!.value.benchmark_id !== family.id) failures.push(`eval/benchmarks.yaml: ${family.id} case ${caseId} does not point back to family`);
    }
    if (!Array.isArray(family.layers) || family.layers.length === 0 || family.layers.some((layer) => typeof layer !== "string" || !/^L[0-6]$/.test(layer))) failures.push(`eval/benchmarks.yaml: ${family.id} has invalid layers`);
    if (!Number.isInteger(family.real_model_repetitions) || (family.real_model_repetitions as number) < 0) failures.push(`eval/benchmarks.yaml: ${family.id} has invalid real_model_repetitions`);
    if (typeof family.oracle !== "string" || family.oracle === "") failures.push(`eval/benchmarks.yaml: ${family.id} lacks oracle`);
  }
  for (const id of REQUIRED_BENCHMARKS) if (!ids.has(id)) failures.push(`eval/benchmarks.yaml: missing benchmark family ${id}`);
  for (const [caseId, entry] of casesById) {
    const benchmarkId = entry.value.benchmark_id;
    if (benchmarkId !== undefined && (typeof benchmarkId !== "string" || !ids.has(benchmarkId))) failures.push(`${entry.path}: unknown benchmark_id ${String(benchmarkId)} for ${caseId}`);
    else if (typeof benchmarkId === "string" && !referencedByFamily.get(benchmarkId)?.has(caseId)) failures.push(`eval/benchmarks.yaml: ${benchmarkId} omits declared case ${caseId}`);
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

function validateFaultInventory(): void {
  const operations = ["archive_creation", "archive_checksum", "archive_rename", "registry_write", "config_write", "git_fetch", "ref_validation", "worktree_creation", "provider_start", "provider_first_event", "usage_checkpoint", "provider_final_result", "commit", "push", "pr", "comment", "review", "label", "merge", "approval_log_write", "approval_item_write", "approval_grant_write", "run_finalization", "ledger_settlement", "capture_cursor_update", "scheduler_lock", "tick_journal", "child_spawn", "learning_publish_journal", "learning_version_activation"];
  const expected = operations.flatMap((operation) => [`before_${operation}`, `after_${operation}`]); const value = loadYamlFile(join(root, "eval/faults.yaml")) as { schema_version?: unknown; faults?: unknown };
  if (value.schema_version !== 1 || !Array.isArray(value.faults) || JSON.stringify(value.faults) !== JSON.stringify(expected)) failures.push("eval/faults.yaml: must exactly enumerate all 60 before/after durable boundaries");
}

function validateGraderManifest(): number {
  const path = join(root, "eval/graders/manifest.yaml");
  if (!existsSync(path)) { failures.push("missing eval/graders/manifest.yaml"); return 0; }
  const value = loadYamlFile(path) as { schema_version?: unknown; graders?: Array<{ id?: unknown; source?: unknown; reference?: unknown; mutants?: unknown; content_sha256?: unknown; hidden_marker_sha256?: unknown }> };
  if (value.schema_version !== 1 || !Array.isArray(value.graders) || value.graders.length === 0) { failures.push("eval/graders/manifest.yaml: invalid root"); return 0; }
  const ids = new Set<string>(); const sources = new Set<string>();
  for (const [index, grader] of value.graders.entries()) {
    const label = `eval/graders/manifest.yaml graders[${index}]`;
    if (typeof grader.id !== "string" || ids.has(grader.id)) { failures.push(`${label}: duplicate/invalid id ${String(grader.id)}`); continue; } ids.add(grader.id);
    if (typeof grader.source !== "string" || sources.has(grader.source)) failures.push(`${label}: duplicate/invalid source ${String(grader.source)}`); else sources.add(grader.source);
    const files = [grader.source, grader.reference, ...(Array.isArray(grader.mutants) ? grader.mutants : [])];
    if (typeof grader.reference !== "string" || !Array.isArray(grader.mutants) || grader.mutants.length === 0 || grader.mutants.some((item) => typeof item !== "string")) { failures.push(`${label}: source/reference and non-empty mutants are required`); continue; }
    let invalidPath = false; const rows: string[] = [];
    for (const rel of files) {
      if (typeof rel !== "string" || isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) { failures.push(`${label}: unsafe grader path ${String(rel)}`); invalidPath = true; continue; }
      const absolute = join(root, "eval", rel); if (!existsSync(absolute) || !statSync(absolute).isFile()) { failures.push(`${label}: missing grader content ${rel}`); invalidPath = true; continue; }
      rows.push(`eval/${rel}\0${hashFile(absolute)}`);
    }
    if (!invalidPath) { const expected = `sha256:${sha256(rows.join("\n"))}`; if (grader.content_sha256 !== expected) failures.push(`${label}: content_sha256 expected ${expected}, got ${String(grader.content_sha256)}`); }
    const hidden = `sha256:${sha256(`operon-hidden:${grader.id}`)}`; if (grader.hidden_marker_sha256 !== hidden) failures.push(`${label}: hidden_marker_sha256 mismatch`);
  }
  for (const source of caseGraderPaths) if (!sources.has(source)) failures.push(`eval/graders/manifest.yaml: case grader is unpinned ${source}`);
  for (const source of sources) if (!caseGraderPaths.has(source)) failures.push(`eval/graders/manifest.yaml: pinned grader is unused by cases ${source}`);
  return value.graders.length;
}

function validateCapabilities(): Map<string, { runtime: string }> {
  const dir = join(root, "eval/capabilities"); const found = new Map<string, { runtime: string }>();
  if (!existsSync(dir)) { failures.push("missing eval/capabilities"); return found; }
  scanYaml(dir, (path, raw) => {
    const value = raw as Record<string, unknown>; const required = ["capability_id", "runtime", "task_transport", "large_payload", "gate_top_level", "gate_delegated", "tool_events", "cancellation", "partial_usage_checkpoint", "session_continuation", "budget_enforcement", "cost_quality", "cache_visibility", "role_shaping", "intra_turn_fanout", "known_gaps"];
    if (value.schema_version !== 1 || required.some((key) => value[key] === undefined)) { failures.push(`${path}: incomplete capability declaration`); return; }
    if (typeof value.capability_id !== "string" || typeof value.runtime !== "string" || !["claude", "codex", "pi"].includes(value.runtime) || value.capability_id !== `${value.runtime}/v1`) { failures.push(`${path}: invalid capability identity`); return; }
    if (found.has(value.capability_id)) failures.push(`${path}: duplicate capability ${value.capability_id}`); else found.set(value.capability_id, { runtime: value.runtime });
    if (value.large_payload !== true || value.partial_usage_checkpoint !== true) failures.push(`${path}: required transport/partial-usage capability is not claimed`);
    if (!Array.isArray(value.known_gaps) || value.known_gaps.some((gap) => typeof gap !== "string")) failures.push(`${path}: known_gaps must be a string array`);
  });
  for (const id of ["claude/v1", "codex/v1", "pi/v1"]) if (!found.has(id)) failures.push(`eval/capabilities: missing ${id}`);
  return found;
}

function validateOperatorFixture(campaignPath: string, reference: unknown): void {
  if (typeof reference !== "string" || !/^operator-fixtures\/[a-z0-9-]+-v\d+\.yaml$/.test(reference)) { failures.push(`${campaignPath}: invalid operator_fixture ${String(reference)}`); return; }
  const path = join(root, "eval", reference); if (!existsSync(path)) { failures.push(`${campaignPath}: missing operator_fixture ${reference}`); return; }
  const value = loadYamlFile(path) as Record<string, unknown>; const expectedKeys = ["schema_version", "fixture_id", "actor_kind", "scripted_layers", "live_decision_mode", "decisions", "forbidden_effects"];
  if (value.schema_version !== 1 || Object.keys(value).sort().join("\0") !== expectedKeys.sort().join("\0") || !["separate_eval_operator", "human_operator"].includes(String(value.actor_kind)) || value.live_decision_mode !== "human_required" || !Array.isArray(value.scripted_layers) || value.scripted_layers.some((layer) => layer !== "L2" && layer !== "L4") || !Array.isArray(value.decisions) || !Array.isArray(value.forbidden_effects)) { failures.push(`${path}: invalid operator fixture root`); return; }
  const fixtureId = reference.replace(/^operator-fixtures\//, "").replace(/-v(\d+)\.yaml$/, "/v$1"); if (value.fixture_id !== fixtureId) failures.push(`${path}: fixture_id expected ${fixtureId}`);
  const hashes = new Set<string>();
  for (const [index, raw] of value.decisions.entries()) { const decision = raw as Record<string, unknown>; const keys = ["case_id", "action_sha256", "decision", "scope"]; if (typeof raw !== "object" || raw === null || Array.isArray(raw) || Object.keys(decision).sort().join("\0") !== keys.sort().join("\0") || typeof decision.case_id !== "string" || !casesById.has(decision.case_id) || typeof decision.action_sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(decision.action_sha256) || hashes.has(decision.action_sha256) || !["allow_eval_effect_recorder_once", "deny_and_park"].includes(String(decision.decision)) || typeof decision.scope !== "string" || decision.scope === "") failures.push(`${path}: invalid decisions[${index}]`); else hashes.add(decision.action_sha256); }
  const forbidden = new Set(value.forbidden_effects as unknown[]); for (const effect of ["real_deploy", "publication", "message_send", "email_send", "dns_mutation", "cloud_mutation", "irreversible_data_operation"]) if (!forbidden.has(effect)) failures.push(`${path}: forbidden_effects missing ${effect}`);
  if ((value.decisions as unknown[]).length > 0 && value.actor_kind !== "separate_eval_operator") failures.push(`${path}: scripted decisions require separate_eval_operator`);
}

function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
