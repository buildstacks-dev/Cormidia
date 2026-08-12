# Proposed 2026-08-07 routing addendum (L-ACC + jobs) — parked, NOT yet binding

<!-- Parked verbatim by the #402 restructure (2026-08-11) from AGENTS.md lines
686-742 at commit fa86238. AGENTS.md is human-ratified, so this remains a
proposal with rationale until the owner ratifies the exact diff. Never
represent this as landed policy.
verbatim-below -->

## Proposed 2026-08-07 routing addendum — outcome acceptance (L-ACC) + jobs

AGENTS.md is a human-ratified surface, so this is a **proposal with rationale**, not a
landed edit. It is deliberately short: the ratified section above already carries the
standing rules, and this only routes an agent to the two things that are new.

> **Jobs (M18).** Work on `src/jobs/` or the `cormidia-job` binary starts at J-22/J-23,
> `CORMIDIA-C-B30-001…003` and `CORMIDIA-C-OPJOB-001`. `docs/jobs/design.md` §3 is the
> non-inherited-guarantee list and is never softened: a job has no reviewer, no typed
> verdicts, no ticket machine and no GitHub. "Completed" for a job step means the
> provider returned **and** every declared output check passed; a step with no declared
> outputs is `completed (unverified)`, never bare `completed`. The journal is the sole
> completion authority — never infer completion from an output file's presence. A config
> that changed under a live journal refuses; it never resumes. INV-016 is
> **delivery-scoped** and does not reach a job step (F-PT-031); that is the invariant's
> domain being written down, not an exemption, and it is not a licence to skip the
> declared checks.
>
> **The outcome-acceptance lane (L-ACC).** It is **built and has run once**: HB-120…132
> implemented the guardrails, runner and execution layer, and run 1 reached a terminal
> stop at the unchanged rubric §6 plan gate on 2026-08-08 with an entirely
> ungraded/inconclusive distribution (`acceptance/run-1-result.md`). Do not cite it as
> a gate or as release evidence — F-PT-029 (resolved 2026-08-07) keeps it permanently
> outside RQ-1 — and never start a new campaign without an exact per-campaign human
> authorization; F-PT-030 (resolved 2026-08-07) permits unattended plan-gate
> resolution only through a config's declared `plan_gate` policy under the unchanged
> criteria, and an undeclared policy refuses.
> 
> `acceptance/rubric.md` is human-ratified and **tighten-only**: you may narrow an axis or
> a rule, never loosen one, and **you may not introduce a threshold anywhere** — every
> threshold stays unratified until a campaign produces a **graded** distribution the
> owner can ratify against. (Run 1 terminated at the plan gate entirely ungraded, so
> that condition remains unmet: the trigger is the first graded run, not "run 1" by
> number.) If a change
> seems to require loosening the rubric, stop and escalate rather than editing it.
>
> Two rules carry the whole lane and are easy to get wrong. **All campaign work runs
> through the PACKAGED `cormidia` and `cormidia-job` binaries** (`pnpm install:packaged
> --replace-source-links`; assert its exit status, never reimplement its checks) — a
> `link:local` binary is source-backed and measures the working tree, not the product.
> **And the supervisor never does the work**: an agent that runs `git`/`gh` itself, edits
> a scenario repo, or calls a provider SDK is simulating the org, and every score then
> measures the supervisor. Both are `CORMIDIA-INV-ACC-7a/7b`.
>
> Campaign invariants live in their own fenced registry (`CORMIDIA-INV-ACC-*`,
> `validation-policy.yaml` → `campaign_invariants`). They constrain the harness, never
> the product — never cite one as a product promise. All eight are mechanical guardrails
> at L1/L2 with negative controls; only the rubric's scored axes are lane work.
> `ungraded` is policy, not runner discretion (`verdict_semantics.axis_score`): it is
> never coerced to `0` and never enters an aggregate as a number.

**Rationale for landing it.** Without this addendum a coding agent reaching `src/jobs/`
has no route to B-30, and an agent reading `acceptance/` could reasonably conclude the
lane exists. Both are exactly the failure the routing deliverable exists to prevent.

---

