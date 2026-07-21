import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  episodeIntentHash,
  type CreatorEpisodeScope,
  type EpisodeIntent,
  type ProposedEpisodePlan,
  type ProposedEpisodeStep,
} from "../src/loop/episode-plan.js";
import { readEpisodePlanExecutionJournal } from "../src/loop/episode-plan-executor.js";
import { readCurrentEpisodePlan } from "../src/loop/episode-plan.js";
import { parsePlannedBy, type ProjectStage } from "../src/loop/plan-tickets.js";
import { readPublishedTicketsRecord } from "../src/loop/plan-publication-record.js";
import {
  PLANNING_PROVIDER_OPERATION_CATALOG,
} from "../src/loop/planning-episode-plan.js";
import { parsePlanJson, runAutoPlan } from "../src/org/plan-auto.js";
import type { AppEntry, AppsFile } from "../src/org/apps.js";
import type {
  Runtime,
  RuntimeKind,
  TurnHooks,
  TurnRequest,
  TurnResult,
} from "../src/runtime/types.js";
import { makeBareWithClone, type BareCloneFixture } from "./fixtures/gitRepo.js";
import { FakeGhOps } from "./support/fakeGhOps.js";
import {
  discoverPlanningStageCheckout,
  resolvePlanningStage,
} from "../src/org/planning-stage.js";

const NOW = new Date("2026-07-19T09:00:00.000Z");
const EPISODE_PROMPT = "Return exactly one strict EpisodePlan JSON object.";

const BOOTSTRAP_PLAN = JSON.stringify({
  stage: "bootstrap",
  ticketCountRationale: "One milestone ships visible product; fewer would ship nothing.",
  releaseDisposition: "Deploy through the configured CI handoff after merge.",
  releaseKind: "deploy",
  tickets: [{
    title: "Ship the scaffold with a visible landing page",
    tier: "op:tier-standard",
    priority: "p1",
    dependsOn: [],
    executionGroup: "g1",
    fileScope: ["src/**"],
    goal: "A deployable site with real content.",
    context: "Greenfield repository.",
    acceptanceCriteria: ["pnpm test exits 0"],
    outOfScope: "Analytics.",
    notesForBuilder: "Use boring dependencies.",
  }],
});

const MATURE_PLAN = JSON.stringify({
  ...(JSON.parse(BOOTSTRAP_PLAN) as Record<string, unknown>),
  stage: "mature",
  releaseDisposition: "This milestone intentionally ends at merge.",
  releaseKind: "merge-only",
});

type WorkflowFactory = (intent: EpisodeIntent, createdAt: string) => ProposedEpisodeStep[];

class ProductPlanningRuntime implements Runtime {
  readonly kind: RuntimeKind = "claude";
  readonly calls: Array<{ req: TurnRequest; hooks: TurnHooks }> = [];

  constructor(
    private readonly workflow: WorkflowFactory = minimalWorkflow,
    private readonly ticketPlanForStage: (stage: ProjectStage) => string =
      (stage) => stage === "bootstrap" ? BOOTSTRAP_PLAN : MATURE_PLAN,
  ) {}

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    this.calls.push({ req, hooks });
    if (req.task.includes("[episode_planner_input]")) {
      const payload = plannerPayload(req.task);
      const intent = payload.intent;
      return completed(JSON.stringify(proposal(
        intent,
        payload.proposalCreatedAt,
        this.workflow(intent, payload.proposalCreatedAt),
      )));
    }
    const operation = /Operation: (plan\/[a-z-]+)/.exec(req.task)?.[1];
    if (operation === undefined) throw new Error(`missing planning operation in task: ${req.task}`);
    if (operation === "plan/vision") return completed("## Product thesis\nShip the bounded outcome.\n");
    const stage = /TicketPlan JSON object with stage "(bootstrap|growth|mature)"/.exec(req.task)?.[1];
    if (stage === undefined) throw new Error(`terminal planning task has no stage: ${req.task}`);
    return completed(this.ticketPlanForStage(stage as ProjectStage));
  }
}

describe("runAutoPlan EpisodePlanner product-planning path (D-PLAN-01)", () => {
  let stateHome: string;
  let pair: BareCloneFixture;

  afterEach(() => {
    if (stateHome !== undefined) rmSync(stateHome, { recursive: true, force: true });
    pair?.cleanup();
  });

  function fixture(status: AppEntry["status"] = "onboarding"): {
    app: AppEntry;
    appsFile: AppsFile;
  } {
    stateHome = mkdtempSync(join(tmpdir(), "operon-plan-auto-"));
    pair = makeBareWithClone();
    pair.clone.commit("chore: seed product docs", {
      "README.md": "# Product\nA small site.\n",
    });
    pair.clone.git("push", "origin", "main");
    const app: AppEntry = {
      name: "greenfield",
      repo: pair.bare.root,
      status,
      budgetUsdMonth: 100,
      cadence: {},
    };
    return {
      app,
      appsFile: {
        org: { name: "fixture", maxConcurrentTurns: 1 },
        defaults: { budgetUsdMonth: 100 },
        apps: [app],
      },
    };
  }

  it("runs fixed-boot EpisodePlanner, then exactly one governed provider step, and publishes", async () => {
    const { app, appsFile } = fixture();
    const runtime = new ProductPlanningRuntime();
    const gh = new FakeGhOps();
    const result = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: "A personal website for the founder",
      workdir: pair.clone.root,
      gh,
      runtimeFor: () => runtime,
      episodePlannerPromptText: EPISODE_PROMPT,
      now: () => NOW,
    });

    expect(result.status, result.summary).toBe("completed");
    expect(result.planningTurnSkipped).toBe(false);
    expect(result.episodePlan?.steps.map((step) =>
      step.kind === "provider_turn" ? step.operation : step.kind)).toEqual(["plan/bootstrap"]);
    expect(runtime.calls).toHaveLength(2);
    expect(runtime.calls[0]!.req.task).toContain("[episode_planner_input]");
    expect(runtime.calls[1]!.req.task).toContain("# Pass: bootstrap-plan");
    expect(runtime.calls[1]!.req.task).toContain("Operation: plan/bootstrap");
    expect(runtime.calls[1]!.req.verdictSchema?.["title"]).toBe("TicketPlan");
    expect(runtime.calls[0]!.req.assignment).toEqual(runtime.calls[1]!.req.assignment);
    expect(result.published).toHaveLength(1);
    expect(plannerPayload(runtime.calls[0]!.req.task).intent.repositoryFacts)
      .toMatchObject({
        planningStageResolution: {
          stage: "bootstrap",
          source: "repository_evidence",
          reason: "low_history_no_releases",
          evidence: { reachableCommitCount: 2, reachableTagCount: 0 },
        },
      });

    const intent = result.episodeId === undefined
      ? undefined
      : await readCurrentEpisodePlan(stateHome, result.episodeId);
    expect(intent?.planningSource).toBe("episode_planner");
    const journal = await readEpisodePlanExecutionJournal(stateHome, result.episodeId!);
    expect(journal).toMatchObject({ status: "completed", current_plan_version: 1 });
    expect(journal?.events.filter((event) => event.kind === "step_completed")).toHaveLength(1);

    const ledger = (await readFile(join(stateHome, "telemetry", "2026-07-19.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(ledger).toHaveLength(2);
    expect(ledger.map((row) => row["pipeline"])).toEqual([
      "episode-planner",
      "episode-plan-dag",
    ]);

    const finalRun = (await readdir(join(stateHome, "runs", "greenfield")))
      .find((runId) => runId.includes("episode-plan-dag"))!;
    const record = await readPublishedTicketsRecord(stateHome, "greenfield", finalRun);
    expect(record).toMatchObject({
      episode_id: result.episodeId,
      run_id: finalRun,
      trace_id: expect.stringMatching(/^plan-greenfield-/),
    });
    const issues = await gh.listIssues({ state: "all", limit: 10 });
    expect(parsePlannedBy(issues[0]!.body)).toEqual({
      episodeId: record!.episode_id,
      runId: record!.run_id,
      traceId: record!.trace_id,
    });
  });

  it("threads exact structured downstream safety facts through the live planning intent", async () => {
    const { app, appsFile } = fixture("live");
    const runtime = new ProductPlanningRuntime();
    const result = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: "Plan the bounded milestone",
      workdir: pair.clone.root,
      publish: false,
      planning: {
        sensitiveDomains: [
          "auth",
          "secrets",
          "data-migration",
          "production-deployment",
          "performance",
          "data",
        ],
      },
      runtimeFor: () => runtime,
      episodePlannerPromptText: EPISODE_PROMPT,
      now: () => NOW,
    });

    expect(result.status, result.summary).toBe("completed");
    expect(plannerPayload(runtime.calls[0]!.req.task).intent.requiredSafetyFacts)
      .toEqual([
        {
          kind: "authentication",
          evidenceRefs: ["planning-request:sensitive-domain:auth"],
        },
        {
          kind: "data_migration",
          evidenceRefs: ["planning-request:sensitive-domain:data-migration"],
        },
        {
          kind: "performance_sensitive",
          evidenceRefs: ["planning-request:sensitive-domain:performance"],
        },
        {
          kind: "production_deployment",
          evidenceRefs: ["planning-request:sensitive-domain:production-deployment"],
        },
        {
          kind: "secrets",
          evidenceRefs: ["planning-request:sensitive-domain:secrets"],
        },
        {
          kind: "user_data",
          evidenceRefs: ["planning-request:sensitive-domain:data"],
        },
      ]);
  });

  it("lets EpisodePlanner choose two governed operations and hands durable output to the dependent turn", async () => {
    const { app, appsFile } = fixture("live");
    const runtime = new ProductPlanningRuntime(twoStepMatureWorkflow);
    const result = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: "Choose and decompose the next milestone",
      stage: "mature",
      workdir: pair.clone.root,
      publish: false,
      runtimeFor: () => runtime,
      episodePlannerPromptText: EPISODE_PROMPT,
      now: () => NOW,
    });

    expect(result.status, result.summary).toBe("completed");
    expect(result.stageResolution).toMatchObject({
      stage: "mature",
      source: "explicit",
      reason: "operator_supplied",
    });
    expect(runtime.calls).toHaveLength(3);
    expect(runtime.calls.slice(1).map((call) =>
      /Operation: (plan\/[a-z-]+)/.exec(call.req.task)?.[1])).toEqual([
      "plan/vision",
      "plan/decompose",
    ]);
    expect(runtime.calls[2]!.req.task).toContain("## Product thesis");
    expect(runtime.calls[2]!.req.task).toContain("### vision (plan/vision)");
    expect(result.plan?.stage).toBe("mature");
    expect(result.published).toBeUndefined();
  });

  it("never infers a planner bypass from an existing-ticket lifecycle or simple goal", async () => {
    const { app, appsFile } = fixture("live");
    const runtime = new ProductPlanningRuntime();
    const result = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: "Issue #7 is a tiny scoped typo",
      workdir: pair.clone.root,
      publish: false,
      planning: { workLifecycle: "existing-ticket", minimumDepth: "quick" },
      runtimeFor: () => runtime,
      episodePlannerPromptText: EPISODE_PROMPT,
      now: () => NOW,
    });

    expect(result.status).toBe("completed");
    expect(result.planningTurnSkipped).toBe(false);
    expect(runtime.calls[0]!.req.task).toContain("[episode_planner_input]");
    expect(runtime.calls).toHaveLength(2);
  });

  it("keeps preview and live stage equal when live creates an absent managed clone", async () => {
    const { app, appsFile } = fixture("live");
    const previewCheckout = discoverPlanningStageCheckout({
      app,
      orgHome: process.cwd(),
      stateHome,
    });
    const previewResolution = resolvePlanningStage({
      checkout: previewCheckout.checkout,
      checkoutSource: previewCheckout.source,
    });
    expect(previewResolution).toMatchObject({
      stage: "bootstrap",
      source: "conservative_fallback",
      reason: "repository_evidence_unavailable",
    });

    const runtime = new ProductPlanningRuntime();
    const result = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: "Plan the first bounded milestone",
      publish: false,
      runtimeFor: () => runtime,
      episodePlannerPromptText: EPISODE_PROMPT,
      now: () => NOW,
    });

    expect(result.status, result.summary).toBe("completed");
    expect(result.stageResolution).toEqual(previewResolution);
    expect(result.plan?.stage).toBe("bootstrap");
    expect(existsSync(join(stateHome, "repos", app.name, ".git"))).toBe(true);
  });

  it("skips only the dedicated planner for an explicit execution-ready creator scope", async () => {
    const { app, appsFile } = fixture();
    const runtime = new ProductPlanningRuntime();
    let runtimeLoads = 0;
    const creatorScope = executionReadyBootstrapScope();
    const result = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: creatorScope.objective,
      workdir: pair.clone.root,
      publish: false,
      creatorScope,
      requireExecutionReadyCreatorScope: true,
      runtimeFor: () => {
        runtimeLoads += 1;
        return runtime;
      },
      now: () => NOW,
    });

    expect(result.status, result.summary).toBe("completed");
    expect(result.planningTurnSkipped).toBe(true);
    expect(result.episodePlan?.planningSource).toBe("creator_scope");
    expect(result.episodePlan?.creatorProvenance).toEqual(creatorScope.provenance);
    expect(result.planProjection?.plan.stage).toBe("bootstrap");
    expect(runtimeLoads).toBe(1);
    expect(runtime.calls).toHaveLength(1);
    expect(runtime.calls.some((call) => call.req.task.includes("[episode_planner_input]"))).toBe(false);
    expect(runtime.calls[0]!.req.task).toContain("Operation: plan/bootstrap");
    expect(runtime.calls[0]!.req.task).toContain(creatorScope.acceptanceCriteria[0]!);
    expect(runtime.calls[0]!.req.task).toContain(creatorScope.provenance.creatorId);
    expect(existsSync(join(
      stateHome,
      "efficiency",
      "episodes",
    ))).toBe(true);
  });

  it("reserves no hypothetical EpisodePlanner budget for an explicit creator bypass", async () => {
    const { app, appsFile } = fixture();
    app.budgetUsdMonth = 6;
    appsFile.defaults.budgetUsdMonth = 6;
    const creatorScope = executionReadyBootstrapScope();
    const creatorRuntime = new ProductPlanningRuntime();

    const creator = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: creatorScope.objective,
      workdir: pair.clone.root,
      publish: false,
      creatorScope,
      requireExecutionReadyCreatorScope: true,
      episodeId: "trace:greenfield:creator-small-budget",
      runtimeFor: () => creatorRuntime,
      now: () => NOW,
    });

    expect(creator.status, creator.summary).toBe("completed");
    expect(creator.planningTurnSkipped).toBe(true);
    expect(creatorRuntime.calls).toHaveLength(1);
    expect(creatorRuntime.calls[0]!.req.task).toContain("Operation: plan/bootstrap");

    const ordinaryRuntime = new ProductPlanningRuntime();
    const ordinary = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: "Plan the same small-budget bootstrap without creator scope",
      workdir: pair.clone.root,
      publish: false,
      episodeId: "trace:greenfield:ordinary-small-budget",
      runtimeFor: () => ordinaryRuntime,
      episodePlannerPromptText: EPISODE_PROMPT,
      now: () => NOW,
    });

    expect(ordinary.status).toBe("failed");
    expect(ordinary.problems?.join(" ")).toContain("plan_budget_cost_exceeded");
    expect(ordinaryRuntime.calls).toHaveLength(2);
    expect(ordinaryRuntime.calls.every((call) => call.req.task.includes("[episode_planner_input]")))
      .toBe(true);
  });

  it("does not rebind a persisted creator episode to different provenance on resume", async () => {
    const { app, appsFile } = fixture();
    const episodeId = "trace:greenfield:immutable-creator-scope";
    const creatorScope = executionReadyBootstrapScope();
    const firstRuntime = new ProductPlanningRuntime();
    const first = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: creatorScope.objective,
      workdir: pair.clone.root,
      publish: false,
      creatorScope,
      requireExecutionReadyCreatorScope: true,
      episodeId,
      runtimeFor: () => firstRuntime,
      now: () => NOW,
    });
    expect(first.status, first.summary).toBe("completed");

    const rebound = structuredClone(creatorScope);
    rebound.provenance.creatorId = "different-creator@example.test";
    let runtimeLoads = 0;
    await expect(runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: rebound.objective,
      workdir: pair.clone.root,
      publish: false,
      creatorScope: rebound,
      requireExecutionReadyCreatorScope: true,
      episodeId,
      runtimeFor: () => {
        runtimeLoads += 1;
        return new ProductPlanningRuntime();
      },
      now: () => NOW,
    })).rejects.toThrow(/resume facts differ from persisted intent/);
    expect(runtimeLoads).toBe(0);
    expect((await readCurrentEpisodePlan(stateHome, episodeId))?.creatorProvenance)
      .toEqual(creatorScope.provenance);
  });

  it("fails an explicitly execution-ready but incomplete creator scope before runtime construction", async () => {
    const { app, appsFile } = fixture();
    const creatorScope = executionReadyBootstrapScope();
    creatorScope.acceptanceCriteria = [];
    let runtimeLoads = 0;

    const result = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: creatorScope.objective,
      workdir: pair.clone.root,
      publish: false,
      creatorScope,
      requireExecutionReadyCreatorScope: true,
      runtimeFor: () => {
        runtimeLoads += 1;
        return new ProductPlanningRuntime();
      },
      now: () => NOW,
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("EpisodePlanner was not invoked");
    expect(result.problems).toEqual([
      expect.stringContaining("creator_scope_acceptance_required"),
    ]);
    expect(runtimeLoads).toBe(0);
    expect(existsSync(join(stateHome, "telemetry"))).toBe(false);
  });

  it("fails a disposition-mismatched creator scope before runtime construction", async () => {
    const { app, appsFile } = fixture();
    const creatorScope = executionReadyBootstrapScope();
    creatorScope.planningDisposition = "planner_input";
    let runtimeLoads = 0;

    const result = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: creatorScope.objective,
      workdir: pair.clone.root,
      publish: false,
      creatorScope,
      requireExecutionReadyCreatorScope: true,
      runtimeFor: () => {
        runtimeLoads += 1;
        return new ProductPlanningRuntime();
      },
      now: () => NOW,
    });

    expect(result.status).toBe("failed");
    expect(result.problems).toEqual([
      expect.stringContaining("creator_scope_bypass_not_requested"),
    ]);
    expect(runtimeLoads).toBe(0);
    expect(existsSync(join(stateHome, "telemetry"))).toBe(false);
  });

  it("rejects invented operations before route persistence or delivery execution", async () => {
    const { app, appsFile } = fixture();
    const runtime = new ProductPlanningRuntime(() => [{
      ...providerStep("invented", "plan/invented", [], "ticket-plan", "TicketPlan"),
      requiredCapabilities: ["structured_verdict"],
    }]);
    const result = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: "Invent nothing",
      workdir: pair.clone.root,
      publish: false,
      runtimeFor: () => runtime,
      episodePlannerPromptText: EPISODE_PROMPT,
      now: () => NOW,
    });

    expect(result.status).toBe("failed");
    // One proposal plus the one bounded repair; no delivery call.
    expect(runtime.calls).toHaveLength(2);
    expect(runtime.calls.every((call) => call.req.task.includes("[episode_planner_input]"))).toBe(true);
    expect(result.problems?.join(" ")).toContain("plan_operation_unknown");
    expect(result.problems?.join(" ")).toContain(
      "valid operations are: plan/arbitrate, plan/bootstrap, plan/decompose, plan/product-a, plan/product-b, plan/vision",
    );
  });

  it("fails an invalid terminal TicketPlan without a hidden provider reformat turn", async () => {
    const { app, appsFile } = fixture();
    const runtime = new ProductPlanningRuntime(minimalWorkflow, () => "not JSON");
    const result = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: "Return a valid ticket plan",
      workdir: pair.clone.root,
      publish: false,
      runtimeFor: () => runtime,
      episodePlannerPromptText: EPISODE_PROMPT,
      now: () => NOW,
    });

    expect(result.status).toBe("failed");
    expect(result.problems).toEqual([
      "planner output is not a parseable TicketPlan JSON object",
    ]);
    // The failed planned delivery is a typed material event, so one bounded
    // EpisodePlanner revision attempt follows it. It is not an undeclared
    // provider-side output reformat or a second delivery attempt.
    expect(runtime.calls).toHaveLength(3);
    expect(runtime.calls.filter((call) => call.req.task.includes("[episode_planner_input]")))
      .toHaveLength(2);
  });

  it("preserves source bytes in bounded planner/delivery input, durable manifests, and hash-only ticket provenance", async () => {
    const { app, appsFile } = fixture();
    pair.clone.commit("docs: add operator truth", {
      "docs/design.md": "The launch page must say Copper Kestrel.\n",
    });
    const runtime = new ProductPlanningRuntime();
    const gh = new FakeGhOps();
    const result = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: "Ship the supplied design",
      workdir: pair.clone.root,
      sources: [{ path: "docs/design.md" }],
      gh,
      runtimeFor: () => runtime,
      episodePlannerPromptText: EPISODE_PROMPT,
      now: () => NOW,
    });

    expect(result.status, result.summary).toBe("completed");
    expect(runtime.calls[0]!.req.task).toContain("Copper Kestrel");
    expect(runtime.calls[1]!.req.task).toContain("Copper Kestrel");
    expect(result.planningSources?.sources[0]).toMatchObject({ consumption: "consumed" });
    const finalRun = (await readdir(join(stateHome, "runs", "greenfield")))
      .find((runId) => runId.includes("episode-plan-dag"))!;
    const manifest = JSON.parse(
      await readFile(join(stateHome, "runs", "greenfield", finalRun, "planning-sources.json"), "utf8"),
    ) as { manifest_sha256: string; sources: Array<{ consumption: string }> };
    expect(manifest.sources[0]?.consumption).toBe("consumed");
    const issue = (await gh.listIssues({ state: "all", limit: 10 }))[0]!;
    expect(issue.body).toContain(manifest.manifest_sha256);
    expect(issue.body).not.toContain("Copper Kestrel");
  });

  it("fails a missing required source before constructing EpisodePlanner", async () => {
    const { app, appsFile } = fixture();
    let runtimeLoads = 0;
    await expect(runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: "Use the required product truth",
      workdir: pair.clone.root,
      sources: [{ path: "docs/does-not-exist.md" }],
      runtimeFor: () => {
        runtimeLoads += 1;
        return new ProductPlanningRuntime();
      },
      episodePlannerPromptText: EPISODE_PROMPT,
      now: () => NOW,
    })).rejects.toThrow(/required source is missing/);
    expect(runtimeLoads).toBe(0);
    expect(existsSync(join(stateHome, "telemetry"))).toBe(false);
  });

  it("recovers terminal provider output on resume without another model call", async () => {
    const { app, appsFile } = fixture();
    const episodeId = "trace:greenfield:resume-product-plan";
    const firstRuntime = new ProductPlanningRuntime();
    let injected = false;
    const first = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: "Resume exactly once",
      workdir: pair.clone.root,
      publish: false,
      episodeId,
      runtimeFor: () => firstRuntime,
      episodePlannerPromptText: EPISODE_PROMPT,
      afterPlanningProviderTurnFinalized: () => {
        if (!injected) {
          injected = true;
          throw new Error("fault after terminal provider evidence");
        }
      },
      now: () => NOW,
    });
    expect(first.status).toBe("failed");
    expect(firstRuntime.calls).toHaveLength(2);

    let runtimeLoads = 0;
    const resumed = await runAutoPlan({
      orgHome: process.cwd(),
      stateHome,
      app,
      appsFile,
      goal: "Resume exactly once",
      workdir: pair.clone.root,
      publish: false,
      episodeId,
      runtimeFor: () => {
        runtimeLoads += 1;
        throw new Error("resume must not construct a runtime");
      },
      episodePlannerPromptText: EPISODE_PROMPT,
      now: () => NOW,
    });

    expect(resumed.status, resumed.summary).toBe("completed");
    expect(runtimeLoads).toBe(0);
    expect((await readEpisodePlanExecutionJournal(stateHome, episodeId))?.status).toBe("completed");
  });
});

describe("planning operation catalog and TicketPlan parsing", () => {
  it("exposes exact governed pipeline/pass/template bindings", () => {
    expect(PLANNING_PROVIDER_OPERATION_CATALOG["plan/bootstrap"]).toEqual({
      operation: "plan/bootstrap",
      role: "planner",
      pipeline: "plan-bootstrap",
      pass: "bootstrap-plan",
      template: "plan/bootstrap.md",
      output: "ticket_plan",
    });
    expect(PLANNING_PROVIDER_OPERATION_CATALOG["plan/decompose"].template)
      .toBe("plan/decomposer.md");
  });

  it("takes bare JSON, fenced JSON, and JSON with trailing prose", () => {
    expect(parsePlanJson(BOOTSTRAP_PLAN)?.tickets).toHaveLength(1);
    expect(parsePlanJson(`Here is the plan:\n\`\`\`json\n${BOOTSTRAP_PLAN}\n\`\`\`\nDone.`)?.tickets)
      .toHaveLength(1);
    expect(parsePlanJson("no json here")).toBeUndefined();
  });
});

function plannerPayload(task: string): {
  proposalCreatedAt: string;
  intent: EpisodeIntent;
} {
  const marker = task.indexOf("[episode_planner_input]");
  const start = task.indexOf("{", marker);
  if (start < 0) throw new Error("EpisodePlanner task has no JSON payload");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < task.length; index += 1) {
    const character = task[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) {
      return JSON.parse(task.slice(start, index + 1)) as {
        proposalCreatedAt: string;
        intent: EpisodeIntent;
      };
    }
  }
  throw new Error("EpisodePlanner task has an unterminated JSON payload");
}

function proposal(
  intent: EpisodeIntent,
  createdAt: string,
  steps: ProposedEpisodeStep[],
): ProposedEpisodePlan {
  const providerTurnBudgetUsd = steps
    .filter((step) => step.kind === "provider_turn")
    .reduce((sum, step) => sum + step.maxTurnBudgetUsd, 0);
  return {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: "Smallest sufficient governed product-planning workflow",
    workflowClass: "bounded-product-plan",
    planningSource: "episode_planner",
    steps,
    estimatedBudget: {
      providerTurns: steps.filter((step) => step.kind === "provider_turn").length,
      providerTurnBudgetUsd,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: providerTurnBudgetUsd,
    },
    derivedSafetyRoute: {
      label: "quick",
      reasons: [],
      gateStepIds: [],
      approvalStepIds: [],
    },
    createdAt,
  };
}

function minimalWorkflow(intent: EpisodeIntent): ProposedEpisodeStep[] {
  const operation = intent.appStage === "bootstrap" ? "plan/bootstrap" : "plan/decompose";
  return [{
    ...providerStep("ticket-plan", operation, [], "ticket-plan", "TicketPlan"),
    requiredCapabilities: ["structured_verdict"],
  }];
}

function twoStepMatureWorkflow(): ProposedEpisodeStep[] {
  return [
    providerStep("vision", "plan/vision", [], "vision", "planning-artifact"),
    {
      ...providerStep("ticket-plan", "plan/decompose", ["vision"], "ticket-plan", "TicketPlan"),
      requiredCapabilities: ["structured_verdict"],
      inputRefs: [{ ref: "plan-output:vision", required: true }],
    },
  ];
}

function providerStep(
  id: string,
  operation: string,
  dependsOn: string[],
  outputId: string,
  outputKind: string,
): Extract<ProposedEpisodeStep, { kind: "provider_turn" }> {
  return {
    kind: "provider_turn",
    id,
    operation,
    role: "planner",
    objective: `Execute ${operation}`,
    dependsOn,
    requiredCapabilities: [],
    inputRefs: [],
    expectedOutputs: [{ id: outputId, kind: outputKind, required: true }],
    maxTurnBudgetUsd: 5,
    selectionReason: "Smallest sufficient governed planning operation",
  };
}

function executionReadyBootstrapScope(): CreatorEpisodeScope {
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "human",
      creatorId: "operator@example.test",
      createdAt: NOW.toISOString(),
      evidenceRefs: ["prompt:explicit-product-scope"],
    },
    workKind: "bootstrap-product-plan",
    objective: "Ship one bounded bootstrap milestone",
    inScope: ["Create the first milestone TicketPlan"],
    outOfScope: ["Publish anything except orchestrator-created tickets"],
    acceptanceCriteria: ["A schema-valid bootstrap TicketPlan exists"],
    expectedArtifacts: [{ id: "ticket-plan", kind: "TicketPlan", required: true }],
    declaredConstraints: { workflowAuthority: "governed-operation-catalog" },
    safetyFacts: [],
    steps: minimalWorkflow({ appStage: "bootstrap" } as EpisodeIntent),
  };
}

function completed(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime: "claude", id: `session-${Math.random()}` },
    usage: {
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.5,
      subagentTurns: 0,
      wallClockMs: 100,
    },
    escalations: [],
  };
}
