import { describe, expect, it, vi } from "vitest";
import { probeApprovedAssignmentReadiness } from "../src/org/episode-planner/assignment-readiness.js";
import type { AppEntry } from "../src/org/apps.js";
import type { RoleConfig } from "../src/runtime/types.js";

describe("adaptive assignment readiness", () => {
  it("probes the fixed planner boot tuple even when adaptive narrowing excludes it", async () => {
    const probe = vi.fn(async (request: { runtime: "codex" | "claude" | "pi"; models: string[] }) => ({
      runtime: request.runtime,
      models: [...request.models],
      status: "ready" as const,
      detail: "test adapter ready; no model turn sent",
      durationMs: 1,
      billable: false as const,
    }));
    const snapshot = await probeApprovedAssignmentReadiness({
      app: APP,
      roles: ROLES,
      probe,
    });

    expect(probe.mock.calls.map(([request]) => request.models[0]).sort()).toEqual([
      "adaptive-builder",
      "adaptive-planner",
      "fixed-planner-boot",
    ]);
    expect(snapshot.resultFor({
      harness: "codex",
      model: "fixed-planner-boot",
      effort: "high",
    })?.status).toBe("ready");
  });
});

const APP: AppEntry = {
  name: "adaptive-readiness",
  repo: "example/adaptive-readiness",
  status: "live",
  budgetUsdMonth: 100,
  cadence: {},
  execution: {
    assignmentMode: "adaptive",
    allowedAssignments: {
      planner: ["adaptive-planner"],
      builder: ["adaptive-builder"],
    },
  },
};

const ROLES: RoleConfig[] = [{
  name: "planner",
  runtime: "codex",
  model: "fixed-planner-boot",
  effort: "high",
  adaptiveAssignments: [{
    id: "adaptive-planner",
    harness: "codex",
    model: "adaptive-planner",
    efforts: ["medium"],
    providerFamily: "openai",
    capabilityRef: "codex/v1",
    qualificationRef: "qualification:test-adaptive-planner",
    pricing: {
      kind: "conservative_estimate",
      maxTurnCostUsd: 1,
      sourceRef: "qualification:test-adaptive-planner-price",
    },
  }],
  delegation: { allow: [] },
  triggers: [],
  outputs: ["episode-plan"],
  maxTurnBudgetUsd: 2,
}, {
  name: "builder",
  runtime: "codex",
  model: "fixed-builder",
  effort: "high",
  adaptiveAssignments: [{
    id: "adaptive-builder",
    harness: "claude",
    model: "adaptive-builder",
    efforts: ["medium"],
    providerFamily: "anthropic",
    capabilityRef: "claude/v1",
    qualificationRef: "qualification:test-adaptive-builder",
    pricing: {
      kind: "conservative_estimate",
      maxTurnCostUsd: 1,
      sourceRef: "qualification:test-adaptive-builder-price",
    },
  }],
  delegation: { allow: [] },
  triggers: [],
  outputs: ["patch"],
  maxTurnBudgetUsd: 2,
}];
