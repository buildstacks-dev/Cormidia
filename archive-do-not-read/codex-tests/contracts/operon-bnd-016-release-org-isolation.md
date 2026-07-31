# OPERON-BND-016 — Platform release control plane ↔ operated organization

Status: **Ratified — 2026-07-29**

Traces: J-01, J-09; OPERON-INV-001–003, OPERON-INV-005,
OPERON-INV-009–011.

## Contract

### 1. Valid input domain

- Platform release work consumes an identified source candidate, versioned
  release policy, scoped qualification evidence, and release authority outside
  every operated organization's context.
- Org operation consumes an installed/published Operon release and the org's
  own governed inputs. It does not consume repository-development grants,
  release credentials, incumbent eval state, or CI authority.
- Evidence without candidate identity, evidence from a different candidate, or
  org state contaminated with platform-development authority is invalid.

### 2. Output guarantees

- A release decision identifies the exact candidate, evidence versions,
  authority, disposition, and published artifact identity when publication
  occurs.
- Platform-development instructions and secrets never enter an org's prompts,
  operational state, learning candidates, approvals, or effects.
- An operated org cannot authorize or attest the release of the Operon platform
  that operates it.

### 3. Error and recovery behavior

- Missing, stale, mismatched, or insufficient evidence blocks the affected
  release claim with a typed reason.
- Detected control-plane/org-plane contamination fails closed, identifies the
  affected scope, and requires explicit remediation before reuse.
- Publication failure does not rewrite qualification evidence as success.
- `OPEN — PTF-014:` exact release-evidence currency and release rollback
  criteria remain product-truth decisions for the future release-policy deep
  pass.

### 4. Idempotency and retry

- Qualification and release attestations are content-addressed to one candidate
  identity; retry cannot transfer evidence to changed bytes.
- Publishing the same immutable version is a no-op or an explicit conflict,
  never a second logically different release.
- Rollback creates a distinct, traceable release decision and does not erase the
  failed release history.

### 5. Timing, ordering, and freshness

- Candidate identity precedes qualification; qualification precedes release
  authorization; authorization precedes publication acknowledgement.
- Changed candidate bytes invalidate prior candidate-bound evidence.
- Evidence expiry and rollback decision windows must be explicit in the
  ratified release policy; absent values cannot be inferred by the harness.

## Controlled-seam obligations

Use separate temporary platform and org homes, synthetic candidate identities,
content-bound evidence, changed-byte probes, prompt/state/learning contamination
probes, authorization ordering failures, and a disposable publication seam.
Real release publication remains separately authorized.
