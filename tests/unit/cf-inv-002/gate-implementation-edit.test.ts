// CF-INV-002 — the `gate-implementation-edit` class (#296 Stage 2, proposal
// §4.2.1): the gate's own source is the machinery of consent. Before this
// class existed, an agent could edit the code that decides what requires
// approval (src/runtime/gate.ts), the code that stores and evaluates grants
// (src/org/approvals.ts), the grant-aware composition (src/org/gate-compose.ts),
// and the prose-authority layer (src/org/authority.ts) WITHOUT tripping any
// rule — while editing roles.yaml escalated. The declarative protocol was
// protected; its implementation was not.
//
// L1 — pure classifier assertions. Risk E-1 / T-1.

import { describe, expect, it } from "vitest";
import {
  CRITICAL_RULES,
  classify,
  decideDisposition,
  dispositionTierForRule,
} from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";

const GATE_IMPLEMENTATION_FILES = [
  "src/runtime/gate.ts",
  "src/org/approvals.ts",
  "src/org/gate-compose.ts",
  "src/org/authority.ts",
] as const;

function writeTool(path: string): ToolAction {
  return { tool: "write_file", input: { path, content: "// edited" } };
}

function shellInPlaceEdit(path: string): ToolAction {
  return { tool: "bash", input: { command: `sed -i 's/critical/routine/' ${path}` } };
}

function shellRestore(path: string): ToolAction {
  return { tool: "bash", input: { command: `git checkout -- ${path}` } };
}

describe("CF-INV-002 — gate-implementation-edit (§4.2.1): the classifier's own source is guarded", () => {
  for (const path of GATE_IMPLEMENTATION_FILES) {
    it(`an agent write to ${path} classifies critical and un-grantable (write tool, in-place edit, and write-shaped git restore)`, () => {
      for (const action of [writeTool(path), shellInPlaceEdit(path), shellRestore(path)]) {
        expect(classify(action), `${action.tool}: ${JSON.stringify(action.input)}`).toEqual({
          cls: "critical",
          rule: "gate-implementation-edit",
        });
        const disposition = decideDisposition(action);
        expect(disposition.tier).toBe("un-grantable");
      }
    });

    it(`reading ${path} stays routine — the class guards writes, not visibility`, () => {
      expect(classify({ tool: "read_file", input: { path } })).toEqual({ cls: "routine" });
      expect(classify({ tool: "bash", input: { command: `wc -l ${path}` } })).toEqual({ cls: "routine" });
      expect(classify({ tool: "bash", input: { command: `git diff -- ${path}` } })).toEqual({ cls: "routine" });
    });
  }

  it("writes to ordinary source files stay routine — the class is exactly the four gate files, not a source freeze", () => {
    for (const path of ["src/cli/approvals.ts", "src/loop/runRole.ts", "src/org/release.ts", "src/runtime/types.ts"]) {
      expect(classify(writeTool(path)), path).toEqual({ cls: "routine" });
    }
  });

  it("seeded negative control: WITHOUT the new class, no other rule sees an agent write to the gate's source — the §4.2.1 hole this class closes", () => {
    const legacyRules = CRITICAL_RULES.filter((rule) => rule.name !== "gate-implementation-edit");
    for (const path of GATE_IMPLEMENTATION_FILES) {
      for (const action of [writeTool(path), shellInPlaceEdit(path)]) {
        expect(
          legacyRules.some((rule) => rule.matches(action)),
          `${path} write must be invisible to every legacy rule`,
        ).toBe(false);
      }
    }
  });
});

describe("CF-INV-003 — Stage 2 ratified tier table (five tightenings + the new class)", () => {
  const STAGE2_TIERS: Record<string, ReturnType<typeof dispositionTierForRule>> = {
    "production-deploy": "human-only",
    // §5.1 split (#296, ratified 2026-08-06) replaced the destructive bucket.
    "destructive-remote-data": "human-only",
    "history-rewrite-owned": "budgeted",
    "history-rewrite-foreign": "human-only",
    "destructive-local": "grantable",
    "gh-api-unrecognized": "human-only",
    "dns-or-domain": "human-only", // tighten: was grantable
    // §5.2 split (#296, ratified) replaced secrets-or-auth.
    "secret-mutate": "human-only",
    "secret-read": "grantable",
    // §5.3 split (#296, ratified) replaced external-publishing. The foreign
    // class is a disposition rule the composed gate assigns, not a classifier
    // rule.
    "repo-collaboration": "budgeted",
    "repo-collaboration-foreign": "human-only",
    "package-publish": "human-only",
    "release-artifact": "human-only",
    "outbound-message": "human-only",
    "provider-global-memory": "grantable",
    // §5.4 (#296, ratified): undeterminable destinations fail closed.
    "outbound-network": "grantable",
    "outbound-network-undeterminable": "human-only",
    "self-merge-or-approve": "human-only",
    "protocol-self-edit": "un-grantable", // tighten: was human-only
    "scorecard-tamper": "un-grantable", // tighten: was human-only
    "learning-surface-tamper": "un-grantable", // tighten: was grantable
    "approval-store-tamper": "un-grantable", // tighten: was human-only
    "gate-implementation-edit": "un-grantable", // new class (§4.2.1)
    "learning-publish": "human-only", // non-classifier never-scopeable member
  };

  it("every classifier rule plus learning-publish carries its ratified Stage 2 tier", () => {
    expect(Object.keys(STAGE2_TIERS).sort()).toEqual(
      [...CRITICAL_RULES.map((rule) => rule.name), "learning-publish", "repo-collaboration-foreign"].sort(),
    );
    for (const [rule, tier] of Object.entries(STAGE2_TIERS)) {
      expect(dispositionTierForRule(rule), rule).toBe(tier);
    }
  });

  it("no tier is looser than the pre-Stage-2 mapping (tighten-only: the five moves all go up)", () => {
    const strictness = { routine: 0, budgeted: 1, grantable: 2, "human-only": 3, "un-grantable": 4 } as const;
    const PRE_STAGE2: Record<string, keyof typeof strictness> = {
      "production-deploy": "human-only",
      "destructive-or-irreversible": "grantable",
      "dns-or-domain": "grantable",
      "secrets-or-auth": "grantable",
      // §5.3 split (#296, ratified) replaced external-publishing. The foreign
    // class is a disposition rule the composed gate assigns, not a classifier
    // rule.
    "repo-collaboration": "budgeted",
    "repo-collaboration-foreign": "human-only",
    "package-publish": "human-only",
    "release-artifact": "human-only",
    "outbound-message": "human-only",
      "provider-global-memory": "grantable",
      "outbound-network": "grantable",
      "self-merge-or-approve": "human-only",
      "protocol-self-edit": "human-only",
      "scorecard-tamper": "human-only",
      "learning-surface-tamper": "grantable",
      "approval-store-tamper": "human-only",
      "learning-publish": "human-only",
    };
    for (const [rule, before] of Object.entries(PRE_STAGE2)) {
      expect(
        strictness[dispositionTierForRule(rule)],
        `${rule} must not loosen below ${before}`,
      ).toBeGreaterThanOrEqual(strictness[before]);
    }
  });
});
