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
      ["builder", "marketing", "planner", "reviewer", "sre", "support"].sort(),
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
});
