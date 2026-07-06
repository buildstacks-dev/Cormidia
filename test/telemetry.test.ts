// Per-app / per-trigger telemetry attribution (build plan M3.2).
//
// TurnRecord gained optional `app` and `trigger` fields so co-planning and
// dispatched turns roll up per app (docs/architecture.md §7 budget rollup,
// §8 `trigger: manual`). The contract pinned here is strict back-compat:
// when no attribution is passed, the keys are ABSENT from the record and
// from the serialized JSONL line — not present-as-null/undefined — so
// pre-M3.2 telemetry files and new unattributed lines have the same shape.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordTurn, toRecord } from "../src/runtime/telemetry.js";
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

  it("carries partial attribution without inventing the missing half", () => {
    const record = toRecord(ROLE, RESULT, AT, { trigger: "schedule" });

    expect(record.trigger).toBe("schedule");
    expect("app" in record).toBe(false);
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
