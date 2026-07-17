// Operon's four-path boundary: installed package, committed org config,
// high-churn runtime state, and app repos. CLI commands resolve these paths
// once instead of treating process.cwd() as an implicit org home.

import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { loadPipelines } from "../loop/pipelines.js";
import { findExistingOrg, loadApps, type AppsFile } from "./apps.js";
import { loadRoles } from "./roles.js";
import {
  authorityPreview,
  composeProjectInstructions,
  projectAuthorityBlock,
  resolveAuthority,
  writeOrgAuthority,
  type AuthorityProfile,
} from "./authority.js";
import type { AuthorityContext } from "../runtime/types.js";

export const ORG_HOME_DEFINITION =
  "committed organization configuration: roles, apps, pipelines, prompts, authority, taste, and curated memory";
export const STATE_HOME_DEFINITION =
  "local high-churn runtime state: managed clones, worktrees, locks, approvals, telemetry, and run logs";

export const ORG_REQUIRED_FILES = ["TASTE.md", "roles.yaml", "apps.yaml", "pipelines.yaml"] as const;
export const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface OperonHomeOptions {
  orgHome?: string;
  stateHome?: string;
  env?: Partial<Pick<NodeJS.ProcessEnv, "OPERON_ORG_HOME" | "OPERON_STATE_HOME" | "OPERON_HOME">>;
  homeDir?: string;
  pointerPath?: string;
}

export interface OperonHomes {
  packageRoot: string;
  orgHome: string;
  stateHome: string;
  appsFile: AppsFile;
  pointerPath: string;
}

export async function resolveOperonHomes(options: OperonHomeOptions = {}): Promise<OperonHomes> {
  const homeDir = options.homeDir ?? homedir();
  const pointerPath = options.pointerPath ?? join(homeDir, ".operon", "config");
  const orgHome = await findExistingOrg({
    ...(options.orgHome !== undefined ? { orgHome: options.orgHome } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    homeDir,
    pointerPath,
  });
  if (orgHome === undefined) {
    throw new Error(
      "operon: no active org home — create one with `operon org init <path> --name <name>` " +
        "or select one with OPERON_ORG_HOME",
    );
  }
  await validateOrgHome(orgHome);
  const appsFile = await loadApps(join(orgHome, "apps.yaml"));
  const env = options.env ?? process.env;
  const pointer = await readActiveOrgPointer(pointerPath);
  const pointerStateHome = pointer.orgHome === resolve(orgHome) ? pointer.stateHome : undefined;
  const stateHome = resolve(
    options.stateHome ??
      env.OPERON_STATE_HOME ??
      pointerStateHome ??
      join(homeDir, ".operon", appsFile.org.name),
  );
  return { packageRoot: PACKAGE_ROOT, orgHome: resolve(orgHome), stateHome, appsFile, pointerPath };
}

export async function validateOrgHome(orgHomeIn: string): Promise<void> {
  const orgHome = resolve(orgHomeIn);
  for (const rel of ORG_REQUIRED_FILES) {
    if (!existsSync(join(orgHome, rel))) {
      throw new Error(
        `operon: ${orgHome} is not a complete org home — missing ${rel}; ` +
          "create a new one with `operon org init <path> --name <name>`",
      );
    }
  }
  if (!existsSync(join(orgHome, "prompts"))) {
    throw new Error(`operon: ${orgHome} is not a complete org home — missing prompts/`);
  }
  const roles = await loadRoles(join(orgHome, "roles.yaml"));
  await loadApps(join(orgHome, "apps.yaml"));
  await loadPipelines(join(orgHome, "pipelines.yaml"), {
    roleNames: roles.roles.map((role) => role.name),
    promptsDir: join(orgHome, "prompts"),
  });
  if (existsSync(join(orgHome, "AUTHORITY.md"))) {
    await resolveAuthority({ orgHome });
  }
}

export interface InitOrgHomeOptions {
  target: string;
  name: string;
  stateHome?: string;
  homeDir?: string;
  pointerPath?: string;
  templateRoot?: string;
  /** Explicit human choice made during onboarding. New orgs default to the
   * delegated-operator profile; legacy orgs without a file fail closed. */
  authorityProfile?: AuthorityProfile;
  authorityCustomText?: string;
  authorityGrantedBy?: string;
}

export interface InitOrgHomeResult extends OperonHomes {
  created: string[];
  authority: AuthorityContext;
  authorityPreview: ReturnType<typeof authorityPreview>;
}

export async function initOrgHome(options: InitOrgHomeOptions): Promise<InitOrgHomeResult> {
  const target = resolve(options.target);
  const name = sanitizeOrgName(options.name);
  if (existsSync(target)) {
    throw new Error(`operon org init: target already exists: ${target}`);
  }

  const templateRoot = resolve(options.templateRoot ?? PACKAGE_ROOT);
  const homeDir = options.homeDir ?? homedir();
  const pointerPath = options.pointerPath ?? join(homeDir, ".operon", "config");
  const stateHome = resolve(options.stateHome ?? join(homeDir, ".operon", name));
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const staged = await mkdtemp(join(parent, `.${basename(target)}.operon-init-`));
  const created: string[] = [];

  try {
    await copyFile(templateRoot, staged, "TASTE.md", created);
    await copyFile(templateRoot, staged, "roles.yaml", created);
    await copyFile(templateRoot, staged, "pipelines.yaml", created);
    await copyTree(templateRoot, staged, "prompts", created);
    if (existsSync(join(templateRoot, "taste"))) await copyTree(templateRoot, staged, "taste", created);

    const authority = await writeOrgAuthority(
      staged,
      options.authorityProfile ?? "delegated-operator",
      options.authorityCustomText,
      options.authorityGrantedBy,
    );
    created.push("AUTHORITY.md");
    const instructionBlock = projectAuthorityBlock("AUTHORITY.md", authority);
    for (const rel of ["AGENTS.md", "CLAUDE.md"]) {
      await writeFile(
        join(staged, rel),
        composeProjectInstructions(`# ${rel}\n`, instructionBlock),
        "utf8",
      );
      created.push(rel);
    }

    const roles = await loadRoles(join(staged, "roles.yaml"));
    const apps = emptyAppsYaml(name);
    await writeFile(join(staged, "apps.yaml"), apps, "utf8");
    created.push("apps.yaml");
    for (const role of roles.roles) {
      const rel = join("memory", "roles", role.name, "INDEX.md");
      await mkdir(dirname(join(staged, rel)), { recursive: true });
      await writeFile(join(staged, rel), "", "utf8");
      created.push(rel);
    }
    for (const rel of [join("skills", ".gitkeep"), join("retro", ".gitkeep")]) {
      await mkdir(dirname(join(staged, rel)), { recursive: true });
      await writeFile(join(staged, rel), "", "utf8");
      created.push(rel);
    }

    await validateOrgHome(staged);
    await rename(staged, target);
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }

  await mkdir(stateHome, { recursive: true });
  await writeActiveOrgPointer(pointerPath, target, stateHome);
  const appsFile = await loadApps(join(target, "apps.yaml"));
  const authority = await resolveAuthority({ orgHome: target });
  return {
    packageRoot: PACKAGE_ROOT,
    orgHome: target,
    stateHome,
    appsFile,
    pointerPath,
    created,
    authority,
    authorityPreview: authorityPreview(options.authorityProfile ?? "delegated-operator"),
  };
}

export async function writeActiveOrgPointer(
  pointerPathIn: string,
  orgHomeIn: string,
  stateHomeIn?: string,
): Promise<void> {
  const pointerPath = resolve(pointerPathIn);
  await mkdir(dirname(pointerPath), { recursive: true });
  const temp = `${pointerPath}.tmp-${process.pid}`;
  await writeFile(
    temp,
    stringify({
      org_home: resolve(orgHomeIn),
      ...(stateHomeIn !== undefined ? { state_home: resolve(stateHomeIn) } : {}),
    }),
    "utf8",
  );
  await rename(temp, pointerPath);
}

export async function readActiveOrgPointer(pointerPath: string): Promise<{
  orgHome?: string;
  stateHome?: string;
}> {
  if (!existsSync(pointerPath)) return {};
  const text = (await readFile(pointerPath, "utf8")).trim();
  if (text.length === 0) return {};
  try {
    const raw = parse(text) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const spec = raw as Record<string, unknown>;
    const orgHome = spec["org_home"] ?? spec["orgHome"];
    const stateHome = spec["state_home"] ?? spec["stateHome"];
    return {
      ...(typeof orgHome === "string" ? { orgHome: resolve(orgHome) } : {}),
      ...(typeof stateHome === "string" ? { stateHome: resolve(stateHome) } : {}),
    };
  } catch {
    return {};
  }
}

function sanitizeOrgName(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) throw new Error("operon org init: --name must contain a letter or number");
  return cleaned;
}

function emptyAppsYaml(name: string): string {
  return stringify({
    schema_version: 1,
    org: { name, max_concurrent_turns: 2 },
    defaults: { budget_usd_month: 1000 },
    apps: {},
  });
}

async function copyFile(sourceRoot: string, targetRoot: string, rel: string, created: string[]): Promise<void> {
  const content = await readFile(join(sourceRoot, rel));
  await mkdir(dirname(join(targetRoot, rel)), { recursive: true });
  await writeFile(join(targetRoot, rel), content);
  created.push(rel);
}

async function copyTree(sourceRoot: string, targetRoot: string, rel: string, created: string[]): Promise<void> {
  await cp(join(sourceRoot, rel), join(targetRoot, rel), { recursive: true });
  created.push(`${rel}/`);
}
