import { defineProviderEvidenceDebt } from "./harness.js";

defineProviderEvidenceDebt(
  ["G-MET-01"].map((id) => ({
    id,
    expectedFailure: "provider_qualification_not_run",
    caseId: "approval/semantics/v1",
    campaign: "candidate-qualification.yaml",
    repetitionIds: ["mixed-da"],
  })),
);
