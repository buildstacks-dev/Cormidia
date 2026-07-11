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

  it("a ticket-scoped grant covers rule+path matches across differing commands (A1)", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => "s1" });
    try {
      await store.raise({
        app: "alpha",
        role: "builder",
        rule: "secrets-or-auth",
        ticketRef: "#2",
        action: { tool: "bash", input: { command: "cat secrets.json" } },
      });
      await store.decide("s1", {
        decision: "approved",
        scope: { kind: "ticket", pathContains: "secrets.json" },
        maxUses: 3,
        now: new Date("2026-07-06T00:00:00Z"),
      });
      const gate = composeGate(defaultGate, store, {
        app: "alpha",
        role: "builder",
        ticketRef: "#2",
        now: () => new Date("2026-07-06T01:00:00Z"),
      });

      // Different command, same rule + path + ticket → covered, repeatedly.
      expect(gate({ tool: "bash", input: { command: "wc -l secrets.json" } })).toEqual({ allow: true });
      expect(gate({ tool: "bash", input: { command: "head secrets.json" } })).toEqual({ allow: true });
      // Same rule, different path → out of scope, escalates fresh.
      expect(gate({ tool: "bash", input: { command: "cat .env" } })).toMatchObject({
        allow: false,
        escalate: true,
      });
      // Same rule + path but a DIFFERENT ticket → out of scope.
      const otherTicket = composeGate(defaultGate, store, {
        app: "alpha",
        role: "builder",
        ticketRef: "#9",
        now: () => new Date("2026-07-06T01:00:00Z"),
      });
      expect(otherTicket({ tool: "bash", input: { command: "cat secrets.json" } })).toMatchObject({
        allow: false,
        escalate: true,
      });
    } finally {
      home.cleanup();
    }
  });

  it("a revoked scoped grant never matches again (A1 revocation)", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => "s2" });
    try {
      await store.raise({
        app: "alpha",
        role: "builder",
        rule: "secrets-or-auth",
        action: { tool: "bash", input: { command: "cat secrets.json" } },
      });
      await store.decide("s2", {
        decision: "approved",
        scope: { kind: "app" },
        now: new Date("2026-07-06T00:00:00Z"),
      });
      const gate = composeGate(defaultGate, store, {
        app: "alpha",
        role: "builder",
        now: () => new Date("2026-07-06T01:00:00Z"),
      });
      expect(gate({ tool: "bash", input: { command: "cat secrets.json" } })).toEqual({ allow: true });

      store.revokeGrantSync("grant-s2", new Date("2026-07-06T01:30:00Z"));
      expect(gate({ tool: "bash", input: { command: "cat secrets.json" } })).toMatchObject({
        allow: false,
        escalate: true,
      });
    } finally {
      home.cleanup();
    }
  });

  it("never-scopeable rules reject a widened decision outright (A1)", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => "s3" });
    try {
      await store.raise({
        app: "alpha",
        role: "sre",
        rule: "production-deploy",
        action: { tool: "bash", input: { command: "doctl apps create-deployment 1" } },
      });
      await expect(
        store.decide("s3", { decision: "approved", scope: { kind: "app" } }),
      ).rejects.toThrow(/never scopeable/);
    } finally {
      home.cleanup();
    }
  });

  it("role shaping: builder self-merge is denied flat — no approval item, lesson persisted (A5)", async () => {
    const home = makeOrgHome({ approvals: true, memory: true });
    const store = new ApprovalStore(home.root);
    try {
      const gate = composeGate(defaultGate, store, {
        app: "alpha",
        role: "builder",
        orgHome: home.root,
        now: () => new Date("2026-07-06T01:00:00Z"),
      });

      const decision = gate({ tool: "bash", input: { command: "gh pr merge 7 --squash" } });
      expect(decision).toMatchObject({ allow: false, escalate: false });
      expect(decision.reason).toContain("forbidden for the builder role");
      // No human decision burned: the queue stays empty.
      expect(await store.listPending()).toEqual([]);
      // The lesson is durable and deduplicated.
      const { readFileSync } = await import("node:fs");
      const lessons = readFileSync(`${home.root}/memory/roles/builder/denial-lessons.md`, "utf8");
      expect(lessons).toContain("[self-merge-or-approve]");
      gate({ tool: "bash", input: { command: "gh pr merge 8 --squash" } });
      const again = readFileSync(`${home.root}/memory/roles/builder/denial-lessons.md`, "utf8");
      expect(again.match(/\[self-merge-or-approve\]/g)).toHaveLength(1);
    } finally {
      home.cleanup();
    }
  });

  it("role shaping: the SRE's deploy still escalates to the human (not forbidden)", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root);
    try {
      const gate = composeGate(defaultGate, store, {
        app: "alpha",
        role: "sre",
        now: () => new Date("2026-07-06T01:00:00Z"),
      });
      expect(gate({ tool: "bash", input: { command: "doctl apps create-deployment 1" } })).toMatchObject({
        allow: false,
        escalate: true,
      });
      expect(await store.listPending()).toHaveLength(1);
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
