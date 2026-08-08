# Ratification package — Cormidia validation harness design (campaign cormidia-2026-07-31)

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
    is also a **product surface that must be designed and ratified in Cormidia itself**
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
  pending product implementation in Cormidia before HB-054 can run.
  **Post-ratification implementation note (2026-07-31):** the product profile and
  detector are now implemented; HB-054's campaign evidence remains pending explicit
  human initiation. This note updates implementation state without rewriting the
  historical ratification decision above.
- **F-PT-002 (deployed state) — RESOLVED** with these facts, verified read-only on
  2026-07-31: the active org selector `~/.cormidia/config` points
  `org_home=/Users/bikram/Build/sonnet1-org`, `state_home=~/.cormidia/Buildstacks`
  (recorded 2026-07-24); that org has exactly one registered app,
  `sonnet8-buildstack-dev` (repo `buildstacks-dev/sonnet8-buildstack-dev`), status
  live; the scheduler is **NOT installed** (no scheduler state dir, no cormidia
  launchd jobs), so all turns are human-invoked; two residual partial state homes
  exist (`~/.cormidia/cormidia` — dogfood-era invocations/state residue;
  `~/.cormidia/questionnaire` — partial onboarding lifecycle residue) and are not
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
  exists) and **HB-081** (product-side change in the Cormidia repo: report/observe
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
being implemented in Cormidia. **Release gating remains SUSPENDED** until the
replacement qualification (llm-eval-plan §5's nine obligations) is built and the
human-authored threat model exists.

## 10. Harness-revision acceptance package — 2026-08-03

### 10.1 Status and requested decision

This section is the final Phase 8 gate for the `harness-revision` covering
#184/#233/#234/#240. The product owner explicitly confirmed Phases 0, 1, 2, 6 and 7;
Phases 3–5 were derived from those confirmations and the owner's concrete scenarios.
The package was **explicitly accepted on 2026-08-03**. Before that acceptance:

- `validation-policy.yaml` keeps the 2026-07-31 baseline ratified and records this
  revision as `awaiting_phase8_acceptance`, `design_only: true`;
- HB-100…111 are not implementation authorization;
- no Planner/Validation Designer role, pipeline, prompt, TASTE or PURPOSE surface may
  be edited from this proposal; and
- no prior test evidence, live campaign or scheduler state proves the revised loop.

The exact decision requested is:

> **Accept the 2026-08-03 roadmap/validation/delivery-unit/batching revision as the
> binding implementation contract and authorize implementation to begin with HB-100,
> while preserving separate human approval for protocol-surface edits, external
> publication/deployment, merge, and live/eval/soak campaigns.**

### 10.2 Confirmed architecture and nomenclature

- **Planner** is the organizational role owning product intent, priority, workstreams,
  delivery-unit membership and ready-frontier proposals.
- **EpisodePlanner** is one shared capability that converts one admitted EpisodeIntent
  into an executable EpisodePlan. Roadmap planning and delivery are domain adapters over
  shared primitives; the implementation converges both on `orchestrateEpisode` without
  collapsing their schemas, validators, prompts or terminal artifacts.
- A **RoadmapPlan** is the durable whole-backlog planning artifact. One bounded planning
  session handles a content-hashed backlog snapshot (including 100+ issue fixtures),
  then future sessions consume the accepted plan plus a bounded delta.
- A **workstream** is a durable outcome/dependency/priority grouping. A **delivery
  unit** is one reviewable code change containing one-or-more tickets and producing
  exactly one PR/review/merge outcome. An **execution batch** is scheduler-owned
  co-scheduling of compatible execution units; it is never workflow authority.
- An **execution unit** is either a RoadmapPlan-backed code delivery unit or a complete
  direct operational unit. Code work is always roadmap-accounted. Complete non-code
  operational work may omit RoadmapPlan, but never EpisodeIntent/EpisodePlan,
  validation/evidence policy or effect authority.

The non-negotiable owner-confirmed rule is: cache/session optimization may reorder or
co-schedule units, but never changes membership, one-PR atomicity, validation
obligations, budget/evidence attribution, routing eligibility, effect authority, or
Reviewer independence.

### 10.3 Fast paths and the three calibration scenarios

1. **Ready-made complete code ticket:** strict structured intake may construct
   RoadmapPlan membership and the delivery EpisodePlan with zero provider turns. The
   durable artifacts, gates and independent review remain. Detailed prose or a label
   alone is insufficient.
2. **Small Support/event-discovered webpage defect:** if it proves the bounded low-risk
   criteria, governed roadmap/workflow/validation templates avoid portfolio debate and
   contract re-authoring. Because it changes code, it still receives roadmap accounting,
   one PR, gates and Reviewer. A future Jira adapter may provide normalized input; the
   revision does not claim one exists.
3. **Five Reddit destinations + LinkedIn + Twitter + follow-up:** a complete campaign
   may bypass RoadmapPlan and use one shallow Marketing content turn. Seven destinations
   remain seven exact payload approvals and seven execution acknowledgements. Follow-up
   observation may be deterministic; unknown replies become new units/plans when their
   content exists. B-17 real non-GitHub proof remains blocked and this design authorizes
   no post.

Any future `planning:preplanned` label is only a discoverability projection of a
persisted validated artifact ref+hash. Existing `op:ready`/`op:tier-*` labels do not
bypass EpisodePlanner or establish planning, validation, routing or effect authority.

### 10.4 Validation and assurance allocation

The revision registers M17, J-20, INV-016, B-20/B-21/B-22,
CORMIDIA-C-B20/B21/B22-001, C-OP-VALIDATION, C-OP-BATCH and S-10. The case catalog is
closed over J-01…J-20, INV-001…016, B-01…B-22, 29 canonical contracts and S-1…S-10.

- L1/L2 carry schema/graph/accounting, stable-ID, exact-hash, routing, waiver,
  all-or-none claim, lazy-plan, session-isolation, evidence-lineage, recovery and
  negative-control obligations.
- S-1 and S-10 quality remain L4 data collection with committed pre-tuning cases and
  `human_validation=pending`; F-PT-010/011 keep threshold-dependent outcomes
  inconclusive.
- There is no new campaign type or tool. Material batch/claim/session-reuse changes
  repeat the existing contention and seven-day soak obligations. Cache hit/miss/unknown
  is measured adapter evidence, never a correctness gate.
- B-17-L3, release-gating suspension, the threat-model gate, existing open findings and
  all human critical-operation approvals remain unchanged.

### 10.5 Implementation sequence

HB-100 is the walking skeleton: one two-ticket unit from RoadmapPlan through validation,
batch admission, lazy zero-turn EpisodePlan, atomic claim, synthetic PR/evidence and
independent review. HB-101…107 then deepen roadmap/delta state, validation authority,
multi-ticket delivery, batches/direct operations, fast paths and role-safe cache/session
reuse. HB-108 closes executable cases/goldens; HB-109 repeats contention/soak machinery;
HB-110 adds truthful operator surfaces. HB-111 only prepares exact proposed changes to
human-ratified protocol surfaces for separate human approval.

#239's `routing:human-only` enforcement is a prerequisite and is not reimplemented by
this backlog.

### 10.6 Phase 8 adversarial reader review

Three fresh-context perspectives were simulated against the completed artifact graph.
All findings are dispositioned; none requires a new product-truth finding.

| Reader | Finding | Disposition |
|---|---|---|
| Operator | “Batch complete” could be misread as every unit merged/published. | Fixed in C-OP-BATCH §5, CF-SM-BATCH and HB-110: complete means every unit has a typed disposition; per-unit failure remains visible. |
| Operator | A Jira example could be mistaken for a supported connector, and the social example for publication authority. | Fixed in C-OP-PLAN/C-OP-BATCH/HB-105: Jira is explicitly a future adapter; C-OP-BATCH/HB-106 and this package say no connector, live post or approval bypass is implied. |
| Operator | A label could be mistaken for the fast-path authority. | Fixed across C-OP-PLAN, B-20, INV-016, the proposed AGENTS addendum and HB-105: only a validated ref+hash artifact authorizes normalization/readiness. |
| New engineer | Newly named roadmap, validation and batch states were visible in case families but not their operation contracts. | Fixed: forward-only lifecycle vocabularies and crash authority are now explicit in C-OP-PLAN §2, C-OP-VALIDATION §2 and C-OP-BATCH §5. |
| New engineer | The policy and catalog still enumerated only the pre-revision IDs/counts. | Fixed: policy active-revision registry, INV-016/S-10/tooling entries, 29-contract resolver, new case families and closure arithmetic now agree. |
| New engineer | Exact storage paths are not selected. | Accepted as an implementation choice, not product truth; HB-101 requires selecting and pinning app-state paths/migration compatibility. Authority, identity and hash semantics are already fixed. |
| Coding agent | A component-by-component backlog could produce green islands without proving the joins. | Fixed: HB-100 is a provider-free vertical walking skeleton and every later ticket depends on it; its seeded lineage violation is the first negative control. |
| Coding agent | Current product-planning and delivery entry paths are asymmetric. | Fixed as an explicit HB-107 obligation: converge on `orchestrateEpisode`, retain domain adapters, and trigger existing L3 adapter proof only if invocation semantics change. |
| Coding agent | Human-ratified surfaces might be treated as ordinary implementation files. | Fixed: HB-111 is proposal-only; the proposed AGENTS addendum and this gate require separate explicit human approval for exact diffs. |

The review also removed one duplicate pre-existing CF-B02-L3 catalog row encountered
while recounting boundary closure; this changes no contract or coverage claim.

Verification on the isolated revision worktree: policy YAML and both changed golden-set
JSON files parse; registry/cardinality assertions and `git diff --check` pass;
`pnpm typecheck` and `pnpm build` pass. The final full offline run passes 145/145 files,
951 tests, with one intentionally parked skip. An earlier full run had one unrelated
CF-J12-I missing-journal failure; that exact test then passed in isolation and the full
suite passed on rerun. The failure was not hidden or converted into a design claim.

### 10.7 Phase 8 acceptance record

**ACCEPTED 2026-08-03.** In response to the final gate, the product owner selected and
returned the exact acceptance statement:

> Accept the 2026-08-03 roadmap/validation/delivery-unit/batching revision as the
> binding implementation contract and authorize implementation beginning with HB-100,
> while retaining separate approval for protocol-surface changes, merges,
> publication/deployment, and live/token-spending campaigns.

This closes Phase 8 and authorizes local, provider-free implementation beginning with
HB-100. It does **not** authorize changes to `TASTE.md`, `roles.yaml`, `pipelines.yaml`,
`prompts/**`, `docs/PURPOSE.md` or the binding `AGENTS.md` routing contribution; it also
does not authorize merge, publication/deployment, external effects, or live/eval/soak
campaigns. Acceptance makes the revision the implementation contract; it is not itself
executable coverage or operational evidence.

---

## 11. Harness-revision package — outcome acceptance (L-ACC) + jobs, 2026-08-07

### 11.1 Status

`validation-harness-design`, `harness-revision` mode, ratified artifacts as baseline.
Registered directly into the artifacts (the #336 precedent) rather than held as a
separate proposal file, with the **owner's review of the registering PR as the
confirmation gate**. Nothing here is binding until that review lands.

Full record: `harness-design-state.md` → "Harness revision — outcome acceptance (L-ACC)
+ jobs (2026-08-07)"; provenance in `elicitation-log.md`'s entry of the same name.

### 11.2 What changed, in one paragraph

Journeys J-21 (outcome-acceptance campaign) and J-22/J-23 (the jobs journeys
`docs/jobs/design.md` §14 named and left un-entered); module M18 (Jobs); boundaries
B-27/B-28/B-29 (the lane's own seams) and B-30 (jobs, alias `B-JOB`); their contracts;
campaign invariants `CORMIDIA-INV-ACC-1…7b` in a fenced registry; LLM site S-11 with an
unpopulated scaffold; the `l_acc_lane` policy block; and
`verdict_semantics.axis_score`, which makes `ungraded` policy rather than runner
discretion. **No existing gate, tier, control point, spend bound, threshold, or golden
set changed.** No runner was written and no campaign has run.

### 11.3 Decisions on the owner's desk

**Items 1–3 were answered by the owner on 2026-08-07, the day they were opened.** They
are recorded below as decisions taken, with their consequences, rather than as questions.
Items 4–5 remain for the PR review.

| # | Decision | Answer, and what it commits us to |
|---|---|---|
| 1 | **F-PT-029 — can a scored lane ever be release evidence?** | **NO BLOCKER.** L-ACC never gates a release and never enters RQ-1 completeness, verdict, or qualification; it sits permanently outside RQ-1 as disclosed assurance beside the soak and the threat model. Consequence: a bad campaign result is information you act on, and no surface may present it as a mechanical block. RQ-1 stays deterministic-first with no scored input. |
| 2 | **F-PT-030 — may an unattended campaign auto-continue past a scored plan gate?** | **YES**, through the campaign config's declared `plan_gate` policy — an end-to-end run is the point of a campaign. Four bounds are unchanged and are what keep this from being open-ended: the ratified rubric §6 criteria still decide (at least `attempted` on P-1 and P-5 for every scenario); the resolution is still recorded durably before any build-arm spend; the per-campaign envelope still bounds every token; approvals still run under the ratified sandbox test-mode profile, with human decisions never forged. A config with no declared policy still refuses — silence is not consent. |
| 3 | **F-PT-031 — INV-016's scope clause** | **CONFIRMED delivery-scoped**, with a nuance recorded rather than inferred: a job may be recurring and app- or org-scoped, and may be *associated* with a ticket, but a ticket is never mandatory for a job and such an association does not pull a job step into INV-016's domain — the precondition is a readiness transition, which no job step has either way. |
| 4 | **The registered structure itself** — J-21/J-22/J-23, M18, B-27…B-30, `CORMIDIA-INV-ACC-1…7b`, S-11, `l_acc_lane`, `axis_score` | That this is the right shape to build against. In particular: that the campaign invariants belong at L1/L2 as guardrails rather than in the expensive lane, and that they are fenced from the product invariant set so no future audit reads a harness promise as a product promise. |
| 5 | **The L-ACC spend posture** — per-campaign human authorization, no global ceiling | That an outcome-acceptance campaign is bounded the way L4 already is (`l4_numeric_ceiling`: "per immutable human authorization; no global value ratified") rather than by a number invented here. The §5 adapter/release bounds are deliberately **not** stretched to cover a build campaign. |

### 11.4 What ratification here does NOT make true

- It does not create a lane. HB-120…HB-129 are unwritten; HB-130 is parked behind
  item 1, item 2, and an exact campaign authorization.
- It does not qualify anything, gate any release, or authorize any token spend.
- It does not ratify a threshold. `acceptance/rubric.md` §5 declares none in v0, and
  this package introduces none — thresholds are ratified separately from run 1's
  observed distribution.
- It does not claim jobs are outcome-validated. The B-30 families prove the machinery;
  the only outcome measurement for jobs is CF-ACC-S3, a campaign rather than a gate.
