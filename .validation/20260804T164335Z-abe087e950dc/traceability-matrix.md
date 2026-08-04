# Claim-to-Evidence Traceability Matrix

Assessment: `20260804T164335Z-abe087e950dc`

| Claim | Criticality | Failure mode | Required evidence | Existing/added evidence | Result | Independence | Limitation/finding |
|---|---:|---|---|---|---|---|---|
| CLM-ISO | C3 | operator checkout changed; read-only branch manufactured | real local Git + negative assertion | CF-REG-232 worktree test | verified offline | I1 | real remote unrun / FND-005 |
| CLM-EXACTLY-ONCE | C3 | false completion, duplicate push/provider, conflict overwrite | fault matrix + concurrency + state oracle | CF-REG-232 crash/lost-ack/duplicate/concurrent/conflict/refusal cases | verified offline | I1 | external auth/network unrun / FND-005 |
| CLM-INTAKE | C3 | ready-only circularity; truncated source called complete | boundary cases + seeded controls + pre-provider wiring | CF-REG-230 eight cases and production lifecycle detector | verified offline | I1 | disposable GitHub unrun / FND-005 |
| CLM-LIFECYCLE | C3 | helpers not connected to production scheduler/delivery | L2 composition + production source detector | CF-REG-232 authority assertions, HB-103/105 roadmap migration, lifecycle wiring | verified offline | I1 | live org unrun / FND-005 |
| CLM-PUBLICATION-SAFETY | C3 | wrong origin or credential/protected bytes pushed | registered-origin comparison + canonical scanner + refusal seeds | CF-REG-232 real-Git origin/secret seeds; existing CF-INV-011 policy-source suite | verified offline | I1 | none |
| CLM-OBSERVABILITY | C2 | operator misses pending recovery | schema/source detector and rendered behavior | CF-REG-232 status JSON/narrative Markdown assertions plus lifecycle wiring | verified offline | I1 | no independent usability review |
| CLM-EXTERNAL | C3 | fake/local evidence disagrees with GitHub/live org | CF-B01-L3 + one bounded sandbox Planner turn | exact plan in `docs/qualification/planner-publication-qualification.md` | not verified | I0 | FND-005 |

## Defect and contract traceability

- `validation-design/case-catalog.md` maps CF-REG-230 and CF-REG-232 to
  CF-J03-I/RC, CF-INV-003/008/011/012/013/014/016, B-01/B-14/B-15/B-20/B-21/B-22,
  and C-OP-PLAN/VALIDATION/BATCH without adding new structural rows.
- #232 acceptance maps directly to CF-REG-232: isolated/read-only worktree,
  commit-before-push recovery, lost acknowledgement, duplicate/concurrent
  resume, conflict, permanent refusal, operator-byte oracle, status/narrative,
  and seeded completed-before-publication control.
- #230 deterministic acceptance maps to CF-REG-230 plus the production wiring
  detector. Its disposable-repository criterion maps only to CLM-EXTERNAL and
  remains not verified.

## Unmapped evidence

No gate result is used as generic confidence only: full-suite/typecheck/build/
diff-check support all deterministic claims but do not replace their focused
detectors.

## Claims without evidence

`CLM-EXTERNAL` has a bounded plan but no executed evidence. This is an explicit
qualification blocker, not an offline test failure.
