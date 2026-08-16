import type { ValidationCampaignPolicyBinding } from "../../src/org/validation-campaign-policy.js";

export function fixtureCampaignPolicyBinding(): ValidationCampaignPolicyBinding {
  return {
    path: "docs/qualification/host-policy.yaml",
    sha256: "a".repeat(64),
    validation_authority: {
      kind: "legacy",
      sources: [{ path: "validation-design/validation-policy.yaml", sha256: "b".repeat(64) }],
    },
  };
}
