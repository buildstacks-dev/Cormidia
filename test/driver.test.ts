// Tests the loop driver helpers in src/loop/driver.ts.
// Covers plan-only ticket phase reporting and quality-gate command discovery,
// including package-script fallbacks and setup_command loading.
// FakeGhOps and temp repos provide all state locally; no network, auth, real
// GitHub state, or wall-clock time is required.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LOOP_POLICY,
  defaultLoopInputs,
  gateCommandsForWorktree,
  loadGateCommands,
  planLoopTick,
  runLoopOnce,
} from "../src/loop/driver.js";
import { branchNameForIssue, dependencyRelevantPackageJson } from "../src/loop/loop.js";
import { writeTicketClaimState } from "../src/loop/rehydrate.js";
import { makeBareWithClone, makeWorkingRepo } from "./fixtures/gitRepo.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

function policyYaml(): string {
  return [
    "risk_tiers:",
    "  high: ['auth/**']",
    "  medium: ['src/**']",
    "  low: ['**']",
    "gates:",
    "  high: [tests]",
    "  medium: [tests]",
    "  low: [tests]",
    "",
  ].join("\n");
}

const issueBody = [
  "## Goal",
  "Do a planned thing.",
  "",
  "## Acceptance criteria",
  "- [x] planned thing is testable",
  "",
].join("\n");

describe("loop driver", () => {
  it("treats a supplied repo as immutable input instead of checking out and resetting main", async () => {
    const pair = makeBareWithClone();
    try {
      pair.clone.commit("seed app policy", {
        ".operon/policy.yaml": [
          "risk_tiers:",
          "  high: ['auth/**']",
          "  medium: ['src/**']",
          "  low: ['**']",
          "gates:",
          "  high: [tests]",
          "  medium: [tests]",
          "  low: [tests]",
          "",
        ].join("\n"),
        "README.md": "main\n",
      });
      pair.clone.git("push", "origin", "main");
      pair.clone.git("checkout", "-b", "operator/active-work");
      pair.clone.commit("operator branch", { "README.md": "operator branch\n" });
      writeFileSync(join(pair.clone.root, "LOCAL-NOTES.md"), "untracked operator work\n");

      const before = {
        branch: pair.clone.git("branch", "--show-current"),
        head: pair.clone.git("rev-parse", "HEAD"),
        status: pair.clone.git("status", "--porcelain=v2", "--untracked-files=all"),
      };

      const inputs = await defaultLoopInputs(pair.bare.root, pair.clone.root, {
        supplied: true,
        snapshotDir: join(pair.root, "prepared-snapshot"),
      });

      expect(inputs.localRepo).not.toBe(pair.clone.root);
      expect(pair.clone.git("branch", "--show-current")).toBe(before.branch);
      expect(pair.clone.git("rev-parse", "HEAD")).toBe(before.head);
      expect(pair.clone.git("status", "--porcelain=v2", "--untracked-files=all")).toBe(
        before.status,
      );
    } finally {
      pair.cleanup();
    }
  });

  it("ensureClone follows a master-default remote instead of hardcoding main (L-010)", async () => {
    // A stock `git init` environment (no init.defaultBranch) produces
    // `master`; the managed-clone path used to run `git fetch origin main`
    // and crash the first tick with a raw git error.
    const pair = makeBareWithClone("master");
    try {
      pair.clone.commit("seed app policy", {
        ".operon/policy.yaml": policyYaml(),
        "README.md": "seed\n",
      });
      pair.clone.git("push", "origin", "master");
      // Local drift the tick must discard, exactly as it always did for main.
      pair.clone.commit("unpushed local drift", { "README.md": "drift\n" });

      const inputs = await defaultLoopInputs("owner/fixture", pair.clone.root);

      expect(inputs.baseRef).toBe("master");
      expect(pair.clone.git("branch", "--show-current")).toBe("master");
      expect(pair.clone.git("rev-parse", "HEAD")).toBe(
        pair.clone.git("rev-parse", "origin/master"),
      );
    } finally {
      pair.cleanup();
    }
  });

  it("ensureClone still resolves a main-default remote and threads baseRef main", async () => {
    const pair = makeBareWithClone();
    try {
      pair.clone.commit("seed app policy", { ".operon/policy.yaml": policyYaml() });
      pair.clone.git("push", "origin", "main");

      const inputs = await defaultLoopInputs("owner/fixture", pair.clone.root);

      expect(inputs.baseRef).toBe("main");
      expect(pair.clone.git("branch", "--show-current")).toBe("main");
    } finally {
      pair.cleanup();
    }
  });

  it("a remote advertising no default branch fails loudly and actionably, not with a raw git error (L-010)", async () => {
    // An empty origin advertises no HEAD symref: "cannot determine" must be
    // a clear refusal naming the situation, never a guessed `main`.
    const root = mkdtempSync(join(tmpdir(), "operon-driver-empty-origin-"));
    try {
      const bare = join(root, "origin.git");
      execFileSync("git", ["init", "--bare", "--initial-branch=master", bare], { cwd: root });
      const clone = join(root, "clone");
      execFileSync("git", ["clone", bare, clone], { cwd: root, stdio: "ignore" });

      await expect(defaultLoopInputs("owner/fixture", clone)).rejects.toThrow(
        /advertises no default branch/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("planLoopTick prints a phase plan for a seeded ready ticket", () => {
    const plan = planLoopTick(
      [
        {
          number: 1,
          title: "Seeded ready ticket",
          body: issueBody,
          labels: ["op:ready", "p3"],
          state: "OPEN",
        },
      ],
      "fixture/repo",
      1,
    );

    expect(plan).toEqual([
      { issueNumber: 1, title: "Seeded ready ticket", phase: "ready", tier: "standard" },
    ]);
  });

  it("runLoopOnce --planOnly uses injected FakeGhOps and does not advance labels", async () => {
    const gh = new FakeGhOps({
      issues: [{ number: 1, title: "Seeded ready ticket", body: issueBody, labels: ["op:ready"] }],
    });

    const result = await runLoopOnce({
      app: "fixture",
      repo: "fixture/repo",
      gh,
      localRepo: "/tmp/not-used",
      worktreeRoot: "/tmp/not-used-worktrees",
      policy: DEFAULT_LOOP_POLICY,
      commands: {},
      planOnly: true,
    });

    expect(result.lines).toEqual(["#1 Seeded ready ticket: ready -> claim"]);
    expect(result.items).toEqual([]);
    expect((await gh.readIssue(1)).labels).toEqual(["op:ready"]);
  });

  // B-LIVE-03 / L-007: drive the LIVE fetch semantics. The dependency issues
  // are CLOSED-by-merge and carry no op:ready label, so the open-only op:ready
  // fetch never returns them — exactly like real GitHub. A dependent is
  // selectable only if the driver resolves its merged dependencies separately
  // and feeds them into selection.
  async function mergeDependency(gh: FakeGhOps, number: number): Promise<void> {
    const issue = await gh.readIssue(number);
    const pr = await gh.createPR({
      head: branchNameForIssue(issue),
      base: "main",
      title: `build: ${issue.title} (#${number})`,
      body: `## What\nDelivered.\n\nCloses #${number}\n`,
    });
    await gh.squashMerge(pr.number, { subject: `build: ${issue.title} (#${number})` });
  }

  const dependentBody = (deps: number[]): string =>
    [
      "## Goal",
      "Depend on merged predecessors.",
      ...deps.map((dep) => `Depends-on: #${dep}`),
      "",
      "## Acceptance criteria",
      "- [x] dependent is testable",
      "",
    ].join("\n");

  it("selects a dependent once its dependencies are merged-and-closed (B-LIVE-03/L-007)", async () => {
    const gh = new FakeGhOps({
      issues: [
        { number: 1, title: "Dep one", body: issueBody, labels: ["op:tier-deep", "p1", "domain:data"] },
        { number: 2, title: "Dep two", body: issueBody, labels: ["op:tier-deep", "p1", "domain:data"] },
        { number: 3, title: "Dependent", body: dependentBody([1, 2]), labels: ["op:ready"] },
      ],
    });
    // #1 and #2 merge and close: gone from the open op:ready set, discoverable
    // only by their number + a MERGED PR on their branch.
    await mergeDependency(gh, 1);
    await mergeDependency(gh, 2);
    expect((await gh.readIssue(1)).state).toBe("CLOSED");
    expect(
      await gh.listIssues({ labels: ["op:ready"], state: "open", limit: 10 }),
    ).toHaveLength(1);

    const result = await runLoopOnce({
      app: "fixture",
      repo: "fixture/repo",
      gh,
      localRepo: "/tmp/not-used",
      worktreeRoot: "/tmp/not-used-worktrees",
      policy: DEFAULT_LOOP_POLICY,
      commands: {},
      maxConcurrent: 2,
      planOnly: true,
    });

    expect(result.lines).toEqual(["#3 Dependent: ready -> claim"]);
  });

  it("does NOT select a dependent whose dependency was closed WITHOUT merging (W4-ADJ-05)", async () => {
    const gh = new FakeGhOps({
      issues: [
        { number: 5, title: "Abandoned dep", body: issueBody, labels: ["op:tier-standard", "p1"] },
        { number: 4, title: "Dependent", body: dependentBody([5]), labels: ["op:ready"] },
      ],
    });
    // #5 is closed, but never merged — no MERGED PR exists on its branch.
    await gh.closeIssue(5);
    expect((await gh.readIssue(5)).state).toBe("CLOSED");

    const result = await runLoopOnce({
      app: "fixture",
      repo: "fixture/repo",
      gh,
      localRepo: "/tmp/not-used",
      worktreeRoot: "/tmp/not-used-worktrees",
      policy: DEFAULT_LOOP_POLICY,
      commands: {},
      maxConcurrent: 2,
      planOnly: true,
    });

    // A closed-without-merge dependency must not satisfy the dependent.
    expect(result.lines).toEqual([]);
  });

  it("keeps intra-batch order: B depends on co-fetched unmerged A, so only A runs", async () => {
    const gh = new FakeGhOps({
      issues: [
        { number: 6, title: "Predecessor", body: issueBody, labels: ["op:ready"] },
        { number: 7, title: "Successor", body: dependentBody([6]), labels: ["op:ready"] },
      ],
    });
    // #6 is still open op:ready (unmerged) and co-fetched with its dependent #7.

    const result = await runLoopOnce({
      app: "fixture",
      repo: "fixture/repo",
      gh,
      localRepo: "/tmp/not-used",
      worktreeRoot: "/tmp/not-used-worktrees",
      policy: DEFAULT_LOOP_POLICY,
      commands: {},
      maxConcurrent: 3,
      planOnly: true,
    });

    // #7 must not run in the same batch as its unmerged predecessor #6.
    expect(result.lines).toEqual(["#6 Predecessor: ready -> claim"]);
  });

  it("loadGateCommands falls back to package scripts when app config omits commands", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-driver-"));
    try {
      mkdirSync(join(root, ".operon"));
      writeFileSync(join(root, ".operon", "config.yaml"), "schema_version: 1\n", "utf8");
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ scripts: { test: "node --test", lint: "node --check src/index.js" } }),
        "utf8",
      );

      expect(loadGateCommands(root)).toEqual({
        testCommand: "npm test",
        lintCommand: "npm run lint",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loadGateCommands reads setup_command from app config so deps install before gates", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-driver-"));
    try {
      mkdirSync(join(root, ".operon"));
      writeFileSync(
        join(root, ".operon", "config.yaml"),
        "schema_version: 1\nsetup_command: npm ci\n",
        "utf8",
      );
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } }),
        "utf8",
      );

      expect(loadGateCommands(root)).toEqual({
        setupCommand: "npm ci",
        testCommand: "npm test",
        lintCommand: "npm run lint",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a budget-guard refusal claims nothing and touches no GitHub state", async () => {
    const gh = new FakeGhOps({
      issues: [{ number: 1, title: "Seeded ready ticket", body: issueBody, labels: ["op:ready"] }],
    });

    const result = await runLoopOnce({
      app: "fixture",
      repo: "fixture/repo",
      gh,
      localRepo: "/tmp/not-used",
      worktreeRoot: "/tmp/not-used-worktrees",
      policy: DEFAULT_LOOP_POLICY,
      commands: {},
      engine: {
        // The guard refuses before anything else runs, so the engine surface
        // is never touched — empty placeholders keep the test type-honest.
        pipelines: { pipelines: [] } as never,
        roles: {},
        runtimeFor: () => {
          throw new Error("budget refusal must not construct a runtime");
        },
        promptsDir: "/tmp/not-used-prompts",
        runlogRoot: "/tmp/not-used-runlog",
        hooks: { gate: () => ({ allow: true }) },
        budgetGuard: async () => ({
          allowed: false,
          reason: "fixture spent $301.00 of $300.00",
        }),
      },
    });

    expect(result.budgetRefusal).toBe("fixture spent $301.00 of $300.00");
    expect(result.items).toEqual([]);
    expect(result.lines[0]).toContain("budget preflight refused");
    // The seeded ticket must still be op:ready — a refused tick never claims.
    const issues = await gh.listIssues({ labels: ["op:ready"], state: "open", limit: 10 });
    expect(issues).toHaveLength(1);
  });

  it("parks a ticket at the claim cap with an evidence digest instead of claiming it", async () => {
    const root = mkdtempSync(join(tmpdir(), "operon-driver-park-"));
    const gh = new FakeGhOps({
      issues: [{ number: 1, title: "Bouncing ticket", body: issueBody, labels: ["op:ready"] }],
    });
    writeTicketClaimState(root, "fixture", 1, {
      claims: 3,
      lastClaimAt: "2026-07-10T10:00:00Z",
      outcomes: ["claim 1: ended returned", "claim 2: ended returned", "claim 3: ended blocked"],
    });
    try {
      const result = await runLoopOnce({
        app: "fixture",
        repo: "fixture/repo",
        gh,
        localRepo: "/tmp/not-used",
        worktreeRoot: "/tmp/not-used-worktrees",
        policy: DEFAULT_LOOP_POLICY,
        commands: {},
        engine: {
          pipelines: { pipelines: [] } as never,
          roles: {},
          runtimeFor: () => {
            throw new Error("a parked ticket must not construct a runtime");
          },
          promptsDir: "/tmp/not-used-prompts",
          runlogRoot: root,
          hooks: { gate: () => ({ allow: true }) },
        },
      });

      expect(result.items).toEqual([]);
      expect(result.lines.some((line) => line.includes("parked after 3 claims"))).toBe(true);
      const issue = (await gh.listIssues({ state: "all", limit: 10 }))[0]!;
      expect(issue.labels).toContain("op:returned");
      expect(issue.labels).not.toContain("op:ready");
      const digest = (gh.issueComments.get(1) ?? []).find((c) => c.startsWith("## Parked after"));
      expect(digest).toBeDefined();
      expect(digest).toContain("claim 3: ended blocked");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loadGateCommands reads commands from the sole registry-style app entry", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-driver-"));
    try {
      mkdirSync(join(root, ".operon"));
      writeFileSync(
        join(root, ".operon", "config.yaml"),
        [
          "schema_version: 1",
          "apps:",
          "  fixture:",
          "    test_command: pnpm test",
          "    lint_command: pnpm lint",
          "    commands:",
          "      install: pnpm install --frozen-lockfile",
          "      test: pnpm test:fallback",
          "      lint: pnpm lint:fallback",
          "",
        ].join("\n"),
        "utf8",
      );

      expect(loadGateCommands(root)).toEqual({
        setupCommand: "pnpm install --frozen-lockfile",
        testCommand: "pnpm test",
        lintCommand: "pnpm lint",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loadGateCommands reads TOP-LEVEL gate commands even when a sole app entry is present (W0-ADJ-04)", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-driver-"));
    try {
      mkdirSync(join(root, ".operon"));
      // Exactly the shape `operon new-app` emits: one `apps:` entry with no
      // command keys, and the setup/test/lint commands appended at the TOP
      // level. Before the fix these were dead config whenever a single app
      // existed, so a greenfield app's setup_command never reached the loop
      // or `operon app verify`.
      writeFileSync(
        join(root, ".operon", "config.yaml"),
        [
          "schema_version: 1",
          "apps:",
          "  fixture:",
          "    repo: owner/fixture",
          "    status: onboarding",
          "setup_command: npm install",
          "test_command: npm test",
          "lint_command: npm run lint",
          "",
        ].join("\n"),
        "utf8",
      );

      expect(loadGateCommands(root)).toEqual({
        setupCommand: "npm install",
        testCommand: "npm test",
        lintCommand: "npm run lint",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reloads commands from the built worktree before quality gates", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-driver-"));
    try {
      mkdirSync(join(root, ".operon"));
      writeFileSync(
        join(root, ".operon", "config.yaml"),
        "schema_version: 1\ntest_command: pnpm test\nlint_command: pnpm lint\n",
        "utf8",
      );

      expect(
        gateCommandsForWorktree(
          { testCommand: "stale-test", e2eTestCommand: "pnpm test:e2e" },
          root,
        ),
      ).toEqual({
        testCommand: "pnpm test",
        lintCommand: "pnpm lint",
        e2eTestCommand: "pnpm test:e2e",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// L1-05 (behavioral, real git): the security dimension's package.json trigger
// reads the actual diff. A trivial metadata edit must not mark package.json
// dependency-relevant (so it will not escalate standard → deep); a
// dependency/script change must.
describe("dependencyRelevantPackageJson (L1-05, real git diff)", () => {
  function pkg(extra: Record<string, unknown>): string {
    return (
      JSON.stringify(
        {
          name: "fixture-app",
          version: "1.0.0",
          private: true,
          scripts: { test: "vitest" },
          dependencies: { react: "^18.0.0" },
          ...extra,
        },
        null,
        2,
      ) + "\n"
    );
  }

  it("ignores a metadata-only package.json edit but catches a dependency/script change", () => {
    const repo = makeWorkingRepo();
    try {
      const base = repo.commit("chore: baseline package.json", { "package.json": pkg({}) });

      // Metadata-only: add a `files` field / touch source — no dep/script key.
      repo.commit("chore: add files field", {
        "package.json": pkg({ files: ["dist", "src"] }),
        "src/app.ts": "export const x = 1;\n",
      });
      let changed = repo.changedFiles(base);
      expect(changed).toContain("package.json");
      expect([...dependencyRelevantPackageJson(repo.root, base, "HEAD", changed)]).toEqual([]);

      // Dependency bump on a fresh baseline.
      const base2 = repo.head();
      repo.commit("build: bump react", {
        "package.json": pkg({ files: ["dist", "src"], dependencies: { react: "^18.3.0" } }),
      });
      changed = repo.changedFiles(base2);
      expect([...dependencyRelevantPackageJson(repo.root, base2, "HEAD", changed)]).toEqual(["package.json"]);

      // Script change on a fresh baseline.
      const base3 = repo.head();
      repo.commit("build: add postinstall", {
        "package.json": pkg({
          files: ["dist", "src"],
          dependencies: { react: "^18.3.0" },
          scripts: { test: "vitest", postinstall: "node setup.js" },
        }),
      });
      changed = repo.changedFiles(base3);
      expect([...dependencyRelevantPackageJson(repo.root, base3, "HEAD", changed)]).toEqual(["package.json"]);
    } finally {
      repo.cleanup();
    }
  });

  it("marks a newly added package.json with dependencies as relevant", () => {
    const repo = makeWorkingRepo();
    try {
      // makeWorkingRepo already committed a package.json; add a nested one.
      const base = repo.head();
      repo.commit("feat: add a sub-package", { "packages/api/package.json": pkg({}) });
      const changed = repo.changedFiles(base);
      expect(changed).toContain("packages/api/package.json");
      expect([...dependencyRelevantPackageJson(repo.root, base, "HEAD", changed)]).toEqual([
        "packages/api/package.json",
      ]);
    } finally {
      repo.cleanup();
    }
  });

  // L1-05 fixup: a genuine git FAILURE must fail SAFE (escalate), not fail open.
  it("escalates when git show fails — a transient 'cannot check' is treated as risky, not 'no change'", () => {
    const repo = makeWorkingRepo();
    try {
      // A bogus base ref makes `git show <ref>:package.json` fail with
      // "invalid object name" — a genuine failure, NOT a legitimately-absent
      // path. We cannot compare, so package.json must be treated as a security
      // signal (escalate). The old helper collapsed this into undefined → {},
      // which — when the present side also had no dependency keys — read as
      // "no change" and silently dropped the escalation (fail-open).
      expect([...dependencyRelevantPackageJson(repo.root, "does-not-exist-ref", "HEAD", ["package.json"])]).toEqual([
        "package.json",
      ]);
    } finally {
      repo.cleanup();
    }
  });

  it("treats a legitimately-absent side as empty, not a failure: an added metadata-only package.json does not escalate", () => {
    const repo = makeWorkingRepo();
    try {
      // A newly-added package.json with NO dependency/script keys: the base
      // side legitimately does not exist at `base` (an absence, not an error),
      // so the present side's (empty) deps drive the comparison → not relevant.
      // This is the case that must NOT be conflated with a git failure.
      const base = repo.head();
      repo.commit("feat: add a metadata-only sub-package", {
        "packages/meta/package.json": JSON.stringify({ name: "meta", version: "1.0.0" }, null, 2) + "\n",
      });
      const changed = repo.changedFiles(base);
      expect(changed).toContain("packages/meta/package.json");
      expect([...dependencyRelevantPackageJson(repo.root, base, "HEAD", changed)]).toEqual([]);
    } finally {
      repo.cleanup();
    }
  });
});
