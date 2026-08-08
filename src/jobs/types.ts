// The job contract as data — docs/jobs/design.md §5, CORMIDIA-C-B30-001.
// Types only, so the loader, journal, checks, and runner share one shape
// without importing each other.

import type { Effort, RuntimeKind } from "../runtime/types.js";

/** Deterministic output checks — the substitute for a reviewer (design.md §7).
 * Every kind is fail-closed: a check that cannot be evaluated fails. */
export type OutputCheck =
  | { kind: "exists" }
  | { kind: "non_empty" }
  | { kind: "json" }
  | { kind: "schema"; schemaPath: string }
  | { kind: "command"; command: string };

export interface DeclaredOutput {
  /** Relative to the job working directory; never absolute, never escaping. */
  path: string;
  check: OutputCheck;
}

/**
 * One step's harness/model/effort. Deliberately NOT an
 * `adaptive_assignments` candidate (decided 2026-08-07): that machinery guards a
 * delegated model choice whose quality claim a downstream consumer inherits, and
 * a job has neither. Validated against availability and the operator role's
 * ceiling instead — the assignment is free, the authority is not.
 */
export interface JobStepAssignment {
  harness: RuntimeKind;
  model: string;
  effort: Effort;
}

export interface ProviderJobStep {
  kind: "provider";
  id: string;
  objective: string;
  dependsOn: string[];
  outputs: DeclaredOutput[];
  /** Absent means the operator role's configured tuple. */
  assignment?: JobStepAssignment;
}

export interface CheckpointJobStep {
  kind: "checkpoint";
  id: string;
  dependsOn: string[];
  prompt: string;
}

export type JobStep = ProviderJobStep | CheckpointJobStep;

export interface JobConfig {
  /** Stable id: names the journal and the run-record segment. */
  job: string;
  /** Onboarded app name, or null for an unscoped job (design.md §2). */
  app: string | null;
  description: string;
  steps: JobStep[];
  /** SHA-256 over the normalized config. The journal binds this; a mismatch
   * refuses rather than resuming against a different graph (design.md §6). */
  configHash: string;
}
