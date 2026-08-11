# Harness operator triage runbook

> **Paged RIGHT NOW? Jump straight to "## 0. First: establish live reality"
> (four commands) and then "## 1. Symptom-indexed triage" (quick-scan list +
> table).** Everything between this line and §0 is provenance and trust
> framing — real, but readable AFTER your first moves. <!-- changelog
> 2026-08-10 (reader test 34, operator finding 2): ~64 lines of meta preceded
> the first actionable command in a file claiming 2am self-containment. -->

<!-- changelog 2026-08-10 (Phase 8 reader test, operator findings 1/2/3/4/5): this
file was a 9-line pointer stub; the operator reader correctly found that useless at
2am. It now carries a self-contained symptom-indexed triage map derived ONLY from
the ratified corpus (every row cites its structures). The packaged canonical
mapping remains ../docs/qualification/validation-triage.md and WINS on conflict —
this file is the design-corpus fallback for a reader who has nothing else. -->

Canonical, packaged mapping: `../docs/qualification/validation-triage.md` (product
repo; linked from campaign surfaces — HB-080). **Consequence vocabulary — not a
graded severity ladder**: T-1…T-12 (system-map.md §5.2) are twelve **C3-equal
control points** naming *where* consequence concentrates; the actual severity
ladder is C1/C2/C3 (system-map §5.1/§5.4), and the only ordering among
simultaneous T-fires is §5.2's least-recallable-first sequencing heuristic.
<!-- changelog 2026-08-10 (reader test 12, operator finding 2): "severity
vocabulary" misled readers into treating T-numbers as sev ranks. -->
Expected behavior: the contract named per row below.

**Provenance of this file** <!-- changelog 2026-08-10 (reader test 14, operator
finding 1): the "skip to the runbook" instruction routed readers here without
disclosing this file's own ratification state -->: rewritten 2026-08-10 by the
rev-2026-08-10 campaign, whose product-owner seat was an **AI stakeholder agent**;
like everything that campaign produced, its assembly is **DRAFT pending
real-human ratification** (ratification-package.md §12). The triage *facts* in
each row restate **checkable primary structures whose source statuses vary** —
ratified invariants and contracts, but also `OPEN` findings, `PROPOSED` numbers,
and pending-ratification rulings, each checkable at its source <!-- changelog
2026-08-10 (final-gate follow-up 5): "independently ratified structures"
contradicted the row-by-row rule immediately below -->; what this file adds is
its selection and arrangement of them, which is unratified. **Row-by-row rule** <!-- changelog
2026-08-10 (reader test 16, operator finding 1): a paged reader could not tell,
per row, which part is ratified fact vs DRAFT judgment -->: in every triage row,
**each cited ID and its contract text retain the primary source's own status**
— ratified, `OPEN`, `PROPOSED`, or pending-ratification — and **citation here
confers nothing** <!-- changelog 2026-08-10 (final-gate follow-up 4): the
previous wording claimed every citation was ratified, which is false for e.g.
the pending-ratification CF-REVIEW-PROVIDER family unit and the proposed,
unbuilt B-18/B-19 -->; the row's
symptom mapping, first-move choice, and escalate-vs-act framing are the **DRAFT
overlay** on top of whatever status the source declares. **One header trap on
the way in** <!-- changelog 2026-08-10 (reader test 28, operator finding 1):
readers routed from a table row into a contract file hit "Status: DRAFT
(Phase 4)" at the point of use with the disclaimer one file away -->: **18 of
the 38** `contracts/*.md` headers still literally read `Status: DRAFT
(Phase 4)` — for exactly those files the label is preserved gate history
(AUD-105) and the contract is **ratified and binding despite it**; never
down-weight one of those because of its header. **Every OTHER contract file
declares its real posture** (RATIFIED/ACCEPTED/PROPOSED/ACTIVE/IMPLEMENTED/
design-only/none) **and that declared posture governs** — in particular,
proposed/design-only surfaces (e.g. B-18/B-19) are NOT upgraded by this note
<!-- scoped 2026-08-10 (final-gate follow-up 21): the first version said
"every … header" and "the contracts are ratified", a false universal that
would have upgraded proposed surfaces -->. If a row's instruction and its cited primary artifact ever seem to
disagree, the cited artifact wins and the row is a corpus bug to report.

**If in doubt about any finding's status or any two artifacts disagreeing:
`validation-policy.yaml → open_findings` wins; the human-ratified artifact wins
over its generated/machine mirror.** §2 below is the **canonical, complete
statement** of the tiebreak rules — this line and the README warning are summaries
of it, not parallel rules. <!-- changelog 2026-08-10 (reader test 7, operator
finding 6; reader test 9, operator finding 4: the three fragments now declare one
canonical home). -->

## 0. First: establish live reality (this corpus cannot know it)

This corpus is a design record, not a deployed-state oracle. Its only deployed-state
facts are a dated snapshot (F-PT-002, verified 2026-07-31: scheduler NOT installed,
all turns human-invoked, one live app). **Do not assume that is still true.** Run,
in order:

1. `cormidia scheduler status` — is anything firing autonomously at all?
2. `cormidia status` — org/app/loop state as the product itself projects it.
3. `cormidia doctor` — environment/identity checks.
4. `cormidia budget` (and `budget --reconcile` if ledger questions arise —
   reconcile back-fills idempotently from surviving evidence; CF-J08-RC).

If the scheduler is not installed/loaded, nothing autonomous caused your page.
Command output semantics live in the product docs; at the level this corpus
ratifies: surfaces render durable records, never wishes (INV-008), and
`inconclusive` on any surface is *not a pass* (HB-081).

## 1. Symptom-indexed triage

**Two companions for this table** <!-- changelog 2026-08-10 (reader test 19,
operator findings 1 and 2): the plain-English invariants page was unreachable
from the paged fast path, and the ID glossary was never linked from the table
that uses many namespaces; relocated + prefix list corrected same day
(final-gate follow-up 9: the note sat 60 lines above the table, listed unused
`S-`/`M-`, and missed `C-OP-`, `CORMIDIA-C-`, `L-ACC`) -->: (1) the sixteen
never-break promises in plain English — no IDs, one page — are
`owner-briefing.md` §2 (non-normative restatement; `invariants.md` stays
canonical); read it when a row's ID chain is too dense at 2am. (2) Every ID
prefix in this table (`T-`, `INV-`, `B-`, `F-PT-`, `HB-`, `CF-`, `J-`, `C-OP-`,
`CORMIDIA-C-`, `L-ACC`, `M1…M18`) resolves in the one-page **ID glossary at
`README.md` § "ID glossary"** — keep it open beside this table. (3) Before you
read a single "Escalate to the human when…" cell <!-- changelog 2026-08-10
(reader test 37, operator finding 6): the you-ARE-the-human reframe lived only
in §2, after the whole table -->: **this is a solo-operator install — if you
were paged, you probably ARE the human**; "escalate" means switching from
operator mode to deliberate owner mode (§2 decodes this fully; if you are NOT
the owner, §2's not-the-owner paragraph applies instead).

**Quick scan — one line per row, in table order** <!-- changelog 2026-08-10
(reader test 24, operator finding 1): the dense table had no first-pass index;
this list mirrors the rows below 1:1 and is derived from them — on any
divergence the full row wins. Reformatted same day (final-gate follow-up 16):
the first version was an inline dot-separated paragraph, so "one line per row"
was literally false -->:
1. unexpected merge / wrong branch
2. default-branch commit w/o PR
3. budget pause / exceeded
4. approval queue stuck
5. grant expired before resume (OPEN F-PT-008)
6. gate red / unit returned / a campaign or quality-lane VERDICT of `fail` (always the deterministic layer — no statistical threshold can fail today; status/log "fail" strings are not verdicts)
7. campaign `incomplete`
8. surface `inconclusive`
9. suspected secret
10. authority surface changed
11. non-GitHub deploy ambiguous (B-17)
12. Builder=Reviewer provider
13. looks adversarial
14. scheduler red / missed ticks
15. alive-but-stuck turn
16. job run stuck / double-spend
17. provider down / auth expired
18. git/FS distress (incl. B-14 human-checkout shapes — §1.5 holds its two open findings) <!-- changelog 2026-08-10 (reader test 39, operator finding 7): B-14 was reachable only by already knowing the id -->
19. post-crash unknown bytes (F-PT-004 ratified; B-14-adjacent)
20. tempted to `app reset` (T-8)
21. exit-0 lie
22. newer-adapter refusal — and gate-proof-missing on ANY adapter incl. core B-02…04
23. event never fires (OPEN F-PT-006)
24. org/app identity wrong
25. anything comparative-execution-shaped (design-only)
26. roadmap/validation/batch wrongness
27. learning-loop wrongness
28. Report/Observe vs GitHub
29. duplicate/orphaned turn (B-08)
30. observer scope exposure (B-12)
31. L-ACC report questions
32. **symptom not listed → last row**

| Symptom you observe | What it means (structures) | First moves | Escalate to the human when |
|---|---|---|---|
| Merge landed you didn't expect / wrong branch / commit after review | INV-009 (review binds exact HEAD; base resolved, never guessed), INV-012, T-7 | Read the PR: review commit id must equal merged HEAD. Check for post-APPROVE pushes. Do NOT force-push or revert-by-hand — history rewrite on foreign/default branches is human-only by ratified rule (CF-SPLIT-DESTRUCTIVE) | Any evidence the HEAD-equality rule passed a non-matching commit — that is a T-7 authority incident, immediately |
| Commit on the default branch with NO PR/review at all | T-7 adjacency with an **OPEN DESIGN QUESTION — F-PT-013**: whether a direct push to the remote default branch classifies `routine` or `critical`, and which component owns default-branch state, is undecided (the leg is parked, not covered) | Establish who pushed (agent identity vs human) from git authorship + invocation audit. A HUMAN direct push is outside the harness's promises; an AGENT direct push means the undecided classification just mattered in production | An agent-authored direct push: escalate immediately WITH the note that this is F-PT-013 firing, not a known-good behavior failing — the owner must ratify the classification, not just revert the commit <!-- changelog 2026-08-10 (reader test 2, operator finding 2) --> |
| App paused / "budget exceeded" / no headroom | INV-006/INV-007, M3, F-PT-003 (ratified: pause holds; exactly one budget-exceeded item eventually) | Confirm exactly one budget-exceeded item exists; run `budget --reconcile`; check ledger rows settle exactly once per provider turn | Zero or multiple budget-exceeded items for one pause (violates the ratified contract); or spend rows for a paused app |
| Approval queue growing / items stuck | CF-SM-APPR; PURPOSE v2.15: an undecided item EXPIRES (24h default TTL), releasing its claim without a merit failure | Wait for TTL or decide items on their merits. NEVER bulk-deny as queue hygiene — that corrupts the decision ledger the approvals exist to produce (the F-PT-020 lesson) | An item survives past TTL and still blocks `app verify`; or any approval you did not make appears decided under a human identity |
| Approved item, but the GRANT expired before the paused turn resumed | **OPEN DESIGN QUESTION — F-PT-008** (B-09a §3): whether this creates a fresh item, reopens the old one, or needs an explicit operation is deliberately unratified; decision records are immutable | Do not re-approve by reflex and do not hand-edit approval state. Record what you observe (item id, grant TTL, turn state) — it is exactly the evidence the owner needs to ratify F-PT-008 | Always — this shape has no ratified behavior yet, by design; your observation is input to the decision, not a fault to fix <!-- changelog 2026-08-10 (reader test 2, operator finding 1) --> |
| Gate red / delivery unit "returned" — including a campaign or quality-lane VERDICT explicitly reporting `fail` <!-- changelog 2026-08-10 (reader test 31, operator finding 3): the always-deterministic corollary was buried in the inconclusive row and unindexed; scoped same day (final-gate follow-up 24): "ANY fail anywhere" wrongly captured job/provider/effect statuses and log text --> | CF-J04-R, C-OP-LOOP §3: designed fail-closed — whole unit returns, no partial merge; 3 repair cycles then fourth-cycle return. **Corollary, load-bearing and scoped to VERDICTS: a campaign/quality-lane verdict of `fail` IS the deterministic contract layer** — no statistical threshold is ratified, so quality lanes can only report `inconclusive`; such a verdict is always real and actionable. (Job/provider/effect statuses and log strings containing the word "fail" are NOT verdicts — route them by their own symptom rows) | Nothing is broken: read the verdict evidence, let repair cycles run. A returned unit is a result, not an incident | The same unit returns repeatedly with the same cause, or a red gate did NOT stop a merge (that second case is a T-7 incident) |
| Live/eval campaign says `incomplete` / ceiling exhausted | Completeness/verdict split (risk-allocation): incomplete NEVER becomes pass; ceilings are hard bounds | Nothing to fix tonight. Preserved failed reports stay preserved; a successor candidate needs fresh authorized evidence | Never raise a ceiling yourself — that is a human policy edit by definition |
| Surface shows `inconclusive` | F-PT-009/010/011: no ratified threshold exists yet, by design. Two distinct shapes share the word <!-- changelog 2026-08-10 (reader test 6, operator finding 6) -->: (a) cases exist, only the threshold is unratified (Reviewer/Planner/SRE/Validation-Designer sets — human-validated data, no gate); (b) the set is SCAFFOLD/UNPOPULATED — zero cases ever authored (see each `golden-sets/*/README.md`) | No action either way. It is not a pass and not a failure; it means "no gate exists here yet" — but knowing (a) vs (b) tells you whether evidence exists to reason from at all. Corollary <!-- changelog 2026-08-10 (reader test 9, operator finding 3) -->: a statistical threshold **cannot report `fail` today** — no threshold is ratified anywhere; a campaign `fail` you see is therefore always the deterministic contract layer (real, actionable), never a quality score | Someone represents `inconclusive` as green or as release evidence |
| Suspected secret in output | INV-011 (FLOOR): one shared pattern list guards published issues, portable HTML, narratives, SSE, ticket bodies. **Also live here: F-PT-019/HB-135** — the ratified operation-aware `secrets-or-auth` gate-classifier rule is implementation-owed; the pre-split TEXT rule remains in force until HB-135 lands, so a secrets-adjacent command may today be gated by text-matching, not by what it emits <!-- changelog 2026-08-10 (reader test 30, operator finding 4): the ratified-but-unshipped classifier bore directly on this row and was cited nowhere in it --> | Check which surface. L3 run evidence (`brief.md`/`prompt.md`/`output.md`/`session.log`) is INTENTIONALLY verbatim local (F-PT-001) — a secret there is confinement working, not egress. If gating looks wrong around a secrets-adjacent command, check HB-135's landed/unlanded state before calling it a defect | A secret on any *published/exported* surface — T-4/T-12 incident, immediately, with the emitting surface named |
| A protocol/authority surface changed unexpectedly (`AUTHORITY.md`, `roles.yaml`, `TASTE.md`, `pipelines.yaml`, `prompts/**`, `apps.yaml`) | **T-3** — one leg of the corpus's own compound worst case (system-map §5.5); INV-001: agents NEVER rewrite their own authority — proposal-only, always; the tamper gate makes agent writes to protected surfaces refuse (CF-J12-R) | Establish WHO changed it: git authorship + invocation audit. A human edit is ratification business (was it deliberate?); an agent-authored edit means a T-10/T-1-class guardrail failed | An agent-authored change to any protocol surface: treat as the compound-worst-case leg it is — stop autonomous turns, preserve the bytes, escalate immediately; do not "fix" the surface before recording it <!-- changelog 2026-08-10 (reader test 9, operator finding 1) --> |
| External non-GitHub deploy/publication looks ambiguous or possibly duplicated ("did it apply? did it apply twice?") | **T-12 / B-17 / J-17**: 202-accepted ≠ deployed; acceptance and completion are DISTINCT typed markers; ambiguity is a terminal recorded state resolved by marker reconciliation, NEVER by blind retry (INV-003: never re-perform). **B-17's real round-trip has never been proven live — B-17-L3 is the corpus's one BLOCKED boundary** (no disposable target exists) | Read the executor's marker records (`executing`/`executed`/`failed`/`ambiguous`) before touching anything; check the acknowledgement separately from the acceptance. Do NOT re-run the effect to "check" — that is exactly the double-execution T-12 exists to prevent | An `ambiguous` terminal, a completion marker disagreeing with the target's observable state, or any sign the effect applied twice — escalate with the marker records; remember no live proof of this seam exists, so the contract text is your only map <!-- changelog 2026-08-10 (reader test 9, operator finding 2) --> |
| Builder and Reviewer resolved to the same provider (or provider family) | **Pending-ratification territory — CF-REVIEW-PROVIDER/HB-133 (TODO):** docs ratify "different provider" for review identity; whether that means provider FAMILY is a `[simulated]` seat ruling awaiting human YES (ratification-package.md §12.3 item 1); no detector enforces either reading yet | Same provider PRODUCT on both sides violates the unambiguous older reading — treat as a real review-independence incident (INV-012 adjacency). Same FAMILY but different products is exactly the undecided case: record the resolved tuple, don't force a reading | Same-product collapse: escalate as an incident. Same-family-different-product: escalate as ratification input for §12.3 item 1 — your observation is the evidence that decision needs <!-- changelog 2026-08-10 (reader test 14, operator finding 2) --> |
| Looks adversarial (forged approval, injected authority, exfil attempt) | NO authored threat model exists yet (HB-072 awaiting human author; abuse lane HB-073 gated on it). Interim floor: INV-001/002/011/015 adversarial families | Escalate first, investigate second. Trust durable records only — agent self-reports are never evidence (INV-012) | Immediately — adversarial triage is not delegated to this corpus by design |
| Scheduler health red / missed ticks | B-05/B-06; CF-REG-209 (WIP backpressure is NOT failure), CF-REG-211 (launchd env divergence class) | Distinguish backpressure from breakage via scheduler status; check launchd identity and PATH-dependent tools. **Non-launchd host** (early Linux/droplet migration): the ratified L3 proof surface is launchd-only today (B-05) — treat the scheduler as UNPROVEN there, prefer human-invoked turns, and escalate the migration question rather than trusting health output <!-- changelog 2026-08-10 (reader test 4, operator finding 7) --> | Duplicate/orphan scheduler definitions, or ticks firing for an org you did not install |
| Turn looks alive but isn't progressing (fresh-looking heartbeat, no work) | B-07 — the boundary's own defining nightmare: "we cannot prove how far it got"; liveness = PID + process-start identity + nonce, never PID alone; recovery happens at artifact boundaries (INV-013) | Check the turn journal's last durable phase (`assembling→running→collecting→done`; journals live under `state/turns/` per system-map §2.2 <!-- changelog 2026-08-10 (reader test 40, operator finding 4): the path was one hop away -->), not the heartbeat; a dead child with a fresh heartbeat is a recognized class (dead-child-fresh-heartbeat case, CF-B07). Do not kill by bare PID — PID reuse is exactly the trap | The journal shows a phase that never advances across two heartbeat windows, or lock ownership doesn't reconcile with any live process — kill via the owned process group path only, then let recovery replay from the journal <!-- changelog 2026-08-10 (reader test 3, operator finding 1) --> |
| Job run (`cormidia-job`) stuck, resumed oddly, or spent twice | M18 / J-22/J-23 / B-30: the journal is the SOLE completion authority; completed steps never re-execute; unchanged config resumes at ZERO provider turns; changed config REFUSES, never resumes; `completed (unverified)` ≠ `completed` | Read the job journal, not output files — completion is never inferred from an output's presence. A checkpoint parks the job into the approvals queue (one item, exactly). Verify the config hash hasn't drifted | A completed step re-executed, a resume that spent provider turns under an unchanged config, or a run that continued under a CHANGED config — each violates CORMIDIA-C-B30-001…003 directly <!-- changelog 2026-08-10 (reader test 3, operator finding 2) --> |
| Provider looks down / auth expired mid-turn / stream died | B-02/B-03/B-04 — the highest-churn failure domain (risk-allocation §1): rotation races, partial-stream-then-drop, tool intent without terminal event are all named modes | Expect fail-closed behavior: checkpoint preserved, resume-exact-or-honest-stop (B-03), usage rendered unknown—never $0 (INV-006/008). Check the turn's terminal status and ledger settlement; a blocked/interrupted turn still settles | A turn that neither completed nor settled; a resume that didn't match its fingerprint yet ran anyway; or provider death that produced a green verdict — those are contract violations, not provider weather <!-- changelog 2026-08-10 (reader test 3, operator finding 4) --> |
| Git/filesystem distress while processes look fine (`index.lock` held, corrupt refs, ENOSPC, read-only mount, permission errors) | B-15 — its own failure domain, independent of process health; ratified rules: `index.lock` gets a bounded wait ≤30s and a foreign lock is NEVER deleted/stolen; corrupt refs route to re-clone; managed clones run hooks-disabled | Free disk first if ENOSPC (torn writes are quarantined, never read back as truth — INV-013). Wait out or investigate a held `index.lock`; never rm it. Expect partial git commands to have been post-verified | A foreign `index.lock` older than the bounded wait with no owning process; a managed clone whose remote identity changed (identity stop, not an auto-fix); or state that had to be quarantined <!-- changelog 2026-08-10 (reader test 4, operator finding 1) --> |
| Post-crash worktree has uncommitted bytes you don't recognize | **Ratified F-PT-004 (2026-07-31): ambiguous uncommitted worktree bytes are PRESERVED-AND-INSPECTED, NEVER RESET** — the rule exists precisely for this moment | Do not `git reset`/`checkout --`/delete what looks like scratch. Recovery surfaces preserved bytes for inspection; builder work survives to the accepted-artifact line (B-15) | Only if preservation itself failed — bytes you can prove existed are gone. That violates the ratified contract and INV-010/013 <!-- changelog 2026-08-10 (reader test 4, operator finding 2) --> |
| Tempted to `app reset` a stuck app | **T-8 — the corpus's highest-severity containment risk**: "sibling damage = containment failure at the highest level." INV-010: archive-first, exactly-scoped, sibling-bit-identical; refusal on active runs/locks/journals/pending approvals; `--force` only against a heartbeat stale >10 min. **F-PT-012 (open):** interrupted-reset execute order is unresolved (prose vs deliberate code design) | Don't reset at 2am unless you must. If you must: plan-mode first (mutates nothing), confirm the archive step, never `--force` a fresh heartbeat. If a reset was killed mid-way, STOP — resumability semantics sit on open F-PT-012; record state and wait | Any sibling-app byte changed by a reset (containment failure, immediately); or a killed reset — escalate WITH F-PT-012 named rather than re-running it <!-- changelog 2026-08-10 (reader test 4, operator finding 3) --> |
| App gate/toolchain "passed" but the evidence looks wrong (exit-0 lie) | B-16: hang→timeout-kill, output floods truncated at ratified bounds (256KiB/50 lines; 8k PR; 2k tail), missing tool typed, and **exit-0-lying is a named mode** — evidence binds to the candidate SHA, not to the exit code | Compare the evidence's bound SHA against the candidate; check for truncation markers before trusting absence-of-output; a pending/bare gate template fails closed, it never passes | Evidence bound to the WRONG candidate SHA, or a green verdict whose gate evidence is missing entirely (INV-008/INV-012 territory) <!-- changelog 2026-08-10 (reader test 4, operator finding 4) --> |
| Newer-adapter turn refuses or errors (OpenCode / Cursor / Grok Build / Muse Code) | B-23…B-26 — each certified with a fail-closed gate proof, so their typed refusals are the gate WORKING: Cursor `error_gate_not_observed` (hook didn't fire — post-turn cross-check refused to call it completed); Grok `error_gate_unproven` (pre-spend handshake failed — grok's own hook runner fails open, so the adapter refuses instead); Muse `error_gate_seam_unavailable` (no seam exists on this build — permanently fail-closed off, no role assigned) | Treat these refusals as designed behavior, not outages: check the version band (claims are version-banded; a bump requires re-certification). Grok is **sandbox-only until the OPEN #339 human risk review clears**; Muse runs no live role at all. **The single L3 obligation status/evidence table is `validation-policy.yaml → layers → L3_live_sandbox → obligations`** — read it before trusting any adapter claim in prose, and read it correctly: `status: ACTIVE` means runnable-when-triggered, **never that it has run**; an adapter counts as PROVEN only where an entry carries an explicit certification field (`certified:`/`adapter_certification:`) AND its outcome/restriction fields don't withhold it (CF-B26: adapter fail-closed behavior certified, L3 outcome still `INCOMPLETE`; CF-B25: sandbox-scope restriction). CF-B01…B04 carry no certification fields — status alone proves nothing there <!-- changelog 2026-08-10 (reader test 29, operator finding 3); relabeled same day (final-gate follow-up 22): "which-adapters-are-actually-proven checklist" overstated the block — ACTIVE ≠ has-run --> | A turn on ANY adapter — **the core B-02/B-03/B-04 (Claude/Codex/pi) included, not only these four** <!-- changelog 2026-08-10 (reader test 30, operator finding 3): the highest-consequence class (T-1 gate classification, false-negative direction) had a routed row only for the newer adapters --> — that PROCEEDED to a critical effect without its gate-classification/approval record (executed action with no hook/handshake/approval evidence) — that is an INV-002 gate hole (T-1/T-11), immediately; also any Grok activity in a non-sandbox repo while #339 is open <!-- changelog 2026-08-10 (reader test 5, operator finding 7) --> |
| An event never seems to fire / event file sits unconsumed | **OPEN DESIGN QUESTION — F-PT-006**: whether producers must write atomically or the dispatcher tolerates partial files and retries is unratified; duplicate-identity-different-payload is likewise undecided (B-13) | Check the inbox for the file; malformed/unknown-kind events are retained loudly, not dropped (CF-J10-R). If the file looks partial or duplicated, preserve it — its bytes are ratification evidence | Always record-and-escalate on a partial or duplicate-identity event file: the expected behavior deliberately does not exist yet, so your observation is input to F-PT-006's decision <!-- changelog 2026-08-10 (reader test 3, operator finding 6) --> |
| Org/app identity looks wrong (`CORMIDIA_ORG_HOME` ambiguous, stale active pointer, config from an unexpected org) | B-10/B-10a: "correct config from the wrong org" is an IDENTITY failure, not a parser failure; named classes: stale pointer, symlinked home, state-home paired with the wrong org-home, dual retired+current roots (CF-REG-373 pinned the lifecycle matrix) | Run `cormidia context`/`org show`/`doctor` and compare — they must agree on the same boundary (cross-command agreement is pinned). Fix by explicit `org use`, never by hand-editing the pointer; nothing mutates the pointer as a side effect | Two commands disagree about which org is active, or any write landed under an identity you didn't select — stop everything first, identity failures multiply every other row <!-- changelog 2026-08-10 (reader test 8, operator finding 1) --> |
| Anything comparative-execution-shaped (candidate lanes, "selection", `cormidia compare`) | B-18/B-19 are **DESIGN-ONLY — this subsystem is not built** (HB-090…094 open; no `compare` implementation exists) | There is nothing real to triage: no candidate lanes, no selection, no materialization can have run | Any live artifact claiming to be comparative-execution output means someone built outside the ratified design — escalate as a structural surprise, with the artifact preserved <!-- changelog 2026-08-10 (reader test 8, operator finding 2) --> |
| Roadmap/validation/batch wrongness (issue dropped or double-assigned, stale frontier consumed, batch crash reran completed work) | B-20/B-21/B-22 — the corpus's named "silent wrongness" risk mode; the machinery's promises: EXACT issue accounting (no unaccounted/duplicate member), current-frontier reread before claim, per-unit journals so crash recovery never reruns completed provider work, INV-016 lineage continuously closed | Check the RoadmapPlan's accounting first (every open issue accounted exactly once); then the unit's own journal (not sibling/batch state); then the validation-contract hash chain through readiness→evidence→verdict | An unaccounted or twice-assigned issue, a frontier consumed after its plan was superseded, or completed provider work re-executed — each violates an exact machine promise (not a heuristic), so escalate with the specific record <!-- changelog 2026-08-10 (reader test 8, operator finding 3) --> |
| Learning loop looks wrong (concept active you never approved; publisher died mid-write; protected surface edited) | B-11/T-10: candidates NEVER self-resolve; the deterministic publisher is the sole protected writer, transactionally forward-complete-or-no-op by approval id; agents cannot write gate-protected surfaces (tamper gate) | Check the concept's state chain (candidate→published→authorized→active are distinct, rendered distinctly); a publisher crash resolves by replay — forward-complete or no-op, never half | An ACTIVE concept with no human authorization in its chain, or protected-surface bytes changed outside the publisher — T-10, immediately: a poisoned active concept steers many turns <!-- changelog 2026-08-10 (reader test 8, operator finding 4) --> |
| Report/Observe disagree with GitHub | INV-008: surfaces render durable local records; GitHub-unavailable ≠ empty; poll age is surfaced (B-01) | Check the observed poll age before treating disagreement as corruption; GitHub projections lag (the CF-REG-291/293 lesson) | Local durable records themselves disagree with each other |
| Duplicate/orphaned turn: a spawn record with no live child process, or a live child the org state doesn't account for <!-- changelog 2026-08-10 (reader test 23, operator finding 1): B-08's "two asymmetric nightmares" had no symptom row --> | B-08's two asymmetric failure shapes: durable spawn decision with no child (safe — next tick may retry), vs a real child with missing post-spawn bookkeeping (dangerous — the next tick is tempted to create a duplicate); INV-014 requires the durable reason code `post_spawn_bookkeeping_failure` for the second | Find the spawn decision record and match it against live processes (`cormidia status` + OS process list); look for the INV-014 reason code before assuming a bug; do NOT kill the unaccounted child by hand — ownership-token rules (B-07) govern who may signal | Two live turns exist for one claim, or a child ran with no durable spawn decision at all — either way an exactly-once boundary broke; preserve journals and escalate |
| Observer/report surface exposed something outside its scope (a path it shouldn't read, a foreign org's data, an SSE stream serving stale/foreign state) <!-- changelog 2026-08-10 (reader test 23, operator finding 5): B-12's traversal/token/scope failure class routed only via the generic secrets row --> | B-12 (observer/local-reader seam): named failure modes are capability-token absence, traversal/symlink escape, SSE cursor gaps — an access-scope failure class distinct from the INV-011 secrets row | Capture exactly what was exposed and via which surface; check whether a capability token was required and presented; treat traversal/symlink shapes as B-12 defects, not rendering bugs | Any exposure crossing an org or capability boundary — that is an access-control incident (INV-011-adjacent), not a display defect; escalate with the request path preserved |
| L-ACC campaign report questions | F-PT-029: NEVER release evidence; stopped-at-plan-gate = complete-for-plan-arm; `ungraded` is never a 0 | Read `acceptance/run-N-result.md` (product repo). Treat scores as information for the human | Anyone cites an L-ACC result as a release gate or coerces `ungraded` into a number |
| **Your symptom is not in this table** <!-- changelog 2026-08-10 (reader test 22, operator finding 8): findings without symptom rows (F-PT-015/016's build-time shapes) were reachable only by prior knowledge of the IDs --> | Two classes exist: (a) open findings whose shapes are build-time and deliberately have no row — enumerated in §1.5 below; (b) something genuinely new | Read §1.5 in full (it names where every open finding lives), then grep the canonical registry: `grep -o 'id: F-PT-[0-9]*, status: [a-z-]*' validation-policy.yaml \| sort` and search this file + `boundary-map.md` for any id matching your observation | Nothing matches anywhere: treat as a new finding — preserve evidence, escalate, and the observation becomes input to the registry (never improvise a rule) |

## 1.5 Known enforcement gaps — read before trusting a promise at face value

<!-- changelog 2026-08-10 (reader test 3, operator findings 3/5/7; reframed reader
test 4, operator finding 5): these are the OPERATOR-SALIENT gaps, not the complete
finding register. Canonical and complete: validation-policy.yaml → open_findings
(nine findings currently park cells: F-PT-006/008/012…018). Of the rest:
F-PT-012 is carried in the app-reset row, F-PT-013 in the direct-push row,
F-PT-006 in the event row, F-PT-008 in the grant-expiry row; F-PT-015 (bootstrap
re-run semantics) and F-PT-016 (publish-origin identity comparison ownership) —
both legs of the **B-14 human-checkout seam** <!-- changelog 2026-08-10 (reader
test 13, operator finding 3): the boundary named so a live B-14-shaped incident
routes here from the boundary id, not only from the finding ids --> — have
no symptom row because their shapes are build-time, not page-time — if either
surfaces in an incident (e.g. a bootstrap re-run mid-conflict), escalate with the
finding named; B-14's ratified half (F-PT-007 compare-and-refuse, preserving human
bytes) is covered in the post-crash-bytes and git/FS rows above. -->

**Read this section correctly** <!-- changelog 2026-08-10 (reader test 6, operator
finding 4): the corpus's honesty about open questions can read as reassuring when
it should read as a role change -->: when an incident lands on one of these open
findings, there is **no rule for you to follow — you are the decision-maker**, not
a rule-follower. The scripted part is only the posture: preserve evidence, don't
self-fix at machine speed, and treat what you record as the input the ratification
decision has been waiting for.

- **F-PT-014 (open):** INV-003 names "outside-worktree actions" never-broadly-
  scopeable, but `NEVER_SCOPEABLE_RULES` has **no rule mapping for that category**
  today — the nearest live classes are human-widenable. If an incident involves an
  agent acting outside its worktree under a widened grant, the stated promise had
  no mechanical enforcement behind it: treat as T-1/T-2-adjacent and escalate with
  F-PT-014 named.
- **F-PT-018 (open-known-limitation):** the private-repo GitHub plan offers no
  branch protection/rulesets, so "protected merge" is bounded by human merge
  discipline plus the release-blocking exact-tag rerun — **not** a mechanical
  block. An unexpected default-branch merge is therefore possible without any
  compromise; check this before assuming one (qualifies the T-7 rows above).
- **F-PT-017 (open-blocked-contract):** the ratified core contract says a provider
  terminal status is `interrupted`; the running code emits `timed_out`. If observed
  output disagrees with contract text on exactly this word, the system is not
  lying — the vocabulary decision is unratified and the enum-conformance clause is
  deliberately parked. **Practical grep rule** <!-- changelog 2026-08-10 (reader
  test 21, operator finding 2): the disclosure prevented panic but never said
  which string to actually search for -->: when searching logs/journals during a
  provider-death incident, **grep for `timed_out`** (what production emits
  today), not `interrupted` (the contract word) — or grep for both
  (`timed_out\|interrupted`) if artifacts of mixed vintage may be present.
- **F-PT-033 (open-blocked-contract)** <!-- changelog 2026-08-10 (final-gate
  follow-up 10) -->: the S-3 verdict-marker clause said the parser "refuses
  zero/two" markers; production deliberately parses duplicate IDENTICAL markers
  and refuses only DISTINCT conflicting values (vocabulary `approve|findings`,
  not `APPROVE|REJECT`). If you see a review artifact born from a pass output
  containing the same marker twice, that is the parser working as coded, not a
  bypass — the contract reading is unratified. Full grammar:
  `contracts/OP-loop.md` §4.

## 2. Standing prohibitions (all hours)

Never weaken a gate or golden set to make anything pass (tighten-only policy).
Never forge or bulk-record human decisions. Never read `archive-do-not-read/**`.
Ceiling raises, threshold ratifications, and protocol-surface edits are human
decisions — page the owner rather than improvising any of them.

**"Escalate to the human," decoded for the current deployment shape** <!-- changelog
2026-08-10 (reader test 2, operator finding 3) -->: this is a solo-operator install
(system-map §0), so if you were paged, you probably ARE the human. The instruction
then means: **stop, don't self-fix at machine speed** — switch from operator mode to
owner mode, make the decision deliberately and durably (a ratification, a policy
edit, a recorded approval), never as an inline patch under incident pressure. There
is no other contact to find. **If you are NOT the owner** (a future
multi-person install, or covering someone's pager) <!-- changelog 2026-08-10
(reader test 31, operator finding 6): the runbook assumed operator = owner
throughout; the no-authority path was unstated -->: take no ratification-shaped
action — preserve evidence, rely on the fail-closed defaults (they hold without
you), record what you saw in the incident note, and wait for the owner; nothing
in this runbook requires an unauthorized decision to keep the system safe.

**If mirrored content disagrees** (case-catalog.md ↔ case-catalog.yaml — a true
generated pair; or any prose artifact restating the policy's finding registry —
a summary-mirror relationship, NOT a structured pair, since no machine findings
mirror exists <!-- changelog 2026-08-10 (final-gate follow-up 5): the old
wording called policy ↔ harness-state.yaml a paired-artifact relationship,
contradicting the no-findings-block acknowledgment below -->) <!-- changelog
2026-08-10 (reader
test 2, operator finding 5) -->: the disagreement is itself a corpus bug to report,
and until it is fixed your first-move tiebreak is — **the human-ratified artifact
wins**: `case-catalog.md` over its generated YAML, and `validation-policy.yaml`
(tighten-only, ratified) over the machine-written `harness-state.yaml`. Never edit
the generated/machine file by hand to force agreement. **Detecting drift: the
catalog pair takes one command; finding-status drift takes a reference printout
plus manual audit** <!-- changelog 2026-08-10 (reader test 16,
operator finding 5; scoped by final-gate follow-up 5: only the catalog check is
a self-contained comparison — the grep below prints canon but compares
nothing --> — for the catalog pair, from `validation-design/`:
`awk -f case-catalog-generator.awk case-catalog.md harness-backlog.md | cmp - case-catalog.yaml`
(silence = no drift; any output = drift, report it). For the finding registry
there is no generator, and `harness-state.yaml` deliberately has **no machine
findings block** — its `open_ratification_items` is a prose summary, and the
policy names `harness-design-state.md` as its mirror <!-- changelog 2026-08-10
(final-gate follow-up 4): the previous text directed comparison against a
`findings:` block that does not exist -->. This command is a **canonical
reference printout, not a comparison**:
`grep -o 'id: F-PT-[0-9]*, status: [a-z-]*' validation-policy.yaml | sort`
prints all **33** id/status pairs (F-PT-001…033 <!-- changelog 2026-08-10
(reader test 32, operator finding 1): said 32 — stale since F-PT-033 was
minted; the count drifted in exactly the way this paragraph teaches you to
report. Do not hard-trust ANY count here: the printout itself is canon -->);
you must then **manually audit** each F-PT
mention in a prose artifact (`harness-design-state.md`, `harness-state.yaml`,
`boundary-map.md`, this runbook — find them with `grep -n 'F-PT-' <file>`)
against that printout — any status claim the printout contradicts is drift, and
the policy wins. No executable end-to-end check exists for prose-status drift;
HB-140 makes only the catalog check a per-commit gate. **General rule for
finding-status drift** <!-- changelog 2026-08-10 (reader test 5, operator
finding 8): the pair that actually broke (boundary-map prose vs the policy
registry) wasn't named here -->: on ANY disagreement about an F-PT finding's
status between prose artifacts (boundary-map, contracts, state file, this
runbook) and `validation-policy.yaml → open_findings`, **the policy registry
wins** — it is the declared single source of truth; the prose is a stale mirror
to report and repair. These two clauses are one principle at two grains <!--
changelog 2026-08-10 (reader test 15, operator finding 3): readers asked whether
the pair-tiebreak and the drift-tiebreak could conflict --> — "the ratified
source of truth beats its mirror" — and they cannot conflict: the pair rule
picks WHICH artifact wins for whole-file disagreements; the drift rule picks the
policy registry for the specific field (F-PT status) whose single source of
truth the policy declares. Where both apply, they select the same winner
(`validation-policy.yaml`).
