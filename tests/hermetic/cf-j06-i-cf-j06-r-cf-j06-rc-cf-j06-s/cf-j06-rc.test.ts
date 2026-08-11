// Traceability: CF-J06-RC · HB-012 · contracts/journey-acceptance.md J-06 recovery criterion.

// CF-J06-RC — duplicate continuation attempt refused with the original
// outcome preserved (L2; HB-012; case-catalog §1 J-06; contracts/B-09a §4:
// "Continuation is keyed by (item, claim, session); a duplicate continuation
// attempt is detected and refused with the original outcome preserved").
//
// Two duplicate shapes, both through the REAL claim-recovery saga
// (src/loop/claim-recovery.ts) with GitHub behind the gh process double:
// a replayed decision under the same approval id carrying a CONFLICTING
// outcome, and a second concurrent resume against a live lease. The family's
// detector (unique decision per approval id, original outcome kept) proves it
// fires against a seeded forged duplicate (negative-control rule).

import { afterEach, describe, expect, it } from "vitest";
import { beginTicketClaim, continueAfterApproval } from "../../../src/loop/claim-recovery.js";
import { GhCliOps } from "../../../src/loop/github.js";
import { readTicketClaimState, writeTicketClaimState, type TicketClaimState } from "../../../src/loop/rehydrate.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import {
  APP,
  DEFAULT_BRANCH,
  OP_LABELS,
  PAUSED_SESSION_ID,
  pauseTicketAtApproval,
  syntheticContinuation,
} from "./resume-rig.js";

const APPROVAL_ID = "appr-cf-j06-rc-1";

// ---------------------------------------------------------------------------
// Family detector (kept local: test files do not import from sibling tests)
// ---------------------------------------------------------------------------

class DuplicateContinuationDecisionViolation extends Error {
  constructor(approvalId: string, outcomes: readonly string[]) {
    super(
      `B-09a §4 violated: continuation decision ${approvalId} recorded ${outcomes.length} times ` +
        `(${outcomes.join(", ")}) — a duplicate continuation attempt must be refused with the ` +
        "original outcome preserved",
    );
    this.name = "DuplicateContinuationDecisionViolation";
  }
}

function detectDuplicateContinuationDecisions(state: TicketClaimState): void {
  const seen = new Map<string, string[]>();
  for (const decision of state.continuation?.decisions ?? []) {
    const outcomes = seen.get(decision.approvalId) ?? [];
    outcomes.push(decision.decision);
    seen.set(decision.approvalId, outcomes);
    if (outcomes.length > 1) {
      throw new DuplicateContinuationDecisionViolation(decision.approvalId, outcomes);
    }
  }
}

interface PausedWalk {
  state: TempStateHome;
  handle: GithubDoubleHandle;
  gh: GhCliOps;
  issueNumber: number;
}

describe("CF-J06-RC — duplicate continuation attempt refused with original outcome preserved (L2, HB-012)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function pausedWalk(): Promise<PausedWalk> {
    const state = await makeTempStateHome({ name: "cf-j06-rc-org" });
    cleanups.push(() => state.cleanup());
    const handle = await installGithubDouble({
      defaultBranch: DEFAULT_BRANCH,
      labels: [...OP_LABELS],
    });
    cleanups.push(() => handle.dispose());
    const gh = new GhCliOps(handle.repo, handle.exec);
    const issue = await gh.createIssue({
      title: "cf-j06-rc paused ticket",
      body: "## Goal\nDuplicate-continuation walk.\n",
      labels: ["op:blocked"],
    });
    await pauseTicketAtApproval({
      root: state.stateHome,
      issueNumber: issue.number,
      continuation: syntheticContinuation([]),
      targetRepo: handle.repo,
    });
    return { state, handle, gh, issueNumber: issue.number };
  }

  it("a replayed decision under the same approval id with a CONFLICTING outcome is refused; the original outcome survives", async () => {
    const walk = await pausedWalk();
    const root = walk.state.stateHome;

    await continueAfterApproval({
      root,
      app: APP,
      issueNumber: walk.issueNumber,
      approvalId: APPROVAL_ID,
      decision: "approved",
      decidedAt: "2026-07-31T12:30:00.000Z",
      gh: walk.gh,
    });
    const original = readTicketClaimState(root, APP, walk.issueNumber);
    const originalEventCount = (original.events ?? []).length;
    expect(original.continuation?.decisions).toEqual([
      { approvalId: APPROVAL_ID, decision: "approved", decidedAt: "2026-07-31T12:30:00.000Z" },
    ]);

    // Duplicate continuation attempt: same approval id, CONFLICTING outcome.
    await continueAfterApproval({
      root,
      app: APP,
      issueNumber: walk.issueNumber,
      approvalId: APPROVAL_ID,
      decision: "denied",
      reason: "replayed conflicting duplicate",
      decidedAt: "2026-07-31T12:40:00.000Z",
      gh: walk.gh,
    });

    const after = readTicketClaimState(root, APP, walk.issueNumber);
    // Refused: exactly the ORIGINAL decision, original outcome, original
    // timestamp; the conflicting replay left no trace in the decision set.
    expect(after.continuation?.decisions).toEqual([
      { approvalId: APPROVAL_ID, decision: "approved", decidedAt: "2026-07-31T12:30:00.000Z" },
    ]);
    expect(after.continuation).toMatchObject({ status: "ready", claimNumber: 1 });
    // No second decision event was appended for the duplicate.
    expect((after.events ?? []).length).toBe(originalEventCount);
    // The family detector stays green on the refused duplicate.
    expect(() => detectDuplicateContinuationDecisions(after)).not.toThrow();
  });

  it("a second concurrent resume against a live lease is refused; the original lease and continuation survive untouched", async () => {
    const walk = await pausedWalk();
    const root = walk.state.stateHome;
    await continueAfterApproval({
      root,
      app: APP,
      issueNumber: walk.issueNumber,
      approvalId: APPROVAL_ID,
      decision: "approved",
      decidedAt: "2026-07-31T12:30:00.000Z",
      gh: walk.gh,
    });

    const first = await beginTicketClaim({
      root,
      app: APP,
      issueNumber: walk.issueNumber,
      defaultAllowance: 3,
    });
    expect(first.allowed).toBe(true);
    expect(first.lease?.resume).toBe(true);
    expect(first.lease?.claimNumber).toBe(1);

    // Duplicate continuation attempt while the first holds the claim: refused.
    await expect(
      beginTicketClaim({ root, app: APP, issueNumber: walk.issueNumber, defaultAllowance: 3 }),
    ).rejects.toThrow(/already has active claim/);

    // The original outcome is preserved: same lease, same claim number, same
    // exact session, decision set untouched — the (item, claim, session) key
    // still names the first attempt (B-09a §4).
    const state = readTicketClaimState(root, APP, walk.issueNumber);
    expect(state.active?.claimId).toBe(first.lease!.claimId);
    expect(state.active).toMatchObject({ claimNumber: 1, resume: true });
    expect(state.claims).toBe(1);
    expect(state.continuation?.session).toEqual({ runtime: "claude", id: PAUSED_SESSION_ID });
    expect(state.continuation?.decisions).toEqual([
      { approvalId: APPROVAL_ID, decision: "approved", decidedAt: "2026-07-31T12:30:00.000Z" },
    ]);
  });

  it("negative control: a forged duplicate decision written past the guard makes the detector FIRE", async () => {
    const walk = await pausedWalk();
    const root = walk.state.stateHome;
    await continueAfterApproval({
      root,
      app: APP,
      issueNumber: walk.issueNumber,
      approvalId: APPROVAL_ID,
      decision: "approved",
      decidedAt: "2026-07-31T12:30:00.000Z",
      gh: walk.gh,
    });

    // Seeded violation: bypass continueAfterApproval's dedup guard and write
    // the same approval id twice with conflicting outcomes directly.
    const state = readTicketClaimState(root, APP, walk.issueNumber);
    const forged: TicketClaimState = {
      ...state,
      continuation: {
        ...state.continuation!,
        decisions: [
          ...state.continuation!.decisions,
          {
            approvalId: APPROVAL_ID,
            decision: "denied",
            reason: "forged conflicting duplicate",
            decidedAt: "2026-07-31T12:41:00.000Z",
          },
        ],
      },
    };
    writeTicketClaimState(root, APP, walk.issueNumber, forged);

    const reread = readTicketClaimState(root, APP, walk.issueNumber);
    expect(reread.continuation?.decisions).toHaveLength(2);
    expect(() => detectDuplicateContinuationDecisions(reread)).toThrow(DuplicateContinuationDecisionViolation);
  });
});
