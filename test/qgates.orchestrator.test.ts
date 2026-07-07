// Data gates and tier orchestrator (build plan M4.5): completeness,
// review-freshness, policy gate ordering, and remediation attempt caps.

import { afterAll, describe, expect, it } from "vitest";
import type { Policy } from "../src/loop/policy.js";
import {
  runCompletenessGate,
  runGates,
  runReviewFreshnessGate,
  type AcceptanceCriterion,
  type CriterionTestMap,
} from "../src/loop/qgates.js";
import { makeWorkingRepo, type WorkingRepoFixture } from "./fixtures/gitRepo.js";

const repos: WorkingRepoFixture[] = [];
function repo(): WorkingRepoFixture {
  const r = makeWorkingRepo();
  repos.push(r);
  return r;
}

afterAll(() => {
  for (const r of repos) r.cleanup();
});

const policy: Policy = {
  riskTiers: { high: [], medium: [], low: [] },
  gates: {
    high: ["tests", "lint", "security", "completeness"],
    medium: ["tests", "lint", "completeness"],
    low: ["tests", "completeness"],
  },
  dimensionGlobs: {},
  remediation: { maxAttempts: 2 },
};

const checkedCriteria: AcceptanceCriterion[] = [
  { id: "AC1", text: "the feature is covered", checked: true },
];
const coveringTests: CriterionTestMap = { AC1: ["unit:feature"] };
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const passCommand = `${shellQuote(process.execPath)} -e ${shellQuote("process.exit(0)")}`;

describe("runCompletenessGate", () => {
  it("unchecked criterion fails", () => {
    const result = runCompletenessGate(
      [{ id: "AC1", text: "wire the endpoint", checked: false }],
      [],
      { AC1: ["unit:endpoint"] },
    );

    expect(result.status).toBe("fail");
    expect(result.outputTail).toContain("unchecked criterion AC1");
  });

  it("unresolved finding fails", () => {
    const result = runCompletenessGate(checkedCriteria, [
      { id: "F1", description: "missing regression coverage", resolved: false },
    ], coveringTests);

    expect(result.status).toBe("fail");
    expect(result.outputTail).toContain("unresolved finding F1");
  });

  it("criterion with no covering test in the contract mapping fails", () => {
    const result = runCompletenessGate(checkedCriteria, [], {});

    expect(result.status).toBe("fail");
    expect(result.outputTail).toContain("criterion AC1 has no covering test");
  });
});

describe("runReviewFreshnessGate", () => {
  it("stale approval fails freshness", () => {
    const r = repo();
    const approved = r.head();
    r.commit("change after approval", { "src/app.ts": "export const value = 1;\n" });

    const result = runReviewFreshnessGate(r.root, { approvedCommitId: approved });

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("does not match approved commit");
  });
});

describe("runGates", () => {
  it("freshness runs even at low tier", async () => {
    const r = repo();

    const result = await runGates("low", r.root, checkedCriteria, [], { approvedCommitId: r.head() }, {
      policy,
      commands: { testCommand: passCommand },
      criterionTests: coveringTests,
    });

    expect(result.status).toBe("pass");
    expect(result.results.map((g) => g.gate)).toEqual([
      "tests",
      "completeness",
      "review-freshness",
    ]);
  });

  it("medium tier skips security per defaults", async () => {
    const r = repo();
    const base = r.head();
    r.commit("add secret-like medium change", {
      "src/app.ts": `export const key = "sk-${"c3".repeat(20)}";\n`,
    });
    const head = r.head();

    const result = await runGates(
      "medium",
      r.root,
      checkedCriteria,
      [],
      { approvedCommitId: head },
      {
        policy,
        commands: { testCommand: passCommand, lintCommand: passCommand },
        criterionTests: coveringTests,
        diff: { baseRef: base, headRef: head },
      },
    );

    expect(result.status).toBe("pass");
    expect(result.results.map((g) => g.gate)).toEqual([
      "tests",
      "lint",
      "completeness",
      "review-freshness",
    ]);
  });

  it("runs the setup command first, before any scheduled gate", async () => {
    const r = repo();

    const result = await runGates("low", r.root, checkedCriteria, [], { approvedCommitId: r.head() }, {
      policy,
      commands: { setupCommand: passCommand, testCommand: passCommand },
      criterionTests: coveringTests,
    });

    expect(result.status).toBe("pass");
    expect(result.results.map((g) => g.gate)).toEqual([
      "setup",
      "tests",
      "completeness",
      "review-freshness",
    ]);
  });

  it("a failing setup short-circuits: scheduled gates never run", async () => {
    const r = repo();
    const failCommand = `${shellQuote(process.execPath)} -e ${shellQuote(
      "console.error('npm ERR! eslint not installed'); process.exit(1)",
    )}`;

    const result = await runGates("low", r.root, checkedCriteria, [], { approvedCommitId: r.head() }, {
      policy,
      commands: { setupCommand: failCommand, testCommand: passCommand },
      criterionTests: coveringTests,
    });

    expect(result.status).toBe("fail");
    // Only the setup failure is reported — tests/completeness/freshness are skipped
    // because their prerequisites (installed deps) are absent.
    expect(result.results.map((g) => g.gate)).toEqual(["setup"]);
    expect(result.results[0]!.outputTail).toContain("eslint not installed");
  });

  it("attempt counter stops at max_attempts", async () => {
    const r = repo();

    const result = await runGates(
      "low",
      r.root,
      [{ id: "AC1", text: "still unchecked", checked: false }],
      [],
      { approvedCommitId: r.head() },
      {
        policy,
        commands: { testCommand: passCommand },
        criterionTests: coveringTests,
        currentAttempt: 2,
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.remediation).toMatchObject({
      currentAttempt: 2,
      maxAttempts: 2,
      attemptsRemaining: 0,
      canRetry: false,
      exhausted: true,
    });
  });
});
