import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  beginTicketClaim,
  continueAfterApproval,
  executeTicketRearm,
  finishTicketClaim,
  markTicketClaimed,
  markTicketProviderStarted,
  planTicketRearm,
  recoverClaimException,
  recoverInterruptedClaims,
} from "../../src/loop/claim-recovery.js";
import { readTicketClaimState, writeTicketClaimState } from "../../src/loop/rehydrate.js";
import type { LoopContinuation, LoopItem } from "../../src/loop/types.js";
import { FakeGhOps } from "../support/fakeGhOps.js";

describe("claim recovery saga", () => {
  let root = "";
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function world(label = "op:ready") {
    root = mkdtempSync(join(tmpdir(), "operon-claim-recovery-"));
    return new FakeGhOps({ issues: [{ number: 7, title: "Recover", body: "body", labels: [label] }] });
  }

  it("keeps one claim across two approval pauses and records pause/repeat accounting", async () => {
    const gh = world();
    const first = await beginTicketClaim({ root, app: "app", issueNumber: 7, defaultAllowance: 3 });
    expect(first.lease).toBeDefined();
    expect(readTicketClaimState(root, "app", 7).claims).toBe(0);
    await markTicketClaimed({ root, app: "app", issueNumber: 7, claimId: first.lease!.claimId });
    await markTicketProviderStarted({ root, app: "app", issueNumber: 7, claimId: first.lease!.claimId });
    expect(readTicketClaimState(root, "app", 7).claims).toBe(1);

    const continuation1: LoopContinuation = {
      ...continuation("session-1", 1.25),
      assignment: { harness: "claude", model: "claude-exact", effort: "high" },
      planVersion: 2,
      planStepId: "implement",
    };
    await finishTicketClaim({
      root,
      app: "app",
      issueNumber: 7,
      claimId: first.lease!.claimId,
      item: blockedItem(continuation1),
    });
    await gh.swapLabel(7, "op:ready", "op:blocked");
    await continueAfterApproval({
      root,
      app: "app",
      issueNumber: 7,
      approvalId: "approval-1",
      decision: "approved",
      gh,
    });
    const resumed1 = await beginTicketClaim({ root, app: "app", issueNumber: 7, defaultAllowance: 3 });
    expect(resumed1.lease).toMatchObject({ claimNumber: 1, resume: true });
    expect(resumed1.lease!.continuation).toMatchObject({
      assignment: { harness: "claude", model: "claude-exact", effort: "high" },
      planVersion: 2,
      planStepId: "implement",
    });
    expect(resumed1.lease!.continuation!.decisions).toMatchObject([{ decision: "approved" }]);
    await markTicketProviderStarted({ root, app: "app", issueNumber: 7, claimId: resumed1.lease!.claimId });
    expect(readTicketClaimState(root, "app", 7).claims).toBe(1);

    const continuation2 = continuation("session-2", 0.75);
    await finishTicketClaim({
      root,
      app: "app",
      issueNumber: 7,
      claimId: resumed1.lease!.claimId,
      item: blockedItem(continuation2),
    });
    await gh.swapLabel(7, "op:ready", "op:blocked");
    await continueAfterApproval({
      root,
      app: "app",
      issueNumber: 7,
      approvalId: "approval-2",
      decision: "denied",
      reason: "use the reversible path",
      gh,
    });
    const resumed2 = await beginTicketClaim({ root, app: "app", issueNumber: 7, defaultAllowance: 3 });
    expect(resumed2.lease).toMatchObject({ claimNumber: 1, resume: true });
    expect(resumed2.lease!.continuation!.session.id).toBe("session-2");
    expect(resumed2.lease!.continuation!.decisions.at(-1)).toMatchObject({
      decision: "denied",
      reason: "use the reversible path",
    });
    const state = readTicketClaimState(root, "app", 7);
    expect(state.claims).toBe(1);
    expect(state.continuation).toMatchObject({ pauseCount: 2, pauseCostUsd: 2 });
    expect(state.events?.filter((event) => event.kind === "approval_paused")).toMatchObject([
      { costUsd: 1.25, repeatedCostUsd: 0 },
      { costUsd: 0.75, repeatedCostUsd: 0 },
    ]);
    expect(state.outcomes).toEqual([
      expect.stringContaining("claim 1: approval pause 1 at build/implement (cost $1.25, repeated $0.00"),
      expect.stringContaining("claim 1: approval pause 2 at build/implement (cost $0.75, repeated $0.00"),
    ]);
  });

  it("auto-recovers every pre-provider exception without consuming a claim", async () => {
    const gh = world();
    for (const detail of ["selection", "label", "pass selection", "episode lock", "pipeline start"]) {
      const begun = await beginTicketClaim({ root, app: "app", issueNumber: 7, defaultAllowance: 3 });
      if ((await gh.readIssue(7)).labels.includes("op:ready")) await gh.swapLabel(7, "op:ready", "op:building");
      await markTicketClaimed({ root, app: "app", issueNumber: 7, claimId: begun.lease!.claimId });
      const message = await recoverClaimException({
        root,
        app: "app",
        issueNumber: 7,
        claimId: begun.lease!.claimId,
        gh,
        error: new Error(detail),
      });
      expect(message).toContain("without consuming allowance");
      expect((await gh.readIssue(7)).labels).toContain("op:ready");
      expect(readTicketClaimState(root, "app", 7).claims).toBe(0);
    }

    const resumedReview = await beginTicketClaim({ root, app: "app", issueNumber: 7, defaultAllowance: 3 });
    await gh.swapLabel(7, "op:ready", "op:in-review");
    await markTicketClaimed({ root, app: "app", issueNumber: 7, claimId: resumedReview.lease!.claimId });
    await recoverClaimException({
      root,
      app: "app",
      issueNumber: 7,
      claimId: resumedReview.lease!.claimId,
      gh,
      error: new Error("review pipeline start"),
    });
    expect((await gh.readIssue(7)).labels).toContain("op:ready");
    expect(readTicketClaimState(root, "app", 7).claims).toBe(0);
  });

  it("returns post-provider ambiguity instead of blindly retrying", async () => {
    const gh = world();
    const begun = await beginTicketClaim({ root, app: "app", issueNumber: 7, defaultAllowance: 3 });
    await gh.swapLabel(7, "op:ready", "op:building");
    await markTicketProviderStarted({ root, app: "app", issueNumber: 7, claimId: begun.lease!.claimId });
    const message = await recoverClaimException({
      root,
      app: "app",
      issueNumber: 7,
      claimId: begun.lease!.claimId,
      gh,
      error: new Error("connection lost after tool writes"),
    });
    expect(message).toContain("explicit re-arm required");
    expect((await gh.readIssue(7)).labels).toContain("op:returned");
    expect(readTicketClaimState(root, "app", 7).claims).toBe(1);
  });

  it("reconciles orphaned pre-turn and paid claims differently on the next tick", async () => {
    const gh = world("op:building");
    writeTicketClaimState(root, "app", 7, {
      claims: 0,
      outcomes: [],
      active: {
        claimId: "dead-pre",
        claimNumber: 1,
        ownerPid: 999_999_999,
        acquiredAt: "2026-07-18T00:00:00Z",
        phase: "claimed",
        resume: false,
      },
    });
    const pre = await recoverInterruptedClaims({
      root,
      app: "app",
      gh,
      entries: [{ issueNumber: 7, state: readTicketClaimState(root, "app", 7) }],
    });
    expect(pre[0]).toContain("auto-rearmed");
    expect((await gh.readIssue(7)).labels).toContain("op:ready");

    await gh.swapLabel(7, "op:ready", "op:building");
    writeTicketClaimState(root, "app", 7, {
      claims: 1,
      outcomes: [],
      active: {
        claimId: "dead-paid",
        claimNumber: 1,
        ownerPid: 999_999_999,
        acquiredAt: "2026-07-18T00:00:00Z",
        phase: "provider_started",
        resume: false,
      },
    });
    const paid = await recoverInterruptedClaims({
      root,
      app: "app",
      gh,
      entries: [{ issueNumber: 7, state: readTicketClaimState(root, "app", 7) }],
    });
    expect(paid[0]).toContain("explicit re-arm required");
    expect((await gh.readIssue(7)).labels).toContain("op:returned");
  });

  it("previews, executes, crash-resumes, and replays an exact manual re-arm", async () => {
    const gh = world("op:returned");
    writeTicketClaimState(root, "app", 7, { claims: 3, outcomes: [], claimAllowance: 3 });
    const input = {
      root,
      app: "app",
      issueNumber: 7,
      reason: "reviewed provider ambiguity",
      actor: "human@example.com",
      priorAllowance: 3,
      intendedAllowance: 4,
      gh,
    };
    const preview = await planTicketRearm(input);
    expect(preview).toMatchObject({ replay: false, priorLabel: "op:returned" });
    const executed = await executeTicketRearm(input);
    expect(executed.rearmId).toBe(preview.rearmId);
    expect((await gh.readIssue(7)).labels).toContain("op:ready");
    expect(readTicketClaimState(root, "app", 7)).toMatchObject({
      claimAllowance: 4,
      rearms: [{ status: "completed" }],
    });
    await expect(executeTicketRearm(input)).resolves.toMatchObject({ replay: true });

    // Simulate a crash after durable preparation but before the label write.
    await gh.swapLabel(7, "op:ready", "op:returned");
    const recoveryInput = { ...input, priorAllowance: 4, intendedAllowance: 5, reason: "second reviewed recovery" };
    const recoveryPlan = await planTicketRearm(recoveryInput);
    const state = readTicketClaimState(root, "app", 7);
    writeTicketClaimState(root, "app", 7, {
      ...state,
      claimAllowance: 5,
      rearms: [
        ...(state.rearms ?? []),
        {
          rearmId: recoveryPlan.rearmId,
          app: "app",
          issueNumber: 7,
          reason: recoveryInput.reason,
          actor: recoveryInput.actor,
          priorAllowance: 4,
          intendedAllowance: 5,
          priorLabel: "op:returned",
          status: "prepared",
          preparedAt: "2026-07-18T00:00:00Z",
        },
      ],
    });
    await executeTicketRearm(recoveryInput);
    expect((await gh.readIssue(7)).labels).toContain("op:ready");
    expect(readTicketClaimState(root, "app", 7).rearms?.at(-1)?.status).toBe("completed");
  });

  it("refuses label-only misuse and stale allowance changes", async () => {
    const gh = world("op:ready");
    writeTicketClaimState(root, "app", 7, { claims: 3, outcomes: [], claimAllowance: 3 });
    const input = {
      root,
      app: "app",
      issueNumber: 7,
      reason: "try",
      actor: "operator",
      priorAllowance: 3,
      intendedAllowance: 4,
      gh,
    };
    await expect(planTicketRearm(input)).rejects.toThrow("label-only op:ready change cannot raise");
    await gh.swapLabel(7, "op:ready", "op:returned");
    await expect(planTicketRearm({ ...input, priorAllowance: 2 })).rejects.toThrow("stale --from-allowance");
  });

  it("refuses to bypass a pending approval with the manual allowance command", async () => {
    const gh = world("op:blocked");
    writeTicketClaimState(root, "app", 7, {
      claims: 1,
      outcomes: [],
      claimAllowance: 3,
      continuation: {
        ...continuation("pending", 1),
        status: "waiting_approval",
        claimNumber: 1,
        pauseCount: 1,
        pauseCostUsd: 1,
      },
    });
    await expect(planTicketRearm({
      root,
      app: "app",
      issueNumber: 7,
      reason: "bypass",
      actor: "operator",
      priorAllowance: 3,
      intendedAllowance: 4,
      gh,
    })).rejects.toThrow("operon approvals review");
  });
});

function continuation(sessionId: string, pauseCostUsd: number): LoopContinuation {
  return {
    pipeline: "build",
    pass: "implement",
    role: "builder",
    session: { runtime: "claude", id: sessionId },
    completedPasses: ["contract"],
    contextFingerprint: "context",
    workFingerprint: "work",
    runId: `run-${sessionId}`,
    pausedAt: "2026-07-18T00:00:00Z",
    decisions: [],
    pauseCostUsd,
  };
}

function blockedItem(exact: LoopContinuation): LoopItem {
  return {
    issueNumber: 7,
    ticketRef: "#7",
    title: "Recover",
    body: "body",
    targetRepo: "owner/repo",
    labels: ["op:blocked"],
    phase: "blocked",
    tier: "standard",
    cycles: 0,
    remediationAttempts: 0,
    gateResults: [],
    findings: [],
    continuation: exact,
  };
}
