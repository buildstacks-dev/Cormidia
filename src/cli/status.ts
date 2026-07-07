import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { formatStatusRows, readStatusRows } from "../runtime/runlog/status.js";
import { loadApps } from "../org/apps.js";

export async function cmdStatus(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  const root = resolve(parsed.home ?? process.env.OPERON_HOME ?? (await defaultOrgHome()));
  const rows = await readStatusRows(root, {
    ...(parsed.app !== undefined ? { app: parsed.app } : {}),
    ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
  });
  console.log(formatStatusRows(rows));
  return 0;
}

interface ParsedStatusArgs {
  home?: string;
  app?: string;
  limit?: number;
}

function parseArgs(args: string[]): ParsedStatusArgs {
  const out: ParsedStatusArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--home") out.home = needValue(args, ++i, "--home");
    else if (arg === "--app") out.app = needValue(args, ++i, "--app");
    else if (arg === "--limit") out.limit = parseLimit(needValue(args, ++i, "--limit"));
    else throw new Error(`status: unknown argument "${arg}"`);
  }
  return out;
}

// Default the org home to the same location sibling commands (budget, dispatch,
// retro) use: ~/.operon/<apps.yaml org name>, not a hardcoded "operon".
async function defaultOrgHome(): Promise<string> {
  const apps = await loadApps("apps.yaml");
  return join(homedir(), ".operon", apps.org.name);
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error("status: --limit must be a positive integer");
  return parsed;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`status: ${flag} requires a value`);
  return value;
}
