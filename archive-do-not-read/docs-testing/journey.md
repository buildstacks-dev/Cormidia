# The testing journey — how Operon proves itself before touching a real product

Operon is a standing team of AI agents — Planner, Builder, Reviewer, SRE,
Support, Marketing — that develops **and operates** software products
through a private GitHub repo, with the human operator gating anything
critical or irreversible. Before that team is allowed near a production
application, every capability is proven against **test applications**:
real repositories, real commands, real GitHub — but disposable, so
mistakes cost nothing.

The durable qualification bar, attempt outcomes, isolation rules, and route
measurements are defined in `docs/episodes/contract.md` and implemented by `eval/**`.
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

Promotion never trusts a copied pass marker. The qualifier emits a
deterministic JSON result, an archive retains every selected result and
hidden-grader record, and contract tests independently recompute the outcome —
rejecting stale, foreign, malformed, duplicated, missing, grader-failed, or
settlement-mismatched evidence. How a qualified result then survives into a
release without being quietly detached from the code it certifies is the
attestation contract in
[`docs/qualification/design.md`](../qualification/design.md).

The ratified Phase 6 boundary separates that future real-time proof from the
completed current qualification without weakening either. The current
83-contract scope is green after the qualified 34-attempt candidate matrix and
nine bound evidence promotions. `I-LIVE-01` alone remains `future_soak`: it is
pending, not passed, and neither the virtual soak nor production confirmation
can promote it. The canonical definition is
[`docs/qualification/design.md`](../qualification/design.md#phase-6-qualification-scope).

Failed campaigns are kept, not rerun. Three invalid candidate campaigns and
the invalidated 2026-07-12 provider baseline are retained as negative proofs —
each one exposed a real harness or contract defect, each correction is
documented, and none was rescored or replaced. The full forensics (exact pass
counts, costs, hashes, and correction handoffs) live where dated evidence
belongs, in `research/evals/`:
`2026-07-15-phase6-candidate-qualification-invalid.md`,
`2026-07-15-phase6-pi-codex-candidate-invalid.md`,
`2026-07-15-phase6-scope-split-candidate-invalid.md`, and
`2026-07-12-pre-transformation-baseline.md`.

The paired learning proof is likewise never a fixture verdict: a predeclared
treatment is injected only into treatment arms, hidden graders score the real
provider artifacts, and even a measured improvement activates nothing without
its own separately authorized decision. The full procedure is
[`docs/qualification/design.md`](../qualification/design.md) → Phase 6
learning-efficacy measurement.

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
`I-SOAK-01..03`) are production-backed. `I-ROLE-01..03` additionally have
qualified provider-result projections from the final candidate campaign.
`I-LIVE-01` remains the future authorized 48–72 hour campaign; deterministic
or standing-role evidence cannot promote it.

The public read is `operon learn report --efficiency-health [--json]`.
`--refresh` is the sole explicit projection-write switch; capture, governance,
and efficacy remain separate so event volume cannot manufacture a green
efficacy result.

Build work continued past M10 through the M12 manual-app hardening and a
follow-on hardening campaign (atomic org state, per-tick budget auto-pause,
the setup gate, per-app clone serialization, kind-based company-event
routing, and the delta from-scratch onboarding). The sandbox benchmark met
its targets on 2026-07-11 (round 2). The first production-app attempt,
**buildstacks.dev**, ended honestly rather than successfully: its
production-confirmation run missed the Stage 7 targets, and the app was
deliberately offboarded with a guarded, archived `operon app reset` —
recorded in the
[frozen-state disposition issue #17](https://github.com/buildstacks-dev/Operon/issues/17)
(closed 2026-07-12) as an explicit failed/incomplete result, not a false
success. A future production attempt re-onboards from a deliberate checkout
as new work.

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

### How gamma narrows that gap

Gamma exists precisely to shrink those three gaps with zero outward blast
radius: the SRE hourly sweep checks a real health endpoint (killing the
service produces a real alert → incident note → Planner ticket, and the
deploy script is a real critical-op target for the approval queue); Support
digests a seeded feedback inbox into drafts; and Marketing turns real sandbox
releases into changelog and launch-note drafts. Its creation smoke (M8.5,
2026-07-06) produced a real private `op:incident` issue from an unhealthy
health check, Support reply drafts from synthetic feedback, and Marketing
release drafts from the `v0.1.0` tag — synthetic material, real machinery.

The standing principle throughout: **nothing outward-facing is ever
actually published during testing** — no posts, no emails, no DNS
changes. Outward actions terminate as drafts or approval-queue items;
that is the same gate the production org lives behind.
