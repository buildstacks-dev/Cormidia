# Boundary contract — B-28 (sealed answer key ↔ grader turn input)
Canonical ID: **CORMIDIA-C-B28-001 (alias: B-28)**

Status: DESIGN-ONLY, added at the 2026-08-07 outcome-acceptance harness revision.
Defends `CORMIDIA-INV-ACC-1`. Journey J-21. Control point T-4 (confidentiality).

**This is a confidentiality contract with no existing analogue in the corpus.** INV-011
governs secret-bearing content crossing **outward** into lower-sensitivity surfaces.
This governs the mirror case: ordinary, non-secret, **committed** repository content
withheld **inward** from one specific consumer. The nearest relative, S-8's blinded
candidate identifiers, hides *identity* at a call site; it does not withhold *content*
at a seam.

## §1 Valid input — what the key is and when it exists

- The sealed key for a scenario is the mechanical extraction of that scenario's
  `## Plants` section. **The required category set depends on the scenario kind**
  (`acceptance/rubric.md` §2 for app scenarios, §9 for job scenarios — amendment
  ratified 2026-08-08, F-PT-032):
  - **app scenario** — the planted contradiction(s), the under-specified
    requirement(s), the buried hard requirement(s), and the tangents that must not
    become tickets;
  - **job scenario** — the genuine input conflict(s) that must be preserved rather
    than resolved, the item(s) with no discoverable answer, the mechanically-checkable
    hard deliverable constraint(s), and the tangents that must not become steps.

  Four categories either way. The app list is plan-axis instrumentation and a job has
  no plan arm, so requiring it of a job scenario demanded instrumentation for a
  measurement that never happens — and left J-2, the highest-value job axis,
  permanently ungradeable.
- Extraction happens **exactly once, before the first grader turn for that campaign is
  constructed.** A key extracted afterwards is invalid; there is no late path.
- The key is bound to the scenario file by **content hash**. If the scenario file and
  the key disagree, both are invalid and the campaign refuses — silent drift would score
  a run against instrumentation that no longer describes the brief.
- Extraction is **complete or refused**. A key missing one of its four plant categories
  is refused rather than accepted as partial: a partial key does not read as an error
  downstream, it reads as generosity, because the axis then scores against fewer
  expectations than the rubric requires. A plants lead-in the ratified vocabulary
  cannot map is likewise **refused and named**, never silently dropped — dropping it
  is how a partial key is manufactured without anyone deciding to.

## §2 Guaranteed output — the confinement guarantee, in three parts

For every grader turn `g` and every scenario `s` graded in that turn:

1. **Assembly.** No byte of `key(s)` appears in `g`'s assembled input: brief, prompt,
   context bundle, tool results, or any transcript `g` is handed.
2. **Reachability.** No byte of `key(s)` is readable from any surface `g` can reach with
   its own tools. `g` is an **agentic turn holding file-read tools**, so this is not
   implied by (1): the scenario markdown committed in the campaign repository is
   reachable without ever appearing in a prompt, and removing it from the working tree
   does not remove it from `git log -p`. The structural mechanism is that `g` receives an
   **evidence set the campaign assembled** (B-29 §1) — never the scenario-authoring
   repository, and never a workdir whose ancestors contain the campaign root.
3. **Echo.** No artifact derived from `key(s)` is handed to a later grader turn: not a
   report draft, not the mechanical scorer's output, not a prior axis's grader
   transcript.

The key's plaintext lives outside every path any grader may read, for the whole campaign.

## §3 Typed errors — fail closed, never proceed unproven

- Confinement that cannot be **proven** for a turn is a refusal to construct that turn,
  not a warning. "We found no leak" is a result only when the check actually ran over a
  declared reachable set.
- Key absent, stale, partial, hash-mismatched, or bound to a different scenario ⇒ typed
  refusal before grading.
- A widened grader tool sandbox (a workdir change, an added read root) invalidates the
  reachability proof and requires it to be recomputed; using the old proof is a defect,
  not an optimization.
- If the key leaks after grading has begun, every axis graded by that turn reports
  `ungraded` (`CORMIDIA-INV-ACC-5`) — it does not report a discounted score. The
  measurement is void, not weak.

## §4 Idempotency and ordering

- Extraction is idempotent over identical scenario bytes and produces an identical key.
- Ordering is absolute: extract → seal → construct grader turns → grade → **then**
  mechanically apply the key. The key is applied by the scorer, outside any model
  (rubric §7 rule 3). Axes P-2, P-3, P-4 and the J-2 handoff comparison are set
  comparisons against the key, not judgments.
- The report may quote the key **only after** every grader turn for that scenario has
  terminated.

## §5 Freshness, and the limit this contract does not claim

- The proof is per turn and per reachable set, recomputed whenever either changes.
- **Deliberately not claimed: semantic confinement.** Whether a real grader *infers* a
  planted contradiction from evidence it legitimately reads is not a confinement failure
  and this contract makes no promise about it. It is a rubric-validity question the human
  owns — an inferable plant is a weak plant (rubric §2). Byte-confinement must never be
  reported as if it were semantic confinement.
