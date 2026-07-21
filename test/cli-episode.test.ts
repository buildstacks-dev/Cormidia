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

const COMPLETE_EXPLANATION = {
  schemaVersion: 2,
  episodeId: "ticket:fixture:#42",
  evidenceDir: "/state/operon/efficiency/episodes/deadbeef",
  complete: true,
  problems: [],
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
  executionSteps: [],
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
    authorizationStatus: "authorized",
    authorizedPlanVersion: 2,
    authorizationDetail: null,
  }],
};

describe("episode explain CLI", () => {
  beforeEach(() => {
    mocks.resolveOperonHomes.mockResolvedValue({ stateHome: "/state/operon" });
    mocks.explainEpisode.mockResolvedValue(structuredClone(COMPLETE_EXPLANATION));
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
      "evidence: /state/operon/efficiency/episodes/deadbeef",
      "plan: v2 episode_planner",
      "workflow: localized-bug",
      "budget: $1.25 estimated",
      "safety route: standard",
      "build: pending provider builder codex/gpt-5.6-sol/high [episode_planner] — approved capable implementation assignment",
    ]);
  });

  it("renders and exits non-zero when the explanation is incomplete", async () => {
    mocks.explainEpisode.mockResolvedValue({
      ...structuredClone(COMPLETE_EXPLANATION),
      complete: false,
      problems: [{
        code: "step_authorization_unresolved",
        message: "0 matching route authorizations for plan v2",
        stepId: "build",
      }],
      steps: [{
        ...structuredClone(COMPLETE_EXPLANATION.steps[0]!),
        routeAuthorized: false,
        authorizationStatus: "unresolved",
        authorizedPlanVersion: null,
        authorizationDetail: "0 matching route authorizations for plan v2",
      }],
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(cmdEpisode(["explain", "ticket:fixture:#42", "--state-home", "/s"]))
      .resolves.toBe(1);

    const lines = log.mock.calls.map((call) => call.join(" "));
    // The whole explanation is still printed — the failure is an annotation.
    expect(lines).toContain("plan: v2 episode_planner");
    expect(lines).toContain("workflow: localized-bug");
    expect(lines.some((line) =>
      line.startsWith("build: pending provider builder") &&
      line.includes("assignment unresolved: 0 matching route authorizations for plan v2")
    )).toBe(true);
    expect(lines).toContain("incomplete explanation (1 unresolved):");
    expect(lines).toContain(
      "  step_authorization_unresolved [build]: 0 matching route authorizations for plan v2",
    );
  });

  it("renders a plan-less episode from route and durable execution steps", async () => {
    mocks.explainEpisode.mockResolvedValue({
      ...structuredClone(COMPLETE_EXPLANATION),
      complete: false,
      problems: [
        { code: "intent_missing", message: "episode has no persisted immutable intent", stepId: null },
        { code: "plan_missing", message: "episode has no accepted durable EpisodePlan", stepId: null },
      ],
      intent: null,
      intentHash: null,
      plan: null,
      planHash: null,
      planningSource: null,
      route: { current_route: "deterministic", terminal: { status: "completed" } },
      steps: [],
      executionSteps: [{
        executionStepId: "lifecycle-abc:mechanical:1",
        kind: "mechanical",
        operation: "app verify",
        role: null,
        assignment: null,
        status: "completed",
        startedAt: "2026-07-21T09:21:43.635Z",
        finishedAt: "2026-07-21T09:21:43.636Z",
        errorCode: null,
        reason: "synthesized lifecycle record",
        planVersion: null,
        planStepId: null,
      }],
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(cmdEpisode(["explain", "lifecycle:fixture:abc", "--state-home", "/s"]))
      .resolves.toBe(1);

    const lines = log.mock.calls.map((call) => call.join(" "));
    expect(lines).toContain("plan: none (no accepted durable EpisodePlan)");
    expect(lines).toContain("route: deterministic terminal completed");
    expect(lines).toContain("durable execution steps (1):");
    expect(lines).toContain(
      "  2026-07-21T09:21:43.635Z completed app verify mechanical",
    );
    expect(lines).not.toContain("workflow: undefined");
  });

  it("emits the whole explanation as JSON and mirrors the exit code", async () => {
    mocks.explainEpisode.mockResolvedValue({
      ...structuredClone(COMPLETE_EXPLANATION),
      complete: false,
      problems: [{ code: "plan_missing", message: "no plan", stepId: null }],
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(cmdEpisode(["explain", "ticket:fixture:#42", "--state-home", "/s", "--json"]))
      .resolves.toBe(1);

    expect(log).toHaveBeenCalledOnce();
    const parsed = JSON.parse(log.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      schemaVersion: 2,
      episodeId: "ticket:fixture:#42",
      complete: false,
      problems: [{ code: "plan_missing", message: "no plan", stepId: null }],
    });
  });

  it("rejects an unknown flag rather than treating it as an episode id", async () => {
    await expect(cmdEpisode(["explain", "ticket:fixture:#42", "--limit"]))
      .rejects.toThrow('episode: unknown flag "--limit"');
    expect(mocks.explainEpisode).not.toHaveBeenCalled();
  });
});
