// ISSUE-010 regression coverage: standalone run-role provider execution must
// never mutate the managed clone's resolved default checkout. Real temporary
// git remotes/worktrees and a stub Runtime exercise the boundary with no
// provider, network, GitHub, or installed Operon org.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CreatorEpisodeScope } from "../src/loop/episode-plan.js";
import type { AppEntry, AppsFile } from "../src/org/apps.js";
import { writeJournalPatch } from "../src/org/journal.js";
import { loadRoles } from "../src/org/roles.js";
import {
  runDispatchedTurn,
  turnWorktreeIdentity,
  type RunDispatchedTurnOptions,
} from "../src/org/turn-runner.js";
import type {
  RoleConfig,
  Runtime,
  TurnAssignment,
  TurnRequest,
  TurnResult,
} from "../src/runtime/types.js";
import { makeBareWithClone } from "./fixtures/gitRepo.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

const DEFAULT_BRANCH = "stable";
const NOW = new Date("2026-07-20T18:00:00.000Z");
const TINY_CAP_USD = 0.01;

describe("standalone turn worktree isolation", () => {
  const homes: OrgHomeFixture[] = [];
  const repos: Array<ReturnType<typeof makeBareWithClone>> = [];

  afterEach(() => {
    for (const home of homes.splice(0)) home.cleanup();
    for (const repo of repos.splice(0)) repo.cleanup();
  });

  it("preserves budget-stopped WIP off the managed default and rediscovers it without reset", async () => {
    // These characters are valid run-role invocation-id input but unsafe in a
    // Git ref/path without normalization.
    const fixture = await setup("budget cap:@{010}?*[WIP]");
    let providerCalls = 0;
    let providerWorkdir = "";
    const runtimeForAssignment = stubRuntime((request) => {
      providerCalls += 1;
      providerWorkdir = request.workdir;
      expect(request.role.maxTurnBudgetUsd).toBe(TINY_CAP_USD);
      writeFileSync(join(request.workdir, "README.md"), "# isolated budget WIP\n", "utf8");
      writeFileSync(join(request.workdir, "untracked-wip.txt"), "not committed\n", "utf8");
      return failedBudgetResult(request.role.runtime);
    });

    const options: RunDispatchedTurnOptions = {
      ...fixture.options,
      runtimeForAssignment,
    };
    const result = await runDispatchedTurn(options);

    expect(result).toMatchObject({
      status: "failed",
      errorCode: "error_max_budget_usd",
      recovery: {
        reasonCode: "error_max_budget_usd",
        dirty: true,
        statusEntries: 2,
      },
    });
    const recovery = result.recovery!;
    expect(providerCalls).toBe(1);
    expect(providerWorkdir).toBe(recovery.path);
    expect(recovery.branch).toMatch(/^op\/turn-[A-Za-z0-9_-]+-[0-9a-f]{32}$/);
    expect(basename(recovery.path)).toMatch(/^turn-[A-Za-z0-9_-]+-[0-9a-f]{32}$/);
    expect(fixture.repo.clone.git("check-ref-format", "--branch", recovery.branch))
      .toBe(recovery.branch);
    expect(result.summary).toContain(recovery.path);
    expect(result.summary).toContain(recovery.branch);
    expect(result.summary).toContain("dirty with 2 status entries");
    expect(result.summary).toContain("No automatic recovery staging, commit, or push was performed");
    expect(result.summary).toContain(recovery.recoveryCommand);

    const managed = join(fixture.state.root, "repos", fixture.app.name);
    expect(git(managed, "branch", "--show-current")).toBe(DEFAULT_BRANCH);
    expect(git(managed, "status", "--short")).toBe("");
    expect(readFileSync(join(managed, "README.md"), "utf8")).toBe("# fixture origin\n");
    expect(readFileSync(join(recovery.path, "README.md"), "utf8")).toBe("# isolated budget WIP\n");
    expect(readFileSync(join(recovery.path, "untracked-wip.txt"), "utf8")).toBe("not committed\n");
    // The orchestrator did not manufacture a commit or push a recovery ref.
    expect(git(recovery.path, "rev-parse", "HEAD")).toBe(git(managed, "rev-parse", "HEAD"));
    expect(fixture.repo.bare.git(
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
    )).toBe(DEFAULT_BRANCH);

    const journal = JSON.parse(
      readFileSync(join(fixture.state.root, "state", "turns", `${fixture.turnId}.json`), "utf8"),
    ) as Record<string, unknown>;
    expect(journal).toMatchObject({
      phase: "failed",
      worktree: recovery.path,
      worktreeBranch: recovery.branch,
      errorCode: "error_max_budget_usd",
      recovery,
      message: expect.stringContaining(recovery.recoveryCommand),
    });

    const resumed = await runDispatchedTurn(options);
    expect(resumed.status).toBe("failed");
    expect(providerCalls).toBe(1);
    expect(readFileSync(join(recovery.path, "README.md"), "utf8")).toBe("# isolated budget WIP\n");
    expect(readFileSync(join(recovery.path, "untracked-wip.txt"), "utf8")).toBe("not committed\n");
    expect(git(managed, "branch", "--show-current")).toBe(DEFAULT_BRANCH);
    expect(git(managed, "status", "--short")).toBe("");
    expect(JSON.parse(
      readFileSync(join(fixture.state.root, "state", "turns", `${fixture.turnId}.json`), "utf8"),
    )).toMatchObject({
      worktree: recovery.path,
      worktreeBranch: recovery.branch,
      errorCode: "error_max_budget_usd",
      recovery: { path: recovery.path, branch: recovery.branch, dirty: true },
    });
  });

  it("runs a normally completed standalone provider turn in the isolated checkout", async () => {
    const fixture = await setup("completed standalone:010");
    let providerWorkdir = "";
    const result = await runDispatchedTurn({
      ...fixture.options,
      runtimeForAssignment: stubRuntime((request) => {
        providerWorkdir = request.workdir;
        expect(request.role.maxTurnBudgetUsd).toBe(TINY_CAP_USD);
        writeFileSync(join(request.workdir, "completed-wip.txt"), "isolated\n", "utf8");
        return completedResult(request.role.runtime);
      }),
    });

    const identity = turnWorktreeIdentity(
      fixture.state.root,
      fixture.app.name,
      fixture.turnId,
    );
    const managed = join(fixture.state.root, "repos", fixture.app.name);
    expect(result).toMatchObject({ status: "completed" });
    expect(result.errorCode).toBeUndefined();
    expect(result.recovery).toBeUndefined();
    expect(providerWorkdir).toBe(identity.path);
    expect(providerWorkdir).not.toBe(managed);
    expect(existsSync(join(identity.path, "completed-wip.txt"))).toBe(true);
    expect(git(identity.path, "branch", "--show-current")).toBe(identity.branch);
    expect(git(managed, "branch", "--show-current")).toBe(DEFAULT_BRANCH);
    expect(git(managed, "status", "--short")).toBe("");
    expect(readFileSync(join(managed, "README.md"), "utf8")).toBe("# fixture origin\n");

    const journal = JSON.parse(
      readFileSync(join(fixture.state.root, "state", "turns", `${fixture.turnId}.json`), "utf8"),
    ) as Record<string, unknown>;
    expect(journal).toMatchObject({
      phase: "done",
      worktree: identity.path,
      worktreeBranch: identity.branch,
    });
  });

  it("keeps invocation ids with the same sanitized slug collision-resistant", () => {
    const first = turnWorktreeIdentity("/tmp/operon-state", "alpha", "budget:cap");
    const second = turnWorktreeIdentity("/tmp/operon-state", "alpha", "budget?cap");
    expect(first.branch).not.toBe(second.branch);
    expect(first.path).not.toBe(second.path);
    expect(first.branch).toMatch(/^op\/turn-budget-cap-[0-9a-f]{32}$/);
    expect(second.branch).toMatch(/^op\/turn-budget-cap-[0-9a-f]{32}$/);
  });

  async function setup(turnId: string): Promise<Fixture> {
    const repo = makeBareWithClone(DEFAULT_BRANCH);
    repos.push(repo);
    const state = makeOrgHome({ approvals: true, state: true });
    homes.push(state);
    const { roles } = await loadRoles(join(process.cwd(), "roles.yaml"));
    const role = roles.find((candidate) => candidate.name === "builder");
    if (role === undefined) throw new Error("fixture requires configured builder role");
    const app: AppEntry = {
      name: "alpha",
      repo: repo.bare.root,
      status: "live",
      budgetUsdMonth: 100,
      cadence: {},
    };
    const appsFile: AppsFile = {
      org: { name: "test", maxConcurrentTurns: 1 },
      defaults: { budgetUsdMonth: 100 },
      apps: [app],
    };
    await writeJournalPatch(state.root, turnId, {
      role: role.name,
      app: app.name,
      phase: "assembling",
      attempt: 0,
      triggerKind: "manual",
      trigger: "manual",
    }, NOW);
    return {
      repo,
      state,
      app,
      turnId,
      options: {
        role,
        app,
        appsFile,
        turnId,
        runtimeHome: state.root,
        orgRoot: process.cwd(),
        creatorScope: standaloneScope(role, turnId),
        now: () => NOW,
      },
    };
  }
});

interface Fixture {
  repo: ReturnType<typeof makeBareWithClone>;
  state: OrgHomeFixture;
  app: AppEntry;
  turnId: string;
  options: RunDispatchedTurnOptions;
}

function standaloneScope(role: RoleConfig, turnId: string): CreatorEpisodeScope {
  const outputKind = role.outputs[0] ?? "file";
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "human",
      creatorId: "issue-010-test",
      createdAt: NOW.toISOString(),
      evidenceRefs: [`turn:${turnId}`, "template:sha256:issue-010-fixture"],
    },
    workKind: "standalone-role-turn",
    objective: "Perform one bounded standalone role turn in an isolated checkout",
    inScope: ["README.md", "one fixture output"],
    outOfScope: ["GitHub", "the managed clone default checkout"],
    acceptanceCriteria: ["the provider receives the isolated worktree as req.workdir"],
    expectedArtifacts: [{ id: "role-result", kind: outputKind, required: true }],
    declaredConstraints: {
      networkAccess: false,
      standaloneRunRole: { templateSha256: "issue-010-fixture" },
    },
    safetyFacts: [],
    steps: [{
      kind: "provider_turn",
      id: "run-role",
      operation: "manual/run-role",
      role: role.name,
      objective: "Execute the tiny-cap fixture role turn",
      dependsOn: [],
      requiredCapabilities: ["tool_gate"],
      inputRefs: [{ ref: `turn:${turnId}`, required: true }],
      expectedOutputs: [{ id: "role-result", kind: outputKind, required: true }],
      maxTurnBudgetUsd: TINY_CAP_USD,
      selectionReason: "The creator supplied one exact fixed-assignment standalone step",
    }],
  };
}

function stubRuntime(
  run: (request: TurnRequest) => TurnResult | Promise<TurnResult>,
): (assignment: TurnAssignment, role: RoleConfig) => Runtime {
  return (assignment) => ({
    kind: assignment.harness,
    runTurn: async (request) => run(request),
  });
}

function failedBudgetResult(runtime: TurnAssignment["harness"]): TurnResult {
  return {
    status: "failed",
    errorCode: "error_max_budget_usd",
    summary: "Budget overrun: stub observed $0.0200 above maxTurnBudgetUsd $0.0100",
    artifacts: [],
    session: { runtime, id: "budget-stop-session" },
    usage: {
      tokensIn: 10,
      tokensOut: 2,
      costUsd: 0.02,
      subagentTurns: 0,
      wallClockMs: 10,
      quality: "complete",
    },
    escalations: [],
  };
}

function completedResult(runtime: TurnAssignment["harness"]): TurnResult {
  return {
    status: "completed",
    summary: "bounded standalone turn completed",
    artifacts: [{ kind: "file", ref: "completed-wip.txt", summary: "fixture output" }],
    session: { runtime, id: "completed-session" },
    usage: {
      tokensIn: 5,
      tokensOut: 1,
      costUsd: 0.005,
      subagentTurns: 0,
      wallClockMs: 5,
      quality: "complete",
    },
    escalations: [],
  };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
