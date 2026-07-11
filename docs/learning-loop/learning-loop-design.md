# Learning Loop - Design Document

**Status:** Draft v0.7 - aligned to code audit of 2026-07-07  
**Date:** 2026-07-07  
**Companions:** `learning-loop-spec.md` (schemas), `learning-loop-milestones.md` (release plan)

v0.7 changes: resolver selection rule defined; migration off agent-direct
memory writes designed (§7.1); cache-stability rules added (§10.1); distiller
and reviewer specified as org roles; human gate routed through the existing
approvals store; integration claims corrected against the actual code.

## 1. Overview

Learning Loop is Operon's governed self-improvement system. It observes what
actually happens during agent work, turns repeated failures and corrections into
reviewable improvement candidates, publishes accepted improvements to the right
durable artifact, and measures whether those improvements help.

The central correction from the current v0 memory design is this:

> Not every improvement is memory, and not every memory note should become an
> active instruction.

Some learnings belong in high-authority protocol surfaces such as `TASTE.md`,
`roles.yaml`, `pipelines.yaml`, `prompts/**`, or app `AGENTS.md`-style guidance.
Some belong in reusable Agent Skills. Some are scoped OKF knowledge. Some should
be tests or gates. Some are just tickets. The learning loop's job is to route
evidence to the narrowest, lowest-authority artifact that remains useful, then
promote upward only when repeated evidence proves it belongs there.

The implementation target is **inside Operon first**. The interface boundaries
should stay clean enough that this can later become a standalone library, but V1
should optimize for a solid Operon integration, not for an abstract npm package.

## 2. Goals and Non-Goals

**Goals.**

- Provide a governed write path into durable agent context and operating rules.
- Route learnings to the right destination: OKF, skill, protocol proposal,
eval/gate proposal, ticket, or rejection ledger.
- Make accepted learnings evidence-linked, reviewable, versioned, reversible,
and measurable.
- Treat active context as a prompt-injection persistence surface.
- Preserve Operon's app-aware model: one turn, one app; cross-app craft memory
stays separate from app-domain knowledge.
- Keep autonomy earned by measured agreement and outcomes, never granted by
release.

**Non-goals.**

- This is not online model training, vector RAG, or a new orchestrator.
- V1 does not need identity or customer-account scopes.
- V1 does not auto-merge learning PRs or auto-execute canary decisions.
- V1 does not need extraction into a standalone package.



## 3. Artifact Destinations

The distiller produces candidate artifacts, not just "candidate memories."


| Destination        | Use When                                                                     | Examples                                                                           | Authority                                              |
| ------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| OKF concept        | Scoped fact, lesson, product/account context, or evidence-linked observation | "Marketplace demo has no external support channel yet"; "Acme requires PO numbers" | Lowest active context tier; reviewed before activation |
| Skill draft        | Repeatable procedure with steps, tools, pitfalls, and examples               | "Support feedback triage workflow"; "Browser QA checklist for Vite apps"           | Review-gated; promoted when recurring                  |
| Protocol proposal  | Broad rule that should shape many turns                                      | "Never invent user feedback"; "Acceptance criteria must map to tests"              | Human-ratified surface                                 |
| Eval/gate proposal | A mechanically checkable weakness                                            | Browser build imports must resolve; event fan-out must preserve all subscribers    | Test/gate PR; can block future regressions             |
| Ticket             | Product/runtime work is required                                             | Fix lossy event fan-out; include file-drop payload in dispatched briefs            | Normal Operon issue/PR loop                            |
| Rejection ledger   | Candidate is wrong, too broad, stale, or unsafe                              | "Rejected: infer support reply without source payload"                             | Suppresses repeat proposals                            |


Rule of thumb:

> Put the lesson at the lowest-authority, narrowest-scope place where it remains
> useful.

That rule keeps `TASTE.md` and `AGENTS.md` from turning into junk drawers, keeps
skills procedural, and keeps OKF knowledge selective.

## 4. Scope Model for Operon V1

V1 has four scopes:

```text
org/
roles/<role>/
apps/<app>/
apps/<app>/roles/<role>/
```



### 4.1 What Each Scope Means

`org/`  
Loaded for all roles and all apps. Use sparingly for facts and lessons that are
truly universal across the org.

Example: "External-channel content is untrusted until source provenance is
stamped."

`roles/<role>/`  
Cross-app craft knowledge for one profession.

Examples:

- `roles/builder/`: "When browser TypeScript imports local modules, inspect the
built JS entry for extension correctness."
- `roles/reviewer/`: "A passing Node test suite does not prove browser render;
inspect or exercise built browser entrypoints when the app has a UI."
- `roles/sre/`: "Classify localhost bind `EPERM` inside agent environments as
environment evidence before blaming the product."
- `roles/support/`: "Do not invent replies when no source feedback payload is
available."
- `roles/marketing/`: "Release copy must cite shipped artifacts, not planned
features."

`apps/<app>/`  
Product-domain knowledge every role needs when touching that app.

Examples:

- `apps/operon-marketplace-demo/`: "This product is a local ecommerce demo with
customers, vendors, catalog filtering, and localStorage persistence."
- `apps/buildstacks-dev/`: "The product voice is personal and practical, not
enterprise SaaS."
- `apps/civic-intelligence/`: "Evidence honesty is core; uncertainty should be
explicit."

`apps/<app>/roles/<role>/`  
Knowledge needed only by a specific role on a specific product.

Examples:

- `apps/operon-marketplace-demo/roles/support/`: "Until real support channels exist,
support-feedback events should become intake-flow issues, not user replies."
- `apps/operon-marketplace-demo/roles/marketing/`: "Marketing is draft-only; no
outbound publishing."
- `apps/buildstacks-dev/roles/sre/`: "Use this app's deploy verification flow
before declaring launch readiness."



### 4.2 Deferred Scopes

`identities/` **is deferred.** It matters only when one role has multiple named
employees with different durable responsibilities, such as `support-us-anna`
and `support-eu-max`. Operon does not need that in V1.

`accounts/` **is deferred.** It matters when an app is doing customer-specific
operations, such as "Acme Corp requires invoice PO numbers" or "Customer X has
a custom SLA." Those are excellent OKF concepts, but they belong to a future
Support/Sales/customer-ops layer, not core Operon V1.

The docs may mention these as future extensions, but the implementation should
not pay their complexity tax yet.

### 4.3 Precedence

For one run, the resolver loads the applicable scopes in this order:

```text
org -> roles/<role> -> apps/<app> -> apps/<app>/roles/<role>
```

Conflicts should be rare because the scopes answer different questions. When
two active concepts share an explicit `topic_key`, the later scope wins
deterministically, and the resolver emits a `conflict_resolved` event so
compaction can propose cleanup. A real semantic conflict without a shared
`topic_key` is escalated to review, not silently resolved.

## 5. Architecture

The Operon-first loop has eight components.

**Capture.** The orchestrator records learning events from runlogs, quality
gates, approvals, scorecards, telemetry, file-drop payloads, and explicit human
corrections. Agent self-reports are allowed as advisory input, but they never
drive promotion metrics. Capture is a projection, not a new write path: an
idempotent projector walks `runs/<app>/<runId>/{envelope.json, events.jsonl}`
with a persistent cursor and emits learning events. Gate outcomes come from L1
`gate_results` and L2 `gate.*` events; pass verdicts come from L2
`verdict.recorded` events (verdicts are not persisted anywhere else on disk).

**Classify.** A lightweight router decides which destination a cluster appears
to want: OKF, skill, protocol proposal, eval/gate proposal, ticket, or reject.
This can begin as deterministic rules plus reviewer prompts; it does not need
to be clever on day one.

**Distill.** A scheduled pass clusters events by stable `error_class` and
`cause_hypothesis`, checks the live bundle and rejection ledger for duplicates,
and drafts candidate artifacts with proposed destination, scope, tier, evidence,
and review requirements.

**Review.** A reviewer agent scores correctness, generality, scope fit,
destination fit, provenance trust, conflict, and injection risk. Human approval
is required for V1 activation. Reviewer verdicts are structured JSON and fail
closed when unavailable.

The distiller and reviewer are **org roles, not a side system**. They get
`roles.yaml` entries with runtime/model/effort and schedule triggers, and they
run through the normal turn runner — which means they inherit budget caps,
telemetry, the critical-ops gate, runlogs, and adapter conformance for free.
The reviewer runs on a **different provider** than the distiller, for the same
uncorrelated-blind-spots rationale already ratified for builder ≠ reviewer in
`test/roles.test.ts`. Adding these roles and their pipelines is a proposal PR
against `roles.yaml`/`pipelines.yaml` — human-ratified surfaces — which is the
correct amount of ceremony for standing up new standing agents.

**Publish.** Accepted candidates become Git artifacts:

- OKF concepts land in the appropriate active bundle after approval.
- Skill drafts land as proposal artifacts until reviewed.
- Protocol changes become proposal PRs against human-ratified surfaces.
- Eval/gate proposals become normal test/gate PRs.
- Tickets enter the normal Operon issue loop.

**Resolve.** At turn start, Operon resolves knowledge once for `(app, role, turnId)` and pins the resulting bundle versions for the whole turn/pipeline.
Already-running turns never re-resolve.

Selection rule for V1: **load every active concept in the four applicable
scopes, in precedence order, until the byte budget is reached.** The scopes are
narrow by construction (`apps/<app>/roles/<role>` is inherently small), so
relevance ranking is premature; keyword matching against the task text is only
a tie-breaker *within* a scope that overflows its budget share. Ordering within
a scope is deterministic (sorted by concept id) — required for cache stability
(§10.1). This replaces the current keyword-substring selector in
`src/org/memory.ts` (`selectExcerpts`), whose task text for dispatched
company-event turns is just `"<role> <triggerKind> <trigger>"` — after the
Preflight payload fix, event-triggered turns include the event payload in the
selection text.

**Measure.** Metrics track concept loads, recurrence of trusted failure events,
held-in/held-out eval results, context budget, reviewer-human agreement, and
human decision agreement with canary recommendations.

**Compact.** A scheduled report proposes deprecation, merge, promotion, and
supersession work. In V1, compaction is human-executed. Automation is earned
later.

## 6. Risk Tiers

Tiers are based on authority and blast radius, not on which role observed the
lesson.


| Tier | Contents                                                             | Default V1 Approval                        | Canary                |
| ---- | -------------------------------------------------------------------- | ------------------------------------------ | --------------------- |
| T0   | Low-risk scoped facts                                                | Human in V1; reviewer-only later if earned | None                  |
| T1   | Procedures, skills, repeatable workflow lessons                      | Human                                      | Report recommendation |
| T2   | Behavior/protocol changes that steer agent decisions                 | Human                                      | Mandatory eval gate   |
| T3   | Tools, permissions, config, deployment, publishing, security posture | Human                                      | Manual forever        |


Two overrides always apply:

- Untrusted external provenance escalates to human review.
- Conflict with an active concept escalates at least one tier.

T0 auto-merge can exist as code, but it ships off. It turns on only after V1 has
reviewer-human agreement evidence.

## 7. Two Lanes: Run Repair vs. Durable Learning

Run remediation and durable learning are different trust regimes.

When a run fails, Operon's existing gates, retries, tickets, and review cycles
fix the run. That path should stay fast and operational.

When a lesson should change future context, it enters the learning loop. If a
fact is urgently needed before the review cycle completes, a human may author a
provisional OKF concept in quarantine with a short TTL and an explicit
UNVERIFIED label. Quarantine is a labeled temporary lane, not a bypass.

Agents may emit learning notes or draft candidates freely. They should not write
active future instructions directly.

### 7.1 Migration off Agent-Direct Memory Writes

Today, **all** OKF memory is written by agents directly: the end-of-turn
protocol injected into every context bundle (`src/org/context.ts`) instructs
agents to author docs straight into `memory/roles/<role>/` and
`.operon/memory/<role>/`, and the critical-ops gate allows it — `memory/**` is
not a protocol surface. `writeMemoryDoc` and `runRetroCuration` exist as
library code but have no callers in any runtime path. The real migration is
therefore *agents-write-active-memory → agents-emit-candidates*, and it is the
single largest behavioral change in this design. If the learning loop ships
while the direct write path stays open, there are two write paths into agent
context — one governed, one not — and the ungoverned one wins on latency.

The migration has three parts, all landing in Phase A (capture-only):

1. **Redirect the end-of-turn protocol.** The injected instruction changes
  from "write OKF docs into memory trees" to "emit learning notes as
   candidate input" (a quarantine-style notes path or `operon learn emit`).
   Agents keep the habit of recording lessons; the lessons stop being
   instantly active.
2. **Gate the active bundle mechanically.** A new gate rule makes writes to
  `learning/bundle/**` and `learning/manifest.yaml` critical ops — same shape
   as the existing `scorecard-tamper` rule in `src/runtime/gate.ts`. The
   active bundle becomes orchestrator/human-only by enforcement, not
   etiquette. Per the working rules, the gate change ships with test cases for
   both the critical side and a routine near-miss.
3. **Retire** `runRetroCuration`**.** Its destructive dedupe/delete is ungated and
  it was never wired in. Its one good idea — skill drafts from recurring
   keywords — ports into the distiller's `skill_draft` destination.

**Legacy memory trees are read-only seed context.** Existing
`memory/roles/**` and `.operon/memory/**` docs keep resolving, at lowest
precedence, stamped `trust: legacy`. Individual docs get promoted into the
governed bundle through the normal candidate path when evidence warrants; no
bulk migration.

## 8. Measurement and Low-Volume Canary

Operon will begin with low run volume. A hard "200 canary runs" rule would stall
learning before it starts.

V1 should therefore use a three-part decision rule:

1. **Held-in eval:** the specific weakness the concept claims to fix must pass
  when such an eval exists.
2. **Held-out baseline:** role/app baseline checks must show no regression.
3. **Human decision:** canary and metric reports recommend promote, extend, or
  revert; the human executes in V1.

Run-count thresholds remain useful as confidence signals, but insufficient
sample size should usually produce "extend or human judgment," not permanent
limbo.

Promotion metrics are computed only from events emitted by the orchestrator,
verifiers/gates, resolver, or human. Agent-emitted events are distillation input
only. This prevents a Goodhart loop where agents improve their scores by
under-reporting failures.

## 9. Security Model

Active knowledge is a prompt-injection persistence layer. A poisoned concept can
be loaded into many future turns.

Defenses, in priority order:

- provenance stamped at capture time;
- untrusted-channel escalation;
- human approval for V1 activation;
- cross-provider review: the learning reviewer runs on a different provider
than the distiller (the ratified builder ≠ reviewer principle);
- fail-closed review;
- quarantine labeling and TTLs;
- resolver pinning and context-budget rules;
- rejection ledger;
- `disable <concept-id>` and version rollback;
- metric trust boundary excluding agent self-reports from promotion metrics.



## 10. Operon Integration

V1 should integrate with existing Operon surfaces:

- `src/org/context.ts`: replace unversioned memory selection with a resolver
that pins concept versions and emits `concept_loaded`; change the injected
end-of-turn memory instruction per §7.1.
- `src/org/retro.ts`: `runRetro` (reporting) keeps running and gains learning
metrics; `runRetroCuration` — implemented but never wired to any runtime
path — is retired, with its skill-draft logic ported into the distiller.
- `src/org/scorecards.ts`: feed trusted metrics (already orchestrator-only,
enforced by the `scorecard-tamper` gate rule).
- `src/runtime/runlog/*`: feed learning events from L1 envelopes
(`gate_results`, `usage`, `tool_counts`) and L2 events (`gate.*`,
`verdict.recorded`, `tool.called`) via the capture projector — never from L3
transcripts.
- `src/runtime/telemetry.ts`: the manual `loop` path does not call
`recordTurn` today, so loop-driven passes are invisible to the telemetry
ledger. Preflight closes this; otherwise learning metrics undercount exactly
the builder/reviewer activity the loop most needs to learn from.
- `src/org/events.ts` and `src/org/dispatch.ts`: company-event payloads must
reach role briefs, and multi-role fan-out must not consume shared events
early (both confirmed defects; see milestones Preflight for code anchors).
- `src/loop/qgates.ts`: provide trusted verifier events and host eval/gate
proposals.
- `src/loop/github.ts`: add `createIssue` to `GhOps`/`GhCliOps` — the `ticket`
destination needs it and no programmatic issue-creation helper exists today.
- `src/loop/verdicts.ts`: reviewer verdict parsing reuses `parseWithRetry` and
the native structured-output path rather than fresh JSON parsing.
- `src/org/approvals.ts`: the V1 human gate is the existing approvals store
(pending/decided/grants + `operon approvals`), not a second inbox. Candidate
approvals are a new item kind; the reviewer's verdict JSON is stored as
evidence, but the human decision lives in the one queue. Fail-closed comes
free: no grant, no publish. The SLA report reads pending-item age.

The CLI should be `operon learn ...`, not `loop-learn`, until extraction earns
itself.

### 10.1 Cache Stability

The resolver sits directly on Operon's most expensive surface. The rules in
`research/2026-07-04_prompt-caching.md` bind it:

1. **Deterministic serialization.** The resolved bundle renders byte-identically
  for the same (bundle versions, role, app): concepts sorted by id within
   scope, scopes in precedence order, no timestamps or turn ids in rendered
   bytes. The resolved-context record (turn id, concept ids) lives in the
   runlog, never in prompt bytes.
2. **Version churn is the cache cost, concept churn is free.** A version cut
  means one guaranteed cold cache per (role, app). This is an argument *for*
   daily batched cuts: many concept changes, one invalidation.
3. **Canary splits fork the cache.** A canary bundle is a second cache lineage
  per (role, app) — acceptable, but a stated cost. Canary assignment is
   deterministic (hash of turn id), never `Math.random`.
4. **Conformance check.** Two back-to-back passes under the same pinned bundle
  must show `cacheReadTokens > 0` on the second — same shape as the existing
   cache conformance case.



## 11. Bootstrap

Cold start should be phased:

**Phase A - Capture only.** Wire event capture and resolver metadata while
continuing to load existing memory. No automated activation.

**Phase B - Human-gated candidates.** Enable distillation and artifact routing;
every candidate requires human approval. Reviewer verdicts are advisory and
used to calibrate prompts.

**Phase C - Human-gated activation with reports.** Active OKF concepts resolve
through the manifest, canary reports are generated, and containment commands
work.

**Phase D - Earned autonomy.** Only after measured reviewer-human agreement and
promotion-decision agreement do narrow automations turn on.

## 12. Open Questions

- ~~How much of the existing~~ `memory/roles/**` ~~and~~ `.operon/memory/**` ~~tree
should be migrated into the new~~ `learning` ~~bundle versus treated as legacy
seed context?~~ **Answered in §7.1:** legacy trees are read-only seed at
lowest precedence with `trust: legacy`; individual docs promote through the
normal candidate path; no bulk migration.
- Should app-specific learning manifests live in app repos only, or should the
org home keep a read-only index of app bundle versions?
- What is the smallest useful baseline eval suite per role/app?
- How should humans submit corrections: `operon learn emit` exists either way
(§7.1); the open part is whether a markdown inbox and/or a GitHub issue
label also feed capture.
- Which learning event taxonomy is stable enough for V1, and which event types
should remain advisory?



## 13. Extraction Later

If a second orchestrator wants this system, the interfaces can be extracted:
EventSink, Distiller, Reviewer, Store, Resolver, Metrics. Until then, the
implementation should stay inside Operon so it can reuse runlogs, approvals,
scorecards, app registries, GitHub operations, and quality gates directly.
