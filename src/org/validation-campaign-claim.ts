import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import type { ValidationCampaignReportV2 } from "./validation-campaign-report.js";
import { validateValidationCampaignReport, validationCampaignReportPath } from "./validation-campaign.js";

/** Atomically claims a fresh campaign id with its initial durable report. */
export async function createValidationCampaignReport(
  stateHome: string,
  report: ValidationCampaignReportV2,
): Promise<string> {
  validateValidationCampaignReport(report);
  if (report.schema_version !== 2) throw new Error("new campaign reports require bound schema_version 2");
  const path = validationCampaignReportPath(stateHome, report.campaign_id);
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if (isExists(error)) throw new Error(`validation campaign ${report.campaign_id} already has durable state`);
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return path;
}

function isExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
