// Bounded scenario provisioning (CORMIDIA-INV-ACC-7a).
// The recorded baseline separates supervisor-created seed state from every
// product-affecting action the packaged org must perform itself.

import type { TurnAssignment } from "../../../src/runtime/types.js";
import type { CliDriver } from "./cli-driver.js";
import { provisionScenarioRepositoryImpl } from "./provision-repository.js";

export const PROVISION_IDENTITY = { name: "cormidia-campaign-provision", email: "provision@cormidia.invalid" };

export interface ScenarioProvisionSpec {
  scenarioId: string;
  kind: "app" | "job";
  appSlug: string;
  worktree: string;
  seedManifestPath?: string;
  /** Sanitized scenario brief. It must contain no `## Plants` section. */
  brief?: string;
  answers?: Record<string, unknown>;
  jobMatrix?: Record<string, TurnAssignment>;
  appName?: string;
}

export interface ScenarioProvision {
  scenarioId: string;
  appSlug: string;
  /** Everything at or before this sha is bounded provisioning. */
  baselineCommit: string;
  seededPaths: string[];
  provisionedShas: string[];
  /** Answer-key material from the manifest. Never written to the worktree. */
  sealedMaterial: Record<string, unknown>;
}

/** Seed one scenario repository and record its initial baseline. */
export async function provisionScenarioRepository(spec: ScenarioProvisionSpec): Promise<ScenarioProvision> {
  return provisionScenarioRepositoryImpl(spec, PROVISION_IDENTITY);
}

export interface OnboardResult {
  scenarioId: string;
  appName: string;
  verifyExitCode: number;
}

/** Register and verify through the packaged binary. */
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
