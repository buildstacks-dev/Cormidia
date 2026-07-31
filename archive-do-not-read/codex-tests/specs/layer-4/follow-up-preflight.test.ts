import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HARNESS_ROOT } from "../../src/fixtures/controlled-world.js";

const command = resolve(HARNESS_ROOT, "src", "cli", "prepare-episode-planner-followup.ts");

describe("OPERON-L4-002 preparation boundary", () => {
  it("verifies the consumed hash-bound campaign without contacting the provider", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", command],
      { cwd: HARNESS_ROOT, encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    const preflight = JSON.parse(result.stdout) as {
      authorization_verified: boolean;
      execution_authorized: boolean;
      diagnostic_evidence_present: boolean;
      qualification_evidence_present: boolean;
      ready_to_execute: boolean;
      provider_contacted_by_preflight: boolean;
      spend_incurred_by_preflight_usd: number;
      checks: Array<{ id: string; passed: boolean }>;
    };
    expect(preflight).toMatchObject({
      authorization_verified: true,
      execution_authorized: false,
      diagnostic_evidence_present: true,
      qualification_evidence_present: true,
      ready_to_execute: false,
      provider_contacted_by_preflight: false,
      spend_incurred_by_preflight_usd: 0,
    });
    expect(preflight.checks.every((check) => check.passed)).toBe(true);
  });

  it("keeps provider execution out of the preparation command", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", command, "--execute"],
      { cwd: HARNESS_ROOT, encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("preparation has no execution path");
  });
});
