// Tests the token-free environment preflight in src/loop/preflight.ts
// (Stage 3 of the 2026-07-10 proportionality campaign, principle P6).
// Covers command-binary resolution, env-prefix skipping, the offline-install
// trap, and the all-clear path. The registry probe is network-gated and not
// exercised here; no network, auth, or org state is required.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commandBinary, runEnvPreflight } from "../../src/loop/preflight.js";

describe("commandBinary", () => {
  it("takes the first non-env-assignment token", () => {
    expect(commandBinary("pnpm test")).toBe("pnpm");
    expect(commandBinary("CI=true NODE_ENV=test pnpm run lint")).toBe("pnpm");
    expect(commandBinary("  ")).toBeUndefined();
  });
});

describe("runEnvPreflight", () => {
  let worktree: string;
  afterEach(() => rmSync(worktree, { recursive: true, force: true }));

  it("passes when every configured command's binary resolves", async () => {
    worktree = mkdtempSync(join(tmpdir(), "operon-preflight-"));
    const result = await runEnvPreflight(worktree, { testCommand: "node --test" });
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it("names the missing binary instead of letting a gate discover it", async () => {
    worktree = mkdtempSync(join(tmpdir(), "operon-preflight-"));
    const result = await runEnvPreflight(worktree, {
      testCommand: "definitely-not-a-real-binary-4711 --test",
    });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("definitely-not-a-real-binary-4711");
    expect(result.problems[0]).toContain("test");
  });

  it("catches the offline-install trap: setup needs a registry, sandbox has no network", async () => {
    worktree = mkdtempSync(join(tmpdir(), "operon-preflight-"));
    const result = await runEnvPreflight(worktree, {
      setupCommand: "pnpm install --frozen-lockfile",
    });
    // No node_modules, an install-shaped setup, no network grant → the exact
    // $7-model-turn discovery from the episode, now a $0 probe.
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes("offline"))).toBe(true);
  });

  it("does not trip the offline trap when dependencies are already present", async () => {
    worktree = mkdtempSync(join(tmpdir(), "operon-preflight-"));
    mkdirSync(join(worktree, "node_modules"));
    const result = await runEnvPreflight(worktree, {
      setupCommand: "pnpm install --frozen-lockfile",
    });
    expect(result.ok).toBe(true);
  });
});
