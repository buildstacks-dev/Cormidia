import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CANONICAL_LABELS } from "../../../src/loop/plan-tickets.js";
import type { CliDriver } from "./cli-driver.js";
import { campaignGitEnvironment } from "./campaign-git.js";
import {
  PROVISION_IDENTITY,
  type OnboardResult,
  type ScenarioProvision,
  type ScenarioProvisionSpec,
} from "./provision.js";

const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, {
    cwd,
    env: campaignGitEnvironment(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

export function initializeGreenfieldRepository(worktree: string, appSlug: string): void {
  git(worktree, ["init", "--initial-branch", "campaign-baseline"]);
  git(worktree, ["remote", "add", "origin", `https://github.com/${appSlug}.git`]);
}

/** Resume only the harness's own clean, pre-baseline greenfield repository.
 * This exists for a provisioning interruption before any provider turn; it is
 * not a general permission to adopt pre-existing work. */
export function reusePreparedGreenfieldRepository(worktree: string, scenarioId: string, appSlug: string): boolean {
  if (!existsSync(worktree)) return false;
  if (!existsSync(join(worktree, ".git"))) {
    throw new Error(`campaign refused: existing greenfield target ${worktree} is not the prepared repository`);
  }
  const expected = `https://github.com/${appSlug}.git`.toLowerCase();
  if (git(worktree, ["remote", "get-url", "origin"]).toLowerCase() !== expected) {
    throw new Error(`campaign refused: existing greenfield target ${worktree} has the wrong origin`);
  }
  if (git(worktree, ["status", "--porcelain"]).length > 0) {
    throw new Error(`campaign refused: existing greenfield target ${worktree} is dirty`);
  }
  const commits = git(worktree, ["log", "--format=%ae%x00%s"]).split("\n").filter(Boolean);
  const expectedSubject = `provision: baseline ${scenarioId}`;
  if (commits.length === 0 || commits.some((line) => line !== `${PROVISION_IDENTITY.email}\u0000${expectedSubject}`)) {
    throw new Error(`campaign refused: existing greenfield target ${worktree} is not a clean campaign baseline`);
  }
  return true;
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

export function canonicalLabelCommands(appSlug: string): string[][] {
  return CANONICAL_LABELS.map((label) => [
    "label",
    "create",
    label.name,
    "--color",
    label.color,
    "--description",
    label.description,
    "--force",
    "--repo",
    appSlug,
  ]);
}

/** GitHub label creation is part of the bounded provisioning exception and is
 * required before packaged app verification can admit the scenario. */
export function installCanonicalLabels(
  appSlug: string,
  run: (command: string, args: string[]) => unknown = (command, args) =>
    execFileSync(command, args, { env: campaignGitEnvironment(), stdio: ["ignore", "pipe", "pipe"] }),
): void {
  for (const args of canonicalLabelCommands(appSlug)) run("gh", args);
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
