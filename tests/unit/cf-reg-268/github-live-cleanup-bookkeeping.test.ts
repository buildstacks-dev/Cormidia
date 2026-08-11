// CF-REG-268 — HB-139 — case-catalog.md §10.3, defect #268.

// CF-REG-268 — successful conformance branch deletion consumes the tracked
// cleanup effect. The seeded bypass below reproduces the stale bookkeeping
// that made a clean real-GitHub walk report one false cleanup failure.

import { describe, expect, it } from "vitest";

import type { GhOps } from "../../../src/loop/github.js";
import { trackGithubConformanceOps, type GithubConformanceArtifactTracker } from "../../live/real-github-surface.js";

function tracker(branch: string): GithubConformanceArtifactTracker {
  return {
    issues: new Set<number>(),
    prs: new Set<number>(),
    branches: new Set([branch]),
    labels: new Set<string>(),
  };
}

function deletingRaw(active: Set<string>, calls: string[]): GhOps {
  return {
    async deleteBranch(branch: string): Promise<void> {
      calls.push(branch);
      if (!active.delete(branch)) throw new Error(`Reference does not exist: ${branch}`);
    },
  } as GhOps;
}

describe("CF-REG-268 — live GitHub cleanup bookkeeping", () => {
  it("removes a successfully deleted branch from the outstanding cleanup set", async () => {
    const branch = "cormidia-conformance/already-consumed";
    const active = new Set([branch]);
    const calls: string[] = [];
    const artifacts = tracker(branch);
    const ops = trackGithubConformanceOps(deletingRaw(active, calls), artifacts);

    await ops.deleteBranch(branch);

    expect(active).toEqual(new Set());
    expect(artifacts.branches).toEqual(new Set());
    expect(calls).toEqual([branch]);
  });

  it("seeded negative control: bypassed tracking leaves a stale branch that fails final cleanup", async () => {
    const branch = "cormidia-conformance/seeded-stale-bookkeeping";
    const active = new Set([branch]);
    const calls: string[] = [];
    const artifacts = tracker(branch);
    const raw = deletingRaw(active, calls);

    // Seed the pre-fix violation: the branch effect is consumed directly,
    // without the tracking wrapper observing the successful deletion.
    await raw.deleteBranch(branch);

    expect(artifacts.branches).toEqual(new Set([branch]));
    await expect(raw.deleteBranch(branch)).rejects.toThrow(/Reference does not exist/);
    expect(calls).toEqual([branch, branch]);
  });
});
