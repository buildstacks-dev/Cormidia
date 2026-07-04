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

  it("builder and reviewer are on different providers (design decision)", async () => {
    const { roles } = await loadRoles(ROLES_PATH);
    const builder = roles.find((r) => r.name === "builder");
    const reviewer = roles.find((r) => r.name === "reviewer");
    // Cross-provider review = uncorrelated blind spots. Changing this is a
    // deliberate TASTE-level decision, not a config tweak — hence a test.
    expect(builder?.runtime).not.toBe(reviewer?.runtime);
  });
});
