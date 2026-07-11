---
name: operon
description: Operate the Operon org runtime through its installed CLI. Use when Codex needs to create or select an Operon org, onboard an existing repository, create a greenfield app, inspect roles/apps/pipelines, run dry-run planning or loop diagnostics, start live Operon work, review approvals, or diagnose Operon configuration and runtime state.
---

# Operon

Use the installed `operon` command as the source of truth. Do not inspect the
Operon implementation repository merely to discover commands.

Operon's `TASTE.md` and `taste/<role>.md` files define how the organization and
its roles behave. This skill is the coding-agent runbook for operating that
organization; it does not replace or restate those role constitutions.

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
operon org init <local-org-path> --name <org-name>
operon doctor
```

Keep these locations distinct:

- Org home: committed roles, apps, pipelines, prompts, taste, and curated memory.
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

## Create a greenfield app

Preview first:

```bash
operon new-app <name> --target-dir <local-path> --repo <owner/repo> --goal <goal> --dry-run
```

Remove `--dry-run` only after the target, repository slug, and goal are correct.
Follow the generated `.operon/bootstrap/next-commands.md` for GitHub creation
and the first ticket.

## Operate safely

Prefer token-free inspection before a live turn:

```bash
operon plan <app> --dry-run
operon loop --app <app> --once --dry-run
operon dispatch --dry-run
operon run-role <role> --app <app> --dry-run
```

Interactive `operon plan <app>` hands the terminal to a live session and will
hang a non-interactive run; headless planning must use
`operon plan <app> --auto --goal <text>`.

Live `plan`, `loop`, `dispatch`, `run-role`, and `learn experiment run`
operations can spend tokens and modify GitHub or worktrees; `learn canary
start` begins a live trial that shapes subsequent turns. Critical operations
stop in the durable approval queue; inspect it with `operon approvals` and
never bypass that boundary.

`operon learn` read subcommands (`report`, `inspect`, `show`) are fine for
diagnosis. The write subcommands — `emit`, `review`, `publish`, `resolve`,
`disable`, `rollback`, `provisional`, `experiment`, `canary` — are the human
operator's governed-activation window: never invoke them as an agent (`emit`
records a human-attributed observation; `review`/`publish` activate learned
behavior).

## Diagnose

Run `operon doctor --json`, `operon org show --json`, and `operon context
--json`. Report the resolved org home and state home with failures. Use
`operon <command> --help` for current argument semantics instead of relying on
memorized flags.
