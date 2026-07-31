import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadYamlFile, validateResult } from "../../../scripts/eval/core.js";
import { verifyContractEvidence } from "../../../scripts/eval/contract-evidence.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface ResultDebtSpec {
  id: string;
  expectedFailure: string;
  caseId: string;
  campaign: string;
  repetitionIds: string[];
}

// The contract case per workstream. It asserts on the REAL product boundary
// (verifyContractEvidence, via classifyResultEvidence) — never on a harness
// classifier. D-003: the previous near-miss/honest-failure cases here asserted
// what the harness's own classifyResultValue returned, so they passed even when
// the classifier ignored the product entirely. Those genuine intents now live
// once in product-boundary.test.ts (real thrown codes) and classifier.test.ts
// (the classifier's own contract), instead of 20 classifier-only repetitions.
export function defineProviderEvidenceDebt(specs: ResultDebtSpec[]): void {
  for (const spec of specs) {
    describe(spec.id, () => {
      it("positive case executes the immutable promotion boundary and observes the declared state", () => {
        const campaign = loadYamlFile(join(root, "eval/campaigns", spec.campaign)) as { cases?: Array<{ case_id?: string }> };
        expect(campaign.cases?.some((item) => item.case_id === spec.caseId)).toBe(true);
        const committed = join(root, "research/evals/contracts", `${spec.id}.json`);
        const inventory = loadYamlFile(join(root, "eval/contracts.yaml")) as { contracts: Array<{ id: string; state: string }> };
        const state = inventory.contracts.find((item) => item.id === spec.id)?.state;
        // classifyResultEvidence runs the real product verifier and, per P1-06,
        // surfaces its exact thrown code. A `required` contract must verify clean
        // ("passed"); a not-yet-required contract must observe its declared
        // expectedFailure. When a required contract regresses, the real verifier
        // code (e.g. release_attestation_package_mismatch) appears verbatim in the
        // assertion diff — never a meaningless harness sentinel.
        expect(classifyResultEvidence(committed, spec, spec.expectedFailure)).toBe(state === "required" ? "passed" : spec.expectedFailure);
      });
    });
  }
}

export function classifyResultEvidence(path: string, spec: ResultDebtSpec, expectedFailure: string): string {
  if (!existsSync(path)) return expectedFailure;
  try {
    verifyContractEvidence(root, path, { contractId: spec.id, caseId: spec.caseId, repetitionIds: spec.repetitionIds });
    return "passed";
  }
  catch (error) {
    // Propagate the verifier's real cause. contract-evidence.ts throws ~30
    // distinct code-bearing messages (contract_evidence_*/release_attestation_*),
    // per the repo error protocol: a machine-readable code, optionally suffixed
    // ":<detail>". Collapsing all of them into one "invalid_contract_observation"
    // sentinel is exactly what hid ROOT-001's release_attestation_package_mismatch
    // behind a meaningless diagnostic for a week. Only a non-Error throw or an
    // empty message carries no code to surface, so it alone falls back to the
    // labeled sentinel (the swallow-with-rationale convention modeled at
    // src/org/scheduler/evidence.ts:621 — swallow only where nothing better exists).
    const message = error instanceof Error ? error.message.trim() : "";
    return message === "" ? "invalid_contract_observation" : message;
  }
}

/** The harness's own refusal classifier, exercised directly by classifier.test.ts.
 * It encodes one genuine invariant: a raw result value — even structurally
 * complete, individually valid, and case-matched — is NEVER sufficient promotion
 * evidence, because it carries none of the campaign/qualifier/report/archive/
 * grader/GitHub-idempotence/settlement/release bindings the product verifier
 * demands. This is a harness classifier, not a product boundary; the product
 * boundary that enforces the same refusal on real projections is
 * verifyContractEvidence (see product-boundary.test.ts). */
export function classifyResultValue(value: unknown, caseId: string, expectedFailure: string): string {
  const errors = validateResult(value);
  if (errors.length > 0) return "invalid_contract_observation";
  const result = value as { case_id: string; outcome: string; missing: string[] };
  if (result.case_id !== caseId) return "invalid_contract_observation";
  return result.outcome === "passed" && result.missing.length === 0 ? "invalid_contract_observation" : expectedFailure;
}

/** A structurally complete, individually valid AttemptResult authored locally
 * (validateResult accepts it). It is deliberately unbound to any qualified
 * campaign, so it stands for the "complete but locally-authored" near-miss the
 * product boundary must still refuse. */
export function fixtureResult(caseId: string): Record<string, unknown> {
  const excluded = (reason: string) => ({ excluded: [reason] });
  return {
    schema_version: 1,
    campaign_id: "contract-near-miss",
    campaign_sha256: `sha256:${"a".repeat(64)}`,
    attempt_id: "near-miss-1",
    case_id: caseId,
    repetition_id: "r1",
    outcome: "passed",
    admitted_at: "2026-07-12T00:00:00.000Z",
    terminal_at: "2026-07-12T00:01:00.000Z",
    evidence: ["fixture:near-miss"],
    metrics: { route: { planned: "standard", final: "standard", model_turns: 1 }, context: { rendered_bytes: 10, sources: { task: 10 } }, cost: { equivalent_usd: 0.01, product_usd: 0.01, evaluator_usd: 0, quality: "complete" }, tokens: { input: 10, output: 2, quality: "complete" }, latency: { elapsed_ms: 10, active_ms: 10, human_wait_ms: 0 }, human_load: { decisions: 0 }, productivity: { productive_passes: 1, total_passes: 1, ratio: 1, repeated_work_cost_usd: 0 }, continuation: caseId.startsWith("continuation/") ? { eligible: 1, resumed_without_repeat: 1, ratio: 1 } : excluded("not_continuation_case"), approvals: caseId.startsWith("approval/") ? { valid_requests: 1, total_requests: 1, precision: 1, recurrence: 0 } : excluded("not_approval_case"), scheduler: caseId.startsWith("soak/") ? { due_ticks: 1, reasoned_ticks: 1, reliability: 1 } : excluded("not_scheduler_case"), learning: caseId.startsWith("learning/") ? { eligible_capture: 1, captured: 1, capture_ratio: 1, effect_value: 1 } : excluded("not_learning_case"), execution: { terminal_integrity: 1, provider_turns: 1, mechanical_steps: 0, provider_settlements: 1, mechanical_settlements: 0 } },
    exclusions: [],
    missing: [],
  };
}
