// Grant-aware gate composition. This lives in src/org so runtime remains a
// pure adapter layer and never imports approval storage.
//
// Stage 6 (approval-and-release-amendment): scoped multi-use grants match by
// rule+path before escalating (A1); acts forbidden for a role are auto-denied
// with guidance and a durable lesson instead of burning a human decision —
// the episode spent 20 decisions on attempts the protocol already forbade.

import { classify } from "../runtime/gate.js";
import { FORBIDDEN_BY_ROLE } from "../runtime/role-shaping.js";
import type { GateDecision, GateFn, ToolAction } from "../runtime/types.js";
import { actionHash, ApprovalStore } from "./approvals.js";
import { appendDenialLesson } from "./denial-lessons.js";

export interface GateContext {
  app: string;
  role: string;
  turnId?: string;
  ticketRef?: string;
  /** Org home for durable denial lessons (A5); lessons are skipped without it. */
  orgHome?: string;
  now?: () => Date;
}

export function composeGate(
  baseGate: GateFn,
  store: ApprovalStore,
  context: GateContext,
): GateFn {
  return (action: ToolAction): GateDecision => {
    const now = context.now?.() ?? new Date();
    const hash = actionHash(action);
    const { rule } = classify(action);
    const grant = store.findMatchingGrantSync({
      app: context.app,
      role: context.role,
      actionHash: hash,
      ...(rule !== undefined ? { rule } : {}),
      actionText: `${action.tool} ${JSON.stringify(action.input ?? "")}`,
      ...(context.ticketRef !== undefined ? { ticketRef: context.ticketRef } : {}),
      now,
    });
    if (grant !== undefined) {
      store.consumeGrantSync(grant.grantId, now);
      return { allow: true };
    }

    // Role shaping: a forbidden act is denied flat — no escalation, no
    // approval item, no human decision. The reason is standing guidance and
    // is persisted once as a durable lesson.
    if (rule !== undefined && (FORBIDDEN_BY_ROLE[context.role] ?? []).includes(rule)) {
      const reason =
        `${rule} is forbidden for the ${context.role} role by construction — do not retry ` +
        `or work around it; the orchestrator owns this operation`;
      if (context.orgHome !== undefined) {
        appendDenialLesson(context.orgHome, context.role, {
          app: context.app,
          rule,
          reason,
          at: now.toISOString(),
        });
      }
      return { allow: false, reason, escalate: false };
    }

    const decision = baseGate(action);
    if (!decision.allow && decision.escalate) {
      store.raiseSync({
        app: context.app,
        role: context.role,
        rule: ruleFromReason(decision.reason),
        action,
        ...(context.turnId !== undefined ? { turnId: context.turnId } : {}),
        ...(context.ticketRef !== undefined ? { ticketRef: context.ticketRef } : {}),
        justification: decision.reason,
        now,
      });
    }
    return decision;
  };
}

function ruleFromReason(reason: string): string {
  const match = /\(([^)]+)\)/.exec(reason);
  return match?.[1] ?? "critical-op";
}
