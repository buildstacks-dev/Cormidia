# Boundary contract — B-32 (Cormidia learning adapters ↔ `@cormidia/learning-loop` kernel)
Canonical ID: **CORMIDIA-C-B32-001…005 (alias: B-32, B-KERNEL)**

Status: phase A and phase B landed 2026-08-21 (Cormidia #467 / governed-learning-loop#14;
extraction plan `research/2026-08-12_learning-loop-library/extraction-and-dogfood-plan.md`
§Phase 4). The kernel is the standalone governed-adaptation package
(`github.com/cormidia/governed-learning-loop`, `@cormidia/learning-loop`), consumed as an exact
vendored tarball (its Decision 0029 R7). Phase A added the adapter layer beside the forked
deterministic engine under `src/org/learning/`; phase B cut Cormidia's learning source of truth
over to the kernel (CLI `learn *`, scheduled distiller/reviewer turns, context assembly,
proposal and ticket destinations, authority lanes, post-publication experiments) with byte/state
parity proven against the captured fork oracle (CF-B32-PARITY); the forked publisher, experiment
runner, bindings, and efficacy decisions were removed on 2026-08-22 after the owner's sign-off — no
forked engine remains, and the host-owned learning modules live under `src/org/learning-loop/host/`. Defends INV-001/012/013 by inheritance. Journey J-12 on the kernel path
(CF-J12-K; CF-J12-S/I/RC/A and CF-SM-LEARN-L/I/R/C re-homed here by HB-157). Module M13. Policy
record and phase-B rulings: `research/2026-08-21_learning-loop-migration-compatibility-policy.md`
§3, §7–§9.

**Why it is a boundary.** State ownership and failure domain both change at this line: the
kernel owns candidate/review/plan/journal/intervention/resolution records in its own store and
can refuse, crash, or drift in version independently of Cormidia's approvals store, org-home git
substrate (B-11/B-15), and runlog projections. Cormidia owns every mapping onto the kernel's
ports; the kernel never imports Cormidia.

## §1 — CORMIDIA-C-B32-001 — dependency identity and placement

- **Valid input:** exactly one vendored tarball `vendor/cormidia-learning-loop-<version>.tgz`
  pinned in `package.json` with its integrity in `pnpm-lock.yaml` (`check-pinned-deps`), consumed
  only through the kernel's public entrypoints (`.`, `/node`, `/testing`); adapter code lives in
  `src/org/learning-loop/` and imports downward only (`check-import-direction`).
- **Guaranteed output:** composing a loop (`createCormidiaLearningLoop`) writes nothing; every
  kernel-owned byte lives under `<state home>/learning-loop/` (store, destination receipts); the
  org home and app checkouts receive only the OKF destination's writes (§4).
- **Error behavior:** a package, protocol, or record schema-version skew is a parse refusal
  (`schemaVersion`, `PROTOCOL_SCHEMA_VERSION`), never a silent read; a kernel that throws where the
  adapter expected a typed refusal surfaces as the kernel's `LearningLoopError`, never as a
  success.
- **Idempotency:** pure construction; re-composition over the same homes reads the same records.

## §2 — CORMIDIA-C-B32-002 — evidence projection (projected episodes → kernel evidence)

- **Valid input:** `<state home>/learning/episodes/*.json`, `schema_version: 1`, parsed from
  `unknown` by the adapter's own validator (`episode-evidence-record.ts`) — never the fork's bare
  cast (the #407 seam class).
- **Guaranteed output:** per file, one `ProjectedEpisode` at scope `[org, app]` with class,
  completeness, open/close times and outcome status; one observation per gate result, late
  outcome, and (when closed) the outcome itself; five outcome measurements
  (`episode_completed`, `cost_usd`, `review_cycles`, `gate_failures`, `human_interventions`) each
  citing the outcome observation; page state `available` whose `sourceRevision` is the digest of
  every episode file's exact bytes, so a record changing under an import is revision drift, not a
  silent fold. Trust ceiling `observed`, never `verified`; content policy `cormidia-okf-v1`.
- **Error behavior:** any file the validator refuses closes that page as `corrupt` with a
  diagnostic naming the file (`source.record_corrupt`) and yields no records from it; a missing
  state home probes `supported: false`; an absent or empty episodes directory is an `available`
  empty page carrying an info diagnostic — never an unexplained empty success.
- **Idempotency:** reads are pure; the cursor is the page start index.

## §3 — CORMIDIA-C-B32-003 — authority projection (approvals store → AuthorityPort)

- **Valid input:** one kernel `PublicationPlan` raised as one approval item of tool kind
  `learning_loop_publish` (rule `learning-loop-publish`, role `learning`) in the EXISTING
  approvals store — never a second inbox. `action.input` carries the whole
  `AuthorizationBinding`, its digest, and the plan id, so the store's `actionHash` covers every
  bound field (the B-11 `learning_publish` pattern carried over exactly). Raising is idempotent
  per binding (store-level pending dedupe).
- **Guaranteed output:** `verify` is read-only and projects the item onto the kernel's closed
  decision set: `pending` → pending, `denied` → denied, `expired` → expired, `approved` →
  authorized with the item id, the decider as principal (an absent decider is the human operator,
  never an agent), `decidedAt` as `authorizedAt`, and the grant expiry when later than the
  decision.
- **Error behavior:** evidence that is not `{ approvalId }`, an unknown id, an item of another
  tool kind, or a carried digest that differs from the binding's digest are each a closed
  `invalid` decision with a typed diagnostic — never a handle; the kernel additionally refuses any
  `bindingDigest` mismatch itself (kernel invariant 4).
- **Idempotency:** verification consumes nothing; the kernel journals consumption of the verified
  authorization (its decision 0026). Grant consumption in the approvals store is not performed: the
  kernel journal is the consumption record (phase-B ruling, policy record §7.4).

## §4 — CORMIDIA-C-B32-004 — OKF concept destination (bundle + manifest)

- **Valid input:** a candidate whose intervention content carries `{ markdown }` (an OKF concept
  draft in `candidates` placement) or `{ text }`; a V1 loop scope living in this root (org root:
  `org`, `roles/<r>`; app root: `apps/<a>[/roles/<r>]`); a scope outside the V1 grammar lands,
  visibly in its loop block, at the root's own scope.
- **Guaranteed output of `prepare` (pure):** one effect `okf.concept.activate` whose payload is
  the exact activated bytes the fork's `renderActivatedConcept` produces (`loop.status`
  candidate → active, everything else byte-preserved), target `bundle/<scope>/<name>.md`,
  `expectedBase` = the requested base or the root manifest's `bundle_version` (`unversioned`
  before the first cut — the B-11 `base_manifest_version` value), and a `disable` after-effect.
- **Guaranteed output of `applyEffect`:** write the concept atomically → cut exactly one
  manifest version whose `approval_ref` is the kernel idempotency key → write the receipt LAST;
  `finalVersion` is the cut version. A repeated key returns the stored receipt and moves nothing.
- **Error behavior:** the same key under a different effect → `publication.receipt_mismatch`;
  a base that moved, or a target already holding different bytes → `publication.base_mismatch`
  with no write; an active canary on the root → `publication.destination_busy` before any write
  (the fork's mid-trial guard, preserved); a malformed stored receipt → `store.corrupt`.
- **Crash-mid-step:** a crash between the manifest cut and the receipt forward-completes on
  retry from the manifest history (same `approval_ref`), never a second cut; a crash before the
  cut re-applies under the base check.
- **After-effects:** `disable` deprecates the concept in place and cuts a version
  (`disableConcept`); rollback and compensate are not declared by this destination.

## §5 — CORMIDIA-C-B32-005 — replay executor

- **Valid input:** a kernel `ReplayAttemptRequest`; a host runner seam `{ id, version,
  configurationDigest, run }`.
- **Guaranteed output:** every completed or failed result carries an attestation echoing every
  request digest, arm, repetition, nonce, and this executor's exact registration; measurements
  are the runner's typed scalars; the request is never mutated.
- **Error behavior:** a runner failure is a `failed` result with diagnostics and an attestation;
  use before registration throws.
- **Production runner:** the fork's worktree-isolated loop replay binds to the seam through
  `createLoopReplayRunner` (phase B, landed 2026-08-21); experiments are post-publication over a
  journaled publish intervention, control arm = bundle minus the concept (policy record §7.6).

## Boundary note
Phase B (2026-08-21) bound the proposal and GitHub-ticket destinations, the authority lanes
(human gate / routine / operator — authority port 1.1.0), the scheduled distiller/reviewer turns,
the `learn *` CLI, context assembly (kernel resolution receipts and exposures as sidecars beside
the authoritative OKF manifest), and post-publication experiments. Evaluation-gate proposals
route through the proposal destination (`proposals/gates/`). F-PT-041 is resolved by the cutover
rule — exactly one writer per destination root at any time, switched at cutover (policy record
§9) — and dual-writing is unrepresentable now that the forked publisher is removed; the harness
records the ruling, not a test of a state that cannot exist.
