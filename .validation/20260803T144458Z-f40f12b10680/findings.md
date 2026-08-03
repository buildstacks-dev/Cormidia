# Findings

Assessment: `20260803T144458Z-f40f12b10680`
Revision: `f6bb61123d2f7e3b74c6b0e93c27367fc3e93003`

## Summary

| Severity | Open | Resolved | Accepted | Deferred |
|---|---:|---:|---:|---:|
| BLOCKER | 0 | 0 | 0 | 0 |
| HIGH | 0 | 2 | 0 | 0 |
| MEDIUM | 0 | 4 | 0 | 0 |
| LOW | 0 | 0 | 0 | 0 |

### FND-001 — Non-executed scheduler decisions could falsely resolve a prior failure

- Severity: `MEDIUM`
- Status: `resolved`
- Affected claims: `CLM-209`
- Affected components: `COMP-SCHED`
- Observation: fresh-context review showed that `blocked` and `skipped` decisions followed the same alert-resolution path as an executed child receipt.
- Consequence: healthy backpressure could erase evidence of an unresolved child failure without proving recovery.
- Remediation: alert resolution now occurs only for `executed`; failed/missed outcomes still create alerts.
- Regression evidence: CF-REG-209 inserts a blocked decision between failure and success and requires the alert to remain unresolved until actual execution succeeds.
- Verification: 44/44 focused cases, 912 pass/1 accounted skip, strict typecheck/build, and I2 follow-up.

### FND-002 — Zero active-time allowance still constructed the provider

- Severity: `HIGH`
- Status: `resolved`
- Affected claims: `CLM-229`
- Affected components: `COMP-BUDGET`
- Observation: the active-time cap was clamped to one millisecond, permitting runtime construction when the effective remaining allowance was zero.
- Consequence: a provider step could begin after the authorized time bound was already exhausted.
- Remediation: zero remains zero and returns a typed local hard-budget stop before runtime factory or provider-step construction.
- Regression evidence: CF-REG-229 sets `active_time_ms: 0` and asserts zero runtime-factory calls, zero actions, typed envelope evidence, and no settlement.
- Verification: 44/44 focused cases, full suite, and I2 follow-up.

### FND-003 — Crash after schedule journal but before claim commit wedged the due window

- Severity: `HIGH`
- Status: `resolved`
- Affected claims: `CLM-231`
- Affected components: `COMP-SCHED`
- Observation: stale-lock recovery terminalized an `assembling` journal even when the matching durable schedule claim was still pre-commit.
- Consequence: the due window remained claimed but could no longer reach commit/spawn or bounded recovery.
- Remediation: a dead pre-commit schedule journal releases only its process lock; the next tick reclaims the same settlement identity and attempt, rewrites `assembling`, commits, and spawns once.
- Regression evidence: CF-REG-231 crashes at `after_tick_journal`, restarts with dead-owner probes, and requires one committed attempt and one spawn.
- Verification: 44/44 focused cases, full suite, and I2 follow-up.

### FND-004 — Native terminal provider budget caps lacked central stop evidence

- Severity: `MEDIUM`
- Status: `resolved`
- Affected claims: `CLM-229`
- Affected components: `COMP-BUDGET`
- Observation: a terminal `error_max_budget_usd` result was normalized without first observing its final usage centrally.
- Consequence: the run could omit the central `budget_stop`/`error_turn_budget_exhausted` evidence used by downstream accounting.
- Remediation: terminal native-cap results observe final usage before normalization, preserving measured overshoot and settlement.
- Regression evidence: CF-REG-229 returns a native terminal cap at $5.40 against $5.00 and requires central typed stop evidence plus the exact measured settlement.
- Verification: 44/44 focused cases, full suite, and I2 follow-up.

### FND-005 — Durable claims permitted settlement before commit

- Severity: `MEDIUM`
- Status: `resolved`
- Affected claims: `CLM-231`
- Affected components: `COMP-SCHED`
- Observation: the reusable claim primitive accepted `settle` while a record was only `claimed`.
- Consequence: callers could collapse the intended `claim -> commit -> settle` recovery boundary.
- Remediation: settlement now rejects every non-committed, non-idempotently-settled record.
- Regression evidence: CF-SCHED-CLAIM asserts refusal and includes a seeded forged-claimed-record negative control.
- Verification: 44/44 focused cases, full suite, and I2 follow-up.

### FND-006 — Post-spawn bookkeeping failure crossed the terminal receipt boundary

- Severity: `MEDIUM`
- Status: `resolved`
- Affected claims: `CLM-209`
- Affected components: `COMP-SCHED`
- Observation: after a successful child spawn, a schedule/event bookkeeping exception terminalized the decision as `executed` before a child receipt existed.
- Consequence: the synthetic execution could clear a prior child-failure alert and report terminal state with null provider/settlement denominators.
- Remediation: the error is now recorded as structured `post_spawn_bookkeeping_failure` detail on the still-pending `spawned` decision; only the later child receipt may terminalize and resolve matching alerts.
- Regression evidence: CF-REG-209 deterministically injects the bookkeeping fault, requires the child to remain pending, and preserves a prior unresolved alert; a seeded old-style terminal record fires the receipt-boundary detector.
- Verification: 44/44 focused cases, 912 pass/1 accounted skip, strict typecheck/build, and I2 follow-up.

## Deferred scope, not findings

- #232 owns general ambiguous Planner publication recovery.
- #230 remains open for disposable real-GitHub qualification.
- Scheduler activation and live/eval/soak remain separately authorized.
