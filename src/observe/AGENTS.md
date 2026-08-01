# AGENTS.md

## Scope
`src/observe/**` and `src/cli/observe.ts` — the read-only Live UI
(`operon observe`). Root AGENTS.md rules still apply; this file adds the
local ones.

## Purpose
Presentation-only leaf over durable state and bounded read-only GitHub
polling: versioned projection, URL-stable live/historical session selection,
source health, loopback HTTP/SSE, allowlisted local evidence, embedded
framework-free assets. `docs/live-ui/design.md` is the authoritative contract.

## Local rules
- Presentation-only: owns no workflow state, exposes no mutation routes;
  stopping it never affects a run. It binds only to loopback with a
  per-process capability. The session chooser adds no session store.
- Nothing outside this leaf may import `src/observe` — that is why
  `time-policy.ts` (the ONE timestamp-display policy) lives in `src/report/`.
- Exempt from the hardcoded-default-branch ban (presentation-only leaf);
  every other root Working rule applies unchanged.
- Framework-free: assets are embedded; no new runtime dependencies.

## Testing
Replacement harness (root AGENTS.md → Testing expectations):
`pnpm test && pnpm typecheck`, plus `pnpm build`,
`pnpm smoke:onboarding`, and `npm pack --dry-run` for packaging-visible
changes. The Playwright browser suite is archived with the legacy harness.
The replacement harness covers the deterministic leaf; server tests must use a real
ephemeral loopback port and cover capability/security headers, SSE
replay/resync, corrupt/torn/legacy state, traversal/symlink rejection, and
observer-shutdown independence, and campaign evidence must keep inconclusive/corrupt
states visibly non-green.

## References
`docs/live-ui/design.md`
