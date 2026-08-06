// CF-SM-APPR-L/I — L1 unit leg (HB-011): the approval lifecycle's pure
// projections, the type-level unrepresentability pins, the transition-relation
// detector with its negative controls, and the identity/never-scopeable
// guardrails that keep grants inside INV-003's ratified shapes.
//
// Design: validation-design/case-catalog.md §2 (CF-SM-APPR-L/I/R/C),
// contracts/B-09a-approval-continuation.md, contracts/B-09b-approval-decision-
// entry.md, invariants.md CORMIDIA-INV-003. Product under test: real exports of
// src/org/approvals.ts and src/runtime/gate.ts — no fs, no network, no tokens.

import { describe, expect, it } from "vitest";
import {
  actionHash,
  approvalLifecycleState,
  commandIdentityHash,
  NEVER_SCOPEABLE_RULES,
  type ApprovalItem,
  type ApprovalLogEvent,
  type ApprovalStatus,
  type RaiseApprovalInput,
} from "../../../src/org/approvals.js";
import { CRITICAL_RULES } from "../../../src/runtime/gate.js";
import {
  ApprovalTransitionViolation,
  detectIllegalExecutionTransitions,
  LEGAL_EXECUTION_TRANSITIONS,
} from "./transition-relation.js";

const AT = "2026-07-31T12:00:00.000Z";

function item(overrides: Partial<ApprovalItem>): ApprovalItem {
  return {
    id: "20260731T120000Z-unit",
    app: "unit-app",
    role: "sre",
    rule: "external-publishing",
    action: { tool: "bash", input: { command: "npm publish" } },
    raisedAt: AT,
    status: "pending",
    ...overrides,
  };
}

function transition(
  id: string,
  from: string,
  to: string,
): ApprovalLogEvent {
  return {
    type: "execution-transition",
    id,
    at: AT,
    from: from as never,
    to: to as never,
    actor: "unit-actor",
  };
}

describe("CF-SM-APPR-L — legal lifecycle set, projected by the product's own reader (L1, HB-011)", () => {
  it("projects the exact ratified set: pending → approved|denied → executing → executed|failed|ambiguous", () => {
    expect(approvalLifecycleState(item({}))).toBe("pending");
    expect(
      approvalLifecycleState(item({ status: "denied", decision: "denied", reason: "no" })),
    ).toBe("denied");
    for (const state of ["approved", "executing", "executed", "failed", "ambiguous"] as const) {
      expect(
        approvalLifecycleState(
          item({
            status: "approved",
            decision: "approved",
            decidedAt: AT,
            execution: {
              state,
              executor: "orchestrator-command",
              idempotencyKey: "approval:unit:hash",
              attempts: state === "approved" ? 0 : 1,
              nextAction: "none",
            },
          }),
        ),
      ).toBe(state);
    }
  });

  it("'executed' is reachable only through an execution record: an approved item without one projects 'approved' (INV-003: approval is never execution)", () => {
    const approved = item({ status: "approved", decision: "approved", decidedAt: AT });
    expect(approved.execution).toBeUndefined();
    expect(approvalLifecycleState(approved)).toBe("approved");
  });

  it("the transition relation is exhaustive over the product state union and admits no edge out of the executed terminal", () => {
    // Record<ApprovalExecutionState, …> in transition-relation.ts fails to
    // compile if the product union moves; here we pin the terminal.
    expect(LEGAL_EXECUTION_TRANSITIONS.executed).toHaveLength(0);
    // Every declared target is itself a state the relation knows.
    for (const targets of Object.values(LEGAL_EXECUTION_TRANSITIONS)) {
      for (const target of targets) {
        expect(Object.keys(LEGAL_EXECUTION_TRANSITIONS)).toContain(target);
      }
    }
  });
});

describe("CF-SM-APPR-I — illegal shapes unrepresentable at the type seam (L1, HB-011)", () => {
  it("an agent-submitted widening is unrepresentable: RaiseApprovalInput carries no scope (B-09b §1)", () => {
    // Widening exists ONLY on DecideApprovalInput — the human decision seam.
    // If RaiseApprovalInput ever grows a `scope`, this @ts-expect-error goes
    // unused and `pnpm typecheck` fails — the unrepresentability pin fires.
    const widenedRaise: RaiseApprovalInput = {
      app: "unit-app",
      role: "builder",
      rule: "outbound-network",
      action: { tool: "bash", input: { command: "curl https://example.com" } },
      // @ts-expect-error — agent raise seam has no grant-widening field
      scope: { kind: "app" },
    };
    void widenedRaise;
    expect(true).toBe(true);
  });

  it("decision status never carries execution facts: 'executed' is not an ApprovalStatus (INV-003 distinct-facts clause)", () => {
    // @ts-expect-error — execution states live on execution.state, never on status
    const status: ApprovalStatus = "executed";
    void status;
    expect(true).toBe(true);
  });
});

describe("CF-SM-APPR-I/R — transition-relation detector over the append-only log (L1, HB-011)", () => {
  it("accepts the product-writable chains (legal walk, disposition reconcile, retry re-arm)", () => {
    detectIllegalExecutionTransitions([
      // plain happy path
      transition("a1", "approved", "executing"),
      transition("a1", "executing", "executed"),
      // crash → ambiguous → human disposition
      transition("a2", "approved", "executing"),
      transition("a2", "executing", "ambiguous"),
      transition("a2", "ambiguous", "executed"),
      // failed → explicit retry re-arm → second attempt
      transition("a3", "approved", "executing"),
      transition("a3", "executing", "failed"),
      transition("a3", "failed", "approved"),
      transition("a3", "approved", "executing"),
      transition("a3", "executing", "executed"),
      // human terminalizes a legacy approved record (dispositionExecution)
      transition("a4", "approved", "executed"),
    ]);
    expect(true).toBe(true);
  });

  it("negative control: a seeded executed → executing re-perform makes the detector FIRE (INV-003: never resolved by re-performing)", () => {
    const seeded = [
      transition("bad1", "approved", "executing"),
      transition("bad1", "executing", "executed"),
      transition("bad1", "executed", "executing"),
    ];
    expect(() => detectIllegalExecutionTransitions(seeded)).toThrow(ApprovalTransitionViolation);
    expect(() => detectIllegalExecutionTransitions(seeded)).toThrow(/executed → executing/);
  });

  it("negative control: a seeded chain discontinuity (double-begin from a replayed claim) makes the detector FIRE", () => {
    const seeded = [
      transition("bad2", "approved", "executing"),
      transition("bad2", "approved", "executing"),
    ];
    expect(() => detectIllegalExecutionTransitions(seeded)).toThrow(/chain discontinuity/);
  });

  it("negative control: a seeded unknown state makes the detector FIRE instead of defaulting open", () => {
    expect(() =>
      detectIllegalExecutionTransitions([transition("bad3", "granted", "executing")]),
    ).toThrow(/unknown source state/);
  });
});

describe("CF-SM-APPR/GRANT identity — the authorization identity binds the exact bytes (L1, HB-011)", () => {
  it("changed payload bytes are a different authorization identity (INV-003 once-grant falsifier: changed bytes under the old approval)", () => {
    const writeA = { tool: "write", input: { file_path: "src/x.ts", content: "AAA" } };
    const writeB = { tool: "write", input: { file_path: "src/x.ts", content: "BBB" } };
    expect(actionHash(writeA)).not.toBe(actionHash(writeB));
    // Identity is stable for the same bytes — a retry of the identical action
    // is the same authorization, not a new one.
    expect(actionHash(writeA)).toBe(actionHash({ ...writeA }));
  });

  it("the execution identity binds the raw command literal: a post-decision env-prefix edit changes both hashes", () => {
    const approvedLiteral = "git push origin main --force";
    const editedLiteral = `env INJECTED=pwned ${approvedLiteral}`;
    expect(commandIdentityHash(approvedLiteral)).not.toBe(commandIdentityHash(editedLiteral));
    expect(
      actionHash({ tool: "bash", input: { command: approvedLiteral } }),
    ).not.toBe(actionHash({ tool: "bash", input: { command: editedLiteral } }));
  });
});

describe("CF-SM-GRANT-I — the never-broadly-scopeable set (L1 guardrail surface, HB-011)", () => {
  it("carries INV-003's ratified categories: production deploys, external publication, protocol-surface writes, and the gate's roots of trust", () => {
    // INV-003 shape (a): these actions only ever take the fresh, exact-content,
    // single-use form. Category → rule mapping per the product's own list:
    for (const rule of [
      "production-deploy", // production deploys
      // §5.3 split (#296, ratified 2026-08-06): external publication's
      // successors — verified own-repo collaboration left the set (the
      // headline budgeted case); everything irreversible stayed.
      "repo-collaboration-foreign",
      "package-publish",
      "release-artifact",
      "outbound-message",
      "protocol-self-edit", // protocol-surface writes
      "self-merge-or-approve", // review boundary (self-approval unrepresentable at any scope)
      "scorecard-tamper", // gate root of trust
      "approval-store-tamper", // gate root of trust
      "learning-publish", // one human decision = one content-hashed publish transaction
    ]) {
      expect(NEVER_SCOPEABLE_RULES).toContain(rule);
    }
  });

  it("stays anchored to live rule names: every never-scopeable classifier rule still exists in CRITICAL_RULES (drift guard)", () => {
    // A silent rename in gate.ts would orphan the never-scopeable entry and
    // quietly make the renamed rule widenable. `learning-publish` is the one
    // member that is not a classifier rule — it is raised directly by the
    // learning publisher (src/org/learning/publisher.ts) with that literal.
    const liveRuleNames = CRITICAL_RULES.map((rule) => rule.name);
    for (const rule of NEVER_SCOPEABLE_RULES) {
      // Not classifier rules: learning-publish is raised by the learning
      // publisher; repo-collaboration-foreign is assigned by the composed
      // gate's §5.3 target-verification refinement.
      if (rule === "learning-publish" || rule === "repo-collaboration-foreign") continue;
      expect(liveRuleNames).toContain(rule);
    }
  });

  // BLOCKED (candidate finding material — owner must decide, not encode):
  // INV-003 names "outside-worktree actions" as a fourth never-broadly-
  // scopeable category, but no gate rule is named for it and
  // NEVER_SCOPEABLE_RULES contains no mapping. The nearest live classes —
  // `destructive-or-irreversible` (rm on absolute/~/$HOME/parent-escape
  // targets) and `provider-global-memory` (writes outside every app boundary)
  // — are both absent from the list today, so a human CAN widen-scope them.
  // Whether that is (a) a product defect, (b) an intended reading where
  // "outside-worktree actions" means something narrower, or (c) a missing
  // dedicated rule, is not decidable from the ratified text. Do not add an
  // assertion either way until the owner rules (validation-policy.yaml
  // open_findings procedure).
});
