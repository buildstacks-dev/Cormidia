# Approvals and release execution

*The authoritative contract for the human approval queue, grants, approved
later execution, and app release ownership. CLI queue decided 2026-07-04;
Stage 5 amendments A1–A5 ratified 2026-07-10; continuation and typed delivery
(A2/A2.1) ratified 2026-07-18; content-bound grant identity (A-002)
implemented 2026-07-17; uniform fresh approval for every app release clarified
2026-08-02; synchronous suspension, pending-item expiry, agent decision
authority, and an operation-aware `secrets-or-auth` ratified 2026-08-03
(PURPOSE v2.15, resolving F-PT-019 and F-PT-020) — ratification history in
`docs/PURPOSE.md` → Decided.
Approval efficiency and human-decision accounting use the canonical
definitions in `docs/episodes/contract.md`: approval precision and recurrence are
measured at the semantic action/scope level, and only authority- or
state-changing operator actions count as human decisions. This contract owns
authorization behavior, not a separate efficiency budget. The system map is
[`../architecture.md`](../architecture.md) §4.*

## The queue

The classifier reads Cormidia's own command line as an effect surface, not just
third-party tools: `cormidia app reset`/`prune-runs` are
`destructive-remote-data` (since the #296 §5.1 split), `cormidia org init|use|upgrade` is
`protocol-self-edit`, `cormidia plan ratify-ticket-budget` and `cormidia bootstrap
publish` are `external-publishing`, and `cormidia approvals
review|revoke|disposition` is `approval-store-tamper` — self-approval by CLI is
still self-approval. Read-only invocations (`roles`, `apps`, `status`,
`doctor`, `budget`, `context`, `episode explain`, `approvals show|status`)
stay routine.

`secrets-or-auth` is **operation-aware and fails closed** (PURPOSE v2.15,
F-PT-019). The rule classifies on whether an action actually emits file
contents, not on text alone, and any command whose effect cannot be parsed is
treated as critical. Text-only matching was wrong in both directions at once:
`git check-ignore .env` opens nothing and classified critical (#204), while
`git show HEAD:.env` prints the secret and classified routine (#218). The
directions are not symmetric — `validation-design/system-map.md` §5.2: a real
critical effect classified routine is authority damage, a false positive is
only availability damage — so the fail-closed default on unparsed effects is
part of the contract, not an implementation detail. Classification must also
cover effects that bypass the gate entirely rather than merely evading a
pattern: an adapter that auto-runs a trusted read-only command set without
routing it through `hooks.gate` (#20) defeats the rule regardless of how the
rule is written.

### Storage (`~/.cormidia/<org>/approvals/`)

```
pending/<id>.json     one file per open item
decided/<id>.json     moved here on decision (decision fields merged in)
grants/<grantId>.json grants created by approvals (single-use by default;
                      the human may widen to ticket/app scope at decision time)
execution-locks/      per-item claim locks for sanctioned later executors
log.jsonl             append-only audit trail (raised, decided, grant uses,
                      and execution transitions)
```

Plain files, no database: one human decision consumer, with per-item locks for
concurrent dispatch executors; survives the droplet migration as a directory
copy, and TASTE §3 (boring dependencies). `id = <utc-compact-timestamp>-<rand4>`.

Item schema:

```jsonc
{
  "id": "20260704T193201Z-8k2f",
  "app": "civic", "role": "builder", "turnId": "…", "ticketRef": "#42",
  "workdir": "/…/worktrees/civic/op-42",  // sandbox cwd the action was raised
                                          // from; the context a later
                                          // orchestrator execution runs in
  "rule": "secrets-or-auth",              // gate rule that fired
  "action": { "tool": "Bash", "input": "…", "description": "…" },
  "classification": {                     // effect fields only; no prose
    "schemaVersion": 1, "rule": "secrets-or-auth", "reason": "…",
    "matchedAction": { "executables": ["cat"], "targets": [".env"] }
  },
  "justification": "…",                   // the model's stated intent, from turn events
  "raisedAt": "…", "status": "approved",
  "execution": {
    "state": "approved",                  // not evidence the effect happened
    "executor": "orchestrator-command | durable-github | release | actor-retry",
    "idempotencyKey": "…", "attempts": 0, "nextAction": "dispatch"
  }
}
```

### Flow

1. Gate denies-and-escalates; the adapter surfaces the denial; the item is
   persisted to `pending/` at collection time (`blocked_on_gate` when the
   primary artifact is unreachable). **The raising turn suspends and waits**
   (PURPOSE v2.15) — an approval is raised synchronously, not as an
   after-the-fact notification the turn ships past. Suspension uses the same
   pause and resume machinery as the budget soft cap: one mechanism, two
   triggers. A turn therefore cannot outlive the approval it raised, and an
   approval cannot outlive its turn.
2. A decision is taken via CLI. **Approve ≠ execute.** Approval mints an
   action-hashed grant (default scope `once`; the decider may widen to
   ticket/app with TTL/cap/revoke). Self-merge, production deploy, external
   publication, and protocol-surface writes are never scopeable.
3. Next tick re-dispatches when escalations are decided; the effective gate is
   grant lookup then default rules. Deny reasons become durable lessons.
4. Later dispatch executes only typed orchestrator-owned allowlisted actions
   (`durable-github`, `release`, `orchestrator-command`), records
   `approved → executing → executed|failed|ambiguous`, and never blindly
   retries ambiguity. Grant scopes, binding, and disposition are contracted below; ratification
   history is `docs/PURPOSE.md` → Decided.

### Pending-item lifetime (F-PT-020)

Grant TTL and expiry govern authority **after** a decision. This governs an item
that was never decided.

The state machine `CF-SM-APPR` has a terminal, non-blocking `expired` state.
An undecided item reaches it after a TTL — default 24h, matching the existing
grant TTL, resolved through ordinary policy configuration rather than a source
constant.

On expiry:

- the raising turn's durable artifacts and worktree are **preserved**;
- its claim is **released**;
- the turn resolves as **blocked, not failed** — a pause is not a merit
  failure, and it does not consume a failure claim (the rule established for
  granted approval pauses in #104);
- the item **leaves the pending queue** and appears in an audit view;
- `cormidia app verify` counts only approvals whose raising turn is still live,
  so an expired or orphaned item is never a promotion blocker.

Why this is a contract clause and not a detail: while the only exit from
`pending` was a human decision, the queue grew monotonically by construction.
In the 2026-08-01 live run 7 of 7 items outlived their turns and were the sole
reason promotion was blocked, and clearing them forced 7 meaningless denials
into the decision ledger — degrading the artifact the queue exists to produce.

### Who may decide

An **agent operating an org may decide ordinary approvals** (PURPOSE v2.15). An
agent decision is a first-class, attributable decision recorded against a
distinct agent identity and never presented as a human one, so an unattended
org can drain its own queue and the packaged `$cormidia` skill can operate an
org without a TTY.

The `NEVER_SCOPEABLE_RULES` set is the boundary: self-merge/approve, production
deploy, external publication, writes to human-ratified protocol surfaces, and
any action outside the app's own worktree/repo boundary **require a human
decision** and remain ineligible for a widened grant. PURPOSE v2.13's rule that
the org can never approve its own release is unchanged, and is now enforced
through this boundary rather than through the absence of a decision path.

Since the #296 Stage 2 tightenings (2026-08-06) the set is **derived from the
per-rule disposition tiers** (`RULE_DISPOSITION_TIERS`, `src/runtime/gate.ts`):
every rule whose tier is `human-only` or `un-grantable` is never scopeable and
never agent-decidable, which adds DNS/domain changes (`dns-or-domain`), the
learning governance surfaces (`learning-surface-tamper`), and the gate's own
source (`gate-implementation-edit` — writes to `src/runtime/gate.ts`,
`src/org/approvals.ts`, `src/org/gate-compose.ts`, `src/org/authority.ts`;
reads stay routine, and the files remain changeable through the human-driven
reviewed PR path, which never routes through this gate). The #296 §5.1 split
(ratified 2026-08-06) further adds `destructive-remote-data`,
`history-rewrite-foreign`, and `gh-api-unrecognized` as human-only members,
while `history-rewrite-owned` (force-push confined to the orchestrator-owned
`op/<issue>-…` namespace) is the one ratified `budgeted` class: it proceeds at
the composed gate with a per-action audit row — bounded by a covering
objective grant's uses/ledger when one exists (grantless accounting quantum:
F-PT-024) — and the retired `destructive-or-irreversible` name keeps a
grantable tombstone so stale items never loosen. `un-grantable` is the
stricter tier: no standing grant of any kind may ever cover it — the store
refuses to mint a widened grant for it AND refuses to honor a standing grant
found on disk for it (defense in depth in `findMatchingGrantSync`), while the
fresh, exact, single-use, per-instance human approval path is unchanged. Every
Stage 2 move is a tightening; the proposal's loosening splits are not landed
and require ratification first.

Every decision — human or agent — records the deciding identity, a non-empty
reason, and an audit row. A reason equal to a bare decision token is rejected
rather than stored.

### CLI

```
cormidia approvals              pending table plus approved executions that
                              still need acknowledgement (app-tagged)
cormidia approvals review       one-by-one: full item, then [a]pprove (with
                              optional scope: `a ticket [path]` / `a app
                              [path]`) / [d]eny (reason required) / [s]kip;
                              approving may also re-arm the parked ticket
                              (op:blocked → op:ready) so the next tick
                              continues from artifacts
cormidia approvals review --batch   group pending items with identical
                              (rule, app); one decision, per-item audit rows
cormidia approvals show <id>    full detail incl. turn-event context
cormidia approvals status       decision/execution state, attempts, actor,
                              result, remote reference, and next action
cormidia approvals decide <id> (--approve|--deny) --reason <text>
                              --by <identity> --confirm <id> [--json]
                              [--scope ticket|app [path]]
                              non-interactive decision; the only decision path
                              available without a TTY
cormidia approvals disposition <id> (--executed|--failed|--retry)
                              --reason <text> --confirm <id>
                              explicit reconciliation for failed/ambiguous work
cormidia approvals revoke <grant-id>   immediate revocation of a live grant
```

`review` is interactive and requires a terminal; without a TTY it refuses and
names `decide` rather than silently skipping every item. `decide` is the
non-interactive path and carries the same scope options `review` offers. Both
require an identity (`--by`) and a non-empty reason; a reason equal to a bare
decision token is a line-protocol mistake and is rejected, never stored.

Decision writes materialize the grant before the decision log and atomic item
move, so a logged approval cannot lack its authorization file; log-vs-file
reconciliation repairs an interrupted move or missing grant at the next
`cormidia approvals` run. Execution item rewrites are atomic and transition rows
remain append-only evidence. Concurrent decisions on one item are serialized:
exactly one caller wins and the loser receives an already-decided conflict
before any grant or decision event is written.

Budget escalations (`../architecture.md` §7) enter this same queue as synthetic
items — one inbox, never two. Two rules, because they answer different questions
about different subjects:

- `budget-exceeded` — the APP-MONTHLY ceiling, keyed
  `budget-exceeded:<app>:<YYYY-MM>`. One item per app per month.
- `turn-budget-exceeded` — ONE parked provider turn whose per-turn (soft-ring)
  cap fired while its episode could still afford another turn. Keyed
  `turn-budget:<app>:<ticket>:<episode>:<run>:<pass>`, so re-raising for the
  same parked turn converges on the existing item instead of minting a second —
  a crash between the durable pause and the queue write is expected, and the
  pause is written first (the F-PT-003 ordering). The item carries the stop
  dimension, what was spent, what the episode still allows, and a
  **resume-cost estimate** derived from the parked turn's observed
  cache-read/cache-creation tokens: a human approving more spend is told how
  much of it re-establishes context before any new work happens. A turn that
  reported no cache split yields `unavailable` — an honest absence, never a
  modelled number.

The ticket/episode HARD ceiling stops with no escalation offered and raises no
item. That asymmetry is what bounds the mechanism: without it, suspend → grant →
suspend has no bound.

Approving a `turn-budget-exceeded` item resumes the exact parked session.
Denying it terminalizes the ticket at `op:returned`, because there is nothing to
resume with and resuming would start a paid turn that re-suspends on the same
cap. Neither outcome consumes a failure claim (#104): a pause is not a merit
failure.

## Suppressed critical operations (#244)

A critical operation the turn asked for and did not get is recorded against the
ticket and surfaced in that turn's verdict. Since v2.15 (1) a gate denial
suspends rather than shipping past, exactly two dispositions remain reachable:

- `denied` — a human decided against it; the turn resumes without the operation.
- `expired` — nobody decided within the TTL; the turn resolves blocked with its
  artifacts preserved (v2.15 (2)).

The record carries the rule, the action's canonical authorization identity
(`actionHash`), the tool, the disposition, and the deciding reason. It lives on
the ticket's cross-claim state rather than on a run, because the turn that ASKED
and the turn that REPORTS are different turns: the decision lands while the
asking turn is parked, and the resumed turn is the one that publishes a verdict.

Every verdict renders the section unconditionally — a turn that suppressed
nothing renders `- None recorded.`, because a missing heading is
indistinguishable from an older verdict that never checked. This is a **record,
not a gate**: whether a verdict may still report PASS with declared evidence
missing is #234's decision.

Budget escalations are exempt. A turn that ran out of money suppressed no
critical operation, and recording one would turn the #244 record from "declared
evidence is missing" into "something went wrong".

## Grant scope (A1): human-chosen, rule+path-scoped, multi-use grants

The default remains the 2026-07-06 decision: approval mints an expiring,
single-use, action-hashed grant for a later retry. At decision time the human
may instead choose a wider scope — the agent never chooses:

- `once` — single-use action hash (default, unchanged).
- `ticket` — every action matching (rule, path prefix) for this app+ticket
  until expiry.
- `app` — every action matching (rule, path prefix) for this app until
  expiry.

Semantics: TTL default 24h (existing default), use-count cap default 20,
`cormidia approvals revoke <grant-id>` for immediate revocation, and **every
use** of a multi-use grant appends its own audit row (grant id, action
hash, timestamp) to `approvals/log.jsonl` — the audit trail stays
per-action even when the decision was per-scope.

**Never scopeable** (always one-by-one, always fresh): self-merge/approve,
production deploy, writes to human-ratified protocol surfaces, any action
outside the app's own worktree/repo boundary — and, since the #296 Stage 2
tightenings, DNS/domain changes, the learning governance surfaces, and the
gate's own implementation files (see "Who may decide"). These are also the
rules an agent may not decide — never-scopeable and human-decided are the same
set, derived from the disposition tiers, so widening authority and delegating
authority are bounded by one fact rather than two lists that can drift apart.

Threat model: the widened grant is an *availability* concession bounded by
rule, path prefix, app, TTL, use count, and revocation; it cannot be minted
or widened by an agent (grants are written only by the human-facing CLI);
prompt-injected agents gain nothing — the gate still classifies every
action, and out-of-scope actions still escalate. The exfiltration-relevant
rules stay un-scopeable.

## Grant identity is content-bound (A-002)

*Implemented 2026-07-17 during architecture-review remediation (backlog
P0-05, finding A-002); migration decided by the human the same day. It does
not alter the ratified A1–A5 design; it corrects the identity an A1 grant
authorizes.*

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

## Continuation after a decision (A2): exact content-bound resume

*Amended and ratified 2026-07-18.*

An escalation parks the pass with its durable-work state
(Stage 3's honest stop: `op:blocked` + evidence comment). The approval
decision records the exact approved or denied outcome and atomically prepares
the parked ticket for the next claim projection. The next tick resumes the
same pipeline pass through its native provider session; it does not repeat
completed passes, setup, contract derivation, or the earlier portion of the
paused pass. Denial is distinct guidance to that same session and also remains
a durable A5 lesson. A decision is still authorization, never evidence that
the gated side effect executed; A2.1 acknowledgement remains unchanged.

The earlier deferral is lifted on evidence, not assumption. Claude, Codex,
and pi now expose native session resume (`docs/harness/capability-matrix.md`), and the
retained final adapter calibration
`adapter-harness-calibration-v1-20260713-9c3b336d6842` qualified continuation
without retry. Resume is content-bound to the role/runtime, context manifest,
worktree state, completed-pass set, run, and human decisions. Any mismatch
fails closed before runtime construction. An approval pause never consumes a
new claim; its settled spend and zero repeated cost are recorded separately.

## Typed later delivery and acknowledgement (A2.1)

*Ratified 2026-07-18.*

The release executor proved the necessary distinction: a human decision is
authorization, not evidence that the action ran. That distinction now applies
to every approved item through a durable execution lifecycle:
`approved → executing → executed | failed | ambiguous`. Each transition records
the attempt, actor, result, remote reference when known, failure cause, and next
action. Generic provider tool calls remain `actor-retry`; they are not replayed
as arbitrary shell outside a provider session.

A later `cormidia dispatch` may execute only an explicit, typed,
orchestrator-owned allowlist. The first general actions are content-bound GitHub
issue create/comment operations; A4 retains its specialized release executor.
The executor claims the exact approved action, consumes its matching single-use
grant, searches for its stable remote idempotency marker, performs the effect
once, and persists acknowledgement. A crash after the remote response is
reconciled from that marker. A crash or API response whose effect cannot be
proved becomes `ambiguous`; dispatch never guesses and retries it. `cormidia
approvals disposition` is the explicit human reconciliation/retry boundary.

External publication joins `NEVER_SCOPEABLE_RULES`: a broad rule grant cannot
stand in for a durable record of the exact payload and its acknowledgement.
This is a deliberate tightening of A1, not a new outward-effect authority.
The SRE incident pipeline uses the typed issue-create action for critical/down
health events, with `op:incident`, source-event key, payload hash, and a stable
incident identity. Its local analysis may be complete while filing remains
pending, failed, or ambiguous; those claims are never collapsed.

## Batched same-rule decisions (A3)

`cormidia approvals review --batch` may group pending items with
identical (rule, app); the human decides the group in one action. Every
item still gets its own persisted decision record — the audit trail is
unchanged; only the human's keystrokes are batched. One-by-one remains the
default.

## Release ownership and execution (A4)

Every app declares its release mechanism in `.cormidia/config.yaml`:

```yaml
release:
  kind: deploy | package | merge-only
  owner: orchestrator | sre
  trigger: tag | command                          # deploy/package only; default tag
  command: <deploy command or CI workflow ref>    # required for trigger: command
```

**How the release fires (`trigger`):**

- `tag` (default when no `command` is declared): the milestone declares a
  `Release-version` (a `vX.Y.Z` trailer alongside `Release-kind`), and on merge
  Cormidia derives a governed git tag push —
  `git tag vX.Y.Z … && git push origin refs/tags/vX.Y.Z` — as the release
  command. The app's deploy workflow listens on `push: tags`, so **only** the
  approved release fires it; ordinary pushes (a PR merge, `cormidia app promote`)
  never do. The declared version is validated to a strict `vX.Y.Z` shape before
  it reaches the shell, so it cannot inject command syntax. P7 fails a tag
  milestone that declares no valid `Release-version`.
- `command`: the pre-tag mechanism — Cormidia runs the app's declared `command`
  after merge. Inferred when a `command` is present without an explicit
  `trigger`, so pre-trigger apps keep working unchanged.
- `branch`: planned; rejected at config load until implemented.

Because the tag push *is* a command, it flows through the identical approval,
grant, and execution machinery below — there is no separate release path.
For an RQ-1 package tag, that recorded command is an internal content reference to
the canonical post-merge attestation digest, not a plain `git tag` string. After the
human decision, the typed executor creates the attributable release-approval record,
embeds both records in the annotated tag, and runs `git tag`/`git push` without a
shell. A missing or modified attestation refuses before grant consumption. Other
declared tag mechanisms retain the ordinary derived command above.

- **orchestrator** (default): after a squash-merge of a milestone whose plan
  declared a deploy disposition, the orchestrator triggers the declared
  mechanism as a **critical op** through the approval queue. Every release
  requires its own fresh, content-bound, single-use human approval; production
  deploy and external publication are never eligible for a widened ticket- or
  app-scoped grant.
- **sre**: the SRE role runs the deploy pipeline behind the same gate.
- Either way SRE owns post-deploy smoke checks and rollback (existing
  runbook assignment).
- P7 enforcement: a ship gate fails when the merged milestone's release
  disposition requires a mechanism the app does not declare — "deployable
  but unowned" is unfinished, mechanically.

Execution preserves A2's later-retry boundary: the approval decision only
mints the single-use grant. A later `cormidia dispatch` tick claims the approved
release. `owner: orchestrator` runs the exact command in the managed clone
with `CI=1`; `owner: sre` routes the exact command through one SRE role turn.
Both paths consume the grant, write an idempotent `releases/<approval>.json`
record, append a `kind: release` invocation row, and comment the ticket with
the terminal outcome. An ambiguous `running` record is never auto-retried.

## Objective grants (#296 Stage 3)

An **ObjectiveGrant** (`src/org/objective-grants.ts`) is durable, human-created
standing authority bound to an *objective* rather than a candidate commit:
when the candidate moves, evidence expires but the objective's authority does
not (docs/DEVELOPMENT.md). Storage is
`~/.cormidia/<org>/approvals/objective-grants/` — one JSON per grant, one
append-only spend ledger per grant, one audit log. Inert until a human creates
one: with no grant on disk the composed gate is byte-identical to the
pre-objective gate.

- **Created only by the human-facing CLI** (`cormidia objective grant`),
  exactly like A1 grants; an agent-namespaced identity is rejected at
  creation, and the gate classifies `cormidia objective
  grant|grant-critical|revoke` from inside a turn as `approval-store-tamper`.
- **Coverage follows the disposition tiers.** Ordinary grants name
  `grantable`-tier classes explicitly (never a wildcard, never an unknown
  rule). A `human-only` class is coverable only through the **§4.1 ceremony**:
  the distinct `grant-critical` verb, exactly one class per invocation, a
  required bounded scope, an optional precondition, and TTL/use caps strictly
  shorter than the ordinary defaults (24h/20, mirroring A1). An
  `un-grantable` class is **rejected at creation, always**, and a forged
  grant file naming one is additionally refused at use.
- **The spend ceiling is the backstop** (proposal §7): every debit lands
  before execution under a per-grant file lock; a debit that would cross the
  ceiling is refused (never silently absorbed) and raises **one**
  `objective-budget-exceeded` queue item keyed `objective-budget:<grantId>`,
  converging on re-raise like `turn-budget-exceeded`. The ceiling default is
  configured, never hardcoded — `objective_budget_usd` resolves through
  apps.yaml with the same default/override path as `budget_usd_month` — and
  is raisable only by a human editing the grant. An exhausted or revoked or
  use-capped grant covers nothing, so covered actions fall back to the
  ordinary escalation path.
- **Every use appends a per-use audit row** (grant id, rule, action hash), so
  the owner can always reconstruct what their grant actually authorized.
  Revocation (`cormidia objective revoke`) is immediate.
- `composeGate` consults objective grants exactly where an A1 grant would
  have covered the action (after single-use/scoped grant lookup); the
  campaign manifest remains the content-bound, single-use object for *what
  will be executed* — both, not either.

## Denial lessons are durable (A5)

Every human denial reason is persisted as Cormidia-owned role memory for the
(app, role) pair and assembled into subsequent briefs, so the same denial
is never re-litigated eight times. Lessons are curated memory (existing OKF
rules apply: evidence attached, wrong lessons deleted).

## Standing bounds ratified with Stage 5

- **Ticket budgets per milestone:** bootstrap ≤ 3 (default 1), growth ≤ 5,
  mature ≤ 7 — enforced by plan validation.
- **Claim cap:** N=3 per ticket, all tiers; acquisition remains provisional
  until a provider turn starts, approval continuations retain the original
  claim number, and cap exhaustion requires the park digest plus the exact
  `cormidia loop rearm` command. A label-only re-arm has no effect on the
  durable allowance.
- **Plan pipeline depth is stage-dependent:** one-pass `plan-bootstrap` for
  new apps, five-pass `plan` for mature ones.
- **Benchmark fixture:** a disposable repository per run, created by a seed
  script from pinned inputs — deterministic, no state bleed, and the repo
  itself is retained evidence.

## Why the surface is shaped this way (Stage 5 forensics)

The Stage 5 amendment exists because the 2026-07-10 episode spent 42 recorded human decisions in one afternoon.
The safety design was right to exist and wrong in aim; every rule below traces to one of these:

- 24 of 42 escalations were `secrets-or-auth` false positives on a
  credential-free repo `.npmrc`; the final $30 pass died fighting that rule.
- Grants are single-use action hashes, so the same human judgment was
  requested dozens of times for near-identical commands.
- An escalation kills the pass; approval buys a fresh restart, not a
  continuation — the human pays twice.
- Eight of fourteen denials were the *same denial* (global provider-memory
  writes) because no lesson carries between passes.
- Deploys are unowned: the ship pipeline ends at merge (RC4).

## Standing regression requirements

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
