# Harness design state — Operon validation campaign

Updated: 2026-07-31 (CAMPAIGN CLOSED; audit loop CLOSED verdict "clean" — AUD-101…109 all fixed, audit record in ratification-package.md §7; **design RATIFIED by the product owner in session 2026-07-31** — record in ratification-package.md §9)

## Campaign
- Skill: validation-harness-design
- Scope mode: `product` — **CONFIRMED at Phase 0** (rev 2, round 3)
- Target: production Operon (org runtime)
- Artifact root: `./validation-design/`
- Harness implementation root (per docs v2.9, build-time only): `claude-tests/` — NOT built in this campaign
- Incumbent suite: archived under `archive-do-not-read/**` — protected no-read path (ratified at Phase 0); clean-slate greenfield, no coexistence posture
- ID namespace: `OPERON-` (confirmed at Phase 0)
- Provenance labels in force: `[doc]`, `[rambling]`, `[simulated]`, `[PROPOSED]`, `[walk]` (Phase 1 elicitation). `[stated]` reserved and unused (no live ratifying human).
- Fast mode: declined — full teach-first for every concept.

## Phase status
- Phase 0 (scope + module map): **CONFIRMED** 2026-07-31 (rev 2, round 3) — `scope-and-module-map.md`
- Phase 1 (system map + tier): **CONFIRMED** 2026-07-31 (round 4) — `system-map.md` §§0–5, tier C2 base + T-1…T-12. Gate history: rounds 1–3 refused; corrections and round records in elicitation-log.md.
- Phase 2 (invariants): **CONFIRMED** 2026-07-31 (round 3) — `invariants.md` OPERON-INV-001…015. Rounds 1–2 refused; corrections logged.
- Phase 3 (boundary map): **CONFIRMED** 2026-07-31 (rev 4) — `boundary-map.md` B-01…B-17. History: rev-1 draft corrected per elicitation: +B-14 (human checkout ↔ managed workspace), +B-15 (FS/git substrate), +B-16 (app toolchain), B-09 split a/b, B-12 split (local reader; GitHub via B-01), B-10a org-identity sub-boundary, B-05 launchd-only L3 qualification, unattended-L3 profile language adopted, seam-by-seam operational failure modes folded in. F-PT-006 opened. Rev 2 REFUSED (B-17 external-effect target missing; B-02/03/07 layer blur; B-09b ownership; B-13 provenance) — all corrected in rev 3. Rev 3 REFUSED (B-17: BLOCKED not EMPTY/BLOCKED; no nonexistent-policy-entry claim) — corrected. **CONFIRMED** 2026-07-31 (rev 4).
- Phase 4 (contracts): **CONFIRMED** 2026-07-31 (round 4) — contracts/ (23 files, 22 canonical OPERON-C IDs). History: draft REFUSED round 1 (12 objections: cadence≠guarantee; adapter budget-observation; B-03 read bypass; time identities; B-09a orphan grant; B-11 forward-only; B-12 no-quarantine; B-14 publish-vs-bootstrap + F-PT-007; B-15 no version floor; B-16 ratified output bounds; B-17 typed markers; journey traces + 4 false criteria). All corrected; operation contracts C-OP-LIFE/C-OP-PLAN/C-OP-LOOP added. Round 2 REFUSED (canonical IDs; F-PT-008 grant-expiry parking; C-OP-LIFE verify writes + refusal split; residual cadence wording; J-10 cardinality; J-18 admission/delivery split) — all corrected. Round 3 REFUSED (non-resolving trace-table notation; J-10 at-most-once permitted silent skip; B-09a indefinite-viability promise) — all corrected. **CONFIRMED** 2026-07-31 (round 4).
- Phase 5 (LLM eval plan): **CONFIRMED** 2026-07-31 (round 4) — llm-eval-plan.md §§0–9 + 11 golden-set scaffolds. History: round 1 REFUSED (thresholds-as-decision-rules; scaffold truthfulness; unratified trajectory bounds) — all corrected: plan §9 decision-status rule (inconclusive-only until ratified), F-PT-009 widened + F-PT-010 opened, ten truthful scaffolds incl. brief-conditioning/, trajectory checks split ratified/provisional/observed. Round 2 REFUSED (missing S-2 L4 scaffold; unowned OPEN decisions → F-PT-011; root-contract overclaim) — corrected: builder-quality/ added (11 dirs), F-PT-011 umbrella opened, root exempts deterministic/study scaffolds. Round 3 REFUSED (F-PT-011 scope vs brief-conditioning; S-5/S-6/S-7 threshold/cadence omissions) — corrected in the canonical plan. **CONFIRMED** 2026-07-31 (round 4).
- Phase 6 (risk tiers + catalog derivation): **COMPLETE** 2026-07-31 — weighting CONFIRMED (round 3): `risk-allocation.md` (E-1/2/3 families, INV-001/011/015 floors, L3 spend ≤$5/≤$15 + triggers *(release bound later amended to ≤24 turns/$100 at human ratification — see Human ratification section)*, 7-day soak, **owner-ratified threat-model scope+timing**, **owner-ratified contention exercise**, completeness/verdict split). Gate history: round 1 refused (threat-model scope/timing, contention design, verdict split — all corrected as owner rulings), round 2 refused (INV-015/T-10/T-11 bucket closure — corrected). Catalog derived to matrix closure: `case-catalog.md` (8 matrices, ~130 case families + 4 L3 families, all cells traced or named-pruned/blocked; closure §9); catalog confirmed at combined gate round 4.
- Phase 7 (tooling): SELECTED by owner (vitest + fast-check; in-process fakes + real temp git; opt-in live config; hand-rolled eval runner; STRIDE doc; L5-classified contention rig; soak protocol; pinned fail-closed gitleaks w/ canary + no broad fixture allowlists; GitHub Actions). 5-min L1/L2 target = PROPOSED reported-optimization-target (timeout⇒incomplete once ratified). Combined gate round 1 REFUSED on catalog closure (contention layer; missing Codex-rotation L5 case; F-PT-004 in-cell blocks; closure arithmetic/IDs/risk vocab) — all corrected. Combined gate round 2 REFUSED (boundary count 18×7=126; GROW is L2 not L5; contract per-ID resolver + S-range) — all corrected. Round 3 REFUSED (resolver misroutes/omissions) — corrected: exact L3 case IDs (CF-B01/02/03/04-L3) minted and referenced; B-06/B-07 → 2+5 dup CF-OPS-SOAK; B-09B → 2+3 dup CF-J18-A. Round 4 **CONFIRMED** 2026-07-31 — catalog closure + tooling both ratified. Phase 6 and Phase 7 complete.
- Phase 8 (deliverables + adversarial review): **COMPLETE** — reader test complete (operator/new-engineer/coding-agent); all findings dispositioned: README.md entry point created; agents-md rewritten (activation clause, tagging sources, golden-set targeting, new-finding procedure, structural-additions rule, standing-rules digest); backlog +HB-007/+HB-047, L3 header + convention fixes; catalog §4 convention; policy single-source annotations; ratification-package.md WRITTEN. FINAL GATE round 1 REFUSED (YAML validity; registry completeness incl. B-17-L3 id + blocked-contract statuses; three stale future-policy references; ratification-package provenance/cardinality) — all corrected, policy verified parsing. FINAL GATE round 2 initially held on two audit defects (contracts [rambling] attribution B-03→B-06; stale checkpoint lines) — both corrected. **FINAL GATE CONFIRMED (round 2, 2026-07-31)** — stakeholder audited all 16 registered artifacts, 23 contract files, 11 scaffolds, parsed policy, verified provenance attribution and 15 simulated-seat decisions. Phase 8 COMPLETE; campaign closed. Confirmation scope: design campaign only — NOT real-human ratification, NOT harness implementation, NOT release-gating reactivation; policy stays draft, gating stays SUSPENDED, B-17-L3 and the five finding-dependent contracts stay blocked. *(Scope statement superseded 2026-07-31 by the human ratification recorded below: policy now ratified; F-PT-003/004/007 contracts unblocked; gating still SUSPENDED; B-17-L3 and the F-PT-006/008 contracts still blocked.)*

## Open findings
- F-PT-001 (resolved-by-docs, recorded): redaction scope — rambling's "everything redacts" vs docs' verbatim L3 (`brief.md`, `prompt.md`, `output.md`, `session.log`); docs win. Details: scope-and-module-map.md §3, system-map.md §4.
- F-PT-002 (RESOLVED-ratified 2026-07-31): deployed-state facts recorded (verified read-only 2026-07-31): active org selector `~/.operon/config` → org_home=/Users/bikram/Build/sonnet1-org, state_home=~/.operon/Buildstacks (recorded 2026-07-24); one registered app sonnet8-buildstack-dev (repo buildstacks-dev/sonnet8-buildstack-dev), live; scheduler NOT installed (no scheduler state dir, no operon launchd jobs) — all turns human-invoked; two residual partial state homes (~/.operon/operon; ~/.operon/questionnaire) are not active orgs.
- F-PT-003 (RESOLVED-ratified 2026-07-31): crash convergence contract is now truth — **pause holds; exactly one budget-exceeded item eventually**. HB-P1 unparked; CF-J07-I derivable.
- F-PT-004 (RESOLVED-ratified 2026-07-31): ambiguous uncommitted worktree bytes are **preserved-and-inspected, never reset** — contract truth. HB-P2 unparked; CF-J04-I/CF-B15-* lines encoded.
- F-PT-009 (open — owner decision): Reviewer thresholds, N, AND sample design (case counts, severity+pairing aggregation, inconclusive rule) unratified; numbers on file are budgeting hypotheses; owner ruling: data-collection only, threshold-dependent verdicts inconclusive, never release-blocking/green. See llm-eval-plan.md §§8–9.
- F-PT-010 (open): Planner (≥85%) and SRE (≥80%) thresholds + sample designs are unratified budgeting hypotheses (source: neither owner nor docs); same ruling applies.
- F-PT-011 (open — umbrella, site-specific decisions): later-set thresholds + sample designs (Builder quality, Support, Marketing content, Marketing analysis, Distiller, Learning Reviewer) + brief-conditioning sampling design; inconclusive-only until each ratifies; Learning Reviewer scores inadmissible until calibrated + ratified.
- F-PT-008 (open): what grant TTL expiry does to the approval item (fresh item, reopen, or explicit operation) is unratified; decision records are immutable; B-09a takes no position. See contracts/B-09a.
- F-PT-007 (RESOLVED-ratified 2026-07-31): concurrent human edit of a bootstrap-owned marker/generated path between validation and write yields **compare-and-refuse, preserving human bytes** — contract truth (org-init's exclusive-creation+exact-rollback still NOT generalized by analogy). HB-P4 unparked; see contracts/B-14.
- F-PT-006 (open): company-event producer visibility protocol (atomic rename vs tolerated-partial+retry) unspecified in docs; fake must not make policy by fixture convenience. See boundary-map.md §4.
- F-PT-005 (RESOLVED by owner ratification 2026-07-31; human-ratified by adoption 2026-07-31): added subscribers inherit still-pending events; removed subscribers cease blocking retirement. Derivation retained as provenance. See invariants.md.
- F-PT-012 (open; raised Wave-1 implementation 2026-07-31): app-reset execute order — ratified prose (registry removal before local clears, OP-lifecycle §6 + CF-J14-S row) vs deliberate code design (local clears first; registry removal as the atomic commit point). Dependent case parked in cf-j14-s.
- F-PT-013 (open; raised Wave-1): direct `git push` to the remote default branch classifies routine; enforcement locus (gate classifier vs loop-level guard holding default-branch state) undecided (INV-009 adjacency). Parked leg in cf-inv-002 alt-route spec.
- F-PT-014 (open; raised Wave-1): INV-003 names "outside-worktree actions" never-broadly-scopeable but NEVER_SCOPEABLE_RULES has no mapping for that category; nearest live classes are human-widenable today. Parked in cf-sm-appr unit spec.
- F-PT-015 (open; raised Wave-1): B-14 §4 bootstrap re-run semantics — product refuses outright vs contract "idempotent; marked block replaced in place; regenerated deterministically". Unambiguous half asserted; disjunction documented in cf-b14 spec.
- F-PT-016 (open; raised Wave-1): publish-origin identity comparison ownership — bootstrap publish pushes to an origin that is not the registered repo (no comparison exists); B-14 §3 wrong-remote vs B-15 remote-identity split unresolved. Parked leg in cf-b14-publish spec.

## Decisions on record
- Criticality/tiering was elicited teach-first at Phase 1 (no prior anchor); synthesis in system-map.md §5: base C2, function-scoped C3 control points T-1…T-12, C1 leaves, recovery as tier multiplier, compound worst case §5.5.
- M10 flagged for later deep pass; M13 (learning loop) broad-and-shallow this campaign with stakeholder-directed floor; M14 confidentiality slice mandatory.
- Unattended live-sandbox runnability (zero human approvals, sandbox orgs only, publishing/non-sandbox still hard-gated) is a first-class layer-3 requirement for the policy file.
- Release-gating replacement = campaign/policy obligation, proportionate; not a module.

## PROPOSED register (provisional values/mechanisms; owner: human; expiry: items 1–8 and 13 = first harness build review (HB-007 tripwire); items 9–12 = first eval-campaign design review — per validation-policy.yaml `proposed_register`) <!-- AUD-104 -->
1. B-01 GitHub retry budget: 3 attempts, exponential backoff, per operation.
2. B-07 liveness-identity mechanism (semantic: survive PID reuse).
3. B-07 descendant-cleanup mechanism (semantic: terminate owned descendant tree).
4. B-10 preview→execute exact-hash comparison on depended-on surfaces.
5. B-15 index.lock bounded wait ≤ 30 s (never delete/steal a foreign lock).
6. B-15 hooks-disabled managed clones (core.hooksPath empty).
7. B-16 per-gate timeout default 15 min (contract: every gate has an explicit bound surfaced in evidence).
8. B-16 candidate-mutation detection mechanism (scope: candidate HEAD + tracked/decision-relevant diff + governed generated paths).
9. S-3 Reviewer threshold hypotheses ≥95%/≤10%/N≥3 (F-PT-009; **budgeting only — inconclusive-verdict rule until ratified**).
10. S-1 Planner hypothesis ≥85%/N≥3 (F-PT-010; same inconclusive rule).
11. S-2 repeat-loop signature N=3 (may assert only once ratified).
12. S-4 SRE hypothesis ≥80%/N≥3 (F-PT-010; same inconclusive rule).
13. CI per-commit L1/L2 wall-clock target 5 min (PROPOSED — reported optimization target from first build; once ratified, timeout ⇒ completeness=incomplete, never green).

Owner-ratified this campaign ([simulated] seat) and **human-ratified 2026-07-31** (ratification-package.md §9; all as drafted except the release spend, amended at ratification): B-06 clock-anomaly response; F-PT-005 subscriber cutoff; eval decision-status rule (inconclusive-only); L3 spend policy (≤2 turns/$5 pre-merge; release amended to **≤24 turns/$100** — originally ≤6 turns/$15); 7-day sandbox soak with $15 ceiling; L3/launchd/GitHub trigger rules; threat-model scope+timing (human-authored, on the critical path to release-gating reactivation); contention exercise design; completeness/verdict split.
Struck by stakeholder: uniform budget-observation point; git version floor; 1 MiB gate output cap; ≤60 s heartbeat (ratified 30 s [doc]).

## Audit iteration 1 (2026-07-31)
Independent design-conformance audit returned AUD-101…109. All nine dispositioned
**fixed** (no disputes, no deferrals); details in elicitation-log.md "Audit iteration 1".
Note on AUD-101: the final-gate round-2 "verified provenance attribution" claim above is
superseded — it verified tag location/count, not content existence in rambling.txt. Two
distinct corrections resulted: (1) the B-06 missed-window tag was FALSE and removed
(now compound `[doc][walk]`, footnoted); (2) B-03's auth-rotation tag is GENUINE
(rotation-race scar, rambling.txt) and was restored at dispositions round 2 after the
first correction over-removed it. Current contracts rambling total: **1** (B-03).

## Audit iteration 2 (2026-07-31)
Verification pass: all nine iteration-1 dispositions VERIFIED at their fix sites;
provenance arithmetic independently reproduced; no new blocking findings; no
regressions. Residues: system-map §0 stale "pending" clause fixed; loose changelog
label fixed; contracts-row compound-tag footnote convention accepted as-is
(self-scoped, numbers reproduce).

## Human ratification — 2026-07-31

The product owner worked through `ratification-package.md` in session (full record:
its §9). Summary of the event:
- All 15 §3 decisions dispositioned: items 13/14/15 **YES as drafted** (F-PT-003
  "pause holds; exactly one budget-exceeded item eventually"; F-PT-004
  preserve-and-inspect, never reset; F-PT-007 compare-and-refuse preserving human
  bytes — all three now contract truth); item 3 **AMENDED** (release campaign raised
  to ≤24 provider turns/$100 — owner: "I don't want the test to be stopped just
  because of some repeat things"; hard bound, human-edit-only; pre-merge 2/$5
  unchanged); items 5 and 11 **CONFIRMED** (threat model human-authored, on the
  release-gating critical path; unattended profile as shaped); items 1, 2, 4, 6, 7,
  8, 9, 10, 12 **ratified by adoption** (individually reversible via
  harness-revision mode; gitleaks with its stated conditions).
- F-PT-002 **resolved** with recorded deployed-state facts (see findings list above).
- rambling.txt reviewed and confirmed by the owner as his voice (provenance note
  added to package §2).
- `design_status` → **ratified**; HB-P1/HB-P2/HB-P4 unparked; +HB-080/+HB-081
  (converted §6 IOUs); agents-md section being landed (binding once landed).
- Still open: F-PT-006, F-PT-008 (owner did not decide; HB-P3/HB-P5 stay parked),
  F-PT-009/010/011 (inconclusive-only rule stands); PROPOSED-register expiries
  unchanged.

## Pending confirmations
- None in-campaign. Audit iteration 2 CONFIRMED (2026-07-31): verification pass clean,
  no new blocking findings; two residues fixed, compound-tag convention accepted
  as-is; historical "pending Phase 1 hard-stop" quotations in audit/log entries are
  trace preservation per stakeholder ruling, not unresolved residue. AUD-101…109
  remain closed.
- Human ratification COMPLETE (2026-07-31, section above). Current scope: design
  RATIFIED; Wave 0 implementation authorized; release gating remains SUSPENDED until
  the replacement qualification and the human-authored threat model exist.
- Remaining human decision points: F-PT-006 and F-PT-008 (undecided findings);
  F-PT-009/010/011 (eval thresholds, inconclusive-only until ratified);
  PROPOSED-register items at their expiries (1–8, 13 at the HB-007 tripwire; 9–12 at
  first eval-campaign design review).
