import { spawn } from "node:child_process";
import { open, mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolveCormidiaHomes } from "../org/home.js";
import { buildReport } from "../report/project.js";
import { renderReportHtml } from "../report/render-html.js";
import { renderReportTerminal } from "../report/render-terminal.js";
import type { ReportQuery } from "../report/types.js";
import { extractHomeFlags } from "./home-flags.js";

interface ReportArgs {
  query: ReportQuery;
  json: boolean;
  html?: string;
  open: boolean;
}

export async function cmdReport(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "report");
  const parsed = parseReportArgs(common.rest);
  const homes = await resolveCormidiaHomes(common);
  const report = await buildReport({
    orgName: homes.appsFile.org.name,
    stateHome: homes.stateHome,
    appsFile: homes.appsFile,
    query: parsed.query,
  });
  if (parsed.html !== undefined) {
    const target = resolve(parsed.html);
    await writeFileAtomic(target, renderReportHtml(report));
    if (parsed.json) console.error(`report: wrote ${target}`);
    else console.log(`report: wrote ${target}`);
    if (parsed.open) openBrowser(target);
  }
  if (parsed.json) console.log(JSON.stringify(report, null, 2));
  else if (parsed.html === undefined) console.log(renderReportTerminal(report));
  return 0;
}

export function parseReportArgs(args: string[]): ReportArgs {
  const out: ReportArgs = { query: {}, json: false, open: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--app") out.query.app = need(args, ++index, arg);
    else if (arg === "--period") out.query.period = period(need(args, ++index, arg));
    else if (arg === "--since") out.query.since = need(args, ++index, arg);
    else if (arg === "--until") out.query.until = need(args, ++index, arg);
    else if (arg === "--bucket") out.query.bucket = bucket(need(args, ++index, arg));
    else if (arg === "--json") out.json = true;
    else if (arg === "--html") out.html = need(args, ++index, arg);
    else if (arg === "--open") out.open = true;
    else if (arg === "--summary-only") out.query.summaryOnly = true;
    else throw new Error(`report: unknown argument "${arg}"`);
  }
  if (out.open && out.html === undefined) throw new Error("report: --open requires --html <path>");
  return out;
}

async function writeFileAtomic(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function openBrowser(path: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", path] : [path];
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}

function need(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`report: ${flag} requires a value`);
  return value;
}
function period(value: string): NonNullable<ReportQuery["period"]> {
  if (!["7d", "30d", "90d", "1y", "all"].includes(value)) throw new Error("report: --period must be 7d|30d|90d|1y|all");
  return value as NonNullable<ReportQuery["period"]>;
}
function bucket(value: string): NonNullable<ReportQuery["bucket"]> {
  if (!["auto", "day", "week", "month"].includes(value))
    throw new Error("report: --bucket must be auto|day|week|month");
  return value as NonNullable<ReportQuery["bucket"]>;
}
