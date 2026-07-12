// App reset lifecycle: plan-first GitHub inventory, archive-before-delete,
// app-scoped local cleanup, and refusal while work is active.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cmdApp } from "../src/cli/app.js";
import { executeAppReset, planAppReset } from "../src/org/app-reset.js";
import { joinExistingOrg, loadApps } from "../src/org/apps.js";
import { initOrgHome } from "../src/org/home.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface ResetFixture {
  root: string;
  orgHome: string;
  stateHome: string;
  archiveRoot: string;
  gh: FakeGhOps;
  input(): Promise<Parameters<typeof planAppReset>[0]>;
}

async function fixture(): Promise<ResetFixture> {
  const root = mkdtempSync(join(tmpdir(), "operon-app-reset-"));
  roots.push(root);
  const orgHome = join(root, "org");
  const stateHome = join(root, "state");
  const archiveRoot = join(root, "archives");
  await initOrgHome({ target: orgHome, name: "reset-test", stateHome, homeDir: join(root, "home") });
  await joinExistingOrg(orgHome, { name: "alpha", repo: "owner/alpha", status: "onboarding" });

  write(stateHome, "repos/alpha/README.md", "managed clone\n");
  write(stateHome, "worktrees/alpha/op-7/file.txt", "worktree\n");
  write(stateHome, "runs/alpha/run-1/envelope.json", JSON.stringify(completedEnvelope()));
  write(stateHome, "tickets/alpha/7.json", '{"claims":1,"outcomes":[]}\n');
  write(
    stateHome,
    "telemetry/2026-07-11.jsonl",
    `${JSON.stringify({ app: "alpha", runId: "run-1", costUsd: 2 })}\n` +
      `${JSON.stringify({ app: "beta", runId: "run-2", costUsd: 3 })}\n`,
  );
  write(
    stateHome,
    "invocations/2026-07-11.jsonl",
    `${JSON.stringify({ app: "alpha", kind: "loop" })}\n` +
      `${JSON.stringify({ app: "beta", kind: "loop" })}\n`,
  );
  write(
    stateHome,
    "state/schedule.json",
    JSON.stringify({ "alpha|builder|hourly": "2026-07-11T00:00:00.000Z", "beta|builder|hourly": "2026-07-11T00:00:00.000Z" }),
  );
  write(stateHome, "state/budget-overlay.json", JSON.stringify({ pausedApps: ["alpha", "beta"] }));
  write(stateHome, "approvals/decided/alpha-approved.json", JSON.stringify({ id: "alpha-approved", app: "alpha" }));
  write(stateHome, "approvals/grants/grant-alpha-approved.json", JSON.stringify({ grantId: "grant-alpha-approved", app: "alpha" }));

  const gh = new FakeGhOps({
    repo: "owner/alpha",
    issues: [
      { number: 7, title: "Operon-managed", labels: ["op:in-review"] },
      { number: 8, title: "Human issue", labels: ["p1"] },
    ],
  });
  await gh.createPR({
    head: "build/alpha-v1",
    base: "main",
    title: "Alpha implementation",
    body: "Closes #7",
  });
  return {
    root,
    orgHome,
    stateHome,
    archiveRoot,
    gh,
    async input() {
      return {
        orgHome,
        stateHome,
        appsFile: await loadApps(join(orgHome, "apps.yaml")),
        appName: "alpha",
        gh,
        archiveRoot,
        now: new Date("2026-07-11T20:00:00.000Z"),
      };
    },
  };
}

describe("app reset", () => {
  it("plans only identifiable Operon GitHub work and changes nothing", async () => {
    const f = await fixture();
    const beforeRegistry = readFileSync(join(f.orgHome, "apps.yaml"), "utf8");

    const plan = await planAppReset(await f.input());

    expect(plan.blockers).toEqual([]);
    expect(plan.github.issues.map((issue) => issue.number)).toEqual([7]);
    expect(plan.github.pullRequests.map((pr) => pr.number)).toEqual([1]);
    expect(plan.github.branches).toEqual(["build/alpha-v1"]);
    expect(plan.managedPaths).toContain(join(f.stateHome, "runs", "alpha"));
    expect(readFileSync(join(f.orgHome, "apps.yaml"), "utf8")).toBe(beforeRegistry);
    expect(existsSync(join(f.stateHome, "repos", "alpha"))).toBe(true);
    expect((await f.gh.readIssue(7)).state).toBe("OPEN");
    expect((await f.gh.readPR(1)).state).toBe("OPEN");
  });

  it("archives before removing only the selected app's state and tracked GitHub work", async () => {
    const f = await fixture();

    const result = await executeAppReset(await f.input());

    expect(existsSync(result.archivePath)).toBe(true);
    const manifest = JSON.parse(readFileSync(join(result.archivePath, "manifest.json"), "utf8")) as {
      kind: string;
      app: { name: string };
      files: unknown[];
    };
    expect(manifest).toMatchObject({ kind: "app-reset", app: { name: "alpha" } });
    expect(manifest.files.length).toBeGreaterThan(0);
    expect(existsSync(join(result.archivePath, "state", "repos", "alpha", "README.md"))).toBe(true);
    expect(existsSync(join(result.archivePath, "github.json"))).toBe(true);

    expect((await loadApps(join(f.orgHome, "apps.yaml"))).apps.map((app) => app.name)).toEqual([]);
    for (const rel of ["repos/alpha", "worktrees/alpha", "runs/alpha", "tickets/alpha"]) {
      expect(existsSync(join(f.stateHome, rel))).toBe(false);
    }
    expect(existsSync(join(f.stateHome, "approvals/decided/alpha-approved.json"))).toBe(false);
    expect(existsSync(join(f.stateHome, "approvals/grants/grant-alpha-approved.json"))).toBe(false);
    expect(readFileSync(join(f.stateHome, "telemetry/2026-07-11.jsonl"), "utf8")).not.toContain('"alpha"');
    expect(readFileSync(join(f.stateHome, "telemetry/2026-07-11.jsonl"), "utf8")).toContain('"beta"');
    expect(readFileSync(join(f.stateHome, "invocations/2026-07-11.jsonl"), "utf8")).not.toContain('"alpha"');
    expect(readFileSync(join(f.stateHome, "state/schedule.json"), "utf8")).not.toContain("alpha|");
    expect(readFileSync(join(f.stateHome, "state/budget-overlay.json"), "utf8")).not.toContain('"alpha"');

    expect((await f.gh.readIssue(7)).state).toBe("CLOSED");
    expect((await f.gh.readIssue(8)).state).toBe("OPEN");
    expect((await f.gh.readPR(1)).state).toBe("CLOSED");
    expect(f.gh.calls.map((call) => call.op)).toContain("deleteBranch");
  });

  it("refuses execution while a selected app has an active run", async () => {
    const f = await fixture();
    write(f.stateHome, "runs/alpha/live/envelope.json", JSON.stringify(runningEnvelope()));
    const input = await f.input();

    const plan = await planAppReset(input);

    expect(plan.blockers.join("\n")).toContain("active run(s): live");
    await expect(executeAppReset(input)).rejects.toThrow(/cannot reset "alpha" while active run/);
    expect(existsSync(join(f.stateHome, "repos", "alpha"))).toBe(true);
    expect((await f.gh.readIssue(7)).state).toBe("OPEN");
  });

  it("requires an exact app-name confirmation before resolving the active org", async () => {
    await expect(cmdApp(["reset", "alpha", "--execute"])).rejects.toThrow(
      "--execute requires --confirm alpha",
    );
  });
});

function completedEnvelope(): Record<string, unknown> {
  return {
    schema_version: 1,
    run_id: "run-1",
    trace_id: "trace-1",
    app: "alpha",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    status: "completed",
    started_at: "2026-07-11T00:00:00.000Z",
    finished_at: "2026-07-11T00:01:00.000Z",
    refs: { events: "events.jsonl", brief: "brief.md", output: "output.md", session_log: "session.log" },
  };
}

function runningEnvelope(): Record<string, unknown> {
  return { ...completedEnvelope(), run_id: "live", status: "running" };
}

function write(root: string, rel: string, contents: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}
