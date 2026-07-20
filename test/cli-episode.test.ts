import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveOperonHomes: vi.fn(),
  explainEpisode: vi.fn(),
}));

vi.mock("../src/org/home.js", () => ({
  resolveOperonHomes: mocks.resolveOperonHomes,
}));

vi.mock("../src/org/episode-planner/orchestrator.js", () => ({
  explainEpisode: mocks.explainEpisode,
}));

import { cmdEpisode } from "../src/cli/episode.js";

describe("episode explain CLI", () => {
  beforeEach(() => {
    mocks.resolveOperonHomes.mockResolvedValue({ stateHome: "/state/operon" });
    mocks.explainEpisode.mockResolvedValue({
      schemaVersion: 1,
      episodeId: "ticket:fixture:#42",
      intent: { episodeId: "ticket:fixture:#42" },
      intentHash: "a".repeat(64),
      plan: {
        version: 2,
        workflowClass: "localized-bug",
        estimatedBudget: { totalBudgetUsd: 1.25 },
        derivedSafetyRoute: { label: "standard" },
      },
      planHash: "b".repeat(64),
      route: null,
      journal: null,
      planningSource: "episode_planner",
      planningTurnSkipped: false,
      steps: [{
        id: "build",
        kind: "provider_turn",
        objective: "Implement the fix",
        dependsOn: [],
        status: "pending",
        operation: "build/implement",
        role: "builder",
        assignment: { harness: "codex", model: "gpt-5.6-sol", effort: "high" },
        assignmentSource: "episode_planner",
        selectionReason: "approved capable implementation assignment",
        assignmentCandidateId: "builder-primary",
        providerFamily: "openai",
        resolvedCapabilities: ["tool_gate"],
        routeAuthorized: true,
      }],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("renders the durable exact assignment and rationale without constructing a runtime", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(cmdEpisode([
      "explain",
      "ticket:fixture:#42",
      "--state-home",
      "/state/operon",
    ])).resolves.toBe(0);

    expect(mocks.resolveOperonHomes).toHaveBeenCalledWith({
      stateHome: "/state/operon",
      rest: ["explain", "ticket:fixture:#42"],
    });
    expect(mocks.explainEpisode).toHaveBeenCalledWith("/state/operon", "ticket:fixture:#42");
    expect(log.mock.calls.map((call) => call.join(" "))).toEqual([
      "episode: ticket:fixture:#42",
      "plan: v2 episode_planner",
      "workflow: localized-bug",
      "budget: $1.25 estimated",
      "safety route: standard",
      "build: pending provider builder codex/gpt-5.6-sol/high [episode_planner] — approved capable implementation assignment",
    ]);
  });
});
