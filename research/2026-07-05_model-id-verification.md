# Model-ID verification — roles.yaml proposal basis

*2026-07-05. Executes TODO M1.1: verify real OpenAI IDs behind the `gpt-5.5`
placeholders and re-verify Anthropic IDs against the live catalog. Feeds the
roles.yaml proposal PR (human-ratified; never self-merged).*

## Verdict per role

| Role | roles.yaml today | Verified status (2026-07-05) | Proposed |
| --- | --- | --- | --- |
| planner | `claude-opus-4-8` | **Valid, current.** $5/$25 per MTok, 1M ctx. [1] | keep |
| builder | `gpt-5.5` (marked PLACEHOLDER) | `gpt-5.5` **is now a real ID** (released 2026-04-23; snapshot `gpt-5.5-2026-04-23`) — but it is OpenAI's *flagship* at $5/$30 per MTok [2], which contradicts the role's stated mid-tier intent. | `gpt-5.4` |
| reviewer | `claude-opus-4-8` | **Valid, current.** [1] | keep |
| sre | `gpt-5.5` (marked PLACEHOLDER) | same as builder | `gpt-5.4` |
| support | `claude-sonnet-4-6` | **Valid but now legacy-tier.** Moved to the "Legacy models" table; $3/$15. Successor `claude-sonnet-5` is current at the same $3/$15 list price with **intro $2/$10 through 2026-08-31**, Jan-2026 knowledge cutoff. [1] | `claude-sonnet-5` |
| marketing | `claude-sonnet-4-6` | same as support | `claude-sonnet-5` |

## Facts and reasoning

**Anthropic** (source: [platform.claude.com models overview][1], fetched
2026-07-05):
- Current tier: `claude-fable-5` ($10/$50), `claude-opus-4-8` ($5/$25),
  `claude-sonnet-5` ($3/$15; intro $2/$10 through 2026-08-31),
  `claude-haiku-4-5` ($1/$5).
- `claude-sonnet-4-6` remains active but is listed under Legacy models with a
  "consider migrating" note. Upgrading support/marketing to `claude-sonnet-5`
  is strictly better on the roles' own criteria (strong prose at volume,
  cheap tier): same list price, currently cheaper, newer knowledge cutoff
  (Jan 2026 vs Aug 2025), current-tier support horizon.
- Not proposing `claude-fable-5` for planner/reviewer: 2× Opus pricing, and
  roles.yaml's `claude-opus-4-8` is the recommended default for complex
  agentic work per the same page. Revisit if pilot review quality demands it.

**OpenAI** (sources: [API models docs][2] fetched 2026-07-05,
[Codex models page][3] 2026-07-05):
- Current API line: `gpt-5.5` (flagship, $5/$30, 1M ctx, 128K out),
  `gpt-5.4` ($2.50/$15, 1M ctx), `gpt-5.4-mini` ($0.75/$4.50 — "strongest
  mini model yet for coding, computer use, and subagents"), `gpt-5.4-nano`.
  Dated snapshots exist (`gpt-5.5-2026-04-23`, `gpt-5.4-2026-03-05`); we use
  aliases, consistent with the Anthropic entries.
- `gpt-5.5` is the **default model in Codex CLI** since 2026-04-23, but is
  documented as available in Codex **only with ChatGPT-account auth — not
  API-key auth — at this time** [3]. Our CodexRuntime drives a local
  `codex app-server`, which inherits the CLI's login, so this mirrors the
  Claude-side subscription-first auth decision rather than blocking us; still,
  it is a constraint to re-verify when M10 wires the adapter.
- The old codex-tuned model family (`gpt-5.x-codex`) is being sunset
  (June–July 2026 deprecations per the [Codex changelog][4]); the coding line
  has converged on mainline `gpt-5.5`/`gpt-5.4`. **Do not wire any
  `-codex`-suffixed model ID.**
- **Builder choice.** roles.yaml's design is explicit: "most tokens burn
  here → mid-tier, quality recovered by the Reviewer gate, not by paying
  frontier rates on every build token." `gpt-5.4` is the mid-tier ($2.50/$15
  — half of `gpt-5.5` in, half out); the coincidence that Bikram's
  placeholder name became the real flagship ID does not make it the right
  economic choice. Flagged in the PR: if the org later prefers
  quality-over-cost for builds, `gpt-5.5` is the one-line swap.
- **SRE choice.** Same mid-tier logic (`gpt-5.4`), with `gpt-5.4-mini` noted
  as the economy fallback if hourly health sweeps dominate spend — OpenAI
  positions mini exactly for "lighter coding tasks or subagents."

## Sources

[1]: https://platform.claude.com/docs/en/about-claude/models/overview.md "Anthropic models overview (fetched 2026-07-05)"
[2]: https://developers.openai.com/api/docs/models "OpenAI API models (fetched 2026-07-05)"
[3]: https://developers.openai.com/codex/models "Codex models (2026-07-05)"
[4]: https://developers.openai.com/codex/changelog "Codex changelog (2026-07-05)"

- Anthropic models overview — https://platform.claude.com/docs/en/about-claude/models/overview.md (fetched 2026-07-05)
- OpenAI API models — https://developers.openai.com/api/docs/models (fetched 2026-07-05)
- Codex models (auth caveat, CLI default) — https://developers.openai.com/codex/models (2026-07-05)
- Codex changelog (codex-model sunset) — https://developers.openai.com/codex/changelog (2026-07-05)
