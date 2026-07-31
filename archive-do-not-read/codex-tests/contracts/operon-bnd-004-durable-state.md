# OPERON-BND-004 — Orchestrator process ↔ durable state/worktrees/sessions

Status: **Ratified — 2026-07-29**

Traces: J-02–09, J-11–13; OPERON-INV-001, OPERON-INV-004–005,
OPERON-INV-008–011.

## Contract

### 1. Valid input domain

- Recovery inputs are versioned records with matching org/app/task/episode,
  plan version, execution identity, artifact fingerprints, and ownership.
- A worktree, provider session, approval, or settlement is reusable only when
  its recorded binding still matches the accepted plan/context and liveness
  facts.
- Torn/corrupt records, foreign identities, conflicting owners, or a session
  whose binding cannot be proved are invalid recovery inputs.

### 2. Output guarantees

- Every started execution step has one truthful terminal record or an explicit
  still-running/ambiguous state.
- Accepted plans, commits, artifacts, findings, decisions, usage, and valid
  session identity survive process interruption.
- Recovery returns the next legal action and names reused, invalidated, and
  uncertain work. It never silently restarts the whole episode.

### 3. Error and recovery behavior

- Atomic/append-only records fail closed when corrupt and remain named for
  diagnosis.
- A live process is never reclaimed merely because its record is old; liveness
  must be disproved under the owning process contract.
- Only unaccepted scratch may be discarded. Repeating accepted productive work
  requires a durable invalidation reason.
- `OPEN (PTF-013/AF-006/AF-007)`: generic long-turn same-session resume limits,
  scratch acceptance, and cross-assignment handoff semantics remain unsettled.

### 4. Idempotency and retry

- Journals, append records, claims, settlements, and recovery actions use
  stable execution identities.
- Replaying recovery over unchanged state returns the same next action and
  does not duplicate work, cost, or effects.

### 5. Timing, ordering, and freshness

- Intent/plan/claim is durable before the corresponding execution/effect.
- Progress and session/usage checkpoints are monotonic.
- Recovery order is fact-specific and will be finalized in the AF-006
  precedence table; no global “newest timestamp wins” rule is permitted.

## Controlled-seam obligations

Inject failure at every transition around plan persistence, worktree changes,
provider progress, settlement, approval, and terminal append. Control process
liveness, corruption, session availability, and disagreeing fact owners.
