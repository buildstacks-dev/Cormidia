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

  it("M6 pilot waiver: builder and reviewer differ by model until M10 restores cross-provider review", async () => {
    const { roles } = await loadRoles(ROLES_PATH);
    const builder = roles.find((r) => r.name === "builder");
    const reviewer = roles.find((r) => r.name === "reviewer");
    // Temporary M6 expedient: CodexRuntime is not live yet, so the real
    // loop proof uses ClaudeRuntime for both seats. M10 restores the
    // cross-provider builder/reviewer pairing; until then the models must
    // differ so the waiver stays narrow and visible.
    expect(builder?.runtime).toBe("claude");
    expect(reviewer?.runtime).toBe("claude");
    expect(builder?.model).not.toBe(reviewer?.model);
  });
});
