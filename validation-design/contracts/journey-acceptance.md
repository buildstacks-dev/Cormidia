# Journey acceptance criteria — Cormidia (product scope)

Status: DRAFT (Phase 4). Given/when/then at behavior level; each criterion traces to an
invariant or contract (trace in brackets). These are ticket-shaped: they travel with the
feature/change that touches the journey. Compact by design — 2–4 per journey; the case
catalog (Phase 6) expands them mechanically.

**Trace resolution.** Bracketed traces use short aliases; every alias resolves to a
canonical `CORMIDIA-` ID via this table (each contract file carries its canonical ID in
its header):

| Alias | Canonical ID | | Alias | Canonical ID |
|---|---|---|---|---|
| core adapter | CORMIDIA-C-CORE-001 | | B-10 (incl. B-10a) | CORMIDIA-C-B10-001 |
| B-01 | CORMIDIA-C-B01-001 | | B-11 | CORMIDIA-C-B11-001 |
| B-02 | CORMIDIA-C-B02-001 | | B-12 | CORMIDIA-C-B12-001 |
| B-03 | CORMIDIA-C-B03-001 | | B-13 | CORMIDIA-C-B13-001 |
| B-04 | CORMIDIA-C-B04-001 | | B-14 | CORMIDIA-C-B14-001 |
| B-05 | CORMIDIA-C-B05-001 | | B-15 | CORMIDIA-C-B15-001 |
| B-06 | CORMIDIA-C-B06-001 | | B-16 | CORMIDIA-C-B16-001 |
| B-07 | CORMIDIA-C-B07-001 | | B-17 | CORMIDIA-C-B17-001 |
| B-18 | CORMIDIA-C-B18-001 | | B-19 | CORMIDIA-C-B19-001 |
| B-08 | CORMIDIA-C-B08-001 | | C-OP-LIFE | CORMIDIA-C-OPLIFE-001 |
| B-09a | CORMIDIA-C-B09A-001 | | C-OP-PLAN | CORMIDIA-C-OPPLAN-001 |
| B-09b | CORMIDIA-C-B09B-001 | | C-OP-LOOP | CORMIDIA-C-OPLOOP-001 |
| INV-NNN | CORMIDIA-INV-NNN | | T-NN | system-map §5.2 control point (not a contract ID) |

**Journey aliases** (`J-04/05/07/08` in J-18's composite trace) are not contract IDs:
they are **intra-document references** to this file's own journey sections, whose
criteria each carry their own resolving traces. A journey alias never satisfies a
traceability requirement by itself.

Operation contracts carry the internal-operation promises journeys trace to where no
Phase 3 boundary owns them.

## J-01 Org create/upgrade/use
- Given any collision (existing org, generated-path collision, symlink), when init
  executes, then nothing is mutated and the collision is named. [C-OP-LIFE §1, INV-010/013]
- Given an interrupted upgrade, when rerun, then it converges with the archived bytes
  restorable and ratified surfaces unreplaced. [C-OP-LIFE §3, INV-013, B-10]
- Given only the retired default state root, when Cormidia first resolves an org, then
  it atomically relocates the root and repairs active path identities; given both roots,
  it refuses before mutation rather than merging state authorities. [B-10, INV-004/013]

## J-02 Onboarding / evidence ladder
- Given a successful bootstrap, when any surface reports state, then the claim is at
  most "registered" — never runtime-ready/live/scheduled. [INV-008]
- Given `app verify` passes, when promote previews, then promotion is offered; given
  any verify failure, promote refuses with the failing rung named. [B-10, INV-008]

## J-03 Planning
- Given a goal, when planning completes, then a schema-valid persisted EpisodePlan
  exists before any delivery turn, and published tickets carry Planned-by lineage,
  dependencies, acceptance criteria, with only dependency-free tickets `op:ready`.
  [C-OP-PLAN §2, INV-008/012]
- Given an incomplete creator scope, when submitted with `--execution-ready`, then it
  fails before provider construction — never silent EpisodePlanner fallback. [C-OP-PLAN §1]
- Given planning prose without a durable plan, then the episode reports failure — prose
  is not an artifact. [INV-012]

## J-04 Delivery loop
- Given a claimed ticket, when each stage completes, then its label flips only after
  the artifact exists (PR before `op:in-review`, merge evidence before closure).
  [INV-008]
- Given an APPROVE verdict, when merging, then review commit_id == candidate HEAD,
  checks fresh on that SHA, base resolved from remote, merge by orchestrator. [INV-009]
- Given remediation or review cycles 1–3 have been exhausted, when a fourth cycle would
  be required, then the ticket returns (`returned`) rather than looping. [C-OP-LOOP §3]

## J-05 Critical-op approval → execution
- Given a gate block, when the turn ends, then it ends `blocked_on_gate` with the exact
  op persisted for review. [INV-002/003]
- Given an approval, when a later tick executes, then execution consumes the exact
  grant and records executing→terminal; ambiguous is terminal-until-reconciled, and no
  surface reads approved as executed. [B-17, INV-003/008, T-12]

## J-06 Approval-wait resume
- Given a paused pass and a decision (approve or deny), when resumed, then the same
  session/claim continues with the decision as guidance; any fingerprint mismatch stops
  before spend. [B-09a, INV-005]

## J-07 Budget enforcement
- Given a turn crossing its per-turn cap, then it stops at the adapter boundary.
  [core adapter §5]
- Given monthly spend ≥100%, when the next tick runs, then the app cannot claim new
  spend and a budget-exceeded item exists in the single queue. (Crash-seam
  convergence: F-PT-003 ratified 2026-07-31 — pause holds; exactly one
  budget-exceeded item eventually; cases via HB-P1.) [INV-007]

## J-08 Settlement
- Given any terminal provider turn (incl. failed/blocked/cancelled), then exactly one
  ledger row exists keyed (app, providerTurnId); unknown usage renders unknown, not $0.
  [INV-006]
- Given a missed settlement, when `budget --reconcile` runs, then it back-fills
  idempotently from surviving evidence. [INV-006/013]

## J-09 Dispatch tick
- Given any considered (app, role, trigger, window), then a durable named reason exists;
  given nothing due, no adapter is constructed. [INV-014, B-08]

## J-10 Event intake
- Given one valid pending event, then **each eligible current subscriber eventually
  runs exactly once** (one turn per eligible subscriber — possibly across ticks, subject
  to named per-tick blockers, with no latency promise) and is **never silently
  skipped**; a subscriber that becomes eligible while the event remains pending likewise
  runs exactly once; **an ineligible current subscriber (e.g. channel-gated) remains
  pending and keeps retirement open**; the file retires only when every current
  subscriber is marked or removed. [B-13]
- Given a malformed or unknown-kind file, then it is retained loudly with its code.
  [B-13, INV-014]

## J-11 Audience roles
- Given scheduled Support/Marketing work, then outputs are internal artifacts/drafts;
  any external publication path requires its own exact-payload approval + execution
  acknowledgement. [B-17, INV-003]
- Given an SRE health analysis, then analysis-complete and incident-filed are separate
  recorded claims, with exactly one source-linked `op:incident` issue. [INV-008/014]

## J-12 Learning
- Given any learning artifact, then its state (candidate/published/authorized/active/
  validated) is explicit and no surface promotes one into another without the ratified
  actor. [B-11, INV-012]

## J-13 Recovery
- Given a crash at any journaled phase, when the next actor runs, then recovery starts
  from the authority order (intent → plan → route → step → evidence), consumes no
  allowance pre-provider, requires re-arm post-provider-ambiguity, and never re-performs
  an external effect. [INV-003/005/013, B-07/B-08]

## J-14 App reset
- Given reset execution, then the checksummed archive exists before any destructive
  mutation; only the named app's authorized destructive set is touched; siblings,
  human checkouts, the repo, default branch, and closed history are bit-identical.
  [INV-010]
- Given active runs/locks/journals/pending approvals, then reset refuses; `--force`
  crosses only the stale-heartbeat (>10 min) condition. [INV-010]

## J-15 Observation
- Given any source unavailability or disagreement, then the surface names the source
  and affected claims — no green-by-absence, no blended "degraded". [B-12, INV-008]
- Given any snapshot/SSE/export, then no L3 content and no secret-pattern match crosses
  the boundary. [INV-011]

## J-16 Scheduler lifecycle
- Given install/uninstall, then preview-then-confirm with exact identity; given status,
  then health = joined evidence, never a definition file alone. [B-05, INV-008]

## J-17 Release handoff
- Given a merged deployable milestone, then deploy executes only under a fresh
  content-bound approval, **at most once — exactly once only where completion evidence
  proves the effect** — with acceptance and completion recorded separately. [B-17, T-12]

## J-18 Unattended composite
- Given considered due work, then it either receives a named non-admission reason
  (budget, WIP, lock, channel, approval, pause) or becomes admitted. [INV-014, B-08]
- Given admitted work under an accepted plan, then every link actually reached
  (decision → plan → turns → gated actions → artifacts → merge boundary → settlement)
  leaves its evidence, and the journey terminates in either a verified result or a
  **typed non-green outcome** (provider/auth failure, timeout, red or exhausted gates,
  returned review, source/config drift, malformed verdict, external ambiguity) —
  merge and external effects occur only when their own preconditions pass; the morning
  surfaces report the terminal state truthfully per J-15 criteria.
  [composite: INV-005/006/008/009/014, J-04/05/07/08]
- Given the unattended sandbox profile, then zero human decision rows exist, profile
  identity + sandbox target are in evidence, and publication/non-sandbox effects
  remained blocked. [B-09b; `validation-policy.yaml` `unattended_test_mode_profile` —
  human-ratified as shaped and implemented in Cormidia 2026-07-31; no green claim can
  rest on the implementation before an authorized CF-J18-A campaign produces complete
  evidence]
  <!-- changelog 2026-07-31: pointed to the existing draft policy (final-gate fix). -->
  <!-- ratification 2026-07-31: profile confirmed as shaped (package §3 item 11). -->

## J-19 Per-turn comparative execution

- Given one comparison, when any candidate runtime starts, then every candidate is
  bound to the same role/operation/base/context/authority/expected outputs, differs
  only by exact assignment and sample index, stays in its isolated namespace, and
  settles exactly once. [B-18, INV-001/002/004/006/010]
- Given candidate terminals, when selection runs, then required deterministic and
  grounded clauses filter eligibility before any qualitative judgment; failed clauses
  cannot be outweighed by judge preference, cost, or style. [B-19, INV-008/012/015]
- Given an uncalibrated or inadmissible judge and multiple eligible candidates, when
  selection terminates, then the outcome is advisory/inconclusive and follows the
  explicit fallback; no surface calls the judge ranking selected, qualified, or green.
  [B-19, INV-008/012/015]
- Given an admissible selection or an explicit standalone human choice, when winner
  materialization runs, then exactly the content-bound selected artifact continues;
  losing artifacts perform no outward effect and ordinary downstream review/ship gates
  remain mandatory. [B-18/B-19, INV-002/009/010/013]
- Given standalone `cormidia compare`, when preview, execution, and materialization are
  used, then no org or GitHub is required, preview spends no tokens, candidates mutate
  only external comparison worktrees, and materialization creates only a new local
  winner branch without touching the active branch. [B-18/B-19, INV-004/010/013]
