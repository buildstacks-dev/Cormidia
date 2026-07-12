# Operon

An **org runtime**: a standing team of AI agents (Planner, Builder, Reviewer,
SRE, Support, Marketing) that develops and operates a software product through
a private GitHub repo, with a human approver gating critical operations only.

```mermaid
flowchart TD
    T["⏱ Timer tick (~5 min)<br/><b>start here</b>"] --> D["Dispatcher<br/>polls GitHub + grants;<br/>re-queues blocked turns first"]
    D -->|"for each due (role, app)"| R["Turn runner<br/>assembles context, cuts worktree"]
    R --> A["Runtime adapter<br/>claude · codex · pi"]
    A -->|"each tool action"| G{"Critical-ops gate<br/>classify"}
    G -->|"routine (or grant on file)"| GH[("GitHub<br/>issues, PRs, reviews")]
    G -->|"critical, no grant"| B["Turn ends blocked_on_gate<br/>→ approval queue"]
    B --> H["Human approver"]
    H -->|"grant / deny"| N["↻ Next tick<br/>Dispatcher re-runs the turn"]
    GH -->|"polled next tick"| N
```

The flow is a single loop, read top to bottom: the **Timer tick** wakes the
**Dispatcher**, which runs due turns through the adapter and gate, then the
`↻ Next tick` node folds back to the Dispatcher on the following tick — grants
and freshly-polled GitHub events are both picked up there.

The gate classifies *every* tool action; only ops matching a critical rule are
blocked. A blocked op does not resume in place — the turn ends `blocked_on_gate`,
the human's grant writes a single-use grant file, and the **next dispatcher tick
re-runs that turn first**, where the gate now finds the grant and lets the op
through. The org's own squash-merge is a separate path, gated by HMAC review
authorization rather than this gate.

Read [`docs/PURPOSE.md`](docs/PURPOSE.md) for the why and every decision made so far;
[`TASTE.md`](TASTE.md) is the org's constitution;
[`roles.yaml`](roles.yaml) is the org chart made executable;
[`AGENTS.md`](AGENTS.md) is the contributor map.
New to the code? Open [`docs/wiki.html`](docs/wiki.html) — a standalone,
self-contained wiki that walks the three layers, the build loop, and the
runtime adapters, with curated reading paths for coming up to speed.

## Install locally

Operon requires **Node.js >= 26** and the pnpm version pinned in
`packageManager`. Node 26 does not bundle Corepack, so install/enable it once
if `pnpm --version` does not match the pin.

```bash
npm install -g corepack   # once per Node installation, when needed
corepack enable
pnpm install
pnpm link:local
```

`pnpm link:local` exposes `operon` at `~/.local/bin/operon` (or
`$OPERON_BIN_DIR/operon`) and links the `$operon` skill into Codex
(`$CODEX_HOME/skills/operon`), Claude (`$CLAUDE_CONFIG_DIR/skills/operon`),
and pi (`$PI_CODING_AGENT_DIR/skills/operon`), using each provider's default
home when its override is unset. Add `~/.local/bin` to `PATH` if necessary. The
local command is source-backed: the next invocation reads the latest source
changes, so no `operon update`, relink, or rebuild is needed. A packed or
published installation instead runs the compiled `dist/cli.js` binary.

These four locations are intentionally different:

| Location | One-line meaning |
| --- | --- |
| Package root | Operon's installed implementation and reusable templates. |
| Org home | Committed roles, apps, pipelines, prompts, authority, taste, and curated memory. |
| State home | Local high-churn clones, worktrees, locks, approvals, telemetry, and run logs. |
| App repo | An independent product checkout that Operon develops or operates. |

Create the org before onboarding an app; this can be run from any directory:

```bash
operon --version
operon org init ~/Build/my-org --name my-org
operon doctor
operon context
```

`org init` creates a complete org home from packaged templates, including a
versioned `AUTHORITY.md`, creates the
default state home at `~/.operon/<org>`, and records the active org pointer at
`~/.operon/config`. Use `operon org use <path>` to switch to another complete
org. `OPERON_ORG_HOME` and `OPERON_STATE_HOME` are explicit per-process
overrides. The default `delegated-operator` charter automates ordinary,
reversible work while Operon's critical-operation gates remain mandatory;
choose `--authority conservative` or `--authority custom --authority-file
<path> --authority-by <identity>` during onboarding to narrow or replace the
human grant explicitly.

## Commands

Run `operon --help` or `operon <command> --help` for current syntax. The
read-only discovery surfaces are also machine-readable for coding agents:

```bash
operon capabilities --json
operon context --json
operon roles
operon apps
operon pipelines
operon doctor --json
```

By default `doctor` runs bounded, non-billable readiness probes only for the
runtimes and models referenced by the active `roles.yaml`: Claude performs an
SDK initialize/account-info control request, Codex performs App Server
`initialize` + `account/read`, and pi resolves its model/auth configuration.
No model prompt is sent. Missing launch artifacts, transport failure, missing
auth, invalid model configuration, and probe timeout are reported distinctly.
Use `operon doctor --config-only` only in an isolated/offline packaging check;
its adapter rows are `WARN` because configuration validity is not runtime
readiness.

Offline onboarding and inspection do not require provider credentials:

```bash
operon bootstrap <local-repo> --scan-only
operon bootstrap <local-repo>                    # interactive terminal questionnaire
operon bootstrap <local-repo> --answers answers.json
operon new-app marketplace --target-dir ../marketplace --repo owner/marketplace --goal "A marketplace for dummy products" --dry-run
operon plan <app> --dry-run
operon loop --app <app> --once --dry-run
operon dispatch --dry-run
operon run-role <role> --app <app> --dry-run
operon status
operon budget
operon analyze
operon approvals
operon observe --app <app> --open
```

Bootstrap accepts a local checkout path, never a GitHub URL. It always joins
the active org and writes app-owned files under `.operon/`, plus one marked,
idempotent authority pointer composed into root `AGENTS.md` and `CLAUDE.md`.
Existing instruction content is preserved. Its opening output explains the app repo, org home, and
state home before anything is written. A non-interactive run requires
`--answers` and otherwise writes nothing. `new-app` creates a separate product
repo skeleton and then follows the same bootstrap/register path. Neither
command creates or publishes a GitHub repo.

The `--dry-run` variants of `new-app`, `plan`, `loop`, `dispatch`, and
`run-role` assemble real context but spend no tokens. Live forms can spend
tokens and touch GitHub:

```bash
operon plan <app>
operon loop --app <app> --once
operon dispatch
pnpm test:live
GH_SANDBOX_REPO=<owner/repo> pnpm e2e:sandbox:setup
GH_SANDBOX_REPO=<owner/repo> pnpm e2e:sandbox
```

## Reset an app for another test iteration

Use `operon app reset <app>` to begin another onboarding/build-loop iteration
without deleting the GitHub repository or the organization. It is a
non-mutating plan by default: it inventories the selected app's managed local
state and identifiable Operon GitHub work (`op:*` issues and PRs linked to
them), and reports blockers such as active turns, locks, journals, or pending
approvals.

```bash
operon app reset buildstacks.dev
operon app reset buildstacks.dev --execute --confirm buildstacks.dev --force
```

Execution first writes a checksummed archive to
`~/.operon/archives/<org>/<timestamp>-<app>-<id>/` (or `--archive-root`), then
closes the planned PRs/issues, deletes their head branches, removes the app
from `apps.yaml`, and clears its managed clone, worktrees, runs, ticket state,
approval records, schedules, and ledger rows. It never deletes the GitHub
repository, its default branch, a human checkout, or the GitHub history of
closed work. Re-onboard the checkout with `operon bootstrap <local-repo>
--answers <answers.json>` when ready.

`--force` is intentionally narrow: it permits cleanup past a `running` record
whose heartbeat is more than ten minutes old. It never overrides a fresh run,
active journal/lock, or pending approval.

Contributors can still use `pnpm dev <command>` inside the Operon source repo,
but product and org workflows should exercise the installed `operon` command
from a neutral directory.

## Live UI

`operon observe` starts the read-only Live UI in the foreground. It resolves
the active org and state home independently of the working directory, binds
only to `127.0.0.1`, and prints a per-process capability URL. Use `--app`,
`--parent-task`, or `--ticket` to deep-link a scoped view; `--open` launches the
local browser. The observer performs no provider turn and spends no tokens.

The page separates app onboarding and non-ticket intake, GitHub delivery work,
and approvals. Open GitHub issues labeled `op:ready` are the only claimable
product-delivery queue. HTTP supplies a versioned snapshot and deliberate
allowlisted evidence; SSE supplies cursor-based live updates. Exact prompts,
briefs, outputs, and `session.log` are never preloaded or streamed; they require
an explicit local fetch, and `session.log` is labeled **activity log—not
transcript**. There are no configuration, approval, retry, merge, label,
deploy, or other mutation routes or controls. Closing the browser or observer
cannot stop a run.

## Setup / auth

The offline commands above need nothing. The live commands need:

- **Claude auth** for `plan`, `loop`, `dispatch`, and `pnpm test:live`. Auth is
  subscription-first (any usable Claude Agent SDK auth counts); `ANTHROPIC_API_KEY`
  is a fallback. `pnpm test:live` skips cleanly when no usable auth is present.
- **Opt-in provider smokes** for the Codex and pi adapters inside `pnpm test:live`:
  set `OPERON_CODEX_LIVE=1` and/or `OPERON_PI_LIVE=1`. (`gpt-5.5` in Codex
  currently requires ChatGPT-account auth, not an API key.)
- **`gh` auth + `GH_SANDBOX_REPO=<owner/repo>`** for the `e2e:sandbox` scripts,
  which create and merge one disposable issue/PR against a private repo.
- **`OPERON_SELF_APPROVAL_SECRET`** so the loop can authorize its own merge in a
  single-token setup. It is the HMAC key behind the self-approval marker the merge
  gate checks; without it the loop cannot sign a merge authorization and the merge
  is withheld as a critical op.

Environment variables are loaded per project from `.env` / `.env.local` at the
git root; there is no `.env.example` yet — the variables above are the full set.

## Testing

The complete offline verification for source changes is:

```bash
pnpm test
pnpm test:observe-browser   # when Live UI code or assets change
pnpm typecheck
pnpm build
pnpm smoke:onboarding
npm pack --dry-run
```

The Live UI browser suite uses a dev-only Playwright dependency and local
Chromium (`pnpm exec playwright install chromium` once). Its fixtures use real
ephemeral loopback HTTP/SSE boundaries but no provider tokens, GitHub writes,
or external browser requests.

## Layout

```
src/runtime/   the runtime contract: Runtime interface, critical-ops gate,
               telemetry, L1-L3 run logs, secret-patterns, adapters
               (Claude SDK, Codex App Server, pi SDK)
src/loop/      pass pipelines, briefs, quality gates, verdict parsing, and
               the ticket -> PR -> review -> merge state machine
src/org/       app registry, bootstrap, co-planning, dispatch, approvals,
               budget overlays, trigger routing, context, memory, scorecards,
               retro, and the governed learning loop (src/org/learning/)
src/observe/   versioned read projection, bounded GitHub source, loopback
               HTTP/SSE server, and framework-free Live UI
src/cli/       one module per subcommand; src/cli.ts is a thin dispatch table
test/          adapter conformance, gate, pipelines, bootstrap, qgates, CLI
research/      decision records
```

Imports flow downward only: `org -> loop -> runtime`.

## Observability: where agent activity is recorded

Two stores, one authority each (both under the org's *state home*,
`~/.operon/<org>/` by default):

```
runs/<app>/<YYYYMMDD-HHMMSS>-<pipeline>-<pass>/
├── envelope.json    # ids, status, timings, token/cost rollups, verdict, replay seed (git_head) — L1
├── events.jsonl     # trace/span-scoped lifecycle events — L2
├── brief.md         # the exact prompt the pass received — L3, verbatim
├── output.md        # what the pass produced — L3, verbatim
└── session.log      # activity log—not transcript; present only when TurnEvents streamed
telemetry/<date>.jsonl    # the org ledger: one row per settled provider turn
invocations/<date>.jsonl  # one row per orchestrator invocation (loop + dispatch)
learning/events/<date>/   # learning-loop capture: gate outcomes, pass verdicts,
                          # human observations, episode lifecycle, late outcomes
learning/episodes/        # EpisodeRecord projection over runs + ledger +
                          # approvals + ticket claim state (M2; rebuildable)
learning/capsules/        # build-episode ReplayCapsules with replayability
learning/fingerprints/    # content-addressed SystemFingerprints
learning/resolved/        # per-turn pinned resolve records with lineage (M4/M5; never prompt bytes)
learning/canary/          # episode-sticky canary assignments (M5; first resolve wins)
learning/publish-journal/ # the publisher's crash-resumable transaction journals (M4)
learning/m6-runs/         # durable distillation/review skip, cap, failure, and output records
learning/compaction/      # weekly report-only compaction snapshots (never bundle mutations)
runs/learning-replay/     # reserved replay namespace (M5) — reconciled for spend,
                          # excluded from capture/episode projection
```

The experiment and activation substrate (M3–M5) lives in the *committed org
home* instead — `learning/experiments/` (ExperimentRecords + EvalResults,
declared before results), `learning/interventions/` (one lineage record per
published change), `learning/evals/**` (sanitized eval fixtures converted
from replay capsules, trusted only after independent validation),
`learning/candidates/` (agent-emitted, no authority, never resolvable),
`learning/reviews/` + `learning/rejections.jsonl` (fail-closed reviewer
verdicts and the suppression ledger), `learning/quarantine/` (human-authored
provisionals with resolver-enforced TTLs), `learning/bundle/**` +
`learning/manifest.yaml` (active concepts, version cuts, and live-canary
trial state), and `learning/proposals/**` (unmerged drafts) — everything
except candidates and proposals is gate-protected; only humans and the
deterministic publisher write inside.

`runs/` is the per-pass source of truth (what was asked, what happened, what
it cost). The ledger is the rollup `operon budget`, `operon status`, retro,
and scorecards read: every provider turn settles into it exactly once, keyed
on its `runId` — completed, blocked, and failed passes alike — so budget caps
are enforced against real spend, and a tick whose app has exhausted its
monthly cap refuses to claim before any pass starts. `operon budget
--reconcile` back-fills the ledger from run envelopes (idempotent).
Subscription-backed provider costs are Operon-computed equivalent-cost
estimates, flagged as such on every row. `operon telemetry --app <app>
[--html out.html]` renders the run view and copies linked artifacts into an
adjacent evidence bundle.

For work delegated from an outer Codex/Claude session, begin a parent record
once with `operon task begin --id <id> --prompt-file <exact-prompt>`, export
the printed `OPERON_PARENT_TASK_ID`, and then run Planner/Builder/Reviewer
commands normally. Use `operon task fallback` before any external/manual
continuation and `operon task finish` only at the actual outcome boundary.
Telemetry joins those child traces back to the exact prompt and will not call
a task “Operon end-to-end complete” when a required stage or Reviewer is
missing, or when execution used a fallback.

`operon plan <app> --auto --goal "..."` chooses planning depth before any
model turn. Quick work uses one combined planning/decomposition pass;
standard uses a visionary, one PM perspective, and a decomposer; deep adds a
second competing PM and arbitration. The route uses explicit risk,
ambiguity, coupling, reversibility, external-consequence, expected-ticket,
and sensitive-domain factors—not prompt length. Every planning envelope
records the policy version, factors, selected/skipped passes with reasons,
and a pre-execution historical cost estimate (or an honest unavailable
marker plus the role-cap upper bound).

`operon learn` is the learning loop's human window; `operon learn --help`
has the full argument semantics. The capture verbs (`report`, `inspect
<episode-id>`, `show <id>`, `emit`, `fixture`) read and annotate episodes
and convert closed episodes into eval fixtures (trusted only after an
independent `--validate --by <someone-else>`). The M4 activation verbs
(`review`, `publish`, `resolve`, `disable`, `rollback`, `provisional`)
drive manual governed activation: review fails closed, activation into
context or T2/T3 raises a content-bound approval, and nothing
self-activates. The M5 evaluation verbs (`experiment declare|run|list`,
`canary start|status|promote|stop`) run the design-§9.5 offline funnel —
paired control/treatment replays in seed worktrees, early stopping, spend
settled into the org ledger and capped by the learning budget `operon
budget` renders — and the human-started, episode-sticky live canary (a T3
live canary is unrepresentable in policy; insufficient volume reads
`inconclusive` — human judgment, never limbo).

## Status

Operon is build-complete and proven live: real Planner/Builder/Reviewer turns
take GitHub issues from `op:ready` through quality gates, PR, cross-provider
review, and squash-merge on real repos — most recently `operon-sandbox-delta`
("Ledgerette"), onboarded from scratch, where the loop fixed and merged both
planted bugs unaided. A proportionality campaign (2026-07-10,
[`docs/proportionality-review.md`](docs/proportionality-review.md)) then
rebuilt the org's economics end to end: per-pass ledger settlement with
enforced budget caps, durable continuation from artifacts, honest stops with
token-free environment preflight, one-pass proportional bootstrap planning
published by the orchestrator, a ratified approval & release boundary (scoped
grants, release handoff, adapter-level role toolset shaping), and a
repeatable clean-room benchmark
([`docs/benchmark-runbook.md`](docs/benchmark-runbook.md)). On top of that
substrate, a governed learning loop
([`docs/learning-loop/`](docs/learning-loop/), ratified 2026-07-11) is complete
and live through M6: every pass is captured into episodes and replay
capsules, and learned changes activate only through human review, offline
paired-replay evaluation, a human-started canary, and M6 scheduled
distillation with independent review and report-only compaction. The latest dated live evidence is
[`research/2026-07-11_adapter-tool-events.md`](research/2026-07-11_adapter-tool-events.md);
open work lives in the [issue tracker](https://github.com/buildstacks-dev/Operon/issues).

`docs/capability-matrix.md` records each adapter's native, adapter-built, and
degraded capabilities. `pnpm test:live` is the gated live-adapter proof.

### Known limitations

- **Live UI V1 is local-only.** It has no remote/public bind, TLS, multi-user
  auth, cloud ingestion, or workflow controls. Use SSH port forwarding to the
  loopback capability URL when observing a remote host. GitHub is polled on a
  bounded interval and may show an explicitly degraded last-known projection
  while local run evidence remains live.

- **Tool-event outcomes are partial on Claude and pi.** All three adapters
  emit `tool_use` turn events (issue #27, live-verified 2026-07-11 —
  `research/2026-07-11_adapter-tool-events.md`), so `envelope.tool_counts`
  is populated and all five anomaly detectors can fire. But Claude and pi
  surface tool calls before execution, so their events carry no
  `success`/`durationMs` outcome fields; per-tool failure and latency
  analytics are Codex-only for now.
- **Interactive co-planning usage is unmeasured.** Interactive `operon plan`
  spawns the native `claude` CLI with inherited stdio, so session tokens never
  flow through Operon; those ledger rows carry an explicit `unmeasured: true`
  marker (cost unknown, not zero). The runtime-backed `plan --auto` mode is
  fully measured — prefer it wherever a goal can be stated non-interactively.
- **Interactive co-planning can use a stale managed clone.** The launcher does
  not yet fetch the remote default branch before cutting its worktree. Tracked
  in [issue #60](https://github.com/buildstacks-dev/Operon/issues/60).
- **Bootstrap publication remains manual.** A safe, draft-PR-only publication
  workflow with exact staging and dry-run semantics is tracked in
  [issue #61](https://github.com/buildstacks-dev/Operon/issues/61).
- **Codex App-Server read bypass:** under the `untrusted` approval policy the
  App Server auto-runs trusted read-only commands (`cat`, `ls`) without an
  approval request, so those reads do not reach the gate hook. Tracked in
  [issue #20](https://github.com/buildstacks-dev/Operon/issues/20) with live
  evidence and the required upstream capability.
