// CF-SPLIT-DESTRUCTIVE (L2) — the budgeted tier at the composed gate (#296,
// F-PT-023 ratified; owner decision 3: force-push follows the namespace the
// orchestrator already owns — budgeted there, human-only everywhere else).
//
// Ratified semantics: a budgeted action PROCEEDS — "free until it isn't" —
// and every proceed is visible: a covering objective grant's use/ledger when
// one exists, and always a per-action audit row. The refusal paths keep
// precedence: role shaping, a governed denial on the exact action, and the
// human-only foreign case all still stop the action. The bare defaultGate
// (no audit surface) keeps denying budgeted actions — the proceed semantics
// live exactly where the accounting lives (the grantless accounting quantum
// is F-PT-024).

import { afterEach, describe, expect, it } from "vitest";
import { defaultGate } from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { composeGate } from "../../../src/org/gate-compose.js";
import { ObjectiveGrantStore } from "../../../src/org/objective-grants.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";

const APP = "split-app";
const ROLE = "builder";
const OWNED_PUSH: ToolAction = { tool: "bash", input: { command: "git push --force origin op/7-fix" } };
const FOREIGN_PUSH: ToolAction = { tool: "bash", input: { command: "git push --force origin main" } };

describe("CF-SPLIT-DESTRUCTIVE — budgeted force-push at the composed gate (L2)", () => {
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
    const home = await makeTempStateHome({ name: "cf-split-destructive" });
    cleanups.push(() => home.cleanup());
    const clock = makeTestClock("2026-08-06T12:00:00.000Z");
    const approvals = new ApprovalStore(home.stateHome);
    const objectives = new ObjectiveGrantStore(home.stateHome);
    const gate = composeGate(defaultGate, approvals, { app: APP, role: ROLE, now: () => clock.nowDate() });
    return { home, approvals, objectives, clock, gate };
  }

  it("an owned-namespace force-push PROCEEDS with a per-action audit row and no queue item — visible, never silent", async () => {
    const { approvals, objectives, gate } = await makeWorld();
    expect(gate(OWNED_PUSH)).toEqual({ allow: true });
    expect(await approvals.listPending()).toHaveLength(0);
    const rows = objectives.readLogSync().filter((event) => event.type === "budgeted-action");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ app: APP, rule: "history-rewrite-owned" });
  });

  it("a covering objective grant takes precedence: use consumed, per-use audit row, no grantless row", async () => {
    const { approvals, objectives, clock, gate } = await makeWorld();
    const grant = objectives.createSync({
      app: APP,
      objective: "rebuild interrupted ticket branches",
      createdBy: "human/owner",
      repoNamespace: "cormidia/split-app",
      spendCeilingUsd: 10,
      tiers: ["budgeted"],
      classes: ["history-rewrite-owned"],
      now: clock.nowDate(),
    });
    expect(gate(OWNED_PUSH)).toEqual({ allow: true });
    expect(await approvals.listPending()).toHaveLength(0);
    expect(objectives.readSync(grant.grantId).usesRemaining).toBe(grant.usesRemaining - 1);
    const log = objectives.readLogSync();
    expect(log.filter((event) => event.type === "objective-grant-used")).toHaveLength(1);
    expect(log.filter((event) => event.type === "budgeted-action")).toHaveLength(0);
  });

  it("the foreign case stays a hard stop: human-only escalation, never the budgeted proceed", async () => {
    const { approvals, gate } = await makeWorld();
    const decision = gate(FOREIGN_PUSH);
    expect(decision.allow).toBe(false);
    expect((await approvals.listPending()).map((item) => item.rule)).toEqual(["history-rewrite-foreign"]);
  });

  it("a governed denial on the exact action keeps precedence over the budgeted proceed", async () => {
    const { approvals, objectives, clock, gate } = await makeWorld();
    const raised = await approvals.raise({
      app: APP,
      role: ROLE,
      rule: "history-rewrite-owned",
      action: OWNED_PUSH,
      now: clock.nowDate(),
    });
    await approvals.decide(raised.id, {
      decision: "denied",
      reason: "this branch must not be rebuilt while the incident is open",
      now: clock.nowDate(),
    });
    const decision = gate(OWNED_PUSH);
    expect(decision.allow).toBe(false);
    expect(objectives.readLogSync().filter((event) => event.type === "budgeted-action")).toHaveLength(0);
  });

  it("the bare defaultGate keeps denying budgeted actions — proceed semantics exist only where the audit surface exists", () => {
    const decision = defaultGate(OWNED_PUSH);
    expect(decision.allow).toBe(false);
    if (decision.allow === false) expect(decision.escalate).toBe(true);
  });
});
