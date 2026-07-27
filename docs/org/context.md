# Context assembly

*What a provider turn knows and why: the fixed concatenation order, the
authority boundary, memory excerpt selection, governed-concept resolution,
cache-stable assembly, and per-adapter injection channels. Memory content
itself is [`memory.md`](memory.md); the per-pass task payload is the loop's
brief assembler ([`../loop/design.md`](../loop/design.md) §3); the system map
is [`../architecture.md`](../architecture.md) §5.*

Assembly is **concatenation in fixed order** (PURPOSE v0.8 — layers answer
different questions, so conflicts are rare; narrower layers specialize
defaults):

```
[0] effective delegated authority    org AUTHORITY.md, optionally narrowed
                                      by <app>/.operon/AUTHORITY.md
[1] org TASTE.md                      values + engineering constitution
[2] taste/<role>.md                   role craft (when it exists)
[3] <app>/.operon/TASTE.md            product charter (when it exists)
[4] role turn protocol                generated: expected outputs, GitHub
                                      conventions (../loop/github-conventions.md), end-of-turn learning
                                      note instruction, approval etiquette
[5] memory excerpts                   role craft bundle + this app's domain
                                      bundle (memory.md) — capped
```

**Authority and the org's "What we never do" section are unoverridable by
narrower context — but the guarantee is the gate, not prompt order.** App
authority can only inherit, select conservative, or add restrictions; a stale
app snapshot fails closed. Current-task instructions can narrow the grant.
Broader authority requires a fresh, attributable human instruction. Layers
[2]/[3] specializing a never-do rule
would merely be ignored text; the critical-ops gate enforces the same list
mechanically on every tool action. Prompt layering is steering; the gate is
the contract.

**Memory excerpt selection v1: no embeddings.** Include each bundle's
`INDEX.md` (curated one-liners) plus any documents whose frontmatter
`keywords` match the task text; hard cap ~16 KB. Curation ([`memory.md`](memory.md)) keeps bundles
small enough that this stays adequate; retrieval sophistication is earned by
evidence, not assumed.

**Governed concepts resolve ahead of legacy memory** (`docs/learning-loop/`).
When learning is enabled, `resolveLearningContext`
(`src/org/learning/resolver.ts`, wired into `src/org/context.ts`) runs once
per turn as a **pinned resolve** — promotion, disable, or rollback mid-turn
never shifts a running turn's context. Its concept sections fill layer [5]
first, and the legacy keyword selection above spends only the bytes the
concepts leave. In the build loop the pin is per (ticket episode, pipeline
role) via `createEpisodeContextResolver` (`src/org/context.ts`), so build
and fix passes on one ticket share one pin and reviewer-scoped concepts
reach review passes. Every governed resolve persists a pinned record at
`learning/resolved/<turnId>.json` in the state home.

**Cache-stable assembly** (added 2026-07-04, reviewed with the human
operator; economics in `research/2026-07-04_prompt-caching.md`). Provider
prompt caches are org-wide *prefix matches*, not session state: a fresh
session whose rendered prefix is byte-identical to a recent request reads it
at ~0.1× input price, and every read refreshes the TTL — so back-to-back
passes stay warm across the loop's fresh-session-per-pass rule for free.
Two rules protect that:

1. **Layers [0]–[4] are a pure function of (role, app, ratified files).**
   Never embed per-turn bytes — timestamps, turn ids, ticket refs, attempt
   counters. Per-turn facts belong in the task payload (the brief), which
   renders after the stable prefix.
2. **Layer [5] is pinned per resolve and held fixed across its passes** —
   once per role turn, and in the build loop once per (ticket episode,
   pipeline role). Keyword matching runs against the *ticket* text,
   never the per-pass brief — re-selecting per pass would silently change
   the prefix on every pass (and hand the builder and the fix pass
   different lessons; pinning is better for coherence, not just cost).

A model switch between adjacent passes forfeits the whole cache (caches are
model-scoped) — weigh that when tuning per-pass overrides in pipelines.yaml.

**Injection per adapter — native channels only** (docs/PURPOSE.md), nothing
assembled ever lands in a commit:


| Runtime | Channel                                   | Mechanics                                                                                 |
| ------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| claude  | system-prompt append (SDK option)         | no files written                                                                          |
| codex   | App Server `developerInstructions`        | per-thread native instruction field; no worktree overlay required                         |
| pi      | `.pi/APPEND_SYSTEM.md` in worktree        | worktree-local, masked via `.git/info/exclude` (never the repo's `.gitignore`)            |


The assembler produces `ContextBundle.authority` (effective text, profile,
version, SHA-256, and source paths), then layers [1]–[4] in `taste: string[]`
and layer [5] in `memoryExcerpts`. Every pass envelope copies the authority
provenance without duplicating its full prose. Parent delegated-task records
capture the same evidence at `operon task begin`.

This section covers the *system context* a pass runs under. The *task
payload* — ticket, spec excerpts, contract, findings, attempt history — is
the loop's brief assembler (`docs/loop/design.md` §3), a separate, per-pass,
budgeted packet logged verbatim in the run artifact.
