import { execFile as execFileCallback } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";

const execFile = promisify(execFileCallback);
export const RELEASE_CANDIDATE_INSTALL_ARGS = [
  "install",
  "--offline",
  "--frozen-lockfile",
  "--trust-lockfile",
  "--ignore-scripts",
  "--verify-store-integrity",
] as const;

export async function execPinnedReleasePnpm(
  repo: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = releaseExecutionEnvironment(),
): Promise<{ stdout: string; stderr: string }> {
  const expected = exactPnpmVersion(await readFile(join(repo, "package.json"), "utf8"));
  const run = async (command: readonly string[]): Promise<{ stdout: string; stderr: string }> =>
    execFile("pnpm", [...command], {
      cwd: repo,
      env: { ...environment, COREPACK_ENABLE_NETWORK: "0" },
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
  const observed = await run(["--version"]);
  if (observed.stderr.trim() !== "")
    throw new Error(`installed pnpm version check wrote stderr: ${observed.stderr.trim()}`);
  if (observed.stdout.trim() !== expected)
    throw new Error(`installed pnpm ${observed.stdout.trim()} does not match exact packageManager pin ${expected}`);
  return run(args);
}

export async function releaseNodeVersion(
  repo: string,
  environment: NodeJS.ProcessEnv = releaseExecutionEnvironment(),
): Promise<string> {
  const result = await execFile("node", ["--version"], {
    cwd: repo,
    env: environment,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.stderr.trim() !== "") throw new Error(`release Node version check wrote stderr: ${result.stderr.trim()}`);
  const match = /^v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$/.exec(result.stdout.trim());
  if (match?.[1] === undefined) throw new Error("release Node version output is malformed");
  return match[1];
}

export async function releasePackageStore(repo: string): Promise<string> {
  let packageBytes: string;
  let metadataBytes: string;
  try {
    [packageBytes, metadataBytes] = await Promise.all([
      readFile(join(repo, "package.json"), "utf8"),
      readFile(join(repo, "node_modules", ".modules.yaml"), "utf8"),
    ]);
  } catch (error) {
    throw new Error("release package store metadata is missing or unreadable", { cause: error });
  }
  const metadata = record(parseYaml(metadataBytes), "node_modules/.modules.yaml");
  const packageManager = `pnpm@${exactPnpmVersion(packageBytes)}`;
  if (metadata["packageManager"] !== packageManager)
    throw new Error("installed package metadata differs from the exact packageManager pin");
  const storeDir = nonEmpty(metadata["storeDir"], "installed package storeDir");
  if (!isAbsolute(storeDir)) throw new Error("installed package storeDir must be absolute");
  let canonical: string;
  try {
    canonical = await realpath(storeDir);
    if (!(await stat(canonical)).isDirectory()) throw new Error("not a directory");
  } catch (error) {
    throw new Error("installed package storeDir is missing or is not a directory", { cause: error });
  }
  return canonical;
}

export function releaseExecutionEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { CI: "true", NO_COLOR: "1", COREPACK_ENABLE_NETWORK: "0" };
  const inherited =
    "PATH HOME TMPDIR TMP TEMP SHELL USER LOGNAME LANG LC_ALL TZ PNPM_HOME " +
    "PNPM_CONFIG_STORE_DIR NPM_CONFIG_USERCONFIG NPM_CONFIG_GLOBALCONFIG COREPACK_HOME";
  for (const name of inherited.split(" ")) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

function parseJson(value: string, name: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${name} is not valid JSON`, { cause: error });
  }
}

function exactPnpmVersion(packageBytes: string): string {
  const root = record(parseJson(packageBytes, "package.json"), "package.json");
  const packageManager = nonEmpty(root["packageManager"], "package.json packageManager");
  const match = /^pnpm@([0-9]+\.[0-9]+\.[0-9]+)$/.exec(packageManager);
  if (match?.[1] === undefined) throw new Error("package.json packageManager must be an exact pnpm version");
  return match[1];
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return Object.fromEntries(Object.entries(value));
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string`);
  return value;
}
