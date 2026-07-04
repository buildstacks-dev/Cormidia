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
   - **Approval surface** — how gate escalations reach Bikram (channel TBD,
     see Open decisions), approve/deny mechanics, audit trail of decisions.
   - **Context assembly** — TASTE layers + role addenda + OKF memory excerpts
     → each harness's native channel (CLAUDE.md / AGENTS.md / pi SYSTEM.md).
   - **Memory & scorecards** — OKF bundle layout per role; end-of-turn write;
     curation pass; scorecard schema (escaped bugs, rework rate, edit distance)
     and the weekly retro that consumes it.
   - **GitHub substrate conventions** — labels as the ticket state machine,
     ticket format the Planner emits, PR/branch conventions the loop enforces.
   Promote stable outcomes into PURPOSE.md → Decided; detail stays in the doc.
2. [ ] **ClaudeRuntime adapter** — first real adapter
   (`src/runtime/adapters/claude.ts`, Claude Agent SDK TS). Must pass the
   `test/gate.test.ts` cases end-to-end, including subagent tool calls
   (`canUseTool` is session-wide — verify, don't assume). Wire telemetry.
3. [ ] **`run-role` CLI command** — execute one role turn through the adapter;
   Planner on a toy task is the natural smoke test.
4. [ ] **Private GitHub repo** — `gh repo create --private` + push. GitHub is
   the org's source-of-truth substrate; needed before the loop can be real.
5. [ ] **Build loop v1** (`src/loop/loop.ts`) — implement the state machine on
   ClaudeRuntime; run one toy ticket end-to-end (build → review → merge).
6. [ ] **Verify OpenAI model IDs** — replace `gpt-5.5` placeholders in
   roles.yaml, then implement **CodexRuntime** (Codex TypeScript SDK).
7. [ ] **pi gating extension** — TS extension enforcing `GateFn` on pi tool
   events; pass the conformance suite; this unlocks the all-pi profile
   (PURPOSE.md → Decided).
8. [ ] **OKF memory bundles** — per-role bundle layout + end-of-turn write +
   curation pass skeleton (`src/org/`).
9. [ ] **Scheduler** — launchd plist(s) invoking the dispatcher. Design first
   in the architecture doc (item 1); remember TCC: repo already lives at
   `~/Build`, keep it there.
10. [ ] **TASTE role addenda** — `taste/<role>.md` where a role needs local
    rules (reviewer checklist, support tone) — only where materially different.

## Open decisions (need Bikram)
- **Budget & cadence** — monthly model spend target; how often the org "comes
  to work" (PURPOSE.md open question #1).
- **Approval channel** — how gate escalations reach you: push notification,
  email, or a CLI approval queue. Blocks the approval-surface design in item 1.
- **First-app onboarding** — when to clone `AgentSkill-CivicIntelligence`
  under `~/Build/` as the target repo the org operates on.

## Bikram's own items
- [ ] Archive the Python claude-loop repo (`~/Documents/Build/claude-loop-teams`) — stated 2026-07-03.

## Done
- 2026-07-03 — Purpose iterated to v0.6 (all decisions in PURPOSE.md → Status);
  TASTE.md v0; roles.yaml v0 (6 roles, cross-provider builder/reviewer);
  runtime contract + critical-ops gate v0 + conformance seed (16 tests green);
  roles loader; CLI (`roles`, `doctor`); repo scaffolded, git-initialized,
  committed; agent docs added (AGENTS.md, CLAUDE.md stub, this file).
