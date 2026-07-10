// Tests active state-home resolution for status and analyze commands.
// Covers consuming the shared resolver and honoring explicit --home overrides.
// Uses module mocks only; no real org state,
// network, auth, or wall-clock time is required.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readStatusRoots: string[] = [];
const analyzeRoots: string[] = [];

vi.mock("../src/org/home.js", () => ({
  resolveOperonHomes: async () => ({ stateHome: "/tmp/active-operon-state" }),
}));

vi.mock("../src/runtime/runlog/status.js", () => ({
  readStatusRows: async (root: string) => {
    readStatusRoots.push(root);
    return [];
  },
  formatStatusRows: () => "",
}));

vi.mock("../src/runtime/runlog/anomalies.js", () => ({
  analyzeRunlogs: async (root: string) => {
    analyzeRoots.push(root);
    return [];
  },
}));

import { cmdStatus } from "../src/cli/status.js";
import { cmdAnalyze } from "../src/cli/analyze.js";

describe("status/analyze default org home", () => {
  beforeEach(() => {
    readStatusRoots.length = 0;
    analyzeRoots.length = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("status reads from the resolved active state home when no --home is given", async () => {
    await cmdStatus([]);
    expect(readStatusRoots).toEqual(["/tmp/active-operon-state"]);
  });

  it("analyze reads from the resolved active state home when no --home is given", async () => {
    await cmdAnalyze([]);
    expect(analyzeRoots).toEqual(["/tmp/active-operon-state"]);
  });

  it("an explicit --home still wins over the apps.yaml default", async () => {
    await cmdStatus(["--home", "/tmp/explicit-home"]);
    expect(readStatusRoots).toEqual(["/tmp/explicit-home"]);
  });
});
