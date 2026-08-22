// Cormidia's approval root of trust onto the kernel's AuthorityPort (kernel
// contract §Authority; decision 0025). One kernel publication plan is one
// approval item of tool kind `learning_loop_publish` in the EXISTING approvals
// store — never a second inbox (design §11.1). The whole AuthorizationBinding
// plus its digest rides in `action.input`, so the store's own actionHash
// covers every bound field and approving one binding can never authorize
// different bytes (the B-11 `learning_publish` pattern, carried over exactly).
// Verification is read-only: it projects the item's status onto the kernel's
// closed decision set and never consumes a grant — the kernel journals
// consumption of the verified authorization itself (decision 0026).

import { authorizationBindingDigest, createAuthorityPort, sha256HexOfCanonicalJson } from "@cormidia/learning-loop";
import type { AuthorityPort, AuthorizationBinding, Diagnostic, PublicationPlan } from "@cormidia/learning-loop";
import type { ApprovalDecider, ApprovalItem, ApprovalStore } from "../approvals.js";
import { definedProps } from "../../runtime/optional-properties.js";

export const LEARNING_LOOP_PUBLISH_TOOL = "learning_loop_publish";
export const LEARNING_LOOP_PUBLISH_RULE = "learning-loop-publish";
export const CORMIDIA_AUTHORITY_PORT_ID = "cormidia/approvals";
const PORT_VERSION = "1.0.0";
const DIGEST_RE = /^[0-9a-f]{64}$/;

/** The approval action input: the exact binding, its digest, and the plan id. */
export interface LearningLoopPublishBinding {
  readonly kind: typeof LEARNING_LOOP_PUBLISH_TOOL;
  readonly version: 1;
  readonly planId: string;
  readonly bindingDigest: string;
  readonly binding: AuthorizationBinding;
}

/** The opaque host evidence a caller hands to `publish`. */
export interface ApprovalEvidence {
  readonly approvalId: string;
}

function closed(status: "pending" | "denied" | "invalid" | "expired", code: string, message: string): unknown {
  const diagnostics: Diagnostic[] = [{ code, severity: "error", message }];
  return { status, diagnostics };
}

function parseEvidence(evidence: unknown): ApprovalEvidence | undefined {
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) return undefined;
  const approvalId: unknown = Reflect.get(evidence, "approvalId");
  return typeof approvalId === "string" && approvalId.length > 0 ? { approvalId } : undefined;
}

/** The binding digest an approval item carries, when it is a learning-loop publish. */
export function publishBindingDigestOf(item: ApprovalItem): string | undefined {
  if (item.action.tool !== LEARNING_LOOP_PUBLISH_TOOL) return undefined;
  const input = item.action.input;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  if (Reflect.get(input, "kind") !== LEARNING_LOOP_PUBLISH_TOOL) return undefined;
  const digest: unknown = Reflect.get(input, "bindingDigest");
  return typeof digest === "string" && DIGEST_RE.test(digest) ? digest : undefined;
}

function principalOf(decider: ApprovalDecider | undefined): {
  id: string;
  kind: "human" | "agent";
  independenceDomain: string;
} {
  // The approvals store records no decider for a decision taken by the human
  // at the CLI; that is the operator, never an agent (approvals.ts
  // ApprovalDecider: an agent decision is always an explicit distinct fact).
  if (decider === undefined) return { id: "human:operator", kind: "human", independenceDomain: "human:operator" };
  const id = `${decider.kind}:${decider.identity}`;
  return { id, kind: decider.kind, independenceDomain: id };
}

/** Raise (idempotently) the approval item that authorizes one exact plan. */
export async function raiseLearningLoopPublish(
  store: ApprovalStore,
  input: {
    readonly app: string;
    readonly plan: PublicationPlan;
    readonly binding: AuthorizationBinding;
    readonly justification?: string;
    readonly now?: Date;
  },
): Promise<ApprovalItem> {
  const bindingDigest = authorizationBindingDigest(input.binding);
  const bound: LearningLoopPublishBinding = {
    kind: LEARNING_LOOP_PUBLISH_TOOL,
    version: 1,
    planId: input.plan.id,
    bindingDigest,
    binding: input.binding,
  };
  return store.raise({
    app: input.app,
    role: "learning",
    rule: LEARNING_LOOP_PUBLISH_RULE,
    action: {
      tool: LEARNING_LOOP_PUBLISH_TOOL,
      input: bound,
      description:
        `learning-loop publish: ${input.binding.action} → ${input.binding.destinationId} ` +
        `candidate ${input.plan.candidateId} (risk ${input.binding.effectiveRisk}, plan ${input.plan.id})`,
    },
    ...definedProps({ justification: input.justification }),
    ...definedProps({ now: input.now }),
  });
}

export function createCormidiaAuthorityPort(store: ApprovalStore): AuthorityPort {
  const configurationDigest = sha256HexOfCanonicalJson({ kind: "cormidia-approvals-authority", schemaVersion: 1 });
  return createAuthorityPort({
    id: CORMIDIA_AUTHORITY_PORT_ID,
    version: PORT_VERSION,
    configurationDigest,
    verify: async ({ evidence, binding }) => {
      const parsed = parseEvidence(evidence);
      if (parsed === undefined)
        return closed("invalid", "authority.evidence_invalid", "authorization evidence must be { approvalId }");
      let item: ApprovalItem;
      let grantExpiresAt: string | undefined;
      try {
        const shown = await store.show(parsed.approvalId);
        item = shown.item;
        grantExpiresAt = shown.grant?.expiresAt;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return closed("invalid", "authority.approval_unknown", message);
      }
      const expected = authorizationBindingDigest(binding);
      const carried = publishBindingDigestOf(item);
      if (carried === undefined) {
        return closed(
          "invalid",
          "authority.not_a_learning_loop_publish",
          `approval ${item.id} is not a ${LEARNING_LOOP_PUBLISH_TOOL} item`,
        );
      }
      if (carried !== expected) {
        return closed(
          "invalid",
          "publication.binding_mismatch",
          `approval ${item.id} binds ${carried}, not ${expected}`,
        );
      }
      switch (item.status) {
        case "pending":
          return closed("pending", "authority.pending", `approval ${item.id} is pending`);
        case "denied":
          return closed(
            "denied",
            "authority.denied",
            `approval ${item.id} was denied${item.reason === undefined ? "" : `: ${item.reason}`}`,
          );
        case "expired":
          return closed("expired", "authority.expired", `approval ${item.id} expired`);
        case "approved": {
          if (item.decidedAt === undefined)
            return closed("invalid", "authority.undated", `approval ${item.id} carries no decision time`);
          const principal = principalOf(item.decidedBy);
          return {
            status: "authorized",
            authorization: {
              id: item.id,
              principal,
              principalAttestationDigest: sha256HexOfCanonicalJson({
                approvalId: item.id,
                decidedBy: principal.id,
                decidedAt: item.decidedAt,
              }),
              bindingDigest: carried,
              authorizedAt: item.decidedAt,
              ...(grantExpiresAt !== undefined && grantExpiresAt > item.decidedAt ? { expiresAt: grantExpiresAt } : {}),
            },
          };
        }
      }
    },
  });
}
