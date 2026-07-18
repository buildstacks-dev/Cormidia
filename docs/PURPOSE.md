# PURPOSE — Operon

*v2.5 — 2026-07-18. Human-ratified decision log. Keep this file high-level;
execution details belong in the GitHub issue tracker, docs/architecture.md, and docs/loop.md.*

## One-liner

Operon is a governed **org runtime** that turns approved goals into verified
software outcomes with process proportional to risk, minimal human attention,
durable forward progress, and continuously improving unit economics.

It provides a standing team of AI agents (Planner, Builder, Reviewer, SRE,
Support, Marketing, Distiller, Learning Reviewer), coordinated through private
GitHub repos as the source of truth, with a human approver gating critical
operations only.

**Operon is an installable package/runtime, not an app.** Its CLI is pointed
at org configuration and target repos; it never contains app code. One org
runtime, N applications.

## Validation and launch path

The product is proven on disposable sandbox apps before touching production
applications (updated 2026-07-11):

1. **operon-sandbox-alpha** — well-kept Node library with tests, lint, CI, and
   agent docs. Primary build-loop target.
2. **operon-sandbox-beta** — minimal Node library with tests only. Proves
   graceful absence handling and "second app = config file, not a fork."
3. **operon-sandbox-gamma** — created 2026-07-06. A tiny deployable HTTP
   service with `/health`, a local/container deploy script, and seeded
   feedback/adoption/health events. Its job is to give SRE, Support, and
   Marketing real functional coverage before production onboarding.
4. **operon-sandbox-delta** ("Ledgerette") — created 2026-07-06. Built from
   scratch through `operon new-app`; the from-scratch onboarding + live
   build-loop proof (the loop fixed and merged its planted bugs unaided).

**Build-complete means M10.** After M10, production onboarding happens with the
human as launch activity, not as product-development proof. Current status:

1. **Civic Intelligence / Responsible Citizen**
   (`~/Build/Government/AgentSkill-CivicIntelligence`) — pending production
   onboarding.
2. **buildstacks.dev** (`~/Build/buildstacks.dev`,
   `buildstacks-dev/buildstacks.dev`) — created and bootstrapped on
   2026-07-06 as `status: onboarding`, proving the same config-not-fork story
   on a production repo. It is not live until the human flips the app status.

The org operates on each app the way the predecessor operated on any target
repo. The architecture must generalize: pointing the org at another app is a
config file, not a fork.

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
| **Human (Bikram)** | Approver for **critical ops only**; final authority |
| **GitHub (private repo)** | Source of truth: code, tickets/issues, PRs, decisions, agent definitions |

## Non-negotiables

1. **Protocol-driven, not prompt-and-pray.** This is not "throw a problem at a
   model and let a builder run with a few prompts." There is a specific taste in
   how software gets built — protocols, standards, review gates — and the system
   must make those enforceable and easy to customize.
2. **Model-agnostic.** Each role is assigned a model independently, and
   assignments change over time (e.g. a frontier model for planning and review;
   a cheaper/faster model for building, SRE, and support). Swapping a role's
   model must be a config change, not a rewrite.
3. **The agent is the code.** Each agent = a versioned blob of code/config/prompt
   in the repo — inspectable, diffable, reviewable like anything else.
4. **Reusable beyond the first app.** The org runtime must not absorb
   app-specific knowledge into its own code; app context lives in the target
   repo and in per-app memory.
5. **Adaptable by design.** The AI/runtime landscape will keep changing fast.
   Operon must stay simple, maintainable, and extensible: new roles, models,
   pipelines, and app-specific policies should be config/protocol additions
   unless evidence proves the core runtime must change.
6. **Efficiency is a correctness property.** Correct outcomes must preserve
   safety and evidence while using process proportional to demonstrated risk.
   A result reached through disproportionate retries, repeated context, or
   human supervision is not fully correct.
7. **Intelligence is reserved for judgment.** Parsing, migration,
   synchronization, validation, capture, aggregation, reconciliation, and
   other deterministic mechanics use zero model turns by default.
8. **Risk buys process.** Every additional planning, review, isolation, model
   effort, or context allowance requires a recorded risk or uncertainty
   factor under the canonical efficiency policy.
9. **Forward progress is durable.** Valid decisions and artifacts survive
   interruption, approval, retry, reset, and restart. Re-derivation requires a
   recorded invalidation reason.
10. **Human attention and context are budgets.** False or repeated approvals
    and unexplained context growth are organizational defects. Authority,
    safety, acceptance criteria, and unresolved findings are never discarded
    merely to meet a budget.
11. **Learning is outcome-accountable.** Learning is successful only when a
    governed intervention measurably improves a later comparable episode; an
    event or plausible candidate alone is not improvement.

## Decided

- **Ticket claims are recoverable sagas, and approval waits resume the exact
  pass without consuming another claim** (ratified 2026-07-18; supersedes the
  A2 same-pass-resume deferral below). Claim acquisition is provisional until
  the first provider turn starts. A crash before that boundary auto-repairs the
  GitHub label and consumes no allowance; ambiguity after provider work never
  retries blindly and requires the explicit, content-bound `operon loop rearm`
  transaction. Approval pauses persist the pipeline/pass, native session,
  completed-pass set, context fingerprint, worktree fingerprint, run id, cost,
  and exact decisions; approved and denied decisions both continue the same
  session as distinct guidance, while changed role/runtime/context/work fails
  closed. The claim number stays stable across any number of approval pauses,
  and lifecycle telemetry separates pause cost from repeated cost. This change
  is now admissible because all three adapters expose native session resume and
  the retained final adapter calibration qualified continuation without retry
  (`docs/capability-matrix.md`; campaign
  `adapter-harness-calibration-v1-20260713-9c3b336d6842`). It does not broaden
  approval authority or collapse decision and execution acknowledgement.

- **Approval decisions and delivery acknowledgements are separate durable
  facts** (ratified 2026-07-18). Classification is action-aware: executable or
  typed operation, targets, redirections, environment, destination, and effect
  are evaluated before agent-authored prose; search patterns, comments,
  messages, and heredoc bodies are data, while executable substitutions and
  obfuscated real actions remain gated. A human approval persists the exact
  content-bound action in `approved`; it never claims the effect happened. A
  later dispatch may execute only an orchestrator-owned typed allowlist
  (currently GitHub issue create/comment, plus the existing specialized release
  handoff), recording `executing → executed|failed|ambiguous`, attempt, actor,
  result, remote reference, and next action. Idempotency markers reconcile a
  crash after a remote effect; ambiguity is never retried blindly and requires
  reconciliation or explicit human disposition. External publication is never
  broadly scopeable because every published payload needs its own execution
  acknowledgement. Critical SRE health events use this boundary to file exactly
  one source-linked `op:incident` issue while retaining analysis and filing as
  distinct completion claims. `docs/approval-and-release-amendment.md` and
  `docs/architecture.md` carry the detailed contract.

- **Qualification is proportionate to material release risk** (ratified
  2026-07-16). Evaluation exists to reduce material product risk, not to create
  an infinite proof loop. Genuine product, safety-boundary, provider-accounting,
  learning-integrity, build, typecheck, core-test, required-CI, or budget-ceiling
  failures block release. An evaluator-only defect does not trigger a recursive
  adapter, focused-admission, and full-candidate cascade when deterministic
  coverage and retained live evidence already bound the affected risk; preserve
  the failure and track it as disclosed release debt instead. One repaired
  candidate receives at most one decisive full qualification campaign unless a
  genuine product defect materially changes the candidate. Releases report
  residual evidence debt honestly and never rescore, overwrite, relabel,
  conceal, or promote unsupported evidence. A real pre-V1 product may ship with
  bounded, disclosed eval debt while every product, safety, accounting,
  learning, budget, and CI boundary remains intact. `docs/development.md` and
  `docs/benchmark-runbook.md` carry the detailed shipping policy.

- **Operon platform development is an independent control plane** (ratified
  2026-07-16). Operon does not operate an org whose job is to build or maintain
  Operon. Repository developer instructions, objective grants, eval artifacts,
  CI/release authority, and learning remain outside every operated org; org
  prompts, state, approvals, memory, budgets, scheduler, and learning never
  authorize platform work. A human may authorize one bounded development
  objective whose isolated repair descendants remain authorized across fresh
  candidate identities. Subscription-backed equivalent USD is a cumulative
  accounting and loop-detection ceiling, not incremental billing. Development
  proceeds through deterministic reproduction and proportionate retained or
  fresh live evidence before at most one fail-fast full qualification. Fresh
  authority is still required for scope/effect expansion, metered or unknown
  billing, threshold or safety weakening, a raised ceiling, governed learning
  actions, production/outward effects, reserved future campaigns, or a second
  full campaign without a material product repair. `docs/development.md` is the
  canonical detailed policy; developer-only files are excluded from the
  installable org-runtime package.

- **Phase 6 qualification scope and deferred real-time soak** (ratified
  2026-07-15). Phase 6 completion now covers applicable retained or
  exact-candidate adapter admission,
  the unchanged planning, context, delivery, continuation, approval, paired-
  learning, deterministic seven-day virtual-soak, and standing-role candidate
  matrix; provider accounting; the nine non-soak evidence promotions;
  read-only production confirmation; documentation; CI; release-equivalence;
  and shipping. The 84-contract inventory remains intact: 83 contracts are in
  the current scope, while only `I-LIVE-01` is `future_soak`. That contract is
  still required and known-red pending its genuine separately authorized
  48–72 hour campaign; preview, virtual-soak, manufactured, or production-
  confirmation evidence cannot promote it. Phase 6 completion may be reported
  while the future soak is pending, but the broader claim that Operon is a
  fully proven “highly efficient organization” remains reserved until
  `I-LIVE-01` passes. `docs/efficiency.md` → Phase 6 qualification scope is the
  canonical boundary.

- **Phase 6 deep-route input-token ceiling** (ratified 2026-07-14). Every
  Phase 6 episode whose final authorized route is `deep` has a hard
  4,000,000-input-token admission ceiling, including deep delivery,
  planning-deep, and approval-semantics episodes. The ceiling is not standing
  spend authority and does not change the ratified model-turn, equivalent-cost,
  active-time, or human-decision caps.

- **Phase 6 paired-learning qualification and activation boundary** (ratified
  2026-07-14). Phase 6 uses a predeclared, content-hashed T1 treatment only on
  treatment arms. Paired outcomes come from the retained provider artifacts
  and hidden guardrails; a fixed synthetic verdict is not evidence and cannot
  qualify the learning block. The primary metric is the hidden-grader
  artifact-quality score, an integer from zero through eight: grounded error
  classes, a causal hypothesis, a bounded/reversible intervention, and
  guardrails each contribute zero through two points. The result is `improved`
  only when all three treatment scores exceed their paired controls and every
  hidden guardrail passes. Each arm also retains an independent provider
  review ending in exactly one `VERDICT: APPROVE` or `VERDICT: REJECT` marker;
  a rejection is a retained guardrail failure, never a synthesized approval or
  corrupt measurement. Any negative delta or guardrail failure is
  `regressed`; nonnegative deltas with any zero delta are `inconclusive`; and
  missing, mismatched, or infrastructure-corrupt evidence is `invalid`. Only
  `improved` may proceed to governed activation and rollback. That action
  occurs once, only after all three pairs have terminal evidence, and requires
  a separate exact candidate/action-hash approval. Candidate-qualification
  provider-spend authorization does not authorize the activation action.

- **Efficiency doctrine and evaluation semantics** (evaluation semantics
  ratified 2026-07-12; organization-wide operating doctrine ratified
  2026-07-13; operator outcome in `docs/VISION.md`, canonical contract in
  `docs/efficiency.md`, Phase 0 decision record in
  `docs/efficiency-transformation/phase0-doctrine-ratification-proposal.md`,
  and T0 eval decision in
  `docs/efficiency-transformation/t0-eval-ratification-proposal.md`).
  Efficiency is a correctness property and never weakens safety, independent
  review, evidence, or critical-operation governance. Provider accounting and
  execution have distinct identities: every provider turn settles exactly
  once, every provider or mechanical execution step terminates exactly once,
  and mechanical work creates no provider settlement. Routes and budgets are
  admitted before runtime construction from explicit risk/uncertainty factors;
  the episode owns `planned_route`, `current_route`, and `final_route`; a
  planning pass-set decision is not a competing route authority. Role
  invocations and configured passes are orchestration identities, while each
  adapter invocation is a separately settled provider turn. Campaigns are
  predeclared and retain
  every attempt; missing live auth/usage or a skipped required case is invalid
  or incomplete, never green. Qualification runs only in isolated eval orgs
  and disposable apps; production is read-only confirmation, never
  calibration. Readiness claims follow the generated → registered →
  runtime-ready → live → autonomously scheduled evidence ladder without
  replacing the `onboarding | live | paused` registry states.

- **Build, don't buy — TypeScript orchestrator, claude-loop reborn.** Ground-up
  rewrite in TypeScript (strict mode) porting claude-loop's proven patterns
  (state-in-markdown, roles.yaml, worktrees, squash-merge discipline). No
  multi-agent framework. **Operon supersedes claude-loop outright** —
  claude-loop has no users, so the Python repo is frozen as pattern reference
  with no back-compat obligation. TS over Python because: pi (and our mandatory
  gating extension) is TS, Codex App Server exposes a generated JSON-RPC schema
  cleanly driven from Node, and the codebase matches the house convention
  (tastytrade-tools, kalshi-tools).
- **Runtime layer — three adapters, one interface, native harnesses** (see
  `research/2026-07-03_runtime-layer.md`):
  - **Anthropic roles** → Claude Agent SDK (TypeScript; hooks + `canUseTool`
    for the critical-ops gate)
  - **OpenAI roles** → Codex App Server through the pinned `@openai/codex`
    CLI and documented JSON-RPC over stdio (per-thread model, approvals,
    sandbox modes). The `@openai/codex-sdk` package wraps `codex exec` and is
    not the adapter surface for Operon.
  - **All other models** → **pi** embedded via its SDK
    (`createAgentSession()`); SYSTEM.md + extensions for protocol enforcement.
    pi has no first-class approval flow, so Operon installs the gating
    extension at runtime.
- **Single-runtime orgs are a first-class profile.** Nothing in the
  orchestrator assumes a mix — `runtime:` is per-role config, so a user can run
  the whole org on pi (including pi + Opus: pi speaks Anthropic natively).
  Consequence: the critical-ops gate and per-turn telemetry are **adapter-level
  conformance requirements** — every adapter must pass the same gate test suite
  so an all-pi org gets identical guarantees. Degradations are documented in a
  capability matrix, not silently absorbed (pi's known gap: no native
  intra-turn subagent fan-out).
- **TASTE.md — the org's constitution.** A layered taste/protocol document each
  agent loads at bootstrap: org-wide `TASTE.md` (what "good" means here) →
  per-role addenda → per-app overrides in the target repo. Injected through
  each harness's *native* context channel (CLAUDE.md / AGENTS.md / pi
  SYSTEM.md-append) — no bespoke mechanism. Where taste is mechanically
  checkable it **compiles to gates** (lint configs, CI checks, PR templates —
  regenerated from TASTE.md, never hand-edited); the Reviewer enforces the
  un-lintable residue. Editing TASTE.md is a protocol change → human-gated.
- **Knowledge & improvement — three tiers + forward scorecards.**
  - *Constitution:* TASTE.md — slow-moving, human-gated.
  - *Skills:* curated distillations of recurring lessons (Agent Skills
    standard — supported by all three harnesses) — review-gated.
  - *Working memory:* per-role knowledge bundles in **OKF** (Google's Open
    Knowledge Format — markdown + YAML frontmatter, vendor-neutral, agents read
    and update directly). Roles write freely at end of turn; a scheduled
    curation pass dedupes, prunes wrong lessons, and promotes durable ones up a
    tier. OKF's vendor neutrality means knowledge survives model/runtime swaps.
  - *Scorecards:* every role is graded forward (Reviewer: post-merge escaped
    bugs; Planner: ticket rework rate; Builder: review cycles per PR;
    Support/Marketing: human edit-distance on drafts). A weekly retro pass
    turns scores into memory updates, skill promotions, and proposed TASTE
    changes (human-gated).
- **Runtime host:** Bikram's laptop first, migrating to a DigitalOcean droplet
  later. Consequence: the dispatcher is a plain CLI entrypoint any scheduler can
  call (launchd now, systemd timer/cron on the droplet) — no lock-in to GitHub
  Actions or macOS. State lives in git + files so migration ≈ clone + secrets.
- **Approval boundary — critical ops only.** Agents work autonomously, including
  merging reviewed work to main. Human gate on: production deploys; destructive
  or irreversible ops (data deletion, DNS/domain, external publishing); spend
  above a threshold; security-sensitive changes (auth, secrets handling); and
  **changes to the org's own protocols** — agents don't rewrite their own rules
  unsupervised.
- **An employee is a team, not a single model — but the harness runs the team.**
  Each role is one harness turn from the orchestrator's view; *inside* the turn,
  the harness may spawn subagents with per-subtask model tiering (e.g. an Opus
  lead with Haiku scouts, Claude Code-style dynamic workflows). Two boundary
  rules: (1) **same-provider tiering happens intra-turn; cross-provider mixing
  is an org-level flow between roles** (a GPT Builder wanting a Claude check is
  the Reviewer role, not a subagent); (2) the org contract is at the **artifact
  level** — ticket in → PR/comment/artifact out, within budget; internal
  delegation is the employee's business. Hardening: per-turn cost telemetry so
  silent fan-out shows up in budget reports, and gates/permissions bind the
  whole session including subagents. `roles.yaml` carries a per-role
  **delegation policy** (whether/when a role may fan out).
- **Folder home: `~/Build/`.** `Operon` lives at `~/Build/Operon`
  (moved 2026-07-03); the target-app sibling arrives as a fresh clone when the
  org starts operating on it.

- **Repo shape — one repo, one package.** `Operon` is a single TypeScript
  package (no workspace). The layering is enforced as module boundaries —
  `src/runtime` (adapters, gate, telemetry) ← `src/loop` (the build loop,
  claude-loop's successor) ← `src/org` (scheduler, roles, memory, retro) —
  with imports flowing downward only, so extracting the loop into its own
  package later is mechanical if it ever earns independent users. The loop's
  CLI identity survives as a subcommand. The original Python claude-loop will
  be archived.
- **Named Operon.** "agentic-org" was a placeholder description, not a brand —
  too generic to be a product or GitHub org name. Renamed to **Operon**: from
  biology, a cluster of genes expressed as one functional unit under a single
  operator — the same shape as this project (multiple role-agents, one
  critical-ops gate). Repo moved to `~/Build/Operon`; GitHub repo at
  `buildstacks-dev/Operon`.
- **Sandbox proof before production onboarding** (2026-07-05; gamma approved
  2026-07-06). Roadmap "toy task" smokes are replaced by real, disposable
  sandbox repos. Alpha/beta cover onboarding, build loop, multi-app, approvals,
  budgets, memory, and multi-provider behavior. Gamma adds a running service
  plus synthetic feedback/adoption inputs so SRE, Support, and Marketing get
  functional coverage. Civic and buildstacks.dev stayed deferred until the
  product reached build-complete at M10; buildstacks.dev was then onboarded as
  an `onboarding` app, while Civic remains pending.
- **Multi-app: designed in, operated sequentially** (2026-07-04). The
  architecture is multi-app from day one (app registry; per-app config,
  TASTE, memory, scorecards), but the org runs **one live app** until the
  scorecards and the human's own load say otherwise. Human bandwidth is
  protected by construction: a single app-tagged approval queue (one inbox,
  never one per app), per-app cadence in config, org-level WIP limits.
  Co-planning sessions are the one irreducibly per-app human cost — that is
  the real limit on live-app count, and why onboarding is sequential.
- **One turn, one app** (2026-07-04). A role turn operates in exactly one
  target-repo workdir (already the `TurnRequest` contract); multi-app exists
  only in the scheduler and the human surfaces, never inside a turn's
  context. Memory splits per role (craft knowledge, cross-app) vs per
  role+app (domain knowledge); context assembly loads the role bundle plus
  the *current* app's bundle only. Scorecards are kept per (role, app) so
  quality regressions localize.
- **Packaging, homes, and bootstrap boundary** (reconciled 2026-07-09;
  supersedes the optional single-app org-home profile from 2026-07-04).
  Operon's installed package/source, committed org home, local runtime state,
  and app repo are four distinct paths. `operon org init` creates a complete
  org home from packaged templates and records an active pointer;
  `OPERON_ORG_HOME` and `OPERON_STATE_HOME` are explicit overrides. Runtime
  state defaults to `~/.operon/<org>/` and never lives in git. `operon
  bootstrap` requires an active org, accepts a local app checkout, emits only
  app-owned `.operon/` artifacts there, and registers the app in the org's
  `apps.yaml`. The Operon source repo never doubles as the active org merely
  because it is the current working directory.
- **Archive-backed app reset** (2026-07-11). A repeatable app test iteration
  is `operon app reset <app>`, not deletion/recreation of the whole org. Its
  default is a non-mutating plan; explicit `--execute --confirm <app>` first
  writes a checksummed archive outside the state home, then removes only the
  named app's Operon-managed clone/worktrees/runs/ticket state, app-attributed
  control records, and registry entry. It refuses active runs, journals,
  locks, and pending approvals. `--force` crosses only stale run envelopes
  with no heartbeat for ten minutes; it never crosses a fresh run or any other
  live-work boundary. GitHub cleanup closes only identifiable
  Operon work (`op:*` issues and linked/`op/` PRs) and deletes its head
  branches; the repository, default branch, human checkout, and retained
  closed history stay intact. This is one lifecycle operation, not a new
  user-facing app-epoch concept.
- **Local development installation is source-backed** (2026-07-09).
  `pnpm link:local` exposes the `operon` command and Operon Agent Skill while
  retaining a live reference to the local source tree; subsequent invocations
  pick up source edits without update/relink/build. Packed installations use
  the compiled `dist/cli.js`. Agents discover the installed surface through
  `operon capabilities --json`, `operon context --json`, command help, and the
  packaged `$operon` skill rather than reading implementation code.
- **Greenfield creation is create-then-bootstrap** (2026-07-07). A brand-new
  product starts with `operon new-app`: create a separate target app repo
  skeleton, write seed vision/requirements docs plus an initial issue packet,
  then reuse the same `operon bootstrap` app-artifact/register path. The command
  is local and deterministic; creating/pushing the private GitHub repo, running
  the Planner, and starting the loop remain explicit follow-up steps. This keeps
  Operon a runtime pointed at app repos, never a place where app code lives.
- **TASTE layers answer different questions** (2026-07-04). The stack is not
  an override cascade of one document type. Org `TASTE.md`: values +
  engineering constitution ("how we work; what we never do"). App
  `.operon/TASTE.md` in the target repo: product charter ("what this product
  is; what good means here" — civic's evidence honesty vs buildstacks'
  personal voice). Role `taste/<role>.md`: craft standards ("what good looks
  like in this discipline" — reviewer checklist, marketing tone). Assembly
  is concatenation in fixed order (org → role → app); layers are orthogonal
  so real conflicts are rare — where they collide, the narrower layer
  specializes defaults, but the org's "What we never do" section is
  unoverridable.
- **Approval surface — CLI queue** (2026-07-04). Gate escalations land in a
  CLI approval queue; the human reviews items **one by one** — approve, or
  deny with reason — and every decision is persisted as an audit trail.
  No push/email channel in v1; if one is added later it is a pointer into
  the same queue, never a second approval path.
- **Budget & cadence** (2026-07-04). Default **$1,000/month per app**,
  configurable per app; the per-turn hard stop stays in roles.yaml
  (`max_turn_budget_usd`). Per-turn telemetry rolls up to monthly spend per
  app against its budget. Cadence: **flexi, no restrictions** — roles fire
  per their triggers at any hour; no working-hours window.
- **Dispatcher, approvals, and idempotency** (ratified 2026-07-06). The
  autonomous host is a stateless `operon dispatch` tick that spawns detached
  turns; turns operate in org-managed clones/worktrees under `~/.operon/`.
  Critical-op approval means an expiring, single-use, action-hashed grant for a
  later retry — never auto-execution by the orchestrator. Durable side effects
  are git/GitHub artifacts only; labels move after the artifacts they announce;
  merges are loop-owned squash merges after approval/review/gates.
- **Protocol-driven loop** (ratified 2026-07-06). The loop is a pipeline of
  versioned passes, not one opaque prompt. Planning is a Planner pipeline;
  Builder/Reviewer passes get assembled briefs; mechanical quality gates run
  between passes and twice at ship; no side effect keys off agent prose;
  ticket-level parallelism is dependency/scope-aware; orchestrator failures are
  loud. Review dimensions are risk-selected, with security always-on.
  Acceptance criteria are a first-class quality contract: binary, mapped to
  named tests, never summarized away, and human-touched for deep/high-risk work.
- **Resolved operating defaults** (ratified 2026-07-06; proportionality and
  wall-time portions superseded by the 2026-07-12 efficiency doctrine).
  High-tier tickets stay
  autonomous after the Builder's contract pass in v1; revisit with scorecard
  evidence if contracts prove weak. Planner depth previously defaulted to deep
  competing-PM planning for milestones and per-pass wall time previously
  defaulted to 60 minutes. Route depth and time budgets now come from
  `docs/efficiency.md`; neither former default can override proportional
  admission.
  Org WIP defaults to `max_concurrent_turns: 2`; approval grants expire after
  24 h; dispatch ticks every 5 minutes; loop review/fix cycles cap at 3.
  Support and Marketing are disabled per app until that app has real feedback
  or adoption channels.
- **Future opt-ins** (ratified 2026-07-06). A Lab role is approved as a future
  opt-in live-environment verifier when a pipeline needs evidence artifacts
  from real execution. Competitive intelligence stays a Marketing pipeline
  (`ci-sweep`) unless scorecards later justify a standalone role.
- **Approval & release boundary amendment** (ratified 2026-07-10; full design,
  threat model, adapter feasibility, and regression requirements in
  `docs/approval-and-release-amendment.md`). Amends the 2026-07-04/06
  approval decisions after the buildstacks.dev episode (42 decisions in one
  afternoon, mostly false positives): (A1) the human may widen a grant at
  decision time to rule+path scope for a ticket or app — TTL, use-count cap,
  revocation, per-use audit; the single-use action hash stays the default and
  self-merge, production deploy, protocol-surface writes, and
  outside-worktree actions are never scopeable. (A2) approval semantics stay
  later-retry, with durable approve/deny-and-rearm; as amended on 2026-07-18,
  the next tick resumes the exact content-bound provider session after all
  three adapters obtained retained live conformance. (A3) same-rule batch review
  is allowed with unchanged per-item audit rows. (A4) every app declares a
  `release:` mechanism and owner; the orchestrator (default) or SRE triggers
  the declared deploy as a critical op after merge, SRE owns smoke/rollback,
  and a deployable milestone with no declared mechanism fails the ship gate.
  (A5) denial reasons persist as curated role memory so no denial is
  re-litigated. Agents gain no unilateral power anywhere in this amendment —
  every widening is a human act at decision time.
- **Learning loop design** (ratified 2026-07-11; full design, schemas, and
  release plan in `docs/learning-loop/` — design/spec/milestones; the
  2026-07-10 review feedback that drove the v0.8 revision is archived at
  `docs/learning-loop/archive/2026-07-10_feedback.md`). Operon's governed
  self-improvement system: agents stop writing active memory directly and
  emit candidates instead; a distiller routes evidence to the
  lowest-authority useful destination (OKF concept, skill draft, protocol
  proposal, eval/gate proposal, ticket, rejection ledger); a cross-provider
  reviewer screens; a deterministic publisher — the sole writer of
  gate-protected learning surfaces — executes one content-hash-bound
  transaction per approval. Core decisions: (L1) the **episode**
  (ticket / incident / feedback thread / campaign) is the unit of treatment
  assignment and outcome measurement — canary lineage is `hash(episode_id)`,
  sticky across every turn; `EpisodeRecord` is a projection over
  process-owned state, never a second store. (L2) `authorized` and
  `validated` are distinct permanent claims; executable `ExperimentRecord`s
  are required only for efficacy-claiming candidates and T2/T3 activation,
  so scoped facts are not taxed with experiment apparatus. (L3) evaluation
  is three-layered — deterministic tests, paired offline replay from
  `ReplayCapsule`s, human-started episode-sticky canary; V1 capsules cover
  build episodes only, and T3 live canary exposure is forbidden (sandbox,
  replay, shadow, or bounded manual trials only). (L4) approvals are
  proportional: activation into context, ratified-surface merges, T2/T3, and
  promotion are human-gated; deduplicated rate-capped tickets and unmerged
  proposal drafts publish routinely. (L5) OKF holds bounded facts and
  procedures — permissions, security posture, deployment, tools, gates, and
  constitutional behavior are never expressible as memory. Milestones M1–M6
  sequence capture → episode/replay substrate → experiment substrate →
  governed activation → offline eval + canary → scheduled distillation;
  autonomy is earned by measured agreement plus outcomes, never granted by
  release.
- **Live observability is read-only and disposable** (ratified 2026-07-12;
  implementation contract in `docs/live-ui/design.md`). Operon remains
  agent-operated through coding agents and the CLI; `operon observe` is a
  human-observable projection over existing durable files plus bounded,
  read-only GitHub state. It binds only to loopback with a per-process
  capability token, uses HTTP snapshots plus SSE, owns no workflow state or
  second queue, and exposes no configuration, approval, retry, label, merge,
  deploy, or other mutation controls. GitHub `op:ready` issues are the
  product-delivery queue; onboarding, scheduled/event intake, and approvals
  remain separate concepts. Stopping or restarting the observer cannot affect
  a run.
- **Reporting is deterministic, ledger-first, and shares the observer**
  (ratified 2026-07-12; implementation contract in
  `docs/reporting/design.md`). `operon report` provides token-free org/app
  usage, allocation, quality, budget-context, and exhaustive session/pass
  snapshots over an explicit UTC period; the ledger is accounting authority
  and run/task evidence enriches it without repair or hidden deduplication.
  `operon observe` remains the one loopback reader server, with Live at `/`
  and as-of Reports at `/reports`; portable HTML works without a server. No
  reporting database, workflow controls, reconciliation side effect, provider
  turn, or model-written management narrative is introduced. `operon
  telemetry` remains the backward-compatible envelope-first forensic view.
- **The Phase 6 release attestation fails closed, and its changed-path rule
  binds only to the packaged artifact** (PROPOSED 2026-07-17 — ratified when the
  Wave 5 remediation PR merges; ROOT-001). Two parts. (1) *Fail closed.* The
  verifier requires the qualified candidate commit to be present; its
  changed-path check now calls `changedPaths` unconditionally and throws
  `release_attestation_candidate_commit_unavailable` when the commit is absent.
  The previous `if (commitExists(...))` guard silently skipped the check exactly
  where it mattered most — a shallow CI checkout (`actions/checkout` default
  depth 1) where the candidate commit is never fetched — so CI reported green and
  deleting git history made the integrity check pass. CI now uses `fetch-depth:
  0`, a `phase6-candidate-<date>` annotated tag keeps the squash-orphaned
  candidate reachable, and the workflow gains a `push:` trigger on `main` so
  merges are verified, not only nightly-cron shallow runs. **(Amended by the
  integrity/currency-separation entry below, PROPOSED 2026-07-17.)** The
  original reading — that the full attestation, including the live-product
  recompute, runs on every `main` push, so the dev suite stays red until a fresh
  qualification campaign re-attests — is superseded: per-push/PR CI now runs
  evidence **integrity** only (deterministic, green on intact evidence), and the
  live product-**currency** recompute moves to a release-gated job. `fetch-depth:
  0` is retained (the release job's changed-path check still needs history). (2)
  *Scope.* The
  changed-path rule binds only to files that affect the **packaged artifact** —
  what `npm pack` ships per package.json `files` (the compiled `dist` output,
  `agent-skills/operon/`, `config/launchd/`, `docs/policy.yaml.template`,
  `docs/scheduler.md`, the prompts and taste trees, `TASTE.md`, `roles.yaml`,
  `pipelines.yaml`, `README.md`, and the three packaged `scripts/*.mjs`) plus the
  `src` sources and `package.json` that produce it. A change under those paths
  invalidates qualification. The executable suite — `scripts/eval/`, `test/`,
  `eval/` except `eval/contracts.yaml`, the qualification workflow, and the
  test-runner/grading configs (`vitest.config.ts`, `vitest.live.config.ts`,
  `playwright.observe.config.ts`) that select and grade which tests run — stays
  governed by `executable_suite_sha256` and the proportionate-repair path;
  `isExecutableSuitePath` is the single membership predicate shared by the
  suite-hash and the changed-path rule so the two can never drift apart. The org
  surfaces stay governed by `org_fingerprint`; sanitized promotion evidence under
  `research/evals/` stays governed by the `ALLOWED_PROMOTION_PATHS` allowlist,
  which still rejects unsanitized evidence. Every other changed path — docs other
  than the two packed docs, `review/`, `.github/` other than the workflow,
  install/build-environment config (`pnpm-workspace.yaml`, `pnpm-lock.yaml`,
  `tsconfig.json`), and any untracked non-shipped file — is **outside
  qualification scope and does not invalidate it**. The test-runner configs are
  in the suite, not out, because they ship in no package (so
  `release_package_sha256` never sees them) yet decide which tests run: leaving
  them ungoverned would let a post-qualification `exclude` skip the red contract
  tests and report the suite green. Install/build-environment config is
  deliberately outside the suite: a bad value there fails the install/build/test
  loudly rather than silently favouring a graded outcome, any effect on shipped
  bytes is caught by `release_package_sha256`, and resolved runtime deps are
  pinned by `system_fingerprint`. Rationale: qualification certifies product
  behavior; a docs-only or reviewer-notes change cannot alter graded behavior, and
  AGENTS.md already promises "Docs-only changes: nothing to run." The prior
  all-paths rule contradicted that promise — a single docs commit (`#80`, adding
  `docs/architecture/conceptual-overview.md`) silently invalidated the evidence
  while CI still reported green.
- **The offline suite asserts evidence integrity; product-currency is enforced
  only at the release gate** (PROPOSED 2026-07-17 — ratified when this PR merges;
  P0-07 / ROOT-001 follow-up). The Phase 6 contract verifier had one entry point
  that mixed two separable questions: *is the committed qualification evidence
  genuine and internally coherent* (integrity — deterministic, a function of the
  committed attestation and its committed campaign) and *does the live product
  still match the qualified pin* (currency — recomputed from the working tree by
  live `npm pack`, executable-suite, org-surface, on-disk-byte, and git
  changed-path hashing). Because the two were fused, the nine required contract
  tests went red the instant a legitimate src change moved the package hash away
  from `release_package_sha256` — an accurate release check, but mis-scoped into
  the dev suite, which made `pnpm test` structurally un-green-able after any src
  change and contradicted AGENTS.md's "Any src change: pnpm test". *Decision:* the
  offline suite (`pnpm test`, `test:transformation`) asserts **integrity only** —
  `verifyAttestationIntegrity` / `verifyContractEvidence(..., "integrity")` run
  the well-formedness, campaign-binding, qualified-pin, self-consistency, and
  allowlist checks and are green whenever the committed evidence is intact.
  **Product-currency is enforced fail-closed only at the release gate:**
  `eval:attest-release` refuses to *mint* an attestation for a moved product
  (`release_package_bytes_changed_after_qualification`); `eval:promote` and the
  new `eval:release-verify` *verify* it in full `"release"` scope
  (`release_attestation_package_mismatch`); and a dedicated `release-currency` CI
  job — gated to release tags and manual `workflow_dispatch`, deliberately off
  ordinary push/PR — runs `eval:release-verify` so releases are gated while
  per-commit CI stays honest-green. `verifyReleaseAttestation`'s external
  behavior is unchanged (same codes, same order, same ROOT-001 fail-closed on an
  absent candidate commit); integrity is a strict prefix of it. *Rationale:* this
  restores the "Any src change: pnpm test" contract without weakening the release
  gate — a moved or fabricated product still cannot be minted, promoted, or
  released without a new qualification campaign. **This supersedes the reading of
  the P0-07 entry above that the dev suite stays red until re-qualified.** A
  release from post-Wave-5 `main` therefore still requires a fresh qualification
  campaign (Option 1); that requirement is now enforced by the release-currency
  gate rather than by red dev tests.
- **Candidate qualification is decoupled from learning-activation eligibility;
  strict paired-learning improvement gates activation, not qualification**
  (PROPOSED 2026-07-17 — ratified when this PR merges). The Phase 6 candidate
  campaign runs a predeclared six-arm AB/BA/AB paired-learning experiment: the
  T1 treatment must strictly beat its paired control on all three pairs to be
  `improved`. `qualify()` previously treated any non-`improved` aggregate
  (including a valid, guardrail-clean `inconclusive`) as a qualification failure
  — via `qualificationMiss` and an "invalid supplemental evidence" classification
  — so the whole candidate, and therefore the release-currency gate, went
  `invalid` whenever a single control artifact happened to score at the 8/8
  ceiling (a tie → delta 0 → inconclusive). Because the treatment reliably hits
  the ceiling and all the variance is in the controls, this made candidate
  qualification a **stochastic ~50/50 gate driven by control draws, unrelated to
  product quality**, and policy forbids rerunning an aggregate experiment for a
  better draw. Empirically the qualified candidate `c6834cf0` drew controls at
  7/6/7 (`+1,+2,+1`); the post-remediation `830028b` re-qualification drew a
  control at 8/8 on one pair (`0,+2,+1`) and was correctly, but unshippably,
  `invalid` despite 30/30 product attempts passing with exact settlement and zero
  safety misses. *Decision:* candidate qualification requires a **valid,
  guardrail-clean, non-regressing** paired-learning measurement — `improved` and
  `inconclusive` both pass; `regressed` (any negative delta or hidden-guardrail
  failure) and `invalid` (malformed/incomplete) still fail. **Strict `improved`
  remains the sole outcome that may proceed to the separately-authorized
  publish/activate/rollback activation, and to promotion of the learning
  contract** — the activation and promotion paths are unchanged. Learning
  *capture* (100% eligible capture) was already, and remains, the operations SLO
  for the loop (`docs/efficiency.md` → Threshold semantics). This is the same
  class of mis-scoping as the integrity/currency separation above: an accurate
  check (does the treatment strictly improve artifacts *on this draw*) was
  embedded where it structurally blocked a legitimate release. *Rationale
  (first-principles):* learning is instrumental and outcome-accountable
  (Non-negotiable #11) — it succeeds only by improving a *later comparable
  episode that had headroom*. A qualification that forces an improvement out of
  every episode — including ones where the untreated baseline already scores at
  the ceiling — does not measure learning; it manufactures deltas, and every
  manufactured delta competes for the same finite attention and risk budget the
  org should reserve for the few lessons that actually move the needle. **The org
  does not need to learn from everything; trying to dilutes the high-leverage
  learnings.** So qualification certifies that the learning *loop* is healthy —
  it captures every eligible episode, forms grounded/guardrailed candidates,
  passes independent review, and never regresses — as an SLO alongside product
  behavior, safety, accounting, settlement, and the distribution SLOs, and
  reserves the strict `improved` verdict for **activation**, where the org
  actually spends attention promoting a lesson only when a real, measured
  improvement exists. Declining to activate where a control is already at the
  ceiling is correct behavior, not a failure. Candidate qualification therefore
  does not turn on a three-sample experiment's luck against a strong baseline. No
  product, safety, accounting, settlement, grader,
  threshold, or activation contract is weakened — regressions still fail
  qualification, activation still requires strict improvement, and the executable
  suite is `validateLearningPairEvidence(…, "qualification"|"activation")` with
  the strict activation mode as the default. **This does not retroactively
  qualify any prior campaign** (each is immutable at its own `campaign_sha256`
  and bytes); a release from `main` still requires a fresh qualifying campaign.
- **CI runs change-aware lanes, executes the offline suite exactly once, and
  governs its own lane-admission logic** (PROPOSED 2026-07-18 — ratified when
  this PR merges; issue #99). Three parts.
  (1) *Deduplication.* The single `deterministic` job ran `test:transformation`,
  `eval:deterministic`, the full vitest suite, and `test:transformation:strict`
  in sequence. Each of those umbrella scripts bundles a vitest invocation with a
  distinct non-vitest assertion, so `test/transformation` + `test/eval` executed
  **four times per PR/push and six times nightly** (~340s/run of pure
  duplication, measured on run 29637905909). The distinct assertions cost ~2s
  total, and `evaluateContracts` verifies evidence presence and the declared
  debt set *without probing source text*, so one offline-suite execution plus
  the atomic `eval:contracts` / `eval:contracts:strict` gates is exactly
  equivalent coverage. The strict gate remains **unconditional** on every CI
  invocation (J-REL-01), and the nightly shuffle is retained as the one
  deliberate repetition because it tests a distinct invariant (order dependence
  at two workers, concurrency dependence at one).
  (2) *Admission.* Lanes are admitted from the changed paths, so a docs-only
  change consumes no qualification runner — which is what AGENTS.md ("Docs-only
  changes: nothing to run") and the 2026-07-17 qualification-scope decision
  already promised, and which per-commit CI had never implemented. Admission
  fails open into **more** testing: schedules, tags, manual dispatch, an
  unresolvable diff, and any unrecognised path admit every lane; only provably
  behaviour-free paths admit none. Pushes to `main` keep the core lane because
  this repository has no branch-protection enforcement. Superseded pull-request
  runs are cancelled; `main` and tag runs never are. This also adds the
  Observer/Reports browser, smoke, build, and pack checks that AGENTS.md
  required but per-commit CI had never run.
  (3) *Amendment — the executable suite now governs `.github/workflows/**` and
  `scripts/ci/**` as trees* rather than the single filename
  `.github/workflows/efficiency-qualification.yml`. This **widens** governance
  and is the direct extension of the ROOT-001 reasoning that put
  `vitest.config.ts` in the suite: lane admission decides which tests execute,
  so under the old exact-filename rule a second workflow file — or a change to
  the path classifier that admitted no lane — could skip the red contract tests
  while CI still reported green. Both trees ship in no package, so
  `release_package_sha256` never sees them; `executable_suite_sha256` now does.
  The entry above that lists ".github/** other than the workflow" as outside
  qualification scope is amended to "outside the workflows tree". No product,
  safety, accounting, qualification, or release assertion is weakened: the
  release-currency gate keeps its tag/dispatch gating, full history, and
  fail-closed behaviour, and `test/transformation/release-gate.test.ts` gains
  regression guards that the offline suite runs exactly once, that no umbrella
  re-run reappears, that the strict gate carries no `if:`, that concurrency
  never cancels `main`, and that no provider-spending or externally mutating
  command can enter CI.

## Prior art (ours)

**claude-loop** (read-only reference checkout at
`scratchpad-gitignore/claude-loop-teams/`) already proved the core
shape: vision.md → plan → dev → review → ship, state in plain markdown in the
target repo, per-role model selection in `roles.yaml`, fresh agent sessions,
squash-merge to main. Operon is its successor, generalizing on two axes:

| Axis | claude-loop | Operon |
| --- | --- | --- |
| Runtime | Claude CLI only | model-agnostic body per role |
| Roles | build pipeline (plan/dev/review/ship) | standing org incl. SRE + Support |
| Time | batch runs, invoked by hand | scheduled, long-running, recovers from failure |
| Memory | deliberately none ("no memory to go stale") | curated long-term memory per role |

Other in-house experiments worth mining for lessons: `agent-team-template-codex`,
`codex-orchestrator`, `codex-runner`, `openclaw-orchestrator-platform`,
`ralph-loop-modified`.

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

## Open questions

No high-level PURPOSE questions are open right now. Current build-time
verification questions live with the subsystem docs and the issue-tracker items that
will resolve them.

## Status

- 2026-07-03 — folder created, purpose drafted.
- 2026-07-03 — v0.2: first app = Civic Intelligence; library-not-app framing;
  laptop → DO droplet; critical-ops-only approval; claude-loop named as prior art.
- 2026-07-03 — v0.3: build-vs-buy resolved — Python rewrite reusing claude-loop
  patterns; runtime layer decided (Claude Agent SDK + Codex app-server native,
  pi for everything else); pi reviewed and adopted
  (`research/2026-07-03_runtime-layer.md`).
- 2026-07-03 — v0.4: moved to `~/Build/agentic-org`; employee-as-team decided —
  intra-role delegation lives in the harness, cross-provider mixing lives at the
  org level.
- 2026-07-03 — v0.5: TypeScript over Python (agentic-org supersedes claude-loop
  outright); Marketing role added; all-pi single-runtime profile made
  first-class; TASTE.md constitution + three-tier knowledge (TASTE → skills →
  OKF bundles) + forward scorecards decided.
- 2026-07-03 — v0.6: repo shape decided (one repo, one package, layered
  modules); scaffold landed — Runtime contract, critical-ops gate v0 +
  conformance seed (16 tests green), roles.yaml loader, CLI (`roles`,
  `doctor`), TASTE.md v0. Adapters are documented stubs. Python claude-loop to
  be archived by Bikram.
- 2026-07-03 — v0.7: renamed agentic-org → **Operon**; repo moved to
  `~/Build/Operon`; GitHub repo created at `buildstacks-dev/Operon`.
- 2026-07-04 — v0.8: pilots decided — civic (app #1) drives the loop
  milestones via real acceptance tasks; **buildstacks.dev** added as app #2
  to prove config-not-fork and the SRE/approval surface. Multi-app designed
  in, operated one-live-app-at-a-time; one-turn-one-app invariant; memory
  and scorecards partitioned per (role, app). Bootstrap artifact home
  decided (`.operon/` in the product repo; org-home repo optional). This
  artifact-home choice was superseded by v1.5's required separate org home. TASTE
  layer semantics clarified (org values / app charter / role craft).
  Superseded by v1.0's sandbox-first validation path for roadmap acceptance;
  civic/buildstacks remain production onboarding targets.
- 2026-07-04 — v0.9: approval channel decided — CLI queue, reviewed one by
  one, persisted audit trail. Budget decided — $1,000/month per app,
  configurable per app. Cadence decided — flexi, no restrictions. Open
  question #1 (budget & cadence) closed.
- 2026-07-06 — v1.0: PURPOSE kept as the high-level decision log; validation
  path updated. Product is build-complete at M10; civic and buildstacks.dev
  are production onboarding after that point. operon-sandbox-gamma approved,
  then created, as the third sandbox target for SRE/Support/Marketing
  functional coverage.
- 2026-07-06 — v1.1: architecture.md §11 and loop.md §11 ratified; remaining
  human defaults resolved (60 min wall-clock cap, deep milestone planning /
  lighter weekly groom, autonomous high-tier contracts, future Lab opt-in,
  competitive intelligence as Marketing pipeline, Support/Marketing disabled
  per app until channels exist).
- 2026-07-06 — v1.2: buildstacks.dev production onboarding executed after
  M10: private repo `buildstacks-dev/buildstacks.dev` created, bootstrapped
  with app-owned `.operon/` artifacts, and registered in the Operon org as
  `status: onboarding`. Civic remains pending; buildstacks.dev is not live
  until the human flips its app status.
- 2026-07-06 — v1.3: post-M12 hardening and live verification recorded (no
  Decided changes; three enforcement notes on already-ratified defaults).
  (1) The per-turn budget hard stop (`max_turn_budget_usd`, "Budget & cadence"
  above) is now enforced across **all three adapters** — Claude natively, Codex
  against an estimated cost from cited prices, pi against real provider cost —
  not on Anthropic runtimes alone. (2) "Support and Marketing are disabled per
  app until channels exist" ("Resolved operating defaults" above) is now
  actually enforced by channel-presence gating: audience-facing roles skip an
  app that declares no matching channels, with an observable reason — no longer
  only a cadence convention. (3) The product was verified build-complete
  end-to-end: the live build loop drove planted tickets on the sandbox apps
  through ready → build → gates → review → ship → squash-merge, and the Claude
  live conformance suite re-passed.
- 2026-07-07 — v1.4: greenfield creation boundary recorded. `operon new-app`
  creates a separate product repo scaffold, starter product docs, and initial
  issue packet, then converges through the existing bootstrap/register path.
- 2026-07-09 — v1.5: packaging/onboarding boundary reconciled. Operon is a
  locally installable CLI with a source-backed development link and packaged
  Agent Skill; package, org, state, and app paths are explicit and separate;
  bootstrap always joins a complete active org and no longer creates a nested
  single-app org profile.
- 2026-07-10 — v1.6: approval & release boundary amendment ratified (A1–A5:
  scoped grants, approve-and-rearm, batch review, release handoff, denial
  lessons; full design `docs/approval-and-release-amendment.md`). Recorded in
  Decided above; implemented through Stage 6 of the proportionality plan.
- 2026-07-11 — v1.7: learning loop design ratified (v0.8 suite,
  `docs/learning-loop/`; governed self-improvement — capture → episodes →
  experiments → governed activation → offline eval + human-started canary →
  scheduled distillation). At that versioned snapshot, Preflight + M1–M5 were
  built and M6 remained next; v1.8 below supersedes that status.
- 2026-07-12 — v1.8: M6 scheduled distillation built through the ordinary
  dispatch/pipeline/ledger path: deterministic zero-token prechecks,
  evidence clustering and dedupe/suppression, candidate/frequency/budget caps,
  daily Distiller, weekly cross-provider Learning Reviewer, structured
  fail-closed verdict persistence, and report-only compaction. M6 is complete
  and live in the dispatch/CLI path; offline conformance is complete, and no
  token-spending calibration campaign was required for the implementation.
- 2026-07-12 — v1.9: the read-only Operon Live UI contract was ratified and
  implemented as `operon observe`: loopback capability URL, versioned
  snapshot projection, SSE reconciliation, deliberate local evidence access,
  and framework-free responsive browser UI without a second workflow store.
- 2026-07-12 — v2.0: Reporting V1 ratified and implemented as a deterministic
  ledger-first `operon report` CLI/portable export plus lazily computed
  `/reports` mode in the existing observer; detailed semantics remain in
  `docs/reporting/design.md` v0.1.
- 2026-07-13 — v2.1: P0-01 through P0-09 ratified as Operon's
  organization-wide efficiency operating doctrine. The episode now owns its
  route; execution/accounting terms and layer ownership are explicit; legacy
  deep/60-minute defaults are non-normative; durable progress and lifecycle
  evidence claims are part of the product contract. Numeric budgets remain
  solely in `docs/efficiency.md` (`efficiency/v1`).
- 2026-07-16 — v2.4: proportionate release evidence ratified. Material
  product, safety, accounting, learning-integrity, budget, and CI failures
  remain blockers; bounded evaluator-only defects are retained and disclosed
  without recursively restarting provider qualification.
