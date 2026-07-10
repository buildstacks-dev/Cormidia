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
`$OPERON_BIN_DIR/operon`) and links the `$operon` Codex skill into
`$CODEX_HOME/skills/operon`. Add `~/.local/bin` to `PATH` if necessary. The
local command is source-backed: the next invocation reads the latest source
changes, so no `operon update`, relink, or rebuild is needed. A packed or
published installation instead runs the compiled `dist/cli.js` binary.

These four locations are intentionally different:

| Location | One-line meaning |
| --- | --- |
| Package root | Operon's installed implementation and reusable templates. |
| Org home | Committed roles, apps, pipelines, prompts, taste, and curated memory. |
| State home | Local high-churn clones, worktrees, locks, approvals, telemetry, and run logs. |
| App repo | An independent product checkout that Operon develops or operates. |

Create the org before onboarding an app; this can be run from any directory:

```bash
operon --version
operon org init ~/Build/my-org --name my-org
operon doctor
operon context
```

`org init` creates a complete org home from packaged templates, creates the
default state home at `~/.operon/<org>`, and records the active org pointer at
`~/.operon/config`. Use `operon org use <path>` to switch to another complete
org. `OPERON_ORG_HOME` and `OPERON_STATE_HOME` are explicit per-process
overrides.

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
```

Bootstrap accepts a local checkout path, never a GitHub URL. It always joins
the active org and writes app-owned files only under the app repo's
`.operon/` directory. Its opening output explains the app repo, org home, and
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

Contributors can still use `pnpm dev <command>` inside the Operon source repo,
but product and org workflows should exercise the installed `operon` command
from a neutral directory.

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

## Layout

```
src/runtime/   the runtime contract: Runtime interface, critical-ops gate,
               telemetry, L1-L3 run logs, secret-patterns, adapters
               (Claude SDK, Codex App Server, pi SDK)
src/loop/      pass pipelines, briefs, quality gates, verdict parsing, and
               the ticket -> PR -> review -> merge state machine
src/org/       app registry, bootstrap, co-planning, dispatch, approvals,
               budget overlays, trigger routing, context, memory, scorecards,
               retro
src/cli/       one module per subcommand; src/cli.ts is a thin dispatch table
test/          adapter conformance, gate, pipelines, bootstrap, qgates, CLI
research/      decision records
```

Imports flow downward only: `org -> loop -> runtime`.

## Status

M0-M12 are complete and the runtime has been hardened and proven live
end-to-end. Implemented and tested: the runtime contract, critical-ops gate,
ClaudeRuntime / CodexRuntime / PiRuntime, the pass executor, L1-L3 run logs,
the app registry, bootstrap flow, co-planning launcher, quality gates
(including a `setup` gate that installs app deps before tests run), typed
verdict parsers with an in-session reformat retry, the GitHub ticket state
machine, the scheduler, the manual loop driver, real Builder/Reviewer pipeline
integration, the approval queue with unforgeable merge authorization, the
budget overlay with auto-pause, Planner and standing-role pipelines,
kind-based company-event routing with channel-presence gating, OKF memory,
full context assembly, per-(app,role) scorecards, and weekly retro
reporting/curation. Manual app commands resolve real app checkouts and
assemble app-aware context.

Proven against real repos:

- **M5** — a disposable private GitHub repo: ready issue → claim → real gates →
  PR → injected review → squash merge → closed issue.
- **M6** — `operon-sandbox-alpha`: real Claude Builder/Reviewer passes shipped
  issue #1 through PR #2 to a merged squash commit.
- **M8** — `operon-sandbox-gamma`: a running `/health` service, a real private
  `op:incident` issue, and Support/Marketing draft artifacts.
- **M11** — the private `buildstacks-dev/buildstacks.dev` repo onboarded as
  `status: onboarding` without changing Operon runtime code.
- **M12 + hardening** — `operon-sandbox-delta` ("Ledgerette") onboarded from
  scratch and driven end-to-end: both planted bugs were fixed live by the loop
  and merged (PRs #11, #12). alpha, beta, gamma, and the live Claude adapter
  conformance were re-verified.

`docs/capability-matrix.md` records each adapter's native, adapter-built, and
degraded capabilities. `pnpm test:live` is the gated live-adapter proof.

### Known limitations

- **Tool-level telemetry is partial.** The L2 event bridge is wired, but the
  adapters do not yet emit `tool_use` turn events, so `envelope.tool_counts`
  stays empty and the `bash_heavy` / `environment_retry` anomaly detectors
  cannot fire. The other three detectors (`low_tokens_high_time`,
  `single_turn_long_run`, `cold_cache`) work off envelope fields that are
  written.
- **The manual `operon loop` path does not feed the org telemetry ledger**
  (`telemetry/<day>.jsonl`); only the autonomous `dispatch` path records turn
  spend there, so `operon budget` shows `$0` for manually-driven loops.
  Per-pass spend is still fully visible in `operon status` and the run
  envelopes. Production uses the dispatcher, which records.
- **Codex App-Server read bypass:** under the `untrusted` approval policy the
  App Server auto-runs trusted read-only commands (`cat`, `ls`) without an
  approval request, so those reads do not reach the gate hook. Tracked in
  `docs/capability-matrix.md` as a live-verify follow-up.
