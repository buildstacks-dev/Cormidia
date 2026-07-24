// End-to-end regression coverage for #101: the discovered default branch must
// reach EVERY execution path, not just the resolver that discovered it.
//
// The campaign failure this pins: a fresh private repo whose default branch was
// `master` (a stock `git init` with no `init.defaultBranch`) reached its first
// ticket tick and died with `fatal: ambiguous argument 'origin/main': unknown
// revision`. Discovery was already correct — the resolved value was dropped, and
// claim / gates / review / ship each fell back to a hardcoded `origin/main` or
// `main`. `test/loop/default-branch.test.ts` covers the resolver and a source
// grep guard; this file covers the behavior those two cannot: the value actually
// travelling through the real pass machinery against real git.
//
// Every case is parameterized over `main`, `master`, and `trunk`.
//   - `main` is the CONTROL. It must pass on the old code too; if a case is red
//     for `main` the fixture is broken, not the product.
//   - `master` and `trunk` are the regression. Under the old hardcodes each one
//     dies inside git (`origin/main` does not exist in these repos at all — the
//     `no origin/main` guards below prove that), or opens a PR into a branch the
//     repo does not have. `trunk` is present because a fix that special-cased
//     `master` would pass two thirds of this file and still be wrong.
//
// Real git via the shared bare+clone fixture, FakeRuntime-style scripted turns,
// FakeGhOps for the GitHub half. No network, no auth, no provider calls, no real
// clock dependence.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { baseRevisionForBranch } from "../../src/loop/default-branch.js";
import { runLoopOnce } from "../../src/loop/driver.js";
import type { CreatorEpisodeScope } from "../../src/loop/episode-plan.js";
import type {
  CreatePrInput,
  GhPullRequest,
  ListPullRequestOptions,
  SquashMergeInput,
} from "../../src/loop/github.js";
import {
  advanceGates,
  advanceReviewing,
  advanceShipping,
  claimTicket,
  parseAcceptanceCriteria,
  runBuilderPipeline,
  runReviewPipeline,
  type LoopItem,
} from "../../src/loop/loop.js";
import { loadPipelines, type PipelinesFile } from "../../src/loop/pipelines.js";
import type { Policy } from "../../src/loop/policy.js";
import { createTicketEpisodeRuntime } from "../../src/org/ticket-episode-runtime.js";
import type { RoleConfig, Runtime, TurnHooks, TurnRequest, TurnResult } from "../../src/runtime/types.js";
import { makeBareWithClone, type BareCloneFixture } from "../fixtures/gitRepo.js";
import { makeOrgHome } from "../fixtures/orgHome.js";
import { FakeGhOps, type FakeGhIssueSeed } from "../support/fakeGhOps.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PROMPTS_DIR = join(REPO_ROOT, "prompts");

/** The branches under test. `main` is the control that proves these cases are
 *  not trivially green; `trunk` defeats a fix that only special-cases `master`. */
const DEFAULT_BRANCHES = ["main", "master", "trunk"] as const;

const ISSUE_BODY = [
  "## Goal",
  "Ship a small fixture change.",
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
  "Add the requested fixture change.",
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

const APPROVE = [
  "Verdict: approve",
  "",
  "## Review rationale",
  "The exact diff satisfies the fixture ticket.",
  "",
  "## Evidence",
  "- fixture behavior => the named test passes at the reviewed head",
  "",
  "## Not reviewed",
  "- None.",
].join("\n");
const FINDING =
  "- testing/major test/change.test.ts:1 -- missing coverage -> add the regression\nVerdict: findings";
const DONE = "Verdict: done";

/** The contract's AC1 -> test mapping, supplied directly on the paths that call
 *  `advanceGates` without first running a contract pass. */
const CRITERION_TESTS = { AC1: ["loop-driver"] };

// ---------------------------------------------------------------------------
// GitHub fake that can model a non-`main` origin
// ---------------------------------------------------------------------------

/** `FakeGhOps.squashMerge` drives real git through hardcoded `main` refs
 *  (`git checkout main`, `reset --hard origin/main`, `push origin main`). That
 *  is test-support plumbing, not product code, but it makes the stock fake
 *  structurally incapable of modelling a `master`/`trunk` origin — the merge
 *  would fail inside the fake before the product path under test was reached.
 *
 *  This subclass performs the merge against the branch under test instead. It
 *  is deliberately constructed WITHOUT `cloneRoot`, so the inherited merge
 *  helper does no git of its own and only keeps the fake's GitHub-side
 *  bookkeeping (call log, PR state, `Closes #N` issue closure). Product code
 *  still sees nothing but the ordinary `GhOps` surface, and `base` still
 *  arrives from the product — this class never supplies it. */
class DefaultBranchGhOps extends FakeGhOps {
  private readonly cloneDir: string;
  private readonly defaultBranch: string;

  constructor(cloneDir: string, defaultBranch: string, issues: FakeGhIssueSeed[]) {
    super({ issues });
    this.cloneDir = cloneDir;
    this.defaultBranch = defaultBranch;
  }

  /** Stamp the PR with the branch's REAL head sha. Without `cloneRoot` the base
   *  class would invent `fake-<branch>`, and the review-freshness gate (which
   *  compares the approval's commit id against the worktree head) would reject
   *  every approval — masking the branch behavior these tests exist to check. */
  override async createPR(input: CreatePrInput): Promise<GhPullRequest> {
    const pr = await super.createPR(input);
    const headRefOid = git(this.cloneDir, "rev-parse", input.head);
    this.setPrHead(pr.number, headRefOid);
    return { ...pr, headRefOid };
  }

  /** Real `gh pr list --json headRefOid` reports the head BRANCH's current tip,
   *  recomputed on every read. The fake instead stamps `headRefOid` once, at PR
   *  creation, and never moves it — so any later commit on the ticket branch
   *  (the review fix cycle commits one) leaves the fake frozen at the pre-fix
   *  sha. `ensurePr` correctly fails closed when gate evidence is bound to a
   *  revision the PR head does not carry (#180), so a frozen fake fails a
   *  product check that real `gh` would pass. Re-project the head from the
   *  branch ref on every read to match the real reporter.
   *
   *  Deliberately local to this subclass: `test/loop.test.ts` pins a synthetic
   *  head on the shared fake to exercise that same fail-closed path, and an
   *  unconditional refresh there would clobber it. */
  private branchHead(branch: string): string | undefined {
    try {
      return git(this.cloneDir, "rev-parse", branch);
    } catch {
      return undefined;
    }
  }

  private refresh(pr: GhPullRequest): GhPullRequest {
    const oid = this.branchHead(pr.headRefName);
    if (oid === undefined) return pr;
    if (oid !== pr.headRefOid) this.setPrHead(pr.number, oid);
    return { ...pr, headRefOid: oid };
  }

  override async listPRsForBranch(
    branch: string,
    options?: ListPullRequestOptions,
  ): Promise<GhPullRequest[]> {
    return (await super.listPRsForBranch(branch, options)).map((pr) => this.refresh(pr));
  }

  override async readPR(selector: number | string): Promise<GhPullRequest> {
    return this.refresh(await super.readPR(selector));
  }

  override async squashMerge(prNumber: number, input: SquashMergeInput): Promise<GhPullRequest> {
    const pr = await super.readPR(prNumber);
    git(this.cloneDir, "fetch", "origin", pr.headRefName);
    git(this.cloneDir, "checkout", this.defaultBranch);
    git(this.cloneDir, "reset", "--hard", `origin/${this.defaultBranch}`);
    git(this.cloneDir, "merge", "--squash", `origin/${pr.headRefName}`);
    git(this.cloneDir, "commit", "-m", input.subject, ...(input.body === undefined ? [] : ["-m", input.body]));
    git(this.cloneDir, "push", "origin", this.defaultBranch);
    const merged = await super.squashMerge(prNumber, input);
    return { ...merged, mergeCommitOid: git(this.cloneDir, "rev-parse", "HEAD") };
  }

  override async deleteBranch(branch: string): Promise<void> {
    await super.deleteBranch(branch);
    git(this.cloneDir, "push", "origin", "--delete", branch);
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface Harness {
  pair: BareCloneFixture;
  gh: DefaultBranchGhOps;
  worktreeRoot: string;
  cleanup(): void;
}

function harness(defaultBranch: string, title: string): Harness {
  const pair = makeBareWithClone(defaultBranch);
  const gh = new DefaultBranchGhOps(pair.clone.root, defaultBranch, [
    { number: 1, title, body: ISSUE_BODY, labels: ["op:ready"] },
  ]);
  return {
    pair,
    gh,
    worktreeRoot: join(pair.root, "worktrees"),
    cleanup: () => pair.cleanup(),
  };
}

async function claim(h: Harness, defaultBranch: string): Promise<LoopItem> {
  return claimTicket(await h.gh.readIssue(1), {
    gh: h.gh,
    targetRepo: "fixture/repo",
    base: baseRevisionForBranch(defaultBranch),
    localRepo: h.pair.clone.root,
    worktreeRoot: h.worktreeRoot,
  });
}

/** Assert the repo genuinely has no `main` to fall back on. This is what makes
 *  the `master`/`trunk` rows meaningful: any surviving `origin/main` literal on
 *  the path under test fails here with the campaign's exact git error rather
 *  than quietly resolving to a real branch. */
function expectNoMainToFallBackOn(pair: BareCloneFixture, defaultBranch: string): void {
  if (defaultBranch === "main") return;
  expect(() => pair.clone.git("rev-parse", "--verify", "origin/main")).toThrow();
  expect(pair.bare.git("branch", "--list").split("\n").map((line) => line.replace(/^[* ]+/, "")))
    .not.toContain("main");
}

/** The single recorded `createPR` input — the authoritative answer to "what did
 *  the loop open the pull request into". */
function createPrBase(gh: FakeGhOps): unknown {
  const calls = gh.calls.filter((call) => call.op === "createPR");
  expect(calls).toHaveLength(1);
  return calls[0]?.detail["base"];
}

// ---------------------------------------------------------------------------
// Roles / pipelines / policy / runtime
// ---------------------------------------------------------------------------

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

async function rootPipelines(): Promise<PipelinesFile> {
  return loadPipelines(join(REPO_ROOT, "pipelines.yaml"), {
    roleNames: Object.keys(ROLES),
    promptsDir: PROMPTS_DIR,
  });
}

/** `auth/**` is high risk, which selects the full gate set AND the
 *  security-deep review dimension — both computed from the diff against the
 *  resolved base, so a wrong base changes the observable pass selection. */
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

/** A runtime that answers by role and pass rather than by a fixed script, so a
 *  legitimate extra pass (security-deep, a remediation fix) can never exhaust
 *  the queue and turn a branch-propagation defect into a confusing
 *  "no scripted turn left" failure. Implement/fix passes commit a *distinct*
 *  change each time so git always has something to commit. */
function loopRuntime(options: { reviewerVerdicts?: string[] } = {}): {
  runtime: Runtime;
  tasks(): string[];
} {
  const reviewerVerdicts = [...(options.reviewerVerdicts ?? [])];
  const tasks: string[] = [];
  let edits = 0;
  const runtime: Runtime = {
    kind: "claude",
    async runTurn(req: TurnRequest): Promise<TurnResult> {
      tasks.push(req.task);
      if (req.role.name === "builder") {
        if (req.task.includes("# Pass: implement") || req.task.includes("# Pass: fix")) {
          edits += 1;
          commit(req.workdir, `feat: fixture change ${edits}`, {
            "auth/change.ts": `export const revision = ${edits};\n`,
          });
          return turnResultOf(DONE);
        }
        return turnResultOf(CONTRACT);
      }
      if (req.role.name === "reviewer") {
        // ship-check is a reviewer pass too; only the review pipeline consumes
        // the scripted verdicts, so ship-check always approves.
        if (req.task.includes("# Pass: ship-check")) return turnResultOf(APPROVE);
        return turnResultOf(reviewerVerdicts.shift() ?? APPROVE);
      }
      throw new Error(`unexpected role in fixture: ${req.role.name}`);
    },
  };
  return { runtime, tasks: () => tasks };
}

function allowAllHooks(): TurnHooks {
  return { gate: () => ({ allow: true }) };
}

/** Give the full-driver rows explicit, durable workflow authority. The
 * creator-authored scope is intentionally complete, so these branch-focused
 * tests skip only the redundant planner provider turn; the production ticket
 * DAG executor still owns every real provision/build/gate/review/ship step. */
function ticketEpisodeFixture(
  stateHome: string,
  gh: DefaultBranchGhOps,
  runtime: Runtime,
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
    commands: { testCommand: "true", lintCommand: "true" },
    hooks: allowAllHooks(),
    runtimeForAssignment: (assignment) => ({
      kind: assignment.harness,
      runTurn: runtime.runTurn.bind(runtime),
    }),
    plannerContext: { taste: ["default-branch fixture"], memoryExcerpts: [] },
    remainingBudgetUsd: 100,
    creatorScopeForTicket: () => completeTicketCreatorScope("default-branch-parent"),
    now: () => new Date("2026-07-19T22:00:00.000Z"),
  });
  return { roles, ...callbacks };
}

function completeTicketCreatorScope(creatorId: string): CreatorEpisodeScope {
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
      creatorId,
      createdAt: "2026-07-19T21:59:00.000Z",
      evidenceRefs: ["test:default-branch:ticket-plan"],
    },
    objective: "Implement, independently review, and merge the bounded ticket",
    inScope: ["the selected ticket and its declared file scope"],
    outOfScope: ["unrelated repository work"],
    acceptanceCriteria: ["all gates and independent review pass before merge"],
    expectedArtifacts: [output("merge", "mechanical-evidence")],
    declaredConstraints: { networkAccess: false },
    safetyFacts: [{
      kind: "independent_review",
      evidenceRefs: ["test:default-branch:review"],
    }],
    steps,
  };
}

// ---------------------------------------------------------------------------
// The parameterized suite
// ---------------------------------------------------------------------------

for (const defaultBranch of DEFAULT_BRANCHES) {
  const control = defaultBranch === "main" ? " (control)" : "";

  describe(`#101 default branch \`${defaultBranch}\`${control}`, () => {
    // Path 1 — first build. `claimTicket` relabels the issue op:building BEFORE
    // it cuts the worktree, so the old `git worktree add -b <branch> <path> main`
    // stranded the ticket in op:building with an unreadable git error and no
    // branch at all.
    it("claimTicket cuts the ticket branch from the resolved base", async () => {
      const h = harness(defaultBranch, "Claim From Resolved Base");
      try {
        expectNoMainToFallBackOn(h.pair, defaultBranch);

        const item = await claim(h, defaultBranch);
        const worktree = item.worktree as string;

        expect(item.branch).toBe("op/1-claim-from-resolved-base");
        expect(item.phase).toBe("building");
        // The worktree starts exactly at the resolved base's tip.
        expect(git(worktree, "rev-parse", "HEAD")).toBe(
          h.pair.clone.git("rev-parse", `origin/${defaultBranch}`),
        );
        // ...and the branch really was cut, not left behind by a swallowed error.
        expect(git(worktree, "rev-parse", "--abbrev-ref", "HEAD")).toBe(item.branch);
        expect((await h.gh.readIssue(1)).labels).toContain("op:building");
      } finally {
        h.cleanup();
      }
    });

    // Path 2 — quality gates. `runGateSet` computes changed files with
    // `git diff --name-only <base.ref> HEAD`; the old hardcoded `origin/main`
    // threw `fatal: ambiguous argument` here, after the branch had already been
    // built. The observable proof the diff resolved is the risk tier: only a
    // real `auth/change.ts` in the changed set selects the `high` gate set.
    it("the gate diff resolves changed files against the resolved base", async () => {
      const h = harness(defaultBranch, "Gate Diff Base");
      try {
        const item = await claim(h, defaultBranch);
        commit(item.worktree as string, "feat: gated change", {
          "auth/change.ts": "export const changed = true;\n",
        });

        const gated = await advanceGates(item, {
          gh: h.gh,
          base: baseRevisionForBranch(defaultBranch),
          policy: policy(),
          commands: { testCommand: "true", lintCommand: "true" },
          criteria: parseAcceptanceCriteria(item.body),
          criterionTests: CRITERION_TESTS,
        });

        expect(gated.phase).toBe("reviewing");
        const result = gated.gateResults[0];
        expect(result?.status).toBe("pass");
        // `high` is only reachable through a diff that actually listed
        // auth/change.ts — an empty or unresolvable diff cannot produce it.
        expect(result?.tier).toBe("high");
        expect(result?.results.map((gate) => gate.gate).sort()).toEqual([
          "completeness",
          "lint",
          "review-freshness",
          "security",
          "tests",
        ]);
      } finally {
        h.cleanup();
      }
    });

    // Path 4 (asserted where it happens) — the pull request is opened by the
    // gate phase's `ensurePr`, which previously passed a literal `base: "main"`.
    // GitHub rejects that in a `master` repo *after* the branch is pushed, so
    // the ticket ended up with a pushed branch and no PR.
    it("opens the pull request into the resolved default branch, never main", async () => {
      const h = harness(defaultBranch, "PR Base Branch");
      try {
        const item = await claim(h, defaultBranch);
        commit(item.worktree as string, "feat: pr base change", {
          "auth/change.ts": "export const changed = true;\n",
        });

        const gated = await advanceGates(item, {
          gh: h.gh,
          base: baseRevisionForBranch(defaultBranch),
          policy: policy(),
          commands: { testCommand: "true", lintCommand: "true" },
          criteria: parseAcceptanceCriteria(item.body),
          criterionTests: CRITERION_TESTS,
        });

        expect(gated.prNumber).toBeDefined();
        expect(createPrBase(h.gh)).toBe(defaultBranch);
        expect((await h.gh.readPR(gated.prNumber as number)).baseRefName).toBe(defaultBranch);
        if (defaultBranch !== "main") expect(createPrBase(h.gh)).not.toBe("main");
      } finally {
        h.cleanup();
      }
    });

    // Path 3 — review, then the fix cycle back through the builder. Both
    // pipelines select their passes from `passSelectionForItem`, which diffs
    // against `base.ref`; under the old code the review pipeline threw before
    // any reviewer turn ran. The `security-deep` pass is the observable
    // consequence of a correctly-resolved diff (auth/** matched the security
    // dimension), so this assertion cannot pass on an empty diff either.
    it("review and the fix cycle select passes from a diff against the resolved base", async () => {
      const h = harness(defaultBranch, "Review Fix Cycle");
      const home = makeOrgHome({ runs: { apps: ["fixture"] } });
      const probe = loopRuntime({ reviewerVerdicts: [FINDING, APPROVE] });
      try {
        const pipelines = await rootPipelines();
        const item = await claim(h, defaultBranch);
        commit(item.worktree as string, "feat: reviewable change", {
          "auth/change.ts": "export const changed = true;\n",
        });
        const engineOptions = {
          gh: h.gh,
          pipelines,
          roles: ROLES,
          runtimeFor: () => probe.runtime,
          promptsDir: PROMPTS_DIR,
          runlogRoot: home.root,
          app: "fixture",
          base: baseRevisionForBranch(defaultBranch),
          policy: policy(),
          commands: { testCommand: "true", lintCommand: "true" },
          hooks: allowAllHooks(),
        };
        const gated = await advanceGates(item, {
          gh: h.gh,
          base: baseRevisionForBranch(defaultBranch),
          policy: policy(),
          commands: { testCommand: "true", lintCommand: "true" },
          criteria: parseAcceptanceCriteria(item.body),
          criterionTests: CRITERION_TESTS,
        });
        expect(gated.phase).toBe("reviewing");

        const reviewed = await runReviewPipeline(gated, engineOptions);

        // The diff-derived security dimension selected the deep review pass.
        expect(probe.tasks().some((task) => task.includes("# Pass: verify"))).toBe(true);
        expect(probe.tasks().some((task) => task.includes("# Pass: security-deep"))).toBe(true);
        // Findings bounce the ticket back to the builder for a fix cycle.
        expect(reviewed.phase).toBe("building");
        expect(reviewed.findings.length).toBeGreaterThan(0);
        expect(reviewed.cycles).toBe(1);

        const fixed = await runBuilderPipeline(reviewed, { ...engineOptions, pipelineName: "fix" });
        expect(fixed.phase).toBe("gates");
        expect(probe.tasks().some((task) => task.includes("# Pass: fix"))).toBe(true);

        // The re-run gates still diff against the same resolved base.
        const regated = await advanceGates(fixed, {
          gh: h.gh,
          base: baseRevisionForBranch(defaultBranch),
          policy: policy(),
          commands: { testCommand: "true", lintCommand: "true" },
          criteria: parseAcceptanceCriteria(fixed.body),
          criterionTests: CRITERION_TESTS,
        });
        expect(regated.phase).toBe("reviewing");
        expect(regated.gateResults[regated.gateResults.length - 1]?.tier).toBe("high");

        // `ensurePr`'s EXISTING-pr branch: the second gate run reuses the open
        // PR and rewrites its managed evidence block in place. #180 requires
        // that block to name the revision it was actually evaluated at, so the
        // published revision must be the post-fix head — not the pre-fix sha
        // the PR was opened at — and the managed block must be replaced, never
        // appended a second time.
        const postFixHead = git(fixed.worktree as string, "rev-parse", "HEAD");
        expect(postFixHead).not.toBe(git(item.worktree as string, "rev-parse", `origin/${defaultBranch}`));
        const pr = await h.gh.readPR(regated.prNumber as number);
        expect(pr.headRefOid).toBe(postFixHead);
        expect(pr.body).toContain(`**Revision:** \`${postFixHead}\``);
        expect(pr.body.match(/<!-- operon:gate-evidence:start -->/g)).toHaveLength(1);
        expect(pr.body.match(/<!-- operon:gate-evidence:end -->/g)).toHaveLength(1);
      } finally {
        home.cleanup();
        h.cleanup();
      }
    });

    // Path 4 — ship. Claim -> gates -> approve -> ship, so the merge runs
    // against a PR that the product itself based on the resolved branch. The
    // squash lands on the real origin: `master`/`trunk` repos end with their own
    // branch advanced and still no `main` in existence.
    it("ships by merging into the resolved default branch", async () => {
      const h = harness(defaultBranch, "Ship Into Base");
      try {
        const item = await claim(h, defaultBranch);
        commit(item.worktree as string, "feat: shippable change", {
          "auth/change.ts": "export const changed = true;\n",
        });
        const gateOptions = {
          gh: h.gh,
          base: baseRevisionForBranch(defaultBranch),
          policy: policy(),
          commands: { testCommand: "true", lintCommand: "true" },
          criteria: parseAcceptanceCriteria(item.body),
          criterionTests: CRITERION_TESTS,
        };
        const gated = await advanceGates(item, gateOptions);
        expect(gated.phase).toBe("reviewing");

        await h.gh.createReview(gated.prNumber as number, { state: "approve", body: APPROVE });
        const approved = await advanceReviewing(gated, { gh: h.gh });
        expect(approved.phase).toBe("shipping");

        const shipped = await advanceShipping(approved, {
          ...gateOptions,
          localRepo: h.pair.clone.root,
        });

        expect(shipped.phase).toBe("merged");
        expect(createPrBase(h.gh)).toBe(defaultBranch);
        // The squash landed on the repo's OWN default branch on origin.
        expect(h.pair.bare.log(defaultBranch)[0]).toContain("#1");
        expect(h.pair.bare.log(defaultBranch)).toHaveLength(2);
        // ...and nothing along the way invented a `main` to merge into.
        expectNoMainToFallBackOn(h.pair, defaultBranch);
        expect((await h.gh.readIssue(1)).state).toBe("CLOSED");
      } finally {
        h.cleanup();
      }
    });

    // Path 5 — one full `runLoopOnce` driver tick: claim, provision setup,
    // contract, implement, gates, PR, review (verify + security-deep),
    // ship-check, squash merge. This is the tick that crashed in the live
    // campaign; every stage above is exercised here in its real order with the
    // driver, not a hand-assembled item, choosing what to run.
    it("runs a full runLoopOnce tick end to end", async () => {
      const h = harness(defaultBranch, "Full Driver Tick");
      const home = makeOrgHome({ runs: { apps: ["fixture"] } });
      const probe = loopRuntime();
      try {
        const ticketEpisode = ticketEpisodeFixture(home.root, h.gh, probe.runtime);
        const result = await runLoopOnce({
          app: "fixture",
          repo: "fixture/repo",
          gh: h.gh,
          localRepo: h.pair.clone.root,
          worktreeRoot: h.worktreeRoot,
          base: baseRevisionForBranch(defaultBranch),
          policy: policy(),
          commands: { testCommand: "true", lintCommand: "true" },
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

        expect(result.items).toHaveLength(1);
        expect(result.items[0]?.phase).toBe("merged");
        // Every provider-visible stage ran, so the tick reached the end rather
        // than terminating early on a swallowed git failure.
        const tasks = probe.tasks();
        for (const pass of ["# Pass: contract", "# Pass: implement", "# Pass: verify", "# Pass: ship-check"]) {
          expect(tasks.some((task) => task.includes(pass))).toBe(true);
        }
        expect(createPrBase(h.gh)).toBe(defaultBranch);
        expect(h.pair.bare.log(defaultBranch)[0]).toContain("#1");
        expectNoMainToFallBackOn(h.pair, defaultBranch);
      } finally {
        home.cleanup();
        h.cleanup();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// small git helpers (isolated identity/config, loud failures)
// ---------------------------------------------------------------------------

const FIXTURE_GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "Operon Fixture",
  GIT_AUTHOR_EMAIL: "fixture@operon.invalid",
  GIT_COMMITTER_NAME: "Operon Fixture",
  GIT_COMMITTER_EMAIL: "fixture@operon.invalid",
  GIT_TERMINAL_PROMPT: "0",
};

function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      env: FIXTURE_GIT_ENV,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const detail = typeof stderr === "string" && stderr.trim() !== "" ? `\n${stderr.trim()}` : "";
    throw new Error(`git ${args.join(" ")} failed in ${cwd}${detail}`);
  }
}

function commit(worktree: string, message: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(worktree, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  git(worktree, "add", "-A");
  git(worktree, "commit", "-m", message);
}
