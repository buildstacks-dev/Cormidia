// Additive, archive-backed organization schema migration. Upgrade never
// overwrites a present ratified surface: it adds missing packaged surfaces and
// adds the public schema marker to a legacy registry.

import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { resolveAuthority, writeOrgAuthority, type AuthorityProfile } from "./authority.js";
import { ORG_REQUIRED_FILES, PACKAGE_ROOT, validateOrgHome } from "./home.js";
import {
  LIFECYCLE_SCHEMA_VERSION,
  acquireLifecycleOperationLock,
  assertDirectoryNoSymlink,
  assertRegularFile,
  assertSafeRelativePath,
  emitLifecycleStep,
  isInside,
  sha256,
  stableJson,
  type LifecycleFaultHook,
} from "./lifecycle.js";

const ADDITIVE_FILES = ["TASTE.md", "roles.yaml", "pipelines.yaml"] as const;
const ADDITIVE_TREES = ["prompts", "taste"] as const;

export type UpgradeAuthorityChoice = "preserve" | AuthorityProfile;

export interface OrgUpgradeOptions {
  orgHome: string;
  stateHome: string;
  authorityChoice?: UpgradeAuthorityChoice;
  authorityCustomText?: string;
  authorityGrantedBy?: string;
  templateRoot?: string;
  archiveRoot?: string;
  fault?: LifecycleFaultHook;
}

interface OrgUpgradeChange {
  path: string;
  action: "add" | "schema_add";
  detail: string;
}

interface OrgUpgradePlan {
  schema_version: typeof LIFECYCLE_SCHEMA_VERSION;
  kind: "org-upgrade-plan";
  org_home: string;
  state_home: string;
  current_schema: number;
  target_schema: number;
  authority: { present: boolean; choice: UpgradeAuthorityChoice | "required" };
  changes: OrgUpgradeChange[];
  archive_root: string;
  archive_id: string;
  executable: boolean;
  blockers: Array<{ code: string; remediation: string }>;
}

interface OrgUpgradeResult {
  schema_version: typeof LIFECYCLE_SCHEMA_VERSION;
  kind: "org-upgrade-result";
  status: "upgraded" | "up_to_date";
  plan: OrgUpgradePlan;
  archive_path: string | null;
  doctor: { status: "pass"; detail: string };
}

export async function planOrgUpgrade(options: OrgUpgradeOptions): Promise<OrgUpgradePlan> {
  const orgHome = await assertDirectoryNoSymlink(resolve(options.orgHome), "org upgrade home");
  const stateHome = resolve(options.stateHome);
  const templateRoot = resolve(options.templateRoot ?? PACKAGE_ROOT);
  await assertDirectoryNoSymlink(templateRoot, "org upgrade template root");
  const archiveRoot = resolve(options.archiveRoot ?? join(dirname(stateHome), "archives", "org-upgrades"));
  if (isInside(archiveRoot, stateHome)) throw new Error("org upgrade: archive root must be outside the state home");

  const appsPath = join(orgHome, "apps.yaml");
  if (!existsSync(appsPath)) throw new Error(`org upgrade: legacy org is missing apps.yaml: ${appsPath}`);
  await assertRegularFile(appsPath, "org upgrade apps.yaml");
  const appsText = await readFile(appsPath, "utf8");
  const appsRaw = parse(appsText) as Record<string, unknown>;
  if (!appsRaw || typeof appsRaw !== "object" || Array.isArray(appsRaw)) {
    throw new Error(`org upgrade: apps.yaml is not a mapping: ${appsPath}`);
  }
  const currentSchema = typeof appsRaw["schema_version"] === "number" ? appsRaw["schema_version"] : 0;
  if (currentSchema > LIFECYCLE_SCHEMA_VERSION) {
    throw new Error(`org upgrade: org schema ${currentSchema} is newer than supported ${LIFECYCLE_SCHEMA_VERSION}`);
  }

  const changes: OrgUpgradeChange[] = [];
  if (currentSchema < LIFECYCLE_SCHEMA_VERSION) {
    changes.push({
      path: "apps.yaml",
      action: "schema_add",
      detail: `schema_version ${currentSchema} -> ${LIFECYCLE_SCHEMA_VERSION}`,
    });
  }
  for (const rel of ADDITIVE_FILES) {
    if (!existsSync(join(orgHome, rel)))
      changes.push({ path: rel, action: "add", detail: "copy packaged ratified surface" });
  }
  for (const rel of ADDITIVE_TREES) {
    if (!existsSync(join(templateRoot, rel))) continue;
    for (const packagedPath of await additiveTreeFiles(templateRoot, rel)) {
      if (!existsSync(join(orgHome, packagedPath))) {
        changes.push({
          path: packagedPath,
          action: "add",
          detail: `copy missing packaged ratified ${rel} surface`,
        });
      }
    }
  }
  // validateOrgHome also expects all required files; name them explicitly if
  // the packaged surface list changes later.
  for (const rel of ORG_REQUIRED_FILES) {
    if (
      rel !== "apps.yaml" &&
      !existsSync(join(orgHome, rel)) &&
      !changes.some((change) => change.path === rel || change.path.startsWith(`${rel}/`))
    ) {
      changes.push({ path: rel, action: "add", detail: "copy required packaged surface" });
    }
  }
  const authorityPresent = existsSync(join(orgHome, "AUTHORITY.md"));
  if (!authorityPresent)
    changes.push({ path: "AUTHORITY.md", action: "add", detail: "write explicit authority choice" });

  const blockers: Array<{ code: string; remediation: string }> = [];
  const authorityChoice = options.authorityChoice ?? (authorityPresent ? "preserve" : "required");
  if (!authorityPresent && (options.authorityChoice === undefined || options.authorityChoice === "preserve")) {
    blockers.push({
      code: "authority_choice_required",
      remediation: "rerun with --authority delegated-operator|conservative|custom",
    });
  }
  if (authorityPresent && options.authorityChoice !== undefined && options.authorityChoice !== "preserve") {
    const existing = await resolveAuthority({ orgHome });
    if (existing.profile !== options.authorityChoice) {
      blockers.push({
        code: "authority_already_present",
        remediation: "use --authority preserve; upgrade never rewrites an existing authority charter",
      });
    }
  }
  if (options.authorityChoice === "custom" && (!options.authorityCustomText || !options.authorityGrantedBy)) {
    blockers.push({
      code: "custom_authority_incomplete",
      remediation: "custom authority requires --authority-file and --authority-by",
    });
  }

  const identity = sha256(stableJson({ currentSchema, changes, authorityChoice, orgHome }));
  return {
    schema_version: LIFECYCLE_SCHEMA_VERSION,
    kind: "org-upgrade-plan",
    org_home: orgHome,
    state_home: stateHome,
    current_schema: currentSchema,
    target_schema: LIFECYCLE_SCHEMA_VERSION,
    authority: { present: authorityPresent, choice: authorityChoice },
    changes,
    archive_root: archiveRoot,
    archive_id: `${basename(orgHome).replace(/[^A-Za-z0-9._-]+/g, "-")}-upgrade-${identity.slice(0, 16)}`,
    executable: blockers.length === 0,
    blockers,
  };
}

export async function executeOrgUpgrade(
  options: OrgUpgradeOptions,
  reviewedPlan?: OrgUpgradePlan,
): Promise<OrgUpgradeResult> {
  const release = await acquireLifecycleOperationLock(resolve(options.stateHome), "_org-upgrade", "org upgrade");
  try {
    return await executeOrgUpgradeLocked(options, reviewedPlan);
  } finally {
    await release();
  }
}

async function executeOrgUpgradeLocked(
  options: OrgUpgradeOptions,
  reviewedPlan?: OrgUpgradePlan,
): Promise<OrgUpgradeResult> {
  const plan = reviewedPlan ?? (await planOrgUpgrade(options));
  if (!plan.executable) throw new Error(`org upgrade: blocked — ${plan.blockers.map((item) => item.code).join(", ")}`);
  const fresh = await planOrgUpgrade(options);
  if (stableJson(fresh) !== stableJson(plan)) throw new Error("org upgrade: reviewed plan is stale; preview again");
  if (plan.changes.length === 0) {
    await validateOrgHome(plan.org_home);
    await emitLifecycleStep({
      stateHome: plan.state_home,
      app: "_org",
      operation: "org upgrade",
      inputFingerprint: plan.archive_id,
      status: "completed",
      reason: "org schema and authority surfaces are already current",
    });
    return {
      schema_version: LIFECYCLE_SCHEMA_VERSION,
      kind: "org-upgrade-result",
      status: "up_to_date",
      plan,
      archive_path: null,
      doctor: { status: "pass", detail: "post-upgrade doctor: org configuration valid" },
    };
  }

  const archivePath = await createUpgradeArchive(plan, options.fault);
  const staged = await stageUpgrade(plan, options);
  const applied: string[] = [];
  const startedAt = new Date();
  try {
    for (const change of plan.changes) {
      const rel = change.path.replace(/\/$/, "");
      const source = join(staged, rel);
      const target = join(plan.org_home, rel);
      await options.fault?.(rel === "apps.yaml" ? "before_registry_write" : "before_config_write");
      if (existsSync(target)) {
        if (change.action === "add") {
          throw new Error(`org upgrade: additive target appeared after preview; refusing to overwrite ${target}`);
        }
        const info = await lstat(target);
        if (info.isSymbolicLink()) throw new Error(`org upgrade: symlink target forbidden: ${target}`);
        await rm(target, { recursive: true, force: true });
      }
      await mkdir(dirname(target), { recursive: true });
      await rename(source, target);
      applied.push(rel);
      await options.fault?.(rel === "apps.yaml" ? "after_registry_write" : "after_config_write");
    }
    await validateOrgHome(plan.org_home);
    await resolveAuthority({ orgHome: plan.org_home });
  } catch (error) {
    await restoreUpgradeArchive(plan, archivePath, applied);
    throw error;
  } finally {
    await rm(staged, { recursive: true, force: true });
  }

  await emitLifecycleStep({
    stateHome: plan.state_home,
    app: "_org",
    operation: "org upgrade",
    inputFingerprint: plan.archive_id,
    status: "completed",
    reason: `additive org upgrade completed with archive ${archivePath}`,
    startedAt,
  });
  return {
    schema_version: LIFECYCLE_SCHEMA_VERSION,
    kind: "org-upgrade-result",
    status: "upgraded",
    plan,
    archive_path: archivePath,
    doctor: { status: "pass", detail: "post-upgrade doctor: org configuration valid" },
  };
}

async function createUpgradeArchive(plan: OrgUpgradePlan, fault?: LifecycleFaultHook): Promise<string> {
  const target = join(plan.archive_root, plan.archive_id);
  if (existsSync(target)) {
    await verifyUpgradeArchive(target, plan);
    return target;
  }
  await fault?.("before_archive_creation");
  await mkdir(plan.archive_root, { recursive: true });
  const staged = `${target}.partial`;
  await rm(staged, { recursive: true, force: true });
  await mkdir(staged, { recursive: true });
  try {
    for (const change of plan.changes) {
      const rel = change.path.replace(/\/$/, "");
      const source = join(plan.org_home, rel);
      if (!existsSync(source)) continue;
      const info = await lstat(source);
      if (info.isSymbolicLink()) throw new Error(`org upgrade: symlink source forbidden: ${source}`);
      await cp(source, join(staged, "before", rel), { recursive: true, errorOnExist: true, force: false });
    }
    await fault?.("after_archive_creation");
    await fault?.("before_archive_checksum");
    const files = await fileManifest(staged);
    await writeFile(
      join(staged, "manifest.json"),
      stableJson({
        schema_version: LIFECYCLE_SCHEMA_VERSION,
        kind: "org-upgrade",
        archive_id: plan.archive_id,
        org_home: plan.org_home,
        changes: plan.changes,
        files,
      }),
      "utf8",
    );
    await fault?.("after_archive_checksum");
    await fault?.("before_archive_rename");
    await rename(staged, target);
    await fault?.("after_archive_rename");
    return target;
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
}

async function stageUpgrade(plan: OrgUpgradePlan, options: OrgUpgradeOptions): Promise<string> {
  const templateRoot = resolve(options.templateRoot ?? PACKAGE_ROOT);
  const staged = join(dirname(plan.org_home), `.${basename(plan.org_home)}.upgrade-stage-${plan.archive_id}`);
  await rm(staged, { recursive: true, force: true });
  await mkdir(staged, { recursive: true });
  try {
    for (const change of plan.changes) {
      const rel = change.path.replace(/\/$/, "");
      if (rel === "apps.yaml") {
        const before = await readFile(join(plan.org_home, rel), "utf8");
        const parsed = parse(before) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("org upgrade: invalid apps.yaml mapping");
        // Keep `apps:` as the final top-level mapping because registration's
        // byte-preserving append relies on that human-edit-friendly layout.
        const next = /^schema_version\s*:/m.test(before)
          ? before.replace(/^schema_version\s*:\s*\d+\s*$/m, `schema_version: ${LIFECYCLE_SCHEMA_VERSION}`)
          : `schema_version: ${LIFECYCLE_SCHEMA_VERSION}\n${before}`;
        await mkdir(dirname(join(staged, rel)), { recursive: true });
        await writeFile(join(staged, rel), next, "utf8");
      } else if (rel === "AUTHORITY.md") {
        const choice = options.authorityChoice;
        if (choice === undefined || choice === "preserve")
          throw new Error("org upgrade: explicit authority choice missing");
        await writeOrgAuthority(staged, choice, options.authorityCustomText, options.authorityGrantedBy);
      } else {
        const source = join(templateRoot, rel);
        if (!existsSync(source)) throw new Error(`org upgrade: packaged migration source missing: ${source}`);
        await mkdir(dirname(join(staged, rel)), { recursive: true });
        await cp(source, join(staged, rel), { recursive: true, errorOnExist: true, force: false });
      }
    }
    return staged;
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
}

async function restoreUpgradeArchive(plan: OrgUpgradePlan, archivePath: string, applied: string[]): Promise<void> {
  for (const rel of [...applied].reverse()) {
    const target = join(plan.org_home, rel);
    await rm(target, { recursive: true, force: true });
    const backup = join(archivePath, "before", rel);
    if (existsSync(backup)) await cp(backup, target, { recursive: true, errorOnExist: true, force: false });
  }
}

async function verifyUpgradeArchive(path: string, plan: OrgUpgradePlan): Promise<void> {
  const manifestPath = join(path, "manifest.json");
  await assertRegularFile(manifestPath, "org upgrade archive manifest");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  if (
    manifest["kind"] !== "org-upgrade" ||
    manifest["archive_id"] !== plan.archive_id ||
    manifest["org_home"] !== plan.org_home
  ) {
    throw new Error(`org upgrade: conflicting archive ${path}`);
  }
  const files = manifest["files"];
  if (!Array.isArray(files)) throw new Error(`org upgrade: invalid archive file manifest ${path}`);
  const declared: string[] = [];
  for (const item of files) {
    const spec = item as Record<string, unknown>;
    if (typeof spec?.["path"] !== "string" || typeof spec["sha256"] !== "string" || typeof spec["bytes"] !== "number") {
      throw new Error(`org upgrade: invalid archive file entry ${path}`);
    }
    assertSafeRelativePath(spec["path"], "org upgrade archive");
    declared.push(spec["path"]);
    const file = join(path, spec["path"]);
    await assertRegularFile(file, "org upgrade archive file");
    const content = await readFile(file);
    if (content.byteLength !== spec["bytes"] || sha256(content) !== spec["sha256"]) {
      throw new Error(`org upgrade: archive checksum mismatch for ${spec["path"]}`);
    }
  }
  const actual = (await fileManifest(path))
    .map((entry) => entry.path)
    .filter((entry) => entry !== "manifest.json")
    .sort();
  if (stableJson(actual) !== stableJson(declared.sort())) {
    throw new Error(`org upgrade: archive contains unchecksummed or missing paths ${path}`);
  }
}

async function fileManifest(root: string): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
  const records: Array<{ path: string; bytes: number; sha256: string }> = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`org upgrade: archive source symlink forbidden: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const content = await readFile(path);
        records.push({ path: relative(root, path), bytes: content.byteLength, sha256: sha256(content) });
      }
    }
  }
  await visit(root);
  return records.sort((a, b) => a.path.localeCompare(b.path));
}

/** Enumerate packaged tree leaves so upgrades can add a newly introduced
 * nested prompt/taste file without replacing any existing human-ratified
 * bytes. Directory-level copying made an already-present `prompts/` tree hide
 * every later packaged protocol addition. */
async function additiveTreeFiles(templateRoot: string, tree: string): Promise<string[]> {
  const root = join(templateRoot, tree);
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`org upgrade: packaged migration source symlink forbidden: ${path}`);
      }
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(templateRoot, path));
    }
  }
  await visit(root);
  return files.sort();
}
