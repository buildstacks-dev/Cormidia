// Tests schema-validated, orchestrator-published planning tickets in
// src/loop/plan-tickets.ts (Stage 4 of docs/proportionality-review.md).
// Covers stage ticket budgets, tier calibration, criterion quality,
// dependency sanity, body rendering the loop's own parsers read back, label
// guarantees, ready-labeling, and forward-dependency back-fill.
// Uses FakeGhOps; no network, auth, real GitHub state, or wall clock.

import { describe, expect, it } from "vitest";
import {
  CANONICAL_LABELS,
  publishTickets,
  renderTicketBody,
  validatePlan,
  type PlanTicket,
  type TicketPlan,
} from "../../src/loop/plan-tickets.js";
import { parseAcceptanceCriteria } from "../../src/loop/loop.js";
import { parseDependsOn, parseScope } from "../../src/loop/scheduling.js";
import { FakeGhOps } from "../support/fakeGhOps.js";

function ticket(overrides: Partial<PlanTicket> = {}): PlanTicket {
  return {
    title: "Ship the scaffold with a visible landing page",
    tier: "op:tier-standard",
    priority: "p1",
    dependsOn: [],
    executionGroup: "g1",
    fileScope: ["src/**", "package.json"],
    goal: "A deployable site with real content on the landing page.",
    context: "Greenfield repo; product docs in README.",
    acceptanceCriteria: ["pnpm test exits 0", "the landing page renders the product name"],
    outOfScope: "Analytics, RSS, custom domains.",
    notesForBuilder: "Keep dependencies boring.",
    ...overrides,
  };
}

function plan(overrides: Partial<TicketPlan> = {}): TicketPlan {
  return {
    stage: "bootstrap",
    ticketCountRationale: "One coherent milestone: scaffold plus first visible content ships together.",
    releaseDisposition: "Deploys to the owner's static host; the orchestrator triggers CI deploy after merge.",
    tickets: [ticket()],
    ...overrides,
  };
}

describe("validatePlan", () => {
  it("accepts a proportional bootstrap plan", () => {
    expect(validatePlan(plan())).toEqual({ ok: true, problems: [] });
  });

  it("rejects a plan over the stage budget — the 19-ticket website can never validate", () => {
    const oversized = plan({ tickets: Array.from({ length: 19 }, () => ticket()) });
    const result = validatePlan(oversized);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes("budget of 3"))).toBe(true);
  });

  it("rejects deep-tier tickets at bootstrap stage (tier follows surface, not ceremony)", () => {
    const result = validatePlan(plan({ tickets: [ticket({ tier: "op:tier-deep" })] }));
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes("op:tier-deep"))).toBe(true);
  });

  it("requires the plan to argue its size and name its release disposition", () => {
    const result = validatePlan(plan({ ticketCountRationale: " ", releaseDisposition: "" }));
    expect(result.problems.some((p) => p.includes("argue its own size"))).toBe(true);
    expect(result.problems.some((p) => p.includes("release"))).toBe(true);
  });

  it("rejects vague criteria, bad dependency indexes, and a fully serial graph", () => {
    const result = validatePlan(
      plan({
        tickets: [
          ticket({ acceptanceCriteria: ["works"], dependsOn: [0] }),
          ticket({ dependsOn: [5] }),
        ],
      }),
    );
    expect(result.problems.some((p) => p.includes("not mechanically checkable"))).toBe(true);
    expect(result.problems.some((p) => p.includes("depends on itself"))).toBe(true);
    expect(result.problems.some((p) => p.includes("out of range"))).toBe(true);
    expect(result.problems.some((p) => p.includes("no dependency-free ticket"))).toBe(true);
  });
});

describe("renderTicketBody", () => {
  it("renders a body the loop's own parsers read back", () => {
    const body = renderTicketBody(ticket({ dependsOn: [0] }), [41]);

    expect(parseDependsOn(body)).toEqual([41]);
    expect(parseScope(body)).toEqual(["src/**", "package.json"]);
    const criteria = parseAcceptanceCriteria(body);
    expect(criteria).toHaveLength(2);
    expect(criteria.every((c) => !c.checked)).toBe(true);
  });
});

describe("publishTickets", () => {
  it("ensures canonical labels, publishes with tier/priority, arms only dependency-free tickets", async () => {
    const gh = new FakeGhOps();
    const twoTickets = plan({
      ticketCountRationale: "Second ticket is rollback-isolated deploy config.",
      tickets: [ticket(), ticket({ title: "Wire the deploy", dependsOn: [0], priority: "p2" })],
    });

    const { published } = await publishTickets(gh, twoTickets);

    expect(published).toHaveLength(2);
    for (const label of CANONICAL_LABELS) expect(gh.repoLabels.has(label.name)).toBe(true);
    const issues = await gh.listIssues({ state: "all", limit: 10 });
    const first = issues.find((i) => i.number === published[0]!.issueNumber)!;
    const second = issues.find((i) => i.number === published[1]!.issueNumber)!;
    expect(first.labels).toEqual(expect.arrayContaining(["op:tier-standard", "p1", "op:ready"]));
    // Dependency-locked backlog stays stateless until groom arms it.
    expect(second.labels).not.toContain("op:ready");
    expect(parseDependsOn(second.body)).toEqual([first.number]);
  });

  it("back-fills forward dependencies with real issue numbers after creation", async () => {
    const gh = new FakeGhOps();
    const forward = plan({
      ticketCountRationale: "Parallel pair with a cross-check ticket.",
      tickets: [ticket({ title: "A", dependsOn: [1] }), ticket({ title: "B" })],
    });

    const { published } = await publishTickets(gh, forward);
    const a = (await gh.listIssues({ state: "all", limit: 10 })).find(
      (i) => i.number === published[0]!.issueNumber,
    )!;
    expect(parseDependsOn(a.body)).toEqual([published[1]!.issueNumber]);
  });

  it("refuses to touch GitHub when validation fails", async () => {
    const gh = new FakeGhOps();
    await expect(
      publishTickets(gh, plan({ tickets: Array.from({ length: 5 }, () => ticket()) })),
    ).rejects.toThrow(/failed validation/);
    expect(await gh.listIssues({ state: "all", limit: 10 })).toEqual([]);
    expect(gh.repoLabels.size).toBe(0);
  });
});
