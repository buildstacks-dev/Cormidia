import { resolve } from "node:path";
import { resolveCormidiaHomes } from "../org/home.js";
import { analyzeRunlogs } from "../runtime/runlog/anomalies.js";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdAnalyze(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "analyze");
  const parsed = parseArgs(common.rest);
  const stateHome = common.stateHome ? resolve(common.stateHome) : (await resolveCormidiaHomes(common)).stateHome;
  const rows = await analyzeRunlogs(stateHome, parsed.app !== undefined ? { app: parsed.app } : {});
  const report = {
    schema_version: 1,
    kind: "analyze",
    stateHome,
    app: parsed.app ?? null,
    anomalyCount: rows.length,
    anomalies: rows,
  } as const;
  if (parsed.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  if (report.anomalyCount === 0) {
    console.log("No anomaly flags.");
    return 0;
  }
  for (const row of report.anomalies) {
    console.log(
      `${row.app} ${row.runId} ${row.pipeline}/${row.pass} ${row.flag}: ${row.detail} -> ${row.recommendation}`,
    );
  }
  return 0;
}

interface ParsedAnalyzeArgs {
  app?: string;
  json: boolean;
}

function parseArgs(args: string[]): ParsedAnalyzeArgs {
  const out: ParsedAnalyzeArgs = { json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--app") out.app = needValue(args, ++i, "--app");
    else if (arg === "--json") out.json = true;
    else throw new Error(`analyze: unknown argument "${arg}"`);
  }
  return out;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`analyze: ${flag} requires a value`);
  return value;
}
