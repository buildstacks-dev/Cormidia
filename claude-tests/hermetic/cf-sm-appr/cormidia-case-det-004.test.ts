// CORMIDIA-CASE-DET-004 / TM-011 — concurrent decisions on one approval
// identity must converge on exactly one authoritative result. This detector
// was landed red-before-green against #199.

import { afterEach, describe, expect, it } from "vitest";
import { readdir } from "node:fs/promises";
import {
  ApprovalDecisionConflictError,
  ApprovalStore,
  type ApprovalItem,
  type ApprovalLogEvent,
  type DecideApprovalInput,
} from "../../../src/org/approvals.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const homes: TempStateHome[] = [];

afterEach(async () => {
  for (const home of homes.splice(0).reverse()) await home.cleanup();
});

describe("CORMIDIA-CASE-DET-004 — decision contention", () => {
  async function makeRig(options: ConstructorParameters<typeof ApprovalStore>[1] = {}) {
    const home = await makeTempStateHome({ name: "det-004" });
    homes.push(home);
    const store = new ApprovalStore(home.stateHome, options);
    const raised = await store.raise({
      app: "contention-app",
      role: "sre",
      rule: "outbound-network",
      action: { tool: "Bash", input: { command: "curl https://example.invalid" } },
    });
    return { home, store, raised };
  }

  async function assertAuthorityAgreement(
    home: TempStateHome,
    store: ApprovalStore,
    raised: ApprovalItem,
    results: PromiseSettledResult<ApprovalItem>[],
  ): Promise<void> {
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<ApprovalItem> => result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (fulfilled.length !== 1) throw new Error(`detector: expected one winner, got ${fulfilled.length}`);
    if (rejected.length !== 1) throw new Error(`detector: expected one conflict, got ${rejected.length}`);
    if (!(rejected[0]!.reason instanceof ApprovalDecisionConflictError)) {
      throw new Error(`detector: loser was not a typed already-decided conflict: ${String(rejected[0]!.reason)}`);
    }

    const durable = (await store.show(raised.id)).item;
    const decisions = (await store.readLog()).filter(
      (event): event is Extract<ApprovalLogEvent, { type: "decided" }> => event.type === "decided",
    );
    const grants = (await readdir(home.path("approvals", "grants"))).filter((file) => file.endsWith(".json"));
    if (durable.decision !== fulfilled[0]!.value.decision) {
      throw new Error("detector: caller result and authoritative item disagree");
    }
    if (decisions.length !== 1 || decisions[0]!.decision !== durable.decision) {
      throw new Error("detector: decision log and authoritative item disagree");
    }
    if (grants.length !== (durable.decision === "approved" ? 1 : 0)) {
      throw new Error("detector: grant bytes disagree with the authoritative decision");
    }
  }

  const approve: DecideApprovalInput = {
    decision: "approved",
    reason: "approved for the exact action",
    decidedBy: { kind: "human", identity: "human/alice" },
  };
  const deny: DecideApprovalInput = {
    decision: "denied",
    reason: "the action is not justified",
    decidedBy: { kind: "human", identity: "human/bob" },
  };

  for (const [name, decisions] of [
    ["approve/deny", [approve, deny]],
    ["deny/approve", [deny, approve]],
    ["duplicate approve delivery", [approve, approve]],
  ] as const) {
    it(`${name}: one winner, one typed conflict, and every durable surface agrees`, async () => {
      const { home, store, raised } = await makeRig();

      const results = await Promise.allSettled(
        decisions.map((decision) => store.decide(raised.id, decision)),
      );

      await assertAuthorityAgreement(home, store, raised, results);
    });
  }

  it("recovers an interruption after the decision event without a duplicate event or grant", async () => {
    let crashed = false;
    const { home, store, raised } = await makeRig({
      decisionFault: (boundary) => {
        if (!crashed && boundary === "after_decision_log") {
          crashed = true;
          throw new Error("seeded crash after decision log");
        }
      },
    });
    await expect(store.decide(raised.id, approve)).rejects.toThrow(/seeded crash/);

    await store.reconcile();
    await expect(store.decide(raised.id, deny)).rejects.toBeInstanceOf(ApprovalDecisionConflictError);
    const durable = (await store.show(raised.id)).item;
    expect(durable).toMatchObject({ decision: "approved", decidedBy: approve.decidedBy });
    const decisions = (await store.readLog()).filter(
      (event): event is Extract<ApprovalLogEvent, { type: "decided" }> => event.type === "decided",
    );
    expect(decisions).toHaveLength(1);
    const grants = (await readdir(home.path("approvals", "grants"))).filter((file) => file.endsWith(".json"));
    expect(grants).toEqual([`grant-${raised.id}.json`]);
  });

  it("an interruption before the decision event cannot leave authority for a later denial", async () => {
    let crashed = false;
    const { home, store, raised } = await makeRig({
      decisionFault: (boundary) => {
        if (!crashed && boundary === "after_grant") {
          crashed = true;
          throw new Error("seeded crash after orphan grant");
        }
      },
    });
    await expect(store.decide(raised.id, approve)).rejects.toThrow(/seeded crash/);
    expect(await readdir(home.path("approvals", "grants"))).toEqual([`grant-${raised.id}.json`]);

    const denied = await store.decide(raised.id, deny);
    expect(denied.decision).toBe("denied");
    expect(await readdir(home.path("approvals", "grants"))).toEqual([]);
    expect((await store.readLog()).filter((event) => event.type === "decided")).toHaveLength(1);
  });

  it("negative control: the detector fires on the exact contradictory TM-011 snapshot", async () => {
    const { home, store, raised } = await makeRig();
    const winner = await store.decide(raised.id, approve);
    const seededContradiction: PromiseSettledResult<ApprovalItem>[] = [
      { status: "fulfilled", value: { ...winner, status: "denied", decision: "denied" } },
      { status: "fulfilled", value: winner },
    ];
    await expect(
      assertAuthorityAgreement(home, store, raised, seededContradiction),
    ).rejects.toThrow(/expected one winner/);
  });
});
