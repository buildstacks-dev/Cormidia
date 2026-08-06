// CF-INV-002/CF-INV-003 — Stage 1 of the consequence-classification plan
// (docs/approvals/consequence-classification-implementation-plan.md): the
// decideDisposition mechanism must reproduce today's gate decisions EXACTLY.
//
// Two detectors:
//  1. A table over all 12 classifier rules, each with a fixture action that
//     really classifies under it, asserting the disposition tier each rule has
//     today — with the expectation DERIVED from NEVER_SCOPEABLE_RULES, so a
//     membership change cannot silently drift past this table.
//  2. A bounded-deterministic fast-check property: for ANY generated action,
//     the disposition is never looser than today's classification, agrees
//     with classify() on rule identity, and defaultGate's decision follows the
//     tier with the exact escalation reason format ruleFromReason() parses.
//
// L1 — pure assertions over the classifier; no store, no IO. Risk E-1 / T-1.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CRITICAL_RULES,
  classify,
  decideDisposition,
  defaultGate,
  dispositionTierForRule,
  NEVER_SCOPEABLE_RULES,
  type DispositionTier,
} from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";

type ToolActionLike = ToolAction;

/** Strictness order for the loosening guard. A LOWER index is looser; Stage 1
 *  may never move an action to a lower index than today's classification
 *  gives it (proposal §10: "no input yields a tier looser than today's"). */
const TIER_STRICTNESS: readonly DispositionTier[] = [
  "routine",
  "budgeted",
  "grantable",
  "human-only",
  "un-grantable",
];

function strictness(tier: DispositionTier): number {
  const index = TIER_STRICTNESS.indexOf(tier);
  if (index === -1) throw new Error(`unknown tier ${tier}`);
  return index;
}

/** The ratified oracle: classify() plus the RATIFIED_TIERS table (F-PT-023,
 *  #296). Before the ratified §5 splits this was derived from
 *  NEVER_SCOPEABLE_RULES membership alone; the table now IS the ratified
 *  baseline, so any implementation tier below it is a loosening this property
 *  exists to catch — and the single ratified budgeted case is named in the
 *  table rather than special-cased here. */
function todayTier(action: ToolActionLike): DispositionTier {
  const classification = classify(action);
  if (classification.cls === "routine") return "routine";
  const ratified = RATIFIED_TIERS[classification.rule ?? ""];
  if (ratified !== undefined) return ratified;
  return NEVER_SCOPEABLE_RULES.includes(classification.rule ?? "")
    ? "human-only"
    : "grantable";
}

/** The ratified per-rule tiers after the Stage 2 tightenings (#296; plan
 *  Stage 2 table plus §4.2.1). This literal is an independent pin of the
 *  ratified mapping — if the implementation's table drifts, this fails. */
const RATIFIED_TIERS: Readonly<Record<string, DispositionTier>> = {
  "production-deploy": "human-only",
  // §5.1 split (#296, F-PT-023 ratified 2026-08-06): the grantable
  // destructive bucket became four tightened classes plus the one ratified
  // budgeted case (the orchestrator-owned op/<issue> force-push namespace).
  "destructive-remote-data": "human-only",
  "history-rewrite-owned": "budgeted",
  "history-rewrite-foreign": "human-only",
  "destructive-local": "grantable",
  "gh-api-unrecognized": "human-only",
  "dns-or-domain": "human-only",
  "secrets-or-auth": "grantable",
  "external-publishing": "human-only",
  "provider-global-memory": "grantable",
  "outbound-network": "grantable",
  "self-merge-or-approve": "human-only",
  "protocol-self-edit": "un-grantable",
  "scorecard-tamper": "un-grantable",
  "learning-surface-tamper": "un-grantable",
  "approval-store-tamper": "un-grantable",
  "gate-implementation-edit": "un-grantable",
};

/** One fixture per classifier rule, each verified below to actually classify
 *  under the rule it names — a fixture that drifts to another rule fails the
 *  table, so the table cannot silently test the wrong thing. */
const RULE_FIXTURES: ReadonlyArray<{ rule: string; action: ToolActionLike }> = [
  { rule: "production-deploy", action: { tool: "bash", input: { command: "kubectl apply -f k8s/deploy.yaml" } } },
  { rule: "destructive-remote-data", action: { tool: "bash", input: { command: "truncate -s 0 /var/db/audit.log" } } },
  { rule: "history-rewrite-owned", action: { tool: "bash", input: { command: "git push --force origin op/7-fix" } } },
  { rule: "history-rewrite-foreign", action: { tool: "bash", input: { command: "git push --force origin main" } } },
  { rule: "destructive-local", action: { tool: "bash", input: { command: "rm -rf /var/data/exports" } } },
  { rule: "gh-api-unrecognized", action: { tool: "bash", input: { command: "gh api -X DELETE repos/o/r/git/refs/heads/x" } } },
  { rule: "dns-or-domain", action: { tool: "write_file", input: { path: "dns/nameserver.conf", content: "ns1.example.com" } } },
  { rule: "secrets-or-auth", action: { tool: "bash", input: { command: "cat .env" } } },
  { rule: "external-publishing", action: { tool: "bash", input: { command: "npm publish --access public" } } },
  { rule: "provider-global-memory", action: { tool: "write_file", input: { path: "/Users/dev/.claude/CLAUDE.md", content: "memo" } } },
  { rule: "outbound-network", action: { tool: "bash", input: { command: "curl https://example.com/data.json" } } },
  { rule: "self-merge-or-approve", action: { tool: "bash", input: { command: "gh pr merge 7 --squash" } } },
  { rule: "protocol-self-edit", action: { tool: "edit_file", input: { path: "roles.yaml", new_string: "builder: {}" } } },
  { rule: "scorecard-tamper", action: { tool: "write_file", input: { path: "scorecards/builder.json", content: "{}" } } },
  { rule: "learning-surface-tamper", action: { tool: "write_file", input: { path: "learning/policy.yaml", content: "{}" } } },
  { rule: "approval-store-tamper", action: { tool: "write_file", input: { path: "approvals/grants/grant-1.json", content: "{}" } } },
  { rule: "gate-implementation-edit", action: { tool: "edit_file", input: { path: "src/org/authority.ts", new_string: "// edited" } } },
];

describe("CF-INV — disposition table (every classifier rule, ratified tiers)", () => {
  it("covers the classifier's exact rule set — a rule added or renamed without a table row fails here", () => {
    expect(CRITICAL_RULES.map((rule) => rule.name).sort()).toEqual(
      RULE_FIXTURES.map((fixture) => fixture.rule).sort(),
    );
    expect(RULE_FIXTURES).toHaveLength(17);
  });

  for (const { rule, action } of RULE_FIXTURES) {
    it(`${rule}: fixture classifies under its own rule and resolves to today's tier`, () => {
      const classification = classify(action);
      expect(classification).toEqual({ cls: "critical", rule });

      // The ratified expectation, coupled to the A1 boundary: NEVER_SCOPEABLE
      // membership must be exactly the human-only ∪ un-grantable tiers, so
      // the set and the tier table cannot drift apart (budgeted and grantable
      // classes are the widenable, agent-decidable side of the boundary).
      const expected: DispositionTier = RATIFIED_TIERS[rule]!;
      expect(NEVER_SCOPEABLE_RULES.includes(rule)).toBe(
        expected === "human-only" || expected === "un-grantable",
      );
      const disposition = decideDisposition(action);
      expect(disposition.tier).toBe(expected);
      if (disposition.tier === "routine") throw new Error("unreachable: fixture classified critical");
      expect(disposition.rule).toBe(rule);
      expect(disposition.evidence.rule).toBe(rule);
      expect(disposition.evidence.schemaVersion).toBe(1);
      // Stage 1 measures none of the three consequence questions yet; the
      // conservative unknown branch is the only honest value.
      expect(disposition.consequence).toEqual({
        reversibility: "unknown",
        blastRadius: "unknown",
        cost: { kind: "unknown" },
      });
    });
  }

  it("maps the never-scopeable member outside the classifier (learning-publish) to human-only", () => {
    expect(NEVER_SCOPEABLE_RULES).toContain("learning-publish");
    expect(dispositionTierForRule("learning-publish")).toBe("human-only");
  });

  it("is total over arbitrary rule names with today's membership semantics: a non-member stays grantable (the exact NEVER_SCOPEABLE_RULES.includes() behavior)", () => {
    for (const rule of ["critical-op", "budget-exceeded", "turn-budget-exceeded", "some-future-rule"]) {
      expect(NEVER_SCOPEABLE_RULES).not.toContain(rule);
      expect(dispositionTierForRule(rule)).toBe("grantable");
    }
  });

  it("routine action: no rule, routine tier, unknown consequence", () => {
    const disposition = decideDisposition({ tool: "bash", input: { command: "wc -l AGENTS.md" } });
    expect(disposition.tier).toBe("routine");
    expect("rule" in disposition).toBe(false);
    expect(disposition.consequence).toEqual({
      reversibility: "unknown",
      blastRadius: "unknown",
      cost: { kind: "unknown" },
    });
  });

  it("threads a caller-supplied covering grant id through verbatim", () => {
    expect(decideDisposition({ tool: "bash", input: { command: "git status" } }, { grantId: "grant-x" }).grantId)
      .toBe("grant-x");
    expect(decideDisposition({ tool: "bash", input: { command: "npm publish" } }, { grantId: "grant-y" }).grantId)
      .toBe("grant-y");
    expect(decideDisposition({ tool: "bash", input: { command: "git status" } }).grantId).toBeUndefined();
  });

  it("is total over malformed input shapes (pure, never throws)", () => {
    const weird: ToolActionLike[] = [
      { tool: "bash", input: undefined },
      { tool: "bash", input: null },
      { tool: "", input: 42 },
      { tool: "unknown_tool", input: [1, 2, 3] },
      { tool: "bash", input: { command: "" } },
      { tool: "bash", input: { command: "if [ -f x ]; then\n" } },
      { tool: "write_file", input: { path: 7 } },
    ];
    for (const action of weird) {
      const disposition = decideDisposition(action);
      expect(TIER_STRICTNESS).toContain(disposition.tier);
      expect(strictness(disposition.tier)).toBeGreaterThanOrEqual(strictness(todayTier(action)));
    }
  });
});

// ---------------------------------------------------------------------------
// Property: bounded deterministic generation (policy L1 lane: "vitest +
// fast-check (bounded deterministic seeds)"). Commands are assembled from
// benign and critical fragments so the walk crosses every rule family and
// their compositions; the seed is pinned so the walk is reproducible.
// ---------------------------------------------------------------------------

const BENIGN_COMMANDS = [
  "git status",
  "wc -l AGENTS.md",
  "ls -la src",
  "grep -n TODO src/cli.ts",
  "pnpm test",
  "gh pr view 7",
  "git diff -- README.md",
];

const CRITICAL_COMMANDS = [
  "kubectl apply -f k8s/deploy.yaml",
  "git push --force origin op/7-fix",
  "cat .env",
  "npm publish",
  "curl https://example.com",
  "gh pr merge 7 --squash",
  "gh issue comment 12 --body ok",
  "rm -rf /tmp/scratch",
  "printenv",
  "gh api --method PUT repos/o/r/pulls/7/merge",
];

const PATH_POOL = [
  "README.md",
  "src/index.ts",
  "roles.yaml",
  "scorecards/builder.json",
  "learning/policy.yaml",
  "approvals/grants/grant-1.json",
  "dns/nameserver.conf",
  "/Users/dev/.claude/CLAUDE.md",
  "notes/plan.md",
];

const actionArb: fc.Arbitrary<ToolActionLike> = fc.oneof(
  fc
    .record({
      fragments: fc.array(fc.constantFrom(...BENIGN_COMMANDS, ...CRITICAL_COMMANDS), {
        minLength: 1,
        maxLength: 3,
      }),
      wrap: fc.constantFrom("none", "zsh-lc", "if"),
    })
    .map(({ fragments, wrap }) => {
      const joined = fragments.join(" && ");
      const command =
        wrap === "zsh-lc"
          ? `/bin/zsh -lc '${joined.replaceAll("'", "")}'`
          : wrap === "if"
            ? `if ${joined}; then echo ok; fi`
            : joined;
      return { tool: "bash", input: { command } };
    }),
  fc
    .record({
      tool: fc.constantFrom("write_file", "edit_file", "read_file"),
      path: fc.constantFrom(...PATH_POOL),
      content: fc.constantFrom("hello", "kubectl apply", "secrets? no — prose only"),
    })
    .map(({ tool, path, content }) => ({ tool, input: { path, content } })),
  fc.constantFrom<ToolActionLike>(
    { tool: "structuredoutput", input: { verdict: "we should deploy to production" } },
    { tool: "unknown_tool", input: {} },
  ),
);

describe("CF-INV — Stage 1 disposition property (no input decides looser than today)", () => {
  const params: fc.Parameters<[ToolActionLike]> = { seed: 20260806, numRuns: 500 };

  it("agrees with classify() on rule identity, never loosens, and drives defaultGate identically", () => {
    fc.assert(
      fc.property(actionArb, (action) => {
        const classification = classify(action);
        const disposition = decideDisposition(action);

        // Rule identity parity.
        if (classification.cls === "routine") {
          expect(disposition.tier).toBe("routine");
        } else {
          if (disposition.tier === "routine") throw new Error("critical action decided routine");
          expect(disposition.rule).toBe(classification.rule);
          expect(disposition.evidence.rule).toBe(classification.rule);
        }

        // The loosening guard: strictness may only stay equal (Stage 1) or
        // grow (later ratified tightenings) — never shrink.
        expect(strictness(disposition.tier)).toBeGreaterThanOrEqual(strictness(todayTier(action)));

        // defaultGate is a pure projection of the tier, with the exact reason
        // format ruleFromReason() in gate-compose.ts parses: `(rule)`.
        const decision = defaultGate(action);
        if (disposition.tier === "routine") {
          expect(decision).toEqual({ allow: true });
        } else {
          expect(decision).toEqual({
            allow: false,
            escalate: true,
            reason: `critical op (${disposition.rule}) requires human approval`,
          });
        }

        // Pure and deterministic: a second call returns an equal value.
        expect(decideDisposition(action)).toEqual(disposition);
      }),
      params,
    );
  });
});
