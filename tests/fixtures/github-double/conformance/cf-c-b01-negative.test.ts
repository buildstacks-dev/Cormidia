// CF-C-B01 — negative controls for the conformance detector (HB-003
// acceptance: "a deliberately lying fake variant fails the suite").
//
// The conformance suite is this boundary's detector family; per the harness
// rule, it must land red-then-green: these tests seed deliberately lying fake
// variants and assert the suite FIRES. A suite that cannot reject a liar
// would certify nothing about the honest fake either.

import { afterEach, describe, expect, it } from "vitest";

import { installGithubDouble, type GithubDoubleHandle, type GithubDoubleOptions } from "../install.js";
import { makeGithubDoubleSurface } from "./double-surface.js";
import { runGithubConformance } from "./suite.js";

describe("CF-C-B01 — conformance suite negative controls (lying fakes must fail)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function activatedDouble(options: GithubDoubleOptions): Promise<GithubDoubleHandle> {
    const handle = await installGithubDouble(options);
    cleanups.push(() => handle.dispose());
    cleanups.push(handle.activatePath());
    return handle;
  }

  it("negative control: conformance suite rejects a fake that reports merge success without recording it", {
    timeout: 120_000,
  }, async () => {
    const handle = await activatedDouble({ lies: { mergeNotRecorded: true } });
    const report = await runGithubConformance(makeGithubDoubleSurface(handle));

    const failedIds = report.failures.map((failure) => failure.id);
    expect(failedIds).toContain("B01-CF-11");
    // The lie also breaks the linked-issue close (nothing merged = nothing
    // closed) — the detector fires on the consequence, too.
    expect(failedIds).toContain("B01-CF-12");
    // The liar fails for its LIE, not because the run never got going: honest
    // clauses still pass around it.
    expect(report.passed).toContain("B01-CF-02");
    expect(report.passed).toContain("B01-CF-08");
    expect(report.passed.length + report.failures.length).toBe(report.total);
  });

  it("negative control: conformance suite rejects a fake reporting the wrong default branch", {
    timeout: 120_000,
  }, async () => {
    // The subtle variant: "trunk" really exists, every direct call succeeds,
    // only the SEMANTIC cross-check (linked-issue close happens solely on the
    // true default branch) exposes that the reported default is a lie — the
    // guessed-default-branch failure shape from the boundary map.
    const handle = await activatedDouble({
      defaultBranch: "main",
      branches: ["trunk"],
      lies: { reportedDefaultBranch: "trunk" },
    });
    const report = await runGithubConformance(makeGithubDoubleSurface(handle));

    const failedIds = report.failures.map((failure) => failure.id);
    expect(failedIds).toContain("B01-CF-12");
    expect(report.passed).toContain("B01-CF-02");
    expect(report.passed.length + report.failures.length).toBe(report.total);
  });

  it("negative control: an empty clause walk fails loudly instead of passing", async () => {
    const handle = await activatedDouble({});
    await expect(runGithubConformance(makeGithubDoubleSurface(handle), { clauseFilter: () => false })).rejects.toThrow(
      /empty clause walk/,
    );
  });
});
