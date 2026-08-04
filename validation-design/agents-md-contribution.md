# Proposed AGENTS.md section — validation harness routing

Status: RATIFIED 2026-07-31 (ratification-package.md §9) for the Cormidia repo's
human-ratified `AGENTS.md` (and mirrored in `CLAUDE.md`) — the section below is
being landed. AGENTS.md is a ratified surface; this section carries the owner's
ratification. Present verbatim below the marker.
<!-- ratification 2026-07-31: status flipped from PROPOSAL; spend digest amended
(release ≤24 turns/$100); blocked-work sentence narrowed to HB-P3/HB-P5;
Activation paragraph updated. -->

<!-- changelog 2026-07-31 (post reader test): added activation clause (coding-agent
finding 4); named risk-allocation/system-map/boundary-map + T-tag source (finding 2);
golden-set targeting pointer (finding 3); new-finding procedure + single-source rule
(findings 5, 8); structural-additions rule (finding 6); harness-backlog.md named
(finding 7); self-contained standing-rules digest replacing bare skill-rule citations
(finding 1). -->

---

## Validation harness (replacement, designed 2026-07-31)

**Activation.** The product owner worked through
`validation-design/ratification-package.md` on 2026-07-31 (its §9 is the ratification
record) and this section is being landed in AGENTS.md. Once
landed, it is binding. Until the landing merges, treat the design artifacts as
ratified but not yet wired: read them, follow them for new work, but do not
represent their gates as already existing in CI.

**Where truth lives.** The design artifacts are at the paths in
`validation-policy.yaml` → `artifacts:` (start at `validation-design/README.md`; the
set moves with the harness into `claude-tests/`). The policy file is the contract:
layer lanes, gates, spend bounds, verdict semantics, and open findings. **The policy
is tighten-only** — narrow a requirement if you must, never loosen one; gates and
golden sets are never weakened to make a change pass.

**Feature changes** start from the affected journey's acceptance criteria
(`contracts/journey-acceptance.md`) and the affected boundary's contract
(`contracts/B-*.md`, `contracts/OP-*.md`, canonical `CORMIDIA-C-*` IDs). Derive the
change's cases with the derivation grammar rows (journey / state machine / invariant /
boundary / contract / interface / LLM site / ops), land each at the cheapest layer
that can falsify it, and update `case-catalog.md` traceability in the same change.
**Risk and layer tags come from `risk-allocation.md` (E-1/E-2/E-3/STD/THIN/FLOOR/L4Q)
and `system-map.md` §5.2 (T-1…T-12 control points)** — read those two files before
tagging a new catalog row; `boundary-map.md` owns each boundary's failure-mode list.

**Bug fixes** deposit their detector (a failing-then-passing test at layer 1 or 2) in
the same change. This obligation's single source of truth is
`validation-policy.yaml` → `case_sourcing:`; this section and `harness-backlog.md`
merely reference it. Bad LLM outputs observed in production become golden cases —
**target directory = the emitting call site's scaffold** per `llm-eval-plan.md` §1–2
and the per-directory READMEs under `golden-sets/` (e.g. Reviewer → `reviewer/`).

**Deterministic defects found by live (L3) or eval (L4) runs** also deposit L1/L2
detectors in the same change — a green live run proves that run, nothing more.

**Quality thresholds:** every number marked PROPOSED or owned by an open finding
(F-PT-009/010/011) is a budgeting hypothesis. Threshold-dependent verdicts are
`inconclusive` until the finding ratifies — never report them as pass/fail, never as
release evidence.

**Spend:** live campaigns obey `validation-policy.yaml` spend bounds (≤2 turns/$5
pre-merge changed-adapter; ≤24 turns/$100 release — amended at ratification
2026-07-31; retries/repeat turns must not abort a campaign, and the ceiling is a hard
bound raisable only by a human policy edit). Ceiling exhaustion ⇒
completeness=incomplete, never green. Never forge human approval decisions; unattended
runs use only the ratified sandbox test-mode profile.

**Blocked work:** the parked tickets (`harness-backlog.md` HB-P3 and HB-P5, blocked
on F-PT-006 and F-PT-008) and B-17's live
cell are blocked on open product-truth findings — do not implement them, and do not
encode any finding's "expected" behavior as truth before a human ratifies it.
(HB-P1/HB-P2/HB-P4 were unparked at ratification 2026-07-31 — their findings are
resolved and their contracts ratified.)

**Opening a new finding.** If your change surfaces a fresh product-truth or
architecture ambiguity ("the docs don't say; the owner must decide"): (1) add it to
`validation-policy.yaml` → `open_findings:` with the next `F-PT-nnn` id, a one-line
subject, and status `open` — **the policy list is the single source of truth**;
(2) mirror the one-liner into `harness-design-state.md`'s findings section; (3) park
any dependent cases as `BLOCKED:<finding>` in `case-catalog.md`; (4) never encode
your guess as behavior. A new finding is a question for the human, not a decision.

**Structural additions are not autonomous.** A change that needs a **new** journey,
boundary, or invariant — not just new cases against existing ones — is a structural
change to the design, exactly like a structural *mismatch* (boundary map contradicts
the architecture, a lane mis-placed, invariants that no longer describe the system).
Both require re-entering the `validation-harness-design` skill in `harness-revision`
mode with the existing artifacts as baseline. **If that skill is not available in
your environment, stop and escalate to the human — do not improvise a redesign or
pile cases onto a wrong shape.** Case-level additions against existing structure are
the only autonomous path.

**Standing rules digest** (self-contained — the load-bearing method rules, so you
never need the design skill's text to follow them):

1. *Cheapest falsifying layer:* before placing a check at an expensive layer, ask
   whether a cheaper one could falsify it. Hermetic composition (L2) is where most
   risk dies; live runs are for seams no honest fake can prove.
2. *Guardrails enforce; evals measure:* anything a model or vendor could violate at
   runtime is enforced in code, fail-closed, and you test the guardrail. An eval is
   never enforcement.
3. *Golden sets before tuning:* eval cases are committed before prompts are tuned,
   or the grader is tuned to itself.
4. *Negative controls:* every new detector family lands red-then-green against a
   seeded violation. A detector that has never fired is an assumption.
5. *The harness is itself tested:* fixtures have self-tests; sweeps fail on empty
   walks; the policy loader and CI lane are pinned by tests.
6. *Evidence is not a regression suite:* L3/L4 findings deposit L1/L2 detectors.
7. *No green by absence:* missing, skipped, or ceiling-stopped work reports
   incomplete/inconclusive — never pass.

**Never read, cite, run, or take design cues from `archive-do-not-read/**`.**

---

## Proposed 2026-08-03 routing addendum — design accepted; exact edit approval pending

The text below is the proposed standing-rule addition for the
roadmap/validation/delivery/batching harness revision. The design was accepted on
2026-08-03, but the owner's acceptance expressly retained separate approval for
protocol-surface changes. It is **not yet part of the ratified verbatim section above**
and must not be represented as landed policy until its exact diff is approved.

> **Roadmap, validation and execution-batch changes** start at J-03/J-20,
> C-OP-PLAN/C-OP-VALIDATION/C-OP-BATCH, B-20/B-21/B-22 and INV-016. Code work is
> always RoadmapPlan-accounted and delivered as one independently reviewed PR per
> delivery unit, even when complete structured input makes the roadmap or
> EpisodePlanner provider turn unnecessary. Complete non-code operational work may
> omit RoadmapPlan only through the direct `ExecutionUnit` contract; it still requires
> EpisodeIntent/EpisodePlan, validation/evidence policy, and separately exact approval
> plus acknowledgement for every external payload/effect.
>
> Labels and trailers—including `op:ready`, `op:tier-*` and any
> `planning:preplanned` projection—are discoverability/state projections, never plan,
> validation, routing or effect authority. Their referenced persisted artifact and hash
> must validate independently. Batch admission is deterministic and token-free;
> EpisodePlans are created lazily per admitted unit. Affinity/cache/session reuse may
> reorder compatible same-app units, but never changes membership, priority, routing,
> validation, one-PR atomicity, per-unit budget/evidence, effect grants, or Builder/
> Reviewer independence. Cache benefit is reported only from adapter evidence and has
> no correctness effect.
>
> Changes needing a new journey, boundary or invariant re-enter
> `validation-harness-design` in `harness-revision` mode. Changes to TASTE.md,
> roles.yaml, pipelines.yaml, prompts/** or PURPOSE.md remain proposal-only until a
> human explicitly ratifies the exact diff.
