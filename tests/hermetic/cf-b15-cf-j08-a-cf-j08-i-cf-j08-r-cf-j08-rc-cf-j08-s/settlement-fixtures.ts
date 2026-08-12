// Shared fixtures for the CF-J08 settlement families (HB-020).
//
// Everything here drives the REAL product writers — admitEpisode /
// beginProviderStep / finalizeProviderStep / recordMechanicalStep
// (src/loop/efficiency.ts), startRun / updateEnvelope / finalizeRun
// (src/runtime/runlog/envelope.ts), and toRecord / recordTurnOnce
// (src/runtime/telemetry.ts) — so the suites compose product code unmodified
// and only plant raw bytes where they reproduce a crash/legacy state no
// living writer can produce (tests/README.md rule 2).
//
// The conservation detector at the bottom is the family detector: it mirrors
// the product's own settlement identity derivation (settlementKey /
// settlementIdentity) so it can never drift from what the guard enforces.

import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  admitEpisode,
  beginProviderStep,
  finalizeProviderStep,
  type ExecutionStepRecord,
  type StartedProviderStep,
} from "../../../src/loop/efficiency.js";
import {
  finalizeRun,
  startRun,
  updateEnvelope,
  type EnvelopeUsage,
  type RunEnvelope,
} from "../../../src/runtime/runlog/envelope.js";
import { settlementIdentity, settlementKey, toRecord, type TurnRecord } from "../../../src/runtime/telemetry.js";
import type { RoleConfig, TurnResult, TurnUsage } from "../../../src/runtime/types.js";
import { terminalStopFields } from "../../../src/runtime/types.js";

export const PIPELINE = "build";
export const PASS = "implement";
export const OPERATION = `${PIPELINE}/${PASS}`;

/** A builder role shaped like roles.yaml entries; maxTurnBudgetUsd bounds the
 *  per-turn reservation beginProviderStep takes against the route budget. */
export function makeRole(overrides: Partial<RoleConfig> = {}): RoleConfig {
  return {
    name: "builder",
    runtime: "claude",
    model: "claude-scripted-model",
    effort: "medium",
    delegation: { allow: [] },
    triggers: [{ manual: true }],
    outputs: [],
    maxTurnBudgetUsd: 2,
    ...overrides,
  };
}

export function makeUsage(costUsd: number, overrides: Partial<TurnUsage> = {}): TurnUsage {
  return {
    tokensIn: 1200,
    tokensOut: 300,
    costUsd,
    subagentTurns: 0,
    wallClockMs: 1500,
    quality: "complete",
    ...overrides,
  };
}

export function makeTurnResult(
  status: TurnResult["status"],
  usage: TurnUsage,
  overrides: Omit<Partial<TurnResult>, "status" | "interruptedReason"> = {},
): TurnResult {
  return {
    summary: `scripted ${status} turn`,
    artifacts: [],
    session: { runtime: "claude", id: "sess-cf-j08" },
    usage,
    escalations: [],
    ...overrides,
    // F-PT-017: an `interrupted` fixture carries its reason like production,
    // and overrides may not re-widen the discriminant back out of the union.
    ...terminalStopFields({ status, ...(status === "interrupted" ? { interruptedReason: "time_limit" } : {}) }),
  };
}

/** Admit one efficiency episode through the real admission path. Route
 *  "quick" allows 3 provider turns / $8 — ample for one-turn episodes. */
export async function admitTestEpisode(input: {
  stateHome: string;
  episodeId: string;
  app: string;
  now: Date;
  role?: RoleConfig;
  route?: "quick" | "standard" | "deep";
}): Promise<void> {
  const role = input.role ?? makeRole();
  await admitEpisode({
    root: input.stateHome,
    episodeId: input.episodeId,
    app: input.app,
    route: input.route ?? "quick",
    policyVersion: "cf-j08-test-1",
    factors: [{ kind: "uncertainty", evidence: "scripted CF-J08 fixture episode", policy_rule: "rule-cf-j08" }],
    passes: [
      {
        pipeline: PIPELINE,
        pass: PASS,
        role: role.name,
        runtime: role.runtime,
        model: role.model,
        effort: role.effort,
        factor_rules: ["rule-cf-j08"],
      },
    ],
    now: input.now,
  });
}

export interface PlantedProviderTurn {
  app: string;
  runId: string;
  episodeId: string;
  providerTurnId: string;
  executionStepId: string;
  started: StartedProviderStep;
  step: ExecutionStepRecord;
}

/** One full provider execution through the real chain: begin (durable started
 *  receipt + budget reservation) then finalize (durable terminal execution
 *  record). Settlement is deliberately NOT performed here — each suite drives
 *  the settle/reconcile leg it is asserting. */
export async function plantProviderStep(input: {
  stateHome: string;
  episodeId: string;
  app: string;
  runId: string;
  ordinal?: number;
  result: TurnResult;
  startedAt: Date;
  finishedAt: Date;
  role?: RoleConfig;
}): Promise<PlantedProviderTurn> {
  const role = input.role ?? makeRole();
  const started = await beginProviderStep({
    root: input.stateHome,
    episodeId: input.episodeId,
    app: input.app,
    runId: input.runId,
    ordinal: input.ordinal ?? 1,
    operation: OPERATION,
    role,
    inputFingerprint: `fp-${input.runId}-${input.ordinal ?? 1}`,
    now: input.startedAt,
  });
  const step = await finalizeProviderStep({
    root: input.stateHome,
    episodeId: input.episodeId,
    app: input.app,
    runId: input.runId,
    started,
    operation: OPERATION,
    role,
    result: input.result,
    finishedAt: input.finishedAt,
    contextManifestRef: "context-manifest.json",
  });
  return {
    app: input.app,
    runId: input.runId,
    episodeId: input.episodeId,
    providerTurnId: started.providerTurnId,
    executionStepId: started.executionStepId,
    started,
    step,
  };
}

/** The executor-shaped settlement record — the same toRecord call
 *  src/loop/pipeline.ts makes after finalizeProviderStep, including the
 *  unmeasured marker for unavailable usage. */
export function executorSettlement(input: {
  role?: RoleConfig;
  result: TurnResult;
  at: Date;
  app: string;
  runId: string;
  providerTurnId?: string;
  executionStepId?: string;
  episodeId?: string;
}): TurnRecord {
  const role = input.role ?? makeRole();
  return toRecord(role, input.result, input.at, {
    app: input.app,
    trigger: "manual",
    runId: input.runId,
    ...(input.providerTurnId !== undefined ? { providerTurnId: input.providerTurnId } : {}),
    ...(input.executionStepId !== undefined ? { executionStepId: input.executionStepId } : {}),
    ...(input.episodeId !== undefined ? { episodeId: input.episodeId } : {}),
    pipeline: PIPELINE,
    pass: PASS,
    ...(input.result.usage.quality === "unavailable" ? { unmeasured: true } : {}),
  });
}

/** Plant a run envelope through the real runlog writers.
 *  - terminal statuses produce the LEGACY settle-from-envelope evidence shape
 *    (no provider_turn_ids) that `budget --reconcile` back-fills keyed
 *    (app, runId);
 *  - "running" leaves the envelope open, optionally with mid-run usage and
 *    provider-turn identities (the new-schema crash shape). */
export async function plantEnvelope(input: {
  stateHome: string;
  app: string;
  runId: string;
  /** `timed_out` is deliberately still accepted here: planting a LEGACY
   *  envelope is how the F-PT-017 migration-compatibility case is exercised
   *  (HB-P6). Production writes `interrupted` + a reason. */
  status: "completed" | "failed" | "blocked" | "cancelled" | "interrupted" | "timed_out" | "running";
  usage?: EnvelopeUsage;
  providerTurnIds?: string[];
  startedAt: Date;
  finishedAt?: Date;
  role?: string;
}): Promise<RunEnvelope> {
  const envelope = await startRun(
    input.stateHome,
    {
      runId: input.runId,
      traceId: `trace-${input.runId}`,
      app: input.app,
      pipeline: PIPELINE,
      pass: PASS,
      role: input.role ?? "builder",
    },
    input.startedAt,
  );
  if (input.usage !== undefined || input.providerTurnIds !== undefined) {
    await updateEnvelope(input.stateHome, input.app, input.runId, {
      ...(input.usage !== undefined ? { usage: input.usage } : {}),
      ...(input.providerTurnIds !== undefined ? { providerTurnIds: input.providerTurnIds } : {}),
    });
  }
  if (input.status === "running") return envelope;
  if (input.status === "timed_out") {
    // Plant a genuine PRE-MIGRATION envelope: finalize under the ratified
    // vocabulary, then rewrite the durable byte to the retired name with no
    // reason — exactly what a record written before 2026-08-12 looks like on
    // disk. The caller reads the bytes back itself; this returns the ratified
    // handle rather than pretending the retired literal is a live status.
    const ratified = await finalizeRun(
      input.stateHome,
      input.app,
      input.runId,
      {
        status: "interrupted",
        interruptedReason: "time_limit",
        ...(input.usage !== undefined ? { usage: input.usage } : {}),
      },
      input.finishedAt ?? input.startedAt,
    );
    const path = join(input.stateHome, "state", "runs", input.app, input.runId, "envelope.json");
    const legacy: Record<string, unknown> = JSON.parse(await readFile(path, "utf8"));
    legacy["status"] = "timed_out";
    delete legacy["interrupted_reason"];
    await writeFile(path, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
    return ratified;
  }
  return finalizeRun(
    input.stateHome,
    input.app,
    input.runId,
    {
      status: input.status,
      ...(input.usage !== undefined ? { usage: input.usage } : {}),
    },
    input.finishedAt ?? input.startedAt,
  );
}

/** Plant a raw corrupt envelope.json — unreadable spend that reconcile must
 *  count, never settle, never delete. No living writer produces this. */
export async function plantCorruptEnvelope(stateHome: string, app: string, runId: string): Promise<void> {
  const dir = join(stateHome, "runs", app, runId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "envelope.json"), "{torn mid-write", "utf8");
}

// ---------------------------------------------------------------------------
// The family conservation detector (negative-control rule: every suite proves
// it FIRES on a seeded violation).
// ---------------------------------------------------------------------------

export class SettlementConservationViolation extends Error {
  constructor(readonly duplicates: ReadonlyMap<string, number>) {
    super(
      "INV-006 violated: settlement key(s) settled more than once — " +
        [...duplicates.entries()].map(([key, count]) => `${JSON.stringify(key)} x${count}`).join(", "),
    );
    this.name = "SettlementConservationViolation";
  }
}

/** Throws when any (app, providerTurnId|runId) settlement identity appears in
 *  the ledger corpus more than once. Uses the product's own key derivation. */
export function detectDoubleSettlement(rows: readonly TurnRecord[]): void {
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
