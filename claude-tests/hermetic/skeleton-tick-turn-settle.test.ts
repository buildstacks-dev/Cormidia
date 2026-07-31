// CF-J04-RC / CF-INV-006 skeleton — dispatch tick → claim → scripted Claude
// turn → exactly-once settlement (L2 composition; HB-005b).
//
// What this skeleton exercises, honestly stated:
// - A REAL `dispatchTick` (src/org/dispatch.ts) over a temp org/state home
//   built by the product's own init transaction: due-turn computation from
//   this org's apps.yaml/roles.yaml, the org-level turn-lock claim, the turn
//   journal, scheduler evidence, and schedule recording. The detached child
//   is replaced by an injected `spawn` (the seam dispatchTick exposes).
// - A REAL provider turn through the unmodified ClaudeRuntime, scripted by
//   the claude double (fixtures/adapters) — zero tokens, zero network.
// - The REAL settlement chain in the executor's documented order
//   (src/loop/pipeline.ts): admitEpisode → beginProviderStep → provider turn
//   → finalizeProviderStep (durable BEFORE settlement) → recordTurnOnce.
//   The full executePipeline assembly (briefs, context manifests, verdict
//   recording) is Wave 1+ scope; this file composes the same product seam
//   functions the executor calls, in the same order.
// - Boundary failure mode (INV-006 adversarial seed (a)): a REAL subprocess
//   SIGKILLed between provider return and ledger append via the kill-point
//   harness, then recovered through the REAL reconcile path
//   (src/org/budget.ts reconcileLedger) — settles exactly once.

import { afterEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reconcileLedger } from "../../src/org/budget.js";
import { dispatchTick, type DispatchSpawn } from "../../src/org/dispatch.js";
import type { GitHubEventSource } from "../../src/org/events.js";
import { readJournal } from "../../src/org/journal.js";
import { lockExists, releaseLock } from "../../src/org/locks.js";
import { ScheduleStore } from "../../src/org/schedule.js";
import {
  admitEpisode,
  beginProviderStep,
  episodeIdFor,
  fingerprint,
  finalizeProviderStep,
  readEfficiencyEvidence,
} from "../../src/loop/efficiency.js";
import {
  readTurnRecords,
  recordTurn,
  recordTurnOnce,
  settlementIdentity,
  settlementKey,
  toRecord,
  type TurnRecord,
} from "../../src/runtime/telemetry.js";
import type { RoleConfig, TurnResult } from "../../src/runtime/types.js";
import { claudeDouble, doubleRole, doubleTurnRequest } from "../fixtures/adapters/claude-double.js";
import { script } from "../fixtures/adapters/scenario.js";
import { makeTestClock } from "../fixtures/clock.js";
import { runKillPointScenario, type KillPointResult } from "../fixtures/kill-point.js";
import { makeTempOrgHome, type TempOrgHome } from "../fixtures/org-home.js";
import { makeTempStateHome, type TempStateHome } from "../fixtures/state-home.js";
import { assertNonEmptyWalk } from "../fixtures/walk.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const productModuleUrl = (rel: string): string => pathToFileURL(join(repoRoot, rel)).href;

const APP = "skeleton-app";
const ROLE = "sre";
const TRIGGER = "hourly"; // routed by resolveTriggerRoute → sre-health pipeline

/** This org's own config (instance state, not the repo's ratified templates):
 *  exactly one live app and one scheduled role, so the tick's due-turn
 *  computation is fully determined. */
const MINIMAL_APPS_YAML = [
  "schema_version: 1",
  "org:",
  "  name: skeleton-org",
  "  max_concurrent_turns: 1",
  "defaults:",
  "  budget_usd_month: 1000",
  "apps:",
  `  ${APP}:`,
  "    repo: fixture/skeleton",
  "    status: live",
  "    cadence: {}",
  "",
].join("\n");

const MINIMAL_ROLES_YAML = [
  "defaults:",
  "  max_turn_budget_usd: 5",
  "roles:",
  `  ${ROLE}:`,
  "    runtime: claude",
  "    model: claude-scripted-model",
  "    effort: medium",
  "    delegation: {allow: []}",
  "    triggers:",
  `      - schedule: "${TRIGGER}"`,
  "    outputs: [notes]",
  "",
].join("\n");

/** Hermetic event source: no GitHub, no events due. */
const NO_EVENTS: GitHubEventSource = {
  ticketReady: async () => [],
  prOpened: async () => [],
  ciFailed: async () => [],
  releaseShipped: async () => [],
};

// Same detector as claude-tests/unit/inv-006-settlement.test.ts, on the
// product's own key derivation (kept local: test files do not import from
// sibling test files).
class SettlementConservationViolation extends Error {
  constructor(duplicates: ReadonlyMap<string, number>) {
    super(
      "INV-006 violated: settlement key(s) settled more than once — " +
        [...duplicates.entries()].map(([key, count]) => `${JSON.stringify(key)} x${count}`).join(", "),
    );
    this.name = "SettlementConservationViolation";
  }
}

function detectDoubleSettlement(rows: readonly TurnRecord[]): void {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const identity = settlementIdentity(row);
    if (identity === undefined) continue;
    const key = settlementKey(row.app, identity);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicates = new Map([...counts.entries()].filter(([, count]) => count > 1));
  if (duplicates.size > 0) throw new SettlementConservationViolation(duplicates);
}

function scriptedRole(): RoleConfig {
  return doubleRole({ name: ROLE, effort: "medium" });
}

/** The settlement chain in the executor's documented order (pipeline.ts):
 *  route admission → started receipt → durable terminal step → ledger row. */
async function settleScriptedTurn(input: {
  stateHome: string;
  runId: string;
  result: TurnResult;
  now: Date;
}): Promise<{ record: TurnRecord; providerTurnId: string }> {
  const role = scriptedRole();
  const episodeId = episodeIdFor({ app: APP, traceId: input.runId });
  await admitEpisode({
    root: input.stateHome,
    episodeId,
    app: APP,
    route: "quick",
    policyVersion: "hb005-skeleton",
    factors: [
      { kind: "uncertainty", evidence: "HB-005 skeleton composition", policy_rule: "hb005-skeleton" },
    ],
    passes: [
      {
        pipeline: "sre-health",
        pass: "analyze",
        role: ROLE,
        runtime: "claude",
        model: role.model,
        effort: "medium",
        factor_rules: ["hb005-skeleton"],
      },
    ],
    now: input.now,
  });
  const started = await beginProviderStep({
    root: input.stateHome,
    episodeId,
    app: APP,
    runId: input.runId,
    ordinal: 1,
    operation: "sre-health/analyze",
    role,
    inputFingerprint: fingerprint({ runId: input.runId }),
    now: input.now,
  });
  const finishedAt = new Date(input.now.getTime() + 1_000);
  await finalizeProviderStep({
    root: input.stateHome,
    episodeId,
    app: APP,
    runId: input.runId,
    started,
    operation: "sre-health/analyze",
    role,
    result: input.result,
    finishedAt,
    contextManifestRef: "context-manifest.json",
  });
  const record = toRecord(role, input.result, finishedAt, {
    app: APP,
    trigger: "schedule",
    runId: input.runId,
    providerTurnId: started.providerTurnId,
    executionStepId: started.executionStepId,
    episodeId,
    effort: "medium",
  });
  const settled = await recordTurnOnce(input.stateHome, record);
  expect(settled).toBe(true);
  return { record, providerTurnId: started.providerTurnId };
}

/** Kill-point scenario: the same chain inside a REAL subprocess, with the
 *  kill marker placed exactly between provider return (durable terminal step)
 *  and the ledger append. */
function killPointScenarioSource(): string {
  return `
import {
  admitEpisode,
  beginProviderStep,
  episodeIdFor,
  fingerprint,
  finalizeProviderStep,
} from ${JSON.stringify(productModuleUrl("src/loop/efficiency.ts"))};
import { recordTurnOnce, toRecord } from ${JSON.stringify(productModuleUrl("src/runtime/telemetry.ts"))};

const root = process.env.OPERON_KP_STATE_HOME;
if (root === undefined || root.length === 0) throw new Error("OPERON_KP_STATE_HOME not set");
const app = ${JSON.stringify(APP)};
const runId = "kill-run-1";
const operation = "sre-health/analyze";
const role = {
  name: ${JSON.stringify(ROLE)},
  runtime: "claude",
  model: "claude-scripted-model",
  effort: "medium",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 5,
};
const now = new Date("2026-07-31T12:00:00.000Z");
const episodeId = episodeIdFor({ app, traceId: runId });
await admitEpisode({
  root,
  episodeId,
  app,
  route: "quick",
  policyVersion: "hb005-skeleton",
  factors: [
    { kind: "uncertainty", evidence: "HB-005 kill-point scenario", policy_rule: "hb005-skeleton" },
  ],
  passes: [
    {
      pipeline: "sre-health",
      pass: "analyze",
      role: role.name,
      runtime: "claude",
      model: role.model,
      effort: "medium",
      factor_rules: ["hb005-skeleton"],
    },
  ],
  now,
});
const started = await beginProviderStep({
  root,
  episodeId,
  app,
  runId,
  ordinal: 1,
  operation,
  role,
  inputFingerprint: fingerprint({ runId }),
  now,
});
// The provider has returned: measured usage in hand.
const result = {
  status: "completed",
  summary: "scripted analysis complete",
  artifacts: [],
  session: { runtime: "claude", id: "sess-kill-1" },
  usage: { tokensIn: 900, tokensOut: 120, costUsd: 0.55, subagentTurns: 0, wallClockMs: 800, quality: "complete" },
  escalations: [],
};
const finishedAt = new Date(now.getTime() + 1000);
// The durable terminal step is written BEFORE settlement — the exact ordering
// src/loop/pipeline.ts relies on so a crash here is recoverable.
await finalizeProviderStep({
  root,
  episodeId,
  app,
  runId,
  started,
  operation,
  role,
  result,
  finishedAt,
  contextManifestRef: "context-manifest.json",
});
await kp("provider_returned"); // ← killAt: after provider return, before ledger append
const settlement = toRecord(role, result, finishedAt, {
  app,
  runId,
  providerTurnId: started.providerTurnId,
  executionStepId: started.executionStepId,
  episodeId,
  effort: "medium",
});
await recordTurnOnce(root, settlement);
await kp("settled");
`;
}

describe("CF-J04-RC/CF-INV-006 skeleton — dispatch tick → claim → scripted adapter turn → exactly-once settlement (L2, HB-005b)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function freshOrg(): Promise<TempOrgHome> {
    const org = await makeTempOrgHome({ name: "skeleton-org" });
    cleanups.push(() => org.cleanup());
    await writeFile(join(org.orgHome, "apps.yaml"), MINIMAL_APPS_YAML, "utf8");
    await writeFile(join(org.orgHome, "roles.yaml"), MINIMAL_ROLES_YAML, "utf8");
    return org;
  }

  it("a real dispatch tick claims the due turn once; the scripted Claude turn settles exactly once through the real chain", async () => {
    const org = await freshOrg();
    const clock = makeTestClock("2026-07-31T12:00:00.000Z");
    const spawned: Array<{ role: string; app: string; turnId: string; runtimeHome: string }> = [];
    const spawn: DispatchSpawn = async (input) => {
      spawned.push(input);
    };

    // Tick 1: the schedule trigger is due (never fired) — one claim, one spawn.
    const tick = await dispatchTick({
      orgRoot: org.orgHome,
      runtimeHome: org.stateHome,
      now: clock.dateFn,
      eventSource: NO_EVENTS,
      spawn,
    });
    expect(tick.errors).toEqual([]);
    expect(tick.spawned).toHaveLength(1);
    expect(tick.spawned[0]).toMatchObject({ app: APP, role: ROLE, triggerKind: "schedule", trigger: TRIGGER });
    expect(spawned).toHaveLength(1);
    const turnId = spawned[0]!.turnId;

    // The claim is durable: org-level turn lock + turn journal + schedule record.
    expect(lockExists(org.stateHome, APP, ROLE)).toBe(true);
    const journal = await readJournal(org.stateHome, turnId);
    expect(journal).toMatchObject({ app: APP, role: ROLE, phase: "assembling", triggerKind: "schedule" });
    expect(await new ScheduleStore(org.stateHome).lastFired(APP, ROLE, TRIGGER)).toBeDefined();
    expect(tick.scheduler?.invocationId).toBeDefined();

    // Tick 2 (a minute later): the claim holds — nothing is double-dispatched.
    clock.advance(60_000);
    const tick2 = await dispatchTick({
      orgRoot: org.orgHome,
      runtimeHome: org.stateHome,
      now: clock.dateFn,
      eventSource: NO_EVENTS,
      spawn,
    });
    expect(tick2.errors).toEqual([]);
    expect(tick2.spawned).toHaveLength(0);
    expect(spawned).toHaveLength(1);

    // The claimed turn runs as a scripted provider turn through the REAL
    // ClaudeRuntime (queryFn seam) — zero tokens, zero network.
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-skeleton-1",
        outcome: script.success("health sweep: all clear", {
          usage: { inputTokens: 1200, outputTokens: 200 },
          costUsd: 0.37,
          durationMs: 900,
        }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: org.root, role: scriptedRole(), task: "scheduled health sweep" }),
      { gate: () => ({ allow: true }) },
    );
    expect(result.status).toBe("completed");
    expect(result.usage.costUsd).toBe(0.37);
    expect(dbl.recorder.turns).toHaveLength(1);

    // Settlement through the real chain, keyed to the dispatched turn.
    const { record } = await settleScriptedTurn({
      stateHome: org.stateHome,
      runId: turnId,
      result,
      now: clock.nowDate(),
    });

    // Exactly once: the duplicate attempt refuses; the ledger holds one row.
    expect(await recordTurnOnce(org.stateHome, record)).toBe(false);
    const rows = await readTurnRecords(org.stateHome);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ app: APP, role: ROLE, costUsd: 0.37, runId: turnId });
    detectDoubleSettlement(rows);

    // The reconcile path finds nothing to back-fill after a clean settle.
    const reconciled = await reconcileLedger(org.stateHome, {}, clock.nowDate());
    expect(reconciled.settled).toBe(0);
    expect(await readTurnRecords(org.stateHome)).toHaveLength(1);

    // Housekeeping: release the org-level claim our injected spawn stood in for.
    await releaseLock(org.stateHome, APP, ROLE);
  });

  it("boundary failure mode: SIGKILL between provider return and ledger append — the reconcile path settles exactly once", async () => {
    const state = await makeTempStateHome({ name: "kill-org" });
    cleanups.push(() => state.cleanup());

    const res: KillPointResult = await runKillPointScenario({
      source: killPointScenarioSource(),
      killAt: "provider_returned",
      env: { OPERON_KP_STATE_HOME: state.stateHome },
      timeoutMs: 25_000,
    });
    cleanups.push(() => res.cleanup());

    // The child died exactly in the window: step durable, ledger empty.
    expect(res.timedOut).toBe(false);
    expect(res.killedAt).toBe("provider_returned");
    expect(res.markers).toEqual(["provider_returned"]);
    expect(await readTurnRecords(state.stateHome)).toHaveLength(0);

    // Surviving durable evidence is non-empty (no green by absence) and names
    // the paid-for provider turn.
    await assertNonEmptyWalk(state.path("efficiency", "episodes"));
    const evidence = await readEfficiencyEvidence(state.stateHome);
    const steps = evidence.flatMap((episode) => episode.steps).filter((step) => step.kind === "provider");
    expect(steps).toHaveLength(1);
    const providerTurnId = steps[0]!.provider_turn_id;
    expect(providerTurnId).not.toBeNull();
    expect(steps[0]!.usage?.costUsd).toBe(0.55);

    // Recovery: the REAL reconcile settles the orphaned turn exactly once…
    const first = await reconcileLedger(state.stateHome);
    expect(first.settled).toBe(1);
    expect(first.recoveredUsd).toBeCloseTo(0.55, 10);
    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(1);
    expect(settlementKey(rows[0]!.app, settlementIdentity(rows[0]!)!)).toBe(
      settlementKey(APP, providerTurnId!),
    );
    detectDoubleSettlement(rows);

    // …and a second reconcile finds nothing more to pay.
    const second = await reconcileLedger(state.stateHome);
    expect(second.settled).toBe(0);
    expect(await readTurnRecords(state.stateHome)).toHaveLength(1);
  });

  it("control: without a kill the child settles itself and reconcile back-fills nothing", async () => {
    const state = await makeTempStateHome({ name: "kill-org-control" });
    cleanups.push(() => state.cleanup());

    const res = await runKillPointScenario({
      source: killPointScenarioSource(),
      env: { OPERON_KP_STATE_HOME: state.stateHome },
      timeoutMs: 25_000,
    });
    cleanups.push(() => res.cleanup());

    expect(res.timedOut).toBe(false);
    expect(res.exitCode).toBe(0);
    expect(res.markers).toEqual(["provider_returned", "settled"]);

    expect(await readTurnRecords(state.stateHome)).toHaveLength(1);
    const reconciled = await reconcileLedger(state.stateHome);
    expect(reconciled.settled).toBe(0);
    expect(await readTurnRecords(state.stateHome)).toHaveLength(1);
  });

  it("negative control: a forged duplicate ledger row for an already-settled turn makes the detector FIRE, and reconcile never erases the contradiction", async () => {
    const state = await makeTempStateHome({ name: "forged-dup" });
    cleanups.push(() => state.cleanup());
    const clock = makeTestClock("2026-07-31T12:00:00.000Z");

    const result: TurnResult = {
      status: "completed",
      summary: "scripted",
      artifacts: [],
      session: { runtime: "claude", id: "sess-neg-1" },
      usage: {
        tokensIn: 500,
        tokensOut: 60,
        costUsd: 0.2,
        subagentTurns: 0,
        wallClockMs: 700,
        quality: "complete",
      },
      escalations: [],
    };
    const { record } = await settleScriptedTurn({
      stateHome: state.stateHome,
      runId: "neg-run-1",
      result,
      now: clock.nowDate(),
    });

    // Seeded violation: the raw append bypasses the exactly-once guard.
    await recordTurn(state.stateHome, record);
    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(2);
    expect(() => detectDoubleSettlement(rows)).toThrow(SettlementConservationViolation);

    // Reconciliation reports, it never rewrites: the forged row stays visible
    // (INV-008 — no compression of contradictions), and nothing new settles.
    const reconciled = await reconcileLedger(state.stateHome, {}, clock.nowDate());
    expect(reconciled.settled).toBe(0);
    const after = await readTurnRecords(state.stateHome);
    expect(after).toHaveLength(2);
    expect(() => detectDoubleSettlement(after)).toThrow(SettlementConservationViolation);
  });
});
