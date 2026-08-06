// Token-free environment preflight (proportionality campaign Stage 3, P6).
// Three environment failures in the 2026-07-10 episode were each discovered
// INSIDE a multi-dollar model turn: registry access blocked by the offline
// sandbox, pnpm refusing a non-TTY install, and missing network grants after
// a requeue. Deterministic probes answer the same questions for $0 before
// the first provider turn of a pipeline starts.
//
// Pure subprocess + fs checks — loop layer, no org imports, no model calls.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateTurnAssignment } from "../runtime/assignment.js";
import {
  hasRuntimeCapability,
  runtimeCapabilityProfile,
  type RuntimeCapability,
  type RuntimeCapabilityProfile,
} from "../runtime/capabilities.js";
import type { RoleConfig, RuntimeKind } from "../runtime/types.js";
import { ROUTE_BUDGETS, type AuthorizedPass, type EfficiencyRoute, type RouteBudget } from "./efficiency.js";
import type { PassConfig } from "./pipelines.js";

interface PreflightResult {
  ok: boolean;
  problems: string[];
}

export interface PipelineArtifactExpectation {
  path: string;
  sha256: string;
  reason: string;
}

interface PipelinePreflightInput {
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

interface PipelinePreflightResult extends PreflightResult {
  checkedPasses: string[];
  checkedArtifacts: string[];
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
      assignment = validateTurnAssignment(
        {
          harness: role.runtime,
          model: role.model,
          effort: role.effort,
        },
        `pass ${pass.id} assignment`,
      );
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (input.authorizedPasses !== undefined) {
      const matches = input.authorizedPasses.filter((candidate) => candidate.pass === pass.id);
      if (matches.length !== 1) {
        problems.push(
          `pass ${pass.id} requires exactly one pre-execution route authorization; found ${matches.length}`,
        );
      } else if (matches[0]!.role !== role.name || matches[0]!.factor_rules.length === 0) {
        problems.push(`pass ${pass.id} has invalid route-selected role/model/effort evidence`);
      } else {
        try {
          assignment = validateTurnAssignment(
            {
              harness: matches[0]!.runtime,
              model: matches[0]!.model,
              effort: matches[0]!.effort,
            },
            `pass ${pass.id} route-authorized assignment`,
          );
        } catch (error) {
          problems.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
    const profile = input.capabilityProfiles?.[assignment.harness] ?? runtimeCapabilityProfile(assignment.harness);
    if (profile.runtime !== assignment.harness) {
      problems.push(`capability profile ${profile.runtime} does not match assigned harness ${assignment.harness}`);
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
