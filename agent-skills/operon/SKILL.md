---
name: operon
description: Operate the Operon org runtime through its installed CLI. Use when Codex needs to create, select, or upgrade an Operon org; onboard, reset, verify, or promote an app; inspect roles/apps/pipelines; run dry-run planning or loop diagnostics; start live Operon work; review approvals; or diagnose Operon configuration and runtime state.
---

# Operon

Use the installed `operon` command as the source of truth. Do not inspect the
Operon implementation repository merely to discover commands.

Operon's `AUTHORITY.md` defines the human's versioned delegation grant;
`TASTE.md` and `taste/<role>.md` define how the organization and its roles
behave. App policy and the current task may narrow authority, never broaden
it, and no charter bypasses critical-operation approvals. This skill is the
coding-agent runbook for operating that organization; it does not replace or
restate those records.

## Discover the active installation

Run:

```bash
command -v operon
operon capabilities --json
operon context --json
```

If `operon` is missing, report that the local package link is not installed.
For a source checkout, `pnpm link:local` creates a source-backed command whose
next invocation sees source edits without an update, rebuild, or relink.
If no active org exists, create one only when the user asked to initialize an
organization:

```bash
operon org init <local-org-path> --name <org-name> --authority delegated-operator
operon doctor
```

Keep these locations distinct:

- Org home: committed roles, apps, pipelines, prompts, authority, taste, and curated memory.
- State home: local clones, worktrees, locks, approvals, telemetry, and run logs.
- App repo: the independent product checkout being operated on.
- Package root: the installed Operon implementation; never use it as org home.

## Onboard an existing app

Pass a local checkout path, never a GitHub URL:

```bash
operon bootstrap <local-repo-path> --scan-only
operon bootstrap <local-repo-path> --answers <answers.json>
operon apps
operon doctor
```

The bare command opens the questionnaire only in an interactive terminal.
Coding-agent and other non-interactive runs require `--answers`; if the user
has not supplied those product choices, ask rather than infer them. Review the
generated `.operon/` files before committing them.
The answers may select `authority.mode` as `inherit`, `conservative`, or
`custom` (with restrictions). Bootstrap preserves existing root `AGENTS.md`
and `CLAUDE.md` content while composing one marked pointer to
`.operon/AUTHORITY.md` for top-level sessions.

For reset recovery, reuse the normalized non-secret record rather than
reconstructing answers:

```bash
operon bootstrap <local-repo-path> --answers-from <reset-archive-or-app> --json
```

This creates the onboarding commit only in the managed clone and preserves the
human checkout exactly. Make that commit reachable from the remote default
branch before verification.

## Create a greenfield app

Preview first:

```bash
operon new-app <name> --target-dir <local-path> --repo <owner/repo> --goal <goal> --dry-run
```

Remove `--dry-run` only after the target, repository slug, and goal are correct.
Follow the generated `.operon/bootstrap/next-commands.md` for GitHub creation
and the first ticket.

`new-app` cannot write the app's lifecycle record — at scaffold time there is
no commit or remote yet. Once you have pushed the scaffold, run
`operon app verify <name>`: it synthesizes the lifecycle record from the pushed
remote, and `operon app promote <name> --to live --execute` then transitions the
app to `status: live` (required for SRE/Support/Marketing dispatch). If
`operon app verify` reports a `blocked` `lifecycle-record` check, its
remediation names the missing step (usually: push the scaffold to the remote
default branch). An app onboarded before record synthesis existed recovers the
same way — just re-run `operon app verify <name>`; do not hand-edit
`apps.yaml`.

## Reset one app for another test iteration

Use the plan first; it reads the app's managed state and GitHub work surface
but changes nothing:

```bash
operon app reset <app-name>
```

It reports its archive destination and any active runs, journals, locks, or
pending approvals that make reset unsafe. Execution closes only planned
Operon-managed GitHub work, removes the app from `apps.yaml`, and clears its
managed state after first writing an archive outside the state home:

```bash
operon app reset <app-name> --execute --confirm <app-name> [--force]
```

Never run `--execute` unless the human explicitly asked to reset that named
app and has reviewed the plan. It does **not** delete the GitHub repository,
its default branch, closed-history records, or a human checkout. Re-onboard
with `operon bootstrap <local-repo> --answers <answers.json>` after a reset.
`--force` is limited to stale running envelopes (no heartbeat for ten minutes)
and never overrides a fresh run, journal, lock, or pending approval.

## Upgrade, verify, and promote without providers

Preview every lifecycle mutation first:

```bash
operon org upgrade --authority delegated-operator --json
operon app verify <app-name> --json
operon app promote <app-name> --to live --json
```

Upgrade execution requires the reviewed authority choice and `--execute`.
Promotion execution requires `--execute` and is refused until verification is
ready. These commands may write archives, managed-clone/ref convergence,
readiness, and mechanical evidence, but they never construct a runtime, start
a provider process, make a model turn, or settle usage. Their journals and
locks are crash-resumable; rerun the same command after an interruption.

## Operate safely

Prefer token-free inspection before a live turn:

```bash
operon plan <app> --dry-run
operon loop --app <app> --once --dry-run
operon dispatch --dry-run
operon run-role <role> --app <app> --dry-run
operon scheduler install --json
operon scheduler status --json
operon scheduler uninstall --json
```

Scheduler install/uninstall are preview-only without `--execute`; preview and
status are token-free. Execute only when the user explicitly authorizes the
exact org-scoped identity printed by preview:

```bash
operon scheduler install --execute --confirm <scheduler-id-or-exact-org-name>
operon scheduler uninstall --execute --confirm <scheduler-id-or-exact-org-name>
```

Never infer scheduler health from a definition file. `scheduler status` joins
ownership/hash/cadence, loaded/active host-manager state, recent tick evidence,
duplicates/orphans, and provider-settlement agreement. `doctor --config-only`
cannot claim execution health. A real launchd/systemd mutation always needs
separate explicit authorization.

Bare `operon plan <app>` fails closed because the retired native interactive
child could not preserve durable plan and execution evidence. Live planning
must use `operon plan <app> --auto --goal <text>`; the manual `--dry-run` form
is only a token-free context/worktree preview.
Use repeatable `--source <file-or-dir>` for required design/product-truth
inputs and `--optional-source <file-or-dir>` only when deterministic
truncation or exclusion is acceptable. Required source failures stop before a
provider turn; successful tickets publish hashes/refs rather than source bytes.

Live `plan --auto`, `loop`, `dispatch`, `run-role`, and `learn experiment run`
operations can spend tokens and modify GitHub or worktrees; `learn canary
start` begins a live trial that shapes subsequent turns. Critical operations
stop in the durable approval queue; inspect it with `operon approvals` and
never bypass that boundary.

For a live standalone `run-role`, fixed assignment mode must omit
`--assignment`; Operon resolves the role's configured atomic tuple. Adaptive
mode requires exactly `--assignment <approved-candidate-id>@<effort>` and
rejects omission, unknown candidates, unsupported efforts, or a selector in
fixed mode. Use `operon roles` and `operon apps` to inspect the effective
catalog and app narrowing before selecting it.

`operon learn` read subcommands (`report`, `inspect`, `show`) are fine for
diagnosis. `report` is read-only by default; use `report --refresh` only when
the user asks to update derived capture/episode projections. The write
subcommands — `emit`, `review`, `publish`, `resolve`,
`disable`, `rollback`, `provisional`, `experiment`, `canary` — are the human
operator's governed-activation window: never invoke them as an agent (`emit`
records a human-attributed observation; `review`/`publish` activate learned
behavior).

`operon learn distill --dry-run [--app <name>]` runs only the deterministic
precheck and is safe for diagnosis. The live form writes governed candidate
artifacts and spends tokens only when an actionable, unsuppressed evidence
cluster survives policy caps; do not invoke the live form unless the human
explicitly asks for a distillation run. Scheduled distiller/reviewer turns use
the same ordinary ledger and learning-budget overlay as every provider turn.

## Platform-development boundary

This packaged skill operates an org; it must not build or maintain Operon
itself. Do not turn the Operon repository into an app managed by an Operon org,
and do not use org authority, approvals, state, memory, learning, scheduler, or
budgets as platform-development authority. Conversely, developer campaigns and
CI evidence never authorize an org operation.

If the user asks to change the Operon platform from its source repository,
leave this operating workflow and follow that repository's root developer
instructions and human-ratified development policy. Those developer-only
instructions, eval tools, grants, raw evidence, and release workflow are
intentionally not packaged with this skill. Never copy them into an org home
or target app.

## Diagnose

Run `operon doctor --json`, `operon org show --json`, and `operon context
--json`. Report the resolved org home and state home with failures. Use
`operon <command> --help` for current argument semantics instead of relying on
memorized flags.

`doctor` performs bounded, non-billable initialize/account/auth probes for
configured runtimes; it sends no model prompt. Treat `missing_binary`,
`transport_unavailable`, `unauthenticated`, `misconfigured`, and `timed_out`
as real readiness failures. `doctor --config-only` is for isolated packaging
checks and deliberately reports adapter readiness as unverified `WARN`.
