# Cormidia’s origin

*This is a non-normative narrative, not current law. Current decisions live in
[`PURPOSE.md`](PURPOSE.md) → Standing, the implementation map lives in
[`architecture.md`](architecture.md), and open work lives in GitHub issues.*

Cormidia’s main branch is a development notebook: hundreds of small changes,
live corrections, qualification campaigns, and reviewed pull requests record
how the system was discovered. This file supplies the architectural story that
the commit sequence cannot. It preserves the notebook rather than rewriting it.

| Period | Architectural turn |
| --- | --- |
| 2026-07-03–04 | The project begins as a TypeScript org runtime with a constitution, runtime contract, and critical-operations gate. |
| 2026-07-05–06 | Runtime adapters and the governed build loop establish the harness/model boundary and artifact-driven delivery. |
| 2026-07-06–10 | The org layer adds apps, bootstrap, dispatch, approvals, budgets, recovery, and release ownership. |
| 2026-07-11–18 | Learning, observability, reporting, narrative, and efficiency work make outcomes measurable and inspectable. |
| 2026-07-18–21 | Phase 6 qualification produces the internal `v0.1.0` pin; a separate `0.1.1` package release follows. |
| 2026-07-19–24 | EpisodePlanner replaces route-by-label thinking with a validated, durable workflow plan for every episode. |
| 2026-07-27–08-01 | Topic docs are reorganized and the legacy test corpus is replaced by the ratified validation harness. |
| 2026-08-02–05 | Self-hosting is ratified, the project becomes Cormidia, packaging lands, and the RQ-1 release gate is restored. |
| 2026-08-06–07 | Gate consequences are tightened, adapters broaden, and `cormidia-job` becomes a deliberately weaker second binary. |
| 2026-08-11–13 | Strict repository gates, isolated self-hosted CI, governed publication, and repository provisioning close operational seams. |
| 2026-08-14 onward | Docs and research are trimmed; the notebook is bookmarked and platform development becomes squash-only. |

## 1. Scaffold: an organization, not a chatbot

The first commit, `b7a2407f`, already contained the enduring thesis: Cormidia
would be an installable runtime for a standing organization, not a SaaS
application and not a thin prompt wrapper. The human supplies goals and retains
material authority; named roles perform ordinary work. TypeScript was chosen
for the orchestrator, with strict runtime boundaries and a gate that classifies
tool effects before they happen. Constitution, role configuration, prompts,
and code were separate surfaces from the start. That separation later made it
possible to tighten behavior mechanically without turning every correction
into a larger prompt.

## 2. The build loop: state in artifacts

The first week converted “build this ticket” into a controlled delivery
protocol. Tickets, branches, pull requests, reviews, gates, and squash merges
became the durable state machine. Passes receive bounded briefs; acceptance
criteria map to tests; security review is always present; and no side effect
depends on an agent saying it succeeded. A crash resumes from the last valid
artifact rather than replaying the whole conversation. The governing contract
remains [`loop/design.md`](loop/design.md), including its GitHub conventions in
§15. This is the center of gravity: model judgment proposes work, while code
decides whether the evidence permits the next transition.

## 3. Runtime adapters: one contract, native harnesses

Cormidia did not adopt a multi-agent framework. It defined one runtime contract
and drove each provider through its native harness: Claude Agent SDK, Codex App
Server, and pi initially, with Cursor, OpenCode, Grok Build, and Muse Code added
later under explicit capability declarations. A role assignment is an atomic
`{harness, model, effort}` tuple; changing the tuple never changes the role’s
authority. Missing capabilities are marked adapter-built, degraded, or
unsupported rather than wished away. Version bands, readiness probes, session
resume, gate interception, and exactly-once settlement make adapter differences
visible in the [capability matrix](harness/capability-matrix.md).

## 4. The org layer: one runtime, many apps

Apps, bootstrap, dispatch, and the org home turned the loop into a standing
organization. The installed package, committed org configuration, local state
home, and each app repository became four distinct locations. A stateless timer
tick discovers due work, but planning and delivery happen in isolated managed
clones and worktrees. Approvals are durable decisions, not acknowledgements
that an effect occurred; budgets settle every provider turn; claims survive
pauses and crashes. Onboarding therefore advances by evidence—generated,
registered, runtime-ready, live, then autonomously scheduled—rather than by a
single optimistic “setup complete” flag.

## 5. Learning and presentation without new authority

The July learning milestones redirected agents from writing active memory to
emitting candidates. Distillation, independent review, paired replay, and a
human-started canary can establish that a proposed lesson is useful, but
activation remains separately governed. In parallel, Observe, Report, and
Narrative became presentation-only leaves: Observe projects current state,
Report derives ledger-first aggregates, and Narrative reconstructs an
episode’s causal story. None owns workflow state, and none may turn missing
evidence into success. This kept “understand the organization” separate from
“control the organization.”

## 6. EpisodePlanner: the workflow is planned, then executed

The original loop had proportional routes, but route labels could not explain
which roles, turns, gates, or approvals a particular goal actually needed.
EpisodePlanner introduced a durable `EpisodePlan` before delivery begins. A
complete, provenance-bearing creator scope may normalize token-free; otherwise
a fixed boot assignment plans the smallest sufficient dependency graph.
Deterministic validation checks capabilities, budgets, safety floors,
independent review, outputs, and terminal coverage before the first delivery
runtime exists. The exact identities, bounds, and measurements live in
[`episodes/contract.md`](episodes/contract.md); quick, standard, and deep are
now projections of the accepted plan, not workflow selectors.

## 7. Qualification: evidence bound to the exact candidate

The July remediation and efficiency campaigns made a harder distinction:
offline tests can prove evidence integrity, but release qualification must also
prove that the evidence belongs to the exact bytes being shipped. The annotated
tag `v0.1.0` points to `ed5f8c4a`, the 2026-07-18 Phase 6 qualification
merge. It is an internal qualification pin, not the public Cormidia v0.1
launch. A later `0.1.1` package release used an explicit one-release exception.
RQ-1 subsequently restored candidate-bound L1/L2 plus separately authorized
L3/L4 evidence and a distinct human release approval; its current contract is
[`qualification/design.md`](qualification/design.md).

## 8. The replacement validation harness

By late July, the original qualification corpus had become evidence and
history rather than a maintainable detector system. It was frozen, then
replaced by a ratified validation design whose policy, invariants, boundary
map, case catalog, and harness backlog derive tests from explicit failure
modes. The important cultural rule became executable: every defect fix
deposits its detector, and a gate is never weakened to make a candidate pass.
The harness also keeps uncertainty honest. Missing campaigns remain incomplete;
blocked cases stay named; structural changes require a design revision rather
than locally invented coverage.

## 9. Self-hosting, product naming, and distribution

Self-hosting made Cormidia itself an app the organization may develop, while
retaining human authority over protocol surfaces and every release-shaped
action. On 2026-08-02, commit `1f6504c0` replaced the original product name
with Cormidia, and the vocabulary stabilized around orgs, apps, and roles. The
package then separated source-backed local development from real packaged
installation, added transactional binary and skill linking, and established a
public front door distinct from the private source repository. The detailed
human and coding-agent lifecycle is [`DEVELOPMENT.md`](DEVELOPMENT.md).

## 10. Jobs: useful work outside the product loop

An organization also performs one-off research, strategy, and synthesis that
should not pretend to be product delivery. The `cormidia-job` binary added
dependency-ordered, resumable step graphs under a deliberately weaker promise:
declared checks may pass, but there is no ticket state machine, independent
review, GitHub authority, learning input, or release path. This was a second
entry point, not a second product architecture. Its boundary is recorded in
[`jobs/design.md`](jobs/design.md), and its status remains build-complete and
offline-proven rather than outcome-validated.

## 11. Operational closure: strict gates and isolated CI

August work tightened TypeScript and export ratchets, supply-chain checks,
repository identity, committed-surface publication, and greenfield repository
provisioning. Core Checks moved to an ephemeral Linux ARM64 container on the
owner’s Mac while GitHub remained the orchestrator and hosted compute remained
the release boundary. The point was not novel infrastructure; it was a
repeatable trust boundary with no host mounts, retained workspace, or silent
compute fallback. A committed change now has to become reachable from the
remote through an explicit publication transaction before Cormidia calls it
durable org truth.

## 12. Freeze the notebook, write the book

The 2026-08-14 cleanup removed records whose only remaining value was
historical; git history is their archive, while living research remains only
where current code, policy, docs, or issues depend on it. The annotated tag
`archive/notebook-pre-squash-discipline` and branch
`archive/pre-squash-discipline` name the final post-cleanup notebook commit,
`c29dc901`. Main is not rewritten, and `v0.1.0` is untouched. From this point,
platform work follows branch → pull request → Core Checks → squash merge. The
active main ruleset mechanically requires a pull request, linear history, and
resolved review threads; Core Checks are not yet a required ruleset check, so
F-PT-018 remains an explicit enforcement limitation rather than a claimed
pass.
