# Jobs — ratification proposal

*Proposal artifact, not documentation. TASTE.md §11 makes `docs/PURPOSE.md`,
`roles.yaml`, `TASTE.md`, `pipelines.yaml`, and `prompts/**` proposal-only
surfaces for agents, so the changes below are drafted here for Bikram to accept,
amend, or reject — they are deliberately **not** applied to those files. The
design they serve is [`design.md`](design.md). Once ratified, apply these edits
and delete this file.*

## What needs a decision, in dependency order

| # | Surface | Blocks | Decision needed |
| --- | --- | --- | --- |
| 1 | `docs/PURPOSE.md` → Decided | everything | Admit jobs as org work and a second entry point |
| 2 | `roles.yaml` | implementation | Define the `operator` role's authority ceiling |
| 3 | README → Observability | implementation | Admit `jobs/` to the state-home inventory |
| 4 | `AGENTS.md` | implementation | One repository-map row and one navigation line |
| 5 | `validation-design/` | detectors | Authorize `harness-revision` for two new journeys |

Items 3 and 4 are ordinary agent-editable surfaces — listed for completeness and
sequencing, not because they need ratification. Item 5 needs your authorization
because AGENTS.md forbids improvising a harness redesign.

---

## 1. Proposed `docs/PURPOSE.md` → Decided entry

Would take PURPOSE to **v2.16**. Proposed text:

> - **Jobs: the org runtime expresses non-product work through a second entry
>   point** (ratified YYYY-MM-DD). An organization does work that is not a
>   product: a strategy exercise, a cross-team synthesis, a one-off analysis.
>   Such work has a goal, a dependency order, intermediate artifacts, and a
>   human steering it, and it has no repository, ticket, or PR. Cormidia
>   admits it as **jobs** — named, dependency-ordered step graphs run once or on
>   demand, executed at most one step at a time, resumable across process death,
>   shipped as a separate `cormidia-job` binary in the same package. A job may
>   be app-scoped (evidence lands under that app) or unscoped in the active or
>   default org (evidence lands under the `adhoc` slot). This amends
>   "Cormidia is an installable package/runtime, not an app" only in entry-point
>   count, not in kind: the runtime still contains no app code, and "one runtime,
>   many apps" stands. Carve-outs, tighten-only: (1) *Jobs carry no verification
>   authority* — no independent review, no typed merit verdict, no ticket state
>   machine, and no GitHub interaction of any kind. A completed step means the
>   provider returned and the step's declared deterministic checks passed;
>   it never means the work is correct, and a job can never be a release or
>   deployment path. (2) *The gate still binds* — every job step passes the
>   critical-ops gate, so reduced verification never becomes reduced
>   containment. (3) *Spend stays truthful* — every job provider turn settles
>   into the org ledger exactly once under a separate budget envelope, and
>   `cormidia-job` invoked from inside a Cormidia turn is refused. (4) *No
>   learning input* — job output never feeds the distiller or becomes a
>   learning or calibration candidate; unreviewed prose must not become a
>   governed candidate. (5) *Authority is a role, not an assignment* — job steps
>   run as one generic non-product `operator` role that carries the authority
>   ceiling; a step may select an approved assignment and may never widen the
>   role. *Rationale:* the ad-hoc need is real and recurring, and the
>   alternative is not "users run governed work instead" — it is that the work
>   happens outside Cormidia entirely, unobserved and unbounded. Admitting it
>   under an explicitly weaker, explicitly contained contract keeps the evidence
>   and the gate while being honest that verification is absent. The separate
>   binary is the honest signal: two names, two promises.

**Points worth pushing back on before you sign:**

- Whether jobs belong in PURPOSE at all, or whether they are a tooling detail
  below its altitude. I think they belong, because a second binary changes what
  the product *is* — but that is a judgment call and it is yours.
- The on-ramp framing is deliberately absent from the entry. If you want
  "a job you run monthly is a conversation about whether it is an app" to be
  ratified product intent rather than documentation tone, it should be added.

## 2. Proposed `roles.yaml` addition

The open parameters are marked `DECIDE`. Nothing in the implementation may bind
to a guessed value.

```yaml
  operator:
    runtime: claude               # DECIDE: default harness for job steps
    model: claude-opus-4-8        # DECIDE
    effort: high                  # DECIDE
    max_turn_budget_usd: DECIDE   # per-step ceiling; defaults.max_turn_budget_usd
                                  # is $5, builder is raised to $50. A job step
                                  # doing real analysis over a large corpus sits
                                  # closer to builder than to the default.
    delegation:
      allow: DECIDE               # [] is the safe default. Anything else lets a
                                  # job step fan out, which multiplies spend
                                  # against a ceiling the config author never
                                  # sees. Recommend [] until evidence argues.
    triggers:
      - manual: true              # NOT negotiable: the scheduler must never
                                  # auto-fire a job. A job runs because a human
                                  # or a delegated harness ran the command.
    outputs: [job-step-artifacts]
```

**Recommendation.** `delegation.allow: []` and a per-step cap at or below
builder's `$50`. Both are tighten-only later; loosening after the fact requires
a fresh decision, which is the right asymmetry.

### Adaptive assignment — answered 2026-08-07

Bikram: support it if it does not cost meaningfully more work; users should be
able to name harness and model per step, and get a sensible default otherwise.

**The code is cheap; the provenance is the real cost.** Threading a per-step
tuple through is a handful of lines — `TurnRequest.assignment` already exists in
the runtime contract, and `getRuntime(assignment.harness)` already selects the
harness. Jobs do not go through `materializeEpisodePlanAssignments`, so there is
no episode-plan validation to satisfy either.

What is *not* free is the candidate list. `capability_ref` turns out to be
mechanical — `src/org/roles.ts:202` derives it as `<harness>/v1` for the
configured tuple, and the three valid values are `claude/v1`, `codex/v1`,
`pi/v1`. But `qualification_ref` is a genuine gate: AGENTS.md requires adapter
calibration to prove a tuple before it becomes a candidate, and the entire
ratified adaptive inventory in `roles.yaml` today is **one** tuple —
`pi / openai-codex/gpt-5.6-sol @ medium`, shared by `support` and `marketing`
under `campaign:candidate-qualification-v1-20260718-eb658f6309c9`.

So a full three-harness spread cannot be assembled from existing evidence.

### Superseded 2026-08-07 — jobs do not use `adaptive_assignments`

Bikram asked whether enforcing `qualification_ref` is generally necessary in
Cormidia. Checking the code answered it, and the answer changes this section.

**What the machinery actually enforces.** For a declared `adaptive_assignments`
entry, `src/org/roles.ts:359` makes `qualification_ref` **mandatory** and it must
match `campaign:<id>` or `qualification:<id>`; `capability_ref` must equal the
registered profile (`:354`); and a `conservative_estimate` may not exceed the
role's `max_turn_budget_usd` (`:365`). The `configured-role-assignment:<role>`
fallback at `src/org/episode-planner/policy.ts:102` applies only to the
configured fixed tuple, which has no candidate entry — not to declared
candidates.

**What that gate is protecting.** Adaptive assignment exists so an *agent or
planner* can choose a model at runtime. `qualification_ref` is what stops a
delegated chooser from silently picking a cheaper or unproven model for a role
whose output feeds merges, releases, and the learning loop. It protects a
**delegated** choice whose quality claim is inherited by a downstream consumer.

**Jobs make neither.** The human writes the tuple in the config file and reads
the output. There is no planner choosing, and no downstream consumer inheriting a
quality claim — the same structural reason F-PT-025 resolved to INV-016 being
delivery-scoped. Requiring a pre-ratified candidate list would also mean every
new model a user wants to try needs a `roles.yaml` ratification, which kills the
feature's main draw.

**Resolution: job step assignment is its own concept, not an
`adaptive_assignments` candidate.** `operator` declares no adaptive block. A job
step's assignment is validated against the two things that actually protect
something:

1. **Availability** — the harness genuinely serves the model
   (`modelServedByCatalog`, `src/runtime/model-catalog.ts`). Without this a
   week-long job dies mid-run on a typo.
2. **The role's per-turn ceiling** — `operator.max_turn_budget_usd` binds every
   step. Where a model has no pricing basis, the step is charged conservatively
   against the full ceiling rather than assumed cheap, so the cap stays honest.

Containment for jobs is the **budget plus the gate**, not the qualification list.
That is a deliberate, narrower grant: the user names the model and owns the
result, instead of the org pre-approving a set.

This removes the two `DECIDE` lookups below. The block is retained struck
through as the record of what was considered.

~~**Superseded proposal — reuse ratifications that already exist.**~~ `operator`'s
approved set is the union of tuples already human-ratified elsewhere in
`roles.yaml` (the configured tuples per `research/2026-07-15_model-assignment-
refresh.md`, plus the one qualified adaptive candidate). That creates no new
qualification evidence and no new pricing research, while still giving job
authors all three harnesses:

```yaml
    adaptive_assignments:
      # Each entry mirrors a tuple already ratified for another role; no new
      # calibration evidence is created here. Widen only with evidence.
      - id: claude-opus-4-8-xhigh-from-planner
        harness: claude
        model: claude-opus-4-8
        efforts: [high, xhigh]
        provider_family: anthropic
        capability_ref: claude/v1
        qualification_ref: DECIDE   # planner's ratification ref
        conservative_estimate: { max_turn_cost_usd: DECIDE, source: DECIDE }
      - id: codex-gpt-5.6-sol-high-from-builder
        harness: codex
        model: gpt-5.6-sol
        efforts: [medium, high]
        provider_family: openai
        capability_ref: codex/v1
        qualification_ref: DECIDE   # builder's ratification ref
        conservative_estimate: { max_turn_cost_usd: DECIDE, source: DECIDE }
      - id: pi-openai-gpt-5.6-sol-medium-qualified-20260718
        harness: pi
        model: openai-codex/gpt-5.6-sol
        efforts: [medium]
        provider_family: openai
        capability_ref: pi/v1
        qualification_ref: campaign:candidate-qualification-v1-20260718-eb658f6309c9
        conservative_estimate:
          max_turn_cost_usd: 5
          source: https://developers.openai.com/api/docs/pricing
```

Only the third entry is copied verbatim from an existing ratified block. The
first two need you to name the ratification reference and a pricing basis — that
is the residual human cost, and it is two lookups rather than two campaigns.

**Behavior for an unapproved tuple: reject loudly, never substitute.** A step
naming a tuple outside the approved set fails at config load, before any
provider turn, with an error listing what is approved. Silent downgrade to the
default would make the config lie about what ran, and the repo's house style is
to fail loudly rather than best-effort.

**Behavior when a step omits the assignment:** it runs the `operator` role's
configured tuple. That is the "we choose for them" path.

Availability is checked separately from approval at turn time —
`modelServedByCatalog` (`src/runtime/model-catalog.ts`) answers "does this
harness actually serve this model," which approval does not.

## 3. Proposed README → Observability addition

AGENTS.md names README → Observability the authoritative state-home inventory,
so the new tree is documented there in the same change that creates it:

```
jobs/<job-id>/
├── journal.json          # step events, config hash, terminal status — the
│                         # resume authority; never inferred from output files
└── config-snapshot.yaml  # the exact config the journal is bound to
```

Plus one sentence noting that per-step run records reuse the existing
`runs/<app|adhoc>/` shape with a `job-<job-id>-<step-id>` segment, so `observe`,
`report`, and `prune-runs` need no change.

## 4. Proposed `AGENTS.md` edits

One repository-map row:

| Path | What it is |
| --- | --- |
| `src/jobs/` · `docs/jobs/` | Ad-hoc dependency-ordered job graphs (`cormidia-job`) — non-product org work, explicitly outside the governed build loop |

One navigation line under Navigation:

> - Jobs (ad-hoc graphs, `cormidia-job`): `docs/jobs/design.md` — deliberately
>   carries no review, verdict, ticket, or GitHub authority; §3 is the
>   non-inherited-guarantee list

That is the whole agent-facing footprint. A single row and a single line, both
of which say "not the build loop" in their own text, is what keeps this from
competing for an agent's attention with governed work.

## 5. Authorization needed: harness revision

`docs/jobs/design.md` §14 defines two new journeys (J-JOB-1 app-scoped
recurring, J-JOB-2 unscoped one-off) and at least one new boundary (the job
config/journal contract). AGENTS.md → Validation harness is explicit that new
journeys, boundaries, or invariants are a **structural** change requiring
re-entry into the `validation-harness-design` skill in `harness-revision` mode
with the existing `validation-design/` artifacts as baseline — and that
improvising a redesign or piling cases onto a wrong shape is forbidden.

**Authorized by Bikram 2026-08-07.** The revision will propose edits to
`validation-policy.yaml` (tighten-only), `case-catalog.md`, `boundary-map.md`,
and `system-map.md` — ratified artifacts, so its output is itself a proposal for
review, not a landed change.

Until that revision lands, §14's acceptance criteria are **design input only**.
They are not catalog rows and must not be represented as harness coverage.

**This blocks more than I first thought.** `tests/README.md` is binding that
"case families live in specs named for their catalog IDs" and that every
`describe` block opens with the family ID so traceability is greppable both
ways. There is no sanctioned place to put a test for new behavior that has no
catalog family. Combined with TASTE.md §4 ("new behavior ships with a test that
fails without it") and AGENTS.md's detector obligation, that means the harness
revision gates **all** job implementation, not just the two journey lanes — I
cannot land even the pure config loader with a test, and landing it without one
would violate a working rule to buy a few hours.

I would rather stop here than route around that. Item 5 is therefore
**blocking**, and it is the fastest thing on this page to unblock: it needs one
"go ahead" from you, after which the revision proposes catalog rows for your
review and implementation proceeds normally.

## What I need from you

~~1. **Item 5 authorization**~~ — **granted 2026-08-07.** Harness revision is
   authorized and in progress.

Blocking (I stop without these):

2. **Item 2, reduced** — the `operator` role's four base fields only
   (`runtime`/`model`/`effort` for the default tuple, and
   `max_turn_budget_usd`), plus `delegation.allow`. The `qualification_ref` and
   pricing lookups are **gone** — jobs no longer declare adaptive candidates
   (see the 2026-08-07 supersession above). Recommended: `delegation.allow: []`
   and a ceiling at or below builder's $50, both tighten-only later.
3. **Item 1** — the PURPOSE entry, accepted, amended, or rejected. Nothing
   user-facing ships without it, though the deterministic core can be built
   while it is pending.

Non-blocking (I will proceed and you can correct):

4. The binary name. `cormidia-job` is the working name; say the word and it
   changes.
5. Items 3 and 4 — the README inventory line and the AGENTS.md rows. Ordinary
   agent-editable surfaces; I will land them alongside the code.

With items 5 and 2 answered I can build and test the deterministic core —
config loader, journal with resume, output checks, brief assembly — which is the
bulk of the runner and needs nothing from item 1 to be correct.

**One finding worth your attention regardless of what you decide here.**
`scripts/check-import-direction.mjs` ranks only `runtime`/`loop`/`org` and
silently skips any source directory absent from that map. Any future top-level
`src/<new>/` is therefore exempt from the one-way import rule with `pnpm check`
still green. Jobs would have been the first such directory. I have recorded the
required rank-3 entry in `design.md` §12, but the underlying gap — a
fail-*open* architectural gate — is worth a ticket on its own merits and is
independent of this proposal.
