# Operon reporting — org and app analytics design

*Status: owner-ratified and recorded in `docs/PURPOSE.md` v2.0.*

*Version: 0.1 — 2026-07-12.*

*Audience: the org owner, a new implementation session, and reviewers.*

Route, context, provider-turn, active-time, human-decision, scheduler, and
learning metrics use `docs/episodes/contract.md` as their canonical definitions.
Reporting projects durable facts and measurement quality; it never admits a
route, repairs workflow state, or converts missing evidence into zero.

## 1. Executive recommendation

Build reporting as a distinct product mode over the same durable facts as
Observe, not as a larger Observe dashboard and not as a second daemon.

The operator should experience one local Operon web surface with two explicit
destinations:

- **Live** answers “what is happening now, what is waiting, and why?”
- **Reports** answers “what happened in this period, how much did it consume,
  where did the consumption go, and how healthy was execution?”

`operon observe` remains the only browser server. It serves the current Live UI
at `/` and a lazily computed reporting UI at `/reports`, protected by the same
loopback binding and per-process capability. Reports do not subscribe to the
live SSE stream; they are as-of analytical snapshots with an explicit refresh.

The CLI gets a separate, token-free command:

```sh
operon report --app <app> --period 90d --html app-report.html
operon report --period 1y --html org-report.html
```

The generated HTML is portable and self-contained. It does not need an
observer process. The same pure report projection feeds terminal, stable JSON,
portable HTML, and the `/reports` browser mode.

This separation is important:

| Surface | Primary question | Time posture | Canonical output |
| --- | --- | --- | --- |
| `operon observe` → Live | What is happening or blocked now? | current plus forensic replay | changing local browser projection |
| `operon report` / Reports | What happened and where did usage go? | explicit bounded interval | deterministic as-of report |
| `operon telemetry` | What exactly happened in these passes/traces? | run/day forensic scope | low-level trace view plus evidence bundle |
| `operon budget` | May this app spend more this month? | current budget month | enforcement rollup |
| `operon retro` | What should the org learn from a week? | weekly evidence synthesis | durable retro artifact |

Reporting therefore complements all four existing surfaces without replacing
their contracts.

## 2. Proposed decisions

These are the decisions this design asks the owner to ratify before
implementation:

1. The command is `operon report`; an omitted `--app` means the active org.
2. The default period is the trailing **90 UTC calendar days**, including the
   current day. Presets are `7d`, `30d`, `90d`, `1y`, and `all`; custom dates
   are supported.
3. The org ledger is the accounting authority. Run envelopes, events, parent
   tasks, and scorecards enrich accounting rows but never replace or silently
   repair the ledger.
4. A reporting “session” is a presentation grouping: parent task first,
   standalone trace second, orphan run last. A provider-native session ID is
   never the grouping key.
5. One `operon observe` process serves both Live and Reports. The two modes
   have separate routes, read models, navigation, and update semantics.
6. `operon report --html` generates a portable snapshot without starting a
   server. No server discovery, daemon registry, or second report server is
   introduced.
7. V1 reporting is deterministic and token-free. It may state evidence-backed
   highlights, but it does not ask a model to write an executive narrative.
8. V1 adds no reporting database, scheduled archive, email delivery, cloud
   ingestion, or workflow controls.
9. Existing `operon telemetry --json/--html` output remains backward
   compatible. It stays the forensic run report while `operon report` becomes
   the management and usage report.

After approval, record only the concise product decision in
`docs/PURPOSE.md`; keep the implementation contract here.

## 3. Product contract

### 3.1 Questions the report must answer

At org scope:

1. How many known input and output tokens did this org consume in the period?
2. How much recorded equivalent cost did it incur, and how much is provider
   reported versus Operon-estimated?
3. How many provider turns and presentation sessions ran?
4. Which apps, roles, runtimes, models, pipelines, triggers, and outcomes
   account for the consumption?
5. Is burn rising, falling, or concentrated in a small number of apps or
   sessions?
6. How many turns have complete, partial, estimated, unavailable, unmeasured,
   legacy, or corrupt usage evidence?
7. How many sessions completed, failed, blocked, timed out, were cancelled, or
   have unknown integrity?
8. What are the most expensive sessions, and can the owner drill into every
   constituent pass?
9. How does current-month app spend compare with the app’s monthly budget,
   without pretending that a 90-day total is a 90-day budget?
10. Which facts are missing because runs were pruned, records are legacy, or
    correlation was never captured?
11. Do admitted episodes and started execution steps have truthful terminal
    records, and does every provider step have exactly one settlement?
12. Which route variances, repeated provider turns, context categories, and
    human-wait intervals explain the episode's efficiency?

At app scope, the report must additionally answer:

1. What work sessions occurred for this app, in chronological order?
2. Which turns belong to each session?
3. For every turn, what role/runtime/model/pipeline/pass ran, how long did it
   run, what status did it reach, and what usage/cost was recorded?
4. Which tickets, branches, PRs, reviews, or deployments were durably
   referenced?
5. What was the cost and token distribution across planning, building,
   review, fixes, operations, support, marketing, and learning activity?
6. What execution health signals are supported by evidence: completion,
   interruptions, review/fix cycles, escalations, gate outcomes, and usage
   coverage?

### 3.2 What “how are we doing?” means in V1

The report may make grounded operating statements such as:

- 42% of known cost was Builder activity;
- 7 of 9 correlated sessions completed;
- 3 turns have unavailable usage and are excluded from known-token totals;
- one session accounts for 38% of recorded cost;
- current month-to-date spend is 71% of the configured app budget.

It must not infer productivity, business value, code quality, employee
performance, or return on investment from token volume. Product completion and
Operon execution integrity remain separate claims. Sparse scorecard data is
shown as sparse evidence, never converted into a synthetic score.

### 3.3 Non-goals

V1 does not provide:

- configuration, approval, retry, cancel, merge, deploy, label, or budget-edit
  controls;
- invoices, provider billing reconciliation, or a claim that equivalent cost
  equals cash charged;
- model-authored management prose;
- arbitrary natural-language analytics or SQL;
- remote hosting, multi-user authorization, public sharing, or cloud
  telemetry ingestion;
- scheduled generation, retention policy for saved reports, email/Slack
  delivery, or subscriptions;
- cross-org reporting;
- a new canonical session, task, telemetry, or outcome store;
- reconstruction of missing parent tasks or outcomes from timestamp/text
  similarity;
- full prompts, outputs, tool arguments, or transcripts embedded in the
  management report;
- rewriting or deprecating `operon telemetry` in the first release.

## 4. Relationship among CLI, Live UI, and Reports

### 4.1 One product shell, two browser modes

The local browser header gains a simple primary navigation:

```text
Operon / <org>       [ Live ] [ Reports ]       READ ONLY
```

The routes are deliberately distinct:

```text
/                         Live UI (backward-compatible current route)
/reports                  report builder and report view
```

Live keeps its session chooser, source-health state, GitHub polling, and SSE
semantics. Reports gets scope and date controls, an as-of timestamp, and an
explicit Refresh action. A report is not labeled “live” merely because its
interval includes today.

The browser modes may link to each other:

- Live app cards and historical sessions can link to a 90-day app report.
- A served report session/turn can link back to the matching Live historical
  session or pass drawer.
- A portable report shows stable IDs and the exact CLI command needed to open
  the corresponding local view; it cannot assume an observer URL still
  exists.

The modes must not share one giant view model. They share source types and
small pure helpers where useful, while preserving separate public schemas.

The existing `operon observe --app <name>` flag is a server-side scope, not
merely an initial browser filter. When the observer is started that way,
Reports is locked to that app and report APIs reject org-wide or sibling-app
queries. An unscoped `operon observe` permits both org and registered-app
reports. `--parent-task` and `--ticket` remain initial Live selections and do
not narrow the report service.

### 4.2 Why Reports should not be another Live page section

Live and Reports have conflicting information-density and freshness needs:

- Live prioritizes attention, liveness, queue state, latest events, and rapid
  reconciliation.
- Reports prioritizes a stable interval, exact accounting totals, trends,
  attribution, comparisons, and exhaustive history.
- Live benefits from bounded recent data and incremental updates.
- Reports must scan an explicit historical range and remain internally
  consistent while the operator reads or exports it.

Combining them into one dashboard would either make Live heavy or make the
report incomplete. Separate routes keep the mental models honest while one
server avoids operational clutter.

### 4.3 Why the CLI remains independent of the server

`operon report` must work when no observer is running, from a neutral working
directory, and without network access. It resolves the active org/state home,
builds a report snapshot, and renders terminal, JSON, or HTML directly.

The CLI must not:

- search for a running observer;
- persist an observer port/token registry;
- auto-start or background a server;
- depend on GitHub availability;
- reconcile or mutate telemetry as a side effect.

This keeps saved reports reproducible and makes the browser server optional.

## 5. Vocabulary and identity

### 5.1 Provider turn, execution step, pass, trace, and session

| Term | Meaning in reporting | Identity/source |
| --- | --- | --- |
| Provider turn | One settled provider `Runtime.runTurn` invocation | ledger row, `(app, providerTurnId)`; legacy fallback `(app, runId)` |
| Execution step | One terminal provider or deterministic operation | `executionStepId` within an episode |
| Pass | One run envelope; may contain multiple provider turns or a token-free mechanical pass | `(app, runId)` |
| Trace | Correlated pipeline execution with one or more passes | `(app, traceId)` |
| Parent task | Broader operator-delegated outcome spanning traces/tickets | `taskId` |
| Report session | Presentation group used for management drill-down | deterministic hierarchy below |
| Native session | Provider-specific task/thread identity | evidence only, never grouping |

Mechanical gates may have envelopes without a settled provider row. They
belong in session detail as `mechanical_pass` activity, but they do not become
provider turns and do not add zero tokens to a provider-turn denominator.

### 5.2 Deterministic session grouping

Each selected accounting turn/pass belongs to exactly one report session:

1. If `parent_task_id` exists, group under `task:<taskId>`.
2. Otherwise, if a real `trace_id` exists, group under
   `trace:<app>:<traceId>`.
3. Otherwise, group the one run under `run:<app>:<runId>`.
4. A legacy ledger row with no usable run correlation appears under
   **Unattributed turns**, not a fabricated session.

At app scope, a parent task containing multiple apps shows only the selected
app’s turns and carries `scope_partial: true`. At org scope, the complete
cross-app session is shown.

Do not group by native provider session ID, timestamp proximity, ticket title,
branch name, or model-output similarity. `runId` alone is not globally unique.

### 5.3 Status precedence

Session status comes from the strongest available durable boundary:

1. parent-task terminal status and completion-integrity record;
2. otherwise trace integrity and constituent pass statuses;
3. otherwise the orphan pass status;
4. otherwise `unknown`.

A session with one failed/cancelled/timed-out pass and later successful retry
may be complete at the parent-task boundary while still retaining interrupted
turn counts. The report shows both the outcome and the execution history.

## 6. Time-range contract

### 6.1 Controls

Browser presets:

- Last 7 days
- Last 30 days
- Last 90 days (default)
- Last year
- All retained accounting history
- Custom from/to dates

CLI:

```text
operon report [--app <name>]
              [--period 7d|30d|90d|1y|all]
              [--since YYYY-MM-DD] [--until YYYY-MM-DD]
              [--bucket auto|day|week|month]
              [--json] [--html <path>] [--open]
              [--summary-only]
              [--org-home <path>] [--state-home <path>]
```

Rules:

- `--period` is mutually exclusive with `--since`/`--until`.
- With no range flags, use `--period 90d`.
- A custom `--since` with no `--until` ends at report generation time.
- A custom `--until` with no `--since` is invalid; this avoids accidentally
  reading all history.
- Date-only bounds are UTC calendar dates. `since` is inclusive; `until` is
  inclusive in user input and normalized to an exclusive next-day instant.
- The report JSON always stores normalized `from_inclusive` and
  `to_exclusive` ISO instants plus `display_timezone: "UTC"`.
- Browser-local time may be shown secondarily, but tooltips and exports retain
  UTC so two operators interpret the same report identically.
- The browser Reports surface renders every absolute timestamp through
  `src/report/time-policy.ts`, the single presentation-only time policy it
  SHARES with the Observer (`docs/live-ui/design.md` §6.3): a `<time>` element
  whose `datetime` is the canonical UTC instant, a visible zone abbreviation or
  padded UTC offset, and exact UTC in the tooltip. It lives under `src/report/`
  because nothing may import `src/observe`.
- `1y` means today plus the preceding 364 UTC calendar days, not “current
  calendar year.”
- `all` begins at the earliest readable ledger row. It is explicit because it
  may be large.

### 6.2 Accounting membership

Authoritative usage/cost membership uses ledger `TurnRecord.at`. This keeps
the report consistent with budget and retro rollups. A pass that started
before midnight and settled after midnight belongs to the settlement day.

Run envelopes in the interval without matching settlements are shown as
**unsettled/incomplete activity**, selected by `started_at`. Their partial
envelope usage is never silently added to authoritative ledger totals. The
report may show it separately as a lower bound.

Parent tasks/sessions are included when at least one selected turn/pass belongs
to the interval. Their displayed start/end may extend outside the interval and
must be labeled as such.

### 6.3 Automatic trend buckets

`auto` uses:

- day for intervals up to 45 days;
- week for 46–180 days;
- month for more than 180 days.

Weeks begin Monday at 00:00 UTC. Buckets are gap-filled with zero known usage
only when the source files for the gap were read successfully. A missing or
unreadable source is a quality gap, not a zero.

## 7. User experience and information architecture

### 7.1 Report builder/header

Every report begins with:

- Operon org and resolved state-home identity;
- scope: all apps or one registered app;
- selected UTC period and generated-at timestamp;
- presets plus custom date controls;
- auto/day/week/month bucket control;
- Refresh (served mode) or regeneration command (portable mode);
- Export HTML and JSON actions in served mode;
- a visible **READ ONLY · TOKEN FREE · AS OF** marker;
- a confidentiality note: the report contains operational metadata.

Changing scope or range updates URL state. Browser back/forward and refresh
must reproduce the same query. Invalid or unknown apps fail visibly rather
than falling back to org scope.

### 7.2 Data-quality banner comes first

Before headline totals, show a compact quality panel when any of these exist:

- unavailable or unmeasured usage;
- partial/unsettled turns;
- estimated cost;
- ledger rows without app/run correlation;
- duplicate settlement keys;
- corrupt/torn ledger lines;
- missing/pruned run envelopes for settled rows;
- future timestamps or clock skew;
- current interval still open and changing.

The panel states exactly which totals are complete, lower bounds, estimates,
or unavailable. An empty panel means no detected issue, not a guarantee that a
provider invoice agrees.

### 7.3 Headline metrics

Show at most eight top-level metrics:

1. known input tokens;
2. known output tokens;
3. known total tokens (`input + output`);
4. recorded equivalent cost, split reported/estimated;
5. provider turns plus unknown-usage turns;
6. report sessions;
7. completed sessions and completion-integrity coverage;
8. current-month spend versus budget (app scope), or apps at warning/exceeded
   (org scope).

Cache-read and cache-creation tokens are breakouts, not extra additions to
total tokens. `tokensIn` already represents provider input usage and current
code computes cache hit ratio as `cacheReadTokens / tokensIn`; adding cache
tokens again would double count.

### 7.4 Trend

Provide two aligned, accessible charts with an equivalent data table:

- known input/output tokens by time bucket;
- recorded reported/estimated cost by time bucket.

At org scope the operator may stack or filter by app. At app scope the
operator may segment by role. Charts show missing-quality markers; they do not
draw a zero line through unreadable buckets.

Use inline SVG or semantic CSS generated from the report data. No charting
dependency or canvas-only visualization is needed in V1.

### 7.5 Allocation

Ranked breakdowns show known tokens, cost, turns, sessions, and share by:

- app (org only);
- role;
- runtime and model tuple;
- pipeline/pass;
- trigger kind;
- terminal status;
- usage quality.

Each percentage declares its denominator. Rows with unknown usage contribute
to turn counts but not known-token shares. Estimated and provider-reported cost
are visually distinct.

### 7.6 Operating health

Show evidence-backed counts and distributions:

- session outcomes and completion-integrity state;
- completed/blocked/failed/cancelled/timed-out/running passes;
- median and p90 provider-turn wall time;
- median and p90 recorded cost per provider turn;
- median known cost per completed session, when meaningful;
- reviewer/fix-cycle counts where the trace manifest supports them;
- gate pass/fail counts from run envelopes;
- escalation counts from structured events;
- manual/mixed fallback sessions from parent-task records;
- available scorecard evidence by kind, with event counts and coverage.

Do not compute a single “org health score.” Distributions with denominators are
more honest than a synthetic grade.

### 7.7 Org portfolio table

One row per registered app:

- lifecycle and repository;
- known tokens and recorded cost in the selected range;
- provider turns and sessions;
- session outcome counts;
- current calendar-month spend, monthly budget, and percent;
- usage/completion coverage;
- most recent selected activity;
- share of org consumption.

Historical selected-range spend and current-month budget are separate
columns. A 90-day spend total must never be compared directly with one monthly
cap.

### 7.8 App report

The app report keeps the same header, quality, headlines, trend, allocation,
and health sections, then makes the session index the center of the page.

Useful deterministic highlights may be generated from thresholds, for
example:

- “Review and fix activity accounts for 31% of recorded cost.”
- “Two sessions contain unavailable usage.”
- “The costliest session accounts for 44% of recorded cost.”

Each highlight links to the underlying breakdown/filter. Do not generate
adjectival claims such as “excellent,” “wasteful,” or “productive.”

### 7.9 Session index

The selected interval’s complete session list is sortable and filterable by:

- start/end time;
- app;
- session kind (`parent_task`, `standalone_trace`, `orphan_run`);
- objective/ticket/ref text;
- outcome/integrity;
- role, model, pipeline, or trigger presence;
- known tokens;
- recorded cost;
- turn count;
- usage quality.

Each session summary shows:

- stable report-session ID and preferred human label;
- app(s), objective or trace/ticket identity;
- first/last selected activity and full-boundary timestamps when known;
- outcome, execution mode, and completion integrity;
- provider-turn and mechanical-pass counts;
- known input/output tokens and cost quality;
- ticket/branch/PR/review/deployment refs;
- warnings such as partial scope, pruned detail, fallback, or unknown usage.

The served UI pages summaries in bounded chunks. Portable full reports embed
the exhaustive selected session list unless `--summary-only` is explicit.

### 7.10 Session detail and turn table

Expanding a session shows traces, then passes in causal/start order. Every row
contains:

- activity type: provider turn or mechanical pass;
- app, run ID, trace ID, parent-task ID, ticket;
- role, runtime, model, effort;
- pipeline and pass;
- trigger when recorded;
- started, settled/finished, and wall time;
- terminal status and integrity warning;
- input, output, uncached input, cache read, and cache creation tokens;
- recorded cost, estimated flag, and usage quality;
- tool-call, subagent-turn, escalation, and gate counts when available;
- branch/head and durable result refs;
- native provider-session capability as evidence only.

In served mode, a pass may open the existing Observe drawer/artifact routes.
In portable mode, show IDs and durable refs only. Management reports do not
copy L3 prompts, outputs, or activity logs.

### 7.11 Empty and partial states

- No ledger directory: “No settled provider turns are recorded,” plus any
  envelope-only activity and a reconciliation hint.
- No activity in range: show the selected scope/range and earliest/latest
  available accounting dates; do not silently broaden the interval.
- App exists but has no spend: “No settled usage in this range,” not “free.”
- Run detail pruned: totals remain from the ledger; session detail says
  “execution detail expired by retention.”
- Legacy row lacks app: included in org totals under **Unattributed**, excluded
  from app reports.
- Running/unsettled pass: separate lower-bound activity, not authoritative
  spend.

## 8. Authoritative data and accounting rules

### 8.1 Source inventory

| Source | Report use | Authority/limitations |
| --- | --- | --- |
| `telemetry/<date>.jsonl` | settled turns, tokens, cost, role/runtime/model/status, primary range membership | accounting authority; tolerate and report corruption |
| `runs/<app>/<runId>/envelope.json` | trace/session correlation, pass detail, start/finish, gates, refs, partial usage | per-pass execution truth; may be pruned |
| `events.jsonl` | escalation/tool/subagent structured counts when needed | L2 evidence; read lazily, bounded |
| `tasks/<taskId>/task.json` | session boundary, objective, fallback, result and completion integrity | parent delegated-task truth |
| `invocations/<date>.jsonl` | orchestration activity/context | not token accounting |
| org `apps.yaml` | registered app identity, lifecycle, monthly budget | current configuration, not historical budget versions |
| `scorecards/<app>/<role>.jsonl` | sparse quality/rework evidence | secondary evidence; never a composite grade |
| approvals | counts/refs when correlated | safety history, not spend |
| GitHub | optional links/current context in Live | not required for deterministic V1 report totals |

The V1 core report does not call GitHub. Parent-task and envelope refs are
enough to link durable outcomes without making a saved report depend on
network/auth or on a mutable current GitHub state. The served Reports page may
show a separate “current Live context” link, but GitHub polling must not change
the accounting snapshot.

### 8.2 Ledger-first join

For the selected range:

1. Read only daily ledger files that can intersect the normalized interval.
2. Parse every line with file/line diagnostics.
3. Filter by authoritative `at` and optional app scope.
4. Join correlated rows directly to `runs/<app>/<runId>/envelope.json`.
5. Load referenced parent tasks by ID.
6. Read events only for detail/counts not already present in the envelope.
7. Perform a bounded scan for envelope-only activity in the interval so
   unsettled work is visible but kept outside ledger totals.

Do not scan every run artifact merely to compute totals. Do not preload L3
artifacts.

### 8.3 Token semantics

For rows whose usage is observable:

```text
known_input_tokens  = sum(tokensIn)
known_output_tokens = sum(tokensOut)
known_total_tokens  = known_input_tokens + known_output_tokens
```

`cacheReadTokens`, `cacheCreationTokens`, and `tokensInUncached` are component
breakouts. They are not all present for every provider and are not added to
`known_total_tokens`.

Rows with `unmeasured: true` or `usageQuality: unavailable` increment
`unknown_usage_turns`; their zero-valued storage placeholders do not enter
known-token totals. Partial usage is a lower bound and is broken out from
complete usage.

### 8.4 Cost semantics

Maintain separate sums:

- `provider_reported_cost_usd`;
- `operon_estimated_cost_usd`;
- `partial_recorded_cost_usd`;
- `recorded_equivalent_cost_usd` (their explicitly labeled sum);
- `unknown_cost_turns`.

The headline may use recorded equivalent cost only when the split and quality
are adjacent. Never label it “bill,” “invoice,” or “cash spent.” Unknown cost
is not zero.

### 8.5 Duplicate and legacy rows

The report detects repeated `(app, providerTurnId)` settlement keys, falling
back to `(app, runId)` for legacy rows. It must not silently deduplicate
because `operon budget` consumes ledger rows as recorded and hidden adjustment
would make the two surfaces disagree.

Totals remain **ledger-recorded totals** and the quality panel reports:

- duplicate row count;
- duplicated recorded tokens/cost implicated;
- the affected keys.

Legacy rows without a run ID still count in org accounting totals. Legacy rows
without an app appear under Unattributed and never leak into an app report.

### 8.6 Coverage metrics

Every percentage includes its denominator:

- token coverage = observable provider turns / provider turns;
- cost quality mix = turns and dollars by complete/estimated/partial/
  unavailable;
- run-detail coverage = settled rows joined to a readable envelope / settled
  rows with a correlation key;
- session-correlation coverage = settled rows assigned to parent task or trace
  / correlatable settled rows;
- completion-integrity coverage = sessions with a known integrity boundary /
  sessions.
- episode terminal integrity = admitted episodes with one truthful terminal /
  admitted episodes;
- execution-step terminal integrity = terminal execution steps / started
  execution steps;
- ledger coverage = provider execution steps with exactly one settlement /
  provider execution steps, while mechanical steps require zero settlements;
- productive-pass ratio = fingerprint-proven productive provider steps / all
  qualifying episode provider steps.

Each efficiency metric carries numerator, denominator, excluded identities,
and missing inputs. A required missing route, step, manifest, settlement, or
usage-quality input yields `invalid_measurement`; it never becomes zero.

Do not average categorical quality values into a numeric score.

### 8.7 Percentiles and denominators

Use nearest-rank percentiles over finite, eligible values and state `n`.
Exclude unavailable values; include partial values only in a separately
labeled lower-bound distribution. Cost per completed session is shown only for
sessions whose completion is known and whose cost quality is not unavailable.

### 8.8 No implicit reconciliation

Report generation is read-only with respect to Operon state. It never invokes
`operon budget --reconcile`, appends a ledger row, repairs an envelope, or
persists an index.

When a terminal envelope with recorded usage has no ledger row, report the
discrepancy and suggest the explicit reconciliation command. The owner decides
whether to run it.

## 9. Versioned report model

### 9.1 Summary schema

Use snake_case and publish a dedicated schema independent of
`ObserveSnapshotV1`:

```ts
interface ReportSnapshotV1 {
  schema_version: 1;
  generated_at: string;
  org: { name: string; state_home_id: string };
  scope: { kind: "org" | "app"; app: string | null };
  range: {
    preset: "7d" | "30d" | "90d" | "1y" | "all" | "custom";
    from_inclusive: string;
    to_exclusive: string;
    display_timezone: "UTC";
    bucket: "day" | "week" | "month";
    open_interval: boolean;
  };
  quality: ReportQualityV1;
  headline: ReportHeadlineV1;
  trend: ReportBucketV1[];
  breakdowns: {
    by_app: ReportBreakdownV1[];
    by_role: ReportBreakdownV1[];
    by_runtime_model: ReportBreakdownV1[];
    by_pipeline_pass: ReportBreakdownV1[];
    by_trigger: ReportBreakdownV1[];
    by_status: ReportBreakdownV1[];
    by_usage_quality: ReportBreakdownV1[];
  };
  health: ReportHealthV1;
  apps: ReportAppRowV1[];
  sessions: {
    total: number;
    returned: number;
    next_cursor: string | null;
    items: ReportSessionSummaryV1[];
  };
  unattributed_turns: ReportTurnV1[];
}
```

The JSON schema should use `null` for unavailable numeric facts. Zero means a
measured zero.

### Cost aggregation and the `none` quality

Every aggregate cost surface projects the settled telemetry ledger through the
one primitive in `src/runtime/cost.ts`. The ledger is the authority for recorded
provider cost; envelope-derived sums are drill-down only and are labelled as
such wherever they are rendered.

`aggregateCost` returns a known subtotal, the count and references of provider
turns whose usage could not be observed, the count of non-provider passes, and a
coverage verdict:

- `none` — no provider turns in scope; the zero is authoritative;
- `complete` — every provider turn is observable;
- `partial` — some are not; the known subtotal is a true floor and the unknown
  component is counted separately and never rendered as zero;
- `unavailable` — provider turns exist and none is observable.

A fifth usage quality, `none`, marks a pass that invoked no provider. It is
derived once, in `classifyEnvelopeUsage` (`src/runtime/runlog/envelope.ts`):
explicitly from the recorded `quality` for passes written since the fix, and
structurally for older envelopes — absent runtime, absent model, absent usage,
and no ledger settlement. It is emphatically not a match on the pass name, which
is what the two previous heuristics did, disagreeing with each other and both
missing `provision/setup`.

### Repeated work

`repeated_work_cost_usd` is derived from the duplication fingerprint recorded by
the loop: a provider execution step whose `input_fingerprint` matches an earlier
step in the same episode carries `repeated_from_step_id`. Cost is attributed
from the settled ledger for exactly those repeated steps — not from the step's
own usage snapshot.

`repeated_work` carries the calculation inputs: the fingerprint identifier, each
duplicated step with its origin status and error code, and a `cause` of
`recovery_defect` (the origin was interrupted, cancelled, or timed out, so the
orchestrator lost durable work) or `retry` (the origin failed on its own terms
and was legitimately retried).

The measurement is `null` only when a repeated step's own settlement is missing.
It is not invalidated by an unrelated turn elsewhere in the episode having
estimated or partial usage — that over-strict gate is why a campaign with
plainly duplicated, fully settled work reported no valid result. Zero is
returned only when the evidence proves no repeated work. Every aggregate with incomplete contributors includes quality
and incomplete counts.

### 9.2 Session summary

```ts
interface ReportSessionSummaryV1 {
  id: string;
  kind: "parent_task" | "standalone_trace" | "orphan_run";
  label: string;
  objective_preview: string | null;
  apps: string[];
  scope_partial: boolean;
  started_at: string | null;
  ended_at: string | null;
  outcome: string;
  completion_integrity: "complete" | "incomplete" | "unknown";
  execution_mode: "operon" | "mixed" | "manual" | "not_recorded";
  provider_turns: number;
  mechanical_passes: number;
  known_input_tokens: number;
  known_output_tokens: number;
  recorded_equivalent_cost_usd: number;
  usage_quality: "complete" | "estimated" | "partial" | "unavailable" | "none";
  cost: CostAggregate;
  refs: SourceRefView[];
  warnings: string[];
}
```

### 9.3 Session detail and turn row

`ReportSessionDetailV1` contains the summary, trace integrity, and an exhaustive
ordered `activities` array. Each `ReportTurnV1` carries:

- the accounting row identity and source location;
- run/trace/task/ticket correlation;
- `activity_type` (`provider_turn` or `mechanical_pass`);
- role/runtime/model/effort/pipeline/pass/trigger;
- start, settlement, finish, and wall-clock facts;
- status and quality;
- token components and cost components using nullable unknowns;
- counts and durable refs;
- `envelope_available`, `events_available`, and warnings.

Do not put raw task prompts, briefs, outputs, event detail, or tool arguments in
this schema.

### 9.4 Pagination and stable ordering

Default session order is newest selected activity first, then stable session
ID. API pages use an opaque base64url cursor encoding the sort key, normalized
query, and source fingerprint. A changed source fingerprint returns a
`report_resync_required` response rather than mixing pages from different
snapshots.

CLI JSON and full HTML are exhaustive by default and set `next_cursor: null`.
`--summary-only` omits session activities deliberately and marks the export as
summary-only.

## 10. Local server architecture

### 10.1 Process boundary

Add a second presentation-only leaf and mount it into the existing observer:

```text
src/report/
  types.ts             ReportSnapshotV1/session detail public contracts
  range.ts             UTC preset/custom range normalization
  ledger-source.ts     bounded daily JSONL reader with diagnostics
  detail-source.ts     direct envelope/task/event joins + unsettled scan
  sessions.ts          deterministic task/trace/run grouping
  project.ts           pure facts → report projection
  statistics.ts        sums, shares, percentiles, bucket filling
  render-terminal.ts   concise CLI executive summary
  render-html.ts       portable self-contained report
  assets.ts            report-only browser HTML/CSS/JS
  service.ts           lazy query/cache/pagination facade

src/observe/
  server.ts            mounts Live and Reports GET routes under one token
  assets.ts            shared shell navigation plus existing Live assets

src/cli/report.ts       argument parsing, projection, JSON/HTML/open lifecycle
src/cli.ts              one new registry/help entry
```

`src/report` may import stable types/readers from `src/org`, `src/loop`, and
`src/runtime`. None of those layers imports `src/report`. `src/observe` may
mount the public report service because both are presentation leaves; report
code must not import Observe view types or the observer service.

Do not import private render functions from `src/cli/telemetry.ts`. Extract a
small pure helper only when it genuinely represents shared accounting
semantics and preserves telemetry’s stable output.

### 10.2 Lazy startup

Starting `operon observe` must not scan 90 days or a year of history. Construct
the report service cheaply and read historical data only when `/reports` or a
report API is requested.

The report service may maintain a bounded in-memory cache keyed by:

- org/state-home identity;
- normalized scope/range/bucket/filter/sort;
- selected ledger file stat fingerprint;
- relevant run/task source fingerprint.

It owns no durable state. Observer restart invalidates the cache and
reconstructs the same report from files.

### 10.3 Routes

All routes use the observer’s existing capability and security headers:

```text
GET /reports
GET /assets/report.css
GET /assets/report.js

GET /api/v1/reports/summary?app=&period=&since=&until=&bucket=
GET /api/v1/reports/sessions?app=&period=&since=&until=&sort=&cursor=&limit=
GET /api/v1/reports/sessions/<encoded-id>?app=&period=&since=&until=
GET /api/v1/reports/export.html?app=&period=&since=&until=&summary_only=
GET /api/v1/reports/export.json?app=&period=&since=&until=&summary_only=
```

There are no report `POST`, `PUT`, `PATCH`, or `DELETE` routes. An export route
returns a response/download; it does not write a file in the state home.

Use strict parameter validation, registered-app validation, maximum page size,
and bounded response sizes. A session ID is decoded and matched against the
current report result; it is never treated as a filesystem path.

If the observer was launched with `--app`, the route layer supplies that
immutable server scope to the report service. Omitting `app` then means the
scoped app, not the whole org; asking for another app or org scope fails
closed.

### 10.4 Update semantics

Reports are as-of snapshots:

- changing a filter or pressing Refresh performs a new GET;
- a report whose interval includes now displays “period still open”;
- no report entity is injected into the Live SSE stream;
- no chart animates merely because Live state changed;
- paging detects source-fingerprint drift and requests a report refresh;
- a browser may preserve the last successful report during a failed refresh
  with an explicit stale/degraded banner.

This avoids the confusing state where headline totals update while the owner
is comparing sections lower on the page.

### 10.5 One-server consequence

The current observer already allows multiple disposable reader processes, but
the normal experience needs only one:

```sh
operon observe --open
```

That URL can navigate between Live and Reports. `operon report --html` is not a
server and therefore does not violate the one-server model.

Do not add `operon report --serve`. If a future remote reporting service is
needed, it requires a separate authentication, transport, privacy, and
retention design.

## 11. CLI contract

### 11.1 Output behavior

- No format flag: print a concise terminal executive summary and the top
  allocation/session rows; do not dump every turn.
- `--json`: emit stable `ReportSnapshotV1` JSON, exhaustive unless
  `--summary-only`.
- `--html <path>`: write a self-contained exhaustive report, unless
  `--summary-only`.
- `--json` and `--html` may be combined, matching current telemetry behavior.
- `--open` requires `--html`; open the generated file after an atomic
  successful write.
- Unknown app, invalid dates, inverted ranges, or unknown flags fail with a
  non-zero exit and no partial target.

### 11.2 File behavior

Generate into a sibling temporary file, fsync/close as appropriate, then
rename atomically to the requested path. Do not write into the org/state home
unless the user explicitly chooses such a target.

The report includes:

- generation metadata and normalized query;
- schema/version information;
- source-quality diagnostics without absolute source paths;
- all selected session/turn detail by default;
- no L3 evidence bundle;
- no external assets or requests.

Warn before or during generation when an export exceeds a documented row/size
threshold, but do not silently truncate an exhaustive report. The explicit
`--summary-only` mode is the bounded alternative.

### 11.3 Discoverability

Add `report` to:

- root help and command help;
- `operon capabilities --json` as token-free and workflow-read-only, noting
  that `--html` writes only the user-selected export;
- README command examples and observability/reporting explanation;
- package/onboarding smoke coverage.

## 12. Portable HTML contract

The saved report must be useful when copied to another machine:

- one HTML file with inline CSS, inline bounded JavaScript, inline SVG, and
  embedded report JSON;
- no external fonts, scripts, images, analytics, or network calls;
- responsive at 360 px, tablet, and desktop;
- keyboard-operable filters, disclosures, tables, and chart equivalents;
- visible focus and `prefers-reduced-motion` support;
- print stylesheet with repeated table headings, expanded summary context,
  and legible monochrome distinctions;
- range/app/status/role/model filters over the already embedded selection;
- collapsed session details that remain searchable and printable;
- escaping for every model- or operator-authored string;
- no use of `innerHTML` with data fields;
- safe JSON serialization that escapes `<`, `>`, `&`, U+2028, and U+2029;
- a restrictive CSP `<meta>` suitable for a local standalone file. Hash the
  executable inline script and stylesheet (or use an equivalently strict
  generated policy); do not solve self-containment with a broad
  `script-src 'unsafe-inline'`;
- a banner explaining that the data is an as-of local projection and may
  contain confidential operational metadata.

The portable report cannot expand beyond the range embedded at generation. It
may narrow that range client-side. To inspect a larger interval, regenerate it
or use the served Reports UI.

## 13. Security and privacy

### 13.1 Served mode

Reports inherit every Live UI boundary:

- loopback-only binding;
- per-process high-entropy capability;
- capability cookie/query/Bearer validation;
- no-store, no-referrer, nosniff, frame denial, same-origin, and restrictive
  CSP headers;
- GET/HEAD only;
- no external browser requests;
- token absent from logs;
- no workflow mutations.

Do not put the capability token into ordinary navigation links after browser
bootstrap. The existing HttpOnly cookie authorizes `/reports` and its API.

### 13.2 Data minimization

The report may include scrubbed bounded task-objective and verdict summaries,
stable identifiers, structured statuses, and durable refs. It does not include:

- exact parent prompts;
- `brief.md`, `prompt.md`, `output.md`, or `session.log` content;
- raw event detail or tool arguments;
- environment variables, credentials, or absolute local paths;
- approval action inputs that may contain secrets;
- native transcripts.

Use the canonical secret scrubber for every bounded preview. Preserve hashes
or safe refs where useful.

Efficiency readers accept only the allowlisted `context-manifest.json` sibling
of a run envelope. Missing files are named as missing; malformed, traversal,
or symlink references are named as invalid and are never followed.

### 13.3 Export safety

An exported report is intentionally portable but not automatically safe to
publish. Put a visible confidentiality notice in the document. Never auto-send
or upload it. A future share/redaction mode needs its own explicit schema and
tests.

## 14. Reliability, scale, and retention

### 14.1 Corruption

The ledger reader returns facts plus diagnostics. It distinguishes:

- malformed final non-empty line: torn append, retry/diagnostic;
- malformed mid-file line: corruption, preserve later readable rows and warn;
- unreadable daily file: source gap, not zero activity;
- invalid timestamp or numeric field: exclude the invalid fact and report its
  source location without echoing raw content.

One corrupt row cannot take down the entire report.

### 14.2 Concurrent writes

For each selected JSONL file, capture stat before and after reading. If size,
inode, or modification time changes, retry once. If it changes again, return a
consistent last successful snapshot with a concurrent-write warning. Do not
hold runtime locks or block settlement.

### 14.3 Retention

The ledger is durable accounting history; run directories may be pruned. A
report remains able to answer org/app token and cost questions after pruning,
while session detail clearly loses envelope/event enrichment.

If future policy prunes ledger files, reporting must expose the retained range
and cannot claim all-time totals beyond it.

### 14.4 Performance targets

For a local state home with 10,000 selected ledger rows on a typical SSD:

- initial 90-day summary projection target: under 2 seconds p95;
- subsequent same-query cached summary: under 200 ms;
- session page after projection: under 250 ms;
- no run-directory scan outside the selected interval except bounded legacy
  detection;
- browser DOM contains only the current session page/detail, not every row;
- in-memory caches use explicit row/byte/entry limits and LRU eviction.

These are targets to measure, not claims to make before benchmark evidence.

### 14.5 Shutdown independence

Report generation and browser requests never acquire turn locks or participate
in dispatch. Closing a report, stopping the observer, or cancelling CLI export
must not affect an Operon run.

## 15. Convergence with existing telemetry and budget surfaces

### 15.1 `operon telemetry`

Preserve its existing arguments and stable JSON/HTML semantics. It remains
envelope-first and forensic:

- per-ticket/trace execution;
- completion integrity;
- Gantt and pass detail;
- adjacent L3 evidence bundle.

Reporting is ledger-first and managerial:

- interval trends;
- org/app allocation;
- exhaustive session accounting;
- coverage and operational distributions;
- no raw evidence bundle.

Shared helpers may include usage-quality ranking, cost labeling, identity
keys, and escaped rendering. A refactor must pin existing telemetry tests
before moving code.

### 15.2 `operon budget`

Budget is an enforcement view for the current calendar month. Reports reuse
the same ledger accounting semantics and show the current-month budget panel,
but report generation never enforces, pauses, raises approvals, or reconciles.

An implementation test must prove that a current-month report’s per-app
recorded equivalent cost agrees with `rollupBudgets` for the same fixed clock,
including estimated and unmeasured caveats.

### 15.3 `operon retro` and scorecards

Retro remains a durable weekly synthesis and learning input. Reports show
structured scorecard/event evidence and execution distributions; they do not
replace the retro narrative or write scorecard rows.

## 16. Implementation sequence

### Phase 0 — ratify the contract

- Confirm command name, 90-day default, UTC semantics, deterministic session
  hierarchy, and one-server/two-mode decision.
- Confirm that deterministic/token-free V1 is sufficient.
- Add a concise reporting decision to `docs/PURPOSE.md` only after explicit
  owner approval.

Exit: no unresolved product choice changes the public CLI or schema.

### Phase 1 — pure range, sources, and projection

- Implement strict range parsing/normalization.
- Add a diagnostic daily-ledger range reader.
- Define `ReportSnapshotV1`, session summary/detail, and quality types.
- Implement ledger-first joins, session grouping, statistics, breakdowns, and
  quality accounting.
- Add semantic fixtures for org/app histories, legacy rows, pruned runs,
  unmeasured usage, duplicates, corruption, and boundary dates.

Exit: fixed files plus a fake clock produce deterministic exhaustive JSON with
no CLI/server/UI code.

### Phase 2 — CLI and portable HTML

- Add `src/cli/report.ts`, help, registry, and capabilities metadata.
- Add terminal and stable JSON rendering.
- Add atomic self-contained HTML generation and `--open` behavior.
- Add accessibility, escaping, CSP, print, no-network, and large-export tests.
- Keep `operon telemetry` output byte/shape compatible where pinned.

Exit: from a neutral directory, org/app/range reports render offline and every
selected provider turn appears exactly once or in an explicit diagnostic.

### Phase 3 — one-server Reports mode

- Add the Live/Reports primary navigation without breaking `/`.
- Mount lazy report service and authenticated GET routes into the observer.
- Add report builder, trends, breakdowns, portfolio/app views, session pages,
  refresh, and downloads.
- Add in-memory fingerprinted caching, pagination, resync, and bounded source
  reads.

Exit: one `operon observe` process serves both modes; Live behavior remains
unchanged and Reports works without a second listener.

### Phase 4 — convergence and documentation

- Add cross-links between served report sessions and Live historical views.
- Update README commands, observability inventory, and architecture map.
- Extend onboarding/package smoke coverage for the command and report assets.
- Generate a fixture report and inspect it at 360 px, desktop, reduced motion,
  print preview, and with malicious strings.

Exit: installed-package and source-backed behavior agree from a neutral cwd.

### Phase 5 — real-state acceptance

Against an owner-selected org state home, read-only:

- generate 7d, 90d, and 1y org reports;
- generate one app report;
- reconcile report current-month totals manually against `operon budget`;
- reconcile selected pass/session details against `operon telemetry --json`;
- confirm pruned/legacy/unmeasured records remain honest;
- record generation time, row count, file size, screenshots, and discrepancies.

No provider turn, GitHub mutation, reconciliation, approval action, or deploy
is authorized by this acceptance.

## 17. Test strategy

### 17.1 Range and statistics unit tests

Cover:

- default 90 days at a fixed clock;
- 7d/30d/90d/1y across month/year/leap-day boundaries;
- inclusive custom `until` normalization;
- inverted/invalid/missing custom bounds;
- UTC bucket boundaries and Monday weeks;
- auto bucket selection at 45/46 and 180/181 days;
- sums without cache-token double count;
- reported/estimated/partial/unavailable cost splits;
- nearest-rank percentiles and empty/singleton samples;
- shares with unknown denominators and deterministic tie ordering.

### 17.2 Projection tests

Use `makeOrgHome` and `fakeClock` fixtures. Cover:

- org and app scopes;
- parent task → multiple traces → turns;
- app-scoped slice of a cross-app parent task;
- standalone trace and orphan run fallbacks;
- legacy unattributed ledger rows;
- mechanical pass without provider settlement;
- terminal envelope without settlement;
- settled row with pruned/missing envelope;
- duplicate `(app, runId)` rows without silent dedupe;
- complete/estimated/partial/unavailable/unmeasured usage;
- task outcome differing from interrupted constituent pass history;
- current monthly budget agreement;
- source gaps, corrupt line, torn append, concurrent append, invalid
  timestamp, and future timestamp;
- exhaustive session/turn identity and stable ordering.

### 17.3 CLI tests

- root/help/capabilities discovery;
- unknown app and argument failures;
- terminal, stable JSON, full HTML, and summary-only outputs;
- `--period` versus custom-range exclusivity;
- atomic target behavior on render failure;
- `--open` requires HTML and is platform-command isolated in tests;
- neutral-cwd active-home resolution;
- no state-home mutation;
- malicious previews are escaped;
- no external assets/requests and no L3 content;
- exhaustive HTML contains every selected turn exactly once.

### 17.4 Server integration tests

Start the real observer on port `0` against a temporary state home:

1. Live `/` and `/api/v1/snapshot` remain compatible.
2. `/reports` and every report API require the same capability.
3. Only GET/HEAD are accepted; no workflow mutation route exists.
4. Security/no-store headers cover HTML, assets, JSON, and exports.
5. Starting the observer performs no historical report scan.
6. First report request returns the correct scope/range and quality.
7. Unknown app/range/session/cursor fails safely.
8. Pagination is stable; source change requests resync.
9. Export writes no server-side file.
10. Corrupt source degrades only the report and does not break Live.
11. Report cancellation/observer shutdown leaves simulated running work
    untouched.
12. Cache limits and large-range response bounds are enforced.

### 17.5 Browser tests

Extend the existing Playwright observer suite:

- Live/Reports navigation preserves capability/session behavior;
- default org 90-day report and app switch;
- preset and custom range URL state;
- trend chart and equivalent table agree;
- breakdown filters update session results without double count;
- session expansion shows every selected activity and quality label;
- served HTML/JSON export uses the active query;
- keyboard navigation, visible focus, disclosure semantics, and live-region
  behavior;
- 360 px, tablet, desktop, reduced motion, and print layout;
- malicious objective/model/ref text renders only as text;
- no external browser request;
- report remains an as-of snapshot until explicit refresh.

### 17.6 Repository verification

Implementation changes touch `src/observe/**`, CLI discovery, and packaged
assets, so run:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm smoke:onboarding
npm pack --dry-run
```

(The browser suite is archived during the validation rebuild — root
AGENTS.md → Testing expectations.)

No live provider suite is needed for a read-only report. A real-state
acceptance is evidence reconciliation, not permission to mutate the org.

## 18. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Reports make the Live UI slow | lazy service; range-selected ledger files; direct run joins; bounded cache |
| “Session” becomes a fake canonical entity | deterministic presentation hierarchy; no persisted session store |
| Token totals double count cache | explicit formula; cache fields are subsets/breakouts |
| Unknown usage looks free | nullable JSON; unknown-turn counts; first-position quality banner |
| Report and budget disagree | ledger-first semantics; fixed-clock cross-test; no hidden dedupe/reconcile |
| Pruned runs erase historical totals | ledger remains accounting authority; detail degrades explicitly |
| A year of data makes a huge browser DOM | paged summaries, lazy detail, bounded DOM; static export streams all rows |
| Static HTML leaks prompts/outputs | management schema excludes L3; canonical scrubbing; malicious fixture tests |
| Two modes blur together | separate routes, schemas, navigation labels, and refresh semantics |
| Another server/daemon appears | only Observe serves browser UI; CLI exports files directly |
| “How are we doing?” becomes an invented score | evidence distributions and denominators; no composite health grade |
| Current GitHub state changes an old report | V1 accounting is local/deterministic; current Live context stays separate |

## 19. Definition of done

Reporting V1 is complete when:

- `operon report` is discoverable, token-free, deterministic, and resolves the
  active org from a neutral cwd;
- omitted `--app` produces an org report and `--app` produces an app report;
- default/preset/custom ranges follow the pinned UTC contract;
- ledger totals, token components, cost-quality splits, and unknown counts are
  correct and tested;
- every selected turn is attributable to exactly one session or explicit
  Unattributed section;
- org and app reports include trends, allocations, operating health, and an
  exhaustive session/turn drill-down;
- one observer process serves both Live and Reports under one capability,
  while Live behavior remains compatible;
- portable HTML is self-contained, accessible, print-friendly, escaped,
  confidentially labeled, and contains no L3 artifacts or external requests;
- pruned, legacy, corrupt, duplicate, partial, estimated, and unmeasured data
  remain visible and never become silent zeros;
- report generation never mutates Operon state or performs a provider/GitHub
  action;
- current-month report totals reconcile with budget semantics and sampled
  session details reconcile with telemetry;
- the full offline/browser/build/package verification suite passes;
- the owner-selected real-state acceptance records exact evidence and known
  discrepancies.

## 20. Handoff checklist

Before implementation, a new session should:

1. Read `docs/PURPOSE.md` first, especially Budget & cadence and Live
   observability.
2. Read this entire document and `docs/live-ui/design.md` §§3, 5–11.
3. Inspect `src/runtime/telemetry.ts`, `src/runtime/runlog/status.ts`,
   `src/cli/telemetry.ts`, `src/org/budget.ts`, `src/observe/types.ts`,
   `src/observe/project.ts`, `src/observe/server.ts`, and their tests.
4. Confirm explicit owner ratification before editing `docs/PURPOSE.md`.
5. Preserve all existing telemetry JSON/HTML behavior and Live `/` behavior.
6. Implement phases in order: pure facts first, CLI/export second, server/UI
   third.
7. Use temporary org/state homes and a fake clock for every semantic test.
8. Treat reports as read-only projections; do not repair source history during
   generation.
9. Run and report every required verification command exactly.
