// Bounded scenario provisioning. Everything here is at or before the recorded
// baseline; after this returns, the supervisor never edits a scenario repo.

import type { TurnAssignment } from "../../../src/runtime/types.js";
import type { AcceptanceCampaignFile } from "./campaign-cli.js";
import type { CampaignRuntimeDeps } from "./campaign-runtime.js";
import { prepareCampaignOrgRoles } from "./campaign-org-roles.js";
import {
  bootstrapScenarioApp,
  finalizeScenarioProvision,
  initializeGreenfieldRepository,
  reusePreparedGreenfieldRepository,
  verifyScenarioApp,
} from "./campaign-scenario-setup.js";
import { provisionScenarioRepository, type ScenarioProvision } from "./provision.js";
import { scenarioRamble } from "./sealed-key.js";

export async function provisionCampaignScenarios(
  file: AcceptanceCampaignFile,
  deps: CampaignRuntimeDeps,
): Promise<Map<string, ScenarioProvision>> {
  await prepareCampaignOrgRoles(deps.orgHome, file.campaign);
  const provisions = new Map<string, ScenarioProvision>();
  for (const scenario of file.campaign.scenarios) {
    const appName = scenario.appSlug.split("/").at(-1) ?? scenario.id;
    const ramble = scenarioRamble(deps.scenarioMarkdown[scenario.id] ?? "");
    if (deps.rambles[scenario.id] !== undefined && deps.rambles[scenario.id] !== ramble) {
      throw new Error(`campaign refused: configured ramble for ${scenario.id} is not the verbatim scenario ramble`);
    }
    const setup = scenario.setup ?? (scenario.kind === "job" ? "job" : "bootstrap");
    if (setup === "new-app") {
      const resumed = reusePreparedGreenfieldRepository(scenario.worktree, scenario.id, scenario.appSlug);
      if (!resumed) {
        await deps.driver.runOrThrow(
          "cormidia",
          [
            "new-app",
            appName,
            "--name",
            appName,
            "--target-dir",
            scenario.worktree,
            "--repo",
            scenario.appSlug,
            "--goal",
            ramble,
            "--template",
            "typescript-node",
            "--org-home",
            deps.orgHome,
            "--json",
          ],
          { scenarioId: scenario.id },
        );
        initializeGreenfieldRepository(scenario.worktree, scenario.appSlug);
      }
    }
    const spec = {
      scenarioId: scenario.id,
      kind: scenario.kind,
      appSlug: scenario.appSlug,
      worktree: scenario.worktree,
      appName,
      brief: ramble,
      ...(scenario.kind === "app"
        ? {
            answers: {
              product: `${appName} is the disposable ${scenario.id} acceptance scenario.`,
              good: "The ratified acceptance brief is delivered without weakening gates or deploying.",
              roles: ["planner", "builder", "reviewer", "sre", "acceptance-grader"],
              budgetUsdMonth: file.campaign.envelope?.maxEquivUsd ?? 520,
              authority: { mode: "inherit" },
            },
          }
        : { jobMatrix: scenario.matrix as Record<string, TurnAssignment> }),
      ...(deps.seedManifests?.[scenario.id] === undefined
        ? {}
        : { seedManifestPath: deps.seedManifests[scenario.id] as string }),
    };
    let provision = await provisionScenarioRepository(spec);
    if (setup === "bootstrap") await bootstrapScenarioApp(deps.driver, spec);
    provision = await finalizeScenarioProvision(provision, scenario.worktree);
    if (scenario.kind === "app") {
      const verify = await verifyScenarioApp(deps.driver, scenario.id, appName);
      if (verify.verifyExitCode !== 0) throw new Error(`campaign refused: app verify failed for ${appName}`);
    }
    provisions.set(scenario.id, provision);
  }
  return provisions;
}
