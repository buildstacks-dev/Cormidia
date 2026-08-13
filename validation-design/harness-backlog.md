# Harness backlog — Cormidia replacement harness (ticket-shaped)

> **STATUS FIRST (added 2026-08-10, Phase 8 reader test — new-engineer finding 1):
> most tickets below are ALREADY LANDED.** Before implementing anything, read the
> "Ticket status register" near the bottom of this file and
> `harness-design-state.md`; the machine truth is `case-catalog.yaml`'s tickets
> list. The open work as of 2026-08-10 is: HB-055/072/073/090…094/112 (parked or
> proposed), HB-062's later scaffolds, HB-133…136 and HB-140 (rev-2026-08-10),
> plus the P-tickets still parked on findings. Everything else is a record.
> Naming note: "walking skeleton" names TWO landed things in this file — Wave 0's
> harness skeleton (HB-001…007) and HB-100's provider-free product-slice vertical
> skeleton; neither is open work. <!-- changelog 2026-08-10 (reader test 3,
> new-engineer finding 2) -->

Status: Phase 8 deliverable. Implementation root: `tests/` (docs v2.9). Every
ticket carries acceptance criteria, the invariant/contract it defends, its layer, and a
named executor. Per skill rule: **expansion gates are scoped per layer** — a missing
live target, an unpassed eval threshold, or unauthorized CI parks only its own layer's
tickets, never L1/L2 implementation — **except where a ticket names a cross-layer
dependency inline** (HB-054's product-surface prerequisite, HB-081's and HB-135's
product-repo halves); an unnamed cross-layer gate remains a design defect.
<!-- changelog 2026-08-10 (reader test 9, new-engineer finding 3): the rule read as
absolute; its three named exceptions are now acknowledged at the rule itself. -->
This exception list is a hand-maintained sentence with no enforcing lint: **any
new ticket that introduces a cross-layer dependency MUST add itself to this
sentence in the same change, and omitting that is itself the named design
defect** — auditable via the routing doc's case-insensitive blocked-work grep,
which surfaces every `Gate:` marker for comparison against this list. One
ticket sits outside this rule's vocabulary entirely <!-- changelog 2026-08-10
(reader test 30, new-engineer finding 5): HB-134 is not cross-layer-gated — it
has NO fixed layer until an external trigger fires, a different shape than the
three exceptions, and the Gate: grep would not surface it -->: HB-134
(triggered, no-layer-until-fired, disclosed at the ticket; kept non-bold here
because the machine catalog assigns ticket ownership by first bold mention) —
it is named here
so the exception audit sees it, not because it gates across layers.
<!-- changelog 2026-08-10 (reader test 19, new-engineer finding 8): the rule was
accurate but unenforced; now self-defending with the audit path named. -->
Catalog derivation is already complete
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

**Convention (Waves 1–4) — easy to miss on a fast read, so stated in bold:**
tickets in these waves **inherit *Layer* and risk from their wave heading** (each
Wave 1–4 heading names its layer, e.g. "exhaustive; L1/L2") and *defend* the
invariants/contracts named by their case-family IDs (resolve via case-catalog.md).
Wave 0 states Layer inline (its tickets cross layers); the L3/L4/L5 wave tickets
carry `*Gate:*`/`*Executor:*` fields and inherit their layer from the wave heading,
same as Waves 1–4. <!-- changelog 2026-08-10 (reader test 4, new-engineer
finding 5): emphasis added; reader test 5 (new-engineer finding 1) corrected this
sentence itself — it previously claimed L3/L4/L5 tickets state Layer inline, which
the file's own formatting contradicts. -->

## Wave 0 — Walking skeleton (before mass case implementation)

> **LANDED — historical spec.** Everything in this wave shipped 2026-07-31
> (see the STATUS-FIRST banner and the Ticket status register). Do NOT
> implement from this section; it is retained as the record of what was built
> and why. <!-- changelog 2026-08-10 (reader test 22, new-engineer finding 1):
> the banner warning was prose-only; a reader opening straight to this heading
> had no structural stop. -->

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
  self-tests green; empty-walk fails. *Defends:* rule 17 (= the harness-is-itself-tested rule; text at validation-policy.yaml → harness_self_tests). *Families:* CF-B06-*,
  CF-C-B06 (the injected-clock fixture is where the clock-boundary families landed).
  *Layer:* 2. *Executor:* build-agent.
- **HB-003 — GitHub double v1 + conformance-pair scaffold.** Scripted fake per
  boundary-map B-01 (state machine, per-call failure scripts, lost-response mode,
  configurable default branch). Conformance suite structured to run against fake now
  and real later (CF-B01-L3). *Acceptance:* fake passes its own contract suite; one
  scripted failure mode (lost response) demonstrably reproducible; negative control:
  a deliberately lying fake variant fails the suite. *Defends:* B-01, INV-008/009.
  *Families:* also CF-C-B01 (the contract family the double asserts).
  *Layer:* 2. *Executor:* build-agent.
- **HB-004 — Adapter double v1 (one adapter first: Claude).** Mocked runtime per
  provider-adapter-core + B-02 scripts. *Acceptance:* core contract clauses assert
  against it; usage-absent renders unknown (INV-006 seed red-then-green).
  *Families:* also CF-C-B02. *Layer:* 1–2. *Executor:* build-agent.
- **HB-005 — Skeleton test per layer (one each, with negative controls).**
  (a) L1: CORMIDIA-INV-006 exactly-once settlement guardrail test + seeded
  double-settle violation (red-then-green). (b) L2: one composition test — dispatch
  tick → claim → scripted adapter turn → settlement on the fixture kit, including one
  boundary failure mode (kill between provider return and ledger append). (c) journey
  test: CF-J04-S reduced walk (ready→PR on fake GitHub). (d) LLM contract test: S-3
  verdict-marker parser refusal (zero markers, or two DISTINCT conflicting
  markers — duplicate identical markers deliberately parse in production;
  refusal scope now tracked by **F-PT-033**. The landed test records that
  implementation behavior — duplicate-identical parse, keyword precedence — as
  pinned regression facts conferring no ratification; no NEW test may encode
  either reading as contract truth until F-PT-033 ratifies <!-- changelog
  2026-08-10 (final-gate follow-up 10): "zero/two" here did not match the
  parser's documented duplicate-identical tolerance; corrected same day
  (follow-up 11): the landed test DOES pin the lenient behavior, so
  "asserts only both-readings-valid refusals" was literally false -->. **Net,
  in one sentence** <!-- changelog 2026-08-10 (reader test 42, new-engineer
  finding 3): after two corrections this clause was still hard to execute from
  the ticket alone -->: assert zero-marker refusal and distinct-conflict
  refusal as contract truth; assert NOTHING about duplicate-identical markers —
  the landed test's duplicate-identical assertions are pinned regression facts
  you must not extend or imitate until F-PT-033 ratifies) — the
  falsifying-test shape is
  invariants.md INV-012's "APPROVE-prose without marker" seeds; the catalog's S-3
  envelope cell (§7) dup-prunes into the INV-009/012 clause families, which is why
  no separate catalog row exists (co-location pointer added 2026-08-10, reader-test
  new-engineer finding 4). *Acceptance:* each test paired
  with its seeded-violation negative control; all green in the HB-001 lane.
  *Defends:* INV-005/006/008/012; C-OP-LOOP. *Layer:* 1–2. *Executor:* build-agent.
- **HB-006 — Policy loader + artifact-location pin.** Test that validation-policy.yaml
  parses, artifact paths resolve, and the layer/trigger blocks match CI config
  (drift = red). *Acceptance:* moving an artifact without updating policy fails.
  *Defends:* rule 17 (harness self-tests — validation-policy.yaml → harness_self_tests); policy-as-data. *Layer:* 1. *Executor:* build-agent.
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


- **HB-010** Gate classifier adversarial suite (CF-INV-002 seeds incl. obfuscation
  and unknown-tool fail-closed). Executor: build-agent.
- **HB-011** Approval store + grant lifecycle state machines (CF-SM-APPR-*,
  CF-SM-GRANT-*, both grant shapes; orphan-grant intermediate; CF-INV-003,
  CF-B09b-*, CF-C-B09B decision-entry families). Executor: build-agent.
- **HB-012** Continuation/resume fingerprint suite (CF-J06-*, CF-B09a-*, CF-C-B09A;
  F-PT-008 clause parked). Executor: build-agent.
- **HB-013** Typed executor + marker typing (CF-B17-*, CF-C-B17, CF-J05-*, CF-J17-*;
  B-17 live remainder stays BLOCKED). Executor: build-agent.
- **HB-014** Authority resolution + org-identity suite (CF-B10-*, CF-C-B10,
  CF-INV-001 seeds, CF-INV-004 app-isolation facets, B-10a identity classes).
  Executor: build-agent.
- **HB-015** Destructive lifecycle containment (CF-J01-*, CF-J14-*, CF-C-OPLIFE,
  CF-INV-010; sibling-diff oracle; temp-FS/git fault injection only). Executor:
  build-agent.
- **HB-016** Secret confinement egress suite (CF-INV-011 seeds; single-policy
  structural check). Executor: build-agent.
- **HB-017** Learning activation boundary (CF-J12-*, CF-SM-LEARN-*, CF-C-B11, B-11
  publisher forward-completion). Executor: build-agent.

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
  **HB-022** Admission/pause (CF-J07-*, CF-INV-007; the former
  F-PT-003 block lifted 2026-07-31 — convergence cases land via HB-P1, unparked
  below). **HB-023** Crash-point sweeps (CF-J04-I, CF-SM-TURN-*,
  CF-B07-*, CF-C-B07 harness; F-PT-004 line ratified 2026-07-31:
  preserve-and-inspect — ambiguous-byte cases land via HB-P2, unparked below).
  **HB-024** Adapter enforcement slices T-11 (budget observation per capability
  matrix; session binding; remaining adapter doubles Codex + pi incl. rotation
  scripts and extension-absence; CF-C-B03, CF-C-B04 contract families).
  **HB-025** FS/git substrate faults (CF-B15-*).
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

- **HB-030** Merge boundary suite (CF-INV-009, CF-INV-012; HEAD equality; resolved
  default). **HB-031** Loop legal/illegal/replay state machine + labels-after-artifacts
  (CF-SM-LOOP-L, CF-SM-LOOP-I, CF-SM-LOOP-R, CF-J04-S, CF-J04-R).
  **HB-032** Evidence truthfulness sweep across readers (CF-INV-008, CF-J15-*, the
  J-07/J-08/J-02 agreement legs (owned at their home tickets HB-022/HB-020/HB-042),
  CF-B12-*, CF-C-B12 incl. capability/traversal). **HB-033** Cross-surface
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

- **HB-040** Event inbox (CF-B13-*, CF-C-B13, CF-J10-*, CF-SM-EVENT-*; F-PT-006
  clauses parked). **HB-041** Planner validator + planning ops (CF-J03-*,
  C-OP-PLAN). **HB-042** Onboarding ladder + lifecycle records
  (CF-J02-*, CF-SM-LADDER-L, CF-SM-LADDER-I). **HB-043** Scheduler lifecycle
  hermetic (CF-J16-S, CF-J16-R, CF-J16-I, CF-B05-*, CF-C-B05). **HB-044** Retention GROW suite
  (CF-OPS-GROW, seeded aged state). **HB-045** Presentation smokes (thin, per
  risk-allocation §4).
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
  completeness/verdict split; the durable-report family CF-HARNESS-REPORT).
  *Gate: none beyond CI merge of L1/L2 skeleton.*
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
- **HB-054** Unattended sandbox campaign CF-J18-A under the test-mode profile. Its
  deterministic hermetic composite prerequisite is now pending on HB-144 rather than
  claimed by this landed live-campaign ticket.
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
  rules per scaffold; CF-S3-qual, CF-S3-judge). Executor: human + build-agent.
  *Note: threshold verdicts stay inconclusive until F-PT-009 ratifies — authoring is
  NOT gated on ratification.*
- **HB-062** Author planner/ sets (CF-S1-qual) and the later scaffolds per elicited
  priority — CF-S2-qual, CF-S4-qual, CF-S5-qual, CF-S6-qual, CF-S7-judge,
  CF-S7-qual, the S-11 meta-eval halves CF-S11-qual, CF-S11-judge (timing governed
  by the ratified rubric §5 deferral), and the CF-COND sampling design (open under
  F-PT-011); **HB-063** builder-trajectory scenario fixtures.
  Executor: human + build-agent.
  <!-- changelog 2026-08-10 (rev-2026-08-10 status honesty): HB-062 is recorded
  NOT-LANDED (status pending in case-catalog.yaml) — its planner-sets half is
  complete (see the wave status comment above), but the "later scaffolds" half
  (SRE, learning-reviewer, support, marketing, distiller) remains open, and the
  S-11 grader meta-eval also rides HB-062 for traceability with its TIMING governed
  by the ratified rubric §5 deferral, not by this ticket. HB-063 is complete. -->

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
  window.* Executor: human + campaign. **HB-072** Threat model document. *Executor:*
  human (author + reviewer); due per policy. *Acceptance:* the ten-surface scope,
  timing triggers and review rule in risk-allocation.md §6, authored over
  threat-model-template.md; admission is hash-bound via threat-model-status.yaml
  (the gate refuses the checked-in awaiting_human_author status). *Defends:* the L5
  abuse-lane precondition and the T-1/T-2/T-4/T-12 adversarial assurance the interim
  floor invariants only partially cover. <!-- changelog 2026-08-10 (reader test 3,
  new-engineer finding 4): normalized from "*Owner:*" to the uniform Executor field;
  reader test 5 (new-engineer finding 3): Acceptance/Defends pointers added — the
  scope existed but was only reachable by cross-reading three files. -->
  **HB-073** Abuse lane cases (CF-OPS-ABUSE). *Gate: HB-072.* *Executor:* build-agent,
  after HB-072.

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

<!-- changelog 2026-08-12 (owner rulings, attributable decision cited in the landing
PR body): HB-P3, HB-P5 and HB-P6 are UNBLOCKED — F-PT-006, F-PT-008 and F-PT-017 are
resolved-ratified in validation-policy.yaml. Their ruling text is recorded on each
ticket below so the ticket is implementable from this file plus the policy alone.
HB-P7 stays PARKED: the branch-protection re-check on 2026-08-12 still returned HTTP
403 "Upgrade to GitHub Pro or make this repository public". This section keeps its
heading because HB-P7 is still parked in it. -->


<!-- changelog 2026-08-10 (reader test 6, new-engineer finding 3): the four parked
tickets below previously named only executors, breaking the every-ticket-carries-
Layer/Acceptance/Defends rule for exactly the tickets most likely to be picked up
cold; fields added. Family ids stay in prose (B-NN/F-PT form) because these cells
are parked — the CF rows exist in case-catalog.md marked BLOCKED. -->
- **HB-P3 — LANDED 2026-08-12 (unblocked the same day)** F-PT-006 producer-protocol + duplicate-identity
  cases. *Layer:* 2. *Defends:* the B-13 inbox contract's producer-visibility and
  duplicate-identity clauses (formerly parked cells in the J-10/SM-EVENT/B-13
  families). *Acceptance:* the ratified protocol encoded red-then-green, whichever
  way the owner decides — never both readings. *Executor:* build-agent, after human
  ratifies the finding. **Ruling (owner, 2026-08-12):** exactly ONE firing per
  real-world event; duplicate deliveries collapse to one. Dedup identity is
  **content-derived** — `sha256` over the canonical sorted-key serialization of the
  producer's payload — never the delivery filename, never a producer-supplied id.
  Producers owe **no atomicity**: a partial file fails parse, is retained as
  `malformed_company_event`, and fires once under its content identity when complete.
  Same-identity-two-payloads becomes vacuous (differing payloads are different
  events). Migration: a legacy filename entry in `consumed.json` still suppresses its
  own file. The negative control seeds a duplicate delivery and a legacy-key replay.
- **HB-P5 — LANDED 2026-08-12 (unblocked the same day)** F-PT-008 expiry-disposition cases. *Layer:* 2.
  *Defends:* the B-09a continuation contract's TTL-expiry item-disposition clause.
  *Acceptance:* the ratified disposition (fresh item / reopen / explicit operation)
  encoded with a seeded wrong-disposition control. *Executor:* build-agent, after
  human ratifies. **Ruling (owner, 2026-08-12):** expiry **REOPENS the original
  item** — original id, decision history intact, appended log transition (B-09b
  immutability holds); never a silent fresh item, never a dropped operation. The TTL
  is **policy configuration wired to org config**, never a source constant (F-PT-020
  precedent). Grant default 24h → **48h**; the undecided-item (pending) TTL default is
  **pinned at 24h** and no longer inherits the grant default, because inheriting would
  have doubled F-PT-020's ratified bound as a side effect. Seeded controls: a
  fresh-item disposition and a dropped-operation disposition must both fail, and a 48h
  grant default must NOT move the pending bound.
- **HB-P6 — LANDED 2026-08-12 (unblocked the same day)** F-PT-017 provider terminal-status enum decision and
  migration cases (CF-C-CORE). *Layer:* 1/2. *Defends:* the core contract's
  terminal-status enum clause. *Acceptance:* the chosen vocabulary asserted across
  every adapter plus a migration-compatibility case; no test may derive truth from the
  current code. *Executor:* human + build-agent after the owner chooses. **Ruling
  (owner, 2026-08-12):** the terminal status is **`interrupted`**, carrying a
  **required** machine-readable reason ∈ {`time_limit`, `operator_kill`,
  `provider_crash`}. No structural change was needed — the reason is a clause
  tightening on an existing contract. Migration: durable `timed_out` records stay
  readable and project as `interrupted` + `time_limit`. Scope fence: the existing
  `tests/unit/s3-verdict-marker.test.ts` pins confer no ratification, and **F-PT-033
  must not be touched by this ticket**.
- **HB-P7** F-PT-018 mechanical merge-blocking enforcement (CF-HARNESS-CI), retained
  as a known limitation/future improvement. *Layer:* 1 + CI. *Defends:* the
  per-commit gate's merge-blocking claim (currently bounded by protected human
  merge + release-blocking exact-tag rerun, honestly disclaimed). *Acceptance:*
  a required-check configuration proven blocking by a seeded red PR. *Executor:*
  human + build-agent after GitHub required-check controls become available. The PR
  workflow remains active and fail-closed internally; RQ-1 does not claim
  mechanical merge blocking. <!-- changelog 2026-08-12: re-checked at the owner's
  request. `gh api repos/cormidia/Cormidia/rulesets` and
  `gh api repos/cormidia/Cormidia/branches/main/protection` both return HTTP 403
  "Upgrade to GitHub Pro or make this repository public to enable this feature".
  STILL PARKED — no required check was configured, no seeded red PR was run, and
  F-PT-018 keeps its 2026-08-04 known-limitation disposition. -->
  **Re-checked 2026-08-12: still unavailable (HTTP 403, plan unchanged).**

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
  Land CF-J19-S, CF-J19-R, CF-J19-I, CF-J19-RC, CF-SM-COMP-*, CF-B18-*, CF-B19-*, CF-C-B18, CF-C-B19, and
  detector negative controls. *Acceptance:* no candidate outward effect; no sibling leakage;
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
  integration (CF-S8-env, CF-S8-qual, CF-S8-judge). Authoring/data collection may proceed, but **automatic judge selection
  remains BLOCKED:F-PT-011** and all threshold-dependent outcomes remain inconclusive
  until the owner ratifies S-8 calibration thresholds and sampling design. A unique
  mechanically eligible candidate and declared non-judge fallbacks remain separately
  governed. *Layer:* 1/2 envelope + 4 quality. *Executor:* human + build-agent.
- **HB-094 — Planner activation, sampling, and optional parallelism.** After HB-090…093,
  allow planner-proposed comparisons inside app policy; then separately design sticky
  Cormidia-owned sampling and governed aggregate learning. Parallel candidates are last.
  *Gate:* sampling or parallelism re-enters risk allocation and may activate
  CF-OPS-COMP at L5 — **a forward CONSEQUENCE of doing this work, not a
  cross-layer precondition on starting it** (this ticket does not belong on the
  cross-layer exception sentence <!-- changelog 2026-08-10 (reader test 40,
  new-engineer finding 4): the Gate phrasing read ambiguously as a possible
  unlisted cross-layer gate -->); no single comparison mutates
  routing/qualification policy.
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
  *Defends:* CF-J03/J04 2026-08-03 slices, CF-J20-S, CF-INV-016, the B-20/B-21/B-22 happy
  joins. *Layer:* 1/2. *Executor:* build-agent. *Depends on:* accepted Phase 8 package
  and #239.
  *Implementation:* `src/org/roadmap-delivery/` plus
  `tests/hermetic/cf-hb100/roadmap-delivery-walking-skeleton.test.ts`. The five
  executable cases prove the two-ticket provider-free join, one durable all-member
  claim under a race, persistence-before-projection, label-without-artifact refusal,
  whole-unit human-only exclusion at admission and claim, exact unit/contract/HEAD
  negative controls, and verdict-bound settlement. This is walking-skeleton coverage
  only; HB-108/HB-110 and HB-109 machinery are complete below and HB-111 was applied
  2026-08-04 (#266) <!-- changelog 2026-08-10: was "HB-111 remain required" — stale -->,
  while the HB-109 seven-day evidence remains required before autonomous-loop readiness.
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
  CF-C-B21, CF-C-OPVALIDATION, CF-S10-env. *Layer:* 1/2. *Executor:* build-agent.
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
  S-10 references are human-validated; the HB-111 application state landed 2026-08-04
  (#266) <!-- changelog 2026-08-10: was "…HB-111 application state remain pending" —
  stale -->; its thresholds and HB-109 live evidence remain pending.
- **HB-103 — COMPLETE 2026-08-03 — Multi-ticket delivery units and one-PR atomicity.** Replace ticket-scoped
  claim/review/merge assumptions with a stable delivery-unit authority containing one or
  more members. Make claim/revalidation all-or-none; bind branch, gates, evidence,
  review, repair allowance, merge and every member projection to one PR/HEAD/outcome;
  preserve the single-ticket case. *Acceptance:* a changed/human-only/already-claimed
  member refuses the whole unit; crashes cannot leave subset claims or closures; one
  ticket cannot appear in two active units. *Defends:* CF-J04-*, CF-INV-005, CF-INV-009, CF-INV-016,
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
  CF-B22-*, CF-C-B22, CF-C-OPBATCH. *Layer:* 1/2. *Executor:* build-agent.
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
  *Defends:* CF-J03-A, CF-J03-R, CF-C-OPPLAN, CF-C-OPVALIDATION. *Layer:* 1/2.
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
  correctness/admission. *Defends:* CF-J20-S, CF-J20-I, CF-J20-RC, CF-B22-*, INV-004/006/016.
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
  *Families:* CF-S10-qual rides here (the pre-tuning Validation Designer corpus).
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
  incomplete until run. *Defends:* CF-OPS-CONT and CF-OPS-SOAK revision clauses, B-22.
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
- **HB-112 — CLOSED 2026-08-12 by owner correction — `manual-feelview` backlog-taxonomy
  audit.** <!-- changelog 2026-08-12: closed by an attributable owner correction, not by
  the agent's own taxonomy judgement. The ticket's whole premise — that the label might
  carry an independent meaning needing a keep/rename/retire proposal — was wrong: the
  owner states `manual-feelview` was a TYPO of `manual-review`, i.e. it always meant
  exactly "the Cormidia planner must ignore the labeled item" and never a second
  taxonomy. The audit's acceptance (inventory + one proposal per occurrence + zero
  semantics changes) is discharged by the correction itself: the inventory was taken,
  and the single disposition is RENAME-TO-`manual-review`, decided by the human. --> The
  complete 2026-08-12 inventory of the exact string: 8 GitHub issues (#196, #197 — both
  already carrying exact `manual-review`; and #369, #370, #371, #373, #374, #375 — all
  CLOSED), the repository label itself, three corpus mentions
  (`validation-policy.yaml` line 55, `autonomous-routing-audit-2026-08-04.md`,
  `owner-backlog.md`), two product docs (`docs/DEVELOPMENT.md`, `docs/loop/design.md`),
  one catalog row (the exact-`manual-review` regression family's no-wildcard negative
  control — deliberately NOT named by id here, so this closure note cannot steal that
  family's ownership from HB-139 in the generated catalog), one test
  (`tests/hermetic/cf-hb102-manual-review-cf-reg-239/`), and the frozen `.validation/`
  audit run (never edited). Applied: the six open/closed issues without it gained exact
  `manual-review`, the label was deleted from the repository, and the taxonomy docs now
  record the typo rather than a second label. **Deliberately unchanged:** the
  no-wildcard rule and its negative control — `manual-*` is still not a wildcard, and
  the test keeps using the retired string as its non-matching control, which is exactly
  what a retired typo is good for. Zero scheduling semantics changed. *Layer:*
  process/read-only audit + label hygiene. *Defends:* the backlog taxonomy itself —
  corpus hygiene. *Executor:* build-agent + human taxonomy decision (**decision given
  2026-08-12**). Original ticket text follows.
- **HB-112 (original) — PENDING, non-blocking — `manual-feelview` backlog-taxonomy audit.** Inventory
  every use of the exact label, identify its human owner and intended lifecycle, and
  propose keep/rename/retire cleanup without assigning autonomous-scheduling semantics.
  It is not an alias of `manual-review`, does not justify a `manual-*` wildcard, and any
  future scheduling meaning requires a separate product-owner decision plus detectors.
  <!-- SUPERSEDED 2026-08-12: "It is not an alias of `manual-review`" was the correct
  fail-closed posture while the label's meaning was unknown, and is now factually wrong
  — the owner states it was a typo OF `manual-review`. Preserved verbatim as the
  ticket's original text; read the CLOSED entry above for current truth. The
  no-wildcard clause is NOT superseded and still holds. -->
  *Acceptance:* a written inventory covering every occurrence of the exact label,
  each with owner and lifecycle; one keep/rename/retire proposal per occurrence
  presented to the human; zero scheduling-semantics changes made by this ticket.
  <!-- changelog 2026-08-10 (reader test 12, new-engineer finding 4): the one
  ticket without an Acceptance field now carries one. -->
  *Layer:* process/read-only audit. *Defends:* the backlog taxonomy itself —
  corpus hygiene, no product invariant or contract (an audit-only ticket; its
  output is a proposal to the human, never a semantics change) <!-- changelog
  2026-08-10 (reader test 25, new-engineer finding 4): the Defends field was
  missing; stated honestly as corpus-integrity rather than inventing a product
  surface -->. *Executor:* build-agent + human taxonomy decision.
- **HB-113 — COMPLETE 2026-08-04 — RQ-1 manifest, currency, and attestation schemas.** Implement
  closed canonical schemas for candidate/package identity, subject and producer currency,
  evidence-only descendant equivalence, sanitized packets, and release attestations.
  *Families:* CF-HARNESS-RQ, CF-HARNESS-CURRENCY. *Layer:* 1/2. *Executor:*
  build-agent. *Depends on:* RQ-1 ratification.
- **HB-114 — COMPLETE 2026-08-04 — RQ-1 deterministic detector families.** Deposit seeded
  negative controls for forged completeness, stale inputs, changed package bytes,
  path escape, tamper, unlisted skips, missing CI, pending references, uncalibrated
  judges, and publish without attestation. *Layer:* 1/2 + CI. *Executor:* build-agent.
  *Depends on:* HB-113.
- **HB-115 — COMPLETE 2026-08-04 — Paired L4 evidence and human review packet.** Preserve exact
  site/operation/producer/evaluator/rubric pairings, composite grading identity, bootstrap
  versus candidate/baseline arms, and advisory-only uncalibrated results. *Families:*
  CF-HARNESS-JUDGE. *Layer:* 1/2 + L4 machinery. *Executor:* build-agent; campaigns
  remain human-authorized. *Depends on:* human reference validation and HB-113.
- **HB-116 — COMPLETE 2026-08-04 — Packet sanitizer and operator surfaces.** Add deterministic
  prepare/assess/attest/verify commands and concise disagreement/debt reports without
  raw provider content. *Families:* CF-HARNESS-ATTEST. *Layer:* 1/2. *Executor:*
  build-agent. *Depends on:* HB-113…115.
- **HB-117 — COMPLETE 2026-08-04 — Release workflow, prepublish refusal, and B-17 tag path.** Add
  exact-tag offline verification and keep approval, tag, npm publication, and
  acknowledgement as separate facts. F-PT-018 remains an open known limitation;
  F-PT-021 is resolved by authenticated actor/approver/repository equality.
  *Families:* CF-HARNESS-RELEASE. *Layer:* 1/2 + CI.
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
- ~~Mechanism-level legs stay parked until their finding ratifies~~ **RESOLVED
  2026-08-07, all four** <!-- changelog 2026-08-10 (consistency sweep): the parking
  sentence was stale — every one of F-PT-025…028 resolved the same day the adapters
  landed -->: F-PT-025 (B-23) resolved-ratified — deny-by-default shaping +
  `tool.execute.before` sole enforcement, legs unparked in #337; F-PT-026 (B-24)
  resolved-by-certification — `preToolUse` fires headless and enforces, legs unparked
  in #338; F-PT-027 (B-25) resolved-by-evidence — PreToolUse hook is the gate, ACP a
  backstop, certified live in sandbox repos; F-PT-028 (B-26) resolved-by-evidence —
  no seam exists on 0.1.0-R708.1, fail-closed fallback is the implemented behaviour,
  swarm-gate legs remain scripted-only evidence and CF-B26-L3 reports incomplete,
  never pass.
- CF-B25-L3 executed 2026-08-07 in throwaway sandbox repos (violations empty).
  **Real-repo use stays blocked on #339's OPEN human risk review** — certification
  proves the adapter, never the vendor.
- roles.yaml stays untouched by every adapter PR — assignment is a later
  human ratification plus qualification evidence (certification ≠ qualification).

## Outcome-acceptance lane + jobs (2026-08-07 harness revision) — HB-120…HB-130

Registered by the outcome-acceptance + jobs harness revision. **No runner code was
written in that session, deliberately.** The ordering below is not cosmetic: every
campaign invariant is a mechanical guardrail that lands at L1/L2 *before* anything can
spend a token, because a guardrail protecting a measurement must be cheaper than the
measurement.

**STATUS 2026-08-08 — HB-120…HB-132 COMPLETE; RUN 1 TERMINAL AT THE PLAN GATE.**
The wave was implemented in the stated order, every detector landing red
against its seeded violation before it went green, and no gate, rubric axis or threshold
was weakened; no numeric threshold was introduced anywhere. HB-130's *runner* exists —
both arms and every grader turn are injected callbacks, so it has spent nothing — and it
is built to the resolved shape: it emits a report and **never** a release signal
(F-PT-029), and a declared `plan_gate` policy resolves the gate unattended under the
unchanged rubric §6 criteria while an undeclared one refuses at preflight (F-PT-030).
Run 1 later satisfied its exact authorization and operating preconditions, exercised
the packaged path, and stopped under the unchanged rubric §6 gate. Its report is
entirely ungraded/inconclusive and all scenarios incomplete
(`acceptance/run-1-result.md`). One new finding
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
  fires. *Defends:* CORMIDIA-INV-ACC-1, CORMIDIA-C-B28-001. *Families:*
  CF-INV-ACC-1, CF-B28-*, CF-C-B28. *Layer:* 1/2. *Executor:* build-agent.
- **HB-122 — CF-INV-ACC-2 grader independence. DONE 2026-08-08** (`tests/unit/cf-inv-acc-2/`, `tests/hermetic/cf-inv-acc-2/`). Per-axis provider disjointness computed
  before provider construction, family (not vendor product) as the unit, applied set
  recorded per axis, and `ungraded` when no legal grader exists. *Acceptance:* red-then-
  green against a grader provider deliberately set equal to the graded turn's; a
  fan-out scenario spanning both families still grades its mechanical axes and reports
  `ungraded` rather than widening. *Defends:* CORMIDIA-INV-ACC-2, CORMIDIA-C-B29-001.
  *Families:* CF-INV-ACC-2, CF-B29-*, CF-C-B29. *Layer:* 1/2. *Executor:* build-agent.
- **HB-123 — CF-INV-ACC-3 repository binding. DONE 2026-08-08** (`tests/hermetic/cf-inv-acc-3/`; the two seeded controls each found a real detector gap — a case-folded origin path and a host-qualified slug — before going green). Reuse `assertCampaignRepositoryBinding`;
  add the campaign-app slug check, the real-origin check, and the job `--workdir` check.
  *Acceptance:* red-then-green against a scenario deliberately bound to this repository.
  *Defends:* CORMIDIA-INV-ACC-3. *Families:* CF-INV-ACC-3. *Layer:* 1/2.
  *Executor:* build-agent.
- **HB-124 — CF-INV-ACC-5/6 verdict algebra. DONE 2026-08-08** (`tests/unit/cf-inv-acc-5/`; the table is read from `verdict_semantics.axis_score`, never restated). The `axis_score` truth table as policy
  data, not runner logic: `ungraded` never `0`, never a numeric aggregate term, graded
  denominators named, unratified threshold ⇒ `inconclusive`, and
  killed/ceiling-stopped/missing-grader ⇒ `incomplete` with the scenario still present.
  *Acceptance:* red-then-green against a seeded citation-less score; a fully-`ungraded`
  scenario must not render as a `0`. *Defends:* CORMIDIA-INV-ACC-5/6,
  `validation-policy.yaml` `verdict_semantics.axis_score`. *Families:* CF-INV-ACC-5,
  CF-INV-ACC-6. *Layer:* 1. *Executor:* build-agent.
- **HB-125 — CF-INV-ACC-7a supervisor non-participation. DONE 2026-08-08** (`tests/hermetic/cf-inv-acc-7a/`). The three-way reconciler:
  campaign-org invocation audit × per-commit authorship in each scenario repo × the run
  journal's turn records; non-closure ⇒ `ungraded`/`incomplete`, never a score.
  *Acceptance:* red-then-green against a hand-authored commit deliberately pushed to a
  scenario repo, and against a product-affecting action with no invocation-audit row.
  *Defends:* CORMIDIA-INV-ACC-7a. *Families:* CF-INV-ACC-7a. *Layer:* 1/2.
  *Executor:* build-agent.
- **HB-126 — CF-INV-ACC-7b packaged provenance. DONE 2026-08-08** (`tests/hermetic/cf-inv-acc-7b/`; the double is spawned, so every exit status is observed). Assert `install:packaged`'s **exit
  status** and record the installed version plus tarball identity in the report.
  **Do not reimplement its checks** — the script already resolves each declared binary,
  refuses a checkout-internal resolution, and refuses any skill target that is not
  `current`. *Acceptance:* red-then-green against a campaign started with `link:local`
  links present; a bare `--dry-run` non-zero exit must not be readable as a rehearsal
  pass. *Defends:* CORMIDIA-INV-ACC-7b, CORMIDIA-C-B27-001 §1.2. *Families:*
  CF-INV-ACC-7b. *Layer:* 1/2. *Executor:* build-agent.
- **HB-127 — B-27 campaign contract + CF-SM-ACC lifecycle. DONE 2026-08-08** (`tests/unit/cf-b27/`, `tests/unit/cf-sm-acc/`). Every preflight refusal
  class (§1.1–1.9) pre-mutation and pre-spend; report shape incl. matrix, installed
  identity, per-axis citations and applied disjointness sets; lifecycle transitions with
  build-arm entry illegal without a resolved gate. *Acceptance:* each refusal class has
  its own case; a report missing matrix or installed identity is malformed, not thin.
  *Defends:* CORMIDIA-C-B27-001, CORMIDIA-INV-ACC-4. *Families:* CF-SM-ACC-*,
  CF-B27-*, CF-C-B27, CF-J21-R (the preflight-refusal journey leg). *Layer:* 1/2.
  *Executor:* build-agent.
- **HB-128 — jobs families (M18). DONE 2026-08-08** — the pre-existing suite was re-registered from the pre-revision numbering (the ids then called B-23/J-21/J-22 <!-- changelog 2026-08-10 (machine-parse): the old ids are named in prose, not as family tokens, so this history cannot claim ownership of the families those numbers denote today (OpenCode adapter; L-ACC campaign journey) -->) onto CF-B30-*, CF-J22-S, CF-J22-I, CF-J22-RC, and CF-J23-* (B-23 is now OpenCode, J-21 the L-ACC campaign), and CF-SM-JOB-*, CF-IF-JOB and the seeded double-settle control are new (`tests/unit/cf-b30-cfg/`, `tests/hermetic/cf-b30/`, `tests/hermetic/cf-j22-j23/`, `tests/hermetic/cf-sm-job/`, `tests/unit/cf-if-job/`). CF-B30-*, CF-J22-S, CF-J22-I, CF-J22-RC, CF-J23-*, CF-SM-JOB-*,
  CF-IF-JOB against the existing fixture kit. *Acceptance:* negative controls per the
  jobs design — cyclic config, drifted config hash, a declared output that exists but is
  empty, a lying fake provider reporting `completed` for a step whose check fails, nested
  invocation, and a seeded double-settle. *Defends:* CORMIDIA-C-B30-001…003,
  CORMIDIA-C-OPJOB-001, INV-008/015 jobs tightenings. *Families:* also CF-C-B30.
  *Layer:* 1/2. *Executor:* build-agent.
- **HB-129 — S-11 grader envelope + the fabrication control. DONE 2026-08-08** (`tests/hermetic/cf-s11-env/`; the required first case is committed at `golden-sets/acceptance-grader/cases.json` and the O-5 detector was verified red against it). Evidence-set composition
  per axis (self-report excluded from O-1…O-3 and the subject of O-5), result schema with
  mandatory citation, and the **seeded fabricated claim** as the first committed case in
  `golden-sets/acceptance-grader/`. *Acceptance:* the O-5 detector lands red against the
  seeded claim before any grader result is trusted; no threshold is introduced.
  *Defends:* CORMIDIA-C-B29-001 §5, llm-eval-plan S-11. *Families:* CF-S11-env.
  *Layer:* 1/2 (+4 scaffold). *Executor:* build-agent.
- **HB-130 — the campaign runner and run 1. DONE 2026-08-08; RUN 1 TERMINAL AT PLAN GATE** (`tests/campaign/acceptance/runner.ts`, `tests/hermetic/cf-j21/`, `acceptance/run-1-result.md`). **CORRECTION:** this entry previously said the spend authorization was the one remaining blocker. It was not. The runner takes both arms as callbacks and only a test supplied them, so nothing provisioned repos, ran the arms, or called a grader until HB-131 built that layer. F-PT-029 and F-PT-030 were both answered
  by the owner on 2026-08-07. A declared
  `plan_gate` policy may resolve the gate unattended so a campaign runs end to end,
  applying the ratified rubric §6 criteria and recording the resolution with the scores
  it acted on; a config with no declared policy refuses. The runner emits a report and
  **never** a release signal — L-ACC gates nothing.
  *Acceptance:* HB-120…129 green first; run 1 produces a distribution plus a gap list,
  every threshold-dependent axis `inconclusive`, and the report answers "which bytes did
  this exercise" from the installed version and tarball identity alone.
  *Families:* CF-J21-S, CF-J21-RC, CF-INV-ACC-4's gate-ordering journey half.
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
  repeats the install/world proof before mutation. *Families:* the lane rows
  CF-ACC-S1, CF-ACC-S2, CF-ACC-S3, CF-ACC-GATE (their machinery; run evidence stays
  per-campaign). *Layer:* 1/2. *Executor:* build-agent.

**Run-1 preconditions — satisfied 2026-08-08.** The exact authorization, recorded
`pnpm install:packaged --replace-source-links` proof, campaign org, three disposable
scenario repositories under that org, and both provider credentials were present.

## Run-1 conformance repair (2026-08-07) — HB-132

- **HB-132 — make HB-131 honest against the real packaged path. DONE 2026-08-08;
  LIVE RUN TERMINAL AT PLAN GATE.** The first execution review found defects an all-scripted path
  could not expose: provisioning preceded world preflight; app/job arms and grading were
  not composed with durable checkpoints; the mirror matrix had no scenario-scoped legal
  grader; fixed-mode `run-role` was passed an illegal adaptive flag; `cormidia-job` had
  no command audit; subscription accounting discarded the equivalent cost needed by the
  authorized outer ceiling; and the report did not synthesize every required axis, gap,
  preview command or spend total. The repair adds exact role activation, conservative
  per-invocation admission, equivalent-cost telemetry, job command audit, final
  three-record reconciliation, terminal real-installer tarball proof, authenticated
  non-interactive baseline pushes with exact pre-spend resume, canonical-label
  provisioning before packaged app verification, setup-mechanism-consistent app
  identities with exact registration resume, deterministic non-secret S-ACC-2 baseline
  support files with safe-path enforcement, body-only sealed-key fingerprints,
  restart-durable unavailable-usage debits, exact fixed-grader reservations,
  failed-arm non-grading, and fail-closed report validation.
  Run 1 then exposed three more real-path gaps, fixed after its immutable terminal
  report without retrying the gate: recursive Codex strict-schema translation, parsing
  the exact `run-role` terminal summary wrapper, and reconciliation scoped to the
  current driver's scenario-attempt window rather than historical pre-report turns.
  Ceiling exhaustion is
  caught as an incomplete scenario and never truncates into a pass. Product issues and
  run observations are kept in `acceptance/run-1-todo.md`.
  *Detectors:* `tests/unit/cf-b27/`, `tests/hermetic/cf-j21/`,
  `tests/hermetic/cf-s11-env/`, `tests/hermetic/cf-inv-acc-7a/`,
  `tests/unit/cf-b30/`, `tests/unit/cf-auth-mode/`, `tests/unit/cf-s11-mech/`,
  `tests/unit/cf-reg-360/`.
  *No contract loosening:* rubric bytes, axes, plan-gate criterion, golden set,
  thresholds (`NONE`), `release_signal: null` and no-deployment boundary are unchanged.

## Steady-state revision (2026-08-10, campaign rev-2026-08-10) — HB-133…HB-136, HB-140

Registered at the rev-2026-08-10 Phase 0 gate (harness-design-state.md carries the
revision record; elicitation-log.md the gate history). No existing ticket, gate, bound,
or golden set changed.

- **HB-133 — CF-REVIEW-PROVIDER: Builder/Reviewer provider-family disjointness pin.
  LANDED 2026-08-12 (implemented under the flagged provenance caveat below: the
  FAMILY unit is a pending-ratification seat ruling, so the pin is built
  as specified with the unit swappable, not semantically settled <!-- changelog
  2026-08-10 (reader test 15, new-engineer finding 5) -->).** Deterministic refusal before provider construction
  when an autonomous code-delivery route resolves Builder and Reviewer to one provider
  family — including distinct adapters over one upstream family (the pi/Anthropic-style
  correlation) — and fail-closed on a missing/unresolvable family; different families
  pass (the non-vacuous positive); no Reviewer imposed on jobs (M18) or manual-only
  routes. Owner ruling rev-2026-08-10: the docs/loop/design.md "Review identity"
  decision controls; "different provider" means provider **family**. **Provenance
  caveat a builder must see here, not only in the package** <!-- changelog
  2026-08-10 (reader test 12, new-engineer finding 1): the caveat lived in
  catalog §10.2's preamble and ratification-package.md §12.3, but not at this
  ticket -->: the provider-FAMILY interpretation is a `[simulated]` AI-seat
  ruling pending real-human ratification (ratification-package.md §12.3 item 1).
  Implementing this ticket is authorized as specified; if the human later
  overturns the unit (e.g. to vendor product or account), the detector's
  disjointness unit changes with it — build the family resolution as an
  explicit, swappable input, not an inlined assumption. The L-ACC
  preflight already enforces this for campaign app arms — this ticket pins the
  production loop. *Acceptance:* red-then-green against a seeded same-family collapse
  (config-level, not roles.yaml default); each of the five legs has its own case; lands
  in the per-commit blocking lane. *Family:* CF-REVIEW-PROVIDER (catalog §10.2).
  *Defends:* INV-012/INV-016 · B-10 (config authority) · C-OP-LOOP. *Layer:* 1/2.
  *Executor:* build-agent.
  <!-- implementation status 2026-08-12: HB-133 LANDED in
  tests/unit/cf-review-provider/route-refusal.test.ts (legs a/b/c/d + manual half
  of e; red-then-green — 4 seeded config-level legs failed pre-pin),
  tests/unit/cf-review-provider/family-resolver-unit.test.ts (swappable
  family-unit caveat + fail-closed resolver), and
  tests/hermetic/cf-review-provider/jobs-scope.test.ts (leg e, jobs/M18).
  Enforcement: src/loop/review-provider.ts, wired at
  createEpisodePlanningPolicy (src/org/episode-planner/policy.ts) — the seam
  every autonomous code-delivery planning boundary crosses before any provider
  construction, the EpisodePlanner turn included. -->

- **HB-134 — GTM pre-launch triggered obligations. TRIGGERED (not scheduled; no work
  now).** Source: `docs/gtm-wip.md` (WIP/non-normative, owner-aligned 2026-08-09).
  Three trigger-children, each blocking its own trigger event and nothing else:
  1. **Before offering customer source bundles:** define the customer-verifiable RQ-1
     evidence subset and the boundary excluding private operations (gtm-wip §3).
  2. **Before changing public-package licensing/metadata:** prove
     LICENSE/package-metadata/README/homepage/CLI-notice coherence (gtm-wip §8.6) —
     a deterministic release-evidence check, not prose review.
  3. **Before — not "at" — the first external-user launch or onboarding:** re-enter
     `validation-harness-design` in `harness-revision` mode to reopen deployment
     shape and tier allocation (the current C2/T-1…T-12 calibration assumes a
     single-operator self-hosted deployment).
  *Acceptance:* none until a trigger fires; a trigger firing without its child
  complete is a blocking finding. *Layer:* triggered — none until a trigger
  fires; child 2 is a deterministic release-evidence check (L1-shaped), children
  1 and 3 set their layer at trigger time per the cheapest-falsifying rule.
  *Defends:* no ratified invariant or contract yet — the source
  (`docs/gtm-wip.md`) is WIP/non-normative, so each child MUST name its
  Defends when its trigger fires, and a child that cannot name one is not
  implementable. <!-- changelog 2026-08-10 (reader test 25, new-engineer
  finding 3): the ticket broke the file's own every-ticket-carries-fields rule;
  fields added honestly rather than invented — the layer and defended surface
  are genuinely undetermined until triggered. --> *Executor:* human (trigger recognition) +
  build-agent (children 1–2), harness-revision campaign (child 3).
- **HB-135 — F-PT-019 operation-aware `secrets-or-auth` classifier + deposited
  detector. LANDED 2026-08-12.** Implements the contract
  truth ratified in PURPOSE v2.15 §4 (F-PT-019 resolved-ratified 2026-08-03;
  `src/runtime/gate.ts` §5.2 comment records the implementation state). **The ratified
  classification rule is reproduced in full at `validation-policy.yaml` →
  `open_findings` → F-PT-019 → `resolution`, so this ticket is implementable from
  the design corpus alone.** <!-- changelog 2026-08-10 (reader test 12,
  new-engineer finding 2): the rule previously lived only in out-of-corpus files
  (PURPOSE, gate.ts). --> Owns: metadata-only
  access (`git check-ignore .env`, `git status --ignored`) classified by actual
  effect, not text; actual content emission (`git show HEAD:.env`, `cat .env`)
  classified as a contents read; unparseable effect fails closed to critical; and the
  #20 direction — coverage reaching effects that bypass the classifier entirely, not
  merely pattern evasion. *Acceptance:* detector deposited in the same PR
  (evidence-deposit rule), red-then-green in both directions (a false-positive
  metadata query and a true-positive content emission); CF-SPLIT-SECRETS and
  CF-REG-204 PENDING annotations flip to landed in the same change. If a product-repo
  issue is opened for this work, record the cross-reference here in the same change.
  Product-repo cross-reference: **#218** (`git show HEAD:<secret>` classified
  routine — the known false-negative class this ticket closes; recorded on the
  issue while fixing #204, PR #217).
  *Defends:* INV-002/INV-003 · CF-SPLIT-SECRETS · CF-REG-204. *Layer:* 1/2 + product.
  *Executor:* build-agent.
  <!-- implementation status 2026-08-12: HB-135 LANDED in src/runtime/gate.ts
  (operation-aware secret-read: metadataOnlyInvocation/emitsContents projection,
  CONTENT_EMITTING_GIT_SUBCOMMANDS operand targets closing #218) with detectors in
  tests/unit/cf-reg-204/cf-reg-204-read-only-git-plumbing.test.ts (rule-level half:
  emission/fail-closed table, metadata-only table, two seeded permissive-classifier
  controls) and tests/unit/cf-split-secrets/secrets-split.test.ts (boundary leg);
  red-then-green in both directions — the exact #204 reviewer compound went green
  only after the fix, and the #218 emission class stayed red against both seeded
  permissive classifiers. -->
- **HB-136 — CF-J21-I campaign kill-boundary sweep. LANDED 2026-08-12.** Opened by the
  rev-2026-08-10 status-honesty check: CF-J21-I has no citing spec (verified against
  `tests/hermetic/cf-j21/`); its torn-report, resume-drift and gate-ordering halves
  are already owned at CF-B27-* and CF-INV-ACC-4 and are not re-owed. Owed: the
  kill-at-each-campaign-boundary sweep (post-provision, mid-plan-arm, at the gate,
  mid-build-arm, mid-grade, mid-report) over the hermetic campaign rig, each boundary
  with partial-evidence preservation asserted. *Acceptance:* red-then-green with a
  seeded resume-past-the-gate violation; directory named `cf-j21-i`. *Defends:*
  CORMIDIA-C-B27-001 §3 · CORMIDIA-INV-ACC-4/6. *Layer:* 2. *Executor:* build-agent.
  <!-- implementation status 2026-08-12: HB-136 LANDED in
  tests/hermetic/cf-j21-i/cf-j21-i-kill-boundary-sweep.test.ts; all six campaign
  kill boundaries carry partial-evidence-preservation legs over the hermetic rig
  composed with the durable report store, and the resume legs carry the seeded
  resume-past-the-gate red control (a forged continue over a stop gate turned the
  no-build-spend-without-a-recorded-decision assertion red before honest bytes
  went back green). The torn-report, resume-drift and gate-ordering halves stay
  owned where the ticket left them. -->

- **HB-140 — case-catalog.yaml regeneration drift gate. LANDED 2026-08-12 (opened at
  the Phase 8 reader test, new-engineer finding 2).** The policy says the two catalog surfaces
  MUST agree; today agreement holds by construction (the YAML is generated) but no
  check enforces it, so a future hand-edit to `case-catalog.md` without rerunning
  `case-catalog-generator.awk` would silently desync them. Owed: a CI/local check
  that regenerating the YAML from `case-catalog.md` + `harness-backlog.md` is
  byte-identical to the committed file — drift is red (the HB-006 artifact-pin
  discipline applied to the machine catalog). *Acceptance:* red-then-green against
  a seeded hand-edit to the committed YAML; runs in the per-commit lane.
  *Families:* CF-HARNESS-CI (harness self-test register). *Layer:* 1 + CI.
  *Executor:* build-agent.
  <!-- implementation status 2026-08-12: HB-140 LANDED in
  scripts/check-catalog-drift.mjs (final pnpm check lane step, so per-commit
  CI and the pre-commit hook both run it) +
  tests/policy/cf-harness-ci/catalog-drift.test.ts; seeded YAML hand-edit,
  un-regenerated markdown edits, missing-file, generator-diagnostics, and
  empty-walk paths all proven red. -->

## Wave 1 — status-honesty reclassification (2026-08-11)

Approved from the read-only status-honesty triage. These are new pending tickets, not
retroactive changes to the assertions in any existing spec.

- **HB-141 — COMPLETE 2026-08-11 — gate-command runner and exact-payload publication refusal.**
  Build the missing scripted gate-command matrix: hang→timeout-kill, bounded
  stdout/stderr flood, missing tool, exit-0 liar bound to candidate SHA, candidate
  mutation between bind and run, and a bare pending template that fails closed. Add
  the journey-level refusal for publication without exact-payload approval.
  *Acceptance:* every named runner failure and the publication bypass have their own
  case; a seeded exit-0 liar and a seeded approval bypass each turn the detector red
  before the corrected path is green. *Defends:* CF-B16, CF-C-B16, CF-J11-R.
  *Families:* CF-B16, CF-C-B16, CF-J11-R. *Layer:* 1/2. *Executor:* build-agent.
  *Implementation:* `tests/hermetic/cf-b16-cf-c-b16-cf-j11-r/gate-command-runner.test.ts`
  runs the scripted boundary matrix and exact-payload refusal. The runner now binds
  command evidence to candidate/worktree identity, marks bounded output truncation,
  types missing tools, kills timed-out process groups, and refuses candidate mutation.
- **HB-150 — conservative cross-family error-branch sweep. LANDED.** Exercise corrupt
  HMAC key, missing charter, classifier throw, and unreadable budget as one floor
  invariant: every error must reduce capability, never increase it or produce a greener
  result. *Acceptance:* four explicit cases plus a seeded permissive fallback that turns
  the detector red before the conservative paths are green. *Defends:* CF-INV-015.
  *Families:* CF-INV-015. *Layer:* 1/2. *Executor:* build-agent.
  **Contradiction recorded and ruled (2026-08-12, F-PT-036).** The 2026-08-11 campaign
  found (HR-HB150-001): INV-015 seed (c) requires "classifier throws → deny +
  escalate" (`invariants.md`), but the Codex (`src/runtime/adapters/codex-gate-bridge.ts`
  catch branch), Cursor (`cursor-gate-bridge.ts`), and OpenCode
  (`opencode-gate-bridge.ts`) classifier-throw branches deny with a fail-closed reason
  and append **no** `GateEscalation`; the existing cf-inv-002 codex test asserts
  denial+reason only. Owner ruling: the invariant stands as written — all three
  bridges gain the escalation append; the invariant text is unchanged. UNBLOCKED:
  implement product change + detectors per F-PT-036's resolution.
  <!-- implementation status 2026-08-12: HB-150 LANDED in
  tests/hermetic/cf-inv-015/cf-inv-015-error-branch-sweep.test.ts (all four seeds, one
  sweep) plus the extended escalation assertions in
  tests/hermetic/cf-inv-002/codex-hook-bridge.test.ts; the F-PT-036 product change
  landed in the same PR — all three bridges' classifier-throw catch branches now
  answer via classifierThrowDenial (src/runtime/adapters/gate-bridge-escalation.ts),
  deny + escalate. Red evidence: the escalation assertions ran red pre-fix, and seeded
  permissive fallbacks (allow-on-throw in each bridge, corrupt secret accepted,
  charterless org resolving delegated, `unknown` budget treated admissible) each turned
  their arm red before honest bytes were restored green. -->


## Wave 2 — status-honesty reclassification (2026-08-11)

- **HB-142 — scheduler-admission matrix and clause-complete contract. LANDED 2026-08-12.** Add
  due arithmetic over schedule/event/cadence overrides, the full named non-admission
  vocabulary, durable pre-spawn decisions, the asymmetric spawn-failure versus
  post-spawn-bookkeeping-failure paths without duplicate spawn, and manual-versus-timer
  dispatch parity. *Acceptance:* the complete B-08 contract enumeration is exercised;
  a seeded duplicate spawn and a seeded initiator divergence each turn red before the
  honest implementation is green. *Defends:* CF-J09-S, CF-J09-R, CF-J09-I, CF-J09-A,
  CF-C-B08. *Families:* CF-J09-S, CF-J09-R, CF-J09-I, CF-J09-A, CF-C-B08. *Layer:* 2.
  *Executor:* build-agent.
  **Contradiction recorded and ruled (2026-08-12, F-PT-034).** The 2026-08-11 campaign
  found (HR-HB142-001): this ticket requires "the full named non-admission
  vocabulary" while B-08 §2's list literally ended with an ellipsis;
  `docs/scheduler/design.md` §"Outcomes and reason codes" declares
  `scheduler_definition_failure` and `scheduler_state_failure` canonical; the product
  type (`src/org/scheduler/model.ts`) carries both members; and a malformed schedule
  trigger THROWS from `src/org/schedule.ts` parsing instead of terminating in a named
  reason. Owner ruling: vocabulary CLOSED to the design doc's 20-member
  Execution/admission row (B-08 §2 updated); both scheduler_* reasons are real
  runtime-triggered validated non-admission with durable evidence, never a crash.
  UNBLOCKED: implement product change + detectors per F-PT-034's resolution.
  <!-- implementation status 2026-08-12: HB-142 LANDED in
  tests/hermetic/cf-c-b08-cf-j09-a-cf-j09-i-cf-j09-r-cf-j09-s/ (five spec files +
  shared world/detectors). Product change per F-PT-034: src/org/schedule.ts mints
  typed ScheduleDefinitionError/ScheduleStateError and validates schedule state
  (parse, don't cast); src/org/dispatch.ts routes both to named, evidenced
  non-admission (scheduler_definition_failure / scheduler_state_failure), fails
  the unreadable budget overlay closed per B-08 §3, and no longer lets a later
  tick's backpressure observation terminalize a live execution's pending
  decision. Pre-fix reds captured in the landing PR: tick crash on corrupt
  schedule.json and corrupt budget overlay; channel_gated mislabel of a malformed
  spec; silent not_due over an unparseable timestamp; pending-decision rewrite. -->
- **HB-148 — store-class crash/truncation/quarantine invariant. LANDED.** Sweep kill
  points at append, rename, and journal boundaries for every durable store class; reject
  truncated JSON and prove quarantined bytes are never accepted as state. Existing
  journey-specific kill tests remain evidence only for their own journeys.
  *Acceptance:* each store class has a crash leg and a seeded truncated/quarantined-state
  negative control that turns red before the invariant is green. *Defends:* CF-INV-013.
  *Families:* CF-INV-013. *Layer:* 2. *Executor:* build-agent.
  <!-- implementation status 2026-08-11: HB-148 LANDED in
  tests/hermetic/cf-inv-013/cf-inv-013-store-integrity.test.ts; all three ratified
  store classes carry SIGKILL, truncated-state, and quarantined-state legs. -->

## Wave 3 — status-honesty reclassification (2026-08-11)

- **HB-143 — internal-artifact and incident journey family. LANDED 2026-08-12.** Exercise
  Support/Marketing/SRE completion into channel-gated internal artifacts, the distinct
  analysis-complete and incident-filed claims with a crash between them, exactly one
  source-linked incident under retry, and draft visibility through observe without any
  publication effect. *Acceptance:* all four journey families have direct cases; seeded
  duplicate-incident and publication-side-effect controls turn red before the walk is
  green. *Defends:* CF-J11-S, CF-J11-I, CF-J11-RC, CF-J11-A. *Families:* CF-J11-S,
  CF-J11-I, CF-J11-RC, CF-J11-A. *Layer:* 2. *Executor:* build-agent.
  **Contradiction recorded and ruled (2026-08-12, F-PT-035).** The 2026-08-11 campaign
  found (HR-HB143-001): J-11 (`contracts/journey-acceptance.md`) required exact-payload
  approval for "any external publication path" while the ratified #296 §5.3
  consequence split (`docs/approvals/design.md`, enforced by
  `tests/unit/cf-split-publishing/`) replaces `external-publishing` with budgeted
  `repo-collaboration` for verified own-repository actions — and
  `src/org/standing-roles.ts` `queueIncidentFiling` still searched for an
  `external-publishing` action record, failing when an allowed operation lacked one.
  Owner ruling: own-repo source-linked `op:incident` filing is budgeted
  `repo-collaboration`; J-11's "external" aligned to mean outside the app's own
  configured repositories (J-11 updated). UNBLOCKED: implement product change +
  detectors per F-PT-035's resolution.
  <!-- implementation status 2026-08-12: HB-143 LANDED in
  tests/hermetic/cf-j11-a-cf-j11-i-cf-j11-rc-cf-j11-s/internal-artifact-incident-journey.test.ts.
  Product change per F-PT-035: queueIncidentFiling moved off the retired
  external-publishing lookup to budgeted repo-collaboration — the composed gate's
  own-repo verification/foreign refinement is reused, and an allowed own-repo filing
  mints its content-bound durable execution record via an attributable agent decision.
  Free red captured pre-fix ("incident delivery gate allowed without a durable action
  record"); seeded broken-idempotency-key and publishing-draft-path controls each
  turned red before the honest walk was green. -->
- **HB-146 — loop transition crash sweep. LANDED 2026-08-11.** Extended the existing legal,
  illegal, and replay loop-state suite with a crash at every transition boundary while
  preserving predecessor authority and labels-after-artifacts ordering. *Acceptance:*
  every productive transition has a kill point and a seeded torn transition turns the
  detector red before recovery is green. The non-duplicate build-artifact→gates leg is
  `tests/hermetic/cf-sm-loop-c/`; identical claim/PR/review/merge legs remain credited to
  HB-023's delivery-interruption family. *Defends:* CF-SM-LOOP-C. *Families:*
  CF-SM-LOOP-C. *Layer:* 2. *Executor:* build-agent.
- **HB-149 — admission/bookkeeping evidence invariant. LANDED 2026-08-11.** Added the missing
  four-leg invariant sweep: WIP limitation emits its named reason, a sweep without marks
  refuses, spawn failure after the durable decision is named, and post-spawn bookkeeping
  failure remains distinct. *Acceptance:* all four legs are independently asserted; a
  seeded collapsed failure vocabulary turns red before the evidence is green.
  *Defends:* CF-INV-014. *Families:* CF-INV-014. *Layer:* 2. *Executor:* build-agent.

## Wave 4 — status-honesty reclassification (2026-08-11)

- **HB-147 — COMPLETE 2026-08-11 — EpisodePlan revision state machine.** Implement direct coverage
  for legal forward-only revisions, refusal of backward/edit-in-place revisions,
  idempotent replay, and crash-safe persistence where a torn plan never becomes
  terminal. *Acceptance:* all four state-machine families have direct cases; seeded
  backward revision and torn-persist controls turn red before the state machine is
  green. *Defends:* CF-SM-PLAN-L, CF-SM-PLAN-I, CF-SM-PLAN-R, CF-SM-PLAN-C.
  *Families:* CF-SM-PLAN-L, CF-SM-PLAN-I, CF-SM-PLAN-R, CF-SM-PLAN-C. *Layer:* 2.
  *Executor:* build-agent.
  *Implementation:* `tests/hermetic/cf-sm-plan-c-cf-sm-plan-i-cf-sm-plan-l-cf-sm-plan-r/episode-plan-revision-state-machine.test.ts`
  walks the real plan-version, pointer, execution-journal, and typed-replan stores. It
  proves legal future-only revision, backward and completed-step refusal, exact replay,
  checkpoint recovery, and rejection of seeded torn version bytes.

## Wave L3 — status-honesty reclassification (2026-08-11)

- **HB-144 — unattended composite hermetic prerequisite. LANDED.** Before any live
  campaign credit, build the missing fake-timer multi-tick composite: full reached-link
  evidence, admitted-or-named-non-admission accounting, every typed non-green morning
  state, and recovery without lost or duplicate work. The existing profile test remains
  cited only for profile authorization. *Acceptance:* all four deterministic composite
  families run on the hermetic rig; seeded lost-work and duplicate-work controls each
  turn red before recovery is green. *Defends:* CF-J18-S, CF-J18-R, CF-J18-I,
  CF-J18-RC. *Families:* CF-J18-S, CF-J18-R, CF-J18-I, CF-J18-RC. *Layer:* 2.
  *Executor:* build-agent.
  <!-- implementation status 2026-08-11: HB-144 LANDED in
  tests/hermetic/cf-j18-i-cf-j18-r-cf-j18-rc-cf-j18-s/unattended-composite.test.ts;
  fake-timer multi-tick reached-link evidence, admitted/named-non-admission
  accounting, seven typed non-green morning states, and terminal-receipt recovery are
  covered with seeded lost-work, duplicate-work, and lying-status controls. The live
  unattended campaign remains separate and was not run. -->

## Outcome-acceptance status-honesty reclassification (2026-08-11)

- **HB-145 — job refusal, cross-surface agreement, and critical-operation contract.
  DONE 2026-08-11.** Complete the job pre-runtime refusal enumeration, downstream-stop and
  gated-operation legs; then prove the CLI and observe agree while keeping
  `completed (unverified)` distinct on every surface. Existing job lifecycle and journey
  tests remain cited only for the adjacent behavior they assert. *Acceptance:* each
  refusal occurs before runtime construction, failed checks stop downstream work, a
  seeded gate bypass turns red, and CLI/observe render the same durable fixture truth.
  *Defends:* CF-J22-R, CF-J22-A, CF-C-OPJOB. *Families:* CF-J22-R, CF-J22-A,
  CF-C-OPJOB. *Layer:* 1/2. *Executor:* build-agent.
  <!-- implementation status 2026-08-11: HB-145 LANDED in
  tests/hermetic/cf-c-opjob-cf-j22-a-cf-j22-r/; the complete pre-runtime
  refusal enumeration, failed-check downstream stop, job-owned approval item,
  shared CLI/observe durable-state projection, and checked-vs-unverified display
  distinction are covered. The critical-operation detector includes a seeded
  allow-all bypass that turns it red. -->

## Proposed deterministic status-honesty reclassification (2026-08-11)

- **HB-151 — planning-call-site deterministic envelope. LANDED.** Complete the S-1
  envelope beyond the existing roadmap/delta slices: malformed RoadmapPlan/EpisodePlan
  handling, the aggregate 100-item/delta/eager trajectory, and the format-repair budget.
  *Acceptance:* each enumerated envelope leg has a direct case; a seeded malformed plan
  accepted past validation and a seeded over-budget repair each turn red before the
  envelope is green. *Defends:* CF-S1-env. *Families:* CF-S1-env. *Layer:* 1/2.
  *Executor:* build-agent.
  <!-- implementation status 2026-08-11: HB-151 LANDED in
  tests/hermetic/cf-s1-env/planning-call-site-envelope.test.ts; malformed RoadmapPlan
  and EpisodePlan handling, one aggregate 100-item roadmap, added/changed delta with
  stable identities, zero eager EpisodePlans, and the exact two-attempt/provider-turn/
  cost/time repair budget are direct. Seeded validator bypass and third-attempt
  admission each turn the detector red. Existing roadmap/delta and S-9 specs retain
  only their narrower evidence. -->

## CI execution revision (2026-08-11, issue #403)

- **HB-152 — GitHub-orchestrated self-hosted Core Checks. LANDED.** Replace
  GitHub-hosted compute for ordinary internal PR and `main` Core Checks with one
  repository-scoped, ephemeral Linux ARM64 runner on the owner's Mac while retaining
  GitHub as orchestrator and check system of record. Fork-origin PRs and an explicit
  exact-SHA fallback remain GitHub-hosted; release, npm publication, OIDC/provenance,
  artifacts, and scheduled GitHub-mutating workflows stay GitHub-hosted. The runner
  appliance uses checksum/digest-pinned official inputs, one short-lived registration
  token, a unique custom label, no host mounts/Docker socket/host credentials, an empty
  job capability set, denied private/link-local egress except Docker DNS, bounded
  resources, and destruction after one job. A launchd supervisor keeps exactly one
  idle runner available and removes only exact-label/name offline residue. Core lane
  cleanup removes duplicate typecheck work, makes pinned gitleaks architecture-aware,
  fixes the observed late cleanup flake with its detector, and selects test concurrency
  only after repeated clean measurements. *Acceptance:* (1) the isolated appliance
  build and doctor pass; (2) a real GitHub-assigned probe job succeeds before Core
  routing changes; (3) internal PR and `main` jobs run on the Mac while a seeded fork
  and manual exact-SHA fallback select `ubuntu-latest`; (4) the Mac-offline fallback is
  exercised; (5) release remains hosted; (6) every routing/isolation/pin has a seeded
  negative control; (7) repeated full-suite runs are flake-free and p90 is reported
  against the ratified five-minute target. *Defends:* validation-policy `ci`,
  CF-HARNESS-CI, CF-HARNESS-RELEASE, secret-hygiene, and RQ-1 exact-candidate gate
  identity. *Families:* CF-HARNESS-CI (primary; CF-HARNESS-RELEASE is unchanged and
  asserted as a hosted-only non-regression). *Layer:* 1/2 + CI. *Executor:* build-agent;
  human ratification and repository/host authority recorded in issue #403 and the
  2026-08-11 session. *Evidence:* exact-SHA boundary probe run 31562095184; two
  flake-free Mac-backed Core Checks attempts in run 31561452475 (suite 125/126s,
  nearest-rank p90 126s; complete core job 220/228s, p90 228s); and exact-SHA
  `ubuntu-latest` fallback run 31561730803 (suite 431s, complete core job 504s),
  all green on `95561cd789da53da895226dd02629e8cd02fffd5`.

## Retrospective ownership records (2026-08-10, rev-2026-08-10)

Added by the rev-2026-08-10 machine-traceability pass so every implementable family
has a named owning ticket in this backlog. These three tickets are **records of
already-landed work**, not new work: the GitHub issues and fix PRs named inside them
remain the primary work records, and nothing here re-opens or re-authorizes anything.
HB-137..HB-139 LANDED (retrospective records).

- **HB-137 — Adapter-expansion implementation record (#337–#340, landed 2026-08-07).**
  Owns the adapter families the GitHub-tracked certification PRs landed:
  CF-B24, CF-B24-L3, CF-B24-SUBGATE, CF-B24-PAYLOAD, CF-C-B24 (Cursor, #338);
  CF-B25, CF-B25-L3, CF-C-B25 (Grok Build, #339 — real-repo use stays blocked on the
  OPEN #339 human risk review); CF-B26, CF-B26-L3, CF-C-B26 (Muse Code, #340 —
  CF-B26-L3's certified final state is incomplete, never pass); CF-B23, CF-B23-L3,
  CF-C-B23 (OpenCode, #337). *Executor:* landed by the adapter PRs' build agents.
- **HB-138 — Consequence-split implementation record (#313–#316, landed 2026-08-06).**
  Owns CF-SPLIT-DESTRUCTIVE, CF-SPLIT-NETWORK, CF-SPLIT-PUBLISHING — each landed
  red-then-green in its own PR per the F-PT-023 ratification. (CF-SPLIT-SECRETS'
  pending operation-aware leg is owned by HB-135 above.) *Executor:* landed by the
  split PRs' build agents.
- **HB-139 — Regression-deposit record (sourcing channel 3; landed with each fix PR).**
  Owns the §10.3 defect families whose detectors landed with their fixes:
  CF-REG-154, CF-REG-181, CF-REG-202, CF-REG-203, CF-REG-203-G, CF-REG-205,
  CF-REG-206, CF-REG-209, CF-REG-211, CF-REG-228, CF-REG-229, CF-REG-230,
  CF-REG-231, CF-REG-232, CF-REG-236-BUDGET, CF-REG-239, CF-REG-244, CF-REG-251,
  CF-REG-268, CF-REG-269, CF-REG-271, CF-REG-272, CF-REG-274, CF-REG-278,
  CF-REG-279, CF-REG-281, CF-REG-283, CF-REG-285, CF-REG-287, CF-REG-293,
  CF-REG-297, CF-REG-299, CF-REG-300, CF-REG-306, CF-REG-332, CF-REG-335,
  CF-REG-356, CF-REG-359, CF-REG-369, CF-REG-370, CF-REG-373, CF-REG-374,
  CF-REG-375, CF-REG-384, CF-REG-385, CF-REG-388, CF-REG-390, CF-REG-403, and CF-HB102-MANUAL-REVIEW. (CF-REG-273 and CF-REG-291 are owned by
  HB-052, whose live-lane hardening deposited them; CF-REG-204 is owned by HB-135.)
  *Executor:* landed by each defect's fix PR.

### Ticket status register (machine-readable; rev-2026-08-10)

Explicit landed markers for the tickets whose completion previously lived only in
prose ("COMPLETE"/"DONE") that machine parsing does not credit. This register adds
no new facts — each marker restates the wave/bullet records above.
**LANDED marks the ticket's implemented scope, not total closure of every clause
it touches** <!-- changelog 2026-08-10 (reader test 14, new-engineer finding 3) -->:
embedded parked clauses survive a LANDED marker (e.g. HB-040 is landed with its
F-PT-006 producer-visibility legs still parked; HB-012 with the F-PT-008 clause).
The wave-body text and the catalog's `BLOCKED:<finding>` cells carry that nuance —
read the ticket body, not only this register, before claiming a family closed.

HB-001..HB-006 LANDED. HB-007 LANDED. HB-010..HB-017 LANDED. HB-020..HB-025 LANDED.
HB-030..HB-033 LANDED. HB-040..HB-047 LANDED. HB-050..HB-054 LANDED.
HB-060..HB-061 LANDED. HB-063 LANDED. HB-070..HB-071 LANDED.
HB-080..HB-081 LANDED. HB-100..HB-111 LANDED. HB-113..HB-118 LANDED.
HB-120..HB-132 LANDED. HB-133 LANDED. HB-135 LANDED. HB-136 LANDED. HB-140 LANDED. HB-141 LANDED. HB-142 LANDED. HB-143 LANDED. HB-144 LANDED. HB-145 LANDED. HB-146 LANDED.
HB-147 LANDED. HB-148 LANDED. HB-149 LANDED. HB-150 LANDED. HB-151 LANDED. HB-152 LANDED. HB-P1 LANDED.
HB-112 LANDED. HB-P3 LANDED. HB-P5 LANDED. HB-P6 LANDED. HB-153 LANDED. HB-154 LANDED.
<!-- changelog 2026-08-12: HB-112 was an audit ticket, and "landed" is this register's
only completion token — it records that the ticket's acceptance (inventory, one
disposition per occurrence, zero scheduling-semantics changes) is discharged by the
owner's 2026-08-12 typo correction and the relabel/retire applied in the same change.
It is not a claim that a detector family shipped; HB-112 owns none. -->
HB-P2 LANDED.
HB-P4 LANDED.

## Campaign-finding rulings (2026-08-12, F-PT-037/F-PT-038) — HB-153…HB-154

<!-- Both findings were surfaced by the 2026-08-12 campaign pass, presented to the owner
as plain-language options BEFORE any implementation, and ruled the same day. Ids minted
by the next-id scan over this file and case-catalog.yaml's ticket list. -->

- **HB-153 — LANDED 2026-08-12 — classifier-throw deny+escalate at the muse, grok and pi seams (F-PT-037).**
  Extend the ratified INV-015 seed (c) enforcement to the three seams F-PT-036 did not
  reach: the muse and grok bridges route their classifier-throw catches through
  `classifierThrowDenial` (deny + `GateEscalation`), and `src/runtime/adapters/pi-gate.ts`
  gains its own catch instead of relying on the vendor's `prepareToolCall` to convert a
  thrown classifier into a blocked tool. *Acceptance:* every seam denies AND appends an
  escalation on a throwing classifier, red-then-green, with a **seeded permissive-fallback
  control per seam** (a catch that allows, or no catch at all, must fail); the pi case
  additionally pins that Cormidia's own code — not the SDK — produces the denial, so a
  vendor bump that stopped catching cannot silently open the seam. *Defends:* INV-015
  seed (c); CF-INV-015; B-25/B-26 and the pi leg of CORMIDIA-C-CORE-001. *Layer:* 2.
  *Executor:* build-agent.
- **HB-154 — LANDED 2026-08-12 — unresolvable independent-review policy fails closed (F-PT-038).** When an
  EpisodeIntent carries the `independent_review` safety fact and no review policy
  resolves — neither explicitly configured nor from the name-based
  `defaultBuilderReviewerPolicy` — refuse before provider construction under the same
  typed error class the adjacent empty-seat-list branch already uses, naming explicit
  seat configuration as the remedy. *Acceptance:* a route requiring independent review
  against an org chart with no builder/reviewer-named roles refuses deterministically
  before any provider construction, red-then-green, with a seeded control proving the
  pre-ruling silent-skip path now fails; a chart that DOES resolve seats is unaffected
  (negative control both ways). *Defends:* the HB-133/CF-REVIEW-PROVIDER cross-provider
  review guard; standing rule 2 (guardrails enforce). *Layer:* 2. *Executor:*
  build-agent.

## Structural revision (2026-08-12, F-PT-039 / issue #386) — HB-155

<!-- Provenance: harness revision 2026-08-12 resolving F-PT-039 (owner ruling: PURPOSE
non-negotiable 2 governs planning `--source`; the Cormidia-side pre-read is removed and
the harness reads the operator's files with its own tools). Registered structure: B-31,
CORMIDIA-INV-017, CORMIDIA-C-B31-001…003, families CF-B31-*/CF-B31-L3/CF-INV-017/CF-C-B31.
Pruned with the mechanism they served: the source-section coverage legs of CF-REG-374
(planningSourceCoverageHash, coverage record, --resume/--revise, plan_source_changed) and
the ingestion secret pre-scan. See case-catalog.md §10.3's CF-REG-374 changelog. -->

- **HB-155 — LANDED 2026-08-12 — governed planning-source scope + harness-native reading (F-PT-039, #386).**
  Cormidia declares a governed read scope from `--source`/`--optional-source` and the
  harness reads it with its own tools; the pre-read, the source-section coverage layer and
  the ingestion secret pre-scan are removed. *Acceptance:* (1) a required root that is
  missing/unreadable/non-regular refuses pre-runtime while an optional one records
  unavailable and proceeds; (2) a symlink escaping a declared root refuses and escalates;
  (3) a read outside every declared root is denied through the ordinary gate path, with no
  bespoke source-read mechanism; (4) **silent under-read never reports consumption** — a
  turn that reads nothing, or reads only text from an image-bearing scope, cannot produce
  a consumed manifest row, and the seeded narrate-without-reading liar turns the detector
  red; (5) an assignment lacking `media_read` for an image-bearing scope refuses before
  provider construction with typed remediation, and capability is read from the profile,
  never inferred from a model id (seeded control); (6) unobservable read evidence reports
  unobservable — never coverage, never a clean empty walk; (7) a mixed directory of
  Markdown + PNG + PDF plans successfully end to end with the image demonstrably read;
  (8) the INV-011 publication guard still refuses and no raw media byte crosses the
  publication boundary; (9) removal is complete — no Cormidia-side decode, classify, or
  content-embed path survives, asserted structurally. *Defends:* CORMIDIA-INV-017,
  CORMIDIA-C-B31-001…003, CF-J03-R's modality refusal leg. *Families:* CF-B31-\*,
  CF-INV-017, CF-C-B31 (CF-B31-L3 is the separate per-harness live leg, gated on adapter
  certification and never claimed from documentation). *Layer:* 1/2 (+3 for CF-B31-L3).
  *Executor:* build-agent.
  <!-- implementation status 2026-08-12: LANDED. Product change: src/org/planning-inputs.ts
  declares a scope (stat + bounded 16-byte magic-byte probe) and never reads content;
  src/org/planning-source-reads.ts observes gate-reported reads and narrows the gate to
  workdir + declared roots; the pre-read, its byte budget, its secret pre-scan, and the
  seven coverage modules are deleted; the coverage record's transactional half moved to
  src/org/planning-publication-ledger.ts + -operations.ts + -publish.ts; `media_read`
  joined the runtime capability profiles at `unsupported` pending CF-B31-L3.
  Detectors: tests/hermetic/cf-b31/planning-source-scope.test.ts (15 cases) — red-then-green
  verified against three seeded violations: (1) unread reported as consumed → 5 red,
  (2) narration counted as a read → 2 red, (3) scope gate stops denying → 1 red; all green
  on restore. CF-REG-374's suite was rewritten to its surviving legs with the prune recorded
  in its own header and §10.3 row. CF-B31-L3 (per-harness modality proof) remains OPEN and is
  the only thing between this and a usable image-bearing planning scope. -->

## Standing rules

(Single source of truth for the detector-deposit obligation:
`validation-policy.yaml` → `case_sourcing:` — this list references it.)
- Every defect fix deposits its detector in the same change.
- Every new detector family lands red-then-green (negative control).
- No ticket weakens a gate or golden set to pass; tighten-only.
