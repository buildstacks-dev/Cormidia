// CF-INV-ACC-7a (L1/L2) — supervisor non-participation, reconciled three ways.
//
// The hand-authored-commit control runs against a REAL temp git repository,
// because the property under test is an authorship fact git owns. Everything
// else composes with it: a scenario whose reconciliation does not close reports
// `ungraded`/`incomplete` rather than a score, which is the only honest
// response when every score in it might be measuring the supervisor.

import { afterEach, describe, expect, it } from "vitest";
import {
  readScenarioCommits,
  reconcileSupervisorNonParticipation,
  type InvocationAuditRow,
  type JournalTurnRecord,
  type ProductAffectingAction,
  type ScenarioCommit,
} from "../../campaign/acceptance/supervisor-reconciliation.js";
import { scenarioCompleteness } from "../../campaign/acceptance/verdict-algebra.js";
import { CORMIDIA_TURN_IDENTITY, makeFixtureScenarioRepo } from "../../fixtures/acceptance/scenario-repo.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const AUDIT: InvocationAuditRow[] = [
  { invocationId: "cli-1", command: "cormidia dispatch" },
  { invocationId: "cli-2", command: "cormidia loop" },
];
const TURNS: JournalTurnRecord[] = [
  { turnId: "turn-plan", invocationId: "cli-1", role: "planner" },
  { turnId: "turn-build", invocationId: "cli-2", role: "builder" },
];
const ACTIONS: ProductAffectingAction[] = [
  { id: "pr-4", kind: "pull-request", invocationId: "cli-2" },
  { id: "branch-a", kind: "branch", invocationId: "cli-2" },
];

function reconcile(overrides: Partial<Parameters<typeof reconcileSupervisorNonParticipation>[0]> = {}) {
  return reconcileSupervisorNonParticipation({
    scenarioId: "S-ACC-1",
    turnIdentities: [CORMIDIA_TURN_IDENTITY],
    commits: [],
    journalTurns: TURNS,
    invocationAudit: AUDIT,
    actions: ACTIONS,
    ...overrides,
  });
}

describe("CF-INV-ACC-7a reconciliation over a real scenario repository", () => {
  it("closes when every commit carries a Cormidia turn identity", async () => {
    const fixture = await makeFixtureScenarioRepo({ kind: "greenfield" });
    cleanups.push(fixture.cleanup);
    const commits = readScenarioCommits((args) => fixture.repo.git(args));
    expect(commits.length).toBeGreaterThan(0);

    const outcome = reconcile({ commits });
    expect(outcome.closed).toBe(true);
    expect(outcome.forcedOutcome).toBe("score-permitted");
    expect(outcome.checked.commits).toBe(commits.length);
  });

  it("negative control: a hand-authored commit pushed to a scenario repo fires", async () => {
    const fixture = await makeFixtureScenarioRepo({
      kind: "greenfield",
      handAuthoredCommit: { path: "src/patch.txt", contents: "fixed the build by hand\n" },
    });
    cleanups.push(fixture.cleanup);
    const commits = readScenarioCommits((args) => fixture.repo.git(args));

    const outcome = reconcile({ commits });
    expect(outcome.closed).toBe(false);
    expect(outcome.violations.map((violation) => violation.code)).toContain("commit-outside-turn-identity");
    expect(outcome.violations[0]?.detail).toContain("supervisor@example.invalid");
  });

  it("a non-closing reconciliation forces ungraded/incomplete, never a score", async () => {
    const fixture = await makeFixtureScenarioRepo({
      kind: "seeded-corpus",
      handAuthoredCommit: { path: "docs/07-webhooks.md", contents: "# rewritten by hand\n" },
    });
    cleanups.push(fixture.cleanup);
    const outcome = reconcile({ commits: readScenarioCommits((args) => fixture.repo.git(args)) });
    expect(outcome.forcedOutcome).toBe("ungraded-and-incomplete");

    // The consequence, spelled out against the verdict algebra: a scenario that
    // cannot be scored is incomplete, and its axes are ungraded rather than 0.
    const completeness = scenarioCompleteness({
      results: [
        {
          axis: "O-4",
          score: "ungraded",
          justification: null,
          citations: [],
          ungradedReason: "reconciliation-open",
          verdict: "inconclusive",
        },
      ],
    });
    expect(completeness.completeness).toBe("incomplete");
    expect(completeness.reasons).toContain("ungraded:O-4:reconciliation-open");
  });
});

describe("CF-INV-ACC-7a the other two escape routes", () => {
  const cormidiaCommits: ScenarioCommit[] = [{ sha: "abc123", author: CORMIDIA_TURN_IDENTITY }];

  it("negative control: a product-affecting action with no invocation-audit row fires", () => {
    const outcome = reconcile({
      commits: cormidiaCommits,
      actions: [...ACTIONS, { id: "issue-9", kind: "issue" }],
    });
    expect(outcome.closed).toBe(false);
    const violation = outcome.violations.find((candidate) => candidate.code === "action-without-invocation-row");
    expect(violation?.subject).toBe("issue-9");
    expect(violation?.detail).toContain("not performed by the binaries");
  });

  it("negative control: an action citing an invocation id that does not exist fires", () => {
    const outcome = reconcile({
      commits: cormidiaCommits,
      actions: [{ id: "pr-9", kind: "pull-request", invocationId: "cli-ghost" }],
    });
    expect(outcome.violations.map((violation) => violation.code)).toEqual(["action-without-invocation-row"]);
  });

  it("negative control: a provider SDK call inside the campaign's own process fires", () => {
    const outcome = reconcile({ commits: cormidiaCommits, providerCallsInCampaignProcess: 1 });
    expect(outcome.violations.map((violation) => violation.code)).toEqual(["provider-call-in-campaign-process"]);
    expect(outcome.violations[0]?.detail).toContain("grading is itself a Cormidia-invoked turn");
  });

  it("negative control: a journal turn with no invocation row fires", () => {
    const outcome = reconcile({
      commits: cormidiaCommits,
      journalTurns: [...TURNS, { turnId: "turn-ghost", invocationId: "cli-missing", role: "reviewer" }],
    });
    expect(outcome.violations.map((violation) => violation.code)).toContain("turn-without-invocation-row");
  });

  it("reports every violation rather than stopping at the first", () => {
    const outcome = reconcile({
      commits: [{ sha: "deadbee", author: "Supervising Agent <supervisor@example.invalid>" }],
      actions: [{ id: "issue-9", kind: "issue" }],
      providerCallsInCampaignProcess: 2,
    });
    expect(new Set(outcome.violations.map((violation) => violation.code))).toEqual(
      new Set(["commit-outside-turn-identity", "action-without-invocation-row", "provider-call-in-campaign-process"]),
    );
  });
});
