import type { ValidationCampaignPolicyBinding } from "./validation-campaign-policy.js";
import type { ValidationCampaignProfile } from "./validation-campaign-profile.js";

export type ValidationLane = "L3" | "L4" | "L5";
type ValidationCampaignStatus = "planned" | "running" | "completed";
type ValidationCompleteness = "complete" | "incomplete";
type ValidationVerdict = "pass" | "fail" | "inconclusive";
export type ValidationDecisionStatus = "ratified" | "proposed" | "not_applicable";

interface ValidationCampaignReportBody {
  campaign_id: string;
  lane: ValidationLane;
  campaign_kind: string;
  trigger: string;
  status: ValidationCampaignStatus;
  started_at: string;
  finished_at: string | null;
  target: { commit: string; apps: string[]; scopes: string[]; tuples: string[] };
  spend: {
    max_provider_turns: number;
    max_equiv_usd: number;
    observed_provider_turns: number;
    observed_equiv_usd: number;
    ceiling_exhausted: boolean;
  };
  coverage: { required_case_ids: string[]; collected_case_ids: string[]; missing_case_ids: string[] };
  outcome: {
    completeness: ValidationCompleteness;
    verdict: ValidationVerdict;
    decision_status: ValidationDecisionStatus;
    violation_ids: string[];
    reason_codes: string[];
  };
  evidence_refs: string[];
  profile?: ValidationCampaignProfile;
}

interface HistoricalValidationCampaignReportV1 extends ValidationCampaignReportBody {
  schema_version: 1;
  policy: { path: string; sha256: string };
}

export interface ValidationCampaignReportV2 extends ValidationCampaignReportBody {
  schema_version: 2;
  policy: ValidationCampaignPolicyBinding;
}

export type ValidationCampaignReport = HistoricalValidationCampaignReportV1 | ValidationCampaignReportV2;

export interface ValidationCampaignReadResult {
  reports: ValidationCampaignReport[];
  corrupt: Array<{ campaign_id: string; path: string; detail: string }>;
}
