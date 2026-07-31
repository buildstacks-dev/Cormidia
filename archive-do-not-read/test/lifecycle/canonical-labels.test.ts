import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_LABELS } from "../../src/loop/plan-tickets.js";
import { lifecycleRecordPath, verifyApp } from "../../src/org/app-lifecycle.js";
import { FakeGhOps } from "../support/fakeGhOps.js";
import {
  READY_RUNTIME_PROBE,
  bootstrapReachable,
  makeLifecycleTestWorld,
  type LifecycleTestWorld,
} from "./helpers.js";

const worlds: LifecycleTestWorld[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.cleanup();
});

function check(report: Awaited<ReturnType<typeof verifyApp>>, id: string) {
  return report.checks.find((candidate) => candidate.id === id);
}

describe("app verification canonical GitHub labels", () => {
  it("reports labels not applicable for a local remote without constructing a GitHub client", async () => {
    const world = await makeLifecycleTestWorld();
    worlds.push(world);
    await bootstrapReachable(world);
    const githubFactory = vi.fn(() => {
      throw new Error("must not construct GhCliOps for a local remote");
    });

    const report = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      readinessProbe: READY_RUNTIME_PROBE,
      githubFactory,
    });

    expect(githubFactory).not.toHaveBeenCalled();
    expect(check(report, "canonical-labels")).toMatchObject({
      status: "pass",
      detail: expect.stringContaining("not applicable"),
    });
    expect(report.status).toBe("ready");
  });

  it("passes exact canonical definitions and blocks missing or drifted labels through FakeGhOps", async () => {
    const world = await makeLifecycleTestWorld();
    worlds.push(world);
    await bootstrapReachable(world);
    const gh = new FakeGhOps({ repo: "local/sparse" });
    for (const label of CANONICAL_LABELS) await gh.ensureLabel(label);

    const exact = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      readinessProbe: READY_RUNTIME_PROBE,
      github: gh,
    });
    expect(check(exact, "canonical-labels")).toMatchObject({ status: "pass" });
    expect(exact.status).toBe("ready");

    gh.repoLabels.delete("op:building");
    gh.repoLabelDefinitions.delete("op:building");
    const missing = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      readinessProbe: READY_RUNTIME_PROBE,
      github: gh,
    });
    expect(check(missing, "canonical-labels")).toMatchObject({
      status: "blocked",
      detail: expect.stringContaining("missing: op:building"),
      remediation: expect.stringContaining("gh label create --force"),
    });
    expect(missing.status).toBe("blocked");

    const building = CANONICAL_LABELS.find((label) => label.name === "op:building")!;
    await gh.ensureLabel({ ...building, color: "ffffff" });
    const drifted = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      readinessProbe: READY_RUNTIME_PROBE,
      github: gh,
    });
    expect(check(drifted, "canonical-labels")).toMatchObject({
      status: "blocked",
      detail: expect.stringContaining("definition drift: op:building"),
    });
    expect(drifted.status).toBe("blocked");
  });

  it("invokes the bounded reader and fails closed for a matching GitHub remote", async () => {
    const world = await makeLifecycleTestWorld();
    worlds.push(world);
    await bootstrapReachable(world);
    const recordPath = lifecycleRecordPath(world.stateHome, "sparse");
    const record = JSON.parse(readFileSync(recordPath, "utf8")) as { remote_url: string; repo: string };
    record.remote_url = `https://github.com/${record.repo}.git`;
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    const gh = new FakeGhOps({ repo: record.repo });
    const githubFactory = vi.fn(() => gh);

    const report = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      readinessProbe: READY_RUNTIME_PROBE,
      githubFactory,
      fault: (point) => {
        if (point === "before_git_fetch") throw new Error("offline fixture: skip remote read");
      },
    });

    expect(githubFactory).toHaveBeenCalledOnce();
    expect(githubFactory).toHaveBeenCalledWith(record.repo);
    expect(check(report, "canonical-labels")).toMatchObject({
      status: "blocked",
      detail: expect.stringContaining("missing: op:ready"),
    });
  });
});
