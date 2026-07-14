import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import { buildSchedulerExpectation, parseSchedulerDefinition, type SchedulerDefinitionInput } from "./definition.js";
import type { SchedulerManager, SchedulerManagerInspection } from "./manager.js";
import {
  SCHEDULER_SCHEMA_VERSION,
  canonicalJson,
  type SchedulerBackend,
  type SchedulerDefinitionMetadata,
  type SchedulerExpectation,
  type SchedulerReasonCode,
} from "./model.js";

export interface SchedulerInstallationRecord {
  schema_version: typeof SCHEDULER_SCHEMA_VERSION;
  scheduler_id: string;
  org_id: string;
  org_name: string;
  backend: SchedulerBackend;
  cadence_minutes: number;
  executable_path: string;
  package_entry_path: string;
  org_home: string;
  state_home: string;
  definition_path: string;
  rendered_definition_hash: string;
  installed_at: string;
}

interface SchedulerLifecycleTransaction {
  schema_version: 1;
  operation: "install" | "uninstall";
  scheduler_id: string;
  org_id: string;
  definition_hash: string;
  stage: "prepared" | "definition_written" | "manager_updated" | "committed";
  started_at: string;
  updated_at: string;
}

export interface SchedulerLifecycleOptions extends SchedulerDefinitionInput {
  manager: SchedulerManager;
  execute?: boolean;
  confirm?: string;
  now?: () => Date;
  fault?: (boundary: SchedulerLifecycleBoundary) => void | Promise<void>;
}

export type SchedulerLifecycleBoundary =
  | "after_transaction"
  | "after_definition_write"
  | "after_manager_update"
  | "after_record_write"
  | "after_definition_remove";

export interface SchedulerLifecycleResult {
  schema_version: 1;
  operation: "install" | "uninstall";
  mode: "preview" | "execute";
  action: "install" | "repair" | "uninstall" | "noop" | "refuse";
  changed: boolean;
  writes_planned: boolean;
  scheduler_id: string;
  org_id: string;
  org_name: string;
  backend: SchedulerBackend;
  supported: boolean;
  confirmation: string;
  definition_path: string;
  state_path: string;
  expected_definition_hash: string;
  observed_definition_hash: string | null;
  reason_codes: SchedulerReasonCode[];
  detail: string;
}

export interface SchedulerDefinitionStatus {
  schema_version: 1;
  scheduler_id: string;
  org_id: string;
  org_name: string;
  backend: SchedulerBackend;
  supported: boolean;
  definition_path: string;
  state_path: string;
  installed: boolean;
  loaded: boolean | null;
  active: boolean | null;
  definition_valid: boolean;
  installation_state_valid: boolean;
  expected_definition_hash: string;
  observed_definition_hash: string | null;
  configured_cadence_minutes: number;
  observed_cadence_minutes: number | null;
  executable_path: string;
  org_home: string;
  state_home: string;
  reason_codes: SchedulerReasonCode[];
  detail: string[];
}

export async function installScheduler(options: SchedulerLifecycleOptions): Promise<SchedulerLifecycleResult> {
  const expected = buildSchedulerExpectation(options);
  const now = options.now ?? (() => new Date());
  const observed = await options.manager.readDefinition(expected.metadata.scheduler_id);
  const assessment = assessObserved(expected, observed);
  const statePath = schedulerInstallationPath(expected.metadata.state_home);
  const state = await readInstallationState(statePath);
  const transactionState = await readLifecycleTransaction(expected.metadata.state_home);
  const transactionAssessment = assessTransaction(expected, transactionState);
  const combinedAssessment = {
    ...assessment,
    refuse: assessment.refuse || transactionAssessment.refuse,
    reasons: [...new Set([...assessment.reasons, ...transactionAssessment.reasons])],
  };
  const inspection = await safeInspect(options.manager, expected.metadata.scheduler_id, true);
  const unsupported = !options.manager.supported;
  const refuse = combinedAssessment.refuse || unsupported;
  const same = assessment.valid && assessment.hash === expected.definitionHash;
  const stateConverged = state.kind === "valid"
    && state.value.scheduler_id === expected.metadata.scheduler_id
    && state.value.org_id === expected.metadata.org_id
    && state.value.rendered_definition_hash === expected.definitionHash;
  const action: SchedulerLifecycleResult["action"] = refuse
    ? "refuse"
    : same && stateConverged && inspection.active === true && transactionState.kind === "missing"
      ? "noop"
      : observed === undefined ? "install" : "repair";
  const result = lifecycleResult("install", options, expected, action, combinedAssessment, statePath);
  if (options.execute !== true || action === "noop" || action === "refuse") return result;
  assertConfirmation(options.confirm, expected);

  const transaction: SchedulerLifecycleTransaction = {
    schema_version: 1,
    operation: "install",
    scheduler_id: expected.metadata.scheduler_id,
    org_id: expected.metadata.org_id,
    definition_hash: expected.definitionHash,
    stage: "prepared",
    started_at: now().toISOString(),
    updated_at: now().toISOString(),
  };
  await writeTransaction(expected.metadata.state_home, transaction);
  await options.fault?.("after_transaction");
  await mkdir(join(expected.metadata.state_home, "scheduler", "logs"), { recursive: true });
  await options.manager.writeDefinition(expected.metadata.scheduler_id, expected.definition);
  await advanceTransaction(expected.metadata.state_home, transaction, "definition_written", now());
  await options.fault?.("after_definition_write");
  // A manager can keep the old in-memory job after its definition file is
  // atomically replaced. Repair therefore performs an explicit unload/reload;
  // treating an "already loaded" response as convergence would leave cadence
  // or command drift active until logout/reboot while status read the new file.
  if (action === "repair" && inspection.installed) {
    await options.manager.disable(expected.metadata.scheduler_id);
  }
  await options.manager.enable(expected.metadata.scheduler_id);
  await advanceTransaction(expected.metadata.state_home, transaction, "manager_updated", now());
  await options.fault?.("after_manager_update");
  await writeInstallationRecord(options.manager, expected, now());
  await options.fault?.("after_record_write");
  await advanceTransaction(expected.metadata.state_home, transaction, "committed", now());
  await rm(schedulerTransactionPath(expected.metadata.state_home), { force: true });
  return { ...result, changed: true };
}

export async function uninstallScheduler(options: SchedulerLifecycleOptions): Promise<SchedulerLifecycleResult> {
  const expected = buildSchedulerExpectation(options);
  const now = options.now ?? (() => new Date());
  const observed = await options.manager.readDefinition(expected.metadata.scheduler_id);
  const assessment = assessObserved(expected, observed);
  const statePath = schedulerInstallationPath(expected.metadata.state_home);
  const state = await readInstallationState(statePath);
  const transactionState = await readLifecycleTransaction(expected.metadata.state_home);
  const transactionAssessment = assessTransaction(expected, transactionState);
  const stateReasons: SchedulerReasonCode[] = state.kind === "corrupt"
    ? ["scheduler_state_corrupt"]
    : state.kind === "valid" && (state.value.scheduler_id !== expected.metadata.scheduler_id || state.value.org_id !== expected.metadata.org_id)
      ? ["wrong_org"]
      : [];
  const stateUnsafe = stateReasons.length > 0;
  const combinedAssessment = {
    ...assessment,
    refuse: assessment.refuse || transactionAssessment.refuse || stateUnsafe,
    reasons: [...new Set([...assessment.reasons, ...transactionAssessment.reasons, ...stateReasons])],
  };
  const residualOwnedState = state.kind === "valid"
    && state.value.scheduler_id === expected.metadata.scheduler_id
    && state.value.org_id === expected.metadata.org_id;
  const residualOwnedTransaction = transactionState.kind === "valid" && !transactionAssessment.refuse;
  const action: SchedulerLifecycleResult["action"] = combinedAssessment.refuse || !options.manager.supported
      ? "refuse"
    : observed === undefined && !residualOwnedState && !residualOwnedTransaction
      ? "noop"
      : "uninstall";
  const result = lifecycleResult("uninstall", options, expected, action, combinedAssessment, statePath);
  if (options.execute !== true || action === "noop" || action === "refuse") return result;
  assertConfirmation(options.confirm, expected);
  const transaction: SchedulerLifecycleTransaction = {
    schema_version: 1,
    operation: "uninstall",
    scheduler_id: expected.metadata.scheduler_id,
    org_id: expected.metadata.org_id,
    definition_hash: expected.definitionHash,
    stage: "prepared",
    started_at: now().toISOString(),
    updated_at: now().toISOString(),
  };
  await writeTransaction(expected.metadata.state_home, transaction);
  await options.fault?.("after_transaction");
  await options.manager.disable(expected.metadata.scheduler_id);
  await advanceTransaction(expected.metadata.state_home, transaction, "manager_updated", now());
  await options.fault?.("after_manager_update");
  await options.manager.removeDefinition(expected.metadata.scheduler_id);
  await options.fault?.("after_definition_remove");
  await rm(statePath, { force: true });
  await rm(schedulerTransactionPath(expected.metadata.state_home), { force: true });
  return { ...result, changed: true };
}

export async function schedulerDefinitionStatus(input: SchedulerDefinitionInput & {
  manager: SchedulerManager;
  runtime?: boolean;
}): Promise<SchedulerDefinitionStatus> {
  const expected = buildSchedulerExpectation(input);
  const definition = await input.manager.readDefinition(expected.metadata.scheduler_id);
  const assessment = assessObserved(expected, definition);
  const inspection = await safeInspect(input.manager, expected.metadata.scheduler_id, input.runtime !== false);
  const statePath = schedulerInstallationPath(expected.metadata.state_home);
  const state = await readInstallationState(statePath);
  const reasons = new Set<SchedulerReasonCode>();
  const detail: string[] = [];
  if (!input.manager.supported) reasons.add(input.manager.backend === "systemd" ? "unsupported_backend" : "unsupported_platform");
  if (definition === undefined) reasons.add("not_installed");
  for (const reason of assessment.reasons) reasons.add(reason);
  if (inspection.installed && inspection.active === false) reasons.add("inactive");
  if (inspection.installed && inspection.active === null) reasons.add("measurement_unavailable");
  if (state.kind === "missing" && definition !== undefined) reasons.add("scheduler_state_missing");
  if (state.kind === "corrupt") reasons.add("scheduler_state_corrupt");
  if (state.kind === "valid") {
    if (state.value.scheduler_id !== expected.metadata.scheduler_id || state.value.org_id !== expected.metadata.org_id) reasons.add("wrong_org");
    if (state.value.rendered_definition_hash !== expected.definitionHash) reasons.add("stale_definition");
  }
  if (!existsSync(expected.metadata.executable_path) || !existsSync(expected.metadata.package_entry_path)) reasons.add("wrong_executable");
  if (assessment.valid && assessment.hash === expected.definitionHash) reasons.add("definition_valid");
  detail.push(inspection.detail);
  if (state.kind === "corrupt") detail.push(state.detail);
  return {
    schema_version: 1,
    scheduler_id: expected.metadata.scheduler_id,
    org_id: expected.metadata.org_id,
    org_name: expected.metadata.org_name,
    backend: expected.metadata.backend,
    supported: input.manager.supported,
    definition_path: input.manager.definitionPath(expected.metadata.scheduler_id),
    state_path: statePath,
    installed: inspection.installed,
    loaded: inspection.loaded,
    active: inspection.active,
    definition_valid: assessment.valid && assessment.hash === expected.definitionHash,
    installation_state_valid: state.kind === "valid",
    expected_definition_hash: expected.definitionHash,
    observed_definition_hash: assessment.hash,
    configured_cadence_minutes: expected.metadata.cadence_minutes,
    observed_cadence_minutes: assessment.metadata?.cadence_minutes ?? null,
    executable_path: expected.metadata.executable_path,
    org_home: expected.metadata.org_home,
    state_home: expected.metadata.state_home,
    reason_codes: [...reasons].sort(),
    detail,
  };
}

export function schedulerInstallationPath(stateHome: string): string {
  return join(resolve(stateHome), "scheduler", "installation.json");
}

export function schedulerTransactionPath(stateHome: string): string {
  return join(resolve(stateHome), "scheduler", "lifecycle-transaction.json");
}

function assessObserved(expected: SchedulerExpectation, definition: string | undefined): {
  valid: boolean;
  refuse: boolean;
  hash: string | null;
  metadata?: SchedulerDefinitionMetadata;
  reasons: SchedulerReasonCode[];
} {
  if (definition === undefined) return { valid: false, refuse: false, hash: null, reasons: ["not_installed"] };
  const parsed = parseSchedulerDefinition(definition);
  if (parsed.kind === "foreign") return { valid: false, refuse: true, hash: null, reasons: ["ownership_mismatch"] };
  if (parsed.kind === "malformed") return { valid: false, refuse: true, hash: null, reasons: ["malformed_definition"] };
  const reasons: SchedulerReasonCode[] = [];
  const actual = parsed.metadata;
  if (actual.scheduler_id !== expected.metadata.scheduler_id || actual.org_id !== expected.metadata.org_id) reasons.push("wrong_org");
  if (actual.state_home !== expected.metadata.state_home) reasons.push("wrong_state_home");
  if (actual.org_home !== expected.metadata.org_home) reasons.push("wrong_org");
  if (actual.executable_path !== expected.metadata.executable_path || actual.package_entry_path !== expected.metadata.package_entry_path) reasons.push("wrong_executable");
  if (actual.cadence_minutes !== expected.metadata.cadence_minutes) reasons.push("cadence_drift");
  if (parsed.definitionHash !== expected.definitionHash) reasons.push("stale_definition");
  const wrongOwner = reasons.includes("wrong_org");
  return {
    valid: reasons.length === 0,
    refuse: wrongOwner,
    hash: parsed.definitionHash,
    metadata: actual,
    reasons,
  };
}

function lifecycleResult(
  operation: "install" | "uninstall",
  options: SchedulerLifecycleOptions,
  expected: SchedulerExpectation,
  action: SchedulerLifecycleResult["action"],
  assessment: ReturnType<typeof assessObserved>,
  statePath: string,
): SchedulerLifecycleResult {
  const reasons = new Set(assessment.reasons);
  if (!options.manager.supported) reasons.add(options.manager.backend === "systemd" ? "unsupported_backend" : "unsupported_platform");
  return {
    schema_version: 1,
    operation,
    mode: options.execute === true ? "execute" : "preview",
    action,
    changed: false,
    writes_planned: action === "install" || action === "repair" || action === "uninstall",
    scheduler_id: expected.metadata.scheduler_id,
    org_id: expected.metadata.org_id,
    org_name: expected.metadata.org_name,
    backend: expected.metadata.backend,
    supported: options.manager.supported,
    confirmation: expected.metadata.scheduler_id,
    definition_path: options.manager.definitionPath(expected.metadata.scheduler_id),
    state_path: statePath,
    expected_definition_hash: expected.definitionHash,
    observed_definition_hash: assessment.hash,
    reason_codes: [...reasons].sort(),
    detail: action === "refuse"
      ? "existing definition cannot be proven safe for this exact org"
      : action === "noop"
        ? `${operation} is already converged`
        : `${action} is ${options.execute === true ? "authorized" : "preview only"}`,
  };
}

function assertConfirmation(value: string | undefined, expected: SchedulerExpectation): void {
  if (value !== expected.metadata.scheduler_id && value !== expected.metadata.org_name) {
    throw new Error(`scheduler: --confirm must exactly equal ${expected.metadata.scheduler_id} or ${expected.metadata.org_name}`);
  }
}

async function writeInstallationRecord(manager: SchedulerManager, expected: SchedulerExpectation, at: Date): Promise<void> {
  const path = schedulerInstallationPath(expected.metadata.state_home);
  const record: SchedulerInstallationRecord = {
    schema_version: 1,
    scheduler_id: expected.metadata.scheduler_id,
    org_id: expected.metadata.org_id,
    org_name: expected.metadata.org_name,
    backend: expected.metadata.backend,
    cadence_minutes: expected.metadata.cadence_minutes,
    executable_path: expected.metadata.executable_path,
    package_entry_path: expected.metadata.package_entry_path,
    org_home: expected.metadata.org_home,
    state_home: expected.metadata.state_home,
    definition_path: manager.definitionPath(expected.metadata.scheduler_id),
    rendered_definition_hash: expected.definitionHash,
    installed_at: at.toISOString(),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, canonicalJson(record));
}

async function writeTransaction(stateHome: string, value: SchedulerLifecycleTransaction): Promise<void> {
  const path = schedulerTransactionPath(stateHome);
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, canonicalJson(value));
}

async function advanceTransaction(
  stateHome: string,
  value: SchedulerLifecycleTransaction,
  stage: SchedulerLifecycleTransaction["stage"],
  at: Date,
): Promise<void> {
  value.stage = stage;
  value.updated_at = at.toISOString();
  await writeTransaction(stateHome, value);
}

async function safeInspect(manager: SchedulerManager, schedulerId: string, runtime: boolean): Promise<SchedulerManagerInspection> {
  try {
    return await manager.inspect(schedulerId, { runtime });
  } catch (error) {
    return {
      installed: existsSync(manager.definitionPath(schedulerId)),
      loaded: null,
      active: null,
      detail: `host manager inspection failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function readInstallationState(path: string): Promise<
  | { kind: "missing" }
  | { kind: "corrupt"; detail: string }
  | { kind: "valid"; value: SchedulerInstallationRecord }
> {
  if (!existsSync(path)) return { kind: "missing" };
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as SchedulerInstallationRecord;
    if (value.schema_version !== 1 || value.scheduler_id === undefined || value.rendered_definition_hash === undefined) {
      throw new Error("installation schema mismatch");
    }
    return { kind: "valid", value };
  } catch (error) {
    return { kind: "corrupt", detail: error instanceof Error ? error.message : String(error) };
  }
}

async function readLifecycleTransaction(stateHome: string): Promise<
  | { kind: "missing" }
  | { kind: "corrupt"; detail: string }
  | { kind: "valid"; value: SchedulerLifecycleTransaction }
> {
  const path = schedulerTransactionPath(stateHome);
  if (!existsSync(path)) return { kind: "missing" };
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as SchedulerLifecycleTransaction;
    if (value.schema_version !== 1
      || !["install", "uninstall"].includes(value.operation)
      || typeof value.scheduler_id !== "string"
      || typeof value.org_id !== "string"
      || typeof value.definition_hash !== "string"
      || !["prepared", "definition_written", "manager_updated", "committed"].includes(value.stage)) {
      throw new Error("lifecycle transaction schema mismatch");
    }
    return { kind: "valid", value };
  } catch (error) {
    return { kind: "corrupt", detail: error instanceof Error ? error.message : String(error) };
  }
}

function assessTransaction(
  expected: SchedulerExpectation,
  transaction: Awaited<ReturnType<typeof readLifecycleTransaction>>,
): { refuse: boolean; reasons: SchedulerReasonCode[] } {
  if (transaction.kind === "missing") return { refuse: false, reasons: [] };
  if (transaction.kind === "corrupt") return { refuse: true, reasons: ["scheduler_state_corrupt"] };
  if (transaction.value.scheduler_id !== expected.metadata.scheduler_id || transaction.value.org_id !== expected.metadata.org_id) {
    return { refuse: true, reasons: ["wrong_org"] };
  }
  if (transaction.value.definition_hash !== expected.definitionHash) {
    return { refuse: true, reasons: ["stale_definition"] };
  }
  return { refuse: false, reasons: [] };
}
