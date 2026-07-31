import { describe, expect, it } from "vitest";
import type { AppEntry } from "../src/org/apps.js";
import { resolveAppAssignments } from "../src/org/execution-assignments.js";
import type { RoleConfig } from "../src/runtime/types.js";

function role(name: string, runtime: RoleConfig["runtime"] = "codex"): RoleConfig {
  return {
    name,
    runtime,
    model: runtime === "claude" ? "claude-exact" : "gpt-exact",
    effort: "high",
    adaptiveAssignments: [
      {
        id: "economical",
        harness: runtime,
        model: runtime === "claude" ? "claude-exact" : "gpt-exact",
        efforts: ["medium"],
        providerFamily: runtime === "claude" ? "anthropic" : "openai",
        capabilityRef: `${runtime}/v1`,
        qualificationRef: `qualification/${runtime}/exact`,
        pricing: {
          kind: "conservative_estimate",
          maxTurnCostUsd: 2,
          sourceRef: "qualification/upper-bound",
        },
      },
    ],
    delegation: { allow: [] },
    triggers: [],
    outputs: [],
    maxTurnBudgetUsd: 5,
  };
}

function app(execution?: AppEntry["execution"]): Pick<AppEntry, "name" | "execution"> {
  return { name: "demo", ...(execution === undefined ? {} : { execution }) };
}

describe("resolveAppAssignments", () => {
  const roles = [role("planner", "claude"), role("builder")];

  it("defaults legacy apps to fixed configured tuples without disabling planning", () => {
    const resolved = resolveAppAssignments(app(), roles);
    expect(resolved.mode).toBe("fixed");
    expect(resolved.plannerBootAssignment).toEqual({
      harness: "claude",
      model: "claude-exact",
      effort: "high",
    });
    expect(resolved.roles.map((entry) => [entry.role, entry.assignments.map((a) => a.candidateId)]))
      .toEqual([
        ["builder", ["configured"]],
        ["planner", ["configured"]],
      ]);
  });

  it("lets adaptive app policy narrow but never widen role-owned candidates", () => {
    const resolved = resolveAppAssignments(app({
      assignmentMode: "adaptive",
      allowedAssignments: { builder: ["economical"], planner: ["configured"] },
    }), roles);
    expect(resolved.roles.find((entry) => entry.role === "builder")?.assignments).toMatchObject([
      {
        candidateId: "economical",
        assignment: { harness: "codex", model: "gpt-exact", effort: "medium" },
      },
    ]);

    expect(() => resolveAppAssignments(app({
      assignmentMode: "adaptive",
      allowedAssignments: { builder: ["invented"] },
    }), roles)).toThrow(/unknown candidate\(s\): invented/);
  });

  it("fails empty narrowing, unknown roles, and a missing fixed planner boot role", () => {
    expect(() => resolveAppAssignments(app({
      assignmentMode: "adaptive",
      allowedAssignments: { builder: [] },
    }), roles)).toThrow(/leaves no approved candidates/);
    expect(() => resolveAppAssignments(app({
      assignmentMode: "adaptive",
      allowedAssignments: { deployer: ["configured"] },
    }), roles)).toThrow(/unknown role\(s\): deployer/);
    expect(() => resolveAppAssignments(app(), [role("builder")])).toThrow(/no planner boot role/);
  });
});
