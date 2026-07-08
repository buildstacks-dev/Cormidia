// Tests grant-aware composition around the default critical-ops gate.
// Covers one-use approval grants, grant consumption, expired grants, mismatched
// action hashes, and re-escalation through the base gate.
// Uses a temp approval store only; no network, auth, real org state, or live
// clock is required.

import { describe, expect, it } from "vitest";
import { ApprovalStore } from "../src/org/approvals.js";
import { composeGate } from "../src/org/gate-compose.js";
import { defaultGate } from "../src/runtime/gate.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

const ACTION = { tool: "bash", input: { command: "cat .env" } };

describe("grant-aware gate composition", () => {
  it("a matching grant admits exactly one retry", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => "g1" });
    try {
      await store.raise({ app: "alpha", role: "builder", rule: "secrets-or-auth", action: ACTION });
      await store.decide("g1", {
        decision: "approved",
        now: new Date("2026-07-06T00:00:00Z"),
      });
      const gate = composeGate(defaultGate, store, {
        app: "alpha",
        role: "builder",
        now: () => new Date("2026-07-06T01:00:00Z"),
      });

      expect(gate(ACTION)).toEqual({ allow: true });
      expect(gate(ACTION)).toMatchObject({ allow: false, escalate: true });
      const grant = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(home.paths.grant("grant-g1"), "utf8"))) as { uses: number };
      expect(grant.uses).toBe(0);
      expect((await store.listPending()).map((item) => item.id)).toHaveLength(1);
    } finally {
      home.cleanup();
    }
  });

  it("expired or different-input grants fall through to the base gate and re-escalate", async () => {
    const home = makeOrgHome({ approvals: true });
    let n = 0;
    const store = new ApprovalStore(home.root, { idSource: () => `g2-${n++}` });
    try {
      await store.raise({ app: "alpha", role: "builder", rule: "secrets-or-auth", action: ACTION });
      await store.decide("g2-0", {
        decision: "approved",
        now: new Date("2026-07-06T00:00:00Z"),
        ttlMs: 1,
      });
      const gate = composeGate(defaultGate, store, {
        app: "alpha",
        role: "builder",
        now: () => new Date("2026-07-06T00:00:01Z"),
      });

      expect(gate(ACTION)).toMatchObject({ allow: false, escalate: true });
      expect(
        gate({ tool: "bash", input: { command: "cat OTHER.env" } }),
      ).toMatchObject({ allow: false, escalate: true });
      expect((await store.listPending())).toHaveLength(2);
    } finally {
      home.cleanup();
    }
  });
});
