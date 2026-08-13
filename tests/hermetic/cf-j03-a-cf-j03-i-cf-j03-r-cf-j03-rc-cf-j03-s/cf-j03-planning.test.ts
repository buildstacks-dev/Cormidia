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
  preparePlanningPublication,
  readPlanningLedger,
  recordPlanningLedger,
} from "../../../src/org/planning-publication-operations.js";
import { publishPlanningLedger } from "../../../src/org/planning-publication-publish.js";
import { declarePlanningSourceScope, PlanningSourceResolutionError } from "../../../src/org/planning-inputs.js";
import {
  planningRecoveryIntentHash,
  preparedPlanningRecoveryDecision,
} from "../../../src/org/planning-publication-ledger.js";
import { readCurrentRoadmapPlan } from "../../../src/org/roadmap-delivery/roadmap-plan.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

/** Narrow a read-back ledger without `!` (type ratchet: new code lands with zero). */
function requiredLedger<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to exist`);
  return value;
}

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
    const stored = await recordPlanningLedger({
      root: home.stateHome,
      app: app.name,
      scopeId,
      planningIntentHash: "roadmap-barrier-intent",
      plan: ticketPlan(),
      provenance,
      now: new Date("2026-08-09T15:00:00Z"),
    });
    let tick = 0;
    const clock = () => new Date(Date.UTC(2026, 7, 9, 15, 1, tick++));
    let failAfterRoadmapCommit = true;
    const persistRoadmap: Parameters<typeof publishPlanningLedger>[0]["persistRoadmap"] = async (input) => {
      await persistPublishedRoadmap({ stateHome: home.stateHome, app, ...input });
      if (failAfterRoadmapCommit) {
        failAfterRoadmapCommit = false;
        throw new Error("seeded crash after RoadmapPlan commit");
      }
    };

    await expect(
      publishPlanningLedger({
        stateHome: home.stateHome,
        app,
        gh,
        ledger: stored,
        cap: 3,
        clock,
        persistRoadmap,
      }),
    ).rejects.toThrow(/seeded crash after RoadmapPlan commit/);
    const interrupted = requiredLedger(
      await readPlanningLedger(home.stateHome, app.name, scopeId),
      "interrupted ledger",
    );
    expect(interrupted?.publication_batches).toMatchObject([{ status: "prepared", indexes: [0, 1] }]);
    expect(interrupted?.tickets.every((entry) => entry.state === "planned" && entry.issue_number === null)).toBe(true);
    expect(await readCurrentRoadmapPlan(home.stateHome, app.name)).toBeDefined();
    expect(Object.values(github.readState().issues)).toHaveLength(2);

    const recovered = await publishPlanningLedger({
      stateHome: home.stateHome,
      app,
      gh,
      ledger: interrupted,
      cap: 3,
      clock,
      persistRoadmap,
    });
    expect(recovered.ledger.publication_batches).toMatchObject([{ status: "completed", indexes: [0, 1] }]);
    expect(recovered.ledger.tickets.every((entry) => entry.state === "published" && entry.issue_number !== null)).toBe(
      true,
    );
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
    await recordPlanningLedger({
      root: home.stateHome,
      app: app.name,
      scopeId,
      planningIntentHash: "prepared-cap-intent",
      plan,
      provenance: { episodeId: "episode-prepared-cap", runId: "run-prepared-cap", traceId: "trace-prepared-cap" },
      now: new Date("2026-08-09T16:00:00Z"),
    });
    const admitted = await preparePlanningPublication({
      root: home.stateHome,
      app: app.name,
      scopeId,
      cap: 7,
      now: new Date("2026-08-09T16:01:00Z"),
    });
    expect(admitted.ledger.publication_batches[0]).toMatchObject({ indexes: [0, 1, 2, 3, 4, 5, 6], admission_cap: 7 });
    const tightened = requiredLedger(await readPlanningLedger(home.stateHome, app.name, scopeId), "tightened ledger");
    let tick = 0;
    const clock = () => new Date(Date.UTC(2026, 7, 9, 16, 3, tick++));
    const first = await publishPlanningLedger({
      stateHome: home.stateHome,
      app,
      gh,
      ledger: tightened,
      cap: 3,
      clock,
      persistRoadmap: async () => undefined,
    });
    expect(first.published.map((entry) => entry.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(first.ledger.publication_batches[0]?.admission_cap).toBe(7);

    const second = await publishPlanningLedger({
      stateHome: home.stateHome,
      app,
      gh,
      ledger: first.ledger,
      cap: 3,
      clock,
      persistRoadmap: async () => undefined,
    });
    expect(second.published.map((entry) => entry.index)).toEqual([7]);
    expect(second.ledger.publication_batches.at(-1)?.admission_cap).toBe(3);
    expect(Object.values(github.readState().issues)).toHaveLength(8);
    expect(requiredLedger(admitted.ledger.publication_batches[0], "prepared batch").admission_cap).toBe(7);
  });

  it("keeps original hash-only source evidence across later publication batches", async () => {
    const github = await installGithubDouble({ repo: app.repo, defaultBranch: "trunk" });
    githubs.push(github);
    const home = await makeTempStateHome({ name: "planner-source-evidence" });
    homes.push(home);
    const gh = new GhCliOps(github.repo, github.exec);
    const scopeId = "source-evidence";
    const originalEvidence: PlanningSourceTicketEvidence = {
      scopeSha256: "scope-original",
      evidence: "observed",
      sources: [
        {
          canonicalRef: "git:original-head:docs/spec.md",
          readSha256: "source-original",
          readBytes: 100,
          modality: "text",
          consumption: "consumed",
          trust: "operator-supplied-untrusted-data",
        },
      ],
    };
    // A later invocation's evidence must never displace the authoring turn's:
    // the publishing run often reads nothing at all.
    const laterInvocationEvidence: PlanningSourceTicketEvidence = {
      scopeSha256: "scope-later-invocation",
      evidence: "observed",
      sources: [{ ...originalEvidence.sources[0]!, canonicalRef: "git:later-head:docs/spec.md" }],
    };
    expect(laterInvocationEvidence.scopeSha256).toBe("scope-later-invocation");
    const stored = await recordPlanningLedger({
      root: home.stateHome,
      app: app.name,
      scopeId,
      planningIntentHash: "source-evidence-intent",
      sourceEvidence: originalEvidence,
      plan: { ...ticketPlan(), tickets: [ticket("Evidence one"), ticket("Evidence two")] },
      provenance: { episodeId: "episode-source", runId: "run-source", traceId: "trace-source" },
      now: new Date("2026-08-09T17:00:00Z"),
    });
    let tick = 0;
    const clock = () => new Date(Date.UTC(2026, 7, 9, 17, 1, tick++));
    const first = await publishPlanningLedger({
      stateHome: home.stateHome,
      app,
      gh,
      ledger: stored,
      cap: 1,
      clock,
      persistRoadmap: async () => undefined,
    });
    const second = await publishPlanningLedger({
      stateHome: home.stateHome,
      app,
      gh,
      ledger: first.ledger,
      cap: 1,
      clock,
      persistRoadmap: async () => undefined,
    });

    const issues = Object.values(github.readState().issues).sort((left, right) => left.number - right.number);
    expect(issues).toHaveLength(2);
    for (const issue of issues) {
      expect(issue.body).toContain("Scope SHA-256: scope-original");
      expect(issue.body).toContain("git:original-head:docs/spec.md");
      expect(issue.body).not.toContain("scope-later-invocation");
      expect(issue.body).not.toContain("git:later-head:docs/spec.md");
    }
    expect(second.ledger.publication_batches).toHaveLength(2);
    expect(JSON.stringify(second.ledger)).not.toContain('"content"');
  });

  it("recovers a prepared publication before consulting a now-missing required source", async () => {
    const github = await installGithubDouble({ repo: app.repo, defaultBranch: "trunk" });
    githubs.push(github);
    const home = await makeTempStateHome({ name: "planner-prepared-before-source" });
    homes.push(home);
    const gh = new GhCliOps(github.repo, github.exec);
    const goal = "Recover the prepared source-bound corpus plan";
    const scopeId = "prepared-before-source";
    const stored = await recordPlanningLedger({
      root: home.stateHome,
      app: app.name,
      scopeId,
      planningIntentHash: planningRecoveryIntentHash({
        goal,
        requestedStage: null,
        planning: {},
        creatorScope: null,
      }),
      plan: ticketPlan(),
      provenance: { episodeId: "episode-source-recovery", runId: "run-source-recovery", traceId: "trace-source" },
      now: new Date("2026-08-09T18:00:00Z"),
    });
    await preparePlanningPublication({
      root: home.stateHome,
      app: app.name,
      scopeId,
      cap: 3,
      now: new Date("2026-08-09T18:01:00Z"),
    });
    let tick = 0;
    const interrupted = requiredLedger(
      await readPlanningLedger(home.stateHome, app.name, scopeId),
      "interrupted ledger",
    );
    const decision = preparedPlanningRecoveryDecision({
      ledger: interrupted,
      currentIntentHash: interrupted.planning_intent_hash,
      resume: true,
      publish: true,
    });
    expect(decision.action).toBe("recover");
    const recovered = await publishPlanningLedger({
      stateHome: home.stateHome,
      app,
      gh,
      ledger: interrupted,
      cap: 3,
      clock: () => new Date(Date.UTC(2026, 7, 9, 18, 2, tick++)),
      persistRoadmap: async () => undefined,
    });

    expect(recovered.published).toHaveLength(2);
    expect(Object.values(github.readState().issues)).toHaveLength(2);
    expect(stored.planning_intent_hash).toBe(interrupted.planning_intent_hash);
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

  it("fails a missing required root while retaining optional absence as a visible row", async () => {
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
      now: () => new Date("2026-08-12T00:00:00Z"),
    };

    expect(() =>
      declarePlanningSourceScope({
        ...base,
        requests: [{ path: "missing.md", requirement: "required" }],
      }),
    ).toThrow(PlanningSourceResolutionError);

    // The retired pre-read failed a required root whose BYTES exceeded a prompt
    // budget. There is no prompt payload now, so size is not an admission
    // question — a large required file declares fine and the harness reads it.
    const large = declarePlanningSourceScope({
      ...base,
      requests: [{ path: "requirements.md", requirement: "required" }],
    });
    expect(large.entries).toHaveLength(1);
    expect(large.entries[0]).toMatchObject({ modality: "text", requirement: "required" });
    expect(large.requires_media_read).toBe(false);

    const optional = declarePlanningSourceScope({
      ...base,
      requests: [{ path: "missing.md", requirement: "optional" }],
    });
    expect(optional.entries).toEqual([]);
    expect(optional.roots).toMatchObject([
      { requested_path: "missing.md", requirement: "optional", availability: "missing" },
    ]);
  });
});
