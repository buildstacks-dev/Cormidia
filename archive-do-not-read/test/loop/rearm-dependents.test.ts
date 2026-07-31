// L-007 / L1-04: orchestrator-owned dependency re-arm. Focused unit coverage
// of rearmDependents over FakeGhOps: multi-dependency partial satisfaction,
// only the stateless backlog is armed (owned tickets are left alone), and a
// non-dependent is never touched. No network, auth, or real GitHub is required.

import { describe, expect, it } from "vitest";
import { rearmDependents } from "../../src/loop/loop.js";
import { FakeGhOps } from "../support/fakeGhOps.js";

function body(...deps: number[]): string {
  return ["## Goal", "Do the thing.", "", ...deps.map((dep) => `Depends-on: #${dep}`), ""].join("\n");
}

describe("rearmDependents (L-007)", () => {
  it("arms a dependent whose only predecessor just merged, and no one else", async () => {
    const gh = new FakeGhOps({
      issues: [
        { number: 1, title: "Predecessor", body: body(), labels: [], state: "CLOSED" },
        { number: 2, title: "Dependent", body: body(1), labels: [] },
        { number: 3, title: "Unrelated backlog", body: body(9), labels: [] },
      ],
    });
    const armed = await rearmDependents(gh, 1);
    expect(armed).toEqual([2]);
    expect((await gh.readIssue(2)).labels).toContain("op:ready");
    expect((await gh.readIssue(3)).labels).not.toContain("op:ready");
    // A comment records the orchestrator-owned re-arm.
    expect(gh.issueComments.get(2)?.join("\n")).toContain("Dependencies satisfied");
  });

  it("does not arm a dependent while any predecessor is still open", async () => {
    const gh = new FakeGhOps({
      issues: [
        { number: 1, title: "Merged", body: body(), labels: [], state: "CLOSED" },
        { number: 2, title: "Still open predecessor", body: body(), labels: ["op:ready"] },
        { number: 3, title: "Depends on both #1 and #2", body: body(1, 2), labels: [] },
      ],
    });
    // #1 merged, but #2 is still open -> #3 stays blocked.
    expect(await rearmDependents(gh, 1)).toEqual([]);
    expect((await gh.readIssue(3)).labels).not.toContain("op:ready");

    // Now #2 merges (closed) too -> the second-predecessor merge arms #3.
    await gh.closeIssue(2);
    expect(await rearmDependents(gh, 2)).toEqual([3]);
    expect((await gh.readIssue(3)).labels).toContain("op:ready");
  });

  it("never relabels a dependent that already has an owner (a state label)", async () => {
    const gh = new FakeGhOps({
      issues: [
        { number: 1, title: "Merged", body: body(), labels: [], state: "CLOSED" },
        { number: 2, title: "Already building", body: body(1), labels: ["op:building"] },
        { number: 3, title: "Already returned", body: body(1), labels: ["op:returned"] },
      ],
    });
    expect(await rearmDependents(gh, 1)).toEqual([]);
    expect((await gh.readIssue(2)).labels).toEqual(["op:building"]);
    expect((await gh.readIssue(3)).labels).toEqual(["op:returned"]);
  });
});
