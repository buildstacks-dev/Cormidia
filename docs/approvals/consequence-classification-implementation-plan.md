# Consequence classification — implementation plan

Companion to `consequence-classification-proposal.md` (the design) and issue
#296 (the review thread). This file is the **staging plan**: what lands in
which PR, what proves each stage, and where the work legitimately stops.

Read the proposal first. This document assumes it.

---

## The organizing rule

**Everything that tightens the gate or adds inert mechanism runs unattended.
Everything that loosens the gate stops for ratification.**

That is the proposal's own principle applied to the work of building it. A
tightening cannot create an incident it would not already have prevented, and a
mechanism nothing uses yet cannot change behavior at all. A loosening can do
both, so it gets a human.

This is why the stages are ordered the way they are, and why Stage 4 is a stop
rather than a failure.

---

## Preconditions

Verify all four before Stage 1. Any failure is a stop.

1. **No release qualification is in flight.** Proposal §14 blocks this work
   while a candidate is being qualified, because these files are exactly the
   ones whose change invalidates release evidence. `0.1.1` was parked
   2026-08-06; confirm nothing has restarted it.
2. **Branch rebased on current `origin/main`.** The branch was cut at `88ef60f`;
   main has moved. Rebase, do not merge.
3. **Baseline green before any edit**: `pnpm install`, `pnpm test`,
   `pnpm typecheck`, `pnpm build`. **Record the exact passing test count** — it
   is Stage 1's oracle.
4. **No provider-backed work is required by any stage.** L3/L4/L5 campaigns,
   `CORMIDIA_EVAL_LIVE`, `pnpm test:live|eval|soak` are out of scope for all of
   it. If a stage appears to need one, that is a signal the stage is wrong.

---

## Stage 1 — Mechanism, zero behavior change

**In plain language:** build the new decision path and prove it decides exactly
what the old one decided. Nothing about the product's behavior may change. This
is the only stage whose correctness can be proven by tests that already exist,
which is why it goes first and why it must go alone.

### Deliverable

- `ConsequenceClass` types: `reversibility`, `blastRadius`, `cost` (§3).
- `DispositionTier`: `routine | budgeted | grantable | human-only | un-grantable`
  (§4).
- `decideDisposition(action, context)` returning
  `{rule, consequence, tier, reason, grantId?}`.
- All 12 rules mapped to the tier they have **today**:
  - members of `NEVER_SCOPEABLE_RULES` → `human-only`
  - every other critical rule → `grantable`
  - non-matching → `routine`
- Every caller routed through it: `turn-runner.ts`, `runRole.ts`,
  `plan-auto.ts`, `release.ts`, `gate-compose.ts`, the approvals CLI.
- The proposal and this plan committed.

### Acceptance

- `pnpm test && pnpm typecheck && pnpm build` green.
- **Passing test count equals the recorded baseline**, plus only the new unit
  tests for `decideDisposition` itself. No existing test modified. If an
  existing test must change, the refactor is not behavior-preserving — stop and
  report rather than editing the test.
- A table-driven test enumerating all 12 rules, asserting each resolves to the
  disposition it has today, with the expectation derived from
  `NEVER_SCOPEABLE_RULES` so it cannot silently drift.
- A property test: no input yields a tier looser than today's classification.
- `decideDisposition` is pure and total; unknown input takes the conservative
  branch.

### Not in this stage

Any tier change. Any new rule. `ObjectiveGrant`. Renaming anything a test
asserts on.

---

## Stage 2 — Tightenings only

**In plain language:** five reclassifications that all move in the restrictive
direction. Each one forbids something currently permitted. None can cause an
incident that today's configuration would have prevented, which is why this
runs unattended even though it changes real behavior.

### Deliverable

| Rule | From | To |
| --- | --- | --- |
| `protocol-self-edit` | human-only | **un-grantable** |
| `scorecard-tamper` | human-only | **un-grantable** |
| `approval-store-tamper` | human-only | **un-grantable** |
| `learning-surface-tamper` | grantable | **un-grantable** |
| `dns-or-domain` | grantable | **human-only** |
| `gate-implementation-edit` (new, §4.2.1) | — | **un-grantable** |

`gate-implementation-edit` matches writes to `src/runtime/gate.ts`,
`src/org/approvals.ts`, `src/org/gate-compose.ts`, `src/org/authority.ts`. It is
a distinct class, not an extension of `protocol-self-edit` — see §4.2.1 for why.

### Acceptance

- One seeded negative control per reclassified rule, landing **red then green**:
  a fabricated violating action must be shown to fail classification before the
  fix, and pass after. A detector that has never fired is an assumption
  (AGENTS.md).
- Existing tests that mint or rely on a grant for a now-un-grantable rule must
  be **updated to assert the refusal**, never deleted or weakened.
- `pnpm test && pnpm typecheck && pnpm build` green.

### Note on `gate-implementation-edit`

Un-grantable bounds *unattended agent writes*. It does not freeze the files. A
human, or an agent under direct human instruction with human merge, changes
them through the normal reviewed PR path — which is how this very stage is
being implemented. Verify the classification does not deadlock the reviewed
path before landing.

---

## Stage 3 — ObjectiveGrant, budget ledger, §4.1 ceremony

**In plain language:** build the authority object that survives a commit change,
and the spend ledger that backs it. This adds no permission to anything until a
human actually creates a grant, so it is inert on landing.

### Deliverable

- `ObjectiveGrant`: `grantId, objective, createdBy, createdAt, expiresAt,`
  `spendCeilingUsd, tiers[], classes[], repoNamespace, outwardEffects: false,`
  `revokedAt?` (§6).
- Written **only** by a human-facing CLI path, never by an agent — same
  constraint as A1 grants.
- Validation: a grant naming an `un-grantable` class is **rejected at creation**,
  not filtered at use.
- §4.1 ceremony for `human-only` classes: explicit per-class naming (no
  wildcard), bounded scope, optional precondition expression, shorter TTL and
  use cap than ordinary grants, a **distinct CLI verb** so it is unreachable by
  muscle memory, per-use audit rows.
- Cumulative spend ledger per grant in the org state home; debit **before**
  execution, atomic write.
- `objective-budget-exceeded` escalation raised **once** at the ceiling, reusing
  the `turn-budget-exceeded` item shape.
- Ceiling default configured, never hardcoded — same path as `budget_usd_month`
  (`src/org/bootstrap.ts:532`), per-org override, no special case for Cormidia
  as its own customer (§7).

### Acceptance

- Red-then-green: a grant naming an un-grantable class is rejected.
- Red-then-green: a grant cannot be created by an agent identity.
- Concurrent-debit test — two turns debiting the same ledger serialize
  correctly.
- Ceiling exhaustion reports **incomplete**, never green (AGENTS.md: no green by
  absence).
- Revocation takes effect immediately.
- With no grant present, behavior is byte-identical to Stage 2. Prove it.

---

## Stage 4 — Stop. Prepare the ratification package.

**In plain language:** the remaining work loosens the gate, and a loosening is
the owner's decision. This is where the unattended run ends. Reaching this
point with a complete package is the success condition, not a failure.

### Why it stops

The remaining changes are the splits in §5.1–5.4 — `destructive-or-irreversible`,
`secrets-or-auth`, `external-publishing`, `outbound-network`. Each makes the
gate permit something it currently refuses. Per proposal §13 they are
**structural**: they replace the invariant *"critical operations require human
approval"* with *"operations require the disposition their consequence class
specifies."* That is a redesign, not a case-level addition, and AGENTS.md
requires re-entering `validation-harness-design` in `harness-revision` mode with
the existing artifacts as baseline.

If that skill is unavailable, **stop and escalate.** Do not improvise a
redesign.

### Deliverable — prepared, not landed

1. A finding opened in `validation-design/validation-policy.yaml` →
   `open_findings:` with the next `F-PT-nnn` id, status `open`, one-line
   subject. Mirrored into `harness-design-state.md`. Dependent catalog cells
   parked `BLOCKED:<finding>`. **A finding is a question for the human, never an
   encoded guess.**
2. For each of the four splits: the proposed classes, the compensating control
   that makes it a net tightening (§5.3's template — no split lands without
   one), and the seeded negative controls **designed but not implemented**.
3. A single, well-formed decision request covering all four splits together —
   one decision, not four. The 019fd272 failure was four scattered approvals for
   one piece of work.
4. A written statement of what changed in the repo, what is green, what is
   pending, and exactly what the owner is being asked to decide.

---

## Standing constraints across all stages

- **Import direction** `src/org → src/loop → src/runtime`, one way, not
  lint-enforced.
- **Never hardcode a default branch.** `resolveRemoteDefaultBranch()`, threaded,
  re-resolved per claim (#101, #203).
- **Never weaken a gate, test, or golden set to make something pass.** Extend
  cases; never soften one. If a test blocks progress, the change is wrong.
- **Every defect fix deposits its detector** in the same change.
- **Every detector family lands red-then-green** against a seeded violation.
- **`validation-policy.yaml` is tighten-only.** Opening a finding is prescribed
  procedure and allowed; changing a threshold is not.
- **Never read, cite, run, or take design cues from `archive-do-not-read/**`.**
- One worktree per branch; one PR per stage; squash-merge.
- Update the nearest AGENTS.md or reference doc when a change alters
  architecture, contracts, or testing strategy.

---

## Stage summary

| Stage | Lands | Proven by | Runs unattended |
| --- | --- | --- | --- |
| 1 | `decideDisposition`, zero behavior change, spec + plan | Existing suite, unchanged count | Yes |
| 2 | Five tightenings + `gate-implementation-edit` | Red-then-green per rule | Yes |
| 3 | `ObjectiveGrant`, ledger, §4.1 ceremony | Inert without a grant; rejection tests | Yes |
| 4 | Ratification package only | — | Stops here |
