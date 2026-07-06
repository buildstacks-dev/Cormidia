# The testing journey — how Operon proves itself before touching a real product

Operon is a standing team of AI agents — Planner, Builder, Reviewer, SRE,
Support, Marketing — that develops **and operates** software products
through a private GitHub repo, with the human operator gating anything
critical or irreversible. Before that team is allowed near a production
application, every capability is proven against **test applications**:
real repositories, real commands, real GitHub — but disposable, so
mistakes cost nothing.

This document explains, in plain language, what those test applications
are, what gets tested at each stage of the build plan (TODO.md), and —
honestly — what the current test apps *cannot* cover yet.

## The test applications

Think of them as practice patients for a new surgical team: real enough
that the practice is honest, disposable enough that mistakes are free.

### `operon-sandbox-alpha` — the well-kept project

A small, real Node.js library (statistics helpers) in a private GitHub
repo. It has everything a healthy project has: a test suite, a linter, CI
on every push, contributor documentation. Alpha answers the question:
**does Operon work when a project is set up properly?** It is also the
main stage for the build-loop proofs — tickets flow to merged pull
requests here.

### `operon-sandbox-beta` — the bare-bones project

Another small, real library (string utilities), deliberately minimal:
tests and nothing else. No CI, no docs. Beta answers two questions:
**does Operon cope gracefully when things are missing?** and **is adding
a second application really just configuration?** Beta joins the existing
organization rather than creating a new one, and its acceptance check is
strict: after onboarding, the only change in the Operon repo is one entry
in `apps.yaml` — never code.

Neither app is ever touched by the ordinary offline test suite
(`pnpm test`); they exist for functional verification — real commands
against real repos.

## The journey, stage by stage

| Stage | Question it answers | What actually runs against the test apps |
| --- | --- | --- |
| **M3 — Onboarding** | Can Operon move into a project? | `operon bootstrap` scans each repo, learns its build/test commands, asks a short questionnaire, and sets up the app workspace (charter, config, memory). Alpha proves detection of existing setup; beta proves graceful absence + config-only joining. A planning session opens against an app. |
| **M4 — Quality gates** | Can work be checked mechanically, trusting no one's word? | The gate machinery (tests, lint, secret scan, completeness, review freshness) is built and proven on local fixtures — it becomes the checkpoint everything later must pass. |
| **M5 — The build loop** | Can a task flow through the factory? | Completed 2026-07-06 against a disposable private GitHub repo: setup creates the `op:*`, priority, and tier labels idempotently; the e2e creates one ready issue, claims it, makes a tiny branch change, runs real quality gates, opens a PR, injects the simulated approval, squash-merges, deletes the branch, and verifies the issue closed. |
| **M6 — Fully real delivery** | Can it do the whole thing for real? | One real, small ticket goes ready → merged with a real AI builder writing code and a real AI reviewer critiquing it. Evidence recorded. |
| **M7 — Unattended operation** | Can it run alone — and stop when it should? | The dispatcher wakes on schedule and works without a human driving. Crashes recover; budgets auto-pause an overspending app. The safety drill: an agent attempts a critical operation on a sandbox app, is blocked, the request lands in the human's approval queue, approval releases exactly that one action, and a complete audit trail exists. |
| **M8 — Planning + standing roles** | Can it plan, not just build? | The Planner drafts a spec for a sandbox app, decomposes it into small tickets with checkable acceptance criteria, and triages incoming bug reports. SRE, Support, and Marketing also get concrete v0 pipelines and a trigger-routing path, so scheduled/event turns do real protocol work. |
| **M9 — Learning & visibility** | Does it get better, and can you see what it does? | Agents record lessons per app and reuse them; each role gets a scorecard; a weekly retro turns scores into adjustments; status/analysis views work without reading transcripts. |
| **M10 — Multiple AI providers** | Does it work beyond one vendor? | Builder and reviewer run on different AI providers (uncorrelated review blind spots), verified with real turns; a capability matrix records what each provider supports. |

**After M10 the product is build-complete.** Only then are the real
applications onboarded — together with the human operator, as a launch
step rather than an experiment.

## What the current test apps cover — and what they don't

The two sandbox apps give real, non-simulated coverage of the **software
development workflow**: planning, building, reviewing, gating, shipping,
approvals, budgets, memory, multi-app, multi-provider. That is the
product's center of gravity, and it is fully exercised.

But the org's vision is bigger than writing code, and both sandbox apps
are code *libraries* — nothing runs in production, no users write in,
no releases reach an audience. That leaves three role surfaces without a
real functional target today:

1. **SRE on a running service.** The SRE role's job is health sweeps,
   reacting to CI failures and alerts, and incident notes. CI failure is
   testable on alpha today (break the main branch, watch the `ci-failed`
   reaction). But health-checking a *live service*, diagnosing a real
   outage, and deploy-shaped operations need an application that actually
   runs somewhere.
2. **Support.** The Support role digests user feedback into the Planner's
   intake and drafts replies (drafts only — posting publicly is always
   human-gated). With no users, there is nothing real to digest.
3. **Marketing.** Partially testable already: once real merges flow
   (M6+), the `release-shipped` trigger can produce changelog and
   launch-note *drafts* from real shipped work. Positioning and
   adoption-signal work needs richer material.

### The planned answer: a third test application

Approved 2026-07-06 and slotted in TODO.md as M8.5:
**`operon-sandbox-gamma` — a tiny deployable web service**
(a small HTTP API with a health endpoint and a local/container deploy
script), plus a seeded, synthetic user-feedback inbox.

That one addition makes the remaining surfaces testable with real
functionality and zero outward blast radius:

- **SRE:** the hourly sweep checks a real health endpoint; killing the
  service produces a real alert → incident note → Planner ticket; the
  deploy script is a real critical-op target for the approval queue.
- **Support:** the feedback inbox contains realistic user messages; the
  digest and reply drafts are produced from real material and stay
  drafts.
- **Marketing:** real releases of a real (toy) service feed changelog and
  launch-post drafts.

The standing principle throughout: **nothing outward-facing is ever
actually published during testing** — no posts, no emails, no DNS
changes. Outward actions terminate as drafts or approval-queue items;
that is the same gate the production org lives behind.
