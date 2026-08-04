# Harness design state — Cormidia validation campaign

Updated: 2026-08-03 (2026-07-31 design campaign CLOSED and RATIFIED; implementation Waves
0–4 plus L3/L4 runner surfaces, L5 contention/soak collectors, and HB-080/081
complete in the replacement harness worktree; audit loop CLOSED verdict
"clean" — AUD-101…109 all fixed, audit record in ratification-package.md §7;
product-owner ratification record in ratification-package.md §9)

## Active harness revision — roadmap, validation, delivery units, batching (2026-08-03)

Scope: combined #184/#233/#234/#240 lifecycle, `harness-revision` fast mode. Phase 0
scope/coexistence and Phase 1 map+tier were explicitly confirmed; Phase 2's invariant
direction and naming were explicitly confirmed. Phase 3 boundaries, Phase 4 contracts,
and Phase 5 call-site/golden-set changes are drafted from the owner's large-backlog,
one-sitting/cache-economics elicitation.

Draft additions: M17; J-20; INV-016 plus surgical extensions to existing invariants;
B-20/B-21/B-22 and their canonical contracts; C-OP-VALIDATION/C-OP-BATCH; delivery-unit
revisions to C-OP-PLAN/C-OP-LOOP; S-10 Validation Designer; large-backlog/delta/cache-
lure Planner cases; Validation Designer pre-tuning cases. The implementation converges
product planning and delivery on the shared `orchestrateEpisode` façade while retaining
domain-specific adapters.

Phase 6 risk weighting and layer-5 obligations were explicitly owner-confirmed. A later
scenario refinement generalized batching from code delivery units to execution units:
roadmap-backed code units and complete direct operational units. The latter may omit
RoadmapPlan but never EpisodePlan/effect policy; external payloads retain exact approvals.

Phase 7 tooling was explicitly owner-confirmed: the existing Vitest/fast-check/owned-
fake/temp-git/eval/ops toolchain remains sufficient, with new fixtures rather than a new
framework or hosted service. The policy registry, matrix-closed design cases and
implementation backlog are now drafted. The operator/new-engineer/coding-agent reader
test is recorded in the Phase 8 package.

Phase 8 was explicitly accepted by the product owner on 2026-08-03 using the exact
decision statement recorded in `ratification-package.md` §10.7. Verification on the
isolated revision worktree: policy/golden JSON parse and
registry/cardinality checks passed; `git diff --check`, typecheck and build passed; the
final offline run passed 145/145 files and 951 tests with one intentionally parked skip.
The first full run's unrelated CF-J12-I missing-journal failure passed immediately in
isolation and the subsequent full rerun was green; it was recorded rather than ignored.

**Current state:** Phase 8 is closed and the revision is the binding implementation
contract. HB-100's local provider-free walking skeleton, HB-101's whole-backlog
roadmap authority and HB-102's validation-contract/readiness authority are complete in
`src/org/roadmap-delivery.ts` with its L1/L2 detector at
`tests/hermetic/cf-hb100/roadmap-delivery-walking-skeleton.test.ts` and five
HB-101 cases at `tests/hermetic/cf-hb101/roadmap-authority.test.ts`, plus six
HB-102 cases at `tests/hermetic/cf-hb102/validation-contract-authority.test.ts`.
Protocol-surface edits, merge, publication/deployment, external effects and live/eval/
soak campaigns remain separately gated; acceptance creates no autonomous-loop
readiness, release-gating or executable-coverage claim.

HB-100 verification: its five cases prove the two-ticket roadmap→validation→batch→
lazy zero-turn EpisodePlan→atomic claim→synthetic PR evidence→independent review join,
plus label-only and Planner/Builder human-only refusals and seeded unit/contract/HEAD
lineage violations.
HB-101 adds immutable complete/paginated backlog snapshots, current RoadmapPlan pointer,
exact 125-issue accounting, WIP/priority/frontier guards, deterministic projection
repair, stable IDs, append-only moves, and a 120-item prior-plan delta with only one
changed and one added issue; non-admitted work creates no EpisodePlan. HB-102 adds the
closed v1 schema, pinned accepted catalog, strict forward-only contract lifecycle,
current-unit and readiness authorities, canonical/coverage/layer/shared-detector checks,
durable human-approved bounded waivers, C3/floor routine refusal, exact hash lineage,
current-label/roadmap rereads and stale-version guards. HB-103…105 add production
RoadmapPlan/readiness consumption, atomic one-or-more-ticket claims and PR projections,
bounded deterministic ExecutionUnit batches, per-unit journals/budgets/outcomes, lazy
EpisodePlans, and strict provenance-bearing zero-turn normalization. No provider,
live/eval/soak, publication, protocol-surface edit or external effect ran. #239 is merged
and its two-boundary exclusion remains covered; HB-106…111 remain, so autonomous-loop
readiness is not claimed.

## Harness revision — comparative execution (2026-08-01)

The owner confirmed the direction for per-provider-turn comparison and standalone
repository use, then requested a design and implementation epic. The revision adds
M16, J-19, B-18/B-19, contracts CORMIDIA-C-B18-001/CORMIDIA-C-B19-001, S-8, and their
case/backlog families. It introduces no new global invariant, criticality tier,
control point, tool, or live dependency. Existing T-2/T-5/T-6/T-7/T-9/T-11 controls
and INV-001/002/004/006/008/009/010/012/013/014/015 cover the feature.

Revision status is **proposed implementation contract, direction owner-confirmed**.
The new case families are design-only and do not change the 2026-07-31 implementation
evidence. Exact EpisodePlan/CLI transport belongs to the implementation epic. S-8
automatic selection is inadmissible under F-PT-011 until its meta-eval, human
references, thresholds, and sampling design ratify; advisory data collection and
declared non-judge fallbacks remain possible. V1 is explicit and sequential, so no
new L5 obligation exists; automatic sampling or parallel execution must re-enter risk
allocation. A reader pass confirmed that an operator can distinguish preview,
execution, selection, and materialization; an engineer can resolve every new journey,
boundary, contract, call site, case family, and backlog owner; and a coding agent can
start with HB-090 without inferring product truth from current implementation.

Revision verification on 2026-08-01: `validation-policy.yaml` parsed; the full offline
suite passed 130/130 files (788 passed, one intentionally parked skip); `pnpm
typecheck`, `pnpm build`, and `git diff --check` passed. No L3/L4/L5 campaign ran.

## Harness implementation status
- Wave 0: complete (walking skeleton, fixtures/doubles, policy pin, per-commit lane,
  HB-007 owner review).
- Wave 1: complete (E-1 permission-to-effect chain; five case cells parked on
  F-PT-012…016 rather than guessed).
- Wave 2: complete at L1/L2 (HB-020…025 + HB-P1/P2). The 2026-07-31 full gate ran
  95 files: 662 passed and one intentionally parked skip. Real provider proof is
  not implied; it remains HB-051 in the separately gated L3 wave.
- Wave 3: complete at L1/L2 (HB-030…033). The 2026-07-31 full gate ran 108 files:
  699 passed and one intentionally parked skip; typecheck and build were green.
  The evidence covers exact-HEAD/default-branch merge authorization, legal loop
  phase entry, restart/SSE/source-integrity behavior, delivery/approval truth,
  and cross-surface cost, budget, lifecycle, capability, and error agreement.
  Separately gated L3/L4/L5 evidence is not implied.
- Wave 4: complete at L1/L2 (HB-040…047). The 2026-07-31 full gate ran 116 files:
  726 passed and one intentionally parked skip in 61.93 seconds; typecheck and
  build were green. The event, planning, onboarding, scheduler, retention,
  presentation, trajectory, and format-repair families are executable. The
  F-PT-006 producer-crash/duplicate-identity clauses remain parked rather than
  guessed.
- L3: the strict human-authorized campaign runner, real-adapter pair, sandbox-GitHub
  surface, attributable launchd proof, unattended profile, and durable product
  reporting are implemented. No live provider/repository/host campaign was run, so
  HB-051…054 evidence remains incomplete—not pass. B-17-L3 remains blocked.
- L4: the per-tuple data-collection runner, rotating shards, token reservations, and
  reviewer/planner/builder-trajectory committed sets are implemented. Reviewer and
  planner human reference review remains pending; F-PT-009/010/011 keep every
  threshold-dependent verdict inconclusive.
- L5: CF-OPS-CONT's ratified contention rig is implemented and green. The resumable
  seven-day soak/rotation collector is implemented but no real window was scheduled.
  The ten-surface threat-model worksheet is explicitly only a scaffold; HB-072 awaits
  a human author/reviewer and the hash-bound gate keeps HB-073 blocked.
- HB-080 and HB-081 are complete: the alert→action runbook is linked from all campaign
  surfaces, and product surfaces render inconclusive as not-a-pass/not-release-evidence.
  F-PT-017 and F-PT-018 remain parked exactly as recorded below.

## Final implementation audit and verification — 2026-07-31

The post-build `validation-harness-audit` pass is closed after hardening the findings
it surfaced. In particular: turn-lock mutation/release is serialized and nonce-bound;
unknown failed-case provider/token spend debits the full reservation; exact-ceiling
coverage remains incomplete; L3/L4/L5 entry binds canonical policy (and L4 golden
inputs) to clean tracked blobs at the authorized HEAD; malformed golden provenance and
usage are refused; unavailable required soak sources cannot produce complete evidence;
and GitHub/launchd cleanup failures remain inside their recorded cases. These are
tighten-only corrections with negative controls, not relaxed expectations.

Final focused verification passed 65 policy/report/eval/profile/soak/GitHub tests,
plus the two-case contention rig and the two selected lock ownership/signal controls.
`pnpm typecheck`, `pnpm build`, `git diff --check`, and `npm pack --dry-run` passed; the
package contains 273 files (1.0 MB tarball, 4.0 MB unpacked). No tarball was written.

The final full run on the managed Codex desktop host exercised 128 files: 72 files
passed and 56 failed; 589 tests passed, 184 failed, one intentionally parked test was
skipped, and one unhandled rejection was reported. The failures are fail-closed host
limitations, dominated by denied `ps` process-start identity probes and the resulting
kill-point/lock cascades (plus the already observed loopback/Unix-socket restrictions),
not assertions weakened or normalized away. This constrained-host run is therefore
not green evidence. The last full run in an ordinary environment before the triggered
lane hardening remains the Wave-4 record above (116 files, 726 passed, one parked skip);
the pull-request CI lane is the authoritative clean-host verification for the final
integrated tree. `pnpm smoke:onboarding` is likewise blocked on this host at the same
process-identity probe.

## Campaign
- Skill: validation-harness-design
- Scope mode: `product` — **CONFIRMED at Phase 0** (rev 2, round 3)
- Target: production Cormidia (org runtime)
- Artifact root: `./validation-design/`
- Harness implementation root (per docs v2.9, build-time only): `tests/`
  — not built during the design campaign itself; now implemented through the bounded
  runner/collector work recorded above. External evidence remains separately gated.
- Incumbent suite: archived under `archive-do-not-read/**` — protected no-read path (ratified at Phase 0); clean-slate greenfield, no coexistence posture
- ID namespace: `CORMIDIA-` (confirmed at Phase 0)
- Provenance labels in force: `[doc]`, `[rambling]`, `[simulated]`, `[PROPOSED]`, `[walk]` (Phase 1 elicitation). `[stated]` reserved and unused (no live ratifying human).
- Fast mode: declined — full teach-first for every concept.

## Phase status
- Phase 0 (scope + module map): **CONFIRMED** 2026-07-31 (rev 2, round 3) — `scope-and-module-map.md`
- Phase 1 (system map + tier): **CONFIRMED** 2026-07-31 (round 4) — `system-map.md` §§0–5, tier C2 base + T-1…T-12. Gate history: rounds 1–3 refused; corrections and round records in elicitation-log.md.
- Phase 2 (invariants): **CONFIRMED** 2026-07-31 (round 3) — `invariants.md` CORMIDIA-INV-001…015. Rounds 1–2 refused; corrections logged.
- Phase 3 (boundary map): **CONFIRMED** 2026-07-31 (rev 4) — `boundary-map.md` B-01…B-17. History: rev-1 draft corrected per elicitation: +B-14 (human checkout ↔ managed workspace), +B-15 (FS/git substrate), +B-16 (app toolchain), B-09 split a/b, B-12 split (local reader; GitHub via B-01), B-10a org-identity sub-boundary, B-05 launchd-only L3 qualification, unattended-L3 profile language adopted, seam-by-seam operational failure modes folded in. F-PT-006 opened. Rev 2 REFUSED (B-17 external-effect target missing; B-02/03/07 layer blur; B-09b ownership; B-13 provenance) — all corrected in rev 3. Rev 3 REFUSED (B-17: BLOCKED not EMPTY/BLOCKED; no nonexistent-policy-entry claim) — corrected. **CONFIRMED** 2026-07-31 (rev 4).
- Phase 4 (contracts): **CONFIRMED** 2026-07-31 (round 4) — contracts/ (23 files, 22 canonical CORMIDIA-C IDs). History: draft REFUSED round 1 (12 objections: cadence≠guarantee; adapter budget-observation; B-03 read bypass; time identities; B-09a orphan grant; B-11 forward-only; B-12 no-quarantine; B-14 publish-vs-bootstrap + F-PT-007; B-15 no version floor; B-16 ratified output bounds; B-17 typed markers; journey traces + 4 false criteria). All corrected; operation contracts C-OP-LIFE/C-OP-PLAN/C-OP-LOOP added. Round 2 REFUSED (canonical IDs; F-PT-008 grant-expiry parking; C-OP-LIFE verify writes + refusal split; residual cadence wording; J-10 cardinality; J-18 admission/delivery split) — all corrected. Round 3 REFUSED (non-resolving trace-table notation; J-10 at-most-once permitted silent skip; B-09a indefinite-viability promise) — all corrected. **CONFIRMED** 2026-07-31 (round 4).
- Phase 5 (LLM eval plan): **CONFIRMED** 2026-07-31 (round 4) — llm-eval-plan.md §§0–9 + 11 golden-set scaffolds. History: round 1 REFUSED (thresholds-as-decision-rules; scaffold truthfulness; unratified trajectory bounds) — all corrected: plan §9 decision-status rule (inconclusive-only until ratified), F-PT-009 widened + F-PT-010 opened, ten truthful scaffolds incl. brief-conditioning/, trajectory checks split ratified/provisional/observed. Round 2 REFUSED (missing S-2 L4 scaffold; unowned OPEN decisions → F-PT-011; root-contract overclaim) — corrected: builder-quality/ added (11 dirs), F-PT-011 umbrella opened, root exempts deterministic/study scaffolds. Round 3 REFUSED (F-PT-011 scope vs brief-conditioning; S-5/S-6/S-7 threshold/cadence omissions) — corrected in the canonical plan. **CONFIRMED** 2026-07-31 (round 4).
- Phase 6 (risk tiers + catalog derivation): **COMPLETE** 2026-07-31 — weighting CONFIRMED (round 3): `risk-allocation.md` (E-1/2/3 families, INV-001/011/015 floors, L3 spend ≤$5/≤$15 + triggers *(release bound later amended to ≤24 turns/$100 at human ratification — see Human ratification section)*, 7-day soak, **owner-ratified threat-model scope+timing**, **owner-ratified contention exercise**, completeness/verdict split). Gate history: round 1 refused (threat-model scope/timing, contention design, verdict split — all corrected as owner rulings), round 2 refused (INV-015/T-10/T-11 bucket closure — corrected). Catalog derived to matrix closure: `case-catalog.md` (8 matrices, ~130 case families + 4 L3 families, all cells traced or named-pruned/blocked; closure §9); catalog confirmed at combined gate round 4.
- Phase 7 (tooling): SELECTED by owner (vitest + fast-check; in-process fakes + real temp git; opt-in live config; hand-rolled eval runner; STRIDE doc; L5-classified contention rig; soak protocol; pinned fail-closed gitleaks w/ canary + no broad fixture allowlists; GitHub Actions). The 5-min L1/L2 target is a **human-ratified report-only optimization target** as of HB-007 review 2026-07-31; missing it has no verdict effect (the CI core-job ceiling is 15 min). Combined gate round 1 REFUSED on catalog closure (contention layer; missing Codex-rotation L5 case; F-PT-004 in-cell blocks; closure arithmetic/IDs/risk vocab) — all corrected. Combined gate round 2 REFUSED (boundary count 18×7=126; GROW is L2 not L5; contract per-ID resolver + S-range) — all corrected. Round 3 REFUSED (resolver misroutes/omissions) — corrected: exact L3 case IDs (CF-B01/02/03/04-L3) minted and referenced; B-06/B-07 → 2+5 dup CF-OPS-SOAK; B-09B → 2+3 dup CF-J18-A. Round 4 **CONFIRMED** 2026-07-31 — catalog closure + tooling both ratified. Phase 6 and Phase 7 complete.
- Phase 8 (deliverables + adversarial review): **COMPLETE** — reader test complete (operator/new-engineer/coding-agent); all findings dispositioned: README.md entry point created; agents-md rewritten (activation clause, tagging sources, golden-set targeting, new-finding procedure, structural-additions rule, standing-rules digest); backlog +HB-007/+HB-047, L3 header + convention fixes; catalog §4 convention; policy single-source annotations; ratification-package.md WRITTEN. FINAL GATE round 1 REFUSED (YAML validity; registry completeness incl. B-17-L3 id + blocked-contract statuses; three stale future-policy references; ratification-package provenance/cardinality) — all corrected, policy verified parsing. FINAL GATE round 2 initially held on two audit defects (contracts [rambling] attribution B-03→B-06; stale checkpoint lines) — both corrected. **FINAL GATE CONFIRMED (round 2, 2026-07-31)** — stakeholder audited all 16 registered artifacts, 23 contract files, 11 scaffolds, parsed policy, verified provenance attribution and 15 simulated-seat decisions. Phase 8 COMPLETE; campaign closed. Confirmation scope: design campaign only — NOT real-human ratification, NOT harness implementation, NOT release-gating reactivation; policy stays draft, gating stays SUSPENDED, B-17-L3 and the five finding-dependent contracts stay blocked. *(Scope statement superseded 2026-07-31 by the human ratification recorded below: policy now ratified; F-PT-003/004/007 contracts unblocked; gating still SUSPENDED; B-17-L3 and the F-PT-006/008 contracts still blocked.)*

## Open findings
- F-PT-001 (resolved-by-docs, recorded): redaction scope — rambling's "everything redacts" vs docs' verbatim L3 (`brief.md`, `prompt.md`, `output.md`, `session.log`); docs win. Details: scope-and-module-map.md §3, system-map.md §4.
- F-PT-002 (RESOLVED-ratified 2026-07-31): deployed-state facts recorded (verified read-only 2026-07-31): active org selector `~/.cormidia/config` → org_home=/Users/bikram/Build/sonnet1-org, state_home=~/.cormidia/Buildstacks (recorded 2026-07-24); one registered app sonnet8-buildstack-dev (repo buildstacks-dev/sonnet8-buildstack-dev), live; scheduler NOT installed (no scheduler state dir, no cormidia launchd jobs) — all turns human-invoked; two residual partial state homes (~/.cormidia/cormidia; ~/.cormidia/questionnaire) are not active orgs.
- F-PT-003 (RESOLVED-ratified 2026-07-31): crash convergence contract is now truth — **pause holds; exactly one budget-exceeded item eventually**. HB-P1 unparked; CF-J07-I derivable.
- F-PT-004 (RESOLVED-ratified 2026-07-31): ambiguous uncommitted worktree bytes are **preserved-and-inspected, never reset** — contract truth. HB-P2 unparked; CF-J04-I/CF-B15-* lines encoded.
- F-PT-009 (open — owner decision): Reviewer thresholds, N, AND sample design (case counts, severity+pairing aggregation, inconclusive rule) unratified; numbers on file are budgeting hypotheses; owner ruling: data-collection only, threshold-dependent verdicts inconclusive, never release-blocking/green. See llm-eval-plan.md §§8–9.
- F-PT-010 (open): Planner (≥85%) and SRE (≥80%) thresholds + sample designs are unratified budgeting hypotheses (source: neither owner nor docs); same ruling applies.
- F-PT-011 (open — umbrella, site-specific decisions): later-set thresholds + sample designs (Builder quality, Support, Marketing content, Marketing analysis, Distiller, Learning Reviewer), brief-conditioning sampling design, and S-8 selection-judge calibration/thresholds; inconclusive-only until each ratifies; Learning Reviewer and Selection Judge scores inadmissible until calibrated + ratified.
- F-PT-008 (open): what grant TTL expiry does to the approval item (fresh item, reopen, or explicit operation) is unratified; decision records are immutable; B-09a takes no position. See contracts/B-09a.
- F-PT-007 (RESOLVED-ratified 2026-07-31): concurrent human edit of a bootstrap-owned marker/generated path between validation and write yields **compare-and-refuse, preserving human bytes** — contract truth (org-init's exclusive-creation+exact-rollback still NOT generalized by analogy). HB-P4 unparked; see contracts/B-14.
- F-PT-006 (open): company-event producer visibility protocol (atomic rename vs tolerated-partial+retry) unspecified in docs; fake must not make policy by fixture convenience. See boundary-map.md §4.
- F-PT-005 (RESOLVED by owner ratification 2026-07-31; human-ratified by adoption 2026-07-31): added subscribers inherit still-pending events; removed subscribers cease blocking retirement. Derivation retained as provenance. See invariants.md.
- F-PT-012 (open; raised Wave-1 implementation 2026-07-31): app-reset execute order — ratified prose (registry removal before local clears, OP-lifecycle §6 + CF-J14-S row) vs deliberate code design (local clears first; registry removal as the atomic commit point). Dependent case parked in cf-j14-s.
- F-PT-013 (open; raised Wave-1): direct `git push` to the remote default branch classifies routine; enforcement locus (gate classifier vs loop-level guard holding default-branch state) undecided (INV-009 adjacency). Parked leg in cf-inv-002 alt-route spec.
- F-PT-014 (open; raised Wave-1): INV-003 names "outside-worktree actions" never-broadly-scopeable but NEVER_SCOPEABLE_RULES has no mapping for that category; nearest live classes are human-widenable today. Parked in cf-sm-appr unit spec.
- F-PT-015 (open; raised Wave-1): B-14 §4 bootstrap re-run semantics — product refuses outright vs contract "idempotent; marked block replaced in place; regenerated deterministically". Unambiguous half asserted; disjunction documented in cf-b14 spec.
- F-PT-016 (open; raised Wave-1): publish-origin identity comparison ownership — bootstrap publish pushes to an origin that is not the registered repo (no comparison exists); B-14 §3 wrong-remote vs B-15 remote-identity split unresolved. Parked leg in cf-b14-publish spec.
- F-PT-017 (open-blocked-contract; raised Wave-2 harness revision 2026-07-31): provider terminal-status vocabulary conflicts — ratified CORMIDIA-C-CORE-001 says `interrupted`, while `Runtime`/all adapters expose `timed_out`. The contract was not rewritten from implementation behavior; its enum-conformance clause is parked in CF-C-CORE/HB-P6 pending the owner decision.
- F-PT-018 (open-blocked-gate; raised harness audit/revision 2026-07-31): the per-commit workflow runs and is fail-closed internally, but the current private-repository GitHub plan does not offer branch protection/rulesets. The required merge-blocking target remains in policy; actual enforcement is parked in CF-HARNESS-CI/HB-P7 pending a plan change or ratified alternative.
- F-PT-019 (open; raised 2026-08-01 during the #202-#213 fix campaign): `secrets-or-auth` is operation-blind. It is a pure text rule over the projected effect fields, so a metadata-only query that never opens the file (`git check-ignore .env`, `git status --ignored -- .env.example`) matches exactly as a genuine contents read (`cat .env`) does. #204 shows the false-positive cost — a blocked promotion at 16/17 green, and an approval queue the human learns to rubber-stamp — while narrowing the rule would also loosen it for real exfiltration reads. Owner must decide whether the rule becomes operation-aware and, if so, which git subcommands count as contents reads. Pinned (not endorsed) in the CF-REG-204 spec.
- F-PT-020 (open; raised 2026-08-01 during the #202-#213 fix campaign): undecided approval ITEMS have no documented lifetime. `docs/approvals/design.md` specifies TTL, use-count and revocation for *grants* (post-decision) and is silent on a pending item whose raising turn has ended. In the august-org run all seven items outlived their turns, and because `app verify` treats any pending item as a promotion blocker, the queue grows monotonically under the scheduler until promotion is permanently blocked — and the human is forced to record meaningless denials purely as queue hygiene, which corrupts the decision ledger the approvals exist to produce. Resolving it means adding a terminal non-blocking state to the ratified approval state machine (CF-SM-APPR) and changing what `app verify` counts; adjacent to F-PT-008. Not implemented (#205 parked).

## Decisions on record
- Criticality/tiering was elicited teach-first at Phase 1 (no prior anchor); synthesis in system-map.md §5: base C2, function-scoped C3 control points T-1…T-12, C1 leaves, recovery as tier multiplier, compound worst case §5.5.
- M10 flagged for later deep pass; M13 (learning loop) broad-and-shallow this campaign with stakeholder-directed floor; M14 confidentiality slice mandatory.
- Unattended live-sandbox runnability (zero human approvals, sandbox orgs only, publishing/non-sandbox still hard-gated) is a first-class layer-3 requirement for the policy file.
- Release-gating replacement = campaign/policy obligation, proportionate; not a module.

## Decision register (owner: human; HB-007 review completed 2026-07-31; items 9–12 remain PROPOSED until first eval-campaign design review — per validation-policy.yaml `proposed_register`) <!-- AUD-104 -->
1. **ADJUSTED-RATIFIED:** B-01 GitHub retry budget: 3 total attempts per operation, jittered exponential backoff, injectable clock.
2. **ADJUSTED-RATIFIED:** B-07 liveness identity: PID + process-start identity + nonce, so PID reuse cannot impersonate a holder.
3. **ADJUSTED-RATIFIED:** B-07 descendant cleanup: owned process group/session; TERM, bounded grace, then KILL; prove no owned descendants remain.
4. **RATIFIED:** B-10 preview→execute exact-hash comparison on depended-on surfaces.
5. **RATIFIED:** B-15 index.lock bounded wait ≤ 30 s (never delete/steal a foreign lock).
6. **RATIFIED:** B-15 hooks-disabled managed clones (core.hooksPath empty).
7. **ADJUSTED-RATIFIED:** B-16 defaults are setup/tests 5 min, lint 2 min, e2e 10 min; 15 min is the CI core-job ceiling, not a per-gate default.
8. **RATIFIED:** B-16 candidate-mutation detection scope: candidate HEAD + tracked/decision-relevant diff + governed generated paths.
9. S-3 Reviewer threshold hypotheses ≥95%/≤10%/N≥3 (F-PT-009; **budgeting only — inconclusive-verdict rule until ratified**).
10. S-1 Planner hypothesis ≥85%/N≥3 (F-PT-010; same inconclusive rule).
11. S-2 repeat-loop signature N=3 (may assert only once ratified).
12. S-4 SRE hypothesis ≥80%/N≥3 (F-PT-010; same inconclusive rule).
13. **RATIFIED:** CI per-commit L1/L2 wall-clock target 5 min, report-only optimization target with no verdict effect.

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
  F-PT-009/010/011 (inconclusive-only rule stands). HB-007 items 1–8 and 13 were
  ratified/adjusted-ratified on 2026-07-31; only register items 9–12 remain PROPOSED.

## Pending confirmations
- **Active 2026-08-03 revision:** Phase 8 was accepted on 2026-08-03 as recorded at
  `ratification-package.md` §10.7. HB-100…HB-105 local offline implementation is
  complete; HB-106…111 remain. The proposed protocol-surface package
  remains separately approval-gated under HB-111.
- **Closed 2026-07-31 campaign:** none in-campaign. Audit iteration 2 CONFIRMED:
  verification pass clean,
  no new blocking findings; two residues fixed, compound-tag convention accepted
  as-is; historical "pending Phase 1 hard-stop" quotations in audit/log entries are
  trace preservation per stakeholder ruling, not unresolved residue. AUD-101…109
  remain closed.
- Human ratification COMPLETE (2026-07-31, section above). Current scope: design
  RATIFIED; Wave 0 implementation authorized; release gating remains SUSPENDED until
  the replacement qualification and the human-authored threat model exist.
- Remaining human decision points: F-PT-006 and F-PT-008 (undecided findings);
  F-PT-009/010/011 (eval thresholds, inconclusive-only until ratified);
  PROPOSED-register items 9–12 at first eval-campaign design review. HB-007 items
  1–8 and 13 are complete. The 2026-08-01 comparison revision additionally leaves
  S-8 calibration/thresholds under F-PT-011 and the exact implementation transport
  to its epic; neither is silently encoded as completed behavior.
