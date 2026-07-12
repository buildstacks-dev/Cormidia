// Tests the non-interactive planning mode in src/org/plan-auto.ts (Stage 4).
// Covers the full bootstrap flow (runtime turn -> schema validation ->
// orchestrator publication), validation failure exits, the mature-stage
// refusal, and plan-JSON extraction.
// Uses the repo root as the org home (real roles/pipelines/prompts), a local
// bare git fixture as the app repo, FakeRuntime, and FakeGhOps; no network,
// auth, or real GitHub state is required.

import { mkdtempSync, rmSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parsePlanJson, runAutoPlan } from "../src/org/plan-auto.js";
import type { AppEntry, AppsFile } from "../src/org/apps.js";
import { FakeRuntime } from "../src/runtime/testing/fakeRuntime.js";
import type { TurnResult } from "../src/runtime/types.js";
import { makeBareWithClone, type BareCloneFixture } from "./fixtures/gitRepo.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

const PLAN_JSON = JSON.stringify({
  stage: "bootstrap",
  ticketCountRationale: "One milestone ships the scaffold with visible content.",
  releaseDisposition: "Deploys via CI after merge; orchestrator triggers it.",
  releaseKind: "deploy",
  tickets: [
    {
      title: "Ship the scaffold with a visible landing page",
      tier: "op:tier-standard",
      priority: "p1",
      dependsOn: [],
      executionGroup: "g1",
      fileScope: ["src/**"],
      goal: "A deployable site with real content.",
      context: "Greenfield repo.",
      acceptanceCriteria: ["pnpm test exits 0"],
      outOfScope: "Analytics.",
      notesForBuilder: "Boring dependencies.",
    },
  ],
});

const MATURE_PLAN_JSON = JSON.stringify({
  ...(JSON.parse(PLAN_JSON) as Record<string, unknown>),
  stage: "mature",
});

function planTurn(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime: "claude", id: "plan-session" },
    usage: { tokensIn: 900, tokensOut: 300, costUsd: 0.9, subagentTurns: 0, wallClockMs: 5_000 },
    escalations: [],
  };
}

describe("runAutoPlan", () => {
  let stateHome: string;
  let pair: BareCloneFixture;
  afterEach(() => {
    rmSync(stateHome, { recursive: true, force: true });
    pair?.cleanup();
  });

  function fixture(): { app: AppEntry; appsFile: AppsFile } {
    stateHome = mkdtempSync(join(tmpdir(), "operon-plan-auto-"));
    pair = makeBareWithClone();
    pair.clone.commit("chore: seed product docs", { "README.md": "# Product\nA small site.\n" });
    pair.clone.git("push", "origin", "main");
    const app: AppEntry = {
      name: "greenfield",
      repo: pair.bare.root,
      status: "onboarding",
      budgetUsdMonth: 300,
      cadence: {},
    };
    return {
      app,
      appsFile: {
        org: { name: "fixture", maxConcurrentTurns: 1 },
        defaults: { budgetUsdMonth: 300 },
        apps: [app],
      },
    };
  }

  it("runs one planner turn, validates, publishes, and settles real usage", async () => {
    const { app, appsFile } = fixture();
    const gh = new FakeGhOps();
    const runtime = new FakeRuntime([{ result: planTurn(PLAN_JSON) }]);

    const result = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: "A personal website for the founder",
      gh,
      runtimeFor: () => runtime,
      now: () => new Date("2026-07-11T09:00:00Z"),
    });

    expect(result.status).toBe("completed");
    expect(result.published).toHaveLength(1);
    // The brief is stage-aware: goal + fresh-clone repo truth.
    expect(runtime.calls[0]?.req.task).toContain("A personal website for the founder");
    expect(runtime.calls[0]?.req.task).toContain("README.md");
    expect(runtime.calls[0]?.req.task).toContain("# Pass: bootstrap-plan");
    // Native structured output requested with the plan schema.
    expect(runtime.calls[0]?.req.verdictSchema?.["title"]).toBe("TicketPlan");
    // The published issue is loop-claimable: op:ready + canonical tier.
    const issues = await gh.listIssues({ state: "all", limit: 10 });
    expect(issues[0]!.labels).toEqual(expect.arrayContaining(["op:ready", "op:tier-standard", "p1"]));
    // Defect A closed for real: the planner turn settled genuine usage.
    const ledger = await readFile(join(stateHome, "telemetry", "2026-07-11.jsonl"), "utf8");
    const row = JSON.parse(ledger.trimEnd().split("\n")[0]!) as Record<string, unknown>;
    expect(row).toMatchObject({ role: "planner", costUsd: 0.9, pipeline: "plan-bootstrap", trigger: "manual" });
    const runId = (await readdir(join(stateHome, "runs", "greenfield")))[0]!;
    const envelope = JSON.parse(
      await readFile(join(stateHome, "runs", "greenfield", runId, "envelope.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(envelope["planning_route"]).toMatchObject({
      policy_version: "planning-depth/v1",
      depth: "quick",
      risk_tier: "low",
      selected_passes: ["bootstrap-plan"],
      estimated_cost_usd: null,
    });
  });

  it("fails loudly (not exit 0) when the plan violates the stage budget", async () => {
    const { app, appsFile } = fixture();
    const oversized = JSON.parse(PLAN_JSON) as { tickets: unknown[] };
    oversized.tickets = Array.from({ length: 5 }, () => (JSON.parse(PLAN_JSON) as { tickets: unknown[] }).tickets[0]);
    const runtime = new FakeRuntime([{ result: planTurn(JSON.stringify(oversized)) }]);
    const gh = new FakeGhOps();

    const result = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: "goal",
      gh,
      runtimeFor: () => runtime,
      now: () => new Date("2026-07-11T09:00:00Z"),
    });

    expect(result.status).toBe("failed");
    expect(result.problems?.some((p) => p.includes("budget"))).toBe(true);
    expect(await gh.listIssues({ state: "all", limit: 10 })).toEqual([]);
  });

  it("runs the standard mature route with one PM and no arbitrator", async () => {
    const { app, appsFile } = fixture();
    const runtime = new FakeRuntime([
      { result: planTurn("visionary evidence") },
      { result: planTurn("one PM roadmap") },
      { result: planTurn(MATURE_PLAN_JSON) },
    ]);
    const gh = new FakeGhOps();
    const result = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app: { ...app, status: "live" },
      appsFile,
      goal: "Improve the product search experience",
      gh,
      runtimeFor: () => runtime,
      now: () => new Date("2026-07-11T09:00:00Z"),
    });
    expect(result.status).toBe("completed");
    expect(result.planningDecision?.depth).toBe("standard");
    expect(runtime.calls).toHaveLength(3);
    expect(runtime.calls.map((call) => call.req.task.match(/# Pass: ([^\s]+)/)?.[1])).toEqual([
      "visionary",
      "pm-a",
      "decomposer",
    ]);
    expect(runtime.calls[2]?.req.task).toContain("visionary evidence");
    expect(runtime.calls[2]?.req.task).toContain("one PM roadmap");
    expect(runtime.calls[0]?.req.verdictSchema).toBeUndefined();
    expect(runtime.calls[2]?.req.verdictSchema?.["title"]).toBe("TicketPlan");
    expect(await gh.listIssues({ state: "all", limit: 10 })).toHaveLength(1);
  });

  it("raises a short security migration to the full deep route", async () => {
    const { app, appsFile } = fixture();
    const runtime = new FakeRuntime([
      { result: planTurn("vision") },
      { result: planTurn("pm a") },
      { result: planTurn("pm b") },
      { result: planTurn("arbitrated") },
      { result: planTurn(MATURE_PLAN_JSON) },
    ]);
    const result = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app: { ...app, status: "live" },
      appsFile,
      goal: "Migrate auth keys",
      gh: new FakeGhOps(),
      runtimeFor: () => runtime,
      now: () => new Date("2026-07-11T09:00:00Z"),
    });

    expect(result.status).toBe("completed");
    expect(result.planningDecision).toMatchObject({ depth: "deep", riskTier: "high" });
    expect(runtime.calls.map((call) => call.req.task.match(/# Pass: ([^\s]+)/)?.[1])).toEqual([
      "visionary",
      "pm-a",
      "pm-b",
      "arbitrator",
      "decomposer",
    ]);
  });
});

describe("parsePlanJson", () => {
  it("takes bare JSON, fenced JSON, and JSON with trailing prose", () => {
    expect(parsePlanJson(PLAN_JSON)?.tickets).toHaveLength(1);
    expect(parsePlanJson(`Here is the plan:\n\`\`\`json\n${PLAN_JSON}\n\`\`\`\nDone.`)?.tickets).toHaveLength(1);
    expect(parsePlanJson("no json here")).toBeUndefined();
  });
});
