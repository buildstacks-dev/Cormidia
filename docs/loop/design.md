# The Build Loop — engineering design

*The loop is Cormidia's center of gravity: a TypeScript re-engineering of a
private Python prototype ("the predecessor" throughout), made
framework-agnostic through the runtime adapters. This doc is the detail layer
for* `src/loop/` *— §numbering is a stable citation surface for code comments,
`pipelines.yaml`, `.cormidia/policy.yaml`, and the validation corpus. §14
absorbs the former `turns.md` (turn lifecycle/worktrees/crash recovery), §15
the former `github-conventions.md`. §11 records decisions ratified into
docs/PURPOSE.md; new decisions are proposed here first, promoted only after
human ratification. The full pre-trim narrative is preserved at
`929c8247:docs/loop/design.md`.*

## 0. Position

**Thesis (human operator, 2026-07-04): "throw a ticket at an agent" does not
work.** The difference between a failed run and a shipped PR is (a) how much
*context* the agent receives, and (b) how much of the process is
*deterministic orchestrator code* that no model output can bypass. The
predecessor's canonical failure: an agent outputs "SHIP READY" without running
checks and broken code merges to main. The fix is never a better prompt; it is
code.

The loop serves three workloads — greenfield product build, feature additions,
bug batches — through one contract: `intent → plan → deterministic validation
→ ready-step execution → evidence`. Quick/standard/deep is derived after plan
acceptance for compatibility/reporting/safety-floor purposes; it never chooses
the workflow.

**Episode planning precedes the delivery loop.** EpisodePlanner may be skipped
only when the episode's human or agent creator explicitly supplied complete,
provenance-bearing scope that normalizes into the same executable plan. An
`op:ready` ticket, existing-ticket lifecycle, short prompt, or apparent
simplicity is never enough.

## 1. Inheritance audit — what we keep, change, drop

**Kept from the predecessor** (reviewed in full 2026-07-04): fresh session per
pass with durable state between passes; versioned prompt/gate protocol stages;
mechanical preflight gates in orchestrator code, risk-tiered by changed-file
globs, run twice at ship; the structured findings grammar with severity-sorted
feedback; the implementation-contract pass before code; bounded everything
(fix attempts, remediation, review cycles, per-pass turns — ended early on
*lack of progress*, §5); per-run artifact logging and exact cost attribution;
decomposer discipline (atomic/testable/scoped/ordered tickets, binary
criteria); state-budgeted prompts.

**Changed:** state home is GitHub artifacts (labels, comments, reviews), not
repo task files — durable, human-visible, the idempotency substrate
(architecture.md §3). Unit of work is **one delivery unit = one branch = one
PR** (one or more tickets). Review identity is a **different provider**, not a
different prompt (roles.yaml builder/reviewer pairing — uncorrelated blind
spots). Review freshness is GitHub-native (`APPROVE` bound to `commit_id`;
ship requires HEAD == approved commit). The dispatcher's tick drives
everything; `cormidia loop` is the manual driver. Golden principles arrive
once via context assembly (TASTE layer, architecture.md §5), never copied into
pass prompts.

**Dropped:** "SHIP READY" string parsing (all verdicts structured, §6; merges
key off GitHub review state + gates, never prose). Silent best-effort
`except: pass` — the Cormidia rule is **every orchestrator side effect either
succeeds, retries, or lands in telemetry + an incident note** (TASTE §6).
In-scope worktree parallelism (revived one level up as ticket parallelism,
§8). The `skip_contracts` global flag (the validated plan includes or omits a
contract step explicitly, subject to deterministic floors).

## 2. The pass model

A **pass** is a configured protocol stage and an orchestration identity — for
a provider step in an accepted plan, a one-step transport, not a workflow
selector:

```
pass normally invokes Runtime.runTurn(req, hooks) where
  req.task    = brief (assembled, §3) + pass prompt template (versioned file)
  req.context = TASTE layers + memory excerpts (architecture.md §5)
  req.role    = responsibility, instructions, tools, permissions, outputs
  assignment  = exact { harness, model, effort } authorized by the plan
```

A pass is not the provider-accounting identity: each adapter invocation is a
distinct **provider turn** with exactly one settlement, and a substep that
invokes the adapter again (verdict reformat, recovery) exposes additional
provider turns and terminal execution steps. A deterministic **mechanical
step** constructs no adapter and has zero settlements. The end-to-end
**episode** owns the outcome and route.

Contract-level rules:

1. **Session identity is exact.** Crash recovery may resume the same pass.
   Batch affinity may offer a settled session to another execution unit only
   when app, role, atomic assignment, operation, runtime, and ordered
   immutable-prefix hash all match exactly. Builder state is never offered to
   Reviewer. Every reuse still creates a distinct provider turn and per-unit
   settlement. Passes otherwise communicate only through durable artifacts —
   disk/GitHub is the message bus.
2. **Prompts are versioned code.** Templates live in `prompts/<pipeline>/` in
   the org home; the safety gate's `protocol-self-edit` rule extends to
   `prompts/**` and `pipelines.yaml`.
3. **Assignment is atomic and separate from role authority.** The executor
   instantiates `assignment.harness`, then passes its exact model and effort —
   never overriding one member or inferring a harness from a model. Role
   tools/permissions apply after adapter selection and do not widen.
4. **Sequential passes re-read state; parallel groups are for independent
   writers.** Same-`parallel_group` passes run concurrently and must declare
   disjoint outputs.
5. **Harness delegation is per-step discretion.** `delegation.allow` governs
   internal fan-out; the accepted plan is the workflow, delegation is tactics
   inside one step.
6. **Legacy per-pass safety caps** and the role's `max_turn_budget_usd` still
   bound the implementation but authorize no additional episode spend; the
   pre-provider-turn check uses the plan-derived route's remaining allowance
   (`docs/episodes/contract.md`).

**Adapters must accept multi-hundred-KB task payloads** via a robust channel
(SDK streaming input, stdin, or file) — the predecessor's ARG_MAX lesson,
enforced as a gate-conformance-suite case.

## 3. Brief assembly

The brief is the answer to "fix this bug + source code" vs "feature doc +
relevant PRD + learnings so far + fix this issue." Assembled deterministically
by `src/loop/brief.ts` per pass; logged verbatim in the run artifact (§9).

```
[ticket]     issue title/body: goal, context, acceptance criteria, scope
[spec]       linked documents resolved & excerpted, budgeted; whole doc if
             small, relevant sections by heading match otherwise
[contract]   the implementation contract, on implement/fix passes
[findings]   on a bounce: reviewer findings, severity-sorted; on gate
             remediation: verbatim gate output — actual error text, never a
             summary
[history]    prior attempts: blocked-entry comments, "attempt 2 of 3"
[memory]     OKF excerpts (architecture.md §5), selected once per pipeline
             execution, fixed across passes (cache-stable assembly)
[repo]       app conventions: build/test commands from .cormidia/config.yaml
```

**Budgeted like the predecessor's state budget:** estimate tokens (len/4 to
start); over budget, summarize the *oldest resolved* material first while
active material stays verbatim. The ticket and acceptance criteria are never
summarized. Feature specs live durably at `docs/specs/<date>-<topic>.md` in
the app repo; tickets link them in Context and the assembler does the rest.

## 4. EpisodePlan workflow and pipeline transport

The primary workflow is the accepted `EpisodePlan`, not `pipelines.yaml`. Its
typed DAG contains provider turns, mechanical gates, and approvals, each with
dependencies, bounded inputs, expected outputs, and terminal coverage;
provider steps carry role, capabilities, exact atomic assignment, provenance,
selection reason, and a per-turn budget ceiling.

`pipelines.yaml` remains a human-ratified catalog of protocol templates and
gate vocabulary, a compatibility reader for historical/static episodes, and
the transport substrate: the accepted-plan executor synthesizes a single-pass
`episode-plan-dag` pipeline for exactly one authorized step, which cannot
choose another role, insert a pass, or override one member of the assignment
tuple. Two tiering axes stay deliberately orthogonal: the episode route label
and the changed-file risk tier (below).

### Planning, validation, and admission

The org layer builds a bounded `EpisodeIntent` from trigger, app/repository,
role/capability, assignment-candidate, budget, safety, and creator-scope
facts. Creator scope that explicitly declares its planning disposition,
provenance, objective/exclusions, acceptance criteria, artifacts, constraints
and safety facts, and complete governed steps can normalize without a provider
turn; otherwise EpisodePlanner runs under its fixed boot tuple (fixed mode:
planner chooses roles/steps, code resolves configured assignments; adaptive
mode: every provider step chooses an exact allowed candidate).

Pure validation checks role/tuple/capability membership, DAG integrity and
reachability, required outputs, independent provider review, deterministic
safety floors, approvals, terminal coverage, and budget arithmetic. Key
contract points:

- **Registries are injected, validated, and closed.** Closed workflow domains
  supply a code-owned provider-operation registry and a mechanical-gate
  registry + topology contract (`TICKET_EPISODE_TOPOLOGY_CONTRACT`): the
  vocabulary becomes a structured-output enum, every topology rule has a
  stable id, and the contract is rendered into the bounded brief. Validation
  is the backstop, never the teacher — a rule the validator enforces but the
  contract does not state is a defect in the contract
  (`ticket-episode-plan.ts`). An unknown operation is a named plan-contract
  error listing the valid IDs; an orchestrator exception during acceptance is
  an internal failure with its own error code, never `plan_structure_invalid`.
- **Gate input-availability is a pure graph property.** Each mechanical gate
  declares the durable inputs it reads but never produces; acceptance proves
  an ancestor step produces each (else `ticket_gate_input_unavailable` naming
  the missing operation). Concretely: `ticket/gates-and-pr` and `ticket/ship`
  score `completeness` against the criterion→test mapping only
  `build/contract` publishes, so a plan holding either gate without that
  ancestor is rejected before provisioning, not after a paid builder turn.
- **Repairs are bounded and non-regressive.** A planner-authored structural
  failure gets at most one bounded repair whose violation set must be a strict
  subset of the rejected proposal's; a regression reports
  `plan_repair_regressive` naming the new violations ahead of (never instead
  of) the original diagnostics. The proposal and repair stay separate terminal
  execution steps and settlements, but preview and live admission reserve one
  effective EpisodePlanner slot for route-turn accounting.
- **Invalid `execution_ready` scope fails closed** before provider
  construction rather than silently changing routes.

The accepted plan is persisted atomically before delivery; only then does
`episode-route.ts` derive the compatibility route and exact authorized
provider steps. Before every provider turn the preflight, reservation,
context-manifest, execution-step, and exactly-once ledger checks remain
mandatory. Ready steps execute in stable dependency order.

A failed assumption, new scope, unavailable assignment, failed gate, approval
constraint, or exhausted estimate may request a **bounded revision**.
Revision publication and execution share the episode lock; only future work
changes — completed steps, artifacts, approvals, route evidence, and
settlements stay linked to the plan version that authorized them. Adapter
unavailability never triggers silent tuple substitution. An accepted revision
continues immediately under its new authority (gates, approvals, and
never-attempted downstream steps run in the same invocation); the one step
held back is the exact step whose failure authorized the revision — unless
its durable evidence already settles it. The ticket adapter recognizes two
such settlements (one rule, `reconcilablePriorEvidence`; both require the
revision preserve the exact content-hashed step and the replan journal link
it to the new version):

- **build** — a prior *blocked* transport whose retained typed build verdict
  says `done` (the transport terminal was pessimistic).
- **review** — a prior *completed* transport whose retained review verdict
  carried findings; those findings authorized the revision and its `fix` step
  answers them. Re-entering would re-review an unchanged commit — and
  withholding the settlement left the revision with no ready step at all
  (#202; the build half alone was #175).

Either settlement resumes without another provider turn and re-performs no
side effect the prior version already performed (no second review comment or
GitHub review). Rejected revisions are terminal for that invocation with
their durable refusal reason shown by `loop`/`status`/`episode --explain`.

### Review dimensions — security always-on, the rest risk-selected

Functionality review (the `verify` pass) runs on every PR. Other dimensions —
security, performance/scale, future lenses — are conditional plan
requirements validated against the same structured facts that floor
mechanical gates: changed-file globs, repository/change facts, explicit
safety facts from app policy. EpisodePlanner proposes the smallest workflow
above those floors; validation rejects a plan that omits required
independent/security/performance evidence.

Published ticket labels translate only by exact structured mappings:
`domain:auth|security|secret|privacy|payment` → ticket security floor;
`domain:data` → data-integrity floor; `op:perf-sensitive` and `op:incident` →
their typed floors. Title/body keyword matches never create or remove safety
authority.

Security runs at two depths: (1) every PR — the mechanical secret scan (§5)
plus a security lens in the standard `verify` template; (2) on trigger — a
dedicated security provider step when structured facts identify
authentication, secrets, sensitive ingress/parsing, or another policy-declared
surface. Performance/scale review triggers by glob (hot paths, queries,
migrations, caching) or `op:perf-sensitive`. Diff-scoped triggers can't see
emergent whole-system issues, so **standing sweeps** (scheduled whole-repo
role turns via ordinary roles.yaml triggers) complete the picture; their
findings enter as plain issues through Planner intake.

### Pass protocol requirements (what each template must encode)

- **contract** — read ticket + referenced code; emit contract (files to touch,
  approach in 1–3 sentences, test strategy, risks, complexity
  low|medium|high) as a structured issue comment; write no code.
- **implement** — read before write; baseline test run before changes (red →
  stop); minimal diff; plan-adherence self-check (every criterion addressed,
  only in-scope files touched — revert strays); full suite exit 0, "NOT
  optional and NOT limited to task-specific tests"; atomic commits
  `#<issue>: description`; 3 mechanical fix attempts in-pass, design failures
  escalate immediately as a blocked entry (verbatim error / attempted fix /
  result / assessment) — never thrash.
- **verify** — check each criterion against code + test results; findings in
  the structured grammar (§6); for UI apps with a verification strategy, walk
  user journeys end-to-end (passing criteria but breaking a journey is still
  FAIL); never modify source.
- **fix** — resolve or explicitly rebut every finding; implement's discipline.
- **decomposer** — atomic/testable/scoped/ordered/independent tickets; binary
  criteria; `Depends-on: #N` edges; execution-group annotation (§8);
  test-infrastructure tickets first; cross-milestone integration tickets last.

### Derived labels and deterministic safety floors

Two compatibility labels remain; neither authors the workflow:

- **Episode route** (`quick|standard|deep`) — derived from accepted plan
  complexity and typed safety facts; supports reporting, historical readers,
  hard-ceiling selection, and an explainable safety floor.
- **Changed-file risk tier** (`.cormidia/policy.yaml`) — selects deterministic
  mechanical gate strength. A small plan touching a sensitive surface still
  receives the required gates; economy never weakens safety.

Typed safety facts are gathered before EpisodePlanner from the trigger,
declared creator constraints, repository/change facts, app policy, and
explicit evidence references. Deterministic validation can add a visible
mandatory gate/approval floor or reject the plan; it cannot quietly
manufacture a generic provider team. Prose keyword matching is never the sole
safety control. The legacy `planning-depth/v2` / `route-policy/v1` records
remain readable for historical artifacts but have no authority to bypass
EpisodePlanner or alter an accepted plan.

### Issue intake — Planner or human triage precedes execution

**Invariant: only governed product planning (or the human) applies
`op:ready`.** All intake — human-filed issues, Support digests, SRE incident
notes, `op:returned` bounces — waits as plain issues until a product-planning
workflow or human explicitly triages it. The loop never builds an untriaged
issue. A ready existing ticket still runs EpisodePlanner unless its creator
supplied execution-ready scope with provenance.

Large source-corpus planning separates two authorities: decomposition intent
(exact count, inclusive/open range, or explicit complete-corpus scope) vs
publication admission (per-invocation cap of 3/5/7 for
bootstrap/growth/mature, further bounded by repository evidence). The full
decomposition and content-versioned source-section catalog persist before any
issue write; coverage moves through
`planned/published/in_progress/delivered/deferred/superseded/remaining`.
Identical reruns reuse the durable decomposition; `--resume` admits the next
batch; `--revise` is the explicit replacement path. Delivery requires
correlated merged-PR evidence — a merely closed issue is not "delivered".
Before any bounded batch mutates GitHub, the secret-egress gate scans every
active ticket including unselected later batches. Every invocation can
durably tighten the future publication cap, never auto-loosen it; an
already-prepared batch keeps its immutable admission cap and is recovered
first, with stored hash-only source evidence, before current source
resolution is considered. Remaining-only and revision turns receive a bounded
metadata ledger of preserved ticket identities; cross-episode dependency
edges are not supported.

Scheduled `groom` receives a bounded, hash-bearing snapshot of open GitHub
issues without an `op:ready` filter; Builder's claim query remains
`op:ready`-only. Missing `gh`, unavailable GitHub, an empty repository, and
an accidental ready-only Planner query are distinct typed outcomes before
provider construction. Planner emits one machine-readable readiness decision
with an explicit reason for every issue with no active `op:*` state; the
deterministic publisher may add `op:ready` only for a fully specified routine
ticket (deep/domain-risk, truncated, blocked, or validation-incomplete work
stays unready with a typed reason). GitHub is read back after a label write.
Scheduled publication is one durable #232 transaction binding the isolated
worktree's branch/commit, readiness decisions, complete-backlog RoadmapPlan,
and accepted validation/readiness authorities; crash, lost acknowledgement,
and duplicate resume replay it without rerunning Planner. For roadmap-backed
delivery, "validation-complete" means an immutable delivery-unit-readiness
authority binds the current RoadmapPlan/frontier, exact unit membership,
current validation-catalog and validation-contract ref+hash, and a current
automated routing snapshot; `planning:preplanned` and `op:ready` are
projections and cannot replace it. Batch admission and Builder claim reread
the current facts and refuse stale authority before provider construction.

**`routing:human-only`** is an orthogonal PR-routing decision, never a phase:
a human applies it when Cormidia would judge a change through the instrument
being changed. Planner returns the typed `autonomous_execution_excluded`
readiness reason; Builder independently re-reads the issue immediately before
claim and refuses with a distinct diagnostic even if `op:ready` is present; a
failed routing-label read also refuses — uncertainty cannot widen autonomous
authority. The label survives the complete lifecycle until a human removes
it. **`manual-review`** is a second hard exclusion with the same two-boundary,
whole-delivery-unit behavior but a distinct reason (human review hold). There
is deliberately no `manual-*` wildcard; the retired `manual-feelview` typo
(owner correction 2026-08-12, HB-112) survives only as the no-wildcard
negative control.

Steady-state intake pipelines: `triage` (classify bug/improvement/
duplicate-invalid, prioritize `p1..p3`), `groom` (consolidate backlog into
specs, decompose, re-prioritize, digest blocked/returned items). **Doc
reconciliation is a groom/triage duty**: contradicted specs get a doc-update
acceptance criterion on the fix ticket or a dedicated docs ticket. **Vision /
app-charter changes are proposal-only** — the Planner drafts, the human
ratifies; agents never silently rewrite the documents that define "good".

### Roles are referenced, never hardcoded

Passes name their role (`role: builder`); the loop executes whatever
roles.yaml defines. New seats are config additions, not loop changes.

## 5. Quality gates — deterministic, orchestrator-run

Distinct from the safety gate (critical-ops approval, every tool action,
in-session): quality gates run **between passes, as orchestrator subprocesses
against the worktree**.

| Gate             | Mechanics |
| ---------------- | --------- |
| setup            | run the app's `.cormidia/config.yaml` `setup_command` (top-level, never under `apps.<name>`). Runs **at worktree provision, before the first implement pass** (`advanceProvisionSetup`) — load-bearing because `createWorktree` provisions an empty tree and the builder's mandatory baseline check needs deps (L1-02) — and again **first within each post-implement gate set**, where a setup failure **short-circuits** the rest (`runSetupGate`). Unconfigured = absent, unless the tree carries an unresolved setup artifact: the gate scans package-manager config before and after the command (`src/loop/setup-artifacts.ts`) and fails with the named file/remedy for an unresolved tool placeholder or duplicated YAML key, rather than an opaque parse error attempts later. The subprocess runs under deny-by-default dependency builds (`PNPM_CONFIG_IGNORE_SCRIPTS=true`); a ticket needing a dependency build opts in explicitly in its `setup_command`. A provision-time failure returns the ticket loudly (blocked-with-evidence + `op:returned`) with no build turn spent |
| tests            | app's `test_command`, exit code 0, timeout; retain the last output lines on every executed result |
| lint             | `lint_command` |
| e2e              | `e2e_test_command` when configured |
| security         | regex scan of changed files against the canonical list in `src/runtime/secret-patterns.ts` (provider keys, AWS ids, Stripe/Slack/Google/npm tokens, webhook URLs, JWTs, URL userinfo credentials, PEM headers, generic key/token/password assignments incl. snake_case); binaries skipped |
| completeness     | criteria present and parseable; every criterion has a covering test in the contract mapping; no unresolved findings on the PR. Checkbox state is gate *output*, not input: the orchestrator renders all boxes checked at merge |
| review-freshness | branch HEAD == the APPROVE review's `commit_id` (GitHub-native); always runs regardless of tier |

`.cormidia/policy.yaml` (app repo, emitted by bootstrap) carries risk-tier
globs → gate sets, the review-dimension globs (§4), and
`remediation.max_attempts` (default 3). Defaults: high =
tests+lint+security+completeness; medium drops the security scan; low =
tests+completeness.

**Where gates run:**

0. **At worktree provision** — the Git-index preflight (touches only the
   resolved per-worktree `index.lock`; unwritable → specific diagnostic,
   checkout intact, no provider spend) and the `setup` gate, before the
   builder's baseline check can run.
1. **After implement/fix, before the PR advances** — never spend the org's
   most expensive seat on code that fails `pnpm test` mechanically. Gate
   failure → **remediate**: re-dispatch a fix pass with verbatim gate output
   in the brief, up to `max_attempts`, then blocked. A gate run failing with
   *exactly* the previous attempt's `remediation.failureIdentity` (hash over
   the failing gates' verbatim evidence, duration excluded) sets `noProgress`,
   clears `canRetry`, and escalates with the real cause instead of buying
   identical attempts (ISSUE-029). The bar is identical error *identity*: a
   failure with no evidence has no identity and never triggers it; any
   evidence change retries normally.
2. **At ship, twice** — once when the item reaches ship and once immediately
   before the squash-merge (the predecessor's double-run, kept exactly).
   Before either run, the P7 release check (docs/approvals/design.md A4): a
   ticket whose `Release-kind:` trailer declares deploy/package may not merge
   unless the app's `release:` block declares a matching mechanism (and, for
   `trigger: tag`, a `Release-version`), else it returns to the Planner —
   "deployable but unowned" is unfinished, mechanically. A merged
   deploy/package milestone queues a `production-deploy` critical op on the
   approval store; its command never runs without a human decision.

**Gate evidence is delivery evidence, not console noise.** Each executed gate
retains a byte- and line-bounded combined output tail, including on exit 0
(local capture: newest 256 KiB / 50 lines, truncation always explicitly
marked — absence from a bounded tail is never proof the output did not
occur). The first PR description receives a `cormidia:gate-evidence` managed
block (command, exit status, verbatim scrubbed output, exact evaluated
revision, content-addressed artifact id; 8,000-char per-gate render bound);
the run envelope keeps the scrubbed command and a 2,000-char tail, so a crash
never turns a green result into an unsupported claim. Before an app-owned
command starts, the runner binds evidence to the worktree's candidate HEAD
plus tracked decision-relevant bytes and re-compares after exit: zero-exit
plus a mutated candidate is a named `candidate-mutation` failure (ignored
dependency/cache residue is not); a missing required executable is a distinct
`required-tool-unavailable` environment failure, not an ordinary red gate.

An absent or stale managed block is repaired by editing only the PR
description from the already-captured green result — no gate rerun, failing
closed unless the evaluated revision, worktree HEAD, and PR head remain
identical. A `review/verify` finding is mechanically discharged only when
*every* finding identifies the PR body/description, says captured gate output
is absent, and asks only to attach it; anything else stays on the ordinary
provider-planned revision path.

The judgment layer sits *above* mechanical gates, never instead of them: the
reviewer's verdict and the high-risk ship-check pass evaluate what regexes
can't — but only after the mechanical layer is green.

### Acceptance criteria are the gates' contract — and a human-touched artifact

Badly specified criteria pass through perfect machinery, so criteria are a
first-class artifact with named owners: the Planner's decomposer emits
**binary, mechanically checkable** criteria ("works correctly" is a spec bug);
typed safety facts or policy can require **human sign-off** with the spec
before any `op:ready`; the Builder's contract pass maps **each criterion to
named tests**, and the completeness gate fails — not warns — on unparseable
criteria or uncovered criteria. The gate distinguishes an **absent** mapping
(a planning defect — plan acceptance now rejects it outright) from a
criterion uncovered **within** an existing mapping (a build defect). Criteria
are never summarized out of briefs (§3) and never edited by the Builder; a
wrong criterion bounces the ticket to the Planner. Checkbox state is written
once, by the orchestrator, at merge.

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

- Where the adapter supports native structured output, the pass requests it;
  otherwise the pass prompt specifies the predecessor's line grammar
  (`- category/severity file:line -- description -> action`) and the parser
  keeps the predecessor's hard-won leniency — three status formats, unicode
  or ASCII delimiters. Wired end to end: `recordPassVerdict` parses the pass
  output and on failure issues exactly **one session-resuming reformat turn**
  against the just-finished session (`parseWithRetry`). Success emits
  `verdict.recorded` (§9); a still-unparseable verdict finalizes the pass as
  an **infra failure** (`error_verdict_unparseable`) — a distinct population
  from a merit outcome, never a silent pass. The reformat turn is a real
  `runTurn`; its spend folds into the pass's usage rollup.
- **No side effect keys off prose.** Merge requires: GitHub APPROVE review
  present ∧ freshness ∧ mechanical gates green. The reviewer emits only the
  typed verdict (non-empty rationale, claim/evidence pairs, `notReviewed`
  scope); after the provider turn terminates, the orchestrator
  deterministically renders and publishes it as the real GitHub review. The
  delivery marker binds execution id, provider run, verdict content, and
  exact reviewed commit; recovery re-lists GitHub and accepts exactly one
  matching remote effect, so a crash cannot duplicate publication and a
  concurrent push fails closed. The reviewer never invokes `gh` or retries
  delivery.
- **Independent approval.** `latestActionableReview` →
  `isIndependentApproval` rejects an APPROVE authored by the builder/PR
  identity and, when a reviewer allowlist is configured, requires the
  approver be in it. Single-account pilot caveat (M6): GitHub rejects
  approving your own PR, so `GhCliOps` falls back — only for that exact
  error — to a COMMENTED review carrying the
  `<!-- cormidia:self-approval-fallback sig=… -->` marker: an HMAC over the
  PR number **and the reviewed commit** (`headRefOid`), signed with an
  orchestrator-only secret (default: race-safely created at
  `<stateHome>/state/self-approval-secret`; `CORMIDIA_SELF_APPROVAL_SECRET`
  is the compatibility override). Binding the commit defeats replay (A-001):
  a copied marker on a new push no longer verifies because GitHub stamps the
  review's `commit_id` to the new head. The loop upgrades a COMMENTED review
  to an approval only when the HMAC verifies for that reviewed commit
  (`timingSafeEqual`), the review clears the same author-independence gate,
  the body is a structured `Verdict: approve`, and commit freshness holds. A
  corrupt/linked/weakly-permissioned key, missing key, or unresolved reviewed
  commit fails closed — a bare marker is never trusted, and the secret stays
  orchestrator-only (threading it into the agent's environment would re-open
  the forgery).

## 7. The ticket state machine

The loop is a **distributed state machine advanced by dispatcher ticks**
(architecture.md §2), not a long-lived process. Every state derives from
durable artifacts; any tick on any day can advance any item. `cormidia loop
--app <app> [--follow]` drives ticks manually.

Each public phase-transition function validates its entry phase before any
GitHub, filesystem, journal, runtime, or settlement mutation; an illegal or
replayed transition fails with `LoopPhaseTransitionError`
(`error_illegal_loop_phase_transition`), making the diagram an enforced
protocol:

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
review cycles ≤ `DEFAULT_MAX_REVIEW_CYCLES` (3) — the `(cycles + 1) >
maxCycles` cycle routes to `op:returned` with findings for the Planner; 3
mechanical attempts inside a pass; per-pass turn cap; per-turn budget.

**REVIEWING is fully bounded** (`advanceReviewing`/`stalledReviewing`): every
non-progressing tick — no actionable review, a `CHANGES_REQUESTED`, **or an
APPROVE whose `commit_id` no longer matches branch HEAD** — counts a cycle
and, past the cap, routes to `op:returned`. A stale approval is never merged
and never spins. The ship-check bounce counts against the same cap so
`building`↔`shipping` cannot loop unbounded.

**Blocked protocol:** every dead-end *inside the build loop* — gate
exhaustion, a `blocked` build verdict, cycle-cap — swaps to `op:returned`
with a structured comment (error verbatim, attempted fix, result, assessment)
the Planner's groom consumes. `op:blocked` is reserved for the
**safety/approval escalation path**; the build loop never writes it.
Blocked-with-evidence, never silent retry-forever.

Standing-role Planner feeds are a bounded lifecycle input, not replayable
prompt history: deterministic producer/source/payload identity; groom renders
a byte-bounded pending batch; a completed pass records a content-bound
consumption manifest then commits an idempotent receipt; unconsumed records
defer to a later batch rather than being discarded.

A **legitimately-fired cap during review or ship-check** (route/provider
budget cap, wall-clock/adapter timeout) terminalizes cleanly (L-005):
`op:in-review → op:returned` with a budget/limit-exhaustion evidence comment,
open PR untouched. The distinction is `journalStopKind`:
`cap_stop`/`provider_timeout` terminalizes; a genuine internal error
(`crash`) still throws loudly.

Completion detection is **state-based, never string-based**: labels,
PR/review state, gate results — GitHub as the state store.

### 7.1 Continuation from durable artifacts (proportionality Stage 2)

A re-claim is **not** a blank slate: before claiming, the driver rehydrates
ticket-lifetime state from prior turns' artifacts (`src/loop/rehydrate.ts`).
`efficiency/episodes/<episode>/plan-current.json` and
`plan-execution-journal.json` select the persisted plan version and next
ready step; a legacy ticket-delivery step may consult
`execution-journal.json` for its finer contract/implementation/push/gates/PR/
findings/approvals/merge/release boundaries. Accepted boundary fingerprints
are reused; ticket, commit, or reopened-finding drift records why future work
was invalidated; no still-valid productive prefix repeats. `cormidia loop
--resume-episode <episode>` is a read-only preview of that decision.

Every still-valid decision and accepted artifact survives cancellation,
timeout, approval wait, cap, retry, and process restart. A productive pass
repeats only after a durable invalidation record names the artifact, the new
evidence, and the executable next step. Approval waits add one narrower
boundary: a `blocked_on_gate` result persists the exact pipeline/pass, native
session, completed passes, context-manifest and worktree fingerprints, run
id, settled pause cost, and human decisions; `cormidia approvals review`
records the decision before repairing `op:blocked → op:ready`; the next claim
reuses the original claim number and resumes only that pass, with any
role/runtime/route/context/worktree near-miss failing before runtime
construction.

- **Contract reuse.** The contract comment carries an HTML marker binding it
  to a sha-256 of the ticket body: unchanged body → contract reused verbatim
  (contract pass excluded via `PassSelection.excludePasses`); a body edit
  invalidates it. The latest contract comment wins.
- **Findings ledger.** Findings live across turns: `## Structured review
  verdict` comments raise them; the fix pass's machine-readable resolution
  lines (`- fixed <location> -- <evidence>` / `- rebutted <location> --
  <reason>`, posted as `## Fix resolutions`) close them; a later round
  re-raising a location reopens it. A finding a later round silently drops
  **stays open** — silence never closes a finding. Open findings feed every
  fix and review brief.
- **PR-aware phase entry.** The open PR is consulted before pipeline
  selection: open PR + open findings → fix pipeline (rehydrated `cycles` =
  rounds already spent, so the cap holds across claims); open PR + no open
  findings → fast-forward to gates → review, never a rebuild. A pruned
  worktree with a surviving branch is recreated *from the branch*.
- **Recoverable claim saga and cap.** `<stateHome>/tickets/<app>/<issue>.json`
  records a provisional claim before the GitHub label transition and commits
  the count only immediately before the first provider turn. The next tick
  auto-rearms an orphaned pre-provider claim without consuming allowance; an
  orphaned post-provider claim returns fail-closed for explicit review. At
  the cap (default 3, `LoopDriverOptions.maxClaims`) the driver parks the
  ticket `op:returned` with an evidence digest and an exact `cormidia loop
  rearm …` transaction (preview by default; execution binds app, ticket,
  reason, actor, old/new allowance, and prior label in a replay-safe
  prepared/completed record). Rearm applies only while the episode route is
  open: a terminal route is immutable — the command refuses and directs the
  operator to a new ticket. A live tick also repairs a stale or malicious
  terminal+`op:ready` projection back to `op:returned` before claiming. A
  label-only `op:ready` edit cannot change the durable cap; the
  `CLAIM RECOVERY` block in `cormidia status` explains the stopped boundary.
  (The live campaign's human performed all twenty re-arms by hand; this is
  the stop that was missing.)

## 8. Parallelism — tickets, not tasks

The predecessor removed worktree parallelism *within* a scope
(merge-conflict pain). The idea returns one level up, where git actually
isolates:

- The decomposer emits `Depends-on:` edges and an execution-groups annotation.
- The dispatcher treats a ticket as ready only when its dependencies are
  **merged**; independent tickets run in parallel worktrees on separate
  branches, bounded by `org.max_concurrent_turns`.
- **Re-arm is orchestrator-owned, not prompt-advisory (L-007).**
  `publishTickets` creates a dependency-locked ticket **stateless** (no
  `op:ready`), so `selectReadyTickets` never claims it. When a predecessor
  merges, `rearmDependents` (called from the driver's merge path) promotes
  every now-unblocked stateless dependent to `op:ready` with an evidence
  comment — no manual label edit, no reliance on the Planner groom pass (the
  live campaign confirmed it unenforced: 10/17 tickets never claimed). A
  dependent with any op-state label already has an owner and is untouched.
- **Every claim cuts from a freshly resolved base (#203).** `runLoopOnce`
  calls the caller-supplied `refreshBase` immediately before each claim (for
  a managed clone, `ensureClone`'s idempotent fetch/checkout/reset, which
  re-resolves the remote default branch). The claim line names the base
  (`#6: base origin/trunk @ 4503968`) so staleness is stated, not inferable.
  An operator-supplied `--repo-dir` checkout passes no refresher: its base is
  an immutable commit by design.
- **Scope-overlap conservatism:** tickets whose declared file scopes
  intersect never run concurrently — "when in doubt, use sequential."
- Within a phase, parallel pass groups remain available; within a pass,
  delegation is the harness's business.

## 9. Observability — three layers

Pattern source: the operator's observability methodology doc (app #1's repo,
2026-07-04) — **copy the patterns, not the monolith**. Three layers with
different consumers and retention; the OTel exporter is a later thin adapter
over Layer 2.

```
~/.cormidia/<org>/runs/<app>/<runId>/
  envelope.json     L1 — one per pass: ids, status, timings, token/cost
                    rollups, gate results, redacted durable verdict material,
                    tool counts, truncated previews, runtime/model/effort,
                    workdir, branch, git HEAD at pass start (git_head — the
                    learning loop's replay seed); REFERENCES to L3 evidence
                    and native provider session identity, never full prompts
                    inlined
  events.jsonl      L2 — append-only structured events, timestamped
  brief.md          L3 — exact assembled brief
  prompt.md         L3 — exact Runtime.runTurn input
  output.md         L3 — final output text
  session.log       L3 — structured activity log fed by TurnHooks.onEvent;
                    explicitly NOT a full transcript
  published-tickets.json  (final planning pass only) — orchestrator-owned
                    publication evidence written AFTER finalize (#128); a
                    sibling file by design — terminal envelopes are never
                    patched
```

`runId = YYYYMMDD-HHMMSS-<pipeline>-<pass>`, chronologically sortable.

- **Correlation ids on every L2 event:** `trace_id` = turnId (one per
  pipeline execution), `span_id` per pass, `parent_span_id` linking subagent
  events. Adapter `TurnEvent{type:"subagent"}` streams are buffered and
  flushed to L2 in order as nested spans (`flushBridgedEvents`), so fan-out
  trees are reconstructable (`reconstructSpanTree`) without opening
  transcripts. Full-transcript availability is explicit in
  `envelope.session`; runtimes exposing only a session id say so. Plus `app`,
  `ticket`, `pipeline`, `pass`, `role`, `model` on everything.
- **L2 event taxonomy:** `run.started/completed`,
  `pass.started/heartbeat/completed/failed`, `gate.started/passed/failed`,
  `tool.called` (name, duration, success — never full args),
  `subagent.started/completed`, `ticket.transition`, `verdict.recorded`,
  `escalation.raised`, `telemetry.settle_skipped`. Every line timestamped,
  severity field, machine `error_code`. The executor stamps a 30-second
  heartbeat onto the envelope (`last_seen_at`) and emits `pass.heartbeat`; a
  separate 30-second adapter-start deadline aborts an
  initialization/auth/transport stall as
  `failed(error_adapter_start_timeout)`; a per-pass wall-clock watchdog
  cancels the owned provider tree and finalizes
  `interrupted` with `interrupted_reason: time_limit` and error code
  `error_wall_clock_exceeded`, with an unavailable-usage ledger
  row; SIGINT/SIGTERM finalizes `cancelled(error_cancelled)`. The effective
  watchdog is always the smaller of the configured ceiling (default 60 min)
  and the episode's remaining active-time allowance. Adapters checkpoint
  cumulative usage and native session identity during execution, so an
  interrupted pass retains partial spend. Adapter failure codes flow into
  `pass.failed` and the envelope; failed gates retain the exact command and a
  bounded, scrubbed output tail. **Tool telemetry is live** (#27): all three
  adapters emit `TurnEvent{type:"tool_use"}` through the shared builder
  (`src/runtime/tool-events.ts`) → `tool.called` events and
  `envelope.tool_counts`; Claude and pi emit pre-execution (no outcome
  fields, `success: true`/`durationMs: 0` defaults), Codex post-execution
  with real exit codes.
- **Hard-turn admission.** Every provider pass carries one synchronous
  admission object recording effective provider-turn, equivalent-cost,
  tool-call, active-time, and model-turn bounds before execution; it wraps
  ahead of the unchanged safety gate (action 41 is refused before execution
  when the cap is 40) and stops provider continuation when cumulative usage
  reaches the authorized cost. Adapters without a native strict monetary cap
  declare that limitation and conservatively reserve their full authorized
  exposure.
- **Two rings decide what happens after a budget stop** (epic #236, ratified
  2026-08-03). Enforcement is identical either way; the ring is DERIVED from
  the episode ledger, never declared (`per_turn` only when the effective
  bound is strictly tighter than what the episode still allows):
  - `episode` (hard) — terminal `failed(error_turn_budget_exhausted)`,
    retaining partial usage/settlement, naming the prevented action and cost
    basis. No escalation is offered; without this ring, suspend → grant →
    suspend has no bound.
  - `per_turn` (soft) — the episode can still afford a turn. The pass returns
    `blocked_on_gate(error_turn_budget_suspended)` (#236 ratified one pause
    mechanism, two triggers); partial usage, the terminal reason, and the
    native session handle survive. The ticket parks `op:blocked` with a
    durable continuation; one `turn-budget-exceeded` item enters the
    approvals queue with a resume-cost estimate; no claim is consumed.

  Both stop records carry `ring` and `episode_remaining` on
  `envelope.budget_stop`. Budget admission never escalates through the SAFETY
  gate (`escalate: false`) — the soft ring reaches the queue as an
  orchestrator-raised item after the turn is parked.
- **A parked provider step stays open in the plan journal.** `step_suspended`
  parks the journal at `waiting_approval` (like `approval_pending`) so a
  later invocation re-enters the same step under a new attempt carrying the
  parked session — deliberately not a sticky `step_failed`. A
  budget-suspended execution record is a terminal EXECUTION record (budget
  counters count it) but not STEP evidence (`settledProviderSteps` excludes
  it).
- **A pause is not a terminal episode.** The driver skips `onEpisodeTerminal`
  for a ticket `blocked` with a live continuation — finalizing would write a
  terminal route record and the claim path would bounce the ticket the moment
  the human approved it, discarding the paid session.
- **Every verdict states what the turn asked for and did not get** (#244):
  denied/expired critical operations are recorded against the ticket (rule,
  action identity, disposition) and rendered into the review body,
  unconditionally — a turn that suppressed nothing renders `- None
  recorded.`, because a missing heading is indistinguishable from an older
  verdict that never checked.
- **Infra and merit never conflate.** A pass that *errors* is `failed` with
  an `error_code`; a pass that *concludes* findings/blocked is a merit
  outcome (a parsed `status: blocked` build verdict finalizes `blocked` even
  though the transport returned normally). `verdict_summary` JSON stays
  complete and parseable after redaction. Dashboards, retro, and scorecards
  read the two as different populations.
- **Dashboards read L1+L2 only.** `cormidia status`/`analyze` never parse
  transcripts; previews truncated (~120 chars), args hashed. Status shows a
  bounded `TERMINAL ATTENTION` line for failed/blocked/cancelled/timed-out
  rows from the persisted terminal diagnostic.
- **Redaction is a precondition for export**, applied to L1/L2 always: no
  full prompts, no tool args, no secrets (the quality-gate secret regexes
  double as the log scrubber). L3 stays local; retention =
  `session_retention_days`, enforced by the dispatch tick's daily org-wide
  sweep (docs/scheduler/design.md → State retention); `cormidia prune-runs`
  is the manual surface.
- **Attribution is exact** — runs are ticket-scoped by construction; costs
  roll up run → ticket → (role, app) → monthly budget. The pass executor
  settles **every** provider turn into the org telemetry ledger
  (`telemetry/<day>.jsonl`, the source `cormidia budget` sums) exactly once,
  keyed `(app, providerTurnId)` with legacy `(app, runId)` fallback —
  completed, blocked, and failed alike, dispatcher and manual driver both. A
  tick whose app has exhausted its monthly cap refuses to claim before any
  pass starts. Ledger rows carry
  `usageQuality: complete|partial|estimated|unavailable`; dashboards label
  lower bounds instead of presenting unknown spend as free.
  - **Exactly-once is indexed, not rescanned (F-002).** `recordTurnOnce`
    answers idempotency from a keys-only sidecar
    (`telemetry-index/settled.keys`, kept outside the ledger dir so bare
    enumerators never double-count), appended **ledger-first** under the same
    cross-process settlement lock — an index hit always implies a ledger row,
    and neither re-settle path re-presents a settled key. The full ledger
    scan survives only as the rebuild path. Budget accounting still sums the
    `<day>.jsonl` rows, never the index.
  - **A settlement failure never discards a paid turn (L-005).** The durable
    execution step is written *before* settlement; a settlement throw records
    `telemetry.settle_failed` and leaves the completed turn intact. `cormidia
    budget --reconcile` back-fills idempotently.
- **Cache visibility.** Input tokens come in three price classes (uncached
  ~1×, cache-write 1.25–2×, cache-read ~0.1×); L1 rollups and telemetry carry
  the split (`TurnUsage`, §10) and cost uses three-bucket pricing — a flat
  rate would misprice a healthy cached pass ~5–10× and fire the per-turn
  abort wrongly.
- **Anomaly flags** (`cormidia analyze`, from L1/L2,
  `src/runtime/runlog/anomalies.ts`), all live: `low_tokens_high_time`,
  `single_turn_long_run`, `bash_heavy` (≥20 calls), `environment_retry`
  (≥3), `cold_cache` (zero cache reads where the same-pipeline predecessor
  ran within TTL — a silent prefix invalidator in context assembly). Stale
  `running` envelopes fire `stale_running`/`missing_finalization` after three
  minutes without a heartbeat. Flags map to canned recommendations and feed
  the weekly retro.

`cormidia telemetry --html <report>` writes a static report plus an adjacent
`<report>.evidence/` copy bundle (links target copies, so browser file-origin
rules never require serving the state home); its completion-integrity section
compares observed passes with the trace's selected-pass manifest and marks
unrecorded evidence as unknown. The broader operator session is explicit:
`cormidia task begin` stores `tasks/<taskId>/task.json` + the outer prompt;
`CORMIDIA_PARENT_TASK_ID` stamps child envelopes and ledger rows; `task
fallback` is durable evidence work left Cormidia; `task finish` records
terminal status and external refs. Telemetry requires every declared stage,
completed trace manifests, no fallback, and a terminal parent task before it
says "Cormidia end-to-end complete."

## 10. Module map & contract deltas

```
src/loop/
  episode-plan.ts   versioned intent/scope/plan contracts, pure validator,
                    atomic persistence, forward-only revision rules
  episode-plan-executor.ts deterministic plan-DAG readiness, journal, resume
  episode-route.ts  one-way accepted-plan → route/authorization projection
  episode-replan.ts typed material events and bounded revision requests
  planner-admission.ts planner boot-turn reservation/settlement/repair bounds
  loop.ts          ticket state machine (§7): phases, label swaps, bounded
                   review/gate/ship cycles, squash-merge
  driver.ts        manual tick driver (dispatch calls the same phases)
  pipeline.ts      provider-step/static-compatibility transport, exact atomic
                   assignments, runlog + ledger settlement per invocation
  pipelines.ts     pipelines.yaml schema/loader — typed, validated config
  brief.ts         brief assembler (§3), state-budgeted
  qgates.ts        quality-gate engine (§5) — pure subprocess + git
  qgate-process.ts bounded process-group runner + candidate mutation binding
  verdicts.ts      typed verdicts + lenient parsers (§6)
  github.ts        provider-blind GitHub ops (`gh` wrapper): labels, PRs,
                   reviews, verified self-approval fallback, squash-merge
  loop-runlog.ts   per-step run records for between-pass work
  rehydrate.ts     continuation from durable artifacts (§7.1)
  scheduling.ts    ticket-level scheduling (§8)
  policy.ts        .cormidia/policy.yaml loader: risk tiers → gate sets
  preflight.ts     token-free admission before any model turn
  route-policy.ts  legacy static-route compatibility reader; not plan authority
  execution-journal.ts durable route-to-release boundary and invalidation log
  context-manifest.ts component budgets, hashes, deltas, dedupe and explain
  plan-tickets.ts  schema-validated, orchestrator-published planning tickets
  runRole.ts       low-level one-pass transport retained for dry-run/tests
  types.ts         LoopItem/LoopPhase and shared loop types
prompts/           pass templates (org home, human-ratified)
pipelines.yaml     pipeline → passes config (org home, human-ratified)
```

Import direction holds: `src/org` (dispatcher) → `src/loop` → `src/runtime`.
`src/org/episode-planner/` owns bounded intent/policy/runtime orchestration
and calls these provider-neutral contracts. The contract deltas this design
flagged all landed: `protocol-self-edit` covers `pipelines.yaml`/`prompts/**`
(src/runtime/gate.ts); `TurnRequest.verdictSchema` and the `TurnUsage` cache
split live in src/runtime/types.ts; `LoopItem`/`LoopPhase` carry
tier/remediation/gate state; the conformance suite carries the large-payload
case.

## 11. Ratified decisions promoted to docs/PURPOSE.md

Decisions 1–8 ratified 2026-07-06; 9 on 2026-07-13; 10 on 2026-07-19 (10
supersedes conflicting static-workflow mechanics):

1. **The loop is protocol-driven at the substage level** — versioned prompts,
   typed gates, evidence contracts; static pass ordering is compatibility
   transport, not workflow authority.
2. **Quality gates are orchestrator code**, distinct from the safety gate;
   the judgment layer runs only above a green mechanical layer; no side
   effect keys off agent prose.
3. **Historical product-planning separation** — decision 10 adds universal
   execution episode planning before delivery, including existing tickets.
4. **Briefs are assembled, budgeted context packets**, logged verbatim per
   run.
5. **Ticket-level parallelism only**, dependency- and scope-aware.
6. **Orchestrator failures are loud** — no silent best-effort side effects.
7. **Review dimensions are risk-selected passes; security is always-on** (§4).
8. **Acceptance criteria are a ratified quality contract** — binary,
   human-signed-off when required, mapped to named tests, gate-enforced,
   never summarized or builder-edited (§5).
9. **The episode owns route and execution economy** (2026-07-13) — admission
   precedes runtime construction; each adapter invocation settles separately;
   valid artifacts survive interruption; review/safety evidence is never
   traded for a label.
10. **EpisodePlanner and atomic assignment** (2026-07-19) — every episode
    persists one validated plan before delivery; harness/model/effort is
    indivisible; revisions are forward-only; quick/standard/deep cannot
    select workflow.

## 12. Open questions

1. **polish pipeline** (design evaluator/refiner with `min_score`) — port
   later for UI-heavy apps, not v1. *(deferred)*
2. **Structured-output support in Codex/pi** — verify at adapter build time;
   the lenient-parser fallback is specified either way.
3. **Agent SDK cache knobs** — TTL control and breakpoint placement; the
   cache-stable assembly rules (architecture.md §5) hold regardless.

Historical: milestone planning's deep `plan` pipeline and the 60-minute
per-pass fallback were superseded as workflow-selection defaults by P0-06 and
decision 10; the implementation still honors per-pass `wall_clock_minutes`,
and the legacy fallback survives only as a non-normative kill ceiling.

## 13. Failure-mode catalog

The harnesses own in-session heavy lifting; everything around that is ours.
**Every failure path terminates in one of four outcomes — bounded retry,
blocked-with-evidence, escalated-to-human, or success. Never silent, never
unbounded.** Infra and merit carry distinct codes end to end (§9).

| #                           | Failure                                              | Detected by                                          | Bounded response                                                                                                                             |
| --------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Infrastructure**          |                                                      |                                                      |                                                                                                                                              |
| 1                           | Turn process dies mid-pass                           | PID/start/nonce liveness + stale lock heartbeat + journal `running` | terminate the owned process group; resume the exact session when valid, else preserve ambiguous worktree bytes and stop with inspection evidence; `attempt ≥ 3` → incident |
| 2a                          | Adapter initialize/auth/transport stalls before any provider event | adapter-start deadline (default 30 sec) | abort owned provider tree; finalize `failed(error_adapter_start_timeout)` with partial/unavailable usage                                     |
| 2b                          | SDK session hangs after starting                     | smaller of configured per-pass ceiling and episode remaining active-time allowance | kill; retain partial usage and resume from the next legal journal boundary                                                         |
| 3                           | Dispatcher dies mid-claim                            | provisional claim lease + next-tick reconciliation  | pre-provider: repair label, retain artifacts, consume no claim; post-provider: return with evidence and require exact durable re-arm          |
| 4                           | Host asleep / offline                                | nothing runs                                         | missed schedules collapse to one firing; distributed item state resumes on any later tick                                                    |
| 5                           | GitHub API down / rate-limited                       | API errors on tick                                   | loud L2 event; retry next tick (polling is idempotent); repeated → anomaly flag + incident note                                              |
| 6                           | Session resume or content binding fails              | adapter error or role/runtime/context/work fingerprint mismatch | fail closed before blind retry; preserve session/work evidence and require explicit re-arm or a newly authorized claim            |
| 7                           | Run-dir / session growth                             | retention job                                        | pruned on `session_retention_days`; L1/L2 kept longer than L3; the dispatch tick runs the daily org-wide sweep                               |
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
| 21                          | Approval queue neglected                             | item age                                             | ages shown in `cormidia approvals` and the Planner's daily digest; blocked items just wait — fail-closed                                       |

## 14. Turn lifecycle, worktrees, crash recovery (formerly `turns.md`)

The execution machinery around one role invocation — the journaled turn
lifecycle, org-managed clones and worktrees, crash recovery at artifact
boundaries, watchdogs, and idempotency.

### One role invocation

```
dispatch → journal(assembling) → unresolved actor-retry check (../approvals/design.md)
        → worktree acquire
        → context assembly (../architecture.md §5)
        → journal(running)    → adapter.runTurn(req, {gate, onEvent})
        → journal(collecting) → collect artifacts, escalations, usage
        → telemetry append · scorecard events · memory-write check
        → journal(done | blocked_on_gate | failed) → release lock
```

The journal `state/turns/<turnId>.json` is written synchronously at every
phase transition — the crash-recovery source of truth (`{turnId, role, app,
trigger, phase, attempt, session?, worktree?, worktreeBranch?, ticketRef?,
escalationIds?, pid?, processStartIdentity?, processNonce?, processGroupId?,
errorCode?, recovery?, startedAt, updatedAt}`). The productive path is
forward-only (`assembling → running → collecting → done`): replaying a phase
is idempotent, skipping a productive phase is refused, an error may
terminalize honestly from the phase it occurred in.

**Legacy role-invocation budget.** The adapter tracks running cost from SDK
usage events; crossing `max_turn_budget_usd` aborts gracefully →
`failed(error_max_budget_usd)` plus an incident note. Episode route admission
and remaining-budget enforcement (`docs/episodes/contract.md`) are the
canonical ceilings; this cap is a safety backstop, not a second route budget.
A standalone turn's recovery evidence names its isolated path/branch, reports
worktree dirtiness, and gives a read-only inspection command; Cormidia never
auto-stages or commits arbitrary provider output at this boundary.

### Worktrees

- Cormidia maintains its **own clone** per app at `repos/<app>` (fetch-only
  sync) and cuts worktrees under `worktrees/<app>/<branch>`; it never touches
  the human's personal checkouts — GitHub is the only sync point. Mutating
  git operations on the shared clone are serialized by a per-app clone lock
  (`withAppGitLock`, `src/org/turn-runner.ts`), a configuration of the shared
  `FileLock` primitive (`src/runtime/file-lock.ts`): the lock file carries a
  PID + process-start identity + nonce ownership token; release verifies the
  token before unlinking; a reused PID cannot impersonate the prior process.
  A proven-live holder is never force-broken; a dead or identity-mismatched
  holder is reclaimable; an inconclusive legacy record must also age past the
  stale window; a live holder past the max wait fails the waiter (typed busy,
  next tick retries).
- Loop items get branch `op/<issue>-<slug>` and keep the same worktree across
  build → review → fix; removed after merge/return. Explicit standalone
  `run-role` turns get a collision-resistant `op/turn-<slug>-<hash>` branch
  and durable worktree; reusing the same invocation identity rediscovers it
  without resetting uncommitted work.
- Standalone provider turns never run in `repos/<app>` itself: the managed
  clone stays on its resolved remote default and clean, while the isolated
  worktree may retain inspected WIP after a failed turn.

### Crash recovery: artifact boundary first

A stale lock or interrupted tick reopens the accepted plan pointer and
`plan-execution-journal.json` before choosing work. Authority order: `intent
→ plan version → derived route → ready step → terminal evidence`; within a
legacy ticket-delivery step, the finer boundaries remain `contract →
implementation → push → gates → pr → findings → approvals → merge → release`.
A boundary is reused only while its recorded artifact fingerprint is valid;
drift creates a typed material event and invalidates only future work.

**Ambiguous worktree bytes are preserved-and-inspected, never reset.** If an
interrupted running turn has an exact resumable session, recovery may resume
it against the same worktree; otherwise it records
`failed(error_ambiguous_worktree)`, leaves bytes and accepted artifacts
untouched, and gives a read-only inspection command. Recovery never stages or
commits arbitrary provider output. Repeating a productive pass requires a
durable invalidation reason. Claim, repair, review, retry, tool-call,
active-time, provider-turn, and cost bounds remain in force across restarts.

A role invocation exceeding its wall-clock cap is killed as an owned process
group — SIGTERM, bounded grace, SIGKILL; completion requires proof neither
leader nor descendants remain. Recovery is **deferred until the owned process
group is confirmed dead** (`killHungTurns`, `src/org/dispatch.ts`): a
surviving child holding the clone lock would let two workers mutate one
clone. Before the first signal, the lock and running journal must agree on
the complete PID + process-start + nonce token and the OS probe must confirm
that identity — a mismatch or unavailable probe is a typed deferral, never
permission to signal a possibly reused PID. Turn-lock acquire, adoption,
heartbeat, and release are serialized by a nonce-owned mutation guard, so a
holder finishing after reclamation cannot delete its successor.

Inside a pass, the executor also owns the 30-second adapter-start deadline
(§9). `cormidia doctor` uses separate bounded, non-billable
initialize/account/auth probes to catch missing binaries, transports,
credentials, and model configuration before live work.

### Idempotency rules

Why a dead turn never leaves the repo half-done:

1. **Durable progress is explicit.** Git/GitHub operations are the durable
   product effects (commit, push, PR create, label flip, review, comment,
   merge); episode contracts, findings, approvals, gate evidence, usage
   checkpoints, and terminal records are durable orchestration artifacts.
   Only unaccepted worktree/session scratch is disposable.
2. **Artifact before label.** State labels flip only *after* the artifact
   they announce exists (push branch → then `op:building`; open PR → then
   `op:in-review`). A restarted turn re-derives state from artifacts, never
   trusts the label alone, and skips already-done steps.
3. **Claims are label flips.** The Builder claims by atomically swapping
   `op:ready → op:building`; a dispatcher polling mid-claim sees a consistent
   state either way.
4. **Non-git writes are append-only and keyed by turnId** (telemetry JSONL,
   scorecard events, journal) — re-running collection dedupes on turnId.
   Whole-file operational state is written atomically via tmp-file-plus-
   `rename` (`writeFileAtomic`, `src/org/atomic.ts`), so a crash mid-write
   never leaves a torn file.

## 15. GitHub substrate conventions (formerly `github-conventions.md`)

States derive from artifacts, never from labels alone (§14 rule 2); the state
machine consuming them is §7.

### Labels

| Label              | Meaning                                      | Set by                                              |
| ------------------ | -------------------------------------------- | --------------------------------------------------- |
| `op:ready`         | ticket is buildable as specified             | Planner (or human)                                  |
| `op:building`      | claimed; branch/PR in progress               | Builder turn (claim = atomic `ready→building` swap) |
| `op:in-review`     | PR open, review cycle running                | loop, after PR exists                               |
| `op:returned`      | bounced to Planner (max cycles / infeasible) | loop                                                |
| `op:blocked`       | waiting on approval-queue decision           | loop, on `blocked_on_gate`                          |
| `op:incident`      | SRE incident note                            | SRE                                                 |
| `p1` / `p2` / `p3` | priority (dispatch order within events)      | Planner                                             |
| `routing:human-only` | excluded from autonomous readiness/claim   | Human, after the PR-level self-hosting routing call |
| `manual-review`      | human review hold; autonomous exclusion    | Human                                               |

Member closures come from the squash-merge's complete `Closes #N` set, never
a manual state. `routing:human-only` and `manual-review` are not state
labels: each survives every transition, blocks both Planner readiness and
Builder claim for the entire delivery unit, and only a human removes it (§4).
The match is exact — no `manual-*` wildcard.

### Ticket format (what the Planner emits)

Fixed headings, parseable by heading, human-first:

```markdown
Title: imperative, one concern (one ticket may be one complete delivery unit)

## Goal            — what exists after this ships, one paragraph
## Context         — why now; links to feedback/digests/prior art
## Acceptance criteria   — checklist; each item mechanically checkable
## Out of scope    — the temptation fence
## Notes for the builder (optional) — pointers, not prescriptions
```

### Branches, PRs, reviews

- Branch: `op/<issue>-<slug>` for a single-ticket delivery unit;
  `op/unit-<unit>-<membership-hash>` for a multi-ticket unit. One branch and
  worktree per complete delivery unit (§14).
- PR: exactly one per delivery unit; body carries `Closes #N` for every
  member; every member's state projection moves only after the shared
  artifact exists. Single-ticket title `<type>: <summary> (#<issue>)`;
  multi-ticket `build: <unit> (<count> tickets)` (v1 hardcodes the `build:`
  type — `prTitle` in `src/loop/loop.ts`). Body = What / Why, **Evidence**
  (pasted test output — TASTE §6), `Closes #<issue>`. Draft on first push;
  ready when the Builder declares done.
- Review: verdict as a real GitHub review (APPROVE / REQUEST_CHANGES) plus a
  structured findings comment — numbered findings, each resolved or
  explicitly rebutted before merge (TASTE §8). Findings ride to the fix turn
  as context. The single-account self-approval fallback and its
  HMAC-verified marker are §6.
- Merge: squash-merge only, performed by the loop after APPROVE; branch
  deleted; PR description survives as the commit body.

Human and coding-agent platform development of this repository uses the same
branch → pull request → checks → squash-merge shape, with repository merge
options exposing squash only. That does not place platform work inside this
ticket state machine; its lifecycle remains governed by `docs/DEVELOPMENT.md`.
