// CF-J06-S — approve AND deny both resume the same session/claim with
// guidance (L2; HB-012; case-catalog §1 J-06; contracts/B-09a §2: "Approved
// and denied decisions both continue the SAME native session as distinct
// guidance — a denial is contextual input to the same pass, not a restart";
// INV-005: claim number stable across pauses).
//
// Seam A drives the REAL executor (src/loop/pipeline.ts) with a continuation
// whose fingerprints come from a real capture run's durable record; the
// scripted claude double proves the orchestrator requested the EXACT parked
// session and delivered the decision as guidance. Seam B walks the REAL
// claim-recovery saga (src/loop/claim-recovery.ts) + approval continuation
// (continueAfterApproval) against the gh process double, then feeds the
// resulting lease continuation back through the executor — the full
// pause → decide → resume composition across both seams.

import { afterEach, describe, expect, it } from "vitest";
import {
  beginTicketClaim,
  continueAfterApproval,
  finishTicketClaim,
  markTicketClaimed,
  markTicketProviderStarted,
} from "../../../src/loop/claim-recovery.js";
import { GhCliOps } from "../../../src/loop/github.js";
import { readTicketClaimState } from "../../../src/loop/rehydrate.js";
import type { LoopContinuationDecision } from "../../../src/loop/types.js";
import { ClaudeSessionResumeMismatchError } from "../../../src/runtime/adapters/claude.js";
import {
  claudeDouble,
  doubleRole,
  doubleTurnRequest,
} from "../../fixtures/adapters/claude-double.js";
import {
  AdapterContractViolation,
  checkSessionIdentityHonest,
  script,
} from "../../fixtures/adapters/scenario.js";
import { installGithubDouble } from "../../fixtures/github-double/install.js";
import { makeTempStateHome } from "../../fixtures/state-home.js";
import {
  ACT_PASS,
  APP,
  DEFAULT_BRANCH,
  OP_LABELS,
  PAUSED_SESSION_ID,
  PIPELINE_NAME,
  ROLE_NAME,
  blockedLoopItem,
  makeResumeRig,
  pauseTicketAtApproval,
  syntheticContinuation,
  type ResumeRig,
} from "./resume-rig.js";

const APPROVED: LoopContinuationDecision = {
  approvalId: "appr-cf-j06-s-1",
  decision: "approved",
  decidedAt: "2026-07-31T12:30:00.000Z",
};

const DENIED: LoopContinuationDecision = {
  approvalId: "appr-cf-j06-s-2",
  decision: "denied",
  reason: "do not push the tag; finish the pass with a release note instead",
  decidedAt: "2026-07-31T12:31:00.000Z",
};

describe("CF-J06-S — approve and deny both resume the same session/claim with guidance (L2, HB-012)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function freshRig(): Promise<ResumeRig> {
    const rig = await makeResumeRig();
    cleanups.push(() => rig.cleanup());
    return rig;
  }

  for (const decision of [APPROVED, DENIED]) {
    it(`${decision.decision}: the executor resumes the exact parked session with the decision as guidance, repeating no completed pass`, async () => {
      const rig = await freshRig();
      const continuation = rig.continuationFor([decision]);
      const attempt = rig.resumeAttempt({ continuation });

      const result = await attempt.run();

      // Only the parked pass ran — completed passes communicate through
      // durable artifacts and are never repeated (B-09a §2).
      expect(result.aborted).toBe(false);
      expect(result.passes.map((record) => record.pass.id)).toEqual([ACT_PASS]);

      // Exactly one provider turn, and it REQUESTED the exact parked native
      // session (a denial resumes too — never a restart).
      expect(attempt.recorder.turns).toHaveLength(1);
      const turn = attempt.recorder.turns[0]!;
      expect(turn.options.resume).toBe(PAUSED_SESSION_ID);

      // The decision travels as orchestrator-owned guidance in the task.
      expect(turn.prompt).toContain(
        `Continue the existing ${PIPELINE_NAME}/${ACT_PASS} provider session from its approval boundary.`,
      );
      expect(turn.prompt).toContain("Do not repeat completed analysis");
      expect(turn.prompt).toContain(`"approval_id": "${decision.approvalId}"`);
      expect(turn.prompt).toContain(`"decision": "${decision.decision}"`);
      if (decision.reason !== undefined) {
        expect(turn.prompt).toContain(decision.reason);
      }

      // The provider restored that same session; the durable record keeps the
      // identity and the revalidated fingerprints unchanged.
      const record = result.passes[0]!;
      expect(record.result.session).toEqual({ runtime: "claude", id: PAUSED_SESSION_ID });
      expect(record.contextFingerprint).toBe(continuation.contextFingerprint);
      expect(record.workFingerprint).toBe(continuation.workFingerprint);

      // The claim-accounting commit point saw a RESUMED turn exactly once.
      expect(attempt.beforeProviderTurnCalls).toEqual([
        { pipeline: PIPELINE_NAME, pass: ACT_PASS, resumed: true },
      ]);
    });
  }

  it("claim seam: approve then deny across two pauses keep claim number 1, one claim consumed, decisions accumulated in order (INV-005)", async () => {
    const state = await makeTempStateHome({ name: "cf-j06-s-claims" });
    cleanups.push(() => state.cleanup());
    const handle = await installGithubDouble({
      defaultBranch: DEFAULT_BRANCH,
      labels: [...OP_LABELS],
    });
    cleanups.push(() => handle.dispose());
    const gh = new GhCliOps(handle.repo, handle.exec);
    const issue = await gh.createIssue({
      title: "cf-j06 paused ticket",
      body: "## Goal\nResume walk.\n",
      labels: ["op:blocked"],
    });
    const root = state.stateHome;

    // Pause 1 through the real saga: claim 1 consumed, continuation parked.
    const pause1 = await pauseTicketAtApproval({
      root,
      issueNumber: issue.number,
      continuation: syntheticContinuation([]),
      targetRepo: handle.repo,
    });
    expect(pause1.state.claims).toBe(1);
    expect(pause1.state.continuation).toMatchObject({
      status: "waiting_approval",
      claimNumber: 1,
      pauseCount: 1,
      pauseCostUsd: 0.11,
    });

    // The approval decision (approve) readies the SAME continuation and
    // repairs the label projection op:blocked -> op:ready.
    await continueAfterApproval({
      root,
      app: APP,
      issueNumber: issue.number,
      approvalId: APPROVED.approvalId,
      decision: "approved",
      decidedAt: APPROVED.decidedAt,
      gh,
    });
    expect((await gh.readIssue(issue.number)).labels).toEqual(["op:ready"]);

    // Resume: SAME claim number, no new claim consumed, exact session carried.
    const resume1 = await beginTicketClaim({
      root,
      app: APP,
      issueNumber: issue.number,
      defaultAllowance: 3,
    });
    expect(resume1.allowed).toBe(true);
    const lease1 = resume1.lease!;
    expect(lease1.resume).toBe(true);
    expect(lease1.claimNumber).toBe(1);
    expect(lease1.continuation?.session).toEqual({ runtime: "claude", id: PAUSED_SESSION_ID });
    expect(lease1.continuation?.decisions).toEqual([
      { approvalId: APPROVED.approvalId, decision: "approved", decidedAt: APPROVED.decidedAt },
    ]);

    const claim1 = { root, app: APP, issueNumber: issue.number, claimId: lease1.claimId };
    await markTicketClaimed(claim1);
    await markTicketProviderStarted(claim1);
    // A pause-resume is part of the ORIGINAL claim: the counter never moves.
    expect(readTicketClaimState(root, APP, issue.number).claims).toBe(1);

    // Pause 2 (same claim), now carrying the applied decision history.
    await finishTicketClaim({
      ...claim1,
      item: blockedLoopItem({
        issueNumber: issue.number,
        continuation: {
          ...syntheticContinuation([
            { approvalId: APPROVED.approvalId, decision: "approved", decidedAt: APPROVED.decidedAt },
          ]),
          pauseCostUsd: 0.19,
        },
        targetRepo: handle.repo,
      }),
    });
    const afterPause2 = readTicketClaimState(root, APP, issue.number);
    expect(afterPause2.claims).toBe(1);
    expect(afterPause2.continuation).toMatchObject({
      status: "waiting_approval",
      claimNumber: 1, // stable across ANY number of pauses (INV-005)
      pauseCount: 2,
      pauseCostUsd: 0.11 + 0.19, // pause cost accumulates, separated from repeat cost
    });

    // The DENIAL also readies the same continuation — contextual input to the
    // same pass, never a restart (B-09a §2 "denial matters").
    await continueAfterApproval({
      root,
      app: APP,
      issueNumber: issue.number,
      approvalId: DENIED.approvalId,
      decision: "denied",
      reason: DENIED.reason!,
      decidedAt: DENIED.decidedAt,
      gh,
    });
    const resume2 = await beginTicketClaim({
      root,
      app: APP,
      issueNumber: issue.number,
      defaultAllowance: 3,
    });
    expect(resume2.allowed).toBe(true);
    expect(resume2.lease?.resume).toBe(true);
    expect(resume2.lease?.claimNumber).toBe(1);
    expect(resume2.lease?.continuation?.session).toEqual({
      runtime: "claude",
      id: PAUSED_SESSION_ID,
    });
    // Exact decision history, in order, both outcomes preserved.
    expect(resume2.lease?.continuation?.decisions).toEqual([
      { approvalId: APPROVED.approvalId, decision: "approved", decidedAt: APPROVED.decidedAt },
      {
        approvalId: DENIED.approvalId,
        decision: "denied",
        reason: DENIED.reason,
        decidedAt: DENIED.decidedAt,
      },
    ]);

    // Lifecycle telemetry separates pause cost from repeated cost (B-09a §2):
    // every pause event carries its cost with repeated cost zero.
    const pauses = (readTicketClaimState(root, APP, issue.number).events ?? []).filter(
      (event) => event.kind === "approval_paused",
    );
    expect(pauses).toHaveLength(2);
    for (const pause of pauses) {
      expect(pause.claimNumber).toBe(1);
      expect(pause.repeatedCostUsd).toBe(0);
    }
    expect(pauses.map((pause) => pause.costUsd)).toEqual([0.11, 0.19]);
  });

  it("full composition: a decision recorded by continueAfterApproval resumes through the executor as the same session/claim with that guidance", async () => {
    const rig = await freshRig();
    const handle = await installGithubDouble({
      defaultBranch: DEFAULT_BRANCH,
      labels: [...OP_LABELS],
    });
    cleanups.push(() => handle.dispose());
    const gh = new GhCliOps(handle.repo, handle.exec);
    const issue = await gh.createIssue({
      title: "cf-j06 composition ticket",
      body: "## Goal\nFull pause → decide → resume composition.\n",
      labels: ["op:blocked"],
    });
    const root = rig.stateHome;

    // Pause with the CAPTURED (real) fingerprints, decide, and take the lease
    // continuation the driver would hand to the executor.
    await pauseTicketAtApproval({
      root,
      issueNumber: issue.number,
      continuation: rig.continuationFor([]),
      targetRepo: handle.repo,
    });
    await continueAfterApproval({
      root,
      app: APP,
      issueNumber: issue.number,
      approvalId: "appr-cf-j06-s-3",
      decision: "approved",
      decidedAt: "2026-07-31T13:00:00.000Z",
      gh,
    });
    const resumed = await beginTicketClaim({
      root,
      app: APP,
      issueNumber: issue.number,
      defaultAllowance: 3,
    });
    expect(resumed.lease?.resume).toBe(true);
    expect(resumed.lease?.claimNumber).toBe(1);
    const leaseContinuation = resumed.lease!.continuation!;

    // The exact lease continuation resumes through the REAL executor.
    const attempt = rig.resumeAttempt({ continuation: leaseContinuation });
    const result = await attempt.run();
    expect(result.aborted).toBe(false);
    expect(result.passes.map((record) => record.pass.id)).toEqual([ACT_PASS]);
    expect(attempt.recorder.turns).toHaveLength(1);
    expect(attempt.recorder.turns[0]!.options.resume).toBe(PAUSED_SESSION_ID);
    expect(attempt.recorder.turns[0]!.prompt).toContain('"approval_id": "appr-cf-j06-s-3"');
    expect(attempt.recorder.turns[0]!.prompt).toContain('"decision": "approved"');
    expect(result.passes[0]!.result.session.id).toBe(PAUSED_SESSION_ID);
  });

  it("negative control: an adapter that echoes the requested resume id (masking a session-identity mismatch) makes checkSessionIdentityHonest FIRE", async () => {
    const rig = await freshRig();

    // Honest adapter first: the provider restored a DIFFERENT session than
    // requested, so the real guard refuses pre-spend rather than returning an
    // envelope that could let the wrong session continue.
    const honest = claudeDouble([
      script.turn({
        sessionId: "sess-cf-j06-hijacked-9",
        outcome: script.success("wrong session restored", {
          usage: { inputTokens: 100, outputTokens: 10 },
          costUsd: 0.01,
        }),
      }),
    ]);
    const gate = { gate: () => ({ allow: true }) as const };
    const honestRun = honest.runtime.runTurn(
      doubleTurnRequest({
        workdir: rig.repo.dir,
        role: doubleRole({ name: ROLE_NAME, effort: "medium" }),
        session: { runtime: "claude", id: PAUSED_SESSION_ID },
        task: "resume the parked pass",
      }),
      gate,
    );
    await expect(honestRun).rejects.toThrow(ClaudeSessionResumeMismatchError);
    expect(honest.recorder.turns[0]!.toolPlays).toHaveLength(0);
    expect(honest.recorder.turns[0]!.usageReported).toBe(false);

    // Seeded violation: the adapter echoes the REQUESTED id back, which would
    // make a hijacked resume undetectable downstream — the detector FIRES.
    const lying = claudeDouble(
      [
        script.turn({
          sessionId: "sess-cf-j06-hijacked-9",
          outcome: script.success("wrong session restored, identity masked", {
            usage: { inputTokens: 100, outputTokens: 10 },
            costUsd: 0.01,
          }),
        }),
      ],
      { violations: ["mask_resume_identity"] },
    );
    const lyingResult = await lying.runtime.runTurn(
      doubleTurnRequest({
        workdir: rig.repo.dir,
        role: doubleRole({ name: ROLE_NAME, effort: "medium" }),
        session: { runtime: "claude", id: PAUSED_SESSION_ID },
        task: "resume the parked pass",
      }),
      gate,
    );
    expect(lyingResult.session.id).toBe(PAUSED_SESSION_ID); // the lie
    expect(() =>
      checkSessionIdentityHonest(
        lying.recorder.turns[0]!,
        { runtime: "claude", id: PAUSED_SESSION_ID },
        lyingResult,
      ),
    ).toThrow(AdapterContractViolation);
  });
});
