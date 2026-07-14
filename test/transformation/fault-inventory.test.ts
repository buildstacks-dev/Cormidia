import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { executeFaultBoundary, runUnauthorizedFaultWorker } from "../../scripts/eval/fault-matrix.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const faults = (parse(readFileSync(fileURLToPath(new URL("../../eval/faults.yaml", import.meta.url)), "utf8")) as { faults: string[] }).faults;
const operations = ["archive_creation", "archive_checksum", "archive_rename", "registry_write", "config_write", "git_fetch", "ref_validation", "worktree_creation", "provider_start", "provider_first_event", "usage_checkpoint", "provider_final_result", "commit", "push", "pr", "comment", "review", "label", "merge", "approval_log_write", "approval_item_write", "approval_grant_write", "run_finalization", "ledger_settlement", "capture_cursor_update", "scheduler_lock", "tick_journal", "child_spawn", "learning_publish_journal", "learning_version_activation"];
const expectedFaults = operations.flatMap((operation) => [`before_${operation}`, `after_${operation}`]);

it("the named fault inventory covers every ratified durable boundary without duplicates", () => {
  expect(faults).toEqual(expectedFaults);
  expect(faults).toHaveLength(60);
});

describe("exhaustive subprocess fault matrix", () => {
  for (const fault of faults) {
    it(`${fault}: kill, inspect, resume, and rerun through the worker command`, () => {
      const root = mkdtempSync(join(tmpdir(), `operon-fault-${fault.slice(0, 24)}-`)); roots.push(root);
      expect(executeFaultBoundary(root, fault)).toMatchObject({ fault, interrupted_exit: 86, completed_effect_count: 1, idempotent_effect_count: 1, terminal: true });
    });
  }
  it("honest failure: the injector is unreachable without the unguessable eval token", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-fault-unauthorized-")); roots.push(root);
    const result = runUnauthorizedFaultWorker(root, faults[0]!);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("fault_worker_unauthorized");
  });
});
