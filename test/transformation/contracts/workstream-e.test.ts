import { defineProviderEvidenceDebt } from "./harness.js";

defineProviderEvidenceDebt([
  { id: "E-LIVE-01", expectedFailure: "provider_baseline_not_run", caseId: "context/delta/v1", campaign: "candidate-qualification.yaml" },
  { id: "E-LIVE-02", expectedFailure: "provider_baseline_not_run", caseId: "context/delta/v1", campaign: "candidate-qualification.yaml" },
]);
