# Owner backlog companion — Cormidia harness (regenerated 2026-08-11 after landed HB-152/CF-REG-403 and HB-147)

Non-normative, living. Regenerated from `harness-backlog.md` after the 2026-08-11
pending-family ruling, including HB-141…HB-151 and the HB-137…HB-139 retrospective
records. If the backlog changes and this file's ticket-ID set goes stale,
that is a corpus bug — regenerate it in the same change; the repo's standing
agent instructions (`agents-md-contribution.md`, landed in AGENTS.md) carry that
staleness contract, so whichever coding agent touches the backlog next is routed
here too. On any disagreement,
`harness-backlog.md` wins. <!-- changelog 2026-08-10 (campaign close): the
staleness contract's carrier named explicitly. --> Convention: **open tickets get a full paragraph; landed
(DONE) tickets get one line** naming the promise defended, the failure caught, and
what done bought you.

## Open now — the short list that matters

- **HB-142 — scheduler-admission matrix and contract (PENDING).** Defends truthful
  due/admission/spawn accounting. The failure it catches: arithmetic or vocabulary gaps,
  a lost durable pre-spawn decision, duplicate spawn across asymmetric failures, or
  manual/timer initiators behaving differently. Done buys you the complete B-08
  deterministic matrix rather than crediting the existing race slice for all of it.
- **HB-143 — internal-artifact and incident journeys (PENDING).** Defends channel-gated
  Support/Marketing/SRE output and truthful incident lifecycle. The failure it catches:
  conflated analysis/filing, duplicate incidents on retry, or an observe-only draft that
  publishes as a side effect. Done buys you direct coverage of all four missing journey
  families.
- **HB-145 — job refusal, agreement, and critical-operation contract (PENDING).**
  Defends jobs before runtime construction and across CLI/observe surfaces. The failure
  it catches: an omitted refusal, downstream work after a failed check, a gated operation
  that proceeds, or `completed (unverified)` rendered as completed. Done buys you the
  missing refusal/gate enumeration and cross-surface agreement without widening the
  existing lifecycle tests.
- **HB-148 — store-class crash/truncation/quarantine invariant (LANDED).** Defends every
  durable store class, not just the journey-specific kill points already present. The
  failure it catches: truncated JSON or quarantined bytes becoming valid state after an
  append, rename, or journal interruption. The landed nine-case L2 sweep covers the
  append-only/keyed, atomic-replace, and multi-step-journal store classes with real
  SIGKILL boundaries plus truncated and quarantined negative controls.
- **HB-149 — admission/bookkeeping evidence invariant (LANDED).** Defends the distinct
  reasons at the scheduler/sweep boundary. The failure it catches: WIP, missing marks,
  spawn failure, and post-spawn bookkeeping failure collapsing into one greener or
  ambiguous story. The landed suite keeps all four outcomes distinct and includes a
  collapsed-vocabulary tripwire.
- **HB-150 — conservative cross-family error sweep (PENDING).** Defends fail-closed
  capability under corrupt HMAC state, missing charter, classifier exceptions, and
  unreadable budget. The failure it catches: any error branch granting more authority or
  producing a greener result. Done buys you one floor invariant across all four paths.
- **HB-151 — planning-call-site deterministic envelope (PENDING).** Defends the S-1
  envelope beyond the already-covered roadmap/delta slices. The failure it catches:
  malformed plans admitted, eager large-plan trajectory drift, or repair continuing
  beyond budget. Done buys you the aggregate malformed-plan, trajectory, and repair
  family without overstating the partial tests.
- **HB-133 — Builder/Reviewer provider-family pin (TODO, implementation-ready
  under a flagged caveat: the provider-FAMILY unit is a pending-ratification seat
  ruling, so "ready" means buildable with that unit swappable, not semantically
  settled <!-- changelog 2026-08-10 (final-gate follow-up 2): regenerated from
  harness-backlog.md's hoisted hedge; the ID-set diff cannot catch stale
  companion prose -->).**
  Defends the independent-review promise (§2.16 in the briefing) at its cheapest
  point. The failure it catches: a quiet config edit — convenience, cost, an outage
  workaround — resolves Builder and Reviewer to the same provider family, and every
  merge is then reviewed by the same blind spots that wrote it, including the subtle
  case of two different adapters fronting one upstream model family. Done buys you:
  the collapse refuses *before any model runs*, in the per-commit gate, proven
  red-then-green against a seeded collapse — and jobs/manual routes are explicitly
  exempt so nothing grows a reviewer that shouldn't have one.
- **HB-135 — operation-aware secrets classifier (TODO, implementation-ready).**
  Defends the fail-closed classification promise in both directions. The failure it
  catches is double-sided: today `git check-ignore .env` (opens nothing) escalates
  exactly like `cat .env` (prints the secret), which trains you to rubber-stamp; and
  `git show HEAD:.env` once classified routine. Done buys you: classification by what
  an action actually *emits*, unparseable effects still critical, classifier-bypass
  routes covered, and the detector deposited in the same PR.
- **HB-140 — machine-catalog drift gate (TODO; opened by the reader test).**
  Defends the promise that the human catalog and the machine catalog never
  disagree. The failure it catches: someone edits the human-readable catalog,
  forgets to regenerate the machine copy, and the tooling then enforces stale
  truth. Done buys you: regeneration is checked byte-for-byte on every commit,
  proven red first against a seeded hand-edit.
- **HB-136 — campaign kill-boundary sweep (TODO).** Defends the honesty of the
  acceptance lane's reports. The failure it catches: a campaign killed mid-arm that
  resumes past its plan gate or presents a torn report as terminal truth. Done buys
  you: a kill at each of six boundaries provably leaves partial evidence preserved
  and the report honest.
- **HB-134 — GTM tripwires (TRIGGERED — deliberately no work now).** Defends you
  from launching commercially on a harness calibrated for a solo operator. Three
  children block their own trigger events only: customer source bundles wait for a
  defined customer-verifiable evidence subset; public-package license changes wait
  for a metadata-coherence proof; the **first external user waits for a
  deployment-shape and criticality re-look**. A trigger firing without its child
  done is a blocking finding. Know its limits <!-- changelog 2026-08-10
  (final-gate follow-up 17): regenerated from the source ticket's round-25
  field additions; the ID-set diff cannot catch stale companion prose -->:
  **no layer exists until a trigger fires** (the license check is the one
  L1-shaped child; the others choose at trigger time), **nothing ratified is
  defended yet** — the source doc is WIP/non-normative — and **a child that
  cannot name what it defends when its trigger fires is not implementable**;
  you'll be asked to supply that answer, not to accept a guess.
- **HB-112 — `manual-feelview` taxonomy audit (PENDING, non-blocking).** Bookkeeping
  honesty for one odd label; no scheduling semantics. <!-- reviewed 2026-08-10
  (final-gate follow-up 17) against the source ticket's round-25 Defends
  addition (corpus hygiene, audit-only): semantically aligned, no rewrite
  needed. -->
- **HB-P3 / HB-P5 — parked on your answers** to F-PT-006 (event-producer crash
  protocol) and F-PT-008 (grant-expiry disposition). They stay parked so nobody
  encodes a guess as your policy.
- **HB-P6 / HB-P7 — parked**: provider terminal-status vocabulary (F-PT-017) awaits
  your choice; mechanical merge-blocking (F-PT-018) awaits a GitHub plan change —
  until then, protected human merge plus the release-blocking exact-tag rerun carry
  that weight, and say so.
- **HB-072 / HB-073 — the threat model is yours to author**; the abuse-case lane
  stays locked behind it (a gate refuses until your reviewed document exists).
- **HB-071 (evidence half) — the seven-day soak** waits for you to schedule a real
  week; the collector is built. Absence stays visible, never green.
- **HB-051 (evidence half) — real adapter conformance runs.** Machinery built; each
  run needs your authorization and spend envelope. The failure it exists to catch: a
  vendor changing behavior under us in a way the doubles can't see. Past failed
  attempts are preserved and buy no credit for a future candidate.
- **HB-052 (evidence half) — the real-GitHub sandbox smoke.** Proves merge, review
  submission, branch semantics and poll truth against the actual vendor, on sandbox
  repos, spend-bounded. Its history is instructive: two of its past runs failed on
  the *harness* misreading ordinary GitHub index lag as product violations — those
  became deposited detectors, and the corrected semantics report incomplete rather
  than inventing a verdict.
- **HB-053 (evidence half) — the launchd proof.** One real timer installed with a
  unique identity, one attributable tick, one clean removal — the only honest way to
  know the scheduler actually wakes on your machine. Needs an operator session.
- **HB-054 (evidence half) — the unattended sandbox campaign.** Zero human approval
  decisions on the allowed path, publication still hard-gated, profile identity in
  evidence. The profile is implemented; the campaign awaits your initiation.
- **HB-055 — BLOCKED by design: the generic external-effect live target.** B-17's
  real round-trip has no disposable target yet; until one exists this stays visibly
  blocked and may never be called pass.
- **HB-061/HB-062 remainder — golden sets you haven't ratified thresholds for**:
  authoring continues, verdicts stay inconclusive until F-PT-009/010/011 close.
- **HB-063 — builder-trajectory scenario fixtures (landed).** Deterministic
  trajectory assertions are complete; only the repeat-loop N=3 signature stays a
  proposal until you ratify it.
- **Comparative execution — designed, not built; nothing spends or ships today:**
  - **HB-090 — comparison contracts + hermetic skeleton.** The frozen-input,
    isolated-candidate machinery: what stops one candidate's work leaking into
    another's, or a losing lane crossing into your real branch.
  - **HB-091 — the standalone `cormidia compare` slice.** Preview-first, spends
    nothing until confirmed, materializes exactly one winner locally.
  - **HB-092 — EpisodePlan integration.** The same comparison entered from the
    governed loop, with the same evidence contract on both routes.
  - **HB-093 — the selection-judge corpus and calibration.** Blinded candidates,
    swapped-order controls, human references — and no automatic selection at all
    until you ratify its calibration (F-PT-011).
  - **HB-094 — planner activation and optional parallelism.** Last, gated on all of
    the above, and any parallel execution must re-enter risk allocation first.

## Landed — grouped by wave (one line each)

**Wave 0 — walking skeleton (2026-07-31).**
- HB-001: real CI lane, fail-closed, with a canary that proves the scanner can fire.
- HB-002: fixture kit with self-tests — the harness distrusts its own tools first.
- HB-003: a GitHub double that can lie on demand, so ambiguity is rehearsed offline.
- HB-004: first adapter double; unknown usage renders unknown, never zero.
- HB-005: one real detector per layer, each born red against a seeded violation.
- HB-006: the policy file is pinned by tests — moving an artifact without updating
  policy turns CI red.
- HB-007: every provisional number was put in front of you; 1–8 and 13 ratified.

**Wave 1 — permission-to-effect chain (2026-07-31).** HB-010 classifier-level
obfuscated-command refusals; HB-011 approval/grant state machines; HB-012 resume
fingerprints fail closed; HB-013 approve-vs-execute split with ambiguity terminal;
HB-014 authority and org-identity resolution fails conservative; HB-015 destruction
archived, scoped, sibling-proof;
HB-016 secret egress sweep; HB-017 learning can never self-promote; HB-P4 your
ratified compare-and-refuse rule — a human edit racing the bootstrap always keeps
the human's bytes. Twelve real product defects found and fixed with deposited
detectors; five ambiguities became findings instead of guesses.

**Wave 1/L3 — status-honesty closure (2026-08-11).** HB-141 gate-command evidence
binding and exact-payload publication refusal; hangs, floods, missing tools,
candidate drift, bare templates, and approval bypasses now fail directly. HB-144
unattended composite proves every reached link, every considered-item disposition,
all seven typed non-green morning states, and multi-tick recovery without lost or
duplicate work; the live campaign remains separate.

**Wave 2 — durability + money (2026-07-31).** HB-020 exactly-once settlement;
HB-021 claim-race recovery; HB-022 budget pause; HB-023 journey/turn SIGKILL sweeps;
HB-024 adapter
enforcement + remaining doubles; HB-025 filesystem/git faults; HB-P1/HB-P2 your
ratified crash and preserve-bytes contracts, encoded.

**Wave 3 — merge + evidence truth (2026-07-31).** HB-030 exact-HEAD merge
authorization; HB-031 loop legal/illegal/replay transitions, labels only after
artifacts; HB-032 implemented reader surfaces tell durable truth; HB-033 all
implemented interfaces agree on the same fixture truth.

**Wave 3 status-honesty remainder (2026-08-11).** HB-146 adds the missing
build-artifact→gates real-SIGKILL point and rejects a torn successor label without
its PR; the identical claim/PR/review/merge kill points remain owned by CF-J04-I.

**Status-honesty Wave 3 (2026-08-11).** HB-149: WIP limitation, event retirement
without marks, committed-decision spawn failure, and post-spawn bookkeeping failure
now retain four direct, distinct evidence outcomes with a collapsed-vocabulary tripwire.

**Wave 4 — status-honesty closure (2026-08-11).** HB-147 forward-only,
content-bound EpisodePlan revisions; backward and completed-step edits refuse,
exact replay is idempotent, and torn/checkpoint persistence never becomes silent
terminal authority.

**Wave 4 — remainder (2026-07-31).** HB-040 event inbox; HB-041 planner operations;
HB-042 onboarding ladder; HB-043 scheduler health; HB-044 retention boundaries;
HB-045 thin presentation smokes; HB-046 trajectory assertions; HB-047 format-repair
contract.

**Live/eval/ops machinery (2026-07-31…08-05).** HB-050 spend-accounted live runner;
HB-060 inconclusive-only eval runner with hard token envelopes; HB-070 contention
rig; HB-071 soak collector (evidence pending, above); HB-080 operator triage
runbook; HB-081 `inconclusive` rendered as not-a-pass on every product surface.

**Roadmap/validation/delivery (2026-08-03…04).** HB-100 provider-free vertical
walking skeleton; HB-101 whole-backlog roadmap authority; HB-102
validation-contract/readiness authority; HB-103 one-PR atomic delivery units;
HB-104 token-free batching; HB-105 structured fast paths; HB-106 direct operational
campaigns (seven exact approvals stay seven); HB-107 one orchestration façade with
role-safe session/cache reuse; HB-108 deterministic catalog closure; HB-109
batch-aware contention/soak machinery; HB-110 one shared explanation across
Status/Report/Observe; HB-111 protected-surface package — applied by you 2026-08-04.

**RQ-1 release gate (2026-08-04…05).** HB-113 manifest/currency/attestation
schemas; HB-114 seeded deterministic detectors; HB-115 paired L4 evidence for human
disposition; HB-116 packet sanitizer; HB-117 tag workflow — release requires the
GitHub actor, the approval identity, and your configured approver to be the same
person; HB-118 independent implementation audit, clean.

**Outcome-acceptance lane + jobs (2026-08-07…08).** HB-120 fixture kit; HB-121
sealed-key confinement (all three escape routes, including git history); HB-122
grader family-disjointness; HB-123 never-this-repository binding; HB-124 verdict
algebra (`ungraded` is never a zero); HB-125 the supervisor provably never does the
work; HB-126 packaged-binary provenance; HB-127 campaign contract + lifecycle;
HB-128 implemented job lifecycle/mechanical families; HB-129
grader envelope + the fabricated-claim control; HB-130 the runner (emits a report,
never a release signal); HB-131 the execution layer (the only path to the product
is the packaged binaries); HB-132 the honesty repairs the first real run forced.
Run 1 stopped at the plan gate — which is the lane working, not failing: it spent a
fraction of a build to learn the planner mishandled the briefs, and refused to call
anything a pass.

**CI compute (2026-08-11).** HB-152 moved ordinary internal PR and `main` Core
Checks to one GitHub-orchestrated disposable Linux ARM64 runner on the owner's Mac,
kept fork/fallback/release compute hosted, and pinned every host/network/credential
boundary with seeded controls. Two clean Mac runs measured a 126-second suite p90
and 228-second complete-job p90; the same-SHA hosted fallback stayed available and
passed, but took 431 seconds for the suite and 504 seconds for the job.

**Bookkeeping records (2026-08-10) — no new work in any of these.**
- HB-137: a record naming the adapter families the #337–#340 GitHub PRs already
  landed and certified, so machine traceability can resolve them to a ticket. It
  changes nothing about Grok staying sandbox-only or Muse staying fail-closed off.
- HB-138: the same kind of record for the consequence-split families the #313–#316
  PRs landed.
- HB-139: the same for the forty-plus regression detectors, including CF-REG-403,
  that landed with their
  fix PRs over the product's life — the "every bug leaves a tripwire behind" promise,
  now resolvable ticket-by-ticket by the tooling as well as by reading the catalog.
