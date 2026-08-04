// CF-REG-244 — a suppressed critical operation is recorded and reaches the
// turn verdict.
//
// Provenance: august-org full e2e run, 2026-08-01, ticket #7. The Reviewer ran
// a negative control — build an intentionally invalid fixture, prove the gate
// fails on it, delete the fixture. The delete raised a
// `destructive-or-irreversible` approval that was never decided. The turn
// completed anyway and its PR merged at 09:40:59Z. The fail-closed denial was
// right; the SILENCE was not. Same class as #141: a green result whose
// supporting evidence vanished without trace.
//
// PURPOSE v2.15 (1) removed the original path (a denial now suspends rather
// than shipping past), which narrows this to exactly two reachable
// dispositions — and both must be recorded:
//   denied   the human decided against it; the turn resumed without it.
//   expired  nobody decided within the TTL; the turn resolved blocked with its
//            artifacts preserved (v2.15 (2)).
//
// Scope is the GATE/APPROVALS half only. "A verdict must not PASS when declared
// evidence is missing" is a policy decision about verdict integrity and belongs
// to #234; nothing here refuses a verdict.

import { afterEach, describe, expect, it } from "vitest";
import { renderReviewBody, renderSuppressedOperations } from "../../../src/loop/loop.js";
import type { ReviewVerdict } from "../../../src/loop/verdicts.js";
import { continueAfterApproval } from "../../../src/loop/claim-recovery.js";
import {
  readTicketClaimState,
  writeTicketClaimState,
} from "../../../src/loop/rehydrate.js";
import type { GhIssue, GhOps } from "../../../src/loop/github.js";
import { actionHash, ApprovalStore } from "../../../src/org/approvals.js";
import { releaseExpiredTicketApprovalClaim } from "../../../src/org/ticket-episode-approval.js";
import { raiseTurnBudgetEscalation, resumeCostEstimate } from "../../../src/org/budget.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const NEGATIVE_CONTROL_DELETE = {
  tool: "bash",
  input: { command: "rm -rf src/content/blog/__invalid-fixture" },
} as const;

const CLEAN_VERDICT: ReviewVerdict = {
  verdict: "approve",
  findings: [],
  review: {
    rationale: "The change is conformant and the gates are green.",
    evidence: [{ claim: "content gate fails closed", evidence: "astro check exit 1 on fixture" }],
    notReviewed: [],
  },
};

class FakeGh implements Pick<GhOps, "readIssue" | "swapLabel" | "addLabel"> {
  labels = ["op:blocked"];
  async readIssue(): Promise<GhIssue> {
    return { number: 7, title: "t", body: "", labels: [...this.labels], state: "open" } as GhIssue;
  }
  async swapLabel(_issue: number, from: string, to: string): Promise<void> {
    this.labels = this.labels.map((label) => (label === from ? to : label));
  }
  async addLabel(_issue: number, label: string): Promise<void> {
    this.labels.push(label);
  }
}

/** A ticket parked exactly as a gate escalation parks one, so the decision
 * paths under test run against real durable state rather than a stub. */
function plantParkedTicket(stateHome: string): void {
  writeTicketClaimState(stateHome, "app", 7, {
    claims: 1,
    outcomes: [],
    continuation: {
      pipeline: "episode-plan",
      pass: "review",
      role: "reviewer",
      session: { runtime: "claude", id: "reviewer-session" },
      completedPasses: [],
      contextFingerprint: "a".repeat(64),
      workFingerprint: "b".repeat(64),
      runId: "run-1",
      pausedAt: "2026-08-01T09:36:00.000Z",
      decisions: [],
      status: "waiting_approval",
      claimNumber: 1,
      pauseCount: 1,
      pauseCostUsd: 1.5,
      pauseKind: "approval",
    },
  });
}

describe("CF-REG-244 — suppression is recorded against the ticket", () => {
  const homes: TempStateHome[] = [];
  afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

  async function fixture(): Promise<{
    home: TempStateHome;
    store: ApprovalStore;
    gh: FakeGh;
  }> {
    const home = await makeTempStateHome({ name: "suppression" });
    homes.push(home);
    plantParkedTicket(home.stateHome);
    return { home, store: new ApprovalStore(home.stateHome), gh: new FakeGh() };
  }

  async function raiseNegativeControlDelete(store: ApprovalStore) {
    return store.raise({
      app: "app",
      role: "reviewer",
      rule: "destructive-or-irreversible",
      ticketRef: "#7",
      action: { ...NEGATIVE_CONTROL_DELETE },
      now: new Date("2026-08-01T09:36:00.000Z"),
    });
  }

  it("records a DENIED critical operation with its rule, action identity, and disposition", async () => {
    const { home, store, gh } = await fixture();
    const item = await raiseNegativeControlDelete(store);
    const decided = await store.decide(item.id, {
      decision: "denied",
      reason: "the fixture must not be deleted from the shared worktree",
      decidedBy: { kind: "human", identity: "operator" },
      // Inside the ratified 24h pending TTL: this case is about a DECIDED
      // denial, and letting wall-clock time expire it would silently test the
      // other disposition.
      now: new Date("2026-08-01T09:40:00.000Z"),
    });

    const outcome = await continueAfterApproval({
      root: home.stateHome,
      app: "app",
      issueNumber: 7,
      approvalId: decided.id,
      decision: "denied",
      reason: decided.reason!,
      suppression: {
        rule: decided.rule,
        actionSha256: actionHash(decided.action),
        tool: decided.action.tool,
      },
      gh: gh as unknown as GhOps,
    });

    // v2.15 (1): a denied CRITICAL OP resumes the turn without the operation.
    expect(outcome).toBe("resumed");
    const recorded = readTicketClaimState(home.stateHome, "app", 7).suppressed;
    expect(recorded).toEqual([
      {
        approvalId: decided.id,
        rule: "destructive-or-irreversible",
        actionSha256: actionHash(decided.action),
        tool: "bash",
        disposition: "denied",
        reason: "the fixture must not be deleted from the shared worktree",
        at: expect.any(String),
      },
    ]);
  });

  it("records an EXPIRED critical operation and releases the claim without consuming one", async () => {
    const { home, store, gh: _gh } = await fixture();
    const item = await raiseNegativeControlDelete(store);
    // One second past the ratified 24h default (v2.15 (2)).
    const observedAt = new Date("2026-08-02T09:36:01.000Z");
    const expired = await store.expirePendingItem(item.id, observedAt);
    expect(expired?.status).toBe("expired");

    expect(await releaseExpiredTicketApprovalClaim(home.stateHome, expired!, observedAt)).toBe(true);
    const state = readTicketClaimState(home.stateHome, "app", 7);
    expect(state.suppressed).toEqual([
      {
        approvalId: item.id,
        rule: "destructive-or-irreversible",
        actionSha256: actionHash(item.action),
        tool: "bash",
        disposition: "expired",
        reason: expect.any(String),
        at: expect.any(String),
      },
    ]);
    // The turn resolves blocked with artifacts preserved; expiry is not a merit
    // failure, so the claim count is untouched.
    expect(state.claims).toBe(1);
    expect(state.continuation).toBeUndefined();
  });

  it("records the suppression even when the raising turn is already gone", async () => {
    // The orphan case #244 was filed for: the approval outlived its requester,
    // so there is nothing to resume — but "no record" is the failure mode, not
    // an acceptable outcome.
    const home = await makeTempStateHome({ name: "suppression-orphan" });
    homes.push(home);
    const store = new ApprovalStore(home.stateHome);
    writeTicketClaimState(home.stateHome, "app", 7, { claims: 1, outcomes: [] });
    const item = await raiseNegativeControlDelete(store);
    const decided = await store.decide(item.id, {
      decision: "denied",
      reason: "the negative control must not delete from the shared worktree",
      decidedBy: { kind: "human", identity: "operator" },
      now: new Date("2026-08-01T09:40:00.000Z"),
    });

    const outcome = await continueAfterApproval({
      root: home.stateHome,
      app: "app",
      issueNumber: 7,
      approvalId: decided.id,
      decision: "denied",
      reason: decided.reason!,
      suppression: {
        rule: decided.rule,
        actionSha256: actionHash(decided.action),
        tool: decided.action.tool,
      },
      gh: new FakeGh() as unknown as GhOps,
    });

    expect(outcome).toBe("unparked");
    expect(readTicketClaimState(home.stateHome, "app", 7).suppressed).toMatchObject([
      { approvalId: decided.id, disposition: "denied" },
    ]);
  });

  it("converges rather than accumulating when expiry reconciliation runs repeatedly", async () => {
    const { home, store } = await fixture();
    const item = await raiseNegativeControlDelete(store);
    const observedAt = new Date("2026-08-02T09:36:01.000Z");
    const expired = (await store.expirePendingItem(item.id, observedAt))!;

    // Three call sites reconcile expiry (approvals CLI, dispatch, ticket
    // observation). Each must be idempotent.
    await releaseExpiredTicketApprovalClaim(home.stateHome, expired, observedAt);
    await releaseExpiredTicketApprovalClaim(home.stateHome, expired, observedAt);
    await releaseExpiredTicketApprovalClaim(home.stateHome, expired, observedAt);

    expect(readTicketClaimState(home.stateHome, "app", 7).suppressed).toHaveLength(1);
  });

  it("negative control: a BUDGET escalation suppresses nothing and deposits no record", async () => {
    const { home, store } = await fixture();
    const budget = await raiseTurnBudgetEscalation(home.stateHome, {
      app: "app",
      role: "builder",
      ticketRef: "#7",
      episodeId: "ticket:app:#7",
      runId: "run-1",
      pipeline: "episode-plan",
      pass: "implement",
      stop: {
        dimension: "equivalent_cost_usd",
        cap: 2,
        observed: 2,
        costMeasurement: "measured",
        episodeRemaining: 10,
      },
      spentUsd: 2,
      resume: resumeCostEstimate({
        tokensIn: 100_000,
        costUsd: 2,
        cacheReadTokens: 50_000,
        cacheCreationTokens: 30_000,
      }),
    }, new Date("2026-08-01T09:36:00.000Z"));
    const observedAt = new Date("2026-08-02T09:36:01.000Z");
    const expired = (await store.expirePendingItem(budget.id, observedAt))!;
    await releaseExpiredTicketApprovalClaim(home.stateHome, expired, observedAt);

    // A turn that ran out of money asked for no critical operation. Recording
    // one here would make the #244 record mean "something went wrong" instead
    // of "declared evidence is missing", and every verdict would carry noise.
    expect(readTicketClaimState(home.stateHome, "app", 7).suppressed).toBeUndefined();
  });
});

describe("CF-REG-244 — the turn verdict surfaces the suppression", () => {
  const entries = [{ pass: "review", verdict: CLEAN_VERDICT }];

  it("names the rule, disposition, action identity, and approval in the review body", () => {
    const body = renderReviewBody(entries, [
      {
        approvalId: "20260801T093600Z-uevo",
        rule: "destructive-or-irreversible",
        actionSha256: "c".repeat(64),
        tool: "bash",
        disposition: "denied",
        reason: "shared worktree",
        at: "2026-08-01T09:40:00.000Z",
      },
    ]);

    expect(body).toContain("## Suppressed critical operations");
    expect(body).toContain("destructive-or-irreversible (denied)");
    expect(body).toContain("action=cccccccccccc");
    expect(body).toContain("approval=20260801T093600Z-uevo");
    // The verdict itself is unchanged — this is a record, not a gate (#234
    // owns whether a verdict may still pass).
    expect(body).toContain("Verdict: approve");
  });

  it("surfaces an expired suppression as distinctly as a denied one", () => {
    const body = renderReviewBody(entries, [
      {
        approvalId: "20260801T093705Z-h7si",
        rule: "destructive-or-irreversible",
        actionSha256: "d".repeat(64),
        tool: "bash",
        disposition: "expired",
        at: "2026-08-02T09:36:01.000Z",
      },
    ]);
    expect(body).toContain("destructive-or-irreversible (expired)");
  });

  it("a turn with no suppression renders an EMPTY record, never a missing field", () => {
    const body = renderReviewBody(entries);
    // The heading is unconditional. Its absence would be indistinguishable from
    // an older verdict that never checked — the exact ambiguity #244 removes.
    expect(body).toContain("## Suppressed critical operations");
    expect(body).toContain("- None recorded.");
    expect(renderSuppressedOperations([])).toEqual([
      "## Suppressed critical operations",
      "- None recorded.",
    ]);
  });

  it("negative control: the pre-fix verdict shape fails the detector", () => {
    // What the 2026-08-01 run published: a complete-looking verdict with no
    // statement about the Reviewer's suppressed negative control.
    const preFix = [
      "Verdict: approve",
      "",
      "Passes:",
      "- review: approve",
      "",
      "## Not reviewed",
      "- None.",
    ].join("\n");
    expect(preFix).not.toContain("## Suppressed critical operations");
  });
});
