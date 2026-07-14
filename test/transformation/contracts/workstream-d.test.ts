import { defineProviderEvidenceDebt } from "./harness.js";

defineProviderEvidenceDebt([
  { id: "D-LIVE-01", expectedFailure: "provider_baseline_not_run", caseId: "quick/ignore-config/v1", campaign: "candidate-qualification.yaml" },
  { id: "D-LIVE-02", expectedFailure: "provider_baseline_not_run", caseId: "standard/slug-options/v1", campaign: "candidate-qualification.yaml" },
  { id: "D-LIVE-03", expectedFailure: "provider_baseline_not_run", caseId: "deep/auth-migration/v1", campaign: "candidate-qualification.yaml" },
]);
