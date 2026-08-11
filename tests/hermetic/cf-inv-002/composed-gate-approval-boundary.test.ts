// Traceability: CF-INV-002 · HB-010 · invariants.md CORMIDIA-INV-002.

// CF-INV-002 — the gate is total, and every critical route meets the SAME
// approval boundary before execution. This exercises the composed org gate
// (src/org/gate-compose.ts) over the real classifier (src/runtime/gate.ts) and
// the role-shaping list (src/runtime/role-shaping.ts), on a REAL approval store.
// Two ratified outcomes, both "the effect never silently flows":
//   - a critical op with no grant and no role prohibition → deny + escalate,
//     and a durable pending approval item is raised (the human boundary);
//   - a role-forbidden critical op → flat deny with guidance, NO human decision
//     burned (the mechanical backstop that makes the attempt cost nothing).
// role-shaping.ts is the enforcement for the Codex/pi adapters, which have no
// per-command deny surface (capability-matrix degradation), so this is where
// INV-002's "all three adapters give identical guarantees" is anchored.
//
// Risk E-1 / T-1. Layer 2 — composed gate + real ApprovalStore on a temp dir;
// no provider, no network.
//
// Detector family = the composed-gate decision + the pending-item ledger.
// Negative control: a permissive baseGate lets the deploy through composeGate —
// proving the deny/escalation is the classifier's, not the composer's, and the
// assertions are load-bearing.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { composeGate } from "../../../src/org/gate-compose.js";
import { defaultGate } from "../../../src/runtime/gate.js";
import { FORBIDDEN_BY_ROLE } from "../../../src/runtime/role-shaping.js";
import type { GateDecision, GateFn, ToolAction } from "../../../src/runtime/types.js";

const bash = (command: string): ToolAction => ({ tool: "bash", input: { command } });
// A nested-shell deploy so this also proves obfuscation is de-wrapped BEFORE
// the compose layer's grant/role decisions (INV-002 seed a, at L2).
const NESTED_DEPLOY = bash("bash -c 'kubectl apply -f prod.yaml'");
const SELF_MERGE = bash("gh pr merge 7 --squash");
const PROVIDER_GLOBAL_WRITE: ToolAction = { tool: "write", input: { path: "~/.claude/CLAUDE.md" } };

describe("CF-INV-002 (composed gate / T-1) — every critical route meets the approval boundary (L2, HB-010)", () => {
  let root: string;
  let store: ApprovalStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cf-inv-002-approvals-"));
    store = new ApprovalStore(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const gateFor = (role: string): GateFn => composeGate(defaultGate, store, { app: "alpha", role });

  it("a critical op with no grant/role-prohibition denies, escalates, and raises ONE durable pending item", async () => {
    const decision = gateFor("planner")(NESTED_DEPLOY);
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.escalate).toBe(true);

    const pending = await store.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.rule).toBe("production-deploy");
    // The item carries structured effect evidence, never prose.
    expect(pending[0]?.classification?.rule).toBe("production-deploy");
    expect(pending[0]?.classification?.matchedAction.executables).toContain("kubectl");
  });

  it("a role-forbidden critical op is flat-denied with guidance and burns NO human decision", async () => {
    // self-merge-or-approve and production-deploy and provider-global-memory are
    // all forbidden for builder — each denies flat (escalate:false) and raises
    // no pending item (the whole point of role-shaping: don't spend a decision
    // on an attempt the protocol already forbids).
    expect(FORBIDDEN_BY_ROLE["builder"]).toContain("self-merge-or-approve");

    for (const action of [SELF_MERGE, NESTED_DEPLOY, PROVIDER_GLOBAL_WRITE]) {
      const decision = gateFor("builder")(action);
      expect(decision.allow).toBe(false);
      if (!decision.allow) {
        expect(decision.escalate).toBe(false);
        expect(decision.reason).toContain("forbidden for the builder role");
      }
    }
    expect(await store.listPending()).toHaveLength(0);
  });

  it("role-shaping is keyed on ROLE, not a constant: reviewer flat-denies a provider-global write; planner escalates a self-merge", async () => {
    // reviewer forbids provider-global-memory → flat deny.
    const reviewerDecision = gateFor("reviewer")(PROVIDER_GLOBAL_WRITE);
    expect(reviewerDecision.allow).toBe(false);
    if (!reviewerDecision.allow) expect(reviewerDecision.escalate).toBe(false);

    // planner has NO forbidden rules → the same class of critical op escalates
    // to a human item instead of flat-denying (proving the discriminator).
    const plannerDecision = gateFor("planner")(SELF_MERGE);
    expect(plannerDecision.allow).toBe(false);
    if (!plannerDecision.allow) expect(plannerDecision.escalate).toBe(true);

    const pending = await store.listPending();
    expect(pending.map((p) => p.rule)).toEqual(["self-merge-or-approve"]);
  });

  it("negative control: a permissive baseGate lets the deploy through composeGate (deny is the classifier's, not the composer's)", async () => {
    // Seed the violation: a weakened base gate. composeGate defers
    // classification/denial to it, so with a liar the critical op is ALLOWED and
    // no item is raised — which is exactly why the real-gate assertions above
    // are load-bearing (they would flip the instant the classifier were removed).
    const permissiveBase: GateFn = (_a: ToolAction): GateDecision => ({ allow: true });
    const decision = composeGate(permissiveBase, store, { app: "alpha", role: "planner" })(NESTED_DEPLOY);
    expect(decision.allow).toBe(true);
    expect(await store.listPending()).toHaveLength(0);
  });
});
