import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

interface State {
  schema_version: 1;
  operation: string;
  intent: boolean;
  effect_count: number;
  receipt: boolean;
  terminal: boolean;
}

const rootArg = option("--root");
const operation = option("--operation");
const fault = option("--fault");
const token = option("--token");
if (!rootArg || !operation || !/^(before|after)_[a-z0-9_]+$/.test(fault ?? "")) throw new Error("fault_worker_invalid_arguments");
if (!token || process.env.OPERON_EVAL_FAULT_TOKEN !== token || !token.startsWith("eval-fault-")) throw new Error("fault_worker_unauthorized");
const root = resolve(rootArg);
if (process.env.OPERON_EVAL_ROOT !== root) throw new Error("fault_worker_root_mismatch");
// The argument guard above throws unless `operation` is present; capture the
// narrowed value so the hoisted readState closure sees a defined string.
const operationName: string = operation;
const statePath = join(root, "state.json");
const effectPath = join(root, "effect.json");
const prior = readState();
if (prior.operation !== operation) throw new Error("fault_worker_operation_mismatch");

persist({ ...prior, intent: true });
trip("before");
const current = readState();
if (!existsSync(effectPath)) {
  writeAtomic(effectPath, { schema_version: 1, operation, idempotency_key: digest(operation) });
  persist({ ...current, effect_count: current.effect_count + 1 });
}
trip("after");
const effected = readState();
persist({ ...effected, receipt: true, terminal: true });
process.stdout.write(`${JSON.stringify(readState())}\n`);

function trip(side: "before" | "after"): void {
  if (fault === `${side}_${operation}` && process.env.OPERON_EVAL_INJECT_FAULT === fault) process.exit(86);
}
function readState(): State {
  if (!existsSync(statePath)) return { schema_version: 1, operation: operationName, intent: false, effect_count: 0, receipt: false, terminal: false };
  return JSON.parse(readFileSync(statePath, "utf8")) as State;
}
function persist(state: State): void { writeAtomic(statePath, state); }
function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  renameSync(temp, path);
}
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
