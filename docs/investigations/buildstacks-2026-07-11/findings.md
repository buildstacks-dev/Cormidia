# Validated findings

Statuses use `confirmed`, `partially confirmed`, `expected`, or `open`. No
suspected subsystem is named until persisted evidence plus implementation
inspection supports it.

## BS-001 — `plan --auto` ignores `--dry-run`

- Classification: defect
- Severity and impact: critical; a command represented as token-free can start billable, state-changing planning and publication.
- Observed: the July 11 dry-run trace consumed model tokens and launched downstream passes.
- Expected: dry-run validates and previews only, with zero provider calls, run envelopes, budget use, or GitHub writes.
- Reproduction: `operon plan <app> --auto --goal <goal> --dry-run`.
- Evidence: original Codex task; `operon-bugs.md` #5; trace `plan-buildstacks.dev-1783798200442`; `src/cli/plan.ts` parses `dryRun` but omits it from `runAutoPlan` options.
- Suspected subsystem: confirmed in `src/cli/plan.ts` auto-mode dispatch.
- Acceptance test: inject a runtime/GitHub fake that throws on construction; auto dry-run exits 0, prints routing/passes, and writes no state.
- Fix status: confirmed; not yet implemented; commit/PR: pending.

## BS-002 — `plan --auto --workdir` ignores the supplied checkout

- Classification: defect
- Severity and impact: critical; planning is grounded in stale or wrong source truth.
- Observed: both briefs say `fresh clone of origin/main`, HEAD `68276c2`, rather than the supplied `build/buildstacks-v1` checkout.
- Expected: use the exact supplied checkout/HEAD without mutating it, or reject the flag combination before starting a model.
- Reproduction: run auto-plan with a supplied branch whose HEAD differs from remote main.
- Evidence: all planning briefs; managed-clone and operator-checkout HEADs; `src/cli/plan.ts` drops `workdir`; `src/org/plan-auto.ts` unconditionally calls `ensureManagedClone`.
- Suspected subsystem: confirmed in auto-plan CLI/options and workdir resolution.
- Acceptance test: seed divergent refs, run with a supplied checkout, assert runtime cwd/brief/envelope HEAD match it and branch/HEAD remain unchanged.
- Fix status: confirmed; pending.

## BS-003 — `loop --repo-dir` destructively normalizes an operator checkout

- Classification: defect
- Severity and impact: critical; silent branch/HEAD changes can overwrite or hide operator work.
- Observed: the supplied checkout was changed from `build/buildstacks-v1` to `main`; the outer task had to restore it.
- Expected: operator-owned checkouts are immutable inputs; Operon either preserves them or creates an isolated managed worktree.
- Reproduction: invoke `operon loop --repo-dir <non-main-checkout>`.
- Evidence: original task commentary; checkout reflog/state; `src/cli/loop.ts` passes `repoDir` to `defaultLoopInputs`; `src/loop/driver.ts::ensureClone` runs `fetch`, `checkout main`, and `reset --hard origin/main` on any supplied Git repo.
- Suspected subsystem: confirmed in loop driver clone preparation.
- Acceptance test: snapshot branch, HEAD, index, and working tree before a loop dry/live setup; all remain byte-for-byte unchanged.
- Fix status: confirmed; pending.

## BS-004 — Parent termination does not cancel provider descendants

- Classification: defect
- Severity and impact: critical; unobserved agents continue spending and mutating repos after the operator stops the command.
- Observed: Planner children advanced after callers returned; the Builder contract completed and implement pass wrote 31 files after the loop parent was terminated.
- Expected: one owned cancellation tree reaches pipeline, runtime, provider session, and child process group, then waits for shutdown.
- Reproduction: start a fake long-running runtime with a child process, send SIGTERM to the CLI, and inspect descendants plus envelope.
- Evidence: thread items 12, 18, and 19; post-stop timestamps; implement `session.log`; current `Runtime` contract has no `AbortSignal`; Codex spawns a child without process-group ownership; pipeline watchdog abandons the losing promise.
- Suspected subsystem: confirmed across CLI signal handling, `src/loop/pipeline.ts`, runtime contract, and adapters.
- Acceptance test: SIGTERM kills parent and nested child, no subsequent pass starts, and terminal cancellation is durable.
- Fix status: confirmed; pending.

## BS-005 — Interrupted passes never finalize

- Classification: defect
- Severity and impact: high; dashboards, capture, retention, and operator decisions see permanent false liveness.
- Observed: four July 11 envelopes still say `running`, hours after their last heartbeat.
- Expected: `cancelled`, `failed`, or `timed_out` with finished time, duration, reason, and last checkpoint.
- Reproduction: interrupt a pipeline during a pass or trigger the wall-clock cap.
- Evidence: four envelopes and event streams; envelope status union lacks cancelled/timed-out; finalization occurs only after `runTurn` resolves; watchdog abandons the live turn.
- Suspected subsystem: confirmed in pass executor/envelope schema.
- Acceptance test: cancellation and timeout each finalize once with distinct status/reason and terminal events.
- Fix status: confirmed; pending.

## BS-006 — `operon analyze` ignores stale running envelopes

- Classification: observability gap
- Severity and impact: high; the diagnostic reports `No anomaly flags` for provably dead work.
- Observed: four stale envelopes with zero finalization produced no anomaly.
- Expected: stale heartbeat, missing finalization, zero-usage-with-tool-activity, and orphaned-run flags.
- Reproduction: create a running envelope with a heartbeat older than the threshold and call analyze.
- Evidence: installed CLI output; `src/runtime/runlog/anomalies.ts` only evaluates `wall_clock_ms`, which running envelopes do not have.
- Suspected subsystem: confirmed in runlog anomaly detector.
- Acceptance test: deterministic clock yields stale-run flags and non-stale heartbeats do not.
- Fix status: confirmed; pending.

## BS-007 — Usage and cost are committed only after a provider turn returns

- Classification: defect
- Severity and impact: critical; cancellation erases already incurred usage and understates budget exposure.
- Observed: interrupted turns display zero despite tool/model activity; the implement worktree contains 31 files.
- Expected: cumulative usage checkpoints persist during execution and survive cancellation/crash.
- Reproduction: emit token-usage updates and tool events, then cancel before terminal provider response.
- Evidence: Codex adapter accumulates usage in memory on `thread/tokenUsage/updated`; the executor writes envelope usage only after `runTurn` resolves.
- Suspected subsystem: confirmed in runtime hook contract, Codex adapter state, and pipeline envelope settlement.
- Acceptance test: a usage update followed by cancellation leaves partial tokens/cost in the envelope and ledger exactly once.
- Fix status: confirmed; pending.

## BS-008 — Telemetry renders unavailable usage as exact zero

- Classification: observability gap
- Severity and impact: high; operators can mistake unknown spend for free work.
- Observed: missing `usage` becomes `0/0`, `$0.00`, and `cost_estimated: false`.
- Expected: explicit `complete | partial | estimated | unavailable` usage quality; totals state coverage and never silently include unknown as zero.
- Reproduction: render an envelope without a usage object.
- Evidence: HTML and telemetry JSON; report view defaults absent fields to zero.
- Suspected subsystem: confirmed in CLI telemetry view/schema.
- Acceptance test: missing usage renders `unavailable`; checkpointed cancellation renders `partial`; complete estimate remains `estimated`.
- Fix status: confirmed; pending.

## BS-009 — Planning traces have no terminal trace outcome or plan-of-record status

- Classification: workflow gap
- Severity and impact: high; intermediate artifacts look like useful progress without saying the plan failed to complete/publish.
- Observed: trace one stopped in PM passes; trace two stopped in arbitration; neither decomposed or published.
- Expected: trace-level state identifies required/skipped/completed passes, final plan artifact, publication status, and terminal reason.
- Reproduction: stop planning after a middle pass.
- Evidence: trace maps, untracked PM artifacts, no decomposer envelope, and manually created GitHub tickets.
- Suspected subsystem: telemetry has only pass grouping; no trace record/schema.
- Acceptance test: interrupted planning renders `incomplete — intermediate artifacts only; no plan of record`.
- Fix status: confirmed; pending.

## BS-010 — Intermediate Planner artifacts are written into a shared managed clone

- Classification: workflow gap
- Severity and impact: high; concurrent traces can see/collide with untracked files and artifacts are not transactionally owned.
- Observed: PM-A/PM-B and learning candidates remain untracked under the managed clone.
- Expected: a trace-scoped worktree/artifact directory, followed by atomic publication or explicit abandonment.
- Reproduction: run competing PM passes and inspect shared clone status.
- Evidence: managed clone `git status`; PM session logs; both traces use the same cwd.
- Suspected subsystem: auto-plan workdir selection and planning protocol artifact placement.
- Acceptance test: concurrent traces have disjoint worktrees; abandoned artifacts are linked from trace records and never contaminate the shared clone.
- Fix status: confirmed; pending.

## BS-011 — Manual/external fallback lineage is absent

- Classification: observability gap
- Severity and impact: high; the delivered PR cannot be attributed honestly to bypassed Operon stages.
- Observed: telemetry contains only ticket #26, while PR #29 closes #26–#28 and was implemented outside Operon.
- Expected: parent task connects tickets, traces, branches, commits, PRs, reviews, and a declared external/manual fallback.
- Reproduction: stop Operon, finish in the parent harness, and link the PR.
- Evidence: original task, state claim files, missing #27/#28 envelopes, PR closing references.
- Suspected subsystem: no parent delegated-task/provenance record.
- Acceptance test: parent task report lists all three issues and marks Builder/Reviewer stages `manual` or `bypassed`.
- Fix status: confirmed; pending.

## BS-012 — Lifecycle labels conflate implementation, CI, review, and merge readiness

- Classification: workflow gap
- Severity and impact: high; `op:in-review` plus green CI can be misread as approved.
- Observed: all tickets are `op:in-review`, PR CI is green, but GitHub has zero reviews and no Operon Reviewer pass.
- Expected: separate states for implementation complete, CI green, awaiting Operon review, awaiting human review, approved for merge, and merged.
- Reproduction: open a CI-green PR without a review.
- Evidence: GitHub issue/PR JSON and absent review envelopes.
- Suspected subsystem: ticket state machine/completion projection.
- Acceptance test: each lifecycle transition requires its own evidence; green CI alone cannot advance to approved.
- Fix status: confirmed; pending.

## BS-013 — Completion can be claimed when required Operon stages were bypassed

- Classification: workflow gap
- Severity and impact: critical trust failure; “end-to-end complete” can be false even when the product output is good.
- Observed: outer task declared `Complete` after manual implementation/review and no Operon Reviewer.
- Expected: completion-integrity verdict fails closed whenever required stages are skipped, interrupted, or manual.
- Reproduction: build externally after an Operon failure and generate telemetry.
- Evidence: original final answer, run inventory, GitHub reviews.
- Suspected subsystem: absent parent-task completion-integrity evaluator.
- Acceptance test: the report may say product outcome complete, but must say `Operon end-to-end: incomplete` with missing stages.
- Fix status: confirmed; pending.

## BS-014 — Existing orgs can lack the pipeline hard-coded by `plan --auto`

- Classification: defect
- Severity and impact: high; documented auto planning fails before a turn unless a human edits a ratified protocol file.
- Observed: active org has `plan` but no `plan-bootstrap`; auto-plan hard-codes `plan-bootstrap`.
- Expected: command and org schema negotiate a supported planning route, or doctor reports a required migration before live work.
- Reproduction: run auto-plan against an org initialized before `plan-bootstrap` was packaged.
- Evidence: active `pipelines.yaml`; `operon-bugs.md` #1; `src/org/plan-auto.ts` hard-coded lookup.
- Suspected subsystem: org upgrade compatibility and planning route resolution.
- Acceptance test: legacy org gets a deterministic non-mutating migration error or supported synthesized route; no ad-hoc protocol edit required.
- Fix status: confirmed; pending.

## BS-015 — Adapter health is constructor presence, not readiness

- Classification: defect
- Severity and impact: high; work is admitted to a runtime that may lack auth/socket/managed binary readiness.
- Observed: doctor says `OK` and “auth not verified here” for all adapters.
- Expected: bounded, non-billable readiness probes with actionable failure details for configured adapters.
- Reproduction: make the adapter executable/import present but its backend unavailable.
- Evidence: installed doctor output and `src/cli/doctor.ts`, which only calls `getRuntime`.
- Suspected subsystem: doctor/adapter diagnostics contract.
- Acceptance test: unavailable runtime is `FAIL`; slow probe times out; healthy probe performs no model turn.
- Fix status: confirmed; pending.

## BS-016 — Adapter initialization has no dedicated bounded start timeout

- Classification: defect
- Severity and impact: high; a socket/auth/start stall consumes the full pass cap and resembles useful work.
- Observed: passes heartbeated with no terminal output; only a generic 60-minute pass watchdog exists.
- Expected: short start deadline separate from total wall clock, classified as adapter-start failure.
- Reproduction: client factory accepts construction but never resolves initialize/start.
- Evidence: Codex initialize/thread/start awaits; Claude stream waits for first message; no start timer/abort signal.
- Suspected subsystem: runtime contract and adapters.
- Acceptance test: no first provider event within the configured start timeout cancels the session and finalizes `failed` with `error_adapter_start_timeout`.
- Fix status: confirmed; pending.

## BS-017 — Learning report previously referenced a missing projected event

- Classification: defect
- Severity and impact: medium; learning diagnostics could fail on current work.
- Observed: the original task recorded an ENOENT for `learning/events/2026-07-11/20260711T193645-build-26.jsonl`.
- Expected: projection and cursor commit atomically, or readers degrade explicitly when derived data is absent.
- Reproduction: not reproduced on the current source; `operon learn report --json` succeeded and regenerated the missing projection.
- Evidence: original task turn 2; `operon-bugs.md` #10; post-investigation projection caveat in evidence.md.
- Suspected subsystem: partially confirmed; historical failure is credible, current capture code tolerates missing run event streams. Root cause requires a crash-order fixture.
- Acceptance test: crash between event projection and cursor/episode update, then rerun; report succeeds idempotently without dangling refs.
- Fix status: partially confirmed; regression fixture pending.

## BS-018 — Nominally read-only learning commands mutate derived state

- Classification: observability gap
- Severity and impact: medium; forensic inspection can alter timestamps and projections without warning.
- Observed: `operon learn report --json` rewrote capture cursor, episode files, and learning event files at `2026-07-12T02:07:23Z`.
- Expected: either a truly read-only report or an explicit `--refresh`/preview notice and separate projection command.
- Reproduction: snapshot learning tree hashes, run report, compare.
- Evidence: timestamp/hash inventory in evidence.md; `src/cli/learn.ts` comments say every read refreshes projections.
- Suspected subsystem: learning CLI command semantics.
- Acceptance test: default report performs no writes; explicit refresh writes atomically and reports what changed.
- Fix status: newly confirmed; pending.

## BS-019 — Session logs are tool activity, not transcripts

- Classification: observability gap
- Severity and impact: medium; operators cannot reconstruct agent reasoning/output from the report.
- Observed: `session.log` contains only tool-use lines; Codex thread IDs and Claude session IDs are not in envelopes/report.
- Expected: native session identifier/link plus an honest transcript-availability field; never label tool logs as full transcripts.
- Reproduction: inspect any July pass artifact set.
- Evidence: all session logs and envelope schema; `TurnResult.session` is discarded before envelope finalization.
- Suspected subsystem: run envelope/provenance persistence and HTML links.
- Acceptance test: Codex run exposes `codex://threads/<id>`; tool log is labeled activity log; unavailable transcript says so.
- Fix status: confirmed; pending.

## BS-020 — Telemetry starts at passes, not the delegated operator task

- Classification: observability gap
- Severity and impact: high; objective, completion criteria, manual fallback, and cross-trace causality are lost.
- Observed: report begins with `Ticket (no ticket)` and has no original prompt or parent Codex task.
- Expected: a parent-task record above trace/pass records.
- Reproduction: run Operon from a top-level Codex task and render telemetry.
- Evidence: HTML report and original task URI.
- Suspected subsystem: no parent-task schema/store/CLI flags.
- Acceptance test: report begins with exact prompt/reference, repo state, charter hash, outcome graph, and fallback status.
- Fix status: confirmed; pending.

## BS-021 — Planning depth is ceremony-driven rather than proportional

- Classification: workflow gap
- Severity and impact: medium/high; bounded tasks incur redundant expensive perspectives and latency.
- Observed: the fixed three-ticket request ran visionary, two PMs, and arbitration; PM outputs were similar and the trace still failed before decomposition.
- Expected: quick/standard/deep selection from risk, ambiguity, coupling, reversibility, and expected decomposition.
- Reproduction: plan an explicit low-risk one-to-three-ticket task through the current mature pipeline.
- Evidence: pipeline config and `$7.5157565` finalized planning cost without a plan of record.
- Suspected subsystem: pipeline selection lacks planning-depth inputs/policy.
- Acceptance test: table-driven routing, including short high-risk prompts forced deep and long clear low-risk prompts allowed quick.
- Fix status: product design complete in adaptive-planning.md; implementation pending.

## BS-022 — Onboarding has no durable delegated-operator authority charter

- Classification: workflow gap
- Severity and impact: high; top-level harnesses repeatedly renegotiate routine authority and may either pause unnecessarily or overreach.
- Observed: the original prompt manually supplied delegation; org/app onboarding artifacts contain TASTE and policy but no versioned authority grant/hash.
- Expected: canonical human-selected charter, optional app narrowing, automatic native-harness/brief injection, and per-run provenance.
- Reproduction: initialize and bootstrap an org/app, then inspect operator instructions and an envelope.
- Evidence: org/app artifacts, context assembly, envelope schema.
- Suspected subsystem: org init, bootstrap, context assembly, and run envelope.
- Acceptance test: conservative/delegated/custom onboarding choices; safe composition with existing AGENTS.md/CLAUDE.md; narrowing only; critical gates unchanged.
- Fix status: product design complete in delegated-operator-charter.md; implementation pending.

## BS-023 — Pre-ticket planning grouped as “(no ticket)” is expected but under-explained

- Classification: expected behavior
- Severity and impact: low; the grouping is logically correct but confusing.
- Observed: planning passes appear under `Ticket (no ticket)`.
- Expected: label them `Pre-ticket planning` and connect them to the parent task and resulting plan/tickets.
- Reproduction: render any planning trace before issue publication.
- Evidence: telemetry grouping by optional `ticket` field.
- Suspected subsystem: report presentation/provenance, not pass attribution.
- Acceptance test: pre-ticket planning is named explicitly and linked to published tickets or an incomplete-plan outcome.
- Fix status: expected core behavior; presentation fix pending.

## BS-024 — Open issues referenced by an open closing PR are expected

- Classification: expected behavior
- Severity and impact: informational; tickets close only when the PR merges.
- Observed: #26–#28 remain open while PR #29 is open.
- Expected: report the conditional close relationship and current PR state, not treat the open issues as a defect.
- Reproduction: create an open PR body containing `Closes #N`.
- Evidence: GitHub `closedByPullRequestsReferences` and `closingIssuesReferences`.
- Suspected subsystem: none; telemetry needs clearer GitHub-state presentation.
- Acceptance test: completion section says “will close on merge” while PR is open, then “closed by merge” afterward.
- Fix status: expected; telemetry enhancement pending.
