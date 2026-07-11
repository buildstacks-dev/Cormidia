# Handoff — learning loop M1: capture and human review (written 2026-07-11)

Bikram: start a new Claude Code session in `~/Build/Operon` and point it at
this file. Untracked on purpose — don't commit it; delete it when M1 merges.
The durable state also lives in the `learning-loop-design-v0-8` memory.

## State snapshot

- **Design of record:** `docs/learning-loop/` at v0.8, ratified 2026-07-11
  (PR #24; `docs/PURPOSE.md` → Decided → "Learning loop design", L1–L5).
  Read design.md + spec.md before writing code; milestones.md is the plan.
- **Preflight COMPLETE** (all four issues closed today, each squash-merged):
  - #25 / PR #29 — event fan-out: per-role consumption marks
    (`roleConsumedKey`) + dispatcher-tick retirement sweep
    (`EventStore.retireEvent`). Channel-gated subscribers hold events
    pending BY DESIGN. `docs/architecture.md` §2 contract updated.
  - #26 / PR #30 — `TurnEvent` on the journal: dispatch persists the
    triggering event (kind/key/source/payload, 16 KiB byte cap, `::`
    filenames rejected); `protocolBrief` renders it with a provenance
    stamp; `buildContext` appends payload to the memory-selection text.
  - #27 / PR #32 — all three adapters emit `tool_use` via
    `src/runtime/tool-events.ts` (ONE builder + environment-command list).
    Live-verified 6/6, $3.36: `research/2026-07-11_adapter-tool-events.md`.
  - #28 / PR #31 — conformance pins: exactly-once settlement
    (executor+reconcile composed) and heartbeat live-vs-stalled
    (`test/loop/preflight-conformance.test.ts`).
- Suite: 719 offline tests green; main at `3210206`.
- Org pointer: Bikram-Org (`~/.operon/config`). Codex + pi live auth working
  as of today.

## M1 scope (milestones.md → M1 — capture-only; nothing activates)

1. **`LearningEventSink`** writing JSONL under
   `~/.operon/<org>/learning/events/` (spec §4 schema: every event carries
   `episode_id` + episode context fields).
2. **Idempotent capture projector** with a persistent cursor over
   `runs/<app>/<runId>/{envelope.json, events.jsonl}` — gate outcomes from
   L1 `gate_results` / L2 `gate.*`; pass verdicts from L2 `verdict.recorded`
   ONLY (not persisted anywhere else). Same torn-tail-line contract as
   `readEvents`.
3. **End-of-turn protocol redirect** (`src/org/context.ts`): agents emit
   learning notes as candidate input instead of writing active OKF docs
   (design §7.1) — the single largest behavioral change in the design.
4. **Gate rules for ALL protected learning paths** (spec §1 list: bundle,
   manifest, policy.yaml, quarantine, evals, reviews, rejections,
   experiments, interventions + `.operon/learning/**` counterparts) — same
   shape as `scorecard-tamper` in `src/runtime/gate.ts`. Working rule:
   every new gate rule needs `test/gate.test.ts` cases for the critical
   side AND a routine near-miss. `learning/candidates/**` deliberately
   UNPROTECTED.
5. **Retire `runRetroCuration`** (never wired); note its skill-draft idea
   for the M6 distiller.
6. **OKF validator extension**: `validateFrontmatter` (`src/org/memory.ts`)
   must parse/validate/PRESERVE the `loop` block + round-trip test
   (parse → serialize → parse, byte-identical loop block). Today it strips
   unknown fields — deprecateMemoryDoc would destroy governance metadata.
7. **Human review workflow**: `operon learn inspect <episode-id>` /
   `emit --episode` (observation / cause hypothesis / suggested
   intervention kept separate) / `show <id>`. New `src/cli/learn.ts` + one
   registry line in `src/cli.ts` (dispatch-table pattern).
8. **Read-only reports** (`operon learn report`, capture-only sections).

**Done means** (milestones M1): projector idempotent on replay; agent write
into any protected path denied + escalated and end-of-turn no longer
requests memory writes; a human traces two observations by id; round-trip
preserves the `loop` block.

## Working rules that bite here

- One milestone = one ticket = one PR ([[proportionality-over-process]]) —
  but M1 is big; if splitting, split by the numbered items above, file
  issues first (label `learning-loop`).
- `pnpm test && pnpm typecheck` for any src change; smoke:onboarding if
  packaging/CLI discovery changes (new `learn` subcommand → yes, run it).
- The end-of-turn protocol text is agent-facing protocol surface — propose
  the change explicitly in the PR description, never bury it.
- Loop/dispatch behavior changes: exercise against sandbox apps
  (`~/Build/operon-sandbox-*`; delta = Ledgerette).
- Reuse `test/fixtures/orgHome.ts` + `fakeClock.ts`; no ad-hoc mkdtemp.
- Delegated ratification: review + real functional verification, then
  self-merge; block on Bikram only when unavoidable.

## Pointers

- Design: `docs/learning-loop/learning-loop-design.md` (§5 capture, §7.1
  migration, §10.1 human workflow); spec §1 (layout + gate paths), §4
  (event schema), §16 (interfaces, CLI).
- Review feedback that shaped v0.8: `docs/learning-loop/archive/2026-07-10_feedback.md`.
- Open non-learning-loop work: issues #17–#21.
