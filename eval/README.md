# Operon evaluation suite

This tree is the portable, evidence-preserving qualification layer for the
highly efficient organization contract in `docs/efficiency.md`. Ordinary
validation and deterministic execution are token-free. Provider-backed work
is a separate, explicitly enabled, content-hashed, confirmed, and budget-capped
campaign.

## Safety boundary

- Never target the active production org, state home, app checkout, or GitHub
  work.
- Every attempt uses a synthetic home, disposable eval org, immutable app seed,
  managed actor worktree, and verifier tree outside actor-readable paths.
- Hidden graders, answers, reference patches, and mutants never enter prompts,
  context, actor worktrees, environment, or visible Git history.
- GitHub writes require a predeclared private owner and `operon-eval-*` repo.
- No eval publishes, sends, deploys to production, mutates DNS/cloud resources,
  or performs irreversible data operations.
- Every admitted attempt is retained. A retry links to rather than replaces it.

## Commands

- `pnpm test:transformation` checks required contracts and the exact known-red
  set without tokens.
- `pnpm test:transformation:strict` requires no known-red contracts.
- `pnpm eval:validate` validates manifests, fixtures, graders, hashes, and
  hidden-answer separation.
- `pnpm eval:deterministic` runs L0–L3 without providers or external GitHub.
- `pnpm eval:github` is the explicit L4 disposable-GitHub harness.
- `pnpm eval:live -- --campaign <file> --max-usd <n> --confirm <id>` is the
  only provider campaign entrypoint.
- `pnpm eval:qualify -- --campaign <id>` is immutable-evidence-only and cannot
  invoke a provider, reconcile state, or mutate GitHub.
- `pnpm eval:archive -- --campaign <prepared-file> --out <archive-root>` copies
  the complete local evidence bundle and writes a per-file checksum manifest.
- `pnpm eval:cleanup -- --campaign <id>` previews removal of generated
  worktrees/provider scratch. Execution requires `--execute --confirm <id>`;
  manifests, locks, GitHub evidence, attempts, reports, and the GitHub repo are
  always preserved.

Raw attempts, prompts, provider sessions, remotes, and worktrees are local
artifacts and ignored by git. Committed summaries are redacted and hashed.
