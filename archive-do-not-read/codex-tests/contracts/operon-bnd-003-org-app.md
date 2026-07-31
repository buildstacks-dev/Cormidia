# OPERON-BND-003 — Org governance/configuration ↔ app-owned product state

Status: **Ratified — 2026-07-29**

Traces: J-02–07, J-11–13; OPERON-INV-001–004, OPERON-INV-009–011.

## Contract

### 1. Valid input domain

- A product operation receives one registered app identity, one repository,
  one app-owned `.operon/` configuration, and one effective org policy.
- The committed org registry and app-owned mirror normalize to the same app
  entry/schema.
- App configuration may narrow org authority and allowed assignments; it
  cannot widen them.
- Missing repos, mismatched mirrors, unknown roles/candidates, unsupported
  schemas, and authority widening are invalid.

### 2. Output guarantees

- Resolution produces one effective, provenance-bearing app configuration
  with the org/app source identities and hashes used.
- One turn sees exactly one app workdir and one app authority scope.
- App readiness states only what the current evidence proves; configuration
  presence alone does not imply registered, runtime-ready, live, or scheduled.

### 3. Error and recovery behavior

- Missing or inconsistent app state leaves the app onboarding/invalid and
  blocks product execution without damaging other apps.
- Repository or config drift after admission invalidates only affected future
  work and is named; it does not rewrite completed evidence.
- A stale app snapshot cannot widen authority or silently select a fallback
  assignment.

### 4. Idempotency and retry

- Register/verify/promote operations use the app identity and config hashes;
  repeating the same transition is a no-op.
- Changed repo/config/authority hashes create a new verification decision
  rather than reusing incompatible readiness evidence.

### 5. Timing, ordering, and freshness

- Effective org/app configuration is pinned for an admitted plan/turn.
- A later config change affects new admission or an explicit forward-only
  revision; it cannot mutate the authority of an executing step.
- Registration precedes readiness verification, which precedes live/scheduled
  claims.

## Controlled-seam obligations

Use real temporary org and app repos with independently varied registry,
mirror, authority, schema, and assignment configuration. Prove narrowing,
pinning, isolation, and drift invalidation.
