# The Build Loop — engineering design

*v0 draft — 2026-07-04. The loop is Operon's center of gravity: a TypeScript
re-engineering of the predecessor orchestrator — a private Python prototype
that proved the approach, called simply "the predecessor" throughout
(maintainers can find it read-only at* `scratchpad-gitignore/claude-loop-teams/`*)
— made framework-agnostic through the runtime adapters. This doc is the
detail layer for* `src/loop/`*;* `docs/architecture.md` *§3 holds the
surrounding turn/worktree machinery. §11 records decisions ratified into
docs/PURPOSE.md on 2026-07-06; future new decisions should be proposed here
first, then promoted only after human ratification.*

## 0. Position

**Thesis (human operator, 2026-07-04): "throw a ticket at an agent" does not work.**
Agents lose track without control and gates. The difference between a failed
run and a shipped PR is (a) how much *context* the agent receives — feature
doc, relevant PRD excerpts, accumulated learnings, not just "fix this bug,
here's the source" — and (b) how much of the process is *deterministic
orchestrator code* that no model output can bypass. The predecessor's gate
documentation records the canonical failure: an agent outputs
"SHIP READY" without running checks and broken code merges to main. The fix
is never a better prompt; it is code.

The loop must be rock solid for **three workloads**:


| Workload                 | Planning entry                                                                                  | Loop behavior                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Greenfield product build | Planner `plan` pipeline: vision → competing roadmaps → arbitration → decomposition into tickets | Dependency-ordered ticket stream; test-infrastructure tickets first; cross-milestone integration tickets last |
| Feature additions        | Co-planning / `groom` pipeline → spec doc + tickets                                             | Standard pipeline, contract pass mandatory                                                                    |
| Bug batches              | `triage` pipeline → `tier:quick` tickets                                                        | Contract pass skipped; full mechanical gates — speed comes from fewer passes, never fewer gates               |


The workloads differ in **planning pipeline and tier defaults, not loop
machinery** — one loop, tuned by config.

**Planning is not a loop phase.** The predecessor ran plan/dev/review/ship as
one pipeline because it had one agent identity. Operon has a standing Planner
role: the predecessor's `plan`/`plan_deep`/`supplement`/`onboard` phases become
**Planner pipelines** (§4) run on the Planner's own triggers, emitting
tickets to GitHub. The loop consumes `op:ready` tickets and knows nothing
about how they were planned. The ticket format (architecture.md §10) is the
contract between them.

## 1. Inheritance audit — what we keep, change, drop

From the predecessor (reviewed in full 2026-07-04):

**Keep (proven, ports directly)**

- Fresh session per pass; durable state between passes, never chat memory.
- Multi-pass phases with per-pass prompt template, model, and
thinking/effort overrides; parallel pass groups (competing-PMs pattern).
- Mechanical preflight gates in orchestrator code — tests, lint, e2e, secret
regex scan, completeness, review freshness — risk-tiered by changed-file
globs, "no agent hallucination can bypass these"; gates run twice at ship.
- Structured findings grammar with severity-sorted feed-back to the builder;
bounce-by-status; selective re-review of unchanged work.
- Implementation-contract pass before code (files/approach/tests/risks).
- Bounded everything: 3 mechanical fix attempts in-pass, remediation cap 3,
review cycles cap, per-pass turn cap; blocked-with-evidence escalation.
- Per-run artifact logging (prompt/output/session log/meta), activity log,
cost attribution, anomaly flags.
- Decomposer discipline: atomic/testable/scoped/ordered tickets, binary
acceptance criteria, test-infra-first, cross-release integration tasks.
- State-budgeted prompts (summarize completed material, keep active detail).

**Change (same intent, better substrate)**

- *State home:* task-file sections in the repo → **GitHub artifacts**
(labels, issue/PR comments, reviews). Durable, human-visible, and already
Operon's idempotency substrate (architecture.md §3). Local caches only.
- *Unit of work:* the predecessor's dev session worked a whole scope (one
release, many tasks, one branch) → Operon runs **one ticket = one branch =
one PR** (TASTE §5). Cost attribution becomes exact by construction — the
predecessor's weighted-mention heuristics existed only because sessions
were multi-task.
- *Review identity:* same model, different prompt → **different provider**
(roles.yaml builder/reviewer pairing — uncorrelated blind spots).
- *Review freshness:* orchestrator-recorded `review_sha` → **GitHub-native**:
an APPROVE review is bound to its `commit_id`; ship requires branch HEAD
== approved `commit_id`. Same guarantee, no bookkeeping to drift.
- *Drive model:* hand-invoked `auto` command → the **dispatcher's tick**
advances every in-flight item (§7); `operon loop` remains as a manual
driver for interactive use.
- *Golden principles in every prompt* → arrive once via context assembly
(TASTE layer [1], architecture.md §5); pass prompts carry only
pass-specific protocol. One source of truth, no drift between ten copies.

**Drop (with reasons)**

- *"SHIP READY" string parsing.* The one place the predecessor trusted agent
text for control flow. All Operon verdicts are structured (§6); merges
key off GitHub review state + mechanical gates, never prose.
- *Silent best-effort* `except: pass`*.* The predecessor wrapped GitHub sync, SHA
recording, and cleanup in bare excepts — failures vanished. Operon rule:
every orchestrator side effect either succeeds, retries, or lands in
telemetry + an incident note. Evidence over claims applies to the
orchestrator too (TASTE §6).
- *In-scope parallel dev.* The predecessor removed worktree parallelism inside a
scope after merge-conflict pain; its execution-groups parser survives as
dead code. We revive the idea **one level up** (§8): parallel *tickets* on
separate branches/worktrees, where git actually isolates them.
- `skip_contracts` *global flag* → per-ticket tiering (§4) decides.



## 2. The pass model

A **pass** is the atomic unit of agent work:

```
pass = one Runtime.runTurn(req, hooks) where
  req.task    = brief (assembled, §3) + pass prompt template (versioned file)
  req.context = TASTE layers + memory excerpts (architecture.md §5)
  req.role    = the role this pass belongs to (adapter, model, budget)
  overrides   = per-pass model/effort within the role's provider
```

Rules, all inherited from the predecessor and now contract-level:

1. **Fresh session per pass.** No pass resumes another's session (crash
  recovery of the *same* pass may — architecture.md §3). Passes
   communicate only through durable artifacts: commits, PR/issue comments,
   ticket state. Disk/GitHub is the message bus.
2. **Prompts are versioned code.** Templates live in `prompts/<pipeline>/`
  in the org home — diffable, reviewable, and a protocol surface: the
   safety gate's `protocol-self-edit` rule extends to `prompts/**` and
   `pipelines.yaml` (gate.ts change + conformance cases).
3. **Per-pass overrides stay within the role's provider.** contract and
  implement may use different efforts of the builder's model family;
   cross-provider remains an org-level flow between roles (docs/PURPOSE.md).
4. **Sequential passes re-read state; parallel groups are for independent
  writers.** Consecutive passes marked with the same `parallel_group` run
   concurrently and must declare disjoint outputs (competing roadmaps →
   separate files; the arbitrator merges).
5. **Harness delegation is per-pass discretion.** `delegation.allow` governs
  what a pass may fan out *internally* (scouts, adversarial verifiers).
   The pipeline is the protocol; delegation is tactics inside one step.
6. **Turn caps per pass** (the predecessor used `max_turns=50`) and the role's
  `max_turn_budget_usd` apply to every pass individually.

Adapter requirement surfaced by the predecessor's sharpest edge: briefs are
large (it needed a custom stdin transport because prompts overflow ARG_MAX).
**Adapters must accept multi-hundred-KB task payloads** via a robust channel
(SDK streaming input, stdin, or file). This becomes a gate-conformance-suite
case, not an implementation hope.

## 3. Brief assembly

The brief is the answer to "fix this bug + source code" vs "feature doc +
relevant PRD + learnings so far + fix this issue." Assembled
deterministically by `src/loop/brief.ts` per pass; logged verbatim in the
run artifact (§9) so every pass is reproducible.

```
[ticket]     issue title/body: goal, context, acceptance criteria, scope
[spec]       linked documents resolved & excerpted — the ticket's Context
             links (PRD / feature spec / incident) pulled from the app repo,
             budgeted; whole doc if small, relevant sections by heading
             match otherwise
[contract]   the implementation contract (from the contract pass), on
             implement/fix passes
[findings]   on a bounce: reviewer findings, severity-sorted; on gate
             remediation: verbatim gate output (failing tests, lint, scan
             hits) — actual error text, never a summary
[history]    prior attempts on this ticket: blocked-entry comments,
             remediation count, "attempt 2 of 3"
[memory]     OKF excerpts (architecture.md §5): role craft + app domain —
             selected once per pipeline execution, fixed across passes
             (cache-stable assembly, architecture.md §5)
[repo]       app conventions: build/test commands from .operon/config.yaml
```

**Budgeted like the predecessor's state budget:** estimate tokens (len/4
heuristic to start), and when over budget summarize the *oldest resolved*
material first (settled findings, early attempts) while active material
stays verbatim. The ticket and acceptance criteria are never summarized.

Feature specs get a durable home so tickets can link to them:
`docs/specs/<date>-<topic>.md` in the app repo (or the Planner's
`.operon/planning/` notes graduate there). Planner pipelines emit tickets
whose Context section links the spec; the assembler does the rest. This is
the mechanism behind "here are the parts of the PRD relevant to you."

## 4. Pipelines

`pipelines.yaml` (org home, human-ratified like roles.yaml) maps each
pipeline to ordered passes — the port of the predecessor's phases→passes
structure, with roles resolved through Operon's org chart:

```yaml
# pipelines.yaml — sketch
build:
  passes:
    - id: contract          # port of dev/contract.md
      role: builder
      template: build/contract.md
      skip_on_tier: [quick] # bug-batch tickets skip straight to implement
    - id: implement         # port of dev.md
      role: builder
      template: build/implement.md

review:
  passes:
    - id: verify            # port of review.md; template carries a security
      role: reviewer        #   lens — different provider than builder, by config
      template: review/verify.md
    - id: security-deep     # dedicated security review — see "Review
      role: reviewer        #   dimensions" below
      template: review/security.md
      only_on: {risk: [high], dimension_globs: security}
    - id: perf-scale        # performance & scale review
      role: reviewer
      template: review/perf.md
      only_on: {labels: [op:perf-sensitive], dimension_globs: perf}

fix:                        # bounce target; brief carries findings
  passes:
    - id: fix
      role: builder
      template: build/fix.md

ship:
  mechanical: true          # no agent passes at standard tiers (§5)
  passes:
    - id: ship-check        # optional judgment layer, port of ship.md's
      role: reviewer        # four-gate checklist minus what preflight
      template: ship/check.md               # already proves mechanically
      only_on: { risk: [high], tier: [deep] }

plan:                       # Planner pipelines — same executor, not part
  passes:                   # of the build loop
    - id: visionary
      role: planner
      template: plan/visionary.md
      effort: high
    - id: pm-a
      role: planner
      template: plan/pm.md
      parallel_group: competing-pms
    - id: pm-b
      role: planner
      template: plan/pm-b.md
      parallel_group: competing-pms
    - id: arbitrator        # three-category merge: agreed/disputed/gap
      role: planner
      template: plan/arbitrator.md
    - id: decomposer        # atomic tickets, deps, execution groups
      role: planner
      template: plan/decomposer.md

groom:                      # steady state: digests+incidents → tickets
  passes: [...]             # (absorbs the predecessor's supplement phase)
triage:                     # bug batch: issues → tiered ready tickets
  passes: [...]
```

As of M8, the root `pipelines.yaml` carries the executable v0 set:
`build`, `review`, `fix`, `ship`, `plan`, `groom`, `triage`,
`sre-incident`, `sre-health`, `support-digest`, `marketing-release`, and
`ci-sweep`. Trigger-to-pipeline routing lives in `src/org/trigger-routing.ts`
so roles.yaml stays declarative and unknown mappings fail as loud skips.



### Review dimensions — security always-on, the rest risk-selected

Functionality review (the `verify` pass) runs on every PR. The other review
dimensions — security, performance/scale, and any future lens — are
**conditional passes selected by the same machinery that tiers the
mechanical gates**: changed-file globs and ticket labels in the app's
`.operon/policy.yaml` (the `dimension_globs` references above), so adding a
dimension is a pipelines.yaml + policy.yaml edit, never loop code.

Security is the deliberate exception — always-on, at two depths:

1. **Every PR, cheap:** the mechanical secret scan (§5) plus a security lens
   baked into the standard `verify` template (injection, authz, unsafe
   deserialization, secret handling — reviewed alongside functionality).
2. **On trigger, deep:** the dedicated `security-deep` pass when the diff
   touches security-sensitive globs (auth, crypto, network ingress,
   dependency manifests, input parsing) or the ticket carries high risk
   tier.

Performance/scale review is conditional only: globs (hot paths, queries,
migrations, caching) or a Planner-set `op:perf-sensitive` label.

Diff-scoped triggers can't see emergent whole-system issues, so **standing
sweeps** complete the picture: scheduled role turns (e.g. a weekly SRE or
Reviewer security audit over the whole repo) defined as ordinary roles.yaml
schedule triggers — their findings enter as plain issues through Planner
intake, like everything else.



### Pass protocol requirements (what each template must encode)

The actual prompt files land with implementation; their required content is
protocol, fixed here:

- **contract** — read ticket + referenced code; emit contract (files to
touch, approach 1–3 sentences, test strategy, risks, complexity
low|medium|high) as a structured **issue comment**; write no code.
- **implement** — the predecessor's dev discipline verbatim: read before write;
baseline test run before changes; minimal diff; plan-adherence self-check
(each acceptance criterion addressed; only in-scope files touched — revert
strays; architecture conformance); full suite, exit code 0, "NOT optional
and NOT limited to task-specific tests"; atomic commits
`#<issue>: description`; 3 mechanical fix attempts in-pass, design
failures escalate immediately as a blocked entry (verbatim error /
attempted fix / result / assessment) — never thrash.
- **verify** — check each acceptance criterion against code + test results;
findings in the structured grammar (§6); for UI apps with a verification
strategy in the spec, walk user journeys end-to-end (a task that passes
its criteria but breaks a journey is still a FAIL — the predecessor's
"connect the hallway" rule); never modify source.
- **fix** — resolve or explicitly rebut every finding (TASTE §8); same
discipline as implement.
- **decomposer** — atomic/testable/scoped/ordered/independent tickets;
binary criteria; `Depends-on: #N` edges; execution-group annotation (§8);
test-infrastructure tickets first in a greenfield milestone;
cross-milestone integration tickets last.



### Tiering — pipeline shape by ticket, gates by files

Two orthogonal axes, both ported:

- **Ticket tier** (Planner-assigned label `op:tier-quick|standard|deep`)
selects *passes*: quick skips contract; deep adds the ship-check pass.
- **Risk tier** (changed-file globs in the app's `.operon/policy.yaml`,
highest tier wins, unmatched → medium) selects *gates* (§5). A quick
ticket that touches `auth/**` still gets high-tier gates — tiering makes
the loop cheaper, **never** less safe.



### Issue intake — everything enters through the Planner

**Invariant: only a Planner pipeline (or the human) applies** `op:ready`**.**
All intake — human-filed issues, Support digests, SRE incident notes,
`op:returned` bounces, reviewer-escaped bugs — waits as plain issues until
a Planner pipeline touches it. The loop never builds an untriaged issue.

- `triage` (bug batches): classify each issue — *bug* → tier + spec
links + `op:ready`; *improvement* → backlog candidate (labeled, not
ready); *duplicate/invalid* → close with reason. Prioritize (`p1..p3`).
- `groom` (steady state): consolidate backlog candidates into feature
specs (`docs/specs/`), decompose into tickets, re-prioritize; digest
blocked/returned items for rework or descoping.
- **Doc reconciliation is a groom/triage duty**, so the corpus agents
navigate stays true: when a bug or merged change contradicts a spec /
architecture doc, the pipeline appends a doc-update acceptance criterion
to the fix ticket (small drift) or emits a dedicated docs ticket (large
drift). **Vision / app-charter changes are proposal-only** — the Planner
drafts the amendment, the human ratifies (co-planning session or PR
review); agents never silently rewrite the documents that define "good".



### Roles are referenced, never hardcoded

Passes name their role (`role: builder`); the loop executes whatever
roles.yaml defines. New seats — a `writer` for content-heavy apps, a `lab`
verification role (open question §12) — are config additions, not loop
changes. This supersedes the current `LoopConfig {builder, reviewer}`
skeleton, which hardcodes two seats.

## 5. Quality gates — deterministic, orchestrator-run

Distinct from the safety gate (critical-ops approval, every tool action,
in-session): quality gates run **between passes, as orchestrator
subprocesses against the worktree**. Port of the predecessor's gate engine:


| Gate             | Mechanics (ported)                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| setup            | run app's `setup_command` (e.g. `npm ci`) **first**, in the fresh worktree, before any scheduled gate — a cold clone has no `node_modules`, so a `test`/`lint` that shells out to an installed tool would otherwise fail for lack of deps; unconfigured = absent (no gate, never a failure); a setup **failure short-circuits** the whole set so the tests/lint gates don't produce misleading failures (`src/loop/qgates.ts` `runSetupGate` / `runGates`) |
| tests            | run app's `test_command`, exit code 0, timeout; last output lines on fail                                                                                      |
| lint             | `lint_command`                                                                                                                                                 |
| e2e              | `e2e_test_command` when configured                                                                                                                             |
| security         | regex scan of changed files: `sk-[A-Za-z0-9]{32,}`, `ghp_…`, AWS keys, `-----BEGIN PRIVATE KEY-----`, generic key/token/password assignments; binaries skipped |
| completeness     | every acceptance criterion checked off; no unresolved findings on the PR                                                                                       |
| review-freshness | branch HEAD == the APPROVE review's `commit_id` (GitHub-native); always runs regardless of tier                                                                |


`.operon/policy.yaml` (app repo, emitted by bootstrap) carries risk-tier
globs → gate sets, the review-dimension globs (§4), plus
`remediation.max_attempts` (default 3). Defaults mirror the predecessor's
template (high: tests+lint+security+completeness; medium drops security
scan; low: tests+completeness).

**Where gates run:**

1. **After implement/fix, before the PR advances** — the reviewer is the
  org's most expensive seat (Opus, xhigh); never spend those tokens on
   code that fails `pnpm test` mechanically. Gate failure → **remediate**:
   re-dispatch a fix pass with verbatim gate output in the brief, up to
   `max_attempts`, then blocked.
2. **At ship, twice** — once when the item reaches ship (blocks wasting the
  optional ship-check pass) and once immediately before the squash-merge
   (catches anything that moved in between). The predecessor's double-run,
   kept exactly. Before either run, the P7 release check
   (docs/approval-and-release-amendment.md A4): a ticket whose
   `Release-kind:` trailer declares deploy/package may not merge unless the
   app's `release:` block declares a matching mechanism — the ticket
   returns to the Planner ("deployable but unowned" is unfinished,
   mechanically). A merged deploy/package milestone hands the org layer a
   releaseTrigger, queued on the approval store as a `production-deploy`
   critical op attributed to the declared owner (orchestrator or SRE); the
   command never runs without a human decision.

The judgment layer sits *above* mechanical gates, never instead of them:
the reviewer's verdict and the high-risk ship-check pass evaluate what
regexes can't (design, scope creep, principle violations) — but only after
the mechanical layer is green.

### Acceptance criteria are the gates' contract — and a human-touched artifact

Mechanical gates are only as strong as the acceptance criteria they check;
badly specified criteria pass through perfect machinery. Criteria are
therefore a first-class artifact with named owners at every step:

- The Planner's decomposer emits **binary, mechanically checkable** criteria
  (already protocol, §4) — "works correctly" is a spec bug, not a criterion.
- For deep-tier or high-risk tickets, criteria get **human sign-off** with
  the spec (co-planning session or spec-PR review) before any `op:ready`
  label — the human helps define "done", not just approve the diff.
- The Builder's contract pass maps **each criterion to named tests**; the
  completeness gate (table above) fails — not warns — when a criterion has
  no covering test or unchecked box.
- Criteria are never summarized out of briefs (§3) and never edited by the
  Builder; a criterion that proves wrong bounces the ticket to the Planner.

## 6. Verdicts — structured outputs, no prose-driven control flow

Every pass has a typed verdict the orchestrator acts on:

```ts
// src/loop/verdicts.ts — sketch
type ContractVerdict = { files: string[]; approach: string; tests: string;
                         risks: string; complexity: "low"|"medium"|"high" };
type BuildVerdict    = { status: "done"|"blocked"; blockedEntry?: BlockedEntry };
type ReviewVerdict   = { verdict: "approve"|"findings";
                         findings: Finding[] };
type Finding         = { category: "architecture"|"testing"|"security"|"style"|"scope";
                         severity: "critical"|"major"|"minor";
                         location: string; description: string; action: string };
```

- Where the adapter supports native structured output (Claude Agent SDK
does), the pass requests it. Where it doesn't, the pass prompt specifies
the predecessor's line grammar
(`- category/severity file:line -- description -> action`) and the parser
keeps the predecessor's hard-won leniency — three status formats, unicode or
ASCII delimiters — because agents write inconsistent markdown. This is wired
end to end: `recordPassVerdict` (src/loop/loop.ts) parses the pass output and,
on a parse failure, issues exactly **one session-resuming reformat turn**
("reformat your verdict") against the just-finished session (`parseWithRetry`,
src/loop/verdicts.ts). Success emits `verdict.recorded` (§9) into the pass's
run record; a still-unparseable verdict after the retry finalizes the pass as
an **infra failure** with `error_code = error_verdict_unparseable` — a distinct
population from a merit outcome (§9), never a silent pass. The reformat turn is
a real `runTurn`, so its spend is **folded into the pass's usage rollup**
(`sumTurnUsage` in src/loop/pipeline.ts) — `analyze`/`status` never undercount
the retry.
- **No side effect keys off prose.** Merge requires: GitHub APPROVE review
present ∧ freshness ∧ mechanical gates green. The reviewer's verdict is
double-entered — structured verdict *and* a real GitHub review — and the
GitHub state is authoritative. A real `APPROVED` review authorizes a merge
only if it is an *independent* review: `latestActionableReview` →
`isIndependentApproval` (src/loop/loop.ts) rejects an APPROVE authored by the
builder/PR identity (`authorization.builderIdentity`) and, when a reviewer
allowlist is configured (`authorization.reviewerIdentities`), requires the
approver to be in it — a non-independent or unlisted APPROVE is ignored, never
merged. M6 found the
single-account pilot caveat: GitHub rejects approving your own PR, so until
Operon has a separate bot/app identity, `GhCliOps` falls back only for that
exact error to a real COMMENTED PR review carrying the
`<!-- operon:self-approval-fallback sig=… -->` marker. That marker is **not**
a static string anyone can post: it carries an HMAC over the PR number signed
with an operator secret (`OPERON_SELF_APPROVAL_SECRET`,
`authorization.selfApprovalSecret`) that the sandboxed agent cannot read. The
loop upgrades a COMMENTED review to an approval only when the HMAC verifies
(`verifiedSelfApprovalMarker` in src/loop/github.ts, a `timingSafeEqual` check)
*and* the body is a structured `Verdict: approve`, and still enforces commit
freshness. With no secret configured the loop fails closed — a bare marker is
never trusted. (Threading the secret to the agent's own environment would
re-open the forgery, so it must stay orchestrator-only.)



## 7. The ticket state machine

The loop is a **distributed state machine advanced by dispatcher ticks**
(architecture.md §2) — not a long-lived `auto` process. Every state is
derived from durable artifacts; any tick on any day can advance any item;
laptop sleep loses nothing. `operon loop --app <app> [--follow]` drives
ticks manually for an interactive, watch-it-run experience.

```
op:ready (deps merged)
  │ claim: label swap → worktree + branch op/<issue>-<slug>
  ▼
building ── contract pass (unless tier:quick) → contract comment on issue
  │         implement pass → commits
  ▼
gates ──fail→ remediate (fix pass, gate output in brief) ──┐
  │            ↑______________ ≤ max_attempts _____________│──exhausted→ blocked
  │ green: push, open PR (Closes #N), op:in-review
  ▼
reviewing ── verify pass → GitHub review + structured findings
  │  findings → fix pass (cycles++) → gates → reviewing   (cycles > 3 → returned)
  │  approve (independent + fresh commit)
  ▼
shipping ── [high risk: ship-check pass] → gates re-run (incl. freshness)
  │  ship-check findings → building (cycles++)            (cycles > 3 → returned)
  │  green: orchestrator squash-merges, deletes branch, closes ticket
  ▼
merged ── scorecard events (review_cycles, …), worktree cleanup
```

Bounds (all ported): remediation ≤ `policy.remediation.max_attempts` (3);
review cycles capped at `maxCycles` (`DEFAULT_MAX_REVIEW_CYCLES` = 3) — the
**(cycles + 1) > maxCycles** cycle routes to `op:returned` with findings for
the Planner (i.e. cycle 4 returns; cycles 1–3 bounce back to `op:building`);
3 mechanical attempts inside a pass; per-pass turn cap; per-turn budget.

**The REVIEWING phase is fully bounded** (`advanceReviewing` /
`stalledReviewing`, src/loop/loop.ts): every non-progressing tick — no
actionable review yet, a `CHANGES_REQUESTED` (structured or plain-prose),
**or an APPROVE whose `commit_id` no longer matches branch HEAD (a stale
approval)** — counts a cycle and, past the cap, routes to `op:returned`. A
stale approval is **never merged and never spins**: freshness still gates the
merge, but instead of leaving the item in `reviewing` for the driver to
re-run the review pipeline forever, the tick advances the cycle counter and
terminates in `op:returned`. The ship-check bounce is bounded the same way
(`runShipCheckPipeline`): a ship-check that requests changes counts against
the same review-cycle cap so `building`↔`shipping` cannot loop unbounded.

**Blocked protocol:** every dead-end *inside the build loop* — gate
exhaustion, a `blocked` build verdict, review/ship-check cycle-cap — swaps to
`op:returned` with a structured comment (error verbatim, attempted fix,
result, assessment) that the Planner's groom pipeline consumes. `op:blocked`
is reserved for the **safety/approval escalation path** (a critical-op the
human must clear); the build loop never writes it. Blocked-with-evidence,
never silent retry-forever.

Completion detection is **state-based, never string-based**: the tick reads
labels, PR/review state, and gate results — the predecessor's
completion-detection philosophy with GitHub as the state store.

### 7.1 Continuation from durable artifacts (proportionality-review Stage 2)

A re-claim is **not** a blank slate. Before claiming, the driver rehydrates
ticket-lifetime state from the artifacts previous turns left behind
(`src/loop/rehydrate.ts`):

- **Contract reuse.** The contract comment carries an HTML marker binding it
  to a sha-256 of the ticket body. While the body is unchanged, a re-claim
  reuses the contract verbatim (the contract pass is excluded via
  `PassSelection.excludePasses`) and the implement brief carries it; a body
  edit invalidates it and the contract is re-derived. The latest contract
  comment wins — a superseded contract is never resurrected.
- **Findings ledger.** Findings live across turns: every `## Structured
  review verdict` comment raises them; the fix pass's machine-readable
  resolution lines (`- fixed <location> -- <evidence>` /
  `- rebutted <location> -- <reason>`, posted durably as `## Fix
  resolutions`) close them; a later round re-raising a location reopens it.
  A finding a later review round silently drops **stays open** — silence
  never closes a finding. Open findings feed every fix and review brief.
- **PR-aware phase entry.** The open PR is consulted *before* pipeline
  selection: open PR + open findings enters the fix pipeline (rehydrated
  `cycles` = review rounds already spent, so the cycle cap holds across
  claims); open PR + no open findings fast-forwards to `gates` →
  review — never a rebuild. A pruned worktree with a surviving branch is
  recreated *from the branch*, keeping its commits.
- **Claim cap.** `<stateHome>/tickets/<app>/<issue>.json` counts claims
  across processes. At the cap (default 3, `LoopDriverOptions.maxClaims`)
  the driver refuses to claim and parks the ticket `op:returned` with an
  evidence digest (prior claim outcomes, contract state, PR, open
  findings) — bounded attempts, then summon the human. The episode's human
  performed all twenty re-arms by hand; this is the stop that was missing.

## 8. Parallelism — tickets, not tasks

The predecessor tried worktree parallelism *within* a scope and removed it
(merge conflicts); its execution-groups parser is dead code. The idea
returns one level up, where git actually provides isolation:

- The decomposer emits `Depends-on:` edges and an execution-groups
annotation across a milestone's tickets.
- The dispatcher treats a ticket as ready only when its dependencies are
**merged**; independent tickets may run in parallel worktrees on separate
branches, bounded by `org.max_concurrent_turns`.
- **Scope-overlap conservatism:** tickets whose declared file scopes
intersect are never scheduled concurrently. The predecessor's own rule,
promoted to scheduler policy: "when in doubt, use sequential — incorrect
parallelism is worse than unnecessary sequencing."
- Within a phase, parallel pass groups (competing-PMs) remain available;
within a pass, delegation is the harness's business.



## 9. Observability — three layers

Structure follows the human operator's observability methodology doc
`agentic-observability-and-logging.md` (app #1's repo,
`knowledge/methodology/`, 2026-07-04 — an analysis of Claude Code's
workflow logging): **copy the patterns, not the monolith**. Three layers
with different consumers, export defaults, and retention. v1 implements all
three locally — if something executes, its logs exist; the OTel exporter is
a later thin adapter over Layer 2 ("a weekend, not a rewrite"), planned
for, never a rewrite.

```
~/.operon/<org>/runs/<app>/<runId>/
  envelope.json     L1 — one per pass: ids, status, timings, token/cost
                    rollups, gate results, verdict summary, tool counts
                    (see the tool-telemetry caveat below), truncated
                    previews; REFERENCES to brief/transcript, never inlined
                    (the wf_*.json monolith lesson)
  events.jsonl      L2 — append-only structured events, timestamped
  brief.md          L3 — exact assembled brief (forensics/reproducibility)
  output.md         L3 — final output text
  session.log       L3 — full transcript, fed by TurnHooks.onEvent
```

`runId = YYYYMMDD-HHMMSS-<pipeline>-<pass>`, chronologically sortable.

- **Correlation ids on every L2 event:** `trace_id` = turnId (minted at
dispatch, one per pipeline execution), `span_id` per pass, and
`parent_span_id` linking subagent events. The adapters' `TurnEvent
{type:"subagent"}` stream is buffered during the turn and flushed to L2 in
order afterward as `subagent.started/completed` spans nested under the pass
span (`flushBridgedEvents`, src/loop/pipeline.ts) — so fan-out trees
**are** reconstructable (`reconstructSpanTree`) without opening transcripts.
session.log still receives every event live. Plus `app`, `ticket`,
`pipeline`, `pass`, `role`, `model` on everything.
- **L2 event taxonomy:** `run.started/completed`,
`pass.started/completed/failed`, `gate.started/passed/failed`,
`tool.called` (name, duration, success — never full args),
`subagent.started/completed`, `ticket.transition`, `verdict.recorded`,
`escalation.raised`, `telemetry.settle_skipped` (a ledger settle found its
app+runId already present — Stage 1). Every line timestamped, severity
field, machine `error_code`. **Stage 3 additions:** the executor stamps a
30-second heartbeat onto the envelope (`last_seen_at`) so live and stalled
passes are distinguishable; a per-pass wall-clock watchdog
(`wall_clock_minutes`, default 60) finalizes a hung pass
`failed(error_wall_clock_exceeded)` with an unmeasured ledger row; adapter
failure codes (`error_max_budget_usd`, …) flow into `pass.failed` and the
envelope instead of a generic `error_turn_failed`; failed gates retain the
exact command and a bounded, scrubbed output tail in both the `gate.failed`
event and `envelope.gate_results`. **What is wired today:** the pass executor emits
`run.*`/`pass.*`/`escalation.raised` and bridges `subagent.started/completed`
from the adapters' `onEvent` stream into L2 (`flushBridgedEvents`,
src/loop/pipeline.ts); the state machine emits `gate.started/passed/failed`
and `ticket.transition` (via a per-step run record, src/loop/loop-runlog.ts
`openPhaseRun`) and populates `envelope.gate_results`; `verdict.recorded`
lands from `recordPassVerdict`. **Tool-telemetry caveat (honest gap):**
`tool.called` and `envelope.tool_counts` stay **empty**. The L2 bridge is
built and fires on `TurnEvent{type:"tool_use"}`, but the runtime adapters
(Claude/Codex/pi) currently emit only `type:"subagent"` events, never
`tool_use` — so per-tool call telemetry is pending an adapter change. Nothing
downstream is wrong; the field is simply unpopulated until the adapters emit
tool-use events (an adapter edit gated on `pnpm test:live`).
- **Infra and merit never conflate** (the doc's sharpest lesson: "infra
failures looked like merit failures until you read verify stats"). A
pass that *errors* is `failed` with an `error_code`; a pass that
*concludes findings/blocked* is a merit outcome. Dashboards, retro, and
scorecards read them as different populations.
- **Dashboards read L1+L2 only.** `operon status` / `operon analyze` never
parse transcripts; previews are truncated (~120 chars), args hashed.
- **Redaction is a precondition for export** and applies to L1/L2 always:
no full prompts, no tool args, no secrets — the quality-gate secret
regexes double as a log scrubber. L3 stays local, retention =
`session_retention_days`; run dirs pruned on the same schedule.
- **Attribution is exact** — runs are ticket-scoped by construction; costs
roll up run → ticket → (role, app) → monthly budget with no
weighted-mention guessing. The predecessor's `UNATTRIBUTED` bucket disappears.
  - **Which spend reaches the monthly budget rollup:** the per-pass L1
  envelope and L2 events are written by **every** driver (dispatched *and*
  manual). The org **telemetry ledger** (`~/.operon/<org>/telemetry/<day>.jsonl`,
  the source `operon budget` sums) is written only by the autonomous dispatch
  path (`src/org/turn-runner.ts` → `recordTurn`). The manual `operon loop`
  driver (src/cli/loop.ts) writes the per-pass run envelopes and persists
  scorecard events, but does **not** append to the telemetry ledger — so
  `operon budget` shows `$0` for a manually-driven loop, while that same
  spend is fully visible in `operon status` and the run envelopes. Production
  runs through the dispatcher, which records; the budget hard-stop
  (architecture.md §7) therefore governs dispatched turns.
- **Cache visibility.** Input tokens come in three price classes (uncached
~1×, cache-write 1.25–2×, cache-read ~0.1×); both SDKs report the split
per response. L1 rollups and telemetry carry it (`TurnUsage` delta, §10),
and cost is computed with three-bucket pricing — a flat input rate would
misprice a healthy cached pass ~5–10× and fire the per-turn budget abort
wrongly. Economics reference: `research/2026-07-04_prompt-caching.md`.
- **Anomaly flags** (`operon analyze`, computed from L1/L2,
src/runtime/runlog/anomalies.ts) — ported detectors: `low_tokens_high_time`
(>300 s, <1 k tokens — stuck on environment), `single_turn_long_run`,
`bash_heavy` (≥20 calls), `environment_retry` (≥3 docker/install/wait
retries), plus new `cold_cache` (zero cache reads on a pass whose predecessor
in the same pipeline ran within the cache TTL — a silent prefix invalidator
shipped in context assembly). **Three fire today** off envelope fields that
are populated — `low_tokens_high_time`, `single_turn_long_run`, and
`cold_cache`. **Two are inert until tool telemetry exists:** `bash_heavy`
reads `envelope.tool_counts["bash"]` and `environment_retry` reads
`tool.called` events tagged `environment_retry` — both depend on the
`tool_use` bridge above, so neither can fire until the adapters emit
`type:"tool_use"` events (same pending adapter change; the detector code is
present and unit-covered). Flags map to canned recommendations and feed the
weekly retro (architecture.md §6).



## 10. Module map & contract deltas

```
src/loop/
  loop.ts        ticket state machine (implemented — phases, label swaps,
                 bounded review/gate/ship cycles, squash-merge)
  pipeline.ts    pass executor: load pipelines.yaml, run passes, parallel
                 groups, per-pass overrides, re-read state between passes
  brief.ts       brief assembler (§3), state-budgeted
  qgates.ts      quality-gate engine (§5) — pure subprocess + git, no
                 adapter dependency, unit-testable day one
  verdicts.ts    typed verdicts + lenient parsers (§6)
prompts/         pass templates (org home, human-ratified)
pipelines.yaml   pipeline → passes config (org home, human-ratified)
```

Import direction holds: `src/org` (dispatcher) → `src/loop` → `src/runtime`.
The Planner's pipelines run on the same `pipeline.ts` executor — the
executor is loop-layer machinery, not build-loop-specific.

Deltas to existing code (small, flagged):

- `gate.ts`: `protocol-self-edit` rule adds `pipelines.yaml` and
`prompts/**`; conformance cases both sides (critical + routine near-miss).
- `types.ts`: optional `TurnRequest.verdictSchema` so adapters with native
structured output can enforce it; others ignore it and the parser layer
handles text.
- `types.ts`: `TurnUsage` splits input tokens into `tokensInUncached`,
`cacheReadTokens`, `cacheCreationTokens` (`tokensIn` stays as the sum);
adapter cost tracking prices the three buckets separately (§9 cache
visibility) — the per-turn budget abort and monthly rollups depend on it.
- `LoopItem` gains `tier`, `remediationAttempts`, `gateResults`; `LoopPhase`
gains `gates`/`shipping` states per §7.
- Conformance suite: large-payload case (§2) and a cache-stability case —
two back-to-back passes with identical (role, app) context must show
`cacheReadTokens > 0` on the second (catches silent prefix invalidators
mechanically) — added for every adapter.



## 11. Ratified decisions promoted to docs/PURPOSE.md

Ratified by the human operator on 2026-07-06 and promoted to
docs/PURPOSE.md:

1. **The loop is protocol-driven at the substage level.** The orchestrator
  owns pass pipelines — versioned prompt templates, per-pass model/effort,
   deterministic sequencing — executed through the runtime adapters.
   Harness-internal delegation is per-pass discretion, not a substitute for
   the pipeline. (Refines "employee is a team": the artifact-level org
   contract stands; a role turn may be a pipeline of passes.)
2. **Quality gates are orchestrator code**, distinct from the safety gate:
  risk-tiered mechanical preflight (tests/lint/e2e/secret-scan/
   completeness/review-freshness) between passes and twice at ship; the
   judgment layer runs only above a green mechanical layer; no side effect
   ever keys off agent prose.
3. **Planning is a Planner pipeline, not a loop phase.** The ticket is the
  contract between planning and building.
4. **Briefs are assembled, budgeted context packets** (ticket + spec
  excerpts + contract + findings + history + memory), logged verbatim per
   run — the "more effort and more context" doctrine made mechanical.
5. **Ticket-level parallelism only**, dependency- and scope-aware; in-scope
  parallelism stays dead (the predecessor's lesson).
6. **Orchestrator failures are loud** — no silent best-effort side effects.
7. **Review dimensions are risk-selected passes; security is always-on.**
  Functionality review on every PR; security at two depths (mechanical
   secret scan + a security lens in every verify pass; a dedicated deep
   pass on security-sensitive globs or high risk tier); performance/scale
   review by glob or label; scheduled whole-repo standing sweeps catch what
   diff-scoped triggers can't. (§4)
8. **Acceptance criteria are a ratified quality contract.** Binary and
  mechanically checkable by protocol; human-signed-off for deep/high-risk
   tickets before `op:ready`; mapped to named tests by the contract pass;
   enforced by the completeness gate; never summarized or builder-edited.
   (§5)



## 12. Open questions

1. **polish pipeline** (design evaluator/refiner with `min_score`) — port
  later for UI-heavy apps (buildstacks.dev), not v1. *(deferred)*
2. **Structured-output support in Codex/pi** — verify at adapter build
  time; the lenient-parser fallback is specified either way.
   *(build-time verification)*
3. **Agent SDK cache knobs** — what TTL control and breakpoint placement
  the TS Agent SDK exposes for the appended system prompt (and the Codex
   SDK's equivalent, given OpenAI's automatic prefix caching); the design
   rules (architecture.md §5 cache-stable assembly) hold regardless of the
   answer. *(build-time verification)*

Resolved 2026-07-06: high-tier Builder contracts stay autonomous in v1;
milestone planning uses the deep `plan` pipeline while weekly grooming stays
lighter; Lab is approved as a future opt-in role; competitive intelligence
stays a Marketing `ci-sweep` pipeline for now; per-pass wall-clock cap default
is **60 minutes**, and the per-pass `wall_clock_minutes` override is now
honored — the dispatcher records the pipeline's max per-pass value at claim
time and `killHungTurns` (src/org/dispatch.ts) enforces it against the
journal's `wallClockCapMs`, falling back to 60 min when unset.



## 13. Failure-mode catalog

The harnesses own in-session heavy lifting (tool retries, context
management, thinking). Everything around that is ours. The rule that keeps
the catalog finite: **every failure path terminates in one of four
outcomes — bounded retry, blocked-with-evidence, escalated-to-human, or
success. Never silent, never unbounded.** Infra and merit failures carry
distinct codes end to end (§9).


| #                           | Failure                                              | Detected by                                          | Bounded response                                                                                                                             |
| --------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Infrastructure**          |                                                      |                                                      |                                                                                                                                              |
| 1                           | Turn process dies mid-pass                           | stale lock heartbeat + journal `running`             | resume session once, else restart clean; `attempt ≥ 3` → returned + incident (architecture.md §3)                                            |
| 2                           | SDK session hangs                                    | per-pass wall-clock cap (default 60 min)             | kill; enters #1's recovery path                                                                                                              |
| 3                           | Dispatcher dies mid-claim                            | next tick                                            | artifact-before-label: state re-derived from GitHub artifacts; no torn claims                                                                |
| 4                           | Host asleep / offline                                | nothing runs                                         | missed schedules collapse to one firing; distributed item state resumes on any later tick                                                    |
| 5                           | GitHub API down / rate-limited                       | API errors on tick                                   | loud L2 event; retry next tick (polling is idempotent); repeated → anomaly flag + incident note                                              |
| 6                           | Session resume fails                                 | adapter error                                        | restart clean, `attempt++`                                                                                                                   |
| 7                           | Run-dir / session growth                             | retention job                                        | pruned on `session_retention_days`; L1/L2 kept longer than L3                                                                                |
| **Model behavior**          |                                                      |                                                      |                                                                                                                                              |
| 8                           | Tests fail during implement                          | in-pass verification loop                            | 3 mechanical attempts → blocked-with-evidence (error verbatim / attempted fix / assessment)                                                  |
| 9                           | Gate failure after a pass                            | quality-gate engine                                  | remediation fix passes ≤ `max_attempts` (3) → blocked                                                                                        |
| 10                          | Builder↔reviewer ping-pong (incl. stale/non-actionable approvals, ship-check bounces) | cycle counter (`advanceReviewing`/`stalledReviewing`/ship-check) | bounce to `op:building` while `cycles ≤ 3`; the `cycles > 3` cycle → `op:returned` with findings for Planner triage — never merges a stale approval, never spins |
| 11                          | Malformed / missing verdict                          | `recordPassVerdict` → `parseWithRetry`               | one session-resuming reformat retry → pass fails loud as infra (`error_verdict_unparseable`); retry spend folded into pass usage             |
| 12                          | Hallucinated success                                 | mechanical gates                                     | the design premise: no side effect keys off prose (§5, §6)                                                                                   |
| 13                          | Scope creep                                          | plan-adherence self-check; reviewer `scope` findings | revert strays in-pass; findings bounce                                                                                                       |
| 14                          | Wrong lesson poisoning memory                        | weekly curation                                      | lessons carry evidence links; wrong ones deleted, not hedged                                                                                 |
| 15                          | Prompt injection via repo/issue content              | safety gate                                          | gate binds the whole session incl. subagents; criticals denied regardless of what the model was persuaded to want; escalations human-visible |
| **Integration & resources** |                                                      |                                                      |                                                                                                                                              |
| 16                          | Squash-merge conflict (parallel ticket landed first) | merge --abort                                        | item → fix pass with rebase instruction → gates + freshness re-run; scope-overlap scheduling (§8) makes this rare                            |
| 17                          | Baseline red on main                                 | implement pass baseline run                          | blocked + `op:incident` (SRE `ci-failed` trigger); never build on a broken base                                                              |
| 18                          | Per-turn budget overrun                              | adapter cost tracking                                | graceful abort → `failed` + incident note                                                                                                    |
| 19                          | Monthly app budget hit                               | telemetry rollup                                     | app auto-paused + `budget-exceeded` approval item (architecture.md §7)                                                                       |
| 20                          | Approval grant expires before re-dispatch            | gate lookup                                          | item re-escalates as a fresh queue entry; nothing auto-approves                                                                              |
| 21                          | Approval queue neglected                             | item age                                             | ages shown in `operon approvals` and the Planner's daily digest; blocked items just wait — fail-closed                                       |
