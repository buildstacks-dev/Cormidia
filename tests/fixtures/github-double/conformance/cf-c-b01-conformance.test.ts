// CF-C-B01 — conformance run against the honest double (HB-003).
//
// This is the fake half of the CF-B01-L3 conformance pair: the identical
// clause suite (conformance/suite.ts) later runs against the real `gh` CLI on
// a sandbox repo (HB-052). Here it runs against the double through a bare
// `new GhCliOps(repo)` with the PATH shim active — product code unmodified.

import { afterEach, describe, expect, it } from "vitest";

import { installGithubDouble, type GithubDoubleHandle } from "../install.js";
import { makeGithubDoubleSurface } from "./double-surface.js";
import { GITHUB_CONFORMANCE_CLAUSE_COUNT, runGithubConformance } from "./suite.js";

describe("CF-C-B01 — GitHub surface conformance, fake target (pair of CF-B01-L3)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function activatedDouble(): Promise<GithubDoubleHandle> {
    const handle = await installGithubDouble();
    cleanups.push(() => handle.dispose());
    cleanups.push(handle.activatePath());
    return handle;
  }

  it("the honest double passes every conformance clause through unmodified GhCliOps", {
    timeout: 120_000,
  }, async () => {
    const handle = await activatedDouble();
    const report = await runGithubConformance(makeGithubDoubleSurface(handle), {
      // Strict read-back: the fake never gets to hide behind retries.
      readBackAttempts: 1,
    });

    expect(report.failures).toEqual([]);
    // Non-empty walk, asserted against the exported clause count — a filter
    // bug that silently ran fewer clauses would fail here, not pass quietly.
    expect(report.total).toBe(GITHUB_CONFORMANCE_CLAUSE_COUNT);
    expect(report.passed).toHaveLength(GITHUB_CONFORMANCE_CLAUSE_COUNT);
    expect(GITHUB_CONFORMANCE_CLAUSE_COUNT).toBeGreaterThanOrEqual(15);

    // And the whole run crossed the process seam: the double logged the calls.
    expect(handle.callLog().length).toBeGreaterThan(GITHUB_CONFORMANCE_CLAUSE_COUNT);
  });
});
