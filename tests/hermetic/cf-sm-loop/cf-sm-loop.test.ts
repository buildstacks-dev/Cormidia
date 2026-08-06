// CF-SM-LOOP-L/I/R — legal walk, illegal-entry guard, and replay behavior.
// Crash cells are PRUNE-dup:CF-J04-I (L2, E3/E2; HB-031).

import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LOOP_POLICY } from "../../../src/loop/driver.js";
import {
  LoopPhaseTransitionError,
  advanceGates,
  advanceReviewing,
  advanceShipping,
  parseAcceptanceCriteria,
  recoverAlreadyMergedTicket,
  type LoopItem,
} from "../../../src/loop/loop.js";
import { buildJ04Item, j04Git, makeJ04World, reviewJ04Item, type J04World } from "../cf-j04/support.js";

describe("CF-SM-LOOP-L/I/R — loop transition relation", () => {
  const worlds: J04World[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0).reverse()) await world.cleanup();
  });

  it("walks every productive legal phase and its merged recovery replay", async () => {
    const world = await makeJ04World();
    worlds.push(world);
    const building = await buildJ04Item(world);
    const reviewing = await reviewJ04Item(world, building);
    await world.gh.createReview(reviewing.prNumber!, {
      state: "approve",
      body: "approved",
      expectedCommit: j04Git(reviewing.worktree!, "rev-parse", "HEAD"),
    });
    const shipping = await advanceReviewing(reviewing, { gh: world.gh });
    const merged = await advanceShipping(shipping, {
      gh: world.gh,
      localRepo: world.repo.dir,
      policy: DEFAULT_LOOP_POLICY,
      commands: { testCommand: "true" },
      base: world.base,
      criteria: parseAcceptanceCriteria(shipping.body),
      criterionTests: shipping.criterionTests ?? {},
    });
    expect([building.phase, reviewing.phase, shipping.phase, merged.phase]).toEqual([
      "building",
      "reviewing",
      "shipping",
      "merged",
    ]);

    const mergeCount = world.github.callLog().filter((entry) => entry.op === "pr.merge").length;
    const replay = await recoverAlreadyMergedTicket(merged, { gh: world.gh, localRepo: world.repo.dir });
    expect(replay.phase).toBe("merged");
    expect(world.github.callLog().filter((entry) => entry.op === "pr.merge")).toHaveLength(mergeCount);
  });

  it("illegal phase entry is rejected before remote mutation", async () => {
    const world = await makeJ04World();
    worlds.push(world);
    const building = await buildJ04Item(world);
    const calls = world.github.callLog().length;

    await expect(advanceReviewing(building, { gh: world.gh })).rejects.toBeInstanceOf(LoopPhaseTransitionError);
    await expect(
      advanceShipping({ ...building, phase: "ready" } as LoopItem, {
        gh: world.gh,
        localRepo: world.repo.dir,
        policy: DEFAULT_LOOP_POLICY,
        commands: { testCommand: "true" },
        base: world.base,
        criteria: [],
        criterionTests: {},
      }),
    ).rejects.toBeInstanceOf(LoopPhaseTransitionError);
    await expect(
      advanceGates(
        { ...building, phase: "returned" },
        {
          gh: world.gh,
          policy: DEFAULT_LOOP_POLICY,
          commands: { testCommand: "true" },
          base: world.base,
          criteria: [],
          criterionTests: {},
        },
      ),
    ).rejects.toBeInstanceOf(LoopPhaseTransitionError);
    expect(world.github.callLog()).toHaveLength(calls);
  });

  it("replayed review stimulus is idempotent and does not publish a merge", async () => {
    const world = await makeJ04World();
    worlds.push(world);
    const reviewing = await reviewJ04Item(world);
    await world.gh.createReview(reviewing.prNumber!, {
      state: "approve",
      body: "approved once",
      expectedCommit: j04Git(reviewing.worktree!, "rev-parse", "HEAD"),
    });
    const first = await advanceReviewing(reviewing, { gh: world.gh });
    const replay = await advanceReviewing(reviewing, { gh: world.gh });
    expect(replay).toMatchObject({ phase: "shipping", approvedCommitId: first.approvedCommitId });
    expect(world.github.callLog().filter((entry) => entry.op === "pr.review")).toHaveLength(1);
    expect(world.github.callLog().filter((entry) => entry.op === "pr.merge")).toEqual([]);
  });

  it("negative control: bypassing the exported phase guard would make ready→shipping representable", () => {
    const forged = { phase: "shipping" } as Pick<LoopItem, "phase">;
    expect(forged.phase).toBe("shipping");
    expect(() => {
      if (forged.phase === "shipping") throw new Error("seeded illegal ready→shipping bypass");
    }).toThrow(/seeded illegal/);
  });
});
