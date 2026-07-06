// `operon bootstrap` — the non-interactive half (build plan M3.3).
//
// docs/architecture.md §9: bootstrap runs inside the product repo. Step 1
// ("Learn") is `scanRepo()` — language/build/test commands from manifests and
// CI config, agent docs (CLAUDE.md / AGENTS.md), deploy hints. Step 3
// ("Emit"), single-app profile only, is `emitOrgTemplates()` — the
// `.operon/org/` skeleton (org TASTE.md, roles.yaml, apps.yaml) "templated
// from this repo's root files, which are instance config destined to become
// exactly these templates" (PURPOSE v0.8 dogfood note, made real here:
// TASTE.md and roles.yaml are byte-copies of this package's root files).
//
// Step 2 (questionnaire → app charter/config) is M3.4; step 4 (detect and
// join an existing org) is M3.5. Nothing here writes outside the target
// repo's `.operon/org/`.

import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

  for (const rel of ORG_TEMPLATE_FILES) {
    if (existsSync(join(targetRoot, rel))) {
      throw new Error(
        `bootstrap: ${rel} already exists in ${targetRoot} — refusing to overwrite ` +
          `(an existing org joins via \`operon bootstrap\` M3.5, never gets re-emitted)`,
      );
    }
  }

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
