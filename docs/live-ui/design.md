# Cormidia Live UI — observability contract

*Ratified and implemented; this is the authoritative contract for
`src/observe/**` and `cormidia observe`. The original full design (rationale,
implementation phases, test plans, the dated buildstacks acceptance runbook)
is preserved at `929c8247:docs/live-ui/design.md`.*

## 1. What the Live UI is

Cormidia stays **agent-operated and human-observable**: work enters through a
coding agent or the CLI; a local, read-only Live UI shows what the org is
doing, what is waiting, why a pass is running, whether it is healthy, what
evidence it produced, and what needs attention.

```sh
cormidia observe --app <app> --open
```

starts a loopback-only HTTP server that reconstructs current state from
Cormidia's durable artifacts and streams changes via SSE. It owns no workflow
state and offers no configuration or mutation controls; stopping it cannot
stop or alter Cormidia work; restarting reconstructs the same view from disk
and GitHub. A running trace updates live; once it ends, the same page is its
permanent recorded snapshot. `cormidia telemetry` terminal/JSON/HTML remain
supported views over the same facts.

**The queue decision:** application creation/bootstrap is **onboarding**, not
queue work; GitHub issues labeled `op:ready` are the canonical
**product-delivery queue**; other `op:*` labels are states of claimed or
waiting work, not additional queues; scheduled/event-driven role turns are
live org activity and intake, never retroactively presented as ready-ticket
queue entries; the approval queue is a separate safety queue — observable, but
decisions stay in the CLI/agent workflow. No new canonical queue or telemetry
database exists.

## 2. Decision status

The concise product decision is recorded in `docs/PURPOSE.md`; the execution
contract is here. Standing constraints inherited from PURPOSE: GitHub is the
source of truth for tickets/PRs/delivery state; the dispatcher is a stateless
tick; Cormidia state is durable in git plus files; human approval is required
only for critical operations; dashboards read structured run state and never
infer truth from model prose or pretend an activity log is a transcript.

## 3. Product contract

**Interaction model:** `human → coding agent or CLI → Cormidia runtime →
GitHub/app artifacts`; the Live UI is a read-only projection alongside that
path, never an alternative workflow engine.

**Goals** — without opening multiple terminals, an operator can answer: which
org/app am I observing; is the observer fresh/degraded/stale; which app is
onboarding/live/paused; which tickets are ready/claimed/reviewing/returned/
blocked; which role/pass is executing and why; is it progressing or merely
marked `running`; what prompt/brief went in; what structured activity, tools,
subagents, gates, escalations occurred; what output/verdict appeared; what is
the usage/cost quality; which branch/commit/PR/review/issue/deployment is the
durable result; did every required stage actually complete.

**Non-goals (standing):** no configuration editors; no
create/label/retry/cancel/approve/deny/merge/deploy/publish controls; no
embedded chat or second agent interface; no workflow designer; no alternative
issue store; no cloud ingestion, multi-user hosting, or remote binding; no
promise of full transcripts where a provider exposes none; no animation
implying work unsupported by durable evidence. Links may open GitHub, a
native provider session, or a local evidence artifact; copying identifiers
and filtering are the only safe interactions.

## 4. Vocabulary and the queue model

| Term | Meaning | Authoritative source |
| --- | --- | --- |
| App lifecycle | `onboarding`, `live`, or `paused` | org `apps.yaml` |
| Onboarding | create/bootstrap/register an app and produce enough product truth to begin planning | app `.cormidia/**`, org registry, planning artifacts |
| Intake signal | human request, feedback, adoption signal, alert, schedule, or other event that wakes a role | parent task, file-drop event, GitHub event, schedule state |
| Product-delivery queue | open GitHub issues carrying `op:ready` | GitHub |
| Delivery work item | one GitHub issue moving through the build-loop state machine | GitHub labels plus loop artifacts |
| Parent task | the broader outcome delegated by a human/outer agent | `tasks/<taskId>/task.json` and prompt |
| Trace | one selected pipeline execution, potentially several passes | correlated run envelopes |
| Pass | one provider turn by one role in one app | `runs/<app>/<runId>/` |
| Invocation | one CLI command or distinct internal release execution | `invocations/<date>.jsonl` |
| Approval item | a critical operation waiting for a human decision | `approvals/` |

- **Onboarding is a separate lifecycle** — an Onboarding lane/card, never a
  fabricated `op:ready` entry. `onboarding → live` is human-ratified policy;
  the UI reports it, never changes it.
- **GitHub is the delivery queue.** Only `op:ready` means claimable.
  Dependency-blocked or ungroomed issues are backlog/intake. `p1`–`p3` affect
  dispatch order; the UI shares the scheduler's ordering logic rather than
  implementing a subtly different one. The browser never updates labels; a
  displayed state change is accepted only after authoritative GitHub state or
  a durable local transition record says it occurred.
- **Work that does not begin as a ready ticket** (scheduled/event Planner,
  SRE, Support, Marketing, distillation, learning review, manual runs)
  renders as **Activity/Intake** entries with trigger and result, linked to a
  published ticket only where correlation evidence exists — never inferred
  from similar text.
- **The approval queue stays separate.** `op:blocked` links a ticket to an
  approval item, but the item has its own identity, TTL, scope, audit, and
  outcome. The UI shows state and the re-arm when recorded; it never
  approves/denies — it may display the exact CLI command.

## 5. User experience and information architecture

### 5.1 Global shell

Every page carries a compact header: org name + resolved state-home identity;
a session chooser (**Live org** plus historical parent tasks and standalone
traces); selected app or all apps; connection state
(`live`/`reconnecting`/`degraded`/`offline`); last successful local
projection and GitHub refresh times; active pass count and org WIP limit;
pending approvals; recorded monthly spend with its quality marker; a clear
**READ ONLY** indicator.

Filters live in URL state so an agent can hand the human a stable link
(initial: app, parent task, ticket, status, role, time range; the selected
session too). "Session" is presentation vocabulary, not a durable entity: a
parent task is the preferred boundary; a trace without one is a standalone
historical session. The chooser never groups by native provider session ID or
infers correlation from timestamps/text. `--parent-task` initializes the
browser selection; `--app` is an explicit server-side scope.

### 5.2 Overview page — four ordered sections

**A. Attention** renders **one card per (cause, scope) group**, not one per
occurrence (26 identically-caused passes = one card, `26 occurrences`). Each
group declares severity as a **word** (never colour alone);
`occurrence_count` always the true total even when delivery is capped;
affected passes/traces/tickets/role-pass labels each on its own line naming
its own facet; ordering (`most severe first`, then occurrence count
descending); expandable occurrences (`<details>`/`<summary>`) each with real
entity id, real durable timestamp, and evidence refs. Grouping keys derive
**only** from the typed closed-vocabulary `kind`/`cause` fields plus org+app
scope (§6.4):

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

Non-groupable kinds are independently actionable (two returned tickets are
two decisions) and render as singleton groups embedding the entity id.
`usage.quality: "none"` is an authoritative zero (§6.6): it raises **no**
attention item — the condition is `partial || unavailable`, never
`!== "complete"`. The flat `attention` array keeps the complete unaggregated
truth; every item carries a `group_id` resolving to exactly one group, so the
grouping is mechanically verifiable. Empty is healthy and small.

**B. App lifecycle** shows each selected app's lifecycle, recent artifacts,
and an explicit reason when Support/Marketing is channel-gated. Beneath the
cards, two **separately named collections**, never concatenated:

- **Recorded activity** (`activity_history`) — dated execution evidence. Rows
  are non-nullable in `started_at`/`latest_at`/`occurred_at`, so a row
  without a recorded timestamp can never enter a chronological collection —
  a type invariant, not a convention. Under a session selection, membership
  is a **positive** identity match (the row's trace is one of the session's
  traces, or its `parent_task_id` IS the selected task's id); a null
  `parent_task_id` is the absence of correlation and never a match.
- **Pending intake** (`pending_intake`) — undated or independently-timed work
  awaiting pickup (`state/events/inbox/*.json`, apps awaiting promotion).
  Rendered as `<ul>` (explicitly not a sequence), with per-state `counts`;
  each row's `timestamp_basis` says whether the shown time is `occurred`,
  `discovered` (filesystem receipt), or `none`. `pending` is the NORMAL
  state of an inbox file and raises no attention item. `discovered_at` is
  display-only and never a correlation key (§6.4).

Both ship a `SectionScopeView` (label, pre-cap `total`, `returned`,
`truncated`, `cap`, `OrderingView`). **Every** ordered or capped collection
in the read model declares those facts, and the client renders `showing N of
M` rather than silently slicing — no exemptions: recorded activity, pending
intake, attention occurrences, the execution graph, the live activity stream
and its undated tail, and recorded sessions/completion integrity all read
their cap from one named limit key in `DEFAULT_LIMITS`, render disclosure
through the same scope badge, and offer a `Show more` control that raises
that key (named per section; focus explicitly restored after re-render, so
keyboard paging never drops the operator at `<body>`). A badge printing a
pre-cap total beside a silently sliced list is worse than a bare slice: it
affirmatively asserts a count the section does not show.

**C. Delivery work** — grouped columns/list: Ready (`op:ready`, scheduler
claim order), Building, Reviewing, Waiting approval, Returned, Recently
completed (with Cormidia evidence). Cards show issue/title, priority/tier,
dependencies, age, phase, active role/pass, branch/PR when known, latest
meaningful event — no long model text.

**D. Live activity** — a chronological stream of structured events across
active traces (pass lifecycle, gates, scrubbed tool name/duration/outcome,
subagents, ticket transitions, verdicts, escalations, settlement). Contract
points, each the product of a real defect:

- **Ordering.** `newest_first`, and the heading says so. The total order is a
  projected opaque `EventView.order_key`; one descending lexicographic sort
  over it IS the whole ordering contract (tie-break chain `ts_utc` → app →
  run id → append order, stated in `ACTIVITY_ORDER.tie_break`). Dated events
  precede undated ones, which render in a labelled `Undated · showing N of M`
  tail paging under its own limit key. The order is computed from durable
  evidence only — never the clock or the display format — so switching
  timestamp mode cannot reorder the list.
- **Completeness.** `snapshot.activity` is metadata only (no second copy of
  events); `total_events` is the authoritative denominator;
  `completeness: "partial"` + `incomplete_reasons` declare under-reporting
  instead of hiding it.
- **Filtering** on event kind, tool outcome, trace, pass, role, pass status —
  all URL state. `status`/`role`/`trace`/`pass` filter the PASS; `kind`/
  `outcome` filter the EVENT; the scope badge names which facet each active
  filter applies to. Trace filtering matches `(app, trace_id)`, never a bare
  trace id. A selection that left the window narrows to nothing and says so,
  rather than silently widening. Choosing a session is a SCOPE change, so it
  clears the trace/pass filters. Default is all kinds — narrowing by default
  would hide evidence. Paging (`?more=`) and attention-group expansion
  (`?open=`) are URL state too, so a link reproduces what the sender saw.
- **Grouping** by trace (`(app, trace_id)`) or pass (`app:runId`) only;
  `group=none` preserves the raw sequence; groups order by maximum member
  `order_key`; grouping never drops or duplicates an entry.
- **Graph linkage** is bidirectional on real ids: a graph node sets
  `?pass=<pass id>`; each entry offers `Show in graph`, `aria-disabled` with
  a stated reason when the pass has no node in scope (focusable, no
  `aria-label` overriding visible text). Never a fallback to a nearby node.
- **Following vs paused** in words, not colour: follows live while
  `scrollTop === 0` exactly; movement away pauses, reports how many entries
  arrived while paused (derived from the set of event IDs on screen at pause
  — real identity, never a snapshot counter or timestamp comparison), and
  restores exact scroll position. The follow pill is the stream's only live
  region (an `aria-live` list would re-announce every visible entry each
  snapshot). Nothing is dropped while paused. Heartbeats coalesce visually
  only across ADJACENT entries sharing a `coalesce_key`, so an interleaved
  failure can never be swallowed; freshness reads
  `PassView.last_heartbeat_at`/`activity.latest_heartbeat_at`, which
  coalescing never touches.

### 5.3 Task/ticket execution page

Selecting a parent task or ticket opens the troubleshooting view: parent
task/intake → pre-ticket planning trace → ticket passes (contract → build →
gates → review → fix? → ship). The graph is evidence-driven: one node per
selected pass or mechanical gate group; arrows from trace plan and
correlation IDs; dashed nodes for routing-skipped passes; **no fabricated
expected stages for legacy traces lacking a manifest**; role identity inside
each node; a pulse only with current liveness evidence. State treatment (not
selected = absent; selected-not-started = neutral; running+fresh heartbeat =
blue pulse; completed = green; blocked = amber; failed/timed-out/stale = red;
returned = amber/red labelled; skipped = dashed muted with reason; unknown
legacy = gray "unknown", never inferred). Colour is never the only signal.

**Trace boundaries, node vocabulary, and search (#95):** the graph renders
**stacked trace groups** (`section.trace-group`, `data-trace-id` set to the
composite `trace:<app>:<trace_id>` — a bare trace id is not globally unique).
The `h3.trace-head` states as visible text: trace id, app, pipeline, ticket
(or `no ticket`); a status pill; the start instant as `<time datetime>`
through the one timestamp policy; the duration or the verbatim recorded
reason there is none (`Trace not finished`, `Start or finish instant not
recorded`, `Unreadable instant`, `Finish instant precedes start (clock
skew)`) — a negative duration, a clamp to zero, an `abs()`, or a substituted
`Date.now()` are all forbidden; `N observed · M skipped · K not observed`;
the ledger-first cost through the single cost renderer; for a legacy trace,
`Trace manifest not recorded — expected stages unknown`. Each group carries
**Filter activity to this trace**, writing the composite id into `?trace=`.

Nodes come from `TraceView.graph_nodes`, never re-derived client-side.
`GRAPH_NODE_STATES` (`src/observe/types.ts`) is the single closed vocabulary
the projection emits, the legend explains, the stylesheet styles, and the
tests assert — an emitted state with no legend row, or vice versa, is a test
failure. The legend is a keyboard-reachable `<details>` of text rows. **A
trace whose `manifest` is `not_recorded` emits ZERO `not_observed` nodes**:
expected stages are unknown, `completion_integrity.required_stages` is
`unknown` (not `incomplete`), and no default stage list is substituted.

Clicking a pass node opens the drawer AND sets `?pass=`. Selection is exposed
with `aria-current` on the node and `data-selected` on its group, survives
SSE re-render and reload, and lives in the URL only — never `localStorage`, a
cookie, or a server-side map.

`traces_scope` declares the honest pre-filter total and trace ordering
(`order_key`, newest instant first, ties by composite id **ascending**; the
sort is proved permutation-stable, never `sort().reverse()`, which reverses
the tie-break and hoists undated traces). The graph badge's denominator is
**this section's own pre-search collection** (after session/app narrowing,
before graph search and display cap) — quoting the org-wide total would turn
every narrowing into a false truncation claim. Scope narrowing is declared by
the scope KIND; **truncation is a different fact**, asserted only by the
display cap and the projection's delivery limit. `?gq=` is a client-side
search over projected identity only (trace id, app, pipeline, ticket,
pass/role names) — never prompt text, previews, branch names, or timestamps;
never touches the network; never narrows the disclosed denominator.

### 5.4 Pass inspection drawer

Opens without leaving the graph. Sections: **Identity** (run/trace/parent
task/app/ticket/pipeline/pass/role; runtime/model/effort; trigger and
initiating invocation; delegated-authority profile/version/hash; native
provider session reference and transcript capability). **Progress** (status,
start, elapsed/final duration; latest heartbeat and provider event;
live/stalled/unknown reasoning; terminal reason; recent structured
activity). **Input** (short scrubbed preview; explicit links to exact
`brief.md`/`prompt.md`; hashes; a warning that L3 is local and may be
sensitive). **Output and verdict** (bounded scrubbed preview; verdict summary
and findings; link to exact `output.md` once it exists; artifact/branch/
commit/PR/review/deployment refs). **Usage** (token components; recorded
cost with `~` for estimates; quality; last checkpoint while running;
tool/subagent/escalation counts). **Evidence** (envelope; event stream;
activity log always labeled **activity log—not transcript**; native
transcript link only when the adapter says one exists).

### 5.5 Recorded session snapshots

A completed task uses the same graph and timeline. Each record is a
**recorded snapshot** built from durable event timestamps and final envelope
state; no intermediate states are manufactured, nothing is animated, and the
word "replay" appears nowhere in the UI (#96).

Two lists with different, stated scopes: **`#history-index`** — the navigable
index of every recorded session (one row per parent task, one per trace),
**deliberately not rescoped** by the current selection (rescoping would
collapse it to the already-selected session); and **`#history`** —
completion-integrity records, scoped to the current selection. They hold
**independent paging keys** (`history-index`, `history`) — a shared key would
couple their caps and misdirect restored focus. Every capped collection's key
appears exactly once in `DEFAULT_LIMITS`.

Every index row is a `<button data-session-id>` (a real selectable session)
or a static card stating why not. A trace **claimed by a parent task**
navigates to that task's session and says so — resolved through the SAME
`sessions()` correlation the Session control uses, covering both recorded
forms (a trace carrying `parent_task_id`, and a trace named only in the
task's `refs.traces`); resolving through `parent_session_id` alone declared
the second form out of window while its claiming session sat in the dropdown.
The recorded-activity `session_ref` resolves through the same map, so a row
and the dropdown cannot disagree.

`aria-current` is DERIVED from the selected session during render (never set
imperatively, so SSE re-render cannot drop it) and marks exactly ONE row; a
claimed trace whose parent is selected gets `data-session-member="true"` and
"in the selected session" in text. Activation reuses `selectSession()` whole
(filter reset, drawer close, URL rewrite). Focus restoration keys on the ROW
id, not the session id — several rows legitimately navigate to one session.
Rows render start instant (`<time datetime>`), duration, pipeline, status,
pass count, and cost through the ONE cost renderer, so an `unavailable`
aggregate can never appear as `$0.00`. `?hq=` searches structured identity
only (task id, trace id, app, pipeline, ticket, status) — never objectives,
prompts, previews, or verdicts.

A `?session=` naming a record outside the delivered window **keeps the
selection** and reports an honest empty projection with a stated reason and a
`— not in current window` chooser option. It must NOT fall back to Live org (a
silent reset widens scope unsaid and destroys the link's meaning); a
historical view returns to live only when the operator chooses **Live org**.
Under such a selection the header cost reports `unavailable`, never `$0.00`.
The reason is DERIVED from the current snapshot on every render.

Choosing a parent task scopes app, attention, delivery, graph, activity,
history, totals, drawer, and evidence to its explicitly correlated traces and
tickets; a standalone trace scopes to that trace. The selection survives SSE
snapshots and refresh, is labelled historical, and never jumps back to live
on its own. Source health remains current observer health; GitHub facts
remain current external facts unless a historical event recorded their
earlier state — the UI never implies an org-wide point-in-time snapshot that
does not exist.

**Per-section scope labelling (#98):** every major section carries a
`.scope-badge` with `data-scope-kind` from ONE closed vocabulary:
`live_app_wide`, `filtered_app_wide` (badge names the filters),
`parent_task_session`, `single_trace`, `app_wide_context` (deliberately NOT
narrowed, with a stated reason). A session kind wins over a filter for a
session-scoped section, but active filters still appear in the badge detail
via `activeFacets()`; a section-local text search (`?gq=`, `?hq=`) is named
only in its own badge. `app_wide_context` requires a reason from
`APP_WIDE_REASONS`, rendered as a `[data-scope-reason]` line joined into the
list's `aria-describedby`. The three standing exemptions:

- **App lifecycle** — the monthly budget is an app-wide month-to-date fact
  (`AppView.cost_window`, `basis: month_to_date`, never narrowed by
  `since`/`parent_task`/`ticket`). Under a selection the card keeps the
  month-to-date figure and adds a separately labelled `this session:` line.
  Never rescoped, never falsified to `$0.00`. `budget_status` is the current
  ledger-derived threshold status; `budget_paused` is the separately
  projected durable admission overlay — neither is inferred from the other.
- **Source health** — CURRENT observer health; byte-identical values under a
  historical selection, only the label changes. Filtering, blanking, or
  restamping `observed_at` would imply a point-in-time snapshot that does
  not exist.
- **Pending intake** — carries no trace/task identity, so a session cannot
  include it.

`#history-index` takes the same exemption whenever anything else is narrowed.

`TotalsView.scope_statement` is the server-side half of "totals always state
what they cover": post-filter app list, app filter, time range with an
explicit `all_recorded`/`since_filter` basis, and the canonical sorted filter
list. It reports the two filter classes **separately**: **snapshot filters**
(server-side `--app/--ticket/…` — the totals already exclude what they
dropped; rendering only client dropdowns printed `filters: none` under
`--ticket 42`) and **display filters** (client controls that narrow the
sections but deliberately not the header totals, which are the projection's
ledger-first aggregate — recomputing client-side would fork the
`none`/`unavailable` rule). `scope_statement.apps` names what the totals
cover, not what is on screen. The client composes the client-owned trace
scope on top, rendering both range instants through the one timestamp policy
and naming the trace WITH its app.

Per-entity cost (`TraceView`/`ParentTaskView`: `cost`, `recorded_cost_usd`,
`usage_quality`, `active_passes`) comes from the same `costForPasses` helper
as `totals.cost`, so a row can never contradict the header (#89); the
client's former `sessionTotals` mirror is deleted. The helper is
settlement-aware in both directions: a settled row contributes recorded cost;
a genuine provider pass with no settled row contributes a COUNTED unknown
keyed on its pass id; a mechanical pass contributes an authoritative zero.
One consequence is deliberate: under a selection the header is
settled-ledger-first rather than envelope-derived.

The historical page also shows completion integrity: required/observed/
skipped stages; interrupted and stale passes; workdir/branch/HEAD
consistency; usage/cost completeness; exact-HEAD Cormidia review status;
manual fallback; PR/merge/issue-close outcome; Cormidia end-to-end
completeness separately from product completion.

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
| `runs/**/events.jsonl` | live structured timeline and spans | append-only L2; a torn trailing line degrades the source rather than reporting healthy |
| `brief.md`, `prompt.md`, `output.md`, `session.log` | explicit local forensic evidence | verbatim L3; never preload into overview |
| Ticket journals/worktrees | recovery and phase evidence | supporting process-owned state; never overrides GitHub labels |
| `state/planning/apps/<app>/` | RoadmapPlan, validation-contract, delivery-readiness, batch/unit, fast-path, cache/recovery explanations | versioned artifacts/journals are authority; labels are non-authoritative projections |
| `telemetry/<date>.jsonl` | settled per-turn cost and budget attribution | ledger truth after settlement; envelope may show partial checkpoint first |
| `invocations/<date>.jsonl` | CLI commands plus distinct internal release executions | invocation history, not provider-turn history |
| `locks/` | active role/app ownership | fresh lock is supporting liveness; pass heartbeat shown separately |
| `state/schedule.json` and event state | due/fired/pending activity | scheduler-owned durable state; readability alone does not prove scheduler health |
| `state/events/inbox/` | company-lifecycle intake | pending until consumed for all subscribers |
| `jobs/<job-id>/journal.json` | durable ad-hoc job step state | journal is authority; CLI and observe share one projection incl. distinct `completed (unverified)` display; corrupt bytes degrade the source |
| `approvals/` | critical-operation safety queue | authoritative approval state/audit |

The projection exposes per-source freshness and degradation: "GitHub
unavailable" ≠ "no ready tickets"; "no heartbeat recorded" ≠ "stalled". A
failed GitHub refresh retains cached entities' last successful `observed_at`
and reports the failed poll as separate health evidence — never restamping
stale entities as fresh. Scheduler definition/lock/inbox readability cannot
establish a running scheduler; operational health is unavailable without
operational evidence.

Delivery labels describe intent, not completed evidence: `op:building`
requires a correlated non-completed pass, `op:in-review` an open PR,
`op:blocked` a pending approval, `op:returned` a failed/non-completed pass —
otherwise the projection is `closed_unknown` with a reason. Merged delivery
requires the exact PR/merge evidence the loop contract defines; a label alone
never upgrades the rung.

Roadmap-delivery explanations are projected once by the read-only product
helper and shared with Status and Reports: artifact refs are authority,
labels are projections, batch `complete` means every admitted unit has a
terminal disposition, `every_unit_success` is separately nullable, fast-path
reasons never imply workflow bypass, absent cache telemetry is `unknown`
never zero, and unreadable planning artifacts degrade the `roadmap_delivery`
source naming the affected claims — never an empty healthy section.

### 6.2 No second store

The observer may hold an in-memory index and a bounded SSE replay buffer. It
must not persist a second queue, copy ticket state into a database, or become
required for recovery; restart reconstructs everything. A later performance
cache is permissible only if disposable, versioned, content-derived, and safe
to delete — never the source of truth.

### 6.3 View model

`src/observe/types.ts` is the schema authority (`ObserveSnapshotV1`,
`OBSERVE_SCHEMA_VERSION`); the read model is versioned, strict, snake_case,
and never leaks internal file schemas. Standing rules:

- Every ordered or capped collection declares a `SectionScopeView` (label,
  pre-cap `total`, `returned`, `truncated`, `cap`, `OrderingView`).
- **Schema version.** `OBSERVE_SCHEMA_VERSION` went `1 → 2` once, for the
  observer-diagnostics workstream (#91/#93/#94/#97) — owed to a **removal**
  (`intake` replaced by `activity_history` + `pending_intake`); additive
  fields alone never require a bump. Safe because the observer persists no
  cache and has no consumer outside the bundled client. The health route
  reads the constant, never a literal.
- **Time policy.** Every instant is canonical ISO-8601 UTC with milliseconds,
  produced by a single projection helper; a recorded-but-unreadable value
  becomes `null` with the reason in that entity's `quality_reason` — never
  `"Invalid Date"`, never epoch zero (`started_at` fields are therefore
  nullable). The read model DECLARES its timezone contract
  (`TimePolicyView.source_timezone: "UTC"`, `display_timezone`,
  `instant_format`), exactly as the ratified sibling
  `ReportRange.display_timezone` does. The projection performs no timezone
  conversion or locale formatting — only the browser knows the operator's
  zone; the client formats per instant via `Intl.DateTimeFormat`. Every
  absolute timestamp is a `<time>` element whose `datetime` is the canonical
  UTC instant, exact UTC always in the `title`, with a URL-persisted
  Local/UTC toggle and a header statement of the active zone. The policy
  lives in exactly one place — `src/report/time-policy.ts`, shared by
  Observer and Reports (under `src/report/` because nothing may import
  `src/observe`). Clock skew is reported as `time_policy.skew` and rendered
  in the header — a warning, never a negative duration, tolerant to the same
  30s window `passLiveness` uses; deliberately not an attention item.
- `snapshot.activity` (`ActivityStreamMetaView`) is metadata only: order and
  tie-break declaration, `total_events`, `undated_events`,
  `clock_skew_event_ids`, completeness + reasons, latest event/heartbeat.
- Attention groups carry the true `occurrence_count`, occurrences capped
  with `occurrences_delivered`/`occurrences_truncated` declared;
  `AttentionOccurrenceView.occurred_at` is a REAL durable instant, never
  `generated_at`; `affected.labels` holds role/pass labels, not role names.
- Every entity includes stable identity, source references, `observed_at`,
  and a quality/unknown reason where evidence is incomplete.

### 6.4 Identity and correlation

Use existing IDs only: org + app name; repo + issue/PR number; parent task
ID; trace ID; `(app, runId)` for a pass and `(app, providerTurnId)` for a
current ledger settlement (legacy: run identity); event
`span_id`/`parent_span_id`; approval and invocation IDs. `runId` alone is not
globally unique. Text similarity, timestamps, branch names, or prompt
contents must never invent parent/child links.

Attention grouping keys derive only from the enumerated `kind`/`cause`
vocabulary plus org+app scope (plus entity id for non-groupable kinds) —
never from `title`, `detail`, a timestamp, or model-produced text. Activity
grouping and graph↔activity focus key exclusively on `(app, trace_id)` and
`(app, runId)`. `PendingIntakeItemView.discovered_at` is a filesystem mtime:
display-only, may order pending items within their own section, never a
correlation key and never placed in the recorded chronology. Ordering
tie-breakers use a **code-unit** comparator, never `localeCompare` (ICU
would render the same durable state differently on two machines).

### 6.5 Liveness semantics

Passes heartbeat every 30 seconds when healthy. A running envelope with a
heartbeat within the three-minute telemetry threshold is `live`; older is
`stalled`; a running legacy envelope with no heartbeat is `unknown`, not
live. A fresh role/app lock supports ownership display but never replaces the
pass heartbeat. A live browser/SSE connection says nothing about the agent
pass. The UI shows the last timestamp and threshold reasoning in plain text.

### 6.6 Usage and cost semantics

Adapter checkpoints may provide partial cumulative usage during execution;
at finalization the pass settles exactly once into the org ledger. Qualities:

- `complete` — final provider usage available;
- `partial` — a lower bound from an interrupted/running turn;
- `estimated` — Cormidia-computed equivalent cost, not a provider invoice;
- `unavailable` — a provider turn ran and its usage was not observable;
- `none` — no provider was invoked (provision/setup, quality gates, merge
  machinery): its zero is authoritative, not missing.

`none` and `unavailable` are different facts, never conflated. A `none` pass
stays visible, contributes a real $0, raises no attention item, and is
excluded from provider-turn counts and settlement coverage; only
`unavailable` and `partial` are incomplete usage. This holds for an EMPTY
provider set on every surface: a scope whose passes all invoked no provider
is `none` (authoritative zero); only a scope with no pass evidence at all is
`unavailable` — so "zero provider turns" can never be reported as unknown
cost.

Unknown cost is never displayed as free and never erases known cost.
Aggregates project the settled ledger through the shared `aggregateCost`
primitive (`src/runtime/cost.ts`): known subtotal, separately counted unknown
component with drill-down refs, and a `none`/`complete`/`partial`/
`unavailable` coverage verdict. One unobservable turn downgrades an aggregate
to `partial`, not `unavailable`. Header totals, app cards, Reports, and
`cormidia telemetry` all project the same object for the same scope, and
`test/report/cost-reconciliation.test.ts` fails when any two disagree.

### 6.7 Corruption, pruning, and legacy records

A malformed trailing JSONL line is a torn append, retried. Mid-file
corruption creates an attention item and preserves every readable fact.
An unreadable envelope appears as `corrupt(envelope)`. Pruned L3 shows
"expired by retention", not a broken link. Legacy missing fields show "not
recorded"/"unknown". The observer never synthesizes parent tasks or
reviewer/merge evidence for legacy runs.

## 7. Local server architecture

### 7.1 CLI contract

```text
cormidia observe [--app <name>] [--parent-task <id>] [--ticket <number>]
               [--port <number>] [--open] [--no-open]
               [--org-home <path>] [--state-home <path>]
```

Defaults: bind `127.0.0.1` only; documented default port with ephemeral
fallback; print the exact URL and resolved homes; foreground until
interrupted; no browser unless `--open`; SIGINT/SIGTERM stop only the
observer, never a turn; no provider turns, no token spend; read-only GitHub
operations only. Listed by `cormidia capabilities --json` as read-only and
token-free. Cormidia never silently auto-starts a server.

### 7.2 Process and module boundary

`src/observe/` is a presentation-only leaf (types, pure projection,
source-health rules, file/GitHub/live sources, HTTP/SSE server, framework-
free assets; `src/cli/observe.ts` for lifecycle). `src/observe` may import
`src/org`, `src/loop`, `src/runtime`; none of those imports it. Prefer
extracting pure telemetry projection helpers over importing private CLI
renderer functions.

### 7.3 Transport

HTTP snapshot + SSE for changes:

```text
GET /api/v1/snapshot
GET /api/v1/events?cursor=<cursor>       text/event-stream
GET /api/v1/artifacts/<app>/<run>/<kind>
GET /api/v1/tasks/<task>/<kind>
GET /healthz
```

No workflow mutation endpoints of any kind. SSE events carry a monotonic
observer cursor and one of `snapshot`, `entity.upsert`, `entity.remove`,
`source.health`, `resync` (cursor outside the replay buffer → client fetches
a fresh snapshot). SSE delivery is an optimization; correctness always comes
from reconciliation with durable sources.

### 7.4 Change detection

File notifications for latency plus a periodic reconciliation scan (watchers
coalesce/miss events across platforms). Append-only files are tailed from a
remembered byte offset with inode/size changes triggering safe re-read;
atomic renames are expected; bursts are debounced so a finalization does not
emit contradictory frames. Targets: local envelope/event changes visible
within 2 s p95; GitHub within its explicit 15–30 s read-only poll window;
heartbeat age refreshed at least every 10 s; at most one full historical scan
at startup; completed history and L3 lazy-loaded. GitHub polling failure
degrades that source while local traces continue rendering; the UI's poll
cadence is never part of dispatch behavior.

### 7.5 Frontend technology

Semantic HTML, CSS, and a small TypeScript client with **no runtime UI
framework** (one CLI package; React/Vite adds machinery the interaction model
doesn't justify). Required behaviors: keyed incremental rendering that
preserves drawer/filter state; keyboard navigation and visible focus, with
explicit focus restoration for any control a re-render destroys and focus
taken only when a surface OPENS; a drawer declaring `aria-modal` is actually
modal (background `inert`); toggle buttons carry a FIXED label naming the
state they turn on with `aria-pressed` reporting whether it is active; a
control that cannot act uses `aria-disabled` (focusable, stated reason
reachable, no `aria-label` hiding visible text), never `disabled`; responsive
at 360px and desktop; `prefers-reduced-motion`; text/icon status in addition
to color; bounded virtualized/paged history; no third-party fonts, scripts,
analytics, or external requests. If the framework-free client becomes a
custom framework, stop and propose a dependency with measured reasons.

## 8. Security and privacy boundary

L1/L2 are structured and scrubbed, but `brief.md`/`prompt.md`/`output.md`/
`session.log` are verbatim local L3. The server must satisfy all of:

1. Loopback only; no `--host 0.0.0.0` escape hatch.
2. High-entropy per-process capability token required for browser, SSE, and
   artifact access; never logged.
3. `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
   `X-Content-Type-Options: nosniff`, restrictive CSP, frame denial.
4. No external assets or network requests from the browser.
5. Escape every prompt, output, verdict, path, and event field; never inject
   model text with `innerHTML`.
6. Overview/stream payloads carry only scrubbed, bounded previews through the
   canonical secret scrubber.
7. No raw L3 content in the initial snapshot or SSE stream.
8. Full local artifacts require an intentional click, labeled potentially
   sensitive, served as escaped text with no caching.
9. Artifact routes resolve from validated IDs and a filename allowlist;
   reject `..`, symlink escapes, absolute paths, unknown refs, and paths
   outside the resolved state home.
10. Browser filters, artifact contents, and access tokens are never persisted
    into org/app repositories.
11. `session.log` is labeled an activity log; native transcript capability
    comes only from `envelope.session`.
12. No raw tool arguments; L2 carries names/outcomes and argument hashes.

Remote/droplet access is a separate design (authenticated transport, TLS,
origin policy, threat model); SSH port forwarding to the loopback server is
the sanctioned interim.

## 9. Reliability and operational behavior

- Observer startup failure never blocks `cormidia loop`/`dispatch`; shutdown
  never cancels a pass; browser disconnection never changes durable state;
  restart reconstructs active passes, queue state, and history.
- A slow browser gets a bounded per-client buffer and is told to resync
  rather than consuming unbounded memory. Large artifacts stream on demand
  with preview/size limits.
- Multiple observers are allowed (all readers), each with its own token and
  cursor space.
- A source-health panel distinguishes local filesystem, GitHub, approvals,
  ledger, and scheduler health. Clock skew and future timestamps create
  warnings, never negative durations.
- Observer logs contain request/error metadata but no prompt, output,
  artifact content, token, or authorization material.

## 10. Triggered-validation evidence addendum (2026-07-31)

The versioned snapshot includes the product-owned
`validation_campaigns: {reports, corrupt}` read model from
`validation/campaigns/*/report.json` — live app-wide/current evidence, never
narrowed into a selected product session. Target-app filtering may hide
reports for other apps; corrupt records remain visible because their scope
cannot be trusted. Cards show separate completeness/verdict, case coverage,
and spend. `inconclusive` uses blocked — not completed — visual semantics and
the literal "NOT A PASS; NOT RELEASE EVIDENCE." Corrupt reports are
failed/incomplete; no report means "No validation campaign evidence
recorded," never healthy. The section links
`docs/qualification/validation-triage.md`. Observe stays read-only: it never
resumes, repairs, reconciles, or reruns a campaign.
