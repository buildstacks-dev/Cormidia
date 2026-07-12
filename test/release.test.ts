// Tests the A4 release handoff glue in src/org/release.ts: a merged loop
// item carrying a releaseTrigger becomes exactly one pending critical-op,
// and a later dispatch executes an approved command once with a durable
// outcome. Uses temp files, FakeGhOps, and FakeRuntime only; no network.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApprovalStore } from "../src/org/approvals.js";
import { executeApprovedReleases, queueReleaseApprovals } from "../src/org/release.js";
import type { LoopItem } from "../src/loop/types.js";
import type { AppsFile } from "../src/org/apps.js";
import { FakeRuntime } from "../src/runtime/testing/fakeRuntime.js";
import type { TurnResult } from "../src/runtime/types.js";
import { makeOrgHome } from "./fixtures/orgHome.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

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
        tool: "bash",
        input: { command: "gh workflow run deploy.yml" },
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

  it("executes an approved orchestrator release once in the managed clone with CI=1", async () => {
    const home = makeOrgHome({ approvals: true });
    const gh = new FakeGhOps({ issues: [{ number: 7, title: "Ship it" }] });
    const appsFile = fixtureApps("orchestrator");
    const clone = join(home.root, "repos", "site");
    mkdirSync(clone, { recursive: true });
    let calls = 0;
    try {
      const [queued] = await queueReleaseApprovals(home.root, "site", [
        mergedItem({ releaseTrigger: { kind: "deploy", command: "./deploy.sh", owner: "orchestrator" } }),
      ]);
      await new ApprovalStore(home.root).decide(queued!.approvalId, { decision: "approved" });

      const first = await executeApprovedReleases({
        stateHome: home.root,
        orgHome: home.root,
        appsFile,
        commandRunner: async (command, cwd, env) => {
          calls += 1;
          expect(command).toBe("./deploy.sh");
          expect(cwd).toBe(clone);
          expect(env["CI"]).toBe("1");
          return { exitCode: 0, stdout: "deployed", stderr: "" };
        },
        ghFor: () => gh,
      });
      const second = await executeApprovedReleases({
        stateHome: home.root,
        orgHome: home.root,
        appsFile,
        commandRunner: async () => {
          calls += 1;
          return { exitCode: 0, stdout: "duplicate", stderr: "" };
        },
        ghFor: () => gh,
      });

      expect(first).toMatchObject([{ status: "completed", approvalId: queued!.approvalId }]);
      expect(second).toEqual([]);
      expect(calls).toBe(1);
      expect(gh.issueComments.get(7)?.[0]).toContain("Status: **completed**");
      const grant = (await new ApprovalStore(home.root).show(queued!.approvalId)).grant;
      expect(grant?.uses).toBe(0);
      expect(readFileSync(join(home.root, "invocations", new Date().toISOString().slice(0, 10) + ".jsonl"), "utf8"))
        .toContain('"kind":"release"');
    } finally {
      home.cleanup();
    }
  });

  it("routes owner sre through one role turn and consumes the grant only on the exact command", async () => {
    const home = makeOrgHome({ approvals: true, taste: true });
    const gh = new FakeGhOps({ issues: [{ number: 7, title: "Ship it" }] });
    const appsFile = fixtureApps("sre");
    const clone = join(home.root, "repos", "site");
    mkdirSync(clone, { recursive: true });
    writeFileSync(
      join(home.root, "roles.yaml"),
      `roles:\n  sre:\n    runtime: codex\n    model: gpt-test\n    effort: medium\n    delegation: {allow: []}\n    triggers: []\n    outputs: [incident-notes]\n    max_turn_budget_usd: 5\n`,
      "utf8",
    );
    const runtime = new FakeRuntime([
      {
        toolActions: [{ action: { tool: "bash", input: { command: "./deploy.sh" } } }],
        result: completedResult("release command completed"),
      },
    ], "codex");
    try {
      const [queued] = await queueReleaseApprovals(home.root, "site", [
        mergedItem({ releaseTrigger: { kind: "deploy", command: "./deploy.sh", owner: "sre" } }),
      ]);
      await new ApprovalStore(home.root).decide(queued!.approvalId, { decision: "approved" });

      const result = await executeApprovedReleases({
        stateHome: home.root,
        orgHome: home.root,
        appsFile,
        runtimeFor: () => runtime,
        ghFor: () => gh,
      });

      expect(result).toMatchObject([{ status: "completed", approvalId: queued!.approvalId }]);
      expect(runtime.calls).toHaveLength(1);
      expect(runtime.calls[0]?.req.task).toContain("Approved production release");
      expect(runtime.calls[0]?.gateCalls[0]?.decision.allow).toBe(true);
      expect((await new ApprovalStore(home.root).show(queued!.approvalId)).grant?.uses).toBe(0);
      expect(gh.issueComments.get(7)?.[0]).toContain("Owner: `sre`");
    } finally {
      home.cleanup();
    }
  });
});

function fixtureApps(owner: "orchestrator" | "sre"): AppsFile {
  return {
    org: { name: "Fixture", maxConcurrentTurns: 2 },
    defaults: { budgetUsdMonth: 1000 },
    apps: [{
      name: "site",
      repo: "owner/site",
      status: "live",
      budgetUsdMonth: 1000,
      cadence: {},
      channels: {},
      release: { kind: "deploy", command: "./deploy.sh", owner },
    }],
  };
}

function completedResult(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime: "codex", id: "release-thread" },
    usage: { tokensIn: 1, tokensOut: 1, costUsd: 0.01, subagentTurns: 0, wallClockMs: 10 },
    escalations: [],
  };
}
