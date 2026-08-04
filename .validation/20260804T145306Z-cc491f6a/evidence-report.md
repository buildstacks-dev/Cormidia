# Evidence report

The #181/#154 detector families pass at deterministic layers L1/L2. They prove
shipped and per-app modes, invalid-mode refusal, app isolation, independent
turn/episode/route limits, monotonicity, actual provider construction inputs,
linked-worktree compatibility, and durable effective evidence. Each new family
contains a seeded violation that makes its detector fire.

The routing audit read all 55 open issues in the snapshot, changed no existing
human exclusion, added four conservative `routing:human-only` labels and two
individually justified exact `manual-review` labels, and published eligible,
human-held, technically excluded, blocked, and ambiguous categories. Existing
Planner/Builder deterministic cases prove unreadable current label state stops
before claim/provider work.

Five stale comments were edited in place to retain their historical facts while
recording PR #249 and HB-100 through HB-110 as merged. The HB-111 document
determines the affected surfaces and contains the exact proposed protected diff;
the protected-path query is empty, so no approval-controlled text was applied.

The final full offline run passed 159 test files with 1,031 passing tests and one
intentional skip. Strict TypeScript checking, production build, and
`git diff --check` passed. Origin was fetched again and remained at the assessed
base. No provider-backed, live, eval, soak, publication, deployment,
scheduler-installation, release, or protected-surface action was run.

This evidence is sufficient for the ordinary offline implementation and audit
target, conditional on required GitHub CI. It is not approval to apply HB-111,
not external qualification evidence, and not a release-readiness claim.
