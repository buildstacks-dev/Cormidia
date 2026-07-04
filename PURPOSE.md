# PURPOSE — Operon

*Draft v0.5 — 2026-07-03. Living document; iterate freely.*

## One-liner

A reusable **org runtime**: a standing team of AI agents (planner, builder,
reviewer, SRE, support) that develops and operates a software product,
coordinated through a private GitHub repo as the source of truth, with a human
approver gating critical operations only.

**Operon is a library, not an app.** It is pointed at a target repo via
config; it never contains app code. One org runtime, N applications.

## Pilot applications

Two pilots, onboarded **sequentially**, chosen to stress complementary halves
of the org (decided 2026-07-04):

1. **Civic Intelligence / Responsible Citizen**
   (`~/Build/Government/AgentSkill-CivicIntelligence`) — the civic-evidence
   layer over authoritative public sources. App #1: drives the build-loop
   milestones — Planner → Builder → Reviewer on real tickets (first up:
   extending coverage to more US states).
2. **buildstacks.dev** (repo to be created) — Bikram's personal portfolio
   umbrella site. App #2, onboarded only after loop v1 is solid on civic. Its
   job: prove "second app = config file, not a fork" and exercise the
   SRE/infra surface — droplet provisioning, DNS, GitHub repo creation,
   deploys — where nearly every op is gate-critical by design, forcing the
   approval surface to become real.

The org operates on each app the way claude-loop operates on any target repo.
The architecture must generalize: pointing the org at a second app is a
config file, not a fork — buildstacks.dev exists to prove it.

## The org chart

| Role | Responsibility |
| --- | --- |
| **Planner / PM agent** | Ideation, synthesizing input (including support feedback), prioritizing, writing tickets |
| **Builder agent** | Implements tickets — writes the actual code |
| **Reviewer agent** | Independent code review; deliberately a *separate* agent from the builder |
| **SRE agent** | Infrastructure, scaffolding, CI/CD, deploys; attends to operational issues |
| **Support agent** | Watches forums / tickets / feedback channels; consolidates feedback, responds to queries, feeds themes back to the Planner |
| **Marketing agent** | Positioning, changelogs, launch notes, content drafts; watches adoption signals and feeds them to the Planner |
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

## Decided

- **Build, don't buy — TypeScript orchestrator, claude-loop reborn.** Ground-up
  rewrite in TypeScript (strict mode) porting claude-loop's proven patterns
  (state-in-markdown, roles.yaml, worktrees, squash-merge discipline). No
  multi-agent framework. **Operon supersedes claude-loop outright** —
  claude-loop has no users, so the Python repo is frozen as pattern reference
  with no back-compat obligation. TS over Python because: pi (and our mandatory
  gating extension) is TS anyway; all three runtimes have first-class TS SDKs;
  matches the house convention (tastytrade-tools, kalshi-tools).
- **Runtime layer — three adapters, one interface, all in-process** (see
  `research/2026-07-03_runtime-layer.md`):
  - **Anthropic roles** → Claude Agent SDK (TypeScript; hooks + `canUseTool`
    for the critical-ops gate)
  - **OpenAI roles** → Codex app-server via the official Codex TypeScript SDK
    (JSON-RPC; per-thread model, approvals, sandbox modes)
  - **All other models** → **pi** embedded via its SDK
    (`createAgentSession()`); SYSTEM.md + extensions for protocol enforcement.
    Known work item: pi has no first-class approval flow — we write the gating
    extension.
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
- **Pilot tasks are the acceptance tests** (2026-07-04). Roadmap "toy task"
  smoke tests are replaced by real, small civic tasks: the Planner's first
  real turn drafts the US-states extension spec; loop v1's first end-to-end
  ticket is a real one-file civic change. buildstacks.dev enters only after
  loop v1 works on civic. Two pilots, one at a time per milestone — never
  parallel builds.
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
- **Bootstrap & artifact home** (2026-07-04). `operon bootstrap` runs inside
  the product repo: learns the repo, walks an alignment questionnaire with
  the user, emits artifacts. Default (single-app profile): everything stays
  in the product repo's own git — `.operon/` (constitution + config,
  committed), `.operon/memory/` (curated OKF bundles, committed); high-churn
  operational state (sessions, telemetry, raw logs) lives gitignored in
  `~/.operon/<org>/`. An **org-home repo is optional, never required** — a
  graduation move for multi-app orgs; `bootstrap` in a second repo detects
  and joins an existing org. Org-level artifacts use the identical on-disk
  layout inside `.operon/` and at an org-home repo root, so extraction later
  is a `git mv`, not a migration. Dogfood note: this library repo doubles as
  our own org home for now; the root `roles.yaml` / `TASTE.md` are instance
  config destined to become bootstrap templates — don't harden the
  conflation.
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

## Prior art (ours)

**claude-loop** (`~/Documents/Build/claude-loop-teams`) already proved the core
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

## The hard parts (acknowledged up front)

- **Scheduling** — when and how often each agent runs (cron? event-driven off
  repo activity? both?).
- **Failure & recovery** — what happens when a run dies mid-task; retries,
  idempotency, not leaving the repo in a half-done state.
- **Long-term memory** — each role accumulates knowledge across runs; where it
  lives, how it's curated, how it stays trustworthy. (claude-loop's "no memory"
  stance was a feature at batch scale; a standing org needs the opposite.)
- **Human-in-the-loop mechanics** — how a critical-op approval is requested,
  surfaced (notification?), and granted.

## Open questions

1. **Role → runtime/model assignment v1** — fill in `roles.yaml`: which model,
   effort level, and delegation policy each of Planner, Builder, Reviewer, SRE,
   Support gets at launch.

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
  decided (`.operon/` in the product repo; org-home repo optional). TASTE
  layer semantics clarified (org values / app charter / role craft).
- 2026-07-04 — v0.9: approval channel decided — CLI queue, reviewed one by
  one, persisted audit trail. Budget decided — $1,000/month per app,
  configurable per app. Cadence decided — flexi, no restrictions. Open
  question #1 (budget & cadence) closed.
