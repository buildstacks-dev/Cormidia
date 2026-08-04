# Cormidia Live UI — observability design

*Status: ratified and implemented; this is the authoritative V1 contract.*

*Version: 1.1 — 2026-07-12.*

*Audience: a new implementation session, reviewers, and the human operator.*

## 1. Executive summary

Cormidia should remain **agent-operated and human-observable**. A human gives
work to Cormidia through a coding agent or the CLI; a local, read-only Live UI
shows what the org is doing, what is waiting, why a pass is running, whether it
is healthy, what evidence it has produced, and what needs attention.

The proposed command is:

```sh
cormidia observe --app <app> --open
```

It starts a loopback-only HTTP server, reconstructs current state from
Cormidia's existing durable artifacts, and streams changes to a browser using
Server-Sent Events (SSE). It owns no workflow state and offers no configuration
or mutation controls. Stopping the server cannot stop or alter Cormidia work;
restarting it reconstructs the same view from disk and GitHub.

The UI unifies live and historical telemetry. A running trace continues to
update; once it ends, the same page becomes its permanent recorded snapshot and
forensic record. The existing `cormidia telemetry` terminal, JSON, and portable HTML
outputs remain supported views over the same underlying facts.

The queue decision is:

- Application creation/bootstrap is **onboarding**, not ordinary queue work.
- GitHub issues labeled `op:ready` are the canonical **product-delivery
  queue** after onboarding.
- Other `op:*` labels are states of claimed or waiting delivery work, not
  additional queues.
- Scheduled and event-driven Planner, SRE, Support, Marketing, Distiller, and
  Learning Reviewer turns are live org activity and intake. They may produce a
  GitHub ticket, but they are not retroactively presented as ready-ticket queue
  entries.
- The approval queue is a separate safety queue. It can be observed in the UI,
  but decisions remain in the CLI/agent workflow.

No new canonical queue or telemetry database should be introduced.

## 2. Decision status and relationship to `PURPOSE.md`

This document is the ratified implementation contract. Its concise product
decision is recorded in `docs/PURPOSE.md`; the detailed behavior remains here.
It follows the existing decisions that:

- GitHub is the source of truth for tickets, PRs, and delivery state.
- The dispatcher is a stateless tick rather than a supervised daemon.
- Cormidia state is durable in git plus files.
- Human approval is required only for critical operations.
- The CLI and coding-agent interface are the primary control surfaces.
- Dashboards read structured run state; they do not infer truth from model
  prose or pretend an activity log is a transcript.

The implementation adds only a high-level decision to `docs/PURPOSE.md` and
keeps the execution contract here. Do not silently change
`PURPOSE.md`, `TASTE.md`, `roles.yaml`, `pipelines.yaml`, or `prompts/**` while
implementing it.

## 3. Product contract

### 3.1 Primary interaction model

The preferred path remains:

```text
human → coding agent or Cormidia CLI → Cormidia runtime → GitHub/app artifacts
```

The Live UI is a projection alongside that path:

```text
                             ┌─ runs / tasks / approvals / ledger
Cormidia runtime ──────────────┼─ GitHub issues / PRs / reviews
                             └─ scheduler / locks / event state
                                           │
                                           ▼
                                  read-only projection
                                           │
                                           ▼
                                      Live UI
```

The UI does not become an alternative workflow engine.

### 3.2 Goals

The UI must let an operator answer, without opening multiple terminals:

1. Which org and app am I observing?
2. Is the observer connected, fresh, degraded, or stale?
3. Which app is onboarding, live, or paused?
4. Which tickets are ready, claimed, under review, returned, or approval
   blocked?
5. Which role/pass is executing now, and what caused it to run?
6. Is that pass making progress or merely still marked `running`?
7. What prompt and brief went into it?
8. What structured activity, tools, subagents, gates, and escalations have
   occurred?
9. What output or verdict has appeared?
10. What is the usage/cost quality: complete, partial, estimated, or
    unavailable?
11. Which branch, commit, PR, review, issue, or deployment is the durable
    result?
12. Did every required Cormidia stage actually complete?

### 3.3 Non-goals for the first release

The first release must not provide:

- org, role, model, cadence, budget, authority, pipeline, prompt, or app
  configuration editors;
- create-ticket, change-label, retry, cancel, approve, deny, merge, deploy, or
  publish buttons;
- an embedded chat or a second agent interface;
- a workflow/pipeline designer;
- an alternative issue store or queue database;
- cloud telemetry ingestion, multi-user hosting, public sharing, or remote
  binding;
- a promise of full model transcripts where a provider does not expose one;
- animation that implies work not supported by durable evidence.

Links may open GitHub, a native provider session, or a local evidence artifact.
Copying identifiers and filtering the view are safe UI interactions; they do
not mutate Cormidia.

## 4. Vocabulary and the queue model

The UI must use these terms precisely.

| Term | Meaning | Authoritative source |
| --- | --- | --- |
| App lifecycle | `onboarding`, `live`, or `paused` | org `apps.yaml` |
| Onboarding | Create/bootstrap/register an app and produce enough product truth to begin planning | app `.cormidia/**`, org registry, planning artifacts |
| Intake signal | Human request, support feedback, adoption signal, alert, schedule, or another event that wakes a role | parent task, file-drop event, GitHub event, schedule state |
| Product-delivery queue | Open GitHub issues carrying `op:ready` | GitHub |
| Delivery work item | One GitHub issue moving through the build-loop state machine | GitHub labels plus loop artifacts |
| Parent task | The broader outcome delegated by a human/outer agent | `tasks/<taskId>/task.json` and prompt |
| Trace | One selected pipeline execution, potentially containing several passes | correlated run envelopes |
| Pass | One provider turn by one role in one app | `runs/<app>/<runId>/` |
| Invocation | One CLI command or distinct internal release execution | `invocations/<date>.jsonl` |
| Approval item | A critical operation waiting for a human decision | `approvals/` |

### 4.1 Onboarding is a separate lifecycle

Greenfield creation and existing-app bootstrap occur before steady-state
delivery:

```text
greenfield: new-app ─┐
                    ├─→ bootstrap/register → app:onboarding → planning
existing app ───────┘                                      │
                                                          ▼
                                              GitHub tickets are published
                                                          │
                                            dependency-free tickets receive
                                                      op:ready
```

The overview should therefore show an **Onboarding** lane or lifecycle card,
not place “bootstrap the app” into the `op:ready` ticket queue unless a real
GitHub issue explicitly represents a buildable onboarding task.

Changing an app from `onboarding` to `live` remains human-ratified operational
policy. The UI reports it; it does not change it.

### 4.2 GitHub is the delivery queue

Only `op:ready` means “claimable now.” The existing state machine remains:

```text
op:ready
   │ atomic claim
   ▼
op:building ──→ op:in-review ──→ merged/issue closed
     ▲                │
     └── fixes ───────┘

op:returned  = bounded build/review work returned to Planner with evidence
op:blocked   = waiting on a critical-operation approval
```

Dependency-blocked or not-yet-groomed issues may be open without `op:ready`.
They are backlog/intake, not claimable queue entries. Priority labels
`p1`/`p2`/`p3` affect dispatch order. The UI must share or consume the
scheduler's ordering logic rather than implement a subtly different ordering.

The browser must not update labels. A displayed state change is accepted only
after the authoritative GitHub state or a durable local transition record says
it occurred.

### 4.3 Work that does not begin as a ready ticket

The ready-ticket queue does not describe all org activity. The dispatcher can
run:

- Planner planning/grooming on a schedule or feedback/adoption event;
- SRE health or incident work;
- Support digest work;
- Marketing release or intelligence work;
- daily distillation and weekly learning review;
- manual role runs and pre-ticket planning.

The UI represents these as **Activity/Intake** entries with their trigger and
result. When a Planner subsequently publishes a GitHub issue, the view links
the source activity to the ticket where correlation evidence exists. It must
not infer a relationship from similar text.

### 4.4 The approval queue stays separate

`op:blocked` connects a delivery ticket to an approval item, but the approval
item has its own identity, TTL, scope, audit, and outcome. The UI can show:

- approval ID, app, role, rule, age, and ticket reference;
- whether it is pending, granted, denied, expired, consumed, or revoked;
- the resulting `op:blocked → op:ready` re-arm when recorded.

It must not approve or deny. A link may display the exact CLI command or tell
the operator to delegate the decision workflow to an agent.

## 5. User experience and information architecture

### 5.1 Global shell

Every page carries a compact header:

- Cormidia org name and resolved state-home identity;
- a top-right session chooser with **Live org** plus historical parent tasks
  and standalone traces from the current org;
- selected app or “all apps”;
- connection state: `live`, `reconnecting`, `degraded`, or `offline`;
- last successful local projection and GitHub refresh times;
- active pass count and org WIP limit;
- pending approvals count;
- recorded monthly spend and its quality marker;
- a clear **READ ONLY** indicator.

Filters belong in URL state so a coding agent can hand the human a stable
link. Initial filters: app, parent task, ticket, status, role, and time range.
The selected session is URL state as well. “Session” is presentation
vocabulary, not a new durable entity: a parent task is the preferred session
boundary, and a trace without a parent task remains selectable as a standalone
historical session. The chooser must never group by native provider session ID
or infer correlation from timestamps or text. `--parent-task` initializes this
browser selection rather than removing sibling sessions from the snapshot;
`--app` remains an explicit server-side app scope.

### 5.2 Overview page

The overview has four ordered sections.

#### A. Attention

Attention renders **one card per (cause, scope) group**, not one card per
occurrence. A campaign with 26 identically-caused passes is one card reading
`26 occurrences`, not 26 cards that bury everything else.

Each group declares:

- its severity as a **word**, never colour alone;
- its `occurrence_count` — always the true total, even when delivery is capped;
- the affected passes, traces, tickets, and role/pass labels, each rendered on
  its own line naming its own facet, so a role/pass label is never presented as
  a role name;
- its ordering direction (`most severe first`, then occurrence count
  descending);
- expandable occurrences, each with its own entity id, real durable timestamp,
  and evidence references. Expansion uses `<details>`/`<summary>`, so keyboard
  operation and `aria-expanded` come from the platform.

Grouping keys derive **only** from the typed, closed-vocabulary `kind` and
`cause` fields plus org+app scope (§6.4). The conditions and their causes:

| kind | cause source | groupable |
| --- | --- | --- |
| `pending_approval` | `approval.rule` | yes |
| `approval_delivery` | `approval.execution_state` | yes |
| `stale_pass` | `stalled` | yes |
| `failed_pass` | `pass.status` | yes |
| `usage_incomplete` | `pass.usage.quality` (`partial`/`unavailable` only) | yes |
| `corrupt_run` | `degraded_run_evidence` / `corrupt_envelope` | yes |
| `corrupt_intake` | `corrupt_intake` | yes |
| `returned_ticket` | `returned` | **no** |
| `delivery_integrity` | `delivery_integrity` | **no** |
| `source_health` | `source.id` | **no** |
| `corrupt_task` | `corrupt_task` | **no** |

The non-groupable kinds are independently actionable — two returned tickets are
two decisions — and always render as singleton groups whose id embeds the
entity id.

`usage.quality: "none"` is an authoritative zero (§6.6). It raises **no**
attention item and appears in no group. The condition is `partial ||
unavailable`, never `!== "complete"`.

The flat `attention` array keeps the complete unaggregated truth; every item
carries a `group_id` that resolves to exactly one group, so the grouping is
mechanically verifiable rather than a client-side reinterpretation.

Empty is healthy and should occupy little space.

#### B. App lifecycle

For each selected app, show lifecycle (`onboarding`, `live`, `paused`),
recently produced tickets or artifacts, and an explicit reason when
Support/Marketing is channel-gated.

Beneath the app cards, two **separately named collections** — never one
concatenated list:

**Recorded activity** (`activity_history`) is dated execution evidence. Its
rows are non-nullable in `started_at`, `latest_at`, and the declared sort key
`occurred_at`, so **a row without a recorded timestamp can never enter a
chronological collection** — that is a type invariant, not a convention. Each
row states its trigger and source in plain language, and offers navigation to
its trace/parent-task session using real identity only.

Under a session selection, membership is proved by a **positive** identity
match: the row's trace is one of the session's traces, or its `parent_task_id`
IS the selected parent task's id. A null `parent_task_id` is the ABSENCE of a
correlation and never a match — comparing it against a `null` sentinel under a
single-trace session admitted every same-app row with no parent task while the
badge asserted "This trace only".

**Pending intake** (`pending_intake`) is undated or independently-timed work
waiting to be picked up: `state/events/inbox/*.json` drops and apps awaiting
promotion. It renders as a `<ul>`, not an `<ol>`, because it is explicitly not
a sequence. It carries its own `counts` by state, and each row's
`timestamp_basis` says whether the shown time is the recorded event time
(`occurred`), the filesystem receipt time (`discovered`), or absent (`none`).
`pending` is the NORMAL state of an inbox file and raises no attention item.

`discovered_at` is a filesystem observation. It is display-only and is
explicitly **not** a correlation key (§6.4).

Both collections ship a `SectionScopeView`: label, pre-cap `total`, `returned`,
`truncated`, `cap`, and an `OrderingView`. Every ordered or capped collection in
the read model declares those four facts, and the client renders `showing N of
M` rather than silently slicing.

That rule has no exemptions. **Every** capped section — recorded activity,
pending intake, attention occurrences, the execution graph, the live activity
stream, its undated tail, and recorded sessions / completion integrity — reads
its cap from one named limit key, renders its disclosure through the same scope
badge, and offers a `Show more` control that raises that key. A badge printing a
pre-cap total beside a sliced list is worse than a bare slice: a bare slice
claims nothing, while the badge affirmatively asserts a count the section does
not show. Each `Show more` names its own section in its accessible name, and
because activating it re-renders the section that owns it, focus is explicitly
restored to the replacement control — or to the section list when nothing is
left to reveal — so keyboard paging never drops the operator at `<body>`.

This prevents onboarding and non-ticket role activity from being mislabeled as
delivery queue work, and prevents a pending health alert from reading as a
later lifecycle stage than a completed planning trace.

#### C. Delivery work

Use grouped columns or a compact list:

- **Ready** — `op:ready` in scheduler claim order;
- **Building** — `op:building`;
- **Reviewing** — `op:in-review`;
- **Waiting approval** — `op:blocked`;
- **Returned** — `op:returned`;
- **Recently completed** — merged/closed outcomes with Cormidia evidence.

Each card shows issue number/title, priority/tier, dependencies, age, current
phase, active role/pass, branch/PR when known, and latest meaningful event.
Do not put long model text on cards.

#### D. Live activity

Show a chronological stream of structured events across active traces:

- pass start/heartbeat/completion/failure;
- gate start/pass/fail;
- scrubbed tool name, duration, and outcome where the adapter provides it;
- subagent start/completion;
- ticket transition;
- verdict and escalation;
- telemetry settlement.

**Ordering.** The stream is `newest_first` and the heading says so. The total
order is a projected, opaque `EventView.order_key`; a single descending
lexicographic sort over it IS the whole ordering contract. The tie-break chain
is `ts_utc`, then app, then run id, then append order within the pass event log
— read in reverse, because one descending sort covers the whole composite key,
which `ACTIVITY_ORDER.tie_break` states explicitly. Dated events always precede
undated ones, which render in a labelled `Undated · showing N of M` tail group
that pages under its own limit key like every other capped collection. The order is
computed from durable evidence only and never reads the clock or the display
format, so switching the timestamp mode cannot reorder the list.

**Completeness.** `snapshot.activity` carries metadata only — no second copy of
the events. `total_events` is the authoritative denominator for the client's
`showing N of M` disclosure, and `completeness: "partial"` with
`incomplete_reasons` is set when a pass carries corrupt or expired event
evidence, so the section declares under-reporting instead of hiding it.

**Filtering** is available on event kind, tool outcome, trace, pass, role, and
pass status, all held in URL state so a link reproduces the view. Trace and pass
are genuine filters with their own controls, not highlights: `?trace=` and
`?pass=` narrow the stream, and a highlight that leaves every other entry in
place would not let an operator isolate the pass a graph node pointed them at.
`status`, `role`, `trace` and `pass` filter the PASS; `kind` and `outcome`
filter the EVENT — the scope badge names which facet each active filter applies
to, in those words. Trace filtering resolves through the projection's composite
trace identity and then matches on `(app, trace_id)`, never a bare `trace_id`.
A selection that has left the window narrows to nothing and the badge says so,
rather than silently widening back to every pass. Choosing a session is a SCOPE
change rather than a filter, so it clears the trace and pass filters, whose
identities belong to the session being left. The default is all kinds:
narrowing by default would silently hide evidence.

Paging (`?more=`) and attention-group expansion (`?open=`) are URL state too, in
a fixed sorted order, so a link reproduces what the sender was actually looking
at and not merely which filters they had set.

**Grouping** by trace or by pass is available, and `group=none` preserves the
raw sequence. Group keys are `(app, trace_id)` and the pass id (`app:runId`)
only. Groups order by the maximum member `order_key`, so group order is
deterministic rather than insertion-dependent, and grouping never drops or
duplicates an entry.

**Graph linkage** is bidirectional and keyed on real ids: activating a graph
node opens the pass drawer and sets `?pass=<pass id>`, which filters the stream
to that pass; each activity entry offers `Show in graph`, marked `aria-disabled`
with a stated reason when that pass has no node in the current scope. A control
that cannot act stays FOCUSABLE and carries no `aria-label` overriding its
visible text, so the stated reason is reachable by keyboard and its accessible
name matches what is on screen. There is never a fallback to a nearby node.

**Following vs paused** is stated in words, not colour: the stream follows live
while `scrollTop === 0` exactly, and any movement away pauses it, reports how
many entries arrived while paused, and restores the exact scroll position across
re-renders. That count is derived by capturing the set of event IDS on screen at
the moment of pausing and counting entries absent from it — real identity, never
a counter of delivered snapshots and never a timestamp comparison — so it is
exact rather than structurally always zero. The follow pill is the stream's only
live region; the list itself is not one, because it is rebuilt wholesale on every
snapshot and an `aria-live` list would re-announce every visible entry (and, with
grouping on, every heading) each time. Nothing is dropped while paused. Heartbeats are coalesced in the visual stream
only across ADJACENT entries sharing a `coalesce_key`, so an interleaved
failure can never be swallowed; freshness reads `PassView.last_heartbeat_at`
and `activity.latest_heartbeat_at`, which coalescing never touches.

### 5.3 Task/ticket execution page

Selecting a parent task or ticket opens the primary troubleshooting view:

```text
Parent task / intake
        │
        ├─ pre-ticket planning trace
        │      Planner → PM perspective → decomposition/publication
        │
        └─ Ticket #N
               contract → build → gates → review → fix? → ship
```

The graph is evidence-driven:

- one node per selected pass or mechanical gate group;
- arrows from trace plan and correlation IDs;
- dashed nodes for passes intentionally skipped by routing;
- no fabricated expected stages for legacy traces lacking a manifest;
- role identity inside each node, with runtime/model secondary;
- a pulse only on a pass with current liveness evidence.

Recommended state treatment:

| State | Treatment |
| --- | --- |
| Not selected | absent, not gray “pending” |
| Selected, not started | neutral outline |
| Running with fresh heartbeat | blue plus restrained pulse |
| Completed | green |
| Blocked/approval wait | amber |
| Failed/timed out/stale | red |
| Returned | amber/red with Planner-return label |
| Skipped by routing | dashed muted node with reason |
| Unknown legacy evidence | gray with “unknown,” never inferred |

Color must never be the only signal; text, icons, and accessible labels carry
the same meaning.

#### Trace boundaries, node vocabulary, and search (#95)

The graph renders **stacked trace groups**, not one horizontal row. Each group
is a `section.trace-group` carrying `data-trace-id` set to `TraceView.id` — the
composite `trace:<app>:<trace_id>`, never the bare trace id, which is not
globally unique (two apps routinely share one). Its `h3.trace-head` states, all
as visible text and not only in an accessible label:

- trace id, app, pipeline, and ticket (or `no ticket`);
- a status pill;
- the start instant, as a `<time datetime>` through the one timestamp policy;
- the duration, or the verbatim recorded reason there is none — `Trace not
  finished`, `Start or finish instant not recorded`, `Unreadable instant`, or
  `Finish instant precedes start (clock skew)`. A negative duration, a clamp to
  zero, an `abs()`, or a substituted `Date.now()` are all forbidden;
- `N observed · M skipped · K not observed`;
- the trace's ledger-first cost through the single cost renderer;
- for a legacy trace, the literal note `Trace manifest not recorded — expected
  stages unknown`.

Each group also carries a **Filter activity to this trace** action, which writes
the composite id into the existing `?trace=` filter. It adds no route and issues
no request.

Nodes come from `TraceView.graph_nodes` and are never re-derived in the client.
`GRAPH_NODE_STATES` in `src/observe/types.ts` is the single closed vocabulary the
projection emits, the legend explains, the stylesheet styles, and the tests
assert — an emitted state with no legend row, or a legend row for a state the
projection cannot emit, is a test failure. The legend is a keyboard-reachable
`<details>` whose rows are text (never a swatch alone, never a `title=`
tooltip), and it also explains the arrow and the absent-stage rule.

**A trace whose `manifest` is `not_recorded` emits ZERO `not_observed` nodes.**
Expected stages are unknown, `completion_integrity.required_stages` is
`unknown` (not `incomplete`), and a default pipeline stage list is never
substituted. This is the mechanical form of "no fabricated expected stages for
legacy traces" above.

Clicking a pass node opens the pass drawer AND sets `?pass=`, which drives the
Live activity focus. The selection is exposed with `aria-current` on the node
and `data-selected` on its owning group, survives SSE re-render and a full
reload, and lives in the URL only — never in `localStorage`, a cookie, or any
server-side map.

`traces_scope` declares the projection's honest pre-filter total and the trace
ordering (`order_key`, newest instant first, ties by composite trace id
**ascending**). The trace sort is a pure function of the records: it is proved
permutation-stable, never `[...traces].sort(by).reverse()`, which reverses the
tie-break as well and hoists undated traces to the front.

The graph badge's denominator is **this section's own pre-search collection** —
the traces in scope after the session selection and app filter, before the graph
search and the display cap. Quoting the org-wide `traces_scope.total` instead
turns every narrowing into a false truncation claim: a single-trace session then
reads `showing 1 of 4` with no pager, telling the operator three traces were
withheld from a section that withheld nothing. A deliberate scope narrowing is
declared by the scope KIND and the session/filter detail beside it; **truncation
is a different fact**, and only the display cap and the projection's delivery
limit may assert it. Server-side delivery truncation is still surfaced, under
its own named cause, whenever the section is showing the org-wide set the
projection capped.

`?gq=` is a client-side search over projected identity only — trace id, app,
pipeline, ticket, and pass/role names. It never matches prompt text, previews,
branch names, or timestamps, never touches the network, and never narrows the
disclosed denominator: the badge reports matches and the recorded total
separately.

### 5.4 Pass inspection drawer

Clicking a pass opens a drawer without leaving the graph. Organize it as:

#### Identity

- run, trace, parent-task, app, ticket, pipeline, pass, and role;
- runtime/model/effort tuple;
- trigger and initiating invocation when recorded;
- delegated-authority profile/version/hash;
- native provider session reference and transcript capability.

#### Progress

- status, start time, elapsed/final duration;
- latest heartbeat and latest provider event;
- “live,” “stalled,” or “unknown” reasoning;
- terminal/error reason;
- current/recent structured activity.

#### Input

- short scrubbed preview;
- explicit links to exact `brief.md` and `prompt.md`;
- hashes where available;
- a warning that full L3 evidence is local and may contain sensitive text.

#### Output and verdict

- bounded scrubbed preview;
- verdict summary and structured findings;
- link to exact `output.md` after it exists;
- artifacts, branch, commit, PR, review, and deployment references.

#### Usage

- input/output/cache-read/cache-write tokens when available;
- recorded cost, `~` marker for local estimates;
- quality: complete, partial, estimated, or unavailable;
- last checkpoint time while running;
- tool/subagent/escalation counts.

#### Evidence

- envelope;
- event stream;
- activity log, always labeled **activity log—not transcript**;
- native transcript/session link only when the adapter says one exists.

### 5.5 Recorded session snapshots

A completed task uses the same graph and activity timeline. Each record is a
**recorded snapshot** built from durable event timestamps and envelope final
state; it must not manufacture intermediate states absent from old records.
Nothing is animated and no intermediate state is reconstructed, so the surface
is named for what it is — the word "replay" is used nowhere in the UI, including
the header identity line (#96).

The section is two lists with different, stated scopes:

- **`#history-index`** — the navigable index of every recorded session: one row
  per parent task and one per trace. It is **deliberately not rescoped** by the
  current selection, and its badge says so with a reason. Rescoping it would
  collapse the list to the session already selected and leave the header
  dropdown as the only way to reach another, which is the defect rather than
  the fix.
- **`#history`** — completion-integrity records, scoped to the current selection
  exactly as before.

They are independent collections and hold **independent paging keys**
(`history-index` and `history`). A shared key would couple their caps, make
`?more=` unable to express them separately, and — because a pager's focus is
restored by key — send keyboard focus into whichever list rendered first. Every
capped collection's key appears exactly once in `DEFAULT_LIMITS`.

Every index row is either a `<button>` carrying `data-session-id` (a real
selectable session identity) or a static card stating why it is not selectable.
A trace **claimed by a parent task** navigates to that task's session and says
so: its own composite id is not a selectable session and choosing it would be
silently reset to Live org. The claim is resolved through the SAME `sessions()`
correlation the Session control uses, which covers both forms the projection
records — a trace carrying `parent_task_id` (surfaced as `parent_session_id`)
**and** a trace named only in the task's recorded `refs.traces`. Resolving
through `parent_session_id` alone declared the second form out of window while
its claiming session sat in the dropdown. The recorded-activity `session_ref`
resolves through the same map, so a row and the dropdown cannot disagree about
whether a record is reachable.

`aria-current` is DERIVED from the selected session during render, never set
imperatively in the click handler, so an SSE re-render cannot drop it. It marks
exactly ONE row — the session's own. A claimed trace whose parent is selected is
marked `data-session-member="true"` and says "in the selected session" in text,
so "current" keeps a single meaning and colour is never the only signal.
Activation reuses `selectSession()` whole, inheriting its filter reset, drawer
close, and URL rewrite. Focus restoration is keyed on the ROW id, not the
session id: several rows legitimately navigate to the same session, so a session
id does not identify the control that was activated. Row activation never
scrolls or focuses on an unrelated re-render.

Each row renders the start instant (`<time datetime>`), duration, pipeline,
status, pass count, and recorded cost through the ONE cost renderer, so an
`unavailable` aggregate can never appear as `$0.00`.

`?hq=` searches **structured identity only** — task id, trace id, app, pipeline,
ticket, status. It never indexes an objective, prompt, preview, or verdict:
letting user-typed text match model-produced content would allow a search to
imply a relationship the projection never recorded.

A `?session=` naming a record outside the delivered window **keeps the
selection** and reports an honest empty projection for it, with a stated reason
and a `— not in current window` option in the chooser. This is the same
out-of-window handling the trace and pass filters already apply. It must NOT
fall back to Live org: a historical view returns to live only when the operator
chooses **Live org**, and a silent reset both widens the scope without saying so
and destroys the meaning of a link that promised one session. Under such a
selection the header cost reports `unavailable`, never `$0.00` — an
authoritative zero for records that were simply not delivered is the
`none`/`unavailable` conflation the cost contract forbids. The reason is DERIVED
from the current snapshot on every render rather than stored, so it can neither
go stale nor be cleared before it is read.

The header session chooser provides the entry point to that scope change, and a
history-index row is the same change reached the other way — the two stay
synchronized in BOTH directions. **Live org** shows the ordinary current projection. Choosing a parent task scopes the
existing app, attention, delivery, graph, activity, history, totals, drawer,
and evidence components to its explicitly correlated traces and tickets;
choosing a standalone trace scopes them to that trace. The browser keeps the
selection while snapshots arrive over SSE and after refresh, labels the view
as historical, and does not jump back to live until the operator chooses
**Live org**. Source health remains current observer health, and GitHub ticket
or PR facts remain current external facts unless a historical event recorded
their earlier state; the UI must not imply it reconstructed an org-wide
point-in-time snapshot that does not exist.

#### Per-section scope labelling (#98)

Every major section — Attention, App lifecycle, Recorded activity, Pending
intake, Product delivery, Execution graph, Live activity, Recorded sessions,
Completion integrity records, Source health — carries a `.scope-badge` with a
`data-scope-kind` drawn from ONE closed vocabulary:

| Kind | Meaning |
| --- | --- |
| `live_app_wide` | the ordinary current projection, nothing narrowing it |
| `filtered_app_wide` | app-wide, narrowed by the explicit filters, which the badge names |
| `parent_task_session` | scoped to the selected parent task |
| `single_trace` | scoped to the selected standalone trace |
| `app_wide_context` | deliberately NOT narrowed by the current selection, with a stated reason |

A session kind WINS over a filter for a session-scoped section — a selected
trace is the narrower projection — but the active filters are never discarded:
they still appear in the badge detail through `activeFacets()`. A section-local
text search (`?gq=`, `?hq=`) is named only in its own section's badge, never in
`activeFacets()`, because it narrows nothing else.

`app_wide_context` is not an escape hatch. A section may only claim it with a
reason from `APP_WIDE_REASONS`, rendered as a `[data-scope-reason]` line in the
section BODY and joined into the list's `aria-describedby`. The three standing
exemptions and their reasons:

- **App lifecycle** — the monthly budget is an app-wide month-to-date fact
  (`AppView.cost_window`, `basis: month_to_date`, `app_wide: true`, never
  narrowed by `since`/`parent_task`/`ticket`). Under a selection the card keeps
  its month-to-date figure unchanged and adds a separately labelled
  `this session:` line, so the two figures are never left side by side
  unexplained. It is never rescoped and never falsified to `$0.00`.
  `budget_status` is the current ledger-derived threshold status;
  `budget_paused` is the separately projected durable admission overlay. A
  surface must not infer one from the other: the overlay can lag, survive a
  restart, or require reconciliation.
- **Source health** — CURRENT observer health, not health as of the session.
  Its rendered values are byte-identical under a historical selection: only the
  label changes. Filtering it, blanking it, or restamping `observed_at` to the
  trace's start would each imply an org-wide point-in-time snapshot that does
  not exist.
- **Pending intake** — carries no trace or task identity, so a session cannot
  include it.

`#history-index` takes the same exemption whenever anything else is narrowed.

`TotalsView.scope_statement` is the server-side half of "totals always state
what they cover": the post-filter app list, the app filter, the time range with
an explicit `all_recorded` / `since_filter` basis, and the canonical sorted
filter list. Claiming `all_recorded` while rows before `since` were dropped, or
listing every configured app while the totals cover one, are the two
falsifications it exists to prevent. The client composes the client-owned trace
scope on top and renders **both** range instants through the one timestamp
policy; the trace is named WITH its app, because a bare trace id is ambiguous.

The statement reports the two filter classes **separately**, because they do
different things:

- **snapshot filters** — `totals.scope_statement.filters`, the server-side
  narrowing (`cormidia observe --app/--ticket/…`). The totals already exclude
  everything it dropped. Rendering only the client dropdowns printed
  `filters: none` under `--ticket 42`, affirmatively denying a narrowing that
  had occurred.
- **display filters** — the client app/role/status/trace/pass/kind/outcome
  controls. These narrow the SECTIONS below and deliberately do **not** narrow
  the header totals, which are the projection's ledger-first aggregate;
  recomputing them client-side would fork the `none`/`unavailable` rule the
  whole surface shares. The statement says so in those words, so both halves are
  true rather than one being true by omission.

For the same reason `scope_statement.apps` remains the server's post-snapshot-
filter list even under a client app filter: it names what the totals cover, not
what is on screen.

Per-entity cost (`TraceView` / `ParentTaskView`: `cost`, `recorded_cost_usd`,
`usage_quality`, `active_passes`) comes from the same `costForPasses` helper as
`totals.cost`, so a row can no longer contradict the header (#89). The client's
former `sessionTotals` cost mirror — a second implementation of the
`none`-vs-`unavailable` rule — is deleted. The helper is settlement-aware in
both directions: a settled row contributes its recorded cost, a genuine provider
pass with no settled row contributes a COUNTED unknown keyed on its pass id, and
a mechanical pass contributes an authoritative zero. Without the middle rule an
unsettled provider turn would aggregate to `coverage: "none"` and render as
`$0.00` (invariant 4). One consequence is deliberate and visible: under a
selection the header is now settled-ledger-first rather than envelope-derived.

The historical page also shows completion integrity:

- required/observed/skipped stages;
- interrupted and stale passes;
- workdir/branch/HEAD consistency;
- usage/cost completeness;
- exact-HEAD Cormidia review status;
- manual fallback;
- PR/merge/issue-close outcome;
- Cormidia end-to-end completeness separately from product completion.

## 6. Authoritative data and projection rules

### 6.1 Source inventory

| Source | UI use | Authority/freshness rule |
| --- | --- | --- |
| Org `apps.yaml` | app identity, status, WIP, budget, cadence/channels | authoritative configuration; read only |
| App `.cormidia/**` | onboarding/config/policy context | display provenance; org registry governs operation |
| GitHub issues/labels | delivery queue and ticket intent | authoritative for queue labels; an advanced delivery state additionally requires its backing artifact |
| GitHub PR/review/check state | review and completion outcome | authoritative external delivery evidence |
| `tasks/<taskId>/` | parent objective, exact outer prompt, fallback, result refs | authoritative parent-task record |
| `runs/<app>/<runId>/envelope.json` | pass identity, status, usage, refs, heartbeat | L1 source of truth per pass |
| `runs/**/events.jsonl` | live structured timeline and spans | append-only L2; a torn trailing line is rejected and degrades the source rather than being reported healthy |
| `brief.md`, `prompt.md`, `output.md`, `session.log` | explicit local forensic evidence | verbatim L3; never preload into overview |
| Ticket journals/worktrees | recovery and phase evidence | supporting process-owned state; do not override GitHub labels |
| `state/planning/apps/<app>/` | RoadmapPlan, validation-contract, delivery-readiness, execution-batch/unit, fast-path, cache and recovery explanations | versioned artifacts and journals are authority; labels are non-authoritative projections and cache evidence affects cost/affinity only |
| `telemetry/<date>.jsonl` | settled per-turn cost and budget attribution | ledger truth after settlement; run envelope may show partial checkpoint first |
| `invocations/<date>.jsonl` | CLI commands plus distinct internal release execution | invocation history, not provider-turn history |
| `locks/` | active role/app ownership | fresh lock is supporting liveness; pass heartbeat is still shown separately |
| `state/schedule.json` and event state | due/fired/pending activity | scheduler-owned durable definition/state; readability alone does not prove scheduler operational health |
| `state/events/inbox/` | company-lifecycle intake | pending until consumed for all subscribers |
| `approvals/` | critical-operation safety queue | authoritative approval state/audit |

The projection must expose per-source freshness and degradation. “GitHub
unavailable” is different from “no ready tickets.” “No heartbeat recorded” is
different from “stalled.” A failed GitHub refresh retains the cached entities'
last successful `observed_at` and reports the failed poll as separate health
evidence; it never restamps stale entities as freshly observed. Scheduler
definition, lock, and inbox readability cannot establish a running scheduler,
so the observer reports scheduler operational health as unavailable unless it
has operational evidence.

Delivery labels describe intent, not completed evidence. `op:building` requires
a correlated non-completed pass, `op:in-review` requires an open PR,
`op:blocked` requires a pending approval, and `op:returned` requires a failed or
otherwise non-completed pass. Without that artifact the delivery projection is
`closed_unknown` with a reason. Merged delivery requires the exact PR/merge
evidence defined by the loop contract; a label alone never upgrades the rung.

Roadmap-delivery explanations are projected once by the read-only product helper and
shared byte-for-structure with Status and Reports. The UI shows RoadmapPlan,
validation-contract, delivery-unit and batch refs as artifact authority while marking
labels as projections. Batch `complete` means every admitted unit has a terminal
disposition; `every_unit_success` is a separate nullable fact. Fast-path reasons never
imply workflow bypass, and absent provider cache telemetry is `unknown`, never zero.
Unreadable planning artifacts degrade the `roadmap_delivery` source and name the claims
whose explanation is affected; they do not yield an empty healthy section.

### 6.2 No second store

The observer may maintain an in-memory index and a bounded SSE replay buffer.
It must not persist a second queue, copy ticket state into a database, or
become required for recovery. On restart it reconstructs everything.

A later performance cache is permissible only if it is disposable,
versioned, content-derived, and safe to delete. It can never become the source
of truth.

### 6.3 Proposed view model

The HTTP API should expose a versioned, strict TypeScript read model rather
than leaking internal file schemas directly. A representative shape is:

```ts
export interface ObserveSnapshotV1 {
  schema_version: 2;
  generated_at: string;
  cursor: string;
  org: OrgView;
  sources: SourceHealthView[];
  apps: AppView[];
  activity_history: { scope: SectionScopeView; rows: ActivityView[] };
  pending_intake: {
    scope: SectionScopeView;
    rows: PendingIntakeItemView[];
    counts: Record<PendingIntakeState, number>;
  };
  delivery: DeliveryTicketView[];
  parent_tasks: ParentTaskView[];
  traces: TraceView[];
  traces_scope: SectionScopeView;
  passes: PassView[];
  approvals: ApprovalView[];
  invocations: InvocationView[];
  activity: ActivityStreamMetaView;
  time_policy: TimePolicyView;
  totals: TotalsView;
  attention: AttentionItemView[];
  attention_groups: AttentionGroupView[];
  roadmap_explanation: RoadmapExplanationV1;
}

// Every ordered or capped collection declares scope, ordering, and
// completeness. `total` is the PRE-cap, pre-client-filter count.
export type OrderDirection = "newest_first" | "chronological";
export interface OrderingView {
  sort_key: string; direction: OrderDirection; label: string; tie_breaker: string;
}
export interface SectionScopeView {
  label: string; total: number; returned: number;
  truncated: boolean; cap: number | null; ordering: OrderingView | null;
}

// The read model DECLARES its timezone contract, exactly as the ratified
// sibling `ReportRange.display_timezone` does (docs/reporting/design.md
// §320-326). The client never has to assume UTC.
export interface TimePolicyView {
  source_timezone: "UTC";
  // The default display zone the client APPLIES — read, not decorative.
  display_timezone: "UTC" | "viewer_local";
  instant_format: "iso8601-utc-ms";
  skew: { future_instants: number; max_future_ms: number; sources: string[] } | null;
}

// Metadata only — no second copy of the events, no persisted index, no store.
export interface ActivityStreamMetaView {
  order: "newest_first";
  order_key_fields: string[];
  tie_break: string;
  total_events: number;
  undated_events: number;
  clock_skew_event_ids: string[];
  completeness: "complete" | "partial";
  incomplete_reasons: string[];
  latest_event_at: string | null;
  latest_heartbeat_at: string | null;
}

export interface AttentionGroupView {
  id: string; cause_key: string; kind: string; cause: string;
  severity: "warning" | "error"; groupable: boolean;
  scope: { app: string | null };
  title: string; detail: string;
  occurrence_count: number;               // ALWAYS the true total
  // `labels` holds role/pass labels (`builder/implement`), NOT role names.
  affected: { passes: string[]; traces: string[]; tickets: string[]; labels: string[] };
  earliest_occurred_at: string | null; latest_occurred_at: string | null;
  occurrences: AttentionOccurrenceView[]; // capped at 500
  occurrences_delivered: number; occurrences_truncated: boolean;
  observed_at: string;
}

export interface AttentionOccurrenceView {
  id: string; app: string | null; entity_id: string | null;
  entity_kind: "pass" | "ticket" | "approval" | "source" | "task" | "intake_event";
  summary: string;                        // entity-level label
  detail: string;                         // per-occurrence divergent text
  occurred_at: string | null;             // a REAL durable instant, never `generated_at`
  evidence_refs: SourceRefView[];
}
```

**Schema version.** `OBSERVE_SCHEMA_VERSION` went `1 → 2` **once** for the
observer-diagnostics workstream (#91/#93/#94/#97). Additive fields alone would
not have required it — `attention_groups`, `time_policy`, `activity`,
`AttentionItemView.group_id`, and the seven new `EventView` fields are all
additive. The bump is owed to a **removal**: `intake: ActivityView[]` no longer
exists and is replaced by `activity_history` + `pending_intake`. This is safe
because the observer persists no cache (§6.2) and has no consumer outside the
bundled client, which ships in the same package. The health route reads the
same constant rather than hardcoding a literal.

**Time policy.** Every instant-valued field in the snapshot is canonical
ISO-8601 UTC with milliseconds (`YYYY-MM-DDTHH:mm:ss.sssZ`), produced by a
single projection helper. A value that was recorded but cannot be read becomes
`null` with the reason appended to that entity's `quality_reason` — never
`"Invalid Date"`, never epoch zero. `PassView.started_at`, `TraceView.started_at`,
and `ParentTaskView.started_at` are therefore nullable.

The projection performs **no** timezone conversion, locale formatting, or
offset arithmetic; only the browser knows the operator's zone. The client
formats per instant via `Intl.DateTimeFormat`, so daylight-saving transitions
are the platform's concern: two instants an hour apart across a boundary render
with different abbreviations, and a fall-back pair that shares a wall clock
renders distinguishably. Every absolute timestamp is a `<time>` element whose
`datetime` is the canonical UTC instant regardless of display mode, with exact
UTC always in the `title`, plus a URL-persisted Local/UTC toggle and a header
statement of the active zone. That policy lives in exactly one place —
`src/report/time-policy.ts` — shared by Observer and Reports; it lives under
`src/report/` because invariant 9 forbids anything importing `src/observe`.

Clock skew is reported as `time_policy.skew` and rendered in the header. It is
a warning and never a negative duration, tolerant to the same 30s window
`passLiveness` already uses so ordinary NTP jitter does not flood the header.
It is deliberately **not** an attention item: that surface belongs to grouping.

export type ActivityKind =
  | "onboarding"
  | "planning"
  | "scheduled_role"
  | "company_event"
  | "manual_role"
  | "learning";

export type DeliveryState =
  | "backlog"
  | "ready"
  | "building"
  | "in_review"
  | "blocked_on_approval"
  | "returned"
  | "merged"
  | "closed_unknown";

export type Liveness = "live" | "stalled" | "terminal" | "unknown";
```

Every entity includes stable identity, source references, `observed_at`, and a
quality/unknown reason where evidence is incomplete. JSON field names use
snake_case, consistent with `cormidia telemetry --json`.

### 6.4 Identity and correlation

Use existing IDs only:

- org name plus app name;
- GitHub repo plus issue/PR number;
- parent task ID;
- trace ID;
- `(app, runId)` for a pass and `(app, providerTurnId)` for a current ledger
  settlement (legacy rows fall back to run identity);
- event `span_id`/`parent_span_id`;
- approval and invocation IDs.

`runId` alone is not globally unique. Text similarity, timestamps, branch
names, or prompt contents must never be used to invent parent/child links.

Attention grouping keys derive only from the enumerated `kind`/`cause`
vocabulary plus org+app scope and, for non-groupable kinds, the entity id. A
group key must never be derived from `title`, `detail`, a timestamp, or any
model-produced text. Activity grouping and graph↔activity focus key exclusively
on `(app, trace_id)` and `(app, runId)`.

`PendingIntakeItemView.discovered_at` is a filesystem mtime. It may be
displayed, and may order pending items within their own section, but it must
never be used to correlate a pending event to a trace, task, or app, nor to
place one in the recorded chronology.

Ordering tie-breakers use a **code-unit** comparator, never `localeCompare`,
which is ICU/locale-sensitive and would make the same durable state render
differently on two machines.

### 6.5 Liveness semantics

- Passes heartbeat every 30 seconds when the executor is healthy.
- A running envelope with a heartbeat no older than the existing three-minute
  telemetry threshold is live.
- A running envelope with an older heartbeat is stalled.
- A running legacy envelope with no heartbeat is unknown, not live.
- A fresh role/app lock supports ownership display but does not replace the
  pass heartbeat.
- A browser/SSE connection being live says nothing about the agent pass.

The UI should show the last timestamp and threshold reasoning in plain text.

### 6.6 Usage and cost semantics

During execution, adapter checkpoints may provide partial cumulative usage.
At finalization, the pass settles exactly once into the org ledger. The UI
must distinguish:

- `complete`: final provider usage is available;
- `partial`: a lower bound from an interrupted/running turn;
- `estimated`: Cormidia-computed equivalent cost, not a provider invoice;
- `unavailable`: a provider turn ran and its usage was not observable;
- `none`: no provider was invoked at all — a deterministic orchestration pass
  (provision/setup, quality gates, the merge state machine). Its zero cost is
  authoritative, not missing.

`none` and `unavailable` are different facts and must never be conflated. A
`none` pass stays visible as an execution step, contributes a real $0, raises no
usage-incomplete attention item, and is excluded from provider-turn counts and
settlement coverage. Only `unavailable` and `partial` are incomplete usage.

This holds for an EMPTY provider set too, on every surface that computes one. A
scope whose passes all invoked no provider is `none` — an authoritative zero —
and only a scope with no pass evidence at all is `unavailable`. Header totals,
the client's session-scoped totals, and `aggregateCost` apply the identical
rule, so "zero provider turns" can never be reported as unknown cost.

Unknown or unavailable cost is never displayed as free, and it never erases
known cost. Aggregates are projected from the settled ledger through the shared
`aggregateCost` primitive (`src/runtime/cost.ts`), which reports a known
subtotal, a separately counted unknown component with drill-down references, and
a coverage verdict of `none` / `complete` / `partial` / `unavailable`. A single
unobservable turn downgrades an aggregate to `partial` — it does not collapse it
to "unavailable". Header totals, app cards, Reports, and `cormidia telemetry` all
project the same object for the same scope and filters, and
`test/report/cost-reconciliation.test.ts` fails when any two disagree.

### 6.7 Corruption, pruning, and legacy records

- A malformed trailing JSONL line is treated as a torn append and retried.
- Mid-file corruption creates an attention item and preserves every readable
  fact; it must not disappear silently.
- An unreadable envelope appears as `corrupt(envelope)`.
- Pruned L3 evidence shows “expired by retention” rather than a broken link.
- Legacy missing fields show “not recorded” or “unknown.”
- The observer never synthesizes parent tasks or reviewer/merge evidence for
  legacy runs.

## 7. Local server architecture

### 7.1 CLI contract

Proposed usage:

```text
cormidia observe [--app <name>] [--parent-task <id>] [--ticket <number>]
               [--port <number>] [--open] [--no-open]
               [--org-home <path>] [--state-home <path>]
```

Defaults:

- bind only to `127.0.0.1`;
- choose a documented default port, falling back to an ephemeral port if it is
  occupied;
- print the exact local URL and resolved org/state homes;
- remain in the foreground until interrupted;
- do not open a browser unless `--open` is supplied;
- make SIGINT/SIGTERM stop only the observer, never a Cormidia turn;
- perform no provider turn and spend no tokens;
- perform only read operations against GitHub.

The command should be listed by `cormidia capabilities --json` as read-only and
token-free. An outer coding agent can start it in a managed background shell
and hand the URL to the human. Cormidia should not silently auto-start a server
for every task.

### 7.2 Process and module boundary

Add a presentation-only leaf layer:

```text
src/observe/
  types.ts             versioned public read model
  project.ts           pure source records → view projection
  source-health.ts     freshness/degradation rules
  file-index.ts        run/task/ledger/invocation/approval readers
  github-source.ts     read-only queue/PR/review projection
  live-source.ts       watch + polling reconciliation
  server.ts            HTTP, SSE, auth, artifact routes
  assets/              framework-free HTML/CSS/JS
src/cli/observe.ts      argument parsing and lifecycle
```

`src/observe` may import `src/org`, `src/loop`, and `src/runtime`; none of
those layers imports `src/observe`. This preserves the existing one-way core
architecture. Prefer extracting reusable pure telemetry projection helpers
over importing private CLI renderer functions.

### 7.3 Transport

Use ordinary HTTP for the initial snapshot and SSE for live changes:

```text
GET /api/v1/snapshot
GET /api/v1/events?cursor=<cursor>       text/event-stream
GET /api/v1/artifacts/<app>/<run>/<kind>
GET /api/v1/tasks/<task>/<kind>
GET /healthz
```

There are no workflow mutation endpoints. Authentication/session bootstrap
may use a non-workflow endpoint if needed, but the API has no ticket, approval,
runtime, or configuration `POST`/`PUT`/`PATCH`/`DELETE` operations.

SSE is preferable to WebSockets because updates are server-to-browser. Each
event has a monotonic observer cursor and one of:

- `snapshot` — initial or forced full replacement;
- `entity.upsert` — one versioned view entity changed;
- `entity.remove` — a projected entity left the selected window;
- `source.health` — a source became healthy/degraded/unavailable;
- `resync` — the client cursor is outside the replay buffer.

The client reconnects with its last cursor. If the cursor is unavailable, it
fetches a new snapshot. SSE delivery is an optimization; correctness always
comes from reconciliation with durable sources.

### 7.4 Change detection

Use two mechanisms:

1. File notifications for low-latency updates.
2. A periodic reconciliation scan because filesystem watchers can coalesce or
   miss events across platforms.

Append-only files are tailed from a remembered byte offset, but inode/size
changes trigger safe re-read. Whole-file atomic renames are expected. Bursts
are debounced before projection so a pass finalization does not cause a dozen
contradictory frames.

Suggested targets:

- local envelope/event update visible within 2 seconds at p95;
- GitHub state visible within its explicit 15–30 second read-only poll window;
- heartbeat age refreshed at least every 10 seconds in the browser;
- no more than one full historical scan at startup;
- lazy-load completed history and L3 artifacts.

Do not hammer GitHub or make the UI's poll cadence part of dispatch behavior.
GitHub polling failure degrades that source while local live runs continue to
render.

### 7.5 Frontend technology

The first implementation should use semantic HTML, CSS, and a small
TypeScript/JavaScript client with no runtime UI framework. Cormidia is one CLI
package, and a React/Vite application would add build and packaging machinery
before the interaction model justifies it.

Required frontend behaviors:

- keyed incremental rendering without losing drawer/filter state;
- keyboard navigation and visible focus, including explicit focus restoration
  for any control a re-render destroys, and focus taken only when a surface
  OPENS rather than on each snapshot that re-renders it while open;
- a drawer that declares `aria-modal` must actually be modal: the background is
  marked `inert` while it is open, so Tab, pointer, and the accessibility tree
  agree with the declaration;
- toggle buttons carry a FIXED label naming the state they turn on, with
  `aria-pressed` reporting whether that state is active — a label naming the next
  action beside `aria-pressed` naming the current one announces a contradiction;
- a control that cannot act uses `aria-disabled` (staying focusable so its stated
  reason is reachable) rather than `disabled`, and never carries an `aria-label`
  that hides its visible text;
- responsive layout at 360px and desktop widths;
- `prefers-reduced-motion` support;
- text/icon status in addition to color;
- bounded virtualized or paged history rather than an unbounded DOM;
- no third-party fonts, scripts, analytics, or external requests.

If implementation evidence shows the framework-free client becoming a custom
framework, stop and propose a dependency with measured reasons.

## 8. Security and privacy boundary

Live observability handles more sensitive material than the terminal summary.
L1/L2 records are structured and scrubbed, but `brief.md`, `prompt.md`,
`output.md`, and `session.log` are local, verbatim L3 evidence. The server must
therefore satisfy all of the following:

1. Bind to loopback only. V1 has no `--host 0.0.0.0` escape hatch.
2. Mint a high-entropy per-process capability token and require it for browser,
   SSE, and artifact access. Never log the token.
3. Emit `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
   `X-Content-Type-Options: nosniff`, a restrictive Content Security Policy,
   and frame denial.
4. Use no external assets or network requests from the browser.
5. Escape every prompt, output, verdict, path, and event field. Never inject
   model text with `innerHTML`.
6. Render only scrubbed, bounded previews in overview/stream payloads using
   the canonical secret scrubber.
7. Never include raw L3 content in the initial snapshot or SSE stream.
8. Require an intentional click to fetch a full local artifact, label it as
   potentially sensitive, and serve it as escaped text with no caching.
9. Resolve artifact routes from validated IDs and an allowlist of filenames;
   reject `..`, symlink escapes, absolute paths, unknown refs, and paths outside
   the resolved state home.
10. Never persist browser filters, artifact contents, or access tokens into
    the org/app repositories.
11. Label `session.log` as an activity log. Native transcript capability comes
    only from `envelope.session`.
12. Do not expose raw tool arguments. L2 contains only names/outcomes and
    argument hashes.

Remote/droplet access is a separate design requiring authenticated transport,
TLS, origin policy, and an explicit threat model. SSH port forwarding to the
loopback server is preferable to adding unauthenticated network binding.

## 9. Reliability and operational behavior

- Observer startup failure never blocks `cormidia loop` or `cormidia dispatch`.
- Observer shutdown never cancels a pass.
- Browser disconnection never changes durable state.
- Restart reconstructs active passes, queue state, and history.
- A slow browser has a bounded per-client buffer; it is told to resync rather
  than consuming unbounded server memory.
- Large artifacts stream only on demand with preview/size limits.
- Multiple observers are allowed because all are readers; each has its own
  access token and in-memory cursor space.
- A source-health panel distinguishes local filesystem, GitHub, approvals,
  ledger, and scheduler health.
- Clock skew and future timestamps create warnings rather than negative
  durations.
- The observer's own logs contain request/error metadata but no prompt,
  output, artifact content, token, or authorization material.

## 10. Implementation sequence

### Phase 0 — ratify contracts

- Confirm the command name `cormidia observe`.
- Ratify the read-only/local-only boundary.
- Ratify GitHub `op:ready` as the delivery queue and the separate Activity,
  Onboarding, and Approvals concepts.
- Confirm whether Playwright may be added as a development-only test
  dependency.
- Add the high-level decision to `docs/PURPOSE.md` only after approval.

### Phase 1 — pure projection

- Extract/share telemetry report projections without changing current CLI
  output.
- Add queue, app-lifecycle, invocation, approval-summary, and source-health
  views.
- Define `ObserveSnapshotV1` and fixture builders.
- Pin every status, unknown, precedence, and liveness rule with unit tests.

Exit: a deterministic snapshot can be generated from a temporary org/state
home and fake GitHub source with zero server/UI code.

### Phase 2 — local snapshot server

- Add CLI registration/help/capability metadata.
- Add loopback server, capability token, headers, snapshot endpoint, health,
  and allowlisted artifact routes.
- Package static assets in source-backed and packed installations.

Exit: `cormidia observe` renders a complete historical snapshot and survives
packaging/onboarding smoke tests.

### Phase 3 — live updates

- Add file watch plus reconciliation.
- Add append-tail handling and atomic-rename handling.
- Add SSE cursor/reconnect/resync.
- Add read-only GitHub polling and independent source degradation.

Exit: fixture mutations and a real running pass update an already-open browser
without refresh.

### Phase 4 — execution UX

- Add overview, attention, app lifecycle/intake, delivery columns, graph,
  activity stream, pass drawer, and completion integrity.
- Add reduced motion, keyboard access, responsive behavior, and bounded
  previews.

Exit: an operator can diagnose a fresh, stale, failed, blocked, and completed
trace without reading raw state files.

### Phase 5 — convergence and live proof

- Reuse the projection in `cormidia telemetry` where doing so preserves its
  stable JSON contract.
- Add links from the Live UI to portable telemetry/evidence export.
- Complete sandbox proof, then the authorized buildstacks.dev acceptance run.
- Record exact evidence and discrepancies; do not declare completion from a
  demo alone.

## 11. Test strategy

### 11.1 Unit tests

Use Vitest, strict TypeScript, existing fake clocks, and composable org-home
fixtures. At minimum cover:

- app lifecycle: onboarding/live/paused;
- GitHub label → delivery-state mapping, including conflicting/missing labels;
- scheduler claim ordering and dependency-blocked tickets;
- scheduled/event activity remaining distinct from the ready queue;
- parent task → trace → pass correlation;
- pre-ticket planning grouping;
- selected, skipped, missing, and legacy trace manifests;
- live/stalled/unknown liveness at exact clock boundaries;
- running partial usage followed by settled final usage;
- estimated/unavailable totals;
- approval linkage and re-arm evidence;
- failed infrastructure status versus merit findings;
- corrupt envelope, torn trailing JSONL, mid-file corruption, and pruned L3;
- source degradation versus a genuine empty result;
- stable cursors and idempotent upserts;
- HTML/text escaping and secret-scrubbed previews;
- path traversal, symlink escape, unknown artifact, and cross-org rejection.

Projection tests should use table-driven inputs and golden JSON sparingly;
assert semantic fields so harmless ordering/style changes do not rewrite large
snapshots.

### 11.2 Server integration tests

Start the real observer on port `0` against a temporary state home and fake
GitHub source. Verify:

1. Snapshot schema, filters, source health, and no-store/security headers.
2. Missing/invalid capability token is rejected.
3. No workflow mutation route exists.
4. Adding a running envelope emits exactly one logical upsert.
5. Appending events produces ordered SSE events.
6. Atomic envelope replacement updates status without transient disappearance.
7. Finalization plus ledger settlement updates usage once.
8. Disconnect/reconnect resumes from the cursor.
9. An expired cursor receives `resync` and a fresh snapshot converges.
10. GitHub failure degrades only GitHub-derived fields.
11. Stopping the observer leaves a simulated running executor untouched.
12. Large histories and artifacts stay within explicit response/memory bounds.

Use Node's real HTTP client/fetch; do not mock the server boundary itself.

### 11.3 Browser and visual behavior

Recommended: add Playwright as a **development-only** dependency after the
dependency decision in Phase 0. Browser tests should verify:

- the overview updates without navigation/reload;
- queue-to-building-to-review transitions keep one ticket card;
- graph arrows/nodes match selected passes and skips;
- drawer prompt/output links resolve only after the artifact exists;
- activity log is never labeled transcript;
- filter/deep-link state survives refresh;
- reconnect and resync banners are truthful;
- keyboard navigation, focus order, drawer dismissal, and live-region behavior;
- reduced-motion mode removes pulses/transitions;
- 360px, tablet, and desktop layouts;
- model-supplied HTML/script is rendered as text;
- no external browser requests occur.

Keep a small, intentional set of screenshot baselines for overview, active
trace, approval wait, and failure. Browser screenshots supplement semantic
assertions; they do not replace them.

If Playwright is rejected, server/DOM-free tests remain mandatory and the live
run must use an installed browser-automation tool. That is a weaker CI safety
net and should be recorded as such.

### 11.4 Failure-injection tests

Deterministically exercise:

- observer starts before any run exists;
- pass starts before `events.jsonl` exists;
- append is torn mid-line and then completed;
- envelope is corrupt then repaired;
- heartbeat stops while server/browser remain healthy;
- GitHub becomes unavailable and later recovers;
- ledger settlement arrives after pass finalization;
- event is duplicated or observed after envelope finalization;
- server restarts during a running pass;
- browser is disconnected long enough to exceed the replay buffer;
- retention removes L3 while the page is open;
- two apps have colliding `runId` values;
- clock moves backward/forward.

### 11.5 Security tests

- Bind assertion proves no non-loopback listener exists.
- Capability tokens are random, required, absent from logs, and invalid after
  process restart.
- CSP and all response headers are present.
- Artifact IDs cannot access another run/task or arbitrary local files.
- Symlinks cannot escape state home.
- Prompt/output/event payloads cannot inject HTML, script, CSS, URLs, or SSE
  frames.
- Overview and SSE payloads never contain raw L3 contents.
- Raw artifact responses are explicit, escaped/text-only, and `no-store`.
- Tool arguments and environment variables never enter the projection.

### 11.6 Required repository verification

For implementation changes:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm smoke:onboarding
npm pack --dry-run
```

The last two are required because a new CLI command and bundled browser assets
change discovery/packaging. Also verify from a neutral working directory that
the observer resolves the active org rather than treating the Cormidia package
checkout as an org home.

No live provider test replaces this offline suite.

## 12. Live acceptance: buildstacks.dev through Bikram-Org

### 12.1 Purpose

The live acceptance test should exercise a genuine Cormidia flow while the UI is
already open:

```text
existing buildstacks.dev design
        → onboarding/registration
        → pre-ticket planning
        → published op:ready tickets
        → claim/build/gates/review/ship
        → final telemetry and evidence reconciliation
```

This proves both sides:

- Cormidia can execute normally with the observer present.
- The observer shows enough live evidence to understand and troubleshoot that
  execution without becoming part of it.

The design source currently available on this machine is:

```text
~/Build/buildstacks.dev/docs/design/buildstacks-design-spec.md
~/Build/buildstacks.dev/docs/design/buildstacks-prototype.html
```

### 12.2 Handoff baseline observed on 2026-07-12

This is a snapshot to verify, not an instruction to mutate or a guarantee that
the state remains unchanged:

- Installed `cormidia context --json` resolves org `Bikram-Org`, org home
  `~/Build/Bikram-Org`, and state home `~/.cormidia/Bikram-Org`.
- `~/Build/Bikram-Org/apps.yaml` currently has no registered apps.
- The buildstacks.dev checkout contains `.cormidia/config.yaml` with
  `status: onboarding` plus the design artifacts above.
- The checkout was clean at commit `14f7fbb624335406a9c7044f32a24e932287c7e8`
  on branch `build/buildstacks-v1`.
- Installed `cormidia status --app buildstacks.dev` showed no current run rows.
- The org approval list was empty, and GitHub showed no open issues or PRs in
  `buildstacks-dev/buildstacks.dev`.

If “vikram.org” refers to a different org than the installed `Bikram-Org`, the
new session must stop and select/confirm the intended org. It must not create a
second org or guess from the current directory.

### 12.3 Authorization boundary

The test spends real tokens and can create GitHub issues, branches, PRs,
reviews, and merges. Before the live portion, the human must confirm:

- the intended org and app/repository;
- whether this is a bounded new design slice or a full clean replay;
- whether the test may publish tickets and merge reviewed work;
- that no production deploy is part of the test;
- the token/budget ceiling;
- whether any existing app state should be reset.

Never run `cormidia app reset ... --execute` as an inferred test setup step. Its
non-mutating plan is safe; execution requires the explicit reset authorization
and confirmation already defined by Cormidia.

### 12.4 Preflight

Run and preserve exact output:

```sh
command -v cormidia
cormidia capabilities --json
cormidia context --json
cormidia org show --json
cormidia doctor --json
cormidia apps
cormidia approvals list
cormidia budget

git -C ~/Build/buildstacks.dev status --short
git -C ~/Build/buildstacks.dev branch --show-current
git -C ~/Build/buildstacks.dev rev-parse HEAD
gh auth status
gh issue list --repo buildstacks-dev/buildstacks.dev --state open
gh pr list --repo buildstacks-dev/buildstacks.dev --state open
```

After implementing the UI, install the source-backed command and repeat
capability/context discovery from a neutral directory:

```sh
pnpm link:local
cd /tmp
cormidia capabilities --json
cormidia context --json
```

If buildstacks.dev is not registered, follow the installed skill's existing-app
bootstrap procedure: scan the local checkout first, use a human-reviewed
answers file, review emitted `.cormidia/**`, and confirm the resulting org
registry entry. Do not hand-edit human-ratified configuration just to make the
test convenient.

Before spending tokens:

```sh
cormidia plan buildstacks.dev --dry-run
cormidia loop --app buildstacks.dev --once --dry-run
cormidia dispatch --dry-run
```

An onboarding app can be exercised with an explicitly invoked manual loop once
it is registered. Autonomous dispatch remains reserved for apps whose
human-ratified status is `live`.

### 12.5 Create one correlated acceptance task

Create an exact prompt file describing the design slice, non-deploy boundary,
completion criteria, and UI assertions. Begin one parent task before planning:

```sh
cormidia task begin \
  --id live-ui-buildstacks-<date> \
  --app buildstacks.dev \
  --prompt-file <exact-prompt-file>

export CORMIDIA_PARENT_TASK_ID=live-ui-buildstacks-<date>
```

The task ID must stamp planning and loop passes so the UI and final report can
filter out historical buildstacks.dev work. If any implementation or review
continues outside Cormidia, record `cormidia task fallback` immediately; do not let
the UI claim end-to-end Cormidia completion.

### 12.6 Start observation before work

In a separate managed process:

```sh
cormidia observe \
  --app buildstacks.dev \
  --parent-task live-ui-buildstacks-<date> \
  --open
```

Record the observer URL, start time, source-health state, and an initial
screenshot. The empty/new task view must be valid; the server must not require
a run to exist before starting.

### 12.7 Run the real flow

Use the existing design as product truth and a bounded goal approved in the
preflight. The intended sequence is:

1. Run automatic planning with the parent task set. Publish the validated plan
   only after confirming the live-test authorization permits GitHub writes.
2. Confirm dependency-free published issues receive canonical tier, priority,
   and `op:ready` labels; dependent issues do not become ready early.
3. Run `cormidia loop --app buildstacks.dev --once` for bounded ticks, or
   `--follow` only when the operator explicitly wants the continuous driver.
4. Allow the normal Builder → gates → Reviewer → fix/ship state machine to
   operate. Do not bypass approvals or quality gates for the UI demo.
5. Do not deploy buildstacks.dev. A release approval, if the ticket declares a
   deployable milestone, is an expected safety stop rather than a UI failure.

Keep the observer in a separate process. Do not pipe Cormidia output into the UI;
the proof is that the UI reconstructs the flow from durable sources.

### 12.8 Live assertions by phase

| Phase | Required UI evidence |
| --- | --- |
| Observer before work | Correct org/app, read-only indicator, healthy local source, empty task without error |
| Parent task begins | Objective, original prompt reference/hash, required stages, running state |
| Planning starts | Pre-ticket trace appears; selected depth/factors/skips; Planner pass becomes live |
| Planning progresses | Heartbeat age moves; scrubbed activity/tool events append; exact prompt/brief links resolve intentionally |
| Planning completes | Output/verdict appears; final usage quality/cost replaces pending/partial state |
| Tickets publish | GitHub tickets appear once; priority/dependencies/ready status match GitHub |
| Claim | One card moves atomically from Ready to Building; no duplicate ready/building cards |
| Builder pass | Role/runtime/model, workdir/branch/HEAD, live activity, and tool counts are visible |
| Gates | Gate command identity and bounded scrubbed failure tail are visible; remediation is linked to the same ticket |
| Review | Independent Reviewer pass and exact PR HEAD are visible; stale or missing review is not shown as approval |
| Approval wait, if any | Ticket is `op:blocked`, approval item is linked, and UI offers no decision button |
| Completion | PR/merge/issue state, all required stages, final usage, and completion-integrity verdict converge |

During one active pass:

1. Refresh the browser and confirm state reconstructs.
2. Disconnect/reconnect the browser network or SSE connection and confirm
   cursor recovery without duplicated events.
3. Stop and restart only the observer; confirm the Cormidia pass continues and
   the new server reconstructs it.
4. Open prompt, output, event stream, and activity-log evidence; verify the
   activity log is not labeled transcript.

Do not deliberately kill a production-app provider turn merely to test stale
recovery. Cover that deterministically in fixtures or a disposable sandbox.

### 12.9 End-state reconciliation

After the flow reaches its authorized stopping point:

```sh
cormidia telemetry \
  --app buildstacks.dev \
  --json

cormidia telemetry \
  --app buildstacks.dev \
  --html /tmp/live-ui-buildstacks-<date>.html

cormidia status --app buildstacks.dev
cormidia analyze --app buildstacks.dev
cormidia budget
cormidia approvals list
```

Compare the final Live UI projection with:

- telemetry JSON run IDs, trace IDs, statuses, usage, and totals;
- the portable HTML/evidence links;
- GitHub issue labels/state;
- PR head, checks, review, and merge state;
- parent task result and fallback mode;
- per-pass envelope/event files and ledger settlement.

Finish the parent task only at the actual outcome boundary, supplying the real
ticket/trace/branch/PR/review/deployment refs. If work stopped before the
required outcome, finish it as failed/cancelled or leave it honestly running;
do not mark it complete for a successful UI demonstration.

### 12.10 Live acceptance thresholds

The buildstacks.dev test passes only if:

- Cormidia behavior and durable artifacts are unchanged by observer presence;
- every observed pass appears exactly once under `(app, runId)`;
- local live changes appear within 2 seconds at p95 in captured measurements;
- GitHub changes appear within the documented poll interval;
- browser/observer restart converges without event or entity duplication;
- status/liveness, prompts, outputs, activity, usage quality, and costs are
  truthfully labeled throughout the run;
- the final UI and telemetry JSON agree on all shared fields;
- no external browser request, workflow mutation endpoint, secret-bearing
  overview payload, or public listener is present;
- the UI clearly separates onboarding, activity/intake, delivery queue, and
  approval state;
- a human can identify a deliberately fixture-injected failure from the UI
  without opening raw state files.

Record the run under a dated investigation directory following the existing
buildstacks investigation pattern. Include exact commands/results, source and
commit identities, screenshots, latency observations, final telemetry paths,
hashes, discrepancies, and any manual fallback. Do not silently fix defects
during the acceptance record; log them and handle them through ordinary
tickets.

## 13. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| UI becomes a second control plane | No workflow mutation endpoints or controls; filters/links only |
| “Queue” hides non-ticket org work | Separate Onboarding, Activity/Intake, Delivery, and Approval concepts |
| Display drifts from scheduler behavior | Reuse scheduler ordering/state helpers; GitHub remains authoritative |
| Observer availability becomes runtime dependency | Projection-only process; no writes; restart from durable sources |
| Running animation creates false confidence | Require fresh pass heartbeat and show timestamp/reason |
| Unknown cost appears free | Preserve usage quality and lower-bound semantics |
| Raw prompts/logs leak | Loopback + capability token; scrubbed previews; explicit on-demand L3 fetch |
| Browser content injection | Escape all model text; strict CSP; no `innerHTML` for evidence |
| File watchers miss events | Watch for latency, periodic reconciliation for correctness |
| GitHub polling fails | Independent source health; local traces continue; never render empty as healthy |
| Large history overwhelms UI | Active/recent default, lazy history, bounded buffers/artifact previews |
| New UI dependencies bloat the package | Framework-free v1; deliberate approval for dev-only browser testing |
| Live test damages production work | Preflight, bounded goal, no deploy, no inferred reset, sandbox failure injection |

## 14. Definition of done

Implementation is complete only when:

- the product/queue/read-only decisions are ratified;
- `cormidia observe` is discoverable, packaged, local-only, token-free, and
  reconstructable;
- overview, delivery, activity, execution graph, pass evidence, cost, source
  health, and completion integrity meet this contract;
- deterministic unit, integration, browser, failure, security, accessibility,
  packaging, and neutral-CWD tests pass;
- existing `cormidia telemetry --json` compatibility is preserved or deliberately
  versioned;
- a sandbox live run proves failure/recovery cases;
- the authorized buildstacks.dev/Bikram-Org run meets the live acceptance
  thresholds and leaves an evidence record;
- architecture/command/testing documentation and the nearest `AGENTS.md` are
  updated for the implemented contract;
- known limitations and deferred remote-hosting/control features are explicit.

## 15. Handoff checklist for a new session

1. Read `docs/PURPOSE.md`, this document, `docs/architecture.md` §§2/9/10,
   `docs/loop/design.md` §§7/9, and the prior buildstacks telemetry investigation.
2. Run the Cormidia skill discovery commands; verify the active org and state
   home.
3. Check current Git status and preserve unrelated user changes.
4. Confirm Phase 0 decisions before editing human-ratified surfaces or adding
   dependencies.
5. Implement phases in order, keeping projection logic pure and the observer
   outside the core import direction.
6. Run the complete offline/packaging suite.
7. Prove live behavior on a disposable sandbox first.
8. Re-run the buildstacks preflight; do not rely on the dated baseline above.
9. Obtain explicit authorization for token/GitHub/merge scope.
10. Run and document the correlated buildstacks acceptance flow without a
    production deploy.

## 16. Triggered-validation evidence addendum (2026-07-31)

The versioned snapshot includes the product-owned
`validation_campaigns: {reports, corrupt}` read model from
`validation/campaigns/*/report.json`. This is live app-wide/current evidence and is not
narrowed into a selected product session. Target-app filtering may hide reports for
other apps, while corrupt records remain visible because their scope cannot be trusted.

Cards show separate completeness/verdict, case coverage, and spend. `inconclusive`
uses blocked—not completed—visual semantics and the literal “NOT A PASS; NOT RELEASE
EVIDENCE.” Corrupt reports are failed/incomplete; no report means “No validation
campaign evidence recorded,” never healthy. The section links
`docs/qualification/validation-triage.md`. Observe stays read-only: it never resumes,
repairs, reconciles, or reruns a campaign.
