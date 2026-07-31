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
//  2. The promoted HB-010 detector: `gh api` with a mutating method performs
//     an arbitrary GitHub mutation (including a self-merge) and used to
//     classify ROUTINE — CRITICAL_RULES enumerated gh subcommands only and
//     ghArguments never surfaced the HTTP method. Deposited 2026-07-31 as an
//     it.fails tripwire, promoted to a plain detector in the same change that
//     fixed src/runtime/gate.ts (ghApiVerbParts + ghApiRoutesTo): every
//     mutating `gh api` form now classifies critical under the tightest
//     existing rule, while GET/HEAD and method-less field-less reads stay
//     routine.

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

/** HB-010 (fixed 2026-07-31): the raw-API escape hatch. Every MUTATING
 *  `gh api` form — explicit method (`--method`/`-X`, any case, separate,
 *  `=`-joined, or glued) and the implicit-POST body forms (`-f`/`-F`/
 *  `--field`/`--raw-field`/`--input`) — classifies critical under the
 *  tightest existing rule for its endpoint: pulls/{n}/merge and …/reviews →
 *  self-merge-or-approve; releases/issues/comments → external-publishing;
 *  everything else (and all of graphql, fail closed) →
 *  destructive-or-irreversible. */
const API_MUTATIONS: ReadonlyArray<{ name: string; command: string; rule: string }> = [
  { name: "--method PUT pulls/*/merge (self-merge via raw API)", command: "gh api --method PUT repos/o/r/pulls/7/merge -f merge_method=squash", rule: "self-merge-or-approve" },
  { name: "-XPUT glued form on pulls/*/merge", command: "gh api -XPUT repos/o/r/pulls/7/merge", rule: "self-merge-or-approve" },
  { name: "-X POST pulls/*/reviews (review publish via raw API)", command: "gh api -X POST repos/o/r/pulls/7/reviews -f event=APPROVE", rule: "self-merge-or-approve" },
  { name: "-X POST releases (publication via raw API)", command: "gh api -X POST repos/o/r/releases -f tag_name=v1", rule: "external-publishing" },
  { name: "implicit POST via -f to issues (issue create, no --method at all)", command: "gh api repos/o/r/issues -f title=x", rule: "external-publishing" },
  { name: "-X DELETE git/refs (destructive raw mutation)", command: "gh api -X DELETE repos/o/r/git/refs/heads/x", rule: "destructive-or-irreversible" },
  { name: "lowercase -X delete (method matching is case-insensitive)", command: "gh api -X delete repos/o/r/git/refs/heads/x", rule: "destructive-or-irreversible" },
  { name: "--method=PATCH inline form on an unrecognized endpoint", command: "gh api --method=PATCH repos/o/r/git/refs/heads/x", rule: "destructive-or-irreversible" },
  { name: "implicit POST via --input (arbitrary payload to an unrecognized endpoint)", command: "gh api repos/o/r/statuses/deadbeef --input payload.json", rule: "destructive-or-irreversible" },
  { name: "graphql (fail closed: a read-only query is indistinguishable from a mutation)", command: "gh api graphql -f query='mutation { m }'", rule: "destructive-or-irreversible" },
];

/** The fix's blast-radius guard: `gh api` READS must stay routine (false
 *  positives are T-1 availability damage — agent turns poll these endpoints). */
const API_READS: ReadonlyArray<{ name: string; command: string }> = [
  { name: "bare GET (method-less, field-less)", command: "gh api repos/o/r/issues/1" },
  { name: "explicit --method GET on a mutation-shaped path", command: "gh api --method GET repos/o/r/releases" },
  { name: "HEAD merged-state poll on pulls/*/merge", command: "gh api -X HEAD repos/o/r/pulls/7/merge" },
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

  // === PROMOTED HB-010 DETECTOR (was the it.fails tripwire) ===
  // Deposited 2026-07-31 as a ratified-clause tripwire: `gh api --method PUT
  // repos/{o}/{r}/pulls/{n}/merge` performs a MERGE — a self-merge that
  // `self-merge-or-approve` catches via `gh pr merge` — yet reached GitHub by
  // the raw-API route and classified ROUTINE, contradicting INV-002 (the gate
  // must be total over "direct API calls" / adversarial seed c). Fixed the
  // same day in src/runtime/gate.ts: ghApiVerbParts projects every `gh api`
  // call as `api <method> <endpoint>` (explicit --method/-X in all spellings,
  // implicit-POST body forms, `unknown` fails closed) and ghApiRoutesTo sends
  // each mutating call to the tightest existing rule. Promoted per the
  // detector-deposit rule (AGENTS.md; policy case_sourcing): fix + detector in
  // one change.
  it.each(API_MUTATIONS)("mutating `gh api` route is critical: $name", ({ command, rule }) => {
    expect(classify(bash(command))).toEqual({ cls: "critical", rule });
    const decision = defaultGate(bash(command));
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.escalate).toBe(true);
  });

  it.each(API_READS)("`gh api` READ stays routine: $name", ({ command }) => {
    // Guards the fix's blast radius: making `gh api` mutations critical must
    // NOT sweep in read-only GET/HEAD calls (false positives are T-1
    // availability damage). Green before and after the fix.
    expect(classify(bash(command)).cls).toBe("routine");
  });

  it("covers the raw-API mutation class (no green by absence)", () => {
    expect(API_MUTATIONS.length).toBeGreaterThanOrEqual(10);
    expect(API_READS.length).toBeGreaterThanOrEqual(3);
  });

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
