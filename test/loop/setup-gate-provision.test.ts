// Regression for L1-02 / L-003 (review/fix-backlog.md, review/live-campaign-crossref-2026-07-17.md):
// the setup/install gate must run at worktree PROVISION, before the builder's
// first implement pass — not only in the post-implement gates runner. On a
// fresh worktree with no vendored node_modules, the builder's mandatory
// "baseline before changes" check would otherwise fail every greenfield ticket
// for lack of dependencies (the live operator's workaround was committing 26MB
// of node_modules).
//
// These are behavioral checks against the real pass machinery (runLoopOnce +
// the driver state machine) with a fake runtime, temp git/org trees, and
// FakeGhOps — no network, no auth, no real GitHub/org state, no live clock.
//
// The app fixture's setup_command materialises a visible marker file
// (simulating "dependencies installed"). The implement pass records whether the
// marker was present when it ran. Before the fix the marker does not exist yet
// (setup runs after implement) and these assertions fail; after the fix it does.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { baseRevisionForBranch } from "../../src/loop/default-branch.js";
import { runLoopOnce } from "../../src/loop/driver.js";
import type { CreatorEpisodeScope } from "../../src/loop/episode-plan.js";
import { loadPipelines, type PipelinesFile } from "../../src/loop/pipelines.js";
import type { Policy } from "../../src/loop/policy.js";
import { createTicketEpisodeRuntime } from "../../src/org/ticket-episode-runtime.js";
import { readEvents } from "../../src/runtime/runlog/events.js";
import type { RoleConfig, Runtime, TurnHooks, TurnRequest, TurnResult } from "../../src/runtime/types.js";
import { makeBareWithClone } from "../fixtures/gitRepo.js";
import { makeOrgHome } from "../fixtures/orgHome.js";
import { FakeGhOps } from "../support/fakeGhOps.js";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PROMPTS_DIR = join(REPO_ROOT, "prompts");

// The marker path deliberately avoids the words "install"/"ci" so the env
// preflight's offline-install trap (preflight.ts) does not fire — this test is
// about gate ordering, not the preflight probe.
const MARKER_REL = join("node_modules", ".operon-setup-done");
const SETUP_OK = `mkdir -p node_modules && printf ok > ${MARKER_REL}`;
const SETUP_FAIL = "exit 1";

const ISSUE_BODY = [
  "## Goal",
  "Ship a small greenfield change.",
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
  "Add the requested change.",
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

const DONE = "Verdict: done";
const APPROVE = "Verdict: approve";

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

function policy(): Policy {
  return {
    riskTiers: { high: ["auth/**"], medium: ["src/**"], low: ["*.md"] },
    gates: {
      high: ["tests", "lint", "security", "completeness"],
      medium: ["tests", "lint", "completeness"],
      low: ["tests", "completeness"],
    },
    dimensionGlobs: { security: ["auth/**"], perf: ["perf/**"] },
    remediation: { maxAttempts: 3 },
  };
}

function turnResultOf(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime: "claude", id: `session-${summary.slice(0, 16)}` },
    usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.01, subagentTurns: 0, wallClockMs: 100 },
    escalations: [],
  };
}

function allowAllHooks(): TurnHooks {
  return { gate: () => ({ allow: true }) };
}

/** Supply explicit creator-authored workflow authority while keeping the real
 * production ticket DAG executor on the path whose setup ordering is tested. */
function ticketEpisodeFixture(
  stateHome: string,
  gh: FakeGhOps,
  runtime: Runtime,
  commands: { setupCommand: string; testCommand: string; lintCommand: string },
): {
  roles: Record<string, RoleConfig>;
  planTicket: ReturnType<typeof createTicketEpisodeRuntime>["planTicket"];
  executeTicketPlan: ReturnType<typeof createTicketEpisodeRuntime>["executeTicketPlan"];
} {
  const roles: Record<string, RoleConfig> = {
    ...ROLES,
    builder: {
      ...ROLES.builder!,
      runtime: "codex",
      model: "builder-model",
    },
    reviewer: {
      ...ROLES.reviewer!,
      runtime: "claude",
      model: "reviewer-model",
    },
  };
  const callbacks = createTicketEpisodeRuntime({
    root: stateHome,
    orgRoot: REPO_ROOT,
    app: {
      name: "fixture",
      repo: "fixture/repo",
      status: "live",
      budgetUsdMonth: 100,
      cadence: {},
      execution: { assignmentMode: "fixed", allowedAssignments: {} },
    },
    roles: Object.values(roles),
    gh,
    policy: policy(),
    commands,
    hooks: allowAllHooks(),
    runtimeForAssignment: (assignment) => ({
      kind: assignment.harness,
      runTurn: runtime.runTurn.bind(runtime),
    }),
    plannerContext: { taste: ["setup-gate fixture"], memoryExcerpts: [] },
    remainingBudgetUsd: 100,
    creatorScopeForTicket: () => completeTicketCreatorScope(),
    now: () => new Date("2026-07-19T22:00:00.000Z"),
  });
  return { roles, ...callbacks };
}

function completeTicketCreatorScope(): CreatorEpisodeScope {
  const output = (id: string, kind: string) => ({ id, kind, required: true });
  const gate = (
    id: string,
    gateKind: string,
    dependsOn: string[],
    outputId: string,
  ): Extract<NonNullable<CreatorEpisodeScope["steps"]>[number], { kind: "mechanical_gate" }> => ({
    kind: "mechanical_gate",
    id,
    gate: gateKind,
    objective: `Execute ${gateKind}`,
    dependsOn,
    inputRefs: [],
    expectedOutputs: [output(outputId, "mechanical-evidence")],
  });
  const provider = (
    id: string,
    operation: string,
    roleName: string,
    dependsOn: string[],
    outputId: string,
  ): Extract<NonNullable<CreatorEpisodeScope["steps"]>[number], { kind: "provider_turn" }> => ({
    kind: "provider_turn",
    id,
    operation,
    role: roleName,
    objective: `Execute ${operation}`,
    dependsOn,
    requiredCapabilities: ["tool_gate"],
    inputRefs: [],
    expectedOutputs: [output(outputId, "ticket-evidence")],
    maxTurnBudgetUsd: 5,
    selectionReason: `${operation} is explicitly required by the complete ticket scope`,
  });
  const steps: NonNullable<CreatorEpisodeScope["steps"]> = [
    gate("provision", "ticket/provision", [], "provisioned"),
    provider("contract", "build/contract", "builder", ["provision"], "contract"),
    provider("implement", "build/implement", "builder", ["provision", "contract"], "patch"),
    gate("gates", "ticket/gates-and-pr", ["implement"], "pull-request"),
    provider("verify", "review/verify", "reviewer", ["gates"], "functional-review"),
    provider("security", "review/security-deep", "reviewer", ["gates"], "security-review"),
    gate("authorize", "ticket/review-authorization", ["verify", "security"], "authorization"),
    provider("ship-check", "ship/ship-check", "reviewer", ["authorize"], "ship-verdict"),
    gate("ship", "ticket/ship", ["ship-check"], "merge"),
  ];
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "agent",
      creatorId: "setup-gate-parent",
      createdAt: "2026-07-19T21:59:00.000Z",
      evidenceRefs: ["test:setup-gate:ticket-plan"],
    },
    objective: "Provision, implement, independently review, and merge the bounded ticket",
    inScope: ["the selected ticket and its declared file scope"],
    outOfScope: ["unrelated repository work"],
    acceptanceCriteria: ["setup succeeds before implementation and all delivery gates pass"],
    expectedArtifacts: [output("merge", "mechanical-evidence")],
    declaredConstraints: { networkAccess: false },
    safetyFacts: [{
      kind: "independent_review",
      evidenceRefs: ["test:setup-gate:review"],
    }],
    steps,
  };
}

function commit(worktree: string, message: string, files: Record<string, string>): void {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Operon Fixture",
    GIT_AUTHOR_EMAIL: "fixture@operon.invalid",
    GIT_COMMITTER_NAME: "Operon Fixture",
    GIT_COMMITTER_EMAIL: "fixture@operon.invalid",
  };
  for (const [rel, content] of Object.entries(files)) {
    execFileSync("mkdir", ["-p", join(worktree, rel, "..")]);
    execFileSync("sh", ["-c", `printf '%s' ${JSON.stringify(content)} > ${JSON.stringify(join(worktree, rel))}`]);
  }
  execFileSync("git", ["add", "-A"], { cwd: worktree, env });
  execFileSync("git", ["commit", "-m", message], { cwd: worktree, env });
}

/** A runtime that answers by role/task (never exhausts, so the CURRENT-code
 *  remediation loop cannot throw for lack of scripted turns). On the implement
 *  pass it records whether the setup marker was already present in the worktree
 *  and commits the change so the gates have a diff to run against. */
function markerRecordingRuntime(): {
  runtime: Runtime;
  markerAtImplement(): boolean | undefined;
  implementCalls(): number;
} {
  let markerAtImplement: boolean | undefined;
  let implementCalls = 0;
  const runtime: Runtime = {
    kind: "claude",
    async runTurn(req: TurnRequest): Promise<TurnResult> {
      if (req.role.name === "builder") {
        if (req.task.includes("# Pass: implement")) {
          implementCalls += 1;
          markerAtImplement = existsSync(join(req.workdir, MARKER_REL));
          commit(req.workdir, "feat: greenfield change", {
            "auth/change.ts": "export const changed = true;\n",
          });
          return turnResultOf(DONE);
        }
        // contract pass (and any reformat retry)
        return turnResultOf(CONTRACT);
      }
      if (req.role.name === "reviewer") return turnResultOf(APPROVE);
      throw new Error(`unexpected role in fixture: ${req.role.name}`);
    },
  };
  return { runtime, markerAtImplement: () => markerAtImplement, implementCalls: () => implementCalls };
}

async function rootPipelines(): Promise<PipelinesFile> {
  return loadPipelines(join(REPO_ROOT, "pipelines.yaml"), {
    roleNames: Object.keys(ROLES),
    promptsDir: PROMPTS_DIR,
  });
}

function runIdsMatching(runlogRoot: string, needle: string): string[] {
  return readdirSync(join(runlogRoot, "runs", "fixture")).filter((id) => id.includes(needle));
}

async function setupGatePassIn(runlogRoot: string, needle: string): Promise<boolean> {
  for (const runId of runIdsMatching(runlogRoot, needle)) {
    const events = await readEvents(runlogRoot, "fixture", runId);
    if (events.some((e) => e.event === "gate.passed" && e.detail?.["gate"] === "setup")) return true;
  }
  return false;
}

async function setupGateFailIn(runlogRoot: string, needle: string): Promise<boolean> {
  for (const runId of runIdsMatching(runlogRoot, needle)) {
    const events = await readEvents(runlogRoot, "fixture", runId);
    if (events.some((e) => e.event === "gate.failed" && e.detail?.["gate"] === "setup")) return true;
  }
  return false;
}

describe("L1-02 setup gate runs at worktree provision (before the implement pass)", () => {
  it("installs deps before the first implement pass, and keeps the post-implement re-run", async () => {
    const pair = makeBareWithClone();
    const gh = new FakeGhOps({
      cloneRoot: pair.clone.root,
      issues: [{ number: 1, title: "Greenfield Setup Ordering", body: ISSUE_BODY, labels: ["op:ready"] }],
    });
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const probe = markerRecordingRuntime();
    try {
      const commands = { setupCommand: SETUP_OK, testCommand: "true", lintCommand: "true" };
      const ticketEpisode = ticketEpisodeFixture(home.root, gh, probe.runtime, commands);
      const result = await runLoopOnce({
        app: "fixture",
        repo: "fixture/repo",
        gh,
        localRepo: pair.clone.root,
        worktreeRoot: join(pair.root, "worktrees"),
        base: baseRevisionForBranch("main"),
        policy: policy(),
        commands,
        engine: {
          pipelines: await rootPipelines(),
          roles: ticketEpisode.roles,
          runtimeFor: (role) => ({
            kind: role.runtime,
            runTurn: probe.runtime.runTurn.bind(probe.runtime),
          }),
          promptsDir: PROMPTS_DIR,
          runlogRoot: home.root,
          hooks: allowAllHooks(),
          planTicket: ticketEpisode.planTicket,
          executeTicketPlan: ticketEpisode.executeTicketPlan,
        },
      });

      // (a) The implement pass ran with dependencies already provisioned — the
      //     marker was present BEFORE any implementation work. On main this is
      //     false: setup runs only after the implement pass, in the gates runner.
      expect(probe.implementCalls()).toBeGreaterThan(0);
      expect(probe.markerAtImplement()).toBe(true);
      expect(result.items[0]?.phase).toBe("merged");

      // (b) events.jsonl carries a setup-gate PASS at provision (its own run),
      //     recorded before the implement pass ran (proven by the marker above).
      expect(await setupGatePassIn(home.root, "provision-setup")).toBe(true);
      // The post-implement re-run stays: the gates runner also ran+passed setup.
      expect(await setupGatePassIn(home.root, "quality-gates")).toBe(true);
    } finally {
      home.cleanup();
      pair.cleanup();
    }
  });

  it("reports a provision-time setup FAILURE loudly and runs no implement pass", async () => {
    const pair = makeBareWithClone();
    const gh = new FakeGhOps({
      cloneRoot: pair.clone.root,
      issues: [{ number: 1, title: "Greenfield Setup Failure", body: ISSUE_BODY, labels: ["op:ready"] }],
    });
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const probe = markerRecordingRuntime();
    try {
      const commands = { setupCommand: SETUP_FAIL, testCommand: "true", lintCommand: "true" };
      const ticketEpisode = ticketEpisodeFixture(home.root, gh, probe.runtime, commands);
      const result = await runLoopOnce({
        app: "fixture",
        repo: "fixture/repo",
        gh,
        localRepo: pair.clone.root,
        worktreeRoot: join(pair.root, "worktrees"),
        base: baseRevisionForBranch("main"),
        policy: policy(),
        commands,
        engine: {
          pipelines: await rootPipelines(),
          roles: ticketEpisode.roles,
          runtimeFor: (role) => ({
            kind: role.runtime,
            runTurn: probe.runtime.runTurn.bind(probe.runtime),
          }),
          promptsDir: PROMPTS_DIR,
          runlogRoot: home.root,
          hooks: allowAllHooks(),
          planTicket: ticketEpisode.planTicket,
          executeTicketPlan: ticketEpisode.executeTicketPlan,
        },
      });

      // Loud, not swallowed: the ticket is returned before any build turn.
      expect(result.items[0]?.phase).toBe("returned");
      expect(probe.implementCalls()).toBe(0);
      expect((await gh.readIssue(1)).labels).toContain("op:returned");
      const comments = gh.issueComments.get(1) ?? [];
      expect(comments.some((c) => /setup/i.test(c))).toBe(true);
      // The failure is recorded as a setup gate.failed in run evidence.
      expect(await setupGateFailIn(home.root, "provision-setup")).toBe(true);
    } finally {
      home.cleanup();
      pair.cleanup();
    }
  });
});
