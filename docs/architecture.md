# Operon Architecture

*v0 draft — 2026-07-04. The design layer docs/PURPOSE.md deliberately does not
hold. docs/PURPOSE.md → Decided is upstream and authoritative; this document adds
the detail needed to implement the remaining roadmap. §11 records decisions
ratified into docs/PURPOSE.md on 2026-07-06; future new decisions should be
proposed here first, then promoted only after human ratification.*

## 0. Overview

```
launchd (now) / systemd timer (droplet later)
      │  fires every ~5 min
      ▼
operon dispatch  ── reads ──►  roles.yaml · apps.yaml · schedule state · events
      │
      │  for each due (role, app): acquire lock, start turn
      ▼
turn runner (src/org)
      │  assembles context (TASTE layers + memory) ── §5
      │  creates/reuses worktree ── §3
      ▼
runtime adapter (claude | codex | pi)          src/runtime
      │  every tool action → GateFn ── critical ops denied + escalated
      ▼
artifacts land on GitHub (issues, PRs, comments, merges)
escalations land in the CLI approval queue ── §4
telemetry / memory / scorecard events written at turn end ── §6
```

**How the dispatcher "decides":** there is no planning intelligence in the
tick — *deciding is computing what is due*. The model is fully asynchronous:
every ~5 minutes a stateless tick merges roles.yaml triggers with apps.yaml
overrides, checks schedule state ("is the Planner's `daily 08:00` unfired
today?"), polls GitHub for new events ("is there a fresh `op:ready`
ticket?"), starts a detached turn for each due (role, app), and exits.

A worked tick: the Builder has been running a long turn since yesterday —
its lock heartbeat is fresh, so the tick skips that (role, app) and the turn
simply continues (turns outlive ticks, §2). Meanwhile a newly due event
starts an unrelated turn in parallel, up to the org WIP limit.

Newer work never assumes older work finished, for two structural reasons:

1. **State derives from artifacts, not intentions** (§3): a ticket is
   reviewable only when its PR actually exists; a PR ships only when an
   APPROVE review and green gates actually exist. Unfinished work presents
   no artifact, so dependent steps simply are not due yet — nothing infers
   completion from elapsed time or from a task having been scheduled.
2. **Dependencies gate readiness** (`docs/loop.md` §8): a ticket with
   `Depends-on: #N` becomes due only when #N is *merged*; tickets whose
   declared file scopes overlap are never scheduled concurrently.

Module placement respects the one-way import rule
(`src/org` → `src/loop` → `src/runtime`):


| Component                                               | Module                                                         | Notes                                   |
| ------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------- |
| Dispatcher, schedule state, event polling, locks        | `src/org/dispatch.ts`                                          | new                                     |
| App registry (`apps.yaml` loader)                       | `src/org/apps.ts`                                              | new                                     |
| Context assembler                                       | `src/org/context.ts`                                           | new                                     |
| Approval queue + grants                                 | `src/org/approvals.ts`                                         | new                                     |
| OKF memory read/write                                   | `src/org/memory.ts`                                            | new                                     |
| Retro + scorecards                                      | `src/org/retro.ts`                                             | new                                     |
| Ticket state machine                                    | `src/loop/loop.ts`                                             | skeleton; full design in `docs/loop.md` |
| Pass executor, brief assembler, quality gates, verdicts | `src/loop/pipeline.ts`, `brief.ts`, `qgates.ts`, `verdicts.ts` | new — `docs/loop.md`                    |
| Pass prompt templates + pipeline config                 | `prompts/`, `pipelines.yaml` (org home)                        | new — human-ratified protocol surfaces  |
| Runtime contract, gate, telemetry, adapters             | `src/runtime/`                                                 | exists                                  |


The gate stays a pure `GateFn` in `src/runtime`; the org layer *composes* the
effective gate for a turn (default rules + grant lookup, §4) and passes it
down through `TurnHooks`. The runtime layer never imports approval storage.

## 1. On-disk layout

Three homes, one rule: **durable, curated artifacts live in git; high-churn
operational state lives gitignored under** `~/.operon/` (docs/PURPOSE.md v0.8).

### Org home (this repo, for now)

```
TASTE.md                 org constitution (human-ratified)
roles.yaml               org chart (human-ratified)
apps.yaml                app registry (§7) — new
taste/<role>.md          role craft addenda (roadmap item 10)
memory/roles/<role>/     per-role craft bundles, cross-app (§6)
skills/                  promoted skills (Agent Skills standard)
retro/<date>.md          weekly retro notes (§6)
docs/architecture.md     this file
```



### App repo (target product repo)

```
.operon/
  TASTE.md               app charter ("what this product is; what good means")
  config.yaml            this app's registry entry (same schema as apps.yaml)
  policy.yaml            app-owned quality-gate policy emitted by bootstrap
  memory/<role>/         per-(role, app) domain bundles
  org/                   single-app profile ONLY: org-level artifacts
                         (org TASTE.md, roles.yaml, apps.yaml, taste/, memory/)
                         — same layout as org-home root, so graduation to an
                         org-home repo is `git mv .operon/org/* <org-home>/`
```

`.operon/org/` is a refinement of PURPOSE v0.8's wording ("identical layout
inside `.operon/` and at an org-home root"): the org-level artifacts get their
own subdirectory so they never collide with the app-level `TASTE.md` and
`memory/` that exist in *both* profiles. Flagged in §11.

**Containment invariant.** Operon's entire footprint in an app repo lives
under `.operon/` — plus the transient GitHub surface (`op/*` branches,
`op:*` labels) that closes out as work merges. Nothing Operon-specific is
scattered through the app's source tree, so contributors who don't run
Operon can ignore exactly one directory — the same social contract as
`.github/` or `.vscode/`. Under that invariant the directory is safe to
keep in the app repo regardless of whether the Operon tool itself is ever
open-sourced or stays private: it holds app-owned configuration and memory
(which a reader may freely see — it documents how the app is managed),
never tool source. One consequence: if Operon is published, the
`.operon/config.yaml` schema becomes a public contract, so it carries a
`schema_version` field from day one. Flagged in §11.

### Runtime state (`~/.operon/<org>/`, outside git entirely)

```
repos/<app>/             org-managed clone per app (worktree source, §3)
worktrees/<app>/<branch>/
state/schedule.json      last-fired per (role, app, trigger)
state/events/            consumed-event keys (dedup) + file-drop event inbox
state/turns/<turnId>.json  turn journals (§3)
locks/<app>--<role>.lock
approvals/               pending/ decided/ grants/ log.jsonl (§4)
sessions/                adapter session artifacts where the SDK needs a home
telemetry/<day>.jsonl    exists today (src/runtime/telemetry.ts orgDir)
scorecards/<app>/<role>.jsonl  raw scorecard events (§6)
```

The org id `<org>` comes from org-home config (default: repo name). Note
`~/.operon` is not TCC-protected on macOS, unlike `~/Documents` — launchd
jobs can read it freely (same reasoning that keeps repos at `~/Build`).

## 2. Dispatcher & scheduler

**Model: stateless tick, not a daemon.** launchd (`StartInterval: 300`) runs
`operon dispatch` every ~5 minutes; systemd timer does the same on the
droplet. Each tick reads config + state, computes what is due, starts turns,
exits. No daemon to supervise; a wedged host resumes on the next tick;
migration is "install the timer" (docs/PURPOSE.md: dispatcher is a plain CLI
entrypoint any scheduler can call). Cadence is flexi — ticks run at all hours
(decided 2026-07-04).

### Trigger resolution

For each app with `status: live`, for each role, merge `roles.yaml` triggers
with the app's cadence overrides (§7), then evaluate:

**Schedule triggers.** Grammar (already in roles.yaml): `hourly`,
`every <N>h|m`, `daily HH:MM`, `weekly <dow> [HH:MM]` (default 09:00). Local
host time. A trigger is due when `now ≥ next(lastFired, spec)`;
`state/schedule.json` keys `(app, role, trigger)` → last-fired timestamp,
written only after the turn actually starts. Missed windows (laptop asleep)
collapse to **one** firing — no backfill.

**Event triggers.** v1 is **polling, not webhooks** — the laptop has no
public ingress. Each tick polls GitHub (via `gh`/REST) per live app:


| roles.yaml event  | Poll                                                               | Stable dedup key            |
| ----------------- | ------------------------------------------------------------------ | --------------------------- |
| `ticket-ready`    | issues labeled `op:ready`                                          | `ticket-ready:<issue>`      |
| `pr-opened`       | open `op/*` PRs lacking a fresh verdict (no review after head SHA) | `pr-opened:<pr>@<head-sha>` |
| `ci-failed`       | failed check runs on main / open op PRs                            | `ci-failed:<sha>:<check>`   |
| `release-shipped` | new release/tag since last seen                                    | `release:<tag>`             |
| `alert-webhook`   | file-drop inbox `state/events/inbox/*.json`                        | file name                   |


Consumed keys are recorded in `state/events/` so a tick never refires an
event; keys are pruned on retention. The file-drop inbox gives webhook parity
later: a droplet webhook receiver just writes JSON files into the same inbox
— the dispatcher does not change.

**Scope note — software lifecycle now, company lifecycle via the same
inbox.** The polled events above are deliberately all software-lifecycle:
GitHub is the only source a laptop can poll in v1 without new ingress or
credentials. Company-lifecycle events — support inbox items, billing/usage
thresholds, signup or churn spikes, launch-calendar dates, compliance
deadlines — enter through the file-drop inbox: any producer (a mail poller,
a payment-webhook relay on the droplet, a calendar script) writes an event
JSON into `state/events/inbox/`, and the dispatcher routes it through the
same roles.yaml trigger mechanism, unchanged. Enumerating these producers
per role (Support, Marketing, SRE) is a roadmap item, not a dispatcher
change.

### Locking & concurrency

- **One turn per (role, app).** Lock file `locks/<app>--<role>.lock` created
with `O_EXCL`, containing `{pid, turnId, startedAt, heartbeatAt}`. The turn
runner heartbeats it every 30 s.
- Tick finds a lock with heartbeat < 2 min old → turn still running → skip
(this is how overlapping firings don't collide). Heartbeat stale → crash
recovery (§3), which decides resume vs restart and re-owns the lock.
- **Org-level WIP limit:** live locks ≥ `org.max_concurrent_turns`
(apps.yaml, default 2) → remaining due turns stay due; next tick retries.
Priority when contending: blocked-turn re-dispatches, then events, then
schedules (oldest due first).
- **Turns outlive the tick.** `operon dispatch` spawns
`operon run-role … --turn <id>` as a detached process, so the 5-minute
timer never kills a long turn. `run-role` is thereby also the manual
entrypoint (roadmap item 2) — the dispatcher is just the thing that calls
it on time.



## 3. Turn lifecycle & state machine



### One role turn

```
dispatch → journal(assembling) → context assembly (§5)
        → worktree acquire
        → journal(running)    → adapter.runTurn(req, {gate, onEvent})
        → journal(collecting) → collect artifacts, escalations, usage
        → telemetry append · scorecard events · memory-write check
        → journal(done | blocked_on_gate | failed) → release lock
```

The journal `state/turns/<turnId>.json` is written synchronously at every
phase transition — it is the crash-recovery source of truth:
`{turnId, role, app, trigger, phase, attempt, session?, worktree?, ticketRef?, escalationIds?, startedAt, updatedAt}`.

**Per-turn budget.** The adapter tracks running cost from SDK usage events;
crossing `max_turn_budget_usd` aborts the turn gracefully → status `failed`
with an incident note artifact (roles.yaml: "overrun = incident note, not
silent spend").

### Worktrees

- Operon maintains its **own clone** per app at `repos/<app>` (fetch-only
sync with GitHub) and cuts worktrees from it under
`worktrees/<app>/<branch>`. It never touches the human's personal checkouts
of the same repos — GitHub is the only sync point between human and org.
- Loop items get branch `op/<issue>-<slug>` and keep the same worktree across
build → review → fix cycles; it is removed after merge/return. Non-loop
turns (Planner digest, SRE sweep) get a throwaway worktree on a detached
checkout of main, removed at turn end.
- Turns never run in `repos/<app>` itself, and never on `main`.



### Build-loop state machine (`src/loop`) — see `docs/loop.md`

The loop is Operon's center of gravity — a framework-agnostic TypeScript
re-engineering of the predecessor orchestrator (`docs/loop.md` §0), **not**
a thin state machine over opaque role turns (decided 2026-07-04: control and
gates, never "throw a ticket at an agent"). `docs/loop.md` is the full
design. Summary:

- A role turn decomposes into a **pass pipeline** (`pipelines.yaml` +
versioned prompts in `prompts/`): contract → implement for the Builder,
acceptance-criteria verification for the Reviewer, competing-PMs →
arbitration → decomposition for the Planner. Each pass = one `runTurn`
with an assembled, budgeted **brief** (ticket + spec excerpts + findings
  - memory); fresh session per pass; per-pass model/effort overrides.

- **Mechanical quality gates** (tests/lint/e2e/secret-scan/completeness/  
review-freshness, risk-tiered by `.operon/policy.yaml`) run as  
orchestrator subprocesses after build passes and twice at ship — distinct  
from the safety gate; no agent prose ever drives a side effect. Gates are  
only as strong as the acceptance criteria they check, so criteria are a  
first-class artifact: binary and mechanically checkable by protocol,  
human-signed-off for deep/high-risk tickets, mapped to named tests by the  
contract pass, enforced by the completeness gate (`docs/loop.md` §5).

- **Review dimensions are risk-selected; security review is always-on**  
(`docs/loop.md` §4): a security lens plus the mechanical secret scan on  
every PR, a dedicated deep security pass on security-sensitive globs or  
high risk tier; performance/scale review by glob or label; scheduled  
whole-repo standing sweeps.

- Item states: `ready → building → gates → reviewing → shipping → merged`,
with bounded remediation (3) and review cycles (3) → `returned`.
`approve` + green gates + freshness → **the orchestrator squash-merges**
(agents never merge), deletes the branch, closes the ticket via
`Closes #N`. All states derive from GitHub artifacts; any tick advances
any item.



### Crash recovery: resume vs restart

A stale lock or an in-flight journal at tick time triggers recovery:


| Journal state                                                        | Action                                                                                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `phase: running`, session handle recorded, `attempt < 2`             | **Resume** the `SessionHandle` with an interruption notice ("your previous turn was interrupted; reassess repo state before continuing") |
| No session handle yet (died before first SDK event)                  | Restart clean, `attempt++`                                                                                                               |
| Resume fails / session invalid / older than `session_retention_days` | Restart clean, `attempt++`                                                                                                               |
| `attempt ≥ 3`                                                        | Mark `failed`; incident note; loop item → `returned`                                                                                     |
| `phase: collecting`                                                  | Don't re-run the model: re-run collection only (artifacts are already on GitHub; telemetry/memory writes are idempotent by turnId)       |


**Restart clean** means: `git reset --hard && git clean -fd` in the worktree
back to the branch tip. Committed-and-pushed work survives; uncommitted work
is disposable *by rule* (below).

### Idempotency rules

These four rules are why a dead turn never leaves the repo half-done:

1. **Durable side effects are git/GitHub ops only** — commit, push, PR
  create, label flip, review, comment, merge. Everything else (worktree
   contents, session files) is disposable scratch.
2. **Artifact before label.** State labels flip only *after* the artifact
  they announce exists (push branch → then `op:building`; open PR → then
   `op:in-review`). A restarted turn re-derives state from artifacts (`gh pr  list --head <branch>`), never trusts the label alone, and skips
   already-done steps.
3. **Claims are label flips.** The Builder claims a ticket by atomically
  swapping `op:ready → op:building`; a dispatcher that polls mid-claim sees
   a consistent state either way.
4. **Non-git writes are append-only and keyed by turnId** (telemetry JSONL,
  scorecard events, journal) — re-running collection dedupes on turnId.



## 4. Approval surface (CLI queue)

Decided 2026-07-04: CLI queue, one-by-one review, approve or
deny-with-reason, persisted audit trail, app-tagged, single queue.

### Storage (`~/.operon/<org>/approvals/`)

```
pending/<id>.json     one file per open item
decided/<id>.json     moved here on decision (decision fields merged in)
grants/<grantId>.json single-use grants created by approvals
log.jsonl             append-only audit trail (every event: raised, decided)
```

Plain files, no database: one human consumer, no concurrency pressure,
survives the droplet migration as a directory copy, and TASTE §3 (boring
dependencies). `id = <utc-compact-timestamp>-<rand4>`.

Item schema:

```jsonc
{
  "id": "20260704T193201Z-8k2f",
  "app": "civic", "role": "builder", "turnId": "…", "ticketRef": "#42",
  "rule": "secrets-or-auth",              // gate rule that fired
  "action": { "tool": "Bash", "input": "…", "description": "…" },
  "justification": "…",                   // the model's stated intent, from turn events
  "raisedAt": "…", "status": "pending"
}
```



### Flow

1. Gate denies-and-escalates (existing `defaultGate`). The adapter surfaces
  the denial to the model as the tool result ("denied — escalated to human
   approval as ") and records the `GateEscalation`.
2. The model continues if it can deliver value without the op; if its primary
  artifact is unreachable it ends the turn declaring so → status
   `blocked_on_gate`. Either way the item is persisted to `pending/` at
   collection time, tagged with app and turnId.
3. Human reviews via CLI (below). **Approve ≠ auto-execute.** Approval mints
  a grant: `{app, role, actionHash, expiresAt, uses: 1}` where `actionHash`
   = SHA-256 of the normalized `{tool, input}`. Nothing replays tool calls
   outside a session.
4. Next tick re-dispatches any `blocked_on_gate` turn whose escalations are
  all decided (resume the session if fresh, else restart with a decision
   summary in context). The effective gate = grant lookup **then** default
   rules, so the retried op passes exactly once. Deny-with-reason: the reason
   is injected into that turn's context ("your request to X was denied:
   ") — the role adjusts course instead of retrying blind.
5. Grants expire (default TTL 24 h) and are consumed on use; both events go
  to `log.jsonl`.



### CLI

```
operon approvals              count + one-line-per-item table (app-tagged)
operon approvals review       one-by-one: full item, then [a]pprove /
                              [d]eny (reason required) / [s]kip
operon approvals show <id>    full detail incl. turn-event context
```

Decision writes are ordered: append to `log.jsonl` first, then move the item
file, then mint the grant — a crash between steps is detected by log-vs-file
reconciliation at next `operon approvals` run.

Budget escalations (§7) enter this same queue as synthetic items
(`rule: "budget-exceeded"`) — one inbox, never two.

## 5. Context assembly

Assembly is **concatenation in fixed order** (PURPOSE v0.8 — layers answer
different questions, so conflicts are rare; narrower layers specialize
defaults):

```
[1] org TASTE.md                      values + engineering constitution
[2] taste/<role>.md                   role craft (when it exists)
[3] <app>/.operon/TASTE.md            product charter (when it exists)
[4] role turn protocol                generated: expected outputs, GitHub
                                      conventions (§10), end-of-turn memory
                                      write instruction, approval etiquette
[5] memory excerpts                   role craft bundle + this app's domain
                                      bundle (§6) — capped
```

**The org's "What we never do" section is unoverridable — but the guarantee
is the gate, not prompt order.** Layers [2]/[3] specializing a never-do rule
would merely be ignored text; the critical-ops gate enforces the same list
mechanically on every tool action. Prompt layering is steering; the gate is
the contract.

**Memory excerpt selection v1: no embeddings.** Include each bundle's
`INDEX.md` (curated one-liners) plus any documents whose frontmatter
`keywords` match the task text; hard cap ~16 KB. Curation (§6) keeps bundles
small enough that this stays adequate; retrieval sophistication is earned by
evidence, not assumed.

**Cache-stable assembly** (added 2026-07-04, reviewed with the human
operator; economics in `research/2026-07-04_prompt-caching.md`). Provider
prompt caches are org-wide *prefix matches*, not session state: a fresh
session whose rendered prefix is byte-identical to a recent request reads it
at ~0.1× input price, and every read refreshes the TTL — so back-to-back
passes stay warm across the loop's fresh-session-per-pass rule for free.
Two rules protect that:

1. **Layers [1]–[4] are a pure function of (role, app, ratified files).**
   Never embed per-turn bytes — timestamps, turn ids, ticket refs, attempt
   counters. Per-turn facts belong in the task payload (the brief), which
   renders after the stable prefix.
2. **Layer [5] is selected once per pipeline execution and held fixed
   across its passes.** Keyword matching runs against the *ticket* text,
   never the per-pass brief — re-selecting per pass would silently change
   the prefix on every pass (and hand the builder and the fix pass
   different lessons; pinning is better for coherence, not just cost).

A model switch between adjacent passes forfeits the whole cache (caches are
model-scoped) — weigh that when tuning per-pass overrides in pipelines.yaml.

**Injection per adapter — native channels only** (docs/PURPOSE.md), nothing
assembled ever lands in a commit:


| Runtime | Channel                                                                                 | Mechanics                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| claude  | system-prompt append (SDK option)                                                       | no files written                                                                                                                               |
| codex   | per-thread instructions if the SDK exposes them; fallback: worktree `AGENTS.md` overlay | fallback file is worktree-local, masked via `.git/info/exclude` (never the repo's `.gitignore`); verify at adapter build time (roadmap item 6) |
| pi      | `.pi/APPEND_SYSTEM.md` in worktree                                                      | same `.git/info/exclude` masking                                                                                                               |


The assembler produces the existing `ContextBundle` type unchanged: layers
[1]–[4] fill `taste: string[]` in order (the generated turn protocol rides as
the final taste element), layer [5] fills `memoryExcerpts` — no type change
needed.

This section covers the *system context* a pass runs under. The *task
payload* — ticket, spec excerpts, contract, findings, attempt history — is
the loop's brief assembler (`docs/loop.md` §3), a separate, per-pass,
budgeted packet logged verbatim in the run artifact.

## 6. Memory & scorecards



### OKF bundles

Two partitions (PURPOSE v0.8: one-turn-one-app):


| Bundle                         | Home                 | Content                                                          |
| ------------------------------ | -------------------- | ---------------------------------------------------------------- |
| `memory/roles/<role>/`         | org home (committed) | craft: what this role has learned about doing its job, cross-app |
| `<app>/.operon/memory/<role>/` | app repo (committed) | domain: what this role knows about this product                  |


Document format (OKF — markdown + YAML frontmatter):

```markdown
---
name: prefer-fixture-factories
description: one-line hook used for excerpt selection
type: lesson | fact | procedure
keywords: [tests, fixtures]
evidence: ["PR #12 review", "incident 2026-07-02"]
status: active | deprecated
created: 2026-07-04
updated: 2026-07-04
---
Body: the lesson, with the why. Wrong lessons get deleted, not hedged.
```

Each bundle carries an `INDEX.md` (one line per doc) — the always-included
excerpt layer.

**End-of-turn write** is part of the role protocol (context layer [4], per
TASTE §12): before finishing, record corrections and confirmed approaches in
the appropriate bundle. Memory dirs are deliberately agent-writable routine
ops (the `protocol-self-edit` gate rule does not cover them); commits ride
the turn's normal git flow — craft lessons to the org home, domain lessons
to the ticket branch (they merge with the work).

**Curation** is a weekly maintenance turn (`operon retro`, below): dedupe,
delete wrong lessons, `status: deprecated` for doubtful ones, and promote
recurring lessons up a tier to `skills/` — skill promotion is a PR, i.e.
review-gated (docs/PURPOSE.md knowledge tiers).

### Scorecards

Raw events append to `scorecards/<app>/<role>.jsonl` as they happen, written
by the orchestrator (never self-reported):


| Event                | Source                                          | Scores              |
| -------------------- | ----------------------------------------------- | ------------------- |
| `review_cycles`      | loop item at merge/return (cycles count)        | Builder             |
| `escaped_bug`        | SRE incident note tracing to a merged PR        | Reviewer            |
| `rework`             | ticket returned / reopened after merge          | Planner             |
| `edit_distance`      | human's delta on a published draft              | Support / Marketing |
| `gate_denial_upheld` | approval queue: deny on an item the role raised | any                 |
| `turn_cost`          | telemetry rollup                                | any                 |




### Weekly retro (`operon retro`)

A scheduled org-level turn (Opus, high effort — quality of judgment matters
here) that consumes the week's telemetry + scorecards and emits:

1. `retro/<date>.md` in org home (committed) — scores per (role, app),
  trends, incidents;
2. memory curation edits (routine);
3. proposed TASTE/roles.yaml changes — **as proposals only** (issues/PRs for
  the human; the gate's `protocol-self-edit` rule backstops this).

The scorecard, not self-assessment, decides autonomy changes (TASTE §13) —
e.g. Support replies graduating from draft-only is a roles.yaml proposal
justified by edit-distance trend.

## 7. Multi-app structure



### App registry — `apps.yaml` (org home)

```yaml
org:
  name: operon
  max_concurrent_turns: 2

defaults:
  budget_usd_month: 1000        # decided 2026-07-04, configurable per app

apps:
  operon-sandbox-alpha:
    repo: bikramgupta/operon-sandbox-alpha       # GitHub slug = identity
    status: live                # live | paused | onboarding
    budget_usd_month: 1000
    cadence: {}                 # optional per-role trigger overrides, e.g.
                                #   support: []          (disable role here)
                                #   planner: [{schedule: "daily 08:00"}]
  operon-sandbox-beta:
    repo: bikramgupta/operon-sandbox-beta
    status: onboarding
```

- **One-turn-one-app is structural:** `TurnRequest` has a single `workdir`;
multi-app exists only in the dispatcher (which iterates apps) and human
surfaces (the app-tagged approval queue, per-app budget rollups). No turn
ever sees two apps.
- "One live app at a time" is **operational policy** expressed as `status:`,
not code — the WIP limit is what code enforces.
- Per-app cadence overrides replace (not merge with) that role's roles.yaml
triggers when present; an empty list disables the role for that app.



### Budget enforcement

Telemetry already records cost per turn; the dispatcher rolls up the current
month per app (telemetry records gain an `app` field — small addition to
`TurnRecord`):

- ≥ 80% of `budget_usd_month` → warning line in the Planner's daily digest.
- ≥ 100% → app auto-set to `paused` (state overlay, not a YAML edit) + a
`budget-exceeded` item in the approval queue; human approval resumes the
app (optionally raising the budget in apps.yaml themselves).



## 8. Planner co-planning mode

A third invocation shape beside schedule and event: **manual, interactive**.

```
operon plan <app> [--topic "stats percentile helper"]
```

- Assembles the Planner's context exactly as §5 (same TASTE layers, same
memory bundles), creates a throwaway worktree on main, then hands over to
an **interactive** session with the human in the terminal — v1: spawn the
role's native CLI (`claude`) in that worktree with the assembled context
injected via its append-system-prompt channel. Co-planning is
Anthropic-native v1; it generalizes when another runtime hosts the Planner.
- The contract at session end is unchanged — artifacts out: drafted tickets
(GitHub issues in the §10 format, labeled by the human's call: `op:ready`
or left unlabeled for another pass) and/or a spec note committed under the
app's `.operon/planning/`.
- Recorded in telemetry with `trigger: manual`; the `Trigger` type gains a
`manual?: boolean` kind that the dispatcher **never** auto-fires
(implementation delta to `src/runtime/types.ts`).
- Gate applies as always — interactivity doesn't change the approval
boundary; the human approving in-terminal *is* the approval surface for any
critical op raised live (recorded to the same audit log).
- First product-development use: sandbox co-planning against
  operon-sandbox-alpha. Civic co-planning is deferred until production
  onboarding after the product is build-complete.



## 9. Bootstrap

```
operon bootstrap        # run inside the product repo
```

1. **Learn.** Scan the repo: language/build/test commands (manifests, CI
  config), existing agent docs (CLAUDE.md / AGENTS.md), deploy hints
   (Dockerfiles, DNS/IaC), size and activity.
2. **Questionnaire.** Interactive alignment pass with the user: what the
  product is and what "good" means (→ app charter); which roles to enable;
   budget; cadence; app-specific critical ops (deploy commands, publish
   targets, secret locations — these extend the gate's rule set for this
   app); support/marketing channels if any.
3. **Emit.**
  - `.operon/TASTE.md` — the app charter (layer [3]);
  - `.operon/config.yaml` — the app's registry entry (apps.yaml schema);
  - `.operon/policy.yaml` — the app-owned quality-gate policy;
  - `.operon/memory/<role>/INDEX.md` — seeded empty bundles;
  - single-app profile (no org detected): also `.operon/org/` with org
  TASTE.md, roles.yaml, apps.yaml — templated from this repo's root
  files, which are instance config destined to become exactly these
  templates (PURPOSE v0.8 dogfood note).
4. **Register / join.** If an org home exists (`~/.operon/config` points at
  it), add the app to its `apps.yaml` as `status: onboarding` — bootstrap
   in a second repo *detects and joins* the existing org rather than
   creating a parallel one.

Graduation (single-app → org-home repo) is `git mv .operon/org/* <org-home>/`
by construction (§1). An org-home repo remains optional, never required.

## 10. GitHub substrate conventions



### Labels — the ticket state machine


| Label              | Meaning                                      | Set by                                              |
| ------------------ | -------------------------------------------- | --------------------------------------------------- |
| `op:ready`         | ticket is buildable as specified             | Planner (or human)                                  |
| `op:building`      | claimed; branch/PR in progress               | Builder turn (claim = atomic `ready→building` swap) |
| `op:in-review`     | PR open, review cycle running                | loop, after PR exists                               |
| `op:returned`      | bounced to Planner (max cycles / infeasible) | loop                                                |
| `op:blocked`       | waiting on approval-queue decision           | loop, on `blocked_on_gate`                          |
| `op:incident`      | SRE incident note                            | SRE                                                 |
| `p1` / `p2` / `p3` | priority (dispatch order within events)      | Planner                                             |


Transitions follow §3's artifact-before-label rule; ticket close comes from
the squash-merge's `Closes #N`, never a manual state.

### Ticket format (what the Planner emits)

Fixed headings, parseable by heading, human-first:

```markdown
Title: imperative, one concern (one ticket = one PR, TASTE §5)

## Goal            — what exists after this ships, one paragraph
## Context         — why now; links to feedback/digests/prior art
## Acceptance criteria   — checklist; each item mechanically checkable
## Out of scope    — the temptation fence
## Notes for the builder (optional) — pointers, not prescriptions
```



### Branches, PRs, reviews

- Branch: `op/<issue>-<slug>` from main; one branch per ticket; worktree ↔
branch 1:1 (§3).
- PR: title `<type>: <summary> (#<issue>)`; body = What / Why, **Evidence**
(pasted test output — TASTE §6), `Closes #<issue>`. Draft on first push;
ready when the Builder declares done.
- Review: verdict as a real GitHub review (APPROVE / REQUEST_CHANGES) plus a
structured findings comment — numbered findings, each must be resolved or
explicitly rebutted before merge (TASTE §8). Findings ride to the fix turn
as context.
- Merge: squash-merge only, performed by the loop after APPROVE; branch
deleted; PR description survives as the commit body (state-in-markdown, a
predecessor pattern).



## 11. Ratified decisions promoted to docs/PURPOSE.md

New decisions made by this document, ratified by the human operator on
2026-07-06 and promoted to docs/PURPOSE.md:

1. **Tick dispatcher, detached turns.** Stateless `operon dispatch` tick
  (launchd/systemd, ~5 min); turns spawn detached so schedulers never kill
   work; events by GitHub polling + file-drop inbox in v1 (webhook parity
   later without dispatcher changes).
2. **Approve ≠ execute — grants.** Queue approval mints a single-use,
  action-hashed, expiring grant consumed by the gate on re-dispatch; the
   orchestrator never replays tool calls itself.
3. **Idempotency contract** (§3): durable effects are git/GitHub ops only;
  artifact-before-label; claims are label flips; non-git writes append-only
   keyed by turnId.
4. **Org-managed clones.** The org works only in its own clones/worktrees
  under `~/.operon/`; GitHub is the sole sync point with the human's
   checkouts.
5. `.operon/org/` **sublayout** for the single-app profile (refines v0.8's
  "identical layout" wording; keeps graduation a `git mv`).
6. **Merge is loop-owned.** The orchestrator squash-merges after APPROVE;
  agents never merge.
7. `manual` **trigger kind** for co-planning; interactive Anthropic-native
  v1.
8. **The loop-engineering decisions** in `docs/loop.md` §11 (added
  2026-07-04 after design review with the human): orchestrator-owned pass
   pipelines; mechanical quality gates distinct from the safety gate;
   planning as a Planner pipeline, not a loop phase; assembled briefs;
   ticket-level parallelism only; loud orchestrator failures; risk-selected
   review dimensions with security always-on; acceptance criteria as a
   ratified quality contract.
9. **Containment invariant.** Operon's footprint in an app repo is exactly
  `.operon/` (plus transient `op/*` branches and `op:*` labels); nothing
   Operon-specific elsewhere in the app's tree; `.operon/config.yaml`
   carries `schema_version` from day one.
10. **Company-lifecycle events ride the file-drop inbox** (§2): external
  producers write event JSON; the dispatcher's trigger mechanism is
   unchanged. Enumerating producers per role is roadmap work.



## 12. Open questions

1. **Codex context channel** — per-thread instructions vs AGENTS.md overlay:
  verify against the Codex TS SDK when building the adapter (item 6); the
   fallback is specified (§5) either way. *(build-time verification)*
Resolved 2026-07-06: Support/Marketing stay disabled per app until channels
exist; defaults confirmed as `max_concurrent_turns: 2`, grant TTL 24 h,
dispatch tick 5 min, loop `maxCycles: 3`.
