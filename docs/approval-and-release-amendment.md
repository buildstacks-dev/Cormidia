# Approval & Release Boundary Amendment (Stage 5)

Status: ratified 2026-07-10 (docs/PURPOSE.md → Decided) and implemented —
A1 scoped grants (`src/org/approvals.ts`), A2 approve-and-rearm, A3 batch
review, A4 release handoff (`src/org/release.ts` + ship-gate P7 + approved
command execution), and A5 durable denial lessons are all live. Companion to
the 2026-07-10 proportionality Stage 5 work; supersedes, where stated, parts
of PURPOSE's 2026-07-04/06 approval decisions.

Approval efficiency and human-decision accounting use the canonical
definitions in `docs/efficiency.md`: approval precision and recurrence are
measured at the semantic action/scope level, and only authority- or
state-changing operator actions count as human decisions. This amendment owns
authorization behavior, not a separate efficiency budget.

## Why amend

The 2026-07-10 episode spent 42 recorded human decisions in one afternoon.
The safety design was right to exist and wrong in aim:

- 24 of 42 escalations were `secrets-or-auth` false positives on a
  credential-free repo `.npmrc`; the final $30 pass died fighting that rule.
- Grants are single-use action hashes, so the same human judgment was
  requested dozens of times for near-identical commands.
- An escalation kills the pass; approval buys a fresh restart, not a
  continuation — the human pays twice.
- Eight of fourteen denials were the *same denial* (global provider-memory
  writes) because no lesson carries between passes.
- Deploys are unowned: the ship pipeline ends at merge (RC4).

## A1 — Grant scope: human-chosen, rule+path-scoped, multi-use grants

**Current (ratified 2026-07-06):** approval = expiring, single-use,
action-hashed grant for a later retry.

**Amended:** the *default* stays exactly that. At decision time the human
may instead choose a wider scope — the agent never chooses:

- `once` — single-use action hash (default, unchanged).
- `ticket` — every action matching (rule, path prefix) for this app+ticket
  until expiry.
- `app` — every action matching (rule, path prefix) for this app until
  expiry.

Semantics: TTL default 24h (existing default), use-count cap default 20,
`operon approvals revoke <grant-id>` for immediate revocation, and **every
use** of a multi-use grant appends its own audit row (grant id, action
hash, timestamp) to `approvals/log.jsonl` — the audit trail stays
per-action even when the decision was per-scope.

**Never scopeable** (always one-by-one, always fresh): self-merge/approve,
production deploy, writes to human-ratified protocol surfaces, and any
action outside the app's own worktree/repo boundary.

Threat model: the widened grant is an *availability* concession bounded by
rule, path prefix, app, TTL, use count, and revocation; it cannot be minted
or widened by an agent (grants are written only by the human-facing CLI);
prompt-injected agents gain nothing — the gate still classifies every
action, and out-of-scope actions still escalate. The exfiltration-relevant
rules stay un-scopeable.

## A2 — Retry semantics: exact content-bound continuation, amended and
ratified 2026-07-18

**Current:** "later retry — never auto-execution."

**Amended:** an escalation parks the pass with its durable-work state
(Stage 3's honest stop: `op:blocked` + evidence comment). The approval
decision records the exact approved or denied outcome and atomically prepares
the parked ticket for the next claim projection. The next tick resumes the
same pipeline pass through its native provider session; it does not repeat
completed passes, setup, contract derivation, or the earlier portion of the
paused pass. Denial is distinct guidance to that same session and also remains
a durable A5 lesson. A decision is still authorization, never evidence that
the gated side effect executed; A2.1 acknowledgement remains unchanged.

The earlier deferral is lifted on evidence, not assumption. Claude, Codex,
and pi now expose native session resume (`docs/capability-matrix.md`), and the
retained final adapter calibration
`adapter-harness-calibration-v1-20260713-9c3b336d6842` qualified continuation
without retry. Resume is content-bound to the role/runtime, context manifest,
worktree state, completed-pass set, run, and human decisions. Any mismatch
fails closed before runtime construction. An approval pause never consumes a
new claim; its settled spend and zero repeated cost are recorded separately.

### A2.1 — Typed later delivery and acknowledgement, ratified 2026-07-18

The release executor proved the necessary distinction: a human decision is
authorization, not evidence that the action ran. That distinction now applies
to every approved item through a durable execution lifecycle:
`approved → executing → executed | failed | ambiguous`. Each transition records
the attempt, actor, result, remote reference when known, failure cause, and next
action. Generic provider tool calls remain `actor-retry`; they are not replayed
as arbitrary shell outside a provider session.

A later `operon dispatch` may execute only an explicit, typed,
orchestrator-owned allowlist. The first general actions are content-bound GitHub
issue create/comment operations; A4 retains its specialized release executor.
The executor claims the exact approved action, consumes its matching single-use
grant, searches for its stable remote idempotency marker, performs the effect
once, and persists acknowledgement. A crash after the remote response is
reconciled from that marker. A crash or API response whose effect cannot be
proved becomes `ambiguous`; dispatch never guesses and retries it. `operon
approvals disposition` is the explicit human reconciliation/retry boundary.

External publication joins `NEVER_SCOPEABLE_RULES`: a broad rule grant cannot
stand in for a durable record of the exact payload and its acknowledgement.
This is a deliberate tightening of A1, not a new outward-effect authority.
The SRE incident pipeline uses the typed issue-create action for critical/down
health events, with `op:incident`, source-event key, payload hash, and a stable
incident identity. Its local analysis may be complete while filing remains
pending, failed, or ambiguous; those claims are never collapsed.

## A3 — Batched same-rule decisions

**Current:** items reviewed strictly one by one.

**Amended:** `operon approvals review --batch` may group pending items with
identical (rule, app); the human decides the group in one action. Every
item still gets its own persisted decision record — the audit trail is
unchanged; only the human's keystrokes are batched. One-by-one remains the
default.

## A4 — Release ownership (RC4)

Every app declares its release mechanism in `.operon/config.yaml`:

```yaml
release:
  kind: deploy | package | merge-only
  command: <deploy command or CI workflow ref>   # required unless merge-only
  owner: orchestrator | sre
```

- **orchestrator** (default): after a squash-merge of a milestone whose plan
  declared a deploy disposition, the orchestrator triggers the declared
  mechanism as a **critical op** through the approval queue (a standing A1
  `app`-scoped grant may cover it once the human has ratified that scope).
- **sre**: the SRE role runs the deploy pipeline behind the same gate.
- Either way SRE owns post-deploy smoke checks and rollback (existing
  runbook assignment).
- P7 enforcement: a ship gate fails when the merged milestone's release
  disposition requires a mechanism the app does not declare — "deployable
  but unowned" is unfinished, mechanically.

Execution preserves A2's later-retry boundary: the approval decision only
mints the single-use grant. A later `operon dispatch` tick claims the approved
release. `owner: orchestrator` runs the exact command in the managed clone
with `CI=1`; `owner: sre` routes the exact command through one SRE role turn.
Both paths consume the grant, write an idempotent `releases/<approval>.json`
record, append a `kind: release` invocation row, and comment the ticket with
the terminal outcome. An ambiguous `running` record is never auto-retried.

## A5 — Denial lessons are durable

Every human denial reason is persisted as Operon-owned role memory for the
(app, role) pair and assembled into subsequent briefs, so the same denial
is never re-litigated eight times. Lessons are curated memory (existing OKF
rules apply: evidence attached, wrong lessons deleted).

## Answers to historical Stage 5 operator questions

1. **Ticket budgets:** bootstrap ≤ 3 (default 1), growth ≤ 5, mature ≤ 7
   per milestone — enforced by plan validation (Stage 4, landed).
2. **Attempt cap:** claim cap N=3 per ticket, all tiers; acquisition remains
   provisional until a provider turn starts, approval continuations retain the
   original claim number, and the park digest plus exact `operon loop rearm`
   command are mandatory on cap exhaustion. A label-only re-arm has no effect
   on the durable allowance.
3. **Approval semantics:** A1–A3 above.
4. **Plan pipeline depth:** stage-dependent — one-pass `plan-bootstrap` for
   new apps, five-pass `plan` for mature ones (Stage 4, landed).
5. **Release handoff:** orchestrator triggers the declared CI deploy after
   merge by default; SRE owns smoke/rollback; `owner: sre` available per
   app (A4).
6. **Benchmark fixture:** a disposable repository per run, created by a
   seed script from pinned inputs — deterministic, no state bleed, and the
   repo itself is evidence retained after the run.

## Regression requirements for Stage 6

- Gate tests: for every newly scopeable rule, a critical case (out-of-scope
  action under an active grant still escalates) and a routine near-miss
  (in-scope action passes without a new item). Never-scopeable rules get a
  case proving scope requests are rejected.
- Approval store: multi-use grant expiry, use-count exhaustion, revocation,
  and per-use audit rows.
- Release: ship gate fails on undeclared-mechanism deploy dispositions;
  deploy trigger is denied without an approval/grant.
- Calibration: credential-free repo `.npmrc` read/format passes routine; a
  `~/.npmrc` or env-file read still escalates; exfiltration-shaped commands
  (secrets to network sinks) still escalate at any scope.
- Capability shaping: Reviewer/Builder cannot *attempt* self-approval,
  deploy, or global provider-memory writes (tool/prompt surface removal),
  with conformance cases proving the attempts are unrepresentable, not
  merely denied.

## Implementation note — 2026-07-17 · content-bound grant identity (A-002)

> **Flagged for human review.** This note records an implementation change to
> the A1 grant mechanism made during architecture-review remediation
> (backlog P0-05, finding A-002). It does not alter the ratified A1–A5 design
> above; it corrects the *identity* an A1 grant authorizes. Ratify or amend.

The A1 grant's authorization identity (`actionHash`, `src/org/approvals.ts`)
was the *classification* projection reused verbatim — `normalizeSemanticAction`,
which deliberately discards the tool payload (a Write `content`, an Edit
`new_string`). Correct for classification (a doc that mentions `kubectl apply`
is not a deploy) but wrong as an authorization key: a human who approved
Write **X** thereby authorized Write **Y** on the same `(tool, path)` pair, and
because `findPendingEquivalentSync` deduplicated on the same identity, a
malicious raise silently collapsed into the benign item the human was reading.

The fix binds the payload into the identity only — classification stays
payload-blind. `actionHash` now hashes `{ v, semantic, payload }`: the
payload-free semantic projection, a content digest of the fields the projection
does not consume, and a format version `ACTION_IDENTITY_VERSION`. This mirrors
`src/org/learning/publisher.ts`'s `final_diff_hash` (sha256 over exact bytes),
already the repo's standard for content-bound approval. A different-content
raise now produces a distinct pending item, and a grant covers only the exact
bytes the human saw.

**Migration (human decision, 2026-07-17):** cancel in-flight grants the instant
the fix lands. Grants persist an `identityVersion`; `findMatchingGrantSync`
refuses any grant whose version is not current, so every pre-existing grant
(including A1 scoped grants, which match by rule/path rather than hash) stops
matching at once. The failure mode is a fresh approval item on the next gated
turn — the agent re-raises, the human re-approves — never a crash. Regression
coverage: `test/approval-semantics.test.ts` G-BIND-01…04 (distinct identity,
content-aware dedupe, payload-blind classification, and clean legacy-grant
re-raise).
