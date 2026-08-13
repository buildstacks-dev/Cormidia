// Typed refusal for `cormidia new-app`. Preview and execution raise the SAME
// shape from the SAME checks, so a dry run that reports ready is a prediction
// execution can keep (#385, #384). The carrier is deliberately data-only: the
// CLI renders it as text or `kind: new-app-refusal` JSON and exits non-zero.

export interface NewAppBlocker {
  /** Stable machine code, e.g. `repository-identity`. */
  readonly code: string;
  /** The exact value or path the blocker is about. */
  readonly subject: string;
  readonly detail: string;
  /** A supported command or decision, never "hand-edit a generated file". */
  readonly remediation: string;
}

export interface NewAppRefusal {
  readonly schema_version: 1;
  readonly kind: "new-app-refusal";
  readonly app: string;
  readonly target_dir: string;
  /** Reported so the operator sees the exact target that was refused. */
  readonly repository: string;
  readonly dry_run: boolean;
  readonly blockers: readonly NewAppBlocker[];
}

export class NewAppBlockedError extends Error {
  readonly refusal: NewAppRefusal;

  constructor(refusal: NewAppRefusal) {
    super(`new-app: blocked — ${refusal.blockers.map((blocker) => blocker.code).join("; ")}`);
    this.name = "NewAppBlockedError";
    this.refusal = refusal;
  }
}
