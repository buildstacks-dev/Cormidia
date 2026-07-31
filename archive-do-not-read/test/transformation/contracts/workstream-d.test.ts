import { defineProviderEvidenceDebt } from "./harness.js";

defineProviderEvidenceDebt([
  { id: "D-LIVE-01", expectedFailure: "provider_baseline_not_run", caseId: "quick/ignore-config/v1", campaign: "candidate-qualification.yaml", repetitionIds: ["clean-q1", "clean-q2", "clean-q3", "clean-q4", "clean-q5", "mixed-q1", "mixed-q2"] },
  { id: "D-LIVE-02", expectedFailure: "provider_baseline_not_run", caseId: "standard/slug-options/v1", campaign: "candidate-qualification.yaml", repetitionIds: ["mixed-s3", "mixed-s2", "mixed-s1"] },
  { id: "D-LIVE-03", expectedFailure: "provider_baseline_not_run", caseId: "deep/auth-migration/v1", campaign: "candidate-qualification.yaml", repetitionIds: ["mixed-d2", "mixed-d1"] },
]);
