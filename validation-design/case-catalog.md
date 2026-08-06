# Case catalog — Cormidia (product scope, matrix closure)

Status: derived to matrix closure (Phase 6, agent-alone per Division of labor §6) over
the ratified baseline plus the owner-confirmed 2026-08-01 revision and the 2026-08-03
revision confirmed through Phase 7: system-map (J-01…J-20), invariants
(INV-001…016), boundary-map (B-01…B-22), contracts (29 canonical IDs),
llm-eval-plan (S-1…S-10), risk-allocation
(E-1/E-2/E-3, floors, §5/§6 obligations). **This remains the design-derived
catalog, while executable authoring is tracked by `harness-backlog.md`.** As of
2026-07-31, Waves 0–4 are implemented under `tests/`: through Wave 3 the
E-1/E-2/E-3 and evidence-agreement families are executable; Wave 4 adds the
CF-J02/CF-J03/CF-J10/CF-J16/CF-OPS-GROW/CF-IF/CF-S2-traj/CF-S9-env remainder.
The historical pre-revision L1/L2 count below is retained as its dated baseline, not a
current test count. J-19/B-18/B-19/S-8 remain design-only. HB-108 closes every
deterministic 2026-08-03 revision family through named L1/L2 evidence and a fail-closed
registry walk; HB-109 closes contention/soak machinery but not the unrun seven-day
campaign; HB-110 closes its cross-surface projection. Catalog closure does not imply
separately gated L3/L4 evidence. Current Reviewer, Planner, and Validation Designer
references were human-validated on 2026-08-04; future L5 evidence remains separate
from RQ-1.

**Closure rule:** every (source artifact × derivation row) cell below carries case
families or a **named prune**. Prune vocabulary (nothing else is legal):
- `PRUNE-thin` — deliberately thin per risk-allocation §4 (smoke only or none).
- `PRUNE-dup:<cell>` — covered by the named cell (single-writer rule; no clone).
- `PRUNE-na` — dimension structurally inapplicable to this source (reason inline).
- `BLOCKED:<finding>` — cases exist but are parked until the finding ratifies
  (current findings are named at their cells and in §9; F-PT-003/004/007 were
  ratified 2026-07-31 and their former blocked cells are derivable against the
  ratified contracts); listed, never authored as truth.
- `BLOCKED:B-17-L3` — live-target cases parked per boundary-map B-17 status.

**Row/oracle/layer keys.** Layer 1/2/3/4/5 per taxonomy; oracle kinds: `state` (durable
state assertion), `evid` (evidence/record assertion), `refusal` (typed refusal/exit
code), `diff` (byte/scope diff), `det` (detector fired), `stat` (statistical, §9
decision-status rule applies), `live` (live-run binary). Risk: E1/E2/E3 (exhaustive
families), STD, THIN, FLOOR (non-discretionary). **L4Q** is a formally
defined additional risk category: the statistical quality lane — funding priority per
risk-allocation §4, governed by the eval-plan §9 decision-status rule (no verdict may be
green until the owning finding ratifies). Adversity (crash/kill/sleep/partition)
is applied via the B-06/B-07/B-15 modifier rows inside each family — never a row here
(stimulus taxonomy).

Family IDs are stable: `CF-<source>-<row>`. Traces resolve per the
journey-acceptance.md alias table.

---

## 0. Harness self-test register (policy machinery outside the product-source matrices)

| Cell | Case family | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-HARNESS-CI | Per-commit workflow shape, fail-closed jobs, detector canaries, and actual merge-blocking enforcement. Workflow-shape checks are implemented; mechanical merge blocking is **KNOWN-LIMITATION:F-PT-018**, bounded for RQ-1 by protected human merge plus exact-tag rerun. | 1 + CI | evid+det | FLOOR |
| CF-HARNESS-REPORT | Durable completeness/verdict truth table; exact-ceiling, unknown-partial-spend, known over-reservation attempt/session/output/usage preservation with independent-case continuation, corrupt-report, canonical-policy/golden-blob binding, and presentation negative controls | 1/2 | evid+refusal+det | FLOOR |
| CF-HARNESS-RQ | RQ-1 manifest, deterministic-first admission, executed machine-readable test/skip inventory, mandatory launchd proof until a ratified negative-trigger baseline exists, aggregate completeness/verdict/qualification truth table, debt disposition, exact site/pairing scope | 1/2 | evid+refusal+det | E3/FLOOR |
| CF-HARNESS-CURRENCY | subject/producer digests, evidence-only descendant, isolated exact-candidate test execution with frozen offline dependency install/environment scrub, identical package/policy/prompt/assignment/golden inputs, invalidation triggers | 1/2 | diff+evid+refusal+det | E3/FLOOR |
| CF-HARNESS-ATTEST | canonical packet/attestation, path containment, packet hashes, exact release approval binding, tamper and missing-field refusal | 1/2 | evid+refusal+det | E1/E3/FLOOR |
| CF-HARNESS-JUDGE | pending-reference refusal, uncalibrated-score refusal, exact pairing identity, composite-hash grade reuse, low-calibration triage without threshold/corpus weakening | 1/2 | stat-envelope+refusal+det | E3/L4Q |
| CF-HARNESS-RELEASE | exact-tag offline rerun, current attestation, prepublish refusal, approval→tag→publish→ack separation, and exact equality among GitHub tag-push actor, `approval.approved_by`, and configured release approver; mechanical merge enforcement remains KNOWN-LIMITATION:F-PT-018 | 1/2 + CI | evid+refusal+det | E1/E3/FLOOR |

## 1. Journey matrix (J × success / refusal / interruption / recovery / alt-initiators+observations)

| Cell | Case family (what the cases assert) | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-J01-S | init/upgrade/use happy paths: complete org home, pointer, authority profiles per C-OP-LIFE §§1–3; first Cormidia resolution atomically relocates the retired default state root, repairs pointer/lifecycle/git-worktree paths, and converges on replay | 2 | state | STD |
| CF-J01-R | every named collision/refusal class (existing org, nested, symlink, non-dir, incomplete org for `use`, wrong `--confirm`, dual default state roots) refuses pre-mutation | 2 | refusal+diff | E1 (T-8 slice) |
| CF-J01-I | kill mid-init-staging / mid-upgrade-transaction at each journaled step | 2 | state+diff | E1 |
| CF-J01-RC | rerun after interruption converges; archived bytes restorable; ratified surfaces unreplaced | 2 | state | E1 |
| CF-J01-A | same op via packed vs source-backed launcher; removed-cwd guard | 2 | refusal | STD |
| CF-J02-S | bootstrap/new-app → registered; verify passes on healthy fixture; promote executes once | 2 | state+evid | STD |
| CF-J02-R | non-interactive bootstrap without answers refuses (audit row only); verify failure classes each named; promote refuses on failed verify | 2 | refusal | STD |
| CF-J02-I | kill during bootstrap writes / promote's config-commit-push-registry sequence | 2 | state | E1 (lifecycle journal) |
| CF-J02-RC | promote resumes exactly once across boundaries; bootstrap re-run idempotent | 2 | state | E1 |
| CF-J02-A | ladder claims per surface: no rung overclaim on CLI/JSON/observe (`generated≠registered≠runtime-ready≠live≠scheduled`) | 2 | evid | E3 |
| CF-J03-S | one bounded 100+ issue snapshot → accepted RoadmapPlan with exact accounting, stable workstream/delivery-unit IDs, dependencies/priority/WIP, validation status and bounded ready frontier; no delivery EpisodePlans for unadmitted units | 2 | state+evid | E3/STD (HB-101/HB-105; HB-108 closure complete) |
| CF-J03-R | C-OP-PLAN refusal classes: incomplete creator scope marked execution-ready, unknown op/role, unapproved tuple, missing source/page, duplicate/unaccounted issue, cycle, invalid validation/routing, stale plan, or label-without-artifact; deterministic failures occur pre-provider/effect | 1/2 | refusal | E1/E3/STD (HB-101/HB-105; HB-108 closure complete) |
| CF-J03-I | crash between RoadmapPlan validation/persistence/projection and between deterministic ticket publications; accepted predecessor stays readable, partial projection never becomes authority | 2 | state+evid | E2/E3 (HB-101/HB-105; HB-108 closure complete) |
| CF-J03-RC | prior-plan+bounded-delta replay preserves stable IDs/history, applies publication/projection markers idempotently, and never duplicates issues or replans unchanged regions | 2 | state+evid | E2/E3 (HB-101/HB-105; HB-108 closure complete) |
| CF-J03-A | provider-authored roadmap, complete structured zero-turn roadmap intake, creator-scope EpisodePlan normalization and dry-run preview preserve distinct schemas/turn counts; detailed prose or `planning:preplanned` without a valid artifact never bypasses planning | 1/2 | evid+refusal | E3/STD (HB-100/HB-105 plus pre-tuning Planner corpus; HB-108 closure complete, human references validated; F-PT-010 remains open) |
| CF-J04-S | one ready delivery unit with one-or-more tickets → atomic member claim → one EpisodePlan → build/gates → exactly one PR → independent exact-HEAD review → merge; every member projection follows shared artifacts | 2 | state+evid | E3 (HB-100/HB-103/HB-105; HB-108 closure complete) |
| CF-J04-R | any changed/human-only member, validation mismatch, gate-red, review REJECT, or exhausted third repair cycle returns/refuses the entire unit; no partial PR/merge/member closure | 2 | state+refusal | E1/E3 (HB-100/HB-103; HB-108 closure complete) |
| CF-J04-I | kill at every unit boundary (all-or-none claim, branch, evidence, PR, review, merge); no subset claim/closure. Recovery asserts plan authority order and the ratified F-PT-004 preserve-and-inspect rule | 2 | state | E2/E3 (HB-100/HB-103 crash detectors; HB-108 closure complete) |
| CF-J04-RC | any tick advances the independently authoritative unit from durable facts; pre-provider claim crash repairs without allowance, post-provider needs re-arm, and completed siblings/batch state cannot substitute for this unit | 2 | state+evid | E2/E3 (HB-100/HB-103/HB-104; HB-108 closure complete) |
| CF-J04-A | single-ticket and multi-ticket units, batched and unbatched entry, and manual projection edits converge on the same unit/PR/evidence contract without clobbering human-only routing | 2 | state+diff | E1/E3 (HB-103/HB-105; HB-108 closure complete) |
| CF-J05-S | gate block → item → approve → typed execution → executed w/ acknowledgement | 2 | state+evid | E1 |
| CF-J05-R | deny path; never-broadly-scopeable ops refuse scoped grants; unknown item refusal | 2 | refusal | E1 |
| CF-J05-I | kill between decision/continuation; between effect/acknowledgement (→ ambiguous, never re-perform) | 2 | state+evid | E1 |
| CF-J05-RC | idempotency-marker reconciliation converts crashed attempt correctly (typed markers: acceptance ≠ completion) | 2 | evid | E1 |
| CF-J05-A | queue via CLI + observe read-only view agree; approved never rendered executed | 2 | evid | E3 |
| CF-J06-S | approve and deny both resume same session/claim with guidance | 2 | state | E1/E2 |
| CF-J06-R | every fingerprint mismatch class (role, runtime, context, worktree, work) fails closed pre-spend | 2 | refusal | E1 |
| CF-J06-I | crash mid-resume; TTL expiry before resume (typed outcome; item disposition BLOCKED:F-PT-008) | 2 | state | E1 |
| CF-J06-RC | duplicate continuation attempt refused with original outcome preserved | 2 | state | E2 |
| CF-J06-A | PRUNE-na (single surface; queue observation covered CF-J05-A) | — | — | — |
| CF-J07-S | per-turn cap stop at adapter observation point (per capability-matrix semantics); 80% warning; 100% pause + item (documented path) | 2 | state+det | E2 |
| CF-J07-R | paused app (either source) cannot claim spend; manual `loop --once` also refused; single admission computation (structural) | 1/2 | refusal | E2 |
| CF-J07-I | tick death between overlay write and item creation — convergence per ratified F-PT-003 (2026-07-31): **pause holds; exactly one budget-exceeded item eventually** (cases derivable — HB-P1) | 2 | state | E2 |
| CF-J07-RC | cap-crossed turn's overshoot retained + settled; next-claim refusal | 2 | state | E2 |
| CF-J07-A | budget/status/report/observe render same paused truth; unknown usage never headroom | 2 | evid | E3 |
| CF-J08-S | every terminal outcome class settles exactly once, keyed (app, providerTurnId); estimates flagged | 2 | state | E2 |
| CF-J08-R | mechanical steps never settle as provider turns; duplicate settle attempt no-ops | 1/2 | state | E2 |
| CF-J08-I | kill between provider return and append (ENOSPC variant via B-15) | 2 | state | E2 |
| CF-J08-RC | `budget --reconcile` back-fills idempotently from surviving evidence; legacy (app, runId) rows readable | 2 | state | E2 |
| CF-J08-A | telemetry/report/budget readers agree; day-files never swept while re-settlement possible | 2 | evid | E3 |
| CF-J09-S | due arithmetic across schedule/event/cadence-override matrix; spawn decision durable pre-spawn | 2 | state | STD |
| CF-J09-R | every named non-admission reason produced on its trigger (full ratified vocabulary) | 2 | evid | E2 |
| CF-J09-I | the two asymmetric nightmares: spawn_failure vs post_spawn_bookkeeping_failure — distinct, no duplicate spawn | 2 | state | E2 |
| CF-J09-RC | double-fire tick race: at most one spawn per (app, role); loser named | 2 | state | E2 |
| CF-J09-A | manual `dispatch` = timer-fired dispatch (same behavior, two initiators) | 2 | state | STD |
| CF-J10-S | N-subscriber fan-out incl. across-tick under WIP; retirement only when all current marked/removed | 2 | state | STD |
| CF-J10-R | malformed/unknown-kind retained loudly; no_subscriber pending; channel-gated holds retirement | 2 | evid | STD |
| CF-J10-I | crash mid-fan-out (marks atomic; F-PT-005 semantics asserted); **producer-crash partial file: BLOCKED:F-PT-006** | 2 | state | STD |
| CF-J10-RC | subscriber add/remove while pending (F-PT-005 resolved semantics) | 2 | state | STD |
| CF-J10-A | PRUNE-na (single entry surface — file drop; GitHub-polled events covered CF-B01) | — | — | — |
| CF-J11-S | Support/Marketing/SRE runs end in internal artifacts; channel gating enforced | 2 | state | STD |
| CF-J11-R | publication attempt without exact-payload approval blocked (gate) | 2 | refusal | E1 |
| CF-J11-I | SRE: analysis-complete vs incident-filed distinct claims; crash between them | 2 | evid | E3 |
| CF-J11-RC | exactly one source-linked op:incident under retry | 2 | evid | E1 |
| CF-J11-A | drafts visible via observe without publication side effects | 2 | evid | THIN (render) |
| CF-J12-S | capture→episode→candidate→review→publish happy path on temp org-home git | 2 | state | STD |
| CF-J12-R | agent write to protected surface blocked (tamper gate); candidate placed to resolve → never resolves | 1/2 | refusal | E1 (T-10) |
| CF-J12-I | publisher crash mid-transaction → forward-complete or no-op by approval ID | 2 | state | E1 |
| CF-J12-RC | re-run completed transaction no-ops; rejection ledger suppresses re-publish | 2 | state | E1 |
| CF-J12-A | states rendered distinctly (candidate/published/authorized/active/validated) on learn/report surfaces | 2 | evid | E3 |
| CF-J13-* | PRUNE-dup:interruption+recovery rows of J-01…J-12, J-14…J-17 (J-13 is the recovery dimension itself, exercised per-journey; authority-order assertion appears in every RC family) | — | — | — |
| CF-J14-S | reset plan (default) mutates nothing; execute: archive→GitHub closes→registry→local clears in order (**execute-order clause BLOCKED:F-PT-012** — prose vs deliberate commit-point design) | 2 | state+diff | E1 (T-8) |
| CF-J14-R | refusal on active runs/locks/journals/pending approvals; --force only stale >10min; wrong --confirm | 2 | refusal | E1 |
| CF-J14-I | kill at each reset step; resumable from durable intent + archive | 2 | state | E1 |
| CF-J14-RC | resumed reset completes without re-destroying or duplicating GitHub closes | 2 | state+evid | E1 |
| CF-J14-A | sibling-app full-state diff bit-identical; human checkout untouched (authorized-destructive-set oracle) | 2 | diff | E1/FLOOR |
| CF-J15-S | snapshot/SSE/report render fixture truth; per-source freshness + health | 2 | evid | E3 |
| CF-J15-R | no-capability/wrong-token refused; traversal/symlink escapes refused; mutation routes absent (structural) | 2 | refusal | FLOOR (T-4) |
| CF-J15-I | observer killed/restarted mid-run: zero effect on runs; SSE cursor gap → resync | 2 | state | STD |
| CF-J15-RC | torn local reads rejected + source invalid + claims unknown | 2 | evid | E3 |
| CF-J15-A | CLI report vs /reports vs portable HTML agree on same fixture; portable file self-contained, no L3, CSP-restricted | 2 | evid | E3 (+THIN pixels) |
| CF-J16-S | install/status/uninstall preview+confirm lifecycle on faked host surface; definition content contract (absolute paths, no creds/env) | 2 | evid | STD |
| CF-J16-R | wrong identity refuses; foreign/drifted definition refuses overwrite; absent-uninstall typed no-op | 2 | refusal | STD |
| CF-J16-I | each unhealthy state distinctly named (present-not-loaded, wrong identity, duplicate/orphan, stale hash, no ticks) | 2 | evid | E3 |
| CF-J16-RC | PRUNE-dup:CF-J16-I (health = the recovery observation) |  |  |  |
| CF-J16-A | real launchd proof per risk-allocation §5 trigger (unique test definition → loaded identity + attributable tick → exact removal) | 3 | live | STD (bounded) |
| CF-J17-S | declared release: mechanism → fresh content-bound approval → at-most-once execution; RQ-1 package tags bind the evidence-only merge/attestation/human approval and reject pre-effect tamper; acceptance vs completion recorded separately | 2 | evid+refusal+det | E1/E3 (T-12) |
| CF-J17-R | no declared mechanism → ship gate fails; scoped-grant attempt refused | 2 | refusal | E1 |
| CF-J17-I | lost response / marker disagreement → ambiguous terminal | 2 | evid | E1 |
| CF-J17-RC | completion-marker converts crashed attempt; acceptance marker never does | 2 | evid | E1 |
| CF-J17-A | non-GitHub real round-trip: **BLOCKED:B-17-L3** | — | — | — |
| CF-J18-S | unattended composite on hermetic rig: full chain evidence at every reached link (fake timer × N ticks, scripted adapters/GitHub) | 2 | state+evid | E2/E3 |
| CF-J18-R | considered→named-non-admission or admitted (both halves of ratified J-18 criteria) | 2 | evid | E2 |
| CF-J18-I | typed non-green terminations (provider death, timeout, red gates, returned, drift, malformed verdict, ambiguity) each leave truthful morning state | 2 | evid | E3 |
| CF-J18-RC | multi-tick recovery across the composite (sleep window injected via fake clock) | 2 | state | E2 |
| CF-J18-A | **live unattended sandbox campaign** under test-mode profile: zero human decision rows, profile identity + sandbox target in evidence, publication blocked | 3 | live | E1/E2/E3 (≤$100 release campaign, amended 2026-07-31) |
| CF-J19-S | one frozen step intent + exact candidate assignments → isolated turns → operation-specific evidence → deterministic eligibility → one content-bound selection and materialization acknowledgement; each candidate and judge turn settles separately | 2 | state+evid+diff | E1/E2/E3 (design-only) |
| CF-J19-R | zero/duplicate/unapproved tuples, unavailable capabilities, unsafe repo, insufficient budget, all-ineligible candidates, and requested automatic judge selection while S-8 is inadmissible each produce a typed pre-effect refusal or explicit inconclusive result | 1/2 | refusal+evid | E1/E3 (design-only) |
| CF-J19-I | kill at candidate start/settlement/evidence collection/selection/materialization boundaries; no losing or unselected lane crosses into ordinary continuation | 2 | state+diff | E1/E2 (design-only) |
| CF-J19-RC | replay resumes only unsettled candidate work, never spends twice for a settled turn, preserves immutable evidence/selection, and completes or reports ambiguous materialization without choosing again | 2 | state+evid | E1/E2 (design-only) |
| CF-J19-A | EpisodePlan and standalone `cormidia compare` adapters produce the same comparison/result contract; standalone preview spends nothing and execution never mutates the active branch or performs orchestrator-owned GitHub effects | 2 | diff+evid | E1/E3 (design-only) |
| CF-J20-S | token-free admission selects a bounded same-app batch from exact roadmap-ready or complete direct-work authorities; hard routing/dependency/validation/WIP/budget constraints precede affinity; EpisodePlans are created lazily per admitted unit | 1/2 | state+evid | E1/E2/E3 (HB-104/HB-107 plus HB-109 contention; deterministic closure complete) |
| CF-J20-R | stale frontier, human-only member, cross-app/role/session mix, incomplete direct work, broadened effect grant, insufficient budget, duplicate/already-claimed unit, or affinity-over-hard-constraint each yields a typed pre-spend exclusion/refusal | 1/2 | refusal | E1/E2/E3 (HB-104/HB-106/HB-107 plus HB-109 stale/overlap/duplicate controls; deterministic closure complete) |
| CF-J20-I | kill before/after batch persistence, per-unit revalidation, lazy EpisodePlan persistence, claim and unit terminal; no eager plan, double claim/spend, sibling contamination, or repeated completed turn to recreate cache state | 2 | state+evid | E2/E3 (HB-104/HB-106/HB-107 crash slices plus HB-109 contention; deterministic closure complete) |
| CF-J20-RC | recovery preserves per-unit plan/claim/budget/evidence authority and emits one typed batch disposition per admitted unit; independent siblings may continue but never inherit failed work | 2 | state+evid | E2/E3 (HB-104/HB-107 plus HB-109 mixed-sibling settlement; deterministic closure complete) |
| CF-J20-A | roadmap-backed code units retain one-PR/Reviewer rules; complete direct operational units may omit RoadmapPlan but not EpisodePlan/effect policy. Five Reddit destinations + LinkedIn + Twitter remain seven exact approvals/acknowledgements; unknown replies become new units | 2 | state+evid+refusal | E1/E3 (HB-106 complete local authority/evidence/follow-up slice; B-17 live proof still blocked) |

## 2. State-machine matrix (machine × legal / illegal / replay / crash-point)

| Cell | Case family | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-SM-LOOP-L | every legal ticket transition (C-OP-LOOP §1) incl. returned/blocked/incident branches | 2 | state | E3 |
| CF-SM-LOOP-I | every illegal transition attempt (e.g. ready→merged, in-review w/o PR) refused/uncreatable | 2 | refusal | E3 |
| CF-SM-LOOP-R | replayed stimuli (same event/label seen twice) don't double-advance | 2 | state | E2 |
| CF-SM-LOOP-C | crash at each transition boundary | 2 | state | E2 (PRUNE-dup:CF-J04-I where identical) |
| CF-SM-APPR-L/I/R/C | approval item `pending→expired|approved|denied→executing→executed|failed|ambiguous`: legal set, expiry releases the raising claim without consuming a failure claim, illegal jumps (approved→executed w/o executing), decision replay/conflict is first-write-wins, crash sweep incl. orphan-grant intermediate (B-09a) | 2 | state | E1 |
| CF-SM-GRANT-L/I/R/C | grant lifecycle (once: minted→consumed; scoped: minted→n-uses→expired/revoked): cap+1 refused, post-revocation/expiry refused, replay of consumed once-grant refused, crash between use and audit row (**outside-worktree never-scopeable mapping BLOCKED:F-PT-014**) | 2 | state | E1 |
| CF-SM-PLAN-L/I/R/C | EpisodePlan versions forward-only: legal revisions, illegal backward/edit-in-place, replayed revision idempotent, crash mid-persist (torn plan never terminal) | 2 | state | E2 |
| CF-SM-LADDER-L/I | evidence ladder monotonic claims; no surface implies a higher rung (illegal = overclaim) | 2 | evid | E3 |
| CF-SM-LADDER-R/C | PRUNE-dup:CF-J02-I/RC (ladder transitions are lifecycle ops) | — | — | — |
| CF-SM-LEARN-L/I/R/C | learning states candidate→published→authorized→active(+validated orthogonal): every silent-promotion path unrepresentable; publish replay no-op; crash per CF-J12-I | 2 | state | E1 (T-10) |
| CF-SM-EVENT-L/I/R/C | event pending→per-role-marked→retired: retire-before-all-marks illegal; refire-on-marked illegal; crash between mark and retire; **partial-file legality BLOCKED:F-PT-006** | 2 | state | STD |
| CF-SM-TURN-L/I/R/C | productive turn journal path `assembling→running→collecting→done`: phases in order, productive-phase skip illegal (error terminals may end the current phase honestly), same-phase replay idempotent, real SIGKILL at every productive phase (recognized intermediates only) | 2 | state | E2 |
| CF-SM-COMP-L/I/R/C | comparison `planned→executing→evaluating→selected→materializing→completed`, with typed `evaluating→inconclusive|failed` terminals: legal transitions only; candidate-set/input/policy hashes immutable after spend starts; settled candidates and selection replay idempotently; crash sweep at every transition and materialization acknowledgement | 2 | state+evid | E1/E2/E3 (design-only) |
| CF-SM-ROADMAP-L/I/R/C | RoadmapPlan draft→validated→accepted→superseded lifecycle: only schema/graph/complete-accounting-valid versions become authority; predecessor/hash immutable; replay idempotent; crash leaves the accepted predecessor authoritative | 1/2 | state+refusal | E2/E3 (HB-101/HB-105; HB-108 closure complete) |
| CF-SM-VALIDATION-L/I/R/C | validation proposal→validated→accepted→superseded lifecycle with explicit bounded waiver variant: unknown IDs/structural mismatch/forbidden waiver illegal; replay content-bound; crash never turns omission into acceptance | 1/2 | state+refusal | E1/E3 (HB-102; HB-108 closure complete) |
| CF-SM-BATCH-L/I/R/C | batch admitted→running→complete with independent per-unit dispositions: no complete before every disposition, duplicate unit/claim illegal, replay terminal-safe, and crash resumes units from their own journals | 2 | state+evid | E2/E3 (HB-104/HB-107/HB-109; deterministic machinery complete) |

## 3. Invariant matrix (INV × violation-paths / guardrail-response)

Seed adversarial cases are ratified in invariants.md; each row's family = those seeds
plus the guardrail's negative control (skill rule 16 — the detector proves it can fire).

| Cell | Family (violation paths → guardrail response) | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-INV-001 | 4 ratified seeds (widening config, injected memory/prompt authority, label/approval-as-authority, learning-path toolset change) → refuse/stop | 1/2 | refusal+det | FLOOR |
| CF-INV-002 | obfuscated deploy (heredoc/base64/nested shell); unknown tool type fail-closed; direct API mutation; Codex read-bypass generalized to write; **forbidden read via hook bridge** (git-push-to-default leg **BLOCKED:F-PT-013**) | 1/2 (+3 per §5 triggers) | refusal+det | E1 |
| CF-INV-003 | no-prior-decision execution; once-grant replay; changed-bytes-under-old-approval; scoped out-of-scope/expiry/cap+1/no-audit; ack-crash never re-performs | 2 | state+refusal | E1 (HB-106 seven exact approval/acknowledgement identities and broadened-grant detector) |
| CF-INV-004 | cross-app event routing, sibling memory pull, cross-app approval consumption, reset-observed-from-sibling — every facet-mismatch stops | 1/2 | refusal | E2/FLOOR (HB-107 exact-app session detector slice) |
| CF-INV-005 | two-tick claim race; label-flip/claim-persist kill windows; pause/resume claim identity; re-arm-without-transaction refused | 2 | state | E2 |
| CF-INV-006 | kill-before-append + reconcile; double-settle attempt; usage-absent → unknown; blocked turn settles | 2 | state | E2 (HB-107 prepared/settled crash recovery and cache-unknown slice) |
| CF-INV-007 | registry-pause + tick; overlay-pause + manual loop; mid-turn cap vs next-claim; divergent-admission structural check | 1/2 | refusal+state | E2 |
| CF-INV-008 | label-without-artifact sweep across all readers; GitHub-unavailable ≠ empty; usage-unknown ≠ $0; definition ≠ health; contradiction surfaces not compressed | 2 | evid | E3 (HB-106 exact effect evidence projection; HB-107 cache unknown distinct from miss) |
| CF-INV-009 | post-APPROVE push → refuse (HEAD equality); guessed-base attempt; HMAC bytes bound to wrong commit; agent-identity merge attempt | 2 | refusal | E3 |
| CF-INV-010 | sibling-diff under reset; archive-write failure → no destruction; --force against fresh heartbeat/pending approval; wrong-remote guard | 2 | diff+refusal | E1/FLOOR |
| CF-INV-011 | seeded synthetic secrets → published issue / portable HTML / narrative / SSE / ticket body all clean; single-pattern-source structural check | 1/2 | evid+det | FLOOR |
| CF-INV-012 | APPROVE-prose w/o marker; "tests passed" w/o run; resolvable candidate; self-report in promotion metrics | 1/2 | refusal | E3/E1 |
| CF-INV-013 | kill mid-append/mid-rename/mid-journal per store class; truncated JSON rejected; quarantined bytes never valid state | 2 | state | E2 |
| CF-INV-014 | WIP-limited named reason; sweep-without-marks refused; spawn-failure post-decision; post-spawn bookkeeping failure named | 2 | evid | E2 |
| CF-INV-015 | error-branch sweep: corrupt HMAC key, missing charter, classifier throw, unreadable budget → each yields *less* capability, never more/greener (cross-family negative-control harness) | 1/2 | refusal | FLOOR |
| CF-INV-016 | membership/validation/evidence lineage swaps across roadmap revisions, delivery units, PR HEADs, batches and role sessions are refused; a seeded shortcut makes an otherwise-green batch reuse sibling/Builder evidence and the detector must turn red | 1/2 | refusal+evid+det | E1/E2/E3/FLOOR (HB-100/HB-102/HB-103/HB-104/HB-107; HB-108 registry closure and HB-109 sibling contention complete) |

## 4. Boundary matrix (B × success / timeout / partial-success / retry / duplicate / stale-read / version-skew)

<!-- changelog 2026-07-31 (reader test, new-engineer finding 4): collapsing
convention stated here, matching §5's. -->
**Row-collapsing convention (same as §5):** one family row per boundary stands for
its seven nominal failure-mode columns — the family text enumerates the modes;
separately-risky dimensions (the `-L3` live obligations) get their own rows. The §9
closure statement reconciles the 161 semantic cells against these families.
Failure-mode lists are ratified per boundary in boundary-map.md; each cell's family =
those modes under the honest fake, plus the fake/real conformance pair where an L3
obligation exists.

| Cell | Family | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-B01-{ok,to,ps,rt,dup,stale,skew} | scripted GitHub double: success ops; timeouts/rate limits; partial success (issue-no-label, merge-no-branch-delete); ratified 3-total-attempt jittered exponential retry (injected clock) for reads/idempotent exact-input operations, while ambiguous writes remain single-shot for marker reconciliation; duplicate-create detection; stale-read-after-write re-read; default-branch-moved + force-push skew. Lost-response mode in `ps`+`rt` | 2 | state+evid | E3 |
| CF-B01-L3 | **the GitHub live smoke** (risk-allocation §5 trigger: merge/review/branch/auth changes): real auth, squash-merge + branch-protection semantics, HMAC review submission, poll truth — on sandbox repos, spend-bounded | 3 | live | E3 |
| CF-B02-* | adapter core against scripted Anthropic: outcomes, tool-events w/o terminal, malformed verdicts, usage absent/partial, resume-mismatch typed, partial stream; app-resolved safe permissionMode reaches SDK options and cannot be overwritten by base options | 2 | state | E1/E2 (T-11 exhaustive) |
| CF-B03-* | B-02 set + subprocess death mid-RPC, protocol skew, rotation events (checkpoint preserved; resume-exact-or-honest-stop), stale capabilities; forbidden-read + forbidden-write denial (hook bridge); app-resolved safe mode agrees across CLI args and App Server thread/turn requests | 2 | state | E1/E2 |
| CF-B03-L3 | **Codex real-adapter conformance run** incl. real forbidden-read + forbidden-write denial (§5 trigger + bounds) | 3 | live | E1/E2 |
| CF-B04-* | B-02 set + extension absent → terminal pre-tool failure; injected forbidden attempt reaches gate and is denied | 2 | refusal | E1 |
| CF-B04-L3 | **pi real-adapter conformance run**: real extension installation + real denied forbidden attempt (§5 trigger + bounds) | 3 | live | E1 |
| CF-B05-* | faked host surface: install/uninstall idempotency + refusals, status joins; unfakeable load-and-fire = CF-J16-A (L3) | 2 | evid | STD |
| CF-B06-* | fake-clock sweep: TTL, heartbeat 30s/2min/10min semantics, UTC windows vs host-time scheduling, missed-window (app,role,trigger,window) reconciliation, rollback/NTP/DST/timezone anomalies fail closed | 2 | state | E2 |
| CF-B07-* | kill-point injection harness; PID-reuse liveness; full journal↔lock PID/start/nonce binding before signal; nonce-bound serialized release refuses a late holder and cannot remove its successor; unknown/mismatched ownership refuses kill; signal-vs-terminal-write race; orphaned descendant cleanup; dead-child-fresh-heartbeat | 2 | state | E2 |
| CF-B08-* | PRUNE-dup:CF-J09-* (tick↔turn cells are exactly the J-09 families) | — | — | — |
| CF-B09a-* | continuation set persisted/validated; TTL expiry typed (**item disposition BLOCKED:F-PT-008**); orphan-grant intermediate recognizable, never usable authorization | 2 | state | E1 |
| CF-B09b-* | decision-entry: one-by-one + reason + attributable identity, non-TTY review refuses in favor of exact-confirmation `decide`, batch same-rule per-item audit, widening and NEVER_SCOPEABLE_RULES decisions human-only, revocation, concurrent decisions first-write-wins; unattended-profile prohibition cases (no forged human decisions; zero-decision evidence) | 2 | state+evid | E1 |
| CF-B10-* | fixture org-home sweep: invalid YAML, schema skew, missing AUTHORITY→legacy-conservative, mid-edit torn read, widening-narrowing refusal, preview→execute drift refusal; app execution defaults/overrides, bypass-mode and non-monotonic-limit refusal, cross-app isolation and effective-evidence persistence; B-10a identity sweep (stale pointer, override disagreement, symlinked home, mismatched state-home, retired-root relocation/replay, dual-root refusal); product-identity/package-path sweep with exact migration and external-repository exceptions | 1/2 | refusal | E1/E2/FLOOR |
| CF-B11-* | PRUNE-dup:CF-J12-* + CF-SM-LEARN-* (publisher boundary fully covered there) | — | — | — |
| CF-B12-* | reader seam: torn reads, stale-as-current refused, capability/traversal (CF-J15-R), SSE gaps, per-source health; conformance CLI/HTML/observe agreement (CF-J15-A) | 2 | evid | E3 |
| CF-B13-* | inbox sweep incl. duplicate-identity-different-payload (**BLOCKED:F-PT-006**), retention interplay, F-PT-005 add/remove semantics | 2 | state | STD |
| CF-B14-* | temp-checkout interference: dirty accept (ordinary), publish-only refusals, marked-block idempotency, byte preservation, foreign-link refusal, symlink/wrong-remote/path-overlap, retired app-artifact root refusal; **concurrent-edit outcome per ratified F-PT-007 (2026-07-31): compare-and-refuse, preserving human bytes** (cases derivable — HB-P4); re-run semantics **BLOCKED:F-PT-015**; publish-origin comparison **BLOCKED:F-PT-016** | 2 | diff+refusal | E1 |
| CF-B15-* | FS faults (full/read-only/perm/torn/ENOSPC) per store class; git faults (index.lock bounded wait, corrupt refs → re-clone, remote-changed identity stop, hooks-disabled, partial-command post-verify). Worktree-content preservation asserted up to the accepted-artifact line; **ambiguous-byte disposition per ratified F-PT-004 (2026-07-31): preserve-and-inspect, never reset** (cases derivable — HB-P2) | 2 | state+refusal | E2 |
| CF-B16-* | scripted gate commands: hang→timeout-kill, flood→ratified truncation bounds (256KiB/50 lines; 8k PR; 2k tail), missing tool typed, exit-0-lying (evidence binds to candidate SHA), candidate-mutation detection within governed scope, pending-fails-closed (bare template) | 2 | evid+refusal | E3 |
| CF-B17-* | scripted external target: accept-vs-complete split, lost response, marker disagreement, target-auth failure (grant consumed, evidence in audit), at-most-once; real round-trip **BLOCKED:B-17-L3** | 2 | evid | E1 |
| CF-B18-* | scripted candidate-lane boundary: identical frozen input/base/authority; exact tuple identity; unavailable capability and spend refusal; partial/timeout/duplicate settlement; workspace mutation containment; stale evidence rejected; version skew named; no candidate outward effects | 1/2 | state+diff+refusal | E1/E2/E3 (design-only) |
| CF-B19-* | scripted selection/materialization boundary: eligible set and policy hash binding; deterministic precedence over judge; stable tie-break; no-selection/inconclusive path; duplicate/retry idempotency; stale base/evidence refusal; exactly one winner namespace crosses and only to the declared continuation target | 1/2 | state+evid+diff | E1/E3 (design-only) |
| CF-B20-* | 100+ issue and delta fixtures across success/timeout/partial projection/retry/duplicate/stale/version-skew: complete accounting, stable IDs, exact frontier hash, current routing/dependency/validation/WIP reread, no per-issue provider turn/eager EpisodePlan, labels never authority | 1/2 | state+evid+refusal | E1/E2/E3 (HB-101/HB-105; HB-108 deterministic closure complete) |
| CF-B21-* | validation-contract fixtures across success/provider timeout/partial evidence/retry/duplicate/stale HEAD/version skew: ID resolution, bounded waivers, shared-boundary coverage, detector+negative control, exact unit/plan/HEAD binding and Reviewer independence | 1/2 | state+evid+refusal+det | E1/E3 (HB-102/HB-108 complete; human S-10 references validated; F-PT-011 remains open) |
| CF-B22-* | batch/unit-set permutations across success/timeout/partial unit failure/retry/duplicate/stale frontier/version skew: token-free admission, lazy plans, atomic claims, budget conservation, session-role isolation, per-unit terminals and cache unknown/hit/miss evidence | 1/2 | state+evid+refusal | E1/E2/E3 (HB-103/HB-104/HB-107 plus HB-109 contention machinery complete; seven-day evidence pending) |

## 5. Contract matrix (C × valid/invalid inputs / outputs / typed errors / idempotency / ordering / freshness+latency)

Each contract file's five parts generate the row set mechanically; the family asserts
every clause of the ratified contract text. Cells collapsed per contract (one family
spanning the six rows) except where a dimension is separately risky.

| Cell | Family | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-C-CORE | CORMIDIA-C-CORE-001 all clauses: TurnRequest validity/refusals, envelope guarantees (**terminal-status enum clause BLOCKED:F-PT-017**), usage-as-provided-or-unknown, typed errors, never-auto-retry, budget observation at capability-matrix points, settlement | 1/2 | state+refusal | E2 (T-11) |
Twenty-three boundary-contract families (B-09a and B-09b are separate contracts), one per
canonical `CORMIDIA-C-B*-001` ID, each clause-complete (valid/invalid inputs, outputs,
typed errors, idempotency, ordering, freshness/latency). HB-007 items 1–8 and 13 are
asserted as ratified bounds/mechanisms; active PROPOSED items 9–12 remain provisional.
**Per-ID resolver:**

| Cell | Layer set | Risk | Live/ops dup | Blocked remainder |
|---|---|---|---|---|
| CF-C-B01 | 1/2 + 3 | E3 | dup: CF-B01-L3 | — |
| CF-C-B02 | 1/2 + 3 | E2 | dup: CF-B02-L3 | — |
| CF-C-B03 | 1/2 + 3 + 5 (rotation) | E1/E2 | dup: CF-B03-L3; dup: CF-OPS-ROT (L5 rotation) | — |
| CF-C-B04 | 1/2 + 3 | E1 | dup: CF-B04-L3 | — |
| CF-C-B05 | 1/2 + 3 (launchd lifecycle proof) | STD (health claims E3) | dup: CF-J16-A | — |
| CF-C-B06 | 2 + 5 (real elapsed time) | E2 | dup: CF-OPS-SOAK | — |
| CF-C-B07 | 2 + 5 (sleep/wake) | E2 | dup: CF-OPS-SOAK | — |
| CF-C-B08 | 2 | E2 | — | — |
| CF-C-B09A | 2 | E1 | — | BLOCKED:F-PT-008 (expiry disposition clause) |
| CF-C-B09B | 2 + 3 (unattended profile) | E1 | dup: CF-J18-A | — |
| CF-C-B10 | 1/2 | E1/FLOOR | — | — |
| CF-C-B11 | 1/2 | E1 (T-10) | — | — |
| CF-C-B12 | 2 | E3/FLOOR (T-4 slice) | — | — |
| CF-C-B13 | 2 | STD | — | BLOCKED:F-PT-006 (producer protocol + dup-identity clauses) |
| CF-C-B14 | 2 | E1 | — | — (F-PT-007 ratified 2026-07-31; concurrent-edit clause derivable — HB-P4) |
| CF-C-B15 | 2 | E2 | — | — (F-PT-004 ratified 2026-07-31; ambiguous-byte clause derivable — HB-P2) |
| CF-C-B16 | 2 | E3 | — | — |
| CF-C-B17 | 2 | E1 (T-12) | — | BLOCKED:B-17-L3 (live round-trip) |
| CF-C-B18 | 1/2 | E1/E2/E3 | — | — (design-only; implementation pending) |
| CF-C-B19 | 1/2 | E1/E3 | — | — (design-only; S-8 automatic-selection clause remains inadmissible under F-PT-011) |
| CF-C-B20 | 1/2 | E1/E2/E3 | — | — (HB-101/HB-105 implementation plus HB-108 catalog/detector closure complete) |
| CF-C-B21 | 1/2 | E1/E3 | — | — (HB-102/HB-105 implementation plus HB-108 catalog/detector closure complete; S-10 human references validated; F-PT-011 remains open) |
| CF-C-B22 | 1/2 + 5 repeat trigger | E1/E2/E3 | dup: CF-OPS-CONT/CF-OPS-SOAK when trigger applies | — (HB-103/HB-104/HB-107 implementation plus HB-109 contention machinery complete; seven-day evidence pending) |
| CF-C-OPLIFE | C-OP-LIFE §§1–6 + error split (precondition-refusal vs journaled-intermediate) | 2 | state+refusal | E1 (T-8 slices) |
| CF-C-OPPLAN | C-OP-PLAN §§1–5 (bypass conditions, plan production, previews, boot boundary, sources fail-closed) | 1/2 | refusal+state | STD (HB-107 shared-façade wiring slice; validator depth per risk-allocation §3) |
| CF-C-OPLOOP | C-OP-LOOP §§1–5 (vocabulary, claims, 3-cycle bound + fourth-cycle return, review/merge, parallelism) | 2 | state | E3 (HB-107 shared delivery-façade wiring slice) |
| CF-C-OPVALIDATION | C-OP-VALIDATION §§1–5: timed authorship, strict shape/ID/waiver admission, exact Builder evidence, independent Reviewer closure, proportional fast path | 1/2 | state+refusal+evid+det | E1/E3 (HB-102/HB-105 implementation plus HB-108 complete deterministic registry/detector walk; S-10 human references validated; F-PT-011 remains open) |
| CF-C-OPBATCH | C-OP-BATCH §§1–5: execution-unit union, hard-before-affinity grouping, lazy plans, direct effects, context/session isolation, per-unit recovery/completion | 1/2 | state+refusal+evid | E1/E2/E3 (HB-104/HB-106/HB-107 implementation plus HB-109 overlap/duplicate/atomic-claim/per-unit/sibling/stale-frontier machinery complete; seven-day evidence pending) |
| CF-C-ACCEPT | journey-acceptance criteria as executable checks — PRUNE-dup: each criterion's cell in §1 (traces already resolve) | — | — | — |

## 6. Interface-adapter matrix (adapter × conformance / error-translation / cross-surface agreement)

| Cell | Family | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-IF-CLI | per-subcommand adapter conformance: parsing, exit codes, `--json` failure document (ok:false, stable error.code/message/remediation, no stderr prose prepend), dry-run token/write claims (audit-row exception), `--confirm` semantics | 2 | refusal+evid | E3 (claims) / THIN (help text) |
| CF-IF-JSON | schema stability + canonical key-sorting where claimed; no-active-org → `no_active_org` | 2 | evid | STD |
| CF-IF-UI | Live UI shell conformance: PRUNE-thin for pixels; confidentiality/truth slices covered CF-J15-* (not thin) | 2 | evid | THIN/E3 |
| CF-IF-HTML | portable report conformance: self-contained, CSP, no external requests, no L3 | 2 | evid | E3 |
| CF-IF-SKILL | `$cormidia` skill + capabilities/context discovery accuracy vs actual CLI surface; self-hosting and human-approved-release agreement across PURPOSE, developer policy, root instructions, and packaged skill | 2 | evid | STD |
| CF-IF-COMPARE | standalone `cormidia compare` parsing, preview/confirm hash, exact tuple preservation, safe repo preconditions, terminal/JSON result schema, external state root, and explicit local-branch materialization; no org or GitHub required | 1/2 | refusal+evid+diff | E1/E3 (design-only) |
| CF-IF-XSURF | one cross-surface agreement check: same fixture truth via CLI text, `--json`, observe snapshot, portable HTML (extends CF-J15-A to non-report ops), plus EpisodePlan/standalone comparison-result agreement for J-19 | 2 | evid | E3 (HB-110 RoadmapPlan/validation/unit/batch slice complete; J-19 slice design-only) |

## 7. LLM call-site matrix (S × deterministic-envelope / statistical-quality / trajectory / judge-calibration)

| Cell | Family | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-S1-env | C-OP-PLAN validator envelope (PRUNE-dup:CF-C-OPPLAN) + malformed RoadmapPlan/EpisodePlan handling, 100-issue/delta/eager-plan trajectory assertions and format-repair budget | 1/2 | refusal+evid | E3/STD (HB-101/HB-108 deterministic envelope and pre-tuning corpus integration complete) |
| CF-S1-qual | planner golden set per scaffold (S-1a/S-1b axes incl. proportionality) — **inconclusive-only until F-PT-010**; output-token accounting ratified by F-PT-022 | 4 | stat | L4Q |
| CF-S1-traj/judge | PRUNE-na (planner is not agentic-looping here; no judge) | — | — | — |
| CF-S2-env | builder envelope: guardrail set (authority/boundary/gates/artifacts/spend) — PRUNE-dup:CF-INV-001/002/004/006 + CF-B16 | — | — | — |
| CF-S2-traj | ratified-grounds assertions (enforcement-fired, five anomaly detectors, escalation, paid-work preservation) + observed metrics; repeat-loop N=3 provisional | 2 | det | E2 |
| CF-S2-qual | builder-quality scaffold — deferred, **F-PT-011**; PRUNE-thin until ratified+funded | 4 | stat | L4Q (deferred/THIN) |
| CF-S2-judge | PRUNE-na | — | — | — |
| CF-S3-env | verdict marker/parser/HEAD-binding — PRUNE-dup:CF-INV-009/012 clause families | — | — | — |
| CF-S3-qual+judge | reviewer meta-eval per scaffold: seeded classes × severities + clean controls, per-pairing, **inconclusive-only until F-PT-009**; output-token accounting ratified by F-PT-022 | 4 | stat | L4Q (first-funded) |
| CF-S3-traj | PRUNE-na (single-pass judge; trajectory covered by S-2) | — | — | — |
| CF-S4-env | analysis/filing claim separation — PRUNE-dup:CF-J11-I/RC | — | — | — |
| CF-S4-qual | SRE golden set (gamma-class fixtures) — **inconclusive-only until F-PT-010** | 4 | stat | L4Q |
| CF-S4-traj/judge | PRUNE-na (single-pass analyzer; no judge) | — | — | — |
| CF-S5-env | draft-only + publication gate — PRUNE-dup:CF-J11-R + CF-INV-011 | — | — | — |
| CF-S5-qual | three separate rubric sets — deferred, **F-PT-011** | 4 | stat | L4Q (deferred/THIN) |
| CF-S5-traj/judge | PRUNE-na (drafters/analyzers; no agentic loop, no judge) | — | — | — |
| CF-S6-env | provenance/secret/write-path — PRUNE-dup:CF-J12-R + CF-INV-011 | — | — | — |
| CF-S6-qual | distiller set — deferred, **F-PT-011** | 4 | stat | L4Q (deferred/THIN) |
| CF-S6-traj/judge | PRUNE-na (single-pass synthesizer; no judge) | — | — | — |
| CF-S7-env | fail-closed verdict persistence — PRUNE-dup:CF-J12 families | — | — | — |
| CF-S7-judge+qual | learning-reviewer calibration set (5 seeded classes) — **F-PT-011; scores inadmissible until calibrated+ratified** | 4 | stat | L4Q |
| CF-S7-traj | PRUNE-na (single-pass judge) | — | — | — |
| CF-S8-env | selection-judge envelope: blinded stable candidate IDs; identical operation rubric and deterministic evidence; complete eligible set only; schema-valid ranking/confidence/reasons; malformed output cannot select a winner | 1/2 | refusal+evid | E3 (design-only) |
| CF-S8-qual+judge | per-operation selection meta-eval with human pairwise/ranking references, eligibility traps, swapped-order controls, ties, and abstentions — **inconclusive-only and scores inadmissible for automatic selection until F-PT-011 ratifies calibration/thresholds** | 4 | stat | L4Q (design-only/deferred) |
| CF-S8-traj | PRUNE-na (single-pass judge; candidate trajectories belong to their emitting call sites) | — | — | — |
| CF-S9-env | format-repair: same-session, bounded attempts, settlement — contract-only | 2 | state | STD |
| CF-S9-qual/traj/judge | PRUNE-na (contract-only site by ratified decision) | — | — | — |
| CF-S10-env | strict C-OP-VALIDATION/B-21 envelope: exact unit/roadmap refs, resolvable IDs, cheapest layers, failure cases, detector+negative control, evidence, bounded waivers and structural-revision routing | 1/2 | refusal+evid+det | E1/E3 (HB-102 implementation plus HB-108 complete deterministic registry/detector walk) |
| CF-S10-qual | Validation Designer golden set per scaffold: routine template, cross-ticket seam, C3/architecture change, malformed-ID lure, over-testing/live-lure and L3/L4 detector deposit — **inconclusive-only under F-PT-011**; output-token accounting ratified by F-PT-022 | 4 | stat | L4Q (pre-tuning corpus integrated and human-validated; threshold-dependent results remain inconclusive) |
| CF-S10-traj/judge | PRUNE-na (bounded design capability, not an agentic loop or judge; compatible units may share input/session but emit separate contracts) | — | — | — |
| CF-COND | brief-conditioning study (informs, never gates) — sampling design OPEN under F-PT-011 | 4 | stat (non-gating) | THIN |

## 8. Operational-obligation matrix (future L5 assurance outside RQ-1)

These L5 rows keep their original owners, collectors, triggers, and ceiling. They do
not enter RQ-1 completeness, verdict, qualification, manifest campaigns, or cost
ceilings. Missing work remains visible and never pass.

| Cell | Family | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-OPS-CONT | ratified contention exercise: ≥10 due candidates, ≥3 apps, duplicate (app,role) stimuli, simultaneous terminal settlement; six baseline proof obligations. A material execution-batch/unit-claim change repeats it with overlapping batches, atomic multi-ticket claims and per-unit settlement/terminal isolation. **Layer 5** — the question is "can load/contention hurt Cormidia"; the rig being hermetic describes the implementation, not the layer | 5 (hermetic rig, deterministic oracle) | state | E2 |
| CF-OPS-SOAK | 7-day sandbox soak per risk-allocation §6 (inspection list; $15 ceiling; completeness/verdict split); material batching/session-reuse changes add batch progress, per-unit settlement, stale-frontier and cache-evidence inspection without creating a new campaign type | 5 | live+evid | E2/E3 |
| CF-OPS-ROT | **Codex natural multi-hour auth-rotation under a long live run** (ratified L5 obligation, boundary-map B-03 / contract B-03): embedded in the 7-day soak as a named sub-obligation with **its own completion evidence** — at least one live Codex session spanning a real rotation window, with checkpoint/session-identity preservation asserted; if no natural rotation occurs during the soak, the sub-obligation reports completeness=incomplete (never assumed covered) | 5 | live+evid | E2 |
| CF-OPS-GROW | seeded aged-state retention sweep at 30/180/365-day boundaries under controlled clock; ledger-day-file protection rule | 2 | state | E2 |
| CF-OPS-SKEW | PRUNE-dup:CF-B06-* (clock anomalies) + soak's real sleep cycles | — | — | — |
| CF-OPS-ABUSE | threat-model-driven abuse cases: deferred until the human-authored and reviewed threat model exists (risk-allocation §6); interim floor = CF-INV-001/002/011/015 adversarial families | 5 | mixed | E1 (future lane, declared) |
| CF-OPS-REC | PRUNE-dup:§1 interruption/recovery rows + CF-B07 (recovery is a modifier everywhere, not a lane) | — | — | — |
| CF-OPS-COMP | PRUNE-na for V1 (explicit tuples, sequential execution, hard per-comparison ceilings are falsifiable at L1/L2); automatic sampling or parallel candidates must re-enter allocation and may create a bounded L5 contention/cost obligation | — | — | — |

---

## 9. Closure statement

### 9.1 Triggered-lane implementation/evidence ledger (2026-07-31)

This ledger distinguishes executable machinery from external/human evidence; it does
not change matrix allocation or unblock any finding.

| Family | Implementation | Evidence status / executable path |
| --- | --- | --- |
| CF-B02-L3 / CF-B03-L3 / CF-B04-L3 | Complete; failed external evidence preserved | Authorized candidate `ec60cd33` campaign `cormidia-maintenance-l3-ec60cd33e7c7` collected all three real-pair cases but failed on the Codex `exec` gate bypass (#271; report SHA-256 `709739891a8baf05a9cd2a48666ad8bd8c0b36bf19462e060ea3fbccb7bfbc48`). Candidate `88ef60f1` later collected all six required L3 cases and proved Codex/pi gate denial, but the shared second-turn prompt asked Claude to perform an explicitly forbidden parent-directory write; Claude refused before emitting a tool action and the harness classified the unobserved resume gate path as a product violation (#297; report SHA-256 `0f7ba7227cd6f067d9fac004ea024e76e7cef1573bdc53c8156e9598f01b4de1`). Both reports are preserved and have no qualification value for a successor candidate. |
| CF-B01-L3 | Complete; failed/inconclusive external evidence preserved | The authorized `ec60cd33` campaign collected 13/15 real-GitHub clauses; B01-CF-02 and B01-CF-08 failed (#273/#272). Candidate `bcce9300` later collected 14/15 but incorrectly classified a bounded B01-CF-02 observation gap as a product violation (#291; report SHA-256 `77a5ffd60b1f29b5ca3365c85a3896abe633e9636aeca1b3f84bdd1a7c6e2976`). Candidate `9ad3170c` proved the corrected incomplete/inconclusive semantics but repeated the gap under the same three one-second-spaced observations (#293; report SHA-256 `c3cfbc45d447e5fcf05a9d999436670dc894152286685c067332c209dfa94d02`). All reports are preserved and have no qualification value for a successor candidate. |
| CF-J16-A | Complete | Real launchd install/readback/attributable-tick/scoped-removal case implemented; no host campaign run. RQ-1 requires it in every release campaign until a separately ratified, content-bound trigger baseline can prove the policy condition absent. |
| CF-J18-A | Complete | `src/org/validation-test-mode.ts` + L3 case; no unattended campaign run. |
| CF-S1-qual | Runner + cases complete | Planner cases human-validated; threshold F-PT-010 open, so any run is inconclusive. |
| CF-S3-qual+judge | Runner + cases complete | Seeded reviewer/clean cases human-validated; F-PT-009 open, so any run is inconclusive and judge scores remain inadmissible. |
| CF-S2-traj | Complete | Deterministic trajectory scenarios committed; repeat-loop N=3 remains proposed only. |
| CF-OPS-CONT | Complete | `tests/ops/contention-rig.ts`; ratified ≥10/≥3/WIP=2 shape green in hermetic self-test. |
| CF-OPS-SOAK / CF-OPS-ROT | Collector complete; future assurance | `tests/ops/soak-protocol.ts`; real seven-day/sleep/rotation evidence pending human scheduling and outside RQ-1. |
| CF-OPS-ABUSE | Gate only; future blocked | `tests/ops/threat-model-gate.ts` refuses the checked-in `awaiting_human_author` status. No abuse cases before HB-072; neither row is inside RQ-1. |
| CF-HARNESS-REPORT | Complete | Durable reports debit unknown failed-case spend conservatively, keep exact-ceiling coverage incomplete, bind canonical policy/golden inputs to authorized HEAD, and surface corrupt/inconclusive evidence without green. |
| CF-J19-* / CF-SM-COMP-* / CF-B18-* / CF-B19-* / CF-C-B18 / CF-C-B19 / CF-IF-COMPARE | Design only | Implementation is tracked by the comparative-execution backlog and GitHub epic; no executable coverage or evidence claim exists yet. |
| CF-S8-env / CF-S8-qual+judge | Design/scaffold only | Empty truthful scaffold at `golden-sets/selection-judge/`; F-PT-011 keeps scores inadmissible for automatic selection and any threshold-dependent outcome inconclusive. |
| CF-J03/J04 2026-08-03 slices; CF-J20-*; CF-SM-ROADMAP/VALIDATION/BATCH-*; CF-INV-016; CF-B20/21/22-*; CF-C-B20/21/22; CF-C-OPVALIDATION/OPBATCH | Complete deterministic families; external soak/human evidence separately pending | HB-100…107 provide the provider-free authority, atomic delivery, batching, direct-effect, and context/session/cache implementation. HB-108 expands the production validation catalog and content pin and walks all 30 deterministic family rows (including CF-IF-XSURF) to real seeded controls, with empty-walk and detector-never-fired harness controls. HB-109 adds overlapping-batch, duplicate-stimulus, all-or-none multi-ticket claim, per-unit settlement, sibling-isolation and stale-frontier contention machinery plus the extended soak collector; no seven-day campaign was run. HB-110 projects one shared explanation through Status/JSON/Report/Observe and tests exact cross-surface equality. No live-evidence claim follows. |
| CF-S1 2026-08-03 slice; CF-S10-env/qual | Deterministic envelopes and pre-tuning corpora integrated; human references validated | HB-102/HB-108 implement the provider-free C-OP-VALIDATION/B-21 envelope and integrate Planner plus Validation Designer corpora. Every current row is human-validated; F-PT-010/011 keep threshold-dependent outcomes inconclusive. |

- HB-080 runbook: complete at `docs/qualification/validation-triage.md` and linked
  from campaign presentation surfaces.
- HB-081 inconclusive semantics: complete with product detector at
  `tests/hermetic/cf-harness-report/campaign-report-surfaces.test.ts`.

- **Journeys:** 20 × 5 = **100 semantic cells, written as 96 table rows** (the single
  J-13 row covers its five dup-pruned cells). Accounting: **91 family cells + 9
  pruned/blocked cells** — J-06-A (na), J-10-A (na), J-13 ×5 (dup), J-16-RC (dup),
  J-17-A (BLOCKED:B-17-L3). CF-J10-I is a family cell carrying an embedded named
  block (F-PT-006). <!-- ratification 2026-07-31: J-07-I unblocked (F-PT-003
  ratified) — moved from the blocked count to the family count; CF-J04-I's embedded
  F-PT-004 block resolved (ratified line encoded in-cell). -->
- **State machines:** 12 machines × 4 rows = 48 cells → all traced (2 dup prunes; 1
  F-PT-006 block); CF-SM-COMP is design-only, while Roadmap/Validation/Batch have
  complete deterministic families and no external-evidence claim.
- **Invariants:** 16 × 2 rows → 16 families (violation+guardrail folded; every family
  carries its negative control).
- **Boundaries:** 22 numbered boundaries become **23 matrix entries** (B-09 splits into
  B-09a and B-09b) × 7 rows = **161 semantic cells** → traced via the §4 families
  (B-08, B-11 dup-pruned to their journey/state owners; finding-blocks named in-cell).
- **Contracts:** 29 canonical IDs = 23 boundary contracts (incl. B-09A/B-09B
  separately) + CORE + 5 OP → 29 clause-complete families; acceptance criteria
  dup-pruned to their §1 cells.
- **Interfaces:** 7 families incl. standalone comparison and the cross-surface agreement check.
- **LLM sites:** **10 site families (S-1…S-10) × 4 rows = 40 cells** → every cell
  now explicitly a family, PRUNE-na, PRUNE-dup, or finding-parked; no quality cell may
  yield pass/fail until its owning finding ratifies (L4Q category).
- **Ops obligations:** 8 rows → **5 families (CONT, SOAK, ROT, GROW, ABUSE-interim) +
  2 dup prunes + 1 named V1 not-applicable prune**. Layer 5 holds CONT (hermetic rig, L5 by question), SOAK, ROT (named
  Codex-rotation sub-obligation with its own completion evidence), and the
  deferred-declared ABUSE lane behind the ratified threat model; **GROW is Layer 2**
  (seeded aged state under a controlled clock — the cheapest layer that can falsify
  retention boundaries).
- **Blocked cells (all named at their cells, none silent):** F-PT-012 (CF-J14-S
  execute-order clause), F-PT-013 (CF-INV-002 git-push-to-default leg), F-PT-014
  (CF-SM-GRANT scope-mapping clause), F-PT-015/F-PT-016 (CF-B14-* re-run +
  publish-origin clauses) — opened at Wave-1 implementation 2026-07-31; F-PT-006 (CF-J10-I,
  CF-SM-EVENT-*, CF-B13-*; contract-matrix remainder CF-C-B13), F-PT-008
  (CF-J06-I, CF-B09a-*; contract-matrix remainder CF-C-B09A), B-17-L3 (CF-J17-A,
  CF-B17-*; contract-matrix remainder CF-C-B17), F-PT-017 (CF-C-CORE terminal-
  status enum clause), F-PT-018 (CF-HARNESS-CI required-check enforcement).
  <!-- changelog 2026-07-31 (audit AUD-106): §5 per-ID resolver's five blocked
  contract-matrix remainders added to this roll-up so it is the complete register. -->
  <!-- ratification 2026-07-31: F-PT-003 (CF-J07-I), F-PT-004 (CF-J04-I/CF-B15-*
  in-cell + CF-C-B15 remainder), and F-PT-007 (CF-B14-* + CF-C-B14 remainder) left
  this register — ratified; their cells now encode the ratified contracts
  (HB-P1/HB-P2/HB-P4). -->
- **Every family lands at the cheapest layer that can falsify it** (rule 12): L3
  appears only where boundary-map honest-fake verdicts left a named remainder; L4 only
  for statistical quality (L4Q); **L5 holds the obligations defined by their question
  — contention, soak, rotation, abuse — regardless of rig technology** (retention
  growth is falsifiable at L2 and lands there).

Matrix closure reached: no silent empty cell. The catalog is maintained under the
case-derivation grammar for the life of the product (sourcing channels, agents-md
contribution).

---

## 10. Defect-sourced regression families

The `case_sourcing` channel in `validation-policy.yaml` ("every production bug deposits
its regression detector in the same change") produces families that are **not** new
matrix cells: each one is a case added against structure §§1–8 already own. This section
is the traceability record — defect → owning invariant/journey/boundary, control point,
layer, and the spec that carries it — so the deposit rule is auditable in both
directions. **It does not change the §9 closure counts**, and a row here is never a
substitute for the derivation row it hangs off.

A row is added here only when the defect's cases fit existing structure. A defect that
would need a new journey, boundary, or invariant is a structural change and re-enters
`validation-harness-design` in `harness-revision` mode (AGENTS.md → Validation harness).

| Family | Defect | Owning structure | Control point | Layer | Oracle | Spec |
|---|---|---|---|---|---|---|
| CORMIDIA-CASE-DET-004 | #199 / TM-011 — concurrent approve/deny writers shared one temporary path and could return contradictory success while grant bytes, the decision log, and the authoritative item disagreed | CF-SM-APPR-L/I/R/C · CF-INV-003/013 · CF-B09b-* | T-2 | 2 | state+det | `tests/hermetic/cf-sm-appr/cormidia-case-det-004.test.ts`; Promise.allSettled contention orders, duplicate delivery, interruption recovery, authoritative-surface agreement, and seeded contradiction control |
| CF-REG-206 | #206 — interactive review treated non-TTY EOF as a successful skip and decisions lacked an exact-confirmation, attributable non-interactive path with the shared human-only rule boundary | CF-J05-* · CF-INV-001/003 · CF-B09b-* | T-2 | 2 | refusal+state+evid | `tests/hermetic/cf-reg-206/cf-reg-206-cli.test.ts`; non-TTY refusal, required target/reason/identity/confirmation, bare-token rejection, attributable agent decision, human-only rules, and seeded EOF-success control |
| CF-REG-231 | #231 — the five-minute reconciliation cadence repeatedly interpreted one daily Planner slot as new work, producing three independent paid turns in one due window | CF-J09-I/RC · CF-J13-* · CF-INV-005/014 · CF-B06-* · CF-B08-* | T-5/T-6 | 1/2 | state+det | `tests/hermetic/cf-reg-231/cf-reg-231-due-window.test.ts`; reusable claim primitive family `tests/unit/cf-sched-claim/durable-claim.test.ts` |
| CF-REG-230 | #230 — Planner's input was filtered to `op:ready`, making Planner-owned readiness circular and rendering a non-empty repository as an empty backlog | CF-J03-S/R · CF-INV-008/012/014/016 · CF-B01-* · CF-B20-* · CF-B21-* · CF-C-OPPLAN/OPVALIDATION/OPBATCH | T-2/T-5/T-9 | 2 | state+evid+refusal+det | `tests/hermetic/cf-reg-230/cf-reg-230-planner-intake.test.ts`, `tests/unit/cf-reg-230/production-scheduler-lifecycle.test.ts`, `tests/unit/cf-hb103-105/production-wiring.test.ts`; complete-open-backlog bound, readiness, RoadmapPlan/delivery-unit migration, routine validation, batching/routing production wiring, and seeded truncation/wiring controls are deterministic; disposable-repository L3 remains unrun |
| CF-REG-232 | #232 — a scheduled Planner turn could complete with unpublished local changes, then repeat provider work or conflict after crash, lost acknowledgement, or GitHub refusal | CF-J03-I/RC · CF-INV-003/008/011/012/013/014/016 · CF-B01-* · CF-B14-* · CF-B15-* · CF-B20-* · CF-B21-* · CF-B22-* · CF-C-OPPLAN/OPVALIDATION/OPBATCH | T-2/T-7/T-9 | 2 | state+evid+refusal+det | `tests/hermetic/cf-reg-232/cf-reg-232-planner-publication.test.ts`, `tests/unit/cf-reg-230/production-scheduler-lifecycle.test.ts`; all-route isolated/read-only worktree, registered-origin binding, durable completion barrier, crash-before-push, push/RoadmapPlan lost acknowledgement, duplicate and concurrent resume, remote-ref/roadmap conflict, permanent discovery/push refusal, content-bound recovery/tamper rejection, repository/app protocol-surface and credential refusal with error redaction, operator-byte preservation, status/narrative recovery, and seeded completed-before-publication/wiring/credential controls |
| CF-REG-239 | #239 — the PR-level rule excluding self-judging changes existed only in prose, so Planner could ready and Builder could claim a ticket whose verification ran through the instrument being repaired | CF-J03-R · CF-J04-S/R · CF-INV-001/008/015 · CF-B01-* · CF-C-OPPLAN · CF-C-OPLOOP | T-3/T-9 | 2 | state+refusal+det | `tests/hermetic/cf-reg-239/cf-reg-239-routing-exclusion.test.ts`; Planner and Builder seams, late-label re-read, unreadable-state refusal, phase-survival, and identical-ticket negative controls |
| CF-HB102-MANUAL-REVIEW | 2026-08-03 owner decision — exact `manual-review` must exclude autonomous readiness/claim independently of `routing:human-only`, survive projection/phase changes, block a whole delivery unit, and never be removed by Cormidia | CF-J03-R · CF-J04-S/R · CF-J20-R · CF-INV-016 · CF-B20-* · CF-B21-* · CF-C-OPPLAN · CF-C-OPLOOP · CF-C-OPVALIDATION | T-3/T-9 | 2 | state+refusal+det | `tests/hermetic/cf-reg-239/cf-reg-239-routing-exclusion.test.ts`, `tests/hermetic/cf-hb100/roadmap-delivery-walking-skeleton.test.ts`, `tests/hermetic/cf-hb102/validation-contract-authority.test.ts`; Planner/Builder/current-read/whole-unit/projection preservation, unreadable-read refusal, and `manual-feelview` no-wildcard negative control |
| CF-REG-229 | #229 — a selected per-turn cap was observed post-hoc, so the next tool/provider action could start after the authorized trajectory bound was exhausted | CF-J07-S/RC · CF-INV-006/007 · CF-C-CORE | T-5/T-11 | 2 | state+refusal+evid | `tests/hermetic/cf-reg-229/cf-reg-229-hard-turn-budget.test.ts` |
| CF-REG-236-BUDGET | #236 "Budget-exhaustion suspend and resume" (ratified 2026-08-03) — a per-turn cap firing while the EPISODE could still afford a turn produced `op:returned`, the harshest of the loop's three stop outcomes: it burned a claim and discarded the native session. The two rings were indistinguishable in the stop record, and the pause path (`blockedOnApproval`) was unreachable from the live plan-DAG executor, which returned every non-completed step | CF-J04-R · CF-J05-* · CF-SM-APPR-L/I/R/C · CF-INV-005/006/007 · CF-C-CORE | T-2/T-5/T-11 | 2 | state+refusal+evid+det | `tests/hermetic/cf-reg-236-budget/cf-reg-236-turn-budget-suspend.test.ts` — ring derived from the episode ledger (never declared), preserved session and non-zero partial usage, one-inbox escalation carrying the observed-cache resume estimate, #104 claim accounting across grant and denial, and the terminal-episode coupling that makes the driver's finalize-skip load-bearing; `tests/hermetic/cf-reg-236-budget/cf-reg-236-plan-suspension.test.ts` — the `step_suspended` journal state parks and re-enters, with sticky-failure and wrong-step-kind negative controls |
| CF-REG-181 | #181 — Codex/Claude permission behavior was adapter-local (`untrusted`/SDK omission), not app-resolved or diagnosable, and configuration could have represented provider bypass modes | CF-B02-* · CF-B03-* · CF-B10-* · CF-C-CORE | T-3/T-11 | 1/2 | refusal+state+det | `tests/unit/cf-reg-181/provider-permission-arguments.test.ts`, `tests/hermetic/cf-reg-181-154/app-execution-policy.test.ts`; CLI/SDK/request agreement, bypass/missing-mode seeded controls, linked-worktree edit→stage→commit matrix, app isolation, and durable effective mode |
| CF-REG-154 | #154 — per-turn soft caps, generic/ticket hard ceilings, and non-planning execution bounds were resolved from separate source constants, could not be configured independently per app, and lacked one load-time monotonicity check/effective evidence path | CF-J07-S/RC · CF-INV-006/007 · CF-B10-* · CF-C-CORE | T-5/T-11 | 1/2 | state+refusal+evid+det | `tests/hermetic/cf-reg-181-154/app-execution-policy.test.ts`; shipped-default pin, independent per-turn/episode/route override, cross-app negative control, bypass/non-monotonic seeded controls, and exact envelope/route persistence |
| CF-REG-244 | #244 — a critical operation suppressed during a turn was recorded only in the approvals audit log, so a verdict could pass while the evidence it depended on had silently vanished (2026-08-01 run, ticket #7, approvals `20260801T093600Z-uevo` / `20260801T093705Z-h7si`) | CF-SM-APPR-L/I/R/C · CF-J04-R · CF-INV-002/005 · CF-B09a-* | T-1/T-2 | 2 | state+evid+det | `tests/hermetic/cf-reg-244/cf-reg-244-suppressed-operations.test.ts` — gate/approvals half only: the two dispositions PURPOSE v2.15 leaves reachable (denied, expired), idempotent expiry reconciliation, the empty-not-missing verdict record, and the budget-escalation exemption. The Reviewer half ("a verdict must not PASS when declared evidence is missing") is **#234** and is deliberately not implemented here |
| CF-REG-228 | #228 — scheduled time alone constructed paid SRE/Support/Marketing work with no actionable input; the observed SRE turn spent about $5.28 reconstructing an empty operating context | CF-J09-R · CF-J11-* · CF-J18-R · CF-INV-014 · CF-B08-* | T-5/T-9 | 2 | refusal+evid | `tests/hermetic/cf-reg-228/cf-reg-228-paid-turn-eligibility.test.ts` |
| CF-REG-211 | #211 — launchd's minimal environment omitted `gh`, while manual turns inherited an interactive PATH; scheduler health did not detect the divergence | CF-J16-S/I · CF-INV-008/015 · CF-B05-* | T-9 | 2 | refusal+evid | `tests/hermetic/cf-reg-211/cf-reg-211-scheduler-environment.test.ts` |
| CF-REG-209 | #209 — normal WIP/fresh-lock backpressure was classified as scheduler failure, spawned decisions claimed completion before provider receipts, and unresolved alerts made health permanently red | CF-J09-R/I · CF-J15-* · CF-J16-I · CF-INV-008/014 · CF-B05-* · CF-B08-* | T-9 | 2 | state+evid | `tests/hermetic/cf-reg-209/cf-reg-209-scheduler-health.test.ts`; stopped-state projection in `tests/hermetic/cf-j16/cf-j16-scheduler-lifecycle.test.ts` |
| CF-REG-205 | #205 — an undecided approval outlives the turn that raised it and blocks `app verify` indefinitely; 7 of 7 items in the august-org run were orphans | CF-SM-APPR-L/I/R/C · CF-J05-* · CF-INV-005 · CF-B09a-* | T-2/T-6 | 2 | state+evid+det | `tests/hermetic/cf-reg-205/cf-reg-205-expiry.test.ts`; ratified F-PT-020 expiry semantics, policy-derived TTL, claim release without failure-claim consumption, preserved worktree/artifacts, verify projection, and seeded orphan control |
| CF-REG-204 | #204 — read-only git plumbing classified as `operation: "write"` (`check-ignore` absent from the read-subcommand set; `gitSubcommand` mistaking a `-C`/`-c` value for the subcommand), so the Reviewer's own secret-protection proof queued approvals that blocked `app verify` at 16/17 green | INV-002 (gate total over critical effects) · CF-INV-002 | T-1 (false-negative direction; this fix narrows, so positive controls lead) | 1 | det | `tests/unit/cf-reg-204/cf-reg-204-read-only-git-plumbing.test.ts`; rule-level half parked **BLOCKED:F-PT-019** |
| CF-REG-202 | #202 — an accepted `failed_gate` revision was unreachable: the adopted plan's repair suffix depended on the review step whose findings authorized it, and that step was withheld by the adopted-revision halt, so the only ready step was the withheld one. Uncovered sibling of #175, which fixed the mirror-image BUILD case | INV-003 (never re-perform) · INV-014 (considered work never vanishes) · CF-J04-R (review-findings path) · C-OP-LOOP §3/§4 | T-9 | 1/2 | state+evid | `tests/hermetic/cf-reg-202/cf-reg-202-failed-gate-revision.test.ts` |
| CF-REG-203 | #203 — `loop --follow` cut every ticket after the first from the base captured at loop start; the managed clone was never re-fetched, so merges landing mid-run were invisible to later tickets (third instance of the default-branch scar after #60/#101 — cached, not guessed) | INV-009 (base resolved, never guessed) · CF-J04-S (ready→merged walk) · CF-B15-* (git substrate) | T-7 | 2 | state | `tests/hermetic/cf-reg-203/cf-reg-203-base-freshness.test.ts` |
| CF-REG-203-G | same defect, source-rule half: AGENTS.md's "never hardcode a default branch" rule needed a scanner that covers more than `origin/main` | INV-009 · CF-B15-* | T-7 | 1 | det | folded into `tests/unit/cf-inv-009/default-branch-source.test.ts` (the CF-INV-009 structural pin, HB-030) |
| CF-REG-251 | #251 — the CF-J12-I journal reader derived a filename from the raw random approval ID while the publisher strips a trailing base64url `-`, making full-suite reliability depend on a roughly 1-in-64 draw | CF-J12-I · CF-INV-013 · CF-HARNESS-CI | T-9 | 2 | state+det | `tests/hermetic/cf-j12/cf-j12-i.test.ts`; fixed trailing-hyphen approval ID, publisher/journal round trip, and seeded raw-path `ENOENT` negative control |
| CF-REG-268 | #268 — real-GitHub conformance clause B01-CF-13 deliberately consumed its branch-delete effect, but the live surface retained that branch as outstanding cleanup and converted the expected terminal missing-ref response into a false campaign failure | CF-B01-* · CF-HARNESS-CI | T-7 | 1 | state+det | `tests/unit/cf-reg-268/github-live-cleanup-bookkeeping.test.ts`; successful deletion consumes tracked cleanup state, with a seeded bypass reproducing the stale second-delete failure |
| CF-REG-269 | #269 — one file-scoped live-campaign error array contaminated later independent wrappers, so passing launchd and unattended cases were reported failed after an earlier GitHub cleanup error | CF-B01-* · CF-B05-* · CF-B09b-* · CF-HARNESS-CI | T-7/T-9 | 1 | evid+det | `tests/unit/cf-reg-269/live-campaign-error-isolation.test.ts`; case-local accumulators with a seeded file-scope structural negative control |
| CF-REG-271 | #271 — @openai/codex 0.144.4 exposed shell execution as code-mode `exec`, bypassing the Bash-only PreToolUse matcher and executing both forbidden L3 actions | CF-INV-002 · CF-B03-* · CF-C-B03 | T-11 | 1/2 | refusal+det | `tests/unit/cf-reg-271/codex-exec-gate.test.ts`, `tests/unit/cf-inv-002/codex-channel-fail-closed.test.ts`; explicit code-mode disables, defensive `exec` matcher, fail-closed normalizer, and seeded legacy-matcher/re-enabled-channel control |
| CF-REG-285 | #285 — gpt-5.6-sol's packaged `tool_mode=code_mode_only` metadata overrode the #271 feature disables, and the typed hook-trust override never reached App Server, so both L3 shell attempts executed without reaching the runtime gate | CF-INV-002 · CF-B03-* · CF-C-B03 | T-11 | 2 | refusal+det | `tests/hermetic/cf-reg-285/codex-direct-tool-request.test.ts`; real packaged App Server against a loopback Responses fake pins the exact assigned model plus direct `shell_command` surface and terminal pre-execution denial for forbidden reads/writes; matching forced-code-mode metadata reproduces custom `exec`, while dropping the typed hook-trust request override proves an auto-approved read reaches the command-execution seam without a gate escalation, as seeded negative controls |
| CF-REG-287 | #287 — the L4 runner received a valid session/output/exact usage above the case reservation, then discarded that known partial result and aborted the remaining 19 independent cases | CF-HARNESS-REPORT · CF-S1-qual · CF-S3-qual+judge · CF-S10-qual | T-9 | 2 | evid+state+det | `tests/hermetic/cf-eval-runner/eval-runner.test.ts`; known over-reservation attempt preserves session/output hash/actual usage/error fingerprint, keeps the case uncollected, and continues to an independent case while the hard envelopes admit it; unknown-use and malformed-result negative controls remain conservative and fail closed |
| CF-REG-272 | #272 — the review delivery fence trusted GitHub's lagging PR projection after a branch push, so it published a review bound to the stale commit before the projection caught up | CF-B01-* · CF-C-B01 · CF-INV-009 | T-7 | 2 | refusal+state+det | `tests/hermetic/cf-reg-272/stale-review-ref-fence.test.ts`; authoritative branch-ref comparison before write, with a seeded projection-only fence that reproduces stale publication |
| CF-REG-273 | #273 — B01-CF-02 retried direct issue readback but sampled the label-filtered search projection once, converting ordinary GitHub index lag into a false real-seam failure | CF-B01-* · CF-C-B01 · CF-HARNESS-CI | T-7 | 2 | state+det | `tests/hermetic/cf-reg-273/conformance-list-readback.test.ts`; bounded delayed-list readback plus a seeded one-attempt control that fires B01-CF-02 |
| CF-REG-291 | #291 — release L3 observed the created issue and label event but three bounded label-filtered search samples remained stale; the harness called that finite observation gap a product violation despite B-01 declaring no staleness maximum, and discarded the sub-assertion detail from durable evidence | CF-B01-* · CF-C-B01 · CF-HARNESS-CI · CF-HARNESS-REPORT | T-7/T-9 | 2 | evid+state+det | `tests/hermetic/cf-reg-291/github-observation-classification.test.ts`, `tests/hermetic/cf-reg-273/conformance-list-readback.test.ts`, `tests/hermetic/cf-harness-report/campaign-runner.test.ts`; bounded observation exhaustion stays uncollected/incomplete/inconclusive and cannot green, sanitized clause/error identity persists, independent cases continue, and seeded direct-artifact mismatches remain product violations |
| CF-REG-293 | #293 — the corrected L3 verdict remained incomplete twice because three one-second-spaced samples are not a useful collection window for GitHub's label-filtered issue projection, even while direct issue and label-event evidence existed | CF-B01-* · CF-C-B01 · CF-HARNESS-CI | T-7/T-9 | 2 | evid+state+det | `tests/hermetic/cf-reg-293/github-label-observation-window.test.ts`, `tests/hermetic/cf-reg-273/conformance-list-readback.test.ts`; the release-only policy retains exactly three attempts and ordinary one-second readback, gives only label search two 60-second waits, rejects the seeded legacy short window and attempt widening, and records the injected delay sequence without sleeping; true mismatches remain violations under CF-REG-291 |
| CF-REG-297 | #297 — the shared L3 adapter resume probe required every provider model to attempt an explicitly forbidden parent-directory write, so Claude's independent safety refusal prevented a second gate observation and was misclassified as an INV-002 product bypass | CF-B02-L3 · CF-B03-L3 · CF-B04-L3 · CF-C-B02 · CF-C-B03 · CF-C-B04 | T-1/T-5/T-11 | 2 | refusal+state+det | `tests/hermetic/cf-adapter-conformance/adapter-conformance-pair.test.ts`; every adapter retains the real forbidden-read denial and exact-session resume, Codex retains its separately required forbidden-write denial, Claude/pi use a benign resumed shell attempt that must still be gate-denied, and a task-sensitive seeded legacy prompt reproduces the one-gate/false-violation failure |
| CF-REG-299 | #299 — the first RQ-1 L4 manifest assigned exactly 20 provider turns to 20 mandatory case-attempt pairs, but the durable campaign contract marks equality as ceiling exhaustion and permits terminal completeness only with an unexhausted envelope; even a 20/20 collection was structurally unable to qualify | CF-HARNESS-RQ · CF-HARNESS-REPORT · CF-S1-qual · CF-S3-qual+judge · CF-S10-qual | T-9/T-11 | 1 | refusal+det | `tests/hermetic/cf-release-evidence/release-evidence.test.ts`; manifest admission requires strict provider-turn headroom beyond the full declared case-attempt cardinality, with the exact-equality manifest as the seeded negative control and one-turn headroom as the positive control |
| CF-REG-300 | #300 — seven RQ-1 L4 cases exceeded golden baseline reservations even though the 20-case run stayed below its aggregate output-token ceiling, making their otherwise valid partial results structurally uncollectable | CF-HARNESS-RQ · CF-HARNESS-REPORT · CF-S1-qual · CF-S3-qual+judge · CF-S10-qual | T-9/T-11 | 2 | refusal+evid+det | `tests/hermetic/cf-eval-runner/eval-runner.test.ts`, `tests/hermetic/cf-eval-runner/eval-config.test.ts`; a content-bound effective-reservation map covers every selected case exactly once, never lowers a golden baseline, and binds the exact campaign sum. Missing, extra, duplicate, sub-baseline, and sum-mismatch rows are seeded controls; the approved seven-case calibration plus unchanged baselines is the 88,100-token positive control |
| CF-REG-274 | #274 — `pnpm test:live` exited zero when every Vitest wrapper ran but the persisted campaign verdict was complete/fail, masking deterministic violations at the process gate | CF-HARNESS-CI · CF-B01-* · CF-B02-* · CF-B03-* · CF-B04-* | T-7/T-11 | 1 | evid+det | `tests/unit/cf-reg-274/live-campaign-verdict.test.ts`; terminal complete/pass assertion after report persistence, with seeded fail and incomplete controls |
| CF-REG-281 | #281 — the RQ-1 tarball reader sorted packed paths with locale-sensitive `localeCompare`, while its own manifest validator required ECMAScript code-unit order, so the actual npm tarball's uppercase `README.md`/`TASTE.md` paths made release preparation refuse before qualification | CF-HARNESS-RQ · CF-HARNESS-CURRENCY | T-9 | 1 | refusal+det | `tests/unit/cf-reg-281/package-manifest-order.test.ts`; npm-like mixed-case tarball detector plus a seeded legacy locale-order control |
| CF-REG-283 | #283 — the RQ-1 campaign-manifest validator required exactly three slash-separated tuple segments, rejecting the ratified Pi model id `openai-codex/gpt-5.6-sol` before any campaign could run | CF-HARNESS-RQ · CF-HARNESS-CURRENCY · CF-B04-* | T-9 | 1 | refusal+det | `tests/hermetic/cf-release-evidence/release-evidence.test.ts`; slash-bearing exact tuple detector plus seeded empty-model and unknown-effort controls |
