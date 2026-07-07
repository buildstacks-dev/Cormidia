import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { analyzeRunlogs } from "../runtime/runlog/anomalies.js";
import { loadApps } from "../org/apps.js";

export async function cmdAnalyze(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  const root = resolve(parsed.home ?? process.env.OPERON_HOME ?? (await defaultOrgHome()));
  const rows = await analyzeRunlogs(root, parsed.app !== undefined ? { app: parsed.app } : {});
  if (rows.length === 0) {
    console.log("No anomaly flags.");
    return 0;
  }
  for (const row of rows) {
    console.log(
      `${row.app} ${row.runId} ${row.pipeline}/${row.pass} ${row.flag}: ${row.detail} -> ${row.recommendation}`,
    );
  }
  return 0;
}

interface ParsedAnalyzeArgs {
  home?: string;
  app?: string;
}

function parseArgs(args: string[]): ParsedAnalyzeArgs {
  const out: ParsedAnalyzeArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--home") out.home = needValue(args, ++i, "--home");
    else if (arg === "--app") out.app = needValue(args, ++i, "--app");
    else throw new Error(`analyze: unknown argument "${arg}"`);
  }
  return out;
}

// Default the org home to the same location sibling commands (budget, dispatch,
// retro) use: ~/.operon/<apps.yaml org name>, not a hardcoded "operon".
async function defaultOrgHome(): Promise<string> {
  const apps = await loadApps("apps.yaml");
  return join(homedir(), ".operon", apps.org.name);
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`analyze: ${flag} requires a value`);
  return value;
}
