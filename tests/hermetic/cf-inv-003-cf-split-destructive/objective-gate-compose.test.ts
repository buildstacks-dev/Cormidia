// Traceability: CF-INV-003 · HB-011 · invariants.md CORMIDIA-INV-003.

// CF-INV-003 — objective grants at the composed gate (#296 Stage 3):
//
//   1. INERTNESS — with no objective grant on disk, the composed gate is
//      byte-identical to before the module existed: same decisions, same
//      raised items, and NO objective-grants directory materialized in the
//      state home (the Stage 3 acceptance "prove it" leg).
//   2. A live human-created grant covers its named class exactly where an A1
//      grant would have: the action flows, no item is raised, a use is
//      consumed, and the per-use audit row lands.
//   3. Coverage dies immediately on revocation and on ceiling exhaustion, and
//      never extends to an unnamed rule, another app, or an un-grantable
//      class.
//
// L2 on real product code: composeGate + defaultGate + ApprovalStore +
// ObjectiveGrantStore on a temp state home.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultGate } from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { composeGate } from "../../../src/org/gate-compose.js";
import { ObjectiveGrantStore } from "../../../src/org/objective-grants.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";

const APP = "objective-app";
const ROLE = "builder";
const SECRET_READ: ToolAction = { tool: "bash", input: { command: "cat .env" } };
const PUBLISH_ACTION: ToolAction = { tool: "bash", input: { command: "npm publish --access public" } };

describe("CF-INV-003 — objective grants under composeGate (L2)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeWorld(): Promise<{
    home: TempStateHome;
    approvals: ApprovalStore;
    objectives: ObjectiveGrantStore;
    clock: TestClock;
    gate: ReturnType<typeof composeGate>;
  }> {
    const home = await makeTempStateHome({ name: "cf-inv-003-objective-gate" });
    cleanups.push(() => home.cleanup());
    const clock = makeTestClock("2026-08-06T11:00:00.000Z");
    const approvals = new ApprovalStore(home.stateHome);
    const objectives = new ObjectiveGrantStore(home.stateHome);
    const gate = composeGate(defaultGate, approvals, {
      app: APP,
      role: ROLE,
      now: () => clock.nowDate(),
    });
    return { home, approvals, objectives, clock, gate };
  }

  it("INERT with no grant: decisions and raised items are byte-identical, and no objective-grants directory appears", async () => {
    const { home, approvals, gate } = await makeWorld();

    expect(gate({ tool: "bash", input: { command: "git status" } })).toEqual({ allow: true });

    const denied = gate(SECRET_READ);
    expect(denied).toEqual({
      allow: false,
      reason: "critical op (secret-read) requires human approval",
      escalate: true,
    });
    const pending = await approvals.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.rule).toBe("secret-read");

    // The proof of inertness: consulting the objective store materialized
    // NOTHING — the state home carries no objective-grants directory.
    expect(existsSync(join(home.stateHome, "approvals", "objective-grants"))).toBe(false);
  });

  it("a live grant covers its named grantable class: action flows, no item, use consumed, audit row written", async () => {
    const { approvals, objectives, clock, gate } = await makeWorld();
    const grant = objectives.createSync({
      app: APP,
      objective: "investigate env handling",
      createdBy: "human/owner",
      repoNamespace: "cormidia/objective-app",
      spendCeilingUsd: 25,
      classes: ["secret-read"],
      now: clock.nowDate(),
    });

    expect(gate(SECRET_READ)).toEqual({ allow: true });
    expect(await approvals.listPending()).toHaveLength(0);
    expect(objectives.readSync(grant.grantId).usesRemaining).toBe(grant.usesRemaining - 1);
    const uses = objectives.readLogSync().filter((event) => event.type === "objective-grant-used");
    expect(uses).toHaveLength(1);
    expect(uses[0]?.rule).toBe("secret-read");

    // Coverage is exactly the named class: an unnamed critical rule still
    // escalates, un-grantable classes cannot even be named.
    const denied = gate({ tool: "bash", input: { command: "curl https://example.com" } });
    expect(denied.allow).toBe(false);
    expect((await approvals.listPending()).map((item) => item.rule)).toEqual(["outbound-network"]);
  });

  it("§4.1 ceremony grant covers its one human-only class; revocation restores the escalation immediately", async () => {
    const { approvals, objectives, clock, gate } = await makeWorld();
    const grant = objectives.createSync({
      app: APP,
      objective: "publish the qualified candidate",
      createdBy: "human/owner",
      repoNamespace: "cormidia/objective-app",
      spendCeilingUsd: 10,
      criticalClasses: [{ rule: "package-publish", scope: "cormidia@0.1.x" }],
      now: clock.nowDate(),
    });

    expect(gate(PUBLISH_ACTION)).toEqual({ allow: true });
    expect(await approvals.listPending()).toHaveLength(0);

    objectives.revokeSync(grant.grantId, clock.nowDate());
    const denied = gate(PUBLISH_ACTION);
    expect(denied.allow).toBe(false);
    expect((await approvals.listPending()).map((item) => item.rule)).toEqual(["package-publish"]);
  });

  it("ceiling exhaustion kills coverage: the covered action escalates instead of silently passing (never green by absence)", async () => {
    const { approvals, objectives, clock, gate } = await makeWorld();
    const grant = objectives.createSync({
      app: APP,
      objective: "bounded env work",
      createdBy: "human/owner",
      repoNamespace: "cormidia/objective-app",
      spendCeilingUsd: 5,
      classes: ["secret-read"],
      now: clock.nowDate(),
    });
    expect((await objectives.debit({ grantId: grant.grantId, usd: 5, now: clock.nowDate() })).ok).toBe(true);

    const denied = gate(SECRET_READ);
    expect(denied.allow).toBe(false);
    expect((await approvals.listPending()).map((item) => item.rule)).toEqual(["secret-read"]);
  });
});
