// CF-REG-444 · HB-139 · disposable offline-install capability probe.

import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PreflightCheck } from "./test-preflight.js";

const execFileAsync = promisify(execFile);
const PREFLIGHT_TIMEOUT_MS = 120_000;
const MAX_DIAGNOSTIC_CHARS = 800;

export interface InstallInvocation {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

export interface InstallResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface PackageStoreProbeDependencies {
  readonly install?: (invocation: InstallInvocation) => Promise<InstallResult>;
}

function boundedDiagnostic(value: string): string {
  const lines = value
    .trim()
    .split(/\r?\n/)
    .filter((line) => line !== "")
    .slice(-8)
    .join("\n");
  if (lines.length <= MAX_DIAGNOSTIC_CHARS) return lines;
  return `…${lines.slice(-(MAX_DIAGNOSTIC_CHARS - 1))}`;
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function hasProperty(value: object, field: string): value is Record<string, unknown> {
  return field in value;
}

function errorField(error: unknown, field: "code" | "stdout" | "stderr"): string | number | undefined {
  if (typeof error !== "object" || error === null || !hasProperty(error, field)) return undefined;
  const value = error[field];
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function withoutWorkspaceSelector(source: string): string {
  const kept: string[] = [];
  let skipping = false;
  for (const line of source.split(/\r?\n/)) {
    if (skipping && /^\s/.test(line)) continue;
    skipping = false;
    if (line.startsWith("packages:")) {
      skipping = true;
      continue;
    }
    kept.push(line);
  }
  return `${kept.join("\n").trimEnd()}\n`;
}

async function prepareCanary(repoRoot: string, canary: string): Promise<void> {
  await Promise.all(
    ["package.json", "pnpm-lock.yaml"].map(async (name) => {
      await cp(join(repoRoot, name), join(canary, name));
    }),
  );
  const workspace = await readFile(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  await writeFile(join(canary, "pnpm-workspace.yaml"), withoutWorkspaceSelector(workspace), "utf8");
  await cp(join(repoRoot, "vendor"), join(canary, "vendor"), { recursive: true });
}

async function runPnpmInstall(invocation: InstallInvocation): Promise<InstallResult> {
  try {
    const result = await execFileAsync("pnpm", [...invocation.args], {
      cwd: invocation.cwd,
      env: invocation.env,
      encoding: "utf8",
      timeout: PREFLIGHT_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
    return { exitCode: 0, stdout: String(result.stdout), stderr: String(result.stderr) };
  } catch (error) {
    const code = errorField(error, "code");
    return {
      exitCode: typeof code === "number" ? code : 1,
      stdout: String(errorField(error, "stdout") ?? ""),
      stderr: String(errorField(error, "stderr") ?? errorDetail(error)),
    };
  }
}

export async function checkOfflinePackageStore(
  repoRoot: string,
  storeDir: string | undefined,
  dependencies: PackageStoreProbeDependencies = {},
): Promise<PreflightCheck> {
  let canary: string | undefined;
  try {
    canary = await mkdtemp(join(tmpdir(), "cormidia-test-preflight-"));
    await prepareCanary(repoRoot, canary);
    const env = { ...process.env };
    if (storeDir !== undefined && storeDir !== "") env.PNPM_CONFIG_STORE_DIR = storeDir;
    const invocation: InstallInvocation = {
      cwd: canary,
      args: [
        "install",
        "--offline",
        "--frozen-lockfile",
        "--trust-lockfile",
        "--ignore-scripts",
        "--verify-store-integrity",
      ],
      env,
    };
    const result = await (dependencies.install ?? runPnpmInstall)(invocation);
    if (result.exitCode === 0) {
      return {
        id: "offline-package-store",
        status: "available",
        evidence:
          "disposable canary accepted the exact offline/frozen/trusted-lockfile/ignore-scripts/integrity install contract",
        remediation: "",
      };
    }
    const output = boundedDiagnostic(`${result.stderr}\n${result.stdout}`);
    return {
      id: "offline-package-store",
      status: "unavailable",
      evidence: `canary install exited ${result.exitCode}${output === "" ? "" : `: ${output}`}`,
      remediation:
        "Restore or populate the pnpm package store, then retry pnpm test; the preflight never downloads packages.",
    };
  } catch (error) {
    return {
      id: "offline-package-store",
      status: "unavailable",
      evidence: `canary could not verify the offline install contract: ${boundedDiagnostic(errorDetail(error))}`,
      remediation:
        "Run pnpm install --frozen-lockfile with network access, confirm vendor/ is present, then retry pnpm test.",
    };
  } finally {
    if (canary !== undefined) await rm(canary, { recursive: true, force: true }).catch(() => undefined);
  }
}
