// Traceability: CF-REVIEW-PROVIDER · HB-133 · case-catalog.md §10.2; docs/loop/design.md "Review identity"; ratification-package.md §12.3 item 1 (provider-FAMILY unit pending real-human ratification).
// CF-REVIEW-PROVIDER (L1) — the disjointness guard's swappable family unit.
//
// HB-133's provider-FAMILY reading is a [simulated], provisional AI-seat interpretation
// pending human ratification, so family resolution remains an explicit, swappable input:
// the guard takes `resolveProviderFamily` by name, production passes
// `configuredProviderFamily` (the same unit the L-ACC campaign preflight
// reuses), and swapping the resolver swaps the disjointness unit without
// touching the guard's refusal semantics. If the human later overturns the
// unit (vendor product, account, …), the swap point is proven here.
//
// Fail-closed legs (catalog §10.2 leg c): a missing assignment, a throwing
// resolver, and a resolver returning a non-family value
// each produce the typed unresolvable refusal — never a silent pass.
import { describe, expect, it } from "vitest";
import {
  assertReviewProviderFamiliesDisjoint,
  ReviewProviderCollapseError,
  type ProviderFamilyResolver,
} from "../../../src/loop/review-provider.js";
import { configuredProviderFamily, validateTurnAssignment } from "../../../src/runtime/assignment.js";
import type { TurnAssignment } from "../../../src/runtime/types.js";
import { registerReviewProviderProvenanceTests } from "./review-provider-provenance.js";

function assignment(harness: TurnAssignment["harness"], model: string): TurnAssignment {
  return validateTurnAssignment({ harness, model, effort: "high" });
}

function refusalOf(operation: () => unknown): ReviewProviderCollapseError {
  try {
    operation();
  } catch (error) {
    if (error instanceof ReviewProviderCollapseError) return error;
    throw error;
  }
  throw new Error("expected a ReviewProviderCollapseError refusal, but the guard passed");
}

describe("CF-REVIEW-PROVIDER — swappable family-resolver unit (L1, HB-133)", () => {
  it("refuses a same-family pair under the production resolver, naming the collapsed family", () => {
    const refusal = refusalOf(() =>
      assertReviewProviderFamiliesDisjoint({
        builder: { role: "builder", assignment: assignment("claude", "claude-opus-4-8") },
        reviewer: { role: "reviewer", assignment: assignment("claude", "claude-sonnet-5") },
        resolveProviderFamily: configuredProviderFamily,
      }),
    );
    expect(refusal.code).toBe("error_review_provider_family_collapse");
    expect(refusal.message).toContain("anthropic");
    expect(refusal.message).toContain("simulated, provisional interpretation pending human ratification");
    expect(refusal.message).not.toContain("owner ruling");
  });

  it("refuses the pi/Anthropic-style correlation: distinct adapters, one upstream family", () => {
    const refusal = refusalOf(() =>
      assertReviewProviderFamiliesDisjoint({
        builder: { role: "builder", assignment: assignment("claude", "claude-opus-4-8") },
        reviewer: { role: "reviewer", assignment: assignment("pi", "anthropic/claude-opus-4-8") },
        resolveProviderFamily: configuredProviderFamily,
      }),
    );
    expect(refusal.code).toBe("error_review_provider_family_collapse");
  });

  it("fails closed when a participant has no resolvable assignment", () => {
    const refusal = refusalOf(() =>
      assertReviewProviderFamiliesDisjoint({
        builder: { role: "builder", assignment: assignment("codex", "gpt-5.6-sol") },
        reviewer: { role: "reviewer", assignment: undefined },
        resolveProviderFamily: configuredProviderFamily,
      }),
    );
    expect(refusal.code).toBe("error_review_provider_family_unresolvable");
  });

  it("fails closed when the resolver itself cannot resolve a family", () => {
    const throwing: ProviderFamilyResolver = () => {
      throw new Error("no ownership record for this assignment");
    };
    const refusal = refusalOf(() =>
      assertReviewProviderFamiliesDisjoint({
        builder: { role: "builder", assignment: assignment("codex", "gpt-5.6-sol") },
        reviewer: { role: "reviewer", assignment: assignment("claude", "claude-opus-4-8") },
        resolveProviderFamily: throwing,
      }),
    );
    expect(refusal.code).toBe("error_review_provider_family_unresolvable");
    expect(refusal.message).toContain("no ownership record");
  });

  it("fails closed when the resolver returns a value that is not a provider family", () => {
    const malformed: ProviderFamilyResolver = () => "";
    const refusal = refusalOf(() =>
      assertReviewProviderFamiliesDisjoint({
        builder: { role: "builder", assignment: assignment("codex", "gpt-5.6-sol") },
        reviewer: { role: "reviewer", assignment: assignment("claude", "claude-opus-4-8") },
        resolveProviderFamily: malformed,
      }),
    );
    expect(refusal.code).toBe("error_review_provider_family_unresolvable");
  });

  it("returns both resolved families on a disjoint pair — the non-vacuous positive", () => {
    const families = assertReviewProviderFamiliesDisjoint({
      builder: { role: "builder", assignment: assignment("codex", "gpt-5.6-sol") },
      reviewer: { role: "reviewer", assignment: assignment("claude", "claude-opus-4-8") },
      resolveProviderFamily: configuredProviderFamily,
    });
    expect(families).toEqual({ builderFamily: "openai", reviewerFamily: "anthropic" });
  });

  it("the unit is genuinely swappable: the same collapsed pair passes under a swapped disjointness unit", () => {
    // A hypothetical post-ratification unit keyed on something finer than the
    // upstream family (for example vendor account). The SAME pair the
    // production resolver refuses above passes here — proving the unit is the
    // resolver parameter, not an assumption baked into the guard.
    const byModelId: ProviderFamilyResolver = (candidate) => candidate.model.toLowerCase();
    const families = assertReviewProviderFamiliesDisjoint({
      builder: { role: "builder", assignment: assignment("claude", "claude-opus-4-8") },
      reviewer: { role: "reviewer", assignment: assignment("claude", "claude-sonnet-5") },
      resolveProviderFamily: byModelId,
    });
    expect(families).toEqual({ builderFamily: "claude-opus-4-8", reviewerFamily: "claude-sonnet-5" });
  });
});
registerReviewProviderProvenanceTests();
