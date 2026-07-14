# Learning Loop - Spec Sheet

**Status:** v0.8 - ratified 2026-07-11 (`docs/PURPOSE.md` → Decided → Learning
loop design); revised per the consolidated design feedback of 2026-07-10
(`archive/2026-07-10_feedback.md`)  
**Build status:** built through M5 (PR #52, 2026-07-11); where this document and the code diverge, the code and `AGENTS.md` are authoritative  
**Companions:** `learning-loop-design.md`, `learning-loop-milestones.md`

Episode identity, learning-capture coverage, and outcome-accountable efficacy
use the canonical definitions and missingness rules in `docs/efficiency.md`.
The schemas below carry those facts but do not redefine their measurements.

All schemas are draft contracts. Field names may change before implementation.

v0.8 changes: candidates moved out of active bundles; resolver requires
`loop.status: active`; the false "existing parser supports `loop` unchanged"
claim replaced with a deliberate validator extension plus a round-trip test;
org-home layout corrected to the ratified package/org/state separation; event
schema gains episode fields; new contracts: `EpisodeRecord`,
`SystemFingerprint`, `ReplayCapsule`, `ExperimentRecord`,
`InterventionRecord`, `EvalResult`; approval binding and publisher transaction
specified; scope budget shares defined and conflict resolution moved before
budgeting; provisional TTL enforced by the resolver; gate protection extended
to every learning governance surface; canary assignment keyed to episodes.

## 1. Physical Layout

Learning artifacts live in git. High-churn event, episode, and metric state
lives under the state home.

### Committed Org Home

The org home is the **committed org directory created by `operon org init`**
(the ratified package/org/state/app separation, `docs/PURPOSE.md`; resolution
in `src/org/home.ts`). It is not the Operon source checkout, and it is not the
state home.

```text
learning/
  manifest.yaml
  policy.yaml
  rejections.jsonl
  reviews/
  candidates/            # pending candidates - NEVER resolvable (see §3)
  quarantine/            # human-authored provisionals, TTL-bound
  bundle/                # ACTIVE concepts only
    org/
    roles/<role>/
  evals/
    roles/<role>/
  experiments/           # ExperimentRecords + EvalResults
  interventions/         # InterventionRecords
  proposals/
    skills/
    protocol/
    gates/
```

### App Repo

```text
.operon/learning/
  manifest.yaml
  candidates/
  quarantine/
  bundle/
    apps/<app>/
    apps/<app>/roles/<role>/
  proposals/
    skills/
    protocol/
    gates/
```

The draft's app-side `evals/` was not built: eval fixtures live only under the
committed org home `learning/evals/**`, for app scopes too
(`src/org/learning/eval-fixture.ts`).

The resolver treats these as one logical bundle for a turn:

```text
org home learning/ + current app .operon/learning/
```

Existing `memory/roles/**` and `.operon/memory/**` trees are read-only legacy
seed: they resolve at lowest precedence with `trust: legacy` and promote into
`learning/bundle/**` individually through the candidate path (design §7.1). All
new governed concepts land under `learning/bundle/**`.

### State Home

```text
~/.operon/<org>/
  learning/
    events/<date>/*.jsonl                # stream file = turn id, else emitter
    episodes/<episode_id>.json           # EpisodeRecord projections (flat)
    capsules/<capsule_id>.json           # ReplayCapsule payloads (flat)
    fingerprints/                        # content-addressed SystemFingerprints
    resolved/<turn_id>.json              # per-turn pinned resolve records
    canary/assignments/<episode_id>.json # episode-sticky canary assignments
    publish-journal/                     # crash-resumable publish transactions
    metrics/                             # capture cursor + rebuildable efficiency-health projection
```

(As built — `src/org/learning/{events,episode,capsule,fingerprint,resolver,canary,publisher,capture}.ts`;
the draft's `reports/` and `canaries/` directories were never created.)

V1 metrics are JSONL projections with computed aggregates — the same pattern
`runRetro` already uses over `telemetry/*.jsonl`. No new dependency
(TASTE.md §3: minimal and boring). With the Node 26 floor, `node:sqlite` is
stable and dependency-free; it is the upgrade path if report generation
measurably drags, and Postgres remains a later multi-host option.

### Gate-Protected Paths

Writes to any of the following are critical ops (same shape as
`scorecard-tamper` in `src/runtime/gate.ts`); only the deterministic publisher
and humans write inside them:

```text
learning/bundle/**          .operon/learning/bundle/**
learning/manifest.yaml      .operon/learning/manifest.yaml
learning/policy.yaml
learning/quarantine/**      .operon/learning/quarantine/**
learning/evals/**           .operon/learning/evals/**
learning/reviews/**
learning/rejections.jsonl
learning/experiments/**
learning/interventions/**
```

`learning/candidates/**` is deliberately *not* protected: agents emit
candidates freely; candidates have no authority (§3).

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
**deliberate extension of the existing `OkfFrontmatter` schema**
(`src/org/memory.ts`): every field the current validator requires stays, with
the same names and enums, plus a namespaced `loop` block.

**Required validator change.** The current `validateFrontmatter` reconstructs
only the eight known fields, so any rewrite (`writeMemoryDoc`,
`deprecateMemoryDoc`) would silently strip the `loop` block — destroying
provenance, tier, review references, and TTL. The validator is extended to
parse, validate, and preserve `loop`, and the implementation ships a
**round-trip test**: parse → serialize → parse must preserve the `loop` block
byte-for-byte. Legacy docs without a `loop` block remain valid (they are
`trust: legacy` seed context).

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
  claim: authorized        # authorized | validated (design §9.1)
  experiment_ref: null     # required when claim is validated
  provenance:
    source_channel: internal
    trust: trusted
    episode_ids: [ep_operon-marketplace-demo_feedback_0142]
    turn_ids: [turn_20260707_marketplace_support]
    event_ids: [evt_01JABC]
  review:
    verdict_ref: reviews/lrn_20260707_01JABC.json
    approved_by: [human-operator]
    approval_ref: appr_01JXYZ
---
When a support-feedback event lacks the original feedback payload, produce an
internal digest and open or update product intake work. Do not fabricate a user
reply.
```

Field mapping from v0.6: `title` → `name` (kebab-case, becomes the filename),
`tags` → `keywords`, `timestamp` → `created`/`updated` (`YYYY-MM-DD`),
`evidence_refs` → the existing `evidence` array.

### Lifecycle, Storage Location, and Resolvability

`loop.status` determines **where the file lives** and whether it can resolve.
Storage location is the primary defense: an unreviewed candidate is not merely
marked non-active — it is physically outside every directory the resolver
reads.

| `loop.status` | Lives in                  | Top-level `status` | Resolvable                                        |
| ------------- | ------------------------- | ------------------ | ------------------------------------------------- |
| `candidate`   | `candidates/`             | `active`           | **Never**                                         |
| `provisional` | `quarantine/`             | `active`           | Only with unexpired TTL, rendered under an UNVERIFIED label; TTL enforced by the resolver |
| `active`      | `bundle/`                 | `active`           | Yes                                               |
| `deprecated`  | `bundle/`                 | `deprecated`       | No                                                |
| `archived`    | removed from bundle       | `deprecated`       | No                                                |

The resolver loads from `bundle/` (requiring `loop.status === active`) and
`quarantine/` (requiring an unexpired TTL) only. Validators reject any file
whose `loop.status` disagrees with its directory, and any file whose top-level
`status` disagrees with the table above.

Invariants:

- `loop.scope` must match the namespace path; the app segment is the verbatim
  `apps.yaml` registry name (e.g. `operon-marketplace-demo`, not
  `marketplace`).
- `loop.status` is `candidate | provisional | active | deprecated | archived`.
- `provisional` concepts live only in `quarantine/`, require a human author,
  and require a TTL no longer than 14 days. The resolver skips expired
  provisionals and emits `provisional_expired`; compaction archives them.
- `trust: untrusted` requires human approval. `trust: legacy` marks unmigrated
  seed docs.
- T2/T3 concepts require an eval or an explicit human waiver (recorded on the
  approval) before activation.
- Concepts must respect the OKF content bounds (design §6.2): candidates whose
  content concerns permissions, security posture, deployment, tool grants,
  gate semantics, or constitutional behavior are re-routed to proposal/code
  destinations, never published as memory.
- `topic_key` is optional, but if present it is the deterministic conflict key.
- At publish time the publisher validates that adding the concept keeps every
  applicable (role, app) bundle within the smallest configured byte budget for
  T2/T3 protected concepts — an oversized protected concept is a publish-time
  error, not a resolve-time brick (§8.1).

## 4. Learning Event Schema

Events are line-delimited JSON. A crash may leave one malformed tail line; the
reader discards only the final malformed line and treats mid-file corruption as
loud failure — the same contract `readEvents` already implements for runlog L2
(`src/runtime/runlog/events.ts`).

Events are produced by an **idempotent capture projector** that walks
`runs/<app>/<runId>/{envelope.json, events.jsonl}` with a persistent cursor,
plus direct emitters (resolver, publisher, human corrections, approvals).
`run_id` is the runlog run id verbatim (`YYYYMMDD-HHMMSS-<pipeline>-<pass>`,
`src/runtime/runlog/paths.ts`). `gate_verdict` events carry the qgates status
vocabulary (`pass | fail | skip`); the projector maps L1's
`passed | failed | skipped` onto it. Pass verdicts are captured from L2
`verdict.recorded` events — they are not persisted anywhere else on disk.

Phase 4 cursor receipts bind each eligible finalized provider run to its exact
deterministic event ids. Mechanical executions and `runs/learning-replay/**`
are explicitly ineligible. Unreadable/corrupt/torn, stale, running, and
missing-finalization artifacts remain named blockers; a stale receipt repairs
by replaying immutable evidence and atomically rebinding the same ids.

`efficiency-evidence/v1` adds these stable trusted `error_class` values:
`execution.cancelled`, `execution.cap_stop`, `environment.retry_cluster`,
`route.budget_variance`, `route.budget_overrun`,
`execution.stale_finalization`, `execution.missing_finalization`,
`approval.false_positive`, `execution.repeated_work`,
`review.long_duration`, `tooling.bash_heavy`,
`tooling.shell_heavy_repetition`, and `scheduler.missed_tick`. Scheduler-miss
evidence is a future-compatible class; this phase does not install a scheduler.
Trusted recurrence is keyed by app, role, class, and normalized cause, with
distinct source identities and the policy's `min_cluster_events` threshold.

Every event carries its **episode context**: `episode_id` plus the pipeline,
pass, stage, and risk tier under which it occurred. Turn-level fields remain
for diagnosis; episode fields are what treatment assignment and outcome
measurement key on (design §8).

```json
{
  "event_id": "evt_01JABC",
  "episode_id": "ep_operon-marketplace-demo_feedback_0142",
  "turn_id": "turn_20260707_marketplace_support",
  "run_id": "20260707-054000-support-digest-summarize",
  "ts": "2026-07-07T05:40:00Z",
  "app": "operon-marketplace-demo",
  "agent_role": "support",
  "pipeline": "support-digest",
  "pass": "summarize",
  "stage": "grow",
  "risk_tier": "T1",
  "release_disposition": null,
  "bundle_versions": {
    "org": "2026.07.07-1",
    "app": "2026.07.07-marketplace-1"
  },
  "bundle_lineage": "stable",
  "type": "human_correction",
  "error_class": "support.reply_missing_source_payload",
  "cause_hypothesis": "context_missing.original_event_payload",
  "emitter": "human",
  "source_channel": "internal",
  "trust": "trusted",
  "payload": {
    "observation": "Support could not run naturally because shared event consumption happened after Planner spawned.",
    "cause_hypothesis_text": "Event fan-out consumes the shared key on first spawn.",
    "suggested_intervention": null,
    "artifacts": ["research/2026-07-07_marketplace-demo-e2e-assessment.md"]
  }
}
```

For `human_correction` events, the payload keeps the three-field contract
separate (design §10.1): `observation` (trusted evidence),
`cause_hypothesis_text` (hypothesis even from a human), and
`suggested_intervention` (requires review and, when efficacy-claiming,
evaluation).

`type` enum:

```text
error
human_correction
gate_verdict
pass_verdict
env_fact
tool_outcome
retro_note
artifact_created
concept_loaded
context_evicted
conflict_resolved
provisional_expired
canary_assigned
episode_opened
episode_closed
late_outcome
publish_committed
```

(`pass_verdict` and `canary_assigned` were added in the build —
`src/org/learning/events.ts`.)

`emitter` enum:

```text
agent
orchestrator
verifier
resolver
publisher
human
```

Metric-bearing events must use `emitter` in:

```text
orchestrator | verifier | resolver | publisher | human
```

Agent-emitted events are advisory distillation input only.

## 5. EpisodeRecord

The episode is the unit of treatment assignment and outcome measurement
(design §8). `EpisodeRecord` is a **projection** over process-owned sources —
the M5 ticket state machine's state, runlogs, the telemetry ledger, and the
approvals store — rebuildable with a cursor, never an independently writable
second source of truth. Late-maturing outcomes are the one append-only
exception.

Episode ids derive deterministically from the durable anchor:

```text
ep_<app>_<kind-short>_<source-key>
e.g. ep_buildstacks-dev_ticket_0002, ep_operon-sandbox-gamma_incident_disk-alert-0007
```

```json
{
  "episode_id": "ep_buildstacks-dev_ticket_0002",
  "kind": "build_ticket",
  "app": "buildstacks-dev",
  "source": { "kind": "github_issue", "ref": "buildstacks-dev/buildstacks.dev#2" },
  "stage": "onboarding",
  "risk_tier": "T1",
  "opened": "2026-07-09T14:02:11Z",
  "closed": "2026-07-09T19:44:03Z",
  "status": "closed",
  "fingerprint_ref": "sys_01ABC",
  "bundle_lineage": "stable",
  "turns": [
    { "turn_id": "turn_...", "role": "builder", "pipeline": "build", "pass": "implement", "run_ids": ["20260709-140300-build-implement"] },
    { "turn_id": "turn_...", "role": "reviewer", "pipeline": "review", "pass": "review", "run_ids": ["20260709-153000-review-review"] }
  ],
  "gates": [{ "gate": "setup", "status": "pass" }, { "gate": "test", "status": "pass" }],
  "approvals": ["appr_01JXYZ"],
  "artifacts": ["pull-request-23", "branch:ticket-2"],
  "side_effects": [{ "kind": "github_pr", "ref": "#23", "reversible": true }],
  "outcome": {
    "completed": true,
    "merged": true,
    "release_disposition": "shipped",
    "review_cycles": 2,
    "gate_failures": 1,
    "human_interventions": 1,
    "cost_usd": 12.41,
    "budget_exceeded": false
  },
  "late_outcomes": [
    { "kind": "escaped_defect", "ref": "buildstacks-dev/buildstacks.dev#9", "recorded": "2026-07-15T08:00:00Z" }
  ],
  "human_observations": [
    { "event_id": "evt_01JABC", "disposition_ref": "cand_20260707_01JDEF" }
  ]
}
```

`bundle_lineage` (`stable | canary | mixed | null`) is derived by folding the
lineage of the episode's resolved turns (`src/org/learning/episode.ts`); the
sticky assignment record itself lives in the state home at
`learning/canary/assignments/<episode_id>.json` (first governed resolve wins,
design §8.4) — it is not stored on the `EpisodeRecord`.

`kind` enum and episode boundaries:

```text
build_ticket        # ticket or bootstrap milestone (M5 state machine)
incident            # SRE incident event chain
feedback_thread     # Support feedback thread
campaign            # Marketing campaign or release
```

## 6. SystemFingerprint

A content-addressed snapshot of everything that shaped an episode's behavior.
`fingerprint_id` is the hash of the canonical serialization; identical
configurations share one fingerprint.

```json
{
  "fingerprint_id": "sys_01ABC",
  "operon": { "version": "0.9.3", "commit": "5f6bfd8" },
  "org": { "commit": "aa10c2", "taste_hash": "sha256:...", "roles_hash": "sha256:...", "pipelines_hash": "sha256:...", "prompts_hash": "sha256:..." },
  "app": { "name": "buildstacks-dev", "commit": "abc123", "config_hash": "sha256:..." },
  "bundle_versions": { "org": "2026.07.07-1", "app": "2026.07.07-bsd-1" },
  "bundle_lineage": "stable",
  "models": {
    "builder": { "runtime": "claude", "model": "claude-fable-5", "effort": "high" },
    "reviewer": { "runtime": "codex", "model": "gpt-5.5", "effort": "high" }
  },
  "gates_hash": "sha256:...",
  "budget_caps": { "per_turn_usd": 15, "daily_usd": 120 },
  "permissions_hash": "sha256:...",
  "env": { "node": "26.x", "platform": "darwin" }
}
```

Control and treatment arms of an experiment are expressed as two fingerprints
that differ only in the intervention under test.

## 7. ReplayCapsule

Everything necessary to safely attempt the episode's task again (design §9.4).
Assembled deterministically at the episode boundary; model tokens are spent on
replay execution, never on capture. **V1 scope: build episodes only.**

```yaml
capsule_id: replay_buildstacks_ticket_2
episode_ref: ep_buildstacks-dev_ticket_0002
kind: build_ticket
seed:
  repo: buildstacks-dev/buildstacks.dev
  commit: abc123
  fixtures: []
input:
  ticket_ref: "github:#2"
  brief_hash: "sha256:..."
fingerprint_ref: sys_01ABC
artifacts:
  - contract-comment
  - branch:ticket-2
  - pull-request-23
observed_outcome:
  merged: true
  review_cycles: 2
  cost_usd: 12.41
expected_outcome: null          # trusted grader target; null until validated
grader: null                    # deterministic | model | human grader ref
side_effect_policy:
  network: fixture_only
  publishing: forbidden
  deployment: sandbox_only
replayability: partially_replayable   # replayable | partially_replayable | non_replayable
missing:
  - trusted_expected_outcome
sanitized: false
validated_by: null              # independent reviewer / human ref once trusted
```

Rules:

- Capsule assembly and validation are deterministic software; an eval-builder
  agent may *draft* missing fixtures, expected outcomes, rubrics, or graders,
  but an independent reviewer — and a human for important or ambiguous cases —
  must validate them before the capsule is a trusted eval
  (`validated_by` set).
- Replay never repeats an irreversible production side effect; the
  `side_effect_policy` says what is faked, sandboxed, or forbidden.
- Support/Marketing (synthetic channels, fake publishing destinations) and
  SRE/deployment (disposable services, staging, simulated incidents, shadow
  execution) capsules are V2.

## 8. Manifest, Versioning, Selection

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
    approval_ref: appr_01JXYZ
```

Resolved context records:

```json
{
  "turn_id": "turn_20260707_marketplace_support",
  "episode_id": "ep_operon-marketplace-demo_feedback_0142",
  "app": "operon-marketplace-demo",
  "role": "support",
  "bundle_versions": {
    "org": "2026.07.07-1",
    "app": "2026.07.07-marketplace-1"
  },
  "bundle_lineage": "stable",
  "concept_ids": ["lrn_20260707_01JABC"],
  "context_bytes": 4210
}
```

The resolved-context record is written into the state home at
`learning/resolved/<turn_id>.json` (`src/org/learning/resolver.ts`), never
into prompt bytes — turn ids in the cached prefix are a silent cache
invalidator (design §12.1). This also gives the per-turn
"which concepts were loaded" record that today exists only implicitly inside
`brief.md`.

Per-turn pin invariant:

- `resolve()` runs once at turn/pipeline start.
- Resolved versions and concept ids are immutable for that turn.
- Bundle lineage (stable vs. canary) is a deterministic function of
  `episode_id` and is identical for every turn in the episode (design §8.4).
- Promotion, rollback, and `disable` affect only subsequently started turns.

### 8.1 Selection

Selection is deliberately simple, and it happens in this order:

1. **Gather.** Collect every `active` concept in the four applicable scopes
   from `bundle/`, plus unexpired provisionals from `quarantine/` (rendered
   under their UNVERIFIED label). Expired provisionals are skipped with a
   `provisional_expired` event.
2. **Resolve conflicts before budgeting.** When two gathered concepts share a
   `topic_key`, the narrower scope wins; the loser is excluded *now* and a
   `conflict_resolved` event is emitted. A broad-scope loser can therefore
   never consume budget that starves the narrow-scope winner.
3. **Budget by scope share.** The byte budget is divided into per-scope
   shares (policy §13, `context_budget.shares`). Each scope fills its own
   share; unused share redistributes **narrowest-first**, so
   `apps/<app>/roles/<role>` — the highest-precedence scope — is served
   before `org` overflow, never after it.
4. **Within a scope**, order is deterministic: sorted by concept id. Required
   for cache stability. Keyword relevance (concept `keywords` vs. the task
   text) is only a tie-breaker inside a scope that overflows its share — not
   a global ranking. For event-triggered turns, the task text includes the
   original event payload (Preflight payload fix; still open — milestones).
5. **Eviction** (`provisional_first, efficacy_asc, oldest_first`) applies when
   an over-budget resolve must drop already-selected concepts.
   `protected_tiers` (T2/T3) fail loud rather than evict — and because the
   publisher validates bundle size against the smallest configured budget at
   publish time (§3), a protected concept that cannot fit is caught before it
   can brick future turns, not at resolve time.

## 9. Candidate Artifact Schema

The distiller emits candidate artifacts into `candidates/`. `destination`
determines the review and publish path. `claims_efficacy` determines whether
an `ExperimentRecord` is required (design §9.1).

```json
{
  "candidate_id": "cand_20260707_01JDEF",
  "destination": "ticket",
  "title": "Fix event fan-out so one file-drop event can reach all subscribers",
  "proposed_scope": "apps/operon-marketplace-demo",
  "proposed_tier": "T1",
  "claims_efficacy": false,
  "experiment_ref": null,
  "error_class": "dispatch.event_fanout_consumed_early",
  "cause_hypothesis": "shared_event_key_consumed_after_first_spawn",
  "episode_ids": ["ep_operon-marketplace-demo_feedback_0142"],
  "event_ids": ["evt_01JABC", "evt_01JABD"],
  "evidence_refs": [
    "research/2026-07-07_marketplace-demo-e2e-assessment.md#issues-found"
  ],
  "content_hash": "sha256:...",
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

## 10. ExperimentRecord

Declared **before results are observed**. Required for efficacy-claiming
candidates and T2/T3 activation (waivable by a human, recorded on the
approval); optional otherwise. The examples in the archived feedback
(`archive/2026-07-10_feedback.md` §10) illustrate policy values; thresholds
are per-experiment declarations, not universal constants.

```yaml
experiment_id: exp_builder-test-mapping_01
candidate_ref: cand_20260708_01JGHI
unit: build_ticket                 # EpisodeRecord kind
hypothesis: >
  Adding the test-mapping skill will reduce review rework without materially
  increasing cost.
control:
  fingerprint_ref: sys_01ABC       # differs from treatment only in the intervention
treatment:
  fingerprint_ref: sys_01ABD
eligibility:
  episodes: evals/roles/builder/standard-tickets   # eval set or live population filter
  app: any
  stage: [grow, onboarding]
primary_metric:
  name: average_review_cycles
  expected_direction: decrease
  min_useful_improvement_pct: 20
guardrails:
  - { metric: merge_success_rate, rule: must_not_decrease }
  - { metric: gate_pass_rate, rule: must_not_decrease }
  - { metric: average_cost_usd, rule: max_increase_pct: 10 }
trials:
  layer: replay                    # deterministic | replay | canary
  repetitions: 3                   # paired control/treatment runs
  early_stop:
    on_held_in_failure: true
    on_guardrail_trip: true
efficacy_protocol:
  declared_at: 2026-07-10T08:00:00Z
  baseline: { metric: average_review_cycles, value: 2.5, source_ref: baseline:builder-standard/v1 }
  hidden_guardrail_commitment:
    sha256: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    fixture_refs: [evals/hidden/builder-baseline/v1]
  eligibility_sha256: sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789
  actor_blinding: { treatment_identity_hidden: true }
  pairing: { seed: builder-standard-v1, order: alternating_control_treatment }
  budget: { max_usd: 25 }
  stop_rules: { retain_attempted_pairs: true, early_stop_reasons: [budget_stop, held_in_failure, guardrail_trip] }
  side_effect_replacement: { network: fixture_only, publishing: forbidden, deployment: sandbox_only }
  missingness: { missing: invalid_measurement, invalid: fail_closed }
observation:
  outcome_maturity_days: 7         # wait for late outcomes before final verdict
stop_thresholds:
  rollback_immediately_if: { metric: merge_success_rate, below_control_pct: 20 }
decision:
  promote_if: primary_metric_improves_and_all_guardrails_pass
  otherwise: reject_extend_or_revise
status: declared                   # declared | running | decided
result: null                       # EvalResult ref once decided
```

Legacy declarations without `efficacy_protocol` remain readable for audit, but
cannot execute, activate, or promote. The protocol is immutable with the
declaration. Every observed timestamp must be later than `declared_at`; a
fingerprint mismatch or treatment identity in actor-visible bytes fails
closed. Pair order alternates deterministically, assignment remains sticky by
episode, and attempted pairs survive budget and early stops.

## 11. InterventionRecord

One lineage contract for **every** destination (design §9.2): what changed,
who approved it, when it activated, which episodes it touched, what the
outcome was, and whether it was rolled back.

```json
{
  "intervention_id": "int_20260708_01JKLM",
  "candidate_ref": "cand_20260708_01JGHI",
  "destination": "okf_concept",
  "reviewed_content_hash": "sha256:...",
  "approval_ref": "appr_01JXYZ",
  "publish": {
    "kind": "bundle_version",
    "ref": "org@2026.07.09-1",
    "commit": "9c4e...",
    "published_at": "2026-07-09T06:10:00Z"
  },
  "activation": {
    "activated_at": "2026-07-09T06:10:00Z",
    "claim": "authorized"
  },
  "affected_episodes": { "query": "bundle_versions.org >= 2026.07.09-1" },
  "experiment_ref": "exp_builder-test-mapping_01",
  "outcome_ref": "eval_01JNOP",
  "rollback": null,
  "status": "active"
}
```

`publish.kind` enum: `bundle_version | pr | commit | issue | config_change`.  
`status` enum: `proposed | published | active | rolled_back | retired`.

## 12. EvalResult

```json
{
  "eval_id": "eval_01JNOP",
  "experiment_ref": "exp_builder-test-mapping_01",
  "layer": "replay",
  "capsule_refs": ["replay_buildstacks_ticket_2"],
  "trials": [
    { "pair": 1, "control": { "review_cycles": 3, "cost_usd": 11.2 }, "treatment": { "review_cycles": 1, "cost_usd": 12.0 } },
    { "pair": 2, "control": { "review_cycles": 2, "cost_usd": 9.8 }, "treatment": { "review_cycles": 2, "cost_usd": 10.1 } }
  ],
  "primary_metric": { "name": "average_review_cycles", "control": 2.5, "treatment": 1.5, "direction_ok": true, "min_useful_met": true },
  "guardrails": [
    { "metric": "merge_success_rate", "pass": true },
    { "metric": "average_cost_usd", "pass": true }
  ],
  "verdict": "improved",
  "execution": {
    "validity": "valid",
    "attempted_pairs": [0, 1, 2],
    "completed_pairs": [0, 1, 2],
    "pair_order": [
      { "pair": 0, "order": ["control", "treatment"] },
      { "pair": 1, "order": ["treatment", "control"] },
      { "pair": 2, "order": ["control", "treatment"] }
    ],
    "halted_reason": null,
    "invalid_reasons": []
  },
  "grader": { "kind": "deterministic", "ref": "evals/roles/builder/standard-tickets/grader.ts" },
  "cost_usd": 61.40,
  "decided_by": "human-operator",
  "decided_at": "2026-07-10T09:00:00Z"
}
```

`verdict` enum:

```text
improved
regressed
inconclusive
not_evaluatable
```

`grader.kind` enum: `deterministic | model | human`. Model graders are allowed
only for qualitative guardrails and must themselves be validated fixtures.
`execution.validity` is `valid | invalid_measurement | missing_measurement`.
An invalid or missing result cannot promote even if another aggregate field
looks favorable.

## 13. policy.yaml

```yaml
tiers:
  T0:
    label: scoped-facts
    approver: human
    trials: none                    # not_evaluatable acceptable
    version_cut: daily
    rollback_owner: oncall
    ttl_max_days: 365
  T1:
    label: procedures-and-skills
    approver: human
    canary: { unit: episode, fraction: 0.10, window_hours: 48 }
    promote_rule:
      min_canary_episodes: 15
      max_regression_pct: 10
      eval_gate: true
      on_insufficient: human_judgment   # recorded as inconclusive
    version_cut: daily
    rollback_owner: oncall
  T2:
    label: behavior-and-protocol
    approver: human
    experiment_required: true
    canary: { unit: episode, fraction: 0.10, window_hours: 72, requires_replay_pass: true }
    promote_rule:
      min_canary_episodes: 25
      max_regression_pct: 5
      eval_gate: true
      on_insufficient: human_judgment
    version_cut: weekly
    rollback_owner: owner
  T3:
    label: tools-config-permissions
    approver: human
    experiment_required: true
    live_canary: forbidden
    allowed_trials: [sandbox, replay, shadow, bounded_manual]
    promote: manual
    version_cut: weekly
    rollback_owner: owner
overrides:
  untrusted_provenance: { min_approver: human }
  conflict_with_active: { escalate_tiers: 1 }
approval_routing:
  human_gated:
    - activation_into_context        # bundle/quarantine writes
    - ratified_surface_merge         # TASTE.md, roles.yaml, pipelines.yaml, prompts/**
    - tier: [T2, T3]
    - promotion_or_live_canary
  routine:                           # published without a human gate
    - ticket                         # deduped + rate-capped
    - proposal_draft                 # unmerged skill/protocol/eval/gate PRs
    - rejection_ledger
destinations:
  okf_concept: { publish: active_bundle_pr }
  skill_draft: { publish: proposal_pr }
  protocol_proposal: { publish: proposal_pr, human_ratified: true }
  eval_or_gate_proposal: { publish: implementation_ticket_or_pr }
  ticket:
    publish: github_issue
    dedupe_by: candidate_fingerprint
    max_open_per_app: 10
    max_new_per_week: 5
quarantine:
  max_ttl_days: 14
  author: human
  context_label: "UNVERIFIED - provisional"
  ttl_enforced_by: resolver
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
  shares:                            # per-scope budget shares (spec §8.1)
    org: 0.25
    role: 0.25
    app: 0.25
    app_role: 0.25
    redistribute_unused: narrowest_first
  eviction:
    order: [provisional_first, efficacy_asc, oldest_first]
    protected_tiers: [T2, T3]        # validated at publish time; fail loud at resolve
learning_budget:
  # Enforced as an overlay in the existing budget system; distiller, reviewer,
  # and replay turns settle into the org ledger like every provider turn.
  monthly_usd: 200
  per_candidate_replay_usd: 75
  max_repetitions_per_experiment: 5
  max_distillations_per_week: 7
  max_experiments_per_month: 4
  require_benefit_justification: true
distiller:
  # Operon's schedule grammar (src/org/schedule.ts) supports
  # hourly | every Nh/Nm | daily HH:MM | weekly <day> HH:MM — not cron.
  # These run as roles.yaml triggers through the launchd dispatch tick.
  schedule: "daily 06:00"
  precheck: deterministic            # no model turn on an empty evidence window
  evidence_window_days: 7
  min_cluster_events: 2              # one trusted human intervention is also actionable
  max_candidates_per_run: 5
  max_candidates_per_week: 20
reviewer:
  schedule: "weekly mon 07:00"
  max_candidates_per_run: 20
compaction:
  schedule: "weekly mon 07:00"
  report_only_v1: true
  deprecate_if:
    loads_zero_days: 45
    past_ttl: true
    superseded: true
```

As built, the loader (`src/org/learning/policy.ts`) reads the tier table
(canary fraction/window, experiment requirement, promote rules — and rejects
any policy granting T3 a canary block or a `live_canary` other than
`forbidden`), `learning_budget`, `quarantine`, `rejections`,
`reviewer_sla_hours`, `context_budget`, the `ticket` destination caps, and the
M6 distiller/reviewer/compaction schedules plus evidence-window and volume
controls. The remaining descriptive knobs (`version_cut`, `rollback_owner`,
`approver`, `overrides`, and `approval_routing`) are not executable policy;
version cuts happen per publish transaction, not on a schedule.

V1 uses low-volume thresholds. They are confidence aids, not mandatory sample
sizes for every promotion; insufficient volume resolves to `inconclusive` plus
human judgment, never permanent limbo.

## 14. Approval Binding and the Publish Transaction

Human approval binds immutable bytes (design §11.1). The approval item (a new
kind in the existing approvals store, `src/org/approvals.ts`) carries:

```json
{
  "approval_id": "appr_01JXYZ",
  "kind": "learning_publish",
  "candidate_hash": "sha256:...",
  "verdict_hash": "sha256:...",
  "destination": "okf_concept",
  "tier": "T1",
  "scope": "apps/operon-marketplace-demo/roles/support",
  "base_manifest_version": "2026.07.07-1",
  "final_diff_hash": "sha256:...",
  "waivers": [],
  "decided_by": "human-operator",
  "decided_at": "2026-07-09T06:00:00Z"
}
```

The deterministic publisher executes one atomic, idempotent transaction per
approval:

1. Verify every bound hash against current bytes; any mismatch voids the
   approval and the publish refuses.
2. Journal the intent (crash recovery replays or no-ops by `approval_id`).
3. Write artifacts to the destination; move the concept file
   `candidates/ -> bundle/` (or `quarantine/`) with `loop.status` updated.
4. Bump the manifest and append history with the `approval_ref`.
5. Write the `InterventionRecord`, emit `publish_committed`, mark the journal
   done.

The publisher is orchestrator code with no model in the loop, and the only
writer inside gate-protected learning paths.

## 15. Reviewer Verdict Schema

```json
{
  "candidate_id": "cand_20260707_01JDEF",
  "verdict": "approve",
  "proposed_destination": "ticket",
  "proposed_tier": "T1",
  "proposed_scope": "apps/operon-marketplace-demo",
  "experiment_required": false,
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

## 16. Internal Interfaces

These are internal Operon boundaries first, extraction candidates later.

```typescript
interface LearningEventSink {
  emit(event: LearningEvent): Promise<void>;
}

interface EpisodeProjector {
  project(): Promise<EpisodeRecord[]>;        // cursor-based, idempotent
  get(episodeId: string): Promise<EpisodeRecord>;
  recordLateOutcome(episodeId: string, outcome: LateOutcome): Promise<void>;
}

interface CapsuleBuilder {
  assemble(episodeId: string): Promise<ReplayCapsule>;   // deterministic
  classify(capsule: ReplayCapsule): Replayability;
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

interface Publisher {
  publish(approval: ApprovalBinding): Promise<InterventionRecord>;  // atomic, idempotent
}

interface ExperimentRunner {
  run(experiment: ExperimentRecord): Promise<EvalResult>;
}

interface LearningStore {
  openCandidate(candidate: CandidateArtifact): Promise<CandidateRef>;
  setConceptStatus(conceptId: string, status: ConceptStatus): Promise<PublishRef>;
  bundleAt(root: "org" | "app", version: string): Promise<Bundle>;
}

interface Resolver {
  resolve(input: { app: string; role: string; turnId: string; episodeId: string }): Promise<ResolvedLearningContext>;
  disable(conceptId: string): Promise<void>;
  rollback(root: "org" | "app"): Promise<void>;
}

interface LearningMetrics {
  record(event: LearningEvent): Promise<void>;
  recurrence(errorClass: string, version: string): Promise<RecurrenceStats>;
  efficacy(conceptId: string): Promise<EfficacyStats>;
  episodeOutcomes(filter: EpisodeFilter): Promise<OutcomeStats>;
  compactionCandidates(): Promise<ConceptRef[]>;
}
```

Implementation notes binding these interfaces to existing code:

- **Human approval** routes through the existing approvals store
  (`src/org/approvals.ts`: pending/decided/grants + `operon approvals`) as the
  `learning_publish` item kind (§14) — not a second inbox. Reviewer verdict
  JSON is stored under `learning/reviews/` as evidence; the decision lives in
  the one queue.
- **Episode projection** reads the M5 ticket state machine's process-owned
  state, `runs/<app>/<runId>/`, `telemetry/*.jsonl`, and the approvals store.
  It introduces no second ticket-state store (design §8.3).
- **Reviewer verdict parsing** reuses `parseWithRetry` and the native
  structured-output path in `src/loop/verdicts.ts`.
- **`ticket` destination** requires `createIssue` on `GhOps`/`GhCliOps`
  (`src/loop/github.ts` — landed). Publishes are deduped by candidate
  fingerprint and rate-capped per policy §13.
- **Distiller/reviewer** are `roles.yaml` entries with schedule triggers,
  executed by the normal turn runner (design §5). M6 lives in
  `src/org/learning/distillation.ts` plus the `learning-distill` and
  `learning-review` pipelines: deterministic prechecks gate provider turns,
  candidate/review writes route through the existing stores, and durable M6
  records carry skip/cap reasons. `operon learn review` remains the human
  review surface; scheduled reviewer verdicts use the same fail-closed schema
  and publisher flow.
- **Gate rules**: the full protected-path list in §1, same shape as
  `scorecard-tamper` in `src/runtime/gate.ts`, each with critical-side and
  routine near-miss test cases.
- **OKF validator**: extended per §3 with the round-trip preservation test.
- **Tests** reuse `test/fixtures/orgHome.ts` and `test/fixtures/fakeClock.ts`;
  no ad-hoc mkdtemp scaffolds.

CLI surface (as built it spans `src/cli/learn.ts`, `learn-activation.ts`, and
`learn-experiment.ts` + one registry line in `src/cli.ts`, per the
dispatch-table pattern):

```text
operon learn inspect <episode-id>       # full episode: turns, gates, artifacts, outcome
operon learn emit [--episode <id>]      # human observation (interactive or from file)
operon learn emit --late-outcome <kind> --ref <ref> --episode <id>
operon learn show <event|candidate|experiment|eval|intervention-id>
operon learn report [--json] [--refresh] # default read-only; --refresh projects first
operon learn fixture <episode-id> --set <scope>/<set> [--validate --by <name>]
operon learn review <candidate-id> --verdict <v> --rationale <text> --by <name>
operon learn publish <candidate-id> [--waiver <text>]
operon learn resolve --app <app> --role <role>
operon learn disable <concept-id>
operon learn rollback --root org|app [--app <name>]
operon learn provisional --scope <s> --name <n> --ttl-days N --by <name>
operon learn experiment declare|run|list
operon learn canary start|status|promote|stop
operon learn distill [--app <app>] [--dry-run]
```

## 17. Lifecycle

```text
captured events + episode projections
  -> candidate artifact (candidates/)
  -> reviewer verdict
  -> [experiment declared, when required]
  -> approval (routine destinations skip the human gate; §13 approval_routing)
  -> deterministic publish transaction (§14)
  -> version cut when destination is active OKF
  -> resolve into future turns (episode-sticky lineage)
  -> eval / canary report
  -> promote | extend | reject | rollback
  -> compact / deprecate / promote
```

Concept lifecycle (storage locations in §3):

```text
candidate -> active -> deprecated -> archived
candidate -> provisional -> active
candidate -> rejected -> rejection ledger
```

Version lifecycle:

```text
stable -> canary report -> human promote | extend | rollback
```

Claim lifecycle:

```text
authorized --(completed experiment with verdict improved)--> validated
authorized never upgrades silently
```

## 18. Metrics

Required V1 metrics:

- `concept_loaded` count per concept and bundle version.
- trusted recurrence rate by `error_class`, app, role, and bundle version.
- **episode outcomes by bundle lineage** (stable vs. canary): completion,
  merge/release disposition, review cycles, gate failures, human
  interventions, cost, late outcomes.
- experiment verdict distribution
  (`improved | regressed | inconclusive | not_evaluatable`).
- held-in eval pass/fail for concepts with `eval_ref`.
- held-out baseline pass/fail for role/app.
- context byte budget and eviction count.
- reviewer-human agreement.
- human agreement with canary recommendation.
- rejection ledger suppression hits.
- **cost per experiment and cost per accepted improvement** (learning-budget
  accountability, design §9.5).
- intervention lineage completeness (every active change has a full
  `InterventionRecord` chain).

Agent self-reports are excluded from recurrence, efficacy, and canary decisions.
