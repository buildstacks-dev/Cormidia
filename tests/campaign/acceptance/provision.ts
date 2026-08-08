// campaign/acceptance/provision.ts — the phase B-27 §4 puts between preflight
// and the plan arm.
//
// **Provisioning is deliberately supervisor work, and that is not a violation
// of CORMIDIA-INV-ACC-7a.** S-ACC-2 says its corpus is "built by the campaign's
// provision phase, committed before onboarding" — the seed is the state the
// scenario STARTS from, not work the org did. The invariant's subject is
// product-affecting action *by the org's identity during the run*.
//
// The mechanism that keeps that honest is the **baseline commit**: provisioning
// records the exact sha its own last commit produced, and the reconciliation
// then requires every commit AFTER the baseline to carry a Cormidia turn
// identity. Without a baseline the reconciler would flag the seed itself as
// supervisor participation and no scenario could ever close; with one, a
// supervisor commit sneaked in mid-run still fails, because it is not an
// ancestor of the baseline.
//
// Registration and onboarding DO go through the binary — the org registering an
// app is org work, and the invocation-audit row for it is evidence.

import { execFileSync } from "node:child_process";
import { devNull } from "node:os";
import type { CliDriver } from "./cli-driver.js";
import { materializeSeedCorpus, readSeedManifest, sealedSeedMaterial } from "./seed-corpus.js";

/** Identity the provision phase commits under. Recorded so a reader can tell a
 *  seed commit from a supervisor commit that should not exist. */
export const PROVISION_IDENTITY = { name: "cormidia-campaign-provision", email: "provision@cormidia.invalid" };

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: devNull,
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export interface ScenarioProvisionSpec {
  scenarioId: string;
  kind: "app" | "job";
  /** `owner/repo` of the disposable scenario repository. */
  appSlug: string;
  /** Local checkout the campaign seeds and the org later operates in. */
  worktree: string;
  /** Absolute path to the committed seed manifest, when this scenario has one. */
  seedManifestPath?: string;
  /** The app name the org registers this scenario under. */
  appName?: string;
}

export interface ScenarioProvision {
  scenarioId: string;
  appSlug: string;
  /** Everything at or before this sha is provisioning. Everything after it
   *  must trace to a Cormidia turn identity (CORMIDIA-INV-ACC-7a). */
  baselineCommit: string;
  seededPaths: string[];
  /** Answer-key material from the manifest. Never written to the worktree. */
  sealedMaterial: Record<string, unknown>;
}

/**
 * Seed one scenario repository and record the baseline. Pure git plus the
 * manifest; no provider is constructed and no token is spent.
 */
export async function provisionScenarioRepository(spec: ScenarioProvisionSpec): Promise<ScenarioProvision> {
  git(spec.worktree, ["config", "user.name", PROVISION_IDENTITY.name]);
  git(spec.worktree, ["config", "user.email", PROVISION_IDENTITY.email]);

  let seededPaths: string[] = [];
  let sealedMaterial: Record<string, unknown> = {};
  if (spec.seedManifestPath !== undefined) {
    const manifest = await readSeedManifest(spec.seedManifestPath);
    const materialized = await materializeSeedCorpus(manifest, spec.worktree);
    seededPaths = materialized.paths;
    sealedMaterial = sealedSeedMaterial(manifest);
    git(spec.worktree, ["add", "--", ...seededPaths]);
    git(spec.worktree, ["commit", "--no-gpg-sign", "-m", `provision: seed ${manifest.corpus} for ${spec.scenarioId}`]);
  }

  return {
    scenarioId: spec.scenarioId,
    appSlug: spec.appSlug,
    baselineCommit: git(spec.worktree, ["rev-parse", "HEAD"]),
    seededPaths,
    sealedMaterial,
  };
}

export interface OnboardResult {
  scenarioId: string;
  appName: string;
  /** Exit status of `cormidia app verify` — readiness proved by the product. */
  verifyExitCode: number;
}

/**
 * Register and verify the scenario's app THROUGH the binary. Registration is
 * org work, so it is the org that must do it — and the invocation-audit row it
 * writes is one of the three records the reconciliation joins.
 */
export async function onboardScenarioApp(
  driver: CliDriver,
  spec: ScenarioProvisionSpec & { appName: string },
): Promise<OnboardResult> {
  await driver.runOrThrow(
    "cormidia",
    ["bootstrap", spec.worktree, "--answers", `${spec.worktree}/.cormidia-answers.json`, "--json"],
    { scenarioId: spec.scenarioId },
  );
  const verify = await driver.run("cormidia", ["app", "verify", spec.appName, "--json"], {
    scenarioId: spec.scenarioId,
  });
  return { scenarioId: spec.scenarioId, appName: spec.appName, verifyExitCode: verify.exitCode };
}
