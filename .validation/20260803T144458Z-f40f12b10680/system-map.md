# System Map

Assessment: `20260803T144458Z-f40f12b10680`
Revision: `f6bb61123d2f7e3b74c6b0e93c27367fc3e93003`
Generated: `2026-08-03T14:44:58Z`

## Intended use

This assessment covers the local Cormidia org runtime as operated by repository maintainers on Node.js 26. It validates merge readiness for a bounded implementation slice, not production activation. Scheduler installation/start, paid providers, live/eval/soak campaigns, releases, and approval decisions are excluded.

## Architecture summary

Host cadence enters `dispatchTick`, which polls deterministic inputs, applies the scheduled-role eligibility preflight, normalizes a schedule slot, and uses a content-bound due-window claim before detaching a child. The claim must cross durable commit before settlement; a crash between the assembling journal and commit reclaims the same attempt. Scheduler evidence remains pending until a terminal journal receipt supplies provider/settlement counts—even when schedule/event bookkeeping fails after spawn—and only executed recovery resolves prior failure alerts. A provider pass refuses zero active-time before runtime construction, creates one hard-budget object, and routes synchronous tool admission through it ahead of the unchanged safety gate; native terminal cost caps are normalized into the same central stop evidence. Scheduled Planner grooming separately obtains a bounded unfiltered issue snapshot, validates model decisions, applies only routine `op:ready`, and reads GitHub back.

## Component inventory

| Component ID | Component | Responsibility | Interfaces | State | Privileges | Criticality | Evidence source |
|---|---|---|---|---|---|---|---|
| COMP-SCHED | Scheduler dispatch/evidence | Eligibility, due claims, spawn, terminal receipts, health | host clock, filesystem, GitHub polling, child process | schedule cursor, claims, journals, decisions, alerts | spawn and local state write | C3 | `src/org/dispatch.ts`, `src/org/scheduler/**` |
| COMP-BUDGET | Hard turn budget | Tool/cost/time admission and typed stop | provider hooks, safety gate, telemetry | run envelope and settlement | deny/abort provider continuation | C3 | `src/runtime/turn-budget.ts`, `src/loop/pipeline.ts` |
| COMP-PLAN | Planner intake/readiness | Unfiltered bounded issue intake and guarded readiness | GitHub CLI seam, Planner output | input manifest and GitHub labels | add/read `op:ready` | C2 | `src/org/planner-intake.ts`, `src/org/turn-runner.ts` |
| COMP-HOST | Scheduler environment | Resolve, render, and revalidate required tools | operator PATH, launchd/systemd definition | definition metadata and installation record | select executable path | C2 | `src/org/scheduler/environment.ts`, `definition.ts`, `lifecycle.ts` |
| COMP-VAL | Validation harness | Trace claims to deterministic regression evidence | Vitest, TypeScript, build/package scripts | committed catalog/tests and this audit | none beyond local reads/writes | C2 | `validation-design/**`, `claude-tests/**`, `.validation/**` |

## Trust and authorization boundaries

- GitHub issue bodies and Planner output are untrusted inputs; schema, membership, completeness, risk, and readback checks mediate the label mutation.
- Provider tool requests cross the unchanged safety gate only after local budget admission. Budget refusal uses `escalate:false` and never creates an approval item.
- Host scheduler definitions receive only explicit PATH and executable metadata, not the interactive environment or credentials.
- The reusable claim primitive is runtime-level and has no approval, schedule, or ticket authority; the due-window adapter supplies the domain identity.

## Data flows

1. Host tick → event/open-issue summaries → eligibility result → typed skip or due turn.
2. Due turn → `(org, app, role, trigger, window)` hash → claim → journal → commit → child → terminal receipt → settlement.
3. Route/reservation → effective hard bounds → provider progress/tool request → allow or typed terminal budget stop → envelope/telemetry settlement.
4. GitHub open issues → bounded/hash-bearing Planner manifest → model decision block → deterministic readiness guard → label write/readback.
5. Required executable resolution → definition metadata/PATH → status/doctor and dispatch drift validation.

## Runtime and operational boundary

The offline test environment uses fake clocks, controlled runtimes, fake GitHub seams, temporary state homes, crash points, concurrent ticks, and deterministic process-owner probes. No host scheduler was installed or started. The repository PR/CI boundary will provide an additional clean-run process control; it does not replace live launchd or real GitHub qualification.

## Failure containment

- Due-window identity, exclusive file locks, pre-commit journal recovery, and the enforced claim/commit/settle boundary contain duplicate scheduled work to one settlement and at most one explicit retry.
- Org WIP and role/app locks remain independent backpressure controls.
- Budget admission is per pass, refuses exhausted active time before provider construction, and fails closed if not initialized.
- Planner publication is limited to one additive label plus readback; general ambiguity is intentionally not claimed and remains #232.
- Environment drift fails before org loading/provider construction on scheduled dispatch.

## In-scope but unavailable

- Real launchd/systemd definition load and scheduled tick.
- Paid provider continuation behavior at chunked cost boundaries.
- Disposable real-GitHub Planner publication/lost-response campaign.
- Organizationally independent I3 review.

## Explicitly out of scope

Frozen approvals/safety paths; issues #205, #206, #199, #218, #20, and #181; #232 publication recovery; #233/#234 design hard stops; scheduler lifecycle execution; live/eval/soak; release publication.

## Open questions

None for the merge-scoped deterministic claim. External qualification remains explicitly pending rather than treated as an unresolved product-truth decision.
