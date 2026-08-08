# Boundary contract — B-27 (L-ACC campaign authorization ↔ durable report)
Canonical ID: **CORMIDIA-C-B27-001 (alias: B-27)**

Status: IMPLEMENTED, with the run-1 conformance repair completed 2026-08-07. No
campaign had run when this implementation record was written. Defends `CORMIDIA-INV-ACC-3/4/5/6/7b`,
INV-008/015 (by inheritance — the campaign is an evidence producer). Journey J-21.
Structurally parallel to the L3 campaign config (`tests/live/config.ts`) — that shape is
reused deliberately, not re-invented.

The rubric this contract serves (`acceptance/rubric.md`) is **human-ratified 2026-08-07
and tighten-only**. This contract may narrow it; it may never loosen it, and it
introduces no numeric threshold — every threshold stays unratified until run 1's
observed distribution exists (rubric §5).

## §1 Valid input — the authorization envelope

An L-ACC campaign config is valid only if **all** of the following hold. Each is
checked at preflight, before any provider runtime is constructed and before any
scenario repository is mutated.

1. **Commit pin.** An authorized commit equal to checked-out HEAD, with the canonical
   `validation-design/validation-policy.yaml` blob tracked at that commit
   (`assertCampaignRepositoryBinding`, `tests/campaign/repository-binding.ts`).
2. **Packaged-install proof.** A recorded `pnpm install:packaged --replace-source-links`
   run for this campaign, exited zero, no older than the commit pin. The campaign
   **asserts that script's exit status**; it does not reimplement the resolution check
   (`CORMIDIA-INV-ACC-7b`).
3. **Scenario set.** One or more scenarios, each naming a disposable repository that is
   not this repository and not any repository outside the campaign org
   (`CORMIDIA-INV-ACC-3`).
4. **Per-scenario matrix.** Every role's exact assignment tuple (harness, model,
   effort). For an app scenario, planner/builder/reviewer are all present, and
   **planner, builder and reviewer are not all one provider family**.
5. **Effort legality.** `effort: max` appears only on `claude` or `opencode`
   (`src/runtime/assignment.ts:82`).
6. **Candidate provenance.** Every `adaptive_assignments` candidate carries
   `provider_family`, `capability_ref`, `qualification_ref` and `conservative_estimate`;
   a candidate whose `qualification_ref` is not a real ratified reference carries an
   explicit `uncertified: <reason>` disclosure.
7. **Envelope.** An output-token ceiling and an equivalent-USD ceiling, both from an
   exact human authorization for this campaign. There is no global L-ACC ceiling and
   none is invented here (`risk-allocation.md` §5a).
8. **Plan-gate policy.** Declared — and declaration is the requirement, not human
   resolution. Since **F-PT-030** resolved (2026-08-07) an `auto-continue` policy is
   legal, so an unattended campaign runs end to end; it must still apply the ratified
   rubric §6 criteria and record its resolution durably before any build-arm spend. A
   config with **no** declared policy refuses: silence is not consent.
9. **Grader plan.** For each axis that is model-graded, the grader tuple and the read
   set it is disjoint from (B-29 admits it; this contract only requires it be declared).
   Mirror matrices scope those declarations to exact scenario ids; a grader tuple is
   never substituted at runtime.

## §2 Guaranteed output — refusals and the report

- **Refusal:** any §1 violation produces a typed refusal naming the exact defect, before
  any runtime construction, repository mutation, or token spend. Exit non-zero. No
  partial campaign state is written beyond the refusal record itself.
- **Report:** every campaign that started writes a durable report containing, per
  scenario: the scenario id; the **exact matrix used**; the installed `cormidia` version
  and tarball identity; the commit pin; each axis with its score **and its evidence
  citation**, or `ungraded` with the reason; the per-axis grader-disjointness set
  actually applied; `completeness`; and the campaign-level verdict per §4. It also
  contains the observed output-token/equivalent-USD exposure against both ceilings, the
  exact gap list, a local preview command, and `release_signal: null`.
- **Answerability:** "which bytes did this campaign exercise" and "which model produced
  this score" are answerable **from the report alone**. A report that cannot answer both
  is malformed, not merely thin.
- The report also records that `--replace-source-links` displaced the operator's
  `link:local` dev loop for the campaign's duration, and that `pnpm link:local` restores
  it.

## §3 Error behavior and idempotency

- Fail closed. An unreadable, ambiguous, or partially written config is a refusal, never
  a default.
- Ceiling exhaustion, a killed scenario, or a missing grader run ⇒
  `completeness: incomplete` for that scenario, with partial evidence preserved
  (`CORMIDIA-INV-ACC-6`). Never `complete`, never absent from the report.
- Resumption binds the same config content hash. A config changed under a live campaign
  refuses and names the drift rather than resuming.
- Report writes are atomic; a torn report is rejected by every reader rather than
  read as terminal truth (INV-013 reader side).
- Two campaigns cannot share a report identity; the second refuses.

## §4 Verdict and ordering

- Verdict vocabulary is `validation-policy.yaml` → `verdict_semantics`, including the
  `axis_score` block added by this revision. `ungraded` is never coerced to `0` and
  never enters an aggregate as a number (`CORMIDIA-INV-ACC-5`).
- While every threshold is unratified, the campaign is a **data-collection run**: each
  threshold-dependent axis is `inconclusive` and the campaign verdict is `inconclusive`.
- Ordering per scenario: preflight → provision → plan arm → **plan gate resolution** →
  build arm → grade → report. No build-arm spend occurs before the gate resolves
  (`CORMIDIA-INV-ACC-4`); the resolution may be authored by a human or by the declared
  `plan_gate` policy, and either way it is recorded with the scores it acted on. A
  campaign that stops at the gate is complete for the plan arm and `incomplete` for the
  build arm — never a failure.
- **The campaign never gates a release** (F-PT-029, 2026-08-07). No L-ACC result enters
  RQ-1 completeness, verdict, or qualification. A bad result is information the human
  acts on; it is not a mechanical block, and no surface may present it as one.

## §5 Freshness and bounds

- The packaged-install proof, the commit pin and the tracked policy blob are re-checked
  at campaign start, not merely at config authoring.
- **Deployment is unreachable.** A campaign ends with each app *buildable* plus a
  preview command in the report. Hosting remains a separate critical operation with its
  own human approval, requested after the report is read; the campaign holds no deploy
  grant at any moment.
- The runner checkpoints atomically after every paid arm and at the gate. Report-time
  reconciliation joins binary invocation audit, turn telemetry and commit authorship;
  non-closure voids every affected numeric score to `ungraded` and makes the scenario
  incomplete.
- Unattended execution uses exactly the ratified sandbox test-mode profile
  (`src/org/validation-test-mode.ts`). Human approval decisions are never forged.
