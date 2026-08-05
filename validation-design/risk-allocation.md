# Risk tiers, coverage allocation, and layer-5 obligations — Cormidia

Status: CONFIRMED at the Phase 6 hard stop (weighting, 2026-07-31, round 3); human-ratified 2026-07-31 — release-campaign spend amended at ratification, see §5 (ratification-package.md §9). <!-- AUD-105 -->
Provenance: probability judgments and allocation calls `[elicited]` (Phase 6 ramble);
cost axis inherited from ratified system-map §5 (T-1…T-12); spend/soak numbers are
**owner-ratified this campaign** (`[simulated]` seat — human-ratified 2026-07-31,
release bound amended, §5); `[PROPOSED]` marked where designer-originated.
The ratified allocation and the pending 2026-08-03 revision are encoded in
`validation-policy.yaml`; the latter remains design-only until the Phase 8 acceptance
gate. The policy is the surface a future audit diffs deliberate-thinness against.

Harness revision 2026-08-01: comparative execution inherits this confirmed
allocation. No new tier or control point is introduced; its clauses trace into
E-1/E-2/E-3, standard L1/L2, S-8 L4, and conditional future L5 below.

Harness revision 2026-08-03 (#184/#233/#234/#240), **Phase 6 owner-confirmed**:
roadmap/validation/delivery-unit/batching work also inherits the existing allocation.
E-1 is exhaustive for human-only routing, validation waivers, and exact-payload
authority for direct operational effects; E-2 is exhaustive for atomic unit claims,
per-turn/unit/batch accounting, session isolation and recovery; E-3 receives the
highest attention for ready-frontier truth, continuous validation lineage, independent
review and exact-HEAD one-PR merge. L1/L2 remain dominant; S-1/S-10 quality is L4 and
inconclusive under existing findings. No new campaign type is introduced. Material
scheduler/locking/session changes trigger the existing contention exercise and seven-
day sandbox soak with the new unit/batch cases. Cache-hit rate is measured, never a
correctness gate; parallel or automatically learned batching must re-enter Phase 6.

## 1. Probability axis (where it actually breaks) `[elicited]`

- **The joins, not the functions.** Provider dies after useful work; GitHub accepts
  but the response is lost; the laptop sleeps through windows; two individually
  reasonable state files disagree about whether work may proceed.
- **Highest churn: the provider-adapter surface** (gate hooks, usage observation,
  session continuation, error shapes move underneath us). Codex has the lived scars
  (auth rotation, protocol skew); **absence of an Anthropic/pi incident is not
  evidence those adapters are safer** — equal treatment.
- **GitHub next:** default-branch resolution, wrong-HEAD review, lost responses,
  branch protection, merge authorization — "works for months and then produces one
  extremely convincing lie" (PR #182 class: polished green attached to the wrong
  commit is corrosive; a malformed error is merely annoying).
- **Recovery/persistence: high probability because it is Tuesday** — sleep, process
  death, disk full, provider stops halfway. The question is never "did the turn fail"
  but "did we preserve what it bought, settle what it spent, and resume without
  performing or charging twice."
- **Gate/approvals: low churn, consequence-dominant** — "this code hardly changes" is
  not an exemption when the outcome is a deployment, publication, destructive reset,
  or merge.

## 2. The three exhaustive families `[elicited]`

- **E-1 — Permission-to-effect chain.** Governed authority resolution → critical-
  effect classification → exact decision or bounded scoped grant → execution →
  acknowledgement. Every branch, bypass route, replay, stale fingerprint, expiry,
  revocation, partial effect, and lost-response case attacked hermetically. Includes
  destructive lifecycle operations, secret-bearing routes, and the **learning
  activation boundary (T-10)** — resolver/publisher, tamper gate, authorized ≠
  validated, candidates-never-resolve — as a full member, not an adjacency.
  (INV-001/002/003/010/011/012-activation; T-1/2/3/4/8/**10**/12; B-09a/b, B-11,
  B-14, B-17, C-OP-LIFE.)
  Comparative slice: candidate lanes remain effect-inert, cannot request grant
  widening, and only a content-bound selected artifact may cross B-19 into ordinary
  continuation (B-18/B-19, J-19).
  Planning/batching slice: a human-only member excludes its whole unit; no readiness,
  affinity or cache score widens routing. A direct operational unit that posts or
  publishes reuses the exact-payload approval/execution chain per effect; batching never
  turns several payloads into one broadened grant (B-20/B-22, C-OP-BATCH).
- **E-2 — Turn durability and money, together.** One-app isolation, admission, pause
  enforcement, provider partials, settlement conservation, crash recovery, preserved
  paid work, no duplicate continuation. Money and recovery are one family because the
  expensive failures occur *between* their state transitions.
  (INV-004/005/006/007/013; T-5/6; B-02/03/04 core, B-07/08/15, adapter core.
  **T-11 adapter-enforcement slices are cross-cutting E-1/E-2 members** — the gate
  hook, budget-observation, and exact-session guarantees implement both families.)
  Comparative slice: every candidate/sample and judge call is separately admitted,
  terminal, and settled; aggregate comparison ceilings cannot hide those turns or
  regenerate paid candidates (B-18, J-19).
  Planning/batching slice: multi-ticket claims are all-or-none; every execution unit,
  EpisodePlan and provider turn remains separately attributable and settled; batch
  aggregates cannot transfer budget or require paid work to be repeated after a crash
  merely to recreate session/cache state (B-20/B-22, J-20).
- **E-3 — Merge and evidence truth.** Exact HEAD, resolved default branch, fresh
  checks, review authorization, orchestrator-only merge; every morning-screen claim
  distinguishing missing / stale / contradictory / decided / executed / verified.
  False green is the amplifier that lets every other defect run for a week.
  (INV-008/009/012/014; T-7/9; B-01, B-12, C-OP-LOOP.)
  Comparative slice: eligibility precedes judgment; advisory ranking is not
  admissible selection; exactly one evidence-bound winner is materialized; ordinary
  exact-HEAD review/merge remains downstream (B-19, J-19, S-8).
  Planning/batching slice: ready-frontier claims bind exact roadmap/validation versions;
  code delivery binds every member and obligation to one reviewed PR HEAD; operational
  units bind completion to their own typed effects/acknowledgements. A batch summary
  never compresses partial/failed members into green (B-20/B-21/B-22, INV-016).

**Non-discretionary floors (invariants, not allocation):** secret containment
(INV-011); agents-never-rewrite-their-own-authority (INV-001); and the apex invariant
**INV-015 — uncertainty narrows capability and claims, never widens them** — a
cross-family deterministic floor governing every failure branch in every family and
tier. None of these can be risk-pruned `[elicited + owner correction]`.

## 3. Standard depth

(§3 holds no C3 obligations — those live in §2's families and floors.)
- Provider adapters, compatibility/behavior surface: full contract-derived mocked
  L1/L2 every commit. **The T-11 enforcement slices (gate hook coverage,
  budget-observation timing, exact-session binding) are NOT "standard" — they are
  exhaustive L1/L2 members of E-1/E-2 (§2), with their bounded real remainder
  governed by §5.**
- Event inbox (B-13): serious L2 crash + subscriber-change coverage; **no** live
  campaign per release.
- Lifecycle commands (C-OP-LIFE): exhaustive **temp-filesystem and temp-git fault
  injection** — realism is never demonstrated by attacking the real checkout
  `[elicited]`. (The destructive containment slice is E-1, §2.)
- EpisodePlanner validator, event routing, onboarding ladder mechanics, learning
  *capture/projection* machinery: full contract-derived L2 coverage. (The learning
  **activation** boundary T-10 is E-1, §2 — not here.)
- RoadmapPlan/validation-contract/batch validators: full L1/L2 schema, graph, stable-ID,
  100-issue accounting, delta, lazy-plan, atomic-claim, role/session-isolation and
  recovery coverage. Direct operational work reuses existing event, approval and typed-
  effect contracts rather than inventing a low-assurance shortcut.
- Sequential comparison coordination: full contract-derived L1/L2 with real temp git,
  mocked providers/judge, candidate-isolation assertions, and kill-point sweeps. The
  E-1/E-2/E-3 slices above are exhaustive, not merely standard.

## 4. Deliberately thin (recorded, reviewable)

- Presentation: Markdown rendering, help text, cosmetic Live-UI behavior, prose
  layout, narrative polish → representative smoke tests. **The observer's
  confidentiality and source-truthfulness slices are NOT thin; the pixels around them
  are** `[elicited]`.
- S-5 (Support/Marketing) and S-6 (Distiller) quality: scaffolded, deferred while
  outputs are internal/inert; no large Distiller campaign before evidence volume.
- systemd: nothing real until the droplet shape is supported (B-05).
- B-17 non-GitHub live target: honestly future assurance until a disposable target
  exists; it is not an npm-release RQ-1 obligation and may never be called pass.
- Model-quality claims: Reviewer + Planner get the first statistical spend; Builder
  trajectory is deterministic scrutiny; the rest earn token budget from usage and
  consequence. "We ran the model three times" is three anecdotes wearing a badge —
  never claimed as coverage `[elicited]`.
- Selection-judge quality (S-8) may collect data after its golden scaffold lands, but
  remains advisory/inconclusive under F-PT-011 until calibration thresholds and sample
  design are human-ratified. A standalone showcase is not an exception.

## 5. Layer-3 spend policy (owner-ratified [simulated] seat; human-ratified 2026-07-31 with the release bound amended)

| Campaign | Scope | Bounds | On ceiling exhaustion |
|---|---|---|---|
| Pre-merge adapter-affecting | the **changed adapter only** | ≤ 2 provider turns; ≤ $5 recorded equivalent cost | completeness=`incomplete`; verdict per §7 (never `pass`) |
| Full release / qualification | all supported adapters + GitHub + unattended sandbox profile | ≤ 24 provider turns; ≤ $100 | completeness=`incomplete`; verdict per §7 (never `pass`) |

<!-- ratification 2026-07-31: release ceiling raised from ≤6 turns/$15 at the
owner's direction — "I don't want the test to be stopped just because of some
repeat things"; retries/repeat turns must not abort a campaign. The ceiling remains
a hard bound, raisable only by a human policy edit. Pre-merge bound unchanged. -->

Trigger rules `[elicited]`:
- **Adapter conformance:** exhaustive mocked every commit; real for the *affected*
  adapter pre-merge when adapter, gate-hook, session, usage, or auth-handling code
  changes; full across all supported adapters before release or
  assignment/model/CLI-version qualification.
- **GitHub smoke:** same trigger shape — merge, review, branch, or authentication
  changes; ordinary unrelated commits do not buy fake safety from GitHub.
- **launchd:** hermetic definition/tick tests every commit; real launchd exercised at
  installation/upgrade, before release when definition/identity/loading code changes,
  and after a material host/macOS change. Proof = loaded identity + attributable tick
  evidence + removal of exactly that definition; `launchctl` exit 0 proves very
  little.
- No $40 deep route for prompt adjustments. `[rambling]` governs: offline and
  hermetic first; live and expensive only where nothing cheaper can falsify the claim.

## 6. Future Layer-5 assurance outside RQ-1

The obligations in this section retain their owners, collectors, triggers, and hard
campaign ceiling, but do not enter RQ-1 completeness, verdict, qualification,
manifest campaigns, or cost ceilings. Their absence remains visible and is never a
pass. This is the owner-ratified 2026-08-04 disposition; the earlier activation timing
below is superseded only where it named release-gate activation.

- **Soak (owner-ratified, [simulated] seat):** initial autonomous qualification =
  **7 calendar days of ordinary laptop use**, ≥ 3 real sleep/wake cycles (one
  overnight), **sandbox targets only**, mostly token-free ticks plus a small number of
  bounded live turns, **$15 total ceiling**. Inspected: missed-window reconciliation,
  duplicate admission, WIP/lock behavior, settlement under retry and partial usage,
  state growth, retention sweeps, source-by-source health, and that **sleep never
  manufactures permission or green evidence**. NOT a 72-hour awake-laptop test — that
  validates a deployment shape that does not exist.
- **Retention boundaries (30/180/365-day):** proven exhaustively at L2 with seeded
  aged state and a controlled clock; the real soak proves only week-scale growth and
  sweep sanity.
- **Soak repeat trigger:** material change to scheduler, locking, settlement,
  retention, or deployment shape — never for prose, prompts, or renderer changes.
- **Threat model (C2+ skill obligation) — owner-ratified scope and timing
  (2026-07-31, `[simulated]` seat; human-confirmed 2026-07-31, then moved outside
  RQ-1 on 2026-08-04):** authored before droplet migration or first non-sandbox
  production onboarding. Scope covers the **trust boundaries behind the C3 control
  points**, not merely E-1 plus selected confidentiality surfaces:
  authority/gates/grants/approvals/critical-effect execution; secrets and credentials;
  cross-org/app identity and isolation; untrusted GitHub, event, repository, and
  model-provided content — including prompt injection and evidence forgery; provider
  tool calls, gate bridges, and app-owned subprocess/toolchain execution;
  managed-workspace, filesystem, symlink, and checkout boundaries; merge authorization
  and false-evidence attacks; learning capture/promotion injection; observer
  capability and confidentiality; replay, confused-deputy, resource-exhaustion, and
  denial paths. **Review trigger:** material change to a trust boundary, deployment
  shape, adapter capability, or externally reachable surface. Owner: human.
- **Contention exercise — owner-ratified (2026-07-31, `[simulated]` seat; human-ratified by adoption 2026-07-31):** locks are
  per-`(app, role)` under the lock directory (the directory is not one mutex); the
  org-wide WIP limit is 2. Exercise **≥ 10 simultaneously due candidates (5× WIP)
  across ≥ 3 apps, including duplicate stimuli for one `(app, role)`**, and drive the
  two admitted turns through **simultaneous terminal settlement**. Prove: never more
  than two live turns; never two turns for the same `(app, role)`; documented priority
  ordering preserved; every non-admitted candidate receives a typed decision (none
  vanishes); remaining eligible work reconsidered after capacity clears (no latency
  promise invented); locks, journals, and exactly-once settlements consistent under
  simultaneous completion. Never uniform throughput.
- **2026-08-03 revision trigger (owner-confirmed):** implementing roadmap admission,
  multi-ticket claims or cross-unit session reuse is a material scheduler/locking/
  settlement change and therefore repeats the existing contention exercise and seven-
  day sandbox soak. Add at least one multi-ticket code unit, one unit containing a
  human-only member, two affinity-compatible units, one affinity lure that is dependency-
  blocked, and a crash between unit terminals. Prove lazy EpisodePlan creation,
  all-or-none claims, per-unit settlement, typed batch dispositions, stale-roadmap
  refusal after sleep, and no Builder→Reviewer session reuse. Provider cache hit/miss/
  unavailable counts are collected only; no hit-rate threshold affects the verdict.
- **Comparative execution (conditional):** sequential V1 adds no new L5 campaign.
  Enabling automatic sampled activation or parallel candidate lanes adds a targeted
  comparison exercise: sticky sampling remains distribution-correct across restart;
  candidate workspaces never cross-read or collide; aggregate reservations and
  settlements reconcile under simultaneous terminals; retention bounds state growth.
  This obligation activates with that later feature slice, not before.

## 7. Completeness and verdict semantics (all expensive lanes)

Two **separate fields**, never conflated `[owner correction]`:
- **Completeness:** `complete | incomplete` (ceiling exhaustion or missing runs ⇒
  `incomplete`, partial evidence preserved).
- **Verdict:** `pass | fail | inconclusive` (Phase 5 decision-status rule in force).

Interaction rules: if collected evidence already proves a violation, the verdict is
**`fail` even when later runs are missing**; otherwise `incomplete` forces
`inconclusive`. `incomplete` can **never** produce `pass`, and it is not a fourth
verdict (INV-008/014).
