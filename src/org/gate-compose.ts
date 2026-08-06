// Grant-aware gate composition. This lives in src/org so runtime remains a
// pure adapter layer and never imports approval storage.
//
// Stage 6 (docs/approvals/design.md): scoped multi-use grants match by
// rule+path before escalating (A1); acts forbidden for a role are auto-denied
// with guidance and a durable lesson instead of burning a human decision —
// the episode spent 20 decisions on attempts the protocol already forbade.

import { actionEffectFields, decideDisposition } from "../runtime/gate.js";
import { FORBIDDEN_BY_ROLE } from "../runtime/role-shaping.js";
import type { GateDecision, GateFn, ToolAction } from "../runtime/types.js";
import { actionHash, ApprovalStore } from "./approvals.js";
import { appendDenialLesson } from "./denial-lessons.js";
import { ObjectiveGrantStore } from "./objective-grants.js";

export interface GateContext {
  app: string;
  role: string;
  turnId?: string;
  ticketRef?: string;
  /** Org home for durable denial lessons (A5); lessons are skipped without it. */
  orgHome?: string;
  /** The turn's local checkout — the cwd the gated action would run in. It is
   *  persisted on the approval item so a later orchestrator execution runs the
   *  approved command in the context it was approved for rather than a guessed
   *  one (ISSUE-020). Omitted where the caller has no checkout. */
  workdir?: string;
  now?: () => Date;
}

export function composeGate(
  baseGate: GateFn,
  store: ApprovalStore,
  context: GateContext,
): GateFn {
  const objectiveGrants = new ObjectiveGrantStore(store.root);
  return (action: ToolAction): GateDecision => {
    const now = context.now?.() ?? new Date();
    const hash = actionHash(action);
    const disposition = decideDisposition(action);
    const rule = disposition.tier !== "routine" ? disposition.rule : undefined;
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
      if (grant.scope === undefined) {
        const claim = store.claimActorRetryGrantSync(
          grant.grantId,
          actorRetryActor(context.role, context.turnId),
          now,
        );
        if (claim.status !== "claimed") {
          const execution = claim.item.execution;
          return {
            allow: false,
            reason:
              claim.status === "not-actor-retry"
                ? `approval ${claim.item.id} is owned by ${execution?.executor ?? "a sanctioned executor"}; ` +
                  `run \`cormidia dispatch\` or inspect \`cormidia approvals status\``
                : `approval ${claim.item.id} actor retry is ${execution?.state ?? "untracked"}; ` +
                  `resolve it with \`cormidia approvals disposition ${claim.item.id} ` +
                  `(--executed|--failed|--retry) --reason <text> --confirm ${claim.item.id}\``,
            escalate: false,
          };
        }
      } else {
        // A1 scoped grants are standing, bounded permissions whose per-action
        // uses remain the append-only execution audit. They do not identify
        // one exact action and therefore cannot occupy the content-bound
        // single-action execution record repaired by ISSUE-011.
        store.consumeGrantSync(grant.grantId, now);
      }
      return { allow: true };
    }

    // Objective grants (#296 Stage 3, proposal §6): standing HUMAN-CREATED
    // authority bound to an objective rather than a candidate hash, consulted
    // exactly where an A1 grant would have covered the action. Inert until a
    // human creates one — with no grant on disk this is a single existsSync
    // miss and behavior is byte-identical to the pre-objective gate. Each
    // covering use decrements the grant and appends its per-use audit row
    // (§4.1), so the owner can always reconstruct what the grant authorized.
    if (rule !== undefined) {
      const objective = objectiveGrants.findCoveringGrantSync({ app: context.app, rule, now });
      if (objective !== undefined) {
        objectiveGrants.consumeUseSync(objective.grantId, { rule, actionHash: hash }, now);
        return { allow: true };
      }
    }

    if (rule !== undefined) {
      const stalled = store.findStalledActorRetryEquivalentSync({
        app: context.app,
        role: context.role,
        rule,
        action,
        ...(context.turnId !== undefined ? { turnId: context.turnId } : {}),
        ...(context.ticketRef !== undefined ? { ticketRef: context.ticketRef } : {}),
        now,
      });
      if (stalled !== undefined) {
        return {
          allow: false,
          reason:
            `approval ${stalled.id} actor retry is ${stalled.execution?.state ?? "untracked"}; ` +
            `no new approval was raised. Reconcile it with ` +
            `\`cormidia approvals disposition ${stalled.id} (--executed|--failed|--retry) ` +
            `--reason <text> --confirm ${stalled.id}\``,
          escalate: false,
        };
      }
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

    // Budgeted tier (#296 §5.1+, ratified): the action PROCEEDS — "free until
    // it isn't" — bounded by a covering objective grant's uses/ledger when one
    // exists (handled above) and always visible as a per-action audit row.
    // Every refusal path keeps precedence: this branch sits after grant
    // lookup, the stalled-execution circuit breaker, role shaping, and
    // governed denials. The bare defaultGate still denies budgeted actions —
    // proceed semantics exist only here, where the audit surface exists. The
    // grantless accounting quantum is F-PT-024.
    if (rule !== undefined && disposition.tier === "budgeted") {
      objectiveGrants.recordBudgetedActionSync(
        { app: context.app, rule, actionHash: hash },
        now,
      );
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
        ...(context.workdir !== undefined ? { workdir: context.workdir } : {}),
        justification: decision.reason,
        ...(disposition.tier !== "routine" ? { classification: disposition.evidence } : {}),
        now,
      });
    }
    return decision;
  };
}

export function actorRetryActor(role: string, turnId: string | undefined): string {
  return `actor-retry/${role}/${turnId ?? "untracked"}`;
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
 *  `JSON.stringify(input)` — so non-command free-text fields (`content`,
 *  `description`, message values, `# comments`) cannot reach a `pathContains`
 *  bound. See `src/org/release.ts`.
 *
 *  A-006 is closed by the structural projection in `actionEffectFields`:
 *  only resolved/parsed targets and redirect destinations reach scope
 *  matching. Search patterns, comments, message bodies, and heredoc payloads
 *  never do, so merely naming `.npmrc` cannot widen a `.npmrc` grant. */
export function grantScopeText(action: ToolAction): string {
  const fields = actionEffectFields(action);
  return [...fields.targets, ...fields.redirections].join(" ");
}
