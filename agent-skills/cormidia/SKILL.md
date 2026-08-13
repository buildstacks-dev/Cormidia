---
name: cormidia
description: Operate the Cormidia org runtime through its installed CLI. Use when Codex needs to create, select, or upgrade a Cormidia org; onboard, reset, verify, or promote an app; inspect roles/apps/pipelines; run dry-run planning or loop diagnostics; start live Cormidia work; review approvals; or diagnose Cormidia configuration and runtime state.
---

# Cormidia

Use the installed `cormidia` command as the source of truth. Do not inspect the
Cormidia implementation repository merely to discover commands.

Cormidia's `AUTHORITY.md` defines the human's versioned delegation grant;
`TASTE.md` and `taste/<role>.md` define how the organization and its roles
behave. App policy and the current task may narrow authority, never broaden
it, and no charter bypasses critical-operation approvals. This skill is the
coding-agent runbook for operating that organization; it does not replace or
restate those records.

## Discover the active installation

Run:

```bash
command -v cormidia
cormidia capabilities --json
cormidia context --json
```

If `cormidia` is missing, install the public command with
`npm install -g cormidia`. For a source checkout, `pnpm link:local` creates a
source-backed command whose next invocation sees source edits without an
update, rebuild, or relink.
If no active org exists, create one only when the user asked to initialize an
organization:

```bash
cormidia org init <local-org-path> --name <org-name> --authority delegated-operator
cormidia doctor
```

Keep these locations distinct:

- Org home: committed roles, apps, pipelines, prompts, authority, taste, and curated memory.
- State home: local clones, worktrees, locks, approvals, telemetry, and run logs.
- App repo: the independent product checkout being operated on.
- Package root: the installed Cormidia implementation; never use it as org home.

## Onboard an existing app

Pass a local checkout path, never a GitHub URL:

```bash
cormidia bootstrap <local-repo-path> --scan-only
cormidia bootstrap <local-repo-path> --answers <answers.json>
cormidia apps
cormidia doctor
```

The bare command opens the questionnaire only in an interactive terminal.
Coding-agent and other non-interactive runs require `--answers`; if the user
has not supplied those product choices, ask rather than infer them. Review the
generated `.cormidia/` files before committing them.
The answers may select `authority.mode` as `inherit`, `conservative`, or
`custom` (with restrictions). Bootstrap preserves existing root `AGENTS.md`
and `CLAUDE.md` content while composing one marked pointer to
`.cormidia/AUTHORITY.md` for top-level sessions.

For reset recovery, reuse the normalized non-secret record rather than
reconstructing answers:

```bash
cormidia bootstrap <local-repo-path> --answers-from <reset-archive-or-app> --json
```

This creates the onboarding commit only in the managed clone and preserves the
human checkout exactly. Make that commit reachable from the remote default
branch before verification.

## Create a greenfield app

Preview first:

```bash
cormidia new-app <name> --target-dir <local-path> --repo <owner/repo> --goal <goal> --dry-run
```

Omitting `--template` resolves to `bare`, a stack-neutral repository: product
truth and Cormidia artifacts only, with required test/lint gates explicitly
pending and failing closed until the first implementation establishes them.
Planning orders that stack-and-gates unit before dependent feature work. Pass
`--template typescript-node` only when that exact npm + strict TypeScript web
scaffold is genuinely wanted; never infer a stack from the goal text.

Remove `--dry-run` only after the target, repository slug, and goal are correct.
Follow the generated `.cormidia/bootstrap/next-commands.md` for GitHub creation
and the first ticket.

`--target-dir` may already hold design documents, briefs, or assets: those are
greenfield inputs and the scaffold lands beside them without touching a byte.
An existing application checkout, an already-onboarded app, or a file at a path
the scaffold would create refuses before any write and names the command to use
instead. The preview performs the same checks as execution, so its report is a
prediction execution can keep.

The preview is also the identity gate. `--repo` must be a concrete, deliberately
chosen `owner/repo`; an unresolved template value in either component (or a URL,
path, or whitespace variant) makes both preview and execution exit non-zero with
a typed `kind: new-app-refusal` and write nothing. Never "fix" a placeholder by
editing the generated guide, `.cormidia/config.yaml`, or `apps.yaml`: those are
written together, so a hand-edit leaves the others bound to the wrong
repository. For an app already registered with a placeholder, run
`cormidia app reset <app> --execute --confirm <app>` and re-onboard with the
real slug. The human walk-through is `docs/org/manual-e2e-runbook.md`.

`new-app` cannot write the app's lifecycle record — at scaffold time there is
no commit or remote yet. Once you have pushed the scaffold, run
`cormidia app verify <name>`: it synthesizes the lifecycle record from the pushed
remote, and `cormidia app promote <name> --to live --execute` then transitions the
app to `status: live` (required for SRE/Support/Marketing dispatch) — then
publish the org registry change (see "Publish committed org configuration"), or
the promotion exists only on this machine. If
`cormidia app verify` reports a `blocked` `lifecycle-record` check, its
remediation names the missing step (usually: push the scaffold to the remote
default branch). An app onboarded before record synthesis existed recovers the
same way — just re-run `cormidia app verify <name>`; do not hand-edit
`apps.yaml`.

## Publish committed org configuration

The org home is **committed** organization configuration. `new-app`,
`bootstrap`, `app promote`, `app reset`, `roles set`, `org upgrade`, and the
learning publisher all write the operator's working tree first, which is one
checkout, not org truth. Those commands now report a durability state rather
than a terminal claim: `local_only`, `recorded_locally`, `pending_publication`,
`pending_merge`, or `reachable_at_remote` — only the last means the change
survives a fresh clone.

Preview what would be published, then publish it:

```bash
cormidia org publish --json
cormidia org publish --surface app-registry --execute --json
```

Execution stages only that surface's owned paths in a throwaway worktree, cuts a
dedicated branch from the resolved remote default branch, pushes it, and opens a
DRAFT pull request. It never merges, never pushes a default branch, and never
stages unrelated work — unrelated *staged* content refuses as an ambiguous
scope. Retries adopt an existing branch or pull request instead of duplicating
one. Run it with no `--surface` to reconcile an org home whose configuration
never reached its remote; never tell an operator to `git add -A` in an org home
or to hand-edit `apps.yaml`.

`cormidia context --json` carries a `publication` field with the same vocabulary.
`unknown` there means the checkout has a remote but no fetched ref — it is not
agreement, and it is not a reason to proceed as if the remote matched.

An org home with no configured remote is a supported setup: it reports
`local_only`, and no command may claim durability beyond that working tree.

## Reset one app for another test iteration

Use the plan first; it reads the app's managed state and GitHub work surface
but changes nothing:

```bash
cormidia app reset <app-name>
```

It reports its archive destination and any active runs, journals, locks, or
pending approvals that make reset unsafe. Execution closes only planned
Cormidia-managed GitHub work, removes the app from `apps.yaml`, and clears its
managed state after first writing an archive outside the state home:

```bash
cormidia app reset <app-name> --execute --confirm <app-name> [--force]
```

Never run `--execute` unless the human explicitly asked to reset that named
app and has reviewed the plan. It does **not** delete the GitHub repository,
its default branch, closed-history records, or a human checkout. Re-onboard
with `cormidia bootstrap <local-repo> --answers <answers.json>` after a reset.
`--force` is limited to stale running envelopes (no heartbeat for ten minutes)
and never overrides a fresh run, journal, lock, or pending approval.

## Retire a whole org

`cormidia org list` enumerates every org discoverable from `~/.cormidia`, with its
state home, org home, footprint, app count, and last activity. An org whose org
home is not recorded shows as an orphan; `cormidia doctor` reports the same.

```bash
cormidia org list --json
cormidia org archive <org-name>
```

The plan reports the state home it would remove, the archive destination, and
anything that makes retirement unsafe (a held role lock, an undecided approval,
an interrupted lifecycle transaction). Execution requires the exact token:

```bash
cormidia org archive <org-name> --execute --confirm <org-name>
```

It writes one verified archive outside the state home, re-reads every archived
byte against the source, and only then removes the state home; a verification
failure removes nothing. It clears the active pointer when that org was active.
It never touches the org home (usually a git repository and often a human
checkout) or any GitHub repository, branch, or ticket. Never run `--execute`
unless the human explicitly asked to retire that named org and has read the
plan.

Archiving works for any discoverable org, active or not. The retirement is
recorded in the invoking org's invocation ledger, named by
`provenance.archivedOrg`. When the archived org is the one you were working in,
that ledger is being deleted, so the terminal row goes to
`<archive-root>/retirement-ledger` instead — the row is still written, and it
is written outside the tree that was removed. After `--execute` returns the
state home does not exist and nothing re-creates it: check with `cormidia org
list` and `cormidia doctor`, both of which will now report no active org.

Retiring the same org twice from the same paths is normal after a recovery, and
is safe: the second archive lands in a numbered sibling directory and the first
one's bytes are never touched.

## Change a role's model, effort, or budget

`roles.yaml` is a human-ratified surface. Preview the change, then hand the
diff to the human:

```bash
cormidia roles set <role> --effort xhigh --turn-budget 15 --json
```

The preview validates the resulting harness/model/effort tuple against what the
adapter can execute and writes nothing. Execution additionally requires an
attributable `--by <identity>` and a `--reason`, and it is journaled — so it is
the human's decision to record, not yours to make.

Execution edits only the scalars you named, as a byte splice: every comment,
blank line, key order, and flow sequence in the ratified file is preserved, so
the human's diff is the size of the change. The plan also states whether the
resulting model id was proven against the harness's own roster, or names why
that harness publishes none — read that line before handing the diff over.

Only pi publishes a roster Cormidia can read without a credential, so only a pi
model id is refused here when the harness will not serve it. Setting a model or
runtime on `claude` or `codex` prints an UNVERIFIED warning on stdout and
stderr and records the same fact in the journal, because nothing short of a
live turn can check the id. Treat that warning as a real one: hand the human
the diff, and run `cormidia doctor` before the role's next turn spends on it.

## Upgrade, verify, and promote without providers

Preview every lifecycle mutation first:

```bash
cormidia org upgrade --authority delegated-operator --json
cormidia app verify <app-name> --json
cormidia app promote <app-name> --to live --json
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
cormidia plan <app> --dry-run
cormidia plan <app> --creator-scope <scope.json|scope.yaml> --execution-ready --dry-run
cormidia loop --app <app> --once --dry-run
cormidia dispatch --dry-run
cormidia run-role <role> --app <app> --turn <invocation-id> --template <bounded-scope.md> --dry-run
cormidia scheduler install --json
cormidia scheduler status --json
cormidia scheduler uninstall --json
```

Scheduler install/uninstall are preview-only without `--execute`; preview and
status are token-free. Execute only when the user explicitly authorizes the
exact org-scoped identity printed by preview:

```bash
cormidia scheduler install --execute --confirm <scheduler-id-or-exact-org-name>
cormidia scheduler uninstall --execute --confirm <scheduler-id-or-exact-org-name>
```

Never infer scheduler health from a definition file. `scheduler status` joins
ownership/hash/cadence, loaded/active host-manager state, recent tick evidence,
duplicates/orphans, and provider-settlement agreement. `doctor --config-only`
cannot claim execution health. A real launchd/systemd mutation always needs
separate explicit authorization.

Bare `cormidia plan <app>` fails closed because the retired native interactive
child could not preserve durable plan and execution evidence. Live planning
must use `cormidia plan <app> --auto --goal <text>` or an explicit
`cormidia plan <app> --creator-scope <scope.json|scope.yaml> --execution-ready`;
the manual `--dry-run` form is only a token-free context/worktree preview.
Use repeatable `--source <file-or-dir>` for required design/product-truth
inputs and `--optional-source <file-or-dir>` where absence is acceptable.
Cormidia does NOT read these files: it declares them as a governed read scope
and the harness reads them with its own tools, images and PDFs included, so a
mixed directory is ordinary input. A missing/unreadable/rejected required root
stops before a provider turn. When the scope holds images or documents, the
selected harness/model/effort tuple must carry `media_read` or the episode
refuses before spending tokens.

Consumption is observed, not assumed. A source counts as consumed only when the
gate saw the turn read it; a declared source the turn never opened reports
`not_read`, and a turn with no observable read channel reports `unobservable`.
Never describe a plan as informed by evidence the run reports as unread.
Published tickets carry refs, hashes and consumption state — never source bytes.

`--expected-tickets` states the expected ticket count: exact (`10`), inclusive
range (`4-12`), open range (`7+`), or `complete`. It does not raise publication
admission. The token-free preview reports that intent separately from the
per-invocation cap (bootstrap 3, growth 5, mature 7), and repository evidence
can only lower that cap when `--stage` is asserted. The planner owns
decomposition and its RoadmapPlan is where that is durable. A publication batch
is prepared durably before any issue is created, so an interrupted run recovers
that exact batch with `--resume-publication` rather than duplicating issues.
Refusals name syntax, cap, and next action.

The legacy human-gated verb remains only for older refused-decomposition
records:

```bash
cormidia plan ratify-ticket-budget --app <app> --decomposition <id> \
  --actor <identity> --reason "<why>" --from-budget <stage-budget> --to-budget <ticket-count>
cormidia plan ratify-ticket-budget --app <app> --decomposition <id> ... --execute --confirm <app>@<id>
```

It previews by default, applies to one legacy decomposition digest only, and is
never a standing admission override. Ask the user before executing it.

Creator-scope JSON/YAML must match the strict `CreatorEpisodeScope` contract,
including `planningDisposition: execution_ready`, creator provenance,
objective and exclusions, acceptance criteria, expected artifacts, declared
constraints, safety facts, and exactly one explicit step DAG or governed
workflow template. The file flag and `--execution-ready` are required together;
Cormidia never infers readiness. Fixed mode resolves configured assignments;
adaptive steps must carry exact approved assignments. An invalid or incomplete
scope fails before provider construction rather than falling back to
EpisodePlanner. A valid scope skips only the dedicated design turn, then
executes its declared governed planning step(s) through normal durable
validation, accounting, TicketPlan projection, and publication boundaries.

Live `plan --auto`, `loop`, `dispatch`, `run-role`, and `learn experiment run`
operations can spend tokens and modify GitHub or worktrees; `learn canary
start` begins a live trial that shapes subsequent turns. Critical operations
stop in the durable approval queue; inspect it with `cormidia approvals` and
never bypass that boundary.

For a fresh standalone `run-role`, preview and live modes both require
`--app`, `--turn`, and a non-empty bounded `--template`. `--turn` is only an
invocation/trace identity; it is not a GitHub ticket number and does not bind a
ticket. The preview validates and displays the template hash/summary,
provenance, objective, creator scope, and assignment without constructing a
provider or writing state. It reads a discovered registered checkout and
reports the predicted managed/live checkout, but does not synchronize the
managed clone or create or verify the live worktree. It does not prove provider
authentication/readiness, live budget or approval outcomes, or external state
that can change after preview. `--workdir` is unsupported because a
preview-only override would misrepresent the route-selected live checkout.
Live first synchronizes the registered app's managed clone; a fresh explicit
standalone turn then executes in a durable per-turn worktree cut from that exact
resolved base. Reusing the same invocation identity rediscovers that worktree
without resetting or deleting preserved WIP.

In fixed assignment mode both forms must omit `--assignment`; Cormidia resolves
the role's configured atomic tuple. In adaptive mode both forms require exactly
`--assignment <approved-candidate-id>@<effort>` and reject omission, unknown
candidates, unsupported efforts, or a selector in fixed mode. Use `cormidia
roles` and `cormidia apps` to inspect the effective catalog and app narrowing
before selecting it. A durable resume may reuse its persisted creator scope
without a mutable template. Governed scheduled, event, and ticket routes keep
their governed scope and existing checkout ownership, and reject standalone
overrides.

`cormidia learn` read subcommands (`report`, `inspect`, `show`) are fine for
diagnosis. `report` is read-only by default; use `report --refresh` only when
the user asks to update derived capture/episode projections. The write
subcommands — `emit`, `review`, `publish`, `resolve`,
`disable`, `rollback`, `provisional`, `experiment`, `canary` — are the human
operator's governed-activation window: never invoke them as an agent (`emit`
records a human-attributed observation; `review`/`publish` activate learned
behavior).

`cormidia learn distill --dry-run [--app <name>]` runs only the deterministic
precheck and is safe for diagnosis. The live form writes governed candidate
artifacts and spends tokens only when an actionable, unsuppressed evidence
cluster survives policy caps; do not invoke the live form unless the human
explicitly asks for a distillation run. Scheduled distiller/reviewer turns use
the same ordinary ledger and learning-budget overlay as every provider turn.

## Self-hosting boundary

The standing Cormidia org may onboard and manage both
`cormidia/cormidia-web` and `cormidia/Cormidia` as ordinary apps. Neither app's
onboarding depends on the other first proving the loop. Keep package root, org
home, state home, and managed app checkout distinct, and use the same
bootstrap, verification, promotion, planning, loop, and approval commands as
for any other app.

When operating the Cormidia source app, follow its root `AGENTS.md` and linked
developer policy as app-scoped repository instructions. The org/app authority
may authorize ordinary planning, implementation, review, maintenance, and
marketing work. Every release-shaped action for every app — including website
deployment, external publication, npm publish, version tags, and release
handoff — requires explicit human approval. Approval is not execution; after
approval, Cormidia may execute only the exact approved action through the
ordinary durable release mechanism. The org can never approve its own release.

Repository developer grants, raw eval artifacts, campaign state, and
outer-session instructions never become org-home constitution, cross-app
memory, learning, or approval authority. Do not copy them into the org home or
global org context. Developer campaign and CI evidence likewise never
authorize an unrelated org operation. Human-ratified repository surfaces keep
their required human merge boundary.

## Diagnose

Run `cormidia doctor --json`, `cormidia org show --json`, and `cormidia context
--json`. Report the resolved org home and state home with failures. Use
`cormidia <command> --help` for current argument semantics instead of relying on
memorized flags.

`doctor` performs bounded, non-billable initialize/account/auth probes for
configured runtimes; it sends no model prompt. Treat `missing_binary`,
`transport_unavailable`, `unauthenticated`, `misconfigured`, and `timed_out`
as real readiness failures. `doctor --config-only` is for isolated packaging
checks and deliberately reports adapter readiness as unverified `WARN`.
