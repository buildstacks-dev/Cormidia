import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ValidationCampaignReportV2 } from "../../src/org/validation-campaign-report.js";
import { parseValidationCampaignPolicyBinding } from "../../src/org/validation-campaign-policy.js";

/** Recheck every admitted byte immediately before the first durable write. */
export async function assertCampaignPolicyBindingBytes(
  binding: ValidationCampaignReportV2["policy"],
  root: string,
): Promise<void> {
  const parsed = parseValidationCampaignPolicyBinding(binding);
  const sources = [{ path: parsed.path, sha256: parsed.sha256 }, ...parsed.validation_authority.sources];
  for (const source of sources) {
    const actual = createHash("sha256")
      .update(await readFile(join(resolve(root), source.path)))
      .digest("hex");
    if (actual !== source.sha256)
      throw new Error(`campaign policy binding changed after authorization: ${source.path}`);
  }
}
