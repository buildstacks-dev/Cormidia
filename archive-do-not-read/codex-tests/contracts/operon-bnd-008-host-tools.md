# OPERON-BND-008 — Runtime envelope ↔ host tools/subprocess effects

Status: **Ratified — 2026-07-29**

Traces: J-06–09, J-11–13; OPERON-INV-002–010.

## Contract

### 1. Valid input domain

- A tool action has an exact operation, arguments/payload, org/app/worktree,
  actor/role, accepted-plan step, authority verdict, execution identity, and
  applicable timeout.
- Paths remain within authorized roots and the selected worktree; environment
  and secret handling follow the shared gate.
- Unknown tools, forbidden roles/actions, ambiguous parsing, path escape,
  missing execution identity, or payload/approval mismatch are invalid.

### 2. Output guarantees

- Each attempted allowed action produces attributable tool evidence; known
  exit/result, duration, artifacts, and effect identity are preserved.
- A denied action produces an escalation/refusal and no tool execution.
- Host output is evidence, not self-authenticating success; downstream gates
  decide whether the required artifact/outcome exists.

### 3. Error and recovery behavior

- Missing executable, non-zero exit, signal, timeout, hang, partial file
  mutation, child-process liveness, and unknown effect are distinct outcomes.
- Unknown partial effects are ambiguous and are not blindly retried.
- A provider or tool claim of success cannot override a failing exit, missing
  artifact, or mechanical gate.

### 4. Idempotency and retry

- There is no generic “retry any command” promise. Each operation declares an
  idempotency key, reconciliation rule, or terminal non-retryability.
- File/git operations use artifact fingerprints and stable worktree/commit
  identity; externally consequential operations route through BND-011.

### 5. Timing, ordering, and freshness

- Tool order follows the accepted DAG and provider/tool protocol; completion
  of one action cannot be inferred from a later action.
- Timeout/cancellation records precede any retry decision.
- Child liveness and artifact fingerprints are rechecked at recovery rather
  than trusted from stale process state.

## Controlled-seam obligations

Inject exit, signal, hang, timeout, partial write, child survival, malformed
output, path escape, and artifact drift in a real temporary worktree through a
controlled process/tool runner.
