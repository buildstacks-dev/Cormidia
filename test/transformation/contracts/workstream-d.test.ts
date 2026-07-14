import { defineProviderEvidenceDebt, definePublicSurfaceDebt } from "./harness.js";

definePublicSurfaceDebt(
  ["D-ROUTE-01", "D-ROUTE-02", "D-ROUTE-03", "D-ROUTE-04", "D-ROUTE-05", "D-ROUTE-06", "D-ROUTE-07"].map((id) => ({
    id,
    expectedFailure: "route_policy_absent",
    help: ["plan"],
    missingToken: "--explain-route",
    nearMissToken: "--depth",
  })),
);

defineProviderEvidenceDebt([
  { id: "D-PLAN-01", expectedFailure: "provider_baseline_not_run", caseId: "planning/quality/v1", campaign: "candidate-qualification.yaml" },
  { id: "D-LIVE-01", expectedFailure: "provider_baseline_not_run", caseId: "quick/ignore-config/v1", campaign: "candidate-qualification.yaml" },
  { id: "D-LIVE-02", expectedFailure: "provider_baseline_not_run", caseId: "standard/slug-options/v1", campaign: "candidate-qualification.yaml" },
  { id: "D-LIVE-03", expectedFailure: "provider_baseline_not_run", caseId: "deep/auth-migration/v1", campaign: "candidate-qualification.yaml" },
]);
