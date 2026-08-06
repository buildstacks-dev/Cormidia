import {
  probeRuntimeReadiness,
  type RuntimeReadinessProbe,
  type RuntimeReadinessResult,
} from "../../runtime/readiness.js";
import { turnAssignmentKey } from "../../runtime/assignment.js";
import type { RoleConfig, TurnAssignment } from "../../runtime/types.js";
import type { AppEntry } from "../apps.js";
import { resolveAppAssignments } from "../execution-assignments.js";

export interface AssignmentReadinessSnapshot {
  /** One result per distinct harness/model pair, sorted by identity. */
  results: RuntimeReadinessResult[];
  available(input: { role: RoleConfig; candidateId: string; assignment: TurnAssignment }): boolean;
  resultFor(assignment: TurnAssignment): RuntimeReadinessResult | undefined;
}

export interface ProbeAssignmentReadinessOptions {
  app: Pick<AppEntry, "name" | "execution">;
  roles: readonly RoleConfig[];
  /** Existing non-billable adapter readiness boundary. */
  probe?: RuntimeReadinessProbe;
  timeoutMs?: number;
}

/**
 * Resolve temporal readiness independently of assignment authority.
 *
 * The app/role join decides which exact tuples are approved. This function
 * only narrows those tuples using the existing non-billable adapter probe; a
 * failed or crashing probe is unavailable, never permission to substitute.
 * Effort does not affect adapter launch/auth/model resolution, so identical
 * harness/model pairs are probed once and every approved effort shares that
 * result.
 */
export async function probeApprovedAssignmentReadiness(
  options: ProbeAssignmentReadinessOptions,
): Promise<AssignmentReadinessSnapshot> {
  const resolved = resolveAppAssignments(options.app, options.roles);
  const probe = options.probe ?? probeRuntimeReadiness;
  const pairs = new Map<string, TurnAssignment>();
  // The fixed boot tuple is deliberately outside adaptive selection and may
  // be absent from the Planner role's narrowed catalog.
  pairs.set(harnessModelKey(resolved.plannerBootAssignment), resolved.plannerBootAssignment);
  for (const role of resolved.roles) {
    for (const candidate of role.assignments) {
      const key = harnessModelKey(candidate.assignment);
      if (!pairs.has(key)) pairs.set(key, candidate.assignment);
    }
  }

  const entries = [...pairs.entries()].sort(([left], [right]) => left.localeCompare(right));
  const settled: Array<readonly [string, RuntimeReadinessResult]> = await Promise.all(
    entries.map(async ([key, assignment]): Promise<readonly [string, RuntimeReadinessResult]> => {
      try {
        const result = await probe({
          runtime: assignment.harness,
          models: [assignment.model],
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        });
        return [key, result] as const;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const result: RuntimeReadinessResult = {
          runtime: assignment.harness,
          models: [assignment.model],
          status: "transport_unavailable",
          detail: `readiness probe crashed: ${detail}`,
          durationMs: 0,
          billable: false,
          errorCode: "error_adapter_readiness_probe_failed",
        };
        return [key, result] as const;
      }
    }),
  );
  const byPair = new Map(settled);

  return {
    results: settled.map(([, result]) => structuredClone(result)),
    available: ({ assignment }) => byPair.get(harnessModelKey(assignment))?.status === "ready",
    resultFor: (assignment) => {
      const result = byPair.get(harnessModelKey(assignment));
      return result === undefined ? undefined : structuredClone(result);
    },
  };
}

/** Probe one persisted exact tuple immediately before adapter construction. */
export async function probeSelectedAssignmentReadiness(input: {
  assignment: TurnAssignment;
  probe: RuntimeReadinessProbe;
  timeoutMs?: number;
}): Promise<RuntimeReadinessResult> {
  try {
    return await input.probe({
      runtime: input.assignment.harness,
      models: [input.assignment.model],
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      runtime: input.assignment.harness,
      models: [input.assignment.model],
      status: "transport_unavailable",
      detail: `readiness probe crashed: ${detail}`,
      durationMs: 0,
      billable: false,
      errorCode: "error_adapter_readiness_probe_failed",
    };
  }
}

function harnessModelKey(assignment: TurnAssignment): string {
  // Reuse strict tuple validation, then deliberately discard effort because
  // the readiness implementations inspect transport/auth/model resolution.
  const [harness, model] = JSON.parse(turnAssignmentKey(assignment)) as [string, string, string];
  return JSON.stringify([harness, model]);
}
