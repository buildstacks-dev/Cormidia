# Learning Loop - Spec Sheet

**Status:** Draft v0.7 - aligned to code audit of 2026-07-07  
**Companions:** `learning-loop-design.md`, `learning-loop-milestones.md`

All schemas are draft contracts. Field names may change before implementation.

v0.7 changes: OKF concept profile rewritten as a strict extension of the real
`OkfFrontmatter` schema; resolver selection rule specified; budget units pinned
to bytes; schedules rewritten in the supported grammar; metrics store changed
to JSONL projections; `pass_run_id` renamed `run_id`; app ids corrected to
registry names.

## 1. Physical Layout

Learning artifacts live in git. High-churn event and metric state lives under
the runtime home.

### Org Home

```text
learning/
  manifest.yaml
  policy.yaml
  rejections.jsonl
  reviews/
  bundle/
    org/
    roles/<role>/
  evals/
    roles/<role>/
  proposals/
    skills/
    protocol/
    gates/
```

### App Repo

```text
.operon/learning/
  manifest.yaml
  bundle/
    apps/<app>/
    apps/<app>/roles/<role>/
  evals/
    apps/<app>/
    apps/<app>/roles/<role>/
  proposals/
    skills/
    protocol/
    gates/
```

The resolver treats these as one logical bundle for a turn:

```text
org home learning/ + current app .operon/learning/
```

Existing `memory/roles/**` and `.operon/memory/**` trees are read-only legacy
seed: they resolve at lowest precedence with `trust: legacy` and promote into
`learning/bundle/**` individually through the candidate path (design §7.1). All
new governed concepts land under `learning/bundle/**`.

Note the org home is the Operon repo checkout itself (pointer-resolved via
`~/.operon/config`), so `learning/**` in the org root is git-versioned for
free, while `~/.operon/<org>/learning/` stays out of git.

### Runtime Home

```text
~/.operon/<org>/
  learning/
    events/<date>/<turn_id>.jsonl
    metrics/            # JSONL projections + cursor state
    reports/
    canaries/
```

V1 metrics are JSONL projections with computed aggregates — the same pattern
`runRetro` already uses over `telemetry/*.jsonl`. No new dependency
(TASTE.md §3: minimal and boring). With the Node 26 floor, `node:sqlite` is
stable and dependency-free; it is the upgrade path if report generation
measurably drags, and Postgres remains a later multi-host option.

## 2. Scopes

Allowed V1 scopes:

```text
org
roles/<role>
apps/<app>
apps/<app>/roles/<role>
```

Resolver load order for a turn:

```text
org -> roles/<role> -> apps/<app> -> apps/<app>/roles/<role>
```

`identities/**` and `accounts/**` are reserved for future versions and must not
be accepted by V1 validators.

## 3. OKF Concept Profile

OKF concepts are one destination, not the only destination. A concept is a
**strict extension of the existing `OkfFrontmatter` schema**
(`src/org/memory.ts`): every field the current validator requires stays, with
the same names and enums, plus a namespaced `loop` block. Existing parsers,
`INDEX.md` generation, and legacy seed docs keep working unmodified.

```yaml
---
name: support-missing-payload-intake
description: Support should not invent replies when feedback payloads are missing.
type: procedure            # lesson | fact | procedure (existing OKF enum)
keywords: [support, feedback, provenance]
evidence:
  - research/2026-07-07_marketplace-demo-e2e-assessment.md#support
status: active             # active | deprecated (existing OKF enum)
created: 2026-07-07
updated: 2026-07-07
loop:
  id: lrn_20260707_01JABC
  tier: T1
  status: active
  scope: apps/operon-marketplace-demo/roles/support
  topic_key: support.missing_payload
  version: 1
  supersedes: null
  ttl_days: 180
  eval_ref: null
  provenance:
    source_channel: internal
    trust: trusted
    turn_ids: [turn_20260707_marketplace_support]
    event_ids: [evt_01JABC]
  review:
    verdict_ref: reviews/lrn_20260707_01JABC.json
    approved_by: [human-operator]
---
When a support-feedback event lacks the original feedback payload, produce an
internal digest and open or update product intake work. Do not fabricate a user
reply.
```

Field mapping from v0.6: `title` → `name` (kebab-case, becomes the filename),
`tags` → `keywords`, `timestamp` → `created`/`updated` (`YYYY-MM-DD`),
`evidence_refs` → the existing `evidence` array.

The five-state lifecycle lives in `loop.status`; the top-level OKF `status`
stays binary and is derived from it:

```text
loop.status candidate | provisional | active  ->  status: active (resolvable)
loop.status deprecated | archived             ->  status: deprecated
```

Invariants:

- `loop.scope` must match the namespace path; the app segment is the verbatim
  `apps.yaml` registry name (e.g. `operon-marketplace-demo`, not
  `marketplace`).
- `loop.status` is `candidate | provisional | active | deprecated | archived`.
- Top-level `status` must agree with the derivation table above; validators
  reject disagreement.
- `provisional` concepts live only in quarantine and require a TTL no longer
  than 14 days.
- `trust: untrusted` requires human approval. `trust: legacy` marks unmigrated
  seed docs.
- T2/T3 concepts require an eval or explicit human waiver before activation.
- `topic_key` is optional, but if present it is the deterministic conflict key.

## 4. Learning Event Schema

Events are line-delimited JSON. A crash may leave one malformed tail line; the
reader discards only the final malformed line and treats mid-file corruption as
loud failure — the same contract `readEvents` already implements for runlog L2
(`src/runtime/runlog/events.ts`).

Events are produced by an **idempotent capture projector** that walks
`runs/<app>/<runId>/{envelope.json, events.jsonl}` with a persistent cursor,
plus direct emitters (resolver, human corrections, approvals). `run_id` is the
runlog run id verbatim (`YYYYMMDD-HHMMSS-<pipeline>-<pass>`,
`src/runtime/runlog/paths.ts`). `gate_verdict` events carry the qgates status
vocabulary (`pass | fail | skip`); the projector maps L1's
`passed | failed | skipped` onto it. Pass verdicts are captured from L2
`verdict.recorded` events — they are not persisted anywhere else on disk.

```json
{
  "event_id": "evt_01JABC",
  "turn_id": "turn_20260707_marketplace_support",
  "run_id": "20260707-054000-support-digest-summarize",
  "ts": "2026-07-07T05:40:00Z",
  "app": "operon-marketplace-demo",
  "agent_role": "support",
  "bundle_versions": {
    "org": "2026.07.07-1",
    "app": "2026.07.07-marketplace-1"
  },
  "type": "human_correction",
  "error_class": "support.reply_missing_source_payload",
  "cause_hypothesis": "context_missing.original_event_payload",
  "emitter": "human",
  "source_channel": "internal",
  "trust": "trusted",
  "payload": {
    "summary": "Support could not run naturally because shared event consumption happened after Planner spawned.",
    "artifacts": ["research/2026-07-07_marketplace-demo-e2e-assessment.md"]
  }
}
```

`type` enum:

```text
error
human_correction
gate_verdict
env_fact
tool_outcome
retro_note
artifact_created
concept_loaded
context_evicted
conflict_resolved
```

`emitter` enum:

```text
agent
orchestrator
verifier
resolver
human
```

Metric-bearing events must use `emitter` in:

```text
orchestrator | verifier | resolver | human
```

Agent-emitted events are advisory distillation input only.

## 5. Candidate Artifact Schema

The distiller emits candidate artifacts. `destination` determines the review and
publish path.

```json
{
  "candidate_id": "cand_20260707_01JDEF",
  "destination": "ticket",
  "title": "Fix event fan-out so one file-drop event can reach all subscribers",
  "proposed_scope": "apps/operon-marketplace-demo",
  "proposed_tier": "T1",
  "error_class": "dispatch.event_fanout_consumed_early",
  "cause_hypothesis": "shared_event_key_consumed_after_first_spawn",
  "event_ids": ["evt_01JABC", "evt_01JABD"],
  "evidence_refs": [
    "research/2026-07-07_marketplace-demo-e2e-assessment.md#issues-found"
  ],
  "draft": {
    "issue_title": "Fix multi-role event fan-out under WIP limits",
    "acceptance": [
      "One support-feedback event can dispatch Planner and Support turns across ticks.",
      "The event is consumed only after all subscribed turns are spawned or intentionally skipped."
    ]
  }
}
```

`destination` enum:

```text
okf_concept
skill_draft
protocol_proposal
eval_or_gate_proposal
ticket
reject
```

## 6. Reviewer Verdict Schema

```json
{
  "candidate_id": "cand_20260707_01JDEF",
  "verdict": "approve",
  "proposed_destination": "ticket",
  "proposed_tier": "T1",
  "proposed_scope": "apps/operon-marketplace-demo",
  "rubric": {
    "correctness": 5,
    "generality": 4,
    "scope_fit": 5,
    "destination_fit": 5,
    "provenance_trust": 5,
    "injection_screen": "clean"
  },
  "conflicts_with": [],
  "duplicates": [],
  "eval_required": false,
  "eval_present": false,
  "rationale": "This is runtime behavior, so it should become an Operon ticket rather than OKF memory."
}
```

`verdict` enum:

```text
approve
revise
reject
escalate
```

`injection_screen` enum:

```text
clean
suspicious
flagged
```

Non-clean injection screens escalate. Reviewer outage fails closed.

## 7. policy.yaml

```yaml
tiers:
  T0:
    label: scoped-facts
    approver: human
    canary: none
    version_cut: daily
    rollback_owner: oncall
    ttl_max_days: 365
  T1:
    label: procedures-and-skills
    approver: human
    canary: { fraction: 0.10, window_hours: 48 }
    promote_rule:
      min_canary_runs: 30
      max_regression_pct: 10
      eval_gate: true
      on_insufficient: human_judgment
    version_cut: daily
    rollback_owner: oncall
  T2:
    label: behavior-and-protocol
    approver: human
    canary: { fraction: 0.10, window_hours: 72 }
    promote_rule:
      min_canary_runs: 50
      max_regression_pct: 5
      eval_gate: true
      on_insufficient: human_judgment
    version_cut: weekly
    rollback_owner: owner
  T3:
    label: tools-config-permissions
    approver: human
    canary: { fraction: 0.05, window_hours: 72 }
    promote: manual
    version_cut: weekly
    rollback_owner: owner
overrides:
  untrusted_provenance: { min_approver: human }
  conflict_with_active: { escalate_tiers: 1 }
destinations:
  okf_concept: { publish: active_bundle_pr }
  skill_draft: { publish: proposal_pr }
  protocol_proposal: { publish: proposal_pr, human_ratified: true }
  eval_or_gate_proposal: { publish: implementation_ticket_or_pr }
  ticket: { publish: github_issue }
quarantine:
  max_ttl_days: 14
  author: human
  context_label: "UNVERIFIED - provisional"
rejections:
  suppress_days: 90
  override_if_evidence_x: 2
reviewer_sla_hours: 6
context_budget:
  # Units are BYTES, matching the existing memory cap (16 KiB) in
  # src/org/context.ts. Tokens would require a tokenizer dependency.
  default_bytes: 16384
  roles:
    support: 12288
  eviction:
    order: [provisional_first, efficacy_asc, oldest_first]
    protected_tiers: [T2, T3]
distiller:
  # Operon's schedule grammar (src/org/schedule.ts) supports
  # hourly | every Nh/Nm | daily HH:MM | weekly <day> HH:MM — not cron.
  # These run as roles.yaml triggers through the launchd dispatch tick.
  schedule: "daily 06:00"
compaction:
  schedule: "weekly mon 07:00"
  report_only_v1: true
  deprecate_if:
    loads_zero_days: 45
    past_ttl: true
    superseded: true
```

V1 uses low-volume canary thresholds. They are confidence aids, not mandatory
sample sizes for every promotion.

## 8. Manifest and Versioning

Each git root has a manifest. A turn pins both the org and app manifests when
both exist.

```yaml
bundle_version: 2026.07.07-1
stable: 2026.07.07-1
canary: null
history:
  - version: 2026.07.07-1
    commit: 8f2a...
    promoted: 2026-07-07T10:00:00Z
```

Resolved context records:

```json
{
  "turn_id": "turn_20260707_marketplace_support",
  "app": "operon-marketplace-demo",
  "role": "support",
  "bundle_versions": {
    "org": "2026.07.07-1",
    "app": "2026.07.07-marketplace-1"
  },
  "concept_ids": ["lrn_20260707_01JABC"],
  "context_bytes": 4210
}
```

The resolved-context record is written into the turn's runlog (alongside
`brief.md`), never into prompt bytes — turn ids in the cached prefix are a
silent cache invalidator (design §10.1). This also gives the per-turn
"which concepts were loaded" record that today exists only implicitly inside
`brief.md`.

Per-turn pin invariant:

- `resolve()` runs once at turn/pipeline start.
- Resolved versions and concept ids are immutable for that turn.
- Promotion, rollback, and `disable` affect only subsequently started turns.

### 8.1 Selection

Selection precedes eviction; V1 keeps it deliberately simple:

1. Load every `active` concept in the four applicable scopes, in precedence
   order (`org -> roles/<role> -> apps/<app> -> apps/<app>/roles/<role>`),
   until the byte budget is reached.
2. Within a scope, order is deterministic: sorted by concept id. Required for
   cache stability.
3. Keyword relevance (concept `keywords` vs. the task text) is only a
   tie-breaker inside a scope that overflows its budget share — not a global
   ranking. The scopes are narrow by construction; ranking is premature.
4. For event-triggered turns, the task text includes the original event
   payload (available after the Preflight payload fix). Today's selector keys
   off `"<role> <triggerKind> <trigger>"` only, which is why event-driven
   memory selection is currently blind to content.
5. The eviction order (`provisional_first, efficacy_asc, oldest_first`)
   applies when an over-budget resolve must drop already-selected concepts;
   `protected_tiers` fail loud rather than evict (a T2/T3 concept that does
   not fit is an error, not a silent drop).

## 9. Internal Interfaces

These are internal Operon boundaries first, extraction candidates later.

```typescript
interface LearningEventSink {
  emit(event: LearningEvent): Promise<void>;
}

interface ArtifactRouter {
  route(cluster: EventCluster): Promise<CandidateArtifact>;
}

interface Distiller {
  distill(events: AsyncIterable<LearningEvent>, bundle: Bundle, rejections: RejectionLedger): Promise<CandidateArtifact[]>;
}

interface Reviewer {
  review(candidate: CandidateArtifact, bundle: Bundle): Promise<ReviewerVerdict>;
}

interface LearningStore {
  openCandidate(candidate: CandidateArtifact): Promise<CandidateRef>;
  publish(candidate: CandidateArtifact, verdict: ReviewerVerdict): Promise<PublishRef>;
  setConceptStatus(conceptId: string, status: ConceptStatus): Promise<PublishRef>;
  bundleAt(root: "org" | "app", version: string): Promise<Bundle>;
}

interface Resolver {
  resolve(input: { app: string; role: string; turnId: string }): Promise<ResolvedLearningContext>;
  disable(conceptId: string): Promise<void>;
  rollback(root: "org" | "app"): Promise<void>;
}

interface LearningMetrics {
  record(event: LearningEvent): Promise<void>;
  recurrence(errorClass: string, version: string): Promise<RecurrenceStats>;
  efficacy(conceptId: string): Promise<EfficacyStats>;
  compactionCandidates(): Promise<ConceptRef[]>;
}
```

Implementation notes binding these interfaces to existing code:

- **Human approval** routes through the existing approvals store
  (`src/org/approvals.ts`: pending/decided/grants + `operon approvals`) as a
  new item kind — not a second inbox. Reviewer verdict JSON is stored under
  `learning/reviews/` as evidence; the decision lives in the one queue.
- **Reviewer verdict parsing** reuses `parseWithRetry` and the native
  structured-output path in `src/loop/verdicts.ts`.
- **`ticket` destination** requires adding `createIssue` to
  `GhOps`/`GhCliOps` (`src/loop/github.ts`) — no programmatic issue-creation
  helper exists today.
- **Distiller/reviewer** are `roles.yaml` entries with schedule triggers,
  executed by the normal turn runner (design §5); `operon learn distill` /
  `review` are manual invocations of the same passes.
- **Gate rule**: writes to `learning/bundle/**` and `learning/manifest.yaml`
  are critical ops (same shape as `scorecard-tamper` in
  `src/runtime/gate.ts`).
- **Tests** reuse `test/fixtures/orgHome.ts` and `test/fixtures/fakeClock.ts`;
  no ad-hoc mkdtemp scaffolds.

CLI surface (new file `src/cli/learn.ts` + one registry line in
`src/cli.ts`, per the dispatch-table pattern):

```text
operon learn emit
operon learn distill
operon learn review
operon learn resolve
operon learn report
operon learn disable
operon learn rollback
operon learn provisional
```

## 10. Lifecycle

```text
captured events
  -> candidate artifact
  -> reviewer verdict
  -> human approval in V1
  -> destination publish
  -> version cut when destination is active OKF
  -> resolve into future turns
  -> metrics/report
  -> compact/deprecate/promote
```

Concept lifecycle:

```text
candidate -> active -> deprecated -> archived
candidate -> provisional -> active
candidate -> rejected -> rejection ledger
```

Version lifecycle:

```text
stable -> canary report -> human promote | extend | rollback
```

## 11. Metrics

Required V1 metrics:

- `concept_loaded` count per concept and bundle version.
- trusted recurrence rate by `error_class`, app, role, and bundle version.
- held-in eval pass/fail for concepts with `eval_ref`.
- held-out baseline pass/fail for role/app.
- context byte/token budget and eviction count.
- reviewer-human agreement.
- human agreement with canary recommendation.
- rejection ledger suppression hits.

Agent self-reports are excluded from recurrence, efficacy, and canary decisions.
