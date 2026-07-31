import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  admitEpisode,
  beginProviderStep,
  executionStepPath,
  finalizeEpisode,
  finalizeProviderStep,
  readEfficiencyEvidence,
  readRouteRecord,
  type AdmissionFactor,
  type AuthorizedPass,
} from "../../src/loop/efficiency.js";
import { reconcileLedger } from "../../src/org/budget.js";
import { readTurnRecords, recordTurnOnce, settlementKey, type TurnRecord } from "../../src/runtime/telemetry.js";
import { finalizeRun, readEnvelope, startRun, updateEnvelope } from "../../src/runtime/runlog/envelope.js";
import type { RoleConfig, TurnResult } from "../../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

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

describe("provider settlement and terminal reconciliation", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("F-SET-01 makes concurrent same-turn settlement race-free and exactly once", async () => {
    home = makeOrgHome();
    const record = ledgerRow("turn-race", "step-race");
    const results = await Promise.all(Array.from({ length: 20 }, () => recordTurnOnce(home.root, record)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await readTurnRecords(home.root)).toHaveLength(1);
    // F-002: the settled-key sidecar index mirrors the ledger exactly-once —
    // the concurrent winners all consult it and only one key is recorded.
    expect(await readIndexKeys(home.root)).toEqual([settlementKey("fixture", "turn-race")]);
  });

  // F-002 / P1-13: recordTurnOnce consults a compact settled-key sidecar index
  // instead of re-parsing the entire ledger history on every write (which made
  // settling N turns O(N²)). These pin the index's exactly-once invariant under
  // concurrency, its consistency with the ledger, and its rebuild path.
  it("F-SET-04 answers the duplicate check from the sidecar index, not a full ledger rescan", async () => {
    home = makeOrgHome();
    const a = ledgerRow("turn-a", "step-a");
    const b = ledgerRow("turn-b", "step-b");
    expect(await recordTurnOnce(home.root, a)).toBe(true);
    expect(await recordTurnOnce(home.root, b)).toBe(true);
    expect(existsSync(`${home.root}/telemetry-index/settled.keys`)).toBe(true);
    expect(await readIndexKeys(home.root)).toEqual([
      settlementKey("fixture", "turn-a"),
      settlementKey("fixture", "turn-b"),
    ]);
    // Remove every raw ledger day-file. If the check still rescanned all history
    // it would "forget" both keys and double-write; consulting the index, it
    // still recognizes them.
    for (const file of await readdir(`${home.root}/telemetry`)) {
      if (file.endsWith(".jsonl")) await rm(`${home.root}/telemetry/${file}`);
    }
    expect(await recordTurnOnce(home.root, a)).toBe(false);
    expect(await recordTurnOnce(home.root, b)).toBe(false);
  });

  it("F-SET-04 rebuilds the index from the ledger when it is absent, preserving exactly-once", async () => {
    home = makeOrgHome();
    const seen = ledgerRow("turn-seen", "step-seen");
    expect(await recordTurnOnce(home.root, seen)).toBe(true);
    // Legacy org / operator deletion: drop the sidecar, keep the authoritative ledger.
    await rm(`${home.root}/telemetry-index/settled.keys`);
    // The already-settled key is still recognized — the index rebuild reads the ledger.
    expect(await recordTurnOnce(home.root, seen)).toBe(false);
    // ...and a genuinely new key still settles exactly once through the rebuilt index.
    const fresh = ledgerRow("turn-fresh", "step-fresh");
    expect(await recordTurnOnce(home.root, fresh)).toBe(true);
    expect(await recordTurnOnce(home.root, fresh)).toBe(false);
    expect(await readTurnRecords(home.root)).toHaveLength(2);
  });

  it("F-SET-04 keeps many concurrent distinct settlements exactly-once with a ledger-consistent index", async () => {
    home = makeOrgHome();
    const rows = Array.from({ length: 40 }, (_, i) => ledgerRow(`turn-${i}`, `step-${i}`));
    // Settle every row twice, all concurrent: 40 unique appends, 40 duplicates skipped.
    const results = await Promise.all([...rows, ...rows].map((row) => recordTurnOnce(home.root, row)));
    expect(results.filter(Boolean)).toHaveLength(40);
    const ledger = await readTurnRecords(home.root);
    expect(ledger).toHaveLength(40);
    const indexKeys = await readIndexKeys(home.root);
    expect(new Set(indexKeys).size).toBe(40);
    // The index is exactly the set of ledger keys — never leads, never lags here.
    expect(new Set(indexKeys)).toEqual(new Set(ledger.map((row) => settlementKey(row.app, row.providerTurnId!))));
  });

  it("F-SET-01 terminalizes and settles every provider status and usage-quality combination", async () => {
    home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const statuses = ["completed", "failed", "blocked_on_gate", "cancelled", "timed_out"] as const;
    const qualities = ["complete", "estimated", "partial", "unavailable"] as const;
    let ordinal = 0;
    for (const status of statuses) {
      for (const quality of qualities) {
        ordinal += 1;
        const episodeId = `episode:matrix:${status}:${quality}`;
        const runId = `run-matrix-${ordinal}`;
        await admission(home.root, episodeId);
        await startRun(home.root, {
          runId,
          traceId: `trace-${ordinal}`,
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
        }, new Date("2026-07-10T00:00:00.000Z"));
        const started = await beginProviderStep({
          root: home.root,
          episodeId,
          app: "fixture",
          runId,
          ordinal: 1,
          operation: "build/implement",
          role: ROLE,
          inputFingerprint: `matrix-${ordinal}`,
          now: new Date("2026-07-10T00:00:00.000Z"),
        });
        await updateEnvelope(home.root, "fixture", runId, {
          providerTurnIds: [started.providerTurnId],
          executionStepIds: [started.executionStepId],
        });
        await finalizeProviderStep({
          root: home.root,
          episodeId,
          app: "fixture",
          runId,
          started,
          operation: "build/implement",
          role: ROLE,
          result: turnResult(status, quality),
          finishedAt: new Date("2026-07-10T00:00:01.000Z"),
          contextManifestRef: "context-manifest.json",
        });
        await finalizeRun(home.root, "fixture", runId, {
          status: envelopeStatus(status),
          ...(status === "completed" ? {} : { errorCode: `error_${status}` }),
        }, new Date("2026-07-10T00:00:01.000Z"));
        await finalizeEpisode({
          root: home.root,
          episodeId,
          status: episodeStatus(status),
          reason: `${status}/${quality}`,
          now: new Date("2026-07-10T00:00:01.000Z"),
        });
      }
    }
    expect(await reconcileLedger(home.root, {}, new Date("2026-07-10T00:00:02.000Z"))).toMatchObject({
      settled: 20,
      corrupt: 0,
    });
    expect(await reconcileLedger(home.root, {}, new Date("2026-07-10T00:00:03.000Z"))).toMatchObject({
      settled: 0,
    });
    const rows = await readTurnRecords(home.root);
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((row) => row.providerTurnId)).size).toBe(20);
    expect((await readEfficiencyEvidence(home.root)).every((episode) => episode.route?.terminal !== null)).toBe(true);
  });

  it("F-SET-02 repairs a crash between terminal step finalization and settlement without duplication", async () => {
    home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const episodeId = "episode:repair";
    await admission(home.root, episodeId);
    await startRun(home.root, {
      runId: "run-repair",
      traceId: "trace-repair",
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
    }, new Date("2026-07-10T00:00:00.000Z"));
    const started = await beginProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "run-repair",
      ordinal: 1,
      operation: "build/implement",
      role: ROLE,
      inputFingerprint: "input-repair",
      now: new Date("2026-07-10T00:00:00.000Z"),
    });
    await updateEnvelope(home.root, "fixture", "run-repair", {
      providerTurnIds: [started.providerTurnId],
      executionStepIds: [started.executionStepId],
    });
    const startedPath = `${executionStepPath(home.root, episodeId, started.executionStepId)}.started`;
    const receipt = await readFile(startedPath, "utf8");
    await finalizeProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "run-repair",
      started,
      operation: "build/implement",
      role: ROLE,
      result: turnResult(),
      finishedAt: new Date("2026-07-10T00:00:01.000Z"),
      contextManifestRef: "context-manifest.json",
    });
    // Inject the second half of the finalization crash window: the terminal
    // target exists but its started receipt was not unlinked.
    await writeFile(startedPath, receipt, "utf8");
    expect(await readTurnRecords(home.root)).toHaveLength(0);
    expect(await reconcileLedger(home.root, {}, new Date("2026-07-12T00:00:02.000Z"))).toMatchObject({ settled: 1 });
    expect(await reconcileLedger(home.root, {}, new Date("2026-07-12T00:00:03.000Z"))).toMatchObject({ settled: 0 });
    expect(await readTurnRecords(home.root)).toHaveLength(1);
    expect(existsSync(startedPath)).toBe(false);
    expect((await readEfficiencyEvidence(home.root))[0]?.steps[0]?.status).toBe("completed");
    expect(await readEnvelope(home.root, "fixture", "run-repair")).toMatchObject({
      status: "failed",
      error_code: "error_stale_missing_finalization",
    });
    expect(await readRouteRecord(home.root, episodeId)).toMatchObject({
      terminal: { status: "interrupted", next_step: "resume from the last valid artifact boundary" },
    });
  });

  it("F-SET-03 terminalizes stale provider receipt, parent run, episode, and settlement with a resumable reason", async () => {
    home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const episodeId = "episode:stale";
    const startedAt = new Date("2026-07-10T00:00:00.000Z");
    await admission(home.root, episodeId);
    await startRun(home.root, {
      runId: "run-stale",
      traceId: "trace-stale",
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
    }, startedAt);
    await beginProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "run-stale",
      ordinal: 1,
      operation: "build/implement",
      role: ROLE,
      inputFingerprint: "input-stale",
      now: startedAt,
    });
    const outcome = await reconcileLedger(home.root, {}, new Date("2026-07-12T00:00:00.000Z"));
    expect(outcome).toMatchObject({ settled: 1, inFlight: 0 });
    expect((await readEnvelope(home.root, "fixture", "run-stale"))).toMatchObject({
      status: "failed",
      error_code: "error_stale_missing_finalization",
    });
    expect(await readRouteRecord(home.root, episodeId)).toMatchObject({
      terminal: {
        status: "interrupted",
        next_step: "resume from the last valid artifact boundary",
      },
    });
    const evidence = await readEfficiencyEvidence(home.root);
    expect(evidence[0]?.pending_started).toHaveLength(0);
    expect(evidence[0]?.steps[0]).toMatchObject({
      status: "interrupted",
      error_code: "error_stale_missing_finalization",
      usage: { quality: "unavailable" },
    });
    expect(existsSync(`${home.root}/telemetry/2026-07-12.jsonl`)).toBe(true);
  });

  it("F-SET-03 preserves partial envelope usage when a started provider receipt loses its owner", async () => {
    home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const episodeId = "episode:stale-partial";
    const runId = "run-stale-partial";
    const startedAt = new Date("2026-07-10T00:00:00.000Z");
    await admission(home.root, episodeId);
    await startRun(home.root, {
      runId,
      traceId: "trace-stale-partial",
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
    }, startedAt);
    const started = await beginProviderStep({
      root: home.root,
      episodeId,
      app: "fixture",
      runId,
      ordinal: 1,
      operation: "build/implement",
      role: ROLE,
      inputFingerprint: "input-stale-partial",
      now: startedAt,
    });
    await updateEnvelope(home.root, "fixture", runId, {
      providerTurnIds: [started.providerTurnId],
      executionStepIds: [started.executionStepId],
      usage: {
        tokens_in: 82_967,
        tokens_out: 1_146,
        cost_usd: 0.449215,
        subagent_turns: 0,
        cache_read_tokens: 28_928,
        cost_estimated: true,
        quality: "partial",
      },
      lastSeenAt: "2026-07-10T00:00:30.000Z",
    });

    const outcome = await reconcileLedger(home.root, {}, new Date("2026-07-12T00:00:00.000Z"));
    expect(outcome).toMatchObject({ settled: 1, recoveredUsd: 0.449215, corrupt: 0 });
    expect((await readEfficiencyEvidence(home.root))[0]?.steps[0]).toMatchObject({
      status: "interrupted",
      usage: {
        tokensIn: 82_967,
        tokensOut: 1_146,
        costUsd: 0.449215,
        cacheReadTokens: 28_928,
        costEstimated: true,
        quality: "partial",
      },
    });
    expect((await readTurnRecords(home.root))[0]).toMatchObject({
      providerTurnId: started.providerTurnId,
      costUsd: 0.449215,
      costEstimated: true,
      usageQuality: "partial",
    });
    expect((await readTurnRecords(home.root))[0]?.unmeasured).not.toBe(true);
  });
});

async function readIndexKeys(root: string): Promise<string[]> {
  const text = await readFile(`${root}/telemetry-index/settled.keys`, "utf8");
  return text.split("\n").filter((line) => line.length > 0);
}

async function admission(root: string, episodeId: string): Promise<void> {
  await mkdir(`${root}/runs/fixture`, { recursive: true });
  await admitEpisode({
    root,
    episodeId,
    app: "fixture",
    route: "quick",
    policyVersion: "test/v1",
    factors: [FACTOR],
    passes: [PASS],
    now: new Date("2026-07-10T00:00:00.000Z"),
  });
}

function turnResult(
  status: TurnResult["status"] = "completed",
  quality: NonNullable<TurnResult["usage"]["quality"]> = "complete",
): TurnResult {
  return {
    status,
    ...(status === "completed" ? {} : { errorCode: `error_${status}` }),
    summary: status,
    artifacts: [{ kind: "file", ref: "src/a.ts", summary: "changed" }],
    session: { runtime: "codex", id: "session" },
    usage: { tokensIn: 10, tokensOut: 2, costUsd: 0.1, subagentTurns: 0, wallClockMs: 100, quality },
    escalations: [],
  };
}

function envelopeStatus(status: TurnResult["status"]): "completed" | "failed" | "blocked" | "cancelled" | "timed_out" {
  return status === "blocked_on_gate" ? "blocked" : status;
}

function episodeStatus(status: TurnResult["status"]): "completed" | "failed" | "blocked" | "cancelled" | "timed_out" {
  return status === "blocked_on_gate" ? "blocked" : status;
}

function ledgerRow(providerTurnId: string, executionStepId: string): TurnRecord {
  return {
    at: "2026-07-13T00:00:00.000Z",
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
    runId: "run-race",
    providerTurnId,
    executionStepId,
    episodeId: "episode:race",
  };
}
