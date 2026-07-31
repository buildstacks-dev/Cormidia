import { expect, it } from "vitest";
import { causalHypothesisScore } from "../../scripts/eval/live-executor.js";

it("H-EVAL-01 recognizes ordinary causal morphology without changing the falsifiability threshold", () => {
  const falsifiable = "if the bounded policy is applied, median review cycles decrease";
  for (const causal of [
    "the missing policy may cause repeated work",
    "the missing policy causes repeated work",
    "the missing policy caused repeated work",
    "the missing policy is causing repeated work",
    "there is a causal mechanism behind repeated work",
    "causation runs from the missing policy to repeated work",
  ]) expect(causalHypothesisScore(`${causal}; ${falsifiable}`)).toBe(2);

  expect(causalHypothesisScore("the signals are correlated; if the policy is applied, review cycles decrease")).toBe(1);
  expect(causalHypothesisScore("the missing policy is causing repeated work")).toBe(1);
  expect(causalHypothesisScore("")).toBe(0);
});

it("H-EVAL-01 retains the exact previously mis-scored provider hypothesis as a regression", () => {
  expect(causalHypothesisScore(
    "Typed transient dependency failures and unconsolidated review feedback are causing avoidable repeated handling: if a bounded policy applies one retry only to the observed typed transient failure and consolidates non-safety review feedback after the first cycle, then comparable episodes will recover more often without manual handling and complete review in fewer cycles; this is falsified if retry recovery and median review-cycle count do not improve against the pre-pilot baseline.",
  )).toBe(2);
});
