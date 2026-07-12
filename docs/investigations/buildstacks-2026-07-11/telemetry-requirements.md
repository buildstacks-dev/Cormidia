# Telemetry information architecture

Telemetry is a provenance graph rooted at a delegated operator task. Pass
envelopes remain the execution facts; they are no longer the top-level story.

## Implementation status

Implemented in commits `8c237a2`, `20fafc5`, `3c631cb`, `c27523e`, and
`4fa4ac5`. New parent tasks persist the exact prompt artifact, native task
reference, repository/charter evidence, fallback mode, lifecycle fields, and
result graph. Pass envelopes persist runtime/model/effort, actual workdir/git
identity, authority, session/transcript capability, prompts/outputs/activity,
usage quality, terminal reason, trace manifests, and planning routing. HTML
reports create adjacent redacted evidence bundles with relative links and a
visible completion-integrity section.

Legacy runs are intentionally not synthesized into parent tasks. Where the
July evidence predates a field, the regenerated report says `unknown` or `not
recorded`; it never infers a parent prompt, Reviewer approval, PR state, or
complete cost. Provider-native transcript availability remains provider-
dependent, and GitHub lifecycle facts must be captured in the parent-task
result when no connected GitHub state source is available.

## Parent task record

Store under `tasks/<task-id>/task.json` with an immutable prompt artifact and
append-only outcome updates. Required fields:

- Operon task ID and optional native parent URI, such as
  `codex://threads/<id>`;
- exact operator prompt reference/hash and completion criteria;
- start, heartbeat, end, duration, terminal status, and terminal reason;
- repo slug, actual workdir, branch, start HEAD, end HEAD;
- resolved delegated-authority source, profile, version, and SHA-256;
- objective and requested boundaries;
- traces, tickets, branches, commits, PRs, reviews, deployments, approvals;
- `execution_mode: operon | mixed | manual` and every fallback transition;
- completion-integrity result.

The original prompt belongs in a verbatim sibling artifact, not a truncated
JSON preview. Secrets are redacted at capture and the hash is over the stored
redacted artifact.

## Trace record

Store under `tasks/<task-id>/traces/<trace-id>.json` or a content-equivalent
index over run envelopes. Required fields:

- trace and parent task IDs;
- causal parent trace/pass;
- initiating command and trigger;
- pipeline, planning depth, routing-policy version/factors/skips/cost estimate;
- ticket or explicit `pre-ticket-planning` scope;
- expected and selected stages;
- start/end/duration, heartbeat/last-seen;
- `live | stalled | cancelled | failed | timed_out | completed | incomplete`;
- final outcome and artifact references;
- publication status and resulting ticket IDs.

## Pass/run envelope v2

Required identity/provenance:

- run, pass, trace, parent-task, app, ticket, causal-parent IDs;
- role, pipeline/pass;
- runtime/harness, model, effort shown as one tuple;
- actual workdir, repo, branch, start/end Git HEAD;
- authority source/version/hash;
- native session/provider identifier and transcript capability.

Required timing/lifecycle:

- start/end/duration;
- last heartbeat and last provider event;
- terminal status including cancelled and timed-out;
- cancellation/failure code, reason, signal, and initiator.

Required usage:

- input/output/cache-read/cache-write tokens and cost;
- `usage_quality: complete | partial | estimated | unavailable`;
- provider-reported versus locally estimated cost;
- checkpoint time/sequence and ledger settlement ID;
- tool-call/subagent counts.

Required artifacts:

- exact input prompt link (`brief.md`), output/verdict link (`output.md`),
  event stream (`events.jsonl`), activity log (`session.log`);
- native transcript URI where supported;
- explicit `transcript_availability` and reason when unavailable;
- ticket, PR, commit, review, and deployment refs.

`session.log` is always labeled “activity log”. A tool-only log must never be
presented as a transcript.

## Checkpointing contract

Adapters emit monotonic progress events carrying cumulative usage and session
identity. The executor atomically updates the envelope and an append-only
checkpoint ledger during the turn. Finalization promotes the latest checkpoint
to `complete`; cancellation promotes it to `partial`; a turn with no observable
usage is `unavailable`, not zero. Reconciliation is idempotent on
`(app, run_id, checkpoint_sequence)`.

## Artifact linking

HTML uses relative links into an adjacent evidence bundle by default:

```text
report.html
report.evidence/
  tasks/...
  runs/<app>/<run>/brief.md
  runs/<app>/<run>/output.md
  runs/<app>/<run>/events.jsonl
  runs/<app>/<run>/session.log
```

The bundle copies redacted forensic artifacts and a manifest with source paths
and hashes. Native URIs such as `codex://threads/<id>` remain direct links.
When copying is disabled, the CLI may serve a safe localhost route; it must not
emit broken `file://` links and call them usable.

## Completion integrity

The report begins with a visible pass/fail/unknown panel answering:

- Did every required planning, build, review, ship, and human boundary run?
- Which stages were skipped, interrupted, or completed manually?
- Did work occur on the expected branch/HEAD/worktree?
- Are any envelopes stale or unfinalized?
- What percentage of passes and cost have complete usage?
- Did an Operon Reviewer approve the exact PR HEAD?
- Is human review required and present?
- Is the PR open, approved, merged, closed, or abandoned?
- Which issues will close only after merge?

An integrity verdict is `complete`, `incomplete`, or `unknown`. `complete`
requires evidence for every required stage and complete/explicitly accepted
usage quality. A product can be complete while Operon integrity is incomplete;
the UI must show both statements separately.
