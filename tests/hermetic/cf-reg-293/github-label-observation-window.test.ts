// CF-REG-293 — release qualification must give GitHub's label-filtered issue
// projection a useful observation window without widening the ratified
// three-attempt count or changing inconclusive evidence into pass/fail.

import { describe, expect, it } from "vitest";

import { releaseGithubConformanceOptions } from "../../live/github-conformance-policy.js";

describe("CF-REG-293 — live label-search observation window", () => {
  it("uses exactly three attempts and two minutes for the label-search projection only", () => {
    expect(releaseGithubConformanceOptions()).toEqual({
      readBackAttempts: 3,
      readBackDelayMs: 1_000,
      labelSearchReadBackDelayMs: 60_000,
    });
  });

  it("negative control: the legacy one-second label-search interval is refused", () => {
    expect(() => releaseGithubConformanceOptions({
      readBackAttempts: 3,
      readBackDelayMs: 1_000,
      labelSearchReadBackDelayMs: 1_000,
    })).toThrow(/label-search.*exactly 60000ms/);
  });

  it("negative control: the label-search interval cannot widen beyond two minutes total", () => {
    expect(() => releaseGithubConformanceOptions({
      readBackAttempts: 3,
      readBackDelayMs: 1_000,
      labelSearchReadBackDelayMs: 90_000,
    })).toThrow(/label-search.*exactly 60000ms/);
  });

  it("negative control: the policy cannot widen beyond three attempts", () => {
    expect(() => releaseGithubConformanceOptions({
      readBackAttempts: 4,
      readBackDelayMs: 1_000,
      labelSearchReadBackDelayMs: 60_000,
    })).toThrow(/exactly three attempts/);
  });

  it("negative control: ordinary readback cannot be broadened with the search window", () => {
    expect(() => releaseGithubConformanceOptions({
      readBackAttempts: 3,
      readBackDelayMs: 60_000,
      labelSearchReadBackDelayMs: 60_000,
    })).toThrow(/general readback interval must remain 1000ms/);
  });
});
