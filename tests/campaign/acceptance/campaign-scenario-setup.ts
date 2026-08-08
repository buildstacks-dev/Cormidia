import { execFileSync } from "node:child_process";
import { devNull } from "node:os";
import type { CliDriver } from "./cli-driver.js";
import {
  PROVISION_IDENTITY,
  type OnboardResult,
  type ScenarioProvision,
  type ScenarioProvisionSpec,
} from "./provision.js";

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull };
const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

export function initializeGreenfieldRepository(worktree: string, appSlug: string): void {
  git(worktree, ["init", "--initial-branch", "campaign-baseline"]);
  git(worktree, ["remote", "add", "origin", `https://github.com/${appSlug}.git`]);
}

export async function finalizeScenarioProvision(
  provision: ScenarioProvision,
  worktree: string,
): Promise<ScenarioProvision> {
  git(worktree, ["config", "user.name", PROVISION_IDENTITY.name]);
  git(worktree, ["config", "user.email", PROVISION_IDENTITY.email]);
  git(worktree, ["add", "-A"]);
  if (git(worktree, ["status", "--porcelain"]).length > 0)
    git(worktree, ["commit", "--no-gpg-sign", "-m", `provision: onboard ${provision.scenarioId}`]);
  const branch = git(worktree, ["symbolic-ref", "--short", "HEAD"]);
  git(worktree, ["push", "--set-upstream", "origin", `HEAD:${branch}`]);
  const baselineCommit = git(worktree, ["rev-parse", "HEAD"]);
  return {
    ...provision,
    baselineCommit,
    provisionedShas: git(worktree, ["log", "--format=%H", baselineCommit]).split("\n").filter(Boolean),
  };
}

export async function bootstrapScenarioApp(driver: CliDriver, spec: ScenarioProvisionSpec): Promise<void> {
  await driver.runOrThrow(
    "cormidia",
    ["bootstrap", spec.worktree, "--answers", `${spec.worktree}/.cormidia-answers.json`, "--json"],
    { scenarioId: spec.scenarioId },
  );
}

export async function verifyScenarioApp(
  driver: CliDriver,
  scenarioId: string,
  appName: string,
): Promise<OnboardResult> {
  const verify = await driver.run("cormidia", ["app", "verify", appName, "--json"], { scenarioId });
  return { scenarioId, appName, verifyExitCode: verify.exitCode };
}
