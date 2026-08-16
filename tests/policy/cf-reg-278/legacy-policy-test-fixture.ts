import { stringify } from "yaml";
import { RATIFIED_PINS } from "./policy-loader.js";

/** Minimal legacy bridge document for loader-only negative controls. */
export function legacyValidationPolicyFixture(): string {
  return stringify({
    schema_version: 1,
    scope: "fixture-only legacy loader control",
    design_status: "ratified",
    artifacts: { invariants: "invariants.md", contracts: "contracts/" },
    implementation_root: "tests",
    protected_paths: [],
    layers: {
      L1_invariant_contract: { status: "active" },
      L2_hermetic: { status: "active" },
      L3_live_sandbox: {
        status: "active",
        obligations: [],
        spend_policy: {
          pre_merge_adapter_campaign: { scope: "fixture", max_provider_turns: 2, max_equiv_usd: 5 },
          release_campaign: { scope: "fixture", max_provider_turns: 24, max_equiv_usd: 100 },
          on_ceiling_exhaustion: "never pass",
        },
      },
      L4_eval: { status: "active" },
      L5_ops: { status: "active", obligations: [] },
    },
    verdict_semantics: { completeness: [], verdict: [], rules: [] },
    ci: {
      host: "fixture",
      per_commit: [],
      per_commit_gate_class: "fixture",
      per_commit_enforcement_status: "fixture",
      rule: "fixture",
    },
    proposed_register: { items: RATIFIED_PINS.hb007_decisions.map((item) => ({ ...item })) },
    open_findings: Object.entries(RATIFIED_PINS.pinned_finding_status).map(([id, status]) => ({
      id,
      status,
      subject: "fixture",
    })),
    case_sourcing: [],
    harness_self_tests: [],
  });
}
