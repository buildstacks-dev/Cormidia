# Case catalog — Operon (product scope, matrix closure)

Status: derived to matrix closure (Phase 6, agent-alone per Division of labor §6) over
the ratified artifacts: system-map (J-01…J-18), invariants (INV-001…015), boundary-map
(B-01…B-17), contracts (22 canonical IDs), llm-eval-plan (S-1…S-7 and S-9; S-8 intentionally absent), risk-allocation
(E-1/E-2/E-3, floors, §5/§6 obligations). **This remains the design-derived
catalog, while executable authoring is tracked by `harness-backlog.md`.** As of
2026-07-31, Waves 0–4 are implemented under `claude-tests/`: through Wave 3 the
E-1/E-2/E-3 and evidence-agreement families are executable; Wave 4 adds the
CF-J02/CF-J03/CF-J10/CF-J16/CF-OPS-GROW/CF-IF/CF-S2-traj/CF-S9-env remainder.
The full L1/L2 gate is green (116 files, 726 passed, one intentionally parked
skip). Catalog closure does not imply separately gated L3/L4/L5 evidence.

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
| CF-HARNESS-CI | Per-commit workflow shape, fail-closed jobs, detector canaries, and actual merge-blocking enforcement. Workflow-shape checks are implemented; required-check enforcement is **BLOCKED:F-PT-018**. | 1 + CI | evid+det | FLOOR |
| CF-HARNESS-REPORT | Durable completeness/verdict truth table; exact-ceiling, unknown-partial-spend, corrupt-report, canonical-policy/golden-blob binding, and presentation negative controls | 1/2 | evid+refusal+det | FLOOR |

## 1. Journey matrix (J × success / refusal / interruption / recovery / alt-initiators+observations)

| Cell | Case family (what the cases assert) | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-J01-S | init/upgrade/use happy paths: complete org home, pointer, authority profiles per C-OP-LIFE §§1–3 | 2 | state | STD |
| CF-J01-R | every named collision/refusal class (existing org, nested, symlink, non-dir, incomplete org for `use`, wrong `--confirm`) refuses pre-mutation | 2 | refusal+diff | E1 (T-8 slice) |
| CF-J01-I | kill mid-init-staging / mid-upgrade-transaction at each journaled step | 2 | state+diff | E1 |
| CF-J01-RC | rerun after interruption converges; archived bytes restorable; ratified surfaces unreplaced | 2 | state | E1 |
| CF-J01-A | same op via packed vs source-backed launcher; removed-cwd guard | 2 | refusal | STD |
| CF-J02-S | bootstrap/new-app → registered; verify passes on healthy fixture; promote executes once | 2 | state+evid | STD |
| CF-J02-R | non-interactive bootstrap without answers refuses (audit row only); verify failure classes each named; promote refuses on failed verify | 2 | refusal | STD |
| CF-J02-I | kill during bootstrap writes / promote's config-commit-push-registry sequence | 2 | state | E1 (lifecycle journal) |
| CF-J02-RC | promote resumes exactly once across boundaries; bootstrap re-run idempotent | 2 | state | E1 |
| CF-J02-A | ladder claims per surface: no rung overclaim on CLI/JSON/observe (`generated≠registered≠runtime-ready≠live≠scheduled`) | 2 | evid | E3 |
| CF-J03-S | goal → persisted valid EpisodePlan → TicketPlan → published tickets w/ lineage, deps, only dep-free `op:ready` | 2 | state+evid | STD |
| CF-J03-R | C-OP-PLAN §1 refusal classes (incomplete scope w/ --execution-ready, unknown op/role, unapproved tuple, mismatched disposition, missing required source) all pre-provider | 1/2 | refusal | STD (validator depth per risk-allocation §3) |
| CF-J03-I | crash between plan persistence and publication; between ticket creates (partial publication) | 2 | state+evid | E2 |
| CF-J03-RC | recovery republishes idempotently via markers; no duplicate issues | 2 | evid | E2/E3 |
| CF-J03-A | plan --auto vs creator-scope routes produce same schema outputs; dry-run previews spend nothing, return exactProviderAuthoredPlan:null | 2 | evid+refusal | STD |
| CF-J04-S | full ready→merged walk on fake GitHub + scripted adapters: labels-after-artifacts at every stage | 2 | state+evid | E3 |
| CF-J04-R | gate-red, review REJECT, returned-after-3-cycles paths | 2 | state | STD |
| CF-J04-I | kill at every stage boundary (claim, branch, PR, review, merge) — the crash-point sweep. Recovery per journal/plan authority order is asserted; **disposition of ambiguous uncommitted builder bytes per ratified F-PT-004 (2026-07-31): preserve-and-inspect, never reset** (cases derivable — HB-P2) | 2 | state | E2 |
| CF-J04-RC | any tick advances any item from GitHub-derived state; pre-provider claim crash repairs without allowance; post-provider needs re-arm | 2 | state | E2 |
| CF-J04-A | manual human label edits observed not clobbered; depends-on/file-scope parallelism rules | 2 | state | STD |
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
| CF-J17-S | declared release: mechanism → fresh content-bound approval → at-most-once execution; acceptance vs completion recorded separately | 2 | evid | E1 (T-12) |
| CF-J17-R | no declared mechanism → ship gate fails; scoped-grant attempt refused | 2 | refusal | E1 |
| CF-J17-I | lost response / marker disagreement → ambiguous terminal | 2 | evid | E1 |
| CF-J17-RC | completion-marker converts crashed attempt; acceptance marker never does | 2 | evid | E1 |
| CF-J17-A | non-GitHub real round-trip: **BLOCKED:B-17-L3** | — | — | — |
| CF-J18-S | unattended composite on hermetic rig: full chain evidence at every reached link (fake timer × N ticks, scripted adapters/GitHub) | 2 | state+evid | E2/E3 |
| CF-J18-R | considered→named-non-admission or admitted (both halves of ratified J-18 criteria) | 2 | evid | E2 |
| CF-J18-I | typed non-green terminations (provider death, timeout, red gates, returned, drift, malformed verdict, ambiguity) each leave truthful morning state | 2 | evid | E3 |
| CF-J18-RC | multi-tick recovery across the composite (sleep window injected via fake clock) | 2 | state | E2 |
| CF-J18-A | **live unattended sandbox campaign** under test-mode profile: zero human decision rows, profile identity + sandbox target in evidence, publication blocked | 3 | live | E1/E2/E3 (≤$100 release campaign, amended 2026-07-31) |

## 2. State-machine matrix (machine × legal / illegal / replay / crash-point)

| Cell | Case family | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-SM-LOOP-L | every legal ticket transition (C-OP-LOOP §1) incl. returned/blocked/incident branches | 2 | state | E3 |
| CF-SM-LOOP-I | every illegal transition attempt (e.g. ready→merged, in-review w/o PR) refused/uncreatable | 2 | refusal | E3 |
| CF-SM-LOOP-R | replayed stimuli (same event/label seen twice) don't double-advance | 2 | state | E2 |
| CF-SM-LOOP-C | crash at each transition boundary | 2 | state | E2 (PRUNE-dup:CF-J04-I where identical) |
| CF-SM-APPR-L/I/R/C | approval item `pending→approved|denied→executing→executed|failed|ambiguous`: legal set, illegal jumps (approved→executed w/o executing), decision replay no-op, crash sweep incl. orphan-grant intermediate (B-09a) | 2 | state | E1 |
| CF-SM-GRANT-L/I/R/C | grant lifecycle (once: minted→consumed; scoped: minted→n-uses→expired/revoked): cap+1 refused, post-revocation/expiry refused, replay of consumed once-grant refused, crash between use and audit row (**outside-worktree never-scopeable mapping BLOCKED:F-PT-014**) | 2 | state | E1 |
| CF-SM-PLAN-L/I/R/C | EpisodePlan versions forward-only: legal revisions, illegal backward/edit-in-place, replayed revision idempotent, crash mid-persist (torn plan never terminal) | 2 | state | E2 |
| CF-SM-LADDER-L/I | evidence ladder monotonic claims; no surface implies a higher rung (illegal = overclaim) | 2 | evid | E3 |
| CF-SM-LADDER-R/C | PRUNE-dup:CF-J02-I/RC (ladder transitions are lifecycle ops) | — | — | — |
| CF-SM-LEARN-L/I/R/C | learning states candidate→published→authorized→active(+validated orthogonal): every silent-promotion path unrepresentable; publish replay no-op; crash per CF-J12-I | 2 | state | E1 (T-10) |
| CF-SM-EVENT-L/I/R/C | event pending→per-role-marked→retired: retire-before-all-marks illegal; refire-on-marked illegal; crash between mark and retire; **partial-file legality BLOCKED:F-PT-006** | 2 | state | STD |
| CF-SM-TURN-L/I/R/C | productive turn journal path `assembling→running→collecting→done`: phases in order, productive-phase skip illegal (error terminals may end the current phase honestly), same-phase replay idempotent, real SIGKILL at every productive phase (recognized intermediates only) | 2 | state | E2 |

## 3. Invariant matrix (INV × violation-paths / guardrail-response)

Seed adversarial cases are ratified in invariants.md; each row's family = those seeds
plus the guardrail's negative control (skill rule 16 — the detector proves it can fire).

| Cell | Family (violation paths → guardrail response) | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-INV-001 | 4 ratified seeds (widening config, injected memory/prompt authority, label/approval-as-authority, learning-path toolset change) → refuse/stop | 1/2 | refusal+det | FLOOR |
| CF-INV-002 | obfuscated deploy (heredoc/base64/nested shell); unknown tool type fail-closed; direct API mutation; Codex read-bypass generalized to write; **forbidden read via hook bridge** (git-push-to-default leg **BLOCKED:F-PT-013**) | 1/2 (+3 per §5 triggers) | refusal+det | E1 |
| CF-INV-003 | no-prior-decision execution; once-grant replay; changed-bytes-under-old-approval; scoped out-of-scope/expiry/cap+1/no-audit; ack-crash never re-performs | 2 | state+refusal | E1 |
| CF-INV-004 | cross-app event routing, sibling memory pull, cross-app approval consumption, reset-observed-from-sibling — every facet-mismatch stops | 1/2 | refusal | E2/FLOOR |
| CF-INV-005 | two-tick claim race; label-flip/claim-persist kill windows; pause/resume claim identity; re-arm-without-transaction refused | 2 | state | E2 |
| CF-INV-006 | kill-before-append + reconcile; double-settle attempt; usage-absent → unknown; blocked turn settles | 2 | state | E2 |
| CF-INV-007 | registry-pause + tick; overlay-pause + manual loop; mid-turn cap vs next-claim; divergent-admission structural check | 1/2 | refusal+state | E2 |
| CF-INV-008 | label-without-artifact sweep across all readers; GitHub-unavailable ≠ empty; usage-unknown ≠ $0; definition ≠ health; contradiction surfaces not compressed | 2 | evid | E3 |
| CF-INV-009 | post-APPROVE push → refuse (HEAD equality); guessed-base attempt; HMAC bytes bound to wrong commit; agent-identity merge attempt | 2 | refusal | E3 |
| CF-INV-010 | sibling-diff under reset; archive-write failure → no destruction; --force against fresh heartbeat/pending approval; wrong-remote guard | 2 | diff+refusal | E1/FLOOR |
| CF-INV-011 | seeded synthetic secrets → published issue / portable HTML / narrative / SSE / ticket body all clean; single-pattern-source structural check | 1/2 | evid+det | FLOOR |
| CF-INV-012 | APPROVE-prose w/o marker; "tests passed" w/o run; resolvable candidate; self-report in promotion metrics | 1/2 | refusal | E3/E1 |
| CF-INV-013 | kill mid-append/mid-rename/mid-journal per store class; truncated JSON rejected; quarantined bytes never valid state | 2 | state | E2 |
| CF-INV-014 | WIP-limited named reason; sweep-without-marks refused; spawn-failure post-decision; post-spawn bookkeeping failure named | 2 | evid | E2 |
| CF-INV-015 | error-branch sweep: corrupt HMAC key, missing charter, classifier throw, unreadable budget → each yields *less* capability, never more/greener (cross-family negative-control harness) | 1/2 | refusal | FLOOR |

## 4. Boundary matrix (B × success / timeout / partial-success / retry / duplicate / stale-read / version-skew)

<!-- changelog 2026-07-31 (reader test, new-engineer finding 4): collapsing
convention stated here, matching §5's. -->
**Row-collapsing convention (same as §5):** one family row per boundary stands for
its seven nominal failure-mode columns — the family text enumerates the modes;
separately-risky dimensions (the `-L3` live obligations) get their own rows. The §9
closure statement reconciles the 126 semantic cells against these families.
Failure-mode lists are ratified per boundary in boundary-map.md; each cell's family =
those modes under the honest fake, plus the fake/real conformance pair where an L3
obligation exists.

| Cell | Family | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-B01-{ok,to,ps,rt,dup,stale,skew} | scripted GitHub double: success ops; timeouts/rate limits; partial success (issue-no-label, merge-no-branch-delete); ratified 3-total-attempt jittered exponential retry (injected clock) for reads/idempotent exact-input operations, while ambiguous writes remain single-shot for marker reconciliation; duplicate-create detection; stale-read-after-write re-read; default-branch-moved + force-push skew. Lost-response mode in `ps`+`rt` | 2 | state+evid | E3 |
| CF-B01-L3 | **the GitHub live smoke** (risk-allocation §5 trigger: merge/review/branch/auth changes): real auth, squash-merge + branch-protection semantics, HMAC review submission, poll truth — on sandbox repos, spend-bounded | 3 | live | E3 |
| CF-B02-* | adapter core against scripted Anthropic: outcomes, tool-events w/o terminal, malformed verdicts, usage absent/partial, resume-mismatch typed, partial stream | 2 | state | E2 (T-11 exhaustive) |
| CF-B02-L3 | **Anthropic real-adapter conformance run** (same suite as the fake — drift guard; §5 trigger + bounds) | 3 | live | E2 |
| CF-B03-* | B-02 set + subprocess death mid-RPC, protocol skew, rotation events (checkpoint preserved; resume-exact-or-honest-stop), stale capabilities; forbidden-read + forbidden-write denial (hook bridge) | 2 | state | E1/E2 |
| CF-B03-L3 | **Codex real-adapter conformance run** incl. real forbidden-read + forbidden-write denial (§5 trigger + bounds) | 3 | live | E1/E2 |
| CF-B04-* | B-02 set + extension absent → terminal pre-tool failure; injected forbidden attempt reaches gate and is denied | 2 | refusal | E1 |
| CF-B04-L3 | **pi real-adapter conformance run**: real extension installation + real denied forbidden attempt (§5 trigger + bounds) | 3 | live | E1 |
| CF-B05-* | faked host surface: install/uninstall idempotency + refusals, status joins; unfakeable load-and-fire = CF-J16-A (L3) | 2 | evid | STD |
| CF-B06-* | fake-clock sweep: TTL, heartbeat 30s/2min/10min semantics, UTC windows vs host-time scheduling, missed-window (app,role,trigger,window) reconciliation, rollback/NTP/DST/timezone anomalies fail closed | 2 | state | E2 |
| CF-B07-* | kill-point injection harness; PID-reuse liveness; full journal↔lock PID/start/nonce binding before signal; nonce-bound serialized release refuses a late holder and cannot remove its successor; unknown/mismatched ownership refuses kill; signal-vs-terminal-write race; orphaned descendant cleanup; dead-child-fresh-heartbeat | 2 | state | E2 |
| CF-B08-* | PRUNE-dup:CF-J09-* (tick↔turn cells are exactly the J-09 families) | — | — | — |
| CF-B09a-* | continuation set persisted/validated; TTL expiry typed (**item disposition BLOCKED:F-PT-008**); orphan-grant intermediate recognizable, never usable authorization | 2 | state | E1 |
| CF-B09b-* | decision-entry: one-by-one + reason, batch same-rule per-item audit, widen human-only, revocation, concurrent decisions first-write-wins; unattended-profile prohibition cases (no forged human decisions; zero-decision evidence) | 2 | state+evid | E1 |
| CF-B10-* | fixture org-home sweep: invalid YAML, schema skew, missing AUTHORITY→legacy-conservative, mid-edit torn read, widening-narrowing refusal, preview→execute drift refusal; B-10a identity sweep (stale pointer, override disagreement, symlinked home, mismatched state-home) | 1/2 | refusal | E1/FLOOR |
| CF-B11-* | PRUNE-dup:CF-J12-* + CF-SM-LEARN-* (publisher boundary fully covered there) | — | — | — |
| CF-B12-* | reader seam: torn reads, stale-as-current refused, capability/traversal (CF-J15-R), SSE gaps, per-source health; conformance CLI/HTML/observe agreement (CF-J15-A) | 2 | evid | E3 |
| CF-B13-* | inbox sweep incl. duplicate-identity-different-payload (**BLOCKED:F-PT-006**), retention interplay, F-PT-005 add/remove semantics | 2 | state | STD |
| CF-B14-* | temp-checkout interference: dirty accept (ordinary), publish-only refusals, marked-block idempotency, byte preservation, foreign-link refusal, symlink/wrong-remote/path-overlap; **concurrent-edit outcome per ratified F-PT-007 (2026-07-31): compare-and-refuse, preserving human bytes** (cases derivable — HB-P4); re-run semantics **BLOCKED:F-PT-015**; publish-origin comparison **BLOCKED:F-PT-016** | 2 | diff+refusal | E1 |
| CF-B15-* | FS faults (full/read-only/perm/torn/ENOSPC) per store class; git faults (index.lock bounded wait, corrupt refs → re-clone, remote-changed identity stop, hooks-disabled, partial-command post-verify). Worktree-content preservation asserted up to the accepted-artifact line; **ambiguous-byte disposition per ratified F-PT-004 (2026-07-31): preserve-and-inspect, never reset** (cases derivable — HB-P2) | 2 | state+refusal | E2 |
| CF-B16-* | scripted gate commands: hang→timeout-kill, flood→ratified truncation bounds (256KiB/50 lines; 8k PR; 2k tail), missing tool typed, exit-0-lying (evidence binds to candidate SHA), candidate-mutation detection within governed scope, pending-fails-closed (bare template) | 2 | evid+refusal | E3 |
| CF-B17-* | scripted external target: accept-vs-complete split, lost response, marker disagreement, target-auth failure (grant consumed, evidence in audit), at-most-once; real round-trip **BLOCKED:B-17-L3** | 2 | evid | E1 |

## 5. Contract matrix (C × valid/invalid inputs / outputs / typed errors / idempotency / ordering / freshness+latency)

Each contract file's five parts generate the row set mechanically; the family asserts
every clause of the ratified contract text. Cells collapsed per contract (one family
spanning the six rows) except where a dimension is separately risky.

| Cell | Family | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-C-CORE | OPERON-C-CORE-001 all clauses: TurnRequest validity/refusals, envelope guarantees (**terminal-status enum clause BLOCKED:F-PT-017**), usage-as-provided-or-unknown, typed errors, never-auto-retry, budget observation at capability-matrix points, settlement | 1/2 | state+refusal | E2 (T-11) |
Eighteen boundary-contract families (B-09a and B-09b are separate contracts), one per
canonical `OPERON-C-B*-001` ID, each clause-complete (valid/invalid inputs, outputs,
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
| CF-C-OPLIFE | C-OP-LIFE §§1–6 + error split (precondition-refusal vs journaled-intermediate) | 2 | state+refusal | E1 (T-8 slices) |
| CF-C-OPPLAN | C-OP-PLAN §§1–5 (bypass conditions, plan production, previews, boot boundary, sources fail-closed) | 1/2 | refusal+state | STD (validator depth per risk-allocation §3) |
| CF-C-OPLOOP | C-OP-LOOP §§1–5 (vocabulary, claims, 3-cycle bound + fourth-cycle return, review/merge, parallelism) | 2 | state | E3 |
| CF-C-ACCEPT | journey-acceptance criteria as executable checks — PRUNE-dup: each criterion's cell in §1 (traces already resolve) | — | — | — |

## 6. Interface-adapter matrix (adapter × conformance / error-translation / cross-surface agreement)

| Cell | Family | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-IF-CLI | per-subcommand adapter conformance: parsing, exit codes, `--json` failure document (ok:false, stable error.code/message/remediation, no stderr prose prepend), dry-run token/write claims (audit-row exception), `--confirm` semantics | 2 | refusal+evid | E3 (claims) / THIN (help text) |
| CF-IF-JSON | schema stability + canonical key-sorting where claimed; no-active-org → `no_active_org` | 2 | evid | STD |
| CF-IF-UI | Live UI shell conformance: PRUNE-thin for pixels; confidentiality/truth slices covered CF-J15-* (not thin) | 2 | evid | THIN/E3 |
| CF-IF-HTML | portable report conformance: self-contained, CSP, no external requests, no L3 | 2 | evid | E3 |
| CF-IF-SKILL | `$operon` skill + capabilities/context discovery accuracy vs actual CLI surface | 2 | evid | STD |
| CF-IF-XSURF | one cross-surface agreement check: same fixture truth via CLI text, `--json`, observe snapshot, portable HTML (extends CF-J15-A to non-report ops) | 2 | evid | E3 |

## 7. LLM call-site matrix (S × deterministic-envelope / statistical-quality / trajectory / judge-calibration)

| Cell | Family | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-S1-env | C-OP-PLAN validator envelope (PRUNE-dup:CF-C-OPPLAN) + malformed-TicketPlan handling, format-repair path budget | 1/2 | refusal | STD |
| CF-S1-qual | planner golden set per scaffold (S-1a/S-1b axes incl. proportionality) — **inconclusive-only until F-PT-010** | 4 | stat | L4Q |
| CF-S1-traj/judge | PRUNE-na (planner is not agentic-looping here; no judge) | — | — | — |
| CF-S2-env | builder envelope: guardrail set (authority/boundary/gates/artifacts/spend) — PRUNE-dup:CF-INV-001/002/004/006 + CF-B16 | — | — | — |
| CF-S2-traj | ratified-grounds assertions (enforcement-fired, five anomaly detectors, escalation, paid-work preservation) + observed metrics; repeat-loop N=3 provisional | 2 | det | E2 |
| CF-S2-qual | builder-quality scaffold — deferred, **F-PT-011**; PRUNE-thin until ratified+funded | 4 | stat | L4Q (deferred/THIN) |
| CF-S2-judge | PRUNE-na | — | — | — |
| CF-S3-env | verdict marker/parser/HEAD-binding — PRUNE-dup:CF-INV-009/012 clause families | — | — | — |
| CF-S3-qual+judge | reviewer meta-eval per scaffold: seeded classes × severities + clean controls, per-pairing, **inconclusive-only until F-PT-009** | 4 | stat | L4Q (first-funded) |
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
| CF-S9-env | format-repair: same-session, bounded attempts, settlement — contract-only | 2 | state | STD |
| CF-S9-qual/traj/judge | PRUNE-na (contract-only site by ratified decision) | — | — | — |
| CF-COND | brief-conditioning study (informs, never gates) — sampling design OPEN under F-PT-011 | 4 | stat (non-gating) | THIN |

## 8. Operational-obligation matrix (obligation × load-at-contention / soak / resource-growth / clock-skew / abuse / recovery)

| Cell | Family | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-OPS-CONT | ratified contention exercise: ≥10 due candidates, ≥3 apps, duplicate (app,role) stimuli, simultaneous terminal settlement; six proof obligations. **Layer 5** — the question is "can load/contention hurt Operon"; the rig being hermetic describes the implementation, not the layer | 5 (hermetic rig, deterministic oracle) | state | E2 |
| CF-OPS-SOAK | 7-day sandbox soak per risk-allocation §6 (inspection list; $15 ceiling; completeness/verdict split) | 5 | live+evid | E2/E3 |
| CF-OPS-ROT | **Codex natural multi-hour auth-rotation under a long live run** (ratified L5 obligation, boundary-map B-03 / contract B-03): embedded in the 7-day soak as a named sub-obligation with **its own completion evidence** — at least one live Codex session spanning a real rotation window, with checkpoint/session-identity preservation asserted; if no natural rotation occurs during the soak, the sub-obligation reports completeness=incomplete (never assumed covered) | 5 | live+evid | E2 |
| CF-OPS-GROW | seeded aged-state retention sweep at 30/180/365-day boundaries under controlled clock; ledger-day-file protection rule | 2 | state | E2 |
| CF-OPS-SKEW | PRUNE-dup:CF-B06-* (clock anomalies) + soak's real sleep cycles | — | — | — |
| CF-OPS-ABUSE | threat-model-driven abuse cases: deferred until the ratified threat model exists (owner-ratified timing, risk-allocation §6); interim floor = CF-INV-001/002/011/015 adversarial families | 5 | mixed | E1 (deferred lane, declared) |
| CF-OPS-REC | PRUNE-dup:§1 interruption/recovery rows + CF-B07 (recovery is a modifier everywhere, not a lane) | — | — | — |

---

## 9. Closure statement

### 9.1 Triggered-lane implementation/evidence ledger (2026-07-31)

This ledger distinguishes executable machinery from external/human evidence; it does
not change matrix allocation or unblock any finding.

| Family | Implementation | Evidence status / executable path |
| --- | --- | --- |
| CF-B02-L3 / CF-B03-L3 / CF-B04-L3 | Complete | Real-pair suite at `claude-tests/fixtures/adapters/conformance.ts` + `live/campaign-live.test.ts`; no authorized provider campaign run. The Codex real pair cannot bind its hook socket in this desktop sandbox and remains runnable on an ordinary host/CI. |
| CF-B01-L3 | Complete | Real exact-sandbox GitHub surface implemented in `claude-tests/live/real-github-surface.ts`; no sandbox-repo campaign run. |
| CF-J16-A | Complete | Real launchd install/readback/attributable-tick/scoped-removal case implemented; no host campaign run. |
| CF-J18-A | Complete | `src/org/validation-test-mode.ts` + L3 case; no unattended campaign run. |
| CF-S1-qual | Runner + cases complete | Planner cases committed with `human_validation=pending`; threshold F-PT-010 open, so any run is inconclusive. |
| CF-S3-qual+judge | Runner + cases complete | Seeded reviewer/clean cases committed with `human_validation=pending`; F-PT-009 open, so any run is inconclusive and judge scores remain inadmissible. |
| CF-S2-traj | Complete | Deterministic trajectory scenarios committed; repeat-loop N=3 remains proposed only. |
| CF-OPS-CONT | Complete | `claude-tests/ops/contention-rig.ts`; ratified ≥10/≥3/WIP=2 shape green in hermetic self-test. |
| CF-OPS-SOAK / CF-OPS-ROT | Collector complete | `claude-tests/ops/soak-protocol.ts`; real seven-day/sleep/rotation evidence pending human scheduling. |
| CF-OPS-ABUSE | Gate only; blocked | `claude-tests/ops/threat-model-gate.ts` refuses the checked-in `awaiting_human_author` status. No abuse cases before HB-072. |
| CF-HARNESS-REPORT | Complete | Durable reports debit unknown failed-case spend conservatively, keep exact-ceiling coverage incomplete, bind canonical policy/golden inputs to authorized HEAD, and surface corrupt/inconclusive evidence without green. |

- HB-080 runbook: complete at `docs/qualification/validation-triage.md` and linked
  from campaign presentation surfaces.
- HB-081 inconclusive semantics: complete with product detector at
  `claude-tests/hermetic/cf-harness-report/campaign-report-surfaces.test.ts`.

- **Journeys:** 18 × 5 = **90 semantic cells, written as 86 table rows** (the single
  J-13 row covers its five dup-pruned cells). Accounting: **81 family cells + 9
  pruned/blocked cells** — J-06-A (na), J-10-A (na), J-13 ×5 (dup), J-16-RC (dup),
  J-17-A (BLOCKED:B-17-L3). CF-J10-I is a family cell carrying an embedded named
  block (F-PT-006). <!-- ratification 2026-07-31: J-07-I unblocked (F-PT-003
  ratified) — moved from the blocked count to the family count; CF-J04-I's embedded
  F-PT-004 block resolved (ratified line encoded in-cell). -->
- **State machines:** 8 machines × 4 rows = 32 cells → all traced (2 dup prunes; 1
  F-PT-006 block).
- **Invariants:** 15 × 2 rows → 15 families (violation+guardrail folded; every family
  carries its negative control).
- **Boundaries:** 17 numbered boundaries become **18 matrix entries** (B-09 splits into
  B-09a and B-09b) × 7 rows = **126 semantic cells** → traced via the §4 families
  (B-08, B-11 dup-pruned to their journey/state owners; finding-blocks named in-cell).
- **Contracts:** 22 canonical IDs = 18 boundary contracts (incl. B-09A/B-09B
  separately) + CORE + 3 OP → 22 clause-complete families; acceptance criteria
  dup-pruned to their §1 cells.
- **Interfaces:** 6 families incl. the single cross-surface agreement check.
- **LLM sites:** **8 site families (S-1…S-7, S-9) × 4 rows = 32 cells** → every cell
  now explicitly a family, PRUNE-na, PRUNE-dup, or finding-parked; no quality cell may
  yield pass/fail until its owning finding ratifies (L4Q category).
- **Ops obligations:** 7 rows → **5 families (CONT, SOAK, ROT, GROW, ABUSE-interim) +
  2 dup prunes**. Layer 5 holds CONT (hermetic rig, L5 by question), SOAK, ROT (named
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
| CF-REG-203 | #203 — `loop --follow` cut every ticket after the first from the base captured at loop start; the managed clone was never re-fetched, so merges landing mid-run were invisible to later tickets (third instance of the default-branch scar after #60/#101 — cached, not guessed) | INV-009 (base resolved, never guessed) · CF-J04-S (ready→merged walk) · CF-B15-* (git substrate) | T-7 | 2 | state | `claude-tests/hermetic/cf-reg-203/cf-reg-203-base-freshness.test.ts` |
| CF-REG-203-G | same defect, source-rule half: AGENTS.md's "never hardcode a default branch" rule needed a scanner that covers more than `origin/main` | INV-009 · CF-B15-* | T-7 | 1 | det | folded into `claude-tests/unit/cf-inv-009/default-branch-source.test.ts` (the CF-INV-009 structural pin, HB-030) |
