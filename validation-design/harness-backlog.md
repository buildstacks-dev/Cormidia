# Harness backlog — Cormidia replacement harness (ticket-shaped)

Status: Phase 8 deliverable. Implementation root: `tests/` (docs v2.9). Every
ticket carries acceptance criteria, the invariant/contract it defends, its layer, and a
named executor. Per skill rule: **expansion gates are scoped per layer** — a missing
live target, an unpassed eval threshold, or unauthorized CI parks only its own layer's
tickets, never L1/L2 implementation. Catalog derivation is already complete
(case-catalog.md); these tickets implement it.

<!-- acceptance 2026-08-03: the product owner accepted the revision as the binding
implementation contract and authorized HB-100. Protected protocol surfaces, merge,
publication/deployment and live/token-spending campaigns remain separately gated. -->

Executors: `build-agent` = the standing coding agent working in the Cormidia repo under
AGENTS.md routing; `human` = Bikram; `campaign` = a scheduled/authorized validation
campaign run.

<!-- changelog 2026-07-31 (post reader test): +HB-007 PROPOSED-register tripwire
(new-engineer finding 5); +HB-047 S-9 contract ticket (finding 1); Wave L3 header
qualified for HB-054 (finding 2); Waves 1-4 layer/defends convention note added
(finding 3). -->
<!-- ratification 2026-07-31: HB-P1/HB-P2/HB-P4 unparked (F-PT-003/004/007
resolved-ratified — see ratification-package.md §9); HB-P3/HB-P5 stay parked
(F-PT-006/008 still open); +HB-080 operator triage runbook; +HB-081 product-side
inconclusive-semantics surface (product change, not harness). -->

**Convention (Waves 1–4):** tickets in these waves inherit *Layer* and risk from
their wave heading and *defend* the invariants/contracts named by their case-family
IDs (resolve via case-catalog.md); only Wave 0 and the L3/L4/L5 waves state Layer
inline because their tickets cross layers.

## Wave 0 — Walking skeleton (before mass case implementation)

<!-- implementation status 2026-07-31: HB-001..HB-006 LANDED (tests/
walking skeleton; 134 specs green; CI lane wired with pinned fail-closed
gitleaks + canary). HB-007 **COMPLETE 2026-07-31**: owner said "ratify
recommendations"; items 1–8 and 13 are recorded ratified/adjusted-ratified in
validation-policy.yaml. Items 9–12 remain PROPOSED and inconclusive-only.
Defect fixed with deposited detector this wave: S-3 conflicting verdict
markers (src/loop/verdicts.ts extractKeywordValueStrict;
tests/unit/s3-verdict-marker.test.ts). -->


- **HB-001 — Harness root + CI lane.** Create `tests/` structure (unit/,
  hermetic/, live/ opt-in config, eval-runner/, fixtures/), wire `pnpm test`
  (vitest) to it, add the GitHub Actions lane running L1+L2+gitleaks per commit.
  *Acceptance:* CI runs the lane on a PR; an intentionally failing spec turns it red
  (lane negative control); gitleaks runs pinned + fail-closed with a generated
  temporary canary proving detection; wall-clock recorded (5-min ratified target is
  reported, not enforced). *Defends:* policy `ci` block; harness self-tests. *Layer:*
  1–2 + CI. *Executor:* build-agent.
- **HB-002 — Fixture kit v1 + self-tests.** Temp org home, temp state home, temp git
  repo/worktree factory, injected clock, kill-point subprocess harness. Each fixture
  ships a self-test; every sweep asserts a non-empty walk. *Acceptance:* fixture
  self-tests green; empty-walk fails. *Defends:* rule 17. *Layer:* 2. *Executor:*
  build-agent.
- **HB-003 — GitHub double v1 + conformance-pair scaffold.** Scripted fake per
  boundary-map B-01 (state machine, per-call failure scripts, lost-response mode,
  configurable default branch). Conformance suite structured to run against fake now
  and real later (CF-B01-L3). *Acceptance:* fake passes its own contract suite; one
  scripted failure mode (lost response) demonstrably reproducible; negative control:
  a deliberately lying fake variant fails the suite. *Defends:* B-01, INV-008/009.
  *Layer:* 2. *Executor:* build-agent.
- **HB-004 — Adapter double v1 (one adapter first: Claude).** Mocked runtime per
  provider-adapter-core + B-02 scripts. *Acceptance:* core contract clauses assert
  against it; usage-absent renders unknown (INV-006 seed red-then-green). *Layer:*
  1–2. *Executor:* build-agent.
- **HB-005 — Skeleton test per layer (one each, with negative controls).**
  (a) L1: CORMIDIA-INV-006 exactly-once settlement guardrail test + seeded
  double-settle violation (red-then-green). (b) L2: one composition test — dispatch
  tick → claim → scripted adapter turn → settlement on the fixture kit, including one
  boundary failure mode (kill between provider return and ledger append). (c) journey
  test: CF-J04-S reduced walk (ready→PR on fake GitHub). (d) LLM contract test: S-3
  verdict-marker parser refusal (zero/two markers). *Acceptance:* each test paired
  with its seeded-violation negative control; all green in the HB-001 lane.
  *Defends:* INV-005/006/008/012; C-OP-LOOP. *Layer:* 1–2. *Executor:* build-agent.
- **HB-006 — Policy loader + artifact-location pin.** Test that validation-policy.yaml
  parses, artifact paths resolve, and the layer/trigger blocks match CI config
  (drift = red). *Acceptance:* moving an artifact without updating policy fails.
  *Defends:* rule 17; policy-as-data. *Layer:* 1. *Executor:* build-agent.
- **HB-007 — PROPOSED-register review tripwire.** Before Wave 0 completes, present
  every PROPOSED-register item whose expiry is "first harness build review" (register
  items 1–8, 13) to the human for ratify/strike/adjust; record outcomes in
  validation-policy.yaml. *Acceptance:* no Wave-1+ ticket may treat a still-PROPOSED
  value as settled fact; the build reports which items remain provisional. *Defends:*
  PROPOSED-register discipline. *Layer:* process. *Executor:* human + build-agent.
  **Status: COMPLETE 2026-07-31** — owner ratified the recorded recommendations;
  policy, contracts, design state, package, CI annotations, and harness conventions
  updated in the same change.

## Wave 1 — E-1 permission-to-effect chain (exhaustive; L1/L2)

<!-- implementation status 2026-07-31: HB-010..HB-017 + HB-P4 LANDED (commits
a70bc4b suites, e55eace fixes; 578 specs green + 1 parked skip). Twelve
deterministic product defects vs ratified contracts were found, fixed, and
their tripwires promoted to plain detectors in e55eace. Five genuine design
ambiguities became findings F-PT-012..016 (cells parked; see policy
open_findings). -->


- **HB-010** Gate classifier adversarial suite (CF-INV-002 seeds incl. obfuscation,
  unknown-tool fail-closed). Executor: build-agent.
- **HB-011** Approval store + grant lifecycle state machines (CF-SM-APPR-*,
  CF-SM-GRANT-*, both grant shapes; orphan-grant intermediate). Executor: build-agent.
- **HB-012** Continuation/resume fingerprint suite (CF-J06-*, B-09a; F-PT-008 clause
  parked). Executor: build-agent.
- **HB-013** Typed executor + marker typing (CF-B17-*, CF-J05-*, CF-J17-*; B-17 live
  remainder stays BLOCKED). Executor: build-agent.
- **HB-014** Authority resolution + org-identity suite (CF-B10-*, CF-INV-001 seeds,
  B-10a identity classes). Executor: build-agent.
- **HB-015** Destructive lifecycle containment (CF-J01-*, CF-J14-*, C-OP-LIFE;
  sibling-diff oracle; temp-FS/git fault injection only). Executor: build-agent.
- **HB-016** Secret confinement egress suite (CF-INV-011 seeds; single-policy
  structural check). Executor: build-agent.
- **HB-017** Learning activation boundary (CF-J12-*, CF-SM-LEARN-*, B-11 publisher
  forward-completion). Executor: build-agent.

## Wave 2 — E-2 durability + money (exhaustive; L1/L2)

<!-- implementation status 2026-07-31: HB-020..HB-025 + HB-P1/HB-P2
COMPLETE in the isolated codex/harness-wave2 worktree. Coverage includes
settlement conservation/reconcile properties; claim/tick races; budget-pause
convergence; real SIGKILL sweeps at delivery and turn-journal boundaries;
PID/start/nonce ownership plus owned-process-group TERM→KILL cleanup; Claude,
Codex, and pi doubles; and FS/git fault/preservation cases. Product detectors
land with every discovered defect. Full per-commit L1/L2 gate: 95 files,
662 passed + 1 intentionally parked skip. This status is L1/L2 only: real
provider conformance remains the separately gated HB-051 L3 obligation. -->

- **HB-020** Settlement conservation + reconcile (CF-J08-*, CF-INV-006 property tests
  via fast-check). **HB-021** Claim uniqueness/races (CF-INV-005, CF-J09-RC).
  **HB-022** Admission/pause (CF-J07-*; the former F-PT-003 block lifted 2026-07-31 —
  convergence cases land via HB-P1, unparked below). **HB-023** Crash-point
  sweeps (CF-J04-I, CF-SM-TURN-C, B-07 harness; F-PT-004 line ratified 2026-07-31:
  preserve-and-inspect — ambiguous-byte cases land via HB-P2, unparked below).
  **HB-024** Adapter enforcement slices T-11 (budget observation per capability
  matrix; session binding; remaining adapter doubles Codex + pi incl. rotation
  scripts and extension-absence). **HB-025** FS/git substrate faults (CF-B15-*).
  Executor: build-agent (all).

## Wave 3 — E-3 merge + evidence truth (exhaustive; L1/L2)

<!-- implementation status 2026-07-31: HB-030..HB-033 COMPLETE in the
isolated codex/harness-wave2 worktree. Coverage includes exact-HEAD/default-
branch merge authorization and HMAC binding; legal loop-phase entry and
ready→merged/refusal walks; observer/server restart, SSE resync, source-
freshness, corruption, traversal, and symlink cases; delivery evidence and
approval truthfulness; CLI capability/error semantics; and budget/cost/
lifecycle agreement across observe, report, status, budget, terminal, HTML,
and API surfaces. Product detectors land with every discovered defect. Full
per-commit L1/L2 gate: 108 files, 699 passed + 1 intentionally parked skip;
typecheck and build green. This status is L1/L2 only and does not imply any
separately gated L3/L4/L5 evidence. -->

- **HB-030** Merge boundary suite (CF-INV-009; HEAD equality; resolved default).
  **HB-031** Loop state machine + labels-after-artifacts (CF-SM-LOOP-*, CF-J04-S/R).
  **HB-032** Evidence truthfulness sweep across readers (CF-INV-008, CF-J15-*,
  CF-J07-A/J08-A/J02-A, B-12 incl. capability/traversal). **HB-033** Cross-surface
  agreement (CF-IF-XSURF + CF-IF-* conformance). Executor: build-agent (all).

## Wave 4 — standard + thin remainder (L1/L2)

<!-- implementation status 2026-07-31: HB-040..HB-047 COMPLETE in the
isolated codex/harness-wave2 worktree. Coverage includes current-subscriber
event fan-out and post-spawn mark recovery; planner DAG/source/preview and
lost-response publication convergence; real-git onboarding, verification,
promotion interruption/resume; scheduler ownership/drift/orphan health;
retention boundaries; deterministic presentation smokes; ratified trajectory
detectors; and same-session one-repair envelope accounting. F-PT-006 producer
identity/partial-file clauses remain parked, as designed. Product detectors
land with every discovered defect. Full per-commit L1/L2 gate: 116 files,
726 passed + 1 intentionally parked skip in 61.93 s; typecheck and build green.
This status is L1/L2 only and does not imply separately gated L3/L4/L5
evidence. -->

- **HB-040** Event inbox (CF-B13-*, CF-J10-*, CF-SM-EVENT-*; F-PT-006 clauses
  parked). **HB-041** Planner validator + planning ops (CF-J03-*, C-OP-PLAN).
  **HB-042** Onboarding ladder + lifecycle records (CF-J02-*). **HB-043** Scheduler
  lifecycle hermetic (CF-J16-S/R/I). **HB-044** Retention GROW suite (CF-OPS-GROW,
  seeded aged state). **HB-045** Presentation smokes (thin, per risk-allocation §4).
  **HB-046** Trajectory assertions (CF-S2-traj ratified grounds + observed metrics).
  **HB-047** S-9 format-repair contract suite (CF-S9-env: exactly-one repaired
  structure, same session, bounded attempts, settles per turn — contract-only, no
  quality rubric). Executor: build-agent (all).

## Wave L3 — live lane (gated on its own layer: targets + spend authorization —
except HB-054, which additionally depends on a ratified product surface, flagged in
its ticket)

<!-- implementation status 2026-07-31: HB-050 COMPLETE. The strict opt-in runner,
durable report contract, real-adapter conformance pair, real sandbox-GitHub surface,
attributable launchd lifecycle proof, and ratified unattended profile are implemented.
Failed callbacks conservatively debit their full pre-authorized reservation, so
unknown partial provider spend cannot evade the campaign ceiling.
HB-051..HB-054 campaign EVIDENCE remains pending because no provider/repo/host campaign
was authorized or run in this change; absence is incomplete, never pass. HB-055 stays
blocked exactly as designed. -->

- **HB-050** Live config + campaign runner with spend accounting (enforces §5 bounds;
  completeness/verdict split). *Gate: none beyond CI merge of L1/L2 skeleton.*
- **HB-051** CF-B02-L3/CF-B03-L3/CF-B04-L3 adapter conformance runs. *Gate: provider
  auth on the operator machine; spend authorization per policy triggers.* Executor:
  campaign (human-initiated per trigger). **Probe hardening 2026-08-05 (#297):** every
  adapter retains a real forbidden-read denial and exact-session resume; Codex retains
  its contract-required forbidden-write denial, while Claude/pi use a benign resumed
  shell attempt that must still reach and be denied by Cormidia's gate. The
  task-sensitive legacy-prompt seed proves provider-level refusal cannot masquerade as
  product gate-bypass evidence.
- **HB-052** CF-B01-L3 GitHub smoke on sandbox repos. *Gate: sandbox repo access.*
  Executor: campaign. **Case-level hardening 2026-08-05 (#291):** a finite search-index
  observation gap whose contract has no staleness maximum remains required but
  incomplete/inconclusive; direct mismatches still fail, and sanitized clause/error
  identity is durable. Deterministic sensitivity lives in CF-REG-291 plus the campaign
  runner and CF-REG-273 controls. **Observation-window hardening 2026-08-05 (#293):**
  release L3 retains exactly three attempts and ordinary one-second readback, while only
  the repeatedly slow label-filtered issue projection receives two 60-second waits;
  exhaustion remains incomplete/inconclusive and a successor still needs fresh
  authorized L3 evidence.
- **HB-053** CF-J16-A launchd proof. *Gate: operator machine session.* Executor:
  human + build-agent script.
- **HB-054** Unattended sandbox campaign CF-J18-A under the test-mode profile.
  *Gate: the profile surface must first be ratified + implemented in Cormidia (policy
  `unattended_test_mode_profile`) — a product change, tracked as its own product
  ticket, not a harness ticket.* Executor: campaign. **Implementation dependency
  satisfied 2026-07-31; authorized campaign evidence still pending.**
- **HB-055** B-17 live target: BLOCKED (policy); unblock = disposable `release:`
  target. Executor: campaign (future).

## Wave L4 — eval lane (gated ONLY on golden-set authoring + finding ratification)

<!-- implementation status 2026-07-31: HB-060 COMPLETE (per-tuple data collection,
token reservation, bounded shard rotation, partial evidence, strict golden/provenance
validation, and tracked-blob binding to the authorized commit). CF-REG-287 tightened
partial evidence after the 2026-08-05 RQ-1 campaign: a known over-reservation result now
preserves its session/output hash/exact usage and independent cases continue while the
authorized hard envelopes admit them. F-PT-022 was owner-resolved 2026-08-05:
reservations and campaign `max_tokens` count output only; a seeded high-input/small-
output control proves input/cache telemetry cannot consume that envelope. Golden
reservations remain the human-reviewed baseline; #300 adds an exact human-approved
effective-reservation map totaling 88,100 output tokens without changing golden
expected behavior or reference validation.
HB-061/HB-062 build-agent
authoring is complete; every current reviewer/planner reference was human-validated by
`bikramgupta` on 2026-08-04 without changing agent authorship.
HB-063 deterministic trajectory scenarios are complete. F-PT-009/010/011 and register
items 9..12 remain PROPOSED, so threshold-dependent campaigns remain inconclusive. -->

- **HB-060** Eval runner v1 (data-collection mode; inconclusive-only reporting;
  per-tuple aggregation; output-token ceilings; shard rotation). Executor: build-agent.
  *Hardening 2026-08-05 (#299): RQ-1 manifest admission now refuses an L4
  provider-turn ceiling at or below the full declared case-attempt cardinality;
  strict headroom is required because equality is terminal ceiling exhaustion.*
- **HB-061** Author reviewer/ seeded-defect + clean sets (first-funded; provenance
  rules per scaffold). Executor: human + build-agent. *Note: threshold verdicts stay
  inconclusive until F-PT-009 ratifies — authoring is NOT gated on ratification.*
- **HB-062** Author planner/ sets; **HB-063** builder-trajectory scenario fixtures;
  later scaffolds per elicited priority. Executor: human + build-agent.

## Wave L5 — future assurance outside RQ-1 (gated per obligation)

<!-- implementation status 2026-07-31: HB-070 COMPLETE (ratified contention shape;
deterministic rig green). HB-071 runner/collector COMPLETE but the seven-real-day
human-started campaign and CF-OPS-ROT natural evidence are PENDING. HB-072 is
AWAITING HUMAN AUTHOR: the ten-surface worksheet is only a scaffold. HB-073 remains
BLOCKED; its hash-bound gate refuses until HB-072 is human-authored and reviewed. -->

<!-- owner disposition 2026-08-04: HB-072/HB-073, the seven-day soak and natural
rotation retain their owners, collectors, triggers and ceiling, but are not RQ-1
release obligations. Missing evidence remains visible and never pass. -->

- **HB-070** Contention rig (CF-OPS-CONT; hermetic implementation, L5 question).
  Executor: build-agent. **HB-071** Soak protocol runner + evidence collector
  (CF-OPS-SOAK incl. CF-OPS-ROT sub-evidence). *Gate: human schedules the 7-day
  window.* Executor: human + campaign. **HB-072** Threat model document. *Owner:
  human; due per policy.* **HB-073** Abuse lane cases. *Gate: HB-072.*

## Unparked at ratification (2026-07-31) — formerly parked, now implementable

- **HB-P1 — F-PT-003 budget-pause crash convergence cases** (CF-J07-I). Ratified
  contract: **pause holds; exactly one budget-exceeded item eventually.**
  *Acceptance:* kill-point sweep between overlay write and item creation converges to
  exactly one budget-exceeded item (never zero, never several) with the pause held
  throughout; negative control seeds a duplicate-item violation. *Defends:* F-PT-003
  resolution; INV-007 adjacency. *Layer:* 2 (lands with Wave 2, alongside
  HB-022/HB-023). *Executor:* build-agent.
- **HB-P2 — F-PT-004 ambiguous-byte disposition cases** (CF-J04-I embedded line,
  CF-B15-* remainder, CF-C-B15 clause). Ratified contract: **ambiguous uncommitted
  worktree bytes are preserved-and-inspected, never reset.** *Acceptance:* crash-sweep
  recovery never resets ambiguous bytes; preserved bytes are surfaced for inspection;
  negative control seeds a silent-reset violation. *Defends:* F-PT-004 resolution;
  INV-010/013 adjacency; T-6. *Layer:* 2 (lands with Wave 2). *Executor:* build-agent.
- **HB-P4 — F-PT-007 concurrent-edit cases** (CF-B14-*, CF-C-B14 clause). Ratified
  contract: **compare-and-refuse on drift, preserving human bytes.** *Acceptance:*
  human edit of a bootstrap-owned path between validation and write yields a typed
  refusal with human bytes intact — never overwritten, never merged silently;
  negative control seeds a clobber violation. *Defends:* F-PT-007 resolution; B-14;
  INV-010. *Layer:* 2 (E-1 adjacency, Wave 1 timeframe). *Executor:* build-agent.

## Parked (blocked candidate contracts — never implemented before ratification)

- **HB-P3** F-PT-006 producer-protocol + duplicate-identity cases. **HB-P5**
  F-PT-008 expiry-disposition cases. Executor: build-agent, after human ratifies each
  finding.
- **HB-P6** F-PT-017 provider terminal-status enum decision and migration cases
  (CF-C-CORE). Executor: human + build-agent after the owner chooses the canonical
  vocabulary and compatibility path; no test may derive truth from the current code.
- **HB-P7** F-PT-018 mechanical merge-blocking enforcement (CF-HARNESS-CI), retained
  as a known limitation/future improvement. Executor: human + build-agent after GitHub
  required-check controls become available. The PR workflow remains active and
  fail-closed internally; RQ-1 uses protected human merge plus release-blocking
  exact-tag rerun and does not claim mechanical merge blocking.

## Post-ratification additions (2026-07-31)

- **HB-080 — Operator triage runbook (alert→action mapping).** Owed once the harness
  and its reporting exist (ratification-package.md §6 IOU, converted to a ticket at
  ratification). Map every alert/failure class the harness can raise to an operator
  action, with severity anchored to system-map.md §5.2 (T-1…T-12) and expected
  behavior per contract. *Acceptance:* every harness-reportable alert class has an
  action row; the runbook is reachable from the harness reporting surface; README's
  "not an incident runbook" warning is updated to point at it when it lands.
  *Defends:* operability of the whole harness; INV-008 (truthful surfaces).
  *Layer:* process/docs. *Executor:* human + build-agent, after Wave 0 reporting
  exists. **Status: COMPLETE 2026-07-31** — canonical runbook at
  `docs/qualification/validation-triage.md`, validation-design pointer committed,
  and report/observe/status surfaces link it.
- **HB-081 — Product change (Cormidia repo, NOT harness): `inconclusive` is not a
  pass on report/observe surfaces.** The product's report/observe surfaces must state
  that an `inconclusive` verdict is not a pass (ratification-package.md §6 IOU,
  converted at ratification). This is a product-side change in the Cormidia repo,
  tracked here for visibility only — like HB-054's profile dependency, it lands via
  its own product ticket under the product's own rules (including its
  detector-deposit obligation). *Acceptance:* every product surface rendering
  campaign verdicts distinguishes `inconclusive` from `pass` and never renders it
  green or as release evidence. *Defends:* INV-008; eval decision-status rule.
  *Layer:* product. *Executor:* build-agent in the Cormidia repo (own ticket); human
  schedules. **Status: COMPLETE 2026-07-31** — durable campaign reports are projected
  through status, terminal/HTML Reports, and Observe; `inconclusive` is rendered as
  not-a-pass/not-release-evidence and corrupt reports remain visibly incomplete.

## Proposed comparative-execution implementation (2026-08-01)

<!-- Owner confirmed the product direction and requested the design + implementation
epic. These tickets are DESIGN-ONLY: none is implemented by this document change, and
the pre-revision green gate is not evidence for them. Sequence and acceptance derive
from docs/comparative-execution/design.md, J-19, B-18/B-19, and S-8. Tracked by
GitHub epic [#219](https://github.com/cormidia/Cormidia/issues/219). -->

- **HB-090 — Comparison contracts and hermetic skeleton.** Implement immutable
  comparison/candidate identities, the CF-SM-COMP state machine, sequential candidate
  execution, isolated namespaces/worktrees, exact tuple preservation, per-turn
  settlement, aggregate admission ceilings, evidence hashes, deterministic
  eligibility, durable selection, and crash-safe materialization acknowledgement.
  Land CF-J19-S/R/I/RC, CF-SM-COMP-*, CF-B18-*, CF-B19-*, CF-C-B18/19, and detector
  negative controls. *Acceptance:* no candidate outward effect; no sibling leakage;
  no double spend for a settled turn; no deterministic failure can be outweighed by a
  judge; exactly one content-bound eligible artifact, or none, may cross B-19.
  *Layer:* 1/2. *Executor:* build-agent.
- **HB-091 — Standalone Builder slice.** Add preview-first `cormidia compare` over a
  local git repo with exact operator-declared tuples, provider/capability checks,
  execute/confirm identity binding, external state/worktrees, Builder-specific
  validation evidence, terminal/JSON/portable-HTML results, and a separate explicit
  local winner-branch materialization command. Land CF-J19-A and CF-IF-COMPARE.
  *Acceptance:* no org, scheduler, GitHub remote, or GitHub auth is required; preview
  spends zero tokens; execution never mutates the active branch or pushes/opens a PR;
  operator-declared candidates are never represented as qualified. *Layer:* 1/2.
  *Executor:* build-agent.
- **HB-092 — EpisodePlan integration.** Add the exact transport schema, app-narrowed
  candidate-set and selection-policy validation, worst-case candidate+judge admission
  arithmetic, selected-artifact continuation, explain/status/report projection, and
  recovery. *Acceptance:* comparison is optional/off by omission; only a provider
  turn fans out; the episode keeps one route after selection; mandatory Reviewer,
  gates, PR, and merge remain downstream; losing candidates never become outputs.
  *Layer:* 1/2, with existing L3 adapter obligations only if invocation semantics
  change. *Executor:* build-agent.
- **HB-093 — S-8 selection-judge corpus and calibration.** Author seeded eligibility
  traps, clean controls, human pairwise/ranking references, order swaps, ties, and
  abstentions per operation; implement the blinded structured envelope and L4 runner
  integration. Authoring/data collection may proceed, but **automatic judge selection
  remains BLOCKED:F-PT-011** and all threshold-dependent outcomes remain inconclusive
  until the owner ratifies S-8 calibration thresholds and sampling design. A unique
  mechanically eligible candidate and declared non-judge fallbacks remain separately
  governed. *Layer:* 1/2 envelope + 4 quality. *Executor:* human + build-agent.
- **HB-094 — Planner activation, sampling, and optional parallelism.** After HB-090…093,
  allow planner-proposed comparisons inside app policy; then separately design sticky
  Cormidia-owned sampling and governed aggregate learning. Parallel candidates are last.
  *Gate:* sampling or parallelism re-enters risk allocation and may activate
  CF-OPS-COMP at L5; no single comparison mutates routing/qualification policy.
  *Executor:* human + build-agent.

## Proposed roadmap/validation/delivery/batching implementation (2026-08-03)

<!-- Owner accepted Phase 8 of the harness revision on 2026-08-03. HB-100 is authorized
for local provider-free implementation. These tickets implement #184/#233/#234/#240;
#239's merged human-only routing enforcement is a satisfied prerequisite, not duplicated
here. No ticket
may silently edit TASTE.md, roles.yaml, pipelines.yaml, prompts/** or PURPOSE.md: HB-111
prepares the proposal and a human separately ratifies any such surface. -->

- **HB-100 — COMPLETE 2026-08-03 — Vertical walking skeleton: roadmap → validation → unit → batch → review.**
  Implement the smallest hermetic path for one accepted RoadmapPlan containing one
  two-ticket delivery unit, one accepted validation contract, a batch of one, lazy
  token-free EpisodePlan normalization, an atomic member claim, one synthetic PR/evidence
  manifest and an independent Reviewer verdict. Persist each authority before its
  projection; seed one wrong-contract/HEAD lineage violation and prove the detector turns
  red. *Acceptance:* the path can be walked end-to-end without a provider, a label cannot
  substitute for an artifact, and no prior green suite is represented as covering it.
  *Defends:* CF-J03/J04 2026-08-03 slices, CF-J20-S, CF-INV-016, CF-B20/21/22 happy
  joins. *Layer:* 1/2. *Executor:* build-agent. *Depends on:* accepted Phase 8 package
  and #239.
  *Implementation:* `src/org/roadmap-delivery/` plus
  `tests/hermetic/cf-hb100/roadmap-delivery-walking-skeleton.test.ts`. The five
  executable cases prove the two-ticket provider-free join, one durable all-member
  claim under a race, persistence-before-projection, label-without-artifact refusal,
  whole-unit human-only exclusion at admission and claim, exact unit/contract/HEAD
  negative controls, and verdict-bound settlement. This is walking-skeleton coverage
  only; HB-108/HB-110 and HB-109 machinery are complete below, while the HB-109
  seven-day evidence and HB-111 remain required before autonomous-loop readiness.
- **HB-101 — COMPLETE 2026-08-03 — RoadmapPlan schema, store, snapshot and bounded-delta replanning.** Add
  versioned/hash-bound RoadmapPlan and backlog-snapshot schemas; stable workstream/unit
  IDs; exact issue accounting; graph/WIP/priority/frontier validation; predecessor/move
  history; pagination/unavailable distinctions; deterministic projection reconciliation;
  100+ issue and prior-plan+small-delta fixtures. Select exact app-state paths as a
  normal implementation decision and pin migration/reader compatibility in tests.
  *Acceptance:* no unaccounted/duplicate issue, stale frontier or projection-only
  readiness; unchanged regions need no provider rediscovery and non-admitted units get
  no EpisodePlan. *Defends:* CF-J03-*, CF-SM-ROADMAP-*, CF-B20-*, CF-C-B20,
  CF-C-OPPLAN. *Layer:* 1/2. *Executor:* build-agent. *Depends on:* HB-100.
  *Implementation:* the versioned immutable snapshot/RoadmapPlan records and current
  pointer live under `planning/apps/<app-hash>/`; `src/org/roadmap-delivery/` owns
  completeness/pagination, exact issue accounting, dependency/WIP/priority/frontier,
  current-plan CAS, stable membership IDs, append-only issue moves, bounded-delta and
  deterministic projection reconciliation. Five executable cases at
  `tests/hermetic/cf-hb101/roadmap-authority.test.ts` include 125-issue and
  120-plus-two-delta fixtures. They prove incomplete snapshots, unaccounted/duplicate
  issues, stale frontiers and unexplained ID/membership moves turn red; untouched and
  non-admitted work creates no EpisodePlan. Provider-authored roadmap planning and the
  remaining full CF-J03/B20 matrix stay with later tickets.
- **HB-102 — COMPLETE 2026-08-03 — Validation-contract authority and deterministic readiness guard.** Add the
  versioned validation schema/store, canonical ID resolver, affected-structure and
  cheapest-layer checks, explicit bounded-waiver policy, shared-boundary detector refs,
  negative-control obligations, and `requires_harness_revision` refusal. Thread the
  exact contract hash through readiness, EpisodePlan, Builder manifest and Reviewer
  verdict. *Acceptance:* omissions/unknown IDs/stale versions never become waivers or
  ready; C3/floor obligations cannot take the routine template; swapped unit/HEAD
  evidence turns red. *Defends:* CF-SM-VALIDATION-*, CF-INV-016, CF-B21-*,
  CF-C-B21/OPVALIDATION, CF-S10-env. *Layer:* 1/2. *Executor:* build-agent.
  *Depends on:* HB-100/101.
  *Implementation:* `src/org/roadmap-delivery/` now owns a closed v1 interchange
  schema, versioned app-scoped accepted validation catalog, immutable contract/lifecycle/
  current-pointer store, canonical harness-ID resolution, exact affected-structure and
  cheapest-layer checks, bounded provenance-bearing waivers, shared-boundary/negative-
  control enforcement, and immutable delivery-unit-readiness authority. The exact
  contract hash is carried through readiness, creator-scope EpisodePlan provenance,
  delivery binding/claim, Builder evidence, Reviewer verdict and settlement. Six
  executable cases at `tests/hermetic/cf-hb102/validation-contract-authority.test.ts`
  seed omissions, unknown IDs, coverage/layer/control failures, routine C3/floor misuse,
  invalid waivers, stale contract/catalog versions and human-only routing; the updated
  HB-100 detector seeds swapped unit/contract/HEAD evidence and claim-boundary routing.
  The 2026-08-03 owner decision additionally makes exact `manual-review` an independent
  Planner/Builder/whole-unit exclusion, preserves it for human-only removal, and adds
  stale-read plus no-wildcard negative controls. Catalog successors are tighten-only,
  the implemented catalog slice is pinned to its ratified content hash, invalid
  proposals do not poison a version, waiver provenance resolves an exact durable human
  approval, waiver authority/expiry and current roadmap/frontier are rechecked through
  settlement, lifecycle ingestion is strict, and projections prove durable current
  readiness.
  HB-108 closes the deterministic matrix and HB-110 closes the operator surfaces below;
  S-10 references are human-validated; its thresholds, HB-109 live evidence and the
  separately governed HB-111 application state remain pending.
- **HB-103 — COMPLETE 2026-08-03 — Multi-ticket delivery units and one-PR atomicity.** Replace ticket-scoped
  claim/review/merge assumptions with a stable delivery-unit authority containing one or
  more members. Make claim/revalidation all-or-none; bind branch, gates, evidence,
  review, repair allowance, merge and every member projection to one PR/HEAD/outcome;
  preserve the single-ticket case. *Acceptance:* a changed/human-only/already-claimed
  member refuses the whole unit; crashes cannot leave subset claims or closures; one
  ticket cannot appear in two active units. *Defends:* CF-J04-*, CF-INV-005/009/016,
  CF-C-OPLOOP and B-20/B-21 joins. *Layer:* 1/2. *Executor:* build-agent.
  *Depends on:* HB-100/101/102.
  *Implementation:* `src/loop/loop.ts` and `src/loop/driver.ts` now bind the whole
  delivery unit to one worktree, branch, PR, candidate HEAD, gate set, Builder evidence,
  independent Reviewer verdict, repair allowance, merge, and all member projections.
  `tests/hermetic/cf-hb103/delivery-unit-atomic-loop.test.ts` proves multi-member and
  single-ticket compatibility paths and seeds a mid-claim projection failure that must
  roll every member back. Three additional durable-journal cases in the HB-100 walking
  skeleton prove subset pre-provider projection repair, consistent post-provider crash
  settlement, and exact-HEAD merge recovery across all members.
- **HB-104 — COMPLETE 2026-08-03 — ExecutionUnit union, token-free batch admission and lazy plans.** Add
  roadmap-backed code units plus complete direct operational units; hard-before-affinity
  deterministic admission; bounded ordered batch manifests; current-fact reread; lazy
  per-unit EpisodeIntent/EpisodePlan; per-unit journals, budgets and terminal
  dispositions; sibling-isolation recovery. *Acceptance:* grouping constructs no runtime
  or plan, never changes membership/priority/authority, and one failed unit cannot lend
  claim/evidence/budget/completion to another. *Defends:* CF-J20-*, CF-SM-BATCH-*,
  CF-B22-*, CF-C-B22/OPBATCH. *Layer:* 1/2. *Executor:* build-agent.
  *Depends on:* HB-100/101/102/103.
  *Implementation:* `src/org/roadmap-delivery/` owns roadmap-code/direct-operation
  execution-unit authorities, deterministic hard-constraint-first admission, bounded
  manifests, lazy per-unit EpisodePlan creation, and isolated budgets/journals/terminal
  outcomes. `tests/hermetic/cf-hb104/execution-unit-batching.test.ts` proves deterministic
  zero-provider admission and replay, bounded manifests, missing-journal active-membership
  refusal, lazy planning, seeded cross-unit budget-lending refusal, and last-outcome batch-
  disposition crash repair; it also pins the HB-100 v1 batch reader with a seeded broken-
  lineage refusal.
- **HB-105 — COMPLETE 2026-08-03 — Structured zero-turn fast paths and truthful projections.** Implement
  strict normalization for complete creator scope, governed roadmap/workflow/validation
  templates and the low-risk Support/event-discovered code-fix profile. If exposed,
  `planning:preplanned` is only a ref+hash-backed GitHub projection and is reconciled like
  `op:*`; `op:ready`/`op:tier-*` remain non-authoritative. *Acceptance:* complete inputs
  construct zero provider runtimes; detailed prose, label-only state, C3/boundary/schema/
  migration changes and incomplete scopes take the bounded planning/design path or
  refuse—never the shortcut. A future Jira adapter is not implied by this work.
  *Defends:* CF-J03-A/R, CF-S1-env, CF-C-OPPLAN/OPVALIDATION. *Layer:* 1/2.
  *Executor:* build-agent. *Depends on:* HB-101/102.
  *Implementation:* `src/org/roadmap-loop-runtime.ts`, `src/org/ticket-episode-runtime.ts`,
  `src/org/plan-auto.ts`, and the CLI/dispatcher seams consume accepted RoadmapPlan,
  readiness, validation, and batch authority in the actual production loop. Complete
  creator/direct authority with governed provenance-bearing templates normalizes without
  provider turns; detailed prose, missing provenance, labels alone, and whole-unit
  human/manual routing never qualify. Production wiring, initial/successor multi-ticket
  Planner projection, no-op replay, subset-closure refusal, and seeded removed-seam
  negative controls live in `tests/unit/cf-hb103-105/production-wiring.test.ts`.
  The HB-100 walking skeleton additionally proves that an accepted routine template
  reaches the real governed ticket workflow with zero planning turns, while identical
  prose without authority and an accepted custom contract cannot take the shortcut.
- **HB-106 — COMPLETE 2026-08-03 — Direct operational campaign units and exact-effect continuation.** Add
  deterministic intake for complete non-code work, a shallow Marketing campaign template,
  content/evidence manifests, per-destination exact approval items, effect acknowledgements
  and deterministic follow-up observation scheduling. Unknown replies/actions create new
  units when content exists. *Acceptance:* one content turn may draft five Reddit posts,
  LinkedIn and Twitter coherently, but seven payloads remain seven grants/effect outcomes;
  no live post, connector, or B-17 L3 green claim is created. *Defends:* CF-J20-A,
  CF-C-OPBATCH, INV-003/008, B-17/T-12. *Layer:* 1/2; B-17 real target remains blocked.
  *Executor:* build-agent. *Depends on:* HB-104 and existing approval/effect contracts.
  *Implementation:* `src/org/direct-operational-campaign.ts` constructs the accepted
  five-Reddit/one-LinkedIn/one-Twitter authority as one Marketing content turn, seven
  exact approval steps and a deterministic terminal contract gate. Content manifests,
  approval links, executor acknowledgements, evidence projections and observation
  schedules remain per destination; partial approval preparation replays idempotently,
  broadened grants are refused, and unknown interactions construct a new direct unit and
  EpisodePlan. `tests/hermetic/cf-hb106/direct-operational-campaign.test.ts` covers the
  complete local lifecycle with a seeded broadened-grant detector. Its executor evidence
  is fixture-only: no connector, external publication or B-17 L3 action ran.
- **HB-107 — COMPLETE 2026-08-03 — Shared EpisodePlanner façade plus role-safe session/cache reuse.** Converge
  roadmap planning's direct primitive composition and delivery on the common
  `orchestrateEpisode` façade while retaining domain catalogs/validators/prompts/handlers.
  Add stable immutable-prefix/delta manifests, exact app/role/assignment/operation session
  compatibility, per-unit settlement and cache-hit/miss/unknown telemetry. *Acceptance:*
  no schema/authority collapse between RoadmapPlan and delivery EpisodePlan; Reviewer
  never resumes Builder state; cache evidence changes cost telemetry only, never
  correctness/admission. *Defends:* CF-J20-S/I/RC, CF-B22-*, INV-004/006/016.
  *Layer:* 1/2; existing L3 adapter trigger only if invocation semantics change.
  *Executor:* build-agent. *Depends on:* HB-101/104.
  *Implementation:* product planning and ticket planning/delivery now enter
  `orchestrateEpisode`; RoadmapPlan persistence remains a separate domain authority after
  the delivery EpisodePlan. `src/org/execution-affinity.ts` persists ordered immutable-
  prefix/unit-delta manifests and crash-safe per-turn settlements, classifies provider
  cache evidence as hit/miss/unknown, and permits session reuse only across exact app,
  role, atomic assignment, operation, runtime and prefix identity. Cache telemetry is
  absent from the reuse predicate and exposes cost-affinity advice with no correctness
  authority. `tests/hermetic/cf-hb107/session-cache-affinity.test.ts` and
  `tests/unit/cf-hb107/shared-orchestrator-facade.test.ts` seed crash, cache-lure,
  Builder→Reviewer and direct-facade-bypass violations. Ticket provider turns persist
  the manifests/telemetry; no adapter invocation semantics or L3 campaign changed.
- **HB-108 — COMPLETE 2026-08-04 — Complete deterministic catalog and pre-tuning golden integration.** Land
  every 2026-08-03 design-only L1/L2 family with seeded negative controls, plus the
  Planner large-backlog/delta/cache-lure cases and Validation Designer cases in the L4
  runner. Obtain human reference validation separately; never tune prompts before the
  committed corpus and never turn F-PT-010/011 hypotheses into pass/fail thresholds.
  *Acceptance:* policy/registry/catalog closure tests resolve M17/J-20/INV-016/B-20…22/
  C-OP-BATCH/C-OP-VALIDATION/S-10; empty walks and detector-never-fired states fail.
  *Defends:* all revision CF families. *Layer:* 1/2 + 4 data collection.
  *Executor:* human + build-agent. *Depends on:* HB-101…107.
  *Implementation:* `src/org/ratified-validation-catalog.ts` expands and content-pins
  the accepted deterministic registry; `tests/hermetic/cf-hb108/` fails empty walks and
  detector-never-fired families. The L4 runner accepts the committed Planner and
  Validation Designer corpora. Their current references were human-validated by
  `bikramgupta` on 2026-08-04; F-PT-010/011 keep all threshold-dependent results
  inconclusive. No provider/eval campaign ran.
- **HB-109 — MACHINERY COMPLETE 2026-08-04; SEVEN-DAY EVIDENCE PENDING — Batch-aware contention and soak repeat cases.** Extend the existing
  deterministic contention rig with overlapping batches, duplicate unit stimuli,
  all-or-none multi-ticket claims, per-unit settlement and terminal isolation. Extend
  the existing soak collector's inspection schema for batch progress, stale frontiers,
  session reuse and cache-evidence quality. *Acceptance:* no new campaign type; the rig
  proves its seeded violation; the real seven-day repeat remains human-started and
  incomplete until run. *Defends:* CF-OPS-CONT/SOAK revision clauses, B-22.
  *Layer:* 5 (contention rig may remain hermetic; soak is live evidence). *Executor:*
  build-agent for machinery; human + campaign for the seven-day run. *Depends on:*
  HB-103/104/107.
  *Implementation:* `tests/ops/contention-rig.ts` now exercises overlapping direct
  batches, duplicate stimuli, atomic two-ticket claim rollback, per-unit mixed terminal
  settlement, sibling isolation and stale-frontier refusal. `tests/ops/soak-protocol.ts`
  records batch-complete/all-unit-success, stale-frontier, session-reuse, cache-quality
  and recovery-state denominators. The hermetic rig and collector negative controls are
  green; the human-started seven-day campaign remains unrun and incomplete.
- **HB-110 — COMPLETE 2026-08-04 — Operator/explain/report surfaces for roadmap, validation and batches.**
  Add read-only explanations and cross-surface projections that distinguish artifact
  authority from labels, provider-turn fast path from workflow bypass, batch complete
  from every-unit-success, cache unknown from zero, and direct operational readiness
  from code readiness. *Acceptance:* CLI text/JSON/Observe/portable report agree on the
  same fixture; stale/unavailable sources name affected claims and never render green.
  *Defends:* INV-008/016, CF-IF-XSURF and J-03/J-20 observation clauses. *Layer:* 2.
  *Executor:* build-agent. *Depends on:* HB-101…107.
  *Implementation:* `src/org/roadmap-explanation.ts` is the single read-only projection
  consumed by `cormidia status` text/JSON, Observe snapshot/UI, and Reports JSON/
  terminal/portable HTML. `tests/hermetic/cf-hb110/` proves exact projection equality,
  mixed-outcome batch wording, artifact-versus-label authority, fast-path/cache/routing/
  recovery explanations, and degraded-source affected-claim naming.
- **HB-111 — COMPLETE 2026-08-04 — Human-ratified protocol-surface proposal.** Prepare exact, reviewable
  proposed diffs for any needed Planner/Validation Designer role assignment,
  pipelines.yaml ordering, prompts, TASTE or PURPOSE language. Include migration,
  rollback and golden-set impact. *Acceptance:* no protected surface is edited by this
  ticket; implementation tickets remain runnable with current ratified surfaces or stop
  at the precise dependency; a human must separately approve each proposed surface
  change before application. *Defends:* INV-001, M11 and repository working rules.
  *Layer:* process/design. *Executor:* human + build-agent. *Depends on:* HB-100…108
  behavior/schema stabilization.
  *Implementation:* `validation-design/hb-111-protected-surface-proposal.md`
  records the complete exact diff and determines that an independent Planner-assigned
  `validation-design` pass plus Validation Designer/Builder/Reviewer prompt changes are
  needed. It records why roles, plan-pass ordering, TASTE, PURPOSE, and standing AGENTS
  text do not change, and includes the ordinary code dependency, migration, rollback,
  and golden/gate impact. No protected surface was edited; application remains pending
  separate explicit human approval and human merge.
- **HB-112 — PENDING, non-blocking — `manual-feelview` backlog-taxonomy audit.** Inventory
  every use of the exact label, identify its human owner and intended lifecycle, and
  propose keep/rename/retire cleanup without assigning autonomous-scheduling semantics.
  It is not an alias of `manual-review`, does not justify a `manual-*` wildcard, and any
  future scheduling meaning requires a separate product-owner decision plus detectors.
  *Layer:* process/read-only audit. *Executor:* build-agent + human taxonomy decision.
- **HB-113 — COMPLETE 2026-08-04 — RQ-1 manifest, currency, and attestation schemas.** Implement
  closed canonical schemas for candidate/package identity, subject and producer currency,
  evidence-only descendant equivalence, sanitized packets, and release attestations.
  *Layer:* 1/2. *Executor:* build-agent. *Depends on:* RQ-1 ratification.
- **HB-114 — COMPLETE 2026-08-04 — RQ-1 deterministic detector families.** Deposit seeded
  negative controls for forged completeness, stale inputs, changed package bytes,
  path escape, tamper, unlisted skips, missing CI, pending references, uncalibrated
  judges, and publish without attestation. *Layer:* 1/2 + CI. *Executor:* build-agent.
  *Depends on:* HB-113.
- **HB-115 — COMPLETE 2026-08-04 — Paired L4 evidence and human review packet.** Preserve exact
  site/operation/producer/evaluator/rubric pairings, composite grading identity, bootstrap
  versus candidate/baseline arms, and advisory-only uncalibrated results. *Layer:* 1/2 +
  L4 machinery. *Executor:* build-agent; campaigns remain human-authorized. *Depends on:*
  human reference validation and HB-113.
- **HB-116 — COMPLETE 2026-08-04 — Packet sanitizer and operator surfaces.** Add deterministic
  prepare/assess/attest/verify commands and concise disagreement/debt reports without
  raw provider content. *Layer:* 1/2. *Executor:* build-agent. *Depends on:* HB-113…115.
- **HB-117 — COMPLETE 2026-08-04 — Release workflow, prepublish refusal, and B-17 tag path.** Add
  exact-tag offline verification and keep approval, tag, npm publication, and
  acknowledgement as separate facts. F-PT-018 remains an open known limitation;
  F-PT-021 is resolved by authenticated actor/approver/repository equality. *Layer:* 1/2 + CI.
  *Executor:* build-agent + protected human merge. *Depends on:* HB-116.
- **HB-118 — COMPLETE 2026-08-05 — RQ-1 implementation audit and holdout.** Fresh-agent
  I2 review of exact implementation commit `58596de4f03a1bf9ed3c102c904d0a0f6026e2d7`
  closed two independently demonstrated false-green paths: ambient tracked checkout
  bytes and ignored producer/environment bytes. The final assessor executes Vitest in
  a sparse exact-candidate clone, performs a frozen offline dependency install with
  scripts disabled and store integrity enabled, scrubs inherited environment, binds
  the complete executed file/skip inventory, and cleans the isolated checkout. I2
  passed 44 focused tests, the 169-file offline gate (1,089 pass; one policy skip),
  typecheck, build, diff check, exact self-snapshot and exact-head hosted CI. Full
  evidence: `.validation/20260805T102101Z-58596de4f03a/`. *Layer:* audit. *Executor:*
  independent validation auditor. *Depends on:* HB-113…117. Future HB-072/HB-073/L5
  work remains outside RQ-1; separately authorized L3/L4 campaigns qualify each later
  candidate rather than activating the gate.

## Adapter-expansion boundary revision (2026-08-07, #336) — tracked in GitHub, no new HB ids

The B-23…B-26 boundary registration (OpenCode, Cursor, Grok Build, Muse Code) is a
design-only structural addition; its executable authoring is deliberately tracked by
GitHub issues **#337–#340** (one adapter PR each, standalone certification per
docs/harness/adding-updating.md §5) rather than duplicated into HB tickets — two
trackers for one obligation would drift. Standing constraints those PRs inherit:

- Each adapter PR lands its transport double + self-test (L1), wires the shared
  hermetic conformance walk (L2, seeded-liar controls), and adds its CF-B2N-L3
  certification case — implementing the CF-B23…26-* families in case-catalog.md §4.
- Mechanism-level legs stay parked until their finding ratifies: F-PT-025 (B-23
  headless-`ask` bridge), F-PT-026 (B-24 `tool_gate` tier), F-PT-027 (B-25
  permission coverage), F-PT-028 (B-26 swarm seam). Never encode a guess.
- CF-B25-L3 runs only after the recorded #339 human risk-review decision, sandbox
  repos only until it clears real-repo use.
- roles.yaml stays untouched by every adapter PR — assignment is a later
  human ratification plus qualification evidence (certification ≠ qualification).

## Outcome-acceptance lane + jobs (2026-08-07 harness revision) — HB-120…HB-130

Registered by the outcome-acceptance + jobs harness revision. **No runner code was
written in that session, deliberately.** The ordering below is not cosmetic: every
campaign invariant is a mechanical guardrail that lands at L1/L2 *before* anything can
spend a token, because a guardrail protecting a measurement must be cheaper than the
measurement.

**STATUS 2026-08-08 — HB-120…HB-129 COMPLETE, HB-130's RUNNER COMPLETE, RUN 1 NOT
STARTED.** The wave was implemented in the stated order, every detector landing red
against its seeded violation before it went green, and no gate, rubric axis or threshold
was weakened; no numeric threshold was introduced anywhere. HB-130's *runner* exists —
both arms and every grader turn are injected callbacks, so it has spent nothing — and it
is built to the resolved shape: it emits a report and **never** a release signal
(F-PT-029), and a declared `plan_gate` policy resolves the gate unattended under the
unchanged rubric §6 criteria while an undeclared one refuses at preflight (F-PT-030).
**Run 1 itself remains blocked on an exact human authorization naming this campaign's
output-token and equivalent-USD ceilings, and must not be started without it.** One new finding
opened **and ratified the same day**: **F-PT-032** — B-28 §1's four plant categories are
plan-axis instrumentation and a job scenario has no plan arm, so §2 is now scoped to app
scenarios and job scenarios carry their own four (rubric §9). It was escalated rather than
guessed, and S-ACC-3 needed no edit. **No L-ACC cell is blocked.**

- **HB-120 — L-ACC fixture kit + self-tests. DONE 2026-08-08** (`tests/fixtures/acceptance/`; register row CF-HARNESS-ACCFIX). Fixture campaign root, fixture scenario
  repos (greenfield, seeded-corpus, job), a scripted `install:packaged` process double
  with settable exit status, sealed-key fixtures, and a scripted grader adapter double.
  *Acceptance:* every fixture has a self-test; every sweep asserts a non-empty walk;
  the grader double can emit malformed, citation-less, and fabricated-claim payloads on
  demand. *Defends:* harness self-tests (policy `harness_self_tests`). *Layer:* 1/2.
  *Executor:* build-agent.
- **HB-121 — CF-INV-ACC-1 sealed-key confinement. DONE 2026-08-08** (`tests/unit/cf-inv-acc-1/`, `tests/hermetic/cf-inv-acc-1/`; the job-scenario extraction leg opened F-PT-032 and was unparked the same day when the owner ratified per-kind plant lists — rubric §9). All three escape routes: assembly
  scan, reachability walk over the declared read set **including `git log -p`**, and echo
  through report drafts or prior transcripts. Plus extraction ordering, key/scenario
  content-hash binding, and refusal of a partial key missing any of the four plant
  categories. *Acceptance:* lands **red** against a plant deliberately leaked into grader
  input, then green; a working-tree delete that leaves the plant in git history still
  fires. *Defends:* CORMIDIA-INV-ACC-1, CORMIDIA-C-B28-001. *Layer:* 1/2.
  *Executor:* build-agent.
- **HB-122 — CF-INV-ACC-2 grader independence. DONE 2026-08-08** (`tests/unit/cf-inv-acc-2/`, `tests/hermetic/cf-inv-acc-2/`). Per-axis provider disjointness computed
  before provider construction, family (not vendor product) as the unit, applied set
  recorded per axis, and `ungraded` when no legal grader exists. *Acceptance:* red-then-
  green against a grader provider deliberately set equal to the graded turn's; a
  fan-out scenario spanning both families still grades its mechanical axes and reports
  `ungraded` rather than widening. *Defends:* CORMIDIA-INV-ACC-2, CORMIDIA-C-B29-001.
  *Layer:* 1/2. *Executor:* build-agent.
- **HB-123 — CF-INV-ACC-3 repository binding. DONE 2026-08-08** (`tests/hermetic/cf-inv-acc-3/`; the two seeded controls each found a real detector gap — a case-folded origin path and a host-qualified slug — before going green). Reuse `assertCampaignRepositoryBinding`;
  add the campaign-app slug check, the real-origin check, and the job `--workdir` check.
  *Acceptance:* red-then-green against a scenario deliberately bound to this repository.
  *Defends:* CORMIDIA-INV-ACC-3. *Layer:* 1/2. *Executor:* build-agent.
- **HB-124 — CF-INV-ACC-5/6 verdict algebra. DONE 2026-08-08** (`tests/unit/cf-inv-acc-5/`; the table is read from `verdict_semantics.axis_score`, never restated). The `axis_score` truth table as policy
  data, not runner logic: `ungraded` never `0`, never a numeric aggregate term, graded
  denominators named, unratified threshold ⇒ `inconclusive`, and
  killed/ceiling-stopped/missing-grader ⇒ `incomplete` with the scenario still present.
  *Acceptance:* red-then-green against a seeded citation-less score; a fully-`ungraded`
  scenario must not render as a `0`. *Defends:* CORMIDIA-INV-ACC-5/6,
  `validation-policy.yaml` `verdict_semantics.axis_score`. *Layer:* 1. *Executor:*
  build-agent.
- **HB-125 — CF-INV-ACC-7a supervisor non-participation. DONE 2026-08-08** (`tests/hermetic/cf-inv-acc-7a/`). The three-way reconciler:
  campaign-org invocation audit × per-commit authorship in each scenario repo × the run
  journal's turn records; non-closure ⇒ `ungraded`/`incomplete`, never a score.
  *Acceptance:* red-then-green against a hand-authored commit deliberately pushed to a
  scenario repo, and against a product-affecting action with no invocation-audit row.
  *Defends:* CORMIDIA-INV-ACC-7a. *Layer:* 1/2. *Executor:* build-agent.
- **HB-126 — CF-INV-ACC-7b packaged provenance. DONE 2026-08-08** (`tests/hermetic/cf-inv-acc-7b/`; the double is spawned, so every exit status is observed). Assert `install:packaged`'s **exit
  status** and record the installed version plus tarball identity in the report.
  **Do not reimplement its checks** — the script already resolves each declared binary,
  refuses a checkout-internal resolution, and refuses any skill target that is not
  `current`. *Acceptance:* red-then-green against a campaign started with `link:local`
  links present; a bare `--dry-run` non-zero exit must not be readable as a rehearsal
  pass. *Defends:* CORMIDIA-INV-ACC-7b, CORMIDIA-C-B27-001 §1.2. *Layer:* 1/2.
  *Executor:* build-agent.
- **HB-127 — B-27 campaign contract + CF-SM-ACC lifecycle. DONE 2026-08-08** (`tests/unit/cf-b27/`, `tests/unit/cf-sm-acc/`). Every preflight refusal
  class (§1.1–1.9) pre-mutation and pre-spend; report shape incl. matrix, installed
  identity, per-axis citations and applied disjointness sets; lifecycle transitions with
  build-arm entry illegal without a resolved gate. *Acceptance:* each refusal class has
  its own case; a report missing matrix or installed identity is malformed, not thin.
  *Defends:* CORMIDIA-C-B27-001, CORMIDIA-INV-ACC-4. *Layer:* 1/2. *Executor:*
  build-agent.
- **HB-128 — jobs families (M18). DONE 2026-08-08** — the pre-existing suite was re-registered from CF-B23-*/CF-J21-*/CF-J22-* onto CF-B30-*/CF-J22-*/CF-J23-* (B-23 is now OpenCode, J-21 the L-ACC campaign), and CF-SM-JOB-*, CF-IF-JOB and the seeded double-settle control are new (`tests/unit/cf-b30-cfg/`, `tests/hermetic/cf-b30/`, `tests/hermetic/cf-j22-j23/`, `tests/hermetic/cf-sm-job/`, `tests/unit/cf-if-job/`). CF-B30-*, CF-J22-*, CF-J23-*, CF-SM-JOB-*,
  CF-IF-JOB against the existing fixture kit. *Acceptance:* negative controls per the
  jobs design — cyclic config, drifted config hash, a declared output that exists but is
  empty, a lying fake provider reporting `completed` for a step whose check fails, nested
  invocation, and a seeded double-settle. *Defends:* CORMIDIA-C-B30-001…003,
  CORMIDIA-C-OPJOB-001, INV-008/015 jobs tightenings. *Layer:* 1/2. *Executor:*
  build-agent.
- **HB-129 — S-11 grader envelope + the fabrication control. DONE 2026-08-08** (`tests/hermetic/cf-s11-env/`; the required first case is committed at `golden-sets/acceptance-grader/cases.json` and the O-5 detector was verified red against it). Evidence-set composition
  per axis (self-report excluded from O-1…O-3 and the subject of O-5), result schema with
  mandatory citation, and the **seeded fabricated claim** as the first committed case in
  `golden-sets/acceptance-grader/`. *Acceptance:* the O-5 detector lands red against the
  seeded claim before any grader result is trusted; no threshold is introduced.
  *Defends:* CORMIDIA-C-B29-001 §5, llm-eval-plan S-11. *Layer:* 1/2 (+4 scaffold).
  *Executor:* build-agent.
- **HB-130 — the campaign runner and run 1. ORCHESTRATOR DONE 2026-08-08; RUN 1 NOT STARTED** (`tests/campaign/acceptance/runner.ts`, `tests/hermetic/cf-j21/`). **CORRECTION:** this entry previously said the spend authorization was the one remaining blocker. It was not. The runner takes both arms as callbacks and only a test supplied them, so nothing provisioned repos, ran the arms, or called a grader — see HB-131, which built that layer. F-PT-029 and F-PT-030 were both answered
  by the owner on 2026-08-07, so **one blocker remains: an exact human authorization**
  naming this campaign's output-token and equivalent-USD ceilings
  (`risk-allocation.md` §5a). Build the runner to the resolved shape: a declared
  `plan_gate` policy may resolve the gate unattended so a campaign runs end to end,
  applying the ratified rubric §6 criteria and recording the resolution with the scores
  it acted on; a config with no declared policy refuses. The runner emits a report and
  **never** a release signal — L-ACC gates nothing.
  *Acceptance:* HB-120…129 green first; run 1 produces a distribution plus a gap list,
  every threshold-dependent axis `inconclusive`, and the report answers "which bytes did
  this exercise" from the installed version and tarball identity alone.
  *Layer:* L-ACC. *Executor:* human authorization + campaign. *Depends on:* HB-120…129.

## Execution layer (2026-08-08) — HB-131

Opened after a review caught that HB-130 delivered an orchestrator, not a runnable
campaign: `runAcceptanceCampaign` took `planArm`/`buildArm` as callbacks and the only
implementation in the repository was a test using fakes. The status lines that called the
spend authorization "the one remaining blocker" were wrong, and are corrected in place.

- **HB-131 — the L-ACC execution layer. DONE 2026-08-08.** Everything between a config
  and a report:
  - `cli-driver.ts` — the only path from campaign to product. Spawns the PACKAGED
    binaries, refuses one that realpaths inside this checkout, records every invocation.
  - `report-store.ts` — B-27 §3's four durability clauses, which were contract text with
    no implementation: atomic writes, torn-report refusal, resume binding the config
    hash, one report identity per campaign.
  - `seed-corpus.ts` + `acceptance/seeds/` — S-ACC-2's ten staled tutorials and S-ACC-3's
    three research notes, generated from committed manifests so the fixtures are
    deterministic and run 2 stays comparable to run 1. The manifest's `sealed` block is
    answer-key material and is never materialized into a scenario repository.
  - `provision.ts` — seeds each scenario and records a **baseline commit**, which is what
    lets CORMIDIA-INV-ACC-7a exempt the seed without exempting a supervisor commit made
    after onboarding. The reconciler gained that baseline; with no baseline declared,
    nothing is exempt.
  - `arms.ts` — plan/build/job arms through `cormidia plan --auto`, `cormidia loop
    --once` (hard pass bound) and `cormidia-job run`, plus B-29 §1 evidence collection.
    The org's self-report is collected and tagged separately: subject of O-5, evidence
    for nothing.
  - `mechanical-scoring.ts` — the sealed-key comparisons that did not exist: P-1…P-4
    coverage, J-1 declared outputs, J-2 verbatim handoff.
  - `grader-turn.ts` — grading through `cormidia run-role`, so grading is a
    Cormidia-invoked turn rather than a provider SDK call inside the campaign process
    (INV-ACC-7a adversarial seed (d)). Confinement is proven BEFORE construction.
  - `campaign-cli.ts` / `campaign-main.ts` + `acceptance/campaigns/run-1.example.yaml` —
    the entry point and a template that deliberately cannot run: it ships with no
    `authorization:` block and zeroed ceilings, because there is no global L-ACC ceiling
    and a template with plausible numbers would be a ceiling nobody set.

  *Acceptance:* every module lands red against its seeded violation first; the shipped
  template refuses; `pnpm test:acceptance -- --config <path> --dry-run` performs every
  config/authorization/identity preflight and spawns nothing, while `runCampaign`
  repeats the install/world proof before mutation. *Layer:* 1/2. *Executor:* build-agent.

**What run 1 still needs, stated exactly.** An exact human authorization naming the
output-token and equivalent-USD ceilings, AND the operating preconditions the entry point
will not invent: a recorded `pnpm install:packaged --replace-source-links` proof, the
campaign org, its three disposable scenario repositories under the declared campaign org,
and provider credentials.

## Run-1 conformance repair (2026-08-07) — HB-132

- **HB-132 — make HB-131 honest against the real packaged path. DONE 2026-08-07; LIVE
  RUN PENDING AT COMMIT.** The first execution review found defects an all-scripted path
  could not expose: provisioning preceded world preflight; app/job arms and grading were
  not composed with durable checkpoints; the mirror matrix had no scenario-scoped legal
  grader; fixed-mode `run-role` was passed an illegal adaptive flag; `cormidia-job` had
  no command audit; subscription accounting discarded the equivalent cost needed by the
  authorized outer ceiling; and the report did not synthesize every required axis, gap,
  preview command or spend total. The repair adds exact role activation, conservative
  per-invocation admission, equivalent-cost telemetry, job command audit, final
  three-record reconciliation, terminal real-installer tarball proof, authenticated
  non-interactive baseline pushes with exact pre-spend resume, and fail-closed report
  validation. Ceiling exhaustion is
  caught as an incomplete scenario and never truncates into a pass. Product issues and
  run observations are kept in `acceptance/run-1-todo.md`.
  *Detectors:* `tests/unit/cf-b27/`, `tests/hermetic/cf-j21/`,
  `tests/hermetic/cf-s11-env/`, `tests/hermetic/cf-inv-acc-7a/`,
  `tests/unit/cf-b30/`, `tests/unit/cf-auth-mode/`, `tests/unit/cf-s11-mech/`,
  `tests/unit/cf-reg-360/`.
  *No contract loosening:* rubric bytes, axes, plan-gate criterion, golden set,
  thresholds (`NONE`), `release_signal: null` and no-deployment boundary are unchanged.

## Standing rules

(Single source of truth for the detector-deposit obligation:
`validation-policy.yaml` → `case_sourcing:` — this list references it.)
- Every defect fix deposits its detector in the same change.
- Every new detector family lands red-then-green (negative control).
- No ticket weakens a gate or golden set to pass; tighten-only.
