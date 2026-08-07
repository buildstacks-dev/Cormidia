# Boundary contract — B-30 (job config authority ↔ journal-bound execution)
Canonical ID: **CORMIDIA-C-B30-001…003 (aliases: B-30, B-JOB)**

Status: DESIGN-ONLY as a harness artifact; the **product** shipped in #359
(`src/jobs/`, `docs/jobs/design.md`, the `cormidia-job` binary). This contract clears
the structural debt `docs/jobs/design.md` §14 recorded. Defends INV-001/002/004/006/008/
011/013/015 by inheritance, plus the two jobs tightenings recorded at INV-008 and
INV-015. INV-016 is **out of domain** (F-PT-031 — jobs have no readiness transition).
Journeys J-22/J-23. Module M18.

## §1 — CORMIDIA-C-B30-001 — job config authority

- **Valid input:** a YAML mapping with a path-safe `job` id, an optional `app`, and ≥1
  step. Each step has a unique path-safe `id`, `dependsOn` resolving to declared ids, an
  acyclic graph, and either (`objective` [+ optional `assignment`, `outputs`]) or
  (`checkpoint`) — never both, never neither.
- **Guaranteed output:** a validated plan, or a typed refusal naming the exact defect,
  **before any runtime is constructed**.
- **Error behavior:** fail closed, exit non-zero, no state written.
- **Idempotency:** loading is pure.
- **Authority:** a step's `assignment` selects among approved tuples; it never widens the
  `operator` role's ceiling, and an unapproved tuple is refused, never substituted
  (INV-001, T-3).

## §2 — CORMIDIA-C-B30-002 — journal authority

- **The journal is the sole completion authority.** Completion is never inferred from an
  output file's existence: a half-written file and a complete one are indistinguishable
  on disk (INV-015 jobs tightening).
- A completed step is never re-executed. An interrupted step is retried **at most once**
  under its recorded attempt identity, and its already-paid provider work is preserved
  rather than discarded.
- Every journal write is atomic (`writeLoopFileAtomic` semantics); a torn journal is
  rejected by readers, never accepted as terminal truth (INV-013).
- The config hash is bound at first write. A mismatch is a **typed refusal, never a
  resume**, and no step executes (INV-015 jobs tightening).
- **Ordering:** ready steps are selected by dependency order and executed one at a time,
  id-ordered within a ready set.
- **Isolation:** an app-scoped job writes records under `runs/<app>/` and nowhere else;
  an unscoped job writes under `runs/adhoc/` and touches no app state. Never both for one
  job (T-6, INV-004).

## §3 — CORMIDIA-C-B30-003 — declared output checks

- Each check kind (`exists`, `non_empty`, `json`, `schema`, `command`) is deterministic
  and fail-closed.
- **A failed check makes the step `failed` regardless of provider status**, and nothing
  downstream runs.
- A step with **no** declared outputs completes as explicitly `completed (unverified)` —
  never bare `completed`. Absence of a check is a visible property, never silence
  (INV-008 jobs tightening).
- **Handoff:** a dependency's declared outputs appear **verbatim** in the downstream
  step's persisted `brief.md`. This is a deterministic assertion over committed bytes,
  not an eval — the fan-in step that writes a confident synthesis without reading its
  inputs is the failure mode jobs are maximally exposed to, because §3 of the jobs
  contract provides no reviewer to catch it.

## §4 — CORMIDIA-C-OPJOB-001 — the `cormidia-job` operation contract

- `cormidia-job run <config>` **refuses when invoked inside a Cormidia provider turn.**
  Without this, a Builder turn spawns provider turns that escape its episode budget
  entirely (T-5).
- Exactly one ledger row settles per job provider turn, including failed and cancelled
  turns, debited against the **job** envelope — the app's envelope is untouched (INV-006).
- Run records land in exactly one canonical location per job (§2 isolation).
- Gated actions raise items through the existing gate without special-casing: a job step
  performing a critical effect meets the same classifier and approval boundary as any
  other turn (INV-002). This is what makes the reduced verification in
  `docs/jobs/design.md` §3 acceptable — an unverified job is still a **bounded** job.
- A checkpoint step parks the job into the approvals queue and resumes on decision
  without re-executing completed steps.

## §5 — What this contract deliberately does not promise

`docs/jobs/design.md` §3 is the non-inherited-guarantee list and it is not softened here:
no independent review, no typed merit verdicts, no ticket state machine, no GitHub, no
learning-loop input, no release authority. A "completed" job is a job whose steps
returned and whose declared checks passed — **not** a job whose work is correct. Job step
output *quality* has no statistical lane by design (`llm-eval-plan.md` §1: the prompt is
the operator's, so Cormidia cannot own a golden set for it); the only outcome measurement
that exists for jobs is the L-ACC lane's S-ACC-3 scenario, which is a campaign, not a
gate.
