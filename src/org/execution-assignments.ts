import {
  CONFIGURED_ASSIGNMENT_CANDIDATE_ID,
  fixedAssignmentFromRole,
} from "../runtime/assignment.js";
import type { RoleConfig, TurnAssignment } from "../runtime/types.js";
import {
  normalizeAppExecution,
  type AppAssignmentMode,
  type AppEntry,
} from "./apps.js";
import {
  resolveApprovedAssignmentCandidates,
  resolveApprovedTurnAssignments,
  type ApprovedAssignmentCandidate,
  type ApprovedTurnAssignment,
} from "./roles.js";

export interface ResolvedRoleAssignments {
  role: string;
  candidates: ApprovedAssignmentCandidate[];
  assignments: ApprovedTurnAssignment[];
}

/**
 * The complete assignment policy handed to EpisodePlanner construction.
 * `plannerBootAssignment` is deliberately outside the adaptive role catalog:
 * it is always the Planner role's configured tuple and cannot be selected by
 * the plan that it is used to produce.
 */
export interface ResolvedAppAssignments {
  mode: AppAssignmentMode;
  plannerBootAssignment: TurnAssignment;
  roles: ResolvedRoleAssignments[];
}

/**
 * Join app-owned narrowing with org-owned role candidates. This is the
 * authority boundary: app config may remove candidate IDs, but an unknown ID
 * can never create a new tuple. The loader intentionally performs this join
 * before intent construction, plan validation, readiness probing, or runtime
 * construction.
 */
export function resolveAppAssignments(
  app: Pick<AppEntry, "name" | "execution">,
  roles: readonly RoleConfig[],
): ResolvedAppAssignments {
  const execution = normalizeAppExecution(app.execution, `app "${app.name}": execution`);
  const roleByName = new Map(roles.map((role) => [role.name, role]));
  if (roleByName.size !== roles.length) {
    throw new Error(`app "${app.name}": role configuration contains duplicate role names`);
  }

  const narrowedRoles = Object.keys(execution.allowedAssignments).sort();
  const unknownRoles = narrowedRoles.filter((role) => !roleByName.has(role));
  if (unknownRoles.length > 0) {
    throw new Error(
      `app "${app.name}": execution.allowed_assignments references unknown role(s): ` +
        unknownRoles.join(", "),
    );
  }

  // Validate every explicitly declared narrowing even in fixed mode. Keeping
  // an invalid dormant catalog would make a later mode-only config edit widen
  // authority or fail far away from the edited surface.
  for (const roleName of narrowedRoles) {
    resolveApprovedAssignmentCandidates(
      roleByName.get(roleName)!,
      execution.allowedAssignments[roleName],
    );
  }

  const planner = roleByName.get("planner");
  if (planner === undefined) {
    throw new Error(`app "${app.name}": roles configuration has no planner boot role`);
  }

  const resolvedRoles = [...roles]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((role): ResolvedRoleAssignments => {
      const allowedIds = execution.allowedAssignments[role.name];
      const effectiveIds =
        execution.assignmentMode === "fixed"
          ? [CONFIGURED_ASSIGNMENT_CANDIDATE_ID]
          : allowedIds;
      return {
        role: role.name,
        candidates: resolveApprovedAssignmentCandidates(role, effectiveIds),
        assignments: resolveApprovedTurnAssignments(role, effectiveIds),
      };
    });

  return {
    mode: execution.assignmentMode,
    plannerBootAssignment: fixedAssignmentFromRole(planner),
    roles: resolvedRoles,
  };
}

export function assignmentsForRole(
  resolved: ResolvedAppAssignments,
  role: string,
): ApprovedTurnAssignment[] {
  const found = resolved.roles.find((entry) => entry.role === role);
  if (found === undefined) throw new Error(`assignment policy has no role "${role}"`);
  return found.assignments.map((entry) => ({
    ...entry,
    assignment: { ...entry.assignment },
    pricing:
      entry.pricing.kind === "catalog_ref"
        ? { ...entry.pricing }
        : { ...entry.pricing },
  }));
}
