# TODO — Operon roadmap & session handoff

A fresh session should read `PURPOSE.md` → `AGENTS.md` → this file, then pick
up the top unchecked item. Keep this list current as items land; move finished
items to Done with a date.

## Next up (ordered)

1. [ ] **Architecture / detailed design document** (`docs/architecture.md`) —
   the design layer PURPOSE.md deliberately does not hold. Must cover:
   - **Dispatcher & scheduler** — CLI entrypoint contract for launchd (now) /
     systemd (droplet later); how roles.yaml triggers resolve to invocations;
     locking so overlapping firings don't collide.
   - **Turn lifecycle & state machine** — loop phases in detail; worktree
     create/cleanup; crash recovery: when to resume a SessionHandle vs restart
     clean; idempotency rules so a dead turn never leaves the repo half-done.
   - **Approval surface** — CLI approval queue (decided 2026-07-04): queue
     storage format, list/review-one-by-one mechanics, approve or
     deny-with-reason, persisted audit trail; app-tagged items (single queue
     across apps).
   - **Context assembly** — TASTE layers + role addenda + OKF memory excerpts
     → each harness's native channel (CLAUDE.md / AGENTS.md / pi SYSTEM.md).
     Layers answer different questions (org values / role craft / app
     charter); org "never do" section unoverridable (PURPOSE.md v0.8).
   - **Memory & scorecards** — OKF bundle layout per role (craft, cross-app)
     and per role+app (domain); end-of-turn write; curation pass; scorecard
     schema per (role, app) (escaped bugs, rework rate, edit distance) and
     the weekly retro that consumes it.
   - **Multi-app structure** — app registry; per-app config/TASTE/memory;
     the one-turn-one-app invariant; single app-tagged approval queue;
     per-app cadence + org-level WIP limits (PURPOSE.md v0.8).
   - **Planner co-planning mode** — interactive planning sessions with Bikram
     (a trigger/invocation shape beyond schedule/event; first use: civic
     US-states extension planning).
   - **Bootstrap** — `operon bootstrap` flow (learn repo → questionnaire →
     emit artifacts); `.operon/` layout identical to org-home repo layout so
     extraction is a `git mv`; org-home repo optional (PURPOSE.md v0.8).
   - **GitHub substrate conventions** — labels as the ticket state machine,
     ticket format the Planner emits, PR/branch conventions the loop enforces.
   Promote stable outcomes into PURPOSE.md → Decided; detail stays in the doc.
2. [ ] **ClaudeRuntime adapter** — first real adapter
   (`src/runtime/adapters/claude.ts`, Claude Agent SDK TS). Must pass the
   `test/gate.test.ts` cases end-to-end, including subagent tool calls
   (`canUseTool` is session-wide — verify, don't assume). Wire telemetry.
3. [ ] **`run-role` CLI command** — execute one role turn through the adapter.
   First real task (pilot tasks are the acceptance tests — PURPOSE.md v0.8):
   Planner drafts the US-states extension spec for civic.
4. [ ] **Private GitHub repo** — `gh repo create --private` + push. GitHub is
   the org's source-of-truth substrate; needed before the loop can be real.
5. [ ] **Build loop v1** (`src/loop/loop.ts`) — implement the state machine on
   ClaudeRuntime; run one real, small civic ticket end-to-end
   (build → review → merge).
6. [ ] **Onboard buildstacks.dev as app #2** — create the repo; point the org
   at it via config alone (proves config-not-fork, PURPOSE.md v0.8);
   exercises the SRE/infra path and the approval surface end-to-end
   (droplets, DNS, deploys — all gate-critical). Only after item 5 is solid
   on civic.
7. [ ] **Verify OpenAI model IDs** — replace `gpt-5.5` placeholders in
   roles.yaml, then implement **CodexRuntime** (Codex TypeScript SDK).
   (Also re-verify `claude-sonnet-4-6` against the live API while there —
   newer Sonnets may have shipped.)
8. [ ] **pi gating extension** — TS extension enforcing `GateFn` on pi tool
   events; pass the conformance suite; this unlocks the all-pi profile
   (PURPOSE.md → Decided).
9. [ ] **OKF memory bundles** — per-role + per-(role, app) bundle layout +
   end-of-turn write + curation pass skeleton (`src/org/`).
10. [ ] **Scheduler** — launchd plist(s) invoking the dispatcher. Design first
    in the architecture doc (item 1); remember TCC: repo already lives at
    `~/Build`, keep it there.
11. [ ] **TASTE role addenda** — `taste/<role>.md` where a role needs local
    rules (reviewer checklist, support tone) — only where materially different.

## Open decisions (need Bikram)
- None right now — budget/cadence and the approval channel were decided
  2026-07-04 (PURPOSE.md v0.9). The next ones will surface while writing the
  architecture doc (item 1).

## Bikram's own items
- [ ] Archive the Python claude-loop repo (`~/Documents/Build/claude-loop-teams`) — stated 2026-07-03.

## Done
- 2026-07-04 — Approval channel (CLI queue, one-by-one review, audit trail),
  budget ($1K/month per app, configurable), and cadence (flexi, no
  restrictions) decided — PURPOSE.md v0.9. No open decisions remain before
  the architecture doc.
- 2026-07-04 — Pilots + multi-app posture decided (PURPOSE.md v0.8): civic =
  app #1 with real tasks as roadmap acceptance tests; buildstacks.dev = app #2
  (config-not-fork + SRE/approval proof); one-turn-one-app invariant;
  bootstrap artifact home (`.operon/` in product repo, org-home repo
  optional); TASTE layer semantics (org values / app charter / role craft).
  Resolved "first-app onboarding": civic already at
  `~/Build/Government/AgentSkill-CivicIntelligence`; the org starts operating
  on it at item 3.
- 2026-07-03 — Purpose iterated to v0.6 (all decisions in PURPOSE.md → Status);
  TASTE.md v0; roles.yaml v0 (6 roles, cross-provider builder/reviewer);
  runtime contract + critical-ops gate v0 + conformance seed (16 tests green);
  roles loader; CLI (`roles`, `doctor`); repo scaffolded, git-initialized,
  committed; agent docs added (AGENTS.md, CLAUDE.md stub, this file).
