# Adaptive planning-depth policy

> Historical v1 investigation. `planning-depth/v2` now separates the
> safety-floored episode execution route from lifecycle-selected planning
> passes. Existing scoped tickets go directly to build/review, bounded goals
> use one shaping pass, milestones add Visionary plus one PM, and competing
> PMs/arbitration require strategy ambiguity, costly reversibility, or a human
> deep minimum. `docs/architecture.md` §8 is the current contract.

## Implementation status

Implemented in `src/org/planning-depth.ts` and the non-interactive
`operon plan --auto` path. `planning-depth/v1` chooses quick, standard, or
deep before constructing a runtime; `PassSelection.includePasses` executes
only the chosen existing human-ratified protocol passes. Quick selects one
combined decomposer (or the existing one-pass bootstrap protocol), standard
selects visionary → PM-A → decomposer, and deep selects the full competing-
PM/arbitrator/decomposer path. No ratified prompt or safety gate was weakened.
The implementation commit is `3c631cb`.

Every pass envelope carries `planning_route`: factor values, decision
rationale, selected and skipped passes with reasons, and a historical-median
cost estimate computed before execution. With no comparable history the
estimate is explicitly unavailable and role caps appear only as an upper
bound. A missing legacy `plan-bootstrap` pipeline now falls back to the
quick `plan/decomposer` route rather than failing `unknown pipeline`.

Planning depth is a routing decision, not a proxy for prompt length. The
router evaluates structured factors before constructing a runtime or creating
a run envelope.

## Inputs

The caller supplies or Operon derives:

- risk tier: low, medium, high;
- ambiguity: low, medium, high;
- coupling: low, medium, high;
- reversibility: reversible, costly-to-reverse, irreversible;
- external consequence: none, internal, customer/public/production;
- expected tickets: 1–2, 3–6, or 7+;
- sensitive domains: auth/security, migration/schema, release/deploy,
  payments, secrets, infrastructure/DNS, destructive data operations;
- explicit current-task depth override, when attributable to the human.

Repo and issue evidence may raise a factor, never silently lower a human-
declared factor. Prompt character count is not an input.

## Routing rules

### Quick

Use when all are true: low risk, low ambiguity, low coupling, reversible,
no outward/production consequence, no sensitive-domain floor, and an expected
one or two tickets.

Passes: one combined planner/decomposer pass. It emits a validated plan and
the orchestrator publishes it. No competing PMs or arbitrator.

### Standard

Use when no deep floor applies and the work has medium ambiguity/coupling or
approximately three to six tickets.

Passes: visionary → one PM/decomposer. The second pass both resolves the
vision and emits the validated ticket plan. A second PM is added only after a
recorded uncertainty/disagreement trigger, never by default.

### Deep

Use when any hard floor applies: high risk, irreversible or destructive work,
customer/public/production consequence, security/auth/secrets, migration or
release infrastructure, materially coupled cross-system change, seven-plus
expected tickets, or an explicit human deep request. It may also apply when
both ambiguity and coupling are high.

Passes: visionary → PM-A + PM-B → arbitrator → decomposer.

The deep route preserves the existing human sign-off and critical-operation
gates. Planning depth can add judgment; it cannot grant execution authority.

## Deterministic decision table

1. Apply explicit human minimum depth.
2. Apply hard domain/risk/reversibility floors.
3. Compute the remaining quick/standard thresholds.
4. Record the selected depth and every factor.
5. Record each skipped configured pass and the rule that skipped it.
6. Estimate planning cost from selected roles/models, historical per-pass
   medians, and declared caps. Mark the estimate unavailable when no basis
   exists; never present the role cap as expected cost.

The router returns a versioned record:

```json
{
  "policy_version": "planning-depth/v1",
  "depth": "standard",
  "risk_tier": "medium",
  "factors": {
    "ambiguity": "medium",
    "coupling": "low",
    "reversibility": "reversible",
    "external_consequence": "none",
    "expected_tickets": "3-6",
    "sensitive_domains": []
  },
  "selected_passes": ["visionary", "pm-decomposer"],
  "skipped_passes": [
    {"pass": "pm-b", "reason": "no recorded disagreement trigger"},
    {"pass": "arbitrator", "reason": "one PM perspective selected"}
  ],
  "estimated_cost_usd": 3.2,
  "estimate_basis": "30-day median for planner/gpt-5.5 at selected effort"
}
```

## Configuration and overrides

The policy is code-owned and versioned. Org config may raise minimum depth or
set cost-estimation history windows. App config may narrow by raising risk or
declaring sensitive paths. A current human instruction may select a higher
depth. Lowering a hard floor requires a fresh attributable human grant and
still cannot bypass critical-operation approvals.

## Failure semantics

Each planning invocation owns a trace record from routing through publication.
A trace is `completed` only when its validated plan of record is durable and
the requested publication disposition succeeded. Intermediate pass output
without that artifact is `incomplete`, with artifact links and terminal reason.
Retries create causally linked traces; they never masquerade as continuation
of the abandoned trace.
