// Grant-aware gate composition. This lives in src/org so runtime remains a
// pure adapter layer and never imports approval storage.
//
// Stage 6 (approval-and-release-amendment): scoped multi-use grants match by
// rule+path before escalating (A1); acts forbidden for a role are auto-denied
// with guidance and a durable lesson instead of burning a human decision —
// the episode spent 20 decisions on attempts the protocol already forbade.

import { classify, normalizeSemanticAction, stripMessageArgs } from "../runtime/gate.js";
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
      actionText: grantScopeText(action),
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

    if (rule !== undefined) {
      const denied = store.findDeniedEquivalentSync({
        app: context.app,
        role: context.role,
        rule,
        action,
        ...(context.turnId !== undefined ? { turnId: context.turnId } : {}),
        ...(context.ticketRef !== undefined ? { ticketRef: context.ticketRef } : {}),
        now,
      });
      if (denied !== undefined) {
        store.recordDeniedRecurrenceSync(denied, action, now);
        const reason =
          `governed denial ${denied.id} still applies to this exact action` +
          `${denied.reason !== undefined ? `: ${denied.reason}` : ""}`;
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

/** The text a scoped grant's `pathContains` bound is evaluated against — the
 *  action's NORMALIZED target paths plus its command with message-flag argument
 *  VALUES and shell comments stripped, NEVER the raw input JSON (A-005).
 *  Free-text fields the agent controls — a Write `content`, a `description`, a
 *  shell `# comment`, and a `-m`/`--body`/`--notes` message value — must never
 *  reach the bound: with the old `${tool} ${JSON.stringify(input)}` text, a
 *  grant scoped to `.npmrc` matched `cat ~/.aws/credentials # same idea as
 *  .npmrc`, silently widening a repo-file grant to arbitrary credential reads.
 *  Comment stripping closed the trailing-`#` channel; message-value stripping
 *  (P0-04c) closes the remaining one — an agent naming `.npmrc` inside
 *  `--body "…"` or smuggling `$(cat ~/.aws/credentials) # .npmrc` inside a
 *  quoted `-m` value. Message values are stripped UNCONDITIONALLY here (unlike
 *  classification, which keeps executable values so exfil still classifies
 *  critical — L1-05): for authorization scope, narrower is the fail-closed
 *  direction, and a stripped legitimate value only costs a human re-approval.
 *  The command's actual file ARGUMENTS stay, so a genuine scoped bash action
 *  (`wc -l secrets.json`) still matches — that A1 behaviour is preserved.
 *
 *  This is the ONE builder of a `findMatchingGrantSync` `actionText` (A-005 /
 *  P0-04b/P0-04c): every caller must route through it — never
 *  `JSON.stringify(input)` — so no free-text field can ever reach a
 *  `pathContains` bound. See `src/org/release.ts`. */
export function grantScopeText(action: ToolAction): string {
  const semantic = normalizeSemanticAction(action);
  const command =
    semantic.command === null
      ? ""
      : stripShellComments(stripMessageArgs(semantic.command, { keepExecutable: false }));
  return [command, ...semantic.paths].join(" ");
}

/** Drop `# …` shell comments (a `#` at the start of a token, outside quotes,
 *  running to end of line) so agent-authored comment text cannot appear at a
 *  path boundary the bound would match. Quoted `#` is preserved. */
function stripShellComments(command: string): string {
  let out = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote !== null) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(command[i - 1]!))) {
      while (i + 1 < command.length && command[i + 1] !== "\n") i++;
      continue;
    }
    out += ch;
  }
  return out;
}
