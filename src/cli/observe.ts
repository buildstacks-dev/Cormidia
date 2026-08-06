import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { ObserveService } from "../observe/live-source.js";
import { startObserveServer } from "../observe/server.js";
import type { ObserveFiltersV1 } from "../observe/types.js";
import { resolveCormidiaHomes } from "../org/home.js";
import { ReportService } from "../report/service.js";
import { extractHomeFlags } from "./home-flags.js";
import { definedProps } from "../runtime/optional-properties.js";

interface ObserveArgs {
  app?: string;
  parentTask?: string;
  ticket?: number;
  port?: number;
  open: boolean;
}

export async function cmdObserve(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "observe");
  const parsed = parseArgs(common.rest);
  const homes = await resolveCormidiaHomes(common);
  if (parsed.app !== undefined && !homes.appsFile.apps.some((app) => app.name === parsed.app)) {
    throw new Error(`observe: unknown registered app "${parsed.app}"`);
  }
  await mkdir(homes.stateHome, { recursive: true });
  const filters: ObserveFiltersV1 = {
    ...definedProps({ app: parsed.app }),
    ...definedProps({ ticket: parsed.ticket }),
  };
  const service = new ObserveService({
    orgName: homes.appsFile.org.name,
    stateHome: homes.stateHome,
    appsFile: homes.appsFile,
    filters,
  });
  await service.start();
  const started = await startObserveServer({
    service,
    stateHome: homes.stateHome,
    reportService: new ReportService({
      orgName: homes.appsFile.org.name,
      stateHome: homes.stateHome,
      appsFile: homes.appsFile,
      ...definedProps({ appScope: parsed.app }),
    }),
    ...definedProps({ port: parsed.port }),
  });

  const observerUrl = initialViewUrl(started.url, parsed);
  console.log(`Cormidia observer: ${observerUrl}`);
  console.log(`Package root: ${homes.packageRoot}`);
  console.log(`Org home:     ${homes.orgHome}`);
  console.log(`State home:   ${homes.stateHome}`);
  console.log("Mode:         READ ONLY · loopback only · token-free · no workflow controls");
  if (parsed.open) openBrowser(observerUrl);

  await waitForShutdown();
  await service.stop();
  await started.close();
  return 0;
}

function parseArgs(args: string[]): ObserveArgs {
  const out: ObserveArgs = { open: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--app") out.app = needValue(args, ++index, arg);
    else if (arg === "--parent-task") out.parentTask = needValue(args, ++index, arg);
    else if (arg === "--ticket") out.ticket = positiveInteger(needValue(args, ++index, arg), arg);
    else if (arg === "--port") out.port = portNumber(needValue(args, ++index, arg));
    else if (arg === "--open") out.open = true;
    else if (arg === "--no-open") out.open = false;
    else throw new Error(`observe: unknown argument "${arg}"`);
  }
  return out;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`observe: ${flag} requires a value`);
  return value;
}

function positiveInteger(value: string, flag: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`observe: ${flag} must be a positive integer`);
  return number;
}

function portNumber(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 65535)
    throw new Error("observe: --port must be 0..65535");
  return number;
}

function initialViewUrl(base: string, parsed: ObserveArgs): string {
  const url = new URL(base);
  if (parsed.app !== undefined) url.searchParams.set("app", parsed.app);
  if (parsed.parentTask !== undefined) url.searchParams.set("session", `task:${parsed.parentTask}`);
  if (parsed.ticket !== undefined) url.searchParams.set("ticket", String(parsed.ticket));
  return url.toString();
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolve();
    };
    process.on("SIGINT", done);
    process.on("SIGTERM", done);
  });
}
