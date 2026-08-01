# Ratification package — Operon validation harness design (campaign operon-2026-07-31)

**This entire design is a DRAFT until a real human works through this file.** The
product-owner seat this campaign was held by an AI stakeholder agent grounded in the
ratified `./docs/` corpus and `./rambling.txt` (the owner's unstructured notes). Its
decisions are strong evidence of the owner's values and honest derivations from the
docs — but they are not human ratification. This file lists every decision that needs
a human's yes, every open question, and the provenance profile of every artifact.

> **RATIFIED 2026-07-31.** The product owner worked through this package in session
> on 2026-07-31; every decision below now has a recorded disposition. See §9,
> **Ratification record — 2026-07-31**, at the end of this file. The draft framing
> above is preserved as history.

## 1. How to work through this file

Confirm, adjust, or reject each item in §3–§5. Anything adjusted re-enters the design
via `harness-revision` mode (surgical, not wholesale). When done: flip
`validation-policy.yaml` → `design_status` to `ratified`, land the
`agents-md-contribution.md` section into AGENTS.md/CLAUDE.md, and Wave 0 of
`harness-backlog.md` may begin.

## 2. Provenance label meanings

`[doc]` derived from ratified ./docs/ (strongest). `[rambling]` traceable to the
owner's own notes (real human input, unratified). `[elicited]`/`[walk]` the AI
stakeholder's campaign input, mostly doc-grounded. `[simulated]` the AI stakeholder's
own judgment beyond docs/rambling — **every one needs your eyes**. `[PROPOSED]`
designer-originated provisional values. `[stated]` was deliberately never used.
Note on rambling.txt itself: it was channeled by Claude from the owner's recorded
directives at the owner's request, and the owner reviewed and confirmed it as his
voice on 2026-07-31 — future auditors should apply that discount when weighing
`[rambling]` tags. <!-- ratification 2026-07-31: provenance clarification adopted
from reviewer pushback -->

**Derivation artifacts** (tag occurrences, grep-counted 2026-07-31):

| Artifact | [doc] | [elicited]/[walk] | [rambling] | [simulated] | PROPOSED |
|---|---|---|---|---|---|
| system-map.md | 7 | 20 | 3 | 2 | 2 |
| invariants.md | 2 | 17 | 4 | 4 | 2 |
| boundary-map.md | 14 | 31 | 6 | 0 | 3 |
| contracts/ (23 files) | 88† | 19† | 1 | 2 | 8 |
| risk-allocation.md | 0 | 8 | 1 | 5 | 1 |
| llm-eval-plan.md | 4 | 20 | 4 | 0 | 3 |
| case-catalog.md | inherits from its ratified sources | — | — | — | 1 |

† Single-label tag occurrences. One additional **compound** `[doc][walk]`
occurrence (B-06's missed-window reconciliation clause) is counted in neither column
and enumerated here instead: the claim is doc-grounded, elaborated in the Phase 1
walk — an earlier `[rambling]` tag on it was false (no such content in rambling.txt)
and was removed at audit iteration 1 (AUD-101).

The contracts row's single genuine `[rambling]` occurrence is **B-03's auth-rotation
clause** — campaigns died mid-run when Codex refresh-token rotation raced and killed
auth; long-running work checkpoints and resumes (rambling.txt, rotation-race passage).
It was restored at audit iteration 1, dispositions round 2, after the AUD-101 correction over-removed it. The
row's two `[simulated]` occurrences are B-06's owner-ratified clock-anomaly ruling and
B-14's recorded-but-unencoded concurrent-edit preference. Verification standard:
content existence in the cited source, not tag-location count.
<!-- changelog 2026-07-31 (final-gate round 2): attribution corrected B-03 → B-06.
changelog 2026-07-31 (audit iteration 1): false rambling tag on B-06 removed.
changelog 2026-07-31 (audit iteration 1, dispositions round 2): B-03's genuine rambling provenance RESTORED
(it had been erased from the record, not just mis-located); every column recounted
from the corpus; compound-tag footnote added so the counts are reproducible. -->

**Decision-bearing files not tag-profiled above** (they aggregate or restate rather
than originate provenance — every claim in them traces to the tagged artifacts):
`README.md` (navigation), `scope-and-module-map.md` (tagged inline, small),
`validation-policy.yaml` (encodes ratified decisions; carries its own provenance
comments), `harness-backlog.md` and `agents-md-contribution.md` (derived from policy
+ catalog), `golden-sets/*/README.md` (scaffold headers), `elicitation-log.md` and
`harness-design-state.md` (the provenance record itself), and this file.

Note: most `[elicited]` content is itself doc-grounded; the `[simulated]` and
owner-ratified-in-the-simulated-seat items below are where AI judgment substituted
for yours.

## 3. Decisions taken in the simulated owner seat — each needs human YES/NO

1. **Criticality calibration** — base C2 with function-scoped C3 control points
   T-1…T-12; C1 leaves (system-map §5). Includes the "solo operator ≠ toy, but not a
   bank" calibration.
2. **Three exhaustive families E-1/E-2/E-3 + non-discretionary floors**
   (INV-001/011/015) and the deliberately-thin list (risk-allocation §§2–4).
3. **L3 spend policy**: ≤2 provider turns/$5 pre-merge changed-adapter; ≤6 turns/$15
   full release campaign; trigger rules for adapter/GitHub/launchd live runs
   (risk-allocation §5). *(AMENDED at ratification 2026-07-31: release ceiling
   raised to ≤24 turns/$100 — see §9.)*
4. **Soak design**: 7 calendar days ordinary laptop use, ≥3 sleep/wake cycles (1
   overnight), sandbox only, $15 ceiling, inspection list, repeat triggers; Codex
   natural-rotation sub-obligation with its own completion evidence (CF-OPS-ROT).
5. **Threat-model scope and timing**: ten trust-boundary surfaces; due before the
   earliest of release-gating reactivation / droplet migration / first non-sandbox
   onboarding; review triggers (risk-allocation §6).
6. **Contention exercise design**: ≥10 due candidates, ≥3 apps, duplicate (app,role)
   stimuli, simultaneous settlement, six proof obligations; classified L5.
7. **Completeness/verdict split**: {complete,incomplete} × {pass,fail,inconclusive};
   proven violation stays fail; incomplete never yields pass.
8. **Eval decision-status rule**: all quality thresholds are budgeting hypotheses;
   threshold-dependent verdicts inconclusive until F-PT-009/010/011 ratify; judge
   scores inadmissible until calibrated + ratified.
9. **F-PT-005 resolution** (event subscriber-set cutoff): added subscribers inherit
   pending events; removed subscribers cease blocking retirement (docs-derived
   mechanism; the *ratification of the derivation* was the simulated seat's call).
10. **Clock-anomaly response** (B-06): uncertainty about freshness fails closed and
    is recorded durably; a clock jump never manufactures permission.
11. **Unattended test-mode profile** (policy `unattended_test_mode_profile`): sandbox
    orgs only; zero human decisions on the allowed path; never forge human
    decisions; publication/non-sandbox stays hard-gated; evidence requirements. This
    is also a **product surface that must be designed and ratified in Operon itself**
    before HB-054 can run.
12. **Tooling selection** (policy `tooling`, incl. gitleaks conditions and the
    rejected alternatives).
13. **F-PT-003 policy choice** — should the budget-pause crash contract be "pause
    holds; exactly one budget-exceeded item eventually" (the owner-preference on
    record, unencoded)? YES ratifies that contract and unblocks HB-P1; NO requires
    you to state the contract you want.
14. **F-PT-004 policy choice** — should ambiguous uncommitted worktree bytes be
    preserved-and-inspected rather than reset (the owner-preference on record,
    unencoded)? YES ratifies that line and unblocks HB-P2; NO requires you to draw
    the scratch/protected boundary yourself.
15. **F-PT-007 policy choice** — should a concurrent human edit of a bootstrap-owned
    path between validation and write yield compare-and-refuse preserving human bytes
    (the owner-preference on record, unencoded)? YES ratifies it and unblocks HB-P4;
    NO requires your alternative.

<!-- changelog 2026-07-31 (final-gate refusal): item 13 split into three separately
answerable decisions (13/14/15); provenance table corrected (contracts rambling=1,
simulated=2) and scoped honestly with the omitted decision-bearing files enumerated. -->

## 4. Open product-truth findings — the questions a human must answer

| ID | Question for you | Unblocks |
|---|---|---|
| F-PT-002 | What IS the current active org registry + scheduler state? (Artifacts refuse to assume.) | operator orientation; soak planning |
| F-PT-003 | What is the ratified crash contract between budget-overlay write and budget-exceeded item creation? | HB-P1 (CF-J07-I) |
| F-PT-004 | Where exactly does disposable scratch end and protected uncommitted builder work begin? | HB-P2 (crash-sweep byte disposition) |
| F-PT-006 | Must event producers publish via temp-file+atomic-rename, or does the dispatcher tolerate partial files and retry? And what wins when two files share an event identity with different payloads? | HB-P3 |
| F-PT-007 | What happens when a human edits a bootstrap-owned path between validation and write? | HB-P4 |
| F-PT-008 | What does grant TTL expiry do to the approval item — fresh item, reopen, or explicit operation? | HB-P5 |
| F-PT-009 | Reviewer catch-rate/FP thresholds, N, and sample design (case counts, severity+pairing aggregation, inconclusive rule). | S-3 verdicts |
| F-PT-010 | Planner and SRE thresholds + sample designs. | S-1/S-4 verdicts |
| F-PT-011 | Later-site thresholds + sample designs (Builder quality, Support, Marketing ×2, Distiller, Learning Reviewer) + brief-conditioning sampling. | remaining L4 verdicts |
| F-PT-001 | (Resolved by docs; review the recorded resolution: L3 evidence is verbatim; confinement, not blanket redaction.) | — |
| F-PT-005 | (Resolved in the simulated seat; ratify or overturn the derivation.) | — |

<!-- ratification 2026-07-31: F-PT-002 resolved with recorded facts; F-PT-003/004/007
resolved-ratified; F-PT-005 ratified by adoption. F-PT-006 and F-PT-008 remain OPEN
(the owner did not decide them); F-PT-009/010/011 remain open under the
inconclusive-only rule. Dispositions in §9. -->

## 5. Decision register

Thirteen items, listed with owners and expiries in `validation-policy.yaml` →
`proposed_register` and `harness-design-state.md`. **HB-007 review completed
2026-07-31:** the owner said "ratify recommendations." Items 1–8 and 13 are now
ratified/adjusted-ratified with the exact outcomes in those two canonical files.
Items 9–12 remain PROPOSED and come due at the first eval-campaign design review.

## 6. Reader-test findings and dispositions (Phase 8 adversarial review)

Three fresh-context readers (production operator, new engineer, coding agent) reviewed
the corpus. Dispositions:

- **Fixed in-place** (inline changelogs in each file): README.md entry point with
  reading order, warnings, and ID glossary; agents-md activation clause, risk/tier
  tagging sources, golden-set targeting, new-finding procedure, structural-additions
  rule, standing-rules digest; backlog HB-047 (S-9), HB-007 (PROPOSED tripwire), Wave
  L3 header honesty, Waves 1–4 convention note; case-catalog §4 collapsing convention;
  policy single-source annotations and ratification-package pointer.
- **Accepted as designed** (honest gaps, not defects): design corpus ≠ deployed-state
  oracle (F-PT-002); `[doc]` references depend on ./docs/ (a working map does not
  replace the docs); blocked findings deliberately encode no expected behavior.
- **Owed at implementation time, not design time** (recorded here as open items for
  you to schedule): an operator triage runbook mapping alerts→actions once the
  harness and its reporting exist; an `inconclusive`-semantics reminder on the
  report/observe surfaces (product change). *(Converted to backlog tickets HB-080 and
  HB-081 at ratification 2026-07-31 — see §9.3.)*

## 7. Audit record (independent design-conformance audit, 2026-07-31)

**Verdict: clean** — two iterations by fresh read-only auditors measuring the corpus
against the validation-harness-audit design-conformance rubric. Iteration 1 returned
nine findings; iteration 2 verified every disposition at its fix site, independently
reproduced the §2 provenance counts, and found no new blocking findings.

Findings ledger (authoritative; dispositions confirmed by the stakeholder seat over
four gate rounds — full history in elicitation-log.md):

| ID | Tier | Finding (file) | Disposition | Rationale |
|---|---|---|---|---|
| AUD-101 | blocking | False `[rambling]` tag on B-06's missed-window clause — no such content in rambling.txt (contracts/B-06-clock.md) | fixed | Retagged `[doc][walk]`; first correction over-removed B-03's *genuine* rotation-race rambling provenance, which was then restored; all §2 columns recounted from the corpus with the convention stated |
| AUD-102 | significant | B-12 `[rambling]` bracket packed elicited elaboration around the real PR #182 anchor (boundary-map.md) | fixed | Bracket narrowed to the anchor; elaboration retagged `[elicited]` |
| AUD-103 | significant | No gate carried a blocking/advisory/waived class; per-commit merge-blocking undeclared (validation-policy.yaml) | fixed | `per_commit_gate_class: blocking` (required check, fail-closed) + `gate_classes` (no advisory/waived gates; triggered lanes gate their own layer, never merge) |
| AUD-104 | minor | PROPOSED-register header asserted blanket expiry contradicting policy for items 9–12 (harness-design-state.md) | fixed | Expiry split (1–8, 13 vs 9–12) to match policy; item 13 rejoined the numbered list |
| AUD-105 | minor | Phase-gate status headers never advanced after confirmation (invariants.md + 4 others) | fixed | Five headers + two internal statuses advanced to confirmed-at-gate; DRAFT-pending-human-ratification retained |
| AUD-106 | minor | Catalog §9 blocked-cell roll-up omitted five declared contract-matrix cells (case-catalog.md) | fixed | CF-C-B09A/B13/B14/B15/B17 added; roll-up now complete |
| AUD-107 | minor | Log omitted Phase 2/5 confirming rounds asserted by the checkpoint (elicitation-log.md) | fixed | Entries restored, explicitly marked as audit-time restorations |
| AUD-108 | minor | System-map §4 findings table unscoped — reads as 4 findings, not 11 (system-map.md) | fixed | Scoped "through Phase 1 only" with pointer to the policy's authoritative list |
| AUD-109 | minor | README warning literally asserted an active incident (README.md) | fixed | Reworded to the conditional; BLOCKED fact preserved |

**Unresolved disputes or deferrals for you to rule on: none.** All nine findings were
fixed; no disputes were raised and nothing was deferred beyond the questions this
package already carries (§§3–5). Iteration-2 residues: two fixed (a last stale
"pending" clause in system-map §0; a loose changelog label here), one accepted as-is
(the contracts row's compound-tag footnote convention — self-scoped, counts
reproduce). Historical wrong-status quotations inside audit/log entries are retained
deliberately as trace preservation (stakeholder ruling).

The audit does not change this package's status: everything remains DRAFT pending
your ratification; release gating remains SUSPENDED; no harness was implemented.
*(Status statement superseded by §9: ratified 2026-07-31. Release gating remains
SUSPENDED; no harness has been implemented.)*
<!-- changelog 2026-07-31: §7 Audit record added at audit-loop close; prior §7
renumbered §8. -->

## 8. What ratification makes true

Once §3–§5 are worked through: the policy becomes the audit's diff surface; the
walking skeleton (Wave 0) may be built; the unattended sandbox campaign and soak may
be scheduled; release gating remains SUSPENDED until the replacement qualification
(llm-eval-plan §5's nine obligations) is built and the threat model exists — that
ordering is itself one of the owner-ratified decisions above (item 5).

## 9. Ratification record — 2026-07-31

Ratified by the product owner, in session, 2026-07-31, after a full-package
walkthrough naming every §3 item. Explicit decisions and ratified-by-adoption items
are distinguished below. Adoption items are individually reversible later via
`harness-revision` mode.

### 9.1 Explicit decisions

- **§3 item 13 (F-PT-003) — YES as drafted.** The budget-pause crash contract is
  **"pause holds; exactly one budget-exceeded item eventually."** F-PT-003 is
  resolved-ratified; the sentence is contract truth. HB-P1 unparked.
- **§3 item 14 (F-PT-004) — YES as drafted.** Ambiguous uncommitted worktree bytes
  are **preserved-and-inspected, never reset.** F-PT-004 is resolved-ratified; the
  sentence is contract truth. HB-P2 unparked.
- **§3 item 15 (F-PT-007) — YES as drafted.** A concurrent human edit of a
  bootstrap-owned path between validation and write yields **compare-and-refuse,
  preserving human bytes.** F-PT-007 is resolved-ratified; the sentence is contract
  truth. HB-P4 unparked.
- **§3 item 3 (L3 spend policy) — AMENDED.** The release_campaign ceiling is raised
  from ≤6 provider turns / $15 to **≤24 provider turns / $100**. Owner's stated
  rationale: *"I don't want the test to be stopped just because of some repeat
  things"* — retries/repeat turns must not abort a campaign. The ceiling remains a
  hard bound, raisable only by a human policy edit. The pre-merge changed-adapter
  bound (≤2 turns / $5) is unchanged.
- **§3 item 5 (threat model) — CONFIRMED**, including that the threat model is
  **human-authored** and sits on the **critical path to release-gating
  reactivation**.
- **§3 item 11 (unattended sandbox test-mode profile) — CONFIRMED as shaped.** Still
  pending product implementation in Operon before HB-054 can run.
  **Post-ratification implementation note (2026-07-31):** the product profile and
  detector are now implemented; HB-054's campaign evidence remains pending explicit
  human initiation. This note updates implementation state without rewriting the
  historical ratification decision above.
- **F-PT-002 (deployed state) — RESOLVED** with these facts, verified read-only on
  2026-07-31: the active org selector `~/.operon/config` points
  `org_home=/Users/bikram/Build/sonnet1-org`, `state_home=~/.operon/Buildstacks`
  (recorded 2026-07-24); that org has exactly one registered app,
  `sonnet8-buildstack-dev` (repo `buildstacks-dev/sonnet8-buildstack-dev`), status
  live; the scheduler is **NOT installed** (no scheduler state dir, no operon
  launchd jobs), so all turns are human-invoked; two residual partial state homes
  exist (`~/.operon/operon` — dogfood-era invocations/state residue;
  `~/.operon/questionnaire` — partial onboarding lifecycle residue) and are not
  active orgs.
- **rambling.txt — reviewed and confirmed by the owner as his voice.** It was
  channeled by Claude from the owner's recorded directives at his request; the §2
  provenance note records the discount future auditors should apply to `[rambling]`
  tags.

### 9.2 Ratified by adoption

**§3 items 1, 2, 4, 6, 7, 8, 9, 10, 12** — the owner was given a full-package
walkthrough naming each and raised no objection; each is recorded ratified-by-
adoption (individually reversible via harness-revision mode): criticality
calibration (1); exhaustive families + floors (2); soak design (4); contention
exercise (6); completeness/verdict split (7); eval decision-status rule (8);
F-PT-005 subscriber-cutoff derivation (9); B-06 clock-anomaly response (10); tooling
selection (12) — **including gitleaks with its stated conditions: pinned,
fail-closed, canary-proven, no broad allowlists.**

### 9.3 Reviewer pushback adopted

- §2 now carries the rambling.txt provenance clarification (channeled by Claude at
  the owner's request; confirmed by the owner 2026-07-31).
- The two implementation-time IOUs (§6) became real backlog tickets: **HB-080**
  (operator triage runbook, alert→action mapping, owed once harness reporting
  exists) and **HB-081** (product-side change in the Operon repo: report/observe
  surfaces must state that an `inconclusive` verdict is not a pass — a product
  change, not a harness change).

### 9.4 Status changes and what remains open

- `validation-policy.yaml` → `design_status: ratified` (2026-07-31, by the product
  owner in session).
- HB-007 was completed 2026-07-31: items 1–8 and 13 are ratified or
  adjusted-ratified exactly as recorded in §5 and `validation-policy.yaml`.
  Items 9–12 keep their first eval-campaign design-review expiry.
- **Remaining OPEN findings:** F-PT-006 (event-producer visibility protocol) and
  F-PT-008 (grant-TTL expiry disposition) — the owner did not decide these; their
  tickets (HB-P3, HB-P5) and catalog cells stay parked/blocked. F-PT-009/010/011
  (eval thresholds) stay open under the inconclusive-only rule.

### 9.5 What this record unblocks

The policy is now the audit's diff surface. The `agents-md-contribution.md` section
is being landed in AGENTS.md/CLAUDE.md (binding once landed). Wave 0 of
`harness-backlog.md` (HB-001…HB-007) may begin. HB-P1/HB-P2/HB-P4 are unparked and
implement their ratified contracts. The unattended sandbox campaign and the soak may
be scheduled per policy — HB-054 still additionally gated on the test-mode profile
being implemented in Operon. **Release gating remains SUSPENDED** until the
replacement qualification (llm-eval-plan §5's nine obligations) is built and the
human-authored threat model exists.
