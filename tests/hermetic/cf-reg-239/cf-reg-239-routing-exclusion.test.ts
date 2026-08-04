// #239 — a human-only routing decision is a durable exclusion at both the
// Planner readiness seam and the Builder claim seam. The routing label is
// deliberately outside the op:* phase namespace and survives state swaps.

import { describe, expect, it } from "vitest";
import { baseRevisionForBranch } from "../../../src/loop/default-branch.js";
import type { GhIssue, GhOps, ListIssueOptions } from "../../../src/loop/github.js";
import { claimTicket } from "../../../src/loop/loop.js";
import { DEFAULT_LOOP_POLICY, runLoopOnce } from "../../../src/loop/driver.js";
import {
  applyPlannerReadinessDecisions,
  preparePlannerIssueIntake,
  type PlannerReadinessDecision,
} from "../../../src/org/planner-intake.js";
import { makeJ04World } from "../cf-j04/support.js";

const HUMAN_ONLY = "routing:human-only";
const MANUAL_REVIEW = "manual-review";
const COMPLETE_BODY = [
  "Depends-on: none",
  "Execution group: routing",
  "File scope: src/feature.ts",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] focused detector passes",
].join("\n");

function issue(labels: string[]): GhIssue {
  return {
    number: 239,
    title: "Deliver a routine change",
    body: COMPLETE_BODY,
    labels,
    state: "OPEN",
  };
}

class RoutingGithub {
  readonly issues: GhIssue[];
  readonly swaps: Array<[number, string, string]> = [];
  readonly additions: Array<[number, string]> = [];
  readonly removals: Array<[number, string]> = [];
  failReads = false;

  constructor(issues: GhIssue[]) {
    this.issues = structuredClone(issues);
  }

  async listIssues(options: ListIssueOptions = {}): Promise<GhIssue[]> {
    const required = options.labels ?? [];
    return this.issues
      .filter((entry) => options.state !== "closed" && entry.state === "OPEN")
      .filter((entry) => required.every((label) => entry.labels.includes(label)))
      .map((entry) => structuredClone(entry));
  }

  async readIssue(number: number): Promise<GhIssue> {
    if (this.failReads) throw new Error("GitHub label state unavailable");
    const found = this.issues.find((entry) => entry.number === number);
    if (found === undefined) throw new Error(`missing issue #${number}`);
    return structuredClone(found);
  }

  async addLabel(number: number, label: string): Promise<void> {
    this.additions.push([number, label]);
    const found = this.require(number);
    if (!found.labels.includes(label)) found.labels.push(label);
  }

  async removeLabel(number: number, label: string): Promise<void> {
    this.removals.push([number, label]);
    const found = this.require(number);
    found.labels = found.labels.filter((candidate) => candidate !== label);
  }

  async swapLabel(number: number, from: string, to: string): Promise<void> {
    this.swaps.push([number, from, to]);
    const found = this.require(number);
    found.labels = found.labels.filter((candidate) => candidate !== from);
    if (!found.labels.includes(to)) found.labels.push(to);
  }

  private require(number: number): GhIssue {
    const found = this.issues.find((entry) => entry.number === number);
    if (found === undefined) throw new Error(`missing issue #${number}`);
    return found;
  }
}

function readyDecision(): PlannerReadinessDecision {
  return {
    issue_number: 239,
    disposition: "ready",
    reason_code: "routine_ready",
    reason: "The ticket is complete and routine.",
  };
}

describe("CF-REG-239 — durable exclusion from autonomous execution", () => {
  it("keeps an otherwise complete human-only issue unready with a typed Planner reason", async () => {
    const gh = new RoutingGithub([issue(["p2", "op:tier-quick", HUMAN_ONLY])]);
    const intake = await preparePlannerIssueIntake({
      gh: gh as unknown as GhOps,
      app: "cormidia",
      turnId: "planner-human-only",
    });

    const result = await applyPlannerReadinessDecisions({
      gh: gh as unknown as GhOps,
      intake,
      decisions: [readyDecision()],
    });

    expect(result.applied_issue_numbers).toEqual([]);
    expect(result.outcomes[0]).toMatchObject({
      requested_disposition: "ready",
      disposition: "unready",
      reason_code: "autonomous_execution_excluded",
    });
    expect((await gh.readIssue(239)).labels).not.toContain("op:ready");
  });

  it("negative control readies the identical issue when the routing label is absent", async () => {
    const gh = new RoutingGithub([issue(["p2", "op:tier-quick"])]);
    const intake = await preparePlannerIssueIntake({
      gh: gh as unknown as GhOps,
      app: "cormidia",
      turnId: "planner-routine",
    });

    const result = await applyPlannerReadinessDecisions({
      gh: gh as unknown as GhOps,
      intake,
      decisions: [readyDecision()],
    });

    expect(result.applied_issue_numbers).toEqual([239]);
    expect((await gh.readIssue(239)).labels).toContain("op:ready");
  });

  it("keeps an otherwise complete manual-review issue unready without removing the hold", async () => {
    const gh = new RoutingGithub([issue(["p2", "op:tier-quick", MANUAL_REVIEW])]);
    const intake = await preparePlannerIssueIntake({
      gh: gh as unknown as GhOps,
      app: "cormidia",
      turnId: "planner-manual-review",
    });

    const result = await applyPlannerReadinessDecisions({
      gh: gh as unknown as GhOps,
      intake,
      decisions: [readyDecision()],
    });

    expect(result.outcomes[0]).toMatchObject({
      disposition: "unready",
      reason_code: "autonomous_execution_excluded",
    });
    expect((await gh.readIssue(239)).labels).toContain(MANUAL_REVIEW);
    expect(gh.removals).not.toContainEqual([239, MANUAL_REVIEW]);
  });

  it("does not wildcard unrelated manual-* taxonomy", async () => {
    const gh = new RoutingGithub([issue(["p2", "op:tier-quick", "manual-feelview"])]);
    const intake = await preparePlannerIssueIntake({
      gh: gh as unknown as GhOps,
      app: "cormidia",
      turnId: "planner-manual-taxonomy-negative-control",
    });

    const result = await applyPlannerReadinessDecisions({
      gh: gh as unknown as GhOps,
      intake,
      decisions: [readyDecision()],
    });

    expect(result.applied_issue_numbers).toEqual([239]);
    expect((await gh.readIssue(239)).labels).toEqual(expect.arrayContaining(["manual-feelview", "op:ready"]));
  });

  it("retracts only op:ready when manual-review arrives during Planner publication", async () => {
    const gh = new RoutingGithub([issue(["p2", "op:tier-quick"])]);
    const intake = await preparePlannerIssueIntake({
      gh: gh as unknown as GhOps,
      app: "cormidia",
      turnId: "planner-late-manual-review",
    });

    const result = await applyPlannerReadinessDecisions({
      gh: gh as unknown as GhOps,
      intake,
      decisions: [readyDecision()],
      fault: () => gh.addLabel(239, MANUAL_REVIEW),
    });

    expect(result.outcomes[0]?.reason_code).toBe("autonomous_execution_excluded");
    expect((await gh.readIssue(239)).labels).toContain(MANUAL_REVIEW);
    expect((await gh.readIssue(239)).labels).not.toContain("op:ready");
    expect(gh.removals).toEqual([[239, "op:ready"]]);
  });

  it("re-reads routing at publication so a label applied after intake still wins", async () => {
    const gh = new RoutingGithub([issue(["p2", "op:tier-quick"])]);
    const intake = await preparePlannerIssueIntake({
      gh: gh as unknown as GhOps,
      app: "cormidia",
      turnId: "planner-late-routing",
    });
    await gh.addLabel(239, HUMAN_ONLY);

    const result = await applyPlannerReadinessDecisions({
      gh: gh as unknown as GhOps,
      intake,
      decisions: [readyDecision()],
    });

    expect(result.outcomes[0]?.reason_code).toBe("autonomous_execution_excluded");
    expect((await gh.readIssue(239)).labels).not.toContain("op:ready");
  });

  it("treats unreadable routing state as excluded instead of adding op:ready", async () => {
    const gh = new RoutingGithub([issue(["p2", "op:tier-quick"])]);
    const intake = await preparePlannerIssueIntake({
      gh: gh as unknown as GhOps,
      app: "cormidia",
      turnId: "planner-unreadable-routing",
    });
    gh.failReads = true;

    const result = await applyPlannerReadinessDecisions({
      gh: gh as unknown as GhOps,
      intake,
      decisions: [readyDecision()],
    });

    expect(result.applied_issue_numbers).toEqual([]);
    expect(result.outcomes[0]?.reason_code).toBe("routing_state_unreadable");
    expect(gh.additions.filter(([, label]) => label === "op:ready")).toEqual([]);
  });

  it("retracts op:ready when routing state becomes unreadable during publication", async () => {
    const gh = new RoutingGithub([issue(["p2", "op:tier-quick"])]);
    const intake = await preparePlannerIssueIntake({
      gh: gh as unknown as GhOps,
      app: "cormidia",
      turnId: "planner-publication-read-failure",
    });

    const result = await applyPlannerReadinessDecisions({
      gh: gh as unknown as GhOps,
      intake,
      decisions: [readyDecision()],
      fault: () => {
        gh.failReads = true;
      },
    });

    expect(result.applied_issue_numbers).toEqual([]);
    expect(result.outcomes[0]?.reason_code).toBe("routing_state_unreadable");
    expect(gh.removals).toContainEqual([239, "op:ready"]);
    gh.failReads = false;
    expect((await gh.readIssue(239)).labels).not.toContain("op:ready");
  });

  it("Builder refuses a ready human-only issue with a typed diagnostic and no claim", async () => {
    const gh = new RoutingGithub([issue(["p2", "op:tier-quick", "op:ready", HUMAN_ONLY])]);
    const result = await runLoopOnce({
      app: "cormidia",
      repo: "cormidia/Cormidia",
      gh: gh as unknown as GhOps,
      localRepo: "/unreachable",
      worktreeRoot: "/unreachable",
      policy: DEFAULT_LOOP_POLICY,
      commands: { testCommand: "true" },
      base: baseRevisionForBranch("trunk"),
      planOnly: true,
    });

    expect(result.itemsPreviewed).toBe(0);
    expect((result as { routingRefusals?: unknown[] }).routingRefusals).toEqual([
      expect.objectContaining({
        issueNumber: 239,
        code: "routing_human_only",
      }),
    ]);
    expect(gh.swaps).toEqual([]);
  });

  it("Builder refuses a ready manual-review issue with a distinct typed diagnostic", async () => {
    const gh = new RoutingGithub([issue(["p2", "op:tier-quick", "op:ready", MANUAL_REVIEW])]);
    const result = await runLoopOnce({
      app: "cormidia",
      repo: "cormidia/Cormidia",
      gh: gh as unknown as GhOps,
      localRepo: "/unreachable",
      worktreeRoot: "/unreachable",
      policy: DEFAULT_LOOP_POLICY,
      commands: { testCommand: "true" },
      base: baseRevisionForBranch("trunk"),
      planOnly: true,
    });

    expect(result.itemsPreviewed).toBe(0);
    expect(result.routingRefusals).toEqual([
      expect.objectContaining({ issueNumber: 239, code: "manual_review" }),
    ]);
    expect(gh.swaps).toEqual([]);
  });

  it("Builder re-reads a stale ready issue and refuses a late manual-review hold", async () => {
    const world = await makeJ04World();
    try {
      await world.gh.ensureLabel({
        name: MANUAL_REVIEW,
        color: "b60205",
        description: "Held for manual review",
      });
      await world.gh.addLabel(world.issue.number, MANUAL_REVIEW);

      await expect(claimTicket(world.issue, {
        gh: world.gh,
        targetRepo: world.github.repo,
        localRepo: world.repo.dir,
        worktreeRoot: world.worktreeRoot,
        base: world.base,
      })).rejects.toMatchObject({
        code: "autonomous_manual_review",
        issueNumber: world.issue.number,
      });
      expect((await world.gh.readIssue(world.issue.number)).labels).toEqual(["op:ready", MANUAL_REVIEW]);
    } finally {
      await world.cleanup();
    }
  });

  it("Builder re-reads a stale ready issue and refuses a late human-only label", async () => {
    const world = await makeJ04World();
    try {
      await world.gh.ensureLabel({
        name: HUMAN_ONLY,
        color: "b60205",
        description: "Excluded from autonomous execution",
      });
      await world.gh.addLabel(world.issue.number, HUMAN_ONLY);

      await expect(claimTicket(world.issue, {
        gh: world.gh,
        targetRepo: world.github.repo,
        localRepo: world.repo.dir,
        worktreeRoot: world.worktreeRoot,
        base: world.base,
      })).rejects.toMatchObject({
        code: "autonomous_routing_human_only",
        issueNumber: world.issue.number,
      });

      expect((await world.gh.readIssue(world.issue.number)).labels).toEqual(["op:ready", HUMAN_ONLY]);
    } finally {
      await world.cleanup();
    }
  });

  it("Builder rolls back a claim when the human-only label arrives during the phase swap", async () => {
    const world = await makeJ04World();
    try {
      await world.gh.ensureLabel({
        name: HUMAN_ONLY,
        color: "b60205",
        description: "Excluded from autonomous execution",
      });

      await expect(claimTicket(world.issue, {
        gh: world.gh,
        targetRepo: world.github.repo,
        localRepo: world.repo.dir,
        worktreeRoot: world.worktreeRoot,
        base: world.base,
        afterLabelTransition: () => world.gh.addLabel(world.issue.number, HUMAN_ONLY),
      })).rejects.toMatchObject({
        code: "autonomous_routing_human_only",
        issueNumber: world.issue.number,
      });

      expect((await world.gh.readIssue(world.issue.number)).labels).toEqual([HUMAN_ONLY, "op:ready"]);
    } finally {
      await world.cleanup();
    }
  });

  it("negative control claims the identical ready issue without the routing label", async () => {
    const world = await makeJ04World();
    try {
      const claimed = await claimTicket(world.issue, {
        gh: world.gh,
        targetRepo: world.github.repo,
        localRepo: world.repo.dir,
        worktreeRoot: world.worktreeRoot,
        base: world.base,
      });
      expect(claimed.phase).toBe("building");
      expect((await world.gh.readIssue(world.issue.number)).labels).toEqual(["op:building"]);
    } finally {
      await world.cleanup();
    }
  });

  it("Builder treats unreadable current label state as a typed exclusion", async () => {
    const world = await makeJ04World();
    try {
      const unreadableGh = Object.create(world.gh) as GhOps;
      unreadableGh.readIssue = async () => {
        throw new Error("simulated label read failure");
      };

      await expect(claimTicket(world.issue, {
        gh: unreadableGh,
        targetRepo: world.github.repo,
        localRepo: world.repo.dir,
        worktreeRoot: world.worktreeRoot,
        base: world.base,
      })).rejects.toMatchObject({
        code: "autonomous_routing_state_unreadable",
        issueNumber: world.issue.number,
      });
      expect(world.github.callLog().filter((entry) => entry.op === "issue.edit")).toEqual([]);
    } finally {
      await world.cleanup();
    }
  });

  it("keeps the routing label across every phase-label swap", async () => {
    const gh = new RoutingGithub([issue(["p2", "op:tier-quick", "op:ready", HUMAN_ONLY])]);

    for (const [from, to] of [
      ["op:ready", "op:building"],
      ["op:building", "op:in-review"],
      ["op:in-review", "op:returned"],
      ["op:returned", "op:ready"],
    ] as const) {
      await gh.swapLabel(239, from, to);
      expect((await gh.readIssue(239)).labels).toContain(HUMAN_ONLY);
    }
  });
});
