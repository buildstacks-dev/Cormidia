# Approval & Release Boundary Amendment (Stage 5)

Status: ratified 2026-07-10 (docs/PURPOSE.md → Decided) and implemented —
A1 scoped grants (`src/org/approvals.ts`), A2 approve-and-rearm, A3 batch
review, A4 release handoff (`src/org/release.ts` + ship-gate P7 + approved
command execution), and A5 durable denial lessons are all live. Companion to `docs/proportionality-review.md`
§5 Stage 5; supersedes, where stated, parts of PURPOSE's 2026-07-04/06
approval decisions.

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

## A2 — Retry semantics: artifact-level continuation, ratified; same-pass
resume deferred

**Current:** "later retry — never auto-execution."

**Amended:** an escalation parks the pass with its durable-work state
(Stage 3's honest stop: `op:blocked` + evidence comment). The approval
decision gains an explicit **approve-and-rearm** option: deciding the item
may also swap the ticket `op:blocked → op:ready`, so the next tick
continues from durable artifacts (Stage 2 rehydration) with the grant in
force. The human decides once and the work resumes without a second manual
step. Deny keeps the ticket parked with the denial reason attached as
structured guidance (and a durable lesson — A5).

Literal same-pass suspend/resume of a live provider session remains
**deferred**: Claude and Codex expose session/thread resume, pi does not
expose an equivalent surface, and holding a suspended session across a
multi-hour human decision is a provider-lifecycle design none of the three
adapters has live-conformance proof for. Artifact-level continuation
captures most of the economic benefit (proportionality review, Stage 3
note). Revisit only with a per-adapter live conformance case.

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

## Answers to proportionality-review §6 (operator questions)

1. **Ticket budgets:** bootstrap ≤ 3 (default 1), growth ≤ 5, mature ≤ 7
   per milestone — enforced by plan validation (Stage 4, landed).
2. **Attempt cap:** claim cap N=3 per ticket, all tiers; the park digest is
   the escape hatch (Stage 2, landed).
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
