# OPERON-BND-001 — Installed implementation ↔ persisted schema estate

Status: **Ratified — 2026-07-29**

Traces: J-01–03, J-09; OPERON-INV-001–004, OPERON-INV-009–010.

## Contract

### 1. Valid input domain

- `[doc]` The installed binary and Agent Skill have an identifiable package
  version. Org, app, and state records use their declared schemas and required
  locations.
- `[doc]` A complete current org or a legacy org accepted by the explicit
  migration path is valid.
- Missing required files, malformed schemas, symlinks/collisions, unsupported
  newer schemas, and package/skill version disagreement are invalid.
- `OPEN (PTF-005/AF-004)`: the supported backward/forward compatibility
  window and npm rollback matrix are not yet ratified.

### 2. Output guarantees

- Discovery reports the executable version, Agent Skill availability, resolved
  home/schema versions, and compatibility result without implying runtime
  readiness.
- A successful initialization or upgrade leaves one complete validated schema
  estate; it never leaves a half-migrated “ready” home.
- Existing human-ratified content is preserved unless the migration plan
  explicitly names and authorizes its transformation.

### 3. Error and recovery behavior

- Missing implementation or home produces a typed refusal with the exact
  missing path/version and remediation; it is not coerced to an empty org.
- An incompatible or corrupt schema fails before provider/runtime construction.
- Upgrade is plan-first and archive-backed. An interrupted or thrown migration
  either completes idempotently or restores the archived pre-state.
- A planned npm capability that is absent is reported `planned`, not failed as
  though it were in today's supported profile.

### 4. Idempotency and retry

- Repeating init/upgrade for the same package, target, and plan is a no-op or
  resumes the same migration identity.
- A collision or different migration plan cannot reuse an earlier success.
- Rollback targets the exact archived package/home identity; it never guesses
  from a version label alone.

### 5. Timing, ordering, and freshness

- Compatibility is resolved before every org-scoped mutation and pinned for
  that invocation.
- Migration stages are ordered: inspect → plan/archive → stage → validate →
  activate; readiness follows activation and validation.
- Cached compatibility cannot outlive a package or schema change.

## Controlled-seam obligations

The Layer-2 seam must vary binary/skill/home/app/state versions independently,
inject collisions and interrupted migrations, and prove exact rollback. Real
package-launcher and registry semantics remain the retained live obligation.
