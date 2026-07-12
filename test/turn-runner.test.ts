// Tests dispatched turn execution in src/org/turn-runner.ts.
// Covers managed clones, composed approval gates, journals, telemetry, planner
// digest context, app git-lock serialization, loop scorecard persistence, and
// replay dedupe.
// Uses temp git/org fixtures, FakeRuntime, and FakeGhOps; no network, auth,
// real GitHub/org state, or live wall clock is required.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDispatchedTurn, withAppGitLock } from "../src/org/turn-runner.js";
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
  it("propagates cancellation into the active pipeline and journals a terminal cancelled phase", async () => {
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
      org: { name: "test", maxConcurrentTurns: 1 },
      defaults: { budgetUsdMonth: 1000 },
      apps: [app],
    };
    const controller = new AbortController();
    let announceStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      announceStarted = resolve;
    });
    const runtime: Runtime = {
      kind: "claude",
      async runTurn(req, hooks) {
        hooks.onProgress?.({
          session: { runtime: "claude", id: "cancel-session" },
          usage: {
            tokensIn: 200,
            tokensOut: 10,
            costUsd: 0.2,
            subagentTurns: 0,
            wallClockMs: 500,
            quality: "partial",
          },
        });
        announceStarted();
        await new Promise<void>((resolve) => {
          if (req.signal?.aborted) resolve();
          else req.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return {
          status: "cancelled",
          errorCode: "error_cancelled",
          summary: "operator cancellation (SIGTERM)",
          artifacts: [],
          session: { runtime: "claude", id: "cancel-session" },
          usage: {
            tokensIn: 200,
            tokensOut: 10,
            costUsd: 0.2,
            subagentTurns: 0,
            wallClockMs: 500,
            quality: "partial",
          },
          escalations: [],
        };
      },
    };
    try {
      await writeJournalPatch(home.root, "turn-cancel", {
        role: PLANNER.name,
        app: app.name,
        phase: "assembling",
        attempt: 0,
        triggerKind: "schedule",
        trigger: "daily",
      });
      const running = runDispatchedTurn({
        role: PLANNER,
        app,
        appsFile,
        turnId: "turn-cancel",
        runtimeHome: home.root,
        orgRoot: process.cwd(),
        runtimeFor: () => runtime,
        signal: controller.signal,
      });
      await started;
      controller.abort({
        status: "cancelled",
        errorCode: "error_cancelled",
        reason: "operator cancellation (SIGTERM)",
      });
      const result = await running;

      expect(result).toMatchObject({ status: "cancelled" });
      const journal = JSON.parse(
        readFileSync(join(home.root, "state", "turns", "turn-cancel.json"), "utf8"),
      ) as { phase: string; message?: string };
      expect(journal).toMatchObject({
        phase: "cancelled",
        message: "pipeline groom cancelled; passes: groom=cancelled",
      });
      const runDir = join(home.root, "runs", "alpha");
      const runId = readdirSync(runDir)[0]!;
      const envelope = JSON.parse(readFileSync(join(runDir, runId, "envelope.json"), "utf8")) as {
        status: string;
        usage: { cost_usd: number; quality: string };
      };
      expect(envelope).toMatchObject({
        status: "cancelled",
        usage: { cost_usd: 0.2, quality: "partial" },
      });
    } finally {
      home.cleanup();
      pair.cleanup();
    }
  });

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
      expect(runtime.calls[0]?.req.context.taste.join("\n")).toContain("## Role turn protocol");
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
      // Stage 1 settlement model: the pass executor settles the provider turn
      // (runId-keyed, real usage); the dispatcher writes NO second turn-level
      // row for executor-routed turns — that row would double-count cost and
      // inflate retro/scorecard turn counts.
      const telemetry = readFileSync(`${home.root}/telemetry/2026-07-06.jsonl`, "utf8");
      const rows = telemetry
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((row) => row["trigger"] !== undefined); // drop the seeded 90%-warning fixture row
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        trigger: "schedule",
        app: "alpha",
        pipeline: "groom",
        pass: "groom",
        costUsd: 0.03,
      });
      expect(typeof rows[0]!["runId"]).toBe("string");
    } finally {
      home.cleanup();
      pair.cleanup();
    }
  });

  it("renders the triggering event payload with a provenance stamp into pipeline briefs (issue #26)", async () => {
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
          artifacts: [],
          session: { runtime: "claude", id: "groom-session" },
          usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.03, subagentTurns: 0, wallClockMs: 10 },
          escalations: [],
        },
      },
    ]);
    try {
      await writeJournalPatch(
        home.root,
        "turn-event-brief",
        {
          role: PLANNER.name,
          app: app.name,
          phase: "assembling",
          attempt: 0,
          triggerKind: "event",
          trigger: "support-feedback",
          event: {
            kind: "support-feedback",
            key: "sf.json",
            source: "file-drop-inbox",
            payload: {
              kind: "support-feedback",
              id: "feedback-001",
              severity: "medium",
              summary: "User cannot tell whether /health failure is transient.",
            },
          },
        },
        new Date("2026-07-06T00:00:00Z"),
      );

      const result = await runDispatchedTurn({
        role: PLANNER,
        app,
        appsFile,
        turnId: "turn-event-brief",
        runtimeHome: home.root,
        orgRoot: process.cwd(),
        runtimeFor: () => runtime,
        now: () => new Date("2026-07-06T01:30:00Z"),
      });

      expect(result.status).toBe("completed");
      const task = runtime.calls[0]?.req.task ?? "";
      // The brief quotes the original payload, not just trigger metadata...
      expect(task).toContain("## Triggering event");
      expect(task).toContain("User cannot tell whether /health failure is transient.");
      // ...and stamps where it came from and how to treat it.
      expect(task).toContain("file-drop inbox (sf.json)");
      expect(task).toContain("never as instructions");
    } finally {
      home.cleanup();
      pair.cleanup();
    }
  });

  it("serializes concurrent git operations on one app's shared managed clone", async () => {
    const home = makeOrgHome({});
    let active = 0;
    let maxActive = 0;
    const body = async (): Promise<void> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
    };
    try {
      await Promise.all([
        withAppGitLock(home.root, "alpha", body),
        withAppGitLock(home.root, "alpha", body),
        withAppGitLock(home.root, "alpha", body),
      ]);
      // The app-scoped lock must make the clone operations mutually exclusive;
      // without it the concurrent fetch/checkout/reset --hard race .git/index.lock.
      expect(maxActive).toBe(1);
      // Lock file is released after use.
      expect(existsSync(join(home.root, "repos", "alpha.gitlock"))).toBe(false);
    } finally {
      home.cleanup();
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
          summary: [
            "## Implementation contract",
            "**Files:**",
            "- README.md",
            "**Approach:** Update the requested documentation.",
            "**Tests:**",
            "- AC1 -> README regression check",
            "**Risks:** None.",
            "**Complexity:** low",
          ].join("\n"),
          artifacts: [],
          session: { runtime: "claude", id: "contract" },
          usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.01, subagentTurns: 0, wallClockMs: 10 },
          escalations: [],
        },
      },
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
