import { assertCampaignRepositoryBinding } from "../repository-binding.js";
import { validateCampaignConfig, type AcceptanceCampaignConfig } from "./campaign-config.js";
import { assertPackagedProvenance, type PackagedInstallProof } from "./packaged-provenance.js";
import { assertScenarioNotThisRepository, type CormidiaIdentity } from "./scenario-binding.js";

export interface AcceptanceCampaignPreflightInput {
  config: AcceptanceCampaignConfig;
  cormidia: CormidiaIdentity;
  commitPinAt: Date;
  installProof?: PackagedInstallProof;
  turnCommands?: readonly string[];
  bindingCwd?: string;
}

export interface AcceptanceCampaignPreflight {
  validated: ReturnType<typeof validateCampaignConfig>;
  provenance: ReturnType<typeof assertPackagedProvenance>;
}

/** Every world-dependent refusal, reusable before scenario mutation. */
export async function preflightAcceptanceCampaign(
  input: AcceptanceCampaignPreflightInput,
): Promise<AcceptanceCampaignPreflight> {
  const validated = validateCampaignConfig(input.config);
  const provenance = assertPackagedProvenance({
    ...(input.installProof === undefined ? {} : { proof: input.installProof }),
    commitPinAt: input.commitPinAt,
    ...(input.turnCommands === undefined ? {} : { turnCommands: input.turnCommands }),
  });
  await assertCampaignRepositoryBinding({
    commit: input.config.commit,
    policyPath: input.config.policyPath,
    ...(input.bindingCwd === undefined ? {} : { cwd: input.bindingCwd }),
  });
  for (const scenario of input.config.scenarios) {
    await assertScenarioNotThisRepository({
      scenarioId: scenario.id,
      appSlug: scenario.appSlug,
      campaignOrg: validated.campaignOrg,
      worktree: scenario.worktree,
      ...(scenario.jobWorkdir === undefined ? {} : { jobWorkdir: scenario.jobWorkdir }),
      cormidia: input.cormidia,
    });
  }
  return { validated, provenance };
}
