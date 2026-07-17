import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLedgerRange } from "../../src/report/ledger-source.js";
import { normalizeReportRange } from "../../src/report/range.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

describe("diagnostic daily ledger reader", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("retries a concurrent append and returns the stable second snapshot", async () => {
    home = makeOrgHome();
    const dir = join(home.root, "telemetry"); mkdirSync(dir, { recursive: true });
    const path = join(dir, "2026-07-12.jsonl"); writeFileSync(path, `${JSON.stringify(row("one"))}\n`);
    let appended = false;
    const read = await readLedgerRange(home.root, normalizeReportRange({ period: "7d" }, new Date("2026-07-12T12:00:00Z")), new Date("2026-07-12T12:00:00Z"), {
      afterRead: (_path, attempt) => { if (!appended && attempt === 0) { appended = true; appendFileSync(path, `${JSON.stringify(row("two"))}\n`); } },
    });
    expect(read.rows.map(({ record }) => record.runId)).toEqual(["one", "two"]);
    expect(read.diagnostics.some((item) => item.kind === "concurrent_write")).toBe(false);
  });

  it("marks an unreadable day as a source gap while keeping readable days", async () => {
    home = makeOrgHome();
    const dir = join(home.root, "telemetry"); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-07-11.jsonl"), `${JSON.stringify({ ...row("ok"), at: "2026-07-11T09:00:00Z" })}\n`);
    mkdirSync(join(dir, "2026-07-12.jsonl"));
    const read = await readLedgerRange(home.root, normalizeReportRange({ period: "7d" }, new Date("2026-07-12T12:00:00Z")), new Date("2026-07-12T12:00:00Z"));
    expect(read.rows).toHaveLength(1);
    expect(read.diagnostics).toContainEqual(expect.objectContaining({ kind: "unreadable_day", day: "2026-07-12" }));
  });

  it("warns when a file changes during both attempts", async () => {
    home = makeOrgHome();
    const dir = join(home.root, "telemetry"); mkdirSync(dir, { recursive: true });
    const path = join(dir, "2026-07-12.jsonl"); writeFileSync(path, `${JSON.stringify(row("one"))}\n`);
    let counter = 0;
    const read = await readLedgerRange(home.root, normalizeReportRange({ period: "7d" }, new Date("2026-07-12T12:00:00Z")), new Date("2026-07-12T12:00:00Z"), {
      afterRead: () => { appendFileSync(path, `${JSON.stringify(row(`extra-${counter++}`))}\n`); },
    });
    expect(read.diagnostics).toContainEqual(expect.objectContaining({ kind: "concurrent_write", day: "2026-07-12" }));
    expect(read.rows.length).toBeGreaterThanOrEqual(2);
  });
});

function row(runId: string): Record<string, unknown> { return { at: "2026-07-12T09:00:00Z", role: "builder", runtime: "codex", model: "m", status: "completed", tokensIn: 1, tokensOut: 1, costUsd: 0.1, usageQuality: "complete", subagentTurns: 0, wallClockMs: 1, escalations: 0, app: "alpha", runId }; }
