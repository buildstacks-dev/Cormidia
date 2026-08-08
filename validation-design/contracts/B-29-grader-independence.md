# Boundary contract — B-29 (graded evidence set ↔ grader turn)
Canonical ID: **CORMIDIA-C-B29-001 (alias: B-29)**

Status: IMPLEMENTED, with exact scenario-scoped grader activation repaired 2026-08-07.
Defends `CORMIDIA-INV-ACC-2` and `CORMIDIA-INV-ACC-5`. Journey J-21. Grader **quality**
is S-11 at layer 4 under the judge-calibration rule (`llm-eval-plan.md` §3) and is
deliberately not this contract's subject. Grader **transport** reuses
CORMIDIA-C-B02/B03/B04-001 — no new provider contract is minted.

## §1 Valid input — what a grader turn receives

- The **evidence set** the campaign assembled for the axes that turn grades: the
  scenario repository state, the diff, the run journal, the ledger, and the original
  ramble brief.
- It does **not** receive the org's own self-report — PR bodies, verdicts, step
  narration — as input to O-1…O-3. Those are the **subject** of O-5 (claim honesty),
  never evidence for the axes that O-5 audits (`acceptance/rubric.md` §7 rule 2).
- It does not receive the sealed answer key, in assembly or by reachability (B-28).
- Each axis's read set is declared before construction and is the set the disjointness
  check runs against.

## §2 Admission — per-axis provider disjointness, before construction

- For every graded axis, the grader turn's **provider family** is disjoint from the
  provider families of every turn whose output that axis reads.
- Disjointness is scoped **per axis**, not per scenario. This is load-bearing rather
  than a loophole: S-ACC-3's fan-out deliberately spans both families, so a
  whole-scenario rule would leave **no legal grader at all** and the scenario could not
  be graded. Per-axis scoping resolves it honestly — mechanical axes need no model
  grader, and a model-graded axis is disjoint against only the turns it actually reads.
- The unit is the **provider family**, not the vendor product: two harnesses sharing one
  upstream family (the pi/Anthropic correlation recorded at B-04) are not disjoint.
- The check runs **before provider construction** and fails closed.
- The sealed plan selects one exact candidate; the resolver may reject it as correlated
  but may not fall back to another candidate. For mirror app matrices, grader rows are
  scoped to exact scenario ids and the fixed `acceptance-grader` role is atomically
  activated and verified immediately before its packaged `run-role` turn.
- If no legal grader exists for an axis, that axis reports `ungraded`. It is never graded
  by a correlated provider, and never silently dropped.
- The campaign records **the disjointness set actually applied, per axis**, in the
  report, so the scoping is auditable rather than assumed.

## §3 Guaranteed output — what a grader result must be to count

- One structured result per axis: a score in `0|1|2|3` **plus a mandatory one-sentence
  justification citing specific evidence**. A score without its citation is **discarded**
  and the axis reports `ungraded` (rubric §5). It is not retained as a number.
- A result citing an artifact absent from the declared read set is invalid; the axis
  reports `ungraded`.
- Missing evidence yields `ungraded`, never a low score. Conflating "we did not measure
  it" with "it was absent" is the failure this contract exists to prevent.
- **O-5 is adversarial by construction:** the grader is instructed to find claims
  unsupported by artifacts, and is told that finding none is a valid result it must
  justify.

## §4 Typed errors, idempotency, ordering

- Malformed, truncated, or multi-marker grader output ⇒ typed error; the axis is
  `ungraded`. A retried grader turn's partial output is never merged with the retry's —
  the merge is exactly how a fabricated citation acquires a real-looking neighbour.
- Grader turns settle like any other provider turn: exactly one ledger row each,
  attributed to the campaign envelope, including failed and cancelled turns (INV-006).
- Ordering: assemble evidence → check disjointness → construct → grade → record the
  applied disjointness set → **then** apply the sealed key mechanically (B-28 §4).

## §5 Negative control — non-negotiable before any grader result is trusted

The O-5 fabrication detector lands **red** against a **seeded fabricated claim** — an
artifact set plus a PR body asserting something the artifacts do not support — before it
is trusted on real output. A detector that has never fired is an assumption (standing
rule 4), and an unsupported-claim detector that has never caught an unsupported claim is
the worst kind: it makes silence look like evidence.
