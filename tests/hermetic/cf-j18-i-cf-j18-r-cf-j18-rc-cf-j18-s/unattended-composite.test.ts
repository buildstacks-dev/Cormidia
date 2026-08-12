// Traceability: CF-J18-S · HB-144; CF-J18-R · HB-144; CF-J18-I · HB-144; CF-J18-RC · HB-144 · contracts/journey-acceptance.md J-18; system-map.md J-18; invariants.md CORMIDIA-INV-005/006/008/009/014; contracts/B-08-tick-turn.md.

import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { devNull } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { baseRevisionForBranch, resolveRemoteDefaultBranch } from "../../../src/loop/default-branch.js";
import { DEFAULT_LOOP_POLICY, runLoopOnce } from "../../../src/loop/driver.js";
import { readCurrentEpisodePlan, type CreatorEpisodeScope } from "../../../src/loop/episode-plan.js";
import { GhCliOps } from "../../../src/loop/github.js";
import type { LoopItem } from "../../../src/loop/loop.js";
import { prepareEpisodePlan } from "../../../src/org/episode-planner/coordinator.js";
import { buildEpisodeIntent } from "../../../src/org/episode-planner/policy.js";
import type { AppEntry } from "../../../src/org/apps.js";
import { dispatchTick, type DispatchSpawn } from "../../../src/org/dispatch.js";
import type { GitHubEventSource } from "../../../src/org/events.js";
import { readJournal, writeJournalPatch } from "../../../src/org/journal.js";
import { readLock, releaseLock } from "../../../src/org/locks.js";
import { ScheduleDueClaimStore } from "../../../src/org/scheduler/due-window-claims.js";
import { SchedulerEvidenceStore, type SchedulerDecisionRecord } from "../../../src/org/scheduler/evidence.js";
import { schedulerIdentity } from "../../../src/org/scheduler/model.js";
import { formatStatusRows, readStatusRows, type StatusRow } from "../../../src/runtime/runlog/status.js";
import { finalizeRun, startRun, updateEnvelope } from "../../../src/runtime/runlog/envelope.js";
import {
  readTurnRecords,
  recordTurnOnce,
  settlementIdentity,
  settlementKey,
  toRecord,
} from "../../../src/runtime/telemetry.js";
import type { RoleConfig, TurnResult } from "../../../src/runtime/types.js";
import { claudeDouble, doubleTurnRequest } from "../../fixtures/adapters/claude-double.js";
import { codexDouble } from "../../fixtures/adapters/codex-double.js";
import { script } from "../../fixtures/adapters/scenario.js";
import { makeTestClock } from "../../fixtures/clock.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const ORG = "hb144-org";
const APPS = ["morning-alpha", "morning-beta"] as const;
const TRIGGER = "hourly";
const DEFAULT_BRANCH = "trunk";
const T0 = new Date("2026-08-11T08:00:00.000Z");

const LABELS = [
  { name: "op:ready", color: "1d76db", description: "ready" },
  { name: "op:building", color: "fbca04", description: "building" },
  { name: "op:in-review", color: "0e8a16", description: "review" },
  { name: "op:returned", color: "b60205", description: "returned" },
];

const NO_EVENTS: GitHubEventSource = {
  ticketReady: async () => [],
  prOpened: async () => [],
  ciFailed: async () => [],
  releaseShipped: async () => [],
};

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: devNull,
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function role(name: "planner" | "builder" | "reviewer", runtime: RoleConfig["runtime"]): RoleConfig {
  return {
    name,
    runtime,
    model: runtime === "codex" ? "gpt-5.6-sol" : `${name}-scripted`,
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: name === "reviewer" ? ["review-verdict"] : name === "builder" ? ["artifact"] : ["plan"],
    maxTurnBudgetUsd: 5,
  };
}

const PLAN_ROLES = [role("planner", "claude"), role("builder", "codex"), role("reviewer", "claude")];

function creatorScope(): CreatorEpisodeScope {
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "human",
      creatorId: "product-owner",
      createdAt: T0.toISOString(),
      evidenceRefs: ["HB-144", "journey-acceptance:J-18"],
    },
    workKind: "roadmap-delivery-unit",
    objective: "Deliver one unattended sandbox ticket through independent review.",
    inScope: ["one sandbox ticket", "one reviewed merge", "two bounded provider turns"],
    outOfScope: ["publication", "production", "non-sandbox effects"],
    acceptanceCriteria: ["the exact candidate is independently reviewed before merge"],
    expectedArtifacts: [{ id: "review-verdict", kind: "review", required: true }],
    declaredConstraints: { unattended: true, onePullRequest: true },
    safetyFacts: [{ kind: "independent_review", evidenceRefs: ["journey-acceptance:J-18"] }],
    steps: [
      {
        id: "build",
        kind: "provider_turn",
        operation: "delivery/build",
        role: "builder",
        objective: "Build the bounded delivery artifact.",
        requiredCapabilities: [],
        dependsOn: [],
        inputRefs: [],
        expectedOutputs: [{ id: "artifact", kind: "file", required: true }],
        maxTurnBudgetUsd: 5,
        selectionReason: "Builder owns candidate mutation.",
      },
      {
        id: "review",
        kind: "provider_turn",
        operation: "delivery/review",
        role: "reviewer",
        objective: "Independently review the exact candidate HEAD.",
        requiredCapabilities: [],
        dependsOn: ["build"],
        inputRefs: [{ ref: "plan-output:artifact", required: true }],
        expectedOutputs: [{ id: "review-verdict", kind: "review", required: true }],
        maxTurnBudgetUsd: 5,
        selectionReason: "Reviewer is provider-independent from Builder.",
      },
    ],
  };
}

interface CompositeWorld {
  org: TempOrgHome;
  repo: TempGitRepo;
  remoteDir: string;
  github: GithubDoubleHandle;
  gh: GhCliOps;
  worktreeRoot: string;
  cleanup(): Promise<void>;
}

async function makeWorld(): Promise<CompositeWorld> {
  const org = await makeTempOrgHome({ name: ORG });
  const repo = await makeTempGitRepo({ defaultBranch: DEFAULT_BRANCH });
  const remote = await repo.addFileRemote();
  const github = await installGithubDouble({ defaultBranch: DEFAULT_BRANCH, labels: LABELS });
  const gh = new GhCliOps(github.repo, github.exec);
  const worktreeRoot = join(org.root, "delivery-worktrees");
  await writeFile(
    join(org.orgHome, "apps.yaml"),
    [
      "schema_version: 1",
      "org:",
      `  name: ${ORG}`,
      "  max_concurrent_turns: 1",
      "defaults:",
      "  budget_usd_month: 1000",
      "apps:",
      ...APPS.flatMap((app) => [
        `  ${app}:`,
        `    repo: ${github.repo}`,
        "    status: live",
        "    cadence: {}",
        "    release:",
        "      kind: deploy",
        "      owner: sre",
        "      trigger: command",
        "      command: ./deploy.sh",
      ]),
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(org.orgHome, "roles.yaml"),
    [
      "defaults:",
      "  max_turn_budget_usd: 5",
      "roles:",
      "  sre:",
      "    runtime: claude",
      "    model: sre-scripted",
      "    effort: medium",
      "    delegation: {allow: []}",
      `    triggers: [{schedule: ${JSON.stringify(TRIGGER)}}]`,
      "    outputs: [notes]",
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    org,
    repo,
    remoteDir: remote.dir,
    github,
    gh,
    worktreeRoot,
    async cleanup() {
      await github.dispose();
      await repo.cleanup();
      await org.cleanup();
    },
  };
}

function deliveryApp(name: string, repo: string): AppEntry {
  return {
    name,
    repo,
    status: "live",
    budgetUsdMonth: 1000,
    objectiveBudgetUsd: 1000,
    cadence: {},
    execution: { assignmentMode: "fixed", allowedAssignments: {} },
  };
}

async function persistPlan(stateHome: string, app: AppEntry, episodeId: string): Promise<void> {
  const scope = creatorScope();
  const intent = buildEpisodeIntent({
    episodeId,
    app,
    roles: PLAN_ROLES,
    trigger: { kind: "schedule", sourceRef: TRIGGER },
    goal: scope.objective,
    lifecycle: "live",
    appStage: "growth",
    repositoryFacts: { defaultBranch: DEFAULT_BRANCH, repo: app.repo },
    requestedConstraints: { unattended: true },
    hardBudget: {
      maxProviderTurns: 2,
      maxEquivalentCostUsd: 10,
      maxActiveTimeMs: 30 * 60_000,
      maxHumanDecisions: 0,
    },
    requiredSafetyFacts: [],
    creatorScope: scope,
  });
  const prepared = await prepareEpisodePlan({
    root: stateHome,
    app,
    roles: PLAN_ROLES,
    intent,
    providerOperations: ["delivery/build", "delivery/review"],
    independentReview: { subjectRoles: ["builder"], reviewerRoles: ["reviewer"] },
    now: () => new Date(T0),
  });
  expect(prepared.planningTurnSkipped).toBe(true);
  expect(prepared.plan.steps.map((step) => step.id)).toEqual(["build", "review"]);
}

async function persistProviderEvidence(input: {
  stateHome: string;
  app: string;
  episodeId: string;
  step: "build" | "review";
  role: RoleConfig;
  result: TurnResult;
  providerTurnId: string;
  gitHead: string;
  gitBranch: string;
}): Promise<void> {
  const runId = `${input.episodeId}-${input.step}`;
  const startedAt = new Date(T0.getTime() + (input.step === "build" ? 60_000 : 120_000));
  const finishedAt = new Date(startedAt.getTime() + Math.max(1, input.result.usage.wallClockMs));
  await startRun(
    input.stateHome,
    {
      runId,
      traceId: input.episodeId,
      episodeId: input.episodeId,
      planVersion: 1,
      planStepId: input.step,
      app: input.app,
      pipeline: "unattended-delivery",
      pass: input.step,
      role: input.role.name,
      runtime: input.role.runtime,
      model: input.role.model,
      effort: input.role.effort,
      workdir: "sandbox-worktree",
      gitHead: input.gitHead,
      gitBranch: input.gitBranch,
    },
    startedAt,
  );
  await updateEnvelope(input.stateHome, input.app, runId, {
    providerTurnIds: [input.providerTurnId],
    executionStepIds: [`${input.episodeId}:${input.step}`],
    artifacts:
      input.step === "build"
        ? [{ kind: "file", ref: "delivery.md", summary: "bounded delivery artifact" }]
        : [{ kind: "review", ref: `github-review:${input.gitHead}`, summary: "independent exact-head approval" }],
  });
  await finalizeRun(
    input.stateHome,
    input.app,
    runId,
    {
      status: "completed",
      usage: {
        tokens_in: input.result.usage.tokensIn,
        tokens_out: input.result.usage.tokensOut,
        cost_usd: input.result.usage.costUsd,
        subagent_turns: input.result.usage.subagentTurns,
        quality: input.result.usage.quality ?? "complete",
      },
      verdictSummary: input.result.summary,
    },
    finishedAt,
  );
  expect(
    await recordTurnOnce(
      input.stateHome,
      toRecord(input.role, input.result, finishedAt, {
        app: input.app,
        trigger: "schedule",
        runId,
        providerTurnId: input.providerTurnId,
        executionStepId: `${input.episodeId}:${input.step}`,
        episodeId: input.episodeId,
        traceId: input.episodeId,
        planVersion: 1,
        planStepId: input.step,
        assignmentSource: "creator",
        effort: input.role.effort,
      }),
    ),
  ).toBe(true);
}

function assertUniqueSettlements(rows: Awaited<ReturnType<typeof readTurnRecords>>): void {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const identity = settlementIdentity(row);
    if (identity === undefined) throw new Error("lost-work: provider settlement has no durable identity");
    const key = settlementKey(row.app, identity);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicate = [...counts.entries()].find(([, count]) => count !== 1);
  if (duplicate !== undefined) throw new Error(`duplicate-work: ${duplicate[0]} settled ${duplicate[1]} times`);
}

function assertAdmissionAccounting(decisions: readonly SchedulerDecisionRecord[]): void {
  const due = decisions.filter((decision) => decision.trigger === TRIGGER);
  if (due.length !== APPS.length) {
    throw new Error(`lost-work: expected ${APPS.length} considered due candidates, found ${due.length}`);
  }
  for (const decision of due) {
    const admitted = decision.outcome === "executed";
    const namedNonAdmission =
      decision.outcome === "blocked" || decision.outcome === "skipped" || decision.outcome === "failed";
    if (!admitted && (!namedNonAdmission || decision.reason_code === null)) {
      throw new Error(`lost-work: ${decision.app}/${decision.role} has no admitted-or-named-non-admission outcome`);
    }
  }
}

function assertTerminalReceipt(decision: SchedulerDecisionRecord): void {
  if (
    decision.stage !== "terminal" ||
    decision.outcome !== "executed" ||
    decision.provider_turns !== 2 ||
    decision.provider_settlements !== 2
  ) {
    throw new Error(
      `lost-work: terminal receipt missing or incomplete (${decision.stage}/${decision.outcome}/` +
        `${decision.provider_turns}/${decision.provider_settlements})`,
    );
  }
}

function assertArtifactOrder(operations: readonly string[]): void {
  const before = (left: string, right: string): void => {
    const l = operations.indexOf(left);
    const r = operations.indexOf(right);
    if (l < 0 || r < 0 || l >= r) throw new Error(`reached-link order: ${left} must precede ${right}`);
  };
  before("pr.create", "pr.review");
  before("pr.review", "pr.merge");
  before("pr.merge", "ref.delete");
}

interface MorningCase {
  id: string;
  status: "failed" | "blocked" | "timed_out";
  errorCode?: string;
  reason: string;
  gateFailed?: boolean;
}

const MORNING_CASES: MorningCase[] = [
  { id: "provider-death", status: "failed", errorCode: "error_provider", reason: "provider process died" },
  { id: "timeout", status: "timed_out", reason: "provider turn exceeded its bounded deadline" },
  {
    id: "red-gates",
    status: "failed",
    errorCode: "error_quality_gate",
    reason: "required quality gate remained red",
    gateFailed: true,
  },
  { id: "returned-review", status: "blocked", reason: "review returned the candidate for repair" },
  {
    id: "source-config-drift",
    status: "failed",
    errorCode: "error_source_config_drift",
    reason: "source or configuration drift invalidated the accepted plan",
  },
  {
    id: "malformed-verdict",
    status: "failed",
    errorCode: "error_malformed_verdict",
    reason: "reviewer verdict was malformed",
  },
  { id: "external-ambiguity", status: "blocked", reason: "external effect outcome is ambiguous" },
];

function assertMorningTruth(rows: readonly StatusRow[]): void {
  for (const expected of MORNING_CASES) {
    const row = rows.find((candidate) => candidate.runId === `morning-${expected.id}`);
    if (row === undefined) throw new Error(`lost-work: morning state ${expected.id} vanished`);
    if (row.status === "completed" || row.status === "running") {
      throw new Error(`morning-state-lie: ${expected.id} rendered ${row.status}`);
    }
    if (row.terminalReason !== expected.reason) {
      throw new Error(`morning-state-lie: ${expected.id} lost its typed terminal reason`);
    }
  }
}

describe("HB-144 unattended composite hermetic prerequisite", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it("CF-J18-S/R/RC: fake-timer ticks preserve every reached link, account every candidate, and recover without lost or duplicate work", async () => {
    const world = await makeWorld();
    cleanups.push(() => world.cleanup());
    const clock = makeTestClock(T0.toISOString());
    const spawned: Array<{ role: string; app: string; turnId: string; runtimeHome: string }> = [];
    const spawn: DispatchSpawn = async (input) => {
      spawned.push(input);
    };

    const tick1 = await dispatchTick({
      orgRoot: world.org.orgHome,
      runtimeHome: world.org.stateHome,
      now: clock.dateFn,
      eventSource: NO_EVENTS,
      spawn,
    });
    expect(tick1.errors).toEqual([]);
    expect(tick1.spawned).toHaveLength(1);
    expect(spawned).toHaveLength(1);
    const dueTurn = tick1.spawned[0]!;
    const app = deliveryApp(dueTurn.app, world.github.repo);

    const evidence = new SchedulerEvidenceStore({
      stateHome: world.org.stateHome,
      orgName: ORG,
      orgHome: world.org.orgHome,
      schedulerId: schedulerIdentity(ORG, world.org.orgHome),
    });
    const initialDecisions = (await evidence.listDecisions()).filter((decision) => decision.trigger === TRIGGER);
    expect(initialDecisions).toHaveLength(APPS.length);
    expect(initialDecisions.filter((decision) => decision.stage === "spawned")).toHaveLength(1);
    expect(initialDecisions).toContainEqual(
      expect.objectContaining({ stage: "terminal", outcome: "blocked", reason_code: "wip_limit" }),
    );

    await persistPlan(world.org.stateHome, app, dueTurn.turnId);
    expect((await readCurrentEpisodePlan(world.org.stateHome, dueTurn.turnId))?.steps.map((step) => step.id)).toEqual([
      "build",
      "review",
    ]);

    const issue = await world.gh.createIssue({
      title: "Unattended delivery",
      body: [
        "## Goal",
        "Deliver one bounded unattended artifact.",
        "",
        "## Acceptance criteria",
        "- [ ] delivery.md records the result",
        "",
      ].join("\n"),
      labels: ["op:ready"],
    });
    const base = baseRevisionForBranch(resolveRemoteDefaultBranch("origin", { cwd: world.repo.dir }));
    const builder = PLAN_ROLES.find((candidate) => candidate.name === "builder")!;
    const reviewer = PLAN_ROLES.find((candidate) => candidate.name === "reviewer")!;
    const builderDouble = codexDouble([
      script.turn({
        sessionId: "hb144-builder",
        steps: [
          script.tool(
            "Bash",
            { command: "pwd" },
            { channel: "permission", terminal: { success: true, durationMs: 4 } },
          ),
        ],
        outcome: script.success("# Unattended delivery\n", {
          usage: { inputTokens: 300, outputTokens: 80 },
          costUsd: 0.2,
        }),
      }),
    ]);
    const reviewerDouble = claudeDouble([
      script.turn({
        sessionId: "hb144-reviewer",
        outcome: script.success("APPROVE: exact-head evidence is complete", {
          usage: { inputTokens: 220, outputTokens: 55 },
          costUsd: 0.15,
        }),
      }),
    ]);
    const gateActions: unknown[] = [];
    let buildResult: TurnResult | undefined;
    let reviewResult: TurnResult | undefined;
    let candidateHead = "";

    const delivery = await runLoopOnce({
      app: app.name,
      repo: world.github.repo,
      gh: world.gh,
      localRepo: world.repo.dir,
      worktreeRoot: world.worktreeRoot,
      policy: DEFAULT_LOOP_POLICY,
      commands: { testCommand: "true" },
      base,
      maxConcurrent: 1,
      afterClaim: async (item): Promise<LoopItem> => {
        buildResult = await builderDouble.runtime.runTurn(
          doubleTurnRequest({ workdir: item.worktree!, role: builder, task: "build accepted HB-144 artifact" }),
          {
            gate: (action) => {
              gateActions.push(action);
              return { allow: true };
            },
          },
        );
        expect(buildResult.status).toBe("completed");
        await writeFile(join(item.worktree!, "delivery.md"), buildResult.summary, "utf8");
        git(item.worktree!, "add", "--", "delivery.md");
        git(item.worktree!, "commit", "--no-gpg-sign", "-m", "test: unattended delivery");
        candidateHead = git(item.worktree!, "rev-parse", "HEAD");
        world.github.setBranchHead(item.branch!, candidateHead);
        return {
          ...item,
          contract: JSON.stringify({
            files: ["delivery.md"],
            approach: "write the bounded artifact",
            tests: [{ criterionId: "AC1", tests: ["unattended-composite.test.ts"] }],
            risks: "lost or duplicate unattended work",
            complexity: "low",
          }),
          criterionTests: { AC1: ["unattended-composite.test.ts"] },
        };
      },
      injectReview: async (item) => {
        reviewResult = await reviewerDouble.runtime.runTurn(
          doubleTurnRequest({ workdir: item.worktree!, role: reviewer, task: "review exact candidate" }),
          { gate: () => ({ allow: true }) },
        );
        expect(reviewResult.status).toBe("completed");
        expect(reviewResult.summary).toMatch(/^APPROVE:/);
        await world.gh.createReview(item.prNumber!, {
          state: "approve",
          body: reviewResult.summary,
          expectedCommit: candidateHead,
        });
      },
    });

    const merged = delivery.items[0]!;
    expect(merged.phase).toBe("merged");
    const pr = await world.gh.readPR(merged.prNumber!);
    expect(pr).toMatchObject({
      state: "MERGED",
      baseRefName: DEFAULT_BRANCH,
      headRefName: merged.branch,
      headRefOid: candidateHead,
    });
    expect(await world.gh.readIssue(issue.number)).toMatchObject({ state: "CLOSED", labels: [] });
    expect(gateActions).toHaveLength(1);
    expect(builderDouble.recorder.turns[0]?.toolPlays[0]?.executed).toBe(true);
    assertArtifactOrder(world.github.callLog().map((entry) => entry.op));

    await persistProviderEvidence({
      stateHome: world.org.stateHome,
      app: app.name,
      episodeId: dueTurn.turnId,
      step: "build",
      role: builder,
      result: buildResult!,
      providerTurnId: `${dueTurn.turnId}:provider:build`,
      gitHead: candidateHead,
      gitBranch: merged.branch!,
    });
    await persistProviderEvidence({
      stateHome: world.org.stateHome,
      app: app.name,
      episodeId: dueTurn.turnId,
      step: "review",
      role: reviewer,
      result: reviewResult!,
      providerTurnId: `${dueTurn.turnId}:provider:review`,
      gitHead: candidateHead,
      gitBranch: merged.branch!,
    });
    const rows = await readTurnRecords(world.org.stateHome);
    expect(rows).toHaveLength(2);

    await writeJournalPatch(world.org.stateHome, dueTurn.turnId, {
      role: "sre",
      app: app.name,
      phase: "running",
    });
    await writeJournalPatch(world.org.stateHome, dueTurn.turnId, {
      role: "sre",
      app: app.name,
      phase: "collecting",
    });
    await writeJournalPatch(world.org.stateHome, dueTurn.turnId, {
      role: "sre",
      app: app.name,
      phase: "done",
      message: `merged ${candidateHead}`,
    });
    const held = await readLock(world.org.stateHome, app.name, "sre");
    await releaseLock(world.org.stateHome, app.name, "sre", held);

    const beforeRecovery = (await evidence.listDecisions()).find(
      (decision) => decision.decision_id === dueTurn.decisionId,
    )!;
    expect(() => assertTerminalReceipt(beforeRecovery)).toThrow(/lost-work/);

    clock.advance(5 * 60_000);
    const tick2 = await dispatchTick({
      orgRoot: world.org.orgHome,
      runtimeHome: world.org.stateHome,
      now: clock.dateFn,
      eventSource: NO_EVENTS,
      spawn,
    });
    expect(tick2.errors).toEqual([]);
    expect(tick2.spawned).toHaveLength(1);
    expect(tick2.spawned[0]?.app).not.toBe(app.name);
    expect(spawned.filter((entry) => entry.turnId === dueTurn.turnId)).toHaveLength(1);

    const recovered = (await evidence.listDecisions()).find((decision) => decision.decision_id === dueTurn.decisionId)!;
    assertTerminalReceipt(recovered);
    assertAdmissionAccounting([
      recovered,
      ...initialDecisions.filter((decision) => decision.reason_code === "wip_limit"),
    ]);
    const claims = await new ScheduleDueClaimStore(world.org.stateHome).list();
    expect(claims).toContainEqual(
      expect.objectContaining({ settlement_id: dueTurn.scheduleClaimId, status: "settled", run_id: dueTurn.turnId }),
    );

    expect(() => assertUniqueSettlements([...rows, rows[0]!] as typeof rows)).toThrow(/duplicate-work/);
    assertUniqueSettlements(rows);
    const morning = await readStatusRows(world.org.stateHome, { app: app.name });
    expect(morning).toHaveLength(2);
    expect(morning.every((row) => row.status === "completed" && row.traceId === dueTurn.turnId)).toBe(true);
    expect((await readJournal(world.org.stateHome, dueTurn.turnId)).phase).toBe("done");
    expect(git(world.remoteDir, "rev-parse", `refs/heads/${merged.branch}`)).toBeDefined();
  });

  it("CF-J18-I: every ratified non-green termination remains typed on the morning status surface", async () => {
    const state: TempStateHome = await makeTempStateHome({ name: "hb144-morning" });
    cleanups.push(() => state.cleanup());
    for (const [index, outcome] of MORNING_CASES.entries()) {
      const runId = `morning-${outcome.id}`;
      const startedAt = new Date(T0.getTime() + index * 60_000);
      await startRun(
        state.stateHome,
        {
          runId,
          traceId: "hb144-non-green-matrix",
          episodeId: `episode-${outcome.id}`,
          planVersion: 1,
          planStepId: outcome.id,
          app: "morning-app",
          pipeline: "unattended-delivery",
          pass: outcome.id,
          role: outcome.id === "returned-review" ? "reviewer" : "builder",
          runtime: outcome.id === "returned-review" ? "claude" : "codex",
          model: "scripted",
          effort: "high",
        },
        startedAt,
      );
      if (outcome.gateFailed === true) {
        await updateEnvelope(state.stateHome, "morning-app", runId, {
          gate_results: [{ gate: "pnpm test", status: "failed", detail: "seeded red gate" }],
        });
      }
      await finalizeRun(
        state.stateHome,
        "morning-app",
        runId,
        {
          status: outcome.status,
          ...(outcome.errorCode === undefined ? {} : { errorCode: outcome.errorCode }),
          reason: outcome.reason,
        },
        new Date(startedAt.getTime() + 1_000),
      );
    }

    const rows = await readStatusRows(state.stateHome, { app: "morning-app" });
    expect(rows).toHaveLength(MORNING_CASES.length);
    const seededLie = rows.map((row, index) => (index === 0 ? { ...row, status: "completed" } : row));
    expect(() => assertMorningTruth(seededLie)).toThrow(/morning-state-lie/);
    assertMorningTruth(rows);

    const rendered = formatStatusRows(rows);
    expect(rendered).toContain("TERMINAL ATTENTION");
    for (const outcome of MORNING_CASES) {
      const row = rows.find((candidate) => candidate.runId === `morning-${outcome.id}`)!;
      expect(row.status).toBe(outcome.status === "failed" ? `failed(${outcome.errorCode})` : outcome.status);
      expect(rendered).toContain(outcome.reason);
    }
  });
});
