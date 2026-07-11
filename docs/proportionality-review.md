# Proportionality Review: One Ticket, Fifty-Five Passes

Status: historical analysis (2026-07-10) — **the §5 plan has landed**:
Stage 1 (PR #5), Stage 2 (PR #6), Stage 3 (PR #7), Stage 4 (PR #8,
live-verified), Stage 5 (PR #9, ratified), Stage 6 core (PR #10) with its
deferred follow-ups A4 release handoff (PR #13), dispatch invocation rows
(PR #14), and adapter toolset shaping (PR #15), and the Stage 7 harness
(PR #11). §7 records benchmark round 1 and its fix (PR #12). Kept
unrewritten as the record of the episode and the reasoning. This is the
systemic review of the 2026-07-10 buildstacks.dev episode — why a simple
bootstrap became complex, where the time and money actually went, and the
plan to fix it.

Companions, and how to read the three documents:
- **This document is the master.** Read it first: it names the systemic
  causes and owns the staged plan of action (§5). The other two are its
  detail volumes.
- `docs/telemetry-review-and-proposed-fixes.md` — why the org could not *see*
  any of this while it was happening. Read second. Its staged fix **is**
  Stage 1 of the plan here.
- `docs/bugs-to-be-fixed.md` — the point defects hit during the episode.
  Read last, as a reference backlog. Most entries are *instances* of the
  systemic causes named here and are absorbed by Stages 2–6; they get fixed
  as part of those stages, not as a separate 19-item march.

Scope separation, per the operator's direction: this plan improves
**Operon**, not buildstacks.dev. The app, its 19 open tickets, PR #23, and
the org home are left frozen as the benchmark baseline; the org workflow
gets re-attempted only after the sandbox benchmark passes (Stage 7).

All dollar figures are Operon-computed equivalent-cost estimates for
subscription-backed providers, summed from `runs/**/envelope.json`.
All times UTC.

Planner transcript totals use one provider message per unique
`message.id`. Claude's JSONL transcript repeats the same assistant message and
its usage once per emitted content block, so summing rows directly
double-counts usage. Gross Planner input below is uncached input + cache
creation + cache read after that deduplication.

---

## 1. Executive summary

The org was asked, in effect, to bootstrap a personal website. Twelve hours
later it had produced: one open, unmerged PR containing an Astro scaffold.

| Measure | Value |
| --- | --- |
| Tickets planned | 19 (for a personal website) |
| Tickets attempted | 1 (#2, the scaffold) |
| Claim cycles on that one ticket | 21 |
| Loop passes executed | 55 (20 contract, 15 implement, 6 fix, 7 gates, 7 review) |
| Loop spend (estimated) | **$266.41** — 88.8% of the app's $300 monthly cap; 53.9M input / 543k output tokens |
| Planner spend | unrecorded by Operon; recovered post-hoc from provider session logs: **5.89M gross input / 78.7k output tokens** across 8 sessions, 71 minutes (54.1k uncached + 330.3k cache creation + 5.51M cache read) |
| Agent compute time | 169 minutes; **zero subagent turns**, though delegation is configured for every role |
| Human approval decisions | 42 recorded (28 approved, 14 denied; 30 raised by Reviewer passes) + ~20 manual requeues + 2 session interrupts |
| Wall clock | ~12.5 hours, including a 5-hour stall on a hung pass; six run records left permanently `running` |
| Delivered to `main` | **nothing** — PR #23 open (7,299 added lines, 6,374 of them lockfile; the only page ships an empty `<body>`), ticket left `op:building`, 18 tickets untouched |
| What `operon budget` said throughout | $0.00 |

A clean run of the same ticket through the same pipeline costs roughly
$30–40 and five to seven passes. So ~85% of the spend was churn, and the
churn was not caused by agent incompetence — the contract the Builder wrote
at 08:40 was semantically identical to the one it wrote at 17:08. The system
made the agents redo everything, over and over, under supervision that had
to be applied one label and one approval at a time.

Four systemic causes, one amplifier:

1. **Planning optimizes decomposition, not delivery.** The protocol tells the
   Planner to maximize atomicity ("one ticket equals one PR") with no
   proportionality bound, no stage model, no cost model. A website became 19
   tickets before any code existed — serial, gated on a foundation ticket
   that explicitly forbade product output.
2. **The loop preserves no forward progress.** Every failure returns the
   ticket, and every re-claim rebuilds the loop's state from the GitHub
   labels alone — contract, findings, review cycles, and attempt counters
   all reset to zero — so each new claim re-runs the full pipeline from the
   contract pass even when the branch, commits, and PR already exist.
   21 claims → 20 contract passes.
3. **The human gate spends attention on the wrong risks.** 42 decisions in an
   afternoon, dominated by false-positive secret rules, single-use grants that
   expire immediately, agents repeatedly attempting actions the protocol
   forbids (eight identical denials for the same global-memory write) — and
   an approval model that kills the pass instead of pausing it.
4. **The release handoff does not exist.** The ship pipeline ends at a
   review check plus the merge; no role or trigger is configured to deploy,
   and environment readiness is discovered inside expensive model turns
   instead of by token-free preflight. Even a perfect run would have
   stopped at a merge.
5. **Amplifier: the org was flying blind.** Budget read $0.00 against $266
   of real spend; the planner recorded zero tokens; a hung pass was
   indistinguishable from a running one for five hours. Nobody could see the
   churn while it was happening — which is why it ran for twelve hours.
   (This is the telemetry document's subject.)

---

## 2. The episode, reconstructed

Sources: `~/.operon/<org>/runs/buildstacks.dev/*/envelope.json` (55 passes),
`telemetry/*.jsonl` (8 planner rows), `approvals/log.jsonl` (115 events),
GitHub issue #2 timeline (80 label transitions), PRs #1/#21/#22/#23.

| Phase | Window | What happened | Est. cost |
| --- | --- | --- | --- |
| Onboarding | ~05:00–07:52 | Bootstrap + onboarding PR #1 merged | unmeasured |
| Planning | 07:55–10:02 | 8 interactive sessions, 71 min: 19-ticket dependency graph; invented label taxonomy, then corrected it; briefly wiped all 19 issue bodies via a shell bug, then repaired them (the publication session emitted 32.7k deduplicated output tokens); 2 memory PRs opened, never merged. Four of the eight sessions were "requeue ticket #2" recovery sessions — the Planner used as a label-flipping repair tool | recorded as $0 |
| Build attempts 1–5 | 08:40–10:10 | Five full pipelines: baseline-before-changes deadlock return; offline-sandbox `pnpm install` return; **$15.50 budget kill**; $20.92 gate-blocked turn; one completed implement whose gates then read a stale command snapshot | $79 |
| Stall | 10:10–15:07 | Fix pass and gates phase stuck in `running` — no watchdog, no terminal status, no heartbeat | — |
| Build attempts 6–16 | 15:07–16:22 | Eleven more claim cycles: `.npmrc` secrets false positives, recovered-but-retained escalations ending pipelines `blocked_on_gate`, setup-gate TTY failure, and the unchecked-acceptance-criteria gate burning all three bounded remediation passes on a governance-only failure. Each bounce restarted at the contract pass | $111 |
| PR and review | 16:22–17:36 | PR #23 opens. Review round 1 interrupted → only recovery was relabel to `op:ready` → **full build pipeline re-ran twice** to get back to review. Round 2 completed; another rebuild; round 3 completed with findings | $46 |
| Final fix | 17:36–17:45 | Fix pass received five findings, then looped against a `secrets-or-auth` escalation until the **$30 per-turn cap killed it** (5.9M input tokens, `output.md` is one line: the budget-overrun notice). Yet the pass had already committed and pushed its fix — `3dbd9d0` is the head of PR #23. The work landed; the `failed` status lied about it. Ticket left `op:building` | $30 |

Ticket #2's label history is the episode in miniature: `op:ready ↔
op:building` twenty-one times, with the human applying every single
`op:ready`. The human was the retry loop.

### Where the money went

| Category | Estimate | Mechanism |
| --- | --- | --- |
| Contract re-derivation (19 redundant passes) | ~$65 | Full-pipeline restart on every claim. The three sampled briefs are byte-identical asks; the three sampled outputs are the same contract reworded. The Builder's memory index read "(no documents yet)" all day |
| Discarded implement work (15 passes, ~2 needed) | ~$100 | Blank-slate re-claims; budget kills mid-turn; pipelines marked blocked after the agent had already recovered |
| Budget-kill strandings (within the above) | $67 | $15.50 + $20.92 + $30.32 — caps fired mid-turn with no preflight estimate and no resume path |
| Governance-only remediation (3 fix passes, 15:35–15:48) | ~$23 | Quality gate required human-ratified checkboxes to be checked before a PR existed; Builder cannot fix that by definition, so all bounded attempts burned |
| Repeated review rounds (3 × verify, 2 × security, 2 × perf) | ~$9, 34 agent-min | Interrupted review is unresumable; the only path back to review was a full rebuild |
| Productive work (contract + implement + one review + fixes) | ~$30–40 | What a clean single cycle costs |

### Where the human's time went

42 recorded approval decisions (median 3.3 minutes from raise to decision;
one batch blocked a review pass ~15 minutes), roughly 20 manual `op:ready`
relabels, two interactive-session interrupts, plus continuous terminal
supervision. Escalations by rule: 24 `secrets-or-auth` (mostly false
positives on a credential-free `.npmrc`), 6 `self-merge-or-approve`, 6
`production-deploy`, 3 `outbound-network`, 3 `destructive-or-irreversible`.
Eight of the fourteen denials were the *same denial* — the agent attempting
to write global provider memory, denied with the same explanation every
time, because no lesson carries from one pass to the next.

---

## 3. Root causes

### RC1 — Planning optimizes decomposition, not delivery

`prompts/plan/decomposer.md` commands: *"Emit atomic, testable, scoped,
ordered tickets. One ticket equals one PR."* There is no ticket-count
budget, no proportionality rule, no model of what a ticket costs the org,
and no notion of project stage. Applied to a greenfield personal website,
"atomic" faithfully yields 19 tickets — a favicon ticket, a 404-page ticket,
an RSS ticket — each destined for its own full pipeline, PR, review, and
human ratification. Seven were labeled `op:tier-deep` (the maximal pass
set: contract, implement, gates, verify, security-deep, perf-scale,
ship-check, plus human sign-off on acceptance criteria). The scaffold
ticket alone, at observed churn rates, consumed $266; the 19-ticket backlog
at even the *clean* per-ticket rate is $300–500 and days of supervised wall
clock — for a site an agent can produce in a single sitting.

The planning pipeline itself has the same disease: five passes (visionary,
two competing PMs, arbitrator, decomposer) regardless of whether the product
is a marketplace or a blog.

Two aggravations make it worse than mere count:

- **The decomposition was serial by design.** Ticket #2 was the only
  dependency-free ticket; all eighteen others were blocked behind it. And
  its contract explicitly forbade product output — "No page content, no
  design tokens, no components." So the maximum possible yield of the
  entire day was, *by design*, a page with an empty `<body>`. The plan
  guaranteed that no visible product could exist until at least the second
  ticket merged.
- **Review was over-applied for the stage.** Because #2 was `deep` and its
  file scope matched the high-risk and perf globs, every review round ran
  all three dimensions (verify + security-deep + perf-scale) on a scaffold
  with no users, no data, and no deployment. Review depth should follow
  project stage, not just file globs; a bootstrap needs one verify pass.

The deeper miss: the Planner never asks *"what stage is this project in,
and what is the smallest set of shippable units that moves it to the next
observable milestone?"* For a bootstrap the honest answer is **one**.

### RC2 — The loop preserves no forward progress

Evidence from the artifacts, with the mechanism confirmed in code:

- 21 claims produced 20 contract passes. Contract briefs across the day are
  byte-identical; contract outputs are the same contract re-derived
  (~$3.40 and ~2.5 minutes each time).
- **Re-claims are blank-slate by construction.** `itemFromIssue`
  (`src/loop/loop.ts:147-162`) rebuilds the loop item from issue
  number/title/body/labels only: `contract: undefined`, `findings: []`,
  `cycles: 0`, `remediationAttempts: 0`. The branch and worktree *are*
  reused (`createWorktree` early-returns if present,
  `src/loop/loop.ts:1209-1220`), but the loop doesn't *know* anything about
  them — pipeline selection (`src/loop/driver.ts:147-152`) picks `fix` only
  when in-memory `cycles`/`findings` are nonzero, which after a reset they
  never are. So the fix pipeline is reachable **only within the same turn
  that produced the findings**; every new turn runs full `build`.
- **The durable data existed and was never consumed.** The contract is
  posted to the issue as a comment (`src/loop/loop.ts:409-410`) but never
  read back. The open PR is only consulted late, inside the gates phase
  (`ensurePr`, `src/loop/loop.ts:1064-1075`) — never when deciding what
  pipeline to run. The fix pipeline's briefs *do* carry `[findings]` and
  `[history]` ("attempt 1 of 3…") — the plumbing exists — but on re-claim
  the counters that feed `[history]` are zero, so the section is omitted
  and the builder starts blind. Builder memory stayed "(no documents yet)"
  through all 55 passes.
- Interrupted states are dead ends: a failed or interrupted turn throws
  without touching labels, wedging the ticket in `op:building` or
  `op:in-review`; the documented recovery is relabel to `op:ready` and pay
  for the whole build pipeline again. That single defect cost two full
  rebuilds between 16:34 and 16:52 — and it is how the day ended
  (`op:building`, nothing merged). Six run records remain permanently
  `running`, and the final "failed" fix pass had in fact pushed its work
  (`3dbd9d0`) — terminal statuses describe the turn, not the work.
- **Review findings are pass-lifetime too.** A first-round security finding
  (pin GitHub Actions to immutable SHAs) silently disappeared from later
  review rounds — never fixed, never rebutted; the branch still uses
  mutable `@v4` tags. Findings need a durable ledger where every item ends
  as *fixed* or *rebutted*, and carries forward until it does.
- **Delegation never happened.** Zero subagent turns across all 55 passes,
  despite every role configuring delegation allowances — the fan-out that
  could have parallelized exploration and verification was never exercised
  (adapter support for subagent surfaces is part of the known
  `tool_use`-emission gap).
- A hung pass is indistinguishable from a running one (no heartbeat, no
  watchdog, no terminal status on interrupt) — five hours lost.
- **There is no cross-turn attempt cap anywhere.** The remediation bound
  (3), review-cycle bound (3), and the 12-iteration driver guard are all
  in-memory per turn and reset on every claim. Nothing ever said "this
  ticket has bounced eight times; stop and summon the human with a digest."
  The only actors that re-arm `op:ready` are the Planner's groom pass
  (advisory prompt language, unenforced) and the human — who performed all
  20 re-arms in this episode by hand.

At least eight entries in `docs/bugs-to-be-fixed.md` (stranded budget
aborts, unresumable review, stale command snapshots, stale briefs, the
governance deadlock, the stalled planner, gate-output loss, approval-store
bypass) are instances of this one cause.

### RC3 — The human gate spends attention on the wrong risks

The safety design is right to exist; it is aimed wrong and it forgets.

- **False positives dominate.** 24 of 42 escalations were `secrets-or-auth`,
  mostly reads or formatting touching a repo-local `.npmrc` containing only
  `engine-strict=true`. The final $30 pass died *fighting this rule*.
- **Approvals don't stick.** Grants are single-use with an action-hash
  scope, so the same rule re-fires minutes later on a near-identical
  command. The same human judgment was requested dozens of times.
- **An approval interrupts by killing.** An escalation terminates the pass;
  after the human approves, nothing resumes — the grant buys a fresh
  restart of the pipeline, not continuation from the approved action. The
  human pays twice: once with the decision, once with the re-run. (30 of
  the 42 escalations came from Reviewer passes.)
- **Forbidden acts are deniable instead of unreachable.** Reviewer passes
  attempted self-approval (6×), production deploys (6×), and global-memory
  writes (8×). Each attempt cost an escalation, a human decision, and agent
  tokens. The role's prompt and toolset should make these actions
  impossible to attempt, not merely refusable at runtime.
- **No lesson memory.** Every denial the human wrote — thoughtful,
  reusable text — evaporated after the pass that triggered it.
- **Calibration inverts intuition.** Deleting a temp folder *inside the
  ticket worktree* trips `destructive-or-irreversible`; meanwhile the truly
  scarce resource, twelve hours of human supervision, was spent freely.

### RC4 — The release handoff does not exist

The intended shape — build, review, then a publisher ships it — cannot
complete under the current configuration. The `ship` pipeline contains only
a Reviewer ship-check plus the mechanical merge; there is no deploy trigger
after merge. The SRE role is an observer (the app runbook assigns it
post-deploy smoke checks, not deployment), and no other role or event is
configured to publish. Even a perfect run of this episode would have ended
at a merge, with nothing reaching production. Environment readiness has the
same unowned quality one step earlier: registry access, network grants, and
non-interactive installs were each discovered broken *inside* expensive
model turns rather than by a token-free preflight.

### RC5 (amplifier) — Flying blind

Covered fully in the telemetry document: loop spend never reaches the
ledger, the budget cap is unenforced, planner sessions record zeros, and
there is no live or historical view. The consequence for *this* review: the
churn was invisible in real time, so it ran to exhaustion instead of being
stopped at attempt three. Observability is not a reporting nicety; it is
the feedback loop that makes every other fix verifiable.

---

## 4. Principles: how simple things stay simple

Proposed as the standard the fixes below are measured against — and as
future prompt/protocol language (those surfaces are human-ratified; changes
go by proposal PR).

- **P1 — Proportionality.** Process weight scales with blast radius, not
  with ceremony class. Default to the smallest independently shippable
  milestone, normally **1–3 tickets** and one PR per coherent review boundary.
  More requires explicit justification through parallelism, ownership,
  rollback isolation, or materially different risk — never decomposition for
  its own sake.
- **P2 — Stage-aware planning.** The Planner's brief includes the repo's
  actual state, open PRs, and the last episode's outcomes; its output
  includes "why this many tickets" with a stage-based ticket budget
  (bootstrap: 1–3). A plan that produces more process than product is a
  failed plan.
- **P3 — Forward progress is sacred.** Contract, branch, PR, gate results,
  findings, and denial lessons are ticket-lifetime state, not pass-lifetime
  state. Resume beats restart everywhere. Attempt N sees attempts 1…N-1.
  Bounded attempts, then park with a digest for the human.
- **P4 — Human attention is the scarcest resource.** Escalate only genuine
  irreversibility or exfiltration; scope destructive rules to
  outside-the-worktree; grants carry an explicitly ratified scope, TTL, and
  retry/use policy; denials become durable role memory; forbidden acts are
  unreachable by construction.
- **P5 — Every turn settles its telemetry** (telemetry doc, Defect B). The
  org can always answer "what did this day cost, per ticket, per role, per
  pass, and why" in one command.
- **P6 — Preflight before spend.** Environment readiness — registry
  reachability, network grants, non-interactive installs, TTY assumptions —
  is verified by token-free probes before any model turn starts. A pass
  never discovers a $0 environment problem with a $7 model turn.
- **P7 — A milestone has an explicit release disposition.** Every plan names
  whether the result deploys, publishes a package, becomes release-ready, or
  intentionally ends at merge — and who owns the next action. A deployable
  milestone whose required release step is unowned is unfinished.

---

## 5. Plan of action

This plan improves **Operon only**. The buildstacks.dev org — PR #23, the
19 tickets, the org home, the 747 MB worktree — stays frozen as the
benchmark baseline and as evidence; nothing there is fixed, merged, or
cleaned as part of this work. The app re-enters at Stage 7, when the
improved Operon takes a fresh shot at the same class of work and we compare.

Each stage is independently shippable. Order chosen so that we can *see*
first, stop *paying the churn multiplier* second, stop *generating
disproportionate work* third — then prove the whole thing with a re-run.
The separate Claude skills-home packaging defect remains in the bugs backlog;
it is not part of these stages or a dependency of the benchmark.

### Stage 1 — Make the org observable (telemetry doc, Stages 0–2)

Defect B first (loop spend → ledger, budget actually enforced,
`--reconcile`), then the planner-usage fix, then the read-only view over
`runs/`. Exit criteria as written there. Everything after this stage
becomes measurable instead of anecdotal.

### Stage 2 — Continue from durable artifacts (biggest dollar lever)

This stage is artifact-level continuation, not literal provider-session
resumption.

- Rehydrate ticket-lifetime state from durable artifacts that already exist:
  contract comments, branch/worktree, open PR, PR findings, and prior run
  records.
- Hash the ticket body and skip the contract pass when the existing contract
  still applies. Consult the PR *before* pipeline selection; a PR with open
  findings enters `fix`, never `contract`.
- Persist a per-ticket claim-attempt counter. After N claims (propose N=3),
  stop claiming and park as needs-human with an assembled evidence digest.
- Carry prior verdicts, attempt history, open PR, and unresolved findings into
  briefs. Findings remain open until individually *fixed* or *rebutted*.

Exit criterion: interrupt a ticket after contract, after implementation, and
during review; each new process continues at the correct artifact boundary
without re-deriving completed work.

### Stage 3 — Settle, stop, and preflight operational work

- Add inactivity watchdogs and honest terminal reconciliation. Status reports
  both turn outcome and durable work outcome (committed/pushed/PR updated).
- Run token-free environment preflight before a model turn: registry access
  under the selected policy, non-interactive setup (`CI=true`), and required
  commands.
- Run budget preflight before expensive passes. A cap stop preserves the
  durable artifacts and leaves an explicit artifact-level continuation path.
- Settle interrupted, blocked, and cap-stopped passes exactly once into the
  Stage 1 ledger.

Literal suspension of a live provider session across a human approval is
deliberately deferred. Stage 2 continuation captures most of the economic
benefit without imposing a provider-specific session-lifecycle design.

### Stage 4 — Proportional planning (biggest calendar lever)

- Rewrite `prompts/plan/decomposer.md` (and the planning templates that
  feed it) per P1/P2: milestone-first, ticket-count budget by stage,
  decomposition requires justification, tier calibration guidance
  (greenfield pre-users ≠ `deep`; `deep` is for auth/payments/data-loss
  surfaces). Human-ratified surface → proposal PR.
- **One-shot bootstrap path:** a new app's first milestone runs as a single
  build ticket through one pipeline cycle by default.
- Stage-aware planner input: current repo truth (fresh clone — bugs doc),
  open PRs, last-episode telemetry summary.
- Non-interactive planning on the real runtime with schema-validated,
  orchestrator-published tickets (bugs doc: co-planning, label contract,
  transactional publication — all three land here).
- **Review depth follows stage without weakening security:** a pre-users
  bootstrap defaults to the single verify pass, whose security lens remains
  always-on. Separate security-deep and perf-scale passes arm only when their
  additional isolation is justified by the actual surface and risk.

Exit criterion: from a clean greenfield repo, the Planner produces a valid,
publishable 1–3-ticket bootstrap plan through the configured runtime without
agent-authored shell publication.

### Stage 5 — Ratify the safety and release boundary (documentation only)

Current PURPOSE decisions specify one-by-one human review and expiring,
single-use, action-hashed grants for a later retry. They do **not** authorize
same-pass suspension/resumption, multi-use standing grants, or batched
decisions. Before implementation, submit a human-ratified PURPOSE amendment
that resolves:

- later retry versus suspending and resuming the same live pass;
- single-use action hashes versus rule/path-scoped multi-use grants;
- one-by-one versus batched same-rule decisions;
- deploy ownership: orchestrator-triggered CI, SRE, or another named owner.

The proposal includes a threat model, adapter feasibility analysis across
Claude/Codex/pi, expiry and revocation semantics, and regression requirements.
No approval or release code changes in this stage.

### Stage 6 — Implement the ratified gate and release design

Only after Stage 5 is ratified:

- Recalibrate `secrets-or-auth` (credential-free repo `.npmrc`; reads versus
  exfiltration) and scope `destructive-or-irreversible` to paths outside the
  ticket worktree.
- Shape capabilities so Reviewer/Builder cannot attempt self-approval,
  unauthorized deploy, or global-provider-memory writes.
- Persist denial lessons through Operon-owned memory.
- Implement the chosen grant/retry semantics and the named release handoff.
  Security remains always-on and deployment remains a critical operation.

### Stage 7 — Prove it: sandbox benchmark, then production confirmation

First replay the buildstacks-class bootstrap from a clean disposable sandbox
repo containing the same product inputs but no existing branch, PR, dependency
cache, or worktree. This is the comparable benchmark required by PURPOSE's
sandbox-before-production rule. Targets, measured by the Stage 1 telemetry:

| Metric | This episode | Target |
| --- | --- | --- |
| Passes for the milestone | 55 | ≤ 8 |
| Estimated spend | $266 | ≤ $40 |
| Human decisions | 42+ | ≤ 5 |
| Wall clock (active) | ~7.5 h | ≤ 90 min |
| Merged to `main` | 0 | 1 PR, gates green, declared release disposition executed |

Only after the sandbox meets the targets does buildstacks.dev re-enter as a
production confirmation. At that point the frozen state (PR #23, tickets
#3–#20, the leftover worktree) gets its disposition: merge or close the PR,
re-plan the backlog, and prune the worktree. That confirmation is reported
separately from the clean benchmark because it inherits existing artifacts.
Misses become the next round of this document.

---

## 6. Open questions for the human operator

1. Ticket budgets by stage: is bootstrap ≤ 3 the right ceiling? What about
   a mature app's feature milestone?
2. Attempt cap N=3 before parking — agree, or different bound per tier?
3. Approval semantics: retain PURPOSE's later-retry, single-use action hash,
   or amend it to same-pass pause/resume and scoped multi-use grants? What TTL,
   use count, revocation, and audit rules make the amended design safe?
4. Keep the five-pass plan pipeline for mature apps and add a single-pass
   "bootstrap plan," or make pass count itself stage-dependent?
5. Release handoff (RC4): is "orchestrator triggers the CI deploy after
   merge, SRE runs the post-deploy smoke" the intended division, or should
   SRE own the deploy action itself behind a bounded grant?
6. Benchmark fixture: should the clean replay be a new disposable repository
   per run, or a resettable sandbox app with a pinned seed commit?

---

## 7. Stage 7 benchmark, round 1 (2026-07-11Z): returned ticket, root cause

Round 1 ran the full runbook (`docs/benchmark-runbook.md`) against
`bikramgupta/operon-bench-20260710` from a fresh Bench-Org. Per §5 Stage 7's
own rule — a miss is not massaged, it becomes the next round of this
document — this section records the miss and its root cause.

### Actuals vs targets

| Metric | Target | Round 1 | Verdict |
| --- | --- | --- | --- |
| Passes for the milestone | ≤ 8 | 6 (plan, contract, implement, fix ×3) | within target, but yielded no merge |
| Estimated spend | ≤ $40 | $19.00 | within target; $9.45 of it mechanically futile |
| Human decisions | ≤ 5 | 0 decided (2 false-positive requests pending) | within target |
| Wall clock (active) | ≤ 90 min | ~18 min | within target |
| Merged to `main` | 1 PR | **0 — ticket returned** | **MISS** |

What worked: the Stage 4 planner published exactly 1 ticket with canonical
labels for $0.71; the builder scaffolded a working site (setup, tests, lint
all green in the gate set); Stage 1 settlement recorded every pass exactly
once; Stage 2/3 machinery parked the ticket with an evidence digest instead
of thrashing. The loop was honest about its own failure — that part of the
campaign held.

### Root cause: the completeness gate reads a state channel nobody writes

`runCompletenessGate` fails any acceptance criterion whose issue-body
checkbox is unchecked. That test was ported from the predecessor
orchestrator, where "checked" meant *task status = done in the
orchestrator's own tracker*, set by the orchestrator from the builder's
typed done-verdict (`gates.py: run_gate_completeness`). The port kept the
check but not the writer:

- Stage 4 publication renders criteria as `- [ ]` — unchecked by
  construction.
- `docs/loop.md` §5 forbids the Builder from editing criteria, and Stage 4/6
  removed agent-authored `gh` side effects generally.
- The loop driver parses criteria from the issue body once, at claim time,
  so even an out-of-band check would be invisible to the same tick.

No process participant may write the state the gate demands. Every
orchestrator-published ticket therefore fails completeness, burns all
`max_attempts` remediation passes on a defect no code change can fix
($9.45 here — the three fix passes), and parks as `op:returned`. Earlier
live episodes (delta, 2026-07-06) passed only because ticket checkboxes were
checked out-of-band — exactly the untracked manual surgery the benchmark
rules exist to expose.

### Fix (landed with this section)

Completeness now checks what the process actually maintains: every
criterion still needs a covering test in the contract mapping and every
finding must be resolved; a ticket with no parseable acceptance criteria
fails (the predecessor's "no tasks found in scope"); the checkbox
requirement is dropped as gate *input*. Checkbox state becomes gate
*output*: `advanceShipping` renders all boxes checked on the issue at
merge, so the human-visible ticket still ends checked-off — written by the
orchestrator, the only party the design allows. `docs/loop.md` §5 updated
to match. Follow-up (not this fix): make the contract's criterion→test
mapping typed so the covering-test half of the gate is real instead of the
`defaultCriterionTests` stub.

### Ride-along finding: the safety gate pattern-matches plan prose

Both pending approval requests were raised *by the planner's structured
output itself*: the plan JSON's `releaseDisposition` prose ("deployment is
a later milestone…") matched `production-deploy`, and the ticket body
matched `protocol-self-edit`. The turn survived (deny + escalate + retry),
but a Stage 6 calibration follow-up should exempt or re-scope
`structuredoutput` verdict payloads — content *about* deployment is not an
attempt *to* deploy.

Round 2 runs from a clean slate (fresh disposable repo, fresh org home)
with the fix in place; its numbers are reported alongside round 1, not in
place of it.
