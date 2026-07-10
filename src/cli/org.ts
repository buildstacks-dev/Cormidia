// `operon org init|show|use` — explicit organization-home lifecycle.

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  initOrgHome,
  ORG_HOME_DEFINITION,
  resolveOperonHomes,
  STATE_HOME_DEFINITION,
  validateOrgHome,
  writeActiveOrgPointer,
  type InitOrgHomeResult,
} from "../org/home.js";
import { loadApps } from "../org/apps.js";

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
  throw new Error('org: expected "init", "show", or "use" — run `operon org --help`');
}

async function init(args: string[], options: OrgCommandOptions): Promise<number> {
  const target = args[0];
  if (!target || target.startsWith("--")) {
    throw new Error("org init: local target path required — operon org init <path> --name <name>");
  }
  let name: string | undefined;
  let stateHome: string | undefined;
  let json = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--name") name = needValue(args, ++i, "--name");
    else if (arg === "--state-home") stateHome = needValue(args, ++i, "--state-home");
    else if (arg === "--json") json = true;
    else throw new Error(`org init: unknown argument "${arg}"`);
  }
  if (name === undefined) throw new Error("org init: --name <name> is required");

  const result = await initOrgHome({
    target,
    name,
    ...(stateHome !== undefined ? { stateHome } : {}),
    ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
    ...(options.pointerPath !== undefined ? { pointerPath: options.pointerPath } : {}),
    ...(options.templateRoot !== undefined ? { templateRoot: options.templateRoot } : {}),
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
  printHomes(homes, json, "active");
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
  printHomes({ ...homes, appsFile }, json, "selected");
  return 0;
}

function printHomes(
  homes: Pick<InitOrgHomeResult, "packageRoot" | "orgHome" | "stateHome" | "pointerPath" | "appsFile">,
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
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`org: ${flag} requires a value`);
  return value;
}
