// Cormidia's four-path boundary: installed package, committed org config,
// high-churn runtime state, and app repos. CLI commands resolve these paths
// once instead of treating process.cwd() as an implicit org home.

import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { loadPipelines } from "../loop/pipelines.js";
import type { AuthorityContext, Effort, RuntimeKind, Trigger } from "../runtime/types.js";
import { findExistingOrg, loadApps, OrgIdentityError, type AppsFile } from "./apps.js";
import { writeFileAtomic } from "./atomic.js";
import {
  authorityPreview,
  composeProjectInstructions,
  CONSERVATIVE_VERSION,
  createOrgAuthorityDocument,
  DELEGATED_OPERATOR_VERSION,
  projectAuthorityBlock,
  resolveAuthority,
  type AuthorityProfile,
} from "./authority.js";
import { resolveAppAssignments } from "./execution-assignments.js";
import { stableJson } from "./lifecycle.js";
import { loadRoles } from "./roles.js";
import { definedProps } from "../runtime/optional-properties.js";

export const ORG_HOME_DEFINITION =
  "committed organization configuration: roles, apps, pipelines, prompts, authority, taste, and curated memory";
export const STATE_HOME_DEFINITION =
  "local high-churn runtime state: managed clones, worktrees, locks, approvals, telemetry, and run logs";

export const ORG_REQUIRED_FILES = ["TASTE.md", "roles.yaml", "apps.yaml", "pipelines.yaml"] as const;
export const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const CORMIDIA_HOME_DIRNAME = ".cormidia";

export interface CormidiaHomeOptions {
  orgHome?: string;
  stateHome?: string;
  env?: Partial<Pick<NodeJS.ProcessEnv, "CORMIDIA_ORG_HOME" | "CORMIDIA_STATE_HOME" | "CORMIDIA_HOME">>;
  homeDir?: string;
  pointerPath?: string;
}

export interface CormidiaHomes {
  packageRoot: string;
  orgHome: string;
  stateHome: string;
  appsFile: AppsFile;
  pointerPath: string;
}

type OrgLifecycleState =
  | { code: "no_active_org" }
  | { code: "active_org_missing"; orgHome: string }
  | { code: "org_home_incomplete"; orgHome: string; missing: string };
export class OrgLifecycleError extends Error {
  readonly code: OrgLifecycleState["code"];
  readonly publicMessage: string;
  readonly remediation: string;

  constructor(state: OrgLifecycleState) {
    const init = "`cormidia org init <path> --name <name>`";
    if (state.code === "no_active_org") {
      super(`cormidia: no active org home — create one with ${init}`);
      this.publicMessage = "no active org home";
      this.remediation = `Run ${init} to create and select an org home.`;
    } else if (state.code === "active_org_missing") {
      super(`cormidia: active org home does not exist: ${state.orgHome}`);
      this.publicMessage = `active org home does not exist: ${state.orgHome}`;
      this.remediation = `Run \`cormidia org use <path>\` to select an existing org home, or ${init} to create one.`;
    } else {
      super(`cormidia: ${state.orgHome} is not a complete org home — missing ${state.missing}`);
      this.publicMessage = `org home is incomplete: ${state.orgHome} (missing ${state.missing})`;
      this.remediation = `Restore ${state.missing} in ${state.orgHome}, select a complete home with \`cormidia org use <path>\`, or create one with ${init}.`;
    }
    this.code = state.code;
    this.name = "OrgLifecycleError";
  }
}

export { OrgIdentityError, type OrgIdentityStopCode } from "./apps.js";

/** Org/state identity marker recorded by init and validated per B-10 §2. */
const STATE_HOME_IDENTITY_FILE = "org-identity.json";

interface StateHomeIdentity {
  schema_version: 1;
  kind: "org-identity";
  org_name: string;
  /** Realpath of the org home this state home was created for. */
  org_home: string;
  created_at: string;
}

function stateHomeIdentityPath(stateHome: string): string {
  return join(resolve(stateHome), STATE_HOME_IDENTITY_FILE);
}

async function writeStateHomeIdentity(
  stateHome: string,
  identity: { orgName: string; orgHomeRealpath: string },
  createdAt: Date = new Date(),
): Promise<void> {
  const marker: StateHomeIdentity = {
    schema_version: 1,
    kind: "org-identity",
    org_name: identity.orgName,
    org_home: identity.orgHomeRealpath,
    created_at: createdAt.toISOString(),
  };
  await writeFileAtomic(stateHomeIdentityPath(stateHome), `${stableJson(marker).trimEnd()}\n`);
}

type StateHomeIdentityRead =
  | { status: "absent" }
  | { status: "malformed" }
  | { status: "present"; orgName: string; orgHome: string };

async function readStateHomeIdentity(stateHome: string): Promise<StateHomeIdentityRead> {
  const text = await readFileMaybe(stateHomeIdentityPath(stateHome));
  if (text === undefined) return { status: "absent" };
  try {
    const raw = JSON.parse(text) as Partial<StateHomeIdentity> | null;
    if (
      raw !== null &&
      typeof raw === "object" &&
      raw.kind === "org-identity" &&
      typeof raw.org_name === "string" &&
      raw.org_name.length > 0 &&
      typeof raw.org_home === "string" &&
      raw.org_home.length > 0
    ) {
      return { status: "present", orgName: raw.org_name, orgHome: raw.org_home };
    }
  } catch {
    // fall through: unparseable marker is malformed
  }
  return { status: "malformed" };
}

/**
 * B-10 §2 (B-10a): validate that the state home belongs to the resolved org.
 *
 * Marker + adoption rules:
 * - `cormidia org init` records the identity marker (STATE_HOME_IDENTITY_FILE:
 *   org name, org-home realpath, created_at) in the state home it creates or
 *   reuses — init is the pairing-establishment operation.
 * - When the marker exists, the pairing is validated on every resolve: a
 *   marker naming a DIFFERENT org (by name or real org-home path) is a typed
 *   OrgIdentityError stop — "correct config from the wrong org" refuses, it
 *   never resolves (INV-004).
 * - A marker-less state home is LEGACY (created before the marker existed):
 *   it is ADOPTED on first resolve by writing the marker for the current
 *   pairing. Adoption is deliberately never a stop so existing installs keep
 *   working; from the adoption on, the pairing is enforced.
 * - An absent state home has no pairing yet; init/first write establishes it.
 * - An unreadable marker fails closed (INV-013/015): refuse with remediation,
 *   never guess or silently re-adopt.
 */
async function ensureStateHomeIdentity(stateHome: string, orgHome: string, orgName: string): Promise<void> {
  const stateStat = await lstatMaybe(stateHome);
  if (stateStat === undefined || stateStat.isSymbolicLink() || !stateStat.isDirectory()) return;
  const markerPath = stateHomeIdentityPath(stateHome);
  const marker = await readStateHomeIdentity(stateHome);
  if (marker.status === "malformed") {
    throw new OrgIdentityError({
      code: "state_home_identity_unreadable",
      publicMessage: "state home identity marker is unreadable",
      remediation: `Inspect ${markerPath}; restore it, or remove it to re-adopt the state home for the org it belongs to.`,
      message:
        `cormidia: state home identity marker is unreadable: ${markerPath} — cannot prove ${stateHome} ` +
        `belongs to org "${orgName}"; inspect the file, or remove it to re-adopt this state home for the current org`,
    });
  }
  const orgHomeReal = await realpath(orgHome);
  if (marker.status === "absent") {
    await writeStateHomeIdentity(stateHome, { orgName, orgHomeRealpath: orgHomeReal });
    return;
  }
  if (marker.orgName !== orgName || marker.orgHome !== orgHomeReal) {
    throw new OrgIdentityError({
      code: "state_home_org_mismatch",
      publicMessage: "state home belongs to a different org",
      remediation:
        "Use the state home created for this org (re-run `cormidia org use` with the right --state-home), " +
        `or remove ${markerPath} if the pairing genuinely changed.`,
      message:
        `cormidia: state home ${stateHome} belongs to org "${marker.orgName}" (org home ${marker.orgHome}), ` +
        `not to org "${orgName}" (org home ${orgHomeReal}) — refusing to mix org state; use the state home ` +
        `created for this org, or remove ${markerPath} if the pairing genuinely changed`,
    });
  }
}

async function readFileMaybe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

export async function resolveCormidiaHomes(options: CormidiaHomeOptions = {}): Promise<CormidiaHomes> {
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;
  const pointerPath = options.pointerPath ?? join(homeDir, CORMIDIA_HOME_DIRNAME, "config");
  const orgHome = await findExistingOrg({
    ...definedProps({ orgHome: options.orgHome }),
    ...definedProps({ env: options.env }),
    homeDir,
    pointerPath,
  });
  if (orgHome === undefined) throw new OrgLifecycleError({ code: "no_active_org" });
  if ((await lstatMaybe(orgHome)) === undefined) {
    throw new OrgLifecycleError({ code: "active_org_missing", orgHome: resolve(orgHome) });
  }
  await validateOrgHome(orgHome);
  const appsFile = await loadApps(join(orgHome, "apps.yaml"));
  const pointer = await readActiveOrgPointer(pointerPath);
  const pointerStateHome = pointer.orgHome === resolve(orgHome) ? pointer.stateHome : undefined;
  const stateHome = resolve(
    options.stateHome ??
      env.CORMIDIA_STATE_HOME ??
      pointerStateHome ??
      join(homeDir, CORMIDIA_HOME_DIRNAME, appsFile.org.name),
  );
  // B-10 §2: the (org home, state home, org id) triple must be coherent
  // before anything uses it — see ensureStateHomeIdentity for the rules.
  await ensureStateHomeIdentity(stateHome, resolve(orgHome), appsFile.org.name);
  return { packageRoot: PACKAGE_ROOT, orgHome: resolve(orgHome), stateHome, appsFile, pointerPath };
}

export async function validateOrgHome(orgHomeIn: string): Promise<void> {
  const orgHome = resolve(orgHomeIn);
  for (const rel of ORG_REQUIRED_FILES) {
    if (!existsSync(join(orgHome, rel))) {
      throw new OrgLifecycleError({ code: "org_home_incomplete", orgHome, missing: rel });
    }
  }
  if (!existsSync(join(orgHome, "prompts"))) {
    throw new OrgLifecycleError({ code: "org_home_incomplete", orgHome, missing: "prompts/" });
  }
  const roles = await loadRoles(join(orgHome, "roles.yaml"));
  const apps = await loadApps(join(orgHome, "apps.yaml"));
  for (const app of apps.apps) resolveAppAssignments(app, roles.roles);
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

export interface InitOrgHomeResult extends CormidiaHomes {
  created: string[];
  authority: AuthorityContext;
  authorityPreview: ReturnType<typeof authorityPreview>;
}

interface InitOrgDestination {
  relative_path: string;
  path: string;
  kind: "directory" | "file";
  disposition: "create" | "reuse" | "blocked";
  content_sha256?: string;
}

interface InitOrgPlanBlocker {
  code:
    | "existing_org"
    | "nested_org"
    | "target_not_directory"
    | "target_ancestor_invalid"
    | "target_changed"
    | "generated_path_collision"
    | "generated_path_symlink"
    | "state_home_not_directory"
    | "state_home_ancestor_invalid"
    | "pointer_path_invalid"
    | "pointer_ancestor_invalid"
    | "effect_path_collision";
  path: string;
  detail: string;
  remediation: string;
}

interface InitOrgRolePreview {
  name: string;
  runtime: RuntimeKind;
  model: string;
  effort: Effort;
  triggers: Trigger[];
}

export interface InitOrgHomePlanPreview {
  schema_version: 1;
  operation: "org_init";
  status: "ready" | "blocked";
  executable: boolean;
  package_root: string;
  template_root: string;
  org_home: string;
  state_home: string;
  pointer_path: string;
  effects: {
    org_home: { action: "create" | "populate"; path: string };
    generated_destinations: InitOrgDestination[];
    state_home: { action: "create" | "reuse"; path: string };
    active_pointer: { action: "create" | "replace"; path: string };
  };
  authority: {
    profile: AuthorityProfile;
    version: string;
    automatic: string[];
    human_gated: string[];
  };
  roles: InitOrgRolePreview[];
  blockers: InitOrgPlanBlocker[];
}

interface InitOrgPlannedFile {
  relative_path: string;
  contents: Buffer;
}

/**
 * The exact manifest shared by preview and execution. The public preview
 * projection deliberately excludes file contents; execution verifies that
 * these in-memory bytes still produce the displayed paths and hashes before
 * creating any directory or staging file.
 */
export interface InitOrgHomePlan {
  preview: InitOrgHomePlanPreview;
  authority: AuthorityContext;
  planned_files: InitOrgPlannedFile[];
}

/** Build the complete init transaction without creating a target, state home,
 * active pointer, or staging directory. */
export async function planOrgInit(options: InitOrgHomeOptions): Promise<InitOrgHomePlan> {
  const target = resolve(options.target);
  const name = sanitizeOrgName(options.name);
  const templateRoot = resolve(options.templateRoot ?? PACKAGE_ROOT);
  const homeDir = options.homeDir ?? homedir();
  const pointerPath = options.pointerPath ?? join(homeDir, CORMIDIA_HOME_DIRNAME, "config");
  const stateHome = resolve(options.stateHome ?? join(homeDir, CORMIDIA_HOME_DIRNAME, name));
  const authorityProfile = options.authorityProfile ?? "delegated-operator";
  const authorityText = createOrgAuthorityDocument(
    authorityProfile,
    options.authorityCustomText,
    options.authorityGrantedBy,
  );
  const authority: AuthorityContext = {
    profile: authorityProfile,
    version: authorityVersion(authorityProfile),
    sha256: sha256(authorityText),
    sources: [join(target, "AUTHORITY.md")],
    text: authorityText,
  };

  const rolesFile = await loadRoles(join(templateRoot, "roles.yaml"));
  await loadPipelines(join(templateRoot, "pipelines.yaml"), {
    roleNames: rolesFile.roles.map((role) => role.name),
    promptsDir: join(templateRoot, "prompts"),
  });
  const manifest = new InitManifestBuilder(target);
  for (const rel of ["TASTE.md", "roles.yaml", "pipelines.yaml"]) {
    await manifest.addPackagedFile(templateRoot, rel);
  }
  await manifest.addPackagedTree(templateRoot, "prompts", true);
  await manifest.addPackagedTree(templateRoot, "taste", false);
  manifest.addGeneratedFile("AUTHORITY.md", authorityText);
  const instructionBlock = projectAuthorityBlock("AUTHORITY.md", authority);
  for (const rel of ["AGENTS.md", "CLAUDE.md"]) {
    manifest.addGeneratedFile(rel, composeProjectInstructions(`# ${rel}\n`, instructionBlock));
  }
  manifest.addGeneratedFile("apps.yaml", emptyAppsYaml(name));
  for (const role of rolesFile.roles) {
    manifest.addGeneratedFile(join("memory", "roles", role.name, "INDEX.md"), "");
  }
  manifest.addGeneratedFile(join("skills", ".gitkeep"), "");
  manifest.addGeneratedFile(join("retro", ".gitkeep"), "");

  const desired = manifest.destinations();
  const preflight = await preflightInitEffects({
    target,
    stateHome,
    pointerPath: resolve(pointerPath),
    desired,
  });
  const preview = authorityPreview(authorityProfile);
  const planPreview: InitOrgHomePlanPreview = {
    schema_version: 1,
    operation: "org_init",
    status: preflight.blockers.length === 0 ? "ready" : "blocked",
    executable: preflight.blockers.length === 0,
    package_root: PACKAGE_ROOT,
    template_root: templateRoot,
    org_home: target,
    state_home: stateHome,
    pointer_path: resolve(pointerPath),
    effects: {
      org_home: { action: preflight.targetAction, path: target },
      generated_destinations: preflight.destinations,
      state_home: { action: preflight.stateHomeAction, path: stateHome },
      active_pointer: { action: preflight.pointerAction, path: resolve(pointerPath) },
    },
    authority: {
      profile: authorityProfile,
      version: authority.version,
      automatic: [...preview.automatic],
      human_gated: [...preview.humanGated],
    },
    roles: rolesFile.roles.map((role) => ({
      name: role.name,
      runtime: role.runtime,
      model: role.model,
      effort: role.effort,
      triggers: role.triggers.map((trigger) => ({ ...trigger })),
    })),
    blockers: preflight.blockers,
  };
  return {
    preview: planPreview,
    authority,
    planned_files: manifest.files(),
  };
}

export async function executeOrgInit(plan: InitOrgHomePlan): Promise<InitOrgHomeResult> {
  assertInitPlanIntegrity(plan);
  const { preview } = plan;
  if (!preview.executable) throw new Error(preview.blockers[0]!.detail);
  const target = preview.org_home;
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const staged = await mkdtemp(join(parent, `.${basename(target)}.cormidia-init-`));
  let stageExists = true;
  let installed = false;
  let populatedEntries: InitOrgDestination[] = [];
  let stateHomeCreated = false;
  let identityMarkerBefore: string | undefined;
  let identityMarkerWritten = false;

  try {
    await materializeInitStage(staged, preview.effects.generated_destinations, plan.planned_files);
    await validateOrgHome(staged);
    const appsFile = await loadApps(join(staged, "apps.yaml"));

    const rechecked = await preflightInitEffects({
      target,
      stateHome: preview.state_home,
      pointerPath: preview.pointer_path,
      desired: preview.effects.generated_destinations,
    });
    if (rechecked.blockers.length > 0) throw new Error(rechecked.blockers[0]!.detail);
    if (rechecked.targetAction !== preview.effects.org_home.action) {
      throw new Error(
        `cormidia org init: target changed during initialization: ${target}; no org files were installed`,
      );
    }

    if (preview.effects.org_home.action === "create") {
      await rename(staged, target);
      stageExists = false;
    } else {
      populatedEntries = await populateExistingTarget(staged, preview.effects.generated_destinations);
    }
    installed = true;

    stateHomeCreated = (await lstatMaybe(preview.state_home)) === undefined;
    await mkdir(preview.state_home, { recursive: true });
    // B-10 §2: init establishes the (org, state home) pairing — record the
    // identity marker so every later resolve can validate the triple. A
    // reused state home gets THIS pairing: the human just assigned it here.
    identityMarkerBefore = await readFileMaybe(stateHomeIdentityPath(preview.state_home));
    await writeStateHomeIdentity(preview.state_home, {
      orgName: appsFile.org.name,
      orgHomeRealpath: await realpath(target),
    });
    identityMarkerWritten = true;
    await writeActiveOrgPointer(preview.pointer_path, target, preview.state_home);
    const createdEntries =
      preview.effects.org_home.action === "create" ? preview.effects.generated_destinations : populatedEntries;

    return {
      packageRoot: PACKAGE_ROOT,
      orgHome: target,
      stateHome: preview.state_home,
      appsFile,
      pointerPath: preview.pointer_path,
      created: createdEntries.map((entry) =>
        entry.kind === "directory" ? `${entry.relative_path}/` : entry.relative_path,
      ),
      authority: plan.authority,
      authorityPreview: {
        automatic: [...preview.authority.automatic],
        humanGated: [...preview.authority.human_gated],
      },
    };
  } catch (error) {
    if (installed) {
      if (preview.effects.org_home.action === "create") {
        await rm(target, { recursive: true, force: true }).catch(() => undefined);
      } else {
        await rollbackPopulatedEntries(populatedEntries);
      }
    }
    if (identityMarkerWritten) {
      const markerPath = stateHomeIdentityPath(preview.state_home);
      if (identityMarkerBefore === undefined) {
        await rm(markerPath, { force: true }).catch(() => undefined);
      } else {
        await writeFile(markerPath, identityMarkerBefore, "utf8").catch(() => undefined);
      }
    }
    if (stateHomeCreated) await rmdir(preview.state_home).catch(() => undefined);
    throw error;
  } finally {
    if (stageExists) await rm(staged, { recursive: true, force: true });
  }
}

function assertInitPlanIntegrity(plan: InitOrgHomePlan): void {
  const target = plan.preview.org_home;
  if (!isAbsolute(target) || resolve(target) !== target) {
    throw initPlanIntegrityError(`org home is not an absolute normalized path: ${target}`);
  }

  const fileDestinations = new Map<string, InitOrgDestination>();
  const destinationPaths = new Set<string>();
  for (const destination of plan.preview.effects.generated_destinations) {
    const relativePath = canonicalInitPlanRelative(destination.relative_path);
    if (destinationPaths.has(relativePath)) {
      throw initPlanIntegrityError(`duplicate preview destination: ${relativePath}`);
    }
    destinationPaths.add(relativePath);

    const expectedPath = join(target, relativePath);
    if (!isAbsolute(destination.path) || destination.path !== expectedPath) {
      throw initPlanIntegrityError(`preview destination does not match its org-relative path: ${destination.path}`);
    }
    if (destination.kind === "file") fileDestinations.set(relativePath, destination);
  }

  const plannedPaths = new Set<string>();
  for (const file of plan.planned_files) {
    const relativePath = canonicalInitPlanRelative(file.relative_path);
    if (plannedPaths.has(relativePath)) {
      throw initPlanIntegrityError(`duplicate planned file: ${relativePath}`);
    }
    plannedPaths.add(relativePath);

    const destination = fileDestinations.get(relativePath);
    if (destination === undefined) {
      throw initPlanIntegrityError(`planned file has no matching preview destination: ${relativePath}`);
    }
    if (!Buffer.isBuffer(file.contents)) {
      throw initPlanIntegrityError(`planned file contents are not bytes: ${relativePath}`);
    }
    if (sha256(file.contents) !== destination.content_sha256) {
      throw initPlanIntegrityError(`planned file bytes do not match the preview hash: ${relativePath}`);
    }
  }

  for (const relativePath of fileDestinations.keys()) {
    if (!plannedPaths.has(relativePath)) {
      throw initPlanIntegrityError(`preview destination has no matching planned file: ${relativePath}`);
    }
  }
}

function canonicalInitPlanRelative(value: string): string {
  let safe: string;
  try {
    safe = safeRelative(value);
  } catch {
    throw initPlanIntegrityError(`unsafe relative path: ${String(value)}`);
  }
  if (safe !== value) {
    throw initPlanIntegrityError(`relative path is not normalized: ${value}`);
  }
  return safe;
}

function initPlanIntegrityError(detail: string): Error {
  return new Error(`cormidia org init: plan integrity check failed: ${detail}; no changes were made`);
}

export async function initOrgHome(options: InitOrgHomeOptions): Promise<InitOrgHomeResult> {
  return executeOrgInit(await planOrgInit(options));
}

interface InitPreflightInput {
  target: string;
  stateHome: string;
  pointerPath: string;
  desired: InitOrgDestination[];
}

interface InitPreflightResult {
  targetAction: "create" | "populate";
  stateHomeAction: "create" | "reuse";
  pointerAction: "create" | "replace";
  destinations: InitOrgDestination[];
  blockers: InitOrgPlanBlocker[];
}

async function preflightInitEffects(input: InitPreflightInput): Promise<InitPreflightResult> {
  const blockers: InitOrgPlanBlocker[] = [];
  const targetStat = await lstatMaybe(input.target);
  const targetAction = targetStat === undefined ? "create" : "populate";
  let completeOrg = false;
  if (targetStat !== undefined) {
    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
      blockers.push({
        code: "target_not_directory",
        path: input.target,
        detail: `cormidia org init: target is not a directory: ${input.target}`,
        remediation: "Choose an absent path or an existing real directory.",
      });
    } else {
      completeOrg = await hasCompleteOrgShape(input.target);
      if (completeOrg) {
        blockers.push({
          code: "existing_org",
          path: input.target,
          detail:
            `cormidia org init: a Cormidia org already exists at ${input.target}; ` +
            `use \`cormidia org use ${input.target}\` to select it`,
          remediation: `Run cormidia org use ${input.target}.`,
        });
      }
    }
  } else {
    const invalidAncestor = await firstInvalidDirectoryAncestor(dirname(input.target));
    if (invalidAncestor !== undefined) {
      blockers.push({
        code: "target_ancestor_invalid",
        path: invalidAncestor,
        detail: `cormidia org init: target has a non-directory or symlink ancestor: ${invalidAncestor}`,
        remediation: "Choose a target whose existing ancestors are real directories.",
      });
    }
  }

  // C-OP-LIFE §1: a nested org is a collision class of its own — a target
  // INSIDE an existing org home must block in the preview, never reach
  // execute. The target-shape checks above only look AT the target; this
  // walks upward for the nearest complete org shape.
  const enclosingOrg = await firstAncestorWithCompleteOrgShape(dirname(input.target));
  if (enclosingOrg !== undefined) {
    blockers.push({
      code: "nested_org",
      path: enclosingOrg,
      detail:
        `cormidia org init: target is nested inside an existing Cormidia org home: ${enclosingOrg}; ` +
        "nested orgs are not allowed",
      remediation: `Choose a target outside ${enclosingOrg}, or select that org with \`cormidia org use ${enclosingOrg}\`.`,
    });
  }

  const destinations: InitOrgDestination[] = input.desired.map((entry) => ({
    ...entry,
    disposition: "create",
  }));
  if (targetStat !== undefined && targetStat.isDirectory() && !targetStat.isSymbolicLink()) {
    const blockedDirectories = new Set<string>();
    for (const entry of destinations) {
      const blockedAncestor = [...blockedDirectories].find(
        (ancestor) => entry.relative_path === ancestor || entry.relative_path.startsWith(`${ancestor}${sep}`),
      );
      if (blockedAncestor !== undefined) {
        entry.disposition = "blocked";
        continue;
      }
      const destinationStat = await lstatMaybe(entry.path);
      if (destinationStat === undefined) continue;
      if (entry.kind === "directory" && destinationStat.isDirectory() && !destinationStat.isSymbolicLink()) {
        entry.disposition = "reuse";
        continue;
      }
      entry.disposition = "blocked";
      if (entry.kind === "directory") blockedDirectories.add(entry.relative_path);
      if (!completeOrg) {
        const symlink = destinationStat.isSymbolicLink();
        blockers.push({
          code: symlink ? "generated_path_symlink" : "generated_path_collision",
          path: entry.path,
          detail: symlink
            ? `cormidia org init: generated path is a symlink and will not be followed: ${entry.path}`
            : `cormidia org init: generated destination already exists and will not be overwritten: ${entry.path}`,
          remediation: "Move the colliding path aside or choose another org home; Cormidia never overwrites it.",
        });
      }
    }
  } else if (targetStat !== undefined) {
    for (const entry of destinations) entry.disposition = "blocked";
  }

  const stateStat = await lstatMaybe(input.stateHome);
  const stateHomeAction = stateStat === undefined ? "create" : "reuse";
  if (pathsOverlap(input.target, input.stateHome)) {
    blockers.push({
      code: "effect_path_collision",
      path: input.stateHome,
      detail: `cormidia org init: org and state homes must not overlap: ${input.target} and ${input.stateHome}`,
      remediation: "Choose separate org-home and state-home paths with neither containing the other.",
    });
  }
  if (stateStat !== undefined && (stateStat.isSymbolicLink() || !stateStat.isDirectory())) {
    blockers.push({
      code: "state_home_not_directory",
      path: input.stateHome,
      detail: `cormidia org init: state home is not a real directory: ${input.stateHome}`,
      remediation: "Choose an absent state-home path or an existing real directory.",
    });
  } else if (stateStat === undefined) {
    const invalidAncestor = await firstInvalidDirectoryAncestor(dirname(input.stateHome));
    if (invalidAncestor !== undefined) {
      blockers.push({
        code: "state_home_ancestor_invalid",
        path: invalidAncestor,
        detail: `cormidia org init: state home has a non-directory or symlink ancestor: ${invalidAncestor}`,
        remediation: "Choose a state-home path whose existing ancestors are real directories.",
      });
    }
  }

  const pointerStat = await lstatMaybe(input.pointerPath);
  const pointerAction = pointerStat === undefined ? "create" : "replace";
  const pointerOverlapsOrg = pathsOverlap(input.pointerPath, input.target);
  const pointerOverlapsState = pathsOverlap(input.pointerPath, input.stateHome);
  if (pointerOverlapsOrg || pointerOverlapsState) {
    const effect = pointerOverlapsOrg ? "org home" : "state home";
    blockers.push({
      code: "effect_path_collision",
      path: input.pointerPath,
      detail: `cormidia org init: active pointer path overlaps the ${effect}: ${input.pointerPath}`,
      remediation: "Keep the active pointer outside the org and state homes.",
    });
  }
  if (pointerStat !== undefined && (pointerStat.isSymbolicLink() || !pointerStat.isFile())) {
    blockers.push({
      code: "pointer_path_invalid",
      path: input.pointerPath,
      detail: `cormidia org init: active pointer path is not a regular file: ${input.pointerPath}`,
      remediation: "Move the colliding path aside or pass a safe pointer path.",
    });
  } else if (pointerStat === undefined) {
    const invalidAncestor = await firstInvalidDirectoryAncestor(dirname(input.pointerPath));
    if (invalidAncestor !== undefined) {
      blockers.push({
        code: "pointer_ancestor_invalid",
        path: invalidAncestor,
        detail: `cormidia org init: active pointer has a non-directory or symlink ancestor: ${invalidAncestor}`,
        remediation: "Choose a pointer path whose existing ancestors are real directories.",
      });
    }
  }

  return { targetAction, stateHomeAction, pointerAction, destinations, blockers };
}

async function firstInvalidDirectoryAncestor(start: string): Promise<string | undefined> {
  let current = resolve(start);
  while (true) {
    const currentStat = await lstatMaybe(current);
    if (currentStat !== undefined) {
      if (currentStat.isDirectory()) return undefined;
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function isPathInsideOrEqual(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function pathsOverlap(a: string, b: string): boolean {
  return isPathInsideOrEqual(a, b) || isPathInsideOrEqual(b, a);
}

async function hasCompleteOrgShape(target: string): Promise<boolean> {
  for (const rel of [...ORG_REQUIRED_FILES, "prompts"] as const) {
    if ((await lstatMaybe(join(target, rel))) === undefined) return false;
  }
  return true;
}

/** Nearest ancestor (starting at `start`, walking to the filesystem root)
 * that carries a complete org shape, or undefined when none does. Ancestors
 * that do not exist yet are walked through — a nested target several levels
 * below an org home is still nested. */
async function firstAncestorWithCompleteOrgShape(start: string): Promise<string | undefined> {
  let current = resolve(start);
  while (true) {
    if (await hasCompleteOrgShape(current)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function materializeInitStage(
  staged: string,
  destinations: InitOrgDestination[],
  files: InitOrgPlannedFile[],
): Promise<void> {
  for (const entry of destinations) {
    if (entry.kind === "directory") await mkdir(join(staged, entry.relative_path));
  }
  for (const file of files) {
    await writeFile(join(staged, file.relative_path), file.contents, { flag: "wx" });
  }
}

async function populateExistingTarget(
  staged: string,
  destinations: InitOrgDestination[],
): Promise<InitOrgDestination[]> {
  const created: InitOrgDestination[] = [];
  try {
    for (const entry of destinations) {
      if (entry.kind !== "directory") continue;
      const current = await lstatMaybe(entry.path);
      if (current === undefined) {
        await mkdir(entry.path);
        created.push(entry);
      } else if (current.isSymbolicLink() || !current.isDirectory()) {
        throw new Error(`cormidia org init: generated directory collided during installation: ${entry.path}`);
      }
    }
    for (const entry of destinations) {
      if (entry.kind !== "file") continue;
      await copyFile(join(staged, entry.relative_path), entry.path, constants.COPYFILE_EXCL);
      created.push(entry);
    }
    return created;
  } catch (error) {
    await rollbackPopulatedEntries(created);
    throw error;
  }
}

async function rollbackPopulatedEntries(entries: InitOrgDestination[]): Promise<void> {
  for (const entry of [...entries].reverse()) {
    if (entry.kind === "file") await unlink(entry.path).catch(() => undefined);
    else await rmdir(entry.path).catch(() => undefined);
  }
}

class InitManifestBuilder {
  readonly #target: string;
  readonly #directories = new Set<string>();
  readonly #files = new Map<string, Buffer>();

  constructor(target: string) {
    this.#target = target;
  }

  async addPackagedFile(templateRoot: string, rel: string): Promise<void> {
    const source = join(templateRoot, safeRelative(rel));
    const sourceStat = await lstat(source);
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
      throw new Error(`cormidia org init: packaged template file is not a regular file: ${source}`);
    }
    this.addFile(rel, await readFile(source));
  }

  async addPackagedTree(templateRoot: string, rel: string, required: boolean): Promise<void> {
    const safe = safeRelative(rel);
    const source = join(templateRoot, safe);
    const sourceStat = await lstatMaybe(source);
    if (sourceStat === undefined) {
      if (required) throw new Error(`cormidia org init: packaged template tree is missing: ${source}`);
      return;
    }
    if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
      throw new Error(`cormidia org init: packaged template tree is not a real directory: ${source}`);
    }
    this.addDirectory(safe);
    await this.addPackagedTreeEntries(templateRoot, safe);
  }

  addGeneratedFile(rel: string, contents: string): void {
    this.addFile(rel, Buffer.from(contents, "utf8"));
  }

  destinations(): InitOrgDestination[] {
    const directories = [...this.#directories].sort(compareRelativePaths).map(
      (relativePath): InitOrgDestination => ({
        relative_path: relativePath,
        path: join(this.#target, relativePath),
        kind: "directory",
        disposition: "create",
      }),
    );
    const files = [...this.#files.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([relativePath, contents]): InitOrgDestination => ({
          relative_path: relativePath,
          path: join(this.#target, relativePath),
          kind: "file",
          disposition: "create",
          content_sha256: sha256(contents),
        }),
      );
    return [...directories, ...files];
  }

  files(): InitOrgPlannedFile[] {
    return [...this.#files.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([relativePath, contents]) => ({
        relative_path: relativePath,
        contents: Buffer.from(contents),
      }));
  }

  private async addPackagedTreeEntries(templateRoot: string, rel: string): Promise<void> {
    const source = join(templateRoot, rel);
    const entries = (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = safeRelative(join(rel, entry.name));
      if (entry.isSymbolicLink()) {
        throw new Error(`cormidia org init: packaged template tree contains a symlink: ${join(templateRoot, child)}`);
      }
      if (entry.isDirectory()) {
        this.addDirectory(child);
        await this.addPackagedTreeEntries(templateRoot, child);
      } else if (entry.isFile()) {
        this.addFile(child, await readFile(join(templateRoot, child)));
      } else {
        throw new Error(`cormidia org init: packaged template entry is unsupported: ${join(templateRoot, child)}`);
      }
    }
  }

  private addFile(rel: string, contents: Buffer): void {
    const safe = safeRelative(rel);
    const parent = dirname(safe);
    if (parent !== ".") this.addDirectory(parent);
    if (this.#directories.has(safe) || this.#files.has(safe)) {
      throw new Error(`cormidia org init: duplicate generated destination: ${safe}`);
    }
    this.#files.set(safe, Buffer.from(contents));
  }

  private addDirectory(rel: string): void {
    if (normalize(rel) === ".") return;
    const safe = safeRelative(rel);
    const parent = dirname(safe);
    if (parent !== ".") this.addDirectory(parent);
    if (this.#files.has(safe)) throw new Error(`cormidia org init: generated path is both file and directory: ${safe}`);
    this.#directories.add(safe);
  }
}

function safeRelative(value: string): string {
  const normalized = normalize(value);
  if (normalized === "." || isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new Error(`cormidia org init: unsafe generated relative path: ${value}`);
  }
  return normalized;
}

function compareRelativePaths(a: string, b: string): number {
  const depth = a.split(sep).length - b.split(sep).length;
  return depth !== 0 ? depth : a.localeCompare(b);
}

async function lstatMaybe(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

function authorityVersion(profile: AuthorityProfile): string {
  if (profile === "delegated-operator") return DELEGATED_OPERATOR_VERSION;
  if (profile === "conservative") return CONSERVATIVE_VERSION;
  return "custom/v1";
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
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

interface ActiveOrgSelection {
  orgHome?: string;
  stateHome?: string;
  /** True when `state_home` was absent and had to be derived from the org name. */
  stateHomeDerived: boolean;
}

/**
 * Which org home AND which state home the active pointer selects.
 *
 * A pointer written before `org use` recorded `state_home` carries only
 * `org_home`, and `resolveCormidiaHomes` silently derives the state home from
 * the org name — so every surface that read `pointer.state_home` directly
 * disagreed with the state home the rest of the CLI was actually using. That
 * is how `org list` stopped marking the active org active and `org archive`
 * left the pointer behind, resurrecting a removed state home on the next
 * command. Pointer-only consumers resolve the pair here instead of reading
 * `state_home` raw; the derivation is anchored on the pointer's own directory,
 * which is the `~/.cormidia/<org>` that `resolveCormidiaHomes` falls back to.
 */
export async function resolveActiveOrgSelection(pointerPathIn: string): Promise<ActiveOrgSelection> {
  const pointerPath = resolve(pointerPathIn);
  const pointer = await readActiveOrgPointer(pointerPath);
  if (pointer.stateHome !== undefined || pointer.orgHome === undefined) {
    return {
      ...(pointer.orgHome === undefined ? {} : { orgHome: pointer.orgHome }),
      ...(pointer.stateHome === undefined ? {} : { stateHome: pointer.stateHome }),
      stateHomeDerived: false,
    };
  }
  let orgName: string;
  try {
    orgName = (await loadApps(join(pointer.orgHome, "apps.yaml"))).org.name;
  } catch {
    // An unreadable org home cannot name a state home. The pointer still
    // selects an org home, and callers report the rest as unknown.
    return { orgHome: pointer.orgHome, stateHomeDerived: false };
  }
  return {
    orgHome: pointer.orgHome,
    stateHome: resolve(join(dirname(pointerPath), orgName)),
    stateHomeDerived: true,
  };
}

function sanitizeOrgName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) throw new Error("cormidia org init: --name must contain a letter or number");
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
