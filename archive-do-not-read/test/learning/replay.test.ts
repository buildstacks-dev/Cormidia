// The loop replay executor (learning-loop M5; design §9.3-§9.5). Proves the
// paired-replay substrate offline: a real git seed worktree, the ordinary
// pass executor with a scripted FakeRuntime (zero tokens), real quality
// gates as subprocesses, ledger settlement with experiment/candidate
// attribution, the reserved learning-replay runlog namespace (excluded from
// capture), the held-out contract (no expected outcome in brief or context
// bytes), and the treatment overlay rendered into the arm's context.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readExecutionSteps } from "../../src/loop/efficiency.js";
import {
  readCurrentEpisodePlan,
  readEpisodePlanVersion,
} from "../../src/loop/episode-plan.js";
import { readEpisodePlanExecutionJournal } from "../../src/loop/episode-plan-executor.js";
import { readEpisodeReplanJournal } from "../../src/loop/episode-replan.js";
import { listRuns } from "../../src/org/learning/capture.js";
import type { EvalFixture } from "../../src/org/learning/eval-fixture.js";
import { validateExperimentRecord } from "../../src/org/learning/experiment.js";
import { defaultLearningPolicy } from "../../src/org/learning/policy.js";
import {
  createLoopReplayExecutor,
  replayEpisodeIdForAttempt,
  REPLAY_RUNLOG_APP,
  type LoopReplayExecutorOptions,
  type ReplayAttemptRequest,
} from "../../src/org/learning/replay.js";
import { readTurnRecords } from "../../src/runtime/telemetry.js";
import { FakeRuntime } from "../../src/runtime/testing/fakeRuntime.js";
import type {
  RoleConfig,
  Runtime,
  TurnHooks,
  TurnRequest,
  TurnResult,
} from "../../src/runtime/types.js";
import { makeWorkingRepo, type WorkingRepoFixture } from "../fixtures/gitRepo.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";
import { makeExperiment } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

const BRIEF = [
  "## Ticket",
  "",
  "Implement the CSV export (#7).",
  "",
  "## Acceptance criteria",
  "- [ ] exports rows as CSV",
  "",
  "## Implementation contract",
  "",
  "**Files:**",
  "- src/export.ts",
  "**Approach:** Implement the export path.",
  "**Tests:**",
  "- AC1 -> exports rows as CSV",
  "**Risks:** None.",
  "**Complexity:** low",
  "",
].join("\n");
const APPROVE = [
  "Verdict: approve",
  "",
  "## Review rationale",
  "The exact replay diff satisfies the fixture ticket.",
  "",
  "## Evidence",
  "- replay behavior => the named replay test passes at the reviewed head",
  "",
  "## Not reviewed",
  "- None.",
].join("\n");
const FINDING =
  "- testing/major src/x.ts:1 -- missing regression coverage -> add the test\nVerdict: findings";

function role(name: string, runtime: RoleConfig["runtime"] = "claude"): RoleConfig {
  return {
    name,
    runtime,
    model: `${name}-model`,
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: [],
    maxTurnBudgetUsd: 5,
  };
}

const ROLES = {
  builder: role("builder", "claude"),
  reviewer: role("reviewer", "codex"),
  planner: role("planner", "claude"),
};

interface Rig {
  org: OrgHomeFixture;
  state: OrgHomeFixture;
  repo: WorkingRepoFixture;
  seedCommit: string;
  fixture: EvalFixture;
  options: (runtime: Runtime, overrides?: Partial<LoopReplayExecutorOptions>) => LoopReplayExecutorOptions;
}

function makeRig(): Rig {
  const org = makeOrgHome({ taste: true });
  const state = makeOrgHome();
  const repo = makeWorkingRepo();
  cleanups.push(org.cleanup, state.cleanup, repo.cleanup);
  const seedCommit = repo.commit("seed: gate commands", {
    ".operon/config.yaml": 'test_command: "true"\nlint_command: "true"\n',
  });
  const fixture: EvalFixture = {
    schema_version: 1,
    fixture_id: "evals/roles/builder/standard-tickets/replay_alpha_ticket_0007",
    eval_set: "roles/builder/standard-tickets",
    capsule_ref: "replay_alpha_ticket_0007",
    episode_ref: "ep_alpha_ticket_0007",
    kind: "build_ticket",
    seed: { repo: "owner/alpha", commit: seedCommit, fixtures: [] },
    input: { ticket_ref: "github:#7", brief_hash: null, brief: BRIEF },
    fingerprint_ref: null,
    artifacts: [],
    observed_outcome: { merged: true, review_cycles: 2, cost_usd: 12.41 },
    expected_outcome: { merged: true, review_cycles: 2, cost_usd: 12.41 },
    grader: { kind: "deterministic", ref: "builtin:build-outcome@1" },
    side_effect_policy: {
      network: "fixture_only",
      publishing: "forbidden",
      deployment: "sandbox_only",
    },
    sanitized: true,
    drafted_by: "human-operator",
    drafted_at: "2026-07-11T09:00:00.000Z",
    validated_by: "second-actor",
    validated_at: "2026-07-11T09:30:00.000Z",
  };
  const worktreeRoot = join(state.root, "worktrees", "learning-replay");
  mkdirSync(worktreeRoot, { recursive: true });
  return {
    org,
    state,
    repo,
    seedCommit,
    fixture,
    options: (runtime, overrides = {}) => ({
      orgHome: org.root,
      stateHome: state.root,
      localRepo: repo.root,
      worktreeRoot,
      app: {
        name: "any",
        repo: "owner/alpha",
        status: "paused",
        budgetUsdMonth: 100,
        cadence: {},
        execution: { assignmentMode: "fixed", allowedAssignments: {} },
      },
      roles: ROLES,
      runtimeForAssignment: (assignment) => ({
        kind: assignment.harness,
        runTurn: (turnRequest, hooks) => runtime.runTurn(turnRequest, hooks),
      }),
      assignmentReadinessProbe: async (request) => ({
        runtime: request.runtime,
        models: [...request.models],
        status: "ready",
        detail: "test adapter ready; no model turn sent",
        durationMs: 1,
        billable: false,
      }),
      policy: defaultLearningPolicy(),
      candidateRef: "cand_20260711_01JGHI",
      clock: () => new Date("2026-07-11T12:00:00Z"),
      ...overrides,
    }),
  };
}

function experiment(): ReturnType<typeof validateExperimentRecord> {
  return validateExperimentRecord(makeExperiment({ experiment_id: "exp_replay_01" }));
}

function request(overrides: Partial<ReplayAttemptRequest> = {}, rig?: Rig): ReplayAttemptRequest {
  return {
    fixture: rig?.fixture ?? (overrides.fixture as EvalFixture),
    arm: "control",
    pair: 1,
    mode: "full",
    experiment: experiment(),
    ...overrides,
  };
}

function turn(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    escalations: [],
    session: { runtime: "claude", id: `s-${summary.slice(0, 8)}` },
    usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.25, subagentTurns: 0, wallClockMs: 100 },
  };
}

/** Wrap a FakeRuntime so build/fix passes leave a real commit in the
 *  worktree — the diff, gates, and merge-equivalence all read git state. */
function committing(fake: FakeRuntime, files: Record<string, Record<string, string>>): Runtime {
  return {
    kind: fake.kind,
    async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
      // Review briefs embed the original brief verbatim — only acting
      // passes (build/fix) mutate the tree.
      const acting = !req.task.includes("## Diff under review");
      for (const [needle, changed] of Object.entries(files)) {
        if (acting && req.task.includes(needle)) {
          for (const [path, content] of Object.entries(changed)) {
            const abs = join(req.workdir, path);
            mkdirSync(join(abs, ".."), { recursive: true });
            writeFileSync(abs, content);
          }
          const { execFileSync } = await import("node:child_process");
          const env = {
            ...process.env,
            GIT_AUTHOR_NAME: "Fixture",
            GIT_AUTHOR_EMAIL: "f@x.invalid",
            GIT_COMMITTER_NAME: "Fixture",
            GIT_COMMITTER_EMAIL: "f@x.invalid",
          };
          execFileSync("git", ["add", "-A"], { cwd: req.workdir, env });
          const status = execFileSync("git", ["status", "--porcelain"], {
            cwd: req.workdir,
            env,
            encoding: "utf8",
          });
          if (status.trim() !== "") {
            execFileSync("git", ["commit", "-m", "replay fixture change"], { cwd: req.workdir, env });
          }
        }
      }
      return fake.runTurn(req, hooks);
    },
  };
}

describe("full paired-replay attempt", () => {
  it("build + gates + approving review reads as merge-equivalent and grades held-in pass", async () => {
    const rig = makeRig();
    const fake = new FakeRuntime([{ result: turn("built the export") }, { result: turn(APPROVE) }]);
    const runtime = committing(fake, { "Implement the CSV export": { "src/x.ts": "export {};\n" } });
    const executor = createLoopReplayExecutor(rig.options(runtime));

    const replayRequest = request({ arm: "control" }, rig);
    const attempt = await executor.attempt(replayRequest);
    expect(attempt.metrics).toMatchObject({
      merged: 1,
      review_cycles: 0,
      held_in_pass: 1,
      gate_failures: 0,
    });
    expect(attempt.heldInPass).toBe(true);
    expect(attempt.costUsd).toBeCloseTo(0.5);
    expect(attempt.runIds).toHaveLength(2);

    // Two provider turns: build got the verbatim brief, review got the diff.
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]?.req.task).toBe(BRIEF);
    expect(fake.calls[1]?.req.task).toContain("## Diff under review");
    expect(fake.calls[1]?.req.task).toContain("src/x.ts");
    expect(fake.calls.map((call) => call.req.assignment)).toEqual([
      { harness: "claude", model: "builder-model", effort: "high" },
      { harness: "codex", model: "reviewer-model", effort: "high" },
    ]);

    const episodeId = replayEpisodeIdForAttempt(replayRequest);
    const plan = await readCurrentEpisodePlan(rig.state.root, episodeId);
    expect(plan).toMatchObject({
      version: 1,
      planningSource: "creator_scope",
      creatorProvenance: { creatorId: "learning-experiment-runner" },
    });
    expect(plan?.steps.filter((step) => step.kind === "provider_turn").map((step) => ({
      id: step.id,
      assignmentSource: step.assignmentSource,
      assignment: step.assignment,
    }))).toEqual([
      {
        id: "replay-build",
        assignmentSource: "configured",
        assignment: { harness: "claude", model: "builder-model", effort: "high" },
      },
      {
        id: "replay-review",
        assignmentSource: "configured",
        assignment: { harness: "codex", model: "reviewer-model", effort: "high" },
      },
    ]);

    // Runs land in the reserved namespace, settle with learning attribution…
    const rows = await readTurnRecords(rig.state.root);
    const replayRows = rows.filter((row) => row.app === REPLAY_RUNLOG_APP);
    expect(replayRows).toHaveLength(2);
    for (const row of replayRows) {
      expect(row.experimentRef).toBe("exp_replay_01");
      expect(row.candidateRef).toBe("cand_20260711_01JGHI");
      expect(row.trigger).toBe("manual");
    }
    const providerEvidence = (await readExecutionSteps(rig.state.root, episodeId))
      .filter((step) => step.kind === "provider");
    expect(providerEvidence).toHaveLength(2);
    for (const step of providerEvidence) {
      expect(step.experiment_ref).toBe("exp_replay_01");
      expect(step.candidate_ref).toBe("cand_20260711_01JGHI");
    }
    // …and the capture projector never sees them (evidence stays clean).
    expect(await listRuns(rig.state.root)).toEqual([]);
    expect(existsSync(join(rig.state.root, "runs", REPLAY_RUNLOG_APP))).toBe(true);

    // The worktree is gone; the branch namespace does not accumulate.
    expect(readdirSync(join(rig.state.root, "worktrees", "learning-replay"))).toEqual([]);
  });

  it("a findings round bounces through one fix pass and counts a review cycle", async () => {
    const rig = makeRig();
    const fake = new FakeRuntime([
      { result: turn("built the export") },
      { result: turn(FINDING) },
      { result: turn("fixed the finding") },
      { result: turn(APPROVE) },
    ]);
    const runtime = committing(fake, {
      "Implement the CSV export": { "src/x.ts": "export {};\n" },
      "Address the review findings": { "test/x.test.ts": "// regression\n" },
    });
    const executor = createLoopReplayExecutor(rig.options(runtime));

    const replayRequest = request({ arm: "control" }, rig);
    const attempt = await executor.attempt(replayRequest);
    expect(attempt.metrics).toMatchObject({ merged: 1, review_cycles: 1, held_in_pass: 1 });
    expect(fake.calls).toHaveLength(4);
    expect(fake.calls[2]?.req.task).toContain("missing regression coverage");

    const episodeId = replayEpisodeIdForAttempt(replayRequest);
    const v1 = await readEpisodePlanVersion(rig.state.root, episodeId, 1);
    const v2 = await readEpisodePlanVersion(rig.state.root, episodeId, 2);
    expect(v1?.steps.map((step) => step.id)).toEqual([
      "replay-build",
      "replay-gates",
      "replay-review",
      "replay-review-decision",
    ]);
    expect(v2?.steps.map((step) => step.id)).toEqual([
      "replay-build",
      "replay-gates",
      "replay-review",
      "replay-fix",
      "replay-regate",
      "replay-rereview",
      "replay-review-decision",
    ]);
    expect(v2?.steps.slice(0, 3)).toEqual(v1?.steps.slice(0, 3));
    expect((await readEpisodeReplanJournal(rig.state.root, episodeId))?.records)
      .toMatchObject([{ trigger: { kind: "failed_gate" }, status: "accepted", revisionVersion: 2 }]);
    const journal = await readEpisodePlanExecutionJournal(rig.state.root, episodeId);
    expect(journal?.events.filter((event) =>
      event.kind === "step_completed" && event.step_id === "replay-build"))
      .toHaveLength(1);
  });

  it("keeps expected outcomes verifier-only — no brief or context byte carries them (design §9.3)", async () => {
    const rig = makeRig();
    const fake = new FakeRuntime([{ result: turn("built") }, { result: turn(APPROVE) }]);
    const runtime = committing(fake, { "Implement the CSV export": { "src/x.ts": "x\n" } });
    const executor = createLoopReplayExecutor(rig.options(runtime));
    await executor.attempt(request({ arm: "control" }, rig));

    for (const call of fake.calls) {
      const bytes =
        call.req.task +
        call.req.context.taste.join("\n") +
        call.req.context.memoryExcerpts.join("\n");
      expect(bytes).not.toContain("expected_outcome");
      expect(bytes).not.toContain("12.41"); // the observed/expected cost
      expect(bytes).not.toContain("build-outcome@1");
    }
  });

  it("fails an invalid review verdict once without a hidden reformat provider turn", async () => {
    const rig = makeRig();
    const fake = new FakeRuntime([
      { result: turn("built") },
      { result: turn("looks fine to me") },
    ]);
    const runtime = committing(fake, { "Implement the CSV export": { "src/x.ts": "x\n" } });
    const executor = createLoopReplayExecutor(rig.options(runtime));

    const attempt = await executor.attempt(request({ arm: "control" }, rig));
    expect(attempt).toMatchObject({ heldInPass: false, runIds: expect.any(Array) });
    expect(attempt.runIds).toHaveLength(2);
    expect(fake.calls).toHaveLength(2);
    const rows = (await readTurnRecords(rig.state.root))
      .filter((row) => row.app === REPLAY_RUNLOG_APP);
    expect(rows).toHaveLength(2);
    expect(rows.at(-1)?.status).toBe("completed");
    const runs = readdirSync(join(rig.state.root, "runs", REPLAY_RUNLOG_APP));
    expect(runs).toHaveLength(2);
  });
});

describe("assignment-aware durable replay execution", () => {
  it("persists creator-selected adaptive tuples and executes different harnesses", async () => {
    const rig = makeRig();
    const adaptiveBuilder: RoleConfig = {
      ...role("builder", "claude"),
      adaptiveAssignments: [{
        id: "builder-pi-qualified",
        harness: "pi",
        model: "anthropic/claude-qualified",
        efforts: ["medium"],
        providerFamily: "anthropic",
        capabilityRef: "pi/v1",
        qualificationRef: "test:builder-pi-qualified",
        pricing: {
          kind: "conservative_estimate",
          maxTurnCostUsd: 3,
          sourceRef: "test:price-catalog",
        },
      }],
    };
    const adaptiveRoles = {
      builder: adaptiveBuilder,
      reviewer: role("reviewer", "codex"),
      planner: role("planner", "claude"),
    };
    const fake = new FakeRuntime([{ result: turn("built") }, { result: turn(APPROVE) }]);
    const runtime = committing(fake, { "Implement the CSV export": { "src/x.ts": "x\n" } });
    const executor = createLoopReplayExecutor(rig.options(runtime, {
      roles: adaptiveRoles,
      app: {
        name: "any",
        repo: "owner/alpha",
        status: "paused",
        budgetUsdMonth: 100,
        cadence: {},
        execution: {
          assignmentMode: "adaptive",
          allowedAssignments: {
            builder: ["builder-pi-qualified"],
            reviewer: ["configured"],
            planner: ["configured"],
          },
        },
      },
    }));
    const replayRequest = request({ arm: "control" }, rig);

    await expect(executor.attempt(replayRequest)).resolves.toMatchObject({ heldInPass: true });
    expect(fake.calls.map((call) => call.req.assignment)).toEqual([
      { harness: "pi", model: "anthropic/claude-qualified", effort: "medium" },
      { harness: "codex", model: "reviewer-model", effort: "high" },
    ]);
    const plan = await readCurrentEpisodePlan(
      rig.state.root,
      replayEpisodeIdForAttempt(replayRequest),
    );
    expect(plan?.steps.filter((step) => step.kind === "provider_turn").map((step) => ({
      harness: step.assignment.harness,
      source: step.assignmentSource,
    }))).toEqual([
      { harness: "pi", source: "creator" },
      { harness: "codex", source: "creator" },
    ]);
  });

  it("resumes a crash after terminal provider evidence without a duplicate turn", async () => {
    const rig = makeRig();
    const fake = new FakeRuntime([{ result: turn("built") }]);
    const runtime = committing(fake, { "Implement the CSV export": { "src/x.ts": "x\n" } });
    let injected = false;
    const executor = createLoopReplayExecutor(rig.options(runtime, {
      afterProviderEvidence: ({ recovered }) => {
        if (!recovered && !injected) {
          injected = true;
          throw new Error("fault after terminal provider evidence");
        }
      },
    }));
    const replayRequest = request({ arm: "control", pair: 0, mode: "targeted" }, rig);
    const episodeId = replayEpisodeIdForAttempt(replayRequest);

    await expect(executor.attempt(replayRequest)).rejects.toMatchObject({
      code: "error_episode_plan_step_interrupted",
    });
    expect(fake.calls).toHaveLength(1);
    expect(readdirSync(join(rig.state.root, "worktrees", "learning-replay"))).toHaveLength(1);
    expect((await readEpisodePlanExecutionJournal(rig.state.root, episodeId))?.status).toBe("running");

    await expect(executor.attempt(replayRequest)).resolves.toMatchObject({ heldInPass: true });
    expect(fake.calls).toHaveLength(1);
    expect(readdirSync(join(rig.state.root, "worktrees", "learning-replay"))).toEqual([]);
    expect((await readEpisodePlanExecutionJournal(rig.state.root, episodeId))?.status).toBe("completed");
  });
});

describe("targeted role-level eval (the cheap step)", () => {
  it("runs one builder pass, grades by gates, and measures no merge metrics", async () => {
    const rig = makeRig();
    const fake = new FakeRuntime([{ result: turn("built") }]);
    const runtime = committing(fake, { "Implement the CSV export": { "src/x.ts": "x\n" } });
    const executor = createLoopReplayExecutor(rig.options(runtime));

    const attempt = await executor.attempt(request({ arm: "control", pair: 0, mode: "targeted" }, rig));
    expect(attempt.metrics).toMatchObject({ held_in_pass: 1, gate_failures: 0 });
    expect(attempt.metrics["merged"]).toBeUndefined();
    expect(attempt.metrics["review_cycles"]).toBeUndefined();
    expect(fake.calls).toHaveLength(1);
  });

  it("a failing gate reads as a held-in failure", async () => {
    const rig = makeRig();
    // The build pass commits a config that makes the tests gate fail.
    const fake = new FakeRuntime([{ result: turn("built") }]);
    const runtime = committing(fake, {
      "Implement the CSV export": {
        "src/x.ts": "x\n",
        ".operon/config.yaml": 'test_command: "false"\nlint_command: "true"\n',
      },
    });
    const executor = createLoopReplayExecutor(rig.options(runtime));
    const attempt = await executor.attempt(request({ arm: "control", pair: 0, mode: "targeted" }, rig));
    expect(attempt.heldInPass).toBe(false);
    expect(attempt.metrics["gate_failures"]).toBe(1);
  });
});

describe("treatment overlay", () => {
  it("prepends the candidate's rendered concept as the first governed context section", async () => {
    const rig = makeRig();
    const overlay = "## Learning concept trial (roles/builder)\nDescription: the trial concept";
    const fake = new FakeRuntime([{ result: turn("built") }]);
    const runtime = committing(fake, { "Implement the CSV export": { "src/x.ts": "x\n" } });
    const executor = createLoopReplayExecutor(
      rig.options(runtime, { treatmentOverlay: overlay }),
    );
    await executor.attempt(request({ arm: "treatment", pair: 0, mode: "targeted" }, rig));
    expect(fake.calls[0]?.req.context.memoryExcerpts[0]).toBe(overlay);
  });

  it("refuses a treatment attempt without an overlay, and a control attempt never sees one", async () => {
    const rig = makeRig();
    const fake = new FakeRuntime([{ result: turn("built") }]);
    const runtime = committing(fake, { "Implement the CSV export": { "src/x.ts": "x\n" } });
    await expect(
      createLoopReplayExecutor(rig.options(runtime)).attempt(
        request({ arm: "treatment", pair: 0, mode: "targeted" }, rig),
      ),
    ).rejects.toThrow(/treatment attempts need the candidate overlay/);

    const overlay = "## Learning concept trial (roles/builder)";
    const executor = createLoopReplayExecutor(rig.options(runtime, { treatmentOverlay: overlay }));
    await executor.attempt(request({ arm: "control", pair: 0, mode: "targeted" }, rig));
    expect(fake.calls[0]?.req.context.memoryExcerpts).not.toContain(overlay);
  });
});

describe("trust prechecks", () => {
  it("refuses unvalidated fixtures and fixtures without the verbatim brief", async () => {
    const rig = makeRig();
    const fake = new FakeRuntime([]);
    const executor = createLoopReplayExecutor(rig.options(fake));

    await expect(
      executor.attempt(
        request(
          { fixture: { ...rig.fixture, validated_by: null, validated_at: null } },
        ),
      ),
    ).rejects.toThrow(/not independently validated/);

    await expect(
      executor.attempt(
        request({ fixture: { ...rig.fixture, input: { ...rig.fixture.input, brief: null } } }),
      ),
    ).rejects.toThrow(/no verbatim brief/);
    expect(fake.calls).toHaveLength(0);
  });
});
