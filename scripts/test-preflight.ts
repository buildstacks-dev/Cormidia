// CF-REG-444 · HB-139 · harness/CI test entrypoint; process lifecycle B-07
// and the disposable offline-install fixture contract.
//
// This module is intentionally outside Vitest. It proves the host capabilities
// required by the complete offline suite, then starts Vitest exactly once only
// after those capabilities are available.

import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { processStartIdentity } from "../src/runtime/process-identity.js";
import { checkOfflinePackageStore, type PackageStoreProbeDependencies } from "./test-preflight-store.js";

const PREFLIGHT_SCHEMA = "cormidia-test-preflight/1";

type CheckStatus = "available" | "unavailable";

export interface PreflightCheck {
  readonly id: "process-start-identity" | "offline-package-store";
  readonly status: CheckStatus;
  readonly evidence: string;
  readonly remediation: string;
}

export interface TestPreflightResult {
  readonly schema: typeof PREFLIGHT_SCHEMA;
  readonly completeness: "complete" | "incomplete";
  readonly checks: readonly PreflightCheck[];
}

export interface LiveChild {
  readonly pid: number;
  readonly alive: () => boolean;
  readonly cleanup: () => Promise<void>;
}

export interface ProcessProbeDependencies {
  readonly readIdentity?: (pid: number) => string | undefined;
  readonly spawnLiveChild?: () => Promise<LiveChild>;
}

export interface TestPreflightOptions {
  readonly repoRoot: string;
  readonly storeDir?: string;
  readonly processProbe?: ProcessProbeDependencies;
  readonly packageStoreProbe?: PackageStoreProbeDependencies;
}

export interface TestCommandOptions extends TestPreflightOptions {
  readonly vitestBin: string;
  readonly vitestArgs: readonly string[];
  readonly preflight?: () => Promise<TestPreflightResult>;
  readonly runVitest?: (vitestBin: string, args: readonly string[]) => Promise<number>;
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function waitForSpawn(child: ChildProcess): Promise<void> {
  if (child.pid !== undefined) return;
  await once(child, "spawn");
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((done) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done();
    };
    const timer = setTimeout(() => {
      finish();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 1_000);
    child.once("close", finish);
  });
}

async function spawnLiveChild(): Promise<LiveChild> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  try {
    await waitForSpawn(child);
    const pid = child.pid;
    if (pid === undefined) throw new Error("spawned child has no pid");
    return {
      pid,
      alive: () => child.exitCode === null && child.signalCode === null,
      cleanup: () => stopChild(child),
    };
  } catch (error) {
    await stopChild(child).catch(() => undefined);
    throw error;
  }
}

function available(id: PreflightCheck["id"], evidence: string): PreflightCheck {
  return { id, status: "available", evidence, remediation: "" };
}

function unavailable(id: PreflightCheck["id"], evidence: string, remediation: string): PreflightCheck {
  return { id, status: "unavailable", evidence, remediation };
}

export async function checkProcessStartIdentity(dependencies: ProcessProbeDependencies = {}): Promise<PreflightCheck> {
  const readIdentity = dependencies.readIdentity ?? processStartIdentity;
  let currentIdentity: string | undefined;
  let currentError: string | undefined;
  try {
    currentIdentity = readIdentity(process.pid);
  } catch (error) {
    currentError = errorDetail(error);
  }

  let childIdentity: string | undefined;
  let childError: string | undefined;
  let childWasLive = false;
  try {
    const child = await (dependencies.spawnLiveChild ?? spawnLiveChild)();
    try {
      childWasLive = child.alive();
      if (childWasLive) childIdentity = readIdentity(child.pid);
      else childError = "live child exited before its identity was observed";
    } catch (error) {
      childError = errorDetail(error);
    } finally {
      await child.cleanup();
    }
  } catch (error) {
    childError = errorDetail(error);
  }

  const currentAvailable = typeof currentIdentity === "string" && currentIdentity.length > 0;
  const childAvailable = childWasLive && typeof childIdentity === "string" && childIdentity.length > 0;
  if (currentAvailable && childAvailable) {
    return available(
      "process-start-identity",
      `current pid ${process.pid} and live child pid observed with product process-start identities`,
    );
  }

  const evidence = [
    currentAvailable
      ? `current pid ${process.pid}: identity observed`
      : `current pid ${process.pid}: ${currentError ?? "process-start identity unavailable"}`,
    childAvailable
      ? "live child: identity observed"
      : `live child: ${childError ?? "process-start identity unavailable"}`,
  ].join("; ");
  return unavailable(
    "process-start-identity",
    evidence,
    "Use a host where the OS exposes process-start identity for this process and a spawned child, then retry pnpm test.",
  );
}

export async function runTestPreflight(options: TestPreflightOptions): Promise<TestPreflightResult> {
  const checks = await Promise.all([
    checkProcessStartIdentity(options.processProbe),
    checkOfflinePackageStore(options.repoRoot, options.storeDir, options.packageStoreProbe),
  ]);
  const incomplete = checks.some((check) => check.status === "unavailable");
  return {
    schema: PREFLIGHT_SCHEMA,
    completeness: incomplete ? "incomplete" : "complete",
    checks,
  };
}

export function formatPreflightResult(result: TestPreflightResult): string {
  if (result.completeness === "complete") {
    return "Cormidia test preflight: complete; Vitest may start.\n";
  }
  const failures = result.checks.filter((check) => check.status === "unavailable");
  return [
    "Cormidia test preflight: INCOMPLETE; Vitest was not started.",
    ...failures.map((failure) => `- ${failure.id}: ${failure.evidence}\n  remediation: ${failure.remediation}`),
    "",
  ].join("\n");
}

async function runVitest(vitestBin: string, args: readonly string[]): Promise<number> {
  return new Promise((done) => {
    const child = spawn(vitestBin, [...args], { cwd: process.cwd(), stdio: "inherit" });
    child.once("error", () => done(1));
    child.once("close", (code) => done(code ?? 1));
  });
}

export async function runTestCommand(options: TestCommandOptions): Promise<number> {
  const result = await (options.preflight ?? (() => runTestPreflight(options)))();
  process.stderr.write(formatPreflightResult(result));
  if (result.completeness !== "complete") return 1;
  return (options.runVitest ?? runVitest)(options.vitestBin, options.vitestArgs);
}

function parseArguments(args: readonly string[]): {
  vitestBin: string;
  storeDir: string | undefined;
  vitestArgs: readonly string[];
} {
  let vitestBin: string | undefined;
  let storeDir: string | undefined;
  let separator = -1;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--") {
      separator = index;
      break;
    }
    const value = args[index + 1];
    if ((flag === "--vitest" || flag === "--store-dir") && value !== undefined) {
      if (flag === "--vitest") vitestBin = value;
      else storeDir = value;
      index += 1;
      continue;
    }
    throw new Error("usage: test-preflight.ts --vitest <path> [--store-dir <path>] -- [vitest args]");
  }
  if (vitestBin === undefined || separator < 0) {
    throw new Error("usage: test-preflight.ts --vitest <path> [--store-dir <path>] -- [vitest args]");
  }
  return { vitestBin, storeDir, vitestArgs: args.slice(separator + 1) };
}

async function main(): Promise<void> {
  const parsed = parseArguments(process.argv.slice(2));
  const code = await runTestCommand({
    repoRoot: resolve(fileURLToPath(new URL("..", import.meta.url))),
    vitestBin: parsed.vitestBin,
    vitestArgs: parsed.vitestArgs,
    ...(parsed.storeDir === undefined ? {} : { storeDir: parsed.storeDir }),
  });
  process.exitCode = code;
}

const entrypoint = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entrypoint === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Cormidia test preflight: INCOMPLETE; ${errorDetail(error)}\n`);
    process.exitCode = 1;
  });
}
