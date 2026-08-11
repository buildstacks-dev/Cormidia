// Traceability: CF-B17 · HB-013 · boundary-map.md B-17; contracts/B-17-typed-executor.md §§1–5.

// CF-B17-* — typed critical-effect executor against a scripted external
// target (contracts/B-17-typed-executor.md §1–§5; CORMIDIA-INV-003/008/014;
// system-map T-12; risk E-1): accept-vs-complete split, lost response,
// marker disagreement, target-auth failure with the grant consumed and the
// evidence in audit, and at-most-once execution per grant.
//
// BLOCKED:B-17-L3 — the real non-GitHub round-trip (and CF-J17-A) stays
// parked per validation-policy.yaml obligation B-17-L3: no disposable real
// non-GitHub target exists; the unblock condition is unmet. Nothing here is
// a live-cell claim. The scripted target + driver live in this directory
// (scripted-target.ts, typed-executor-driver.ts); ALL durable state is the
// real product ApprovalStore on a temp state home.
//
// BLOCKED:F-PT-008 — the disposition of the approval ITEM when its grant TTL
// expires before execution is an open product-truth finding (its cells live
// with CF-J06-I/CF-B09a-*, HB-012/HB-P-side): no case in this ticket asserts
// any expiry disposition. Expired grants merely failing to match
// (findMatchingGrantSync) is ratified and incidental here.
// BLOCKED:F-PT-006 (event producer visibility / duplicate identity) has no
// cell in this ticket's families; it stays parked with its own backlog item.

import { afterEach, describe, expect, it } from "vitest";
import {
  ApprovalStore,
  actionHash,
  approvalLifecycleState,
  type ApprovalLogEvent,
} from "../../../src/org/approvals.js";
import type { ToolAction } from "../../../src/runtime/types.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";
import {
  ScriptedExternalTarget,
  TargetAuthError,
  TargetConnectionLostError,
  type SubmitBehavior,
} from "./scripted-target.js";
import { executeTypedExternalAction, TYPED_EXECUTOR_ACTOR } from "./typed-executor-driver.js";

const APP = "publisher-app";
const ROLE = "marketing";
const ACTION: ToolAction = {
  tool: "cormidia.external.publish",
  input: {
    schema_version: 1,
    destination: "registry.example.invalid",
    payload: "release notes v1 — exact content the human read",
    idempotency_key: "cf-b17:publish:0001",
  },
};

interface Walk {
  home: TempStateHome;
  store: ApprovalStore;
  clock: TestClock;
  approvalId: string;
  key: string;
  target: ScriptedExternalTarget;
  drive: () => ReturnType<typeof executeTypedExternalAction>;
}

describe("CF-B17-* — scripted external target: marker typing, lost response, auth failure, at-most-once (L2)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeWalk(script: readonly SubmitBehavior[]): Promise<Walk> {
    const home = await makeTempStateHome({ name: "cf-b17" });
    cleanups.push(() => home.cleanup());
    const clock = makeTestClock("2026-07-31T09:00:00.000Z");
    const store = new ApprovalStore(home.stateHome);
    const raised = await store.raise({
      app: APP,
      role: ROLE,
      rule: "external-publishing",
      action: ACTION,
      now: clock.nowDate(),
    });
    const decided = await store.decide(raised.id, { decision: "approved", now: clock.nowDate() });
    // The product-owned idempotency key is the target-side join key (T-12).
    const key = decided.execution!.idempotencyKey;
    expect(key).toBe(`approval:${raised.id}:${actionHash(decided.action)}`);
    const target = new ScriptedExternalTarget(script);
    return {
      home,
      store,
      clock,
      approvalId: raised.id,
      key,
      target,
      drive: () => executeTypedExternalAction({ store, approvalId: raised.id, target, now: clock.dateFn }),
    };
  }

  async function grantConsumedRows(walk: Walk): Promise<number> {
    return (await walk.store.readLog()).filter((event) => event.type === "grant-consumed").length;
  }

  it("accept-vs-complete split: acceptance never becomes executed; a later completion marker does — exactly one submission, one grant use", async () => {
    const walk = await makeWalk(["accept"]);

    const first = await walk.drive();
    expect(first).toEqual({ status: "accepted" });
    const inFlight = await walk.store.show(walk.approvalId);
    // §2: recorded as accepted-in-flight, NEVER executed on acceptance alone.
    expect(inFlight.item.execution?.state).toBe("executing");
    expect(approvalLifecycleState(inFlight.item)).not.toBe("executed");
    expect(inFlight.grant!.uses).toBe(0); // the one grant consumption (§1)
    expect(walk.target.submits).toHaveLength(1);

    // Completion is a separately verified fact: the target completes out of
    // band, and reconciliation converts by the COMPLETION-typed marker.
    walk.target.completeAsync(walk.key);
    const second = await walk.drive();
    expect(second).toMatchObject({ status: "executed" });
    const done = await walk.store.show(walk.approvalId);
    expect(done.item.execution?.state).toBe("executed");
    expect(done.item.execution?.remoteRef).toBe("target-op-1");
    expect(walk.target.submits).toHaveLength(1); // never re-submitted
    expect(await grantConsumedRows(walk)).toBe(1);
    walk.target.assertScriptDrained();
  });

  it("negative control: an acceptance-only marker seeded against the in-flight record — the marker-typing detector FIRES (ambiguous, never executed, no re-submit)", async () => {
    const walk = await makeWalk(["accept"]);
    await walk.drive(); // accepted; target durably holds ONLY an acceptance marker

    // SEEDED VIOLATION-TEMPTATION: reconcile now, when the only evidence is
    // acceptance. A reconciler that typed markers wrongly would mark executed.
    const reconciled = await walk.drive();
    expect(reconciled).toMatchObject({ status: "ambiguous" });
    if (reconciled.status === "ambiguous") {
      expect(reconciled.reason).toContain("completion unestablished");
    }
    const after = await walk.store.show(walk.approvalId);
    expect(after.item.execution?.state).toBe("ambiguous");
    expect(after.item.execution?.failureCause).toBe("completion_unestablished");
    expect(after.item.execution?.state).not.toBe("executed");
    expect(walk.target.submits).toHaveLength(1);

    // Ambiguity stays terminal across dispatches until evidence arrives…
    expect(await walk.drive()).toMatchObject({ status: "ambiguous" });
    expect(walk.target.submits).toHaveLength(1);

    // …and completion evidence (never optimism) closes it.
    walk.target.completeAsync(walk.key);
    expect(await walk.drive()).toMatchObject({ status: "executed" });
    expect(walk.target.submits).toHaveLength(1);
  });

  it("lost response after possible effect: ambiguous-terminal, never blindly retried, resolved only by completion evidence", async () => {
    const walk = await makeWalk(["lost-after-accept"]);

    const first = await walk.drive();
    expect(first).toMatchObject({ status: "ambiguous" });
    const crashed = await walk.store.show(walk.approvalId);
    expect(crashed.item.execution?.state).toBe("ambiguous");
    expect(crashed.item.execution?.failureCause).toBe("lost_response");
    expect(crashed.grant!.uses).toBe(0);
    expect(walk.target.submits).toHaveLength(1);

    // Never a blind retry (§3): repeated dispatches leave exactly one
    // submission at the target.
    for (let i = 0; i < 3; i++) {
      const outcome = await walk.drive();
      expect(outcome.status).toBe("ambiguous");
    }
    expect(walk.target.submits).toHaveLength(1);

    // Exactly-once holds where completion evidence proves the effect (§4).
    walk.target.completeAsync(walk.key);
    const closed = await walk.drive();
    expect(closed).toMatchObject({ status: "executed", remoteRef: "target-op-1" });
    expect(walk.target.submits).toHaveLength(1);
    expect(await grantConsumedRows(walk)).toBe(1);
  });

  it("target-auth failure: failed with the consumed grant NOT reusable and the grant/use/attempt evidence intact in audit", async () => {
    const walk = await makeWalk(["auth-reject"]);

    const outcome = await walk.drive();
    expect(outcome).toEqual({ status: "failed", cause: "target_authentication_failure" });
    const after = await walk.store.show(walk.approvalId);
    expect(after.item.execution?.state).toBe("failed");
    expect(after.item.execution?.failureCause).toBe("target_authentication_failure");
    expect(after.item.execution?.attempts).toBe(1);

    // §3: the consumed grant does not become reusable merely because target
    // authentication failed…
    expect(after.grant!.uses).toBe(0);
    expect(after.grant!.consumedAt).toBeDefined();
    expect(
      walk.store.findMatchingGrantSync({
        app: APP,
        role: ROLE,
        actionHash: actionHash(ACTION),
        rule: "external-publishing",
        now: walk.clock.nowDate(),
      }),
    ).toBeUndefined();

    // …and the immutable grant/use/attempt evidence remains in audit.
    const log = await walk.store.readLog();
    const kinds = log.filter((event) => "id" in event && event.id === walk.approvalId).map((event) => event.type);
    expect(kinds).toEqual([
      "raised",
      "decided",
      "grant-minted",
      "execution-transition", // approved -> executing (the attempt)
      "grant-consumed", //       the use
      "execution-transition", // executing -> failed
    ]);
    const failedTransition = log.find(
      (event): event is Extract<ApprovalLogEvent, { type: "execution-transition" }> =>
        event.type === "execution-transition" && event.to === "failed",
    );
    expect(failedTransition?.cause).toBe("target_authentication_failure");
    expect(failedTransition?.actor).toBe(TYPED_EXECUTOR_ACTOR);

    // Terminal: no further attempt ever reaches the target.
    expect(await walk.drive()).toMatchObject({ status: "skipped" });
    expect(walk.target.submits).toHaveLength(1);
  });

  it("at-most-once: a concurrent claim wins the store's per-item boundary and this executor submits NOTHING", async () => {
    const walk = await makeWalk([]);
    // A concurrent executor already claimed the attempt.
    await walk.store.beginExecution(walk.approvalId, "orchestrator/concurrent-rival", walk.clock.nowDate());

    // With no marker at the target yet, this driver's pass reconciles the
    // rival's in-flight attempt to ambiguous rather than submitting a second
    // performance — the effect never happens twice.
    const outcome = await walk.drive();
    expect(outcome.status).not.toBe("executed");
    expect(walk.target.submits).toHaveLength(0);
    walk.target.assertScriptDrained();
  });

  it("§4 marker precheck: a pre-existing completion under the key executes by evidence — zero submissions", async () => {
    const walk = await makeWalk([]);
    const ref = walk.target.seedCompletion(walk.key);

    const outcome = await walk.drive();
    expect(outcome).toMatchObject({ status: "executed", remoteRef: ref });
    const after = await walk.store.show(walk.approvalId);
    expect(after.item.execution?.state).toBe("executed");
    expect(after.item.execution?.remoteRef).toBe(ref);
    expect(walk.target.submits).toHaveLength(0); // exactly-once via evidence
    expect(after.grant!.uses).toBe(0); // the attempt still consumed its one grant
    walk.target.assertScriptDrained();
  });

  it("negative control: marker disagreement seeded against a crashed attempt — the never-greener-story detector FIRES with BOTH states recorded", async () => {
    const walk = await makeWalk([]);
    // A crashed mid-flight attempt (claim + consumed grant, no acknowledgement),
    // seeded exactly as the executor orders those two durable facts.
    await walk.store.beginExecution(walk.approvalId, TYPED_EXECUTOR_ACTOR, walk.clock.nowDate());
    const { item } = await walk.store.show(walk.approvalId);
    walk.store.consumeGrantSync(item.grantId!, walk.clock.nowDate());

    // SEEDED VIOLATION: the target holds TWO completions under our key — our
    // record and the target state cannot be joined one-to-one.
    const refA = walk.target.seedDuplicateCompletion(walk.key);
    const refB = walk.target.seedDuplicateCompletion(walk.key);

    const outcome = await walk.drive();
    expect(outcome).toMatchObject({ status: "ambiguous" });
    const after = await walk.store.show(walk.approvalId);
    expect(after.item.execution?.state).toBe("ambiguous");
    expect(after.item.execution?.failureCause).toBe("marker_disagreement");
    // BOTH states are recorded in the durable result (§3).
    expect(after.item.execution?.result).toContain(refA);
    expect(after.item.execution?.result).toContain(refB);
    expect(after.item.execution?.result).toContain("our record is executing");
    expect(after.item.execution?.state).not.toBe("executed");

    // Disagreement stays terminal; nothing is ever submitted.
    expect(await walk.drive()).toMatchObject({ status: "ambiguous" });
    expect(walk.target.submits).toHaveLength(0);
  });

  describe("harness self-tests — the scripted target itself is tested (policy harness_self_tests)", () => {
    it("negative control: an over-submission beyond the script — the target detector FIRES instead of defaulting to success", () => {
      const target = new ScriptedExternalTarget(["complete"]);
      expect(target.submit("k", "h")).toMatchObject({ kind: "completed" });
      expect(() => target.submit("k", "h")).toThrow(/no scripted behavior left/);
    });

    it("negative control: an undrained script is detected, never green by absence", () => {
      const target = new ScriptedExternalTarget(["accept", "complete"]);
      target.submit("k", "h");
      expect(() => target.assertScriptDrained()).toThrow(/never consumed/);
    });

    it("markers are typed by what they prove, and completing nothing is loud", () => {
      const target = new ScriptedExternalTarget(["accept"]);
      expect(target.markers("k")).toEqual([]);
      target.submit("k", "h");
      expect(target.markers("k")).toEqual([{ type: "acceptance", key: "k" }]);
      expect(() => target.completeAsync("other-key")).toThrow(/no accepted operation/);
      const ref = target.completeAsync("k");
      expect(target.markers("k")).toEqual([{ type: "completion", key: "k", ref }]);
    });

    it("error shapes are the typed ones the driver discriminates on", () => {
      const lost = new ScriptedExternalTarget(["lost-after-accept"]);
      expect(() => lost.submit("k", "h")).toThrow(TargetConnectionLostError);
      expect(lost.markers("k")).toEqual([{ type: "acceptance", key: "k" }]); // effect possibly recorded
      const auth = new ScriptedExternalTarget(["auth-reject"]);
      expect(() => auth.submit("k", "h")).toThrow(TargetAuthError);
      expect(auth.markers("k")).toEqual([]); // refused BEFORE any effect
    });
  });
});
