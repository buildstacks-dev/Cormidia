# PURPOSE — Cormidia

*v2.18 — 2026-08-12. Human-ratified decision log. Standing decisions below
are current law. Execution details belong in the GitHub issue tracker and
the subsystem design.md files. Product status and known limitations live in
README → Status.*

Cormidia is a governed **org runtime** that turns approved goals into verified
software outcomes with process proportional to risk, minimal human attention,
durable forward progress, and continuously improving unit economics.

One human should be able to direct a small portfolio of software products at
the quality bar of an excellent engineering organization without becoming its
scheduler, retry loop, state reconciler, or approval clerk.

Cormidia spends intelligence on judgment and deterministic computation on
mechanics. It selects the smallest safe workflow, preserves every valid unit
of forward progress, surfaces genuine decisions, learns from evidence, and
makes comparable work measurably cheaper and more reliable over time.

The operator supplies goals, ratifies organizational policy, and decides
material or irreversible actions. Cormidia owns routine coordination and reaches
one truthful terminal outcome: verified completion, a precise governed wait,
or an evidence-backed stop with an executable next step.

It provides a standing team of AI agents (Planner, Builder, Reviewer, SRE,
Support, Marketing, Distiller, Learning Reviewer), coordinated through private
GitHub repos as the source of truth, with a human approver gating critical
operations only.

**Cormidia is an installable package/runtime, not an app.** Its CLI is pointed
at org configuration and target repos; it never contains app code. One org
runtime, N applications. The standing team develops, operates, and markets
those applications. Work that is not a product still runs here as jobs, with a
weaker verification promise.

## The org chart

| Role | Responsibility |
| --- | --- |
| **Planner / PM agent** | Ideation, synthesizing input (including support feedback), prioritizing, writing tickets |
| **Builder agent** | Implements tickets — writes the actual code |
| **Reviewer agent** | Independent code review; deliberately a *separate* agent from the builder |
| **SRE agent** | Infrastructure, scaffolding, CI/CD, deploys; attends to operational issues |
| **Support agent** | Watches forums / tickets / feedback channels; consolidates feedback, responds to queries, feeds themes back to the Planner |
| **Marketing agent** | Positioning, changelogs, launch notes, content drafts; watches adoption signals and feeds them to the Planner |
| **Distiller agent** | Daily, deterministic-prechecked synthesis of captured evidence into governed candidates |
| **Learning Reviewer agent** | Weekly cross-provider review of candidates plus report-only compaction recommendations |
| **Human** | Approver for **critical ops only**; final authority |

System of record: private GitHub repos hold code, tickets/issues, PRs, decisions,
and agent definitions.

## Non-negotiables

1. **Deterministic by default.** If it can be code, it is code. Models only for
   judgment that cannot be captured deterministically.
2. **Intelligence is harness + model.** A provider turn is an atomic
   harness/model/effort assignment. Cormidia must use the harness's full evolving
   capability, not treat the model as a bare completion API. Role responsibility
   and execution assignment stay separate; changing an assignment is a config
   change that never broadens the role's authority.
3. **Protocol over prompt-and-pray.** Agents, gates, and assignments are
   versioned, enforceable, inspectable config and code — not freeform prompting.
4. **One runtime, many apps.** Each app is developed, operated, and marketed
   by the same standing team. App knowledge stays in the target repo and
   per-app memory; the runtime stays general and extensible by config unless
   evidence proves the core must change.
5. **Scarce human attention, durable truthful outcomes.** Humans gate critical
   ops only. Valid progress survives interruption. Cheap-wrong results, hidden
   retries, and human babysitting are not success.

## Standing

*Current law. Citations to this section as "Decided" mean Standing.*

How the pieces fit: a timer tick wakes the dispatcher, which turns due work —
normally a ticket — into one planned **episode**. To work a ticket the loop
**claims** it: takes ownership of it for one delivery attempt, with attempts
per ticket capped. An episode executes as role **turns**, each a single
harness/model/effort assignment working in one app's checkout. Mechanical
**gates** run between passes; a critical operation pauses the turn into the
human **approval queue**. Merged, verified work is the only outcome that
counts. The full loop is drawn at the top of the README.

Some bullets cite tracking IDs. `F-PT-*` are findings, registered in
`validation-design/harness-design-state.md`; `HB-*` are harness-backlog
tickets in `validation-design/harness-backlog.md`; L1–L5 are the validation
evidence layers defined in `validation-design/validation-policy.yaml` and
`docs/qualification/design.md`. Any ID resolves by grep from the repo root.

### How work executes

- **Every episode is planned before any work runs.** One schema-validated,
  executable EpisodePlan is persisted before delivery begins. Normally a
  dedicated EpisodePlanner turn designs the smallest sufficient role/turn
  graph. The planner turn is skipped only when the episode's creator — human
  or agent — already wrote a complete, execution-ready, provenance-bearing
  scope: bounded objective and exclusions, acceptance criteria and expected
  artifacts, the necessary provider/mechanical steps and dependencies
  (directly or through an unambiguous governed workflow template), known
  constraints and safety facts, and every assignment decision that cannot be
  resolved deterministically. The system verifies the scope itself — no
  label, tier, title, prompt length, lifecycle, or apparent simplicity can
  skip planning. Incomplete creator scope remains authoritative input; the
  EpisodePlanner completes the missing decisions.

  Turn assignment is atomic and mode-driven. App configuration exposes `fixed`
  and `adaptive` assignment modes; omission resolves to `fixed` and never
  disables planning. In fixed mode the EpisodePlanner chooses the workflow and
  each provider step receives its configured harness/model/effort tuple. In
  adaptive mode the EpisodePlanner — or an execution-ready creator — chooses
  each tuple from exact org-approved candidates narrowed by app policy. The
  EpisodePlanner's own boot assignment is explicit and fixed, never
  recursively selected. Deterministic policy validates the plan (capabilities,
  qualification, availability, budgets, approvals, safety floors, gates,
  release constraints, terminal coverage, independent review); it may reject
  or require a bounded revision but may not silently replace the plan with a
  static workflow. Accepted plans are persisted before their first delivery
  turn; revisions are versioned, bounded, and forward-only. Quick/standard/deep
  may remain as derived compatibility, reporting, or safety-floor projections,
  but no longer select the workflow or cap a turn's effort.

- **Protocol-driven loop.** The loop is a pipeline of small, versioned
  passes — never one opaque prompt — and nothing durable is ever triggered by
  parsing an agent's free-text output; side effects follow typed artifacts
  and mechanical gates. Planning is a Planner pipeline; Builder and Reviewer passes get
  assembled briefs; mechanical quality gates run between passes and twice at
  ship; orchestrator failures are loud. Ticket-level parallelism is
  dependency/scope-aware. Review dimensions are risk-selected, with security
  always-on. Acceptance criteria are a first-class quality contract: binary,
  mapped to named tests, never summarized away, and human-touched for
  deep/high-risk work.

- **A claim survives crashes and approval pauses; nothing retries blindly.**
  When a turn needs human approval it pauses: the claim, the native session,
  and all completed work are kept (pipeline/pass, completed-pass set, context
  and worktree fingerprints, run id, cost, and the exact decisions), and the
  decision — approve or deny — continues the *same* session as distinct
  guidance. An undecided approval expires (default 24 h) and the turn ends
  blocked, not failed. The claim number stays stable across any number of
  approval pauses. A claim is provisional until the first provider turn
  starts: a crash before that boundary auto-repairs the GitHub label and
  consumes no allowance. A crash after provider work is never retried
  automatically — recovery is the explicit, content-bound
  `cormidia loop rearm` transaction. Resume fails closed if role, runtime,
  context, or the work itself changed. None of this broadens approval authority, and an
  approval decision is still not an execution acknowledgement.

- **One turn, one app.** Each app is a hard boundary. A role turn works in
  exactly one app's checkout and sees only that app's memory; only the
  scheduler and the human surfaces ever see more than one app at once. Memory
  splits per role (craft knowledge, cross-app) vs per role+app (domain
  knowledge); context assembly loads the role bundle plus the *current* app's
  bundle only. Scorecards are per (role, app). Multi-app is designed in but
  operated sequentially: the org runs **one live app** until the scorecards
  and the human's own load say otherwise — one app-tagged approval queue,
  per-app cadence in config, org-level WIP limits. Co-planning is the
  irreducibly per-app human cost, and why onboarding is sequential.

- **Dispatcher, approvals, and idempotency.** The autonomous host is a
  stateless `cormidia dispatch` tick that spawns detached turns; turns operate
  in org-managed clones/worktrees under `~/.cormidia/`. Durable side effects are
  git/GitHub artifacts only; labels move after the artifacts they announce;
  merges are loop-owned squash merges after approval/review/gates.

- **Resolved operating defaults.** Org WIP defaults to `max_concurrent_turns:
  2`; approval grants expire after 24 h; dispatch ticks every 5 minutes; loop
  review/fix cycles cap at 3. Support and Marketing are disabled per app until
  that app has real feedback or adoption channels. Route depth and time budgets
  come from `docs/episodes/contract.md`. High-tier tickets stay autonomous after
  the Builder's contract pass in v1.

- **Future opt-ins.** A Lab role is approved as a future opt-in live-environment
  verifier when a pipeline needs evidence artifacts from real execution.
  Competitive intelligence stays a Marketing pipeline (`ci-sweep`) unless
  scorecards later justify a standalone role.

### Human approvals

- **Approval boundary — critical ops only.** Agents work autonomously, including
  merging reviewed work to main. Human gate on: production deploys; destructive
  or irreversible ops (data deletion, DNS/domain, external publishing); spend
  above a threshold; security-sensitive changes (auth, secrets handling); and
  **changes to the org's own protocols**. The human may widen a grant at
  decision time to rule+path scope for a ticket or app (TTL, use-count cap,
  revocation, per-use audit); the single-use action hash stays the default.
  Self-merge, production deploy, protocol-surface writes, and outside-worktree
  actions are never scopeable. Same-rule batch review is allowed with unchanged
  per-item audit rows. Every app declares a `release:` mechanism and owner; a
  deployable milestone with no declared mechanism fails the ship gate. Denial
  reasons persist as curated role memory. Gate escalations land in a CLI
  approval queue the human reviews **one by one** — approve, or deny with
  reason — and every decision persists as an audit trail; any future
  push/email channel is a pointer into this same queue, never a second
  approval path. Full design: `docs/approvals/design.md`.

- **Approval decisions and delivery acknowledgements are separate durable
  facts.** Classification is action-aware: executable or typed operation,
  targets, redirections, environment, destination, and effect are evaluated
  before agent-authored prose; search patterns, comments, messages, and heredoc
  bodies are data, while executable substitutions and obfuscated real actions
  remain gated. A human approval persists the exact content-bound action in
  `approved`; it never claims the effect happened. A later dispatch may execute
  only an orchestrator-owned typed allowlist (currently GitHub issue
  create/comment, plus the existing specialized release handoff), recording
  `executing → executed|failed|ambiguous`. Idempotency markers reconcile a crash
  after a remote effect; ambiguity is never retried blindly. External
  publication is never broadly scopeable. Critical SRE health events file
  exactly one source-linked `op:incident` issue; analysis and filing remain
  distinct completion claims.

- **Approval contract.** (1) A gate denial suspends the turn — the approval is
  raised synchronously and the turn waits; it is not an after-the-fact
  notification. (2) An undecided approval expires (default 24 h, policy-
  configurable). On expiry the raising turn's artifacts and worktree are
  preserved, its claim is released, and the turn resolves as blocked rather
  than failed; a pause is not a merit failure. (3) An agent operating an org
  may decide ordinary approvals; the never-scopeable rules stay human. An agent
  decision is recorded against a distinct agent identity, never presented as a
  human one. The org can never approve its own release. (4) `secrets-or-auth`
  is operation-aware and fails closed: classification on whether an action
  actually emits file contents, and any command whose effect cannot be parsed
  is treated as critical.

### Release & qualification

- **Qualification is proportionate to material release risk.** Evaluation
  exists to reduce material product risk, not to create an infinite proof loop.
  Genuine product, safety-boundary, provider-accounting, learning-integrity,
  build, typecheck, core-test, required-CI, or budget-ceiling failures block
  release. An evaluator-only defect does not trigger a recursive adapter and
  full-candidate cascade when deterministic coverage and retained live evidence
  already bound the affected risk; preserve the failure and track it as
  disclosed release debt. One repaired candidate receives at most one decisive
  full qualification campaign unless a genuine product defect materially
  changes the candidate. Releases report residual evidence debt honestly.
  Canonical shipping policy: `docs/DEVELOPMENT.md` and
  `docs/qualification/`.

- **Release-evidence gate (RQ-1).** A release needs two things: current
  qualification evidence bound to the exact candidate being shipped, and a
  separate human approval of exactly that release. Deterministic contracts
  admit the exact candidate before any spend. Bounded L3/L4 campaign evidence
  is tracked on two separate axes — completeness and verdict; candidate and
  baseline quality evidence are paired per site and exact producer/evaluator
  tuple; uncalibrated judge scores stay advisory. Evaluator debt can be
  accepted only as a separate immutable human disposition and never rewrites
  failed or inconclusive evidence. One canonical manifest binds commit,
  package bytes, policy, prompts, assignments, golden references, tools, and
  ceilings; the deterministic attestation admits only a content-bound
  evidence-only descendant whose package and qualification inputs are
  identical. The supported tag/npm path verifies that attestation, and
  publication proceeds only when the GitHub-authenticated tag-push actor, the
  approval's `approved_by` identity, and an app-configured release approver
  are the same exact identity. Release verification reruns the mandatory
  gates on the tag candidate; F-PT-018 remains an honest merge-enforcement
  limitation. The human-authored threat model, HB-073 abuse-case detectors,
  seven-day soak, and natural credential rotation are future L5 assurance
  outside RQ-1: their absence stays visible and is never represented as a
  pass, but it does not block RQ-1. Do not claim Cormidia is a fully proven
  organization until the real-time soak (`I-LIVE-01` in
  `docs/qualification/design.md`) passes its genuine, separately authorized
  campaign.

- **The offline suite asserts evidence integrity; product-currency is enforced
  only at the release gate.** `pnpm test` asserts that committed qualification
  evidence is genuine and internally coherent. Whether the live product still
  matches the qualified pin is enforced fail-closed only at the release gate.
  A moved or fabricated product cannot be minted, promoted, or released without
  a new qualification campaign.

- **CI runs change-aware lanes, executes the offline suite exactly once, and
  governs its own lane-admission logic.** Lanes are admitted from the changed
  paths; admission fails open into **more** testing. The strict contracts gate
  is unconditional on every CI invocation. The executable suite governs
  `.github/workflows/**` and `scripts/ci/**` as trees. GitHub Actions remains
  the sole CI orchestrator and check system of record. Ordinary internal
  pull requests and `main` pushes run Core Checks on one repository-scoped,
  one-job Linux ARM64 container on the operator's Mac. Pull requests from forks
  and an explicit SHA-guarded manual recovery dispatch use GitHub-hosted
  compute. Every release-shaped job stays GitHub-hosted and retains the
  separate human release gate. Runbook: `docs/ci/self-hosted-runner.md`.

### Money & efficiency

- **Input tokens are not a budget dimension.** Work is bounded by money
  (equivalent cost), provider turns, active time, and human decisions — all
  derived from configured app and role budgets. Nothing admits, routes, or
  caps work by input-token counts. Historical manifests may still carry the
  old `route_budget_overrides` key; it is accepted and ignored.

- **Efficiency doctrine.** Efficiency is a correctness property and never
  weakens safety, independent review, evidence, or critical-operation
  governance. Provider accounting and execution have distinct identities: every
  provider turn settles exactly once, every provider or mechanical execution
  step terminates exactly once, and mechanical work creates no provider
  settlement. Campaigns are predeclared and retain every attempt; missing live
  auth/usage or a skipped required case is invalid or incomplete, never green.
  Qualification runs only in isolated eval orgs and disposable apps; production
  is read-only confirmation, never calibration. Canonical contract:
  `docs/episodes/contract.md`.

- **Budget & cadence.** Default **$1,000/month per app**, configurable per app;
  the per-turn hard stop stays in roles.yaml (`max_turn_budget_usd`). Per-turn
  telemetry rolls up to monthly spend per app against its budget. Cadence:
  **flexi, no restrictions** — roles fire per their triggers at any hour.

### Learning & knowledge

- **Paired-learning improvement gates activation, not qualification.** This
  governs the learning loop, not ordinary delivery: when the org proposes a
  change to its own memory or skills, that candidate is measured by paired
  replay — the same episodes with and without the change. Qualification
  requires a valid, guardrail-clean, non-regressing measurement: `improved`
  and `inconclusive` both pass; `regressed` and `invalid` fail. Only strict
  `improved` may proceed to separately-authorized activation/rollback and to
  promotion of the learning contract. Capture of every eligible episode
  remains the operations SLO. Details: `docs/learning-loop/` and
  `docs/qualification/design.md`.

- **TASTE.md — the org's constitution.** Each agent loads org-wide `TASTE.md`
  → per-role addenda → per-app overrides in the target repo, through each
  harness's native context channel. Where taste is mechanically checkable it
  compiles to gates; the Reviewer enforces the un-lintable residue. Editing
  TASTE.md is a protocol change → human-gated.

- **TASTE layers answer different questions.** The stack is not an override
  cascade of one document type. Org `TASTE.md`: values + engineering
  constitution. App `.cormidia/TASTE.md`: product charter. Role
  `taste/<role>.md`: craft standards. Assembly is concatenation in fixed order
  (org → role → app). The org's "What we never do" section is unoverridable.

- **Knowledge & improvement — three tiers + forward scorecards.**
  *Constitution:* TASTE.md — slow-moving, human-gated. *Skills:* curated
  distillations of recurring lessons — review-gated. *Working memory:* per-role
  knowledge bundles in OKF (markdown + YAML frontmatter). Agents do not write
  active memory directly; they emit candidates into the learning loop below.
  *Scorecards:* every role is graded forward; a weekly retro turns scores into
  proposed memory, skill, and TASTE changes (human-gated).

- **Learning loop.** Agents emit candidates; a Distiller routes evidence to the
  lowest-authority useful destination; a cross-provider Learning Reviewer
  screens; a deterministic publisher — the sole writer of gate-protected
  learning surfaces — executes one content-hash-bound transaction per approval.
  (L1) The episode is the unit of treatment assignment and outcome measurement.
  (L2) `authorized` and `validated` are distinct permanent claims. (L3)
  Evaluation is three-layered — deterministic tests, paired offline replay,
  human-started episode-sticky canary; T3 live canary exposure is forbidden.
  (L4) Approvals are proportional: activation into context, ratified-surface
  merges, T2/T3, and promotion are human-gated. (L5) OKF holds bounded facts
  and procedures — permissions, security posture, deployment, tools, gates, and
  constitutional behavior are never expressible as memory. Full design:
  `docs/learning-loop/`.

### Platform & packaging

- **TypeScript orchestrator, no multi-agent framework.** The orchestrator is
  ground-up TypeScript (strict mode) with no third-party multi-agent
  framework. Three adapters share one interface, each driving its provider's
  native harness: Anthropic roles → Claude Agent SDK; OpenAI roles → Codex
  App Server through the pinned `@openai/codex` CLI and documented JSON-RPC
  over stdio (`@openai/codex-sdk` is not the adapter surface); all other
  models → pi embedded via its SDK. Where a harness cannot do something, the
  gap is documented in the capability matrix, never silently absorbed. There
  is no back-compat obligation to the predecessor orchestrator.

- **Single-runtime orgs are a first-class profile.** Nothing in the
  orchestrator assumes a mix — `runtime:` is per-role config. The critical-ops
  gate and per-turn telemetry are adapter-level conformance requirements.

- **An employee is a team, not a single model — but the harness runs the
  team.** Each role is one harness turn from the orchestrator's view; inside
  the turn the harness may spawn subagents. (1) Same-provider tiering happens
  intra-turn; cross-provider mixing is an org-level flow between roles. (2) The
  org contract is at the artifact level. Per-turn cost telemetry makes silent
  fan-out visible; gates/permissions bind the whole session including
  subagents. `roles.yaml` carries a per-role delegation policy.

- **Repo shape — one repo, one package.** Single TypeScript package (no
  workspace). Layering is a module boundary: `src/runtime` ← `src/loop` ←
  `src/org`, imports flowing downward only.

- **Named Cormidia; the predecessor product name is retired completely.**
  Product vocabulary stays org, app, and role; the brand is never a unit
  inside the product. The CLI, npm package, and GitHub organization are all
  `cormidia`; the default state root is `~/.cormidia`; environment variables
  use only the `CORMIDIA_*` prefix; app-owned artifacts live only at
  `.cormidia/`. Source repository: `cormidia/Cormidia`; front door:
  `cormidia/cormidia-web`.

- **Runtime host.** The dispatcher is a plain CLI entrypoint any scheduler can
  call. State lives in git plus files, so moving hosts is clone plus secrets.
  No lock-in to GitHub Actions or a particular OS.

- **Packaging, homes, and bootstrap boundary.** Cormidia's installed
  package/source, committed org home, local runtime state, and app repo are
  four distinct paths. `cormidia org init` creates a complete org home from
  packaged templates and records an active pointer; `CORMIDIA_ORG_HOME` and
  `CORMIDIA_STATE_HOME` are explicit overrides. Runtime state defaults to
  `~/.cormidia/<org>/` and never lives in git. `cormidia bootstrap` requires an
  active org, accepts a local app checkout, emits only app-owned `.cormidia/`
  artifacts there, and registers the app in the org's `apps.yaml`. The Cormidia
  source repo never doubles as the active org merely because it is the current
  working directory.

- **Local development installation is source-backed.** `pnpm link:local`
  keeps the `cormidia` command and Agent Skill live against the source tree;
  packed installations run the compiled `dist/`. Agents discover the installed
  surface through `cormidia capabilities --json`, `cormidia context --json`,
  command help, and the packaged skill, never by reading implementation code.

### App lifecycle & self-hosting

- **Greenfield creation is create-then-bootstrap.** `cormidia new-app` creates
  a separate target app repo skeleton with seed vision/requirements docs and
  an initial issue packet, then reuses `cormidia bootstrap`. Pushing the
  private GitHub repo, running the Planner, and starting the loop remain
  explicit follow-up steps.

- **Archive-backed app reset.** `cormidia app reset <app>` plans by default;
  `--execute --confirm <app>` first writes a checksummed archive outside the
  state home, then removes only that app's Cormidia-managed state and registry
  entry. It refuses active runs, journals, locks, and pending approvals;
  GitHub cleanup closes only identifiable Cormidia work; the repository,
  default branch, human checkout, and retained closed history stay intact.

- **Sandbox proof before production onboarding.** Roadmap smokes are replaced
  by real, disposable sandbox repos before production apps are onboarded.
  Production-app inventory lives in README → Status.

- **Cormidia develops and distributes Cormidia: self-hosting with uniform
  human-approved releases.** The product's public front door is
  `cormidia/cormidia-web` (homepage, install docs, community issues, release
  notes; never source). The platform source is the private repo
  `cormidia/Cormidia`, and the npm package is the unscoped `cormidia` package.
  The standing org may register, onboard, and operate both repositories as
  apps; neither app's onboarding is conditioned on the other first proving the
  loop. Carve-outs, tighten-only: (1) *Release authority stays human and is
  uniform across apps* — every release-shaped action for every app, including
  website deployment, external publication, npm publish, version tags, and
  release handoff, requires explicit human approval. Approval is not execution;
  after approval, Cormidia may execute only the exact approved action through
  the ordinary durable release mechanism. The org can never approve its own
  release. (2) *Same rules as any developer* — the org obeys AGENTS.md working
  rules; validation policy stays tighten-only; gates and thresholds change only
  by human ratification. (3) *Authority separation stands* — repository
  instructions and linked developer policy are app-scoped context for source
  work, not org-global authority. Development grants, raw eval and campaign
  state, and outer-session instructions never enter org-home prompts, state,
  learning, or approvals. (4) *Human-ratified surfaces keep human merge* —
  TASTE.md, roles.yaml, docs/PURPOSE.md, pipelines.yaml, prompts/**. The source
  repo never doubles as the active org home; org state lives in
  `~/.cormidia/<org>/`. `docs/DEVELOPMENT.md` is the canonical detailed
  development policy; developer-only files are excluded from the installable
  org-runtime package.

  **Exact one-release exception:** the owner explicitly authorized publication
  of `cormidia@0.1.1` despite the then-suspended evidence gate. This
  authorization applies only to version 0.1.1, is not release evidence, does
  not reactivate or weaken the gate, and does not authorize any later version.

- **Jobs: the org runtime expresses non-product work through a second entry
  point.** An organization does work that is not a product: a strategy
  exercise, a cross-team synthesis, a one-off analysis. Cormidia admits it as
  **jobs** — named, dependency-ordered step graphs run once or on demand,
  executed at most one step at a time, resumable across process death, shipped
  as a separate `cormidia-job` binary in the same package. A job may be
  app-scoped or unscoped in the active or default org. This amends entry-point
  count, not kind: the runtime still contains no app code, and "one runtime,
  many apps" stands. Carve-outs, tighten-only: (1) *Jobs carry no verification
  authority* — no independent review, no typed merit verdict, no ticket state
  machine, and no GitHub interaction of any kind. A completed step means the
  provider returned and the step's declared deterministic checks passed; it
  never means the work is correct, and a job can never be a release or
  deployment path. (2) *The gate still binds* — every job step passes the
  critical-ops gate. (3) *Spend stays truthful* — every job provider turn
  settles into the org ledger exactly once under a distinct job attribution,
  and `cormidia-job` invoked from inside a Cormidia turn is refused. (4) *No
  learning input* — job output never feeds the distiller or becomes a learning
  or calibration candidate. (5) *Authority is a role, not an assignment* —
  job steps run as one generic non-product `operator` role that carries the
  authority ceiling; a step may name its own harness/model/effort and can never
  widen what the turn is permitted to do. Jobs are outside CORMIDIA-INV-016's
  domain (finding F-PT-025): that invariant governs delivery units; a job step
  has no readiness transition and no external effect. Jobs remain bound by the
  standing no-green-by-absence rule. Status: **build-complete and
  offline-proven, not outcome-validated.** Contract: `docs/jobs/design.md`.

### Observability & reporting

- **Live observability is read-only and disposable.** `cormidia observe` is a
  human-observable projection over existing durable files plus bounded,
  read-only GitHub state. It binds only to loopback with a per-process
  capability token, owns no workflow state, and exposes no mutation controls.
  Stopping or restarting the observer cannot affect a run. Contract:
  `docs/live-ui/design.md`.

- **Reporting is deterministic, ledger-first, and shares the observer.**
  `cormidia report` provides token-free org/app usage, allocation, quality,
  budget-context, and exhaustive session/pass snapshots over an explicit UTC
  period; the ledger is accounting authority. No reporting database, workflow
  controls, or model-written management narrative. Contract:
  `docs/reporting/design.md`.

## Design pressure points

These are the areas where the product earns trust or fails:

- **Planning quality** — bad tickets poison every downstream pass; Planner
  pipelines and acceptance criteria must be concrete.
- **Mechanical gates** — no side effect can depend on agent prose alone.
- **Failure & recovery** — crashes, stale locks, and half-finished work must
  terminate in bounded retry, evidence, escalation, or success.
- **Memory trust** — lessons must carry evidence and be curated; wrong lessons
  are deleted, not hedged.
- **Human load** — one app-tagged approval queue, one live-app posture by
  default, and production onboarding only after sandbox proof.
