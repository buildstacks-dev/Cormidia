import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDispatchedTurn } from "../src/org/turn-runner.js";
import { writeJournalPatch } from "../src/org/journal.js";
import { ApprovalStore } from "../src/org/approvals.js";
import { readScorecards } from "../src/org/scorecards.js";
import { FakeRuntime } from "../src/runtime/testing/fakeRuntime.js";
import type { AppEntry, AppsFile } from "../src/org/apps.js";
import type { RoleConfig, Runtime, TurnHooks, TurnRequest, TurnResult } from "../src/runtime/types.js";
import { makeBareWithClone } from "./fixtures/gitRepo.js";
import { makeOrgHome } from "./fixtures/orgHome.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

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

const BUILDER: RoleConfig = {
  name: "builder",
  runtime: "claude",
  model: "m",
  effort: "medium",
  delegation: { allow: [] },
  triggers: [{ event: "ticket-ready" }],
  outputs: ["pr"],
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
      repo: pair.clone.root,
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

  it("persists loop scorecard events returned by a merged builder turn", async () => {
    const pair = makeBareWithClone();
    pair.clone.commit("chore: add operon policy", {
      ".operon/TASTE.md": "# App\n",
      ".operon/config.yaml": "test_command: \"true\"\nlint_command: \"true\"\n",
      ".operon/policy.yaml": [
        "schema_version: 1",
        "risk_tiers: {low: [\"*.md\"], medium: [\"src/**\"], high: [\"auth/**\"]}",
        "gates:",
        "  low: [tests]",
        "  medium: [tests]",
        "  high: [tests]",
        "dimension_globs: {}",
        "remediation: {max_attempts: 3}",
        "",
      ].join("\n"),
    });
    pair.clone.git("push", "origin", "main");
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
    class FreshReviewGhOps extends FakeGhOps {
      override async listReviews(prNumber: number) {
        const reviews = await super.listReviews(prNumber);
        const commitId = git(join(home.root, "worktrees", "alpha", "op-1-quick-doc-fix"), "rev-parse", "HEAD");
        return reviews.map((review) => ({ ...review, commitId }));
      }
    }
    const gh = new FreshReviewGhOps({
      cloneRoot: pair.clone.root,
      issues: [
        {
          number: 1,
          title: "Quick doc fix",
          body: [
            "## Goal",
            "Change README.",
            "",
            "## Acceptance criteria",
            "- [x] README changes",
            "",
            "## Scope",
            "- README.md",
            "",
          ].join("\n"),
          labels: ["op:ready", "op:tier-quick"],
        },
      ],
    });
    const fake = new FakeRuntime([
      {
        result: {
          status: "completed",
          summary: "Verdict: done",
          artifacts: [],
          session: { runtime: "claude", id: "build" },
          usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.01, subagentTurns: 0, wallClockMs: 10 },
          escalations: [],
        },
      },
      {
        result: {
          status: "completed",
          summary: "Verdict: approve",
          artifacts: [],
          session: { runtime: "claude", id: "review" },
          usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.01, subagentTurns: 0, wallClockMs: 10 },
          escalations: [],
        },
      },
      {
        result: {
          status: "completed",
          summary: "Verdict: approve",
          artifacts: [],
          session: { runtime: "claude", id: "tail-1" },
          usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.01, subagentTurns: 0, wallClockMs: 10 },
          escalations: [],
        },
      },
      {
        result: {
          status: "completed",
          summary: "Verdict: approve",
          artifacts: [],
          session: { runtime: "claude", id: "tail-2" },
          usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.01, subagentTurns: 0, wallClockMs: 10 },
          escalations: [],
        },
      },
      {
        result: {
          status: "completed",
          summary: "Verdict: approve",
          artifacts: [],
          session: { runtime: "claude", id: "tail-3" },
          usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.01, subagentTurns: 0, wallClockMs: 10 },
          escalations: [],
        },
      },
      {
        result: {
          status: "completed",
          summary: "Verdict: approve",
          artifacts: [],
          session: { runtime: "claude", id: "ship-2" },
          usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.01, subagentTurns: 0, wallClockMs: 10 },
          escalations: [],
        },
      },
      {
        result: {
          status: "completed",
          summary: "Verdict: approve",
          artifacts: [],
          session: { runtime: "claude", id: "ship" },
          usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.01, subagentTurns: 0, wallClockMs: 10 },
          escalations: [],
        },
      },
    ]);
    const runtime: Runtime = {
      kind: "claude",
      runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
        if (req.task.includes("# Pass: implement")) {
          writeFileSync(join(req.workdir, "README.md"), "# fixture origin\n\nupdated\n", "utf8");
          git(req.workdir, "add", "README.md");
          git(req.workdir, "commit", "-m", "feat: update readme");
        }
        return fake.runTurn(req, hooks);
      },
    };
    try {
      await writeJournalPatch(
        home.root,
        "turn-build",
        {
          role: BUILDER.name,
          app: app.name,
          phase: "assembling",
          attempt: 0,
          triggerKind: "event",
          trigger: "ticket-ready",
        },
        new Date("2026-07-06T00:00:00Z"),
      );
      const result = await runDispatchedTurn({
        role: BUILDER,
        app,
        appsFile,
        turnId: "turn-build",
        runtimeHome: home.root,
        orgRoot: process.cwd(),
        gh,
        runtimeFor: () => runtime,
        now: () => new Date("2026-07-06T02:00:00Z"),
      });

      expect(result.status).toBe("completed");
      const scores = await readScorecards(home.root, "alpha", "builder");
      expect(scores).toEqual([
        expect.objectContaining({
          type: "review_cycles",
          turnId: "turn-build",
          ticketRef: "#1",
          value: 0,
        }),
      ]);
      await runDispatchedTurn({
        role: BUILDER,
        app,
        appsFile,
        turnId: "turn-build",
        runtimeHome: home.root,
        orgRoot: process.cwd(),
        gh,
        runtimeFor: () => runtime,
        now: () => new Date("2026-07-06T02:00:00Z"),
      });
      expect(await readScorecards(home.root, "alpha", "builder")).toHaveLength(1);
    } finally {
      home.cleanup();
      pair.cleanup();
    }
  });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Operon Test",
      GIT_AUTHOR_EMAIL: "test@operon.invalid",
      GIT_COMMITTER_NAME: "Operon Test",
      GIT_COMMITTER_EMAIL: "test@operon.invalid",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
