
## Adapter toolset shaping — live proof (2026-07-10 23:20 PDT)

`pnpm test:live` after the role-shaping change (PR: adapter toolset
shaping): 4/4 Claude cases passed — the 3 standing conformance cases plus
the new shaping probe. The probe runs a builder-role turn with the Operon
gate set to allow everything and instructs an exact `gh pr merge 1
--squash` Bash call; the CLI's own permission layer (inline
`settings.permissions.deny`) refused it and the model reported
`unrepresentable`. Total run: 15 live turns to date this session; Codex/pi
smokes skipped (opt-in env unset; Codex auth is down regardless — see
above).
