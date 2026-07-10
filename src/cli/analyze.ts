import { analyzeRunlogs } from "../runtime/runlog/anomalies.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";
import { resolve } from "node:path";

export async function cmdAnalyze(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "analyze");
  const parsed = parseArgs(common.rest);
  const stateHome = common.stateHome ? resolve(common.stateHome) : (await resolveOperonHomes(common)).stateHome;
  const rows = await analyzeRunlogs(stateHome, parsed.app !== undefined ? { app: parsed.app } : {});
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
  app?: string;
}

function parseArgs(args: string[]): ParsedAnalyzeArgs {
  const out: ParsedAnalyzeArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--app") out.app = needValue(args, ++i, "--app");
    else throw new Error(`analyze: unknown argument "${arg}"`);
  }
  return out;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`analyze: ${flag} requires a value`);
  return value;
}
