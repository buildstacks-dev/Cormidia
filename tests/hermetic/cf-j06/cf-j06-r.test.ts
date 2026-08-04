// CF-J06-R — EVERY fingerprint mismatch class fails closed PRE-SPEND (L2;
// HB-012; case-catalog §1 J-06; contracts/B-09a §2: "Resume runs iff every
// fingerprint matches: same role, runtime/assignment, context, worktree, work
// content. Any mismatch → fail closed BEFORE ANY SPEND"; system-map J-06:
// same pass/completed-pass set/run identity too; defends INV-003/005, T-2).
//
// Each class drives the REAL executor (src/loop/pipeline.ts) with a
// continuation derived from a real capture run's durable record and exactly
// ONE field of continuation identity broken — via real drift where the class
// has a real-world producer (a commit landing in the worktree, an authority
// edit while paused). "No spend" is proven four ways per class: the scripted
// adapter recorded ZERO provider constructions, the claim-accounting commit
// point (beforeProviderTurn) never fired, the settled ledger holds only the
// capture rows, and no new durable provider execution step exists.

import { afterEach, describe, expect, it } from "vitest";
import { claudeDouble, doubleRole } from "../../fixtures/adapters/claude-double.js";
import { script } from "../../fixtures/adapters/scenario.js";
import {
  ACT_PASS,
  PAUSED_SESSION_ID,
  PLAN_PASS,
  driftedContext,
  makeResumeRig,
  type ResumeAttempt,
  type ResumeRig,
} from "./resume-rig.js";
import type { LoopContinuationDecision } from "../../../src/loop/types.js";
import type { ContextBundle, TurnRequest } from "../../../src/runtime/types.js";

const DECISIONS: LoopContinuationDecision[] = [
  { approvalId: "appr-cf-j06-r-1", decision: "approved", decidedAt: "2026-07-31T12:30:00.000Z" },
];

describe("CF-J06-R — every fingerprint mismatch class fails closed pre-spend (L2, HB-012)", () => {
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

  /** The shared no-spend proof for a refused resume attempt. */
  async function expectFailedClosedPreSpend(
    rig: ResumeRig,
    attempt: ResumeAttempt,
    message: RegExp,
  ): Promise<void> {
    await expect(attempt.run()).rejects.toThrow(message);
    // No provider was even constructed — the scripted double recorded nothing.
    expect(attempt.recorder.turns).toHaveLength(0);
    // The claim-accounting commit point never fired.
    expect(attempt.beforeProviderTurnCalls).toHaveLength(0);
    // No settled spend and no durable provider step beyond the capture run's.
    expect(await rig.spendEvidence()).toEqual(rig.captureSpend);
  }

  it("control: an untampered continuation resumes and EVERY no-spend detector channel moves — the refusal legs below cannot pass vacuously", async () => {
    const rig = await freshRig();
    const attempt = rig.resumeAttempt({ continuation: rig.continuationFor(DECISIONS) });
    const result = await attempt.run();
    expect(result.aborted).toBe(false);
    expect(result.passes.map((record) => record.pass.id)).toEqual([ACT_PASS]);
    expect(attempt.recorder.turns).toHaveLength(1);
    expect(attempt.beforeProviderTurnCalls).toEqual([
      { pipeline: "build", pass: ACT_PASS, resumed: true },
    ]);
    // All four channels the refusal legs assert on are live wires: a real
    // resumed turn moves the ledger AND the durable provider-step evidence.
    expect(await rig.spendEvidence()).toEqual({
      ledgerRows: rig.captureSpend.ledgerRows + 1,
      providerSteps: rig.captureSpend.providerSteps + 1,
    });
  });

  it("role mismatch: a continuation parked under a different role fails closed pre-spend", async () => {
    const rig = await freshRig();
    const attempt = rig.resumeAttempt({
      continuation: { ...rig.continuationFor(DECISIONS), role: "reviewer" },
    });
    await expectFailedClosedPreSpend(rig, attempt, /continuation role\/runtime changed/);
  });

  it("runtime mismatch: a session parked on another harness fails closed pre-spend", async () => {
    const rig = await freshRig();
    const base = rig.continuationFor(DECISIONS);
    const attempt = rig.resumeAttempt({
      continuation: { ...base, session: { runtime: "codex", id: base.session.id } },
    });
    await expectFailedClosedPreSpend(rig, attempt, /continuation role\/runtime changed/);
  });

  it("assignment mismatch: a changed model in the persisted atomic tuple fails closed pre-spend", async () => {
    const rig = await freshRig();
    const base = rig.continuationFor(DECISIONS);
    const attempt = rig.resumeAttempt({
      continuation: {
        ...base,
        assignment: { ...base.assignment!, model: "claude-some-other-model" },
      },
    });
    await expectFailedClosedPreSpend(rig, attempt, /continuation assignment changed/);
  });

  it("plan-identity mismatch: a plan-backed continuation resumed on a planless route fails closed pre-spend", async () => {
    const rig = await freshRig();
    const attempt = rig.resumeAttempt({
      continuation: { ...rig.continuationFor(DECISIONS), planVersion: 3, planStepId: "step-act" },
    });
    await expectFailedClosedPreSpend(rig, attempt, /plan version\/step changed/);
  });

  it("context mismatch: authority/context drift while paused fails closed pre-spend (real drift, recomputed manifest)", async () => {
    const rig = await freshRig();
    // REAL drift: the context bundle changed while the human was away; the
    // freshly recomputed render_sha256 no longer matches the parked one.
    const attempt = rig.resumeAttempt({
      continuation: rig.continuationFor(DECISIONS),
      context: driftedContext(),
    });
    await expectFailedClosedPreSpend(rig, attempt, /continuation context changed/);
  });

  it("worktree/work-content mismatch: a commit landing in the worktree while paused fails closed pre-spend (real drift)", async () => {
    const rig = await freshRig();
    const continuation = rig.continuationFor(DECISIONS);
    // REAL drift: tracked content changed under the parked fingerprint.
    await rig.repo.commitFile("drift.md", "content landed while the human was away\n");
    const attempt = rig.resumeAttempt({ continuation });
    await expectFailedClosedPreSpend(rig, attempt, /continuation worktree changed/);
  });

  it("completed-pass-set mismatch: a continuation that is not the next remaining pass fails closed pre-spend", async () => {
    const rig = await freshRig();
    // Work-set drift: the parked record claims NO pass completed, so `act` is
    // not the next remaining pass — resuming would skip `plan` silently.
    const attempt = rig.resumeAttempt({
      continuation: { ...rig.continuationFor(DECISIONS), completedPasses: [] },
    });
    await expectFailedClosedPreSpend(rig, attempt, /continuation is not the next pass/);
    // The unknown-pass variant of the same class: a completed pass the
    // pipeline does not contain.
    const attempt2 = rig.resumeAttempt({
      continuation: {
        ...rig.continuationFor(DECISIONS),
        completedPasses: [PLAN_PASS, "vanished-pass"],
      },
    });
    await expectFailedClosedPreSpend(
      rig,
      attempt2,
      /completed-pass vanished-pass is not in pipeline/,
    );
  });

  it("pipeline mismatch: a continuation targeting another pipeline fails closed pre-spend", async () => {
    const rig = await freshRig();
    const attempt = rig.resumeAttempt({
      continuation: { ...rig.continuationFor(DECISIONS), pipeline: "fix" },
    });
    await expectFailedClosedPreSpend(rig, attempt, /continuation targets fix\/act, not build/);
  });

  it("negative control: bypassing the revalidation seam DOES start a provider turn — the zero-spend detector observes it", async () => {
    const rig = await freshRig();
    // Seeded violation: an orchestrator that skipped every fingerprint check
    // and resumed the parked session directly (same request shape the
    // executor would send). The detector channel this suite relies on — the
    // double's provider-construction recorder — must observe the turn, or the
    // zero-turn assertions above would be unfalsifiable.
    const continuation = rig.continuationFor(DECISIONS);
    const dbl = claudeDouble([
      script.turn({
        sessionId: PAUSED_SESSION_ID,
        outcome: script.success("spend that revalidation should have prevented", {
          usage: { inputTokens: 300, outputTokens: 40 },
          costUsd: 0.03,
        }),
      }),
    ]);
    const context: ContextBundle = driftedContext(); // the mismatch is live
    const request: TurnRequest = {
      role: doubleRole({ name: continuation.role, effort: "medium" }),
      assignment: continuation.assignment!,
      workdir: rig.repo.dir,
      task: "resume despite a context mismatch (guardrail bypassed)",
      context,
      session: continuation.session,
    };
    const result = await dbl.runtime.runTurn(request, { gate: () => ({ allow: true }) as const });
    expect(result.status).toBe("completed");
    // The detector FIRES: one recorded provider construction, resume id and
    // all — proof the "recorded zero turns" checks above measure a live wire.
    expect(dbl.recorder.turns).toHaveLength(1);
    expect(dbl.recorder.turns[0]!.options.resume).toBe(PAUSED_SESSION_ID);
  });
});
