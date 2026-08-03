# Prompt caching — economics and design rules

*2026-07-04. Reference behind the cache-stable assembly rules
(`docs/architecture.md` §5) and the TurnUsage / telemetry / conformance
deltas (`docs/loop.md` §9–§10). The numbers here are provider-controlled
(pricing multipliers, TTLs, minimums) — verified against Anthropic's
platform docs 2026-07-04; re-verify at adapter build time
(`docs/loop.md` §12 item 8).*

## Why it matters

Cached and uncached input differ ~10× in price on Anthropic (~2× on
OpenAI), and an agentic pass re-sends its entire growing transcript on
every internal tool round trip — input tokens dominate turn cost by
construction. The classic third-party-agent failure (a cron that wakes a
model every N minutes and re-feeds a long-lived conversation cold) does
not apply to Cormidia: the dispatcher tick spends no tokens, turns fire only
when due, and state lives in artifacts, not chat history. Our exposure is
narrower — feeding the harness *slightly different bytes* each pass, so
the caching it does on our behalf silently stops working.

## Mechanics (Anthropic)

- **Prefix match.** Cache keys are the exact rendered bytes, in order
  `tools → system → messages`. Any byte change invalidates everything
  after it.
- **Org-scoped, not session-bound.** A fresh session whose prefix is
  byte-identical to any recent request reads the warm cache. This is the
  fact that makes the loop's fresh-session-per-pass rule
  (`docs/loop.md` §2) compatible with caching — reuse needs byte-identity
  within the TTL, not a shared session.
- **TTL refreshes on every read.** Default 5 min; optional 1 h. A long
  pass re-reads its prefix on every internal round trip, keeping it warm,
  so the next pass starting seconds later still hits.
- **Model-scoped.** A model switch shares nothing.
- **Minimum cacheable prefix**: ~4096 tokens on Opus 4.8, ~2048 on
  Sonnet 4.6 — the assembled context clears this easily.
- **Pricing**: reads ~0.1× input price; writes 1.25× (5 min TTL) or 2×
  (1 h TTL). Break-even: 2 requests at 5 min; ≥3 reads inside the hour
  at 1 h.
- **Invalidation tiers**: tool-definition or model changes rebuild
  everything; system-prompt changes keep the tools cache; message-tail
  changes keep tools + system.

## Mechanics (OpenAI — builder/SRE seats)

Prefix caching is automatic (no markers): ~50% discount on cached input,
prompts above a ~1k-token minimum, retention on the scale of minutes.
Numbers not re-verified against current OpenAI docs — check at Codex
adapter build time. The design rule is identical either way: stable bytes
first, volatile bytes last.

## Where Cormidia's input tokens actually go

1. **Within a pass** (dominant). The harness (Claude Code via the Agent
   SDK; Codex) owns cache placement here and does it well. Our only job
   is to not hand it varying bytes.
2. **Across passes in one pipeline execution.** Fresh sessions, but
   back-to-back within the TTL: the shared prefix (harness prompt → tools
   → context layers [1]–[4]) reads at ~0.1× **iff byte-identical**.
3. **Across turns hours apart** (Planner daily, SRE hourly, Support 4 h).
   Beyond any TTL — caching cannot help. The levers are context diet (the
   ~16 KB memory cap; lean TASTE layers) and not starting turns that have
   nothing to do (cheap preconditions on scheduled sweeps).

## Design rules (recorded in the design docs)

1. Context layers [1]–[4] are a pure function of (role, app, ratified
   files) — no per-turn bytes (`docs/architecture.md` §5).
2. Memory excerpts (layer [5]) are selected once per pipeline execution,
   keyed off the ticket text, fixed across passes (`docs/architecture.md`
   §5, `docs/loop.md` §3).
3. `TurnUsage` splits input into uncached / cache-write / cache-read and
   cost uses three-bucket pricing (`docs/loop.md` §10) — a flat input
   rate would misprice healthy passes ~5–10× and fire the per-turn budget
   abort wrongly.
4. Conformance case per adapter: two back-to-back passes with identical
   (role, app) context ⇒ `cacheReadTokens > 0` on the second
   (`docs/loop.md` §10).
5. `cold_cache` anomaly detector (`docs/loop.md` §9) — zero cache reads
   on a pass whose predecessor ran within the TTL means a silent
   invalidator shipped.

## Silent invalidators to grep for

| Pattern | Effect |
| --- | --- |
| timestamp / date in the generated role protocol (layer [4]) | invalidates layer [5] + all messages, every turn |
| turn id / ticket ref / attempt counter in layers [1]–[4] | same |
| non-deterministic serialization (unsorted keys, set iteration) in generated context | prefix bytes differ run to run |
| re-selecting memory excerpts per pass | cache miss from layer [5] onward, every pass |
| per-pass model switch within a pipeline | full cache forfeit between those passes |
| conditional context sections toggled per turn | one distinct prefix per flag combination |

## What we deliberately do NOT do

- **Reuse sessions across passes to "save cache".** Fresh-session-per-pass
  buys crash recovery, reproducibility, and no context rot; prefix
  matching provides the cache reuse anyway.
- **Default to the 1 h TTL.** Writes cost 2× vs 1.25×; it pays only with
  ≥3 reads inside the hour. Back-to-back passes stay warm at 5 min via
  refresh-on-read; turns hours apart exceed 1 h anyway. (This matches
  Anthropic's own selective rollout of 1 h caching — it is not a blanket
  win.)
- **Pre-warm.** Pre-warming trades a cache write now for first-request
  latency later — a user-facing-chat concern; Cormidia is background work.

## Verifying

Every Anthropic response reports `cache_read_input_tokens`,
`cache_creation_input_tokens`, and `input_tokens` (the uncached
remainder); the total prompt is the sum. If cache reads are zero across
requests with identical intended prefixes, diff the rendered bytes of two
requests — an invalidator is at work. This flows into L1/telemetry via
the TurnUsage delta and is enforced mechanically by the conformance case.

## Sources

- Anthropic prompt-caching docs
  (platform.claude.com/docs/en/build-with-claude/prompt-caching),
  read 2026-07-04.
- Claude Agent SDK — harness-owned breakpoints; TTL knobs to verify at
  adapter build time (`docs/loop.md` §12 item 8).
- OpenAI prompt-caching docs — to re-verify at Codex adapter build time.
