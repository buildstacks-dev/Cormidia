// `operon bootstrap` — runs inside the product repo (docs/architecture.md §9).
//
// Step 1 ("Learn") is `scanRepo()` — language/build/test commands from
// manifests and CI config, agent docs (CLAUDE.md / AGENTS.md), deploy hints.
// Step 2 ("Questionnaire") is the `BootstrapAnswers` contract + `parseAnswers`
// — interactive collection lives in the CLI; tests and scripts inject the
// same object via `--answers answers.json`. Step 3 ("Emit") is
// `emitOrgTemplates()` — the single-app-profile `.operon/org/` skeleton
// (org TASTE.md, roles.yaml, apps.yaml) "templated from this repo's root
// files, which are instance config destined to become exactly these
// templates" (PURPOSE v0.8 dogfood note; TASTE.md and roles.yaml are
// byte-copies) — plus `emitAppArtifacts()`: the app charter
// (`.operon/TASTE.md`), the app's registry entry (`.operon/config.yaml`,
// apps.yaml schema), and seeded per-role memory bundles. `bootstrapRun()`
// composes steps 1–3. Step 4 ("Register / join") appends a second app to an
// existing org home's apps.yaml instead of emitting a parallel `.operon/org/`.
// App-owned bootstrap output also includes `.operon/policy.yaml` when the
// M4.2 policy template is present in this package.

import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import type { Trigger } from "../runtime/types.js";
import { joinExistingOrg, type AppRegistration } from "./apps.js";
import { loadRoles } from "./roles.js";

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

/** Learn a target repo (architecture §9 step 1). Purely observational: reads
 * files, runs nothing, writes nothing. Absence of anything is reported as
 * absent fields / empty lists — never an error. */
export async function scanRepo(rootIn: string): Promise<RepoScan> {
  const root = resolve(rootIn);
  const scan: RepoScan = { root, agentDocs: [], ciConfigs: [], deployHints: [] };

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

  return scan;
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

// ---------------------------------------------------------------------------
// Step 3 (single-app profile) — emitOrgTemplates()
// ---------------------------------------------------------------------------

/** Relative paths `emitOrgTemplates` creates — the `--scan-only` would-create
 * list and the emit implementation share this single source of truth. */
export const ORG_TEMPLATE_FILES = [
  ".operon/org/TASTE.md",
  ".operon/org/roles.yaml",
  ".operon/org/apps.yaml",
] as const;

export interface EmitOrgTemplatesOptions {
  /** App (and default org) name; defaults to the target root's basename. */
  appName?: string;
  /** GitHub `owner/repo` slug for the app entry; defaults to the scanned
   * value when the caller passes one, else a marked placeholder. */
  repoSlug?: string;
  /** Where the TASTE.md / roles.yaml templates live. Defaults to this
   * package's root — the dogfood instance config that IS the template. */
  templateRoot?: string;
}

export interface EmitResult {
  /** Relative paths written, in emission order. */
  created: string[];
}

/** This package's root (works from both src/ and dist/ — two levels up). */
const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const POLICY_TEMPLATE_REL = join("docs", "policy.yaml.template");

/** Emit the single-app-profile `.operon/org/` skeleton into a target repo:
 * org TASTE.md and roles.yaml as byte-copies of the template root's files,
 * plus a generated apps.yaml stub carrying `schema_version`. Refuses to
 * overwrite — bootstrap never silently clobbers an existing org. */
export async function emitOrgTemplates(
  targetRootIn: string,
  options: EmitOrgTemplatesOptions = {},
): Promise<EmitResult> {
  const targetRoot = resolve(targetRootIn);
  const templateRoot = options.templateRoot ?? PACKAGE_ROOT;
  const appName = sanitizeAppName(options.appName ?? basename(targetRoot));
  const repoSlug = options.repoSlug ?? `OWNER/${appName}`;
  const repoComment = options.repoSlug ? "" : " # TODO: set the real owner/repo slug";

  assertNotExists(targetRoot, ORG_TEMPLATE_FILES);

  const orgDir = join(targetRoot, ".operon", "org");
  await mkdir(orgDir, { recursive: true });

  const created: string[] = [];
  const emit = async (rel: (typeof ORG_TEMPLATE_FILES)[number], content: string) => {
    await writeFile(join(targetRoot, rel), content, "utf8");
    created.push(rel);
  };

  // Byte-identical copies: the root files ARE the templates (PURPOSE v0.8).
  await emit(".operon/org/TASTE.md", await readFile(join(templateRoot, "TASTE.md"), "utf8"));
  await emit(".operon/org/roles.yaml", await readFile(join(templateRoot, "roles.yaml"), "utf8"));
  await emit(".operon/org/apps.yaml", appsYamlStub(appName, repoSlug, repoComment));

  return { created };
}

/** apps.yaml keys are plain YAML scalars — keep names to safe characters. */
function sanitizeAppName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "app";
}

/** Bootstrap never silently clobbers an existing org — checked for every
 * target file BEFORE the first write, so a failed run leaves no half-tree. */
function assertNotExists(targetRoot: string, rels: readonly string[]): void {
  for (const rel of rels) {
    if (existsSync(join(targetRoot, rel))) {
      throw new Error(
        `bootstrap: ${rel} already exists in ${targetRoot} — refusing to overwrite ` +
          `(an existing org joins via \`operon bootstrap\` M3.5, never gets re-emitted)`,
      );
    }
  }
}

function appsYamlStub(appName: string, repoSlug: string, repoComment: string): string {
  return `# apps.yaml — app registry (docs/architecture.md §7), emitted by
# \`operon bootstrap\` (single-app profile). Human-ratified surface: changes
# land via proposal PR, never silent edits. Graduation to an org-home repo
# is \`git mv .operon/org/* <org-home>/\` (docs/architecture.md §1).

schema_version: 1

org:
  name: ${appName}              # org id defaults to the repo name (architecture.md §1)
  max_concurrent_turns: 2       # org-level WIP limit (architecture.md §2)

defaults:
  budget_usd_month: 1000        # decided 2026-07-04; configurable per app

apps:
  ${appName}:
    repo: ${repoSlug}${repoComment}
    status: onboarding
    cadence: {}                 # role -> trigger overrides; empty = roles.yaml defaults
`;
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

  const allowedKeys = ["product", "good", "roles", "budgetUsdMonth", "cadence", "criticalOps", "channels"];
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

  return { product, good, roles, budgetUsdMonth, cadence, criticalOps, channels };
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
  /** App (and config org) name — same defaulting as emitOrgTemplates. */
  appName: string;
  /** GitHub `owner/repo` slug; a marked placeholder when absent. */
  repoSlug?: string;
  /** Parsed questionnaire answers (parseAnswers). */
  answers: BootstrapAnswers;
  /** Every role in the org roles.yaml, in file order. Emission order for
   * memory bundles; the complement of answers.roles gets an explicit empty
   * cadence override (= disabled, src/org/apps.ts semantics). */
  allRoles: string[];
  /** Template root for docs/policy.yaml.template; defaults to this package. */
  templateRoot?: string;
}

/** Relative paths emitAppArtifacts will create for a given answers object. */
export function appArtifactFiles(answers: BootstrapAnswers, allRoles: string[]): string[] {
  const enabled = allRoles.filter((r) => answers.roles.includes(r));
  return [
    ".operon/TASTE.md",
    ".operon/config.yaml",
    ".operon/policy.yaml",
    ...enabled.map((role) => `.operon/memory/${role}/INDEX.md`),
  ];
}

/** Emit the app-level artifacts (architecture §9 step 3, first three
 * bullets): the product charter, the app's registry entry, and one seeded
 * OKF memory bundle per enabled role. All content is deterministic — no
 * timestamps — because the charter is context layer [3] and layers [1]–[4]
 * must stay a pure function of ratified files (§5 cache-stable rule 1). */
export async function emitAppArtifacts(
  targetRootIn: string,
  options: EmitAppArtifactsOptions,
): Promise<EmitResult> {
  const targetRoot = resolve(targetRootIn);
  const { answers, allRoles } = options;
  const appName = sanitizeAppName(options.appName);
  const repoSlug = options.repoSlug ?? `OWNER/${appName}`;
  const templateRoot = options.templateRoot ?? PACKAGE_ROOT;

  const files = appArtifactFiles(answers, allRoles);
  assertNotExists(targetRoot, files);
  const policyTemplate = await readPolicyTemplate(templateRoot);

  const created: string[] = [];
  const emit = async (rel: string, content: string) => {
    const abs = join(targetRoot, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    created.push(rel);
  };

  await emit(".operon/TASTE.md", charterMd(appName, answers));
  await emit(
    ".operon/config.yaml",
    configYaml(appName, repoSlug, options.repoSlug === undefined, answers, allRoles),
  );
  await emit(".operon/policy.yaml", policyTemplate);
  for (const role of allRoles) {
    if (answers.roles.includes(role)) {
      await emit(`.operon/memory/${role}/INDEX.md`, memoryIndexMd(role, appName));
    }
  }

  return { created };
}

async function readPolicyTemplate(templateRoot: string): Promise<string> {
  const path = join(templateRoot, POLICY_TEMPLATE_REL);
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    throw new Error(
      `bootstrap: policy template ${path} is missing or unreadable — ` +
        `.operon/policy.yaml is app-owned bootstrap output; M6 consumes it and fails if missing ` +
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
unoverridable. Seeded by \`operon bootstrap\` from the questionnaire; edit
freely via proposal PR (human-ratified surface — agent writes are
gate-critical).

## What this product is

${answers.product}

## What "good" means here

${answers.good}
`;
}

/** The app's registry entry — same schema as apps.yaml (architecture §1),
 * so it round-trips through src/org/apps.ts loadApps. `critical_ops` and
 * `channels` ride inside the app entry (app-specific by definition); the
 * registry parser ignores what it doesn't know, the gate-extension loader
 * (M7) will read them. */
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

  const header = `# .operon/config.yaml — this app's registry entry, same schema as apps.yaml
# (docs/architecture.md §1, §9). Emitted by \`operon bootstrap\` from the
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

/** Seeded per-(role, app) OKF bundle index (architecture §6): the
 * always-included excerpt layer, one line per document — empty at birth. */
function memoryIndexMd(role: string, appName: string): string {
  return `# ${role} — ${appName} domain memory (INDEX)

Per-(role, app) OKF bundle (docs/architecture.md §6): what the ${role} role
knows about this product. This INDEX is the always-included excerpt layer —
one line per document in the bundle. Seeded empty by \`operon bootstrap\`;
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
  /** App (and org) name; defaults to the target root's basename. */
  appName?: string;
  /** GitHub slug; defaults to the scanned origin remote, else placeholder. */
  repoSlug?: string;
  /** Template root for org TASTE.md/roles.yaml; defaults to this package. */
  templateRoot?: string;
  /** Existing org home to join. When set, bootstrap emits app artifacts only
   * in the target repo and appends the app to `${orgHome}/apps.yaml`. */
  orgHome?: string;
}

export interface BootstrapRunResult {
  scan: RepoScan;
  answers: BootstrapAnswers;
  /** Relative paths written, org skeleton first, in emission order. */
  created: string[];
  /** Existing org home joined by this run, when any. */
  joinedOrgHome?: string;
}

/** The whole single-app bootstrap (architecture §9 steps 1–3): scan,
 * validate the questionnaire answers, then either emit the single-app org
 * skeleton plus app artifacts, or join an existing org and emit app artifacts
 * only. Answers are validated and every target path existence-checked BEFORE
 * the first write — a failed bootstrap leaves no half-tree in the app repo. */
export async function bootstrapRun(
  targetRootIn: string,
  answersRaw: unknown,
  options: BootstrapRunOptions = {},
): Promise<BootstrapRunResult> {
  const targetRoot = resolve(targetRootIn);
  const templateRoot = options.templateRoot ?? PACKAGE_ROOT;
  const appName = sanitizeAppName(options.appName ?? basename(targetRoot));

  const allRoles = await templateRoleNames(templateRoot);
  const answers = parseAnswers(answersRaw, allRoles);

  const scan = await scanRepo(targetRoot);
  const repoSlug = options.repoSlug ?? scan.repoSlug;
  const registrationRepoSlug = repoSlug ?? `OWNER/${appName}`;

  const appFiles = appArtifactFiles(answers, allRoles);
  assertNotExists(targetRoot, [...(options.orgHome ? [] : ORG_TEMPLATE_FILES), ...appFiles]);

  let orgCreated: string[] = [];
  let joinedOrgHome: string | undefined;
  if (options.orgHome) {
    const joined = await joinExistingOrg(
      options.orgHome,
      registrationFromAnswers(appName, registrationRepoSlug, answers, allRoles),
    );
    joinedOrgHome = joined.orgHome;
  } else {
    const orgOptions: EmitOrgTemplatesOptions = { appName, templateRoot };
    if (repoSlug) orgOptions.repoSlug = repoSlug;
    const org = await emitOrgTemplates(targetRoot, orgOptions);
    orgCreated = org.created;
  }

  const appOptions: EmitAppArtifactsOptions = { appName, answers, allRoles, templateRoot };
  if (repoSlug) appOptions.repoSlug = repoSlug;
  const app = await emitAppArtifacts(targetRoot, appOptions);

  return {
    scan,
    answers,
    created: [...orgCreated, ...app.created],
    ...(joinedOrgHome ? { joinedOrgHome } : {}),
  };
}

function registrationFromAnswers(
  appName: string,
  repoSlug: string,
  answers: BootstrapAnswers,
  allRoles: string[],
): AppRegistration {
  return {
    name: appName,
    repo: repoSlug,
    status: "onboarding",
    budgetUsdMonth: answers.budgetUsdMonth,
    cadence: cadenceForAnswers(answers, allRoles),
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

/** Register-only path for `operon bootstrap <repo> --org-home <org>` when no
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
  });
  return { scan, appName, joinedOrgHome: joined.orgHome };
}
