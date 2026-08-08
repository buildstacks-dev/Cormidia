// campaign/acceptance/grader-independence.ts — per-axis provider disjointness
// (CORMIDIA-C-B29-001 §2; CORMIDIA-INV-ACC-2).
//
// Three design points carry the whole invariant:
//
//   * PER AXIS, not per scenario. Load-bearing rather than a loophole:
//     S-ACC-3's fan-out deliberately spans both provider families, so a
//     whole-scenario rule would admit NO legal grader and the scenario could
//     not be graded at all. Per-axis scoping resolves it honestly — mechanical
//     axes need no model grader, and a model-graded axis is disjoint against
//     only the turns it actually reads.
//   * FAMILY, not vendor product. `configuredProviderFamily` is reused rather
//     than reimplemented precisely because it already knows that a pi turn on
//     an Anthropic model is Anthropic (the B-04 correlation).
//   * BEFORE CONSTRUCTION. `resolveAxisGraders` is pure; `constructAxisGrader`
//     is the only path to a provider and refuses anything the resolver did not
//     admit. An axis with no legal grader reports `ungraded` — it is never
//     graded by a correlated provider, and never silently dropped.

import { configuredProviderFamily, validateTurnAssignment } from "../../../src/runtime/assignment.js";
import type { TurnAssignment } from "../../../src/runtime/types.js";

export class GraderIndependenceError extends Error {
  constructor(
    readonly code: "unknown-turn" | "read-set-drift" | "not-admitted" | "duplicate-axis",
    message: string,
  ) {
    super(`grader independence refused (${code}): ${message}`);
    this.name = "GraderIndependenceError";
  }
}

/** One turn of the scenario whose output some axis may read. */
export interface GradedTurnRef {
  turnId: string;
  assignment: TurnAssignment;
}

export interface AxisReadSet {
  axis: string;
  /** Turn ids whose OUTPUT this axis reads. Declared before construction. */
  readTurnIds: string[];
  /** Mechanical axes (P-2/P-3/P-4 key coverage, J-1, J-2) are set comparisons
   *  and file checks. They are never routed to a model, so disjointness does
   *  not apply and no grader is constructed for them. */
  mechanical?: boolean;
  /** The exact configured grader candidate for this axis. The resolver may
   * reject it as correlated; it may never silently substitute another one. */
  graderCandidateId?: string;
}

export interface GraderCandidate {
  id: string;
  assignment: TurnAssignment;
}

export interface AssignedAxisGrader {
  axis: string;
  status: "assigned";
  grader: GraderCandidate;
  graderFamily: string;
  /** The families this axis was made disjoint FROM — recorded so the scoping
   *  is auditable rather than assumed (B-29 §2, rubric §7 rule 1). */
  appliedDisjointnessFamilies: string[];
  /** The exact turns the applied set was computed over. */
  appliedReadTurnIds: string[];
}

export interface MechanicalAxis {
  axis: string;
  status: "mechanical";
}

export interface UngradedAxis {
  axis: string;
  status: "ungraded";
  reason: "no-legal-grader";
  /** Still recorded: which families made every candidate correlated. */
  appliedDisjointnessFamilies: string[];
  appliedReadTurnIds: string[];
}

export type AxisGraderResolution = AssignedAxisGrader | MechanicalAxis | UngradedAxis;

export interface ResolveAxisGradersInput {
  axes: readonly AxisReadSet[];
  turns: readonly GradedTurnRef[];
  candidates: readonly GraderCandidate[];
}

/** Pure. Runs before any provider is constructed and fails closed. */
export function resolveAxisGraders(input: ResolveAxisGradersInput): AxisGraderResolution[] {
  const families = new Map<string, string>();
  for (const turn of input.turns) {
    families.set(turn.turnId, configuredProviderFamily(validateTurnAssignment(turn.assignment)));
  }
  const seen = new Set<string>();
  return input.axes.map((axis) => {
    if (seen.has(axis.axis)) {
      throw new GraderIndependenceError("duplicate-axis", `axis ${axis.axis} declared twice`);
    }
    seen.add(axis.axis);
    if (axis.mechanical === true) return { axis: axis.axis, status: "mechanical" };

    const readTurnIds = [...axis.readTurnIds].sort();
    const excluded = new Set<string>();
    for (const turnId of readTurnIds) {
      const family = families.get(turnId);
      if (family === undefined) {
        throw new GraderIndependenceError(
          "unknown-turn",
          `axis ${axis.axis} declares read turn ${turnId}, which is not a turn of this scenario`,
        );
      }
      excluded.add(family);
    }
    const appliedDisjointnessFamilies = [...excluded].sort();

    const declared =
      axis.graderCandidateId === undefined
        ? input.candidates
        : input.candidates.filter((candidate) => candidate.id === axis.graderCandidateId);
    const legal = declared.find(
      (candidate) => !excluded.has(configuredProviderFamily(validateTurnAssignment(candidate.assignment))),
    );
    if (legal === undefined) {
      return {
        axis: axis.axis,
        status: "ungraded",
        reason: "no-legal-grader",
        appliedDisjointnessFamilies,
        appliedReadTurnIds: readTurnIds,
      };
    }
    return {
      axis: axis.axis,
      status: "assigned",
      grader: legal,
      graderFamily: configuredProviderFamily(validateTurnAssignment(legal.assignment)),
      appliedDisjointnessFamilies,
      appliedReadTurnIds: readTurnIds,
    };
  });
}

/**
 * The only path from a resolution to a provider. A mechanical or ungraded axis
 * never reaches the factory, so "checked before construction" is a structural
 * property here rather than a convention someone must remember.
 */
export function constructAxisGrader<T>(
  resolution: AxisGraderResolution,
  factory: (assignment: TurnAssignment) => T,
): T {
  if (resolution.status !== "assigned") {
    throw new GraderIndependenceError(
      "not-admitted",
      `axis ${resolution.axis} resolved as ${resolution.status}; no provider may be constructed for it`,
    );
  }
  return factory(resolution.grader.assignment);
}

/**
 * A read set that grows after the check invalidates it (INV-ACC-2 adversarial
 * seed (b)). Called with the turns the axis ACTUALLY read once grading is done.
 */
export function assertReadSetUnchanged(resolution: AxisGraderResolution, actualReadTurnIds: readonly string[]): void {
  if (resolution.status === "mechanical") return;
  const declared = resolution.appliedReadTurnIds;
  const actual = [...actualReadTurnIds].sort();
  if (declared.length !== actual.length || declared.some((turnId, index) => turnId !== actual[index])) {
    throw new GraderIndependenceError(
      "read-set-drift",
      `axis ${resolution.axis} was admitted against [${declared.join(", ")}] but read [${actual.join(", ")}]; ` +
        `the recorded disjointness set no longer describes what the axis read`,
    );
  }
}
