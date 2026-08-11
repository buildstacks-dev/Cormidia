// Traceability: CF-INV-013 · HB-148 · CORMIDIA-INV-013; system-map.md §2.2/§2.5; CORMIDIA-C-B15-001 §1/§3.

// CF-INV-013 (L2) — every ratified durable-store class preserves only an
// old/new valid state or a recognized recoverable journal intermediate.
// The kill-point legs exercise the three system-map §2.5 shapes directly:
// append-only/keyed, atomic whole-file replacement, and multi-step journal.

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  beginCliInvocation,
  type InvocationRecord,
  type RunningCliInvocation,
} from "../../../src/runtime/invocation-ledger.js";
import { readEnvelope, startRun } from "../../../src/runtime/runlog/envelope.js";
import { runPaths } from "../../../src/runtime/runlog/paths.js";
import { readTurnRecords, type TurnRecord } from "../../../src/runtime/telemetry.js";
import { runKillPointScenario } from "../../fixtures/kill-point.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";

const AT = "2026-08-11T18:00:00.000Z";
const APP = "cf-inv-013";
const RUN_ID = "20260811-180000-integrity-store";

const TELEMETRY_MODULE = pathToFileURL(resolve("src/runtime/telemetry.ts")).href;
const ENVELOPE_MODULE = pathToFileURL(resolve("src/runtime/runlog/envelope.ts")).href;
const INVOCATION_MODULE = pathToFileURL(resolve("src/runtime/invocation-ledger.ts")).href;

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function turnRecord(providerTurnId: string, status: TurnRecord["status"] = "completed"): TurnRecord {
  return {
    at: AT,
    role: "builder",
    runtime: "codex",
    model: "seeded-double",
    status,
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0,
    usageQuality: "complete",
    subagentTurns: 0,
    wallClockMs: 1,
    escalations: 0,
    app: APP,
    providerTurnId,
  };
}

function runningInvocation(invocationId: string): RunningCliInvocation {
  return {
    schema_version: 2,
    at: AT,
    kind: "cli",
    invocationId,
    command: "status",
    argv: ["status"],
    app: APP,
    dryRun: false,
  };
}

async function state(name: string): Promise<TempStateHome> {
  const fixture = await makeTempStateHome({ name });
  cleanups.push(fixture.cleanup);
  return fixture;
}

function unsafeTerminalScan(bytes: string): boolean {
  return /"(?:status|outcome)"\s*:\s*"completed"/u.test(bytes);
}

function appendKillSource(): string {
  return `
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
const { recordTurn } = await import(process.env.TELEMETRY_MODULE);
const root = join(process.env.KP_SCRATCH, "org");
await recordTurn(root, ${JSON.stringify(turnRecord("durable-before-crash"))});
const ledger = join(root, "telemetry", "2026-08-11.jsonl");
await mkdir(join(root, "telemetry"), { recursive: true });
await appendFile(ledger, '{"at":"${AT}","role":"forged","status":"completed"', "utf8");
await kp("append-fragment-durable");
await appendFile(ledger, '}\\n', "utf8");
`;
}

function atomicRenameKillSource(): string {
  return `
import { writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
const { startRun } = await import(process.env.ENVELOPE_MODULE);
const root = join(process.env.KP_SCRATCH, "org");
const runId = ${JSON.stringify(RUN_ID)};
await startRun(root, {
  runId,
  traceId: "trace-old",
  app: ${JSON.stringify(APP)},
  pipeline: "integrity",
  pass: "store",
  role: "builder",
}, new Date(${JSON.stringify(AT)}));
const target = join(root, "runs", ${JSON.stringify(APP)}, runId, "envelope.json");
const next = JSON.parse(await (await import("node:fs/promises")).readFile(target, "utf8"));
next.status = "completed";
next.finished_at = ${JSON.stringify(AT)};
const temp = target + ".seeded.tmp";
await writeFile(temp, JSON.stringify(next) + "\\n", "utf8");
await kp("replacement-temp-durable");
await rename(temp, target);
`;
}

function journalKillSource(): string {
  return `
import { join } from "node:path";
const { beginCliInvocation } = await import(process.env.INVOCATION_MODULE);
const root = join(process.env.KP_SCRATCH, "org");
await beginCliInvocation(root, ${JSON.stringify(runningInvocation("crashed-command"))});
await kp("journal-intent-durable");
`;
}

async function invocationLedgerRows(stateHome: string): Promise<InvocationRecord[]> {
  const path = join(stateHome, "invocations", "2026-08-11.jsonl");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as InvocationRecord);
}

describe("CF-INV-013 append-only/keyed stores", () => {
  it("SIGKILL after a torn append preserves complete rows and rejects the partial terminal claim", async () => {
    const result = await runKillPointScenario({
      source: appendKillSource(),
      killAt: "append-fragment-durable",
      env: { TELEMETRY_MODULE },
    });
    cleanups.push(result.cleanup);

    expect(result).toMatchObject({ timedOut: false, killedAt: "append-fragment-durable" });
    expect(result.markers).toEqual(["append-fragment-durable"]);
    const root = join(result.stateDir, "org");
    await assertNonEmptyWalk(join(root, "telemetry"));
    const bytes = await readFile(join(root, "telemetry", "2026-08-11.jsonl"), "utf8");
    expect(unsafeTerminalScan(bytes)).toBe(true); // seeded unsafe reader turns red
    expect((await readTurnRecords(root)).map((row) => row.providerTurnId)).toEqual(["durable-before-crash"]);
  });

  it("negative control: a standalone truncated JSON row is never terminal state", async () => {
    const fixture = await state("cf-inv-013-append-truncated");
    const path = fixture.path("telemetry", "2026-08-11.jsonl");
    const partial = `{"at":"${AT}","status":"completed","providerTurnId":"truncated"`;
    await writeFile(path, partial, "utf8");

    expect(unsafeTerminalScan(partial)).toBe(true);
    expect(await readTurnRecords(fixture.stateHome)).toEqual([]);
  });

  it("negative control: valid-looking bytes in a quarantine filename are never ledger state", async () => {
    const fixture = await state("cf-inv-013-append-quarantine");
    const quarantined = JSON.stringify(turnRecord("quarantined-turn"));
    await writeFile(fixture.path("telemetry", "2026-08-11.jsonl.corrupt"), `${quarantined}\n`, "utf8");

    expect(unsafeTerminalScan(quarantined)).toBe(true);
    await assertNonEmptyWalk(fixture.path("telemetry"));
    expect(await readTurnRecords(fixture.stateHome)).toEqual([]);
  });
});

describe("CF-INV-013 atomic whole-file replacement stores", () => {
  it("SIGKILL after the replacement temp is durable but before rename exposes the old valid envelope", async () => {
    const result = await runKillPointScenario({
      source: atomicRenameKillSource(),
      killAt: "replacement-temp-durable",
      env: { ENVELOPE_MODULE },
    });
    cleanups.push(result.cleanup);

    expect(result).toMatchObject({ timedOut: false, killedAt: "replacement-temp-durable" });
    expect(result.markers).toEqual(["replacement-temp-durable"]);
    const root = join(result.stateDir, "org");
    await assertNonEmptyWalk(join(root, "runs", APP, RUN_ID));
    expect(await readEnvelope(root, APP, RUN_ID)).toMatchObject({ status: "running", trace_id: "trace-old" });
  });

  it("negative control: truncated replacement bytes at the authoritative path are rejected", async () => {
    const fixture = await state("cf-inv-013-atomic-truncated");
    await startRun(
      fixture.stateHome,
      { runId: RUN_ID, traceId: "trace", app: APP, pipeline: "integrity", pass: "store", role: "builder" },
      new Date(AT),
    );
    const path = runPaths(fixture.stateHome, APP, RUN_ID).envelope;
    const partial = `{"schema_version":1,"run_id":"${RUN_ID}","status":"completed"`;
    await writeFile(path, partial, "utf8");

    expect(unsafeTerminalScan(partial)).toBe(true);
    await expect(readEnvelope(fixture.stateHome, APP, RUN_ID)).rejects.toThrow(SyntaxError);
  });

  it("negative control: a quarantined completed replacement cannot override the valid target", async () => {
    const fixture = await state("cf-inv-013-atomic-quarantine");
    const old = await startRun(
      fixture.stateHome,
      { runId: RUN_ID, traceId: "trace-old", app: APP, pipeline: "integrity", pass: "store", role: "builder" },
      new Date(AT),
    );
    const path = runPaths(fixture.stateHome, APP, RUN_ID).envelope;
    const forged = JSON.stringify({ ...old, status: "completed", trace_id: "quarantined" });
    await writeFile(`${path}.corrupt`, `${forged}\n`, "utf8");

    expect(unsafeTerminalScan(forged)).toBe(true);
    expect(await readEnvelope(fixture.stateHome, APP, RUN_ID)).toMatchObject({
      status: "running",
      trace_id: "trace-old",
    });
  });
});

describe("CF-INV-013 multi-step journal stores", () => {
  it("SIGKILL after running intent leaves a recognized intermediate that the next actor reconciles", async () => {
    const result = await runKillPointScenario({
      source: journalKillSource(),
      killAt: "journal-intent-durable",
      env: { INVOCATION_MODULE },
    });
    cleanups.push(result.cleanup);

    expect(result).toMatchObject({ timedOut: false, killedAt: "journal-intent-durable" });
    expect(result.markers).toEqual(["journal-intent-durable"]);
    const root = join(result.stateDir, "org");
    await assertNonEmptyWalk(join(root, "state", "invocation-journal"));
    await beginCliInvocation(root, runningInvocation("recovery-actor"));

    const rows = await invocationLedgerRows(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      invocationId: "crashed-command",
      outcome: "interrupted: process exited without a terminal command result",
      exitCode: 1,
    });
    await expect(
      readFile(join(root, "state", "invocation-journal", "crashed-command.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("negative control: a truncated journal is rejected instead of recovered as terminal", async () => {
    const fixture = await state("cf-inv-013-journal-truncated");
    const partial = `{"schema_version":1,"state":"terminal","pid":999999,"invocation":{"invocationId":"truncated","outcome":"completed"`;
    await writeFile(fixture.path("state", "invocation-journal", "truncated.json"), partial, "utf8");

    expect(unsafeTerminalScan(partial)).toBe(true);
    await expect(beginCliInvocation(fixture.stateHome, runningInvocation("reader"))).rejects.toThrow(SyntaxError);
    expect(await invocationLedgerRows(fixture.stateHome)).toEqual([]);
  });

  it("negative control: a quarantined terminal journal is not reconciled into the audit ledger", async () => {
    const fixture = await state("cf-inv-013-journal-quarantine");
    const forged = JSON.stringify({
      schema_version: 1,
      state: "terminal",
      pid: 999999,
      invocation: {
        ...runningInvocation("quarantined-command"),
        finishedAt: AT,
        outcome: "completed",
        exitCode: 0,
        wallClockMs: 1,
      },
    });
    await writeFile(fixture.path("state", "invocation-journal", "quarantined-command.json.corrupt"), forged, "utf8");

    expect(unsafeTerminalScan(forged)).toBe(true);
    await beginCliInvocation(fixture.stateHome, runningInvocation("reader"));
    expect(await invocationLedgerRows(fixture.stateHome)).toEqual([]);
  });
});
