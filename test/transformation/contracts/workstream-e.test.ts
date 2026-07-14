import { defineProviderEvidenceDebt, definePublicSurfaceDebt } from "./harness.js";

definePublicSurfaceDebt(
  ["E-CTX-01", "E-CTX-02", "E-CTX-03", "E-CTX-04", "E-CTX-05", "E-CTX-06", "E-CTX-07", "E-CTX-08"].map((id) => ({
    id,
    expectedFailure: "context_manifest_absent",
    help: ["loop"],
    missingToken: "--explain-context",
    nearMissToken: "--dry-run",
  })),
);

defineProviderEvidenceDebt([
  { id: "E-LIVE-01", expectedFailure: "provider_baseline_not_run", caseId: "context/delta/v1", campaign: "candidate-qualification.yaml" },
  { id: "E-LIVE-02", expectedFailure: "provider_baseline_not_run", caseId: "context/delta/v1", campaign: "candidate-qualification.yaml" },
]);
