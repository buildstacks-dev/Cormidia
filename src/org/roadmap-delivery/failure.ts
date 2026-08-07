type RoadmapDeliveryFailureCode =
  | "backlog_incomplete"
  | "roadmap_missing"
  | "roadmap_invalid"
  | "issue_unaccounted"
  | "issue_multiply_assigned"
  | "unit_cycle"
  | "frontier_stale"
  | "routing_ineligible"
  | "validation_contract_missing"
  | "validation_contract_invalid"
  | "validation_contract_stale"
  | "validation_catalog_missing"
  | "validation_catalog_stale"
  | "validation_id_unknown"
  | "validation_structure_mismatch"
  | "validation_waiver_invalid"
  | "negative_control_missing"
  | "validation_incomplete"
  | "batch_unit_duplicate"
  | "batch_hard_constraint_failed"
  | "batch_manifest_too_large"
  | "batch_membership_active"
  | "direct_unit_incomplete"
  | "unit_budget_exhausted"
  | "unit_journal_conflict"
  | "already_claimed"
  | "builder_evidence_missing"
  | "evidence_head_mismatch"
  | "evidence_unit_mismatch"
  | "reviewer_evidence_incomplete"
  | "reviewer_independence_invalid"
  | "projection_contradiction"
  | "authority_conflict"
  | "authority_corrupt";

export class RoadmapDeliveryError extends Error {
  constructor(
    readonly code: RoadmapDeliveryFailureCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "RoadmapDeliveryError";
  }
}
