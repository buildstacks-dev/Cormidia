import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { arch, platform } from "node:process";
import { promisify } from "node:util";
import {
  execPinnedReleasePnpm,
  RELEASE_CANDIDATE_INSTALL_ARGS,
  releaseExecutionEnvironment,
  releaseNodeVersion,
  releasePackageStore,
} from "./release-package-manager.js";
import { loadReleasePolicyAuthorityFromGit } from "./release-policy-git.js";
import type { ReleasePolicyAuthority } from "./release-policy-authority.js";

const execFile = promisify(execFileCallback);
interface CandidateToolchain {
  node: string;
  pnpm: string;
  typescript: string;
  vitest: string;
  claude_agent_sdk: string;
  pi_coding_agent: string;
  openai_codex: string;
  platform: string;
  architecture: string;
}

export async function runReleaseCandidateValidation(
  repo: string,
  revision: string,
): Promise<{ vitestReport: unknown; policyAuthority: ReleasePolicyAuthority; toolchain: CandidateToolchain }> {
  const executionRoot = await mkdtemp(join(tmpdir(), "cormidia-rq1-execution-"));
  const executionRepo = join(executionRoot, "candidate");
  try {
    const sourceRepo = await realpath(repo);
    await execFile("git", ["clone", "--quiet", "--no-checkout", "--shared", sourceRepo, executionRepo], {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
    await git(executionRepo, ["sparse-checkout", "set", "--no-cone", "/*", "!/archive-do-not-read/"]);
    await git(executionRepo, ["checkout", "--quiet", "--detach", revision]);
    const canonicalRepo = await realpath(executionRepo);
    const environment = {
      ...releaseExecutionEnvironment(),
      PNPM_CONFIG_STORE_DIR: await releasePackageStore(repo),
    };
    try {
      await execPinnedReleasePnpm(executionRepo, RELEASE_CANDIDATE_INSTALL_ARGS, environment);
    } catch (error) {
      const detail = errorOutput(error, "stderr").trim();
      throw new Error(
        `release candidate offline install requires its exact installed packageManager executable/version${detail === "" ? "" : `: ${detail}`}`,
        { cause: error },
      );
    }
    const policyAuthority = await loadReleasePolicyAuthorityFromGit(executionRepo, revision, (productRevision) =>
      validatePublicModel(executionRepo, environment, productRevision),
    );
    return {
      policyAuthority,
      toolchain: await candidateToolchain(executionRepo, environment),
      vitestReport: await runVitest(executionRepo, canonicalRepo, environment),
    };
  } finally {
    await rm(executionRoot, { recursive: true, force: true });
  }
}

async function candidateToolchain(repo: string, environment: NodeJS.ProcessEnv): Promise<CandidateToolchain> {
  const packageVersion = async (path: string): Promise<string> => {
    const value = record(
      parseJson(await readFile(join(repo, "node_modules", ...path.split("/"), "package.json"), "utf8"), path),
      `${path} package.json`,
    );
    const version = value["version"];
    if (typeof version !== "string" || version.trim() === "") throw new Error(`${path} version must be non-empty`);
    return version;
  };
  const pnpm = (await execPinnedReleasePnpm(repo, ["--version"], environment)).stdout.trim();
  return {
    node: await releaseNodeVersion(repo, environment),
    pnpm,
    typescript: await packageVersion("typescript"),
    vitest: await packageVersion("vitest"),
    claude_agent_sdk: await packageVersion("@anthropic-ai/claude-agent-sdk"),
    pi_coding_agent: await packageVersion("@earendil-works/pi-coding-agent"),
    openai_codex: await packageVersion("@openai/codex"),
    platform,
    architecture: arch,
  };
}

async function validatePublicModel(
  repo: string,
  environment: NodeJS.ProcessEnv,
  expectedRevision: string,
): Promise<void> {
  let stdout: string;
  let stderr: string;
  try {
    const result = await execPinnedReleasePnpm(repo, ["exec", "validation-architect", "compile", "."], environment);
    ({ stdout, stderr } = result);
  } catch (error) {
    const detail = errorOutput(error, "stderr").trim();
    throw new Error(`release validation-model compiler failed${detail === "" ? "" : `: ${detail}`}`, {
      cause: error,
    });
  }
  parsePublicModelCompilerSuccess(stdout, stderr, expectedRevision);
}

export function parsePublicModelCompilerSuccess(
  stdout: string,
  stderr: string,
  expectedRevision: string,
): { identity: string; revision: string } {
  if (stderr.trim() !== "") throw new Error(`release validation-model compiler wrote stderr: ${stderr.trim()}`);
  const accepted = /^accepted: model ([a-f0-9]{64}) at revision ([a-f0-9]{40})$/.exec(stdout.trim());
  const identity = accepted?.[1];
  const revision = accepted?.[2];
  if (identity === undefined || revision === undefined)
    throw new Error("release validation-model compiler success output is malformed");
  if (revision !== expectedRevision)
    throw new Error("release validation-model compiler accepted a different product revision");
  return { identity, revision };
}

async function runVitest(repo: string, canonicalRepo: string, environment: NodeJS.ProcessEnv): Promise<unknown> {
  let stdout: string;
  try {
    const result = await execPinnedReleasePnpm(
      repo,
      ["exec", "vitest", "run", "--reporter=json", "--no-cache"],
      environment,
    );
    stdout = result.stdout;
  } catch (error) {
    const failedStdout = errorOutput(error, "stdout");
    if (failedStdout.trim() !== "") {
      try {
        return normalizeVitestReportPaths(JSON.parse(failedStdout), canonicalRepo);
      } catch {
        // Preserve the execution error when stdout is not one trustworthy report.
      }
    }
    const detail = errorOutput(error, "stderr").trim();
    throw new Error(`release candidate Vitest execution failed${detail === "" ? "" : `: ${detail}`}`, {
      cause: error,
    });
  }
  try {
    return normalizeVitestReportPaths(JSON.parse(stdout), canonicalRepo);
  } catch (error) {
    throw new Error("release candidate Vitest JSON report is malformed", { cause: error });
  }
}

function normalizeVitestReportPaths(report: unknown, repo: string): unknown {
  const root = record(report, "Vitest JSON report");
  if (!Array.isArray(root["testResults"])) return report;
  for (const raw of root["testResults"]) {
    const file = record(raw, "Vitest test result");
    const name = file["name"];
    if (typeof name !== "string" || name.trim() === "") continue;
    const absolute = isAbsolute(name) ? resolve(name) : resolve(repo, name);
    const path = relative(resolve(repo), absolute);
    if (path === "" || isAbsolute(path) || path.split(sep).includes(".."))
      throw new Error(`Vitest test result is outside the isolated candidate checkout: ${name}`);
    file["name"] = safeRelativePath(path, "isolated Vitest test result path");
  }
  return report;
}

async function git(repo: string, args: string[]): Promise<void> {
  try {
    await execFile("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  } catch (error) {
    const detail = errorOutput(error, "stderr").trim();
    throw new Error(`release validation git ${args[0] ?? "command"} failed${detail === "" ? "" : `: ${detail}`}`, {
      cause: error,
    });
  }
}

function errorOutput(value: unknown, key: "stdout" | "stderr"): string {
  if (!isRecord(value)) return "";
  const output = value[key];
  if (typeof output === "string") return output;
  return Buffer.isBuffer(output) ? output.toString("utf8") : "";
}

function safeRelativePath(value: string, name: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.split("/").some((part) => part === "" || part === "." || part === ".."))
    throw new Error(`${name} must be a contained relative path`);
  return normalized;
}

function parseJson(value: string, name: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${name} package.json is not valid JSON`, { cause: error });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}
