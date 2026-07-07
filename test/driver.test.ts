import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LOOP_POLICY,
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
});
