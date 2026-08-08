# S-11 Acceptance grader (L-ACC) meta-eval — STATUS: SEEDED CONTROL ONLY
Added at the 2026-08-07 outcome-acceptance harness revision. **No campaign has run**, so
nothing here may support a model-swap, qualification, or release claim. This directory
exists before the first campaign on purpose: standing rule 3 — golden sets are committed
before tuning, or the grader is tuned to its own result.

`cases.json` currently holds exactly the **required first case** described below: the
seeded fabricated claim, plus a supported control and an uncited control in the same PR
body. It was authored at HB-129, before any campaign and before any grader prompt
tuning. The deterministic half of the O-5 detector is exercised against it by
[`tests/hermetic/cf-s11-env/`](../../../tests/hermetic/cf-s11-env/cf-s11-env-grader-envelope.test.ts),
red-then-green. The quality (L4) meta-eval over real grader output remains **unbuilt**,
and the adjacent controls listed at the end of this file remain **unauthored**.

Rubric: **`acceptance/rubric.md`, human-ratified 2026-08-07, tighten-only.** It is the
source of the axes (P-1…P-6 plan, O-1…O-7 outcome, J-1…J-3 job) and of the scoring
procedure. This scaffold never restates an axis — it points at the ratified file, so the
two cannot drift.

Threshold + N + sample design: **NONE IN v0, by ratified rubric §5** — there is no
observed distribution yet, so any number would be invented. This is a **ratified
deferral, not an open finding**: no F-PT id is minted for it, and no threshold may be
introduced here. Run 1 executes in data-collection mode, every threshold-dependent axis
reports `inconclusive`, and the human ratifies thresholds from run 1's observed data.

Cadence: per authorized L-ACC campaign only; also on grader prompt/model/rubric change.
L-ACC is never scheduled and never casual (`risk-allocation.md` §5a).

Qualifying tuple dimensions: (graded scenario × graded axis) × (grader harness/model/
effort), with the **per-axis provider-disjointness set actually applied** recorded
alongside each result (B-29 §2). Never pooled across axes — an axis graded by a
correlated provider is `ungraded`, not a weaker number.

Mechanically graded, never model-graded, and therefore **out of this set**: P-2/P-3/P-4
coverage against the sealed key, plus **J-1** (declared outputs exist and pass their
declared checks) and **J-2** (handoff fidelity). Those are set comparisons and file
checks under `CORMIDIA-C-B28-001`/`-B30-003`. Putting them here would be strictly worse
and would leave S-ACC-3 ungradeable.

Case schema: `{id, axis, scenario ref, evidence-set manifest (what the grader may read),
withheld manifest (what it may not — see B-28), ground truth or reference result,
expected outcome incl. the legal `ungraded` outcomes, provenance (author, date, source
campaign if any), never derived from archive-do-not-read/**}`.

**Required first case — the negative control, before any grader result is trusted.**
An artifact set plus a PR body asserting something the artifacts do not support. The O-5
fabrication detector must land **red** against it (rubric §7 rule 4; standing rule 4).
An unsupported-claim detector that has never caught an unsupported claim makes silence
look like evidence, which is the exact failure this whole lane exists to find.

Adjacent controls this set should carry as it populates: a citation-less score (must be
discarded → `ungraded`, never retained as a number); a result citing an artifact absent
from the declared read set; an axis with no legal disjoint grader (must report
`ungraded`, never be graded anyway); a scenario where every axis is `ungraded` (must not
render as a `0` score).
