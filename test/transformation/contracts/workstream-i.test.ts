import { defineProviderEvidenceDebt, definePublicSurfaceDebt } from "./harness.js";

definePublicSurfaceDebt(
  ["I-INSTALL-01", "I-INSTALL-02", "I-SOAK-01", "I-SOAK-02", "I-SOAK-03"].map((id) => ({
    id,
    expectedFailure: "scheduler_management_absent",
    help: [],
    missingToken: "operon scheduler",
    nearMissToken: "operon dispatch",
  })),
);

defineProviderEvidenceDebt([
  { id: "I-ROLE-01", expectedFailure: "scheduler_management_absent", caseId: "roles/standing/v1", campaign: "candidate-qualification.yaml" },
  { id: "I-ROLE-02", expectedFailure: "scheduler_management_absent", caseId: "roles/standing/v1", campaign: "candidate-qualification.yaml" },
  { id: "I-ROLE-03", expectedFailure: "scheduler_management_absent", caseId: "roles/standing/v1", campaign: "candidate-qualification.yaml" },
  { id: "I-LIVE-01", expectedFailure: "scheduler_management_absent", caseId: "soak/realtime-48h/v1", campaign: "realtime-soak.yaml" },
]);
