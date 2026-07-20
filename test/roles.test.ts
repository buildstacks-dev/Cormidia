// Tests the real root roles.yaml through src/org/roles.ts.
// Covers required role/default parsing, non-empty triggers/outputs, and the
// product invariant that builder and reviewer use different provider families.
// Reads repo-local config only; no network, auth, real org state, or wall-clock
// time is required.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import {
  CONFIGURED_ASSIGNMENT_CANDIDATE_ID,
  configuredProviderFamily,
  fixedAssignmentFromRole,
  isAssignmentCandidateId,
  turnAssignmentKey,
  turnAssignmentsEqual,
  validateAssignmentProviderFamily,
  validateTurnAssignment,
} from "../src/runtime/assignment.js";
import {
  loadRoles,
  resolveApprovedAssignmentCandidates,
  resolveApprovedTurnAssignments,
} from "../src/org/roles.js";

const ROLES_PATH = fileURLToPath(new URL("../roles.yaml", import.meta.url));

describe("roles.yaml", () => {
  it("parses and validates", async () => {
    const { roles, defaults } = await loadRoles(ROLES_PATH);
    expect(defaults.maxTurnBudgetUsd).toBeGreaterThan(0);
    expect(roles.map((r) => r.name).sort()).toEqual(
      [
        "builder",
        "distiller",
        "learning-reviewer",
        "marketing",
        "planner",
        "reviewer",
        "sre",
        "support",
      ].sort(),
    );
    for (const role of roles) {
      expect(role.triggers.length).toBeGreaterThan(0);
      expect(role.outputs.length).toBeGreaterThan(0);
    }
  });

  it("builder and reviewer stay on different providers", async () => {
    const { roles } = await loadRoles(ROLES_PATH);
    const builder = roles.find((r) => r.name === "builder");
    const reviewer = roles.find((r) => r.name === "reviewer");
    // This is a product decision, not incidental config: independent
    // provider families reduce correlated builder/reviewer blind spots.
    expect(builder?.runtime).toBe("codex");
    expect(reviewer?.runtime).toBe("claude");
    expect(builder?.runtime).not.toBe(reviewer?.runtime);
  });

  it("pins the ratified current model snapshots", async () => {
    const { roles } = await loadRoles(ROLES_PATH);
    const byName = new Map(roles.map((role) => [role.name, role]));
    expect(byName.get("planner")?.model).toBe("claude-opus-4-8");
    expect(byName.get("builder")?.model).toBe("gpt-5.6-sol");
    expect(byName.get("reviewer")?.model).toBe("claude-opus-4-8");
    expect(byName.get("sre")?.model).toBe("gpt-5.6-sol");
    expect(byName.get("support")?.model).toBe("claude-sonnet-5");
    expect(byName.get("marketing")?.model).toBe("claude-sonnet-5");
    expect(byName.get("distiller")?.model).toBe("claude-sonnet-5");
    expect(byName.get("learning-reviewer")?.model).toBe("gpt-5.6-sol");
  });

  it("distiller and learning reviewer stay cross-provider on the ratified schedules", async () => {
    const { roles } = await loadRoles(ROLES_PATH);
    const distiller = roles.find((role) => role.name === "distiller")!;
    const reviewer = roles.find((role) => role.name === "learning-reviewer")!;
    expect(distiller.runtime).not.toBe(reviewer.runtime);
    expect(distiller.triggers).toEqual([{ schedule: "daily 06:00" }]);
    expect(reviewer.triggers).toEqual([{ schedule: "weekly mon 07:00" }]);
  });

  it("resolves an omitted adaptive catalog to only the configured atomic tuple", async () => {
    const { roles } = await loadRoles(ROLES_PATH);
    const builder = roles.find((role) => role.name === "builder")!;

    expect(builder.adaptiveAssignments).toBeUndefined();
    expect(resolveApprovedAssignmentCandidates(builder)).toEqual([
      {
        id: CONFIGURED_ASSIGNMENT_CANDIDATE_ID,
        source: "configured",
        harness: "codex",
        model: "gpt-5.6-sol",
        efforts: ["high"],
        providerFamily: "openai",
        capabilityRef: "codex/v1",
        pricing: {
          kind: "conservative_estimate",
          maxTurnCostUsd: 15,
          sourceRef: "role.max_turn_budget_usd",
        },
        maxTurnCostUsd: 15,
      },
    ]);
    expect(resolveApprovedTurnAssignments(builder).map((item) => item.assignment)).toEqual([
      { harness: "codex", model: "gpt-5.6-sol", effort: "high" },
    ]);
  });
});

describe("turn assignment contract", () => {
  it("validates, keys, and compares the indivisible harness/model/effort tuple", () => {
    const assignment = validateTurnAssignment({
      harness: "claude",
      model: "claude-opus-4-8",
      effort: "max",
    });
    expect(turnAssignmentKey(assignment)).toBe('["claude","claude-opus-4-8","max"]');
    expect(turnAssignmentsEqual(assignment, { ...assignment })).toBe(true);
    expect(
      turnAssignmentsEqual(assignment, { ...assignment, effort: "xhigh" }),
    ).toBe(false);
    expect(
      fixedAssignmentFromRole({ runtime: "codex", model: "gpt-5.6-sol", effort: "high" }),
    ).toEqual({ harness: "codex", model: "gpt-5.6-sol", effort: "high" });
    expect(isAssignmentCandidateId("frontier.high-v1")).toBe(true);
    expect(isAssignmentCandidateId("Frontier high")).toBe(false);
  });

  it("rejects partial, legacy-keyed, and silently aliased assignments", () => {
    expect(() => validateTurnAssignment({ model: "gpt-5.6-sol", effort: "high" })).toThrow(
      /harness must be one of/,
    );
    expect(() =>
      validateTurnAssignment({ runtime: "codex", model: "gpt-5.6-sol", effort: "high" }),
    ).toThrow(/unknown field.*runtime/);
    expect(() =>
      validateTurnAssignment({ harness: "codex", model: "gpt-5.6-sol", effort: "max" }),
    ).toThrow(/max is unsupported by codex/);
    expect(() =>
      validateTurnAssignment({ harness: "pi", model: "openai-codex\/gpt-5.6-sol", effort: "max" }),
    ).toThrow(/max is unsupported by pi/);
  });

  it("tracks provider family independently of harness", () => {
    expect(
      configuredProviderFamily({
        harness: "pi",
        model: "openai-codex/gpt-5.6-sol",
        effort: "high",
      }),
    ).toBe("openai");
    expect(
      configuredProviderFamily({ harness: "pi", model: "local/qualified-model", effort: "high" }),
    ).toBe("pi/local");
    expect(() => validateAssignmentProviderFamily(
      { harness: "pi", model: "openai-codex/gpt-5.6-sol", effort: "high" },
      "anthropic",
    )).toThrow(/must be "openai" for pi model "openai-codex\/gpt-5\.6-sol"/);
  });
});

describe("adaptive role assignment candidates", () => {
  it("rejects unknown role fields instead of silently dropping an adaptive catalog", async () => {
    const root = await mkdtemp(join(tmpdir(), "operon-role-unknown-"));
    try {
      const path = join(root, "roles.yaml");
      await writeFile(path, stringify({
        roles: {
          builder: {
            runtime: "codex",
            model: "gpt-5.6-sol",
            effort: "high",
            adaptive_assignment: [],
          },
        },
      }));
      await expect(loadRoles(path)).rejects.toThrow(
        /role "builder": unknown field\(s\): adaptive_assignment/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads exact candidates, exposes evidence, expands efforts, and applies app narrowing", async () => {
    const role = await loadFixtureRole([
      candidate({
        id: "frontier-codex",
        efforts: ["medium", "xhigh"],
      }),
      candidate({
        id: "pi-openai",
        harness: "pi",
        model: "openai-codex/gpt-5.6-sol",
        efforts: ["xhigh"],
        provider_family: "openai",
        capability_ref: "pi/v1",
        price_ref: undefined,
        conservative_estimate: {
          max_turn_cost_usd: 9,
          source: "research/pi-conservative-v1",
        },
      }),
    ]);

    expect(role.adaptiveAssignments).toHaveLength(2);
    expect(resolveApprovedAssignmentCandidates(role).map((item) => item.id)).toEqual([
      "configured",
      "frontier-codex",
      "pi-openai",
    ]);
    expect(resolveApprovedTurnAssignments(role)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: "frontier-codex",
          assignment: { harness: "codex", model: "gpt-5.6-sol", effort: "medium" },
          providerFamily: "openai",
          capabilityRef: "codex/v1",
          qualificationRef: "qualification/codex-gpt-5.6-sol-v1",
          pricing: {
            kind: "conservative_estimate",
            maxTurnCostUsd: 10,
            sourceRef: "qualification/codex-gpt-5.6-sol-v1",
          },
          maxTurnCostUsd: 10,
        }),
        expect.objectContaining({
          candidateId: "pi-openai",
          assignment: {
            harness: "pi",
            model: "openai-codex/gpt-5.6-sol",
            effort: "xhigh",
          },
          providerFamily: "openai",
          pricing: {
            kind: "conservative_estimate",
            maxTurnCostUsd: 9,
            sourceRef: "research/pi-conservative-v1",
          },
          maxTurnCostUsd: 9,
        }),
      ]),
    );

    expect(resolveApprovedAssignmentCandidates(role, ["pi-openai"]).map((item) => item.id)).toEqual([
      "pi-openai",
    ]);
    expect(() => resolveApprovedAssignmentCandidates(role, [])).toThrow(/leaves no approved/);
    expect(() => resolveApprovedAssignmentCandidates(role, ["not-approved"])).toThrow(
      /unknown candidate.*not-approved/,
    );
  });

  it("rejects untyped qualification and unresolved catalog price references", async () => {
    await expect(loadFixtureRole([
      candidate({ qualification_ref: "looks-qualified" }),
    ])).rejects.toThrow(/qualification_ref must be a campaign:<id> or qualification:<id>/);
    await expect(loadFixtureRole([
      candidate({
        conservative_estimate: undefined,
        price_ref: "prices/2026-07-15-v1",
      }),
    ])).rejects.toThrow(/price_ref cannot authorize runtime budgeting/);
    await expect(loadFixtureRole([
      candidate({
        price_ref: undefined,
        conservative_estimate: {
          max_turn_cost_usd: 2,
          source: "trust-me",
        },
      }),
    ])).rejects.toThrow(/https URL or a research\/qualification\/campaign evidence reference/);
  });

  it("revalidates provider ownership when a RoleConfig bypasses the YAML boundary", async () => {
    const role = await loadFixtureRole([candidate({
      harness: "pi",
      model: "openai-codex/gpt-5.6-sol",
      provider_family: "openai",
      capability_ref: "pi/v1",
    })]);
    role.adaptiveAssignments![0]!.providerFamily = "anthropic";

    expect(() => resolveApprovedAssignmentCandidates(role)).toThrow(
      /provider_family must be "openai" for pi model "openai-codex\/gpt-5\.6-sol"/,
    );
  });

  it.each([
    ["rejects an explicit empty catalog", [], /must be a non-empty list/],
    [
      "reserves the configured id",
      [candidate({ id: "configured" })],
      /configured.*reserved or duplicated/,
    ],
    [
      "requires a stable id",
      [candidate({ id: "Frontier Candidate" })],
      /lowercase stable id/,
    ],
    [
      "rejects duplicate effort entries",
      [candidate({ efforts: ["high", "high"] })],
      /efforts duplicates "high"/,
    ],
    [
      "rejects max when the harness aliases it",
      [candidate({ efforts: ["max"] })],
      /max is unsupported by codex/,
    ],
    [
      "requires provider ownership to match a native harness",
      [candidate({ provider_family: "anthropic" })],
      /provider_family must be "openai" for codex/,
    ],
    [
      "binds a pi provider family to its exact OpenAI model namespace",
      [candidate({
        harness: "pi",
        model: "openai-codex/gpt-5.6-sol",
        provider_family: "anthropic",
        capability_ref: "pi/v1",
      })],
      /provider_family must be "openai" for pi model "openai-codex\/gpt-5\.6-sol"/,
    ],
    [
      "binds a pi provider family to its exact Anthropic model namespace",
      [candidate({
        harness: "pi",
        model: "anthropic/claude-opus-4-8",
        provider_family: "openai",
        capability_ref: "pi/v1",
      })],
      /provider_family must be "anthropic" for pi model "anthropic\/claude-opus-4-8"/,
    ],
    [
      "requires a harness-bound capability ref",
      [candidate({ capability_ref: "claude/v1" })],
      /capability_ref must be registered profile codex\/v1/,
    ],
    [
      "requires one price source",
      [candidate({ conservative_estimate: undefined })],
      /requires conservative_estimate/,
    ],
    [
      "rejects conflicting price sources",
      [
        candidate({
          price_ref: "prices/2026-07-15-v1",
          conservative_estimate: {
            max_turn_cost_usd: 4,
            source: "research/conservative-v1",
          },
        }),
      ],
      /price_ref cannot authorize runtime budgeting/,
    ],
    [
      "rejects duplicated exact assignments",
      [
        candidate({ id: "one", efforts: ["medium"] }),
        candidate({ id: "two", efforts: ["medium"] }),
      ],
      /duplicates exact assignment.*one/,
    ],
    [
      "rejects an exact duplicate of the configured candidate",
      [candidate({ id: "same-as-configured" })],
      /duplicates exact assignment.*configured/,
    ],
  ])("%s", async (_name, candidates, expected) => {
    await expect(loadFixtureRole(candidates)).rejects.toThrow(expected);
  });

  it("rejects an unsupported configured tuple before it becomes an implicit candidate", async () => {
    await expect(loadFixtureRole(undefined, { effort: "max" })).rejects.toThrow(
      /max is unsupported by codex/,
    );
  });

  it("rejects non-positive or non-finite role and default budgets at load time", async () => {
    await expect(loadFixtureRole(undefined, { max_turn_budget_usd: 0 })).rejects.toThrow(
      /role "builder": max_turn_budget_usd must be a positive finite number/,
    );
    await expect(loadFixtureRole(undefined, {}, Number.POSITIVE_INFINITY)).rejects.toThrow(
      /defaults.max_turn_budget_usd must be a positive finite number/,
    );
  });

  it("rejects a conservative candidate estimate above the role hard cap", async () => {
    await expect(loadFixtureRole([
      candidate({
        efforts: ["medium"],
        price_ref: undefined,
        conservative_estimate: {
          max_turn_cost_usd: 13,
          source: "qualification/upper-bound",
        },
      }),
    ])).rejects.toThrow(/exceeds the role's max_turn_budget_usd/);
  });
});

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "frontier",
    harness: "codex",
    model: "gpt-5.6-sol",
    efforts: ["high"],
    provider_family: "openai",
    capability_ref: "codex/v1",
    qualification_ref: "qualification/codex-gpt-5.6-sol-v1",
    conservative_estimate: {
      max_turn_cost_usd: 10,
      source: "qualification/codex-gpt-5.6-sol-v1",
    },
    ...overrides,
  };
}

async function loadFixtureRole(
  adaptiveAssignments?: unknown,
  roleOverrides: Record<string, unknown> = {},
  defaultBudget = 12,
) {
  const directory = await mkdtemp(join(tmpdir(), "operon-roles-assignment-"));
  const path = join(directory, "roles.yaml");
  const role: Record<string, unknown> = {
    runtime: "codex",
    model: "gpt-5.6-sol",
    effort: "high",
    delegation: { allow: [] },
    triggers: [{ event: "ticket-ready" }],
    outputs: ["pr"],
    ...roleOverrides,
  };
  if (adaptiveAssignments !== undefined) role["adaptive_assignments"] = adaptiveAssignments;
  await writeFile(
    path,
    stringify({ defaults: { max_turn_budget_usd: defaultBudget }, roles: { builder: role } }),
    "utf8",
  );
  try {
    const loaded = await loadRoles(path);
    return loaded.roles[0]!;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
