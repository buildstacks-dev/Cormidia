import { describe, expect, it } from "vitest";
import { classifyResultValue, fixtureResult } from "./harness.js";

// D-003 fix: the "raw result is never sufficient promotion evidence" refusal is
// a genuine invariant, but it belongs to the harness classifier, not the product.
// It used to be re-asserted 10x per near-miss and 10x per honest-failure case,
// once per workstream, so the tests pinned the harness helper's return value
// rather than the product (a gutted classifier that hardcoded the sentinel kept
// all 20 green). Those 20 collapse to these two clearly-labeled classifier unit
// tests. The product-side enforcement of the same refusal — on real projections,
// by real thrown code — lives in product-boundary.test.ts.
const CASE = "quick/ignore-config/v1";
const EXPECTED_FAILURE = "provider_baseline_not_run";

describe("classifyResultValue — harness classifier contract (not the product)", () => {
  it("classifies a complete, valid, case-matched result value as insufficient promotion evidence", () => {
    // The value passes the product's per-result validator (asserted in
    // product-boundary.test.ts) yet carries none of the campaign/qualifier/
    // archive/grader/GitHub/settlement/release bindings, so the classifier
    // refuses it: a raw result value is never, on its own, promotion evidence.
    expect(classifyResultValue(fixtureResult(CASE), CASE, EXPECTED_FAILURE)).toBe("invalid_contract_observation");
  });

  it("classifies a malformed or foreign result value as insufficient promotion evidence", () => {
    expect(classifyResultValue({ case_id: "foreign" }, CASE, EXPECTED_FAILURE)).toBe("invalid_contract_observation");
  });
});
