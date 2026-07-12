# PURPOSE — Operon

*v1.8 — 2026-07-12. Human-ratified decision log. Keep this file high-level;
execution details belong in the GitHub issue tracker, docs/architecture.md, and docs/loop.md.*

## One-liner

A reusable **org runtime**: a standing team of AI agents (Planner, Builder,
Reviewer, SRE, Support, Marketing, Distiller, Learning Reviewer) that develops and operates software
products, coordinated through private GitHub repos as the source of truth,
with a human approver gating critical operations only.

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

## Decided

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
- **Resolved operating defaults** (ratified 2026-07-06). High-tier tickets stay
  autonomous after the Builder's contract pass in v1; revisit with scorecard
  evidence if contracts prove weak. Planner depth defaults to deep
  competing-PM planning for milestones and a lighter weekly groom. Per-pass
  wall-clock cap defaults to **60 minutes**, with per-pass override later.
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
  later-retry, now with explicit approve-and-rearm (`op:blocked → op:ready`)
  continuing from durable artifacts; literal same-pass session resume is
  deferred pending per-adapter live conformance. (A3) same-rule batch review
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
  scheduled distillation). Preflight + M1–M5 built and live-verified; M6 was
  still open. Recorded in Decided above.
- 2026-07-12 — v1.8: M6 scheduled distillation built through the ordinary
  dispatch/pipeline/ledger path: deterministic zero-token prechecks,
  evidence clustering and dedupe/suppression, candidate/frequency/budget caps,
  daily Distiller, weekly cross-provider Learning Reviewer, structured
  fail-closed verdict persistence, and report-only compaction. Offline
  conformance is complete; no token-spending live calibration run was required
  for this implementation change.
