// Regression coverage for run-role flag parsing (fix-loopcli): omitted or
// flag-shaped values for --app/--turn/etc must fail loudly instead of being
// silently dropped or swallowing the next flag (e.g. --dry-run as an app name).

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
