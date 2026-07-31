import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HARNESS_ROOT } from "../../src/fixtures/controlled-world.js";

const command = resolve(
  HARNESS_ROOT,
  "src",
  "cli",
  "prepare-episode-planner-l4-003.ts",
);

describe("OPERON-L4-003 preparation boundary", () => {
  it("binds the consumed delegated diagnostic without contacting the provider", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", command], {
      cwd: HARNESS_ROOT,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    const preflight = JSON.parse(result.stdout) as {
      authorization_verified: boolean;
      execution_authorized: boolean;
      ready_to_execute: boolean;
      provider_contacted_by_preflight: boolean;
      spend_incurred_by_preflight_usd: number;
      checks: Array<{ passed: boolean }>;
    };
    expect(preflight).toMatchObject({
      authorization_verified: true,
      execution_authorized: false,
      ready_to_execute: false,
      provider_contacted_by_preflight: false,
      spend_incurred_by_preflight_usd: 0,
    });
    expect(preflight.checks.every((check) => check.passed)).toBe(true);
  });

  it("has no provider execution mode", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", command, "--execute"],
      { cwd: HARNESS_ROOT, encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("preparation has no execution path");
  });
});

describe("OPERON-L4-004 preparation boundary", () => {
  it("binds the consumed delegated EP003 diagnostic without contacting the provider", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", command, "--campaign", "OPERON-L4-004"],
      { cwd: HARNESS_ROOT, encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      campaign_id: "OPERON-L4-004",
      authorization_verified: true,
      execution_authorized: false,
      ready_to_execute: false,
      provider_contacted_by_preflight: false,
      spend_incurred_by_preflight_usd: 0,
    });
  });
});

describe("OPERON-L4-005 preparation boundary", () => {
  it("binds the consumed delegated EP004 diagnostic without contacting the provider", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", command, "--campaign", "OPERON-L4-005"],
      { cwd: HARNESS_ROOT, encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      campaign_id: "OPERON-L4-005",
      authorization_verified: true,
      execution_authorized: false,
      ready_to_execute: false,
      provider_contacted_by_preflight: false,
      spend_incurred_by_preflight_usd: 0,
    });
  });
});
