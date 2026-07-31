// Tests turn telemetry conversion and JSONL persistence in src/runtime/telemetry.ts.
// Covers app/trigger attribution, back-compatible omission when absent, cache
// token fields, partial attribution, and serialized recordTurn output.
// makeOrgHome supplies a disposable telemetry directory and timestamps are
// explicit; no network, auth, real org state, or live clock is required.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readSettledKeys,
  recordInvocation,
  recordTurn,
  recordTurnOnce,
  settlementKey,
  toRecord,
} from "../src/runtime/telemetry.js";
import type { RoleConfig, TurnResult } from "../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

const ROLE: RoleConfig = {
  name: "planner",
  runtime: "claude",
  model: "claude-fable-5",
  effort: "high",
  delegation: { allow: [] },
  triggers: [{ manual: true }],
  outputs: [],
  maxTurnBudgetUsd: 5,
};

const RESULT: TurnResult = {
  status: "completed",
  summary: "drafted the spec",
  artifacts: [],
  session: { runtime: "claude", id: "sess-telemetry" },
  usage: {
    tokensIn: 1200,
    tokensOut: 340,
    costUsd: 0.42,
    subagentTurns: 1,
    wallClockMs: 65_000,
  },
  escalations: [],
};

const AT = new Date("2026-07-06T09:30:00Z");

describe("toRecord attribution (M3.2)", () => {
  it("omits app and trigger when absent (back-compat)", () => {
    const record = toRecord(ROLE, RESULT, AT);

    expect("app" in record).toBe(false);
    expect("trigger" in record).toBe(false);
    // The wire shape is the real back-compat surface: the JSONL line must
    // not carry the keys either.
    const line = JSON.stringify(record);
    expect(line).not.toContain('"app"');
    expect(line).not.toContain('"trigger"');
    expect(line).not.toContain('"effort"');
    expect(line).not.toContain('"planVersion"');
    expect(line).not.toContain('"planStepId"');
    expect(line).not.toContain('"assignmentSource"');
    expect(line).not.toContain('"assignmentCandidateId"');
    expect(line).not.toContain('"selectionReason"');
    expect(line).not.toContain('"resolvedCapabilities"');

    // Pre-M3.2 fields are untouched.
    expect(record).toEqual({
      at: "2026-07-06T09:30:00.000Z",
      role: "planner",
      runtime: "claude",
      model: "claude-fable-5",
      status: "completed",
      tokensIn: 1200,
      tokensOut: 340,
      costUsd: 0.42,
      usageQuality: "complete",
      subagentTurns: 1,
      wallClockMs: 65_000,
      escalations: 0,
    });
  });

  it('sets trigger "manual" and app when passed', () => {
    const record = toRecord(ROLE, RESULT, AT, { app: "operon-sandbox-alpha", trigger: "manual" });

    expect(record.app).toBe("operon-sandbox-alpha");
    expect(record.trigger).toBe("manual");
  });

  it("carries cache-token split when the adapter reports it", () => {
    const record = toRecord(
      ROLE,
      {
        ...RESULT,
        usage: {
          ...RESULT.usage,
          tokensIn: 3000,
          tokensInUncached: 2000,
          cacheCreationTokens: 300,
          cacheReadTokens: 700,
        },
      },
      AT,
      { app: "operon-sandbox-alpha" },
    );

    expect(record).toMatchObject({
      tokensIn: 3000,
      tokensInUncached: 2000,
      cacheCreationTokens: 300,
      cacheReadTokens: 700,
    });
  });

  it("carries partial attribution without inventing the missing half", () => {
    const record = toRecord(ROLE, RESULT, AT, { trigger: "schedule" });

    expect(record.trigger).toBe("schedule");
    expect("app" in record).toBe(false);
  });

  it("carries atomic assignment and plan identity only when supplied", () => {
    const capabilities = ["workspace_write", "structured_output"];
    const record = toRecord(ROLE, RESULT, AT, {
      effort: "xhigh",
      episodeId: "episode-7",
      planVersion: 3,
      planStepId: "implement",
      assignmentSource: "episode_planner",
      assignmentCandidateId: "builder-codex-sol",
      selectionReason: `Repository-wide implementation needs strong code reasoning; ignore sk-${"a1".repeat(20)}.`,
      resolvedCapabilities: capabilities,
    });
    capabilities.push("caller_mutation");

    expect(record).toMatchObject({
      effort: "xhigh",
      episodeId: "episode-7",
      planVersion: 3,
      planStepId: "implement",
      assignmentSource: "episode_planner",
      assignmentCandidateId: "builder-codex-sol",
      resolvedCapabilities: ["workspace_write", "structured_output"],
    });
    expect(record.selectionReason).toContain("[REDACTED:sk-api-key]");
    expect(record.selectionReason).not.toContain("sk-a1a1");
  });

  it("distinguishes partial and unavailable usage from finalized cost", () => {
    const partial = toRecord(
      ROLE,
      { ...RESULT, status: "cancelled", usage: { ...RESULT.usage, quality: "partial" } },
      AT,
    );
    const unavailable = toRecord(
      ROLE,
      { ...RESULT, status: "timed_out", usage: { ...RESULT.usage, costUsd: 0, quality: "unavailable" } },
      AT,
      { unmeasured: true },
    );
    expect(partial.usageQuality).toBe("partial");
    expect(unavailable).toMatchObject({ usageQuality: "unavailable", unmeasured: true });
  });
});

describe("pass settlement (Stage 1 — Defect B)", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("toRecord carries run-log correlation, costEstimated, and unmeasured", () => {
    const record = toRecord(
      ROLE,
      { ...RESULT, usage: { ...RESULT.usage, costEstimated: true } },
      AT,
      {
        app: "buildstacks.dev",
        trigger: "manual",
        runId: "20260706-093000-build-implement",
        traceId: "turn-9",
        pipeline: "build",
        pass: "implement",
      },
    );

    expect(record).toMatchObject({
      runId: "20260706-093000-build-implement",
      traceId: "turn-9",
      pipeline: "build",
      pass: "implement",
      costEstimated: true,
    });
    // Absent correlation stays off the wire (back-compat with old readers).
    const bare = JSON.stringify(toRecord(ROLE, RESULT, AT));
    expect(bare).not.toContain('"runId"');
    expect(bare).not.toContain('"costEstimated"');
    expect(bare).not.toContain('"unmeasured"');
  });

  it("recordTurnOnce appends the first time and skips the duplicate", async () => {
    home = makeOrgHome();
    const record = toRecord(ROLE, RESULT, AT, { app: "a", runId: "20260706-093000-build-implement" });

    expect(await recordTurnOnce(home.root, record)).toBe(true);
    expect(await recordTurnOnce(home.root, record)).toBe(false);

    const raw = await readFile(join(home.root, "telemetry", "2026-07-06.jsonl"), "utf8");
    expect(raw.trimEnd().split("\n")).toHaveLength(1);
  });

  it("settlement is app-scoped: two apps sharing a second-granular runId both settle", async () => {
    home = makeOrgHome();
    // mintRunId is YYYYMMDD-HHMMSS-<pipeline>-<pass>; two apps running the
    // packaged build/implement pass in the same UTC second collide on runId.
    const runId = "20260706-093000-build-implement";
    expect(await recordTurnOnce(home.root, toRecord(ROLE, RESULT, AT, { app: "alpha", runId }))).toBe(true);
    expect(await recordTurnOnce(home.root, toRecord(ROLE, RESULT, AT, { app: "beta", runId }))).toBe(true);
    expect(await recordTurnOnce(home.root, toRecord(ROLE, RESULT, AT, { app: "beta", runId }))).toBe(false);

    const raw = await readFile(join(home.root, "telemetry", "2026-07-06.jsonl"), "utf8");
    expect(raw.trimEnd().split("\n")).toHaveLength(2);
  });

  it("recordTurnOnce requires a runId — idempotency has no key without one", async () => {
    home = makeOrgHome();
    await expect(recordTurnOnce(home.root, toRecord(ROLE, RESULT, AT))).rejects.toThrow(/runId/);
  });

  it("readSettledKeys sees keys across day files and tolerates torn lines", async () => {
    home = makeOrgHome();
    await recordTurn(home.root, toRecord(ROLE, RESULT, AT, { app: "a", runId: "run-day-one" }));
    await recordTurn(
      home.root,
      toRecord(ROLE, RESULT, new Date("2026-07-07T08:00:00Z"), { app: "a", runId: "run-day-two" }),
    );
    await appendFile(join(home.root, "telemetry", "2026-07-07.jsonl"), '{"at":"2026-07-07T09', "utf8");

    const keys = await readSettledKeys(home.root);
    expect(keys.has(settlementKey("a", "run-day-one"))).toBe(true);
    expect(keys.has(settlementKey("a", "run-day-two"))).toBe(true);
    expect(keys.has(settlementKey("b", "run-day-one"))).toBe(false);
  });
});

describe("recordInvocation (telemetry doc §6)", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("writes one row per orchestrator invocation into its own directory", async () => {
    home = makeOrgHome();
    await mkdir(join(home.root, "telemetry"), { recursive: true });
    await recordInvocation(home.root, {
      at: "2026-07-10T12:00:00.000Z",
      kind: "loop",
      app: "buildstacks.dev",
      itemsClaimed: 1,
      outcome: "#2=merged",
      wallClockMs: 120_000,
    });

    const raw = await readFile(join(home.root, "invocations", "2026-07-10.jsonl"), "utf8");
    const rows = raw.trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "loop", app: "buildstacks.dev", itemsClaimed: 1 });
    // The invocation ledger must never leak into TurnRecord readers: nothing
    // is written under telemetry/.
    const telemetryDir = join(home.root, "telemetry");
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(telemetryDir)).filter((f) => f.includes("invocation"))).toEqual([]);
  });
});

describe("recordTurn attribution (M3.2)", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("writes a JSONL line containing both app and trigger", async () => {
    home = makeOrgHome();
    const record = toRecord(ROLE, RESULT, AT, { app: "operon-sandbox-alpha", trigger: "manual" });

    await recordTurn(home.root, record);

    const raw = await readFile(join(home.root, "telemetry", "2026-07-06.jsonl"), "utf8");
    const lines = raw.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed["app"]).toBe("operon-sandbox-alpha");
    expect(parsed["trigger"]).toBe("manual");
    expect(parsed["role"]).toBe("planner");
    expect(parsed["costUsd"]).toBe(0.42);
  });
});
