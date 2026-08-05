# Contract — B-17 Typed critical-effect executor ↔ non-GitHub external target
Canonical ID: **CORMIDIA-C-B17-001 (alias: B-17)**

Status: DRAFT (Phase 4). Defends INV-003/014, T-12. Journeys J-05/J-11/J-17.

## 1. Valid inputs
- Only orchestrator-owned, typed, allowlisted actions (currently: GitHub issue
  create/comment — via B-01 — plus the specialized release handoff) `[doc]`; each
  execution consumes exactly one matching decided grant (INV-003).
- Release handoff requires the app's declared `release:` mechanism and owner; a
  deployable milestone with no declared mechanism fails the ship gate (A4 `[doc]`).
- An RQ-1 package/tag handoff additionally requires the exact squash-merge commit,
  one qualified evidence-only packet for the declared version, and a canonical
  post-merge attestation derived from immutable git objects. The queued action binds
  that attestation digest; no plain-tag compatibility path is admissible.

## 2. Output guarantees
- Durable execution record `approved → executing → executed | failed | ambiguous`, with
  attempt, actor, result, remote reference, and next action `[doc]`.
- Acknowledgement is a distinct fact from the decision (T-12); no surface renders
  approved as executed (INV-008).
- For RQ-1, the typed executor derives the release-approval record from the attributable
  human decision, embeds approval plus attestation in the annotated tag, and invokes
  `git tag`/`git push` as argument arrays rather than interpolated shell text.
- **Acceptance vs completion:** for asynchronous targets, "accepted" (e.g. 202) is
  recorded as accepted — completion is a separately verified fact; the record never
  jumps to `executed` on acceptance alone `[elicited]`.

## 3. Error behavior
- Lost response after possible effect → `ambiguous`: terminal until reconciled via
  idempotency marker or explicit human disposition; **never blind retry** `[doc]`
  (INV-003).
- Target auth/credential failure → `failed`; the **immutable grant/use/attempt evidence
  remains in audit** — but a consumed grant does not become reusable merely because
  target authentication failed.
- Idempotency-marker disagreement (our record vs target state) → `ambiguous` with both
  states recorded — the machine never picks the greener story (INV-008).
- Missing, modified, stale, non-human-approved, or digest-mismatched RQ-1 attestation
  refuses before grant consumption and before tag creation.

## 4. Idempotency
- At-most-once execution per grant; markers checked **before** any attempt and **typed
  by what they prove** `[elicited]`: an **acceptance marker** → acceptance recorded,
  execution still incomplete; a **completion marker/evidence** → `executed`; inability
  to establish completion → `ambiguous`. Exactly-once holds only where completion
  evidence proves the effect.

## 5. Timing
- Execution happens on a later dispatch tick after decision `[doc]` — no immediacy
  promise; each published payload needs its own execution acknowledgement (external
  publication never broadly scopeable).

## L3 status
BLOCKED per boundary-map B-17 — no disposable real non-GitHub target. Recorded in
`validation-policy.yaml` (obligation `B-17-L3`) with reason + unblock condition
(policy ratified 2026-07-31; the unblock condition remains unmet); no green L3 claim
follows. The 2026-08-04 RQ-1 revision classifies this generic target as future
assurance outside the npm-release denominator; absence remains visible and never pass.
<!-- changelog 2026-07-31: pointed to the existing draft policy (final-gate fix). -->
<!-- ratification 2026-07-31: policy no longer draft; B-17-L3 stays BLOCKED. -->
