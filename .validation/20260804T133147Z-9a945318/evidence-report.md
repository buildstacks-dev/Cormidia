# Evidence report

The exact trailing-hyphen regression, deterministic catalog closure, contention
rig, soak collector, and cross-surface projection tests pass. All new detector
families include violations that make their detectors fire.

The final full offline run passed 157 test files with 1,024 passing tests and one
intentional skip. Earlier hardening runs exposed one stale Observe source-count
expectation; that detector was strengthened to require the new
`roadmap_delivery` source. Two subsequent full runs passed before the final
catalog addition, and the final assessed tree passed again.

Strict TypeScript checking, production build, and `git diff --check` pass. The
protected-path query returned no changed protected file. Origin was fetched
again and `origin/main` remained exactly the assessed base.

Evidence is sufficient for the stated offline machinery target. It is not
evidence of human corpus ratification, seven-day soak success, external seam
qualification, release currency, or production readiness.
