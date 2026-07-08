// Tests default org-home resolution for status and analyze commands.
// Covers deriving ~/.operon/<org name> from apps.yaml and honoring explicit
// --home overrides.
// Uses module mocks and a stubbed homedir calculation only; no real org state,
// network, auth, or wall-clock time is required.

import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readStatusRoots: string[] = [];
const analyzeRoots: string[] = [];

vi.mock("../src/org/apps.js", () => ({
  loadApps: async () => ({ org: { name: "renamed-org" }, apps: [] }),
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
  const savedHome = process.env.OPERON_HOME;

  beforeEach(() => {
    delete process.env.OPERON_HOME;
    readStatusRoots.length = 0;
    analyzeRoots.length = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.OPERON_HOME;
    else process.env.OPERON_HOME = savedHome;
    vi.restoreAllMocks();
  });

  it("status reads from ~/.operon/<org name> when no --home is given", async () => {
    await cmdStatus([]);
    expect(readStatusRoots).toEqual([join(homedir(), ".operon", "renamed-org")]);
  });

  it("analyze reads from ~/.operon/<org name> when no --home is given", async () => {
    await cmdAnalyze([]);
    expect(analyzeRoots).toEqual([join(homedir(), ".operon", "renamed-org")]);
  });

  it("an explicit --home still wins over the apps.yaml default", async () => {
    await cmdStatus(["--home", "/tmp/explicit-home"]);
    expect(readStatusRoots).toEqual(["/tmp/explicit-home"]);
  });
});
