# Boundary contract — B-31 (declared planning-source scope ↔ harness-native reading)
Canonical ID: **CORMIDIA-C-B31-001…003 (alias: B-31)**

Status: DESIGN-ONLY as a harness artifact; the product change is owed under issue #386
and HB-155. Registered by the 2026-08-12 harness revision resolving **F-PT-039** (owner
ruling: `docs/PURPOSE.md` non-negotiable 2 governs planning `--source`; the Cormidia-side
pre-read is removed). Defends INV-001/008/011/013/015 by inheritance, and **INV-017**
(consumption is proven, never assumed) directly. Journey J-03. LLM site S-1b. Module M5.

**What this contract replaced.** Until 2026-08-12 there was no boundary here: Cormidia
walked the operator's directory itself, decoded every file as fatal UTF-8 and embedded
the JSON-encoded text in the planner's `task` string, so "selected" and "consumed" were
one fact and nothing could fail independently. The ruling moved the read to the harness,
which created the seam this contract owns. The retired pre-read's own mechanisms —
content-derived source-section coverage and the ingestion secret pre-scan — are
**pruned**, not migrated (see `case-catalog.md` §10.3's CF-REG-374 row and §11).

## §1 — CORMIDIA-C-B31-001 — scope declaration

- **Valid input:** operator `--source` / `--optional-source` paths, each resolving to an
  existing regular file or directory, canonicalized, with no symlink on the resolution
  path and no root escaping its own canonical root.
- **Guaranteed output:** a durable declared scope — canonical roots, their requirement,
  and the bounds that apply — or a typed refusal naming the exact defect, **before any
  runtime is constructed**. A required root that is missing, unreadable, or not a regular
  file/directory refuses; an optional one is recorded unavailable with its reason and the
  episode proceeds.
- **Error behavior:** fail closed, no provider construction, no partial scope.
- **Idempotency:** declaration is pure over the filesystem state it observed, and records
  the observation time so a later mid-turn mutation is detectable rather than invisible.
- **Bounds:** depth, entry count and root count are enforced at declaration; total read
  volume and wall time are enforced as turn execution limits, not as a prompt byte budget
  (the byte budget died with the pre-read — there is no prompt payload left to bound).
- **Trust:** every declared root is `operator-supplied-untrusted-data`. Declaring a scope
  grants reading, never authority: nothing under a source root can widen the turn's
  permissions, and content read from it is evidence, never instruction (INV-001).

## §2 — CORMIDIA-C-B31-002 — governed reading

- **The gate is the enforcement.** A read under a declared root is permitted; a read
  outside every declared root and the workdir is denied by the ordinary gate path, with
  no bespoke source-reading mechanism (INV-002 is not re-implemented here).
- A symlink encountered during reading that escapes its declared root is refused, and the
  refusal is an escalation rather than a silent skip.
- **The harness reads; Cormidia does not.** No Cormidia-side decode, classification,
  media parsing, OCR, or content embedding exists on this path. A future need to
  understand a file's bytes inside `src/org` is a signal that this contract is being
  re-violated, not a feature.
- **Ordering/latency:** unspecified by design — read order belongs to the harness. Nothing
  downstream may depend on it.

## §3 — CORMIDIA-C-B31-003 — consumption evidence

- **Consumption is observed, never assumed** (INV-017). A source is reported consumed only
  with a gate-observed read for it; content hashes are recorded at read time.
- **Modality capability is proven pre-spend.** The exact harness/model/effort tuple must
  carry the `media_read` capability when the declared scope contains a modality requiring
  it. An incapable tuple refuses before provider construction with typed remediation, or
  an already-approved capable assignment is selected under the ordinary assignment policy.
  Capability is read from the profile, never inferred from a model id.
- **Unobservable is not zero and not green.** Missing or unattributable read evidence
  reports as unobservable; it never renders as coverage and never as a clean empty walk.
- **A text-only read is never rendered as image consumption**, in any surface — manifest,
  dry-run, ticket evidence, status, or narrative.
- **Publication carries refs, never payload.** Durable planning evidence and published
  issue bodies carry canonical refs and hashes; raw media bytes never cross the
  publication boundary (INV-011, `src/loop/plan-publication-guard.ts` unchanged).
- **Mid-turn mutation is detectable.** A source whose bytes changed between declaration
  and read is reported as changed rather than silently recorded under either hash.
