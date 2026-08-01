// CF-REG-204 — read-only git plumbing classifies as a READ, and every write
// against the same sensitive paths still classifies CRITICAL.
//
// Defect source: buildstacks-dev/Operon#204, found by the august-org live run
// 2026-08-01. The Reviewer ran the command that PROVES the secret-protection
// criterion —
//
//   git check-ignore .env.example; echo …; git check-ignore .env .env.local;
//   git status --ignored --porcelain -- .env.example 2>&1 | head
//
// — and the classifier recorded `operation: "write"`, matched
// `secrets-or-auth`, and queued an approval that blocked `operon app verify`
// at 16/17 checks green. Its own adjacent evidence fields contradicted it in
// the same record: `redirections: []`, `destination: null`, `effect: null`.
//
// Root cause: `check-ignore` was absent from `GIT_READ_SUBCOMMANDS`, so
// `mutatesFiles("git", …)` fell through to "not a known read ⇒ write", which
// makes `shell.writes` true, which makes the whole command a write. A second,
// latent instance: `gitSubcommand` took the first non-flag argument, so
// `git -C <dir> status` reported the subcommand as `<dir>` and every
// `-C`/`-c`-prefixed invocation classified as a write regardless of what it did.
//
// Why it mattered more than one blocked promotion: every approval raised in
// that run was a false positive from a read-only command. An approval queue
// that is mostly noise is one the human stops reading — which is the failure
// mode that makes a safety control actively harmful (T-1's stated asymmetry
// runs the other way for authority, but a gate nobody reads has no authority
// left to protect). And a Reviewer that learns its verification commands stall
// the pipeline verifies less, which degrades the single most valuable
// behaviour the run demonstrated.
//
// Traceability: INV-002 (the gate is total over critical effects) · control
// point T-1 (classification, false-NEGATIVE direction) · CF-INV-002.
// Registered in validation-design/case-catalog.md §10.
//
// LAYER: 1, against the real product classifier. No process, no state home.
//
// ORDER OF IMPORTANCE (AGENTS.md: never weaken a gate to make something pass):
// this change NARROWS what counts as a write, so the POSITIVE controls below —
// genuinely mutating commands against the very same sensitive paths — are the
// load-bearing half of this family. They are listed first and outnumber the
// negatives deliberately. If a future edit widens the read allowlist, these
// are what must fail.

import { describe, expect, it } from "vitest";
import { classify, defaultGate, normalizeSemanticAction } from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";

const bash = (command: string): ToolAction => ({ tool: "bash", input: { command } });

/** THE LOAD-BEARING HALF. Every one of these touches a path the read-only
 *  cases also touch, and every one must keep the classification it had before
 *  the narrowing — pinned as the exact `(operation, cls, rule)` triple.
 *
 *  The pin is a BASELINE, captured from `main` before this change and verified
 *  byte-identical after it. Some of these are `routine` today because no
 *  critical RULE covers their target (`git clean -fd`, `rm -rf .operon`,
 *  `git config` writes) — that is pre-existing rule coverage, unrelated to
 *  this fix, and pinning it here means any future widening OR weakening of
 *  those rules shows up as a deliberate edit to this table rather than as
 *  silent drift. What every row asserts unconditionally is `operation:
 *  "write"`: the narrowing must never turn a write into a read. */
const STILL_WRITES: ReadonlyArray<{
  name: string;
  command: string;
  cls: "critical" | "routine";
  rule: string | null;
}> = [
  // git subcommands that are NOT reports, against the same protocol/secret paths
  { name: "git checkout -- .gitignore (overwrites the file being 'read')", command: "git checkout -- .gitignore", cls: "routine", rule: null },
  { name: "git restore .operon/config.yaml", command: "git restore .operon/config.yaml", cls: "routine", rule: null },
  { name: "git apply on a protocol path", command: "git apply protocol.patch -- roles.yaml", cls: "critical", rule: "protocol-self-edit" },
  { name: "git clean -fd", command: "git clean -fd", cls: "routine", rule: null },
  { name: "git stash push -- .operon/config.yaml", command: "git stash push -- .operon/config.yaml", cls: "critical", rule: "protocol-self-edit" },

  // the conditional-read subcommands, in their WRITING forms
  { name: "git config sets a value (no --get/--list)", command: "git config user.email attacker@example.invalid", cls: "routine", rule: null },
  { name: "git config --unset", command: "git config --unset user.email", cls: "routine", rule: null },
  { name: "git config --add", command: "git config --add safe.directory /", cls: "routine", rule: null },
  { name: "git config --edit", command: "git config --edit", cls: "routine", rule: null },
  { name: "git remote add", command: "git remote add exfil https://attacker.example.invalid/r.git", cls: "routine", rule: null },
  { name: "git remote set-url", command: "git remote set-url origin https://attacker.example.invalid/r.git", cls: "routine", rule: null },
  { name: "git remote remove", command: "git remote remove origin", cls: "routine", rule: null },

  // the global-option fix must not let a write hide behind -C/-c/--git-dir
  { name: "git -C <dir> commit (write behind a global option)", command: "git -C /tmp/app commit -m x -- .operon/config.yaml", cls: "critical", rule: "protocol-self-edit" },
  { name: "git -c core.hooksPath=/tmp checkout -- .gitignore", command: "git -c core.hooksPath=/tmp checkout -- .gitignore", cls: "routine", rule: null },
  { name: "git --git-dir=/tmp/g checkout -- roles.yaml", command: "git --git-dir=/tmp/g checkout -- roles.yaml", cls: "critical", rule: "protocol-self-edit" },

  // a read PROGRAM in a command that nonetheless writes
  { name: "read program with a real redirection into a secret path", command: "git check-ignore .env > .env.local", cls: "critical", rule: "secrets-or-auth" },
  { name: "read program piped into a mutating one", command: "git status --porcelain | tee .operon/config.yaml", cls: "critical", rule: "protocol-self-edit" },
  { name: "read program alongside rm", command: "git check-ignore .env; rm -rf .operon", cls: "routine", rule: null },
  { name: "sed -i against a protocol file (mutating flag beats the allowlist)", command: "sed -i 's/x/y/' roles.yaml", cls: "critical", rule: "protocol-self-edit" },
  { name: "find -delete against the scaffold", command: "find .operon -name '*.yaml' -delete", cls: "routine", rule: null },
  { name: "command substitution smuggling a secret read", command: "git commit -m \"$(cat .env)\"", cls: "critical", rule: "secrets-or-auth" },
];

/** The narrowing itself: read-only plumbing is classified a READ, and — where
 *  no rule matches on other grounds — raises no approval. Each is verbatim or
 *  minimally reduced from the two approval records the live run produced.
 *
 *  NOT included here: commands that name a bare `.env`. Those still match
 *  `secrets-or-auth`, which is a pure TEXT rule and deliberately operation-
 *  blind. Whether a metadata-only query that never opens the file (`git
 *  check-ignore .env`) should count as a secrets op is a product-truth
 *  question, opened as **F-PT-019** and parked — not guessed at here. See the
 *  BLOCKED case at the end of this file. */
const NOW_ROUTINE_READS: ReadonlyArray<{ name: string; command: string }> = [
  {
    name: "the exact protocol-self-edit record that blocked promotion (#204, 20260801T083514Z-r3qm)",
    command:
      "git check-ignore .gitignore; find . -name .operon; " +
      "grep -n secret_locations .operon/config.yaml; git config --get user.name",
  },
  { name: "git check-ignore -v on a scaffold path", command: "git check-ignore -v .gitignore" },
  { name: "git check-attr on a protocol path", command: "git check-attr diff -- roles.yaml" },
  { name: "git config --get on a protocol-adjacent key", command: "git config --get remote.origin.url" },
  { name: "git config --list", command: "git config --list" },
  { name: "git remote get-url origin", command: "git remote get-url origin" },
  { name: "git remote -v", command: "git remote -v" },
  { name: "git -C <dir> status (global option before the subcommand)", command: "git -C /tmp/app status --porcelain" },
  { name: "git -c color.ui=false diff -- .operon/config.yaml", command: "git -c color.ui=false diff -- .operon/config.yaml" },
  { name: "git merge-base --is-ancestor", command: "git merge-base --is-ancestor origin/HEAD HEAD" },
  { name: "git rev-list --count", command: "git rev-list --count HEAD" },
  { name: "grep over the scaffold", command: "grep -rn secret_locations .operon/config.yaml" },
  { name: "find without an acting predicate", command: "find .operon -name '*.yaml'" },
];

describe("CF-REG-204 — read-only git plumbing is a read; writes on the same paths stay critical (#204, INV-002/T-1)", () => {
  it("covers both halves (no green by absence), positives weighted heaviest", () => {
    expect(STILL_WRITES.length).toBeGreaterThanOrEqual(20);
    expect(NOW_ROUTINE_READS.length).toBeGreaterThanOrEqual(12);
    // The rule this file exists to defend: narrowing a gate must never leave
    // fewer positive controls than negatives.
    expect(STILL_WRITES.length).toBeGreaterThan(NOW_ROUTINE_READS.length);
    // And the narrowing must be defended where it bites: at least half the
    // positive controls are genuinely critical today.
    expect(STILL_WRITES.filter((row) => row.cls === "critical").length).toBeGreaterThanOrEqual(8);
  });

  // --- positive controls: the gate did not get weaker -------------------

  it.each(STILL_WRITES)("POSITIVE CONTROL — still a write: $name", ({ command }) => {
    // The unconditional invariant. `operation` is what the narrowing touched,
    // and turning any of these into a read would be the weakening.
    expect(normalizeSemanticAction(bash(command)).operation, command).toBe("write");
  });

  it.each(STILL_WRITES)("POSITIVE CONTROL — classification unchanged: $name", ({ command, cls, rule }) => {
    const classification = classify(bash(command));
    expect(classification.cls, command).toBe(cls);
    expect(classification.rule ?? null, command).toBe(rule);
  });

  it("every escalating positive control still escalates through the gate itself", () => {
    for (const row of STILL_WRITES.filter((candidate) => candidate.cls === "critical")) {
      const decision = defaultGate(bash(row.command));
      expect(decision.allow, row.command).toBe(false);
      if (!decision.allow) expect(decision.escalate, row.command).toBe(true);
    }
  });

  // --- the narrowing ----------------------------------------------------

  it.each(NOW_ROUTINE_READS)("read-only plumbing raises no approval: $name", ({ command }) => {
    expect(classify(bash(command)).cls, command).toBe("routine");
    expect(defaultGate(bash(command)).allow, command).toBe(true);
  });

  it.each(NOW_ROUTINE_READS)("read-only plumbing is classified a read: $name", ({ command }) => {
    expect(normalizeSemanticAction(bash(command)).operation, command).toBe("read");
  });

  it("the classifier no longer contradicts its own evidence fields", () => {
    // The record that made the approval unreviewable on its face: `write`
    // beside `redirections: []`, `destination: null`, `effect: null`.
    const semantic = normalizeSemanticAction(bash("git check-ignore -v .env .env.local"));
    expect(semantic.operation).toBe("read");
    expect(semantic.destination).toBeNull();
    expect(semantic.effect).toBeNull();
  });

  // BLOCKED:F-PT-019 — the second half of #204's promotion block.
  //
  // `secrets-or-auth` is a pure TEXT rule: any command mentioning a bare
  // `.env` matches, whatever the operation. So the reviewer's command still
  // classifies critical AFTER this fix, even though it is now correctly a
  // READ and never opens the file — `git check-ignore` consults the ignore
  // rules, not the blob.
  //
  // Whether a metadata-only query naming a secret path is a secrets op is the
  // product owner's call, not this change's: narrowing it would weaken a gate
  // that also catches `cat .env`, `git show HEAD:.env`, and `grep -r . .env`.
  // Opened as F-PT-019; this case PINS today's behaviour so the finding cannot
  // be resolved silently in either direction.
  it("BLOCKED:F-PT-019 — a metadata-only query naming a secret path still classifies critical (pinned, not endorsed)", () => {
    // The SECOND of the two approvals that blocked promotion. Unlike the
    // protocol-self-edit record above, this one is NOT resolved by the
    // operation fix: `secrets-or-auth` is a pure TEXT rule over the projected
    // effect fields, so `.env.example` appearing in `targets` matches whatever
    // the operation is.
    //
    // Whether a metadata-only query that never opens the file (`git
    // check-ignore`, `git status --ignored`) is a secrets op is the product
    // owner's call, not this change's: narrowing the rule would also loosen it
    // for `cat .env`, which is a genuine exfiltration read. Opened as
    // F-PT-019. This case PINS today's behaviour so the finding cannot be
    // resolved silently in either direction.
    const command =
      'git check-ignore .env.example; echo "plain check-ignore exit: $?"; ' +
      "git check-ignore .env .env.local; " +
      "git status --ignored --porcelain -- .env.example 2>&1 | head";
    expect(classify(bash(command))).toEqual({ cls: "critical", rule: "secrets-or-auth" });
    // What the fix DID achieve on this command: it is no longer reported as a
    // write, so it no longer also trips protocol-self-edit.
    expect(normalizeSemanticAction(bash(command)).operation).not.toBe("write");
  });
});
