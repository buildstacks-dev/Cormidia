import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const worker = join(packageRoot, "scripts/eval/fault-worker.ts");

export interface FaultExecutionResult {
  fault: string;
  operation: string;
  interrupted_exit: number;
  intermediate_effect_count: number;
  completed_effect_count: number;
  idempotent_effect_count: number;
  terminal: boolean;
}

export function executeFaultBoundary(root: string, fault: string): FaultExecutionResult {
  const operation = fault.replace(/^(before|after)_/, "");
  const token = `eval-fault-${randomBytes(16).toString("hex")}`;
  const interrupted = run(root, operation, fault, token, true);
  if (interrupted.status !== 86) throw new Error(`fault_not_injected: ${fault}/${String(interrupted.status)} ${interrupted.stderr}`);
  const intermediate = readState(root);
  if (!intermediate.intent || intermediate.terminal || intermediate.effect_count < 0 || intermediate.effect_count > 1) throw new Error(`illegal_fault_intermediate_state: ${fault}`);
  const expectedIntermediate = fault.startsWith("after_") ? 1 : 0;
  if (intermediate.effect_count !== expectedIntermediate) throw new Error(`fault_effect_boundary_mismatch: ${fault}`);
  const completedRun = run(root, operation, fault, token, false);
  if (completedRun.status !== 0) throw new Error(`fault_resume_failed: ${fault}/${String(completedRun.status)} ${completedRun.stderr}`);
  const completed = readState(root);
  if (!completed.terminal || !completed.receipt || completed.effect_count !== 1) throw new Error(`fault_resume_illegal_state: ${fault}`);
  const rerun = run(root, operation, fault, token, false);
  if (rerun.status !== 0) throw new Error(`fault_idempotent_rerun_failed: ${fault}/${String(rerun.status)} ${rerun.stderr}`);
  const idempotent = readState(root);
  if (idempotent.effect_count !== 1 || !idempotent.terminal) throw new Error(`fault_duplicate_effect: ${fault}`);
  return { fault, operation, interrupted_exit: interrupted.status, intermediate_effect_count: intermediate.effect_count, completed_effect_count: completed.effect_count, idempotent_effect_count: idempotent.effect_count, terminal: idempotent.terminal };
}

export function runUnauthorizedFaultWorker(root: string, fault: string): { status: number | null; output: string } {
  const operation = fault.replace(/^(before|after)_/, "");
  const result = spawnSync(process.execPath, [worker, "--root", root, "--operation", operation, "--fault", fault, "--token", "wrong"], { cwd: packageRoot, env: { ...process.env, OPERON_EVAL_ROOT: root }, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function run(root: string, operation: string, fault: string, token: string, inject: boolean) {
  return spawnSync(process.execPath, [worker, "--root", root, "--operation", operation, "--fault", fault, "--token", token], {
    cwd: packageRoot,
    env: { ...process.env, OPERON_EVAL_ROOT: root, OPERON_EVAL_FAULT_TOKEN: token, ...(inject ? { OPERON_EVAL_INJECT_FAULT: fault } : {}) },
    encoding: "utf8",
    timeout: 20_000,
  });
}

function readState(root: string): { intent: boolean; effect_count: number; receipt: boolean; terminal: boolean } {
  const path = join(root, "state.json");
  if (!existsSync(path)) throw new Error("fault_state_missing");
  return JSON.parse(readFileSync(path, "utf8")) as { intent: boolean; effect_count: number; receipt: boolean; terminal: boolean };
}
