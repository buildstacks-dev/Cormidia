# Rambling-provenance archive — scope record for the `[rambling]` tag class

Created 2026-08-10 (independent audit rev-2026-08-10, finding AUD-101 — blocking).
This file is the resolution target for every `[rambling]` citation minted before
2026-08-10. It records a supersession event the corpus had not recorded.

## 1. The supersession event

Two different files have carried the name `./rambling.txt`:

| File | Present | Character |
|---|---|---|
| **Elicitation-era operator ramble** (the "2026-07-31 ramble") | workspace evidence from campaign cormidia-2026-07-31 until 2026-08-10 | Long-form owner notes: PR #182, the default-branch scar, the Codex rotation-race scar, "safe, boring operation" model swaps, the coin-flip-qualification gate scar, "trust AND afford", "not a bank", offline-first prompt-adjustment economics. Channeled by Claude from the owner's recorded directives at the owner's request; reviewed and confirmed as his voice 2026-07-31 (ratification-package.md §2). |
| **One-page operator ramble** (the current `./rambling.txt`) | since target commit `15708a7e` (2026-08-10, "Add a one-page operator ramble on Cormidia") | A fresh 22-line-class summary. Contains **none** of the passages above. Diffed line-by-line at rev-2026-08-10 (elicitation-log.md § "rambling.txt diff"); its one untraced passage became CF-REVIEW-PROVIDER. |

The rev-2026-08-10 revision ingested the new file correctly but did not record
that the old file's passages had left the workspace, leaving the standing tag
definition ("`[rambling]` = ./rambling.txt (cited)") asserting something false.
That is what AUD-101 found. This file, plus the rescoped definitions at each
legend site, is the fix.

**Byte-level recovery status.** No byte-level preimage of the superseded
ramble exists in the supplied repository: the stakeholder seat probed
`target-source/.git` at the audit gate (round 1, 2026-08-10) and
`git show HEAD^:rambling.txt` reports the path did not exist before
`15708a7e` — the file entered the bundled history only at the tip commit.
(The designer's sandbox additionally cannot run git at all: global-config
read denied, attempted and recorded 2026-08-10.) Retention is therefore
quotation-level and attestation-level, per the register below; a byte-level
archive would require the original 2026-07-31 campaign's own workspace or
records, if the human retains them — it is NOT a recoverable-from-here git
operation. <!-- corrected 2026-08-10 at the disposition gate (round 1,
AUD-101 objection): the first wording claimed one-command recovery from
workspace git history, which the stakeholder's probe disproved. -->

## 2. Scope rule for the tag class (normative from 2026-08-10)

- `[rambling]` citations **minted before 2026-08-10** (all sites in
  invariants.md, boundary-map.md, system-map.md, scope-and-module-map.md,
  risk-allocation.md, llm-eval-plan.md, contracts/B-03,
  validation-policy.yaml (the unattended test-mode profile's `provenance:`
  line), and ratification-package.md §2 <!--
  scope-and-module-map.md and the policy provenance line added 2026-08-10 at
  the disposition gate (round 1, AUD-101 objection): the list previously
  omitted scope-and-module-map.md and its four tagged anchors; the list is now
  derived from a corpus-wide `[rambling` occurrence grep, not recall -->) cite the
  **superseded 2026-07-31 ramble**. They are NOT checkable against the current
  `./rambling.txt`; they resolve through §3 below. Their content-existence was
  verified against the then-present file by the 2026-07-31 campaign's
  independent audit iterations 1–2 (audit/audit-report-2.md), whose declared
  verification standard was content existence in the cited source.
- `[rambling]` citations **minted at rev-2026-08-10 or later** cite the
  current `./rambling.txt` and must remain directly checkable against it.
  Exactly one exists today: CF-REVIEW-PROVIDER's "must not collapse Builder
  and Reviewer onto the same provider" (case-catalog.md §10.2; passage at
  rambling.txt, "What it must not do" paragraph — verified at §12.5 and
  re-verified at this audit).

## 3. Anchor register — every pre-2026-08-10 anchor still cited, with its retention

Retention classes: **[Q]** near-verbatim quotation retained in-corpus;
**[V]** independent auditor content-existence verification on record;
**[A]** attested only by the tag having survived the 2026-07-31
content-existence audits (no in-corpus quotation).

| Anchor (as cited) | Citing sites | Retention |
|---|---|---|
| Codex rotation-race scar — "campaigns died mid-run when Codex refresh-token rotation raced and killed auth; long-running work checkpoints and resumes" | contracts/B-03-codex.md (tag carries the quotation); boundary-map.md B-03 row; system-map.md §"killed campaigns"; ratification-package.md §2 | **[Q]+[V]** — quotation inside the B-03 bracket; audit/audit-report-2.md quotes the then-file's lines 57–61 verbatim-in-spirit ("checkpoint and resume, not restart") |
| PR #182 — green evidence attached to the wrong candidate; "the emotional center" | invariants.md INV-008, INV-012; boundary-map.md B-01 failure row, B-12 row | **[Q]+[V]** — elicitation-log.md Phase 3 record ("PR #182 is the emotional center") and Phase 5 record ("a trustworthy-looking result attached to the wrong reality"); B-12 anchor existence independently verified at the 2026-07-31 audit (its AUD-102) |
| Guessed-default-branch defect / "default-branch scar" | invariants.md INV-009; boundary-map.md B-01 failure row | **[Q]** — elicitation-log.md Phase 2 ramble ("The default-branch defect is the scar I keep touching… Wrong-and-loud is survivable; wrong-and-green is not") |
| "safe, boring operation" (model swap) | llm-eval-plan.md §4 heading | **[A]** |
| Coin-flip qualification gate scar — "maxed control, ties, coin-flip qualification" / "Phase-6 coin-flip gate" | boundary-map.md B-11 row; llm-eval-plan.md §0 | **[A]** (the elicitation log retains the adjacent "paired-gate scar is Phase 5 eval-design material" instruction) |
| "trust AND afford" / "something I trust AND afford" | llm-eval-plan.md §0; scope-and-module-map.md release-gating bullet <!-- second site added 2026-08-10, disposition gate round 1 --> | **[Q]** — the scope-and-module-map bracket carries the quotation verbatim <!-- was [A]; upgraded when the omitted citing site surfaced --> |
| "I do not want the 83-contract apparatus back" (proportionate qualification apparatus) | scope-and-module-map.md release-gating bullet | **[Q]** — quoted verbatim inside the tag bracket <!-- row added 2026-08-10, disposition gate round 1 (AUD-101 objection) --> |
| "hard requirement … ZERO human approval decisions" (unattended L3 runnability) | scope-and-module-map.md unattended-runnability bullet; validation-policy.yaml unattended test-mode profile `provenance:` line | **[Q]** — quoted verbatim inside the tag bracket <!-- row added 2026-08-10, disposition gate round 1 --> |
| "the next turn must not eat it" (uncommitted-work preservation) | scope-and-module-map.md module table, M9 row | **[Q]** — quoted verbatim inside the tag bracket <!-- row added 2026-08-10, disposition gate round 1 --> |
| "high-consequence — but … not a bank. Calibrate there." | system-map.md §5 | **[A]** |
| Offline-first economics for prompt adjustments ("no $40 deep route") | risk-allocation.md §"No $40 deep route" | **[A]** |
| Auth races killing multi-hour runs | boundary-map.md B-03 row | **[Q]+[V]** — same passage family as the rotation-race scar |
| "everything redacts" — "there's one secret-pattern list and everything redacts through it. If a token ever lands in a provider prompt or a run log we have failed" (F-PT-001's rambling half) | scope-and-module-map.md §3 F-PT-001 entry (the actual tagged citation, quoting the passage); system-map.md §4 F-PT-001 row (prose mention) <!-- corrected 2026-08-10, disposition gate round 1: the row pointed only at the system-map prose, not the tagged citation --> | **[Q]** — quoted at the tagged site — and moot on substance: docs ruled (resolved-by-docs 2026-07-31) |

Nothing in this register changes any invariant, boundary, contract, or ratified
decision: the auditor found no evidence of fabrication, and none is claimed
here. What changed is only what a reader can verify **today** and where they go
to verify it.

<!-- changelog 2026-08-10 (audit rev-2026-08-10, AUD-101): file created — the
[rambling] tag class rescoped historically after the 2026-08-10 evidence sync
replaced ./rambling.txt; legend-site pointers landed in the same change
(invariants.md, boundary-map.md, system-map.md, llm-eval-plan.md,
ratification-package.md §2). -->
<!-- changelog 2026-08-10 (disposition gate round 1 — stakeholder OBJECTION on
AUD-101 upheld): scope-and-module-map.md added to the §2 site list; four
missing anchors registered (83-contract apparatus, ZERO human approval
decisions incl. its policy `provenance:` site, next-turn-must-not-eat-it,
everything-redacts corrected to its actual tagged site); trust-AND-afford
upgraded [A]→[Q] with its omitted citing site; byte-recovery note corrected —
no pre-15708a7e preimage exists in the bundled history (stakeholder git probe),
recovery is NOT a from-here git operation. §3 was re-swept against a corpus-wide
`[rambling` occurrence grep this time; every tag-bearing site now appears in §2's
list and resolves to a §3 row or the §2 current-file rule. -->
