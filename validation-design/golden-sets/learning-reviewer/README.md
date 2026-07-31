# S-7 Learning Reviewer judge set — STATUS: SCAFFOLD/UNPOPULATED
Cannot support model-swap or qualification evidence yet. Sequenced after S-3
(activation is human-gated; candidates start inert).

Rubric axes (meta-eval): catch rate over seeded candidate classes — good / poisoned /
seductive-but-unsupported / duplicate / authority-widening-if-accepted — · false-
positive rate on good candidates (rejecting every lesson = a safe system that never
learns).
Threshold + N + sample design: **OPEN — F-PT-011** (inconclusive-only until ratified).
Cadence: learning-reviewer prompt/model change; MUST run and ratify before its scores
are admitted anywhere (plan §3) — especially consequential per F-PT-011. Tuple dimensions: learning-reviewer assignment tuple.
Case schema: {id, seeded class, candidate fixture + ground truth, expected verdict,
provenance}.
