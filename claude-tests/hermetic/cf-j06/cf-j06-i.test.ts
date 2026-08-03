// CF-J06-I — crash mid-resume; TTL expiry before resume is a TYPED outcome
// (L2; HB-012; case-catalog §1 J-06; contracts/B-09a §3: "Crash between
// decision and continuation: decision durable, continuation retried by a
// later tick; the decision is never re-asked" and "Grant TTL (24 h [doc])
// expiry before resume: typed outcome; never silent execution under an
// expired grant (INV-003)").
//
// ITEM DISPOSITION IS BLOCKED:F-PT-008 (validation-policy.yaml →
// open_findings): what grant expiry does to the approval ITEM — fresh item,
// reopen the old one, or an explicit operation — is unratified, so this suite
// asserts NOTHING about item disposition. Only the typed-outcome and
// never-usable-authorization clauses are exercised.
//
// Crash legs: (a) the gh process seam fails between the durable decision
// write and the label projection (scripted github-double failure); (b) a REAL
// subprocess SIGKILLed between acquiring the resume lease and the provider
// start (kill-point harness), recovered through the REAL
// recoverInterruptedClaims path.

import { afterEach, describe, expect, it } from "vitest";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  beginTicketClaim,
  continueAfterApproval,
  recoverInterruptedClaims,
} from "../../../src/loop/claim-recovery.js";
import { GhCliOps } from "../../../src/loop/github.js";
import { readTicketClaimState } from "../../../src/loop/rehydrate.js";
import { ApprovalStore, actionHash, type ApprovalAction } from "../../../src/org/approvals.js";
import { makeTestClock } from "../../fixtures/clock.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";
import { runKillPointScenario } from "../../fixtures/kill-point.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import {
  APP,
  DEFAULT_BRANCH,
  OP_LABELS,
  PAUSED_SESSION_ID,
  ROLE_NAME,
  pauseTicketAtApproval,
  syntheticContinuation,
} from "./resume-rig.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const productModuleUrl = (rel: string): string => pathToFileURL(join(repoRoot, rel)).href;

const APPROVAL_ID = "appr-cf-j06-i-1";
const DAY_MS = 24 * 60 * 60 * 1000;

interface PausedWalk {
  state: TempStateHome;
  handle: GithubDoubleHandle;
  gh: GhCliOps;
  issueNumber: number;
}

describe("CF-J06-I — crash mid-resume; TTL expiry before resume (L2, HB-012)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  /** A ticket paused at the approval boundary on the double, decision pending. */
  async function pausedWalk(): Promise<PausedWalk> {
    const state = await makeTempStateHome({ name: "cf-j06-i-org" });
    cleanups.push(() => state.cleanup());
    const handle = await installGithubDouble({
      defaultBranch: DEFAULT_BRANCH,
      labels: [...OP_LABELS],
    });
    cleanups.push(() => handle.dispose());
    const gh = new GhCliOps(handle.repo, handle.exec, undefined, { sleep: async () => undefined, random: () => 0.5 });
    const issue = await gh.createIssue({
      title: "cf-j06-i paused ticket",
      body: "## Goal\nCrash-mid-resume walk.\n",
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

  it("gh failure between decision write and label projection: decision durable; the retry repairs the projection WITHOUT re-asking", async () => {
    const walk = await pausedWalk();
    const root = walk.state.stateHome;

    // Scripted seam failure: the label projection's `gh issue edit` dies.
    for (let attempt = 0; attempt < 3; attempt += 1) walk.handle.script({ op: "issue.edit", fail: "server_error" });
    await expect(
      continueAfterApproval({
        root,
        app: APP,
        issueNumber: walk.issueNumber,
        approvalId: APPROVAL_ID,
        decision: "approved",
        decidedAt: "2026-07-31T12:30:00.000Z",
        gh: walk.gh,
      }),
    ).rejects.toThrow();
    walk.handle.assertScenarioDrained();

    // The decision is DURABLE despite the crash-shaped failure: continuation
    // ready, decision recorded; only the label projection is stale.
    const afterCrash = readTicketClaimState(root, APP, walk.issueNumber);
    expect(afterCrash.continuation).toMatchObject({ status: "ready", claimNumber: 1 });
    expect(afterCrash.continuation?.decisions).toEqual([
      { approvalId: APPROVAL_ID, decision: "approved", decidedAt: "2026-07-31T12:30:00.000Z" },
    ]);
    expect((await walk.gh.readIssue(walk.issueNumber)).labels).toEqual(["op:blocked"]);

    // A later tick retries the continuation: the SAME approvalId is
    // deduplicated (never re-asked) and the projection is repaired.
    await continueAfterApproval({
      root,
      app: APP,
      issueNumber: walk.issueNumber,
      approvalId: APPROVAL_ID,
      decision: "approved",
      decidedAt: "2026-07-31T12:30:00.000Z",
      gh: walk.gh,
    });
    const afterRetry = readTicketClaimState(root, APP, walk.issueNumber);
    expect(afterRetry.continuation?.decisions).toHaveLength(1); // never re-asked
    expect((await walk.gh.readIssue(walk.issueNumber)).labels).toEqual(["op:ready"]);
    // Exactly one decision event was ever appended for this approval.
    const decisionEvents = (afterRetry.events ?? []).filter(
      (event) => event.kind === "approval_resumed" && event.detail.includes(APPROVAL_ID),
    );
    expect(decisionEvents).toHaveLength(1);
  });

  it("startup reconciliation repairs the stale decision projection (op:blocked -> op:ready) with the decision intact", async () => {
    const walk = await pausedWalk();
    const root = walk.state.stateHome;
    for (let attempt = 0; attempt < 3; attempt += 1) walk.handle.script({ op: "issue.edit", fail: "server_error" });
    await expect(
      continueAfterApproval({
        root,
        app: APP,
        issueNumber: walk.issueNumber,
        approvalId: APPROVAL_ID,
        decision: "denied",
        reason: "hold this action until the incident review closes",
        decidedAt: "2026-07-31T12:35:00.000Z",
        gh: walk.gh,
      }),
    ).rejects.toThrow();
    walk.handle.assertScenarioDrained();

    const entries = [
      {
        issueNumber: walk.issueNumber,
        state: readTicketClaimState(root, APP, walk.issueNumber),
      },
    ];
    const lines = await recoverInterruptedClaims({ root, app: APP, gh: walk.gh, entries });
    expect(lines).toContain(
      `#${walk.issueNumber}: repaired approval decision projection -> op:ready`,
    );
    expect((await walk.gh.readIssue(walk.issueNumber)).labels).toEqual(["op:ready"]);
    const state = readTicketClaimState(root, APP, walk.issueNumber);
    expect(state.continuation).toMatchObject({ status: "ready", claimNumber: 1 });
    expect(state.continuation?.decisions).toEqual([
      {
        approvalId: APPROVAL_ID,
        decision: "denied",
        reason: "hold this action until the incident review closes",
        decidedAt: "2026-07-31T12:35:00.000Z",
      },
    ]);
  });

  function resumeKillScenarioSource(issueNumber: number): string {
    return `
import {
  beginTicketClaim,
  markTicketClaimed,
  markTicketProviderStarted,
} from ${JSON.stringify(productModuleUrl("src/loop/claim-recovery.ts"))};

const root = process.env.CORMIDIA_KP_STATE_HOME;
if (root === undefined || root.length === 0) throw new Error("CORMIDIA_KP_STATE_HOME not set");
const app = ${JSON.stringify(APP)};
const issueNumber = ${issueNumber};

const begun = await beginTicketClaim({ root, app, issueNumber, defaultAllowance: 3 });
if (!begun.allowed || begun.lease === undefined || begun.lease.resume !== true) {
  throw new Error("cf-j06-i scenario: expected a resume lease");
}
if (begun.lease.claimNumber !== 1) {
  throw new Error("cf-j06-i scenario: resume must keep claim number 1");
}
await kp("resume_lease_acquired"); // ← killAt: after the lease, before any provider start
const claim = { root, app, issueNumber, claimId: begun.lease.claimId };
await markTicketClaimed(claim);
await markTicketProviderStarted(claim);
await kp("provider_resumed");
`;
  }

  it("SIGKILL between resume lease and provider start: decision survives, recovery auto-rearms without consuming allowance, never re-asks", async () => {
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

    const res = await runKillPointScenario({
      source: resumeKillScenarioSource(walk.issueNumber),
      killAt: "resume_lease_acquired",
      env: { CORMIDIA_KP_STATE_HOME: root },
      timeoutMs: 25_000,
    });
    cleanups.push(() => res.cleanup());
    expect(res.timedOut).toBe(false);
    expect(res.killedAt).toBe("resume_lease_acquired");
    expect(res.markers).toEqual(["resume_lease_acquired"]);

    // Surviving durable claim state is non-empty (no green by absence).
    await assertNonEmptyWalk(walk.state.path("tickets", APP));
    const afterKill = readTicketClaimState(root, APP, walk.issueNumber);
    expect(afterKill.claims).toBe(1); // the interrupted resume consumed nothing
    expect(afterKill.active).toMatchObject({ phase: "acquiring", resume: true, claimNumber: 1 });
    expect(afterKill.active!.ownerPid).toBe(res.pid); // the dead scenario process
    expect(afterKill.continuation).toMatchObject({ status: "ready", claimNumber: 1 });

    // Recovery: pre-provider orphan auto-rearms without consuming allowance.
    const lines = await recoverInterruptedClaims({
      root,
      app: APP,
      gh: walk.gh,
      entries: [{ issueNumber: walk.issueNumber, state: afterKill }],
    });
    expect(lines).toContain(`#${walk.issueNumber}: orphaned pre-provider claim auto-rearmed`);
    const recovered = readTicketClaimState(root, APP, walk.issueNumber);
    expect(recovered.active).toBeUndefined();
    expect(recovered.claims).toBe(1);
    expect(recovered.continuation).toMatchObject({ status: "ready", claimNumber: 1 });
    // The decision is still applied exactly once — never re-asked.
    expect(recovered.continuation?.decisions).toEqual([
      { approvalId: APPROVAL_ID, decision: "approved", decidedAt: "2026-07-31T12:30:00.000Z" },
    ]);

    // A later tick resumes the SAME claim with the SAME exact session.
    const resumed = await beginTicketClaim({
      root,
      app: APP,
      issueNumber: walk.issueNumber,
      defaultAllowance: 3,
    });
    expect(resumed.allowed).toBe(true);
    expect(resumed.lease?.resume).toBe(true);
    expect(resumed.lease?.claimNumber).toBe(1);
    expect(resumed.lease?.continuation?.session).toEqual({
      runtime: "claude",
      id: PAUSED_SESSION_ID,
    });
  });

  it("control: without a kill the resumed claim reaches provider start on the original claim number", async () => {
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

    const res = await runKillPointScenario({
      source: resumeKillScenarioSource(walk.issueNumber),
      env: { CORMIDIA_KP_STATE_HOME: root },
      timeoutMs: 25_000,
    });
    cleanups.push(() => res.cleanup());
    expect(res.timedOut).toBe(false);
    expect(res.exitCode).toBe(0);
    expect(res.markers).toEqual(["resume_lease_acquired", "provider_resumed"]);

    const state = readTicketClaimState(root, APP, walk.issueNumber);
    expect(state.active).toMatchObject({ phase: "provider_started", resume: true, claimNumber: 1 });
    expect(state.claims).toBe(1); // a resumed provider start never re-increments
  });

  it("TTL expiry before resume: the expired grant is a typed refusal, never usable authorization (INV-003; B-09a §3/§5)", async () => {
    const state = await makeTempStateHome({ name: "cf-j06-i-ttl" });
    cleanups.push(() => state.cleanup());
    const clock = makeTestClock("2026-07-31T12:00:00.000Z");
    const store = new ApprovalStore(state.stateHome);
    const action: ApprovalAction = {
      tool: "bash",
      input: { command: "gh workflow run deploy.yml" },
      description: "cf-j06 gated action awaiting resume",
    };

    const raised = await store.raise({
      app: APP,
      role: ROLE_NAME,
      rule: "outbound-network",
      action,
      ticketRef: "#12",
      now: clock.nowDate(),
    });
    const decided = await store.decide(raised.id, { decision: "approved", now: clock.nowDate() });
    const grant = (await store.show(decided.id)).grant;
    expect(grant).toBeDefined();
    // B-09a §3 `[doc]`: the grant TTL is 24 h from the decision.
    expect(new Date(grant!.expiresAt).getTime() - clock.now()).toBe(DAY_MS);

    // Control for the detector: before expiry the grant IS usable authorization.
    const hash = actionHash(action);
    expect(
      store.findMatchingGrantSync({
        app: APP,
        role: ROLE_NAME,
        actionHash: hash,
        now: clock.nowDate(),
      })?.grantId,
    ).toBe(grant!.grantId);

    // Negative control (seeded violation): the human returns after the TTL —
    // an expired-but-present grant sits in the store looking usable. The
    // guardrail FIRES on both revalidation seams: the matcher never returns
    // it, and consumption is a TYPED error — never silent execution.
    clock.advance(DAY_MS); // expiresAt <= now: expired exactly at the boundary
    expect(
      store.findMatchingGrantSync({
        app: APP,
        role: ROLE_NAME,
        actionHash: hash,
        now: clock.nowDate(),
      }),
    ).toBeUndefined();
    expect(() => store.consumeGrantSync(grant!.grantId, clock.nowDate())).toThrow(
      /approval grant .+ is expired/,
    );

    // BLOCKED:F-PT-008 (grant-expiry item disposition, validation-policy.yaml
    // → open_findings): whether expiry creates a fresh item, reopens the old
    // one, or requires another explicit operation is UNRATIFIED — the owner
    // must decide. This suite deliberately encodes no expectation about the
    // approval item after expiry; the assertions above stop at the ratified
    // clauses (typed outcome, never-usable authorization). Candidate-finding
    // material: which component owns re-raising after an expired-grant resume.
  });
});
