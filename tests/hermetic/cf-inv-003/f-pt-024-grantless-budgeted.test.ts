// F-PT-024 (RESOLVED-ratified 2026-08-06, owner decision on #296) — the
// contract pin for grantless budgeted-tier accounting.
//
// The decided truth, so this never resurfaces as a suspected bug: a budgeted
// action with NO covering objective grant proceeds at the composed gate and
// is DELIBERATELY not counted toward any dollar accumulation. There is no
// per-action debit and no grantless hard bound. The per-action audit row is
// the complete, intended record; bounding a budgeted class is always
// available by creating an objective grant (use cap + ledger + ceiling +
// revocation), and the bare defaultGate keeps denying budgeted actions, so
// proceed semantics exist only where the audit surface exists.
//
// If a future change makes grantless budgeted actions debit dollars, trip a
// ceiling, or stop leaving audit rows, this spec fails — which is the point:
// that would be a POLICY change and needs its own owner decision, not a
// silent drift in either direction.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultGate } from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { composeGate } from "../../../src/org/gate-compose.js";
import { ObjectiveGrantStore } from "../../../src/org/objective-grants.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { makeTestClock } from "../../fixtures/clock.js";

const APP = "fpt024-app";
const ROLE = "builder";
// An owned-namespace force-push and an allowlisted fetch: the two budgeted
// families that exist without any per-app configuration.
const OWNED_PUSH: ToolAction = { tool: "bash", input: { command: "git push --force origin op/7-fix" } };
const NPM_FETCH: ToolAction = { tool: "bash", input: { command: "curl https://registry.npmjs.org/cormidia" } };

describe("F-PT-024 — grantless budgeted actions are audit-only, by owner decision (L2)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeWorld(): Promise<{
    home: TempStateHome;
    approvals: ApprovalStore;
    objectives: ObjectiveGrantStore;
    gate: ReturnType<typeof composeGate>;
  }> {
    const home = await makeTempStateHome({ name: "cf-fpt024" });
    cleanups.push(() => home.cleanup());
    const clock = makeTestClock("2026-08-06T16:00:00.000Z");
    const approvals = new ApprovalStore(home.stateHome);
    const objectives = new ObjectiveGrantStore(home.stateHome);
    const gate = composeGate(defaultGate, approvals, { app: APP, role: ROLE, now: () => clock.nowDate() });
    return { home, approvals, objectives, gate };
  }

  it("proceeds with exactly one audit row per action and accumulates NO dollars anywhere", async () => {
    const { home, approvals, objectives, gate } = await makeWorld();
    expect(gate(OWNED_PUSH)).toEqual({ allow: true });
    expect(gate(NPM_FETCH)).toEqual({ allow: true });
    expect(gate(OWNED_PUSH)).toEqual({ allow: true }); // and again — no count bound

    // The complete record: one budgeted-action audit row per proceed.
    const rows = objectives.readLogSync().filter((event) => event.type === "budgeted-action");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.rule).sort()).toEqual([
      "history-rewrite-owned",
      "history-rewrite-owned",
      "outbound-network",
    ]);

    // Deliberately NOT counted as spend: no grant, no ledger, no debit —
    // the objective-grants directory holds only the audit log.
    const dir = join(home.stateHome, "approvals", "objective-grants");
    expect(readdirSync(dir)).toEqual(["log.jsonl"]);
    expect(rows.every((row) => !("usd" in row))).toBe(true);

    // And no queue item was raised — free until it isn't, as ratified.
    expect(await approvals.listPending()).toHaveLength(0);
  });

  it("the opt-in bound still binds: with a covering grant the same action consumes uses and rides the ledgered path instead", async () => {
    const { approvals, objectives, gate } = await makeWorld();
    const grant = objectives.createSync({
      app: APP,
      objective: "bounded branch rebuilds",
      createdBy: "human/owner",
      repoNamespace: "cormidia/fpt024-app",
      spendCeilingUsd: 5,
      tiers: ["budgeted"],
      classes: ["history-rewrite-owned"],
      useCap: 1,
      now: new Date("2026-08-06T16:00:00.000Z"),
    });
    expect(gate(OWNED_PUSH)).toEqual({ allow: true });
    expect(objectives.readSync(grant.grantId).usesRemaining).toBe(0);
    // Cap exhausted ⇒ the grant no longer covers; the grantless audit-only
    // path takes over rather than anything silently widening.
    expect(gate(OWNED_PUSH)).toEqual({ allow: true });
    const log = objectives.readLogSync();
    expect(log.filter((event) => event.type === "objective-grant-used")).toHaveLength(1);
    expect(log.filter((event) => event.type === "budgeted-action")).toHaveLength(1);
    expect(await approvals.listPending()).toHaveLength(0);
  });

  it("the bare defaultGate still denies budgeted actions — proceed semantics exist only where the audit surface exists", () => {
    for (const action of [OWNED_PUSH, NPM_FETCH]) {
      const decision = defaultGate(action);
      expect(decision.allow).toBe(false);
      if (decision.allow === false) expect(decision.escalate).toBe(true);
    }
  });
});
