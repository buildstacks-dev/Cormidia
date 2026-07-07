import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { actionHash, ApprovalStore } from "../src/org/approvals.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

const ACTION = { tool: "bash", input: { command: "cat .env" } };

describe("approval store", () => {
  it("raise writes a pending item and raised log event", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => "20260706T010203Z-abcd" });
    try {
      const item = await store.raise({
        app: "alpha",
        role: "builder",
        rule: "secrets-or-auth",
        action: ACTION,
        now: new Date("2026-07-06T01:02:03Z"),
      });

      expect(item.status).toBe("pending");
      expect(existsSync(home.paths.approvalsPending(item.id))).toBe(true);
      const log = await store.readLog();
      expect(log).toEqual([
        {
          type: "raised",
          id: item.id,
          at: "2026-07-06T01:02:03.000Z",
          app: "alpha",
          role: "builder",
          rule: "secrets-or-auth",
        },
      ]);
    } finally {
      home.cleanup();
    }
  });

  it("approve moves the item, mints a single-use grant, and logs in order", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => "a1" });
    try {
      const raised = await store.raise({
        app: "alpha",
        role: "builder",
        rule: "secrets-or-auth",
        action: ACTION,
        now: new Date("2026-07-06T01:00:00Z"),
      });
      const decided = await store.decide(raised.id, {
        decision: "approved",
        now: new Date("2026-07-06T02:00:00Z"),
      });

      expect(existsSync(home.paths.approvalsPending(raised.id))).toBe(false);
      expect(existsSync(home.paths.approvalsDecided(raised.id))).toBe(true);
      expect(decided.grantId).toBe("grant-a1");
      const grant = JSON.parse(readFileSync(home.paths.grant("grant-a1"), "utf8")) as { uses: number };
      expect(grant.uses).toBe(1);
      expect((await store.readLog()).map((event) => event.type)).toEqual([
        "raised",
        "decided",
        "grant-minted",
      ]);
    } finally {
      home.cleanup();
    }
  });

  it("persists the grant before the decided log, so a mid-decide crash still leaves a live grant", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => "ap1" });
    try {
      await store.raise({
        app: "alpha",
        role: "builder",
        rule: "secrets-or-auth",
        action: ACTION,
        now: new Date("2026-07-06T01:00:00Z"),
      });
      // Force moveToDecided (which runs AFTER the decided-log append) to throw,
      // simulating a crash mid-decide: its temp path is occupied by a directory.
      mkdirSync(join(home.root, "approvals", "decided", "ap1.json.tmp"), { recursive: true });
      await expect(
        store.decide("ap1", { decision: "approved", now: new Date("2026-07-06T02:00:00Z") }),
      ).rejects.toThrow();
      // The grant must already be on disk (written before the decided log), so a
      // gated turn finds it instead of re-escalating the approved decision.
      const grant = store.findMatchingGrantSync({
        app: "alpha",
        role: "builder",
        actionHash: actionHash(ACTION),
        now: new Date("2026-07-06T02:00:00Z"),
      });
      expect(grant?.grantId).toBe("grant-ap1");
    } finally {
      home.cleanup();
    }
  });

  it("deny requires a reason and creates no grant", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => "deny1" });
    try {
      await store.raise({
        app: "alpha",
        role: "builder",
        rule: "dns-or-domain",
        action: ACTION,
      });
      await expect(store.decide("deny1", { decision: "denied", reason: "" })).rejects.toThrow(
        /non-empty reason/,
      );
      const decided = await store.decide("deny1", {
        decision: "denied",
        reason: "not needed",
      });
      expect(decided.reason).toBe("not needed");
      expect(existsSync(home.paths.grant("grant-deny1"))).toBe(false);
    } finally {
      home.cleanup();
    }
  });

  it("reconcile completes a crash-torn decision without duplicate decided logs", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => "crash1" });
    try {
      await store.raise({
        app: "alpha",
        role: "builder",
        rule: "secrets-or-auth",
        action: ACTION,
        now: new Date("2026-07-06T01:00:00Z"),
      });
      appendFileSync(
        home.paths.approvalsLog,
        JSON.stringify({
          type: "decided",
          id: "crash1",
          at: "2026-07-06T02:00:00.000Z",
          decision: "approved",
          grantId: "grant-crash1",
          grant: {
            grantId: "grant-crash1",
            approvalId: "crash1",
            app: "alpha",
            role: "builder",
            actionHash: "pretend",
            expiresAt: "2026-07-07T02:00:00.000Z",
            uses: 1,
            createdAt: "2026-07-06T02:00:00.000Z",
          },
        }) + "\n",
        "utf8",
      );

      await store.reconcile();
      await store.reconcile();

      expect(existsSync(home.paths.approvalsPending("crash1"))).toBe(false);
      expect(existsSync(home.paths.approvalsDecided("crash1"))).toBe(true);
      expect(existsSync(home.paths.grant("grant-crash1"))).toBe(true);
      expect((await store.readLog()).filter((event) => event.type === "decided")).toHaveLength(1);
      expect((await store.readLog()).filter((event) => event.type === "grant-minted")).toHaveLength(1);
    } finally {
      rmSync(home.root, { recursive: true, force: true });
    }
  });
});
