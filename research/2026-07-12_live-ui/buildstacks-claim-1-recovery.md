# Buildstacks acceptance — claim 1 recovery

- Ticket: `buildstacks-dev/buildstacks.dev#30`
- First claim run: `20260712-094700-build-implement`
- Outcome: returned after `pnpm install --frozen-lockfile` failed with `ENOTFOUND registry.npmjs.org`.
- Recovery check: rerunning the same command in the same Operon-managed worktree completed in 1.1 seconds with 420 packages reused and zero downloaded.
- Interpretation: transient registry/DNS availability, not a repository pipeline failure.
- Triage action: remove only the generated `node_modules` directory, comment the recovery evidence, and change `op:returned` to `op:ready` for the bounded second claim.

The full first-turn error remains durable in the issue comment and run `output.md`; it is intentionally not copied here.
