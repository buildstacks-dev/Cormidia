# Known issues

Defects and UX gaps that are real today. Everything the 2026-07-10
proportionality campaign fixed has been removed — the full historical
backlog is in this file's git history, and the systemic analysis is
`docs/proportionality-review.md`. New defects should go to the GitHub
issue tracker rather than this file.

## Interactive co-planning (`operon plan <app>` without `--auto`)

The interactive mode hands the terminal to the native `claude` CLI, and
three gaps follow from that design. None apply to the runtime-backed
`plan --auto` path, which is the preferred mode whenever the goal can be
stated non-interactively:

- **Stale managed clone.** The planning worktree is cut from the managed
  clone without fetching the remote default branch first, so a session can
  plan from stale product truth (reproduced 2026-07-10 with
  buildstacks.dev). Turn-runner paths fetch before every turn; the
  interactive launcher does not.
- **No structured outcome.** A stalled or empty interactive session can
  still exit 0 — usage is `unmeasured: true` in the ledger and there is no
  validated, published plan artifact (that is exactly what `--auto` adds).
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

## Packaged skill installs only into the Codex skills home

`agent-skills/operon` is packaged, but `scripts/link-local.mjs` links it
only at `$CODEX_HOME/skills/operon`. Claude Code resolves skills from
`~/.claude/skills`, where no `operon` entry exists, so Claude-side agents
cannot discover the CLI workflow the skill documents. The install should
link every supported provider skills home, and `pnpm smoke:onboarding`
should verify both.

## Codex App-Server read bypass

Tracked as issue #20 (and in `docs/capability-matrix.md`): under the
`untrusted` approval policy, the App Server auto-runs trusted read-only
commands without an approval request, so those reads never reach the gate.
