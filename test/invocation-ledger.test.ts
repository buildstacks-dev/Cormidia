import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendInvocationOnce,
  beginCliInvocation,
  finishCliInvocation,
  invocationJournalPath,
  reconcileCliInvocations,
  type InvocationRecord,
  type RunningCliInvocation,
} from "../src/runtime/invocation-ledger.js";
import { redactArgv } from "../src/cli/invocation-audit.js";

const START = "2026-07-21T10:00:00.000Z";

function running(id: string): RunningCliInvocation {
  return {
    schema_version: 2,
    at: START,
    kind: "cli",
    invocationId: id,
    command: "roles",
    argv: ["roles"],
    dryRun: false,
  };
}

function terminal(id: string): InvocationRecord & { invocationId: string } {
  return {
    ...running(id),
    finishedAt: "2026-07-21T10:00:01.000Z",
    outcome: "completed",
    exitCode: 0,
    wallClockMs: 1_000,
  };
}

describe("command invocation ledger", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("persists intent first and terminalizes exactly once by stable identity", async () => {
    root = mkdtempSync(join(tmpdir(), "operon-invocation-ledger-"));
    const row = terminal("cli-exactly-once");
    await beginCliInvocation(root, running(row.invocationId));
    expect(existsSync(invocationJournalPath(root, row.invocationId))).toBe(true);

    await finishCliInvocation(root, row);
    expect(existsSync(invocationJournalPath(root, row.invocationId))).toBe(false);
    expect(await appendInvocationOnce(root, row)).toBe(false);

    const lines = readFileSync(join(root, "invocations", "2026-07-21.jsonl"), "utf8")
      .trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      schema_version: 2,
      invocationId: row.invocationId,
      command: "roles",
      outcome: "completed",
      exitCode: 0,
    });
  });

  it("reconciles a dead process running journal as interrupted, but never guesses a live one", async () => {
    root = mkdtempSync(join(tmpdir(), "operon-invocation-recovery-"));
    await beginCliInvocation(root, running("cli-dead"));
    const deadPath = invocationJournalPath(root, "cli-dead");
    const dead = JSON.parse(readFileSync(deadPath, "utf8")) as Record<string, unknown>;
    dead["pid"] = 99_999_999;
    writeFileSync(deadPath, `${JSON.stringify(dead)}\n`);

    // Starting the next command performs the recovery before persisting its
    // own live journal.
    await beginCliInvocation(root, running("cli-live"));
    expect(await reconcileCliInvocations(root, new Date("2026-07-21T10:00:02.000Z"))).toBe(0);
    expect(existsSync(deadPath)).toBe(false);
    expect(existsSync(invocationJournalPath(root, "cli-live"))).toBe(true);

    const rows = readFileSync(join(root, "invocations", "2026-07-21.jsonl"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows).toEqual([
      expect.objectContaining({
        invocationId: "cli-dead",
        outcome: "interrupted: process exited without a terminal command result",
        exitCode: 1,
      }),
    ]);
  });

  it("redacts sensitive flag values and embedded credential shapes without hiding ordinary provenance", () => {
    expect(redactArgv([
      "new-app",
      "alpha",
      "--template",
      "bare",
      "--api-key",
      "sk-12345678901234567890",
      "--token=ghp_12345678901234567890",
    ])).toEqual([
      "new-app",
      "alpha",
      "--template",
      "bare",
      "--api-key",
      "[REDACTED:argv-value]",
      "--token=[REDACTED:argv-value]",
    ]);
  });
});
