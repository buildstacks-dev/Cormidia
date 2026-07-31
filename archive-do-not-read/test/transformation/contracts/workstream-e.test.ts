import { defineProviderEvidenceDebt } from "./harness.js";

defineProviderEvidenceDebt([
  { id: "E-LIVE-01", expectedFailure: "provider_baseline_not_run", caseId: "context/delta/v1", campaign: "candidate-qualification.yaml", repetitionIds: ["claude-context-1", "claude-context-2", "codex-context-1", "codex-context-2", "pi-context-1", "pi-context-2"] },
  { id: "E-LIVE-02", expectedFailure: "provider_baseline_not_run", caseId: "context/delta/v1", campaign: "candidate-qualification.yaml", repetitionIds: ["claude-context-1", "claude-context-2", "codex-context-1", "codex-context-2", "pi-context-1", "pi-context-2"] },
]);
