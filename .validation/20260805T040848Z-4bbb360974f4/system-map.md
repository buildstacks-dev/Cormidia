# Audit System Map

Assessment: `20260805T040848Z-4bbb360974f4`

This review adds no product journey or runtime boundary. It verifies the ratified
release-assurance path over existing lanes.

```text
candidate commit + exact tarball + immutable manifest
                         |
                         v
 deterministic evidence re-derived and admitted first
                         |
          +--------------+--------------+
          |              |              |
          v              v              v
     L3 reports     L4 exact pairs   L5 threat/soak
          |              |              |
          +--------------+--------------+
                         |
                         v
 completeness / verdict / qualification assessor
                         |
                         v
 exact evidence files re-evaluated from committed packet
                         |
                         v
 evidence-only merge -> canonical post-merge attestation
                         |
                         v
 B-17 human decision -> annotated tag -> exact-tag CI -> npm
                         ^
                         |
         F-PT-021: workflow cannot authenticate B-17 provenance
```

| Boundary | Implemented control | Audit state |
| --- | --- | --- |
| Candidate → manifest | git-object snapshot, clean tracked HEAD, tarball/file hashes | verified offline |
| Evidence → lane result | closed schemas and deterministic evaluators | verified offline |
| Lane result → report | truth table, debt restrictions, subject/producer currency | verified offline |
| Packet → attestation | required evidence files, re-derivation, sanitizer, exact diff | verified offline |
| Approval → tag | B-17 derives approval and uses argument-array git effects | verified hermetically |
| Tag → workflow | envelope/hash/package/Core checks verified | structure verified; provenance blocked F-PT-021 |
| Merge → protected main | human boundary plus CI | mechanical enforcement blocked F-PT-018 |
| L5 → activation | human threat/HB-073/seven-day soak | absent/blocking |

Import direction remains intact: `src/org` composes `src/loop`; runtime imports no
higher layer; presentation leaves did not become authorities.
