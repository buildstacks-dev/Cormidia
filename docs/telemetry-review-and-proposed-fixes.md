# Telemetry Review and Proposed Fixes

Status: analysis, 2026-07-10. No code changed.

This document reviews what Operon actually records when its agents run, names
the defects found, and lays out a staged path to a live and historical
visualization of org activity. It is written to be tackled progressively:
each stage is independently shippable and each later stage assumes only the
earlier ones.

The review was conducted against a live org home driving a real app
(`buildstacks.dev`, `status: onboarding`, `budget_usd_month: 300`) through
ticket #2 — a greenfield Astro scaffold. Nineteen loop passes had executed
that day across the `build-contract`, `build-implement`, `fix-fix`, and
`gates-quality-gates` pipelines.

Related: `docs/bugs-to-be-fixed.md` (dogfooding backlog),
`docs/architecture.md` §7–§8 (budget and telemetry design),
`docs/loop.md` (pass/verdict/gate model),
`src/runtime/runlog/` (the L1–L3 writers).

---

## 1. Executive summary

Operon writes two records of agent activity, and the authoritative one is not
the one named `telemetry/`.

- **`<orgHome>/runs/<app>/<run-id>/`** — four files per pass. Contains real
  token counts, real cost, real trace and span identifiers, the exact prompt
  the agent received, and the output it produced. This is the source of truth.
- **`<orgHome>/telemetry/<date>.jsonl`** — the org-level ledger. Contains one
  row per *dispatched turn*. It does not contain loop passes at all, and the
  rows it does contain are all zero-cost.

The consequence is not merely cosmetic. `src/org/budget.ts` computes monthly
spend by summing `costUsd` over the ledger. Because the ledger is empty of
loop activity, **the budget cap is not an enforced control.** During the
reviewed session the envelopes recorded 21,203,867 input tokens and
**$111.38** — roughly 37% of the app's $300 monthly cap — while
`operon budget` reported `$0.00`. (By end of that day the same org had
reached **$266.41 — 88.8% of the cap — across 55 passes**, budget still
reporting `$0.00`; the full-day reconstruction lives in
`docs/proportionality-review.md`.)

Three defects, in priority order:

| # | Defect | Severity | Root cause |
| --- | --- | --- | --- |
| B | Loop spend never reaches the ledger; budget cap unenforced | **High — safety** | `recordTurn` is never called from `src/loop/` |
| A | Planner turns record hardcoded zeros | Medium — correctness | `operon plan` spawns the `claude` CLI with inherited stdio; usage is unobservable |
| C | Every run envelope references a `session.log` that is never written | Low — integrity | L3 writer not wired |

And one capability gap that gates the visualization: **adapters never emit
`tool_use` or `subagent` events**, so a pass that ran for minutes and spent
over a million tokens is represented on a timeline by two dots and a gap.

---

## 2. Where the data actually lives

### 2.1 The run log — authoritative

```
<orgHome>/runs/<app>/<YYYYMMDD-HHMMSS>-<pipeline>-<pass>/
├── envelope.json    # trace_id, pass, role, model, status, usage, timings, verdict
├── events.jsonl     # trace/span-scoped lifecycle events
├── brief.md         # the exact prompt the agent received
└── output.md        # what the agent produced
```

A representative envelope from the reviewed session:

```json
{
  "run_id": "20260710-150959-build-implement",
  "trace_id": "20260710T150717-build-2",
  "app": "buildstacks.dev",
  "ticket": "#2",
  "pipeline": "build",
  "pass": "implement",
  "role": "builder",
  "model": "gpt-5.5",
  "status": "blocked",
  "usage": {
    "tokens_in": 1346048,
    "tokens_out": 9726,
    "cost_usd": 7.022,
    "subagent_turns": 0,
    "cache_read_tokens": 650240
  },
  "wall_clock_ms": 203984
}
```

So: *what an agent was asked to do* is in `brief.md`; *what it did* is in
`output.md`; *how it went and what it cost* is in `envelope.json`. Nothing is
duplicated between `runs/` and `telemetry/` — they are disjoint, and the
larger of the two is the one operators are not told about.

### 2.2 The telemetry ledger — partial

`<orgHome>/telemetry/<date>.jsonl`, one `TurnRecord` per line
(`src/runtime/telemetry.ts`). Written only by `recordTurn`, which has exactly
three call sites:

- `src/org/turn-runner.ts:157` — dispatched role turns
- `src/org/turn-runner.ts:183` — dispatched role turns
- `src/org/plan.ts:243` — manual planning sessions

`src/loop/` is not among them.

### 2.3 Documentation gap

Neither `AGENTS.md` nor `README.md` tells an operator that `runs/` exists,
what it contains, or that it — not `telemetry/` — is where cost lives.
`AGENTS.md` names `src/runtime/runlog` as "L1–L3 runlog writers", which
locates the *code* for a contributor and the *artifacts* for nobody. Given two
sibling directories with overlapping names and the authoritative data in the
less obvious one, this belongs in both files.

---

## 3. Defects

### Defect B — Loop spend never reaches the ledger (High, safety)

**Problem statement.** Every provider turn executed by the build loop is
invisible to org-level accounting. The budget cap that `apps.yaml` declares is
never compared against real spend.

**Evidence.** `src/org/budget.ts:93`:

```ts
async function readMonthSpend(orgHome: string, month: string): Promise<Map<string, number>> {
  const dir = join(orgHome, "telemetry");
  // ... sums record.costUsd over <month>*.jsonl
}
```

The ledger for the reviewed day contained eight rows, all `role: planner`, all
`costUsd: 0`. The envelopes for the same day totalled $111.38. Additionally, a
grep of `src/loop/**` finds no budget check of any kind — so even a correct
ledger would not currently stop a runaway loop mid-pipeline. The per-turn role
cap (which did fire, at $15.50) is a separate mechanism and does not roll up.

**Why the existing backlog entry is insufficient.**
`docs/bugs-to-be-fixed.md` → *"Budget ledger omits spend from aborted and
gate-blocked loop turns"* attributes the gap to pipelines that ended in an
abort or a gate denial rather than publication. That framing is too narrow.
The `build-implement` pass shown above completed and settled its usage into
its envelope, and it is still absent from the ledger. **No loop pass reaches
the ledger, on any terminal status**, because the write is not attempted. That
entry should be superseded by this section.

**Blast radius.** Everything downstream of the ledger reads a fiction:
`operon budget` (cap enforcement), `operon status`, `src/org/retro.ts`
(retro reporting), `src/org/scorecards.ts` (role scorecards).

**Proposed fix.**

1. Settle usage exactly once per provider turn, at the point the turn
   returns — not at pipeline publication. The pass executor already has a
   `TurnResult` with populated `usage`; it needs to call `recordTurn` with
   the same `toRecord(role, result, at, { app, trigger })` shape the
   dispatcher uses.
2. Idempotency: key the settlement on `run_id` so a resumed or retried pass
   cannot double-count. Consider carrying `run_id` and `trace_id` onto
   `TurnRecord` — both are useful for correlation regardless (see §5).
3. Add a preflight check in the loop: before starting a pass, compare the
   remaining app budget against a tier-based estimate, and refuse or escalate
   rather than discovering exhaustion mid-turn.
4. Provide a reconciliation command (`operon budget --reconcile`) that walks
   `runs/**/envelope.json` and rebuilds the ledger, so existing orgs recover
   their real history rather than starting from zero.
5. Label subscription-backed provider cost clearly as an Operon-computed
   equivalent-cost estimate. `RunUsage` already carries the
   `costUsd`-is-estimated flag (`src/runtime/types.ts:89`); surface it.

**Regression coverage.** A loop pass that completes, one that is blocked on a
gate, and one that is aborted on budget must each append exactly one ledger
row with nonzero cost. A resumed pass must not append a second.

---

### Defect A — Planner turns record hardcoded zeros (Medium, correctness)

**Problem statement.** Every `operon plan` turn writes a telemetry row whose
token counts and cost are the literal `0`.

**Evidence.** `src/org/plan.ts:240`:

```ts
usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns: 0, wallClockMs },
```

This is not an oversight in the accounting. Twenty lines earlier,
`spawnClaude` (`src/org/plan.ts:214`) launches the native `claude` CLI as a
child process:

```ts
const child = spawn(invocation.command, invocation.args, {
  cwd: invocation.cwd,
  stdio: "inherit",
});
```

With `stdio: "inherit"`, the session's tokens flow to the operator's terminal
and never through Operon. There is no value available to record, so the
function writes zero. The rows look half-alive because `wallClockMs` *is* real
— one reviewed row shows `1121757`, an eighteen-minute co-planning session.

**Why patching the literal is wrong.** Writing a nonzero number there would
require inventing one. The defect is the observability of the spawned session,
not the record shape.

**Recoverability note.** The spawned CLI's own session transcripts do
retain usage, but each provider assistant message may appear in multiple JSONL
rows — one per emitted content block — with identical usage. Deduplicating by
provider `message.id`, the reviewed day's eight planning sessions yield
5,894,225 gross input tokens (54,138 uncached + 5,509,746 cache-read +
330,341 cache-creation) and 78,674 output tokens. This is real, material spend
that the ledger records as zero. A `--reconcile` pass could recover historical
planner usage from these transcripts where they still exist, but it must apply
the same message-ID deduplication to avoid multiplying usage.

**Proposed fix.** This is the same root cause as
`docs/bugs-to-be-fixed.md` → *"Co-planning cannot publish tickets
non-interactively"*, and should be fixed with it. A non-interactive planning
mode built on the real `ClaudeRuntime` returns a `TurnResult` with genuine
usage, and `recordPlanTelemetry` then records the truth. Interactive human
co-planning can remain as an explicit separate mode — but in that mode Operon
should record `usage: undefined` (or an explicit `"unmeasured"` marker) rather
than a zero that silently sums into budget totals as if the session were free.

---

### Defect C — `session.log` referenced but never written (Low, integrity)

**Problem statement.** All nineteen envelopes in the reviewed session declare:

```json
"refs": { "events": "events.jsonl", "brief": "brief.md",
          "output": "output.md", "session_log": "session.log" }
```

No `session.log` exists in any run directory. Any consumer that follows the
declared ref — a dashboard, a retro tool, a human — hits a missing file.

**Proposed fix.** Either wire the L3 session-log writer, or omit the ref when
the file is not produced. Omitting is cheap and honest; a ref should be a
promise. If L3 is deferred, prefer omission and track the writer separately.

---

### Gap D — Adapters emit no `tool_use` or `subagent` events

**Problem statement.** A pass emits five events for its entire lifetime:

```
run.started · pass.started · escalation.raised · pass.completed · run.completed
```

The `build-implement` pass above ran for 3m24s and consumed 1.3M input tokens.
Its event stream contains no evidence of any work occurring between
`pass.started` and `pass.completed`.

**Evidence.** The plumbing exists and is unused. `src/loop/pipeline.ts:228`
already bridges the right event kinds:

```ts
if (e.type === "tool_use" || e.type === "subagent") bridged.push(e);
```

`src/runtime/runlog/envelope.ts:63` declares `tool_counts`, and
`envelope.ts:148` merges it across a pass. Zero of the nineteen envelopes
contain a `tool_counts` key, because no adapter ever emits a `tool_use` event
for the bridge to catch. This is the limitation already noted in
`AGENTS.md` → *Known limitations*, and it has two downstream effects:

- `src/runtime/runlog/anomalies.ts:51` reads
  `run.envelope.tool_counts?.["bash"] ?? 0` and is therefore permanently
  inert, along with its sibling detector.
- The visualization in §5 cannot show work in progress, only work completed.

**Proposed fix.** Emit `RunEvent`s of `type: "tool_use"` and
`type: "subagent"` from each adapter's stream handler. `src/runtime/types.ts`
already defines the full shape (name, duration, outcome, hashed args at the L2
boundary). Claude Agent SDK and pi both surface tool-call streams natively;
the Codex App Server path is constrained by the documented read bypass and may
land partial coverage first. `docs/capability-matrix.md` should record what
each adapter can emit.

---

## 4. What is already right

Worth stating plainly, because it determines how much of §5 is new work:

- **Correlation identifiers are present and correct.** Every line of
  `events.jsonl` carries `trace_id`, `span_id`, `app`, `ticket`, `pipeline`,
  `pass`, `role`, and `model`. A pass groups under a trace; traces group under
  a ticket. Reconstructing *contract → implement → gates → fix* as a DAG
  requires no new fields.
- **Usage measurement is accurate where it is captured.** Envelope numbers
  reconcile with provider expectations, including `cache_read_tokens` at
  ~48% of input on the reviewed pass.
- **The ledger schema is ready for cache economics.** `TurnRecord`
  (`src/runtime/telemetry.ts:22-24`) already declares optional
  `cacheReadTokens`, `cacheCreationTokens`, and `tokensInUncached`. Only the
  writer fails to populate them.
- **Escalations are recorded where they happen.** `escalation.raised` carries
  the tool and the rule that fired, which is exactly the marker a human wants
  on a timeline.
- **Prompt and output are durable.** `brief.md` and `output.md` mean a
  historical view can show *what the agent was actually asked*, which most
  agent dashboards cannot.

---

## 5. Path to a solid visualization

Target: `operon telemetry [--org <name>]` opens a local web view with a **live**
mode and a **historical** mode ("what happened in the last 24 hours").

The live mode is the easy half — tail today's `events.jsonl` files. The
historical mode is a glob over `runs/`. Neither requires a database; both
require the data to be honest first.

### Stage 0 — Documentation (no code)

Record in `AGENTS.md` and `README.md` where run artifacts live, what the four
per-pass files contain, and that `runs/` rather than `telemetry/` is the
source of truth for cost until Defect B is fixed. Cheap, and it stops the next
reader from re-deriving §2.

### Stage 1 — Make the numbers true (Defect B, then A, then C)

Fix B first. It is a live safety hole, not a display concern, and it
simultaneously unblocks `operon budget`, `operon status`, retro, scorecards,
and the dashboard's cost view. Ship `--reconcile` with it so existing orgs
recover history. Then A, then C.

**Exit criteria.** `operon budget` for the reviewed org reports a figure that
matches the sum over `runs/**/envelope.json` to the cent. A pass that would
exceed the app cap does not start.

### Stage 2 — A read-only view over `runs/` (no new telemetry)

Build the dashboard against `runs/` directly, not against the ledger. It can
ship before Stage 1 completes and will only get more accurate.

What is renderable **today**, with zero schema change:

- **Ticket view.** Group traces by `ticket`, render passes as a Gantt with
  `started_at` / `wall_clock_ms`. This is the "how did they work together"
  picture: contract → implement → gates → fix, with the fix loop visible as a
  cycle.
- **Pass detail.** `brief.md` and `output.md` side by side, with the verdict
  and `status`.
- **Cost attribution.** Per pass, per role, per model, per ticket, from
  `envelope.usage`. Cache-hit ratio as `cache_read_tokens / tokens_in`.
- **Escalation markers.** Red pins at `escalation.raised`, linked to the
  approval record in `<orgHome>/approvals/`. This is the highest-value
  element: it is precisely where a human is needed.
- **Live tail.** Watch today's `events.jsonl` files; a trace with
  `run.started` and no terminating event is in flight.

### Stage 3 — Make live mode trustworthy

Two additions, both small, both blocking a view an operator would rely on:

1. **Heartbeat.** Today a hung pass and an active pass are indistinguishable:
   both are `run.started` with no terminator. Emit a periodic
   `pass.heartbeat` (or stamp `last_seen_at` on the envelope) so the view can
   distinguish *running*, *stalled*, and *crashed*. This also serves the
   inactivity watchdog that `docs/bugs-to-be-fixed.md` requests for the
   interactive Planner.
2. **Terminal-status honesty.** Budget exhaustion currently surfaces as
   `failed(error_unknown)` with an `escalation.raised` reason that falsely
   reads `critical op (secrets-or-auth)`. A dashboard will render that lie
   prominently. Give budget aborts a distinct status code (tracked separately
   in `bugs-to-be-fixed.md`).

### Stage 4 — Show work happening (Gap D)

Emit `tool_use` and `subagent` events from the adapters. This is the single
change that moves the dashboard from a *status board* to something that shows
*agents working*: a live pass gets a streaming activity feed, `tool_counts`
populates, the two dormant anomaly detectors in `runlog/anomalies.ts` wake up,
and the Gantt bars acquire internal structure instead of being opaque
rectangles.

Sequence within the stage: Claude adapter first (richest native stream, and it
proves the bridge at `pipeline.ts:228` end to end), then pi, then Codex to
whatever depth the App Server permits.

### Stage 5 — Org-level rollups

Once Stage 1 makes the ledger complete, the "last 24 hours across all apps and
roles" view aggregates from `telemetry/*.jsonl` rather than walking every
envelope. Fold in `retro.ts` and `scorecards.ts`, which already implement this
aggregation and will start returning real numbers the moment B lands.

### Sequencing rationale

```
Stage 0  docs                     ── independent, do now
Stage 1  B → A → C                ── safety; unblocks budget/retro/scorecards
Stage 2  view over runs/          ── can start in parallel with Stage 1
Stage 3  heartbeat + status       ── makes live mode trustworthy
Stage 4  adapter tool_use         ── makes the view show work, not just status
Stage 5  org rollups              ── depends on Stage 1
```

Stages 1 and 2 are the two that matter. Stage 1 because an unenforced budget
cap on a loop that can spend $15 in a single pass is a real exposure. Stage 2
because the correlation data needed for a genuinely useful view is already on
disk, and has been the whole time — it was only ever written to a directory
nobody documented.

---

## 6. Open questions

- Should `TurnRecord` gain `run_id` and `trace_id`? It makes ledger rows
  joinable to run artifacts and is a prerequisite for idempotent settlement.
  It is an additive optional field, so back-compat with existing JSONL holds.
- Should the interactive planning mode record `usage: undefined` or an
  explicit `{ unmeasured: true }` marker? Silence and zero are both wrong; the
  question is which is less wrong for existing readers that sum `costUsd`.
- Does the dashboard read `runs/` directly forever, or does Stage 5 make the
  ledger sufficient for the summary views and leave `runs/` for drill-down?
  Reading both is likely correct, but the boundary should be deliberate.
- `runs/` grows without bound (356K for one day of one app). `operon
  prune-runs` exists; the dashboard's historical window and the prune horizon
  should be reconciled so the view never silently loses its own history.
- `operon loop` / dispatch invocations themselves leave no durable record —
  only the passes they spawn do. The 2026-07-10 review could not recover how
  many times the loop was invoked. Each invocation should append one ledger
  row (when, by whom/what trigger, which items claimed, terminal outcome) so
  orchestrator activity is reconstructable, not only agent activity.
