// CF-INV-003 — Stage 2 tier tightenings enforced at the approval store
// (#296; docs/approvals/consequence-classification-implementation-plan.md):
//
//   1. Every reclassified rule — protocol-self-edit, scorecard-tamper,
//      approval-store-tamper, learning-surface-tamper (grantable→UG),
//      dns-or-domain (grantable→HO), gate-implementation-edit (new, UG) —
//      refuses a scope-widening decision and refuses an agent decider.
//      Before Stage 2, dns-or-domain and learning-surface-tamper permitted
//      BOTH: those legs are the red state this detector was born against.
//   2. A standing (multi-use, scoped) grant on disk for a now human-only or
//      un-grantable rule never matches — defense in depth against a grant
//      minted before the tightening or forged past decide(). A scoped grant
//      for a still-grantable rule keeps matching (positive control), so the
//      guard is tier-scoped, not a blanket refusal.
//   3. The per-instance path is preserved: a fresh single-use human approval
//      of an un-grantable rule still mints a grant that matches its exact
//      action — un-grantable forbids standing coverage, not the reviewed
//      approve→execute path (no deadlock).
//
// L2 on real product code: ApprovalStore + composeGate on a temp state home.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultGate } from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";
import {
  ACTION_IDENTITY_VERSION,
  actionHash,
  ApprovalStore,
  type ApprovalGrant,
  type ApprovalItem,
} from "../../../src/org/approvals.js";
import { composeGate, grantScopeText } from "../../../src/org/gate-compose.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";

const APP = "gated-app";
const ROLE = "builder";

/** The six Stage 2 reclassifications, each with its refusal expectations. */
const TIGHTENED_RULES = [
  "protocol-self-edit",
  "scorecard-tamper",
  "approval-store-tamper",
  "learning-surface-tamper",
  "dns-or-domain",
  "gate-implementation-edit",
] as const;

describe("CF-INV-003 — Stage 2 tightenings at the store (L2)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeStore(): Promise<{ home: TempStateHome; store: ApprovalStore; clock: TestClock }> {
    const home = await makeTempStateHome({ name: "cf-inv-003-stage2" });
    cleanups.push(() => home.cleanup());
    return { home, store: new ApprovalStore(home.stateHome), clock: makeTestClock("2026-08-06T09:00:00.000Z") };
  }

  /** Plant a decided-approved item plus a live scoped (multi-use) grant for
   *  `rule`, exactly as a pre-tightening decision would have persisted them. */
  async function plantScopedGrant(home: TempStateHome, rule: string, id: string, now: Date): Promise<ApprovalGrant> {
    const action: ToolAction = { tool: "bash", input: { command: `./legacy-${id}.sh` } };
    const item: ApprovalItem = {
      id,
      app: APP,
      role: ROLE,
      rule,
      action: { tool: "bash", input: { command: `./legacy-${id}.sh` } },
      raisedAt: now.toISOString(),
      status: "approved",
      decision: "approved",
      decidedAt: now.toISOString(),
      decidedBy: { kind: "human", identity: "human/operator" },
      reason: "pre-tightening widened approval",
      grantId: `grant-${id}`,
    };
    const grant: ApprovalGrant = {
      grantId: `grant-${id}`,
      approvalId: id,
      app: APP,
      role: ROLE,
      actionHash: actionHash(action),
      identityVersion: ACTION_IDENTITY_VERSION,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      uses: 20,
      createdAt: now.toISOString(),
      scope: { kind: "app", rule },
    };
    await writeFile(join(home.stateHome, "approvals", "decided", `${id}.json`), JSON.stringify(item, null, 2));
    await writeFile(join(home.stateHome, "approvals", "grants", `grant-${id}.json`), JSON.stringify(grant, null, 2));
    return grant;
  }

  for (const rule of TIGHTENED_RULES) {
    it(`${rule}: scope-widening refused, agent decider refused, item stays pending and grantless`, async () => {
      const { store, clock } = await makeStore();
      const raised = await store.raise({
        app: APP,
        role: ROLE,
        rule,
        action: { tool: "bash", input: { command: `./tightened-${rule}.sh` } },
        now: clock.nowDate(),
      });

      // SEEDED VIOLATION (a): the human tries to widen the grant.
      await expect(
        store.decide(raised.id, { decision: "approved", scope: { kind: "app" }, now: clock.nowDate() }),
      ).rejects.toThrow(/never scopeable/);

      // SEEDED VIOLATION (b): an agent identity tries to decide it.
      await expect(
        store.decide(raised.id, {
          decision: "approved",
          decidedBy: { kind: "agent", identity: "agent/operator" },
          reason: "agent drain",
          now: clock.nowDate(),
        }),
      ).rejects.toThrow(/requires a human decision/);

      const pending = (await store.listPending()).find((item) => item.id === raised.id);
      expect(pending).toBeDefined();
      expect(pending?.grantId).toBeUndefined();
    });
  }

  it("a standing scoped grant for a now-tightened rule never matches — even planted on disk with a decided-approved owner", async () => {
    const { home, store, clock } = await makeStore();
    const now = clock.nowDate();
    for (const [index, rule] of (
      ["dns-or-domain", "learning-surface-tamper", "protocol-self-edit"] as const
    ).entries()) {
      await plantScopedGrant(home, rule, `20260806T0900${index}0Z-st${index}g`, now);
      const covered: ToolAction = { tool: "bash", input: { command: `./covered-${rule}.sh` } };
      expect(
        store.findMatchingGrantSync({
          app: APP,
          role: ROLE,
          actionHash: actionHash(covered),
          rule,
          actionText: grantScopeText(covered),
          now,
        }),
        `${rule} scoped grant must be dead`,
      ).toBeUndefined();
    }
  });

  it("positive control: an identical standing scoped grant for a still-grantable rule (secrets-or-auth) keeps matching — the guard is tier-scoped", async () => {
    const { home, store, clock } = await makeStore();
    const now = clock.nowDate();
    const planted = await plantScopedGrant(home, "secrets-or-auth", "20260806T090040Z-stpos", now);
    const covered: ToolAction = { tool: "bash", input: { command: "./covered-secrets.sh" } };
    expect(
      store.findMatchingGrantSync({
        app: APP,
        role: ROLE,
        actionHash: actionHash(covered),
        rule: "secrets-or-auth",
        actionText: grantScopeText(covered),
        now,
      })?.grantId,
    ).toBe(planted.grantId);
  });

  it("the per-instance path survives the tightening: a fresh single-use human approval of an un-grantable rule still covers its exact action (no deadlock)", async () => {
    const { store, clock } = await makeStore();
    const action: ToolAction = { tool: "write_file", input: { path: "roles.yaml", content: "builder: {}" } };
    const raised = await store.raise({
      app: APP,
      role: ROLE,
      rule: "protocol-self-edit",
      action,
      now: clock.nowDate(),
    });
    const decided = await store.decide(raised.id, {
      decision: "approved",
      reason: "human-reviewed protocol change",
      now: clock.nowDate(),
    });
    expect(decided.grantId).toBeDefined();
    expect(
      store.findMatchingGrantSync({
        app: APP,
        role: ROLE,
        actionHash: actionHash(action),
        now: clock.nowDate(),
      })?.grantId,
    ).toBe(decided.grantId);
  });

  it("end to end: a dns-classifying action under composeGate escalates to a fresh item even while a planted scoped dns grant sits live on disk", async () => {
    const { home, store, clock } = await makeStore();
    const now = clock.nowDate();
    await plantScopedGrant(home, "dns-or-domain", "20260806T090050Z-stdns", now);
    const gate = composeGate(defaultGate, store, { app: APP, role: ROLE, now: () => clock.nowDate() });
    const action: ToolAction = { tool: "write_file", input: { path: "dns/nameserver.conf", content: "ns1." } };
    const decision = gate(action);
    expect(decision.allow).toBe(false);
    const pending = await store.listPending();
    expect(pending.map((item) => item.rule)).toContain("dns-or-domain");
  });
});
