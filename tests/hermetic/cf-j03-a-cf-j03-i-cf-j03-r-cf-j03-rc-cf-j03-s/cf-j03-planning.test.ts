// Traceability: CF-J03-S · HB-041; CF-J03-R · HB-041; CF-J03-I · HB-041; CF-J03-RC · HB-041; CF-J03-A · HB-041 · contracts/journey-acceptance.md J-03.

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
  type PlanningSourceTicketEvidence,
  type TicketPlan,
} from "../../../src/loop/plan-tickets.js";
import { readPublishedTicketsRecord, writePublishedTicketsRecord } from "../../../src/loop/plan-publication-record.js";
import { GhCliOps } from "../../../src/loop/github.js";
import type { RoleConfig } from "../../../src/runtime/types.js";
import type { AppEntry } from "../../../src/org/apps.js";
import { CreatorScopeConflictError, prepareEpisodePlan } from "../../../src/org/episode-planner/coordinator.js";
import { previewEpisode, type EpisodeOrchestrationFacts } from "../../../src/org/episode-planner/orchestrator.js";
import { buildEpisodeIntent } from "../../../src/org/episode-planner/policy.js";
import { persistPublishedRoadmap } from "../../../src/org/plan-auto.js";
import {
  planningCoverageScopeId,
  preparePlanningPublication,
  readPlanningCoverage,
  recordPlanningDecomposition,
} from "../../../src/org/planning-coverage.js";
import { publishPlanningCoverage } from "../../../src/org/planning-coverage-publication.js";
import { recoverPreparedAutoPlanningCoverage } from "../../../src/org/planning-auto-coverage.js";
import { PlanningSourceResolutionError, resolvePlanningSources } from "../../../src/org/planning-inputs.js";
import { planningRecoveryIntentHash } from "../../../src/org/planning-publication.js";
import { resolvePlanningStage } from "../../../src/org/planning-stage.js";
import { readCurrentRoadmapPlan } from "../../../src/org/roadmap-delivery/roadmap-plan.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";
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
  budgetUsdMonth: 100,
  objectiveBudgetUsd: 1000,
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
    steps: [
      {
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
      },
    ],
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

    const result = await publishPlanProjection(gh, finalizePlanForPublication(ticketPlan()), undefined, provenance);
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

    await writePublishedTicketsRecord(
      home.stateHome,
      app.name,
      provenance,
      result.published,
      new Date("2026-07-31T12:05:00Z"),
    );
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
    expect(issues[0]!.labels).toEqual(expect.arrayContaining(["op:tier-standard", "p2", "op:ready"]));
    expect(github.callLog().filter((entry) => entry.op === "issue.create")).toHaveLength(2);
  });

  it("recovers a non-zero-index second publication batch in the full decomposition index space", async () => {
    const github = await installGithubDouble({ repo: app.repo, defaultBranch: "trunk" });
    githubs.push(github);
    const gh = new GhCliOps(github.repo, github.exec);
    const provenance: PlanProvenance = {
      episodeId: "episode-first-batch",
      runId: "run-first-batch",
      traceId: "trace-first-batch",
    };
    const deltaProvenance: PlanProvenance = {
      episodeId: "episode-delta-batch",
      runId: "run-delta-batch",
      traceId: "trace-delta-batch",
    };
    const plan: TicketPlan = {
      ...ticketPlan(),
      stage: "mature",
      ticketCountRationale: "Six durable corpus slices published in two bounded batches.",
      tickets: Array.from({ length: 6 }, (_, index) => ticket(`Corpus ticket ${index}`, index === 3 ? [0] : [])),
    };
    const first = finalizePlanForPublication(plan, undefined, { indexes: [0, 1, 2], publicationCap: 3 });
    expect(first.plan.tickets).toHaveLength(6);
    const firstPublished = await publishPlanProjection(gh, first, undefined, provenance);
    const known = new Map(firstPublished.published.map((ticket) => [ticket.index, ticket.issueNumber]));

    github.script({ op: "issue.create", fail: "lost_response" });
    const second = finalizePlanForPublication(plan, undefined, {
      indexes: [3, 4, 5],
      publicationCap: 3,
      deliveredIndexes: new Set([0, 1, 2]),
    });
    await expect(publishPlanProjection(gh, second, undefined, deltaProvenance, known)).rejects.toThrow(
      /rerun with the same Planned-by identity/,
    );
    const recovered = await publishPlanProjection(gh, second, undefined, deltaProvenance, known);
    github.assertScenarioDrained();
    expect(recovered.published.map((entry) => entry.index)).toEqual([3, 4, 5]);
    const issues = Object.values(github.readState().issues).sort((left, right) => left.number - right.number);
    expect(issues).toHaveLength(6);
    expect(issues.map((issue) => parsePlanTicketIndex(issue.body))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(issues[3]!.body).toContain(`Depends-on: #${issues[0]!.number}`);
  });

  it("keeps a publication batch prepared until idempotent RoadmapPlan persistence succeeds", async () => {
    const github = await installGithubDouble({ repo: app.repo, defaultBranch: "trunk" });
    githubs.push(github);
    const home = await makeTempStateHome({ name: "planner-roadmap-barrier" });
    homes.push(home);
    const gh = new GhCliOps(github.repo, github.exec);
    const provenance: PlanProvenance = {
      episodeId: "episode-roadmap-barrier",
      runId: "run-roadmap-barrier",
      traceId: "trace-roadmap-barrier",
    };
    const scopeId = "roadmap-barrier";
    const stored = await recordPlanningDecomposition({
      root: home.stateHome,
      app: app.name,
      scopeId,
      requestHash: "roadmap-barrier-request",
      planningIntentHash: "roadmap-barrier-intent",
      sourceManifestSha256: null,
      request: undefined,
      disposition: "accepted",
      refusalProblems: [],
      publicationCap: 2,
      plan: ticketPlan(),
      sections: [],
      provenance,
      mode: "initial",
      now: new Date("2026-08-09T15:00:00Z"),
    });
    let tick = 0;
    const clock = () => new Date(Date.UTC(2026, 7, 9, 15, 1, tick++));
    let failAfterRoadmapCommit = true;
    const persistRoadmap: Parameters<typeof publishPlanningCoverage>[0]["persistRoadmap"] = async (input) => {
      await persistPublishedRoadmap({ stateHome: home.stateHome, app, ...input });
      if (failAfterRoadmapCommit) {
        failAfterRoadmapCommit = false;
        throw new Error("seeded crash after RoadmapPlan commit");
      }
    };

    await expect(
      publishPlanningCoverage({
        stateHome: home.stateHome,
        app,
        gh,
        coverage: stored.record,
        resume: false,
        clock,
        persistRoadmap,
      }),
    ).rejects.toThrow(/seeded crash after RoadmapPlan commit/);
    const interrupted = await readPlanningCoverage(home.stateHome, app.name, scopeId);
    expect(interrupted?.publication_batches).toMatchObject([{ status: "prepared", indexes: [0, 1] }]);
    expect(interrupted?.tickets.every((entry) => entry.state === "planned" && entry.issue_number === null)).toBe(true);
    expect(await readCurrentRoadmapPlan(home.stateHome, app.name)).toBeDefined();
    expect(Object.values(github.readState().issues)).toHaveLength(2);

    const recovered = await publishPlanningCoverage({
      stateHome: home.stateHome,
      app,
      gh,
      coverage: interrupted!,
      resume: true,
      clock,
      persistRoadmap,
    });
    expect(recovered.coverage.publication_batches).toMatchObject([{ status: "completed", indexes: [0, 1] }]);
    expect(
      recovered.coverage.tickets.every((entry) => entry.state === "published" && entry.issue_number !== null),
    ).toBe(true);
    expect(Object.values(github.readState().issues)).toHaveLength(2);
    expect(github.callLog().filter((entry) => entry.op === "issue.create")).toHaveLength(2);
  });

  it("publishes a prepared batch under its immutable admission after the future cap tightens", async () => {
    const github = await installGithubDouble({ repo: app.repo, defaultBranch: "trunk" });
    githubs.push(github);
    const home = await makeTempStateHome({ name: "planner-prepared-cap" });
    homes.push(home);
    const gh = new GhCliOps(github.repo, github.exec);
    const scopeId = "prepared-cap";
    const plan: TicketPlan = {
      ...ticketPlan(),
      stage: "mature",
      ticketCountRationale: "Eight independent slices exercise a preserved seven-ticket admission.",
      tickets: Array.from({ length: 8 }, (_, index) => ticket(`Prepared cap ticket ${index + 1}`)),
    };
    const stored = await recordPlanningDecomposition({
      root: home.stateHome,
      app: app.name,
      scopeId,
      requestHash: "prepared-cap-request",
      planningIntentHash: "prepared-cap-intent",
      sourceManifestSha256: null,
      request: undefined,
      disposition: "accepted",
      refusalProblems: [],
      publicationCap: 7,
      plan,
      sections: [],
      provenance: { episodeId: "episode-prepared-cap", runId: "run-prepared-cap", traceId: "trace-prepared-cap" },
      mode: "initial",
      now: new Date("2026-08-09T16:00:00Z"),
    });
    const admitted = await preparePlanningPublication(
      home.stateHome,
      app.name,
      scopeId,
      true,
      new Date("2026-08-09T16:01:00Z"),
    );
    expect(admitted.record.publication_batches[0]).toMatchObject({ indexes: [0, 1, 2, 3, 4, 5, 6], admission_cap: 7 });
    const tightened = await readPlanningCoverage(
      home.stateHome,
      app.name,
      scopeId,
      3,
      new Date("2026-08-09T16:02:00Z"),
    );
    let tick = 0;
    const clock = () => new Date(Date.UTC(2026, 7, 9, 16, 3, tick++));
    const first = await publishPlanningCoverage({
      stateHome: home.stateHome,
      app,
      gh,
      coverage: tightened!,
      resume: true,
      clock,
      persistRoadmap: async () => undefined,
    });
    expect(first.published.map((entry) => entry.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(first.coverage.publication_cap).toBe(3);
    expect(first.coverage.publication_batches[0]?.admission_cap).toBe(7);

    const second = await publishPlanningCoverage({
      stateHome: home.stateHome,
      app,
      gh,
      coverage: first.coverage,
      resume: true,
      clock,
      persistRoadmap: async () => undefined,
    });
    expect(second.published.map((entry) => entry.index)).toEqual([7]);
    expect(second.coverage.publication_batches.at(-1)?.admission_cap).toBe(3);
    expect(Object.values(github.readState().issues)).toHaveLength(8);
    expect(stored.record.publication_cap).toBe(7);
  });

  it("keeps original hash-only source evidence across later publication batches", async () => {
    const github = await installGithubDouble({ repo: app.repo, defaultBranch: "trunk" });
    githubs.push(github);
    const home = await makeTempStateHome({ name: "planner-source-evidence" });
    homes.push(home);
    const gh = new GhCliOps(github.repo, github.exec);
    const scopeId = "source-evidence";
    const originalEvidence: PlanningSourceTicketEvidence = {
      manifestSha256: "manifest-original",
      sources: [
        {
          canonicalRef: "git:original-head:docs/spec.md",
          sourceSha256: "source-original",
          sourceBytes: 100,
          includedBytes: 100,
          inclusion: "full",
          trust: "operator-supplied-untrusted-data",
        },
      ],
    };
    const currentResumeEvidence: PlanningSourceTicketEvidence = {
      manifestSha256: "manifest-later-invocation",
      sources: [{ ...originalEvidence.sources[0]!, canonicalRef: "git:later-head:docs/spec.md" }],
    };
    const stored = await recordPlanningDecomposition({
      root: home.stateHome,
      app: app.name,
      scopeId,
      requestHash: "source-evidence-request",
      planningIntentHash: "source-evidence-intent",
      sourceManifestSha256: "coverage-source-original",
      request: undefined,
      disposition: "accepted",
      refusalProblems: [],
      publicationCap: 1,
      plan: { ...ticketPlan(), tickets: [ticket("Evidence one"), ticket("Evidence two")] },
      sections: [],
      provenance: { episodeId: "episode-source", runId: "run-source", traceId: "trace-source" },
      sourceEvidence: originalEvidence,
      mode: "initial",
      now: new Date("2026-08-09T17:00:00Z"),
    });
    let tick = 0;
    const clock = () => new Date(Date.UTC(2026, 7, 9, 17, 1, tick++));
    const first = await publishPlanningCoverage({
      stateHome: home.stateHome,
      app,
      gh,
      coverage: stored.record,
      sourceEvidence: currentResumeEvidence,
      resume: false,
      clock,
      persistRoadmap: async () => undefined,
    });
    const second = await publishPlanningCoverage({
      stateHome: home.stateHome,
      app,
      gh,
      coverage: first.coverage,
      sourceEvidence: currentResumeEvidence,
      resume: true,
      clock,
      persistRoadmap: async () => undefined,
    });

    const issues = Object.values(github.readState().issues).sort((left, right) => left.number - right.number);
    expect(issues).toHaveLength(2);
    for (const issue of issues) {
      expect(issue.body).toContain("Manifest SHA-256: manifest-original");
      expect(issue.body).toContain("git:original-head:docs/spec.md");
      expect(issue.body).not.toContain("manifest-later-invocation");
      expect(issue.body).not.toContain("git:later-head:docs/spec.md");
    }
    expect(second.coverage.publication_batches.map((batch) => batch.source_evidence)).toEqual([
      originalEvidence,
      originalEvidence,
    ]);
    expect(JSON.stringify(second.coverage)).not.toContain('"content"');
  });

  it("recovers a prepared publication before consulting a now-missing required source", async () => {
    const github = await installGithubDouble({ repo: app.repo, defaultBranch: "trunk" });
    githubs.push(github);
    const home = await makeTempStateHome({ name: "planner-prepared-before-source" });
    homes.push(home);
    const gh = new GhCliOps(github.repo, github.exec);
    const goal = "Recover the prepared source-bound corpus plan";
    const sources = [{ path: "missing-required-spec.md" }];
    const scopeId = planningCoverageScopeId({ app: app.name, goal, sourceRequests: sources, creatorScope: null });
    const stored = await recordPlanningDecomposition({
      root: home.stateHome,
      app: app.name,
      scopeId,
      requestHash: "prepared-before-source-request",
      planningIntentHash: planningRecoveryIntentHash({
        goal,
        requestedStage: null,
        planning: {},
        creatorScope: null,
      }),
      sourceManifestSha256: "old-source-version",
      request: undefined,
      disposition: "accepted",
      refusalProblems: [],
      publicationCap: 2,
      plan: ticketPlan(),
      sections: [],
      provenance: { episodeId: "episode-source-recovery", runId: "run-source-recovery", traceId: "trace-source" },
      mode: "initial",
      now: new Date("2026-08-09T18:00:00Z"),
    });
    await preparePlanningPublication(home.stateHome, app.name, scopeId, false, new Date("2026-08-09T18:01:00Z"));
    let tick = 0;
    const recovered = await recoverPreparedAutoPlanningCoverage({
      options: { stateHome: home.stateHome, app, goal, sources, resume: true, gh },
      stageResolution: resolvePlanningStage({ checkout: "/missing-current-source", checkoutSource: "explicit" }),
      stageEvidenceCheckout: "/missing-current-source",
      stageEvidenceSource: "explicit",
      clock: () => new Date(Date.UTC(2026, 7, 9, 18, 2, tick++)),
      persistRoadmap: async () => undefined,
    });

    expect(recovered?.status).toBe("completed");
    expect(recovered?.published).toHaveLength(2);
    expect(Object.values(github.readState().issues)).toHaveLength(2);
    expect(stored.record.source_manifest_sha256).toBe("old-source-version");
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

    await expect(
      prepareEpisodePlan({
        root: home.stateHome,
        app,
        roles,
        intent,
        propose: async () => {
          proposerCalls += 1;
          return {};
        },
      }),
    ).rejects.toBeInstanceOf(CreatorScopeConflictError);
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

    expect(() =>
      resolvePlanningSources({
        ...base,
        requests: [{ path: "missing.md", requirement: "required" }],
        budgetBytes: 1024,
      }),
    ).toThrow(PlanningSourceResolutionError);
    expect(() =>
      resolvePlanningSources({
        ...base,
        requests: [{ path: "requirements.md", requirement: "required" }],
        budgetBytes: 4,
      }),
    ).toThrow(/required source bytes .* exceed/);

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
