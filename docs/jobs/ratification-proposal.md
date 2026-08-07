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

**Question for you.** Should `operator` declare `adaptive_assignments` so a job
config can select among approved harness/model tuples per step? Per-step model
heterogeneity is the feature's main draw, and without approved candidates every
step runs the one configured tuple. If yes, the candidate list needs the same
`capability_ref`/`qualification_ref`/`pricing` provenance every other adaptive
candidate carries — which means it cannot be assembled without your ratification
of which tuples are approved for non-product work.

This is the single most load-bearing open item. §4 and §5 of the design both
depend on it, and I would rather stop here than guess it.

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

The skill is available in this environment. I need your go-ahead to run it,
because it will propose edits to `validation-policy.yaml` (tighten-only),
`case-catalog.md`, `boundary-map.md`, and `system-map.md` — ratified artifacts.

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

Blocking (I stop without these):

1. **Item 5 authorization** — one "go ahead" to run
   `validation-harness-design` in `harness-revision` mode. Cheapest to give,
   and it gates all implementation for the reason above. Start here.
2. **Item 2** — the `operator` role's four `DECIDE` values, and the
   `adaptive_assignments` question. Implementation binds to these and I will
   not guess a budget ceiling or a delegation policy.
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
