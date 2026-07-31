import { defineProviderEvidenceDebt } from "./harness.js";

defineProviderEvidenceDebt([
  { id: "I-ROLE-01", expectedFailure: "provider_standing_role_evidence_not_run", caseId: "roles/standing/v1", campaign: "candidate-qualification.yaml", repetitionIds: ["sre-1"] },
  { id: "I-ROLE-02", expectedFailure: "provider_standing_role_evidence_not_run", caseId: "roles/standing/v1", campaign: "candidate-qualification.yaml", repetitionIds: ["support-1"] },
  { id: "I-ROLE-03", expectedFailure: "provider_standing_role_evidence_not_run", caseId: "roles/standing/v1", campaign: "candidate-qualification.yaml", repetitionIds: ["marketing-1"] },
  { id: "I-LIVE-01", expectedFailure: "realtime_soak_not_run", caseId: "soak/realtime-48h/v1", campaign: "realtime-soak.yaml", repetitionIds: ["real-1"] },
]);
