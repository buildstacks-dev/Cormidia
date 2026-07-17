// Tests higher-level loop engine integration across driver, pipelines, verdicts,
// gates, runlogs, and fake GitHub operations.
// Covers builder/reviewer/ship-check pipeline wiring, tier and dimension pass
// selection, malformed-verdict retry/failure, spec-link brief population, and
// remediation history in fix briefs.
// Uses temp git/org fixtures, FakeRuntime, and FakeGhOps; no network, auth, real
// GitHub/org state, or live wall clock is required.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cmdTelemetry } from "../src/cli/telemetry.js";
import { runLoopOnce } from "../src/loop/driver.js";
import { readRouteRecord } from "../src/loop/efficiency.js";
import {
  advanceGates,
  claimTicket,
  parseAcceptanceCriteria,
  runBuilderPipeline,
  runReviewPipeline,
  runShipCheckPipeline,
  type LoopItem,
} from "../src/loop/loop.js";
import { runAutoPlan } from "../src/org/plan-auto.js";
import { beginParentTask, finishParentTask } from "../src/org/parent-task.js";
import { loadPipelines, type PipelinesFile } from "../src/loop/pipelines.js";
import type { Policy } from "../src/loop/policy.js";
import type { GateRunResult } from "../src/loop/qgates.js";
import { VerdictParseError } from "../src/loop/verdicts.js";
import { readEnvelope } from "../src/runtime/runlog/envelope.js";
import { readEvents } from "../src/runtime/runlog/events.js";
import { FakeRuntime, type ScriptedTurn } from "../src/runtime/testing/fakeRuntime.js";
import type { ContextBundle, RoleConfig, Runtime, TurnHooks, TurnRequest, TurnResult } from "../src/runtime/types.js";
import { makeBareWithClone, type BareCloneFixture } from "./fixtures/gitRepo.js";
import { makeOrgHome } from "./fixtures/orgHome.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROMPTS_DIR = join(ROOT, "prompts");

const ISSUE_BODY = [
  "## Goal",
  "Ship a small fixture change.",
  "",
  "## Acceptance criteria",
  "- [x] fixture behavior is covered",
  "",
  "## Scope",
  "- auth/change.ts",
  "",
].join("\n");

const CONTRACT = [
  "## Implementation contract",
  "",
  "**Files:**",
  "- auth/change.ts",
  "",
  "**Approach:**",
  "Add the requested fixture change.",
  "",
  "**Tests:**",
  "AC1 -> loop-driver",
  "",
  "**Risks:**",
  "None.",
  "",
  "**Complexity:**",
  "low",
  "",
].join("\n");

const APPROVE = "Verdict: approve";
const FINDING = "- testing/major test/change.test.ts:1 -- missing coverage -> add the regression\nVerdict: findings";
const DONE = "Verdict: done";

const ROLES: Record<string, RoleConfig> = {
  planner: role("planner"),
  builder: role("builder"),
  reviewer: role("reviewer", { effort: "xhigh" }),
  sre: role("sre"),
  support: role("support"),
  marketing: role("marketing"),
  distiller: role("distiller"),
  "learning-reviewer": role("learning-reviewer"),
};

function role(name: string, overrides: Partial<RoleConfig> = {}): RoleConfig {
  return {
    name,
    runtime: "claude",
    model: `${name}-model`,
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: [],
    maxTurnBudgetUsd: 5,
    ...overrides,
  };
}

async function rootPipelines(): Promise<PipelinesFile> {
  return loadPipelines(join(ROOT, "pipelines.yaml"), {
    roleNames: Object.keys(ROLES),
    promptsDir: PROMPTS_DIR,
  });
}

describe("M6 loop engine integration", () => {
  it("runs Planner -> Builder -> Reviewer and stops at the recorded human-merge boundary", async () => {
    const pair = makeBareWithClone();
    const gh = new FakeGhOps({ cloneRoot: pair.clone.root });
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const taskId = "e2e-human-merge-boundary";
    const plan = JSON.stringify({
      stage: "bootstrap",
      ticketCountRationale: "One bounded ticket proves the delegated lifecycle.",
      releaseDisposition: "Human merge is the terminal boundary for this acceptance flow.",
      releaseKind: "merge-only",
      tickets: [
        {
          title: "Ship the end-to-end fixture",
          tier: "op:tier-standard",
          priority: "p1",
          dependsOn: [],
          executionGroup: "g1",
          fileScope: ["src/**"],
          goal: "Exercise planning, implementation, CI, and independent review.",
          context: "Offline acceptance fixture.",
          acceptanceCriteria: ["the test command exits 0"],
          outOfScope: "Merging without the human boundary.",
          notesForBuilder: "Keep the implementation local and reversible.",
        },
      ],
    });
    const calls: Array<{ role: string; task: string }> = [];
    const runtime: Runtime = {
      kind: "claude",
      async runTurn(req) {
        calls.push({ role: req.role.name, task: req.task });
        if (req.role.name === "planner") return turnResultOf(plan, "completed");
        if (req.role.name === "builder") {
          if (req.task.includes("# Pass: implement")) {
            commit(req.workdir, "feat: e2e boundary fixture", {
              "src/e2e-boundary.ts": "export const reachedBoundary = true;\n",
            });
            return turnResultOf(DONE, "completed");
          }
          return turnResultOf(CONTRACT, "completed");
        }
        if (req.role.name === "reviewer") return turnResultOf(APPROVE, "completed");
        throw new Error(`unexpected E2E role: ${req.role.name}`);
      },
    };
    try {
      await beginParentTask({
        stateHome: home.root,
        taskId,
        originalPrompt: "Plan, build, and independently review one fixture; stop for human merge.\n",
        objective: "Reach the human merge boundary with every Operon stage recorded.",
        completionCriteria: "Planner, Builder, CI, and Reviewer complete; PR remains open for the human.",
        app: "fixture",
        workdir: pair.clone.root,
        harness: "codex",
        nativeTaskId: "e2e-thread",
        nativeRef: "codex://threads/e2e-thread",
        now: new Date("2026-07-11T21:00:00Z"),
      });

      const app = {
        name: "fixture",
        repo: pair.bare.root,
        status: "onboarding" as const,
        budgetUsdMonth: 100,
        cadence: {},
      };
      const planned = await runAutoPlan({
        orgHome: ROOT,
        stateHome: home.root,
        app,
        appsFile: {
          org: { name: "fixture-org", maxConcurrentTurns: 1 },
          defaults: { budgetUsdMonth: 100 },
          apps: [app],
        },
        goal: "Ship one bounded end-to-end acceptance fixture",
        workdir: pair.clone.root,
        gh,
        runtimeFor: () => runtime,
        parentTaskId: taskId,
        now: () => new Date("2026-07-11T21:01:00Z"),
      });
      expect(planned.status).toBe("completed");

      const issue = (await gh.listIssues({ labels: ["op:ready"], state: "open" }))[0]!;
      let item = await claimTicket(issue, {
        gh,
        targetRepo: "fixture/repo",
        localRepo: pair.clone.root,
        worktreeRoot: join(pair.root, "worktrees"),
      });
      const pipelines = await rootPipelines();
      const phaseOptions = {
        gh,
        pipelines,
        roles: ROLES,
        runtimeFor: () => runtime,
        promptsDir: PROMPTS_DIR,
        runlogRoot: home.root,
        app: "fixture",
        policy: policy(),
        commands: { testCommand: "true", lintCommand: "true" },
        hooks: allowAllHooks(),
        parentTaskId: taskId,
      };
      item = await runBuilderPipeline(item, phaseOptions);
      expect(item.phase).toBe("gates");
      item = await advanceGates(item, {
        gh,
        policy: policy(),
        commands: { testCommand: "true", lintCommand: "true" },
        criteria: parseAcceptanceCriteria(item.body),
        criterionTests: item.criterionTests ?? {},
      });
      expect(item.phase).toBe("reviewing");
      item = await runReviewPipeline(item, phaseOptions);
      expect(item.phase).toBe("shipping");

      const prNumber = item.prNumber!;
      expect((await gh.readPR(prNumber)).state).toBe("OPEN");
      expect((await gh.listReviews(prNumber))[0]).toMatchObject({ state: "APPROVED" });
      expect(gh.calls.some((call) => call.op === "squashMerge")).toBe(false);
      expect((await gh.readIssue(issue.number)).labels).toContain("op:in-review");

      await finishParentTask({
        stateHome: home.root,
        taskId,
        status: "completed",
        resultSummary: "Operon stages complete; awaiting human merge.",
        refs: {
          tickets: [`#${issue.number}`],
          prs: [`#${prNumber}`],
          reviews: [`#${prNumber}:APPROVED`],
        },
        completionState: {
          implementation: "complete",
          ci: "green",
          operonReview: "approved",
          humanReview: "awaiting",
          pr: "open",
          issuesCloseOnMerge: [`#${issue.number}`],
        },
        now: new Date("2026-07-11T21:10:00Z"),
      });

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...parts: unknown[]): void => {
        logs.push(parts.join(" "));
      };
      try {
        expect(
          await cmdTelemetry([
            "--org-home", ROOT,
            "--state-home", home.root,
            "--app", "fixture",
            "--json",
          ]),
        ).toBe(0);
      } finally {
        console.log = originalLog;
      }
      const telemetry = JSON.parse(logs.join("\n")) as {
        parent_tasks: Array<Record<string, unknown>>;
        completion_integrity: Record<string, unknown>;
      };
      expect(telemetry.parent_tasks[0]).toMatchObject({
        task_id: taskId,
        execution_mode: "operon",
        observed_stages: ["planner", "builder", "reviewer"],
        missing_required_stages: [],
        operon_end_to_end_complete: true,
        completion_state: {
          operonReview: "approved",
          humanReview: "awaiting",
          pr: "open",
        },
      });
      expect(telemetry.completion_integrity).toMatchObject({
        required_stages: "complete",
        reviewer_pass: "completed",
        manual_fallback: "none",
        pr_state: "open",
      });
      expect(calls.map((call) => call.role)).toEqual([
        "planner",
        "builder",
        "builder",
        "reviewer",
      ]);
    } finally {
      home.cleanup();
      pair.cleanup();
    }
  });

  it("building invokes contract then implement with the ticket brief and comments the contract", async () => {
    const h = await claimedHarness("Build Integration", ["op:ready"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(CONTRACT), scripted(DONE)]);
    try {
      const next = await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
      });

      expect(next.phase).toBe("gates");
      expect(fake.calls.length).toBe(2);
      expect(fake.calls[0]?.req.task).toContain("[ticket]\n#1 Build Integration");
      expect(fake.calls[0]?.req.task).toContain("# Pass: contract");
      expect(fake.calls[0]?.req.verdictSchema?.["title"]).toBe("ContractVerdict");
      expect(fake.calls[1]?.req.task).toContain("[contract]\n## Implementation contract");
      expect(fake.calls[1]?.req.task).toContain("# Pass: implement");
      expect(h.gh.issueComments.get(1)?.[0]).toContain("## Implementation contract");
      expect(next.criterionTests).toEqual({ AC1: ["loop-driver"] });
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("tier:quick still runs the typed contract required by completeness", async () => {
    const h = await claimedHarness("Quick Build", ["op:ready", "op:tier-quick"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(CONTRACT), scripted(DONE)]);
    try {
      await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
      });

      expect(fake.calls.length).toBe(2);
      expect(fake.calls[0]?.req.task).toContain("# Pass: contract");
      expect(fake.calls[1]?.req.task).toContain("# Pass: implement");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("contextFor resolves per (ticket, pipeline) and its bundle reaches every pass (learning M5)", async () => {
    const h = await claimedHarness("Per-Episode Context", ["op:ready", "op:tier-quick"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(CONTRACT), scripted(DONE)]);
    const episodeBundle: ContextBundle = {
      taste: ["## Org TASTE.md\n\nepisode-resolved taste"],
      memoryExcerpts: ["## Learning concept trial (roles/builder)\n\ngoverned"],
    };
    const seen: Array<{ issue: number; pipeline: string }> = [];
    try {
      await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
        // Tick-level fallback context that must NOT reach the pass.
        context: { taste: ["## Org TASTE.md\n\ntick-level taste"], memoryExcerpts: [] },
        contextFor: async (item, pipeline) => {
          seen.push({ issue: item.issueNumber, pipeline });
          return episodeBundle;
        },
      });

      expect(seen).toEqual([{ issue: 1, pipeline: "build" }]);
      expect(fake.calls[0]?.req.context).toBe(episodeBundle);
      expect(fake.calls[1]?.req.context.taste).toEqual(episodeBundle.taste);
      expect(fake.calls[1]?.req.context.memoryExcerpts).toEqual([
        expect.stringMatching(/^\[context-reference source="unattributed:memory:0" sha256="[a-f0-9]{64}"\]$/),
      ]);
      expect(fake.calls[1]?.req.context.components?.find((component) => component.category === "memory")?.rendered)
        .toBe(fake.calls[1]?.req.context.memoryExcerpts[0]);
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("a rehydrated still-applicable contract skips the contract pass (Stage 2)", async () => {
    const h = await claimedHarness("Reused Contract", ["op:ready"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(DONE)]);
    try {
      const next = await runBuilderPipeline(
        { ...h.item, contract: CONTRACT },
        {
          ...engineOptions(h, home.root, fake),
          pipelines: await rootPipelines(),
        },
      );

      // 21 claims produced 20 contract passes in the episode; a reusable
      // contract must reach the implement brief without a contract turn.
      expect(next.phase).toBe("gates");
      expect(fake.calls.length).toBe(1);
      expect(fake.calls[0]?.req.task).toContain("# Pass: implement");
      expect(fake.calls[0]?.req.task).toContain("[contract]\n## Implementation contract");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("a stopped turn re-arms op:ready with a durable-work comment instead of stranding op:building", async () => {
    const h = await claimedHarness("Stopped Turn", ["op:ready"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    // Implement pass fails hard (e.g. budget kill) after the contract pass.
    const fake = new FakeRuntime([
      scripted(CONTRACT),
      { result: { ...turnResultOf("budget kill", "failed"), errorCode: "error_max_budget_usd" } },
    ]);
    try {
      const next = await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
      });

      expect(next.phase).toBe("ready");
      expect(next.labels).toContain("op:ready");
      const issue = (await h.gh.listIssues({ state: "all", limit: 5 }))[0]!;
      expect(issue.labels).toContain("op:ready");
      expect(issue.labels).not.toContain("op:building");
      const stopped = (h.gh.issueComments.get(1) ?? []).find((c) =>
        c.startsWith("## Turn stopped before completion"),
      );
      expect(stopped).toBeDefined();
      expect(stopped).toContain("error_max_budget_usd");
      expect(stopped).toContain("Durable work preserved");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("a turn blocked on an approval parks op:blocked, never op:ready auto-retry", async () => {
    const h = await claimedHarness("Blocked Turn", ["op:ready"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([
      scripted(CONTRACT),
      { result: turnResultOf("denied critical op", "blocked_on_gate") },
    ]);
    try {
      const next = await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
      });

      expect(next.phase).toBe("blocked");
      const issue = (await h.gh.listIssues({ state: "all", limit: 5 }))[0]!;
      expect(issue.labels).toContain("op:blocked");
      const stopped = (h.gh.issueComments.get(1) ?? []).find((c) =>
        c.startsWith("## Turn stopped before completion"),
      );
      expect(stopped).toContain("pending approval");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("a fix verdict's resolution lines are posted as a durable Fix resolutions comment", async () => {
    const h = await claimedHarness("Fix Resolutions", ["op:ready"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([
      scripted("- fixed src/a.ts:1 -- commit abc, regression added\nVerdict: done"),
    ]);
    try {
      await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
        pipelineName: "fix",
        gateResult: failedGate("failing output"),
      });

      const comments = h.gh.issueComments.get(1) ?? [];
      const resolutions = comments.find((c) => c.startsWith("## Fix resolutions"));
      expect(resolutions).toBeDefined();
      expect(resolutions).toContain("- fixed src/a.ts:1 -- commit abc, regression added");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("fix pass brief carries verbatim gate output", async () => {
    const h = await claimedHarness("Fix Gates", ["op:ready"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(CONTRACT), scripted(DONE)]);
    try {
      await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
        pipelineName: "fix",
        gateResult: failedGate("EXPECTED_OUTPUT_FROM_GATE"),
      });

      expect(fake.calls[0]?.req.task).toContain("# Pass: fix");
      expect(fake.calls[0]?.req.task).toContain("Gate output (verbatim):");
      expect(fake.calls[0]?.req.task).toContain("EXPECTED_OUTPUT_FROM_GATE");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("review posts a GitHub review and a structured findings comment", async () => {
    const h = await reviewingHarness("Review Finding", { "src/plain.ts": "export const x = 1;\n" });
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(FINDING)]);
    try {
      const next = await runReviewPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
      });

      expect(next.phase).toBe("building");
      expect(next.findings[0]).toMatchObject({ category: "testing", severity: "major" });
      expect(h.gh.calls.map((call) => call.op)).toContain("createReview");
      expect(h.gh.issueComments.get(1)?.join("\n")).toContain("## Structured review verdict");
      expect((await h.gh.listReviews(h.item.prNumber as number))[0]?.state).toBe("CHANGES_REQUESTED");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("review dimensions select security-deep for auth diffs but not plain diffs", async () => {
    const pipelines = await rootPipelines();
    const plain = await reviewingHarness("Plain Review", { "src/plain.ts": "export const x = 1;\n" });
    const auth = await reviewingHarness("Auth Review", { "auth/login.ts": "export const x = 1;\n" });
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const plainFake = new FakeRuntime([scripted(APPROVE)]);
    const authFake = new FakeRuntime([scripted(APPROVE), scripted(APPROVE)]);
    try {
      await runReviewPipeline(plain.item, {
        ...engineOptions(plain, home.root, plainFake),
        pipelines,
      });
      await runReviewPipeline(auth.item, {
        ...engineOptions(auth, home.root, authFake),
        pipelines,
      });

      expect(plainFake.calls.map((call) => call.req.task)).toHaveLength(1);
      expect(plainFake.calls[0]?.req.task).toContain("# Pass: verify");
      expect(authFake.calls.map((call) => call.req.task)).toHaveLength(2);
      expect(authFake.calls[1]?.req.task).toContain("# Pass: security-deep");
    } finally {
      home.cleanup();
      plain.cleanup();
      auth.cleanup();
    }
  });

  // L1-05: package.json is content-gated for the security dimension. A bare
  // metadata edit must NOT select the security-deep review pass; a dependency
  // change must — the same predicate the route reassessment uses.
  it("content-gates package.json: a metadata edit skips security-deep, a dependency change selects it (L1-05)", async () => {
    const pipelines = await rootPipelines();
    const securityPkgPolicy: Policy = {
      ...policy(),
      dimensionGlobs: { security: ["auth/**", "package.json"], perf: ["perf/**"] },
    };
    const pkg = (extra: Record<string, unknown>): string =>
      JSON.stringify(
        { name: "app", version: "1.0.0", scripts: { test: "true" }, dependencies: { react: "^18.0.0" }, ...extra },
        null,
        2,
      ) + "\n";
    const base = pkg({});
    const metadataEdit = pkg({ version: "1.0.1", files: ["dist"] });
    const dependencyEdit = pkg({ dependencies: { react: "^18.3.0" } });

    const meta = await packageJsonReviewHarness("Pkg Metadata Review", base, metadataEdit);
    const dep = await packageJsonReviewHarness("Pkg Dependency Review", base, dependencyEdit);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const metaFake = new FakeRuntime([scripted(APPROVE)]);
    const depFake = new FakeRuntime([scripted(APPROVE), scripted(APPROVE)]);
    try {
      await runReviewPipeline(meta.item, {
        ...engineOptions(meta, home.root, metaFake),
        pipelines,
        policy: securityPkgPolicy,
      });
      await runReviewPipeline(dep.item, {
        ...engineOptions(dep, home.root, depFake),
        pipelines,
        policy: securityPkgPolicy,
      });

      // Metadata-only edit: verify only — the security-deep pass is not selected.
      expect(metaFake.calls.map((call) => call.req.task)).toHaveLength(1);
      expect(metaFake.calls[0]?.req.task).toContain("# Pass: verify");
      expect(metaFake.calls.some((call) => call.req.task.includes("# Pass: security-deep"))).toBe(false);

      // Dependency change: verify + security-deep.
      expect(depFake.calls.map((call) => call.req.task)).toHaveLength(2);
      expect(depFake.calls[1]?.req.task).toContain("# Pass: security-deep");
    } finally {
      home.cleanup();
      meta.cleanup();
      dep.cleanup();
    }
  });

  it("high-risk ship-check runs before squash merge", async () => {
    const pair = makeBareWithClone();
    const gh = new FakeGhOps({
      cloneRoot: pair.clone.root,
      issues: [{ number: 1, title: "Loop High Risk", body: ISSUE_BODY, labels: ["op:ready"] }],
    });
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([
      scripted(CONTRACT),
      scripted(DONE),
      scripted(APPROVE),
      scripted(APPROVE),
      scripted(APPROVE),
    ]);
    const runtime = committingRuntime(fake, {
      "# Pass: implement": { "auth/change.ts": "export const changed = true;\n" },
    });
    try {
      const result = await runLoopOnce({
        app: "fixture",
        repo: "fixture/repo",
        gh,
        localRepo: pair.clone.root,
        worktreeRoot: join(pair.root, "worktrees"),
        policy: policy(),
        commands: { testCommand: "true", lintCommand: "true" },
        engine: {
          pipelines: await rootPipelines(),
          roles: ROLES,
          runtimeFor: () => runtime,
          promptsDir: PROMPTS_DIR,
          runlogRoot: home.root,
          hooks: allowAllHooks(),
        },
      });

      expect(result.items[0]?.phase).toBe("merged");
      expect(fake.calls.some((call) => call.req.task.includes("# Pass: ship-check"))).toBe(true);
      const route = await readRouteRecord(home.root, "ticket:fixture:#1");
      expect([...new Set(route.authorized_passes.map((pass) => pass.pipeline))].sort()).toEqual([
        "build",
        "fix",
        "review",
        "ship",
      ]);
      const ops = gh.calls.map((call) => call.op);
      expect(ops.lastIndexOf("createReview")).toBeLessThan(ops.indexOf("squashMerge"));
    } finally {
      home.cleanup();
      pair.cleanup();
    }
  });
  it("ship-check findings are bounded and route to op:returned at the cycle cap", async () => {
    const pipelines = await rootPipelines();
    // Under the cap: a ship-check bounce goes back to building and counts the cycle.
    const under = await reviewingHarness("Ship Bounce Under", { "auth/change.ts": "export const x = 1;\n" });
    const homeA = makeOrgHome({ runs: { apps: ["fixture"] } });
    // At the cap: the same bounce must terminate in op:returned with findings,
    // not building->shipping forever until the driver phase guard throws and
    // orphans the ticket in op:building.
    const atCap = await reviewingHarness("Ship Bounce Cap", { "auth/change.ts": "export const y = 1;\n" });
    const homeB = makeOrgHome({ runs: { apps: ["fixture"] } });
    try {
      const bounced = await runShipCheckPipeline(
        { ...under.item, phase: "shipping", cycles: 0 },
        { ...engineOptions(under, homeA.root, new FakeRuntime([scripted(FINDING)])), pipelines },
      );
      expect(bounced.phase).toBe("building");
      expect(bounced.cycles).toBe(1);
      expect(bounced.labels).toContain("op:building");

      const returned = await runShipCheckPipeline(
        { ...atCap.item, phase: "shipping", cycles: 3 },
        { ...engineOptions(atCap, homeB.root, new FakeRuntime([scripted(FINDING)])), pipelines },
      );
      expect(returned.phase).toBe("returned");
      expect(returned.labels).toContain("op:returned");
      expect(returned.findings.length).toBeGreaterThan(0);
    } finally {
      homeA.cleanup();
      homeB.cleanup();
      under.cleanup();
      atCap.cleanup();
    }
  });

  // L-005 / L1-03: a route-budget cap firing mid-review must NOT crash
  // `operon loop --once` and strand the ticket at op:in-review with an open,
  // mergeable PR. The pipeline must terminalize cleanly to op:returned with a
  // budget-exhaustion evidence comment, and the PR must be left untouched.
  it("route-budget cap during review terminalizes op:returned, does not throw, and leaves the PR open (L-005)", async () => {
    const h = await reviewingHarness("Budget Cap Review", { "src/plain.ts": "export const x = 1;\n" });
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([budgetBlockedTurn("review/verify")]);
    try {
      const prState = (await h.gh.readPR(h.item.prNumber as number)).state;
      const next = await runReviewPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
      });

      expect(next.phase).toBe("returned");
      expect(next.labels).toContain("op:returned");
      expect(next.labels).not.toContain("op:in-review");
      expect((await h.gh.readIssue(1)).labels).toContain("op:returned");
      const comment = h.gh.issueComments.get(1)?.join("\n") ?? "";
      expect(comment).toContain("error_route_budget_exhausted");
      expect(comment).toContain("op:returned");
      // The PR must not be orphaned: never merged, still open, untouched.
      expect(h.gh.calls.some((call) => call.op === "squashMerge")).toBe(false);
      expect((await h.gh.readPR(h.item.prNumber as number)).state).toBe(prState);
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("route-budget cap during ship-check terminalizes op:returned and does not throw (L-005)", async () => {
    const h = await reviewingHarness("Budget Cap Ship", { "auth/change.ts": "export const y = 1;\n" });
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([budgetBlockedTurn("ship/ship-check")]);
    try {
      const returned = await runShipCheckPipeline(
        { ...h.item, phase: "shipping" },
        { ...engineOptions(h, home.root, fake), pipelines: await rootPipelines() },
      );
      expect(returned.phase).toBe("returned");
      expect(returned.labels).toContain("op:returned");
      expect(h.gh.calls.some((call) => call.op === "squashMerge")).toBe(false);
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  // A genuine internal error (not a cap) must still throw loudly — the loop
  // must not swallow a real defect as a clean terminal (L-005 "distinguish
  // the two").
  it("a non-cap pipeline abort still throws loudly (L-005 distinguishes cap from crash)", async () => {
    const h = await reviewingHarness("Crash Review", { "src/plain.ts": "export const x = 1;\n" });
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([crashedTurn()]);
    try {
      await expect(
        runReviewPipeline(h.item, {
          ...engineOptions(h, home.root, fake),
          pipelines: await rootPipelines(),
        }),
      ).rejects.toThrow("review pipeline aborted before completion");
      expect((await h.gh.readIssue(1)).labels).toContain("op:in-review");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  // L-007 / L1-04: dependency re-arm is orchestrator-owned. A dependency-locked
  // backlog ticket (created stateless, no op:ready) must auto-promote to
  // op:ready when its predecessor merges — with no manual label edit — while a
  // ticket whose dependency has NOT merged stays blocked.
  it("a dependent ticket auto-promotes to op:ready after its predecessor merges (L-007)", async () => {
    const pair = makeBareWithClone();
    const gh = new FakeGhOps({
      cloneRoot: pair.clone.root,
      issues: [
        { number: 1, title: "Root", body: ISSUE_BODY, labels: ["op:ready"] },
        { number: 2, title: "Dependent on #1", body: `${ISSUE_BODY}\nDepends-on: #1\n`, labels: [] },
        { number: 3, title: "Dependent on #4", body: `${ISSUE_BODY}\nDepends-on: #4\n`, labels: [] },
        { number: 4, title: "Other, unmerged", body: ISSUE_BODY, labels: [] },
      ],
    });
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([
      scripted(CONTRACT),
      scripted(DONE),
      scripted(APPROVE),
      scripted(APPROVE),
      scripted(APPROVE),
    ]);
    const runtime = committingRuntime(fake, {
      "# Pass: implement": { "auth/change.ts": "export const changed = true;\n" },
    });
    try {
      const result = await runLoopOnce({
        app: "fixture",
        repo: "fixture/repo",
        gh,
        localRepo: pair.clone.root,
        worktreeRoot: join(pair.root, "worktrees"),
        policy: policy(),
        commands: { testCommand: "true", lintCommand: "true" },
        engine: {
          pipelines: await rootPipelines(),
          roles: ROLES,
          runtimeFor: () => runtime,
          promptsDir: PROMPTS_DIR,
          runlogRoot: home.root,
          hooks: allowAllHooks(),
        },
      });

      expect(result.items[0]?.phase).toBe("merged");
      // #2 depended on #1; #1 merged this tick -> #2 carries op:ready, no hand edit.
      expect((await gh.readIssue(2)).labels).toContain("op:ready");
      // #3 depends on the still-open, unmerged #4 -> stays blocked (stateless).
      expect((await gh.readIssue(3)).labels).not.toContain("op:ready");
      // #4 is not a dependent of #1 and must be left untouched.
      expect((await gh.readIssue(4)).labels).not.toContain("op:ready");
    } finally {
      home.cleanup();
      pair.cleanup();
    }
  });
});

describe("GAP D — verdict reformat retry (docs/loop.md §6, §13 row 11)", () => {
  const MALFORMED = "I'll touch a couple files and add a test or two — looks good.";

  it("a malformed-then-valid verdict recovers via one session-resuming reformat turn", async () => {
    const h = await claimedHarness("Verdict Retry", ["op:ready"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(MALFORMED), scripted(CONTRACT), scripted(DONE)]);
    try {
      const next = await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
      });

      expect(next.phase).toBe("gates");
      // contract(bad) + reformat(good) + implement = 3 turns.
      expect(fake.calls.length).toBe(3);
      // The reformat turn RESUMED the just-finished contract session.
      expect(fake.calls[1]?.req.session?.id).toBe(`session-${MALFORMED.slice(0, 10)}`);
      expect(fake.calls[1]?.req.task).toContain("could not be parsed");
      expect(h.gh.issueComments.get(1)?.[0]).toContain("## Implementation contract");

      const contractRun = runIdContaining(home.root, "-build-contract");
      const events = await readEvents(home.root, "fixture", contractRun);
      expect(events.some((e) => e.event === "verdict.recorded")).toBe(true);
      // The envelope keeps a parent aggregate, while each adapter invocation
      // has its own provider-turn identity and exactly-one settlement.
      const envelope = await readEnvelope(home.root, "fixture", contractRun);
      expect(envelope?.usage?.tokens_in).toBe(20);
      expect(envelope?.usage?.cost_usd).toBeCloseTo(0.02, 5);
      expect(envelope.provider_turn_ids).toHaveLength(2);
      expect(envelope.execution_step_ids).toHaveLength(2);
      const rows = readdirSync(join(home.root, "telemetry"))
        .filter((name) => name.endsWith(".jsonl"))
        .flatMap((name) => readFileSync(join(home.root, "telemetry", name), "utf8").trimEnd().split("\n"))
        .map((line) => JSON.parse(line) as { runId?: string; providerTurnId?: string })
        .filter((row) => row.runId === contractRun);
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.providerTurnId))).toEqual(new Set(envelope.provider_turn_ids));
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("a malformed-malformed verdict fails loudly with a distinct infra error_code", async () => {
    const h = await claimedHarness("Verdict Fail", ["op:ready"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(MALFORMED), scripted("still not a contract at all")]);
    try {
      await expect(
        runBuilderPipeline(h.item, {
          ...engineOptions(h, home.root, fake),
          pipelines: await rootPipelines(),
        }),
      ).rejects.toThrow(VerdictParseError);

      // Exactly one retry: contract(bad) + reformat(bad); implement never ran.
      expect(fake.calls.length).toBe(2);

      const contractRun = runIdContaining(home.root, "-build-contract");
      const envelope = await readEnvelope(home.root, "fixture", contractRun);
      expect(envelope.status).toBe("failed");
      expect(envelope.error_code).toBe("error_verdict_unparseable");
      const events = await readEvents(home.root, "fixture", contractRun);
      expect(
        events.some((e) => e.event === "pass.failed" && e.error_code === "error_verdict_unparseable"),
      ).toBe(true);
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });
});

describe("GAP F — brief [spec] and [history] population (docs/loop.md §3)", () => {
  it("a Context link to a repo file yields a [spec] section with the file's excerpts", async () => {
    const body = [
      "## Goal",
      "Add the widget.",
      "",
      "## Context",
      "Background lives in [the spec](docs/specs/widget.md).",
      "",
      "## Acceptance criteria",
      "- [x] widget behaves",
      "",
    ].join("\n");
    const h = await claimWithBody("Spec Ticket", body, ["op:ready", "op:tier-quick"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(CONTRACT), scripted(DONE)]);
    try {
      mkdirSync(join(h.item.worktree as string, "docs/specs"), { recursive: true });
      writeFileSync(
        join(h.item.worktree as string, "docs/specs/widget.md"),
        "# Widget spec\n\nThe widget must foo the bar reliably.\n",
      );

      await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
      });

      const task = fake.calls[0]?.req.task ?? "";
      expect(task).toContain("[spec]");
      expect(task).toContain("docs/specs/widget.md");
      expect(task).toContain("The widget must foo the bar reliably");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("a second attempt carries a [history] section with the attempt count", async () => {
    const h = await claimedHarness("History Ticket", ["op:ready", "op:tier-quick"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(CONTRACT), scripted(DONE)]);
    try {
      const retried: LoopItem = { ...h.item, remediationAttempts: 2 };
      await runBuilderPipeline(retried, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
        pipelineName: "fix",
      });

      const task = fake.calls[0]?.req.task ?? "";
      expect(task).toContain("[history]");
      expect(task).toContain("attempt 1 of 3");
      expect(task).toContain("attempt 2 of 3");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("a missing Context spec file degrades to a note, never throws", async () => {
    const body = [
      "## Goal",
      "Add the gizmo.",
      "",
      "## Context",
      "See [the missing spec](docs/specs/missing.md).",
      "",
      "## Acceptance criteria",
      "- [x] gizmo behaves",
      "",
    ].join("\n");
    const h = await claimWithBody("Missing Spec Ticket", body, ["op:ready", "op:tier-quick"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(CONTRACT), scripted(DONE)]);
    try {
      const next = await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
      });
      expect(next.phase).toBe("gates"); // no throw
      const task = fake.calls[0]?.req.task ?? "";
      expect(task).toContain("[spec]");
      expect(task).toContain("was not found in the worktree");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });
});

function runIdContaining(runlogRoot: string, needle: string): string {
  const runId = readdirSync(join(runlogRoot, "runs", "fixture")).find((id) => id.includes(needle));
  if (runId === undefined) throw new Error(`no run record matching ${needle}`);
  return runId;
}

async function claimWithBody(
  title: string,
  body: string,
  labels: string[],
): Promise<{ pair: BareCloneFixture; gh: FakeGhOps; item: LoopItem; cleanup(): void }> {
  const pair = makeBareWithClone();
  const gh = new FakeGhOps({
    cloneRoot: pair.clone.root,
    issues: [{ number: 1, title, body, labels }],
  });
  const item = await claimTicket(await gh.readIssue(1), {
    gh,
    targetRepo: "fixture/repo",
    localRepo: pair.clone.root,
    worktreeRoot: join(pair.root, "worktrees"),
  });
  return { pair, gh, item, cleanup: () => pair.cleanup() };
}

async function claimedHarness(
  title: string,
  labels: string[],
): Promise<{ pair: BareCloneFixture; gh: FakeGhOps; item: LoopItem; cleanup(): void }> {
  const pair = makeBareWithClone();
  const gh = new FakeGhOps({
    cloneRoot: pair.clone.root,
    issues: [{ number: 1, title, body: ISSUE_BODY, labels }],
  });
  const item = await claimTicket(await gh.readIssue(1), {
    gh,
    targetRepo: "fixture/repo",
    localRepo: pair.clone.root,
    worktreeRoot: join(pair.root, "worktrees"),
  });
  return { pair, gh, item, cleanup: () => pair.cleanup() };
}

async function reviewingHarness(
  title: string,
  files: Record<string, string>,
): Promise<{ pair: BareCloneFixture; gh: FakeGhOps; item: LoopItem; cleanup(): void }> {
  const h = await claimedHarness(title, ["op:ready"]);
  commit(h.item.worktree as string, "feat: review fixture", files);
  git(h.item.worktree as string, "push", "-u", "origin", h.item.branch as string);
  const pr = await h.gh.createPR({
    head: h.item.branch as string,
    base: "main",
    title,
    body: "Closes #1",
  });
  await h.gh.swapLabel(1, "op:building", "op:in-review");
  return {
    ...h,
    item: { ...h.item, phase: "reviewing", prNumber: pr.number, labels: ["op:in-review"] },
  };
}

/** A reviewing harness seeded with a base package.json on main and a
 *  single-file package.json edit on the review branch (L1-05). */
async function packageJsonReviewHarness(
  title: string,
  baseline: string,
  edit: string,
): Promise<{ pair: BareCloneFixture; gh: FakeGhOps; item: LoopItem; cleanup(): void }> {
  const pair = makeBareWithClone();
  pair.clone.commit("chore: base package.json", { "package.json": baseline });
  pair.clone.git("push", "origin", "main");
  const gh = new FakeGhOps({
    cloneRoot: pair.clone.root,
    issues: [{ number: 1, title, body: ISSUE_BODY, labels: ["op:ready"] }],
  });
  const item = await claimTicket(await gh.readIssue(1), {
    gh,
    targetRepo: "fixture/repo",
    localRepo: pair.clone.root,
    worktreeRoot: join(pair.root, "worktrees"),
  });
  commit(item.worktree as string, "feat: edit package.json", { "package.json": edit });
  git(item.worktree as string, "push", "-u", "origin", item.branch as string);
  const pr = await gh.createPR({ head: item.branch as string, base: "main", title, body: "Closes #1" });
  await gh.swapLabel(1, "op:building", "op:in-review");
  return {
    pair,
    gh,
    item: { ...item, phase: "reviewing", prNumber: pr.number, labels: ["op:in-review"] },
    cleanup: () => pair.cleanup(),
  };
}

function engineOptions(
  h: { gh: FakeGhOps },
  runlogRoot: string,
  runtime: Runtime,
): Omit<Parameters<typeof runBuilderPipeline>[1], "pipelines"> {
  return {
    gh: h.gh,
    roles: ROLES,
    runtimeFor: () => runtime,
    promptsDir: PROMPTS_DIR,
    runlogRoot,
    app: "fixture",
    policy: policy(),
    commands: { testCommand: "true", lintCommand: "true" },
    hooks: allowAllHooks(),
  };
}

function committingRuntime(fake: FakeRuntime, commits: Record<string, Record<string, string>>): Runtime {
  return {
    kind: fake.kind,
    async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
      for (const [needle, files] of Object.entries(commits)) {
        if (req.task.includes(needle)) commit(req.workdir, "feat: runtime fixture", files);
      }
      return fake.runTurn(req, hooks);
    },
  };
}

function policy(): Policy {
  return {
    riskTiers: {
      high: ["auth/**"],
      medium: ["src/**"],
      low: ["*.md"],
    },
    gates: {
      high: ["tests", "lint", "security", "completeness"],
      medium: ["tests", "lint", "completeness"],
      low: ["tests", "completeness"],
    },
    dimensionGlobs: {
      security: ["auth/**"],
      perf: ["perf/**"],
    },
    remediation: { maxAttempts: 3 },
  };
}

function failedGate(output: string): GateRunResult {
  return {
    tier: "medium",
    status: "fail",
    results: [
      {
        gate: "tests",
        status: "fail",
        detail: "tests failed",
        outputTail: output,
        durationMs: 1,
      },
    ],
    remediation: {
      currentAttempt: 0,
      maxAttempts: 3,
      attemptsRemaining: 3,
      canRetry: true,
      exhausted: false,
    },
  };
}

function scripted(summary: string): ScriptedTurn {
  return { result: turnResultOf(summary, "completed") };
}

/** A pass stopped by a legitimately-fired route/provider budget cap (the exact
 *  shape pipeline.ts mints from a ProviderBudgetRefusalError). Its presence in
 *  a pipeline abort must terminalize the ticket cleanly, never crash the loop
 *  (L-005). */
function budgetBlockedTurn(operation: string): ScriptedTurn {
  return {
    result: {
      status: "blocked_on_gate",
      errorCode: "error_route_budget_exhausted",
      summary: `episode cannot start ${operation}: route budget exhausted`,
      artifacts: [],
      session: { runtime: "claude", id: `route-budget-${operation}` },
      usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns: 0, wallClockMs: 0, quality: "unavailable" },
      escalations: [],
    },
  };
}

/** A pass that failed for an unrecognized internal reason (not a cap). Its
 *  abort must still surface loudly — the loop must not swallow a genuine
 *  defect as a clean terminal (L-005 "distinguish the two"). */
function crashedTurn(): ScriptedTurn {
  return {
    result: {
      status: "failed",
      errorCode: "error_turn_failed",
      summary: "the reviewer runtime failed for an unexpected reason",
      artifacts: [],
      session: { runtime: "claude", id: "session-crash" },
      usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns: 0, wallClockMs: 0, quality: "unavailable" },
      escalations: [],
    },
  };
}

function turnResultOf(summary: string, status: TurnResult["status"]): TurnResult {
  return {
    status,
    summary,
    artifacts: [],
    session: { runtime: "claude", id: `session-${summary.slice(0, 10)}` },
    usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.01, subagentTurns: 0, wallClockMs: 100 },
    escalations: [],
  };
}

function allowAllHooks(): TurnHooks {
  return { gate: () => ({ allow: true }) };
}

function commit(worktree: string, message: string, files: Record<string, string>): string {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(worktree, rel);
    execFileSync("mkdir", ["-p", join(path, "..")]);
    writeFileSync(path, content);
  }
  git(worktree, "add", "-A");
  git(worktree, "commit", "-m", message);
  return git(worktree, "rev-parse", "HEAD");
}

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
