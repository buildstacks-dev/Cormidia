# Cormidia reporting — contract

*Ratified in `docs/PURPOSE.md` v2.0; built and shipping. This is the binding
contract for `src/report/**` and `src/cli/report.ts`. The original full design
(rationale, alternatives, implementation phases) is preserved at
`929c8247:docs/reporting/design.md`.*

Route, context, provider-turn, active-time, human-decision, scheduler, and
learning metrics use `docs/episodes/contract.md` as their canonical
definitions. Reporting projects durable facts and measurement quality; it
never admits a route, repairs workflow state, or converts missing evidence
into zero.

## 1. What reporting is

One local Cormidia web surface with two destinations, plus a token-free CLI:

| Surface | Primary question | Time posture | Canonical output |
| --- | --- | --- | --- |
| `cormidia observe` → Live (`/`) | What is happening or blocked now? | current + forensic replay | changing local browser projection |
| `cormidia report` / Reports (`/reports`) | What happened; where did usage go? | explicit bounded interval | deterministic as-of report |
| `cormidia telemetry` | What exactly happened in these passes? | run/day forensic scope | low-level trace view + evidence bundle |
| `cormidia budget` | May this app spend more this month? | current budget month | enforcement rollup |
| `cormidia retro` | What should the org learn from a week? | weekly evidence synthesis | durable retro artifact |

Ratified decisions, now standing behavior:

- `cormidia observe` is the **only** browser server. It serves Live at `/` and
  a lazily computed Reports mode at `/reports` under the same loopback binding
  and per-process capability. There is no `cormidia report --serve` and no
  second daemon; a future remote service needs its own auth/transport/privacy
  design.
- `cormidia report [--app <name>]` works with no observer running, from a
  neutral cwd, offline: it resolves the active org/state home and renders
  terminal, stable JSON, or portable self-contained HTML directly. It never
  searches for or starts a server, never depends on GitHub, and never mutates
  telemetry.
- Omitted `--app` means the whole org. Default period is the trailing **90 UTC
  calendar days** including today.
- The **org ledger is the accounting authority**. Envelopes, events, parent
  tasks, and scorecards enrich rows but never replace or silently repair the
  ledger.
- Reports are deterministic and token-free: evidence-backed highlights are
  allowed, **model-authored narrative is not** (this is the decision
  `docs/narrative/design.md` inherits). No reporting database, scheduled
  archive, delivery, cloud ingestion, or workflow controls.
- Reports are as-of snapshots with explicit Refresh; they do not subscribe to
  the live SSE stream, and no chart updates merely because Live state changed.
- The two browser modes keep separate routes, read models, and schemas — they
  share source types and small pure helpers, never one view model. Live and
  Reports have conflicting density/freshness needs; merging them makes one
  dishonest.

The report must never infer productivity, business value, code quality,
employee performance, or ROI from token volume. Product completion and
Cormidia execution integrity remain separate claims. Sparse scorecard data is
shown as sparse evidence, never a synthetic score. No adjectival claims
("excellent", "wasteful") — deterministic threshold highlights only, each
linking to its underlying breakdown.

V1 non-goals that remain non-goals: workflow controls of any kind, invoices or
billing reconciliation, arbitrary NL/SQL analytics, remote hosting or
multi-user sharing, cross-org reporting, a new canonical session/task store,
reconstruction of missing correlation from timestamps or text similarity, and
embedded prompts/outputs/transcripts.

## 2. Vocabulary and identity

| Term | Meaning in reporting | Identity/source |
| --- | --- | --- |
| Provider turn | One settled provider `Runtime.runTurn` invocation | ledger row, `(app, providerTurnId)`; legacy fallback `(app, runId)` |
| Execution step | One terminal provider or deterministic operation | `executionStepId` within an episode |
| Pass | One run envelope; may hold several provider turns or be token-free mechanical | `(app, runId)` |
| Trace | Correlated pipeline execution with one or more passes | `(app, traceId)` |
| Parent task | Operator-delegated outcome spanning traces/tickets | `taskId` |
| Report session | Presentation group for management drill-down | deterministic hierarchy below |
| Native session | Provider-specific task/thread identity | evidence only, **never** grouping |

Mechanical passes (envelopes without a settled provider row) appear in session
detail as `mechanical_pass` activity; they never become provider turns and
never add zeros to a provider-turn denominator.

**Deterministic session grouping** — each selected turn/pass belongs to
exactly one report session:

1. `parent_task_id` present → `task:<taskId>`;
2. else a real `trace_id` → `trace:<app>:<traceId>`;
3. else the one run → `run:<app>:<runId>`;
4. a legacy row with no usable correlation → **Unattributed turns**, never a
   fabricated session.

Never group by native provider session ID, timestamp proximity, ticket title,
branch name, or output similarity. `runId` alone is not globally unique. At
app scope, a cross-app parent task shows only the selected app's turns with
`scope_partial: true`.

**Status precedence** — strongest available durable boundary wins:
parent-task terminal status + completion integrity → trace integrity +
constituent pass statuses → orphan pass status → `unknown`. A session may be
complete at the task boundary while retaining interrupted-turn history; show
both.

## 3. Time-range contract

```text
cormidia report [--app <name>] [--period 7d|30d|90d|1y|all]
              [--since YYYY-MM-DD] [--until YYYY-MM-DD]
              [--bucket auto|day|week|month]
              [--json] [--html <path>] [--open] [--summary-only]
              [--org-home <path>] [--state-home <path>]
```

- `--period` is mutually exclusive with `--since`/`--until`; no range flags
  means `90d`. `1y` = today plus the preceding 364 UTC days. `all` starts at
  the earliest readable ledger row and is explicit because it may be large.
- `--since` without `--until` ends at generation time; `--until` without
  `--since` is invalid (guards accidental all-history reads).
- Bounds are UTC calendar dates; `since` inclusive, `until` inclusive in input
  and normalized to an exclusive next-day instant. Report JSON always stores
  normalized `from_inclusive`/`to_exclusive` ISO instants plus
  `display_timezone: "UTC"`.
- Every absolute timestamp in the browser renders through
  `src/report/time-policy.ts`, the single presentation-only time policy shared
  with the Observer (`docs/live-ui/design.md` §6.3). It lives under
  `src/report/` because nothing may import `src/observe`.
- Buckets: `auto` = day ≤45d, week 46–180d, month >180d. Weeks begin Monday
  00:00 UTC. Gap buckets are zero-filled **only** when the gap's source files
  were read successfully — a missing source is a quality gap, not a zero.

**Accounting membership** uses ledger `TurnRecord.at` (settlement day),
keeping the report consistent with budget and retro. Envelopes in range
without settlements are shown separately as unsettled/incomplete lower-bound
activity, selected by `started_at`, never added to ledger totals. Sessions are
included when at least one selected turn is in range; boundaries extending
outside the interval are labeled as such.

## 4. Presentation invariants

- **Data-quality banner precedes headline totals** whenever any of these
  exist: unavailable/unmeasured usage, partial/unsettled turns, estimated
  cost, uncorrelated or duplicate or corrupt ledger rows, missing/pruned
  envelopes, clock skew, or a still-open interval. It states exactly which
  totals are complete, lower bounds, estimates, or unavailable.
- At most eight headline metrics: known input / output / total tokens,
  recorded equivalent cost split reported/estimated, provider turns +
  unknown-usage turns, report sessions, completed sessions + integrity
  coverage, and current-month spend vs budget (app) or apps at
  warning/exceeded (org).
- Trend charts (tokens and cost by bucket) carry an equivalent data table,
  show missing-quality markers, and never draw a zero line through unreadable
  buckets. Inline SVG/CSS only — no charting dependency.
- Allocation breakdowns (by app/role/runtime+model/pipeline/trigger/status/
  usage-quality) declare every percentage's denominator; unknown-usage rows
  count in turn counts but not token shares.
- Operating health shows evidence-backed distributions (outcomes, wall-time
  and cost percentiles, review/fix cycles, gate/escalation counts, scorecard
  coverage). **No composite "org health score."**
- The session index is exhaustive for the interval (served UI pages it;
  portable HTML embeds it all unless `--summary-only`). Session detail rows
  carry identity, assignment, timing, status, token/cost components, quality,
  and durable refs; served mode may open Observe drawers, portable mode shows
  IDs and refs only.
- Empty/partial states are explicit: no ledger ≠ free, no activity in range
  never silently broadens the interval, pruned run detail says "expired by
  retention", legacy app-less rows stay org-scope Unattributed, unsettled
  passes stay lower-bound.
- Scope is visible state: header shows org/state-home identity, scope, UTC
  period, generated-at, and a READ ONLY · TOKEN FREE · AS OF marker plus a
  confidentiality note. URL state reproduces the query; unknown apps fail
  visibly rather than falling back to org scope.

## 5. Accounting rules

Sources and their authority:

| Source | Report use | Authority/limitations |
| --- | --- | --- |
| `telemetry/<date>.jsonl` | settled turns, tokens, cost, status, range membership | **accounting authority**; tolerate and report corruption |
| `runs/<app>/<runId>/envelope.json` | correlation, pass detail, gates, refs, partial usage | per-pass execution truth; may be pruned |
| `events.jsonl` | escalation/tool/subagent counts | L2 evidence; read lazily, bounded |
| `tasks/<taskId>/task.json` | session boundary, objective, fallback, completion integrity | parent delegated-task truth |
| org `apps.yaml` | app identity, lifecycle, monthly budget | current config, not historical budget versions |
| `scorecards/<app>/<role>.jsonl` | sparse quality/rework evidence | secondary; never a composite grade |
| GitHub | none in the deterministic report | the V1 core report makes no GitHub call |

**Ledger-first join:** read only daily ledger files intersecting the
normalized interval; parse with file/line diagnostics; filter by `at` and
scope; join to envelopes by correlation key; load referenced tasks by ID; read
events only for counts the envelope lacks; one bounded scan surfaces
envelope-only activity. Never scan run artifacts merely for totals; never
preload L3.

**Token semantics:** `known_total = sum(tokensIn) + sum(tokensOut)`.
`cacheReadTokens`, `cacheCreationTokens`, `tokensInUncached` are component
breakouts, never added again (cache hit ratio is `cacheReadTokens/tokensIn`;
adding cache tokens would double count). `unmeasured`/`unavailable` rows
increment `unknown_usage_turns`; their placeholder zeros never enter known
totals. Partial usage is a labeled lower bound.

**Cost semantics:** separate sums for provider-reported, Cormidia-estimated,
and partial recorded cost; `recorded_equivalent_cost_usd` is their explicitly
labeled sum, shown only with the split and quality adjacent. Never labeled
"bill" or "cash spent". Unknown cost is not zero.

**Cost aggregation:** every aggregate cost surface projects the settled
ledger through the one primitive in `src/runtime/cost.ts`; envelope-derived
sums are drill-down only and labeled as such. `aggregateCost` returns the
known subtotal, unobservable-turn count/refs, non-provider pass count, and a
coverage verdict: `none` (no provider turns; the zero is authoritative),
`complete`, `partial` (known subtotal is a true floor), `unavailable`. The
fifth usage quality `none` (a pass that invoked no provider) is derived once,
in `classifyEnvelopeUsage` (`src/runtime/runlog/envelope.ts`) — from recorded
`quality` for new envelopes, structurally for old ones — never by matching
the pass name.

**Repeated work:** `repeated_work_cost_usd` derives from the loop's
duplication fingerprint (`repeated_from_step_id` on a provider step whose
`input_fingerprint` matches an earlier step in the episode), attributed from
the settled ledger for exactly those steps. `cause` is `recovery_defect`
(origin interrupted/cancelled/timed out) or `retry` (origin failed on its own
terms). The measurement is `null` only when a repeated step's own settlement
is missing — an unrelated turn's estimated/partial usage elsewhere in the
episode must not invalidate it. Zero is returned only when evidence proves no
repeated work.

**Duplicates and legacy:** repeated settlement keys are detected and
**reported, never silently deduplicated** — `cormidia budget` consumes ledger
rows as recorded, and hidden adjustment would make the two surfaces disagree.
Totals stay ledger-recorded; the quality panel lists duplicate counts and
affected keys. Legacy rows without a run ID count in org totals; without an
app they stay Unattributed and never leak into an app report.

**Coverage metrics** (each with numerator, denominator, exclusions, and
missing inputs): token coverage, cost-quality mix, run-detail coverage,
session-correlation coverage, completion-integrity coverage, episode and
execution-step terminal integrity, ledger coverage (provider steps with
exactly one settlement; mechanical steps require zero), productive-pass
ratio. A required missing input yields `invalid_measurement`, never zero.
Percentiles are nearest-rank over finite eligible values with `n` stated.
Categorical qualities are never averaged into a number.

**No implicit reconciliation:** generation is read-only — it never invokes
`budget --reconcile`, appends ledger rows, repairs envelopes, or persists an
index. A terminal envelope with usage but no ledger row is reported as a
discrepancy with the explicit reconciliation command suggested; the owner
decides.

## 6. Report model

`src/report/types.ts` is the schema authority (`ReportSnapshotV1`,
`ReportSessionSummaryV1`, `ReportSessionDetailV1`, `ReportTurnV1`;
`REPORT_SCHEMA_VERSION = 1`). Standing rules:

- snake_case; a dedicated schema independent of `ObserveSnapshotV1`.
- `null` means unavailable; zero means a **measured** zero.
- No raw prompts, briefs, outputs, event detail, or tool arguments in any
  report schema.
- `roadmap_explanation` is the same read-only product projection consumed by
  Status and Observe, scoped to the report's apps: artifact refs
  authoritative, label lists explicitly non-authoritative, batch `complete`
  rendered separately from nullable `every_unit_success`, cache `unknown`
  never rendered as zero, fast-path reason shown without implying the
  delivery workflow was bypassed.
- Pagination: newest selected activity first, then stable session ID; opaque
  cursors encode sort key + normalized query + source fingerprint; a changed
  fingerprint returns `report_resync_required` rather than mixing snapshots.
  CLI JSON and full HTML are exhaustive (`next_cursor: null`);
  `--summary-only` marks the export as summary-only.

## 7. Architecture

`src/report/` is a presentation-only leaf (see `src/report/AGENTS.md` for
module inventory and local rules). Import law: `src/report` may import stable
types/readers from `src/org`/`src/loop`/`src/runtime`; none of those import
it; `src/observe` mounts the public report service, and report code never
imports Observe view types. Private render functions in
`src/cli/telemetry.ts` stay private — extract a pure helper only for genuinely
shared accounting semantics, preserving telemetry's stable output.

- **Lazy startup:** starting the observer scans no history; historical reads
  happen on first `/reports` or report-API request. The in-memory cache is
  bounded, keyed by identity + normalized query + source stat fingerprints,
  owns no durable state, and rebuilds identically after restart.
- **Routes:** GET/HEAD only under the observer's existing capability and
  security headers — `/reports`, report assets, and
  `/api/v1/reports/{summary,sessions,sessions/<id>,export.html,export.json}`.
  No mutation routes; exports return a response, never a server-side file.
  Strict parameter/app validation, bounded pages and response sizes; session
  IDs are matched against the current result, never treated as paths.
- **Immutable server scope:** `cormidia observe --app <name>` locks Reports to
  that app server-side; report APIs then reject org-wide or sibling-app
  queries (omitting `app` means the scoped app). `--parent-task`/`--ticket`
  remain initial Live selections only.
- **Update semantics:** filter changes and Refresh are new GETs; an interval
  including now shows "period still open"; paging detects fingerprint drift
  and requests refresh; a failed refresh may keep the last report with an
  explicit stale banner.

## 8. CLI contract

- No format flag → concise terminal summary plus top rows; `--json` → stable
  exhaustive `ReportSnapshotV1`; `--html <path>` → self-contained exhaustive
  report; the two combine; `--open` requires `--html`.
- Unknown app, invalid dates, inverted ranges, or unknown flags fail non-zero
  with no partial target. Writes go to a sibling temp file then atomic
  rename; never into the org/state home unless the user targets it.
- Large exports warn but are never silently truncated; `--summary-only` is
  the bounded alternative.
- `report` is discoverable in root help, `cormidia capabilities --json`
  (token-free, workflow-read-only), README, and packaging smoke coverage.

## 9. Portable HTML contract

One self-contained file: inline CSS/JS/SVG with embedded report JSON; no
external requests of any kind; responsive to 360 px; keyboard-operable with
visible focus and `prefers-reduced-motion` support; print stylesheet; escaping
for every model- or operator-authored string; no `innerHTML` with data; JSON
serialization escapes `<`, `>`, `&`, U+2028/U+2029; a restrictive CSP `<meta>`
with hashed inline script/style (never broad `unsafe-inline`); a visible
confidentiality banner. The file can narrow its embedded range client-side but
never expand beyond it.

## 10. Security and privacy

Served mode inherits every Live UI boundary: loopback-only, per-process
capability (HttpOnly cookie after bootstrap — the token never appears in
navigation links or logs), no-store/nosniff/frame-denial/CSP headers, GET/HEAD
only, no external requests, no workflow mutations.

Data minimization: scrubbed bounded objective/verdict summaries, stable IDs,
structured statuses, and durable refs — never prompt/output/log file content,
raw event detail, tool arguments, env vars, credentials, absolute paths, or
approval inputs. Every bounded preview passes the canonical secret scrubber.
Efficiency readers accept only the allowlisted `context-manifest.json` sibling
of an envelope; malformed, traversal, or symlink references are named invalid
and never followed. Exports are portable but not publish-safe: visible
confidentiality notice, never auto-sent.

## 11. Reliability and retention

- **Corruption:** the ledger reader returns facts plus diagnostics —
  torn final line (retry/diagnostic) vs mid-file corruption (preserve later
  rows, warn) vs unreadable file (source gap, not zero) vs invalid field
  (exclude the fact, cite location, never echo raw content). One corrupt row
  never takes down the report.
- **Concurrent writes:** stat before and after each JSONL read; retry once on
  change, then return the last consistent snapshot with a warning. Never hold
  runtime locks or block settlement.
- **Retention:** the ledger is durable accounting history; pruned run
  directories degrade session detail explicitly while totals survive. If
  ledger pruning ever exists, the report exposes the retained range and
  claims no totals beyond it.
- **Independence:** report generation and browser requests never acquire turn
  locks or participate in dispatch; stopping them cannot affect a run.
  Performance targets (90-day summary < 2 s p95 at 10k rows, cached < 200 ms,
  bounded DOM and LRU caches) are targets to measure, not claims.

## 12. Relationship to sibling surfaces

- `cormidia telemetry` stays envelope-first and forensic (per-ticket
  execution, Gantt, L3 evidence bundle); `cormidia report` is ledger-first
  and managerial. Telemetry's JSON/HTML stays backward compatible.
- `cormidia budget` is enforcement for the current month; reports reuse the
  same ledger semantics and render the durable budget-admission overlay as a
  separate `budget_paused` fact (`PAUSED`/`active`), never deriving it from
  computed status and never writing it. A fixed-clock test must keep report
  per-app current-month cost in agreement with `rollupBudgets`, and
  threshold/pause state consistent across report outputs, `budget`, `status`,
  and the observer.
- `cormidia retro` remains the durable weekly synthesis; reports show
  structured evidence, never replace the retro narrative or write scorecards.

## 13. Validation-campaign evidence

Reports read `validation/campaigns/*/report.json` through the product-owned
schema in `src/org/validation-campaign.ts` — read-only, outside range
filtering (a campaign is target-scoped current evidence, not a ledger row).
Org reports show every report; app reports show campaigns naming that app.
Each row renders lane, kind, separate completeness/verdict, collected/required
cases, and observed/max spend. `inconclusive` renders as "NOT A PASS; NOT
RELEASE EVIDENCE," never with pass/green semantics; unreadable or
identity-mismatched reports render corrupt/incomplete with a data-quality
notice; absence renders "no recorded campaign evidence," not success. Every
nonempty campaign section points to `docs/qualification/validation-triage.md`.
Report generation never repairs campaign evidence.
