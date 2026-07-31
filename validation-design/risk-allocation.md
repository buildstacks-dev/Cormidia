# Risk tiers, coverage allocation, and layer-5 obligations — Operon

Status: CONFIRMED at the Phase 6 hard stop (weighting, 2026-07-31, round 3); human-ratified 2026-07-31 — release-campaign spend amended at ratification, see §5 (ratification-package.md §9). <!-- AUD-105 -->
Provenance: probability judgments and allocation calls `[elicited]` (Phase 6 ramble);
cost axis inherited from ratified system-map §5 (T-1…T-12); spend/soak numbers are
**owner-ratified this campaign** (`[simulated]` seat — human-ratified 2026-07-31,
release bound amended, §5); `[PROPOSED]` marked where designer-originated.
This allocation is encoded into `validation-policy.yaml` at Phase 8 and is the surface
a future audit diffs deliberate-thinness against.

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
- **E-2 — Turn durability and money, together.** One-app isolation, admission, pause
  enforcement, provider partials, settlement conservation, crash recovery, preserved
  paid work, no duplicate continuation. Money and recovery are one family because the
  expensive failures occur *between* their state transitions.
  (INV-004/005/006/007/013; T-5/6; B-02/03/04 core, B-07/08/15, adapter core.
  **T-11 adapter-enforcement slices are cross-cutting E-1/E-2 members** — the gate
  hook, budget-observation, and exact-session guarantees implement both families.)
- **E-3 — Merge and evidence truth.** Exact HEAD, resolved default branch, fresh
  checks, review authorization, orchestrator-only merge; every morning-screen claim
  distinguishing missing / stale / contradictory / decided / executed / verified.
  False green is the amplifier that lets every other defect run for a week.
  (INV-008/009/012/014; T-7/9; B-01, B-12, C-OP-LOOP.)

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

## 4. Deliberately thin (recorded, reviewable)

- Presentation: Markdown rendering, help text, cosmetic Live-UI behavior, prose
  layout, narrative polish → representative smoke tests. **The observer's
  confidentiality and source-truthfulness slices are NOT thin; the pixels around them
  are** `[elicited]`.
- S-5 (Support/Marketing) and S-6 (Distiller) quality: scaffolded, deferred while
  outputs are internal/inert; no large Distiller campaign before evidence volume.
- systemd: nothing real until the droplet shape is supported (B-05).
- B-17 non-GitHub live target: honestly BLOCKED until a disposable target exists.
- Model-quality claims: Reviewer + Planner get the first statistical spend; Builder
  trajectory is deterministic scrutiny; the rest earn token budget from usage and
  consequence. "We ran the model three times" is three anecdotes wearing a badge —
  never claimed as coverage `[elicited]`.

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

## 6. Layer-5 obligations

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
  (2026-07-31, `[simulated]` seat; human-confirmed 2026-07-31: human-authored, on
  the critical path to release-gating reactivation):** authored **before the earliest of**: release
  gating moving from `SUSPENDED` to active; droplet migration; first non-sandbox
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

## 7. Completeness and verdict semantics (all expensive lanes)

Two **separate fields**, never conflated `[owner correction]`:
- **Completeness:** `complete | incomplete` (ceiling exhaustion or missing runs ⇒
  `incomplete`, partial evidence preserved).
- **Verdict:** `pass | fail | inconclusive` (Phase 5 decision-status rule in force).

Interaction rules: if collected evidence already proves a violation, the verdict is
**`fail` even when later runs are missing**; otherwise `incomplete` forces
`inconclusive`. `incomplete` can **never** produce `pass`, and it is not a fourth
verdict (INV-008/014).
