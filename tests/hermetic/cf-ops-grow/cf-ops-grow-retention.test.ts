// HB-044 — CF-OPS-GROW seeded aged-state retention at the ratified
// 30/180/365-day boundaries, including ledger reconciliation protection.

import { afterEach, describe, expect, it } from "vitest";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_STATE_RETENTION, effectiveRetentionWindows, sweepStateRetention } from "../../../src/org/retention.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const DAY = 86_400_000;
const NOW = new Date("2026-07-31T00:00:00.000Z");
const homes: TempStateHome[] = [];

afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

function ago(days: number, extraMs = 0): string {
  return new Date(NOW.getTime() - days * DAY - extraMs).toISOString();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value) + "\n", "utf8");
}

async function seedRun(
  root: string,
  runId: string,
  status: "completed" | "running",
  finishedAt?: string,
  providerTurnId?: string,
) {
  const dir = join(root, "runs", "app", runId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "envelope.json"),
    JSON.stringify({
      schema_version: 1,
      run_id: runId,
      trace_id: runId,
      app: "app",
      pipeline: "build",
      pass: "build",
      role: "builder",
      status,
      started_at: ago(500),
      ...(finishedAt === undefined ? {} : { finished_at: finishedAt }),
      ...(providerTurnId === undefined ? {} : { provider_turn_ids: [providerTurnId] }),
    }) + "\n",
    "utf8",
  );
  return dir;
}

describe("HB-044 state growth retention", () => {
  it("keeps exact-boundary and unprovable state, prunes older proven state, and protects reconcilable ledger rows", async () => {
    const home = await makeTempStateHome({ name: "grow-org" });
    homes.push(home);

    const runAtBoundary = await seedRun(home.stateHome, "run-30d", "completed", ago(30));
    const oldRun = await seedRun(home.stateHome, "run-30d-old", "completed", ago(30, 1));
    const corruptRun = join(home.stateHome, "runs", "app", "run-corrupt");
    await mkdir(corruptRun, { recursive: true });
    await writeFile(join(corruptRun, "envelope.json"), "{torn", "utf8");
    const protectingRun = await seedRun(home.stateHome, "run-protect", "running", undefined, "turn-protected");

    const exactTask = join(home.stateHome, "tasks", "task-180d");
    const oldTask = join(home.stateHome, "tasks", "task-180d-old");
    await writeJson(join(exactTask, "task.json"), {
      schemaVersion: 1,
      taskId: "task-180d",
      status: "completed",
      endedAt: ago(180),
    });
    await writeJson(join(oldTask, "task.json"), {
      schemaVersion: 1,
      taskId: "task-180d-old",
      status: "failed",
      endedAt: ago(180, 1),
    });

    const exactLedgerDay = ago(365).slice(0, 10);
    const oldLedgerDay = ago(366).slice(0, 10);
    const protectedLedgerDay = ago(400).slice(0, 10);
    const ledger = join(home.stateHome, "telemetry");
    await writeFile(
      join(ledger, `${exactLedgerDay}.jsonl`),
      JSON.stringify({ app: "app", providerTurnId: "turn-exact" }) + "\n",
      "utf8",
    );
    await writeFile(
      join(ledger, `${oldLedgerDay}.jsonl`),
      JSON.stringify({ app: "app", providerTurnId: "turn-old" }) + "\n",
      "utf8",
    );
    await writeFile(
      join(ledger, `${protectedLedgerDay}.jsonl`),
      JSON.stringify({ app: "app", providerTurnId: "turn-protected" }) + "\n",
      "utf8",
    );

    // The evidence-floor clamp intentionally lengthens this nominal 180-day
    // window to 182 days (180-day episode evidence + 2-day reconcile margin).
    const exactLearning = join(home.stateHome, "learning", "events", ago(182).slice(0, 10));
    const oldLearning = join(home.stateHome, "learning", "events", ago(183).slice(0, 10));
    await mkdir(exactLearning, { recursive: true });
    await mkdir(oldLearning, { recursive: true });
    await writeFile(join(exactLearning, "event.json"), "{}\n", "utf8");
    await writeFile(join(oldLearning, "event.json"), "{}\n", "utf8");

    const result = await sweepStateRetention(home.stateHome, NOW);
    expect(result.errors).toEqual([]);
    expect(result.windows).toEqual(effectiveRetentionWindows(DEFAULT_STATE_RETENTION));

    expect(await exists(runAtBoundary)).toBe(true);
    expect(await exists(oldRun)).toBe(false);
    expect(await exists(corruptRun)).toBe(true);
    expect(await exists(protectingRun)).toBe(true);
    expect(result.runs).toEqual({ pruned: 1, kept: 3 });

    expect(await exists(exactTask)).toBe(true);
    expect(await exists(oldTask)).toBe(false);
    expect(await exists(exactLearning)).toBe(true);
    expect(await exists(oldLearning)).toBe(false);

    expect(await exists(join(ledger, `${exactLedgerDay}.jsonl`))).toBe(true);
    expect(await exists(join(ledger, `${oldLedgerDay}.jsonl`))).toBe(false);
    expect(await exists(join(ledger, `${protectedLedgerDay}.jsonl`))).toBe(true);
    expect(result.telemetry).toEqual({ pruned: 1, kept: 2 });
  });
});
