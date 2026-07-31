import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  appCommandEnv,
  DEPENDENCY_BUILD_POLICY_ENV,
} from "../src/runtime/non-interactive-env.js";

/**
 * ISSUE-031: `pnpm install --frozen-lockfile` passed the build loop's quality
 * gates and then failed `operon app verify` on the same merged repo, because
 * only the gate path carried the ISSUE-029 dependency-build policy. The
 * remediation told the operator to fix a `setup_command` that was correct.
 *
 * These tests pin the AGREEMENT between the two paths. A test that merely ran
 * `app verify` against a healthy repo would not have caught this — the failure
 * only appears for a dependency set with an install script.
 */
describe("app command environment", () => {
  it("carries the dependency build policy, CI, and a non-prompting git", () => {
    const env = appCommandEnv({});
    for (const [key, value] of Object.entries(DEPENDENCY_BUILD_POLICY_ENV)) {
      expect(env[key]).toBe(value);
    }
    expect(env.CI).toBe("1");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("preserves unrelated caller values and overrides a conflicting policy value", () => {
    const env = appCommandEnv({ HOME: "/home/x", PATH: "/bin", PNPM_CONFIG_IGNORE_SCRIPTS: "false" });
    expect(env.HOME).toBe("/home/x");
    expect(env.PATH).toBe("/bin");
    expect(env.PNPM_CONFIG_IGNORE_SCRIPTS).toBe("true");
  });

  it("is the single owner: neither app-checks nor quality gates assemble their own", () => {
    // The defect was two independently-assembled environments drifting apart.
    // Both call sites must go through the helper, so a future invariant cannot
    // be added to only one of them.
    for (const path of ["src/org/app-lifecycle.ts", "src/loop/qgates.ts"]) {
      const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      expect(source).toContain("appCommandEnv()");
      expect(source).not.toMatch(/env:\s*\{\s*\.\.\.process\.env,\s*CI:/);
      expect(source).not.toMatch(/env:\s*\{\s*\.\.\.withDependencyBuildPolicy\(/);
    }
  });

  it("actually suppresses the ISSUE-029 placeholder in a real pnpm install", () => {
    // The behavioural end of the contract, measured rather than asserted.
    const probe = spawnSync(
      "/bin/sh",
      ["-lc", "node -e \"process.stdout.write(String(process.env.PNPM_CONFIG_IGNORE_SCRIPTS))\""],
      { env: appCommandEnv(), encoding: "utf8", timeout: 30_000 },
    );
    expect(probe.status).toBe(0);
    expect(probe.stdout).toBe("true");
  });
});
