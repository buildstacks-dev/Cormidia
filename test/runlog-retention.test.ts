// L3 forensics writers + retention pruning (build plan M2.7; docs/loop.md
// §9). Prune deletes only provably-finalized-and-old run dirs; the CLI case
// drives the built entrypoint end-to-end against a fixture tree.

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { writeBrief, writeOutput, createSessionLogSink } from "../src/runtime/runlog/forensics.js";
import { pruneRuns } from "../src/runtime/runlog/retention.js";
import { runPaths } from "../src/runtime/runlog/paths.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const NOW = new Date(Date.UTC(2026, 6, 5, 12, 0, 0));
const OLD_ID = "20260601-090000-build-implement";
const FRESH_ID = "20260705-100000-build-implement";
const RUNNING_ID = "20260501-090000-build-implement";

function envelopeFor(runId: string, status: string, finishedAt?: string): unknown {
  return {
    schema_version: 1,
    run_id: runId,
    trace_id: "t",
    app: "civic",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    status,
    started_at: "2026-05-01T09:00:00.000Z",
    ...(finishedAt !== undefined ? { finished_at: finishedAt } : {}),
    refs: { events: "events.jsonl", brief: "brief.md", output: "output.md", session_log: "session.log" },
  };
}

/** Old finalized + fresh finalized + ancient-but-running. The fresh run's
 *  finish time is a parameter: unit cases pass a fixed date (measured
 *  against the fixed NOW), the CLI case passes a time just ahead of the
 *  CLI's real clock so retention 0 provably spares it. */
function makePruneFixture(freshFinishedAt: string): OrgHomeFixture {
  return makeOrgHome({
    runs: {
      records: {
        civic: {
          [OLD_ID]: { envelope: envelopeFor(OLD_ID, "completed", "2026-06-01T09:05:00.000Z") },
          [FRESH_ID]: { envelope: envelopeFor(FRESH_ID, "completed", freshFinishedAt) },
          [RUNNING_ID]: { envelope: envelopeFor(RUNNING_ID, "running") },
        },
      },
    },
  });
}

describe("forensics writers", () => {
  it("brief/output verbatim and unredacted; session sink appends TurnEvents", async () => {
    const fixture = makeOrgHome({ runs: { apps: ["civic"] } });
    try {
      const runId = FRESH_ID;
      // L3 is deliberately unredacted — a secret in the brief stays there.
      const brief = `[ticket]\nkey sk-${"a1".repeat(20)}\n`;
      await writeBrief(fixture.root, "civic", runId, brief);
      await writeOutput(fixture.root, "civic", runId, "final output\n");

      const sink = createSessionLogSink(fixture.root, "civic", runId);
      sink({ type: "text", detail: "thinking about the ticket" });
      sink({ type: "tool_use", detail: "bash: pnpm test" });

      const paths = runPaths(fixture.root, "civic", runId);
      expect(readFileSync(paths.brief, "utf8")).toBe(brief); // verbatim, no scrub
      expect(readFileSync(paths.output, "utf8")).toBe("final output\n");
      expect(readFileSync(paths.sessionLog, "utf8")).toBe(
        "[text] thinking about the ticket\n[tool_use] bash: pnpm test\n",
      );
    } finally {
      fixture.cleanup();
    }
  });
});

describe("pruneRuns", () => {
  it("deletes old finalized runs, keeps fresh ones, keeps running ones regardless of age", async () => {
    const fixture = makePruneFixture("2026-07-05T10:00:00.000Z");
    try {
      const result = await pruneRuns(fixture.root, 7, NOW);

      expect(result.deleted).toEqual([`civic/${OLD_ID}`]);
      expect(result.kept).toBe(2);
      expect(existsSync(fixture.paths.runDir("civic", OLD_ID))).toBe(false);
      expect(existsSync(fixture.paths.runDir("civic", FRESH_ID))).toBe(true);
      expect(existsSync(fixture.paths.runDir("civic", RUNNING_ID))).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("keeps run dirs whose envelope is missing or unreadable (fail safe)", async () => {
    const fixture = makeOrgHome({
      runs: { records: { civic: { "20260101-000000-build-implement": {} } } },
    });
    try {
      const result = await pruneRuns(fixture.root, 0, NOW);
      expect(result.deleted).toEqual([]);
      expect(result.kept).toBe(1);
    } finally {
      fixture.cleanup();
    }
  });

  it("no runs/ tree at all is a no-op, not an error", async () => {
    const fixture = makeOrgHome({});
    try {
      const result = await pruneRuns(fixture.root, 7, NOW);
      expect(result).toEqual({ deleted: [], kept: 0 });
    } finally {
      fixture.cleanup();
    }
  });

  it("CLI: prune-runs --retention-days 0 deletes only the old finalized run and prints the count", async () => {
    // The CLI uses the real clock, so "fresh" means just ahead of it.
    const fixture = makePruneFixture(new Date(Date.now() + 60_000).toISOString());
    try {
      const { stdout } = await execFileAsync(
        "npx",
        ["tsx", CLI_PATH, "prune-runs", fixture.root, "--retention-days", "0"],
        { cwd: REPO_ROOT },
      );
      expect(stdout).toMatch(/pruned 1 run dir\(s\) \(retention 0 days\); kept 2/);
      expect(stdout).toContain(`deleted civic/${OLD_ID}`);
      expect(existsSync(fixture.paths.runDir("civic", OLD_ID))).toBe(false);
      expect(existsSync(fixture.paths.runDir("civic", FRESH_ID))).toBe(true);
      expect(existsSync(fixture.paths.runDir("civic", RUNNING_ID))).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });
});
