// #230 — Planner intake is unfiltered; readiness application is deterministic
// and fail-closed. Builder's query remains op:ready-only.

import { describe, expect, it } from "vitest";
import type { GhIssue, GhOps, ListIssueOptions } from "../../../src/loop/github.js";
import {
  applyPlannerReadinessDecisions,
  parsePlannerReadinessDecisions,
  preparePlannerIssueIntake,
  type PlannerReadinessDecision,
} from "../../../src/org/planner-intake.js";

class IntakeGithub {
  readonly queries: ListIssueOptions[] = [];
  readonly issues: GhIssue[];
  constructor(issues: GhIssue[], readonly failure?: Error) {
    this.issues = issues.map((issue) => ({ ...issue, labels: [...issue.labels] }));
  }
  async listIssues(options: ListIssueOptions = {}): Promise<GhIssue[]> {
    this.queries.push(structuredClone(options));
    if (this.failure !== undefined) throw this.failure;
    const labels = options.labels ?? [];
    return this.issues.filter((issue) =>
      issue.state === "OPEN" && labels.every((label) => issue.labels.includes(label)),
    ).map((issue) => ({ ...issue, labels: [...issue.labels] }));
  }
  async readIssue(number: number): Promise<GhIssue> {
    const issue = this.issues.find((candidate) => candidate.number === number);
    if (issue === undefined) throw new Error(`missing issue ${number}`);
    return { ...issue, labels: [...issue.labels] };
  }
  async addLabel(number: number, label: string): Promise<void> {
    const issue = this.issues.find((candidate) => candidate.number === number);
    if (issue === undefined) throw new Error(`missing issue ${number}`);
    if (!issue.labels.includes(label)) issue.labels.push(label);
  }
}

const completeBody = [
  "Depends-on: none",
  "Execution group: intake",
  "File scope: src/feature.ts",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] focused detector passes",
].join("\n");

function issue(number: number, labels: string[] = [], body = completeBody): GhIssue {
  return { number, title: `Issue ${number}`, body, labels, state: "OPEN" };
}

describe("CF-REG-230 — Planner intake and readiness application", () => {
  it("shows untriaged issues to Planner while Builder's ready-only query sees none", async () => {
    const gh = new IntakeGithub([
      issue(1, ["p2", "op:tier-quick"]),
      issue(2, ["p3", "op:tier-standard"]),
    ]);

    const planner = await preparePlannerIssueIntake({
      gh: gh as unknown as GhOps,
      app: "demo",
      turnId: "turn-planner",
    });
    const builder = await gh.listIssues({ state: "open", labels: ["op:ready"] });

    expect(planner.diagnostic.code).toBe("planner_input_ready");
    expect(planner.issues.map((entry) => entry.number)).toEqual([1, 2]);
    expect(gh.queries[0]).toEqual({ state: "open", limit: 10_001 });
    expect(builder).toEqual([]);
  });

  it("negative control rejects a ready-only Planner query", async () => {
    const gh = new IntakeGithub([issue(1, ["p2", "op:tier-quick"])]);
    const intake = await preparePlannerIssueIntake({
      gh: gh as unknown as GhOps,
      app: "demo",
      turnId: "turn-filtered",
      query: { state: "open", labels: ["op:ready"] },
    });
    expect(intake.diagnostic.code).toBe("ready_only_filtering");
    expect(intake.issues).toEqual([]);
  });

  it("negative control refuses to call a capped 10,001-item source complete", async () => {
    const gh = new IntakeGithub(Array.from({ length: 10_001 }, (_, index) => issue(index + 1)));
    const intake = await preparePlannerIssueIntake({
      gh: gh as unknown as GhOps,
      app: "large-backlog",
      turnId: "turn-completeness-bound",
    });

    expect(intake.diagnostic).toEqual({
      code: "backlog_completeness_bound",
      detail: "open backlog reached the 10000 issue completeness bound",
    });
    expect(intake.issues).toEqual([]);
    expect(intake.deferred_count).toBe(10_001);
  });

  it("publishes a complete routine decision and leaves risky/incomplete work unready with typed reasons", async () => {
    const gh = new IntakeGithub([
      issue(1, ["p2", "op:tier-quick"]),
      issue(2, ["p1", "op:tier-deep", "domain:security"]),
      issue(3, ["p2", "op:tier-standard"], "Needs tests."),
    ]);
    const intake = await preparePlannerIssueIntake({
      gh: gh as unknown as GhOps,
      app: "demo",
      turnId: "turn-publish",
    });
    const decisions: PlannerReadinessDecision[] = intake.issues.map((entry) => ({
      issue_number: entry.number,
      disposition: "ready",
      reason_code: "routine_ready",
      reason: "Planner found the issue executable.",
    }));

    const application = await applyPlannerReadinessDecisions({
      gh: gh as unknown as GhOps,
      intake,
      decisions,
    });

    expect((await gh.readIssue(1)).labels).toContain("op:ready");
    expect((await gh.readIssue(2)).labels).not.toContain("op:ready");
    expect((await gh.readIssue(3)).labels).not.toContain("op:ready");
    expect(application.applied_issue_numbers).toEqual([1]);
    expect(application.outcomes.map((entry) => [entry.issue_number, entry.disposition, entry.reason_code])).toEqual([
      [1, "ready", "routine_ready"],
      [2, "unready", "high_risk"],
      [3, "unready", "validation_incomplete"],
    ]);
  });

  it.each([
    [new Error("spawn gh ENOENT"), "missing_required_executable"],
    [new Error("GitHub API unavailable"), "github_unavailable"],
  ] as const)("distinguishes %s from an empty repository", async (failure, code) => {
    const unavailable = await preparePlannerIssueIntake({
      gh: new IntakeGithub([], failure) as unknown as GhOps,
      app: "demo",
      turnId: "turn-unavailable",
    });
    const empty = await preparePlannerIssueIntake({
      gh: new IntakeGithub([]) as unknown as GhOps,
      app: "demo",
      turnId: "turn-empty",
    });
    expect(unavailable.diagnostic.code).toBe(code);
    expect(empty.diagnostic.code).toBe("empty_repository");
  });

  it("parses the content-bound readiness block and rejects omitted decisions", async () => {
    const gh = new IntakeGithub([issue(1, ["p2", "op:tier-quick"])]);
    const intake = await preparePlannerIssueIntake({ gh: gh as unknown as GhOps, app: "demo", turnId: "turn-parse" });
    const decisions = parsePlannerReadinessDecisions([
      "## Readiness decisions",
      "<!-- cormidia:planner-readiness-v1 -->",
      "```json",
      JSON.stringify({ schema_version: 1, decisions: [{ issue_number: 1, disposition: "ready", reason_code: "routine_ready", reason: "Complete." }] }),
      "```",
    ].join("\n"));
    expect(decisions).toHaveLength(1);
    await expect(applyPlannerReadinessDecisions({
      gh: gh as unknown as GhOps,
      intake,
      decisions: [],
    })).rejects.toThrow("Planner omitted readiness decision for #1");
  });

  it("uses the observed GitHub label on the next intake after interruption without applying twice", async () => {
    const gh = new IntakeGithub([issue(1, ["p2", "op:tier-quick"])]);
    let addCalls = 0;
    const originalAdd = gh.addLabel.bind(gh);
    gh.addLabel = async (number, label) => { addCalls += 1; await originalAdd(number, label); };
    const intake = await preparePlannerIssueIntake({ gh: gh as unknown as GhOps, app: "demo", turnId: "turn-crash" });
    const decision: PlannerReadinessDecision = {
      issue_number: 1,
      disposition: "ready",
      reason_code: "routine_ready",
      reason: "Complete.",
    };
    await expect(applyPlannerReadinessDecisions({
      gh: gh as unknown as GhOps,
      intake,
      decisions: [decision],
      fault: (boundary) => { if (boundary === "after_remote") throw new Error("simulated crash"); },
    })).rejects.toThrow("simulated crash");
    expect((await gh.readIssue(1)).labels).toContain("op:ready");

    const nextIntake = await preparePlannerIssueIntake({
      gh: gh as unknown as GhOps,
      app: "demo",
      turnId: "turn-after-crash",
    });
    const nextApplication = await applyPlannerReadinessDecisions({
      gh: gh as unknown as GhOps,
      intake: nextIntake,
      decisions: [],
    });
    expect(nextApplication.applied_issue_numbers).toEqual([]);
    expect(addCalls).toBe(1);
  });
});
