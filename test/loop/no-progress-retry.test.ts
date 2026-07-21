// ISSUE-029, third mechanism: bounded retry must stop when it stops making
// progress.
//
// The live run spent three builder attempts and $10.24 on a
// `[ERROR] duplicated mapping key (4:1)` that was byte-identical every time —
// every mechanical fix attempt began by invoking the tool the corrupted file had
// already disabled, so no attempt reached the thing it meant to change. A retry
// budget is for progress; repeating one error is not progress.
//
// The bar is deliberately conservative: identical error *identity*, never merely
// "failed again". Both directions are covered here — the escalation, and the
// near-miss where two attempts fail with *different* errors and the budget is
// spent normally.
//
// Deterministic and offline: real subprocesses in temp git repos, FakeGhOps for
// the GitHub half, no provider turn, no network, no live clock.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { baseRevisionForBranch } from "../../src/loop/default-branch.js";
import { advanceGates, claimTicket } from "../../src/loop/loop.js";
import type { Policy } from "../../src/loop/policy.js";
import {
  gateFailureIdentity,
  runGates,
  type AcceptanceCriterion,
  type CriterionTestMap,
  type GateResult,
} from "../../src/loop/qgates.js";
import { makeBareWithClone, makeWorkingRepo, type WorkingRepoFixture } from "../fixtures/gitRepo.js";
import { FakeGhOps } from "../support/fakeGhOps.js";

const repos: WorkingRepoFixture[] = [];
function worktree(): string {
  const repo = makeWorkingRepo();
  repos.push(repo);
  return repo.root;
}
afterAll(() => {
  for (const repo of repos) repo.cleanup();
});

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const node = (script: string) => `${shellQuote(process.execPath)} -e ${shellQuote(script)}`;

const BODY = ["## Goal", "Ship a small fixture change.", "", "## Acceptance criteria", "- [x] fixture gates pass", ""].join("\n");
const CRITERIA: AcceptanceCriterion[] = [{ id: "AC1", text: "fixture gates pass", checked: true }];
const CRITERION_TESTS: CriterionTestMap = { AC1: ["fixture-gate"] };

function policy(maxAttempts: number): Policy {
  return {
    riskTiers: { high: [], medium: [], low: [] },
    gates: { high: ["tests", "completeness"], medium: ["tests", "completeness"], low: ["tests", "completeness"] },
    dimensionGlobs: {},
    remediation: { maxAttempts },
  };
}

// ---------------------------------------------------------------------------
// The identity itself
// ---------------------------------------------------------------------------

function failing(overrides: Partial<GateResult> = {}): GateResult[] {
  return [
    {
      gate: "setup",
      status: "fail",
      detail: "setup failed (exit 1)",
      outputTail: "[ERROR] duplicated mapping key (4:1)",
      durationMs: 12,
      ...overrides,
    },
  ];
}

describe("gateFailureIdentity", () => {
  it("is stable across runs of the same failure and ignores duration", () => {
    expect(gateFailureIdentity(failing({ durationMs: 12 }))).toBe(
      gateFailureIdentity(failing({ durationMs: 9_999 })),
    );
  });

  it("differs when the evidence differs — the near-miss", () => {
    expect(gateFailureIdentity(failing())).not.toBe(
      gateFailureIdentity(failing({ outputTail: "[ERROR] missing script: build" })),
    );
  });

  it("is undefined for a passing run", () => {
    expect(gateFailureIdentity([{ gate: "tests", status: "pass", detail: "ok", durationMs: 1 }])).toBeUndefined();
  });

  it("is undefined for a bare exit code with no evidence — 'failed again' is not an identity", () => {
    // A command like `test -f pass.txt` fails silently. Two silent exit-1s say
    // nothing about whether the cause is the same, so they must never cut a
    // legitimate retry budget short.
    expect(
      gateFailureIdentity([
        { gate: "tests", status: "fail", detail: "tests failed (exit 1)", exitCode: 1, durationMs: 3 },
      ]),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runGates
// ---------------------------------------------------------------------------

describe("runGates no-progress detection", () => {
  const tierPolicy = policy(3);

  async function attempt(root: string, command: string, previousFailureIdentity?: string) {
    const head = "0".repeat(40);
    return runGates(
      "low",
      root,
      [{ id: "AC1", text: "covered", checked: true }],
      [],
      { approvedCommitId: head, headCommitId: head },
      {
        policy: tierPolicy,
        commands: { testCommand: command },
        criterionTests: { AC1: ["unit:covered"] },
        currentAttempt: 1,
        ...(previousFailureIdentity !== undefined ? { previousFailureIdentity } : {}),
      },
    );
  }

  it("a second identical failure blocks instead of consuming the remaining attempts", async () => {
    const root = worktree();
    const command = node("console.error('[ERROR] duplicated mapping key (4:1)'); process.exit(1)");

    const first = await attempt(root, command);
    expect(first.status).toBe("fail");
    expect(first.remediation).toMatchObject({ canRetry: true, exhausted: false, noProgress: false });
    expect(first.remediation.failureIdentity).toBeDefined();

    const second = await attempt(root, command, first.remediation.failureIdentity);

    expect(second.remediation.noProgress).toBe(true);
    expect(second.remediation.canRetry).toBe(false);
    expect(second.status).toBe("blocked");
    // Attempts were NOT exhausted — the budget was stopped, not spent.
    expect(second.remediation.exhausted).toBe(false);
    expect(second.remediation.attemptsRemaining).toBe(2);
  });

  it("a second DIFFERENT failure still consumes attempts normally — the near-miss", async () => {
    const root = worktree();

    const first = await attempt(root, node("console.error('assertion A failed'); process.exit(1)"));
    const second = await attempt(
      root,
      node("console.error('assertion B failed'); process.exit(1)"),
      first.remediation.failureIdentity,
    );

    expect(second.remediation.noProgress).toBe(false);
    expect(second.remediation.canRetry).toBe(true);
    expect(second.status).toBe("fail");
  });

  it("without a previous identity nothing is ever reported as no-progress", async () => {
    const result = await attempt(worktree(), node("console.error('boom'); process.exit(1)"));

    expect(result.remediation.noProgress).toBe(false);
    expect(result.remediation.canRetry).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// advanceGates — the loop that actually spends the budget
// ---------------------------------------------------------------------------

describe("advanceGates no-progress escalation", () => {
  it("an identical second failure escalates instead of spending attempt three", async () => {
    const pair = makeBareWithClone();
    try {
      const gh = new FakeGhOps({
        cloneRoot: pair.clone.root,
        issues: [{ number: 1, title: "Gate No Progress", body: BODY, labels: ["op:ready"] }],
      });
      const claimed = await claimTicket(await gh.readIssue(1), {
        gh,
        targetRepo: "fixture/repo",
        base: baseRevisionForBranch("main"),
        localRepo: pair.clone.root,
        worktreeRoot: join(pair.root, "worktrees"),
      });
      commit(claimed.worktree as string, "feat: start change", { "src/change.ts": "x\n" });

      let remediations = 0;
      const returned = await advanceGates(claimed, {
        gh,
        base: baseRevisionForBranch("main"),
        policy: policy(3),
        // The corrupted-worktree shape: the command dies with the same message
        // however many times it is run, because nothing the fix pass does
        // reaches it.
        commands: { testCommand: "echo '[ERROR] duplicated mapping key (4:1)' >&2; exit 1" },
        criteria: CRITERIA,
        criterionTests: CRITERION_TESTS,
        remediate: (current) => {
          remediations++;
          commit(current.worktree as string, `fix: attempt ${remediations}`, {
            [`attempt-${remediations}.txt`]: "tried\n",
          });
        },
      });

      expect(returned.phase).toBe("returned");
      // Exactly one remediation ran: the second gate run proved it made no
      // progress, so attempts two and three were never bought.
      expect(remediations).toBe(1);
      expect(returned.remediationAttempts).toBe(1);
      const comment = gh.issueComments.get(1)?.[0] ?? "";
      expect(comment).toContain("no progress");
      expect(comment).toContain("identical error");
      // The real cause travels with the escalation, verbatim.
      expect(comment).toContain("duplicated mapping key (4:1)");
      expect(returned.gateResults.at(-1)?.remediation).toMatchObject({
        noProgress: true,
        canRetry: false,
        exhausted: false,
      });
    } finally {
      pair.cleanup();
    }
  });

  it("near-miss: two failures with DIFFERENT errors still consume attempts normally", async () => {
    const pair = makeBareWithClone();
    try {
      const gh = new FakeGhOps({
        cloneRoot: pair.clone.root,
        issues: [{ number: 1, title: "Gate Different Errors", body: BODY, labels: ["op:ready"] }],
      });
      let item = await claimTicket(await gh.readIssue(1), {
        gh,
        targetRepo: "fixture/repo",
        base: baseRevisionForBranch("main"),
        localRepo: pair.clone.root,
        worktreeRoot: join(pair.root, "worktrees"),
      });
      commit(item.worktree as string, "feat: start change", { "src/change.ts": "x\n" });

      // Each run reports a different failing assertion, then the third passes —
      // ordinary progress, and the budget must not be cut short.
      let remediations = 0;
      item = await advanceGates(item, {
        gh,
        base: baseRevisionForBranch("main"),
        policy: policy(3),
        commands: {
          testCommand:
            "n=$(ls attempt-*.txt 2>/dev/null | wc -l | tr -d ' '); " +
            "if [ -f pass.txt ]; then exit 0; fi; " +
            'echo "FAIL: assertion $n failed" >&2; exit 1',
        },
        criteria: CRITERIA,
        criterionTests: CRITERION_TESTS,
        remediate: (current) => {
          remediations++;
          const files =
            remediations === 2
              ? { "pass.txt": "ok\n" }
              : { [`attempt-${remediations}.txt`]: "still failing\n" };
          commit(current.worktree as string, `fix: remediation ${remediations}`, files);
        },
      });

      expect(item.phase).toBe("reviewing");
      expect(remediations).toBe(2);
      expect(item.remediationAttempts).toBe(2);
    } finally {
      pair.cleanup();
    }
  });
});

/** Commit into a ticket worktree with a fixed identity, so the result does not
 *  depend on the developer's ~/.gitconfig (mirrors test/loop.test.ts). */
function commit(tree: string, message: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(tree, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  for (const args of [["add", "-A"], ["commit", "-m", message]]) {
    execFileSync("git", args, {
      cwd: tree,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Operon Test",
        GIT_AUTHOR_EMAIL: "test@operon.invalid",
        GIT_COMMITTER_NAME: "Operon Test",
        GIT_COMMITTER_EMAIL: "test@operon.invalid",
        GIT_TERMINAL_PROMPT: "0",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
  }
}
