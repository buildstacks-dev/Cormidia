// Traceability: CF-REG-232 · HB-139 · case-catalog.md §10.3.

// CF-REG-232 — Planner publication is a durable exactly-once transaction.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdStatus } from "../../../src/cli/status.js";
import { baseRevisionForBranch } from "../../../src/loop/default-branch.js";
import type { GhIssue, GhOps } from "../../../src/loop/github.js";
import { renderStoryMarkdown } from "../../../src/narrative/render.js";
import type { NarrativeStory } from "../../../src/narrative/types.js";
import type { AppEntry } from "../../../src/org/apps.js";
import {
  PermanentPlannerPublicationError,
  plannerPublicationProtectedSurface,
  plannerPublicationPath,
  preparePlannerPublication,
  readPlannerPublication,
  resumePlannerPublication,
  type PlannerPublicationGit,
  type PlannerPublicationTransaction,
} from "../../../src/org/planner-publication.js";
import { preparePlannerIssueIntake, type PlannerReadinessDecision } from "../../../src/org/planner-intake.js";
import { persistPublishedRoadmap } from "../../../src/org/plan-auto.js";
import { readCurrentDeliveryUnitReadiness } from "../../../src/org/roadmap-delivery/delivery-readiness.js";
import { readCurrentRoadmapPlan } from "../../../src/org/roadmap-delivery/roadmap-plan.js";
import { readCurrentValidationContract } from "../../../src/org/roadmap-delivery/validation-contract-authority.js";
import { createPlannerTurnWorktree, turnWorktreeIdentity } from "../../../src/org/turn-runner.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const homes: TempStateHome[] = [];
const tempDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(homes.splice(0).map((home) => home.cleanup()));
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("CF-REG-232 — exactly-once Planner publication", () => {
  it("refuses every repository/app protocol-surface family without wildcarding near misses", () => {
    for (const path of [
      "TASTE.md",
      "roles.yaml",
      "nested/AGENTS.md",
      "docs/PURPOSE.md",
      "pipelines.yaml",
      "apps.yaml",
      "AUTHORITY.md",
      ".cormidia/TASTE.md",
      ".cormidia/AUTHORITY.md",
      ".cormidia/policy.yaml",
      ".cormidia/config.yaml",
      "prompts/build/contract.md",
      "taste/reviewer.md",
    ])
      expect(plannerPublicationProtectedSurface(path), path).toBe(true);
    for (const path of [
      "README.md",
      "docs/purpose-notes.md",
      ".cormidia/onboarding-report.md",
      "prompt-examples/build.md",
      "tasteful/reviewer.md",
      "policy.yml",
    ])
      expect(plannerPublicationProtectedSurface(path), path).toBe(false);
  });

  it("recovers crash-before-push without repeating provider work and publishes lifecycle authority", async () => {
    const world = await setup("crash-before-push", "turn-crash");
    expect(world.git.pushes).toBe(0);
    expect(world.transaction.state).toBe("publication_pending");
    expect(world.transaction).toMatchObject({
      repository: APP.repo,
      branch: turnWorktreeIdentity(world.home.stateHome, APP.name, "turn-crash").branch,
      commit: "commit-planner",
      evidence: { provider_run_ids: ["run-planner"] },
      error: null,
    });
    expect(world.transaction.intended_effects.map((effect) => effect.kind)).toEqual([
      "git_branch",
      "planner_readiness",
      "roadmap_plan",
      "validation_readiness",
    ]);
    expect(world.transaction.intended_effects.find((effect) => effect.kind === "roadmap_plan")?.detail).toEqual({
      source: `planner-publication:${world.transaction.publication_id}:complete-open-backlog`,
      predecessor: null,
    });
    expect(world.transaction.recovery.identity).toMatch(/^[0-9a-f]{64}$/);

    const recovered = await resume(world);
    expect(recovered).toMatchObject({ state: "published", error: null });
    expect(world.git.pushes).toBe(1);
    expect(world.gh.addCalls).toBe(1);
    expect(world.gh.listCalls).toBe(2); // intake + one complete publication read
    expect(world.providerCalls).toBe(1);
    const roadmap = await readCurrentRoadmapPlan(world.home.stateHome, APP.name);
    expect(roadmap?.value.readyFrontier).toHaveLength(1);
    const unitId = roadmap!.value.readyFrontier[0]!;
    expect(await readCurrentValidationContract(world.home.stateHome, APP.name, unitId)).toBeDefined();
    expect(await readCurrentDeliveryUnitReadiness(world.home.stateHome, APP.name, unitId)).toBeDefined();

    // Duplicate resume is a pure read of terminal authority.
    expect((await resume(world)).state).toBe("published");
    expect(world.git.pushes).toBe(1);
    expect(world.gh.addCalls).toBe(1);
    expect(world.providerCalls).toBe(1);
  });

  it("reconciles push-with-lost-acknowledgement by observing the exact remote commit", async () => {
    const world = await setup("lost-ack", "turn-lost-ack");
    const lost = await resumePlannerPublication({
      stateHome: world.home.stateHome,
      app: APP,
      publicationId: world.transaction.publication_id,
      gh: world.gh as unknown as GhOps,
      git: world.git,
      now: NOW,
      fault: (boundary) => {
        if (boundary === "after_push") throw new Error("seeded lost acknowledgement");
      },
    });
    expect(lost.state).toBe("publication_pending");
    expect(lost.error?.message).toContain("lost acknowledgement");
    expect(world.git.remote).toBe("commit-planner");
    expect(world.git.pushes).toBe(1);

    const recovered = await resume(world);
    expect(recovered.state).toBe("published");
    expect(world.git.pushes).toBe(1);
    expect(world.providerCalls).toBe(1);
  });

  it("serializes concurrent duplicate resumes under one durable publication identity", async () => {
    const world = await setup("concurrent-resume", "turn-concurrent");
    const [first, second] = await Promise.all([resume(world), resume(world)]);

    expect(first.state).toBe("published");
    expect(second.state).toBe("published");
    expect(world.git.pushes).toBe(1);
    expect(world.gh.addCalls).toBe(1);
    expect(world.providerCalls).toBe(1);
  });

  it("acknowledges an exact RoadmapPlan after a lost acknowledgement and refuses a successor conflict", async () => {
    const acknowledged = await setup("roadmap-lost-ack", "turn-roadmap-lost-ack");
    const pending = await resumePlannerPublication({
      stateHome: acknowledged.home.stateHome,
      app: APP,
      publicationId: acknowledged.transaction.publication_id,
      gh: acknowledged.gh as unknown as GhOps,
      git: acknowledged.git,
      now: NOW,
      fault: (boundary) => {
        if (boundary === "after_roadmap") throw new Error("seeded RoadmapPlan acknowledgement loss");
      },
    });
    expect(pending.state).toBe("publication_pending");
    const firstRoadmap = await readCurrentRoadmapPlan(acknowledged.home.stateHome, APP.name);
    expect(firstRoadmap).toBeDefined();
    acknowledged.gh.issues.push(issue(233, "New backlog after RoadmapPlan publication"));

    const recovered = await resume(acknowledged);
    const observedRoadmap = await readCurrentRoadmapPlan(acknowledged.home.stateHome, APP.name);
    expect(recovered).toMatchObject({ state: "published", error: null });
    expect(observedRoadmap?.ref).toEqual(firstRoadmap?.ref);
    expect(acknowledged.gh.listCalls).toBe(3); // intake, original roadmap, recovery validation
    expect(acknowledged.providerCalls).toBe(1);

    const conflict = await setup("roadmap-successor-conflict", "turn-roadmap-conflict");
    const interrupted = await resumePlannerPublication({
      stateHome: conflict.home.stateHome,
      app: APP,
      publicationId: conflict.transaction.publication_id,
      gh: conflict.gh as unknown as GhOps,
      git: conflict.git,
      now: NOW,
      fault: (boundary) => {
        if (boundary === "after_roadmap") throw new Error("seeded RoadmapPlan acknowledgement loss");
      },
    });
    expect(interrupted.state).toBe("publication_pending");
    conflict.gh.issues.push(issue(234, "Concurrent roadmap input"));
    await persistPublishedRoadmap({
      stateHome: conflict.home.stateHome,
      app: APP,
      gh: conflict.gh as unknown as GhOps,
      plan: {
        stage: "growth",
        ticketCountRationale: "Seed a competing accepted RoadmapPlan revision.",
        releaseDisposition: "merge-only",
        releaseKind: "merge-only",
        tickets: [ticketPlan()],
      },
      published: [{ index: 0, issueNumber: 232, title: issue().title, ready: true, labels: ["op:ready"] }],
      now: new Date("2026-08-04T12:01:00.000Z"),
    });
    const refused = await resume(conflict);
    expect(refused).toMatchObject({
      state: "refused",
      error: { code: "error_planner_publication_roadmap_conflict", permanence: "permanent" },
    });
    expect((await resume(conflict)).state).toBe("refused");
    expect(conflict.providerCalls).toBe(1);
  });

  it("refuses a conflicting remote branch and a permanent push denial without discarding the artifact", async () => {
    const conflict = await setup("remote-conflict", "turn-conflict");
    conflict.git.remote = "foreign-commit";
    const conflicted = await resume(conflict);
    expect(conflicted).toMatchObject({
      state: "refused",
      commit: "commit-planner",
      error: { code: "error_planner_publication_remote_conflict", permanence: "permanent" },
    });
    expect(conflict.git.pushes).toBe(0);
    conflict.git.remote = "commit-planner";
    expect((await resume(conflict)).state).toBe("published");
    expect(conflict.git.pushes).toBe(0);

    const denial = await setup("permanent-refusal", "turn-refusal");
    denial.git.permanentRefusal = true;
    const refused = await resume(denial);
    expect(refused).toMatchObject({
      state: "refused",
      commit: "commit-planner",
      error: { code: "error_seeded_permanent_refusal", permanence: "permanent" },
    });
    expect(refused.error?.message).toContain("[REDACTED:sk-api-key]");
    expect(refused.error?.message).not.toContain("abcdefghijklmnopqrstuvwx");
    expect(denial.git.pushes).toBe(1);
    expect(existsSync(denial.transaction.worktree_path)).toBe(true);
    denial.git.permanentRefusal = false;
    denial.git.remote = "commit-planner";
    expect((await resume(denial)).state).toBe("published");
    expect(denial.git.pushes).toBe(1);

    const discovery = await setup("permanent-discovery-refusal", "turn-discovery-refusal");
    discovery.git.remoteRefusal = true;
    const discoveryRefused = await resume(discovery);
    expect(discoveryRefused).toMatchObject({
      state: "refused",
      commit: "commit-planner",
      error: { code: "error_seeded_remote_refusal", permanence: "permanent" },
    });
    expect(discovery.git.pushes).toBe(0);
  });

  it("rejects tampered recovery commands and planning intent", async () => {
    const world = await setup("tampered-identity", "turn-tampered");
    const path = plannerPublicationPath(world.home.stateHome, APP.name, world.transaction.publication_id);
    const original = JSON.parse(await readFile(path, "utf8")) as PlannerPublicationTransaction;
    const unsafeCommand = structuredClone(original);
    unsafeCommand.recovery.command = "cormidia publication resume --app somebody-else --id wrong";
    await writeFile(path, `${JSON.stringify(unsafeCommand, null, 2)}\n`);
    await expect(readPlannerPublication(world.home.stateHome, APP.name, original.publication_id)).rejects.toThrow(
      "not a valid v1 transaction",
    );

    const changedIntent = structuredClone(original);
    changedIntent.planner_input.decisions[0]!.reason = "tampered after provider completion";
    await writeFile(path, `${JSON.stringify(changedIntent, null, 2)}\n`);
    await expect(readPlannerPublication(world.home.stateHome, APP.name, original.publication_id)).rejects.toThrow(
      "not a valid v1 transaction",
    );
  });

  it("projects pending state and the exact recovery action through status and narrative", async () => {
    const world = await setup("operator-projection", "turn-operator-projection");
    const jsonLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(cmdStatus(["--state-home", world.home.stateHome, "--app", APP.name, "--json"])).resolves.toBe(0);
    const report = JSON.parse(String(jsonLog.mock.calls[0]![0])) as {
      plannerPublications: PlannerPublicationTransaction[];
    };
    jsonLog.mockRestore();
    expect(report.plannerPublications).toHaveLength(1);
    expect(report.plannerPublications[0]).toMatchObject({
      publication_id: world.transaction.publication_id,
      state: "publication_pending",
      recovery: { command: world.transaction.recovery.command },
    });

    const story: NarrativeStory = {
      schema_version: 1,
      story_id: "episode:operator-projection",
      app: APP.name,
      kind: "planning",
      title: "Planner publication recovery",
      opened: NOW.toISOString(),
      status: "in_progress",
      publication: {
        id: world.transaction.publication_id,
        state: world.transaction.state,
        branch: world.transaction.branch,
        commit: world.transaction.commit,
        branch_created: world.transaction.branch_created,
        error: world.transaction.error?.message ?? null,
        recovery_command: world.transaction.recovery.command,
      },
      moments: [],
      cost: { usd: 0, provider_turns: 1, unmeasured_turns: 0 },
      captured_at: NOW.toISOString(),
    };
    const markdown = renderStoryMarkdown(story);
    expect(markdown).toContain("publication_pending");
    expect(markdown).toContain(world.transaction.branch);
    expect(markdown).toContain(world.transaction.commit);
    expect(markdown).toContain(world.transaction.recovery.command);
  });

  it("seeded negative control fires on completed-with-unpublished state", async () => {
    const world = await setup("negative-control", "turn-negative");
    expect(() => assertTurnCompletionAdmissible("completed", world.transaction)).toThrow(
      "completed turn has publication_pending",
    );
    expect(() => assertTurnCompletionAdmissible("failed", world.transaction)).not.toThrow();
  });

  it("uses a detached managed worktree, creates no branch for read-only grooming, and never changes operator bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "cormidia-cf-reg-232-real-git-"));
    tempDirs.push(root);
    const remote = join(root, "remote.git");
    const seed = join(root, "seed");
    const operator = join(root, "operator");
    const managed = join(root, "managed");
    const stateHome = join(root, "state");
    git(root, "init", "--bare", remote);
    git(root, "init", "-b", "main", seed);
    await writeFile(join(seed, "README.md"), "operator bytes\n");
    git(seed, "add", "README.md");
    git(seed, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "seed");
    git(seed, "remote", "add", "origin", remote);
    git(seed, "push", "-u", "origin", "main");
    git(root, "--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main");
    git(root, "clone", remote, operator);
    git(root, "clone", remote, managed);
    const operatorBefore = await readFile(join(operator, "README.md"), "utf8");
    const operatorStatusBefore = git(operator, "status", "--porcelain=v1", "--untracked-files=all");

    const readOnly = createPlannerTurnWorktree(
      managed,
      stateHome,
      "git-app",
      "turn-read-only",
      baseRevisionForBranch("main"),
    );
    expect(gitOptional(readOnly.path, "symbolic-ref", "--quiet", "--short", "HEAD")).toBeNull();
    const readOnlyTx = await prepareRealGitTransaction(stateHome, readOnly, "turn-read-only");
    expect(readOnlyTx.branch_created).toBe(false);
    expect(gitOptional(managed, "show-ref", "--verify", `refs/heads/${readOnly.branch}`)).toBeNull();

    const mutating = createPlannerTurnWorktree(
      managed,
      stateHome,
      "git-app",
      "turn-mutating",
      baseRevisionForBranch("main"),
    );
    await writeFile(join(mutating.path, "ROADMAP.md"), "durable Planner artifact\n");
    const mutatingTx = await prepareRealGitTransaction(stateHome, mutating, "turn-mutating");
    expect(mutatingTx.branch_created).toBe(true);
    expect(mutatingTx.changed_paths).toEqual(["ROADMAP.md"]);
    expect(git(mutating.path, "status", "--porcelain=v1", "--untracked-files=all")).toBe("");

    // Seeded publication-boundary negative control: the canonical credential
    // detector refuses the durable local commit without echoing its bytes.
    const secret = createPlannerTurnWorktree(
      managed,
      stateHome,
      "git-app",
      "turn-secret",
      baseRevisionForBranch("main"),
    );
    await writeFile(join(secret.path, "LEAK.txt"), `token=${"sk-" + "abcdefghijklmnopqrstuvwx"}\n`);
    const secretTx = await prepareRealGitTransaction(stateHome, secret, "turn-secret");
    expect(secretTx).toMatchObject({
      state: "refused",
      error: { code: "error_planner_publication_secret", permanence: "permanent" },
    });
    expect(secretTx.error?.message).toContain("sk-api-key");
    expect(secretTx.error?.message).not.toContain("abcdefghijklmnopqrstuvwx");

    const protectedWorktree = createPlannerTurnWorktree(
      managed,
      stateHome,
      "git-app",
      "turn-protected-app-authority",
      baseRevisionForBranch("main"),
    );
    await mkdir(join(protectedWorktree.path, ".cormidia"), { recursive: true });
    await writeFile(join(protectedWorktree.path, ".cormidia", "AUTHORITY.md"), "human-ratified fixture\n");
    const protectedTx = await prepareRealGitTransaction(stateHome, protectedWorktree, "turn-protected-app-authority");
    expect(protectedTx).toMatchObject({
      state: "refused",
      error: { code: "error_planner_protected_surface", permanence: "permanent" },
    });
    expect(protectedTx.changed_paths).toContain(".cormidia/AUTHORITY.md");

    const wrongRemote = createPlannerTurnWorktree(
      managed,
      stateHome,
      "git-app",
      "turn-wrong-remote",
      baseRevisionForBranch("main"),
    );
    await writeFile(join(wrongRemote.path, "PLAN.md"), "must not reach an unregistered remote\n");
    const wrongRemoteTx = await prepareRealGitTransaction(
      stateHome,
      wrongRemote,
      "turn-wrong-remote",
      "fixture/not-the-managed-origin",
    );
    expect(wrongRemoteTx).toMatchObject({
      state: "refused",
      error: { code: "error_planner_publication_repository_mismatch", permanence: "permanent" },
    });
    expect(await readFile(join(operator, "README.md"), "utf8")).toBe(operatorBefore);
    expect(git(operator, "status", "--porcelain=v1", "--untracked-files=all")).toBe(operatorStatusBefore);
  });
});

const NOW = new Date("2026-08-04T12:00:00.000Z");
const APP: AppEntry = {
  name: "planner-app",
  repo: "fixture/planner-app",
  status: "live",
  budgetUsdMonth: 100,
  objectiveBudgetUsd: 1000,
  cadence: {},
  execution: { assignmentMode: "fixed", allowedAssignments: {} },
};
const DECISION: PlannerReadinessDecision = {
  issue_number: 232,
  disposition: "ready",
  reason_code: "routine_ready",
  reason: "Complete routine work with deterministic acceptance criteria.",
};

async function setup(name: string, turnId: string): Promise<World> {
  const home = await makeTempStateHome({ name: `cf-reg-232-${name}` });
  homes.push(home);
  const gh = new FakeGithub([issue()]);
  const intake = await preparePlannerIssueIntake({
    gh: gh as unknown as GhOps,
    app: APP.name,
    turnId,
  });
  const git = new FakePublicationGit();
  const providerCalls = 1;
  const transaction = await preparePlannerPublication({
    stateHome: home.stateHome,
    app: APP,
    turnId,
    worktree: home.stateHome,
    branch: turnWorktreeIdentity(home.stateHome, APP.name, turnId).branch,
    base: baseRevisionForBranch("main"),
    intake,
    decisions: [DECISION],
    episodeId: `episode:${turnId}`,
    providerRunIds: ["run-planner"],
    providerOutput: "durable Planner output",
    now: NOW,
    git,
  });
  return {
    home,
    gh,
    git,
    transaction,
    get providerCalls() {
      return providerCalls;
    },
  };
}

async function resume(world: World): Promise<PlannerPublicationTransaction> {
  return resumePlannerPublication({
    stateHome: world.home.stateHome,
    app: APP,
    publicationId: world.transaction.publication_id,
    gh: world.gh as unknown as GhOps,
    git: world.git,
    now: NOW,
  });
}

interface World {
  home: TempStateHome;
  gh: FakeGithub;
  git: FakePublicationGit;
  transaction: PlannerPublicationTransaction;
  readonly providerCalls: number;
}

class FakePublicationGit implements PlannerPublicationGit {
  remote: string | null = null;
  pushes = 0;
  permanentRefusal = false;
  remoteRefusal = false;

  prepare() {
    return {
      branchCreated: true,
      commit: "commit-planner",
      baseCommit: "commit-base",
      changedPaths: ["ROADMAP.md"],
      protectedPaths: [],
      secretPatterns: [],
    };
  }

  remoteCommit(): string | null {
    if (this.remoteRefusal) {
      throw new PermanentPlannerPublicationError(
        "error_seeded_remote_refusal",
        "seeded permanent remote discovery refusal",
      );
    }
    return this.remote;
  }

  push(_worktree: string, _branch: string, commit: string): void {
    this.pushes += 1;
    if (this.permanentRefusal) {
      throw new PermanentPlannerPublicationError(
        "error_seeded_permanent_refusal",
        `seeded permanent repository refusal for ${"sk-" + "abcdefghijklmnopqrstuvwx"}`,
      );
    }
    this.remote = commit;
  }
}

class FakeGithub {
  addCalls = 0;
  listCalls = 0;
  readonly issues: GhIssue[];

  constructor(issues: GhIssue[]) {
    this.issues = structuredClone(issues);
  }

  async listIssues(): Promise<GhIssue[]> {
    this.listCalls += 1;
    return structuredClone(this.issues);
  }

  async readIssue(number: number): Promise<GhIssue> {
    const value = this.issues.find((candidate) => candidate.number === number);
    if (value === undefined) throw new Error(`missing issue #${number}`);
    return structuredClone(value);
  }

  async addLabel(number: number, label: string): Promise<void> {
    this.addCalls += 1;
    const value = this.issues.find((candidate) => candidate.number === number)!;
    if (!value.labels.includes(label)) value.labels.push(label);
  }

  async removeLabel(number: number, label: string): Promise<void> {
    const value = this.issues.find((candidate) => candidate.number === number)!;
    value.labels = value.labels.filter((candidate) => candidate !== label);
  }
}

function issue(number = 232, title = "Make Planner publication durable"): GhIssue {
  return {
    number,
    title,
    state: "OPEN",
    labels: ["p2", "op:tier-standard"],
    body: [
      "Depends-on: none",
      "Execution group: planner-publication",
      "File scope: src/org/planner-publication.ts",
      "",
      "## Goal",
      "Publish Planner work safely.",
      "",
      "## Context",
      "Deterministic fixture.",
      "",
      "## Acceptance criteria",
      "- [ ] Publication is durable and resumable.",
      "",
      "## Scope",
      "- src/org/planner-publication.ts",
      "",
      "## Out of scope",
      "Provider-backed qualification.",
    ].join("\n"),
  };
}

function ticketPlan() {
  return {
    title: issue().title,
    tier: "op:tier-standard" as const,
    priority: "p2" as const,
    dependsOn: [],
    executionGroup: "planner-publication",
    fileScope: ["src/org/planner-publication.ts"],
    goal: "Publish Planner work safely.",
    context: "Deterministic fixture.",
    acceptanceCriteria: ["Publication is durable and resumable."],
    outOfScope: "Provider-backed qualification.",
    notesForBuilder: "Follow the accepted validation contract.",
  };
}

function assertTurnCompletionAdmissible(
  status: "completed" | "failed",
  publication: PlannerPublicationTransaction,
): void {
  if (status === "completed" && publication.state !== "published") {
    throw new Error(`completed turn has ${publication.state} publication`);
  }
}

async function prepareRealGitTransaction(
  stateHome: string,
  worktree: ReturnType<typeof createPlannerTurnWorktree>,
  turnId: string,
  repository = git(worktree.path, "remote", "get-url", "origin"),
): Promise<PlannerPublicationTransaction> {
  const app: AppEntry = { ...APP, name: "git-app", repo: repository };
  const intake = await preparePlannerIssueIntake({
    gh: { listIssues: async () => [] } as unknown as GhOps,
    app: app.name,
    turnId,
  });
  return preparePlannerPublication({
    stateHome,
    app,
    turnId,
    worktree: worktree.path,
    branch: worktree.branch,
    base: baseRevisionForBranch("main"),
    intake,
    decisions: [],
    episodeId: `episode:${turnId}`,
    providerRunIds: ["run-fixture"],
    providerOutput: "fixture",
    now: NOW,
  });
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitOptional(cwd: string, ...args: string[]): string | null {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
}
