# Known issues

UX gaps that are real today but not yet in the GitHub issue tracker — file
them there and delete this file when they land. New defects go straight to
the tracker; the historical backlog is in this file's git history, and the
systemic analysis is `docs/proportionality-review.md`. Already tracked:
the Codex App-Server read bypass (issue #20), the Codex-home-only skill
link (issue #53), and `pass.heartbeat` (issue #54).

## Interactive co-planning (`operon plan <app>` without `--auto`)

Two gaps in the interactive mode; neither applies to the runtime-backed
`plan --auto` path, which is the preferred mode whenever the goal can be
stated non-interactively (the third historical gap — no structured outcome,
`unmeasured: true` — is an accepted limitation, README → Known limitations):

- **Stale managed clone.** The planning worktree is cut from the managed
  clone without fetching the remote default branch first, so a session can
  plan from stale product truth (reproduced 2026-07-10 with
  buildstacks.dev). Turn-runner paths fetch before every turn; the
  interactive launcher does not.
- **Memory lands on unmerged branches.** A session that commits
  `.operon/memory/**` to its plan branch pushes it without a PR or staged
  review, so the memory is unreachable from the default branch that future
  turns read.

## Bootstrap publication workflow

`operon bootstrap` writes app-owned `.operon/` artifacts and registers the
app, but committing, pushing, and opening the coordinated app-repo/org-repo
PRs is manual. A `bootstrap publish` command should stage exactly the
bootstrap-owned changes, open draft PRs (never merge them), support
`--dry-run`, and fail safely on unrelated worktree changes.
