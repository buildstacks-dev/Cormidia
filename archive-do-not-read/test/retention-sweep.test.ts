// Org-wide state retention (review P1-14 / F-003).
//
// Before src/org/retention.ts existed, `runs/` was the only state subtree
// with retention (manual `operon prune-runs`); `telemetry/`,
// `efficiency/episodes/`, `invocations/`, `tasks/`, `learning/events/`, and
// `scheduler/evidence/` grew forever and nothing scheduled a prune. The
// dispatch-tick integration case below was the reproduction: it fails
// against that code (aged entries survive a scheduler tick in every
// subtree). The remaining cases pin each subtree's fail-safe keep rules —
// most importantly that the ledger sweep NEVER deletes rows still inside the
// reconciliation window `operon budget --reconcile` can back-fill.
// Offline only: temp homes, fixed clocks, no provider runtime, no network.

import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dispatchTick, type DispatchTickOptions } from "../src/org/dispatch.js";
import {
  DEFAULT_STATE_RETENTION,
  effectiveRetentionWindows,
  runScheduledRetentionSweep,
  sweepMarkerPath,
  sweepStateRetention,
  RECONCILE_MARGIN_DAYS,
  type StateRetentionPolicy,
} from "../src/org/retention.js";
import {
  admitEpisode,
  beginProviderStep,
  finalizeEpisode,
  finalizeProviderStep,
  type AdmissionFactor,
  type AuthorizedPass,
} from "../src/loop/efficiency.js";
import { recordTurnOnce, type TurnRecord } from "../src/runtime/telemetry.js";
import { finalizeRun, startRun, updateEnvelope } from "../src/runtime/runlog/envelope.js";
import { hashedFileStem } from "../src/runtime/runlog/paths.js";
import type { RoleConfig, TurnResult } from "../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

const NOW = new Date("2026-07-17T10:00:00.000Z");
const DAY_MS = 86_400_000;

const ROLE: RoleConfig = {
  name: "builder",
  runtime: "codex",
  model: "gpt-test",
  effort: "medium",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 5,
};
const FACTOR: AdmissionFactor = { kind: "uncertainty", evidence: "fixture", policy_rule: "fixture" };
const PASS: AuthorizedPass = {
  pipeline: "build",
  pass: "implement",
  role: ROLE.name,
  runtime: ROLE.runtime,
  model: ROLE.model,
  effort: ROLE.effort,
  factor_rules: [FACTOR.policy_rule],
};

describe("effectiveRetentionWindows", () => {
  it("clamps the ledger and every projection to outlive their evidence, and scheduler evidence to outlive the ledger", () => {
    const windows = effectiveRetentionWindows({
      ...DEFAULT_STATE_RETENTION,
      telemetryDays: 1,
      learningEventsDays: 1,
      schedulerEvidenceDays: 1,
      runsDays: 30,
      efficiencyEpisodeDays: 180,
    });
    expect(windows.telemetryDays).toBe(180 + RECONCILE_MARGIN_DAYS);
    expect(windows.learningEventsDays).toBe(180 + RECONCILE_MARGIN_DAYS);
    expect(windows.schedulerEvidenceDays).toBe(180 + 2 * RECONCILE_MARGIN_DAYS);
    expect(windows.runsDays).toBe(30);
  });

  it("rejects non-positive windows", () => {
    expect(() => effectiveRetentionWindows({ ...DEFAULT_STATE_RETENTION, tasksDays: 0 })).toThrow(/tasksDays/);
    expect(() => effectiveRetentionWindows({ ...DEFAULT_STATE_RETENTION, telemetryDays: 1.5 })).toThrow(/telemetryDays/);
  });
});

describe("ledger (telemetry/) retention respects the reconciliation window", () => {
  it("keeps an aged day-file while surviving evidence could still re-settle its rows, and prunes it once that evidence is gone", async () => {
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    try {
      // A RECENT, terminal, settled efficiency episode + run envelope — the
      // exact sources `budget --reconcile` re-derives settlements from.
      const recent = new Date("2026-07-01T00:00:00.000Z");
      const started = await buildTerminalEpisode(home.root, "episode:window", "run-window", recent);
      // Its settlement row lands in an ANCIENT day-file — far outside the
      // ledger window by age alone.
      await recordTurnOnce(home.root, ledgerRow("2023-01-05T00:00:00.000Z", "run-window", started.providerTurnId));
      // A second ancient day-file with a row nothing on disk can regenerate.
      writeLedgerDay(home.root, "2023-01-06", [ledgerRow("2023-01-06T00:00:00.000Z", "run-gone", "pt-gone")]);

      const first = await sweepStateRetention(home.root, NOW);
      expect(first.errors).toEqual([]);
      // The re-settleable file survived (reconciliation window); the orphan
      // file did not.
      expect(existsSync(join(home.root, "telemetry", "2023-01-05.jsonl"))).toBe(true);
      expect(existsSync(join(home.root, "telemetry", "2023-01-06.jsonl"))).toBe(false);
      // The recent evidence itself was inside its windows and survived.
      expect(first.efficiency_episodes).toMatchObject({ pruned: 0, kept: 1 });

      // Remove the evidence (as a later sweep would once it ages out): the
      // day-file is now provably beyond reconciliation and gets pruned.
      await rm(join(home.root, "efficiency"), { recursive: true, force: true });
      await rm(join(home.root, "runs"), { recursive: true, force: true });
      const second = await sweepStateRetention(home.root, NOW);
      expect(second.errors).toEqual([]);
      expect(existsSync(join(home.root, "telemetry", "2023-01-05.jsonl"))).toBe(false);
    } finally {
      home.cleanup();
    }
  });

  it("clamps the ledger window to the evidence windows plus the reconcile margin", async () => {
    const home = makeOrgHome();
    try {
      const policy: StateRetentionPolicy = { ...DEFAULT_STATE_RETENTION, telemetryDays: 1, runsDays: 30, efficiencyEpisodeDays: 30 };
      // 27 days old — outside the misconfigured 1-day window but inside the
      // 32-day clamp (max evidence window + margin): kept.
      writeLedgerDay(home.root, "2026-06-20", [ledgerRow("2026-06-20T00:00:00.000Z", "run-a", "pt-a")]);
      // 40 days old — outside the clamp, no surviving sources: pruned.
      writeLedgerDay(home.root, "2026-06-07", [ledgerRow("2026-06-07T00:00:00.000Z", "run-b", "pt-b")]);
      const result = await sweepStateRetention(home.root, NOW, policy);
      expect(result.errors).toEqual([]);
      expect(result.windows.telemetryDays).toBe(32);
      expect(existsSync(join(home.root, "telemetry", "2026-06-20.jsonl"))).toBe(true);
      expect(existsSync(join(home.root, "telemetry", "2026-06-07.jsonl"))).toBe(false);
    } finally {
      home.cleanup();
    }
  });

  it("never deletes a current-month day-file (monthly budget caps read it) and keeps files with unparseable lines", async () => {
    const home = makeOrgHome();
    try {
      const policy: StateRetentionPolicy = {
        ...DEFAULT_STATE_RETENTION,
        telemetryDays: 1,
        runsDays: 1,
        efficiencyEpisodeDays: 1,
      }; // effective ledger window: 3 days
      writeLedgerDay(home.root, "2026-07-10", [ledgerRow("2026-07-10T00:00:00.000Z", "run-m", "pt-m")]);
      writeFileSync(
        join(home.root, "telemetry", "2026-06-10.jsonl"),
        `${JSON.stringify(ledgerRow("2026-06-10T00:00:00.000Z", "run-t", "pt-t"))}\n{"torn`,
      );
      writeLedgerDay(home.root, "2026-06-11", [ledgerRow("2026-06-11T00:00:00.000Z", "run-u", "pt-u")]);
      const result = await sweepStateRetention(home.root, NOW, policy);
      expect(result.errors).toEqual([]);
      // 7 days old and beyond the 3-day window, but in the current UTC month: kept.
      expect(existsSync(join(home.root, "telemetry", "2026-07-10.jsonl"))).toBe(true);
      // Aged with a torn line: unprovable, kept.
      expect(existsSync(join(home.root, "telemetry", "2026-06-10.jsonl"))).toBe(true);
      // Aged, clean, sourceless: pruned.
      expect(existsSync(join(home.root, "telemetry", "2026-06-11.jsonl"))).toBe(false);
    } finally {
      home.cleanup();
    }
  });
});

describe("efficiency/episodes/ retention", () => {
  it("keeps an aged terminal episode until its provider spend is settled in the ledger, then prunes it", async () => {
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    try {
      const old = new Date("2025-06-01T00:00:00.000Z"); // > 180d before NOW
      const started = await buildTerminalEpisode(home.root, "episode:settle-gate", "run-settle-gate", old);
      const episodeDirs = () => listEfficiencyDirs(home.root);

      const unsettled = await sweepStateRetention(home.root, NOW);
      expect(unsettled.errors).toEqual([]);
      expect(unsettled.efficiency_episodes).toMatchObject({ pruned: 0, kept: 1 });
      expect(await episodeDirs()).toHaveLength(1);

      await recordTurnOnce(home.root, ledgerRow(old.toISOString(), "run-settle-gate", started.providerTurnId));
      const settled = await sweepStateRetention(home.root, NOW);
      expect(settled.errors).toEqual([]);
      expect(settled.efficiency_episodes).toMatchObject({ pruned: 1, kept: 0 });
      expect(await episodeDirs()).toHaveLength(0);
      // And with the evidence gone, the same sweep already pruned the aged
      // ledger day-file the settlement had landed in.
      expect(existsSync(join(home.root, "telemetry", "2025-06-01.jsonl"))).toBe(false);
    } finally {
      home.cleanup();
    }
  });

  it("keeps aged episodes with pending provider receipts, non-terminal routes, or corrupt files, and recent terminal ones", async () => {
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    try {
      const old = new Date("2025-06-01T00:00:00.000Z");
      // Pending started receipt (provider work never finalized): kept.
      await admitEpisode({ root: home.root, episodeId: "episode:pending", app: "fixture", route: "quick", policyVersion: "test/v1", factors: [FACTOR], passes: [PASS], now: old });
      await startRun(home.root, runInput("run-pending", "episode:pending"), old);
      await beginProviderStep({ root: home.root, episodeId: "episode:pending", app: "fixture", runId: "run-pending", ordinal: 1, operation: "build/implement", role: ROLE, inputFingerprint: "pending", now: old });
      await finalizeEpisode({ root: home.root, episodeId: "episode:pending", status: "failed", reason: "fixture", now: old });
      // Non-terminal route: kept.
      await admitEpisode({ root: home.root, episodeId: "episode:open", app: "fixture", route: "quick", policyVersion: "test/v1", factors: [FACTOR], passes: [PASS], now: old });
      // Corrupt foreign route file: kept.
      const corruptDir = join(home.root, "efficiency", "episodes", "not-a-real-episode-dir");
      mkdirSync(corruptDir, { recursive: true });
      writeFileSync(join(corruptDir, "route.json"), "{\"schema_version\":1");
      // Recent terminal settled episode: kept (inside the window).
      const recent = new Date("2026-07-01T00:00:00.000Z");
      const started = await buildTerminalEpisode(home.root, "episode:recent", "run-recent", recent);
      await recordTurnOnce(home.root, ledgerRow(recent.toISOString(), "run-recent", started.providerTurnId));

      const result = await sweepStateRetention(home.root, NOW);
      expect(result.efficiency_episodes).toMatchObject({ pruned: 0, kept: 4 });
      expect(await listEfficiencyDirs(home.root)).toHaveLength(4);
    } finally {
      home.cleanup();
    }
  });
});

describe("tasks/, invocations/, and learning/events/ retention", () => {
  it("prunes only terminal aged tasks and keeps running, recent, and torn ones", async () => {
    const home = makeOrgHome();
    try {
      writeTask(home.root, "task-old-done", { schemaVersion: 1, taskId: "task-old-done", status: "completed", startedAt: "2023-01-05T00:00:00.000Z", endedAt: "2023-01-05T01:00:00.000Z" });
      writeTask(home.root, "task-old-running", { schemaVersion: 1, taskId: "task-old-running", status: "running", startedAt: "2023-01-05T00:00:00.000Z" });
      writeTask(home.root, "task-recent-done", { schemaVersion: 1, taskId: "task-recent-done", status: "completed", startedAt: "2026-07-01T00:00:00.000Z", endedAt: "2026-07-01T01:00:00.000Z" });
      mkdirSync(join(home.root, "tasks", "task-torn"), { recursive: true });
      writeFileSync(join(home.root, "tasks", "task-torn", "task.json"), "{\"schemaVersion\":1");
      const result = await sweepStateRetention(home.root, NOW);
      expect(result.tasks).toMatchObject({ pruned: 1, kept: 3 });
      expect(existsSync(join(home.root, "tasks", "task-old-done"))).toBe(false);
      expect(existsSync(join(home.root, "tasks", "task-old-running"))).toBe(true);
      expect(existsSync(join(home.root, "tasks", "task-recent-done"))).toBe(true);
      expect(existsSync(join(home.root, "tasks", "task-torn"))).toBe(true);
    } finally {
      home.cleanup();
    }
  });

  it("prunes narrative story pairs by their own captured_at with identity binding, and keeps recent, torn, foreign, and INDEX files (#129)", async () => {
    const home = makeOrgHome();
    try {
      const dir = join(home.root, "narrative", "greenfield");
      mkdirSync(dir, { recursive: true });
      const story = (id: string, capturedAt: string): string =>
        JSON.stringify({ schema_version: 1, story_id: id, app: "greenfield", title: "t", opened: capturedAt, status: "completed", moments: [], captured_at: capturedAt });
      const oldSlug = hashedFileStem("ticket:greenfield:1");
      const recentSlug = hashedFileStem("ticket:greenfield:2");
      writeFileSync(join(dir, `${oldSlug}.json`), story("ticket:greenfield:1", "2020-01-01T00:00:00.000Z"));
      writeFileSync(join(dir, `${oldSlug}.md`), "# old\n");
      writeFileSync(join(dir, `${recentSlug}.json`), story("ticket:greenfield:2", "2026-07-01T00:00:00.000Z"));
      writeFileSync(join(dir, `${recentSlug}.md`), "# recent\n");
      writeFileSync(join(dir, "torn-story.json"), "{\"schema_version\":1");
      // Foreign v1 record whose story_id does NOT map to its filename —
      // aged content, but the identity binding keeps it (sweepTasks model).
      writeFileSync(join(dir, "foreign-copy.json"), story("ticket:greenfield:1", "2020-01-01T00:00:00.000Z"));
      writeFileSync(join(dir, "INDEX.md"), "# index\n");
      const result = await sweepStateRetention(home.root, NOW);
      expect(result.narrative).toMatchObject({ pruned: 1, kept: 3 });
      expect(existsSync(join(dir, `${oldSlug}.json`))).toBe(false);
      expect(existsSync(join(dir, `${oldSlug}.md`))).toBe(false);
      expect(existsSync(join(dir, `${recentSlug}.json`))).toBe(true);
      expect(existsSync(join(dir, `${recentSlug}.md`))).toBe(true);
      expect(existsSync(join(dir, "torn-story.json"))).toBe(true);
      expect(existsSync(join(dir, "foreign-copy.json"))).toBe(true);
      expect(existsSync(join(dir, "INDEX.md"))).toBe(true);
    } finally {
      home.cleanup();
    }
  });

  // ENH-011: a preserved refused decomposition is provider-derived evidence
  // awaiting a human decision, so it ages; the decision it feeds lives under
  // lifecycle/ and is never swept.
  it("prunes aged refused decompositions by their own refused_at, keeps torn/foreign/recent ones, and never touches lifecycle ratifications", async () => {
    const home = makeOrgHome();
    try {
      const dir = join(home.root, "planning", "greenfield", "refused-decompositions");
      mkdirSync(dir, { recursive: true });
      const record = (id: string, refusedAt: string): string =>
        JSON.stringify({
          schema_version: 1,
          kind: "refused-ticket-decomposition",
          decomposition_id: id,
          app: "greenfield",
          goal: "g",
          stage: "bootstrap",
          stage_ticket_budget: 3,
          ticket_count: 8,
          refused_at: refusedAt,
          problems: [],
          provenance: { episode_id: "e", run_id: "r", trace_id: "t" },
          plan: { stage: "bootstrap", ticketCountRationale: "r", releaseDisposition: "d", releaseKind: "deploy", tickets: [] },
        });
      writeFileSync(join(dir, "aaaaaaaaaaaaaaaaaaaaaaaa.json"), record("aaaaaaaaaaaaaaaaaaaaaaaa", "2020-01-01T00:00:00.000Z"));
      writeFileSync(join(dir, "bbbbbbbbbbbbbbbbbbbbbbbb.json"), record("bbbbbbbbbbbbbbbbbbbbbbbb", "2026-07-15T00:00:00.000Z"));
      writeFileSync(join(dir, "torn.json"), "{\"schema_version\":1");
      // Foreign record whose decomposition_id does not map to its filename:
      // aged content, kept by the identity binding (sweepTasks model).
      writeFileSync(join(dir, "foreign-copy.json"), record("aaaaaaaaaaaaaaaaaaaaaaaa", "2020-01-01T00:00:00.000Z"));
      const ratification = join(home.root, "lifecycle", "apps", "greenfield", "ticket-budget-ratifications");
      mkdirSync(ratification, { recursive: true });
      writeFileSync(join(ratification, "aaaaaaaaaaaaaaaaaaaaaaaa.json"), "{\"ratified_at\":\"2019-01-01T00:00:00.000Z\"}");

      const result = await sweepStateRetention(home.root, NOW);

      expect(result.refused_decompositions).toMatchObject({ pruned: 1, kept: 3 });
      expect(existsSync(join(dir, "aaaaaaaaaaaaaaaaaaaaaaaa.json"))).toBe(false);
      expect(existsSync(join(dir, "bbbbbbbbbbbbbbbbbbbbbbbb.json"))).toBe(true);
      expect(existsSync(join(dir, "torn.json"))).toBe(true);
      expect(existsSync(join(dir, "foreign-copy.json"))).toBe(true);
      // The human decision outlives everything, at any age.
      expect(existsSync(join(ratification, "aaaaaaaaaaaaaaaaaaaaaaaa.json"))).toBe(true);
    } finally {
      home.cleanup();
    }
  });

  it("ages orphaned narrative .md and quarantined .corrupt files by mtime — nothing escapes the window (#129)", async () => {
    const home = makeOrgHome();
    try {
      const dir = join(home.root, "narrative", "greenfield");
      mkdirSync(dir, { recursive: true });
      const ancient = new Date("2020-01-01T00:00:00.000Z");
      // Orphan .md: its capture is gone (crash between the pair rm's, or
      // external deletion) — no captured_at exists, so fs mtime ages it.
      writeFileSync(join(dir, "orphan-story.md"), "# orphan\n");
      utimesSync(join(dir, "orphan-story.md"), ancient, ancient);
      writeFileSync(join(dir, "fresh-orphan.md"), "# fresh orphan\n");
      // Quarantined corrupt bytes age the same way.
      writeFileSync(join(dir, "story.json.corrupt"), "{ torn");
      utimesSync(join(dir, "story.json.corrupt"), ancient, ancient);
      writeFileSync(join(dir, "INDEX.md"), "# index\n");
      utimesSync(join(dir, "INDEX.md"), ancient, ancient);
      const result = await sweepStateRetention(home.root, NOW);
      expect(result.narrative).toMatchObject({ pruned: 2, kept: 1 });
      expect(existsSync(join(dir, "orphan-story.md"))).toBe(false);
      expect(existsSync(join(dir, "story.json.corrupt"))).toBe(false);
      expect(existsSync(join(dir, "fresh-orphan.md"))).toBe(true);
      expect(existsSync(join(dir, "INDEX.md"))).toBe(true); // never swept, any age
    } finally {
      home.cleanup();
    }
  });

  it("prunes aged invocation day-files and learning event day-dirs while never touching the durable learning archives", async () => {
    const home = makeOrgHome();
    try {
      mkdirSync(join(home.root, "invocations"), { recursive: true });
      writeFileSync(join(home.root, "invocations", "2023-01-05.jsonl"), "{}\n");
      writeFileSync(join(home.root, "invocations", "2026-07-10.jsonl"), "{}\n");
      mkdirSync(join(home.root, "learning", "events", "2023-01-05"), { recursive: true });
      writeFileSync(join(home.root, "learning", "events", "2023-01-05", "orchestrator.jsonl"), "{}\n");
      mkdirSync(join(home.root, "learning", "events", "2026-07-10"), { recursive: true });
      writeFileSync(join(home.root, "learning", "events", "2026-07-10", "orchestrator.jsonl"), "{}\n");
      // Durable learning archives with ancient content — structurally out of
      // the sweep's reach (it only ever touches learning/events/<date>).
      for (const archive of ["episodes", "capsules", "fingerprints", "resolved", "canary", "publish-journal", "metrics"]) {
        mkdirSync(join(home.root, "learning", archive), { recursive: true });
        writeFileSync(join(home.root, "learning", archive, "ancient.json"), `{"ts":"2023-01-05T00:00:00.000Z"}\n`);
      }
      const result = await sweepStateRetention(home.root, NOW);
      expect(result.invocations).toMatchObject({ pruned: 1, kept: 1 });
      expect(result.learning_events).toMatchObject({ pruned: 1, kept: 1 });
      expect(existsSync(join(home.root, "invocations", "2023-01-05.jsonl"))).toBe(false);
      expect(existsSync(join(home.root, "invocations", "2026-07-10.jsonl"))).toBe(true);
      expect(existsSync(join(home.root, "learning", "events", "2023-01-05"))).toBe(false);
      expect(existsSync(join(home.root, "learning", "events", "2026-07-10"))).toBe(true);
      for (const archive of ["episodes", "capsules", "fingerprints", "resolved", "canary", "publish-journal", "metrics"]) {
        expect(existsSync(join(home.root, "learning", archive, "ancient.json"))).toBe(true);
      }
    } finally {
      home.cleanup();
    }
  });
});

describe("scheduler/evidence/ retention keeps health truthful", () => {
  it("prunes only unreferenced terminal decisions with agreeing settlements, protects the newest invocations, and ages out alerts", async () => {
    const home = makeOrgHome({ state: { turns: { scheduled_journalled: { phase: "done" } } } });
    try {
      const old = "2023-01-05T00:00:00.000Z";
      // Referenced by a surviving (recent) ledger row.
      writeLedgerDay(home.root, "2026-07-10", [{ ...ledgerRow("2026-07-10T00:00:00.000Z", "run-ref", "pt-ref"), traceId: "scheduled_referenced" }]);
      writeDecision(home.root, "d-prunable", { stage: "terminal", terminal_at: old, episode_id: "scheduled_gone", outcome: "executed", provider_turns: 1, provider_settlements: 1 });
      writeDecision(home.root, "d-referenced", { stage: "terminal", terminal_at: old, episode_id: "scheduled_referenced", outcome: "executed", provider_turns: 1, provider_settlements: 1 });
      writeDecision(home.root, "d-journalled", { stage: "terminal", terminal_at: old, episode_id: "scheduled_journalled", outcome: "executed", provider_turns: 1, provider_settlements: 1 });
      writeDecision(home.root, "d-missing-denominator", { stage: "terminal", terminal_at: old, episode_id: "scheduled_md", outcome: "executed", provider_turns: null, provider_settlements: null });
      writeDecision(home.root, "d-disagreeing", { stage: "terminal", terminal_at: old, episode_id: "scheduled_dis", outcome: "executed", provider_turns: 2, provider_settlements: 1 });
      writeDecision(home.root, "d-nonterminal", { stage: "spawned", terminal_at: null, episode_id: "scheduled_nt", outcome: null, provider_turns: null, provider_settlements: null });
      writeInvocation(home.root, "i-prunable", { cadence_window: "2023-01-05T00:00:00.000Z", invoked_at: old, terminal: "completed", decision_ids: ["d-prunable"] });
      writeInvocation(home.root, "i-kept-decision-survives", { cadence_window: "2023-01-06T00:00:00.000Z", invoked_at: "2023-01-06T00:00:00.000Z", terminal: "completed", decision_ids: ["d-referenced"] });
      writeInvocation(home.root, "i-nonterminal", { cadence_window: "2023-01-07T00:00:00.000Z", invoked_at: "2023-01-07T00:00:00.000Z", terminal: null, decision_ids: [] });
      writeInvocation(home.root, "i-newest", { cadence_window: "2024-01-05T00:00:00.000Z", invoked_at: "2024-01-05T00:00:00.000Z", terminal: "completed", decision_ids: [] });
      writeAlert(home.root, "alert-old", { occurred_at: old });
      writeAlert(home.root, "alert-recent", { occurred_at: "2026-07-10T00:00:00.000Z" });

      const result = await sweepStateRetention(home.root, NOW);
      expect(result.errors).toEqual([]);
      const dir = join(home.root, "scheduler", "evidence");
      expect(existsSync(join(dir, "decisions", "d-prunable.json"))).toBe(false);
      expect(existsSync(join(dir, "decisions", "d-referenced.json"))).toBe(true);
      expect(existsSync(join(dir, "decisions", "d-journalled.json"))).toBe(true);
      expect(existsSync(join(dir, "decisions", "d-missing-denominator.json"))).toBe(true);
      expect(existsSync(join(dir, "decisions", "d-disagreeing.json"))).toBe(true);
      expect(existsSync(join(dir, "decisions", "d-nonterminal.json"))).toBe(true);
      expect(existsSync(join(dir, "invocations", "i-prunable.json"))).toBe(false);
      expect(existsSync(join(dir, "invocations", "i-kept-decision-survives.json"))).toBe(true);
      expect(existsSync(join(dir, "invocations", "i-nonterminal.json"))).toBe(true);
      // The newest invocation survives regardless of age: an idle org keeps
      // its last-tick evidence for status/doctor.
      expect(existsSync(join(dir, "invocations", "i-newest.json"))).toBe(true);
      expect(existsSync(join(dir, "alerts", "alert-old.json"))).toBe(false);
      expect(existsSync(join(dir, "alerts", "alert-recent.json"))).toBe(true);
    } finally {
      home.cleanup();
    }
  });
});

describe("daily sweep claim", () => {
  it("is exactly-once under concurrency: N concurrent scheduled sweeps run one sweep", async () => {
    const home = makeOrgHome();
    try {
      mkdirSync(join(home.root, "learning", "events", "2023-01-05"), { recursive: true });
      writeFileSync(join(home.root, "learning", "events", "2023-01-05", "orchestrator.jsonl"), "{}\n");
      const results = await Promise.all(
        Array.from({ length: 16 }, () => runScheduledRetentionSweep(home.root, NOW)),
      );
      const ran = results.filter((result) => result !== undefined);
      expect(ran).toHaveLength(1);
      expect(ran[0]!.learning_events).toMatchObject({ pruned: 1 });
      expect(existsSync(join(home.root, "learning", "events", "2023-01-05"))).toBe(false);
      const marker = JSON.parse(await readFile(sweepMarkerPath(home.root, NOW), "utf8")) as { status: string; mode: string };
      expect(marker).toMatchObject({ status: "completed", mode: "scheduled" });
      // The claim is consumed for the whole UTC day…
      expect(await runScheduledRetentionSweep(home.root, NOW)).toBeUndefined();
      // …and re-arms on the next day.
      expect(await runScheduledRetentionSweep(home.root, new Date(NOW.getTime() + DAY_MS))).toBeDefined();
    } finally {
      home.cleanup();
    }
  });
});

describe("dispatch tick runs the retention sweep (the P1-14 reproduction)", () => {
  it("prunes aged entries in every subtree on the first tick of the day, once, and never in dry-run", async () => {
    const f = dispatchFixture();
    try {
      const aged = {
        telemetry: join(f.home.root, "telemetry", "2023-01-05.jsonl"),
        invocations: join(f.home.root, "invocations", "2023-01-05.jsonl"),
        task: join(f.home.root, "tasks", "task-ancient"),
        learningEvents: join(f.home.root, "learning", "events", "2023-01-05"),
        alert: join(f.home.root, "scheduler", "evidence", "alerts", "alert-ancient.json"),
      };
      const seedAged = (): void => {
        writeLedgerDay(f.home.root, "2023-01-05", [ledgerRow("2023-01-05T00:00:00.000Z", "run-gone", "pt-gone")]);
        mkdirSync(join(f.home.root, "invocations"), { recursive: true });
        writeFileSync(aged.invocations, "{}\n");
        writeTask(f.home.root, "task-ancient", { schemaVersion: 1, taskId: "task-ancient", status: "completed", startedAt: "2023-01-05T00:00:00.000Z", endedAt: "2023-01-05T01:00:00.000Z" });
        mkdirSync(aged.learningEvents, { recursive: true });
        writeFileSync(join(aged.learningEvents, "orchestrator.jsonl"), "{}\n");
        writeAlert(f.home.root, "alert-ancient", { occurred_at: "2023-01-05T00:00:00.000Z" });
      };
      seedAged();
      // Recent counterparts that must survive.
      writeLedgerDay(f.home.root, "2026-07-10", [ledgerRow("2026-07-10T00:00:00.000Z", "run-recent", "pt-recent")]);
      writeTask(f.home.root, "task-recent", { schemaVersion: 1, taskId: "task-recent", status: "completed", startedAt: "2026-07-01T00:00:00.000Z", endedAt: "2026-07-01T01:00:00.000Z" });

      // Dry-run previews must never prune (or claim the day).
      const preview = await dispatchTick({ ...f.base, dryRun: true });
      expect(preview.retention).toBeUndefined();
      expect(existsSync(aged.telemetry)).toBe(true);

      // The real tick sweeps: this is the case that fails against the
      // pre-P1-14 code, where no scheduler path pruned anything.
      const first = await dispatchTick(f.base);
      expect(first.errors).toEqual([]);
      expect(first.retention).toBeDefined();
      for (const path of Object.values(aged)) expect(existsSync(path)).toBe(false);
      expect(existsSync(join(f.home.root, "telemetry", "2026-07-10.jsonl"))).toBe(true);
      expect(existsSync(join(f.home.root, "tasks", "task-recent"))).toBe(true);

      // Same UTC day: the claim is consumed — a second tick does not sweep.
      seedAged();
      const second = await dispatchTick(f.base);
      expect(second.retention).toBeUndefined();
      expect(existsSync(aged.telemetry)).toBe(true);

      // Next UTC day: the sweep re-arms on the ordinary tick cadence.
      const third = await dispatchTick({ ...f.base, now: () => new Date(NOW.getTime() + DAY_MS) });
      expect(third.retention).toBeDefined();
      expect(existsSync(aged.telemetry)).toBe(false);
    } finally {
      f.home.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// fixture helpers
// ---------------------------------------------------------------------------

function dispatchFixture(): { home: OrgHomeFixture; base: DispatchTickOptions } {
  const home = makeOrgHome({ state: true });
  const orgRoot = join(home.root, "org");
  mkdirSync(orgRoot, { recursive: true });
  writeFileSync(join(orgRoot, "apps.yaml"), "schema_version: 1\norg:\n  name: retention-fixture\n  max_concurrent_turns: 1\ndefaults:\n  budget_usd_month: 1000\napps:\n  service:\n    repo: fixture/service\n    status: live\n");
  writeFileSync(join(orgRoot, "roles.yaml"), "roles:\n  planner:\n    runtime: claude\n    model: fixture\n    effort: low\n    delegation: {allow: []}\n    triggers: []\n    outputs: []\n");
  return {
    home,
    base: {
      orgRoot,
      runtimeHome: home.root,
      appsPath: join(orgRoot, "apps.yaml"),
      rolesPath: join(orgRoot, "roles.yaml"),
      now: () => NOW,
      eventSource: { ticketReady: async () => [], prOpened: async () => [], ciFailed: async () => [], releaseShipped: async () => [] },
      spawn: async () => {},
    },
  };
}

/** A complete terminal episode: admitted route, one finalized provider step,
 *  finalized run envelope, terminal route record — all at `when`. */
async function buildTerminalEpisode(
  root: string,
  episodeId: string,
  runId: string,
  when: Date,
): Promise<{ providerTurnId: string }> {
  await admitEpisode({ root, episodeId, app: "fixture", route: "quick", policyVersion: "test/v1", factors: [FACTOR], passes: [PASS], now: when });
  await startRun(root, runInput(runId, episodeId), when);
  const started = await beginProviderStep({
    root,
    episodeId,
    app: "fixture",
    runId,
    ordinal: 1,
    operation: "build/implement",
    role: ROLE,
    inputFingerprint: `input-${runId}`,
    now: when,
  });
  await updateEnvelope(root, "fixture", runId, {
    providerTurnIds: [started.providerTurnId],
    executionStepIds: [started.executionStepId],
  });
  await finalizeProviderStep({
    root,
    episodeId,
    app: "fixture",
    runId,
    started,
    operation: "build/implement",
    role: ROLE,
    result: turnResult(),
    finishedAt: new Date(when.getTime() + 1000),
    contextManifestRef: "context-manifest.json",
  });
  await finalizeRun(root, "fixture", runId, { status: "completed" }, new Date(when.getTime() + 1000));
  await finalizeEpisode({ root, episodeId, status: "completed", reason: "fixture", now: new Date(when.getTime() + 1000) });
  return { providerTurnId: started.providerTurnId };
}

function runInput(runId: string, episodeId: string): Parameters<typeof startRun>[1] {
  return {
    runId,
    traceId: `trace-${runId}`,
    episodeId,
    app: "fixture",
    pipeline: "build",
    pass: "implement",
    role: ROLE.name,
    runtime: ROLE.runtime,
    model: ROLE.model,
    effort: ROLE.effort,
    providerTurnIds: [],
    executionStepIds: [],
  };
}

function turnResult(): TurnResult {
  return {
    status: "completed",
    summary: "done",
    artifacts: [{ kind: "file", ref: "src/a.ts", summary: "changed" }],
    session: { runtime: "codex", id: "session" },
    usage: { tokensIn: 10, tokensOut: 2, costUsd: 0.1, subagentTurns: 0, wallClockMs: 100, quality: "complete" },
    escalations: [],
  };
}

function ledgerRow(at: string, runId: string, providerTurnId: string): TurnRecord {
  return {
    at,
    role: ROLE.name,
    runtime: ROLE.runtime,
    model: ROLE.model,
    status: "completed",
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0.01,
    usageQuality: "complete",
    subagentTurns: 0,
    wallClockMs: 1,
    escalations: 0,
    app: "fixture",
    runId,
    providerTurnId,
  };
}

function writeLedgerDay(root: string, day: string, rows: TurnRecord[]): void {
  mkdirSync(join(root, "telemetry"), { recursive: true });
  writeFileSync(join(root, "telemetry", `${day}.jsonl`), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function writeTask(root: string, taskId: string, record: unknown): void {
  mkdirSync(join(root, "tasks", taskId), { recursive: true });
  writeFileSync(join(root, "tasks", taskId, "task.json"), `${JSON.stringify(record, null, 2)}\n`);
}

function writeDecision(root: string, id: string, overrides: Record<string, unknown>): void {
  const dir = join(root, "scheduler", "evidence", "decisions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify({
    schema_version: 1,
    decision_id: id,
    invocation_id: "i-fixture",
    scheduler_id: "s",
    org_id: "o",
    cadence_window: "2023-01-05T00:00:00.000Z",
    app: "service",
    role: "planner",
    trigger_kind: "schedule",
    trigger: "daily 07:00",
    event_key: null,
    stage: "terminal",
    outcome: "executed",
    reason_code: "executed",
    episode_id: null,
    provider_turns: 0,
    provider_settlements: 0,
    created_at: "2023-01-05T00:00:00.000Z",
    updated_at: "2023-01-05T00:00:00.000Z",
    terminal_at: "2023-01-05T00:00:00.000Z",
    detail: null,
    ...overrides,
  }, null, 2)}\n`);
}

function writeInvocation(root: string, id: string, overrides: Record<string, unknown>): void {
  const dir = join(root, "scheduler", "evidence", "invocations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify({
    schema_version: 1,
    invocation_id: id,
    scheduler_id: "s",
    org_id: "o",
    cadence_window: "2023-01-05T00:00:00.000Z",
    cadence_minutes: 5,
    invoked_at: "2023-01-05T00:00:00.000Z",
    completed_at: "2023-01-05T00:00:01.000Z",
    terminal: "completed",
    reason_code: "no_due_work",
    missed_windows: 0,
    reconciled_windows: 0,
    decision_ids: [],
    ...overrides,
  }, null, 2)}\n`);
}

function writeAlert(root: string, id: string, overrides: Record<string, unknown>): void {
  const dir = join(root, "scheduler", "evidence", "alerts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify({
    schema_version: 1,
    alert_id: id,
    scheduler_id: "s",
    org_id: "o",
    reason_code: "spawn_failure",
    evidence_id: "e",
    occurred_at: "2023-01-05T00:00:00.000Z",
    detail: "fixture",
    resolved: false,
    ...overrides,
  }, null, 2)}\n`);
}

async function listEfficiencyDirs(root: string): Promise<string[]> {
  const dir = join(root, "efficiency", "episodes");
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).sort();
}
