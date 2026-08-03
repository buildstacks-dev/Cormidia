# AGENTS.md

## Scope
`src/report/**` and `src/cli/report.ts` — Reporting V1 (`cormidia report`,
Observe `/reports`). Root AGENTS.md rules still apply; this file adds the
local ones.

## Purpose
Pure presentation-only leaf: deterministic ledger-first reporting — UTC
ranges, diagnostic ledger/detail reads, presentation-session grouping,
projections, portable HTML rendering, efficiency/invariant projections, and
the lazy bounded report service. Persists no index or session store.
`docs/reporting/design.md` is the authoritative contract.

## Local rules
- Read-only over durable state; report generation never reconciles or
  mutates anything.
- Hosts `time-policy.ts`, the ONE timestamp-display policy shared with the
  Observer — it lives here because nothing may import `src/observe`.
- Exempt from the hardcoded-default-branch ban (presentation-only leaf);
  every other root Working rule applies unchanged.

## Testing
Replacement harness (root AGENTS.md → Testing expectations):
`pnpm test && pnpm typecheck`, plus `pnpm build`,
`pnpm smoke:onboarding`, and `npm pack --dry-run` for packaging-visible
changes. The browser suite is archived with the legacy harness. The replacement
harness now covers deterministic surfaces and must continue to pin UTC boundaries,
ledger corruption/concurrency, accounting quality and duplicates,
deterministic session identity, budget agreement, CSP/L3 exclusion,
pagination resync, immutable app scope, validation-campaign truth semantics, and
read-only behavior.

## References
`docs/reporting/design.md`
