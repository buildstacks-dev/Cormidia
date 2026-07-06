import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDispatchedTurn } from "../src/org/turn-runner.js";
import { writeJournalPatch } from "../src/org/journal.js";
import { ApprovalStore } from "../src/org/approvals.js";
import { FakeRuntime } from "../src/runtime/testing/fakeRuntime.js";
import type { AppEntry, AppsFile } from "../src/org/apps.js";
import type { RoleConfig, TurnResult } from "../src/runtime/types.js";
import { makeBareWithClone } from "./fixtures/gitRepo.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

const ROLE: RoleConfig = {
  name: "support",
  runtime: "claude",
  model: "m",
  effort: "medium",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 5,
};

const PLANNER: RoleConfig = {
  name: "planner",
  runtime: "claude",
  model: "m",
  effort: "high",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 5,
};

const BLOCKED: TurnResult = {
  status: "blocked_on_gate",
  summary: "blocked on approval",
  artifacts: [],
  session: { runtime: "claude", id: "s1" },
  usage: { tokensIn: 1, tokensOut: 1, costUsd: 0.01, subagentTurns: 0, wallClockMs: 10 },
  escalations: [],
};

describe("dispatched turn runner", () => {
  it("uses managed clone, composed gate, approval persistence, journal, and telemetry", async () => {
    const pair = makeBareWithClone();
    const home = makeOrgHome({ approvals: true, state: true });
    const app: AppEntry = {
      name: "alpha",
      repo: pair.bare.root,
      status: "live",
      budgetUsdMonth: 1000,
      cadence: {},
    };
    const appsFile: AppsFile = {
      org: { name: "test", maxConcurrentTurns: 2 },
      defaults: { budgetUsdMonth: 1000 },
      apps: [app],
    };
    const runtime = new FakeRuntime([
      {
        toolActions: [{ action: { tool: "bash", input: { command: "cat .env" } } }],
        result: BLOCKED,
      },
    ]);
    try {
      await writeJournalPatch(
        home.root,
        "turn1",
        {
          role: ROLE.name,
          app: app.name,
          phase: "assembling",
          attempt: 0,
          triggerKind: "event",
          trigger: "alert-webhook",
        },
        new Date("2026-07-06T00:00:00Z"),
      );
      const result = await runDispatchedTurn({
        role: ROLE,
        app,
        appsFile,
        turnId: "turn1",
        runtimeHome: home.root,
        orgRoot: process.cwd(),
        runtimeFor: () => runtime,
        now: () => new Date("2026-07-06T00:00:01Z"),
      });

      expect(result.status).toBe("blocked_on_gate");
      expect(existsSync(`${home.root}/repos/alpha/.git`)).toBe(true);
      expect((await new ApprovalStore(home.root).listPending())[0]).toMatchObject({
        app: "alpha",
        role: "support",
        turnId: "turn1",
        rule: "secrets-or-auth",
      });
      const journal = JSON.parse(readFileSync(`${home.root}/state/turns/turn1.json`, "utf8")) as { phase: string };
      expect(journal.phase).toBe("blocked_on_gate");
      const telemetry = readFileSync(`${home.root}/telemetry/2026-07-06.jsonl`, "utf8");
      expect(telemetry).toContain('"app":"alpha"');
      expect(telemetry).toContain('"trigger":"event"');
    } finally {
      home.cleanup();
      pair.cleanup();
    }
  });

  it("routes a scheduled Planner turn through the groom pipeline with operator digest context", async () => {
    const pair = makeBareWithClone();
    const home = makeOrgHome({ approvals: true, state: true });
    const app: AppEntry = {
      name: "alpha",
      repo: pair.bare.root,
      status: "live",
      budgetUsdMonth: 1000,
      cadence: {},
    };
    const appsFile: AppsFile = {
      org: { name: "test", maxConcurrentTurns: 2 },
      defaults: { budgetUsdMonth: 1000 },
      apps: [app],
    };
    const runtime = new FakeRuntime([
      {
        result: {
          status: "completed",
          summary: "groom done",
          artifacts: [{ kind: "digest", ref: "digest", summary: "daily digest" }],
          session: { runtime: "claude", id: "groom-session" },
          usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.03, subagentTurns: 0, wallClockMs: 10 },
          escalations: [],
        },
      },
    ]);
    try {
      await new ApprovalStore(home.root, { idSource: () => "ap1" }).raise({
        app: "alpha",
        role: "builder",
        rule: "secrets-or-auth",
        action: { tool: "bash", input: { command: "cat .env" } },
        now: new Date("2026-07-06T00:00:00Z"),
      });
      mkdirSync(join(home.root, "telemetry"), { recursive: true });
      writeFileSync(
        join(home.root, "telemetry", "2026-07-06.jsonl"),
        `${JSON.stringify({ app: "alpha", costUsd: 900 })}\n`,
        "utf8",
      );
      await writeJournalPatch(
        home.root,
        "turn-groom",
        {
          role: PLANNER.name,
          app: app.name,
          phase: "assembling",
          attempt: 0,
          triggerKind: "schedule",
          trigger: "daily 07:00",
        },
        new Date("2026-07-06T00:00:00Z"),
      );

      const result = await runDispatchedTurn({
        role: PLANNER,
        app,
        appsFile,
        turnId: "turn-groom",
        runtimeHome: home.root,
        orgRoot: process.cwd(),
        runtimeFor: () => runtime,
        now: () => new Date("2026-07-06T01:30:00Z"),
      });

      expect(result.status).toBe("completed");
      expect(runtime.calls).toHaveLength(1);
      expect(runtime.calls[0]?.req.task).toContain("Pipeline: groom");
      expect(runtime.calls[0]?.req.task).toContain("Pass: groom");
      expect(runtime.calls[0]?.req.task).toContain("ap1");
      expect(runtime.calls[0]?.req.task).toContain("alpha: warning 900.00 / 1000.00 (90.0%)");
      expect(runtime.calls[0]?.req.task).toContain("# Pass: groom");

      const journal = JSON.parse(readFileSync(`${home.root}/state/turns/turn-groom.json`, "utf8")) as {
        phase: string;
      };
      expect(journal.phase).toBe("done");
      const telemetry = readFileSync(`${home.root}/telemetry/2026-07-06.jsonl`, "utf8");
      expect(telemetry).toContain('"trigger":"schedule"');
    } finally {
      home.cleanup();
      pair.cleanup();
    }
  });
});
