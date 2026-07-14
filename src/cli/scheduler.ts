import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { resolveOperonHomes, type OperonHomeOptions } from "../org/home.js";
import { buildSchedulerExpectation } from "../org/scheduler/definition.js";
import { installScheduler, uninstallScheduler, type SchedulerLifecycleResult } from "../org/scheduler/lifecycle.js";
import { PlatformSchedulerManager, type SchedulerManager } from "../org/scheduler/manager.js";
import { DEFAULT_SCHEDULER_CADENCE_MINUTES, type SchedulerBackend } from "../org/scheduler/model.js";
import { schedulerOperationalStatus, type SchedulerOperationalStatus } from "../org/scheduler/status.js";
import { extractHomeFlags } from "./home-flags.js";

export interface SchedulerCommandOptions extends OperonHomeOptions {
  manager?: SchedulerManager;
  platform?: NodeJS.Platform;
  packageEntryPath?: string;
  executablePath?: string;
  now?: () => Date;
}

export async function cmdScheduler(args: string[]): Promise<number> {
  return runSchedulerCommand(args);
}

export async function runSchedulerCommand(args: string[], options: SchedulerCommandOptions = {}): Promise<number> {
  const common = extractHomeFlags(args, "scheduler");
  const [verb, ...rest] = common.rest;
  if (!verb || !["install", "status", "uninstall"].includes(verb)) {
    throw new Error("scheduler: expected install, status, or uninstall");
  }
  let backend: SchedulerBackend | undefined;
  let execute = false;
  let confirm: string | undefined;
  let json = false;
  let cadenceMinutes = DEFAULT_SCHEDULER_CADENCE_MINUTES;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--backend") {
      const value = rest[++i];
      if (value !== "launchd" && value !== "systemd") throw new Error("scheduler: --backend must be launchd or systemd");
      backend = value;
    } else if (arg === "--execute") execute = true;
    else if (arg === "--confirm") confirm = needValue(rest, ++i, "--confirm");
    else if (arg === "--json") json = true;
    else if (arg === "--cadence-minutes") cadenceMinutes = Number(needValue(rest, ++i, "--cadence-minutes"));
    else throw new Error(`scheduler: unknown argument "${arg}"`);
  }
  if (verb === "status" && (execute || confirm !== undefined)) throw new Error("scheduler status is read-only and does not accept --execute or --confirm");
  const platform = options.platform ?? process.platform;
  const selected = backend ?? (platform === "darwin" ? "launchd" : "systemd");
  const homes = await resolveOperonHomes({ ...common, ...options });
  const manager = options.manager ?? new PlatformSchedulerManager({ backend: selected, platform });
  if (manager.backend !== selected) throw new Error(`scheduler manager backend mismatch: expected ${selected}, got ${manager.backend}`);
  const input = {
    backend: selected,
    orgName: homes.appsFile.org.name,
    orgHome: homes.orgHome,
    stateHome: homes.stateHome,
    packageEntryPath: resolve(options.packageEntryPath ?? packageEntry(homes.packageRoot)),
    executablePath: resolve(options.executablePath ?? process.execPath),
    cadenceMinutes,
    manager,
  };

  if (verb === "status") {
    const result = await schedulerOperationalStatus({ ...input, now: options.now?.() ?? new Date() });
    printStatus(result, json);
    return result.healthy ? 0 : 1;
  }
  const result = verb === "install"
    ? await installScheduler({ ...input, execute, ...(confirm !== undefined ? { confirm } : {}), ...(options.now !== undefined ? { now: options.now } : {}) })
    : await uninstallScheduler({ ...input, execute, ...(confirm !== undefined ? { confirm } : {}), ...(options.now !== undefined ? { now: options.now } : {}) });
  printLifecycle(result, json);
  return result.action === "refuse" ? 1 : 0;
}

export function schedulerExpectationForCli(input: Parameters<typeof buildSchedulerExpectation>[0]) {
  return buildSchedulerExpectation(input);
}

function printLifecycle(result: SchedulerLifecycleResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Scheduler ${result.operation} (${result.mode}): ${result.action}`);
  console.log(`  identity:   ${result.scheduler_id}`);
  console.log(`  org:        ${result.org_name} (${result.org_id})`);
  console.log(`  backend:    ${result.backend} (${result.supported ? "supported" : "unsupported"})`);
  console.log(`  definition: ${result.definition_path}`);
  console.log(`  state:      ${result.state_path}`);
  console.log(`  hash:       ${result.expected_definition_hash}`);
  console.log(`  reasons:    ${result.reason_codes.join(", ") || "none"}`);
  if (result.mode === "preview" && result.writes_planned) {
    console.log(`  execute:    --execute --confirm ${result.confirmation}`);
  }
}

function printStatus(result: SchedulerOperationalStatus, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const d = result.definition;
  const e = result.evidence;
  console.log(`Scheduler ${d.scheduler_id}: ${result.healthy ? "healthy" : "attention required"}`);
  console.log(`  backend/install: ${d.backend}; installed=${d.installed}; loaded=${String(d.loaded)}; active=${String(d.active)}`);
  console.log(`  definition:      valid=${d.definition_valid}; expected=${d.expected_definition_hash}; observed=${d.observed_definition_hash ?? "missing"}`);
  console.log(`  cadence:         ${d.configured_cadence_minutes}m; last=${e.last_completed_tick ?? "unmeasured"}; next=${e.next_expected_tick ?? "unmeasured"}; overdue=${String(e.overdue)}`);
  console.log(`  decisions:       due=${e.counts.due}; executed=${e.counts.executed}; skipped=${e.counts.skipped}; blocked=${e.counts.blocked}; missed=${e.counts.missed}; reconciled=${e.counts.reconciled}`);
  console.log(`  integrity:       duplicate decisions=${e.duplicate_decisions}; duplicate episodes=${e.duplicate_episodes}; orphan locks/journals/runs/settlements=${e.orphaned_locks}/${e.orphaned_journals}/${e.orphaned_runs}/${e.orphaned_settlements}`);
  console.log(`  settlement:      turns=${e.provider_turns ?? "invalid"}; settlements=${e.provider_settlements ?? "invalid"}; agreement=${String(e.provider_settlement_agreement)}`);
  console.log(`  reasons:         ${result.reason_codes.join(", ") || "none"}`);
  console.log(`  alerts:          ${result.local_alerts_requiring_attention}`);
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`scheduler: ${flag} requires a value`);
  return value;
}

function packageEntry(packageRoot: string): string {
  const built = resolve(packageRoot, "dist", "cli.js");
  return existsSync(built) ? built : resolve(packageRoot, "src", "cli.ts");
}
