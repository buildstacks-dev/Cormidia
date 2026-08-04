# Traceability matrix

| Requirement | Contract/catalog anchors | Detector and negative control | Result |
| --- | --- | --- | --- |
| Reliable approval-journal filenames | CF-REG-251, INV-013 seam | `cf-j12-i.test.ts`: raw trailing-hyphen path fails, normalized path round-trips | Pass |
| Deterministic family closure | J03/J04/J20, B20–B22, INV-001/016, CF-C-*, CF-IF-XSURF | HB-108 catalog closure walk, missing-marker seed, and pin-drift seed | Pass |
| Pre-tuning corpora | S-1 Planner, S-10 Validation Designer | Real corpus load plus missing-sub-site seed | Pass; human review pending |
| Contention safety | OP-batching, B-22, INV-001/016 | Contention rig violations for overlap, duplicates, rollback, settlement, siblings, stale frontier | Pass |
| Soak evidence machinery | CF-OPS-SOAK | Summary consistency violations for completion/success/cache/recovery denominators | Pass; campaign unrun |
| Explanation surfaces | B-20/B-21/B-22, CF-IF-XSURF | Exact deep equality plus corrupt Roadmap pointer and corrupt disposition seeds | Pass |
| Repository conformance | Root testing expectations | Full offline suite, typecheck, build, diff check | Pass |
