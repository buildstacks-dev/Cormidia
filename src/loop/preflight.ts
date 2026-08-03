// Token-free environment preflight (proportionality campaign Stage 3, P6).
// Three environment failures in the 2026-07-10 episode were each discovered
// INSIDE a multi-dollar model turn: registry access blocked by the offline
// sandbox, pnpm refusing a non-TTY install, and missing network grants after
// a requeue. Deterministic probes answer the same questions for $0 before
// the first provider turn of a pipeline starts.
//
// Pure subprocess + fs checks — loop layer, no org imports, no model calls.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hasRuntimeCapability,
  runtimeCapabilityProfile,
  type RuntimeCapability,
  type RuntimeCapabilityProfile,
} from "../runtime/capabilities.js";
import { validateTurnAssignment } from "../runtime/assignment.js";
import type { RoleConfig, RuntimeKind } from "../runtime/types.js";
import {
  ROUTE_BUDGETS,
  type AuthorizedPass,
  type EfficiencyRoute,
  type RouteBudget,
} from "./efficiency.js";
import type { PassConfig } from "./pipelines.js";
import type { GateCommands } from "./qgates.js";

export interface PreflightOptions {
  /** Whether this tick carries an explicit network grant (--allow-network). */
  networkAccess?: boolean;
  /** Registry probe timeout; the probe only runs when network is granted. */
  probeTimeoutMs?: number;
}

export interface PreflightResult {
  ok: boolean;
  problems: string[];
}

export interface PipelineArtifactExpectation {
  path: string;
  sha256: string;
  reason: string;
}

export interface PipelinePreflightInput {
  workdir: string;
  route: EfficiencyRoute;
  selectedPasses: PassConfig[];
  roles: Record<string, RoleConfig>;
  budgetOverrides?: Partial<RouteBudget>;
  requiredCapabilities?: RuntimeCapability[];
  capabilityProfiles?: Partial<Record<RuntimeKind, RuntimeCapabilityProfile>>;
  artifacts?: PipelineArtifactExpectation[];
  /** A ratified mechanical pipeline may legitimately select no provider
   * passes; its orchestrator-owned work still proceeds through gates. */
  allowNoProviderTurns?: boolean;
  authorizedPasses?: AuthorizedPass[];
}

export interface PipelinePreflightResult extends PreflightResult {
  checkedPasses: string[];
  checkedArtifacts: string[];
}

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/** Cheap deterministic probes in the ticket worktree. A failure names the
 *  exact problem and the fix — evidence for the returned-ticket comment. */
export async function runEnvPreflight(
  worktree: string,
  commands: GateCommands,
  options: PreflightOptions = {},
): Promise<PreflightResult> {
  const problems: string[] = [];

  // 1. Every configured gate command's executable must resolve.
  for (const [key, command] of Object.entries(commands)) {
    if (typeof command !== "string" || command.trim() === "") continue;
    const binary = commandBinary(command);
    if (binary === undefined) continue;
    if (!binaryResolves(worktree, binary)) {
      problems.push(
        `${key}: "${binary}" is not on PATH in the worktree — the ${key.replace(/Command$/, "")} ` +
          `gate would fail before any work ran`,
      );
    }
  }

  // 2. The offline-install trap: a setup command that must install into an
  //    empty worktree cannot succeed without a network grant. This exact
  //    combination cost a full Builder pass to diagnose in the episode.
  if (
    commands.setupCommand !== undefined &&
    options.networkAccess !== true &&
    looksLikeInstall(commands.setupCommand) &&
    !existsSync(join(worktree, "node_modules"))
  ) {
    problems.push(
      `setup ("${commands.setupCommand}") must install dependencies into a worktree with no ` +
        `node_modules, but the runtime sandbox is offline — grant network for this ticket ` +
        `(cormidia loop --allow-network) or pre-populate the store`,
    );
  }

  // 3. With network granted and an install pending, prove the registry is
  //    actually reachable from this host before a model turn discovers it.
  if (
    commands.setupCommand !== undefined &&
    options.networkAccess === true &&
    looksLikeInstall(commands.setupCommand)
  ) {
    const reachable = await registryReachable(options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
    if (!reachable) {
      problems.push(
        "registry.npmjs.org is unreachable from this host — the granted network access cannot " +
          "satisfy the setup install right now",
      );
    }
  }

  return { ok: problems.length === 0, problems };
}

/** Provider-free admission validation shared by every pipeline caller. It
 * rejects malformed pass/role configuration, missing declared adapter
 * capabilities, impossible route budgets, and stale continuation artifacts
 * before runtimeFor can be invoked. */
export function runPipelinePreflight(input: PipelinePreflightInput): PipelinePreflightResult {
  const problems: string[] = [];
  const checkedPasses: string[] = [];
  const checkedArtifacts: string[] = [];
  if (input.selectedPasses.length === 0 && input.allowNoProviderTurns !== true) {
    problems.push("selected pass set is empty");
  }

  const budget = { ...ROUTE_BUDGETS[input.route], ...(input.budgetOverrides ?? {}) };
  for (const [name, value] of [
    ["provider_turns", budget.provider_turns],
    ["equivalent_cost_usd", budget.equivalent_cost_usd],
    ["active_time_ms", budget.active_time_ms],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) problems.push(`route budget ${name} is invalid`);
  }
  if (budget.provider_turns < input.selectedPasses.length) {
    problems.push(
      `route budget allows ${budget.provider_turns} provider turn(s), but ${input.selectedPasses.length} selected passes require at least one each`,
    );
  }

  for (const pass of input.selectedPasses) {
    checkedPasses.push(pass.id);
    const role = input.roles[pass.role];
    if (role === undefined) {
      problems.push(`pass ${pass.id} references missing role ${pass.role}`);
      continue;
    }
    if (!Number.isFinite(role.maxTurnBudgetUsd) || role.maxTurnBudgetUsd <= 0) {
      problems.push(`role ${role.name} has an invalid maxTurnBudgetUsd`);
    }
    let assignment;
    try {
      assignment = validateTurnAssignment({
        harness: role.runtime,
        model: role.model,
        effort: role.effort,
      }, `pass ${pass.id} assignment`);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (input.authorizedPasses !== undefined) {
      const matches = input.authorizedPasses.filter(
        (candidate) => candidate.pass === pass.id,
      );
      if (matches.length !== 1) {
        problems.push(
          `pass ${pass.id} requires exactly one pre-execution route authorization; found ${matches.length}`,
        );
      } else if (matches[0]!.role !== role.name || matches[0]!.factor_rules.length === 0) {
        problems.push(`pass ${pass.id} has invalid route-selected role/model/effort evidence`);
      } else {
        try {
          assignment = validateTurnAssignment({
            harness: matches[0]!.runtime,
            model: matches[0]!.model,
            effort: matches[0]!.effort,
          }, `pass ${pass.id} route-authorized assignment`);
        } catch (error) {
          problems.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
    const profile =
      input.capabilityProfiles?.[assignment.harness] ??
      runtimeCapabilityProfile(assignment.harness);
    if (profile.runtime !== assignment.harness) {
      problems.push(
        `capability profile ${profile.runtime} does not match assigned harness ${assignment.harness}`,
      );
      continue;
    }
    for (const capability of input.requiredCapabilities ?? []) {
      if (!hasRuntimeCapability(profile, capability)) {
        problems.push(`${assignment.harness}/${role.name} lacks required capability ${capability}`);
      }
    }
  }

  for (const artifact of [...(input.artifacts ?? [])].sort((a, b) => a.path.localeCompare(b.path))) {
    checkedArtifacts.push(artifact.path);
    const path = join(input.workdir, artifact.path);
    if (!existsSync(path)) {
      problems.push(`stale artifact ${artifact.path}: missing (${artifact.reason})`);
      continue;
    }
    const observed = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (observed !== artifact.sha256.replace(/^sha256:/, "")) {
      problems.push(`stale artifact ${artifact.path}: content hash changed (${artifact.reason})`);
    }
  }

  return { ok: problems.length === 0, problems, checkedPasses, checkedArtifacts };
}

/** First real token of a shell command, skipping VAR=value prefixes. */
export function commandBinary(command: string): string | undefined {
  for (const token of command.trim().split(/\s+/)) {
    if (token === "" || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    return token;
  }
  return undefined;
}

function binaryResolves(cwd: string, binary: string): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${shellQuote(binary)}`], {
      cwd,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function looksLikeInstall(command: string): boolean {
  return /\binstall\b|\bci\b/.test(command);
}

async function registryReachable(timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch("https://registry.npmjs.org/-/ping", {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
