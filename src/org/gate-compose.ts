// Grant-aware gate composition. This lives in src/org so runtime remains a
// pure adapter layer and never imports approval storage.

import type { GateDecision, GateFn, ToolAction } from "../runtime/types.js";
import { actionHash, ApprovalStore } from "./approvals.js";

export interface GateContext {
  app: string;
  role: string;
  turnId?: string;
  ticketRef?: string;
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
    const grant = store.findMatchingGrantSync({
      app: context.app,
      role: context.role,
      actionHash: hash,
      now,
    });
    if (grant !== undefined) {
      store.consumeGrantSync(grant.grantId, now);
      return { allow: true };
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
