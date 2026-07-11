// Tests the loop driver helpers in src/loop/driver.ts.
// Covers plan-only ticket phase reporting and quality-gate command discovery,
// including package-script fallbacks and setup_command loading.
// FakeGhOps and temp repos provide all state locally; no network, auth, real
// GitHub state, or wall-clock time is required.

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LOOP_POLICY,
  gateCommandsForWorktree,
  loadGateCommands,
  planLoopTick,
  runLoopOnce,
} from "../src/loop/driver.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

const issueBody = [
  "## Goal",
  "Do a planned thing.",
  "",
  "## Acceptance criteria",
  "- [x] planned thing is testable",
  "",
].join("\n");

describe("loop driver", () => {
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
