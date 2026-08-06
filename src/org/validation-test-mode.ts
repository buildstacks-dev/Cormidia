// The ratified unattended validation profile is a narrow machine authorization,
// not an approval decision and never a way to impersonate a human approver.

export const UNATTENDED_VALIDATION_PROFILE_ID = "cormidia/unattended-sandbox/v1" as const;
export const VALIDATION_AUTO_GRANT_CATEGORIES = ["campaign_budget"] as const;
export type ValidationAutoGrantCategory = (typeof VALIDATION_AUTO_GRANT_CATEGORIES)[number];

export interface UnattendedValidationProfile {
  identity: typeof UNATTENDED_VALIDATION_PROFILE_ID;
  sandbox: { org: string; app: string; repo: string };
  permitted_auto_grant_categories: ValidationAutoGrantCategory[];
}

export type ValidationProfileAction =
  | { kind: "campaign_budget"; provider_turns: number; equiv_usd: number; release_campaign: boolean }
  | { kind: "external_publication"; target: string }
  | { kind: "non_sandbox_effect"; target: string }
  | { kind: "critical_operation"; operation: string };

export interface ValidationProfileAuthorization {
  authorized: boolean;
  profile_identity: typeof UNATTENDED_VALIDATION_PROFILE_ID;
  sandbox_target: string;
  category: ValidationProfileAction["kind"];
  reason_code:
    | "profile_auto_grant"
    | "category_not_permitted"
    | "external_publication_hard_gate"
    | "non_sandbox_effect_hard_gate"
    | "critical_operation_hard_gate"
    | "spend_ceiling_exceeded";
  human_decision_rows: 0;
}

export function createUnattendedValidationProfile(input: {
  org: string;
  app: string;
  repo: string;
  permittedAutoGrantCategories?: ValidationAutoGrantCategory[];
}): UnattendedValidationProfile {
  for (const [name, value] of Object.entries({ org: input.org, app: input.app, repo: input.repo })) {
    if (value.trim().length === 0) throw new Error(`validation profile ${name} must not be empty`);
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(input.repo))
    throw new Error("validation profile repo must be an exact owner/repo slug");
  const categories = input.permittedAutoGrantCategories ?? ["campaign_budget"];
  if (new Set(categories).size !== categories.length) throw new Error("validation profile categories must be unique");
  if (categories.some((category) => category !== "campaign_budget")) {
    throw new Error("validation profile permits only campaign_budget");
  }
  return {
    identity: UNATTENDED_VALIDATION_PROFILE_ID,
    sandbox: { org: input.org, app: input.app, repo: input.repo },
    permitted_auto_grant_categories: [...categories],
  };
}

export function authorizeUnattendedValidationAction(
  profile: UnattendedValidationProfile,
  target: { org: string; app: string; repo: string },
  action: ValidationProfileAction,
): ValidationProfileAuthorization {
  const base = {
    profile_identity: UNATTENDED_VALIDATION_PROFILE_ID,
    sandbox_target: `${target.org}/${target.app}@${target.repo}`,
    category: action.kind,
    human_decision_rows: 0 as const,
  };
  if (
    target.org !== profile.sandbox.org ||
    target.app !== profile.sandbox.app ||
    target.repo !== profile.sandbox.repo
  ) {
    return { ...base, authorized: false, reason_code: "non_sandbox_effect_hard_gate" };
  }
  if (action.kind === "external_publication")
    return { ...base, authorized: false, reason_code: "external_publication_hard_gate" };
  if (action.kind === "non_sandbox_effect")
    return { ...base, authorized: false, reason_code: "non_sandbox_effect_hard_gate" };
  if (action.kind === "critical_operation")
    return { ...base, authorized: false, reason_code: "critical_operation_hard_gate" };
  if (!profile.permitted_auto_grant_categories.includes(action.kind)) {
    return { ...base, authorized: false, reason_code: "category_not_permitted" };
  }
  if (
    !Number.isInteger(action.provider_turns) ||
    action.provider_turns < 0 ||
    !Number.isFinite(action.equiv_usd) ||
    action.equiv_usd < 0
  ) {
    throw new Error("validation profile campaign budget must use non-negative finite spend counters");
  }
  const ceiling = action.release_campaign ? { turns: 24, usd: 100 } : { turns: 2, usd: 5 };
  if (action.provider_turns > ceiling.turns || action.equiv_usd > ceiling.usd) {
    return { ...base, authorized: false, reason_code: "spend_ceiling_exceeded" };
  }
  return { ...base, authorized: true, reason_code: "profile_auto_grant" };
}
