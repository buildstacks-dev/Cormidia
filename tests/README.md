# tests/ — the replacement validation harness

Implementation of the ratified design in `validation-design/` (campaign
cormidia-2026-07-31). `validation-design/validation-policy.yaml` is the contract
(tighten-only); `validation-design/harness-backlog.md` is the build plan;
AGENTS.md → "Validation harness" holds the binding standing rules. This README
covers only what an implementer needs to write or read a test here.

## Layout

| Path | Layer | Runs |
|---|---|---|
| `unit/` | L1 invariant-guardrail + contract-clause tests | every commit (`pnpm test`) |
| `hermetic/` | L2 composition on owned fakes + real temp git/state homes | every commit (`pnpm test`) |
| `fixtures/` | fixture kit + owned doubles (each with self-tests) | self-tests run per commit |
| `policy/` | policy loader + artifact/CI-lane pins | every commit |
| `live/` | L3 opt-in lane (`pnpm test:live`, gated on `CORMIDIA_LIVE=1`) | never per commit |
| `campaign/` | shared durable report + spend/coverage accounting | imported by triggered lanes |
| `eval-runner/` | L4 hand-rolled runner (`pnpm test:eval`, gated on `CORMIDIA_EVAL=1`) | per-site cadence |
| `ops/` | L5 contention, soak collector, and threat-model admission gate | per obligation |

Case families live in specs named for their catalog IDs, e.g.
`hermetic/cf-j04/cf-j04-s.test.ts` asserts family `CF-J04-S`
(`validation-design/case-catalog.md`). Every spec's `describe` block starts
with the family ID so traceability is greppable in both directions.

## Conventions (binding)

1. **Cheapest falsifying layer.** Before writing an L2 case, ask if L1 can
   falsify it; before live, ask if a fake can. L3 exists only for the named
   policy obligations.
2. **Mock across boundaries, never inside.** Fakes sit at the ratified
   boundary seams (B-01…B-17): the `gh` process seam, the adapter runtime
   contract, injected clock, temp org/state homes, real temp git repos.
   Product code under test runs unmodified.
3. **Negative controls.** Every detector family ships at least one test named
   `negative control: …` that seeds the violation (lying fake, seeded
   double-settle, planted tamper) and asserts the detector FIRES. A detector
   that has never fired is an assumption (policy `harness_self_tests`).
4. **No green by absence.** Sweeps assert non-empty walks
   (`fixtures/walk.ts`); skipped/gated work reports incomplete or fails —
   never silently passes. `passWithNoTests` is off.
5. **Synthetic secrets are generated at runtime, never committed.** INV-011
   seeds and any credential-shaped fixture content must be produced by
   `fixtures/synthetic-secret.ts` at test time. The repo itself must stay
   clean under gitleaks with no fixture allowlists.
6. **Decision-register status is binding.** HB-007 items 1–8 and 13 are
   human-ratified/adjusted-ratified and tests assert their exact recorded
   bounds or mechanisms. Items 9–12 remain PROPOSED: tests may collect data,
   but threshold-dependent verdicts stay inconclusive until ratification.
7. **Blocked findings stay blocked.** F-PT-006 / F-PT-008 cells, the
   F-PT-017 provider-terminal enum clause, F-PT-018 merge-blocking enforcement,
   and the B-17-L3 live cell are parked. Do not encode a guess; a spec touching
   an adjacent seam carries a comment naming the block.
8. **Tighten-only.** Never weaken an assertion, widen a tolerance, or delete
   a case to make something pass.

## Fixture kit (stable import surface)

Wave 1+ suites import from these modules only; their self-tests are the API
truth:

- `fixtures/org-home.ts` / `fixtures/state-home.ts` — temp org/state homes
- `fixtures/git-repo.ts` — temp git repo/clone/worktree factory
- `fixtures/clock.ts` — injected clock (skew/rollback/rollover scripting)
- `fixtures/kill-point.ts` — subprocess kill-point harness
- `fixtures/walk.ts` — non-empty-walk assertion
- `fixtures/synthetic-secret.ts` — runtime-generated synthetic secrets
- `fixtures/github-double/` — scripted GitHub double (B-01 failure modes)
- `fixtures/adapters/` — scripted provider adapter doubles (B-02/03/04)

## Spend

Nothing under `unit/`, `hermetic/`, `fixtures/`, or `policy/` may spend a
token or touch the network. `live/` and `eval-runner/` enforce the policy
spend bounds internally and report completeness/verdict per
`validation-policy.yaml → verdict_semantics`.
Spending cases reserve their worst-case allowance before execution. A callback that
throws before reporting trustworthy usage is charged its full reservation, so unknown
partial spend fails conservative rather than silently reopening the ceiling.

## Triggered campaign entry points

These commands do nothing without an explicit opt-in and an absolute reviewed JSON
authorization file. The file pins exact commit, state/policy paths, target identities,
tuples, and ceilings; an environment flag alone cannot widen scope.
Triggered entry additionally requires the canonical policy and every L4 golden input
to be tracked and byte-identical at the authorized HEAD; absolute paths are locators,
not authority to substitute uncommitted evidence.
Every L4 config declares `case_token_reservations` with exactly one
`{case_id,max_output_tokens}` row per selected golden case. The runner refuses missing,
extra, duplicate, or sub-baseline rows and requires `max_tokens` to equal the exact
effective reservation sum across the selected case-attempt assignments.

```bash
CORMIDIA_LIVE=1 CORMIDIA_LIVE_CONFIG=/absolute/live.json pnpm test:live
CORMIDIA_EVAL=1 CORMIDIA_EVAL_CONFIG=/absolute/eval.json pnpm test:eval
CORMIDIA_SOAK=1 CORMIDIA_SOAK_CONFIG=/absolute/soak.json pnpm test:soak -- start
CORMIDIA_SOAK=1 CORMIDIA_SOAK_CONFIG=/absolute/soak.json pnpm test:soak -- checkpoint --id day-1
CORMIDIA_SOAK=1 CORMIDIA_SOAK_CONFIG=/absolute/soak.json pnpm test:soak -- finish
```

Sleep checkpoints add both `--slept-at <ISO>` and `--woke-at <ISO>`. A natural Codex
rotation adds `--rotation-evidence /absolute/evidence.json`; the collector verifies
exact session/checkpoint preservation and never manufactures a rotation. The canonical
schemas and operator procedure are in `docs/qualification/design.md`; alert response is
`docs/qualification/validation-triage.md`.

Every runner writes `<state-home>/validation/campaigns/<campaign-id>/report.json`
before work and after each result. Stopped, missing, or ceiling-exhausted work stays
incomplete/inconclusive. A fully collected proposed-threshold campaign may be complete
as data collection, but its verdict remains inconclusive; pending human references are
likewise inadmissible for a quality pass. L4 currently exits 2 after successful data
collection because its thresholds remain proposed; that is intentional, not a command
failure to normalize away.
