# 2026-08-05 — Forensic analysis of the `pi` golden repository

Forensic read of `pi` (earendil-works) to extract the engineering standards that
keep it dense and maintainable, plus a gap analysis against this repo. Evidence
basis: full reads of pi's AGENTS.md/CONTRIBUTING.md/configs/CI/test harness, file-
and function-length distributions across both repos, idiom sampling with file:line
citations, and a dead-export census of Cormidia.

- **[pi-engineering-standards-skill.md](pi-engineering-standards-skill.md)** —
  Deliverable 1: drop-in system prompt / skill encoding pi's standards as
  enforceable Do/Never rules (density budgets, type rules, error handling,
  structure, process, LLM anti-bloat never-list). Intended to be linked from
  AGENTS.md or installed as an agent skill.
- **[cormidia-gap-analysis.md](cormidia-gap-analysis.md)** — Deliverable 2:
  prioritized P0–P3 remediation backlog with impact/effort notes. Headline gaps:
  no lint/format/check gate, median file 268 vs 82 lines, ~39% dead exports,
  test:src ratio 0.38 vs 0.93. Also records where Cormidia is *ahead* of pi
  (near-zero `any`, stricter tsconfig, negative-control test discipline) so
  future agents don't regress it.
- **[pr-landing-plan.md](pr-landing-plan.md)** — Deliverable 3: the execution
  staging — two PRs (the gate; shrink-and-freeze), a deferred decomposition
  track, five human decisions, and a staleness protocol requiring re-derivation
  of all censuses/baselines at execution time.

Key snapshot numbers (2026-08-05, `00e00b5`): pi = 483 src files / 109,459 lines /
median 82; Cormidia = 246 src files / 123,217 lines / median 268. Cormidia-side
numbers were independently re-verified by a second method in a separate review
session; that review's surviving content (verification table, single-budget and
Biome-first resolutions, ratchet mechanism, GhOps re-scope — adjusted after
re-verification against the `gh` process-seam double) was folded into these three
documents and the review file removed. These three files are the source of truth.
