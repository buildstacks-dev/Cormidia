# Operon Live UI — observability design

*Status: ratified and implemented; this is the authoritative V1 contract.*

*Version: 1.0 — 2026-07-12.*

*Audience: a new implementation session, reviewers, and the human operator.*

## 1. Executive summary

Operon should remain **agent-operated and human-observable**. A human gives
work to Operon through a coding agent or the CLI; a local, read-only Live UI
shows what the org is doing, what is waiting, why a pass is running, whether it
is healthy, what evidence it has produced, and what needs attention.

The proposed command is:

```sh
operon observe --app <app> --open
```

It starts a loopback-only HTTP server, reconstructs current state from
Operon's existing durable artifacts, and streams changes to a browser using
Server-Sent Events (SSE). It owns no workflow state and offers no configuration
or mutation controls. Stopping the server cannot stop or alter Operon work;
restarting it reconstructs the same view from disk and GitHub.

The UI unifies live and historical telemetry. A running trace continues to
update; once it ends, the same page becomes its permanent replay and forensic
record. The existing `operon telemetry` terminal, JSON, and portable HTML
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
- Operon state is durable in git plus files.
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
human → coding agent or Operon CLI → Operon runtime → GitHub/app artifacts
```

The Live UI is a projection alongside that path:

```text
                             ┌─ runs / tasks / approvals / ledger
Operon runtime ──────────────┼─ GitHub issues / PRs / reviews
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
12. Did every required Operon stage actually complete?

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
not mutate Operon.

## 4. Vocabulary and the queue model

The UI must use these terms precisely.

| Term | Meaning | Authoritative source |
| --- | --- | --- |
| App lifecycle | `onboarding`, `live`, or `paused` | org `apps.yaml` |
| Onboarding | Create/bootstrap/register an app and produce enough product truth to begin planning | app `.operon/**`, org registry, planning artifacts |
| Intake signal | Human request, support feedback, adoption signal, alert, schedule, or another event that wakes a role | parent task, file-drop event, GitHub event, schedule state |
| Product-delivery queue | Open GitHub issues carrying `op:ready` | GitHub |
| Delivery work item | One GitHub issue moving through the build-loop state machine | GitHub labels plus loop artifacts |
| Parent task | The broader outcome delegated by a human/outer agent | `tasks/<taskId>/task.json` and prompt |
| Trace | One selected pipeline execution, potentially containing several passes | correlated run envelopes |
| Pass | One provider turn by one role in one app | `runs/<app>/<runId>/` |
| Invocation | One loop, dispatch, or release orchestration call | `invocations/<date>.jsonl` |
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

- Operon org name and resolved state-home identity;
- selected app or “all apps”;
- connection state: `live`, `reconnecting`, `degraded`, or `offline`;
- last successful local projection and GitHub refresh times;
- active pass count and org WIP limit;
- pending approvals count;
- recorded monthly spend and its quality marker;
- a clear **READ ONLY** indicator.

Filters belong in URL state so a coding agent can hand the human a stable
link. Initial filters: app, parent task, ticket, status, role, and time range.

### 5.2 Overview page

The overview has four ordered sections.

#### A. Attention

Show only conditions requiring interpretation:

- pending approval;
- stale running pass;
- failed/timed-out/cancelled pass;
- `op:returned` ticket;
- partial/unavailable usage;
- disconnected GitHub source;
- corrupt/torn durable record;
- app budget exceeded or paused.

Empty is healthy and should occupy little space.

#### B. App lifecycle and intake

For each selected app, show:

- lifecycle (`onboarding`, `live`, `paused`);
- current onboarding/planning activity;
- pending company-lifecycle events and scheduled role work when observable;
- recently produced tickets or artifacts;
- explicit reason when Support/Marketing is channel-gated.

This prevents onboarding and non-ticket role activity from being mislabeled as
delivery queue work.

#### C. Delivery work

Use grouped columns or a compact list:

- **Ready** — `op:ready` in scheduler claim order;
- **Building** — `op:building`;
- **Reviewing** — `op:in-review`;
- **Waiting approval** — `op:blocked`;
- **Returned** — `op:returned`;
- **Recently completed** — merged/closed outcomes with Operon evidence.

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

The stream pauses auto-scroll when the operator scrolls upward. Heartbeats are
coalesced in the visual stream but still update freshness.

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

### 5.5 Historical replay

A completed task uses the same graph and activity timeline. The operator can
scrub to a point in time and inspect what was known then. Replay uses event
timestamps and envelope final state; it must not manufacture intermediate
states absent from old records.

The historical page also shows completion integrity:

- required/observed/skipped stages;
- interrupted and stale passes;
- workdir/branch/HEAD consistency;
- usage/cost completeness;
- exact-HEAD Operon review status;
- manual fallback;
- PR/merge/issue-close outcome;
- Operon end-to-end completeness separately from product completion.

## 6. Authoritative data and projection rules

### 6.1 Source inventory

| Source | UI use | Authority/freshness rule |
| --- | --- | --- |
| Org `apps.yaml` | app identity, status, WIP, budget, cadence/channels | authoritative configuration; read only |
| App `.operon/**` | onboarding/config/policy context | display provenance; org registry governs operation |
| GitHub issues/labels | delivery queue and ticket state | authoritative for ready/claimed/review/closed state |
| GitHub PR/review/check state | review and completion outcome | authoritative external delivery evidence |
| `tasks/<taskId>/` | parent objective, exact outer prompt, fallback, result refs | authoritative parent-task record |
| `runs/<app>/<runId>/envelope.json` | pass identity, status, usage, refs, heartbeat | L1 source of truth per pass |
| `runs/**/events.jsonl` | live structured timeline and spans | append-only L2; tolerate only torn trailing line |
| `brief.md`, `prompt.md`, `output.md`, `session.log` | explicit local forensic evidence | verbatim L3; never preload into overview |
| Ticket journals/worktrees | recovery and phase evidence | supporting process-owned state; do not override GitHub labels |
| `telemetry/<date>.jsonl` | settled per-turn cost and budget attribution | ledger truth after settlement; run envelope may show partial checkpoint first |
| `invocations/<date>.jsonl` | loop/dispatch/release orchestration | invocation history, not provider-turn history |
| `locks/` | active role/app ownership | fresh lock is supporting liveness; pass heartbeat is still shown separately |
| `state/schedule.json` and event state | due/fired/pending activity | scheduler-owned operational state |
| `state/events/inbox/` | company-lifecycle intake | pending until consumed for all subscribers |
| `approvals/` | critical-operation safety queue | authoritative approval state/audit |

The projection must expose per-source freshness and degradation. “GitHub
unavailable” is different from “no ready tickets.” “No heartbeat recorded” is
different from “stalled.”

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
  schema_version: 1;
  generated_at: string;
  cursor: string;
  org: OrgView;
  sources: SourceHealthView[];
  apps: AppView[];
  intake: ActivityView[];
  delivery: DeliveryTicketView[];
  parent_tasks: ParentTaskView[];
  traces: TraceView[];
  passes: PassView[];
  approvals: ApprovalView[];
  totals: TotalsView;
  attention: AttentionItemView[];
}

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
snake_case, consistent with `operon telemetry --json`.

### 6.4 Identity and correlation

Use existing IDs only:

- org name plus app name;
- GitHub repo plus issue/PR number;
- parent task ID;
- trace ID;
- `(app, runId)` for a pass/ledger settlement;
- event `span_id`/`parent_span_id`;
- approval and invocation IDs.

`runId` alone is not globally unique. Text similarity, timestamps, branch
names, or prompt contents must never be used to invent parent/child links.

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
- `estimated`: Operon-computed equivalent cost, not a provider invoice;
- `unavailable`: usage was not observable.

Unknown or unavailable cost is never displayed as free. Totals inherit the
least-complete quality of their contributors and show incomplete-pass counts.

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
operon observe [--app <name>] [--parent-task <id>] [--ticket <number>]
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
- make SIGINT/SIGTERM stop only the observer, never an Operon turn;
- perform no provider turn and spend no tokens;
- perform only read operations against GitHub.

The command should be listed by `operon capabilities --json` as read-only and
token-free. An outer coding agent can start it in a managed background shell
and hand the URL to the human. Operon should not silently auto-start a server
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
TypeScript/JavaScript client with no runtime UI framework. Operon is one CLI
package, and a React/Vite application would add build and packaging machinery
before the interaction model justifies it.

Required frontend behaviors:

- keyed incremental rendering without losing drawer/filter state;
- keyboard navigation and visible focus;
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

- Observer startup failure never blocks `operon loop` or `operon dispatch`.
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

- Confirm the command name `operon observe`.
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

Exit: `operon observe` renders a complete historical snapshot and survives
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

- Reuse the projection in `operon telemetry` where doing so preserves its
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
the observer resolves the active org rather than treating the Operon package
checkout as an org home.

No live provider test replaces this offline suite.

## 12. Live acceptance: buildstacks.dev through Bikram-Org

### 12.1 Purpose

The live acceptance test should exercise a genuine Operon flow while the UI is
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

- Operon can execute normally with the observer present.
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

- Installed `operon context --json` resolves org `Bikram-Org`, org home
  `~/Build/Bikram-Org`, and state home `~/.operon/Bikram-Org`.
- `~/Build/Bikram-Org/apps.yaml` currently has no registered apps.
- The buildstacks.dev checkout contains `.operon/config.yaml` with
  `status: onboarding` plus the design artifacts above.
- The checkout was clean at commit `14f7fbb624335406a9c7044f32a24e932287c7e8`
  on branch `build/buildstacks-v1`.
- Installed `operon status --app buildstacks.dev` showed no current run rows.
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

Never run `operon app reset ... --execute` as an inferred test setup step. Its
non-mutating plan is safe; execution requires the explicit reset authorization
and confirmation already defined by Operon.

### 12.4 Preflight

Run and preserve exact output:

```sh
command -v operon
operon capabilities --json
operon context --json
operon org show --json
operon doctor --json
operon apps
operon approvals list
operon budget

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
operon capabilities --json
operon context --json
```

If buildstacks.dev is not registered, follow the installed skill's existing-app
bootstrap procedure: scan the local checkout first, use a human-reviewed
answers file, review emitted `.operon/**`, and confirm the resulting org
registry entry. Do not hand-edit human-ratified configuration just to make the
test convenient.

Before spending tokens:

```sh
operon plan buildstacks.dev --dry-run
operon loop --app buildstacks.dev --once --dry-run
operon dispatch --dry-run
```

An onboarding app can be exercised with an explicitly invoked manual loop once
it is registered. Autonomous dispatch remains reserved for apps whose
human-ratified status is `live`.

### 12.5 Create one correlated acceptance task

Create an exact prompt file describing the design slice, non-deploy boundary,
completion criteria, and UI assertions. Begin one parent task before planning:

```sh
operon task begin \
  --id live-ui-buildstacks-<date> \
  --app buildstacks.dev \
  --prompt-file <exact-prompt-file>

export OPERON_PARENT_TASK_ID=live-ui-buildstacks-<date>
```

The task ID must stamp planning and loop passes so the UI and final report can
filter out historical buildstacks.dev work. If any implementation or review
continues outside Operon, record `operon task fallback` immediately; do not let
the UI claim end-to-end Operon completion.

### 12.6 Start observation before work

In a separate managed process:

```sh
operon observe \
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
3. Run `operon loop --app buildstacks.dev --once` for bounded ticks, or
   `--follow` only when the operator explicitly wants the continuous driver.
4. Allow the normal Builder → gates → Reviewer → fix/ship state machine to
   operate. Do not bypass approvals or quality gates for the UI demo.
5. Do not deploy buildstacks.dev. A release approval, if the ticket declares a
   deployable milestone, is an expected safety stop rather than a UI failure.

Keep the observer in a separate process. Do not pipe Operon output into the UI;
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
3. Stop and restart only the observer; confirm the Operon pass continues and
   the new server reconstructs it.
4. Open prompt, output, event stream, and activity-log evidence; verify the
   activity log is not labeled transcript.

Do not deliberately kill a production-app provider turn merely to test stale
recovery. Cover that deterministically in fixtures or a disposable sandbox.

### 12.9 End-state reconciliation

After the flow reaches its authorized stopping point:

```sh
operon telemetry \
  --app buildstacks.dev \
  --json

operon telemetry \
  --app buildstacks.dev \
  --html /tmp/live-ui-buildstacks-<date>.html

operon status --app buildstacks.dev
operon analyze --app buildstacks.dev
operon budget
operon approvals list
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

- Operon behavior and durable artifacts are unchanged by observer presence;
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
- `operon observe` is discoverable, packaged, local-only, token-free, and
  reconstructable;
- overview, delivery, activity, execution graph, pass evidence, cost, source
  health, and completion integrity meet this contract;
- deterministic unit, integration, browser, failure, security, accessibility,
  packaging, and neutral-CWD tests pass;
- existing `operon telemetry --json` compatibility is preserved or deliberately
  versioned;
- a sandbox live run proves failure/recovery cases;
- the authorized buildstacks.dev/Bikram-Org run meets the live acceptance
  thresholds and leaves an evidence record;
- architecture/command/testing documentation and the nearest `AGENTS.md` are
  updated for the implemented contract;
- known limitations and deferred remote-hosting/control features are explicit.

## 15. Handoff checklist for a new session

1. Read `docs/PURPOSE.md`, this document, `docs/architecture.md` §§2/9/10,
   `docs/loop.md` §§7/9, and the prior buildstacks telemetry investigation.
2. Run the Operon skill discovery commands; verify the active org and state
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
