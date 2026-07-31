// CF-INV-002 — seed (c): a direct GitHub mutation / direct API call from a turn
// must meet the same gate as the recognized tool-channel verb (INV-002:
// "regardless of route: ... adapter-native tool formats, newly introduced
// provider tools, or direct API calls"; adversarial seed (c) "direct GitHub
// mutation from a turn bypassing the tool channel"). T-1 false-negative
// direction, risk E-1. L1 against the real product classifier.
//
// This file has two halves:
//  1. The recognized critical mutation routes that the product DOES catch —
//     a regression guard (green), so a future edit cannot silently drop one.
//  2. A ratified-clause TRIPWIRE (it.fails) for a route the product does NOT
//     catch today: `gh api` with a mutating method performs an arbitrary
//     GitHub mutation (including a self-merge) yet classifies routine. Per the
//     build contract, a product defect against a ratified clause is deposited
//     as an it.fails asserting the ratified behavior — GREEN while the defect
//     exists, RED (remove the tripwire) when src/runtime/gate.ts is fixed. See
//     defects[] in the report for file:line + repro.

import { describe, expect, it } from "vitest";
import { classify, defaultGate } from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";

const bash = (command: string): ToolAction => ({ tool: "bash", input: { command } });

/** Mutation routes the gate already covers — the recognized tool-channel verbs
 *  plus the raw-egress escape hatch. Each MUST classify critical under the
 *  named rule; this is the guard that keeps them covered. */
const CAUGHT_MUTATIONS: ReadonlyArray<{ name: string; command: string; rule: string }> = [
  { name: "gh pr merge (self-merge)", command: "gh pr merge 7 --squash", rule: "self-merge-or-approve" },
  { name: "gh pr review (self-approval publish channel)", command: "gh pr review 7 --comment -b ok", rule: "self-merge-or-approve" },
  { name: "gh release create (external publication)", command: "gh release create v1", rule: "external-publishing" },
  { name: "gh issue create (external publication)", command: "gh issue create -t x -b y", rule: "external-publishing" },
  { name: "gh workflow run (deploy trigger)", command: "gh workflow run deploy.yml", rule: "production-deploy" },
  { name: "raw HTTPS API mutation via curl (egress)", command: "curl -X POST https://api.github.com/repos/o/r/merges", rule: "outbound-network" },
];

/** The tool-name route (adapter-native GitHub op) — INV-002 "adapter-native
 *  tool formats". */
const CAUGHT_TOOL_ROUTES: ReadonlyArray<{ name: string; action: ToolAction; rule: string }> = [
  { name: "operon.github.issue.create tool", action: { tool: "operon.github.issue.create", input: { title: "x" } }, rule: "external-publishing" },
  { name: "operon.github.issue.comment tool", action: { tool: "operon.github.issue.comment", input: { body: "x" } }, rule: "external-publishing" },
];

describe("CF-INV-002 (seed c / T-1) — direct GitHub mutation routes meet the gate (L1, HB-010)", () => {
  it("covers the recognized mutation routes (no green by absence)", () => {
    expect(CAUGHT_MUTATIONS.length).toBeGreaterThanOrEqual(6);
    expect(CAUGHT_TOOL_ROUTES.length).toBeGreaterThanOrEqual(2);
  });

  it.each(CAUGHT_MUTATIONS)("recognized mutation route is critical: $name", ({ command, rule }) => {
    expect(classify(bash(command))).toEqual({ cls: "critical", rule });
    const decision = defaultGate(bash(command));
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.escalate).toBe(true);
  });

  it.each(CAUGHT_TOOL_ROUTES)("adapter-native GitHub tool route is critical: $name", ({ action, rule }) => {
    expect(classify(action)).toEqual({ cls: "critical", rule });
    expect(defaultGate(action).allow).toBe(false);
  });

  it("a `gh api` READ (default GET) is correctly routine — the tripwire below is about MUTATIONS only", () => {
    // Guards the fix's blast radius: whatever change makes `gh api` mutations
    // critical must NOT sweep in read-only `gh api` GETs (false positives are
    // T-1 availability damage). This stays green before and after the fix.
    expect(classify(bash("gh api repos/o/r/issues/1")).cls).toBe("routine");
  });

  // === RATIFIED-CLAUSE TRIPWIRE (product defect; see defects[] in the report) ===
  // `gh api` is the GitHub CLI's raw-API escape hatch. `gh api --method PUT
  // repos/{o}/{r}/pulls/{n}/merge` performs a MERGE — a self-merge that
  // `self-merge-or-approve` would catch via `gh pr merge`, but reaches GitHub
  // by the raw-API route and classifies ROUTINE (verified 2026-07-31). Same
  // hole for `gh api -X POST .../releases` (publish) and `gh api -X DELETE
  // .../git/refs/...` (destructive). This contradicts INV-002 — the gate must
  // be total over "direct API calls" and "direct GitHub mutation bypassing the
  // tool channel" (adversarial seed c) — and is a T-1 false negative
  // (authority damage). The tripwire asserts the RATIFIED expectation; it is
  // green (the body throws) while the defect stands, and flips red once
  // src/runtime/gate.ts classifies `gh api` mutating methods critical — the
  // signal to delete this tripwire and promote it to a plain detector.
  it.fails(
    "TRIPWIRE (INV-002 seed c): `gh api` with a mutating method is a direct GitHub mutation and MUST be critical (currently routine — DEFECT)",
    () => {
      // A self-merge performed through the raw API — the tool channel bypassed.
      const selfMergeViaApi = bash("gh api --method PUT repos/o/r/pulls/7/merge -f merge_method=squash");
      expect(classify(selfMergeViaApi).cls).toBe("critical");

      // Sibling routes with the same escape (documented so the fix covers the
      // whole class, not just PUT .../merge).
      expect(classify(bash("gh api -X POST repos/o/r/releases -f tag_name=v1")).cls).toBe("critical");
      expect(classify(bash("gh api -X DELETE repos/o/r/git/refs/heads/x")).cls).toBe("critical");
    },
  );

  // === PARKED — candidate finding, NOT encoded as truth ===
  // A direct `git push <remote> HEAD:<default-branch>` (or any push to the
  // resolved protected default) bypasses the reviewed-merge boundary (INV-009)
  // yet classifies routine — but the classifier cannot tell a legitimate
  // feature-branch push from a push-to-default without resolving the remote
  // default branch (src/loop/default-branch.ts), which is loop-level state the
  // pure classifier does not hold. Whether this belongs at the gate
  // (classifier) or a loop-level guard is a design question the docs do not
  // settle. BLOCKED: candidate F-PT (owner must decide the seam) — do NOT
  // encode a guess here. Reported in concerns[].
});
