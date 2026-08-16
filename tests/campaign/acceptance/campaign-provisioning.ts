import type { AcceptanceCampaignFile } from "./campaign-cli.js";
import type { CampaignRuntimeDeps } from "./campaign-runtime.js";
import type { CampaignRepositoryRevalidator } from "../repository-revalidation.js";
import { provisionCampaignScenariosGuarded } from "./campaign-provisioning-guarded.js";
import type { ScenarioProvision } from "./provision.js";

export async function provisionCampaignScenarios(
  file: AcceptanceCampaignFile,
  deps: CampaignRuntimeDeps,
  revalidate: CampaignRepositoryRevalidator,
): Promise<Map<string, ScenarioProvision>> {
  return provisionCampaignScenariosGuarded(file, deps, revalidate);
}
