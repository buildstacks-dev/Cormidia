import { RELEASE_L3_REQUIRED_CASES } from "../../src/org/release-evidence.js";
import type { QualificationHostPolicy } from "../../src/org/qualification-host-policy.js";
import { ADAPTER_CONFORMANCE_CASES } from "../fixtures/adapters/conformance.js";
import type { LiveCampaignConfigV1 } from "./config.js";

type LiveCampaignPolicyInput = {
  campaign_kind: LiveCampaignConfigV1["campaign_kind"];
  adapters: ReadonlyArray<{ runtime: LiveCampaignConfigV1["adapters"][number]["runtime"] }>;
  github: { enabled: boolean };
  launchd: { enabled: boolean };
  unattended: { enabled: boolean };
};

export function liveCampaignRequiredCaseIds(
  config: LiveCampaignPolicyInput,
  hostPolicy: QualificationHostPolicy,
): string[] {
  assertHostCampaignFloors(hostPolicy);
  if (config.campaign_kind === "release") return [...hostPolicy.release_qualification.required_l3_case_ids];
  return [
    ...config.adapters.map((target) => ADAPTER_CONFORMANCE_CASES[target.runtime]),
    ...(config.github.enabled ? ["CF-B01-L3"] : []),
    ...(config.launchd.enabled ? ["CF-J16-A"] : []),
    ...(config.unattended.enabled ? ["CF-J18-A"] : []),
  ];
}

export function liveCampaignSpend(
  config: Pick<LiveCampaignPolicyInput, "campaign_kind">,
  hostPolicy: QualificationHostPolicy,
): { turns: number; usd: number } {
  assertHostCampaignFloors(hostPolicy);
  const budget = hostPolicy.release_qualification.campaign_spend[config.campaign_kind];
  return { turns: budget.max_provider_turns, usd: budget.max_equiv_usd };
}

function assertHostCampaignFloors(hostPolicy: QualificationHostPolicy): void {
  const release = hostPolicy.release_qualification;
  if (
    JSON.stringify(release.required_l3_case_ids) !== JSON.stringify(RELEASE_L3_REQUIRED_CASES) ||
    release.conditional_l3_case_ids.length !== 0
  ) {
    throw new Error("live validation refused: canonical host policy differs from the compiled RQ-1 case floor");
  }
  const preMerge = release.campaign_spend.pre_merge_adapter;
  const github = release.campaign_spend.github_smoke;
  const launchd = release.campaign_spend.launchd_proof;
  const releaseSpend = release.campaign_spend.release;
  if (
    preMerge.max_provider_turns !== 2 ||
    preMerge.max_equiv_usd !== 5 ||
    github.max_provider_turns !== 2 ||
    github.max_equiv_usd !== 5 ||
    launchd.max_provider_turns !== 2 ||
    launchd.max_equiv_usd !== 5 ||
    releaseSpend.max_provider_turns !== 24 ||
    releaseSpend.max_equiv_usd !== 100
  ) {
    throw new Error("live validation refused: canonical host policy differs from the compiled campaign-spend floor");
  }
}
