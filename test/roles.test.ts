// Tests the real root roles.yaml through src/org/roles.ts.
// Covers required role/default parsing, non-empty triggers/outputs, and the
// product invariant that builder and reviewer use different provider families.
// Reads repo-local config only; no network, auth, real org state, or wall-clock
// time is required.

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRoles } from "../src/org/roles.js";

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
});
