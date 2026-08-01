# System map — Operon (product scope)

Status: synthesized from the ratified docs and the stakeholder's Phase 1 walk; CONFIRMED
at the Phase 1 gate (2026-07-31, round 4) alongside the criticality tier; human-ratified
2026-07-31 (ratification-package.md §9). <!-- AUD-105 --> This working map does not
replace `docs/architecture.md`; it makes the derivation surface for invariants, boundaries,
and contracts explicit.

Provenance: rows are `[doc]` unless marked `[walk]` (stakeholder's Phase 1 elicitation,
see elicitation-log.md), `[rambling]`, `[simulated]`, or `[PROPOSED]`.

## 0. Intended use, deployment shape, criticality

- **Intended use:** installable org runtime — a standing team of AI agents that plans,
  builds, reviews, and operates software products through private GitHub repos, spending
  real provider tokens, with one human gating critical operations. `[doc]`
- **Deployment shape:** solo-operator, laptop-first; OS-timer-driven (launchd; systemd
  later) **when installed**; one org runtime over N registered apps; org home in git,
  high-churn state under `~/.operon/<org>/`. Autonomous scheduling is an evidence claim,
  not a default state (F-PT-002 — resolved 2026-07-31: on the active org the scheduler
  is NOT installed; all turns are human-invoked; see §4).
  `[doc]` + stakeholder correction.
- **The organizing product truth** `[walk]`: *"a pile of promises about what happens after
  I stop watching."* The system's dominant risk mode is not crash but **silent wrongness**
  — plausible green summaries over the wrong reality.
- **Criticality tier:** see §5 — synthesized from the stakeholder's consequence
  elicitation (no tier was proposed before that elicitation); confirmed at the Phase 1
  gate (2026-07-31, round 4). <!-- audit iteration 2: last stale "pending" clause,
  same class as AUD-105 -->

## 1. Behavioral view

### 1.1 Actors and initiating systems

| Actor / initiator | Enters via |
|---|---|
| Human operator | CLI commands (incl. approvals decisions); GitHub (manual labels, reviews); file-drop event inbox |
| OS timer (launchd/systemd) | `operon dispatch` tick (~5 min) |
| GitHub (as event source) | polled events: `ticket-ready`, `pr-opened`, `ci-failed`, `release-shipped` |
| Company-event producers | `state/events/inbox/*.json` (closed kind registry; typed file-drop events incl. `health-alert`, `support-feedback`, `adoption-signal`, `launch-calendar`) |
| Operon's own roles (Planner, loop re-arm) | published tickets, label flips — internal initiators of later work |
| Recovery | journals/locks/plan journal read at tick start; reconciliation stimuli |

### 1.2 Stimulus taxonomy

Per the skill: **user events** and **time events** are the matrix rows; **adversity**
(crash, kill, partition, sleep, auth loss) is a modifier applied at every flow step via the
Phase 3 failure-mode checklist — never a row.

**User events** (each CLI operation is an entry adapter over core behavior; `--json`/
`--dry-run` are format/effect modifiers of the same operation, with the audit row as the
sole write exception `[doc]`):

- Org lifecycle: `org init | upgrade | use`
- App lifecycle: `new-app`, `bootstrap [publish]`, `app verify | promote | reset`
- Planning: `plan --auto --goal`, `plan --creator-scope --execution-ready`, sources
- Delivery: `loop --once`, `loop rearm`, `run-role`, `dispatch` (manual form)
- Approvals: `approvals`, decide, `plan ratify-ticket-budget`
- Scheduler: `scheduler install | status | uninstall`
- Observation: `status`, `budget [--reconcile]`, `report`, `telemetry`, `observe`,
  `analyze`, `episode explain`, `narrative`, `capabilities`, `context`, `doctor`, `roles`,
  `apps`, `pipelines`, `learn <verbs>`, `task begin|fallback|finish`
- GitHub-side human acts: label edits, manual reviews, merges outside Operon (observed,
  never assumed)

**Time events:**

- Dispatch tick (~5 min): due arithmetic, event polling, budget recompute, spawn decisions
- Daily UTC retention sweep (from the tick)
- Daily Distiller; weekly Learning Reviewer; weekly retro
- Grant TTL expiry (24 h default); provisional/quarantine TTLs
- Monthly budget window rollover
- Missed-window reconciliation after sleep: one firing per role, not N `[doc]` `[walk]`

### 1.3 Journeys and required observable outcomes

"Done" = the named durable evidence exists — never prose claiming it does `[walk]`.

| ID | Journey | Observable outcome ("done" means) |
|---|---|---|
| J-01 | Org create/upgrade/use | Complete org home + state home + active pointer; atomic staging, exact rollback, collisions block pre-mutation; legacy org never silently inherits newer authority |
| J-02 | App onboarding (new-app/bootstrap → verify → promote) | Evidence-ladder rung claims each backed by own evidence: generated ≠ registered ≠ runtime-ready ≠ live ≠ autonomously-scheduled `[doc][walk]`; no surface claims a higher rung than proven |
| J-03 | Product planning (goal or creator scope → EpisodePlan → TicketPlan → published tickets) | Schema-valid persisted EpisodePlan before any delivery turn; TicketPlan schema-valid; published tickets carry `Planned-by` lineage + dependencies + acceptance criteria; only dependency-free tickets `op:ready`; creator-scope bypass only for complete provenance-bearing scope; "fluent prose, no durable plan" = did nothing `[walk]` |
| J-04 | Delivery loop (op:ready → claim → build → gates → PR → review → repair → merge) | Labels flip only after artifacts exist; structured reviewer verdict becomes authorized GitHub review bound to exact HEAD; orchestrator-only squash-merge with green gates + fresh review; branch deleted, issue closed; bounded remediation/review cycles then `returned` |
| J-05 | Critical-op approval (gate block → queue → human decision → typed execution → acknowledgement) | Turn ends `blocked_on_gate` honestly; decision persists exact content; execution separately recorded `executing → executed\|failed\|ambiguous`; crashed acknowledgement reconciles via idempotency marker or stops ambiguous — never re-performs the effect `[walk]` |
| J-06 | Approval-wait resume | Same native session/pass/role/assignment/context fingerprint/worktree/completed-pass set/run resumed; denial guidance honored; any mismatch fails closed before spend; claim number stable across pauses |
| J-07 | Budget enforcement | Per-turn cap = immediate stop. **Documented completed path:** monthly cap recomputed from ledger per tick → effective pause + a `budget-exceeded` item in the single queue; 80% warning to Planner. **Crash seam deliberately excluded:** what recovery converges to if the tick dies between overlay write and item creation is unratified — that question lives *only* in F-PT-003 and is not encoded here |
| J-08 | Provider-turn settlement | Exactly one ledger row per provider turn incl. failed/blocked/cancelled turns; unknown usage ≠ zero; mechanical steps never settle as provider turns; `budget --reconcile` idempotently repairs/back-fills |
| J-09 | Dispatch tick | Fresh process; durable spawn decision committed before detach; locks/WIP respected; live heartbeat → leave running turn alone; every considered (app, role, trigger, window) terminates in a named durable reason — nothing "vanishes" `[walk]`; no model constructed when nothing is due |
| J-10 | Company-event intake | Each valid event consumed exactly once **per current subscriber** (possibly across ticks); retired only after all current subscribers consumed; malformed/unknown kinds stay for repair, loudly; `no_subscriber` = pending non-error; channel-gated subscriber keeps event observably pending `[doc][walk]` |
| J-11 | Audience-facing role work (Support/Marketing/SRE) | Ends in grounded internal artifacts/drafts; external publication is a separate exact-payload gated action; SRE analysis-complete vs incident-filed are distinct claims (`op:incident` exactly once, source-linked) |
| J-12 | Learning pipeline | Capture/distill/review/publish/authorize/validate are distinct claims, none substitutable `[walk]`; candidates never resolve; the deterministic publisher is the sole **automated/component** writer of protected surfaces (humans may also write them); T3 never live-canaries; self-reports never drive promotion |
| J-13 | Crash recovery (any journey × adversity) | Authority order `intent → plan version → derived route → ready step → terminal evidence`; pre-provider claim crash auto-repairs without consuming allowance; post-provider ambiguity requires explicit `loop rearm`; failed ledger append preserves execution step for later settlement; scratch-vs-protected worktree bytes: F-PT-004 |
| J-14 | App reset | Archive-first (checksummed, outside state home); refuses fresh runs/locks/journals/pending approvals; touches only named app's managed state + identifiable `op:*` GitHub work; never repo/default branch/human checkout/closed history; `--force` crosses only stale (>10 min) heartbeats; sibling apps untouched — sibling damage = top-severity failure `[walk]`; killed execution resumable |
| J-15 | Observation (observe/report/telemetry/narrative) | Read-only: no run affected by observer lifecycle; no reconciliation side effects from report generation; no invented parent relationships; raw L3 only by deliberate local fetch — never in snapshots/SSE/portable exports; narrative scrubs at capture time `[walk]` |
| J-16 | Scheduler lifecycle | Install/uninstall preview-then-execute with identity confirm; status = joined evidence (ownership/hash/cadence/ticks/duplicates/settlement agreement) — a definition file alone is never "healthy" |
| J-17 | Release handoff (A4) | Declared `release:` mechanism; deploy is a fresh content-bound critical op post-merge; handoff executed exactly once by later dispatch; (release *gating* itself: suspended — see policy obligation) |
| J-18 | **Unattended scheduled delivery (composite; highest-hurt)** | OS due window → one durable dispatch decision → valid EpisodePlan → bounded provider turns → gate-classified actions → correct GitHub artifacts (right repo, right base branch) → exact review/merge boundary → exactly-once settlement → **truthful morning status**. Failure mode that matters: seven mornings of plausible green over wrong reality `[walk]` |

### 1.4 Entry and observation surfaces (adapters, not behaviors)

| Surface | Kind | Adapter obligations (validated thinly, once each) |
|---|---|---|
| CLI (per subcommand) | entry + observation | parsing; `--json` contract (`ok:false`, stable `error.code/message/remediation`, one stdout doc); exit codes; dry-run token-free/write-free claims (audit row sole exception) |
| `--json` machine surfaces | observation | schema stability; canonical key-sorting where claimed |
| Live UI (HTTP snapshot + SSE) | observation | loopback bind; capability token; no mutation routes; versioned snapshot; cursor SSE; L3 confinement |
| Portable HTML report | observation | self-contained; hash-restricted CSP; no external requests; no L3 |
| GitHub | entry + observation + substrate | conventions (labels/branches/trailers); polling boundedness; artifact-before-label |
| File-drop event inbox | entry | closed kind registry; schema validation; retention semantics |
| OS timer | stimulus source | fires the same `operon dispatch` the human can run — one behavior, two initiators |
| Agent Skill (`$operon`) + `capabilities --json` | entry (for coding agents) | discovery accuracy |

## 2. Structural view

### 2.1 Components and deployment units

One process family, no daemon: CLI invocations, detached turn processes spawned by ticks,
and the foreground observer. Module inventory M1–M15 per `scope-and-module-map.md` §2.
Import direction `org → loop → runtime`; observe/report/narrative are read-only leaves.

### 2.2 Durable state: owner and authorized write paths per fact

Column semantics: the **state owner** is the component that owns the fact's integrity;
**authorized write paths** are the concrete commands/paths allowed to mutate it.
**Authority** (human ratification) is never itself a writer — where it applies, it is
named explicitly and the component writes under it.

| Durable fact | Location | State owner · authorized write paths |
|---|---|---|
| Accepted EpisodePlan + versions + DAG journal | `efficiency/episodes/<hash>/` | episode-planner/loop (plan validation path) |
| Ticket claim / allowance / re-arm | `tickets/<app>/<issue>.json` | loop (atomic claim transactions) |
| Product artifacts (issues, PRs, reviews, merges, labels, branches) | GitHub | GitHub, via gate-classified actions; orchestrator-only merge |
| Run evidence L1–L3 | `runs/<app>/<runId>/` | runtime runlog (per pass) |
| Cost ledger | `telemetry/<date>.jsonl` | settlement (exactly once per provider turn) |
| Budget overlay | `state/budget-overlay.json` | dispatcher (recomputed per tick) |
| Registry entries + status (`live\|paused\|onboarding`) | `apps.yaml` (org home) | **State owner:** app registry (`src/org/apps.ts`). **Authority:** human ratification (registry is a human-ratified surface). **Authorized write paths:** `bootstrap` and `new-app` register via the same registration path; `app promote --execute` mutates status only after verification; `app reset --execute` removes the entry. `app verify` never writes the registry (it writes the lifecycle record, next row). Agents: never |
| App lifecycle record (verify/promote evidence) | crash-resumable lifecycle journal (state home) | **State owner:** lifecycle verification. **Authorized write paths:** `app verify` records config hash/commit and verification evidence without mutating the registry; `app promote --execute` resumes exactly once across config, commit, push, and registry boundaries |
| Approval items/decisions/grants/execution state | `approvals/` | approvals store (CLI decide path; orchestrator execution records) |
| Turn journals | `state/turns/` | the owning turn process (sync rewrite per phase) |
| Locks | `locks/` | owning turn (heartbeat) |
| Schedule last-fired + consumed events | `state/schedule.json`, `state/events/` | dispatcher |
| Scheduler installation + evidence | `scheduler/` | scheduler lifecycle commands / tick evidence writer |
| Triggered-validation campaign + soak checkpoints | `validation/campaigns/<id>/report.json`, `validation/soaks/<id>/state.json` | authorized L3/L4/L5 runners write versioned campaign/checkpoint evidence; status/Report/Observe are read-only consumers; completeness and verdict remain separate |
| Managed clones + worktrees | `repos/`, `worktrees/` | loop worktree management (never human checkouts) |
| Invocation audit + journal | `invocations/`, `state/invocation-journal/` | CLI entry layer (idempotent terminal append) |
| Self-approval HMAC key | `state/self-approval-secret` | orchestrator only (owner-only perms; fail closed) |
| Learning state-home stores | `learning/**` (state home) | capture/projection/publisher per store |
| Learning committed substrate | org-home `learning/**` | **deterministic publisher + humans only**; agents: candidates/proposals only |
| Org/app config + authority surfaces (`TASTE.md`, `AUTHORITY.md`, `roles.yaml`, `pipelines.yaml`, `prompts/**`, `.operon/*`) | org home, `.operon/` | **Authority:** human ratification only. **Authorized write paths, per artifact:** `org init`/`org upgrade` emit generated org-home artifacts from packaged templates (never replacing existing ratified surfaces); `bootstrap` emits app-owned `.operon/` artifacts plus the marked root `AGENTS.md`/`CLAUDE.md` pointer. Registry writes: registry row above. Verification evidence: lifecycle-record row above. Agents: proposal-only, on every surface |
| Active org pointer | `~/.operon/config` | `org init`/`org use` |
| Reset archives | `~/.operon/archives/` | app reset execution |

### 2.3 Deliberately multi-source facts (authority order, not a single field) `[walk]`

- **"Where is this ticket now":** plan+journal (authorized/ready) · claim file
  (claimed/allowance) · GitHub artifacts (what exists) · run envelopes (what passes did) ·
  ledger (what it cost). Recovery's authority order joins them; partial failure here can
  manufacture contradictory stories — the map keeps these visibly separate.
- **"Is this app pausable/paused":** human registry status + dispatcher budget overlay —
  separate writers, kept separate; what must be **unique** is the claim-admission
  computation that joins them.
- **`op:ready` producers:** Planner publisher · human · loop dependency re-arm — three
  authorized producers with different justifications; unauthorized/premature readiness
  must be impossible merely because a label exists.

### 2.4 External dependencies (real-world seams)

GitHub API · Anthropic (Claude Agent SDK) · OpenAI (Codex App Server via pinned CLI,
JSON-RPC/stdio) · pi SDK · OS timer/launchd/systemd · filesystem+git (local) · OS process
model (detach, kill, sleep) · network. Provider auth lifecycles (token refresh races have
killed campaigns `[rambling]`).

### 2.5 Consistency and failure domains

- Write discipline is per-store, three shapes: **append-only/keyed** where appropriate
  (ledger, invocations, events.jsonl, scorecards); **atomic whole-file replacement**
  (envelopes, schedule state, locks, pointers, configuration projections); **journals for
  multi-step transactions** (turn journals, invocation journal, plan-DAG journal,
  lifecycle/publish journals). Artifact-before-label is the GitHub ordering rule.
- Failure domains that fail **independently**: each detached turn; the tick process; the
  observer; GitHub availability; each provider; the laptop itself (sleep = global pause
  with no recovery daemon — the next tick reconciles).
- Version skew: package upgrade between ticks; org-home schema vs package (`schema_version`
  from day one); plan versions are forward-only; legacy ledger rows keyed differently
  (`(app, runId)`) remain readable.
- Clock: local wall clock only; UTC day/month windows for ledger, sweep, budget; sleep
  produces missed-window reconciliation, not catch-up storms.

## 3. Reconciliation view

| Journey | Components crossed (state owners touched) | Irreversible effects | Unknowns |
|---|---|---|---|
| J-01 | M10 (org home, state home, pointer) | none (archive-backed, rollback) | — |
| J-02 | M10, M4 (labels), GitHub | draft PRs (**externally durable, closable — not reversible**: closing does not erase the remote write, content, or history) | — (F-PT-002 resolved 2026-07-31) |
| J-03 | M5, M3 (planner turn settles), M4 publisher, GitHub | published issues (closable, not unpublishable); tokens spent | — |
| J-04 | M4, M9, M7, M1, M3, GitHub | **squash-merge to default branch; branch deletion; tokens** | — |
| J-05 | M1, M2, GitHub (typed executor) | the executed op itself (may be deploy/publication) | — |
| J-06 | M2, M9, M7 (session resume) | tokens on resume | — |
| J-07 | M6, M3, M2 | none | — (F-PT-003 ratified 2026-07-31: pause holds; exactly one budget-exceeded item eventually) |
| J-08 | M3, M7 | none (ledger append-only) | — |
| J-09 | M6, M9 (spawn), all downstream | none directly | — |
| J-10 | M6, roles | none | — |
| J-11 | roles, M1/M2 (publication gate), GitHub | external publication (irreversible, hard-gated) | — |
| J-12 | M13, org-home git | committed bundle changes (git-revertable; context influence not) | — |
| J-13 | M9, M4, M3, M2 | none if correct; **work loss if wrong** | — (F-PT-004 ratified 2026-07-31: preserve-and-inspect, never reset) |
| J-14 | M10, GitHub, state home | closes issues/PRs, deletes `op/*` head branches (archive mitigates local, not GitHub closes) | — |
| J-15 | M14 | none (read-only claims) | — |
| J-16 | M6 (host scheduler def) | none (host file owned/versioned) | — |
| J-17 | M2, M1, app's deploy mechanism | **production deploy** | — |
| J-18 | composite of J-09,03,04,05,07,08,15 | all of the above, unattended | — (formerly inherited F-PT-003/004; both ratified 2026-07-31) |

**Cross-cutting overlays** (touch nearly every journey): secret boundary (M8) at every
provider prompt, log, export, capture; authority/context assembly (M11/M12) at every turn
construction; default-branch/ancestry resolution `[walk: "the scar I keep touching"]` at
every branch/diff/ancestry/reset/release-bytes operation; settlement (M3) at every
provider turn; the gate (M1) at every tool action.

## 4. Open findings (product truth / architecture) — as raised through Phase 1 only; the authoritative full list (18 findings, including resolved records) is `validation-policy.yaml` → `open_findings` <!-- AUD-108 -->

| ID | Kind | Statement | Status |
|---|---|---|---|
| F-PT-001 | product truth | Redaction scope: rambling's "everything redacts" vs docs' verbatim L3 (`brief.md`, `prompt.md`, `output.md`, `session.log`); shared secret-pattern list governs scanning/scrubbing/bounded previews/exports/capture-time redaction | Resolved-by-docs; recorded |
| F-PT-002 | product truth | Actual active-org registry + scheduler state unknown from corpus; packaged `apps.yaml` is a template | **Resolved 2026-07-31** (ratification): active org selector `~/.operon/config` → org_home=/Users/bikram/Build/sonnet1-org, state_home=~/.operon/Buildstacks; one registered app sonnet8-buildstack-dev (live); scheduler NOT installed — all turns human-invoked; two residual partial state homes (~/.operon/operon, ~/.operon/questionnaire) are not active orgs. Facts in ratification-package.md §9 |
| F-PT-003 | product truth | No ratified crash transaction joining budget-overlay write and `budget-exceeded` approval-item creation; expected outcome (app cannot claim spend; human converges to exactly one item, not zero, not five) is owner expectation, not documented contract | **Resolved-ratified 2026-07-31**: pause holds; exactly one budget-exceeded item eventually — contract truth; cases unparked (HB-P1) |
| F-PT-004 | product truth | Boundary between restart-clean disposable scratch and protected uncommitted builder work in managed worktrees is unratified; owner's proposed judgment: preserve-and-inspect ambiguous bytes `[simulated]` | **Resolved-ratified 2026-07-31**: preserve-and-inspect, never reset — contract truth; cases unparked (HB-P2) |

<!-- ratification 2026-07-31: F-PT-002/003/004 statuses updated; the authoritative
full list remains validation-policy.yaml → open_findings. -->

## 5. Criticality tier

Synthesized from the stakeholder's consequence elicitation (elicitation-log.md, Phase 1
tier ramble). Structure `[PROPOSED]` (origin provenance); every consequence judgment
beneath it `[walk]`. Confirmed at the Phase 1 gate (2026-07-31, round 4). <!-- AUD-105 round 2 -->

### 5.1 Product base tier: **C2 (production)**

Evidence: real money spent unattended; real GitHub write authority; durable state other
runs depend on; credentials whose blast radius "may not be solo-sized"; gated paths to
deployment and publication. Calibration held *below* C3 overall because there is one
operator, bounded budgets, private repos, and no customer population behind every turn —
"most failures affect my money, my repos, my time, and my trust" `[walk]`
`[rambling: "high-consequence — but ... not a bank. Calibrate there."]`.

### 5.2 C3 overrides — the concentrated control points

Overrides are **function-scoped, not module-scoped**: "consequence follows the claim, not
the file"; "the ten-line decision that admits a merge or widens authority gets more proof
than the thousand-line page rendering its result" `[walk]`. The heavy assurance burden
falls on:

| # | Control point (C3) | Why (stakeholder's consequence logic) |
|---|---|---|
| T-1 | Gate classification, **false-negative direction** (M1) | Obfuscated real critical effect classified routine = authority damage; false positives are availability damage only |
| T-2 | Approval-boundary integrity (M2): content binding, approve ≠ execute, exact-payload/command grants, self-approval unrepresentable, ambiguity-never-retried | "Supposed to contain every other consequence"; if it lies, "human-gated" is marketing copy |
| T-3 | Authority & protocol-surface protection (M11, + context authority precedence and per-app memory isolation slices of M12) | Wrong authority changes what the agent believes it may do; protocol change disguised as anything is an authority bypass |
| T-4 | Secret containment (M8, incl. narrative capture-time scrubbing, exports) | Not undoable by deleting a file; credential blast radius exceeds the solo scope |
| T-5 | Settlement & budget enforcement (M3 + dispatcher pause slice of M6), **under-accounting direction**: unknown ≠ zero, cap bypass, double/missed settlement | Undercount disables the next safety decision while surfaces show headroom; equivalent-cost is the loop detector |
| T-6 | App isolation (M9 + M12 slice): one turn/one app; no state, context, approval-scope, or worktree bleed | Boundary failure is worse than a bad change inside the right app; the central isolation promise |
| T-7 | Merge authorization & base/branch truth (M4 slice): HMAC review binding to exact HEAD, orchestrator-only merge, remote-default-branch/ancestry resolution | Crosses the authorized product boundary; the default-branch scar; machinery must not convert malformed/stale evidence into approval |
| T-8 | Destructive lifecycle containment (M10 slice): reset scope, archive-first, sibling-app/human-checkout/history protection, confirm/force semantics | Sibling damage = containment failure at the highest level, regardless of target-app outcome |
| T-9 | Evidence truthfulness (cross-cutting slice of M14/M6/M3/M15): absence ≠ zero/empty, definition file ≠ health, approval ≠ execution, claim/acknowledgement separation, dry-run and `--json` honesty, "needs attention" semantics | The false-green amplifier: a read-only lie changes the human's decision and delays discovery of every other defect |
| T-10 | Learning activation boundary (M13 slice): resolver/publisher, tamper gate, authorized ≠ validated, candidates never resolve | Poisoned active concept steers many turns; silent authorized→validated upgrade is evidence fraud |
| T-11 | Adapter enforcement slices (M7): gate hook sees every real tool path, budget observation timing, session resume binds the exact session | Where provider-neutral guarantees meet three different products; interface-shape conformance is not conformance |
| T-12 | **Irreversible-effect execution boundary** (M2 typed-executor slice, A4 release executor, external-publication path): single exact-grant consumption; at-most-once execution with idempotency-marker reconciliation (exactly-once where the marker proves the effect); ambiguity is a terminal recorded state, never a blind retry; acknowledgement records are truthful and distinct from the decision | T-2 protects the *decision*; this protects the *performance* of approved irreversible effects — deploys and publications leave the machine and cannot be recalled, so a duplicate or unacknowledged execution is the same class of harm as an ungated one |

**Recovery is a tier multiplier, not a tier holder:** recovery correctness inherits the
tier of the journey it recovers (crash-repeat of an external effect is T-12;
double-settlement is T-5; T-2 applies only when the decision or grant itself was also
compromised; silent reset of ambiguous bytes is T-6/F-PT-004). Adversity stimuli (sleep,
auth expiry, GitHub failure, process death) are *normal* inputs at this tier, not chaos
engineering `[walk]`.

### 5.3 C2 standard (everything not listed above)

Ordinary loop/pass mechanics, planner-output quality machinery (deterministic validator
slices are T-2/T-5-adjacent where they admit work), dispatcher due arithmetic, event
routing (multi-subscriber correctness leans T-9 for its truth claims), onboarding
evidence-ladder mechanics, report/ledger aggregation correctness (silent dedup/hidden
unsettled rows → T-9), adapter compatibility behavior, CLI parsing/formatting.

### 5.4 C1 leaves

Presentation cosmetics (layout, charts, sort order), help text, narrative markdown
rendering, draft prose quality (quality itself goes to layer-4 evals), cache economics
(cost-of-miss, not correctness).

### 5.5 The compound worst case (drives Phase 6 weighting)

"An unattended turn acts under the wrong authority, exposes a secret or performs an
external effect, then the evidence layer reports green" `[walk]` — T-3 × T-4/T-2/T-12 ×
T-9 composed. Real harm plus delayed discovery; everything else is easier to recover from
"because at least I know it happened."
