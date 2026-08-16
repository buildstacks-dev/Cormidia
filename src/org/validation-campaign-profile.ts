export interface ValidationCampaignProfile {
  identity: "cormidia/unattended-sandbox/v1";
  sandbox_target: string;
  permitted_auto_grant_categories: ["campaign_budget"];
  human_decision_rows: 0;
}

export function parseValidationCampaignProfile(value: unknown, name = "profile"): ValidationCampaignProfile {
  const profile = object(value, name);
  exact(profile, ["identity", "sandbox_target", "permitted_auto_grant_categories", "human_decision_rows"], name);
  if (profile["identity"] !== "cormidia/unattended-sandbox/v1")
    throw new Error(`${name}.identity is not the ratified unattended profile`);
  const target = profile["sandbox_target"];
  if (typeof target !== "string" || target.trim() === "") throw new Error(`${name}.sandbox_target must be non-empty`);
  if (JSON.stringify(profile["permitted_auto_grant_categories"]) !== JSON.stringify(["campaign_budget"]))
    throw new Error(`${name} permits only campaign_budget`);
  if (profile["human_decision_rows"] !== 0) throw new Error(`${name} requires zero human decision rows`);
  return {
    identity: "cormidia/unattended-sandbox/v1",
    sandbox_target: target,
    permitted_auto_grant_categories: ["campaign_budget"],
    human_decision_rows: 0,
  };
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, fields: string[], name: string): void {
  const expected = new Set(fields);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = fields.filter((key) => !(key in value));
  if (unknown.length > 0 || missing.length > 0) throw new Error(`${name} fields differ from the closed profile schema`);
}
