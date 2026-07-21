# The Build Loop — engineering design

*Living design doc — last aligned 2026-07-19. The loop is Operon's center
of gravity: a TypeScript
re-engineering of the predecessor orchestrator — a private Python prototype
that proved the approach, called simply "the predecessor" throughout
(maintainers can find it read-only at* `scratchpad-gitignore/claude-loop-teams/`*)
— made framework-agnostic through the runtime adapters. This doc is the
detail layer for* `src/loop/`*;* `docs/architecture.md` *§3 holds the
surrounding turn/worktree machinery. §11 records decisions ratified into
docs/PURPOSE.md on 2026-07-06, 2026-07-13, and 2026-07-19; future new decisions should be proposed here
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


| Workload                 | Episode planning                                                                 | Loop behavior                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Greenfield product build | EpisodePlanner starts with product discovery/decomposition; complete child scopes can omit redundant child planner turns | Dependency-ordered ticket stream; test-infrastructure tickets first; cross-milestone integration tickets last |
| Feature additions        | EpisodePlanner selects only the roles, provider turns, gates, and approvals justified by the bounded goal | Accepted plan DAG plus contract/gates required by its facts                                                    |
| Bug batches              | Each episode is planned normally unless its creator deliberately supplied complete executable scope | Localized work stays small; ambiguous work gains diagnosis/reproduction without weakening mechanical gates    |


The workloads share one contract: `intent → plan → deterministic validation →
ready-step execution → evidence`. Quick/standard/deep is derived after plan
acceptance for compatibility, reporting, or a safety floor; it does not choose
the workflow.

**Episode planning precedes the delivery loop.** Normally EpisodePlanner runs
in both fixed and adaptive assignment modes. It may be skipped only when the
episode's human or agent creator explicitly supplied complete,
provenance-bearing scope that normalizes into the same executable plan. An
`op:ready` ticket, existing-ticket lifecycle, short prompt, or apparent
simplicity is never enough. Product-planning pipelines may still emit tickets,
but those tickets are inputs/artifacts rather than authority to bypass episode
planning.

## 1. Inheritance audit — what we keep, change, drop

From the predecessor (reviewed in full 2026-07-04):

**Keep (proven, ports directly)**

- Fresh session per pass; durable state between passes, never chat memory.
- Versioned prompt/gate protocol stages, now selected as typed EpisodePlan
steps with one atomic harness/model/effort assignment per provider turn.
- Mechanical preflight gates in orchestrator code — tests, lint, e2e, secret
regex scan, completeness, review freshness — risk-tiered by changed-file
globs, "no agent hallucination can bypass these"; gates run twice at ship.
- Structured findings grammar with severity-sorted feed-back to the builder;
bounce-by-status; selective re-review of unchanged work.
- Implementation-contract pass before code (files/approach/tests/risks).
- Bounded everything: 3 mechanical fix attempts in-pass, remediation cap 3,
review cycles cap, per-pass turn cap; blocked-with-evidence escalation.
Bounds are also ended early by *lack of progress*: a remediation attempt whose
gate run reproduces the previous attempt's failure identity exactly escalates
immediately rather than spending the remaining attempts on the same error.
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
- `skip_contracts` *global flag* → the validated plan explicitly includes or
  omits a contract step and records why, subject to deterministic floors.



## 2. The pass model

A **pass** is a configured protocol stage and an orchestration identity. For a
provider step in an accepted plan it is currently a one-step transport, not a
workflow selector:

```
pass normally invokes Runtime.runTurn(req, hooks) where
  req.task    = brief (assembled, §3) + pass prompt template (versioned file)
  req.context = TASTE layers + memory excerpts (architecture.md §5)
  req.role    = responsibility, instructions, tools, permissions, outputs
  assignment  = exact { harness, model, effort } authorized by the plan
```

A pass is not the provider-accounting identity. Each adapter invocation is a
distinct **provider turn** with exactly one settlement. If verdict reformatting,
recovery, or another substep invokes the adapter again, the pass may retain one
parent summary but must expose multiple provider turns and terminal execution
steps. A deterministic **mechanical step** constructs no adapter and has zero
provider settlements. The end-to-end **episode** owns the outcome and route;
a role invocation or pipeline does not create an independent route.

Rules, all inherited from the predecessor and now contract-level:

1. **Fresh session per pass.** No pass resumes another's session (crash
  recovery of the *same* pass may — architecture.md §3). Passes
   communicate only through durable artifacts: commits, PR/issue comments,
   ticket state. Disk/GitHub is the message bus.
2. **Prompts are versioned code.** Templates live in `prompts/<pipeline>/`
  in the org home — diffable, reviewable, and a protocol surface: the
   safety gate's `protocol-self-edit` rule extends to `prompts/**` and
   `pipelines.yaml` (gate.ts change + conformance cases).
3. **Assignment is atomic and separate from role authority.** The executor
  instantiates `assignment.harness`, then passes its exact model and effort.
  It never overrides only one member or infers a harness from a model. Role
  tools and permissions are applied after adapter selection and do not widen.
4. **Sequential passes re-read state; parallel groups are for independent
  writers.** Consecutive passes marked with the same `parallel_group` run
   concurrently and must declare disjoint outputs (competing roadmaps →
   separate files; the arbitrator merges).
5. **Harness delegation is per-step discretion.** `delegation.allow` governs
  what a pass may fan out *internally* (scouts, adversarial verifiers).
   The accepted plan is the workflow; delegation is tactics inside one step.
6. **Legacy per-pass safety caps** (the predecessor used `max_turns=50`) and
  the role's `max_turn_budget_usd` still bound the current implementation.
  They do not authorize additional episode spend. The target pre-provider-turn
  check uses the plan-derived route's remaining allowance from
  `docs/efficiency.md`.

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

## 4. EpisodePlan workflow and pipeline transport

The primary workflow is the accepted `EpisodePlan`, not `pipelines.yaml`. Its
typed DAG contains provider turns, mechanical gates, and approvals, each with
dependencies, bounded inputs, expected outputs, and terminal coverage.
Provider steps additionally carry role, required capabilities, exact atomic
assignment, candidate/source provenance, concise selection reason, and a
per-turn budget ceiling.

`pipelines.yaml` remains a human-ratified catalog of protocol templates and
gate vocabulary, a compatibility reader for historical/static episodes, and
the transport substrate for a planned provider step. The accepted-plan
executor synthesizes a single-pass `episode-plan-dag` pipeline for exactly one
authorized step. That transport cannot choose another role, insert a pass, or
override one member of the assignment tuple. Existing build/review/fix/ship
pipelines stay readable during migration, but their ordered pass lists are not
a second workflow authority.

### Planning, validation, and admission

For every episode, the org layer builds a bounded `EpisodeIntent` from trigger,
app/repository, role/capability, assignment-candidate, budget, safety, and
creator-scope facts. If creator scope explicitly declares its planning
disposition, provenance, objective and exclusions, acceptance criteria,
artifacts, constraints and safety facts, and complete governed steps/template,
it can normalize without a provider turn. Otherwise EpisodePlanner runs under
its fixed boot tuple. In fixed mode the planner chooses roles and steps, then
code resolves configured assignments; in adaptive mode every provider step
must choose an exact allowed candidate.

Pure validation checks role/tuple/capability membership, DAG integrity and
reachability, required outputs, independent provider review, deterministic
safety floors, approvals, terminal coverage, and budget arithmetic. A
planner-authored structural failure gets at most one bounded repair. Creator
scope that omits non-authoritative planning details invokes EpisodePlanner;
contradictory authoritative scope fails closed.

Closed workflow domains also supply one code-owned provider-operation
registry. Operon injects its sorted operation IDs into both the initial and
revision planner context and structured-output schema, then validates the same
registry before plan hashing or template resolution. An unknown operation is
a named plan-contract error that includes the valid IDs. An orchestrator
exception during acceptance is instead an internal failure with its own error
code and stack evidence; `plan_structure_invalid` is reserved for actual
schema/plan-contract defects.

The same domains supply a **mechanical-gate registry and topology contract**
on the identical terms: the gate vocabulary becomes a structured-output enum,
and `TICKET_EPISODE_TOPOLOGY_CONTRACT` — every enumerated topology rule with a
stable id, each gate's `requiredPlanInputs`, and a canonical reference topology
taken from an accepted plan — is rendered into the bounded brief. Validation is
the backstop, never the teacher: a rule the validator enforces but the contract
does not state is a defect in the contract (`ticket-episode-plan.ts`).

Gate input-availability is part of that contract and a pure graph property.
Each mechanical gate declares the durable inputs its handler reads but never
produces; acceptance proves an ancestor step in the same plan produces each of
them, and reports `ticket_gate_input_unavailable` naming the missing operation
when it cannot. Concretely, `ticket/gates-and-pr` and `ticket/ship` score the
`completeness` gate against the criterion→test mapping only `build/contract`
publishes, so a plan holding either gate without a `build/contract` ancestor is
unsatisfiable and is rejected before provisioning rather than after a paid
builder turn.

A repair must be **non-regressive**: its violation set must be a strict subset
of the violations of the proposal it repairs. The repair brief therefore
carries the invariants the rejected proposal already satisfied, not only the
error list, and a repair that introduces a new violation is reported as
`plan_repair_regressive` with the newly introduced violations named, ahead of
(never instead of) the original diagnostics.

The accepted plan is persisted atomically before delivery. Only then does
`episode-route.ts` derive the compatibility route and exact authorized provider
steps. Quick/standard/deep is a plan-complexity/safety label. It cannot add a
generic pass set or cap effort. Before every provider turn the existing
preflight, reservation, context-manifest, execution-step, and exactly-once
ledger checks remain mandatory.

Ready steps execute in stable dependency order. A failed assumption, new
scope, unavailable assignment, failed gate, approval constraint, or exhausted
estimate may request a bounded revision. Revision publication and execution
share the episode lock; only future work changes, while completed steps and
their artifacts, approvals, route evidence, and settlements remain linked to
the plan version that authorized them. Adapter unavailability never triggers
silent tuple substitution.



### Review dimensions — security always-on, the rest risk-selected

Functionality review (the `verify` pass) runs on every PR. The other review
dimensions — security, performance/scale, and any future lens — are
**conditional plan requirements validated against the same structured facts
that floor mechanical gates**: changed-file globs, repository/change facts,
and explicit safety facts from app policy. EpisodePlanner proposes the
smallest workflow above those floors; deterministic validation rejects a plan
that omits required independent/security/performance evidence. Adding a
dimension extends governed policy and protocol vocabulary, not an ad hoc
branch in the executor.

Published ticket labels are translated only by exact structured mappings:
`domain:auth`, `domain:security`, `domain:secret`, `domain:privacy`, and
`domain:payment` require the ticket security floor; `domain:data` requires the
data-integrity floor without pretending ordinary user-data work is a
migration; `op:perf-sensitive` and `op:incident` retain their typed
performance and incident floors. Title/body keyword matches never create or
remove safety authority.

Security is the deliberate exception — always-on, at two depths:

1. **Every PR, cheap:** the mechanical secret scan (§5) plus a security lens
   baked into the standard `verify` template (injection, authz, unsafe
   deserialization, secret handling — reviewed alongside functionality).
2. **On trigger:** a dedicated security provider step when structured facts
  identify authentication, secrets, sensitive ingress/parsing, or another
  policy-declared surface. The derived route will normally report `deep`, but
  that label did not choose the step.

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



### Derived labels and deterministic safety floors

Two compatibility labels remain, but neither authors the workflow:

- **Episode route** (`quick|standard|deep`) is derived from accepted plan
  complexity and typed safety facts. It supports reporting, historical readers,
  hard-ceiling selection, and an explainable safety floor.
- **Changed-file risk tier** in `.operon/policy.yaml` selects deterministic
  mechanical gate strength. A small plan touching a sensitive surface still
  receives the required gates; economy never weakens safety.

Product-ticket publication may continue to attach `op:tier-*` and `domain:*`
labels for compatibility. Its prose-sensitive-domain classifier is not the
EpisodePlan safety boundary. Before EpisodePlanner, Operon gathers typed safety
facts from the trigger, declared creator constraints, repository/change facts,
app policy, and explicit evidence references. Deterministic validation can add
a visible mandatory gate/approval floor or reject the plan, but it cannot
quietly manufacture a generic provider team. Prose keyword matching is never
the sole safety control.

The older `planning-depth/v2` and `route-policy/v1` records remain readable for
historical artifacts and derived compatibility reports. Product planning and
ticket delivery no longer use them to choose workflow. Their
`direct-execution` disposition, ticket tier, and selected pass set have no
authority to bypass EpisodePlanner or alter an accepted plan.



### Issue intake — Planner or human triage precedes execution

**Invariant: only governed product planning (or the human) applies**
`op:ready`**.**
All intake — human-filed issues, Support digests, SRE incident notes,
`op:returned` bounces, reviewer-escaped bugs — waits as plain issues until
a product-planning workflow or human explicitly triages it. That readiness
classification is separate from episode planning. A ready existing ticket
still runs EpisodePlanner unless its creator supplied an execution-ready scope
with provenance. The loop never builds an untriaged issue.

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
changes. (This superseded the early `LoopConfig {builder, reviewer}`
skeleton, which hardcoded two seats — since removed.)

## 5. Quality gates — deterministic, orchestrator-run

Distinct from the safety gate (critical-ops approval, every tool action,
in-session): quality gates run **between passes, as orchestrator
subprocesses against the worktree**. Port of the predecessor's gate engine:


| Gate             | Mechanics (ported)                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| setup            | run app's top-level `.operon/config.yaml` `setup_command` (a sibling of `apps`, never under `apps.<name>`; e.g. `npm ci`) in the worktree to install dependencies. It runs **at worktree provision, before the first implement pass** (`advanceProvisionSetup`, `src/loop/loop.ts`), and again **first within each post-implement gate set**, before any scheduled gate (`runGates`, `src/loop/qgates.ts`). The provision run is load-bearing: `createWorktree` provisions an empty tree, and the builder's mandatory "baseline before changes — if red, stop" check runs at the very start of the implement pass, so without deps that baseline fails for **every** greenfield ticket regardless of ticket quality (the L1-02 defect; the live operator's workaround was committing 26 MB of `node_modules`). Unconfigured = absent (no gate, never a failure) **unless the tree carries an unresolved setup artifact**. A provision-time setup failure returns the ticket loudly (blocked-with-evidence comment + `op:returned`) with no build turn spent; within a gate set a setup **failure short-circuits** the rest so the tests/lint gates don't produce misleading failures (`runSetupGate`). The gate also scans the worktree's package-manager config **before and after** the command (`src/loop/setup-artifacts.ts`): an unresolved tool placeholder (pnpm's literal `set this to true or false`) or a duplicated YAML mapping key fails setup with *that* cause, naming the file and the consolidation remedy, instead of letting it surface as an opaque `[ERROR] duplicated mapping key (4:1)` several attempts later. Before, because a corrupt file disables the tool the command invokes; after, because the install is what writes the placeholder. The subprocess itself runs under the deny-by-default dependency build policy (`PNPM_CONFIG_IGNORE_SCRIPTS=true`), so on the default path the placeholder is never generated at all; a ticket that genuinely needs a dependency built opts in explicitly in its `setup_command` (`pnpm install --frozen-lockfile --no-ignore-scripts` alongside a committed `allowBuilds` decision — a CLI flag beats env config), which is precisely why the scan is kept as a backstop |
| tests            | run app's `test_command`, exit code 0, timeout; last output lines on fail                                                                                      |
| lint             | `lint_command`                                                                                                                                                 |
| e2e              | `e2e_test_command` when configured                                                                                                                             |
| security         | regex scan of changed files against the canonical list in `src/runtime/secret-patterns.ts`: `sk-…`/`ghp_…`/`github_pat_…` keys, AWS key ids, Stripe/Slack/Google/npm tokens, Slack webhook URLs, JWTs, URL userinfo credentials, `-----BEGIN PRIVATE KEY-----`, and generic key/token/password assignments incl. snake_case forms (`GITHUB_TOKEN=…`, `aws_secret_access_key = …`); binaries skipped |
| completeness     | criteria present and parseable; every criterion has a covering test in the contract mapping; no unresolved findings on the PR. Checkbox state is gate *output*, not input: the orchestrator renders all boxes checked at merge (no process participant may write them earlier — see docs/proportionality-review.md §7) |
| review-freshness | branch HEAD == the APPROVE review's `commit_id` (GitHub-native); always runs regardless of tier                                                                |


`.operon/policy.yaml` (app repo, emitted by bootstrap) carries risk-tier
globs → gate sets, the review-dimension globs (§4), plus
`remediation.max_attempts` (default 3). Defaults mirror the predecessor's
template (high: tests+lint+security+completeness; medium drops security
scan; low: tests+completeness).

**Where gates run:**

0. **At worktree provision, before the first implement pass** — only the
   `setup` gate (`advanceProvisionSetup`). A fresh worktree has no
   dependencies, so this must precede the builder's baseline check; a failure
   returns the ticket with evidence before any build turn is spent. The
   post-implement gate set re-runs `setup` (idempotent), so this adds an
   install at provision, it does not replace the later run.
1. **After implement/fix, before the PR advances** — the reviewer is the
  org's most expensive seat (Opus, xhigh); never spend those tokens on
   code that fails `pnpm test` mechanically. Gate failure → **remediate**:
   re-dispatch a fix pass with verbatim gate output in the brief, up to
   `max_attempts`, then blocked. A gate run that fails with *exactly* the
   previous attempt's `remediation.failureIdentity` — the hash over the failing
   gates' verbatim evidence, duration excluded — sets `remediation.noProgress`,
   clears `canRetry`, and escalates with the real cause instead of buying
   attempts that would reproduce it (ISSUE-029: three builder attempts and
   $10.24 spent on one byte-identical pnpm parse error). The bar is identical
   error *identity*, never merely "failed again": a failure carrying no evidence
   at all (a bare non-zero exit with no output) has no identity and never
   triggers it, and any change in the evidence retries normally.
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
- When typed safety facts or policy require it, criteria get **human sign-off**
  with the spec (co-planning session or spec-PR review) before any `op:ready`
  label. The derived route may report `deep`, but the approval fact is the
  authority — the human helps define "done", not just approve the diff.
- The Builder's contract pass maps **each criterion to named tests**; the
  completeness gate (table above) fails — not warns — when a ticket has no
  parseable criteria or a criterion has no covering test. The gate distinguishes
  the two failures that wear the same words: an **absent** mapping is a planning
  defect (no `build/contract` pass produced one, so nothing can be scored and no
  builder work can fix it), while a criterion uncovered **within** an existing
  mapping is a build defect. Plan acceptance now rejects the planning defect
  outright, so the gate should only ever report the build one.
- Criteria are never summarized out of briefs (§3) and never edited by the
  Builder; a criterion that proves wrong bounces the ticket to the Planner.
  Checkbox state is written once, by the orchestrator, when the ticket
  merges — the merged ticket reads checked-off without any agent or human
  touching the issue body mid-flight.

## 6. Verdicts — structured outputs, no prose-driven control flow

Every pass has a typed verdict the orchestrator acts on:

```ts
// src/loop/verdicts.ts — sketch
type ContractVerdict = { files: string[]; approach: string;
                         tests: { criterionId: string; tests: string[] }[];
                         risks: string; complexity: "low"|"medium"|"high" };
type BuildVerdict    = { status: "done"|"blocked"; blockedEntry?: BlockedEntry };
type ReviewVerdict   = { verdict: "approve"|"findings";
                         findings: Finding[];
                         review: { rationale: string;
                                   evidence: { claim: string; evidence: string }[];
                                   notReviewed: string[] } };
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
present ∧ freshness ∧ mechanical gates green. The reviewer emits only the
typed verdict: non-empty rationale and claim/evidence pairs make an approval
auditable, while `notReviewed` records deliberately excluded scope. After the
provider turn has terminated, the orchestrator deterministically renders and
publishes that verdict as the real GitHub review. The delivery marker binds
the execution id, provider run, verdict content, and exact reviewed commit;
recovery re-lists GitHub and accepts exactly one matching remote effect, so a
crash cannot duplicate publication and a concurrent push fails closed. The
reviewer never invokes `gh`, writes a review-body file, or retries delivery.
A real `APPROVED` review authorizes a merge
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
a static string anyone can post: it carries an HMAC over the PR number **and
the reviewed commit** (`headRefOid`) signed with an orchestrator-only secret.
By default Operon race-safely creates and validates that key at
`<stateHome>/state/self-approval-secret` (regular owner-only file, never prompt
context or provider environment); `OPERON_SELF_APPROVAL_SECRET` remains an
explicit compatibility override. One resolved value is passed to both
`GhCliOps` signing and `authorization.selfApprovalSecret` verification.
Binding the commit is what defeats replay (A-001):
the marker is published into a world-readable review, so a prompt-injected
builder can copy it, push arbitrary code, and post it again — but the loop
recomputes the HMAC against the review's own `commit_id`, which GitHub stamps to
the *new* head, so the replayed tag no longer verifies. The loop upgrades a
COMMENTED review to an approval only when the HMAC verifies for that reviewed
commit (`verifiedSelfApprovalMarker` in src/loop/github.ts, a `timingSafeEqual`
check), the review clears the same author-independence gate as a real APPROVE
(`isMarkedSelfApproval` mirrors `isIndependentApproval`), *and* the body is a
structured `Verdict: approve`, and still enforces commit freshness against the
branch head. A corrupt, linked, or weakly-permissioned state key, a missing key
on a read-only preview, or an unresolved reviewed commit fails closed — a bare
marker is never trusted. (Threading the secret to the agent's own environment
would re-open the forgery, so it must stay orchestrator-only.)



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
building ── typed contract pass → contract comment on issue
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

Standing-role Planner feeds are a bounded lifecycle input, not replayable
prompt history. Their producer/source/payload identity is deterministic;
groom renders only a byte-bounded pending batch. A crash or failed Planner
pass leaves that batch pending. A completed pass first records a content-bound
consumption manifest and then commits an idempotent receipt; reconciliation
finishes interrupted receipt applications. Superseded/consumed records age to
expired and are pruned, but unconsumed records are retained and deferred to a
later batch rather than discarded.

A **legitimately-fired cap during review or ship-check** — a route/provider
budget cap or a wall-clock/adapter timeout that aborts the pipeline — is
terminalized the same way (L-005): `runReviewPipeline`/`runShipCheckPipeline`
route `op:in-review -> op:returned` with a budget/limit-exhaustion evidence
comment and leave the open PR untouched, instead of throwing and crashing
`operon loop --once` (which stranded the ticket at `op:in-review` with a
mergeable-but-orphaned PR). The distinction is `journalStopKind`: a
`cap_stop`/`provider_timeout` terminalizes cleanly; a genuine internal error
(`crash`) still throws loudly so a real defect is never swallowed.

Completion detection is **state-based, never string-based**: the tick reads
labels, PR/review state, and gate results — the predecessor's
completion-detection philosophy with GitHub as the state store.

### 7.1 Continuation from durable artifacts (proportionality-review Stage 2)

A re-claim is **not** a blank slate. Before claiming, the driver rehydrates
ticket-lifetime state from the artifacts previous turns left behind
(`src/loop/rehydrate.ts`):

`efficiency/episodes/<episode>/plan-current.json` and
`plan-execution-journal.json` select the persisted plan version and next ready
step. A legacy ticket-delivery step may then consult `execution-journal.json`
for its finer contract, implementation, push, gates, PR, findings, approvals,
merge, and release boundaries. Accepted boundary fingerprints are reused.
Ticket, commit, or reopened-finding drift records why future work was
invalidated; no still-valid productive prefix repeats. `operon loop
--resume-episode <episode>` is a **read-only preview** of that decision — it
prints the resume plan (`{ "preview": true, "resume": … }`) and states plainly
that it does not execute; actual continuation is `operon loop --app <app>`,
which claims the ticket and resumes from these durable artifacts (L-005).

Every still-valid decision and accepted artifact survives cancellation,
timeout, approval wait, cap, retry, and process restart. A productive pass may
repeat only after a durable invalidation record names the artifact or decision,
the new evidence, and the executable next step. Unaccepted worktree scratch may
remain disposable; contracts, commits, pushed refs, findings, approvals, gate
evidence, usage checkpoints, and terminal records do not.

Approval waits add one narrower continuation boundary. A
`blocked_on_gate` result persists the exact pipeline/pass, native session,
completed passes, context-manifest fingerprint, worktree fingerprint, run id,
settled pause cost, and human decisions. `operon approvals review` records an
approved or denied decision before repairing `op:blocked → op:ready`; the next
claim reuses the original claim number and resumes only that pass. Completed
passes and setup are excluded. A role, runtime, route, context, or worktree
near-miss fails before runtime construction. Approval pause, resume, repeated
cost (zero for an exact continuation), and terminal outcome remain distinct
claim-lifecycle events.

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
- **Recoverable claim saga and cap.**
  `<stateHome>/tickets/<app>/<issue>.json` records a provisional claim before
  the GitHub label transition and commits the count only immediately before
  the first provider turn. The next tick auto-rearms an orphaned pre-provider
  claim without consuming allowance; an orphaned post-provider claim returns
  fail-closed for explicit review. At the cap (default 3,
  `LoopDriverOptions.maxClaims`)
  the driver refuses to claim and parks the ticket `op:returned` with an
  evidence digest (prior claim outcomes, contract state, PR, open
  findings) and an exact `operon loop rearm --app ... --ticket ... --reason
  ... --actor ... --from-allowance ... --to-allowance ...` transaction.
  Preview is the default; execution binds the app, ticket, reason, actor, old
  allowance, new allowance, and prior label in a replay-safe prepared/completed
  record. Rearm applies only while the episode route is still open: a terminal
  route is immutable, so the command refuses before changing the allowance,
  rearm record, or label and directs the operator to leave the old ticket
  parked and create a new ticket. A live tick also repairs a stale or malicious
  terminal+`op:ready` projection back to `op:returned` before acquiring a
  claim, emitting an explicit error instead of endlessly claiming and
  auto-releasing it. The manual command exits nonzero and records a distinct
  invocation outcome; dispatch reports `blocked_on_gate`, never completed
  idleness. A label-only `op:ready` edit cannot change the durable cap. The
  `CLAIM RECOVERY` block in `operon status` explains the stopped
  boundary and next action. The episode's human
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
- **Re-arm is orchestrator-owned, not prompt-advisory (L-007).**
`publishTickets` creates a dependency-locked ticket **stateless** (no
`op:ready`), so `selectReadyTickets` never claims it until it is armed. The
merge transition owns that arming: when a predecessor merges, `rearmDependents`
(`src/loop/loop.ts`, called from the driver's merge path) promotes every
now-unblocked stateless dependent to `op:ready` with an evidence comment — no
manual label edit, and no reliance on the Planner "groom" pass, which the live
campaign confirmed was unenforced (10/17 tickets never claimed; a human did all
re-arms by hand). A dependent with any op-state label already has an owner and
is left untouched.
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
                    rollups, gate results, redacted durable verdict material,
                    tool counts (see the tool-telemetry note below), truncated
                    previews, runtime/model/effort, actual workdir, branch,
                    and git HEAD at pass start (git_head — the learning loop's replay seed, absent for
                    non-git workdirs and pre-M2 runs); REFERENCES to
                    L3 evidence and native provider session identity, never
                    full prompts inlined (the wf_*.json
                    monolith lesson)
  events.jsonl      L2 — append-only structured events, timestamped
  brief.md          L3 — exact assembled brief (forensics/reproducibility)
  prompt.md         L3 — exact Runtime.runTurn input (brief + pass template)
  output.md         L3 — final output text
  session.log       L3 — structured activity log fed by TurnHooks.onEvent;
                    explicitly NOT a full transcript
  published-tickets.json  (final planning pass only) — orchestrator-owned
                    publication evidence written AFTER finalize: issue
                    numbers plus the same episode/run/trace identity each
                    ticket body's `Planned-by:` trailer carries (#128).
                    A sibling file by design — terminal envelopes are
                    never patched.
```

`runId = YYYYMMDD-HHMMSS-<pipeline>-<pass>`, chronologically sortable.

- **Correlation ids on every L2 event:** `trace_id` = turnId (minted at
dispatch, one per pipeline execution), `span_id` per pass, and
`parent_span_id` linking subagent events. The adapters' `TurnEvent
{type:"subagent"}` stream is buffered during the turn and flushed to L2 in
order afterward as `subagent.started/completed` spans nested under the pass
span (`flushBridgedEvents`, src/loop/pipeline.ts) — so fan-out trees
**are** reconstructable (`reconstructSpanTree`) without opening transcripts.
session.log still receives every activity event live. Full-transcript
availability is explicit in `envelope.session`: Codex records a native
`codex://threads/<id>` task link; runtimes that expose only a session id say
so rather than relabeling the activity log. Plus `app`, `ticket`,
`pipeline`, `pass`, `role`, `model` on everything.
- **L2 event taxonomy:** `run.started/completed`,
`pass.started/heartbeat/completed/failed`, `gate.started/passed/failed`,
`tool.called` (name, duration, success — never full args),
`subagent.started/completed`, `ticket.transition`, `verdict.recorded`,
`escalation.raised`, `telemetry.settle_skipped` (a ledger settle found its
app+providerTurnId, or legacy app+runId, already present). Every line timestamped, severity
field, machine `error_code`. **Stage 3 additions:** the executor stamps a
30-second heartbeat onto the envelope (`last_seen_at`) and emits
`pass.heartbeat` into `events.jsonl`, so status readers and live tails can
distinguish active passes from stalled ones; a separate 30-second adapter-start deadline waits
for the first provider progress/event and aborts an initialization/auth/
transport stall as `failed(error_adapter_start_timeout)`; a per-pass
wall-clock watchdog cancels the owned provider tree and
finalizes a hung pass `timed_out(error_wall_clock_exceeded)` with an
unavailable-usage ledger row; operator SIGINT/SIGTERM similarly finalizes
`cancelled(error_cancelled)`. When no pass override is present, the configured
ceiling remains 60 minutes, but the effective watchdog is always the smaller
of that ceiling and the episode's remaining active-time allowance.
Adapters checkpoint cumulative usage and native
session identity during execution, so an interrupted pass retains partial
spend instead of reverting to zero. Adapter
failure codes (`error_max_budget_usd`, …) flow into `pass.failed` and the
envelope instead of a generic `error_turn_failed`; failed gates retain the
exact command and a bounded, scrubbed output tail in both the `gate.failed`
event and `envelope.gate_results`. **What is wired today:** the pass executor emits
`run.*`/`pass.*`/`escalation.raised` and bridges `subagent.started/completed`
from the adapters' `onEvent` stream into L2 (`flushBridgedEvents`,
src/loop/pipeline.ts); the state machine emits `gate.started/passed/failed`
and `ticket.transition` (via a per-step run record, src/loop/loop-runlog.ts
`openPhaseRun`) and populates `envelope.gate_results`; `verdict.recorded`
lands from `recordPassVerdict`. **Tool telemetry is live** (issue #27,
live-verified 2026-07-11 — `research/2026-07-11_adapter-tool-events.md`):
all three adapters emit `TurnEvent{type:"tool_use"}` for gate-allowed tool
calls through the one shared builder (`src/runtime/tool-events.ts`), and the
L2 bridge turns them into `tool.called` events and `envelope.tool_counts`.
Residual caveat: Claude and pi emit at their pre-execution intercept points,
so their events carry no outcome fields and the bridge defaults
`success: true` / `durationMs: 0`; Codex emits post-execution with real exit
codes and durations.
- **Infra and merit never conflate** (the doc's sharpest lesson: "infra
failures looked like merit failures until you read verify stats"). A
pass that *errors* is `failed` with an `error_code`; a pass that
*concludes findings/blocked* is a merit outcome. A parsed build verdict with
`status: blocked` therefore finalizes its envelope as `blocked` even though the
provider transport itself returned normally. Structured JSON in
`verdict_summary` remains complete and parseable after redaction; only prose
summaries and the separate `previews` map use the presentation-size cap.
Dashboards, retro, and scorecards read infra and merit as different populations.
- **Dashboards read L1+L2 only.** `operon status` / `operon analyze` never
parse transcripts; previews are truncated (~120 chars), args hashed. Status
adds a bounded `TERMINAL ATTENTION` line for failed, blocked, cancelled, and
timed-out rows using the persisted terminal diagnostic, so the reason is
visible without opening the run directory.
- **Redaction is a precondition for export** and applies to L1/L2 always:
no full prompts, no tool args, no secrets — the quality-gate secret
regexes double as a log scrubber. L3 stays local, retention =
`session_retention_days`; run dirs pruned on the same schedule. Run-dir
pruning (and retention for every other state subtree) runs daily from the
dispatch tick's org-wide retention sweep — docs/scheduler.md → State
retention; `operon prune-runs` remains the manual surface.
- **Attribution is exact** — runs are ticket-scoped by construction; costs
roll up run → ticket → (role, app) → monthly budget with no
weighted-mention guessing. The predecessor's `UNATTRIBUTED` bucket disappears.
  - **Which spend reaches the monthly budget rollup:** all of it. The pass
  executor settles **every** provider turn into the org telemetry ledger
  (`~/.operon/<org>/telemetry/<day>.jsonl`, the source `operon budget` sums)
  exactly once, keyed on `(app, providerTurnId)` for new rows with legacy
  `(app, runId)` fallback — completed, blocked, and failed invocations alike,
  from the dispatcher and the manual `operon loop` driver both
  (Stage 1 of the proportionality campaign). A loop tick whose app has
  exhausted its monthly cap refuses to claim before any pass starts, so the
  budget hard-stop (architecture.md §7) governs manual and dispatched turns
  equally. `operon budget --reconcile` back-fills the ledger from run
  envelopes (idempotent). The retired native interactive planner no longer
  creates fabricated zero-usage rows; live planning uses the ordinary measured
  EpisodePlan path. New ledger rows also carry
  `usageQuality: complete|partial|estimated|unavailable`; dashboards label
  recorded lower bounds instead of presenting unknown spend as free.
  - **Exactly-once is indexed, not rescanned (F-002).** `recordTurnOnce`
  answers its idempotency check from a compact keys-only sidecar,
  `telemetry-index/settled.keys` (a sibling of `telemetry/`, kept out of the
  ledger directory so bare enumerators never parse or double-count it), one
  settlement key per line — not by re-parsing
  every `<day>.jsonl` on every write (which made settling N turns over a
  system's life O(N²)). The sidecar is appended **ledger-first** under the same
  cross-process settlement lock, so it can only ever lag the ledger, never lead
  it: an index-hit always implies a ledger row (no lost turn), and the two
  re-settle paths — the one-shot pass executor and `reconcileLedger`, which
  reads the authoritative ledger first — never re-present a settled key (no
  duplicate). The full ledger scan survives only as the rebuild path when the
  sidecar is absent (legacy org, operator deletion). Budget accounting still
  sums the `<day>.jsonl` rows, never the index.
  - **A settlement failure never discards a paid turn (L-005).** The pass
  executor writes the durable execution step *before* it settles, and wraps the
  settlement call so a throw (e.g. a lock timeout under contention) records a
  `telemetry.settle_failed` event and leaves the completed turn intact rather
  than unwinding the pipeline past money already spent. `operon budget
  --reconcile` back-fills the ledger row from the durable execution step.
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
shipped in context assembly). **All five fire today:**
`low_tokens_high_time`,
`single_turn_long_run`, and `cold_cache` read envelope timing/usage fields;
`bash_heavy` reads `envelope.tool_counts["bash"]` and `environment_retry`
reads `tool.called` events tagged `environment_retry` — both populated by
the adapters' `tool_use` events (issue #27, note above). Flags map to canned
recommendations and feed the weekly retro (architecture.md §6). Stale
`running` envelopes additionally fire `stale_running` and
`missing_finalization` after three minutes without a heartbeat.

`operon telemetry --html <report>` writes a static report plus an adjacent
`<report>.evidence/` copy bundle. Links target the copied envelope, exact
prompt, brief, output, events, and activity log, so browser file-origin rules
never require mutating or serving the state home. Its completion-integrity
section compares observed passes with the trace's selected-pass manifest,
shows skipped routing passes and stale/interrupted runs, and marks reviewer,
cost, manual-fallback, and PR evidence as unknown when the run generation did
not record them.

The broader operator session is explicit rather than inferred from pass text.
`operon task begin` stores `tasks/<taskId>/task.json` plus the exact outer
prompt in `prompt.md`; `OPERON_PARENT_TASK_ID` (or `--parent-task`) stamps the
id on every child envelope and ledger row. `task fallback` is durable evidence
that work left Operon, and `task finish` records terminal status plus external
ticket/trace/branch/PR/review/deployment references. Telemetry requires every
declared stage, completed trace manifests, no fallback, and a terminal parent
task before it can say “Operon end-to-end complete.”



## 10. Module map & contract deltas

```
src/loop/
  episode-plan.ts   versioned intent/scope/plan contracts, pure validator,
                    atomic persistence, forward-only revision rules
  episode-plan-executor.ts deterministic plan-DAG readiness, journal and resume
  episode-route.ts  one-way accepted-plan → route/authorization projection
  episode-replan.ts typed material events and bounded revision requests
  planner-admission.ts planner boot-turn reservation/settlement/repair bounds
  loop.ts          ticket state machine (§7): phases, label swaps, bounded
                   review/gate/ship cycles, squash-merge
  driver.ts        manual tick driver: advance ready tickets once (`operon
                   loop` and the sandbox e2e; dispatch calls the same phases)
  pipeline.ts      provider-step/static-compatibility transport, exact atomic
                   assignments, runlog + ledger settlement per invocation
  pipelines.ts     pipelines.yaml schema/loader — typed, validated config
  brief.ts         brief assembler (§3), state-budgeted
  qgates.ts        quality-gate engine (§5) — pure subprocess + git
  verdicts.ts      typed verdicts + lenient parsers (§6)
  github.ts        provider-blind GitHub ops (`gh` wrapper): labels, PRs,
                   reviews, verified self-approval fallback, squash-merge
  loop-runlog.ts   per-step run records for between-pass work (gates,
                   ticket transitions)
  rehydrate.ts     continuation from durable artifacts (§7.1): contract
                   reuse, findings ledger, claim cap
  scheduling.ts    ticket-level scheduling (§8): dependency-aware,
                   scope-overlap conservative, WIP-bounded
  policy.ts        .operon/policy.yaml loader: risk tiers → gate sets
  preflight.ts     token-free config/capability/budget/artifact/environment
                   admission before any model turn
  route-policy.ts  legacy static-route compatibility reader; not plan authority
  execution-journal.ts durable route-to-release boundary and invalidation log
  context-manifest.ts component budgets, hashes, deltas, dedupe and explain
  plan-tickets.ts  schema-validated, orchestrator-published planning tickets
  runRole.ts       low-level one-pass transport retained for dry-run/tests;
                   live manual turns enter the org EpisodePlan boundary
  types.ts         LoopItem/LoopPhase and shared loop types
prompts/           pass templates (org home, human-ratified)
pipelines.yaml     pipeline → passes config (org home, human-ratified)
```

Import direction holds: `src/org` (dispatcher) → `src/loop` → `src/runtime`.
`src/org/episode-planner/` owns bounded intent/policy/runtime orchestration and
calls these provider-neutral contracts. Planned provider steps and historical
static pipelines use the same `pipeline.ts` transport; the executor is
loop-layer machinery, not a workflow designer or build-loop-specific runtime.

The contract deltas this design flagged all landed: the gate's
`protocol-self-edit` rule covers `pipelines.yaml` and `prompts/**`
(src/runtime/gate.ts, conformance cases both sides);
`TurnRequest.verdictSchema` and the `TurnUsage` cache split
(`tokensInUncached` / `cacheCreationTokens` / `cacheReadTokens`) live in
src/runtime/types.ts; `LoopItem` carries `tier` / `remediationAttempts` /
`gateResults` and `LoopPhase` the `gates`/`shipping` states
(src/loop/types.ts); the conformance suite carries the large-payload case
(test/conformance/cases.ts) and the cache-stability case runs live
(test/runtime/claude-sdk.live.test.ts).



## 11. Ratified decisions promoted to docs/PURPOSE.md

Decisions 1–8 were ratified by the human operator on 2026-07-06; decision 9
was ratified on 2026-07-13, and decision 10 on 2026-07-19. All are promoted to
docs/PURPOSE.md; decision 10 supersedes conflicting static-workflow mechanics:

1. **The loop is protocol-driven at the substage level.** The orchestrator
  owns versioned prompts, typed gates, and evidence contracts executed through
  runtime adapters. Static pass ordering and per-pass overrides are now
  compatibility input/transport, not the primary workflow authority.
2. **Quality gates are orchestrator code**, distinct from the safety gate:
  risk-tiered mechanical preflight (tests/lint/e2e/secret-scan/
   completeness/review-freshness) between passes and twice at ship; the
   judgment layer runs only above a green mechanical layer; no side effect
   ever keys off agent prose.
3. **Historical product-planning separation.** Product planning was a Planner
  pipeline and the ticket its build-loop contract. Decision 10 adds universal
  execution episode planning before delivery, including an existing ticket.
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
9. **The episode owns route and execution economy** (ratified 2026-07-13).
  Admission precedes runtime construction; each adapter invocation is a
  separately settled provider turn; valid artifacts survive interruption;
  and review/safety evidence is never traded away for a label. Decision 10
  makes that route a plan projection rather than a workflow selector.
10. **EpisodePlanner and atomic assignment** (ratified 2026-07-19). Every
  episode persists one validated plan before delivery. Normally EpisodePlanner
  designs the shortest sufficient graph in fixed and adaptive assignment
  modes; only explicit execution-ready creator scope bypasses its provider
  turn. Harness/model/effort is indivisible, role authority remains separate,
  revisions are forward-only, and quick/standard/deep cannot select workflow.



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

Historical decision, 2026-07-06: milestone planning used the deep `plan`
pipeline and the per-pass wall-clock cap fell back to 60 minutes. P0-06
(2026-07-13), then decision 10 (2026-07-19), supersede both as
workflow-selection defaults. The accepted EpisodePlan selects the smallest
sufficient graph and derives its safety route. The implementation still
honors per-pass `wall_clock_minutes` and `killHungTurns` still uses the legacy
fallback when unset, but that fallback is a non-normative kill ceiling.



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
| 2a                          | Adapter initialize/auth/transport stalls before any provider event | adapter-start deadline (default 30 sec) | abort owned provider tree; finalize `failed(error_adapter_start_timeout)` with partial/unavailable usage                                     |
| 2b                          | SDK session hangs after starting                     | smaller of configured per-pass ceiling and episode remaining active-time allowance | kill; retain partial usage and resume from the next legal journal boundary                                                         |
| 3                           | Dispatcher dies mid-claim                            | provisional claim lease + next-tick reconciliation  | pre-provider: repair label, retain artifacts, consume no claim; post-provider: return with evidence and require exact durable re-arm          |
| 4                           | Host asleep / offline                                | nothing runs                                         | missed schedules collapse to one firing; distributed item state resumes on any later tick                                                    |
| 5                           | GitHub API down / rate-limited                       | API errors on tick                                   | loud L2 event; retry next tick (polling is idempotent); repeated → anomaly flag + incident note                                              |
| 6                           | Session resume or content binding fails              | adapter error or role/runtime/context/work fingerprint mismatch | fail closed before blind retry; preserve session/work evidence and require explicit re-arm or a newly authorized claim            |
| 7                           | Run-dir / session growth                             | retention job                                        | pruned on `session_retention_days`; L1/L2 kept longer than L3; the dispatch tick runs the daily org-wide sweep (docs/scheduler.md → State retention)                                                                |
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
