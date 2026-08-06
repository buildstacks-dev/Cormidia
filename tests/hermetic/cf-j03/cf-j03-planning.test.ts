// HB-041 — J-03 planning contract. Exercises the real deterministic planner
// boundaries and the GitHub process double; no provider runtime is built.

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CreatorEpisodeScope } from "../../../src/loop/episode-plan.js";
import {
  finalizePlanForPublication,
  parsePlanTicketIndex,
  parsePlannedBy,
  publishPlanProjection,
  type PlanProvenance,
  type PlanTicket,
  type TicketPlan,
} from "../../../src/loop/plan-tickets.js";
import {
  readPublishedTicketsRecord,
  writePublishedTicketsRecord,
} from "../../../src/loop/plan-publication-record.js";
import { GhCliOps } from "../../../src/loop/github.js";
import type { RoleConfig } from "../../../src/runtime/types.js";
import type { AppEntry } from "../../../src/org/apps.js";
import {
  CreatorScopeConflictError,
  prepareEpisodePlan,
} from "../../../src/org/episode-planner/coordinator.js";
import {
  previewEpisode,
  type EpisodeOrchestrationFacts,
} from "../../../src/org/episode-planner/orchestrator.js";
import { buildEpisodeIntent } from "../../../src/org/episode-planner/policy.js";
import {
  PlanningSourceResolutionError,
  resolvePlanningSources,
} from "../../../src/org/planning-inputs.js";
import {
  installGithubDouble,
  type GithubDoubleHandle,
} from "../../fixtures/github-double/install.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const githubs: GithubDoubleHandle[] = [];
const homes: TempStateHome[] = [];

afterEach(async () => {
  await Promise.all(githubs.splice(0).map((github) => github.dispose()));
  await Promise.all(homes.splice(0).map((home) => home.cleanup()));
});

const app: AppEntry = {
  name: "planner-app",
  repo: "cormidia-double/planner-app",
  status: "live",
  budgetUsdMonth: 100, objectiveBudgetUsd: 1000,
  cadence: {},
  execution: { assignmentMode: "fixed", allowedAssignments: {} },
};

const roles: RoleConfig[] = [
  {
    name: "planner",
    runtime: "claude",
    model: "claude-test",
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: ["plan"],
    maxTurnBudgetUsd: 5,
  },
  {
    name: "builder",
    runtime: "codex",
    model: "codex-test",
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: ["artifact"],
    maxTurnBudgetUsd: 5,
  },
];

function ticket(title: string, dependsOn: number[] = []): PlanTicket {
  return {
    title,
    tier: "op:tier-standard",
    priority: "p2",
    dependsOn,
    executionGroup: "delivery",
    fileScope: ["src/feature.ts"],
    goal: `Deliver ${title}`,
    context: "A bounded product-planning milestone.",
    acceptanceCriteria: [`${title} has deterministic acceptance evidence`],
    outOfScope: "Unrelated features.",
    notesForBuilder: "Preserve the accepted plan contract.",
  };
}

function ticketPlan(): TicketPlan {
  return {
    stage: "growth",
    ticketCountRationale: "One root slice and one dependent integration slice.",
    releaseDisposition: "The operator owns a merge-only milestone.",
    releaseKind: "merge-only",
    tickets: [ticket("Build the root slice"), ticket("Integrate the slice", [0])],
  };
}

function creatorScope(): CreatorEpisodeScope {
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "human",
      creatorId: "owner",
      createdAt: "2026-07-31T12:00:00.000Z",
      evidenceRefs: ["request:approved"],
    },
    objective: "Implement the bounded feature.",
    inScope: ["src/feature.ts"],
    outOfScope: ["unrelated work"],
    acceptanceCriteria: ["artifact is produced"],
    expectedArtifacts: [{ id: "artifact", kind: "file", required: true }],
    declaredConstraints: {},
    safetyFacts: [],
    steps: [{
      id: "implement",
      kind: "provider_turn",
      operation: "ticket/implement",
      role: "builder",
      objective: "Implement the accepted feature scope.",
      requiredCapabilities: [],
      dependsOn: [],
      inputRefs: [],
      expectedOutputs: [{ id: "artifact", kind: "file", required: true }],
      maxTurnBudgetUsd: 5,
      selectionReason: "The configured builder owns implementation.",
    }],
  };
}

function facts(scope?: CreatorEpisodeScope): EpisodeOrchestrationFacts {
  return {
    episodeId: "episode-plan-1",
    trigger: { kind: "manual" },
    goal: "Implement the bounded feature.",
    lifecycle: "live",
    appStage: "growth",
    repositoryFacts: { defaultBranch: "trunk" },
    requestedConstraints: {},
    hardBudget: {
      maxProviderTurns: 3,
      maxEquivalentCostUsd: 15,
      maxActiveTimeMs: 600_000,
      maxHumanDecisions: 0,
    },
    requiredSafetyFacts: [],
    ...(scope === undefined ? {} : { creatorScope: scope }),
  };
}

const planner = {
  limits: {
    maxAttempts: 2,
    perAttempt: { equivalentCostUsd: 5, activeTimeMs: 120_000 },
    aggregate: { providerTurns: 2, equivalentCostUsd: 10, activeTimeMs: 240_000 },
  },
};

describe("CF-J03-S/I/RC — durable planning and idempotent publication", () => {
  it("publishes lineage, dependency edges, readiness, and a durable local mirror", async () => {
    const github = await installGithubDouble({ repo: app.repo, defaultBranch: "trunk" });
    githubs.push(github);
    const home = await makeTempStateHome({ name: "planner-publication" });
    homes.push(home);
    const gh = new GhCliOps(github.repo, github.exec);
    const provenance: PlanProvenance = {
      episodeId: "episode-plan-1",
      runId: "run-plan-1",
      traceId: "trace-plan-1",
    };

    const result = await publishPlanProjection(
      gh,
      finalizePlanForPublication(ticketPlan()),
      undefined,
      provenance,
    );
    expect(result.published.map((entry) => ({ index: entry.index, ready: entry.ready }))).toEqual([
      { index: 0, ready: true },
      { index: 1, ready: false },
    ]);

    const issues = Object.values(github.readState().issues).sort((left, right) => left.number - right.number);
    expect(issues).toHaveLength(2);
    expect(issues[0]!.labels).toContain("op:ready");
    expect(issues[1]!.labels).not.toContain("op:ready");
    expect(issues[1]!.body).toContain(`Depends-on: #${issues[0]!.number}`);
    expect(issues.map((issue) => parsePlannedBy(issue.body))).toEqual([provenance, provenance]);
    expect(issues.map((issue) => parsePlanTicketIndex(issue.body))).toEqual([0, 1]);

    await writePublishedTicketsRecord(home.stateHome, app.name, provenance, result.published, new Date("2026-07-31T12:05:00Z"));
    expect(await readPublishedTicketsRecord(home.stateHome, app.name, provenance.runId)).toMatchObject({
      episode_id: provenance.episodeId,
      run_id: provenance.runId,
      trace_id: provenance.traceId,
      published: [
        { index: 0, issue_number: issues[0]!.number, ready: true },
        { index: 1, issue_number: issues[1]!.number, ready: false },
      ],
    });
  });

  it("recovers a lost issue-create response without duplicating the accepted effect", async () => {
    const github = await installGithubDouble({
      repo: app.repo,
      scenario: [{ op: "issue.create", fail: "lost_response" }],
    });
    githubs.push(github);
    const gh = new GhCliOps(github.repo, github.exec);
    const provenance: PlanProvenance = {
      episodeId: "episode-recovery",
      runId: "run-recovery",
      traceId: "trace-recovery",
    };
    const projection = finalizePlanForPublication(ticketPlan());

    await expect(publishPlanProjection(gh, projection, undefined, provenance)).rejects.toThrow(
      /rerun with the same Planned-by identity/,
    );
    expect(Object.values(github.readState().issues)).toHaveLength(1);

    const recovered = await publishPlanProjection(gh, projection, undefined, provenance);
    github.assertScenarioDrained();
    expect(recovered.published.map((entry) => entry.index)).toEqual([0, 1]);
    expect(Object.values(github.readState().issues)).toHaveLength(2);
    expect(github.callLog().filter((entry) => entry.op === "issue.create")).toHaveLength(2);
  });

  it("repairs labels after a partial issue create without duplicating the issue", async () => {
    const github = await installGithubDouble({
      repo: app.repo,
      scenario: [{ op: "issue.create", fail: "partial_labels" }],
    });
    githubs.push(github);
    const gh = new GhCliOps(github.repo, github.exec);
    const provenance: PlanProvenance = {
      episodeId: "episode-partial",
      runId: "run-partial",
      traceId: "trace-partial",
    };
    const projection = finalizePlanForPublication(ticketPlan());

    await expect(publishPlanProjection(gh, projection, undefined, provenance)).rejects.toThrow(
      /rerun with the same Planned-by identity/,
    );
    expect(Object.values(github.readState().issues)[0]?.labels).toEqual([]);

    await publishPlanProjection(gh, projection, undefined, provenance);
    github.assertScenarioDrained();
    const issues = Object.values(github.readState().issues).sort((left, right) => left.number - right.number);
    expect(issues).toHaveLength(2);
    expect(issues[0]!.labels).toEqual(expect.arrayContaining([
      "op:tier-standard",
      "p2",
      "op:ready",
    ]));
    expect(github.callLog().filter((entry) => entry.op === "issue.create")).toHaveLength(2);
  });

  it("rejects a dependency cycle even when another dependency-free ticket exists", () => {
    const plan = ticketPlan();
    plan.tickets.push(ticket("Cycle left", [3]), ticket("Cycle right", [2]));
    expect(() => finalizePlanForPublication(plan)).toThrow(/must be a DAG/);
  });
});

describe("CF-J03-R/A — pre-provider refusal and truthful previews", () => {
  it("refuses an incomplete explicit execution-ready scope before invoking a proposer", async () => {
    const home = await makeTempStateHome({ name: "planner-refusal" });
    homes.push(home);
    const { steps: _steps, ...incompleteScope } = creatorScope();
    const intent = buildEpisodeIntent({ app, roles, ...facts(incompleteScope) });
    let proposerCalls = 0;

    await expect(prepareEpisodePlan({
      root: home.stateHome,
      app,
      roles,
      intent,
      propose: async () => {
        proposerCalls += 1;
        return {};
      },
    })).rejects.toBeInstanceOf(CreatorScopeConflictError);
    expect(proposerCalls).toBe(0);
  });

  it("keeps both planning routes schema-aligned while previewing zero runtime calls and writes", () => {
    const automatic = previewEpisode({ app, roles, facts: facts(), planner });
    const creator = previewEpisode({ app, roles, facts: facts(creatorScope()), planner });

    expect(Object.keys(automatic).sort()).toEqual(Object.keys(creator).sort());
    expect(automatic).toMatchObject({
      providerRuntimeCalled: false,
      durableStateWritten: false,
      exactProviderAuthoredPlan: null,
      planningPath: "episode_planner_provider_turn",
    });
    expect(creator).toMatchObject({
      providerRuntimeCalled: false,
      durableStateWritten: false,
      exactProviderAuthoredPlan: null,
      planningPath: "creator_scope_normalization",
    });
    expect(automatic.schemaVersion).toBe(creator.schemaVersion);
  });

  it("fails missing and over-budget required sources while retaining optional absence", async () => {
    const home = await makeTempStateHome({ name: "planner-sources" });
    homes.push(home);
    const checkout = join(home.stateHome, "checkout");
    await mkdir(checkout, { recursive: true });
    await writeFile(join(checkout, "requirements.md"), "bounded product requirements\n", "utf8");
    const base = {
      app: app.name,
      traceId: "trace-sources",
      sourceCheckout: checkout,
      sourceCheckoutHead: "0123456789abcdef",
    };

    expect(() => resolvePlanningSources({
      ...base,
      requests: [{ path: "missing.md", requirement: "required" }],
      budgetBytes: 1024,
    })).toThrow(PlanningSourceResolutionError);
    expect(() => resolvePlanningSources({
      ...base,
      requests: [{ path: "requirements.md", requirement: "required" }],
      budgetBytes: 4,
    })).toThrow(/required source bytes .* exceed/);

    const optional = resolvePlanningSources({
      ...base,
      requests: [{ path: "missing.md", requirement: "optional" }],
      budgetBytes: 1024,
    });
    expect(optional.documents).toEqual([]);
    expect(optional.manifest.roots).toMatchObject([
      { requested_path: "missing.md", requirement: "optional", availability: "missing" },
    ]);
  });
});
