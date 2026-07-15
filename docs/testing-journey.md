# The testing journey — how Operon proves itself before touching a real product

Operon is a standing team of AI agents — Planner, Builder, Reviewer, SRE,
Support, Marketing — that develops **and operates** software products
through a private GitHub repo, with the human operator gating anything
critical or irreversible. Before that team is allowed near a production
application, every capability is proven against **test applications**:
real repositories, real commands, real GitHub — but disposable, so
mistakes cost nothing.

The durable qualification bar, attempt outcomes, isolation rules, and route
measurements are defined in `docs/efficiency.md` and implemented by `eval/**`.
The sandbox journey supplies product evidence; a successful demo or one
favorable run cannot replace the predeclared qualification campaign.

This document explains, in plain language, what those test applications
are, what gets tested at each stage of the build plan (the M0–M12 roadmap,
now archived in git history; open work lives in the GitHub issue tracker), and —
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
tests and nothing else. No CI, no `AGENTS.md` (a README is present). Beta
answers two questions: **does Operon cope gracefully when things are
missing?** and **is adding a second application really just configuration?**
Beta joins the existing organization rather than creating a new one, and its
acceptance check is strict: after onboarding, the only change in the Operon
repo is one entry in `apps.yaml` — never code. Beta stays minimal by design;
it is the "what's missing" case, so it is deliberately not hardened.

### `operon-sandbox-gamma` — the running service

A tiny Node HTTP service with `/health`, a Dockerfile, a deploy-shaped local
drill script, and synthetic support/adoption/health/launch events. Gamma
answers the question: **can Operon exercise SRE, Support, and Marketing
against realistic operating material before production onboarding?**

### `operon-sandbox-delta` — the realistic from-scratch target

"Ledgerette": a small but realistic zero-dependency expense-tracking JSON
API, with a real ESLint config, CI, integration tests, and a planted-bug
backlog. Where alpha is a *well-kept* toy and beta a *bare* one, delta is the
**comprehensive from-scratch case**: a project that looks like something a
team would actually hand over — proper linting, real integration coverage, a
multi-issue backlog including deliberately planted bugs. Delta answers the
question: **can Operon be onboarded onto an unfamiliar, realistically-shaped
codebase and take a real defect all the way to a merged fix?**

It is the target where the live loop was proven end-to-end this campaign: two
planted bugs were picked up as tickets, built, gated, reviewed, and
squash-merged as real pull requests. Delta's `.operon/` workspace lives in
the delta repo itself, the same as any onboarded app.

Alpha and gamma were also hardened over the campaign (more modules and tests,
so the loop exercises a larger surface); beta is left minimal on purpose (the
"graceful when things are missing" case).

The sandbox apps are never touched by the ordinary offline test suite
(`pnpm test`); they exist for functional verification — real commands
against real repos.

## The qualification test world

Mutable sandbox repositories remain useful exploratory targets, but efficiency
qualification now uses the hermetic `EvalWorld` and committed assets under
`eval/`. Every attempt receives a synthetic home, disposable org/state,
content-addressed sparse/library/service seed, managed worktree, and hidden
verifier outside actor-readable paths. The exact executable and campaign are
hashed; production org/state/apps are forbidden targets.

The layers are cumulative: L0 static contracts, L1 pure/property oracles, L2
filesystem/git/process integration, L3 local bare-remotes and lifecycle fault
tests, L4 an allowlisted private `operon-eval-*` GitHub repo, L5 explicit
provider behavior, and L6 bounded soak/confirmation. `pnpm eval:validate`,
`pnpm test:transformation`, and `pnpm eval:deterministic` spend no tokens.
Missing auth, usage, evidence, or a required attempt is incomplete/invalid—not
a passing skip.

Provider qualification is deliberately two-stage. The adapter calibration
case checks task and large-payload transport, tool/gate events, cancellation
with partial usage, continuation identity, budget enforcement, cache evidence,
and honest role-shaping capability for Claude, Codex, and pi. Product cases
then run through Operon's ordinary pass executor so every provider call has a
run envelope and exactly one ledger settlement. The separate L6 runner spreads
only its declared useful turns across 48–72 hours, records all other due ticks
mechanically, and requires a distinct-process receipt at the predeclared
restart hour.

Phase 6 promotion does not trust a copied pass marker. The qualifier emits a
deterministic JSON result beside the portable HTML report; a schema-v2 archive
retains every selected result, hidden-grader/verifier record, and independent
attempt-accounting receipt. A content-bound release attestation permits only
sanitized evidence/status documentation after the exact candidate commit and
proves the installable package, executable eval suite, and org bytes are
unchanged. Contract tests recompute the outcome and reject stale, foreign,
malformed, duplicated, missing, grader-failed, or settlement-mismatched
evidence. L6 is reconciled independently from all 576 ticks, the 12 useful
runs, ledgers, envelopes, and the distinct-process restart receipt.

The first Phase 6 candidate campaign remains a useful negative proof rather
than a disposable rehearsal. It is archived with 11 passes, eight product
misses, three infrastructure-invalid attempts, and an incomplete tail. The
corrected harness turns unavailable provider usage into explicit missing
denominators, and corrected actor-visible contracts pin compatibility details
without revealing hidden answers. The exact retained evidence and correction
handoff live in
`research/evals/2026-07-15-phase6-candidate-qualification-invalid.md`.

The paired learning proof likewise cannot be a fixture verdict. A predeclared
T1 procedure is injected only into the three treatment arms. Operon hashes the
six actual provider candidates, independent reviewer observations, and hidden
grader records; computes all three treatment-minus-control deltas; and retains
inconclusive, regressed, or invalid outcomes unchanged. A measured improvement
still does not activate anything: a separate preview produces the exact
candidate/action hashes for one isolated governed activation and rollback,
which needs its own human authorization beyond the L5 spend decision.

The 2026-07-12 provider baseline is recorded in
`research/evals/2026-07-12-pre-transformation-baseline.md`. Its misses and
safety stop are retained as the pre-feature comparison point. The later T0–T5
audit deliberately invalidated that v1 bundle under the hardened result schema
rather than inventing missing measurements. The replacement adapter calibration
qualified on 2026-07-13; the replacement provider baseline remains a separate,
explicitly authorized T4 operation. Product misses are expected baseline
evidence when the harness, graders, run records, settlements, and accounting
remain complete and reconcilable.

## The journey, stage by stage

| Stage | Question it answers | What actually runs against the test apps |
| --- | --- | --- |
| **M3 — Onboarding** | Can Operon move into a project? | `operon bootstrap` scans each repo, learns its build/test commands, asks a short questionnaire, and sets up the app workspace (charter, config, memory). Alpha proves detection of existing setup; beta proves graceful absence + config-only joining. A planning session opens against an app. |
| **M4 — Quality gates** | Can work be checked mechanically, trusting no one's word? | The gate machinery (tests, lint, secret scan, completeness, review freshness) is built and proven on local fixtures — it becomes the checkpoint everything later must pass. |
| **M5 — The build loop** | Can a task flow through the factory? | Completed 2026-07-06 against a disposable private GitHub repo: setup creates the `op:*`, priority, and tier labels idempotently; the e2e creates one ready issue, claims it, makes a tiny branch change, runs real quality gates, opens a PR, injects the simulated approval, squash-merges, deletes the branch, and verifies the issue closed. |
| **M6 — Fully real delivery** | Can it do the whole thing for real? | Completed 2026-07-06 on `operon-sandbox-alpha`: issue #1 was built by real Claude Builder passes, checked by real gates, reviewed by real Claude Reviewer output recorded as a GitHub review comment fallback (same-account APPROVE is blocked by GitHub), and squash-merged as PR #2. |
| **M7 — Unattended operation** | Can it run alone — and stop when it should? | Completed deterministically in Phase 5: the org-scoped scheduler previews/installs/statuses/uninstalls through an injected manager; seven virtual days exercise 2,016 durable decisions, four restart/crash boundaries, locks, WIP, per-app budgets, approvals, channel gates, empty learning, and missed windows. Every decision executes once or records one typed reason; duplicate/orphan/provider-mechanical leakage remains zero and FakeRuntime turns exactly match settlements. A real host install and 48–72 hour L6 soak remain separately authorized. |
| **M8 — Planning + standing roles** | Can it plan, not just build? | Completed 2026-07-06: the root protocol now has executable `plan`, `groom`, `triage`, SRE, Support, and Marketing pipelines; dispatch routes roles.yaml triggers to those protocols; file-drop company event schemas are documented and validated. Gamma proves the non-build roles with a running `/health` service, private `op:incident` issue, and draft-only Support/Marketing artifacts. |
| **M9 — Learning & visibility** | Does it get better, and can you see what it does? | Agents record lessons per app and reuse them; each role gets a scorecard; a weekly retro turns scores into adjustments; status/analysis views work without reading transcripts. |
| **M10 — Multiple AI providers** | Does it work beyond one vendor? | Builder and reviewer run on different AI providers (uncorrelated review blind spots), verified with real turns; a capability matrix records what each provider supports. |
| **M12 — Manual app hardening** | Do human-invoked app commands use the actual app, not the org repo? | Completed 2026-07-06: plan/run-role dry-runs resolve managed or sibling sandbox checkouts, assemble app-aware context, and were verified across alpha, beta, and gamma after the full package gates and Claude live conformance. |

### Phase 4 closed-learning fixture

The efficiency transformation adds a token-free closure gate on top of M9.
Temporary org/state trees receive trusted environment-retry, stale-finalization,
shell-repetition, false-approval, and long-review records. Production capture
must either project every eligible finalized provider run exactly once or name
the blocking run and typed reason; mechanical and `learning-replay` records are
ineligible. Comparable app/role events form stable clusters and dispositions,
then reuse the existing candidate, independent-review, experiment, approval,
publisher, intervention, and canary chain. Declared paired observations prove
an improvement with hidden guardrails while sham/harmful variants cannot
promote; disable/rollback restores stable lineage. The fixture constructs no
runtime, makes no network call, and writes only inside its temporary trees.

### Phase 5 autonomous-production fixture

The Phase 5 gate starts from fresh temporary HOME, TMPDIR, org, state, app, and
scheduler-definition trees. It previews with zero writes, uses an injected
launchd/systemd-manager boundary, proves install/status/repair/uninstall
idempotency and hostile-definition refusal, and rebuilds status exclusively
from durable evidence after restart. The production virtual-soak module—not an
eval helper—runs 2,016 five-minute windows across seven days, including four
process/crash restarts. SRE, Support, and Marketing run through ordinary
FakeRuntime passes and persist source-hashed, draft-only artifacts plus one
Planner feed each; deploy-shaped SRE work remains parked. No real scheduler,
provider, repository, or outward integration is touched.

The five deterministic Workstream I contracts (`I-INSTALL-01..02` and
`I-SOAK-01..03`) are production-backed. `I-ROLE-01..03` remain provider-result
contracts and `I-LIVE-01` remains the authorized 48–72 hour campaign, so their
deterministic paths do not promote those four contracts.

The public read is `operon learn report --efficiency-health [--json]`.
`--refresh` is the sole explicit projection-write switch; capture, governance,
and efficacy remain separate so event volume cannot manufacture a green
efficacy result.

Build work continued past M10 through the M12 manual-app hardening and a
follow-on hardening campaign (atomic org state, per-tick budget auto-pause,
the setup gate, per-app clone serialization, kind-based company-event
routing, and the delta from-scratch onboarding). Real-application onboarding
is not gated behind a single "build-complete" moment: the first production
app, **buildstacks.dev**, is registered in `apps.yaml` at
`status: onboarding` — frozen as the proportionality benchmark baseline
(docs/proportionality-review.md §5 Stage 7). The sandbox benchmark met its
targets on 2026-07-11 (round 2, docs/proportionality-review.md §7); its
re-entry as the production confirmation is now an open disposition
(issue #17) awaiting a human go.

## What the current test apps cover — and what they don't

The sandbox apps give real, non-simulated coverage of the **software
development workflow**: planning, building, reviewing, gating, shipping,
approvals, budgets, memory, multi-app, multi-provider. That is the
product's center of gravity, and it is fully exercised — most recently
end-to-end on delta, where the live loop took two planted defects to merged
fixes.

But the org's vision is bigger than writing code, and the sandbox apps are
toy targets — alpha, beta, and delta are code that runs only in tests, and
gamma is a service that runs only locally: nothing serves real production
traffic, no real users write in, no releases reach an audience. That leaves
three role surfaces without a fully real functional target today (gamma
exercises them against *synthetic* operating material, below):

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

### The third test application

Created and smoke-tested 2026-07-06 as roadmap item M8.5:
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

The M8.5 smoke produced a real private `op:incident` issue from an unhealthy
health check, Support reply drafts from synthetic feedback, and Marketing
release/changelog drafts from the `v0.1.0` sandbox tag.

The standing principle throughout: **nothing outward-facing is ever
actually published during testing** — no posts, no emails, no DNS
changes. Outward actions terminate as drafts or approval-queue items;
that is the same gate the production org lives behind.
