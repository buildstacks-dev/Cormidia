# Claim-to-Evidence Traceability Matrix

Assessment: `20260803T144458Z-f40f12b10680`
Revision: `f6bb61123d2f7e3b74c6b0e93c27367fc3e93003`

| Claim ID | Claim summary | Criticality | Source class | Failure mode / risk | Required evidence | Existing evidence | Added evidence | Result | Independence | Limitations | Finding IDs |
|---|---|---:|---|---|---|---|---|---|---|---|---|
| CLM-209 | Backpressure is healthy; child receipts own terminal measurement and alert lifecycle | C3 | issue/contract | RSK-005 | mixed/fresh-lock/receipt/alert/post-spawn-bookkeeping/uninstall cases | scheduler evidence harness | CF-REG-209 + stopped-state detector | verified | I2 follow-up complete | no real host replay | FND-001, FND-006 |
| CLM-211 | Scheduled PATH/executables are explicit and drift fails closed | C2 | issue/contract | RSK-004 | render/status/doctor/pre-org refusal | B-05/J-16 harness | CF-REG-211 | partially verified | I2 follow-up complete | host exercise unrun | — |
| CLM-228 | No actionable input means zero provider construction | C3 | issue/contract | RSK-003 | role-specific no-op, action control, repeats | B-08 dispatch harness | CF-REG-228 | verified | I2 follow-up complete | deterministic seam only by design | — |
| CLM-229 | Next over-bound action is refused locally without escalation | C3 | issue/contract/PURPOSE | RSK-002 | tool/cost/time/partial settlement/frozen scope | CORE/pipeline harness | CF-REG-229 | verified | I2 follow-up complete | chunked cost limitation; no token dimension | FND-002, FND-004 |
| CLM-230 | Planner gets untriaged input and routine-only readiness | C2 | issue/contract | RSK-006 | intake/parser/guard/readback/golden cases | OP-PLAN/GitHub double | CF-REG-230 + golden cases | partially verified | I2 follow-up complete | real GitHub and #232 pending | — |
| CLM-231 | One due window has one durable identity and bounded explicit retry | C3 | issue/contract | RSK-001 | fake clock, concurrency, crashes, commit boundary, restart, retry, reusable primitive | B-06/B-08/locks/journals | CF-REG-231 + CF-SCHED-CLAIM | verified | I2 follow-up complete | no long real-host soak | FND-003, FND-005 |
| CLM-SCOPE | Frozen safety scope untouched and validation is sensitive/traceable | C3 | human instruction/policy | RSK-007 | exact diff, negative controls, populated suite, CI | validation-policy and case catalog | 44 focused; 912 pass/1 accounted skip; audit package | partially verified | I2 complete; CI pending | changes after target invalidate | FND-001–FND-006 resolved |

## Unmapped evidence

The onboarding smoke and package dry-run are broad repository gates. They map to the merge target and COMP-VAL but not to one defect claim. They are retained as process-control evidence rather than used to prove scheduler semantics.

## Claims without evidence

No merge-scoped deterministic claim lacks evidence. CLM-211 and CLM-230 are intentionally partial because their external L3 seams were not authorized; CLM-SCOPE remains partial only until CI completes.
