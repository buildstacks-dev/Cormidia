# Audit System Map

Assessment: `20260805T102101Z-58596de4f03a`

The product remains a C2 system with C3 release-assurance control points. This audit
adds no journey, runtime boundary or release target; it verifies the ratified RQ-1
revision over existing lanes.

```text
candidate commit + exact package
              |
              v
working-tree ancestry / evidence-only preflight
              |
              v
sparse exact-candidate clone (forbidden archive absent)
              |
              v
frozen offline install + scripts off + store verify + env scrub
              |
              v
executed Vitest JSON == exact Git test inventory
              |
              v
deterministic-first manifest and subject/producer currency
              |
        +-----+-----+
        |           |
        v           v
 current L3     exact L4 pairs
        |           |
        +-----+-----+
              |
              v
completeness / verdict / qualification
              |
              v
sanitized packet -> evidence-only merge -> attestation
              |
              v
human approval -> annotated tag -> clean exact-tag CI -> npm

future outside RQ-1: HB-072/HB-073/L5 and generic B-17 target
```

| Boundary | Control | I2 result |
| --- | --- | --- |
| Candidate → executed tests | exact sparse clone, frozen dependency graph, environment scrub | verified |
| Test process → deterministic evidence | JSON assertion/file inventory, pinned config, bound skips | verified |
| Repository/package → manifest | Git-object and tarball hashes, closed identity | verified |
| L3/L4 → aggregate | exact target/pairing, truth-preserving completeness/verdict | verified machinery; campaigns unrun |
| Packet → attestation | evidence re-derivation, sanitizer, path/hash/lineage checks | verified |
| Approval → tag | B-17 exact content and actor/approver equality | verified hermetically |
| Tag → npm | clean exact-tag CI and sealed artifact | workflow verified; no release run |
| Merge → protected main | human boundary and exact-tag rerun | known process limitation F-PT-018 |

Import direction remains intact: `src/org` composes lower layers and no presentation
leaf became an authority.
