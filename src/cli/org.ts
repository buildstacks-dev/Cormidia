// `operon org init|show|use` — explicit organization-home lifecycle.

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  initOrgHome,
  ORG_HOME_DEFINITION,
  readActiveOrgPointer,
  resolveOperonHomes,
  STATE_HOME_DEFINITION,
  validateOrgHome,
  writeActiveOrgPointer,
  type InitOrgHomeResult,
} from "../org/home.js";
import { loadApps } from "../org/apps.js";
import { findExistingOrg } from "../org/apps.js";
import {
  authorityPreview,
  resolveAuthority,
  type AuthorityProfile,
} from "../org/authority.js";
import { executeOrgUpgrade, planOrgUpgrade, type UpgradeAuthorityChoice } from "../org/org-upgrade.js";
import { stableJson } from "../org/lifecycle.js";

export interface OrgCommandOptions {
  homeDir?: string;
  pointerPath?: string;
  templateRoot?: string;
}

export async function cmdOrg(args: string[], options: OrgCommandOptions = {}): Promise<number> {
  const subcommand = args[0];
  if (subcommand === "init") return init(args.slice(1), options);
  if (subcommand === "show") return show(args.slice(1), options);
  if (subcommand === "use") return use(args.slice(1), options);
  if (subcommand === "upgrade") return upgrade(args.slice(1), options);
  throw new Error('org: expected "init", "show", "use", or "upgrade" — run `operon org --help`');
}

async function upgrade(args: string[], options: OrgCommandOptions): Promise<number> {
  let orgHomeFlag: string | undefined;
  let stateHomeFlag: string | undefined;
  let archiveRoot: string | undefined;
  let authorityChoice: UpgradeAuthorityChoice | undefined;
  let authorityFile: string | undefined;
  let authorityBy: string | undefined;
  let execute = false;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--org-home") orgHomeFlag = needValue(args, ++i, "--org-home");
    else if (arg === "--state-home") stateHomeFlag = needValue(args, ++i, "--state-home");
    else if (arg === "--archive-root") archiveRoot = needValue(args, ++i, "--archive-root");
    else if (arg === "--authority") {
      const value = needValue(args, ++i, "--authority");
      if (["preserve", "delegated-operator", "conservative", "custom"].includes(value)) {
        authorityChoice = value as UpgradeAuthorityChoice;
      } else throw new Error("org upgrade: --authority must be preserve | delegated-operator | conservative | custom");
    } else if (arg === "--authority-file") authorityFile = needValue(args, ++i, "--authority-file");
    else if (arg === "--authority-by") authorityBy = needValue(args, ++i, "--authority-by");
    else if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false;
    else if (arg === "--json") json = true;
    else throw new Error(`org upgrade: unknown argument "${arg}"`);
  }
  const homeDir = options.homeDir ?? homedir();
  const pointerPath = options.pointerPath ?? join(homeDir, ".operon", "config");
  const orgHome = orgHomeFlag
    ? resolve(orgHomeFlag)
    : await findExistingOrg({ homeDir, pointerPath });
  if (orgHome === undefined) throw new Error("org upgrade: no active org home; pass --org-home <path>");
  const rawApps = await loadApps(join(orgHome, "apps.yaml"));
  const pointer = await readActiveOrgPointer(pointerPath);
  const pointerStateHome = pointer.orgHome === resolve(orgHome) ? pointer.stateHome : undefined;
  const stateHome = resolve(stateHomeFlag ?? pointerStateHome ?? join(homeDir, ".operon", rawApps.org.name));
  const authorityCustomText = authorityFile ? await readFile(resolve(authorityFile), "utf8") : undefined;
  const input = {
    orgHome,
    stateHome,
    ...(authorityChoice !== undefined ? { authorityChoice } : {}),
    ...(authorityCustomText !== undefined ? { authorityCustomText } : {}),
    ...(authorityBy !== undefined ? { authorityGrantedBy: authorityBy } : {}),
    ...(archiveRoot !== undefined ? { archiveRoot } : {}),
    ...(options.templateRoot !== undefined ? { templateRoot: options.templateRoot } : {}),
  };
  const plan = await planOrgUpgrade(input);
  if (!execute) {
    if (json) console.log(stableJson(plan).trimEnd());
    else printUpgradePlan(plan);
    return plan.executable ? 0 : 2;
  }
  const result = await executeOrgUpgrade(input, plan);
  if (json) console.log(stableJson(result).trimEnd());
  else {
    console.log(`Org upgrade ${result.status}: ${result.plan.org_home}`);
    console.log(`Archive: ${result.archive_path ?? "not needed"}`);
    console.log(`Doctor: ${result.doctor.status} — ${result.doctor.detail}`);
  }
  return 0;
}

function printUpgradePlan(plan: Awaited<ReturnType<typeof planOrgUpgrade>>): void {
  console.log(`Org upgrade plan: schema ${plan.current_schema} -> ${plan.target_schema}`);
  console.log(`Org home: ${plan.org_home}`);
  console.log(`Archive: ${plan.archive_root}/${plan.archive_id}`);
  console.log(`Authority: ${plan.authority.choice}`);
  for (const change of plan.changes) console.log(`  ${change.action}: ${change.path} — ${change.detail}`);
  for (const blocker of plan.blockers) console.log(`  blocked: ${blocker.code} — ${blocker.remediation}`);
  console.log("No changes made. Add --execute after reviewing this plan.");
}

async function init(args: string[], options: OrgCommandOptions): Promise<number> {
  const target = args[0];
  if (!target || target.startsWith("--")) {
    throw new Error("org init: local target path required — operon org init <path> --name <name>");
  }
  let name: string | undefined;
  let stateHome: string | undefined;
  let authorityProfile: AuthorityProfile = "delegated-operator";
  let authorityFile: string | undefined;
  let authorityBy: string | undefined;
  let json = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--name") name = needValue(args, ++i, "--name");
    else if (arg === "--state-home") stateHome = needValue(args, ++i, "--state-home");
    else if (arg === "--authority") {
      const value = needValue(args, ++i, "--authority");
      if (value === "delegated" || value === "delegated-operator") {
        authorityProfile = "delegated-operator";
      } else if (value === "conservative" || value === "custom") authorityProfile = value;
      else throw new Error("org init: --authority must be delegated-operator | conservative | custom");
    } else if (arg === "--authority-file") authorityFile = needValue(args, ++i, "--authority-file");
    else if (arg === "--authority-by") authorityBy = needValue(args, ++i, "--authority-by");
    else if (arg === "--json") json = true;
    else throw new Error(`org init: unknown argument "${arg}"`);
  }
  if (name === undefined) throw new Error("org init: --name <name> is required");
  if (authorityProfile === "custom" && (authorityFile === undefined || authorityBy === undefined)) {
    throw new Error("org init: custom authority requires --authority-file <path> and --authority-by <identity>");
  }
  if (authorityProfile !== "custom" && (authorityFile !== undefined || authorityBy !== undefined)) {
    throw new Error("org init: --authority-file/--authority-by are valid only with --authority custom");
  }
  const authorityCustomText =
    authorityFile !== undefined ? await readFile(resolve(authorityFile), "utf8") : undefined;

  const result = await initOrgHome({
    target,
    name,
    ...(stateHome !== undefined ? { stateHome } : {}),
    ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
    ...(options.pointerPath !== undefined ? { pointerPath: options.pointerPath } : {}),
    ...(options.templateRoot !== undefined ? { templateRoot: options.templateRoot } : {}),
    authorityProfile,
    ...(authorityCustomText !== undefined ? { authorityCustomText } : {}),
    ...(authorityBy !== undefined ? { authorityGrantedBy: authorityBy } : {}),
  });
  printHomes(result, json, "created and selected");
  if (!json) {
    console.log("Next: run `operon doctor`, then onboard an app with `operon bootstrap <local-repo-path>`.");
  }
  return 0;
}

async function show(args: string[], options: OrgCommandOptions): Promise<number> {
  let json = false;
  for (const arg of args) {
    if (arg === "--json") json = true;
    else throw new Error(`org show: unknown argument "${arg}"`);
  }
  const homes = await resolveOperonHomes({
    ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
    ...(options.pointerPath !== undefined ? { pointerPath: options.pointerPath } : {}),
  });
  const authority = await resolveAuthority({ orgHome: homes.orgHome });
  printHomes(
    { ...homes, authority, authorityPreview: previewFor(authority.profile) },
    json,
    "active",
  );
  return 0;
}

async function use(args: string[], options: OrgCommandOptions): Promise<number> {
  const orgHome = args[0];
  if (!orgHome || orgHome.startsWith("--")) throw new Error("org use: local org-home path required");
  let json = false;
  let stateHome: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") json = true;
    else if (arg === "--state-home") stateHome = needValue(args, ++i, "--state-home");
    else throw new Error(`org use: unknown argument "${arg}"`);
  }
  const resolvedOrgHome = resolve(orgHome);
  await validateOrgHome(resolvedOrgHome);
  const appsFile = await loadApps(join(resolvedOrgHome, "apps.yaml"));
  const homeDir = options.homeDir ?? homedir();
  const pointerPath = options.pointerPath ?? join(homeDir, ".operon", "config");
  await writeActiveOrgPointer(pointerPath, resolvedOrgHome, stateHome);
  const homes = await resolveOperonHomes({
    orgHome: resolvedOrgHome,
    ...(stateHome !== undefined ? { stateHome } : {}),
    homeDir,
    pointerPath,
  });
  const authority = await resolveAuthority({ orgHome: homes.orgHome });
  printHomes(
    { ...homes, appsFile, authority, authorityPreview: previewFor(authority.profile) },
    json,
    "selected",
  );
  return 0;
}

function printHomes(
  homes: Pick<InitOrgHomeResult, "packageRoot" | "orgHome" | "stateHome" | "pointerPath" | "appsFile"> &
    Partial<Pick<InitOrgHomeResult, "authority" | "authorityPreview">>,
  json: boolean,
  status: string,
): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          status,
          packageRoot: homes.packageRoot,
          orgHome: homes.orgHome,
          orgHomeMeaning: ORG_HOME_DEFINITION,
          stateHome: homes.stateHome,
          stateHomeMeaning: STATE_HOME_DEFINITION,
          pointerPath: homes.pointerPath,
          org: homes.appsFile.org.name,
          apps: homes.appsFile.apps.map((app) => app.name),
          ...(homes.authority !== undefined
            ? {
                authority: {
                  profile: homes.authority.profile,
                  version: homes.authority.version,
                  sha256: homes.authority.sha256,
                  sources: homes.authority.sources,
                  ...(homes.authorityPreview !== undefined
                    ? {
                        automatic: homes.authorityPreview.automatic,
                        humanGated: homes.authorityPreview.humanGated,
                      }
                    : {}),
                },
              }
            : {}),
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(`Org ${status}: ${homes.appsFile.org.name}`);
  console.log(`Org home:   ${homes.orgHome} — ${ORG_HOME_DEFINITION}.`);
  console.log(`State home: ${homes.stateHome} — ${STATE_HOME_DEFINITION}.`);
  console.log(`Pointer:    ${homes.pointerPath}`);
  console.log(`Apps:       ${homes.appsFile.apps.length}`);
  if (homes.authority !== undefined) {
    console.log(`Authority:  ${homes.authority.version} (sha256:${homes.authority.sha256})`);
    if (homes.authorityPreview !== undefined) {
      console.log("Automatic:");
      for (const action of homes.authorityPreview.automatic) console.log(`  - ${action}`);
      console.log("Human-gated:");
      for (const action of homes.authorityPreview.humanGated) console.log(`  - ${action}`);
    }
  }
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`org: ${flag} requires a value`);
  return value;
}

function previewFor(profile: string): ReturnType<typeof authorityPreview> {
  return authorityPreview(
    profile === "conservative"
      ? "conservative"
      : profile === "custom"
        ? "custom"
        : "delegated-operator",
  );
}
