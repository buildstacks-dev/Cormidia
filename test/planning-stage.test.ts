import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppEntry } from "../src/org/apps.js";
import {
  discoverPlanningStageCheckout,
  persistedPlanningStageResolution,
  PLANNING_STAGE_THRESHOLDS,
  resolvePlanningStage,
} from "../src/org/planning-stage.js";
import { makeBareWithClone, type BareCloneFixture } from "./fixtures/gitRepo.js";

describe("planning stage resolution", () => {
  const fixtures: BareCloneFixture[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.cleanup();
  });

  function repo(defaultBranch = "develop"): BareCloneFixture {
    const fixture = makeBareWithClone(defaultBranch);
    fixtures.push(fixture);
    return fixture;
  }

  it("infers bootstrap for a live greenfield app on a non-default-named branch", () => {
    const fixture = repo();
    fixture.clone.commit("chore: add Operon greenfield seed", {
      ".operon/planning/0001-greenfield-seed.md": "# Greenfield seed\n",
    });
    const app: AppEntry = {
      name: "clone",
      repo: fixture.bare.root,
      status: "live",
      budgetUsdMonth: 100,
      cadence: {},
    };
    const orgHome = join(fixture.root, "org");
    mkdirSync(orgHome);
    const discovered = discoverPlanningStageCheckout({
      app,
      orgHome,
      stateHome: join(fixture.root, "state"),
    });
    const result = resolvePlanningStage({
      checkout: discovered.checkout,
      checkoutSource: discovered.source,
    });

    expect(discovered).toEqual({
      checkout: fixture.clone.root,
      source: "registered_local_checkout",
    });
    expect(result).toEqual({
      stage: "bootstrap",
      source: "repository_evidence",
      reason: "greenfield_seed_low_history_no_releases",
      evidence: {
        inspection: "complete",
        checkoutSource: "registered_local_checkout",
        greenfieldSeedPresent: true,
        reachableCommitCount: 2,
        reachableTagCount: 0,
        reachableTagCountIsLowerBound: false,
      },
    });
  });

  it("does not let a retained greenfield seed pin a growing repository", () => {
    const fixture = repo();
    fixture.clone.commit("chore: add Operon greenfield seed", {
      ".operon/planning/0001-greenfield-seed.md": "# Greenfield seed\n",
    });
    for (let index = 2; index <= PLANNING_STAGE_THRESHOLDS.bootstrapMaxReachableCommits; index++) {
      fixture.clone.commit(`feat: growth ${index}`, { [`history/${index}.txt`]: `${index}\n` });
    }

    const result = resolvePlanningStage({
      checkout: fixture.clone.root,
      checkoutSource: "explicit",
    });
    expect(result).toMatchObject({
      stage: "growth",
      source: "repository_evidence",
      reason: "intermediate_repository_history",
      evidence: {
        greenfieldSeedPresent: true,
        reachableCommitCount: PLANNING_STAGE_THRESHOLDS.bootstrapMaxReachableCommits + 1,
        reachableTagCount: 0,
      },
    });
  });

  it("requires substantial commits and repeated reachable tags before inferring mature", () => {
    const fixture = repo();
    for (let index = 1; index < PLANNING_STAGE_THRESHOLDS.matureMinReachableCommits; index++) {
      fixture.clone.commit(`feat: history ${index}`, { [`history/${index}.txt`]: `${index}\n` });
    }
    for (let index = 1; index <= PLANNING_STAGE_THRESHOLDS.matureMinReachableTags; index++) {
      fixture.clone.git("tag", `v${index}.0.0`);
    }

    const result = resolvePlanningStage({
      checkout: fixture.clone.root,
      checkoutSource: "explicit",
    });
    expect(result).toMatchObject({
      stage: "mature",
      source: "repository_evidence",
      reason: "substantial_versioned_history",
      evidence: {
        reachableCommitCount: PLANNING_STAGE_THRESHOLDS.matureMinReachableCommits,
        reachableTagCount: PLANNING_STAGE_THRESHOLDS.matureMinReachableTags,
      },
    });
  });

  it("keeps explicit stage authoritative without requiring repository evidence", () => {
    expect(resolvePlanningStage({
      requestedStage: "mature",
      checkout: "/definitely/not/a/checkout",
      checkoutSource: "explicit",
    })).toEqual({
      stage: "mature",
      source: "explicit",
      reason: "operator_supplied",
      evidence: {
        inspection: "not_required",
        checkoutSource: "explicit",
        greenfieldSeedPresent: null,
        reachableCommitCount: null,
        reachableTagCount: null,
        reachableTagCountIsLowerBound: false,
      },
    });
  });

  it("uses an auditable bootstrap fallback when no local evidence exists", () => {
    expect(resolvePlanningStage({
      checkout: "/definitely/not/a/checkout",
      checkoutSource: "unavailable",
    })).toMatchObject({
      stage: "bootstrap",
      source: "conservative_fallback",
      reason: "repository_evidence_unavailable",
      evidence: { inspection: "unavailable", checkoutSource: "unavailable" },
    });
  });

  it("keeps legacy persisted stages readable instead of re-inferring on resume", () => {
    expect(persistedPlanningStageResolution({
      stage: "mature",
      stored: undefined,
    })).toMatchObject({
      stage: "mature",
      source: "persisted_intent",
      reason: "legacy_intent_stage_preserved",
    });
  });
});
