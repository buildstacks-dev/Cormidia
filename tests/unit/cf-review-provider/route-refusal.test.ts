// Traceability: CF-REVIEW-PROVIDER · HB-133 · case-catalog.md §10.2; docs/loop/design.md "Review identity"; invariants.md CORMIDIA-INV-012/CORMIDIA-INV-016; boundary-map.md B-10 (config authority); system-map.md §5.2 T-3/T-7.

// CF-REVIEW-PROVIDER (L1) — Builder/Reviewer provider-family disjointness pin,
// route-refusal legs.
//
// rev-2026-08-10 owner ruling: autonomous code delivery pairs Builder and
// Reviewer on different provider FAMILIES (docs/loop/design.md "Review
// identity" — "uncorrelated blind spots"), including distinct adapters over
// one upstream family. The refusal is deterministic and fires at
// episode-planning-policy construction (`createEpisodePlanningPolicy`), the
// seam every autonomous code-delivery planning boundary passes through
// (prepareEpisodePlanWithRuntime, previewEpisode, orchestrateEpisode) BEFORE
// any provider construction — the EpisodePlanner turn included. This spec
// constructs no Runtime factory anywhere: a refusal here is provably
// provider-free.
//
// PROVENANCE CAVEAT (harness-backlog.md HB-133; ratification-package.md §12.3
// item 1): the provider-FAMILY unit is a [simulated] AI-seat ruling pending
// real-human ratification. The disjointness unit is therefore an explicit,
// swappable resolver parameter of the guard (see
// tests/unit/cf-review-provider/family-resolver-unit.test.ts), never an
// inlined assumption.
//
// Legs (each has its own case; catalog §10.2):
//   (a) same resolved family → typed refusal before provider construction
//   (b) distinct adapters over one upstream family (the pi/Anthropic-style
//       correlation) → refusal
//   (c) missing/unresolvable family → fail closed
//   (d) different families → pass (the non-vacuous positive)
//   (e) scope guard — no Reviewer imposed on manual-only routes here; the
//       jobs (M18) leg is tests/hermetic/cf-review-provider/jobs-scope.test.ts
//
// Seeded violation (config-level, not roles.yaml default): the in-test roles
// fixtures below collapse Builder and Reviewer onto one provider family. The
// repository's ratified roles.yaml keeps its deliberate codex/claude split.

import { describe, expect, it } from "vitest";
import { runRole } from "../../../src/loop/runRole.js";
import type { AppEntry } from "../../../src/org/apps.js";
import { buildEpisodeIntent, createEpisodePlanningPolicy } from "../../../src/org/episode-planner/policy.js";
import type { EpisodeIntent } from "../../../src/loop/episode-plan.js";
import type { RoleConfig } from "../../../src/runtime/types.js";

const APP: AppEntry = {
  name: "review-provider-pin",
  repo: "cormidia-double/review-provider-pin",
  status: "live",
  budgetUsdMonth: 100,
  objectiveBudgetUsd: 100,
  cadence: {},
  execution: { assignmentMode: "fixed", allowedAssignments: {} },
};

function role(name: string, runtime: RoleConfig["runtime"], model: string): RoleConfig {
  return {
    name,
    runtime,
    model,
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: ["notes"],
    maxTurnBudgetUsd: 5,
  };
}

/** An intent whose route REQUIRES independent review — the precondition the
 *  F-PT-038 legs exercise. The base `intentFor` deliberately carries no safety
 *  facts, so this is opt-in rather than a change to every existing case. */
function reviewRequiringIntent(episodeId: string, roles: RoleConfig[]): ReturnType<typeof intentFor> {
  return {
    ...intentFor(episodeId, roles),
    requiredSafetyFacts: [{ kind: "independent_review" as const, evidenceRefs: ["f-pt-038"] }],
  };
}

function intentFor(episodeId: string, roles: RoleConfig[]): EpisodeIntent {
  return buildEpisodeIntent({
    episodeId,
    app: APP,
    roles,
    trigger: { kind: "manual" },
    goal: "Pin the Builder/Reviewer provider-family disjointness rule.",
    lifecycle: "live",
    appStage: "growth",
    repositoryFacts: { defaultBranch: "trunk" },
    requestedConstraints: {},
    hardBudget: {
      maxProviderTurns: 4,
      maxEquivalentCostUsd: 20,
      maxActiveTimeMs: 600_000,
      maxHumanDecisions: 0,
    },
    requiredSafetyFacts: [],
  });
}

const INDEPENDENT_REVIEW = { subjectRoles: ["builder"], reviewerRoles: ["reviewer"] } as const;

function policyConstruction(roles: RoleConfig[], episodeId: string): () => unknown {
  return () =>
    createEpisodePlanningPolicy(APP, {
      intent: intentFor(episodeId, roles),
      roles,
      independentReview: {
        subjectRoles: [...INDEPENDENT_REVIEW.subjectRoles],
        reviewerRoles: [...INDEPENDENT_REVIEW.reviewerRoles],
      },
    });
}

/** Typed-refusal probe without importing the product error class: the code
 * field is the contract (`refusal` oracle), asserted structurally. */
function thrownCode(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) return error.code;
    return error;
  }
  return undefined;
}

describe("CF-REVIEW-PROVIDER — route refusal before provider construction (L1, HB-133)", () => {
  it("leg (a): Builder and Reviewer resolving to one provider family is a typed refusal at policy construction", () => {
    // Same family (anthropic), deliberately DIFFERENT models: the unit is the
    // provider family, never the model id.
    const collapsed = [
      role("planner", "claude", "claude-opus-4-8"),
      role("builder", "claude", "claude-opus-4-8"),
      role("reviewer", "claude", "claude-sonnet-5"),
    ];
    expect(thrownCode(policyConstruction(collapsed, "hb133-leg-a"))).toBe("error_review_provider_family_collapse");
  });

  it("leg (b): distinct adapters over one upstream family refuse — the pi/Anthropic-style correlation", () => {
    // Builder on the native claude harness (family anthropic); Reviewer on the
    // pi harness executing an Anthropic-namespaced model. Two different
    // adapters, one upstream vendor: correlated blind spots, refused.
    const correlated = [
      role("planner", "codex", "gpt-5.6-sol"),
      role("builder", "claude", "claude-opus-4-8"),
      role("reviewer", "pi", "anthropic/claude-opus-4-8"),
    ];
    expect(thrownCode(policyConstruction(correlated, "hb133-leg-b"))).toBe("error_review_provider_family_collapse");
  });

  it("leg (c): a review role with no resolvable configured assignment fails closed", () => {
    // The route demands independent review naming "reviewer", but the org
    // chart cannot resolve that role. Silence would be green-by-absence; the
    // pin refuses with the typed unresolvable code instead.
    const missingReviewer = [role("planner", "claude", "claude-opus-4-8"), role("builder", "codex", "gpt-5.6-sol")];
    expect(thrownCode(policyConstruction(missingReviewer, "hb133-leg-c"))).toBe(
      "error_review_provider_family_unresolvable",
    );
  });

  it("leg (c): an independent-review policy with an empty seat list fails closed", () => {
    const disjoint = [
      role("planner", "claude", "claude-opus-4-8"),
      role("builder", "codex", "gpt-5.6-sol"),
      role("reviewer", "claude", "claude-opus-4-8"),
    ];
    const construction = (): unknown =>
      createEpisodePlanningPolicy(APP, {
        intent: intentFor("hb133-leg-c-empty", disjoint),
        roles: disjoint,
        independentReview: { subjectRoles: ["builder"], reviewerRoles: [] },
      });
    expect(thrownCode(construction)).toBe("error_review_provider_family_unresolvable");
  });

  it("leg (f) F-PT-038: a route requiring independent review with NO resolvable policy fails closed", () => {
    // The hole this closes: leg (c) above passes an EXPLICIT independentReview,
    // so it never exercised the path where no policy resolves AT ALL. With no
    // role named builder or reviewer, defaultBuilderReviewerPolicy returned
    // undefined and the whole `if (review !== undefined)` guard was SKIPPED —
    // the cross-provider-family control silently did not run, while an empty
    // seat list two lines below deliberately refused. The same unsatisfiable
    // policy failed closed one way and open the other, decided by role naming.
    const unnamed = [
      role("planner", "claude", "claude-opus-4-8"),
      role("implementer", "codex", "gpt-5.6-sol"),
      role("critic", "claude", "claude-opus-4-8"),
    ];
    const construction = (): unknown =>
      createEpisodePlanningPolicy(APP, {
        intent: reviewRequiringIntent("f-pt-038-unresolvable", unnamed),
        roles: unnamed,
      });
    // SEEDED CONTROL: before the ruling this returned a policy object instead of
    // throwing, and `policy.validation.independentReview` was undefined — a
    // safety control reading as satisfied while covering nothing.
    expect(thrownCode(construction)).toBe("error_review_provider_family_unresolvable");
  });

  it("leg (f) F-PT-038: the name-based default still resolves when the seats ARE named — not a regression", () => {
    // The default is retained as a convenience; the refusal above must not fire
    // for an org chart that does use the convention (negative control both ways).
    const named = [
      role("planner", "claude", "claude-opus-4-8"),
      role("builder", "codex", "gpt-5.6-sol"),
      role("reviewer", "claude", "claude-opus-4-8"),
    ];
    const policy = createEpisodePlanningPolicy(APP, {
      intent: reviewRequiringIntent("f-pt-038-named", named),
      roles: named,
    });
    expect(policy.validation.independentReview?.subjectRoles).toEqual(["builder"]);
    expect(policy.validation.independentReview?.reviewerRoles).toEqual(["reviewer"]);
  });

  it("leg (d): different provider families pass — the non-vacuous positive", () => {
    // The ratified pairing shape: Builder on openai, Reviewer on anthropic.
    // Planner deliberately SHARES the reviewer's family to prove the pin binds
    // exactly Builder↔Reviewer, not every role pair.
    const disjoint = [
      role("planner", "claude", "claude-opus-4-8"),
      role("builder", "codex", "gpt-5.6-sol"),
      role("reviewer", "claude", "claude-opus-4-8"),
    ];
    const policy = createEpisodePlanningPolicy(APP, {
      intent: intentFor("hb133-leg-d", disjoint),
      roles: disjoint,
      independentReview: { subjectRoles: ["builder"], reviewerRoles: ["reviewer"] },
    });
    // The plan-level independent-review validation stays armed downstream of
    // the config-level pin — pass means both layers exist, not that the check
    // vanished.
    expect(policy.validation.independentReview).toBeDefined();
    expect(policy.validation.independentReview?.subjectRoles).toEqual(["builder"]);
    expect(policy.validation.independentReview?.reviewerRoles).toEqual(["reviewer"]);
  });

  it("leg (e): a manual-only route gets no imposed Reviewer — a collapsed-family role still runs dry", async () => {
    // runRole is the manual transport (docs/loop/design.md §2/§3): one role,
    // human-invoked. The disjointness pin binds autonomous code delivery only
    // (catalog §10.2 leg e; M18/jobs leg in tests/hermetic/cf-review-provider/).
    // Even with the org chart collapsed onto one family, the manual dry run
    // assembles its brief and never refuses on review identity.
    const collapsedBuilder = role("builder", "claude", "claude-opus-4-8");
    const result = await runRole({ role: collapsedBuilder, dryRun: true });
    expect(result.executed).toBe(false);
    expect(result.brief).toContain("Manual role turn: builder");
  });
});
