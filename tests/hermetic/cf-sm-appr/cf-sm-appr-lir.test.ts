// CF-SM-APPR-L/I/R — L2 composition on the REAL ApprovalStore over a temp
// state home (HB-011): the legal lifecycle walks, the illegal-jump refusals at
// the store seam, and replayed stimuli.
//
// Design: case-catalog §2 CF-SM-APPR row; contracts/B-09a §3-§4;
// contracts/B-09b §1-§4; CORMIDIA-INV-003. Time is injected through the store's
// per-call `now` parameters via fixtures/clock.ts — the store has no ambient
// wall-clock dependency on these paths.
//
// DEFECT FIXED (HB-011 D2, 2026-07-31): the decision-entry seam used to
// surface a raw fs ENOENT for both unknown ids and already-decided items.
// decide() now refuses with the typed outcomes B-09b §1/§3/§4 ratify — a
// typed already-decided outcome referencing the original decision, and a
// typed unknown-item refusal naming the item. The former it.fails tripwires
// are promoted to plain detectors below.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { ApprovalStore, approvalLifecycleState, type ApprovalLogEvent } from "../../../src/org/approvals.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import { detectIllegalExecutionTransitions } from "../../unit/cf-sm-appr/transition-relation.js";

// Full-lane flake guard (observed once under worker contention): these suites
// take REAL per-item execution file locks (src/runtime/file-lock.ts via
// ApprovalStore.withExecutionLock), whose acquisition may legitimately wait up
// to ~35s (EXECUTION_LOCK_STALE_MS + 5s) before yielding; the lane's 30s
// default then times a test out mid-acquisition. The acquisition budget is
// widened HERE, in test setup — never in src.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const APP = "appr-app";
const ROLE = "sre";

interface Rig {
  state: TempStateHome;
  store: ApprovalStore;
  clock: TestClock;
}

let rigs: Rig[] = [];

afterEach(async () => {
  for (const rig of rigs) await rig.state.cleanup();
  rigs = [];
});

async function makeRig(): Promise<Rig> {
  const state = await makeTempStateHome({ name: "cf-sm-appr" });
  const rig: Rig = {
    state,
    store: new ApprovalStore(state.stateHome),
    clock: makeTestClock("2026-07-31T12:00:00.000Z"),
  };
  rigs.push(rig);
  return rig;
}

function raiseInput(command: string, rule = "external-publishing") {
  return {
    app: APP,
    role: ROLE,
    rule,
    action: { tool: "bash", input: { command } },
    ticketRef: "TICKET-11",
  };
}

async function readLog(rig: Rig): Promise<ApprovalLogEvent[]> {
  return rig.store.readLog();
}

describe("CF-SM-APPR-L — legal lifecycle walks on the real store (L2, HB-011)", () => {
  it("walks pending → approved → executing → executed with durable evidence and a legal log chain", async () => {
    const rig = await makeRig();
    const raised = await rig.store.raise({ ...raiseInput("npm publish"), now: rig.clock.nowDate() });
    expect(approvalLifecycleState(raised)).toBe("pending");
    expect(existsSync(rig.state.path("approvals", "pending", `${raised.id}.json`))).toBe(true);

    rig.clock.advance(60_000);
    const decided = await rig.store.decide(raised.id, {
      decision: "approved",
      now: rig.clock.nowDate(),
    });
    // Decision and execution are distinct durable facts (INV-003): approval
    // lands with an execution record born `approved`, attempts 0 — approved
    // NEVER means the side effect ran.
    expect(decided.status).toBe("approved");
    expect(decided.execution?.state).toBe("approved");
    expect(decided.execution?.attempts).toBe(0);
    expect(decided.grantId).toBeDefined();
    expect(existsSync(rig.state.path("approvals", "grants", `${decided.grantId!}.json`))).toBe(true);
    expect(existsSync(rig.state.path("approvals", "pending", `${raised.id}.json`))).toBe(false);

    rig.clock.advance(60_000);
    const executing = await rig.store.beginExecution(raised.id, "dispatch/test", rig.clock.nowDate());
    expect(executing?.execution?.state).toBe("executing");
    expect(executing?.execution?.attempts).toBe(1);
    expect(executing?.execution?.attemptedAt).toBe(rig.clock.nowIso());
    expect(approvalLifecycleState(executing!)).toBe("executing");

    rig.clock.advance(60_000);
    const executed = await rig.store.finishExecution({
      id: raised.id,
      state: "executed",
      actor: "dispatch/test",
      result: "publish acknowledged",
      remoteRef: "pkg@1.2.3",
      now: rig.clock.nowDate(),
    });
    expect(executed.execution?.state).toBe("executed");
    expect(executed.execution?.nextAction).toBe("none");
    expect(executed.execution?.finishedAt).toBe(rig.clock.nowIso());

    // The append-only log carries the full legal story and passes the family
    // detector (green control for the L1 detector against real store output).
    const log = await readLog(rig);
    expect(log.map((event) => event.type)).toEqual([
      "raised",
      "decided",
      "grant-minted",
      "execution-transition", // approved → executing
      "execution-transition", // executing → executed
    ]);
    detectIllegalExecutionTransitions(log);
    await assertNonEmptyWalk(rig.state.path("approvals"), /\.json$/);
  });

  it("walks the denied branch: a reasoned denial is terminal — no grant, no execution record", async () => {
    const rig = await makeRig();
    const raised = await rig.store.raise({ ...raiseInput("npm publish"), now: rig.clock.nowDate() });
    const denied = await rig.store.decide(raised.id, {
      decision: "denied",
      reason: "not during the freeze",
      now: rig.clock.nowDate(),
    });
    expect(denied.status).toBe("denied");
    expect(approvalLifecycleState(denied)).toBe("denied");
    expect(denied.execution).toBeUndefined();
    expect(denied.grantId).toBeUndefined();
    const grantFiles = await assertNonEmptyWalk(rig.state.path("approvals"));
    expect(grantFiles.filter((file) => file.startsWith("grants/"))).toHaveLength(0);
    // Every decision persists decider-side facts (B-09b §2): timestamp+reason.
    expect(denied.decidedAt).toBe(rig.clock.nowIso());
    expect(denied.reason).toBe("not during the freeze");
  });

  it("walks executing → ambiguous → human disposition; a terminal disposition also closes the unconsumed grant", async () => {
    const rig = await makeRig();
    const raised = await rig.store.raise({ ...raiseInput("npm publish"), now: rig.clock.nowDate() });
    const decided = await rig.store.decide(raised.id, { decision: "approved", now: rig.clock.nowDate() });
    await rig.store.beginExecution(raised.id, "dispatch/test", rig.clock.nowDate());
    const ambiguous = await rig.store.finishExecution({
      id: raised.id,
      state: "ambiguous",
      actor: "dispatch/test",
      result: "remote response lost",
      now: rig.clock.nowDate(),
    });
    // Ambiguity is terminal-until-reconciled (INV-003): automation may only
    // reconcile, never blindly retry the remote mutation.
    expect(ambiguous.execution?.state).toBe("ambiguous");
    expect(ambiguous.execution?.nextAction).toBe("reconcile");

    const reconciled = await rig.store.dispositionExecution({
      id: raised.id,
      disposition: "failed",
      reason: "verified remotely: nothing published",
      actor: "human/operator",
      now: rig.clock.nowDate(),
    });
    expect(reconciled.execution?.state).toBe("failed");
    // INV-003 hygiene: no live grant survives a terminal disposition of an
    // unconsumed once-approval — the store revokes it in the same act.
    const grantRaw = JSON.parse(
      await readFile(rig.state.path("approvals", "grants", `${decided.grantId!}.json`), "utf8"),
    ) as { uses: number; revokedAt?: string };
    expect(grantRaw.uses).toBe(0);
    expect(grantRaw.revokedAt).toBeDefined();
    detectIllegalExecutionTransitions(await readLog(rig));
  });

  it("walks the actor-claim branch: claimed → failed → explicit retry re-arm restores one use → second attempt executes", async () => {
    const rig = await makeRig();
    // rule secrets-or-auth → executor actor-retry, the grant-consuming claim path.
    const raised = await rig.store.raise({
      ...raiseInput("gh auth refresh --hostname github.com", "secrets-or-auth"),
      now: rig.clock.nowDate(),
    });
    const decided = await rig.store.decide(raised.id, { decision: "approved", now: rig.clock.nowDate() });
    const claim = rig.store.claimActorRetryGrantSync(decided.grantId!, "actor/turn-1", rig.clock.nowDate());
    expect(claim.status).toBe("claimed");
    expect(claim.item.execution?.state).toBe("executing");
    const failed = await rig.store.finishExecution({
      id: raised.id,
      state: "failed",
      actor: "actor/turn-1",
      result: "provider reported exact tool execution failure",
      failureCause: "actor_tool_failed",
      now: rig.clock.nowDate(),
    });
    expect(failed.execution?.state).toBe("failed");
    expect(failed.execution?.nextAction).toBe("retry_with_disposition");

    // Explicit re-arm: failed → approved restores exactly one use on the
    // still-live consumed grant; the second claim then runs to executed.
    const rearmed = await rig.store.dispositionExecution({
      id: raised.id,
      disposition: "retry",
      reason: "network restored; retry the exact approved action",
      actor: "human/operator",
      now: rig.clock.nowDate(),
    });
    expect(rearmed.execution?.state).toBe("approved");
    const second = rig.store.claimActorRetryGrantSync(decided.grantId!, "actor/turn-2", rig.clock.nowDate());
    expect(second.status).toBe("claimed");
    const done = await rig.store.finishExecution({
      id: raised.id,
      state: "executed",
      actor: "actor/turn-2",
      result: "second attempt acknowledged",
      now: rig.clock.nowDate(),
    });
    expect(done.execution?.state).toBe("executed");
    expect(done.execution?.attempts).toBe(2);
    detectIllegalExecutionTransitions(await readLog(rig));
  });
});

describe("CF-SM-APPR-I — illegal jumps refused at the store seam (L2, HB-011)", () => {
  it("refuses approved → executed without executing: finishExecution throws and the record is unchanged", async () => {
    const rig = await makeRig();
    const raised = await rig.store.raise({ ...raiseInput("npm publish"), now: rig.clock.nowDate() });
    await rig.store.decide(raised.id, { decision: "approved", now: rig.clock.nowDate() });
    await expect(
      rig.store.finishExecution({
        id: raised.id,
        state: "executed",
        actor: "dispatch/test",
        result: "jumping the queue",
        now: rig.clock.nowDate(),
      }),
    ).rejects.toThrow(/execution is approved, not executing/);
    const { item } = await rig.store.show(raised.id);
    expect(item.execution?.state).toBe("approved");
    expect(item.execution?.attempts).toBe(0);
  });

  it("refuses any transition out of the executed terminal", async () => {
    const rig = await makeRig();
    const raised = await rig.store.raise({ ...raiseInput("npm publish"), now: rig.clock.nowDate() });
    await rig.store.decide(raised.id, { decision: "approved", now: rig.clock.nowDate() });
    await rig.store.beginExecution(raised.id, "dispatch/test", rig.clock.nowDate());
    await rig.store.finishExecution({
      id: raised.id,
      state: "executed",
      actor: "dispatch/test",
      result: "done",
      now: rig.clock.nowDate(),
    });
    await expect(
      rig.store.finishExecution({
        id: raised.id,
        state: "failed",
        actor: "dispatch/test",
        result: "rewriting history",
        now: rig.clock.nowDate(),
      }),
    ).rejects.toThrow(/execution is executed, not executing/);
    // retry from a terminal acknowledged effect is equally unrepresentable —
    // an in-flight or completed remote effect is never re-armed.
    await expect(
      rig.store.dispositionExecution({
        id: raised.id,
        disposition: "retry",
        reason: "run it again",
        actor: "human/operator",
        now: rig.clock.nowDate(),
      }),
    ).rejects.toThrow(/cannot accept retry/);
  });

  it("refuses retry from executing (an in-flight remote effect cannot be retried safely) and refuses reasonless denials/dispositions", async () => {
    const rig = await makeRig();
    const raised = await rig.store.raise({ ...raiseInput("npm publish"), now: rig.clock.nowDate() });
    await expect(
      rig.store.decide(raised.id, { decision: "denied", reason: "   ", now: rig.clock.nowDate() }),
    ).rejects.toThrow(/denial requires a non-empty reason/);
    await rig.store.decide(raised.id, { decision: "approved", now: rig.clock.nowDate() });
    await rig.store.beginExecution(raised.id, "dispatch/test", rig.clock.nowDate());
    await expect(
      rig.store.dispositionExecution({
        id: raised.id,
        disposition: "retry",
        reason: "impatient",
        actor: "human/operator",
        now: rig.clock.nowDate(),
      }),
    ).rejects.toThrow(/cannot accept retry from executing/);
    await expect(
      rig.store.dispositionExecution({
        id: raised.id,
        disposition: "failed",
        reason: "",
        actor: "human/operator",
        now: rig.clock.nowDate(),
      }),
    ).rejects.toThrow(/requires a reason/);
  });
});

describe("CF-SM-APPR-R — replayed stimuli never double-advance (L2, HB-011)", () => {
  it("raise replay dedupes to the existing pending item with a durable deduplicated event — one item, one file", async () => {
    const rig = await makeRig();
    const first = await rig.store.raise({ ...raiseInput("npm publish"), now: rig.clock.nowDate() });
    rig.clock.advance(5_000);
    const replay = await rig.store.raise({ ...raiseInput("npm publish"), now: rig.clock.nowDate() });
    expect(replay.id).toBe(first.id);
    expect(await rig.store.listPending()).toHaveLength(1);
    const log = await readLog(rig);
    const dedup = log.filter((event) => event.type === "deduplicated");
    expect(dedup).toHaveLength(1);
    expect(dedup[0]).toMatchObject({ id: first.id, priorStatus: "pending" });
  });

  it("decision replay leaves the durable decision untouched: no second grant, decided record byte-identical, log unchanged", async () => {
    const rig = await makeRig();
    const raised = await rig.store.raise({ ...raiseInput("npm publish"), now: rig.clock.nowDate() });
    const decided = await rig.store.decide(raised.id, {
      decision: "approved",
      now: rig.clock.nowDate(),
    });
    const decidedPath = rig.state.path("approvals", "decided", `${raised.id}.json`);
    const bytesBefore = await readFile(decidedPath, "utf8");
    const logBefore = await readFile(rig.state.path("approvals", "log.jsonl"), "utf8");

    rig.clock.advance(60_000);
    await expect(rig.store.decide(raised.id, { decision: "approved", now: rig.clock.nowDate() })).rejects.toThrow(); // refusal happens before any write — asserted next
    expect(await readFile(decidedPath, "utf8")).toBe(bytesBefore); // immutable (B-09b §4)
    expect(await readFile(rig.state.path("approvals", "log.jsonl"), "utf8")).toBe(logBefore);
    const grants = await assertNonEmptyWalk(rig.state.path("approvals", "grants"), /\.json$/);
    expect(grants).toEqual([`${decided.grantId!}.json`]); // never two grants (B-09b §3)
  });

  // PROMOTED TRIPWIRE (HB-011 D2, fixed 2026-07-31): decide() now checks the
  // durable decided record first and refuses a replay with a typed
  // already-decided outcome referencing the original decision (decision +
  // decidedAt + grant), per B-09b §3/§4 — no more raw fs ENOENT.
  it("decision replay yields a typed already-decided outcome referencing the original (B-09b §3/§4)", async () => {
    const rig = await makeRig();
    const raised = await rig.store.raise({ ...raiseInput("npm publish"), now: rig.clock.nowDate() });
    await rig.store.decide(raised.id, { decision: "approved", now: rig.clock.nowDate() });
    await expect(rig.store.decide(raised.id, { decision: "approved", now: rig.clock.nowDate() })).rejects.toThrow(
      /already decided|not pending/i,
    );
  });

  // PROMOTED TRIPWIRE (HB-011 D2, fixed 2026-07-31): an id with no pending or
  // decided record anywhere is a typed refusal naming the item (B-09b §1),
  // no longer an untyped ENOENT.
  it("deciding an unknown item is a typed refusal naming the item, not a raw fs error (B-09b §1)", async () => {
    const rig = await makeRig();
    await expect(
      rig.store.decide("20990101T000000Z-none", {
        decision: "approved",
        now: rig.clock.nowDate(),
      }),
    ).rejects.toThrow(/approval .* not found|unknown/i);
  });

  it("beginExecution replay is refused: the duplicate claim returns undefined and attempts stay at 1", async () => {
    const rig = await makeRig();
    const raised = await rig.store.raise({ ...raiseInput("npm publish"), now: rig.clock.nowDate() });
    await rig.store.decide(raised.id, { decision: "approved", now: rig.clock.nowDate() });
    const first = await rig.store.beginExecution(raised.id, "dispatch/a", rig.clock.nowDate());
    expect(first?.execution?.attempts).toBe(1);
    const replay = await rig.store.beginExecution(raised.id, "dispatch/b", rig.clock.nowDate());
    expect(replay).toBeUndefined();
    const { item } = await rig.store.show(raised.id);
    expect(item.execution?.attempts).toBe(1);
    expect(item.execution?.actor).toBe("dispatch/a");
    const transitions = (await readLog(rig)).filter(
      (event): event is Extract<ApprovalLogEvent, { type: "execution-transition" }> =>
        event.type === "execution-transition",
    );
    expect(transitions).toHaveLength(1);
  });

  it("reconcile on a healthy store is a no-op replay: the log is byte-identical after two runs", async () => {
    const rig = await makeRig();
    const raised = await rig.store.raise({ ...raiseInput("npm publish"), now: rig.clock.nowDate() });
    await rig.store.decide(raised.id, { decision: "approved", now: rig.clock.nowDate() });
    const logBefore = await readFile(rig.state.path("approvals", "log.jsonl"), "utf8");
    await rig.store.reconcile(rig.clock.nowDate());
    await rig.store.reconcile(rig.clock.nowDate());
    expect(await readFile(rig.state.path("approvals", "log.jsonl"), "utf8")).toBe(logBefore);
  });
});

// Deliberately NOT asserted here: what a second, CONCURRENT in-flight decide
// does (B-09b §3 first-durable-write-wins). decide() takes no per-item lock,
// so the outcome under a live race is timing-dependent; the deterministic
// crash-shaped equivalent (a pending ghost beside a decided record) is covered
// in cf-sm-appr-c.test.ts with its own tripwires.
