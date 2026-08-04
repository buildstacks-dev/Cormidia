// CF-J05-R — refusal legs of the critical-op approval journey
// (contracts/journey-acceptance.md J-05; CORMIDIA-INV-003 grant shapes;
// docs/approvals/design.md A1 via NEVER_SCOPEABLE_RULES; risk E-1):
// the deny path with durable recurrence, never-broadly-scopeable ops
// refusing scoped grants, and unknown-item refusal.
//
// L2 on real product code: composeGate + defaultGate + ApprovalStore on a
// temp state home. No execution surface is reachable in any leg — that is
// the point of the family.

import { afterEach, describe, expect, it } from "vitest";
import { defaultGate } from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";
import {
  ApprovalStore,
  NEVER_SCOPEABLE_RULES,
  type ApprovalLogEvent,
} from "../../../src/org/approvals.js";
import { composeGate } from "../../../src/org/gate-compose.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";

const APP = "gated-app";
const ROLE = "builder";
const CRITICAL_ACTION: ToolAction = { tool: "bash", input: { command: "rm -rf /var/data/legacy-exports" } };

describe("CF-J05-R — deny path, never-scopeable refusals, unknown-item refusal (L2)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeStore(): Promise<{ home: TempStateHome; store: ApprovalStore; clock: TestClock }> {
    const home = await makeTempStateHome({ name: "cf-j05-r" });
    cleanups.push(() => home.cleanup());
    return { home, store: new ApprovalStore(home.stateHome), clock: makeTestClock("2026-07-31T09:00:00.000Z") };
  }

  it("a denial requires a non-empty reason — a reasonless deny is refused with the item still pending", async () => {
    const { store, clock } = await makeStore();
    const raised = await store.raise({
      app: APP,
      role: ROLE,
      rule: "destructive-or-irreversible",
      action: CRITICAL_ACTION,
      now: clock.nowDate(),
    });
    await expect(store.decide(raised.id, { decision: "denied", now: clock.nowDate() })).rejects.toThrow(
      /non-empty reason/,
    );
    await expect(store.decide(raised.id, { decision: "denied", reason: "  ", now: clock.nowDate() })).rejects.toThrow(
      /non-empty reason/,
    );
    expect((await store.listPending()).map((item) => item.id)).toEqual([raised.id]);
  });

  it("negative control: re-attempting an exactly-denied action — the governed-denial detector FIRES flat (no new item, no escalation, durable recurrence row)", async () => {
    const { store, clock } = await makeStore();
    const gate = composeGate(defaultGate, store, {
      app: APP,
      role: ROLE,
      ticketRef: "#12",
      now: clock.dateFn,
    });

    // Raise through the real gate, then the human denies with a reason.
    expect(gate(CRITICAL_ACTION).allow).toBe(false);
    const raised = (await store.listPending())[0]!;
    const denied = await store.decide(raised.id, {
      decision: "denied",
      reason: "production data purge is out of scope for this ticket",
      now: clock.nowDate(),
    });
    expect(denied.status).toBe("denied");
    expect(denied.grantId).toBeUndefined(); // a denial mints nothing
    expect(denied.execution).toBeUndefined(); // and starts no execution record

    // SEEDED VIOLATION: the agent retries the exact denied action next turn.
    const retry = gate(CRITICAL_ACTION);
    if (retry.allow) throw new Error("gate unexpectedly allowed the denied action");
    expect(retry.escalate).toBe(false); // never re-litigated to the human
    expect(retry.reason).toContain(`governed denial ${raised.id}`);
    expect(retry.reason).toContain("out of scope");

    // No second item exists anywhere; the recurrence is a durable audit row.
    expect(await store.listPending()).toHaveLength(0);
    expect(await store.listDecided()).toHaveLength(1);
    const recurrences = (await store.readLog()).filter(
      (event): event is Extract<ApprovalLogEvent, { type: "deduplicated" }> =>
        event.type === "deduplicated" && event.priorStatus === "denied",
    );
    expect(recurrences).toHaveLength(1);
    expect(recurrences[0]!.id).toBe(raised.id);
  });

  it("negative control: every never-broadly-scopeable rule refuses a scope-widening decision — the A1 detector FIRES per rule, items stay pending", async () => {
    const { store, clock } = await makeStore();
    // The ratified list itself (INV-003: production deploys, external
    // publication, protocol-surface writes, the gate's roots of trust).
    expect(NEVER_SCOPEABLE_RULES.length).toBeGreaterThanOrEqual(6);

    for (const [index, rule] of NEVER_SCOPEABLE_RULES.entries()) {
      const raised = await store.raise({
        app: APP,
        role: ROLE,
        rule,
        // Distinct content per rule so raise-dedup never collapses the sweep.
        action: { tool: "bash", input: { command: `./op-${index}.sh --rule ${rule}` } },
        ticketRef: "#12",
        now: clock.nowDate(),
      });
      for (const scope of [
        { kind: "app" as const },
        { kind: "ticket" as const, pathContains: "src/" },
      ]) {
        // SEEDED VIOLATION: the human tries to widen this rule's grant.
        await expect(
          store.decide(raised.id, { decision: "approved", scope, now: clock.nowDate() }),
        ).rejects.toThrow(/never scopeable/);
      }
      // Refusal left the item pending, grantless, execution-free.
      const stillPending = (await store.listPending()).find((item) => item.id === raised.id);
      expect(stillPending).toBeDefined();
      expect(stillPending!.status).toBe("pending");
      expect(stillPending!.grantId).toBeUndefined();
    }

    // The refusals minted no grants at all.
    const log = await store.readLog();
    expect(log.some((event) => event.type === "grant-minted")).toBe(false);
    expect(log.some((event) => event.type === "decided")).toBe(false);
  });

  it("unknown items are refused on every decision/read surface", async () => {
    const { store, clock } = await makeStore();
    await expect(store.decide("20260731T000000Z-none", { decision: "approved", now: clock.nowDate() })).rejects.toThrow();
    await expect(store.show("20260731T000000Z-none")).rejects.toThrow(/not found/);
    await expect(
      store.dispositionExecution({
        id: "20260731T000000Z-none",
        disposition: "executed",
        reason: "no such item",
        actor: "human/operator",
        now: clock.nowDate(),
      }),
    ).rejects.toThrow(/not found/);
  });

  it("a decided item cannot be decided again — the decision boundary is one-shot", async () => {
    const { store, clock } = await makeStore();
    const raised = await store.raise({
      app: APP,
      role: ROLE,
      rule: "destructive-or-irreversible",
      action: CRITICAL_ACTION,
      now: clock.nowDate(),
    });
    await store.decide(raised.id, { decision: "approved", now: clock.nowDate() });
    // The pending file is gone; a second decision attempt has nothing to move.
    await expect(store.decide(raised.id, { decision: "approved", now: clock.nowDate() })).rejects.toThrow();
    await expect(
      store.decide(raised.id, { decision: "denied", reason: "changed my mind", now: clock.nowDate() }),
    ).rejects.toThrow();
  });
});
