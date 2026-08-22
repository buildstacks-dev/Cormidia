// The host-side authorization evidence Cormidia hands the kernel at publish
// time (kernel contract §Authority). Three lanes, each a closed evidence shape
// the authority port parses from `unknown` and judges AGAINST THE BINDING —
// the lane never decides on its own:
//
//   { approvalId }                 the human gate: one `learning_loop_publish`
//                                  item in the existing approvals store
//                                  (design §6.1 items 1–3: activation into
//                                  context, anything T2/T3, promotion);
//   { kind: "routine", actor }     the routine lane of design §6.1: a
//                                  deduplicated ticket or an unmerged proposal
//                                  draft at T0/T1 publishes without a human
//                                  gate — the publishing actor's own standing
//                                  authority, which the port grants ONLY for a
//                                  `publish` of a proposal-class destination at
//                                  T0/T1 (compatibility-policy record §4.3);
//   { kind: "operator", identity } a human operator reversing a publication
//                                  from the CLI (`learn disable|rollback`):
//                                  granted ONLY for disable/rollback/compensate
//                                  plans — a human could always edit the org
//                                  home by hand, so a recorded, bound reversal
//                                  is strictly more governed than the status quo.
//
// The kernel binds whichever lane authorized into the plan's journal, so a
// routine or operator authorization is as auditable as an approval id.

export interface ApprovalEvidence {
  readonly kind: "approval";
  readonly approvalId: string;
}

export interface RoutineEvidence {
  readonly kind: "routine";
  /** The publishing actor (`role:<name>` or `human:<identity>`). */
  readonly actor: string;
}

export interface OperatorEvidence {
  readonly kind: "operator";
  /** The human operator's identity (the CLI caller). */
  readonly identity: string;
}

export type AuthorityEvidence = ApprovalEvidence | RoutineEvidence | OperatorEvidence;

export function approvalEvidence(approvalId: string): { readonly approvalId: string } {
  return { approvalId };
}

export function routineEvidence(actor: string): RoutineEvidence {
  return { kind: "routine", actor };
}

export function operatorEvidence(identity: string): OperatorEvidence {
  return { kind: "operator", identity };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Parse host evidence from `unknown`; undefined when it is none of the three shapes. */
export function parseAuthorityEvidence(evidence: unknown): AuthorityEvidence | undefined {
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) return undefined;
  const kind: unknown = Reflect.get(evidence, "kind");
  const approvalId: unknown = Reflect.get(evidence, "approvalId");
  if (kind === undefined && nonEmpty(approvalId)) return { kind: "approval", approvalId };
  if (kind === "approval" && nonEmpty(approvalId)) return { kind: "approval", approvalId };
  const actor: unknown = Reflect.get(evidence, "actor");
  if (kind === "routine" && nonEmpty(actor)) return { kind: "routine", actor };
  const identity: unknown = Reflect.get(evidence, "identity");
  if (kind === "operator" && nonEmpty(identity)) return { kind: "operator", identity };
  return undefined;
}
