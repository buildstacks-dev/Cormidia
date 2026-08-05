// `cormidia bootstrap` — runs inside the product repo (docs/architecture.md §9).
//
// Step 1 ("Learn") is `scanRepo()` — language/build/test commands from
// manifests and CI config, documentation inventory, agent docs
// (CLAUDE.md / AGENTS.md), deploy hints.
// Step 2 ("Questionnaire") is the `BootstrapAnswers` contract + `parseAnswers`
// — interactive collection lives in the CLI; tests and scripts inject the
// same object via `--answers answers.json`. Step 3 ("Emit") is
// `emitAppArtifacts()`: the app charter
// (`.cormidia/TASTE.md`), the app's registry entry (`.cormidia/config.yaml`,
// apps.yaml schema), `.cormidia/onboarding-report.md`, and seeded per-role
// memory bundles. `bootstrapRun()` composes steps 1–3 and registers the app in
// the required active org home. App-owned bootstrap output also includes
// `.cormidia/policy.yaml` when the M4.2 policy template is present in this
// package.

import { readFile, readdir, mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import { existsSync, lstatSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import type { AuthorityContext, Trigger } from "../runtime/types.js";
import {
  appExecutionYaml,
  joinExistingOrg,
  loadApps,
  normalizeAppExecution,
  removeExistingApp,
  type AppRegistration,
} from "./apps.js";
import { loadRoles } from "./roles.js";
import {
  applyAppAuthority,
  authorityPreview,
  composeProjectInstructions,
  createAppAuthorityDocument,
  projectAuthorityBlock,
  resolveAuthority,
  type AppAuthoritySelection,
} from "./authority.js";
import {
  assertNonSecretOnboardingAnswers,
  onboardingAnswersPath,
  storeOnboardingAnswers,
} from "./onboarding-answers.js";

// ---------------------------------------------------------------------------
// Step 1 — scanRepo()
// ---------------------------------------------------------------------------

/** A detected command plus where the detection came from, so the scan report
 * (and later the questionnaire) can show its evidence. */
export interface CommandDetection {
  command: string;
  /** e.g. "package.json scripts.test" or ".github/workflows/ci.yml". */
  source: string;
}

export type DocCategoryId =
  | "product/readme"
  | "architecture"
  | "specs/requirements"
  | "operations/runbook"
  | "agent/contributor"
  | "testing/quality";

export interface DocInventoryCategory {
  id: DocCategoryId;
  label: string;
  /** Conservative repo-relative paths or manifest files that evidence this category. */
  paths: string[];
}

export interface RepoScan {
  root: string;
  /** Primary language, when a manifest identifies one. */
  language?: string;
  /** Evidence for the language call, e.g. "tsconfig.json". */
  languageSource?: string;
  /** Node package manager (packageManager field or lockfile), when any. */
  packageManager?: string;
  build?: CommandDetection;
  test?: CommandDetection;
  lint?: CommandDetection;
  /** Documentation/setup inventory grouped by recommended onboarding category. */
  docInventory: DocInventoryCategory[];
  /** Agent docs present at the repo root (relative paths). */
  agentDocs: string[];
  /** CI workflow files (relative paths, sorted). */
  ciConfigs: string[];
  /** Deploy hints present at the repo root (relative paths). */
  deployHints: string[];
  /** `owner/repo` parsed from `.git/config`'s origin remote, when present. */
  repoSlug?: string;
}

const AGENT_DOCS = ["AGENTS.md", "CLAUDE.md"];
const DEPLOY_HINTS = [
  "Dockerfile",
  "docker-compose.yml",
  "compose.yaml",
  "fly.toml",
  "Procfile",
  "vercel.json",
  "netlify.toml",
];
const DOC_CATEGORY_DEFS: readonly { id: DocCategoryId; label: string; guidance: string }[] = [
  {
    id: "product/readme",
    label: "Product / overview",
    guidance: "Add or point Cormidia at app-owner-authored product overview docs.",
  },
  {
    id: "architecture",
    label: "Architecture / decisions",
    guidance: "Add app-owner-authored architecture notes, ADRs, or decision records.",
  },
  {
    id: "specs/requirements",
    label: "Specs / requirements",
    guidance: "Add specs, requirements, or acceptance-contract source documents.",
  },
  {
    id: "operations/runbook",
    label: "Operations / runbook",
    guidance: "Add runbook, deploy, or operations docs before expecting autonomous operations.",
  },
  {
    id: "agent/contributor",
    label: "Agent / contributor docs",
    guidance: "Add AGENTS.md, CLAUDE.md, or equivalent contributor guidance.",
  },
  {
    id: "testing/quality",
    label: "Testing / quality",
    guidance: "Add testing docs, CI, or discoverable test/lint quality signals.",
  },
];

/** Learn a target repo (architecture §9 step 1). Purely observational: reads
 * files, runs nothing, writes nothing. Absence of anything is reported as
 * absent fields / empty lists — never an error. */
export async function scanRepo(rootIn: string): Promise<RepoScan> {
  const root = resolve(rootIn);
  const scan: RepoScan = {
    root,
    docInventory: emptyDocInventory(),
    agentDocs: [],
    ciConfigs: [],
    deployHints: [],
  };

  await scanNodeManifest(root, scan);
  if (!scan.language) scanOtherManifests(root, scan);

  for (const doc of AGENT_DOCS) {
    if (existsSync(join(root, doc))) scan.agentDocs.push(doc);
  }
  for (const hint of DEPLOY_HINTS) {
    if (existsSync(join(root, hint))) scan.deployHints.push(hint);
  }

  scan.ciConfigs = await listWorkflows(root);
  // "test commands from manifests+CI" (§9 step 1): the manifest wins; CI is
  // the fallback evidence when the manifest names no test script.
  if (!scan.test) {
    const fromCi = await testCommandFromCi(root, scan.ciConfigs);
    if (fromCi) scan.test = fromCi;
  }

  const slug = await gitOriginSlug(root);
  if (slug) scan.repoSlug = slug;

  scan.docInventory = await detectDocInventory(root, scan);

  return scan;
}

function emptyDocInventory(): DocInventoryCategory[] {
  return DOC_CATEGORY_DEFS.map((def) => ({ id: def.id, label: def.label, paths: [] }));
}

async function detectDocInventory(root: string, scan: RepoScan): Promise<DocInventoryCategory[]> {
  const found: Record<DocCategoryId, Set<string>> = {
    "product/readme": new Set(),
    architecture: new Set(),
    "specs/requirements": new Set(),
    "operations/runbook": new Set(),
    "agent/contributor": new Set(),
    "testing/quality": new Set(),
  };
  const add = (category: DocCategoryId, rel: string) => found[category].add(rel);
  const addIfExists = (category: DocCategoryId, rel: string) => {
    if (existsSync(join(root, rel))) add(category, rel);
  };

  addIfExists("product/readme", "README.md");
  addIfExists("product/readme", join("docs", "PURPOSE.md"));
  addIfExists("architecture", "architecture.md");
  addIfExists("architecture", "decisions.md");
  addIfExists("specs/requirements", "requirements.md");
  addIfExists("operations/runbook", "RUNBOOK.md");
  addIfExists("testing/quality", "TESTING.md");

  for (const rel of scan.agentDocs) add("agent/contributor", rel);
  for (const rel of scan.ciConfigs) add("testing/quality", rel);

  for (const detection of [scan.test, scan.lint]) {
    const manifest = manifestPathFromSource(detection?.source);
    if (manifest) add("testing/quality", manifest);
  }

  for (const rel of await listFilesUnder(root, "docs")) {
    const normalized = rel.split("\\").join("/");
    const base = normalized.split("/").at(-1)?.toLowerCase() ?? "";
    const inDocsRoot = normalized.split("/").length === 2;

    if (inDocsRoot && /^(product|overview)[^/]*\.md$/.test(base)) {
      add("product/readme", normalized);
    }
    if (inDocsRoot && /^architecture[^/]*\.md$/.test(base)) {
      add("architecture", normalized);
    }
    if (normalized.startsWith("docs/adr/") && base.endsWith(".md")) {
      add("architecture", normalized);
    }
    if (inDocsRoot && /^decisions[^/]*\.md$/.test(base)) {
      add("architecture", normalized);
    }
    if (normalized.startsWith("docs/specs/") && base.endsWith(".md")) {
      add("specs/requirements", normalized);
    }
    if (inDocsRoot && /^requirements[^/]*\.md$/.test(base)) {
      add("specs/requirements", normalized);
    }
    if (inDocsRoot && /^(runbook|ops|deploy)[^/]*\.md$/.test(base)) {
      add("operations/runbook", normalized);
    }
    if (inDocsRoot && /^testing[^/]*\.md$/.test(base)) {
      add("testing/quality", normalized);
    }
  }

  for (const rel of await listFilesUnder(root, "specs")) {
    const normalized = rel.split("\\").join("/");
    if (normalized.toLowerCase().endsWith(".md")) add("specs/requirements", normalized);
  }

  return DOC_CATEGORY_DEFS.map((def) => ({
    id: def.id,
    label: def.label,
    paths: [...found[def.id]].sort(),
  }));
}

function manifestPathFromSource(source: string | undefined): string | undefined {
  if (!source) return undefined;
  const first = source.split(" ")[0];
  if (!first) return undefined;
  if (first === "package.json") return first;
  if (first.endsWith(".json") || first.endsWith(".toml") || first.endsWith(".yaml") || first.endsWith(".yml")) {
    return first;
  }
  return undefined;
}

async function scanNodeManifest(root: string, scan: RepoScan): Promise<void> {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return;

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
  } catch {
    return; // unparseable manifest = no detection, not a crash
  }

  const deps = {
    ...(pkg["dependencies"] as Record<string, unknown> | undefined),
    ...(pkg["devDependencies"] as Record<string, unknown> | undefined),
  };
  if (existsSync(join(root, "tsconfig.json"))) {
    scan.language = "typescript";
    scan.languageSource = "tsconfig.json";
  } else if ("typescript" in deps) {
    scan.language = "typescript";
    scan.languageSource = "package.json devDependencies";
  } else {
    scan.language = "javascript";
    scan.languageSource = "package.json";
  }

  const detectedPm = detectPackageManager(root, pkg);
  if (detectedPm) scan.packageManager = detectedPm;
  const pm = detectedPm ?? "npm";

  const scripts = (pkg["scripts"] ?? {}) as Record<string, unknown>;
  for (const name of ["build", "test", "lint"] as const) {
    if (typeof scripts[name] === "string") {
      scan[name] = { command: `${pm} run ${name}`, source: `package.json scripts.${name}` };
    }
  }
}

function detectPackageManager(root: string, pkg: Record<string, unknown>): string | undefined {
  const field = pkg["packageManager"];
  if (typeof field === "string" && field.length > 0) return field.split("@")[0];
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "package-lock.json"))) return "npm";
  return undefined;
}

/** Non-Node manifests: enough to name the language; command detection for
 * these ecosystems can grow when a real app needs it. */
function scanOtherManifests(root: string, scan: RepoScan): void {
  const table: [file: string, language: string][] = [
    ["pyproject.toml", "python"],
    ["setup.py", "python"],
    ["Cargo.toml", "rust"],
    ["go.mod", "go"],
  ];
  for (const [file, language] of table) {
    if (existsSync(join(root, file))) {
      scan.language = language;
      scan.languageSource = file;
      return;
    }
  }
}

async function listWorkflows(root: string): Promise<string[]> {
  const dir = join(root, ".github", "workflows");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  return entries
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort()
    .map((f) => join(".github", "workflows", f));
}

async function listFilesUnder(root: string, relDir: string): Promise<string[]> {
  const absDir = join(root, relDir);
  if (!existsSync(absDir)) return [];
  const out: string[] = [];

  async function walk(abs: string, rel: string): Promise<void> {
    const entries = await readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      const childAbs = join(abs, entry.name);
      const childRel = join(rel, entry.name);
      if (entry.isDirectory()) {
        await walk(childAbs, childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  }

  await walk(absDir, relDir);
  return out.sort();
}

async function testCommandFromCi(
  root: string,
  workflows: string[],
): Promise<CommandDetection | undefined> {
  for (const rel of workflows) {
    const text = await readFile(join(root, rel), "utf8");
    for (const line of text.split("\n")) {
      const m = /^\s*(?:-\s+)?run:\s*(.+)$/.exec(line);
      if (m && /\btest\b/.test(m[1]!)) {
        return { command: m[1]!.trim(), source: rel };
      }
    }
  }
  return undefined;
}

/** Parse `owner/repo` out of `.git/config`'s origin URL (ssh or https).
 * File parsing only — never shells out to git. */
async function gitOriginSlug(root: string): Promise<string | undefined> {
  const configPath = join(root, ".git", "config");
  if (!existsSync(configPath)) return undefined;
  const text = await readFile(configPath, "utf8");
  const remote = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(text);
  if (!remote) return undefined;
  const url = remote[1]!.replace(/\.git$/, "");
  const segments = url.split(/[/:]/).filter((s) => s.length > 0);
  if (segments.length < 2) return undefined;
  return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
}

export interface EmitResult {
  /** Relative paths written, in emission order. */
  created: string[];
  /** Existing project instruction files changed only inside the marked
   * Cormidia block; all other bytes are preserved. */
  updated: string[];
}

/** This package's root (works from both src/ and dist/ — two levels up). */
const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const POLICY_TEMPLATE_REL = join("docs", "policy.yaml.template");
const RETIRED_APP_ARTIFACT_DIR = ".operon";

/** apps.yaml keys are plain YAML scalars — keep names to safe characters. */
function sanitizeAppName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "app";
}

/** Contract B-14 §3: a symlinked target path — or any symlinked ancestor,
 * e.g. `.cormidia` itself linked out of the checkout — would route bootstrap
 * writes outside the tree that was validated. Typed refusal before mutation.
 * `existsSync` follows links, so this walks every path segment with lstat. */
function assertNotSymlinked(targetRoot: string, rels: readonly string[]): void {
  for (const rel of rels) {
    const segments = rel.split("/");
    for (let depth = 1; depth <= segments.length; depth++) {
      const partial = segments.slice(0, depth).join("/");
      const stat = lstatSync(join(targetRoot, partial), { throwIfNoEntry: false });
      if (stat === undefined) break; // nothing deeper can exist either
      if (stat.isSymbolicLink()) {
        throw new Error(
          `bootstrap: ${partial} in ${targetRoot} is a symbolic link — ` +
            "refusing to write through it to a target outside the checkout",
        );
      }
    }
  }
}

/** Bootstrap never silently clobbers an existing org — checked for every
 * target file BEFORE the first write, so a failed run leaves no half-tree. */
function assertNotExists(targetRoot: string, rels: readonly string[]): void {
  for (const rel of rels) {
    if (existsSync(join(targetRoot, rel))) {
      throw new Error(
        `bootstrap: ${rel} already exists in ${targetRoot} — refusing to overwrite ` +
          "an existing app configuration must be reviewed or removed explicitly",
      );
    }
  }
}

/** Refuse to create a second app-policy tree beside a checkout that still
 * carries the retired product path. That repository needs one reviewed
 * `git mv` so config authority never splits between two directories. */
function assertNoRetiredAppArtifactRoot(targetRoot: string): void {
  const retired = join(targetRoot, RETIRED_APP_ARTIFACT_DIR);
  if (lstatSync(retired, { throwIfNoEntry: false }) === undefined) return;
  throw new Error(
    `bootstrap: retired app artifact directory ${retired} still exists — ` +
      "rename it to .cormidia in one reviewed app-repository commit before bootstrapping with Cormidia",
  );
}

// ---------------------------------------------------------------------------
// Step 2 — questionnaire answers (architecture §9 step 2)
// ---------------------------------------------------------------------------

/** The alignment-questionnaire result: exactly one field per §9 step-2
 * question, nothing else. Interactive collection (the CLI) and `--answers
 * answers.json` both produce the raw shape; `parseAnswers` validates and
 * normalizes it into this type. Raw JSON: `product`, `good`, and `roles`
 * are required; everything else is optional and defaulted here. */
export interface BootstrapAnswers {
  /** "What the product is" — the charter's first section. */
  product: string;
  /** "What 'good' means here" — the charter's second section. */
  good: string;
  /** Roles enabled for this app; each must name a role in the org
   * roles.yaml. Un-listed roles are disabled — emitted as empty cadence
   * overrides, the registry schema's disable mechanism (src/org/apps.ts). */
  roles: string[];
  /** Monthly budget in USD (docs/PURPOSE.md → Budget & cadence; default 1000). */
  budgetUsdMonth: number;
  /** Per-role trigger overrides (apps.yaml cadence semantics: an entry
   * REPLACES the role's roles.yaml triggers). Keys must be enabled roles;
   * `{}` = every enabled role runs its roles.yaml triggers. */
  cadence: Record<string, Trigger[]>;
  /** App-specific critical ops — §9 step 2's three categories; these extend
   * the gate's rule set for this app. Empty lists = none declared. */
  criticalOps: {
    deployCommands: string[];
    publishTargets: string[];
    secretLocations: string[];
  };
  /** Feedback/publishing channels. A key may be present only when that
   * audience-facing role is enabled; enabled roles default to []. */
  channels: { support?: string[]; marketing?: string[] };
  /** App onboarding can inherit or narrow the org's recorded grant. */
  authority: AppAuthoritySelection;
}

/** Validate + normalize a raw answers object (from `--answers answers.json`
 * or the interactive questionnaire). Loud, specific errors — a bootstrap
 * with wrong answers must fail before anything is written. */
export function parseAnswers(rawUnknown: unknown, knownRoles: string[]): BootstrapAnswers {
  const err = (msg: string) => new Error(`bootstrap answers: ${msg}`);
  if (!rawUnknown || typeof rawUnknown !== "object" || Array.isArray(rawUnknown)) {
    throw err("must be a JSON object");
  }
  const raw = rawUnknown as Record<string, unknown>;

  const allowedKeys = ["product", "good", "roles", "budgetUsdMonth", "cadence", "criticalOps", "channels", "authority"];
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.includes(key)) {
      throw err(`unknown key "${key}" (allowed: ${allowedKeys.join(", ")})`);
    }
  }

  const product = requireText(raw["product"], "product", err);
  const good = requireText(raw["good"], "good", err);

  const rolesRaw = raw["roles"];
  if (!Array.isArray(rolesRaw) || rolesRaw.length === 0) {
    throw err(`roles must be a non-empty list (available: ${knownRoles.join(", ")})`);
  }
  const roles: string[] = [];
  for (const r of rolesRaw) {
    if (typeof r !== "string" || !knownRoles.includes(r)) {
      throw err(
        `roles: "${String(r)}" is not a role in the org roles.yaml (available: ${knownRoles.join(", ")})`,
      );
    }
    if (roles.includes(r)) throw err(`roles: "${r}" listed twice`);
    roles.push(r);
  }

  let budgetUsdMonth = 1000; // docs/PURPOSE.md → Budget & cadence (decided 2026-07-04)
  if (raw["budgetUsdMonth"] !== undefined) {
    const b = raw["budgetUsdMonth"];
    if (typeof b !== "number" || !Number.isFinite(b) || b <= 0) {
      throw err("budgetUsdMonth must be a positive number");
    }
    budgetUsdMonth = b;
  }

  const cadence: Record<string, Trigger[]> = {};
  if (raw["cadence"] !== undefined) {
    const cadenceRaw = raw["cadence"];
    if (!cadenceRaw || typeof cadenceRaw !== "object" || Array.isArray(cadenceRaw)) {
      throw err("cadence must be a mapping of role -> trigger list");
    }
    for (const [role, listUnknown] of Object.entries(cadenceRaw as Record<string, unknown>)) {
      if (!roles.includes(role)) {
        throw err(`cadence.${role}: "${role}" is not an enabled role (a disabled role is expressed by omission from "roles", never by a cadence entry)`);
      }
      if (!Array.isArray(listUnknown)) throw err(`cadence.${role} must be a list of triggers`);
      const triggers: Trigger[] = [];
      for (const t of listUnknown) {
        const trigger: Trigger = {};
        if (t && typeof t === "object" && !Array.isArray(t)) {
          const spec = t as Record<string, unknown>;
          for (const key of Object.keys(spec)) {
            if (key !== "schedule" && key !== "event") {
              throw err(`cadence.${role}: unknown trigger key "${key}" (allowed: schedule, event)`);
            }
          }
          if (typeof spec["schedule"] === "string") trigger.schedule = spec["schedule"];
          if (typeof spec["event"] === "string") trigger.event = spec["event"];
        }
        if (!trigger.schedule && !trigger.event) {
          throw err(`cadence.${role}: trigger needs schedule or event`);
        }
        triggers.push(trigger);
      }
      cadence[role] = triggers;
    }
  }

  const criticalOps: BootstrapAnswers["criticalOps"] = {
    deployCommands: [],
    publishTargets: [],
    secretLocations: [],
  };
  if (raw["criticalOps"] !== undefined) {
    const coRaw = raw["criticalOps"];
    if (!coRaw || typeof coRaw !== "object" || Array.isArray(coRaw)) {
      throw err("criticalOps must be an object");
    }
    const spec = coRaw as Record<string, unknown>;
    for (const key of Object.keys(spec)) {
      if (!(key in criticalOps)) {
        throw err(`criticalOps: unknown key "${key}" (allowed: deployCommands, publishTargets, secretLocations)`);
      }
    }
    criticalOps.deployCommands = stringList(spec["deployCommands"], "criticalOps.deployCommands", err);
    criticalOps.publishTargets = stringList(spec["publishTargets"], "criticalOps.publishTargets", err);
    criticalOps.secretLocations = stringList(spec["secretLocations"], "criticalOps.secretLocations", err);
  }

  const channels: BootstrapAnswers["channels"] = {};
  if (raw["channels"] !== undefined) {
    const chRaw = raw["channels"];
    if (!chRaw || typeof chRaw !== "object" || Array.isArray(chRaw)) {
      throw err("channels must be an object");
    }
    const spec = chRaw as Record<string, unknown>;
    for (const key of Object.keys(spec)) {
      if (key !== "support" && key !== "marketing") {
        throw err(`channels: unknown key "${key}" (allowed: support, marketing)`);
      }
      if (!roles.includes(key)) {
        throw err(`channels.${key}: role "${key}" is not enabled — enable it in "roles" or drop its channels`);
      }
      channels[key as "support" | "marketing"] = stringList(spec[key], `channels.${key}`, err);
    }
  }
  // Enabled audience-facing roles answered with no channels get an explicit
  // empty list — the emitted config shows "asked, none" rather than silence.
  for (const role of ["support", "marketing"] as const) {
    if (roles.includes(role) && channels[role] === undefined) channels[role] = [];
  }

  const authority = parseAppAuthoritySelection(raw["authority"], err);

  return { product, good, roles, budgetUsdMonth, cadence, criticalOps, channels, authority };
}

function parseAppAuthoritySelection(
  value: unknown,
  err: (msg: string) => Error,
): AppAuthoritySelection {
  if (value === undefined) return { mode: "inherit" };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw err("authority must be an object with mode inherit | conservative | custom");
  }
  const spec = value as Record<string, unknown>;
  for (const key of Object.keys(spec)) {
    if (key !== "mode" && key !== "restrictions") {
      throw err(`authority: unknown key "${key}" (allowed: mode, restrictions)`);
    }
  }
  const mode = spec["mode"];
  if (mode !== "inherit" && mode !== "conservative" && mode !== "custom") {
    throw err("authority.mode must be inherit | conservative | custom");
  }
  if (mode === "custom") {
    const restrictions = requireText(spec["restrictions"], "authority.restrictions", err);
    return { mode, restrictions };
  }
  if (spec["restrictions"] !== undefined) {
    throw err("authority.restrictions is valid only when authority.mode is custom");
  }
  return { mode };
}

function requireText(v: unknown, field: string, err: (msg: string) => Error): string {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw err(`${field} is required (a non-empty string)`);
  }
  return v.trim();
}

function stringList(v: unknown, field: string, err: (msg: string) => Error): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw err(`${field} must be a list of strings`);
  for (const item of v) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw err(`${field} must contain only non-empty strings`);
    }
  }
  return (v as string[]).map((s) => s.trim());
}

/** Role names from a template root's roles.yaml — the questionnaire's
 * "which roles to enable" universe (defaults to this package's root file,
 * the dogfood template). */
export async function templateRoleNames(templateRoot: string = PACKAGE_ROOT): Promise<string[]> {
  return (await loadRoles(join(templateRoot, "roles.yaml"))).roles.map((r) => r.name);
}

// ---------------------------------------------------------------------------
// Step 3 (app half) — emitAppArtifacts() + bootstrapRun()
// ---------------------------------------------------------------------------

export interface EmitAppArtifactsOptions {
  /** App (and config org) name; defaults to the target directory basename. */
  appName: string;
  /** GitHub `owner/repo` slug; a marked placeholder when absent. */
  repoSlug?: string;
  /** Parsed questionnaire answers (parseAnswers). */
  answers: BootstrapAnswers;
  /** The scan that produced this bootstrap run; emitAppArtifacts scans when omitted. */
  scan?: RepoScan;
  /** Every role in the org roles.yaml, in file order. Emission order for
   * memory bundles; the complement of answers.roles gets an explicit empty
   * cadence override (= disabled, src/org/apps.ts semantics). */
  allRoles: string[];
  /** Canonical org grant to snapshot. bootstrapRun supplies it; direct unit
   * callers safely fall back to legacy-conservative resolution. */
  orgAuthority?: AuthorityContext;
  /** Instruction-file plans captured at the command's validation phase.
   * bootstrapRun supplies its pre-flight plans so the write phase compares
   * against exactly the bytes the command validated (F-PT-007
   * compare-and-refuse); direct callers may omit and emitAppArtifacts
   * validates (plans) itself. */
  instructionPlans?: ProjectInstructionPlan[];
  /** Template root for docs/policy.yaml.template; defaults to this package. */
  templateRoot?: string;
}

/** Relative paths emitAppArtifacts will create for a given answers object. */
export function appArtifactFiles(answers: BootstrapAnswers, allRoles: string[]): string[] {
  const enabled = allRoles.filter((r) => answers.roles.includes(r));
  return [
    ".cormidia/TASTE.md",
    ".cormidia/AUTHORITY.md",
    ".cormidia/config.yaml",
    ".cormidia/policy.yaml",
    ".cormidia/onboarding-report.md",
    ...enabled.map((role) => `.cormidia/memory/${role}/INDEX.md`),
  ];
}

export type OnboardingNoteSeverity = "gap" | "warning" | "info";

export interface OnboardingReadinessNote {
  severity: OnboardingNoteSeverity;
  role: string;
  message: string;
}

export interface OnboardingGapReport {
  docInventory: DocInventoryCategory[];
  missingRecommendedCategories: {
    id: DocCategoryId;
    label: string;
    guidance: string;
  }[];
  setupSignals: {
    build?: CommandDetection;
    test?: CommandDetection;
    lint?: CommandDetection;
    ciConfigs: string[];
    deployHints: string[];
    repoSlug?: string;
  };
  roleReadinessNotes: OnboardingReadinessNote[];
}

export function buildOnboardingGapReport(
  scan: RepoScan,
  answers: BootstrapAnswers,
): OnboardingGapReport {
  const missingRecommendedCategories = DOC_CATEGORY_DEFS.filter(
    (def) => (scan.docInventory.find((c) => c.id === def.id)?.paths.length ?? 0) === 0,
  ).map((def) => ({ id: def.id, label: def.label, guidance: def.guidance }));

  const roleReadinessNotes: OnboardingReadinessNote[] = [];
  if (answers.roles.includes("support") && (answers.channels.support?.length ?? 0) === 0) {
    roleReadinessNotes.push({
      severity: "gap",
      role: "support",
      message:
        "Support is enabled but no support channels are declared; add channels or keep Support disabled until feedback exists.",
    });
  }
  if (answers.roles.includes("marketing") && (answers.channels.marketing?.length ?? 0) === 0) {
    roleReadinessNotes.push({
      severity: "gap",
      role: "marketing",
      message:
        "Marketing is enabled but no marketing channels are declared; add channels or keep Marketing disabled until adoption/publishing channels exist.",
    });
  }
  const hasOperationsDocs =
    (scan.docInventory.find((c) => c.id === "operations/runbook")?.paths.length ?? 0) > 0;
  const hasDeploySignal = scan.deployHints.length > 0 || answers.criticalOps.deployCommands.length > 0;
  if (answers.roles.includes("sre") && !hasOperationsDocs && !hasDeploySignal) {
    roleReadinessNotes.push({
      severity: "warning",
      role: "sre",
      message:
        "SRE is enabled but no operations/runbook docs, deploy commands, or deploy hints were detected.",
    });
  }
  if (roleReadinessNotes.length === 0) {
    roleReadinessNotes.push({
      severity: "info",
      role: "all",
      message: "No role-specific onboarding gaps detected from the supplied answers and repo scan.",
    });
  }

  const setupSignals: OnboardingGapReport["setupSignals"] = {
    ciConfigs: scan.ciConfigs,
    deployHints: scan.deployHints,
  };
  if (scan.build) setupSignals.build = scan.build;
  if (scan.test) setupSignals.test = scan.test;
  if (scan.lint) setupSignals.lint = scan.lint;
  if (scan.repoSlug) setupSignals.repoSlug = scan.repoSlug;

  return {
    docInventory: scan.docInventory,
    missingRecommendedCategories,
    setupSignals,
    roleReadinessNotes,
  };
}

/** Emit the app-level artifacts (architecture §9 step 3, first three
 * bullets): the product charter, the app's registry entry, and one seeded
 * OKF memory bundle per enabled role, plus the onboarding doc inventory/gap
 * report. All content is deterministic — no timestamps — because the charter
 * is context layer [3] and layers [1]–[4] must stay a pure function of
 * ratified files (§5 cache-stable rule 1). */
export async function emitAppArtifacts(
  targetRootIn: string,
  options: EmitAppArtifactsOptions,
): Promise<EmitResult> {
  const targetRoot = resolve(targetRootIn);
  const { answers, allRoles } = options;
  const appName = sanitizeAppName(options.appName);
  const repoSlug = options.repoSlug ?? `OWNER/${appName}`;
  const templateRoot = options.templateRoot ?? PACKAGE_ROOT;

  assertNoRetiredAppArtifactRoot(targetRoot);
  const files = appArtifactFiles(answers, allRoles);
  assertNotExists(targetRoot, files);
  assertNotSymlinked(targetRoot, files);
  const policyTemplate = await readPolicyTemplate(templateRoot);
  const scan = options.scan ?? (await scanRepo(targetRoot));
  const onboardingReport = buildOnboardingGapReport(scan, answers);
  const orgAuthority =
    options.orgAuthority ?? (await resolveAuthority({ orgHome: templateRoot }));
  const effectiveAuthority = applyAppAuthority(orgAuthority, answers.authority);
  const appAuthority = createAppAuthorityDocument(orgAuthority, answers.authority);
  const instructionPlans =
    options.instructionPlans ??
    (await planProjectInstructionFiles(targetRoot, effectiveAuthority));

  const created: string[] = [];
  const updated: string[] = [];
  // Validated bytes for rollback: restore only files this run overwrote, so a
  // refusal never rewrites human bytes the command declined to touch.
  const previousInstructions = new Map<string, string>();
  for (const plan of instructionPlans) {
    if (plan.validated !== undefined) previousInstructions.set(plan.rel, plan.validated);
  }
  const emit = async (rel: string, content: string) => {
    const abs = join(targetRoot, rel);
    // F-PT-007 compare-and-refuse: validation proved this path absent, so a
    // file here now is a concurrent human write — refuse, preserve its bytes.
    assertNotSymlinked(targetRoot, [rel]);
    if (lstatSync(abs, { throwIfNoEntry: false }) !== undefined) {
      throw new Error(
        `bootstrap: ${rel} appeared in ${targetRoot} after validation — ` +
          "a concurrent edit; refusing to overwrite human bytes",
      );
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    created.push(rel);
  };

  try {
    await emit(".cormidia/TASTE.md", charterMd(appName, answers));
    await emit(".cormidia/AUTHORITY.md", appAuthority);
    await emit(
      ".cormidia/config.yaml",
      configYaml(appName, repoSlug, options.repoSlug === undefined, answers, allRoles),
    );
    await emit(".cormidia/policy.yaml", policyTemplate);
    await emit(
      ".cormidia/onboarding-report.md",
      onboardingReportMd(appName, onboardingReport, effectiveAuthority, answers.authority),
    );
    for (const role of allRoles) {
      if (answers.roles.includes(role)) {
        await emit(`.cormidia/memory/${role}/INDEX.md`, memoryIndexMd(role, appName));
      }
    }

    for (const plan of instructionPlans) {
      const abs = join(targetRoot, plan.rel);
      // F-PT-007 compare-and-refuse: the file must still hold exactly the
      // validated bytes; drift is a concurrent human edit — refuse, never
      // merge the marked block into content the command never validated.
      const stat = lstatSync(abs, { throwIfNoEntry: false });
      if (stat?.isSymbolicLink()) {
        throw new Error(
          `bootstrap: ${plan.rel} in ${targetRoot} is a symbolic link — ` +
            "refusing to write through it to a target outside the checkout",
        );
      }
      const current = stat === undefined ? undefined : await readFile(abs, "utf8");
      if (current !== plan.validated) {
        throw new Error(
          `bootstrap: ${plan.rel} in ${targetRoot} changed after validation — ` +
            "a concurrent edit; refusing to merge with unvalidated content",
        );
      }
      await writeFile(abs, plan.content, "utf8");
      if (plan.existed) updated.push(plan.rel);
      else created.push(plan.rel);
    }
    await validateEmittedArtifacts(targetRoot, appName, repoSlug, created, updated);
  } catch (error) {
    for (const rel of created) await rm(join(targetRoot, rel), { recursive: true, force: true });
    for (const rel of updated) {
      const validated = previousInstructions.get(rel);
      if (validated !== undefined) await writeFile(join(targetRoot, rel), validated, "utf8");
    }
    throw error;
  }

  return { created, updated };
}

export async function validateEmittedArtifacts(
  root: string,
  appName: string,
  repoSlug: string,
  created: readonly string[],
  updated: readonly string[],
): Promise<void> {
  const config = await loadApps(join(root, ".cormidia", "config.yaml"));
  const app = config.apps.find((entry) => entry.name === appName);
  if (config.schemaVersion !== 1 || app?.repo !== repoSlug || app.status !== "onboarding") {
    throw new Error("bootstrap: generated config failed schema validation");
  }
  const policy = parse(await readFile(join(root, ".cormidia", "policy.yaml"), "utf8"));
  if (!policy || typeof policy !== "object") throw new Error("bootstrap: generated policy is not a YAML mapping");
  const authorityText = await readFile(join(root, ".cormidia", "AUTHORITY.md"), "utf8");
  const authorityFrontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(authorityText)?.[1];
  const authorityMeta = authorityFrontmatter === undefined ? undefined : parse(authorityFrontmatter) as Record<string, unknown>;
  if (authorityMeta?.["schema_version"] !== 1 || authorityMeta["kind"] !== "cormidia-app-authority") {
    throw new Error("bootstrap: generated authority failed schema validation");
  }
  for (const rel of [...created, ...updated]) {
    const text = await readFile(join(root, rel), "utf8");
    if (!text.endsWith("\n")) throw new Error(`bootstrap: generated artifact lacks final newline: ${rel}`);
    if (text.split("\n").some((line) => /[ \t]+$/.test(line))) {
      throw new Error(`bootstrap: generated artifact has trailing whitespace: ${rel}`);
    }
  }
}

export interface ProjectInstructionPlan {
  rel: string;
  existed: boolean;
  /** Exact bytes at validation time (undefined when the file did not exist).
   * The write phase re-compares against this copy and refuses on drift —
   * F-PT-007: a concurrent human edit is never merged silently. */
  validated: string | undefined;
  content: string;
}

/** Plan the instruction-file writes from a validated read. A symlinked
 * instruction file is a typed refusal before mutation (contract B-14 §3):
 * following it would write through to a target outside the checkout. */
async function planProjectInstructionFiles(
  targetRoot: string,
  effectiveAuthority: AuthorityContext,
): Promise<ProjectInstructionPlan[]> {
  const instructionBlock = projectAuthorityBlock(
    ".cormidia/AUTHORITY.md",
    effectiveAuthority,
  );
  return Promise.all(
    AGENT_DOCS.map(async (rel) => {
      const path = join(targetRoot, rel);
      const stat = lstatSync(path, { throwIfNoEntry: false });
      if (stat?.isSymbolicLink()) {
        throw new Error(
          `bootstrap: ${rel} in ${targetRoot} is a symbolic link — ` +
            "refusing to write through it to a target outside the checkout",
        );
      }
      const existed = stat !== undefined;
      const existing = existed ? await readFile(path, "utf8") : `# ${rel}\n`;
      return {
        rel,
        existed,
        validated: existed ? existing : undefined,
        content: composeProjectInstructions(existing, instructionBlock),
      };
    }),
  );
}

async function readPolicyTemplate(templateRoot: string): Promise<string> {
  const path = join(templateRoot, POLICY_TEMPLATE_REL);
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    throw new Error(
      `bootstrap: policy template ${path} is missing or unreadable — ` +
        `.cormidia/policy.yaml is app-owned bootstrap output; M6 consumes it and fails if missing ` +
        `(${e instanceof Error ? e.message : String(e)})`,
    );
  }
}

/** The app charter — TASTE layer [3] (docs/PURPOSE.md → TASTE layers): product
 * identity only. Budget/cadence/roles are config, so they live in
 * config.yaml, never here. */
function charterMd(appName: string, answers: BootstrapAnswers): string {
  return `# TASTE.md — ${appName} product charter

App-level taste, layer [3] of context assembly (docs/architecture.md §5;
docs/PURPOSE.md → TASTE layers): what this product is and what "good" means here.
Concatenated after the org constitution and role craft addenda — it
specializes defaults; the org's "What we never do" section stays
unoverridable. Seeded by \`cormidia bootstrap\` from the questionnaire; edit
freely via proposal PR (human-ratified surface — agent writes are
gate-critical).

## What this product is

${answers.product}

## What "good" means here

${answers.good}
`;
}

/** The app's registry mirror plus checkout-level extensions. `apps.<name>`
 * uses the same app-entry schema as apps.yaml and round-trips through
 * src/org/apps.ts loadApps. Gate commands are separate top-level keys because
 * they describe this checkout; they are never fields of `apps.<name>`.
 * `critical_ops` and `channels` remain inside the app entry. */
function configYaml(
  appName: string,
  repoSlug: string,
  slugIsPlaceholder: boolean,
  answers: BootstrapAnswers,
  allRoles: string[],
): string {
  // Enabled roles keep their overrides (or fall back to roles.yaml by
  // omission); disabled roles get the schema's disable mechanism — an
  // explicit empty trigger list. Built in roles.yaml order: deterministic.
  const cadence = cadenceForAnswers(answers, allRoles);

  const entry: Record<string, unknown> = {
    repo: repoSlug,
    status: "onboarding",
    budget_usd_month: answers.budgetUsdMonth,
    cadence,
    execution: appExecutionYaml(undefined),
    critical_ops: {
      deploy_commands: answers.criticalOps.deployCommands,
      publish_targets: answers.criticalOps.publishTargets,
      secret_locations: answers.criticalOps.secretLocations,
    },
  };
  const channels: Record<string, string[]> = {};
  if (answers.channels.support !== undefined) channels["support"] = answers.channels.support;
  if (answers.channels.marketing !== undefined) channels["marketing"] = answers.channels.marketing;
  if (Object.keys(channels).length > 0) entry["channels"] = channels;

  const header = `# .cormidia/config.yaml — app registry mirror plus checkout-level policy
# (docs/architecture.md §1, §9). Emitted by \`cormidia bootstrap\` from the
# questionnaire answers. Human-ratified surface: changes land via proposal
# PR; agent writes are gate-critical. schema_version is the public contract
# marker (§1 containment invariant).
#
# cadence: role -> trigger overrides. An entry REPLACES the role's
#   roles.yaml triggers; an EMPTY list disables the role for this app —
#   roles left un-enabled in the questionnaire appear here as [].
# critical_ops: app-specific extensions to the org gate's rule set
#   (§9 step 2: deploy commands, publish targets, secret locations).
# channels: what Support/Marketing watch and draft for, when enabled.
# execution.assignment_mode: fixed (configured tuple) or adaptive (one of the
#   org-approved candidate IDs, optionally narrowed per role). Assignment mode
#   changes assignment selection only; it never disables episode planning.
# release: the app's declared release mechanism (A4) — omitted until the
#   app has one. A milestone whose plan requires deploy/package fails the ship
#   gate unless this declares it. trigger: tag (the default when no command is
#   given) fires deploy by pushing the milestone's Release-version as a git tag
#   vX.Y.Z, so the app's deploy workflow must listen on push tags (v*), never
#   on push to the default branch; trigger: command runs a declared
#   command after merge instead. Examples:
#   release: { kind: deploy, owner: sre, trigger: tag }
#   release: { kind: deploy, owner: orchestrator, trigger: command, command: gh workflow run deploy.yml }
#   RQ-1 tag publication additionally declares approvers: [exact-github-login].
# setup_command/test_command/lint_command/e2e_test_command: checkout-level
#   quality gates. These keys are top-level siblings of apps, never fields
#   under apps.<name>.

`;

  const body = stringify({
    schema_version: 1,
    org: { name: appName, max_concurrent_turns: 2 },
    defaults: { budget_usd_month: 1000 },
    apps: { [appName]: entry },
  });

  let out = header + body;
  if (slugIsPlaceholder) {
    out = out.replace(`repo: ${repoSlug}`, `repo: ${repoSlug} # TODO: set the real owner/repo slug`);
  }
  return out;
}

function onboardingReportMd(
  appName: string,
  report: OnboardingGapReport,
  authority: AuthorityContext,
  selection: AppAuthoritySelection,
): string {
  const lines: string[] = [
    `# Cormidia Onboarding Report — ${appName}`,
    "",
    "This report inventories existing documentation and setup signals. It does not infer product truth from source code.",
    "",
    "Gaps are onboarding guidance, not blockers unless `.cormidia/config.yaml` or `.cormidia/policy.yaml` says so.",
    "",
    "## Documentation Inventory",
    "",
  ];

  for (const category of report.docInventory) {
    lines.push(`### ${category.label}`, "");
    if (category.paths.length > 0) {
      for (const path of category.paths) lines.push(`- ${path}`);
    } else {
      lines.push("- None detected");
    }
    lines.push("");
  }

  lines.push("## Missing Recommended Categories", "");
  if (report.missingRecommendedCategories.length > 0) {
    for (const category of report.missingRecommendedCategories) {
      lines.push(`- ${category.label}: ${category.guidance}`);
    }
  } else {
    lines.push("- None detected");
  }
  lines.push("");

  lines.push("## Setup Signals", "");
  lines.push(`- Build: ${commandLine(report.setupSignals.build)}`);
  lines.push(`- Test: ${commandLine(report.setupSignals.test)}`);
  lines.push(`- Lint: ${commandLine(report.setupSignals.lint)}`);
  lines.push(`- CI: ${listLine(report.setupSignals.ciConfigs)}`);
  lines.push(`- Deploy hints: ${listLine(report.setupSignals.deployHints)}`);
  lines.push(`- GitHub remote: ${report.setupSignals.repoSlug ?? "none detected"}`);
  lines.push("");

  lines.push("## Role Readiness Notes", "");
  for (const note of report.roleReadinessNotes) {
    lines.push(`- ${note.role} (${note.severity}): ${note.message}`);
  }
  lines.push("");

  const preview = authorityPreview(
    authority.profile === "conservative"
      ? "conservative"
      : authority.profile === "custom"
        ? "custom"
        : "delegated-operator",
  );
  lines.push("## Delegated Operator Authority", "");
  lines.push(`- App selection: ${selection.mode}`);
  lines.push(`- Effective version: ${authority.version}`);
  lines.push(`- Effective SHA-256: ${authority.sha256}`);
  if (selection.restrictions !== undefined) {
    lines.push(`- App restrictions: ${selection.restrictions}`);
  }
  lines.push("", "### Automatic", "");
  for (const action of preview.automatic) lines.push(`- ${action}`);
  lines.push("", "### Human-gated", "");
  for (const action of preview.humanGated) lines.push(`- ${action}`);
  lines.push("");

  return `${lines.join("\n")}`;
}

function commandLine(detection: CommandDetection | undefined): string {
  return detection ? `${detection.command} (${detection.source})` : "none detected";
}

function listLine(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "none detected";
}

/** Seeded per-(role, app) OKF bundle index (architecture §6): the
 * always-included excerpt layer, one line per document — empty at birth. */
function memoryIndexMd(role: string, appName: string): string {
  return `# ${role} — ${appName} domain memory (INDEX)

Per-(role, app) OKF bundle (docs/architecture.md §6): what the ${role} role
knows about this product. This INDEX is the always-included excerpt layer —
one line per document in the bundle. Seeded empty by \`cormidia bootstrap\`;
the role appends lessons at end of turn (deliberately agent-writable routine
op) and the weekly curation pass dedupes, prunes, and promotes.

(no documents yet)
`;
}

function cadenceForAnswers(answers: BootstrapAnswers, allRoles: string[]): Record<string, Trigger[]> {
  const cadence: Record<string, Trigger[]> = {};
  for (const role of allRoles) {
    if (!answers.roles.includes(role)) cadence[role] = [];
    else if (answers.cadence[role]) cadence[role] = answers.cadence[role];
  }
  return cadence;
}

export interface BootstrapRunOptions {
  /** App name; defaults to the target root's basename. */
  appName?: string;
  /** GitHub slug; defaults to the scanned origin remote, else placeholder. */
  repoSlug?: string;
  /** Package template root for app policy emission; defaults to this package. */
  templateRoot?: string;
  /** Required existing org home. Bootstrap emits app artifacts in the target
   * repo and appends the app to `${orgHome}/apps.yaml`. */
  orgHome: string;
  /** Resolved runtime state. When supplied, the normalized non-secret answer
   * record is persisted for reset/recovery. */
  stateHome?: string;
}

export interface BootstrapRunResult {
  scan: RepoScan;
  answers: BootstrapAnswers;
  /** Relative app-repo paths written, in emission order. */
  created: string[];
  updated: string[];
  /** Existing org home joined by this run. */
  joinedOrgHome: string;
}

/** The whole bootstrap (architecture §9): scan, validate questionnaire
 * answers against the active org's roles, register the app, and emit app-owned
 * artifacts. Answers and target paths are validated before the first write. */
export async function bootstrapRun(
  targetRootIn: string,
  answersRaw: unknown,
  options: BootstrapRunOptions,
): Promise<BootstrapRunResult> {
  const targetRoot = resolve(targetRootIn);
  const templateRoot = options.templateRoot ?? PACKAGE_ROOT;
  const appName = sanitizeAppName(options.appName ?? basename(targetRoot));
  const orgHome = resolve(options.orgHome);

  const allRoles = (await loadRoles(join(orgHome, "roles.yaml"))).roles.map((role) => role.name);
  const answers = parseAnswers(answersRaw, allRoles);
  assertNonSecretOnboardingAnswers(answers);

  const scan = await scanRepo(targetRoot);
  const repoSlug = options.repoSlug ?? scan.repoSlug;
  const registrationRepoSlug = repoSlug ?? `OWNER/${appName}`;

  assertNoRetiredAppArtifactRoot(targetRoot);
  const appFiles = appArtifactFiles(answers, allRoles);
  assertNotExists(targetRoot, appFiles);
  assertNotSymlinked(targetRoot, appFiles);

  const orgAuthority = await resolveAuthority({ orgHome });
  // Composition errors must surface before apps.yaml or the app repo changes.
  // The plans double as the command's validated copy: emitAppArtifacts' write
  // phase compares each instruction file against these bytes and refuses on
  // drift (F-PT-007) instead of re-planning from a fresh — possibly
  // concurrently human-edited — read.
  const instructionPlans = await planProjectInstructionFiles(
    targetRoot,
    applyAppAuthority(orgAuthority, answers.authority),
  );

  if (options.stateHome !== undefined) {
    if (existsSync(onboardingAnswersPath(options.stateHome, appName))) {
      throw new Error(`bootstrap: onboarding answer state already exists for ${appName}`);
    }
    await storeOnboardingAnswers(options.stateHome, appName, answers);
  }

  let joined: Awaited<ReturnType<typeof joinExistingOrg>> | undefined;
  try {
    joined = await joinExistingOrg(
      orgHome,
      registrationFromAnswers(appName, registrationRepoSlug, answers, allRoles),
    );

    const appOptions: EmitAppArtifactsOptions = { appName, answers, scan, allRoles, templateRoot };
    appOptions.orgAuthority = orgAuthority;
    appOptions.instructionPlans = instructionPlans;
    if (repoSlug) appOptions.repoSlug = repoSlug;
    const app = await emitAppArtifacts(targetRoot, appOptions);

    return {
      scan,
      answers,
      created: app.created,
      updated: app.updated,
      joinedOrgHome: joined.orgHome,
    };
  } catch (error) {
    if (joined !== undefined) await removeExistingApp(orgHome, appName).catch(() => undefined);
    if (options.stateHome !== undefined) {
      const answersPath = onboardingAnswersPath(options.stateHome, appName);
      await rm(answersPath, { force: true });
      await rmdir(dirname(answersPath)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
      });
    }
    throw error;
  }
}

function registrationFromAnswers(
  appName: string,
  repoSlug: string,
  answers: BootstrapAnswers,
  allRoles: string[],
): AppRegistration {
  const channels: Record<string, string[]> = {};
  if (answers.channels.support !== undefined) channels["support"] = answers.channels.support;
  if (answers.channels.marketing !== undefined) channels["marketing"] = answers.channels.marketing;
  return {
    name: appName,
    repo: repoSlug,
    status: "onboarding",
    budgetUsdMonth: answers.budgetUsdMonth,
    cadence: cadenceForAnswers(answers, allRoles),
    execution: normalizeAppExecution(undefined),
    ...(Object.keys(channels).length > 0 ? { channels } : {}),
  };
}

export interface RegisterExistingOrgOptions {
  appName?: string;
  repoSlug?: string;
  orgHome: string;
}

export interface RegisterExistingOrgResult {
  scan: RepoScan;
  appName: string;
  joinedOrgHome: string;
}

/** Register-only path for `cormidia bootstrap <repo> --org-home <org>` when no
 * questionnaire answers are supplied: scan the repo and append it to the
 * existing org registry, leaving app artifacts for a later answers run. */
export async function registerAppWithExistingOrg(
  targetRootIn: string,
  options: RegisterExistingOrgOptions,
): Promise<RegisterExistingOrgResult> {
  const targetRoot = resolve(targetRootIn);
  const scan = await scanRepo(targetRoot);
  const appName = sanitizeAppName(options.appName ?? basename(targetRoot));
  const repo = options.repoSlug ?? scan.repoSlug ?? `OWNER/${appName}`;
  const joined = await joinExistingOrg(options.orgHome, {
    name: appName,
    repo,
    status: "onboarding",
    cadence: {},
    execution: normalizeAppExecution(undefined),
  });
  return { scan, appName, joinedOrgHome: joined.orgHome };
}
