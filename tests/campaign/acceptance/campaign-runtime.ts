import type { CampaignSpendGuard } from "./campaign-spend.js";
import type { CliDriver } from "./cli-driver.js";

/** Live dependencies the static campaign file deliberately cannot invent. */
export interface CampaignRuntimeDeps {
  driver: CliDriver;
  campaignRoot: string;
  stateHome: string;
  orgHome: string;
  repoRoot: string;
  cormidia: { slug: string; root: string };
  commitPinAt: Date;
  scenarioMarkdown: Record<string, string>;
  rambles: Record<string, string>;
  seedManifests?: Record<string, string>;
  maxBuildPasses: number;
  rubricExcerpts: Record<string, string>;
  spendGuard: CampaignSpendGuard;
}
