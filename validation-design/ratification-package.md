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
owner's own notes (real human input, unratified) — **as present in evidence when the
tag was minted**: every `[rambling]` tag counted below predates 2026-08-10 and cites
the superseded 2026-07-31 operator ramble, which the 2026-08-10 evidence sync
replaced with a new one-page `./rambling.txt` containing none of those passages;
historical tags resolve via `rambling-archive.md`, not the current file <!-- AUD-101
(audit rev-2026-08-10): historical scope added -->. `[elicited]`/`[walk]` the AI
stakeholder's campaign input, mostly doc-grounded. `[simulated]` the AI stakeholder's
own judgment beyond docs/rambling — **every one needs your eyes**. `[PROPOSED]`
designer-originated provisional values or structures (e.g. the B-06/B-07 rows)
<!-- scope correction 2026-08-10 (final-gate follow-up 7): "values" alone
understated the tag's ratified usage -->. `[stated]` was deliberately never used
*in the 2026-07-31 derivation artifacts counted below* <!-- historical scope
added 2026-08-10 (final-gate follow-up 6): later ratified revisions of the
corpus do carry `[stated]` rows (direct live owner input, e.g. boundary-map
headers), and rev-2026-08-10 minted none because no live human sat -->.
Note on rambling.txt itself: the **2026-07-31 ramble** was channeled by Claude from
the owner's recorded directives at the owner's request, and the owner reviewed and
confirmed it as his voice on 2026-07-31 — future auditors should apply that discount
when weighing `[rambling]` tags. <!-- ratification 2026-07-31: provenance
clarification adopted from reviewer pushback --> <!-- AUD-101 (audit
rev-2026-08-10): note scoped to the superseded file it describes; the current
./rambling.txt is the owner's own 2026-08-10 one-page ramble (target commit
15708a7e), diffed at §12.5 and elicitation-log.md § "rambling.txt diff". -->

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
auth; long-running work checkpoints and resumes (the superseded 2026-07-31 ramble's
rotation-race passage — no longer in the current ./rambling.txt; retention and the
2026-07-31 independent content-verification record: `rambling-archive.md` §3).
It was restored at audit iteration 1, dispositions round 2, after the AUD-101 correction over-removed it. The
row's two `[simulated]` occurrences are B-06's owner-ratified clock-anomaly ruling and
B-14's recorded-but-unencoded concurrent-edit preference. Verification standard:
content existence in the cited source, not tag-location count.
<!-- changelog 2026-07-31 (final-gate round 2): attribution corrected B-03 → B-06.
changelog 2026-07-31 (audit iteration 1): false rambling tag on B-06 removed.
changelog 2026-07-31 (audit iteration 1, dispositions round 2): B-03's genuine rambling provenance RESTORED
(it had been erased from the record, not just mis-located); every column recounted
from the corpus; compound-tag footnote added so the counts are reproducible.
changelog 2026-08-10 (audit rev-2026-08-10, AUD-101): the B-03 sentence's
"(rambling.txt, rotation-race passage)" current-fact wording rescoped to the
superseded 2026-07-31 ramble via rambling-archive.md — the 2026-08-10 evidence
sync replaced the file and the passage is no longer in it. -->

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
  this package introduces none — thresholds are ratified separately from the first
  **graded** distribution a campaign produces. <!-- clarified 2026-08-10 (reader
  test 9 / gate follow-up): this 2026-08-07 record originally said "run 1's
  observed distribution", written before run 1 ran; run 1 ended entirely ungraded,
  so the trigger is the first graded run, not run 1 by number. The historical
  intent is unchanged. -->
- It does not claim jobs are outcome-validated. The B-30 families prove the machinery;
  the only outcome measurement for jobs is CF-ACC-S3, a campaign rather than a gate.

---

## 12. Harness-revision package — steady-state reconciliation, rev-2026-08-10

### 12.1 Status and seat

`validation-harness-design`, `harness-revision` mode, **steady-state** re-entry against
the ratified corpus (diff base `ca6d0356` → `15708a7e`). The product-owner seat this
campaign was an **AI stakeholder agent** grounded in ./docs/ and ./rambling.txt;
nothing below is human ratification, and `[stated]` was not used. Everything in this
section is DRAFT until a real human works through §12.3. <!-- changelog 2026-08-12: one §12 surface has since been human-ratified — the traceability conventions + machine-catalog ADDENDUM (owner decision 2026-08-12, landed at validation-design/routing.md "Ratified addenda"); the five §12.3 seat decisions themselves remain DRAFT/pending. --> **This makes the older §§9–11
records unmistakably historical: they describe earlier revisions and their own
ratification events, not the current state.** Full revision record:
`harness-design-state.md` → "Harness revision — steady-state reconciliation…";
gate history: `elicitation-log.md`, same name.

### 12.2 What changed, in one paragraph

No module, journey, boundary, invariant, tier, lane, spend bound, threshold, or golden
set changed; M1–M18 unchanged. Registered: case family **CF-REVIEW-PROVIDER**
(catalog §10.2, Builder/Reviewer provider-family disjointness for autonomous code
delivery) with ticket HB-133; triggered ticket **HB-134** (GTM pre-launch obligations —
deliberately not a finding, by owner ruling); ticket **HB-135** (F-PT-019
operation-aware classifier implementation — the finding is resolved-ratified
2026-08-03, implementation owed); ticket **HB-136** (CF-J21-I kill-boundary sweep).
A consistency sweep reconciled stale current-state claims in seven mirror files
(inline changelogs at each edit; historical records untouched). New deliverables:
`case-catalog.yaml` (validation-architect/case-catalog/v1), `harness-state.yaml`,
`owner-briefing.md`, `owner-backlog.md`, and the normative traceability-conventions
block in `agents-md-contribution.md`.

### 12.3 Decisions taken in the AI stakeholder seat this revision — each needs human YES/NO

| # | Decision (provenance) | What YES commits you to |
|---|---|---|
| 1 | **"Different provider" means provider FAMILY for Builder/Reviewer in autonomous code delivery** — `[simulated]`: the seat resolved ambiguity beyond docs and rambling (docs/loop/design.md says "different provider"; rambling says "must not collapse"; neither says *family*, and the episodes contract's "independent or cross-provider" is looser). | CF-REVIEW-PROVIDER's five legs become contract truth: same-family refusal before provider construction, including distinct adapters over one shared upstream family; fail-closed on unresolvable family; jobs and manual-only routes exempt. NO requires you to state the unit you want (vendor product? account?). |
| 2 | **GTM enters as triggered ticket HB-134, not a finding** — `[simulated]` ruling on mechanism (the direction itself is `[doc]`, gtm-wip.md, explicitly WIP/non-normative). | The three trigger-children block their own trigger events (source bundles / license-metadata changes / first external user) and nothing else; no dependent behavior is conservative today. |
| 3 | **F-PT-019 three-part disposition** — `[doc]`-grounded (PURPOSE v2.15 §4 + gate.ts §5.2 comment), seat-worded: resolved-ratified / implementation owed under HB-135 / never "blocked" or "covered". | HB-135 is implementation-ready with no further decision gate; the detector lands with the implementing PR. |
| 4 | **CF-J21-A dispositioned PRUNE-dup:CF-INV-ACC-7a; CF-J21-I assigned to new ticket HB-136** — `[PROPOSED]`, from the status-honesty check (no citing spec existed). | The reconciliation family is owned once (at the implemented CF-INV-ACC-7a); the kill-boundary sweep is real owed work, not silently "design-only". |
| 5 | **The consistency-sweep edits themselves** (README counts rederived from the policy registry; PURPOSE v2.16 citation; L-ACC/adapter/jobs/HB-111 status corrections) — each `[doc]`-checkable at its inline changelog. | The corpus's current summaries match landed evidence as of `15708a7e`. |

### 12.4 Open questions a human must still answer (one added late in this revision)
<!-- changelog 2026-08-10 (final-gate follow-up 10): heading said "unchanged by
this revision" — true until F-PT-033 was minted at the final gate -->

**F-PT-033** (S-3 verdict-marker refusal semantics + vocabulary: ratify the
parser's deliberate duplicate-identical tolerance, keyword precedence, bare-line
form, and `approve|findings` vocabulary — or tighten the parser to the clause's
literal "refuses zero/two"; the landed tests record the lenient behavior as
pinned regression facts conferring no ratification, no NEW test may encode
either reading as contract truth, and the strict reading requires changing the
parser AND those tests <!-- changelog 2026-08-10 (final-gate follow-up 12):
this mirror still carried the disproven "assert only both-readings-valid
refusals" posture -->); F-PT-006, F-PT-008 (undecided product truth; HB-P3/HB-P5 parked);
F-PT-009, F-PT-010, F-PT-011 <!-- changelog 2026-08-10 (final-gate
follow-up 14): the slash-compressed "F-PT-009/010/011" defeated literal ID
extraction; spelled out so the 13-ID set equality holds mechanically -->
(eval thresholds — inconclusive-only); **F-PT-012 through F-PT-018** <!--
changelog 2026-08-10 (final-gate follow-up 13): §12.8u routed B-17 and
F-PT-014 here while this section omitted F-PT-012…018 and B-17-L3 entirely;
made exhaustive against the policy registry rather than re-routing the
citation --> (all open per the registry: F-PT-012 app-reset execute order;
F-PT-013 direct default-branch-push classification locus; **F-PT-014**
INV-003's never-scopeable clause with no gate-rule mapping — the unenforced
"must never break" promise; F-PT-015 B-14 bootstrap re-run semantics; F-PT-016
publish-origin identity-comparison ownership; F-PT-017 provider
terminal-status vocabulary, HB-P6 parked; F-PT-018 no mechanical branch
protection on the private-repo plan — open-known-limitation); **B-17-L3** (the
one BLOCKED live obligation: no disposable non-GitHub deploy/publish target
exists, so T-12's real round-trip has zero live evidence; unblock = a sandbox
app declaring a real disposable release target, HB-055); the #339 Grok vendor risk review (OPEN;
real-repo use blocked); L-ACC thresholds (ratified deferral, owed from the **first
graded distribution** a campaign produces — run 1 ended entirely ungraded, so the
trigger remains unmet; wording clarified 2026-08-10, reader test 9);
PROPOSED-register items 9–12 (first eval-campaign design review);
the episodes-contract "independent or cross-provider" wording tighten (proposal-only,
ratified surface).

### 12.5 Provenance statistics — this revision's edits

The baseline table in §2 is unchanged and still governs the pre-existing corpus. This
revision's provenance delta is deliberately small and reproducible by grep:

- **`[rambling]`: exactly one new citation** — the no-collapse passage
  ("must not collapse Builder and Reviewer onto the same provider"), cited at
  case-catalog §10.2 and mirrored in the harness-design-state revision record and
  elicitation log. (`grep -c rambling case-catalog.md` = 1.)
- **`[simulated]`: exactly one new seat decision** — the provider-*family*
  interpretation (§12.3 item 1), stated once in case-catalog §10.2 and mirrored at
  the state file, policy changelog, and elicitation log. One decision, multiply
  mirrored, needing one human YES. (`grep -c simulated case-catalog.md` = 1.)
- **`[PROPOSED]`: one designer-originated disposition** — the CF-J21-A/CF-J21-I
  split (PRUNE-dup + HB-136), §12.3 item 4.
- **`[doc]`: everything else.** Every consistency-sweep correction and every HB-134/
  HB-135 clause cites checkable doc or source evidence (docs/loop/design.md,
  PURPOSE v2.15 §4 + v2.16, docs/gtm-wip.md, gate.ts §5.2 comment, the #266/#337–#340
  landings) at its inline changelog.
- New generated artifacts (case-catalog.yaml, harness-state.yaml, owner docs)
  originate no provenance: they aggregate the tagged artifacts, and on disagreement
  the tagged artifacts win.

### 12.6 Machine-catalog generation and gate history — honest scope

`case-catalog.yaml` went through several corpus-gate rounds before settling, and the
final answer is structural, not cosmetic: **the manifest is now GENERATED from
`case-catalog.md` + `harness-backlog.md`** by a committed extraction tool
(`case-catalog-generator.awk`) that replicates the gate's own parsing — sections
from `##` headings, positional 5-column cells with HTML comments and bold stripped,
id-grammar expansion (brace-covers, `-*` bases, slash/plus suffix families),
first-mention ticket ownership over bold-marker segments, `LANDED`-adjacency ticket
statuses, and wave tokens from section headings. Hand-authoring the manifest in
parallel with the markdown produced 1,638 disagreements in one gate round; deriving
it produced zero locally-detectable ones.

To make both surfaces parse identically, the markdown itself was repaired (inline
changelogs at each site): the §5 per-ID resolver and all §10 tables were reshaped to
the standard 5-column layout; §9.1's evidence ledger got a "Ledger — " prefix so
bookkeeping is never parsed as family cells; three state-machine cells' inline pipe
characters were replaced; `CF-C-B30`'s cell id was made parseable; CF-J21-A's prune
token moved to its cell head; and `harness-backlog.md` gained explicit family
mentions for every previously prose-implied ownership, a ticket-status register, and
three retrospective record tickets (HB-137 adapters, HB-138 splits, HB-139
regression deposits) so every implementable family resolves to a named ticket —
records of landed work, never new work or re-authorization.

Derived counts (from the generator run; recompute, never hand-edit): **396 families
= 357 implementable + 38 pruned + 1 blocked; 100 tickets = 82 landed + 18 pending.**
The family count grew from the draft's 349 because the gate's id grammar expands
slash-collapsed cells (CF-SM-*-L/I/R/C and the per-site qual/traj/judge cells) into
individual families — an id-resolution change, never a coverage-claim change.
The sandbox permitted no YAML interpreter, so final parse verification rests with
the corpus gate itself and the first repo CI run. Grep cross-checks: no remaining
"PURPOSE v2.17", "F-PT-025 stays parked", or catalog "BLOCKED:F-PT-019" strings; the
owner-backlog ticket-ID set matches the backlog exactly. No test, CI lane, or
product file was touched — this campaign is design-only and ran no token-spending
operation. One honest note for the human: CORMIDIA-CASE-DET-004 predates the CF-
namespace, is invisible to the machine grammar, and remains tracked in the §10.3
markdown only.

### 12.7 Phase 8 adversarial reader test — findings and dispositions (2026-08-10)

Three fresh-context readers (production operator, new engineer, coding agent) saw
only `./validation-design/`. Dispositions:

| Reader finding | Disposition |
|---|---|
| Operator 1–3 (BLOCKING/SIG): triage runbook was a pointer stub outside the corpus; no symptom-indexed entry point; no what-to-do guidance | **Fixed:** `operator-triage-runbook.md` rewritten as a self-contained symptom-indexed triage map (12 symptom rows, first-moves, escalation criteria, standing prohibitions), every row citing its ratified structures; canonical packaged mapping still wins on conflict. README bullet updated |
| Operator 2 (BLOCKING): corpus cannot know live state | **Fixed in-part / accepted-as-designed:** runbook §0 now leads with the establish-live-reality command sequence and states the corpus's dated-snapshot limitation explicitly; the corpus remains, by design, not a deployed-state oracle |
| Operator 4 (SIG): no authored threat model for adversarial triage | **Accepted as designed + routed:** the gap is real, declared (HB-072 awaiting human author), and the runbook's adversarial row now says escalate-first with the interim floor named. Authoring remains on the owner's desk |
| Operator 5 (SIG): red-gate/ceiling semantics lacked operator actions | **Fixed:** runbook rows for returned units, ceilings, and `inconclusive` |
| Operator 6–7 (MINOR): ID density, staleness-caveat load | **Accepted:** mitigated by the README glossary and the new runbook; inherent to a corpus this size |
| New-engineer 1: Wave-0 tickets read as greenfield | **Fixed:** STATUS-FIRST banner at the top of `harness-backlog.md` naming the actual open set |
| New-engineer 2: no enforced YAML-regeneration check | **Fixed structurally:** ticket **HB-140** (regeneration drift gate, per-commit, red-then-green against a seeded hand-edit) opened; adoption notes reference it |
| New-engineer 3: `[doc]` numbers could drift from excluded docs | **Accepted as designed:** the README already declares non-self-containedness; the numbers are inlined so tests are writable |
| New-engineer 4: HB-005(d) required a three-document chase | **Fixed:** co-location pointer added at HB-005(d) |
| New-engineer 5: B-02 contract positive control | No action (positive finding) |
| Coding-agent 1+4 (SIG/MINOR): landing-status semantics ambiguous across stacked addenda | **Fixed:** status-semantics preamble added at the top of `agents-md-contribution.md` — one meta-rule for all sections; landing verified against the repo's AGENTS.md, never this file; rev-2026-08-10 conventions honored for new work now, enforced only when the trace CLI lands |
| Coding-agent 2 (SIG): bug-fix routing omitted the catalog-row obligation | **Fixed:** obligation stated in the routing doc's Bug-fixes paragraph AND tightened into the policy's `case_sourcing:` block (single source of truth) |
| Coding-agent 3 (MINOR): no fallback when `implement-harness-ticket` is unavailable | **Fixed:** explicit fallback in the adoption notes (hand-implement per conventions 1–5, declare it; escalate only on ambiguous enumeration) |

Manifest regenerated after these edits: 396 families unchanged; tickets now
**101 = 82 landed + 19 pending** (HB-140 added). Companion ticket-ID diff: empty.

### 12.8 Reader test, second round (2026-08-10) — findings and dispositions

A second fresh-context pass ran after the §12.7 fixes; no blocking gaps on the
routing/contract questions; dispositions:

| Finding | Disposition |
|---|---|
| Operator 1 (SIG): F-PT-008 shape (approved, grant expired pre-resume) had no runbook row | **Fixed:** runbook row added — open-design-question semantics, observe-and-record, never reflex re-approve |
| Operator 2 (SIG): direct default-branch push with no PR had no row; F-PT-013 not surfaced | **Fixed:** runbook row added — distinguishes human vs agent push; an agent push escalates AS F-PT-013 firing, not as a known-good behavior failing |
| Operator 3: "escalate to the human" undefined for solo deployment | **Fixed:** runbook §2 decodes it — you ARE the human; switch to deliberate owner-mode decisions, never machine-speed self-fixes |
| Operator 5: no operator tiebreak for paired-artifact disagreement | **Fixed:** runbook §2 — human-ratified artifact wins (md over generated yaml; policy over machine state); never hand-edit the generated file |
| Operator 4/6: ID density; threat-model absence | **Accepted** (glossary mitigates; absence is declared and routed) |
| New-engineer 1 (BLOCKING as framed): backlog reads as a build target but is mostly a record | **Fixed further:** README read-order item 10 now says so up front (the in-file banner from §12.7 already existed and was found) |
| New-engineer 2: `[doc]` clauses not verifiable in-corpus | **Accepted as designed** (declared non-self-containedness; values inlined) |
| New-engineer 3 (SIG): threshold-placeholder asymmetry unexplained | **Fixed:** llm-eval-plan header note — S-1/3/4 numbers are owner-voiced 2026-07-31 hypotheses; later sites deliberately bare under F-PT-011 so no invented value fossilizes |
| New-engineer 4 / coding-agent 4: layer taxonomy defined nowhere in one place | **Fixed:** README glossary row (L1…L5, L-ACC) pointing at the canonical policy block; routing doc now cites `validation-policy.yaml → layers:` inline |
| New-engineer 5/6: closure self-audited; HB-140 open | **Accepted / already tracked** (HB-140 is the enforcement ticket) |
| Coding-agent 2: boundary-map read instruction passive | **Fixed:** imperative added to the Feature-changes paragraph |
| Coding-agent 5: YAML regeneration stated only for bug fixes in the ratified body | **Fixed:** Feature-changes paragraph now carries it explicitly |
| Coding-agent 3: landing status not self-verifiable in-corpus | **Accepted as designed** (the meta-rule's safe default stands) |

None of these edits touched the generator's inputs (`case-catalog.md` tables,
`harness-backlog.md`); the manifest remains byte-identical under regeneration.

### 12.8b Reader test, third round (2026-08-10) — findings and dispositions

A third fresh-context pass ran after the §12.9 gate (post-gate corpus edits staled
the prior review). No blocking routing/contract gaps; dispositions:

| Finding | Disposition |
|---|---|
| Operator 1 (blocking-for-symptom): no dead-child-fresh-heartbeat row | **Fixed:** runbook row — journal phase over heartbeat; owned-process-group kill only; B-07's own nightmare named |
| Operator 2 (SIG): no Jobs/`cormidia-job` row | **Fixed:** runbook row — journal is sole completion authority; zero-turn resume; changed-config refusal; `completed (unverified)` distinction |
| Operator 4 (SIG): no provider-down/auth-expiry row | **Fixed:** runbook row — fail-closed expectations (checkpoint, resume-exact-or-honest-stop, usage unknown-never-$0) with violation criteria |
| Operator 6: no event-never-fired row | **Fixed:** runbook row surfacing F-PT-006 as an open question with preserve-the-bytes guidance |
| Operator 3 (SIG): F-PT-014 promise/enforcement gap not surfaced | **Fixed:** runbook §1.5 "Known enforcement gaps" + a README warning bullet — the INV-003 outside-worktree leg has no rule mapping today |
| Operator 5/7: F-PT-018 and F-PT-017 not operator-visible | **Fixed:** both in runbook §1.5 (bounded merge protection; `interrupted` vs `timed_out` vocabulary) |
| Operator 8: canonical triage doc out of scope | **Accepted as designed** (runbook is the self-contained fallback) |
| New-engineer 1 (SIG): landed implementation unverifiable in-corpus | **Accepted as designed** (disclosed; machine summary in harness-state.yaml; recorded thrice now) |
| New-engineer 2: "walking skeleton" name collision | **Fixed:** naming note in the STATUS-FIRST banner |
| New-engineer 3: HB-140 still TODO | **Already tracked** (it is the enforcement ticket) |
| New-engineer 4: HB-072 `Owner:` broke the Executor convention | **Fixed:** normalized to `Executor:`; HB-073 given its explicit executor too |
| New-engineer 5: no example L-ACC ceiling numbers | **Accepted as designed** (per-campaign human authorization is the ratified bound; a template number would be a ceiling nobody set) |
| Coding-agent 2: "§10" ambiguous across 10.1/10.2/10.3 | **Fixed:** routing doc says §10.3 defect register explicitly |
| Coding-agent 3: regeneration mechanism buried in adoption notes | **Fixed:** command now stated at the obligation itself |
| Coding-agent 4: golden-case catalog obligation ambiguous | **Fixed:** explicit rule — golden cases grow sets, not the matrix; only new sites/envelope defects touch the catalog |
| Coding-agent 5: landing status not closable in-corpus | **Accepted as designed** (meta-rule's safe default stands) |

Manifest verified **byte-identical** after these edits (the backlog text changes
added no tokens the generator parses).

### 12.8c Reader test, fourth round (2026-08-10) — findings and dispositions

| Finding | Disposition |
|---|---|
| Operator 1 (SIG): no FS/git-substrate symptom row | **Fixed:** runbook row — bounded `index.lock` wait, never steal a foreign lock, ENOSPC/quarantine semantics, remote-identity stop |
| Operator 2 (SIG): F-PT-004 preserve-and-inspect not in the table | **Fixed:** runbook row — never reset ambiguous post-crash bytes; escalation only if preservation itself failed |
| Operator 3 (SIG): no app-reset/T-8 row; F-PT-012 invisible | **Fixed:** runbook row — plan-mode first, archive-first, `--force` rules, and STOP on a killed reset with F-PT-012 named |
| Operator 4: no exit-0-lying toolchain row | **Fixed:** runbook row — evidence binds to candidate SHA; truncation bounds; bare template fails closed |
| Operator 5: §1.5 read as the complete qualifying list | **Fixed:** §1.5 reframed as operator-salient sample; names where every other parked finding lives and why F-PT-015/016 have no symptom row |
| Operator 6: `golden-sets/README.md` stale (13/11, no acceptance-grader) | **Fixed:** counts corrected to 14/12 with acceptance-grader named; drift-tiebreak noted (eval plan wins) |
| Operator 7: no non-launchd-host guidance | **Fixed:** scheduler row — launchd-only proof surface; treat non-launchd as unproven, prefer human-invoked turns |
| New-engineer 1: landed work unverifiable in-corpus | **Accepted as designed** (fourth recording; disclosed with machine summary) |
| New-engineer 2/3/4: HB-140 pending; HB-054 flagged exception; counts need cross-file arithmetic | **Already tracked / accepted as designed** (self-flagged in the artifacts themselves) |
| New-engineer 5: Waves 1–4 layer inheritance under-signposted | **Fixed:** convention paragraph bolded with the heading-names-the-layer pointer |
| Coding-agent 1: ops-row vs OP-*.md name collision | **Fixed:** disambiguated at the point of use in the Feature-changes paragraph |
| Coding-agent 2: landing status unresolvable in-corpus | **Accepted as designed** (meta-rule default stands; recorded) |
| Coding-agent 3: cheapest-layer heuristic lacked a worked example | **Fixed:** digest rule 1 now carries the B-01 retry-budget worked example plus the borderline-call guidance and its two bounding guardrails |

Manifest verified **byte-identical** after these edits.

### 12.8d Reader test, fifth round (2026-08-10) — findings and dispositions

| Finding | Disposition |
|---|---|
| Operator 6 (SIG): `boundary-map.md` carried stale "open" statuses for F-PT-025/027 against the canonical policy registry (partial-update drift — siblings 026/028 were updated, these were not) | **Fixed:** all four stale sites corrected (§1 header claim, both in-body failure-mode phrasings, both §4 entries) with the resolutions restated from the policy; the policy-wins rule noted at each changelog |
| Operator 7 (SIG): no runbook row for the B-23…B-26 adapters and their typed gate-proof refusals | **Fixed:** runbook row — `error_gate_not_observed`/`error_gate_unproven`/`error_gate_seam_unavailable` are the gate WORKING; version-banded claims; Grok sandbox-only pending #339; a turn proceeding WITHOUT its gate proof is the T-11 incident |
| Operator 8: tiebreak rule didn't cover prose-vs-policy finding-status drift | **Fixed:** general rule added — on any F-PT status disagreement, `validation-policy.yaml → open_findings` wins; prose is a stale mirror to repair |
| Operator 9/10/11: canonical runbook out-of-corpus; glossary added late; F-PT-017 found via §1.5 | **Accepted / informational** (all disclosed by the artifacts themselves) |
| New-engineer 1: convention note claimed L3/L4/L5 tickets state Layer inline; the file's formatting contradicts it | **Fixed:** the convention sentence itself corrected |
| New-engineer 2: HB-140 still open | **Already tracked** |
| New-engineer 3: HB-072 lacked Acceptance/Defends | **Fixed:** pointers added (risk-allocation §6 scope, template, hash-bound status admission) |
| New-engineer 4/5: task-framing trap; ~7 load-bearing open findings await the owner | **Accepted / informational** (both are the corpus telling the truth) |
| Coding-agent 3: `layers:` pointer incomplete for L-ACC | **Fixed:** routing text now names `l_acc_lane:` as L-ACC's home |
| Coding-agent 4: derivation-grammar rows lacked a pointer at point of use | **Fixed:** "the eight §1–§8 matrices of case-catalog.md, in that order" |
| Coding-agent 1/2/5/6/7/8: sufficiency confirmations; multi-layer document quirk | **No action / accepted** (meta-rule stands) |

Manifest verified **byte-identical** after these edits.

**Stakeholder-gate follow-up (2026-08-10):** the gate review caught six further
stale labels in `boundary-map.md` that the §12.8d repair had missed — B-23's
heading/"Unproven real"/"until the adapter lands", B-24's heading (contradicting
its own "Proven real" body), and B-25's heading/"Unproven real". All six corrected
toward the canonical landed/certified state with inline changelogs; B-25's #339
real-repo restriction preserved verbatim and restated at the corrected site.
Manifest byte-identical throughout.

### 12.8e Reader test, sixth round (2026-08-10) — findings and dispositions

No blocking findings in any seat. Dispositions:

| Finding | Disposition |
|---|---|
| Operator 3 (SIG): F-PT-014's enforcement gap invisible at INV-003's own Enforcement line | **Fixed:** stated at the point a face-value reader trusts — INV-003's Enforcement line now names the parked guardrail leg |
| Operator 4 (SIG): open-finding honesty reads as reassurance, not a role change | **Fixed:** runbook §1.5 framing — "no rule to follow; you are the decision-maker; the scripted part is only the posture" |
| Operator 6: two shapes of `inconclusive` (threshold-unratified vs set-unpopulated) one hop apart | **Fixed:** the runbook's `inconclusive` row now distinguishes (a) and (b) with the golden-sets pointer |
| Operator 1/2/5/7/8: canonical-doc dependency; absent threat model; changelog density; thin non-launchd fallback; pair cross-check burden | **Accepted as designed / already routed** (HB-072 and HB-140 own the fixable halves; the rest is disclosed structure) |
| New-engineer 2: contracts' `Status: DRAFT (Phase 4)` headers give no cold-open binding signal | **Fixed:** README warning — headers are retained gate-history trace (AUD-105); ratification lives in the policy and §9; never down-weight a DRAFT-headed contract |
| New-engineer 3: HB-P3/P5/P6/P7 broke the every-ticket-carries-fields rule | **Fixed:** Layer/Defends/Acceptance added to all four parked tickets (prose ids only — cells stay BLOCKED in the catalog) |
| New-engineer 1/4/5: task framing; HB-140 pending; sampled-not-exhaustive closure check | **Accepted / tracked** (recorded in prior rounds; closure remains machine-checked by the generator) |
| Coding-agent 1: rev-2026-08-10 addendum lacked its provenance link (AI seat, §12 DRAFT) | **Fixed:** provenance paragraph added to the addendum |
| Coding-agent 2: bare artifact paths never re-anchored to `validation-design/` | **Fixed:** anchor restated in "Where truth lives" |
| Coding-agent 3: §10.3-as-precedent double duty unstated | **Fixed:** digest wording makes the intended precedent use explicit |
| Coding-agent 4: feature-change paragraph didn't restate the generator command/inputs | **Fixed:** cross-reference added, incl. the always-two-inputs note |

Manifest verified **byte-identical** after these edits.

### 12.8f Reader test, seventh round (2026-08-10) — findings and dispositions

No blocking findings in any seat; every routing question verified answered. Dispositions:

| Finding | Disposition |
|---|---|
| Operator 3: `p1–p3` used but glossed nowhere | **Fixed:** OP-loop §1 gloss — ordinal urgency, RoadmapPlan projection, never authority |
| Operator 4: T-1…T-12 not sequenced for simultaneous fires | **Fixed:** system-map §5.2 sequencing note — restates the rows' own consequence rationale (least-recallable first: §5.5 shape, then T-12/T-8/T-7, then internally recoverable); explicitly no new ranking decision |
| Operator 6: tiebreak rules findable, not skimmable | **Fixed:** one-line policy-wins banner at the runbook top |
| Operator 2/5: canonical doc out-of-corpus; open-finding legs | **Accepted as designed** (structural; already framed in §1.5) |
| New-engineer 1–6: task framing; HB-140; F-PT-014; HB-054 exception; PROPOSED numbers; `[simulated]` provenance chains | **Accepted / already tracked** — every item is the corpus telling the truth about itself; F-PT-014 and provenance transparency are §12.4/§12.3 material for the human |
| Coding-agent 1: `FLOOR` (and STD/THIN/L4Q) not glossed in the file the routing doc points to | **Fixed:** risk-allocation now carries the seven-tag vocabulary gloss, incl. FLOOR = non-discretionary, never thinned or waived |
| Coding-agent 2: §9.1 ledger obligation for feature-derived triggered-lane rows unstated | **Fixed:** routing doc states the rule — curated evidence ledger, owed when evidence lands, never at derivation |
| Coding-agent 4: inaccurate "per the YAML's own header" citation | **Fixed:** citation corrected (header states the obligation; the command lives in the routing doc) |
| Coding-agent 3: four-layer provenance comprehension tax | **Accepted** (meta-rule resolves it; recorded) |

Manifest verified **byte-identical** after these edits.

### 12.8g Reader test, eighth round (2026-08-10) — findings and dispositions

| Finding | Disposition |
|---|---|
| Operator 1 (SIG): no B-10/B-10a org-identity symptom row | **Fixed:** runbook row — cross-command agreement check, explicit `org use` only, identity failures multiply every other row |
| Operator 2 (SIG): no B-18/B-19 comparative-execution row | **Fixed honestly:** row states the subsystem is DESIGN-ONLY and unbuilt; any live artifact claiming otherwise is a structural surprise to escalate |
| Operator 3 (SIG): no B-20/21/22 silent-wrongness row | **Fixed:** runbook row — exact-accounting, own-journal, hash-chain first moves; violations of exact machine promises escalate with the record |
| Operator 4: no B-11/T-10 learning row | **Fixed:** runbook row — state-chain check, forward-complete-or-no-op replay, poisoned-active-concept escalation |
| Operator 5: nothing tells a paged reader to skip to the runbook | **Fixed:** first warning bullet in README |
| Operator 6/7: unverifiable external canonical doc; ID density | **Accepted as designed** (recorded across rounds) |
| New-engineer 1/2 (SIG): task framing; `[doc]` wire-level facts out of scope | **Accepted as designed** (fifth recording; the corpus's own declared non-self-containedness) |
| New-engineer 3/4: scattered status bookkeeping; HB-140 pending | **Accepted / tracked** (the banner names the machine truth; HB-140 is the closure) |
| New-engineer 5: nine parked-finding IDs compressed into range notation | **Fixed:** enumerated explicitly in the README bullet |
| New-engineer 6/7/8: open-ticket buildability, layer-gating, numeric-tolerance verifications | No action (positive verifications) |
| Coding-agent 1: policy `case_sourcing` said "section 10", routing doc says §10.3 | **Fixed:** the single source of truth now carries the same precision |
| Coding-agent 2 (SIG): no mid-change WIP disposition for a discovered structural mismatch | **Fixed:** routing doc — never merge either side of the contradiction; split; land what stands alone; park structure-dependent work pending the revision |
| Coding-agent 3: feature-introduced new LLM call site's obligations unstated | **Fixed:** a new site is registered structure (new S-id → harness-revision) and owes its golden-set scaffold |
| Coding-agent 4: structural-mismatch trigger named only the boundary map | **Fixed:** now names system-map §5.2 control points and risk-allocation tiers too |

Manifest verified **byte-identical** after these edits.

### 12.8h Reader test, ninth round (2026-08-10) — findings and dispositions

| Finding | Disposition |
|---|---|
| Operator 1 (SIG): no T-3 protocol-surface-tampering symptom row | **Fixed:** runbook row — authorship first (human ratification-business vs agent guardrail-failure); an agent-authored protocol edit is the compound-worst-case leg: stop autonomous turns, preserve bytes, escalate |
| Operator 2 (SIG): no B-17/T-12 external-effect ambiguity row | **Fixed:** runbook row — marker records before anything; never re-run to "check"; states plainly that B-17-L3 is the corpus's one BLOCKED boundary, so contract text is the only map |
| Operator 3: no row distinguishes a quality `fail` (impossible today) from a deterministic one | **Fixed:** corollary added to the `inconclusive` row — a campaign `fail` is always the deterministic contract layer |
| Operator 4: tiebreak logic split across three framings | **Fixed:** runbook §2 declared the canonical statement; §0 line and README warning declared summaries of it |
| Operator 5: per-incident canonical cross-check latency | **Accepted as designed** (the runbook's non-canonical disclaimer is deliberate) |
| New-engineer 1/2 (SIG): task framing; `[doc]` literal-I/O layer out of scope | **Accepted as designed** (sixth recording; the corpus's declared non-self-containedness — test-shape yes, literal fixtures need ./docs/) |
| New-engineer 3: "own-layer gating" rule read as absolute despite named exceptions | **Fixed:** the rule now acknowledges its three named exceptions (HB-054/HB-081/HB-135) and states an UNNAMED cross-layer gate remains a design defect |
| New-engineer 4/5/6: HB-140 pending; B-01 no-staleness-bound permanence; DRAFT headers | **Accepted / tracked / previously dispositioned** |
| New-engineer 7–11: tolerance, findings, layer, closure, ticket-shape verifications | No action (positive verifications) |
| Coding-agent 1 (SIG): path-resolution rule over-broad — addenda cite repo-root paths | **Fixed:** the convention now distinguishes design-artifact paths (validation-design/-relative) from repo-root paths (`acceptance/**`, `docs/**`, protocol surfaces), naming the policy `artifacts:` block as the machine resolver |
| Coding-agent 2: `owner-backlog.md` regeneration had no stated method | **Fixed:** adoption notes state the procedure (prose rewrite, no script by design) and the mechanical ticket-ID-diff check |
| Coding-agent 3: threshold condition stale after run 1 ended ungraded | **Fixed:** trigger restated — the first *graded* distribution, not "run 1" by number |
| Coding-agent 4: changelog comments interleave normative sentences | **Accepted** (provenance discipline; the cost is recorded) |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8h (2026-08-10):** the stakeholder review caught residues
of the round-9 fixes across TWO passes: (1) the "first graded distribution"
trigger clarification had not been mirrored — **seven** sites ultimately carried
the stale "run 1's distribution/data" wording: `validation-policy.yaml`
`l_acc_lane.thresholds`, `llm-eval-plan.md`'s S-11 header **and its §2 S-11
thresholds paragraph** (the sixth, caught on the second gate pass),
`ratification-package.md` §11.4 and §12.4, `owner-briefing.md` §5, and
`system-map.md`'s J-21 row (the seventh, caught in the same sweep). All seven now
state the trigger is the first **graded** run (run 1 ended entirely ungraded),
with the §11.4 historical record clarified by annotation rather than rewritten,
and a corpus-wide grep confirms no further instances outside changelog text.
(2) The documented companion ticket-ID check was one-directional (`comm -23`),
missing owner-only stale IDs; corrected to set-equality (`comm -3`) and re-run
clean in both directions (101 IDs each side). Manifest byte-identical throughout.

### 12.8i Reader test, tenth round (2026-08-10) — findings and dispositions

All three seats returned a **sufficient** verdict with no blocking findings; the
coding-agent seat independently corroborated the §12.7–§12.9 self-audit trail.
Dispositions of the residual minors:

| Finding | Disposition |
|---|---|
| Operator 1: paged-reader jump note absent from the numbered read-order itself | **Fixed:** stated at item 11 in the list, not only in the prose warnings |
| Operator 3: B-18/B-19 built-vs-design status only decodable via provenance tags | **Fixed:** both headings now carry "(DESIGN-ONLY — nothing built; HB-090…094 open)" |
| Operator 2/4/5: canonical doc out-of-scope; external citations; past-drift pattern | **Accepted as designed** (disclosed structure; HB-140 + the policy-wins rule are the standing mitigations) |
| New-engineer 4: bare-by-design threshold asymmetry explained only in the eval-plan header | **Fixed:** rationale restated at the golden-sets entry README |
| New-engineer 1/2/3: HB-140 pending; task-framing; changelog-comment reliance | **Tracked / accepted** (recorded across rounds) |
| Coding-agent 5/6: preamble read-cost; comment interleaving | **Accepted** (friction, recorded; the meta-rule and current-state sentences are correct) |

Manifest verified **byte-identical** after these edits.

### 12.8j Reader test, eleventh round (2026-08-10) — findings and dispositions

All three seats again returned **sufficient** verdicts with no blocking findings;
this is the third consecutive round in which every residual is either a
re-observation of disclosed structure or reader friction. Dispositions:

| Finding | Disposition |
|---|---|
| Coding-agent 3: no single summary of the four sections' ratification postures | **Fixed:** status-at-a-glance table added to the routing doc's preamble |
| Operator 3 (SIG as framing): ~nine open findings have no prescribed action by design | **Accepted as designed** — this is exactly §1.5's "you are the decision-maker" framing, which the reader itself calls "good honesty, not a documentation defect"; the corpus tells the truth about where rules end |
| Operator 1/2/4/5; new-engineer 1/3/4/5; coding-agent 1/2 | **Accepted as designed / tracked** — canonical-doc dependency, command-output semantics, read-order length, design-only categories, non-self-containedness (`[doc]` layer), HB-140, DRAFT headers, landing-status discipline: all disclosed by the corpus itself and recorded across prior rounds |

**Convergence note:** rounds 9–11 produced zero blocking findings, and the minor
sets are shrinking and increasingly self-referential (readers now cite the corpus's
own self-audit trail as corroboration). The reader-test loop has converged.

Manifest verified **byte-identical** after this round's single edit.

### 12.8k Reader test, twelfth round (2026-08-10) — findings and dispositions

Three genuinely new significant findings this round (after three convergent
rounds), all fixed; dispositions:

| Finding | Disposition |
|---|---|
| New-engineer 1 (SIG): HB-133's `[simulated]` provider-family ruling not visible at the ticket itself | **Fixed:** provenance caveat added at HB-133 — implementing is authorized, but the disjointness unit is a pending-ratification input to build as swappable, not inlined |
| New-engineer 2 (SIG): HB-135's classification rule lived only in out-of-corpus files | **Fixed:** the ratified PURPOSE v2.15 §4 rule reproduced in full at the policy's F-PT-019 `resolution` field (the single source), and HB-135 points there — the ticket is now implementable from the corpus alone |
| Coding-agent 1 (SIG): neither routing category literally covered "the ratified text is contradicted by reality" | **Fixed:** the new-finding gloss now names the contradicted-docs shape with its five-precedent trail, plus an explicit clause-vs-shape routing rule for contract contradictions |
| Operator 2 (SIG): "severity vocabulary: T-1…T-12" read as a graded ladder | **Fixed:** both citation sites now say consequence vocabulary — C3-equal control points; the ladder is C1/C2/C3 |
| New-engineer 4: HB-112 lacked an Acceptance field | **Fixed:** acceptance criteria added |
| Coding-agent 2: convention 9's "layer-6" is the corpus's only such phrasing | **Fixed by annotation** in the adoption notes (the verbatim block cannot be edited): layer-6 = the L-ACC lane at `l_acc_lane:` |
| Operator 1/3/4/5/6; new-engineer 3/5 | **Accepted as designed / tracked** (canonical-doc dependency, command semantics, ID density, tiebreak redundancy, no-playbook open findings, unparsed-YAML disclosure + HB-140, task framing) |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8k (2026-08-10):** the stakeholder review caught that the
F-PT-019 entry now carried **two sibling `resolution:` keys** — the §12.8k fix had
been added above a pre-existing condensed resolution line, which strict YAML
parsers reject and permissive ones resolve by silently keeping the older, shorter
text (shadowing exactly the full rule HB-135 depends on). Repaired: the condensed
duplicate removed (its content fully subsumed by the reproduced PURPOSE v2.15 §4
text, with a supersession note recorded in the surviving value), the entry's
closing brace restored, and a per-entry duplicate-field scan over the whole
`open_findings` block run clean. Manifest byte-identical throughout.

### 12.8l Reader test, thirteenth round (2026-08-10) — findings and dispositions

Fourth convergent round: all seats sufficient, zero blocking findings, operator
seat explicitly reporting "no case where the artifacts would cause a wrong
action." Dispositions:

| Finding | Disposition |
|---|---|
| Operator 2: paged-reader redirect still not literally first in README | **Fixed:** one-line banner now leads the file |
| Operator 3: B-14 build-time findings reachable only via finding ids | **Fixed:** §1.5 names the B-14 seam and routes its ratified half to the covering rows |
| New-engineer 3: "rule 17" cited without a pointer | **Fixed:** both citations now name the rule and its in-corpus text location |
| Operator 1/4/5; new-engineer 1/2/4/5; coding-agent 5/6/7 | **Accepted as designed / tracked** — canonical-doc dependency, ID density, absent threat model (HB-072), task framing, HB-140, blocked-cell discipline (called "exemplary" by the reader), annotation density, landing-status deferral, stacked-addenda length: all previously recorded, all disclosed by the corpus itself |

Manifest verified **byte-identical** after these edits.

### 12.8m Reader test, fourteenth round (2026-08-10) — findings and dispositions

| Finding | Disposition |
|---|---|
| Operator 1 (SIG): the runbook doesn't disclose its own AI-seat/DRAFT provenance to the reader it routes | **Fixed:** provenance paragraph in the runbook header — facts restate ratified structures; the file's assembly is DRAFT pending human ratification |
| Operator 2 (SIG): same-family Builder/Reviewer observation has no symptom row while the interpretation is pending | **Fixed:** runbook row distinguishing the unambiguous same-PRODUCT violation from the undecided same-family case, whose observation is ratification evidence for §12.3 item 1 |
| Coding-agent 1 (SIG): "Blocked work" read as the exhaustive blocked set | **Fixed:** declared non-exhaustive with the fuller enumeration and a scan-before-picking-up instruction pointing at the two complete registers |
| Coding-agent 2 (SIG): the layer-6 gloss won't survive the verbatim block's landing | **Fixed:** the landing edit must carry the gloss as an adjacent line outside the frozen block, in the same change |
| New-engineer 3: LANDED register masks embedded parked clauses | **Fixed:** register preamble states LANDED ≠ total clause closure, with the HB-040/HB-012 examples |
| Coding-agent 3/4: invariants.md lacked a read-first pointer; path rule read as illustrative | **Fixed:** invariant-row read-first instruction added; the path rule restated as closed (`./`-prefix in the policy `artifacts:` block) |
| Operator 3 (SIG as coverage): B-17 has zero live validation | **Accepted as designed** — disclosed at the boundary, in the runbook row, and blocked on a disposable target (HB-055); the corpus cannot manufacture live evidence |
| Operator 4/5/6/7; new-engineer 1/2/4/5; coding-agent 5/6 | **Accepted as designed / tracked** — canonical-doc dependency, adapter-heading drift class (policy-wins rule + HB-140 pattern), absent threat model, ID density, task framing, HB-140, HB-133's flagged dual state, sampling caveat, annotation density, landing-status deferral |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8m (2026-08-10):** the stakeholder review caught that the
blocked-work fix contradicted itself — it declared the list non-exhaustive, then
called the backlog's "Parked" section a complete set, which is wrong for HB-055
and HB-073 (they live in their wave sections). Corrected: completeness is scoped
to the finding-parked P-ticket category only; the whole-backlog scan is stated as
the sole guarantee. Manifest byte-identical throughout.

### 12.8n Reader test, fifteenth round (2026-08-10) — findings and dispositions

| Finding | Disposition |
|---|---|
| Coding-agent 1 (SIG): the bug-fix obligation never reconciles with traceability convention 2 — an unplanned fix has no owning HB ticket to cite | **Fixed:** `agents-md-contribution.md` bug-fix subsection now states the rule — the fix's spec cites its `CF-REG-<issue>` family plus **HB-139** (the standing regression-deposit record) as owner, appending the family to HB-139's backlog list and regenerating the catalog; no fresh ticket is minted for already-landed work (the HB-137…139 pattern, now normative rather than merely historical) |
| Coding-agent 2 (SIG): no HB-id minting procedure exists, unlike the F-PT next-id procedure | **Fixed:** minting procedure added beside the bug-fix rule — next unused sequential id by scanning the backlog and the catalog's tickets list (never memory); placement by provenance (existing revision section or new dated section, never inside a LANDED wave's history); standard fields; catalog + owner-backlog regeneration in the same change |
| Coding-agent 3: golden-case pointer lacked the §7 citation for scaffold enumeration/authoring priority | **Fixed:** `llm-eval-plan.md` §7 cited at the golden-case obligation |
| New-engineer 5: HB-133's "implementation-ready" headline overstates relative to its own provenance caveat | **Fixed:** the hedge hoisted into the ticket's title line — "ready" = buildable with the FAMILY unit swappable, not semantically settled |
| New-engineer 6: per-directory READMEs say literal `OPEN` while the provisional numbers live elsewhere with no co-location pointer | **Fixed:** `golden-sets/README.md` scaffold-fields rule now points from the `OPEN` label to `validation-policy.yaml → proposed_register` as the numbers' single home |
| Operator 3: two tiebreak clauses (pair-disagreement vs finding-status drift) read as potentially competing | **Fixed:** runbook note — one principle at two grains ("ratified source of truth beats its mirror"); where both apply they select the same winner, the policy file |
| Operator 1/2 (runbook DRAFT provenance residue; B-17 zero live proof), operator 4/5/6, new-engineer 1 (HB-002 fixture schema lives in the [doc] layer — moot for builders since HB-002 is LANDED), new-engineer 2/3/4, coding-agent 4/5/6, all decision-maker-adjacent repeats (canonical-doc dead end, task framing, HB-140, density, §12 DRAFT status) | **Accepted as designed / previously dispositioned** — each already carries an in-corpus disclosure recorded in §12.8–§12.8m; no new information class |

Manifest verified **byte-identical** after these edits (the HB-133 title edit
introduces no new status/mention tokens).

**Gate follow-up to §12.8n (2026-08-10):** the stakeholder review caught two
live contradictions the mechanical checks cannot see. (1) `owner-backlog.md`'s
HB-133 entry still said unqualified "implementation-ready" after the source
ticket's hedge was hoisted — the empty ticket-ID diff proves set equality, not
prose freshness; the owner entry was regenerated from the source ticket with the
same caveat. (2) The "single source of truth → `case_sourcing:`" sentence landed
directly after the two NEW procedures (HB-139 citation, HB-id minting), implying
the policy is canonical for mechanics it does not contain; the sentence is now
scoped — the policy is canonical for the detector/catalog-row deposit obligation
only, while the two procedures are canonical in the routing doc itself. Manifest
byte-identical and companion ID diff empty after both fixes. **(3)** A residue of
fix 2 — "appear in no other artifact" — was itself literally false against this
section's own disposition records; restated as a canonical-vs-mirror rule: the
procedures are canonical only in the routing doc, other artifacts may record or
summarize them, and the routing doc wins on disagreement.

### 12.8o Reader test, sixteenth round (2026-08-10) — findings and dispositions

All three seats judged the corpus **sufficient for their roles**; the
coding-agent seat reported zero gaps beyond previously-dispositioned minors and
verified every routed path, section number, and matrix ordering against the
actual files. Two refinements were actionable:

| Finding | Disposition |
|---|---|
| Operator 1 (SIG): the runbook's provenance paragraph discloses DRAFT assembly but a paged reader cannot tell, row by row, which part of a triage row is ratified fact vs DRAFT judgment | **Fixed:** row-by-row rule added to the provenance paragraph — cited IDs/contract text are the ratified part; symptom mapping, first-move choice, and escalate-vs-act framing are the DRAFT overlay; on any seeming disagreement the cited primary artifact wins and the row is a corpus bug |
| Operator 5: paired-artifact drift has a tiebreak but no stated detection method — the operator must notice disagreement by inspection | **Fixed:** concrete one-command drift check added at the tiebreak (the generator-`cmp` pipeline for the catalog pair; F-PT id/status comparison for the policy/state pair, which has no generator), with HB-140 named as the eventual per-commit gate |
| Operator 2 (SIG): command output semantics unclosable from this corpus alone | **Accepted as designed / previously dispositioned** — the [doc]-layer boundary; the corpus is a design corpus, not the product manual, and says so at §0 |
| Operator 3/4/6; new-engineer 5/6/7 (task framing, HB-140 unguarded until landed, [doc]-value currency risk); coding-agent 5/6/7 (path-rule hop, skill locations pre-neutralized by fallbacks, changelog density) | **Accepted as designed / previously dispositioned** — each already recorded in §12.8–§12.8n with its in-corpus disclosure |
| New-engineer 1/2/3/4/8/10 and coding-agent 1/2/3/4 | **Positive sufficiency verifications** — no action; noted that the reader independently confirmed the §9 arithmetic, the proposed_register discipline, the HB-139 mechanism, and the BLOCKED-cell format |
| New-engineer 9 (sampled-confidence self-limitation) | **No action** — a property of the review, not the corpus; recorded for the human ratifier's calibration |

Manifest verified **byte-identical** after these edits (runbook-only changes).

**Gate follow-up to §12.8o (2026-08-10):** the stakeholder review found face-value
defects in both round-16 fixes. (1) The row-by-row rule claimed every cited ID is
ratified — false for the pending-ratification CF-REVIEW-PROVIDER family unit and
the proposed, unbuilt B-18/B-19, both cited by the runbook itself; corrected to
the minimal form: each citation retains its primary source's own status
(ratified/`OPEN`/`PROPOSED`/pending) and citation confers nothing. (2) The drift
check directed comparison against a `harness-state.yaml` `findings:` block that
does not exist (the file carries only the `open_ratification_items` prose
summary; the policy names `harness-design-state.md` as its mirror); corrected to
an exact, verified command — `grep -o 'id: F-PT-[0-9]*, status: [a-z-]*'
validation-policy.yaml | sort` prints all 32 canonical id/status pairs
(count-verified against the registry) — with prose mentions in any artifact
checked against that printout, policy wins. Manifest byte-identical after both
fixes. **Second follow-up (final-gate follow-up 5):** two residual
contradictions around the corrected text. (1) The provenance paragraph still
said rows restate "independently ratified structures," contradicting the
row-by-row rule below it; rephrased — rows cite checkable primary structures
whose source statuses vary (ratified, `OPEN`, `PROPOSED`, pending). (2) The
drift paragraph still promised "one command" and still framed
policy ↔ harness-state.yaml as a paired-artifact relationship despite the
no-findings-block acknowledgment; resolved via the honest-labeling option — the
catalog pair is the only one-command check; the grep is labeled a canonical
reference printout that compares nothing; prose-status drift is declared a
manual audit with no executable end-to-end check; the pair framing replaced
with generated-pair vs summary-mirror language. README verified to carry no
parallel contradiction. Manifest byte-identical.

### 12.8p Reader test, seventeenth round (2026-08-10) — findings and dispositions

Sixth convergent round: all three seats judged the corpus sufficient; the
coding-agent seat again verified every routing claim byte-for-byte against the
real files. Five new minors were actionable:

| Finding | Disposition |
|---|---|
| Operator 4: provenance tags recur everywhere with only scattered local definitions — the README ID glossary covers namespaces but not tags | **Fixed:** glossary row added defining all seven tags in one place, pointing at ratification-package.md §2 as canonical and llm-eval-plan.md §9 for `[PROPOSED]` semantics |
| Operator 7: the B-01…B-30 ACTIVE/PENDING-ADAPTER/BLOCKED roll-up exists only in the policy's L3 obligations block, discoverable but unadvertised | **Fixed:** boundary-map header now names that block as the single at-a-glance status table ("status rather than semantics") |
| New-engineer 3: B-08 §5's "~5 min" cadence figure was untagged while the adjacent WIP=2 carried `[doc]` | **Fixed:** tagged `[doc]` after verifying provenance against the product docs (architecture doc states "fires every ~5 min") — not assumed |
| Coding-agent 2: the contract-routing sentence's filename shapes miss `contracts/provider-adapter-core.md` (`CORMIDIA-C-CORE-001`), which B-02/03/04 reference and never restate | **Fixed:** routing sentence now names the shared provider core explicitly and warns that a literal glob misses it |
| Coding-agent 3: the repo's real `AGENTS.md`/`CLAUDE.md` — the file's one external activation anchor — had no stated path | **Fixed:** "both at the repo root, beside `validation-design/`" added at the meta-rule |
| Operator 1/2/3/5/6; new-engineer 1/2/4/5; coding-agent 1/4 | **Accepted as designed / previously dispositioned** — runbook DRAFT provenance, out-of-corpus canonical triage doc, command-output semantics, policy changelog density, absent threat model, task framing, HB-140, HB-133 hedge, cold-start cost, changelog density, skill locations (fallbacks pre-neutralize) |
| New-engineer 6 | **Positive verification** — no contract in the sample contradicted the findings register; no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8p (final-gate follow-up 6, 2026-08-10):** two round-17
fixes were inconsistent with their sources. (1) The new README tag-glossary row
drifted from canonical §2 — `[elicited]`/`[walk]` are the AI stakeholder's
campaign input (not necessarily owner answers), `[PROPOSED]` also tags
structures (B-06/B-07), and §2's "`[stated]` was deliberately never used" needed
historical scope (later ratified revisions carry `[stated]` rows; rev-2026-08-10
minted none). Row rewritten against §2; §2 scoped. (2) The boundary-map pointer
called the policy's L3 block a complete status table while six entries had no
status field and CF-B23/B25/B26 still said `PENDING-ADAPTER` with "adapter
lands" unblock conditions despite the recorded 2026-08-07 certifications. The
policy block was reconciled rather than the pointer weakened: explicit
`status: ACTIVE` on the six standing obligations (with the block-level note
that ACTIVE means can-run-when-triggered, never has-run), CF-B23/B26 moved to
`ACTIVE` + `certified:` citing their landed adapters, CF-B25 to `ACTIVE`
sandbox-scope with the #339 real-repo restriction and precondition-never-evidence
note preserved verbatim, and the 2026-08-07 comment scoped as historical.
Verified: all **11** L3 obligations now carry explicit statuses <!-- count
corrected 2026-08-10 (final-gate follow-up 7): first record said 13 — the awk
scan's block terminator let the L5 block leak into the count; re-run scoped
strictly to the L3 block: 11 ids, 11 statuses --> (the five
status-less ids the first check surfaced live in the separate
`L5_ops.obligations` block, outside the pointer's claim). Manifest
byte-identical.

**Gate follow-up to §12.8p, second round (final-gate follow-up 7, 2026-08-10):**
three precise corrections from the stakeholder. (1) Canonical §2 itself still
defined `[PROPOSED]` as provisional "values" only while the README said "values
or structures"; §2 corrected to "values or structures (e.g. the B-06/B-07
rows)". (2) The recorded L3 obligation count (13) was wrong — strict re-count
gives 11, all with statuses; corrected above with the cause named. (3)
CF-B26-L3's bare `certified:` field conflated the adapter/fail-closed
certification with the L3 obligation, whose canonical outcome is **INCOMPLETE,
never pass** (boundary-map B-26: the 2026-08-07 walk did not run; no live seam;
swarm probe unprovable on that build); field relabeled `adapter_certification`,
`current_l3_outcome: INCOMPLETE` added, and the `ACTIVE` status annotated as
runnable-on-trigger only, not a pass claim. Manifest byte-identical.

### 12.8q Reader test, eighteenth round (2026-08-10) — findings and dispositions

Seventh convergent round: all three seats sufficient. The operator seat's five
core questions all answered "Yes" from the corpus alone; the coding-agent seat
re-verified every routed line number. Four items actionable:

| Finding | Disposition |
|---|---|
| Coding-agent 2 (SIG): the bug-fix path's structural-defect sentence never says the skill-unavailable stop-and-escalate rule applies to it — a mid-fix agent had to infer it | **Fixed:** the sentence now states the same rule applies on the bug-fix path: stop and escalate, never improvise the structural change mid-fix |
| Coding-agent 6: the mandatory whole-backlog/catalog scan was manual with no pattern named, in a corpus documenting a past failure of exactly this kind | **Fixed:** concrete grep commands added (backlog `BLOCKED\|PARKED\|Gate:`; catalog `BLOCKED:` — widened after checking that a finding-only pattern missed 6 non-finding tokens like `BLOCKED:B-17-L3`; hit counts verified live: 15 and 19), with the caveat that judging whether a hit blocks YOUR ticket is still a read |
| New-engineer 2: B-07's "bounded grace period" is the one ratified timing clause with no figure — a test author might invent one | **Fixed:** the contract now states the duration deliberately carries no figure — the ratification fixed the ORDER, not the wait length; tests assert sequence + boundedness with duration as configuration; a figure is owner-owned via `proposed_register` then ratification |
| New-engineer 3: case-catalog §5's "five parts generate the row set" overstates for OP-* contracts (organized per operation, combined error section) | **Fixed:** scope note added — B-* files follow the five labeled headings; OP-* rows derive from the same five dimensions in per-operation prose; byte-identical regeneration re-verified after the prose edit |
| Operator 7/8/9/10/11/12 (F-PT-014, F-PT-017, F-PT-006, out-of-corpus #339 justification, tag density, manual prose-drift audit); new-engineer 1/4/5 (task premise, HB-133 thin family mapping, certified-incomplete misread risk); coding-agent 3/4/5 (external AGENTS.md anchor, layer heuristic not procedure, changelog density) | **Accepted as designed / previously dispositioned** — every one already carries its in-corpus disclosure; the operator seat itself notes these are handed-to-the-operator decisions, not silent omissions |
| Operator 1–6; new-engineer sufficiency list; coding-agent 1 | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8q (final-gate follow-up 8, 2026-08-10):** two round-18
fixes were incomplete. (1) The new blocked-work grep was case-sensitive and
missed 29 lowercase blocked/parked lines — including the live #339 real-repo
restriction; replaced with `grep -niE 'blocked|parked|gate:'` (47 hits verified
live), with the read-each-hit caveat absorbing the extra historical matches;
the catalog pattern stays case-sensitive after verifying block tokens are
uppercase by grammar (case-insensitive and -sensitive counts both 19). (2) The
§5 scope note covered only two of the three contract shapes; widened to name
`journey-acceptance.md` as journey-shaped Given/When/Then whose catalog
treatment is the CF-C-ACCEPT `PRUNE-dup` row into the §1 journey cells.
Byte-identical regeneration re-verified after the prose edit. Manifest
byte-identical.

### 12.8r Reader test, nineteenth round (2026-08-10) — findings and dispositions

Eighth convergent round: all three seats sufficient; the coding-agent seat found
zero coverage gaps ("what's missing is not coverage but polish"). Four items
actionable:

| Finding | Disposition |
|---|---|
| Operator 1 (SIG): `owner-briefing.md` §2 — the plain-English never-break page — is unreachable from the paged-operator fast path, which never cites it | **Fixed:** runbook companion note added directly above the symptom table, routing to §2 as the no-IDs one-pager (non-normative; invariants.md stays canonical) |
| Operator 2: the symptom table uses nine ID namespaces but never links the one-page glossary | **Fixed:** same companion note names every prefix and points at `README.md` § "ID glossary" — "keep it open beside this table" |
| New-engineer 8: the cross-layer-exception sentence (HB-054/081/135) is accurate but unenforced — a future ticket could silently violate it | **Fixed:** the rule is now self-defending — any new cross-layer ticket MUST add itself to the sentence in the same change, omission itself being the named design defect, with the case-insensitive `Gate:` grep named as the audit path |
| Coding-agent 1: the clause-vs-shape routing rule was stated only for contracts/boundaries; the invariant analogy had to be inferred | **Fixed:** the split now stated for invariants explicitly, with F-PT-014 (INV-003's unmapped clause, opened as a finding rather than a redesign) cited as the in-corpus precedent |
| Operator 3/4/5/6/7 (no per-boundary one-line index — prose-per-boundary is the stated design, with the runbook table + policy roll-up + grep as the indexes; absent threat model; B-17/B-26 unproven seams; provenance meta-rule burden; per-mirror drift commands); new-engineer 4/5/6/7/9 (rubric digest gap, HB-140, HB-133, F-PT-017/HB-P6, scale friction); coding-agent 2/3 (fallback placement — confirmed inferable and cross-referenced; changelog density) | **Accepted as designed / previously dispositioned** — each carries its in-corpus disclosure, recorded across §12.8–§12.8q |
| New-engineer 1/2/3 and sufficiency lists; coding-agent 4–8 | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits (including after the
backlog banner edit).

**Gate follow-up to §12.8r (final-gate follow-up 9, 2026-08-10):** the new
fast-path companion note had two literal defects. (1) It sat ~60 lines above
the table it claimed to sit directly above; relocated to immediately before the
§1 symptom table. (2) Its "every ID prefix" list was wrong in both directions —
it listed `S-` and `M-`, which the table does not use in those forms, and
missed `C-OP-`, `CORMIDIA-C-`, and `L-ACC`, which it does; list corrected to
the prefixes actually present (`T-`, `INV-`, `B-`, `F-PT-`, `HB-`, `CF-`, `J-`,
`C-OP-`, `CORMIDIA-C-`, `L-ACC`, `M1…M18`), each verified resolvable in the
README glossary before being named. Manifest byte-identical.

### 12.8s Reader test, twentieth round (2026-08-10) — findings and dispositions

Ninth convergent round: all seats sufficient; no blocking findings at any seat.
One genuinely new significant finding and two actionable minors:

| Finding | Disposition |
|---|---|
| Coding-agent 1 (SIG): the `REG` risk value sits on every §10.3 precedent row agents are told to imitate, yet is absent from the catalog legend, `risk-allocation.md`, and the routing doc's seven-tag vocabulary — a depositing agent cannot tell whether to reuse or replace it | **Fixed in all three places:** defined as the eighth risk value, reserved for §10.3 defect-register rows — the risk is the specific regression the detector pins, not a derivation tier; never valid on §§1–8 rows, never budgeted through risk-allocation §4; tier tags never valid on §10.3 rows. Byte-identical regeneration re-verified after the catalog legend edit |
| Coding-agent 2: the tag-sourcing and read-first rules were stated only under "Feature changes"; a bug fix's tag inheritance had to be inferred | **Fixed:** bug-fix paragraph now states the §10.3 tagging rule outright — Risk always `REG`, Layer where the detector lands, read-first obligations applying only insofar as the fix touches those rows |
| New-engineer 3 (SIG): the state file's Pending-confirmations section accretes 19+ round records in append order, some superseding earlier ones, forcing defensive reading | **Fixed:** a how-to-read note now leads the section — append order, later-appended entry wins, canonical disposition record is §12.7–§12.8+ of this package |
| Operator 1/2 (threat model absent; runbook DRAFT provenance); operator 3–6 (navigation cost, B-17, B-26 heading-vs-row, decision-maker findings); new-engineer 1/2/4/5/6 (task framing, HB-140, DRAFT contract headers, HB-133, indirection tax); coding-agent 3 (layer heuristic residual ambiguity) | **Accepted as designed / previously dispositioned** — every one carries its in-corpus disclosure, recorded across §12.8–§12.8r |
| Operator 7; new-engineer sufficiency list; coding-agent 4 | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

### 12.8t Reader test, twenty-first round (2026-08-10) — findings and dispositions

Tenth convergent round: no blocking findings at any seat; the coding-agent seat
verified every cross-reference it checked "matched the target file exactly."
Four actionable:

| Finding | Disposition |
|---|---|
| Coding-agent 1 (SIG): read-first sources (`boundary-map.md` failure-mode lists, `invariants.md` seeds) have no WRITE obligation — a defect teaching a new failure mode could leave them silently stale | **Fixed:** write-back obligation added beside the §10.3 tagging rule — a deposit (or L3/L4-surfaced deterministic defect) revealing an unenumerated failure mode or adversarial shape appends it to the artifact in the same change with a dated changelog; additive enrichment is tighten-only and NOT structural; a *contradiction* routes via clause-vs-shape instead; these files have no generator, so the append IS the regeneration discipline |
| New-engineer 3 (SIG, narrow): the S-3 verdict-marker grammar existed nowhere in-corpus — the positive-parse case of HB-005(d) was unbuildable without inventing syntax | **Fixed:** grammar reproduced at `contracts/OP-loop.md` §4 with `[doc]` provenance verified against the product docs before reproducing (design.md §6: the four accepted status/verdict forms, value vocabularies, finding-line grammar with unicode/ASCII delimiters, exactly-one-marker rule, one reformat turn then loud infra failure) |
| Coding-agent 3: L-ACC feature routing was assembled from three scattered mentions | **Fixed:** single starting sentence added inside the feature-change grammar paragraph — L-ACC (§8b) is the one lane outside the eight-row grammar; start from addendum convention 8 + `l_acc_lane` |
| Operator 2: the F-PT-017 disclosure never said which string to actually grep for | **Fixed:** practical grep rule added — search `timed_out` (what production emits), not `interrupted` (the contract word), or both for mixed-vintage artifacts |
| Operator 1/3/4/5/6 (out-of-corpus canonical triage doc, runbook DRAFT assembly, caught-drift volume, absent threat model, B-17); new-engineer 1/2/4/5/6 (HB-140, hand-maintained gate sentence, [doc]-scope, state-file structure, HB-133); coding-agent 2 (changelog parsing tax) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8s |
| Sufficiency statements at all three seats | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8t (final-gate follow-up 10, 2026-08-10):** the
stakeholder found the round-21 grammar reproduction contained a substantive S-3
contradiction that, under the corpus's own clause-vs-shape rule, required an
explicit finding — not a silent contract rewrite. Minted **F-PT-033**
(open-blocked-contract; next-id procedure — the Phase 0 "do not mint F-PT-033
for GTM" ruling was a subject veto, not a number reservation): the corpus clause
said "exactly one `VERDICT: APPROVE|REJECT` marker; parser refuses zero/two,"
while the running parser deliberately parses duplicate IDENTICAL markers
(refusing only DISTINCT conflicts), applies Verdict-before-Status keyword
precedence, uses `approve|findings`, and accepts a fourth bare-line form that is
a code+template addition beyond design.md §6's three `[doc]` status formats.
Corrections in the same change: OP-loop §4 re-attributed per form ([doc] vs
code+template) with refusal semantics routed to the finding; llm-eval-plan §2
S-3 corrected with original wording preserved in the finding's subject;
HB-005(d) scoped to both-readings-valid refusals; README count/range
(thirty-three, F-PT-001…033); runbook §1.5 operator entry; §12.4, the
design-state mirror, and harness-state.yaml's summary updated. No catalog cell
was added or parked, so family/ticket counts are unchanged. Manifest
byte-identical. **Second follow-up (final-gate follow-up 11):** the stakeholder
caught that the follow-up-10 wording itself contradicted the landed test —
`tests/unit/s3-verdict-marker.test.ts` explicitly asserts duplicate-identical
markers parse and pins Verdict-before-Status precedence, so "tests assert only
both-readings-valid refusals" was literally false. Repaired at all four sites
(OP-loop §4, F-PT-033's subject, HB-005(d), this record) with the honest
minimal form: the landed tests **record current implementation behavior as
pinned regression facts and confer no ratification**; no NEW test may encode
either answer as contract truth; choosing the strict reading would require
changing the parser AND those tests, red-then-green whichever way the owner
decides. Manifest byte-identical. **Third follow-up (final-gate follow-up 12):**
two live mirrors still carried the disproven posture — llm-eval-plan §2 S-3
("neither reading testable until ratified") and §12.4's F-PT-033 entry ("tests
assert only both-readings-valid refusals"); both replaced with the same
record-but-don't-ratify wording. Historical quoted/changelog occurrences remain
as history per the stakeholder's ruling. Manifest byte-identical.

### 12.8u Reader test, twenty-second round (2026-08-10) — findings and dispositions

Eleventh convergent round: all seats sufficient; the coding-agent seat found "no
blocking or significant gaps." The operator's two "[blocking]" items are the
long-disclosed system-maturity holes (B-17 zero live proof; F-PT-014's
unenforced INV-003 clause) — real risks, but §12.4 human-owned material, not
documentation defects, per their standing dispositions. Three actionable:

| Finding | Disposition |
|---|---|
| New-engineer 1 (SIG): the STATUS-FIRST banner is prose-only — a reader opening straight to "## Wave 0" has no structural stop before reimplementing landed work | **Fixed:** a LANDED — historical spec blockquote now sits directly under the Wave 0 heading ("Do NOT implement from this section"); the wave heading itself untouched (the generator parses wave tokens from headings); byte-identical re-verified |
| Operator 8: findings with no symptom row (F-PT-015/016) were reachable only by prior knowledge of the IDs | **Fixed:** catch-all final row added to the symptom table — "Your symptom is not in this table" routes to §1.5's enumeration, the registry drift-grep, and the preserve-evidence/new-finding path |
| Coding-agent 2: the read-first instruction implies one canonical failure-mode heading; boundary-map labels vary (split forms at B-15/B-27) | **Fixed:** label variance named at the instruction with the grep-for-`ailure modes` guidance |
| Operator 1/2 (B-17, F-PT-014 — [blocking] as risk, disclosed as design); operator 3–7 (command semantics, threat model, F-PT-033 as drift precedent, changelog density, B-18/B-19 heading-tag reliance); new-engineer 2 (HB-140); coding-agent 1/3 (density, external AGENTS.md anchor) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8t |
| New-engineer 3–7 (verified closure arithmetic, provisional-tag discipline, clause-level findings, layer traceability, self-policing gates honored on inspection); coding-agent routing verifications | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8u (final-gate follow-up 13, 2026-08-10):** §12.8u
called B-17 and F-PT-014 "§12.4 human-owned material" while §12.4 named
neither and omitted F-PT-012…018 entirely. Resolved by making §12.4 exhaustive
rather than re-routing the citation: F-PT-012 through F-PT-018 added with
one-line subjects (F-PT-014 explicitly flagged as the unenforced "must never
break" promise), and B-17-L3 added as the one BLOCKED live obligation with its
unblock condition. Verified against the registry: all 13 `open*` findings
(006/008/009/010/011/012–018/033) now appear in §12.4. Manifest byte-identical.
**Second follow-up (final-gate follow-up 14):** the slash-compressed
"F-PT-009/010/011" defeated literal ID extraction (11 of 13 tokens); spelled
out as `F-PT-009, F-PT-010, F-PT-011` and re-verified — a literal grep of
§12.4 now extracts exactly the 13 open IDs, so the set equality holds
mechanically, not just semantically. Manifest byte-identical.

### 12.8v Reader test, twenty-third round (2026-08-10) — findings and dispositions

Twelfth convergent round: no blocking documentation gaps (the new-engineer's
[BLOCKING] item is the exercise's own task premise — "implement the walking
skeleton" — colliding with the corpus's accurate disclosure that both
skeleton-named things LANDED; the corpus cannot rewrite the exercise prompt and
already routes readers to the genuinely open set, per its standing
disposition). Five actionable:

| Finding | Disposition |
|---|---|
| Operator 1 (SIG): B-08's "two asymmetric nightmares" (spawn decision w/o child; child w/o bookkeeping → duplicate temptation) had no symptom row despite INV-014's named reason code | **Fixed:** dedicated symptom row added — both shapes distinguished, the `post_spawn_bookkeeping_failure` reason code named (failure shape verified in `boundary-map.md`; reason code verified in `invariants.md` <!-- corrected 2026-08-10, final-gate follow-up 15: the first record claimed the code was verified in both files, but boundary-map.md carries the shape, not the code string -->), B-07 ownership-token rule invoked against hand-killing the unaccounted child |
| Operator 5: B-12's traversal/token/scope failure class routed only via the generic secrets row | **Fixed:** dedicated row — out-of-scope exposure is a B-12 access-control failure class distinct from INV-011 secrets, with the capture/check/escalate sequence |
| New-engineer 5: B-13's §OPEN block sits below the main clauses; a fast reader authoring against §2 could miss that it overrides | **Fixed:** read-§OPEN-first blockquote at the top of §2 naming F-PT-006's scope |
| Coding-agent 1: `archive-do-not-read/**` comes from `protected_paths:`, outside the `./`-prefix path-resolution rule's stated scope | **Fixed:** path note — repo-root resolution, with the observation that either resolution leaves the obligation identical |
| Coding-agent 3: no template for a change spanning sections with different ratification postures | **Fixed:** mixed-posture rule under the at-a-glance table — most restrictive posture wins the change description; each touched posture named |
| Operator 2/3/4 (runbook DRAFT assembly, out-of-corpus canonical doc, changelog density); new-engineer 1/2 (task premise, no skeleton-shaped open ticket — same premise), 3 (DRAFT headers), 4 (HB-140); coding-agent 2 (density), 4 (single worked example), 5 (no CI enforcement pre-HB-140) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8u |
| All three seats' sufficiency/verification statements | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8v (final-gate follow-up 15, 2026-08-10):** the B-08
disposition over-claimed its own verification — `post_spawn_bookkeeping_failure`
appears only in `invariants.md` (line-verified); `boundary-map.md` describes the
bookkeeping-failure *shape* without the code string. Corrected to the precise
split: failure shape verified in `boundary-map.md`, reason code verified in
`invariants.md`. The runbook row itself was correctly sourced and needed no
change. Manifest byte-identical.

### 12.8w Reader test, twenty-fourth round (2026-08-10) — findings and dispositions

Thirteenth convergent round: no blocking findings at any seat; the operator
answered all six framing questions from the corpus alone; the new-engineer
verified gating discipline against every `Gate:` marker and found zero
violations outside the three named exceptions; the coding-agent confirmed
`provider-adapter-core.md` is the *only* alias-table exception by checking every
contract header. Two actionable:

| Finding | Disposition |
|---|---|
| Operator 1 (SIG): the ~32-row symptom table has no short first-pass index — hard to scan in a terminal pager at 2am | **Fixed:** a numbered one-entry-per-line quick-scan list (32 entries) now precedes the table, mirroring it 1:1 in table order, derived from the real rows, with the rule that the full row wins on any divergence <!-- corrected 2026-08-10, final-gate follow-up 16: the first version was a dot-separated inline paragraph, making "one line per row" literally false; reformatted to actual bullets --> |
| Coding-agent 4: posture bookkeeping is pure convention with no mechanical hint, unlike the blocked-work scan | **Fixed:** one-command re-check added at the mixed-posture rule (`grep -n 'Ratification posture'` jumps to the table) |
| Operator 2/3/4/5 (ID sprawl, runbook DRAFT caveat, briefing/invariants split, B-17); new-engineer 1/2/5 (task premise, HB-140, contract-shape variance — documented); coding-agent 1/2/3 (density, layer heuristic, skill locations) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8v |
| New-engineer 3/4/6–10 (B-07 pattern, HB-133 handling, tolerance/finding/layer/closure/gating verifications); operator sufficiency list; coding-agent verification list | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8w (final-gate follow-up 16, 2026-08-10):** the
quick-scan fix's presentation claim was literally false — "one line per row"
described a dot-separated inline paragraph wrapped across 13 source lines.
Chose the reformat option over relabeling: the 32 entries are now actual
numbered one-per-line bullets, and all three claim sites (the runbook itself,
§12.8w's disposition, the state mirror) were corrected together. The 1:1
row mapping was already correct and is unchanged. Manifest byte-identical.

### 12.8x Reader test, twenty-fifth round (2026-08-10) — findings and dispositions

Fourteenth convergent round: no blocking findings; every routed claim the
coding-agent cross-checked "checked out." Six actionable:

| Finding | Disposition |
|---|---|
| Coding-agent 1 (SIG): bare "§7" named two different files' sections in one paragraph (llm-eval-plan §7 scaffolds vs case-catalog §7 call-site matrix) with no flag | **Fixed:** collision disambiguated at the point of use — "a DIFFERENT §7" named explicitly, the catalog reference relabeled **catalog-§7**, matching the ops/OP-* precedent |
| New-engineer 3 (SIG): HB-134 broke the every-ticket-carries-fields rule (no Layer, no Defends) and rests on a non-normative out-of-corpus source | **Fixed honestly, not invented:** Layer = triggered/none-until-fired (child 2 L1-shaped; children 1/3 set layer at trigger time); Defends = none ratified yet — each child MUST name its Defends when triggered, and a child that cannot is not implementable |
| New-engineer 4: HB-112 missing Defends | **Fixed:** Defends = the backlog taxonomy itself (corpus hygiene, audit-only; no product surface invented) |
| Coding-agent 2: the finding-minting procedure lacked the scan-don't-trust-memory rule its HB-minting sibling has | **Fixed:** registry-scan command added, plus the refused-use-does-not-reserve-the-number rule with F-PT-033's precedent |
| Coding-agent 3: §9.1's update trigger was unpinned ("when it lands") | **Fixed:** pinned to the SAME change that lands the machinery or deposits the run's evidence record — never a later sweep |
| Operator 4: "adapter" names both a non-boundary category and real boundaries in one document | **Fixed:** terminology note at the rule — interface adapters vs provider adapters; the state-ownership test, not the word, decides the category |
| Operator 1/2/3/5/6 (out-of-corpus canonical doc, decision-maker findings, B-17, threat model, density); new-engineer 2/5/6/7/8/9 (task premise, HB-140, density, F-PT-033 care point, external certification detail, [doc] audit scope); coding-agent 4/5 (external AGENTS.md anchor, skill locations — stop-and-escalate IS the fallback for harness-revision by design) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8w |
| Operator 7/8; new-engineer 1 sufficiency; coding-agent verification list | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits (including both backlog
field additions).

**Gate follow-up to §12.8x (final-gate follow-up 17, 2026-08-10):** the round-25
backlog edits skipped the companion procedure — the routing doc requires
affected owner entries to be rewritten when the backlog changes, and ID-set
equality proves membership, not prose freshness (the same defect class as
follow-up 2's HB-133 entry). HB-134's owner entry regenerated with its new
material constraints in owner language (no layer until triggered; nothing
ratified defended yet; a child that cannot name its Defends at trigger time is
not implementable — the owner supplies that answer, never accepts a guess);
HB-112's owner prose reviewed against the round-25 Defends addition and
recorded as semantically aligned, no rewrite needed. Manifest byte-identical;
companion ID diff empty.

### 12.8y Reader test, twenty-sixth round (2026-08-10) — findings and dispositions

Fifteenth convergent round: all seats sufficient. Four actionable (all in the
routing doc):

| Finding | Disposition |
|---|---|
| Coding-agent 1 (SIG): read-first derivation sources stated for only 2 of 8 grammar rows — §6 interface-adapter, §7 LLM-site (general), and §8 ops rows had none | **Fixed:** sources named for all remaining rows, each verified before citing — §6 ← system-map §1.4's adapter table; §7 ← llm-eval-plan §2 per-site tables (golden-case pointer covers only the bad-output channel); §8 ← risk-allocation §6 (the catalog's own CF-OPS-SOAK/ABUSE rows cite it); journey/state-machine/contract rows read their §-named sources |
| Coding-agent 2 (SIG): the tag-sourcing sentence read as the complete tagging obligation but omitted the Oracle column | **Fixed:** Oracle kind named as the third required field with its legend location (catalog front matter) — seven atoms **plus the composition/alias grammar** <!-- corrected 2026-08-10, final-gate follow-up 18: the first fix claimed a bare "seven-value vocabulary" while live rows use `+` composition, the `contract` macro (32 rows), `stat-envelope`, `mixed`, and `(non-gating)` annotations; the legend was expanded to the actual grammar rather than normalizing 35 rows --> |
| Coding-agent 4: the deposit obligation had no path for a defect an injected-fake L2 rig genuinely cannot reproduce | **Fixed:** residual path stated — finding + closest achievable L2 approximation with the gap named + the real reproduction added to the appropriate L3 obligation; never skip the deposit silently |
| Coding-agent 5: mixed-posture change descriptions had no worked example | **Fixed:** one-sentence worked example added at the rule |
| Operator 1/2/3/4/7/8/9/10 (command semantics, canonical doc, density, runbook DRAFT, B-17, undated adapter risks, manual drift audit, ID fluency cost); operator 5 (T-numbers misread twice — disclaimer present, recurrence possible) and 6 (no worked red-statistical-gate playbook — cannot exist until a threshold ratifies; forward gap); new-engineer 1/2/3/4 (task premise, HB-140, HB-134's honest hole, ticket context locality) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8x |
| New-engineer 5 and both sufficiency verdicts; coding-agent 6 verification list | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8y (final-gate follow-up 18, 2026-08-10):** the new
Oracle obligation conflicted with the catalog it declared canonical — the
legend and routing sentence claimed seven values while live rows use `contract`
(32 §5 rows), `stat-envelope` (CF-HARNESS-JUDGE), `mixed` (CF-OPS-ABUSE), and
`stat (non-gating)` (CF-COND), plus `+` composition throughout. Chose
legend-expansion over row-normalization (35 rows' semantics preserved): the
catalog legend now documents the full grammar — atoms, `+` composition, the
`contract` clause-complete macro, `stat-envelope` as deterministic wrapper,
`mixed` as the threat-model-gated placeholder, parenthetical annotations that
qualify-never-replace — and the routing sentence plus §12.8y's disposition were
corrected in the same change. Byte-identical regeneration re-verified after the
legend edit. Manifest byte-identical.

### 12.8z Reader test, twenty-seventh round (2026-08-10) — findings and dispositions

Sixteenth convergent round: all seats sufficient; the coding-agent's
cross-reference spot-checks all matched. One genuinely new blocking finding and
its sibling:

| Finding | Disposition |
|---|---|
| Coding-agent 1 (BLOCKING): the golden-case paragraph said a bad output exposing a NEW call site "touches the catalog (then as a catalog-§7 family change)" with no structural caveat — contradicting the structural-additions rule that a new LLM call site (new S-id) re-enters `harness-revision` | **Fixed, structural rule wins:** the two branches now carry explicit different autonomy — envelope defect = autonomous §10.3 row; NEW call site = structural, routed through `harness-revision` (or stop-and-escalate), with the catalog-§7 change landing as part of that revision, never in-change |
| Coding-agent 2 (SIG): the bug-fix structural carve-out listed "journey, boundary, or invariant" — silently dropping "LLM call site" from the trigger list it imports | **Fixed:** "or LLM call site" added with the changelog stating the lists are one rule and the omission was unintentional |
| Coding-agent 3 (density as authoring risk), 4 (skill locations/availability check), 5 (posture check needs the external anchor); operator 1/2/3/4/5/6/7/8/9 (T-number latency, runbook DRAFT assembly, F-PT-014, F-PT-033 drift precedent, B-17, target-vs-enforced state via the register, prose-drift manual audit, actor-list assembly, scattered inconclusive guidance); new-engineer 1/2/3/4 (task premise, HB-140, proposal-only routing addenda, onboarding cost) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8y |
| New-engineer 5/6 (F-PT-033 discipline, PROPOSED-number discipline — both cited as correct practice); all sufficiency lists | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8z (final-gate follow-up 19, 2026-08-10):** the
stakeholder found a THIRD live trigger-list mirror — the 2026-08-03 addendum's
"new journey, boundary or invariant" sentence (follow-for-new-work: Yes) still
omitted "LLM call site" with no supersession qualifier. Corrected with the
exhaustive list and an explicit one-rule pointer to the structural-additions
section. A corpus-wide sweep for further mirrors then found a FOURTH:
`case-catalog.md` §10's preamble, corrected identically (byte-identical
regeneration re-verified). The HB-111 proposal's variant needs nothing — its
"state owner, or other structural truth" catch-all is non-exhaustive by
construction. All live mirrors of the structural trigger list *found by that
sweep* stated one rule <!-- corrected 2026-08-10, final-gate follow-up 20: the
claim was too strong — the comma-based sweep pattern missed a slash-phrased
fifth mirror -->. Manifest
byte-identical.

**Gate follow-up to §12.8z, second round (final-gate follow-up 20, 2026-08-10):**
the stakeholder found a FIFTH live mirror the follow-up-19 sweep missed —
`contracts/OP-validation-lifecycle.md`'s `requires_harness_revision` clause,
phrased with slashes ("new journey/boundary/invariant") rather than commas, so
the comma-based sweep pattern never matched it. Corrected doubly: the fourth
trigger added AND the clause made explicitly non-exhaustive with a pointer to
the canonical list in the routing doc's structural-additions section, so this
mirror cannot drift again. A second sweep using slash-form and loose patterns
(`journey/boundary`, `boundary/invariant`, `new journey`, `journey, boundary`)
then verified no sixth live mirror exists — every remaining match is a
no-change claim, quoted history, a traceability-record description, or B-27's
input-validation failure mode, none a routing trigger list. Follow-up 19's
"all live mirrors" claim corrected above to what the sweep actually
established. Manifest byte-identical.

### 12.8aa Reader test, twenty-eighth round (2026-08-10) — findings and dispositions

Seventeenth round: all seats reach sufficiency verdicts; the new-engineer's
sampling independently re-verified the §9 arithmetic, the proposed-register
discipline, and the gating rule. Six actionable, including one stale mirror the
original consistency sweep missed:

| Finding | Disposition |
|---|---|
| Coding-agent 1 (BLOCKING): the unconditional deposit rule vs the structural re-entry rule were never reconciled — may a structural defect's code fix land with no detector? | **Fixed:** the mid-change split rule now applies explicitly — the code fix may land first only if it stands alone without encoding the missing structure; the structure-dependent detector is parked in the change description as pending-the-revision (the one sanctioned exception besides the L2-irreproducible race); a fix whose code encodes the new structural truth cannot land before the revision |
| Coding-agent 2 (BLOCKING): `harness-revision` mode's outputs and availability test were undefined in-corpus — the trail went cold at the directory edge | **Fixed:** the mode's product stated (diff-scoped re-derivation emitting surgical updates through the artifact chain, with the recorded 2026-08-01…10 revisions as worked precedents) plus the availability test (invocable-by-name or unavailable → stop and escalate, never approximate by hand) |
| New-engineer 2 (SIG): `risk-allocation.md` still said "all four design-only until #337–#340 land; F-PT-025…028 keep cells parked" — contradicting the canonical registry; this file was missed by the rev-2026-08-10 consistency sweep | **Fixed:** sentence scoped as historical-as-written-2026-08-03 and superseded with the recorded facts (adapters landed/certified 2026-08-07, B-25 sandbox-scope with #339 unchanged, B-26 INCOMPLETE-never-pass, findings resolved), with the policy-wins rule restated |
| Operator 1 (SIG): the DRAFT (Phase 4) contract header hits a routed reader at the point of use with the disclaimer one file away | **Fixed:** header-trap note added to the runbook's provenance section on the exact routed path — scoped to the **18 of 38** files literally carrying the Phase-4 DRAFT label (preserved gate history, AUD-105, binding despite it); the other 20 declare their real posture, which governs — proposed/design-only surfaces (B-18/B-19) are not upgraded <!-- corrected 2026-08-10, final-gate follow-up 21: the first fix said "every header" / "the contracts are ratified", a false universal --> |
| Coding-agent 5: the L2-approximation's L3 side-obligation didn't say whether it folds or mints | **Fixed:** folds — the existing relevant L3 obligation gains the reproduction note; no new family or ticket; the §10.3 row stays the single traceability row |
| Coding-agent 6: "change description" never defined | **Fixed:** the PR body, or the commit message for direct commits |
| Operator 2/3/4/5/6/7 (runbook DRAFT overlay, out-of-corpus canonical doc, drift-generalization risk, density, namespace count, decision-maker findings); new-engineer 1/3/4/5/10 (task premise — the STATUS-FIRST banner at lines 3–13 IS before line 51, plus the Wave 0 blockquote; [doc]-schema scope; HB-140; HB-134's honest hole; sampling caveat); coding-agent 3/4/7 (layer heuristic, density, correction-style parsing) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8z |
| New-engineer 6/7/8/9 (four strength verifications incl. re-checked arithmetic) | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8aa (final-gate follow-up 21, 2026-08-10):** the
DRAFT-header warning overcorrected into a false universal — only 18 of 38
contract files carry the exact `Status: DRAFT (Phase 4)` header, while the
other 20 declare RATIFIED/ACCEPTED/PROPOSED/ACTIVE/IMPLEMENTED/design-only or
no status, and "all contracts are ratified and binding" would have wrongly
upgraded proposed surfaces like B-18/B-19. Scoped at all three sites (the
runbook note, the parallel README warning, §12.8aa's record): the
binding-despite-label rule applies exactly to the 18 Phase-4-DRAFT-labeled
files; every other file's declared posture governs. Counts verified by grep
(18 exact-header matches / 38 files). Manifest byte-identical.

### 12.8ab Reader test, twenty-ninth round (2026-08-10) — findings and dispositions

Eighteenth round: all seats sufficient; the coding-agent's bottom line — "nothing
is silently missing" for the three named scenarios; residual risk "almost
entirely one of density and extraction, not absence." Four actionable:

| Finding | Disposition |
|---|---|
| Coding-agent 4: no CF-* minting procedure while both sibling id spaces have one | **Fixed:** procedure added — CF ids are semantically derived (`CF-<source-row-key>-<discriminator>`, precedent forms named), collision-scan both catalog surfaces before minting, retired ids never reused |
| Coding-agent 7: mandatory detector deposit vs do-not-implement-blocked-items never reconciled at their intersection | **Fixed:** a defect in finding-parked territory may be fixed/detected only for its un-contested deterministic part, never encoding either side; a defect that IS the contested behavior becomes ratification evidence on the finding (F-PT-006 pattern) and escalates — the deposit obligation never licenses resolving a parked question |
| Coding-agent 5: "stop and escalate" named no channel | **Fixed:** solo-operator mechanics stated — halt, record the blocker in the change description (PR body/commit message) and, if product-truth-shaped, in an F-PT finding; there is no other channel |
| Operator 3 (SIG): no single which-adapters-are-actually-proven checklist named from the triage row | **Fixed:** the runbook's adapter row now names `validation-policy.yaml → layers → L3_live_sandbox → obligations` as the **L3 obligation status/evidence table** — with the reading rule that `ACTIVE` = runnable-when-triggered, never has-run; proof requires an explicit certification field plus outcome/restriction fields not withholding it; CF-B01…B04 carry no certification fields <!-- corrected 2026-08-10, final-gate follow-up 22: the first wording called it a "proven-adapter checklist", overstating what status alone proves --> |
| Operator 1/2/4/5/6/7 (threat model, B-17, density, namespace load + past ID collisions, unreachable-fail state, nine parked shapes); new-engineer 1/2/3/4/5/6/7 (task premise, HB-140, hand-maintained gate sentence, in-file DRAFT labels — README+runbook warnings stand per AUD-105 disposition, HB-133 skim risk, onboarding cost, sampling bound); coding-agent 1/2/3/6/8 (extraction density, layer heuristic, affected-boundary mapping assumed from tickets, posture bookkeeping, activation double-fact) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8aa |
| All sufficiency lists | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8ab (final-gate follow-up 22, 2026-08-10):** the new
adapter pointer overstated the policy block — "which-adapters-are-actually-proven
checklist" contradicted the block's own definition (`ACTIVE` =
runnable-when-triggered, never has-run; CF-B01…B04 carry no certification
fields; CF-B26's adapter certification coexists with an `INCOMPLETE` L3
outcome). Relabeled at the runbook row, §12.8ab's record, and the state mirror:
it is the **L3 obligation status/evidence table**, and proof requires an
explicit certification field plus outcome/restriction fields that don't
withhold it — status alone proves nothing. Manifest byte-identical.

### 12.8ac Reader test, thirtieth round (2026-08-10) — findings and dispositions

Nineteenth round: all seats sufficient; the coding-agent independently verified
every central routing claim and reported the two remaining gaps as "narrower
and mechanical." Seven actionable:

| Finding | Disposition |
|---|---|
| Coding-agent 1 (SIG): "Present verbatim below the marker" — the marker was never defined anywhere in the corpus | **Fixed:** defined as the exact existing suffixed heading `## Validation harness (replacement, designed 2026-07-31)` in repo-root AGENTS.md; landing replaces that section's BODY with the normalized payload minus its duplicate heading line; only if no `## Validation harness`-prefixed heading exists is the payload appended whole as a new section <!-- corrected 2026-08-10, final-gate follow-up 23: the first definition named a bare heading that does not exist in the repo snapshot and could have produced duplicate H2s --> |
| Coding-agent 2 (SIG): whether the base section's dozens of HTML changelog comments ship in the verbatim payload was unstated | **Fixed:** they do not — the payload is the normative text with all `<!-- changelog/ratification -->` comments stripped (they narrate the design artifact's history, meaningless in AGENTS.md); the frozen traceability block is unaffected (no embedded comments; glosses already live outside it by its own rule) |
| Operator 3 (SIG): the highest-declared-consequence class (T-1 gate proof missing) had a routed row only for the newer adapters | **Fixed:** the adapter row's escalation now covers ANY adapter including core B-02/03/04, and the quick-scan entry updated to match |
| Operator 4 (SIG): the ratified-but-unshipped F-PT-019/HB-135 classifier bore directly on the secrets row and was cited nowhere in it | **Fixed:** the row now names it — pre-split text rule in force until HB-135 lands; check HB-135's state before calling secrets-adjacent gating a defect |
| Operator 1: stale "M1–M17" at README read-order and system-map §prose | **Fixed:** both corrected to M1–M18 (M18 Jobs, 2026-08-07) |
| Coding-agent 3: the thresholds cross-reference named no target file | **Fixed:** `proposed_register` (canonical) + llm-eval-plan §8/§9 named at the point of use |
| New-engineer 5: HB-134's no-layer-until-fired shape falls outside the exception sentence's cross-layer vocabulary and its Gate: grep | **Fixed:** HB-134 named at the sentence as a different-shape special so the audit sees it — deliberately non-bold, because the first draft of this fix was bold and the byte-identical check immediately caught the machine catalog reassigning HB-134's wave to the banner section (first-bold-mention ownership); a live demonstration of the drift gate HB-140 will automate |
| Operator 2/5 (threat model, changelog density); new-engineer 1/2/3/4/6 (task premise, [doc] ceiling, HB-140, DRAFT headers per AUD-105, out-of-corpus evidence anchors); coding-agent 4 (density) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8ab |
| New-engineer rubric answers and coding-agent finding 5 (verification list) | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits (including the caught-and-
corrected bold-mention near-miss).

**Gate follow-up to §12.8ac (final-gate follow-up 23, 2026-08-10):** the
round-30 marker definition conflicted with the actual repo snapshot — the real
AGENTS.md heading is `## Validation harness (replacement, designed 2026-07-31)`
(suffixed), the bare form does not exist, and since the payload itself begins
with the suffixed H2, "create marker then land beneath it" could have produced
duplicate headings. Corrected: the exact suffixed heading IS the marker;
landing replaces its section body with the normalized payload minus the
payload's own duplicate heading line; the absent-marker case (no
`## Validation harness`-prefixed heading at all) appends the payload whole as a
new section. §12.8ac's record and the state mirror aligned in the same change.
Manifest byte-identical.

### 12.8ad Reader test, thirty-first round (2026-08-10) — findings and dispositions

Twentieth round: all seats sufficient; the coding-agent verified every
structural cross-reference it spot-checked and caught one that was false. Eight
actionable:

| Finding | Disposition |
|---|---|
| Coding-agent 1 (SIG): the "Where truth lives" sentence claimed the policy `artifacts:` block records the five protocol surfaces as its machine-readable resolver — verified false, none appear there | **Fixed:** resolver scope stated precisely — the registry resolves only what it lists; the protocol surfaces are NOT registry entries, their repo-root resolution is stated in prose and they are governed by the ratification rules, not the registry |
| Coding-agent 2 (SIG): the highest-stakes mechanical check (marker exists?) had no mechanized command, against the file's own pattern | **Fixed:** exact three-outcome procedure added — `grep -nF` for the exact suffixed heading → replace-body; prefix-grep hit with different suffix → STOP, corpus finding; no hit → append-whole |
| Operator 3: the always-deterministic-`fail` corollary was buried in the inconclusive row and unindexed | **Fixed:** the gate-red row and quick-scan entry 6 now carry it — scoped to a campaign/quality-lane VERDICT explicitly reporting `fail` (status/log "fail" strings are not verdicts and route by their own rows) <!-- corrected 2026-08-10, final-gate follow-up 24: the first fix said "ANY fail anywhere", wrongly capturing job/provider/effect statuses and log text --> |
| Operator 4: the two-senses-of-"adapter" note lived only in boundary-map's preamble | **Fixed:** README glossary row added pointing at the terminology note |
| Operator 6: the runbook assumed operator = owner; no path for an operator without ratification authority | **Fixed:** not-the-owner paragraph — no ratification-shaped action, preserve evidence, fail-closed defaults hold without you, wait for the owner |
| Coding-agent 3: `harness-design-state.md` vs `harness-state.yaml` never disambiguated at the routing doc | **Fixed:** never-confuse-them note (mirror-to-update vs machine-written never-hand-edited) |
| Coding-agent 4/5: "same change" undefined; combined bug-fix+feature PR path unstated | **Fixed:** same change = one PR (all commits) or the one direct commit; a combined PR runs BOTH procedures (§10.3 row + §§1–8 rows), per-work-item not per-change |
| New-engineer 3: F-PT-009's eval-plan §8 entry said "numbers on file" without the numbers | **Fixed:** concrete values co-located with the canonical proposed_register pointer |
| Operator 2/5/7/8/9/10 (density, threat model, manual drift audit, boundary-map length, F-PT-014 standing risk, future-state red-threshold procedure); new-engineer 1/2/4/5 (task premise, HB-140, hand-maintained gate sentence, sampling bound) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8ac |
| New-engineer 6–10 and operator 1 sufficiency lists; coding-agent overall verification | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8ad (final-gate follow-ups 24–25, 2026-08-10):** two
live wording defects in the round-31 fixes. (24) The fail-corollary broadened
"campaign verdict `fail`" into "ANY `fail` anywhere," wrongly capturing
job/provider/effect statuses and log strings; scoped at the row, the quick-scan
entry, and §12.8ad's record to a campaign/quality-lane VERDICT explicitly
reporting `fail`, with non-verdict "fail" strings routed by their own rows.
(25) The round-31 definitional insertions displaced "as pending-the-revision"
to after the combined-PR rule, reading as though both procedures were parked;
reattached to its object (structure-dependent cases/specs only), with the
definitions and the combined-PR rule now stated separately after it. Manifest
byte-identical.

### 12.8ae Reader test, thirty-second round (2026-08-10) — findings and dispositions

Twenty-first round: no blocking findings at any seat; the operator found
"nothing that would cause a wrong, dangerous action" and noted both real
inconsistencies degrade gracefully under the corpus's own tiebreak rules. Six
actionable:

| Finding | Disposition |
|---|---|
| Operator 1: the runbook's own audit command said "all 32 id/status pairs" — stale since F-PT-033; self-inconsistent by the very rule it teaches | **Fixed:** count corrected to 33 (F-PT-001…033) with the meta-lesson stated inline — never hard-trust any count in prose; the printout itself is canon |
| Operator 4: no DO line exists for the day a ratified threshold can actually report `fail` | **Fixed:** future-state action line at eval-plan §4 — a threshold fail is a quality regression, not an incident; the consequence is exactly what the ratifying decision recorded; never patch model/threshold/golden set to flip the verdict at machine speed |
| Coding-agent 3: the clause branch had worked precedents; the shape branch (full revision) had none | **Fixed:** the 2026-08-07 jobs addition (new state owner + failure domain: M18/B-30/J-22/J-23) named as the shape-branch precedent, with the who-owns-state/where-does-the-failure-domain-lie test |
| Coding-agent 1 (SIG): three load-bearing rules (REG restriction, the two deposit exceptions, parked-area defect split) were embedded mid-sentence, easy to skim past | **Fixed:** re-stated as three ACTUAL bullets at the Standing rules digest head, explicitly mirroring the canonical prose <!-- corrected 2026-08-10, final-gate follow-up 26: the first fix was one semicolon paragraph claiming to be bullets, omitted the parked-area split entirely (mislabeling the structure-parked deposit exception as covering it), and folded the separate grammar-closure fix into a clause; bullets rendered, the split restored, closure stated separately --> |
| Coding-agent 6: whether the eight-row derivation grammar is itself closed was never stated | **Fixed:** closed — an unmappable risk class is by definition a new derivation dimension = structural mismatch = harness-revision |
| Coding-agent 2/4: two unanchored decision points lacked grep jump-targets; two near-identical fallbacks for different skills sat uncross-linked | **Fixed:** jump-target greps added (both verified to hit); the permissive vs forbidden fallback contrast stated at the convention-6 rule — ticket work may proceed by hand, structural revision never may |
| Operator 2/3 (out-of-corpus canonical triage doc; DRAFT headers per AUD-105); new-engineer 1/2/3/4 (task premise, header footgun, hand-maintained gate sentence, HB-140-pending mechanical closure); coding-agent 5 (landing meta-procedure length) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8ad |
| All three sufficiency verdicts and verification lists | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8ae (final-gate follow-up 26, 2026-08-10):** the digest
fix did not match its own record — it was one semicolon-separated paragraph
claiming to be "scannable bullets," it omitted the promised parked-area defect
split (the round-29 rule: uncontested deterministic work proceeds; contested
behavior becomes finding evidence and escalates), and it folded the separately
recorded grammar-closure fix into a third clause. Corrected: three actual
bullets (REG restriction; the two deposit exceptions; the parked-area split),
with grammar closure stated separately after them; §12.8ae's disposition and
the state mirror aligned. Manifest byte-identical.

### 12.8af Reader test, thirty-third round (2026-08-10) — findings and dispositions

Twenty-second round: all seats sufficient; the coding-agent's spot-checks
confirmed "the routing is not just present but accurate — the harder bar."
Three actionable, all routing-doc navigation:

| Finding | Disposition |
|---|---|
| Coding-agent 1 (SIG): the file conflates two audiences — an ordinary feature/bugfix agent must read ~90 lines of landing meta-procedure before reaching the standing rules | **Fixed:** audience signpost at the very top — ordinary work reads the section-status table and mixed-posture rule (which govern every change), then skips the REST of the block; only the marker/comment-stripping landing procedure is landing-only <!-- corrected 2026-08-10, final-gate follow-up 27: the first signpost said skip-everything, over-skipping two rules that apply to ordinary work --> |
| Coding-agent 2: no stated first step for determining WHICH boundary/journey a source change affects | **Fixed:** honest step-zero chain — module identified from scope-and-module-map §2's descriptions (descriptive, not a path index), module→journey by reverse-reading system-map §3, journey→boundary/contract via journey-acceptance.md; an unresolved mapping is itself a corpus gap → finding + escalate, never intuition <!-- corrected 2026-08-10, final-gate follow-up 27: the first version cited a module→path→boundary crosswalk that does not exist as described --> |
| Coding-agent 3: the golden-set directory-targeting rule was stated only on the bug-fix path; its application to feature-derived S-* cases had to be inferred | **Fixed:** stated explicitly at the §7 read-first source — same emitting-call-site rule |
| Operator 1/2/3/4/6 (out-of-corpus canonical doc, DRAFT overlay, changelog density, namespace hopping, manual drift audit); operator 5 (header/body drift precedent — disclosed and corrected where found; no independent proof of zero others, per the standing sampling caveat); new-engineer 1/2/3/4 (task premise, HB-140, hand-maintained sentence, DRAFT headers) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8ae |
| New-engineer 5–8 (positive controls and verified strengths); operator sufficiency list; coding-agent 4 (verification list) | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8af (final-gate follow-up 27, 2026-08-10):** both
round-33 navigation fixes overclaimed. (1) The audience signpost said skip
everything above the base heading, over-skipping the section-status table and
mixed-posture rule that govern ordinary work; rescoped — read those two, skip
only the marker/comment-stripping landing procedure. (2) The step-zero rule
cited a module→source-path→boundary crosswalk that does not exist as described
(the module map is descriptive, not an exhaustive path index; system-map
§1.3/§2 does not map modules to boundaries); replaced with the honest chain —
module from §2's descriptions, module→journey by reverse-reading system-map §3,
journey→boundary/contract via journey-acceptance.md — plus the rule that an
unresolved mapping is itself a corpus gap (finding + escalate, never
intuition). §12.8af's records and the state mirror aligned. Manifest
byte-identical.

### 12.8ag Reader test, thirty-fourth round (2026-08-10) — findings and dispositions

Twenty-third round: all seats sufficient; the operator's list included three
explicit "not a gap" confirmations of the verdict/layer/adapter semantics. Five
actionable:

| Finding | Disposition |
|---|---|
| Coding-agent 1/2 (SIG): no ticket-acquisition procedure for the ordinary same-PR feature case, and convention 3's wording could read as an alternative to convention 2's header citation; sequencing default unstated | **Fixed:** third path stated — every citing/implementing SPEC needs an owning-ticket header citation, no exceptions, while a PENDING family (no spec yet, by design) requires its non-LANDED owning ticket to exist and declare it <!-- corrected 2026-08-10, final-gate follow-up 28: the first wording said "every new family needs a header citation", literally unsatisfiable for pending families -->; a family derived AND implemented in one PR mints its HB ticket in that same PR (same scan procedure), with convention 3 clarified as what the trace CLI verifies, never a substitute; sequencing default: derivation-first is fine, ticket minted in-change; convention 6 applies to pre-existing-ticket backlog work |
| Operator 2 (SIG): ~64 lines of provenance meta preceded the first actionable command in the self-contained 2am file | **Fixed:** jump note at the very top — paged readers go straight to §0/§1; the meta block is readable AFTER first moves |
| Coding-agent 3: "pruned" and "wave" used without definition pointers | **Fixed:** pointers added — PRUNE-* vocabulary in the catalog front matter; wave = backlog section-heading token (generator-derived) |
| Coding-agent 4: whether a wholly new module is a fifth structural trigger or the escape hatch's territory | **Fixed:** not a fifth trigger — it is the SHAPE sense of the existing triggers (new state owner/failure domain); the escape hatch is for when you cannot tell, and the two mechanisms converge |
| Coding-agent 5: three load-bearing rules had no grep anchors | **Fixed:** anchors added for HB/CF minting + same-PR rule, the write-back obligation, and §9.1 ledger timing <!-- corrected 2026-08-10, final-gate follow-up 28: the first minting anchor was case-sensitive and reached only the HB procedure (the CF heading is lowercase); replaced with a line-anchored case-insensitive pattern verified to reach both --> |
| Operator 3/4/5/6/7/8 (per-row changelog density, no failure-mode index table, absent threat model, F-PT-014 plain-English gap, duplicated DRAFT warning, manual F-PT drift audit); new-engineer 1/2/3/4/5 (task premise; HB-133's disclosed provisional-semantics asymmetry — §12.3 item 1 territory, human-owned; HB-140; skill rules cited by number with paraphrase-at-site; DRAFT headers) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8af |
| Operator 1/9/10/11 and new-engineer 6 (sufficiency + confirmations); coding-agent overall | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8ag (final-gate follow-up 28, 2026-08-10):** two
literal defects in the round-34 fixes. (1) "Every new family needs a header
citation, no exceptions" was unsatisfiable for pending families, which have no
spec/header by design; rescoped — the citation obligation binds every
citing/implementing SPEC, while a pending family requires its non-LANDED
owning ticket to exist and declare it. (2) The advertised HB/CF minting anchor
was case-sensitive and reached only the HB procedure (the CF heading is
lowercase); replaced with a line-anchored case-insensitive pattern
(`grep -niE '^\*\*minting a NEW.*(HB|CF)'`) verified to reach both procedures
and nothing else. §12.8ag's rows and the state mirror aligned. Manifest
byte-identical.

### 12.8ah Reader test, thirty-fifth round (2026-08-10) — findings and dispositions

Twenty-fourth round: the coding-agent rated all five core routing chains
"sufficient — verified accurate," and both other seats returned sufficiency
verdicts. Three actionable, all routing-doc usability:

| Finding | Disposition |
|---|---|
| Coding-agent 6 (SIG): the most-used lookup (module→journey→boundary step zero) had no worked example, against the file's own self-diagnosed pattern | **Fixed:** worked example added — and corrected at the gate <!-- final-gate follow-up 29: the first example misrouted GitHub (substrate, not a module) through the module chain and claimed J-04 uniquely though B-01 spans nine journeys -->: the chain now has an explicit SUBSTRATE branch, made ADDITIVE at follow-up 30 <!-- the follow-up-29 version said FS/git/clock/scheduler skip modules entirely, but M6/M9/M10 own related code -->: ownerless seam code resolves directly to its boundary (retry/backoff → B-01, journey list narrowed by call sites/ticket scope, J-04 only when scoped); module-owned code interacting with the seam ALSO runs the module→journey chain; the affected set is the UNION of both branches |
| Coding-agent 7: inconsistent working-directory convention for self-referential greps — bare filenames fail from repo root | **Fixed:** convention stated once at the anchor list — self-greps assume CWD `validation-design/`; prefix the path from repo root |
| Coding-agent 8: no jump anchor for the derivation-grammar entry point itself | **Fixed:** `grep -n 'Feature changes'` anchor added (verified to hit) |
| Operator 1/2/3/4/5/6/7/8 (row changelog density, DRAFT-overlay trust tiering, out-of-corpus canonical doc, decision-maker findings, namespace load, no boundary-map internal index — prose-by-design per standing disposition, absent threat model, never-exercised future-fail state); new-engineer 1/2/3/4/5 (task premise, HB-140, HB-133 caveat-notice burden, hand-maintained gate sentence, onboarding cost) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8ag |
| New-engineer 6/7/8 (layer, closure, executor confirmations); coding-agent 1–5/9 (five verified-sufficient chains + overall) | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8ah (final-gate follow-up 29, 2026-08-10):** the
worked example misrouted GitHub substrate as a module-owned path — the module
map explicitly calls GitHub substrate, system-map associates it with several
journeys, and B-01's own entry lists nine. Fixed by adding the missing
substrate branch to the chain itself: substrate changes (GitHub, FS/git,
clock, OS process/scheduler) skip the module step and resolve directly to
their boundary, then narrow that boundary's journey list by changed call sites
and ticket scope — J-04 valid only when the ticket specifically scopes the
delivery loop; module-owned code keeps the original chain. §12.8ah's row and
the state mirror aligned. Manifest byte-identical. **Second follow-up
(final-gate follow-up 30):** the substrate correction was too categorical —
"FS/git, clock, process/scheduler skip modules entirely" contradicted the
module map's assignment of related code to M6, M9, M10 and others. Branches
made explicitly additive: ownerless seam code → directly to its boundary;
module-owned code interacting with the seam → also the module→journey chain;
affected set = the union; the GitHub example kept. All three sites aligned.
Manifest byte-identical.

### 12.8ai Reader test, thirty-sixth round (2026-08-10) — findings and dispositions

Twenty-fifth round: all seats sufficient; the coding-agent's spot-checks all
passed and its verdict on the four test questions was "yes, unambiguously /
explicitly / thoroughly," with residual gaps "about readability under
pressure … rather than missing routing content." Four actionable:

| Finding | Disposition |
|---|---|
| Coding-agent 1 (SIG): the signpost's "skip the REST of this block" had no defined boundary — the skippable landing procedure lives BELOW the blockquote | **Fixed:** boundary made explicit — skip everything from the signpost down to the `## Validation harness…` heading (blockquote landing notes AND the Status paragraph), except THREE exempted items: the "How to treat each section" meta-rule (governs new work — follow unlanded sections, never claim their gates in CI), the status table, and the mixed-posture rule <!-- corrected 2026-08-10, final-gate follow-up 31: the first exemption list omitted the meta-rule, which the skip would have swallowed --> |
| Coding-agent 4: the availability test's "by that name" required referent-tracking across three sentences | **Fixed:** the name `validation-harness-design` stated inline at the test |
| Coding-agent 5: the digest's "self-contained" framing overclaimed — rule 1's borderline path consults catalog precedent | **Fixed:** framing scoped — self-contained for the method rules; borderline layer calls consult an in-corpus pointer, not skill text |
| Coding-agent 3: two sub-obligations had no anchors | **Fixed:** anchors added for the unplanned-fix ticket citation and the §10.3 tagging rule — both verified to hit |
| Operator 1/2/3 (out-of-corpus canonical doc, B-17 zero live proof, absent threat model — the three standing disclosed risks); operator 4/5/6/7 (changelog density, namespace load, count-drift history with repair commands, adapter caveats via the status table); new-engineer 1/2 (task premise + its in-corpus resolution), 3/10/11 (density, HB-140, cross-reference load), 6 (bare-by-design thresholds — the disclosed, reasoned exception); coding-agent 2 (nested corrections — self-acknowledged recurring class) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8ah |
| New-engineer 4/5/7/8/9 (five no-gap verifications incl. re-checked invariant counts); coding-agent overall four-question verdict | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8ai (final-gate follow-up 31, 2026-08-10):** the
round-36 signpost boundary created a live routing contradiction — its
two-item exemption list omitted the "How to treat each section" meta-rule,
which explicitly governs ordinary new work (follow unlanded sections; never
claim their gates exist in CI), so the skip would have swallowed a rule its
own targets must obey. Exemption list corrected to three items at the
signpost; §12.8ai's disposition row and the state mirror aligned. Manifest
byte-identical.

### 12.8aj Reader test, thirty-seventh round (2026-08-10) — findings and dispositions

Twenty-sixth round: all seats sufficient; the coding-agent verified the routing
"accurate rather than merely plausible-sounding," including confirming that
"reverse-read" is the correct instruction for system-map §3's actual table
shape. Five actionable:

| Finding | Disposition |
|---|---|
| Operator 1 (SIG): boundary-map's §3 mermaid diagram still drew B-23…B-26 as dotted "planned" edges, contradicting the same file's landed/certified prose | **Fixed:** edges made solid with honest labels (landed; B-25 sandbox-only; B-26 no-live-role) and a diagram-comment recording the contradiction |
| Operator 2: README's read-order entry said "B-01…B-26," disagreeing with its own glossary and the map | **Fixed:** B-01…B-30 |
| Operator 3: case-catalog's header note still called B-23…B-26 "design-only" and omitted B-27…B-30 | **Fixed:** scoped as true-at-2026-08-07 and superseded, B-27…B-30 named; byte-identical regeneration re-verified after the header edit |
| Operator 6: the you-ARE-the-human escalation reframe lived only in §2, after the whole table whose every row says "escalate" | **Fixed:** third companion note added before the table — solo install, you probably ARE the human, §2 decodes fully, not-the-owner path named |
| Coding-agent 3: S-id minting had no scan-first discipline like its HB/CF siblings | **Fixed:** never-trust-memory scan stated at the minting outcome (eval-plan grep + catalog §7 rows + golden-sets directory names) |
| Operator 4 (the consistency-sweep meta-point — this round's three catches are its own best evidence; the standing rule remains: canonical sources win, prose mirrors are report-and-repair); operator 5/7 (row-level changelog density, §0 command-semantics boundary); new-engineer 1/4/9/10 (task premise, HB-140, onboarding cost, HB-134 carve-out); coding-agent 1/2/4/5 (signpost parsing cost, mid-clause changelog risk, single worked layer example, repo-root execution boundary) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8ai |
| New-engineer 2/3/5/6/7/8 and layer/executor legibility; coding-agent routing verifications | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8aj (final-gate follow-up 32, 2026-08-10):** three
residues adjacent to the round-37 fixes. (1) README's read-order entry for
system-map still said J-01…J-20 against the glossary's and map's J-23. (2) The
just-repaired catalog header line still carried three more stale ranges —
J-01…J-20, 33 contracts, S-1…S-10 — against the file's own rollup (23
journeys, 38 contracts, 11 sites); all three corrected with changelogs,
byte-identical regeneration re-verified. (3) The new S-id scan pattern used
`[0-9]*`, emitting a spurious bare `S-`; corrected to `grep -oE 'S-[0-9]+'`
and verified clean. Manifest byte-identical.

### 12.8ak Reader test, thirty-eighth round (2026-08-10) — findings and dispositions

Twenty-seventh round, and the cleanest of the campaign: **zero new significant
findings at any seat.** The coding-agent marked all four core questions
"Sufficient — not a gap" with direct verification; the operator found "no case
where following these artifacts as written would lead an operator to take an
actively dangerous action"; the new-engineer's sufficiency assessment held
across every sampled surface. One actionable minor:

| Finding | Disposition |
|---|---|
| Coding-agent 6: the module→journey reverse-read's escape hatch covered failure-to-resolve but not NOISY resolution (a busy module in many journeys) | **Fixed:** over-broad resolution narrows the same way the substrate branch does (changed call sites + ticket scope); residual ambiguity after narrowing routes to the escape hatch — open a finding, never guess a subset |
| Operator 1–6 (DRAFT-overlay tax, namespace load, boundary-map pointer-not-table, per-invariant enforcement re-verification, no third-drift detection aid beyond the standing report-as-corpus-bug posture, CWD assumptions); new-engineer 1–8 (task premise, out-of-scope evidence anchors, HB-140, hand-maintained gate sentence, the F-PT-033 prose-guard trap — the in-corpus guard sits at OP-loop §4 + runbook §1.5 + the finding itself, the test file being outside this corpus, HB-134's out-of-scope source, DRAFT headers, corpus scale); coding-agent 5/7 (comment density, cross-file structural fragility — no stale claim found) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8aj |
| Coding-agent 1/2/3/4/8 ("Sufficient — not a gap" ×4 + overall); operator and new-engineer sufficiency statements | **Positive verifications** — no action |

Manifest verified **byte-identical** after this edit.

### 12.8al Reader test, thirty-ninth round (2026-08-10) — findings and dispositions

Twenty-eighth round: second consecutive round with zero new significant
findings. The coding-agent's four core answers were all "Sufficient — not a
gap," with structural claims verified "down to exact section numbers and
wording"; both other seats returned sufficiency verdicts. Two actionable
minors:

| Finding | Disposition |
|---|---|
| Coding-agent 5: the land-before-revision fork — the trickiest bug-fix judgment call — had no worked example | **Fixed:** F-PT-017-grounded example added — a fix correcting a timeout calculation AND renaming `timed_out`→`interrupted` splits exactly at the fork: the calculation lands with its detector; the rename encodes the contested enum and parks |
| Operator 7: B-14-shaped incidents had a narrow path back to §1.5 — the quick-scan never named B-14 | **Fixed:** quick-scan entries 18/19 now carry the B-14 hints (§1.5 pointer; F-PT-004/B-14-adjacent) without changing the row count |
| Operator 1/2/3/4/5/6 (runbook DRAFT assembly, no consolidated boundary table — policy roll-up is the stated answer, bare-word "adapter" parsing tax with the stated decision rule, changelog density, absent threat model, manual F-PT drift audit); new-engineer 1/2/3/4 (task premise, HB-140 + hand-maintained sentence, sampled-not-exhaustive closure check, append-order navigation); coding-agent 6/7 (step-zero sentence density, no-precedent layer fallback — the domain's irreducible judgment component, accepted) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8ak |
| New-engineer 5/6/7/8 (four explicit not-a-defect observations); coding-agent 1/2/3/4/8 ("Sufficient — not a gap" ×4 + overall); operator sufficiency section | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

### 12.8am Reader test, fortieth round (2026-08-10) — findings and dispositions

Twenty-ninth round: all seats sufficient; the coding-agent verified its
cross-reference sample "resolved correctly" including the round-39 worked
example. Three actionable:

| Finding | Disposition |
|---|---|
| Coding-agent 1 (SIG): the tagging sentence said "layer tags come from … T-1…T-12," colliding with the L1–L5 execution-layer meaning — T-tags actually ride inside the Risk column's parentheses (`E1 (T-10)`), not a field of their own | **Fixed:** collision flagged at the point of use — the Layer column is the L1–L5/L-ACC execution layer (policy vocabulary); T-control-points appear only as parenthetical Risk annotations; both halves of the sentence corrected |
| New-engineer 4: HB-094's Gate phrasing read ambiguously as a possible unlisted cross-layer precondition | **Fixed:** disambiguated in the ticket — a forward CONSEQUENCE of doing the work, not a precondition; explicitly not owed a place on the cross-layer exception sentence; byte-identical re-verified after the backlog edit |
| Operator 4: abstract first-moves cells lacked the concrete path (turn journals) | **Fixed:** `state/turns/` (system-map §2.2) inlined at the alive-but-stuck row |
| Operator 1/2/3/5/6/7 (B-17, F-PT-014, out-of-corpus canonical doc, ID density, drift-history epistemics, the verdict-vs-status-string vocabulary trap — all standing disclosed items); new-engineer 1/2/3/5/6 (task premise, F-PT-033 test-file lint being outside this corpus, HB-133 label, HB-140, cold-read fragility); coding-agent 2/3/4/5 (run-on density, signpost self-reference, no single end-to-end step list, self-correction-history epistemics) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8al |
| All three sufficiency verdicts and verification lists | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

### 12.8an Reader test, forty-first round (2026-08-10) — findings and dispositions

Thirtieth round: all seats sufficient; the coding-agent found "the only
concrete unresolved gap" to be one unlocatable pointer. Two actionable:

| Finding | Disposition |
|---|---|
| Coding-agent 5: the state-machine row's read-first source ("the state-machine inventory") pointed at no locatable file/section — system-map has none, and catalog §2 would be self-referential | **Fixed, honestly:** the pointer IS deliberately self-referential — catalog §2's row keys are the inventory (the machines were enumerated at derivation time and live nowhere else in-corpus), with each machine's durable-state owner read from system-map §2.2 (verified present) before deriving |
| Coding-agent 6: whether the three addenda were also required reading was only inferable from the posture table twenty lines away | **Fixed:** the signpost now says it — read every section the table marks "Follow for new work: Yes," currently all four |
| Operator 1–7 and 9 (changelog density, runbook DRAFT arrangement, DRAFT headers, B-17, F-PT-014 as "the single most severe known gap" — the standing §12.4 human-owned item, cannot-fail-today subtlety, F-PT-017 string-level trap with its grep rule, prose-per-boundary design); new-engineer 1/2/4/5/6 (task premise, [doc] faith boundary with HB-135 as the inlining exception, the bold-convention fragility HB-140 guards, sampled-not-exhaustive closure, onboarding cost) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8am |
| Operator 8 (positive: adapter disambiguation "unambiguous"); new-engineer 3/7 (discipline confirmations + sufficiency list); coding-agent 1/2/3/4/7 (four sufficiency verdicts + overall) | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8an (final-gate follow-up 33, 2026-08-10):** the
round-41 source check exposed one more live stale status sentence —
`system-map.md`'s 2026-08-07 revision note still said B-23…B-26 "are
design-only until #337–#340 land" as current fact. Corrected with the same
pattern as the risk-allocation mirror: scoped historical-as-written, followed
by the recorded facts (adapters landed/certified 2026-08-07; B-25
sandbox-scope with the #339 gate unchanged; B-26 L3 outcome INCOMPLETE, never
pass; canonical statuses at the policy's L3 obligations block). State mirror
aligned. Manifest byte-identical.

### 12.8ao Reader test, forty-second round (2026-08-10) — findings and dispositions

Thirty-first round: all seats sufficient. Six actionable:

| Finding | Disposition |
|---|---|
| Coding-agent 1 (SIG): no procedure for an ordinary ticket that requires a protocol-surface edit — obligation stated, mechanic absent | **Fixed:** mechanic added mirroring the mid-change disposition — draft the exact diff, park it as proposal-pending-ratification (never merge), land what stands alone, escalate via the solo-operator channel; the ratified diff lands in its own change |
| Coding-agent 2 (SIG): "touching a section" could read as making every spec-writing change DRAFT-posture | **Fixed:** touching defined precisely — editing the section's own text or landing its block; COMPLYING with its conventions is not touching; ordinary spec work owes no posture label <!-- corrected 2026-08-10, final-gate follow-up 34: the worked example immediately above the new definition (catalog row + spec header) was itself a compliance case and contradicted it; replaced with a genuine two-section-edit example --> |
| New-engineer 3 (SIG): HB-005(d) was still hard to execute from the ticket alone after two corrections | **Fixed:** one-sentence net added — assert zero-marker and distinct-conflict refusals as contract truth; assert NOTHING about duplicate-identical; the landed test's lenient assertions are pinned facts not to extend; byte-identical re-verified |
| Coding-agent 5: the escalation-mechanics paragraph had no grep anchor | **Fixed:** anchor added, verified to hit |
| Coding-agent 6: the no-derivation change (refactor/tooling/dep bump) was correct only by omission | **Fixed:** deliberate no-op case stated — confirm no grammar trigger applies; that confirmation is the whole obligation |
| Operator 4: a third informal "adapter" framing (jobs binary, packaged-binary driving) wasn't anticipated by the two-sense rule | **Fixed:** terminology note extended — figurative uses, same state-ownership test, no new category |
| Operator 1/2/3/5/6/7 (subordinate-fallback authority, out-of-corpus run-1 evidence, row changelog density, F-PT-014 via the briefing path, DRAFT headers, namespace tax); new-engineer 1/2/4/5/6 (task premise, self-demoting backlog navigation, prose-enforced gating pre-CLI, HB-140, contract-count arithmetic discoverability); coding-agent 3/4 (signpost fragility history, layer judgment call) | **Accepted as designed / previously dispositioned** — recorded across §12.8–§12.8an |
| New-engineer 7/8 (discipline confirmations); coding-agent 7 and verdict; operator 8 sufficiency block | **Positive verifications** — no action |

Manifest verified **byte-identical** after these edits.

**Gate follow-up to §12.8ao (final-gate follow-up 34, 2026-08-10):** the new
touching-definition contradicted the worked example immediately above it — the
example's "catalog row + traceability spec header" change is, under the
definition, pure compliance owing no posture label. The example replaced with
a genuine mixed section-edit (correcting a base-section sentence AND amending
the addendum's own text — two real section edits, two postures); §12.8ao's row
and the state mirror aligned. Manifest byte-identical.

### 12.8ap Reader-round residue — terminal pass (forty-third round, 2026-08-10)

The reader loop converged (the stakeholder ratified consecutive rounds), so
this round's findings are RECORDED for the human ratifier rather than fixed.
No finding in this round is a blocking corpus defect: the coding-agent
explicitly reports "no blocking findings," the operator reports sufficiency on
all four core questions, and the new-engineer's two "BLOCKING" labels attach
to (a) the exercise's own task premise and (b) the corpus's deliberate
`[doc]` scope boundary — recorded design postures, not editable defects.

**Residue register — each item, tier, and why recorded rather than fixed:**

1. *Coding-agent 1 [significant]* — the clause-vs-shape carve-out names
   "contract" and "invariant" explicitly but extends to `boundary-map.md`'s own
   descriptive prose (a wrong failure-mode bullet that isn't about
   ownership/shape) only via a distant generic clause in the write-back
   paragraph; an agent must bridge two non-adjacent paragraphs by analogy.
   **Recorded, not fixed:** the path exists and is correct (the reader
   confirms "the gap is *which* path, not *whether* one exists"); making the
   extension explicit is a one-sentence hardening the human may direct at
   ratification — fixing it now would reopen the strict loop for a
   non-blocking navigation nicety.
2. *New-engineer 1 [blocking-for-the-literal-task]* — "build the walking
   skeleton" is contradicted by the backlog's own accurate LANDED disclosure.
   **Recorded:** this is the exercise premise colliding with corpus truth, not
   a corpus defect; the corpus's triple banner + status register + open-work
   list are the standing (repeatedly re-verified) mitigation. Human owns any
   reframing of future task assignments.
3. *New-engineer 2 [blocking-for-self-containment]* — `[doc]`-tagged literal
   schemas/flags resolve only in the product's `./docs/`. **Recorded:** a
   deliberate, repeatedly disclosed scope boundary (the corpus "does not
   replace the docs"); HB-135's full-rule inlining is the named exception
   pattern the human may choose to extend.
4. *New-engineer 3 [significant]* — LANDED claims cite `../tests/` and
   `../src/`
   paths unverifiable from inside `validation-design/`. **Recorded:** inherent
   to the design-corpus/implementation split; `harness-design-state.md` is the
   declared machine-truth reconciliation surface.
5. *New-engineer 4 [significant] + operator 7 [minor]* — catalog-pair
   agreement and F-PT prose-status drift lack mechanical enforcement until
   HB-140 (TODO) lands; drift detection beyond the catalog pair is a manual
   printout-plus-audit. **Recorded:** already ticketed (HB-140) and honestly
   labeled at every site; landing it is implementation work outside this
   design campaign's authority.
6. *Operator 3 [significant]* — §0 command-output semantics live in `./docs/`.
   **Recorded:** same deliberate scope boundary as item 3.
7. *Operator 5 [significant]* — no authored threat model
   (`awaiting_human_author`); adversarial triage = escalate-first only.
   **Recorded:** HB-072/073 are human-gated by design; tracked by those two
   tickets and this residue register (it is not a §12.4 open-finding entry —
   the threat model is ticket-owned work, not an F-PT question <!-- corrected
   2026-08-10 at the residue-confirmation gate: the first wording said "§12.4
   material," which §12.4 does not list -->).
8. *Operator 6 [minor]* — B-17 remains the one boundary with zero live proof
   and no scheduled unblock. **Recorded:** §12.4's named BLOCKED obligation
   with its unblock condition (HB-055's disposable target).
9. *Operator 1/2/4 and coding-agent 4 [minor]* — preamble length before §0,
   inline changelog density inside normative clauses, and the
   two-grain-tiebreak subtlety. **Recorded:** the density/ergonomics family,
   dispositioned accepted-as-designed across ~20 prior rounds; the landing
   procedure strips all comments from the shipped payload, so the tax is
   design-corpus-local.
10. *Coding-agent 2 [minor]* — the module→journey reverse-read has no
    mechanized grep hint unlike every other high-stakes lookup. **Recorded:**
    a candidate one-line hardening for the human; non-blocking (the additive
    branch + narrowing + escape hatch already bound the risk).
11. *Coding-agent 3 [minor]* — layer placement remains precedent-imitation
    with no closed decision procedure. **Recorded:** the standing
    accepted-as-designed residual (the domain's irreducible judgment
    component), visible as such across multiple prior dispositions.
12. *New-engineer 5/6/7 and operator 8 [minor/informative]* — hand-maintained
    cross-layer sentence pre-CLI, 18/38 DRAFT headers (AUD-105 gate-history
    trace), 3–4-file chain onboarding cost, and the nine
    deliberately-unratified operator-decision shapes. **Recorded:** all
    standing disclosed postures with their mitigations named in-corpus.

Nothing in this register changes any artifact's content: it is the residue a
real human inherits alongside §12.3's seat decisions and §12.4's open
questions. All three seats' sufficiency verdicts stand as this terminal
round's positive result.

### 12.9 Final stakeholder gate — CONFIRMED 2026-08-10; RE-CONFIRMED after §12.8b through §12.8j

**Re-confirmation record (2026-08-10, after reader round 11):** the stakeholder
seat verified on the current corpus — the four-row status table accurately
distinguishing the four ratification postures; §12.8j recording all-sufficient
verdicts, zero blockers, and three-round convergence; byte-identical regeneration
(SHA-256 `7c306e88…6ae3e`); 396 families / 101 tickets, no duplicate ids;
symmetric companion diff empty (101 IDs each side); §12.4 and both caveats
intact — and re-confirmed the gate. This confirms only the AI
stakeholder/design-campaign gate; §12 remains DRAFT pending real-human
ratification.

**Re-confirmation record (2026-08-10, after reader round 10):** the stakeholder
seat verified on the current corpus — all three §12.8i dispositions matching
their source edits; B-18/B-19 consistently design-only and unbuilt; byte-identical
regeneration (SHA-256 `7c306e88…6ae3e`); 396 families / 101 tickets, no duplicate
ids; symmetric companion diff empty (101 IDs each side); §12.4's open set and both
caveats intact — and re-confirmed the gate. This confirms only the AI
stakeholder/design-campaign gate; §12 remains DRAFT pending real-human
ratification.

**Re-confirmation record (2026-08-10, after reader round 9 and the two-pass
threshold-mirror follow-up):** the stakeholder seat verified on the current
corpus — all seven threshold-trigger sites consistently requiring the first
**graded** distribution with run 1 explicitly ungraded; no stale trigger wording
outside historical changelog text; byte-identical regeneration (SHA-256
`7c306e88…6ae3e`); 396 families / 101 tickets, no duplicate ids; symmetric
companion diff empty (101 IDs each side); §12.4 and both caveats intact — and
re-confirmed the gate. This closes the AI stakeholder/design-campaign gate only;
§12 remains DRAFT pending real-human ratification, with no broader
implementation, spending, or release authority granted.

**Re-confirmation record (2026-08-10, after reader round 8):** the stakeholder seat
verified on the current corpus — all §12.8g dispositions matching their source
edits, including comparative execution remaining explicitly design-only and
unbuilt; byte-identical regeneration (SHA-256 `7c306e88…6ae3e`, zero differing
lines); 396 families / 101 tickets (82 landed / 19 pending), no duplicate ids;
empty companion diff; §12.4's open set and both caveats intact — and re-confirmed
the gate. This confirms the AI stakeholder/design-campaign gate only; §12 remains
DRAFT pending real-human ratification and grants no broader implementation,
spending, or release authority.

**Re-confirmation record (2026-08-10, after reader round 7):** the stakeholder seat
verified on the current corpus — every §12.8f disposition matching its edit site;
the simultaneous-fire guidance preserving C3 equality and deriving its sequencing
from existing consequence rationale; byte-identical regeneration (SHA-256
`7c306e88…6ae3e`, zero differences); 396 families / 101 tickets, no duplicates or
status movement; empty companion diff; both caveats and the §12.4 open set intact —
and re-confirmed the gate. Still an AI-stakeholder confirmation only; §12 remains
DRAFT pending real-human ratification.

**Re-confirmation record (2026-08-10, after reader round 6):** the stakeholder seat
verified on the current corpus — every §12.8e disposition matching its edit site;
the four parked P-tickets carrying Layer/Defends/Acceptance/Executor without
unblocking their catalog cells; byte-identical regeneration (SHA-256
`7c306e88…6ae3e`, zero differences); 396 families / 101 tickets, no duplicates or
status movement; empty companion diff; both caveats and the §12.4 open set intact —
and re-confirmed the gate. Still an AI-stakeholder confirmation only; §12 remains
DRAFT pending real-human ratification.

**Re-confirmation record (2026-08-10, after reader round 5 and the boundary-map
status follow-ups):** the stakeholder seat verified on the current corpus — the
`harness-state.yaml` boundary-map note accurately records the status-only
reconciliation with B-01…B-30 semantics unchanged; all six adapter-status
corrections consistent with the certification records; the #339 restriction
preserved; byte-identical regeneration (SHA-256 `7c306e88…6ae3e`, zero
differences); 396 families / 101 tickets with no duplicate ids or status movement;
empty companion diff — and re-confirmed the gate. Still an AI-stakeholder
confirmation only; §12 remains DRAFT pending real-human ratification.

**Re-confirmation record (2026-08-10, after reader round 4):** the stakeholder seat
re-verified on the current corpus — byte-identical regeneration (SHA-256
`7c306e88…6ae3e`, zero differing lines), 396 families / 101 tickets unchanged with
no duplicate ids or status movement, empty companion diff, all §12.8c dispositions
matching, both caveats below and the §12.4 open set intact — and re-confirmed the
gate. Still an AI-stakeholder confirmation only; §12 remains DRAFT pending
real-human ratification.

**Re-confirmation record (2026-08-10, after reader round 3):** the stakeholder seat
re-verified on the current corpus — byte-identical regeneration (SHA-256
`7c306e88…6ae3e`, zero differing lines), 396 families / 101 tickets with no
duplicate ids, empty companion ticket-ID diff, all §12.8b dispositions matching,
and the stale-snapshot/authority caveats below intact — and re-confirmed the gate.
The re-confirmation closes the AI stakeholder gate only; §12 remains DRAFT pending
real-human ratification with the §12.4 open set unchanged.

The campaign's AI stakeholder seat confirmed the final Phase 8 gate on 2026-08-10
after independently verifying: byte-identical regeneration (zero differing lines);
396 families = 357 implementable / 38 pruned / 1 blocked; 101 tickets = 82 landed /
19 pending; clean YAML parse with no duplicate ids; empty companion ticket-ID diff;
all 68 former gate-finding classes resolving against current sources; §12.7/§12.8
dispositions present. All five §12.3 seat decisions were confirmed **at the AI
stakeholder gate**.

**This is not human ratification.** §12 remains DRAFT until a real human works
through it; every standing human-owned item in §12.4 remains open. Two closing
caveats recorded verbatim from the gate: (1) the workspace-root
`CATALOG-GATE-PROBLEMS.md` snapshot regenerates only on gate evaluation and may
display a stale prior finding count — it must never be cited as the fresh gate
result; current-source checks govern. (2) The rev-2026-08-10 revision is closed as
a design campaign only: it authorizes no implementation beyond the tickets it
opened (HB-133…HB-136, HB-140 — implementation-ready or triggered per their own
text), no token spend, and no release-posture change.

## 13. Independent audit record — rev-2026-08-10 corpus, iteration 1

A fresh auditor (no campaign history; read-only ./docs/, ./rambling.txt,
./validation-design/) measured the corpus against the validation-harness-audit
design-conformance rubric. Report: `audit/audit-report-1.md` (this campaign's
series; the same-named AUD-1xx ids in §7 belong to the 2026-07-31 campaign's
separate series). The blind probe found no missing-claim structural finding;
four conformance/consistency findings resulted. All four were **ultimately
fixed** (none disputed, none deferred), but not in one pass: disposition-gate
round 1 CONFIRMED AUD-102/AUD-104 and REFUSED AUD-101/AUD-103 on upheld
stakeholder objections; the latter two were corrected and confirmed at round 2.
<!-- corrected 2026-08-10, disposition gate round 2: the opening previously
read "All four dispositioned fixed — no disputes, no deferrals", contradicting
the gate history it preceded. --> The rows below record the final state:

| Finding | Tier | Subject | Fix |
|---|---|---|---|
| AUD-101 | blocking | the `[rambling]` provenance class cited passages absent from the current ./rambling.txt — the 2026-08-10 evidence sync replaced the ramble file and the revision never rescoped the definition | `rambling-archive.md` created (supersession event, scope rule, per-anchor retention register); tag definitions rescoped historically at invariants.md, boundary-map.md, system-map.md, scope-and-module-map.md, llm-eval-plan.md, the README glossary row, and §2 above; §2's B-03 current-fact sentence corrected; supersession recorded in elicitation-log.md; artifact registered in policy `artifacts:` and README. Gate round 1 (stakeholder OBJECTION, upheld): the archive had omitted scope-and-module-map.md and its four anchors, and over-claimed one-command byte recovery — register completed from a corpus-wide `[rambling` grep (every tag-bearing site now resolves), recovery note corrected to NO pre-`15708a7e` preimage in the bundled history (stakeholder git probe). No invariant, boundary, contract, or ratified decision changed; no fabrication found or claimed. |
| AUD-102 | significant | F-PT-018's `KNOWN-LIMITATION:` marker invisible to case-catalog.yaml; README's "nine park … no expected behavior" over-claimed for it | generator extracts `KNOWN-LIMITATION:` → `known_limitation:` field; YAML regenerated (CF-HARNESS-CI + CF-HARNESS-RELEASE carry F-PT-018; rollup unchanged 396 = 357+38+1, 101 = 82+19; regeneration re-verified byte-identical); README split 9 → 8 parked + 1 known-limitation with the encoded-behavior distinction; §9 register entry annotated with its marker class |
| AUD-103 | minor | #376 (progressive CLI help hierarchy) had no named disposition in the convergence record | harness-state.yaml `last_diff_verdict` names it: **absorbed by existing coverage** — CF-IF-CLI's progressive human-help hierarchy leg + its #371 conformance tests, at the ratified THIN/C1 class; no NEW row owed because that row already covers it. Gate round 1 (stakeholder OBJECTION, upheld): first wording said "assessed-and-pruned; no case row or spec owed" (misleading — coverage exists) with wrong short SHA `fd3bb814` inherited unverified from the audit report; corrected to `fd3bb8158` per TARGET-SNAPSHOT.md, which governs |
| AUD-104 | minor | README glossary: same-day "…032" changelog comment three lines under the `F-PT-001…033` row | comment corrected to record the two-step extension (…032 at the sweep, …033 at final-gate follow-up 10) and defer to the row |

Fix-verification notes for the round-2 auditor: the byte-recovery facts (no
pre-`15708a7e` preimage in the bundled history — stakeholder git probe; the
designer sandbox cannot run git at all) are recorded in rambling-archive.md §1;
the archive's retention classes distinguish in-corpus quotation, independent
2026-07-31 verification, and tag-only attestation honestly rather than
claiming re-checkability that does not exist.

**Disposition-gate history:** round 1 GATE-REFUSED — AUD-102/AUD-104 CONFIRMED;
stakeholder OBJECTIONs on AUD-101 (archive incomplete: scope-and-module-map.md
sites omitted; byte-recovery over-claim) and AUD-103 (wrong SHA; "no case row
owed" misleading vs CF-IF-CLI's existing coverage) both upheld against the
designer and corrected as recorded in the rows above. Round 2: the corrected
AUD-101/AUD-103 both CONFIRMED (non-regression re-verified by the stakeholder:
byte-identical catalog regeneration, F-PT-018 on two rows, rollups unchanged,
catalog `rambling` count still 1), with the window GATE-REFUSED once more on a
record-only contradiction — this section's own opening still claimed a clean
"no disputes, no deferrals" pass ahead of the gate history; that opening and
the state-file mirror were corrected in this change. **Round 3: CONFIRMED —
audit window closed 2026-08-10**, final rulings AUD-101/102/103/104 all
CONFIRMED with non-regression clean; the persisted per-finding ruling record
the round-2 auditor verifies is `audit/audit-1-dispositions.md` (rewritten for
this window at the conventional path; the July campaign's same-named table is
preserved at `audit/audit-1-dispositions-2026-07-31-campaign.md`; extended
narrative: `audit/audit-1-dispositions-rev-2026-08-10.md`). <!-- changelog
2026-08-10 (window close): round-3 confirmation and disposition-record pointer
added; pointer updated when the conventional-path record was written. -->

**Audit iteration 2 (2026-08-10, this series): clean.** A second fresh auditor
verified all four iteration-1 dispositions at their fix sites
(`audit/audit-report-2.md`, rev-2026-08-10 series — the July campaign's
round-2 report was superseded at that path by the environment; its content
survives quoted in §7 and the July disposition-record copies): AUD-101/102/103/104
all VERIFIED; regression sweeps clean (corpus-wide `rambling` grep, "nine
park" grep, rollup arithmetic recomputed, SHA re-checked); **no new blocking
findings**; the two gate refusals candidly preserved rather than smoothed.
One sub-reportable residue noted by the auditor and accepted: the
orchestrator-generated conventional-path disposition file embeds redundant
confirmation text per row — formatting noise in a machine-written record,
content complete and consistent. The auditor's verdict: this loop can close.
<!-- changelog 2026-08-10 (audit iteration 2): clean-verification record
added; no dispositions owed on an empty findings ledger. -->

## 14. Audit — final record, rev-2026-08-10 independent audit loop

**Verdict: clean** (loop closed 2026-08-10 after two iterations: iteration 1
found four findings, iteration 2 verified every disposition at its fix site
and reported no new blocking findings). Reports: `audit/audit-report-1.md`,
`audit/audit-report-2.md`; disposition records: `audit/audit-1-dispositions.md`
(conventional path) with the extended and July-preservation copies beside it;
narrative history: §13 above.

**Final findings ledger — every finding by tier, with disposition:**

| Finding | Tier | Subject (as found) | Disposition | Rationale (one line) |
|---|---|---|---|---|
| AUD-101 | blocking | the corpus's `[rambling]` provenance class points at passages that do not exist in the workspace's ./rambling.txt, and the rev-2026-08-10 revision that ingested the replacement file never rescoped the definition or the citations (invariants.md; also boundary-map.md, llm-eval-plan.md, §2) | **fixed** | tag class rescoped historically via the new `rambling-archive.md` (supersession event, scope rule, complete per-anchor retention register) plus corrections at every legend site — after a round-1 stakeholder objection forced completion of the site list and retraction of a byte-recovery over-claim |
| AUD-102 | significant | the ninth parked cell (F-PT-018, CF-HARNESS-CI required-check enforcement) is invisible to the machine-readable catalog, which the corpus declares must agree with the markdown (case-catalog.yaml vs case-catalog.md §9 and README.md) | **fixed** | generator now extracts `KNOWN-LIMITATION:` markers into a `known_limitation:` YAML field (F-PT-018 on both owning rows, rollups unchanged) and README's over-claim split into 8 parked + 1 known-limitation with encoded behavior |
| AUD-103 | minor | the revision's diff-walk record leaves one changed-source item (#376, progressive CLI help hierarchy) with no named disposition (harness-state.yaml `convergence.last_diff_verdict`) | **fixed** | convergence record now names #376 (`fd3bb8158`) as absorbed by existing CF-IF-CLI progressive-help coverage (#371 tests, THIN/C1) — after a round-1 stakeholder objection corrected a wrong SHA and misleading "no row owed" wording |
| AUD-104 | minor | a same-day changelog comment asserts "F-PT range extended to …032" three lines below the register row that reads `F-PT-001…033` (README.md ID glossary) | **fixed** | comment corrected to record the two-step extension (…032 at the sweep, …033 at final-gate follow-up 10) and defer to the normative row |

**Unresolved disputes and deferrals from this loop: none.** No finding was
disputed; no finding was deferred; every disposition carries persisted
stakeholder CONFIRMED evidence, and ratified decisions were not reopened.
The ratifying human inherits nothing new *from this audit loop* — the standing
human-owned items remain exactly the pre-existing set: §12.3's seat decisions,
§12.4's open questions, §12.8ap's reader-round residue, and the open F-PT
findings in `validation-policy.yaml → open_findings`.

<!-- changelog 2026-08-10 (loop close): §14 added at the environment's
close-out instruction — verdict, final ledger with dispositions, and the
empty unresolved-disputes/deferrals statement. -->

<!-- changelog 2026-08-10 (audit rev-2026-08-10): section added — audit
iteration 1 findings and dispositions. -->
<!-- changelog 2026-08-10 (disposition gate round 1): AUD-101 and AUD-103 fix
cells corrected per the stakeholder's upheld objections; gate history added. -->
