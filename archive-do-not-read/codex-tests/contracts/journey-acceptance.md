# Operon product-journey acceptance criteria

Status: **Phase 4 ratified — 2026-07-29**

Last updated: 2026-07-29

These are behavior-level acceptance criteria. They validate a product promise
once through the underlying journey; CLI, Agent Skill, UI, future API/MCP,
timers, events, signals, and recovery entry points receive focused adapter
conformance rather than duplicate journey suites.

`OPEN` means product truth or architecture ownership is unresolved. It is not a
license for the harness to select expected behavior.

## J-01 — Install and discover

1. **Given** a supported host and a compatible immutable Operon release, **when**
   installation succeeds, **then** the exact binary, Agent Skill, capability,
   and compatibility identities are discoverable, and no org is implicitly
   created or selected.
2. **Given** an incompatible or partially installed release, **when** discovery
   runs, **then** it reports a typed non-ready result and cannot present mixed
   components as healthy.

Traces: OPERON-BND-001, -015, -016; OPERON-INV-003, -009.

## J-02 — Create, select, and upgrade an organization

1. **Given** multiple organizations, **when** one is explicitly selected,
   **then** all resolved config, state, secrets, apps, schedules, and work paths
   belong to that org and no fact leaks from another org.
2. **Given** interrupted creation or upgrade, **when** the lifecycle operation
   is retried, **then** it completes or returns to the last accepted version
   without advertising a partial schema as ready.

Traces: OPERON-BND-001–004; OPERON-INV-001–005, -010.

## J-03 — Onboard and promote a product

1. **Given** an app at one readiness stage, **when** onboarding verifies a
   stronger stage, **then** the claim advances only with evidence owned by that
   stage and states what remains unproved.
2. **Given** missing, stale, mismatched, or failed readiness evidence, **when**
   promotion is evaluated, **then** the app remains at its last proved state and
   receives a truthful reason and remediation.

Traces: OPERON-BND-001–004, -007, -009–010, -015;
OPERON-INV-001–005, -009–010.

## J-04 — Capture and prioritize demand

1. **Given** a valid demand signal from a human, GitHub, time, or an admitted
   collector, **when** intake accepts it, **then** provenance, stable identity,
   org/app scope, reasoning status, priority authority, disposition, and next
   action remain inspectable.
2. **Given** duplicate, malformed, untrusted, or scope-ambiguous input, **when**
   intake handles it, **then** it is deduplicated, rejected, or quarantined and
   cannot silently become executable work.
3. `OPEN — PTF-008 / PTF-010 / AF-011:` the size and fairness of the prioritized
   window, approval-backlog backpressure, aging, and alerts are not yet accepted
   behavior.

Traces: OPERON-BND-002–007, -009, -014; OPERON-INV-001–005, -009–011.

## J-05 — Decompose work

1. **Given** broad, partial, or unplanned scope, **when** planning publishes
   child work, **then** each child owns one independently accountable outcome
   and retains causal lineage to its parent planning episode.
2. **Given** a candidate child ticket, **when** it is admitted for publication,
   **then** it contains the required template fields: Goal, Context,
   mechanically checkable Acceptance criteria, Out of scope, and optional
   Notes, plus `Planned-by` provenance.
3. **Given** a missing required field, unresolved dependency, invalid lineage,
   or non-checkable acceptance claim, **when** publication is attempted,
   **then** publication is blocked rather than repaired by silent invention.

Traces: OPERON-BND-002–004, -006–009; OPERON-INV-001–005, -009–011.

## J-06 — Plan an episode

1. **Given** one executable outcome, **when** the episode planner succeeds,
   **then** one schema-valid, versioned EpisodePlan durably records the smallest
   safe DAG, assignments, dependencies, ceilings, approvals, gates, and
   revision rationale before the first delivery step.
2. **Given** invalid scope, role assignment, budget, approval declaration, gate,
   or DAG, **when** admission runs, **then** no delivery step starts and the
   rejection is typed and explainable.

Traces: OPERON-BND-002–009, -012; OPERON-INV-001–011.

## J-07 — Execute an episode

1. **Given** a ready DAG step and an admitted harness/model assignment, **when**
   execution runs, **then** provider-specific behavior is normalized to the
   same versioned Operon turn result, with stable identity, events, usage
   quality, evidence, and a truthful terminal status.
2. **Given** a model or tool claims success, **when** required gates, review, or
   product-specific evidence do not prove it, **then** the step cannot be
   recorded as passed or completed.
3. **Given** a required structured verdict that remains invalid after the
   bounded repair attempt, **when** the step settles, **then** it is an
   infrastructure/protocol failure, never a merit pass.

Traces: OPERON-BND-002–012; OPERON-INV-001–011.

## J-08 — Authorize and execute a consequential effect

1. **Given** a content-bound effect proposal, **when** the human approves it,
   **then** the exact decision is recorded separately from later execution and
   acknowledgement.
2. **Given** absent, expired, mismatched, or ambiguous approval or execution
   state, **when** retry is considered, **then** the effect does not execute
   again until the ambiguity is reconciled or a new explicit decision is made.

Traces: OPERON-BND-004, -006–011; OPERON-INV-001–011.

## J-09 — Recover after interruption

1. **Given** a crash, signal, stale lock, or restart at any episode stage,
   **when** recovery runs, **then** it reconciles accepted local and external
   artifacts by stable identity and continues only the minimal safe suffix.
2. **Given** reusable files, plans, provider sessions, or accepted evidence,
   **when** recovery evaluates them, **then** it reports what was reused,
   invalidated, repeated, or remains uncertain; it does not discard useful work
   or resume it blindly.
3. **Given** an ambiguous external effect, **when** recovery cannot prove its
   outcome, **then** it does not repeat the effect.
4. `OPEN — PTF-013 / AF-006–008:` the exact long-turn continuation and
   cross-provider recovery promise remains unresolved.

Traces: OPERON-BND-001–013, -015; OPERON-INV-001–011.

## J-10 — Observe without mutation

1. **Given** an authorized observation request, **when** a view is rendered,
   **then** its source identities, freshness, degradation, conflicts, missing
   evidence, and redactions are explicit.
2. **Given** unavailable or corrupt observation sources, **when** a partial view
   is possible, **then** only dependent fields degrade and the runtime continues
   independently of the observer.

Traces: OPERON-BND-002–004, -009, -013; OPERON-INV-001–005, -009–011.

## J-11 — Capture and activate learning

1. **Given** completed work or other evidence, **when** learning is captured,
   **then** evidence may become a candidate but cannot immediately become
   active future context.
2. **Given** a reviewed, evaluated, approved, content-bound candidate, **when**
   it is published, **then** activation is versioned, scoped, reversible, and
   traceable from evidence through outcome.
3. **Given** no actionable learning, **when** the episode closes, **then**
   no-learning is accepted without fabricating a candidate or efficacy claim.

Traces: OPERON-BND-002–009, -011–013; OPERON-INV-001–011.

## J-12 — Perform periodic organizational review

1. **Given** accumulated context and evidence, **when** a periodic review runs,
   **then** it may produce a report, candidate, proposal, or governed wait, but
   cannot silently mutate active governance or context.
2. `OPEN — PTF-004:` cadence, required scope, decision authority, mandatory
   outputs, and the definition of a successful review remain product-truth
   findings.

Traces: OPERON-BND-002–007, -009, -012–014; OPERON-INV-001–011.

## J-13 — Deliver non-software product work

1. **Given** a GitHub-tracked tutorial-maintenance task, **when** its accepted
   EpisodePlan runs, **then** planning assesses relevance and accuracy, building
   revises the artifact, review obtains product-specific lab evidence through
   the assigned role, and failed evidence returns actionable findings to
   revision.
2. **Given** accepted review and verification, **when** shipping runs, **then**
   the exact accepted commit enters the configured CI/publication path and
   publication is complete only after a truthful target acknowledgement.
3. **Given** the current implementation cannot express a required role,
   artifact, lab, or publication semantic, **when** validation runs, **then**
   the capability is reported as planned/not implemented and creates a product
   finding; it does not fail unrelated supported profiles or claim support.

Traces: OPERON-BND-002–014; OPERON-INV-001–011; AF-002.
