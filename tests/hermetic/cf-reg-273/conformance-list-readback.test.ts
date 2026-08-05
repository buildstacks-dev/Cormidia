// CF-REG-273 — GitHub recorded a create-time label immediately, but its
// label-filtered issue search lagged the direct entity read. B01-CF-02 must
// apply the suite's bounded readback policy to both projections.

import { afterEach, describe, expect, it } from "vitest";
import type { GhOps } from "../../../src/loop/github.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";
import { makeGithubDoubleSurface } from "../../fixtures/github-double/conformance/double-surface.js";
import {
  runGithubConformance,
  type GithubConformanceSurface,
} from "../../fixtures/github-double/conformance/suite.js";

describe("CF-REG-273 — label-filtered conformance readback is eventually visible", () => {
  let handle: GithubDoubleHandle | undefined;
  let restorePath: (() => void) | undefined;

  afterEach(async () => {
    restorePath?.();
    await handle?.dispose();
    restorePath = undefined;
    handle = undefined;
  });

  async function delayedListSurface(misses: number): Promise<{
    surface: GithubConformanceSurface;
    calls: () => number;
  }> {
    handle = await installGithubDouble();
    restorePath = handle.activatePath();
    const base = makeGithubDoubleSurface(handle);
    let listCalls = 0;
    const ops = new Proxy(base.ops, {
      get(target, property) {
        if (property === "listIssues") {
          return async (options: Parameters<GhOps["listIssues"]>[0]) => {
            listCalls += 1;
            if (listCalls <= misses) return [];
            return target.listIssues(options);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GhOps;
    return { surface: { ...base, ops }, calls: () => listCalls };
  }

  it("passes after two delayed label-search projections within three attempts", async () => {
    const { surface, calls } = await delayedListSurface(2);
    const report = await runGithubConformance(surface, {
      clauseFilter: (id) => id === "B01-CF-02",
      readBackAttempts: 3,
      readBackDelayMs: 0,
    });

    expect(report.failures).toEqual([]);
    expect(report.passed).toEqual(["B01-CF-02"]);
    expect(calls()).toBe(3);
  });

  it("negative control: the same delayed projection is caught when retry is seeded away", async () => {
    const { surface, calls } = await delayedListSurface(1);
    const report = await runGithubConformance(surface, {
      clauseFilter: (id) => id === "B01-CF-02",
      readBackAttempts: 1,
      readBackDelayMs: 0,
    });

    expect(report.passed).toEqual([]);
    expect(report.failures.map((failure) => failure.id)).toEqual(["B01-CF-02"]);
    expect(report.failures).toMatchObject([{
      classification: "observation_inconclusive",
      code: "label_filtered_issue_search_not_observed",
    }]);
    expect(calls()).toBe(1);
  });

  it("negative control: a direct artifact mismatch remains a product violation", async () => {
    handle = await installGithubDouble();
    restorePath = handle.activatePath();
    const base = makeGithubDoubleSurface(handle);
    const ops = new Proxy(base.ops, {
      get(target, property) {
        if (property === "readIssue") {
          return async (number: number) => ({
            ...(await target.readIssue(number)),
            title: "seeded wrong title",
          });
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GhOps;

    const report = await runGithubConformance(
      { ...base, ops },
      {
        clauseFilter: (id) => id === "B01-CF-02",
        readBackAttempts: 3,
        readBackDelayMs: 0,
      },
    );

    expect(report.passed).toEqual([]);
    expect(report.failures).toMatchObject([{
      id: "B01-CF-02",
      classification: "violation",
      code: "assertion_failed",
    }]);
  });
});
