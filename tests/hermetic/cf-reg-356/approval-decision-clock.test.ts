// CF-REG-356 (L1/L2) — the approval store's time source is injected, never the
// host wall clock (#356; B-06 contract §1 "all time reads flow through one
// injectable clock source").
//
// The defect this deposits a detector for was a dormant time bomb, not a
// visible failure: `ApprovalStore` defaulted every `now` to `new Date()`, so a
// caller whose world is pinned to a fixed instant raised items at the fixture
// instant and had them judged against real time. Nothing was wrong on the day
// such a case was written — it went red for the first time once real time
// passed `raisedAt + pendingTtlMs`, and then stayed red forever (main went red
// 2026-08-07 when CF-SPLIT-NETWORK's 2026-08-06T13:00Z fixture aged out and a
// TTL-expiry error pre-empted the never-scopeable refusal under assertion).
//
// So every case here pins the clock at 2020-01-01 — decades stale, and stale by
// more every day. A store that consults real time fails these on the day they
// are written, not a year later. The mirror cases prove the seam changed the
// time SOURCE and not approval semantics: expiry still expires, a settled
// decision still settles exactly once, and the production default is still real
// wall time.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalDecisionConflictError, ApprovalStore } from "../../../src/org/approvals.js";
import type { ToolAction } from "../../../src/runtime/types.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";

const APP = "clock-app";
const ROLE = "builder";
const RULE = "outbound-network";
const ACTION: ToolAction = { tool: "bash", input: { command: "curl https://example.invalid/probe" } };
/** Decades before any plausible run date, and further every day. */
const LONG_PAST = "2020-01-01T00:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1_000;

const APPROVALS_SRC = fileURLToPath(new URL("../../../src/org/approvals.ts", import.meta.url));

describe("CF-REG-356 — the approval decision path takes its time from the injected clock", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeWorld(): Promise<{ home: TempStateHome; store: ApprovalStore; clock: TestClock }> {
    const home = await makeTempStateHome({ name: "cf-reg-356" });
    cleanups.push(() => home.cleanup());
    const clock = makeTestClock(LONG_PAST);
    return { home, store: new ApprovalStore(home.stateHome, { now: clock.dateFn }), clock };
  }

  it("the store's own `now` default is the injected clock, not the wall clock", async () => {
    const { store, clock } = await makeWorld();
    const raised = await store.raise({ app: APP, role: ROLE, rule: RULE, action: ACTION });

    // A store reading real time stamps this with today. Red on day one.
    expect(raised.raisedAt).toBe(LONG_PAST);
    expect(clock.now()).toBe(new Date(LONG_PAST).getTime());
  });

  it("a decision on an item raised at the pinned instant is recorded, not expired", async () => {
    const { store, clock } = await makeWorld();
    // The exact #356 shape: the raising seam carries the pinned instant (a gate
    // with a clock), the decision is taken with the store's default.
    const raised = await store.raise({
      app: APP,
      role: ROLE,
      rule: RULE,
      action: ACTION,
      now: clock.nowDate(),
    });

    const decided = await store.decide(raised.id, { decision: "approved" });

    expect(decided).toMatchObject({ id: raised.id, status: "approved", decision: "approved" });
    expect(decided.decidedAt).toBe(LONG_PAST);
    expect(decided.expiredAt).toBeUndefined();
    expect((await store.listDecided()).map((item) => item.id)).toEqual([raised.id]);
    expect(await store.listPending()).toEqual([]);
  });

  it("TTL expiry still expires — the seam moved the clock, not the semantics", async () => {
    const { store, clock } = await makeWorld();
    const raised = await store.raise({ app: APP, role: ROLE, rule: RULE, action: ACTION });

    clock.advance(DAY_MS + 1);

    await expect(store.decide(raised.id, { decision: "approved" })).rejects.toThrow(
      new RegExp(`approval ${raised.id} expired at`),
    );
    const durable = (await store.show(raised.id)).item;
    expect(durable).toMatchObject({ id: raised.id, status: "expired" });
    expect(durable.expiredAt).toBe(new Date(new Date(LONG_PAST).getTime() + DAY_MS + 1).toISOString());
    expect(durable.grantId).toBeUndefined();
    expect(await store.listPending()).toEqual([]);
    expect((await store.readLog()).filter((event) => event.type === "expired")).toHaveLength(1);
  });

  it("a decided item still settles exactly once under the injected clock", async () => {
    const { store } = await makeWorld();
    const raised = await store.raise({ app: APP, role: ROLE, rule: RULE, action: ACTION });
    await store.decide(raised.id, { decision: "approved" });

    const second = store.decide(raised.id, { decision: "denied", reason: "second settlement attempt" });
    await expect(second).rejects.toBeInstanceOf(ApprovalDecisionConflictError);
    expect((await store.listDecided()).map((item) => item.status)).toEqual(["approved"]);
  });

  it("production keeps real wall time: a store constructed with no clock reads it", async () => {
    const home = await makeTempStateHome({ name: "cf-reg-356-default" });
    cleanups.push(() => home.cleanup());
    const before = Date.now();
    const raised = await new ApprovalStore(home.stateHome).raise({
      app: APP,
      role: ROLE,
      rule: RULE,
      action: ACTION,
    });
    const raisedAt = new Date(raised.raisedAt).getTime();

    expect(raisedAt).toBeGreaterThanOrEqual(before - 1_000);
    expect(raisedAt).toBeLessThanOrEqual(Date.now() + 1_000);
  });

  // SEEDED-VIOLATION SHAPE (structural, B-06 §1 "direct wall-clock reads
  // outside it are a harness-detectable defect"): re-introducing an
  // argument-less `new Date()` anywhere in the store re-arms exactly the #356
  // bomb — behavioral cases above would only catch it once the offending path
  // is exercised with a pinned clock. One production read, at the seam.
  it("the store reads the wall clock in exactly one place — the injectable default", () => {
    const source = readFileSync(APPROVALS_SRC, "utf8");
    const wallClockReads = source.match(/new Date\(\s*\)/g) ?? [];

    expect(wallClockReads).toHaveLength(1);
    expect(source).toContain("this.clock = options.now ?? (() => new Date());");
  });
});
