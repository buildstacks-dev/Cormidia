# AGENTS.md

## Scope
`src/narrative/**` and `src/cli/narrative.ts` — the human-level causal
timeline (`operon narrative`). Root AGENTS.md rules still apply; this file
adds the local ones.

## Purpose
Presentation-only leaf that captures one story per episode from durable
evidence (runs, ledger, approvals, tickets) and renders it as markdown under
the state home's `narrative/<app>/`. Quotes are captured at write time so
stories survive the 30-day `runs/` sweep. `docs/narrative/design.md` is the
authoritative contract.

## Local rules
- Presentation-only: owns no workflow state, exposes no mutation routes, and
  constructs no provider runtime; capture and render are token-free.
- Read-only over its sources — it never rewrites runs, ledger rows,
  approvals, or ticket state; a corrupt source is quarantined
  (`.json.corrupt`), never repaired in place.
- An empty first render over pre-narrative history is expected behavior, not
  a defect.
- Retention follows `docs/scheduler/design.md` → State retention
  (`narrative/<app>/`, 1825-day window); this leaf never prunes outside its
  own subtree.

## References
`docs/narrative/design.md` · `docs/testing/runbook.md` → Required runs by
changed path
