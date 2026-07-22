# Platform status — agent-facing digest

Moved from root AGENTS.md (2026-07-21) so the root file stays a lean index.
On conflict, `docs/PURPOSE.md` → Decided wins and this file is stale — fix it.
README → Status and Known limitations are the product-facing view; README →
Observability is the authoritative state-home inventory.

## Build-complete and proven live

ClaudeRuntime/CodexRuntime/PiRuntime are live-conformance-tested; the GitHub
ticket state machine takes a real issue through Builder/Reviewer passes,
quality gates (a `setup` gate installs app deps in the fresh worktree first),
PR, cross-provider review, and squash-merge with unforgeable HMAC merge
authorization; company events route by payload kind to
Planner/SRE/Support/Marketing pipelines with channel-presence gating. Planning
is proportional (one-pass bootstrap plans, schema-validated and
orchestrator-published with canonical labels); tickets continue from durable
artifacts across interruptions; every provider turn settles once into the org
ledger where budget caps are enforced; the approval boundary supports
action-aware classification, scoped grants, role toolset shaping (forbidden
acts unrepresentable on Claude, flat-denied everywhere), durable denial
lessons, and a persisted decision/execution lifecycle. A later dispatch
executes the approved action from the durable record — typed content-bound
GitHub deliveries, the A4 release handoff, and the exact recorded shell
command in its recorded working directory — records acknowledgement,
reconciles stable idempotency markers, and never blindly retries ambiguity
(`src/org/approval-delivery.ts`, `src/org/release.ts`,
`src/org/approval-command.ts`). Approval is not a licence to run arbitrary
shell: execution is bound to the recorded action's identity and its single-use
grant, and an approval whose command no longer matches its grant runs nothing.

`operon-sandbox-delta` ("Ledgerette") is the from-scratch onboarding + loop
proof; buildstacks.dev is onboarded as a production app in
`status: onboarding`. Run `pnpm test` for the current offline suite. Known
limitations live in README.md → Known limitations; open work lives in the
GitHub issue tracker.

## Presentation and operation surfaces

`operon observe` is the read-only Live UI: a presentation-only `src/observe/`
leaf over durable state and bounded GitHub reads. It binds only to loopback
with a per-process capability, owns no workflow state, exposes no mutation
routes, and stopping it never affects a run. Its URL-stable session chooser
projects historical parent tasks and standalone traces through the same UI;
it adds no session store. `docs/live-ui/design.md` is its authoritative
contract.

`operon report` and Observe `/reports` are the deterministic ledger-first
reporting surface. The pure `src/report/` leaf owns UTC ranges, diagnostic
ledger/detail reads, presentation-session grouping, projections, portable
rendering, efficiency/invariant projections, and the lazy bounded report
service; it persists no index or session store. `docs/reporting/design.md` is
its authoritative contract.

`operon narrative` is the deterministic, token-free human-level causal
timeline: one captured markdown story per episode (prompt → plan → tickets →
build → merge, joined through the #128 `Planned-by` provenance) plus a
per-app `INDEX.md`, under state-home `narrative/` (1825-day retention).
Quotes are captured at render time through secret scrubbing and survive the
30-day `runs/` sweep; re-renders merge, never lose. `docs/narrative/design.md`
is its authoritative contract.

`operon scheduler` is the org-scoped autonomous-operation surface. Install and
uninstall preview by default, require exact confirmation to execute, and call
the ordinary stateless `operon dispatch` boundary through an absolute command.
`scheduler/evidence/**` keeps versioned invocation/decision/alert records;
`operon scheduler status` and doctor require definition, manager, tick, and
settlement evidence rather than treating file presence as health.
`docs/scheduler.md` is the authoritative schema, identity, reason-code, and
health contract.

## Where agent activity is recorded

State home is `~/.operon/<org>/`; README.md → Observability is the
authoritative inventory. Digest: `runs/<app>/<runId>/` is the per-pass source
of truth (`envelope.json`, `events.jsonl`, verbatim `brief.md`/`prompt.md`/
`output.md`, and activity-only `session.log`); `telemetry/<date>.jsonl` is the
org ledger every provider turn settles into exactly once, keyed on
`(app, providerTurnId)` with `(app, runId)` fallback for legacy rows (`operon
budget --reconcile` back-fills), with a derived keys-only sidecar in the
sibling `telemetry-index/settled.keys` (deliberately outside `telemetry/` so
bare ledger-directory enumerators never parse or double-count it) that keeps
the exactly-once check off the full ledger rescan (F-002, ledger-first so it
can only lag, never lead — rebuilt from the ledger when absent);
`efficiency/episodes/<hash>/` holds the episode route, route-bounded execution
journal, terminal provider/mechanical execution steps, and component-hashed
context manifest/delta projections; `invocations/<date>.jsonl` records one
terminal row per dispatched CLI command (with distinct internal
release-execution rows); `state/invocation-journal/` holds pre-command intent
and idempotent append recovery; `tasks/<taskId>/` holds the broader
delegated-task record plus exact outer prompt (child envelopes and ledger rows
carry `parent_task_id`); `learning/` holds the capture projection (`events/`),
rebuildable episode records (`episodes/`), ReplayCapsules + SystemFingerprints
(`capsules/`, `fingerprints/`), per-turn pinned resolve records with
`bundle_lineage` (`resolved/`), episode-sticky canary assignments
(`canary/assignments/`), and the publisher's crash-resumable journal
(`publish-journal/`); `runs/learning-replay/` is the reserved replay namespace
(reconciled for spend, excluded from capture).
`planning/<app>/refused-decompositions/` preserves a decomposition refused for
the stage ticket budget alone so `operon plan ratify-ticket-budget` can admit
it without a replan, and `lifecycle/apps/<app>/` holds the never-swept human
decisions (lifecycle record, config-ratification journal, ticket-budget
ratifications); `scheduler/installation.json` and
`scheduler/evidence/{invocations,decisions,alerts}/` hold scheduler ownership,
exact-once ticks, route decisions, and local alerts;
`standing-roles/<app>/{artifacts,planner-feeds}/` holds source-bound
draft-only SRE/Support/Marketing results and deterministic Planner feeds;
critical/down SRE events also queue a source-linked `op:incident` action
through the durable approval-delivery boundary. Every state subtree has a
retention window, swept fail-safe once per UTC day from the dispatch tick
(`src/org/retention.ts`; docs/scheduler.md → State retention; manual form
`operon prune-runs --sweep`) — the ledger sweep never deletes rows still
re-settleable by `budget --reconcile`, and `learning/` is swept only under
`events/<date>/`.

## Learning loop

The M3–M5 experiment + activation substrate lives in the **committed org
home** `learning/**`: experiments (declared-before-results), interventions
(lineage), evals (trusted only after independent validation), candidates
(agent-emitted, never resolvable — deliberately NOT gate-protected), reviews
+ `rejections.jsonl` (fail-closed verdicts + suppression), quarantine
(human provisionals, resolver-enforced TTL), `bundle/**` + `manifest.yaml`
(active concepts, version cuts, canary trial state), and `proposals/**`
(unmerged drafts). M4+M5 are live: context assembly resolves governed
concepts once per turn (pinned) and per (ticket episode, pipeline role) in
the build loop; a T3 live canary is structurally forbidden by the policy
loader; `operon learn` is the manual surface — activation verbs
(`review|publish|resolve|disable|rollback|provisional`), the offline §9.5
funnel (`experiment declare|run|list`, learning-budget-capped, rendered by
`operon budget`), and the live-trial lifecycle
(`canary start|status|promote|stop`). M6 is live: daily
deterministic-prechecked distillation, weekly cross-provider review, policy
frequency/volume caps, and report-only compaction run through the ordinary
dispatch/pipeline/ledger path. Phase 4 closes that loop in production:
`efficiency-evidence/v1` projects orchestrator-owned run, route, journal,
execution-step, approval-analyzer, and scheduler-miss records into stable
trusted learning events; deterministic app/role-scoped recurrence and durable
dispositions feed the existing governed
candidate/review/experiment/publisher/canary chain; efficacy declarations pin
fingerprints, hidden-guardrail commitments, pairing, budgets, missingness,
and side-effect replacement before results; and `operon learn report
--efficiency-health [--json] [--refresh]` reports capture, governance, and
efficacy health independently. The mechanics construct no provider runtime.

### The 2026-07-19 evidence-projection fix (#137–#142)

That closed loop was **built but not actually live** until 2026-07-19: capture
overwrote the run envelope's efficiency-namespace `episode_id` with the
learning anchor before handing the run to the projector, so the provider-step
filter matched nothing, every provider run classified as mechanical, and zero
efficiency evidence reached `learning/events/` in any org (#137). A failed
pass additionally produced no learning event of any kind (#138), and
`--efficiency-health` reported `capture.status: "healthy"` throughout, because
it counted runs projected rather than evidence produced (#141). The two
episode id namespaces are now threaded separately at the seam, a terminal
`failed` envelope is evidence on its own `error_code`, and health degrades on
a run that demonstrably failed while yielding nothing.
`test/learning/evidence-projection.test.ts` drives capture →
`prepareDistillation` end-to-end and fails the build if a cluster stops
forming — the coverage gap that let this ship green (#142).
