import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadApps } from "../org/apps.js";
import { loadRoles } from "../org/roles.js";
import { runRetro } from "../org/retro.js";

export async function cmdRetro(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  const appsPath = resolve(parsed.apps ?? "apps.yaml");
  const rolesPath = resolve(parsed.roles ?? "roles.yaml");
  const appsFile = await loadApps(appsPath);
  const rolesFile = await loadRoles(rolesPath);
  const root = resolve(parsed.home ?? process.env.OPERON_HOME ?? join(homedir(), ".operon", appsFile.org.name));
  const date = parsed.date ?? new Date().toISOString().slice(0, 10);
  const result = await runRetro({
    orgHome: root,
    date,
    apps: appsFile.apps.map((app) => app.name),
    roles: rolesFile.roles.map((role) => role.name),
  });
  console.log(result.path);
  return 0;
}

interface ParsedRetroArgs {
  date?: string;
  home?: string;
  apps?: string;
  roles?: string;
}

function parseArgs(args: string[]): ParsedRetroArgs {
  const out: ParsedRetroArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--date") out.date = needValue(args, ++i, "--date");
    else if (arg === "--home") out.home = needValue(args, ++i, "--home");
    else if (arg === "--apps") out.apps = needValue(args, ++i, "--apps");
    else if (arg === "--roles") out.roles = needValue(args, ++i, "--roles");
    else throw new Error(`retro: unknown argument "${arg}"`);
  }
  return out;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`retro: ${flag} requires a value`);
  return value;
}
