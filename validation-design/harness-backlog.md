# Harness backlog — Operon replacement harness (ticket-shaped)

Status: Phase 8 deliverable. Implementation root: `claude-tests/` (docs v2.9). Every
ticket carries acceptance criteria, the invariant/contract it defends, its layer, and a
named executor. Per skill rule: **expansion gates are scoped per layer** — a missing
live target, an unpassed eval threshold, or unauthorized CI parks only its own layer's
tickets, never L1/L2 implementation. Catalog derivation is already complete
(case-catalog.md); these tickets implement it.

Executors: `build-agent` = the standing coding agent working in the Operon repo under
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

<!-- implementation status 2026-07-31: HB-001..HB-006 LANDED (claude-tests/
walking skeleton; 134 specs green; CI lane wired with pinned fail-closed
gitleaks + canary). HB-007 **COMPLETE 2026-07-31**: owner said "ratify
recommendations"; items 1–8 and 13 are recorded ratified/adjusted-ratified in
validation-policy.yaml. Items 9–12 remain PROPOSED and inconclusive-only.
Defect fixed with deposited detector this wave: S-3 conflicting verdict
markers (src/loop/verdicts.ts extractKeywordValueStrict;
claude-tests/unit/s3-verdict-marker.test.ts). -->


- **HB-001 — Harness root + CI lane.** Create `claude-tests/` structure (unit/,
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
  (a) L1: OPERON-INV-006 exactly-once settlement guardrail test + seeded
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

- **HB-050** Live config + campaign runner with spend accounting (enforces §5 bounds;
  completeness/verdict split). *Gate: none beyond CI merge of L1/L2 skeleton.*
- **HB-051** CF-B02-L3/CF-B03-L3/CF-B04-L3 adapter conformance runs. *Gate: provider
  auth on the operator machine; spend authorization per policy triggers.* Executor:
  campaign (human-initiated per trigger).
- **HB-052** CF-B01-L3 GitHub smoke on sandbox repos. *Gate: sandbox repo access.*
  Executor: campaign.
- **HB-053** CF-J16-A launchd proof. *Gate: operator machine session.* Executor:
  human + build-agent script.
- **HB-054** Unattended sandbox campaign CF-J18-A under the test-mode profile.
  *Gate: the profile surface must first be ratified + implemented in Operon (policy
  `unattended_test_mode_profile`) — a product change, tracked as its own product
  ticket, not a harness ticket.* Executor: campaign.
- **HB-055** B-17 live target: BLOCKED (policy); unblock = disposable `release:`
  target. Executor: campaign (future).

## Wave L4 — eval lane (gated ONLY on golden-set authoring + finding ratification)

- **HB-060** Eval runner v1 (data-collection mode; inconclusive-only reporting;
  per-tuple aggregation; token ceilings; shard rotation). Executor: build-agent.
- **HB-061** Author reviewer/ seeded-defect + clean sets (first-funded; provenance
  rules per scaffold). Executor: human + build-agent. *Note: threshold verdicts stay
  inconclusive until F-PT-009 ratifies — authoring is NOT gated on ratification.*
- **HB-062** Author planner/ sets; **HB-063** builder-trajectory scenario fixtures;
  later scaffolds per elicited priority. Executor: human + build-agent.

## Wave L5 — ops lane (gated per obligation)

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
- **HB-P7** F-PT-018 merge-blocking enforcement (CF-HARNESS-CI). Executor: human +
  build-agent after GitHub required-check controls become available or the owner
  ratifies an enforceable alternative. The PR workflow remains active and
  fail-closed internally, but must not be represented as merge-blocking meanwhile.

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
  exists.
- **HB-081 — Product change (Operon repo, NOT harness): `inconclusive` is not a
  pass on report/observe surfaces.** The product's report/observe surfaces must state
  that an `inconclusive` verdict is not a pass (ratification-package.md §6 IOU,
  converted at ratification). This is a product-side change in the Operon repo,
  tracked here for visibility only — like HB-054's profile dependency, it lands via
  its own product ticket under the product's own rules (including its
  detector-deposit obligation). *Acceptance:* every product surface rendering
  campaign verdicts distinguishes `inconclusive` from `pass` and never renders it
  green or as release evidence. *Defends:* INV-008; eval decision-status rule.
  *Layer:* product. *Executor:* build-agent in the Operon repo (own ticket); human
  schedules.

## Standing rules

(Single source of truth for the detector-deposit obligation:
`validation-policy.yaml` → `case_sourcing:` — this list references it.)
- Every defect fix deposits its detector in the same change.
- Every new detector family lands red-then-green (negative control).
- No ticket weakens a gate or golden set to pass; tighten-only.
