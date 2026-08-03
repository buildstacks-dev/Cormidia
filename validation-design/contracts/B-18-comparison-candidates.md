# Contract — B-18 Comparison coordinator ↔ isolated candidate lanes
Canonical ID: **CORMIDIA-C-B18-001 (alias: B-18)**

Status: PROPOSED harness revision (2026-08-01). Defends
INV-001/002/004/006/010/013/014/015 and T-2/T-5/T-6/T-11. Journey J-19.

## 1. Valid inputs

- A comparison binds one role, operation, frozen base/context/input manifest,
  authority/tool policy, expected outputs, versioned selection policy, exact candidate
  assignments plus sample indexes, and aggregate hard ceilings.
- Org-mode candidates are exact org-approved assignments narrowed by app policy and
  require adaptive assignment mode. Standalone candidates are exact
  operator-declared tuples and are never described as org-approved or qualified.
- Candidate lists are explicit. A Cartesian harness/model/effort expansion is invalid.
- Only allowlisted inert or local-artifact operations are comparable. Deploy,
  publication, approval execution, merge, destructive lifecycle, and other outward
  effects are invalid comparison inputs.

## 2. Output guarantees

- Each candidate receives byte-identical bound inputs and an isolated workspace or
  artifact namespace. Only assignment tuple and sample index may differ.
- Each started candidate has one truthful terminal execution record and one provider
  settlement. Infrastructure, merit, blocked, ambiguous, and invalid outcomes remain
  distinguishable.
- Candidate output includes a content hash and an operation-specific evidence-bundle
  hash. Missing required evidence makes the candidate ineligible; it never becomes an
  empty or zero score.
- Candidates cannot observe sibling artifacts or perform outward effects. Losing
  candidates never become EpisodePlan outputs or canonical workspace changes.

## 3. Error behavior

- Candidate start/transport/provider/process/workspace failures are typed per their
  underlying boundary and retained; no failure silently substitutes another tuple.
- Aggregate ceiling exhaustion stops before the next runtime, preserves all partial
  evidence, and terminates the comparison incomplete/inconclusive unless an already
  completed unique eligible candidate satisfies the declared policy.
- Base, input, authority, policy, or candidate-set drift fails before execution or
  requires a new comparison identity.
- A candidate effect attempt is denied by the gate and disqualifies the candidate; a
  comparison cannot request human approval to widen a candidate lane.

## 4. Idempotency

- Candidate identity is `(comparison_id, assignment_tuple, sample_index)`. Replay of a
  terminal candidate returns its retained record and never constructs another runtime.
- Repeated samples are distinct declared provider turns, not retries. Merit failures
  are not retried for a better draw; any typed infrastructure retry remains a new,
  separately settled execution record under the comparison ceiling.
- Cleanup is idempotent and removes only comparison-owned, non-retained workspaces.

## 5. Timing and ordering

- V1 executes candidates in canonical sequential order. Parallelism is outside this
  contract until separately ratified and evidenced.
- Aggregate provider-turn, equivalent-cost, active-time, and candidate-count ceilings
  are admitted pessimistically before the first runtime and rechecked before each
  candidate.
- Evaluation begins only after every admitted candidate is terminal or the comparison
  has a typed ceiling/cancellation stop.
