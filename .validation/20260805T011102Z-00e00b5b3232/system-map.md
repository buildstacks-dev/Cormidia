# Audit System Map

Assessment: `20260805T011102Z-00e00b5b3232`

This audit reuses the ratified product system map. It adds no product boundary. The
reviewed change is the release-assurance path that consumes existing validation lanes.

```text
exact candidate bytes + immutable release manifest
                        |
                        v
            deterministic-first admission
             L1/L2 + build + pack + CI
                        |
                        v
       +----------------+----------------+
       |                |                |
       v                v                v
   L3 live seams    L4 site/pairing   L5 threat/soak
   real adapters    quality evidence  long-horizon evidence
       |                |                |
       +----------------+----------------+
                        |
                        v
          completeness + verdict assessor
                        |
              evaluator-debt boundary
                        |
                        v
     canonical evidence packet + release attestation
                        |
              separate human approval
                        |
                        v
           B-17 tag -> verify -> npm publish
```

## Trust boundaries and authorities

| Boundary | Input authority | Required control | Current state |
| --- | --- | --- | --- |
| Candidate to assessor | Git/package bytes | canonical manifest and subject digest | missing |
| Deterministic harness | repository/CI | nonempty inventory, exact SHA, negative controls | implemented foundation; no release aggregation |
| L3 external seams | authorized sandbox config | reviewed absolute config, ceiling, immutable report | implemented collector; release evidence unrun |
| L4 stochastic evidence | cases, tuples, references | exact pairing, admitted reference/judge, paired report | partial collector; quality assessor missing |
| L5 adversarial/temporal | human threat model and soak config | human authorship/review, HB-073, complete soak | blocked/unrun |
| Evidence to release | packet and approval | currency, equivalence, attestation, exact action | missing |
| Merge enforcement | GitHub plan/API | required-check policy | blocked by F-PT-018 |

## Critical control points

- T-1/T-2: manifest input closure and candidate/package identity.
- T-3/T-4: deterministic admission and campaign authorization before spend.
- T-5/T-6: exact site/pairing collection, reference and judge admission.
- T-7/T-8: completeness, verdict, retry, and conservative spend settlement.
- T-9/T-10: evidence currency, sanitization, and attestation.
- T-11/T-12: separate release approval and exact-tag publication/acknowledgement.

## Import direction

The proposed assessor composes existing package/CLI/org surfaces. It must not cause
`src/runtime` to import `src/loop` or `src/org`, nor turn presentation leaves into
authorities. Schemas and pure verification should live at the lowest honest layer;
orchestration and durable release handoff remain above runtime.
