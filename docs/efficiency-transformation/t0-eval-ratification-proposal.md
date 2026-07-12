# T0 Eval Semantics Ratification Proposal

| Field | Value |
| --- | --- |
| Status | Ratified |
| Evidence date | 2026-07-12 |
| Decision date | 2026-07-12 |
| Decision owner | Bikram |
| Source charter | `highly-efficient-organization-transformation.md` |
| Verification mandate | `highly-efficient-organization-test-eval-transformation.md` |

## Purpose

This is the ratified Phase T0 decision packet for the highly efficient organization
evaluation suite. It consolidates the choices that must be human-ratified
before eval harness or transformation implementation begins. It does not amend
`docs/PURPOSE.md`, authorize provider spend, or change production behavior.

The decision accepts the meanings below as the meanings that the later
canonical `docs/efficiency.md`, schemas, fixtures, contracts, and qualification
reports must implement. Any amendment must be recorded here before suite work
continues.

## Ratified decisions

### TE-01 — execution and accounting identities

Every provider turn settles exactly once in the accounting ledger. Every
execution step, provider or mechanical, reaches exactly one terminal execution
record. A mechanical step has no provider settlement and cannot increase model
turn, token, or cost totals.

### TE-02 — quick-route boundary

A nominal quick episode uses at most three provider turns. Under the current
separate contract, implementation, and independent-review protocol, those
three turns exhaust the quick allowance. A required repair after that point is
a recorded reassessment to standard or deep. Reports preserve the immutable
`planned_route` and the actual `final_route`; review is never skipped to retain
the quick label.

### TE-03 — canonical measurements

The formulas in §4 of the verification mandate are normative. Metrics derive
from orchestrator-owned state, timestamps, settlements, action records, and
artifact/state fingerprints—not agent self-report. Each metric exposes its
numerator, denominator, exclusions, and missing inputs. Missing required input
produces `invalid_measurement`, never zero or pass.

### TE-04 — usage and equivalent cost

Every campaign pins its model assignments, provider capability claims, and
price catalog. Cost retains the quality `reported`, `estimated`, `partial`, or
`unavailable`. Qualification is invalid when required usage or cost is
unavailable. Cache read/write usage remains part of input and is not counted a
second time. Rendered context bytes are reported separately and are never
converted into attributed provider tokens without an authoritative tokenizer.

### TE-05 — predeclaration and attempts

Before its first provider turn, a campaign fixes its ordered cases,
repetitions, fingerprints, models, exclusions, spend caps, infrastructure
retry allowance, randomization seed, and stop rules. Every admitted attempt is
immutable evidence. A declared infrastructure retry links to, and never
replaces, the original attempt. Merit failures are not retried under the same
attempt identity.

### TE-06 — learning recurrence threshold

Learning evals use production policy unchanged. A recurrence-based anomaly
class receives at least two comparable episodes, unless policy explicitly
permits one trusted human observation. Eval fixtures may not lower the
distiller threshold to manufacture a passing cluster.

### TE-07 — pending-approval lifecycle replay

The lifecycle benchmark first proves that reset refuses pending approvals and
names the blocker. A separate eval-only operator fixture then resolves or
archives only the predeclared approval. Reset is replanned and may execute only
after the refusal condition is cleared. The initial refusal is a required
safety success.

### TE-08 — release-gate semantics

Hard safety, integrity, outcome, settlement, hidden-answer, token-leakage, and
outward-effect invariants gate every attempt. Efficiency qualification is based
on a predeclared distribution plus per-episode admission bounds, not one
stochastic run. A required live case with missing auth, skipped execution,
missing usage, or a campaign-cap breach makes the campaign `invalid` or
`incomplete`, never passing.

## Canonical policy home

After ratification, `docs/efficiency.md` becomes the sole normative home for:

- route definitions and risk factors;
- route turn, context, cost, active-time, and human-decision budgets;
- measurement formulas and quality/missingness semantics;
- admission, variance, escalation, and terminal-integrity rules;
- distribution SLOs and qualification thresholds.

Other documents may explain or link to this contract but must not reproduce a
numeric budget table. Machine-readable case and campaign manifests reference a
versioned policy anchor such as `efficiency/v1#quick`.

## Initial route and benchmark budgets

These initial bounds are proposed for ratification from the source charter.
They are per-episode admission bounds, not permission to weaken an outcome or
safety requirement.

| Route or case | Provider turns | Input tokens | Equivalent cost | Active time | Human decisions |
| --- | ---: | ---: | ---: | ---: | ---: |
| Deterministic lifecycle | 0 | 0 | $0 | <=5 minutes | Policy-required only |
| Quick | <=3 | <=2M | <=$8 | <=20 minutes | <=1 |
| Standard | <=5 | <=4M | <=$15 | <=45 minutes | Declared by policy |
| Deep | <=8 | Declared per case | <=$40 | <=90 minutes | <=5 genuine decisions |

Crossing a bound cannot produce false completion. The episode records a route
variance and either parks or reassesses before another provider turn.

## Campaign spend caps

| Campaign | Hard cap |
| --- | ---: |
| Adapter and harness calibration | $15 |
| Pre-transformation provider baseline | $125 (initial recommendation; superseded for the 2026-07-12 campaign by `t4-baseline-cap-amendment.md`) |
| Full candidate qualification | $375 |
| Real-time soak | Must be separately declared and ratified |

These caps do not authorize spending. A live invocation additionally requires
`OPERON_EVAL_LIVE=1`, a validated and content-hashed campaign, an explicit
`--max-usd` no greater than its cap, exact `--confirm <campaign-id>`, successful
non-billable readiness, allowlisted disposable GitHub scope, and production-
path separation.

## Eval isolation and safety model

Ratification accepts this model:

1. Each campaign uses a fresh `Operon-Eval-<campaign-id>` org with explicit,
   synthetic `HOME`, `OPERON_ORG_HOME`, and `OPERON_STATE_HOME`.
2. Qualification uses immutable sparse, library, and service app templates;
   it never uses buildstacks.dev or the mutable alpha/beta/gamma/delta repos.
3. Actors mutate only managed clones/worktrees. Human/source checkouts and
   committed golden fixtures remain immutable.
4. Hidden graders, answer keys, reference patches, and mutants remain outside
   actor context, worktrees, environment, tool roots, and visible Git history.
5. GitHub mutation is limited to private repositories whose owner and
   `operon-eval-*` name match the predeclared allowlist. Cleanup preserves
   evidence and is never an implicit force reset.
6. No eval publishes, sends messages, changes DNS/cloud infrastructure,
   deploys to production, or performs irreversible data operations.
7. Ordinary CI and all validation/qualification commands are token-free.
   Provider execution is a separate explicit, capped command.
8. Production state may be used only as separately reported, read-only
   confirmation evidence; it is never a calibration or mutation target.

## Ratification effect

Approval of this packet completed T0 and authorizes T1–T5 suite work under the
verification mandate. It does not authorize transformation production
features, live provider spend, disposable GitHub mutation, or edits to other
human-ratified protocol surfaces without their stated review boundary.

The high-level `docs/PURPOSE.md` decision log and canonical
`docs/efficiency.md` incorporate these meanings. Later amendments require a
new human-ratified decision; an eval result or implementation change cannot
silently alter them.
