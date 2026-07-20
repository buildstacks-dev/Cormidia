// Tests the token-free manual planning preview in src/org/plan.ts and cmdPlan.
// Covers planning context assembly, temporary planning worktree
// creation/cleanup, dry-run output, fail-closed live behavior, and sibling
// checkout resolution.
// Uses local temp git repos and mocked console output; no network, auth, real
// org state, or live wall clock is required.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import {
  assemblePlanningContext,
  cleanupPlanningWorktree,
  createPlanningWorktree,
} from "../src/org/plan.js";
import {
  cmdPlan,
  formatPlanTicketSummary,
  loadCreatorEpisodeScopeFile,
} from "../src/cli/plan.js";
import type { RoleConfig } from "../src/runtime/types.js";
import type { PlanTicket } from "../src/loop/plan-tickets.js";
import type { CreatorEpisodeScope } from "../src/loop/episode-plan.js";

const tempDirs: string[] = [];
const originalCwd = process.cwd();

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(originalCwd);
});

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function write(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function makeGitApp(withCharter = true): string {
  const root = makeDir("operon-plan-app-");
  initGitApp(root, withCharter);
  return root;
}

function makeGitAppAt(root: string, withCharter = true): string {
  mkdirSync(root, { recursive: true });
  initGitApp(root, withCharter);
  return root;
}

/** An app checkout backed by a real (local, bare) origin.
 *
 * Interactive planning fetches and resolves the remote default branch before
 * cutting its worktree (#60), so a standalone repo with no origin is no longer
 * a valid planning source. `second` is an independent checkout of the same
 * origin, used to land commits that exist ONLY on the remote — that is how a
 * stale managed clone is modelled without any network. */
interface RemoteBackedApp {
  bare: string;
  clone: string;
  second: string;
}

function makeRemoteBackedApp(defaultBranch = "main", withCharter = true): RemoteBackedApp {
  return makeRemoteBackedAppAt(makeDir("operon-plan-remote-"), defaultBranch, withCharter);
}

function makeRemoteBackedAppAt(
  cloneRoot: string,
  defaultBranch = "main",
  withCharter = true,
): RemoteBackedApp {
  const host = makeDir("operon-plan-origin-");
  const bare = join(host, "origin.git");
  execFileSync("git", ["init", "--bare", `--initial-branch=${defaultBranch}`, bare], {
    encoding: "utf8",
  });

  // Seed the default branch on origin through a throwaway checkout.
  const seed = join(host, "seed");
  execFileSync("git", ["clone", bare, seed], { encoding: "utf8" });
  git(seed, ["config", "user.email", "test@example.com"]);
  git(seed, ["config", "user.name", "Operon Test"]);
  write(seed, "README.md", "# app\n");
  if (withCharter) write(seed, ".operon/TASTE.md", "# App Charter\n\nShip small.\n");
  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "initial"]);
  git(seed, ["push", "-u", "origin", defaultBranch]);

  mkdirSync(dirname(cloneRoot), { recursive: true });
  rmSync(cloneRoot, { recursive: true, force: true });
  execFileSync("git", ["clone", bare, cloneRoot], { encoding: "utf8" });
  git(cloneRoot, ["config", "user.email", "test@example.com"]);
  git(cloneRoot, ["config", "user.name", "Operon Test"]);

  const second = join(host, "second");
  execFileSync("git", ["clone", bare, second], { encoding: "utf8" });
  git(second, ["config", "user.email", "test@example.com"]);
  git(second, ["config", "user.name", "Operon Test"]);

  return { bare, clone: cloneRoot, second };
}

function initGitApp(root: string, withCharter = true): void {
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Operon Test"]);
  write(root, "README.md", "# app\n");
  if (withCharter) write(root, ".operon/TASTE.md", "# App Charter\n\nShip small.\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
}

function makeOrgHome(appName = "operon-sandbox-alpha", budgetUsdMonth = 1000): string {
  const root = makeDir("operon-plan-org-");
  write(root, "TASTE.md", "# Org Taste\n\nBe precise.\n");
  write(
    root,
    "roles.yaml",
    `defaults:
  max_turn_budget_usd: 5
roles:
  planner:
    runtime: claude
    model: claude-opus-4-8
    effort: high
    delegation: {allow: []}
    triggers: [{manual: true}]
    outputs: [tickets]
`,
  );
  write(
    root,
    "apps.yaml",
    `org: {name: operon, max_concurrent_turns: 2}
defaults: {budget_usd_month: ${budgetUsdMonth}}
apps:
  ${appName}:
    repo: owner/${appName}
    status: onboarding
    cadence: {}
`,
  );
  write(
    root,
    "pipelines.yaml",
    "plan:\n  passes:\n    - id: plan\n      role: planner\n      template: plan.md\n",
  );
  write(root, "prompts/plan.md", "Plan the requested work.\n");
  return root;
}

const PLANNER: RoleConfig = {
  name: "planner",
  runtime: "claude",
  model: "claude-opus-4-8",
  effort: "high",
  delegation: { allow: [] },
  triggers: [{ manual: true }],
  outputs: ["tickets"],
  maxTurnBudgetUsd: 5,
};

function executionReadyCreatorScope(): CreatorEpisodeScope {
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "human",
      creatorId: "operator@example.test",
      createdAt: "2026-07-20T12:00:00.000Z",
      evidenceRefs: ["design:feature-a"],
    },
    workKind: "bounded-product-plan",
    objective: "Turn the approved Feature A design into one implementation ticket",
    inScope: ["Create the schema-valid TicketPlan for Feature A"],
    outOfScope: ["Redesign Feature A", "Publish anything except orchestrator-owned tickets"],
    acceptanceCriteria: ["The TicketPlan preserves the approved Feature A acceptance criteria"],
    expectedArtifacts: [{ id: "ticket-plan", kind: "TicketPlan", required: true }],
    declaredConstraints: { designAuthority: "design:feature-a" },
    safetyFacts: [],
    steps: [{
      kind: "provider_turn",
      id: "ticket-plan",
      operation: "plan/bootstrap",
      role: "planner",
      objective: "Render the approved creator scope as a TicketPlan",
      dependsOn: [],
      requiredCapabilities: ["structured_verdict"],
      inputRefs: [],
      expectedOutputs: [{ id: "ticket-plan", kind: "TicketPlan", required: true }],
      maxTurnBudgetUsd: 5,
      selectionReason: "The creator supplied every workflow decision except deterministic ticket rendering",
    }],
  };
}

describe("assemblePlanningContext", () => {
  it("concatenates shared context layers and keeps the topic as task text", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp(true);
    const context = await assemblePlanningContext({
      orgHome,
      appWorkdir: app,
      app: "operon-sandbox-alpha",
      role: PLANNER,
      topic: "stats percentile helper",
    });

    expect(context.systemPrompt).toContain("# Org Taste");
    expect(context.systemPrompt).toContain("# App Charter");
    expect(context.systemPrompt).toContain("## Role turn protocol");
    expect(context.systemPrompt).toContain("- tickets");
    expect(context.systemPrompt).not.toContain("stats percentile helper");
    expect(context.openingTask).toBe("Co-planning topic: stats percentile helper");
    expect(context.byteSize).toBe(Buffer.byteLength(context.systemPrompt, "utf8"));
  });

  it("omits the app charter layer when .operon/TASTE.md is absent", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp(false);
    const context = await assemblePlanningContext({
      orgHome,
      appWorkdir: app,
      app: "operon-sandbox-beta",
      role: PLANNER,
    });

    expect(context.systemPrompt).toContain("# Org Taste");
    expect(context.systemPrompt).not.toContain("App .operon/TASTE.md");
  });
});

describe("planning worktree lifecycle", () => {
  // The fixture is now a real bare+clone pair rather than a standalone repo:
  // #60 requires the interactive planning worktree to be cut from the *fetched*
  // remote default-branch tip, so a source with no remote is no longer a valid
  // input — an unfetchable source must stop the session, not launch it.
  it("creates op/plan-<slug> off the fetched default-branch tip and cleans it up", async () => {
    const { clone } = makeRemoteBackedApp("main");
    const worktree = await createPlanningWorktree(clone, {
      slug: "stats percentile helper",
      parentDir: makeDir("operon-plan-wt-"),
    });

    expect(worktree.branch).toBe("op/plan-stats-percentile-helper");
    expect(worktree.base).toEqual({ ref: "origin/main", defaultBranch: "main" });
    expect(existsSync(worktree.path)).toBe(true);
    expect(git(worktree.path, ["branch", "--show-current"]).trim()).toBe(worktree.branch);
    expect(git(worktree.path, ["rev-parse", "HEAD"]).trim()).toBe(
      git(clone, ["rev-parse", "origin/main"]).trim(),
    );

    await cleanupPlanningWorktree(worktree);
    expect(existsSync(worktree.path)).toBe(false);
    expect(git(clone, ["branch", "--list", worktree.branch]).trim()).toBe("");
  });

  // The #60 defect itself: the managed clone is behind its remote, and the
  // session used to plan against the stale local branch with nothing saying so.
  it("plans against the remote tip when the local clone is behind (#60)", async () => {
    const { bare, clone, second } = makeRemoteBackedApp("main");

    // A change lands on the remote from elsewhere; our clone never fetched it.
    write(second, "PRODUCT.md", "# shipped after the clone went stale\n");
    git(second, ["add", "."]);
    git(second, ["commit", "-m", "feat: land real product truth"]);
    git(second, ["push", "origin", "main"]);
    const remoteTip = git(second, ["rev-parse", "HEAD"]).trim();

    const staleLocal = git(clone, ["rev-parse", "main"]).trim();
    expect(staleLocal).not.toBe(remoteTip);

    const worktree = await createPlanningWorktree(clone, {
      slug: "stale check",
      parentDir: makeDir("operon-plan-wt-"),
    });

    // The session sees the remote tip, not the stale local branch...
    expect(git(worktree.path, ["rev-parse", "HEAD"]).trim()).toBe(remoteTip);
    // ...and the product truth that only exists on the remote is actually there.
    expect(existsSync(join(worktree.path, "PRODUCT.md"))).toBe(true);
    // The stale local branch is genuinely still stale — the worktree was cut
    // from the fetched remote-tracking ref, not from a silently reset branch.
    expect(git(clone, ["rev-parse", "main"]).trim()).toBe(staleLocal);
    expect(bare).toContain("origin.git");

    await cleanupPlanningWorktree(worktree);
  });

  // Non-main default branches: the hardcoded `main` failed these outright.
  for (const branch of ["master", "trunk"]) {
    it(`cuts the planning worktree from a ${branch} default branch (#60/#101)`, async () => {
      const { clone } = makeRemoteBackedApp(branch);
      const worktree = await createPlanningWorktree(clone, {
        slug: `plan on ${branch}`,
        parentDir: makeDir("operon-plan-wt-"),
      });

      expect(worktree.base).toEqual({ ref: `origin/${branch}`, defaultBranch: branch });
      expect(git(worktree.path, ["rev-parse", "HEAD"]).trim()).toBe(
        git(clone, ["rev-parse", `origin/${branch}`]).trim(),
      );

      await cleanupPlanningWorktree(worktree);
    });
  }

  // Fail safely: no stale worktree may be launched when the remote is
  // unreachable or the default branch cannot be resolved.
  it("refuses to launch a session when the remote cannot be resolved", async () => {
    const orphan = makeGitApp();
    const parentDir = makeDir("operon-plan-wt-");

    await expect(
      createPlanningWorktree(orphan, { slug: "no remote", parentDir }),
    ).rejects.toThrow(/plan: cannot resolve the default branch/i);

    // Nothing half-built was left behind for an operator to wander into.
    expect(existsSync(join(parentDir, "op-plan-no-remote"))).toBe(false);
    expect(git(orphan, ["branch", "--list", "op/plan-no-remote"]).trim()).toBe("");
  });

  it("refuses to launch a session when the fetch fails", async () => {
    const { clone } = makeRemoteBackedApp("main");
    // Point origin at a path that no longer exists: resolution and fetch both
    // fail, and the failure must surface before any worktree is created.
    git(clone, ["remote", "set-url", "origin", join(makeDir("operon-plan-gone-"), "missing.git")]);
    const parentDir = makeDir("operon-plan-wt-");

    await expect(
      createPlanningWorktree(clone, { slug: "dead remote", parentDir }),
    ).rejects.toThrow(/plan:/i);
    expect(git(clone, ["branch", "--list", "op/plan-dead-remote"]).trim()).toBe("");
  });
});

describe("cmdPlan", () => {
  it("console ticket summaries show final tier, requested tier, and escalation reason", () => {
    const ticket: PlanTicket = {
      title: "Store submissions",
      tier: "op:tier-deep",
      priority: "p1",
      dependsOn: [],
      executionGroup: "storage",
      fileScope: ["src/storage.ts"],
      goal: "Store user data",
      context: "Contact form",
      acceptanceCriteria: ["submissions persist"],
      outOfScope: "analytics",
      notesForBuilder: "bounded",
    };
    const line = formatPlanTicketSummary(0, ticket, {
      index: 0,
      ticket,
      requestedTier: "op:tier-standard",
      finalTier: "op:tier-deep",
      escalationReason: "sensitive-domain floor: data",
      domainLabels: ["domain:data"],
      labels: ["op:tier-deep", "p1", "domain:data", "op:ready"],
      ready: true,
    });
    expect(line).toContain("[op:tier-deep/p1]");
    expect(line).toContain("requested op:tier-standard");
    expect(line).toContain("sensitive-domain floor: data");
  });

  it("auto dry-run previews EpisodePlanner authority without calling a runtime", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp();
    process.chdir(orgHome);
    const stateHome = makeDir("operon-plan-auto-dry-state-");
    const before = git(app, ["status", "--porcelain=v2", "--branch"]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--auto",
      "--goal",
      "add one bounded helper",
      "--dry-run",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ]);

    expect(code).toBe(0);
    expect(log.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
      "dry-run",
    );
    const out = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(out).toContain("assignment mode: fixed");
    expect(out).toContain("planning path: episode_planner_provider_turn");
    expect(out).toContain("cannot claim the exact provider-authored EpisodePlan");
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
    expect(existsSync(join(stateHome, "telemetry"))).toBe(false);
    expect(git(app, ["status", "--porcelain=v2", "--branch"])).toBe(before);
  });

  it("loads JSON and YAML creator-scope transports through the same strict schema", async () => {
    const scope = executionReadyCreatorScope();
    const root = makeDir("operon-plan-creator-scope-files-");
    const jsonPath = join(root, "scope.json");
    const yamlPath = join(root, "scope.yaml");
    writeFileSync(jsonPath, `${JSON.stringify(scope, null, 2)}\n`);
    writeFileSync(yamlPath, stringifyYaml(scope));

    await expect(loadCreatorEpisodeScopeFile(jsonPath)).resolves.toEqual(scope);
    await expect(loadCreatorEpisodeScopeFile(yamlPath)).resolves.toEqual(scope);
  });

  it("previews an explicit YAML creator scope without --auto, --goal, runtime, or durable writes", async () => {
    const orgHome = makeOrgHome("operon-sandbox-alpha", 6);
    const app = makeGitApp();
    const stateHome = makeDir("operon-plan-creator-dry-state-");
    const scope = executionReadyCreatorScope();
    const scopePath = join(makeDir("operon-plan-creator-input-"), "scope.yaml");
    writeFileSync(scopePath, stringifyYaml(scope));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--creator-scope",
      scopePath,
      "--execution-ready",
      "--dry-run",
      "--json",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ]);

    expect(code).toBe(0);
    const parsed = JSON.parse(log.mock.calls.map((call) => call.join(" ")).join("\n")) as {
      request: string;
      goal: string;
      effects: unknown[];
      episode: {
        planningPath: string;
        creatorScope: { executionReady: boolean; issues: unknown[] };
        plannerBoot: { providerTurnRequired: boolean };
        intent: {
          creatorScope: CreatorEpisodeScope;
          hardBudget: { maxEquivalentCostUsd: number };
        };
      };
    };
    expect(parsed.request).toBe("creator-scope-dry-run");
    expect(parsed.goal).toBe(scope.objective);
    expect(parsed.episode.planningPath).toBe("creator_scope_normalization");
    expect(parsed.episode.creatorScope).toMatchObject({ executionReady: true, issues: [] });
    expect(parsed.episode.plannerBoot.providerTurnRequired).toBe(false);
    expect(parsed.episode.intent.creatorScope.provenance).toEqual(scope.provenance);
    expect(parsed.episode.intent.hardBudget.maxEquivalentCostUsd).toBe(6);
    expect(parsed.effects).toEqual([]);
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
    expect(existsSync(join(stateHome, "telemetry"))).toBe(false);
  });

  it("requires --creator-scope and --execution-ready together instead of inferring intent", async () => {
    const scopePath = join(makeDir("operon-plan-creator-flags-"), "scope.json");
    writeFileSync(scopePath, `${JSON.stringify(executionReadyCreatorScope())}\n`);

    await expect(cmdPlan([
      "fixture",
      "--creator-scope",
      scopePath,
      "--dry-run",
    ])).rejects.toThrow(/--creator-scope requires --execution-ready.*never inferred/);
    await expect(cmdPlan([
      "fixture",
      "--execution-ready",
      "--dry-run",
    ])).rejects.toThrow(/--execution-ready requires --creator-scope/);
    await expect(cmdPlan([
      "fixture",
      "--creator-scope",
      scopePath,
      "--execution-ready",
      "--goal",
      "A conflicting objective",
    ])).rejects.toThrow(/--goal must exactly match the authoritative --creator-scope objective/);
  });

  it("rejects a disposition mismatch before resolving an org or constructing a provider", async () => {
    const scope = executionReadyCreatorScope();
    scope.planningDisposition = "planner_input";
    const scopePath = join(makeDir("operon-plan-creator-disposition-"), "scope.json");
    writeFileSync(scopePath, `${JSON.stringify(scope)}\n`);

    await expect(cmdPlan([
      "fixture",
      "--creator-scope",
      scopePath,
      "--execution-ready",
    ])).rejects.toThrow(/planningDisposition: execution_ready; received planner_input/);
  });

  it("rejects incomplete execution-ready scope with field-level diagnostics and no provider evidence", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp();
    const stateHome = makeDir("operon-plan-creator-incomplete-state-");
    const scope = executionReadyCreatorScope();
    scope.acceptanceCriteria = [];
    const scopePath = join(makeDir("operon-plan-creator-incomplete-"), "scope.yaml");
    writeFileSync(scopePath, stringifyYaml(scope));

    await expect(cmdPlan([
      "operon-sandbox-alpha",
      "--creator-scope",
      scopePath,
      "--execution-ready",
      "--dry-run",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ])).rejects.toThrow(/creator_scope_acceptance_required.*will not infer readiness or silently invoke EpisodePlanner/);
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
    expect(existsSync(join(stateHome, "telemetry"))).toBe(false);
  });

  it("applies the live product-planning operation and terminal-output contract during dry-run", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp();
    const stateHome = makeDir("operon-plan-creator-domain-state-");
    const root = makeDir("operon-plan-creator-domain-");
    const invented = executionReadyCreatorScope();
    const inventedStep = invented.steps![0]!;
    if (inventedStep.kind !== "provider_turn") throw new Error("fixture step must be provider turn");
    inventedStep.operation = "plan/invented";
    const inventedPath = join(root, "invented.yaml");
    writeFileSync(inventedPath, stringifyYaml(invented));

    await expect(cmdPlan([
      "operon-sandbox-alpha",
      "--creator-scope",
      inventedPath,
      "--execution-ready",
      "--dry-run",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ])).rejects.toThrow(/planning_provider_operation_unknown.*no provider was constructed/);

    const wrongArtifact = executionReadyCreatorScope();
    const wrongArtifactStep = wrongArtifact.steps![0]!;
    if (wrongArtifactStep.kind !== "provider_turn") throw new Error("fixture step must be provider turn");
    wrongArtifactStep.expectedOutputs = [{ id: "ticket-plan", kind: "planning-artifact", required: true }];
    const wrongArtifactPath = join(root, "wrong-artifact.json");
    writeFileSync(wrongArtifactPath, `${JSON.stringify(wrongArtifact)}\n`);

    await expect(cmdPlan([
      "operon-sandbox-alpha",
      "--creator-scope",
      wrongArtifactPath,
      "--execution-ready",
      "--dry-run",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ])).rejects.toThrow(/planning_ticket_plan_output_invalid.*no provider was constructed/);
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
    expect(existsSync(join(stateHome, "telemetry"))).toBe(false);
  });

  it("auto dry-run does not turn explicit risk hints into a guessed workflow", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const stateHome = makeDir("operon-plan-security-dry-state-");

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--auto",
      "--goal",
      "Migrate auth keys",
      "--depth",
      "quick",
      "--work-lifecycle",
      "bounded-goal",
      "--sensitive-domains",
      "auth,secrets,data-migration,production-deployment,performance,user-data",
      "--dry-run",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ]);

    expect(code).toBe(0);
    const out = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(out).toContain("planning path: episode_planner_provider_turn");
    expect(out).toContain(
      "required safety facts: authentication, data_migration, performance_sensitive, production_deployment, secrets",
    );
    expect(out).not.toContain("planning depth:");
    expect(out).not.toContain("selected passes:");
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
  });

  it("does not derive safety authority from a sensitive-looking goal", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const stateHome = makeDir("operon-plan-prose-safety-state-");

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--auto",
      "--goal",
      "Migrate auth secrets to production with a faster incident rollback",
      "--dry-run",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ]);

    expect(code).toBe(0);
    const out = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(out).toContain("required safety facts: none");
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
  });

  it("JSON dry-run never infers an existing-ticket planner bypass", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const stateHome = makeDir("operon-plan-direct-json-state-");

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--auto",
      "--goal",
      "Issue #7 already has file scope and binary criteria",
      "--work-lifecycle",
      "existing-ticket",
      "--dry-run",
      "--json",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ]);

    expect(code).toBe(0);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    const parsed = JSON.parse(output) as {
      episode: {
        planningPath: string;
        exactProviderAuthoredPlan: unknown;
        creatorScope: { executionReady: boolean; issues: Array<{ code: string }> };
      };
      effects: unknown[];
    };
    expect(parsed.episode.planningPath).toBe("episode_planner_provider_turn");
    expect(parsed.episode.exactProviderAuthoredPlan).toBeNull();
    expect(parsed.episode.creatorScope.executionReady).toBe(false);
    expect(parsed.episode.creatorScope.issues).toEqual([
      expect.objectContaining({ code: "creator_scope_absent" }),
    ]);
    expect(parsed.effects).toEqual([]);
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
  });

  it("dry-run derives its ceiling from current ledger spend, not the full monthly budget", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const stateHome = makeDir("operon-plan-budget-preview-state-");
    const month = new Date().toISOString().slice(0, 7);
    write(
      stateHome,
      `telemetry/${month}-01.jsonl`,
      `${JSON.stringify({ app: "operon-sandbox-alpha", costUsd: 125 })}\n`,
    );

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--auto",
      "--goal",
      "ship the bounded change",
      "--dry-run",
      "--json",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ]);

    expect(code).toBe(0);
    const parsed = JSON.parse(log.mock.calls.map((call) => call.join(" ")).join("\n")) as {
      budget: { monthlyUsd: number; spentUsd: number; remainingUsd: number; status: string };
      episode: { intent: { hardBudget: { maxEquivalentCostUsd: number } } };
    };
    expect(parsed.budget).toEqual({
      monthlyUsd: 1000,
      spentUsd: 125,
      remainingUsd: 875,
      status: "ok",
    });
    expect(parsed.episode.intent.hardBudget.maxEquivalentCostUsd).toBeLessThan(875);
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
  });

  it("auto dry-run preserves repeatable required and optional planning-source declarations", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const stateHome = makeDir("operon-plan-sources-json-state-");

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--auto",
      "--goal",
      "ship the supplied design",
      "--work-lifecycle",
      "bounded-goal",
      "--source",
      "docs/spec.md",
      "--optional-source",
      "/tmp/research.md",
      "--dry-run",
      "--json",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ]);

    expect(code).toBe(0);
    const parsed = JSON.parse(log.mock.calls.map((call) => call.join(" ")).join("\n")) as {
      planningSources: Array<{ path: string; requirement: string }>;
    };
    expect(parsed.planningSources).toEqual([
      { path: "docs/spec.md", requirement: "required" },
      { path: "/tmp/research.md", requirement: "optional" },
    ]);
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
  });

  it("rejects --auto combined with --explain-route loudly instead of silently dropping the plan (L-008)", async () => {
    // The live campaign ran the documented `--auto --goal … --explain-route`
    // combination: exit 0, route JSON, zero tickets, zero spend, no warning.
    // A guard that cannot honor both instructions must not silently pick one.
    const orgHome = makeOrgHome();
    const stateHome = makeDir("operon-plan-explain-auto-state-");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      cmdPlan([
        "operon-sandbox-alpha",
        "--auto",
        "--goal",
        "ship the deliverable",
        "--explain-route",
        "--org-home",
        orgHome,
        "--state-home",
        stateHome,
      ]),
    ).rejects.toThrow(/--explain-route.*--auto|--auto.*--explain-route/);
    // Nothing was printed as if planning (or a preview) had happened.
    expect(log).not.toHaveBeenCalled();
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
  });

  it("--explain-route without --auto still prints the token-free route preview", async () => {
    const orgHome = makeOrgHome();
    const stateHome = makeDir("operon-plan-explain-state-");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--explain-route",
      "--goal",
      "ship the deliverable",
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ]);

    expect(code).toBe(0);
    const out = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(out).toContain('"kind": "episode-planning-preview"');
    expect(out).toContain('"request": "explain-route"');
    expect(out).toContain('"exactProviderAuthoredPlan": null');
    expect(out).toContain("cannot claim the exact provider-authored EpisodePlan");
    expect(out).not.toContain('"selectedPasses"');
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
  });

  it("fails closed before worktree or telemetry creation for the retired native interactive path", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp();
    const stateHome = makeDir("operon-plan-disabled-live-state-");
    const before = git(app, ["status", "--porcelain=v2", "--branch"]);

    await expect(cmdPlan([
      "operon-sandbox-alpha",
      "--topic",
      "stats percentile helper",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ])).rejects.toThrow(/live interactive co-planning is disabled.*--auto --goal/s);

    expect(git(app, ["branch", "--list", "op/plan-stats-percentile-helper"]).trim()).toBe("");
    expect(git(app, ["status", "--porcelain=v2", "--branch"])).toBe(before);
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
    expect(existsSync(join(stateHome, "telemetry"))).toBe(false);
  });

  it("dry-run prints app, branch, topic, and context byte size without spawning", async () => {
    const orgHome = makeOrgHome();
    // Remote-backed: planning now fetches and resolves the default branch
    // before cutting its worktree (#60), so the source needs a real origin.
    const app = makeRemoteBackedApp().clone;
    process.chdir(orgHome);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--topic",
      "stats percentile helper",
      "--dry-run",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      makeDir("operon-plan-state-"),
    ]);

    expect(code).toBe(0);
    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("plan app: operon-sandbox-alpha");
    expect(out).toContain("branch: op/plan-stats-percentile-helper");
    expect(out).toContain("topic: stats percentile helper");
    expect(out).toMatch(/context bytes: \d+/);
    expect(git(app, ["branch", "--list", "op/plan-stats-percentile-helper"]).trim()).toBe("");
  });

  it("dry-run resolves a sibling app checkout when --workdir is omitted", async () => {
    const parent = makeDir("operon-plan-parent-");
    const orgHome = join(parent, "Operon");
    mkdirSync(orgHome, { recursive: true });
    write(orgHome, "TASTE.md", "# Org Taste\n\nBe precise.\n");
    write(
      orgHome,
      "roles.yaml",
      `defaults:
  max_turn_budget_usd: 5
roles:
  planner:
    runtime: claude
    model: claude-opus-4-8
    effort: high
    delegation: {allow: []}
    triggers: [{manual: true}]
    outputs: [tickets]
`,
    );
    write(
      orgHome,
      "pipelines.yaml",
      "plan:\n  passes:\n    - id: plan\n      role: planner\n      template: plan.md\n",
    );
    write(orgHome, "prompts/plan.md", "Plan the requested work.\n");
    write(
      orgHome,
      "apps.yaml",
      `org: {name: operon, max_concurrent_turns: 2}
defaults: {budget_usd_month: 1000}
apps:
  operon-sandbox-alpha:
    repo: owner/operon-sandbox-alpha
    status: onboarding
    cadence: {}
`,
    );
    // The sibling checkout is discovered by path, but it is still a planning
    // source and so still needs a resolvable origin (#60).
    const app = makeRemoteBackedAppAt(join(parent, "operon-sandbox-alpha")).clone;
    process.chdir(orgHome);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--dry-run",
      "--org-home",
      orgHome,
      "--state-home",
      makeDir("operon-plan-sibling-state-"),
    ]);

    expect(code).toBe(0);
    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("plan app: operon-sandbox-alpha");
    expect(out).toContain("branch: op/plan-operon-sandbox-alpha");
    expect(git(app, ["branch", "--list", "op/plan-operon-sandbox-alpha"]).trim()).toBe("");
  });
});
