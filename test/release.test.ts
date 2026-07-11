// Tests the A4 release handoff glue in src/org/release.ts: a merged loop
// item carrying a releaseTrigger becomes exactly one pending critical-op
// item on the approval queue — the trigger, never the execution.
// Uses makeOrgHome as a disposable temp filesystem; no network or real org.

import { describe, expect, it } from "vitest";
import { ApprovalStore } from "../src/org/approvals.js";
import { queueReleaseApprovals } from "../src/org/release.js";
import type { LoopItem } from "../src/loop/types.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

function mergedItem(overrides: Partial<LoopItem> = {}): LoopItem {
  return {
    issueNumber: 7,
    ticketRef: "#7",
    title: "Ship it",
    body: "Release-kind: deploy\n\n## Goal\nship\n",
    targetRepo: "owner/site",
    labels: [],
    phase: "merged",
    tier: "standard",
    cycles: 0,
    remediationAttempts: 0,
    gateResults: [],
    findings: [],
    releaseTrigger: { kind: "deploy", command: "gh workflow run deploy.yml", owner: "sre" },
    ...overrides,
  };
}

describe("queueReleaseApprovals", () => {
  it("raises one production-deploy item per merged releaseTrigger, attributed to the owner", async () => {
    const home = makeOrgHome({ approvals: true });
    try {
      const queued = await queueReleaseApprovals(home.root, "site", [
        mergedItem(),
        mergedItem({ issueNumber: 8, ticketRef: "#8", phase: "returned" }), // not merged
        mergedItem({ issueNumber: 9, ticketRef: "#9", releaseTrigger: undefined }), // merge-only
      ]);

      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({ ticketRef: "#7", kind: "deploy", owner: "sre" });

      const pending = await new ApprovalStore(home.root).listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        app: "site",
        role: "sre",
        rule: "production-deploy",
        ticketRef: "#7",
      });
      expect(pending[0]?.action).toMatchObject({
        tool: "release",
        input: { kind: "deploy", command: "gh workflow run deploy.yml", ticketRef: "#7" },
      });
    } finally {
      home.cleanup();
    }
  });

  it("no releaseTrigger anywhere → queue untouched", async () => {
    const home = makeOrgHome({ approvals: true });
    try {
      const queued = await queueReleaseApprovals(home.root, "site", [
        mergedItem({ releaseTrigger: undefined }),
      ]);
      expect(queued).toEqual([]);
      expect(await new ApprovalStore(home.root).listPending()).toEqual([]);
    } finally {
      home.cleanup();
    }
  });
});
