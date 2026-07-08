// Tests run-role CLI flag parsing in src/cli/run-role.ts.
// Covers missing values and flag-shaped values for --app and --turn so they
// fail loudly instead of being swallowed as arguments.
// Calls the command handler directly; no filesystem fixture, network, auth,
// real org state, or wall-clock time is required.

import { describe, expect, it } from "vitest";
import { cmdRunRole } from "../src/cli/run-role.js";

describe("run-role flag parsing", () => {
  it("rejects a trailing --app with no value instead of silently dropping it", async () => {
    await expect(cmdRunRole(["builder", "--dry-run", "--app"])).rejects.toThrow(
      "run-role: --app requires a value",
    );
  });

  it("rejects --app swallowing the following flag as its value", async () => {
    await expect(cmdRunRole(["builder", "--app", "--dry-run"])).rejects.toThrow(
      "run-role: --app requires a value",
    );
  });

  it("rejects a trailing --turn with no value", async () => {
    await expect(cmdRunRole(["builder", "--dry-run", "--app", "alpha", "--turn"])).rejects.toThrow(
      "run-role: --turn requires a value",
    );
  });
});
