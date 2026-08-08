# L-ACC run 1 — terminal evidence index

Run 1 reached its ratified plan gate on 2026-08-08 and stopped. This is a
successful terminal campaign outcome under `rubric.md` §6, not a pass: the
overall verdict is `inconclusive`, all three scenarios are `incomplete`, and
`release_signal` is `null`. L-ACC remains outside RQ-1 and this evidence must
not be cited as release evidence.

## Durable report

- Path: `/Users/bikram/Build/l-acc-run-1-20260807/campaign/acceptance/l-acc-run-1/report.json`
- SHA-256: `d0bb9e39bfe7483ced132e228f7e0615378df15192532b2e8a4a98e03c94f200`
- Campaign config SHA-256: `908624d479ad66f5d5a58f3e824929e494eba975ab6f57b6f879547beea34ac3`
- Campaign commit: `e52b304ac8f6a00be973e265b84af8533c59dd72`
- Installed package: `cormidia@0.1.1`
- Tarball: `cormidia-0.1.1.tgz`, SHA-256
  `e2eb2650156d65158242f783560f0eaaa0837ae805b751890ef10f9cb772183a`

The official distribution contains no numeric retained score and therefore no
evidence citation. Every row is `ungraded` / `inconclusive` with one of these
report-owned reasons:

- S-ACC-1: P-1…P-6 and O-1…O-7 — `reconciliation-open`.
- S-ACC-2: P-1…P-6 — `arm-command-failed`; O-1…O-7 — `evidence-missing`.
- S-ACC-3: J-1…J-3 and O-4…O-7 — `evidence-missing`.

The declared-policy gate recorded shortfalls at S-ACC-1/P-1,
S-ACC-1/P-5, S-ACC-2/P-1 and S-ACC-2/P-5. The job arm correctly waited for
the campaign-level app gate and never ran.

## Spend against authorization

| Dimension | Observed | Conservative unknown debit | Total authorization consumed | Ceiling | Remaining |
| --- | ---: | ---: | ---: | ---: | ---: |
| Output tokens | 28,884 | 240,000 | 268,884 | 4,000,000 | 3,731,116 |
| Equivalent USD | $2.0649095 | $45.00 | $47.0649095 | $520.00 | $472.9350905 |

No ceiling was exhausted and no reservation was refused. The unknown debit is
deliberately conservative: the two response-schema failures produced
unavailable telemetry, so each consumed its predeclared failure allowance
rather than being treated as zero.

## Raw observations that did not become report scores

These are diagnostic evidence only. They do not amend the immutable final
report and are not a second grading pass.

- S-ACC-1's mechanical gate inputs were P-1=0, P-2=3, P-3=3 and P-4=2.
- Both S-ACC-1 plan graders completed with valid one-line JSON. P-5 returned 3
  citing `plan-ticket-set` and `repo-state`; P-6 returned 3 citing
  `plan-ticket-set`. The harness parsed the real `run-role` terminal wrapper
  rather than its JSON suffix, so the official rows remained ungraded.
- S-ACC-1 reconciliation included one unavailable turn from the earlier
  pre-report process and could not join it to the new in-memory driver. It
  correctly voided every score under the then-running collector.
- S-ACC-2 failed before model construction because Codex rejected the canonical
  episode-plan schema at `properties.schemaVersion`: the const-only property
  lacked the explicit type required by its strict structured-output dialect.

The deterministic repairs and detectors are recorded in `run-1-todo.md`. They
make future campaigns honest but do not retroactively rewrite this report or
authorize a run-1 retry.
