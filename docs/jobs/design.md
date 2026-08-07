# Jobs — ad-hoc dependency-ordered work

*The authoritative contract for Cormidia **jobs**: named, dependency-ordered,
long-running work that an organization runs once or on demand, outside the
ticket/PR/GitHub product lifecycle. **Status: PROPOSED, not ratified.** This
document is the design record for review; the `docs/PURPOSE.md` → Decided entry
that admits a second Cormidia entry point, and the `roles.yaml` `operator` role
this contract depends on, are proposal-only surfaces (TASTE.md §11) awaiting
human ratification. Until both ratify, do not represent jobs as a shipped
capability, and do not describe `cormidia-job` in README → Commands. The system
map is [`../architecture.md`](../architecture.md); the build loop this
deliberately is not is [`../loop/design.md`](../loop/design.md).*

## 1. Why this exists

An organization does more than build products. A board meeting gets scheduled, a
CEO opens a strategy exercise, it cascades to teams, each team produces an
update, the updates get synthesized upward. That work has a goal, a dependency
structure, intermediate artifacts, and a human steering it — and it is
emphatically not an app. Nobody would create a product repository for it.

Cormidia today can express only product work: a ticket, in a repo, through
GitHub, to a merged PR. The org runtime has no way to say "run these eleven
steps in this order, some on Opus and some on gpt-5.6, over the next six days,
and let me read the output at step four before you continue."

Jobs are that missing shape. They are org work, not an escape hatch from
governance, and the distinction matters for every decision below.

The second motivation is convenience, and it is not lesser. A great many useful
one-off jobs are worth running exactly once. Requiring app onboarding first
would mean they never get run. A job must be runnable by someone who knows
nothing about Cormidia's ticket lifecycle, episodes, pipelines, or approvals —
one config file and one command.

## 2. What a job is

A **job** is a named set of **steps** with declared dependencies, executed in
dependency order, at most one step at a time, resumable across process death,
producing file artifacts that downstream steps consume.

A job may be **app-scoped** or **unscoped**:

- **App-scoped** — the job names an onboarded app. Its run records land under
  that app's observability tree, so an operator reading the app's history sees
  the job alongside its product work. Use this when the job is about the app: a
  recurring competitive refresh, a dependency audit, a docs sweep.
- **Unscoped** — the job names no app and runs in the active org (which may be
  the default org created at install). Run records land under the `adhoc`
  observability slot. Use this for the strategy exercise: work the org does that
  belongs to no product.

Both are org work and both are observable. The only difference is which tree
holds the evidence.

## 3. What a job is not

A job does **not** inherit the build loop's verification guarantees, and this
list is the contract's most important section. State it in the skill, state it
in the README, do not soften it.

| Not provided | Why |
| --- | --- |
| Independent review | There is no Reviewer pass. Nothing adversarially reads a step's output. The builder ≠ reviewer cross-provider pairing that `roles.yaml` encodes does not apply. |
| Typed merit verdicts | Steps do not emit `src/loop/verdicts.ts` verdicts. A completed step means the provider returned and the declared mechanical checks passed — not that the work is correct. |
| Ticket state machine | No claim, no branch, no PR, no merge, no remediation path. A failed step stops the job. |
| GitHub anything | Jobs never open issues, push branches, or create PRs. A job that needs a PR is a ticket, not a job. |
| Learning-loop input | See §10. Deliberately excluded, fail-closed. |
| Release authority | A job can never be a release path. Release remains `docs/approvals/design.md`. |

What a job **does** inherit, because it runs on the same runtime layer:

- The critical-ops gate (`src/runtime/gate.ts`). No job step performs an
  irreversible or outward-facing action without the same human approval the
  build loop requires. This is non-negotiable and is what makes the reduced
  verification above acceptable: an unverified job is still a *bounded* job.
- Normalized usage, cost, and cancellation across all three adapters.
- Per-turn budget ceilings and ledger settlement (§9).
- The org's authority context (`.cormidia/AUTHORITY.md`) and TASTE layers.

## 4. Authority: the `operator` role

**The problem.** `PURPOSE.md` non-negotiable #2 requires that role
responsibility and execution assignment stay separate, and that an assignment
never broadens a role's authority. A step that named only a
harness/model/effort tuple would be a provider turn with an assignment and no
responsibility — the first place in Cormidia where nothing bounds a turn's
delegation, permission mode, or per-turn spend.

**The non-solution.** Steps must not name product roles. Every role in
`roles.yaml` is a product function (planner, builder, reviewer, sre, support,
marketing, distiller, learning reviewer). A strategy synthesis maps to none of
them, and `roles.yaml` is a human-ratified surface that must not accumulate
non-product vocabulary.

**The contract.** Every job step runs as a single generic non-product role,
`operator`, defined once in `roles.yaml`. The role carries the authority
ceiling: `delegation.allow`, `maxTurnBudgetUsd`, `permissionModes`,
`turnExecutionLimits`. A step config may select an **assignment** (harness,
model, effort); it may never widen the role's authority. This is exactly the
existing separation, applied to a role whose responsibility is "carry out one
bounded step of an operator-defined job."

Note the asymmetry that makes this safe: **the assignment is free, the authority
is not.** A step may name any model its harness serves, because choosing a model
cannot widen what the turn is permitted to do — permission lives entirely in the
role. See §5 for why this deliberately does not route through
`adaptive_assignments`.

`operator` declares `triggers: [{ manual: true }]`. The scheduler must never
auto-fire it — a job starts because a human or a delegated harness ran the
command, never because a schedule elapsed.

> **Ratification required.** Adding `operator` to `roles.yaml` is a proposal,
> not an autonomous change. The role's default assignment, budget cap, and
> delegation policy need Bikram's decision before implementation binds to them.

## 5. The job config

One YAML file, committed in the **user's own repository**, not hidden in the
state home. Ad-hoc by intent, versionable by accident: a job worth running twice
becomes a reviewable file, and a job worth running monthly becomes the
conversation about whether it is an app.

```yaml
job: q3-strategy-cascade          # stable id; identifies the journal and runs
app: null                          # or an onboarded app name for app-scoping
description: >
  Board strategy exercise: per-team updates synthesized into one brief.

steps:
  - id: frame
    objective: |
      Read board-inputs/ and produce the framing questions each team must
      answer. Write them to outputs/framing.md.
    assignment: { harness: claude, model: claude-opus-4-8, effort: xhigh }
    outputs:
      - path: outputs/framing.md
        check: non_empty

  - id: team-platform
    dependsOn: [frame]
    objective: |
      Answer the framing questions for the Platform team from platform/.
    assignment: { harness: codex, model: gpt-5.6-sol, effort: high }
    outputs:
      - path: outputs/platform.md
        check: non_empty

  - id: checkpoint-review
    dependsOn: [team-platform, team-growth]
    checkpoint:
      prompt: Read the team updates before synthesis proceeds.

  - id: synthesize
    dependsOn: [checkpoint-review]
    objective: Produce the board brief from the team updates.
    assignment: { harness: claude, model: claude-opus-4-8, effort: max }
    outputs:
      - path: outputs/board-brief.md
        check: non_empty
```

Field contract:

- `id` — unique within the job; path-safe; identifies the step in the journal.
- `objective` — the step's prompt. Required for provider steps.
- `dependsOn` — step ids. Absent means the step is a root. Cycles are a load
  error, not a runtime failure.
- `assignment` — optional; defaults to the `operator` role's configured tuple.
  **Not** an `adaptive_assignments` candidate (decided 2026-08-07): that
  machinery guards a *delegated* model choice whose quality claim a downstream
  consumer inherits, and a job has neither — the human writes the tuple and reads
  the output. A step's assignment is validated against two things instead:
  the harness genuinely serves the model (`modelServedByCatalog`), and the
  `operator` role's per-turn ceiling. A model with no pricing basis is charged
  conservatively against the full ceiling rather than assumed cheap, so the cap
  stays honest. Containment for jobs is the budget plus the gate, not a
  pre-ratified candidate list.
- `outputs` — declared artifacts with mechanical checks (§7).
- `checkpoint` — makes this a human checkpoint step (§8). Mutually exclusive
  with `objective` and `assignment`.

The loader validates structure, id uniqueness, dependency resolution, acyclicity,
and assignment admissibility **before** constructing any runtime. A config error
must never cost a provider turn.

## 6. Execution semantics

Dependency ordering reuses `selectReadyEpisodeSteps`
([`../../src/loop/episode-plan.ts`](../../src/loop/episode-plan.ts)) — a pure
function over steps, completed ids, and in-flight ids. No new scheduler.

**One step at a time.** Ready steps execute sequentially, ordered by id for
determinism. The DAG buys ordering and resumability, not concurrency. This is
deliberate: a week-long job's failure modes are far easier to reason about
serially, and parallel provider turns multiply the ways a budget ceiling gets
crossed. Concurrency is a later decision with its own evidence, not a launch
feature.

**Resume.** A journal at `jobs/<job-id>/journal.json` records step start and
terminal events. Re-running the command resumes: completed steps are never
re-executed, and an interrupted step — one whose latest event is `started`,
meaning the process died between the durable start and the terminal event — is
retried **at most once**. Nothing is inferred from the presence of an output
file; the journal is the authority, because a half-written file is
indistinguishable from a complete one.

Every provider turn, recovery included, gets its **own** start event and its own
settlement identity (`job:<job>:<step>:<n>` where n counts start events).
Reusing the interrupted attempt's identity would look tidier and is wrong twice
over: the count of start events is the only thing bounding the retry, and a
recovery runs a *genuinely new paid turn* whose settlement would be deduped by
`recordTurnOnce` — silently under-counting spend, which is the dangerous
direction for T-5 (INV-006). Recorded here because the first implementation got
this wrong and `CF-B23-JRN` caught it.

**Failure is terminal for the job, not silent.** A failed step stops the job and
reports which step failed, why, and what the executable next step is. Downstream
steps do not run. This mirrors `executePipeline`'s stage semantics
([`../../src/loop/pipeline.ts`](../../src/loop/pipeline.ts)) and VISION's "one
truthful terminal outcome."

**Config changes mid-job.** A job whose config changed after steps completed
must fail closed rather than resume against a different graph. The journal binds
the config hash; a mismatch is an explicit error naming the drift, with the
options being a new job id or an explicit reset.

## 7. Output handoff and mechanical checks

**Handoff.** Each step's prompt is assembled as: the step's `objective`, plus
the resolved content of every dependency's declared outputs, under an explicit
heading. This is the pattern already proven three times in `src/org/` — see
`renderPlanningProviderBrief`
([`../../src/org/plan-auto.ts`](../../src/org/plan-auto.ts)) — factored once
here instead of a fourth time. Files are read from the job's working directory
at step start, so a step sees what is actually on disk, not a cached copy.

**Checks are the substitute for a reviewer.** A week-long job will have a step
that does not fail — it returns confident prose the next step cannot use.
Without a check, steps four through nine build on it and the operator finds out
on day six. `PURPOSE.md` non-negotiable #1 applies: if it can be code, it is
code.

Declared checks, all deterministic, all fail-closed:

| Check | Passes when |
| --- | --- |
| `exists` | the path exists |
| `non_empty` | exists and has non-whitespace content |
| `json` | exists and parses as JSON |
| `schema: <path>` | parses and validates against the named JSON schema |
| `command: <cmd>` | the command exits zero in the job working directory |

A step with declared outputs whose checks do not pass is **failed**, not
completed, regardless of what the provider reported. A step with no declared
outputs completes on provider completion alone — permitted, and the loader warns
that the step is unverified.

## 8. Human checkpoints

A `checkpoint` step pauses the job and surfaces the declared prompt plus the
paths of its dependencies' outputs. The job resumes only when the human decides.

This is a usability requirement, not a governance one, and it is what separates
a steered exercise from a script that ran for a week. The board-strategy case
contains it natively: a CEO reads the team updates and redirects before
synthesis. Checkpoints reuse the approvals store
([`../approvals/design.md`](../approvals/design.md)) so a waiting job appears in
the same queue the operator already reads, rather than inventing a second place
to look.

A checkpoint is not an approval of anything. It grants no authority and cannot
substitute for a critical-op approval — a job step that trips the gate still
raises its own gated item independently.

## 9. Budget and telemetry

Job provider turns settle into the org ledger, `telemetry/<date>.jsonl`, exactly
once per turn, on the same terms as every other Cormidia turn: failed, blocked,
and cancelled invocations consume budget too
([`../../src/loop/pipeline.ts`](../../src/loop/pipeline.ts) documents the
exactly-once settlement contract). A parallel spend path that bypassed the
ledger would make the org's budget view false — an operator would see app spend
and silently miss a week of job runs.

Settled rows carry a distinct job attribution and roll up under a **separate
budget envelope**. Unified observability, separated budgets: an operator sees
all spend in one place, and a job can never silently consume an app's allowance.

**Nested invocation fails closed.** `cormidia-job` invoked from inside a
Cormidia provider turn is refused. Otherwise a Builder turn could spawn job
turns that escape its episode budget and its route bounds. The gate already
classifies Cormidia's own command line as an effect surface
([`../approvals/design.md`](../approvals/design.md)); `cormidia-job` joins that
classification rather than sitting outside it.

## 10. No learning-loop input, deliberately

Job runs never feed the distiller or become learning candidates.

The reason is not that learning does not apply — it is that learning **must
not** apply. Job steps have no reviewer, no typed verdict, and no evidence
discipline. Admitting them would let ungoverned prose become governed
candidates, which is precisely the contamination the learning loop's cross-
provider review exists to prevent
([`../learning-loop/`](../learning-loop/)).

This is a decision with a rationale, recorded here so that a later reader does
not mistake it for an oversight and helpfully wire it up.

Adapter cost and reliability facts observed during job runs are also **not**
promoted to calibration evidence. Calibration remains
`docs/harness/qualification-evidence.md`, proven deliberately.

## 11. State and observability

Jobs add one tree to the state-home inventory (README → Observability is
authoritative for that inventory and must be updated in the same change):

```
jobs/<job-id>/
├── journal.json          # step events, config hash, terminal status
└── config-snapshot.yaml  # the exact config the journal is bound to
```

Per-step run records reuse the **existing** `runs/` shape unchanged, so
`cormidia observe`, `report`, and `prune-runs` work with no modification:

```
runs/<app|adhoc>/<YYYYMMDD-HHMMSS>-job-<job-id>-<step-id>/
├── envelope.json   ├── events.jsonl   ├── brief.md   ├── output.md
```

`runs/adhoc/` is the unscoped slot, and it is not new — `runRole` already
defaults its runlog app to `adhoc`
([`../../src/loop/runRole.ts`](../../src/loop/runRole.ts)).

**One canonical location per job.** An app-scoped job's records live under
`runs/<app>/` and nowhere else; an unscoped job's live under `runs/adhoc/` and
nowhere else. The journal records which. Records must never be discoverable in
two places, or `observe` has to search both and operators will not know where to
look.

Artifacts (the `outputs` files) live in the user's working directory, not the
state home. They are the job's product; the operator owns them, keeps them,
commits them, or throws them away.

## 12. Shipping shape

A **second binary in the same package**: `cormidia-job`.

Not a `cormidia` subcommand. `src/cli/` makes a subcommand the cheapest possible
landing, and that is the trap — a subcommand of `cormidia` reads as part of the
governed org runtime and imports every guarantee §3 explicitly withholds.
`PURPOSE.md` states the CLI "is pointed at org configuration and target repos";
a job runner pointed at a working directory is a different contract and needs a
different name.

Not a separate npm package. That would duplicate the runtime layer or require a
workspace (the repo is deliberately not one), and open a second release lane to
govern. Not until demand is proven.

Mechanically: a launcher shim beside `src/cormidia.cjs` pointing at
`dist/job-cli.js`, one `bin` entry, one `files` entry. The shared `src/runtime/`
dependency is already in the tree.

**Import direction needs one script change, and there is a trap.**
`scripts/check-import-direction.mjs` ranks only `runtime`=0, `loop`=1, `org`=2,
and **silently skips any source layer absent from that map**
(`if (sourceRank === undefined) continue;`). A new `src/jobs/` would therefore be
entirely unchecked — free to import anything, with `pnpm check` still green.

`jobs` must be added to the map at **rank 3**, above `org`. That makes
`jobs → org → loop → runtime` legal and `org → jobs` a build failure, which is
the right asymmetry: jobs may read org config and the app registry, and nothing
in the governed loop may ever depend on jobs. The boundary this document asserts
in prose becomes an enforced invariant rather than a convention.

Land the map entry in the same change as the first `src/jobs/` file, not before —
a rank for a directory that does not exist is speculative.

## 13. Reused vs. new

| Reused as-is | New |
| --- | --- |
| `getRuntime`, `Runtime.runTurn` | `job.yaml` loader and validator |
| `defaultGate` critical-ops gate | Job journal with config-hash binding |
| `selectReadyEpisodeSteps` ordering | Output-handoff brief assembly (factored from `plan-auto.ts`) |
| `runs/` record shape and writers | Mechanical output checks |
| Telemetry ledger settlement | Checkpoint integration with the approvals store |
| Approvals store | `cormidia-job` binary and shim |
| Authority + TASTE context assembly | `operator` role (proposal) |

Deliberately **not** reused: `executeEpisodePlan` and `persistEpisodePlan`. The
DAG executor is excellent and its handler seam is genuinely generic, but entry
requires a full `EpisodeIntent` — mandatory `app`, `lifecycle`, `appStage`,
`availableRoles`, `allowedAssignments`, `hardBudget`, `requiredSafetyFacts`,
with hash binding and validation designed to reject placeholders. Every one of
those fields would be a fabrication for an unscoped job, and the coupling would
bind jobs permanently to episode vocabulary. `selectReadyEpisodeSteps` gives us
the scheduling logic without the ceremony.

## 14. Validation

Two journeys. Both must be falsifiable offline; per the standing rule, the
cheapest layer that can falsify a case owns it.

### J-JOB-1 — recurring app-scoped job

A job named against an onboarded app, run repeatedly over time.

Acceptance criteria:

1. Run records land under `runs/<app>/` and nowhere else; `cormidia observe` for
   that app surfaces them with no code change.
2. Provider turns settle exactly one ledger row each, attributed to the job and
   counted against the job budget envelope, not the app's.
3. A second run of the same job id with an unchanged config resumes: completed
   steps are not re-executed and cost zero additional turns.
4. A second run whose config changed fails closed, naming the drift, without
   executing any step.
5. A step whose declared output check fails is recorded `failed`; downstream
   steps do not execute.
6. A step that trips the critical-ops gate raises its own gated item and does
   not proceed.

### J-JOB-2 — one-off unscoped job in the default org

The convenience path: a fresh install, the default org, no app, no Cormidia
knowledge. One config file, one command, artifacts produced, job definition
discarded afterward.

Acceptance criteria:

1. The job runs with **no** app registered and no `apps.yaml` entry required.
2. Run records land under `runs/adhoc/` and are discoverable there.
3. Failure messages never require ticket, episode, pipeline, or app vocabulary
   to act on.
4. A dependency's outputs appear in the downstream step's brief verbatim, proven
   by reading the persisted `brief.md`.
5. A checkpoint step parks the job, appears in the approvals queue, and resumes
   on decision without re-executing completed steps.
6. Deleting the job config after completion leaves artifacts and run records
   intact and readable.

### Detectors and negative controls

Every fail-closed path above lands red-then-green against a seeded violation: a
cyclic config, a drifted config hash, an empty declared output, a nested
invocation, a job step attempting a gated op, a ledger double-settle. A detector
that has never fired is an assumption.

### Not covered: real-token validation and outcome measurement

Everything above is offline and structural. It proves the *machinery* — ordering,
resume, refusal, settlement, handoff — and proves nothing about whether a job's
output was any good.

Outcome quality is deliberately outside these families, twice over. The
statistical lane is excluded by design (§5 of the harness revision: the prompt is
the operator's, so Cormidia cannot own a golden set for it), and real-token
execution against real apps is a **separate authorized campaign** under
`validation-policy.yaml` spend bounds — AGENTS.md is explicit that token-spending
runs are never casual.

Named here so its absence is visible rather than assumed:

- **L-JOB-LIVE (not run).** Real apps, real tokens, real provider variance, with
  outcome measurement per job shape. Needs a human-authored measurement rubric
  before it means anything, because "did the board brief land" is not a
  deterministic assertion. Requires explicit human authorization per campaign.

Until that campaign runs and its evidence is dispositioned, jobs are
**build-complete and offline-proven, not outcome-validated.** Do not represent
the examples in `examples/jobs/` as evidence of outcome quality.

> **Structural boundary.** J-JOB-1 and J-JOB-2 are *new journeys*, and jobs
> introduce at least one new boundary (the job config/journal contract). Per
> AGENTS.md → Validation harness, that is a structural change requiring re-entry
> into the `validation-harness-design` skill in `harness-revision` mode with the
> existing `validation-design/` artifacts as baseline — not case-level additions
> against existing structure. The criteria above are the *design* input to that
> revision. They are not yet catalog rows, and this section must not be read as
> claiming harness coverage exists.

## 15. Open decisions for the human

1. **`operator` role definition** — default assignment, `maxTurnBudgetUsd`,
   `delegation.allow`, permission modes. §4 depends on it.
2. **Job budget envelope size** — the separate allowance in §9, and whether it
   is per-org or per-job.
3. **Binary name** — `cormidia-job` is the working name.
4. **PURPOSE entry** — a second entry point modifies ratified framing
   ("Cormidia is an installable package/runtime, not an app"; "one runtime, many
   apps"). §12 needs that entry before implementation lands.

## 16. Non-goals

- Concurrent step execution (§6).
- Any GitHub interaction (§3).
- Automatic scheduling of jobs (§4 — `manual` trigger only).
- A job becoming a release or deployment path (§3).
- Cross-job dependencies. A job is self-contained; composition is a later
  question with its own evidence.
