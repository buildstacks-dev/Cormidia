// Bounded provisioning with admission rechecked immediately before each
// mutation or external call.

import type { TurnAssignment } from "../../../src/runtime/types.js";
import type { CampaignRepositoryRevalidator } from "../repository-revalidation.js";
import type { AcceptanceCampaignFile } from "./campaign-cli.js";
import { scenarioAppName } from "./campaign-config.js";
import { prepareCampaignOrgRoles } from "./campaign-org-roles.js";
import type { CampaignRuntimeDeps } from "./campaign-runtime.js";
import {
  bootstrapScenarioApp,
  finalizeScenarioProvision,
  initializeGreenfieldRepository,
  installCanonicalLabels,
  registeredCampaignApp,
  reusePreparedGreenfieldRepository,
  verifyScenarioApp,
} from "./campaign-scenario-setup.js";
import { provisionScenarioRepository, type ScenarioProvision } from "./provision.js";
import { scenarioRamble } from "./sealed-key.js";

export async function provisionCampaignScenariosGuarded(
  file: AcceptanceCampaignFile,
  deps: CampaignRuntimeDeps,
  revalidate: CampaignRepositoryRevalidator,
): Promise<Map<string, ScenarioProvision>> {
  await revalidate();
  await prepareCampaignOrgRoles(deps.orgHome, file.campaign);
  const provisions = new Map<string, ScenarioProvision>();
  for (const scenario of file.campaign.scenarios) {
    const appName = scenarioAppName(scenario);
    const ramble = scenarioRamble(deps.scenarioMarkdown[scenario.id] ?? "");
    if (deps.rambles[scenario.id] !== undefined && deps.rambles[scenario.id] !== ramble) {
      throw new Error(`campaign refused: configured ramble for ${scenario.id} is not the verbatim scenario ramble`);
    }
    const setup = scenario.setup ?? (scenario.kind === "job" ? "job" : "bootstrap");
    const seedManifestPath = deps.seedManifests?.[scenario.id];
    if (setup === "new-app") {
      const resumed = reusePreparedGreenfieldRepository(scenario.worktree, scenario.id, scenario.appSlug);
      if (!resumed) {
        await revalidate();
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
        await revalidate();
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
        : { jobMatrix: definedMatrix(scenario.matrix) }),
      ...(seedManifestPath === undefined ? {} : { seedManifestPath }),
    };
    await revalidate();
    let provision = await provisionScenarioRepository(spec);
    if (setup === "bootstrap" && !(await registeredCampaignApp(deps.orgHome, appName, scenario.appSlug))) {
      await revalidate();
      await bootstrapScenarioApp(deps.driver, spec);
    }
    provision = await finalizeScenarioProvision(provision, scenario.worktree, revalidate);
    if (scenario.kind === "app") {
      await installCanonicalLabels(scenario.appSlug, undefined, revalidate);
      await revalidate();
      const verify = await verifyScenarioApp(deps.driver, scenario.id, appName);
      if (verify.verifyExitCode !== 0) throw new Error(`campaign refused: app verify failed for ${appName}`);
    }
    provisions.set(scenario.id, provision);
  }
  return provisions;
}

function definedMatrix(matrix: Record<string, TurnAssignment | undefined>): Record<string, TurnAssignment> {
  const defined: Record<string, TurnAssignment> = {};
  for (const [id, assignment] of Object.entries(matrix)) {
    if (assignment === undefined) throw new Error(`campaign refused: assignment ${id} is missing`);
    defined[id] = assignment;
  }
  return defined;
}
