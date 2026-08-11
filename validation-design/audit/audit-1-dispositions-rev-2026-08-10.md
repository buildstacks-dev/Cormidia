# Audit iteration-1 disposition record — rev-2026-08-10 series

Campaign: rev-2026-08-10 independent audit window (report:
`audit-report-1.md`, this series — distinct from the 2026-07-31 campaign's
same-named AUD-1xx ids recorded in `audit-1-dispositions.md` /
`audit-report-2.md`). This file — not the conversation — is the persisted
stakeholder-confirmation evidence; the canonical narrative record is
ratification-package.md §13.

## Final dispositions and stakeholder rulings (all CONFIRMED 2026-08-10)

| Finding | Tier | Disposition | Stakeholder ruling (with stated verification evidence) |
| --- | --- | --- | --- |
| AUD-101 | blocking | fixed — `[rambling]` provenance class rescoped historically via the new `rambling-archive.md` (supersession event; scope rule splitting pre-/post-2026-08-10 tags; per-anchor retention register with honest [Q]/[V]/[A] classes); definitions corrected at every legend/definition site; ratification-package §2's B-03 current-fact sentence corrected; supersession recorded in elicitation-log.md; archive registered in policy `artifacts:` and README | **CONFIRMED (round 2)** after a round-1 OBJECTION was upheld and corrected (archive had omitted scope-and-module-map.md's four tagged anchors and the policy `provenance:` site, and over-claimed one-command byte recovery). Stakeholder verification: archive covers the omitted sites/anchors, uses honest [Q] retention, points "everything redacts" to its actual tagged site, and correctly records that the bundled git history holds no pre-`15708a7e` preimage (stakeholder's own `git show HEAD^:rambling.txt` probe). |
| AUD-102 | significant | fixed — `case-catalog-generator.awk` extracts `KNOWN-LIMITATION:` tokens into a `known_limitation:` field; case-catalog.yaml regenerated; README's "nine park" claim split 8 parked + 1 known-limitation with the encoded-behavior distinction; case-catalog.md §9 register entry annotated with its marker class | **CONFIRMED (round 1)**. Stakeholder verification: regeneration byte-identical; `F-PT-018` exactly twice (CF-HARNESS-CI, CF-HARNESS-RELEASE); rollups reproduce 396=357+38+1 and 101=82+19; `grep -c rambling case-catalog.md` = 1; README 8+1 wording agrees with the catalog. |
| AUD-103 | minor | fixed — harness-state.yaml `convergence.last_diff_verdict` names #376 (`fd3bb8158`, progressive CLI help hierarchy) as **absorbed by existing coverage**: CF-IF-CLI's progressive human-help hierarchy leg + its #371 structural/inline-snapshot tests (`tests/unit/cf-if/`), ratified THIN (help text)/C1 class; no NEW row owed because that row already covers it | **CONFIRMED (round 2)** after a round-1 OBJECTION was upheld and corrected (wrong short SHA `fd3bb814` inherited unverified from the audit report; "assessed-and-pruned, no case row owed" was misleading against CF-IF-CLI's existing coverage). Stakeholder verification: correct SHA per TARGET-SNAPSHOT.md; accurate trace to existing CF-IF-CLI coverage and tests. |
| AUD-104 | minor | fixed — README glossary trailing comment corrected to record the two-step F-PT range extension (…032 at the consistency sweep, …033 at final-gate follow-up 10) and defer to the normative `F-PT-001…033` row | **CONFIRMED (round 1)**. Stakeholder verification: comment accurately sequences …032 → …033; the policy register independently recounts to 33 IDs. |

## Gate history

- **Round 1: GATE-REFUSED** — AUD-102/AUD-104 CONFIRMED; OBJECTIONs on
  AUD-101/AUD-103 upheld against the designer (details in the rows above).
- **Round 2: GATE-REFUSED (record-only)** — the corrected AUD-101/AUD-103 both
  CONFIRMED with non-regression re-verified, but §13's opening and the
  harness-design-state mirror still claimed a clean "no disputes, no
  deferrals" pass ahead of the gate history; both openings corrected.
- **Round 3: CONFIRMED — audit window closed.** Final rulings: AUD-101
  CONFIRMED, AUD-102 CONFIRMED, AUD-103 CONFIRMED, AUD-104 CONFIRMED.
  Stakeholder's closing non-regression statement: byte-identical catalog
  regeneration; two `F-PT-018` rows; catalog `rambling` count 1; rollups
  unchanged (396=357+38+1, 101=82+19).

No disputes were raised by the designer; no finding was deferred. Ratified
decisions were not reopened at any point in the window.

## Stakeholder ruling block — persisted verbatim (final gate, 2026-08-10)

The product-owner seat's closing ruling, recorded verbatim as the persisted
CONFIRMED evidence for each disposition. Its stated verification basis:
"Persistence verification passes: the disposition record, §13, and state
mirror agree on all fixes and the three-round history. Catalog regeneration
remains byte-identical; two `F-PT-018` rows, `rambling` count 1, and both
rollups are unchanged."

DISPOSITION: AUD-101 = fixed — RULING: CONFIRMED
DISPOSITION: AUD-102 = fixed — RULING: CONFIRMED
DISPOSITION: AUD-103 = fixed — RULING: CONFIRMED
DISPOSITION: AUD-104 = fixed — RULING: CONFIRMED

CONFIRMED

<!-- changelog 2026-08-10 (window close, second persistence pass): the
stakeholder's verbatim DISPOSITION/RULING lines and closing CONFIRMED added —
the environment requires the rulings themselves on file, not a paraphrase. -->

<!-- changelog 2026-08-10: file created at window close — persisted
stakeholder-confirmation evidence for the rev-2026-08-10 iteration-1
dispositions (environment requires the rulings on file, not in conversation). -->
