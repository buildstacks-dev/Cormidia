// Runtime capability advertisement is a deterministic projection of the
// selected harness profile plus the role's existing delegation policy. These
// tests construct no runtime and make no provider or network calls.

import { describe, expect, it } from "vitest";
import {
  RUNTIME_CAPABILITIES,
  resolvedRuntimeCapabilities,
  runtimeCapabilityGuidance,
  runtimeCapabilityProfile,
  runtimeCapabilitySupportLabel,
} from "../../src/runtime/capabilities.js";
import {
  buildTurnExecutionFacts,
  resolveTurnRequestAssignment,
  validateTurnExecutionFacts,
} from "../../src/runtime/assignment.js";
import { renderContextBundle } from "../../src/runtime/worktree-context.js";
import type { RuntimeKind, TurnAssignment } from "../../src/runtime/types.js";

const ROLE = {
  name: "builder",
  delegation: { allow: ["test-fanout", "explore"] },
};
const ROLE_CONFIG = {
  ...ROLE,
  runtime: "claude" as const,
  model: "claude-exact",
  effort: "high" as const,
  triggers: [],
  outputs: ["pr"],
  maxTurnBudgetUsd: 5,
};

function assignment(harness: RuntimeKind): TurnAssignment {
  return { harness, model: `${harness}-exact`, effort: "high" };
}

function render(harness: RuntimeKind): string {
  return renderContextBundle({
    taste: ["role authority stays fixed"],
    memoryExcerpts: [],
    execution: buildTurnExecutionFacts(assignment(harness), ROLE, ["tool_gate"]),
  });
}

describe("runtime capability profiles and in-turn guidance", () => {
  it("declares fan-out honestly and returns defensive profile copies", () => {
    expect(runtimeCapabilityProfile("claude").capabilities.intra_turn_fanout).toBe("native");
    expect(runtimeCapabilityProfile("codex").capabilities.intra_turn_fanout).toBe("native");
    expect(runtimeCapabilityProfile("pi").capabilities.intra_turn_fanout).toBe("unsupported");
    expect(runtimeCapabilityProfile("pi").capabilities.structured_verdict).toBe("fallback");
    expect(resolvedRuntimeCapabilities("pi")).not.toContain("intra_turn_fanout");

    const modified = runtimeCapabilityProfile("claude");
    modified.capabilities.tool_gate = "unsupported";
    modified.cache.fields.push("caller-mutation");
    expect(runtimeCapabilityProfile("claude")).toMatchObject({
      capabilities: { tool_gate: "native" },
      cache: { fields: ["tokensInUncached", "cacheCreationTokens", "cacheReadTokens"] },
    });
  });

  it("derives different per-runtime notes from the same role without changing authority", () => {
    const claude = render("claude");
    const pi = render("pi");

    expect(claude).not.toBe(pi);
    expect(claude).toContain("- intra-turn fan-out: native");
    expect(claude).toContain("Role-approved subagent types: explore, test-fanout. Use no others.");
    expect(pi).toContain("- intra-turn fan-out: unsupported; unavailable—work serially");
    expect(pi).toContain("this harness has no fan-out surface; do not spawn subagents");
    expect(pi).toContain("- structured verdict: fallback (degraded)");
    for (const text of [claude, pi]) {
      expect(text).toContain("- tool gate:");
      expect(text).toContain("required for this turn");
      expect(text).toContain("does not change the role's tools, permissions, or approval boundaries");
    }
  });

  it("renders every support tier directly from the selected profile", () => {
    for (const harness of ["claude", "codex", "pi"] as const) {
      const text = render(harness);
      const profile = runtimeCapabilityProfile(harness);
      const guidance = runtimeCapabilityGuidance(harness);
      expect(profile.ref).toBe(`${harness}/v1`);
      for (const [index, capability] of RUNTIME_CAPABILITIES.entries()) {
        const tier = runtimeCapabilitySupportLabel(profile.capabilities[capability]);
        expect(guidance[index]).toContain(`: ${tier}`);
        expect(text).toContain(guidance[index]);
      }
      expect(buildTurnExecutionFacts(assignment(harness), ROLE).resolvedCapabilities)
        .toEqual(resolvedRuntimeCapabilities(harness));
    }
  });

  it("rejects caller-spoofed profiles, duplicate facts, and unsupported requirements", () => {
    const facts = buildTurnExecutionFacts(assignment("pi"), ROLE);
    expect(() => validateTurnExecutionFacts({
      ...facts,
      resolvedCapabilities: [...facts.resolvedCapabilities, "intra_turn_fanout"],
    })).toThrow(/must exactly match pi\/v1/);
    expect(() => validateTurnExecutionFacts({
      ...facts,
      requiredCapabilities: ["tool_gate", "tool_gate"],
    })).toThrow(/duplicates "tool_gate"/);
    expect(() => buildTurnExecutionFacts(
      assignment("pi"),
      ROLE,
      ["intra_turn_fanout"],
    )).toThrow(/pi lacks required capability intra_turn_fanout/);
  });

  it("rejects advertised delegation that is broader than the role policy", () => {
    const selected = assignment("claude");
    const execution = buildTurnExecutionFacts(selected, ROLE_CONFIG);
    expect(() => resolveTurnRequestAssignment({
      role: ROLE_CONFIG,
      assignment: selected,
      context: {
        taste: [],
        memoryExcerpts: [],
        execution: {
          ...execution,
          roleDelegation: { allow: [...execution.roleDelegation.allow, "release-admin"] },
        },
      },
    }, "claude")).toThrow(/delegation does not match the turn request role/);
  });
});
