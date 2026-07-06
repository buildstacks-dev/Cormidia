# Operon

An **org runtime**: a standing team of AI agents (Planner, Builder, Reviewer,
SRE, Support, Marketing) that develops and operates a software product through
a private GitHub repo, with a human approver gating critical operations only.

```mermaid
flowchart TD
    T["Timer tick (~5 min)"] --> D["Dispatcher<br/>reads roles, apps, schedule state, events"]
    D -->|"for each due (role, app)"| R["Turn runner<br/>assembles context, cuts worktree"]
    R --> A["Runtime adapter<br/>claude | codex | pi"]
    A -->|"every tool action"| G{"Critical-ops gate"}
    G -->|"routine op"| GH[("GitHub<br/>issues, PRs, reviews, merges")]
    G -->|"critical op"| Q["Approval queue"]
    Q --> H["Human approver"]
    H -->|"grant / deny"| D
    GH -->|"events polled next tick"| D
```

Read [`docs/PURPOSE.md`](docs/PURPOSE.md) for the why and every decision made so far;
[`TASTE.md`](TASTE.md) is the org's constitution;
[`roles.yaml`](roles.yaml) is the org chart made executable.

## Layout

```
src/runtime/   the runtime contract: Runtime interface, critical-ops gate,
               telemetry, run logs, adapters (claude live; codex/pi stubbed)
src/loop/      pass pipelines, briefs, quality gates, verdict parsing, and
               the ticket → PR → review → merge state machine
src/org/       app registry, bootstrap, co-planning, roles loader;
               scheduler/approvals/memory/retro still upcoming
test/          adapter conformance, gate, pipelines, bootstrap, qgates
research/      decision records
```

Imports flow downward only: `org → loop → runtime`.

## Commands

```bash
pnpm install
pnpm test               # fast offline suite
pnpm typecheck
pnpm dev roles          # validate roles.yaml, print the org chart
pnpm dev apps           # validate apps.yaml, print the app registry
pnpm dev pipelines      # validate pipelines.yaml, print pass table
pnpm dev loop --app operon-sandbox-alpha --once --dry-run
                        # inspect ready-ticket loop plan without claiming
pnpm dev doctor         # runtime adapter status
GH_SANDBOX_REPO=<owner/repo> pnpm e2e:sandbox:setup
GH_SANDBOX_REPO=<owner/repo> pnpm e2e:sandbox
                        # disposable real-GitHub M5 loop proof
```

Usage docs (pointing the org at an app and running it) will land once the
dispatcher ships.

## Status

M0-M5 are complete. The runtime contract, critical-ops gate, ClaudeRuntime,
pass executor, run logs, app registry, bootstrap flow, co-planning launcher,
quality gates, typed verdict parsers, GitHub ticket state machine, scheduler,
and manual loop driver are implemented and tested. M5 is proven against a
disposable private GitHub repo: ready issue → claim → real gates → PR →
injected review → squash merge → closed issue. The next build milestone is
M6: wiring real Builder and Reviewer pass pipelines into that loop.

CodexRuntime and PiRuntime are still planned for M10; until then, the live
adapter is ClaudeRuntime and `pnpm test:live` is the gated live-conformance
proof.
