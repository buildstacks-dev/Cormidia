// CF-J04-R — gate-red, review changes-requested, and bounded review-cycle
// return paths (L2, STD; HB-031).

import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LOOP_POLICY } from "../../../src/loop/driver.js";
import { advanceGates, advanceReviewing, parseAcceptanceCriteria } from "../../../src/loop/loop.js";
import { buildJ04Item, j04Git, makeJ04World, reviewJ04Item, type J04World } from "./support.js";

describe("CF-J04-R — delivery refusal and bounded-return branches", () => {
  const worlds: J04World[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0).reverse()) await world.cleanup();
  });

  it("gate-red returns the ticket with exact evidence and never creates a PR", async () => {
    const world = await makeJ04World();
    worlds.push(world);
    const item = await buildJ04Item(world);
    const returned = await advanceGates(item, {
      gh: world.gh,
      policy: { ...DEFAULT_LOOP_POLICY, remediation: { ...DEFAULT_LOOP_POLICY.remediation, maxAttempts: 0 } },
      commands: { testCommand: "false" },
      base: world.base,
      criteria: parseAcceptanceCriteria(item.body),
      criterionTests: item.criterionTests ?? {},
    });

    expect(returned.phase).toBe("returned");
    expect(returned.gateResults.at(-1)?.status).toBe("blocked");
    expect((await world.gh.readIssue(item.issueNumber)).labels).toEqual(["op:returned"]);
    expect(world.github.readState().prs).toEqual({});
    expect(world.github.callLog().some((entry) => entry.op === "pr.merge")).toBe(false);
  });

  it("CHANGES_REQUESTED bounces to building with the review evidence retained", async () => {
    const world = await makeJ04World();
    worlds.push(world);
    const reviewing = await reviewJ04Item(world);
    await world.gh.createReview(reviewing.prNumber!, {
      state: "request_changes",
      body: "delivery.md needs a concrete recovery note",
      expectedCommit: j04Git(reviewing.worktree!, "rev-parse", "HEAD"),
    });
    const bounced = await advanceReviewing(reviewing, { gh: world.gh });
    expect(bounced).toMatchObject({ phase: "building", cycles: 1 });
    expect(bounced.findings).toHaveLength(1);
    expect((await world.gh.readIssue(bounced.issueNumber)).labels).toEqual(["op:building"]);
  });

  it("a fourth non-actionable review cycle returns instead of spinning or merging", async () => {
    const world = await makeJ04World();
    worlds.push(world);
    let item = await reviewJ04Item(world);
    for (let cycle = 1; cycle <= 4; cycle += 1) {
      item = await advanceReviewing(item, { gh: world.gh, maxCycles: 3 });
      expect(item.cycles).toBe(cycle);
    }
    expect(item.phase).toBe("returned");
    expect((await world.gh.readIssue(item.issueNumber)).labels).toEqual(["op:returned"]);
    expect(world.github.callLog().some((entry) => entry.op === "pr.merge")).toBe(false);
  });
});
