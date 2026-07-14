import { definePublicSurfaceDebt } from "./harness.js";

definePublicSurfaceDebt(
  ["H-CAP-01", "H-CAP-02", "H-CAP-03", "H-CLU-01", "H-CLU-02", "H-GOV-01", "H-EVAL-01", "H-EVAL-02", "H-EVAL-03", "H-RPT-01"].map((id) => ({
    id,
    expectedFailure: "efficiency_learning_signal_absent",
    help: ["learn"],
    missingToken: "--efficiency-health",
    nearMissToken: "learn report",
  })),
);
