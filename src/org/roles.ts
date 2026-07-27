// roles.yaml loader + validation. The file is the org chart made executable —
// "Protocol over prompt-and-pray" (docs/PURPOSE.md non-negotiable #3).

import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import {
  CONFIGURED_ASSIGNMENT_CANDIDATE_ID,
  configuredProviderFamily,
  fixedAssignmentFromRole,
  turnAssignmentKey,
  validateAssignmentProviderFamily,
  validateAssignmentCandidateId,
  validateTurnAssignment,
} from "../runtime/assignment.js";
import type {
  AdaptiveAssignmentCandidate,
  AssignmentPricing,
  Effort,
  RoleConfig,
  TurnAssignment,
  Trigger,
} from "../runtime/types.js";
import { runtimeCapabilityProfile } from "../runtime/capabilities.js";

export interface RolesFile {
  defaults: { maxTurnBudgetUsd: number };
  roles: RoleConfig[];
  roleTurnBudgets: RoleTurnBudget[];
}

/** The effective hard cap plus the configuration provenance needed by
 * operator-facing summaries. Keep this separate from RoleConfig: runtimes
 * consume the resolved cap, while inheritance is a roles.yaml concern. */
export interface RoleTurnBudget {
  name: string;
  effectiveTurnBudgetUsd: number;
  turnBudgetInherited: boolean;
}

export interface ApprovedAssignmentCandidate {
  id: string;
  source: "configured" | "adaptive";
  harness: TurnAssignment["harness"];
  model: string;
  efforts: Effort[];
  providerFamily: string;
  capabilityRef?: string;
  qualificationRef?: string;
  pricing: AssignmentPricing;
  /** Conservative operational estimate used for plan arithmetic. A catalog
   * reference still falls back to the role's hard per-turn ceiling until an
   * org-owned price resolver supplies a narrower amount. */
  maxTurnCostUsd: number;
}

export interface ApprovedTurnAssignment {
  candidateId: string;
  assignment: TurnAssignment;
  providerFamily: string;
  capabilityRef?: string;
  qualificationRef?: string;
  pricing: AssignmentPricing;
  maxTurnCostUsd: number;
}

export async function loadRoles(path: string): Promise<RolesFile> {
  return parseRolesText(await readFile(path, "utf8"), path);
}

/**
 * Same validation as `loadRoles`, over text the caller already holds. A write
 * path must be able to prove a candidate roles.yaml parses to a valid org
 * chart BEFORE it replaces the ratified file on disk.
 */
export function parseRolesText(text: string, path: string): RolesFile {
  const raw = parse(text) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") throw new Error(`${path}: not a YAML mapping`);

  const defaultsRaw = (raw["defaults"] ?? {}) as Record<string, unknown>;
  const defaults = {
    maxTurnBudgetUsd: positiveNumberOr(
      defaultsRaw["max_turn_budget_usd"],
      5,
      `${path}: defaults.max_turn_budget_usd`,
    ),
  };

  const rolesRaw = raw["roles"];
  if (!rolesRaw || typeof rolesRaw !== "object") {
    throw new Error(`${path}: missing top-level "roles" mapping`);
  }

  const roles: RoleConfig[] = [];
  const roleTurnBudgets: RoleTurnBudget[] = [];
  for (const [name, specUnknown] of Object.entries(rolesRaw as Record<string, unknown>)) {
    const parsed = parseRole(name, specUnknown, defaults.maxTurnBudgetUsd, path);
    roles.push(parsed.role);
    roleTurnBudgets.push({
      name,
      effectiveTurnBudgetUsd: parsed.role.maxTurnBudgetUsd,
      turnBudgetInherited: parsed.turnBudgetInherited,
    });
  }
  if (roles.length === 0) throw new Error(`${path}: no roles defined`);
  return { defaults, roles, roleTurnBudgets };
}

function parseRole(
  name: string,
  specUnknown: unknown,
  defaultBudget: number,
  path: string,
): { role: RoleConfig; turnBudgetInherited: boolean } {
  const err = (msg: string) => new Error(`${path}: role "${name}": ${msg}`);
  if (!specUnknown || typeof specUnknown !== "object") throw err("not a mapping");
  const spec = specUnknown as Record<string, unknown>;
  const allowedFields = new Set([
    "runtime",
    "model",
    "effort",
    "adaptive_assignments",
    "delegation",
    "triggers",
    "outputs",
    "max_turn_budget_usd",
  ]);
  const unknownFields = Object.keys(spec).filter((key) => !allowedFields.has(key));
  if (unknownFields.length > 0) {
    throw err(`unknown field(s): ${unknownFields.sort().join(", ")}`);
  }

  const runtime = spec["runtime"];
  const model = spec["model"];
  const effort = spec["effort"];
  const fixedAssignment = validateTurnAssignment(
    { harness: runtime, model, effort },
    `${path}: role "${name}": configured assignment`,
  );

  const turnBudgetInherited = !Object.prototype.hasOwnProperty.call(
    spec,
    "max_turn_budget_usd",
  );
  const maxTurnBudgetUsd = positiveNumberOr(
    spec["max_turn_budget_usd"],
    defaultBudget,
    `${path}: role "${name}": max_turn_budget_usd`,
  );
  const adaptiveAssignments = parseAdaptiveAssignments(
    spec["adaptive_assignments"],
    fixedAssignment,
    maxTurnBudgetUsd,
    err,
  );

  const delegationRaw = (spec["delegation"] ?? {}) as Record<string, unknown>;
  const allow = Array.isArray(delegationRaw["allow"])
    ? (delegationRaw["allow"] as unknown[]).map(String)
    : [];

  const triggers: Trigger[] = [];
  if (Array.isArray(spec["triggers"])) {
    for (const t of spec["triggers"] as Record<string, unknown>[]) {
      const trigger: Trigger = {};
      if (typeof t["schedule"] === "string") trigger.schedule = t["schedule"];
      if (typeof t["event"] === "string") trigger.event = t["event"];
      if (t["manual"] === true) trigger.manual = true;
      if (!trigger.schedule && !trigger.event && !trigger.manual) {
        throw err("trigger needs schedule, event, or manual");
      }
      triggers.push(trigger);
    }
  }

  const outputs = Array.isArray(spec["outputs"])
    ? (spec["outputs"] as unknown[]).map(String)
    : [];

  return {
    role: {
      name,
      runtime: fixedAssignment.harness,
      model: fixedAssignment.model,
      effort: fixedAssignment.effort,
      ...(adaptiveAssignments === undefined ? {} : { adaptiveAssignments }),
      delegation: { allow },
      triggers,
      outputs,
      maxTurnBudgetUsd,
    },
    turnBudgetInherited,
  };
}

/**
 * Resolve the org-approved catalog for a role. The configured fixed tuple is
 * always present under the reserved id; adaptive entries only add choices.
 * Optional app ids can narrow this set but can never widen it.
 */
export function resolveApprovedAssignmentCandidates(
  role: RoleConfig,
  allowedCandidateIds?: readonly string[],
): ApprovedAssignmentCandidate[] {
  const fixed = fixedAssignmentFromRole(role);
  const candidates: ApprovedAssignmentCandidate[] = [
    {
      id: CONFIGURED_ASSIGNMENT_CANDIDATE_ID,
      source: "configured",
      harness: fixed.harness,
      model: fixed.model,
      efforts: [fixed.effort],
      providerFamily: configuredProviderFamily(fixed),
      capabilityRef: `${fixed.harness}/v1`,
      pricing: {
        kind: "conservative_estimate",
        maxTurnCostUsd: role.maxTurnBudgetUsd,
        sourceRef: "role.max_turn_budget_usd",
      },
      maxTurnCostUsd: role.maxTurnBudgetUsd,
    },
    ...(role.adaptiveAssignments ?? []).map((candidate) => ({
      id: candidate.id,
      source: "adaptive" as const,
      harness: candidate.harness,
      model: candidate.model,
      efforts: [...candidate.efforts],
      providerFamily: validateAssignmentProviderFamily(
        validateTurnAssignment({
          harness: candidate.harness,
          model: candidate.model,
          effort: candidate.efforts[0],
        }),
        candidate.providerFamily,
        `role ${JSON.stringify(role.name)} adaptive candidate ${JSON.stringify(candidate.id)}.provider_family`,
      ),
      capabilityRef: candidate.capabilityRef,
      qualificationRef: candidate.qualificationRef,
      pricing: clonePricing(candidate.pricing),
      maxTurnCostUsd:
        candidate.pricing.kind === "conservative_estimate"
          ? candidate.pricing.maxTurnCostUsd
          : role.maxTurnBudgetUsd,
    })),
  ];

  if (allowedCandidateIds === undefined) return candidates;
  if (allowedCandidateIds.length === 0) {
    throw new Error(`role "${role.name}": app assignment narrowing leaves no approved candidates`);
  }

  const allowed = new Set<string>();
  for (const rawId of allowedCandidateIds) {
    const id = validateAssignmentCandidateId(
      rawId,
      `role "${role.name}": allowed assignment candidate id`,
    );
    if (allowed.has(id)) {
      throw new Error(`role "${role.name}": duplicate allowed assignment candidate id "${id}"`);
    }
    allowed.add(id);
  }

  const known = new Set(candidates.map((candidate) => candidate.id));
  const unknown = [...allowed].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `role "${role.name}": app assignment narrowing references unknown candidate(s): ${unknown.sort().join(", ")}`,
    );
  }

  const narrowed = candidates.filter((candidate) => allowed.has(candidate.id));
  if (narrowed.length === 0) {
    throw new Error(`role "${role.name}": app assignment narrowing leaves no approved candidates`);
  }
  return narrowed;
}

/** Expand candidate effort sets into the exact atomic assignments a plan may use. */
export function resolveApprovedTurnAssignments(
  role: RoleConfig,
  allowedCandidateIds?: readonly string[],
): ApprovedTurnAssignment[] {
  return resolveApprovedAssignmentCandidates(role, allowedCandidateIds).flatMap((candidate) =>
    candidate.efforts.map((effort) => ({
      candidateId: candidate.id,
      assignment: validateTurnAssignment({
        harness: candidate.harness,
        model: candidate.model,
        effort,
      }),
      providerFamily: candidate.providerFamily,
      ...(candidate.capabilityRef === undefined ? {} : { capabilityRef: candidate.capabilityRef }),
      ...(candidate.qualificationRef === undefined
        ? {}
        : { qualificationRef: candidate.qualificationRef }),
      pricing: clonePricing(candidate.pricing),
      maxTurnCostUsd: candidate.maxTurnCostUsd,
    })),
  );
}

function parseAdaptiveAssignments(
  value: unknown,
  fixedAssignment: TurnAssignment,
  maxTurnBudgetUsd: number,
  err: (message: string) => Error,
): AdaptiveAssignmentCandidate[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw err("adaptive_assignments must be a non-empty list when present");
  }

  const candidates: AdaptiveAssignmentCandidate[] = [];
  const ids = new Set<string>([CONFIGURED_ASSIGNMENT_CANDIDATE_ID]);
  const assignments = new Map<string, string>([
    [turnAssignmentKey(fixedAssignment), CONFIGURED_ASSIGNMENT_CANDIDATE_ID],
  ]);
  for (const [index, valueCandidate] of value.entries()) {
    const context = `adaptive_assignments[${index}]`;
    if (!isRecord(valueCandidate)) throw err(`${context} must be a mapping`);

    const allowedFields = new Set([
      "id",
      "harness",
      "model",
      "efforts",
      "provider_family",
      "capability_ref",
      "qualification_ref",
      "price_ref",
      "conservative_estimate",
    ]);
    const unknown = Object.keys(valueCandidate).filter((key) => !allowedFields.has(key));
    if (unknown.length > 0) {
      throw err(`${context} has unknown field(s): ${unknown.sort().join(", ")}`);
    }

    const id = validateAssignmentCandidateId(valueCandidate["id"], `${context}.id`);
    if (ids.has(id)) throw err(`${context}.id "${id}" is reserved or duplicated`);
    ids.add(id);

    const effortsRaw = valueCandidate["efforts"];
    if (!Array.isArray(effortsRaw) || effortsRaw.length === 0) {
      throw err(`${context}.efforts must be a non-empty list`);
    }

    const effortSet = new Set<Effort>();
    const resolvedAssignments: TurnAssignment[] = [];
    for (const [effortIndex, effort] of effortsRaw.entries()) {
      const assignment = validateTurnAssignment(
        {
          harness: valueCandidate["harness"],
          model: valueCandidate["model"],
          effort,
        },
        `${context}.efforts[${effortIndex}] assignment`,
      );
      if (effortSet.has(assignment.effort)) {
        throw err(`${context}.efforts duplicates "${assignment.effort}"`);
      }
      effortSet.add(assignment.effort);
      resolvedAssignments.push(assignment);
    }

    const firstAssignment = resolvedAssignments[0]!;
    const providerFamily = validateAssignmentProviderFamily(
      firstAssignment,
      valueCandidate["provider_family"],
      `${context}.provider_family`,
    );

    const capabilityRef = validateReference(
      valueCandidate["capability_ref"],
      `${context}.capability_ref`,
    );
    const registeredCapabilityRef = runtimeCapabilityProfile(firstAssignment.harness).ref;
    if (capabilityRef !== registeredCapabilityRef) {
      throw err(`${context}.capability_ref must be registered profile ${registeredCapabilityRef}`);
    }
    const qualificationRef = validateQualificationReference(
      valueCandidate["qualification_ref"],
      `${context}.qualification_ref`,
    );
    const pricing = parsePricing(valueCandidate, context, err);
    if (
      pricing.kind === "conservative_estimate" &&
      pricing.maxTurnCostUsd > maxTurnBudgetUsd
    ) {
      throw err(
        `${context}.conservative_estimate.max_turn_cost_usd exceeds the role's ` +
          `max_turn_budget_usd (${pricing.maxTurnCostUsd} > ${maxTurnBudgetUsd})`,
      );
    }

    for (const assignment of resolvedAssignments) {
      const key = turnAssignmentKey(assignment);
      const duplicate = assignments.get(key);
      if (duplicate !== undefined) {
        throw err(`${context} duplicates exact assignment already declared by "${duplicate}"`);
      }
      assignments.set(key, id);
    }

    candidates.push({
      id,
      harness: firstAssignment.harness,
      model: firstAssignment.model,
      efforts: [...effortSet],
      providerFamily,
      capabilityRef,
      qualificationRef,
      pricing,
    });
  }
  return candidates;
}

function parsePricing(
  candidate: Record<string, unknown>,
  context: string,
  err: (message: string) => Error,
): AssignmentPricing {
  const priceRef = candidate["price_ref"];
  const estimate = candidate["conservative_estimate"];
  if (priceRef !== undefined) {
    throw err(
      `${context}.price_ref cannot authorize runtime budgeting until an operational ` +
        "model/token estimator is packaged; use conservative_estimate",
    );
  }
  if (estimate === undefined) throw err(`${context} requires conservative_estimate`);
  if (!isRecord(estimate)) throw err(`${context}.conservative_estimate must be a mapping`);
  const unknown = Object.keys(estimate).filter(
    (key) => key !== "max_turn_cost_usd" && key !== "source",
  );
  if (unknown.length > 0) {
    throw err(`${context}.conservative_estimate has unknown field(s): ${unknown.sort().join(", ")}`);
  }
  const maxTurnCostUsd = estimate["max_turn_cost_usd"];
  if (typeof maxTurnCostUsd !== "number" || !Number.isFinite(maxTurnCostUsd) || maxTurnCostUsd <= 0) {
    throw err(`${context}.conservative_estimate.max_turn_cost_usd must be a positive number`);
  }
  return {
    kind: "conservative_estimate",
    maxTurnCostUsd,
    sourceRef: validateEstimateSource(estimate["source"], `${context}.conservative_estimate.source`),
  };
}

function validateQualificationReference(value: unknown, context: string): string {
  const ref = validateReference(value, context);
  if (!/^(?:campaign:[a-z0-9][a-z0-9._-]*|qualification(?:[:/])[A-Za-z0-9][A-Za-z0-9._:/-]*)$/u.test(ref)) {
    throw new Error(
      `${context} must be a campaign:<id> or qualification:<id> evidence reference`,
    );
  }
  return ref;
}

function validateEstimateSource(value: unknown, context: string): string {
  const ref = validateReference(value, context);
  if (!/^(?:https:\/\/|research\/|qualification(?:[:/])|campaign:)/u.test(ref)) {
    throw new Error(
      `${context} must be an https URL or a research/qualification/campaign evidence reference`,
    );
  }
  return ref;
}

function validateReference(value: unknown, context: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value !== value.trim() ||
    /[\s\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${context} must be a non-empty stable reference without whitespace`);
  }
  return value;
}

function clonePricing(pricing: AssignmentPricing): AssignmentPricing {
  return pricing.kind === "catalog_ref"
    ? { kind: pricing.kind, ref: pricing.ref }
    : {
        kind: pricing.kind,
        maxTurnCostUsd: pricing.maxTurnCostUsd,
        sourceRef: pricing.sourceRef,
      };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveNumberOr(v: unknown, fallback: number, context: string): number {
  if (v === undefined) return fallback;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  throw new Error(`${context} must be a positive finite number`);
}
