import { describe, expect, it } from "vitest";
import {
  settlementCoverage,
  unionDurationMs,
  worktreeFingerprint,
  type ExecutionStepRecord,
} from "../../src/loop/efficiency.js";
import type { TurnRecord } from "../../src/runtime/telemetry.js";
import { makeWorkingRepo } from "../fixtures/gitRepo.js";

describe("efficiency metric oracles", () => {
  it("B-MET-01 joins provider steps exactly once and forbids mechanical settlements", () => {
    const steps = [
      step("provider-complete", "provider", "turn-complete"),
      step("provider-failed", "provider", "turn-failed", "failed"),
      step("provider-cancelled", "provider", "turn-cancelled", "cancelled"),
      step("provider-timed", "provider", "turn-timed", "timed_out"),
      step("mechanical-gate", "mechanical", null),
    ];
    const settlements = [
      settlement("turn-complete", "provider-complete"),
      settlement("turn-failed", "provider-failed"),
      settlement("turn-cancelled", "provider-cancelled"),
      settlement("turn-timed", "provider-timed"),
    ];
    expect(settlementCoverage(steps, settlements)).toEqual({
      numerator: 4,
      denominator: 4,
      missing: [],
      duplicate: [],
      mechanical_with_settlement: [],
    });
    expect(settlementCoverage(steps, [...settlements, settlement("illegal", "mechanical-gate")]))
      .toMatchObject({ mechanical_with_settlement: ["mechanical-gate"] });
  });

  it("B-MET-03 counts the union of parallel provider/mechanical intervals", () => {
    expect(unionDurationMs([
      { start: "2026-07-13T00:00:00.000Z", end: "2026-07-13T00:00:10.000Z" },
      { start: "2026-07-13T00:00:05.000Z", end: "2026-07-13T00:00:15.000Z" },
      { start: "2026-07-13T00:00:20.000Z", end: "2026-07-13T00:00:25.000Z" },
    ])).toBe(20_000);
  });

  it("B-MET-02 fingerprints tracked changes while ignoring disposable build output", () => {
    const repo = makeWorkingRepo();
    try {
      repo.commit("chore: ignore generated site", { ".gitignore": "dist/\n" });
      const clean = worktreeFingerprint(repo.root);
      repo.writeFiles({ "dist/index.html": "<h1>verified build</h1>\n" });
      const ignoredBuild = worktreeFingerprint(repo.root);
      repo.writeFiles({ "review-notes.txt": "untracked reviewer scratch\n" });
      const untrackedScratch = worktreeFingerprint(repo.root);
      repo.writeFiles({ "package.json": '{"name":"first"}\n' });
      const firstTracked = worktreeFingerprint(repo.root);
      repo.writeFiles({ "package.json": '{"name":"second"}\n' });
      const secondTracked = worktreeFingerprint(repo.root);
      expect(ignoredBuild).toBe(clean);
      expect(untrackedScratch).toBe(clean);
      expect(firstTracked).not.toBe(clean);
      expect(secondTracked).not.toBe(firstTracked);
    } finally {
      repo.cleanup();
    }
  });
});

function step(
  id: string,
  kind: ExecutionStepRecord["kind"],
  providerTurnId: string | null,
  status: ExecutionStepRecord["status"] = "completed",
): ExecutionStepRecord {
  return {
    schema_version: 1,
    execution_step_id: id,
    episode_id: "episode",
    app: "fixture",
    run_id: `run-${id}`,
    kind,
    provider_turn_id: providerTurnId,
    operation: id,
    role: kind === "provider" ? "builder" : null,
    runtime: kind === "provider" ? "codex" : null,
    model: kind === "provider" ? "gpt-test" : null,
    effort: kind === "provider" ? "medium" : null,
    started_at: "2026-07-13T00:00:00.000Z",
    finished_at: "2026-07-13T00:00:01.000Z",
    status,
    error_code: null,
    reason: status,
    next_step: null,
    context_manifest_ref: null,
    input_fingerprint: id,
    work_fingerprint_before: null,
    work_fingerprint_after: null,
    artifact_fingerprint: null,
    productive: kind === "provider",
    repeated_from_step_id: null,
    tool_call_count: 0,
    usage: kind === "provider" ? { tokensIn: 1, tokensOut: 1, costUsd: 0.01, subagentTurns: 0, wallClockMs: 1, quality: "complete" } : null,
  };
}

function settlement(providerTurnId: string, executionStepId: string): TurnRecord {
  return {
    at: "2026-07-13T00:00:01.000Z",
    role: "builder",
    runtime: "codex",
    model: "gpt-test",
    status: "completed",
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0.01,
    usageQuality: "complete",
    subagentTurns: 0,
    wallClockMs: 1,
    escalations: 0,
    app: "fixture",
    runId: "run",
    providerTurnId,
    executionStepId,
  };
}
