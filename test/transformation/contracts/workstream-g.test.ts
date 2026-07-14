import { defineProviderEvidenceDebt } from "./harness.js";

defineProviderEvidenceDebt(
  ["G-ACT-01", "G-ACT-02", "G-ACT-03", "G-SHAPE-01", "G-GRANT-01", "G-DEDUPE-01", "G-DENY-01", "G-MET-01"].map((id) => ({
    id,
    expectedFailure: "semantic_action_eval_absent",
    caseId: "approval/semantics/v1",
    campaign: "candidate-qualification.yaml",
  })),
);
